// `command-refused` (src/messages-facts-commands.ts): a command line its tool refuses before it reads anything (a usage
// error, every time), as the spec states it (src/argv/spec.ts, `Refused`) and the parse reads it (`ArgvParse.refused`,
// src/argv/refusals.ts). Each case runs in the real tool (GNU coreutils, grep, tar, diffutils on the PATH of
// test/support/bash.ts, in the C locale), all in one bash: the note quotes what the tool printed first, with its status;
// the line has no example; the document's problems hold an error, which fails `--check`. The near misses say nothing.
import * as assert from 'assert';
import { Analyzer } from '../src/analyzer';
import type { LineExplanation } from '../src/analyzer-types';
import { documentIssues } from '../src/document';
import { failsCheck } from '../src/levels';
import type { Fact } from '../src/messages';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { runBash } from './support/bash';
import { allTokens } from './support/explain';

const ID = 'command-refused';
const parser = createUnbashParser();
const analyzers = { en: new Analyzer('en'), ja: new Analyzer('ja') };
const explain = (src: string, lang: 'en' | 'ja' = 'en'): LineExplanation => analyzers[lang].explainLine(parser.parse(src), 0);
const note = (src: string, lang: 'en' | 'ja' = 'en'): Fact | undefined => explain(src, lang).facts?.find((f) => f.id === ID);
const problems = (src: string) => documentIssues({ lines: `#!/bin/bash\n${src}`.split('\n'), tree: parser.parse(`#!/bin/bash\n${src}`) }, 'en', {});

/** Each line in one bash, in a directory with the empty file `f` and nothing on stdin: its status and the first line of its stderr. */
function real(lines: readonly string[], env: NodeJS.ProcessEnv = {}): { status: number; said: string }[] {
  const script = lines.map((l) => `e=$( { ${l} ; } 2>&1 >/dev/null </dev/null ); printf '%s\\0%s\\0' "$?" "\${e%%$'\\n'*}"`).join('\n');
  const r = runBash(script, { files: ['f'], env });
  const parts = r.stdout.split('\0');
  return lines.map((_, i) => ({ status: Number(parts[2 * i]), said: parts[2 * i + 1] }));
}

/** A text as a code span: fenced by two backticks where it holds one. */
const code = (t: string): string => (t.includes('`') ? `\`\` ${t} \`\`` : `\`${t}\``);

describe('a command line its tool refuses', () => {
  // The line, the start of what the note says, and whether only GNU's tool refuses it (a warning, not an error).
  const refused: [string, string, boolean?][] = [
    ["cut -d '\\t' -f2 f", 'cut refuses the value `\\t` of `-d`'],
    ['cut -dé -f1 f', 'GNU cut refuses the value `é` of `-d`', true],
    ['cut -d ab -f1 f', 'cut refuses the value `ab` of `-d`'],
    ['cut --delimiter=、 -f1 f', 'GNU cut refuses the value `、` of `--delimiter`', true],
    ['cut -f 0 f', 'cut refuses the value `0` of `-f`'],
    ['cut -f 0-3 f', 'cut refuses the value `0-3` of `-f`'],
    ['cut -f 1,0 f', 'cut refuses the value `1,0` of `-f`'],
    ['cut -c 0 f', 'cut refuses the value `0` of `-c`'],
    ['cut -b0 f', 'cut refuses the value `0` of `-b`'],
    ['cut -f 1-0 f', 'cut refuses the value `1-0` of `-f`'],
    ['cut -f -0 f', 'cut refuses the value `-0` of `-f`'],
    ['cut -f 3-1 f', 'cut refuses the value `3-1` of `-f`'],
    ['cut -f 3-1,0 f', 'cut refuses the value `3-1,0` of `-f`'],
    ['cut -f 0,3-1 f', 'cut refuses the value `0,3-1` of `-f`'],
    ['cut -f 0 -d ab f', 'cut refuses the value `ab` of `-d`'],
    ['cut -f 0 -- f', 'cut refuses the value `0` of `-f`'],
    ['cut -c1 -f1 f', 'cut refuses `-f` with `-c`'],
    ['cut -f1 -f2 f', 'GNU cut refuses a second `-f`', true],
    ['cut -b1 -c1 f', 'GNU cut refuses `-c` with `-b`', true],
    ['cut -c1 -f 0 f', 'cut refuses `-f` with `-c`'],
    ['cut f', 'cut refuses to run without one of `-f`, `-c` or `-b`'],
    ['cut', 'cut refuses to run without one of `-f`, `-c` or `-b`'],
    ['cut -s -d , f', 'cut refuses to run without one of `-f`, `-c` or `-b`'],
    ['sort -k 0 f', 'sort refuses the value `0` of `-k`'],
    ['sort -k0,1 f', 'sort refuses the value `0,1` of `-k`'],
    ['sort -k 1.0 f', 'sort refuses the value `1.0` of `-k`'],
    ['sort -k 1,0 f', 'sort refuses the value `1,0` of `-k`'],
    ['sort -nk 0n f', 'sort refuses the value `0n` of `-k`'],
    ["sort -k ' +0' f", 'sort refuses the value ` +0` of `-k`'],
    ["sort -t '\\t' -k2 f", 'sort refuses the value `\\t` of `-t`'],
    ['sort -t ab -k 0 f', 'sort refuses the value `ab` of `-t`'],
    ["sort -t 'a b' f", 'sort refuses the value `a b` of `-t`'],
    ["sort -t \"a'b\" f", "sort refuses the value `a'b` of `-t`"],
    ['sort -t é f', 'GNU sort refuses the value `é` of `-t`', true],
    ["sort -t '' f", 'sort refuses the value `` of `-t`'],
    ["join -t '\\t' f f", 'join refuses the value `\\t` of `-t`'],
    ['join -t ab f f', 'join refuses the value `ab` of `-t`'],
    ['grep -E -F a f', 'GNU grep refuses `-F` with `-E`', true],
    ['grep -G -E a f', 'GNU grep refuses `-E` with `-G`', true],
    ['grep -EP a f', 'GNU grep refuses `-P` with `-E`', true],
    ['tar -c -x -f f', 'tar refuses `-x` with `-c`'],
    ['tar cxf f', 'tar refuses `x` with `c`'],
    ['tr a', 'tr refuses `a` alone'],
    ['tr -ds a', 'tr refuses `a` alone'],
    ['tr -d a b', 'tr refuses the extra operand `b`'],
    ['tr a b c', 'tr refuses the extra operand `c`'],
    ['head -n x f', 'head refuses the value `x` of `-n`'],
    ['head -n -x f', 'head refuses the value `-x` of `-n`'],
    ["head -n '' f", 'head refuses the value `` of `-n`'],
    ['head -n --5 f', 'head refuses the value `--5` of `-n`'],
    ['head --bytes=x f', 'head refuses the value `x` of `--bytes`'],
    ['tail -n x f', 'tail refuses the value `x` of `-n`'],
    ['tail -n +x f', 'tail refuses the value `+x` of `-n`'],
    ['tail -c- f', 'tail refuses the value `-` of `-c`'],
    ['basename a b c', 'basename refuses the extra operand `c`'],
    ['date +%F +%T', 'date refuses the extra operand `+%T`'],
    ['date -d now x', 'date refuses the operand `x`'],
    ['uniq f f f', 'uniq refuses the extra operand `f`'],
    ['seq 1 2 3 4', 'seq refuses the extra operand `4`'],
    ['diff f f f', 'diff refuses the extra operand `f`'],
    ['getconf a b c', 'getconf refuses the extra operand `c`'],
    // (The words of a brace expansion, as bash gives them; a variable the script sets.)
    ['basename {a,b} c', 'basename refuses the extra operand `c`'],
    ['o=-d; cut "$o" ab -f1 f', 'cut refuses the value `ab` of `-d`'],
  ];

  it('quotes what the tool prints, as its English message, with its status; an error, or a warning where only GNU refuses; no example', () => {
    const runs = real(refused.map(([line]) => line));
    for (const [i, [line, start, gnu]] of refused.entries()) {
      const { status, said } = runs[i];
      const ex = analyzers.en.explainLine(parser.parse(line), line.split('\n').length - 1);
      const f = ex.facts?.find((x) => x.id === ID);
      assert.ok(f, line);
      assert.strictEqual(f.level, gnu ? 'warning' : 'error', line);
      // (The tool's own first line, as code, named as GNU's English message, and its status.)
      assert.ok(said && status > 0, `${line}: ${status} ${said}`);
      const tool = start.split(' ')[gnu ? 1 : 0];
      const prints = gnu ? `${start}: it prints ${code(said)}` : `${start}. GNU ${tool} prints ${code(said)}`;
      assert.ok(f.body.startsWith(prints), `${line}\n${f.body}\n${prints}`);
      assert.ok(/ \(its messages? in English\),? and exits with status \d, doing nothing/.test(f.body) && f.body.includes(`status ${status},`), `${line}: ${f.body}`);
      // (What bash makes of a word stays: the words of `{a,b}`.)
      assert.deepStrictEqual((ex.examples ?? []).filter((e) => e.kind !== 'glob' && e.kind !== 'expansion'), [], line);
      // (A problem of the document; an error fails `--check`, a warning only `--check --strict`.)
      const p = problems(line).filter((x) => x.code === ID);
      assert.strictEqual(p.length, 1, line);
      assert.deepStrictEqual([failsCheck(p[0].severity, false), failsCheck(p[0].severity, true)], [!gnu, true], line);
    }
  });

  it('says it once, on the word at fault, or on the command where no word is', () => {
    const anchor = (line: string) => {
      const ex = explain(line);
      return ex.anchors!.filter((a) => a.code === ID).map((a) => line.slice(a.span.start.character, a.span.end.character));
    };
    assert.deepStrictEqual(anchor("cut -d '\\t' -f2 f"), ["'\\t'"]);
    assert.deepStrictEqual(anchor('cut -dé -f1'), ['-dé']);
    assert.deepStrictEqual(anchor('grep -E -F a'), ['-F']);
    assert.deepStrictEqual(anchor('tr a'), ['a']);
    assert.deepStrictEqual(anchor('cut f'), ['cut f']);
    assert.deepStrictEqual(anchor('sudo cut -d ab -f1 f'), ['ab']);
    // (The row says what the word is; the note says why the tool refuses it, and the tab hint, once.)
    const ex = explain("cut -d '\\t' -f2 f");
    assert.strictEqual(allTokens(ex.items).find((t) => t.valueFor === '-d')!.explanation, 'Value for `-d`');
    assert.strictEqual(ex.notes.filter((n) => n.includes('the delimiter must be a single character')).length, 1);
    assert.ok(ex.notes.some((n) => n.endsWith("Tab is the default delimiter: leave out `-d`, or write `-d $'\\t'`")));
    // (The word at fault is read in no language of the command: `0` is no field list; the others read as they do.)
    assert.ok(!allTokens(explain('cut -f 0 f').items).some((t) => /field 0/.test(t.explanation)));
    assert.ok(allTokens(explain('cut -dé -f1 f').items).some((t) => t.explanation === 'field 1'));
  });

  it('runs no example of a stage its tool refuses, nor of the stages after it, nor of the whole pipeline', () => {
    for (const [line, from] of [["printf 'a\\tb\\n' | cut -d '\\t' -f2", 'cut'], ['seq 3 | head -n x', 'head'], ['seq 3 | sort -k 0 | head -n 1', 'sort'],
      ["printf 'a\\n' | sudo cut -d ab -f1", 'sudo'], ["cut -d '\\t' -f2 f | sort -u", 'cut'], ['cat f | cut -f 0 | sort', 'cut'], ["printf 'b\\na\\n' | sort -k 0 | head -n 1", 'sort']]) {
      assert.ok(note(line), line);
      const at = line.indexOf(`${from} `);
      const examples = explain(line).examples ?? [];
      assert.deepStrictEqual(examples.filter((e) => e.kind === 'pipeline' || e.anchor!.start.character >= at).map((e) => e.title), [], line);
      // (The stages before it are unaffected: `printf`'s output, `seq`'s.)
      if (at > 0 && !line.startsWith('cat')) assert.ok(examples.length > 0, line);
    }
  });

  it('says the same in Japanese, and names GNU where only its tool refuses the line', () => {
    assert.strictEqual(note("cut -d '\\t' -f2", 'ja')!.text, "ⓧ エラー: cut は `-d` の値 `\\t` を受け付けない。GNU の cut は英語のメッセージ `cut: the delimiter must be a single character` を表示し、何もせずに終了ステータス 1 で終わる。"
      + "cut は `\\t` をタブとして読まない（バックスラッシュと `t` の2文字）。タブは既定の区切り文字なので、`-d` を書かないか、`-d $'\\t'` と書く");
    assert.strictEqual(note('cut -dé -f1', 'ja')!.body, 'GNU の cut は `-d` の値 `é` を受け付けない。英語のメッセージ `cut: the delimiter must be a single character` を表示し、何もせずに終了ステータス 1 で終わる。'
      + '区切り文字は1バイトでなければならず、`é` は1文字だが、UTF-8 では2バイトになる');
    assert.strictEqual(note('tr a', 'ja')!.text, "ⓧ エラー: tr は `a` 1つだけでは受け付けない。GNU の tr は英語のメッセージ `tr: missing operand after 'a'`、続けて `Two strings must be given when translating.` を表示し、何もせずに終了ステータス 1 で終わる");
    assert.strictEqual(note("sort -t '\\t' -k2", 'ja')!.text, "ⓧ エラー: sort は `-t` の値 `\\t` を受け付けない。GNU の sort は英語のメッセージ `sort: multi-character tab '\\\\t'` を表示し、何もせずに終了ステータス 2 で終わる。"
      + "sort は `\\t` をタブとして読まない（バックスラッシュと `t` の2文字）。タブで区切るには `-t $'\\t'` と書く");
    assert.strictEqual(note('cut f', 'ja')!.text, 'ⓧ エラー: cut は `-f`・`-c`・`-b` のどれかがないと受け付けない。GNU の cut は英語のメッセージ `cut: you must specify a list of bytes, characters, or fields` を表示し、何もせずに終了ステータス 1 で終わる');
    assert.strictEqual(note('cut -f1 -f2', 'ja')!.body.startsWith('GNU の cut は2つ目の `-f` を受け付けない。'), true);
    assert.ok(note('cut -d ab -f1 f')!.text.endsWith('The delimiter must be one byte, and `ab` is 2 characters'));
    assert.ok(note('cut -dé -f1 f')!.text.endsWith('The delimiter must be one byte, and `é` is one character, but 2 bytes in UTF-8'));
    assert.strictEqual(problems('grep -E -F a f').find((p) => p.code === ID)!.head, 'GNU grep refuses this command line and does nothing.');
    // (Another tool than GNU's says whose message it quotes.)
    assert.ok(note('pgrep a b')!.body.includes('. procps pgrep prints `pgrep: only one pattern can be provided` (its message in English)'));
    // (It cites the node of the coreutils manual on the tool's words, where there is one.)
    assert.deepStrictEqual([note('cut f')!.refs, note('seq 1 2 3 4')!.refs], [['coreutils-cut-invocation'], ['3.7.5']]);
  });

  it('says nothing where the tool takes the line, or where a word not known may make it take it', () => {
    // (The words not known here come from the environment: the run gives them values the tool takes. A word that may be
    // `--help`, `--` or `-e` before the word at fault, or a known one that is: the tool may run.)
    const lines = ["cut -d $'\\t' -f2 f", "cut -d ' ' -f1 f", 'cut -d "$d" -f1 f', 'cut -f "$n" f', 'cut "$o" f', 'cut -f1 f', 'cut --help', 'cut -f 0 --help', 'cut --version f',
      'sort -k 1 f', 'sort -k 2,1.0 f', 'sort -k "$k" f', "sort -t $'\\t' -k2 f", "sort -t '\\0' f", 'sort -t , f', "join -t $'\\t' f f", 'head -n 5 f', 'head -n -5 f', 'head -n 1k f', "head -n ' 5' f", 'tail -n +5 f', 'head -n "$n" f',
      'grep -E a f', 'grep -E -E a f', 'grep -F --fixed-strings a f', 'tr a b', 'tr -d a', 'tr $t', 'tr --help', 'basename a b', 'basename a b $e', 'date +%F', 'tar -c -f - f', 'cut -s -f1 f',
      'cut "$h" -d ab -f1 f', 'cut $h -d ab -f1 f', 'head "$h" -n x f', 'sort "$h" -k 0 f', 'tar "$h" -c -x -f a', 'grep "$p" -E -F f', 'h=--help; cut "$h" -d ab -f1 f', 'tar -c --usage -x'];
    const runs = real(lines, { d: ',', n: '2', o: '-f1', k: '1', t: 'a b', e: '', h: '--help', p: '-e' });
    for (const [i, line] of lines.entries()) {
      // (The tool takes it: no message; grep finds no line, status 1.)
      assert.strictEqual(runs[i].said, '', `${line}: ${runs[i].said}`);
      assert.ok(runs[i].status === 0 || (line.startsWith('grep') && runs[i].status === 1), `${line}: ${runs[i].status}`);
      const ex = analyzers.en.explainLine(parser.parse(line), 0);
      assert.strictEqual(ex.facts?.find((f) => f.id === ID), undefined, line);
      assert.ok(!problems(line).some((p) => p.code === ID), line);
    }
    // (`"$@"` before the word at fault may be `-e`: `set -- -e` makes grep take `-F` as its pattern.)
    assert.strictEqual(note('grep -E "$@" -F f'), undefined);
    assert.deepStrictEqual(real(['set -- -e; grep -E "$@" -F f'])[0], { status: 1, said: '' });
    // (A line the tool takes still has its example.)
    assert.notDeepStrictEqual(explain("printf 'a,b\\n' | cut -d , -f2").examples ?? [], []);
    // (After a sure stop the shell never gets there: neither an error nor a warning is said, `reachedAt`.)
    for (const line of ['cut -d ab -f1 f', 'cut -dé -f1 f']) assert.strictEqual(analyzers.en.explainLine(parser.parse(`exit 0\n${line}`), 1).facts?.find((f) => f.id === ID), undefined, line);
    // (`builtin cut` finds no builtin: bash fails before cut runs.)
    assert.strictEqual(note('builtin cut -f 0 f'), undefined);
    // (A function of the script is not the program.)
    assert.strictEqual(analyzers.en.explainLine(parser.parse('cut() { :; }\ncut -d ab -f1 f'), 1).facts?.find((f) => f.id === ID), undefined);
  });

  it('runs no example where the tool refuses the line unless a later word is `--help`, and says it after `--`', () => {
    // (`cut -f 0 "$f"`: whatever `$f` is, cut refuses the line or prints its help: no output to show, and nothing said.)
    for (const line of ['cut -f 0 "$f"', 'cut -d ab -f1 "$f"', 'head -n x "$f"', "printf 'a\\n' | cut -f 0 $f"]) {
      assert.strictEqual(note(line), undefined, line);
      assert.deepStrictEqual((explain(line).examples ?? []).filter((e) => e.kind !== 'glob' && e.kind !== 'printf'), [], line);
    }
    assert.deepStrictEqual(real(['cut -f 0 "$f"', 'cut -f 0 "$h"', 'cut -f 0 -- "$f"'], { f: 'f', h: '--help' }).map((r) => r.status), [1, 0, 1]);
    // (After `--`, a word is an operand: cut refuses the line whatever it is.)
    assert.ok(note('cut -f 0 -- "$f"'));
  });

  it('leaves out what the tool refuses with a message of its own, not stated', () => {
    // (head: a suffix it does not know; sort: "invalid number at field start", also for a full-width space; cut: an empty item.)
    // (Nor where a word may give several words, or an option the spec does not know comes first.)
    const lines = ['cut -f 1,,2 f', 'head -n 5x f', 'sort -k x f', 'sort -k -0 f', 'sort -k 1.x f', "sort -k '　0' f", 'basename a b *.txt', 'cut --bogus -f 0 f'];
    const runs = real(lines);
    for (const [i, line] of lines.entries()) {
      assert.ok(runs[i].status > 0 && runs[i].said, line);
      assert.strictEqual(note(line), undefined, line);
    }
  });
});
