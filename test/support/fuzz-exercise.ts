import { Analyzer } from '../../src/analyzer';
import { documentIssues } from '../../src/document';
import type { Shell } from '../../src/dialect';
import type { SyntaxTree } from '../../src/syntax/tree';
import type { createUnbashParser } from '../../src/syntax/adapters/unbash';
import { fuzzInputs } from './fuzz';
import { corpus } from './corpus';

// The analyzer and the checks must not throw on any tree, whatever is typed: the extension explains the line the user is typing.
// The inputs of test/syntax-fuzz.test.ts are cut into chunks, one test file each (test/syntax-fuzz-analyzer-N.test.ts
// and test/syntax-fuzz-prefixes-N.test.ts): chunk k of n holds the inputs at the indexes k, k + n, k + 2n ...;
// together the chunks hold exactly the inputs of the one test they replace.

const analyzers = { en: new Analyzer('en'), ja: new Analyzer('ja') };
const shells: Shell[] = ['sh', 'bash', 'zsh'];

/** The text of a failure, or undefined when the analyzer and the document checks take the tree of `text`. */
export function exerciseTree(ub: ReturnType<typeof createUnbashParser>, text: string): string | undefined {
  let t: SyntaxTree;
  try {
    t = ub.parse(text);
  } catch {
    return undefined; // the parser's own test reports it
  }
  const lines = text.split(/\r?\n/);
  try {
    for (const lang of ['en', 'ja'] as const) {
      for (let i = 0; i < lines.length; i++) for (const shell of [undefined, 'zsh'] as const) analyzers[lang].explainLine(t, i, shell);
      for (const forced of shells) documentIssues({ lines, tree: t }, lang, { forced });
    }
  } catch (e) {
    return `${JSON.stringify(text)}: throws ${(e as Error).stack?.split('\n').slice(0, 3).join(' | ')}`;
  }
  return undefined;
}

/** The inputs of the fuzz in chunk `k` of `n`. */
export function fuzzChunk(k: number, n: number): string[] {
  return fuzzInputs().filter((_, i) => i % n === k);
}

/** Every distinct prefix of every line of the fixtures, in the order of the one test, in chunk `k` of `n`. */
export function prefixChunk(k: number, n: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const f of corpus().files) {
    for (const line of f.text.split('\n')) {
      for (let len = 1; len <= line.length; len++) {
        const prefix = line.slice(0, len);
        if (seen.has(prefix)) continue;
        seen.add(prefix);
        out.push(prefix);
      }
    }
  }
  return out.filter((_, i) => i % n === k);
}
