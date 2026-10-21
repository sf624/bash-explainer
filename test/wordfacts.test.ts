import * as assert from 'assert';
import type { BashParser as Parser } from '../src/syntax/tree';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { wordFacts } from '../src/wordfacts';

let parser: Parser;

before(async () => {
  parser = createUnbashParser();
});

function facts(src: string, line = 0, lang: 'en' | 'ja' = 'en') {
  return wordFacts(parser.parse(src).root, line, lang);
}

describe('word facts', () => {
  const cases: [string, string, RegExp][] = [
    ['FOO=1 echo $FOO', 'prefix-assignment-expanded-first', /`FOO=…` is set only in the environment of `echo`; the current shell expands `\$FOO` before that/],
    ['for f in $(ls *.txt); do echo "$f"; done', 'for-over-ls-output', /`\$\(ls …\)` is split on spaces/],
    ['for f in $(find . -name "*.sh"); do :; done', 'for-over-ls-output', /-print0/],
    ['[ $x = y ]', 'unquoted-variable-in-test', /unquoted `\$x` inside `\[ \]`/],
    ['sudo echo 1 > /proc/sys/vm/drop_caches', 'redirect-by-your-shell', /done by your own shell .* `… \| sudo tee file`/],
    ['for a in $*; do :; done', 'for-over-unquoted-args', /unquoted `\$\*` splits arguments/],
    ['cp $src "$dst"', 'unquoted-variable-as-path', /`\$src` is not quoted/],
    // `time` times what follows; what follows is a command like any other.
    ['time rm $f', 'unquoted-variable-as-path', /`\$f` is not quoted/],
  ];
  for (const [src, id, expected] of cases) {
    it(`points out ${src}`, () => {
      const f = facts(src).find((x) => expected.test(x.text));
      assert.ok(f, facts(src).map((x) => x.text).join('\n') || '(none)');
      assert.strictEqual(f.id, id);
      assert.strictEqual(f.kind, 'pitfall');
      assert.ok(f.text.startsWith('⚠ Pitfall: '));
      assert.ok(f.refs.length >= 1);
    });
  }

  const fine = [
    'x=1', 'for f in *.txt; do :; done', '[ "$x" = y ]', '[[ $x = y ]]', '[ $? -eq 0 ]', '[ $# -gt 0 ]', '[ ${#a[@]} -eq 0 ]', '[ "$(stat -c %a $f)" -le 600 ]',
    'echo 1 | sudo tee /proc/x', 'sudo cmd > /dev/null', 'sudo dmesg > dmesg.log', 'for a in "$@"; do :; done', 'cp "$src" "$dst"', 'echo $x', "FOO=1 sh -c 'echo $FOO'",
    'for f in $(grep -l x *); do :; done', 'for f in; do :; done',
  ];
  for (const src of fine) {
    it(`says nothing about ${src}`, () => assert.deepStrictEqual(facts(src), []));
  }

  it('speaks Japanese, and only on the line where the construct starts', () => {
    assert.match(facts('cp $src d', 0, 'ja')[0].text, /^⚠ 落とし穴: `\$src` をクォートしていないので/);
    assert.deepStrictEqual(facts('for f in $(ls); do\n  echo "$f"\ndone', 1), []);
  });

  it('says a fact once', () => {
    assert.strictEqual(facts('cp $a $b').length, 1);
  });
});
