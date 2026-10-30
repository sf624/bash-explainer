// Probes: run bash 5.2 (or 5.3, for a row that says `"bash": "5.3"`) on a snippet with an instrumentation, and read back what it did. Steps B1–B5 of
// docs/design/semantics.md compare the semantic model with these facts; test/fixtures/probes/*.json hold
// the tables (written by scripts/record-probes.ts, checked by test/probe.test.ts).
//
// A snippet marks places with `@PROBE@` or `@PROBE:id@` (ids are the marker's number, from 1, when not
// given). Each marker becomes a call `__probe ID`, so it is a command: `@PROBE:x@ "$a" *.txt` prints the
// fields of its words, `cmd | @PROBE:x@` asks where the last stage runs. `__probe` is a function given in
// the environment (BASH_FUNC___probe%%), so the snippet's lines keep their numbers and child shells see it
// too; it writes NUL-separated records to a log outside the snippet's directory.
//
// Each run has a fresh temporary directory as its current directory, holding FILES; `bash --norc
// --noprofile` (and `--posix` when asked) runs the snippet as a script file, with LC_ALL=C, a fixed PATH and
// HOME, and no other environment (IFS is bash's default). A snippet that starts with `#!…/bash ARG` is run as the
// kernel runs it, with ARG (the rest of the line, as one word) before the script's name.
//
// A values row can be about dash (`"shell": "dash"`) or sh (`"shell": "sh"`: dash, and `bash --posix`, which sh is
// on systems where it is not dash). dash reads no function from the environment, so it gets `__probe` defined at the
// start of the first line (`__probe() { …; }; `), which keeps the lines of the snippet where they are.
import { execFile, spawn, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { type BashRelease, type ProbeCopy, PROBE_TABLES, type ProbeTable } from '../../src/basis';

/** The bash the probes run: `$BASH_EXPLAINER_BASH`, else `bash` on PATH. */
export const PROBE_BASH = process.env.BASH_EXPLAINER_BASH || 'bash';

/**
 * The bash 5.3 the rows of bash 5.3's constructs run (`"bash": "5.3"`; docs/design/bash-versions.md, 6):
 * `$BASH_EXPLAINER_BASH53`, a path. GPL: only run, as a separate program.
 */
export const PROBE_BASH53 = process.env.BASH_EXPLAINER_BASH53;

/** Whether `$BASH_EXPLAINER_BASH53` is a bash 5.3. */
export const hasBash53: boolean = (() => {
  if (!PROBE_BASH53) return false;
  const r = spawnSync(PROBE_BASH53, ['--norc', '--noprofile', '-c', 'echo "${BASH_VERSINFO[0]}.${BASH_VERSINFO[1]}"'], { encoding: 'utf8' });
  return r.status === 0 && r.stdout.trim() === '5.3';
})();

/** Why the probes cannot run here (no bash, or one older than 5.2), or undefined when they can. */
export const probeSkipReason: string | undefined = (() => {
  const r = spawnSync(PROBE_BASH, ['--norc', '--noprofile', '-c', 'echo "${BASH_VERSINFO[0]} ${BASH_VERSINFO[1]}"'], { encoding: 'utf8' });
  if (r.error || r.status !== 0) return `${PROBE_BASH} cannot be run`;
  const [major, minor] = r.stdout.trim().split(' ').map(Number);
  return major > 5 || (major === 5 && minor >= 2) ? undefined : `bash ${major}.${minor} is older than 5.2`;
})();

/** The files of each run's directory (a name ending in `/` is a directory). */
export const FILES = ['a.txt', 'b.txt', 'c.log', '.hidden', 'x y.txt', 'sub/', 'sub/d.txt', 'empty/'];
/** The environment of each run. */
export const PROBE_ENV = { PATH: '/usr/bin:/bin', HOME: '/home/probe', LC_ALL: 'C' };
/** In facts, the run's directory is written as BOX and the script's path as SCRIPT. */
export const BOX = '/BOX';
export const SCRIPT = 'SCRIPT';

export interface ProbeOptions {
  /** `bash --posix`. */
  posix?: boolean;
  /** dash (`/usr/bin/dash` on PATH) instead of bash; the body of `__probe` is then dash's. */
  dash?: boolean;
  /** `bash -e`. */
  errexit?: boolean;
  /** The bash to run (`PROBE_BASH53` for a row of bash 5.3); `PROBE_BASH` when absent. */
  program?: string;
  /** Variables of the environment the run starts with, on top of PROBE_ENV (they are exported). */
  environment?: Record<string, string>;
  timeout?: number;
}

export interface ProbeRun {
  /** The exit status (null when bash was killed: then `signal` says how). */
  status: number | null;
  signal?: string;
  stdout: string;
  stderr: string;
  /** The records `__probe` wrote, in order: each one starts with the marker's id. */
  records: string[][];
  /** The ids of the markers in the snippet, in order. */
  markers: string[];
  /** The process ID of the script's shell (its `$$`). */
  pid?: number;
  /** The files and directories (with a `/`) the run left in its directory besides FILES, sorted. */
  created: string[];
}

const MARKER = /@PROBE(?::([\w.-]+))?@/g;

/**
 * The times `time` prints (`real\t0m0.002s`), with every digit written as 0. bash measures them, and even `time` with no
 * pipeline can take a few milliseconds on a loaded machine (it failed so in CI once): the rows check the format of the
 * report, not its numbers.
 */
export const steadyTimes = (s: string): string => s.replace(/^(real|user|sys)\t\d+m\d+\.\d+s$/gm, (line) => line.replace(/\d/g, '0'));

/** The snippet with each marker replaced by `__probe ID`, and the ids. */
export function instrument(snippet: string): { script: string; markers: string[] } {
  const markers: string[] = [];
  const script = snippet.replace(MARKER, (_m, id: string | undefined) => {
    const name = id ?? String(markers.length + 1);
    markers.push(name);
    return `__probe ${name}`;
  });
  return { script, markers };
}

/** The argument the kernel gives bash from the snippet's `#!` line (none without one); only bash may be named there. */
function shebangArgs(snippet: string): string[] {
  const m = /^#![ \t]*(\S+)[ \t]*([^\n]*?)[ \t]*(?:\n|$)/.exec(snippet);
  if (!m) return [];
  if (!/(^|\/)bash$/.test(m[1])) throw new Error(`a probe's shebang runs bash: ${m[0]}`);
  return m[2] ? [m[2]] : [];
}

const quote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

/**
 * Runs `snippet` with `__probe` defined as `body` (bash text; `LOG` in it is the log's quoted path, `$1` is
 * the marker's id). The records are the log split on NUL, each one ended by a record separator (\x1e).
 */
export function runProbe(snippet: string, body: string, opts: ProbeOptions = {}): Promise<ProbeRun> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'explain-bash-probe-'));
  const box = path.join(root, 'box');
  const out = path.join(root, 'out');
  fs.mkdirSync(box);
  fs.mkdirSync(out);
  for (const f of FILES) {
    if (f.endsWith('/')) fs.mkdirSync(path.join(box, f));
    else fs.writeFileSync(path.join(box, f), '');
  }
  const log = path.join(out, 'log');
  const scriptFile = path.join(out, 'script.sh');
  const { script, markers } = instrument(snippet);
  const logged = body.replace(/\bLOG\b/g, quote(log));
  if (opts.dash && snippet.startsWith('#!')) throw new Error('a dash probe has no shebang');
  // (dash: on the first line, so that the snippet's lines keep their numbers.)
  fs.writeFileSync(scriptFile, opts.dash ? `__probe() { ${logged}; }; ${script}` : script);
  fs.writeFileSync(log, '');
  const fn = `() { ${logged}\n}`;
  const args = opts.dash ? [scriptFile] : ['--norc', '--noprofile', ...shebangArgs(snippet), ...(opts.posix ? ['--posix'] : []), ...(opts.errexit ? ['-e'] : []), scriptFile];
  const env = { ...PROBE_ENV, ...opts.environment, ...(opts.dash ? {} : { 'BASH_FUNC___probe%%': fn }) };
  const normalize = (s: string): string => steadyTimes(s.split(box).join(BOX).split(scriptFile).join(SCRIPT));
  return new Promise((resolve) => {
    const child = execFile(opts.dash ? 'dash' : opts.program ?? PROBE_BASH, args, { cwd: box, env, timeout: opts.timeout ?? 5000, encoding: 'utf8', maxBuffer: 1 << 24 }, (_err, stdout, stderr) => {
      const raw = fs.readFileSync(log, 'utf8');
      // What the run left in its directory besides FILES (a directory ends with `/`).
      const created: string[] = [];
      const walk = (dir: string, rel: string): void => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const name = `${rel}${e.name}${e.isDirectory() ? '/' : ''}`;
          if (!FILES.includes(name)) created.push(name);
          if (e.isDirectory()) walk(path.join(dir, e.name), name);
        }
      };
      walk(box, '');
      fs.rmSync(root, { recursive: true, force: true });
      const records = raw.split('\x1e').slice(0, -1).map((r) => normalize(r).split('\0').slice(0, -1));
      resolve({ status: child.exitCode, signal: child.signalCode ?? undefined, stdout: normalize(stdout), stderr: normalize(stderr), records, markers, pid: child.pid, created: created.sort() });
    });
    child.stdin?.end();
  });
}

// ---------------------------------------------------------------------------------------------------
// B1: shell state.

export interface VariableFacts {
  /** The attribute letters of `declare -p` (`-` for none): a, A, i, x, r, n, l, u, t. */
  attrs: string;
  /** What `declare -p` prints after `=`, as bash quotes it; absent for a variable declared with no value. */
  value?: string;
}
export interface StateFacts {
  /** `shopt -p`: true when set. */
  shopt: Record<string, boolean>;
  /** `set -o`. */
  set: Record<string, boolean>;
  /** `declare -p`, without the variables bash changes by itself (VOLATILE). */
  variables: Record<string, VariableFacts>;
  /** `declare -F`, without `__probe`: the names, with `x` for the exported ones (`f`, `fx`). */
  functions: Record<string, string>;
  /** `alias`: name → value. */
  aliases: Record<string, string>;
}

/** Variables whose value changes from one command or run to the next. */
export const VOLATILE = new Set([
  '_', 'BASHPID', 'BASH_ARGC', 'BASH_ARGV', 'BASH_ARGV0', 'BASH_COMMAND', 'BASH_LINENO', 'BASH_SOURCE', 'BASH_SUBSHELL',
  'BASHOPTS', 'SHELLOPTS', 'EPOCHREALTIME', 'EPOCHSECONDS', 'FUNCNAME', 'HISTCMD', 'LINENO', 'PIPESTATUS', 'PPID',
  'RANDOM', 'SECONDS', 'SRANDOM',
]);

const STATE_BODY = `{ printf '%s\\0' "$1"; builtin shopt -p; printf '\\0'; builtin set -o; printf '\\0'; builtin declare -p; printf '\\0'; builtin declare -F; printf '\\0'; builtin alias; printf '\\0\\x1e'; } >>LOG`;

/** Reads `declare -p` (one variable per line: bash quotes newlines as $'…\n'). */
function parseDeclare(text: string): Record<string, VariableFacts> {
  const vars: Record<string, VariableFacts> = {};
  for (const line of text.split('\n')) {
    const m = /^declare -(\S+) ([A-Za-z_][A-Za-z0-9_]*)(?:=(.*))?$/.exec(line);
    if (!m) continue;
    vars[m[2]] = m[3] === undefined ? { attrs: m[1] } : { attrs: m[1], value: m[3] };
  }
  return vars;
}

/** Reads the output of `alias`: `alias name='value'`, with `'\''` for a quote. */
function parseAliases(text: string): Record<string, string> {
  const aliases: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const m = /^alias ([^=]+)='(.*)'$/.exec(line);
    if (m) aliases[m[1]] = m[2].replace(/'\\''/g, "'");
  }
  return aliases;
}

function parseState(rec: string[]): StateFacts {
  const [, shopt, set, declare, functions, aliases] = rec;
  const facts: StateFacts = { shopt: {}, set: {}, variables: {}, functions: {}, aliases: parseAliases(aliases) };
  for (const m of shopt.matchAll(/^shopt -([su]) (\S+)$/gm)) facts.shopt[m[2]] = m[1] === 's';
  for (const m of set.matchAll(/^(\S+)\s+(on|off)$/gm)) facts.set[m[1]] = m[2] === 'on';
  for (const [name, v] of Object.entries(parseDeclare(declare))) if (!VOLATILE.has(name)) facts.variables[name] = v;
  for (const m of functions.matchAll(/^declare -(\S+) (\S+)$/gm)) if (m[2] !== '__probe') facts.functions[m[2]] = m[1];
  return facts;
}

/**
 * The shell state at each marker, and at the end (id `end`, after the snippet's last line). A marker that
 * runs more than once keeps its last state; one that never runs is absent.
 */
export async function probeState(snippet: string, opts: ProbeOptions = {}): Promise<{ states: Record<string, StateFacts>; run: ProbeRun }> {
  const run = await runProbe(`${snippet}\n@PROBE:end@\n`, STATE_BODY, opts);
  const states: Record<string, StateFacts> = {};
  for (const rec of run.records) states[rec[0]] = parseState(rec);
  return { states, run };
}

/** What changed from the state of an empty snippet (with the same options): the form of the tables. */
export interface StateDiff {
  shopt?: Record<string, boolean>;
  set?: Record<string, boolean>;
  variables?: Record<string, VariableFacts>;
  /** Variables of the empty snippet that are gone. */
  unset?: string[];
  functions?: Record<string, string>;
  aliases?: Record<string, string>;
}

const baselines = new Map<string, Promise<StateFacts>>();
/** The state at the end of an empty snippet. */
export function baselineState(opts: ProbeOptions = {}): Promise<StateFacts> {
  const key = JSON.stringify({ posix: !!opts.posix, errexit: !!opts.errexit, program: opts.program, environment: opts.environment ?? {} });
  let b = baselines.get(key);
  if (!b) {
    b = probeState('', opts).then((r) => r.states.end);
    baselines.set(key, b);
  }
  return b;
}

export function diffState(base: StateFacts, s: StateFacts): StateDiff {
  const diff: StateDiff = {};
  const changed = <T>(a: Record<string, T>, b: Record<string, T>): Record<string, T> | undefined => {
    const out: Record<string, T> = {};
    for (const k of Object.keys(b).sort()) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out[k] = b[k];
    return Object.keys(out).length ? out : undefined;
  };
  const shopt = changed(base.shopt, s.shopt);
  if (shopt) diff.shopt = shopt;
  const set = changed(base.set, s.set);
  if (set) diff.set = set;
  const variables = changed(base.variables, s.variables);
  if (variables) diff.variables = variables;
  const unset = Object.keys(base.variables).filter((k) => !(k in s.variables)).sort();
  if (unset.length) diff.unset = unset;
  const functions = changed(base.functions, s.functions);
  if (functions) diff.functions = functions;
  const aliases = changed(base.aliases, s.aliases);
  if (aliases) diff.aliases = aliases;
  return diff;
}

// ---------------------------------------------------------------------------------------------------
// B2: execution environments.

/**
 * Where a marker ran: in the main shell, in a subshell of it (`$BASHPID` is not `$$`), in another shell
 * (`bash -c`: its `$$` is not the script's), in more than one of these (it ran more than once), or not at all.
 */
export type EnvFact = 'main' | 'sub' | 'other-shell' | 'mixed' | 'not-run';

const ENV_BODY = `{ if [ "$BASHPID" = "$$" ]; then printf '%s\\0main\\0%s\\0\\x1e' "$1" "$$"; else printf '%s\\0sub\\0%s\\0\\x1e' "$1" "$$"; fi; } >>LOG`;

/** For each marker, whether it runs in the main shell, a subshell, or another shell. */
export async function probeEnv(snippet: string, opts: ProbeOptions = {}): Promise<{ env: Record<string, EnvFact>; run: ProbeRun }> {
  const run = await runProbe(snippet, ENV_BODY, opts);
  const env: Record<string, EnvFact> = {};
  for (const id of run.markers) env[id] = 'not-run';
  for (const [id, where, pid] of run.records) {
    const fact: EnvFact = Number(pid) !== run.pid ? 'other-shell' : (where as EnvFact);
    env[id] = env[id] === 'not-run' || env[id] === fact ? fact : 'mixed';
  }
  return { env, run };
}

// ---------------------------------------------------------------------------------------------------
// B3: name resolution.

/** What `type -t NAME` says: alias, keyword, function, builtin, file, or none (it prints nothing). */
export type NameKind = 'alias' | 'keyword' | 'function' | 'builtin' | 'file' | 'none' | 'not-run';

/** At each marker, `type -t` of each name, under the options given. */
export async function probeTypes(snippet: string, names: string[], opts: ProbeOptions = {}): Promise<{ types: Record<string, Record<string, NameKind>>; run: ProbeRun }> {
  const lookups = names.map((n) => `builtin type -t ${quote(n)} || printf none; printf '\\0';`).join(' ');
  const run = await runProbe(snippet, `{ printf '%s\\0' "$1"; ${lookups} printf '\\x1e'; } >>LOG`, opts);
  const types: Record<string, Record<string, NameKind>> = {};
  const notRun = Object.fromEntries(names.map((n) => [n, 'not-run' as NameKind]));
  for (const id of run.markers) types[id] = { ...notRun };
  for (const [id, ...kinds] of run.records) types[id] = Object.fromEntries(names.map((n, i) => [n, kinds[i].trim() as NameKind]));
  return { types, run };
}

/** The same, under bash and under `bash --posix`. */
export async function probeNames(snippet: string, names: string[]): Promise<Record<string, Record<string, { bash: NameKind; posix: NameKind }>>> {
  const [bash, posix] = await Promise.all([probeTypes(snippet, names), probeTypes(snippet, names, { posix: true })]);
  const out: Record<string, Record<string, { bash: NameKind; posix: NameKind }>> = {};
  for (const id of bash.run.markers) out[id] = Object.fromEntries(names.map((n) => [n, { bash: bash.types[id][n], posix: posix.types[id][n] }]));
  return out;
}

// ---------------------------------------------------------------------------------------------------
// B4: words.

// (POSIX text, which dash runs too: its printf knows no `\x1e`.)
const WORDS_BODY = `{ printf '%s\\0' "$1"; shift; if [ "$#" -gt 0 ]; then printf '%s\\0' "$@"; fi; printf '\\036'; } >>LOG`;
/** The same, and then what the marker reads on its stdin, without the newline that a here-string ends with (bash only). */
const STDIN_BODY = `{ printf '%s\\0' "$1"; shift; if [ "$#" -gt 0 ]; then printf '%s\\0' "$@"; fi; local __in; __in=$(cat; echo .); __in=\${__in%.}; printf '%s\\0\\036' "\${__in%$'\\n'}"; } >>LOG`;

/**
 * For each marker, the fields of its words, once per time it ran (`@PROBE:x@ $a *.txt`); with `stdin`, then the text
 * it reads on its stdin (`@PROBE:x@ <<< ~`).
 */
export async function probeWords(snippet: string, opts: ProbeOptions & { stdin?: boolean } = {}): Promise<{ fields: Record<string, string[][]>; run: ProbeRun }> {
  const run = await runProbe(snippet, opts.stdin ? STDIN_BODY : WORDS_BODY, opts);
  const fields: Record<string, string[][]> = {};
  for (const id of run.markers) fields[id] = [];
  for (const [id, ...words] of run.records) fields[id].push(words);
  return { fields, run };
}

// ---------------------------------------------------------------------------------------------------
// B5: status and errexit.

/** The markers that ran, in order, and the exit status (under `bash -e` unless `errexit: false`). */
export async function probeStatus(snippet: string, opts: ProbeOptions = {}): Promise<{ ran: string[]; status: number | null; run: ProbeRun }> {
  const run = await runProbe(snippet, `printf '%s\\0\\x1e' "$1" >>LOG`, { errexit: true, ...opts });
  return { ran: run.records.map((r) => r[0]), status: run.status, run };
}

// ---------------------------------------------------------------------------------------------------
// The tables: test/fixtures/probes/<kind>.json, an array of rows. `snippet` and the inputs are written by
// hand; `facts` by scripts/record-probes.ts.

/** The probe tables: src/basis.ts has the list, since the explanations name rows by it. */
export type ProbeKind = ProbeTable;
export const PROBE_KINDS: readonly ProbeKind[] = PROBE_TABLES;

export interface ProbeRow {
  /** A name other files refer to the row by (the allow-list's `kind#id`), unique in its table. */
  id?: string;
  /** The section of the Bash manual the row is about ('3.2.3'). */
  manual: string;
  snippet: string;
  /** state: `bash --posix`. */
  posix?: boolean;
  /** state: variables of the environment the run starts with (`ProbeOptions.environment`). */
  environment?: Record<string, string>;
  /** status: false to run without `-e`. */
  errexit?: boolean;
  /** words: each marker also prints what it reads on its stdin (the text of its here-string), after its words. */
  stdin?: boolean;
  /** names: the names to look up at each marker. */
  names?: string[];
  /** What the row shows (optional). */
  note?: string;
  /** A program the snippet runs that may be missing (`dash`): without it on the probes' PATH, the row is not run again. */
  requires?: string;
  /** values: the shell the row is about, when not bash: dash, or sh (dash and `bash --posix`; facts `{ dash, posix }`). Such a row requires dash. */
  shell?: 'dash' | 'sh';
  /** A row of a construct of bash 5.3 (`${ cmd; }`): run with `PROBE_BASH53`, and kept as recorded without it. */
  bash?: '5.3';
  /**
   * A command that shows the reader what the row checks, in their terminal (docs/design/basis.md): `code` as they
   * would type it, one word `bash -c '…'` with no `'` or `\` inside, so that any shell they type it in (bash, zsh,
   * fish) runs the same bash script (test/basis.test.ts checks it), and `output`, what it printed (stdout and stderr, as a terminal shows them; `tryOutput`). scripts/record-probes.ts writes `output`
   * and the copy src/basis-probes.json, which the explanations read; test/probe.test.ts runs `code` again. A row with
   * a try-it has an `id`. `bash`: the releases it printed `output` in, written by scripts/record-probes.ts: the row's own
   * (5.2, or 5.3 for a row of bash 5.3), then 5.3 when bash 5.3 prints the same (CI's `bash53` job checks it).
   */
  try?: { code: string; output?: string; bash?: BashRelease[] };
  facts?: unknown;
}

/** The first line of stderr that is not empty, when there is one (bash's text, with the script's path as SCRIPT). */
const firstError = (run: ProbeRun): { stderr?: string } => {
  const line = run.stderr.split('\n').find((l) => l.trim());
  return line ? { stderr: line } : {};
};

/** What bash does with a row: the facts the table records. */
export async function factsOf(kind: ProbeKind, row: ProbeRow): Promise<unknown> {
  const program = row.bash === '5.3' ? PROBE_BASH53 : undefined;
  switch (kind) {
    case 'state': {
      const opts = { posix: row.posix, program, ...(row.environment ? { environment: row.environment } : {}) };
      const [{ states, run }, base] = await Promise.all([probeState(row.snippet, opts), baselineState(opts)]);
      return { ...Object.fromEntries(Object.entries(states).map(([id, s]) => [id, diffState(base, s)])), status: run.status, ...firstError(run) };
    }
    case 'env': {
      const { env, run } = await probeEnv(row.snippet, { program });
      return { ...env, ...firstError(run) };
    }
    case 'names':
      return probeNames(row.snippet, row.names ?? []);
    case 'words': {
      const { fields, run } = await probeWords(row.snippet, { posix: row.posix, program, stdin: row.stdin });
      // (What the run created shows where its redirections went.)
      return { ...fields, status: run.status, ...firstError(run), ...(run.created.length ? { created: run.created } : {}) };
    }
    case 'status': {
      const { ran, status, run } = await probeStatus(row.snippet, { errexit: row.errexit ?? true, posix: row.posix, program });
      return { ran, status, ...firstError(run) };
    }
    // (The values of expansions, docs/design/expansion-values.md: the fields of each marker's one word, as for words;
    // for sh, those of dash and of `bash --posix`.)
    case 'values': {
      const facts = async (opts: ProbeOptions): Promise<Record<string, unknown>> => {
        const { fields, run } = await probeWords(row.snippet, opts);
        return { ...fields, status: run.status, ...firstError(run) };
      };
      if (row.shell === 'sh') {
        const [dash, posix] = await Promise.all([facts({ dash: true }), facts({ posix: true })]);
        return { dash, posix };
      }
      return facts(row.shell === 'dash' ? { dash: true } : { posix: row.posix });
    }
  }
}

/** Whether the program a row requires is on the probes' PATH, and a row of bash 5.3 has one. */
export function hasRequired(row: ProbeRow): boolean {
  if (row.bash === '5.3' && !hasBash53) return false;
  return !row.requires || spawnSync('sh', ['-c', `command -v ${row.requires}`], { env: PROBE_ENV }).status === 0;
}

export const PROBE_DIR = path.join(__dirname, '..', 'fixtures', 'probes');
export const probeFile = (kind: ProbeKind): string => path.join(PROBE_DIR, `${kind}.json`);
export const readProbeTable = (kind: ProbeKind): ProbeRow[] => JSON.parse(fs.readFileSync(probeFile(kind), 'utf8')) as ProbeRow[];

/** The path of a program: `name` itself when it has a `/`, else the first on PATH. */
function programPath(name: string): string {
  if (name.includes('/')) return path.resolve(name);
  const dir = (process.env.PATH ?? '').split(':').find((d) => d && fs.existsSync(path.join(d, name)));
  if (!dir) throw new Error(`${name} is not on PATH`);
  return path.join(dir, name);
}

/**
 * What a row's try-it prints, as the reader's terminal shows it: `code` run by `bash --norc --noprofile -c` (the
 * reader's shell) in a fresh directory holding FILES, with the environment of the probes, and the row's bash first on
 * PATH as `bash` (so `bash -c '…'` in the code runs it). stdout and stderr go to one file, in the order they are
 * written; the last newline is dropped. The directory is written as BOX, and the one that holds the row's bash (first
 * on PATH) as BIN. `release`: run it in another release than the row's (5.3 for a row of 5.2). When the shell ends, what it left running (a job in the background) is killed with it: its process
 * group; so is all of it on a timeout.
 */
export function tryOutput(row: ProbeRow, timeout = 5000, release: BashRelease = releaseOf(row)): Promise<string> {
  const program = programPath(release === '5.3' ? PROBE_BASH53! : PROBE_BASH);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'explain-bash-try-'));
  const [box, bin, out] = ['box', 'bin', 'out'].map((d) => path.join(root, d));
  fs.mkdirSync(box);
  fs.mkdirSync(bin);
  for (const f of FILES) {
    if (f.endsWith('/')) fs.mkdirSync(path.join(box, f));
    else fs.writeFileSync(path.join(box, f), '');
  }
  fs.symlinkSync(program, path.join(bin, 'bash'));
  // (Each directory also as `pwd` prints it, with no symbolic link in it.)
  const names: [string, string][] = [[box, BOX], [fs.realpathSync(box), BOX], [bin, 'BIN'], [fs.realpathSync(bin), 'BIN']];
  const fd = fs.openSync(out, 'w');
  return new Promise((resolve, reject) => {
    let timedOut = false;
    let done = false;
    const finish = (error?: Error): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      fs.closeSync(fd);
      const text = steadyTimes(names.reduce((t, [p, name]) => t.split(p).join(name), fs.readFileSync(out, 'utf8')).replace(/\n$/, ''));
      fs.rmSync(root, { recursive: true, force: true });
      if (error) reject(error);
      else resolve(text);
    };
    const killGroup = (pid: number | undefined): void => {
      try {
        if (pid) process.kill(-pid, 'SIGKILL');
      } catch {
        // (The group is gone already.)
      }
    };
    const child = spawn(program, ['--norc', '--noprofile', '-c', row.try!.code], {
      cwd: box, env: { ...PROBE_ENV, PATH: `${bin}:${PROBE_ENV.PATH}` }, stdio: ['ignore', fd, fd], detached: true,
    });
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup(child.pid);
    }, timeout);
    child.on('error', (err) => finish(new Error(`the try-it could not run: ${err.message}`)));
    child.on('exit', () => {
      killGroup(child.pid);
      finish(timedOut ? new Error(`the try-it timed out: ${row.try!.code}`) : undefined);
    });
  });
}

/** The release a row runs in. */
export const releaseOf = (row: ProbeRow): BashRelease => row.bash ?? '5.2';

/** The releases a row's try-it printed its output in, as recorded: its own release when none is. */
export const tryReleases = (row: ProbeRow): BashRelease[] => row.try?.bash ?? [releaseOf(row)];

/**
 * The releases a try-it prints `output` in: the row's own, then 5.3 for a row of 5.2 when bash 5.3 prints the same.
 * Without a bash 5.3, the releases recorded (`ProbeRow.try.bash`).
 */
export async function releasesOf(row: ProbeRow, output: string): Promise<BashRelease[]> {
  if (releaseOf(row) === '5.3') return ['5.3'];
  if (!hasBash53) return tryReleases(row);
  return (await tryOutput(row, undefined, '5.3')) === output ? ['5.2', '5.3'] : ['5.2'];
}

/** The copy of the rows with a try-it that the explanations read (src/basis-probes.json), from the tables. */
export function basisCopy(): Record<string, ProbeCopy> {
  const copy: Record<string, ProbeCopy> = {};
  for (const kind of PROBE_KINDS) {
    for (const row of readProbeTable(kind)) {
      if (!row.try) continue;
      if (!row.id || row.try.output === undefined) throw new Error(`${kind}: ${row.snippet}: a row with a try-it needs an id and a recorded output (scripts/record-probes.ts)`);
      copy[`${kind}#${row.id}`] = { manual: row.manual, bash: tryReleases(row), try: { code: row.try.code, output: row.try.output } };
    }
  }
  return copy;
}

/** Where the copy is. */
export const BASIS_COPY = path.join(__dirname, '..', '..', 'src', 'basis-probes.json');

/** Runs `tasks` with at most `limit` at a time. */
export async function pooled<T>(tasks: (() => Promise<T>)[], limit = Math.max(4, os.cpus().length * 2)): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

// ---------------------------------------------------------------------------------------------------
// The comparison of words with what bash logged (test/word-probes.test.ts, test/argv.test.ts).

/**
 * Where the model knows the fields of some words of a command only: the fields of the known words before the first
 * unknown one (`head`) and after the last one (`tail`), and whether every run of bash starts with that head and ends
 * with that tail. (With no unknown word, `head` is all of them and `tail` empty.)
 */
export function alignRuns(results: readonly { fields?: string[] }[], runs: readonly string[][]): { head: string[]; tail: string[]; fits: boolean } {
  const first = results.findIndex((r) => !r.fields);
  const last = results.length - 1 - [...results].reverse().findIndex((r) => !r.fields);
  const head = results.slice(0, first < 0 ? results.length : first).flatMap((r) => r.fields!);
  const tail = first < 0 ? [] : results.slice(last + 1).flatMap((r) => r.fields!);
  const fits = runs.every((run) => JSON.stringify(run.slice(0, head.length)) === JSON.stringify(head)
    && (!tail.length || JSON.stringify(run.slice(-tail.length)) === JSON.stringify(tail)));
  return { head, tail, fits };
}
