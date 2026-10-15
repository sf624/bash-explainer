import * as assert from 'assert';
import * as path from 'path';
import type Parser = require('web-tree-sitter');
import { Analyzer, Token } from '../src/analyzer';
import { explainRegex, Flavor } from '../src/embedded/regex';
import { EmbeddedToken } from '../src/embedded/types';
import { createBashParser } from '../src/parser';

const root = path.join(__dirname, '..');
let parser: Parser;

before(async () => {
  parser = await createBashParser({
    runtimeDir: path.join(root, 'node_modules/web-tree-sitter'),
    bashWasm: path.join(root, 'node_modules/tree-sitter-bash/tree-sitter-bash.wasm'),
  });
});

/** `[text, kind]` for each top-level token. */
function parts(src: string, flavor: Flavor): [string, string][] {
  return explainRegex(src, flavor, 'en').map((t) => [src.slice(t.start, t.end), t.kind]);
}

function find(tokens: EmbeddedToken[], src: string, text: string): EmbeddedToken {
  const all = (ts: EmbeddedToken[]): EmbeddedToken[] => ts.flatMap((t) => [t, ...all(t.children)]);
  const t = all(tokens).find((x) => src.slice(x.start, x.end) === text);
  assert.ok(t, `no token "${text}"`);
  return t;
}

function lineTokens(src: string): Token[] {
  const tree = parser.parse(src);
  const ex = new Analyzer('en').explainLine(tree, 0);
  tree.delete();
  const all = (ts: Token[]): Token[] => ts.flatMap((t) => [t, ...all(t.children)]);
  return all(ex.items);
}

describe('regex explainer', () => {
  it('splits an ERE into anchors, classes, quantifiers and literals', () => {
    assert.deepStrictEqual(parts('^[A-Z]{3}-[0-9]+$', 'ere'), [
      ['^', 'keyword'], ['[A-Z]', 'pattern'], ['{3}', 'operator'], ['-', 'string'], ['[0-9]', 'pattern'], ['+', 'operator'], ['$', 'keyword'],
    ]);
  });

  it('binds a quantifier to the last character of a literal run', () => {
    assert.deepStrictEqual(parts('abc+', 'ere'), [['ab', 'string'], ['c', 'string'], ['+', 'operator']]);
    const src = 'abc+';
    assert.match(find(explainRegex(src, 'ere', 'en'), src, '+').explanation, /repeat `c` one or more times/);
  });

  it('treats + ? ( | as literals in BRE and uses the backslashed forms instead', () => {
    assert.deepStrictEqual(parts('a+(b)', 'bre').map((p) => p[1]), ['string', 'string', 'string', 'string', 'string']);
    assert.match(explainRegex('a+', 'bre', 'en')[1].explanation, /in basic regex `\+` is not special; with `-E`/);
    assert.deepStrictEqual(parts('\\(ab\\)\\{2\\}\\1', 'bre').map((p) => p[1]), ['block', 'operator', 'variable']);
    assert.strictEqual(parts('*a', 'bre')[0][1], 'string', 'a leading * is literal in BRE');
  });

  it('explains groups, alternation and backreferences', () => {
    const src = '(foo|bar)-\\1';
    const ts = explainRegex(src, 'ere', 'en');
    assert.match(ts[0].explanation, /^Group 1/);
    assert.deepStrictEqual(ts[0].children.map((t) => src.slice(t.start, t.end)), ['foo', '|', 'bar']);
    assert.match(find(ts, src, '\\1').explanation, /same text group 1 matched/);
    assert.match(explainRegex('\\2', 'ere', 'en')[0].explanation, /no group 2/);
  });

  it('describes bracket expressions', () => {
    assert.match(explainRegex('[^a-z_[:digit:]]', 'ere', 'en')[0].explanation, /one character other than a-z, "_", digits/);
    assert.match(explainRegex('[]a]', 'ere', 'en')[0].explanation, /one of "\]", "a"/);
    assert.strictEqual(explainRegex('[abc', 'ere', 'en')[0].kind, 'error');
  });

  it('knows which shorthands need -P', () => {
    assert.match(explainRegex('\\d', 'ere', 'en')[0].explanation, /just "d" in POSIX regex; it means a digit only with `-P`/);
    assert.match(explainRegex('\\d', 'pcre', 'en')[0].explanation, /a digit/);
    assert.match(explainRegex('\\w', 'bre', 'en')[0].explanation, /word character/);
  });

  it('handles PCRE lookarounds, lazy quantifiers and named groups', () => {
    const src = '(?<year>\\d{4})-\\d+?(?=px)';
    const ts = explainRegex(src, 'pcre', 'en');
    assert.match(ts[0].explanation, /Named group `year` \(group 1\)/);
    assert.match(find(ts, src, '+?').explanation, /as few as possible/);
    assert.match(find(ts, src, '(?=px)').explanation, /lookahead/);
  });
});

describe('regex in commands', () => {
  it('breaks down a grep pattern inside quotes at the right columns', () => {
    const ts = lineTokens("grep -E '^a+$' f");
    const arg = ts.find((t) => t.label === "'^a+$'" && t.kind === 'argument')!;
    assert.match(arg.explanation, /search pattern \(regex\) — extended regex \(ERE\)/);
    const plus = ts.find((t) => t.label === '+')!;
    assert.deepStrictEqual(plus.span.start, { line: 0, character: 11 });
  });

  it('picks the dialect from the options', () => {
    assert.match(lineTokens("grep 'a+' f").find((t) => t.kind === 'argument')!.explanation, /basic regex/);
    assert.match(lineTokens("grep -iP 'a+' f").find((t) => t.kind === 'argument')!.explanation, /Perl-compatible/);
    assert.match(lineTokens("egrep 'a+' f").find((t) => t.kind === 'argument')!.explanation, /extended regex/);
    const fixed = lineTokens("grep -F 'a.b' f");
    assert.match(fixed.find((t) => t.kind === 'argument')!.explanation, /fixed string/);
    assert.ok(!fixed.some((t) => t.label === '.'));
  });

  it('treats the argument after grep -e PATTERN as a file', () => {
    const ts = lineTokens('grep -e foo -e bar notes.txt');
    assert.match(ts.find((t) => t.label === 'notes.txt')!.explanation, /file to search/);
    assert.match(ts.find((t) => t.label === 'foo' && t.kind === 'argument')!.explanation, /Value for `-e`/);
  });

  it('breaks down [[ =~ ]] as an ERE', () => {
    const ts = lineTokens('[[ $v =~ ^v[0-9]+(\\.[0-9]+)*$ ]]');
    assert.ok(ts.some((t) => t.label === '(\\.[0-9]+)' && t.kind === 'block'));
  });

  it('describes an option with an attached value as that option, not a combination', () => {
    const f = lineTokens('awk -F, 1 f').find((t) => t.label === '-F,')!;
    assert.match(f.explanation, /field separator/);
    assert.deepStrictEqual(f.children.map((c) => c.label), [',']);
  });
});
