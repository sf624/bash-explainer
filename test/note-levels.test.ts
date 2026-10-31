import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { base, compareKnown, keyOf } from './support/scan';
import { ALLOWED, counted, scanAll, scanSource, scanStyle, type Kind } from './support/note-levels';

// The guard of docs/design/sources.md (row 13, step SA4): the level of a note (Warning, Info, and, with the three levels, Error) and how
// each output shows it (the severity of a protocol, an ANSI colour, a codicon, a glyph, a rank, a colour variable, a word, a class) come
// from one table. Today that is src/messages.ts (`NoteLevel`, `severityOf`, `MARKS`, `PITFALL_WORD`), which the guard leaves out; the
// level table of three-levels.md, step 1, replaces it, and this list empties then. So no other file may
//   - write a level word as a literal or a type: 'warning', 'info', 'hint', 'pitfall', 'caveat', and 'error' where it is a level's
//     (`i.severity === 'error'`, `{ level: 'error' }`), not the syntax tree's `error` node type or the tokens' `error` kind;
//   - write a map from a level (an object with two level keys, `Record<NoteLevel, …>`);
//   - use `DiagnosticSeverity`, or write a severity as a number (`severity: i.x ? 2 : 3`);
//   - write a mark by hand (⚠, ⓘ, ℹ) in a string, a template or a regex;
//   - name a level's style (`level-warning`, `squiggle-info`, `--c-warning`, `editorWarning`, `codicon-info`), in code or in a .css file.
// Scanned: the tracked files of src/, cli/, web/ and media/ (.ts, .js, .css), never a built bundle such as cli/dist/cli.js. `'pitfall'`
// compared with or assigned to a `kind` is the fact kind, not a level. Not caught: a level word built in a template or by
// concatenation, a level in a `Map`, and a map from a level whose keys are computed. test/fixtures/note-levels-known.json lists what they do today, in two parts:
//   levels  places that decide a level's look or severity again, each `to` the level table, with what they decide.
//           The list may only shrink: a new entry fails the test, and so does an entry that no longer matches.
//   other   places that only look like one (a fact kind, a CSS class of something else), a reason for each use.

interface Use { fn: string; kind: Kind; count: number; reason: string }
interface Known {
  levels: { file: string; fn: string; kind: Kind; count: number; to: string; reason: string }[];
  other: { file: string; uses: Use[] }[];
}
const known: Known = JSON.parse(fs.readFileSync(path.join(base, 'test', 'fixtures', 'note-levels-known.json'), 'utf8'));

/** The matches of a code snippet, as `kind what` texts. */
const found = (code: string, rel = 'src/x.ts'): string[] => scanSource(rel, code).map((m) => `${m.kind} ${m.what}`);

describe('note levels guard (docs/design/sources.md, SA4)', () => {
  it('finds every kind of match', () => {
    // A level word, as a literal in a comparison, an argument, a return, a case label, an array; as a type.
    assert.deepStrictEqual(found("function f(i) { return i.severity === 'warning' ? marked('info') : ['hint']; }"), ['level-literal warning', 'level-literal info', 'level-literal hint']);
    assert.deepStrictEqual(found("function f(k) { switch (k) { case 'pitfall': return `caveat`; } }"), ['level-literal pitfall', 'level-literal caveat']);
    assert.deepStrictEqual(found("type S = 'warning' | 'info'; function f(s: 'hint') {}"), ['level-type warning', 'level-type info', 'level-type hint']);
    // `error`, where it is a level's.
    assert.deepStrictEqual(found("function f(i, p) { return i.severity === 'error' || p.level !== 'error' || { level: 'error' }; }"), ['level-literal error', 'level-literal error', 'level-literal error']);
    assert.deepStrictEqual(found("type S = 'warning' | 'error'; function f(i) { switch (i.severity) { case 'error': return 1; } }"), ['level-type warning', 'level-type error', 'level-literal error']);
    // A map from a level.
    assert.deepStrictEqual(found("const A = { warning: 1, info: 2 }; const B = { 'warning': 1, note: 2 }; const C: Record<NoteLevel, string> = {} as any; type E = Record<Severity, number>;"),
      ['level-map info/warning', 'level-map note/warning', 'level-map Record<NoteLevel>', 'level-map Record<Severity>']);
    assert.deepStrictEqual(found("type D = Record<'warning' | 'info', number>;"), ['level-map Record<warning | info>', 'level-type warning', 'level-type info']);
    // A severity.
    assert.deepStrictEqual(found("import * as vscode from 'vscode'; const a = vscode.DiagnosticSeverity.Warning; const b = { severity: i.w ? 2 : 3 }; const c = { severity: x };"), ['severity-enum DiagnosticSeverity', 'severity-number severity: <number>']);
    // A mark written by hand: in a string, a template piece, a regex.
    assert.deepStrictEqual(found("const a = '⚠ x'; const b = `ⓘ ${y} ℹ`; const c = /^[⚠ⓘ]/;"), ['glyph ⚠', 'glyph ⓘ', 'glyph ℹ', 'glyph ⚠']);
    // A level's style.
    assert.deepStrictEqual(found("const a = 'note level-warning'; const b = `squiggle-${l}`; const c = '--vscode-editorInfo-foreground'; const d = 'codicon-warning'; const e = '$(info)';"),
      ['level-style note level-warning', 'level-style squiggle-', 'level-style --vscode-editorInfo-foreground', 'level-style codicon-warning', 'level-style $(info)']);
    // A style file: one match per line, comments left out.
    assert.deepStrictEqual(scanStyle('x.css', '/* .level-warning in a comment */\n.level-warning { color: var(--c-warning); }\n.a { color: red; }\n:root { --vscode-editorInfo-foreground: #000; }').map((m) => `${m.line} ${m.kind}`), ['2 level-style', '4 level-style']);
    // The code of a script file is read as well.
    assert.deepStrictEqual(found("el.className = `note level-${n.level}`; draw(n.level === 'warning');", 'media/x.js'), ['level-style note level-', 'level-literal warning']);
  });

  it('leaves out what is not a level', () => {
    // `FactKind` is not a level: `pitfall` compared with or assigned to a `kind`.
    assert.deepStrictEqual(found("function f(f, kind) { return f.kind === 'pitfall' || 'pitfall' !== kind || { kind: 'pitfall' } || kind === 'info'; }"), ['level-literal info']);
    assert.deepStrictEqual(found("function f(x, kind) { switch (kind) { case 'pitfall': return 1; } return x.type === 'pitfall' || { name: 'pitfall' }; }"), ['level-literal pitfall', 'level-literal pitfall']);
    // The syntax tree's and the tokens' `error`, key names alone, near misses of the words, imports, one level key.
    assert.deepStrictEqual(found("function f(n, x) { return n.type === 'error' || tok(n, 'error') || x === 'error' || [1].includes('error') || { kind: 'error' }; }"), []);
    assert.deepStrictEqual(found("import x from 'info'; const a = { info: 1 }; const b = { warning: 1, kind: 2 }; const c = ['warnings', 'information', 'note', 'Warning'];"), []);
    assert.deepStrictEqual(found("const a = { 'warning': 1 }.warning; const b = o.warning;"), []);
    assert.deepStrictEqual(found("type A = Record<string, number>; type B = Record<Kind, number>; const s = { severity: 'x', level: i }; vscode.Severity;"), []);
    // A glyph or a style name that is not a level's.
    assert.deepStrictEqual(found("const a = '✓ done'; const b = 'level-3'; const c = 'squiggle'; const d = '--c-error'; const e = `kind-${k}`;"), []);
    assert.deepStrictEqual(scanStyle('x.css', '.kind-error { color: var(--c-error); }\n.note { color: red; }'), []);
  });

  it('names the outermost named function around a match', () => {
    const m = scanSource('src/x.ts', "const top = 1; export function outer(i) { const inner = (x) => x === 'warning'; return inner(i); } class C { method(i) { return i === 'info'; } } const T = { warning: 1, info: 2 };");
    assert.deepStrictEqual(m.map((x) => x.fn), ['outer', 'method', 'T']);
  });

  it('keeps the allow-list to files that exist', () => {
    // The table of icon drawings is scanned: its one match is listed, not left out by file.
    assert.ok(!ALLOWED.some((a) => a.includes('icons')));
    for (const a of ALLOWED) {
      if (a.endsWith('/')) assert.ok(fs.statSync(path.join(base, a)).isDirectory(), a);
      else assert.ok(fs.existsSync(path.join(base, a)), `${a} is gone: remove it from ALLOWED`);
    }
  });

  it('lists every match outside the allow-list, no more and no fewer', () => {
    const actual = new Map(counted(scanAll()).map((e) => [keyOf(e.file, e.fn, e.kind), e.count]));
    const listed = new Map<string, number>();
    const problems: string[] = [];
    const list = (file: string, fn: string, kind: string, count: number, where: string): void => {
      const k = keyOf(file, fn, kind);
      if (listed.has(k)) problems.push(`${k} is listed twice (${where})`);
      listed.set(k, count);
    };
    for (const d of known.levels) {
      if (d.to !== 'level table') problems.push(`levels: ${keyOf(d.file, d.fn, d.kind)} names no source it moves to ("${d.to}")`);
      if (typeof d.reason !== 'string' || d.reason.trim() === '') problems.push(`levels: ${keyOf(d.file, d.fn, d.kind)} has no reason`);
      list(d.file, d.fn, d.kind, d.count, 'levels');
    }
    for (const o of known.other) {
      for (const u of o.uses) {
        if (typeof u.reason !== 'string' || u.reason.trim() === '') problems.push(`other: ${keyOf(o.file, u.fn, u.kind)} has no reason`);
        list(o.file, u.fn, u.kind, u.count, 'other');
      }
    }
    problems.push(...compareKnown(actual, listed, 'take the severity, mark, icon, colour, rank or word of a level from the level table (src/messages.ts today: severityOf, MARKS, PITFALL_WORD); something that only looks like one goes into the "other" list of test/fixtures/note-levels-known.json, with a reason'));
    assert.deepStrictEqual(problems, []);
  });
});
