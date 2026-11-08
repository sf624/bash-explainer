import type { ScriptEvidence } from '../shellfeatures';
import { parseExpansion } from '../expansion';
import { outputsOf } from '../idioms';
import { staticWordValue } from '../staticword';
import { ancestor, descendants, field, fields, type SyntaxNode, type SyntaxTree } from '../syntax/tree';
import { shellFromName } from '../dialect';
import { commandName } from './effects';
import { processOf, subshellReasons } from './env';
import type { NestedScript } from './nested';
import { shellState, type StateModel } from './state';
import { conditionOf, statusModel } from './status';
import { exitSignal, parser } from './walk/shared';

// What may keep a shell from getting to a line, or from reading it as it is written: the one table of the problems that say
// a fault of a script (docs/design/three-levels.md, "Where a shell stops"). The table follows no path; where the tree has no error, what
// `shellState.dead()` says never runs counts as after a sure stop too, in the gates below. It trusts nothing when the tree has an error, and a polyglot's
// other language is one. test/script-stops.test.ts holds the table against real bash.

/**
 * `sure`: the shell does not get past this command, or what comes after is another language's (a polyglot's `exec`): nothing is
 * said after it. `may`: it may end the script or change how the rest is read: what says the shell reads the text wrongly is a warning after it.
 */
export type Stop = 'sure' | 'may';

/** The words after a command's name, as far as they are known. */
type Words = readonly (string | undefined)[];

/**
 * What ends the shell when it gets there, in the script itself: `sure`. In a function, a branch or a list it may not run: `may`.
 * (`logout` and `return` print an error and go on in a script, but they end a login shell or a file sourced, as such a file is written to.)
 */
const ends = (c: SyntaxNode): Stop => (atTop(c) ? 'sure' : 'may');

/** Whether the shell gets to `c` once it gets to its statement in the script: a statement of the script, or the first command of a list there (`exec a || exit 1`). */
function atTop(c: SyntaxNode): boolean {
  let x = c;
  while (x.parent?.type === 'list' && x.parent.namedChildren[0] === x) x = x.parent;
  return x.parent?.type === 'program';
}

/** Where the command `exec` runs is in its words: `exec` hands the shell over only with one. `exec 3>&1`, `exec -c` and a refused option go on (test/script-stops.test.ts). */
function execWord(words: Words): number | undefined {
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w === '--') return i + 1 < words.length ? i + 1 : undefined;
    if (w === undefined || !w.startsWith('-')) return i;
    if (!/^-[acl]+$/.test(w)) return undefined;
    if (w.includes('a')) i++;
  }
  return undefined;
}

const execStop = (words: Words): Stop | undefined => (execWord(words) === undefined ? undefined : 'sure');

/** A text `eval` runs, known to end the shell by this same table: `eval 'exec perl -x "$0"'`, the first lines of a Perl polyglot. Any other may do anything. */
function evalStop(words: Words): Stop {
  if (!words.length || words.includes(undefined)) return 'may';
  const text = `${words.join(' ')}\n`;
  return stopBefore(parser().parse(text), text.length) === 'sure' ? 'sure' : 'may';
}

/**
 * `set` reads its options up to the first word that is none. `-t` (`onecmd`) runs one more command and exits with its status, `-n`
 * (`noexec`) runs nothing. `-e` and `-u` are not here: they stop a script only with a failing status, so a script that works never
 * holds a fault it stops before, and the texts say "if the shell reaches this line". A word read only when it runs may be any option.
 */
function setStop(words: Words): Stop | undefined {
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w === undefined) return 'may';
    if (w === '--' || w === '-' || !/^[-+]/.test(w)) return undefined;
    if (/^-[A-Za-z]*[nt]/.test(w)) return 'sure';
    if (!/^[-+][A-Za-z]*o/.test(w)) continue;
    const name = words[++i];
    if (name === undefined && i < words.length) return 'may';
    if (w.startsWith('-') && (name === 'noexec' || name === 'onecmd')) return 'sure';
  }
  return undefined;
}

/** Where the command `command` or `builtin` runs is in its words. `command -v` only names it. */
function wrapperWord(words: Words): number | undefined {
  let i = 0;
  for (; i < words.length && words[i]?.startsWith('-'); i++) {
    if (words[i] === '--') { i++; break; }
    if (words[i] !== '-p') return undefined;
  }
  return i < words.length ? i : undefined;
}

/** `command` and `builtin` run a command: what stops is what it would be by itself. A word read only when it runs may be its name. */
function wrapperStop(words: Words, c: SyntaxNode): Stop | undefined {
  const i = wrapperWord(words);
  if (i === undefined) return undefined;
  const name = words[i];
  return name === undefined ? 'may' : namedStop(name, words.slice(i + 1), c);
}

/** `mapfile -C "exit 0;"`: the callback runs in this shell. */
const callbackStop = (words: Words): Stop | undefined => (words.some((w) => w === undefined || /^-[A-Za-z]*C/.test(w)) ? 'may' : undefined);

/** A function or an alias may close what looks open, a file sourced may do any of it; a trap may end the shell with status 0. */
const mayStop = (): Stop => 'may';

/** The commands that may keep a shell from a line. Any other name stops nothing, and a name read only when it runs may be any of these. */
const STOPS: Readonly<Record<string, (words: Words, c: SyntaxNode) => Stop | undefined>> = {
  exit: (_, c) => ends(c),
  logout: (_, c) => ends(c),
  return: (_, c) => (ancestor(c, (a) => a.type === 'function_definition') ? undefined : ends(c)),
  exec: execStop,
  eval: evalStop,
  set: setStop,
  command: wrapperStop,
  builtin: wrapperStop,
  mapfile: callbackStop,
  readarray: callbackStop,
  trap: mayStop,
  source: mayStop,
  '.': mayStop,
  alias: mayStop,
  shopt: mayStop,
  kill: mayStop,
};

const namedStop = (name: string, words: Words, c: SyntaxNode): Stop | undefined => (Object.hasOwn(STOPS, name) ? STOPS[name](words, c) : undefined);

/** Whether a statement around `c` runs in a subshell: what stops there stops that subshell, and the script goes on. (A pipeline's last stage too, as it does but with `lastpipe`.) */
const inSubshell = (c: SyntaxNode): boolean => !!ancestor(c, (a) => a.type === 'pipeline' || subshellReasons(a).length > 0) || subshellReasons(c).length > 0;

/** The file itself, in the words of a command: a run of the script again (`exec bash "$0"`, `eval 'exec perl -S $0'`). */
const THE_FILE = /\$\{?0\b|BASH_SOURCE/;
/** An interpreter other than a shell, or the variable that holds one or a shell (`"$PYTHON"`, `$CONFIG_SHELL`), as the word of a command. */
const INTERPRETER = /(?<![\w.-])(?:python|pypy|perl|ruby|node|nodejs|php|lua|tclsh|guile|(?:config_)?shell)[\d.]*(?:_\w+)?(?![\w.-])/i;

/** Where the word that a sure stop of `name` runs is, in `words`, past `command` and `builtin`: the text of `eval`, and none for `set` (past the end). */
function ranAt(name: string, words: Words): number {
  if (name === 'exec') return execWord(words)!;
  if (name === 'command' || name === 'builtin') {
    const i = wrapperWord(words)!;
    return i + 1 + ranAt(words[i]!, words.slice(i + 1));
  }
  return name === 'eval' ? 0 : words.length;
}

/**
 * Whether a sure stop not at the top of the script hands the script over: it names the file, or the word it runs is a shell or an
 * interpreter (`exec bash "$self"`, `exec "$PYTHON" "$self"`), also through `env`. Anything else is one branch's end (`exec echo "$usage"`).
 */
function handsOver(c: SyntaxNode, words: Words): boolean {
  const texts = fields(c, 'argument').map((a) => a.text);
  if (texts.some((w) => THE_FILE.test(w))) return true;
  const run = texts.slice(ranAt(commandName(c)!, words)).find((w) => !/^(?:\/usr\/bin\/)?env$/.test(w));
  if (!run) return false;
  const bare = run.replace(/["'${}]/g, '');
  return INTERPRETER.test(bare) || !!shellFromName(bare.split('/').pop()!);
}

/**
 * What the simple command `c` is of the table. In a subshell it is no `sure` stop: what follows it there may not run, and what follows the subshell does.
 * Nor is it, not at the top of the script, but where it hands the script over or where the parser cannot read what follows, another language's text: elsewhere the path that takes it is one of several.
 */
function stopOf(c: SyntaxNode, lastError: number): Stop | undefined {
  const name = commandName(c);
  const words = fields(c, 'argument').map((a) => staticWordValue(a));
  const stop = name === undefined ? 'may' : namedStop(name, words, c);
  if (stop !== 'sure') return stop;
  return !inSubshell(c) && (atTop(c) || c.endIndex <= lastError || handsOver(c, words)) ? 'sure' : 'may';
}

/**
 * Whether the expansion `e` may end the shell: `${x:?}` and `${x?}` do when the variable has no value, here or by the time it runs (`: "${BASH_VERSION:?needs bash}"`). Not in a
 * subshell, which it ends, and the script goes on; nor where the script surely gave the variable a value (`x=1; : "${x:?}"`), an empty one being none for `:?`.
 */
function expansionStops(e: SyntaxNode, tree: SyntaxTree): boolean {
  const p = parseExpansion(e.text);
  if (!p?.op || !/^:?\?$/.test(p.op) || inSubshell(e)) return false;
  const v = shellState(tree).at(e).run.variables.get(p.name);
  return v?.set !== 'on' || (p.op === ':?' && !v.value);
}

/** Each kind of stop of a tree, in the order they end: where, and on which row. */
type Marks = Readonly<Record<Stop, readonly { end: number; row: number }[]>>;

const marks = new WeakMap<SyntaxTree, Marks>();

function marksOf(tree: SyntaxTree): Marks {
  let m = marks.get(tree);
  if (!m) {
    const found: { sure: { end: number; row: number }[]; may: { end: number; row: number }[] } = { sure: [], may: [] };
    const lastError = tree.errors.reduce((last, e) => Math.max(last, e.startIndex), -1);
    for (const c of descendants(tree.root, ['command'])) {
      const stop = field(c, 'name') ? stopOf(c, lastError) : undefined;
      if (stop) found[stop].push({ end: c.endIndex, row: c.startPosition.row });
    }
    for (const e of descendants(tree.root, ['expansion'])) {
      if (expansionStops(e, tree)) found.may.push({ end: e.endIndex, row: e.startPosition.row });
    }
    found.sure.sort((a, b) => a.end - b.end);
    found.may.sort((a, b) => a.end - b.end);
    marks.set(tree, (m = found));
  }
  return m;
}

/** Whether the first of `list` on row `from` or after has ended by offset `at`. */
function endedBy(list: Marks[Stop], at: number, from: number): boolean {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].row < from) lo = mid + 1;
    else hi = mid;
  }
  return lo < list.length && list[lo].end <= at;
}

/** The strongest stop before offset `at`, of the shell that started on row `from` (`ExplainOptions.stopsFrom`: a host's shells, one tree). */
export function stopBefore(tree: SyntaxTree, at: number, from = 0): Stop | undefined {
  const { sure, may } = marksOf(tree);
  return endedBy(sure, at, from) ? 'sure' : endedBy(may, at, from) ? 'may' : undefined;
}

/** What the model says of a script's statements (`shellState.dead`). */
export type Deadness = Pick<StateModel, 'dead'>;

const deadSpans = new WeakMap<Deadness, readonly { start: number; end: number }[]>();

/** Whether offset `at` lies in a statement that never runs, in the order they start. A dead statement holds only dead ones: each is walked once. */
function inDead(tree: SyntaxTree, model: Deadness, at: number): boolean {
  let spans = deadSpans.get(model);
  if (!spans) {
    const found: { start: number; end: number }[] = [];
    const visit = (n: SyntaxNode): void => {
      for (const c of n.namedChildren) {
        if (model.dead(c)) found.push({ start: c.startIndex, end: c.endIndex });
        else visit(c);
      }
    };
    visit(tree.root);
    deadSpans.set(model, (spans = found));
  }
  let lo = 0;
  let hi = spans.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (spans[mid].end <= at) lo = mid + 1;
    else hi = mid;
  }
  return lo < spans.length && spans[lo].start <= at;
}

/** The strongest stop at offset `at`, with what the model of a script with no error in its tree says never runs (none in a host's code, whose tree holds several shells). */
export const stopAt = (tree: SyntaxTree, at: number, from?: number, model?: Deadness): Stop | undefined => (model && !tree.errors.length && inDead(tree, model, at) ? 'sure' : stopBefore(tree, at, from));

const inTest = (n: SyntaxNode): boolean => ancestor(n, (p) => p.type === 'extended_test' || p.type === 'arithmetic_expansion' || p.type === 'arithmetic_command')?.type === 'extended_test';

/**
 * Whether the command that holds `n` (arithmetic) can run without reading it: what follows the parameter in `${x:-…}`, `${x#…}`, `${x:…}`
 * (read only when the value calls for it: `${x#$((09))}` with `x` empty does not), what follows `&&` or `||` in `[[ ]]`, a pattern of `case`
 * after the first, the update of a C-style `for`. (`$(( 1 || 09 ))` reads it all the same.) In `$( )` it is another command, which reads it
 * whenever it runs.
 */
export function readOnlySometimes(n: SyntaxNode): boolean {
  for (let c = n, p = n.parent; p; c = p, p = p.parent) {
    if (p.type === 'command_substitution' || p.type === 'process_substitution') return false;
    if (p.type === 'expansion' && c !== p.namedChildren[0]) return true;
    if (p.type === 'binary_expression' && c === p.namedChildren[1] && p.children.some((x) => x.type === '&&' || x.type === '||') && inTest(p)) return true;
    if (p.type === 'case_item' && fields(p, 'value').includes(c) && (c !== fields(p, 'value')[0] || p !== p.parent!.namedChildren.find((x) => x.type === 'case_item'))) return true;
    if (p.type === 'c_style_for_statement' && fields(p, 'update').includes(c)) return true;
  }
  return false;
}

/**
 * Whether the shell surely gets to `n` once it gets to the statement of the script around it, whatever the values. What may be left out: a function,
 * which may never be called; a branch of `if` or `case` (not the condition of the `if`, which runs); the body of a loop, which may run no time;
 * what follows `&&` or `||`; what is read only sometimes in a word or a test (`readOnlySometimes`).
 */
export function surelyRuns(n: SyntaxNode): boolean {
  if (readOnlySometimes(n)) return false;
  for (let c = n, p = n.parent; p; c = p, p = p.parent) {
    if (leftOut(c, p)) return false;
  }
  return true;
}

/**
 * Whether the action of `trap` surely runs once the shell gets to the `trap`: only at the end of the shell (EXIT, 0), as a signal may never come, and unless something takes it
 * back: a later `trap` of EXIT, or of signals not known here, or an `exec`, which runs no trap.
 */
function runsAtExit(action: SyntaxNode): boolean {
  const trap = ancestor(action, (a) => a.type === 'command')!;
  const words = fields(trap, 'argument');
  if (!words.slice(words.indexOf(action) + 1).some((w) => exitSignal(staticWordValue(w) ?? ''))) return false;
  return !descendants(ancestor(action, (a) => !a.parent)!, ['command']).some((c) => {
    if (c.startIndex <= trap.startIndex) return false;
    const later = fields(c, 'argument').map((a) => staticWordValue(a));
    const name = commandName(c);
    return name === 'trap' ? later.some((w) => w === undefined || exitSignal(w)) : name === 'exec' && execWord(later) !== undefined;
  });
}

/**
 * Whether a string is surely run once the shell gets to the statement around it (`surelyRuns`), so that what fails in it fails every time: `eval`'s, or another shell's through
 * slots that run it exactly when they run (`CommandSlot.once`), not with `sh -n`, which reads it and runs nothing; a trap's, as `runsAtExit`. (A string in a string asks for each
 * level: `later` here, for a trap around it, says nothing of this one.) What the dictionary does not say is not surely run.
 */
export function stringSurelyRuns(script: Pick<NestedScript, 'kind' | 'words' | 'env'>): boolean {
  if (!surelyRuns(script.words[0])) return false;
  if (script.kind === 'later') return runsAtExit(script.words[0]);
  return script.env.links.every((l) => l.kind !== 'slot' || l.slot.later || (l.slot.once && !l.invocation?.some((o) => o.flag === '-n')));
}

/**
 * How a shell fails at a construct it lacks: `read`, it refuses the text while it reads it; `stop`, the shell stops where the construct runs; `status`, it gives a status and goes on.
 * (`FEATURES`, `dash` and `ash`, measured.)
 */
export type Fault = 'read' | 'stop' | 'status';

/**
 * The statement of the script that a shell reads `n` with: the first of those on the line. It reads a whole line, and a compound command up to its end, before it runs any of it:
 * a syntax error in `exit 0; a=(1)` (or `exit 0; \<newline>a=(1)`), in `if a; then exit\na=(1)\nfi` or in a function's body comes first, and only what ran on the lines before can keep the shell from it.
 */
export function readWith(n: SyntaxNode): SyntaxNode {
  let top = n;
  while (top.parent!.parent) top = top.parent!;
  const root = top.parent!;
  const statements = root.namedChildren;
  // (A line continuation between two statements keeps them on one line, `exit 0; \<newline>a=(1)`. A comment is a statement of its own: the newline after it is between.)
  const between = (a: SyntaxNode, b: SyntaxNode): string => root.text.slice(a.endIndex - root.startIndex, b.startIndex - root.startIndex);
  const oneLine = (a: SyntaxNode, b: SyntaxNode): boolean => a.endPosition.row === b.startPosition.row || !between(a, b).replace(/\\\n/g, '').includes('\n');
  let i = statements.indexOf(top);
  while (i > 0 && oneLine(statements[i - 1], statements[i])) i--;
  return statements[i];
}

/** Whether a shell reads `n` with the line it is on: `$( )` it reads there; the text of `${…}` when it runs, and that of a backquote when it runs it, as a string. */
export function readWithItsLine(n: SyntaxNode): boolean {
  const word = (a: SyntaxNode): boolean => a.type === 'expansion' || a.type === 'command_substitution';
  return n.type !== 'expansion' && ancestor(n, word)?.type !== 'expansion' && !ancestor(n, (a) => a.type === 'command_substitution' && a.children[0].type === '`');
}

/** Whether what `n` prints on stderr goes nowhere: the nearest redirection of fd 2 around it is to `/dev/null`. A command's words are expanded before its redirections apply: `echo "${x:1}" 2>/dev/null` shows the message, and `$( )` in a word too; not those of a command with no name (`x=$(a) 2>/dev/null` hides it, in dash and busybox ash). */
function stderrDiscarded(n: SyntaxNode): boolean {
  let inWord = false;
  for (let c: SyntaxNode | null = n; c; c = c.parent) {
    if (c.type === 'expansion' || c.type === 'simple_expansion' || c.type === 'arithmetic_expansion' || c.type === 'command_substitution') inWord = true;
    else if (c.type === 'command' && inWord && field(c, 'name')) inWord = false;
    else {
      // (A redirection that fails hides its message only by those made before it: `>&f 2>/dev/null` in dash shows it.)
      const { err } = outputsOf(c, c === n.parent && n.type === 'file_redirect' ? n : undefined);
      if (err !== undefined) return err === '/dev/null';
    }
  }
  return false;
}

/** Whether `set -e` stops the script at a failure of the statement `c`: through the `( )` around it too, whose status it then is. A failure in `$( )` or a stage of a pipe is the status of something else, which is not read here. */
function errexitStops(c: SyntaxNode, state: StateModel): boolean {
  const e = statusModel(state).errexit(c);
  if (e.active !== 'on' || e.checked !== true) return false;
  if (e.stops !== 'subshell') return e.stops === 'script';
  const around = ancestor(c, (a) => a.type === 'subshell');
  return !!around && errexitStops(around, state);
}

export type Quiet = 'any' | 'status';

/**
 * What a script that probes its shell keeps from anyone at `n`, the mark of `if (set -o pipefail) 2>/dev/null`, `shopt -s x 2>/dev/null || true`: it discards the message, on the
 * command or on what is around it, and `set -e` does not make the failure a stop. `any`: in a subshell, so any failure leaves the script going; `status`: in the script's own shell, so
 * only a failure with a status does (`set -o pipefail 2>/dev/null || true` still stops dash). None: the failure is seen, or stops the script.
 */
export function quietAt(n: SyntaxNode, state: StateModel): Quiet | undefined {
  if (!stderrDiscarded(n) || errexitStops(n.type === 'command' ? n : ancestor(n, (a) => a.type === 'command') ?? n, state)) return undefined;
  const p = processOf(state.env(n));
  return p.kind === 'subshell' && p.sure ? 'any' : 'status';
}

/** The same for a string run by a command that discards its stderr: a shell of its own only gives that command a status. */
export function quietString(script: Pick<NestedScript, 'kind' | 'words' | 'outer'>): Quiet | undefined {
  const quiet = quietAt(ancestor(script.words[0], (a) => a.type === 'command')!, script.outer);
  return quiet && (script.kind === 'child' ? 'any' : quiet);
}

/** Whether a failure of this kind is kept quiet. */
export const keptQuiet = (quiet: Quiet | undefined, fault: Fault | undefined): boolean => quiet === 'any' || (quiet === 'status' && fault === 'status');

function leftOut(c: SyntaxNode, p: SyntaxNode): boolean {
  switch (p.type) {
    case 'function_definition': case 'elif_clause': case 'else_clause': case 'case_item': return true;
    case 'if_statement': case 'while_statement': return !conditionOf(p)!.includes(c);
    case 'for_statement': case 'c_style_for_statement': case 'select_statement': return c.field === 'body' || c.field === 'update';
    case 'list': return c !== p.namedChildren[0];
    case 'command_substitution': case 'process_substitution': return readOnlySometimes(p);
    default: return false;
  }
}

/**
 * What a template engine replaces before a shell reads the code: Jinja and Go (`{{ x }}`, `{% if a %}`), ERB (`<% a %>`),
 * autoconf (`@VAR@`), CircleCI's parameters (`<< parameters.x >>`), GitLab's inputs (`$[[ inputs.x ]]`). Anywhere in the file.
 */
const TEMPLATE = /\{\{|\{%|<%|@[A-Za-z_]\w*@|<<[#^/]?\s*(?:parameters|pipeline)\.|\$\[\[/;
/**
 * `#!/bin/bash -t`: a first line that stops the shell as `set -t` does, or `-n`. Run as a program, `-s` reads stdin (exit 0, with none), and `-c` runs its word: neither reads
 * the file. Of the long options, only those that leave the reading alone are not here (`--version`, `--help`, `--rcfile` exit 0).
 */
const SHEBANG_STOPS = /^#!.*\s(?:-[A-Za-z]*[nstc]|--(?!(?:login|posix|noprofile|norc)?(?:\s|$)))/;

const plainTexts = new WeakMap<SyntaxTree, boolean>();

/** Whether the text is what a shell reads, as it is written, whichever shell: no CR, no NUL, no template marker, and no first line that stops the shell. Each line asks: it is read once. */
export function plainText(tree: SyntaxTree): boolean {
  let plain = plainTexts.get(tree);
  if (plain === undefined) {
    // (With CRs in the text, it is not what bash reads: a CR after `&&` is a command, `fi` before one a word. The problem
    // `crlf` says so. A NUL on the first line makes bash refuse the file: "cannot execute binary file", status 126.)
    plain = !tree.carriageReturns && !tree.text.includes('\0') && !TEMPLATE.test(tree.text) && !SHEBANG_STOPS.test(tree.text.split('\n', 1)[0]);
    plainTexts.set(tree, plain);
  }
  return plain;
}

/** What is known of a fault of the text: `known`, the fact stands at its own level; `unsure`, it is said at a warning's. */
export type ReadKnown = 'known' | 'unsure';

const knownOf = (stop: Stop | undefined, script: ScriptEvidence): ReadKnown | undefined => (stop === 'sure' ? undefined : stop === 'may' || script === 'name' ? 'unsure' : 'known');

/**
 * How a fault of the text at offset `at` is said, the one rule of what claims a shell reads the text wrongly (`x = 1`, `if a then b; fi`,
 * `[-f x]`, `$((09))`, a syntax error): `known`, an error, where a first line, a directive or the user says the file is a script and nothing before it may stop the shell; `unsure`, a warning
 * with the same words, where only a name says so, as another shell may source it, or where a stop may come first; none after a `sure` stop,
 * where a shell may not read the text as it stands (`plainText`), or where no one says the file is a script. Whichever shell it is:
 * a claim that the shell fails on the text, not that bash's parser rejects it.
 */
export function readAs(tree: SyntaxTree, at: number, script: ScriptEvidence | undefined, model?: Deadness): ReadKnown | undefined {
  return script && plainText(tree) ? knownOf(stopAt(tree, at, undefined, model), script) : undefined;
}

/** The same in a host's code, the shell's whole input: it is a script, and a template is the host's own. `from`: the row its shell started on. */
export const hostReadAs = (tree: SyntaxTree, at: number, from: number | undefined): ReadKnown | undefined => knownOf(stopBefore(tree, at, from), 'said');

/**
 * Whether the shell gets to offset `at`, for an Error that is a fact of one command or of the shell's dialect (`[` without its `]`,
 * `print` in sh): not after a `sure` stop. A `may` stop does not change it, as the command fails whenever it runs: a mark on a token
 * is about its command (docs/design/three-levels.md).
 */
export function reachedAt(tree: SyntaxTree, at: number, from?: number, model?: Deadness): boolean {
  return stopAt(tree, at, from, model) !== 'sure';
}
