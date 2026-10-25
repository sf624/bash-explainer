// The values of expansions in Meaning (docs/design/expansion-values.md): what the model gives (`expansionValue`;
// bash itself checks it in test/value-probes.test.ts and test/values.test.ts), the texts (`valueSaid`), and where the
// outputs show them: the token, the panel's data, the hover, Markdown and the Language Server's hover.
import * as assert from 'assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { Analyzer } from '../src/analyzer';
import type { LineExplanation, Token } from '../src/analyzer-types';
import { explainDocumentLine, ShellDocument } from '../src/document';
import { openDocument } from '../src/document-setup';
import type { Shell } from '../src/dialect';
import { valueSaid, type ValueSaid } from '../src/messages';
import { shellState } from '../src/semantics/state';
import { expansionValue } from '../src/semantics/values';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { descendants } from '../src/syntax/tree';
import { partAt } from '../src/ui/hoverParts';
import { partHover, plainPartHover, valueHtml, wholeLine } from '../src/ui/hoverView';
import { toPlainMarkdown } from '../src/ui/render';
import { probeSkipReason, probeWords } from './support/probe';

const parser = createUnbashParser();

/** The value of the `nth` expansion whose text is `text` in `src`. */
function valueOf(src: string, text: string, nth = 0, shell?: Shell) {
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
    assert.strictEqual(valueOf('x=1; echo "$x"', '$x', 0, 'zsh'), undefined);
    assert.strictEqual(valueOf('x=1; echo "$x"', '$x', 0, 'ksh'), undefined);
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
    assert.deepStrictEqual(valueOf('a=1; a=2 echo >f$a', '$a'), { text: '1', glob: false, joined: true });
    // Code that never runs.
    assert.strictEqual(valueOf('x=1; if false; then echo "$x"; fi', '$x'), undefined);
  });

  it('gives none where bash fails on a substring, and the cuts bash makes elsewhere', () => {
    // "substring expression < 0": the end falls before the offset (probes/values.json has them all).
    for (const e of ['${x:2:-5}', '${x:6:-1}', '${x: -3:-4}', '${x:0:-7}']) assert.strictEqual(valueOf(`x=abcdef; echo "${e}"`, e), undefined, e);
    const cut = (e: string) => valueOf(`x=abcdef; echo "${e}"`, e)?.text;
    assert.deepStrictEqual(['${x:2:-4}', '${x: -10:2}', '${x:7}', '${x:7:-1}', '${x:1:}', '${x::2}', '${x: -2:-1}'].map(cut), ['', '', '', '', '', 'ab', 'e']);
    // `${x:}` is a bad substitution; an offset that is not a constant is not followed.
    assert.strictEqual(cut('${x:}'), undefined);
    assert.strictEqual(valueOf('x=abcdef; n=2; echo "${x:n}"', '${x:n}'), undefined);
  });

  it('gives none for text other than ASCII, which bash reads by the locale, beyond copying a value', () => {
    // `${#e}` is 1 in a UTF-8 locale and 2 in C; `${a^^}` is `É` or `é`; a pattern, a replacement or an IFS of such text.
    for (const [src, e] of [['e=é; echo "${#e}"', '${#e}'], ['e=é; echo "${e:1}"', '${e:1}'], ['a=é; echo "${a^^}"', '${a^^}'], ['e=éa; echo "${e#?}"', '${e#?}'],
      ['x=abc; echo "${x/b/é}"', '${x/b/é}'], ['x=abc; p=é; echo "${x%$p}"', '${x%$p}'], ['IFS=é; x=abc; echo $x', '$x'], ['u=; echo ${u:-$\'\\u00e9\'}', "${u:-$'\\u00e9'}"]])
      assert.strictEqual(valueOf(src, e), undefined, src);
    // `$'\u00e9'` is `é` in a UTF-8 locale, `\u00E9` in C.
    assert.strictEqual(valueOf("x=$'\\u00e9'; echo \"$x\"", '$x'), undefined);
    // The value as it is: the same bytes in every locale, also split with an ASCII IFS.
    assert.deepStrictEqual(valueOf('a=é; echo "$a"', '$a'), { text: 'é', glob: false });
    assert.deepStrictEqual(valueOf("a='é ü'; echo ${a}", '${a}'), { text: 'é ü', words: ['é', 'ü'], glob: false });
    assert.deepStrictEqual(valueOf('IFS=é; a=x; echo "$a"', '$a'), { text: 'x', glob: false });
  });

  it('says only the value of a part of a word with other parts: its fields join the text around it', () => {
    assert.deepStrictEqual(valueOf("x='a b'; echo $x/c", '$x'), { text: 'a b', glob: false, joined: true });
    assert.deepStrictEqual(valueOf('e=; echo a$e', '$e'), { text: '', glob: false, joined: true });
    assert.deepStrictEqual(valueOf("p='*'; echo $p.txt", '$p'), { text: '*', glob: true, joined: true });
    // A quoted part is not split: nothing joins.
    assert.deepStrictEqual(valueOf("a='x y'; b=1; echo \"$a\"$b", '$a'), { text: 'x y', glob: false });
    assert.deepStrictEqual(valueOf("a='x y'; b=1; echo \"$a\"$b", '$b'), { text: '1', glob: false, joined: true });
    assert.deepStrictEqual(valueOf("a='x y'; echo \"$a\"", '$a'), { text: 'x y', glob: false });
  });
});

// (dash and bash --posix are run on these in test/fixtures/probes/values.json, the rows with a `shell`.)
describe('the value of an expansion in sh and dash (src/semantics/shvalues.ts)', () => {
  const both = (src: string, text: string): ReturnType<typeof valueOf>[] => [valueOf(src, text, 0, 'sh'), valueOf(src, text, 0, 'dash')];
  const none = (src: string, text: string): void => assert.deepStrictEqual(both(src, text), [undefined, undefined], src);

  it('gives the POSIX forms as bash does', () => {
    for (const v of both('msg="a  b"; echo $msg', '$msg')) assert.deepStrictEqual(v, { text: 'a  b', words: ['a', 'b'], glob: false });
    assert.deepStrictEqual(both('x=report.tar.gz; echo "${x%.*}" "${x}" "${#x}"', '${x%.*}').map((v) => v?.text), ['report.tar', 'report.tar']);
    assert.deepStrictEqual(both('x=; echo "${x:-d}"', '${x:-d}').map((v) => v?.text), ['d', 'd']);
    assert.strictEqual(valueOf('x=abc; echo "${x}"', '${x}', 0, 'dash')?.text, 'abc');
    assert.strictEqual(valueOf('x=abc; echo "${#x}"', '${#x}', 0, 'dash')?.text, '3');
    assert.strictEqual(valueOf('x=a; y=$x; echo "${y#[[:alpha:]]}"', '${y#[[:alpha:]]}', 0, 'sh')?.text, '');
    // A feature dash lacks that changes no variable (`echo -n`); `export -p`; `local` in a function.
    assert.strictEqual(valueOf('echo -n a; export -p; x=1; echo "$x"', '$x', 0, 'dash')?.text, '1');
    assert.strictEqual(valueOf('f() { local x=1; echo "$x"; }; f', '$x', 0, 'sh')?.text, '1');
    assert.strictEqual(valueOf("x=; echo \"${x:-'a b'}\"", "${x:-'a b'}", 0, 'sh')?.text, "'a b'");
    // An empty pattern; `command` before a word that is not a declaration.
    assert.strictEqual(valueOf('x=a; echo "${x#}"', '${x#}', 0, 'dash')?.text, 'a');
    assert.strictEqual(valueOf('x=a; command echo "$x"', '$x', 0, 'dash')?.text, 'a');
  });

  it('gives none for the forms dash lacks, or a script that uses something dash reads otherwise', () => {
    // Not POSIX (dash: "Bad substitution"); `${x:=w}` assigns; `${#x:-a}` is no form.
    none('x=abc; echo "${x~~}"', '${x~~}');
    none('x=abc; echo "${x:=d}"', '${x:=d}');
    none('x=abc; echo "${#x:-a}"', '${#x:-a}');
    none('x=abc; echo "${!x}"', '${!x}');
    // Anywhere in the script: a feature of bash, `$"…"`, `$[…]`, `**` and bases in arithmetic.
    none('x=1; [[ -n $x ]]; echo "$x"', '$x');
    none('x=1; y=$"a"; echo "$x"', '$x');
    none('x=1; echo $[1+2] "$x"', '$x');
    none('x=1; echo $((2**3)) "$x"', '$x');
    none('x=1; echo $((16#f)) "$x"', '$x');
    // Declarations dash reads otherwise; `return` and `local` outside a function.
    none('x=1; f() { local -r y=1; }; echo "$x"', '$x');
    none('x=1; export -n y; echo "$x"', '$x');
    none('x=1; f() { z=1 local y; }; echo "$x"', '$x');
    none('x=1; \\export y=$x; echo "$x"', '$x');
    none('x=1; command export y=$x; echo "$x"', '$x');
    none('x=1; builtin readonly y; echo "$x"', '$x');
    none('x=1; return; echo "$x"', '$x');
    none('x=1; local y; echo "$x"', '$x');
    // In a string the script runs, when the script has one of those (and not when it has none).
    for (const [src, text] of [['x=1; [[ a ]]; eval \'echo "$x"\'', undefined], ['x=1; eval \'echo "$x"\'', '1']]) {
      const tree = parser.parse(src!);
      const model = shellState(tree, 'dash');
      const ev = descendants(tree.root, ['command']).find((c) => c.text.startsWith('eval'))!;
      const script = model.script([ev.namedChildren[1]], model.env(ev));
      assert.ok(!('why' in script));
      const part = descendants(script.tree.root, ['simple_expansion'])[0];
      assert.strictEqual(expansionValue(part, script.model)?.text, text, src);
    }
  });

  it('gives none where dash gives another value', () => {
    // Brackets: `[^a]`, a `[` in brackets but a class.
    none('x=abc; echo "${x#[^a]}"', '${x#[^a]}');
    none('x=abc; echo "${x#*[[.b.]]}"', '${x#*[[.b.]]}');
    // Bytes: a value, a pattern or an IFS that is not ASCII.
    none('x=é; echo "${#x}"', '${#x}');
    none('x=aé; y=$x; echo "${y%?}"', '${y%?}');
    none('x=ab; echo "${x%é}"', '${x%é}');
    none('IFS=é; x=a; echo $x', '$x');
    // A `}` in single quotes in the word, in double quotes.
    none("x=; echo \"${x:-'}'}\"", "${x:-'}'}");
    // A value the model does not know (`x` set from the environment) is none anyway.
    none('echo "${x#a}"', '${x#a}');
    none('read x; echo "${x#a}"', '${x#a}');
  });

  it('says "the shell" where the value line says who matches a pattern', () => {
    const tree = parser.parse("p='*.txt'\nls $p");
    for (const [shell, who] of [['dash', 'the shell'], ['sh', 'the shell'], ['bash', 'bash'], [undefined, 'bash']] as const) {
      const valued = (ts: Token[]): Token[] => ts.flatMap((t) => [...(t.value ? [t] : []), ...valued(t.children)]);
      const [t] = valued(new Analyzer('en').explainLine(tree, 1, shell).items);
      assert.match(t.value!.said.tail!, new RegExp(`: ${who} matches it against file names`), String(shell));
    }
  });
});

describe('what the outputs say of a value (valueSaid)', () => {
  it('says the value, and the words of a split one', () => {
    assert.deepStrictEqual(valueSaid('en', { text: 'hello', words: ['hello'], glob: false }), { lead: 'Value here, from the script:', value: 'hello', valueEnds: [0, 0], text: 'Value here, from the script: `hello`' });
    assert.strictEqual(valueSaid('en', { text: 'a b', words: ['a', 'b'], glob: false }).text, 'Value here, from the script: `a b`; unquoted, it is split into 2 words: `a` `b`');
    assert.strictEqual(valueSaid('ja', { text: 'a b', words: ['a', 'b'], glob: false }).text, 'スクリプトから分かるここでの値: `a b`。クォートしていないので単語分割され、2 語になる: `a` `b`');
    assert.strictEqual(valueSaid('en', { text: ' c ', words: ['c'], glob: false }).text, 'Value here, from the script: `␣c␣`; unquoted, it is split into 1 word: `c` (`␣` is a space at an end)');
  });

  it('says an empty value, and one that gives no word', () => {
    assert.deepStrictEqual(valueSaid('en', { text: '', glob: false }), { lead: 'Value here, from the script:', empty: 'an empty string', text: 'Value here, from the script: an empty string' });
    assert.strictEqual(valueSaid('ja', { text: '', words: [], glob: false }).text, 'スクリプトから分かるここでの値: 空文字列。クォートしていないので単語分割され、単語は残らない');
    assert.strictEqual(valueSaid('en', { text: '   ', words: [], glob: false }).text, 'Value here, from the script: `␣␣␣`; unquoted, it is split and gives no word (`␣` is a space at an end)');
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

  it('says of a part of a word with other parts only its value, and that its wildcards make a pattern of the word', () => {
    assert.strictEqual(valueSaid('en', { text: 'a b', glob: false, joined: true }).text, 'Value here, from the script: `a b`');
    assert.strictEqual(valueSaid('en', { text: '', glob: false, joined: true }).text, 'Value here, from the script: an empty string');
    assert.strictEqual(valueSaid('en', { text: '*', glob: true, joined: true }).tail,
      '. Unquoted, the word its wildcards end up in, with the text around it, is a pattern: bash matches it against file names when the line runs (not done here)');
    assert.strictEqual(valueSaid('ja', { text: '*', glob: true, joined: true }).tail,
      '。クォートしていないので、ワイルドカードを含む単語が前後の文字列とつながったままパターンとして働き、実行するときにファイル名と照合される（ここでは照合しない）');
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

  it('shows values in the web page\'s sample (test/fixtures/sample.sh): the model is not blind there', () => {
    const src = fs.readFileSync(path.join(__dirname, 'fixtures', 'sample.sh'), 'utf8');
    const tree = parser.parse(src);
    const state = shellState(tree, 'bash');
    assert.strictEqual(state.blind, undefined);
    const shown = descendants(tree.root, ['simple_expansion', 'expansion']).filter((e) => expansionValue(e, state)).map((e) => `${e.startPosition.row + 1}: ${e.text}`);
    assert.ok(shown.includes('15: ${file%.*}') && shown.includes('16: ${#file}') && shown.length >= 5, shown.join('\n'));
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

/** The `<code>` elements of the hover's HTML, their text (a drawn mark of a space is the mark `␣` again). */
const htmlCodes = (html: string): string[] =>
  [...html.matchAll(/<code>(.*?)<\/code>/g)].map((m) => m[1].replace(/<span style="[^"]*" title="[^"]*">&nbsp;<\/span>/g, '\u2423').replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));

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

  it('shows a space at either end as ␣, and an inner space as it is', () => {
    assert.strictEqual(same(' a ').value, '␣a␣');
    assert.strictEqual(same('  a').value, '␣␣a');
    assert.strictEqual(same('a  ').value, 'a␣␣');
    assert.strictEqual(same(' ').value, '␣');
    assert.strictEqual(same('     ').value, '␣␣␣␣␣');
    assert.strictEqual(same('a  b').value, 'a  b');
    assert.strictEqual(same(' a  b ').value, '␣a  b␣');
    assert.strictEqual(same(' ` ').value, '␣`␣');
    // A word of a split value with a space at its end (IFS=:).
    assert.deepStrictEqual(same('a :b', ['a ', 'b']).split!.words, ['a␣', 'b']);
    // The note says what the mark is, in both languages, and only when there is one.
    assert.strictEqual(valueSaid('en', { text: ' a', glob: false }).tail, ' (`␣` is a space at an end)');
    assert.strictEqual(valueSaid('ja', { text: ' a', glob: false }).tail, '（`␣` は端の空白）');
    assert.strictEqual(valueSaid('en', { text: 'a b', glob: false }).tail, undefined);
  });

  it('tells where the marks are, for the outputs that draw them, and how the mark is called', () => {
    const ends = (text: string, words?: string[]) => valueSaid('en', { text, ...(words ? { words } : {}), glob: false });
    assert.deepStrictEqual(ends(' a ').valueEnds, [1, 1]);
    assert.deepStrictEqual(ends('  a').valueEnds, [2, 0]);
    assert.deepStrictEqual(ends('a  ').valueEnds, [0, 2]);
    assert.deepStrictEqual(ends(' a  b ').valueEnds, [1, 1]);
    assert.deepStrictEqual(ends('     ').valueEnds, [0, 5]);
    assert.deepStrictEqual(ends('a b').valueEnds, [0, 0]);
    // A cut value has no mark at its end; a long run of spaces is cut inside the run.
    assert.deepStrictEqual(ends(` ${'x'.repeat(78)} yyy`).valueEnds, [1, 0]);
    assert.deepStrictEqual(ends(' '.repeat(100)).valueEnds, [79, 0]);
    // A literal `␣` in a value is not a mark (it has no end to draw, and no note).
    assert.deepStrictEqual(ends('a\u2423b').valueEnds, [0, 0]);
    assert.strictEqual(ends('a\u2423b').tail, undefined);
    assert.strictEqual(ends('a\u2423b').spaceLabel, undefined);
    assert.deepStrictEqual(ends(' p q ', ['p', 'q']).split!.wordEnds, [[0, 0], [0, 0]]);
    assert.deepStrictEqual(ends('a :b', ['a ', 'b']).split!.wordEnds, [[0, 1], [0, 0]]);
    assert.deepStrictEqual(ends('a::b', ['a', '', 'b']).split!.wordEnds, [[0, 0], [0, 0], [0, 0]]);
    assert.deepStrictEqual(ends('', []).split!.wordEnds, []);
    assert.strictEqual(ends(' a').spaceLabel, 'space');
    assert.strictEqual(valueSaid('ja', { text: ' a', glob: false }).spaceLabel, '空白');
    assert.strictEqual(ends('a :b', ['a ', 'b']).spaceLabel, 'space');
    assert.strictEqual(ends('a b').spaceLabel, undefined);
  });

  it('draws the mark in the hover as a real space on a faint background, named by its tooltip, and never as a glyph that fonts lack', () => {
    const mark = '<span style="background-color:var(--vscode-badge-background);border-radius:2px;" title="space">&nbsp;</span>';
    const html = valueHtml(valueSaid('en', { text: ' p q ', words: ['p', 'q'], glob: false }));
    assert.ok(html.includes(`<code>${mark}p&nbsp;q${mark}</code>`), html);
    // The note names it the same way.
    assert.ok(html.endsWith(` (<code>${mark}</code> is a space at an end)`), html);
    assert.ok(valueHtml(valueSaid('ja', { text: ' a', glob: false })).includes('title="空白"'));
    assert.ok(!/[\u2420\u2423]/.test(html), html);
    // A run of spaces: one mark each.
    assert.ok(valueHtml(valueSaid('en', { text: '   ', glob: false })).includes(`<code>${mark.repeat(3)}</code>`));
  });

  it('shows an empty word of a split value as ∅', () => {
    const said = same('a::b', ['a', '', 'b']);
    assert.deepStrictEqual(said.split!.words, ['a', '∅', 'b']);
    assert.strictEqual(said.tail, ' (`∅` is an empty word)');
    assert.strictEqual(valueSaid('ja', { text: 'a::b', words: ['a', '', 'b'], glob: false }).tail, '（`∅` は空の単語）');
    assert.strictEqual(valueSaid('en', { text: ' a::b', words: ['a', '', 'b'], glob: false }).tail, ' (`␣` is a space at an end, `∅` is an empty word)');
  });

  it('is the same through the analyzer, in the hover, Markdown and the Language Server hover', () => {
    const cases: [string, string][] = [
      ["msg='a`b'; echo \"$msg\"", 'a`b'],
      ["msg='``'; echo \"$msg\"", '``'],
      ["msg='`'; echo \"$msg\"", '`'],
      ["msg='`a`'; echo \"$msg\"", '`a`'],
      ["msg=' a '; echo \"$msg\"", '␣a␣'],
      ["msg=' '; echo \"$msg\"", '␣'],
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
    assert.strictEqual(valueSaid('en', { text: ` ${'x'.repeat(78)} yyy`, glob: false }).value, `␣${'x'.repeat(78)}…`);
    assert.strictEqual(valueSaid('en', { text: `${'x'.repeat(78)} yyy`, glob: false }).value, `${'x'.repeat(78)} …`);
    assert.strictEqual(valueSaid('en', { text: ' '.repeat(100), glob: false }).value, `${'␣'.repeat(79)}…`);
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
    // (The character itself in the script: `$'\u202e'` gives it only in a UTF-8 locale, and so has no value.)
    const doc = openDocument("msg='a\u202eb'; echo \"$msg\"", 'shell', (t) => parser.parse(t));
    const ex = explainDocumentLine(new Analyzer('en'), doc, 0, 'en', {}, {});
    assert.match(toPlainMarkdown(ex, doc.lines[0], 'a.sh:1'), /Value here, from the script: `a<U\+202E>b`/);
  });
});

// A part of a word with other parts (`$x/c`): the value line says its value, and a glob note, but not its words. Each
// case runs in bash (the probes' bash, test/support/probe.ts): with an empty IFS and `set -f`, the word is one field,
// the parts' values side by side, which must be the model's values with the text between them; where the line says
// the word is a pattern, `shopt -s nullglob` and `set -f` give other fields.
(probeSkipReason ? describe.skip : describe)(`an expansion bash may leave unexpanded, against bash${probeSkipReason ? ` (${probeSkipReason})` : ''}`, () => {
  // The right side of `&&` or `||` in `[[ ]]`, and a pattern of `case` after the first: bash expands them only when
  // what comes before does not decide. `$(echo R >&2)` in their place shows whether bash got there.
  const cases: [string, string, boolean][] = [
    ['x=a; y=b; [[ $x = a || $y = b ]]', '[[ $x = a || $(echo R >&2) = b ]]', false],
    ['x=a; y=b; [[ ( $x = b ) && ( $y = b ) ]]', '[[ ( $x = b ) && ( $(echo R >&2) = b ) ]]', false],
    ['x=a; y=b; case $x in a) ;; $y) ;; esac', 'case $x in a) ;; $(echo R >&2)) ;; esac', false],
    ['x=a; y=b; case $x in a|$y) ;; esac', 'case $x in a|$(echo R >&2)) ;; esac', false],
  ];
  for (const [src, probe, runs] of cases) {
    it(`${src}: no value for $y (bash ${runs ? 'expands' : 'skips'} it there)`, () => {
      const r = spawnSync(process.env.BASH_EXPLAINER_BASH || 'bash', ['--norc', '--noprofile', '-c', `x=a; ${probe}`], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' } });
      assert.strictEqual(r.stderr.includes('R'), runs);
      assert.strictEqual(valueOf(src, '$y'), undefined);
      assert.ok(valueOf(src, '$x'));
    });
  }
  it('gives the value where nothing comes before: the first pattern, the left side', () => {
    assert.deepStrictEqual(valueOf('x=a; y=b; case $x in $y|a) ;; esac', '$y'), { text: 'b', glob: false });
    assert.deepStrictEqual(valueOf('x=a; y=b; [[ $y = b || $x = a ]]', '$y'), { text: 'b', glob: false });
  });
});

(probeSkipReason ? describe.skip : describe)(`the value of a part of a word with other parts, against bash${probeSkipReason ? ` (${probeSkipReason})` : ''}`, () => {
  const cases: [string, string][] = [
    ["x='a b'", '$x/c'], ['e=', 'a$e'], ['e=', '${e}y'], ["x='a b'", '$x$x'], ["a='x y'; b='1 2'", '"$a"$b'], ["a='x y'; b='1 2'", '$a"$b"'],
    ["s='  '", 'a${s}b'], ['x=report.tar.gz', '${x%.*}.bak'], ['x=abcdef', 'x${x:1:2}${x: -1}'], ["IFS=:; x='a:b'", '$x:c'], ['e=', '$e$e'],
    ["p='*'", '$p.txt'], ["p='* x'", '$p.txt'], ["p='a.t?'", 'sub/../$p*'], ["p='[a'", '${p}]'], ["p='*'", '"$p"$p'],
  ];
  for (const [script, word] of cases) {
    it(`${script}; echo ${word}`, async () => {
      const src = `${script}; __probe a ${word}`;
      const tree = parser.parse(src);
      const state = shellState(tree, 'bash');
      const parts = descendants(tree.root, ['simple_expansion', 'expansion']);
      const values = parts.map((p) => expansionValue(p, state));
      assert.ok(values.every((v) => v), `every part has a value: ${JSON.stringify(values)}`);
      // The text between the parts (no quotes but `"` in these words), with each part's value in its place.
      let whole = '';
      let at = src.indexOf(word);
      parts.forEach((p, i) => {
        whole += src.slice(at, p.startIndex).replace(/"/g, '') + values[i]!.text;
        at = p.endIndex;
      });
      whole += src.slice(at).replace(/"/g, '');
      const run = async (before: string) => (await probeWords(`${script}; ${before}@PROBE:a@ ${word}`)).fields.a;
      const one = await run('IFS=; set -f; ');
      assert.deepStrictEqual(one, [whole === '' && !word.includes('"') ? [] : [whole]]);
      parts.forEach((p, i) => {
        const v = values[i]!;
        const quoted = p.parent!.type === 'string';
        // An unquoted part says no words of its own.
        assert.deepStrictEqual([v.joined, v.words], quoted ? [undefined, undefined] : [true, undefined], p.text);
      });
      if (values.some((v) => v!.glob)) assert.notDeepStrictEqual(await run('shopt -s nullglob; '), await run('set -f; '));
    });
  }
});
