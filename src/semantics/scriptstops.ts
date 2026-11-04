import type { ScriptEvidence } from '../shellfeatures';
import { staticWordValue } from '../staticword';
import { ancestor, descendants, field, fields, type SyntaxNode, type SyntaxTree } from '../syntax/tree';
import { commandName } from './effects';
import { subshellReasons } from './env';

// What may keep a shell from getting to a line, or from reading it as it is written: the one table of the problems that say
// a fault of a script (docs/design/three-levels.md, "Where a shell stops"). No path is followed: `shellState.dead()` trusts
// nothing when the tree has an error, and a polyglot's other language is one. test/script-stops.test.ts holds the table against real bash.

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
const ends = (c: SyntaxNode): Stop => (c.parent?.type === 'program' ? 'sure' : 'may');

/** `exec` hands the shell over only with a command: `exec 3>&1`, `exec -c` and a refused option go on (test/script-stops.test.ts). */
function execStop(words: Words): Stop | undefined {
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w === '--') return i + 1 < words.length ? 'sure' : undefined;
    if (w === undefined || !w.startsWith('-')) return 'sure';
    if (!/^-[acl]+$/.test(w)) return undefined;
    if (w.includes('a')) i++;
  }
  return undefined;
}

/** A text `eval` runs, known to end the shell: `eval 'exec perl -x "$0"'`, the first lines of a Perl polyglot. Any other may do anything. */
const evalStop = (words: Words): Stop => (words.length && words.every((w) => w !== undefined) && /(?<![\w-])(?:exec|exit)(?![\w-])/.test(words.join(' ')) ? 'sure' : 'may');

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

/** `command` and `builtin` run a command: what stops is what it would be by itself. `command -v` only names it. A word read only when it runs may be its name. */
function wrapperStop(words: Words, c: SyntaxNode): Stop | undefined {
  let i = 0;
  for (; i < words.length && words[i]?.startsWith('-'); i++) {
    if (words[i] === '--') { i++; break; }
    if (words[i] !== '-p') return undefined;
  }
  if (i === words.length) return undefined;
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

/** Whether a statement around `c` runs in a subshell: what stops there stops that subshell, and the script goes on. */
const inSubshell = (c: SyntaxNode): boolean => !!ancestor(c, (a) => subshellReasons(a).length > 0) || subshellReasons(c).length > 0;

/** What the simple command `c` is of the table. In a subshell it is no `sure` stop: what follows it there may not run, and what follows the subshell does. */
export function stopOf(c: SyntaxNode): Stop | undefined {
  const name = commandName(c);
  const stop = name === undefined ? 'may' : namedStop(name, fields(c, 'argument').map((a) => staticWordValue(a)), c);
  return stop === 'sure' && inSubshell(c) ? 'may' : stop;
}

/** Each kind of stop of a tree, in the order they end: where, and on which row. */
type Marks = Readonly<Record<Stop, readonly { end: number; row: number }[]>>;

const marks = new WeakMap<SyntaxTree, Marks>();

function marksOf(tree: SyntaxTree): Marks {
  let m = marks.get(tree);
  if (!m) {
    const found: { sure: { end: number; row: number }[]; may: { end: number; row: number }[] } = { sure: [], may: [] };
    for (const c of descendants(tree.root, ['command'])) {
      const stop = field(c, 'name') ? stopOf(c) : undefined;
      if (stop) found[stop].push({ end: c.endIndex, row: c.startPosition.row });
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
export function readAs(tree: SyntaxTree, at: number, script: ScriptEvidence | undefined): ReadKnown | undefined {
  return script && plainText(tree) ? knownOf(stopBefore(tree, at), script) : undefined;
}

/** The same in a host's code, the shell's whole input: it is a script, and a template is the host's own. `from`: the row its shell started on. */
export const hostReadAs = (tree: SyntaxTree, at: number, from: number | undefined): ReadKnown | undefined => knownOf(stopBefore(tree, at, from), 'said');

/**
 * Whether the shell gets to offset `at`, for an Error that is a fact of one command or of the shell's dialect (`[` without its `]`,
 * `print` in sh): not after a `sure` stop. A `may` stop does not change it, as the command fails whenever it runs: a mark on a token
 * is about its command (docs/design/three-levels.md).
 */
export function reachedAt(tree: SyntaxTree, at: number, from?: number): boolean {
  return stopBefore(tree, at, from) !== 'sure';
}
