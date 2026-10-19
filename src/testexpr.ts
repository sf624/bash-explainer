/**
 * How `[ … ]` and `test` read their arguments, as bash's test.c does.
 * The model keeps the arguments of a `[ ]` as flat words, because the unary `-a file` / `-o option` cannot be told from the binary
 * AND / OR without bash's rules; the analyzer takes the words of a `[ ]` and parses them here.
 */

/** A parsed test. Numbers are indexes into the words; `first` / `last` of a node are the words it covers. */
export type TestExpr =
  /** A lone word: true if it is not empty. */
  | { type: 'word'; at: number }
  | { type: 'unary'; op: number; arg: number }
  | { type: 'binary'; left: number; op: number; right: number }
  | { type: 'not'; op: number; operand: TestExpr }
  | { type: 'and' | 'or'; op: number; left: TestExpr; right: TestExpr }
  | { type: 'group'; open: number; close: number; inner: TestExpr };

const BINARY = new Set(['=', '==', '!=', '<', '>', '-eq', '-ne', '-lt', '-le', '-gt', '-ge', '-nt', '-ot', '-ef']);
const UNARY = new Set([...'abcdefghknoprstuvwxzGLNORS'].map((c) => `-${c}`));

/** The first and last word a test covers. */
export function testRange(e: TestExpr): [number, number] {
  switch (e.type) {
    case 'word': return [e.at, e.at];
    case 'unary': return [e.op, e.arg];
    case 'binary': return [e.left, e.right];
    case 'not': return [e.op, testRange(e.operand)[1]];
    case 'group': return [e.open, e.close];
    default: return [testRange(e.left)[0], testRange(e.right)[1]];
  }
}

class Syntax extends Error {}

/**
 * Parses the arguments `[` receives (without the closing `]`). A word is its text after quote removal, or null when it
 * depends on the value of an expansion (it is then never an operator). Undefined when bash reports an error, or for a
 * `-t` without a number in a long test, which this parser does not follow.
 */
export function parseTest(w: (string | null)[]): TestExpr | undefined {
  const n = w.length;
  let pos = 0;
  const is = (i: number, s: string) => w[i] === s;
  const binop = (i: number) => BINARY.has(w[i] ?? '');
  const fail = (): never => { throw new Syntax(); };
  const word = (at: number): TestExpr => ({ type: 'word', at });
  const unary = (op: number): TestExpr => ({ type: 'unary', op, arg: op + 1 });
  const binary = (left: number): TestExpr => ({ type: 'binary', left, op: left + 1, right: left + 2 });
  const not = (op: number, operand: TestExpr): TestExpr => ({ type: 'not', op, operand });
  const group = (open: number, inner: TestExpr): TestExpr => ({ type: 'group', open, close: testRange(inner)[1] + 1, inner });

  const two = (p: number): TestExpr => {
    if (is(p, '!')) return not(p, word(p + 1));
    return UNARY.has(w[p] ?? '') ? unary(p) : fail();
  };
  const three = (p: number): TestExpr => {
    if (binop(p + 1)) return binary(p);
    if (is(p + 1, '-a') || is(p + 1, '-o')) return { type: is(p + 1, '-a') ? 'and' : 'or', op: p + 1, left: word(p), right: word(p + 2) };
    if (is(p, '!')) return not(p, two(p + 1));
    if (is(p, '(') && is(p + 2, ')')) return group(p, word(p + 1));
    return fail();
  };

  // The general form, for more than four words.
  const or = (): TestExpr => {
    const left = and();
    if (!is(pos, '-o')) return left;
    const op = pos++;
    return { type: 'or', op, left, right: or() };
  };
  const and = (): TestExpr => {
    const left = term();
    if (!is(pos, '-a')) return left;
    const op = pos++;
    return { type: 'and', op, left, right: and() };
  };
  const term = (): TestExpr => {
    if (pos >= n) return fail();
    const p = pos;
    if (is(p, '!')) {
      pos++;
      return not(p, term());
    }
    if (is(p, '(')) {
      pos++;
      const inner = or();
      if (!is(pos, ')')) return fail();
      pos++;
      return group(p, inner);
    }
    if (p + 3 <= n && binop(p + 1)) {
      pos += 3;
      return binary(p);
    }
    // `-t` takes a file descriptor only if a number follows; this is not followed.
    if (is(p, '-t')) {
      if (p + 1 >= n || !/^\d+$/.test(w[p + 1] ?? '0')) return fail();
      pos += 2;
      return unary(p);
    }
    // A unary operator takes the next word; as the last word, or when it is not one (`-q`), it is a word.
    if (p + 1 < n && UNARY.has(w[p] ?? '')) {
      pos += 2;
      return unary(p);
    }
    pos++;
    return word(p);
  };
  const general = (): TestExpr => {
    pos = 0;
    const e = or();
    return pos === n ? e : fail();
  };

  try {
    switch (n) {
      case 0: return undefined;
      case 1: return word(0);
      case 2: return two(0);
      case 3: return three(0);
      case 4:
        if (is(0, '!')) return not(0, three(1));
        if (is(0, '(') && is(3, ')')) return group(0, two(1));
        return general();
      default: return general();
    }
  } catch (e) {
    if (e instanceof Syntax) return undefined;
    // Only Syntax is thrown here.
    /* c8 ignore next */
    throw e;
  }
}
