// The panel's line box wraps between shell words (src/ui/lineBox.ts): the runs of the line travel in the panel's update
// message as parts of its text, and media/panel.js draws a span per run (docs/design/chrome-redesign.md, C1b).
// test/web-line-box.test.ts and test/panel-header.test.ts draw them in the browser.
import * as assert from 'assert';
import { Analyzer } from '../src/analyzer';
import { openDocument, type FileKind } from '../src/document-setup';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { lineParts, lineRuns, wrapsLikeEditor } from '../src/ui/lineBox';
import { panelUpdate } from '../src/ui/panelView';
import { wrapRuns } from '../src/ui/wrapRuns';

const parser = createUnbashParser();
const docOf = (text: string, kind: FileKind = 'shell') => openDocument(text, kind, (t) => parser.parse(t));

/** The update the panel gets for a line of a document, as both hosts send it. */
function update(text: string, line: number, kind: FileKind = 'shell', wrap?: boolean) {
  const doc = docOf(text, kind);
  const explanation = new Analyzer('en').explainLine(doc.tree, 0, 'bash');
  return panelUpdate({ lang: 'en', explanation, file: 'a', line, lineText: doc.lines[line], doc, wrap, choice: {}, placement: 'first', animations: true });
}

/** The parts of the update's line as their texts, a run in brackets. */
function shown(m: ReturnType<typeof update>): string {
  return m.lineParts.map((p) => (p.run ? `[${m.lineText.slice(p.from, p.to)}]` : m.lineText.slice(p.from, p.to))).join('');
}

describe('the line box: where a long line may wrap in the panel', () => {
  it('cuts a line into its runs and the blanks between them, every character in one part', () => {
    assert.deepStrictEqual(lineParts('  ls  -l ', [[2, 4], [6, 8]]), [
      { from: 0, to: 2, run: false }, { from: 2, to: 4, run: true }, { from: 4, to: 6, run: false }, { from: 6, to: 8, run: true }, { from: 8, to: 9, run: false },
    ]);
    assert.deepStrictEqual(lineParts('ls', [[0, 2]]), [{ from: 0, to: 2, run: true }]);
    assert.deepStrictEqual(lineParts('', []), []);
    assert.deepStrictEqual(lineParts('   ', []), [{ from: 0, to: 3, run: false }]);
  });

  it('sends the runs of the syntax tree: a quoted word, a substitution and a redirection stay whole', () => {
    const m = update('grep -rn "ERROR $USER" ./src 2>&1 | sort -u > errors.txt && echo "done: $(date +%F)" || exit 1\n', 0);
    assert.strictEqual(shown(m), '[grep] [-rn] ["ERROR $USER"] [./src] [2>&1] [|] [sort] [-u] [>] [errors.txt] [&&] [echo] ["done: $(date +%F)"] [||] [exit] [1]');
  });

  it('moves the runs of a host file\'s shell code to the file\'s columns (a Dockerfile RUN line), its own words at their blanks', () => {
    const text = 'FROM alpine AS x\nRUN echo "a b" && tar -xf "c d.tar"\n';
    assert.strictEqual(shown(update(text, 1, 'dockerfile')), '[RUN] [echo] ["a b"] [&&] [tar] [-xf] ["c d.tar"]');
    assert.strictEqual(shown(update(text, 0, 'dockerfile')), '[FROM] [alpine] [AS] [x]');
  });

  it('cuts a here-document\'s line at its blanks, a substitution in it whole', () => {
    const text = 'cat <<EOF\nhello  $(echo a b) world\nEOF\n';
    assert.strictEqual(shown(update(text, 0)), '[cat] [<<EOF]');
    assert.strictEqual(shown(update(text, 1)), '[hello]  [$(echo a b)] [world]');
  });

  it('reads a script with CRLF line ends: the line has no CR, and a quoted word over lines is one run on each', () => {
    const text = 'echo "a b"\r\nx="c\r\nd e"\r\n';
    const doc = docOf(text);
    assert.deepStrictEqual(doc.lines.slice(0, 3), ['echo "a b"', 'x="c', 'd e"']);
    assert.strictEqual(shown(update(text, 0)), '[echo] ["a b"]');
    assert.strictEqual(shown(update(text, 2)), '[d e"]');
  });

  it('breaks at the blanks a line it has no tree for, or one whose tree is of another text', () => {
    const doc = docOf('echo "a b"\n');
    assert.deepStrictEqual(lineRuns(undefined, 0, 'echo "a b"'), [[0, 4], [5, 7], [8, 10]]);
    // (The document was parsed before the last key press.)
    assert.deepStrictEqual(lineRuns(doc, 0, 'echo "a b" c'), [[0, 4], [5, 7], [8, 10], [11, 12]]);
    assert.deepStrictEqual(lineRuns(doc, 0, 'echo "a b"'), [[0, 4], [5, 10]]);
  });

  it('works out the runs of a document once per parse', () => {
    const doc = docOf('echo a\necho "b c"\n');
    const first = lineRuns(doc, 1, 'echo "b c"');
    assert.deepStrictEqual(first, wrapRuns(doc)[1]);
    // (Another document with the same tree, as VS Code opens one at each request: the runs are kept.)
    assert.strictEqual(lineRuns({ ...doc }, 1, 'echo "b c"'), first);
  });

  it('says whether the box wraps: the web page\'s editor.wrap as given, VS Code\'s editor.wordWrap unless it is off', () => {
    assert.strictEqual(update('ls\n', 0).wrap, false);
    assert.strictEqual(update('ls\n', 0, 'shell', true).wrap, true);
    assert.strictEqual(update('ls\n', 0, 'shell', false).wrap, false);
    for (const v of ['on', 'wordWrapColumn', 'bounded']) assert.strictEqual(wrapsLikeEditor(v), true, v);
    for (const v of ['off', undefined, null, true]) assert.strictEqual(wrapsLikeEditor(v), false, String(v));
  });
});
