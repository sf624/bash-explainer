import * as assert from 'assert';
import * as path from 'path';
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
    assert.deepStrictEqual(ex.items.map((i) => i.label), ['grep -rn TODO src']);
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

  it('finds the problems of a host file', () => {
    const codes = documentIssues(dockerfile('FROM alpine\nRUN curl -s x | sh'), 'en', {}).map((i) => i.code);
    assert.ok(codes.includes('dockerPipefail'), codes.join());
  });
});
