// The tree-sitter adapter: turns web-tree-sitter's tree for tree-sitter-bash into the model of
// ../tree.ts, as plain objects (see docs/design/syntax-tree.md). The only module that imports
// web-tree-sitter or knows tree-sitter's node names; the normalizations the design lists happen here.
import { Language, Parser } from 'web-tree-sitter';
import type { Node, Tree } from 'web-tree-sitter';
import type { BashParser, FieldName, NodeType, Point, SyntaxError, SyntaxNode, SyntaxTree } from '../tree';

export interface WasmPaths {
  /** Directory (or, in a browser, URL) containing `web-tree-sitter.wasm`, the web-tree-sitter runtime. */
  runtimeDir: string;
  /** Path (or URL) to `tree-sitter-bash.wasm`. */
  bashWasm: string;
}

/** The wasm files themselves, for hosts that read them on their own (VS Code, also on the web). */
export interface WasmBinaries {
  runtime: Uint8Array;
  bash: Uint8Array;
}

let initialized: Promise<void> | undefined;

/** A tree-sitter parser for bash whose `parse` always returns a tree (web-tree-sitter's may return null), with the extended globs read as words. The trees are raw: free them with `delete()`. Tests of the grammar use it; the rest of the code uses `createTreeSitterParser`. */
export async function createRawParser(wasm: WasmPaths | WasmBinaries): Promise<{ parse(text: string): Tree }> {
  // The runtime is set up once, by the first parser made.
  const runtime = 'runtime' in wasm
    ? { wasmBinary: wasm.runtime }
    : { locateFile: (name: string) => `${wasm.runtimeDir.replace(/[\\/]$/, '')}/${name}` };
  initialized ??= Parser.init(runtime);
  await initialized;
  const bash = await Language.load('bash' in wasm ? wasm.bash : wasm.bashWasm);
  const parser = new Parser();
  parser.setLanguage(bash);
  return { parse: (text) => parseMasked(parser, text) };
}

/** Every type of the model. A test checks that tree-sitter-bash's named types all map into it. */
export const NODE_TYPES: Record<NodeType, true> = {
  program: true, comment: true, command: true, command_name: true, declaration_command: true, unset_command: true,
  variable_assignment: true, variable_assignments: true, negated_command: true, redirected_statement: true,
  pipeline: true, list: true, time_statement: true, coproc_statement: true, compound_statement: true, subshell: true,
  do_group: true, if_statement: true, elif_clause: true, else_clause: true, case_statement: true, case_item: true,
  for_statement: true, select_statement: true, c_style_for_statement: true, while_statement: true,
  function_definition: true, arithmetic_command: true, test_command: true, extended_test: true, word: true,
  concatenation: true, string: true, string_content: true, raw_string: true, ansi_c_string: true,
  translated_string: true, number: true, extglob_pattern: true, regex: true, brace_expression: true, array: true,
  simple_expansion: true, expansion: true, variable_name: true, special_variable_name: true, subscript: true,
  command_substitution: true, process_substitution: true, arithmetic_expansion: true, binary_expression: true,
  unary_expression: true, parenthesized_expression: true, ternary_expression: true, postfix_expression: true,
  test_operator: true, file_redirect: true, file_descriptor: true, heredoc_redirect: true, heredoc_start: true,
  heredoc_body: true, heredoc_content: true, heredoc_end: true, herestring_redirect: true, error: true,
};

/** Every field name of the model. A test checks that tree-sitter-bash's field names are all in it. */
export const FIELD_NAMES: Record<FieldName, true> = {
  name: true, value: true, argument: true, operator: true, left: true, right: true, body: true, condition: true,
  descriptor: true, destination: true, index: true, variable: true, redirect: true, option: true,
  initializer: true, update: true, alternative: true, consequence: true, operand: true, fallthrough: true,
  termination: true,
};

/** A tree-sitter tree, with the extended globs that tree-sitter splits read as words. Free it with `delete()`. */
export function parseMasked(parser: Parser, text: string): Tree {
  let tree = parseText(parser, text);
  // tree-sitter-bash reads an extended glob in an argument, `rm !(*.txt)`, as a word and a subshell.
  // Hide its parentheses and `|` from the parser, so it becomes one word, and parse again; node
  // texts still come from the original text.
  let masked = text;
  for (let round = 0; round < 8; round++) {
    const next = maskExtglobs(masked, tree.rootNode);
    if (next === masked) break;
    tree.delete();
    masked = next;
    tree = parseText(parser, masked);
  }
  if (masked !== text) (tree as unknown as { textCallback: (index: number) => string }).textCallback = (index) => text.slice(index);
  return tree;
}

function parseText(parser: Parser, text: string): Tree {
  const tree = parser.parse(text);
  // Only when parsing is cancelled or times out, which this extension never asks for.
  /* c8 ignore next */
  if (!tree) throw new Error('tree-sitter returned no tree');
  return tree;
}

/** Stand-ins for `(`, `)` and `|` of an extended glob: word characters for tree-sitter, of the same length. */
const MASK: Record<string, string> = { '(': '⦅', ')': '⦆', '|': '│' };

/**
 * `text` with the extended globs that tree-sitter split masked: `?(`, `*(`, `+(`, `@(` or `!(` where
 * the operator ends a word (so not `! (cmd)` nor `!(cmd)` negating a subshell, nor `*` in arithmetic).
 */
export function maskExtglobs(text: string, root: Node): string {
  let out = text;
  for (const m of text.matchAll(/[?*+@!]\(/g)) {
    const at = m.index!;
    const leaf = root.descendantForIndex(at, at + 1);
    if (!leaf || leaf.type !== 'word' || leaf.endIndex !== at + 1) continue;
    // The matching `)`, skipping nested parentheses and quotes.
    let depth = 0;
    let end = -1;
    for (let k = at + 1; k < text.length && end < 0; k++) {
      const c = text[k];
      if (c === '\\') k++;
      else if (c === "'" || c === '"') { const q = text.indexOf(c, k + 1); if (q < 0) break; k = q; }
      else if (c === '\n') break;
      else if (c === '(') depth++;
      else if (c === ')' && --depth === 0) end = k;
    }
    if (end < 0) continue;
    out = out.slice(0, at + 1) + out.slice(at + 1, end + 1).replace(/[()|]/g, (c) => MASK[c]) + out.slice(end + 1);
  }
  return out;
}

type Mut = {
  -readonly [K in keyof SyntaxNode]: K extends 'children' | 'namedChildren' ? Mut[] : K extends 'parent' ? Mut | null : SyntaxNode[K];
};
interface Span { startIndex: number; endIndex: number; startPosition: Point; endPosition: Point }
/** A child of a tree-sitter node, with the field it has there. */
interface Part { n: Node; field: FieldName | null }

class Converter {
  readonly errors: SyntaxError[] = [];
  constructor(private readonly text: string) {}

  node(type: string, named: boolean, span: Span, parent: Mut | null, field: FieldName | null): Mut {
    const m: Mut = {
      type, named, text: this.text.slice(span.startIndex, span.endIndex), startIndex: span.startIndex, endIndex: span.endIndex,
      startPosition: span.startPosition, endPosition: span.endPosition, parent, children: [], namedChildren: [], field, incomplete: false,
    };
    if (parent) {
      parent.children.push(m);
      if (named) parent.namedChildren.push(m);
    }
    return m;
  }

  /** The children of `n` that are not MISSING, with their fields. */
  parts(n: Node): Part[] {
    const out: Part[] = [];
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)!;
      if (!c.isMissing) out.push({ n: c, field: n.fieldNameForChild(i) as FieldName | null });
    }
    return out;
  }

  /** MISSING tokens are left out of the tree: the construct they would close is incomplete. */
  noteMissing(n: Node, into: Mut): void {
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)!;
      if (!c.isMissing) continue;
      into.incomplete = true;
      this.errors.push({ kind: 'missing', message: `Missing "${c.type}"`, startIndex: c.startIndex, endIndex: c.endIndex });
    }
  }

  kind(n: Node): string {
    if (n.isError) return 'error';
    const at = (s: string): boolean => this.text.startsWith(s, n.startIndex);
    switch (n.type) {
      case 'compound_statement': return at('((') ? 'arithmetic_command' : n.type;
      case 'test_command': return at('[[') ? 'extended_test' : n.type;
      case 'for_statement': return at('select') ? 'select_statement' : n.type;
      default: return n.type;
    }
  }

  /** Converts `n`, and what is under it, into a child of `parent`. */
  convert(n: Node, parent: Mut | null, field: FieldName | null): Mut {
    if (n.type === 'pipeline' || n.type === 'command') {
      const t = this.time(n, parent, field);
      if (t) return t;
    }
    const m = this.node(this.kind(n), n.isNamed, n, parent, field);
    // (After a trailing `\`, tree-sitter adds an empty `ERROR` leaf next to the real one; it is not another place.)
    if (n.isError && (n.childCount || n.endIndex > n.startIndex)) this.errors.push({ kind: 'unreadable', message: 'Syntax error', startIndex: n.startIndex, endIndex: n.endIndex });
    this.noteMissing(n, m);
    if (m.type === 'test_command') this.flatTest(this.parts(n), m);
    else for (const p of this.parts(n)) this.convert(p.n, m, p.field);
    return m;
  }

  /**
   * `[ … ]` holds its words as a flat list, as the shell reads it: tree-sitter's groups (binary, unary and
   * parenthesized expressions) are opened, and operators and parentheses become words like the rest.
   */
  flatTest(parts: Part[], m: Mut, top = true): void {
    parts.forEach((p, i) => {
      const c = p.n;
      if (top && !c.isNamed && (i === 0 || i === parts.length - 1) && (c.type === '[' || c.type === ']')) this.convert(c, m, null);
      else if (c.type === 'binary_expression' || c.type === 'unary_expression' || c.type === 'parenthesized_expression') {
        this.noteMissing(c, m);
        this.flatTest(this.parts(c), m, false);
      } else if (!c.isNamed || c.type === 'test_operator') this.node('word', true, c, m, null);
      else this.convert(c, m, null);
    });
  }

  // Shapes where tree-sitter's tree nests what bash does not: `!` in front of a pipeline, redirections after
  // the last command of a pipeline or list, and what follows `<<EOF` on its line. They are rebuilt after
  // the conversion, from the finished nodes.

  normalize(n: Mut): void {
    for (const c of [...n.children]) this.normalize(c);
    if (n.type === 'pipeline') this.negation(n);
    else if (n.type === 'redirected_statement') this.redirections(n);
  }

  /** Gives `n` these children, in this order. */
  private setChildren(n: Mut, kids: Mut[]): void {
    n.children = kids;
    n.namedChildren = kids.filter((c) => c.named);
    for (const k of kids) k.parent = n;
  }

  /** Makes the range of `n` the one its children cover. */
  private fit(n: Mut): void {
    const first = n.children.reduce((a, c) => (c.startIndex < a.startIndex ? c : a));
    const last = n.children.reduce((a, c) => (c.endIndex > a.endIndex ? c : a));
    n.startIndex = first.startIndex;
    n.startPosition = first.startPosition;
    n.endIndex = last.endIndex;
    n.endPosition = last.endPosition;
    n.text = this.text.slice(n.startIndex, n.endIndex);
  }

  /** Puts `by` in the place of `old` among the children of `parent`, with the field `old` had. */
  private put(parent: Mut, old: Mut, by: Mut, field: FieldName | null): void {
    parent.children[parent.children.indexOf(old)] = by;
    parent.namedChildren = parent.children.filter((c) => c.named);
    by.parent = parent;
    by.field = field;
  }

  /** `! a | b`: tree-sitter negates `a`; bash negates the pipeline. */
  private negation(p: Mut): void {
    const neg = p.children[0];
    const operand = neg.type === 'negated_command' ? neg.namedChildren[0] : undefined;
    if (!operand) return;
    const bang = neg.children.find((c) => !c.named)!;
    this.put(p.parent!, p, neg, p.field);
    p.field = null;
    operand.field = null;
    this.setChildren(p, [operand, ...p.children.slice(1)]);
    this.fit(p);
    this.setChildren(neg, [bang, p]);
    this.fit(neg);
  }

  /** The command a chain of pipelines, lists, `!` and `time` ends with. */
  private lastLeaf(n: Mut): Mut {
    if (n.type === 'pipeline' || n.type === 'list') return this.lastLeaf(n.namedChildren[n.namedChildren.length - 1]);
    // (`time` and `!` with nothing after them are the command themselves.)
    const operand = n.type === 'time_statement' ? n.children.find((c) => c.field === 'body') : n.type === 'negated_command' ? n.namedChildren[0] : undefined;
    return operand ? this.lastLeaf(operand) : n;
  }

  /**
   * A `redirected_statement`: the grammar puts the redirections after the last command of a pipeline or list
   * on the whole of it (`echo A && echo B > f`); in bash they belong to that command. And everything after
   * `<<EOF` on its line is nested in the heredoc node: arguments and more redirections belong to the
   * command, and `| cmd`, `&& cmd` go on with the pipeline or list.
   */
  private redirections(r: Mut): void {
    const body = r.children.find((c) => c.field === 'body');
    if (!body) return;
    const redirects = r.children.filter((c) => c.field === 'redirect');
    const words: Mut[] = [];
    const tail: Mut[] = [];
    for (const h of redirects.filter((c) => c.type === 'heredoc_redirect')) {
      const own = ['<<', '<<-', 'heredoc_start', 'heredoc_body', 'heredoc_end'];
      for (const c of h.children) {
        if (own.includes(c.type)) continue;
        if (c.field === 'redirect') redirects.push(c);
        else if (c.field === 'argument') words.push(c);
        else tail.push(c);
      }
      this.setChildren(h, h.children.filter((c) => own.includes(c.type)));
    }
    redirects.sort((a, b) => a.startIndex - b.startIndex);
    let top: Mut;
    if (body.type === 'pipeline' || body.type === 'list' || body.type === 'negated_command' || body.type === 'time_statement') {
      const leaf = this.lastLeaf(body);
      const holder = leaf.parent!;
      const as = leaf.field;
      const wrapped = this.wrap(leaf, redirects, words);
      if (leaf === body) top = wrapped;
      else {
        if (wrapped !== leaf) this.put(holder, leaf, wrapped, as);
        for (let a = wrapped.parent; a && a !== r; a = a.parent) this.fit(a);
        top = body;
      }
      this.put(r.parent!, r, top, r.field);
    } else if (words.length && body.type === 'command') {
      top = this.wrap(body, redirects, words);
      this.put(r.parent!, r, top, r.field);
    } else {
      this.setChildren(r, [body, ...redirects]);
      this.fit(r);
      top = r;
    }
    if (tail.length) this.continueChain(top, tail);
  }

  /** `leaf` with these redirections (and the words that came after a heredoc): the leaf itself if they go inside it. */
  private wrap(leaf: Mut, redirects: Mut[], words: Mut[]): Mut {
    let outside = redirects;
    if (leaf.type === 'redirected_statement') {
      this.setChildren(leaf, [...leaf.children, ...redirects].sort((a, b) => a.startIndex - b.startIndex));
      this.fit(leaf);
      return leaf;
    }
    if (words.length && leaf.type === 'command') {
      // Redirections before the last word are among the words of the command.
      const lastWord = Math.max(...words.map((w) => w.startIndex));
      const inside = redirects.filter((c) => c.startIndex < lastWord);
      outside = redirects.filter((c) => c.startIndex > lastWord);
      this.setChildren(leaf, [...leaf.children, ...inside, ...words].sort((a, b) => a.startIndex - b.startIndex));
      this.fit(leaf);
      if (!outside.length) return leaf;
    }
    const r = this.node('redirected_statement', true, leaf, null, null);
    leaf.field = 'body';
    this.setChildren(r, [leaf, ...outside]);
    this.fit(r);
    return r;
  }

  /** The operators and operands of a pipeline or list, flattened in text order. */
  private flatten(n: Mut, out: { op?: Mut; operand?: Mut }[] = []): { op?: Mut; operand?: Mut }[] {
    for (const c of n.children) {
      if (!c.named) out.push({ op: c });
      else if (c.type === 'pipeline' || c.type === 'list') this.flatten(c, out);
      else out.push({ operand: c });
    }
    return out;
  }

  /** What follows a heredoc on its line, `| cmd && cmd`, goes on with the chain that ends in the command that has the heredoc. */
  private continueChain(top: Mut, tail: Mut[]): void {
    // (The new chain takes the place of `top` in its parent; `top` is part of the chain by then.)
    const parent = top.parent!;
    const field = top.field;
    const items = top.type === 'pipeline' || top.type === 'list' ? this.flatten(top) : [{ operand: top }];
    for (const c of tail) {
      if (!c.named) items.push({ op: c });
      else if (c.type === 'pipeline' || c.type === 'list') this.flatten(c, items);
      else items.push({ operand: c });
    }
    // `|` binds tighter than `&&` and `||`, which group to the left.
    let left: Mut | undefined;
    let logical: Mut | undefined;
    let group: Mut[] = [];
    const close = (): void => {
      // (An operator with nothing after it stays in the list as it is.)
      if (!group.length) {
        if (left && logical) left = this.container('list', [left, logical]);
        return;
      }
      const unit = group.length === 1 ? group[0] : this.container('pipeline', group);
      group = [];
      left = left ? this.container('list', [left, logical!, unit]) : unit;
    };
    for (const item of items) {
      const m = (item.op ?? item.operand)!;
      m.field = null;
      if (item.op && (item.op.type === '&&' || item.op.type === '||')) {
        close();
        logical = item.op;
      } else group.push(m);
    }
    close();
    this.put(parent, top, left!, field);
  }

  /** A new `pipeline` or `list` over these children. */
  private container(type: string, kids: Mut[]): Mut {
    const m = this.node(type, true, kids[0], null, null);
    this.setChildren(m, kids);
    this.fit(m);
    return m;
  }

  /** `time [-p] …` is a command named `time` to tree-sitter; the first command of a pipeline times all of it. */
  time(n: Node, parent: Mut | null, field: FieldName | null): Mut | undefined {
    const cmd = n.type === 'pipeline' ? n.child(0)! : n;
    const split = this.splitTime(cmd);
    if (!split) return undefined;
    const t = this.node('time_statement', true, n, parent, field);
    this.noteMissing(n, t);
    const word = cmd.child(0)!.child(0)!;
    this.node('time', false, word, t, null);
    if (split.option) this.convert(split.option.n, t, 'option');
    if (n === cmd) {
      // A command: `time ls -l`.
      this.body(cmd, split.rest, t, 'body');
    } else {
      // A pipeline: `time ls | wc`, timed as a whole.
      const rest = this.parts(n).slice(1);
      this.noteMissing(cmd, t);
      const pipe = this.node('pipeline', true, span(split.rest[0].n, n), t, 'body');
      this.body(cmd, split.rest, pipe, null);
      for (const p of rest) this.convert(p.n, pipe, p.field);
    }
    return t;
  }

  /** The parts of a `time` command: its option and the rest, or undefined if it is not `time` (or times nothing, in a pipeline). */
  splitTime(cmd: Node): { option?: Part; rest: Part[] } | undefined {
    if (cmd.type !== 'command') return undefined;
    // `FOO=1 time` and `"time"` run the program; `\time` is another word.
    const name = cmd.child(0)!;
    const word = name.child(0);
    if (name.type !== 'command_name' || word?.type !== 'word' || this.text.slice(word.startIndex, word.endIndex) !== 'time') return undefined;
    const parts = this.parts(cmd).slice(1);
    const option = parts[0] && parts[0].n.type === 'word' && this.text.slice(parts[0].n.startIndex, parts[0].n.endIndex) === '-p' ? parts[0] : undefined;
    const rest = option ? parts.slice(1) : parts;
    // In a pipeline, `time` is a keyword only at its start (`a | time b` runs the program), and `time | wc` has nothing to time: it stays a command.
    if (cmd.parent?.type === 'pipeline' && (cmd.parent.child(0)!.id !== cmd.id || !rest.length)) return undefined;
    return { option, rest };
  }

  /** What `time` times: a command made of `rest`, its first word being the name. */
  body(cmd: Node, rest: Part[], parent: Mut, field: FieldName | null): void {
    if (!rest.length) return;
    const c = this.node('command', true, span(rest[0].n, cmd), parent, field);
    rest.forEach((p, i) => {
      if (i) { this.convert(p.n, c, p.field); return; }
      const name = this.node('command_name', true, p.n, c, 'name');
      this.convert(p.n, name, null);
    });
  }
}

const span = (from: Span, to: Span): Span => ({
  startIndex: from.startIndex, endIndex: to.endIndex, startPosition: from.startPosition, endPosition: to.endPosition,
});

/**
 * The adapter's parser: parses with tree-sitter, copies the tree into plain objects, and frees the wasm tree.
 * The shapes where tree-sitter nests what bash does not (`!`, redirections at the end of a pipeline or
 * list, the rest of a heredoc line) are rebuilt; with `reshape: false` they stay as tree-sitter gives them,
 * so that a test can compare the conversion with tree-sitter's own tree.
 */
export async function createTreeSitterParser(wasm: WasmPaths | WasmBinaries, options: { reshape?: boolean } = {}): Promise<BashParser> {
  const bash = await createRawParser(wasm);
  return {
    parse(text: string): SyntaxTree {
      const tree = bash.parse(text);
      const conv = new Converter(text);
      const root = conv.convert(tree.rootNode, null, null);
      tree.delete();
      if (options.reshape !== false) conv.normalize(root);
      return { text, root, errors: conv.errors };
    },
  };
}
