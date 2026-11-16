import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { base, compareKnown, counted, enclosing, keyOf, lineOf, type Match, parseSource, scanDirs } from './support/scan';

// The guard of docs/design/sources.md (row 42): whether a tool refuses its command line is one fact of the parse
// (`ArgvParse.refused`), which `refusalOf` (src/argv/refusals.ts) reads from what the spec states (`Refused`: `ValueSpec.refuses`,
// `CommandSpec.conflictingModes` and `needsMode`, `OperandSpec.extra`). Every other reader asks the parse: the line's note, the
// examples, the readings of embedded languages. So no file of src/ but refusals.ts and the dictionary that states them reads
// those fields: a read elsewhere is a second decision of the same fact (a runner that checks a refusal of its own).
// test/fixtures/refusal-source-known.json lists today's (each with why), a list that may only shrink: a new one fails, and so does
// an entry that no longer matches. Not found: a field read through a destructuring or an index.

/** The fields of the spec that state a refusal. */
const FIELDS = new Set(['refuses', 'conflictingModes', 'needsMode', 'extra']);
/** Where they are read as the source, or stated. */
const ALLOWED = ['src/argv/refusals.ts', 'src/argv/spec.ts', 'src/dict/'];

function scan(rel: string, text: string): Match<'field'>[] {
  const out: Match<'field'>[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isPropertyAccessExpression(n) && FIELDS.has(n.name.text)) out.push({ file: rel, fn: enclosing(n), kind: 'field', what: n.name.text, line: lineOf(n) });
    n.forEachChild(visit);
  };
  visit(parseSource(rel, text));
  return out;
}

interface Known { uses: { file: string; fn: string; kind: 'field'; count: number; reason: string }[] }
const known: Known = JSON.parse(fs.readFileSync(path.join(base, 'test', 'fixtures', 'refusal-source-known.json'), 'utf8'));

describe('refusal source guard (docs/design/sources.md, row 42)', () => {
  it('finds a read of a field that states a refusal, and nothing else', () => {
    const found = (code: string) => scan('src/x.ts', code).map((m) => `${m.fn} ${m.what}`);
    assert.deepStrictEqual(found('function f(s: any) { return s.spec?.extra || s.conflictingModes || s.value.refuses?.(x) || s.needsMode; }'), ['f extra', 'f conflictingModes', 'f refuses', 'f needsMode']);
    assert.deepStrictEqual(found('const extra = 1; function g(p: any) { return p.refused || { extra }; }'), []);
  });

  it('lists every read outside the source, no more and no fewer', () => {
    const actual = new Map(counted(scanDirs(['src', 'cli', 'web'], ALLOWED, scan)).map((c) => [keyOf(c.file, c.fn, c.kind), c.count]));
    const listed = new Map(known.uses.map((u) => [keyOf(u.file, u.fn, u.kind), u.count]));
    assert.deepStrictEqual(compareKnown(actual, listed, 'read `ArgvParse.refused` (src/argv/refusals.ts) instead'), []);
    for (const u of known.uses) assert.ok(u.reason, keyOf(u.file, u.fn, u.kind));
  });
});
