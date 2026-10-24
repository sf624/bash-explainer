import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Shell } from '../src/dialect';
import type { BashParser as Parser } from '../src/syntax/tree';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { shellState } from '../src/semantics/state';
import { wordFacts } from '../src/wordfacts';
import { runBash } from './support/bash';
import { unboundRead } from '../src/semantics/unbound';
import { descendants } from '../src/syntax/tree';
import { explain } from './support/explain';

let parser: Parser;

before(async () => {
  parser = createUnbashParser();
});

function facts(src: string, line = 0, lang: 'en' | 'ja' = 'en', shell?: Shell) {
  const tree = parser.parse(src);
  return wordFacts(tree.root, line, lang, shellState(tree, shell), shell);
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
    // A pattern stays a pattern in quotes.
    ['cp ${d%/}/* e', '"${d%/}"/*', { d: ['nospace/', 'with space/'] }],
    // `"$*"` would join the arguments into one word; `"$@"` keeps them apart.
    ['cp $*/* e', '"$@"/*', { '@': ['. nospace', ". 'with space'"] }],
    ['cp ${a[*]}/* e', '"${a[@]}"/*', { 'a[]': ['. nospace', ". 'with space'"] }],
    ['cp ${*}/* e', '"${@}"/*', { '@': ['. nospace', ". 'with space'"] }],
    ['cp $d$(echo /)x* e', '"$d$(echo /)"x*', { d: ['nospace', 'with space'] }],
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
    // (`@`: the positional parameters; `a[]`: an array; both as shell words.)
    const set = Object.entries(vars).map(([k, v]) => (k === '@' ? `set -- ${v}` : k.endsWith('[]') ? `${k.slice(0, -2)}=(${v})` : `${k}='${v}'`)).join('; ');
    return runBash(`${set}; printf '<%s>\\n' ${word}`, { cwd: dir, env: { HOME: dir } });
  };
  const values = (vars: Record<string, [string, string]>, i: 0 | 1) => Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, v[i]]));
  for (const [src, quoted, vars] of cases) {
    it(`${src}: ${quoted}, which gives with spaces the words bash gives without`, () => {
      const f = facts(src).find((x) => x.id === 'unquoted-variable-as-path');
      assert.ok(f, facts(src).map((x) => x.text).join('\n') || '(none)');
      assert.strictEqual(f.text.match(/Write `(.*)`$/)?.[1], quoted);
      // The word the note is about, by its text.
      const word = f.text.match(/^⚠ Pitfall: `(.*?)` is not quoted/)![1];
      assert.ok(src.includes(` ${word} `) || src.endsWith(` ${word}`), word);
      const plain = words(word, values(vars, 0));
      const spaced = words(quoted, values(vars, 1));
      assert.strictEqual(plain.status, 0, plain.stderr);
      assert.strictEqual(spaced.stdout, plain.stdout.replace(/nospace/g, 'with space'));
      // (The glob matched: no word is left with a `*` in it.)
      assert.ok(!spaced.stdout.includes('*'), spaced.stdout);
    });
  }
});

describe('an unquoted path that quotes would change', () => {
  // A glob, a `~` or quotes in the value word of `${…}` work only outside double quotes: no rewrite is given.
  const cases: [string, string][] = [
    ['cp ${x:-*.txt} e', '${x:-*.txt}'],
    ['cp ${x:-~} e', '${x:-~}'],
    ["cp ${x:-'a b'} e", "${x:-'a b'}"],
    ['cp ${x:-$a/*} e', '${x:-$a/*}'],
    ['cp ${x/a/*} e', '${x/a/*}'],
  ];
  for (const [src, word] of cases) {
    it(`${src}: warned, with no quoted form`, () => {
      const f = facts(src).find((x) => x.id === 'unquoted-variable-as-path');
      assert.ok(f, facts(src).map((x) => x.text).join('\n') || '(none)');
      assert.ok(!/Write/.test(f.text), f.text);
      // Quoted whole, it means something else in bash.
      const run = (w: string) => runBash(`x=a; a=.; printf '<%s>\\n' ${w}; unset x; printf '<%s>\\n' ${w}`, { files: ['a.txt', 'b.txt'], env: { HOME: '/h' } }).stdout;
      assert.notStrictEqual(run(`"${word}"`), run(word));
    });
  }
});

describe('word facts: an unset variable under set -u', () => {
  const unbound = (src: string, line: number, lang: 'en' | 'ja' = 'en', shell?: Shell): string[] =>
    facts(src, line, lang, shell).filter((f) => f.id === 'nounset-unbound').map((f) => f.text);
  // [script, line, variable, whether the fix is `${v:-}`, what exits, whether the variable may come from the
  // environment]. (Bash fails on each: test/fixtures/probes/words.json has rows of them.)
  const S = 'the script exits';
  const C = 'the command does not run: it fails with status 1';
  const fires: [string, number, string, boolean, string, boolean?][] = [
    ['set -u\necho "$dir"', 1, 'dir', true, S],
    ['set -u\necho ${dir}', 1, 'dir', true, S],
    ['set -o nounset\necho $dir', 1, 'dir', true, S],
    ['#!/bin/bash -eu\necho $dir', 1, 'dir', true, S],
    ['#!/usr/bin/env -S bash -e -o nounset\necho $dir', 1, 'dir', true, S],
    ['set -u\ndeclare x\necho ${#x}', 2, 'x', false, S],
    ['set -u\nx=1; unset x\necho ${x:1} ${x#a}', 2, 'x', false, S, false],
    ['set -u\n{ unset x; }\necho $x', 2, 'x', true, S, false],
    ['set -u\nif true; then unset x; fi\necho $x', 2, 'x', true, S],
    ['set -u\nunset x && echo $x', 1, 'x', true, S],
    ['set -u\necho ${b[0]}', 1, 'b[0]', true, S],
    ['set -u\ndeclare -A m\necho "${m[k]}"', 2, 'm[k]', true, S],
    ['set -u\ndeclare n\necho $((n + 1))', 2, 'n', false, S],
    ['set -u\ndeclare n\necho $(( (n) ? 1 : 2 )) $(( -n ))', 2, 'n', false, S],
    ['set -u\nf() { local v; echo "$v"; }\nf', 1, 'v', true, S, false],
    ['set -u\nf() { declare v; echo "$v"; }\nf', 1, 'v', true, S, false],
    ['set -u\nf() { declare -g v; echo "$v"; }\nf', 1, 'v', true, S],
    ['set -u\nf() { local p="$p"; }\nf', 1, 'p', true, S],
    // (What bash expands before the command sets the name.)
    ['set -u\nx=$x', 1, 'x', true, S],
    ['set -u\nfor x in $x; do :; done', 1, 'x', true, S],
    ['set -u\nread -r x <<< "$x"', 1, 'x', true, S],
    ['set -u\ndeclare x="$x"', 1, 'x', true, S],
    ['set -u\nx=(a $x)', 1, 'x', true, S],
    ['set -u\nx=1 echo "$x"', 1, 'x', true, S],
    // (A test that reads another name guards nothing.)
    ['set -u\n[[ -v y ]] && echo "$x"', 1, 'x', true, S],
    ['set -u\nif [ "${y:-}" ]; then echo "$x"; fi', 1, 'x', true, S],
    ['set -u\ncase a in a) echo "$x";; esac', 1, 'x', true, S],
    ['set -u\nf() {\n  echo "$y"\n}\nf\ny=1', 2, 'y', true, S],
    ["set -u\ntrap 't=1' EXIT\necho \"$t\"", 2, 't', true, S],
    ['set -u\necho $_x', 1, '_x', true, S],
    // (A redirection the shell makes itself: of a builtin, a function, a compound command or no command.)
    ['set -u\necho hi > "$f"', 1, 'f', true, S],
    ['set -u\nread -r x <<< "$h"', 1, 'h', true, S],
    ['set -u\ng() { :; }\ng > "$f"', 2, 'f', true, S],
    ['set -u\n{ :; } > "$f"', 1, 'f', true, S],
    // (A here-document the same way: of a builtin or a compound command, the shell exits.)
    ['set -u\nread -r v <<E\n$y\nE', 2, 'y', true, S],
    ['set -u\n{ cat; } <<E\n$y\nE', 2, 'y', true, S],
    // (A redirection or a here-document of a program: only its own process fails.)
    ['set -u\ncat <<E\n$hd\nE', 2, 'hd', true, C],
    ['set -u\ncat < "$f"', 1, 'f', true, C],
    ['set -u\ncat <<< "$h"', 1, 'h', true, C],
    ['set -u\nx=$(cat < "$f")', 1, 'f', true, C],
    ['set -u\nx=$(echo "$s")', 1, 's', true, 'the subshell running it exits'],
    ['set -u\necho "$s" | cat', 1, 's', true, 'the subshell running it exits'],
    // (Called in a subshell and in the script.)
    ['set -u\nf() {\n  echo "$s"\n}\nf\nx=$(f)', 2, 's', true, 'the shell running it exits'],
  ];
  for (const [src, line, v, fix, exits, environment = true] of fires) {
    it(`says ${v} is unset in ${JSON.stringify(src)}`, () => {
      const [text, ...more] = unbound(src, line);
      assert.ok(text, `${src}: (none)`);
      assert.deepStrictEqual(more, []);
      assert.ok(text.startsWith(`⚠ Pitfall: \`${v}\` is not set here: with \`set -u\` on, bash fails with "${v}: unbound variable" and ${exits}${environment ? ` (unless \`${v.replace(/\[.*/, '')}\` comes from the environment)` : ''}. `), text);
      assert.ok(text.endsWith(fix ? `write \`\${${v}:-}\`` : 'Set it before this line'), text);
    });
  }
  const quiet = [
    'echo "$dir"', 'set -u\nset +u\necho $dir', 'set -u\ndir=1\necho $dir', 'set -u\necho "${x:-}" "${x-d}" "${x+p}" "${x:+p}" "${x?}" "${x=v}"',
    'set -u\na=()\necho "${a[@]}" "${a[*]}" ${#a[@]} ${!a}', 'set -u\n[[ -v x ]]', 'set -u\necho "$1" "$@" "$*" $# $?', 'set -u\necho $HOMEDIR',
    'set -u\nif [ -e f ]; then c=1; fi\necho "$c"', 'set -u\nif false; then\n  echo "$c"\nfi', 'set -u\nwhile read -r w; do echo "$q"; q=1; done',
    'set -u\nread -r z\necho "$z"', 'set -u\na1=1 a2=$a1', 'set -u\nsource ./lib.sh\necho $x', 'set -u\neval "$cmd"\necho $x',
    'set -u\ncat <<\'E\'\n$hd\nE', 'set -u\nf() { echo "$y"; }', 'set -u\nf() { echo "$y"; }\nexport -f f\nf', 'set -u\nf() { echo "$y"; }\nf\ny=1\nf',
    'set -u\ndeclare -n r\necho $r', 'set -u\ndeclare n\necho $(( 1 || n )) $(( 0 && n )) $(( 0 ? n : 1 )) $(( 1 ? 1 : n )) $(( n = 1 ))',
    'set -u\necho $(( k = 2, k + 1 ))', 'set -u\necho ${x:=1} $x', 'set -u\necho $(( nn + 1 ))', "set -u\ntrap 't=1' USR1\necho $t",
    'set -u\necho ${x[$i]} ${x[@]}', 'set -u\necho ${!x}', 'set -u\necho ${x\n}', 'set -u\nx=1 y=$x cmd',
    'set -u\n$cmd > "$f"', "set -u\n'e'cho hi > \"$f\"", 'set -u\n\'e\'cho hi > "$f"',
    // (A test before the read reads the name: it may be what keeps the read from running unset.)
    'set -u\nif [[ -v maybe ]]; then echo "$maybe"; fi', 'set -u\nif [ -n "${maybe+x}" ]; then echo "$maybe"; fi', 'set -u\n[ -z "${maybe:-}" ] || echo "$maybe"',
    'set -u\nif [ "${maybe:-}" ]; then echo "$maybe"; fi', 'set -u\nif false; then :; elif [ "${m:-}" ]; then echo $m; else echo $m; fi',
    'set -u\n[[ -v m && $m ]]', 'set -u\ncase ${m:-} in ?*) echo "$m";; esac', 'set -u\nfor i in ${m:-}; do echo "$m"; done',
    'set -u\nwhile [ -n "${m:-}" ]; do echo "$m"; done', 'set -u\n[ -v m ] && echo "$m"', 'set -u\ndeclare -p m >/dev/null 2>&1 && echo "$m"',
    '#!/bin/bash -e\necho $dir', '#!/bin/bash -o nounset\necho $dir', '#!/usr/bin/env bash -u\necho $dir', '#!/bin/sh -u\necho $dir',
  ];
  for (const src of quiet) {
    it(`says nothing of ${JSON.stringify(src)}`, () => {
      for (let line = 0; line < src.split('\n').length; line++) assert.deepStrictEqual(unbound(src, line), [], `line ${line}`);
    });
  }
  it('says only the first, where bash stops', () => {
    const [text, ...more] = unbound('set -u\necho $a $b', 1);
    assert.match(text, /`a` is not set/);
    assert.deepStrictEqual(more, []);
    // (A subshell that exits does not stop the script.)
    assert.strictEqual(unbound('set -u\nx=$(echo "$a"); echo $b', 1).length, 2);
  });
  it('speaks Japanese', () => {
    assert.match(unbound('set -u\necho $dir', 1, 'ja')[0], /^⚠ 落とし穴: ここでは `dir` に値が設定されていない。`set -u` が有効なので、bash は `dir: unbound variable` のエラーを出し、スクリプトが終了する.*`\$\{dir:-\}` と書く$/);
    assert.match(unbound('set -u\ndeclare x\necho ${#x}', 2, 'ja')[0], /この前で値を設定しておく$/);
    assert.match(unbound('set -u\nx=$(echo "$s")', 1, 'ja')[0], /これを実行するサブシェルが終了する/);
    assert.match(unbound('set -u\nf() {\n  echo "$s"\n}\nf\nx=$(f)', 2, 'ja')[0], /これを実行するシェルが終了する/);
    assert.match(unbound('set -u\ncat < "$f"', 1, 'ja')[0], /このコマンドは実行されず、終了ステータス 1 で失敗する（`f` が環境変数から来るときを除く）。/);
    assert.match(unbound('set -u\nunset x\necho "$x"', 2, 'ja')[0], /スクリプトが終了する。設定されていない/);
  });
  it('says it in the words of the shell', () => {
    // (dash, checked with dash 0.5: "z: parameter not set", status 2; another shell's message is not quoted.)
    assert.match(unbound('set -u\necho "$z"', 1, 'en', 'dash')[0], /with `set -u` on, dash fails with "z: parameter not set" and the script exits/);
    assert.match(unbound('set -u\necho "$z"', 1, 'ja', 'dash')[0], /dash は `z: parameter not set` のエラーを出し、スクリプトが終了する/);
    for (const shell of ['sh', 'zsh', 'ksh'] as const) {
      const [text] = unbound('set -u\necho "$z"', 1, 'en', shell);
      assert.match(text, /with `set -u` on, reading it is an error, and the script exits/, shell);
      assert.doesNotMatch(text, /bash|unbound variable/, shell);
    }
    assert.match(unbound('set -u\necho "$z"', 1, 'ja', 'sh')[0], /`set -u` が有効なので、読むとエラーになり、スクリプトが終了する/);
    // (dash goes on after a here-document, and its redirections are not followed: nothing is said there.)
    assert.deepStrictEqual(unbound('set -u\nread v <<E\n$y\nE', 2, 'en', 'dash'), []);
    assert.deepStrictEqual(unbound('set -u\ncat < "$f"', 1, 'en', 'dash'), []);
  });
  it('says that a function of another shell stops that shell', () => {
    assert.ok(explain("bash -c 'set -u; f() { echo \"$z\"; }; f'").notes.some((n) => /`z` is not set here: .* and the shell running it exits/.test(n)));
  });
  it('names the reads after one in a function body, which runs later', () => {
    assert.strictEqual(unbound('set -u\nf() { echo "f:$x"; }; echo "main:$y"; f', 1).length, 2);
  });
  it('reads only expansions and names in arithmetic', () => {
    const tree = parser.parse('set -u\necho x');
    assert.strictEqual(unboundRead(descendants(tree.root, ['word']).pop()!, shellState(tree)), undefined);
  });
});
