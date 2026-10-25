// What we say of tests (`[ ]`, `[[ =~ ]]`), redirections (here-documents and here-strings on a descriptor, brace
// expansion and `/dev/tcp` in a target), process substitutions read as input, and a tilde before a glob, checked
// against bash (and dash, where the shells differ).
import * as assert from 'assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Analyzer } from '../src/analyzer';
import type { Example, Token } from '../src/analyzer-types';
import { featuresOnLine, type Shell } from '../src/dialect';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { partAt } from '../src/ui/hoverParts';
import { partHover, plainPartHover } from '../src/ui/hoverView';
import { runBash } from './support/bash';
import { allTokens, explain } from './support/explain';

const parser = createUnbashParser();
const tokens = (src: string, lang: 'en' | 'ja' = 'en', shell?: Shell): Token[] =>
  allTokens(new Analyzer(lang).explainLine(parser.parse(src), 0, shell).items);
const token = (src: string, label: string, lang: 'en' | 'ja' = 'en', shell?: Shell): Token => {
  const t = tokens(src, lang, shell).filter((x) => x.label === label).pop();
  assert.ok(t, `a token ${label} in ${src}`);
  return t;
};
const examples = (src: string, lang: 'en' | 'ja' = 'en'): Example[] => explain(src, 0, lang).examples;
const bash = (script: string) => runBash(script);
const hasDash = spawnSync('dash', ['-c', 'exit 0']).status === 0;
/** What dash prints for `script`, run in a fresh directory of its own (removed after). */
const dash = (script: string) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explain-bash-dash-'));
  try {
    return spawnSync('dash', ['-c', script], { cwd: dir, encoding: 'utf8', timeout: 10000, env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' } });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

describe('the operands of -eq in [ ] and [[ ]], as bash reads them', () => {
  it('reads digits with a leading 0 as decimal in [ ] and test, even 08 and 09', () => {
    assert.match(token('[ 08 -eq 8 ]', '08 -eq 8').explanation, /`\[ \]` reads decimal integers, so `08` is 8 \(not octal\)$/);
    assert.match(token('[ 08 -eq 8 ]', '08 -eq 8', 'ja').explanation, /`\[ \]` は 10 進の整数として読むので `08` は 8（8 進数ではない）$/);
    assert.match(token('test 09 -lt 10', '09 -lt 10').explanation, /`09` is 9 \(not octal\)$/);
    assert.ok(!/error/.test(token('[ 08 -eq 8 ]', '08 -eq 8').explanation));
    // `[[ ]]` reads arithmetic, where `08` is a bad octal number.
    assert.match(token('[[ 08 -eq 8 ]]', '08 -eq 8').explanation, /value too great for base/);
    const r = bash('[ 08 -eq 8 ] && echo bracket; test 09 -lt 10 && echo test; [[ 08 -eq 8 ]]; echo "status $?"');
    assert.strictEqual(r.stdout, 'bracket\ntest\nstatus 1\n');
    assert.match(r.stderr, /08: value too great for base/);
  });

  it('keeps the sign: -08 is -8, +08 is 8', () => {
    const cases: [string, string][] = [['[ -08 -eq -8 ]', '-08 is -8'], ['[ -010 -eq -10 ]', '-010 is -10'], ['[ +08 -eq 8 ]', '+08 is 8']];
    for (const [src, said] of cases) {
      const [a, b] = said.split(' is ');
      const t = token(src, src.slice(2, -2)).explanation;
      assert.ok(t.endsWith(`so \`${a}\` is ${b} (not octal)`), t);
      assert.strictEqual(bash(`${src} && echo yes`).stdout, 'yes\n', src);
    }
    assert.match(token('[ -08 -eq -8 ]', '-08 -eq -8', 'ja').explanation, /`-08` は -8（8 進数ではない）$/);
  });

  it('says why [[ ]] rejects a constant too, with the error bash prints', () => {
    assert.match(token('[ 1e3 -eq 1 ]', '1e3 -eq 1').explanation, /so `1e3` is an error \(integer expression expected\); `\[\[ \]\]` rejects it too, as arithmetic \(value too great for base\)$/);
    assert.match(token('[ 1e3 -eq 1 ]', '1e3 -eq 1', 'ja').explanation, /`1e3` はエラー（integer expression expected）。`\[\[ \]\]` の算術でもエラー（value too great for base）$/);
    // (A constant that arithmetic reads still says so.)
    assert.match(token('[ 0x10 -eq 16 ]', '0x10 -eq 16').explanation, /`\[\[ \]\]` would read it as arithmetic$/);
    const cases: [string, string][] = [
      ['1e3', '`e` is not a digit in base 10'], ['0#1', 'the base starts with 0'], ['1#1', '1 is not a base bash has (2 to 64)'], ['2#', 'no digits follow the `#`'], ['08', 'a number starting with 0 is read as octal, and `8` is not an octal digit'],
    ];
    for (const [v, why] of cases) {
      const t = token(`[[ ${v} -eq 1 ]]`, `${v} -eq 1`).explanation;
      const m = /where `([^`]+)` is no valid number \((.*)\): an error \(([^)]+)\)$/.exec(t);
      assert.ok(m, t);
      assert.deepStrictEqual([m[1], m[2]], [v, why], v);
      // The error is the one bash prints.
      const r = bash(`[[ ${v} -eq 1 ]]`);
      assert.strictEqual(r.status, 1, v);
      assert.match(r.stderr, new RegExp(`\\[\\[: ${v}: ${m[3]} \\(error token`), v);
    }
    assert.match(token('[[ 1e3 -eq 1 ]]', '1e3 -eq 1', 'ja').explanation, /`\[\[ \]\]` は算術として読むが、`1e3` は数として正しくない（基数 10 では数字 `e` は使えない）のでエラー（value too great for base）$/);
  });
});

describe('the example of a regex with quoted parts', () => {
  /** What bash says of each value: `y` when it matches the regex of `test`, else `n`. */
  const verdicts = (test: string, values: string[]): string[] => {
    const script = values.map((v) => `x='${v}'; ${test} && echo y || echo n`).join('\n');
    return bash(script).stdout.trim().split('\n');
  };

  it('matches the quoted part as literal text, as bash does', () => {
    for (const test of ['[[ $x =~ ^"a."c$ ]]', "[[ $x =~ ^'a.'c$ ]]", "[[ $x =~ ^$'a.'c$ ]]"]) {
      const ex = examples(test).find((e) => e.kind === 'regex');
      assert.ok(ex, test);
      const [yes, no] = ex.sections;
      assert.deepStrictEqual(yes.lines, ['a.c'], test);
      assert.deepStrictEqual(verdicts(test, yes.lines), yes.lines.map(() => 'y'), test);
      assert.deepStrictEqual(verdicts(test, no.lines), no.lines.map(() => 'n'), test);
    }
    // The values the regex of the unquoted parts alone would give do not match.
    assert.deepStrictEqual(verdicts('[[ $x =~ ^"a."c$ ]]', ['abc', 'abc c', 'c']), ['n', 'n', 'n']);
  });

  it('has no example when a part is not known', () => {
    assert.deepStrictEqual(examples('[[ $x =~ a$y ]]').filter((e) => e.kind === 'regex'), []);
    assert.deepStrictEqual(examples('[[ $x =~ ^"$y"c ]]').filter((e) => e.kind === 'regex'), []);
    // A plain regex still has one.
    assert.strictEqual(examples('[[ $x =~ ^a.c$ ]]').filter((e) => e.kind === 'regex').length, 1);
  });
});

describe('a here-document or a here-string on another descriptor', () => {
  it('goes to that descriptor, and the order of the redirections says so', () => {
    const src = 'cat 3<<EOF <&3\nbody\nEOF';
    const ex = explain(src);
    assert.ok(ex.notes.includes('Redirections apply left to right. In the end: stdin → the here-document `EOF`, fd 3 → the here-document `EOF`'), ex.notes.join('\n'));
    assert.ok(explain(src, 0, 'ja').notes.includes('リダイレクトは左から順に適用される。最終的に: 標準入力 → ヒアドキュメント `EOF`、fd 3 → ヒアドキュメント `EOF`'));
    const doc = token(src, '3<<EOF');
    assert.match(doc.explanation, /^Here-document: the following lines up to a line containing only `EOF` become file descriptor 3\./);
    assert.match(token(src, '3<<EOF', 'ja').explanation, /^ヒアドキュメント: 次の行から `EOF` だけの行までをファイルディスクリプタ 3として渡す/);
    assert.match(token('cat <<EOF\nx\nEOF', '<<EOF').explanation, /become stdin\./);
    assert.strictEqual(bash(`${src}\n`).stdout, 'body\n');
    // The lines of the body name the here-document with its descriptor.
    assert.ok(explain(src, 1).notes.includes('This line is part of the here-document started by `3<<EOF` on line 1.'), explain(src, 1).notes.join('\n'));
    assert.ok(explain(src, 2).notes.includes('`EOF` marks the end of the here-document started by `3<<EOF` on line 1.'));
    assert.ok(explain(src, 1, 'ja').notes.includes('この行はヒアドキュメント（行 1 の `3<<EOF`）の本文です。'));
  });

  it('names which of several here-documents stdin gets', () => {
    const src = "cat 3<<A 4<<'B' <&4\na\nA\nb\nB";
    assert.ok(explain(src).notes.includes('Redirections apply left to right. In the end: stdin → the here-document `B`, fd 3 → the here-document `A`, fd 4 → the here-document `B`'), explain(src).notes.join('\n'));
    assert.ok(explain(src, 0, 'ja').notes.includes('リダイレクトは左から順に適用される。最終的に: 標準入力 → ヒアドキュメント `B`、fd 3 → ヒアドキュメント `A`、fd 4 → ヒアドキュメント `B`'));
    assert.strictEqual(bash(`${src}\n`).stdout, 'b\n');
  });

  it('a here-string too', () => {
    const src = 'cat 3<<< x <&3';
    assert.ok(explain(src).notes.includes('Redirections apply left to right. In the end: stdin → the here-string, fd 3 → the here-string'));
    const t = token(src, '3<<< x');
    assert.strictEqual(t.explanation, 'Here-string `<<<`: the following word (plus a newline) becomes file descriptor 3');
    assert.match(token(src, '3<<< x', 'ja').explanation, /ファイルディスクリプタ 3として渡す$/);
    // (The descriptor is no word to explain.)
    assert.deepStrictEqual(t.children, []);
    assert.strictEqual(token('cat <<< x', '<<< x').explanation, 'Here-string `<<<`: the following word (plus a newline) becomes stdin');
    assert.strictEqual(bash(src).stdout, 'x\n');
    // Without `<&3`, cat reads the original stdin, not the here-string.
    assert.strictEqual(runBash('cat 3<<< x', { input: 'in\n' }).stdout, 'in\n');
    // `{v}<<<`: a new descriptor, whose number goes into `v`.
    assert.strictEqual(token('exec {v}<<< hi', '{v}<<< hi').explanation,
      'Here-string `<<<`: the following word (plus a newline) becomes the input of a free file descriptor (10 or higher, its number stored in variable `v`)');
    assert.match(token('exec {v}<<< hi', '{v}<<< hi', 'ja').explanation, /空いているファイルディスクリプタ（10 以上。番号は変数 `v` に入る）の入力として渡す$/);
    assert.strictEqual(bash('exec {v}<<< hi; [ "$v" -ge 10 ] && cat <&$v').stdout, 'hi\n');
  });
});

describe('a redirection that a later one of the same descriptor replaces', () => {
  /** bash's output of `script`, in a fresh directory of its own. */
  const inDir = (script: string): string => runBash(script, { files: ['.keep'] }).stdout;

  it('a here-document is opened, but the command reads only the last one', () => {
    const src = 'cat <<A <<B\na\nA\nb\nc\nB';
    assert.strictEqual(bash(`${src}\n`).stdout, 'b\nc\n');
    assert.strictEqual(token(src, '<<A').explanation,
      'Here-document: the following lines up to a line containing only `A`, opened as stdin; but the later `<<B` then replaces stdin, so the command does not read them. `$vars` and `$(…)` in the body are expanded (lines 2–3)');
    assert.match(token(src, '<<A', 'ja').explanation, /^ヒアドキュメント: 次の行から `A` だけの行まで。標準入力として開かれるが、後の `<<B` が続けて標準入力を置き換えるので、コマンドはこれを読まない。.*（行 2〜3）$/);
    // Each here-document names its own lines: the body and the end.
    assert.match(token(src, '<<B').explanation, /become stdin\. .* \(lines 4–6\)$/);
    assert.match(token(src, '<<B', 'ja').explanation, /（行 4〜6）$/);
    // (bash still expands the body of the one it replaces.)
    assert.strictEqual(bash('cat <<A <<B\n$(echo ran >&2)\nA\nb\nB\n').stderr, 'ran\n');
    // A here-string, and a file, are replaced the same way.
    assert.match(token('cat <<<x <<B\nb\nB', '<<<x').explanation, /^Here-string `<<<`: the following word \(plus a newline\), opened as stdin; but the later `<<B` then replaces stdin, so the command does not read it$/);
    assert.strictEqual(bash('cat <<<x <<B\nb\nB\n').stdout, 'b\n');
    assert.match(token('cat <<A <b\na\nA', '<<A').explanation, /the later `<b` then replaces stdin/);
  });

  it('a file is still opened, created or emptied', () => {
    assert.match(token('cat <a <b', '<a').explanation, /^Read file `a` as stdin \(fd 0\)\. But the later `<b` then replaces stdin \(fd 0\): `a` is opened \(it must exist\) but not read$/);
    assert.match(token('cat <a <b', '<a', 'ja').explanation, /ただし後の `<b` が続けて標準入力\(fd 0\)を置き換えるので、`a` は開かれる（存在しなければエラー）が、読まれない$/);
    assert.strictEqual(inDir('printf a >a; printf b >b; cat <a <b'), 'b');
    assert.match(inDir('printf b >b; cat <missing <b; echo "st=$?"'), /^st=1$/m);
    assert.match(token('echo hi >a >b', '>a').explanation, /But the later `>b` then replaces stdout \(fd 1\): `a` is created or emptied, but nothing is written to it$/);
    assert.match(token('echo hi >>a >b', '>>a').explanation, /`a` is created if missing, but nothing is written to it$/);
    assert.match(token('echo hi <>a <b', '<>a').explanation, /`a` is opened \(and created if missing\) but not used$/);
    assert.strictEqual(inDir('printf old >a; printf old >c; echo hi >a >b; echo hi >>c >d; echo "[$(cat a)] [$(cat b)] [$(cat c)] [$(cat d)]"'), '[] [hi] [old] [hi]\n');
    assert.match(token('echo hi >a 2>b', '>a').explanation, /\(overwrite\)$/);
  });

  it('is not replaced when a redirection between copies it, or sets another descriptor', () => {
    // `2>&1` copies stdout to stderr before `>b`: `a` gets stderr.
    assert.match(token('ls x >a 2>&1 >b', '>a').explanation, /\(overwrite\)$/);
    assert.strictEqual(inDir('ls nothere >a 2>&1 >b; [ -s a ] && echo a-has-stderr; [ -s b ] || echo b-empty'), 'a-has-stderr\nb-empty\n');
    // `<&3` copies the here-document on 3 to stdin, which `<<B` then replaces; 3 keeps it.
    assert.match(token('cat 3<<A <&3 <<B\na\nA\nb\nB', '3<<A').explanation, /become file descriptor 3\./);
    assert.strictEqual(bash('cat 3<<A <&3 <<B\na\nA\nb\nB\n').stdout, 'b\n');
    // `<&$fd` may copy any descriptor; `{v}<<A` opens one of its own; `&>` sets two, only one of which `>b` replaces.
    assert.match(token('cat <a <&$fd <b', '<a').explanation, /as stdin \(fd 0\)$/);
    assert.match(token('exec {v}<<A <<B\na\nA\nb\nB', '{v}<<A').explanation, /become the input of a free file descriptor/);
    assert.match(token('echo hi &>a >b', '&>a').explanation, /\(overwrite\)$/);
    // Later ones that replace: a duplication, a move, a close, `&>`, `>&file`.
    assert.match(token('echo hi >a >&2', '>a').explanation, /the later `>&2` then replaces stdout/);
    assert.match(token('echo hi 2>a 3>&2- 2>&-', '2>a').explanation, /\(overwrite\)$/);
    assert.match(token('echo hi 2>a 2>&3-', '2>a').explanation, /the later `2>&3-` then replaces stderr/);
    assert.match(token('echo hi 2>a 2>&-', '2>a').explanation, /the later `2>&-` then replaces stderr/);
    assert.match(token('echo hi >|a >>b', '>|a', 'ja').explanation, /`a` は作られる（中身は空になる）が、何も書き込まれない$/);
    assert.match(token('echo hi >a &>b', '>a').explanation, /the later `&>b` then replaces stdout/);
    assert.match(token('echo hi >a >&b', '>a').explanation, /the later `>&b` then replaces stdout/);
    assert.match(token('echo hi >a >b', '>b').explanation, /\(overwrite\)$/);
  });

  it('is not replaced when the later one opens the same file, or copies the descriptor', () => {
    /** The first token labelled `label` (`>s` of `>s >s`). */
    const first = (src: string, label: string, lang: 'en' | 'ja' = 'en'): Token => tokens(src, lang).find((x) => x.label === label)!;
    // The same file, as written: bash writes to it, or reads it.
    for (const [src, label] of [['echo hi >s >s', '>s'], ['echo hi >s >>s', '>s'], ['echo hi >s >./s', '>s'], ['cat <a <a', '<a'], ['echo hi >s &>s', '>s']]) {
      assert.doesNotMatch(first(src, label).explanation, /later/, src);
    }
    assert.strictEqual(inDir('echo hi >s >s; echo hi >t >>t; echo hi >u >./u; printf a >a; cat <a <a; echo; echo "[$(cat s)] [$(cat t)] [$(cat u)]"'), 'a\n[hi] [hi] [hi]\n');
    // A word not known here may name the same file.
    assert.match(token('echo x >a >"$f"', '>a').explanation, /`a` is created or emptied, but nothing is written to it \(unless `>"\$f"` names the same file, which is then used\)$/);
    assert.match(token('echo x >a >"$f"', '>a', 'ja').explanation, /何も書き込まれない（`>"\$f"` が同じファイルを指すなら、このファイルが使われる）$/);
    assert.match(token('echo x >"$f" >a', '>"$f"').explanation, /\(unless `>a` names the same file, which is then used\)$/);
    assert.match(token('echo x >a >b', '>a').explanation, /nothing is written to it$/);
    assert.strictEqual(inDir('f=a; echo x >a >"$f"; cat a'), 'x\n');
    // `/dev/stdout` is a copy of stdout, and `{v}>&1`, `{v}<&0` copy too: the earlier one is still used.
    assert.doesNotMatch(token('echo hi >a >/dev/stdout', '>a').explanation, /later/);
    assert.doesNotMatch(token('echo hi >a >/dev/fd/1', '>a').explanation, /later/);
    assert.strictEqual(inDir('echo hi >a >/dev/stdout; cat a'), 'hi\n');
    assert.doesNotMatch(token('cat <a </dev/stdin', '<a').explanation, /later/);
    assert.doesNotMatch(token('ls x 2>e 2>/dev/stderr', '2>e').explanation, /later/);
    assert.strictEqual(inDir('printf a >a; cat <a </dev/stdin; ls nothere 2>e 2>/dev/stderr; [ -s e ] && echo e-has-stderr'), 'ae-has-stderr\n');
    assert.doesNotMatch(token('{ echo hi >&$v; } >o1 {v}>&1 >o2', '>o1').explanation, /later/);
    assert.strictEqual(inDir('{ echo hi >&$v; } >o1 {v}>&1 >o2; echo "[$(cat o1)] [$(cat o2)]"'), '[hi] []\n');
    assert.doesNotMatch(token('cat <<A {v}<&0 <<B\na\nA\nb\nB', '<<A').explanation, /later/);
    assert.strictEqual(bash('{ cat; cat <&$v; } <<A {v}<&0 <<B\na\nA\nb\nB\n').stdout, 'b\na\n');
    assert.match(token('cat <a {v}<&3 <b', '<a').explanation, /the later `<b` then replaces stdin/);
  });

  it('a device is only opened; an empty here-document names its end line', () => {
    assert.match(token('echo hi >/dev/null >b', '>/dev/null').explanation, /: `\/dev\/null` is opened, but nothing is written to it$/);
    assert.match(token('echo hi >>/dev/null >b', '>>/dev/null', 'ja').explanation, /`\/dev\/null` は開かれるが、何も書き込まれない$/);
    assert.match(token('cat <>/dev/null <b', '<>/dev/null').explanation, /`\/dev\/null` is opened but not used$/);
    assert.strictEqual(inDir('echo hi >/dev/null >b; cat b; [ -c /dev/null ] && echo device'), 'hi\ndevice\n');
    assert.match(token('cat <<A\nA', '<<A').explanation, /are expanded \(line 2\)$/);
    assert.match(token('cat <<A\nA', '<<A', 'ja').explanation, /（行 2）$/);
    assert.match(token('cat <<A <<B\nA\nb\nB', '<<A').explanation, /\(line 2\)$/);
    assert.strictEqual(bash('cat <<A\nA\necho after\n').stdout, 'after\n');
  });
});

describe('a redirection target that brace expansion makes one word', () => {
  /** What bash prints after `script` runs in a fresh directory, followed by `ls`. */
  const filesAfter = (script: string) => runBash(`${script}\nls`, { files: [] });

  it('names the file bash writes', () => {
    const t = token('echo hi > {a,}', '> {a,}');
    assert.strictEqual(t.explanation, 'Write stdout (fd 1) to file `a` (overwrite). Brace expansion makes `{a,}` the one word `a`');
    assert.match(token('echo hi > {a,}', '> {a,}', 'ja').explanation, /^標準出力\(fd 1\)をファイル `a` に書き込む（既存の内容は上書き）。ブレース展開で `\{a,\}` は1つの単語 `a` になる$/);
    assert.strictEqual(filesAfter('echo hi > {a,}').stdout, 'a\n');
    assert.strictEqual(token('echo hi > {b..b}', '> {b..b}').explanation, 'Write stdout (fd 1) to file `b` (overwrite). Brace expansion makes `{b..b}` the one word `b`');
    assert.strictEqual(filesAfter('echo hi > {b..b}').stdout, 'b\n');
  });

  it('or none, and bash reports an ambiguous redirect', () => {
    assert.match(token('echo hi > {,}', '> {,}').explanation, /\. Brace expansion leaves no word of it \(empty words are dropped\), so bash reports "ambiguous redirect"$/);
    assert.match(token('echo hi > {,}', '> {,}', 'ja').explanation, /単語が残らないので、bash は「ambiguous redirect」のエラーにする$/);
    assert.match(token('echo hi > {a,b}', '> {a,b}').explanation, /makes several words of it/);
    const r = filesAfter('echo hi > {,}; echo hi > {a,}b');
    assert.strictEqual(r.stdout, '');
    assert.match(r.stderr, /\{,\}: ambiguous redirect[\s\S]*\{a,\}b: ambiguous redirect/);
  });

  it('is the word as written in sh and dash, which have no brace expansion (and mksh, no ranges)', () => {
    for (const shell of ['sh', 'dash'] as const) {
      assert.strictEqual(token('echo hi > {a,}', '> {a,}', 'en', shell).explanation, 'Write stdout (fd 1) to file `{a,}` (overwrite)', shell);
      assert.strictEqual(token('echo hi > {a,b}', '> {a,b}', 'en', shell).explanation, 'Write stdout (fd 1) to file `{a,b}` (overwrite)', shell);
      assert.strictEqual(token('echo hi > {b..b}', '> {b..b}', 'en', shell).explanation, 'Write stdout (fd 1) to file `{b..b}` (overwrite)', shell);
    }
    assert.strictEqual(token('echo hi > {a,}', '> {a,}', 'ja', 'dash').explanation, '標準出力(fd 1)をファイル `{a,}` に書き込む（既存の内容は上書き）');
    assert.strictEqual(token('echo hi > {b..b}', '> {b..b}', 'en', 'mksh').explanation, 'Write stdout (fd 1) to file `{b..b}` (overwrite)');
    assert.match(token('echo hi > {a,}', '> {a,}', 'en', 'mksh').explanation, /the one word `a`$/);
    if (hasDash) assert.strictEqual(dash('echo hi > {a,}; echo hi > {a,b}; echo hi > {b..b}; ls').stdout, '{a,b}\n{a,}\n{b..b}\n');
  });
});

describe('a duplication to a word that is no descriptor number', () => {
  it('writes both stdout and stderr to the file only as >&word and 1>&word; else bash reports an ambiguous redirect', () => {
    assert.strictEqual(token('echo x >&f', '>&f').explanation, 'Write both stdout and stderr to `f`');
    assert.strictEqual(token('echo x 1>&f', '1>&f').explanation, 'Write both stdout and stderr to `f`');
    const errors: [string, string][] = [['echo x 2>&f', '2>&f'], ['echo x 3>&f', '3>&f'], ['echo x 0>&f', '0>&f']];
    for (const [src, label] of errors) {
      assert.strictEqual(token(src, label).explanation, '`f` is no file descriptor number, so bash reports "ambiguous redirect"; only `>&` and `1>&` take a file name', src);
    }
    assert.strictEqual(token('echo x 2>&f', '2>&f', 'ja').explanation, '`f` はファイルディスクリプタの番号ではないので、bash は「ambiguous redirect」のエラーにする。ファイル名を取れるのは `>&` と `1>&` だけ');
    for (const [src, label] of [['cat <&f', '<&f'], ['exec {v}>&f', '{v}>&f'], ['exec {v}<&f', '{v}<&f']]) {
      assert.strictEqual(token(src, label).explanation, '`f` is no file descriptor number, so bash reports "ambiguous redirect"', src);
    }
    // The order of the redirections: `>&f` sends both, `2>&$fd` only stderr.
    assert.ok(explain('echo x >&f 2>&1').notes.includes('Redirections apply left to right. In the end: stdout → f, stderr → f'), explain('echo x >&f 2>&1').notes.join('\n'));
    assert.ok(explain('echo x 2>&$fd >o').notes.includes('Redirections apply left to right. In the end: stdout → o, stderr → $fd'), explain('echo x 2>&$fd >o').notes.join('\n'));
    // bash writes both to `f` for `>&f` and `1>&f`; the others are errors, and make no file.
    const r = runBash('{ echo out; echo err >&2; } >&f; { echo out; echo err >&2; } 1>&g; cat f g; echo x 2>&h; echo x 3>&h; cat <&h; exec {v}>&h; ls', { files: [] });
    assert.strictEqual(r.stdout, 'out\nerr\nout\nerr\nf\ng\n');
    assert.strictEqual(r.stderr.match(/h: ambiguous redirect/g)?.length, 3);
    assert.match(r.stderr, /v: ambiguous redirect/);
  });
});

describe('/dev/tcp and /dev/udp in a redirection', () => {
  it('are a network connection in bash', () => {
    assert.strictEqual(token('exec 3<>/dev/tcp/127.0.0.1/9', '3<>/dev/tcp/127.0.0.1/9').explanation,
      'Connect to host `127.0.0.1`, port `9`, over TCP, and use the connection for reading and writing as file descriptor 3 (not a file: the shell itself handles `/dev/tcp/host/port`, and fails if it cannot connect)');
    assert.strictEqual(token('exec 3<>/dev/tcp/127.0.0.1/9', '3<>/dev/tcp/127.0.0.1/9', 'ja').explanation,
      'TCP でホスト `127.0.0.1` のポート `9` に接続し、接続を読み書き両用でファイルディスクリプタ 3にする（ファイルではない。`/dev/tcp/ホスト/ポート` はシェル自身が扱う名前で、接続できなければエラー）');
    assert.deepStrictEqual(token('exec 3<>/dev/tcp/127.0.0.1/9', '3<>/dev/tcp/127.0.0.1/9').refs, ['3.6']);
    const said = (src: string, label: string) => token(src, label).explanation.replace(/ \(not a file.*$/, '');
    assert.strictEqual(said('cat < /dev/udp/127.0.0.1/53', '< /dev/udp/127.0.0.1/53'), 'Connect to host `127.0.0.1`, port `53`, over UDP, and read stdin (fd 0) from the connection');
    assert.strictEqual(said('echo x > /dev/tcp/h/80', '> /dev/tcp/h/80'), 'Connect to host `h`, port `80`, over TCP, and send stdout (fd 1) to it');
    assert.strictEqual(said('echo x 2>> /dev/tcp/h/80', '2>> /dev/tcp/h/80'), 'Connect to host `h`, port `80`, over TCP, and send stderr (fd 2) to it');
    assert.strictEqual(said('echo x &> /dev/tcp/h/80', '&> /dev/tcp/h/80'), 'Connect to host `h`, port `80`, over TCP, and send both stdout and stderr to it');
    assert.strictEqual(said('echo x >&/dev/tcp/h/80', '>&/dev/tcp/h/80'), 'Connect to host `h`, port `80`, over TCP, and send both stdout and stderr to it');
    assert.strictEqual(said('echo x 1>&/dev/tcp/h/80', '1>&/dev/tcp/h/80'), 'Connect to host `h`, port `80`, over TCP, and send both stdout and stderr to it');
    assert.strictEqual(said('exec {s}<>/dev/tcp/h/80', '{s}<>/dev/tcp/h/80'), 'Connect to host `h`, port `80`, over TCP, and open the connection on a free file descriptor (10 or higher), storing its number in variable `s`');
    // The host and the port may be expanded.
    assert.ok(tokens('exec 3<>/dev/tcp/$host/80').some((t) => t.label === '$host'));
    // `2>&word` is no file: an error, whatever the word.
    assert.strictEqual(token('echo x 2>&/dev/tcp/h/80', '2>&/dev/tcp/h/80').explanation, '`/dev/tcp/h/80` is no file descriptor number, so bash reports "ambiguous redirect"; only `>&` and `1>&` take a file name');
    assert.deepStrictEqual(featuresOnLine(parser.parse('echo x 2>&/dev/tcp/h/80').root, 0), []);
    // bash tries to connect (port 9 has no server here): no file is opened, and none is made.
    const r = runBash('exec 3<>/dev/tcp/127.0.0.1/9; echo after', { files: [] });
    assert.match(r.stderr, /connect: Connection refused/);
    assert.strictEqual(runBash('echo x > /dev/tcp/127.0.0.1/9; ls /dev/tcp 2>&1 | grep -c "No such"').stdout, '1\n');
    assert.match(runBash('echo x 2>&/dev/tcp/127.0.0.1/9').stderr, /\/dev\/tcp\/127\.0\.0\.1\/9: ambiguous redirect/);
  });

  it('connect when quoted too: the word after quote removal is the name', () => {
    for (const src of ['echo x > "/dev/tcp/127.0.0.1/9"', "echo x > '/dev/tcp/127.0.0.1/9'", 'echo x >&"/dev/tcp/127.0.0.1/9"']) {
      const label = src.slice(7);
      assert.match(token(src, label).explanation, /^Connect to host `127\.0\.0\.1`, port `9`, over TCP, and send (stdout \(fd 1\)|both stdout and stderr) to it/, src);
      assert.match(token(src, label, 'ja').explanation, /^TCP でホスト `127\.0\.0\.1` のポート `9` に接続し、/, src);
      assert.deepStrictEqual(featuresOnLine(parser.parse(src).root, 0), ['netRedirect'], src);
      assert.match(runBash(src, { files: [] }).stderr, /connect: Connection refused/, src);
    }
    // (A quoted number is a descriptor as well: `>&"2"` is `>&2`.)
    assert.strictEqual(token('echo x >&"2"', '>&"2"').explanation, 'Send stdout (fd 1) to the same place as stderr (fd 2)');
    const q = runBash('echo x >&"2"');
    assert.deepStrictEqual([q.stdout, q.stderr], ['', 'x\n']);
  });

  it('are network paths in bash even when no host and port can be read of them, and fail', () => {
    const cases: [string, string][] = [
      ['/dev/tcp/127.0.0.1/9/x', 'host `127.0.0.1`, port `9/x`'], ['/dev/tcp//9', 'host empty, port `9`'], ['/dev/tcp//', 'host empty, port empty'],
    ];
    for (const [target, parts] of cases) {
      assert.strictEqual(token(`echo x > ${target}`, `> ${target}`).explanation,
        `The shell takes \`${target}\` as a network address (${parts}), which is no valid host and port: the redirection fails (no file is opened)`);
      assert.deepStrictEqual(featuresOnLine(parser.parse(`echo x > ${target}`).root, 0), ['netRedirect']);
      // bash fails on it, and says nothing of a missing file.
      const b = runBash(`echo x > ${target}; echo "status $?"`, { files: [] });
      assert.strictEqual(b.stdout, 'status 1\n', target);
      assert.doesNotMatch(b.stderr, /No such file/, target);
    }
    assert.strictEqual(token('echo x > /dev/tcp//9', '> /dev/tcp//9', 'ja').explanation,
      'シェルは `/dev/tcp//9` をネットワークの接続先（ホストは空、ポート `9`）として扱うが、正しいホストとポートではないのでリダイレクトはエラーになる（ファイルは開かない）');
    // An empty port: bash still connects (UDP sends without an answer; TCP is refused).
    assert.strictEqual(token('echo x > /dev/udp/127.0.0.1/', '> /dev/udp/127.0.0.1/').explanation.replace(/ \(not a file.*$/, ''),
      'Connect to host `127.0.0.1`, port empty, over UDP, and send stdout (fd 1) to it');
    assert.match(token('echo x > /dev/udp/127.0.0.1/', '> /dev/udp/127.0.0.1/', 'ja').explanation, /^UDP でホスト `127\.0\.0\.1` のポート（空）に接続し、/);
    assert.strictEqual(runBash('echo x > /dev/udp/127.0.0.1/; echo "status $?"', { files: [] }).stdout, 'status 0\n');
    assert.match(runBash('echo x > /dev/tcp/127.0.0.1/', { files: [] }).stderr, /Connection refused/);
    // Without a second `/`, it is a file.
    assert.strictEqual(token('echo x > /dev/tcp/h', '> /dev/tcp/h').explanation, 'Write stdout (fd 1) to file `/dev/tcp/h` (overwrite)');
    assert.match(runBash('echo x > /dev/tcp/h').stderr, /\/dev\/tcp\/h: No such file or directory/);
  });

  it('are an ordinary path in sh and dash, which the dialect check reports', () => {
    const open = 'Open `/dev/tcp/127.0.0.1/9` for reading and writing as file descriptor 3. ';
    assert.strictEqual(token('exec 3<>/dev/tcp/127.0.0.1/9', '3<>/dev/tcp/127.0.0.1/9', 'en', 'sh').explanation,
      `${open}POSIX does not define \`/dev/tcp/…\`: dash, busybox ash and other sh open it as an ordinary path, usually missing (bash, even in POSIX mode, yash and ksh93 connect to the network)`);
    assert.strictEqual(token('exec 3<>/dev/tcp/127.0.0.1/9', '3<>/dev/tcp/127.0.0.1/9', 'en', 'dash').explanation,
      `${open}dash opens \`/dev/tcp/…\` as an ordinary path, usually missing (POSIX does not define it; bash, yash and ksh93 connect to the network)`);
    assert.match(token('cat < /dev/tcp/h/80', '< /dev/tcp/h/80', 'ja', 'dash').explanation, /。dash では `\/dev\/tcp\/…` も普通のファイル名で、ふつうは存在しない（POSIX は定めていない。ネットワークに接続するのは bash・yash・ksh93）$/);
    assert.match(token('cat < /dev/tcp/h/80', '< /dev/tcp/h/80', 'ja', 'sh').explanation, /。POSIX は `\/dev\/tcp\/…` を定めていない。dash や busybox ash などの sh では普通のファイル名で、ふつうは存在しない（ネットワークに接続するのは bash（POSIX モードでも）・yash・ksh93）$/);
    // bash connects in POSIX mode too.
    assert.match(runBash('exec 3<>/dev/tcp/127.0.0.1/9', { posix: true }).stderr, /connect: Connection refused/);
    assert.deepStrictEqual(featuresOnLine(parser.parse('cat < /dev/tcp/h/80').root, 0), ['netRedirect']);
    assert.deepStrictEqual(featuresOnLine(parser.parse('cat < /dev/tcpx/h/80').root, 0), []);
    if (hasDash) {
      const r = spawnSync('dash', ['-c', 'exec 3</dev/tcp/127.0.0.1/9'], { encoding: 'utf8' });
      assert.match(r.stderr, /cannot open \/dev\/tcp\/127\.0\.0\.1\/9: No such file/);
    }
  });
});

describe('a process substitution read as a file', () => {
  it('is labelled as the output of its command, through a pipe', () => {
    const ex = examples('jq . <(curl -s url)');
    assert.strictEqual(ex[0].sections[0].label, 'Input: sample output of `curl -s url` (through the pipe `<(curl -s url)` names)');
    assert.strictEqual(examples('jq . <(curl -s url)', 'ja')[0].sections[0].label, '入力: `curl -s url` の出力の例（`<(curl -s url)` が名前を渡すパイプ）');
    const sorted = examples('sort <(cmd) <(cmd2)')[0].sections.map((s) => s.label);
    assert.deepStrictEqual(sorted.slice(0, 2), ['Input: sample output of `cmd` (through the pipe `<(cmd)` names)', 'Input: sample output of `cmd2` (through the pipe `<(cmd2)` names)']);
    // Read as stdin through `<`.
    assert.strictEqual(examples('sort < <(cmd)')[0].sections[0].label, 'Input: stdin (sample output of `cmd`, through the pipe `<(cmd)` names)');
    assert.strictEqual(examples('sort < <(cmd)', 'ja')[0].sections[0].label, '入力: 標準入力（`cmd` の出力の例、`<(cmd)` のパイプ）');
    // A file name the example cannot know (`/dev/fd/63`): no headers of head, no `FILENAME` of awk.
    assert.deepStrictEqual(examples('head -n 1 a <(cmd)').filter((e) => e.sections.some((s) => /==>/.test(s.lines.join('\n')))), []);
    assert.deepStrictEqual(examples("awk '{ print FILENAME }' <(cmd)"), []);
    // bash gives the command a name in /dev/fd for a pipe, and reads the command's output from it.
    assert.match(bash('echo <(true); [ -p <(true) ] && echo pipe; cat <(echo out); awk "{ print FILENAME }" <(echo x)').stdout, /^\/dev\/fd\/\d+\npipe\nout\n\/dev\/fd\/\d+\n$/);
  });

  it('shows what its command prints, when that is known, and what the command makes of it, as bash runs it', () => {
    const p = "printf 'b\\na\\n'";
    const cases: [string, string, string][] = [
      [`sort <(${p})`, `Input: output of \`${p}\` (through the pipe \`<(${p})\` names)`, `入力: \`${p}\` の出力（\`<(${p})\` が名前を渡すパイプ）`],
      [`sort < <(${p})`, `Input: stdin (output of \`${p}\`, through the pipe \`<(${p})\` names)`, `入力: 標準入力（\`${p}\` の出力、\`<(${p})\` のパイプ）`],
      [`sort <(${p} | tr a-z A-Z)`, `Input: output of \`${p} | tr a-z A-Z\` (through the pipe \`<(${p} | tr a-z A-Z)\` names)`, `入力: \`${p} | tr a-z A-Z\` の出力（\`<(${p} | tr a-z A-Z)\` が名前を渡すパイプ）`],
      [`sort <(${p} 2> e)`, `Input: output of \`${p} 2> e\` (through the pipe \`<(${p} 2> e)\` names)`, `入力: \`${p} 2> e\` の出力（\`<(${p} 2> e)\` が名前を渡すパイプ）`],
    ];
    for (const [src, en, ja] of cases) {
      const ex = examples(src).find((e) => e.kind === 'textFilters')!;
      assert.ok(ex, src);
      const [input, output] = ex.sections;
      assert.strictEqual(input.label, en);
      assert.strictEqual(examples(src, 'ja').find((e) => e.kind === 'textFilters')!.sections[0].label, ja);
      // The input is what the command prints, and the output what sort makes of it.
      const inner = /<\((.*)\)$/.exec(src)![1];
      assert.deepStrictEqual(input.lines, runBash(inner, { files: [] }).stdout.trimEnd().split('\n'), src);
      assert.deepStrictEqual(output.lines, runBash(src, { files: [] }).stdout.trimEnd().split('\n'), src);
    }
    // A command whose output goes elsewhere, or several commands: a sample.
    for (const src of [`sort <(${p} > f)`, `sort <(${p} &> f)`, `sort <(${p} >&2)`, `sort <(printf 'b\\n'; printf 'a\\n')`]) {
      const label = examples(src).find((e) => e.kind === 'textFilters')!.sections[0].label;
      assert.ok(label.startsWith('Input: sample output of'), `${src}: ${label}`);
    }
  });
});

describe('a tilde before a glob', () => {
  it('is expanded, then the word is globbed', () => {
    const t = token('ls ~/*.txt', '~/*.txt');
    assert.strictEqual(t.explanation, 'Tilde expansion: `~` becomes the home directory (`$HOME`). The rest, `/*.txt`, has wildcards: the expanded path is then a glob, replaced by the file names it matches');
    assert.match(token('ls ~/*.txt', '~/*.txt', 'ja').explanation, /。続く `\/\*\.txt` にはワイルドカードがあるので、展開後のパスがグロブとして一致するファイル名に置き換わる$/);
    assert.deepStrictEqual(t.refs, ['3.5.2', '3.5.8']);
    assert.deepStrictEqual(t.children.map((c) => c.label), ['/', '*', '.txt']);
    // The example's names that do not match: a hidden file is in the same directory.
    const ex = examples('ls ~/*.txt').find((e) => /glob/.test(e.title))!;
    assert.ok(ex.sections[1].lines.includes('~/.app.txt'), ex.sections[1].lines.join(' '));
    const r = runBash('touch a.txt b.txt .c.txt; HOME=$PWD; echo ~/*.txt', { files: [] });
    assert.match(r.stdout, /^\/\S+\/a\.txt \/\S+\/b\.txt\n$/);
  });

  it('stays as it is in an assignment, or with set -f', () => {
    assert.match(token('x=~/*.txt', '~/*.txt').explanation, /The rest, `\/\*\.txt`, stays as it is\. An assignment does no file-name expansion/);
    const off = explain('set -f\nls ~/*.txt', 1).items;
    const t = allTokens(off).filter((x) => x.label === '~/*.txt').pop()!;
    assert.match(t.explanation, /The rest, `\/\*\.txt`, stays as it is\. But `set -f` \(`set -o noglob`\) has turned globbing off/);
    assert.deepStrictEqual(t.children, []);
    assert.strictEqual(runBash('HOME=/h; x=~/*.txt; echo "$x"; set -f; echo ~/*.txt').stdout, '/h/*.txt\n/h/*.txt\n');
  });
});

describe('malformed input explains without throwing', () => {
  it('a here-document with no delimiter, with its reading tree and hovers', () => {
    const analyzer = new Analyzer('en');
    for (const src of ['cat <<\necho a\necho b', 'cat <<', 'cat 3<<', 'cat <<; echo b', 'case', 'case x', 'case x in', 'case x in a)']) {
      const tree = parser.parse(src);
      src.split('\n').forEach((text, line) => {
        const ex = analyzer.explainLine(tree, line, 'bash', { reading: true });
        assert.ok(ex.reading, src);
        for (let c = 0; c <= text.length; c++) {
          const chain = partAt(ex.items, { line, character: c });
          if (!chain.length) continue;
          partHover({ ex, lang: 'en', theme: 'dark', lineText: text, placement: 'first', panelLink: 'p', lineLink: 'l', keys: 'K' }, chain);
          plainPartHover(ex, chain, 'en', 'whole');
        }
      });
    }
    // (`case` with no word yet: bash reports a syntax error; the explanation names no empty value.)
    assert.match(runBash('case').stderr, /syntax error/);
    const c = analyzer.explainLine(parser.parse('case'), 0).items[0];
    assert.strictEqual(c.explanation, 'case statement: match the value (not written yet) against each pattern in order and run the first match');
    assert.deepStrictEqual(allTokens([c]).map((x) => x.label), ['case ', 'case']);
    assert.match(new Analyzer('ja').explainLine(parser.parse('case'), 0).items[0].explanation, /^case 文: 値（まだ書かれていない）を各パターン/);
    const t = allTokens(analyzer.explainLine(parser.parse('cat 3<<'), 0).items).find((x) => x.label === '3<<')!;
    assert.match(t.explanation, /the delimiter is not written yet\. The following lines up to a line containing only the delimiter become file descriptor 3$/);
  });
});
