import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { builtins } from '../src/dict/builtins';
import { commands, core } from '../src/dict/commands';
import { type Shell, SHELL_NAMES } from '../src/dialect';

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
 * Fields that hold a closed set of values of the syntax or the models, some of which are spelled like commands. Only a
 * property access counts (`rule.kind`, not a variable called `kind`), and only the values listed here are allowed on it:
 * a node's `.type` (any: node types, `command` among them), a status rule's `.kind` (`command`, `test`: add a value only
 * when code that needs it moves, as a reviewed edit), errexit's `.stops` (`script`), and a `.shell` (the members of
 * `Shell` in src/dialect.ts, read here from the keys of `SHELL_NAMES`, a `Record<Shell, string>`, so the compiler keeps
 * the list equal to the type). A literal on these fields that is a command name and not in the list is found (the
 * fields hold other values too, such as `subshell` or `given`, which are not names and need no entry).
 */
const CLOSED_FIELD = /\.(type|kind|stops|shell)$/;
const CLOSED_VALUES: Record<string, ReadonlySet<string> | undefined> = {
  type: undefined, // any
  kind: new Set(['command', 'test']),
  stops: new Set(['script']),
  shell: new Set(Object.keys(SHELL_NAMES)),
};

/** Whether comparing `expr` with the literal `text` is a name check: a command name, unless it is a value the field allows. */
function isNameCheck(expr: string, text: string, names: ReadonlySet<string>): boolean {
  if (!names.has(text)) return false;
  const field = CLOSED_FIELD.exec(expr)?.[1];
  const allowed = field === undefined ? undefined : CLOSED_VALUES[field];
  return field === undefined || (allowed !== undefined && !allowed.has(text));
}

/** Comparisons of a value with a string that is a dictionary command name; a value a closed field allows is left out. */
function nameComparisons(code: string, names: ReadonlySet<string>): string[] {
  const found: string[] = [];
  const lit = (q: number): string => `(['"\`])([^'"\`\\n]+)\\${q}`; // a string literal: quote, text, closing quote
  const left = new RegExp(`([\\w.$\\])]+)\\s*[!=]==?\\s*${lit(2)}`, 'g'); // x === 'sed'
  const right = new RegExp(`${lit(1)}\\s*[!=]==?\\s*([\\w.$]+)`, 'g'); // 'sed' === x
  const member = new RegExp(`([\\w.$\\])]*)\\.(?:includes|has)\\(\\s*${lit(2)}`, 'g'); // list.includes('sed')
  for (let m = left.exec(code); m; m = left.exec(code)) if (isNameCheck(m[1], m[3], names)) found.push(m[0]);
  for (let m = right.exec(code); m; m = right.exec(code)) if (isNameCheck(m[3], m[2], names)) found.push(m[0]);
  for (let m = member.exec(code); m; m = member.exec(code)) if (isNameCheck(m[1], m[3], names)) found.push(m[0]);
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
    const names = new Set(['sed', 'declare', 'command', 'script', 'bash', 'grep', 'test']);
    assert.strictEqual(nameComparisons(`if (name === 'sed') {}`, names).length, 1);
    assert.strictEqual(nameComparisons(`if ('declare' !== x.name) {}`, names).length, 1);
    assert.strictEqual(nameComparisons(`['a'].includes('declare')`, names).length, 1);
    assert.strictEqual(nameComparisons(`s.has("sed")`, names).length, 1);
    assert.strictEqual(nameComparisons(`n.type === 'command' || 'command' === n.type || n.type === 'other'`, names).length, 0);
    assert.strictEqual(nameComparisons(`spec.shell === 'bash' || x.subshell === 'sed' || kinds.has('sed')`, names).length, 2);
  });

  it('allows the comparisons the moved code needs on closed fields, and no other value', () => {
    const names = new Set(['sed', 'command', 'test', 'script', 'bash', 'grep']);
    for (const ok of [`rule.kind !== 'command'`, `rule.kind !== 'test'`, `ctx.stops !== 'script'`, `cx.shell === 'bash'`, `'command' === n.type`]) {
      assert.deepStrictEqual(nameComparisons(ok, names), [], ok);
    }
    // A bare identifier is checked like any other expression; so are command names that a closed field does not allow.
    assert.deepStrictEqual(nameComparisons(`x.kind === 'subshell' || x.stops === 'never' || kind === 'other'`, names), []);
    for (const bad of [`shell === 'bash'`, `kind === 'sed'`, `type === 'sed'`, `x.kind === 'grep'`, `node.stops === 'sed'`, `x.shell === 'sed'`, `'sed' === x.shell`, `x.kind.has('sed')`]) {
      assert.strictEqual(nameComparisons(bad, names).length, 1, bad);
    }
  });

  it('allows as values of `.shell` exactly the members of the Shell type', () => {
    // SHELL_NAMES is a Record<Shell, string>, so the compiler keeps its keys equal to the union in src/dialect.ts.
    const members: Shell[] = ['ash', 'bash', 'dash', 'ksh', 'mksh', 'sh', 'yash', 'zsh'];
    assert.deepStrictEqual([...CLOSED_VALUES.shell!].sort(), members);
    assert.deepStrictEqual(Object.keys(SHELL_NAMES).sort(), members);
  });
});
