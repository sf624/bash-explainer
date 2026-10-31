import * as assert from 'assert';
import * as path from 'path';
import type { BashParser as Parser } from '../src/syntax/tree';
import { Analyzer } from '../src/analyzer';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { examplesMarkdown, lineSegments, noteRefs, notesByLevel, placeExamples, toPlainMarkdown } from '../src/ui/render';
import { partHover, plainPartHover, wholeLine } from '../src/ui/hoverView';
import { readingNodes } from '../src/reading';
import { lineMarks, panelUpdate } from '../src/ui/panelView';
import type { DocumentIssue } from '../src/document';
import type { NoteLevel } from '../src/messages';
import { said } from './support/shells';

const root = path.join(__dirname, '..');
let parser: Parser;

before(async () => {
  parser = createUnbashParser();
});

function hover(src: string, line = 0) {
  const tree = parser.parse(src);
  const ex = new Analyzer('en').explainLine(tree, line);
  const md = wholeLine({ ex, lang: 'en', theme: 'dark', lineText: src.split('\n')[line], placement: 'first', panelLink: 'command:x', lineLink: 'command:l', keys: 'K' });
  return { ex, md };
}

// The hover's own tests are in test/hover-view.test.ts.
describe('the hover line and examples', () => {
  it('shows the line coloured by the deepest token, without leading indentation', () => {
    const { ex, md } = hover('for f in a; do\n    echo $f\ndone', 1);
    const segs = lineSegments('    echo $f', 1, ex.items);
    assert.deepStrictEqual(segs.filter((s) => s.kind).map((s) => [s.text, s.kind]), [['echo ', 'builtin'], ['$f', 'variable']]);
    const first = md.split('\n').find((l) => l.startsWith('<code>'))!;
    assert.match(first, /^<code><span style="color:var\(--vscode-charts-blue\);">echo(&nbsp;)?<\/span>/);
  });

  it('shows examples as headings with one code block per section', () => {
    const md = examplesMarkdown([{ title: 'Example', sections: [{ label: 'Input', lines: ['a b', 'c'] }, { label: 'Output', lines: [], empty: '(no output)' }] }]);
    assert.deepStrictEqual(md.slice(3), ['#### Example', '', '**Input**', '', '```text', 'a b', 'c', '```', '', '**Output**', '', '```text', '(no output)', '```']);
    const fenced = examplesMarkdown([{ title: 'E', sections: [{ label: 'L', lines: ['a ```b'] }] }]);
    assert.ok(fenced.includes('````text'), 'the fence is longer than backticks inside');
  });
});

describe('placeExamples', () => {
  it('prefers the outermost token with the same range, and keeps the input untouched', () => {
    const tree = parser.parse('sed -n "/^a/p" f');
    const ex = new Analyzer('en').explainLine(tree, 0);
    const placed = placeExamples(ex);
    const arg = placed.items[0].children.find((c) => c.label === '"/^a/p"')!;
    assert.strictEqual(arg.examples?.length, 1);
    assert.strictEqual(arg.children[0].examples, undefined);
    assert.strictEqual(placed.examples.length, 0);
    assert.strictEqual(ex.examples.length, 1);
    assert.ok(!JSON.stringify(ex.items).includes('"examples"'));
  });
  it('keeps examples without a token at the end', () => {
    const placed = placeExamples({ line: 0, summary: '', items: [], context: [], notes: [], noteInfo: [], examples: [{ title: 'E', sections: [] }] });
    assert.strictEqual(placed.examples.length, 1);
  });
});

describe('the levels of the notes', () => {
  // A plain fact, a caveat and a pitfall, in the order found.
  const src = 'exit 300; read line; source lib.sh';
  const ex = () => new Analyzer('en').explainLine(parser.parse(src), 0);
  const notes = (md: string) => md.split('\n').filter((l) => l.startsWith('> '));

  it('puts the warnings first, then the information, then the other notes, each in the order found', () => {
    assert.deepStrictEqual(ex().notes.map((n) => n[0]), ['ℹ', 'ⓘ', '⚠']);
    const at = (text: string, level: NoteLevel) => ({ text, level, label: '', body: text });
    const info = [at('a', 'note'), at('b', 'warning'), at('c', 'note'), at('d', 'info'), at('e', 'warning')];
    const line = { line: 0, summary: '', items: [], context: [], notes: info.map((n) => n.text), noteInfo: info, examples: [] };
    // (The level is the note's data, not its text: these have no marks.)
    assert.deepStrictEqual(notesByLevel(line).map((n) => n.text), ['b', 'e', 'd', 'a', 'c']);
  });

  it('keeps the mark in plain Markdown, with the word in bold', () => {
    const [warning, info, note] = notes(toPlainMarkdown(ex(), src, 'a.sh:1'));
    assert.ok(warning.startsWith('> ⚠ **Pitfall:** `source lib.sh` looks'), warning);
    assert.ok(info.startsWith('> ⓘ **Caveat:** without `-r`'), info);
    assert.ok(note.startsWith('> ℹ An exit status'), note);
    const ja = notes(toPlainMarkdown(new Analyzer('ja').explainLine(parser.parse(src), 0), src, 'a.sh:1', 'ja'));
    assert.deepStrictEqual(ja.map((l) => l.split(' ').slice(0, 3).join(' ')), ['> ⚠ **落とし穴:**', '> ⓘ **注意:**', '> ℹ 終了ステータスは', '> _マニュアルに記述なし・bash 5.2・5.3']);
  });

  it('gives the panel each note with its level, its word and the rest, warnings first', () => {
    const msg = panelUpdate({ lang: 'en', explanation: ex(), file: 'a.sh', line: 0, lineText: src, choice: {}, placement: 'first', animations: true });
    assert.deepStrictEqual(msg.notes.map((n) => [n.level, n.label, n.body.slice(0, 8)]), [['warning', 'Pitfall:', '`source '], ['info', 'Caveat:', 'without '], ['note', '', 'An exit ']]);
    assert.deepStrictEqual(msg.notes[2].refs, ['3.7.5']);
    // (Each with its level's look from the level table: the class, the icon, and the icon's name for a screen reader.)
    assert.deepStrictEqual(msg.notes.map((n) => [n.className, n.icon, n.iconName]), [['level-warning', 'warning', 'Warning'], ['level-info', 'info', 'Information'], ['level-note', 'info', 'Note']]);
    assert.deepStrictEqual(msg.marks, []);
    // An error first, with its own look; its icon has no name, as its word says the level ("Error:"), in both languages.
    for (const lang of ['en', 'ja'] as const) {
      const line = '[ -f a; read line';
      const err = panelUpdate({ lang, explanation: new Analyzer(lang).explainLine(parser.parse(line), 0), file: 'a.sh', line: 0, lineText: line, choice: {}, placement: 'first', animations: true });
      assert.deepStrictEqual(err.notes.map((n) => [n.className, n.icon, n.iconName, n.label]), [
        ['level-error', 'error', '', lang === 'en' ? 'Error:' : 'エラー:'], ['level-info', 'info', lang === 'en' ? 'Information' : '情報', lang === 'en' ? 'Caveat:' : '注意:'],
      ]);
    }
  });

  it('gives the panel the problems of the line, to underline them', () => {
    const issue = (startLine: number, startCol: number, endLine: number, endCol: number, severity: 'warning' | 'info'): DocumentIssue => ({ code: 'c', severity, message: 'm', startLine, startCol, endLine, endCol });
    const issues = [issue(0, 2, 0, 5, 'warning'), issue(0, 7, 2, 1, 'info'), issue(1, 0, 1, 3, 'warning'), issue(0, 4, 0, 4, 'info')];
    // (Each on its line, from its start to its end, or to the end of the line when it goes on; an empty one is left out.)
    assert.deepStrictEqual(lineMarks(issues, 0), [{ from: 2, to: 5, className: 'level-warning', rank: 1 }, { from: 7, to: Number.MAX_SAFE_INTEGER, className: 'level-info', rank: 2 }]);
    assert.deepStrictEqual(lineMarks(issues, 1), [{ from: 0, to: 3, className: 'level-warning', rank: 1 }]);
  });
});

describe('links to the Bash manual', () => {
  const exitStatus = 'https://www.gnu.org/software/bash/manual/html_node/Exit-Status.html';

  it('ends a note and the head of a block of the hover with their sections, small', () => {
    const { md } = hover('exit 300');
    assert.ok(md.includes(`\n<span style="color:var(--vscode-descriptionForeground);">$(info)</span> An exit status is 0–255, so \`exit 300\` gives 44 (the value modulo 256) <small>Bash manual [3.7.5](${exitStatus} "Exit Status")</small>`), md);
    assert.match(md, /— Exit the shell or script <small>Bash manual \[4\.1\]\(https:\/\/www\.gnu\.org\/software\/bash\/manual\/html_node\/Bourne-Shell-Builtins\.html "Bourne Shell Builtins"\), \[4\.4\]\(https:\/\/www\.gnu\.org\/software\/bash\/manual\/html_node\/Special-Builtins\.html "Special Builtins"\)<\/small>$/m);
    // A program and its words are not parts of bash: no link.
    const grep = hover('grep -q x').md.split('\n').filter((l) => l.startsWith('<b>') || l.startsWith('<tr>'));
    assert.ok(grep.length > 1 && grep.every((l) => !l.includes('<small>')), grep.join('\n'));
  });

  // docs/design/basis.md, step 2: a note that rests on bash's behaviour has the chip's words and its try-it.
  it('says under a note that rests on bash\'s behaviour what it rests on, with the try-it: the hover, Markdown and the panel', () => {
    const { md } = hover('exit 300');
    assert.ok(md.includes("\n\n<small>Not in the manual · checked with bash 5.2 and 5.3 · Try it in your terminal: `bash -c '(exit 300); echo $?'` → `44`</small>\n"), md);
    const tree = parser.parse('exit 300');
    const plain = toPlainMarkdown(new Analyzer('en').explainLine(tree, 0), 'exit 300', 'a.sh:1');
    assert.ok(plain.includes("(Bash manual [3.7.5](https://www.gnu.org/software/bash/manual/html_node/Exit-Status.html \"Exit Status\"))\n>\n> _Not in the manual · checked with bash 5.2 and 5.3 · Try it in your terminal: `bash -c '(exit 300); echo $?'` → `44`_\n"), plain);
    const ja = toPlainMarkdown(new Analyzer('ja').explainLine(tree, 0), 'exit 300', 'a.sh:1', 'ja');
    assert.ok(ja.includes("> _マニュアルに記述なし・bash 5.2・5.3 で確認 · 端末で試す: `bash -c '(exit 300); echo $?'` → `44`_"), ja);
    // (Several lines of output are joined, as a code span holds one.)
    const unset = toPlainMarkdown(new Analyzer('en').explainLine(parser.parse('unset -fv x'), 0), 'unset -fv x', 'a.sh:1');
    assert.ok(unset.includes('→ `bash: line 1: unset: cannot simultaneously unset a function and a variable ⏎ status 1, x=1 ⏎ function`_'), unset);
    const ex = new Analyzer('en').explainLine(tree, 0);
    const msg = panelUpdate({ lang: 'en', explanation: ex, file: 'a.sh', line: 0, lineText: 'exit 300', choice: {}, detected: said('bash'), placement: 'first', animations: true });
    assert.deepStrictEqual(msg.notes[0].basis, {
      kind: 'checked', label: 'Not in the manual · checked with bash 5.2 and 5.3',
      title: "bash's actual behaviour, which the Bash manual does not state: checked by running bash 5.2 and 5.3 (messages as with `LC_ALL=C`)",
      tryIt: { code: "bash -c '(exit 300); echo $?'", output: '44' },
    });
    // With the setting off, the explanation carries no basis, and no output shows one.
    const off = new Analyzer('en').explainLine(tree, 0, 'bash', { basis: false });
    assert.ok(!off.facts![0].basis && !off.facts![0].tryIt);
    assert.ok(!toPlainMarkdown(off, 'exit 300', 'a.sh:1').includes('Not in the manual'));
    assert.ok(!('basis' in panelUpdate({ lang: 'en', explanation: off, file: 'a.sh', line: 0, lineText: 'exit 300', choice: {}, detected: said('bash'), placement: 'first', animations: true }).notes[0]));
  });

  // docs/design/basis.md, step 4: a part whose text rests on bash's behaviour, as a note does.
  it('says under a part that rests on bash\'s behaviour what it rests on, with the try-it: the hover, its plain form and the panel', () => {
    const line = "Differs from the manual · checked with bash 5.2 and 5.3 · Try it in your terminal: `bash -c 'exec 3>/dev/null 4>/dev/null; BASH_XTRACEFD=3; BASH_XTRACEFD=4; echo hi >&3 && echo \"fd 3 is still open\"'` → `fd 3 is still open`";
    // (The whole line: the block of a top-level part; a row of a block's table.)
    const { ex, md } = hover('BASH_XTRACEFD=7');
    assert.ok(md.includes(`<br><small>${line}</small>`), md);
    const row = hover('echo hi; f() { local RANDOM=3; }').md;
    assert.match(row, /<tr><td>.*RANDOM=3.*<\/td><td>.*a plain variable.*<br><small>Not in the manual · checked with bash 5\.2 and 5\.3 · Try it in your terminal: /, row);
    // (The part under the mouse, and the Language Server's plain hover.)
    const chain = [ex.items[0]];
    assert.ok(partHover({ ex, lang: 'en', theme: 'dark', lineText: 'BASH_XTRACEFD=7', placement: 'first', panelLink: 'command:x', lineLink: 'command:l', keys: 'K' }, chain).includes(`<br><small>${line}</small>`));
    assert.ok(plainPartHover(ex, chain, 'en', '').includes(`\n_${line}_\n`));
    const prefix = new Analyzer('en').explainLine(parser.parse('UID=0 echo hi'), 0);
    assert.match(plainPartHover(prefix, [prefix.items[0]], 'en', ''), /^- `UID=0` — .*\\\n {2}_Differs from the manual · checked with bash 5\.2 and 5\.3 · Try it in your terminal: /m);
    // The panel's rows and Reading's nodes, with the chip's words in the panel's language.
    const msg = panelUpdate({ lang: 'ja', explanation: new Analyzer('ja').explainLine(parser.parse('BASH_XTRACEFD=7'), 0, 'bash', { reading: true }), file: 'a.sh', line: 0, lineText: 'BASH_XTRACEFD=7', choice: {}, detected: said('bash'), placement: 'first', animations: true });
    const shown = msg.explanation.items[0] as { basisShown?: { label: string; tryIt: { output: string } } };
    assert.deepStrictEqual([shown.basisShown?.label, shown.basisShown?.tryIt.output], ['マニュアルの記述と異なる・bash 5.2・5.3 で確認', 'fd 3 is still open']);
    assert.ok(readingNodes(msg.reading!.root).some((n) => (n as { basisShown?: unknown }).basisShown));
    // With the setting off, none.
    const off = new Analyzer('en').explainLine(parser.parse('BASH_XTRACEFD=7'), 0, 'bash', { basis: false });
    assert.ok(!toPlainMarkdown(off, 'BASH_XTRACEFD=7', 'a.sh:1').includes('Differs from the manual'));
  });

  it('links the sections in the plain Markdown, in the language of the explanation', () => {
    const tree = parser.parse('exit 300');
    const en = toPlainMarkdown(new Analyzer('en').explainLine(tree, 0), 'exit 300', 'a.sh:1');
    assert.ok(en.includes(`(the value modulo 256) (Bash manual [3.7.5](${exitStatus} "Exit Status"))`), en);
    const ja = toPlainMarkdown(new Analyzer('ja').explainLine(tree, 0), 'exit 300', 'a.sh:1', 'ja');
    assert.ok(ja.includes(` (Bash マニュアル [3.7.5](${exitStatus} "Exit Status"))`), ja);
  });

  it('gives the panel the label, title and page of every section shown', () => {
    const src = 'exit 300';
    const ex = new Analyzer('en').explainLine(parser.parse(src), 0);
    const msg = panelUpdate({ lang: 'en', explanation: ex, file: 'a.sh', line: 0, lineText: src, choice: {}, placement: 'first', animations: true });
    assert.deepStrictEqual(Object.keys(msg.manual).sort(), ['3.7.5', '4.1', '4.4']);
    assert.deepStrictEqual(msg.manual['3.7.5'], { text: '§3.7.5', label: 'Bash manual 3.7.5', title: 'Exit Status', url: exitStatus });
    // A manual page, for the shebang: its own text and label.
    const shebang = panelUpdate({ lang: 'ja', explanation: new Analyzer('ja').explainLine(parser.parse('#!/bin/sh'), 0), file: 'a.sh', line: 0, lineText: '#!/bin/sh', choice: {}, placement: 'first', animations: true });
    assert.deepStrictEqual(shebang.manual['execve(2)'], { text: 'execve(2)', label: 'Linux マニュアルページ execve(2)', title: 'Interpreter scripts', url: 'https://man7.org/linux/man-pages/man2/execve.2.html' });
    assert.deepStrictEqual(noteRefs(ex, ex.notes[0]), ['3.7.5']);
    assert.strictEqual(noteRefs(ex, 'not a note'), undefined);
    // Where the links open, said after their names: the browser from VS Code, a new tab from the web page.
    assert.strictEqual(msg.linkNote, '(opens in the browser)');
    assert.strictEqual(panelUpdate({ lang: 'ja', explanation: ex, file: 'a.sh', line: 0, lineText: src, choice: {}, placement: 'first', animations: true, web: true }).linkNote, '（新しいタブで開く）');
  });
});
