import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { HighlightKind } from '../src/highlight';
import { decodeTokens, encodeTokens, LEGEND, semanticTokens, SUPER_TYPES, TOKEN_MODIFIERS, TOKEN_OF, TOKEN_TYPES } from '../src/semanticTokens';
import { TOKEN_SETTINGS } from '../src/settings';
import { createUnbashParser } from '../src/syntax/adapters/unbash';

const parser = createUnbashParser();

describe('semantic tokens', () => {
  it('has a legend of standard LSP token types and modifiers', () => {
    // From the LSP 3.17 specification (SemanticTokenTypes, SemanticTokenModifiers).
    const standardTypes = ['namespace', 'type', 'class', 'enum', 'interface', 'struct', 'typeParameter', 'parameter', 'variable', 'property', 'enumMember',
      'event', 'function', 'method', 'macro', 'keyword', 'modifier', 'comment', 'string', 'number', 'regexp', 'operator', 'decorator', 'label'];
    const standardModifiers = ['declaration', 'definition', 'readonly', 'static', 'deprecated', 'abstract', 'async', 'modification', 'documentation', 'defaultLibrary'];
    assert.deepEqual(LEGEND, { tokenTypes: [...TOKEN_TYPES], tokenModifiers: [...TOKEN_MODIFIERS] });
    // Our own types and modifiers are declared in package.json, with a description, and each type with its standard super type.
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
    const ownTypes: { id: string; superType: string; description: string }[] = pkg.contributes.semanticTokenTypes;
    assert.deepEqual(Object.fromEntries(ownTypes.map((t) => [t.id, t.superType])), SUPER_TYPES);
    for (const t of ownTypes) assert.ok(standardTypes.includes(t.superType) && t.description, t.id);
    for (const t of LEGEND.tokenTypes) assert.ok(standardTypes.includes(t) || t in SUPER_TYPES, t);
    const own: { id: string; description: string }[] = pkg.contributes.semanticTokenModifiers;
    assert.deepEqual(own.map((m) => m.id), ['exported', 'unquoted']);
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
    // The shebang is a type of our own: a client that does not list it gets a comment, the standard types stay.
    const first = [span(0, 0, 11, 'shebang'), span(1, 0, 4, 'builtin')];
    assert.deepEqual(encodeTokens(first), [0, 0, 11, TOKEN_TYPES.indexOf('shebang'), 0, 1, 0, 4, TOKEN_TYPES.indexOf('function'), 0b100]);
    assert.deepEqual(encodeTokens(first, ['comment', 'function']), [0, 0, 11, TOKEN_TYPES.indexOf('comment'), 0, 1, 0, 4, TOKEN_TYPES.indexOf('function'), 0b100]);
    assert.deepEqual(encodeTokens(first, ['shebang']), encodeTokens(first));
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

  it('sends a word that only looks like an option as an unquoted string, the scope of a plain argument', () => {
    const text = 'grep -e -v f';
    const got = decodeTokens(semanticTokens({ lines: [text], tree: parser.parse(text) }));
    assert.deepStrictEqual(got.map((t) => `${text.slice(t.start, t.start + t.length)} ${t.type}:${t.modifiers.join('.')}`), ['grep function:', '-e parameter:', '-v string:unquoted']);
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
    for (const e of pkg.contributes.semanticTokenScopes) assert.deepStrictEqual(e.scopes['string.unquoted'], ['string.unquoted.argument.shell'], e.language);
  });

  it('asks for new tokens when a setting they depend on changes: the shell decides what a name runs', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
    for (const k of TOKEN_SETTINGS) assert.ok(pkg.contributes.configuration.properties[`bashExplainer.${k}`], k);
    // `shopt` is a builtin of bash, a program in sh: the same text, other tokens.
    const text = 'shopt -s x';
    const doc = { lines: [text], tree: parser.parse(text) };
    const of = (forced: 'bash' | 'sh') => decodeTokens(semanticTokens(doc, { shells: { forced } }))[0].modifiers;
    assert.deepStrictEqual([of('bash'), of('sh')], [['defaultLibrary'], []]);
    assert.ok(TOKEN_SETTINGS.includes('shell'));
  });

  it('adds the modifiers the state gives a variable, and colours an alias as a macro', () => {
    const text = 'shopt -s expand_aliases\nalias ll=ls\nreadonly R=1\nexport E=2\nll $R $E';
    const got = decodeTokens(semanticTokens({ lines: text.split('\n'), tree: parser.parse(text) })).filter((t) => t.line === 4);
    assert.deepStrictEqual(got.map((t) => `${t.type}:${t.modifiers.join('.')}`), ['macro:', 'variable:readonly', 'variable:exported']);
  });
});
