// Syntax highlighting computed from our own syntax tree, the one the explanations are made from, so
// that the colours of a script follow bash's reading of it (a heredoc ends where bash ends it). Pure:
// no DOM, no editor; the web page turns the spans into marks, and a language server could serve them
// as semantic tokens.
import type { ShellDocument } from './document';
import type { Extracted } from './hosts';
import type { SyntaxNode, SyntaxTree } from './syntax/tree';

/** What a span of the script is. A small, stable set: the web page has a class for each. */
export type HighlightKind =
  | 'comment'
  | 'keyword' // if, then, for, case, function, time, !, {, }, [[, ]], ((, ))
  | 'builtin' // a command bash runs itself (cd, echo, local, [, …)
  | 'command' // the name of any other command
  | 'function' // a call to a function the script defines
  | 'functionName' // the name in a function definition
  | 'option' // -x, --long
  | 'string' // '…', "…", $'…', $"…"
  | 'heredoc' // the body of a heredoc
  | 'heredocDelimiter' // EOF in <<EOF and on the line that ends the body
  | 'variable' // $x, ${…}, $?, and names in arithmetic
  | 'assignment' // the name being set in x=1, local x, for x in, read into by declare…
  | 'substitution' // $( ) ` ` <( ) >( ) $(( )): the delimiters
  | 'number' // in arithmetic
  | 'operator' // | && || ; & ;; and the operators of tests and arithmetic
  | 'redirect' // > >> 2>&1 < <<EOF <<< and the descriptor number
  | 'glob' // * ? [ … ] and extglob @( … ) in words the shell expands
  | 'error'; // text the parser could not read

export interface HighlightSpan {
  /** Offsets in the text the tree was built from (UTF-16 code units); `to` is exclusive. */
  readonly from: number;
  readonly to: number;
  readonly kind: HighlightKind;
}

/** The kinds in a fixed order: index 0 is "nothing". */
const KINDS: readonly (HighlightKind | null)[] = [null, 'comment', 'keyword', 'builtin', 'command', 'function', 'functionName', 'option', 'string',
  'heredoc', 'heredocDelimiter', 'variable', 'assignment', 'substitution', 'number', 'operator', 'redirect', 'glob', 'error'];
/** Every kind. */
export const HIGHLIGHT_KINDS = KINDS.slice(1) as HighlightKind[];
const CODE = new Map(KINDS.map((k, i) => [k, i]));

/** The builtins of bash 5 (`compgen -b`), and `[[`'s cousins that bash also runs itself. */
export const BUILTINS: ReadonlySet<string> = new Set([
  '.', ':', '[', 'alias', 'bg', 'bind', 'break', 'builtin', 'caller', 'cd', 'command', 'compgen', 'complete', 'compopt', 'continue', 'declare',
  'dirs', 'disown', 'echo', 'enable', 'eval', 'exec', 'exit', 'export', 'false', 'fc', 'fg', 'getopts', 'hash', 'help', 'history', 'jobs', 'kill',
  'let', 'local', 'logout', 'mapfile', 'popd', 'printf', 'pushd', 'pwd', 'read', 'readarray', 'readonly', 'return', 'set', 'shift', 'shopt',
  'source', 'suspend', 'test', 'times', 'trap', 'true', 'type', 'typeset', 'ulimit', 'umask', 'unalias', 'unset', 'wait',
]);

const KEYWORDS = new Set(['if', 'then', 'else', 'elif', 'fi', 'for', 'in', 'do', 'done', 'while', 'until', 'case', 'esac', 'select', 'function',
  'time', 'coproc', '!', '{', '}', '[[', ']]', '((', '))']);
const SUBSTITUTIONS = new Set(['command_substitution', 'process_substitution', 'arithmetic_expansion']);
const REDIRECTS = new Set(['file_redirect', 'heredoc_redirect', 'herestring_redirect']);
const EXPRESSIONS = new Set(['binary_expression', 'unary_expression', 'ternary_expression', 'postfix_expression', 'parenthesized_expression']);

export interface HighlightOptions {
  /** Only the spans that overlap these offsets (the visible part of a long script); the subtrees outside are skipped. */
  readonly range?: { readonly from: number; readonly to: number };
}

/**
 * The spans of the script to colour, sorted and without overlaps: where constructs nest, the innermost
 * wins (a `$x` inside a string is a variable; the commands inside `"$( … )"` are code again).
 * Text with no span is plain. It never throws on a broken tree: what the parser could not read is an
 * `error` span, and an unclosed construct runs to where the parser stopped it.
 */
export function highlight(tree: SyntaxTree, options: HighlightOptions = {}): HighlightSpan[] {
  const text = tree.text;
  const from = Math.max(0, options.range?.from ?? 0);
  const to = Math.min(text.length, options.range?.to ?? text.length);
  const paint = new Uint8Array(text.length);
  const set = (a: number, b: number, kind: HighlightKind | null): void => {
    paint.fill(CODE.get(kind)!, Math.max(a, from), Math.min(b, to));
  };
  const functions = definedFunctions(tree.root);

  const visit = (n: SyntaxNode, arith: boolean): void => {
    if (n.endIndex < from || n.startIndex > to) return;
    if (!n.named) return token(n, arith);
    const kind = nodeKind(n, arith, functions);
    if (kind !== undefined) set(n.startIndex, n.endIndex, kind);
    if (n.type === 'comment' || n.type === 'raw_string' || n.type === 'ansi_c_string' || n.type === 'error') return;
    if (n.type === 'word') return words(n, set);
    if (n.type === 'extglob_pattern') return glob(n, set);
    for (const c of n.children) visit(c, childArith(n, c, arith));
  };

  /** A keyword or operator, coloured by where it stands. */
  const token = (t: SyntaxNode, arith: boolean): void => {
    const p = t.parent!.type;
    let kind: HighlightKind | null;
    if (SUBSTITUTIONS.has(p)) kind = 'substitution';
    else if (REDIRECTS.has(p)) kind = 'redirect';
    else if (p === 'test_command' || p === 'declaration_command' || p === 'unset_command') kind = 'builtin';
    else if (p === 'string' || p === 'translated_string' || p === 'expansion' || p === 'simple_expansion' || p === 'subscript' || p === 'variable_assignment' || p === 'brace_expression') kind = null;
    else if (arith || EXPRESSIONS.has(p)) kind = p === 'arithmetic_command' && KEYWORDS.has(t.type) ? 'keyword' : 'operator';
    else kind = KEYWORDS.has(t.type) ? 'keyword' : 'operator';
    // The `$` and quotes of a string are painted with the string already.
    if (kind !== null) set(t.startIndex, t.endIndex, kind);
  };

  visit(tree.root, false);
  // The CRs of Windows line ends, masked as spaces, are not part of any span.
  for (const i of tree.carriageReturns ?? []) if (i < paint.length) paint[i] = 0;

  const out: HighlightSpan[] = [];
  for (let i = from; i < to;) {
    const k = paint[i];
    let j = i + 1;
    while (j < to && paint[j] === k) j++;
    if (k) out.push({ from: i, to: j, kind: KINDS[k]! });
    i = j;
  }
  return out;
}

/** Whether `c`, a child of `n`, is read as arithmetic. */
function childArith(n: SyntaxNode, c: SyntaxNode, arith: boolean): boolean {
  switch (n.type) {
    case 'arithmetic_expansion': case 'arithmetic_command': return true;
    // for (( i = 0; i < 3; i++ )): not the loop's body.
    case 'c_style_for_statement': return c.field === 'initializer' || c.field === 'condition' || c.field === 'update';
    case 'subscript': return arith || c.field === 'index';
    // A string or a command substitution inside arithmetic is read as such.
    case 'string': case 'command_substitution': case 'process_substitution': return false;
    default: return arith;
  }
}

/** The kind of a whole named node (its children may paint over it), null to clear it, undefined to leave it. */
function nodeKind(n: SyntaxNode, arith: boolean, functions: ReadonlySet<string>): HighlightKind | null | undefined {
  switch (n.type) {
    case 'comment': return 'comment';
    case 'error': return 'error';
    case 'string': case 'raw_string': case 'ansi_c_string': case 'translated_string': return 'string';
    case 'heredoc_body': return 'heredoc';
    case 'heredoc_start': case 'heredoc_end': return 'heredocDelimiter';
    case 'simple_expansion': case 'expansion': return 'variable';
    // Code inside a string or a heredoc is code again.
    case 'command_substitution': case 'process_substitution': case 'arithmetic_expansion': return null;
    case 'file_descriptor': return 'redirect';
    case 'number': return arith ? 'number' : n.parent?.type === 'file_redirect' && n.field === 'destination' ? 'redirect' : undefined;
    case 'variable_name': case 'special_variable_name': {
      // The name of an array element (`a[1]=x`, `${a[1]}`) is read as the element.
      const owner = n.parent!.type === 'subscript' ? n.parent!.parent! : n.parent!;
      return owner.type === 'simple_expansion' || owner.type === 'expansion' || arith ? 'variable' : 'assignment';
    }
    case 'test_operator': return 'option';
    case 'command_name': {
      const w = n.namedChildren.length === 1 && n.namedChildren[0].type === 'word' ? n.namedChildren[0].text : undefined;
      if (w === undefined) return undefined;
      return functions.has(w) ? 'function' : BUILTINS.has(w) ? 'builtin' : 'command';
    }
    case 'word':
      if (n.field === 'name' && n.parent!.type === 'function_definition') return 'functionName';
      if (arith && /^[A-Za-z_]\w*$/.test(n.text)) return 'variable';
      return undefined;
    default: return undefined;
  }
}

/** The names the script defines as functions (`f() …`, `function f …`), wherever. */
function definedFunctions(root: SyntaxNode): Set<string> {
  const out = new Set<string>();
  const visit = (n: SyntaxNode): void => {
    if (n.type === 'function_definition') {
      const name = n.children.find((c) => c.field === 'name');
      if (name) out.add(name.text);
    }
    for (const c of n.namedChildren) visit(c);
  };
  visit(root);
  return out;
}

type Painter = (from: number, to: number, kind: HighlightKind | null) => void;

/** A plain word: an option where a command takes one, or glob characters where the shell expands it. */
function words(w: SyntaxNode, set: Painter): void {
  const p = w.parent!;
  if (isOption(w)) {
    const eq = w.text.indexOf('=');
    set(w.startIndex, eq > 0 ? w.startIndex + eq : w.endIndex, 'option');
    return;
  }
  let at: SyntaxNode = w;
  while (at.parent!.type === 'concatenation') at = at.parent!;
  const q = at.parent!.type;
  const expanded = (q === 'command' && at.field === 'argument') || ((q === 'for_statement' || q === 'select_statement') && at.field === 'value')
    || q === 'case_item' || q === 'test_command' || (p.type === 'file_redirect' && w.field === 'destination') || isPattern(at);
  if (expanded) glob(w, set);
}

/** The right side of `=`, `==` or `!=` in `[[ ]]`: a pattern. */
function isPattern(w: SyntaxNode): boolean {
  const p = w.parent!;
  if (p.type !== 'binary_expression' || w.field !== 'right' || !p.children.some((c) => c.field === 'operator' && ['=', '==', '!='].includes(c.type))) return false;
  let e = p;
  while (e.parent!.type === 'binary_expression' || e.parent!.type === 'unary_expression' || e.parent!.type === 'parenthesized_expression') e = e.parent!;
  return e.parent!.type === 'extended_test';
}

/** `-x` or `--long` as an argument (not after `--`), or in `[ … ]` and `declare -A`. */
function isOption(w: SyntaxNode): boolean {
  if (!/^(--?[^-=\s]|--$)/.test(w.text) || w.text === '-') return false;
  const p = w.parent!;
  if (p.type === 'test_command' || p.type === 'declaration_command') return true;
  if (p.type !== 'command' || w.field !== 'argument') return false;
  return !p.children.slice(0, p.children.indexOf(w)).some((a) => a.field === 'argument' && a.text === '--');
}

/** The glob characters of a word: `*`, `?`, `[…]`, and the brackets and bars of `@( | )` and its kin. */
function glob(w: SyntaxNode, set: Painter): void {
  const s = w.text;
  const at = w.startIndex;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') {
      i++;
    } else if ('?*+@!'.includes(c) && s[i + 1] === '(') {
      set(at + i, at + i + 2, 'glob');
      depth++;
      i++;
    } else if (depth && (c === ')' || c === '|')) {
      set(at + i, at + i + 1, 'glob');
      if (c === ')') depth--;
    } else if (c === '*' || c === '?') {
      set(at + i, at + i + 1, 'glob');
    } else if (c === '[') {
      const close = s.indexOf(']', i + 2);
      if (close > 0) {
        set(at + i, at + close + 1, 'glob');
        i = close;
      }
    }
  }
}

/** A span within one line: zero-based line, and columns in that line (UTF-16 code units). */
export interface LineSpan {
  readonly line: number;
  readonly from: number;
  readonly to: number;
  readonly kind: HighlightKind;
}

/** The spans cut at line ends, as editors take them: one per line piece, the line ends left out. */
export function lineSpans(spans: readonly HighlightSpan[], text: string): LineSpan[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  const out: LineSpan[] = [];
  let line = 0;
  for (const s of spans) {
    while (line + 1 < starts.length && starts[line + 1] <= s.from) line++;
    for (let l = line, a = s.from; ; a = starts[++l]) {
      const end = Math.min(s.to, l + 1 < starts.length ? starts[l + 1] - 1 : text.length);
      if (end > a) out.push({ line: l, from: a - starts[l], to: end - starts[l], kind: s.kind });
      if (end >= s.to) break;
    }
  }
  return out;
}

/**
 * The spans of the shell code of a host file, moved back to the original text, one per line piece.
 * A part of text the host rewrote (the name inside `${CC}` for make's `$(CC)`) has no place there and is dropped.
 */
export function hostedHighlight(spans: readonly HighlightSpan[], extracted: Extracted): LineSpan[] {
  return lineSpans(spans, extracted.text)
    .map((s) => ({ ...s, from: extracted.maps[s.line][s.from], to: extracted.maps[s.line][s.to] }))
    .filter((s) => s.to > s.from);
}

/** The spans of a document, in its own lines: a shell script, or the shell code of a host file. */
export function documentHighlight(doc: ShellDocument): LineSpan[] {
  const spans = highlight(doc.tree);
  return doc.extracted ? hostedHighlight(spans, doc.extracted) : lineSpans(spans, doc.tree.text);
}
