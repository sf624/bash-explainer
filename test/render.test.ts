import * as assert from 'assert';
import * as path from 'path';
import type { BashParser as Parser } from '../src/syntax/tree';
import { Analyzer } from '../src/analyzer';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { examplesMarkdown, lineSegments, noteRefs, notesByLevel, placeExamples, toPlainMarkdown } from '../src/ui/render';
import { wholeLine } from '../src/ui/hoverView';
import { lineMarks, panelUpdate } from '../src/ui/panelView';
import type { DocumentIssue } from '../src/document';
import type { NoteLevel } from '../src/messages';

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
  const src = 'exit 300; read line; x = 1';
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
    assert.ok(warning.startsWith('> ⚠ **Pitfall:** `x =…` runs'), warning);
    assert.ok(info.startsWith('> ⓘ **Caveat:** without `-r`'), info);
    assert.ok(note.startsWith('> ℹ An exit status'), note);
    const ja = notes(toPlainMarkdown(new Analyzer('ja').explainLine(parser.parse(src), 0), src, 'a.sh:1', 'ja'));
    assert.deepStrictEqual(ja.map((l) => l.split(' ').slice(0, 3).join(' ')), ['> ⚠ **落とし穴:**', '> ⓘ **注意:**', '> ℹ 終了ステータスは']);
  });

  it('gives the panel each note with its level, its word and the rest, warnings first', () => {
    const msg = panelUpdate({ lang: 'en', explanation: ex(), file: 'a.sh', line: 0, lineText: src, choice: {}, placement: 'first', animations: true });
    assert.deepStrictEqual(msg.notes.map((n) => [n.level, n.label, n.body.slice(0, 8)]), [['warning', 'Pitfall:', '`x =…` r'], ['info', 'Caveat:', 'without '], ['note', '', 'An exit ']]);
    assert.deepStrictEqual(msg.notes[2].refs, ['3.7.5']);
    assert.deepStrictEqual(msg.levelLabels, { warning: 'Warning', info: 'Information', note: 'Note' });
    assert.deepStrictEqual(msg.marks, []);
  });

  it('gives the panel the problems of the line, to underline them', () => {
    const issue = (startLine: number, startCol: number, endLine: number, endCol: number, severity: 'warning' | 'info'): DocumentIssue => ({ code: 'c', severity, message: 'm', startLine, startCol, endLine, endCol });
    const issues = [issue(0, 2, 0, 5, 'warning'), issue(0, 7, 2, 1, 'info'), issue(1, 0, 1, 3, 'warning'), issue(0, 4, 0, 4, 'info')];
    // (Each on its line, from its start to its end, or to the end of the line when it goes on; an empty one is left out.)
    assert.deepStrictEqual(lineMarks(issues, 0), [{ from: 2, to: 5, level: 'warning' }, { from: 7, to: Number.MAX_SAFE_INTEGER, level: 'info' }]);
    assert.deepStrictEqual(lineMarks(issues, 1), [{ from: 0, to: 3, level: 'warning' }]);
  });
});

describe('links to the Bash manual', () => {
  const exitStatus = 'https://www.gnu.org/software/bash/manual/html_node/Exit-Status.html';

  it('ends a note and the head of a block of the hover with their sections, small', () => {
    const { md } = hover('exit 300');
    assert.ok(md.includes(`\n<span style="color:var(--vscode-descriptionForeground);">$(info)</span> An exit status is 0–255, so \`300\` becomes 44 (the value modulo 256) <small>Bash manual [3.7.5](${exitStatus} "Exit Status")</small>`), md);
    assert.match(md, /— Exit the shell or script <small>Bash manual \[4\.1\]\(https:\/\/www\.gnu\.org\/software\/bash\/manual\/html_node\/Bourne-Shell-Builtins\.html "Bourne Shell Builtins"\), \[4\.4\]\(https:\/\/www\.gnu\.org\/software\/bash\/manual\/html_node\/Special-Builtins\.html "Special Builtins"\)<\/small>$/m);
    // A program and its words are not parts of bash: no link.
    const grep = hover('grep -q x').md.split('\n').filter((l) => l.startsWith('<b>') || l.startsWith('<tr>'));
    assert.ok(grep.length > 1 && grep.every((l) => !l.includes('<small>')), grep.join('\n'));
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
  });
});
