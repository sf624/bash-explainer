import type { BashParser, SyntaxTree } from './tree';

/** Caches one syntax tree per document, re-parsing only when the document version changes. */
export class TreeCache {
  private entries = new Map<string, { version: number; tree: SyntaxTree }>();

  constructor(private parser: BashParser) {}

  get(key: string, version: number, text: () => string): SyntaxTree {
    const hit = this.entries.get(key);
    if (hit && hit.version === version) return hit.tree;
    const tree = this.parser.parse(text());
    this.entries.set(key, { version, tree });
    return tree;
  }

  evict(key: string): void {
    this.entries.delete(key);
  }

  dispose(): void {
    this.entries.clear();
  }
}
