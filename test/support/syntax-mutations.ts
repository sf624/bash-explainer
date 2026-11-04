// A table generated from the shapes of test/fixtures/syntax-tokens.json and valid scripts: one token dropped, swapped with
// the next, or inserted, at each position. Deterministic: a change of its size says that the table changed.
import * as fs from 'fs';
import * as path from 'path';

const tokens = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'syntax-tokens.json'), 'utf8')) as { shapes: string[]; alone: string[]; valid: string[]; found: string[] };

const TOKEN = /\n|;;&|;;|;&|\|\||&&|\|&|<<<|<<-|<<|>>|[;&|()<>]|(?:"(?:[^"\\]|\\.)*"|'[^']*'|\\.|[^\s;&|()<>"'\\])+|["'\\]/g;
const INSERTS = [')', '(', ';;', 'fi', 'done', 'esac', 'then', 'do', 'else', 'elif', 'in', '}', '{', '&', '|', '||', '&&', ';', '\n', 'word', '>', '<', '!', '[[', ']]', 'case', 'if', 'for', 'while', 'function', 'time', '$(', '`', '"', "'", '\\'];
/** How many tokens are inserted at each position: each file and table of a run has the same few. */
const AT_EACH = 2;

/** A small generator of its own: the same in every Node.js, with a seed that never changes. */
function generator(seed: number): () => number {
  let s = seed;
  return () => {
    s = Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9 | 0;
    return (s >>> 0) / 2 ** 32;
  };
}

/** The rows: each base as it is is not among them (`found` and `valid` are other tables), only its mutations. */
export function mutations(atEach = AT_EACH, extra: readonly string[] = []): string[] {
  const random = generator(597);
  const rows = new Set<string>(tokens.found.map((s) => `${s}\n`));
  for (const base of new Set([...tokens.shapes, ...tokens.alone, ...tokens.valid, ...extra])) {
    const spans = [...base.matchAll(TOKEN)].map((m) => [m.index, m.index + m[0].length] as const);
    spans.forEach(([from, to], i) => {
      rows.add(`${base.slice(0, from)}${base.slice(to)}\n`);
      const next = spans[i + 1];
      if (next) rows.add(`${base.slice(0, from)}${base.slice(...next)}${base.slice(to, next[0])}${base.slice(from, to)}${base.slice(next[1])}\n`);
    });
    for (const at of [...spans.map(([from]) => from), base.length]) {
      for (let k = 0; k < atEach; k++) {
        const t = atEach >= INSERTS.length ? INSERTS[k % INSERTS.length] : INSERTS[Math.floor(random() * INSERTS.length)];
        rows.add(`${base.slice(0, at)} ${t} ${base.slice(at)}\n`);
      }
    }
  }
  return [...rows];
}
