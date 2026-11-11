// The merge of the states a node ran with, each name when it is read (`mergeOnRead`, `NameMap.mergeAll`;
// docs/design/large-scripts.md, step 1a): the same values as the eager `merge`, the same objects where it keeps
// one, over the corpus; and a bound on the calls of the merge functions on a long dispatcher.
import * as assert from 'assert';
import { diagnosticsFor } from '../src/document';
import { openDocument, shellsOf } from '../src/document-setup';
import { documentHighlight } from '../src/highlight';
import { defaultSettings } from '../src/settings';
import { EMPTY, type Kind, merge, mergeOnRead, NameMap, type ShellState, type VariableState } from '../src/semantics/shellstate';
import { shellState } from '../src/semantics/state';
import { Walker } from '../src/semantics/walk/walker';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { descendants, type SyntaxNode } from '../src/syntax/tree';
import { corpus } from './support/corpus';
import { prefixDispatcher } from './support/dispatch';

const parser = createUnbashParser();
const KINDS: Kind[] = ['set', 'shopt', 'variables', 'functions', 'aliases', 'disabled', 'hashed', 'traps'];

/** A syntax node: compared by identity (it has cycles through its parent). */
const isNode = (v: object): boolean => 'startIndex' in v && 'parent' in v && 'type' in v;

/** Deep equality of two values of a state, with syntax nodes compared by identity and maps by their entries. */
function equal(x: unknown, y: unknown): boolean {
  if (x === y) return true;
  if (typeof x !== 'object' || typeof y !== 'object' || !x || !y || isNode(x) || isNode(y)) return false;
  if (x instanceof NameMap || y instanceof NameMap) {
    if (!(x instanceof NameMap && y instanceof NameMap) || x.size !== y.size) return false;
    const ys = [...y];
    return [...x].every(([k, v], i) => ys[i][0] === k && equal(v, ys[i][1]));
  }
  if (Array.isArray(x) !== Array.isArray(y)) return false;
  const kx = Object.keys(x);
  const ky = Object.keys(y);
  return kx.length === ky.length && kx.every((k, i) => ky[i] === k && equal((x as Record<string, unknown>)[k], (y as Record<string, unknown>)[k]));
}

/** The names of a kind in any of `states`. */
const namesOf = (states: readonly ShellState[], kind: Kind): string[] => [...new Set(states.flatMap((s) => [...s[kind].keys()]))];

/**
 * Whether the lazy merge of `sources` says what the eager one says: the same values (in the same order), and the
 * same object as source j's exactly where the eager merge keeps that one. With `partial`, some names are read
 * before the maps are iterated, and must be the same objects after.
 */
function check(sources: readonly ShellState[], posix: boolean, partial: boolean): string | undefined {
  const lazy = mergeOnRead(sources, posix);
  const eager = merge([...sources], posix);
  const read = new Map<string, unknown>();
  if (partial) {
    for (const kind of KINDS) namesOf(sources, kind).forEach((name, i) => i % 2 || read.set(`${kind} ${name}`, lazy[kind].get(name)));
  }
  for (const kind of KINDS) {
    for (const name of namesOf(sources, kind)) {
      const [l, e] = [lazy[kind].get(name), eager[kind].get(name)];
      if (read.has(`${kind} ${name}`) && read.get(`${kind} ${name}`) !== l) return `${kind} ${name}: another object after a second read`;
      for (const [j, s] of sources.entries()) if ((l === s[kind].get(name)) !== (e === s[kind].get(name))) return `${kind} ${name}: identity with source ${j}`;
    }
    if (!equal(lazy[kind], eager[kind])) return `${kind}: ${JSON.stringify([...lazy[kind].keys()])} against ${JSON.stringify([...eager[kind].keys()])}`;
    for (const [key, v] of read) {
      const [k, name] = key.split(' ');
      if (k === kind && v !== undefined && [...lazy[kind]].find(([n]) => n === name)?.[1] !== v) return `${kind} ${name}: another object when iterated`;
    }
  }
  for (const key of ['status', 'errexitWhy', 'opaque', 'unreachable'] as const) if (lazy[key] !== eager[key]) return `${key}: ${lazy[key]} against ${eager[key]}`;
  return undefined;
}

/** Runs `f` with `Walker.runAt` checking each merge it makes against the eager one; gives the differences, and how many merges it checked. */
function checkingRunAt(f: () => void): { bad: string[]; merges: number } {
  const proto = Walker.prototype as unknown as { runAt: (n: SyntaxNode) => ShellState | undefined; posix: boolean; runStates: Map<SyntaxNode, ShellState[]> };
  const real = proto.runAt;
  const bad: string[] = [];
  let merges = 0;
  proto.runAt = function (this: typeof proto, n: SyntaxNode) {
    const states = this.runStates.get(n);
    if (states && states.length > 1) {
      const why = check(states, this.posix, merges++ % 2 === 0);
      if (why && bad.length < 20) bad.push(`${JSON.stringify(n.text.slice(0, 40))}: ${why}`);
    }
    return real.call(this, n);
  };
  try {
    f();
  } finally {
    proto.runAt = real;
  }
  return { bad, merges };
}

/** Every node's state, as the explanations ask for it. */
function readAll(text: string, shell: 'bash' | 'sh'): void {
  const tree = parser.parse(text);
  const model = shellState(tree, shell);
  for (const stack = [tree.root]; stack.length;) {
    const n = stack.pop()!;
    model.at(n);
    stack.push(...n.children);
  }
}

describe('the merge of the states a node ran with, on read', function () {
  this.timeout(600000);

  it('says what the eager merge says over the corpus and a long dispatcher, with the same objects', () => {
    const { files, snippets } = corpus();
    const { bad, merges } = checkingRunAt(() => {
      for (const { text } of [...files, ...snippets]) readAll(text, 'bash');
      for (const { text } of files) readAll(text, 'sh');
      readAll(prefixDispatcher(12, 3), 'bash');
    });
    assert.deepStrictEqual(bad, []);
    assert.ok(merges > 300, `${merges} merges checked`);
  });

  it('says the same for a body no call reaches, walked from its definition merged on read', () => {
    // (`uncalled`: the definition ran with two states, merged on read, and the body is walked from that.)
    const text = 'for i in a b; do\n  x=$i\n  f() { echo "$x"; y=1; }\ndone\necho "$y"\n';
    const { bad, merges } = checkingRunAt(() => {
      const tree = parser.parse(text);
      shellState(tree, 'bash');
    });
    assert.deepStrictEqual(bad, []);
    assert.ok(merges >= 1, 'the walk merged the definition\'s states');
    const tree = parser.parse(text);
    const model = shellState(tree, 'bash');
    const echo = descendants(tree.root, ['command']).find((c) => c.text === 'echo "$x"')!;
    // (Set on both paths, to `a` on one and `b` on the other.)
  const x = model.at(echo).run.variables.get('x');
  assert.strictEqual(x?.set, 'on');
  assert.strictEqual(x?.value, undefined);
  });

  it('keeps values and order, reads each name once, and drops its sources once all are read', () => {
    const at = parser.parse('x').root;
    const v = (value: string): VariableState => ({ declared: 'on', set: 'on', attrs: {}, value, at });
    const shared = v('s');
    const a: ShellState = { ...EMPTY, variables: EMPTY.variables.with('s', shared).with('x', v('1')).with('y', v('a')), status: 0 };
    const b: ShellState = { ...EMPTY, variables: a.variables.with('x', v('2')).with('z', v('z')), status: 0, opaque: true };
    const c: ShellState = { ...b, set: b.set.with('posix', 'on') };
    // (The same state on every path is that state itself; none that gets here gives the first.)
    assert.strictEqual(mergeOnRead([a, a]), a);
    const gone = { ...a, unreachable: true as const };
    assert.strictEqual(mergeOnRead([gone, gone]), gone);
    for (const posix of [false, true]) {
      const lazy = mergeOnRead([a, b, c], posix);
      const eager = merge([a, b, c], posix);
      assert.ok(equal(lazy, eager), `posix ${posix}`);
    }
    const lazy = mergeOnRead([a, b]);
    const vars = lazy.variables;
    const x = vars.get('x');
    assert.strictEqual(x?.value, undefined);
    assert.strictEqual(vars.get('x'), x, 'read once');
    assert.strictEqual(vars.get('s'), shared, 'kept where both paths have it');
    assert.ok(!vars.has('w') && !vars.has('w'), 'an absent name');
    assert.strictEqual(vars.size, 4);
    assert.strictEqual(vars.size, 4, 'counted once');
    assert.strictEqual(lazy.status, 0);
    assert.strictEqual(lazy.opaque, true);
    // (Iterated: the names of the first map, then the new ones of the next, as the pairwise merge has them.)
    assert.deepStrictEqual([...vars.keys()], [...merge([a, b]).variables.keys()]);
    assert.strictEqual([...vars].find(([k]) => k === 'x')?.[1], x, 'the object read before');
    assert.strictEqual(vars.get('x'), x, 'and after');
    const buckets = (vars as unknown as { buckets: (ReadonlyMap<string, VariableState> & { sources?: unknown })[] }).buckets;
    for (const bucket of buckets) assert.strictEqual(bucket?.sources, undefined);
    // (Every way to read a bucket merged on read gives the same.)
    const fresh = () => mergeOnRead([a, b]).variables;
    const all = [...merge([a, b]).variables];
    assert.deepStrictEqual([...fresh().entries()], all);
    assert.deepStrictEqual([...fresh().values()], all.map(([, w]) => w));
    const seen: string[] = [];
    fresh().forEach((_w, k) => seen.push(k));
    assert.deepStrictEqual(seen, all.map(([k]) => k));
    const m = fresh();
    for (const _ of m);
    assert.strictEqual(m.size, 4);
  });

  it('calls the merge functions a bounded number of times on a long dispatcher', () => {
    // (docs/design/large-scripts.md, 2.6: 40 commands called with prefix assignments, 650 lines. Merged at once,
    // the colours and the problems made 185,320 calls, and the walk 60,330.)
    const counted = NameMap as unknown as Record<'merge' | 'mergeAll', (...args: unknown[]) => unknown>;
    const real = { merge: counted.merge, mergeAll: counted.mergeAll };
    let calls = 0;
    const count = (f: (...x: unknown[]) => unknown) => (...x: unknown[]) => (calls++, f(...x));
    counted.merge = (a, b, f) => real.merge.call(NameMap, a, b, count(f as (...x: unknown[]) => unknown));
    counted.mergeAll = (maps, f) => real.mergeAll.call(NameMap, maps, count(f as (...x: unknown[]) => unknown));
    try {
      const text = prefixDispatcher(40, 3);
      const doc = openDocument(text, 'shell', (s) => parser.parse(s));
      const shells = shellsOf(doc.lines, 'dispatch.sh', undefined, 'said');
      shellState(doc.tree, 'bash');
      const walk = calls;
      calls = 0;
      documentHighlight(doc, { shells });
      diagnosticsFor(() => doc, () => shells, 'en', defaultSettings(), 'web');
      assert.ok(walk > 0 && walk <= 120000, `the walk: ${walk} calls`);
      assert.ok(calls > 0 && calls <= 20000, `the colours and the problems: ${calls} calls`);
    } finally {
      Object.assign(counted, real);
    }
  });
});
