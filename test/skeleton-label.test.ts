// A construct is labelled with its skeleton: its keywords and operators, its short parts as written, and a named
// placeholder for what is left out. The range, which highlights it, stays the whole construct.
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import type { BashParser as Parser } from '../src/syntax/tree';
import { Analyzer, Token } from '../src/analyzer';
import { main } from '../cli/main';
import { explainHostedLine, extractShell, hostKind } from '../src/hosts';
import { joinParts, LABEL_LIMIT, LabelPart, labelParts, labelText } from '../src/label';
import { codeSpan, labelMarkdown, toMarkdown, toPlainMarkdown } from '../src/ui/render';
import { createUnbashParser } from '../src/syntax/adapters/unbash';

let parser: Parser;
before(() => {
  parser = createUnbashParser();
});

const explain = (src: string, line = 0, lang: 'en' | 'ja' = 'en') => new Analyzer(lang).explainLine(parser.parse(src), line);
const first = (src: string, line = 0, lang: 'en' | 'ja' = 'en') => explain(src, line, lang).items[0];
const all = (ts: Token[]): Token[] => ts.flatMap((t) => [t, ...all(t.children)]);

/** The parts as a short string: `code` as it is, placeholders in *stars*. */
const show = (parts: readonly LabelPart[] | undefined) => joinParts(parts ?? [], (p) => (p.placeholder ? `*${p.text}*` : p.text));

const long = 'x'.repeat(LABEL_LIMIT + 5);

// [source, plain-text label, the parts]
const CASES: [string, string, string][] = [
  ['if a; then b; fi', 'if ‹condition› then ‹commands› fi', 'if *condition* then *commands* fi'],
  ['if a; then b; elif c; then d; else e; fi', 'if ‹condition› then ‹commands› elif ‹condition› then ‹commands› else ‹commands› fi', 'if *condition* then *commands* elif *condition* then *commands* else *commands* fi'],
  ['for f in a b; do :; done', 'for f in ‹words› do ‹commands› done', 'for f in *words* do *commands* done'],
  ['for f; do :; done', 'for f do ‹commands› done', 'for f do *commands* done'],
  ['for ((i=0; i<3; i++)); do :; done', 'for (( ‹init› ; ‹test› ; ‹update› )) do ‹commands› done', 'for (( *init* ; *test* ; *update* )) do *commands* done'],
  ['for ((;;)); do :; done', 'for (( ; ; )) do ‹commands› done', 'for (( ; ; )) do *commands* done'],
  ['while a; do b; done', 'while ‹condition› do ‹commands› done', 'while *condition* do *commands* done'],
  ['until a; do b; done', 'until ‹condition› do ‹commands› done', 'until *condition* do *commands* done'],
  ['while a; do b; done < input.txt', 'while ‹condition› do ‹commands› done < input.txt', 'while *condition* do *commands* done < input.txt'],
  ['case "$1" in a) b;; esac', 'case "$1" in ‹patterns› esac', 'case "$1" in *patterns* esac'],
  [`case $${long} in a) b;; esac`, 'case ‹word› in ‹patterns› esac', 'case *word* in *patterns* esac'],
  ['select x in a b; do :; done', 'select x in ‹words› do ‹commands› done', 'select x in *words* do *commands* done'],
  ['backup() { :; }', 'backup() { ‹commands› }', 'backup() { *commands* }'],
  ['function f { :; }', 'function f { ‹commands› }', 'function f { *commands* }'],
  ['function f() { :; }', 'function f() { ‹commands› }', 'function f() { *commands* }'],
  ['f() ( a )', 'f() ( ‹commands› )', 'f() ( *commands* )'],
  ['f() { :; } >&2', 'f() { ‹commands› } >&2', 'f() { *commands* } >&2'],
  ['( a; b )', '( ‹commands› )', '( *commands* )'],
  ['{ a; b; }', '{ ‹commands› }', '{ *commands* }'],
  ['grep -i x f | sort | uniq -c', 'grep | sort | uniq', 'grep | sort | uniq'],
  ['a | b |& c', 'a | b |& c', 'a | b |& c'],
  ['make > build.log 2>&1 || exit 1', 'make || exit', 'make || exit'],
  ['grep -rn x ./src 2>&1 | sort -u > errors.txt && echo done || exit 1', 'grep | sort && echo || exit', 'grep | sort && echo || exit'],
  ['tr -d x < windows.txt > unix.txt', 'tr < windows.txt > unix.txt', 'tr < windows.txt > unix.txt'],
  [`tr a b > "${long}"`, 'tr > ‹file›', 'tr > *file*'],
  [`cat <<< "${long}"`, 'cat <<< ‹string›', 'cat <<< *string*'],
  ['cat <<EOF\nhi\nEOF', 'cat <<EOF', 'cat <<EOF'],
  [`cat <<"${long}"\nhi\n${long}`, 'cat << ‹delimiter›', 'cat << *delimiter*'],
  ['>f echo x', 'echo >f', 'echo >f'],
  ['{ a; } > f', '{ ‹commands› } > f', '{ *commands* } > f'],
  ['unset a | b', 'unset | b', 'unset | b'],
  ['local a=1 | b', 'local | b', 'local | b'],
  [`{${long}}>`, `{${long}}> ‹file›`, `{${long}}> *file*`],
  ['! a | b', '! a | b', '! a | b'],
  ['! a', '! a', '! a'],
  ['time sleep 1', 'time sleep', 'time sleep'],
  ['time -p a | b', 'time -p a | b', 'time -p a | b'],
  ['coproc a', 'coproc a', 'coproc a'],
  ['coproc N { a; }', 'coproc N { ‹commands› }', 'coproc N { *commands* }'],
  // A stage that is itself a construct: its own short form, or a placeholder.
  ['( a ) | b', '( ‹commands› ) | b', '( *commands* ) | b'],
  ['if a; then b; fi | c', '‹command› | c', '*command* | c'],
  // A short test, arithmetic command or assignment keeps its text; a long one gets a skeleton.
  ['[ -f x ]', '[ -f x ]', '[ -f x ]'],
  ['[[ -f a && $x =~ ^[0-9]+$ ]]', '[[ -f a && $x =~ ^[0-9]+$ ]]', '[[ -f a && $x =~ ^[0-9]+$ ]]'],
  ['(( count++ ))', '(( count++ ))', '(( count++ ))'],
  ['x=1', 'x=1', 'x=1'],
  [`[ ${long} -a ${long} ]`, '[ ‹expression› ]', '[ *expression* ]'],
  [`[[ ${long} ]]`, '[[ ‹expression› ]]', '[[ *expression* ]]'],
  [`(( ${long} + 1 ))`, '(( ‹expression› ))', '(( *expression* ))'],
  [`x=${long}`, 'x=‹value›', 'x=*value*'],
  [`x+=${long}`, 'x+=‹value›', 'x+=*value*'],
  ['[ -f x ] && echo y', '[ -f x ] && echo', '[ -f x ] && echo'],
];

describe('the label of a construct', () => {
  it('is its skeleton: the parts, and the plain text made of them', () => {
    for (const [src, plain, parts] of CASES) {
      const t = first(src);
      assert.strictEqual(t.label, plain, src);
      assert.strictEqual(labelText(labelParts(t)), plain, src);
      // A label of only code is the text one part at a time, as the plain form shows it.
      assert.strictEqual(show(labelParts(t)), parts, src);
    }
  });

  it('keeps the whole construct as its range', () => {
    const src = 'if a; then\n  b\nfi';
    const t = first(src);
    assert.deepStrictEqual([t.span.start, t.span.end], [{ line: 0, character: 0 }, { line: 2, character: 2 }]);
    const g = first('grep -i x f | sort');
    assert.deepStrictEqual([g.span.start.character, g.span.end.character], [0, 18]);
  });

  it('is the same in Japanese, where only the explanations change', () => {
    for (const [src] of CASES) {
      const en = first(src);
      const ja = first(src, 0, 'ja');
      assert.notStrictEqual(en.explanation, ja.explanation, src);
      assert.deepStrictEqual(
        all([ja]).map((t) => [t.label, t.labelParts]),
        all([en]).map((t) => [t.label, t.labelParts]),
        src,
      );
    }
  });

  it('has no parts when it is plain text', () => {
    for (const src of ['grep x f', '[ -f x ]', 'x=1', 'local a=1']) assert.strictEqual(first(src).labelParts?.some((p) => p.placeholder) ?? false, false, src);
    assert.strictEqual(first('grep x f').labelParts, undefined);
    assert.deepStrictEqual(labelParts(first('grep x f')), [{ text: 'grep' }]);
  });

  it('labels the parts of a construct the same way', () => {
    const src = 'if a; then\n  b\nelif c; then\n  d\nelse\n  e\nfi';
    assert.deepStrictEqual(explain(src, 2).items.map((t) => t.label), ['elif ‹condition› then ‹commands›']);
    assert.deepStrictEqual(explain(src, 4).items.map((t) => t.label), ['else ‹commands›']);
    const loop = explain('for f in a; do\n  b\ndone');
    assert.deepStrictEqual(loop.items[0].children.map((t) => t.label), ['for', 'f', 'in', 'a', 'do ‹commands› done']);
  });

  it('labels the branches of a case by their patterns', () => {
    const src = 'case x in\n  a|b) c ;;\n  *) ;&\n  d) e ;;&\n  ' + long + ') f ;;\nesac';
    assert.deepStrictEqual([1, 2, 3, 4].map((i) => explain(src, i).items[0].label), ['a|b) ‹commands› ;;', '*) ;&', 'd) ‹commands› ;;&', '‹pattern›) ‹commands› ;;']);
    // An unfinished one has the parts it has.
    assert.strictEqual(explain('case x in\n  a)', 1).items[0].label, 'a)');
  });

  it('stays what it was typed so far when the construct is not finished', () => {
    assert.strictEqual(first('f()').label, 'f()');
    assert.strictEqual(first('time').label, 'time');
    assert.strictEqual(first('coproc').label, 'coproc');
    assert.strictEqual(first('if a; then').label, 'if ‹condition› then');
    assert.strictEqual(first('a | >f').label, 'a | >f');
    assert.strictEqual(first('a=1 b=2 && c').label, 'a=1 b=2 && c');
    assert.strictEqual(first('cat <<').label, 'cat <<');
  });

  it('keeps a redirection in the label of the loop on a line of its own', () => {
    const src = 'while a; do\n  b\ndone < input.txt';
    assert.strictEqual(first(src, 0).label, 'while ‹condition› do ‹commands› done < input.txt');
    assert.strictEqual(first(src, 2).label, 'done');
  });

  it('keeps commands, arguments, options and the parts of strings as they were', () => {
    const [pipe] = explain("grep -E '^[A-Z]+$' \"$f\" | sort").items;
    assert.strictEqual(pipe.label, 'grep | sort');
    assert.deepStrictEqual(pipe.children.map((t) => t.label), ['grep', '|', 'sort']);
    assert.deepStrictEqual(pipe.children[0].children.map((t) => t.label), ['-E', "'^[A-Z]+$'", '"$f"']);
  });

  it('breaks nothing for the labels of the example script', () => {
    const lines = fs.readFileSync(path.join(__dirname, 'fixtures/sample.sh'), 'utf8').split('\n');
    const a = new Analyzer('en');
    const tree = parser.parse(lines.join('\n'));
    lines.forEach((_, i) => {
      for (const t of all(a.explainLine(tree, i).items)) {
        assert.strictEqual(t.label, t.labelParts ? labelText(t.labelParts) : t.label);
        assert.ok(!/[‹›]/.test(t.label) || t.labelParts, t.label);
      }
    });
  });
});

describe('the label of a construct, shown', () => {
  const src = 'for f in a; do :; done';
  const ex = () => explain(src);

  it('is Markdown with the code in code spans and the placeholders in italics (copy as Markdown, and the language server)', () => {
    const md = toPlainMarkdown(ex(), src, 'a.sh:1');
    assert.match(md, /\n- `for` `f` `in` \*words\* `do` \*commands\* `done` — for loop/);
    assert.match(md, /\n {2}- `do` \*commands\* `done` — Loop body/);
    assert.match(toPlainMarkdown(explain('grep -E x f'), 'grep -E x f', 'a.sh:1'), /\n- `grep` — Print lines/);
  });

  it('is a code span as long as the text needs', () => {
    assert.strictEqual(codeSpan('a'), '`a`');
    assert.strictEqual(codeSpan('a`b'), '``a`b``');
    assert.strictEqual(codeSpan('`a'), '`` `a ``');
    assert.strictEqual(codeSpan('a``b`'), '``` a``b` ```');
    assert.strictEqual(labelMarkdown([{ text: 'echo' }, { text: 'x', placeholder: true }, { text: 'a\nb' }]), '`echo` *x* `a ⏎ b`');
    // A tight part follows the one before it with no space: `x=`*value*, *pattern*`)`.
    assert.strictEqual(labelMarkdown([{ text: 'x=' }, { text: 'value', placeholder: true, tight: true }]), '`x=`*value*');
    // A label with a backtick in it, as in the md of a token the analyzer made.
    const tick = { ...first('echo x'), label: 'a`b', labelParts: undefined };
    assert.match(toPlainMarkdown({ ...explain('echo x'), items: [tick] }, 'echo x', 'a.sh:1'), /\n- ``a`b`` — /);
  });

  it('is code and italic placeholders in the hover', () => {
    const hover = toMarkdown(ex(), 'en', { line: 0, character: 1 }, undefined, src);
    assert.match(hover, /- <strong><code>[^\n]*for<\/span><\/code> <code>[^\n]*f<\/span><\/code> <code>[^\n]*in<\/span><\/code> <i><span style="color:var\(--vscode-descriptionForeground\);">words<\/span><\/i> <code>/);
    assert.ok(!hover.includes('‹'));
    assert.ok(!toMarkdown(ex(), 'en', undefined, undefined, src).includes('<strong><code>'));
  });
});

describe('the label of a construct, in the command line tool', () => {
  const run = async (args: string[], isTTY: boolean, env: NodeJS.ProcessEnv = {}) => {
    let out = '';
    const code = await main(args, { stdout: (s) => (out += s), stderr: (s) => (out += s), env, isTTY });
    assert.strictEqual(code, 0, out);
    return out;
  };
  const args = ['-e', 'while a; do b; done < in.txt', '--no-examples'];
  const top = (out: string) => out.split('\n').find((l) => l.startsWith('  '))!;

  it('marks a placeholder ‹like this› when there is no colour', async () => {
    const out = await run(args, false);
    assert.match(top(out), /^ {2}while ‹condition› do ‹commands› done < in\.txt {2}Redirection applied to/);
    assert.ok(!out.includes('\x1b'));
    assert.match(top(await run([...args, '--no-color'], true)), /‹condition›/);
    assert.match(top(await run(args, true, { NO_COLOR: '1' })), /‹condition›/);
  });

  it('shows a placeholder in italics and dim on a terminal, or with --color', async () => {
    for (const out of [await run(args, true), await run([...args, '--color'], false)]) {
      const line = top(out);
      assert.ok(line.includes('\x1b[2;3mcondition\x1b[0m'), JSON.stringify(line));
      assert.ok(line.includes('\x1b[33mwhile\x1b[0m'), JSON.stringify(line));
      assert.ok(line.includes('\x1b[33m< in.txt\x1b[0m'), JSON.stringify(line));
      assert.ok(line.includes('\x1b[2;3mcommands\x1b[0m'));
      assert.ok(!line.includes('‹'));
    }
  });

  it('gives the parts in the JSON', async () => {
    const [entry] = JSON.parse(await run([...args, '--format', 'json'], false));
    assert.deepStrictEqual(entry.explanation.items[0].labelParts.map((p: LabelPart) => p.placeholder ?? false), [false, true, false, true, false, false]);
    assert.strictEqual(entry.explanation.items[0].label, 'while ‹condition› do ‹commands› done < in.txt');
  });
});

describe('the label of a construct in a file that holds shell code', () => {
  it('is not replaced by the text of the range', () => {
    const src = 'steps:\n  - run: |\n      for f in *.txt; do\n        echo "$f"\n      done\n';
    const lines = src.split('\n');
    const extracted = extractShell(hostKind('', 'ci.yml')!, src);
    const ex = explainHostedLine(new Analyzer('en'), parser.parse(extracted.text), extracted, lines, 2, 'en')!;
    assert.strictEqual(ex.items[0].label, 'for f in ‹words› do ‹commands› done');
    assert.deepStrictEqual(show(ex.items[0].labelParts), 'for f in *words* do *commands* done');
    assert.strictEqual(ex.items[0].span.start.character, 6);
  });
});
