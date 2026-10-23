import * as assert from 'assert';
import { run } from './support/run';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Analyzer, Token } from '../src/analyzer';
import type { BashParser as Parser } from '../src/syntax/tree';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { parseTest, TestExpr, testRange } from '../src/testexpr';

const root = path.join(__dirname, '..');
let parser: Parser;
let dir: string;
before(async () => {
  parser = createUnbashParser();
  // Files for the tests: `f` and `a` are files, `d` is a directory, `file` is a file; `c` does not exist.
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'testexpr-'));
  for (const f of ['f', 'a', 'b', 'file']) fs.writeFileSync(path.join(dir, f), 'x');
  fs.mkdirSync(path.join(dir, 'd'));
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));

/** Exit statuses of bash's `[` for each script line (a command each), run in `dir` with the given variables. */
function bashStatuses(lines: string[], vars: Record<string, string> = {}): number[] {
  const script = lines.map((l) => `${l}\necho $?`).join('\n');
  const out = run('bash', ['-s'], { cwd: dir, input: script, env: { ...process.env, ...vars }, ignoreStderr: true, maxBuffer: 1 << 28, check: true }).stdout.toString();
  return out.split('\n').filter((l) => l !== '').map(Number);
}

const quote = (w: string) => `'${w}'`;

/** The text of a parse, fully parenthesised. */
function show(e: TestExpr, w: string[]): string {
  switch (e.type) {
    case 'word': return w[e.at];
    case 'unary': return `${w[e.op]} ${w[e.arg]}`;
    case 'binary': return `${w[e.left]} ${w[e.op]} ${w[e.right]}`;
    case 'not': return `!(${show(e.operand, w)})`;
    case 'group': return `(${show(e.inner, w)})`;
    default: return `(${show(e.left, w)} ${w[e.op]} ${show(e.right, w)})`;
  }
}
const parsed = (src: string) => {
  const w = src === '' ? [] : src.split(' ');
  const e = parseTest(w);
  return e && show(e, w);
};

/** Evaluates a parse the way `[` does, for the words used below. Throws where bash reports an error. */
function evaluate(e: TestExpr, w: string[]): boolean {
  const int = (s: string) => {
    if (!/^-?\d+$/.test(s)) throw new Error('integer expression expected');
    return Number(s);
  };
  const stat = (s: string) => {
    try { return s === '' ? undefined : fs.statSync(path.join(dir, s)); } catch { return undefined; }
  };
  switch (e.type) {
    case 'word': return w[e.at] !== '';
    case 'not': return !evaluate(e.operand, w);
    case 'group': return evaluate(e.inner, w);
    case 'and': { const l = evaluate(e.left, w); const r = evaluate(e.right, w); return l && r; }
    case 'or': { const l = evaluate(e.left, w); const r = evaluate(e.right, w); return l || r; }
    case 'unary': {
      const a = w[e.arg];
      switch (w[e.op]) {
        case '-n': return a !== '';
        case '-z': return a === '';
        case '-f': return !!stat(a)?.isFile();
        case '-d': return !!stat(a)?.isDirectory();
        case '-a': case '-e': return !!stat(a);
        // No option is named like the words used here.
        case '-o': return false;
        /* c8 ignore next 2 */
        default: throw new Error(`no ${w[e.op]}`);
      }
    }
    default: {
      const [l, op, r] = [w[e.left], w[e.op], w[e.right]];
      switch (op) {
        case '=': case '==': return l === r;
        case '!=': return l !== r;
        case '-eq': return int(l) === int(r);
        case '-lt': return int(l) < int(r);
        /* c8 ignore next 2 */
        default: throw new Error(`no ${op}`);
      }
    }
  }
}

describe('[ ] arguments are read as bash reads them', () => {
  it('follows the rules by the number of arguments', () => {
    assert.strictEqual(parsed(''), undefined);
    assert.strictEqual(parsed('-n'), '-n');
    assert.strictEqual(parsed('!'), '!');
    assert.strictEqual(parsed('= x'), undefined);
    assert.strictEqual(parsed('! x'), '!(x)');
    assert.strictEqual(parsed('-n x'), '-n x');
    assert.strictEqual(parsed('a = b'), 'a = b');
    assert.strictEqual(parsed('a -a b'), '(a -a b)');
    assert.strictEqual(parsed('a -o b'), '(a -o b)');
    // An operator in the middle wins over `!`, `(` and `-a`.
    assert.strictEqual(parsed('! = a'), '! = a');
    assert.strictEqual(parsed('! -a !'), '(! -a !)');
    assert.strictEqual(parsed('! -n x'), '!(-n x)');
    assert.strictEqual(parsed('! -a x'), '(! -a x)');
    assert.strictEqual(parsed('( a )'), '(a)');
    assert.strictEqual(parsed('( a b'), undefined);
    assert.strictEqual(parsed('a b c'), undefined);
    assert.strictEqual(parsed('! ( a )'), '!((a))');
    assert.strictEqual(parsed('( -n a )'), '(-n a)');
    assert.strictEqual(parsed('! a = b'), '!(a = b)');
  });

  it('binds -o looser than -a, -a looser than !, ! looser than the primaries', () => {
    assert.strictEqual(parsed('a -eq 1 -a b -eq 2'), '(a -eq 1 -a b -eq 2)');
    assert.strictEqual(parsed('-f a -a -f b'), '(-f a -a -f b)');
    assert.strictEqual(parsed('! a = b -a -f c'), '(!(a = b) -a -f c)');
    assert.strictEqual(parsed('a = b -a c = d'), '(a = b -a c = d)');
    assert.strictEqual(parsed('a -a b -o c'), '((a -a b) -o c)');
    assert.strictEqual(parsed('a -o b -a c'), '(a -o (b -a c))');
    assert.strictEqual(parsed('a -o b -o c'), '(a -o (b -o c))');
    assert.strictEqual(parsed('! -f a -a -n b'), '(!(-f a) -a -n b)');
    assert.strictEqual(parsed('! ! a -o b'), '(!(!(a)) -o b)');
    assert.strictEqual(parsed('( a = b ) -o c = d'), '((a = b) -o c = d)');
    assert.strictEqual(parsed('( a -o b ) -a c'), '(((a -o b)) -a c)');
    assert.strictEqual(parsed('a = b -a ( c -o d )'), '(a = b -a ((c -o d)))');
    assert.strictEqual(parsed('a -a b -a c -a d'), '(a -a (b -a (c -a d)))');
  });

  it('reads -a and -o as unary operators where an operand is expected', () => {
    assert.strictEqual(parsed('-a file'), '-a file');
    assert.strictEqual(parsed('-o noclobber'), '-o noclobber');
    assert.strictEqual(parsed('-a file -a -o noclobber'), '(-a file -a -o noclobber)');
    assert.strictEqual(parsed('-n x -o -a y'), '(-n x -o -a y)');
  });

  it('gives up where bash reports an error, and for -t without a number', () => {
    assert.strictEqual(parsed('a && b'), undefined);
    assert.strictEqual(parsed('a -a b -o'), undefined);
    assert.strictEqual(parsed('a -a b -a'), undefined);
    assert.strictEqual(parsed('( a -a b -o'), undefined);
    assert.strictEqual(parsed('! ! ! ! !'), undefined);
    assert.strictEqual(parsed('a -a b c d'), undefined);
    assert.strictEqual(parsed('-z a -a -q b'), undefined);
    assert.strictEqual(parsed('-n a -a -n'), '(-n a -a -n)');
    assert.strictEqual(parsed('-t 1 -a -t 2'), '(-t 1 -a -t 2)');
    assert.strictEqual(parsed('-t 1 -a -t x'), undefined);
    assert.strictEqual(parsed('y -a x -a -t'), undefined);
    // A word that depends on an expansion is never an operator.
    assert.deepStrictEqual(parseTest([null, null]), undefined);
    assert.deepStrictEqual(parseTest([null, null, null]), undefined);
    assert.deepStrictEqual(parseTest([null, '-a', null]), { type: 'and', op: 1, left: { type: 'word', at: 0 }, right: { type: 'word', at: 2 } });
    assert.deepStrictEqual(parseTest(['x', null, 'y', '-a', 'z']), undefined);
    assert.deepStrictEqual(parseTest([null, '-a', null, '-o', 'x']), {
      type: 'or', op: 3, left: { type: 'and', op: 1, left: { type: 'word', at: 0 }, right: { type: 'word', at: 2 } }, right: { type: 'word', at: 4 },
    });
    assert.deepStrictEqual(parseTest(['-t', null, '-a', 'x', '-o']), undefined);
    assert.deepStrictEqual(parseTest(['-t', null, '-a', 'x', '-o', 'y']), {
      type: 'or', op: 4, left: { type: 'and', op: 2, left: { type: 'unary', op: 0, arg: 1 }, right: { type: 'word', at: 3 } }, right: { type: 'word', at: 5 },
    });
  });

  it('knows which words each part covers', () => {
    const e = parseTest(['!', 'a', '=', 'b', '-a', '(', '-f', 'c', ')'])!;
    assert.deepStrictEqual(testRange(e), [0, 8]);
    assert.deepStrictEqual(testRange((e as Extract<TestExpr, { type: 'and' | 'or' }>).left), [0, 3]);
    assert.deepStrictEqual(testRange((e as Extract<TestExpr, { type: 'and' | 'or' }>).right), [5, 8]);
  });

  it('agrees with bash on the edge cases of the argument count', () => {
    const lists = [['='], ['-n'], ['!'], ['!', '=', 'a'], ['-a', 'f'], ['-o', 'noclobber'], ['a', '-a', 'b', '-o', 'c'],
      ['(', 'a', '=', 'b', ')', '-o', 'c', '=', 'd'], ['!', '-f', 'a', '-a', '-n', 'b'], ['!', 'a', '=', 'b', '-a', '-f', 'c'], ['-f', 'a', '-a', '-f', 'b'], ['1', '-eq', '1', '-a', '2', '-eq', '2']];
    const real = bashStatuses(lists.map((l) => `[ ${l.map(quote).join(' ')} ]`));
    const mine = lists.map((l) => (evaluate(parseTest(l)!, l) ? 0 : 1));
    assert.deepStrictEqual(mine, real);
  });

  it('agrees with bash on every list of up to four words, and on random longer ones', function () {
    this.timeout(60000);
    const vocabulary = ['', 'x', 'f', 'd', '1', '2', '!', '(', ')', '-a', '-o', '-n', '-z', '-f', '-d', '-eq', '-lt', '=', '!=', '-q'];
    const lists: string[][] = [[]];
    let layer: string[][] = [[]];
    for (let len = 1; len <= 4; len++) {
      layer = layer.flatMap((l) => vocabulary.map((w) => [...l, w]));
      for (const l of layer) lists.push(l);
    }
    // A fixed pseudo-random sequence.
    let seed = 12345;
    const random = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return Math.floor((seed / 2147483648) * n);
    };
    for (let k = 0; k < 10000; k++) {
      lists.push(Array.from({ length: 5 + random(5) }, () => vocabulary[random(vocabulary.length)]));
    }
    const real = bashStatuses(lists.map((l) => `[ ${l.map(quote).join(' ')} ]`));
    assert.strictEqual(real.length, lists.length);
    const wrong: string[] = [];
    lists.forEach((l, i) => {
      const e = parseTest(l);
      let mine: number;
      try {
        mine = !e ? 2 : evaluate(e, l) ? 0 : 1;
      } catch {
        mine = 2;
      }
      // `[ ]` with no words is false (1), not an error.
      if (l.length === 0) mine = 1;
      if (mine !== real[i]) wrong.push(`[ ${l.join(' ')} ]: bash ${real[i]}, here ${mine} (${e && show(e, l)})`);
    });
    assert.deepStrictEqual(wrong.slice(0, 40), []);
  });
});

/** A token tree of a `[ ]` turned into commands that group as the tree does, which bash then runs. */
function regroup(t: Token): string {
  if (t.explanation.startsWith('Negation')) return `! { ${regroup(t.children[0])}; }`;
  if (t.explanation.startsWith('both are true (AND')) return `{ ${regroup(t.children[0])} && ${regroup(t.children[1])}; }`;
  if (t.explanation.startsWith('either is true (OR')) return `{ ${regroup(t.children[0])} || ${regroup(t.children[1])}; }`;
  if (t.explanation.startsWith('Parenthesized')) return regroup(t.children[0]);
  return `[ ${t.label} ]`;
}

/** The same as a string, for reading: `!` / `&` / `|` and parentheses. */
function groups(t: Token): string {
  if (t.explanation.startsWith('Negation')) return `!${groups(t.children[0])}`;
  if (t.explanation.startsWith('both are true (AND')) return `(${groups(t.children[0])} & ${groups(t.children[1])})`;
  if (t.explanation.startsWith('either is true (OR')) return `(${groups(t.children[0])} | ${groups(t.children[1])})`;
  if (t.explanation.startsWith('Parenthesized')) return `(${groups(t.children[0])})`;
  return `[${t.label}]`;
}

describe('[ ] in the analyzer groups as bash does', () => {
  const analyze = (src: string) => {
    const tree = parser.parse(src)!;
    assert.strictEqual(tree.root.children[0].type, 'command', src);
    return new Analyzer('en').explainLine(tree, 0, 'bash')!.items[0].children[1];
  };
  const cases: [string, string][] = [
    ['[ "$a" -eq 1 -a "$b" -eq 2 ]', '(["$a" -eq 1] & ["$b" -eq 2])'],
    ['[ -f a -a -f b ]', '([-f a] & [-f b])'],
    ['[ ! a = b -a -f c ]', '(![a = b] & [-f c])'],
    ['[ a = b -a c = d ]', '([a = b] & [c = d])'],
    ['[ -a file ]', '[-a file]'],
    ['[ -o noclobber ]', '[-o noclobber]'],
    ['[ ! -f a -a -n b ]', '(![-f a] & [-n b])'],
    ['[ a -a b -o c ]', '(([a] & [b]) | [c])'],
    ['[ a -o b -a c ]', '([a] | ([b] & [c]))'],
    ['[ -n "$x" ]', '[-n "$x"]'],
    ['[ "$x" ]', '["$x"]'],
    ['[ ! "$x" ]', '!["$x"]'],
    ['[ = ]', '[=]'],
    ['[ -n ]', '[-n]'],
    ['[ -a ]', '[-a]'],
    ['[ -f a -o -f c -a -f c ]', '([-f a] | ([-f c] & [-f c]))'],
    ['[ -f c -a -f a -o -f b ]', '(([-f c] & [-f a]) | [-f b])'],
    ['[ ! -f c -o -f c -a -f a ]', '(![-f c] | ([-f c] & [-f a]))'],
    ['[ -a file -a -o noclobber ]', '([-a file] & [-o noclobber])'],
    ['[ "$a" = "$b" -o "$a" -eq 1 ]', '(["$a" = "$b"] | ["$a" -eq 1])'],
    ['[ -z "$x" -a -n "$a" ]', '([-z "$x"] & [-n "$a"])'],
    ['[ x = x -a ! d = f ]', '([x = x] & ![d = f])'],
    ['[ ! x = y ]', '![x = y]'],
    ['[ a = *"$a"*z ]', '[a = *"$a"*z]'],
    // Groups are written \( \): bash rejects bare parentheses in `[ ]` as a syntax error.
    ['[ \\( a = b \\) -o c = d ]', '(([a = b]) | [c = d])'],
    ['[ \\( a -o b \\) -a c ]', '((([a] | [b])) & [c])'],
  ];
  const sets: Record<string, string>[] = [
    { a: '1', b: '2', x: '' }, { a: '1', b: '3', x: 'y' }, { a: '2', b: '2', x: 'y' }, { a: '3', b: '1', x: '1' }, { a: '2', b: '1', x: 'f' },
  ];
  for (const [src, expected] of cases) {
    it(src, () => {
      const t = analyze(src);
      assert.strictEqual(groups(t), expected);
      for (const vars of sets) {
        assert.deepStrictEqual(bashStatuses([regroup(t)], vars), bashStatuses([src], vars), `${src} with ${JSON.stringify(vars)}`);
      }
    });
  }

  it('reads exactly the readings that differ from the tree: each reading gives its own status', () => {
    // Under the tree's old reading, `[ "$a" -eq 1 -a "$b" -eq 2 ]` was an error for every value.
    assert.deepStrictEqual(bashStatuses(['[ "$a" -eq 1 -a "$b" -eq 2 ]'], { a: '1', b: '2' }), [0]);
    assert.deepStrictEqual(bashStatuses(['[ "$a" -eq 1 -a "$b" -eq 2 ]'], { a: '1', b: '3' }), [1]);
    assert.deepStrictEqual(bashStatuses(['[ ! a = b -a -f c ]'], {}), [1]);
    assert.deepStrictEqual(bashStatuses(['[ ! a = b -a -f a ]'], {}), [0]);
  });

  it('gives the explanations of the parts', () => {
    const t = analyze('[ -f a -a -n "$b" ]');
    assert.strictEqual(t.explanation, 'both are true (AND, obsolescent)');
    assert.deepStrictEqual(t.children.map((c) => [c.label, c.explanation, c.span.start.character, c.span.end.character]), [
      ['-f a', 'Condition: `a` is an existing regular file', 2, 6],
      ['-n "$b"', 'Condition: `"$b"` is a non-empty string', 10, 17],
    ]);
    assert.strictEqual(t.children[1].children[0].kind, 'string');
    const word = analyze('[ -n ]');
    assert.deepStrictEqual([word.kind, word.label, word.explanation], ['argument', '-n', 'Word `-n`']);
    assert.strictEqual(analyze('[ -a file ]').explanation, 'Condition: `file` exists (same as `-e`, obsolescent)');
    assert.strictEqual(analyze('[ ! a ]').explanation, 'Negation: true if `a` is false');
    // (`*"$y"*z` is one word, with three parts.)
    assert.strictEqual(analyze('[ a = *"$y"*z ]').children.length, 1);
    assert.strictEqual(analyze('[ a = *"$y"*z ]').children[0].children.length, 3);
  });

  it('keeps the tree where the words are not a valid test, and for an empty one', () => {
    for (const src of ['[ a && b ]', '[ ]', '[ -t -a x ]']) {
      const tree = parser.parse(src)!;
      assert.doesNotThrow(() => new Analyzer('en').explainLine(tree, 0, 'bash'), src);
    }
  });
});

// A command that runs `[` (or `test`) is explained as the test, whatever its spelling, and a function `[` as a call:
// what bash runs, which the status of each line shows (`f` is a file, `c` is not; the function returns 3).
describe('a command named [ is explained as what bash runs', () => {
  /** The explanation of the last line of `src`, and all its tokens. */
  const explain = (src: string) => {
    const tree = parser.parse(src)!;
    const e = new Analyzer('en').explainLine(tree, src.split('\n').length - 1, 'bash');
    const all: Token[] = [];
    const walk = (t: Token) => { all.push(t); t.children.forEach(walk); };
    e.items.forEach(walk);
    return { e, all };
  };
  /** The exit status of `src` in bash, and what it wrote to stderr. */
  const bash = (src: string) => {
    const r = run('bash', ['-s'], { cwd: dir, input: src, env: { ...process.env, PATH: '/usr/bin:/bin' } });
    return { status: r.status, stderr: r.stderr.toString() };
  };
  const cases: [src: string, runs: 'test' | 'program' | 'function', status: number][] = [
    ['[ -f f ]', 'test', 0],
    ['\\[ -f f ]', 'test', 0],
    ['"[" -f c ]', 'test', 1],
    ["'[' -f f ]", 'test', 0],
    ['x=1 [ -f f ]', 'test', 0],
    ['command [ -f f ]', 'test', 0],
    ['builtin [ -f c ]', 'test', 1],
    ['env [ -f f ]', 'program', 0],
    ['/usr/bin/[ -f c ]', 'program', 1],
    ['enable -n [\n[ -f f ]', 'program', 0],
    ['time [ -f f ]', 'test', 0],
    ['! [ -f f ]', 'test', 1],
    ['[ -f c ] | cat', 'test', 0],
    ['[() { return 3; }\n[ -f f ]', 'function', 3],
    ['[() { return 3; }\nbuiltin [ -f f ]', 'test', 0],
  ];
  for (const [src, runs, status] of cases) {
    it(JSON.stringify(src), () => {
      assert.strictEqual(bash(src).status, status, 'bash');
      const { all } = explain(src);
      const conditions = all.filter((t) => t.explanation.startsWith('Condition: `'));
      assert.strictEqual(conditions.length, runs === 'function' ? 0 : 1, 'the condition is explained');
      assert.ok(!all.some((t) => t.explanation.includes('see `man `')), 'no manual page without a name');
      if (runs === 'function') assert.ok(all.some((t) => t.kind === 'function' && t.explanation.startsWith('Call the function `[`')), 'the function');
      if (runs === 'program') assert.ok(all.some((t) => /program|external command/.test(t.explanation)), 'the program');
      if (runs !== 'function') assert.ok(all.some((t) => t.label === ']' && t.explanation.startsWith('The last argument passed to `[`')), 'the last `]`');
    });
  }
  // Without its `]`, `[` fails when it runs (status 2): no syntax error, and a note says so.
  for (const [src, status] of [['[ -f f', 2], ['[', 2], ['[ -f f]', 2], ['[ ]', 1], ['[ -f f ]', 0]] as const) {
    it(`${JSON.stringify(src)}: status ${status}`, () => {
      const real = bash(src);
      assert.strictEqual(real.status, status);
      assert.strictEqual(real.stderr.includes("missing `]'"), status === 2);
      assert.deepStrictEqual(parser.parse(src)!.errors, []);
      assert.strictEqual(explain(src).e.facts?.some((f) => f.id === 'bracket-missing-close') ?? false, status === 2);
    });
  }
});
