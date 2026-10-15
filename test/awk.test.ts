import * as assert from 'assert';
import * as path from 'path';
import type Parser = require('web-tree-sitter');
import { Analyzer, Token } from '../src/analyzer';
import { explainAwk } from '../src/embedded/awk';
import { EmbeddedToken } from '../src/embedded/types';
import { createBashParser } from '../src/parser';

function all(ts: EmbeddedToken[]): EmbeddedToken[] {
  return ts.flatMap((t) => [t, ...all(t.children)]);
}

function find(src: string, ts: EmbeddedToken[], text: string): EmbeddedToken {
  const t = all(ts).find((x) => src.slice(x.start, x.end) === text);
  assert.ok(t, `no token "${text}" in ${all(ts).map((x) => src.slice(x.start, x.end)).join(' | ')}`);
  return t;
}

describe('awk explainer', () => {
  it('explains a pattern-action rule with fields', () => {
    const src = '$3 > 100 { print $1 }';
    const [rule] = explainAwk(src, 'en');
    assert.match(rule.explanation, /^Rule: run `\{ \}` for lines where `\$3 > 100` is true/);
    assert.match(find(src, [rule], '$3').explanation, /field 3/);
    assert.match(find(src, [rule], 'print $1').explanation, /^print `\$1`/);
  });

  it('separates rules and explains BEGIN, END and actions', () => {
    const src = 'BEGIN { FS = ":" } NR > 1 { sum += $2 } END { printf "%d\\n", sum }';
    const rules = explainAwk(src, 'en');
    assert.deepStrictEqual(rules.map((r) => src.slice(r.start, r.end)), ['BEGIN { FS = ":" }', 'NR > 1 { sum += $2 }', 'END { printf "%d\\n", sum }']);
    assert.match(rules[0].explanation, /once before reading any input/);
    assert.match(find(src, rules, 'FS').explanation, /input field separator/);
    assert.match(find(src, rules, 'sum += $2').explanation, /add `\$2` to `sum`/);
    assert.match(find(src, rules, 'printf "%d\\n", sum').explanation, /no newline is added/);
  });

  it('recognises the dedupe idiom, regex patterns and ranges', () => {
    assert.match(explainAwk('!seen[$0]++', 'en')[0].explanation, /print the first occurrence of each line/);
    const src = '/^#/,/^$/';
    const [rule] = explainAwk(src, 'en');
    assert.match(rule.explanation, /lines from lines matching `\^#` through lines matching `\^\$`/);
    assert.match(find(src, [rule], '^').explanation, /start of the line/);
  });

  it('explains statements: if/else, for-in, next, increments, redirections and calls', () => {
    const src = '/x/ { next } { if (length($0) > 80) n++; else m-- } END { for (k in c) print k > "out" ; gsub(/a/, "b") }';
    const ts = explainAwk(src, 'en');
    assert.match(find(src, ts, 'next').explanation, /move to the next/);
    assert.match(find(src, ts, 'if (length($0) > 80) n++; else m--').explanation, /^if `length\(\$0\) > 80` is true/);
    assert.match(find(src, ts, 'n++').explanation, /increment `n`/);
    assert.match(find(src, ts, 'for (k in c) print k > "out"').explanation, /each key of the array `c` as `k`/);
    assert.match(find(src, ts, 'print k > "out"').explanation, /to the file "out"/);
    assert.match(find(src, ts, 'gsub(/a/, "b")').explanation, /^call `gsub\(\)`: replace every regex match/);
  });

  it('treats / as division after an operand and as a regex elsewhere', () => {
    const src = '{ print a / b / c }';
    assert.ok(!all(explainAwk(src, 'en')).some((t) => /Regex/.test(t.explanation)));
    assert.ok(all(explainAwk('$1 ~ /a/', 'en')).some((t) => /Regex/.test(t.explanation)));
  });

  it('copes with incomplete programs', () => {
    for (const bad of ['{ print', 'function f(', '/abc', '{ if (x']) assert.doesNotThrow(() => explainAwk(bad, 'en'), bad);
  });
});

describe('awk in a command line', () => {
  let parser: Parser;
  before(async () => {
    const root = path.join(__dirname, '..');
    parser = await createBashParser({
      runtimeDir: path.join(root, 'node_modules/web-tree-sitter'),
      bashWasm: path.join(root, 'node_modules/tree-sitter-bash/tree-sitter-bash.wasm'),
    });
  });

  it('maps a multi-line program onto the right lines', () => {
    const src = "awk '\n  NR > 1 { total += $2 }\n  END { print total }\n' data.txt";
    const tree = parser.parse(src);
    const ex = new Analyzer('en').explainLine(tree, 2);
    tree.delete();
    const flat = (ts: Token[]): Token[] => ts.flatMap((t) => [t, ...flat(t.children)]);
    const end = flat(ex.items).find((t) => t.label === 'END')!;
    assert.deepStrictEqual(end.span.start, { line: 2, character: 2 });
  });
});
