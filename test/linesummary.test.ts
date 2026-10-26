// (Prototype B) The one-sentence summary of a line (src/linesummary.ts) and the note of the whole-pipeline example of a
// pattern that is a variable's example value: each sentence is built from the words of the line and the models.
import * as assert from 'assert';
import { Analyzer } from '../src/analyzer';
import { createUnbashParser } from '../src/syntax/adapters/unbash';

const parser = createUnbashParser();
const summary = (src: string, line: number, lang: 'en' | 'ja' = 'en'): string | undefined => new Analyzer(lang).explainLine(parser.parse(src), line - 1, 'bash', { reading: true })?.reading?.summary;
const notes = (src: string, line: number, lang: 'en' | 'ja' = 'en'): string[] => new Analyzer(lang).explainLine(parser.parse(src), line - 1, 'bash')!.examples.flatMap((e) => (e.note ? [e.note] : []));

describe('the summary of `wc -l` in a loop', () => {
  it('names the current file of the enclosing loop', () => {
    const src = 'for f in *.txt; do\n  wc -l "$f"\ndone';
    assert.strictEqual(summary(src, 2), 'Counts the lines of the current file `$f` (from the loop on line 1).');
    assert.strictEqual(summary(src, 2, 'ja'), 'ループ（1 行目）の今のファイル `$f` の行数を数える。');
    assert.strictEqual(summary('for f in a b; do\n  wc -l ${f}\ndone', 2), 'Counts the lines of the current file `$f` (from the loop on line 1).');
    // (The loop line keeps its own sentence.)
    assert.match(summary(src, 1)!, /^Prints the number of lines of each file matching `\*\.txt`/);
  });
  it('says the word as it is when it is not the loop variable', () => {
    assert.strictEqual(summary('wc -l a.txt', 1), 'Counts the lines of `a.txt`.');
    assert.strictEqual(summary('wc -l a.txt', 1, 'ja'), '`a.txt` の行数を数える。');
    assert.strictEqual(summary('for f in a b; do\n  wc -l "$g"\ndone', 2), 'Counts the lines of `$g`.');
    assert.strictEqual(summary('wc -l "$f"', 1), 'Counts the lines of `$f`.');
  });
  it('says nothing for other options, operands or redirections', () => {
    for (const src of ['wc -w a.txt', 'wc -l a b', 'wc -l', 'wc -l a > out', 'wc -l -- a']) assert.strictEqual(summary(src, 1), undefined, src);
  });
});

describe('the summary of an assignment', () => {
  it('says the variable and its value, with what the value holds', () => {
    assert.strictEqual(summary('a=1', 1), 'Sets the variable `a` to `1`.');
    assert.strictEqual(summary('a=1', 1, 'ja'), '変数 `a` に `1` を代入する。');
    assert.strictEqual(summary('backup="${HOME}/backup-$(date +%F).tar.gz"', 1), 'Sets the variable `backup` to `"${HOME}/backup-$(date +%F).tar.gz"` (`$(date +%F)` is replaced by the output of `date +%F`; `${HOME}`: your home directory).');
    assert.strictEqual(summary('backup="${HOME}/backup-$(date +%F).tar.gz"', 1, 'ja'), '変数 `backup` に `"${HOME}/backup-$(date +%F).tar.gz"` を代入する（`$(date +%F)` は `date +%F` の出力に置き換わる。`${HOME}` はあなたのホームディレクトリ）。');
    assert.strictEqual(summary('d=~/docs', 1), 'Sets the variable `d` to `~/docs` (`~`: your home directory).');
    assert.strictEqual(summary('h=$HOME/x', 1), 'Sets the variable `h` to `$HOME/x` (`$HOME`: your home directory).');
    assert.strictEqual(summary('e=', 1), 'Sets the variable `e` to an empty value.');
    assert.strictEqual(summary('x=$(a)$(b)$(c)', 1), 'Sets the variable `x` to `$(a)$(b)$(c)` (`$(a)` is replaced by the output of `a`; `$(b)` is replaced by the output of `b`).');
  });
  it('says nothing for several assignments, a command, an array or a redirection', () => {
    for (const src of ['a=1 b=2', 'a=1 true', 'a=(x y)', 'a=1 >f']) assert.strictEqual(summary(src, 1), undefined, src);
  });
});

describe('the summary of a sourced file', () => {
  const src = 'if [[ -f config.ini && $DEBUG == 1 ]]; then source config.ini; fi';
  it('points to the risk when the name has no slash, so `$PATH` is searched first', () => {
    assert.strictEqual(summary(src, 1), 'Runs a file named `config.ini` (see the risk: it may be one found in `$PATH`) in this shell (`source`) if it is an existing regular file and `$DEBUG` is `1`, so the variables and functions it sets stay; otherwise does nothing.');
    assert.strictEqual(summary(src, 1, 'ja'), '`config.ini` という名前のファイル（注意点を参照: `$PATH` で見つかったものかもしれない）をこのシェルで実行する（`source`）。実行するのは `config.ini` が存在する通常のファイルで、かつ `$DEBUG` が `1` のときだけ。中で設定した変数や関数はこのシェルに残る。');
  });
  it('is as before for a path, with `sourcepath` off, and in zsh', () => {
    assert.match(summary('if [[ -f ./config.ini ]]; then source ./config.ini; fi', 1)!, /^Runs `\.\/config\.ini` in this shell/);
    assert.match(summary(`shopt -u sourcepath\n${src}`, 2)!, /^Runs `config\.ini` in this shell/);
  });
});

describe('the note of a pipeline example whose pattern is a variable', () => {
  const src = 'grep -h "$USER" /var/log/*.log | sort | uniq -c | sort -rn | head -5';
  it('says which lines are left out and that the value matches inside a longer word', () => {
    assert.deepStrictEqual(notes(src, 1), ['Here `$USER` is `alice`: an example value (the real one is known only when it runs). Lines without the whole text `alice` (`alic`, `lice`) are left out. `malice` matches too: grep finds `alice` inside longer text (see the risk).']);
    assert.deepStrictEqual(notes(src, 1, 'ja'), ['ここでは `$USER` を `alice` とした（例の値。実際の値は実行するまで分からない）。`alice` という文字列を丸ごと含まない行（`alic`、`lice`）は除かれる。`malice` も一致する。grep は `alice` を長い文字列の中にも見つける（注意点を参照）。']);
  });
  it('shows the longer line in the input and in the output of grep', () => {
    // (Round 9: the glob's names to try stay too; the pipeline's example is the one of kind `pipeline`.)
    const ex = new Analyzer('en').explainLine(parser.parse(src), 0, 'bash')!.examples.find((e) => e.kind === 'pipeline')!;
    assert.ok(ex.sections[0].lines.includes('malice'));
    assert.ok(ex.sections[1].lines.includes('malice'));
  });
  it('does not claim it for a fixed string or whole words', () => {
    for (const s of ['grep -F -h "$USER" /var/log/*.log | sort | uniq -c', 'grep -w -h "$USER" /var/log/*.log | sort | uniq -c']) {
      assert.ok(!notes(s, 1).join('').includes('malice'), s);
    }
  });
});
