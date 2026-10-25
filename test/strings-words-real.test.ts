// Explanations of words and of strings another shell runs, compared with bash 5.2 and GNU xargs: the positional
// parameters of a `sh -c` string, the parts of a sequence of braces, a `NAME=VALUE` that bash passes as an
// argument (`command declare k=1`), a function that a sourced file may define, and `xargs -d`.
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runBash } from './support/bash';
import { allTokens, explain } from './support/explain';
import { run } from './support/run';

const tokens = (src: string, line = 0, lang: 'en' | 'ja' = 'en') => allTokens(explain(src, line, lang).items);
const textOf = (src: string, label: string, line = 0, lang: 'en' | 'ja' = 'en') => tokens(src, line, lang).filter((t) => t.label === label).map((t) => t.explanation);

describe('the positional parameters of a string a shell runs', () => {
  it('says whose they are, and the word each starts as', () => {
    assert.strictEqual(runBash('sh -c \'printf "%s|%s|%s\\n" "$0" "$1" "$2"\' sh hello').stdout, 'sh|hello|\n');
    const src = 'sudo sh -c \'printf "%s\\n" "$1" > /etc/motd\' sh "$msg"';
    assert.deepStrictEqual(textOf(src, '$1'), ['Positional parameter: argument #1 of the `sh -c` string (it starts as `"$msg"`)']);
    assert.deepStrictEqual(textOf(src, '$1', 0, 'ja'), ['位置パラメータ: `sh -c` の文字列への 1 番目の引数（最初は `"$msg"`）']);
    // (With no word after the string, `$0` is the shell's name, as for any script.)
    assert.strictEqual(textOf('bash -c \'echo "$0"\'', '$0')[0], textOf('echo "$0"', '$0')[0]);
    const all = 'bash -c \'echo "$0 $1 $2"\' name a';
    assert.strictEqual(runBash(all).stdout, 'name a \n');
    assert.deepStrictEqual(['$0', '$1', '$2'].map((v) => textOf(all, v)[0]), [
      '`$0` of the `bash -c` string: the name given after it, `name` (shown in error messages)',
      'Positional parameter: argument #1 of the `bash -c` string (it starts as `a`)',
      'Positional parameter: argument #2 of the `bash -c` string (none is given, so it starts empty)',
    ]);
  });

  it('leaves the arguments of a function the string defines, and the words after a list of unknown length', () => {
    const fn = 'bash -c \'g() { echo "$1"; }; g x; echo "$1"\' _ top';
    assert.strictEqual(runBash(fn).stdout, 'x\ntop\n');
    assert.deepStrictEqual(textOf(fn, '$1'), ['Positional parameter: argument #1', 'Positional parameter: argument #1 of the `bash -c` string (it starts as `top`)']);
    // (`"$@"` may be any number of words: what follows it is known only when it runs.)
    assert.deepStrictEqual(textOf('bash -c \'echo "$2"\' _ "$@" b', '$2'), ['Positional parameter: argument #2 of the `bash -c` string']);
    assert.strictEqual(runBash('set -- x y; bash -c \'echo "$2"\' _ "$@" b').stdout, 'y\n');
  });
});

describe('the parts of a sequence of braces', () => {
  const parts = (src: string) => tokens(src).filter((t) => t.kind === 'number' || (t.kind === 'string' && /^(Start|End)/.test(t.explanation))).map((t) => `${t.label}: ${t.explanation}`);

  it('names the start, the end and the increment, as bash reads them', () => {
    assert.strictEqual(runBash('echo {1..10..3}; echo {1..10..-3}; echo {10..1..3}; echo {1..10..4}; echo {01..10}; echo {a..k..2}; echo {1..5..0}').stdout,
      '1 4 7 10\n1 4 7 10\n10 7 4 1\n1 5 9\n01 02 03 04 05 06 07 08 09 10\na c e g i k\n1 2 3 4 5\n');
    assert.deepStrictEqual(parts('echo {1..10..3}'), ['1: Start: `1`', '10: End: `10`', '3: Increment: `3` (each word is 3 more than the one before)']);
    assert.deepStrictEqual(parts('echo {1..10..-3}').slice(2), ['-3: Increment: `-3` (each word is 3 more than the one before); its sign does not count: the start and the end set the direction']);
    assert.deepStrictEqual(parts('echo {10..1..3}').slice(2), ['3: Increment: `3` (each word is 3 less than the one before)']);
    assert.deepStrictEqual(parts('echo {1..10..4}')[1], '10: End: `10` (the steps do not land on it: the last word is `9`)');
    assert.deepStrictEqual(parts('echo {01..10}'), ['01: Start: `01`; it has a leading 0, so every number is padded with zeros to the same width', '10: End: `10`']);
    assert.deepStrictEqual(parts('echo {a..k..2}'), ['a: Start: `a`', 'k: End: `k`', '2: Increment: `2` (every 2nd letter, counting up)']);
    assert.deepStrictEqual(parts('echo {1..5..0}').slice(2), ['0: Increment: `0` (each word is 1 more than the one before); 0 counts as 1']);
    assert.deepStrictEqual(parts('echo {1..10..3}').map((p) => p.split(': ')[0]), ['1', '10', '3']);
    assert.match(textOf('echo {1..10..3}', '3', 0, 'ja')[0], /^増分: `3`（単語ごとに 3 増える）$/);
    // (Not a sequence: `{1..b}` stays as it is.)
    assert.strictEqual(runBash('echo {1..b} {a..1} {k..a..5}').stdout, '{1..b} {a..1} k f a\n');
    assert.deepStrictEqual(parts('echo {1..b} {a..1}'), []);
    assert.strictEqual(runBash('echo {1..b}{x,y}').stdout, '{1..b}x {1..b}y\n');
    assert.deepStrictEqual(parts('echo {1..b}{x,y}'), []);
    assert.deepStrictEqual(parts('echo {k..a..5}')[2], '5: Increment: `5` (every 5th letter, counting down)');
    assert.deepStrictEqual(parts('echo {a..c..1}')[2], '1: Increment: `1` (each letter, counting up)');
    assert.strictEqual(runBash('echo {a..c..1}').stdout, 'a b c\n');
  });

  it('puts them in the Reading view under the braces', () => {
    const e = explain('echo x{1..3}y', 0, 'en', { reading: true });
    const outline: string[] = [];
    const walk = (n: typeof e.reading, d: number): void => {
      outline.push(`${'  '.repeat(d)}${n!.layer}/${n!.kind} ${n!.label}`);
      n!.children.forEach((c) => walk(c, d + 1));
    };
    walk(e.reading, 0);
    const brace = outline.findIndex((l) => l.trim() === 'bash/brace {1..3}');
    assert.deepStrictEqual(outline.slice(brace + 1, brace + 3).map((l) => l.trim()), ['bash/number 1', 'bash/number 3']);
  });
});

describe('a NAME=VALUE that bash passes as an argument to a declaration builtin', () => {
  it('is an assignment the builtin makes, but a word bash splits', () => {
    // (After `command`, bash splits `$y`: `declare` gets `z=1` and `2`.)
    const r = runBash('y="1 2"; command declare z=$y; declare -p z; command declare k=1; echo "$k"');
    assert.strictEqual(r.stdout, 'declare -- z="1"\n1\n');
    assert.match(r.stderr, /declare: `2': not a valid identifier/);
    const k = tokens('command declare k=1').find((t) => t.label === 'k=1')!;
    assert.strictEqual(k.kind, 'assignment');
    assert.strictEqual(k.explanation, 'Assign `1` to the variable `k` (`declare` reads the word as an assignment). To bash it is an ordinary argument, not an assignment, since the command name is not `declare` itself');
    assert.match(textOf('y="1 2"; command declare z=$y', 'z=$y')[0], /: an unquoted expansion in it is split and globbed$/);
    assert.match(textOf('builtin export q+=x', 'q+=x')[0], /^Append `x` to the variable `q` \(`export` reads the word as an assignment\)/);
    assert.match(textOf('command declare k=1', 'k=1', 0, 'ja')[0], /^変数 `k` に `1` を代入する（`declare` がこの語を代入として読む）/);
  });
});

describe('a function of this script that a string run by another shell calls', () => {
  it('is no pitfall when the string reads a file first that may define it', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explain-bash-sourced-'));
    try {
      fs.writeFileSync(path.join(dir, 'lib.sh'), 'f() { echo F; }\n');
      assert.strictEqual(runBash("f() { echo outer; }; bash -c '. ./lib.sh && f'", { cwd: dir }).stdout, 'F\n');
    } finally {
      fs.rmSync(dir, { recursive: true });
    }
    const notes = (src: string, line: number) => explain(src, line).notes.join('\n');
    assert.doesNotMatch(notes("f() { :; }\nbash -c '. ./lib.sh && f'", 1), /does not have this script's function/);
    assert.doesNotMatch(notes("f() { :; }\nbash -lc 'source ~/.profile; f'", 1), /does not have this script's function/);
    // (Read after the call, the file cannot have defined it.)
    assert.match(notes("f() { :; }\nbash -c 'f; . ./lib.sh'", 1), /does not have this script's function `f`/);
    assert.match(textOf("f() { :; }\nbash -lc 'source ~/.profile; f'", 'f', 1)[0], /the files it reads at startup \(`-l`, `-i`, `BASH_ENV`\), or the file it reads on line 2, define it/);
  });

  it('says that `sudo -u` passes no exported function either, as plain `sudo`', () => {
    for (const src of ["f() { :; }\nsudo -u nobody bash -c 'f'", "f() { :; }\nsudo bash -c f", "f() { :; }; export -f f\nsudo -u nobody -i bash -c 'f'"]) {
      const n = explain(src, 1).notes.join('\n');
      assert.match(n, /`sudo` passes no exported functions, so `export -f f` does not help either/, src);
      assert.doesNotMatch(n, /pass the function with `export -f f` first/, src);
    }
  });
});

describe('xargs -d', () => {
  it('says that the newline at the end stays only with a delimiter other than a newline (compared with GNU xargs)', () => {
    const xargs = (input: string, d: string) => run('xargs', ['-d', d, 'printf', '[%s]'], { input }).stdout.toString();
    assert.strictEqual(xargs('a\nb\n', '\\n'), '[a][b]');
    assert.strictEqual(xargs('a b\n', ' '), '[a][b\n]');
    assert.strictEqual(textOf("xargs -d '\\n' rm < list.txt", '-d')[0],
      'input delimiter: each item ends at the given character, and quotes and backslashes are not special (with one other than `\\n`, the newline `echo` ends with stays in the last item)');
  });
});
