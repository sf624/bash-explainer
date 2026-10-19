import * as assert from 'assert';
import * as path from 'path';
import { descendants } from '../src/syntax/tree';
import type { BashParser as Parser } from '../src/syntax/tree';
import { Analyzer } from '../src/analyzer';
import { detectShell } from '../src/dialect';
import { documentIssues, explainDocumentLine, ShellDocument } from '../src/document';
import { extractShell } from '../src/hosts';
import { createUnbashParser } from '../src/syntax/adapters/unbash';

const root = path.join(__dirname, '..');
let parser: Parser;
before(async () => {
  parser = createUnbashParser();
});

const script = (text: string): ShellDocument => ({ lines: text.split('\n'), tree: parser.parse(text) });
const dockerfile = (text: string): ShellDocument => {
  const extracted = extractShell('dockerfile', text);
  return { lines: text.split('\n'), extracted, tree: parser.parse(extracted.text) };
};

// The functions the extension and the web page share.
describe('documents without VS Code', () => {
  const en = new Analyzer('en');

  it('explains a line of a shell script', () => {
    const ex = explainDocumentLine(en, script('#!/bin/bash\ngrep -rn TODO src'), 1, 'en', {}, {});
    assert.deepStrictEqual(ex.items.map((i) => i.label), ['grep']);
    assert.deepStrictEqual(ex.items[0].span, { start: { line: 1, character: 0 }, end: { line: 1, character: 17 } });
  });

  it('explains a line of a host file at its own columns', () => {
    const doc = dockerfile('FROM alpine\nRUN apk add curl');
    const ex = explainDocumentLine(en, doc, 1, 'en', {}, {});
    assert.ok(ex.items.length > 0);
    assert.ok(ex.items[0].span.start.character >= 'RUN '.length);
    assert.deepStrictEqual(explainDocumentLine(en, doc, 0, 'en', {}, {}).items, []);
  });

  it('checks for the forced shell first, then the detected one', () => {
    const text = '#!/bin/sh\n[[ -f x ]] && echo y';
    const detected = detectShell(text, 'x.sh');
    assert.deepStrictEqual(documentIssues(script(text), 'en', { detected }).map((i) => i.code), ['dbracket']);
    assert.deepStrictEqual(documentIssues(script(text), 'en', { forced: 'bash', detected }), []);
    assert.ok(documentIssues(script(text), 'en', { detected })[0].fix);
  });

  it('leaves out ignored codes and codes disabled in the file', () => {
    const text = '#!/bin/sh\n[[ -f x ]] && echo -e y';
    const detected = detectShell(text, 'x.sh');
    assert.deepStrictEqual(documentIssues(script(text), 'en', { detected }, ['echoE']).map((i) => i.code), ['dbracket']);
    const disabled = '#!/bin/sh\n# bash-explainer disable=dbracket\n[[ -f x ]] && echo -e y';
    assert.deepStrictEqual(documentIssues(script(disabled), 'en', { detected }).map((i) => i.code), ['echoE']);
  });

  it('reads a script with CRLF line ends as one with LF, and warns about it once', () => {
    const lf = 'if [ -f a ]; then\n  echo yes\nfi\n';
    const crlf = lf.replace(/\n/g, '\r\n');
    const doc = { lines: crlf.split(/\r?\n/), tree: parser.parse(crlf) };
    for (let line = 0; line < 3; line++) {
      assert.deepStrictEqual(explainDocumentLine(en, doc, line, 'en', {}, {}), explainDocumentLine(en, script(lf), line, 'en', {}, {}), `line ${line}`);
    }
    assert.strictEqual(doc.tree.root.endPosition.row, 3);
    // The blank that stands for a CR is no part of a comment (the shebang), a word or a string.
    const cr = parser.parse('#!/bin/sh\r\n# a\r\necho "PV " x\r\n');
    assert.deepStrictEqual(descendants(cr.root, ['comment']).map((n) => [n.text, n.endPosition.column]), [['#!/bin/sh', 9], ['# a', 3]]);
    // The warning is at the first CR, for every shell, in both languages.
    for (const lang of ['en', 'ja'] as const) {
      const issues = documentIssues(doc, lang, {});
      assert.deepStrictEqual(issues.map((i) => [i.code, i.severity, i.startLine, i.startCol, i.endCol]), [['crlf', 'warning', 0, 13, 17]]);
      assert.match(issues[0].message, lang === 'en' ? /Windows line endings/ : /CRLF/);
    }
    assert.deepStrictEqual(documentIssues(doc, 'en', { forced: 'dash' }).map((i) => i.code), ['crlf']);
    assert.deepStrictEqual(documentIssues(doc, 'en', {}, ['crlf']), []);
    // A file-level directive silences it, on any line (the warning itself is usually on line 1); and so does a comment after the code.
    const withDirective = crlf + '# bash-explainer disable-file=crlf\r\n';
    assert.deepStrictEqual(documentIssues({ lines: withDirective.split(/\r?\n/), tree: parser.parse(withDirective) }, 'en', {}), []);
    assert.match(documentIssues(doc, 'ja', {})[0].message, /disable-file=crlf/);
    // The range is the last word of the line, also with blanks before the CR; a line of nothing else has an empty range.
    const range = (t: string) => documentIssues({ lines: t.split(/\r?\n/), tree: parser.parse(t) }, 'en', {}).map((i) => [i.startLine, i.startCol, i.endLine, i.endCol]);
    assert.deepStrictEqual(range('echo a   \r\n'), [[0, 5, 0, 6]]);
    assert.deepStrictEqual(range('\r\necho a\r\n'), [[0, 0, 0, 0]]);
    assert.deepStrictEqual(documentIssues(script(lf), 'en', {}), []);
    // Only a CR before a LF is a line end; the one in the middle of a line is a character like the others.
    assert.deepStrictEqual(documentIssues(script('echo a\rb\n'), 'en', {}), []);
    // bash itself fails on such a script: `fi\r` is no `fi`.
    assert.ok(documentIssues(script('echo hi\r\nsleep 1\r\nfoo\r\n'), 'en', {}).length === 1);
  });

  it('finds the problems of a host file', () => {
    const codes = documentIssues(dockerfile('FROM alpine\nRUN curl -s x | sh'), 'en', {}).map((i) => i.code);
    assert.ok(codes.includes('dockerPipefail'), codes.join());
  });
});
