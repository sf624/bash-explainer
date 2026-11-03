import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { Analyzer } from '../src/analyzer';
import type { Token } from '../src/analyzer-types';
import { LEVELS } from '../src/levels';
import { MESSAGES } from '../src/messages';
import { insideLastBracket, plainOf } from '../src/messages-levels';
import { readSaid, saidText, TOKEN_TEXTS, tokenSaid } from '../src/messages-tokens';
import { ARGV_TEXTS } from '../src/messages-tokens-argv';
import { COMMAND_TEXTS } from '../src/messages-tokens-commands';
import { COMPOUND_TEXTS } from '../src/messages-tokens-compound';
import { SHEBANG_TEXTS } from '../src/messages-tokens-shebang';
import { WORD_TEXTS } from '../src/messages-tokens-words';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { dropLabelEcho, markedText, markSaid, sayInstead } from '../src/tokenmarks';
import { explainDocumentLine } from '../src/document';
import { type FileKind, openDocument, shellsOf } from '../src/document-setup';
import { partHover, wholeLine } from '../src/ui/hoverView';
import { panelUpdate } from '../src/ui/panelView';
import { toPlainMarkdown } from '../src/ui/render';
import type { PanelRow } from '../src/ui/panelRows';
import { rowPlain, tokenRow } from '../src/ui/tokenRow';
import { main } from '../cli/main';
import { corpus } from './support/corpus';
import { detectShell } from '../src/dialect';
import { base, compareKnown, keyOf } from './support/scan';
import { counted, scanAll, virtualFiles } from './support/row-source';

// One row record per token (docs/design/sources.md, row 15, SB3c): the panel (media/panel.js `item`), the hover (src/ui/hoverView.ts),
// Markdown (src/ui/render.ts) and the command line (cli/main.ts) read what a row holds from `tokenRow`. An output that reads those
// fields of a token by itself fails here: outside src/ui/tokenRow.ts, in src/ui/, cli/ and web/, they are found by the type of what is
// read (test/support/row-source.ts). test/fixtures/row-source-known.json lists what reads them for something that is no row; it may only
// shrink.

const known: { reads: { file: string; fn: string; kind: string; count: number; reason: string }[] } = JSON.parse(fs.readFileSync(path.join(base, 'test', 'fixtures', 'row-source-known.json'), 'utf8'));

/** The names of the members of an interface of a file. */
function members(sf: ts.SourceFile, name: string): string[] {
  const i = sf.statements.find((st): st is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(st) && st.name.text === name)!;
  return i.members.map((m) => m.name!.getText());
}

/** A token with the text `explanation`, as a test makes one. */
const tokenWith = (explanation: string): Token => ({ kind: 'option', label: '-x', explanation, span: { start: { line: 0, character: 0 }, end: { line: 0, character: 2 } }, children: [] });

/** Every token under `items`. */
const allTokens = (items: readonly Token[]): Token[] => items.flatMap((t) => [t, ...allTokens(t.children)]);

describe('one record for what a token\'s row holds', function () {
  // (A TypeScript program over src/ui/, cli/ and web/: seconds, and more with coverage on a loaded CI machine.)
  this.timeout(120000);

  // Left open: a key that is a plain string (`tok[k]`), a parameter of an unconstrained type (`<T>(x: T)`) that hides a token before a field is
  // read, a value typed `any` from elsewhere (`JSON.parse`), what takes all of a token at once (`Object.values(tok)`, `JSON.stringify(tok)`),
  // a token handed on in a return or an object literal rather than a call or a typed `const`, and JavaScript (media/panel.js has its own check below).
  it('finds a token\'s row fields read outside the record, by the member that is read', () => {
    const file = path.join(base, 'src', 'ui', 'snippet-row.ts');
    virtualFiles.set(file, `import type { Token } from '../analyzer-types';
      import type { TokenRow } from './tokenRow';
      import { labelParts } from '../label';
      import { markedText } from '../tokenmarks';
      declare const tok: Token; declare const maybe: Token | undefined; declare const row: TokenRow; declare const other: { explanation: string };
      export const a = tok.explanation + maybe?.name;
      export const b = tok['refs'];
      export const { value, label: named } = tok;
      declare const ro: Readonly<Token>; declare const some: Partial<Token>; declare const picked: Pick<Token, 'group'>; declare const both: Token & { more: 1 };
      export const types = [ro.basis, some.tryIt, picked.group, both.summary];
      interface Sub extends Token { more: 1 }
      declare const sub: Sub;
      export const sub1 = sub.role;
      export function generic<T extends Token>(t: T) { return t.texts; }
      export const untyped = (tok as any).whatever;
      const copy = { ...tok };
      export const copied = copy.marks;
      const { kind: _kind, ...rest } = tok;
      export const rested = rest.facts;
      const key = 'labelParts' as const;
      export const keyed = tok[key];
      function structural(x: { explanation: string }) { return x; }
      export const handed = structural(tok);
      export const typed: { refs?: readonly string[] } = tok;
      export const direct = [markedText(tok), labelParts(tok)];
      export const fine = [row.text, row.label, other.explanation, tok.span, tok.children, tok.kind];`);
    try {
      assert.deepStrictEqual(scanAll([file]).map((m) => m.what).sort(), ['as any', 'basis', 'explanation', 'explanation', 'facts', 'group', 'label', 'label', 'labelParts', 'labelParts', 'labelParts', 'markedText', 'marks', 'name', 'refs', 'refs', 'role', 'summary', 'texts', 'tryIt', 'value']);
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
    const rowFile = (name: string) => ts.createSourceFile(name, fs.readFileSync(path.join(base, 'src/ui', name), 'utf8'), ts.ScriptTarget.ES2022, true);
    const held = new Set([...members(rowFile('tokenRow.ts'), 'TokenRow'), ...members(rowFile('panelRows.ts'), 'PanelRow')]);
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

  it('draws a warning of a row from its level: the text holds no mark, the record has its level and its id', async () => {
    const parser = createUnbashParser();
    for (const [src, lang, id, sentence] of [
      ['#!bash', 'en', 'shebang-relative-interpreter', '. ⚠ The kernel does not search PATH'],
      ['#!bash', 'ja', 'shebang-relative-interpreter', '。⚠ カーネルはインタープリタを PATH から探さず'],
      ['#!/usr/bin/env bash -e', 'en', 'shebang-env-one-argument', '. ⓧ On Linux the whole `bash -e`'],
      ['echo $((09))', 'en', 'arith-invalid-number', 'ⓧ Invalid number `09`'],
      ['terraform -var-file=x plan', 'en', 'terraform-option-before-subcommand', 'ⓧ an option before the subcommand'],
    ] as const) {
      const ex = new Analyzer(lang).explainLine(parser.parse(src), 0, 'bash', { reading: true });
      const all = (ts: typeof ex.items): typeof ex.items => ts.flatMap((t) => [t, ...all(t.children)]);
      const tok = all(ex.items).find((t) => t.marks?.some((m) => m.id === id))!;
      assert.ok(tok, src);
      assert.ok(tok.texts?.includes(id), src);
      assert.ok(!tok.explanation.includes(LEVELS.warning.mark), tok.explanation);
      const row = tokenRow(tok, lang);
      assert.strictEqual(row.level, id === 'shebang-relative-interpreter' ? 'warning' : 'error');
      assert.ok(row.text.includes(sentence), row.text);
      assert.ok(toPlainMarkdown(ex, src, 'a.sh:1', lang).includes(sentence), src);
      let text = '';
      await main(['--no-config', '--no-color', '--lang', lang, '-e', src], { stdout: (s) => { text += s; }, stderr: () => {}, env: {}, isTTY: false });
      assert.ok(text.includes(sentence.replace(/`/g, '')), text);
    }
    // In Reading, and in a line's summary (a shebang's row is what it says), and from the embedded arithmetic.
    const ex = new Analyzer('en').explainLine(parser.parse('#!bash'), 0, 'bash', { reading: true });
    const nodes = (n: NonNullable<typeof ex.reading>): (typeof n)[] => [n, ...n.children.flatMap(nodes)];
    assert.ok(nodes(ex.reading!).some((n) => n.text?.includes('⚠ The kernel')));
    assert.ok(ex.summary.includes('⚠ The kernel'));
    const embedded = new Analyzer('en').explainLine(parser.parse('let x=09'), 0, 'bash');
    assert.ok(JSON.stringify(embedded.items).includes('"marks":[{"id":"arith-invalid-number"'));
    // (A row with no warning has no level.)
    assert.strictEqual(tokenRow(new Analyzer('en').explainLine(parser.parse('ls'), 0, 'bash').items[0], 'en').level, undefined);
  });

  it('keeps one catalog of token texts: each id in one part, none also a note\'s', () => {
    const parts = [ARGV_TEXTS, COMMAND_TEXTS, COMPOUND_TEXTS, SHEBANG_TEXTS, WORD_TEXTS];
    const ids = parts.flatMap((p) => Object.keys(p));
    assert.deepStrictEqual(ids.filter((id, i) => ids.indexOf(id) !== i), []);
    assert.deepStrictEqual(ids.filter((id) => id in TOKEN_TEXTS === false), []);
    assert.deepStrictEqual(Object.keys(TOKEN_TEXTS).filter((id) => id in MESSAGES), []);
    assert.ok(Object.keys(TOKEN_TEXTS).length >= ids.length);
    // (A text of a spec carries its id, as `cx.text`'s does.)
    assert.deepStrictEqual(readSaid(saidText('terraform-option-before-subcommand').en).said.map((x) => [x.id, x.level]), [['terraform-option-before-subcommand', 'error']]);
    assert.deepStrictEqual(readSaid(tokenSaid('en', 'shebang-env-string-refused')).said[0].level, 'error');
    assert.strictEqual(readSaid(saidText('comment-plain').ja).said[0].level, undefined);
  });

  it('has no two ids of one text in both languages', () => {
    // (The params of an entry stand for themselves; an entry that reads more of one than a string has is left out.)
    const param = new Proxy({}, { get: (_, k) => (typeof k === 'string' ? `<${k}>` : undefined) });
    const seen = new Map<string, string[]>();
    let read = 0;
    for (const [id, entry] of Object.entries(TOKEN_TEXTS)) {
      try {
        const key = JSON.stringify((entry.text as (p: unknown) => readonly [string, string])(param));
        seen.set(key, [...seen.get(key) ?? [], id]);
        read++;
      } catch { /* c8 ignore next */ }
    }
    assert.ok(read > Object.keys(TOKEN_TEXTS).length * 0.8, `${read}`);
    assert.deepStrictEqual([...seen.values()].filter((ids) => ids.length > 1), []);
  });

  it('carries each id with its text, wherever the text goes', () => {
    const parser = createUnbashParser();
    const tokens = (src: string, lang: 'en' | 'ja' = 'en') => allTokens(new Analyzer(lang).explainLine(parser.parse(src), 0, 'bash').items);
    assert.deepStrictEqual(tokens('# hi')[0].texts, ['comment-plain']);
    assert.deepStrictEqual(tokens('ls -l').map((t) => t.texts), [undefined, undefined]);
    // (Short, inside a longer text, and in both languages: Japanese texts are shorter.)
    for (const lang of ['en', 'ja'] as const) {
      assert.ok(tokens('sort -k2 x', lang).some((t) => t.texts?.includes('option-value-for')), lang);
      assert.ok(tokens('sudo echo x', lang).some((t) => t.texts?.includes('wrapped-runs')), lang);
    }
    // (A text that another token only happens to contain is not said by it: `$a` quoted and not.)
    assert.deepStrictEqual(tokens('cp $a b; cp "$a" c').filter((t) => t.label === '$a' && t.texts).map((t) => t.texts), [['variable-expands-with-note'], ['variable-expands']]);
    // (An outer text and the one it holds, outermost first; a warning with its own level.)
    const t = tokenWith(tokenSaid('en', 'array-element-set', { what: tokenSaid('en', 'array-element-key', { key: 'k' }), value: 'v', append: false }));
    markSaid([t]);
    assert.deepStrictEqual(t.texts, ['array-element-set', 'array-element-key']);
    assert.strictEqual(t.explanation, plainOf(t.explanation));
    const warned = tokenWith(`a ${tokenSaid('en', 'terraform-option-before-subcommand')} and ${tokenSaid('en', 'terraform-option-before-subcommand')}`);
    markSaid([warned]);
    assert.deepStrictEqual(warned.marks?.length, 1);
    // (A summary loses them too.)
    const summed = { ...tokenWith('x'), summary: tokenSaid('en', 'comment-plain') };
    markSaid([summed]);
    assert.strictEqual(summed.summary, tokenSaid('en', 'comment-plain').replace(/[^ -~]/g, ''));
  });

  it('reads the characters that carry an id, also where they are a script\'s own', () => {
    const open = tokenSaid('en', 'comment-plain').slice(0, 2);
    const close = '﷑';
    assert.deepStrictEqual(readSaid('plain'), { text: 'plain', said: [] });
    // (A close with nothing open, one that never closes, one that holds nothing, one that names no text.)
    assert.deepStrictEqual(readSaid(`a${close}b`), { text: 'ab', said: [] });
    assert.deepStrictEqual(readSaid(`${open}ab`), { text: 'ab', said: [] });
    assert.deepStrictEqual(readSaid(`${open}${close}`), { text: '', said: [] });
    assert.deepStrictEqual(readSaid(`﷐ab${close}`), { text: 'ab', said: [] });
    // (No script's text shows them, and no explanation breaks on them.)
    const src = `echo '${open}x${close}'`;
    assert.ok(!/[﷐﷑]/.test(allTokens(new Analyzer('en').explainLine(createUnbashParser().parse(src), 0, 'bash').items).map((t) => t.explanation).join()));
  });

  it('looks through the ids at the end of a text', () => {
    assert.strictEqual(insideLastBracket('a (b)', ')', '; c'), 'a (b; c)');
    assert.strictEqual(insideLastBracket(tokenSaid('en', 'option-name-filter-hint'), ')', '; c')?.endsWith('; c)﷑'), true);
    assert.strictEqual(insideLastBracket('a', ')', '; c'), undefined);
  });

  it('says the same ids in both languages, and leaves no id in an explanation, over the corpus', () => {
    const parser = createUnbashParser();
    const { files, snippets } = corpus();
    const opts = { reading: true, sentence: true, argv: true };
    const ids = (ex: { items: Token[] }): string[] => allTokens(ex.items).map((t) => (t.texts ?? []).join());
    const differ: string[] = [];
    const left: string[] = [];
    for (const input of [...files, ...snippets]) {
      const tree = parser.parse(input.text);
      const shell = detectShell(input.text, input.name.startsWith('snippet') ? '' : input.name);
      const en = new Analyzer('en');
      const ja = new Analyzer('ja');
      for (let line = 0; line < input.text.split('\n').length; line++) {
        const [a, b] = [en, ja].map((x) => x.explainLine(tree, line, shell, opts));
        if (ids(a).join('\n') !== ids(b).join('\n')) differ.push(`${input.name}:${line + 1}`);
        if (/[﷐﷑]/.test(JSON.stringify([a, b]))) left.push(`${input.name}:${line + 1}`);
      }
    }
    assert.deepStrictEqual(differ, []);
    assert.deepStrictEqual(left, []);
  });

  it('takes a text\'s ids away with the text, in a host', () => {
    const lines = '@test "x" {\n  true\n}\n# bats file_tags=a\n';
    const parser = createUnbashParser();
    const said = (kind: FileKind, name: string, text: string, lang: 'en' | 'ja') => {
      const doc = openDocument(text, kind, (t) => parser.parse(t));
      const analyzer = new Analyzer(lang);
      return doc.lines.flatMap((_, i) => allTokens(explainDocumentLine(analyzer, doc, i, lang, shellsOf(doc.lines, name, undefined), {}).items));
    };
    for (const lang of ['en', 'ja'] as const) {
      const bats = said('bats', 'a.bats', lines, lang);
      const def = bats.find((t) => t.kind === 'function')!;
      assert.ok(def.explanation.includes('bats'), def.explanation);
      assert.strictEqual(def.texts, undefined);
      assert.strictEqual(def.children[0].texts, undefined);
      assert.strictEqual(bats.find((t) => t.kind === 'comment')!.texts, undefined);
      // (A placeholder of make is the host's syntax, no text of bash's.)
      const make = said('makefile', 'Makefile', 'all:\n\techo $(CC)\n', lang).find((t) => t.label === '$(CC)')!;
      assert.strictEqual(make.texts, undefined);
    }
    const t = tokenWith(tokenSaid('en', 'terraform-option-before-subcommand'));
    markSaid([t]);
    assert.ok(t.texts && t.marks);
    sayInstead(t, 'other');
    assert.deepStrictEqual([t.explanation, t.texts, t.marks], ['other', undefined, undefined]);
  });

  it('keeps a warning\'s mark when the echo of the label goes', () => {
    const t = tokenWith(`\`-x\`: ${'x'.repeat(3)}`);
    t.marks = [{ id: 'terraform-option-before-subcommand', level: 'warning', text: t.explanation }, { id: 'splice-refused', level: 'warning', text: 'xxx' }];
    dropLabelEcho(t);
    assert.strictEqual(t.explanation, 'xxx');
    assert.deepStrictEqual(t.marks.map((m) => m.text), ['xxx', 'xxx']);
    assert.strictEqual(markedText({ explanation: t.explanation, marks: [t.marks[0]] }), `${LEVELS.warning.mark} xxx`);
    // (No warning, nothing to move.)
    const plain = tokenWith('`-x`: y');
    dropLabelEcho(plain);
    assert.deepStrictEqual([plain.explanation, plain.marks], ['y', undefined]);
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
