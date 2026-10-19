// Helpers of the fuzz test (test/syntax-fuzz.test.ts): the inputs, from a fixed seed, and the checks of a tree.
import type { SyntaxNode, SyntaxTree } from '../../src/syntax/tree';
import { corpus, invariants } from './oracle';

/** A small, fast generator with a fixed seed (mulberry32). */
function random(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The inputs: from every unit of text, several prefixes, one or two words removed, and a random cut. */
export function fuzzInputs(seed = 20250101): string[] {
  const rnd = random(seed);
  const pick = (n: number): number => Math.floor(rnd() * n);
  const { files, snippets } = corpus();
  const units: string[] = [];
  for (const f of files) {
    const lines = f.text.split('\n');
    lines.forEach((l, i) => {
      if (l.trim().length > 1) {
        units.push(l);
        // Also with the line after it, for the constructs that go on (heredocs, `then`, `fi`).
        if (i + 1 < lines.length) units.push(l + '\n' + lines[i + 1]);
      }
    });
  }
  units.push(...snippets.map((s) => s.text));
  // Lines found by hand: a brace group as a loop body, array indexes, brace lists, nested backquotes, here-documents with more on their line.
  units.push('for ((;;)); { :; }', 'a+=([7]=z)', 'echo {1..3}{,}', 'echo `echo \\`echo x\\``', 'echo $"hi"', 'cat <<EOF | tr a-z A-Z && echo after\nhi\nEOF',
    'cat <<EOF; rm -rf "$d"\nhi\nEOF', 'echo A && echo B > f', '! true | false', 'a | time b',
    // printf as the first stage of a pipeline, with formats its simulation cannot show (raw bytes, bad escapes, bad numbers):
    // the example is left out, nothing throws.
    ...['\\231', '\\xff', '\\x', '\\u', '\\u00e9\\U0001F600', '\\uD800', '%q', '%d', '%', '%5', '%z', '%s %s %s'].flatMap((f) => [`printf '${f}' | cmp -s -n 1 - "$1"`, `printf '${f}' abc | tr a-z A-Z`, `printf '${f}' 1 2 | sort`]),
    'seq 0 | sort', 'seq a | cat', 'seq 1 1000000 | wc -l');
  // The pattern or word of a `${…}` operator, cut inside an opener that is not closed, and a backslash at the very end:
  // unbash reads the opener to the end of the text, and may end a part past it.
  const ops = [':-', '#', '##', '%', '%%', '/', '//', '/#', '^', '^^', ',', ',,', '~', '~~', ':', '@'];
  const openers = ['`', '$(', '$((', '${', '"', "'", '$"', "$'", '<(', '`;'];
  const tails = ['', '\\', ' ;\\', '}', '\n'];
  for (const op of ops) for (const o of openers) for (const t of tails) units.push(`echo \${s${op}${o}a${t}`);
  const out = new Set<string>();
  for (const u of units) {
    // The whole text, too (the handwritten lines above are meant as they are).
    out.add(u);
    // Prefixes: all of a short text, a sample of a long one.
    const cuts = u.length <= 10 ? Array.from({ length: u.length }, (_, i) => i) : Array.from({ length: 8 }, () => pick(u.length));
    for (const c of cuts) out.add(u.slice(0, c));
    // A word removed.
    const words = [...u.matchAll(/\S+/g)];
    if (words.length > 1) {
      for (let k = 0; k < 2; k++) {
        const w = words[pick(words.length)];
        out.add(u.slice(0, w.index) + u.slice(w.index! + w[0].length));
      }
    }
    // A random cut: some text from the middle, or with a piece taken out of it.
    const a = pick(u.length);
    const b = a + pick(u.length - a + 1);
    out.add(u.slice(a, b));
    out.add(u.slice(0, a) + u.slice(b));
  }
  out.delete('');
  return [...out];
}

/** What the model asks of a tree whatever the text, beyond `invariants`: all indexes in range. */
export function soundness(tree: SyntaxTree): string[] {
  const bad = invariants(tree);
  const n = tree.text.length;
  const visit = (m: SyntaxNode): void => {
    if (!Number.isInteger(m.startIndex) || !Number.isInteger(m.endIndex) || m.startIndex < 0 || m.endIndex > n) bad.push(`${m.type}@${m.startIndex}: index out of range`);
    m.children.forEach(visit);
  };
  visit(tree.root);
  for (const e of tree.errors) if (!(e.startIndex >= 0 && e.endIndex >= e.startIndex && e.endIndex <= n)) bad.push(`error ${e.message}: range`);
  return bad;
}

/**
 * Text that no leaf of the tree covers (comments, tokens, words and error nodes all count): input the
 * parser dropped. Blanks, line continuations, the text of a here-document body and the backslashes that escape inside backquotes are not counted.
 */
export function uncovered(tree: SyntaxTree): string[] {
  const text = tree.text;
  const covered = new Uint8Array(text.length);
  const mark = (n: SyntaxNode): void => {
    if (!n.children.length || n.type === 'heredoc_body') covered.fill(1, n.startIndex, n.endIndex);
    else n.children.forEach(mark);
  };
  mark(tree.root);
  const out: string[] = [];
  for (let i = 0; i < text.length; i++) {
    if (covered[i] || /\s/.test(text[i])) continue;
    // A line continuation.
    if (text[i] === '\\' && (text[i + 1] === '\n' || (text[i + 1] === '\r' && text[i + 2] === '\n'))) continue;
    // The backslash that escapes a backquote or a `$` inside backquotes goes with what it escapes.
    if (text[i] === '\\' && covered[i + 1] && /[`$\\"]/.test(text[i + 1])) continue;
    let j = i;
    while (j < text.length && !covered[j] && !/\s/.test(text[j])) j++;
    out.push(`${JSON.stringify(text.slice(i, j))}@${i}`);
    i = j;
  }
  return out;
}
