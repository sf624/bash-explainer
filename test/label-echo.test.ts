// An explanation that opens with its own label quoted (`%s`: …) says it twice, since every renderer shows the
// label beside it. The finished token tree drops that opening; the same texts stay whole in notes and summaries.
import * as assert from 'assert';
import type { BashParser as Parser } from '../src/syntax/tree';
import { Analyzer, Token } from '../src/analyzer';
import { createUnbashParser } from '../src/syntax/adapters/unbash';

let parser: Parser;
before(async () => {
  parser = createUnbashParser();
});

const all = (ts: Token[]): Token[] => ts.flatMap((t) => [t, ...all(t.children)]);
const tokens = (src: string, lang: 'en' | 'ja') => all(new Analyzer(lang).explainLine(parser.parse(src), 0).items);
const find = (src: string, lang: 'en' | 'ja', label: string): Token => tokens(src, lang).find((t) => t.label === label)!;

describe('an explanation does not repeat its label', () => {
  const printf = String.raw`printf '\033[1;32m%s\033[0m\n' "OK"`;
  it('drops the label from the parts of a printf format, in en and ja', () => {
    assert.strictEqual(find(printf, 'en', '\\033').explanation, 'the character with octal code 033');
    assert.strictEqual(find(printf, 'en', '%s').explanation, 'value 1 as a string');
    assert.strictEqual(find(printf, 'en', '\\n').explanation, 'newline');
    for (const label of ['\\033', '%s', '\\n']) assert.ok(!find(printf, 'ja', label).explanation.startsWith('`'), label);
  });

  it('drops it in regex, awk, sed, jq, mode and getopts explanations', () => {
    const cases: [string, string, string][] = [
      [`grep -E '^[A-Z]{3}-[0-9]+$' f`, '{3}', 'repeat `[A-Z]` exactly 3 times'],
      [`awk '{ print $1 }' f`, '$1', 'field 1'],
      [`jq '.[]' f`, '[]', 'output each element (or value) one by one'],
      [`jq '.a | .b' f`, '|', 'feeds each result on the left into the filter on the right'],
      [`chmod u+rwx,go-w f`, 'go-w', 'for the group and others, remove write'],
      [`while getopts "ab:" o; do :; done`, 'b:', 'option -b takes a value (`-b VALUE`, available in $OPTARG)'],
      [`sed -n '/a/p' f`, 'p', 'print the line'],
    ];
    for (const [src, label, expected] of cases) {
      const t = find(src, 'en', label);
      assert.ok(t, `${src}: ${label}`);
      assert.ok(!t.explanation.startsWith('`' + label + '`'), `${src}: ${label}: ${t.explanation}`);
      assert.ok(t.explanation.includes(expected) || t.explanation === expected, `${src}: ${t.explanation}`);
    }
  });

  it('leaves no token whose explanation starts with its own label, in en and ja', () => {
    const lines = [
      printf, `grep -E '^[A-Z]{3}-[0-9]+$' f`, `awk 'BEGIN { while ((getline line) > 0) n++ } { print $NF }' f`, `sed -E 's/a+/b/g;2d' f`,
      `jq '.. | numbers, (.a // 1), .b?' f`, `chmod u+rwx,go-w f`, `while getopts "ab:" o; do :; done`, 'echo ${s@Q} ${s~~}',
    ];
    for (const lang of ['en', 'ja'] as const) {
      for (const src of lines) {
        for (const t of tokens(src, lang)) assert.ok(!t.explanation.startsWith('`' + t.label.trim() + '`: '), `${lang} ${src}: ${t.label}: ${t.explanation}`);
      }
    }
  });

  it('keeps an explanation that only mentions its label, or quotes something else', () => {
    const t = find(`jq 'select(.x > 1)' f`, 'en', 'select(.x > 1)');
    assert.ok(t.explanation.startsWith('`select(…)`: '), t.explanation);
  });
});
