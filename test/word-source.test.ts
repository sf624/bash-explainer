import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { ALLOWED, base, counted, globClass, scanAll, scanSource, type Kind } from './support/word-source';

// The guard of docs/design/word-source.md (section 4): what bash makes of a word comes from the word model
// (src/semantics/words.ts), so no other file decides it from word-part node types, from the text helpers that read a
// word's tree, from glob characters or from the IFS whitespace. test/fixtures/word-source-known.json lists what src/
// does today, in two parts:
//   deciders  places that decide a fact of a word again, each with its row of the design's inventory (section 2.2).
//             The list may only shrink: a new entry fails the test, and so does an entry that no longer matches.
//   syntax    places that only work on the syntax (dispatch, recursion, source spans, rewrites, other languages), a
//             reason for each file. A new feature that reads node types reads the word model instead, or adds an entry
//             here whose reason the reviewer reads in the diff.

interface Use { fn: string; kind: Kind; count: number; reason?: string }
interface Known {
  deciders: { file: string; fn: string; kind: Kind; count: number; row: string }[];
  syntax: { file: string; reason: string; uses: Use[] }[];
}
const known: Known = JSON.parse(fs.readFileSync(path.join(base, 'test', 'fixtures', 'word-source-known.json'), 'utf8'));
const keyOf = (file: string, fn: string, kind: string): string => `${file} ${fn} ${kind}`;

/** The matches of a snippet, as `kind what` texts. */
const found = (code: string, rel = 'src/x.ts'): string[] => scanSource(rel, code).map((m) => `${m.kind} ${m.what}`);

describe('word source guard (docs/design/word-source.md, section 4)', () => {
  it('finds every kind of match', () => {
    assert.deepStrictEqual(found("function f(n) { return n.type === 'word' || 'number' !== n.type; }"), ['node-type word', 'node-type number']);
    assert.deepStrictEqual(found("function f(n) { switch (n.type) { case 'string': return 1; case 'command': return 2; } }"), ['node-type string']);
    assert.deepStrictEqual(found("const T = new Set(['word', 'expansion']); function f(n) { return T.has(n.type); }"), ['node-type word', 'node-type expansion']);
    assert.deepStrictEqual(found("const T = ['word', 'brace_expression']; function f(n) { return T.includes(n.type); }"), ['node-type word', 'node-type brace_expression']);
    assert.deepStrictEqual(found("function f(n) { return ['word', 'number'].includes(n.type); }"), ['node-type word', 'node-type number']);
    assert.deepStrictEqual(found("const R = /^(word|number|command)$/; function f(n) { return R.test(n.type); }"), ['node-type word', 'node-type number']);
    assert.deepStrictEqual(found("function f(n) { return /^(?:word|number)$/.test(n.type); }"), ['node-type word', 'node-type number']);
    // A list of node types handed to a query of the tree: inline, through a variable, or to a function of the file that takes `types`.
    assert.deepStrictEqual(found("function f(r) { return descendants(r, ['word', 'command']); }"), ['node-type word']);
    assert.deepStrictEqual(found("function f(r) { const types = ['string', 'x']; return descendants(r, types); }"), ['node-type string']);
    assert.deepStrictEqual(found("const on = (types: string[]) => g(types); function f(r) { return on(['number']); }"), ['node-type number']);
    assert.deepStrictEqual(found("function f(r) { return onLine(r, ['concatenation'], 1); }"), ['node-type concatenation']);
    // A part of a node type, and a variable that holds one.
    assert.deepStrictEqual(found("function f(n) { return n.type.endsWith('_substitution') || n.type.startsWith('simple'); }"), ['node-type endsWith:_substitution', 'node-type startsWith:simple']);
    assert.deepStrictEqual(found("function f(n) { const t = n.type; switch (t) { case 'word': return 1; } return t === 'string'; }"), ['node-type word', 'node-type string']);
    assert.deepStrictEqual(found("function f(a) { return staticWordValue(a) ?? m.hasGlob(a); }"), ['helper staticWordValue', 'helper hasGlob']);
    assert.deepStrictEqual(found('const G = /[*?[]/; const H = /[\\s*?[]/; const N = new RegExp("[*?]");'), ['glob-class /[*?[]/', 'glob-class /[\\s*?[]/', 'glob-class /[*?]/']);
    assert.deepStrictEqual(found("import { IFS_WHITESPACE } from './chars'; const w = IFS_WHITESPACE + ' \\t\\n';"), ['ifs IFS_WHITESPACE', "ifs ' \\t\\n'"]);
  });

  it('leaves out what is not a word fact', () => {
    // A node type compared with something that is not a `.type`; a container that no `.type` is tested against.
    assert.deepStrictEqual(found("function f(n, s) { return s === 'word' || n.kind === 'word' || ['word', 'number'].includes(s); }"), []);
    assert.deepStrictEqual(found("function f(n, r) { return n.type.endsWith('redirect') || descendants(r, ['command']) || helper(r, ['word']); }"), []);
    assert.deepStrictEqual(found("function f(n) { return n.type === 'command' || /[a-z*]/.test(n.text) || /[?]/.test(n.text); }"), []);
    assert.strictEqual(globClass('[\\]*?]'), true);
    assert.strictEqual(globClass('\\[*?\\]'), false);
  });

  it('names the outermost named function around a match', () => {
    const m = scanSource('src/x.ts', "const top = 1; export function outer(n) { const inner = (x) => x.type === 'word'; return inner(n); } class C { method(n) { return n.type === 'string'; } } const T = new Set(['word']); T.has(y.type);");
    assert.deepStrictEqual(m.map((x) => x.fn), ['outer', 'method', 'T']);
  });

  it('keeps the allow-list to files that exist', () => {
    for (const a of ALLOWED) {
      if (a.endsWith('/')) assert.ok(fs.statSync(path.join(base, a)).isDirectory(), a);
      else assert.ok(fs.existsSync(path.join(base, a)) || a === 'src/semantics/wordview.ts', `${a} is gone: remove it from ALLOWED`);
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
    for (const d of known.deciders) {
      if (!/^W-[A-Z]\d$/.test(d.row)) problems.push(`deciders: ${keyOf(d.file, d.fn, d.kind)} has no row of the inventory (section 2.2) ("${d.row}")`);
      list(d.file, d.fn, d.kind, d.count, 'deciders');
    }
    for (const s of known.syntax) {
      if (typeof s.reason !== 'string' || s.reason.trim() === '') problems.push(`syntax: ${s.file} has no reason`);
      for (const u of s.uses) {
        if (u.reason !== undefined && u.reason.trim() === '') problems.push(`syntax: ${keyOf(s.file, u.fn, u.kind)} has an empty reason`);
        list(s.file, u.fn, u.kind, u.count, 'syntax');
      }
    }
    for (const [k, n] of actual) {
      const have = listed.get(k);
      if (have === undefined) problems.push(`NEW: ${k} (${n}): read the word model (src/semantics/words.ts) instead; a use that only works on the syntax goes into the "syntax" list of test/fixtures/word-source-known.json, with a reason`);
      else if (n > have) problems.push(`MORE: ${k} has ${n} matches, ${have} are listed`);
    }
    for (const [k, have] of listed) {
      const n = actual.get(k) ?? 0;
      if (n < have) problems.push(`STALE: ${k} lists ${have}, ${n} found: lower the count or remove the entry`);
    }
    assert.deepStrictEqual(problems, []);
  });
});
