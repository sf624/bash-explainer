import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { builtins } from '../src/dict/builtins';
import { commands, core } from '../src/dict/commands';

// Guards for src/explain/ (docs/design/analyzer.md, 3.2 and 3.3): no import cycles, no import of
// src/analyzer.ts, and no comparison with the name of a dictionary command. The directory exists since step 2
// (src/explain/context.ts and nodes.ts); before, the checks passed with nothing to read.
const base = path.join(__dirname, '..');
const dir = path.join(base, 'src', 'explain');

/** Known comparisons with a command name, each with a reason; it may only shrink (empty after step 1). */
const KNOWN_NAMES: { file: string; text: string; reason: string }[] = [];

/** The relative modules a source imports, re-exports, requires or imports dynamically. */
function relativeImports(code: string): string[] {
  const out: string[] = [];
  const re = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)['"`](\.[^'"`]*)['"`]/g;
  for (let m = re.exec(code); m; m = re.exec(code)) out.push(m[1]);
  return out;
}

/** The cycles of a graph (node to nodes), each as a path that ends where it started; empty for a DAG. */
function findCycles(graph: Map<string, string[]>): string[][] {
  const cycles: string[][] = [];
  const state = new Map<string, 1 | 2>();
  const stack: string[] = [];
  const visit = (n: string): void => {
    state.set(n, 1);
    stack.push(n);
    for (const m of graph.get(n) ?? []) {
      if (state.get(m) === 1) cycles.push([...stack.slice(stack.indexOf(m)), m]);
      else if (!state.has(m)) visit(m);
    }
    stack.pop();
    state.set(n, 2);
  };
  for (const n of graph.keys()) if (!state.has(n)) visit(n);
  return cycles;
}

/**
 * Fields that hold a closed set of values of the syntax or the models, some of which are spelled like commands: a node's
 * `.type` (`command`), a status rule's or a link's `.kind` (`command`, `test`), errexit's `.stops` (`script`), and the
 * shell (`bash`, `sh`). A comparison on them is not a name check.
 */
const CLOSED_FIELDS = /(^|\.)(type|kind|stops|shell)$/;

/** Comparisons of a value with a string that is a dictionary command name; a comparison on a closed field is left out. */
function nameComparisons(code: string, names: ReadonlySet<string>): string[] {
  const found: string[] = [];
  const lit = (q: number): string => `(['"\`])([^'"\`\\n]+)\\${q}`; // a string literal: quote, text, closing quote
  const left = new RegExp(`([\\w.$\\])]+)\\s*[!=]==?\\s*${lit(2)}`, 'g'); // x === 'sed'
  const right = new RegExp(`${lit(1)}\\s*[!=]==?\\s*([\\w.$]+)`, 'g'); // 'sed' === x
  const member = new RegExp(`([\\w.$\\])]*)\\.(?:includes|has)\\(\\s*${lit(2)}`, 'g'); // list.includes('sed')
  for (let m = left.exec(code); m; m = left.exec(code)) if (names.has(m[3]) && !CLOSED_FIELDS.test(m[1])) found.push(m[0]);
  for (let m = right.exec(code); m; m = right.exec(code)) if (names.has(m[2]) && !CLOSED_FIELDS.test(m[3])) found.push(m[0]);
  for (let m = member.exec(code); m; m = member.exec(code)) if (names.has(m[3]) && !CLOSED_FIELDS.test(m[1])) found.push(m[0]);
  return found;
}

const files = (): string[] => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /\.ts$/.test(f)).map((f) => path.join(dir, f)) : []);

describe('src/explain guards', () => {
  it('has no import cycle and does not import src/analyzer.ts', () => {
    const graph = new Map<string, string[]>();
    const analyzer = path.join(base, 'src', 'analyzer');
    const importsAnalyzer: string[] = [];
    for (const f of files()) {
      const targets = relativeImports(fs.readFileSync(f, 'utf8')).map((r) => path.resolve(path.dirname(f), r).replace(/\.(js|ts)$/, ''));
      if (targets.includes(analyzer)) importsAnalyzer.push(path.relative(base, f));
      // Only the modules of src/explain/ can close a cycle among themselves.
      graph.set(f.replace(/\.ts$/, ''), targets.filter((t) => path.dirname(t) === dir));
    }
    assert.deepStrictEqual(importsAnalyzer, []);
    assert.deepStrictEqual(findCycles(graph).map((c) => c.map((p) => path.basename(p)).join(' -> ')), []);
  });

  it('compares nothing with the name of a dictionary command, except the known ones', () => {
    const names = new Set([...Object.keys(commands), ...Object.keys(builtins), ...Object.keys(core)]);
    assert.ok(names.has('sed') && names.has('declare'));
    const found = files().flatMap((f) => nameComparisons(fs.readFileSync(f, 'utf8'), names).map((text) => ({ file: path.relative(base, f), text })));
    const unknown = found.filter((x) => !KNOWN_NAMES.some((k) => k.file === x.file && k.text === x.text));
    assert.deepStrictEqual(unknown, []);
    const stale = KNOWN_NAMES.filter((k) => !found.some((x) => x.file === k.file && x.text === k.text));
    assert.deepStrictEqual(stale, []);
  });
});

describe('the finders of the src/explain guards', () => {
  it('reads relative imports of every form', () => {
    assert.deepStrictEqual(
      relativeImports(`import { a } from './a';\nexport * from "../b";\nimport './c';\nconst d = require('./d');\ntype T = import('./e').T;\nimport x from 'node:fs';`),
      ['./a', '../b', './c', './d', './e'],
    );
  });

  it('finds cycles and leaves a DAG alone', () => {
    const g = (o: Record<string, string[]>): Map<string, string[]> => new Map(Object.entries(o));
    assert.deepStrictEqual(findCycles(g({ a: ['b', 'c'], b: ['c'], c: [] })), []);
    assert.deepStrictEqual(findCycles(g({ a: ['b'], b: ['c'], c: ['a'] })), [['a', 'b', 'c', 'a']]);
    assert.deepStrictEqual(findCycles(g({ a: ['a'] })), [['a', 'a']]);
  });

  it('finds comparisons with command names, not with node types or other closed fields', () => {
    const names = new Set(['sed', 'declare', 'command', 'script', 'bash']);
    assert.strictEqual(nameComparisons(`if (name === 'sed') {}`, names).length, 1);
    assert.strictEqual(nameComparisons(`if ('declare' !== x.name) {}`, names).length, 1);
    assert.strictEqual(nameComparisons(`['a'].includes('declare')`, names).length, 1);
    assert.strictEqual(nameComparisons(`s.has("sed")`, names).length, 1);
    assert.strictEqual(nameComparisons(`n.type === 'command' || 'command' === n.type || kind === 'other'`, names).length, 0);
    assert.strictEqual(nameComparisons(`rule.kind !== 'command' || ctx.stops !== 'script' || cx.shell === 'bash' || shell === 'bash'`, names).length, 0);
    assert.strictEqual(nameComparisons(`spec.shell === 'bash' || x.subshell === 'sed' || kinds.has('sed')`, names).length, 2);
  });
});
