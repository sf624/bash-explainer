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
    const tree = this.parser.parse(text);
    // Only when parsing is cancelled or times out, which this extension never asks for.
    if (!tree) throw new Error('tree-sitter returned no tree');
    return tree;
  }
}

export async function createBashParser(wasm: WasmPaths | WasmBinaries): Promise<BashParser> {
  initialized ??= 'runtime' in wasm
    ? Parser.init({ wasmBinary: wasm.runtime })
    : Parser.init({ locateFile: (name: string) => `${wasm.runtimeDir.replace(/[\\/]$/, '')}/${name}` });
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
