import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { run } from './support/run';
import { Analyzer, type Token } from '../src/analyzer';
import { explainHostedLine, extractShell } from '../src/hosts';
import { sourceIndex } from '../src/staticword';
import { createUnbashParser } from '../src/syntax/adapters/unbash';

// A word in double quotes (or with a backslash, unquoted) gives the command a text of its own: bash takes away the
// backslash before `$`, a backtick, `"`, `\` and a newline (manual 3.1.2.3), and keeps the others (`\1`, `\.`, `\d`).
// The embedded readers (sed, awk, grep, perl…) read that text, so a line reads as the single-quoted line with the
// same value reads (same tokens, same worked example), with its tokens over the source (`\$` is one character of text
// from two of source).

interface Row {
  /** The line, with `{}` where the word is. */
  line: string;
  /** The word as written (in the line), in a string of its own so that bash gives its value. */
  word: string;
  /** The worked example runs on a file `f` and prints what the real tool prints. */
  real?: 'output' | 'grep';
  /** The word is not one string with a backslash in it: the tokens may lie anywhere between the parts. */
  mixed?: true;
  /** The line has another word in a language (the awk program): its tokens lie elsewhere in the line. */
  other?: true;
}

const R = String.raw;
const rows: Row[] = [
  { line: 'sed -E {} f', word: R`"s/(a)/\1/g"`, real: 'output' },
  { line: 'sed {} f', word: R`"s/\./x/"`, real: 'output' },
  { line: 'sed {} f', word: R`"s/a/\$/"`, real: 'output' },
  { line: 'sed {} f', word: R`"s/a/b\$/"`, real: 'output' },
  { line: 'sed -E {} f', word: R`"s#^//([^:]*):#\1/#; s#^/##"`, real: 'output' },
  { line: 'sed -e {} f', word: R`"s/\./x/"`, real: 'output' },
  { line: 'sed --expression={} f', word: R`"s/\./x/"`, real: 'output' },
  { line: 'sed -E {} f', word: R`"s/(a+)/<\\1>/"`, real: 'output' },
  { line: 'sed -E {} f', word: R`'s/(a)/'"\1"'/'`, real: 'output', mixed: true },
  { line: 'sed -E {} f', word: R`"s/(a)\"b/\1/"`, real: 'output' },
  { line: 'sed -E {} f', word: R`s/\(a\)/\\1/`, real: 'output' },
  { line: 'grep {} f', word: R`"a\.b"`, real: 'grep' },
  { line: 'grep {} f', word: R`"a\\.b"`, real: 'grep' },
  { line: 'grep -E {} f', word: R`"a\.b"`, real: 'grep' },
  { line: 'grep -e {} f', word: R`"a\.b"`, real: 'grep' },
  { line: 'grep --regexp={} f', word: R`"a\.b"`, real: 'grep' },
  { line: 'grep -E {} f', word: R`"^(a|b)\$"`, real: 'grep' },
  { line: 'grep {} f', word: R`a\.b`, real: 'grep' },
  { line: 'awk {} f', word: R`"{print \$1}"`, real: 'output' },
  { line: 'awk {} f', word: R`"/a\.b/ {print}"`, real: 'output' },
  { line: 'awk {} f', word: R`"{ print \"x\" \$2 }"`, real: 'output' },
  { line: 'sed {} f', word: R`"s/\//_/g"`, real: 'output' },
  { line: 'grep {} f', word: R`"\.txt$"`, real: 'grep' },
  { line: 'awk -F {} \'{print $1}\' f', word: R`"\t"`, other: true },
  { line: 'awk -v {} \'{print $1,$2}\' f', word: R`OFS="\t"`, mixed: true, other: true },
  { line: 'git log --pretty={}', word: R`format:"%h\t%s"`, mixed: true },
  { line: 'sed {} f', word: R`$"s/\./x/"`, real: 'output' },
  { line: 'awk {} f', word: R`\$1`, real: 'output' },
  { line: 'awk {} f', word: R`\{print\ \$2\}`, real: 'output' },
  { line: 'grep {} f', word: R`a\😀b`, real: 'grep' },
  { line: 'sed {} f', word: R`"\$a\\"` },
  { line: 'sed -e {} -e new f', word: R`"1c\\"`, other: true },
  { line: 'sed {} f', word: R`1c\\` },
  { line: 'perl -pe {} f', word: R`"s/\d/x/"`, real: 'output' },
  { line: 'tr -d {}', word: R`"\n"` },
  { line: 'printf {} a', word: R`"%s\n"` },
  { line: 'echo -e {}', word: R`"a\n"` },
  { line: 'echo -e {}', word: R`"a\\nb"` },
  { line: 'date {}', word: R`+"%F\n"`, mixed: true },
  { line: 'jq {} f', word: R`".a | \"v: \\(.)\""` },
  { line: 'find . -name {}', word: R`\*.py` },
];

const parser = createUnbashParser();
const analyzer = new Analyzer('en');

/** The value of each word, as bash gives it: one process for all of them. */
const values = ((): string[] => {
  const script = rows.map((r) => `printf '%s\\0' ${r.word}`).join('\n');
  const out = run('bash', ['-c', script], { check: true }).stdout.toString();
  return out.split('\0').slice(0, -1);
})();

const fill = (line: string, word: string): string => line.replace('{}', () => word);
const single = (row: Row, value: string): string => fill(row.line, `'${value}'`);

/** The tokens read by an embedded reader, with their depth. */
function embeddedTokens(line: string): { token: Token; depth: number }[] {
  const out: { token: Token; depth: number }[] = [];
  const walk = (t: Token, depth: number): void => {
    if (t.origin === 'embedded') out.push({ token: t, depth });
    t.children.forEach((c) => walk(c, depth + 1));
  };
  analyzer.explainLine(parser.parse(line), 0).items.forEach((t) => walk(t, 0));
  return out;
}

const examplesOf = (line: string) => analyzer.explainLine(parser.parse(line), 0).examples.map(({ title, kind, sections }) => ({ title, kind, sections }));

describe('a word with escapes is read as bash gives it to the command', () => {
  rows.forEach((row, i) => {
    const value = values[i];
    const dq = fill(row.line, row.word);
    it(`${dq}   (the command gets ${JSON.stringify(value)})`, () => {
      assert.ok(!value.includes("'"), 'a row whose value has no single quote');
      const a = embeddedTokens(dq);
      const b = embeddedTokens(single(row, value));
      assert.ok(a.length > 0, 'the text is read');
      // The same tokens (kind, meaning, nesting) and the same worked example as for the single-quoted word of that value.
      // (A word of its own is under the string token of its quotes, and the text a hover names is as written: `\\1` for the `\1` of text.)
      const shape = (xs: typeof a) => xs.map(({ token, depth }) => [depth - xs[0].depth, token.kind, token.explanation.replace(/^`[^`]*`: /, '')]);
      assert.deepStrictEqual(shape(a), shape(b));
      assert.deepStrictEqual(examplesOf(dq), examplesOf(single(row, value)));
      // Every token lies inside the line at the source text it names, and cuts no escape in two.
      const word = dq.indexOf(row.word);
      const wordEnd = word + row.word.length;
      const cuts = new Set<number>();
      if (!row.mixed) for (const m of row.word.matchAll(row.word.startsWith('"') ? /\\[$`"\\\n]/g : /\\[^]/g)) cuts.add(word + m.index + 1);
      for (const { token } of a) {
        const { start, end } = token.span;
        // (A token of no width at the end of the text, as the empty text of `sed '$a\\'`, stands there: no position is NaN or missing.)
        for (const n of [start.line, start.character, end.line, end.character]) assert.ok(Number.isInteger(n), `${token.label}: ${JSON.stringify(token.span)}`);
        assert.strictEqual(start.line, 0);
        assert.strictEqual(end.line, 0);
        assert.ok(word <= start.character && start.character <= end.character && end.character <= (row.other ? dq.length : wordEnd), `${token.label} (${start.character}-${end.character}) is in the word`);
        assert.ok(!cuts.has(start.character) && !cuts.has(end.character), `${token.label} (${start.character}-${end.character}) keeps an escape whole`);
      }
    });
  });

  it('puts the token over the whole escape: `\\$1`, not `$1`', () => {
    const line = R`awk "{print \$1}" f`;
    const t = embeddedTokens(line).find(({ token }) => token.kind === 'variable')!.token;
    assert.deepStrictEqual([t.label, t.span.start.character, t.span.end.character], [R`\$1`, 12, 15]);
    assert.strictEqual(line.slice(12, 15), R`\$1`);
    const dash = embeddedTokens(R`grep "a\\.b" f`).find(({ token }) => token.label === R`\\.`)!.token;
    assert.deepStrictEqual([dash.span.start.character, dash.span.end.character], [7, 10]);
  });

  it('leaves out a backslash and a newline, which bash removes', () => {
    const line = 'sed "s/a/\\\nb/" f';
    assert.strictEqual(run('bash', ['-c', `printf %s ${line.slice(4, -2)}`], { check: true }).stdout.toString(), 's/a/b/');
    const where = (t: Token): string => `${t.label}@${t.span.start.line}:${t.span.start.character}-${t.span.end.line}:${t.span.end.character}`;
    assert.deepStrictEqual(embeddedTokens(line).map(({ token }) => where(token)), [
      's/a/\\ …@0:5-1:2', 's@0:5-0:6', '/@0:6-0:7', 'a@0:7-0:8', 'a@0:7-0:8', '/@0:8-0:9', 'b@1:0-1:1', '/@1:1-1:2',
    ]);
    assert.deepStrictEqual(examplesOf(line), examplesOf("sed 's/a/b/' f"));
  });

  it('puts a token of no width at the end of the text where the text ends, where the single-quoted word has it', () => {
    const where = (line: string): string[] => embeddedTokens(line).filter(({ token }) => token.span.start.character === token.span.end.character).map(({ token }) => `${JSON.stringify(token.label)}@${token.span.start.character}`);
    // (`$a\` is `\$a\\` in six characters of source: the end of the text is after the last of them.)
    assert.deepStrictEqual(where(R`sed "\$a\\" f`), ['""@10']);
    assert.deepStrictEqual(where(R`sed '$a\' f`), ['""@8']);
    assert.deepStrictEqual(where(R`sed -e "1c\\" -e new f`), ['""@12']);
    assert.deepStrictEqual(where(R`sed -e 1c\\ -e new f`), ['""@11']);
  });

  it('gives the same positions in a Dockerfile, in JSON and in the panel', () => {
    const src = 'FROM x\nRUN sed "\\$a\\\\" f\n';
    const extracted = extractShell('dockerfile', src)!;
    const e = explainHostedLine(analyzer, parser.parse(extracted.text), extracted, src.split('\n'), 1, 'en')!;
    const all: Token[] = [];
    const walk = (t: Token): void => (all.push(t), t.children.forEach(walk));
    e.items.forEach(walk);
    assert.ok(all.some((t) => t.origin === 'embedded'));
    for (const t of all) for (const n of [t.span.start.line, t.span.start.character, t.span.end.line, t.span.end.character]) assert.ok(Number.isInteger(n), `${t.label}: ${JSON.stringify(t.span)}`);
    assert.ok(!JSON.stringify(e.items).includes('null'));
  });
});

describe('sourceIndex', () => {
  it('maps a character, and an end, over escapes', () => {
    const lit = { text: 'a$', offsets: [1, 2], ends: [2, 4] };
    assert.deepStrictEqual([sourceIndex(lit, 0, false), sourceIndex(lit, 1, false), sourceIndex(lit, 1, true), sourceIndex(lit, 2, true)], [1, 2, 2, 4]);
  });
  it('puts an offset past the text where the text ends, and an end at 0 where it starts', () => {
    const lit = { text: 'a$', offsets: [1, 2], ends: [2, 4] };
    assert.deepStrictEqual([sourceIndex(lit, 2, false), sourceIndex(lit, 0, true)], [4, 1]);
  });
  it('takes a character of one unit of source where there are no ends', () => {
    const lit = { text: 'ab', offsets: [3, 5] };
    assert.deepStrictEqual([sourceIndex(lit, 1, true), sourceIndex(lit, 2, true), sourceIndex(lit, 2, false)], [4, 6, 6]);
    assert.strictEqual(sourceIndex({ text: 'ab', base: 2 }, 1, false), 3);
  });
});

describe('the explanation says what bash took away, once per word', () => {
  const argument = (line: string, lang: 'en' | 'ja' = 'en'): Token => {
    const found: Token[] = [];
    const walk = (t: Token): void => (t.kind === 'argument' && t.origin !== 'embedded' ? found.push(t) : undefined, t.children.forEach(walk));
    new Analyzer(lang).explainLine(parser.parse(line), 0).items.forEach(walk);
    return found[0];
  };
  const said = (t: Token): number => t.explanation.split('has already removed').length - 1;

  it('names each escape of the word, and what is left', () => {
    assert.strictEqual(argument(R`awk "{print \$1}" f`).explanation, 'awk program (`pattern { action }`) — bash has already removed the backslash: `\\$` → `$`');
    assert.strictEqual(argument(R`grep "a\\.b" f`).explanation, 'search pattern (regex) — basic regex (BRE); bash has already removed the backslash: `\\\\` → `\\`');
    // (Once for the word, with each escape in it.)
    assert.strictEqual(argument(R`sed "s/a\\\$b\$/x/" f`).explanation, 'sed script (e.g. `s/foo/bar/g` replaces all foo with bar) — bash has already removed the backslash: `\\\\` → `\\`, `\\$` → `$`');
  });

  it('says it in Japanese too', () => {
    assert.strictEqual(argument(R`awk "{print \$1}" f`, 'ja').explanation, 'awk プログラム（`パターン { アクション }`） — 先にシェルがバックスラッシュを取り除いている: `\\$` → `$`');
  });

  it('closes a code span around a backtick, and keeps a character outside the BMP whole', () => {
    assert.strictEqual(argument(R`sed "s/a/\`/" f`).explanation, 'sed script (e.g. `s/foo/bar/g` replaces all foo with bar) — bash has already removed the backslash: `` \\` `` → `` ` ``');
    assert.strictEqual(argument(R`grep a\😀b f`).explanation, 'search pattern (regex) — basic regex (BRE); bash has already removed the backslash: `\\😀` → `😀`');
  });

  it('says nothing where the backslash stays', () => {
    for (const line of [R`sed -E "s/(a)/\1/" f`, R`grep "a\.b" f`, R`perl -pe "s/\d/x/" f`, "sed 's/a/b/' f"]) assert.strictEqual(said(argument(line)), 0, line);
  });

  it('says nothing of the escapes of $\'…\', which are not a backslash taken away', () => {
    // (`PS1=$'\n\$ '` is a newline and `\$ `: the `\$` keeps its backslash, for the prompt to read.)
    for (const line of [R`PS1=$'\n\$ '`, R`PS1=$'\e[1m\u\e[0m\$ '`]) {
      const all: Token[] = [];
      const walk = (t: Token): void => (all.push(t), t.children.forEach(walk));
      analyzer.explainLine(parser.parse(line), 0).items.forEach(walk);
      assert.deepStrictEqual(all.filter((t) => t.explanation.includes('has already removed')), [], line);
    }
  });

  it('says it of an assignment too, in words that fit', () => {
    const all: Token[] = [];
    const walk = (t: Token): void => (all.push(t), t.children.forEach(walk));
    analyzer.explainLine(parser.parse(R`PS1="\u\$ "`), 0).items.forEach(walk);
    const said = all.filter((t) => t.explanation.includes('has already removed'));
    assert.strictEqual(said.length, 1);
    // (After what the prompt string says of its own: one sentence that fits an assignment as it fits a command.)
    assert.ok(said[0].explanation.endsWith('; bash has already removed the backslash: `\\$` → `$`'), said[0].explanation);
  });

  it('says what an unquoted backslash does', () => {
    assert.strictEqual(argument(R`grep a\.b f`).explanation, 'search pattern (regex) — basic regex (BRE); bash has already removed the backslash: `\\.` → `.`');
    assert.strictEqual(argument(R`awk \$1 f`).explanation, 'awk program (`pattern { action }`) — bash has already removed the backslash: `\\$` → `$`');
  });
});

describe('the example of a comparison shows values that make it true and false in bash', () => {
  const lines = [R`[ "$x" = "\$y" ]`, R`[ "$x" = "a\`b" ]`, R`[ "$x" = '$y' ]`, R`[ "$x" = 'a"b' ]`, R`[[ "$x" == "a\\b" ]]`];
  for (const line of lines) {
    it(line, () => {
      const ex = analyzer.explainLine(parser.parse(line), 0).examples.find((x) => x.kind === 'test')!;
      assert.ok(ex, 'has an example');
      for (const sec of ex.sections) {
        const want = sec.label === 'True when' ? 0 : 1;
        assert.ok(sec.lines.length > 0);
        for (const assignment of sec.lines) assert.strictEqual(run('bash', ['-c', `${assignment}; ${line}`]).status, want, `${assignment}; ${line}`);
      }
    });
  }
});

describe('the worked example of a word with escapes agrees with the real tool', () => {
  rows.forEach((row, i) => {
    if (!row.real) return;
    const dq = fill(row.line, row.word);
    it(dq, () => {
      const ex = analyzer.explainLine(parser.parse(dq), 0).examples.find((x) => x.kind === 'sed' || x.kind === 'awk' || x.kind === 'regex' || x.kind === 'perl' || x.kind === undefined);
      assert.ok(ex, 'has an example');
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explain-bash-quoted-'));
      try {
        const lines = (label: RegExp): string[] => ex.sections.find((s) => label.test(s.label))!.lines;
        if (row.real === 'output') {
          const input = lines(/^Input/);
          fs.writeFileSync(path.join(dir, 'f'), input.join('\n') + '\n');
          const printed = run('bash', ['-c', dq], { cwd: dir }).stdout.toString();
          assert.strictEqual(printed, lines(/^Output/).map((l) => l + '\n').join(''), `the command gets ${JSON.stringify(values[i])}`);
        } else {
          const matching = lines(/^Matching/);
          const other = lines(/^Non-matching/);
          fs.writeFileSync(path.join(dir, 'f'), [...matching, ...other].join('\n') + '\n');
          const printed = run('bash', ['-c', dq], { cwd: dir }).stdout.toString();
          assert.strictEqual(printed, matching.map((l) => l + '\n').join(''), `the command gets ${JSON.stringify(values[i])}`);
        }
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});
