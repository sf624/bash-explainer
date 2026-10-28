// The rewrites of the corpus run over the states of their ids (docs/design/oracles.md, 3.1, 3.3 and step 5): every
// fact of a mechanical id that sample.sh, the other fixtures and the snippets of the tests raise, its rewrites applied,
// and the original and the rewritten scripts run in bash over the states 3.1 lists for the id, with the two oracles of
// 3.3 (the meaning is kept, the hazard is gone). The states and the oracle of each id are data (`STATES`): what varies,
// and the checks made of it. test/rewrites-corpus.test.ts runs them, with the two cheap checks for every rewrite.
//
// A corpus input runs only when nothing in it, nor in its rewrite, can reach outside its directory (`unsafe`): every
// command is named by plain text with no `/`, none is one that runs code bash does not see in the tree (`eval`,
// `source`, `trap`…), none sets PATH or the other variables of `PROTECTED`, and no redirection names a file outside.
// Each run then has a readonly PATH set to a directory holding only the programs the id needs (none for most), so
// every other command is a recorder (`command_not_found_handle`, read through BASH_ENV) that prints what it was given
// and returns `$RW_FAIL` (0 when unset); `cd`, `pushd` and `popd` are recorders too, and the builtins that reach
// outside the shell are turned off. The runs are batched, one contained bash per job of runs (a cgroup and a process
// group killed on a timeout, test/support/contained.ts), each run under `timeout`.
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Analyzer } from '../../src/analyzer';
import { detectShell, type Shell } from '../../src/dialect';
import { type FactId, MESSAGES } from '../../src/messages';
import { pitfallFindings, STYLE_REWRITES, type StyleCode } from '../../src/pitfalls';
import type { Rewrite, TextEdit } from '../../src/rewrite';
import { resolveName } from '../../src/semantics/names';
import { shellState } from '../../src/semantics/state';
import { BASH_VARIABLES } from '../../src/semantics/vars';
import { staticWordValue } from '../../src/staticword';
import { createUnbashParser } from '../../src/syntax/adapters/unbash';
import { ancestor, descendants, field, fields, redirectionsOf, type SyntaxNode, type SyntaxTree } from '../../src/syntax/tree';
import { runContained, scoped } from './contained';
import { corpus } from './corpus';
import { applied } from './rewrites';

const parser = createUnbashParser();

/** The id of a fact of the catalog, or the code of a style check (src/pitfalls.ts), which test/suggestions.test.ts classifies alike. */
export type SuggestionId = FactId | StyleCode;
/** A fact or a style check found: its id, its text, and its rewrites (`Fact.rewrite`, `StyleFinding.rewrite`). */
export interface Suggestion { id: SuggestionId; text: string; rewrite?: readonly Rewrite[] }

/** The ids whose facts carry rewrites (the mechanical ids of test/suggestions.test.ts), and the style checks whose findings do. */
export const MECHANICAL: SuggestionId[] = [...(Object.keys(MESSAGES) as FactId[]).filter((id) => 'rewrite' in MESSAGES[id]),
  ...(Object.keys(STYLE_REWRITES) as StyleCode[]).filter((code) => STYLE_REWRITES[code])];
/** Whether an id is a style check's. */
export const isStyle = (id: SuggestionId): id is StyleCode => Object.hasOwn(STYLE_REWRITES, id);

// ---------------------------------------------------------------------------------------------------
// The facts of the corpus.

/** A fact of a mechanical id in the corpus: the input (its name, its text), the shell it is read as. */
export interface CorpusFact { input: string; text: string; shell?: Shell; fact: Suggestion }

/**
 * A rewrite to run: the facts of one id in one input, each with its rewrite number `alt` (or its last, when it has
 * fewer), applied together, so that what the states vary meets no other fact of the id (`cp $a b; cp $a c`: two facts).
 * `rewrite` has the edits of all and the code of the first; `codes`, the code of each. `original` is the text that runs
 * (for a fixture, the statements that hold the edits), and `script` the same with the edits made.
 */
export interface Subject { input: string; text: string; shell?: Shell; id: SuggestionId; facts: Suggestion[]; rewrite: Rewrite; codes: string[]; alt: number; original: string; script: string }

/**
 * The facts of a mechanical id in the corpus: the fixtures but the hosts (whose facts carry no rewrites, checked
 * apart), and the snippets of the tests. One for each fact and text, on whatever line it is given.
 */
export function corpusFacts(): CorpusFact[] {
  return (cached ??= findCorpusFacts());
}
let cached: CorpusFact[] | undefined;

function findCorpusFacts(): CorpusFact[] {
  const { files, snippets } = corpus();
  return [...files.filter((f) => !f.name.startsWith('hosts/')), ...snippets].flatMap(({ name, text }) => factsIn(name.startsWith('snippet ') ? text : name, text));
}

/**
 * The facts of a mechanical id in `text` (an input named `input`: a snippet is named by its text), and the style checks
 * found there whose findings carry rewrites, one for each id, text and rewrite.
 */
export function factsIn(input: string, text: string): CorpusFact[] {
  const shell = detectShell(text, input === text ? '' : input);
  const seen = new Set<string>();
  const out: CorpusFact[] = [];
  for (const fact of suggestionsIn(text, shell)) {
    if (!MECHANICAL.includes(fact.id)) continue;
    const key = `${fact.id}\0${fact.text}\0${JSON.stringify(fact.rewrite ?? null)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ input, text, shell, fact });
  }
  return out;
}

/**
 * The facts the analyzer gives on each line of `text`, read as `shell`, then the style checks found in the whole text
 * (`pitfallFindings`, with the model the analyzer reads): one for each place a check is found, with its own rewrites.
 */
function suggestionsIn(text: string, shell: Shell | undefined): Suggestion[] {
  const tree = parser.parse(text);
  const lines = text.split('\n');
  const facts = lines.flatMap((_, line) => new Analyzer('en').explainLine(tree, line, shell).facts ?? []);
  const style = pitfallFindings(tree.root, 'en', 0, lines.length, shellState(tree, shell), shell).map((f) => ({ id: f.code, text: f.text, ...(f.rewrite ? { rewrite: f.rewrite } : {}) }));
  return [...facts, ...style];
}

/**
 * The text a rewrite of a fixture runs in: the statements of the file that hold its edits, alone, the others blanked
 * with spaces so that the offsets stay. (The sections of sample.sh run commands that may not run here: a redirection
 * to /etc, `trap`. A snippet runs whole.)
 */
function runText(f: CorpusFact, edits: readonly TextEdit[]): string {
  if (f.input === f.text) return f.text;
  const keep = parser.parse(f.text).root.namedChildren.filter((c) => edits.some((e) => c.startIndex <= e.start && e.start <= c.endIndex));
  return [...f.text].map((ch, i) => (ch === '\n' || keep.some((c) => c.startIndex <= i && i < c.endIndex) ? ch : ' ')).join('');
}

/** Every rewrite of each corpus fact alone: the subjects of the cheap checks. */
export function singles(facts: readonly CorpusFact[]): Subject[] {
  return facts.flatMap((f) => (f.fact.rewrite ?? []).map((rewrite, alt) => subject([f], [rewrite], alt)));
}

/**
 * The subjects of the state oracles: for each input and id, the rewrites of its facts applied together (see `Subject`);
 * each fact alone where the edits of two would overlap.
 */
export function subjects(facts: readonly CorpusFact[]): Subject[] {
  const groups = new Map<string, CorpusFact[]>();
  for (const f of facts) if (f.fact.rewrite) groups.set(`${f.input}\0${f.fact.id}`, [...(groups.get(`${f.input}\0${f.fact.id}`) ?? []), f]);
  return [...groups.values()].flatMap((group) => {
    const edits = group.flatMap((f) => f.fact.rewrite![0].edits).sort((a, b) => a.start - b.start);
    const overlap = edits.some((e, i) => i > 0 && e.start < edits[i - 1].end);
    if (overlap) return group.flatMap((f) => f.fact.rewrite!.map((r, alt) => subject([f], [r], alt)));
    const alts = Math.max(...group.map((f) => f.fact.rewrite!.length));
    return Array.from({ length: alts }, (_, alt) => subject(group, group.map((f) => f.fact.rewrite![Math.min(alt, f.fact.rewrite!.length - 1)]), alt));
  });
}

function subject(group: readonly CorpusFact[], rewrites: readonly Rewrite[], alt: number): Subject {
  const [f] = group;
  const rewrite = { code: rewrites[0].code, edits: rewrites.flatMap((r) => r.edits) };
  const original = runText(f, rewrite.edits);
  return { input: f.input, text: f.text, shell: f.shell, id: f.fact.id, facts: group.map((g) => g.fact), rewrite, codes: rewrites.map((r) => r.code), alt, original, script: applied(original, rewrite) };
}

// ---------------------------------------------------------------------------------------------------
// What may run.

// The walls are of two kinds. At run time (`setup`, `runJobs`): PATH is readonly and holds only the programs a job
// names, and those that run another program are wrappers that refuse what would leave the box (`bash` only as
// `bash -c STRING`, `env` with no option, no variable of `PROTECTED` and no command named by a path); the recorders
// are readonly functions; the builtins that would act outside (`cd` too, which `command cd` would reach past its
// function) are turned off, so that a command of their name is a recorder. Before the run (`unsafe`), what those
// walls cannot see: a command named by a path or an expansion, code the tree does not show, a redirection to a file
// outside the directory. The corpus is ours: the walls are against a line that would act outside as written, not
// against code assembled on purpose to escape (bytes built with `printf` and run as an arithmetic subscript).

/** Commands that run code the tree does not show, change how names are found, write files, or reach other processes. */
const DENIED: ReadonlySet<string> = new Set(['source', '.', 'eval', 'exec', 'trap', 'kill', 'enable', 'hash', 'alias', 'fc', 'builtin', 'ulimit', 'umask',
  'wait', 'disown', 'suspend', 'coproc', 'complete', 'compgen', 'compopt', 'bind', 'history']);
/** The recorders that stand for builtins: functions, which `command` and `builtin` would reach past. */
const RECORDERS = ['cd', 'pushd', 'popd'];
/**
 * The builtins the set-up turns off, after it has used them: a command of their name then finds the recorder of
 * `command_not_found_handle` (`command cd`, `exec x`). (`source` and `.` stay: the modes that source the script use
 * them; `unsafe` refuses them in the script.)
 */
const TURNED_OFF = [...RECORDERS, ...[...DENIED].filter((n) => !['source', '.', 'builtin', 'enable', 'coproc'].includes(n))];
/**
 * Variables a script may not set, which the set-up makes readonly too: those that find commands (PATH, BASH_CMDS as
 * `hash -p` does, BASH_ALIASES), are read by a new bash (BASH_ENV, ENV; POSIXLY_CORRECT, which starts it in posix
 * mode, where it reads no BASH_ENV), hold code bash runs later (PS4 under `set -x`, PROMPT_COMMAND), name a file bash
 * writes (HISTFILE) or where it loads builtins from. (`set -o posix` sets POSIXLY_CORRECT too, which `set -a` would
 * export: readonly, it stays unset.)
 */
const PROTECTED = ['PATH', 'BASH_ENV', 'ENV', 'POSIXLY_CORRECT', 'BASH_CMDS', 'BASH_ALIASES', 'PS4', 'PROMPT_COMMAND', 'HISTFILE', 'BASH_LOADABLES_PATH'];
/**
 * Variables a script may not export: a new bash takes its options from them (SHELLOPTS, BASHOPTS), and in posix or
 * privileged mode it reads no BASH_ENV. (Both are readonly; `export` and `declare -x` still export them.)
 */
const OPTION_VARS = /^(SHELLOPTS|BASHOPTS)$/;
/** A word that names one of them (`PATH`, `PATH=…`, `BASH_CMDS[x]=…`), or, given to `env`, a variable that changes how a program runs. */
const PROTECTED_NAME = new RegExp(`^(${PROTECTED.join('|')})(\\[|\\+?=|$)`);
const ENV_GLOBS = [...PROTECTED, 'SHELLOPTS', 'BASHOPTS', 'GCONV_PATH'].map((n) => `${n}=*`).concat('LD_*', 'BASH_FUNC_*');
const ENV_PROTECTED = new RegExp(`^(${ENV_GLOBS.map((g) => g.replace(/\*/g, '.*')).join('|')})`, 's');
/** Commands whose operands name variables they set. */
const SETTERS: ReadonlySet<string> = new Set(['declare', 'typeset', 'local', 'export', 'readonly', 'read', 'mapfile', 'readarray', 'getopts', 'unset', 'let']);
/** Shells: on PATH only as the wrapper of `bash -c STRING`. */
const SHELLS: ReadonlySet<string> = new Set(['bash', 'sh', 'dash', 'ksh', 'mksh', 'zsh', 'rbash']);
/** The programs a job may put on PATH: those that run no other program, and the wrappers of `setup`. */
const PROGRAMS: ReadonlySet<string> = new Set(['bash', 'env', 'echo', 'printf']);
/** Files outside the run's directory a redirection may name. */
const DEVICES = /^\/dev\/(null|stdin|stdout|stderr|fd\/\d+)$/;
/** Text that is code where bash reads a value as code (an arithmetic subscript, `${x@P}`, PS4): `$( )`, backquotes, `<( )`. */
const CODE = /\$\(|`|[<>]\(/;

/** Why the script of `tree` may not run here, or undefined when it may (see the top of this file and above). */
export function unsafe(tree: SyntaxTree, depth = 0): string | undefined {
  if (tree.errors.length) return 'it does not parse';
  // (The strings `bash -c` runs, checked as scripts of their own: their text is code, not data.)
  const scripts = new Set<SyntaxNode>();
  for (const n of descendants(tree.root, ['function_definition'])) {
    const name = field(n, 'name')?.text ?? n.namedChildren[0]?.text;
    if (name && [...RECORDERS, 'command_not_found_handle', 'command', 'builtin'].includes(name)) return `a function \`${name}\`, which would replace a recorder`;
  }
  for (const c of descendants(tree.root, ['command'])) {
    const why = commandWhy(c, depth, scripts);
    if (why) return why;
  }
  // (A function defined after \`set -a\` is exported, and a new bash defines it before it reads its set-up.)
  if (turnsOn(tree, 'a', 'allexport') && descendants(tree.root, ['function_definition']).length) return '`set -a` with a function definition, which would export it (a new bash defines it before its set-up runs)';
  if (turnsOn(tree, 'a', 'allexport') && turnsOn(tree, undefined, 'posix')) return '`set -o posix` with `set -a`, which would export POSIXLY_CORRECT (a new bash in posix mode reads no BASH_ENV)';
  for (const n of descendants(tree.root, ['variable_assignment'])) {
    const name = /^[A-Za-z_]\w*/.exec(n.text)?.[0];
    if (name && PROTECTED_NAME.test(n.text)) return `an assignment to \`${name}\``;
  }
  if (/\/dev\/(tcp|udp)\//.test(tree.root.text)) return 'bash\'s `/dev/tcp/…`, which reaches the network';
  if (descendants(tree.root, ['coproc_statement']).length || hasBackground(tree.root)) return 'a command in the background, which may outlive the run';
  for (const r of descendants(tree.root, ['file_redirect'])) {
    const why = redirectWhy(r);
    if (why) return why;
  }
  for (const n of descendants(tree.root, ['expansion'])) if (/@P\}$/.test(n.text)) return '`${x@P}`, which runs the code of a value';
  for (const n of descendants(tree.root, ['raw_string', 'ansi_c_string', 'string_content', 'word', 'heredoc_body'])) {
    if ([...scripts].some((s) => s.startIndex <= n.startIndex && n.endIndex <= s.endIndex)) continue;
    // (The text of the node but its expansions, as bash reads it: `\$\(` is `$(`, and `$'\x60'` a backquote.)
    let own = n.text;
    for (const c of [...n.namedChildren].reverse()) own = own.slice(0, c.startIndex - n.startIndex) + ' ' + own.slice(c.endIndex - n.startIndex);
    const value = n.type === 'ansi_c_string' || n.type === 'word' ? staticWordValue(n, true) ?? '' : '';
    if (CODE.test(own.replace(/\\(.)/gs, '$1')) || CODE.test(value)) return 'code in a string, which bash may run as a value';
  }
  return undefined;
}

/** Whether a `set` (or `shopt -o`) of the script turns on the option of `letter` or `long` (`set -ea`, `set -o allexport`). */
function turnsOn(tree: SyntaxTree, letter: string | undefined, long: string): boolean {
  return descendants(tree.root, ['command']).some((c) => {
    const nameNode = field(c, 'name');
    if (!nameNode) return false;
    const ws = [nameNode.namedChildren[0] ?? nameNode, ...c.namedChildren.filter((w) => w !== nameNode && w.type !== 'variable_assignment' && !w.type.endsWith('_redirect'))]
      .map((w) => staticWordValue(w) ?? w.text);
    const flags = ws.slice(1).filter((w) => /^-\w/.test(w)).join('');
    if (ws[0] === 'shopt') return /s/.test(flags) && /o/.test(flags) && ws.includes(long);
    return ws[0] === 'set' && ((letter !== undefined && flags.includes(letter)) || ws.some((w, i) => /^-\w*o$/.test(ws[i - 1] ?? '') && w === long));
  });
}

/** Whether a command under `n` runs in the background (`a &`). */
const hasBackground = (n: SyntaxNode): boolean => n.children.some((c) => (!c.named && c.type === '&') || hasBackground(c));

/** Why a command may not run here: its name, its words, and, for a command that runs another, that one too. */
function commandWhy(c: SyntaxNode, depth: number, scripts: Set<SyntaxNode>): string | undefined {
  const nameNode = field(c, 'name');
  if (!nameNode) return undefined;
  const words = [nameNode.namedChildren[0] ?? nameNode, ...c.namedChildren.filter((w) => w !== nameNode && w.type !== 'variable_assignment' && !w.type.endsWith('_redirect'))];
  // (After the name, the words that set variables: `declare PATH=…`, `read PATH`, `printf -v PATH`.)
  const name = staticWordValue(words[0]);
  if (name !== undefined && (SETTERS.has(name) || name === 'printf')) {
    const named = name === 'printf' ? words.filter((_, i) => i > 0 && words[i - 1].text === '-v') : words.slice(1);
    const bad = named.map((w) => staticWordValue(w, true) ?? w.text).find((t) => PROTECTED_NAME.test(t));
    if (bad) return `\`${name}\` of \`${/^\w+/.exec(bad)![0]}\``;
    const exported = name === 'export' || words.some((w) => /^-\w*x/.test(w.text));
    if (name !== 'printf' && exported && words.some((w) => /^-\w*f/.test(w.text))) return 'an exported function, which a new bash would run before its set-up';
    const options = exported ? named.map((w) => staticWordValue(w, true) ?? w.text).find((t) => OPTION_VARS.test(t.replace(/=.*/s, ''))) : undefined;
    if (name !== 'printf' && options) return `\`${name}\` of \`${options.replace(/=.*/s, '')}\`, which a new bash takes its options from (in posix mode it reads no BASH_ENV)`;
  }
  return wordsWhy(words, depth, scripts);
}

/** Why the command of `words` (its name first) may not run here. */
function wordsWhy(words: readonly SyntaxNode[], depth: number, scripts: Set<SyntaxNode>): string | undefined {
  const values = words.map((w) => staticWordValue(w));
  const [name] = values;
  if (name === undefined) return 'a command named by an expansion';
  if (name.includes('/')) return 'a command named by a path';
  if (DENIED.has(name)) return `\`${name}\``;
  if ((name === 'mapfile' || name === 'readarray') && words.some((w) => /^-\w*C/.test(w.text))) return `\`${name} -C\`, which runs a string`;
  // (The commands that run their operand: the words before it must be text, and the command they run is checked as one.)
  const rest = (from: number): string | undefined => (from < words.length ? wordsWhy(words.slice(from), depth, scripts) : undefined);
  const plain = `\`${name}\` with a word that is not plain text`;
  if (name === 'command') {
    let i = 1;
    for (; i < words.length && values[i]?.startsWith('-'); i++) if (/p/.test(values[i]!)) return '`command -p`, which searches a PATH of its own';
    if (i < words.length && RECORDERS.includes(values[i]!)) return `\`command ${values[i]}\`, which passes the recorder`;
    return values[i] === undefined && i < words.length ? plain : rest(i);
  }
  if (name === 'env' || name === 'sudo') {
    // (`sudo` is a stand-in that runs `env "$@"`.)
    let i = 1;
    for (; i < words.length && (values[i] === undefined || values[i]!.startsWith('-') || values[i]!.includes('=')); i++) {
      if (values[i] === undefined) return plain;
      if (values[i]!.startsWith('-')) return `\`${name}\` with an option`;
      if (ENV_PROTECTED.test(values[i]!)) return `\`${name}\` given \`${values[i]!.replace(/=.*/s, '=')}\``;
    }
    return rest(i);
  }
  if (SHELLS.has(name)) {
    const script = values[2];
    if (values[1] !== '-c' || script === undefined || /^[-+]/.test(script)) return `\`${name}\` other than \`bash -c STRING\``;
    if (depth > 3) return 'shells in shells';
    scripts.add(words[2]);
    const why = unsafe(parser.parse(script), depth + 1);
    return why && `in \`${name} -c\`: ${why}`;
  }
  return undefined;
}

/** Why a redirection may not run here: its target is not text, or names a file outside the directory. */
function redirectWhy(r: SyntaxNode): string | undefined {
  const dest = field(r, 'destination') ?? r.namedChildren.find((c) => c.type !== 'file_descriptor');
  const op = r.children.find((c) => !c.named)?.type ?? '';
  // (`2>&1`, `>&-`: a descriptor, not a file.)
  if (dest && /&$/.test(op) && /^(\d+|-)$/.test(dest.text)) return undefined;
  const target = dest && staticWordValue(dest);
  // (A file read with `<` changes nothing, wherever it is: its name may come from the state, `cat < "$f"`. Not with
  // `<>`, which creates the file, nor bash's own `/dev/tcp/…`, which `unsafe` refuses in any text.)
  if (target === undefined) return op === '<' ? undefined : 'a redirection to a word that is not plain text';
  if (DEVICES.test(target)) return undefined;
  if (!target || target.startsWith('/') || target.split('/').includes('..')) return 'a redirection outside the directory';
  return undefined;
}

// ---------------------------------------------------------------------------------------------------
// The runs.

/** A run: the script, how it is read, and its state (see `STATES`). */
export interface Job {
  script: string;
  /** Run as a file (the default), checked with `bash -n`, sourced at the top level, or sourced inside a function. */
  mode?: 'run' | 'syntax' | 'source' | 'source-in-function';
  /** Variables of the environment (on top of the run's own). */
  env?: Record<string, string>;
  args?: readonly string[];
  /** Files in the run's directory; a name that ends with `/` is a directory. */
  files?: readonly string[];
  stdin?: string;
  /** Code run before the script, in its shell (the end of the set-up): `set -e`, `shopt -s nullglob`, `a[1]=1`. */
  prelude?: string;
  /** Code appended to the script, on a line of its own: what the check reads (`echo "@st=$?"`). */
  epilogue?: string;
  /** The programs on PATH: names of /usr/bin or /bin, or `bash`, the bash of the run. */
  programs?: readonly string[];
}

/** What a run printed (both streams normalized: the run's directory, line numbers, the times of `time`), and its status. */
export interface Ran { out: string; err: string; status: number | null }

const quote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

/**
 * The text read through BASH_ENV: the recorders, the walls, then the job's prelude. Each builtin it runs is called
 * through `builtin`: a function that a new bash imports from its environment, defined before it reads this, would
 * take the name of one (`set -a; enable() { :; }; bash -c …`), and `unsafe` refuses a function named `builtin`.
 */
function setup(prelude = ''): string {
  return `command_not_found_handle() { builtin printf '@%s' "$1"; builtin shift; (( $# )) && builtin printf ' <%s>' "$@"; builtin echo; builtin return "\${RW_FAIL:-0}"; }
cd() { builtin printf '@cd'; (( $# )) && builtin printf ' <%s>' "$@"; builtin echo; }
pushd() { cd "$@"; }
popd() { cd "$@"; }
builtin readonly -f command_not_found_handle ${RECORDERS.join(' ')}
builtin readonly ${PROTECTED.join(' ')}
builtin ulimit -f 20000
builtin enable -n ${TURNED_OFF.join(' ')}
builtin enable -n enable
${prelude}
`;
}

/**
 * The programs of PATH that run another one, as wrappers: \`bash\` only as \`bash -c STRING [ARG…]\` (so that the new
 * bash reads the set-up: not \`-i\`, \`-p\`, \`-o posix\` or \`--posix\`, which skip it), and \`env\` with no option
 * (\`-i\`, \`-u PATH\`, \`-S\` and \`-C DIR\` would leave the walls), no variable of \`PROTECTED\` and no command named by
 * a path. They run in bash's privileged mode, which reads no BASH_ENV, and keep the name of the program for its
 * messages. Both export PATH and BASH_ENV again (\`export -n PATH\`, which readonly allows, would give a new program
 * the default PATH, and a new bash no set-up) and unset POSIXLY_CORRECT (posix mode); \`bash\` refuses an exported
 * SHELLOPTS or BASHOPTS, which would bring posix mode, or the privileged mode of the wrapper itself.
 */
function wrapper(p: 'bash' | 'env', real: string, bin: string, setupFile: string): string {
  const refuse = `{ builtin echo "@${p} refused: $*" >&2; builtin exit 126; }`;
  const check = p === 'bash' ? `[[ \${SHELLOPTS@a} != *x* && \${BASHOPTS@a} != *x* ]] || ${refuse}\n[[ $1 == -c && $# -ge 2 && $2 != [-+]* ]] || ${refuse}`
    : `for a; do\n  case $a in\n    -*|${ENV_GLOBS.join('|')}) ${refuse} ;;\n    *=*) continue ;;\n    */*) ${refuse} ;;\n  esac\n  break\ndone`;
  const reset = `builtin unset POSIXLY_CORRECT\nbuiltin export PATH=${quote(bin)} BASH_ENV=${quote(setupFile)}`;
  return `#!${real} -p\n${reset}\n${check}\nbuiltin exec -a ${p} ${quote(p === 'bash' ? real : REAL_ENV)} "$@"\n`;
}
const REAL_ENV = ['/usr/bin/env', '/bin/env'].find((f) => fs.existsSync(f))!;

/** Runs the jobs with bash `program`, `jobs` contained batches at once. */
export async function runJobs(bash: string, list: readonly Job[], { jobs = 4, perRun = 5 } = {}): Promise<Ran[]> {
  // (By its path: PATH is the run's own.)
  const program = bash.includes('/') ? bash : spawnSync('bash', ['-c', 'command -v "$1"', '_', bash], { encoding: 'utf8' }).stdout.trim();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'explain-bash-rewrite-states-'));
  try {
    const lines = list.map((job, i) => {
      const dir = path.join(root, String(i));
      const box = path.join(dir, 'box');
      const bin = path.join(dir, 'bin');
      fs.mkdirSync(box, { recursive: true });
      fs.mkdirSync(bin);
      for (const p of job.programs ?? []) {
        if (!PROGRAMS.has(p)) throw new Error(`\`${p}\` may not be on the PATH of a run (rewrite-states.ts, PROGRAMS)`);
        if (p === 'bash' || p === 'env') {
          fs.writeFileSync(path.join(bin, p), wrapper(p, program, bin, path.join(dir, 'setup.sh')), { mode: 0o755 });
          continue;
        }
        fs.symlinkSync(['/usr/bin', '/bin'].map((d) => path.join(d, p)).find((f) => fs.existsSync(f))!, path.join(bin, p));
      }
      for (const f of job.files ?? []) {
        const at = path.join(box, f);
        fs.mkdirSync(f.endsWith('/') ? at : path.dirname(at), { recursive: true });
        if (!f.endsWith('/')) fs.writeFileSync(at, '');
      }
      fs.writeFileSync(path.join(dir, 'f.sh'), job.epilogue === undefined ? job.script : `${job.script}\n${job.epilogue}\n`);
      fs.writeFileSync(path.join(dir, 'setup.sh'), setup(job.prelude));
      fs.writeFileSync(path.join(dir, 'stdin'), job.stdin ?? '');
      const env = { PATH: bin, HOME: box, LC_ALL: 'C', FUNCNEST: '100', BASH_ENV: path.join(dir, 'setup.sh'), ...job.env };
      const assigns = Object.entries(env).map(([k, v]) => quote(`${k}=${v}`)).join(' ');
      const args = (job.args ?? []).map(quote).join(' ');
      const mode = job.mode ?? 'run';
      const argv = mode === 'syntax' ? `-n ../f.sh`
        : mode === 'run' ? `../f.sh ${args}`
          : `-c ${quote(mode === 'source' ? '. ../f.sh; echo "@in=$?"' : 'g2() { . ../f.sh; echo "@in-g=$?"; }; g2; echo "@after-g=$?"')} bash ${args}`;
      return `(cd ${quote(box)} && exec timeout -k 1 ${perRun} env -i ${mode === 'syntax' ? `PATH=${quote(bin)}` : assigns} ${quote(program)} --norc --noprofile ${argv}) <${quote(path.join(dir, 'stdin'))} >${quote(path.join(dir, 'out'))} 2>${quote(path.join(dir, 'err'))}; echo $? >${quote(path.join(dir, 'status'))}`;
    });
    // (Without a cgroup, limits of the driver's own, as test/support/argv.ts sets them.)
    const head = ['ulimit -f 20000', ...(scoped ? [] : ['ulimit -v 3000000', 'ulimit -u $(( $(ps -L -U "$(id -u)" --no-headers | wc -l) + 500 ))'])];
    const size = Math.ceil(lines.length / jobs);
    const batches = Array.from({ length: Math.ceil(lines.length / size) }, (_, k) => lines.slice(k * size, (k + 1) * size));
    await Promise.all(batches.map((b, k) => {
      const driver = path.join(root, `driver${k}.sh`);
      fs.writeFileSync(driver, `${[...head, ...b].join('\n')}\n`);
      return runContained(['bash', '--norc', '--noprofile', driver], root, {}, (perRun + 2) * b.length * 1000);
    }));
    return list.map((_, i) => {
      const dir = path.join(root, String(i));
      const read = (f: string): string => fs.readFileSync(path.join(dir, f), 'utf8').split(path.join(dir, 'box')).join('BOX').split(dir).join('DIR')
        .replace(/line \d+:/g, 'line N:').replace(/^(real|user|sys)\s+[\d.]+\n/gm, '');
      const status = fs.existsSync(path.join(dir, 'status')) ? Number(fs.readFileSync(path.join(dir, 'status'), 'utf8')) : null;
      return { out: read('out'), err: read('err'), status };
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------------------------------
// The states and the oracles of each id.

/** A check: runs, and what must hold of them (a failure says what does not; undefined when it holds). */
export interface Check { state: string; runs: Job[]; verify: (r: readonly Ran[]) => string | undefined }

/** The states of an id and its oracle: the checks for a subject, or why its states do not apply to it. */
export interface IdStates {
  /** The states 3.1 lists, in words (what the checks vary). */
  states: string;
  /** Why a rewrite may bring another fact of the id to light, if it may (`set -u`: bash stops at the first unset name). */
  uncovers?: string;
  /**
   * Why the original may be one bash does not parse, if it may (a group never closed): its subjects run all the same,
   * and the checks run only the rewrite and a reference, never the original.
   */
  broken?: string;
  checks: (s: Subject, x: Context) => Check[] | string;
}

/** What the oracles read of a subject: the trees of the original and of the rewrite, and the variables they read. */
export interface Context {
  tree: SyntaxTree;
  /** The variables the rewrite is about: those expanded in the text its edits replace. */
  vars: string[];
  /** The other variables the script reads (not bash's own): they get a plain value, `w`. */
  others: Record<string, string>;
  /** The variables the script assigns (then a value from the environment does not reach the rewrite). */
  assigned: ReadonlySet<string>;
  /** The edited node: the innermost one that holds the first edit. */
  at: SyntaxNode;
}

/** The context of a subject. */
export function contextOf(s: Subject): Context {
  const tree = parser.parse(s.original);
  const model = shellState(tree, 'bash');
  const [first] = s.rewrite.edits;
  const inEdits = (n: SyntaxNode): boolean => s.rewrite.edits.some((e) => e.start <= n.startIndex && n.endIndex <= e.end && e.start < e.end);
  const named = descendants(tree.root, ['variable_name', 'special_variable_name']);
  const vars = [...new Set(named.filter(inEdits).map((n) => n.text))];
  const read = [...new Set(named.filter((n) => n.type === 'variable_name' && /^[A-Za-z_]\w*$/.test(n.text)).map((n) => n.text))]
    .filter((n) => !vars.includes(n) && !(n in BASH_VARIABLES) && !/^(PATH|HOME|IFS|LC_\w+|LANG)$/.test(n));
  return { tree, vars, others: Object.fromEntries(read.map((n) => [n, 'w'])), assigned: model.assigned, at: innermost(tree, first.start) };
}

/** The innermost node of `tree` that holds the offset `at`. */
function innermost(tree: SyntaxTree, at: number): SyntaxNode {
  let n = tree.root;
  for (;;) {
    const deeper = n.children.find((c) => c.startIndex <= at && at < c.endIndex);
    if (!deeper) return n;
    n = deeper;
  }
}

/** The original with the state `job` (but its script), and the rewrite with the state `rjob` (the same when absent). */
const pair = (s: Subject, job: Omit<Job, 'script'>, rjob: Omit<Job, 'script'> = job): [Job, Job] => [{ ...job, script: s.original }, { ...rjob, script: s.script }];
/** `text` with each `from` replaced by its `to`. */
const mapped = (text: string, map: readonly (readonly [string, string])[]): string => map.reduce((t, [from, to]) => t.split(from).join(to), text);
/** Whether two runs printed the same and ended with the same status, the first mapped. */
function same(a: Ran, b: Ran, map: readonly (readonly [string, string])[] = []): string | undefined {
  const want = { out: mapped(a.out, map), err: mapped(a.err, map), status: a.status };
  const got = { out: b.out, err: b.err, status: b.status };
  return JSON.stringify(want) === JSON.stringify(got) ? undefined : `expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`;
}
/** A check that the rewrite in state `rjob` does what the original does in state `job`, its output mapped. */
const keeps = (state: string, s: Subject, job: Omit<Job, 'script'>, rjob: Omit<Job, 'script'>, map: readonly (readonly [string, string])[] = []): Check =>
  ({ state, runs: pair(s, job, rjob), verify: ([o, r]) => same(o, r, map) });
/** A check of the rewrite's run alone. */
const holds = (state: string, s: Subject, job: Omit<Job, 'script'>, test: (r: Ran) => string | undefined): Check => ({ state, runs: [{ ...job, script: s.script }], verify: ([r]) => test(r) });
/** The value of `@key=` the epilogue printed. */
const said = (r: Ran, key: string): string | undefined => new RegExp(`^@${key}=(.*)$`, 'm').exec(r.out)?.[1];
/** Whether `n` is the last statement of the script (nothing but blanks and comments after it). */
const last = (s: Subject, n: SyntaxNode): boolean => !s.original.slice(n.endIndex).replace(/#.*$/gm, '').trim();
/** The statement `n` is part of, at the level of its list (the whole of `a && b`, of `a | b`). */
function statementOf(n: SyntaxNode): SyntaxNode {
  let top = n;
  while (top.parent && ['list', 'pipeline', 'redirected_statement', 'negated_command'].includes(top.parent.type)) top = top.parent;
  return top;
}
/** The functions the script defines at its top level and never calls: the epilogue calls them, so that their bodies run. */
function uncalled(tree: SyntaxTree): string[] {
  const names = tree.root.namedChildren.filter((c) => c.type === 'function_definition').map((c) => field(c, 'name')!.text);
  const called = new Set(descendants(tree.root, ['command']).map((c) => field(c, 'name')?.text));
  return names.filter((n) => !called.has(n));
}
/** Why the variables of the rewrite take no value from the state, if they do not: the script sets one. */
const setBy = (x: Context): string | undefined => {
  const v = x.vars.find((n) => x.assigned.has(n));
  return v === undefined ? undefined : `the script sets \`${v}\``;
};
/** The messages of `[` and `test` on a word split or lost. */
const TEST_ERRORS = /unary operator expected|binary operator expected|too many arguments|argument expected/;
/** What the recorder of a command prints when it fails: the run's state for `RW_FAIL`. */
const FAIL = { RW_FAIL: '1' };

/** Whether the last command of `$( )` in `n` is one the state decides (a recorder), always fails (`false`), or neither. */
function substitutionStatus(n: SyntaxNode, tree: SyntaxTree): 'state' | 'fails' | undefined {
  const model = shellState(tree, 'bash');
  const subs = descendants(n, ['command_substitution']);
  const kinds = subs.map((sub) => {
    const cmds = descendants(sub, ['command']);
    const name = cmds.length ? field(cmds[cmds.length - 1], 'name') : undefined;
    const text = name && staticWordValue(name.namedChildren[0] ?? name);
    if (text === 'false') return 'fails';
    if (!text) return undefined;
    const res = resolveName(model, text, name, { command: true });
    return res.kind === 'file' ? 'state' : undefined;
  });
  return kinds.length && kinds.every((k) => k === kinds[0]) ? kinds[0] : undefined;
}

/** Strings for `=~`: matches and not, for the regexes of the corpus and of test/rewrites-misc.test.ts. */
const STRINGS = ['a foo', 'foo', 'bfoo', 'foobar', 'xfoo', 'a b', 'asb', 'ab', '123', 'ddd', 'a 1', '1a'];

export const STATES: Record<SuggestionId, IdStates | undefined> = Object.fromEntries(MECHANICAL.map((id) => [id, undefined])) as Record<SuggestionId, IdStates | undefined>;
Object.assign(STATES, {
  'unquoted-variable-as-path': {
    states: 'values with a space, a `*`, empty (not where the word is a glob: `/*` is another note; nor where the script tests the variable, `[ -n "$D" ] || exit 1`, which an empty value takes elsewhere); files present and absent',
    checks: (s, x) => {
      if (!x.vars.length) return 'no variable in the word';
      const why = setBy(x);
      if (why) return why;
      const glob = s.codes.some((c) => /[*?[]/.test(c.replace(/"[^"]*"/g, '')));
      const tested = descendants(x.tree.root, ['command', 'extended_test']).some((c) => (c.type === 'extended_test' || ['[', 'test'].includes(field(c, 'name')?.text ?? '')) && varsIn(c).some((v) => x.vars.includes(v)));
      const values = ['a b', '*', ...(glob || tested ? [] : [''])];
      return [false, true].flatMap((present) => values.map((v) => {
        // (Files present: two in the directory, and two in a directory of each value.)
        const files = present ? ['x1', 'x2', ...['VAL', v].filter(Boolean).flatMap((d) => [`${d}/x1`, `${d}/x2`])] : [];
        const env = (value: string) => ({ ...x.others, ...Object.fromEntries(x.vars.map((n) => [n, value])) });
        return keeps(`${JSON.stringify(v)}${present ? ', files present' : ''}`, s, { env: env('VAL'), files }, { env: env(v), files }, [['VAL', v]]);
      }));
    },
  },
  'unquoted-variable-in-test': {
    states: 'empty, unset, a space, `-n`, `=`, for every unquoted variable of the test (the result: what the test gives with the value written in quotes); plain values for the meaning',
    checks: (s, x) => {
      const quiet = (r: Ran): string | undefined => (TEST_ERRORS.test(r.err) ? `the test failed: ${r.err}` : undefined);
      if (setBy(x)) return [holds('as the script sets it', s, { env: x.others }, quiet)];
      // (Every unquoted variable of the tests the edits are in varies, not only those the edits quote: a rewrite that
      // quotes `$x` alone in `[ $x = a -o $y = b ]` leaves the hazard of `$y`. Not one the script sets.)
      const words = [...new Set(s.rewrite.edits.map((e) => ancestor(innermost(x.tree, e.start), (a) => a.type === 'command')!))]
        .flatMap((c) => c.namedChildren.filter((w) => w !== field(c, 'name') && (w.type === 'simple_expansion' || w.type === 'expansion')));
      const nameOf = (w: SyntaxNode): string | undefined => w.namedChildren.find((c) => c.type === 'variable_name')?.text;
      const vary = [...new Set([...x.vars, ...words.map(nameOf).filter((n): n is string => !!n && !(n in BASH_VARIABLES) && !x.assigned.has(n))])];
      const env = (v?: string) => ({ ...x.others, ...(v === undefined ? {} : Object.fromEntries(vary.map((n) => [n, v]))) });
      // (The hazard is gone: no error, and the result the test means, that of the value as one word, which an empty
      // `[ -n $x ]` does not give, with no error. Where each of those words is a plain `$x`, and each edit quotes one,
      // the original with the value written in each in single quotes gives it; elsewhere (`${x:-d}`, `$*`), only that
      // there is no error.)
      const spots = words.filter((w) => vary.includes(nameOf(w) ?? ''));
      const plain = spots.every((w) => /^\$\{?[A-Za-z_]\w*\}?$/.test(w.text)) && s.rewrite.edits.every((e) => spots.some((w) => w.startIndex === e.start && w.endIndex === e.end));
      const epilogue = 'echo "@st=$?"';
      const meant = (v: string): Check => (plain ? {
        state: `${JSON.stringify(v)}, the result`,
        runs: [{ script: applied(s.original, { code: '', edits: spots.map((w) => ({ start: w.startIndex, end: w.endIndex, text: quote(v) })) }), env: env(v), epilogue }, { script: s.script, env: env(v), epilogue }],
        verify: ([o, r]) => quiet(r) ?? same(o, r),
      } : holds(JSON.stringify(v), s, { env: env(v) }, quiet));
      return [
        ...['y', 'VAL'].map((v) => keeps(JSON.stringify(v), s, { env: env(v) }, { env: env(v) })),
        ...['', 'a b', '-n', '='].map(meant),
        { state: 'unset as empty', runs: [{ script: s.script, env: env() }, { script: s.script, env: env('') }], verify: ([u, e]) => same(e, u) ?? quiet(u) },
      ];
    },
  },
  'for-over-unquoted-args': {
    states: 'arguments with a space, empty, a `*` (files present)',
    checks: (s, x) => {
      if (/\bset\s+--/.test(s.original)) return 'the script sets the arguments';
      const files = ['x1', 'x2'];
      // (After the script, the value the loop left: its last argument, also where the body prints nothing.)
      const loop = ancestor(x.at, (a) => a.type === 'for_statement' || a.type === 'select_statement') ?? x.at;
      const epilogue = `echo "@last=$${field(loop, 'variable')!.text}"`;
      const cases: [string[], string[]][] = [[['VAL1', 'c'], ['a b', 'c']], [['VAL2', 'c'], ['', 'c']], [['VAL3'], ['*']]];
      return cases.map(([benign, hazard]) => keeps(JSON.stringify(hazard), s, { args: benign, files, epilogue }, { args: hazard, files, epilogue }, benign.map((b, i) => [b, hazard[i]] as const)));
    },
  },
  'prefix-assignment-expanded-first': {
    states: '`v` unset, set before',
    checks: (s, x) => prefixChecks(s, x, []),
  },
  'wrapper-assignment-expanded-first': {
    states: '`v` unset, set before; `sudo` a stand-in that runs `env`',
    checks: (s, x) => {
      const cmd = ancestor(x.at, (a) => a.type === 'command') ?? x.at;
      if (field(cmd, 'name')?.text !== 'sudo' || fields(cmd, 'argument').some((a) => a.text.startsWith('-'))) return 'a wrapper other than `sudo` with no options';
      return prefixChecks(s, x, ['env', 'echo', 'printf'], 'sudo() { env "$@"; }');
    },
  },
  'declaration-masks-status': {
    states: '`$( )` fails, succeeds; with `set -e`',
    checks: (s, x) => {
      const cmd = ancestor(x.at, (a) => a.type === 'command') ?? x.at;
      const decides = substitutionStatus(cmd, x.tree);
      if (!decides) return 'the status of `$( )` does not come from the state';
      const inFunction = !!ancestor(cmd, (a) => a.type === 'function_definition');
      // (`local` outside a function: in a file that may be sourced, inside a function that sources it.)
      const mode = !inFunction && field(cmd, 'name')?.text === 'local' ? 'source-in-function' as const : 'run' as const;
      const epilogue = [...uncalled(x.tree), 'echo @next'].join('\n');
      const checks: Check[] = [];
      if (decides === 'state') for (const prelude of ['', 'set -e']) checks.push(keeps(`succeeds${prelude ? `, ${prelude}` : ''}`, s, { prelude, epilogue, mode, env: x.others }, { prelude, epilogue, mode, env: x.others }));
      // (The hazard is gone: when it fails, `set -e` stops there.)
      checks.push(holds('fails, set -e', s, { prelude: 'set -e', epilogue, mode, env: { ...x.others, ...FAIL } }, (r) => (/^@next$/m.test(r.out) || r.status === 0 ? `went on: ${JSON.stringify(r)}` : undefined)));
      return checks;
    },
  },
  'postfix-increment-status': {
    states: 'the variable 0, 1, unset; with `set -e`',
    checks: (s, x) => {
      const arith = ancestor(x.at, (a) => a.type === 'arithmetic_command') ?? descendants(statementOf(x.at), ['arithmetic_command'])[0];
      const operand = /^\(\(\s*(.+?)\s*\+\+\s*\)\)$/.exec(arith?.text ?? '')?.[1];
      if (!arith || !operand) return 'not a `((x++))` alone';
      const name = operand.replace(/\[.*$/, '');
      const shown = `\${${operand}}`;
      const lastOne = last(s, statementOf(arith));
      const epilogue = `echo "@st=$? v=${shown}"`;
      const fixed = x.assigned.has(name);
      // (The value comes before the script, unless the script sets it: then only that state.)
      const prelude = (v: string | undefined, errexit: boolean): string => [fixed ? '' : v === undefined ? `unset ${name}` : `${operand}=${v}`, errexit ? 'set -e' : ''].filter(Boolean).join('\n');
      const value = (r: Ran): string | undefined => /v=(.*)$/.exec(said(r, 'st') ?? '')?.[1];
      const checks: Check[] = [];
      for (const errexit of [false, true]) {
        // (The meaning is kept where the status was 0 already.)
        if (!fixed) checks.push(keeps(`1${errexit ? ', set -e' : ''}`, s, { prelude: prelude('1', errexit), epilogue, env: x.others }, { prelude: prelude('1', errexit), epilogue, env: x.others }));
        for (const v of fixed ? ['as the script sets it'] : ['0', 'unset']) {
          const given = v === '0' ? '0' : undefined;
          // (The hazard is gone: `set -e` goes on, the value is the one the original gives without `set -e` (when it
          // gets there), and the status is 0 where the line is last.)
          checks.push({
            state: `${v}${errexit ? ', set -e' : ''}`,
            runs: [{ script: s.original, prelude: prelude(given, false), epilogue, env: x.others }, { script: s.script, prelude: prelude(given, errexit), epilogue, env: x.others }],
            verify: ([o, r]) => {
              if (said(r, 'st') === undefined) return `stopped: ${JSON.stringify(r)}`;
              if (said(o, 'st') !== undefined && value(r) !== value(o)) return `another value: ${said(r, 'st')} for ${said(o, 'st')}`;
              return lastOne && !said(r, 'st')!.startsWith('0 ') ? `status ${said(r, 'st')}` : undefined;
            },
          });
        }
      }
      return checks;
    },
  },
  'function-last-test-returns-status': { states: 'the test true, false; with `set -e`', checks: (s, x) => lastTestChecks(s, x, true) },
  'function-last-test-stops-script': { states: 'the test true, false; with `set -e`', checks: (s, x) => lastTestChecks(s, x, true) },
  'script-last-test-returns-status': { states: 'the test true, false', checks: (s, x) => lastTestChecks(s, x, false) },
  'failure-reported-as-success': {
    states: 'the command fails, succeeds; with `set -e`; the file run, sourced, sourced in a function',
    checks: (s, x) => {
      const list = ancestor(x.at, (a) => a.type === 'list') ?? x.at;
      const left = list.namedChildren[0];
      const name = left && field(left.type === 'command' ? left : descendants(left, ['command'])[0] ?? left, 'name');
      const model = shellState(x.tree, 'bash');
      if (!name || resolveName(model, name.text, name, { command: true }).kind !== 'file') return 'the command on the left is not a program';
      const sourced = !/^#!/.test(s.original);
      const top = !ancestor(list, (a) => a.type === 'function_definition');
      const modes: NonNullable<Job['mode']>[] = ['run', ...(sourced ? ['source', 'source-in-function'] as const : [])];
      const lines = (r: Ran): string => `${r.out}${r.err}`.split('\n').filter((l) => l && !/^@(in|in-g|after-g)=/.test(l)).sort().join('\n');
      return modes.flatMap((mode) => ['', 'set -e'].flatMap((prelude) => [
        keeps(`succeeds, ${mode}${prelude ? ', set -e' : ''}`, s, { mode, prelude, env: x.others }, { mode, prelude, env: x.others }),
        {
          state: `fails, ${mode}${prelude ? ', set -e' : ''}`,
          runs: pair(s, { mode, prelude, env: { ...x.others, ...FAIL } }),
          verify: ([o, r]) => {
            // (The meaning is kept: the same messages; the hazard is gone: the status says the failure, and a shell that sources the file goes on.)
            if (lines(o) !== lines(r)) return `other messages: ${JSON.stringify(r)} for ${JSON.stringify(o)}`;
            if (!top) return undefined;
            if (mode === 'run' && r.status !== 1) return `status ${r.status}`;
            if (mode === 'source' && !prelude && said(r, 'in') !== '1') return `sourced: ${JSON.stringify(r)}`;
            if (mode === 'source-in-function' && !prelude && (said(r, 'in-g') !== '1' || said(r, 'after-g') !== '0')) return `sourced in a function: ${JSON.stringify(r)}`;
            return undefined;
          },
        } as Check,
      ]));
    },
  },
  'unmatched-glob-runs-once': {
    states: 'files that match, none (no pass of a loop with the text of a glob)',
    checks: (s, x) => {
      // (The variables of the list name the directory the files are in.)
      const env = Object.fromEntries(Object.keys(x.others).map((n) => [n, 'VAL']));
      const files = ['a.log', 'b.log', 'a.c', 'a.h', 'a.txt', 'VAL/a.log', 'VAL/b.log'];
      // (A probe: each loop prints the value of its variable last in its body, `@it=…`, which a pass that the test
      // of the name ends with `continue` does not reach.)
      const loops = descendants(x.tree.root, ['for_statement']);
      const probes = loops.flatMap((loop) => {
        const done = field(loop, 'body')?.children.at(-1);
        return done?.type === 'done' ? [{ start: done.startIndex, end: done.startIndex, text: `echo "@it=$${field(loop, 'variable')!.text}"; ` }] : [];
      });
      // (The values of the passes that nullglob removes: those of the globs that match nothing.)
      const passes = (r: Ran): string[] => [...r.out.matchAll(/^@it=(.*)$/gm)].map((m) => m[1]);
      const probed = (edits: readonly TextEdit[]): string => applied(s.original, { code: '', edits: [...edits, ...probes] });
      return [
        keeps('files that match', s, { env, files }, { env, files }),
        // (With none, the loop runs over what nullglob leaves: the words that are not globs.)
        keeps('none', s, { env, prelude: 'shopt -s nullglob' }, { env }),
        // (The hazard is gone: the original has a pass with the text of the glob, the rewrite none.)
        {
          state: 'none, the passes',
          runs: [{ script: probed([]), env }, { script: probed([]), env, prelude: 'shopt -s nullglob' }, { script: probed(s.rewrite.edits), env }],
          verify: ([o, n, r]) => {
            const globs = minus(passes(o), passes(n));
            if (!globs.length) return `no pass with a glob in the original: ${JSON.stringify(o)}`;
            const left = passes(r).filter((p) => globs.includes(p));
            return left.length ? `passes with ${JSON.stringify(left)}` : undefined;
          },
        },
      ];
    },
  },
  'regex-backslash-dropped': {
    states: 'strings that match and do not (what `grep -E` says of the regex meant)',
    checks: (s, x) => {
      const test = ancestor(x.at, (a) => a.type === 'extended_test') ?? descendants(statementOf(x.at), ['extended_test'])[0];
      const meant = /^re\w*='((?:[^']|'\\'')*)'/.exec(s.rewrite.code)?.[1].replace(/'\\''/g, "'") ?? /=~ (\S+) \]\]$/.exec(s.rewrite.code)?.[1];
      const subject = test && /^\[\[ "?\$\{?(\w+)\}?"? =~/.exec(test.text)?.[1];
      if (!test || !meant || !subject || x.assigned.has(subject) || !last(s, statementOf(test))) return 'not the last test, of a variable from the state';
      return STRINGS.map((str) => holds(JSON.stringify(str), s, { env: { ...x.others, [subject]: str }, epilogue: 'echo "@st=$?"', programs: [] }, (r) => {
        const want = grepMatches(meant, str) ? '0' : '1';
        return said(r, 'st') === want ? undefined : `status ${said(r, 'st')} for ${want} (grep -E ${JSON.stringify(meant)})`;
      }));
    },
  },
  'nounset-unbound': {
    states: 'unset, empty, set; with `set -u`',
    uncovers: 'bash stops at the first name that is not set, and the fact is about that one: with a default, it reads the next',
    checks: (s, x) => {
      const why = setBy(x);
      if (why) return why;
      const env = (v?: string) => ({ ...x.others, ...(v === undefined ? {} : Object.fromEntries(x.vars.map((n) => [n, v]))) });
      return [
        ...['', 'v'].map((v) => keeps(JSON.stringify(v), s, { env: env(v), prelude: 'set -u' }, { env: env(v), prelude: 'set -u' })),
        // (The hazard is gone: unset, it is read as empty.)
        keeps('unset', s, { env: env(''), prelude: 'set -u' }, { env: env(), prelude: 'set -u' }),
      ];
    },
  },
  'bracket-close-glued': {
    states: 'file present, absent',
    checks: (s, x) => {
      const name = /^(.*) \]$/.exec(s.rewrite.code)?.[1];
      const test = ancestor(x.at, (a) => a.type === 'command') ?? x.at;
      if (!name || !/^[\w.-]+$/.test(name)) return 'not a plain name before `]`';
      const op = /^\[\s+(-\w)\s/.exec(test.text)?.[1];
      const present = [op === '-d' ? `${name}/` : name];
      const missing = (r: Ran): string | undefined => (/missing/.test(r.err) ? `still unclosed: ${r.err}` : undefined);
      return [{
        state: 'present, absent',
        runs: [{ script: s.script, files: present, env: x.others, epilogue: 'echo "@st=$?"' }, { script: s.script, env: x.others, epilogue: 'echo "@st=$?"' }],
        verify: ([p, a]) => missing(p) ?? missing(a) ?? (op && last(s, statementOf(test)) && (said(p, 'st') !== '0' || said(a, 'st') !== '1') ? `statuses ${said(p, 'st')} and ${said(a, 'st')}` : undefined),
      }];
    },
  },
  'unbraced-element': {
    states: 'files that the original matches as a glob, none',
    checks: (s, x) => {
      // (Files of a letter and a digit, or a letter: what `$a[1]` matches as a glob, for one-letter values.)
      const files = [...'abcdefghijklmnopqrstuvwxyz'].flatMap((c) => [c, ...[...'0123456789'].map((d) => c + d)]);
      return [{
        state: 'files, none',
        runs: [{ script: s.script, files, env: x.others }, { script: s.script, env: x.others }],
        verify: ([f, n]) => same(n, f) ?? (/\[/.test(f.out) ? `the text of the subscript: ${f.out}` : undefined),
      }];
    },
  },
  'array-joined-in-assignment': {
    states: 'arguments with spaces, none',
    checks: (s, x) => {
      const assignment = ancestor(x.at, (a) => a.type === 'variable_assignment');
      const name = assignment && field(assignment, 'name')?.text;
      if (!name || ancestor(assignment, (a) => a.type === 'function_definition')) return 'an assignment in a function, whose variable the epilogue does not see';
      const array = s.rewrite.code.startsWith('(');
      const source = array ? s.rewrite.code.slice(1, -1) : s.rewrite.code.replace('[*]', '[@]').replace('$*', '$@').replace('${*}', '${@}');
      const epilogue = `printf '<%s>' "\${${name}[@]}"; echo; printf '<%s>' ${source}; echo; printf '[%s]\\n' "$${name}"`;
      return [['x  y', 'b', 'c'], []].map((args) => ({
        state: JSON.stringify(args),
        runs: pair(s, { args, epilogue, env: x.others }),
        verify: ([o, r]) => {
          const [elements, wanted, joined] = r.out.split('\n');
          // (The array keeps the elements apart; the string is the original's.)
          if (array) return elements === wanted ? undefined : `elements ${elements} for ${wanted}`;
          return joined === o.out.split('\n')[2] ? undefined : `string ${joined} for ${o.out.split('\n')[2]}`;
        },
      }));
    },
  },
} satisfies Partial<Record<SuggestionId, IdStates>>);

// ---------------------------------------------------------------------------------------------------
// The style checks (src/pitfalls.ts; docs/design/oracles.md, step 6). Their originals are what was not meant (a
// command named `[-f`, `x`, `{echo`; a group never closed, which bash does not parse), so the meaning is checked
// against a reference: the line written another way that bash reads as meant, built from the original's tree (the
// words of `[ ]` given to `test`, the commands of a group without its braces), or the words the original gave a
// recorder (`x = 1` gives `x` the words `=` and `1`).

/** The command of the original that holds the first edit. */
const commandAt = (x: Context): SyntaxNode => ancestor(x.at, (a) => a.type === 'command') ?? x.at;
/** The original with the text from `start` to `end` replaced (`text`), and other such edits: the reference. */
const reference = (s: Subject, edits: readonly TextEdit[]): string => applied(s.original, { code: '', edits });
/** The named variables `n` expands (not bash's own), in order. */
const varsIn = (n: SyntaxNode): string[] => [...new Set(descendants(n, ['simple_expansion', 'expansion']).flatMap((e) => e.namedChildren.filter((c) => c.type === 'variable_name').map((c) => c.text)))].filter((v) => !(v in BASH_VARIABLES));
/** The epilogue that prints the status the script leaves. */
const STATUS = 'echo "@st=$?"';

/**
 * The checks of a rewrite of `[ … ]` (`cmd`: the command of the original the rewrite is about, `ref`: the reference
 * that runs what was meant): with the variables of the test a file name and empty, and that file present and absent,
 * the rewrite prints what the reference prints and leaves its status (the messages of `test` as those of `[`).
 */
function testChecks(s: Subject, x: Context, cmd: SyntaxNode, ref: string): Check[] {
  const vars = varsIn(cmd).filter((v) => !x.assigned.has(v));
  const dir = /(^|\s)-d\s/.test(cmd.text);
  const named = fields(cmd, 'argument').map((w) => staticWordValue(w)).filter((v): v is string => v !== undefined && /^\w[\w.]*$/.test(v));
  const states = (vars.length ? ['x1', ''] : [undefined]).flatMap((value) => [true, false].map((present) => ({ value, present })));
  return states.map(({ value, present }) => {
    const files = present ? [...named, 'x1'].map((f) => (dir ? `${f}/` : f)) : [];
    const env = { ...x.others, ...(value === undefined ? {} : Object.fromEntries(vars.map((v) => [v, value]))) };
    return {
      state: `${value === undefined ? '' : `${JSON.stringify(value)}, `}${present ? 'present' : 'absent'}`,
      runs: [{ script: ref, env, files, epilogue: STATUS }, { script: s.script, env, files, epilogue: STATUS }],
      verify: ([o, r]) => same(o, r, [['test: ', '[: ']]),
    };
  });
}

/** The words a recorder printed for the command `name` (`@x <=> <1>`), the first time, if it ran. */
function recorded(r: Ran, name: string): string[] | undefined {
  const line = r.out.split('\n').find((l) => l === `@${name}` || l.startsWith(`@${name} <`));
  return line === undefined ? undefined : [...line.slice(name.length + 1).matchAll(/ <(.*?)>(?= <|$)/g)].map((m) => m[1]);
}

/** Why `read` (the command `cmd`) reads no stdin of the state, if it does not: a pipe or a redirection gives it another. */
function stdinElsewhere(cmd: SyntaxNode): string | undefined {
  for (let n: SyntaxNode | null = cmd; n; n = n.parent) {
    const p: SyntaxNode | null = n.parent;
    if (p?.type === 'pipeline' && p.namedChildren[0] !== n) return 'its stdin is a pipe';
    if (redirectionsOf(n).some((r) => r.type === 'heredoc_redirect' || r.type === 'herestring_redirect' || (r.type === 'file_redirect' && /^0?</.test(r.text)))) return 'its stdin is a redirection';
  }
  return undefined;
}

Object.assign(STATES, {
  'bracket-no-space': {
    states: 'the variables of the test a file name and empty, that file present and absent (what `test` with the same words gives)',
    checks: (s, x) => {
      const cmd = commandAt(x);
      const name = field(cmd, 'name')!;
      const words = fields(cmd, 'argument');
      const open = name.text.startsWith('[[') ? '[[' : '[';
      const last = words.at(-1)!;
      const inner = [name.text.slice(open.length), ...words.slice(0, -1).map((w) => w.text), last.text.slice(0, -(open.length))].filter(Boolean);
      return testChecks(s, x, cmd, reference(s, [{ start: name.startIndex, end: last.endIndex, text: `test ${inner.join(' ')}` }]));
    },
  },
  'bracket-close-in-word': {
    states: 'the variables of the test a file name and empty, that file present and absent (what `test` with the same words gives)',
    checks: (s, x) => {
      const cmd = commandAt(x);
      const name = field(cmd, 'name')!;
      const words = fields(cmd, 'argument');
      const last = words.at(-1)!;
      const inner = [...words.slice(0, -1).map((w) => w.text), last.text.slice(0, -1)];
      return testChecks(s, x, cmd, reference(s, [{ start: name.startIndex, end: last.endIndex, text: `test ${inner.join(' ')}` }]));
    },
  },
  'and-or-in-bracket': {
    states: 'the variables of the tests a file name and empty, that file present and absent (what `test … && test …` gives)',
    checks: (s, x) => {
      const cmd = commandAt(x);
      const list = cmd.parent!;
      const kids = list.children;
      const op = kids[kids.indexOf(cmd) + 1];
      const next = kids[kids.indexOf(cmd) + 2];
      const right = [field(next, 'name')!.text, ...fields(next, 'argument').slice(0, -1).map((w) => w.text)];
      const ref = `test ${fields(cmd, 'argument').map((w) => w.text).join(' ')} ${op.type} test ${right.join(' ')}`;
      return testChecks(s, x, list, reference(s, [{ start: cmd.startIndex, end: next.endIndex, text: ref }]));
    },
  },
  'redirect-in-bracket': {
    states: 'the strings compared in either order and equal; no file in the directory (what `[[ … < … ]]` gives, and no file made or read)',
    checks: (s, x) => {
      const cmd = commandAt(x);
      const name = field(cmd, 'name')!;
      const redirect = cmd.namedChildren.find((c) => c.type === 'file_redirect' && c.startIndex > name.startIndex)!;
      const [, fd, op] = /^(\d*)([<>])/.exec(redirect.text)!;
      const words = fields(cmd, 'argument');
      const left = fd || words.find((w) => w.endIndex <= redirect.startIndex)!.text;
      const ref = reference(s, [{ start: name.startIndex, end: words.at(-1)!.endIndex, text: `[[ ${left} ${op} ${field(redirect, 'destination')!.text} ]]` }]);
      const vars = varsIn(cmd).filter((v) => !x.assigned.has(v));
      const pairs = vars.length > 1 ? [['a', 'b'], ['b', 'a'], ['a', 'a']] : vars.length ? [['a'], ['z']] : [[]];
      // (The files the run leaves: none, where nothing was redirected.)
      const epilogue = `${STATUS}\nshopt -s nullglob dotglob; for f in *; do echo "@file=$f"; done`;
      return pairs.map((values) => {
        const env = { ...x.others, ...Object.fromEntries(vars.map((v, i) => [v, values[Math.min(i, values.length - 1)]])) };
        // (The original too, where bash parses it: its redirection makes a file, or fails to read one, which the rewrite does not.)
        return {
          state: JSON.stringify(values), runs: [{ script: ref, env, epilogue }, { script: s.script, env, epilogue }, { script: s.original, env, epilogue }],
          verify: ([o, r, h]) => same(o, r) ?? (/^@file=/m.test(h.out) || /No such file/.test(h.err) ? undefined : `no file made or read by the original: ${JSON.stringify(h)}`),
        };
      });
    },
  },
  'assignment-with-spaces': {
    states: 'the variable unset, set before (it gets the words the original gives the command of its name)',
    checks: (s, x) => {
      const cmd = commandAt(x);
      const name = field(cmd, 'name')!.text;
      const epilogue = [...uncalled(x.tree), `echo "@v=\${${name}-unset}"`].join('\n');
      // (The original without the command's redirections, so that its recorder prints the words: `x = 1 >f`.)
      const bare = reference(s, redirectionsOf(cmd).map((r) => ({ start: r.startIndex, end: r.endIndex, text: '' })));
      return [undefined, 'old'].map((before) => ({
        state: before ? 'set before' : 'unset',
        runs: [{ script: bare, env: { ...x.others, ...(before ? { [name]: before } : {}) }, epilogue }, { script: s.script, env: { ...x.others, ...(before ? { [name]: before } : {}) }, epilogue }],
        verify: ([o, r]) => {
          const words = recorded(o, name);
          if (!words) return `the original ran no \`${name}\`: ${JSON.stringify(o)}`;
          if (recorded(r, name)) return `the rewrite ran \`${name}\`: ${JSON.stringify(r)}`;
          const value = words[0] === '=' ? words[1] ?? '' : words[0].slice(1);
          return said(r, 'v') === value ? undefined : `${name} is ${JSON.stringify(said(r, 'v'))}, not ${JSON.stringify(value)}`;
        },
      } as Check));
    },
  },
  'brace-no-space': {
    states: 'run once (what the commands of the group give without its braces)',
    broken: 'bash does not parse `{echo a;}`: the `}` has no group',
    checks: (s, x) => {
      const name = field(commandAt(x), 'name')!;
      // (The `}` ends the text the rewrite replaces, as written in the original.)
      const end = s.rewrite.edits[0].end;
      if (s.original[end - 1] !== '}') return 'no `}` at the end of the rewrite';
      const ref = reference(s, [{ start: name.startIndex, end: name.startIndex + 1, text: '' }, { start: end - 1, end, text: '' }]);
      return [{ state: 'once', runs: [{ script: ref, env: x.others, epilogue: STATUS }, { script: s.script, env: x.others, epilogue: STATUS }], verify: ([o, r]) => same(o, r) }];
    },
  },
  'brace-close-no-separator': {
    states: 'run once (what the commands of the group give without its braces, and those after it)',
    broken: 'bash does not parse a group that is never closed',
    checks: (s, x) => {
      const group = ancestor(x.at, (a) => a.type === 'compound_statement')!;
      const end = s.rewrite.edits[0].end;
      const ref = reference(s, [{ start: group.startIndex, end: group.startIndex + 1, text: '' }, { start: end - 1, end, text: '' }]);
      return [{ state: 'once', runs: [{ script: ref, env: x.others, epilogue: STATUS }, { script: s.script, env: x.others, epilogue: STATUS }], verify: ([o, r]) => same(o, r) }];
    },
  },
  'rm-empty-variable-root': {
    states: 'the variable set (with files in its directory), empty, unset; `rm` and the commands that run it are recorders',
    checks: (s, x) => {
      // (A check before the statement: the variables it tests.)
      const vars = x.vars.length ? x.vars : [...new Set([...s.rewrite.code.matchAll(/\$\{?[#!]?([A-Za-z_]\w*)/g)].map((m) => m[1]))];
      if (!vars.length) return 'no named variable';
      const why = setBy({ ...x, vars });
      if (why) return why;
      const env = (v?: string) => ({ ...x.others, ...(v === undefined ? {} : Object.fromEntries(vars.map((n) => [n, v]))) });
      const files = ['VAL/x1', 'VAL/x2', 'VAL/cache/a'];
      // (The hazard is gone: no command gets a path from the root that the original with a value does not give it.)
      const root = (o: Ran, r: Ran): string | undefined => {
        const extra = r.out.split('\n').filter((l) => /<\//.test(l) && !o.out.split('\n').includes(l));
        return extra.length ? `a path from the root: ${JSON.stringify(extra)}` : undefined;
      };
      return [
        keeps('set', s, { env: env('VAL'), files }, { env: env('VAL'), files }),
        ...(['', undefined] as const).map((v): Check => ({ state: v === undefined ? 'unset' : 'empty', runs: [{ script: s.original, env: env('VAL'), files }, { script: s.script, env: env(v), files }], verify: ([o, r]) => root(o, r) })),
      ];
    },
  },
  'read-without-r': {
    states: 'input with backslashes in a line, at the end of a line, at the end of the input (the rewrite keeps them: what the original gives with other text in their place)',
    checks: (s, x) => {
      const cmd = commandAt(x);
      const elsewhere = stdinElsewhere(cmd);
      if (elsewhere) return elsewhere;
      // (The variables it reads into: not the value of an option, `-p PROMPT`; the name of `-a` is one.)
      const words = fields(cmd, 'argument');
      const names = words.filter((w, i) => /^[A-Za-z_]\w*$/.test(w.text) && !/^-\w*[dinNptu]$/.test(words[i - 1]?.text ?? '')).map((w) => w.text);
      const epilogue = [...uncalled(x.tree), ...names.map((n) => `printf '@v=<%s>\\n' "\${${n}[*]}"`)].join('\n');
      const inputs: [string, string][] = [['aBSLb cBSLBSLd\ne f\n', 'a\\b c\\\\d\ne f\n'], ['gBSL\nh i\n', 'g\\\nh i\n'], ['jBSL', 'j\\']];
      return inputs.map(([benign, hazard]) => keeps(JSON.stringify(hazard), s, { stdin: benign, epilogue, env: x.others }, { stdin: hazard, epilogue, env: x.others }, [['BSL', '\\']]));
    },
  },
} satisfies Partial<Record<StyleCode, IdStates>>);

/** Whether `grep -E` matches `str` with `pattern` (GNU grep, as test/rewrites-misc.test.ts asks it). */
const grepCache = new Map<string, boolean>();
function grepMatches(pattern: string, str: string): boolean {
  const key = `${pattern}\0${str}`;
  if (!grepCache.has(key)) grepCache.set(key, spawnSync('grep', ['-qE', '--', pattern], { input: `${str}\n` }).status === 0);
  return grepCache.get(key)!;
}

/** The checks of a prefix assignment (`v=1 cmd $v`, `sudo v=1 cmd $v`): whatever `v` was, the command sees what the prefix sets. */
function prefixChecks(s: Subject, x: Context, programs: readonly string[], prelude = ''): Check[] | string {
  const cmd = ancestor(x.at, (a) => a.type === 'command') ?? x.at;
  const meant: Record<string, string> = {};
  // (The prefix of the command, or the assignments the wrapper is given before the command: `sudo v=1 cmd`.)
  const prefix = descendants(cmd, ['variable_assignment']).map((a) => [field(a, 'name')!.text, field(a, 'value')] as const);
  const given = fields(cmd, 'argument').map((a) => /^([A-Za-z_]\w*)=/.exec(a.text) ? [/^\w+/.exec(a.text)![0], a] as const : undefined);
  for (const [name, word] of prefix.length ? prefix : given.slice(0, given.findIndex((g) => !g)).map((g) => g!)) {
    const v = word === undefined ? '' : prefix.length ? staticWordValue(word, true) : staticWordValue(word)?.slice(name.length + 1);
    if (v === undefined) return 'a prefix whose value is not plain text';
    meant[name] = v;
  }
  const all = ['bash', ...programs];
  return [{}, Object.fromEntries(Object.keys(meant).map((k) => [k, 'old']))].map((before) => keeps(Object.keys(before).length ? 'set before' : 'unset', s,
    { env: { ...x.others, ...meant }, programs: all, prelude }, { env: { ...x.others, ...before }, programs: all, prelude }));
}

/** The checks of `test && cmd` last in a function or a script: the test true, then false, where its operands are files. */
function lastTestChecks(s: Subject, x: Context, inFunction: boolean): Check[] | string {
  // (The files the script tests: present, every test is true.)
  const tests = descendants(x.tree.root, ['command', 'extended_test']).map((t) => /^\[\[?\s+-[efd]\s+(\w[\w.]*)\s+\]\]?$/.exec(t.text)?.[1]).filter((f): f is string => !!f);
  if (!tests.length) return 'not a test of files';
  const epilogue = inFunction ? [...uncalled(x.tree), 'echo @next'].join('\n') : undefined;
  return [
    keeps('true', s, { files: tests, epilogue, env: x.others }, { files: tests, epilogue, env: x.others }),
    holds('false', s, { epilogue, env: x.others }, (r) => (r.status !== 0 || (inFunction && !/^@next$/m.test(r.out)) ? `failed: ${JSON.stringify(r)}` : undefined)),
  ];
}

// ---------------------------------------------------------------------------------------------------
// The checks of the corpus (test/rewrites-corpus.test.ts).

/** The texts of the facts of `id` in `text`, read as `shell`, on every line, each once per fact. */
function factTexts(text: string, id: SuggestionId, shell?: Shell): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const f of suggestionsIn(text, shell)) {
    const key = `${f.text}\0${JSON.stringify(f.rewrite ?? null)}`;
    if (f.id === id && !seen.has(key)) { seen.add(key); out.push(f.text); }
  }
  return out.sort();
}

/** The items of `a` not matched by one of `b` (lists with repeats). */
function minus(a: readonly string[], b: readonly string[]): string[] {
  const rest = [...b];
  return a.filter((x) => { const i = rest.indexOf(x); if (i < 0) return true; rest.splice(i, 1); return false; });
}

/**
 * The second cheap check of 3.3 on a subject: explaining the rewrite (in the whole file) raises no fact of the same id
 * where the rewrite was made, and the other facts of the id stay; only where the id says a rewrite may bring the next
 * one to light (`IdStates.uncovers`), a new fact of it. A failure says what differs; undefined when it holds.
 */
export function leavesNoFact(s: Subject): string | undefined {
  const fixed = s.facts.map((f) => f.text);
  const before = minus(factTexts(s.text, s.id, s.shell), fixed);
  const after = factTexts(applied(s.text, s.rewrite), s.id, s.shell);
  // (As lists with repeats: the style checks say the same text at each place, `read x` on two lines.)
  const added = minus(after, before);
  const left = added.filter((t) => fixed.includes(t));
  const gone = minus(before, after);
  if (left.length) return `still ${JSON.stringify(left)}`;
  if (gone.length) return `others gone: ${JSON.stringify(gone)}`;
  if (added.length && !STATES[s.id]!.uncovers) return `new: ${JSON.stringify(added)}`;
  return undefined;
}

/** What the state oracles did with the subjects of an id: how many ran, and why the others did not. */
export interface IdCounts { subjects: number; ran: number; checks: number; skipped: Record<string, number> }

/** Whether bash `program` parses each text (`bash -n`). */
export async function parses(program: string, texts: readonly string[]): Promise<boolean[]> {
  const rans = await runJobs(program, texts.map((script) => ({ script, mode: 'syntax' })));
  return rans.map((r) => r.status === 0 && r.err === '');
}

/**
 * The state oracles over `list` in bash `program`: the checks of each subject's id, where the subject may run
 * (`unsafe`, a script bash parses, read as bash or sh), with the failures and the counts of each id.
 */
export async function checkStates(program: string, list: readonly Subject[]): Promise<{ failures: string[]; counts: Partial<Record<SuggestionId, IdCounts>> }> {
  const ok = await parses(program, list.map((s) => s.original));
  const counts: Partial<Record<SuggestionId, IdCounts>> = {};
  const plans: { s: Subject; checks: Check[] }[] = [];
  list.forEach((s, i) => {
    const c = (counts[s.id] ??= { subjects: 0, ran: 0, checks: 0, skipped: {} });
    c.subjects++;
    // (An id whose original may be one bash does not parse runs its checks on the rewrite and a reference alone.)
    const broken = !ok[i] && !!STATES[s.id]!.broken;
    const why = s.shell && s.shell !== 'bash' && s.shell !== 'sh' ? `read as ${s.shell}` : !ok[i] && !broken ? 'bash does not parse it'
      : (broken ? undefined : unsafe(parser.parse(s.original))) ?? unsafe(parser.parse(s.script));
    const checks = why ?? STATES[s.id]!.checks(s, contextOf(s));
    if (typeof checks === 'string') { c.skipped[checks] = (c.skipped[checks] ?? 0) + 1; return; }
    // (Every script a check runs is one the walls let through: a reference, a probe, as well as the two of the subject.)
    const refused = checks.flatMap((k) => k.runs.map((r) => r.script)).find((t) => unsafe(parser.parse(t)));
    if (refused !== undefined) throw new Error(`${s.id} in ${JSON.stringify(s.input)}: a check runs ${JSON.stringify(refused)}, which the walls refuse: ${unsafe(parser.parse(refused))}`);
    c.ran++;
    c.checks += checks.length;
    plans.push({ s, checks });
  });
  const rans = await runJobs(program, plans.flatMap((p) => p.checks.flatMap((c) => c.runs)));
  const failures: string[] = [];
  let at = 0;
  for (const { s, checks } of plans) {
    for (const c of checks) {
      const bad = c.verify(rans.slice(at, (at += c.runs.length)));
      if (bad) failures.push(`${s.id} in ${JSON.stringify(s.input === s.text ? s.input : `${s.input}: ${s.original.trim()}`)}, ${JSON.stringify(s.codes)}, ${c.state}: ${bad}`);
    }
  }
  return { failures, counts };
}
