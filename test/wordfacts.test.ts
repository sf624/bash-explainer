import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { BashParser as Parser } from '../src/syntax/tree';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { shellState } from '../src/semantics/state';
import { wordFacts } from '../src/wordfacts';
import { runBash } from './support/bash';

let parser: Parser;

before(async () => {
  parser = createUnbashParser();
});

function facts(src: string, line = 0, lang: 'en' | 'ja' = 'en') {
  const tree = parser.parse(src);
  return wordFacts(tree.root, line, lang, shellState(tree));
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

describe('the quoted form an unquoted path is given', () => {
  // The command, what the note says to write, and the variables: a value without spaces, then one with a space.
  const cases: [string, string, Record<string, [string, string]>][] = [
    // Only the expansion is quoted, so the glob still matches (`"$DIR/*"` would name a file `*`).
    ['rm -rf $DIR/*', '"$DIR"/*', { DIR: ['nospace', 'with space'] }],
    ['cp $a/*.txt d', '"$a"/*.txt', { a: ['nospace', 'with space'] }],
    ['cp ${d}/x* e', '"${d}"/x*', { d: ['nospace', 'with space'] }],
    ['cp $a$b/* e', '"$a$b"/*', { a: ['nos', 'with '], b: ['pace', 'space'] }],
    // A tilde and a brace expansion stay outside the quotes, where they expand.
    ['cp ~/$x/* e', '~/"$x"/*', { x: ['nospace', 'with space'] }],
    ['cp $x/{a,b}.txt e', '"$x"/{a,b}.txt', { x: ['nospace', 'with space'] }],
    // Parts already quoted stay as written.
    ['cp "$a"/$b/* e', '"$a"/"$b"/*', { a: ['.', '.'], b: ['nospace', 'with space'] }],
    ["cp $a/'x'* e", `"$a"/'x'*`, { a: ['nospace', 'with space'] }],
    // With no glob, tilde or brace, the whole word is quoted.
    ['cp $a/b.txt e', '"$a/b.txt"', { a: ['nospace', 'with space'] }],
    ['cd $d', '"$d"', { d: ['nospace', 'with space'] }],
  ];
  let dir: string;
  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explain-bash-quote-'));
    for (const d of ['nospace', 'with space']) {
      fs.mkdirSync(path.join(dir, d));
      for (const f of ['a.txt', 'b.txt', 'x1', 'x2']) fs.writeFileSync(path.join(dir, d, f), '');
    }
  });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));
  /** The words bash makes of `word` with these values, one per line. */
  const words = (word: string, vars: Record<string, string>) => {
    const set = Object.entries(vars).map(([k, v]) => `${k}='${v}'`).join('; ');
    return runBash(`${set}; printf '<%s>\\n' ${word}`, { cwd: dir, env: { HOME: dir } });
  };
  const values = (vars: Record<string, [string, string]>, i: 0 | 1) => Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, v[i]]));
  for (const [src, quoted, vars] of cases) {
    it(`${src}: ${quoted}, which gives with spaces the words bash gives without`, () => {
      const f = facts(src).find((x) => x.id === 'unquoted-variable-as-path');
      assert.ok(f, facts(src).map((x) => x.text).join('\n') || '(none)');
      assert.strictEqual(f.text.match(/Write `(.*)`$/)?.[1], quoted);
      const cmd = parser.parse(src).root.namedChildren[0];
      const word = cmd.namedChildren[cmd.namedChildren.length - (src.startsWith('cd') || src.startsWith('rm') ? 1 : 2)].text;
      const plain = words(word, values(vars, 0));
      const spaced = words(quoted, values(vars, 1));
      assert.strictEqual(plain.status, 0, plain.stderr);
      assert.strictEqual(spaced.stdout, plain.stdout.replace(/nospace/g, 'with space'));
      // (The glob matched: no word is left with a `*` in it.)
      assert.ok(!spaced.stdout.includes('*'), spaced.stdout);
    });
  }
});
