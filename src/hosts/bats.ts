import type { LineExplanation, Token } from '../analyzer-types';
import { BATS_COMMANDS } from '../dict/bats';
import type { Extracted } from './index';
import { Builder } from './builder';
import { ALNUM, COMMENT_TEST, droppedBefore, tagComment } from './batstags';
import type { HostRun } from '../semantics/walk/host';

/**
 * How bats-core 1.13 runs a test file (libexec/bats-core/bats-exec-file, bats-exec-test): it sources the file with
 * `set -eET`, then calls each test (the functions on the rows `tests`) in a process of its own, after `setup` and
 * before `teardown`; `setup_file` and `teardown_file` run in one more process, before the tests and after them. It
 * calls `teardown` and `teardown_file` on the left of `||`.
 */
export const batsRun = (tests: readonly number[]): HostRun => ({
  set: ['errexit', 'errtrace', 'functrace'], tests,
  each: { before: 'setup', after: 'teardown' }, file: { before: 'setup_file', after: 'teardown_file' },
});

/** A test of bats-core's preprocessor (bats-preprocess): `@test NAME {` and the rest of the line, the start of the body. */
export const BATS_TEST = /^([ \t]*)(@test[ \t]+)(.*[^ \t])[ \t]+\{(.*)$/;

/**
 * The name bats gives the function of a test (bats_encode_test_name), as in a UTF-8 locale: `test_` and the
 * description, with a space as `_`, a letter or a digit as it is (`[[:alnum:]]`, which takes `é` too, not `²`), and any other
 * character as `-` and its code point in hex (`_` is `-5f`, `-` is `-2d`). The name depends on the locale: in the C
 * locale, `é` is not a letter, and each of its UTF-8 bytes is written in hex (`-c3-a9`).
 */
const LETTER = new RegExp(`[${ALNUM}]`, 'u');
export function batsTestName(description: string): string {
  return 'test_' + [...description].map((c) => (c === ' ' ? '_' : LETTER.test(c) ? c : `-${c.codePointAt(0)!.toString(16).padStart(2, '0')}`)).join('');
}

const batsTestMeaning = (name: string): [string, string] => [
  `bats のテスト: bats はこれを関数 \`${name}\` に書き換えて、テストを実行するときに呼ぶ`,
  `bats test: bats rewrites it into the function \`${name}\`, which it calls to run the test`];

/** A function marked `# @test`: bats makes the function the test, under another name. */
const batsMarkedMeaning = (written: string, name: string): [string, string] => [
  `bats のテスト: コメント \`# @test\` があるので、bats はこの関数をテストとして実行する。関数は \`${name}\` に改名されるので、\`${written}\` では呼べない`,
  `bats test: because of the comment \`# @test\`, bats runs this function as a test. It renames the function \`${name}\`, so it can no longer be called as \`${written}\``];

/** The comment commands of bats on a line, which bash ignores as comments: tags, and `# @test` after a function. */
function batsComments(ex: LineExplanation, original: string, marked: boolean, lang: 'ja' | 'en'): void {
  const tag = tagComment(original);
  if (!tag && !marked) return;
  const text = tag?.invalid
    ? lang === 'ja' ? 'bats への指示コメント: bash は無視するが、bats はこのタグのリストを受け付けず、このファイルのテストを1つも実行しない' : 'bats directive: bash ignores the comment; bats refuses its list of tags, and runs none of the tests of this file'
    : tag
    ? lang === 'ja' ? `bats への指示コメント: bash は無視するが、bats が読んで${tag.scope === 'test' ? '次のテストだけ' : 'これ以降のすべてのテスト'}にタグを付ける` : `bats directive: bash ignores the comment, bats reads it and tags ${tag.scope === 'test' ? 'the next test only' : 'every later test'}`
    : lang === 'ja' ? 'bats への指示コメント: bash は無視するが、bats は前の関数をテストとして登録する' : 'bats directive: bash ignores the comment, bats registers the function before it as a test';
  const walk = (ts: Token[]): void => ts.forEach((t) => {
    if (t.kind === 'comment' && t.span.start.line === ex.line) {
      // (A line that is only this comment has its explanation as the summary.)
      ex.summary = ex.summary.replace(t.explanation, () => text);
      t.explanation = text;
    }
    walk(t.children);
  });
  walk(ex.items);
}

/** A function marked `# @test`, read as bats reads it, and how the extractor writes it for bash. */
function markedTest(line: string) {
  const [, before, written, gap] = COMMENT_TEST.exec(line.replace(/\r$/, ''))!;
  // (The keyword `function` is kept, blanks and parentheses become `()`, other text before the name is dropped.)
  const keyword = droppedBefore(line) === undefined && /function[ \t]+$/.test(before);
  const parens = /[()]/.test(gap);
  // (One quote is taken off each end, as of a description.)
  const name = batsTestName(written.replace(/^['"]/, '').replace(/['"]$/, ''));
  const fn = keyword ? 'function ' : '';
  return {
    from: before.length, to: before.length + written.length, end: before.length + written.length + gap.length, keyword, parens, name, written,
    /** The head of the definition, as bash shows it (`test_x()`, `function test_x`) and as written, normalized (`x()`, `function x`, `x`). */
    head: fn + name + (keyword && !parens ? '' : '()'), label: fn + written + (parens ? '()' : ''),
  };
}

/** The head of the definition of a test: `@test "x"` and the function bash reads, or the name and the parentheses of a marked function. */
function testHeads(original: string, shell: string): { written: string; head: string; name: string; marked?: string } {
  const line = original.replace(/\r$/, '');
  if (BATS_TEST.test(line)) {
    const name = /^\s*(\S+)\(\)/.exec(shell)![1];
    return { written: testText(line), head: `${name}()`, name };
  }
  const m = markedTest(line);
  return { written: m.label, head: m.head, name: m.name, marked: m.written };
}

/**
 * The explanation of the line of a bats test, which bash reads as the definition of a function: the definition is
 * the test as written (`@test "x" { … }`, or the function marked `# @test`), and the context shows the test rather
 * than the function. Also the comments bats reads (tags, `# @test`), which bash ignores.
 */
export function batsTestLine(ex: LineExplanation, extracted: Extracted, original: string[], tests: readonly number[], lang: 'ja' | 'en'): void {
  const shell = extracted.text.split('\n');
  for (const c of ex.context) {
    if (!tests.includes(c.line)) continue;
    const t = testHeads(original[c.line], shell[c.line]);
    if (c.label.includes(`\`${t.name}\``)) c.label = t.marked ? t.written : testText(original[c.line]);
  }
  const here = tests.includes(ex.line) ? testHeads(original[ex.line], shell[ex.line]) : undefined;
  batsComments(ex, original[ex.line], !!here?.marked, lang);
  if (!here) return;
  const def = ex.items.find((t) => t.kind === 'function' && t.span.start.line === ex.line)!;
  const lines = /\s*[（(](?:行|lines?) [^)）]*[)）]$/.exec(def.explanation)?.[0] ?? '';
  def.explanation = (here.marked ? batsMarkedMeaning(here.marked, here.name) : batsTestMeaning(here.name))[lang === 'ja' ? 0 : 1] + lines;
  def.summary = def.explanation;
  def.label = def.label.replace(here.head, here.written);
  def.labelParts = def.labelParts!.map((p) => (p.text.startsWith(here.head) ? { ...p, text: p.text.replace(here.head, here.written) } : p));
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
    if (!m) {
      // `name() { # @test`: bats makes the function a test under the name it gives `@test "name"` (the parentheses and
      // `function` are optional), and replaces the whole line with its definition.
      if (!COMMENT_TEST.test(line)) { b.plain(i); continue; }
      const t = markedTest(line);
      const indent = /^[ \t]*/.exec(line)![0].length;
      const o = b.plain(i, 0, t.keyword ? t.from : indent);
      // (What bats drops before the name, blanked out, so that the columns stay.)
      if (!t.keyword) o.copy(' '.repeat(t.from), indent, t.from);
      o.insert(t.name, t.from, t.to, [`bats がテストの関数に付ける名前（\`# @test\` のコメントがある関数の名前から作る）`, `the name bats gives the function of the test (made of the name of a function marked with \`# @test\`)`]);
      if (t.keyword && !t.parens) o.copy(line, t.to, t.end);
      else o.insert('()', t.to, t.end);
      o.copy(line, t.end, line.length);
      tests.push(i);
      continue;
    }
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
  Object.assign(b.regions[0], { commands: BATS_COMMANDS, tests, run: batsRun(tests) });
}

