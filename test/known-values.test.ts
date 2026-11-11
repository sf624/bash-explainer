// A known value read in the language its place names (docs/design/known-values.md, step 2: the use). `grep -E "$re" f`, where the script
// sets `re`, is read as `grep -E '…' f` is: the rows of the literal, under the value's line (`ValueInfo.reading`), its example, and
// an error in the value as a problem of the line. Compared with the tools: the variable form and the literal form give the same
// output and status, and an unquoted value that globs gives another where a file name matches it.
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Analyzer, type ExplainOptions, type LineExplanation, type Token } from '../src/analyzer';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { toPlainMarkdown } from '../src/ui/render';
import { partAt } from '../src/ui/hoverParts';
import { partHover, plainPartHover } from '../src/ui/hoverView';
import { explainDocumentLine } from '../src/document';
import { openDocument, shellsOf } from '../src/document-setup';
import { rowModel, type ModelRow } from '../src/ui/panelRows';
import { tokenRow } from '../src/ui/tokenRow';
import { main } from '../cli/main';
import { runContained } from './support/contained';
import { allTokens } from './support/explain';
import { scanDirs } from './support/scan';
import { globbedByBash, globParts } from '../src/semantics/chars';

const parser = createUnbashParser();

/** The explanation of line `line` (from 0) of `src`. */
const explain = (src: string, line: number, lang: 'en' | 'ja' = 'en', opts: ExplainOptions = {}): LineExplanation => new Analyzer(lang).explainLine(parser.parse(src), line, 'bash', opts);

/** The token of a line whose value is read, and its reading's tokens. */
function valueToken(e: LineExplanation): Token | undefined {
  return allTokens(e.items).find((t) => t.value?.reading);
}

/** A token's shape: its kind, label, text and marks, and those of its parts. */
type Shape = [string, string, string, string[], Shape[]];
const shape = (t: Token): Shape => [t.kind, t.label, t.explanation, (t.marks ?? []).map((m) => m.level), t.children.map(shape)];

/** The tokens a reader made of the first literal word of a line it read: the outermost tokens of an embedded language. */
function literalReading(e: LineExplanation): Token[] {
  const out: Token[] = [];
  const walk = (t: Token) => {
    if (t.origin === 'embedded') out.push(t);
    else t.children.forEach(walk);
  };
  const first = allTokens(e.items).find((t) => t.kind === 'argument' && allTokens(t.children).some((c) => c.origin === 'embedded'));
  if (first) walk(first);
  return out;
}

/** The text of the argument token of a line whose label is `label`. */
const argText = (e: LineExplanation, label: string): string => allTokens(e.items).find((t) => t.kind === 'argument' && t.label === label)!.explanation;

/** The text of the argument a reader read: the one with the tokens of the literal, or with the value read. */
const readArg = (e: LineExplanation): string => allTokens(e.items).find((t) => t.kind === 'argument' && allTokens(t.children).some((c) => c.origin === 'embedded' || c.value) || /^'/.test(t.label))!.explanation;

/**
 * The cases whose worked example needs a command's word that is a known value besides the one read (awk's options, the `-e` of
 * sed and grep, printf's format, tr's sets): left for step 2b of docs/design/known-values.md, so the variable form has none yet.
 */
const EXAMPLE_LATER = new Set(['sed -e', 'grep -e', 'gawk', 'awk over several lines', 'printf', 'tr']);

/** Each case: the value, and the use with `V` for the word (the literal `'value'`, or the variable). */
const CASES: { name: string; value: string; use: string }[] = [
  { name: 'sed addresses', value: '/^BEGIN/,/^END/p', use: 'sed -n V config.txt' },
  { name: 'sed s', value: 's/a/b/g', use: 'sed V f' },
  { name: 'sed -E', value: 's/(a+)/<\\1>/', use: 'sed -E V f' },
  { name: 'sed -e', value: '3,5d', use: 'sed -e V f' },
  { name: 'grep BRE', value: '^a\\+b', use: 'grep V f' },
  { name: 'grep -E', value: '^[A-Z][0-9]+$', use: 'grep -E V ids.txt' },
  { name: 'grep -F', value: 'a.b', use: 'grep -F V f' },
  { name: 'grep -P', value: '\\d+(?=x)', use: 'grep -P V f' },
  { name: 'grep -e', value: 'x|y', use: 'grep -E -e V f' },
  { name: 'gawk', value: '$2 > 10 { print $1 }', use: 'gawk V f' },
  { name: 'awk over several lines', value: 'BEGIN { FS = ":" }\n{ print $1 }', use: 'awk V /etc/passwd' },
  { name: 'jq', value: '.items[] | .name', use: 'jq -r V a.json' },
  { name: 'jq over several lines', value: '.items[]\n| select(.n > 1)', use: 'jq V a.json' },
  { name: 'printf', value: '%s: %d\\n', use: 'printf V a 1' },
  { name: 'date', value: '+%F %T', use: 'date V' },
  { name: 'tr', value: 'a-z', use: 'tr V A-Z' },
];

/** The script that sets the value and uses it (`$v` or `"$v"`), the use on its last line; and the literal form. */
function forms(c: { value: string; use: string }, word: string): { variable: string; literal: string; line: number } {
  const set = `v='${c.value}'\n`;
  // (A function, so that a `$` of the value is no pattern of `replace`.)
  return { variable: set + c.use.replace('V', () => word) + '\n', literal: c.use.replace('V', () => `'${c.value}'`) + '\n', line: set.split('\n').length - 1 };
}

describe('a known value read in the language of its command (known-values.md, step 2)', function () {
  this.timeout(60000);

  // (One source for what a known value means in a use's language: docs/design/sources.md, row 39.)
  it('reads a value in a language in one place: `valueReading` (src/explain/embedded.ts)', () => {
    const found = (re: RegExp, allowed: readonly string[], dirs = ['src', 'cli', 'web']): string[] =>
      scanDirs(dirs, allowed, (rel, text) => (re.test(text) ? [{ file: rel, fn: '', kind: 'x', what: '' }] : [])).map((m) => m.file);
    // (The readers of the languages, by their table; `explainRegex` outside a reader only where bash reads an ERE itself, `[[ =~ ]]`.)
    assert.deepStrictEqual(found(/EMBEDDED\[/, ['src/explain/embedded.ts']), []);
    assert.deepStrictEqual(found(/\bexplainRegex\(/, ['src/explain/embedded.ts', 'src/explain/tests.ts'], ['src/explain']), []);
    // (What a word passes as it is, where its value is known: asked for a reading only.)
    assert.deepStrictEqual(found(/\bknownCopy\(/, ['src/explain/embedded.ts', 'src/semantics/values.ts']), []);
  });

  describe('the same as the literal', () => {
    for (const c of CASES) {
      it(c.name, () => {
        const { variable, literal, line } = forms(c, '"$v"');
        for (const lang of ['en', 'ja'] as const) {
          const v = explain(variable, line, lang);
          const l = explain(literal, 0, lang);
          // (No tokens where the literal has none: `grep -F`, whose reader says only that the pattern is a fixed string.)
          assert.deepStrictEqual(valueToken(v)?.value!.reading!.tokens.map(shape) ?? [], literalReading(l).map(shape), c.name);
          // (The role of the word, with the reader's note, as the literal has it.)
          assert.strictEqual(readArg(v), readArg(l), c.name);
          // (Its example: the one of the literal.)
          assert.deepStrictEqual(v.examples.map((x) => x.sections), EXAMPLE_LATER.has(c.name) ? [] : l.examples.map((x) => x.sections), c.name);
        }
      });
    }

    it('unquoted, where the value has no IFS or glob character: as quoted', () => {
      const { variable, literal, line } = forms(CASES[0], '$v');
      const t = valueToken(explain(variable, line))!;
      assert.deepStrictEqual(t.value!.reading!.tokens.map(shape), literalReading(explain(literal, 0)).map(shape));
      assert.strictEqual(t.value!.reading!.assumes, undefined);
    });

    it('`${v}` and `"${v}"`: as `$v`', () => {
      for (const w of ['${v}', '"${v}"']) {
        const { variable, line } = forms(CASES[5], w);
        assert.ok(valueToken(explain(variable, line)), w);
      }
    });

    it('does not say that the script depends on the value', () => {
      const e = explain("s='s/a/b/'\nsed -n \"$s\" f\n", 1);
      assert.doesNotMatch(JSON.stringify(e), /depends on the value/);
      // (A value not known still says it.)
      assert.match(JSON.stringify(explain('sed -n "$1" f\n', 0)), /depends on the value of `\$1`/);
    });

    it('an unquoted value that globs: read where no file name matches, and the glob said once (decision of section 12)', () => {
      const e = explain("re='^[A-Z][0-9]+$'\ngrep -E $re ids.txt\n", 1);
      const t = valueToken(e)!;
      assert.strictEqual(t.value!.reading!.assumes, 'no-match');
      assert.strictEqual(t.value!.said.readingLead, 'Read below as `grep` gets it where no file name matches');
      assert.match(t.value!.said.text, /bash also reads it as a glob pattern \(its `\[A-Z\]`, `\[0-9\]`\) before `grep` gets it/);
      assert.strictEqual(argText(e, '$re'), 'search pattern (regex) — extended regex (ERE)');
      assert.strictEqual(e.notes.filter((n) => /glob pattern/.test(n)).length, 1);
      const ja = valueToken(explain("re='^[A-Z][0-9]+$'\ngrep -E $re ids.txt\n", 1, 'ja'))!;
      assert.strictEqual(ja.value!.said.readingLead, '以下は、一致するファイル名がないときに `grep` が受け取る値の読み方');
    });

    it('the reading is kept for the document: two explanations of the line read the same tokens', () => {
      const tree = parser.parse("re='^a+$'\ngrep -E \"$re\" f\n");
      const a = new Analyzer('en');
      const one = valueToken(a.explainLine(tree, 1, 'bash'))!.value!.reading!.tokens;
      const two = valueToken(a.explainLine(tree, 1, 'bash'))!.value!.reading!.tokens;
      assert.strictEqual(one[0], two[0]);
      assert.ok(Object.isFrozen(one[0]));
    });
  });

  describe('an error in the value', () => {
    it('is an error token, and a problem of the line, as for the literal', () => {
      const v = explain("re='[a'\ngrep -E \"$re\" f\n", 1);
      const l = explain("grep -E '[a' f\n", 0);
      assert.deepStrictEqual(valueToken(v)!.value!.reading!.tokens.map(shape), literalReading(l).map(shape));
      assert.deepStrictEqual(v.notes, l.notes);
      assert.match(v.notes[0], /^ⓧ Error: No `\]` closes this `\[`/);
    });

    it('has the same level whichever line is explained first, where the use may not be reached', () => {
      const src = "if [ \"$1\" ]; then exit 1; fi\nre='[a'\ngrep -E \"$re\" f\n";
      const tree = parser.parse(src);
      const levels = (first: number[]): string[] => {
        const a = new Analyzer('en');
        for (const n of first) a.explainLine(tree, n, 'bash');
        const e = a.explainLine(tree, 2, 'bash');
        return [...valueToken(e)!.value!.reading!.tokens.flatMap((t) => (t.marks ?? []).map((m) => m.level)), ...e.notes];
      };
      const literal = explain("if [ \"$1\" ]; then exit 1; fi\ngrep -E '[a' f\n", 1);
      assert.deepStrictEqual(levels([]), [...literalReading(literal).flatMap((t) => (t.marks ?? []).map((m) => m.level)), ...literal.notes]);
      assert.deepStrictEqual(levels([0, 1]), levels([]));
    });
  });

  describe('nothing read', () => {
    const unread: [string, string, number][] = [
      ['a value split into several words', "x='-e s/a/b/'\nsed $x f\n", 1],
      ['nullglob on', "shopt -s nullglob\nre='^[A-Z]+$'\ngrep -E $re f\n", 2],
      ['failglob on', "shopt -s failglob\nre='^[A-Z]+$'\ngrep -E $re f\n", 2],
      ['nullglob maybe on', "[ \"$1\" ] && shopt -s nullglob\nre='^[A-Z]+$'\ngrep -E $re f\n", 2],
      ['an absolute glob', "p='/[A-Z]+/p'\nsed -n $p f\n", 1],
      ['a value set in a loop', "for re in a b; do\n  grep -E \"$re\" f\ndone\n", 1],
      ['a value read by `read`', "read -r re\ngrep -E \"$re\" f\n", 1],
      ['a value of `$( )`', "re=$(cat p)\ngrep -E \"$re\" f\n", 1],
      ['in a function called from a trap', "re='^a'\nf() { grep -E \"$re\" x; }\ntrap f EXIT\n", 1],
      ['an array', "a=('^a' b)\ngrep -E \"${a[0]}\" f\n", 1],
      ['a joined word', "r='^a'\nsed -n \"/$r/p\" f\n", 1],
      ['another form of expansion', "r='^a.b'\ngrep -E \"${r%.*}\" f\n", 1],
      ['a positional parameter', "set -- '^a'\ngrep -E \"$1\" f\n", 1],
      ['a command a slot runs', "re='^a'\nsudo grep -E \"$re\" f\n", 1],
      ['find -exec', "re='^a'\nfind . -exec grep -E \"$re\" {} +\n", 1],
      ['a script the model does not trust', "eval \"$1\"\nre='^a'\ngrep -E \"$re\" f\n", 2],
      ['a script that changes its directory, for an unquoted glob', "cd /tmp\nre='^[A-Z]+$'\ngrep -E $re f\n", 2],
      ['a command line the tool refuses', "re='^a'\ngrep -E -F \"$re\" f\n", 1],
      ['a value the reader reads nothing of', "m='zz'\nchmod \"$m\" f\n", 1],
    ];
    for (const [name, src, line] of unread) {
      it(name, () => assert.strictEqual(valueToken(explain(src, line)), undefined, src));
    }

    it('a word no shell reads: Docker\'s exec form', () => {
      const doc = openDocument('FROM alpine\nENV re=^a\nRUN ["grep", "-E", "$re", "f"]\n', 'dockerfile', (t) => parser.parse(t));
      const e = explainDocumentLine(new Analyzer('en'), doc, 2, 'en', shellsOf(doc.lines, 'Dockerfile', undefined), {})!;
      assert.strictEqual(valueToken(e), undefined);
    });

    it('zsh', () => {
      const e = new Analyzer('en').explainLine(parser.parse("re='^a+'\ngrep -E \"$re\" f\n"), 1, 'zsh');
      assert.strictEqual(valueToken(e), undefined);
    });

    it('the explanation of a value not read stays as it was: sed with the value split', () => {
      assert.match(JSON.stringify(explain("x='-e s/a/b/'\nsed $x f\n", 1)), /it is split into 2 words/);
    });
  });

  // (A function called more than `WALKS_PER_FUNCTION` times, with entries that differ only in the words that gave their
  // values: each call reuses the first walk, so the use keeps its value and its reading. Each `rc=0` is another word.)
  it('a function called five times, after assignments of the same text', () => {
    const src = `re='^TODO'\nsearch() { grep -E "$re" notes.txt; }\n${'rc=0; search || rc=1\n'.repeat(5)}`;
    const t = valueToken(explain(src, 1));
    assert.strictEqual(t?.value?.text, '^TODO');
    assert.ok(t.value.reading!.tokens.length > 0);
  });

  describe('one command reading', () => {
    it('a custom spec of the command: its words as the spec reads them, so no language and no reading', () => {
      const e = explain("re='^a'\ngrep -E \"$re\" f\n", 1, 'en', { customCommands: { grep: { summary: 'My grep' } } });
      assert.strictEqual(valueToken(e), undefined);
      assert.ok(valueToken(explain("re='^a'\ngrep -E \"$re\" f\n", 1)));
    });
  });

  describe('the texts of a glob in the value', () => {
    it('in sh, the shell reads it; past three glob parts, the first three', () => {
      const e = new Analyzer('en').explainLine(parser.parse("p='^a*b?c[d]e*'\ngrep $p f\n"), 1, 'sh');
      assert.match(valueToken(e)!.value!.said.text, /Unquoted, the shell also reads it as a glob pattern \(its `\*`, `\?`, `\[d\]` …\) before `grep` gets it/);
      const ja = new Analyzer('ja').explainLine(parser.parse("p='^a*b?c[d]e*'\ngrep $p f\n"), 1, 'sh');
      assert.match(valueToken(ja)!.value!.said.text, /シェルは `grep` に渡す前に値をグロブのパターンとしても読み（`\*`・`\?`・`\[d\]`など）/);
    });

    it('takes the parts that make a value a pattern as `globbedByBash` reads them', () => {
      const table: [string, 'on' | 'off', string[]][] = [
        ['^[A-Z][0-9]+$', 'off', ['[A-Z]', '[0-9]']], ['a*b?', 'off', ['*', '?']], ['\\*a', 'off', []], ['[!a]x[^b]', 'off', ['[!a]', '[^b]']],
        ['[]a]', 'off', ['[]a]']], ['[[:alpha:]]', 'off', ['[[:alpha:]]']], ['[[:x', 'off', []], ['[a\\]]', 'off', ['[a\\]]']], ['[a/b]', 'off', []],
        ['[a', 'off', []], ['+(a|b)', 'on', ['+(a|b)']], ['+(a|b)', 'off', []], ['*(a)b', 'on', ['*(a)']], ['*(a', 'on', ['*']], ['@(a', 'on', ['@(']],
        ['!(a\\)b)', 'on', ['!(a\\)b)']], ['"[A-Z]"', 'off', ['[A-Z]']], ["'*'", 'off', ['*']],
      ];
      for (const [p, ext, parts] of table) {
        assert.deepStrictEqual(globParts(p, ext), parts, p);
        assert.strictEqual(parts.length > 0, globbedByBash(p, ext) === true, p);
      }
    });

    it('the note names the shell that runs the script, as the value line does: sh and dash', () => {
      for (const shell of ['sh', 'dash'] as const) {
        const src = "re='^[A-Z][0-9]+$'\ngrep -E $re ids.txt\n";
        const en = new Analyzer('en').explainLine(parser.parse(src), 1, shell);
        assert.deepStrictEqual(en.notes.filter((n) => /glob pattern/.test(n)).map((n) => /the shell also reads it as a glob pattern \(its `\[A-Z\]`, `\[0-9\]`\) before `grep` gets it/.test(n)), [true], shell);
        assert.match(valueToken(en)!.value!.said.text, /the shell also reads it/, shell);
        const ja = new Analyzer('ja').explainLine(parser.parse(src), 1, shell);
        assert.ok(ja.notes.some((n) => n.includes('シェルは `grep` に渡す前に値をグロブのパターンとしても読み（`[A-Z]`・`[0-9]`）')), shell);
      }
    });

    // (The parts are those the word model globs: an extended glob with extglob on, and a quote, which is text in a value.)
    for (const [src, parts] of [
      ["shopt -s extglob\nre='+(a)'\ngrep -E $re f\n", '`+(a)`'],
      ["re='\"[A-Z]\"'\ngrep $re f\n", '`[A-Z]`'],
      ["re=\"'*'\"\ngrep $re f\n", '`*`'],
    ]) {
      it(`names the glob parts the word model sees: ${src.split('\n').at(-3)}`, () => {
        const e = explain(src, src.split('\n').length - 2);
        const said = `bash also reads it as a glob pattern (its ${parts}) before \`grep\` gets it`;
        assert.ok(e.notes.some((n) => n.includes(said)), JSON.stringify(e.notes));
        assert.ok(allTokens(e.items).some((t) => t.value?.said.text.includes(said)));
        assert.ok(!JSON.stringify(e).includes('(its )'));
      });
    }

    // (Decision 12 (b): the value line says it wherever a command reads the value as data, read in its language here or not.)
    for (const use of ['sudo grep -E $re f', 'find . -exec grep -E $re {} +', 'command grep -E $re f', 'env grep -E $re f', 'xargs grep -E $re']) {
      it(`the value line where the value is not read: ${use}`, () => {
        const e = explain(`re='^[A-Z][0-9]+$'\n${use}\n`, 1);
        const v = allTokens(e.items).find((t) => t.value)!;
        assert.match(v.value!.said.text, /Unquoted, bash also reads it as a glob pattern \(its `\[A-Z\]`, `\[0-9\]`\) before `grep` gets it/);
        assert.strictEqual(v.value!.said.readingLead, undefined);
        assert.strictEqual(e.notes.filter((n) => /glob pattern/.test(n)).length, 1);
      });
    }

    it('bats\' `run grep -E $re f`: no note there, so the row says the glob itself', () => {
      const doc = openDocument("@test 'ids' {\n  re='^[A-Z][0-9]+$'\n  run grep -E $re ids.txt\n}\n", 'bats', (t) => parser.parse(t));
      const e = explainDocumentLine(new Analyzer('en'), doc, 2, 'en', shellsOf(doc.lines, 'a.bats', undefined), {})!;
      assert.ok(!e.notes.some((n) => /glob pattern/.test(n)));
      assert.match(allTokens(e.items).find((t) => t.kind === 'argument' && t.label === '$re')!.explanation, /unquoted, `\$re` is a glob pattern, so a file name that matches it takes its place/);
    });
  });

  describe('every output shows the rows, quoted (no text above them)', () => {
    const e = explain("re='^a+$'\ngrep -E \"$re\" f\n", 1);
    const t = valueToken(e)!;
    const chain = allTokens(e.items).filter((x) => x.span.start.character <= t.span.start.character && t.span.end.character <= x.span.end.character);
    it('the hover\'s part card, in HTML and plain', () => {
      const md = partHover({ ex: e, lang: 'en', theme: 'dark', lineText: 'grep -E "$re" f', panelLink: 'x', lineLink: 'y', keys: '', placement: 'first', problems: [] }, chain);
      assert.match(md, /start of the line/);
      assert.doesNotMatch(md, /Read below/);
      const plain = plainPartHover(e, chain, 'en', 'whole');
      assert.match(plain, /- `\^` — start of the line\n- `a` — /);
      const unquoted = explain("re='^[A-Z]+$'\ngrep -E $re f\n", 1);
      const u = valueToken(unquoted)!;
      assert.match(plainPartHover(unquoted, [unquoted.items[0], u], 'en', 'whole'), /_Read below as `grep` gets it where no file name matches_/);
    });
    it('Markdown: the parts of a row of the reading under it (a sed range)', () => {
      const sed = explain("s='/^a/,/^b/p'\nsed -n \"$s\" f\n", 1);
      assert.match(toPlainMarkdown(sed, 'sed -n "$s" f', 'x'), /\n {8}- `\/\^a\/,\/\^b\/p` — .*\n {10}- `\/\^a\/` — /);
    });
    it('Markdown and the CLI', async () => {
      assert.match(toPlainMarkdown(e, 'grep -E "$re" f', 'x'), /Value here, from the script: `\^a\+\$`\n {8}- `\^` — start of the line/);
      let out = '';
      await main(['--no-config', '--no-color', '--line', '2', '-e', "re='^a+$'\ngrep -E \"$re\" f\n"], { stdout: (x) => { out += x; }, stderr: () => {}, env: {}, isTTY: false });
      assert.match(out, /= Value here, from the script: `\^a\+\$`\n +\^ +start of the line/);
    });
  });

  describe('every output shows the rows, from the row record (`tokenRow`)', () => {
    const src = "re='^[A-Z][0-9]+$'\ngrep -E $re ids.txt\n";
    const e = explain(src, 1);
    const t = valueToken(e)!;

    it('the row record', () => {
      const r = tokenRow(t, 'en');
      assert.strictEqual(r.reading!.lead, 'Read below as `grep` gets it where no file name matches');
      assert.deepStrictEqual(r.reading!.rows.map((x) => x.label), ['^', '[A-Z]', '[0-9]', '+', '$']);
    });

    it('the panel: under the value\'s row, at the depth of its parts, and in no place of the line', () => {
      const model = rowModel(e, { depth: 1, receives: false }, 'en');
      const all = (rows: readonly ModelRow[]): ModelRow[] => rows.flatMap((r) => [r, ...all(r.children)]);
      const row = all(model.rows).find((r) => r.reading)!;
      assert.deepStrictEqual(row.children.filter((c) => c.inValue).map((c) => c.label), ['^', '[A-Z]', '[0-9]', '+', '$']);
      assert.ok(!all(model.rows).some((r) => r.inValue && [...model.places.values()].includes(r.key)));
      assert.ok(![...model.places.keys()].some((k) => t.value!.reading!.tokens.includes(k)));
    });

    it('the hover\'s part card', () => {
      const md = partHover({ ex: e, lang: 'en', theme: 'light', lineText: 'grep -E $re ids.txt', panelLink: 'x', lineLink: 'y', keys: '', placement: 'first', problems: [] }, partAt(e.items, { line: 1, character: t.span.start.character + 1 }));
      assert.match(md, /Read below as/);
      assert.match(md, /start of the line/);
      assert.match(md, /Character class: one of A-Z/);
      // (The example of the value, as a literal's.)
      assert.match(md, /Matching lines/);
    });

    it('Markdown', () => {
      const md = toPlainMarkdown(e, 'grep -E $re ids.txt', 'x');
      assert.match(md, /_Read below as `grep` gets it where no file name matches_\n {6}- `\^` — start of the line/);
    });

    it('the CLI and JSON', async () => {
      const run = async (...args: string[]): Promise<string> => {
        let out = '';
        await main(['--no-config', ...args, '-e', src], { stdout: (s) => { out += s; }, stderr: () => {}, env: {}, isTTY: false });
        return out;
      };
      const text = await run('--no-color', '--line', '2');
      assert.match(text, /Read below as grep gets it where no file name matches\n +\^ +start of the line/);
      const json = JSON.parse(await run('--format', 'json', '--line', '2'));
      assert.match(JSON.stringify(json), /"reading":\{"tokens":\[\{"kind":"keyword","label":"\^"/);
    });
  });

  describe('against the tools: the variable form and the literal form give the same output and status', () => {
    const TABLE: { name: string; set: string; variable: string; literal: string }[] = [
      ...CASES.filter((c) => !['date', 'printf'].includes(c.name) && !c.use.startsWith('awk V /etc') && !c.name.startsWith('grep -P')).map((c) => {
        const f = forms(c, '"$v"');
        return { name: c.name, set: `v='${c.value}'`, variable: c.use.replace('V', () => '"$v"'), literal: f.literal.trim() };
      }),
      { name: 'printf', set: "v='%s: %d\\n'", variable: 'printf "$v" a 1', literal: "printf '%s: %d\\n' a 1" },
      { name: 'unquoted', set: "v='^[A-Z][0-9]+$'", variable: 'grep -E $v ids.txt', literal: "grep -E '^[A-Z][0-9]+$' ids.txt" },
    ];
    let seen: { variable: string; literal: string }[] = [];
    let globbed: string[] = [];
    before(async function () {
      this.timeout(30000);
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'known-values-'));
      try {
        const files = "printf 'BEGIN\\na\\nEND\\nb\\n' > config.txt; printf 'aaab\\nx|y\\na.b\\n12x\\nq 20\\nw 5\\n' > f; printf 'A1\\nb2\\nC34\\n' > ids.txt; printf '{\"items\":[{\"name\":\"a\",\"n\":2},{\"name\":\"b\",\"n\":1}]}' > a.json";
        // (One process: each form in a subshell of its own, its output then its status, on a line each.)
        const script = [files, ...TABLE.flatMap((c) => [c.variable, c.literal].map((cmd) => `( ${c.set}; ${cmd} < /dev/null 2>&1 | od -An -c | tr -s ' \\n' ' '; echo "status \${PIPESTATUS[0]}" )`))].join('\n');
        const r = await runContained(['bash', '--norc', '--noprofile', '-c', script], dir);
        const lines = r.stdout.replace(/\n$/, '').split('\n');
        seen = TABLE.map((_, i) => ({ variable: lines[2 * i], literal: lines[2 * i + 1] }));
        // (The note's case: a file whose name the value matches takes its place, and grep finds nothing.)
        const g = await runContained(['bash', '--norc', '--noprofile', '-c', `${files}; v='^[A-Z][0-9]+$'; grep -E $v ids.txt; echo "status $?"; : > '^Q5+$'; grep -E $v ids.txt; echo "status $?"`], dir);
        globbed = g.stdout.trim().split('\n');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    for (const [i, c] of TABLE.entries()) {
      it(c.name, () => assert.strictEqual(seen[i].variable, seen[i].literal, c.name));
    }

    it('an unquoted value that globs: the value where no file matches, another word where one does', () => {
      assert.deepStrictEqual(globbed, ['A1', 'C34', 'status 0', 'status 1']);
    });
  });

  describe('`[[ $x =~ $re ]]` (step 3)', () => {
    /** EREs written without a character the shell reads in a `[[ ]]` right side, with the strings to try. */
    const EREs: [string, string[]][] = [
      ['^[0-9]+$', ['', '0', '12a', 'a12', '007']],
      ['^(a|b)c{2,3}$', ['acc', 'bccc', 'acccc', 'c']],
      ['[[:alpha:]]+[0-9]', ['ab1', '1ab', 'AB9']],
      ['a.b', ['axb', 'ab', 'a.b']],
      ['^\\.x', ['.x', 'ax']],
      ['(a)(b)?c', ['ac', 'abc', 'bc']],
      ['x*y?', ['', 'xx', 'z']],
    ];
    /** The tokens under the regex of the literal right side, as shapes. */
    const literalRows = (e: LineExplanation): Shape[] => allTokens(e.items).find((t) => t.kind === 'pattern' && t.children.length > 0)!.children.map(shape);

    for (const [re] of EREs) {
      it(`${re}: the rows of the value are those of the literal`, () => {
        for (const lang of ['en', 'ja'] as const) {
          for (const w of ['$re', '${re}']) {
            const v = explain(`re='${re}'\n[[ $1 =~ ${w} ]]\n`, 1, lang);
            const l = explain(`[[ $1 =~ ${re} ]]\n`, 0, lang);
            const t = valueToken(v)!;
            assert.deepStrictEqual(t.value!.reading!.tokens.map(shape), literalRows(l), re);
            assert.strictEqual(t.value!.reading!.assumes, undefined);
            // (Its example: the one of the literal.)
            assert.deepStrictEqual(v.examples.map((x) => x.sections), l.examples.map((x) => x.sections), re);
          }
        }
      });
    }

    it('a quoted `"$re"` is read as text: no rows, and the text says so', () => {
      for (const w of ['"$re"', '"${re}"']) {
        const e = explain(`re='^a.c$'\n[[ $1 =~ ${w} ]]\n`, 1);
        assert.strictEqual(valueToken(e), undefined, w);
        assert.match(JSON.stringify(e), /the right side is quoted, so it is literal text, not a regex/);
        assert.ok(allTokens(e.items).some((t) => t.value), w);
      }
    });

    it('is read whatever the value holds: `[[ ]]` neither splits nor globs it', () => {
      for (const re of ['^a b$', '^[A-Z]*$']) {
        const t = valueToken(explain(`re='${re}'\n[[ $1 =~ $re ]]\n`, 1))!;
        assert.ok(t.value!.reading!.tokens.length > 0, re);
        assert.strictEqual(t.value!.reading!.assumes, undefined);
        assert.strictEqual(t.value!.said.readingLead, undefined);
      }
    });

    it('only an exact `$re` or `${re}` is read: a word with other parts is not', () => {
      for (const w of ['$re"x"', '"$re"x', '$re$o', 'x$re', '"$re"', '"${re}"']) {
        assert.strictEqual(valueToken(explain(`re='^a'\no=b\n[[ $1 =~ ${w} ]]\n`, 2)), undefined, w);
      }
      for (const w of ['$re', '${re}']) assert.ok(valueToken(explain(`re='^a'\n[[ $1 =~ ${w} ]]\n`, 1)), w);
    });

    it('is not read where the value is not known', () => {
      for (const src of ['[[ $1 =~ $re ]]\n', 'read -r re\n[[ $1 =~ $re ]]\n', 're=$(cat p)\n[[ $1 =~ $re ]]\n', 'for re in a b; do\n  [[ $1 =~ $re ]]\ndone\n']) {
        assert.strictEqual(valueToken(explain(src, src.split('\n').length - 2)), undefined, src);
      }
    });

    it('an error in the value has the level of the literal, whichever line is explained first', () => {
      const v = explain("re='[a'\n[[ $1 =~ $re ]]\n", 1);
      const l = explain('[[ $1 =~ [a ]]\n', 0);
      assert.deepStrictEqual(valueToken(v)!.value!.reading!.tokens.map(shape), literalRows(l));
      assert.deepStrictEqual(v.notes, l.notes);
      assert.match(v.notes[0], /^ⓧ Error: No `\]` closes this `\[`/);
      // (Where the use may not be reached, both are at a lower level.)
      const src = 'if [ "$1" ]; then exit 1; fi\nre=\'[a\'\n[[ $2 =~ $re ]]\n';
      const tree = parser.parse(src);
      const levels = (first: number[]): string[] => {
        const a = new Analyzer('en');
        for (const n of first) a.explainLine(tree, n, 'bash');
        const e = a.explainLine(tree, 2, 'bash');
        return [...valueToken(e)!.value!.reading!.tokens.flatMap((t) => (t.marks ?? []).map((m) => m.level)), ...e.notes];
      };
      const literal = explain('if [ "$1" ]; then exit 1; fi\n[[ $2 =~ [a ]]\n', 1);
      const regex = allTokens(literal.items).find((t) => t.kind === 'pattern' && t.children.length > 0)!;
      const inRows = allTokens(regex.children).flatMap((t) => (t.marks ?? []).map((m) => m.level));
      assert.deepStrictEqual(levels([]), [...inRows, ...literal.notes]);
      assert.deepStrictEqual(levels([0, 1]), levels([]));
    });

    it('against bash: the variable form and the literal form match the same strings; the quoted form is a string', async () => {
      const lines: string[] = [];
      const cases: { re: string; s: string }[] = [];
      for (const [re, strings] of EREs) {
        for (const s of strings) {
          cases.push({ re, s });
          lines.push(`s='${s}'; re='${re}'; [[ $s =~ $re ]]; a=$?; [[ $s =~ ${re} ]]; b=$?; [[ $s =~ "$re" ]]; c=$?; echo "$a $b $c"`);
        }
      }
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'known-values-re-'));
      try {
        const r = await runContained(['bash', '--norc', '--noprofile', '-c', lines.join('\n')], dir);
        const got = r.stdout.replace(/\n$/, '').split('\n').map((l) => l.split(' '));
        assert.strictEqual(got.length, cases.length);
        for (const [i, [a, b]] of got.entries()) assert.strictEqual(a, b, `${cases[i].re} on ${cases[i].s}`);
        // (Quoted, bash matches the text itself: `a.b` is not found in `axb`.)
        const k = cases.findIndex((c) => c.re === 'a.b' && c.s === 'axb');
        assert.deepStrictEqual(got[k], ['0', '0', '1']);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});

describe('the assignment of a value its uses read in a language (known-values.md, step 5)', function () {
  this.timeout(60000);

  /** The token of the line's first assignment, which says how the uses read its value. */
  const assignmentOf = (e: LineExplanation): Token => allTokens(e.items).find((t) => t.kind === 'assignment')!;
  /** The token of the value of the line's first assignment: the string (or the word) its rows go on. */
  const assigned = (e: LineExplanation): Token => assignmentOf(e).children[0];
  /** What the assignment line `line` of `src` says of its value's uses, after the text it has without them. */
  const said = (src: string, line = 0, lang: 'en' | 'ja' = 'en'): string => assignmentOf(explain(src, line, lang)).explanation.split(' — ').slice(1).join(' — ');

  describe('one use: the rows of the use, placed on the string, and the text naming the command and its line', () => {
    for (const c of CASES) {
      it(c.name, () => {
        const { variable, line } = forms(c, '"$v"');
        const a = assigned(explain(variable, 0));
        const use = valueToken(explain(variable, line))?.value!.reading!.tokens ?? [];
        // (The same tokens as the use's: the reader's, finished as a line's are; no example on the assignment line.)
        assert.deepStrictEqual(a.children.map(shape), use.map(shape), c.name);
        assert.deepStrictEqual(explain(variable, 0).examples, []);
        // (Over the string's characters: inside its quotes.)
        for (const t of a.children) assert.ok(t.span.start.character > a.span.start.character || t.span.start.line > a.span.start.line, c.name);
        assert.match(assignmentOf(explain(variable, 0)).explanation, new RegExp(` — read as .* by \`${c.use.split(' V')[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\`, line ${line + 1}$`), c.name);
      });
    }
  });

  it('several uses with one reading: every line is named; past three, the first three and how many more', () => {
    const uses = (n: number) => "x='^x'\n" + Array.from({ length: n }, (_, i) => `grep -E "$x" f${i}\n`).join('');
    assert.strictEqual(said(uses(2)), 'read as an extended regex (ERE) by `grep -E`, lines 2 and 3');
    assert.strictEqual(said(uses(3)), 'read as an extended regex (ERE) by `grep -E`, lines 2, 3 and 4');
    assert.strictEqual(said(uses(5)), 'read as an extended regex (ERE) by `grep -E`, lines 2, 3, 4 and 2 more');
    assert.strictEqual(said(uses(5), 0, 'ja'), '`grep -E` が拡張正規表現(ERE)として読む（行 2、3、4 ほか 2 行）');
    assert.deepStrictEqual(assigned(explain(uses(5), 0)).children.map((t) => t.label), ['^', 'x']);
    // (Two uses on one line: the line once, and the command as written with each option once.)
    assert.strictEqual(said("k='^k'\ngrep -E -e \"$k\" -e \"$k\" f\n"), 'read as an extended regex (ERE) by `grep -E -e`, line 2');
  });

  it('several uses with one reading in two flavours: the rows, and each use named with its flavour', () => {
    const src = "s='^s'\ngrep -E \"$s\" f\ngrep \"$s\" f\n";
    assert.strictEqual(said(src), 'read as an extended regex (ERE) by `grep -E` (line 2) and as a basic regex (BRE) by `grep` (line 3)');
    assert.deepStrictEqual(assigned(explain(src, 0)).children.map((t) => t.label), ['^', 's']);
  });

  it('several uses with different readings: no rows and no warning, each use named with its flavour', () => {
    const src = "s='^s+'\ngrep \"$s\" f\ngrep -E \"$s\" f\nsed -n \"$s\" f\n";
    const e = explain(src, 0);
    assert.strictEqual(said(src), 'read as a basic regex (BRE) by `grep` (line 2), as an extended regex (ERE) by `grep -E` (line 3) and as a sed script by `sed -n` (line 4)');
    assert.strictEqual(said(src, 0, 'ja'), '`grep` が基本正規表現(BRE)として（行 2）、`grep -E` が拡張正規表現(ERE)として（行 3）、`sed -n` が sed スクリプトとして（行 4）読む');
    assert.deepStrictEqual(assigned(e).children, []);
    assert.deepStrictEqual([e.notes, allTokens(e.items).flatMap((t) => t.marks ?? [])], [[], []]);
  });

  it('a reading with an error: no rows; the text names the line that finds it, and the problem is said once, at the use', () => {
    const src = "re='a[b'\ngrep -E \"$re\" f\n";
    const e = explain(src, 0);
    assert.strictEqual(said(src), '`grep -E` reads it as an extended regex (ERE) on line 2 and finds an error there');
    assert.strictEqual(said(src, 0, 'ja'), '行 2 の `grep -E` は拡張正規表現(ERE)として読み、エラーになる');
    assert.deepStrictEqual([assigned(e).children, e.notes], [[], []]);
    assert.strictEqual(explain(src, 1).notes.length, 1);
    // (One use reads it, another finds an error: both named, no rows.)
    const mixed = "z='(a'\ngrep \"$z\" f\ngrep -E \"$z\" f\n";
    assert.strictEqual(said(mixed), 'read as a basic regex (BRE) by `grep`, line 2; `grep -E` reads it as an extended regex (ERE) on line 3 and finds an error there');
    assert.strictEqual(said(mixed, 0, 'ja'), '`grep` が基本正規表現(BRE)として読む（行 2）。行 3 の `grep -E` は拡張正規表現(ERE)として読み、エラーになる');
    assert.deepStrictEqual(assigned(explain(mixed, 0)).children, []);
  });

  it('a use above the assignment, in a function called after it: a use of it', () => {
    assert.strictEqual(said("search() {\n  grep -E \"$re\" notes.txt\n}\nre='^TODO'\nsearch\n", 3), 'read as an extended regex (ERE) by `grep -E`, line 2');
  });

  it('a use whose state does not carry this assignment\'s word is no use of it: the text order does not decide', () => {
    assert.strictEqual(said("re='^a'\nre='^b'\ngrep -E \"$re\" f\n"), '');
    assert.strictEqual(said("re='^a'\nre='^b'\ngrep -E \"$re\" f\n", 1), 'read as an extended regex (ERE) by `grep -E`, line 3');
    assert.strictEqual(said("grep -E \"$re\" f\nre='^a'\n", 1), '');
    // (Two words on two paths: neither is the origin.)
    assert.strictEqual(said("if [ \"$1\" ]; then re='^a'; else re='^a'; fi\ngrep -E \"$re\" f\n"), '');
  });

  it('uses that read no language, and values read nowhere: the line as it was', () => {
    for (const src of [
      "q='^q'\necho \"$q\"\n",
      "q='^q'\nsudo grep -E \"$q\" f\n",
      "q='^q'\ngrep -E -F \"$q\" f\n",
      "q='^q a'\ngrep -E $q f\n",
      "q='^q'\nf() { :; }\nf \"$q\"\n",
      "q='^q'\n[[ $1 =~ \"$q\" ]]\n",
      "q='^q'\n[[ $q =~ ^a ]]\n",
      "q='^q'\ncase $q in a) ;; esac\n",
      "q='-E'\ngrep \"$q\" x f\n",
    ]) assert.deepStrictEqual(shape(assignmentOf(explain(src, 0))), shape(assignmentOf(explain(src.split('\n')[0] + '\n', 0))), src);
    assert.strictEqual(said("q='^q a'\ngrep -E $q f\n"), '');
    assert.strictEqual(said("q='^q'\nsudo grep -E \"$q\" f\n"), '');
  });

  it('the languages: a yq expression of a subcommand, Perl, escapes, a file mode', () => {
    assert.strictEqual(said("q='.a'\nyq e \"$q\" f.yaml\n"), 'read as a yq expression by `yq e`, line 2');
    assert.strictEqual(said("p='print 1'\nperl -e \"$p\"\n"), 'read as Perl by `perl -e`, line 2');
    assert.strictEqual(said("p='print 1'\nperl -e \"$p\"\n", 0, 'ja'), '`perl -e` が Perl として読む（行 2）');
    assert.strictEqual(said("e='a\\tb'\necho -e \"$e\"\n"), 'read as escapes by `echo -e`, line 2');
    assert.strictEqual(said("m='755'\nchmod \"$m\" f\n"), 'read as a file mode by `chmod`, line 2');
  });

  it('`[[ $x =~ $re ]]`: the ERE bash reads', () => {
    const src = "re='^a+$'\n[[ $1 =~ $re ]]\n";
    assert.strictEqual(said(src), 'read as an extended regex (ERE) by `[[ =~ ]]`, line 2');
    assert.deepStrictEqual(assigned(explain(src, 0)).children.map(shape), valueToken(explain(src, 1))!.value!.reading!.tokens.map(shape));
  });

  it('an unquoted value that globs: read where no file name matches it, as its use says', () => {
    const src = "g='^[A-Z]+$'\ngrep -E $g f\n";
    assert.strictEqual(said(src), 'read as an extended regex (ERE) by `grep -E`, line 2, where no file name matches it');
    assert.strictEqual(said(src, 0, 'ja'), '`grep -E` が拡張正規表現(ERE)として読む（行 2。一致するファイル名がないとき）');
    // (Quoted and unquoted: two readings, the same tokens but not the same assumption.)
    assert.deepStrictEqual(assigned(explain(src + 'grep -E "$g" f\n', 0)).children, []);
  });

  it('a variable bash reads itself keeps bash\'s reading: `PS1`', () => {
    const src = "PS1='\\u@\\h'\ngrep \"$PS1\" f\n";
    const a = assignmentOf(explain(src, 0));
    assert.deepStrictEqual(shape(a), shape(assignmentOf(explain("PS1='\\u@\\h'\n", 0))));
    assert.doesNotMatch(a.explanation, /read as/);
  });

  it('a backslash bash removes: said on the assignment line, where the quotes are', () => {
    const src = 're="a\\\\.b"\ngrep "$re" f\n';
    const a = assigned(explain(src, 0));
    assert.strictEqual(said(src), 'read as a basic regex (BRE) by `grep`, line 2; bash has already removed the backslash: `\\\\` → `\\`');
    assert.deepStrictEqual(a.children.map((t) => t.label), ['a', '\\\\.', 'b']);
    assert.doesNotMatch(argText(explain(src, 1), '"$re"'), /removed the backslash/);
  });

  it('declarations: `readonly`, `declare -r`, `local`, `export`', () => {
    assert.strictEqual(said("readonly RE='^r'\ngrep -E \"$RE\" f\n"), 'read as an extended regex (ERE) by `grep -E`, line 2');
    assert.strictEqual(said("declare -r re='^r'\ngrep -E \"$re\" f\n"), 'read as an extended regex (ERE) by `grep -E`, line 2');
    assert.strictEqual(said("export p='^r'\ngrep -E \"$p\" f\n"), 'read as an extended regex (ERE) by `grep -E`, line 2');
    assert.strictEqual(said("f() {\n  local re='^r'\n  grep -E \"$re\" g\n}\nf\n", 1), 'read as an extended regex (ERE) by `grep -E`, line 3');
  });

  it('a host file: the document\'s line numbers, and each line\'s own shell (Markdown\'s fences)', () => {
    const text = '# T\n\n```bash\nif [ "$1" ]; then exit 1; fi\nre=\'[a\'\n```\n\nText.\n\n```bash\ngrep -E "$re" f\n```\n';
    const levels = (order: number[]): unknown => {
      const doc = openDocument(text, 'markdown', (t) => parser.parse(t));
      const analyzer = new Analyzer('en');
      const out = order.map((l) => explainDocumentLine(analyzer, doc, l, 'en', shellsOf(doc.lines, 'a.md', undefined), {})!);
      const use = out[order.indexOf(10)];
      return { assignment: assignmentOf(out[order.indexOf(4)]).explanation, use: [valueToken(use)!.value!.reading!.tokens.map(shape), use.notes] };
    };
    const first = levels([4, 10]) as { assignment: string; use: [Shape[], string[]] };
    assert.match(first.assignment, / — `grep -E` reads it as an extended regex \(ERE\) on line 11 and finds an error there$/);
    // (The use's fence is a shell of its own: the `exit` of the first one is no stop before it, so the error is the use's line's.)
    assert.match(first.use[1][0], /^ⓧ Error: No `\]` closes this `\[`/);
    assert.deepStrictEqual(levels([10, 4]), first);
  });

  it('the same whichever line is explained first', () => {
    for (const src of [
      "re='^[A-Z][0-9]+$'\ngrep -E \"$re\" ids.txt\ngrep \"$re\" ids.txt\n",
      "s='/^BEGIN/,/^END/p'\nsed -n \"$s\" f\n",
      "if [ \"$1\" ]; then exit 1; fi\nre='[a'\ngrep -E \"$re\" f\n[[ $2 =~ $re ]]\n",
      "search() {\n  grep -E \"$re\" notes.txt\n}\nre='^TODO'\nsearch\n",
    ]) {
      const tree = parser.parse(src);
      const lines = src.split('\n').length - 1;
      const all = (order: number[]): unknown[] => {
        const a = new Analyzer('en');
        const got = new Map(order.map((l) => [l, a.explainLine(tree, l, 'bash')] as const));
        return [...got.keys()].sort().map((l) => { const e = got.get(l)!; return [e.items.map(shape), e.notes, valueToken(e)?.value?.reading?.tokens.map(shape)]; });
      };
      const forward = all([...Array(lines).keys()]);
      assert.deepStrictEqual(all([...Array(lines).keys()].reverse()), forward, src);
    }
  });

  describe('every output shows the rows, as for `PS1`', () => {
    const src = "re='^a+$'\ngrep -E \"$re\" f\n";
    const e = explain(src, 0);
    const t = assigned(e);

    it('the panel: under the string\'s row, as the prompt string\'s', () => {
      const all = (rows: readonly ModelRow[]): ModelRow[] => rows.flatMap((r) => [r, ...all(r.children)]);
      const under = (x: LineExplanation, label: string) => all(rowModel(x, { depth: 2, receives: false }, 'en').rows).find((r) => r.label === label)!.children.map((c) => c.label);
      assert.deepStrictEqual(under(e, "'^a+$'"), ['^', 'a', '+', '$']);
      assert.deepStrictEqual(under(explain("PS1='\\u@\\h'\n", 0), "'\\u@\\h'"), ['\\u', '\\h']);
    });

    it('the hover\'s part card', () => {
      const md = partHover({ ex: e, lang: 'en', theme: 'light', lineText: "re='^a+$'", panelLink: 'x', lineLink: 'y', keys: '', placement: 'first', problems: [] }, partAt(e.items, { line: 0, character: t.span.start.character + 1 }));
      // (The card of the first row of the reading, under the assignment's, whose text the title of its crumb holds.)
      assert.match(md, /title="Assign a value to variable re \(no spaces around =\) — read as an extended regex \(ERE\) by grep -E, line 2"/);
      assert.match(md, /start of the line/);
    });

    it('Markdown', () => {
      assert.match(toPlainMarkdown(e, "re='^a+$'", 'x'), /read as an extended regex \(ERE\) by `grep -E`, line 2[^\n]*\n {2}- `'\^a\+\$'` — [^\n]*\n {4}- `\^` — start of the line/);
    });

    it('the CLI and JSON', async () => {
      const run = async (...args: string[]): Promise<string> => {
        let out = '';
        await main(['--no-config', ...args, '-e', src], { stdout: (s) => { out += s; }, stderr: () => {}, env: {}, isTTY: false });
        return out;
      };
      assert.match(await run('--no-color', '--line', '1'), /read as an extended regex \(ERE\) by grep -E, line 2 [^\n]*\n[^\n]*'\^a\+\$'[^\n]*\n +\^ +start of the line/);
      const json = JSON.parse(await run('--format', 'json', '--line', '1'));
      assert.match(JSON.stringify(json), /"explanation":"Assign a value to variable `re` \(no spaces around `=`\) — read as an extended regex \(ERE\) by `grep -E`, line 2"/);
      assert.match(JSON.stringify(json), /"label":"'\^a\+\$'"[^\]]*"children":\[\{"kind":"keyword","label":"\^"/);
    });
  });
});
