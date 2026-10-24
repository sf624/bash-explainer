// The reading tree of a line, for the tree view of the panel (docs/design/tree-view/README.md): who reads each part
// of the line, in four layers.
//
// - `bash`: bash parses the line into commands, and each simple command into its words, assignments and redirections.
//   These are the nodes of our syntax tree, which has bash's own commands (docs/design/syntax-tree.md, "Command nodes
//   at bash's granularity"; test/command-tokens.test.ts holds every token to one of them).
// - `child`: the text of a `$( )`, `<( )` or backquotes is parsed again, as a script of its own, by the child bash that
//   runs it: the commands under a substitution node.
// - `command`: each command reads its words as its spec says: the tokens of the argument interpreter (`Token.origin`
//   `argv`: options, operands, subcommands, a command it runs, the expression of `test`).
// - `language`: a language inside a word, read by its own rules: the tokens of an embedded explainer (`embedded`: a
//   regex, a sed script, a jq filter, a printf format…), grouped by `Token.language`.
//
// The layers come from the tree and from `Token.origin`, never from a label or an explanation. The explanations of
// the nodes are those of the tokens about the same text: bash's own (`shell`) for the nodes bash reads.
import type { Pos, Span, Token } from './analyzer-types';
import { anonSections, CONSTRUCTS, nodeSections } from './refs';
import { field, type SyntaxNode, type SyntaxTree } from './syntax/tree';

/** Who reads a part: bash, a child bash (in a substitution, or a string a command gives a shell), the command, a language. */
export type Layer = 'bash' | 'child' | 'command' | 'language';

/** What a node of bash's reading is (a node of the other layers has its token's kind). */
export type ShellKind =
  | 'line' // the line as bash reads it: the root
  | 'script' // the text of a substitution, as the child bash parses it
  | 'list' | 'pipeline' | 'command' | 'compound' | 'function'
  | 'word' | 'name' | 'assignment' | 'redirect' | 'heredoc'
  | 'quote' | 'expansion' | 'substitution' | 'arithmetic' | 'brace'
  | 'operator' | 'keyword' | 'comment'
  | 'part'; // another part of a construct: a clause, an expression

export interface ReadingNode {
  layer: Layer;
  /**
   * A `ShellKind` in the layers `bash` and `child` (except under a string a command gives a shell, which has tokens
   * only); in the others, the token's `Kind`, or `reading` (what a command reads: the root of its layer) and
   * `language` (the root of a language, labelled with its name).
   */
  kind: string;
  /** The code (its first line, shortened); the name of the command of a `reading`; the language of a `language`. */
  label: string;
  span: Span;
  /** What the explanation says about this part: the text of its token, when one is about it. */
  text?: string;
  /** The sections of the Bash manual it is about. */
  refs?: readonly string[];
  children: ReadingNode[];
}

const SUBSTITUTIONS = new Set(['command_substitution', 'process_substitution']);
/** The parts of a word bash reads: quotes, expansions, substitutions. */
const PARTS = new Set(['string', 'translated_string', 'raw_string', 'ansi_c_string', 'simple_expansion', 'expansion', 'arithmetic_expansion', 'brace_expression', ...SUBSTITUTIONS]);
/** The nodes that are a word to bash. */
const WORDS = new Set(['word', 'number', 'concatenation', 'extglob_pattern', 'regex', 'array', ...PARTS]);
const REDIRECTS = new Set(['file_redirect', 'heredoc_redirect', 'herestring_redirect']);
/** The kinds of token that explain a command: the root of what it reads. */
const READERS = new Set(['command', 'builtin', 'function', 'test']);
/** The kinds of token about a word, or a part of one. */
const WORD_TOKENS = new Set(['string', 'variable', 'expansion', 'substitution', 'number', 'pattern']);
/** Tokens that only end or separate: not shown. */
const SEPARATORS = new Set([';', '\n']);

const le = (a: Pos, b: Pos): boolean => a.line < b.line || (a.line === b.line && a.character <= b.character);
const point = (row: number, column: number): Pos => ({ line: row, character: column });
const spanOf = (n: SyntaxNode): Span => ({ start: point(n.startPosition.row, n.startPosition.column), end: point(n.endPosition.row, n.endPosition.column) });
const keyOf = (s: Span): string => `${s.start.line}:${s.start.character}-${s.end.line}:${s.end.character}`;
const within = (inner: Span, outer: Span): boolean => le(outer.start, inner.start) && le(inner.end, outer.end);

/** The first line of a text, shortened as the panel's labels are. */
function short(text: string): string {
  const line = text.split('\n')[0];
  return line.length > 60 ? `${line.slice(0, 59)}…` : line;
}

/**
 * The reading tree of the line whose explanation is `items` (`LineExplanation.items`, with their origins), in `tree`:
 * the parts of the tree the tokens cover, read by bash, then by the commands and languages inside them. Undefined when
 * the line has nothing to explain.
 */
export function readingTree(tree: SyntaxTree, items: readonly Token[]): ReadingNode | undefined {
  if (!items.length) return undefined;
  const range: Span = {
    // (The items are in the order of the text; one before may end later: `cat <<E; echo a` ends with its here-document.)
    start: items[0].span.start,
    end: items.map((t) => t.span.end).reduce((a, b) => (le(a, b) ? b : a)),
  };
  const all: Token[] = [];
  const walk = (t: Token): void => {
    all.push(t);
    t.children.forEach(walk);
  };
  items.forEach(walk);
  // bash's own tokens, by the text they are about.
  const shellAt = new Map<string, Token[]>();
  for (const t of all.filter((x) => x.origin === 'shell')) shellAt.set(keyOf(t.span), [...(shellAt.get(keyOf(t.span)) ?? []), t]);
  const tokenAt = (s: Span, kinds?: Set<string>): Token | undefined => shellAt.get(keyOf(s))?.find((t) => !kinds || kinds.has(t.kind));

  /** A node of bash's reading (or a child bash's), with the text and sections of its token if it has one. */
  const shellNode = (n: SyntaxNode, layer: Layer, kind: ShellKind, children: ReadingNode[], tokenKinds?: Set<string>, span = spanOf(n)): ReadingNode => {
    const t = tokenAt(span, tokenKinds);
    const refs = t?.refs ?? (n.named ? nodeSections(n) : anonSections(n));
    return { layer, kind, label: short(n.text), span, ...(t ? { text: t.explanation } : {}), ...(refs ? { refs } : {}), children };
  };

  /** The parts of the line in `n` that the explanation covers; `layer`: who reads `n`. */
  const collect = (n: SyntaxNode, layer: Layer): ReadingNode[] => n.children.flatMap((c) => {
    const s = spanOf(c);
    if (c.endIndex === c.startIndex || le(s.end, range.start) || le(range.end, s.start)) return [];
    if (within(s, range)) return node(c, layer);
    // A block around the line: its parts on the line. (A statement that is not a block is explained whole, so the
    // tokens cover a substitution in it whole.)
    return collect(c, layer);
  });

  const node = (c: SyntaxNode, layer: Layer): ReadingNode[] => {
    if (!c.named) {
      if (SEPARATORS.has(c.type) || (c.parent!.type === 'function_definition' && (c.type === '(' || c.type === ')'))) return [];
      return [shellNode(c, layer, /^[a-z]|^[{}!]$|^\[\[$|^\]\]$/.test(c.type) ? 'keyword' : 'operator', [], new Set(['keyword', 'operator']))];
    }
    switch (c.type) {
      case 'command': return [simple(c, layer)];
      case 'variable_assignment': return [assignment(c, layer)];
      case 'comment': return [shellNode(c, layer, 'comment', [])];
      case 'variable_name': case 'special_variable_name': return [shellNode(c, layer, 'name', [])];
      case 'list': return [construct(c, layer, 'list')];
      case 'pipeline': return [construct(c, layer, 'pipeline')];
      case 'function_definition': return [construct(c, layer, 'function')];
    }
    if (REDIRECTS.has(c.type)) return [redirect(c, layer)];
    if (WORDS.has(c.type)) return [word(c, layer)];
    return [construct(c, layer, CONSTRUCTS[c.type] ? 'compound' : 'part')];
  };

  /** A compound command, a list, a pipeline, a function: its parts in order, keywords and operators included. */
  const construct = (c: SyntaxNode, layer: Layer, kind: ShellKind): ReadingNode => {
    const children = c.children.flatMap((x) => (x.field === 'name' && kind === 'function' ? [shellNode(x, layer, 'name', [])] : node(x, layer)));
    const n = shellNode(c, layer, kind, children);
    // A skeleton names a compound command better than its first line (`if ‹condition› then … fi`).
    const t = tokenAt(n.span);
    if (t && kind !== 'list' && kind !== 'pipeline') n.label = t.label;
    return n;
  };

  /** A simple command: its words, assignments and redirections in order, then what the command reads of its words. */
  const simple = (c: SyntaxNode, layer: Layer): ReadingNode => {
    const children = c.namedChildren.flatMap((x) => (x.type === 'command_name' ? [word(x.namedChildren[0], layer)] : node(x, layer)));
    const n = shellNode(c, layer, 'command', children, new Set(['redirect']));
    // (Its text runs to the end of a here-document, past what follows it on the line: `cat <<E; echo b`.)
    const ends = c.namedChildren.map((x) => (x.type === 'heredoc_redirect' ? x.namedChildren.find((h) => h.type === 'heredoc_start')! : x).endIndex);
    n.label = short(c.text.slice(0, Math.max(...ends) - c.startIndex));
    const reading = readingOf(c);
    if (reading) n.children.push(reading);
    return n;
  };

  /** What the command `c` reads: its token, with the tokens the command and the languages read under it. */
  const readingOf = (c: SyntaxNode): ReadingNode | undefined => {
    const name = field(c, 'name');
    if (!name) return undefined;
    // The token of the command, the outermost about it (the first, parents before children): not one of a command in a
    // substitution inside it.
    const subs = c.namedChildren.flatMap(function inner(x: SyntaxNode): Span[] {
      return SUBSTITUTIONS.has(x.type) ? [spanOf(x)] : x.namedChildren.flatMap(inner);
    });
    const span = spanOf(c);
    const t = all
      .find((x) => x.origin === 'shell' && READERS.has(x.kind) && within(x.span, span) && !subs.some((s) => within(x.span, s)));
    if (!t) return undefined;
    return { layer: 'command', kind: 'reading', label: short(name.text), span: t.span, text: t.explanation, ...(t.refs ? { refs: t.refs } : {}), children: readParts(t.children, true) };
  };

  const word = (w: SyntaxNode, layer: Layer): ReadingNode => {
    // (A word that is a substitution says so in its part.)
    const n = shellNode(w, layer, 'word', wordParts(w, layer), SUBSTITUTIONS.has(w.type) ? new Set() : WORD_TOKENS);
    // A language in a word no command reads, which bash reads itself (the regex of `=~`), is under the word.
    if (w.parent!.type !== 'command' && w.parent!.type !== 'command_name') {
      for (const c of tokenAt(n.span, WORD_TOKENS)?.children ?? []) if (c.origin === 'embedded') language(n.children, c);
    }
    return n;
  };

  /** The parts bash reads in a word: when the word is one part, the parts of that part (a substitution stays one). */
  const wordParts = (w: SyntaxNode, layer: Layer): ReadingNode[] =>
    SUBSTITUTIONS.has(w.type) ? [part(w, layer)] : PARTS.has(w.type) ? part(w, layer).children : inner(w, layer);

  /** The parts under `n`, outermost first. */
  const inner = (n: SyntaxNode, layer: Layer): ReadingNode[] =>
    n.namedChildren.flatMap((c) => (PARTS.has(c.type) ? [part(c, layer)] : inner(c, layer)));

  const part = (p: SyntaxNode, layer: Layer): ReadingNode => {
    if (SUBSTITUTIONS.has(p.type)) {
      // The child bash parses the text between `$(` (or `<(`, a backquote) and the end.
      const open = p.children[0];
      const close = p.children[p.children.length - 1];
      const span: Span = { start: point(open.endPosition.row, open.endPosition.column), end: point(close.startPosition.row, close.startPosition.column) };
      const text = p.text.slice(open.endIndex - p.startIndex, close.startIndex - p.startIndex);
      const script: ReadingNode = { layer: 'child', kind: 'script', label: short(text.trim()), span, children: p.namedChildren.flatMap((c) => node(c, 'child')) };
      return shellNode(p, layer, 'substitution', [script]);
    }
    const kind: ShellKind = p.type === 'simple_expansion' || p.type === 'expansion' ? 'expansion'
      : p.type === 'arithmetic_expansion' ? 'arithmetic' : p.type === 'brace_expression' ? 'brace' : 'quote';
    return shellNode(p, layer, kind, inner(p, layer));
  };

  const assignment = (a: SyntaxNode, layer: Layer): ReadingNode => {
    const value = field(a, 'value');
    const parts = !value ? [] : PARTS.has(value.type) ? [part(value, layer)] : inner(value, layer);
    return shellNode(a, layer, 'assignment', [shellNode(field(a, 'name')!, layer, 'name', []), ...parts], new Set(['assignment']));
  };

  const redirect = (r: SyntaxNode, layer: Layer): ReadingNode => {
    if (r.type !== 'heredoc_redirect') return shellNode(r, layer, 'redirect', inner(r, layer), new Set(['redirect']));
    // A here-document: the operator and its word on the line, then its body.
    const start = r.namedChildren.find((c) => c.type === 'heredoc_start')!;
    const body = r.namedChildren.find((c) => c.type === 'heredoc_body')!;
    const span: Span = { start: point(r.startPosition.row, r.startPosition.column), end: point(start.endPosition.row, start.endPosition.column) };
    const n = shellNode(r, layer, 'redirect', [shellNode(body, layer, 'heredoc', inner(body, layer))], new Set(['redirect']), span);
    n.label = short(r.text.slice(0, start.endIndex - r.startIndex));
    return n;
  };

  /**
   * The tokens under a command's token as layers: what the command reads (`argv`), the languages (`embedded`), and the
   * scripts a command gives a shell (`script`). Bash's parts of a word are already in its layer: their tokens give way to
   * what is under them. `top`: the command's own token's parts, where bash's tokens are its name, assignments and
   * redirections.
   */
  const readParts = (tokens: readonly Token[], top: boolean): ReadingNode[] => {
    const out: ReadingNode[] = [];
    for (const t of tokens) {
      if (t.origin === 'argv') out.push(tokenNode(t, 'command'));
      else if (t.origin === 'embedded') language(out, t);
      else if (t.origin === 'script') out.push(tokenNode(t, 'child'));
      // (A substitution's commands are in bash's layer, under its child bash.)
      else if (!top && t.kind !== 'substitution') out.push(...readParts(t.children, false));
    }
    return out;
  };

  /** A token as a node of `layer`, and the tokens under it by their own origins. */
  const tokenNode = (t: Token, layer: Layer): ReadingNode => ({
    layer, kind: t.kind, label: t.label, span: t.span, text: t.explanation, ...(t.refs ? { refs: t.refs } : {}),
    children: layer === 'child'
      ? t.children.flatMap((c) => (c.origin === 'script' ? [tokenNode(c, 'child')] : readParts([c], false)))
      : readParts(t.children, false),
  });

  /** Adds a token of a language to `out`: under the node of its language, which it starts when it is the first. */
  const language = (out: ReadingNode[], t: Token): void => {
    const last = out[out.length - 1];
    const node = langNode(t);
    // (The outermost tokens of a language say which it is: `Token.language`.)
    if (last?.kind === 'language' && last.layer === 'language' && last.label === t.language) {
      last.children.push(node);
      last.span = { start: last.span.start, end: t.span.end };
    } else out.push({ layer: 'language', kind: 'language', label: t.language!, span: t.span, children: [node] });
  };
  const langNode = (t: Token): ReadingNode => ({
    layer: 'language', kind: t.kind, label: t.label, span: t.span, text: t.explanation, children: t.children.map(langNode),
  });

  return { layer: 'bash', kind: 'line', label: '', span: range, children: collect(tree.root, 'bash') };
}

/** Every node of a reading tree, depth first. */
export function readingNodes(n: ReadingNode): ReadingNode[] {
  return [n, ...n.children.flatMap(readingNodes)];
}
