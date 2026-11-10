import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { explainRegex, readRegex } from '../src/embedded/regex';
import { readTemplate } from '../src/embedded/regex-template';
import { NO_PYTHON_FLAGS, PYTHON_FLAGS, type PythonRegexOptions } from '../src/embedded/regex-python';
import type { EmbeddedToken } from '../src/embedded/types';
import { PYTHON_REFERENCE } from '../src/python-reference';
import { readSaid } from '../src/messages-tokens';
import { needPython, pythonReference } from './support/python';

// The patterns the regex reader's flavor `python` refuses (docs/design/python-regex.md, section 3), against the reference
// Python's `re.compile`, in one process (test/support/python-re.py): each row has Python's message, or none, and so does the
// reader. The rows are those this flavor reads: the escapes, references to groups, what is left open, and lookbehinds of more
// than one width (its compiler's refusal, which has no position); `FLAGGED` has the rows of the flags (#749). The validity
// differential over every refusal and warning, with generated rows, is test/regex-python-validity.test.ts (#760).

const VALID = [
  '^\\d+(?P<frac>\\.\\d+)?$', '\\Z', '\\z', '\\A\\b\\B', '[\\b]', '\\v[\\v]', '\\0', '\\012', '\\141', '[\\101]', '[\\0]', '(a)\\1', '(a)(b)\\2', '\\x41',
  '\\u00e9', '\\U0001F600', '\\N{EM DASH}', '[\\N{EM DASH}]', '[\\x41-\\x5a]', '[\\u0041-\\u005a]', '\\-\\_\\%\\é', '(?i)a', '(?s).', '(?>a)', 'a++', 'a{,2}',
  '(?#c)a', '[[:alpha:]]', '\\\\', '(?P<n>a)', '[\\d\\s\\w]', '\\w+@\\w+\\.\\w+', '[^\\]]', '(a)(b)(c)(d)(e)(f)(g)(h)(i)(j)\\10', '\\01a',
  '(?P<n>a)(?P=n)', '(a)?(?(1)b|c)', '.', '\\w\\W\\d\\D\\s\\S', 'a*?', 'a*+', 'a{2}?', '(?:)*', '(?=a)*', '(?<=a)+', 'a(?#c)*', '[a]*', '(a)+', 'a{3,3}',
  'a{2,}', 'a{,}', 'a{2,1', '\\*.txt', '[*].txt', 'a|b*', '(?i)a*',
  // (Lookbehinds of one width: alternatives of the same, a reference to a group of one, what matches no character.)
  '(?<=a|b)x', '(?<![ab]|\\d)x', '(a)(?<=\\1)b', '(?P<n>a)(?<=(?P=n))b', '(?<=(?:)*a)', '(?<=a{0})b', '(?<=\\b)a', '(?<=a(?=bc*))x', '(?<=(?i:ab|cd))x',
  '(?<=a{2}(?<!b))x', '(?<=(a)(b))\\2', '(a)(?<=(?(1)b|c))x', '(?<=a{2}?)x', '(?<=(?#c)a)x',
];

const REFUSED = [
  '\\e', '[\\e]', '\\h', '\\G', '\\K', '\\Q', '\\E', '\\L', '\\R', '\\X', '\\c', '\\p{L}', '\\o{1}', '\\g<1>', '\\k<n>', '[\\Z]', '[\\A]', '[\\B]',
  '\\x{41}', '\\x4', '\\u00e', '\\U0010FFF', '\\U00110000', '[\\x4]', '\\N', '\\N{', '\\N{}', '\\N{abc', '[\\N]', '\\777', '[\\777]', '[\\8]', '\\8',
  '\\2', '(a)\\3', '(a\\1)', '((a)\\1)', '(a)(b\\2)', '[a', '(a', 'a\\', '[a\\', 'a(b[c]', '(?P<n>a',
  // (Lookbehinds whose contents may match more characters or fewer, also inside a group or another lookbehind, or by a reference;
  // a reference in one to a group opened in it; another refusal first, as the parser's come before the compiler's.)
  '(?<=^|\\s)\\w+', '(?<=\\$|USD)\\d+', '(?<=a|bc)x', '(?<!a|bc)', '(?<=a+)', '(?<=\\w*)', '(?<=a{1,2})', '(?<=a?)', '(?<=(a|bc))', '(?<=a{2,})',
  '(a+)(?<=\\1)b', '(?P<n>a+)(?<=(?P=n))', '(?<=a(?<=b|cd))x', '(?<=x(?i:a|bc))', '(?<=(?:a|bc)(?=x))', '(?<=(a)\\1)', '(?<=(a)(?<=\\1))', '(?<=a|bc)\\e', '(?<=a|bc', '(?<=a|\\e)', '(?<=a{,2})', '(?<=a+?)',
  // (A glob taken for a regex, and other quantifiers with nothing to repeat or after another; a `)` that closes nothing.)
  '*.txt', '*', '+a', '?', 'a|*', '(*a)', '(|+)', '^*', '$*', '\\b*', '\\A+', '\\Z?', '(?i)*', '(?#c)*', 'a**', 'a*?*', 'a++*', 'a{2}*', 'a{1,2}{3}',
  '[a]**', '(a)??+', 'x{2,1}', 'ab{3,2}', 'x{3,2}+', '{2,1}', 'a)', '(a))b', 'a|)', ')',
];

/**
 * Rows with flags (#749): a pattern, the flags of the call (short names joined by `|`, '' for none), and whether it is a bytes
 * pattern: VERBOSE, inline flags at the start and in a group, global flags not at the start, `(?L)` in a str pattern, and the
 * escapes a bytes pattern lacks. Each is valid or refused, as the reference says (`FLAGGED_VALID`, `FLAGGED_REFUSED`); the flags
 * argument raises no `ValueError` here (#760 has those).
 */
type Flagged = [pattern: string, flags: string, bytes: boolean];
const FLAGGED_VALID: Flagged[] = [
  // VERBOSE: whitespace and comments are no items; `{1, 3}` is no count.
  ['a b', 'X', false], ['a *', 'X', false], ['a {2}', 'X', false], ['a{1, 3}', 'X', false], ['[ a]#', 'X', false], ['a\\ b', 'X', false], ['a#c\nb', 'X', false],
  ['a # c\n*', 'X', false], ['\\#a', 'X', false], ['(?-x: a)', 'X', false], ['a\t\n\x0b\x0c\rb', 'X', false], ['a ', 'X', false],
  // Inline flags: at the start, after comments, whitespace in VERBOSE and other global flags; in a group.
  ['(?i)a', '', false], ['(?i)(?m)a', '', false], ['(?#c)(?i)a', '', false], ['(?i)|a', '', false], ['(?ii)a', '', false], ['(?x)(?i)a', '', false],
  ['(?x) # c\n (?i)a', '', false], ['  (?i)a', 'X', false], ['(?a)\\w', '', false], ['(?i:a)', '', false], ['(?-i:a)', 'I', false], ['(?a:x)', '', false],
  ['(?u:x)', '', false], ['(?x:a b)', '', false], ['(?i-m:a)', 'M', false], ['(?imsx)a', '', false], ['(?s:.)', '', false],
  // `L` only in a bytes pattern; a bytes pattern's own escapes.
  ['(?L)a', '', true], ['(?L:a)', '', true], ['\\x41\\w+\\d', '', true], ['(?a)\\w', '', true], ['\\u0041', 'I', false],
  // A lookbehind whose whitespace VERBOSE skips.
  ['(?<=a | b)x', 'X', false], ['(?x)(?<= a|b )x', '', false],
];
const FLAGGED_REFUSED: Flagged[] = [
  // VERBOSE: a lazy `?` after whitespace repeats again; whitespace and comments are no item to repeat.
  ['a* ?', 'X', false], ['a+ +', 'X', false], ['*\na', '', false], ['  *', 'X', false], ['#c\n*', 'X', false], ['(?x) *', '', false], ['(?x:a * ?)', '', false],
  // Global flags not at the start, and the inline flags `_parse_flags` refuses.
  ['a(?i)b', '', false], ['(?i)a(?m)b', '', false], ['a|(?i)b', '', false], ['((?i)a)', '', false], ['(?i) (?x)a', '', false], ['(?x)a(?i)b', '', false],
  ['a b(?i)', 'X', false], ['(?au)a', '', false], ['(?-a:a)', '', false], ['(?-u:a)', '', false], ['(?-L:a)', '', false], ['(?i-i:a)', '', false],
  ['(?i-)a', '', false], ['(?-)a', '', false], ['(?i', '', false], ['(?i-', '', false], ['(?-i', '', false], ['(?i-m)', '', false], ['(?iz)a', '', false],
  ['(?i!)a', '', false], ['(?-i)a', '', false], ['(?-iz:a)', '', false], ['(?-i!:a)', '', false], ['(?i-m-s:a)', '', false], ['(?-!)a', '', false], ['(?-é)a', '', false],
  // `L` only in a bytes pattern, `u` only in a str one.
  ['(?L)a', '', false], ['(?aL)a', '', false], ['a(?L:b)', '', false], ['(?u)a', '', true], ['(?u:a)', '', true],
  // Bytes patterns: no `\u`, `\U` or `\N`.
  ['\\u0041', '', true], ['\\U00000041', '', true], ['\\N{EM DASH}', '', true], ['[\\u0041]', '', true], ['[\\N{EM DASH}]', '', true],
  // A lookbehind of more than one width, in a pattern over lines (its message has no position, nor a line).
  ['a\n(?<=a | bc)x', 'X', false],
];
const FLAGGED = [...FLAGGED_VALID, ...FLAGGED_REFUSED];

/**
 * Replacement templates of `re.sub` (#752): a pattern, a template, and whether both are bytes. Python reads the template when the call
 * runs, whether or not anything matches (`re.sub(pattern, template, '')`), and refuses it with `re.error`, or `IndexError` for a name
 * the pattern has no group of; the reader gives the same message at the same position (`readTemplate`), with the pattern's groups.
 */
type TemplateRow = [pattern: string, template: string, bytes: boolean];
const TEMPLATES_VALID: TemplateRow[] = [
  ['(a)', '\\1', false], ['(a)', '\\g<1>', false], ['(?P<n>a)', '\\g<n>', false], ['(?P<n>a)', '\\g<1>\\1', false], ['(a)', '\\g<0>', false], ['(a)', '\\g<01>', false],
  ['(a)', '\\n\\t\\\\\\a\\b\\f\\r\\v', false], ['(a)', '\\0\\01\\012\\101\\377\\08', false], ['(a)', '\\-\\%\\é\\ \\<', false], ['(a)', 'plain', false],
  ['(a)(b)(c)(d)(e)(f)(g)(h)(i)(j)', '\\10\\g<10>', false], ['', '', false], ['(?P<é>a)', '\\g<é>', false], ['(a)', '\\g<0>', true],
];
const TEMPLATES_REFUSED: TemplateRow[] = [
  ['a', '\\1', false], ['(a)', '\\2', false], ['(a)', '\\1\\2', false], ['(a)', '\\g<2>', false], ['(?P<n>a)', '\\g<m>', false], ['(a)', '\\g<1 >', false],
  ['(a)', '\\g<-1>', false], ['(a)', '\\g<', false], ['(a)', '\\g<>', false], ['(a)', '\\g<a', false], ['(a)', '\\g1', false], ['(a)', '\\', false], ['(a)', 'ab\\', false],
  ['(a)', '\\x41', false], ['(a)', '\\d', false], ['(a)', '\\400', false], ['(a)', '\\18', false], ['(a)', '\\10', false], ['(a)', '\\g<١>', false],
  ['(a)', '\\g<a\\x>', false], ['(a)', '\\9\\', false], ['(a)', '\\g<100000000000000000000>', false], ['(a)', '\\g<007>\\g<002>', false], ['(a)', '\\g<\\>', false],
  ['(a)', '\\1a\\19', false], ['(a)', '\\g<\xe9>', true], ['(a)', '\\u0041', false], ['(a)', 'x\\g', false],
];
const TEMPLATES = [...TEMPLATES_VALID, ...TEMPLATES_REFUSED];

/** The message of the reader's refusal of a template, or null. */
function templateRefusal([pattern, template, bytes]: TemplateRow): string | null {
  const read = readRegex(pattern, 'python', 'en', { tool: 'python', python: { ...NO_PYTHON_FLAGS, bytes } });
  const error = readTemplate(template, read.groups, bytes).items.find((i) => i.kind === 'error');
  return error && 'message' in error ? error.message : null;
}

/**
 * Patterns read where `re.VERBOSE` is not known (a flags argument not read): each is compiled by the reference with no flags and
 * with `re.X`, and an Error is said only where both refuse it with the same message. A comment or whitespace of VERBOSE that holds
 * what Python refuses without it (`(`, `[`, global flags after whitespace), what both refuse, and what only VERBOSE refuses.
 */
const VERBOSE_UNKNOWN = [
  '\n  (?i) a  # see [1\n', '(?i) a # (', 'a # )', 'a #[', '(a #[\n)]', '# c\n(?i)a', '  (?i)a', 'a\\ #x',
  'a\\', '[a', '(a', 'a (?i)', '\\1 # x', '*a # c', 'a* ?', 'a b', 'a{1, 3}',
  // (A lookbehind of one width only with VERBOSE, of one only without it, and of more than one either way.)
  '(?<=a |b)x', '(?<=a |bc)x', '(?<=a|bc)x',
];

/** The options of a row's flags (`re.compile(pattern, flags)`), and their value. */
function flagsOf(flags: string, bytes: boolean): { python: PythonRegexOptions; value: number } {
  const set = flags ? flags.split('|').map((f) => PYTHON_FLAGS.find((x) => 'short' in x && x.short === f)!) : [];
  const python: PythonRegexOptions = { ...NO_PYTHON_FLAGS, bytes };
  for (const f of set) if ('option' in f) python[f.option] = true;
  return { python, value: set.reduce((v, f) => v | f.value, 0) };
}

/**
 * The messages of Python's refusals that the reader says, in the order of its tokens: its Errors, or (`ids`) its refusals that say they
 * depend on `re.VERBOSE`.
 */
function refusals(pattern: string, python?: PythonRegexOptions, ids: readonly string[] = ['regex-python-error']): string[] {
  const out: string[] = [];
  const walk = (t: EmbeddedToken) => {
    const said = readSaid(t.explanation);
    if (t.kind === 'error' && said.said.some((s) => ids.includes(s.id))) out.push(/\("(.*)"(?:; [^"]*)?\)$/s.exec(said.text)![1]);
    t.children.forEach(walk);
  };
  explainRegex(pattern, 'python', 'en', { tool: 'python', ...(python ? { python } : {}) }).forEach(walk);
  return out;
}

/**
 * What `.` and the classes of one letter match in a str pattern, and what the reader says of them: a search, what Python finds (or
 * null), and the words a text of the pattern's tokens has. `.` leaves out a newline; the classes are Unicode.
 */
const SEARCHES: [pattern: string, text: string, found: string | null, said: RegExp][] = [
  ['a.b', 'a\nb', null, /except a newline/], ['a.b', 'a\tb', 'a\tb', /except a newline/],
  ['\\w+', '日本語 abc', '日本語', /any script/], ['\\W', '日', null, /any script/], ['[\\w]+', 'é1_', 'é1_', /any script/],
  ['\\d+', '０١3', '０١3', /any script/], ['\\D', '١', null, /any script/],
  ['\\s', '\u3000', '\u3000', /Unicode whitespace/], ['\\S', '\u3000', null, /Unicode whitespace/],
  ['\\b日', 'x 日', '日', /any script/], ['x\\B日', 'x日', 'x日', /any script/],
];

/** The texts of a pattern's tokens. */
function texts(pattern: string): string[] {
  const out: string[] = [];
  const walk = (t: EmbeddedToken) => {
    out.push(readSaid(t.explanation).text);
    t.children.forEach(walk);
  };
  explainRegex(pattern, 'python', 'en', { tool: 'python' }).forEach(walk);
  return out;
}

describe('the Python flavor of the regex reader against the reference Python', function () {
  this.timeout(60000);
  const ref = pythonReference();
  let got: { version: string; errors: (string | null)[]; flagged: (string | null)[]; found: (string | null)[]; templates: (string | null)[] };
  before(function () {
    needPython(this, ref);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explain-bash-python-re-'));
    try {
      const request = path.join(dir, 'request.json');
      const flagged = [...FLAGGED.map(([p, flags, bytes]) => [p, flagsOf(flags, bytes).value, bytes]), ...VERBOSE_UNKNOWN.flatMap((p) => [[p, 0, false], [p, 64, false]])];
      fs.writeFileSync(request, JSON.stringify({ patterns: [...VALID, ...REFUSED], flagged, searches: SEARCHES.map(([p, t]) => [p, t]), templates: TEMPLATES }));
      const r = spawnSync((ref as { python: string }).python, ['-I', path.join(__dirname, 'support', 'python-re.py'), request], { encoding: 'utf8', timeout: 60000 });
      assert.strictEqual(r.status, 0, r.stderr);
      got = JSON.parse(r.stdout) as typeof got;
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    assert.strictEqual(got.version, PYTHON_REFERENCE);
  });

  it('refuses a pattern where Python does, with its message, and no other', () => {
    const patterns = [...VALID, ...REFUSED];
    const wrong = patterns.flatMap((p, i) => {
      const ours = refusals(p);
      const theirs = got.errors[i];
      const same = theirs === null ? !ours.length : ours[0] === theirs;
      return same ? [] : [`${JSON.stringify(p)}: Python ${JSON.stringify(theirs)}, ours ${JSON.stringify(ours)}`];
    });
    assert.deepStrictEqual(wrong, []);
    // (Each row is where the table says: the valid ones compile.)
    assert.deepStrictEqual(patterns.filter((p, i) => (got.errors[i] === null) !== VALID.includes(p)), []);
  });

  it('refuses a replacement template where Python does, with its message, and no other', () => {
    const wrong = TEMPLATES.flatMap((row, i) => (templateRefusal(row) === got.templates[i] ? [] : [`${JSON.stringify(row)}: Python ${JSON.stringify(got.templates[i])}, ours ${JSON.stringify(templateRefusal(row))}`]));
    assert.deepStrictEqual(wrong, []);
    assert.deepStrictEqual(TEMPLATES.filter((r, i) => (got.templates[i] === null) !== TEMPLATES_VALID.includes(r)), []);
  });

  it('refuses a pattern with flags where Python does: VERBOSE, inline flags, bytes patterns', () => {
    const wrong = FLAGGED.flatMap(([p, flags, bytes], i) => {
      const ours = refusals(p, flagsOf(flags, bytes).python);
      const theirs = got.flagged[i];
      const same = theirs === null ? !ours.length : ours[0] === theirs;
      return same ? [] : [`${JSON.stringify(p)} ${flags}${bytes ? ' bytes' : ''}: Python ${JSON.stringify(theirs)}, ours ${JSON.stringify(ours)}`];
    });
    assert.deepStrictEqual(wrong, []);
    // (Each row is where the table says: the valid ones compile.)
    assert.deepStrictEqual(FLAGGED.filter((r, i) => (got.flagged[i] === null) !== FLAGGED_VALID.includes(r)), []);
  });

  it('says an Error where `re.VERBOSE` is not known only where Python refuses the pattern both with it and without', () => {
    const wrong = VERBOSE_UNKNOWN.flatMap((p, i) => {
      const [off, on] = got.flagged.slice(FLAGGED.length + 2 * i, FLAGGED.length + 2 * i + 2);
      const python = { ...NO_PYTHON_FLAGS, verbose: 'unknown' as const };
      const errors = refusals(p, python);
      const soft = refusals(p, python, ['regex-python-error-unless-verbose']);
      // (The reading shown is the one without: its first refusal is Python's; an Error only where the reading with VERBOSE refuses the same.)
      const first = refusals(p, python, ['regex-python-error', 'regex-python-error-unless-verbose'])[0] ?? null;
      const ok = first === off && (off !== null && off === on ? errors[0] === off : !errors.length);
      return ok ? [] : [`${JSON.stringify(p)}: Python ${JSON.stringify(off)} without re.X, ${JSON.stringify(on)} with it; ours ${JSON.stringify({ errors, soft })}`];
    });
    assert.deepStrictEqual(wrong, []);
    // (The rows have each case: refused without VERBOSE only, by both alike, by VERBOSE only, and by neither.)
    const rows = VERBOSE_UNKNOWN.map((p, i) => got.flagged.slice(FLAGGED.length + 2 * i, FLAGGED.length + 2 * i + 2));
    assert.ok(rows.some(([off, on]) => off !== null && on === null) && rows.some(([off, on]) => off !== null && off === on) && rows.some(([off, on]) => off === null && on !== null) && rows.some(([off, on]) => off === null && on === null));
  });

  it('says what `.` and the classes match as Python does: not a newline, and letters, digits and spaces of any script', () => {
    assert.deepStrictEqual(got.found, SEARCHES.map(([, , found]) => found));
    assert.deepStrictEqual(SEARCHES.filter(([p, , , said]) => !texts(p).some((t) => said.test(t))).map(([p]) => p), []);
  });
});

describe('the Python flavor of the regex reader: its refusals', () => {
  it('refuses each row the reference refuses, and none of the others', () => {
    assert.deepStrictEqual(VALID.filter((p) => refusals(p).length), []);
    assert.deepStrictEqual(REFUSED.filter((p) => !refusals(p).length), []);
    const refused = ([p, flags, bytes]: Flagged) => refusals(p, flagsOf(flags, bytes).python).length > 0;
    assert.deepStrictEqual(FLAGGED_VALID.filter(refused), []);
    assert.deepStrictEqual(FLAGGED_REFUSED.filter((r) => !refused(r)), []);
  });

  it('says Python\'s message, with the position in the pattern', () => {
    const first = (p: string) => refusals(p)[0];
    assert.deepStrictEqual(['\\e', '[\\e]', '\\x4', '\\U00110000', '\\N', '\\N{', '\\N{abc', '\\777', '\\2', '(a\\1)', '[a', '(a', 'a\\', '[a\\'].map(first), [
      'bad escape \\e at position 0', 'bad escape \\e at position 1', 'incomplete escape \\x4 at position 0', 'bad escape \\U00110000 at position 0',
      'missing { at position 2', 'missing character name at position 3', 'missing }, unterminated name at position 3',
      'octal escape value \\777 outside of range 0-0o377 at position 0', 'invalid group reference 2 at position 1', 'cannot refer to an open group at position 2',
      'unterminated character set at position 0', 'missing ), unterminated subpattern at position 0', 'bad escape (end of pattern) at position 1',
      'bad escape (end of pattern) at position 2',
    ]);
    assert.deepStrictEqual(['*.txt', '(*a)', '^*', '(?i)*', '(?#c)*', 'a**', 'a*?*', 'x{2,1}', 'ab{3,2}', '{2,1}', 'a)', '(a))b'].map(first), [
      'nothing to repeat at position 0', 'nothing to repeat at position 1', 'nothing to repeat at position 1', 'nothing to repeat at position 4',
      'nothing to repeat at position 5', 'multiple repeat at position 2', 'multiple repeat at position 3', 'min repeat greater than max repeat at position 2',
      'min repeat greater than max repeat at position 3', 'min repeat greater than max repeat at position 1', 'unbalanced parenthesis at position 1',
      'unbalanced parenthesis at position 3',
    ]);
  });

  it('refuses a lookbehind of more than one width at the lookbehind, with what its contents may match, and each such one', () => {
    const errors = (p: string, lang: 'en' | 'ja' = 'en') => explainRegex(p, 'python', lang, { tool: 'python', python: NO_PYTHON_FLAGS }).flatMap(function all(t): string[] {
      return [...(t.kind === 'error' ? [`${p.slice(t.start, t.end)}: ${readSaid(t.explanation).text}`] : []), ...t.children.flatMap(all)];
    });
    const said = (contents: string) => `. Its contents may match ${contents}. Python's \`re\` refuses this pattern ("look-behind requires fixed-width pattern")`;
    assert.deepStrictEqual(errors('(?<=a|bc)x'), [`(?<=a|bc): \`(?<=…)\`: preceded by … (lookbehind)${said('1 to 2 characters')}`]);
    assert.deepStrictEqual(errors('x(?<!a+)'), [`(?<!a+): \`(?<!…)\`: not preceded by … (negative lookbehind)${said('1 or more characters')}`]);
    // (The outer one has one width: what the inner one matches is none.)
    assert.deepStrictEqual(errors('(?<=a(?<=b|cd))(?<=\\w?)').map((e) => e.slice(0, e.indexOf(':'))), ['(?<=b|cd)', '(?<=\\w?)']);
    assert.match(errors('(?<=a|bc)x', 'ja')[0], /。中身は1〜2文字に一致しうる。Python の `re` はこのパターンを受け付けない/);
    // (Not so in PCRE, which takes alternatives of different widths: `grep -P '(?<=a|bc)x'`.)
    assert.deepStrictEqual(explainRegex('(?<=a|bc)x', 'pcre', 'en').filter((t) => t.kind === 'error'), []);
  });

  it('does not check a name of `\\N{…}`: there is no table of Unicode names (the one listed exception)', () => {
    assert.deepStrictEqual(refusals('\\N{NOT A NAME}'), []);
  });
});
