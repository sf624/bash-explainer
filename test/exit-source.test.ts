import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { lookupCommand } from '../src/analyzer';
import { base, compareKnown, counted, enclosing, keyOf, lineOf, type Match, parseSource, scanDirs } from './support/scan';

// The guard of docs/design/sources.md (row 29): what a program's exit status means comes from its spec (`CommandSpec.exits`,
// read by `exitMeanings` into the status model's `results`), not from its name. So the code that decides exit statuses and
// what `set -e` does with them (the status model, its facts, the stop notes) names no program whose spec has `exits`: a string
// literal that is the name of one (`'grep'`, `'diff'`, `'buildozer'`) is a decision by name. test/fixtures/exit-source-known.json
// lists today's (each with what it decides), a list that may only shrink: a new one fails, and so does an entry that no longer
// matches. Not found: a name compared through a variable or a table, and one in a file outside these.

/** The files that decide exit statuses, or say what `set -e` does with them. */
const FILES = ['src/semantics/status.ts', 'src/semantics/posixexits.ts', 'src/semantics/scriptstops.ts', 'src/statusfacts.ts', 'src/explain/status.ts',
  'src/explain/line-notes.ts', 'src/messages-errexit-stop.ts', 'src/messages-facts-status.ts'];

/** Whether `name` is a program whose spec says what its statuses mean. */
const hasExits = (name: string): boolean => /^[a-z][a-z0-9_-]*$/.test(name) && !!lookupCommand(name)?.exits;

function scan(rel: string, text: string): Match<'name'>[] {
  if (!FILES.includes(rel)) return [];
  const out: Match<'name'>[] = [];
  const visit = (n: ts.Node): void => {
    if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && hasExits(n.text)) out.push({ file: rel, fn: enclosing(n), kind: 'name', what: n.text, line: lineOf(n) });
    n.forEachChild(visit);
  };
  visit(parseSource(rel, text));
  return out;
}

interface Known { uses: { file: string; fn: string; kind: 'name'; count: number; reason: string }[] }
const known: Known = JSON.parse(fs.readFileSync(path.join(base, 'test', 'fixtures', 'exit-source-known.json'), 'utf8'));

describe('exit status source guard (docs/design/sources.md, row 29)', () => {
  it('finds a name of a program with `exits` as a string, and nothing else', () => {
    const found = (code: string) => scan('src/statusfacts.ts', code).map((m) => `${m.fn} ${m.what}`);
    assert.deepStrictEqual(found("function f(n: string) { return n === 'grep' || n === 'head' || `diff` === n; }"), ['f grep', 'f diff']);
    assert.deepStrictEqual(found("const t = 'no grep here'; const u = 'sed';"), []);
    assert.deepStrictEqual(scan('src/dict/commands.ts', "const a = 'grep';"), []);
  });

  it('lists every match outside the spec, no more and no fewer', () => {
    for (const f of FILES) assert.ok(fs.existsSync(path.join(base, f)), f);
    const actual = new Map(counted(scanDirs(['src'], [], scan)).map((c) => [keyOf(c.file, c.fn, c.kind), c.count]));
    const listed = new Map(known.uses.map((u) => [keyOf(u.file, u.fn, u.kind), u.count]));
    assert.deepStrictEqual(compareKnown(actual, listed, 'read what the status means from `CommandSpec.exits` (the status model\'s `results`) instead'), []);
    for (const u of known.uses) assert.ok(u.reason, keyOf(u.file, u.fn, u.kind));
  });
});
