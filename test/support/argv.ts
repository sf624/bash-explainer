// Argv capture (docs/design/oracles.md, 2.2 and step 2): a script of the corpus is run in bash with each simple
// command replaced by a recorder that logs the argv it receives, so that the fields the word model gives
// (`wordFields`) can be compared with bash's.
//
// `instrumentArgv` rewrites the text of a script, keeping every line where it is:
// - each simple command with a name gets `__probe ID ` before its name (after its prefix assignments): the command
//   does not run, and `__probe` logs its words as bash expanded them. Not before a call of a function of the script
//   that is sure to be defined (its body is instrumented and must run, or the state after it is not the model's), nor
//   before the builtins that change state the model follows (`STATE_BUILTINS`), which run as they are;
// - `[`, `test`, `true`, `false`, `:` and `printf -v` get `__probe_r ID `: the words are logged, then the builtin
//   runs, so that conditions take the branches bash takes;
// - a command in the condition of a `while` loop returns 0 the first time it runs and 1 after (`__probe_w`), and
//   one in the condition of an `until` loop the other way round (`__probe_u`), so that such a loop runs its body once;
// - every file redirection is sent to /dev/null, so that nothing outside the run's directory is read or written (and
//   no `/dev/tcp` is opened). On a command with a marker, the target is moved into the argv, between the words
//   `@@R@@` and `@@E@@`, where bash expands it as it would have for the redirection; a duplication (`2>&1`, `<&3`)
//   and a process substitution stay as they are.
//
// `runArgvBatch` runs the scripts in one `runContained` (a cgroup when `systemd-run --user` works, a process group
// killed on a timeout), each under `timeout`, with `FUNCNEST` and `ulimit -f`, in a fresh directory holding FILES,
// stdin from /dev/null (or a file of the job's lines). A file read through BASH_ENV defines the recorders, then sets
// PATH to a directory that does not exist, defines `command_not_found_handle` to log `ESCAPED name` (a command that
// reached a PATH search, which the test fails on), and turns off with `enable -n` the builtins that reach outside the
// shell. A command named by a path (`/bin/rm`) needs no PATH search: only the markers keep it from running.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveName } from '../../src/semantics/names';
import type { StateModel } from '../../src/semantics/state';
import { BASH_VARIABLES } from '../../src/semantics/vars';
import { wordFields, type WordEnv } from '../../src/semantics/words';
import { staticWordValue } from '../../src/staticword';
import { descendants, field, fields, type SyntaxNode, type SyntaxTree } from '../../src/syntax/tree';
import { runContained, scoped } from './contained';
import { alignRuns, BOX, FILES, PROBE_BASH, SCRIPT } from './probe';

/** The builtins that change state the model follows: they run as they are, and their words are not logged. */
export const STATE_BUILTINS: ReadonlySet<string> = new Set([
  'set', 'shopt', 'declare', 'typeset', 'local', 'export', 'readonly', 'unset', 'shift', 'alias', 'unalias', 'read',
  'mapfile', 'readarray', 'let', 'return', 'exit', 'break', 'continue', 'getopts',
]);
/** The builtins that run after their words are logged (and `printf -v`). */
export const PURE_BUILTINS: ReadonlySet<string> = new Set(['[', 'test', 'true', 'false', ':']);
/** The builtins turned off in the run: they reach outside the shell. */
const DISABLED = ['exec', 'kill', 'trap', 'ulimit', 'umask', 'source', '.', 'eval', 'wait', 'disown', 'suspend'];

/** The words around a redirection target moved into the argv. */
export const REDIRECT_START = '@@R@@';
export const REDIRECT_END = '@@E@@';
/** PATH in the run, after the set-up: a directory that does not exist. */
export const NO_PATH = '/nonexistent/explain-bash-argv';

export type MarkerKind = 'stub' | 'run' | 'while' | 'until';

export interface ArgvMarker {
  id: string;
  kind: MarkerKind;
  command: SyntaxNode;
  /** The words bash gives the command: its name's word and its arguments. */
  words: SyntaxNode[];
  /** The targets of the file redirections moved into the argv, in order. */
  targets: SyntaxNode[];
}

export interface Instrumented {
  script: string;
  markers: ArgvMarker[];
  /** Why commands got no marker: `function`, `state` (a builtin of STATE_BUILTINS), `no-name` (assignments only). */
  unmarked: Record<string, number>;
}

interface Edit { start: number; end: number; text: string }

/** Whether `n` is in the condition of a `while` or `until` loop: which one. */
function loopCondition(n: SyntaxNode): 'while' | 'until' | undefined {
  let at: SyntaxNode = n;
  for (let p = n.parent; p; at = p, p = p.parent) {
    if (p.type === 'while_statement' && at.field === 'condition') return p.children[0].type === 'until' ? 'until' : 'while';
    // (A loop's body, a function or a substitution in its condition is not the condition.)
    if (at.field === 'body' || p.type === 'command_substitution' || p.type === 'process_substitution') return undefined;
  }
  return undefined;
}

/** How a redirection is rewritten: `capture` (its target moves into the argv), `null` (to /dev/null), `keep`. */
function redirectRule(r: SyntaxNode): 'capture' | 'null' | 'keep' {
  const dest = field(r, 'destination');
  if (!dest || dest.type === 'process_substitution') return 'keep';
  const op = r.children.find((c) => !c.named)!.type;
  if (op === '<&') return 'keep';
  if (op === '>&') return /^(\d+-?|-)$/.test(dest.text) ? 'keep' : 'null';
  return 'capture';
}

/** Whether `n` is a node of `tree` (not of a string read as a script). */
function inTree(n: SyntaxNode, tree: SyntaxTree): boolean {
  let top = n;
  while (top.parent) top = top.parent;
  return top === tree.root;
}

/** The marked script of `tree`, whose model is `model` (the explanation's: the same tree, the same options). */
export function instrumentArgv(tree: SyntaxTree, model: StateModel, shell?: 'bash'): Instrumented {
  const edits: Edit[] = [];
  const markers: ArgvMarker[] = [];
  const unmarked: Record<string, number> = {};
  const skip = (why: string): void => { unmarked[why] = (unmarked[why] ?? 0) + 1; };
  for (const c of descendants(tree.root, ['command'])) {
    const nameNode = field(c, 'name');
    if (!nameNode) { skip('no-name'); continue; }
    const nameWord = nameNode.namedChildren[0] ?? nameNode;
    const name = staticWordValue(nameWord);
    const args = fields(c, 'argument');
    let kind: MarkerKind = 'stub';
    if (name !== undefined) {
      const res = resolveName(model, name, nameNode, { shell, command: true, quoted: nameWord.type !== 'word' || nameWord.text !== name });
      // (Not one defined in a string the script runs, `eval 'f() { …; }'`: the recorder replaces `eval`.)
      if (res.kind === 'function' && res.sure && inTree(res.fn.def, tree)) { skip('function'); continue; }
      if (res.kind === 'builtin' && !res.disabled) {
        if (STATE_BUILTINS.has(name)) { skip('state'); continue; }
        if (PURE_BUILTINS.has(name) || (name === 'printf' && args[0] && staticWordValue(args[0]) === '-v')) kind = 'run';
      }
    }
    if (kind === 'stub') kind = loopCondition(c) ?? 'stub';
    const id = String(markers.length + 1);
    const fn = { stub: '__probe', run: '__probe_r', while: '__probe_w', until: '__probe_u' }[kind];
    edits.push({ start: nameNode.startIndex, end: nameNode.startIndex, text: `${fn} ${id} ` });
    const targets: SyntaxNode[] = [];
    for (const r of fields(c, 'redirect').filter((x) => x.type === 'file_redirect')) {
      // (Not one before the name: what is moved goes after the marker.)
      if (redirectRule(r) !== 'capture' || r.startIndex < nameNode.startIndex) continue;
      const dest = field(r, 'destination')!;
      const op = tree.text.slice(r.startIndex, dest.startIndex).trimEnd();
      edits.push({ start: r.startIndex, end: dest.startIndex, text: ` ${REDIRECT_START} ` });
      edits.push({ start: dest.endIndex, end: dest.endIndex, text: ` ${REDIRECT_END} ${op}/dev/null` });
      targets.push(dest);
    }
    markers.push({ id, kind, command: c, words: [nameWord, ...args], targets });
  }
  // The other file redirections (of compound commands, of commands with no marker, and those `null` above) go to
  // /dev/null as a whole; edits inside them (a marker in `> $(cmd)`) are dropped with them.
  const captured = new Set(markers.flatMap((m) => m.targets.map((t) => t.parent!)));
  const whole: Edit[] = [];
  for (const r of descendants(tree.root, ['file_redirect'])) {
    if (captured.has(r) || redirectRule(r) === 'keep') continue;
    const dest = field(r, 'destination')!;
    const op = tree.text.slice(r.startIndex, dest.startIndex).trimEnd().replace(/^(\d*|\{\w+\})>&$/, '$1>');
    whole.push({ start: r.startIndex, end: r.endIndex, text: ` ${op}/dev/null` });
  }
  const inside = (e: Edit): boolean => whole.some((w) => w.start <= e.start && e.end <= w.end && w !== e);
  const all = [...edits.filter((e) => !inside(e)), ...whole.filter((e) => !inside(e))].sort((a, b) => b.start - a.start || b.end - a.end);
  let script = tree.text;
  for (const e of all) script = script.slice(0, e.start) + e.text + script.slice(e.end);
  // (Markers dropped with a redirection never run: they stay in the list, as markers that did not run.)
  return { script, markers, unmarked };
}

/** One script to run: its text, the variables of its environment (on top of the run's), its positional parameters. */
export interface ArgvJob {
  script: string;
  variables?: Record<string, string>;
  args?: string[];
  /** The text of stdin (/dev/null when absent). */
  stdin?: string;
}

export interface ArgvRun {
  status: number | null;
  stderr: string;
  /** The records of each marker id, in order: the fields it received (with the redirection targets). */
  records: Map<string, string[][]>;
  /** Commands that reached a PATH search (`command_not_found_handle`). */
  escaped: string[];
  /** Markers that ran more often than the cap, after which the shell running them exits. */
  capped: string[];
}

/** How often a marker may run in one shell before the run stops it. */
const CAP = 50;
/** The variables every run starts with (the model's environment, with the run's directory as BOX). */
export const ARGV_ENV: Readonly<Record<string, string>> = { PATH: NO_PATH, HOME: BOX, LC_ALL: 'C', FUNCNEST: '100' };

const quote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

/** The text read through BASH_ENV: the recorders, then the walls (see the top of this file). */
function setup(log: string): string {
  const L = quote(log);
  return `__probe_log() {
  builtin printf '%s\\037' "$@" $'\\036' >>${L}
  __probe_v="__probe_n_$1"
  builtin printf -v "$__probe_v" %s "$(( \${!__probe_v:-0} + 1 ))"
  if builtin [ "\${!__probe_v}" -gt ${CAP} ]; then builtin printf 'CAPPED\\037%s\\037\\036\\037' "$1" >>${L}; builtin exit 98; fi
}
__probe() { __probe_log "$@"; }
__probe_w() { __probe_log "$@"; builtin [ "\${!__probe_v}" -eq 1 ]; }
__probe_u() { __probe_log "$@"; builtin [ "\${!__probe_v}" -ne 1 ]; }
__probe_r() { __probe_log "$@"; builtin shift; builtin "$@"; }
command_not_found_handle() { builtin printf 'ESCAPED\\037%s\\037\\036\\037' "$1" >>${L}; builtin exit 99; }
ulimit -f 20000
PATH=${NO_PATH}
unset BASH_ENV XDG_RUNTIME_DIR DBUS_SESSION_BUS_ADDRESS __probe_v
enable -n ${DISABLED.join(' ')}
enable -n enable
`;
}

/** Runs the jobs in one contained batch (see the top of this file). */
export async function runArgvBatch(jobs: readonly ArgvJob[], { perJob = 10, program = PROBE_BASH } = {}): Promise<ArgvRun[]> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'explain-bash-argv-'));
  try {
    // (Without a cgroup, limits of the driver's own: the size of a file, the memory of a process, and the processes
    // of the user, a few hundred more than it has.)
    const lines = ['ulimit -f 20000', ...(scoped ? [] : ['ulimit -v 3000000', 'ulimit -u $(( $(ps -L -U "$(id -u)" --no-headers | wc -l) + 500 ))'])];
    jobs.forEach((job, i) => {
      const dir = path.join(root, String(i));
      const box = path.join(dir, 'box');
      fs.mkdirSync(box, { recursive: true });
      for (const f of FILES) {
        if (f.endsWith('/')) fs.mkdirSync(path.join(box, f));
        else fs.writeFileSync(path.join(box, f), '');
      }
      fs.writeFileSync(path.join(dir, 'script.sh'), job.script);
      fs.writeFileSync(path.join(dir, 'setup.sh'), setup(path.join(dir, 'log')));
      fs.writeFileSync(path.join(dir, 'log'), '');
      const stdin = job.stdin === undefined ? '/dev/null' : path.join(dir, 'stdin');
      if (job.stdin !== undefined) fs.writeFileSync(stdin, job.stdin);
      const env = { ...ARGV_ENV, PATH: '/usr/bin:/bin', HOME: box, BASH_ENV: path.join(dir, 'setup.sh'), ...job.variables };
      const assigns = Object.entries(env).map(([k, v]) => quote(`${k}=${v}`)).join(' ');
      const argv = ['--norc', '--noprofile', path.join(dir, 'script.sh'), ...(job.args ?? [])].map(quote).join(' ');
      lines.push(`(cd ${quote(box)} && exec env -i ${assigns} timeout -k 2 ${perJob} ${quote(program)} ${argv}) <${quote(stdin)} >/dev/null 2>${quote(path.join(dir, 'stderr'))}; echo $? >${quote(path.join(dir, 'status'))}`);
    });
    fs.writeFileSync(path.join(root, 'driver.sh'), `${lines.join('\n')}\n`);
    await runContained(['bash', '--norc', '--noprofile', path.join(root, 'driver.sh')], root, {}, (perJob + 3) * jobs.length * 1000);
    return jobs.map((_, i) => {
      const dir = path.join(root, String(i));
      const box = path.join(dir, 'box');
      const normalize = (s: string): string => s.split(box).join(BOX).split(path.join(dir, 'script.sh')).join(SCRIPT).split(path.join(dir, 'setup.sh')).join('SETUP');
      const records = new Map<string, string[][]>();
      const escaped: string[] = [];
      const capped: string[] = [];
      for (const rec of fs.readFileSync(path.join(dir, 'log'), 'utf8').split('\x1e\x1f').slice(0, -1)) {
        const [id, ...words] = normalize(rec).split('\x1f').slice(0, -1);
        if (id === 'ESCAPED') escaped.push(words[0]);
        else if (id === 'CAPPED') capped.push(words[0]);
        else records.set(id, [...(records.get(id) ?? []), words]);
      }
      const status = fs.existsSync(path.join(dir, 'status')) ? Number(fs.readFileSync(path.join(dir, 'status'), 'utf8')) : null;
      return { status, stderr: normalize(fs.readFileSync(path.join(dir, 'stderr'), 'utf8')), records, escaped, capped };
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/** A run's fields of a marker, split into the argv and the fields of each redirection target. */
export function splitTargets(fieldsRun: readonly string[]): { argv: string[]; targets: string[][] } {
  const argv: string[] = [];
  const targets: string[][] = [];
  let open: string[] | undefined;
  for (const f of fieldsRun) {
    if (open === undefined && f === REDIRECT_START) targets.push((open = []));
    else if (open !== undefined && f === REDIRECT_END) open = undefined;
    else (open ?? argv).push(f);
  }
  return { argv, targets };
}

// ---------------------------------------------------------------------------------------------------
// Running inputs and comparing (test/argv.test.ts).

/** A script to check: its tree, the model the explanation builds for it, and the variables its host sets. */
export interface ArgvInput { name: string; tree: SyntaxTree; model: StateModel; provided: readonly string[] }

/** The environments each input runs in (oracles.md, 2.3). */
export type ArgvEnvName = 'probe' | 'values';
export const ARGV_ENVS: readonly ArgvEnvName[] = ['probe', 'values'];

/** In `values`: the values given in turn to the variables an input reads, its positional parameters, and its stdin (lines for `read`). */
const VALUES = ['a b', '*.txt', ''];
const ARGS = ['a b', '*'];
const STDIN = 'a b\n*\n\n';

/**
 * The variables `input` reads that neither bash nor its host sets, sorted. (Those the script sets too: a value from
 * the environment is then replaced, or read before, and the model reads it the same way.)
 */
export function readNames(input: ArgvInput): string[] {
  const names = new Set(descendants(input.tree.root, ['variable_name']).map((n) => n.text).filter((n) => /^[A-Za-z_]\w*$/.test(n)));
  return [...names].filter((n) => !(n in BASH_VARIABLES) && !(n in ARGV_ENV) && !input.provided.includes(n)
    && !/^(LC_\w+|LANG|LANGUAGE|LD_\w+)$/.test(n)).sort();
}

/** The job of `input`'s run in `env`, and its variables (on top of ARGV_ENV). The host's variables have a value the model does not know. */
export function argvJob(input: ArgvInput, script: string, env: ArgvEnvName): { job: ArgvJob; variables: Record<string, string> } {
  const host = Object.fromEntries(input.provided.filter((n) => /^[A-Za-z_]\w*$/.test(n)).map((n) => [n, 'host']));
  if (env === 'probe') return { job: { script, variables: host }, variables: host };
  const variables = { ...host, ...Object.fromEntries(readNames(input).map((n, i) => [n, VALUES[i % VALUES.length]])) };
  return { job: { script, variables, args: ARGS, stdin: STDIN }, variables };
}

/** What the comparison went over: commands with a marker, those that ran, the words compared and unknown, and the commands the model says fail. */
export interface ArgvCounts { commands: number; ran: number; words: number; unknown: number; failing: number }

/** A difference: the input, the environment, the command (its text), and what differs. */
export interface ArgvFinding { input: string; env: ArgvEnvName; command: string; what: string }

/**
 * The differences between the model and bash's runs of one marker (`runs`: the fields of each time it ran):
 * - a word the model says bash fails on (failglob, `set -u`, `${x:?}`): the command must not have run;
 * - the words the model knows must be bash's argv; with unknown words, the known ones around them must be its head and
 *   tail (`alignRuns`);
 * - a redirection target: its fields, or other than one field where the model says it is ambiguous.
 * A command that did not run is not compared.
 */
export function compareMarker(m: ArgvMarker, model: StateModel, env: WordEnv, runs: readonly string[][], counts: ArgvCounts): string[] {
  const results = m.words.map((w) => wordFields(w, model, env));
  const targets = m.targets.map((t) => wordFields(t, model, env));
  const error = [...results, ...targets].find((r) => r.error && r.error !== 'ambiguous-redirect')?.error;
  if (error) {
    counts.failing++;
    return runs.length ? [`model: ${error}, bash: ran ${JSON.stringify(runs[0])}`] : [];
  }
  if (!runs.length) return [];
  counts.ran++;
  counts.words += results.filter((r) => r.fields).length;
  counts.unknown += results.filter((r) => !r.fields).length;
  const out: string[] = [];
  const split = runs.map(splitTargets);
  const argvs = split.map((s) => s.argv);
  if (results.every((r) => r.fields)) {
    const fields = results.flatMap((r) => r.fields!);
    const other = argvs.find((a) => JSON.stringify(a) !== JSON.stringify(fields));
    if (other) out.push(`model: ${JSON.stringify(fields)}, bash: ${JSON.stringify(other)}`);
  } else {
    const { head, tail, fits } = alignRuns(results, argvs);
    if (!fits) out.push(`model: ${JSON.stringify(head)}…${JSON.stringify(tail)}, bash: ${JSON.stringify(argvs)}`);
  }
  targets.forEach((t, i) => {
    const got = split.map((s) => s.targets[i]);
    if (t.error ? got.some((g) => g.length === 1) : t.fields && got.some((g) => JSON.stringify(g) !== JSON.stringify(t.fields))) {
      out.push(`model: ${m.targets[i].text} is ${t.error ?? JSON.stringify(t.fields)}, bash: ${JSON.stringify(got)}`);
    }
  });
  return out;
}

/** Runs each input in each environment, in one batch, and compares: the differences, the commands that escaped, the counts. */
export async function checkArgv(inputs: readonly ArgvInput[]): Promise<{ found: ArgvFinding[]; escaped: string[]; counts: Record<ArgvEnvName, ArgvCounts> }> {
  const plans = inputs.flatMap((input) => {
    const inst = instrumentArgv(input.tree, input.model);
    return ARGV_ENVS.map((env) => ({ input, inst, env, ...argvJob(input, inst.script, env) }));
  });
  const runs = await runArgvBatch(plans.map((p) => p.job));
  const counts = Object.fromEntries(ARGV_ENVS.map((e) => [e, { commands: 0, ran: 0, words: 0, unknown: 0, failing: 0 }])) as Record<ArgvEnvName, ArgvCounts>;
  const found: ArgvFinding[] = [];
  const escaped: string[] = [];
  plans.forEach((p, i) => {
    const run = runs[i];
    escaped.push(...run.escaped.map((n) => `${p.input.name} (${p.env}): ${n}`));
    const env: WordEnv = { variables: { ...ARGV_ENV, ...p.variables }, pwd: BOX, files: FILES };
    for (const m of p.inst.markers) {
      counts[p.env].commands++;
      for (const what of compareMarker(m, p.input.model, env, run.records.get(m.id) ?? [], counts[p.env])) {
        found.push({ input: p.input.name, env: p.env, command: m.command.text, what });
      }
    }
  });
  return { found, escaped, counts };
}
