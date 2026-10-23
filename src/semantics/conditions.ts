// Deciding conditions (docs/design/semantics.md, 4.14): what bash's `test` builtin gives for words whose values are
// known, and whether a pattern of `case` or `[[ == ]]` matches a known word. The walk of the shell state
// (src/semantics/walk/conditions.ts) reads the words and calls these; anything not known here is `undefined`.
import { globToRegex, hasExtglob } from '../examples/shellwords';
import { parseTest, type TestExpr } from '../testexpr';

/** What a decision needs from the shell state: whether `set -o name` is on (undefined: not known). */
export interface TestEnv {
  option(name: string): boolean | undefined;
}

class Unknown extends Error {}
class Failure extends Error {}

/**
 * A decimal integer as `test` reads one (bash's `legal_number`): blanks before it (any space character) and after it
 * (spaces and tabs), a sign, digits. Undefined for a word that is not one; `null` for one past 64 bits, which this does
 * not follow.
 */
export function testInteger(word: string): bigint | null | undefined {
  const m = /^[ \t\n\v\f\r]*([+-]?\d+)[ \t]*$/.exec(word);
  if (!m) return undefined;
  const v = BigInt(m[1]);
  return v > 0x7fffffffffffffffn || v < -0x8000000000000000n ? null : v;
}

/** The comparison of two integers by the operator `op` (`-eq`, `-lt`…). */
export function compareIntegers(op: string, a: bigint, b: bigint): boolean {
  switch (op) {
    case '-eq': return a === b;
    case '-ne': return a !== b;
    case '-lt': return a < b;
    case '-le': return a <= b;
    case '-gt': return a > b;
    default: return a >= b;
  }
}

const INTEGER_OPS = new Set(['-eq', '-ne', '-lt', '-le', '-gt', '-ge']);

/** A unary test (`-n`, `-z`, `-o`) of `test` or `[[ ]]`; undefined for the others (files, a terminal, variables) or an option not known. */
export function unaryTest(op: string, arg: string, env: TestEnv): boolean | undefined {
  try {
    return unary(op, arg, env);
  } catch (err) {
    /* c8 ignore next -- `unary` throws `Unknown` only */
    if (!(err instanceof Unknown)) throw err;
    return undefined;
  }
}

/** `-n`, `-z` and `-o`: the unary operators decided here (the others read files, a terminal or variables). */
function unary(op: string, arg: string, env: TestEnv): boolean {
  if (op === '-n') return arg !== '';
  if (op === '-z') return arg === '';
  if (op === '-o') {
    const on = env.option(arg);
    if (on === undefined) throw new Unknown();
    return on;
  }
  throw new Unknown();
}

/**
 * The exit status of bash's `test` (and of `[`, without its `]`) with the arguments `args`: 0 (true), 1 (false), 2 (an
 * error); undefined when it depends on what is not known here (files, a terminal, options the state does not know).
 */
export function testStatus(args: readonly string[], env: TestEnv): number | undefined {
  if (!args.length) return 1;
  const e = parseTest([...args]);
  // (`parseTest` does not follow `-t` in a long test; anything else it rejects is bash's syntax error.)
  if (!e) return args.includes('-t') ? undefined : 2;
  try {
    return evaluate(e, args, env) ? 0 : 1;
  } catch (err) {
    if (err instanceof Failure) return 2;
    /* c8 ignore next -- only these two are thrown on purpose */
    if (!(err instanceof Unknown)) throw err;
    return undefined;
  }
}

/** Evaluates a parsed test as bash does: both sides of `-a` and `-o` (an error in either is the test's error). */
function evaluate(e: TestExpr, w: readonly string[], env: TestEnv): boolean {
  switch (e.type) {
    case 'word': return w[e.at] !== '';
    case 'unary': return unary(w[e.op], w[e.arg], env);
    case 'not': return !evaluate(e.operand, w, env);
    case 'group': return evaluate(e.inner, w, env);
    case 'and': case 'or': {
      // (Both sides are read, as test.c does; a side not known leaves the result known when the other decides it.)
      const side = (x: TestExpr): boolean | undefined => {
        try {
          return evaluate(x, w, env);
        } catch (err) {
          if (err instanceof Unknown) return undefined;
          throw err;
        }
      };
      const l = side(e.left);
      const r = side(e.right);
      const decides = e.type === 'or';
      if (l === decides || r === decides) return decides;
      if (l === undefined || r === undefined) throw new Unknown();
      return !decides;
    }
    case 'binary': {
      const a = w[e.left];
      const op = w[e.op];
      const b = w[e.right];
      if (op === '=' || op === '==') return a === b;
      if (op === '!=') return a !== b;
      // (`<` and `>` follow the locale in POSIX mode, which POSIXLY_CORRECT from the environment turns on: not decided.)
      if (op === '<' || op === '>') throw new Unknown();
      if (INTEGER_OPS.has(op)) {
        const x = testInteger(a);
        const y = testInteger(b);
        if (x === undefined || y === undefined) throw new Failure();
        if (x === null || y === null) throw new Unknown();
        return compareIntegers(op, x, y);
      }
      // -nt, -ot, -ef: files.
      throw new Unknown();
    }
  }
}

/**
 * Whether `subject` matches the pattern (bash's pattern matching, 3.5.8.1, as in `case` and `[[ == ]]`); undefined
 * when it is not followed here: text that is not ASCII, an extended glob.
 */
export function patternMatches(subject: string, pattern: string): boolean | undefined {
  if (/[^\x00-\x7f]/.test(subject + pattern) || hasExtglob(pattern)) return undefined;
  const re = globToRegex(pattern, 'value');
  /* c8 ignore next -- an ASCII glob always makes a regular expression */
  if (!re) return undefined;
  return re.test(subject);
}

/**
 * A regex of `[[ =~ ]]` (its quoted characters escaped with a backslash: src/semantics/words.ts `wordIn`) that matches
 * plain text, when it is one: letters, digits, ` _,:/-` and characters escaped (a backslash before a letter or a digit
 * is an operator: `\w`, `\1`), maybe anchored at the start (`^`) and at the end (`$`).
 */
export function plainRegex(re: string | undefined): { start: boolean; text: string; end: boolean } | undefined {
  const m = re === undefined ? null : /^(\^?)((?:[A-Za-z0-9_ ,:/-]|\\[^A-Za-z0-9])*)(\$?)$/.exec(re);
  return m ? { start: m[1] !== '', text: m[2].replace(/\\([^])/g, '$1'), end: m[3] !== '' } : undefined;
}
