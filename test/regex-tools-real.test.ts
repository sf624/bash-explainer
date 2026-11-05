import * as assert from 'assert';
import { Analyzer } from '../src/analyzer';
import { explainRegex } from '../src/embedded/regex';
import { toJsRegex } from '../src/examples/regex';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { run } from './support/run';
import { allTokens } from './support/explain';

type Tool = 'awk' | 'sed' | 'bash';

/** Whether the real tool's regex `pattern` matches `subject` (gawk, GNU sed -E, bash `[[ =~ ]]`; the C locale). */
function matches(tool: Tool, pattern: string, subject: string): boolean {
  const env = { ...process.env, LC_ALL: 'C', S: subject };
  if (tool === 'awk') return run('gawk', [`BEGIN { print (ENVIRON["S"] ~ /${pattern}/) ? "y" : "n" }`], { env, ignoreStderr: true }).stdout.toString() === 'y\n';
  // (From a variable: bash drops the backslashes of a regex written in the `[[ ]]`.)
  if (tool === 'bash') return run('bash', ['-c', '[[ $S =~ $R ]] && echo y || echo n'], { env: { ...env, R: pattern }, ignoreStderr: true }).stdout.toString() === 'y\n';
  // (`N` joins a second line, so that a newline can be matched.)
  return run('sed', ['-nE', `N;/${pattern}/p`], { input: `${subject}\nZ\n`, env, ignoreStderr: true }).stdout.toString() !== '';
}

/** [tool, regex, a subject, whether the real tool matches it, what the escape's explanation says, what it must not say]. */
const rows: [Tool, string, string, boolean, RegExp, RegExp?][] = [
  // gawk reads these as the characters (and `\b` as a backspace, `\y` as a boundary), as the manual says.
  ['awk', '\\t', '\t', true, /^`\\t`: a tab/, /-P/],
  ['awk', '\\n', 'a\nb', true, /^`\\n`: a newline/, /-P/],
  ['awk', '\\f', '\f', true, /^`\\f`: a form feed/],
  ['awk', '\\a', '\x07', true, /^`\\a`: a bell/],
  ['awk', '\\v', '\v', true, /^`\\v`: a vertical tab/],
  ['awk', '\\r', '\r', true, /^`\\r`: a carriage return/],
  ['awk', '\\b', '\b', true, /^`\\b`: a backspace/, /word boundary/],
  ['awk', 'a\\y', 'a b', true, /^`\\y`: a word boundary \(gawk/],
  ['awk', 'a\\y', 'ab', false, /^`\\y`: a word boundary/],
  ['awk', '\\101', 'A', true, /^`\\101`: the character with octal code 101/],
  ['awk', '\\1', '\x01', true, /^`\\1`: the character with octal code 1/, /ackreference/],
  ['awk', '\\x41', 'A', true, /^`\\x41`: the character with hex code 41/],
  ['awk', '[\\t]', '\t', true, /one of a tab/],
  ['awk', '[\\b]', '\b', true, /one of a backspace/],
  ['awk', '\\h', 'h', true, /^`\\h`: just "h"; the awk regex has no `\\h`/, /-P/],
  ['awk', '\\h', ' ', false, /just "h"/],
  ['awk', '\\d', 'd', true, /just "d"/, /-P/],
  ['awk', '\\w', 'a', true, /word character/],
  ['awk', '\\<a', 'a', true, /start of a word/],
  // GNU sed.
  ['sed', '\\t', '\t', true, /^`\\t`: a tab/, /-P/],
  ['sed', '\\n', 'a\nb', true, /^`\\n`: a newline/, /-P/],
  ['sed', '\\f', '\f', true, /^`\\f`: a form feed/],
  ['sed', '\\v', '\v', true, /^`\\v`: a vertical tab/],
  ['sed', '\\a', '\x07', true, /^`\\a`: a bell/],
  ['sed', '\\r', '\r', true, /^`\\r`: a carriage return/],
  ['sed', '\\x41', 'A', true, /hex code 41/],
  ['sed', '\\o101', 'A', true, /octal code 101/],
  ['sed', '\\d065', 'A', true, /decimal code 065/],
  ['sed', '\\h', 'h', true, /^`\\h`: just "h"; the sed regex has no `\\h`/, /-P/],
  ['sed', '\\h', '\t', false, /just "h"/],
  ['sed', '\\H', 'H', true, /just "H"/, /-P/],
  ['sed', '\\V', 'V', true, /just "V"/, /-P/],
  ['sed', '\\e', 'e', true, /just "e"/, /-P/],
  ['sed', '\\d', 'd', true, /just "d"/, /-P/],
  ['sed', '\\y', 'y', true, /Literal "y"/],
  ['sed', '\\b', 'a b', true, /word boundary/],
  // bash's [[ =~ ]] (glibc regcomp).
  ['bash', '\\h', 'h', true, /^`\\h`: just "h"; the bash regex has no `\\h`/, /-P/],
  ['bash', '\\h', ' ', false, /just "h"/],
  ['bash', '\\w', 'a', true, /word character/],
];

describe('the escapes of awk, sed and bash are explained as each tool reads them', () => {
  for (const [tool, pattern, subject, real, says, notSay] of rows) {
    it(`${tool} ${pattern} on ${JSON.stringify(subject)}`, () => {
      assert.strictEqual(matches(tool, pattern, subject), real);
      const opts = tool === 'sed' ? { sedEscapes: true } : { tool };
      const t = allTokens(explainRegex(pattern, 'ere', 'en', opts)).filter((x) => pattern.slice(x.start, x.end).match(/^[\\[]/)).pop()!;
      assert.match(t.explanation, says);
      if (notSay) assert.doesNotMatch(t.explanation, notSay);
      assert.notStrictEqual(t.kind, 'error');
      assert.ok(explainRegex(pattern, 'ere', 'ja', opts).length > 0);
    });
  }

  const parser = createUnbashParser();
  /** What the explanation says of the pattern token `text` of a line. */
  const explanations = (line: string, text: string) => allTokens(new Analyzer('en').explainLine(parser.parse(line), 0).items).filter((t) => t.label === text && !['argument', 'block'].includes(t.kind) && t.explanation !== text).map((t) => t.explanation);
  it('says it in the commands themselves', () => {
    assert.deepStrictEqual(explanations("awk '/\\t/' f", '\\t'), ['a tab (HT)']);
    assert.deepStrictEqual(explanations("awk '/\\n/' f", '\\n'), ['a newline (LF)']);
    assert.match(explanations("awk '/\\a\\v\\f/' f", '\\a').at(-1)!, /a bell/);
    assert.match(explanations("awk '/\\y/' f", '\\y').at(-1)!, /word boundary \(gawk/);
    assert.match(explanations("sed 's/\\t/x/' f", '\\t').at(-1)!, /a tab/);
    assert.match(explanations("sed 's/\\h/x/' f", '\\h').at(-1)!, /^just "h"; the sed regex has no `\\h`$/);
    assert.match(explanations("sed -E 's/\\h/x/' f", '\\h').at(-1)!, /the sed regex has no/);
    assert.match(explanations("grep -E '\\h' f", '\\h').at(-1)!, /only with `-P`/);
  });

  it('shows the example of what the tool does, not of what JavaScript would', () => {
    // The example runner is told it is gawk: `\b` is a backspace, `\y` a boundary, `\1` an octal code, `\x41` a character.
    const ex = (p: string) => toJsRegex(p, 'ere', { sedEscapes: true, awk: true });
    assert.strictEqual(ex('\\b')!.source, '\\x08');
    assert.strictEqual(ex('a\\yb')!.source, 'a\\bb');
    assert.strictEqual(ex('\\101')!.source, 'A');
    assert.strictEqual(ex('\\x41')!.source, 'A');
    assert.strictEqual(ex('\\1')!.source, '\x01');
    assert.strictEqual(ex('\\052'), undefined);
    assert.strictEqual(ex('[\\]]'), undefined);
    assert.strictEqual(ex('[\\b]')!.source, '[\\x08]');
    assert.strictEqual(ex('[\\\\]')!.source, '[\\\\]');
    // GNU sed's `\b` is the word boundary.
    assert.strictEqual(toJsRegex('\\b', 'ere', { sedEscapes: true })!.source, '\\b');
  });
});
