import * as assert from 'assert';
import * as path from 'path';
import type { BashParser as Parser } from '../src/parser';
import { Analyzer, Token } from '../src/analyzer';
import { explainGitDate, explainGitFormat } from '../src/embedded/gitformat';
import { createBashParser } from '../src/parser';

describe('git formats', () => {
  it('explains placeholders, colours and alignment', () => {
    const src = 'format:%C(yellow)%h%Creset %<(20)%an %ar%x09%d%%';
    const ts = explainGitFormat(src, 'en')!.tokens;
    const pick = (t: string) => ts.find((x) => src.slice(x.start, x.end) === t)!.explanation;
    assert.match(pick('format:'), /newline between commits/);
    assert.match(pick('%C(yellow)'), /colour what follows yellow/);
    assert.match(pick('%h'), /abbreviated commit hash/);
    assert.match(pick('%Creset'), /reset the colour/);
    assert.match(pick('%<(20)'), /left-aligned in 20 columns/);
    assert.match(pick('%ar'), /relative/);
    assert.match(pick('%x09'), /0x09/);
    assert.match(pick('%d'), /ref names/);
    assert.match(pick('%%'), /literal "%"/);
  });

  it('knows named formats and date styles', () => {
    assert.strictEqual(explainGitFormat('oneline', 'en')!.note, 'one line per commit (hash and subject)');
    assert.match(explainGitDate('short', 'en')!.note!, /date only/);
    assert.match(explainGitDate('iso-local', 'en')!.note!, /in local time/);
    assert.match(explainGitDate('format:%Y', 'en')!.tokens[1].explanation, /year/);
    assert.strictEqual(explainGitFormat('nonsense', 'en'), undefined);
  });
});

describe('quoted option values', () => {
  let parser: Parser;
  before(async () => {
    const root = path.join(__dirname, '..');
    parser = await createBashParser({
      runtimeDir: path.join(root, 'node_modules/web-tree-sitter'),
      bashWasm: path.join(root, 'node_modules/tree-sitter-bash/tree-sitter-bash.wasm'),
    });
  });

  it('maps placeholders across the quote in --pretty=format:\'…\'', () => {
    const tree = parser.parse("git log --pretty=format:'%h %s'");
    const ex = new Analyzer('en').explainLine(tree, 0);
    tree.delete();
    const all = (ts: Token[]): Token[] => ts.flatMap((t) => [t, ...all(t.children)]);
    const ts = all(ex.items);
    const opt = ts.find((t) => t.label.startsWith('--pretty'))!;
    assert.strictEqual(opt.kind, 'option');
    assert.match(opt.explanation, /how each commit is shown/);
    const h = ts.find((t) => t.label === '%h')!;
    assert.deepStrictEqual([h.span.start.character, h.span.end.character], [25, 27]);
    const kw = ts.find((t) => t.label === 'format:')!;
    assert.deepStrictEqual([kw.span.start.character, kw.span.end.character], [17, 24]);
  });
});
