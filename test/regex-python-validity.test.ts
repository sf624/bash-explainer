import * as assert from 'assert';
import * as path from 'path';
import { readRegex } from '../src/embedded/regex';
import { NO_PYTHON_FLAGS, PYTHON_FLAGS, pythonFlagsRefused, type PythonRegexOptions } from '../src/embedded/regex-python';
import type { EmbeddedToken } from '../src/embedded/types';
import { readSaid } from '../src/messages-tokens';
import { PYTHON_REFERENCE } from '../src/python-reference';
import { needPython, pythonReference } from './support/python';
import { run } from './support/run';

// The validity differential of the flavor `python` of the regex reader (docs/design/python-regex.md, section 7): rows of a pattern and
// its flags, compiled by the reference Python's `re.compile` in one process (test/support/python-re-validity.py, the rows as JSON on its
// stdin). Where Python raises `re.error` (`re.PatternError`), the reader's first Error says the same message, at the same position; where
// it raises `ValueError` (flags that do not go together), the call's flags argument says it (`pythonFlagsRefused`), or the pattern's
// first Error, at the inline flags that make it; where it compiles, the reader says no Error, and the warnings it gives (FutureWarning)
// are the reader's Warnings. The rows are written by hand (one or more of each refusal and warning of Python's parser) and generated
// (patterns of the characters and pieces that Python reads specially, from a fixed seed). `\N{…}` is left out: no table of Unicode
// names is shipped, so its names are not checked (the one listed exception, section 3).

/** A row: a pattern, the flags of the call (short names joined by `|`, '' for none), and whether the pattern is bytes. */
type Row = [pattern: string, flags: string, bytes: boolean];

const str = (p: string, flags = ''): Row => [p, flags, false];

const HAND: Row[] = [
  // Flags that do not go together (`ValueError`), from the argument or the inline flags; after a refusal of the parser, not before.
  str('a', 'L'), ['a', 'U', true], str('a', 'A|U'), ['a', 'A|L', true], str('(?a)(?u)a'), str('(?u)a', 'A'), str('(?a)a', 'U'), ['(?L)a', 'A', true],
  ['(?a)(?L)', '', true], ['(?L)(?a)', '', true], str('(?a)(?#c)(?u)'), str('(?x)(?a) (?u)'), str('(?a)(?u)\\e'), str('(?a)(?u)a)'), str('(?a)(?u)(?<=a|bc)'),
  str('(?<=a|bc)', 'L'), str('(?u:x)', 'A'), str('(?a:x)', 'U'), str('(?a)(?a)'), ['(?a)a', 'L', true], str('a)', 'L'), str('(a', 'L'),
  // Nothing to repeat, and a repeat after another.
  str('*'), str('a**'), str('(*FAIL)'), str('a|*'), str('a{2}{3}'),
  // Ranges of a set: a class at an end, an end below the start; the token of an escape in the message.
  str('[z-a]'), str('[\\w-z]'), str('[a-\\w]'), str('[a-\\d]'), str('[\\d-z]'), str('[\\x41-\\w]'), str('[\\x41-\\x40]'), str('[A-\\x20]'), str('[a-]'), str('[\\d-]'),
  str('[a-'), str('[\\x41-'), str('[a-\\x7a]'), str('[\\x41&&b]'), str('[a\\'), str('[a-z]'), str('[\\x00-\\x7f]'), str('[--a]'), str('[a---]'),
  // Warnings of a set: a nested set (a POSIX class written as in grep), and the doubled operators of a set.
  str('(?x)(? :a)'), str('[[:alpha:]]'), str('[[:digit:]]+'), str('[^[:space:]]'), str('[[:alpha:]-z]'), str('[[a]'), str('[^[a]'), str('[[]'), str('[a&&b]'), str('[a||b]'), str('[a~~b]'),
  str('[a--b]'), str('[a&&]'), str('[&&a]'), str('[a&&&]'), str('[]a]'), str('[[]]'),
  // Group names: a name defined twice, a name that is no identifier, in bytes one past ASCII; what ends a name.
  str('(?P<n>a)(?P<n>b)'), str('(?P<1a>x)'), str('(?P<1>x)'), str('(?P<a-b>a)'), str('(?P<é>a)'), ['(?P<é>a)', '', true], str('(?P<n'), str('(?P<>a)'), str('(?P<'),
  str('(?P<a\\>b>x)'), str('(?x)(?P< n>a)'), str('(?P<n>a)(?P<m>b)(?P<n>c)'),
  // Unknown extensions, and the ends of a group's head.
  str('(?'), str('(?P'), str('(?)'), str('(?P>n)'), str('(?&n)'), str('(?C)'), str('(?^)'), str('(?<n>a)'), str('(?|a)'), str('(?R)'), str('(?1)'), str('(?\\e)'),
  str('(?<'), str('(?<a'), str('(? :a)', 'X'), str('(?é)'), str('(?i'), str('(?#abc'), str('(?#a\\)b)'), str('(?#a\\'), str('(?#c)a'),
  // References by name.
  str('(?P=n)'), str('(?P<n>a)(?P=m)'), str('(?P<n>a(?P=n))'), str('(?<=(?P<n>a)(?P=n))'), str('(?P=1)'), str('(?P=)'), str('(?P=n'), str('(?P<n>a)(?P=n'),
  str("(?P<q>['\"]).*?(?P=q)"), str('(?P<n>a)(?P=n)+'), str('(?P<n>a)(?<=(?P=n))'), str('(?P<n>a+)(?<=(?P=n))'),
  // Conditionals: by number (a later group may be it) and by name; their branches; in a lookbehind.
  str('(?(1)a|b)'), str('(?(1)a|b|c)'), str('(a)(?(1)b|c|d)'), str('(?(2)a)(a)'), str('(a)(?(2)a)'), str('(?(1)a)(a)'), str('(?(x)a)'), str('(?(1a)a)'),
  str('(?(<n>)a)'), str("(?('n')a)"), str('(?(R)a)'), str('(?(DEFINE)a)'), str('(?(?=a)a|b)'), str('(?(0)a)'), str('(a)(?(1)b'), str('(a)(?(1'), str('(a)(?(1)'),
  str('(a)(?<=(?(1)b|cd))'), str('(a)(?<=(?(1)b|c))'), str('(a)(?<=(?(1)bc))'), str('(?<=(a)(?(1)b|c))'), str('(a)(?(01)b)'), str('(a)(?(+1)b)'), str('(a)(?(١)b)'),
  str('(a)(?(99999999999)b)'), str('(a)(?(1073741823)b)'), str('(?P<é>a)(?(é)b)'), str('(?P<n>a)(?(n)b|c)'), str('(a)?(?(1)b|c)'), str('(a(?(1)b))'),
  str('(a)(?(1)b|c)*'), str('(a)(?(1)b|c)+?'), str('(?(1)a|(?i)b)'), str('(a)(?(1)(?P<x>b)|c)(?P=x)'), str('(?(()a)'), str('(?(1)a)\\e(a)'),
  // What a release still supported reads otherwise (`\z`, 3.14), and an escape of a symbol in a set.
  str('\\z'), str('a\\Z'), str('[\\<]'), str('[\\-]'),
  // Positions count characters, as Python's do: one past U+FFFF is one; and a pattern over lines gives the line and column.
  str('😀\\e'), str('[😀-a]'), str('a\n😀(?P<n'), str('(a\n)\n)'), str('[a- z]', 'X'),
];

/** A generator of numbers in [0, 1), from a seed (mulberry32): the same rows on every run. */
function random(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The pieces of the generated patterns: characters Python reads specially, and the heads of its groups and escapes. */
const PIECES = [
  'a', 'b', 'é', '1', '2', '0', '(', ')', '[', ']', '{', '}', ',', '*', '+', '?', '|', '^', '$', '.', '\\', '-', ':', '=', '!', '<', '>', '#', "'", ' ', '\n',
  'P', 'i', 'x', 'u', 'L', 'd', 'w', 'z', 'e', 'n', '(?', '(?P<n>', '(?P=n)', '(?P<', '(?P=', '(?(1)', '(?(n)', '(?(', '(?:', '(?=', '(?!', '(?<=', '(?<!',
  '(?>', '(?#', '(?i)', '(?a)', '(?u)', '(?x)', '(?i:', '(?-i:', '[^', '[[', '[:', ':]', '&&', '--', '\\1', '\\2', '\\d', '\\w', '\\b', '\\x4', '\\x41',
  '\\0', '\\12', '\\A', '\\Z', '{1,2}', '{2,1}', '{,2}', '{1,}', '*?', '++',
];
const FLAGS = ['', '', '', 'X', 'I', 'A', 'U', 'L', 'A|U', 'M|S'];

/** `count` patterns of 1 to 6 pieces, each with flags, and a bytes pattern for one in eight (none with `é`, which bytes has not here). */
function generated(count: number): Row[] {
  const next = random(760);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)];
  const rows: Row[] = [];
  const seen = new Set<string>();
  while (rows.length < count) {
    const n = 1 + Math.floor(next() * 6);
    let p = '';
    for (let k = 0; k < n; k++) p += pick(PIECES);
    const bytes = next() < 0.125 && !p.includes('é');
    const row: Row = [p, pick(FLAGS), bytes];
    const key = JSON.stringify(row);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(row);
  }
  return rows;
}

const GENERATED = generated(10000);

/** The options of a row's flags (`re.compile(pattern, flags)`), and their value. */
function flagsOf(flags: string, bytes: boolean): { python: PythonRegexOptions; value: number } {
  const set = flags ? flags.split('|').map((f) => PYTHON_FLAGS.find((x) => 'short' in x && x.short === f)!) : [];
  const python: PythonRegexOptions = { ...NO_PYTHON_FLAGS, bytes };
  for (const f of set) if ('option' in f) python[f.option] = true;
  return { python, value: set.reduce((v, f) => v | f.value, 0) };
}

interface Result { kind: 'PatternError' | 'ValueError' | null; message: string | null; warnings: string[] }

/** What the reader says of a row: the messages of its Errors in the order of its tokens, the flags argument's, and its warnings. */
function ours([pattern, flags, bytes]: Row): { errors: string[]; argument?: string; warnings: string[] } {
  const { python } = flagsOf(flags, bytes);
  const errors: string[] = [];
  const warnings: string[] = [];
  // (A token's own refusal after those of its contents: Python reads a group's contents before it finds no `)` closes it.)
  const walk = (t: EmbeddedToken) => {
    t.children.forEach(walk);
    for (const s of readSaid(t.explanation).said) {
      if (t.kind === 'error' && (s.id === 'regex-python-error' || s.id === 'regex-python-flags-error')) errors.push(/\("(.*)"(?:; [^"]*)?\)$/s.exec(s.text)![1]);
      if (s.id === 'regex-python-set-warning') for (const m of s.text.matchAll(/"(Possible [^"]*)"/g)) warnings.push(m[1]);
    }
  };
  readRegex(pattern, 'python', 'en', { tool: 'python', python }).tokens.forEach(walk);
  const argument = pythonFlagsRefused(python)?.message;
  return { errors, ...(argument ? { argument } : {}), warnings };
}

/** Whether a pattern ends with a `\` that escapes nothing. */
function finalBackslash(pattern: string): boolean {
  let k = 0;
  while (k < pattern.length - 1) k += pattern[k] === '\\' ? 2 : 1;
  return k === pattern.length - 1 && pattern[k] === '\\';
}

/**
 * Whether the reader says what Python does of a row. Python's tokenizer reads a token ahead, so a final `\` is refused when the token
 * before it is taken: before that token's own refusal, or after, by where in reading it Python raises that. There the reader is to say
 * both, in either order.
 */
function agrees(row: Row, theirs: Result): boolean {
  const { errors, argument, warnings } = ours(row);
  if (theirs.kind === null) return !errors.length && !argument && JSON.stringify(warnings) === JSON.stringify(theirs.warnings);
  if (theirs.kind === 'ValueError' && argument === theirs.message) return true;
  if (finalBackslash(row[0]) && errors.some((e) => e.startsWith('bad escape (end of pattern)'))) return errors.slice(0, 2).includes(theirs.message!);
  return errors[0] === theirs.message;
}

describe('the Python flavor of the regex reader: the validity differential against the reference Python', function () {
  this.timeout(120000);
  const ref = pythonReference();
  let got: Result[];
  const rows = [...HAND, ...GENERATED];
  before(function () {
    needPython(this, ref);
    const request = JSON.stringify({ rows: rows.map(([p, flags, bytes]) => [p, flagsOf(flags, bytes).value, bytes]) });
    const r = run((ref as { python: string }).python, ['-I', path.join(__dirname, 'support', 'python-re-validity.py')], { input: request, timeout: 100000, maxBuffer: 1 << 26 });
    assert.strictEqual(r.status, 0, r.stderr.toString());
    const out = JSON.parse(r.stdout.toString()) as { version: string; rows: Result[] };
    assert.strictEqual(out.version, PYTHON_REFERENCE);
    got = out.rows;
  });

  const parted = (from: number, to: number): string[] => rows.slice(from, to).flatMap((row, k) => {
    const theirs = got[from + k];
    if (agrees(row, theirs)) return [];
    return [`${JSON.stringify(row)}: Python ${JSON.stringify(theirs)}, ours ${JSON.stringify(ours(row))}`];
  });

  it('says each refusal and warning of the hand-written rows as Python does', () => {
    assert.deepStrictEqual(parted(0, HAND.length), []);
    // (The rows have each kind: compiled, refused by the parser, refused for the flags, and warned of.)
    const theirs = got.slice(0, HAND.length);
    assert.ok(['PatternError', 'ValueError', null].every((k) => theirs.some((r) => r.kind === k)) && theirs.some((r) => r.warnings.length));
  });

  it(`says what Python does of ${GENERATED.length} generated rows`, () => {
    assert.deepStrictEqual(parted(HAND.length, rows.length), []);
    // (The generated rows hold each kind too.)
    const theirs = got.slice(HAND.length);
    assert.ok(['PatternError', 'ValueError', null].every((k) => theirs.some((r) => r.kind === k)) && theirs.some((r) => r.warnings.length));
  });
});

describe('the Python flavor of the regex reader: its refusals and warnings, without the reference', () => {
  // (What the differential above holds against Python, pinned here, so that the reader is tested wherever the reference is missing.)
  it('reads every row of the differential', () => {
    const said = [...HAND, ...GENERATED].map(ours);
    assert.ok(said.some((o) => o.errors.length) && said.some((o) => o.argument) && said.some((o) => o.warnings.length));
  });

  it('says Python\'s message of each kind of refusal: the flags, ranges, group names and heads, references and conditionals', () => {
    const first = (row: Row) => ours(row).argument ?? ours(row).errors[0];
    const rows: [Row, string][] = [
      [str('a', 'L'), 'cannot use LOCALE flag with a str pattern'], [['a', 'U', true], 'cannot use UNICODE flag with a bytes pattern'],
      [str('a', 'A|U'), 'ASCII and UNICODE flags are incompatible'], [['a', 'A|L', true], 'ASCII and LOCALE flags are incompatible'],
      [str('(?a)(?u)a'), 'ASCII and UNICODE flags are incompatible'], [str('[z-a]'), 'bad character range z-a at position 1'],
      [str('[\\x41-\\w]'), 'bad character range \\x-\\w at position 3'], [str('(?P<n>a)(?P<n>b)'), "redefinition of group name 'n' as group 2; was group 1 at position 12"],
      [str('(?P<1a>x)'), "bad character in group name '1a' at position 4"], [['(?P<é>a)', '', true], "bad character in group name '\\xe9' at position 4"],
      [str('(?P<n'), 'missing >, unterminated name at position 4'], [str('(?P'), 'unexpected end of pattern at position 3'],
      [str('(?<n>a)'), 'unknown extension ?<n at position 1'], [str('(?#abc'), 'missing ), unterminated comment at position 0'],
      [str('(?P=n)'), "unknown group name 'n' at position 4"], [str('(?P<n>a(?P=n))'), 'cannot refer to an open group at position 11'],
      [str('(?<=(?P<n>a)(?P=n))'), 'cannot refer to group defined in the same lookbehind subpattern at position 18'],
      [str('(?(1)a|b|c)'), 'conditional backref with more than two branches at position 8'], [str('(?(2)a)(a)'), 'invalid group reference 2 at position 3'],
      [str('(?(0)a)'), 'bad group number at position 3'], [str('(a)(?<=(?(1)b|cd))'), 'look-behind requires fixed-width pattern'],
      [str('(?<=(a)(?(1)b|c))'), 'cannot refer to group defined in the same lookbehind subpattern at position 12'],
      [str('(a)(?(99999999999)b)'), 'invalid group reference 99999999999 at position 6'],
    ];
    assert.deepStrictEqual(rows.map(([row]) => first(row)), rows.map(([, message]) => message));
    for (const p of ["(?P<q>['\"]).*?(?P=q)", '(a)?(?(1)b|c)', '(?(1)a)(a)', '(?P<é>a)(?(é)b)', '\\z', '[\\<]']) assert.deepStrictEqual(ours(str(p)).errors, [], p);
  });

  it('warns of a set Python warns of, with its message: a POSIX class as grep writes it, and the doubled operators of a set', () => {
    assert.deepStrictEqual(ours(str('[[:alpha:]]')).warnings, ['Possible nested set at position 1']);
    assert.deepStrictEqual(ours(str('[a&&&]')).warnings, ['Possible set intersection at position 2', 'Possible set intersection at position 3']);
    const [set, close] = readRegex('[[:alpha:]]', 'python', 'en', { tool: 'python', python: NO_PYTHON_FLAGS }).tokens;
    assert.deepStrictEqual([set.end, close.start, readSaid(set.explanation).said.find((s) => s.id === 'regex-python-set-warning')?.level], [10, 10, 'warning']);
    assert.match(readSaid(set.explanation).text, /no POSIX classes: it reads `\[\[:alpha:\]` as a set of its characters .*: `\[\[:alpha:\]\]` matches two characters such as `a\]`, not `a`/);
    assert.match(readSaid(readRegex('[[:digit:]]', 'python', 'ja', { tool: 'python', python: NO_PYTHON_FLAGS }).tokens[0].explanation).text, /POSIX の文字クラスがない/);
  });

  it('leaves a group unread where a field of an f-string decides what its head is', () => {
    const hole = '﷒';
    for (const p of [`(?${hole})`, `(?P<${hole}>a)`, `(?P=${hole})`, `(?P${hole}`, `(?<${hole}a)`, `(?(${hole})a)`]) {
      const [t] = readRegex(p, 'python', 'en', { tool: 'python', python: NO_PYTHON_FLAGS }).tokens;
      assert.deepStrictEqual([t.kind, t.explanation, t.start], ['error', '', 0], p);
    }
  });
});
