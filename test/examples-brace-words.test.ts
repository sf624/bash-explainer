// The example of a brace expansion (src/explain/examples.ts `wordExample`): the words it makes, as a section of words
// (`ExampleSection.words`) that the outputs draw as separate words, and what `echo` or `printf` prints with them. Both
// are compared with bash, run in an empty directory.
import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Example, ExampleSection } from '../src/analyzer-types';
import { Analyzer } from '../src/analyzer';
import { detectShell } from '../src/dialect';
import { shownWord } from '../src/messages';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { wordsHtml } from '../src/ui/hoverView';
import { examplesMarkdown, toPlainMarkdown, wordsMarkdown } from '../src/ui/render';
import { explain } from './support/explain';

/** Runs `script` with bash (or `shell`) in a new empty directory: what it prints. */
function bash(script: string, shell = 'bash'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explain-bash-brace-'));
  try {
    return execFileSync(shell, ['-c', script], { cwd: dir }).toString();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const braceExamples = (line: string, lang: 'en' | 'ja' = 'en'): Example[] => explain(line, 0, lang).examples.filter((e) => /brace expansion|ブレース展開/.test(e.title));
/** The examples of the second line of `src`, explained as the shell its shebang names. */
const parser = createUnbashParser();
const examplesAs = (src: string): Example[] => new Analyzer('en').explainLine(parser.parse(src), 1, detectShell(src, 'a.sh')).examples;
const wordsOf = (e: Example): ExampleSection => e.sections.find((s) => s.words)!;
const printedOf = (e: Example): ExampleSection | undefined => e.sections.find((s) => !s.words);

describe('the example of a brace expansion', () => {
  // [line, whether the example shows what the command prints]
  const cases: [string, boolean][] = [
    ['echo {1..10..3}', true],
    ['touch file{1..3}.txt', false],
    ["printf '%s\\n' {a,b}{1,2}", true],
    ['echo {Z..a}', true],
    ['echo {a\\ ,b}', true],
    ['echo x{1..3}y {a,b}', true],
    ["printf '%s-' {1..20}", true],
    ['echo {1..100}', true],
    ['echo {01..10..3} done', true],
    ['mkdir -p project/{src,test,docs}', false],
    ['cp config.yml{,.bak}', false],
    // Options and backslashes of echo, and a glob after the expansion, are not run: no output.
    ['echo -n {a,b}', false],
    ['echo {a,b}\\\\n', false],
    ['echo {a,b} *.txt', false],
    ['echo {a,b}*.c', false],
    ['echo ~/{a,b}', false],
    ["printf '%s\\n' {a,b}.c *.h", false],
  ];
  for (const [line, printed] of cases) {
    it(line, () => {
      const all = braceExamples(line);
      assert.ok(all.length, `an example for ${line}`);
      for (const e of all) {
        const word = /`([^`]+)`\)$/.exec(e.title)![1];
        // (The example shows the words of brace expansion, before a tilde in them is expanded: `HOME='~'` keeps it.)
        const real = [...bash(`HOME='~'; printf '<%s>' ${word}`).matchAll(/<([^>]*)>/g)].map((m) => m[1]);
        const sec = wordsOf(e);
        const shown = (real.length > 12 ? real.slice(0, 11) : real).map(shownWord);
        assert.deepStrictEqual(sec.lines, shown.map((w) => w.text), word);
        assert.deepStrictEqual(sec.words!.ends, shown.map((w) => w.ends), word);
        assert.match(sec.label, new RegExp(`^Resulting words \\(${real.length} separate arguments? of \``));
        if (real.length > 12) assert.strictEqual(sec.words!.after, `… ${real.length} words in all`);
      }
      // What the command prints is under the last word that expands, and it is what bash prints.
      const out = all.map(printedOf);
      assert.deepStrictEqual(out.slice(0, -1).filter(Boolean), []);
      assert.strictEqual(!!out[out.length - 1], printed, line);
      const sec = out[out.length - 1];
      if (!sec) return;
      const got = bash(line);
      const lines = (got.endsWith('\n') ? got.slice(0, -1) : got).split('\n');
      const cut = (l: string, i: number) => (sec.lines[i].endsWith('…') && sec.lines[i] !== l ? l.slice(0, sec.lines[i].length - 1) + '…' : l);
      if (sec.lines.length === 12 && lines.length > 12) assert.deepStrictEqual(sec.lines, [...lines.slice(0, 11), '…']);
      else assert.deepStrictEqual(sec.lines, lines.map(cut));
      assert.match(sec.label, got.endsWith('\n') ? /^Output$/ : /^Output \(no trailing newline\)$/);
    });
  }

  it('says what the marks are: a space at an end, an empty word', () => {
    assert.strictEqual(wordsOf(braceExamples('echo {a\\ ,b}')[0]).words!.after, '(`␣` is a space at an end)');
    assert.strictEqual(wordsOf(braceExamples('echo {a\\ ,b}')[0]).words!.spaceLabel, 'space');
    assert.strictEqual(wordsOf(braceExamples('echo {Z..a}')[0]).words!.after, '(`∅` is an empty word)');
    assert.strictEqual(wordsOf(braceExamples('echo {Z..a}', 'ja')[0]).words!.after, '（`∅` は空の単語）');
    assert.strictEqual(wordsOf(braceExamples('echo {1..100}', 'ja')[0]).words!.after, '…（全 100 語）');
    assert.strictEqual(wordsOf(braceExamples('echo {1..10..3}', 'ja')[0]).label, '展開後の単語（`echo` が受け取る別々の引数 4 個）');
    assert.strictEqual(wordsOf(braceExamples('echo {a,}')[0]).label, 'Resulting words (1 separate argument of `echo`)');
  });

  it('says when nothing is left, as bash drops empty words', () => {
    const sec = wordsOf(braceExamples('echo {,}')[0]);
    assert.deepStrictEqual([sec.lines, sec.empty, sec.label], [[], '(none: empty words are dropped)', 'Resulting words']);
    assert.strictEqual(bash('printf "<%s>" {,}'), '<>');
    assert.strictEqual(printedOf(braceExamples('echo {,}')[0]), undefined);
  });

  it('stores what printf -v makes, and keeps the output of printf out of a separate example', () => {
    const ex = explain("printf -v v '%s,' {a..c}").examples;
    assert.deepStrictEqual(ex.map((e) => e.title), ['Example (brace expansion `{a..c}`)']);
    assert.deepStrictEqual(printedOf(ex[0]), { label: 'Value stored in `v`', lines: ['a,b,c,'], empty: '(empty)' });
    assert.strictEqual(bash("printf -v v '%s,' {a..c}; printf %s \"$v\""), 'a,b,c,');
  });

  it('shows no output where the words go to a pipe, or the name is a function of the script', () => {
    // (Where the pipeline has an example of its own, it shows what the stages print, and the words have none.)
    assert.strictEqual(printedOf(braceExamples('echo {a,b} | foo')[0]), undefined);
    assert.strictEqual(printedOf(braceExamples('f() { :; }; f {a,b}')[0]), undefined);
    // The last stage of a pipeline prints to where the pipeline's output goes.
    assert.deepStrictEqual(printedOf(braceExamples('true | echo {a,b}')[0])?.lines, ['a b']);
  });

  it('runs the stages of a pipeline with the words of the expansion, as bash does', () => {
    const ex = explain('echo {a,b} | tr a-z A-Z').examples.find((e) => /whole pipeline/.test(e.title))!;
    assert.deepStrictEqual(ex.sections[ex.sections.length - 1].lines, bash('echo {a,b} | tr a-z A-Z').trimEnd().split('\n'));
  });

  it('runs printf with no word of a glob or a tilde, whose files and home are not known', () => {
    assert.ok(!explain("printf '%s\\n' *.txt").examples.some((e) => e.kind === 'printf'));
    assert.ok(!explain("printf '%s\\n' ~/x").examples.some((e) => e.kind === 'printf'));
    // (A command that reads files still reads the names a glob gives: its example stays.)
    assert.ok(explain("perl -pi -e 's/a/b/' *.txt").examples.some((e) => e.kind === 'perl'));
  });

  it('shows no output where printf rejects a word, and cuts a long one', () => {
    assert.deepStrictEqual(explain("printf '%d\\n' {a,b}").examples.map((e) => e.sections.length), [1]);
    const long = printedOf(braceExamples("printf '%s\\n' {1..20}")[0])!;
    assert.deepStrictEqual(long.lines, [...bash("printf '%s\\n' {1..20}").split('\n').slice(0, 11), '…']);
  });

  it('is not shown where the words are too many to list, or a quoted part leaves the word to bash', () => {
    assert.deepStrictEqual(braceExamples('echo {1..1000}'), []);
    assert.deepStrictEqual(braceExamples('echo "x"{a,b}'), []);
  });

  it('is not shown where braces do not expand (set +B)', () => {
    assert.deepStrictEqual(braceExamples('set +B; echo {a,b}'), []);
  });

  it('is not shown in sh or dash, which have no brace expansion; the pipeline prints the braces as dash does', () => {
    for (const shebang of ['#!/bin/sh', '#!/bin/dash']) {
      for (const line of ['echo {1..3}', 'echo {a,b}', "printf '%s\\n' {a,b}"]) {
        const ex = examplesAs(`${shebang}\n${line}`);
        assert.ok(!ex.some((e) => /brace expansion/.test(e.title) || e.sections.some((s) => s.words)), `${shebang}: ${line}`);
      }
      const piped = examplesAs(`${shebang}\necho {a,b} | tr a x`).find((e) => /whole pipeline/.test(e.title));
      assert.ok(piped, shebang);
      const out = bash('echo {a,b} | tr a x', 'dash');
      assert.strictEqual(out, '{x,b}\n');
      assert.deepStrictEqual(piped.sections.map((s) => s.lines), [['{a,b}'], out.trimEnd().split('\n')]);
    }
  });
});

describe('the words of a brace expansion in the text outputs', () => {
  const sec: ExampleSection = { label: 'Resulting words', lines: ['a␣', '``', '∅'], words: { ends: [[0, 1], [0, 0], [0, 0]], spaceLabel: 'space', after: '(`␣` is a space at an end)' } };

  it('writes them as code spans on one line in Markdown and the CLI', () => {
    assert.strictEqual(wordsMarkdown(sec), '`a␣` ``` `` ``` `∅` (`␣` is a space at an end)');
    assert.strictEqual(wordsMarkdown({ label: 'L', lines: [], empty: '(none)', words: { ends: [] } }), '(none)');
    const md = toPlainMarkdown(explain('echo {1..10..3}'), 'echo {1..10..3}', 'x.sh:1');
    assert.ok(md.includes('**Resulting words (4 separate arguments of `echo`)**\n\n`1` `4` `7` `10`\n\n**Output**\n\n```text\n1 4 7 10\n```'), md);
  });

  it('keeps the words a line of their own in a list item', () => {
    assert.deepStrictEqual(examplesMarkdown([{ title: 'E', sections: [sec] }], '  ').slice(1), ['  **Resulting words**\\', '  `a␣` ``` `` ``` `∅` (`␣` is a space at an end)']);
  });

  it('draws them as code in the hover, the marks of a space as the value line does', () => {
    const html = wordsHtml(sec);
    assert.strictEqual(html.match(/<code>/g)!.length, 4);
    assert.ok(html.startsWith('<code>a<span style="background-color:var(--vscode-badge-background);border-radius:2px;" title="space">&nbsp;</span></code> <code>``</code> <code>∅</code> '), html);
    assert.ok(html.endsWith('(<code><span style="background-color:var(--vscode-badge-background);border-radius:2px;" title="space">&nbsp;</span></code> is a space at an end)'), html);
    assert.strictEqual(wordsHtml({ label: 'L', lines: [], empty: '(none)', words: { ends: [] } }), '(none)');
  });
});
