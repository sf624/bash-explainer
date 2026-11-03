import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { Analyzer } from '../src/analyzer';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { partHover, wholeLine } from '../src/ui/hoverView';
import { panelUpdate } from '../src/ui/panelView';
import { toPlainMarkdown } from '../src/ui/render';
import { type PanelRow, rowPlain, tokenRow } from '../src/ui/tokenRow';
import { main } from '../cli/main';
import { base, compareKnown, keyOf } from './support/scan';
import { counted, scanAll, virtualFiles } from './support/row-source';

// One row record per token (docs/design/sources.md, row 15, SB3c): the panel (media/panel.js `item`), the hover (src/ui/hoverView.ts),
// Markdown (src/ui/render.ts) and the command line (cli/main.ts) read what a row holds from `tokenRow`. An output that reads those
// fields of a token by itself fails here: outside src/ui/tokenRow.ts, in src/ui/, cli/ and web/, they are found by the type of what is
// read (test/support/row-source.ts). test/fixtures/row-source-known.json lists what reads them for something that is no row; it may only
// shrink.

const known: { reads: { file: string; fn: string; kind: string; count: number; reason: string }[] } = JSON.parse(fs.readFileSync(path.join(base, 'test', 'fixtures', 'row-source-known.json'), 'utf8'));

/** The names of the members of an interface of src/ui/tokenRow.ts. */
function members(sf: ts.SourceFile, name: string): string[] {
  const i = sf.statements.find((st): st is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(st) && st.name.text === name)!;
  return i.members.map((m) => m.name!.getText());
}

describe('one record for what a token\'s row holds', () => {
  it('finds a token\'s row fields read outside the record, by the type of what is read', () => {
    const file = path.join(base, 'src', 'ui', 'snippet-row.ts');
    virtualFiles.set(file, `import type { Token } from '../analyzer-types';
      import type { TokenRow } from './tokenRow';
      declare const tok: Token; declare const maybe: Token | undefined; declare const row: TokenRow; declare const other: { explanation: string };
      export const a = tok.explanation + maybe?.name;
      export const b = tok['refs'];
      export const { value, label: named } = tok;
      export const fine = [row.text, row.label, other.explanation, tok.span, tok.children, tok.kind];`);
    try {
      assert.deepStrictEqual(scanAll([file]).map((m) => m.what).sort(), ['explanation', 'label', 'name', 'refs', 'value']);
    } finally {
      virtualFiles.delete(file);
    }
  });

  it('leaves no reader of a row\'s content but those listed', () => {
    const actual = new Map(counted(scanAll()).map((c) => [keyOf(c.file, c.fn, c.kind), c.count]));
    const listed = new Map(known.reads.map((d) => [keyOf(d.file, d.fn, d.kind), d.count]));
    assert.deepStrictEqual(compareKnown(actual, listed, 'read the field from the row (`tokenRow`, src/ui/tokenRow.ts)'), []);
    for (const entry of known.reads) assert.ok(entry.reason, keyOf(entry.file, entry.fn, entry.kind));
    // The four outputs have no entry at all, but for how the hover walks its tree.
    assert.deepStrictEqual(known.reads.filter((d) => ['src/ui/render.ts', 'cli/main.ts'].includes(d.file)), []);
  });

  it('has the panel draw the record: `item` reads only what a row holds, and no token reaches the page', () => {
    const rowFile = ts.createSourceFile('tokenRow.ts', fs.readFileSync(path.join(base, 'src/ui/tokenRow.ts'), 'utf8'), ts.ScriptTarget.ES2022, true);
    const held = new Set([...members(rowFile, 'TokenRow'), ...members(rowFile, 'PanelRow')]);
    const text = fs.readFileSync(path.join(base, 'media/panel.js'), 'utf8');
    const sf = ts.createSourceFile('panel.js', text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
    let item: ts.FunctionDeclaration | undefined;
    const find = (n: ts.Node): void => {
      if (ts.isFunctionDeclaration(n) && n.name?.text === 'item') item = n;
      ts.forEachChild(n, find);
    };
    find(sf);
    const param = item!.parameters[0].name.getText();
    const reads = new Set<string>();
    const visit = (n: ts.Node): void => {
      if (ts.isPropertyAccessExpression(n) && n.expression.getText() === param) reads.add(n.name.text);
      ts.forEachChild(n, visit);
    };
    visit(item!);
    assert.ok(reads.size >= 8, [...reads].join());
    assert.deepStrictEqual([...reads].filter((r) => !held.has(r)), []);
    // (The explanation it is sent has no tokens: the rows take their place.)
    assert.doesNotMatch(text, /\bex\.items\b|\.explanation\.items\b/);
    const msg = panelUpdate({ lang: 'en', explanation: new Analyzer('en').explainLine(createUnbashParser().parse('ls "$x" # y'), 0, 'bash'), file: 'a.sh', line: 0, lineText: 'ls "$x" # y', choice: {}, placement: 'first', animations: true });
    assert.ok(!('items' in msg.explanation));
    const keys = (r: PanelRow): string[] => [...Object.keys(r), ...r.children.flatMap(keys)];
    assert.deepStrictEqual(msg.rows.flatMap(keys).filter((k) => !held.has(k)), []);
  });

  it('says the same in every output: the record\'s label, text and references, each in its markup', async () => {
    const parser = createUnbashParser();
    const src = 'grep -c "$x" f.txt | xargs echo hi; for i in a b; do : ; done # note';
    for (const lang of ['en', 'ja'] as const) {
      const ex = new Analyzer(lang).explainLine(parser.parse(src), 0, 'bash');
      const md = toPlainMarkdown(ex, src, 'a.sh:1', lang);
      let text = '';
      await main(['--no-config', '--no-color', '--lang', lang, '-e', src], { stdout: (s) => { text += s; }, stderr: () => {}, env: {}, isTTY: false });
      const x = { ex, lang, theme: 'dark' as const, lineText: src, panelLink: 'command:p', lineLink: 'command:l', keys: 'k', placement: 'first' as const };
      const whole = wholeLine(x);
      const msg = panelUpdate({ lang, explanation: ex, file: 'a.sh', line: 0, lineText: src, choice: {}, placement: 'bottom', animations: true });
      const rowsOf = (rs: PanelRow[]): PanelRow[] => rs.flatMap((r) => [r, ...rowsOf(r.children)]);
      const sent = rowsOf(msg.rows);
      const walk = (t: (typeof ex.items)[number]): void => {
        const r = tokenRow(t, lang);
        assert.ok(md.includes(`${rowPlain(r)}`), r.label);
        assert.ok(text.includes(rowPlain(r).replace(/`/g, '')), r.label);
        assert.ok(sent.some((s) => s.label === r.label && s.text === r.text && s.kind === r.kind), r.label);
        t.children.forEach(walk);
      };
      ex.items.forEach(walk);
      assert.ok(whole.includes('grep'));
      // (The part's own hover opens with the same row.)
      assert.ok(partHover(x, [ex.items[0]]).length > 0);
    }
  });
});
