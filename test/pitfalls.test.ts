import * as assert from 'assert';
import { spawnSync } from 'child_process';
import * as path from 'path';
import type { BashParser as Parser } from '../src/syntax/tree';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { pitfallFindings, pitfallNotes, type StyleCode } from '../src/pitfalls';
import { shellState } from '../src/semantics/state';
import { wordFacts } from '../src/wordfacts';
import * as fs from 'fs';
import * as os from 'os';
import { Analyzer } from '../src/analyzer';
import { explainHostedLine, extractShell, hostKind } from '../src/hosts';
import { MESSAGES, fact, said, type FactId } from '../src/messages';
import { runBash } from './support/bash';
import { applied } from './support/rewrites';
import type { Shell } from '../src/dialect';

const root = path.join(__dirname, '..');
let parser: Parser;

before(async () => {
  parser = createUnbashParser();
});

function notes(src: string, line = 0, lang: 'en' | 'ja' = 'en', shell?: Shell): string[] {
  const tree = parser.parse(src);
  return pitfallNotes(tree.root, line, lang, shellState(tree, shell), shell);
}

describe('pitfalls', () => {
  const cases: [string, RegExp][] = [
    ['x = 1', /runs a command named `x`; it is not an assignment/],
    ['rm -rf $DIR/build', /if `DIR` is empty this becomes `rm -r \/build`/],
    ['rm -rf "${DIR}/build"', /if `DIR` is empty this becomes `rm -r "\/build"`, deleting from the root. Write `"\$\{DIR:\?\}\/build"`/],
    // The glob stays out of the quotes in the rewrite; quoted as `"$DIR"/*`, an empty DIR still leaves `/*`.
    ['rm -rf $DIR/*', /becomes `rm -r \/\*`, deleting from the root. Write `"\$\{DIR:\?\}"\/\*` to stop/],
    ['rm -rf "$DIR"/*', /becomes `rm -r \/\*`, deleting from the root. Write `"\$\{DIR:\?\}"\/\*` to stop/],
    ['[-f x]', /`\[` is an ordinary command, so a space must follow it \(`\[-f` reads as another command name\)/],
    // (`[ -f x]`, with a last word of known text, is the analyzer's note: test/testexpr.test.ts.)
    ['[ -f $x]', /the `\]` in `\$x\]` is part of the word\. When `\$x` is empty, the word is `\]` alone and closes `\[`, and `\[ -f \]` is true/],
    ['[ "$a" < "$b" ]', /`<` inside `\[ \]` is read as a redirection, not a comparison/],
    ['[ -f x && -n y ]', /`&&` inside `\[ \]` is not an argument of `\[`/],
    ['while read line; do :; done < f', /without `-r`, backslashes/],
    // `time` times what follows; what follows is a command like any other.
    ['time read x', /without `-r`, backslashes/],
    ['time -p rm -rf $DIR/x | cat', /if `DIR` is empty/],
    // A path names the program of its last part, as the explanation reads it: `/bin/rm` is rm.
    ['/bin/rm -rf $DIR/*', /becomes `rm -r \/\*`, deleting from the root/],
    ['./rm -rf $DIR/*', /becomes `rm -r \/\*`, deleting from the root/],
    // A command another one runs (its spec's command slot: sudo, env, nice, nohup, xargs, command…) gets the same checks.
    ['sudo rm -rf $DIR/releases/$line', /if `DIR` is empty this becomes `rm -r \/releases\/\$line`, deleting from the root/],
    ['sudo -u deploy rm -rf "$DIR"/*', /becomes `rm -r \/\*`, deleting from the root/],
    ['env A=1 rm -rf $DIR/x', /if `DIR` is empty this becomes `rm -r \/x`/],
    ['nice -n 10 nohup rm -rf $DIR/x', /if `DIR` is empty this becomes `rm -r \/x`/],
    ['find . -name x | xargs rm -rf $DIR/x', /if `DIR` is empty this becomes `rm -r \/x`/],
    ['command rm -rf $DIR/x', /if `DIR` is empty this becomes `rm -r \/x`/],
    // (A subcommand's slot: `$DIR` is expanded here, and rm deletes in the container.)
    ['docker exec web rm -rf $DIR/x', /if `DIR` is empty this becomes `rm -r \/x`/],
  ];
  for (const [src, expected] of cases) {
    it(`points out ${src}`, () => assert.ok(notes(src).some((n) => expected.test(n)), notes(src).join('\n') || '(none)'));
  }

  const fine = [
    'x=1', 'rm -rf "${DIR:?}/build"', 'rm -rf ""/x', 'rm -rf "a$DIR/x"', 'rm -rf "$DIR"', 'rm -rf "$HOME/.cache"', 'rm -f "$tmp"', 'for f in *.txt; do :; done', '[ "$x" = y ]', '[[ $x = y ]]',
    '[ -f x ] && [ -n y ]', '[ "$a" \\< "$b" ]', '[ -f x ] || [ -n y ]', '[ $? -eq 0 ]', '[ $# -gt 0 ]', '[ ${#a[@]} -eq 0 ]', '[ "$(stat -c %a $f)" -le 600 ]', 'read -r line', 'read', 'read -n 1 key',
    'local out', 'out=$(cmd)', 'echo 1 | sudo tee /proc/x', 'sudo cmd > /dev/null', 'sudo dmesg > dmesg.log', 'for a in "$@"; do :; done', 'cp "$src" "$dst"', 'echo $x',
    // A path runs that file, never a builtin (3.7.2); a function runs instead of the builtin.
    './read x', '/usr/local/bin/read x', 'read() { :; }; read x', 'enable -n read; read x', './x = 1', 'bin/x = 1',
    // A string another shell runs is not this line's words; a function named sudo runs no command of its spec.
    "sudo sh -c 'rm -rf $DIR/x'", 'sudo rm -rf "${DIR:?}/x"', 'sudo() { :; }; sudo rm -rf $DIR/x', 'sudo $cmd -rf $DIR/x',
  ];
  for (const src of fine) {
    it(`says nothing about ${src}`, () => assert.deepStrictEqual(notes(src), []));
  }
  it('reads an alias named like a wrapper as the alias', () => {
    assert.deepStrictEqual(notes('shopt -s expand_aliases\nalias sudo=echo\nsudo rm -rf $DIR/x', 2), []);
    assert.strictEqual(notes('sudo rm -rf $DIR/x').length, 1);
  });

  describe('`rm -r` of a path from a variable that may be empty, in bash', () => {
    // The word, and the value that leaves a path from the root (`DIR=/` for `${DIR%/}`: an empty value would too).
    // (And a value that does not, for the check before the line: `DIR=nospace/` if none.)
    const roots: [string, string, string?][] = [
      ['$DIR/*', 'DIR='], ['"$DIR"/*', 'DIR='], ['"${DIR}/x"', 'DIR='], ['"$DIR/"*', 'DIR='], ['"$DIR""/x"', 'DIR='], ['${DIR:-}/x', 'unset DIR'],
      ['$DIR/${x:-*.txt}', 'DIR='], ['${DIR%/}/*', 'DIR=/'], ['"${DIR%/}"/*', 'DIR=/'], ['${DIR:+x}/*', 'DIR='], ['${DIR-/a}/x', 'DIR='], ['${DIR?}/x', 'DIR='],
      ['${DIR:-$e}/x', 'DIR='], ['${DIR@Q}/x', 'unset DIR'], ['${!DIR}/x', 'e=; DIR=e', 'e=x; DIR=e'],
      // An empty default in quotes is empty (the rewrite stops); an operator's word with quotes gets no check line, only a note.
      ["${DIR:-''}/a", 'DIR='], ["${DIR-''}/a", 'unset DIR'], ['${DIR:-""}/a', 'DIR='], ["${DIR:-$''}/a", 'DIR='], ["${DIR:+''}/a", 'unset DIR', 'DIR=x'],
      ['${DIR:+"x"}/a', 'unset DIR', 'DIR=x'], ["${DIR%'x'}/a", 'DIR=', 'DIR=nospace'],
      // No words at all: an element, `$@`, `${a[@]}` and the keys.
      ['${DIR[0]}/a', 'DIR=()', 'DIR=(nospace)'], ['${DIR[@]}/a', 'DIR=()', 'DIR=(nospace)'], ['${!DIR[@]}/a', 'DIR=()', 'DIR=(nospace)'],
      ['"${DIR[@]}"/a', 'DIR=()', 'DIR=(nospace)'], ['"$@"/a', 'set --', 'set -- nospace'], ['$@/a', 'set --', 'set -- nospace'], ['$*/a', 'set --', 'set -- nospace'],
    ];
    // An expansion that is never empty: a length, a literal default, an error when empty. (The word, the expansion.)
    const never: [string, string][] = [['${#DIR}/x', '${#DIR}'], ['${DIR:-/tmp/x}/*', '${DIR:-/tmp/x}'], ['${DIR:=/a}/x', '${DIR:=/a}'], ['${DIR:?}/*', '${DIR:?}'],
      ['"${DIR:?}"/*', '${DIR:?}'], ['"${DIR:?}/x"', '${DIR:?}'],
      ['${DIR:-"lit"}/a', '${DIR:-"lit"}'], ['${DIR:-a\\ b}/x', '${DIR:-a\\ b}'], ["${DIR:-'lit'}/a", "${DIR:-'lit'}"], ["${DIR:-$'lit'}/a", "${DIR:-$'lit'}"]];
    // In double quotes the quotes of a default stay literal, so it is not empty: bash gives `''/x`.
    it('says nothing about "${DIR:-\'\'}/x", whose default is the two quote characters', () => {
      assert.deepStrictEqual(notes('rm -rf "${DIR:-\'\'}/x"'), []);
      assert.strictEqual(runBash(`unset DIR; printf '<%s>' "\${DIR:-''}/x"`, { cwd: os.tmpdir() }).stdout, "<''/x>");
    });
    it('leaves a list with an operator alone (not worded here)', () => assert.deepStrictEqual(notes('rm -rf ${DIR[@]:-x}/a'), []));
    let dir: string;
    before(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explain-bash-rm-'));
      for (const d of ['nospace', 'with space']) {
        fs.mkdirSync(path.join(dir, d));
        for (const f of ['x', 'y']) fs.writeFileSync(path.join(dir, d, f), '');
      }
    });
    after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const sh = (script: string) => runBash(script, { cwd: dir });
    for (const [word, empty, good = 'DIR=nospace/'] of roots) {
      it(`rm -rf ${word}: warned, and the rewrite stops on ${empty}`, () => {
        const text = notes(`rm -rf ${word}`).join('\n');
        // What the note says it becomes is what bash makes of it.
        const left = text.match(/this becomes `rm -r (.*?)`, deleting from the root/)?.[1];
        assert.ok(left, text || '(none)');
        assert.strictEqual(sh(`${empty}; printf '<%s>\\n' ${word}`).stdout, sh(`printf '<%s>\\n' ${left}`).stdout);
        assert.match(sh(`${empty}; printf '<%s>\\n' ${word}`).stdout, /^<\//);
        const safe = text.match(/Write `(.*)` to stop when it is empty/)?.[1];
        const check = text.match(/Write `(.*)` before it to stop when it is empty/)?.[1];
        if (!safe && !check && /['"]/.test(word)) {
          // A quote in the operator's word: a check in quotes would read it differently, so there is none.
          assert.match(text, /Check that it is not empty before it/);
        } else if (safe) {
          // The same words as the original for a value without spaces, and with spaces kept; nothing when empty.
          assert.strictEqual(sh(`DIR='with space'; printf '<%s>\\n' ${safe}`).stdout, sh(`DIR=nospace; printf '<%s>\\n' ${word}`).stdout.replace(/nospace/g, 'with space'));
          const stopped = sh(`${empty}; printf '<%s>\\n' ${safe}`);
          assert.strictEqual(stopped.stdout, '');
          assert.match(stopped.stderr, /DIR(\[0\])?: parameter null or not set/);
        } else {
          assert.ok(check, text);
          assert.strictEqual(sh(`${empty}; ${check}; echo ran`).stdout, '');
          assert.strictEqual(sh(`${good}; ${check}; echo ran`).stdout, 'ran\n');
        }
      });
    }
    for (const [word, e] of never) {
      it(`says nothing about rm -rf ${word}: ${e} is never empty`, () => {
        assert.deepStrictEqual(notes(`rm -rf ${word}`), []);
        for (const empty of ['DIR=', 'unset DIR']) {
          const r = sh(`${empty}; v="${e}"; printf %s "$v"`);
          assert.ok(r.status !== 0 || r.stdout !== '', `${empty}: ${JSON.stringify(r)}`);
        }
      });
    }
  });

  // (The last line is the one checked; the lines before it set the state.)
  const lastLine = (src: string) => notes(src, src.split('\n').length - 1);
  for (const src of ['foo = 1', 'PATH = /bin', 'x =1', 'f() { :; }\nx = 1', 'DIR=$1\nrm -rf $DIR/*', 'if c; then DIR=/x; fi\nrm -rf $DIR/*', 'DIR=/x; read -r DIR\nrm -rf $DIR/*',
    'DIR=\nrm -rf $DIR/x', 'DIR=/x; source ./f\nrm -rf $DIR/*', 'D="$A$B"\nrm -rf $D/*', "D=''\nrm -rf $D/*"]) {
    it(`points out ${JSON.stringify(src)}`, () => assert.ok(lastLine(src).some((n) => /not an assignment|deleting from the root/.test(n)), lastLine(src).join('\n') || '(none)'));
  }
  // A name that runs something takes `=` as an argument: a builtin, a function, an alias, a program the dictionary knows.
  // A variable the script surely set to some text is never empty.
  for (const src of ['echo ===', 'echo ==========', 'sed = f', 'export = x', 'f() { local = x; }', 'f() { :; }\nf = 1', "shopt -s expand_aliases; alias a='echo'\na = 1",
    '. ./lib.sh\nsetup = 1', 'DIR=/opt/app\nrm -rf $DIR/*', 'BUILD_DIR="$SCRIPT_DIR/build"\nrm -rf $BUILD_DIR/*', "D=${A}'x'\nrm -rf $D/*", 'D=$A/x\nrm -rf $D/*', 'D=$A/x\nrm -rf $D/*', 'f() { D=/x; rm -rf $D/*; }']) {
    it(`says nothing about ${JSON.stringify(src)}`, () => assert.deepStrictEqual(lastLine(src).filter((n) => /not an assignment|deleting from the root/.test(n)), []));
  }
  it('the names bash runs with `=` as an argument run, and the others are not found', function () {
    if (spawnSync('bash', ['-c', ':']).status !== 0) return this.skip();
    const run = (cmd: string) => spawnSync('bash', ['--norc', '--noprofile', '-c', cmd], { encoding: 'utf8', input: 'a\n', env: { PATH: process.env.PATH, LC_ALL: 'C' } });
    for (const cmd of ['echo ===', 'sed = ', 'f() { :; }; f = 1', 'shopt -s expand_aliases\nalias a=:\na = 1']) assert.notStrictEqual(run(cmd).status, 127, cmd);
    // (`export = x`: a builtin, which rejects the name `=`; not a command that is not found.)
    assert.match(run('export = x').stderr, /not a valid identifier/);
    for (const cmd of ['x = 1', 'foo = 1']) assert.strictEqual(run(cmd).status, 127, cmd);
  });
  it('a path runs that file and a function its body, never the builtin of the name; the path of rm is rm', function () {
    if (spawnSync('bash', ['-c', ':']).status !== 0) return this.skip();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explain-bash-path-'));
    try {
      for (const f of ['read', 'cd', 'x']) fs.writeFileSync(path.join(dir, f), '#!/bin/sh\necho "file $0"\n', { mode: 0o755 });
      const run = (cmd: string) => spawnSync('bash', ['--norc', '--noprofile', '-c', cmd], { cwd: dir, encoding: 'utf8', input: 'a\\b\n', timeout: 10000, env: { PATH: process.env.PATH, LC_ALL: 'C' } }).stdout;
      assert.strictEqual(run('./read x; echo "[$x]"'), 'file ./read\n[]\n');
      assert.strictEqual(run('./cd /; pwd'), `file ./cd\n${fs.realpathSync(dir)}\n`);
      assert.strictEqual(run('./x = 1'), 'file ./x\n');
      assert.strictEqual(run('read() { echo fn; }; read x; echo "[$x]"'), 'fn\n[]\n');
      // (The builtin, for comparison: it takes the backslash as an escape.)
      assert.strictEqual(run('read x; echo "[$x]"'), '[ab]\n');
      assert.match(run('"$(type -P rm)" --version'), /^rm \(GNU coreutils\)/);
      assert.strictEqual(run('type -t "$(type -P rm)"'), 'file\n');
    } finally {
      fs.rmSync(dir, { recursive: true });
    }
  });
  // zsh (zshoptions: IGNORE_CLOSE_BRACES is off by default) closes a group at a `}` anywhere.
  it('a } with no ; before it closes the group in zsh', () => {
    assert.strictEqual(notes('{ echo a }', 0, 'en', 'bash').length, 1);
    assert.deepStrictEqual(notes('{ echo a }', 0, 'en', 'zsh'), []);
  });

  it('speaks Japanese, and only on the line where the construct starts', () => {
    assert.match(notes('x = 1', 0, 'ja')[0], /^⚠ 落とし穴: `x =…` は代入ではなく/);
    assert.deepStrictEqual(notes('for f in $(ls); do\n  echo "$f"\ndone', 1), []);
  });
});

/** The bashes the behaviour is checked with: the one on PATH (5.2), and bash 5.3 from `$BASH_EXPLAINER_BASH53` when set. */
const bashes = (): (string | undefined)[] => [undefined, ...(process.env.BASH_EXPLAINER_BASH53 ? [process.env.BASH_EXPLAINER_BASH53] : [])];

describe('a download run by a shell', () => {
  const download = /runs the script `(curl|wget)` downloads without anyone reading it/;
  const cases: [string, RegExp][] = [
    ['curl -fsSL https://example.com/install.sh | bash', /^⚠ Pitfall: `bash` runs the script `curl` downloads without anyone reading it, each line as it arrives: if the download breaks off, the lines that came still run, the last one perhaps cut short\. Download it to a file first \(`curl -o FILE …`\), check it, then run the file \(`bash FILE`\)$/],
    ['curl -fsSL https://x | sh -s -- --yes', /`sh` runs the script `curl` downloads/],
    ['curl -fsSL https://x | bash -s stable', /`bash` runs the script `curl` downloads/],
    ['curl -fsSL https://x | sudo -E bash -', /`bash` runs the script `curl` downloads/],
    ['wget -O- https://x | sh', /`sh` runs the script `wget` downloads.*\(`wget -O FILE …`\), check it, then run the file \(`sh FILE`\)$/],
    ['wget -qO- https://x | sudo bash', /`bash` runs the script `wget` downloads/],
    ['wget --output-document=- https://x | bash', /`bash` runs the script `wget` downloads/],
    ['curl -s https://x |\n  bash', /`bash` runs the script `curl` downloads/],
    // A process substitution is read from a pipe as the download goes; a string runs once the download has ended.
    ['bash <(curl -s https://x)', /`bash` runs the script `curl` downloads without anyone reading it, each line as it arrives/],
    ['source <(curl -s https://x)', /`source` runs the script `curl` downloads.*then run the file \(`source FILE`\)$/],
    ['sh -c "$(curl -fsSL https://x)"', /^⚠ Pitfall: `sh` runs the script `curl` downloads without anyone reading it: if the download breaks off, the part that came still runs\. Download it to a file first \(`curl -o FILE …`\), check it, then run the file \(`sh FILE`\)$/],
    ['bash -c "$(wget -qO- https://x)"', /`bash` runs the script `wget` downloads without anyone reading it: if/],
    ['eval "$(curl -fsSL https://x)"', /`eval` runs the script `curl` downloads.*then run the file \(`source FILE`\)$/],
    ['eval $(curl -s https://x)', /`eval` runs the script `curl` downloads/],
    // Where curl writes: `-o -` is stdout; an option it does not know changes nothing; stdin and stderr are not stdout.
    ['curl -s -o - https://x | bash', /`bash` runs the script `curl` downloads/],
    ['curl --nope=1 https://x | bash', /`bash` runs the script `curl` downloads/],
    ['curl -s -K - https://x <<< "" | bash 2> err', /`bash` runs the script `curl` downloads/],
  ];
  for (const [src, expected] of cases) {
    it(`points out ${JSON.stringify(src)}`, () => {
      const said = notes(src, src.split('\n').length - 1).filter((n) => download.test(n));
      assert.strictEqual(said.length, 1, notes(src).join('\n') || '(none)');
      assert.match(said[0], expected);
    });
  }
  // What is not run (a file, `-o`, `-O`, a pipe to another command), or not by a shell reading its script from the pipe.
  const fine = [
    'wget https://x | sh', 'curl -o i.sh https://x | bash', 'curl -O https://x | bash', 'curl -o "$f" https://x | bash', 'wget --spider https://x | sh',
    'curl https://x | bash script.sh', "curl https://x | bash -c 'cat'", 'curl https://x > f | bash', 'curl https://x | bash < f', 'curl https://x | jq .',
    'curl https://x | tee f', 'cat f | bash', 'bash <(echo hi)', 'bash <(curl -o f https://x)', 'sh -c "$(curl -o f https://x)"', 'sh -c "x $(curl https://x)"',
    'curl() { :; }; curl https://x | bash', 'bash() { :; }; curl https://x | bash', 'curl -fsSL https://x -o install.sh', "trap \"$(curl -s https://x)\" EXIT",
    "curl https://x | bash <<< 'echo'", 'curl https://x | bash <<EOF\necho\nEOF', 'bash -s | cat', '{ curl https://x; } | bash', 'sh -c "$cmd"', 'bash <(curl -s https://x; echo)',
  ];
  for (const src of fine) {
    it(`says nothing about ${JSON.stringify(src)}`, () => assert.deepStrictEqual(notes(src).filter((n) => download.test(n)), []));
  }
  it('suggests the command that runs a file in this shell for a string this shell runs', () => {
    assert.match(notes('eval "$(curl -s https://x)"', 0, 'en', 'bash')[0], /then run the file \(`source FILE`\)$/);
    assert.match(notes('eval "$(curl -s https://x)"', 0, 'en', 'sh')[0], /then run the file \(`\. FILE`\)$/);
  });
  it('speaks Japanese', () => {
    assert.deepStrictEqual(notes('curl -fsSL https://x | bash', 0, 'ja'), ['⚠ 落とし穴: `bash` は `curl` がダウンロードするスクリプトを、誰も読まないまま、届いた行から順に実行します。ダウンロードが途中で切れても、届いた行（途中で切れた最後の行も）は実行されます。先にファイルへダウンロードし（`curl -o ファイル …`）、中身を確かめてから実行します（`bash ファイル`）']);
  });

  // What the note says, in bash: a shell runs a script from a pipe as it arrives, and runs what came of a cut one.
  for (const program of bashes()) {
    const sh = (script: string) => runBash(script, { program, files: [] });
    it(`a shell runs each line of a script from a pipe as it arrives (${program ? 'bash 5.3' : 'bash'})`, () => {
      // (The first line has run before the rest is sent: the stage before waits for the file it makes.)
      const r = sh(`{ echo 'touch ran'; for i in $(seq 100); do [ -e ran ] && break; sleep 0.05; done; [ -e ran ] && echo 'echo early'; echo 'echo end'; } | ${program ?? 'bash'}`);
      assert.strictEqual(r.stdout, 'early\nend\n', r.stderr);
    });
    it(`a script cut short runs up to the cut, its last line too (${program ? 'bash 5.3' : 'bash'})`, () => {
      const cut = "printf 'echo one\\necho tw'";
      for (const run of [`${cut} | ${program ?? 'bash'}`, `${cut} | sh`, `${program ?? 'bash'} <(${cut})`, `sh -c "$(${cut}; exit 18)"`]) {
        assert.strictEqual(sh(run).stdout, 'one\ntw\n', run);
      }
    });
  }
});

describe('a trap that does not stop the script', () => {
  const goesOn = /bash runs this action and then goes on with the script from where it was/;
  it('says what bash does and how to stop, for one signal and for several', () => {
    assert.deepStrictEqual(notes("trap 'echo bye' INT"), ['ⓘ Caveat: when `INT` (Ctrl+C) comes, bash runs this action and then goes on with the script from where it was, so the script does not stop. To stop it, end the action with `exit 130` (128 + 2, the number of `INT`)']);
    assert.match(notes("trap 'rm -f \"$tmp\"' EXIT INT TERM").join('\n'), /when `INT` \(Ctrl\+C\) or `TERM` comes, .* end the action with `exit` and 128 \+ the signal's number, in a trap of each signal \(`exit 130` for `INT`, `exit 143` for `TERM`\)$/);
    assert.match(notes("trap 'echo bye' HUP")[0], /when `HUP` comes, .*`exit 129` \(128 \+ 1, the number of `HUP`\)$/);
    assert.deepStrictEqual(notes("trap 'echo bye' INT", 0, 'ja'), ['ⓘ 注意: `INT`（Ctrl+C）を受けると、bash はこの処理を実行したあと、スクリプトを中断したところから続けるので、スクリプトは止まりません。止めるには、処理の最後に `exit 130`（128 + `INT` の番号 2）を書きます']);
    assert.deepStrictEqual(notes("trap 'echo bye' TERM", 0, 'ja'), ['ⓘ 注意: `TERM` を受けると、bash はこの処理を実行したあと、スクリプトを中断したところから続けるので、スクリプトは止まりません。止めるには、処理の最後に `exit 143`（128 + `TERM` の番号 15）を書きます']);
    assert.deepStrictEqual(notes("trap 'echo bye' INT TERM", 0, 'ja'), ['ⓘ 注意: `INT`（Ctrl+C）・`TERM` を受けると、bash はこの処理を実行したあと、スクリプトを中断したところから続けるので、スクリプトは止まりません。止めるには、処理の最後に `exit` と 128 + シグナルの番号をシグナルごとの `trap` で書きます（`INT` は `exit 130`、`TERM` は `exit 143`）']);
    // An action of assignments, a function that calls itself, a program on a path: none ends the shell.
    for (const src of ["trap 'x=1' INT", 'f() { f; }; trap f INT', "trap '/usr/bin/echo bye' INT"]) assert.strictEqual(notes(src).filter((n) => goesOn.test(n)).length, 1, src);
    // (A definition with no body yet, as the fuzz test found: the action ends nothing that is known.)
    assert.strictEqual(notes('f()  f; }; trap f INT').filter((n) => goesOn.test(n)).length, 1);
  });
  // An action that ends the shell, one not known, or no action: nothing to say.
  const fine = [
    "trap 'echo bye; exit 130' INT", "trap 'echo bye; exit' INT TERM", "trap 'trap - INT; kill -s INT $$' INT", "trap 'kill -INT ${BASHPID}' INT", "trap 'exec sleep 1' INT",
    "trap '' INT", 'trap - INT', 'trap INT', "trap 'echo bye' EXIT", "trap 'echo bye' USR1", 'trap -p INT', 'trap "$cmd" INT', 'trap cleanup INT', "trap 'cleanup' TERM",
    'cleanup() { rm -f x; exit 1; }; trap cleanup INT TERM', 'f() { g; }; g() { exit 2; }; trap f INT', "shopt -s expand_aliases; alias q='exit 1'; trap q INT",
    'trap() { :; }; trap "echo x" INT', 'sudo trap "echo x" INT', 'f() { unknown_cmd; }; trap f INT', "trap 'echo x' \"$sig\"", "trap 'echo x' 10",
  ];
  for (const src of fine) {
    it(`says nothing about ${JSON.stringify(src)}`, () => assert.deepStrictEqual(notes(src).filter((n) => goesOn.test(n)), []));
  }
  // What bash does after each action for the signal: `after` is printed exactly when the note is said.
  const traps: [string, string][] = [
    ["trap 'echo caught' INT", 'INT'], ["trap 'echo caught' TERM", 'TERM'], ["trap 'echo caught' HUP", 'HUP'], ["trap 'echo caught' int", 'INT'],
    ["trap 'echo caught' 2", 'INT'], ["trap 'echo caught' SIGTERM", 'TERM'], ["trap 'echo caught' EXIT INT", 'INT'], ['f() { echo caught; }; trap f INT', 'INT'],
    ['f() { rm -f nofile; }; trap f TERM', 'TERM'], ["trap 'exec 2>&1' INT", 'INT'],
    ["trap 'echo caught; exit 130' INT", 'INT'], ["trap 'echo caught; exit' TERM", 'TERM'], ["trap 'trap - INT; kill -s INT $$' INT", 'INT'],
    ['f() { echo caught; exit 1; }; trap f INT TERM', 'TERM'], ['f() { g; }; g() { exit 2; }; trap f INT', 'INT'], ["trap 'exec echo replaced' INT", 'INT'],
  ];
  for (const program of bashes()) {
    for (const [src, sig] of traps) {
      it(`${src}, then ${sig}: ${program ? 'bash 5.3' : 'bash'} goes on exactly when the note says so`, () => {
        const said = notes(src).some((n) => goesOn.test(n));
        const r = runBash(`${src}\nkill -s ${sig} $$\necho after`, { program });
        // (An EXIT trap runs again at the end.)
        assert.strictEqual(r.stdout.includes('after\n'), said, `${JSON.stringify(r)}`);
      });
    }
    it(`exit 130 in the action ends the script with 130 (${program ? 'bash 5.3' : 'bash'})`, () => {
      assert.strictEqual(runBash("trap 'exit 130' INT; kill -s INT $$; echo after", { program }).status, 130);
    });
  }
});

describe('the spacing of [ ], against bash', () => {
  const bash = (cmd: string) => spawnSync('bash', ['-c', cmd], { encoding: 'utf8' });
  const have = spawnSync('bash', ['-c', ':']).status === 0;
  const cases: [string, 'ok' | 'fails'][] = [
    ['[ -d / ]', 'ok'], ['[-d /]', 'fails'], ['[ -d /]', 'fails'], ['[ -d / ]', 'ok'], ['[ -d / ] && [ -d /tmp ]', 'ok'],
    ['[ -d / && -d /tmp ]', 'fails'], ['a=1; b=2; [ $a < $b ]', 'fails'], ['a=1; b=2; [ "$a" \\< "$b" ]', 'ok'], ['a=; [ $a = x ]', 'fails'],
  ];
  for (const [cmd, expected] of cases) {
    it(`${cmd}: ${expected}`, function () {
      if (!have) return this.skip();
      const r = bash(cmd);
      // `ok` runs without a syntax or usage error (a false test is status 1 with no message); `fails` prints an error.
      if (expected === 'ok') assert.ok(r.status !== null && r.stderr === '', r.stderr);
      else assert.ok(r.stderr !== '' || r.status === 127, `${r.status} ${r.stderr}`);
      // The tool finds the same mistake.
      const one = cmd.replace(/^a=.*?; /, '').replace(/^a=1; b=2; /, '');
      // (`[ -d /]`: the analyzer says that `[` fails, a fact of the model.)
      const failsNote = new Analyzer('en').explainLine(parser.parse(one), 0, 'bash').facts?.some((f) => /^bracket-|^test-malformed$/.test(f.id));
      const mistakes = notes(one).length > 0 || failsNote || (() => { const t = parser.parse(one); return wordFacts(t.root, 0, 'en', shellState(t)); })().length > 0;
      if (expected === 'fails') assert.ok(mistakes, cmd);
    });
  }
});

// The setting `notes.pitfalls` is applied where a note is said (Analyzer.say), by the pitfall kind of its catalog entry.
describe('the pitfall gate', () => {
  const explainNotes = (src: string, line: number, pitfalls: boolean) =>
    new Analyzer('en').explainLine(parser.parse(src), line, undefined, { pitfalls }).notes;

  it('the [[ =~ ]] backslash note disappears with pitfalls off; bash does read \\b as b', () => {
    const src = '[[ $x =~ \\bfoo ]]';
    assert.ok(explainNotes(src, 0, true).some((n) => /^⚠ In `\[\[ =~ \]\]`, an unquoted `\\b` loses its backslash/.test(n)));
    assert.deepStrictEqual(explainNotes(src, 0, false).filter((n) => /⚠/.test(n)), []);
    const r = spawnSync('bash', ['--norc', '--noprofile', '-c', "x=bfoo; [[ $x =~ \\bfoo ]] && echo match"], { encoding: 'utf8', env: { PATH: process.env.PATH, LC_ALL: 'C' } });
    assert.strictEqual(r.stdout.trim(), 'match');
  });
  it('the distro-alias note of ll disappears with pitfalls off; a README keeps its ℹ note', () => {
    assert.ok(explainNotes('ll /tmp', 0, true).some((n) => /^⚠ System-dependent: `ll`/.test(n)));
    assert.deepStrictEqual(explainNotes('ll /tmp', 0, false).filter((n) => /System-dependent/.test(n)), []);
    const readme = new Analyzer('en').explainLine(parser.parse('ll /tmp'), 0, undefined, { pitfalls: false, host: { kind: 'markdown' } }).notes;
    assert.ok(readme.some((n) => /^ℹ System-dependent: `ll`/.test(n)));
  });
  it('the distro-alias note says "an alias" and "a function"; a quoted name is no alias, so it gets no note', () => {
    const n = (src: string) => explainNotes(src, 0, true).filter((x) => /System-dependent/.test(x));
    assert.match(n('ll /tmp')[0], /^⚠ System-dependent: `ll` is an alias Ubuntu, /);
    assert.match(n('remount ro /')[0], /^⚠ System-dependent: `remount` is a function openSUSE defines /);
    assert.match(n('x=1 ll')[0], /is an alias/);
    // (Bash looks up no alias for a quoted or escaped word: `"+"` is a plain command name, here as in `ls "+"`.)
    for (const src of ['"+"', '"ll" /tmp', "'ll' /tmp", '\\ll /tmp', '"l."', 'ls "+"', 'echo ll', 'sudo ll', 'command ll']) assert.deepStrictEqual(n(src), [], src);
    // A function of a system is called by its quoted name too.
    assert.match(n('"remount" ro /')[0], /is a function/);
    // The README note reads the same.
    const readme = (src: string) => new Analyzer('en').explainLine(parser.parse(src), 0, undefined, { pitfalls: false, host: { kind: 'markdown' } }).notes;
    assert.match(readme('remount ro /')[0], /^ℹ System-dependent: `remount` is a function /);
    assert.deepStrictEqual(readme('"ll" /tmp').filter((x) => /System-dependent/.test(x)), []);
    const ja = new Analyzer('ja').explainLine(parser.parse('remount ro /'), 0, undefined, { pitfalls: true }).notes;
    assert.ok(ja.some((x) => /^⚠ 環境依存: `remount` は openSUSE が対話シェル用に定義する関数で/.test(x)), ja.join('|'));
  });
  it('a syntax error is not a pitfall: the missing then stays with pitfalls off', () => {
    const notes = explainNotes('if [ -f a ] then echo x; fi', 0, false);
    assert.ok(notes.some((n) => /Syntax error: a `;` or a newline is needed before `then`/.test(n)), notes.join('|'));
  });

  // A host file (src/hosts.ts): every note of a line, with the setting on or off.
  const hostNotes = (file: string, pitfalls: boolean, lang: 'en' | 'ja' = 'en') => {
    const src = fs.readFileSync(path.join(root, 'test/fixtures/hosts', file), 'utf8');
    const kind = hostKind('', file, src)!;
    const extracted = extractShell(kind, src);
    const tree = parser.parse(extracted.text);
    const lines = src.split('\n');
    return lines.flatMap((_, i) => explainHostedLine(new Analyzer(lang), tree, extracted, lines, i, lang, undefined, { pitfalls })?.notes ?? []);
  };
  const has = (notes: string[], re: RegExp) => notes.some((n) => re.test(n));
  for (const [file, name, re] of [
    ['Dockerfile', 'the Dockerfile pipefail note', /^ⓘ If a command in the middle of the pipe fails, RUN still succeeds/],
    ['deploy.py', 'the Python string-without-shell note', /^⚠ Without shell=True the whole string/],
    ['deploy.py', 'the Python shell injection note', /^⚠ Shell injection risk: the shell runs a string/],
    ['action.yml', 'the Actions script injection note', /^⚠ Script injection risk: `github\.event\.pull_request\.title`/],
    ['test.bats', 'a bats pitfall', /^⚠ Pitfall: /],
  ] as const) {
    it(`${name} disappears with pitfalls off, and is the same text with them on`, () => {
      assert.ok(has(hostNotes(file, true), re));
      assert.ok(!has(hostNotes(file, false), re));
      // (A pipeline's failure that goes unnoticed is a caveat: docs/design/note-levels.md.)
      assert.ok(has(hostNotes(file, true, 'ja'), file === 'Dockerfile' ? /^ⓘ / : /^⚠ /));
    });
  }
  it('said keeps the notes with pitfalls off and the pitfalls with them on', () => {
    const fs2 = [fact('en', 'exit-modulo', { command: 'exit', value: '256', status: 0, ends: 'shell' }), fact('en', 'local-outside-function', { stops: false })];
    assert.deepStrictEqual(said(fs2, false).map((f) => f.id), ['exit-modulo']);
    assert.deepStrictEqual(said(fs2, true).map((f) => f.id), ['exit-modulo', 'local-outside-function']);
    assert.deepStrictEqual(said(fs2, undefined).length, 2);
  });
  it('only a pitfall has a heading in the catalog', () => {
    for (const [id, e] of Object.entries(MESSAGES) as [FactId, { kind: string; heading?: unknown }][]) {
      if (e.heading) assert.strictEqual(e.kind, 'pitfall', id);
    }
  });
});

/** bash on PATH, and bash 5.3 when `$BASH_EXPLAINER_BASH53` names one. */
const BASHES = ['bash', ...(process.env.BASH_EXPLAINER_BASH53 ? [process.env.BASH_EXPLAINER_BASH53] : [])];

describe('pitfalls: a file sourced by a name with no `/`', () => {
  const found = (src: string, lang: 'en' | 'ja' = 'en', shell?: Shell) => notes(src, src.split('\n').length - 1, lang, shell).filter((n) => /`\$PATH`/.test(n));
  it('says that bash looks in PATH first, then in the current directory, in both languages', () => {
    assert.deepStrictEqual(found('source lib.sh'), ['ⓘ Caveat: `source lib.sh` looks for `lib.sh` in the directories of `$PATH` first, and only then in the current directory: a file of that name in `$PATH` runs instead, and the current directory is where the script was started from, not where it lies (cron starts in `$HOME`). Write `source ./lib.sh`, or a path from the script\'s directory: `source "$(dirname "$0")/lib.sh"`']);
    assert.deepStrictEqual(found('source lib.sh', 'ja'), ['ⓘ 注意: `source lib.sh` は `lib.sh` をまず `$PATH` のディレクトリから探し、見つからないときだけカレントディレクトリを探します。`$PATH` に同じ名前のファイルがあればそちらが実行され、カレントディレクトリはスクリプトの場所ではなく、起動したときの場所です（cron なら `$HOME`）。`source ./lib.sh` か、スクリプトのディレクトリからのパス（`source "$(dirname "$0")/lib.sh"`）を書きます']);
    assert.strictEqual(found('source lib.sh', 'en', 'bash').length, 1);
    assert.strictEqual(found('shopt -s sourcepath\nsource lib.sh').length, 1);
    // (`command` and `builtin` run the builtin in this shell.)
    assert.strictEqual(found('command source lib.sh').length, 1);
    assert.strictEqual(found('builtin . lib.sh').length, 1);
    assert.match(found('[ -f lib.sh ] && . "lib.sh"')[0], /^ⓘ Caveat: `\. lib\.sh` looks for `lib\.sh` in the directories of `\$PATH` first.* Write `\. \.\/lib\.sh`/);
  });
  it('says that only PATH is searched in POSIX mode and in sh', () => {
    for (const [src, shell] of [['set -o posix\n. lib.sh', undefined], ['. lib.sh', 'sh'], ['. lib.sh', 'dash'], ['. lib.sh', 'ash']] as const) {
      assert.match(found(src, 'en', shell)[0], /`\. lib\.sh` looks for `lib\.sh` only in the directories of `\$PATH`, not in the current directory \(as POSIX says\): it fails unless `\$PATH` has it/, src);
    }
    assert.match(found('. lib.sh', 'ja', 'sh')[0], /`\$PATH` のディレクトリからだけ探し、カレントディレクトリは探しません（POSIX の動作）。`\$PATH` になければ失敗し/);
  });
  // A path, a name not known, `-p` (bash 5.3), sourcepath off or not known to be on, a function named source.
  for (const src of ['source ./lib.sh', 'source /etc/profile', 'source "$f"', 'source ~/.bashrc', 'source "$(dirname "$0")/lib.sh"', 'source -p /x lib.sh', 'shopt -u sourcepath\nsource lib.sh',
    'if c; then shopt -u sourcepath; fi\nsource lib.sh', 'source() { :; }\nsource lib.sh', 'echo source lib.sh', 'source', 'sudo source lib.sh']) {
    it(`says nothing about ${JSON.stringify(src)}`, () => assert.deepStrictEqual(found(src), []));
  }
  it('says nothing in zsh or ksh, whose `.` searches otherwise', () => {
    assert.deepStrictEqual(found('. lib.sh', 'en', 'zsh'), []);
    assert.deepStrictEqual(found('. lib.sh', 'en', 'ksh'), []);
  });
  // A file of the name in PATH runs before the one in the current directory; with sourcepath off, or with `./`, the
  // current directory's; in POSIX mode, only PATH; started from another directory, the script's own directory finds its file.
  for (const program of BASHES) {
    it(`agrees with ${program === 'bash' ? 'bash' : 'bash 5.3'}`, function () {
      if (runBash(':', { program }).status !== 0) return this.skip();
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explain-bash-source-'));
      try {
        fs.mkdirSync(path.join(dir, 'bin'));
        fs.mkdirSync(path.join(dir, 'empty'));
        fs.writeFileSync(path.join(dir, 'bin', 'lib.sh'), 'echo from-PATH\n');
        fs.writeFileSync(path.join(dir, 'lib.sh'), 'echo from-cwd\n');
        fs.writeFileSync(path.join(dir, 's.sh'), 'source "$(dirname "$0")/lib.sh"\nsource lib.sh\n');
        const run = (script: string, bin = 'bin', posix = false) => runBash(script, { program, cwd: dir, posix, env: { PATH: `${path.join(dir, bin)}:/usr/bin:/bin` } });
        assert.strictEqual(run('[ -f lib.sh ] && source lib.sh').stdout, 'from-PATH\n');
        assert.strictEqual(run('. lib.sh').stdout, 'from-PATH\n');
        assert.strictEqual(run('command source lib.sh; builtin . lib.sh').stdout, 'from-PATH\nfrom-PATH\n');
        assert.strictEqual(run('shopt -u sourcepath; source lib.sh').stdout, 'from-cwd\n');
        assert.strictEqual(run('source ./lib.sh').stdout, 'from-cwd\n');
        assert.strictEqual(run('source lib.sh', 'empty').stdout, 'from-cwd\n');
        assert.strictEqual(run('. lib.sh', 'bin', true).stdout, 'from-PATH\n');
        const posix = run('. lib.sh', 'empty', true);
        assert.strictEqual(posix.stdout, '');
        assert.match(posix.stderr, /lib\.sh: file not found/);
        const away = runBash(`cd / && "$0" ${JSON.stringify(path.join(dir, 's.sh'))}`, { program, env: { PATH: `${path.join(dir, 'empty')}:/usr/bin:/bin` } });
        assert.strictEqual(away.stdout, 'from-cwd\n');
        assert.match(away.stderr, /lib\.sh: No such file or directory/);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  }
});

describe('pitfalls: a regex pattern that is a variable', () => {
  const found = (src: string, lang: 'en' | 'ja' = 'en') => notes(src, src.split('\n').length - 1, lang).filter((n) => /regular expression|正規表現/.test(n));
  it('says that the value is read as a regex, in both languages', () => {
    assert.deepStrictEqual(found('grep "$USER" /etc/passwd'), ['ⓘ Caveat: `grep` reads the value of `$USER` as a regular expression, not as plain text: it matches inside longer text too (`bob` matches `bobby`), and `.`, `*`, `[` and the like in the value have their special meaning. To look for the value as it is, add `-F`, and `-w` (whole words) or `-x` (whole lines) as meant']);
    assert.deepStrictEqual(found('grep "$USER" /etc/passwd', 'ja'), ['ⓘ 注意: `grep` は `$USER` の値を、ただの文字列ではなく正規表現として読みます。長い文字列の一部にも一致し（`bob` は `bobby` にも一致）、値の中の `.`・`*`・`[` などは特別な意味を持ちます。値をそのまま探すには `-F` を付け、意図に合わせて `-w`（単語全体）か `-x`（行全体）も付けます']);
    for (const src of ['grep -e "$x" f', 'grep -ve "$x" f', 'grep -c ${x} f', 'ps aux | grep "$name"', 'sudo grep -q "$entry" /etc/hosts', 'x=bob\ngrep "$x" f', 'grep -i -- "$x" f',
      // (An option grep does not know; a value not trusted after `eval`.)
      'grep --bogus "$x" f', 'eval "$y"\nx="a.*"\ngrep "$x" f']) {
      assert.strictEqual(found(src).length, 1, src);
    }
    // (`egrep -F` is refused, and `-F` with `-E` or `-P` by older greps: `-F` goes in their place.)
    assert.match(found('grep -E "$x" f')[0], /To look for the value as it is, write `-F` in place of `-E`, and/);
    assert.match(found('grep -iP "$x" f')[0], /write `-F` in place of `-P`/);
    assert.match(found('egrep "$x" f')[0], /^ⓘ Caveat: `egrep` reads the value of `\$x`.* use `grep -F` in place of `egrep`, and/);
    assert.match(found('egrep "$x" f', 'ja')[0], /`egrep` の代わりに `grep -F` を使い、/);
  });
  // A fixed string, whole words or lines, a pattern with text of its own, a positional parameter, a variable named as a
  // pattern or holding special characters, an expansion with an operator, a function named grep, a pattern from a file.
  for (const src of ['grep -F "$x" f', 'grep --fixed-strings "$x" f', 'fgrep "$x" f', 'grep -w "$x" f', 'grep -x "$x" f', 'grep -Fx -- "$x" f', 'grep --word-regexp "$x" f',
    'grep "^$USER:" f', 'grep "$1" f', 'grep "$@" f', 'grep "$pattern" f', 'grep "$re" f', 'grep "$EXPR" f', 'x="a.*b"\ngrep "$x" f', 'grep "${x:-y}" f', 'grep "${a[0]}" f', 'grep "${#x}" f', 'grep "${!x}" f', 'grep "${1}" f',
    'grep() { :; }\ngrep "$x" f', 'grep -f "$x" f', 'grep foo "$x"', 'echo "$x"', 'grep -E -F "$x" f']) {
    it(`says nothing about ${JSON.stringify(src)}`, () => assert.deepStrictEqual(found(src), []));
  }
  // GNU grep: a value matches inside longer text, and its regex characters are special; `-F`, `-w` and `-x` as said.
  it('agrees with grep', function () {
    if (spawnSync('grep', ['--version']).status !== 0) return this.skip();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explain-bash-grep-'));
    try {
      fs.writeFileSync(path.join(dir, 'passwd'), 'bobby:x:1001\nbob:x:1000\n');
      fs.writeFileSync(path.join(dir, 'dots'), 'abc\na.c\n');
      const grep = (...args: string[]) => spawnSync('grep', args, { cwd: dir, encoding: 'utf8', env: { LC_ALL: 'C', PATH: process.env.PATH } });
      assert.strictEqual(grep('bob', 'passwd').stdout, 'bobby:x:1001\nbob:x:1000\n');
      assert.strictEqual(grep('-e', 'bob', 'passwd').stdout, 'bobby:x:1001\nbob:x:1000\n');
      assert.strictEqual(grep('-F', 'bob', 'passwd').stdout, 'bobby:x:1001\nbob:x:1000\n');
      assert.strictEqual(grep('-Fw', 'bob', 'passwd').stdout, 'bob:x:1000\n');
      assert.strictEqual(grep('a.c', 'dots').stdout, 'abc\na.c\n');
      assert.strictEqual(grep('-F', 'a.c', 'dots').stdout, 'a.c\n');
      assert.strictEqual(grep('-Fx', 'a.c', 'dots').stdout, 'a.c\n');
      assert.strictEqual(grep('[', 'dots').status, 2);
      assert.strictEqual(grep('-F', '[', 'dots').status, 1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the rewrites of the style checks (docs/design/oracles.md, step 6)', () => {
  // (The input, the check, and the script each rewrite makes, the first recommended; none where it carries none.
  // test/rewrites-corpus.test.ts runs them in bash over the states of each check.)
  const cases: [string, StyleCode, string[]][] = [
    ['[-f x]', 'bracket-no-space', ['[ -f x ]']],
    ['[-f x ] && echo y', 'bracket-no-space', ['[ -f x ] && echo y']],
    ['[[-f x]]', 'bracket-no-space', ['[[ -f x ]]']],
    // (An escaped `]`, or one that is not the opener's: no rewrite.)
    ['[-f x\\]', 'bracket-no-space', []],
    ['[[-f x]', 'bracket-no-space', []],
    ['x = 1', 'assignment-with-spaces', ['x=1']],
    ['x =1', 'assignment-with-spaces', ['x=1']],
    ['x =', 'assignment-with-spaces', ['x=']],
    ['x = 1 >f', 'assignment-with-spaces', ['x=1 >f']],
    // (Several words: no one value; a redirection among them.)
    ['x = a b', 'assignment-with-spaces', []],
    ['x =a b', 'assignment-with-spaces', []],
    ['x = >f 1', 'assignment-with-spaces', []],
    ['{echo a;}', 'brace-no-space', ['{ echo a;}']],
    ['{echo a\n}', 'brace-no-space', ['{ echo a\n}']],
    ['{echo a }', 'brace-no-space', ['{ echo a; }']],
    ['{a }', 'brace-no-space', ['{ a; }']],
    ['{echo a}', 'brace-no-space', ['{ echo a; }']],
    ['{oops', 'brace-no-space', []],
    ['{echo a\\}', 'brace-no-space', []],
    ['{ echo a; echo b }', 'brace-close-no-separator', ['{ echo a; echo b; }']],
    ['{ echo a; echo b >f }', 'brace-close-no-separator', ['{ echo a; echo b >f; }']],
    ['rm -rf $DIR/*', 'rm-empty-variable-root', ['rm -rf "${DIR:?}"/*']],
    // (A check before the statement, where it stands alone: not in a list nor a condition.)
    ['rm -rf ${D%/}/x', 'rm-empty-variable-root', ['[ -n "${D%/}" ] || exit 1\nrm -rf ${D%/}/x']],
    ['rm -rf ${D%/}/x 2>/dev/null', 'rm-empty-variable-root', ['[ -n "${D%/}" ] || exit 1\nrm -rf ${D%/}/x 2>/dev/null']],
    ['f() { rm -rf ${D%/}/x; }', 'rm-empty-variable-root', ['f() { [ -n "${D%/}" ] || exit 1; rm -rf ${D%/}/x; }']],
    ['if :; then rm -rf ${D%/}/x; fi', 'rm-empty-variable-root', ['if :; then [ -n "${D%/}" ] || exit 1; rm -rf ${D%/}/x; fi']],
    ['case a in a) rm -rf ${D%/}/x ;; esac', 'rm-empty-variable-root', ['case a in a) [ -n "${D%/}" ] || exit 1; rm -rf ${D%/}/x ;; esac']],
    ['a && rm -rf ${D%/}/x', 'rm-empty-variable-root', []],
    ['if rm -rf ${D%/}/x; then :; fi', 'rm-empty-variable-root', []],
    ['rm -rf ${D%/}/x | cat', 'rm-empty-variable-root', []],
    ['read x', 'read-without-r', ['read -r x']],
    ['IFS= read -a x', 'read-without-r', ['IFS= read -r -a x']],
    ['[ $a < $b ]', 'redirect-in-bracket', ['[ $a \\< $b ]']],
    ['[ $a>$b ]', 'redirect-in-bracket', ['[ $a \\> $b ]']],
    ['[ 5>3 ]', 'redirect-in-bracket', ['[ 5 \\> 3 ]']],
    // (No comparison of three words; not `>>`; another redirection; no `]`.)
    ['[ $a 2>5 ]', 'redirect-in-bracket', []],
    ['[ a b < c ]', 'redirect-in-bracket', []],
    ['[ a < b c ]', 'redirect-in-bracket', []],
    ['[ a >> b ]', 'redirect-in-bracket', []],
    ['[ a < b > c ]', 'redirect-in-bracket', []],
    ['[ a < b ] x', 'redirect-in-bracket', []],
    ['[ -f $x]', 'bracket-close-in-word', ['[ -f $x ]']],
    ['[ -n "$x"]', 'bracket-close-in-word', ['[ -n "$x" ]']],
    ['[ $x$y]', 'bracket-close-in-word', ['[ $x$y ]']],
    ['[ "$x"\\]', 'bracket-close-in-word', []],
    ['[ -n $(f)x\\]', 'bracket-close-in-word', []],
    ['[ a && b ]', 'and-or-in-bracket', ['[ a ] && [ b ]']],
    ['[ -n "$a" || -n "$b" ]', 'and-or-in-bracket', ['[ -n "$a" ] || [ -n "$b" ]']],
  ];
  const found = (src: string, code: StyleCode, lang: 'en' | 'ja' = 'en') => {
    const tree = parser.parse(src);
    return pitfallFindings(tree.root, lang, 0, 100, shellState(tree, undefined), undefined).filter((f) => f.code === code);
  };
  for (const [src, code, scripts] of cases) {
    it(`${code}: ${JSON.stringify(src)}`, () => {
      const [f, ...more] = found(src, code);
      assert.ok(f && !more.length, `one finding of ${code}`);
      assert.deepStrictEqual((f.rewrite ?? []).map((r) => applied(src, r)), scripts);
      // (The text shows the code of the first: one source.)
      if (f.rewrite) assert.ok(f.text.includes(`\`${f.rewrite[0].code}\``) || f.rewrite[0].code.includes('\n'), f.text);
      // (In Japanese the same.)
      const [j] = found(src, code, 'ja');
      if (j.rewrite) assert.ok(j.text.includes(`\`${j.rewrite[0].code}\``) || j.rewrite[0].code.includes('\n'), j.text);
    });
  }
  it('shows the form of the rewrite where it has none', () => {
    assert.match(found('[-f x\\]', 'bracket-no-space')[0].text, /Write `\[ -f …`$/);
    assert.match(found('[[-f x]', 'bracket-no-space')[0].text, /`\[\[` is a reserved word only as a word of its own.*Write `\[\[ -f …`$/);
    assert.match(found('x = a b', 'assignment-with-spaces')[0].text, /Write `x=…` with no spaces/);
    assert.match(found('{oops', 'brace-no-space')[0].text, /`\{ oops …; \}`$/);
    assert.match(found('{echo a\n}', 'brace-no-space')[0].text, /`\{ echo …; \}`$/);
    assert.match(found('[ $a 2>5 ]', 'redirect-in-bracket')[0].text, /Use `\[\[ \]\]` to compare strings by order, or escape it as `\\>`$/);
    assert.match(found('[ "$x"\\]', 'bracket-close-in-word')[0].text, /needs a space before it$/);
    assert.match(found('a && rm -rf ${D%/}/x', 'rm-empty-variable-root')[0].text, /Write `\[ -n "\$\{D%\/\}" \] \|\| exit 1` before it/);
  });
  it('carries no rewrite in a string another shell reads, whose text shows it still', () => {
    const tree = parser.parse("bash -c 'read x'");
    const lines = new Analyzer('en').explainLine(tree, 0);
    assert.ok(lines.notes.some((n) => /Usually write `read -r`/.test(n)), lines.notes.join('\n'));
  });
  it('says the check `rm -r` needs once it is there', () => {
    // (The check the note says to write, or `[ -n "$v" ] || exit 1`, `test -n`, `return`, before it in the same list.)
    for (const src of ['[ -n "${D%/}" ] || exit 1\nrm -rf ${D%/}/x', '[ -n "$D" ] || exit 1\nrm -rf $D/x', 'test -n "${D}" || return\ncd x\nrm -rf $D/x',
      '[ "$#" -gt 0 ] || exit 1\nrm -rf $@/x', 'f() {\n  [ -n "$D" ] || return 1\n  rm -rf "$D"/*\n}']) {
      assert.deepStrictEqual(found(src, 'rm-empty-variable-root'), [], src);
    }
    // (Not after another check, nor where the variable is set between.)
    for (const src of ['[ -n "$D" ] && exit 1\nrm -rf $D/x', '! [ -n "$D" ] || exit 1\nrm -rf $D/x', '[ -n "$D" ] || { exit 1; }\nrm -rf $D/x', '[ -z "$D" ] || exit 1\nrm -rf $D/x',
      '[ -n "$E" ] || exit 1\nrm -rf $D/x', '[ -n "$D" ] || echo\nrm -rf $D/x', '[ -n "$D" x ] || exit 1\nrm -rf $D/x', 'test -n "$D" x || exit 1\nrm -rf $D/x', 'echo -n "$D" || exit 1\nrm -rf $D/x',
      '[ -n "$D" ] || exit 1\nD=\nrm -rf $D/x', '[ -n "$D" ] || exit 1\nread D\nrm -rf $D/x', '[ -n "$D" ] || exit 1\nfor D in a; do :; done\nrm -rf $D/x', '[ -n "${D%/}" ] || exit 1\nrm -rf $D/x']) {
      assert.strictEqual(found(src, 'rm-empty-variable-root').length, 1, src);
    }
  });
});
