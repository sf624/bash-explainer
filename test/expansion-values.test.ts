// The values of expansions in Meaning (docs/design/expansion-values.md): what the model gives (`expansionValue`;
// bash itself checks it in test/value-probes.test.ts and test/values.test.ts), the texts (`valueSaid`), and where the
// outputs show them: the token, the panel's data, the hover, Markdown and the Language Server's hover.
import * as assert from 'assert';
import { Analyzer } from '../src/analyzer';
import type { LineExplanation, Token } from '../src/analyzer-types';
import { explainDocumentLine, ShellDocument } from '../src/document';
import { openDocument } from '../src/document-setup';
import { valueSaid, type ValueSaid } from '../src/messages';
import { shellState } from '../src/semantics/state';
import { expansionValue } from '../src/semantics/values';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { descendants } from '../src/syntax/tree';
import { partAt } from '../src/ui/hoverParts';
import { partHover, plainPartHover, valueHtml, wholeLine } from '../src/ui/hoverView';
import { toPlainMarkdown } from '../src/ui/render';

const parser = createUnbashParser();

/** The value of the `nth` expansion whose text is `text` in `src`. */
function valueOf(src: string, text: string, nth = 0, shell?: 'sh') {
  const tree = parser.parse(src);
  const n = descendants(tree.root, ['simple_expansion', 'expansion']).filter((e) => e.text === text)[nth];
  assert.ok(n, `${text} in ${src}`);
  return expansionValue(n, shellState(tree, shell));
}

describe('the value of an expansion where it runs (expansionValue)', () => {
  it('gives the text, and the words splitting makes of an unquoted one', () => {
    assert.deepStrictEqual(valueOf('msg="hello world"; echo "$msg"', '$msg'), { text: 'hello world', glob: false });
    assert.deepStrictEqual(valueOf('msg="hello world"; echo $msg', '$msg'), { text: 'hello world', words: ['hello', 'world'], glob: false });
    assert.deepStrictEqual(valueOf('x=report.tar.gz; echo "${x%.*}"', '${x%.*}'), { text: 'report.tar', glob: false });
    // An assignment does not split.
    assert.deepStrictEqual(valueOf('a="x y"; b=$a', '$a'), { text: 'x y', glob: false });
  });

  it('says that a value with a glob character is a pattern where it is globbed, also with an empty IFS', () => {
    assert.deepStrictEqual(valueOf("p='*.txt'; ls $p", '$p'), { text: '*.txt', words: ['*.txt'], glob: true });
    assert.deepStrictEqual(valueOf("IFS=; p='*.txt'; ls $p", '$p'), { text: '*.txt', glob: true });
    assert.deepStrictEqual(valueOf("p='*.txt'; ls \"$p\"", '$p'), { text: '*.txt', glob: false });
    assert.deepStrictEqual(valueOf("set -f; p='*.txt'; ls $p", '$p'), { text: '*.txt', words: ['*.txt'], glob: false });
  });

  it('gives none where it is not sure', () => {
    // Not an expansion of a parameter; a shell other than bash; nothing trusted.
    const tree = parser.parse('echo $(date)');
    assert.strictEqual(expansionValue(descendants(tree.root, ['command_substitution'])[0], shellState(tree)), undefined);
    assert.strictEqual(valueOf('x=1; echo "$x"', '$x', 0, 'sh'), undefined);
    assert.strictEqual(valueOf('x=1; . ./lib; echo "$x"', '$x'), undefined);
    // An expansion inside the word of another one: bash expands it only when the outer one needs it.
    assert.strictEqual(valueOf('y=1; x=2; echo "${x:-$y}"', '$y'), undefined);
    assert.deepStrictEqual(valueOf('y=1; x=2; echo "${x:-$y}"', '${x:-$y}'), { text: '2', glob: false });
    // An IFS not known, a `set -f` on some paths, `$_`, a HOME the script reads in, bash's error.
    assert.strictEqual(valueOf('IFS=$(cmd); x=1; echo $x', '$x'), undefined);
    assert.strictEqual(valueOf("[ -f a ] && set -f; p='*'; echo $p", '$p'), undefined);
    assert.deepStrictEqual(valueOf("[ -f a ] && set -f; p='a b'; echo $p", '$p'), { text: 'a b', words: ['a', 'b'], glob: false });
    assert.strictEqual(valueOf('x=1; echo "$_"', '$_'), undefined);
    assert.strictEqual(valueOf('read HOME; x=; echo ${x:-~}', '${x:-~}'), undefined);
    assert.strictEqual(valueOf('x=; echo "${x:?empty}"', '${x:?empty}'), undefined);
    // A redirection of a command with no name: bash assigns first (`f2`); the model's state is the one before.
    assert.strictEqual(valueOf('a=1; a=2 >f$a', '$a'), undefined);
    assert.deepStrictEqual(valueOf('a=1; a=2 echo >f$a', '$a'), { text: '1', words: ['1'], glob: false });
    // Code that never runs.
    assert.strictEqual(valueOf('x=1; if false; then echo "$x"; fi', '$x'), undefined);
  });
});

describe('what the outputs say of a value (valueSaid)', () => {
  it('says the value, and the words of a split one', () => {
    assert.deepStrictEqual(valueSaid('en', { text: 'hello', words: ['hello'], glob: false }), { lead: 'Value here, from the script:', value: 'hello', text: 'Value here, from the script: `hello`' });
    assert.strictEqual(valueSaid('en', { text: 'a b', words: ['a', 'b'], glob: false }).text, 'Value here, from the script: `a b`; unquoted, it is split into 2 words: `a` `b`');
    assert.strictEqual(valueSaid('ja', { text: 'a b', words: ['a', 'b'], glob: false }).text, 'スクリプトから分かるここでの値: `a b`。クォートしていないので単語分割され、2 語になる: `a` `b`');
    assert.strictEqual(valueSaid('en', { text: ' c ', words: ['c'], glob: false }).text, 'Value here, from the script: `␠c␠`; unquoted, it is split into 1 word: `c` (`␠` is a space at an end)');
  });

  it('says an empty value, and one that gives no word', () => {
    assert.deepStrictEqual(valueSaid('en', { text: '', glob: false }), { lead: 'Value here, from the script:', empty: 'an empty string', text: 'Value here, from the script: an empty string' });
    assert.strictEqual(valueSaid('ja', { text: '', words: [], glob: false }).text, 'スクリプトから分かるここでの値: 空文字列。クォートしていないので単語分割され、単語は残らない');
    assert.strictEqual(valueSaid('en', { text: '   ', words: [], glob: false }).text, 'Value here, from the script: `␠␠␠`; unquoted, it is split and gives no word (`␠` is a space at an end)');
  });

  it('says a glob, control characters, and cuts long values and many words', () => {
    assert.strictEqual(valueSaid('en', { text: '*.txt', words: ['*.txt'], glob: true }).tail, '. Unquoted, it is a pattern: bash matches it against file names when the line runs (not done here)');
    assert.match(valueSaid('ja', { text: '*', glob: true }).text, /。クォートしていないのでパターンとして働き、/);
    const tab = valueSaid('en', { text: 'a\tb\nc', glob: false });
    assert.strictEqual(tab.value, 'a⇥b␊c');
    assert.match(tab.tail!, /^ \(control characters are shown as symbols: `⇥` is /);
    assert.match(valueSaid('ja', { text: 'a\tb', glob: false }).tail!, /^（制御文字は記号で表している: /);
    const long = valueSaid('en', { text: 'x'.repeat(100), glob: false }).value!;
    assert.strictEqual(long.length, 80);
    assert.ok(long.endsWith('…'));
    const many = Array.from({ length: 15 }, (_, i) => String(i));
    const said = valueSaid('en', { text: many.join(' '), words: many, glob: false });
    assert.strictEqual(said.split!.words.length, 12);
    assert.match(said.split!.said, /split into 15 words \(the first 12\):$/);
    assert.match(valueSaid('ja', { text: many.join(' '), words: many, glob: false }).split!.said, /15 語になる（最初の 12 語）:$/);
    // A backtick in a value: the code span has a longer fence.
    assert.strictEqual(valueSaid('en', { text: 'a`b', glob: false }).text, 'Value here, from the script: ``a`b``');
  });
});

describe('the value on the token and in the outputs', () => {
  const open = (src: string): ShellDocument => openDocument(src, 'shell', (t) => parser.parse(t));
  const explain = (doc: ShellDocument, line: number): LineExplanation => explainDocumentLine(new Analyzer('en'), doc, line, 'en', {}, {});
  const find = (ts: Token[], label: string): Token | undefined => {
    for (const t of ts) {
      if (t.label === label && t.value) return t;
      const c = find(t.children, label);
      if (c) return c;
    }
    return undefined;
  };
  const doc = open('msg="hello world"\necho $msg "${msg%o*}"');

  it('puts it on the token of the expansion, with its texts', () => {
    const ex = explain(doc, 1);
    const t = find(ex.items, '$msg')!;
    assert.deepStrictEqual(t.value, { text: 'hello world', words: ['hello', 'world'], glob: false, said: valueSaid('en', { text: 'hello world', words: ['hello', 'world'], glob: false }) });
    assert.strictEqual(find(ex.items, '${msg%o*}')!.value!.text, 'hello w');
    // Japanese, from the same model.
    const ja = new Analyzer('ja').explainLine(parser.parse(doc.lines.join('\n')), 1);
    assert.match(find(ja.items, '$msg')!.value!.said.text, /^スクリプトから分かるここでの値: /);
  });

  it('shows it in the hover, in Markdown and in the Language Server hover', () => {
    const ex = explain(doc, 1);
    const x = { ex, lang: 'en' as const, theme: 'dark' as const, lineText: doc.lines[1], placement: 'first' as const, panelLink: 'command:panel', lineLink: 'command:line', keys: 'Ctrl+K Ctrl+E' };
    // The part card: a paragraph of its own.
    const card = partHover(x, partAt(ex.items, { line: 1, character: 6 }));
    assert.match(card, /\nValue here, from the script: <code>hello&nbsp;world<\/code>; unquoted, it is split into 2 words: <code>hello<\/code> <code>world<\/code>\n/);
    // A row of a table (the card of the argument holds the expansion): small, under the meaning.
    const arg = partHover(x, partAt(ex.items, { line: 1, character: 13 }).slice(0, -2));
    assert.match(arg, /<br><small>Value here, from the script: <code>hello&nbsp;w<\/code><\/small>/);
    assert.match(wholeLine(x), /<br><small>Value here, from the script: /);
    const md = toPlainMarkdown(ex, doc.lines[1], 'a.sh:2');
    assert.match(md, /\\\n {6}Value here, from the script: `hello world`; unquoted, it is split into 2 words: `hello` `world`\n/);
    const plain = plainPartHover(ex, partAt(ex.items, { line: 1, character: 6 }), 'en', 'W');
    assert.match(plain, /\n\nValue here, from the script: `hello world`; unquoted/);
    const kids = plainPartHover(ex, partAt(ex.items, { line: 1, character: 13 }).slice(0, -2), 'en', 'W');
    assert.match(kids, /\\\n {2}Value here, from the script: `hello w`/);
  });
});

/**
 * The code spans of a line of CommonMark (spec 6.1): a run of backticks opens a span that ends at the next run of the
 * same length; one space at each end goes when both ends are spaces and the content is not all spaces.
 */
function codeSpans(md: string): string[] {
  const out: string[] = [];
  const runs = [...md.matchAll(/`+/g)];
  for (let i = 0; i < runs.length; i++) {
    const close = runs.findIndex((r, j) => j > i && r[0].length === runs[i][0].length);
    if (close < 0) continue;
    let c = md.slice(runs[i].index! + runs[i][0].length, runs[close].index!).replace(/\n/g, ' ');
    if (c.startsWith(' ') && c.endsWith(' ') && c.trim() !== '') c = c.slice(1, -1);
    out.push(c);
    i = close;
  }
  return out;
}

/** The `<code>` elements of the hover's HTML, their text. */
const htmlCodes = (html: string): string[] =>
  [...html.matchAll(/<code>(.*?)<\/code>/g)].map((m) => m[1].replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));

/** The value and the words as the line says them. */
const shownOf = (said: ValueSaid): string[] => [...(said.value !== undefined ? [said.value] : []), ...(said.split?.words ?? [])];

/** The value and the words read back from the Markdown text and from the hover's HTML. */
function readBack(said: ValueSaid): { md: string[]; html: string[] } {
  const n = shownOf(said).length;
  // (The tail's own code spans, the pictures, come after the value and the words.)
  return { md: codeSpans(said.text).slice(0, n), html: htmlCodes(valueHtml(said)).slice(0, n) };
}

describe('a value that holds a backtick, or a space at an end, reads back the same on every surface', () => {
  const same = (text: string, words?: string[]) => {
    const said = valueSaid('en', { text, ...(words ? { words } : {}), glob: false });
    const back = readBack(said);
    assert.deepStrictEqual(back.md, shownOf(said), `Markdown of ${JSON.stringify(text)}: ${said.text}`);
    assert.deepStrictEqual(back.html, shownOf(said), `HTML of ${JSON.stringify(text)}`);
    return said;
  };

  it('keeps 1, 2 and 3 backticks, inside and at the ends', () => {
    for (const v of ['a`b', 'a``b', 'a```b', '`', '``', '```', '`a', 'a`', '`a`', '``a``', '```a```', '` `', 'a ` b', '`` ` ``'])
      assert.strictEqual(same(v).value, v);
    // Words of a split value too.
    same('`a b`', ['`a', 'b`']);
    same('`` ``', ['``', '``']);
    // The Markdown text, exactly.
    assert.strictEqual(valueSaid('en', { text: '`', glob: false }).text, 'Value here, from the script: `` ` ``');
    assert.strictEqual(valueSaid('en', { text: '``', glob: false }).text, 'Value here, from the script: ``` `` ```');
  });

  it('shows a space at either end as ␠, and an inner space as it is', () => {
    assert.strictEqual(same(' a ').value, '␠a␠');
    assert.strictEqual(same('  a').value, '␠␠a');
    assert.strictEqual(same('a  ').value, 'a␠␠');
    assert.strictEqual(same(' ').value, '␠');
    assert.strictEqual(same('     ').value, '␠␠␠␠␠');
    assert.strictEqual(same('a  b').value, 'a  b');
    assert.strictEqual(same(' a  b ').value, '␠a  b␠');
    assert.strictEqual(same(' ` ').value, '␠`␠');
    // A word of a split value with a space at its end (IFS=:).
    assert.deepStrictEqual(same('a :b', ['a ', 'b']).split!.words, ['a␠', 'b']);
    // The note says what the mark is, in both languages, and only when there is one.
    assert.strictEqual(valueSaid('en', { text: ' a', glob: false }).tail, ' (`␠` is a space at an end)');
    assert.strictEqual(valueSaid('ja', { text: ' a', glob: false }).tail, '（`␠` は端の空白）');
    assert.strictEqual(valueSaid('en', { text: 'a b', glob: false }).tail, undefined);
  });

  it('shows an empty word of a split value as ∅', () => {
    const said = same('a::b', ['a', '', 'b']);
    assert.deepStrictEqual(said.split!.words, ['a', '∅', 'b']);
    assert.strictEqual(said.tail, ' (`∅` is an empty word)');
    assert.strictEqual(valueSaid('ja', { text: 'a::b', words: ['a', '', 'b'], glob: false }).tail, '（`∅` は空の単語）');
    assert.strictEqual(valueSaid('en', { text: ' a::b', words: ['a', '', 'b'], glob: false }).tail, ' (`␠` is a space at an end, `∅` is an empty word)');
  });

  it('is the same through the analyzer, in the hover, Markdown and the Language Server hover', () => {
    const cases: [string, string][] = [
      ["msg='a`b'; echo \"$msg\"", 'a`b'],
      ["msg='``'; echo \"$msg\"", '``'],
      ["msg='`'; echo \"$msg\"", '`'],
      ["msg='`a`'; echo \"$msg\"", '`a`'],
      ["msg=' a '; echo \"$msg\"", '␠a␠'],
      ["msg=' '; echo \"$msg\"", '␠'],
    ];
    for (const [src, shown] of cases) {
      const doc = openDocument(src, 'shell', (t) => parser.parse(t));
      const ex = explainDocumentLine(new Analyzer('en'), doc, 0, 'en', {}, {});
      const x = { ex, lang: 'en' as const, theme: 'dark' as const, lineText: doc.lines[0], placement: 'first' as const, panelLink: 'command:panel', lineLink: 'command:line', keys: 'Ctrl+K Ctrl+E' };
      const part = partAt(ex.items, { line: 0, character: src.indexOf('"$msg"') + 2 });
      const line = (s: string) => s.slice(s.indexOf('Value here'));
      assert.deepStrictEqual(htmlCodes(line(partHover(x, part))).slice(0, 1), [shown], src);
      assert.deepStrictEqual(htmlCodes(line(wholeLine(x))).slice(0, 1), [shown], src);
      assert.deepStrictEqual(codeSpans(line(plainPartHover(ex, part, 'en', 'W'))).slice(0, 1), [shown], src);
      assert.deepStrictEqual(codeSpans(line(toPlainMarkdown(ex, doc.lines[0], 'a.sh:1'))).slice(0, 1), [shown], src);
    }
  });
});

/** No lone surrogate: a pair was not cut in two. */
const wellFormed = (s: string): boolean => !/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(s);

describe('a long value is cut on characters, and invisible characters are shown', () => {
  it('does not split a surrogate pair', () => {
    const said = valueSaid('en', { text: '😀'.repeat(100), words: ['😀'.repeat(100)], glob: false });
    assert.strictEqual(said.value, `${'😀'.repeat(79)}…`);
    assert.ok(wellFormed(said.value!) && wellFormed(said.text));
    const odd = valueSaid('en', { text: `a${'😀'.repeat(100)}`, glob: false }).value!;
    assert.ok(wellFormed(odd));
    assert.strictEqual([...odd].length, 80);
    // The words of a split value are cut the same way.
    const words = valueSaid('en', { text: 'x', words: ['😀'.repeat(100), 'y'], glob: false });
    assert.strictEqual(words.split!.words[0], `${'😀'.repeat(79)}…`);
    // 80 characters are not cut, 81 are.
    assert.strictEqual(valueSaid('en', { text: '😀'.repeat(80), glob: false }).value, '😀'.repeat(80));
    assert.strictEqual(valueSaid('en', { text: '😀'.repeat(81), glob: false }).value, `${'😀'.repeat(79)}…`);
  });

  it('does not mark a space before the cut as one at the end', () => {
    assert.strictEqual(valueSaid('en', { text: ` ${'x'.repeat(78)} yyy`, glob: false }).value, `␠${'x'.repeat(78)}…`);
    assert.strictEqual(valueSaid('en', { text: `${'x'.repeat(78)} yyy`, glob: false }).value, `${'x'.repeat(78)} …`);
    assert.strictEqual(valueSaid('en', { text: ' '.repeat(100), glob: false }).value, `${'␠'.repeat(79)}…`);
  });

  it('shows bidi controls and zero-width characters as <U+XXXX>, and names them', () => {
    const codes = [0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x2028, 0x2029, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069, 0xfeff];
    for (const c of codes) {
      const hex = c.toString(16).toUpperCase().padStart(4, '0');
      const text = `a${String.fromCodePoint(c)}b`;
      const en = valueSaid('en', { text, glob: false });
      assert.strictEqual(en.value, `a<U+${hex}>b`);
      assert.match(en.tail!, new RegExp(`^ \\(invisible characters are shown as their code: \`<U\\+${hex}>\` is U\\+${hex} [a-z]`));
      assert.match(valueSaid('ja', { text, glob: false }).tail!, new RegExp(`^（見えない文字はコードで表している: \`<U\\+${hex}>\` は U\\+${hex} `));
    }
    const mixed = valueSaid('en', { text: 'a‮b\tc‮​', glob: false });
    assert.strictEqual(mixed.value, 'a<U+202E>b⇥c<U+202E><U+200B>');
    assert.match(mixed.tail!, /^ \(control characters are shown as symbols: `⇥` is HT \(tab\)\) \(invisible characters are shown as their code: `<U\+202E>` is U\+202E right-to-left override, `<U\+200B>` is U\+200B zero width space\)$/);
    // Words too; a text that only looks like one is left alone and not named.
    assert.deepStrictEqual(valueSaid('en', { text: 'x y', words: ['x', '⁦y'], glob: false }).split!.words, ['x', '<U+2066>y']);
    const fake = valueSaid('en', { text: '<U+0041> <U+202E>', glob: false });
    assert.strictEqual(fake.value, '<U+0041> <U+202E>');
    assert.match(fake.tail!, /`<U\+202E>` is U\+202E right-to-left override\)$/);
    assert.strictEqual(valueSaid('en', { text: '<U+0041>', glob: false }).tail, undefined);
  });

  it('keeps `<U+XXXX>` whole when a long value is cut, and reads back in the hover', () => {
    const said = valueSaid('en', { text: '‮'.repeat(100), glob: false });
    assert.match(said.value!, /^(<U\+202E>){79}…$/);
    const one = valueSaid('en', { text: 'a‮b', glob: false });
    assert.deepStrictEqual(readBack(one).html, ['a<U+202E>b']);
    assert.ok(valueHtml(one).includes('<code>a&#60;U+202E&#62;b</code>'));
    assert.deepStrictEqual(readBack(one).md, ['a<U+202E>b']);
  });

  it('says an empty value, and a value with no note, in the hover HTML', () => {
    assert.strictEqual(valueHtml(valueSaid('en', { text: '', glob: false })), 'Value here, from the script: an empty string');
    assert.strictEqual(valueHtml(valueSaid('en', { text: '', words: [], glob: false })), 'Value here, from the script: an empty string; unquoted, it is split and gives no word');
    assert.strictEqual(valueHtml(valueSaid('ja', { text: 'a b', words: ['a', 'b'], glob: false })), 'スクリプトから分かるここでの値: <code>a&nbsp;b</code>。クォートしていないので単語分割され、2 語になる: <code>a</code> <code>b</code>');
  });

  it('is the same through the analyzer', () => {
    const doc = openDocument("msg=$'a\\u202eb'; echo \"$msg\"", 'shell', (t) => parser.parse(t));
    const ex = explainDocumentLine(new Analyzer('en'), doc, 0, 'en', {}, {});
    assert.match(toPlainMarkdown(ex, doc.lines[0], 'a.sh:1'), /Value here, from the script: `a<U\+202E>b`/);
  });
});
