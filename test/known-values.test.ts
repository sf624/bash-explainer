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
});
