// The values of expansions in Meaning (docs/design/expansion-values.md): what the model gives (`expansionValue`;
// bash itself checks it in test/value-probes.test.ts and test/values.test.ts), the texts (`valueSaid`), and where the
// outputs show them: the token, the panel's data, the hover, Markdown and the Language Server's hover.
import * as assert from 'assert';
import { Analyzer } from '../src/analyzer';
import type { LineExplanation, Token } from '../src/analyzer-types';
import { explainDocumentLine, ShellDocument } from '../src/document';
import { openDocument } from '../src/document-setup';
import { valueSaid } from '../src/messages';
import { shellState } from '../src/semantics/state';
import { expansionValue } from '../src/semantics/values';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { descendants } from '../src/syntax/tree';
import { partAt } from '../src/ui/hoverParts';
import { partHover, plainPartHover, wholeLine } from '../src/ui/hoverView';
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
    assert.strictEqual(valueSaid('en', { text: ' c ', words: ['c'], glob: false }).text, 'Value here, from the script: ` c `; unquoted, it is split into 1 word: `c`');
  });

  it('says an empty value, and one that gives no word', () => {
    assert.deepStrictEqual(valueSaid('en', { text: '', glob: false }), { lead: 'Value here, from the script:', empty: 'an empty string', text: 'Value here, from the script: an empty string' });
    assert.strictEqual(valueSaid('ja', { text: '', words: [], glob: false }).text, 'スクリプトから分かるここでの値: 空文字列。クォートしていないので単語分割され、単語は残らない');
    assert.strictEqual(valueSaid('en', { text: '   ', words: [], glob: false }).text, 'Value here, from the script: `   `; unquoted, it is split and gives no word');
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
