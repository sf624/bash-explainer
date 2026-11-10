import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { base, compareKnown, keyOf } from './support/scan';
import { ALLOWED, counted, program, scanAll, scanTyped, virtualFiles, type Kind } from './support/value-source';

// The guard of docs/design/sources.md (section 3, the row of the origin; docs/design/known-values.md, section 8): the value an expansion
// gives comes from `expansionValue`, and the assignment whose text it copies from `valueOrigin` (src/semantics/values.ts). So no file of
// src/ outside src/semantics/ reads a variable's `value` or `source` from the shell state (`VariableState`, src/semantics/shellstate.ts):
// the state's fields hold where a path set them, not where the model is sure of them (the trust, a state the same on every path, not dead,
// nothing failing around it). test/fixtures/value-source-known.json lists the reads that are no value an expansion gives, each with its
// reason. A new read fails the test, and so does an entry that no longer matches. `npx tsx test/support/value-source.ts` prints the counts.

interface Known { reads: { file: string; fn: string; kind: Kind; count: number; reason: string }[] }
const known: Known = JSON.parse(fs.readFileSync(path.join(base, 'test', 'fixtures', 'value-source-known.json'), 'utf8'));

// The snippets are files of src/explain/ that exist in memory only, so that they resolve the real `VariableState`.
const dir = path.join(base, 'src', 'explain');
const snippets = new Map<string, string>();
function snippet(name: string, code: string): void {
  const file = path.join(dir, `snippet-value-source-${name}.ts`);
  virtualFiles.set(file, `import type { ShellState, VariableState } from '../semantics/shellstate';\ndeclare const st: ShellState;\ndeclare const v: VariableState;\n${code}\n`);
  snippets.set(name, file);
}

const cases: { name: string; code: string; found: string[] }[] = [
  { name: 'reads', code: "export function a() { return [v.value, v.source, st.variables.get('x')?.value, st.variables.get('x')!.source]; }", found: ['value v.value', 'source v.source', "value st.variables.get('x')?.value", "source st.variables.get('x')!.source"] },
  { name: 'destructured', code: "export function a() { const { value, source: s } = v; const { at } = v; const { value: w } = st.variables.get('x') ?? v; return [value, s, at, w]; }", found: ['value value', 'source source: s', 'value value: w'] },
  // Another type's `value` or `source`, and the other fields of the state, are not.
  { name: 'others', code: "declare const o: { value: string; source: string }; export function a() { const { value } = o; return [o.value, o.source, value, v.set, v.at, v.kept, st.variables.get('x')?.attrs]; }", found: [] },
];
for (const c of cases) snippet(c.name, c.code);

describe('value source guard (docs/design/known-values.md, section 8)', function () {
  // One program over src/ (a few seconds), shared by the tests.
  this.timeout(120000);

  for (const c of cases) {
    it(`finds the reads of a variable's value or source: ${c.name}`, () => {
      const p = program();
      const sf = p.getSourceFile(snippets.get(c.name)!)!;
      assert.deepStrictEqual(scanTyped(p.getTypeChecker(), sf, 'src/explain/snippet.ts').map((m) => `${m.kind} ${m.what}`), c.found);
    });
  }

  it('type-checks the snippets, so that none is read with error types', () => {
    const p = program();
    const bad = [...snippets.values()].flatMap((file) => p.getSemanticDiagnostics(p.getSourceFile(file)!).map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' ')));
    assert.deepStrictEqual(bad, []);
  });

  it('keeps the allow-list to directories that exist', () => {
    for (const a of ALLOWED) assert.ok(fs.existsSync(path.join(base, a)), `${a} is gone: remove it from ALLOWED`);
  });

  it('lists every read outside src/semantics/, no more and no fewer', () => {
    const actual = new Map(counted(scanAll()).map((e) => [keyOf(e.file, e.fn, e.kind), e.count]));
    const listed = new Map<string, number>();
    const problems: string[] = [];
    for (const d of known.reads) {
      const k = keyOf(d.file, d.fn, d.kind);
      if (typeof d.reason !== 'string' || d.reason.trim() === '') problems.push(`${k} has no reason`);
      if (listed.has(k)) problems.push(`${k} is listed twice`);
      listed.set(k, d.count);
    }
    problems.push(...compareKnown(actual, listed, 'read the value with `expansionValue` and the assignment with `valueOrigin` (src/semantics/values.ts)'));
    assert.deepStrictEqual(problems, []);
  });
});
