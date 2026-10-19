import * as assert from 'assert';
import * as path from 'path';
import type { BashParser as Parser } from '../src/syntax/tree';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { pitfallNotes } from '../src/pitfalls';

const root = path.join(__dirname, '..');
let parser: Parser;

before(async () => {
  parser = createUnbashParser();
});

function notes(src: string, line = 0, lang: 'en' | 'ja' = 'en'): string[] {
  const tree = parser.parse(src);
  return pitfallNotes(tree.root, line, lang);
}

describe('pitfalls', () => {
  const cases: [string, RegExp][] = [
    ['x = 1', /runs a command named `x`; it is not an assignment/],
    ['rm -rf $DIR/build', /if `DIR` is empty this becomes `rm -r \/build`/],
    ['rm -rf "${DIR}/build"', /if `DIR` is empty/],
    ['for f in $(ls *.txt); do echo "$f"; done', /`\$\(ls …\)` is split on spaces/],
    ['for f in $(find . -name "*.sh"); do :; done', /-print0/],
    ['[ $x = y ]', /unquoted `\$x` inside `\[ \]`/],
    ['while read line; do :; done < f', /without `-r`, backslashes/],
    ['local out=$(cmd)', /hides a failure inside `\$\(…\)`/],
    ['sudo echo 1 > /proc/sys/vm/drop_caches', /done by your own shell .* `… \| sudo tee file`/],
    ['for a in $*; do :; done', /unquoted `\$\*` splits arguments/],
    ['cp $src "$dst"', /`\$src` is not quoted/],
    // `time` times what follows; what follows is a command like any other.
    ['time read x', /without `-r`, backslashes/],
    ['time rm $f', /`\$f` is not quoted/],
    ['time -p rm -rf $DIR/x | cat', /if `DIR` is empty/],
  ];
  for (const [src, expected] of cases) {
    it(`points out ${src}`, () => assert.ok(notes(src).some((n) => expected.test(n)), notes(src).join('\n') || '(none)'));
  }

  const fine = [
    'x=1', 'rm -rf "${DIR:?}/build"', 'rm -rf "$HOME/.cache"', 'rm -f "$tmp"', 'for f in *.txt; do :; done', '[ "$x" = y ]', '[[ $x = y ]]',
    '[ $? -eq 0 ]', '[ $# -gt 0 ]', '[ ${#a[@]} -eq 0 ]', '[ "$(stat -c %a $f)" -le 600 ]', 'read -r line', 'read', 'read -n 1 key',
    'local out', 'out=$(cmd)', 'echo 1 | sudo tee /proc/x', 'sudo cmd > /dev/null', 'sudo dmesg > dmesg.log', 'for a in "$@"; do :; done', 'cp "$src" "$dst"', 'echo $x',
  ];
  for (const src of fine) {
    it(`says nothing about ${src}`, () => assert.deepStrictEqual(notes(src), []));
  }

  it('speaks Japanese, and only on the line where the construct starts', () => {
    assert.match(notes('x = 1', 0, 'ja')[0], /^⚠ 落とし穴: `x =…` は代入ではなく/);
    assert.deepStrictEqual(notes('for f in $(ls); do\n  echo "$f"\ndone', 1), []);
  });
});
