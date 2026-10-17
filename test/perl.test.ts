import * as assert from 'assert';
import * as path from 'path';
import type { BashParser as Parser } from '../src/parser';
import { Analyzer, Token } from '../src/analyzer';
import { explainPerl, perlLoopNote } from '../src/embedded/perl';
import { EmbeddedToken } from '../src/embedded/types';
import { createBashParser } from '../src/parser';

const all = (ts: EmbeddedToken[]): EmbeddedToken[] => ts.flatMap((t) => [t, ...all(t.children)]);
const text = (src: string, t: EmbeddedToken) => src.slice(t.start, t.end);

describe('perl code', () => {
  it('breaks down substitutions with a PCRE pattern, replacement and flags', () => {
    const src = 's/foo(\\d+)/bar$1/g';
    const [sub] = explainPerl(src, 'en');
    assert.match(sub.explanation, /^Substitute in the line \(`\$_`\): replace every match of `foo\(\\d\+\)` with `bar\$1`/);
    assert.deepStrictEqual(sub.children.map((t) => text(src, t)), ['foo(\\d+)', 'bar$1', 'g']);
    assert.match(all(sub.children).find((t) => text(src, t) === '\\d')!.explanation, /a digit/);
    assert.match(all(sub.children).find((t) => text(src, t) === '$1')!.explanation, /group 1/);
  });

  it('handles bracketed delimiters and other targets', () => {
    const src = '$x =~ s{a/b}{c}gi';
    const [sub] = explainPerl(src, 'en');
    assert.match(sub.explanation, /Substitute in `\$x`/);
    assert.deepStrictEqual(sub.children.map((t) => text(src, t)), ['a/b', 'c', 'g', 'i']);
  });

  it('explains statement modifiers and bare regex conditions', () => {
    const src = 'print if /^ERROR/';
    const [stmt] = explainPerl(src, 'en');
    assert.match(stmt.explanation, /^if the line matches `\/\^ERROR\/`: `print`/);
    assert.ok(all([stmt]).some((t) => t.kind === 'keyword' && text(src, t) === '^'));
    assert.match(explainPerl('next unless $x', 'en')[0].explanation, /^unless `\$x`: skip to the next line/);
  });

  it('splits statements and explains blocks, fields and assignments', () => {
    const src = '$sum += $F[1]; $seen{$_}++; END { print $sum }';
    const ts = explainPerl(src, 'en');
    assert.deepStrictEqual(ts.map((t) => text(src, t)), ['$sum += $F[1]', '$seen{$_}++', 'END { print $sum }']);
    assert.match(all(ts).find((t) => text(src, t) === '$F[1]')!.explanation, /field 2/);
    assert.match(ts[1].explanation, /increment/);
    assert.match(ts[2].explanation, /once after all input/);
  });

  it('describes the -n/-p/-a/-l/-i loop', () => {
    assert.match(perlLoopNote(new Set(['p', 'i']), 'en')!, /then prints `\$_`.*edited in place/);
    assert.strictEqual(perlLoopNote(new Set(['w']), 'en'), undefined);
  });
});

describe('perl in a command line', () => {
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
    const flat = (ts: Token[]): Token[] => ts.flatMap((t) => [t, ...flat(t.children)]);
    return flat(ex.items);
  };

  it('describes the loop around -e code', () => {
    const arg = tokens("perl -lane 'print $F[1]' f").find((t) => t.label === "'print $F[1]'" && t.kind === 'argument')!;
    assert.match(arg.explanation, /for each input line.*split on whitespace into `@F`.*line endings are removed/);
  });

  it('warns that -pie makes e the backup extension', () => {
    const ts = tokens("perl -pie 's/a/b/' f");
    assert.match(ts.find((t) => t.label === 'e')!.explanation, /taken as the value of `-i`/);
    assert.match(ts.find((t) => t.label === "'s/a/b/'")!.explanation, /script file to run/);
  });
});
