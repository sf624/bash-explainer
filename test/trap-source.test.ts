import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { base, compareKnown, counted, enclosing, keyOf, lineOf, type Match, parseSource, scanDirs } from './support/scan';

// The guard of the traps in effect (docs/design/sources.md, row 28; docs/design/errexit-stop.md, G1): which `EXIT` or
// `ERR` trap is set at a statement comes from the shell state (`ShellState.traps`), which the walk keeps
// (src/semantics/walk/traps.ts), read with src/semantics/traps.ts. So no other file of src/ reads a `trap` command by
// its name, or a signal word as `EXIT` (`exitSignal`, `trappedName`), to decide it again: a comparison with `'trap'`
// (`name === 'trap'`, `case 'trap':`), `'trap'` given to a call (`commandIs(c, 'trap')`), or a call of those two. Lists
// of builtin names (`new Set(['eval', 'trap', …])`) are not readings. Left out: the walk, the dictionary (src/dict/),
// which describes the command, and the readers module. test/fixtures/trap-source-known.json lists what reads it today,
// with a reason for each; it may only shrink (a new match, a larger count and a stale entry all fail).

type Kind = 'name' | 'signal';
const ALLOWED = ['src/semantics/walk/', 'src/dict/', 'src/semantics/traps.ts'];

/** The matches of a source file. */
function scanSource(rel: string, text: string): Match<Kind>[] {
  const out: Match<Kind>[] = [];
  const add = (n: ts.Node, kind: Kind, what: string): void => void out.push({ file: rel, fn: enclosing(n), kind, what, line: lineOf(n) });
  const visit = (n: ts.Node): void => {
    if (ts.isStringLiteral(n) && n.text === 'trap') {
      const p = n.parent;
      const compared = ts.isBinaryExpression(p) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(p.operatorToken.kind);
      if (compared || ts.isCaseClause(p) || (ts.isCallExpression(p) && p.arguments.includes(n))) add(n, 'name', compared ? 'comparison' : ts.isCaseClause(p) ? 'case' : 'argument');
    }
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && ['exitSignal', 'trappedName'].includes(n.expression.text)) add(n, 'signal', n.expression.text);
    ts.forEachChild(n, visit);
  };
  visit(parseSource(rel, text));
  return out;
}

interface Known { file: string; fn: string; kind: Kind; count: number; reason: string }
const known: Known[] = JSON.parse(fs.readFileSync(path.join(base, 'test', 'fixtures', 'trap-source-known.json'), 'utf8')).uses;

describe('the traps in effect guard (docs/design/sources.md, row 28)', () => {
  it('finds every kind of match', () => {
    const found = (code: string): string[] => scanSource('src/x.ts', code).map((m) => `${m.kind} ${m.what}`);
    assert.deepStrictEqual(found("function f(n, c) { if (n === 'trap' || 'trap' !== n) return commandIs(c, 'trap'); switch (n) { case 'trap': return exitSignal(w) || trappedName(w); } }"),
      ['name comparison', 'name comparison', 'name argument', 'name case', 'signal exitSignal', 'signal trappedName']);
    assert.deepStrictEqual(found("const S = new Set(['eval', 'trap']); const k = t.kind; const x = { trap: 1 };"), []);
  });

  it('reads the trap in effect from the state only, besides its known list', () => {
    const matches = scanDirs(['src'], ALLOWED, scanSource);
    const actual = new Map(counted(matches).map((c) => [keyOf(c.file, c.fn, c.kind), c.count]));
    const listed = new Map(known.map((k) => [keyOf(k.file, k.fn, k.kind), k.count]));
    assert.deepStrictEqual(compareKnown(actual, listed, 'read the trap in effect from the state (src/semantics/traps.ts), or give a reason in test/fixtures/trap-source-known.json'), []);
    for (const k of known) assert.ok(k.reason.length > 20, `a reason for ${keyOf(k.file, k.fn, k.kind)}`);
  });
});
