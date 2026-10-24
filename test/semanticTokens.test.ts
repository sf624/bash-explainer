import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { HighlightKind } from '../src/highlight';
import { decodeTokens, encodeTokens, LEGEND, semanticTokens, TOKEN_MODIFIERS, TOKEN_OF, TOKEN_TYPES } from '../src/semanticTokens';
import { createUnbashParser } from '../src/syntax/adapters/unbash';

const parser = createUnbashParser();

describe('semantic tokens', () => {
  it('has a legend of standard LSP token types and modifiers', () => {
    // From the LSP 3.17 specification (SemanticTokenTypes, SemanticTokenModifiers).
    const standardTypes = ['namespace', 'type', 'class', 'enum', 'interface', 'struct', 'typeParameter', 'parameter', 'variable', 'property', 'enumMember',
      'event', 'function', 'method', 'macro', 'keyword', 'modifier', 'comment', 'string', 'number', 'regexp', 'operator', 'decorator', 'label'];
    const standardModifiers = ['declaration', 'definition', 'readonly', 'static', 'deprecated', 'abstract', 'async', 'modification', 'documentation', 'defaultLibrary'];
    assert.deepEqual(LEGEND, { tokenTypes: [...TOKEN_TYPES], tokenModifiers: [...TOKEN_MODIFIERS] });
    for (const t of LEGEND.tokenTypes) assert.ok(standardTypes.includes(t), t);
    // Our own modifiers are declared in package.json, with a description.
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
    const own: { id: string; description: string }[] = pkg.contributes.semanticTokenModifiers;
    assert.deepEqual(own.map((m) => m.id), ['exported']);
    for (const m of LEGEND.tokenModifiers) assert.ok(standardModifiers.includes(m) || own.some((o) => o.id === m), m);
    // Every type and modifier is used by some kind, or by what the state says of a variable.
    const used = [...Object.values(TOKEN_OF).flatMap((t) => t ?? []), 'readonly', 'exported'];
    for (const x of [...TOKEN_TYPES, ...TOKEN_MODIFIERS]) assert.ok(used.includes(x), x);
  });

  it('encodes spans relative to the previous one, and leaves out errors', () => {
    const span = (line: number, from: number, to: number, kind: HighlightKind) => ({ line, from, to, kind });
    assert.deepEqual(encodeTokens([
      span(0, 0, 4, 'builtin'), span(0, 5, 7, 'option'), span(0, 8, 9, 'error'), span(2, 2, 4, 'assignment'), span(2, 6, 9, 'functionName'), span(3, 1, 2, 'glob'),
    ]), [
      0, 0, 4, TOKEN_TYPES.indexOf('function'), 0b100,
      0, 5, 2, TOKEN_TYPES.indexOf('parameter'), 0,
      2, 2, 2, TOKEN_TYPES.indexOf('variable'), 0b010,
      0, 4, 3, TOKEN_TYPES.indexOf('function'), 0b001,
      1, 1, 1, TOKEN_TYPES.indexOf('regexp'), 0,
    ]);
    assert.deepEqual(encodeTokens([]), []);
  });

  it('gives the tokens of a document, or of some of its lines', () => {
    const text = 'echo hi\n# c\nls -l';
    const doc = { lines: text.split('\n'), tree: parser.parse(text) };
    const all = semanticTokens(doc);
    assert.deepEqual(all, [0, 0, 4, 2, 4, 1, 0, 3, 0, 0, 1, 0, 2, 2, 0, 0, 3, 2, 3, 0]);
    assert.deepEqual(semanticTokens(doc, { lines: { from: 1, to: 1 } }), [1, 0, 3, 0, 0]);
    // The sample, whole: as many tokens as spans with a token type.
    const sample = fs.readFileSync(path.join(__dirname, 'fixtures/sample.sh'), 'utf8');
    assert.strictEqual(semanticTokens({ lines: sample.split('\n'), tree: parser.parse(sample) }).length % 5, 0);
  });

  it('gives a range request the tokens of the full one on those lines, read there only', () => {
    const sample = fs.readFileSync(path.join(__dirname, 'fixtures/sample.sh'), 'utf8');
    const doc = { lines: sample.split('\n'), tree: parser.parse(sample) };
    const all = decodeTokens(semanticTokens(doc));
    for (const [from, to] of [[0, 0], [10, 40], [100, 103], [doc.lines.length - 5, doc.lines.length + 10]]) {
      assert.deepStrictEqual(decodeTokens(semanticTokens(doc, { lines: { from, to } })), all.filter((t) => t.line >= from && t.line <= to), `${from}-${to}`);
    }
  });

  it('adds the modifiers the state gives a variable, and colours an alias as a macro', () => {
    const text = 'shopt -s expand_aliases\nalias ll=ls\nreadonly R=1\nexport E=2\nll $R $E';
    const got = decodeTokens(semanticTokens({ lines: text.split('\n'), tree: parser.parse(text) })).filter((t) => t.line === 4);
    assert.deepStrictEqual(got.map((t) => `${t.type}:${t.modifiers.join('.')}`), ['macro:', 'variable:readonly', 'variable:exported']);
  });
});
