import * as assert from 'assert';
import * as path from 'path';
import type Parser = require('web-tree-sitter');
import { Analyzer, Token } from '../src/analyzer';
import { explainGetopts } from '../src/embedded/getopts';
import { explainCutList, explainSortKey, explainTrSet, trSummary } from '../src/embedded/textutils';
import { createBashParser } from '../src/parser';

describe('sort keys', () => {
  it('reads a single-field numeric reverse key', () => {
    const r = explainSortKey('3,3nr', 'en')!;
    assert.strictEqual(r.note, 'sort by field 3 only (compare as numbers, reverse (descending))');
    assert.deepStrictEqual(r.tokens.map((t) => [t.start, t.end]), [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5]]);
  });

  it('warns that a key without an end runs to the end of the line', () => {
    assert.match(explainSortKey('2', 'en')!.note!, /field 2 through the end of the line.*use `-k2,2`/);
  });

  it('handles character positions and rejects junk', () => {
    assert.match(explainSortKey('1.3,1.5', 'en')!.tokens[1].explanation, /character 3 of that field/);
    assert.strictEqual(explainSortKey('x', 'en'), undefined);
  });
});

describe('cut lists', () => {
  it('reads numbers and ranges', () => {
    assert.strictEqual(explainCutList('2-4,7', 'field', 'en')!.note, 'selects fields 2 to 4, field 7 (numbered from 1)');
    assert.strictEqual(explainCutList('-10', 'char', 'en')!.note, 'selects characters 1 to 10 (numbered from 1)');
    assert.strictEqual(explainCutList('3-', 'field', 'en')!.note, 'selects field 3 onwards (numbered from 1)');
    assert.strictEqual(explainCutList('a', 'field', 'en'), undefined);
  });
});

describe('tr sets', () => {
  it('names classes, ranges, escapes and repeats', () => {
    assert.deepStrictEqual(explainTrSet('[:upper:]a-z\\r[x*]', 'from', 'en')!.tokens.map((t) => t.explanation), [
      '`[:upper:]`: uppercase letters', '`a-z`: a-z', '`\\r`: carriage return (the CR of Windows CRLF)', '`[x*]`: "x" repeated as needed',
    ]);
    assert.match(explainTrSet('\\r', 'delete', 'en')!.note!, /^characters to delete/);
  });

  it('summarises case conversion', () => {
    assert.strictEqual(trSummary('[:upper:]', '[:lower:]', 'en'), 'converts uppercase to lowercase');
    assert.strictEqual(trSummary('a-z', 'A-Z', 'en'), 'converts lowercase to uppercase');
    assert.strictEqual(trSummary('abc', 'xyz', 'en'), undefined);
  });
});

describe('getopts option strings', () => {
  it('reads letters, values and silent mode', () => {
    const r = explainGetopts(':ab:c', 'en')!;
    assert.strictEqual(r.note, 'accepts -a, -b VALUE, -c');
    assert.deepStrictEqual(r.tokens.map((t) => [t.start, t.end]), [[0, 1], [1, 2], [2, 4], [4, 5]]);
    assert.match(r.tokens[0].explanation, /silent error mode/);
    assert.match(r.tokens[2].explanation, /takes a value .*\$OPTARG/);
    assert.strictEqual(explainGetopts('a-b', 'en'), undefined);
  });
});

describe('in command lines', () => {
  let parser: Parser;
  before(async () => {
    const root = path.join(__dirname, '..');
    parser = await createBashParser({
      runtimeDir: path.join(root, 'node_modules/web-tree-sitter'),
      bashWasm: path.join(root, 'node_modules/tree-sitter-bash/tree-sitter-bash.wasm'),
    });
  });
  const tokens = (src: string): Token[] => {
    const tree = parser.parse(src);
    const ex = new Analyzer('en').explainLine(tree, 0);
    tree.delete();
    const all = (ts: Token[]): Token[] => ts.flatMap((t) => [t, ...all(t.children)]);
    return all(ex.items);
  };

  it('breaks down attached and --name=value option values', () => {
    const ts = tokens('sort -t: -k3,3nr f');
    const n = ts.find((t) => t.label === 'n')!;
    assert.deepStrictEqual(n.span.start, { line: 0, character: 14 });
    assert.match(tokens('sort --key=2,2n f').find((t) => t.label.startsWith('--key'))!.explanation, /field 2 only/);
    assert.match(tokens('cut -d, -f2-4 f').find((t) => t.label === '2-4' && t.kind === 'argument')!.explanation, /fields 2 to 4/);
  });

  it('knows tr roles from the flags', () => {
    assert.match(tokens("tr -d '\\r'").find((t) => t.label === "'\\r'")!.explanation, /characters to delete/);
    assert.match(tokens("tr '[:upper:]' '[:lower:]'").find((t) => t.label === "'[:lower:]'")!.explanation, /converts uppercase to lowercase/);
  });
});
