import * as assert from 'assert';
import * as path from 'path';
import type Parser = require('web-tree-sitter');
import { Analyzer } from '../src/analyzer';
import { createBashParser } from '../src/parser';
import { examplesMarkdown, lineSegments, toMarkdown } from '../src/ui/render';

const root = path.join(__dirname, '..');
let parser: Parser;

before(async () => {
  parser = await createBashParser({
    runtimeDir: path.join(root, 'node_modules/web-tree-sitter'),
    bashWasm: path.join(root, 'node_modules/tree-sitter-bash/tree-sitter-bash.wasm'),
  });
});

function hover(src: string, line = 0) {
  const tree = parser.parse(src);
  const ex = new Analyzer('en').explainLine(tree, line);
  tree.delete();
  return { ex, md: toMarkdown(ex, 'en', undefined, 'command:x', src.split('\n')[line]) };
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
    assert.match(md, /<code><span style="color:var\(--vscode-charts-blue\);">ls&nbsp;-l<\/span><\/code> — List directory/);
    assert.match(md, /<code><span style="color:var\(--vscode-charts-orange\);">-l<\/span><\/code>/);
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

  it('keeps the panel link', () => {
    assert.match(hover('ls').md, /\[\$\(comment-discussion\) Open in panel\]\(command:x\)$/);
  });

  it('shows examples as headings with one code block per section', () => {
    const md = examplesMarkdown([{ title: 'Example', sections: [{ label: 'Input', lines: ['a b', 'c'] }, { label: 'Output', lines: [], empty: '(no output)' }] }]);
    assert.deepStrictEqual(md.slice(3), ['#### Example', '', '**Input**', '', '```text', 'a b', 'c', '```', '', '**Output**', '', '```text', '(no output)', '```']);
    const fenced = examplesMarkdown([{ title: 'E', sections: [{ label: 'L', lines: ['a ```b'] }] }]);
    assert.ok(fenced.includes('````text'), 'the fence is longer than backticks inside');
  });

  it('puts worked examples in the hover after the tree', () => {
    const { ex, md } = hover("awk '{ print $1 }'");
    assert.strictEqual(ex.examples.length, 1);
    assert.ok(!ex.notes.some((n) => /^Example/.test(n)), 'examples are not notes');
    assert.match(md, /#### Example\n\n\*\*Input\*\*\n\n```text\napple red tokyo\nbanana yellow osaka/);
  });
});

