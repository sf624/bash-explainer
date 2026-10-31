import type { CommandSpec } from './argv/spec';
import type { BashVersion } from './bashversion';
import { literalContent, staticWordValue } from './staticword';
import type { SyntaxNode } from './syntax/tree';

/**
 * How `[ … ]` and `test` read their arguments, as bash's test.c does.
 * The model keeps the arguments of a `[ ]` as flat words, because the unary `-a file` / `-o option` cannot be told from the binary
 * AND / OR without bash's rules; the analyzer takes the words of a `[ ]` and parses them here.
 */

/** A parsed test. Numbers are indexes into the words; `first` / `last` of a node are the words it covers. */
export type TestExpr =
  /**
   * A lone word: true if it is not empty. `truth`: the word bash takes the truth from instead (bash 5.3 reads a group
   * of one word, `( x )`, in a longer test as the first word of the whole test: 0).
   */
  | { type: 'word'; at: number; truth?: number }
  | { type: 'unary'; op: number; arg: number }
  | { type: 'binary'; left: number; op: number; right: number }
  | { type: 'not'; op: number; operand: TestExpr }
  | { type: 'and' | 'or'; op: number; left: TestExpr; right: TestExpr }
  | { type: 'group'; open: number; close: number; inner: TestExpr };

const BINARY = new Set(['=', '==', '!=', '<', '>', '-eq', '-ne', '-lt', '-le', '-gt', '-ge', '-nt', '-ot', '-ef']);
const UNARY = new Set([...'abcdefghknoprstuvwxzGLNORS'].map((c) => `-${c}`));

/**
 * How bash's `<` and `>` compare two strings: by the locale's collation order (`LC_COLLATE`) or by byte values; why
 * (`posix`: bash 5.3's `test` in POSIX mode, `posix-5.2`: bash 5.2's `test`, which compares bytes in POSIX mode too,
 * `compat`: `[[ ]]` at compatibility level 4.0 or lower); `unknown` where a setting that decides it is on some paths only.
 */
export interface Collation { order: 'locale' | 'bytes' | 'unknown'; why?: 'posix' | 'posix-5.2' | 'compat' }

/**
 * The collation of `<` and `>` in `[[ ]]` (`double`) or in bash's `test` and `[`, in release `version`, with POSIX mode
 * `posix` and the `shopt` option that sets level 4.0 or lower (`compat`: `compat31`, `compat32` or `compat40`) where it
 * runs (manual 4.1, 6.4, 6.11, 6.12). `[[ ]]` uses the locale, but bytes at level 4.0 or lower (not in bash 5.3's POSIX
 * mode); `test` uses bytes, and the locale in bash 5.3's POSIX mode. Checked with bash 5.2.21 and 5.3 in en_US.UTF-8
 * (test/testexpr.test.ts).
 */
export function collation(double: boolean, version: BashVersion, posix: 'on' | 'off' | 'unknown', compat: 'on' | 'off' | 'unknown'): Collation {
  const posixLocale = version === '5.2' ? 'off' : posix;
  if (!double) {
    if (posixLocale === 'on') return { order: 'locale', why: 'posix' };
    if (posixLocale === 'unknown') return { order: 'unknown', why: 'posix' };
    return posix === 'off' ? { order: 'bytes' } : { order: 'bytes', why: 'posix-5.2' };
  }
  if (posixLocale === 'on' || compat === 'off') return { order: 'locale' };
  return posixLocale === 'off' && compat === 'on' ? { order: 'bytes', why: 'compat' } : { order: 'unknown', why: 'compat' };
}

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
/** A form this parser does not follow (`-t` without a number in a long test): not an error of bash. */
class Unfollowed extends Error {}

/**
 * Parses the arguments `[` receives (without the closing `]`). A word is its text after quote removal, or null when it
 * depends on the value of an expansion (it is then never an operator). Undefined when bash reports an error, or for a
 * `-t` without a number in a long test, which this parser does not follow.
 */
export function parseTest(w: (string | null)[], rules: TestRules = '5.2'): TestExpr | undefined {
  if (rules === 'both') {
    const [a, b] = [parseTest(w, '5.2'), parseTest(w, '5.3')];
    return JSON.stringify(a) === JSON.stringify(b) ? a : undefined;
  }
  const r = readTest(w, rules === '5.3');
  return typeof r === 'object' ? r : undefined;
}

/**
 * The bash release whose `test` reads the words, or both: what the models say (they do not take the release) holds in
 * each. bash 5.3 reads a group of up to four words inside a longer test by the rules for that many words, as POSIX
 * does for a whole test (docs/design/bash-versions.md, 3.2).
 */
export type TestRules = BashVersion | 'both';

/**
 * Whether bash's `test` surely fails on the words `w` without evaluating them (status 2, with "unary operator
 * expected", "binary operator expected", "too many arguments"…): their number and shape fit no expression of the
 * POSIX rules for one to four arguments, nor of bash's grammar beyond. Only when every word is known: an expansion
 * may give an operator, or no word or several.
 */
export function testFails(w: readonly (string | null)[], rules: TestRules = '5.2'): boolean {
  if (rules === 'both') return testFails(w, '5.2') && testFails(w, '5.3');
  return w.every((x) => x !== null) && readTest(w, rules === '5.3') === 'error';
}

/** `groups53`: a group of up to four words in a longer test is read by its count, as bash 5.3 does (`TestRules`). */
function readTest(w: readonly (string | null)[], groups53 = false): TestExpr | 'error' | 'unfollowed' | undefined {
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
      const counted = groups53 ? byCount(pos) : undefined;
      if (counted) {
        if (!is(pos, ')')) return fail();
        pos++;
        return group(p, counted);
      }
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
      if (p + 1 >= n || !/^\d+$/.test(w[p + 1] ?? '0')) throw new Unfollowed();
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
  /**
   * bash 5.3: the words of a group from `from`, read by their count when the `)` that closes it comes within four
   * words (the first word is not looked at for a parenthesis). One word is true when the first word of the whole test
   * is not empty: bash 5.3 reads that one, not the word in the group.
   */
  const byCount = (from: number): TestExpr | undefined => {
    let count = 1;
    let k = 1;
    for (; from + k < n; k++) {
      if (is(from + k, ')')) count--;
      else if (is(from + k, '(')) count++;
      if (count === 0) break;
    }
    if (from + k >= n || k > 4) return undefined;
    // (`-t` in a long test takes a number or nothing, which is not followed, as in `term`.)
    if (w.slice(from, from + k).includes('-t')) throw new Unfollowed();
    const at = pos;
    switch (k) {
      case 1: pos += 1; return { type: 'word', at, truth: 0 };
      case 2: pos += 2; return two(at);
      case 3: pos += 3; return three(at);
      default:
        if (is(at, '!')) { pos += 4; return not(at, three(at + 1)); }
        if (is(at, '(') && is(at + 3, ')')) { pos += 4; return group(at, two(at + 1)); }
        return or();
    }
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
    if (e instanceof Syntax) return 'error';
    if (e instanceof Unfollowed) return 'unfollowed';
    // Only these are thrown here.
    /* c8 ignore next */
    throw e;
  }
}

/** A word `[` receives: the nodes that make it up (a pattern with a quoted part is several), and its text, null if it depends on an expansion. */
export interface BracketWord { nodes: SyntaxNode[]; text: string | null }
export interface BracketTest { words: BracketWord[]; expr: TestExpr }
export interface TestShape { left?: SyntaxNode; op: string; right: SyntaxNode }

/**
 * Whether the simple command `n` is written `[ … ]`: its name is a plain `[`. A fact of the text only, for the
 * colours, the labels and the style checks; what the name runs is the model's (src/semantics/names.ts, `testSpecOf`).
 */
export function writtenAsBracket(n: SyntaxNode): boolean {
  // (Quoted or escaped, `"["` and `\[`, it is written otherwise.)
  return n.type === 'command' && n.children.find((c) => c.type === 'command_name')?.text === '[';
}

/** The words of a command written `[ … ]` (`writtenAsBracket`) between the brackets, and the last `]` if it has one. */
export function bracketWords(n: SyntaxNode): { words: SyntaxNode[]; close?: SyntaxNode } {
  const args = n.children.filter((c) => c.field === 'argument');
  const last = args[args.length - 1];
  return last?.text === ']' ? { words: args.slice(0, -1), close: last } : { words: args };
}

/**
 * The arguments of a command that runs `test` or `[` (src/semantics/names.ts, `testSpecOf`, decides it), read as bash
 * does: `words` are those of the expression, `close` the last `]` that `[` wants, `unclosed` when it is surely not
 * there (no argument, or a last one whose text is known: bash fails at run time with `[: missing ']'`, status 2).
 * `test` is the expression, undefined when bash would report an error in it (or with a last word not known).
 */
export interface CommandTest {
  words: SyntaxNode[]; close?: SyntaxNode; unclosed: boolean; test?: BracketTest;
  /**
   * The expression is known and bash cannot read it (`test -f c ]`, `[ a b ]`: `testFails`), so `test` fails with
   * status 2 before evaluating anything. Not set when `unclosed`, which bash reports first, nor without `bashRules`.
   */
  malformed: boolean;
}

/**
 * `bashRules`: the words are read by bash's builtin. Other shells differ where POSIX leaves the result unspecified
 * (dash: `[ a -a ]` is 1, `test a -o` is 0, where bash fails with 2), so `malformed` is said only for bash.
 */
export function commandTest(spec: CommandSpec, args: SyntaxNode[], bashRules: TestRules | false): CommandTest {
  const closer = spec.closingOperand;
  const last = args[args.length - 1];
  const value = last && staticWordValue(last);
  const read = (words: SyntaxNode[], unclosed: boolean): CommandTest => {
    const test = testOfWords(words, bashRules || '5.2');
    return { words, unclosed, ...(test ? { test } : {}), malformed: !!bashRules && !unclosed && !test && testFails(words.map(fieldText), bashRules) };
  };
  if (!closer) return read(args, false);
  if (value === closer) return { ...read(args.slice(0, -1), false), close: last };
  // (Without its `]`, the words are still read as the expression they were meant to be, as while it is typed.)
  return read(args, !last || value !== undefined);
}

/**
 * The one field a word of `test` gives, or null when that is not sure: an expansion, and also a word with a glob,
 * a brace or a tilde, which may give other fields or several.
 */
function fieldText(x: SyntaxNode): string | null {
  return /[*?[{~]/.test(x.text) ? null : wordText(x);
}

/** A word of `test` after quote removal (`\(` is `(`), or null when it depends on an expansion. */
function wordText(x: SyntaxNode): string | null {
  if (x.type === 'number') return x.text;
  // (`\(`, `\<`: a backslash quotes the character after it.)
  if (x.type === 'word' && x.text.includes('\\') && /^(?:\\[^\n]|[^\\'"$`])*$/.test(x.text)) return x.text.replace(/\\(.)/g, '$1');
  return literalContent(x)?.text ?? null;
}

/**
 * Whether a `<` or `>` written among the words of a `[ ]` (`words`, before its `]`), before the word at `at`, with
 * the digits glued before it (`fd`: `[ 10>$max ]`), stands where the operator of a comparison would: whether, once it
 * is escaped (`[ "$a" \> "$b" ]`), bash reads the test with it as the operator of a `binary` node, in either release
 * (the style checks do not take one). Its target is a word not known, never an operator. A redirection that stands
 * there is a comparison read as a redirection (`redirect-in-bracket`, src/pitfalls.ts); elsewhere it is plainly meant
 * as one (`[ "$n" -gt 0 2>"$log" ]`, `[ -t 0 < "$tty" ]`).
 */
export function operatorFits(words: readonly SyntaxNode[], at: number, fd: string | undefined): boolean {
  const w = words.map(wordText);
  const op = at + (fd ? 1 : 0);
  w.splice(at, 0, ...(fd ? [fd] : []), '<', null);
  const fits = (e: TestExpr): boolean => {
    switch (e.type) {
      case 'binary': return e.op === op;
      case 'not': return fits(e.operand);
      case 'group': return fits(e.inner);
      case 'and': case 'or': return fits(e.left) || fits(e.right);
      default: return false;
    }
  };
  const e = parseTest(w, 'both');
  return !!e && fits(e);
}

/** The words of a `[ ]` or of the arguments of `test`, read as one expression. */
export function testOfWords(leaves: SyntaxNode[], rules: TestRules = '5.2'): BracketTest | undefined {
  // (Each node is a whole word: an argument of the command.)
  // `\(` and `\)` are the parentheses of a group: after quote removal they are `(` and `)`.
  const words: BracketWord[] = leaves.map((x) => ({ nodes: [x], text: wordText(x) }));
  const expr = parseTest(words.map((w) => w.text), rules);
  return expr && { words, expr };
}

/** The operator and the operands of a `[ ]` that is a single comparison or unary test of one-node words. */
export function bracketShape(b: BracketTest | undefined): TestShape | undefined {
  const e = b?.expr;
  if (e?.type === 'unary' && b!.words[e.arg].nodes.length === 1) return { op: b!.words[e.op].text!, right: b!.words[e.arg].nodes[0] };
  if (e?.type === 'binary' && b!.words[e.left].nodes.length === 1 && b!.words[e.right].nodes.length === 1) {
    return { left: b!.words[e.left].nodes[0], op: b!.words[e.op].text!, right: b!.words[e.right].nodes[0] };
  }
  return undefined;
}
