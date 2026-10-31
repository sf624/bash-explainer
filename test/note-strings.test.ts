import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { base, compareKnown, keyOf } from './support/scan';
import { ALLOWED, counted, program, scanAll, scanSyntax, scanTyped, virtualFiles, type Kind } from './support/note-strings';

// The guard of docs/design/sources.md (row 14, step SA5): a note's text is a fact of the message catalog (`fact()` in src/messages.ts: an id,
// the sections it cites, its level), not a string. So, outside src/messages.ts,
//   note-string  `cx.note(text, at)` is not called with a string (the overload for a string; found by the type of the argument, in
//                src/explain/ and src/examples/);
//   plain-note   a note is not made from inline text with `plainNote(…)` or `marked(…)` (found in all of src/);
//   notes-push   a function of src/explain/ or src/examples/ does not hand back its notes as a `string[]` it pushes texts into.
// test/fixtures/note-strings-known.json lists what src/ does today, each `to` the catalog fact that replaces it (stage SB3). The list may only
// shrink: a new entry fails the test, and so does an entry that no longer matches. Not found: the inline texts of tokens (`cx.s(ja, en)`
// in a token's explanation, about 130, which `Token.facts` of SB3 replaces), and a text that reaches the line's notes in a way that none of
// the three kinds is.

interface Known { plain: { file: string; fn: string; kind: Kind; count: number; to: string; reason: string }[] }
const known: Known = JSON.parse(fs.readFileSync(path.join(base, 'test', 'fixtures', 'note-strings-known.json'), 'utf8'));

// The snippets of the guard's own tests are files of src/explain/ that exist in memory only, so that they sit in the same program as the
// real files and resolve imports from the real tree.
const dir = path.join(base, 'src', 'explain');
const snippets = new Map<string, string>();
function snippet(name: string, code: string): void {
  const file = path.join(dir, `snippet-note-${name}.ts`);
  virtualFiles.set(file, `import type { Fact } from '../messages';\nimport { fact } from '../messages';\ndeclare const lang: 'ja' | 'en';\ndeclare const cx: { note(f: Fact, at: unknown): void; note(text: string, at: unknown): void; say(f: Fact, at: unknown): string[] };\ndeclare const n: unknown;\ndeclare const f: Fact;\ndeclare function s(ja: string, en: string): string;\n${code}\n`);
  snippets.set(name, file);
}

const typed: { name: string; code: string; found: string[] }[] = [
  // A string, in any form, goes to the overload for a string.
  { name: 'strings', code: "export function a(t: string, u?: string) { cx.note('x', n); cx.note(`y ${t}`, n); cx.note(s('あ', 'a'), n); cx.note(t, n); if (u) cx.note(u, n); }", found: ["note('x')", 'note(`y ${t}`)', "note(s('あ', 'a'))", 'note(t)', 'note(u)'] },
  { name: 'string-or-undefined', code: 'export function a(u: string | undefined) { if (u) cx.note(u, n); cx.note(u as string, n); }', found: ['note(u)', 'note(u as string)'] },
  // A fact does not: a call of `fact`, a variable of type Fact, a conditional of facts, `say`.
  { name: 'facts', code: "export function a(t: boolean) { cx.note(fact(lang, 'assign-readonly', { name: 'x', then: 'y' } as never), n); cx.note(f, n); cx.note(t ? f : f, n); cx.say(f, n); }", found: [] },
  // Any receiver named `note` that takes a string is found, but a string method that is not `note` or `say` is not.
  { name: 'any-receiver', code: "declare const o: { note(t: string): void }; export function a() { o.note('x'); cx.note(f, n); 'abc'.concat('d'); }", found: ["note('x')"] },
];
for (const t of typed) snippet(t.name, t.code);

const syntactic: { name: string; rel: string; code: string; found: string[] }[] = [
  { name: 'plain-note', rel: 'src/x.ts', code: "import { plainNote, marked as m } from './messages'; export const a = () => [plainNote('x'), m('ja', 'info', 'y')];", found: ['plain-note plainNote', 'plain-note marked'] },
  { name: 'plain-note-renamed', rel: 'src/x.ts', code: "import { plainNote as p } from '../messages'; export const a = () => p('x');", found: ['plain-note plainNote'] },
  // A function of the same name that is not the catalog's, a call that is not of an imported name, another module.
  { name: 'not-the-catalog', rel: 'src/x.ts', code: "import { marked as m } from './other'; function plainNote(t: string) { return t; } const marked = (x: number) => x; export const a = () => [plainNote('x'), marked(1), m(1)];", found: [] },
  { name: 'notes-push', rel: 'src/explain/x.ts', code: "export function a(): string[] { const notes: string[] = []; notes.push('x'); const other: string[] = []; other.push('y'); return notes; }", found: ['notes-push notes.push'] },
  { name: 'notes-push-readonly', rel: 'src/examples/x.ts', code: "export function a(): readonly string[] { const textNotes: Array<string> = []; textNotes.push('x'); return textNotes; }", found: ['notes-push textNotes.push'] },
  // A list that the function does not return as a list of strings, one elsewhere than the two directories, a list of notes (not texts).
  { name: 'not-a-text-list', rel: 'src/explain/x.ts', code: "export function a(): string { const notes: string[] = []; notes.push('x'); return notes.join(' '); } export function b(): Note[] { const notes: Note[] = []; notes.push(1 as never); return notes; }", found: [] },
  { name: 'outside-dirs', rel: 'src/hosts/x.ts', code: "export function a(): string[] { const notes: string[] = []; notes.push('x'); return notes; }", found: [] },
];

describe('note strings guard (docs/design/sources.md, SA5)', function () {
  // One program over src/explain/, src/examples/ and what they import (about a second), shared by the tests that need the checker.
  this.timeout(120000);

  for (const t of typed) {
    it(`finds the strings handed to a note: ${t.name}`, () => {
      const p = program();
      const sf = p.getSourceFile(snippets.get(t.name)!)!;
      assert.deepStrictEqual(scanTyped(p.getTypeChecker(), sf, 'src/explain/snippet.ts').map((m) => m.what), t.found);
    });
  }

  for (const t of syntactic) {
    it(`finds the notes made from inline text: ${t.name}`, () => {
      assert.deepStrictEqual(scanSyntax(t.rel, t.code).map((m) => `${m.kind} ${m.what}`), t.found);
    });
  }

  it('type-checks the snippets, so that none is read with error types', () => {
    const p = program();
    const bad = [...snippets.values()].flatMap((file) => p.getSemanticDiagnostics(p.getSourceFile(file)!).map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' ')));
    assert.deepStrictEqual(bad, []);
  });

  it('keeps the allow-list to files that exist', () => {
    for (const a of ALLOWED) assert.ok(fs.existsSync(path.join(base, a)), `${a} is gone: remove it from ALLOWED`);
  });

  it('lists every match outside the allow-list, no more and no fewer', () => {
    const actual = new Map(counted(scanAll()).map((e) => [keyOf(e.file, e.fn, e.kind), e.count]));
    const listed = new Map<string, number>();
    const problems: string[] = [];
    for (const d of known.plain) {
      const k = keyOf(d.file, d.fn, d.kind);
      if (d.to !== 'catalog fact') problems.push(`${k} names no source it moves to ("${d.to}")`);
      if (typeof d.reason !== 'string' || d.reason.trim() === '') problems.push(`${k} has no reason`);
      if (listed.has(k)) problems.push(`${k} is listed twice`);
      listed.set(k, d.count);
    }
    problems.push(...compareKnown(actual, listed, 'give the note an entry in the catalog (src/messages.ts) and say it with `cx.note(fact(cx.lang, id, params), at)`'));
    assert.deepStrictEqual(problems, []);
  });
});
