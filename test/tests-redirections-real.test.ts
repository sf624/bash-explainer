// What we say of tests (`[ ]`, `[[ =~ ]]`), redirections (here-documents and here-strings on a descriptor, brace
// expansion and `/dev/tcp` in a target), process substitutions read as input, and a tilde before a glob, checked
// against bash (and dash, where the shells differ).
import * as assert from 'assert';
import { spawnSync } from 'child_process';
import { Analyzer } from '../src/analyzer';
import type { Example, Token } from '../src/analyzer-types';
import { featuresOnLine } from '../src/dialect';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { partAt } from '../src/ui/hoverParts';
import { partHover, plainPartHover } from '../src/ui/hoverView';
import { runBash } from './support/bash';
import { allTokens, explain } from './support/explain';

const parser = createUnbashParser();
const tokens = (src: string, lang: 'en' | 'ja' = 'en', shell?: 'bash' | 'dash' | 'sh'): Token[] =>
  allTokens(new Analyzer(lang).explainLine(parser.parse(src), 0, shell).items);
const token = (src: string, label: string, lang: 'en' | 'ja' = 'en', shell?: 'bash' | 'dash' | 'sh'): Token => {
  const t = tokens(src, lang, shell).filter((x) => x.label === label).pop();
  assert.ok(t, `a token ${label} in ${src}`);
  return t;
};
const examples = (src: string, lang: 'en' | 'ja' = 'en'): Example[] => explain(src, 0, lang).examples;
const bash = (script: string) => runBash(script);
const hasDash = spawnSync('dash', ['-c', 'exit 0']).status === 0;

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
    assert.ok(ex.notes.includes('Redirections apply left to right. In the end: stdin → the here-document, fd 3 → the here-document'), ex.notes.join('\n'));
    assert.ok(explain(src, 0, 'ja').notes.includes('リダイレクトは左から順に適用される。最終的に: 標準入力 → ヒアドキュメント、fd 3 → ヒアドキュメント'));
    const doc = token(src, '3<<EOF');
    assert.match(doc.explanation, /^Here-document: the following lines up to a line containing only `EOF` become file descriptor 3\./);
    assert.match(token(src, '3<<EOF', 'ja').explanation, /^ヒアドキュメント: 次の行から `EOF` だけの行までをファイルディスクリプタ 3として渡す/);
    assert.match(token('cat <<EOF\nx\nEOF', '<<EOF').explanation, /become stdin\./);
    assert.strictEqual(bash(`${src}\n`).stdout, 'body\n');
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
    assert.ok(!/Connect/.test(token('echo x 2>&/dev/tcp/h/80', '2>&/dev/tcp/h/80').explanation));
    // bash tries to connect (port 9 has no server here): no file is opened, and none is made.
    const r = runBash('exec 3<>/dev/tcp/127.0.0.1/9; echo after', { files: [] });
    assert.match(r.stderr, /connect: Connection refused/);
    assert.strictEqual(runBash('echo x > /dev/tcp/127.0.0.1/9; ls /dev/tcp 2>&1 | grep -c "No such"').stdout, '1\n');
  });

  it('are an ordinary path in sh and dash, which the dialect check reports', () => {
    for (const shell of ['sh', 'dash'] as const) {
      const t = token('exec 3<>/dev/tcp/127.0.0.1/9', '3<>/dev/tcp/127.0.0.1/9', 'en', shell);
      assert.match(t.explanation, /^Open `\/dev\/tcp\/127\.0\.0\.1\/9` for reading and writing as file descriptor 3\. In (POSIX sh|dash), `\/dev\/tcp\/…` is an ordinary path, usually missing \(only bash and ksh93 connect to the network for it\)$/);
    }
    assert.match(token('cat < /dev/tcp/h/80', '< /dev/tcp/h/80', 'ja', 'dash').explanation, /。dash では `\/dev\/tcp\/…` も普通のファイル名で、ふつうは存在しない/);
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
    assert.strictEqual(ex[0].sections[0].label, 'Input: output of `curl -s url` (the pipe `<(curl -s url)` names, sample contents)');
    assert.strictEqual(examples('jq . <(curl -s url)', 'ja')[0].sections[0].label, '入力: `curl -s url` の出力（`<(curl -s url)` が名前を渡すパイプ、中身の例）');
    const sorted = examples('sort <(cmd) <(cmd2)')[0].sections.map((s) => s.label);
    assert.deepStrictEqual(sorted.slice(0, 2), ['Input: output of `cmd` (the pipe `<(cmd)` names, sample contents)', 'Input: output of `cmd2` (the pipe `<(cmd2)` names, sample contents)']);
    // Read as stdin through `<`.
    assert.strictEqual(examples('sort < <(cmd)')[0].sections[0].label, 'Input: stdin (output of `cmd` through `<(cmd)`, sample contents)');
    assert.strictEqual(examples('sort < <(cmd)', 'ja')[0].sections[0].label, '入力: 標準入力（`cmd` の出力、`<(cmd)` のパイプ、中身の例）');
    // A file name the example cannot know (`/dev/fd/63`): no headers of head, no `FILENAME` of awk.
    assert.deepStrictEqual(examples('head -n 1 a <(cmd)').filter((e) => e.sections.some((s) => /==>/.test(s.lines.join('\n')))), []);
    assert.deepStrictEqual(examples("awk '{ print FILENAME }' <(cmd)"), []);
    // bash gives the command a name in /dev/fd for a pipe, and reads the command's output from it.
    assert.match(bash('echo <(true); [ -p <(true) ] && echo pipe; cat <(echo out); awk "{ print FILENAME }" <(echo x)').stdout, /^\/dev\/fd\/\d+\npipe\nout\n\/dev\/fd\/\d+\n$/);
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
    const t = allTokens(analyzer.explainLine(parser.parse('cat 3<<'), 0).items).find((x) => x.label === '3<<')!;
    assert.match(t.explanation, /the delimiter is not written yet\. The following lines up to a line containing only the delimiter become file descriptor 3$/);
  });
});
