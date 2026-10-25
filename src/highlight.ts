// Syntax highlighting computed from our own syntax tree, the one the explanations are made from, so
// that the colours of a script follow bash's reading of it (a heredoc ends where bash ends it), and from the
// models (src/semanticFacts.ts): what a command name runs, which words a command reads as options, which variables
// are readonly or exported. Pure: no DOM, no editor; the web page turns the spans into marks, and the editors get
// them as semantic tokens (src/semanticTokens.ts). docs/design/highlighting.md has the design.
import type { Shell } from './dialect';
import type { ShellDocument, Shells } from './document';
import type { CommandSpec } from './argv/spec';
import { actsOnNames } from './argv/query';
import { builtins } from './dict/builtins';
import type { Extracted } from './hosts';
import { scriptTree } from './hosts/scripts';
import { type HighlightModifier, semanticFacts } from './semanticFacts';
import { shellState } from './semantics/state';
import { field, type SyntaxNode, type SyntaxTree } from './syntax/tree';
import { bracketWords, writtenAsBracket } from './testexpr';

/** What a span of the script is. A small, stable set: the web page has a class for each. */
export type HighlightKind =
  | 'comment'
  | 'keyword' // if, then, for, case, function, time, !, {, }, [[, ]], ((, ))
  | 'builtin' // a command bash runs itself (cd, echo, local, [, …)
  | 'command' // the name of a program (any other command)
  | 'function' // a call to a function the script defines, where the function is defined
  | 'alias' // a name an alias replaces
  | 'functionName' // the name in a function definition
  | 'option' // -x, --long
  | 'argument' // a word that looks like an option but that the command reads as data (`grep -e -v`)
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
  /** What the state says of a variable there (absent when nothing). */
  readonly modifiers?: readonly HighlightModifier[];
}

/** The kinds in a fixed order: index 0 is "nothing". */
const KINDS: readonly (HighlightKind | null)[] = [null, 'comment', 'keyword', 'builtin', 'command', 'function', 'alias', 'functionName', 'option', 'argument',
  'string', 'heredoc', 'heredocDelimiter', 'variable', 'assignment', 'substitution', 'number', 'operator', 'redirect', 'glob', 'error'];
const MODIFIERS: readonly HighlightModifier[] = ['readonly', 'exported'];
/** Every kind. */
export const HIGHLIGHT_KINDS = KINDS.slice(1) as HighlightKind[];
const CODE = new Map(KINDS.map((k, i) => [k, i]));

/** The builtins whose operands name variables (or functions, `OperandSpec.acts`): `declare x`, `unset x`. */
const NAMES_VARIABLES: ReadonlySet<string> = new Set(Object.keys(builtins).filter((name) => actsOnNames(builtins[name])));

const KEYWORDS = new Set(['if', 'then', 'else', 'elif', 'fi', 'for', 'in', 'do', 'done', 'while', 'until', 'case', 'esac', 'select', 'function',
  'time', 'coproc', '!', '{', '}', '[[', ']]', '((', '))']);
const SUBSTITUTIONS = new Set(['command_substitution', 'process_substitution', 'arithmetic_expansion']);
const REDIRECTS = new Set(['file_redirect', 'heredoc_redirect', 'herestring_redirect']);
const EXPRESSIONS = new Set(['binary_expression', 'unary_expression', 'ternary_expression', 'postfix_expression', 'parenthesized_expression']);

export interface HighlightOptions {
  /** Only the spans that overlap these offsets (the visible part of a long script); the subtrees outside are skipped. */
  readonly range?: { readonly from: number; readonly to: number };
  /** The shell that runs the script (bash when absent), for what its command names run. */
  readonly shell?: Shell;
  /** Commands the host defines (bats' `run`), as for `shellState`. */
  readonly host?: Record<string, CommandSpec>;
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

  const visit = (n: SyntaxNode, arith: boolean): void => {
    if (n.endIndex < from || n.startIndex > to) return;
    if (!n.named) return token(n, arith);
    const kind = nodeKind(n, arith);
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
    else if (p === 'string' || p === 'translated_string' || p === 'expansion' || p === 'simple_expansion' || p === 'subscript' || p === 'variable_assignment' || p === 'brace_expression') kind = null;
    else if (arith || EXPRESSIONS.has(p)) kind = p === 'arithmetic_command' && KEYWORDS.has(t.type) ? 'keyword' : 'operator';
    else kind = KEYWORDS.has(t.type) ? 'keyword' : 'operator';
    // The `$` and quotes of a string are painted with the string already.
    if (kind !== null) set(t.startIndex, t.endIndex, kind);
  };

  visit(tree.root, false);
  // What the models say (command names, options by the specs, variables' attributes) paints over the tree's guess.
  const mods = new Uint8Array(text.length);
  const model = shellState(tree, options.shell, options.host ? { host: options.host } : {});
  for (const f of semanticFacts(tree, model, options.shell, { from, to })) {
    if (f.kind) set(f.from, f.to, f.kind);
    if (f.modifiers) mods.fill(f.modifiers.reduce((bits, m) => bits | (1 << MODIFIERS.indexOf(m)), 0), Math.max(f.from, from), Math.min(f.to, to));
  }
  // The CRs of Windows line ends, masked as spaces, are not part of any span.
  for (const i of tree.carriageReturns ?? []) if (i < paint.length) paint[i] = 0;

  const out: HighlightSpan[] = [];
  for (let i = from; i < to;) {
    const k = paint[i];
    const m = mods[i];
    let j = i + 1;
    while (j < to && paint[j] === k && mods[j] === m) j++;
    if (k) out.push({ from: i, to: j, kind: KINDS[k]!, ...(m ? { modifiers: MODIFIERS.filter((_, b) => m & (1 << b)) } : {}) });
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
function nodeKind(n: SyntaxNode, arith: boolean): HighlightKind | null | undefined {
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
    case 'word':
      if (n.field === 'name' && n.parent!.type === 'function_definition') return 'functionName';
      if (arith && /^[A-Za-z_]\w*$/.test(n.text)) return 'variable';
      return undefined;
    default: return undefined;
  }
}

type Painter = (from: number, to: number, kind: HighlightKind | null) => void;

/** A plain word: an option where a command takes one, or glob characters where the shell expands it. */
function words(w: SyntaxNode, set: Painter): void {
  const p = w.parent!;
  // The last `]` of `[ … ]` goes with the `[`, a builtin by its spelling (what runs is for the explanation to say).
  if (writtenAsBracket(p) && bracketWords(p).close === w) {
    set(w.startIndex, w.endIndex, 'builtin');
    return;
  }
  if (isOption(w)) {
    const eq = w.text.indexOf('=');
    set(w.startIndex, eq > 0 ? w.startIndex + eq : w.endIndex, 'option');
    return;
  }
  // The names of `declare x` and `unset x y` are coloured as the names an assignment sets, by the command's
  // spelling (`a` of `local a[1]`).
  const named = p.type === 'command' && w.field === 'argument' && NAMES_VARIABLES.has(field(p, 'name')!.text) ? /^[A-Za-z_]\w*(?=$|\[.*\]$)/s.exec(w.text) : null;
  if (named) {
    set(w.startIndex, w.startIndex + named[0].length, 'assignment');
    return;
  }
  let at: SyntaxNode = w;
  while (at.parent!.type === 'concatenation') at = at.parent!;
  const q = at.parent!.type;
  const expanded = (q === 'command' && at.field === 'argument') || ((q === 'for_statement' || q === 'select_statement') && at.field === 'value')
    || q === 'case_item' || (p.type === 'file_redirect' && w.field === 'destination') || isPattern(at);
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

/**
 * `-x` or `--long` as an argument (not after `--`), or in `[ … ]`: the tree's guess. Where the command has a spec, its
 * reading paints over it (src/semanticFacts.ts: `unset x -v y` reads `-v` as a name, `grep -e -v` as the pattern).
 */
function isOption(w: SyntaxNode): boolean {
  if (!/^(--?[^-=\s]|--$)/.test(w.text) || w.text === '-') return false;
  const p = w.parent!;
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
  readonly modifiers?: readonly HighlightModifier[];
}

/** The offsets at which the lines of `text` start. */
function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  return starts;
}

/** The spans cut at line ends, as editors take them: one per line piece, the line ends left out. */
export function lineSpans(spans: readonly HighlightSpan[], text: string, starts = lineStarts(text)): LineSpan[] {
  const out: LineSpan[] = [];
  let line = 0;
  for (const s of spans) {
    while (line + 1 < starts.length && starts[line + 1] <= s.from) line++;
    for (let l = line, a = s.from; ; a = starts[++l]) {
      const end = Math.min(s.to, l + 1 < starts.length ? starts[l + 1] - 1 : text.length);
      if (end > a) out.push({ line: l, from: a - starts[l], to: end - starts[l], kind: s.kind, ...(s.modifiers ? { modifiers: s.modifiers } : {}) });
      if (end >= s.to) break;
    }
  }
  return out;
}

/**
 * The spans of the shell code of a host file, moved back to the original text, one per line piece.
 * A part of text the host rewrote (the name inside `${CC}` for make's `$(CC)`) has no place there and is dropped.
 * With `skipInserted`, nothing is left over the text the extraction inserted or rewrote (`$(wildcard *.tmp)` for
 * `${make_wildcard}`): that is host syntax, and a span partly over it is clipped.
 */
export function hostedHighlight(spans: readonly HighlightSpan[], extracted: Extracted, skipInserted = false): LineSpan[] {
  return hostedLines(lineSpans(spans, extracted.text), extracted, skipInserted);
}

/** `hostedHighlight` of spans already cut at the line ends of the extracted text. */
function hostedLines(spans: readonly LineSpan[], extracted: Extracted, skipInserted: boolean): LineSpan[] {
  const pieces = spans.flatMap((s) => {
    if (!skipInserted) return [s];
    const out: LineSpan[] = [];
    let from = s.from;
    for (const [a, b] of [...extracted.inserted[s.line]].sort((x, y) => x[0] - y[0])) {
      if (b <= from || a >= s.to) continue;
      if (a > from) out.push({ ...s, from, to: a });
      from = Math.max(from, b);
    }
    if (from < s.to) out.push({ ...s, from });
    return out;
  });
  return pieces
    .map((s) => ({ ...s, from: extracted.maps[s.line][s.from], to: extracted.maps[s.line][s.to] }))
    .filter((s) => s.to > s.from);
}

export interface DocumentHighlightOptions {
  /** The shells the explanations use: a script is read as `forced ?? detected`, a host file's code as `forced ?? its region's`. */
  readonly shells?: Shells;
  /** Only the spans on these lines (inclusive), and the models read there only (the model of a script is still built whole, once per tree). */
  readonly lines?: { readonly from: number; readonly to: number };
  /** See `hostedHighlight`. */
  readonly skipInserted?: boolean;
}

/** The offsets of `lines` (inclusive) in a text whose lines start at `starts`. */
function offsetsOf(starts: readonly number[], length: number, lines: { from: number; to: number }): { from: number; to: number } {
  return { from: starts[Math.min(lines.from, starts.length - 1)], to: lines.to + 1 < starts.length ? starts[lines.to + 1] - 1 : length };
}

/**
 * The spans of a document, in its own lines: a shell script, or the shell code of a host file. Each shell of a host
 * file (a workflow step, a RUN instruction, a recipe line) is read with its own tree and model (`scriptTree`), as the
 * explanations read it: a function of one step is not one in the next.
 */
export function documentHighlight(doc: ShellDocument, opts: DocumentHighlightOptions = {}): LineSpan[] {
  const { tree, extracted } = doc;
  const forced = opts.shells?.forced;
  if (!extracted) {
    const starts = lineStarts(tree.text);
    const range = opts.lines && offsetsOf(starts, tree.text.length, opts.lines);
    return lineSpans(highlight(tree, { range, shell: forced ?? opts.shells?.detected }), tree.text, starts);
  }
  const lines: LineSpan[] = [];
  const done = new Set<SyntaxTree>();
  for (const region of extracted.regions) {
    if (opts.lines && (region.end < opts.lines.from || region.start > opts.lines.to)) continue;
    const own = scriptTree(tree, extracted, region);
    if (done.has(own)) continue;
    done.add(own);
    const starts = lineStarts(own.text);
    const range = opts.lines && offsetsOf(starts, own.text.length, opts.lines);
    lines.push(...lineSpans(highlight(own, { range, shell: forced ?? region.shell, ...(region.commands ? { host: region.commands } : {}) }), own.text, starts));
  }
  // (Each shell of a host file has lines of its own: put together, their spans are in order once sorted by line.)
  if (done.size > 1) lines.sort((a, b) => a.line - b.line || a.from - b.from);
  return hostedLines(lines, extracted, opts.skipInserted ?? false);
}
