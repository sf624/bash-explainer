import * as assert from 'assert';
import { run } from './support/run';
import { tokensOf } from './support/explain';

/**
 * What `^` and `$` stand at the ends of, per tool, against the real tool: a line (grep, sed) or a whole string that may
 * hold a newline (bash's `=~`, awk, Perl without `/m`). Each row is one command line with the regex `RE` in it; the
 * line is explained and, with `RE` filled in, run with a value (`$V` for the tools that match a string, else stdin).
 */
interface Row {
  tool: string;
  /** The command line. */
  line: string;
  /** The text fed to stdin, for the tools that read lines. */
  stdin?: (value: string) => string;
  /** Whether the run matched. */
  matched: (r: ReturnType<typeof run>) => boolean;
  /** A tool the row needs besides bash: without it the row is skipped, not taken for "no match". */
  needs?: string;
}

const ok = (r: ReturnType<typeof run>) => r.status === 0;
const printed = (r: ReturnType<typeof run>) => r.stdout.length > 0;
const replaced = (r: ReturnType<typeof run>) => r.stdout.includes('x');
const lines = (v: string) => (v.endsWith('\n') ? v : v + '\n');

const rows: Row[] = [
  { tool: 'bash [[ =~ ]]', line: '[[ $V =~ RE ]]', matched: ok },
  { tool: 'gawk match()', line: `gawk 'BEGIN { exit !match(ENVIRON["V"], /RE/) }'`, matched: ok },
  { tool: 'gawk ~', line: `gawk 'BEGIN { exit !(ENVIRON["V"] ~ /RE/) }'`, matched: ok },
  { tool: 'gawk rule', line: `gawk -v 'RS=\\0' '/RE/ { f = 1 } END { exit !f }'`, stdin: (v) => v, matched: ok },
  { tool: 'mawk ~', line: `mawk 'BEGIN { exit !(ENVIRON["V"] ~ /RE/) }'`, matched: ok, needs: 'mawk' },
  { tool: 'perl', line: `perl -e '$_ = $ENV{V}; print 1 if /RE/'`, matched: printed },
  { tool: 'perl /m', line: `perl -e '$_ = $ENV{V}; print 1 if /RE/m'`, matched: printed },
  { tool: 'perl s///', line: `perl -e '$_ = $ENV{V}; s/RE/x/; print'`, matched: replaced },
  { tool: 'perl s///m', line: `perl -e '$_ = $ENV{V}; s/RE/x/m; print'`, matched: replaced },
  // An inline (?m) switches to lines from where it stands (and `(?-m)` back).
  { tool: 'perl (?m)', line: `perl -e '$_ = $ENV{V}; print 1 if /(?m)RE/'`, matched: printed },
  { tool: 'perl (?m:…)', line: `perl -e '$_ = $ENV{V}; print 1 if /(?m:RE)/'`, matched: printed },
  { tool: 'perl /m (?-m)', line: `perl -e '$_ = $ENV{V}; print 1 if /(?-m)RE/m'`, matched: printed },
  { tool: 'grep -P (?m)', line: `grep -qP '(?m)RE'`, stdin: lines, matched: ok },
  { tool: 'grep -zP (?m)', line: `grep -zqP '(?m)RE'`, stdin: (v) => v + '\0', matched: ok },
  { tool: 'grep -zP', line: `grep -zqP 'RE'`, stdin: (v) => v + '\0', matched: ok },
  { tool: 'grep', line: `grep -q 'RE'`, stdin: lines, matched: ok },
  { tool: 'grep -E', line: `grep -qE 'RE'`, stdin: lines, matched: ok },
  { tool: 'grep -z', line: `grep -zq 'RE'`, stdin: (v) => v + '\0', matched: ok },
  { tool: 'sed', line: `sed -n '/RE/{p;q}'`, stdin: lines, matched: printed },
  { tool: 'sed -z', line: `sed -zn '/RE/{p;q}'`, stdin: (v) => v + '\0', matched: printed },
];

const row = (tool: string): Row => rows.find((r) => r.tool === tool)!;

/** The explanation of the `^` or `$` token of the line with `RE` filled in as the regex `re`. */
function wording(line: string, re: string, lang: 'en' | 'ja' = 'en'): string {
  const t = tokensOf(line.replace('RE', re), 0, lang).find((x) => x.origin === 'embedded' && (re[0] === '^' ? /^(start of|(行|文字列|レコード（`\$0`）)の先頭)/ : /^(end of|(行|文字列|レコード（`\$0`）)の末尾)/).test(x.explanation));
  assert.ok(t, `no anchor token in ${line}`);
  return t.explanation;
}

function matches(row: Row, re: string, value: string): boolean {
  const r = run('bash', ['-c', row.line.replace('RE', re)], { env: { ...process.env, V: value }, input: row.stdin ? row.stdin(value) : '' });
  // (A status other than 0 or 1 is a tool that failed or is missing, not "no match".)
  assert.ok(r.status === 0 || r.status === 1, `${row.tool}: status ${r.status}: ${r.stderr}`);
  return row.matched(r);
}

describe('^ and $ say what the tool matches them against', () => {
  for (const row of rows) {
    it(row.tool, function () {
      if (row.needs && run('bash', ['-c', `command -v ${row.needs}`], { ignoreStderr: true }).status !== 0) this.skip();
      // `a\n1`: both anchors match inside it only where the unit is a line.
      const inner = [matches(row, '^1', 'a\n1'), matches(row, 'a$', 'a\n1')];
      assert.strictEqual(inner[0], inner[1], 'the real tool treats both anchors alike');
      const startWords = wording(row.line, '^1');
      const endWords = wording(row.line, 'a$');
      if (inner[0]) {
        assert.match(startWords, /start of the line/);
        assert.match(endWords, /end of the line/);
      } else {
        assert.match(startWords, /start of the text/);
        // `$` also stands before a final newline in Perl.
        const final = matches(row, 'a$', 'a\n');
        assert.match(endWords, final ? /end of the text \(or before a final newline\)/ : /end of the text(?! \(or)/);
      }
    });
  }

  it('names the record where a rule matches it', () => {
    assert.strictEqual(wording(`awk '/RE/'`, '^1'), 'start of the text (the record, `$0`)');
    assert.strictEqual(wording(`awk '/RE/'`, 'a$'), 'end of the text (the record, `$0`)');
    assert.strictEqual(wording(`awk '/RE/'`, '^1', 'ja'), 'レコード（`$0`）の先頭');
    assert.strictEqual(wording(`awk '$1 ~ /RE/'`, '^1'), 'start of the text');
  });

  it('reads an inline (?m) from where it stands, to the end of its group', () => {
    const w = (re: string) => tokensOf(`grep -zP '${re}'`).filter((x) => x.origin === 'embedded' && /^(start|end) of/.test(x.explanation)).map((x) => x.explanation);
    assert.deepStrictEqual(w('^a(?m)^b$'), ['start of the text', 'start of the line', 'end of the line']);
    assert.deepStrictEqual(w('(?:(?m)^a)^b'), ['start of the line', 'start of the text']);
    assert.deepStrictEqual(w('(?m)^a(?-m)^b'), ['start of the line', 'start of the text']);
    assert.deepStrictEqual(w('(?i-m)^a'), ['start of the text']);
  });

  it('says what the flag M does under sed -z (sed 4.9 matches at no newline there)', () => {
    const m = (line: string) => tokensOf(line).find((x) => /^multi-line mode/.test(x.explanation))!.explanation;
    assert.match(m(`sed 's/^/x/M'`), /match at each line/);
    assert.match(m(`sed -z 's/^/x/M'`), /match at no newline/);
    const real = run('sed', ['-z', 's/^/x/Mg'], { input: 'a\nb\0', check: true }).stdout.toString();
    assert.strictEqual(real, 'xa\nb\0');
  });

  it('says it in Japanese too', () => {
    assert.match(wording(row('bash [[ =~ ]]').line, '^1', 'ja'), /文字列の先頭/);
    assert.match(wording(row('bash [[ =~ ]]').line, 'a$', 'ja'), /文字列の末尾$/);
    assert.match(wording(row('perl').line, 'a$', 'ja'), /文字列の末尾（末尾の改行の前も可）/);
    assert.match(wording(row('grep').line, 'a$', 'ja'), /行の末尾/);
  });
});
