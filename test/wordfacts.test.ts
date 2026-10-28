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

/** The word facts that are caveats (\`info\`): the others found here are warnings. */
const LEVELS: Record<string, 'info'> = {
  'for-over-ls-output': 'info', 'for-over-unquoted-args': 'info', 'unquoted-variable-in-test': 'info', 'array-joined-in-assignment': 'info',
};

describe('word facts', () => {
  const cases: [string, string, RegExp][] = [
    ['FOO=1 echo $FOO', 'prefix-assignment-expanded-first', /`FOO=…` is set only in the environment of `echo`; the current shell expands `\$FOO` before that/],
    ['for f in $(ls *.txt); do echo "$f"; done', 'for-over-ls-output', /`\$\(ls …\)` is split on spaces/],
    ['for f in $(find . -name "*.sh"); do :; done', 'for-over-ls-output', /-print0/],
    ['[ $x = y ]', 'unquoted-variable-in-test', /unquoted `\$x` inside `\[ \]`/],
    ['sudo echo 1 > /proc/sys/vm/drop_caches', 'redirect-by-your-shell', /Pitfall: `\/proc\/sys\/vm\/drop_caches` is normally writable only by root: the redirection \(`>`\) is opened by your own shell with your rights, before sudo starts, so it fails with "Permission denied" and the command does not run\. Use `… \| sudo tee \/proc\/sys\/vm\/drop_caches` \(`sudo tee -a` to append\)/],
    ['for a in $*; do :; done', 'for-over-unquoted-args', /unquoted `\$\*` splits arguments/],
    ['cp $src "$dst"', 'unquoted-variable-as-path', /`\$src` is not quoted/],
    // `time` times what follows; what follows is a command like any other.
    ['time rm $f', 'unquoted-variable-as-path', /`\$f` is not quoted/],
    // A path names the program of its last part (`/bin/cp` is cp); the prefix assignment holds for any command.
    ['/bin/cp $src "$dst"', 'unquoted-variable-as-path', /`\$src` is not quoted/],
    ['for f in $(/bin/ls); do :; done', 'for-over-ls-output', /`\$\(ls …\)` is split on spaces/],
    ['/usr/bin/sudo echo 1 > /proc/sys/vm/drop_caches', 'redirect-by-your-shell', /opened by your own shell/],
    ['FOO=1 ./x $FOO', 'prefix-assignment-expanded-first', /`FOO=…` is set only in the environment of `\.\/x`/],
    // The path after quote removal (`'/proc'/sys` is `/proc/sys`), or as written when it is not known.
    ["sudo echo 1 > '/proc'/sys/vm/drop_caches", 'redirect-by-your-shell', /opened by your own shell/],
    ['sudo echo 1 > ""/etc/x', 'redirect-by-your-shell', /opened by your own shell/],
    ['sudo echo 1 > "/etc/$f"', 'redirect-by-your-shell', /opened by your own shell/],
    ['args=$@', 'array-joined-in-assignment', /`args=\$@` joins the arguments into one string/],
  ];
  for (const [src, id, expected] of cases) {
    it(`points out ${src}`, () => {
      const f = facts(src).find((x) => expected.test(x.text));
      assert.ok(f, facts(src).map((x) => x.text).join('\n') || '(none)');
      assert.strictEqual(f.id, id);
      assert.strictEqual(f.kind, 'pitfall');
      // (Its level, and the mark and word of the level: docs/design/note-levels.md.)
      assert.strictEqual(f.level, LEVELS[id] ?? 'warning', id);
      assert.ok(f.text.startsWith((f.level as string) === 'warning' ? '⚠ Pitfall: ' : 'ⓘ Caveat: '), f.text);
      assert.ok(f.refs.length >= 1);
    });
  }
  describe('redirect-by-your-shell', () => {
    const text = (src: string, lang: 'en' | 'ja' = 'en') => facts(src, 0, lang).find((x) => x.id === 'redirect-by-your-shell')!.text;
    it('names a file that only root writes, in both languages', () => {
      assert.strictEqual(text('sudo echo "nameserver 1.1.1.1" > /etc/resolv.conf'),
        '⚠ Pitfall: `/etc/resolv.conf` is normally writable only by root: the redirection (`>`) is opened by your own shell with your rights, before sudo starts, so it fails with "Permission denied" and the command does not run. Use `… | sudo tee /etc/resolv.conf` (`sudo tee -a` to append)');
      assert.match(text('sudo echo "nameserver 1.1.1.1" > /etc/resolv.conf', 'ja'),
        /`\/etc\/resolv\.conf` はふつう root しか書き込めない。リダイレクト（`>`）は sudo ではなく今のシェルが今のユーザーの権限で開くので、sudo が動く前に「Permission denied」で失敗し、コマンドは実行されない。`… \| sudo tee \/etc\/resolv\.conf`（追記なら `sudo tee -a`）を使う$/);
    });
    it('says "if the file is writable only by root" for a path that is not known to be root-only', () => {
      for (const src of ['sudo echo 1 > "/etc/$f"', 'sudo echo 1 > /proc/self/x', 'sudo echo 1 > "/usr/a b"']) {
        assert.match(text(src), /^⚠ Pitfall: if the file is writable only by root, the redirection \(`>`\)/, src);
        assert.match(text(src), /Use `… \| sudo tee file` \(`sudo tee -a` to append\)$/, src);
      }
      assert.match(text('sudo echo 1 > "/etc/$f"', 'ja'), /^⚠ 落とし穴: ファイルが root しか書き込めないなら、リダイレクト（`>`）は/);
    });
    it('suggests tee -a for >>, and a command run by sudo for other descriptors and for input', () => {
      assert.match(text('sudo echo 1 >> /etc/hosts'), /^⚠ Pitfall: `\/etc\/hosts` is normally writable only by root: the redirection \(`>>`\).* Use `… \| sudo tee -a \/etc\/hosts`$/);
      assert.match(text('sudo echo 1 >> /etc/hosts', 'ja'), /リダイレクト（`>>`）.*`… \| sudo tee -a \/etc\/hosts` を使う$/);
      assert.match(text('sudo make 2> /etc/err.log'), /the redirection \(`2>`\).* Use `sudo bash -c '… 2> \/etc\/err\.log'`, so that the redirection is done inside sudo too$/);
      assert.match(text('sudo make &> /etc/err.log', 'ja'), /リダイレクト（`&>`）.*`sudo bash -c '… &> \/etc\/err\.log'` のようにリダイレクトも sudo の中で行う$/);
      assert.match(text('sudo make {fd}> /etc/err.log'), /the redirection \(`\{fd\}>`\).* Use `sudo bash -c '… \{fd\}> \/etc\/err\.log'`/);
      assert.match(text('sudo cat < /etc/shadow'), /^⚠ Pitfall: if the file is readable only by root, the redirection \(`<`\).* Pass the file to the command as an argument, or do the redirection inside sudo too: `sudo bash -c '… < file'`$/);
    });
    // What the note says, with bash: the redirection is opened before the command runs, and a failure ends the command with 1.
    it('is true: a redirection to a file that cannot be written fails before the command runs, with status 1', function () {
      if (process.getuid?.() === 0) this.skip(); // root can write it
      const out = runBash(`echo old > f; chmod a-w f; sh -c 'echo ran > marker' > f; echo "out=$?"; sh -c 'echo ran > marker' >> f; echo "append=$?"; sh -c 'echo ran > marker' 2> f; echo "fd2=$?"; [ -e marker ] && echo marker=present || echo marker=absent`, { files: [] });
      assert.deepStrictEqual(out.stdout.split('\n').filter(Boolean), ['out=1', 'append=1', 'fd2=1', 'marker=absent']);
      assert.strictEqual((out.stderr.match(/Permission denied/g) ?? []).length, 3, out.stderr);
    });
  });
  // (A wrong path given to a command that deletes or overwrites cannot be undone: a warning; to the others, a caveat.)
  // (Also in a command another one runs: `sudo rm $f`.) A value the model knows that stays one word does no harm here: a
  // caveat; one it does not know (`read`, `$(date)`, `$1`) may be anything.
  for (const [src, level] of [['rm $f', 'warning'], ['mv $a "$b"', 'warning'], ['cp -f "$a" $b', 'warning'], ['cat $f', 'info'], ['chmod +x $f', 'info'], ['cd $d', 'info'],
    ['sudo rm -rf $DIR/releases/$line', 'warning'], ['env A=1 cp $a b', 'warning'], ['sudo cat $f', 'info'], ['xargs rm $f', 'warning'],
    ['TS=2024\nrm -rf /tmp/build-$TS', 'info'], ['TS=$(date +%s)\nrm -rf /tmp/build-$TS', 'warning'], ['read line\nrm -rf /tmp/$line', 'warning'], ['D="a b"\nrm -rf /tmp/$D', 'warning'],
    ['if [ "$1" ]; then T=a; else T=b; fi\nrm -rf /tmp/$T', 'warning']] as const) {
    it(`gives an unquoted path in ${src} the level ${level}`, () => {
      const lines = src.split('\n');
      const f = facts(src, lines.length - 1).find((x) => x.id === 'unquoted-variable-as-path');
      assert.strictEqual(f?.level, level, src);
      assert.ok(f.text.startsWith(level === 'warning' ? '⚠ Pitfall: ' : 'ⓘ Caveat: '), f.text);
    });
  }

  it('says when the value known here stays one argument, as bash splits it', () => {
    const f = facts('TS=2024\nrm -rf /tmp/build-$TS', 1)[0];
    assert.match(f.text, /^ⓘ Caveat: `\/tmp\/build-\$TS` is not quoted, .* \(with its value here it stays one argument, `\/tmp\/build-2024`, but another value breaks it\)\. Write `"\/tmp\/build-\$TS"`$/);
    assert.match(facts('TS=2024\nrm -rf /tmp/build-$TS', 1, 'ja')[0].text, /（ここでの値では1つの引数 `\/tmp\/build-2024` のままだが、値が変わると壊れる）/);
    // bash: one argument with the value known; two with a space in it; and the wrapped command gets the words the shell made.
    assert.strictEqual(runBash('TS=2024; set -- /tmp/build-$TS; printf "%s|" "$#" "$@"').stdout, '1|/tmp/build-2024|');
    assert.strictEqual(runBash('D="a b"; set -- /tmp/$D; printf "%s|" "$#" "$@"').stdout, '2|/tmp/a|b|');
    assert.strictEqual(runBash('DIR=; line="x y"; env printf "[%s]" $DIR/releases/$line').stdout, '[/releases/x][y]');
  });

  const fine = [
    'x=1', 'for f in *.txt; do :; done', '[ "$x" = y ]', '[[ $x = y ]]', '[ $? -eq 0 ]', '[ $# -gt 0 ]', '[ ${#a[@]} -eq 0 ]', '[ "$(stat -c %a $f)" -le 600 ]',
    'echo 1 | sudo tee /proc/x', 'sudo cmd > /dev/null', 'sudo dmesg > dmesg.log', 'for a in "$@"; do :; done', 'cp "$src" "$dst"', 'echo $x', "FOO=1 sh -c 'echo $FOO'",
    'for f in $(grep -l x *); do :; done', 'for f in; do :; done',
    // A path runs that file, never a builtin (3.7.2): `./cd` is a script, not `cd`.
    './cd $x', './source $x',
  ];
  for (const src of fine) {
    it(`says nothing about ${src}`, () => assert.deepStrictEqual(facts(src), []));
  }

  it('speaks Japanese, and only on the line where the construct starts', () => {
    assert.match(facts('cp $src d', 0, 'ja')[0].text, /^⚠ 落とし穴: `\$src` をクォートしていないので/);
    assert.deepStrictEqual(facts('for f in $(ls); do\n  echo "$f"\ndone', 1), []);
  });

  it('says a fact once for each word, also through a wrapper', () => {
    // (Each unquoted word its own: quoting one leaves the others. Before, only the first, `$a`.)
    for (const src of ['cp $a $b', 'sudo cp $a $b', 'time cp $a $b']) {
      assert.deepStrictEqual(facts(src).map((f) => f.text.match(/`([^`]+)` is not quoted/)?.[1]), ['$a', '$b'], src);
    }
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
      const word = f.text.match(/^(?:⚠ Pitfall|ⓘ Caveat): `(.*?)` is not quoted/)![1];
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
    ['set -u\nif true; then unset x; fi\necho $x', 2, 'x', true, S, false],
    ['set -u\nunset x && echo $x', 1, 'x', true, S, false],
    ['set -u\necho ${b[0]}', 1, 'b[0]', true, S],
    ['set -u\ndeclare -A m\necho "${m[k]}"', 2, 'm[k]', true, S, false],
    ['set -u\nf() {\n  declare n\n  echo $((n + 1))\n}\nf', 3, 'n', false, S, false],
    ['set -u\nf() {\n  local n\n  echo $(( (n) ? 1 : 2 )) $(( -n ))\n}\nf', 3, 'n', false, S, false],
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
    // (`${x-}` outside a test tests nothing: bash fails on the `$x` after it.)
    ['set -u\necho "${x-}"; echo "$x"', 1, 'x', true, S],
    ['set -u\ny=${x:-}\necho "$x"', 2, 'x', true, S],
    ['set -u\nif true; then echo "${x-}"; fi\necho "$x"', 2, 'x', true, S],
    // (A test after the read in the same function does not count.)
    ['set -u\nf() { echo "$x"; [[ -v x ]]; }\nf', 1, 'x', true, S],
    // (The first read bash fails on, in the order it expands a command: words, assignments, redirections.)
    ['set -u\nx=$a echo "$y"', 1, 'y', true, S],
    ['set -u\n: > "$b" "$c"', 1, 'c', true, S],
    ['set -u\nx=$a > "$b"', 1, 'a', true, S],
    ['set -u\nx=$a cat < "$b"', 1, 'a', true, S],
    ['set -u\ncat <<E > "$b"\n$a\nE', 2, 'a', true, C],
    // (`command` runs the program in its own process; with `-v`, `command` itself is the builtin that fails.)
    ['set -u\ncommand cat < "$f"', 1, 'f', true, C],
    ['set -u\ncommand -p cat <<< "$x"', 1, 'x', true, C],
    ['set -u\ncommand -- cat < "$f"', 1, 'f', true, C],
    ['set -u\ncommand -v cat < "$f"', 1, 'f', true, S],
    ['set -u\nexec cat < "$f"', 1, 'f', true, S],
    // (With `set -e`, the command's failure stops the script, unless it is ignored there.)
    ['set -euo pipefail\ncat < "$f"', 1, 'f', true, `${C}, and \`set -e\` stops the script on that failure`],
    ['set -eu\nshopt -s inherit_errexit\nx=$(cat < "$f")', 2, 'f', true, `${C}, and \`set -e\` stops the subshell running it on that failure`],
    ['set -eu\n( cat < "$f" )', 1, 'f', true, `${C}, and \`set -e\` stops the subshell running it on that failure`],
    // (Without inherit_errexit, `set -e` is off in `$( )`.)
    ['set -eu\nx=$(cat < "$f")', 1, 'f', true, C],
    ['set -euo pipefail\nif cat < "$f"; then :; fi', 1, 'f', true, C],
    ['set -eu\ncat < "$f" || :', 1, 'f', true, C],
  ];
  for (const [src, line, v, fix, exits, environment = true] of fires) {
    it(`says ${v} is unset in ${JSON.stringify(src)}`, () => {
      const [text, ...more] = unbound(src, line);
      assert.ok(text, `${src}: (none)`);
      assert.deepStrictEqual(more, []);
      // (Only the command fails, and the shell goes on: a caveat.)
      const stops = /\`set -e\` stops (the script|the subshell running it) on/.exec(exits)?.[1];
      assert.ok(text.startsWith(`${exits === C ? 'ⓘ Caveat' : '⚠ Pitfall'}: \`${v}\` is not set here${stops ? `, so ${stops} stops` : ''}: with \`set -u\` on, bash fails with "${v}: unbound variable" and ${exits}${environment ? ` (unless \`${v.replace(/\[.*/, '')}\` comes from the environment)` : ''}. `), text);
      assert.ok(text.endsWith(fix ? `write \`\${${v}:-}\`` : 'Set it before this line'), text);
    });
  }
  const quiet = [
    'echo "$dir"', 'set -u\nset +u\necho $dir', 'set -u\ndir=1\necho $dir', 'set -u\necho "${x:-}" "${x-d}" "${x+p}" "${x:+p}" "${x?}" "${x=v}"',
    'set -u\na=()\necho "${a[@]}" "${a[*]}" ${#a[@]} ${!a}', 'set -u\n[[ -v x ]]', 'set -u\necho "$1" "$@" "$*" $# $?', 'set -u\necho "$TERM" "$LOGNAME"',
    'set -u\nif [ -e f ]; then c=1; fi\necho "$c"', 'set -u\nif false; then\n  echo "$c"\nfi', 'set -u\nwhile read -r w; do echo "$q"; q=1; done',
    'set -u\nread -r z\necho "$z"', 'set -u\na1=1 a2=$a1', 'set -u\nsource ./lib.sh\necho $x', 'set -u\neval "$cmd"\necho $x',
    'set -u\ncat <<\'E\'\n$hd\nE', 'set -u\nf() { echo "$y"; }', 'set -u\nf() { echo "$y"; }\nexport -f f\nf', 'set -u\nf() { echo "$y"; }\nf\ny=1\nf',
    'set -u\ndeclare -n r\necho $r', 'set -u\nf() {\n  local n\n  echo $(( 1 || n )) $(( 0 && n )) $(( 0 ? n : 1 )) $(( 1 ? 1 : n )) $(( n = 1 ))\n}\nf',
    'set -u\necho $(( k = 2, k + 1 ))', 'set -u\necho ${x:=1} $x', 'set -u\necho $(( nn + 1 ))',
    // (Outside a function, `declare n` keeps a value from the environment, which arithmetic runs: nothing is trusted.)
    'set -u\ndeclare n\necho $((n + 1))', 'set -u\ndeclare n\necho $(( (n) ? 1 : 2 )) $(( -n ))', "set -u\ntrap 't=1' USR1\necho $t",
    'set -u\necho ${x[$i]} ${x[@]}', 'set -u\necho ${!x}', 'set -u\necho ${x\n}', 'set -u\nx=1 y=$x cmd',
    'set -u\n$cmd > "$f"', "set -u\n'e'cho hi > \"$f\"", 'set -u\n\'e\'cho hi > "$f"',
    // (A test before the read reads the name: it may be what keeps the read from running unset.)
    'set -u\nif [[ -v maybe ]]; then echo "$maybe"; fi', 'set -u\nif [ -n "${maybe+x}" ]; then echo "$maybe"; fi', 'set -u\n[ -z "${maybe:-}" ] || echo "$maybe"',
    'set -u\nif [ "${maybe:-}" ]; then echo "$maybe"; fi', 'set -u\nif false; then :; elif [ "${m:-}" ]; then echo $m; else echo $m; fi',
    'set -u\n[[ -v m && $m ]]', 'set -u\ncase ${m:-} in ?*) echo "$m";; esac', 'set -u\nfor i in ${m:-}; do echo "$m"; done',
    'set -u\nwhile [ -n "${m:-}" ]; do echo "$m"; done', 'set -u\n[ -v m ] && echo "$m"', 'set -u\ndeclare -p m >/dev/null 2>&1 && echo "$m"',
    '#!/bin/bash -e\necho $dir', '#!/bin/bash -o nounset\necho $dir', '#!/usr/bin/env bash -u\necho $dir', '#!/bin/sh -u\necho $dir',
    '#!/bin/bash -Oeu\necho $dir', '#!/bin/bash -eug\necho $dir',
    // (After `${x?}` bash goes on only when `x` is set.)
    'set -u\n: "${x:?need x}"; echo "$x"', 'set -u\n: "${x?}"\necho "$x"', 'set -u\nif [ -e f ]; then x=1; fi\n: "${x?}"\necho "$x"',
    'set -u\ndeclare -n r=t\n: "${r?}"\necho "$r"', 'set -u\nx=1\n: "${x?}" "${a[0]?}"\necho "$x"',
    // (A test before the read, which may end the script or return when it is unset: the flow through it is not followed.)
    'set -u\n[[ -n ${x:-} ]] || { echo no; exit 1; }; echo "$x"', 'set -u\n[ -z "${x:-}" ] && exit 1; echo "$x"',
    'set -u\nif [ -z "${x:-}" ]; then\n  exit 1\nfi\necho "$x"', 'set -u\ndie() { exit 1; }\n[[ -v x ]] || die\necho "$x"',
    'set -u\nf() {\n  if [[ ! -v x ]]; then return 1; fi\n  echo "$x"\n}\nf', 'set -u\n[[ -v x ]] || exit\nf() { echo "$x"; }\nf',
    'set -u\ndeclare -p x >/dev/null || exit 1\necho "$x"',
    // (`command` runs no function, and the command of `command command` is not followed.)
    'set -u\nf() { cat; }\ncommand f < "$f"', 'set -u\ncommand() { :; }\ncommand cat < "$f"', 'set -u\ncommand < "$f"',
    'set -u\nf() { echo "$x"; }\n[[ -v x ]] || exit\nf', 'set -u\nwhile [ -z "${x:-}" ]; do x=1; done\necho "$x"',
    'set -u\nif ! declare -p x >/dev/null 2>&1; then exit 1; fi\necho "$x"', 'set -u\ncommand command cat < "$f"', 'set -u\ncommand -x cat < "$f"',
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
    // (Each statement apart: a command in another branch or after it is said too.)
    assert.strictEqual(unbound('set -u\n[ -e /nonexistent ] && echo "$x"; echo "$y"', 1).length, 2);
    assert.strictEqual(unbound('set -u\necho "$a"; echo "$b"', 1).length, 2);
    // (A statement over several lines: only its first read, on whichever line is explained.)
    assert.strictEqual(unbound('set -u\necho "$a" \\\n  "$b"', 2).length, 0);
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

describe('word facts: an array joined in an assignment', () => {
  const joined = (src: string, lang: 'en' | 'ja' = 'en', shell?: Shell) => facts(src, src.split('\n').length - 1, lang, shell).filter((f) => f.id === 'array-joined-in-assignment').map((f) => f.text);
  it('says what bash makes of it and what to write, in both languages', () => {
    assert.deepStrictEqual(joined('a=$@'), ['ⓘ Caveat: `a=$@` joins the arguments into one string, separated by spaces: `a` is a plain string, and arguments with spaces cannot be told apart again. To keep them apart, assign an array: `a=("$@")`; if one string is meant, write `a="$*"`']);
    assert.deepStrictEqual(joined('x=${arr[@]}'), ['ⓘ Caveat: `x=${arr[@]}` joins the elements into one string, separated by spaces: `x` is a plain string, and elements with spaces cannot be told apart again. To keep them apart, assign an array: `x=("${arr[@]}")`; if one string is meant, write `x="${arr[*]}"`']);
    assert.deepStrictEqual(joined('a=$@', 'ja'), ['ⓘ 注意: `a=$@` では引数が空白で区切られて1つの文字列につながり、`a` はただの文字列になります（空白を含む引数は元に戻せません）。別々に残すには配列にして `a=("$@")` と書き、1つの文字列にするつもりなら `a="$*"` と書きます']);
  });
  // A count, the keys, a slice (often one element: the last argument), part of a string, a prefix of a command, `export`,
  // an element, an array already, and a shell without arrays.
  for (const src of ['a=("$@")', 'a=$*', 'a="$*"', 'a=${#arr[@]}', 'a=${!arr[@]}', 'a=${@: -1}', 'a=${arr[@]: -1}', 'a=${@:2:1}', 'a="args: $@"', 'a=$@x',
    'a=$@ env', 'export a=$@', 'a[0]=$@', 'echo $@', 'for x in $@; do :; done', 'a=$(echo $@)', 'a=${@Z}', 'a=${x}', 'a=${arr[0]}']) {
    it(`says nothing about ${src}`, () => assert.deepStrictEqual(joined(src), []));
  }
  it('says nothing in a shell without arrays', () => assert.deepStrictEqual(joined('a=$@', 'en', 'sh'), []));

  // In bash: the value is one string, joined with spaces (whatever IFS is), the array keeps the words apart, and the
  // string form gives the same string. (With IFS=:, `"$*"` joins with `:`: the note gives no string form there.)
  const cases: string[] = ['a=$@', 'a="$@"', 'a=${@}', 'a=${arr[@]}', 'a="${arr[@]}"', 'a+=$@', 'declare a=${arr[@]/b/B}', 'readonly a=$@', 'IFS=:; a=$@', 'f() { local a=$@; declare -p a; }; f "$@"'];
  const programs = [undefined, ...(process.env.BASH_EXPLAINER_BASH53 ? [process.env.BASH_EXPLAINER_BASH53] : [])];
  for (const program of programs) {
    for (const src of cases) {
      it(`${src}: one string in ${program ? 'bash 5.3' : 'bash'}, and the rewrites do what the note says`, () => {
        const text = joined(src).join('');
        const [, list] = /assign an array: `a\+?=(.*?)`(?:;|$)/.exec(text) ?? [];
        const [, string] = /if one string is meant, write `a\+?=(.*?)`$/.exec(text) ?? [];
        assert.ok(list && !string === src.startsWith('IFS'), text || '(none)');
        const setup = "set -- 'a  b' c; arr=('a  b' c); ";
        const bash = (script: string) => runBash(setup + script, { program }).stdout;
        // (`local` is said in the function, and checked there.)
        const local = src.startsWith('f()');
        const original = bash(local ? src : `${src}; declare -p a`);
        assert.match(original, /^declare -[-r] a="a  [bB] c"\n$/, src);
        const op = src.includes('+=') ? '+=' : '=';
        const before = src.slice(0, src.indexOf(`a${op}`));
        const after = local ? src.slice(src.indexOf(';')) : '';
        const items = bash(`${before}a${op}${list}${after.replace('declare -p a', 'printf "<%s>" "${a[@]}"')}${local ? '' : '; printf "<%s>" "${a[@]}"'}`);
        assert.strictEqual(items, src.includes('/b/B') ? '<a  B><c>' : '<a  b><c>', src);
        if (string) assert.strictEqual(bash(`${before}a${op}${string}${after}${local ? '' : '; declare -p a'}`), original, src);
      });
    }
  }
});
