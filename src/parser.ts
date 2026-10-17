import { Language, Node, Parser, Tree as TSTree } from 'web-tree-sitter';

export type SyntaxNode = Node;
export type Tree = TSTree;

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

/** A parser for bash that always returns a tree (web-tree-sitter's `parse` may return null). */
export class BashParser {
  constructor(private readonly parser: Parser) {}

  parse(text: string): Tree {
    let tree = this.parseText(text);
    // tree-sitter-bash reads an extended glob in an argument, `rm !(*.txt)`, as a word and a subshell.
    // Hide its parentheses and `|` from the parser, so it becomes one word, and parse again; node
    // texts still come from the original text.
    let masked = text;
    for (let round = 0; round < 8; round++) {
      const next = maskExtglobs(masked, tree.rootNode);
      if (next === masked) break;
      tree.delete();
      masked = next;
      tree = this.parseText(masked);
    }
    if (masked !== text) (tree as unknown as { textCallback: (index: number) => string }).textCallback = (index) => text.slice(index);
    return tree;
  }

  private parseText(text: string): Tree {
    const tree = this.parser.parse(text);
    // Only when parsing is cancelled or times out, which this extension never asks for.
    /* c8 ignore next */
    if (!tree) throw new Error('tree-sitter returned no tree');
    return tree;
  }
}

/** Stand-ins for `(`, `)` and `|` of an extended glob: word characters for tree-sitter, of the same length. */
const MASK: Record<string, string> = { '(': '\u2985', ')': '\u2986', '|': '\u2502' };

/**
 * `text` with the extended globs that tree-sitter split masked: `?(`, `*(`, `+(`, `@(` or `!(` where
 * the operator ends a word (so not `! (cmd)` nor `!(cmd)` negating a subshell, nor `*` in arithmetic).
 */
function maskExtglobs(text: string, root: SyntaxNode): string {
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

export async function createBashParser(wasm: WasmPaths | WasmBinaries): Promise<BashParser> {
  // The runtime is set up once, by the first parser made.
  const runtime = 'runtime' in wasm
    ? { wasmBinary: wasm.runtime }
    : { locateFile: (name: string) => `${wasm.runtimeDir.replace(/[\\/]$/, '')}/${name}` };
  initialized ??= Parser.init(runtime);
  await initialized;
  const bash = await Language.load('bash' in wasm ? wasm.bash : wasm.bashWasm);
  const parser = new Parser();
  parser.setLanguage(bash);
  return new BashParser(parser);
}

/** Caches one parse tree per document, re-parsing only when the document version changes. */
export class TreeCache {
  private entries = new Map<string, { version: number; tree: Tree }>();

  constructor(private parser: BashParser) {}

  get(key: string, version: number, text: () => string): Tree {
    const hit = this.entries.get(key);
    if (hit && hit.version === version) return hit.tree;
    hit?.tree.delete();
    const tree = this.parser.parse(text());
    this.entries.set(key, { version, tree });
    return tree;
  }

  evict(key: string): void {
    this.entries.get(key)?.tree.delete();
    this.entries.delete(key);
  }

  dispose(): void {
    for (const { tree } of this.entries.values()) tree.delete();
    this.entries.clear();
  }
}
