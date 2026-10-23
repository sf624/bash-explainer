import type { LineExplanation } from '../analyzer';
import { BATS_COMMANDS } from '../dict/bats';
import type { Extracted } from './index';
import { Builder } from './builder';

/** A test of bats-core's preprocessor (bats-preprocess): `@test NAME {` and the rest of the line, the start of the body. */
export const BATS_TEST = /^([ \t]*)(@test[ \t]+)(.*[^ \t])[ \t]+\{(.*)$/;

/**
 * The name bats gives the function of a test (bats_encode_test_name), as in a UTF-8 locale: `test_` and the
 * description, with a space as `_`, a letter or a digit as it is (`[[:alnum:]]`, which takes `é` too), and any other
 * character as `-` and its code point in hex (`_` is `-5f`, `-` is `-2d`). The name depends on the locale: in the C
 * locale, `é` is not a letter, and each of its UTF-8 bytes is written in hex (`-c3-a9`).
 */
export function batsTestName(description: string): string {
  return 'test_' + [...description].map((c) => (c === ' ' ? '_' : /[\p{L}\p{N}]/u.test(c) ? c : `-${c.codePointAt(0)!.toString(16).padStart(2, '0')}`)).join('');
}

const batsTestMeaning = (name: string): [string, string] => [
  `bats のテスト: bats はこれを関数 \`${name}\` に書き換えて、テストを実行するときに呼ぶ`,
  `bats test: bats rewrites it into the function \`${name}\`, which it calls to run the test`];

/**
 * The explanation of the line of a bats test, which bash reads as the definition of a function: the definition is
 * the test as written (`@test "x" { … }`), and the context shows the test rather than the function.
 */
export function batsTestLine(ex: LineExplanation, extracted: Extracted, original: string[], tests: readonly number[], lang: 'ja' | 'en'): void {
  const shell = extracted.text.split('\n');
  for (const c of ex.context) {
    const name = tests.includes(c.line) ? /^\s*(\S+)\(\)/.exec(shell[c.line])![1] : undefined;
    if (name && c.label.includes(`\`${name}\``)) c.label = testText(original[c.line]);
  }
  if (!tests.includes(ex.line)) return;
  const name = /^\s*(\S+)\(\)/.exec(shell[ex.line])![1];
  const def = ex.items.find((t) => t.kind === 'function' && t.span.start.line === ex.line)!;
  const written = testText(original[ex.line]);
  const lines = /\s*[（(](?:行|lines?) [^)）]*[)）]$/.exec(def.explanation)?.[0] ?? '';
  def.explanation = batsTestMeaning(name)[lang === 'ja' ? 0 : 1] + lines;
  def.summary = def.explanation;
  def.label = def.label.replace(`${name}()`, written);
  def.labelParts = def.labelParts!.map((p) => (p.text.startsWith(`${name}()`) ? { ...p, text: p.text.replace(`${name}()`, written) } : p));
  ex.summary = def.explanation;
}

/** `@test "x"`, as written on the line of a test. */
const testText = (line: string): string => {
  // (A line split at LF only still has the CR of a CRLF, which bats takes off.)
  const [, , keyword, quoted] = BATS_TEST.exec(line.replace(/\r$/, ''))!;
  return keyword + quoted;
};

/**
 * A bats test file: bash, with each `@test "description" {` rewritten into the function bats makes of it (as its
 * preprocessor does, line for line), `test_description() {`. The function's name stands for `@test "description"`.
 */
export function bats(b: Builder): void {
  const tests: number[] = [];
  for (let i = 0; i < b.lines.length; i++) {
    const line = b.lines[i];
    const m = BATS_TEST.exec(line);
    if (!m) { b.plain(i); continue; }
    const [, indent, keyword, quoted, body] = m;
    // (One quote is taken off each end, as bats does.)
    const description = quoted.replace(/^['"]/, '').replace(/['"]$/, '');
    const name = batsTestName(description);
    const from = indent.length;
    const to = from + keyword.length + quoted.length;
    const brace = line.length - body.length - 1;
    const o = b.plain(i, 0, from);
    o.insert(name, from, to, [`テストの名前: bats はこの名前から関数名 \`${name}\` を作る`, `the name of the test: bats makes the function name \`${name}\` of it`]);
    o.insert('()', to, to);
    o.copy(line, to, brace + 1);
    // `@test "x" { }`: bash needs a command in the braces, and bats puts `:;` there.
    if (/^\s*\}/.test(body)) o.insert(' :;', brace + 1, brace + 1);
    o.copy(line, brace + 1, line.length);
    tests.push(i);
  }
  // (The whole file is one region: bats runs it with bash.)
  b.region(0, b.lines.length - 1, ['bats のテストファイル', 'bats test file']);
  Object.assign(b.regions[0], { commands: BATS_COMMANDS, tests });
}

