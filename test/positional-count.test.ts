// What a positional argument means can depend on how many there are: `seq 5` has a last value only,
// `seq 1 5` a first and a last, `cp a b` copies to `b` and `cp a b c d/` into `d/` (`positionalBy` in the dictionary).
import * as assert from 'assert';
import type { BashParser as Parser } from '../src/syntax/tree';
import { Analyzer, Token } from '../src/analyzer';
import { createUnbashParser } from '../src/syntax/adapters/unbash';

let parser: Parser;
before(async () => {
  parser = createUnbashParser();
});

/** The explanation of each argument that is a plain operand (not an option or an option's value). */
const operands = (src: string, lang: 'en' | 'ja' = 'en'): [string, string][] => {
  const cmd = new Analyzer(lang).explainLine(parser.parse(src), 0).items[0];
  return cmd.children.filter((t: Token) => t.kind === 'argument' && !/^(Value for|`-.` オプションの値)/.test(t.explanation)).map((t) => [t.label, t.explanation.replace(/ — .*/, '')]);
};

describe('positional arguments described by their number', () => {
  it('seq: last; first and last; first, increment and last', () => {
    assert.deepStrictEqual(operands('seq 5'), [['5', 'last (counting from 1)']]);
    assert.deepStrictEqual(operands('seq 2 5'), [['2', 'first'], ['5', 'last']]);
    assert.deepStrictEqual(operands('seq -w 1 3 10'), [['1', 'first'], ['3', 'increment'], ['10', 'last']]);
    assert.deepStrictEqual(operands('seq 5', 'ja'), [['5', '終了値（開始値は 1）']]);
    assert.deepStrictEqual(operands('seq 2 5', 'ja'), [['2', '開始値'], ['5', '終了値']]);
    assert.deepStrictEqual(operands('seq 1 3 10', 'ja'), [['1', '開始値'], ['3', '増分'], ['10', '終了値']]);
  });

  it('cp and mv: the last argument is the destination, unless -t names it', () => {
    assert.deepStrictEqual(operands('cp a b'), [['a', 'source'], ['b', 'destination (the new name, or an existing directory)']]);
    assert.deepStrictEqual(operands('cp -v a b c d/'), [['a', 'source'], ['b', 'source'], ['c', 'source'], ['d/', 'destination directory']]);
    assert.deepStrictEqual(operands('cp --target-directory=d a b'), [['a', 'source'], ['b', 'source']]);
    assert.deepStrictEqual(operands('cp -rt d a b'), [['a', 'source'], ['b', 'source']]);
    assert.deepStrictEqual(operands('cp a'), [['a', 'source']]);
    assert.deepStrictEqual(operands('cp -- a b'), [['a', 'source'], ['b', 'destination (the new name, or an existing directory)']]);
    assert.deepStrictEqual(operands('mv a b c d'), [['a', 'source'], ['b', 'source'], ['c', 'source'], ['d', 'destination directory']]);
    assert.deepStrictEqual(operands('mv a b', 'ja'), [['a', '移動元'], ['b', '移動先（新しい名前、または既存のディレクトリ）']]);
    assert.deepStrictEqual(operands('cp a b c', 'ja')[2], ['c', 'コピー先のディレクトリ']);
  });

  it('ln: target; target and link name; targets and a directory', () => {
    assert.deepStrictEqual(operands('ln t')[0][1], 'target (the link is made in the current directory, with the same name)');
    assert.deepStrictEqual(operands('ln -s t l'), [['t', 'target'], ['l', 'link name (or an existing directory to make the link in)']]);
    assert.deepStrictEqual(operands('ln a b c d').map((o) => o[1]), ['target', 'target', 'target', 'directory to make the links in']);
    assert.deepStrictEqual(operands('ln -t d a b').map((o) => o[1]), ['target', 'target']);
    assert.deepStrictEqual(operands('ln -s t l', 'ja')[1][1], '作るリンクの名前（既存のディレクトリならその中に作る）');
  });

  it('install: the destination, except with -d or -t', () => {
    assert.deepStrictEqual(operands('install -m 755 a b').map((o) => o[1]), ['file to copy', 'destination (the new name, or an existing directory)']);
    assert.deepStrictEqual(operands('install a b c d').map((o) => o[1]), ['file to copy', 'file to copy', 'file to copy', 'destination directory']);
    assert.deepStrictEqual(operands('install -d x y').map((o) => o[1]), Array(2).fill('file to copy (a directory to create with `-d`)'));
    assert.deepStrictEqual(operands('install -t d a b').map((o) => o[1]), Array(2).fill('file to copy (a directory to create with `-d`)'));
  });

  it('rsync and scp: the last argument is the destination', () => {
    assert.deepStrictEqual(operands('rsync -a s d').map((o) => o[1]), ['source (trailing `/` matters)', 'destination']);
    assert.deepStrictEqual(operands('rsync -a s1 s2 d').map((o) => o[1]), Array(2).fill('source (trailing `/` matters)').concat('destination'));
    assert.match(operands('rsync -a s')[0][1], /^file or directory to list/);
    assert.deepStrictEqual(operands('scp a h:d').map((o) => o[1]), ['source (or `host:path`)', 'destination (or `host:path`)']);
    assert.strictEqual(operands('scp a b h:d')[2][1], 'destination directory (or `host:path`)');
  });

  it('tr, basename, mount, cmp and join', () => {
    assert.deepStrictEqual(operands('tr a-z A-Z').map((o) => o[1]), ['source character set (e.g. `a-z`)', 'target character set (e.g. `A-Z`)']);
    assert.deepStrictEqual(operands("tr -d ' '").map((o) => o[1]), ['character set to delete']);
    assert.deepStrictEqual(operands('basename /a/b .txt').map((o) => o[1]), ['path', 'suffix to remove']);
    assert.deepStrictEqual(operands('basename -a /a/b /c/d').map((o) => o[1]), ['path', 'path']);
    assert.deepStrictEqual(operands('basename /a/b').map((o) => o[1]), ['path']);
    assert.deepStrictEqual(operands('mount /mnt').map((o) => o[1]), ['device or mount point (the other is looked up in `/etc/fstab`)']);
    assert.deepStrictEqual(operands('mount /dev/sda1 /mnt').map((o) => o[1]), ['device', 'directory to mount on']);
    assert.deepStrictEqual(operands('mount -a /mnt').map((o) => o[1]), ['device']);
    assert.deepStrictEqual(operands('cmp a b 10 20').map((o) => o[1]), ['first file (`-` for stdin)', 'second file', 'bytes to skip in the first file', 'bytes to skip in the second file']);
    assert.deepStrictEqual(operands('join a b').map((o) => o[1]), ['first sorted file (`-` for stdin)', 'second sorted file (`-` for stdin)']);
  });

  it('marks the words past the operands a tool takes as extra operands, which it refuses (test/extra-operands-real.test.ts)', () => {
    const extra = 'extra operand, which the command refuses (it prints `extra operand` and exits with status 1, doing nothing)';
    assert.deepStrictEqual(operands('seq 1 2 3 4').map((o) => o[1]), ['first', 'increment', 'last', extra]);
    assert.deepStrictEqual(operands('basename /a/b .txt c').map((o) => o[1]), ['path', 'suffix to remove', extra]);
    assert.deepStrictEqual(operands('diff a b c').map((o) => o[1]), ['first file', 'second file', extra.replace('status 1', 'status 2')]);
    assert.deepStrictEqual(operands('diff --to-file=d a b c').map((o) => o[1]), ['first file', 'second file', 'second file']);
    assert.deepStrictEqual(operands('tr -d a b').map((o) => o[1]), ['character set to delete', extra.replace('`extra operand` and', '`extra operand` and `Only one string may be given when deleting without squeezing repeats.` and')]);
    assert.deepStrictEqual(operands('tr -d a b c').map((o) => o[1]), ['character set to delete', extra, extra]);
    assert.deepStrictEqual(operands('mktemp a.XXX b', 'ja')[1], ['b', '余分なオペランド（コマンドは受け付けず、`too many templates` と表示して何もせずに終了ステータス 1 で終わる）']);
  });

  it('keeps what follows the description (glob notes) and leaves quoted words described', () => {
    assert.match(new Analyzer('en').explainLine(parser.parse('cp *.txt d/'), 0).items[0].children[0].explanation, /^source — Glob pattern \(shell wildcards\): expands to the matching file names/);
    assert.deepStrictEqual(operands('cp "$a" "$b"').map((o) => o[1]), ['source', 'destination (the new name, or an existing directory)']);
  });
});
