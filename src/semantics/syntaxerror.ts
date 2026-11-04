import { type BashVersion, DEFAULT_BASH_VERSION, lacks } from '../bashversion';
import type { Shell } from '../shellfeatures';
import { braceAsArgument, descendants, field, gluedBrace, readWhenExpanded, strayKeyword, substitutionForm, type SyntaxError, type SyntaxErrorWhat, type SyntaxNode, type SyntaxTree } from '../syntax/tree';
import { plainText, reachedAt } from './scriptstops';

// The syntax error bash stops at in a script, from the parser's errors (`SyntaxTree.errors`), for the problem
// `syntax-error` and the line's sentence. bash reads a script as it runs it, one complete command at a time, and stops
// at the first it cannot read. So `bash -n` is no measure of what a script does: code never reached is no fault of a script
// that works (`exit 0` before a payload, a polyglot). The worst outcome is a false failure, so it is said only as far as it
// is known: the first error of a file surely a script of bash or sh (`Shells.script`), after no sure stop and in a text with no
// template marker (src/semantics/scriptstops.ts, whose `readAs` gives its level; docs/design/three-levels.md). test/syntax-error.test.ts compares this with real shells, by running them.

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
  // (`f()` with blank lines after it: the parser puts what is missing at the end of the file, past the construct left open.)
  const open = out.length === 1 && e.startIndex === e.endIndex ? root.children.filter((c) => c.endIndex <= i && c.incomplete).pop() : undefined;
  if (open) out.push(open);
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
  // (`$'a\'`: to dash a `$`, and a quote that ends at the second `'`. It reads every quote after that otherwise, so anywhere in the file.)
  if (tree.text.includes("$'")) return true;
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
const NAMED_TOKEN = /^(?:[()!}]|;;&?|;&?|&&?|\|[|&]?|\]\]|then|do|done|fi|else|elif|esac)$/;

/** `$(( ))`, `(( ))`: what bash reads as text first, to its `))`, and as a subshell if that fails. The parser reads arithmetic. */
const ARITHMETIC: ReadonlySet<string> = new Set(['arithmetic_expansion', 'arithmetic_command', 'c_style_for_statement']);

/**
 * Whether the error is the parser's alone, from the text before it, where bash reads on:
 * - `done < <(ls).txt`: one word to bash; the parser ends it at the `)` on a compound command's redirection.
 * - `$((x) y)`: arithmetic to the parser, a subshell to bash.
 * - `$(a case )`, `<(a case )`: the word `case` to bash; the parser looks for its `esac`.
 */
function parserAlone(text: string, at: number): boolean {
  const before = text.slice(0, at);
  const open = before.lastIndexOf('((');
  return (before.endsWith(')') && /[<>]\(/.test(before)) || (open > before.lastIndexOf('))') && text.includes(')', open))
    || /[$<>]\([^)]*(?<![\w./-])case(?![\w./-])[^)]*$/.test(before);
}

/** Quotes, an escape (a line continuation too) and a comment, for `readsOtherwise`: none of their text is an operator. */
const OPAQUE = /\\[^]|'[^']*'|"(?:[^"\\]|\\[^])*"|(?<!\S)#[^\n]*/g;
/**
 * In the text with its operators replaced (`readsOtherwise`), what the parser reads on from where bash has stopped already. `×`
 * is `&&`, `||` or `|&`; `÷` the end of a case item; `>` any redirection.
 */
const STOPS_BEFORE = [
  // An operator with no command before it.
  /(?:^|[;&|(×÷\n])\s*[;&|×]/,
  /(?<![\w.\/-])(?:if|then|elif|else|while|until|do|time|coproc|\{|!)\s*[;&|×]/,
  // A redirection with no word after it, where the line goes on.
  />[ \t]*(?:[\n;&|×÷()>]|\d+>|function(?![\w.\/-]))/,
  // A function's parentheses, with no name before them or no body after them.
  /\([ \t]*\)[ \t]*[;&|×]/,
  /(?:^|[;&|×\n])[ \t]*\([ \t]*\)/,
  // The head of `case`, `for` and `function`, which the parser recovers from at another word.
  /(?<![\w.\/-])case\s+\S+\s+(?!\s|in(?![\w.\/-]))/,
  /(?<![\w.\/-])case(?:\s+\S*)?$/,
  /(?<![\w.\/-])for[ \t]+\w+[ \t]+(?![ \t]|(?:in|do)(?![\w.\/-]))/,
  /(?<![\w.\/-])for(?:[ \t]+(?![ \t]|\w+[ \t\n;])|[\n;&|×]|$)/,
  /(?<![\w.\/-])(?:for|select)[ \t]+\w+\s+in(?![\w.\/-])[^;\n]*[&|×]/,
  // A reserved word where bash wants a command (one after an operator, or after a word that opens a list).
  /(?:[|×]|(?<![\w.\/-])(?:if|while|until|time|coproc|done|fi|esac))\s*(?:function|then|do|done|fi|else|elif|esac)(?![\w.\/-])/,
  /\)\s*time(?![\w.\/-])/,
  /(?<![\w.\/-])coproc[ \t]*\n/,
  /(?<![\w.\/-])function(?:\s+[\w-]*[ \t]*[;&|×)>\n]|\s+[^\s\w(-])/,
  // `[[ ]]` with an operand missing: its `]]` is the operand. What is left open is `readsOtherwise`.
  /(?:\[\[|[!=~>×])[ \t]*\]\]/,
];

/**
 * Whether bash has stopped, or reads otherwise, somewhere in `before` (the text up to what the parser stops at), so that
 * what the parser found is not what bash names: the parser takes what bash rejects (`if a; || then`), and goes on to
 * a later token. It says that it cannot be sure: what is said then names nothing, and so it may say that too often.
 */
function readsOtherwise(text: string, before: string): boolean {
  const opaque = before.replace(OPAQUE, '"');
  if (/<<(?!<)[^\n]*$/.test(opaque) || opaque.lastIndexOf('[[') > opaque.lastIndexOf(']]') || /\$\[/.test(text) || (text.replace(OPAQUE, '"').match(/`/g)?.length ?? 0) % 2 === 1) return true;
  const clauses = opaque.match(/(?<![\w./-])(?:if|elif|then|else)(?![\w./-])/g) ?? [];
  if (clauses.some((w, i) => /^(?:else|elif)$/.test(w) && /^(?:if|elif)$/.test(clauses[i - 1] ?? ''))) return true;
  const operators = opaque.replace(/&&|\|\||\|&/g, '×').replace(/;;&|;;|;&/g, '÷').replace(/[<>]\(/g, 'P').replace(/&>>?|<<<|<<-|<<|>>|<>|>\||>&|<&|</g, '>');
  return STOPS_BEFORE.some((r) => r.test(operators));
}

/**
 * What the parser found, where bash names the same; else `unreadable`, which names nothing. test/syntax-error.test.ts holds the
 * table: each shape of a fault against `bash -n` and `dash -n`, so a token that bash does not name fails. The parser
 * recovers and goes on where bash stops, so:
 * - A token is said only as a reserved word or an operator, which bash takes as it stands, and where bash has read what is before it as the parser did (`readsOtherwise`).
 * - What is missing is said where the text reads in full with it added (`missingAdded`): bash then got to the end of the file. A `$( )` left open is read
 *   to its `)` first, so what is open inside it is not what bash says.
 */
function bashNames(tree: SyntaxTree, shell: Shell, chain: readonly SyntaxNode[], e: SyntaxError): SyntaxErrorWhat {
  const { what } = e;
  const inOpen = chain.some((n) => (n.type === 'command_substitution' || n.type === 'process_substitution') && n.incomplete);
  // (`coproc function (`: bash reads on past `coproc`, the parser stops there.)
  if (what.kind !== 'token' && what.kind !== 'missing') return inOpen || (what.kind === 'after' && what.token === 'coproc') ? { kind: 'unreadable' } : what;
  if (what.token.includes('\n')) return { kind: 'unreadable' };
  const said = what.kind === 'token'
    ? NAMED_TOKEN.test(what.token) && !inOpen && !chain.some((n) => ARITHMETIC.has(n.type))
    : what.token !== ';' && !chain.some((n) => n.type === 'extended_test') && (!inOpen || what.token === ')' || what.token === '`') && missingAdded(tree);
  return said && !(shell === 'sh' && dashNamesOther(chain, what)) ? what : { kind: 'unreadable' };
}

/** Where dash, the `sh` of the levels, stops at another token than bash: bash's own operators, `case`, a backtick left open. */
function dashNamesOther(chain: readonly SyntaxNode[], what: SyntaxErrorWhat & { token: string }): boolean {
  return what.kind === 'missing' ? what.token === ')' || what.token === '`' : /^(?:;;&|;&|\|&)$/.test(what.token) || chain.some((n) => n.type === 'case_statement');
}

/** What dash stops at, as no syntax of its own, before the parser's place. */
const DASH_STOPS = /[<>=]\(|\(\(|<<<|!\s+!|;&|\|&|&>/;

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
  if (parserAlone(tree.text, e.startIndex)) return undefined;
  // (`${ { a; }`: what bash 5.2 and dash read as text, to a `}`, at run time; the parser reads a command.)
  if ((shell === 'sh' || lacks('funsub', version)) && /\$\{[\s|]/.test(tree.text)) return undefined;
  // (`[[ a b ]]`: the parser misses the `]]` just before the word it cannot read, the word that bash names.)
  const next = tree.errors[1];
  const named = e.startIndex === e.endIndex && next?.kind === 'unreadable' && !tree.text.slice(e.startIndex, next.startIndex).trim() ? next : e;
  const at = named === e ? chain : around(tree.root, named);
  const before = wordParen(tree, named);
  const found: SyntaxErrorWhat = before?.what ?? (delimiter !== undefined ? { kind: 'missing', token: delimiter } : bashNames(tree, shell, [...chain, ...at], named));
  // (A substitution after `(`: bash prints it in its own form, not as it is written.)
  const upTo = tree.text.slice(0, named.startIndex);
  const what: SyntaxErrorWhat = readsOtherwise(tree.text, upTo) || (shell === 'sh' && DASH_STOPS.test(upTo)) || (found.kind === 'after-paren' && /[(`]/.test(found.token)) ? { kind: 'unreadable' } : found;
  const top = at[1] ?? at[0];
  const parent = at[at.length - 2];
  const fromRow = continuedFrom(tree.text, top.startPosition.row);
  return {
    node: before?.node ?? pointAt(at, named, what), what,
    // (The commands that end on its line are read with it: `fi )`.)
    firstRow: tree.root.namedChildren.find((c) => c.endPosition.row >= fromRow)!.startPosition.row, lastRow: top.endPosition.row,
    said: chain.some((n) => strayKeyword(n) !== undefined || (n.type === 'compound_statement' && n.namedChildren.some(braceAsArgument)))
      || ('token' in named.what && named.what.token === '}' && parent !== undefined && parent.namedChildren.some((c) => c.endIndex <= named.startIndex && gluedBrace(c))),
  };
}

const cache = new WeakMap<SyntaxTree, Map<string, SyntaxFault | undefined>>();

/**
 * The syntax error bash stops at in the script of `tree`, where a shell may get to it (`reachedAt`), in a text as a shell reads it
 * (`plainText`). The caller says that the text is surely a script (`Shells.script`), and gives its level (`readAs`).
 */
export function syntaxFault(tree: SyntaxTree, shell: Shell, version: BashVersion = DEFAULT_BASH_VERSION): SyntaxFault | undefined {
  if (!tree.errors.length || (shell !== 'bash' && shell !== 'sh') || !plainText(tree)) return undefined;
  const key = `${shell} ${version}`;
  let known = cache.get(tree);
  if (!known) cache.set(tree, (known = new Map()));
  if (!known.has(key)) {
    const fault = findFault(tree, shell, version);
    known.set(key, fault && reachedAt(tree, fault.node.startIndex) ? fault : undefined);
  }
  return known.get(key);
}
