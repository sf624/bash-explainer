// A differential test against bash's own parser, through bash-ast (https://github.com/cv/bash-ast).
//
// GPL boundary: bash-ast is GPL-3.0 and this project is MIT. The test only runs it as an external
// program (child_process, see test/support/bashast.ts) and reads its JSON output. No code or type
// definitions of bash-ast are copied, it is not in package.json, and it is never bundled or shipped.
// The binary comes from $BASH_AST or PATH; without it, this test is skipped (CI has none).
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { detectShell } from '../src/dialect';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { hasError } from '../src/syntax/tree';
import { corpus } from './support/corpus';
import { findBashAst, runBashAst, shapeOfAst } from './support/bashast';
import { diffShapes, shapeOfTree } from './support/shape';

interface Known { input: string; path: string; reason: string }
const knownFile = path.join(__dirname, 'fixtures/bash-ast-known.json');
const bin = findBashAst();

// An extglob pattern (`!(x)`, `@(a|b)`): bash-ast parses with extglob off, so these are not comparable.
const EXTGLOB = /[?*+@!]\(/;

const short = (v: unknown): string => { const t = JSON.stringify(v); return t.length > 160 ? `${t.slice(0, 160)}…` : t; };

describe('shapes (no bash-ast needed)', () => {
  const shape = (text: string): unknown => shapeOfTree(createUnbashParser().parse(text).root);

  it('turns a tree into lists, pipelines and redirections', () => {
    assert.deepEqual(shape('a | b |& c && d &'), {
      k: 'seq',
      items: [{
        bg: true,
        cmd: {
          k: 'and-or',
          first: {
            k: 'pipeline', negated: false,
            stages: [
              { k: 'simple', line: 1, assignments: [], words: ['a'], redirects: [] },
              { k: 'simple', line: 1, assignments: [], words: ['b'], redirects: [{ fd: 2, op: 'dup_output', target: '1' }] },
              { k: 'simple', line: 1, assignments: [], words: ['c'], redirects: [] },
            ],
          },
          rest: [{ op: '&&', cmd: { k: 'simple', line: 1, assignments: [], words: ['d'], redirects: [] } }],
        },
      }],
    });
  });

  it('reports a difference by its path', () => {
    const a = shape('x | y z');
    const b = shape('x | y w');
    assert.deepEqual(diffShapes(a, b).map((d) => [d.path, d.ours, d.bash]), [['$.stages[1].words[1]', 'z', 'w']]);
    assert.deepEqual(diffShapes(a, shape('x; y z')).map((d) => d.path), ['$.kind']);
  });
});

describe('bash-ast: our syntax tree against bash\'s parser', function () {
  before(function () {
    if (!bin) this.skip();
  });

  it('agrees on the shape of every input, except the known differences', function () {
    this.timeout(300000);
    const ub = createUnbashParser();
    const { files, snippets } = corpus();
    const known: Known[] = JSON.parse(fs.readFileSync(knownFile, 'utf8'));
    const used = new Set<Known>();
    const counts = { compared: 0, equal: 0, known: 0, fresh: 0, skipped: {} as Record<string, number> };
    const skip = (why: string): void => { counts.skipped[why] = (counts.skipped[why] ?? 0) + 1; };
    const fresh: string[] = [];
    const inputs = [...files.map((f) => ({ ...f, key: f.name })), ...snippets.map((s) => ({ ...s, key: s.text }))];
    for (const input of inputs) {
      const shell = detectShell(input.text, input.name);
      if (shell === 'zsh' || shell === 'ksh' || shell === 'mksh') { skip('dialect'); continue; }
      if (EXTGLOB.test(input.text)) { skip('extglob'); continue; }
      if (input.text.includes('\r')) { skip('CR'); continue; }
      const tree = ub.parse(input.text);
      const ours = hasError(tree.root) || tree.errors.length > 0 ? 'error' : shapeOfTree(tree.root);
      const r = runBashAst(bin!, input.text);
      let diffs: { path: string; ours: unknown; bash: unknown }[];
      if (!r.ok) {
        // bash-ast says "Empty input" for nothing but comments and blanks, and fails on a few more (see below)
        if (ours === null) { skip('empty'); continue; }
        diffs = ours === 'error' ? [] : [{ path: '$', ours: 'a tree', bash: `error: ${r.message}` }];
      } else if (ours === 'error') diffs = [{ path: '$', ours: 'error', bash: 'a tree' }];
      else diffs = diffShapes(ours, shapeOfAst(r.ast));
      counts.compared++;
      if (!diffs.length) { counts.equal++; continue; }
      const seen = new Set<string>();
      for (const d of diffs) {
        if (seen.has(d.path)) continue;
        seen.add(d.path);
        const k = known.find((e) => e.input === input.key && e.path === d.path);
        if (k) { used.add(k); counts.known++; continue; }
        counts.fresh++;
        fresh.push(`${input.name}\n  ${d.path}: ours ${short(d.ours)} vs bash ${short(d.bash)}`);
      }
    }
    console.log(`      bash-ast: ${counts.compared} compared (${counts.equal} equal), skipped ${JSON.stringify(counts.skipped)}, ${counts.known} known differences, ${counts.fresh} new`);
    const stale = known.filter((k) => !used.has(k)).map((k) => `stale: ${JSON.stringify(k.input).slice(0, 80)} ${k.path}`);
    assert.deepEqual([...fresh, ...stale], []);
  });
});
