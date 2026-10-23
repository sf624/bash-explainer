import * as assert from 'assert';
import * as path from 'path';
import type { BashParser as Parser } from '../src/syntax/tree';
import { Analyzer } from '../src/analyzer';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { examplesMarkdown, lineSegments, noteRefs, placeExamples, toMarkdown, toPlainMarkdown } from '../src/ui/render';
import type { ThemeKind } from '../src/ui/palette';
import { panelUpdate } from '../src/ui/panelView';

const root = path.join(__dirname, '..');
let parser: Parser;

before(async () => {
  parser = createUnbashParser();
});

function hover(src: string, line = 0, placement: 'first' | 'last' | 'bottom' = 'first') {
  const tree = parser.parse(src);
  const ex = new Analyzer('en').explainLine(tree, line);
  return { ex, md: toMarkdown(ex, 'en', undefined, 'command:x', src.split('\n')[line], placement) };
}

// The style shape VS Code's hover sanitizer keeps on <span> (src/vs/base/browser/markdownRenderer.ts).
const ALLOWED_STYLE = /^(color:(#[0-9a-fA-F]+|var\(--vscode(-[a-zA-Z0-9]+)+\));)?(background-color:(#[0-9a-fA-F]+|var\(--vscode(-[a-zA-Z0-9]+)+\));)?(border-radius:[0-9]+px;)?$/;

describe('hover markdown', () => {
  it('only emits span styles the hover sanitizer keeps', () => {
    const { md } = hover('grep -rn "x $y" ./src 2>&1 | sort > out.txt # c');
    const styles = [...md.matchAll(/style="([^"]*)"/g)].map((m) => m[1]);
    assert.ok(styles.length > 5);
    for (const s of styles) assert.match(s, ALLOWED_STYLE);
  });

  it('colours labels by kind', () => {
    const { md } = hover('ls -l');
    assert.match(md, /<code><span style="color:var\(--vscode-charts-blue\);">ls<\/span><\/code> — List directory/);
    assert.match(md, /<code><span style="color:var\(--vscode-charts-orange\);">-l<\/span><\/code>/);
  });

  it('colours labels with our own colours where the theme kind has them (src/ui/palette.ts)', () => {
    const src = 'echo "$x" -n 2>&1';
    const ex = new Analyzer('en').explainLine(parser.parse(src), 0);
    const md = (theme: ThemeKind) => toMarkdown(ex, 'en', undefined, undefined, src, 'first', theme);
    assert.match(md('light'), /<span style="color:#0161f8;">echo<\/span>/);
    assert.match(md('light'), /<span style="color:#d0020f;">&#36;x<\/span>/);
    assert.match(md('highContrastLight'), /<span style="color:#0148bc;">echo<\/span>/);
    assert.match(md('highContrast'), /<span style="color:#6badff;">echo<\/span>/);
    // Dark themes keep the theme's chart colours, but red, too dark on a code block.
    assert.match(md('dark'), /<span style="color:var\(--vscode-charts-blue\);">echo<\/span>/);
    assert.match(md('dark'), /<span style="color:#ff5c65;">&#36;x<\/span>/);
    // An error takes our own colour in the light and dark themes, the theme's in high contrast; a comment the theme's.
    const bad = 'printf "%y" # c';
    const md2 = (theme: ThemeKind) => toMarkdown(new Analyzer('en').explainLine(parser.parse(bad), 0), 'en', undefined, undefined, bad, 'first', theme);
    assert.match(md2('light'), /<span style="color:#d0020f;">%y<\/span>/);
    assert.match(md2('dark'), /<span style="color:#fd6358;">%y<\/span>/);
    assert.match(md2('highContrast'), /<span style="color:var\(--vscode-errorForeground\);">%y<\/span>/);
    assert.match(md2('light'), /<span style="color:var\(--vscode-descriptionForeground\);">&#35;&nbsp;c<\/span>/);
    for (const theme of ['light', 'dark', 'highContrast', 'highContrastLight'] as const) {
      for (const s of [...md(theme).matchAll(/style="([^"]*)"/g)].map((m) => m[1])) assert.match(s, ALLOWED_STYLE, theme);
    }
  });

  it('escapes HTML and Markdown in source text', () => {
    const { md } = hover('echo "<b>" *.sh __x__');
    assert.ok(!md.includes('<b>'));
    assert.ok(md.includes('&#60;b&#62;'));
    assert.ok(!/[^&#\w]\*\.sh/.test(md.replace(/`[^`]*`/g, '')), 'glob must not become Markdown emphasis');
  });

  it('shows the line coloured by the deepest token, without leading indentation', () => {
    const { ex, md } = hover('for f in a; do\n    echo $f\ndone', 1);
    const segs = lineSegments('    echo $f', 1, ex.items);
    assert.deepStrictEqual(segs.filter((s) => s.kind).map((s) => [s.text, s.kind]), [['echo ', 'builtin'], ['$f', 'variable']]);
    const first = md.split('\n').find((l) => l.startsWith('<code>'))!;
    assert.match(first, /^<code><span style="color:var\(--vscode-charts-blue\);">echo(&nbsp;)?<\/span>/);
  });

  it('ends with links to the panel and the settings', () => {
    assert.match(hover('ls').md, /\[\$\(comment-discussion\) Open in panel\]\(command:x\) &nbsp;·&nbsp; \[\$\(gear\) Settings\]\(command:bashExplainer\.openSettings\)$/);
  });

  it('shows examples as headings with one code block per section', () => {
    const md = examplesMarkdown([{ title: 'Example', sections: [{ label: 'Input', lines: ['a b', 'c'] }, { label: 'Output', lines: [], empty: '(no output)' }] }]);
    assert.deepStrictEqual(md.slice(3), ['#### Example', '', '**Input**', '', '```text', 'a b', 'c', '```', '', '**Output**', '', '```text', '(no output)', '```']);
    const fenced = examplesMarkdown([{ title: 'E', sections: [{ label: 'L', lines: ['a ```b'] }] }]);
    assert.ok(fenced.includes('````text'), 'the fence is longer than backticks inside');
  });

  it('puts worked examples in the hover after the tree with the bottom placement', () => {
    const { ex, md } = hover("awk '{ print $1 }'", 0, 'bottom');
    assert.strictEqual(ex.examples.length, 1);
    assert.ok(!ex.notes.some((n) => /^Example/.test(n)), 'examples are not notes');
    assert.match(md, /#### Example\n\n\*\*Input\*\*\n\n```text\napple red tokyo\nbanana yellow osaka/);
  });

  it('puts each example right under its token, before the explanations of its parts', () => {
    const { md } = hover('echo "${f%.*}" | sed -n "/^a/p" f');
    const lines = md.split('\n');
    const at = (re: RegExp) => lines.findIndex((l) => re.test(l));
    assert.strictEqual(at(/^ {10}##### Example for `\$\{f%/), at(/^ {8}- .*Parameter expansion/) + 1);
    assert.ok(at(/##### Example for `sed/) < at(/^ {6}- .*\/\^a\/p.*Double-quoted/), 'before the parts of the script argument');
    assert.ok(at(/##### Example for `sed/) > at(/^ {4}- .*sed script/));
    assert.ok(!/^#### /m.test(md), 'nothing left for the end');
  });

  it('puts each example after the explanations of its parts with the last placement', () => {
    const { md } = hover('echo "${f%.*}" | sed -n "/^a/p" f', 0, 'last');
    const lines = md.split('\n');
    const at = (re: RegExp) => lines.findIndex((l) => re.test(l));
    // Under the expansion's parts, before the pipe; indented to stay inside the list item.
    assert.ok(at(/^ {10}##### `\$\{f%\.\*\}` example|^ {10}##### Example for `\$\{f%\.\*\}`/) > at(/^ {10}- .*Pattern/));
    assert.ok(at(/##### Example for `\$\{f%/) < at(/^ {2}- .*Pipe:/));
    // The sed example follows the script argument, before the file operand.
    assert.ok(at(/##### Example for `sed/) > at(/^ {4}- .*sed script/));
    assert.ok(at(/##### Example for `sed/) < at(/^ {4}- .*f<\/span><\/code> — /));
    assert.ok(!/^#### /m.test(md), 'nothing left for the end');
    assert.ok(!/\n\n {2,}/.test(md.split('<code>').slice(1).join('')), 'no blank lines inside the list');
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
    const placed = placeExamples({ line: 0, summary: '', items: [], context: [], notes: [], examples: [{ title: 'E', sections: [] }] });
    assert.strictEqual(placed.examples.length, 1);
  });
});

describe('dialect in the hover', () => {
  it('names the target shell and warns about bash-only constructs', () => {
    const tree = parser.parse('#!/bin/sh\n[[ -f x ]]');
    const ex = new Analyzer('en').explainLine(tree, 1, 'sh');
    const md = toMarkdown(ex, 'en');
    assert.match(md, /^\*\*Bash Explainer\*\* · Line 2 · checked for POSIX sh/);
    assert.match(md, /> ⚠ `\[\[ \]\]` is not POSIX sh/);
  });
});

describe('links to the Bash manual', () => {
  const exitStatus = 'https://www.gnu.org/software/bash/manual/html_node/Exit-Status.html';

  it('ends a note and a token row of the hover with their sections, small', () => {
    const { md } = hover('exit 300');
    assert.ok(md.includes(`> ℹ An exit status is 0–255, so \`300\` becomes 44 (the value modulo 256) <small>Bash manual [3.7.5](${exitStatus} "Exit Status")</small>`), md);
    assert.match(md, /— Exit the shell or script \(shell builtin\) <small>Bash manual \[4\.1\]\(https:\/\/www\.gnu\.org\/software\/bash\/manual\/html_node\/Bourne-Shell-Builtins\.html "Bourne Shell Builtins"\), \[4\.4\]\(https:\/\/www\.gnu\.org\/software\/bash\/manual\/html_node\/Special-Builtins\.html "Special Builtins"\)<\/small>$/m);
    // A program and its words are not parts of bash: no link.
    const grep = hover('grep -q x').md.split('\n').filter((l) => l.startsWith('- ') || l.startsWith('  - '));
    assert.ok(grep.length && grep.every((l) => !l.includes('<small>')), grep.join('\n'));
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
    const msg = panelUpdate({ lang: 'en', explanation: ex, file: 'a.sh', line: 0, lineText: src, choice: {}, placement: 'first' });
    assert.deepStrictEqual(Object.keys(msg.manual).sort(), ['3.7.5', '4.1', '4.4']);
    assert.deepStrictEqual(msg.manual['3.7.5'], { label: 'Bash manual 3.7.5', title: 'Exit Status', url: exitStatus });
    assert.deepStrictEqual(noteRefs(ex, ex.notes[0]), ['3.7.5']);
    assert.strictEqual(noteRefs(ex, 'not a note'), undefined);
  });
});
