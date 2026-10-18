// The tree-sitter adapter: turns web-tree-sitter's tree for tree-sitter-bash into the model of
// ../tree.ts, as plain objects (see docs/design/syntax-tree.md). The only module besides src/parser.ts
// that knows tree-sitter's node names; the normalizations the design lists happen here.
import type { Node, Parser, Tree } from 'web-tree-sitter';
import { createBashParser, WasmBinaries, WasmPaths } from '../../parser';
import type { BashParser, FieldName, NodeType, Point, SyntaxError, SyntaxNode, SyntaxTree } from '../tree';

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
      this.errors.push({ message: `Missing "${c.type}"`, startIndex: c.startIndex, endIndex: c.endIndex });
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
    if (n.isError) this.errors.push({ message: 'Syntax error', startIndex: n.startIndex, endIndex: n.endIndex });
    this.noteMissing(n, m);
    for (const p of this.parts(n)) this.convert(p.n, m, p.field);
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
    // In a pipeline, `time | wc` has nothing to time; it stays a command.
    if (cmd.parent?.type === 'pipeline' && cmd.parent.child(0)!.id === cmd.id && !rest.length) return undefined;
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

/** The adapter's parser: parses with tree-sitter, copies the tree into plain objects, and frees the wasm tree. */
export async function createTreeSitterParser(wasm: WasmPaths | WasmBinaries): Promise<BashParser> {
  const bash = await createBashParser(wasm);
  return {
    parse(text: string): SyntaxTree {
      const tree = bash.parse(text);
      const conv = new Converter(text);
      const root = conv.convert(tree.rootNode, null, null);
      tree.delete();
      return { text, root, errors: conv.errors };
    },
  };
}
