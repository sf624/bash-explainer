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
// - every file redirection is sent to /dev/null (as a duplication of a descriptor the set-up opened on it, `toNull`),
//   so that no file is read or written (and no `/dev/tcp` is opened). On a command with a marker, the target is moved
//   into the argv, between the words `@@R@@` and `@@E@@`, where bash expands it as it would have for the redirection;
//   a duplication (`2>&1`, `<&3`) and a process substitution stay as they are.
//
// `runArgvBatch` runs the scripts in one `runContained` (a cgroup when `systemd-run --user` works, a process group
// killed on a timeout), each under `timeout`, with `FUNCNEST` and `ulimit -f`, in a fresh directory holding FILES,
// stdin from /dev/null (or a file of the job's lines); the next job starts once what the job left running (a process
// substitution) has ended, or has been killed after a few seconds. A file read through BASH_ENV defines the recorders,
// then sets PATH to a directory that does not exist, defines `command_not_found_handle` to log `ESCAPED name` (a
// command that reached a PATH search, which the test fails on), and turns off with `enable -n` the builtins that reach
// outside the shell. The script then runs restricted (`bash -r`, after the set-up): no command named by a path
// (`/bin/rm`, which needs no PATH search), no change of PATH, no file opened for output, no `cd`. So a command that the
// markers missed (in text that bash reads as code at run time: an arithmetic subscript, a here-document) reaches only
// builtins.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ExplainOptions } from '../../src/analyzer';
import { extractShell, hostKind } from '../../src/hosts';
import { hostProvided } from '../../src/hosts/remap';
import { scriptTree } from '../../src/hosts/scripts';
import { fileRead } from '../../src/semantics/env';
import { resolveName } from '../../src/semantics/names';
import type { StateModel } from '../../src/semantics/state';
import { BASH_VARIABLES } from '../../src/semantics/vars';
import { wordFields, type WordEnv } from '../../src/semantics/words';
import { staticWordValue } from '../../src/staticword';
import { shellState } from '../../src/semantics/state';
import type { Shell } from '../../src/shellfeatures';
import { createUnbashParser } from '../../src/syntax/adapters/unbash';
import { descendants, field, fields, hasError, type SyntaxNode, type SyntaxTree } from '../../src/syntax/tree';
import { runContained, scoped } from './contained';
import { corpus } from './corpus';
import { fuzzInputs } from './fuzz';
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

/** The descriptors the set-up opens: the log (appended to) and /dev/null (read and write). */
const LOG_FD = 96;
const NULL_FD = 97;
/** The descriptor of the lock a job holds while it or a process it started runs (`runArgvBatch`). */
const LOCK_FD = 95;
/** How long, in seconds, the driver waits for what a job left running before it kills it. */
const LOCK_WAIT = 3;

/**
 * What stands for a file redirection to /dev/null, given its operator (with its descriptor: `2>`, `{fd}>>`, `&>`): a
 * duplication of NULL_FD, since a restricted shell opens no file for output (`>&97` is allowed, `>/dev/null` is not).
 */
export function toNull(op: string): string {
  const [, fd, o] = /^(\{\w+\}|\d*)(.*)$/.exec(op)!;
  if (o === '<' || o === '<>') return `${fd}<&${NULL_FD}`;
  if (o === '&>' || o === '&>>') return `>&${NULL_FD} 2>&${NULL_FD}`;
  return `${fd}>&${NULL_FD}`;
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
      edits.push({ start: dest.endIndex, end: dest.endIndex, text: ` ${REDIRECT_END} ${toNull(op)}` });
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
    whole.push({ start: r.startIndex, end: r.endIndex, text: ` ${toNull(tree.text.slice(r.startIndex, dest.startIndex).trimEnd())}` });
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
  return `exec ${LOG_FD}>>${L} ${NULL_FD}<>/dev/null
__probe_log() {
  builtin printf '%s\\037' "$@" $'\\036' >&${LOG_FD}
  __probe_v="__probe_n_$1"
  builtin printf -v "$__probe_v" %s "$(( \${!__probe_v:-0} + 1 ))"
  if builtin [ "\${!__probe_v}" -gt ${CAP} ]; then builtin printf 'CAPPED\\037%s\\037\\036\\037' "$1" >&${LOG_FD}; builtin exit 98; fi
}
__probe() { __probe_log "$@"; }
__probe_w() { __probe_log "$@"; builtin [ "\${!__probe_v}" -eq 1 ]; }
__probe_u() { __probe_log "$@"; builtin [ "\${!__probe_v}" -ne 1 ]; }
__probe_r() { __probe_log "$@"; builtin shift; builtin "$@"; }
command_not_found_handle() { builtin printf 'ESCAPED\\037%s\\037\\036\\037' "$1" >&${LOG_FD}; builtin exit 99; }
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
      const argv = ['--norc', '--noprofile', '-r', path.join(dir, 'script.sh'), ...(job.args ?? [])].map(quote).join(' ');
      // (The job holds a shared lock on LOCK_FD, and every process it starts inherits it. Once the job's shell has
      // ended, the driver takes the lock exclusively, so it waits for what the shell left running: a process
      // substitution, which bash does not wait for (`diff <(sort a.txt) <(sort b.txt)`, with `diff` a recorder that
      // reads neither, ended before its `sort`s had logged, now and then). What still runs after LOCK_WAIT is
      // killed: `timeout` made the job's process a group of its own.)
      const lock = quote(path.join(dir, 'lock'));
      lines.push(`(cd ${quote(box)} && flock -s ${LOCK_FD} && exec env -i ${assigns} timeout -k 2 ${perJob} ${quote(program)} ${argv}) <${quote(stdin)} >/dev/null 2>${quote(path.join(dir, 'stderr'))} ${LOCK_FD}>${lock} & wait $!; echo $? >${quote(path.join(dir, 'status'))}; flock -w ${LOCK_WAIT} ${lock} true || kill -KILL -- -$! 2>/dev/null`);
    });
    fs.writeFileSync(path.join(root, 'driver.sh'), `${lines.join('\n')}\n`);
    await runContained(['bash', '--norc', '--noprofile', path.join(root, 'driver.sh')], root, {}, (perJob + LOCK_WAIT + 3) * jobs.length * 1000);
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

/**
 * A script to check: its tree, the model the explanation builds for it, and the variables its host sets; for a host's
 * region, what the explanation of its lines is given (`explain`: the shell and the options, as src/hosts/remap.ts does).
 */
export interface ArgvInput { name: string; tree: SyntaxTree; model: StateModel; provided: readonly string[]; explain?: { shell?: Shell; opts: ExplainOptions } }

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

/**
 * A word the model gives no fields for, while bash gave it the same fields on every run in every environment: a word
 * the model could know (oracles.md, 2.3). Only in commands with one unknown word, whose fields are what lies between the
 * known head and tail; not a word with a command substitution, a process substitution or `$?`, which the recorders
 * decide (their output is empty, their status 0).
 */
export interface ArgvCandidate { input: string; command: string; word: string; fields: string[] }

/** Whether what bash gives `word` comes from the recorders: a substitution's output, or `$?`. */
const recorded = (word: SyntaxNode): boolean => descendants(word, ['command_substitution', 'process_substitution', 'special_variable_name'])
  .some((n) => n.type !== 'special_variable_name' || n.text === '?');

/** One run of an input in an environment: its instrumented script, the variables given, and what bash logged. */
export interface ArgvPlanRun { input: ArgvInput; inst: Instrumented; env: ArgvEnvName; variables: Record<string, string>; run: ArgvRun }

/** The environment the model reads for a run: the one bash ran in (ARGV_ENV and the run's variables), BOX and its files. */
export const runEnv = (p: ArgvPlanRun): WordEnv => ({ variables: { ...ARGV_ENV, ...p.variables }, pwd: BOX, files: FILES });

/** Runs each input in each environment, in `jobs` batches at once. */
export async function runArgv(inputs: readonly ArgvInput[], { jobs = 1 } = {}): Promise<ArgvPlanRun[]> {
  const plans = inputs.flatMap((input) => {
    const inst = instrumentArgv(input.tree, input.model);
    return ARGV_ENVS.map((env) => ({ input, inst, env, ...argvJob(input, inst.script, env) }));
  });
  const chunks: number[][] = Array.from({ length: Math.max(1, Math.min(jobs, plans.length)) }, () => []);
  plans.forEach((_, i) => chunks[i % chunks.length].push(i));
  const batches = await Promise.all(chunks.map((c) => runArgvBatch(c.map((i) => plans[i].job))));
  const out: ArgvPlanRun[] = [];
  chunks.forEach((c, k) => c.forEach((i, j) => { const { job: _, ...p } = plans[i]; out[i] = { ...p, run: batches[k][j] }; }));
  return out;
}

/**
 * Compares the runs of `runArgv` with the model: the differences, the commands that escaped, the counts, and the words
 * the model could know.
 */
export function checkArgv(plans: readonly ArgvPlanRun[]): { found: ArgvFinding[]; escaped: string[]; counts: Record<ArgvEnvName, ArgvCounts>; candidates: ArgvCandidate[] } {
  const counts = Object.fromEntries(ARGV_ENVS.map((e) => [e, { commands: 0, ran: 0, words: 0, unknown: 0, failing: 0 }])) as Record<ArgvEnvName, ArgvCounts>;
  const found: ArgvFinding[] = [];
  const escaped: string[] = [];
  // The fields bash gave the one unknown word of a marker, per input and marker, in each environment (`undefined`
  // once they differ).
  const middles = new Map<ArgvInput, Map<ArgvMarker, Map<ArgvEnvName, string[] | undefined>>>();
  const unknownWord = new Map<ArgvMarker, string>();
  plans.forEach((p) => {
    const { run } = p;
    escaped.push(...run.escaped.map((n) => `${p.input.name} (${p.env}): ${n}`));
    const env = runEnv(p);
    for (const m of p.inst.markers) {
      counts[p.env].commands++;
      const records = run.records.get(m.id) ?? [];
      for (const what of compareMarker(m, p.input.model, env, records, counts[p.env])) {
        found.push({ input: p.input.name, env: p.env, command: m.command.text, what });
      }
      const results = m.words.map((w) => wordFields(w, p.input.model, env));
      if (!records.length || results.filter((r) => !r.fields).length !== 1 || results.some((r) => r.error)) continue;
      const { head, tail, fits } = alignRuns(results, records.map((r) => splitTargets(r).argv));
      const word = m.words[results.findIndex((r) => !r.fields)];
      if (!fits || recorded(word)) continue;
      unknownWord.set(m, word.text);
      const got = records.map((r) => JSON.stringify(splitTargets(r).argv.slice(head.length, -tail.length || undefined)));
      const byInput = middles.get(p.input) ?? new Map<ArgvMarker, Map<ArgvEnvName, string[] | undefined>>();
      middles.set(p.input, byInput);
      const byEnv = byInput.get(m) ?? new Map<ArgvEnvName, string[] | undefined>();
      byInput.set(m, byEnv);
      byEnv.set(p.env, got.every((g) => g === got[0]) ? JSON.parse(got[0]) as string[] : undefined);
    }
  });
  const candidates: ArgvCandidate[] = [];
  for (const [input, byInput] of middles) {
    for (const [m, byEnv] of byInput) {
      const all = ARGV_ENVS.map((e) => byEnv.get(e));
      if (all.some((a) => !a) || all.some((a) => JSON.stringify(a) !== JSON.stringify(all[0]))) continue;
      candidates.push({ input: input.name, command: m.command.text, word: unknownWord.get(m)!, fields: all[0]! });
    }
  }
  return { found, escaped, counts, candidates };
}

// ---------------------------------------------------------------------------------------------------
// The inputs: the fixtures (step 2), the snippets of the tests and the fuzz inputs (step 3).

const FIXTURES = path.join(__dirname, '..', 'fixtures');

/**
 * The fixtures bash runs, each with the model the explanation reads (src/analyzer.ts, src/hosts/remap.ts): sample.sh and
 * coverage.sh; each section of sample.sh on its own (in place, the other lines blank), since `set -e` stops the whole
 * file early; and the shell code of the host fixtures that bash runs. (Not posix.sh, ksh.ksh, nor the regions of sh
 * and of bats: another shell, or bats around the script.)
 */
export function fixtureInputs(): ArgvInput[] {
  const parser = createUnbashParser();
  const out: ArgvInput[] = [];
  const add = (name: string, text: string): void => {
    const tree = parser.parse(text);
    out.push({ name, tree, model: shellState(tree, 'bash'), provided: [] });
  };
  for (const name of ['sample.sh', 'coverage.sh']) add(name, fs.readFileSync(path.join(FIXTURES, name), 'utf8'));
  const lines = fs.readFileSync(path.join(FIXTURES, 'sample.sh'), 'utf8').split('\n');
  const heads = lines.flatMap((l, i) => (/^# --- .* ---$/.test(l) ? [i] : []));
  heads.forEach((from, k) => {
    const to = heads[k + 1] ?? lines.length;
    add(`sample.sh ${lines[from]}`, lines.map((l, i) => (i >= from && i < to ? l : '')).join('\n'));
  });
  for (const file of fs.readdirSync(path.join(FIXTURES, 'hosts')).sort()) {
    const extracted = extractShell(hostKind('', file)!, fs.readFileSync(path.join(FIXTURES, 'hosts', file), 'utf8'));
    const whole = parser.parse(extracted.text);
    const seen = new Set<SyntaxTree>();
    for (const region of extracted.regions) {
      if ((region.shell ?? 'bash') !== 'bash' || region.run || region.commands) continue;
      const tree = scriptTree(whole, extracted, region);
      if (seen.has(tree)) continue;
      seen.add(tree);
      const provided = hostProvided(extracted, region);
      const model = shellState(tree, region.shell, { read: fileRead(tree.root, region.host), ...(provided.length ? { provided } : {}) });
      out.push({ name: `hosts/${file}:${region.start + 1}`, tree, model, provided, explain: { shell: region.shell, opts: { host: region.host, ...(provided.length ? { hostProvided: provided } : {}) } } });
    }
  }
  return out;
}

/** The input of a script read as bash: its tree and the model the explanation builds; none when it does not parse. */
function bashInput(name: string, text: string, parser = createUnbashParser()): ArgvInput | undefined {
  const tree = parser.parse(text);
  if (tree.errors.length || hasError(tree.root)) return undefined;
  return { name, tree, model: shellState(tree, 'bash'), provided: [] };
}

/** The sample of the snippets the test runs (test/argv.test.ts); all of them run by hand (scripts/argv-corpus.ts). */
export const SNIPPET_SAMPLE = { share: 0.19, seed: 1 };

/** A 32-bit hash of `text` with `seed` (FNV-1a), for a sample that a new snippet changes only by itself. */
function hash(text: string, seed: number): number {
  let h = (0x811c9dc5 ^ seed) >>> 0;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

/**
 * The snippets of the tests (test/fixtures/snippets.json) that parse, each a bash script named by its text; with
 * `share`, those whose hash with `seed` falls in that share (0 to 1), so that adding a snippet adds at most itself.
 */
export function snippetInputs({ share = 1, seed = 0 } = {}): ArgvInput[] {
  const parser = createUnbashParser();
  return corpus().snippets.flatMap((s) => (share >= 1 || hash(s.text, seed) / 2 ** 32 < share ? [bashInput(s.text, s.text, parser) ?? []].flat() : []));
}

/**
 * `n` of the fuzz inputs (test/support/fuzz.ts) that parse and are not snippets, chosen by their hash with `seed`. Not
 * one cut after a backslash: unbash keeps a backslash at the end of the input, which bash drops (a known difference,
 * README Limitations), and the fuzz inputs change with every snippet, too often for entries of argv-known.json.
 */
export function fuzzArgvInputs(n: number, seed = 0): ArgvInput[] {
  const snippets = new Set(corpus().snippets.map((s) => s.text));
  const texts = [...new Set(fuzzInputs())].filter((t) => !snippets.has(t) && !/(^|[^\\])(\\\\)*\\$/.test(t)).sort((a, b) => hash(a, seed) - hash(b, seed) || (a < b ? -1 : 1));
  const parser = createUnbashParser();
  const out: ArgvInput[] = [];
  for (const t of texts) {
    if (out.length >= n) break;
    const input = bashInput(t, t, parser);
    if (input) out.push(input);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// The accepted differences (test/fixtures/argv-known.json).

/** An accepted difference: the input (its name: a fixture's, or a snippet's text), the command, the environment (both when absent), why. */
export interface ArgvKnown { input: string; command: string; env?: ArgvEnvName; reason: string }

/** The known differences and the pinned counts of each set of inputs the test runs (`fixtures`, `snippets`: the sample). */
export interface ArgvKnownFile { counts: Record<string, Record<ArgvEnvName, ArgvCounts>>; known: ArgvKnown[] }

export const ARGV_KNOWN = path.join(FIXTURES, 'argv-known.json');

/**
 * The differences no entry of `known` accepts, and the entries that are stale: those of an input in `inputs` that
 * accept no difference. (Entries of inputs not run are neither.)
 */
export function matchKnown(found: readonly ArgvFinding[], known: readonly ArgvKnown[], inputs: readonly ArgvInput[]): { unexplained: string[]; stale: string[] } {
  const used = new Set<number>();
  const unexplained = found.filter((f) => {
    const k = known.findIndex((e) => e.input === f.input && e.command === f.command && (!e.env || e.env === f.env));
    if (k >= 0) used.add(k);
    return k < 0;
  }).map((f) => `${JSON.stringify(f.input)} (${f.env}): ${f.command}\n    ${f.what}`);
  const names = new Set(inputs.map((i) => i.name));
  const stale = known.filter((e, k) => names.has(e.input) && !used.has(k)).map((e) => `${JSON.stringify(e.input)}: ${e.command}`);
  return { unexplained, stale };
}
