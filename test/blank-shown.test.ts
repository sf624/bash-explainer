import * as assert from 'assert';
import { codeSpan } from '../src/label';
import { blankName, blankWord, codeShown } from '../src/messages-values';
import { allTokens, explain } from './support/explain';

// A value made only of blanks is invisible in a code span (issue #657): it is named after the code, once, in
// src/ctlchars.ts (`blankName`, `codeShown`), and every reader of a value says it so.

const texts = (src: string, lang: 'ja' | 'en'): string[] => allTokens(explain(src, 0, lang).items).map((t) => t.explanation);

describe('a blank value shown visibly', () => {
  it('names a value made only of spaces and tabs', () => {
    assert.strictEqual(blankName(' ', false), 'a space');
    assert.strictEqual(blankName('   ', false), '3 spaces');
    assert.strictEqual(blankName('\t', false), 'a tab');
    assert.strictEqual(blankName('\t\t', false), '2 tabs');
    assert.strictEqual(blankName(' \t', false), 'a space and a tab');
    assert.strictEqual(blankName(' ', true), '空白');
    assert.strictEqual(blankName('  ', true), '空白2文字');
    assert.strictEqual(blankName('\t ', true), 'タブと空白');
    for (const other of ['', 'a', ' a', '\n', ' \n']) assert.strictEqual(blankName(other, false), undefined, JSON.stringify(other));
  });

  it('shows the code of a blank with its name, and any other value as it was', () => {
    assert.strictEqual(codeShown(' ', false), '` ` (a space)');
    assert.strictEqual(codeShown('\t', false), '`⇥` (a tab)');
    assert.strictEqual(codeShown(' ', true, ' '), '` `（空白）');
    assert.strictEqual(codeShown('x', false), '`x`');
    assert.strictEqual(codeShown('x', true, ' '), '`x` ');
    assert.strictEqual(codeShown('x', true), '`x`');
  });

  it('merges a remark into the parenthesis of the name, and says an empty value in words', () => {
    assert.strictEqual(codeShown(' ', false, '', 'no wildcards'), '` ` (a space; no wildcards)');
    assert.strictEqual(codeShown(' ', true, '', 'ワイルドカードなし'), '` `（空白。ワイルドカードなし）');
    assert.strictEqual(codeShown('x', false, '', 'no wildcards'), '`x` (no wildcards)');
    assert.strictEqual(codeShown('x', true, '', 'ワイルドカードなし'), '`x`（ワイルドカードなし）');
    assert.strictEqual(codeShown('', false), 'an empty string');
    assert.strictEqual(codeShown('', true, ' '), '空文字列');
  });

  it('keeps a space at both ends of a code span (CommonMark takes one off each end of such a span)', () => {
    assert.strictEqual(codeSpan(' - '), '`  -  `');
    assert.strictEqual(codeSpan(' - x '), '`  - x  `');
    assert.strictEqual(codeSpan(' -'), '` -`');
    assert.strictEqual(codeSpan('  '), '`  `');
    assert.strictEqual(codeSpan(' '), '` `');
    assert.strictEqual(codeShown(' - ', false), '`  -  `');
  });

  it('has one name for a space', () => {
    assert.strictEqual(blankWord(' ', true), '空白');
    assert.strictEqual(blankWord(' ', false), 'space');
    assert.strictEqual(blankWord('\t', true), 'タブ');
    // (The `tr` sets, the IFS note and the mark of a space read the same table.)
    assert.ok(texts("tr -d ' ' a", 'ja').some((t) => t.includes('削除する文字: 空白')));
    assert.ok(texts("tr -d ' ' a", 'en').some((t) => t.includes('characters to delete: space')));
    assert.ok(texts("IFS=' '", 'ja').some((t) => t.includes('空白で分割される')));
    assert.ok(!texts("tr -d '[:blank:]' a", 'ja').some((t) => t.includes('スペース')));
  });

  it('says the replacement of ${x//:/ } and the default of ${x:- }', () => {
    const en = texts('echo ${x//:/ }', 'en');
    assert.ok(en.includes('Parameter expansion: Replace every match of `:` in `x` with ` ` (a space)'), en.join('\n'));
    assert.ok(en.includes('Replacement ` ` (a space)'), en.join('\n'));
    const ja = texts('echo ${x//:/ }', 'ja');
    assert.ok(ja.includes('パラメータ展開: `x` 内で `:` に一致する部分をすべて ` `（空白）に置換'), ja.join('\n'));
    assert.ok(ja.includes('置換後の文字列 ` `（空白）'), ja.join('\n'));
    assert.ok(texts('echo ${x:- }', 'en').includes('Default ` ` (a space): used instead of `x`'));
    assert.ok(texts('echo ${x// /_}', 'en').includes('Parameter expansion: Replace every match of ` ` (a space) in `x` with `_`'));
    assert.ok(texts('echo ${x//\t/ }', 'en').some((t) => t.includes('`⇥` (a tab)')));
    assert.ok(texts('echo ${x//:/  }', 'ja').includes('置換後の文字列 `  `（空白2文字）'));
  });

  it('keeps a value that is not blank as it was', () => {
    assert.ok(texts('echo ${x//:/-}', 'en').includes('Replacement `-`'));
    assert.ok(texts('echo ${x//:/-}', 'ja').includes('置換後の文字列 `-`'));
    assert.ok(texts('echo ${x//:/-}', 'en').includes('Parameter expansion: Replace every match of `:` in `x` with `-`'));
    assert.ok(texts('echo ${x//:/-}', 'ja').includes('パラメータ展開: `x` 内で `:` に一致する部分をすべて `-` に置換'));
  });

  it('names the blank where a child token of the pattern or the regex shows it', () => {
    assert.ok(texts('echo ${x// /_}', 'en').includes('The text ` ` (a space) itself'));
    assert.ok(texts('echo ${x// /_}', 'ja').includes('文字列 ` `（空白）そのもの'));
    assert.ok(texts('echo ${x//\t/ }', 'en').includes('The text `⇥` (a tab) itself'));
    assert.ok(texts('echo ${x// /_}', 'en').includes('Pattern ` ` (a space; no wildcards, so it matches exactly this text)'));
    assert.ok(texts('echo ${x// /_}', 'ja').includes('パターン ` `（空白。ワイルドカードを含まないので、この文字列そのものに一致）'));
    for (const src of ["sed 's/  */ /g' a", "sed -E 's/ +/ /g' a", "grep -E '^ +' a"]) {
      assert.ok(texts(src, 'en').some((t) => /^repeat ` ` \(a space\) (zero|one) or more times$/.test(t)), src);
      assert.ok(texts(src, 'ja').some((t) => /^` `（空白）を(0|1)回以上繰り返す$/.test(t)), src);
    }
    assert.ok(texts("sed 's/ab*/x/' a", 'en').includes('repeat `b` zero or more times'));
    assert.ok(texts("sed 's/ab*/x/' a", 'ja').includes('`b` を0回以上繰り返す'));
  });

  it('keeps a value with a space at both ends, and says an empty pattern', () => {
    assert.ok(texts('echo ${x//,/ - }', 'en').includes('Replacement `  -  `'));
    assert.ok(texts('echo ${x//,/ - }', 'en').includes('Parameter expansion: Replace every match of `,` in `x` with `  -  `'));
    assert.ok(texts("sed 's/,/ | /g' a", 'en').includes('Substitute: replace every match of `,` on each line with `  |  `'));
    const e = texts('echo "${a[@]/#/ }"', 'en');
    assert.ok(e.includes('Parameter expansion: Replace an empty string at the start of `a[@]` with ` ` (a space)'), e.join('\n'));
    assert.ok(texts('echo "${a[@]/#/ }"', 'ja').includes('パラメータ展開: `a[@]` の先頭が空文字列に一致すれば ` `（空白）に置換'));
  });

  it('does not put two parentheses in a row', () => {
    assert.ok(texts("perl -pe 's/,/ /g' a", 'en').includes('Replacement ` ` (a space; `$1`… are the groups)'));
    assert.ok(texts("perl -pe 's/,/ /g' a", 'ja').includes('置換後の文字列 ` `（空白。`$1` などはグループの内容）'));
    assert.ok(texts('echo ${x%% }', 'en').includes('Parameter expansion: Remove the longest suffix of `x` matching ` ` (a space)'));
    assert.ok(texts('echo ${x% }', 'en').includes('Parameter expansion: Remove the shortest suffix of `x` matching ` ` (a space; e.g. strip an extension)'));
  });

  it('names the blank of an option value after quote removal', () => {
    for (const [src, flag] of [["cut -d' ' -f1 a", '-d'], ["awk -F' ' '{print $1}' a", '-F'], ["paste -d' ' a b", '-d'], ["sort -t' ' a", '-t']]) {
      assert.ok(texts(src, 'en').includes(`Value for \`${flag}\` (a space after quote removal)`), src);
      assert.ok(texts(src, 'ja').includes(`\`${flag}\` の値（クォートを外すと空白）`), src);
    }
    assert.ok(texts("sort -t'|' a", 'en').includes('Value for `-t` (`|` after quote removal)'));
  });

  it('names the blank in sed and perl substitutions', () => {
    const sed = texts("sed 's/,/ /g' a", 'en');
    assert.ok(sed.includes('Substitute: replace every match of `,` on each line with ` ` (a space)'), sed.join('\n'));
    assert.ok(sed.includes('Replacement ` ` (a space)'), sed.join('\n'));
    assert.ok(texts("sed 's/ /_/' a", 'en').includes('Pattern (regex) ` ` (a space)'));
    assert.ok(texts("sed 's/,/ /g' a", 'ja').includes('置換: `,` に一致した部分（各行のすべて）を ` `（空白）に置き換える'));
    assert.ok(texts("sed 's/,/;/g' a", 'ja').includes('置換: `,` に一致した部分（各行のすべて）を `;` に置き換える'));
    assert.ok(texts("sed 's/,//g' a", 'en').includes('Substitute: replace every match of `,` on each line with nothing'));
    assert.ok(texts("perl -pe 's/,/ /g' a", 'en').includes('Substitute in the line (`$_`): replace every match of `,` with ` ` (a space)'));
    assert.ok(texts("perl -pe 's/,/;/g' a", 'ja').includes('置換: 現在の行（`$_`）の中で `,` に一致した部分（すべて）を `;` に置き換える'));
  });
});
