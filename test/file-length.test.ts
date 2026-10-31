import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

// No file in src/ or web/ is over LIMIT lines, except those listed in test/fixtures/file-length.json, each with a
// ceiling that may only go down (docs/design/analyzer.md, 3.1).
const base = path.join(__dirname, '..');
const LIMIT = 1000;

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const file = path.join(dir, e.name);
    return e.isDirectory() ? sources(file) : /\.ts$/.test(e.name) ? [file] : [];
  });
}

const lines = (file: string): number => {
  const text = fs.readFileSync(file, 'utf8');
  return text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
};

const listed = Object.fromEntries(
  Object.entries(JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/file-length.json'), 'utf8')) as Record<string, number | string>).filter(([k]) => k !== '//'),
) as Record<string, number>;
const counts = new Map([...sources(path.join(base, 'src')), ...sources(path.join(base, 'web'))].map((f) => [path.relative(base, f).split(path.sep).join('/'), lines(f)]));

describe('file length', () => {
  it('finds the sources it checks', () => {
    assert.ok(counts.size > 40);
    assert.ok([...counts.keys()].some((f) => f.startsWith('web/')), 'web/*.ts is checked too (chrome-redesign.md, C0)');
  });

  it(`keeps every file of src/ and web/ at ${LIMIT} lines or fewer unless it is listed`, () => {
    const over = [...counts].filter(([f, n]) => n > LIMIT && !(f in listed)).map(([f, n]) => `${f}: ${n}`);
    assert.deepStrictEqual(over, []);
  });

  it('keeps a listed file under its ceiling', () => {
    const grown = Object.entries(listed)
      .filter(([f, max]) => (counts.get(f) ?? 0) > max)
      .map(([f, max]) => `${f}: ${counts.get(f)} lines, ceiling ${max}`);
    assert.deepStrictEqual(grown, []);
  });

  it('lists no file that is gone or now fits (a stale entry): remove it', () => {
    const stale = Object.keys(listed)
      .filter((f) => (counts.get(f) ?? 0) <= LIMIT)
      .map((f) => `${f}: ${counts.get(f) ?? 'missing'} lines`);
    assert.deepStrictEqual(stale, []);
  });

  it('prints the ceilings that can be lowered', () => {
    for (const [f, max] of Object.entries(listed)) {
      const n = counts.get(f)!;
      if (n < max) console.log(`      lower the ceiling of ${f}: ${max} -> ${n} (test/fixtures/file-length.json)`);
    }
  });
});
