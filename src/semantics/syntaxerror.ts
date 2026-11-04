import { type BashVersion, DEFAULT_BASH_VERSION, lacks } from '../bashversion';
import type { Shell } from '../shellfeatures';
import { staticWordValue } from '../staticword';
import { ancestor, braceAsArgument, descendants, field, fields, gluedBrace, readWhenExpanded, strayKeyword, substitutionForm, type SyntaxError, type SyntaxErrorWhat, type SyntaxNode, type SyntaxTree } from '../syntax/tree';
import { commandName } from './effects';

// The syntax error bash stops at in a script, from the parser's errors (`SyntaxTree.errors`), for the problem
// `syntax-error` and the line's sentence. bash reads a script as it runs it, one complete command at a time, and stops
// at the first it cannot read. So `bash -n` is no measure of what a script does: code never reached is no fault of a script
// that works (`exit 0` before a payload, a polyglot, an alias that closes an `if`). The worst outcome is a false failure,
// so it is said only where it is positively known: the first error of a file surely a script of bash or sh (`Shells.script`),
// with nothing before it that may end the script or change how it is read (`surelyRead`, which what else says a fault of
// a script's text reads too), and no template marker (docs/design/three-levels.md). test/syntax-error.test.ts compares this with real shells, by running them.

export interface SyntaxFault {
  /** What to point at: the text bash stops on, or the opening of the construct left open. */
  node: SyntaxNode;
  what: SyntaxErrorWhat;
  /** The lines of the command bash refuses, whole (the top-level statement around it). */
  firstRow: number;
  lastRow: number;
  /** Another problem says this error, with more to say (`{ a }`, `if a then`): no second one. */
  said: boolean;
}

/** The node types that need no closing text of their own, so that a here-document left open leaves them whole. */
const ENDS_ALONE: ReadonlySet<string> = new Set(['program', 'command', 'redirected_statement', 'pipeline', 'list', 'negated_command', 'time_statement', 'heredoc_redirect']);

/** The nodes around offset `i`, from the root in, the last the innermost. A place of no width may be at a node's end. */
function around(root: SyntaxNode, e: SyntaxError): SyntaxNode[] {
  const i = e.startIndex;
  const has = (n: SyntaxNode) => n.startIndex <= i && (i < n.endIndex || (e.startIndex === e.endIndex && i === n.endIndex));
  const out = [root];
  // (At a node's end and the next one's start: the first, which has not ended.)
  for (let inner = root.children.find(has); inner; inner = inner.children.find(has)) out.push(inner);
  return out;
}

/** The node to point at for an error: the text itself, or what is left open: its opening, or the operator with nothing after it. */
function pointAt(chain: readonly SyntaxNode[], e: SyntaxError, what: SyntaxErrorWhat): SyntaxNode {
  const innermost = chain[chain.length - 1];
  if (e.startIndex !== e.endIndex) return innermost;
  const open = [...chain].reverse().find((n) => n.incomplete);
  if (!open) return innermost;
  const tokens = open.children.filter((c) => !c.named);
  const closes = what.kind === 'missing' || what.kind === 'unreadable' || what.kind === 'subscript' || what.kind === 'body';
  return (closes ? tokens[0] : tokens[tokens.length - 1]) ?? open;
}

/** The words that are no keywords to dash (`time` is a program there), and arithmetic, which it reads when it is expanded: a line with one reads otherwise there. */
const BASH_WORDS = /(?:^|[\s;&|(])(?:\[\[|\]\]|function|coproc|select|time)(?=[\s;&|)]|$)|\$\(\(/;

/**
 * Whether dash, the `sh` of the levels (docs/design/three-levels.md), reads the same text with no error, where the parser
 * reads bash: a word that is a keyword only in bash (`[[ a b ]]` runs the command `[[`), a function whose body is any
 * command (`f() b`), a subscript, and what is read only when it is expanded in dash (`"${x:-'}"`, `$(( ) ))`).
 */
function dashReads(tree: SyntaxTree, chain: readonly SyntaxNode[], e: SyntaxError): boolean {
  const later = (n: SyntaxNode) => n.type === 'expansion' || (n.type === 'function_definition' && !n.namedChildren.some((c) => c.type === 'compound_statement'));
  if (e.what.kind === 'subscript' || chain.some(later)) return true;
  const top = chain[1] ?? chain[0];
  const from = tree.text.lastIndexOf('\n', Math.min(top.startIndex, e.startIndex) - 1) + 1;
  const to = tree.text.indexOf('\n', Math.max(top.endIndex, e.endIndex));
  return BASH_WORDS.test(tree.text.slice(from, to < 0 ? undefined : to));
}

/** The first row of the lines that continue into `row`: a line continuation joins them to bash, so they are read together. */
function continuedFrom(text: string, row: number): number {
  const lines = text.split('\n');
  // (Not in a comment, where a backslash is only text.)
  while (row > 0 && /^[^#]*?(?:^|[^\\#])(?:\\\\)*\\$/.test(lines[row - 1])) row--;
  return row;
}

/** The reserved words and operators that bash names as they stand, where the parser stops on one. */
const NAMED_TOKEN = /^(?:[()!}]|;;&?|;&?|&&?|\|[|&]?|\]\]|then|do|done|fi|else|elif|esac|in)$/;

/** `$(( ))`, `(( ))`: what bash reads as text first, to its `))`. */
const ARITHMETIC: ReadonlySet<string> = new Set(['arithmetic_expansion', 'arithmetic_command', 'c_style_for_statement']);

/**
 * What the parser found, where bash names the same; else `unreadable`, which names nothing. test/syntax-error.test.ts holds the
 * table: each shape of a fault against `bash -n` and `dash -n`, so a token that bash does not name fails. The parser
 * recovers and goes on where bash stops, so:
 * - A token is said only as a reserved word or an operator, which bash takes as it stands, or as a word of `[[ ]]`, which it names itself.
 * - What is missing is said where the text reads in full with it added (`missingAdded`): bash then got to the end of the file. A `$( )` left open is read
 *   to its `)` first, so what is open inside it is not what bash says.
 */
function bashNames(tree: SyntaxTree, shell: Shell, chain: readonly SyntaxNode[], e: SyntaxError): SyntaxErrorWhat {
  const { what } = e;
  if (what.kind !== 'token' && what.kind !== 'missing') return what;
  if (what.token.includes('\n')) return { kind: 'unreadable' };
  const inOpen = chain.some((n) => n.type === 'command_substitution' && n.incomplete);
  const said = what.kind === 'token'
    ? (NAMED_TOKEN.test(what.token) || chain.some((n) => n.type === 'extended_test')) && !inOpen && !chain.some((n) => ARITHMETIC.has(n.type)) && !(what.token === 'in' && chain.some((n) => n.type === 'case_statement'))
    : what.token !== ';' && !chain.some((n) => n.type === 'extended_test') && (!inOpen || what.token === ')' || what.token === '`') && missingAdded(tree);
  return said && !(shell === 'sh' && dashNamesOther(tree, chain, what)) ? what : { kind: 'unreadable' };
}

/** Where dash, the `sh` of the levels, stops at another token than bash: bash's own operators, `case`, an array, a backtick left open. */
function dashNamesOther(tree: SyntaxTree, chain: readonly SyntaxNode[], what: SyntaxErrorWhat & { token: string }): boolean {
  return what.kind === 'missing' ? what.token === ')' || what.token === '`' : /^(?:;;&|;&|\|&)$/.test(what.token) || tree.text.includes('<<<') || chain.some((n) => n.type === 'case_statement');
}

/**
 * Whether the text reads with no error once what the parser found missing is added at its end, in that order (`if a;`: `then`, `fi`),
 * as it stands (`case x in`), or with a command where one is needed (`if a; then`). (A place of no width: `x=(1` has one more, over its text.)
 */
function missingAdded(tree: SyntaxTree): boolean {
  const places = tree.errors.filter((x) => x.startIndex === x.endIndex);
  if (tree.errors.some((x) => x.what.kind !== 'missing')) return false;
  const added = places.map((x) => (x.what as { token: string }).token);
  const withCommand = (t: string) => (t === 'then' || t === 'do' ? `${t}\n:` : t === 'esac' ? t : `:\n${t}`);
  return [added, added.map(withCommand)].some((list) => !tree.errorsOf(`${tree.text}\n${list.join('\n')}\n`).length);
}

/**
 * `word (`: bash reads a word and `(` as the start of a function's definition, and rejects the token after `(`, as any that is
 * not `)`: `echo (hello)` is near `hello`, and removing `)` fixes nothing. (With more words, or after a redirection, it is `(`
 * it rejects, which the parser says itself.) `function (`, with no name: the `(`.
 */
function wordParen(tree: SyntaxTree, e: SyntaxError): { node?: SyntaxNode; what: SyntaxErrorWhat } | undefined {
  for (const c of descendants(tree.root, ['command', 'function_definition'])) {
    if (c.startIndex > e.startIndex) return undefined;
    if (c.type === 'function_definition') {
      const name = field(c, 'name');
      if (name?.text === '(') return { node: name, what: { kind: 'token', token: '(' } };
      continue;
    }
    // (The parser keeps a word after `(` in the command, and an operator beside it.)
    const among = c.children.some((x) => x.type === '(') ? c.children : c.parent!.children;
    const at = among === c.children ? among.findIndex((x) => x.type === '(') : among.indexOf(c) + 1;
    const paren = among[at];
    if (paren?.type !== '(') {
      // (Or further up: `while word (`.)
      if (c.namedChildren.length === 1 && /^[ \t]*\(/.test(tree.text.slice(c.endIndex))) return { what: { kind: 'unreadable' } };
      continue;
    }
    // (Not a word alone before it: an assignment, a redirection.)
    if (c.children[0].type !== 'command_name') return { node: paren, what: { kind: 'token', token: '(' } };
    const after = among[at + 1];
    // (A redirection is its operator to bash; a newline, or a comment up to one, is what bash rejects then.)
    if (!after || after.startPosition.row !== paren.startPosition.row || after.type === 'comment' || after.field === 'redirect' || after.text.includes('\n')) return { what: { kind: 'unreadable' } };
    return { node: after, what: { kind: 'after-paren', token: after.text } };
  }
  return undefined;
}

/**
 * The first error of the tree, if bash stops at it. None if it does not, as the tools read it: a here-document that ends
 * with the file (bash warns, and runs it); what bash reads only when it runs it, so that the script goes on (a
 * here-document's body, backticks; `${ …; }` where bash lacks it); `!` alone; in sh, what dash reads otherwise. What comes
 * after such an error is not read as bash reads it, so that is all: only the first error is ever said.
 */
function findFault(tree: SyntaxTree, shell: Shell, version: BashVersion): SyntaxFault | undefined {
  // (A construct left open that nothing closes, as a here-document took its end.)
  const open = (n: SyntaxNode) => n.incomplete && !ENDS_ALONE.has(n.type);
  // (A backtick or a `${ ` left open stops bash as it reads the line, as any quote.)
  const later = (n: SyntaxNode, at: number, chain: readonly SyntaxNode[]) => (n.type === 'heredoc_body' ? !chain.slice(0, at).some(open)
    : !n.incomplete && (readWhenExpanded(n) || (n.type === 'command_substitution' && substitutionForm(n).startsWith('${') && lacks('funsub', version))));
  const e = tree.errors[0];
  const chain = around(tree.root, e);
  // (`!` alone is a complete command to bash, of status 1: `BANG list_terminator` in its grammar.)
  if (chain.some((n) => n.type === 'negated_command' && n.incomplete)) return undefined;
  const delimiter = e.what.kind === 'heredoc' ? chain.find((n) => n.type === 'heredoc_redirect')?.namedChildren.find((c) => c.type === 'heredoc_start')?.text : undefined;
  // (A here-document that ends with the file: bash warns, and runs it, unless it took the end of a construct around it.)
  if ((delimiter !== undefined && !chain.some(open)) || chain.some(later) || (shell === 'sh' && dashReads(tree, chain, e))) return undefined;
  // (`[[ a b ]]`: the parser misses the `]]` just before the word it cannot read, the word that bash names.)
  const next = tree.errors[1];
  const named = e.startIndex === e.endIndex && next?.kind === 'unreadable' && !tree.text.slice(e.startIndex, next.startIndex).trim() ? next : e;
  const at = named === e ? chain : around(tree.root, named);
  const before = wordParen(tree, named);
  const what: SyntaxErrorWhat = before?.what ?? (delimiter !== undefined ? { kind: 'missing', token: delimiter } : bashNames(tree, shell, [...chain, ...at], named));
  const top = at[1] ?? at[0];
  const parent = at[at.length - 2];
  return {
    node: before?.node ?? pointAt(at, named, what), what,
    // (The commands that end on its line are read with it: `fi )`.)
    firstRow: tree.root.namedChildren.find((c) => c.endPosition.row >= continuedFrom(tree.text, top.startPosition.row))!.startPosition.row, lastRow: top.endPosition.row,
    said: chain.some((n) => strayKeyword(n) !== undefined || (n.type === 'compound_statement' && n.namedChildren.some(braceAsArgument)))
      || ('token' in named.what && named.what.token === '}' && parent !== undefined && parent.namedChildren.some((c) => c.endIndex <= named.startIndex && gluedBrace(c))),
  };
}

/** What ends a script, or changes how the rest is read: a function or an alias may close what looks open, a file sourced may do any of it. */
const MAY_END: ReadonlySet<string> = new Set(['exit', 'exec', 'eval', 'alias', 'trap', 'source', '.', 'shopt', 'kill', 'logout']);
/**
 * The options of `set` after which a script may never get to a line and still exit 0: `-t` (`onecmd`) runs one more command
 * and exits with its status. `-n` (`noexec`) runs nothing. `-e` and `-u` are not here: they stop a script only with a failing
 * status, so a script that works never holds a fault it stops before, and the text says "if the shell reaches this line".
 * Measured in test/syntax-error.test.ts: "stops first only with a failing status".
 */
const SET_STOPS = /^-[A-Za-z]*[nt]|^(?:noexec|onecmd)$/;
/**
 * `#!/bin/bash -t`: the same, from the first line. Run as a program, `-s` reads stdin (exit 0, with none), and `-c` runs its word: neither reads
 * the file. Of the long options, only those that leave the reading alone are not here (`--version`, `--help`, `--rcfile` exit 0).
 */
const SHEBANG_STOPS = /^#!.*\s(?:-[A-Za-z]*[nstc]|--(?!(?:login|posix|noprofile|norc)?(?:\s|$)))/;
/** `mapfile -C "exit 0;"`: the callback runs in this shell. */
const CALLBACK = /^-[A-Za-z]*C/;

/**
 * Whether a command may end the script or change how it is read. The word is enough, wherever it is (a function body, a
 * branch, a list), and no path is followed: `shellState.dead()` trusts nothing when the tree has an error. A name read
 * only when it runs may be any of them. `return` ends a file sourced, outside a function.
 */
function mayEnd(c: SyntaxNode): boolean {
  const name = commandName(c);
  if (name === undefined) return true;
  const words = () => fields(c, 'argument').map((a) => staticWordValue(a));
  switch (name) {
    case 'command': case 'builtin': return words().some((w) => w === undefined || w === 'set' || w === 'mapfile' || w === 'readarray' || MAY_END.has(w));
    case 'mapfile': case 'readarray': return words().some((w) => w === undefined || CALLBACK.test(w));
    case 'set': return words().some((w) => w === undefined || SET_STOPS.test(w));
    case 'return': return !ancestor(c, (a) => a.type === 'function_definition');
    default: return MAY_END.has(name);
  }
}

/**
 * What a template engine replaces before a shell reads the code: Jinja and Go (`{{ x }}`, `{% if a %}`), ERB (`<% a %>`),
 * autoconf (`@VAR@`), CircleCI's parameters (`<< parameters.x >>`), GitLab's inputs (`$[[ inputs.x ]]`). Anywhere in the file.
 */
const TEMPLATE = /\{\{|\{%|<%|@[A-Za-z_]\w*@|<<[#^/]?\s*(?:parameters|pipeline)\.|\$\[\[/;

/** Whether the text is what a shell reads, as it is written, in a shell whose reading is known. */
function surelyText(tree: SyntaxTree, shell: Shell): boolean {
  // (With CRs in the text, it is not what bash reads: a CR after `&&` is a command, `fi` before one a word. The problem
  // `crlf` says so. A NUL on the first line makes bash refuse the file: "cannot execute binary file", status 126.)
  return (shell === 'bash' || shell === 'sh') && !tree.carriageReturns && !tree.text.includes('\0') && !TEMPLATE.test(tree.text) && !SHEBANG_STOPS.test(tree.text.split('\n', 1)[0]);
}

const ends = new WeakMap<SyntaxTree, number>();

/** Where the first command that may end the script or change how it is read has ended its name; Infinity with none. */
function firstEnd(tree: SyntaxTree): number {
  let at = ends.get(tree);
  if (at === undefined) {
    at = Math.min(Infinity, ...descendants(tree.root, ['command']).filter((c) => field(c, 'name') && mayEnd(c)).map((c) => field(c, 'name')!.endIndex));
    ends.set(tree, at);
  }
  return at;
}

/**
 * The gate of whatever says a fault of a script's text: whether a shell surely reads the text up to offset `at`, as it is
 * written. Nothing before it may end the script or change how it is read, and the text is one a shell reads as it stands.
 * A failing stop of `set -e` or `set -u` may come first, which no script that works has: see `SET_STOPS`.
 */
export function surelyRead(tree: SyntaxTree, shell: Shell, at: number): boolean {
  return surelyText(tree, shell) && firstEnd(tree) > at;
}

const cache = new WeakMap<SyntaxTree, Map<string, SyntaxFault | undefined>>();

/**
 * The syntax error bash stops at in the script of `tree`, where a shell surely gets to it (`surelyRead`). The caller says
 * that the text is surely a script (`Shells.script`).
 */
export function syntaxFault(tree: SyntaxTree, shell: Shell, version: BashVersion = DEFAULT_BASH_VERSION): SyntaxFault | undefined {
  if (!tree.errors.length || !surelyText(tree, shell)) return undefined;
  const key = `${shell} ${version}`;
  let known = cache.get(tree);
  if (!known) cache.set(tree, (known = new Map()));
  if (!known.has(key)) {
    const fault = findFault(tree, shell, version);
    known.set(key, fault && surelyRead(tree, shell, fault.node.startIndex) ? fault : undefined);
  }
  return known.get(key);
}
