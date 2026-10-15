import * as path from 'path';
import Parser = require('web-tree-sitter');

export type SyntaxNode = Parser.SyntaxNode;
export type Tree = Parser.Tree;

export interface WasmPaths {
  /** Directory containing `tree-sitter.wasm` (the web-tree-sitter runtime). */
  runtimeDir: string;
  /** Path to `tree-sitter-bash.wasm`. */
  bashWasm: string;
}

let initialized: Promise<void> | undefined;

export async function createBashParser(paths: WasmPaths): Promise<Parser> {
  initialized ??= Parser.init({ locateFile: (name: string) => path.join(paths.runtimeDir, name) });
  await initialized;
  const bash = await Parser.Language.load(paths.bashWasm);
  const parser = new Parser();
  parser.setLanguage(bash);
  return parser;
}

/** Caches one parse tree per document, re-parsing only when the document version changes. */
export class TreeCache {
  private entries = new Map<string, { version: number; tree: Tree }>();

  constructor(private parser: Parser) {}

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
