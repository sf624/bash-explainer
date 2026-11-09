// A regex its program refuses is an Error of the line (src/messages-tokens-regex.ts): grep, sed, awk and Perl stop with an error,
// and bash's `[[ =~ ]]` gives status 2, every time. Each row is run by the real program: an Error we say must be one it refuses,
// and a pattern it takes must give none. A pattern it refuses that we say nothing of is listed as such (`refused` without `id`).
import * as assert from 'assert';
import { spawnSync } from 'child_process';
import { documentIssues } from '../src/document';
import { openDocument, shellsOf } from '../src/document-setup';
import { explainRegex } from '../src/embedded/regex';
import { explainSed } from '../src/embedded/sed';
import { plainOf } from '../src/messages-levels';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { allTokens, tokensOf } from './support/explain';
import { run } from './support/run';

const parser = createUnbashParser();

type Program = 'grep -G' | 'grep -E' | 'grep -P' | 'sed' | 'sed -E' | 'gawk' | 'mawk' | 'perl' | 'bash';

/** The line that runs `text` with `program`, on no input: the same line is explained and run. */
const LINES: Record<Program, (text: string) => string> = {
  'grep -G': (t) => `grep -G '${t}' /dev/null`,
  'grep -E': (t) => `grep -E '${t}' /dev/null`,
  'grep -P': (t) => `grep -P '${t}' /dev/null`,
  sed: (t) => `sed -n '${t}' /dev/null`,
  'sed -E': (t) => `sed -E -n '${t}' /dev/null`,
  gawk: (t) => `gawk '${t}' /dev/null`,
  mawk: (t) => `mawk '${t}' /dev/null`,
  perl: (t) => `perl -ne '${t}' /dev/null`,
  bash: (t) => `[[ x =~ ${t} ]]`,
};

/** Whether the program refused the text, from its exit status (grep: 2; bash's `[[ ]]`: 2; sed, awk, perl: not 0). */
const REFUSES: Record<Program, (status: number) => boolean> = {
  'grep -G': (s) => s === 2, 'grep -E': (s) => s === 2, 'grep -P': (s) => s === 2, bash: (s) => s === 2,
  sed: (s) => s !== 0, 'sed -E': (s) => s !== 0, gawk: (s) => s !== 0, mawk: (s) => s !== 0, perl: (s) => s !== 0,
};

/** [program, text, whether the program refuses it, the Error we say]. */
const ROWS: [Program, string, boolean, string?][] = [
  ['grep -G', '[a', true, 'regex-bracket-unclosed'],
  ['grep -G', '[[:alpha:]', true, 'regex-bracket-unclosed'],
  ['grep -G', '[]', true, 'regex-bracket-unclosed'],
  ['grep -G', '[]a]', false],
  ['grep -G', '[a\\]', false],
  ['grep -G', 'a\\', true, 'regex-trailing-backslash'],
  ['grep -G', '\\(a', true, 'regex-group-unclosed'],
  ['grep -G', '(a', false],
  ['grep -G', 'a\\{', true, 'regex-interval-incomplete'],
  ['grep -G', 'a\\{x\\}', true, 'regex-interval-incomplete'],
  ['grep -G', 'a\\{\\}', true, 'regex-interval-incomplete'],
  ['grep -G', 'a\\{1', true, 'regex-interval-incomplete'],
  ['grep -G', '.\\{', true, 'regex-interval-incomplete'],
  ['grep -G', 'a*\\{', true, 'regex-interval-incomplete'],
  // (GNU grep reads a `\{` with nothing before it to repeat as the character: at the start, after `^`, `\(`, `\|` or an anchor.)
  ['grep -G', '\\{', false],
  ['grep -G', '\\{1\\}', false],
  ['grep -G', '^\\{', false],
  ['grep -G', '\\(\\{\\)', false],
  ['grep -G', 'a\\|\\{', false],
  ['grep -G', '\\<\\{', false],
  ['grep -G', 'x\\{,\\}', false],
  ['grep -G', 'a\\{1,2\\}', false],
  ['grep -G', 'a\\{2,1\\}', true],
  ['grep -E', '[a', true, 'regex-bracket-unclosed'],
  ['grep -E', '(a', true, 'regex-group-unclosed'],
  ['grep -E', 'a(', true, 'regex-group-unclosed'],
  ['grep -E', '((a)', true, 'regex-group-unclosed'],
  ['grep -E', '\\(a', false],
  ['grep -E', 'a\\', true, 'regex-trailing-backslash'],
  ['grep -E', 'a{', false],
  ['grep -E', 'a{x}', false],
  ['grep -E', 'a{}', true],
  ['grep -P', '[a', true, 'regex-bracket-unclosed'],
  ['grep -P', '[a\\]', true, 'regex-bracket-unclosed'],
  ['grep -P', '(a', true, 'regex-group-unclosed'],
  ['grep -P', '(?:a', true, 'regex-group-unclosed'],
  ['grep -P', '(?<n>a', true, 'regex-group-unclosed'],
  ['grep -P', 'a\\', true, 'regex-trailing-backslash'],
  ['grep -P', '[\\d-z]', true, 'regex-pcre-range-set'],
  ['grep -P', '[a-z\\d]', false],
  ['grep -P', '\\q', true, 'regex-pcre-unknown-escape'],
  ['grep -P', '\\U', true, 'regex-pcre-case-escape'],
  ['grep -P', '\\N', false],
  ['grep -P', 'a)', true],
  ['sed', 's/[/]/x/', false],
  ['sed', '/[/]/p', false],
  ['sed', 's/[]/]/x/', false],
  ['sed', 's/[^/]/x/', false],
  ['sed', 's/[[:alpha:]/]/x/', false],
  ['sed', 's/[[.].]/]/x/', false],
  ['sed', 's/[\\]/x/', false],
  ['sed', 's/\\(a/x/', true, 'regex-group-unclosed'],
  ['sed', 's/a\\{/x/', true, 'regex-interval-incomplete'],
  ['sed', 's/\\{1\\}/x/', true, 'regex-interval-nothing-before'],
  ['sed', 's/^\\{/x/', true, 'regex-interval-nothing-before'],
  ['sed', 's/\\<\\{/x/', true, 'regex-interval-nothing-before'],
  ['sed', 's/x\\{,\\}/y/', false],
  // (sed reads a bracket expression to its end: one that is not closed leaves the command unterminated, which the sed reader says.)
  ['sed', 's/[a/x/', true],
  ['sed -E', 's/(a/x/', true, 'regex-group-unclosed'],
  ['sed -E', 's/[]/]/x/', false],
  ['sed -E', 's/a{/x/', true],
  ['gawk', '/[a/', true, 'regex-bracket-unclosed'],
  ['gawk', '/(a/', true, 'regex-group-unclosed'],
  ['gawk', '/a\\/', true, 'regex-trailing-backslash'],
  ['gawk', '/[/]/', false],
  ['gawk', '/a)/', false],
  ['mawk', '/[a/', true, 'regex-bracket-unclosed'],
  ['mawk', '/(a/', true, 'regex-group-unclosed'],
  ['perl', '/[a/', true, 'regex-bracket-unclosed'],
  ['perl', '/(a/', true, 'regex-group-unclosed'],
  ['perl', 's/(a/x/', true, 'regex-group-unclosed'],
  // (Perl takes a "-" next to a set as a member, and an unknown letter or a case escape as its own: grep -P refuses them.)
  ['perl', '/[\\d-z]/', false],
  ['perl', '/\\q/', false],
  ['perl', '/\\Ua/', false],
  // (Perl puts the value of a variable in before it reads the regex: `]` or `)` may come from it.)
  ['perl', 'BEGIN { $x = "]"; exit("a" =~ /[a$x/ ? 0 : 1) }', false],
  ['perl', 'BEGIN { $x = ")"; exit("a" =~ /(a$x/ ? 0 : 1) }', false],
  ['perl', 'BEGIN { @x = ("]"); exit("a" =~ /[a@x/ ? 0 : 1) }', false],
  ['bash', 'a[', true, 'regex-bracket-unclosed'],
  ['bash', '[a', true, 'regex-bracket-unclosed'],
  ['bash', 'a\\(', false],
  ['bash', '^[a-z]+$', false],
  // (A right side of parts is one regex: a quoted part, or the value of an expansion, may close what another opens. The run sets
  // `a=jpg b=png chars=abc y=]`; the explanation knows none of them.)
  ['bash', '^("jpg"|"png")$', false],
  ['bash', '^($a|$b)$', false],
  ['bash', '^(${a}|foo)$', false],
  ['bash', '^[$chars]+$', false],
  ['bash', '[a$y', false],
  ['bash', '^[a-z" "]+$', false],
  ['bash', "^[^' ']+$", false],
  ['bash', '["a"]', false],
  ['bash', '[a"b"]', false],
  ['bash', '[" "]', false],
  ['bash', '^("a"|b)[c', true, 'regex-bracket-unclosed'],
  ['bash', '"a"[b', true, 'regex-bracket-unclosed'],
  ['bash', '^("a"|[b)', true, 'regex-bracket-unclosed'],
];

/** What the run of the table sets before its lines (`[[ x =~ ^($a|$b)$ ]]`). */
const VALUES = "a=jpg b=png chars=abc y=']'";

const HAS_MAWK = spawnSync('mawk', ['BEGIN {}']).status === 0;
const rows = ROWS.filter(([program]) => program !== 'mawk' || HAS_MAWK);

/** The codes of the regex errors the problem outputs (`--check`, Problems) give for `text`, with their severities. */
function problems(text: string): string[] {
  const doc = openDocument(text, 'shell', (t) => parser.parse(t));
  return documentIssues(doc, 'en', shellsOf(doc.lines, 'a.sh', undefined)).filter((i) => i.code.startsWith('regex-')).map((i) => `${i.code} ${String(i.severity)}`);
}

describe('a regex its program refuses is an Error, as the program says', function () {
  this.timeout(60000);

  it('each row is refused, or taken, by the real program', () => {
    // (One process for the table: each line prints its status.)
    const script = [VALUES, ...rows.map(([program, text]) => `${LINES[program](text)} </dev/null >/dev/null 2>&1; echo $?`)].join('\n');
    const statuses = run('bash', ['-c', script], { env: { ...process.env, LC_ALL: 'C' } }).stdout.toString().trim().split('\n').map(Number);
    assert.strictEqual(statuses.length, rows.length);
    rows.forEach(([program, text, refused], i) => assert.strictEqual(REFUSES[program](statuses[i]), refused, `${program} '${text}': status ${statuses[i]}`));
  });

  it('an Error is said only of what the program refuses, and in each output that shows problems', () => {
    for (const [program, text, refused, id] of rows) {
      if (id) assert.ok(refused, `${program} '${text}' is taken, but said to be ${id}`);
      assert.deepStrictEqual(problems(`#!/bin/bash\n${LINES[program](text)}\n`), id ? [`${id} error`] : [], `${program} '${text}'`);
    }
  });

  it('where the shell does not get to the command, the row says the same with no problem', () => {
    for (const [program, text, , id] of rows.filter((r) => r[3])) {
      const src = `#!/bin/bash\nexit 0\n${LINES[program](text)}\n`;
      assert.deepStrictEqual(problems(src), [], `${program} '${text}'`);
      const ids = tokensOf(src, 2).flatMap((t) => t.texts ?? []);
      assert.ok(ids.includes(`${id}-if-reached` as never), `${program} '${text}': ${ids.join(', ')}`);
    }
  });

  it('names the program and what it does, in both languages', () => {
    const said = (line: string, lang: 'en' | 'ja') => tokensOf(`#!/bin/bash\n${line}\n`, 1, lang).filter((t) => t.kind === 'error').map((t) => t.explanation);
    assert.deepStrictEqual(said("grep -E '[a' f", 'en'), ['No `]` closes this `[`: `grep` stops with an error (status 2)']);
    assert.deepStrictEqual(said("grep -E '[a' f", 'ja'), ['`[` に対応する `]` がない。`grep` はエラーで止まる（終了ステータス 2）']);
    assert.deepStrictEqual(said('[[ x =~ [a ]]', 'en'), ['No `]` closes this `[`: `[[ … ]]` gives status 2, with no message']);
    assert.deepStrictEqual(said("perl -ne '/(a/' f", 'en'), ['Group 1: treats its contents as one unit (`\\1` refers to what it matched). No `)` closes this group: `perl` stops with an error (status 255)']);
    assert.deepStrictEqual(said("sed 's/\\(a/x/' f", 'en').at(-1), 'Group 1: treats its contents as one unit (`\\1` refers to what it matched). No `\\)` closes this group: `sed` stops with an error (status 1)');
    assert.match(said("gawk '/a\\/' f", 'en').join('\n'), /Nothing follows the final `\\`: `awk` stops with an error$/m);
    // (The problem says what follows: the command fails every time it runs.)
    const doc = openDocument("#!/bin/bash\ngrep 'a\\{' f\n", 'shell', (t) => parser.parse(t));
    const [issue] = documentIssues(doc, 'en', shellsOf(doc.lines, 'a.sh', undefined)).filter((i) => i.code === 'regex-interval-incomplete');
    assert.match(issue.message, /`\\\{` must start a complete `\\\{n\\\}` or `\\\{n,m\\\}` \("Unmatched \\\{" or "Invalid content of \\\{\\\}"\): `grep` stops with an error \(status 2\)\. The command fails every time it runs, and does not do its work/);
    assert.strictEqual(issue.head, 'This regex is not valid: the command fails every time it runs.');
  });

  it('a right side of parts says its error once, on the test, and each part says what it leaves open', () => {
    const src = '#!/bin/bash\n[[ x =~ ^("a"|b)[c ]]\n';
    const tokens = tokensOf(src, 1);
    assert.deepStrictEqual(tokens.filter((t) => (t.texts ?? []).includes('regex-bracket-unclosed')).map((t) => t.kind), ['test']);
    assert.ok(tokensOf('#!/bin/bash\n[[ x =~ ^("a"|b)$ ]]\n', 1).some((t) => /^Group 1: .*\. No `\)` closes it in this part \(the right side is one regex with its other parts\)$/.test(t.explanation)));
    assert.ok(tokensOf('#!/bin/bash\n[[ x =~ ^[a" "]+$ ]]\n', 1, 'ja').some((t) => t.explanation === '文字クラスの始まり。この部分には閉じる `]` がない（右辺はほかの部分と合わせて1つの正規表現）'));
    // (A Perl variable may close it: no error, and the row says so.)
    assert.ok(tokensOf("#!/bin/bash\nperl -ne 'print if /[a$x/' f\n", 1).some((t) => t.explanation === 'the start of a set, which no `]` closes here, but the value of a variable may'));
    assert.ok(tokensOf("#!/bin/bash\nperl -ne 'print if /(a$x/' f\n", 1, 'ja').some((t) => t.explanation.endsWith('。閉じる `)` はないが、変数の値が閉じることがある')));
    // (bash refuses `[[ x =~ (a ]]` when it parses it: the syntax error is said, not the regex's.)
    const doc = openDocument('#!/bin/bash\n[[ x =~ (a ]]\n', 'shell', (t) => parser.parse(t));
    const codes = documentIssues(doc, 'en', shellsOf(doc.lines, 'a.sh', undefined)).map((i) => i.code);
    assert.ok(codes.length > 0 && !codes.some((c) => c.startsWith('regex-')), codes.join(', '));
    assert.notStrictEqual(spawnSync('bash', ['-n', '-c', '[[ x =~ (a ]]']).status, 0);
  });

  it('a pattern with an expansion in it is not read where the value could mend it', () => {
    // (`$x` may be `]`, `)`: the word stays unread, and nothing is said of it.)
    for (const line of ['grep -E "[$x" f', 'grep -E "($x" f', 'grep "a\\{$n" f']) assert.deepStrictEqual(problems(`#!/bin/bash\n${line}\n`), [], line);
  });

  it('GNU grep reads a `\\{` with nothing before it as the character, and `\\{,\\}` as `*`', () => {
    const said = (re: string) => allTokens(explainRegex(re, 'bre', 'en')).map((t) => plainOf(t.explanation));
    assert.deepStrictEqual(said('\\{1\\}'), ['A literal "{" (`grep` reads a `\\{` with nothing before it to repeat as the character)', 'Literal "1"', 'Literal "}"']);
    assert.strictEqual(run('grep', ['-o', '\\{1\\}'], { input: 'a{1}\n' }).stdout.toString(), '{1}\n');
    assert.deepStrictEqual(said('x\\{,\\}'), ['Literal "x"', '`\\{,\\}`: repeat `x` 0 or more times']);
    assert.strictEqual(run('sed', ['s/x\\{,\\}/y/'], { input: 'xxa\n' }).stdout.toString(), 'ya\n');
    assert.match(allTokens(explainRegex('x\\{,\\}', 'bre', 'ja')).map((t) => t.explanation).join('\n'), /`x` を0回以上繰り返す/);
  });

  it('sed reads a bracket expression whole when it looks for the end of a regex', () => {
    const regexOf = (script: string) => allTokens(explainSed(script, 'bre', 'en')).filter((t) => t.kind === 'pattern' && t.explanation.startsWith('Character class')).map((t) => t.explanation);
    assert.deepStrictEqual(regexOf('s/[/]/x/'), ['Character class: one of "/"']);
    assert.deepStrictEqual(regexOf('s/[^/]/x/'), ['Character class: one character other than "/"']);
    assert.deepStrictEqual(regexOf('s/[]/]/x/'), ['Character class: one of "]", "/"']);
    assert.deepStrictEqual(regexOf('/[[:alpha:]/]/p'), ['Character class: one of letters, "/"']);
    // (Not closed, it runs to the end of the line: the command is not terminated, as GNU sed says.)
    assert.strictEqual(allTokens(explainSed('s/[a/x/\np', 'bre', 'en'))[0].explanation, 'Unterminated `s` command');
    assert.strictEqual(allTokens(explainSed('s/[[:a/x/', 'bre', 'en'))[0].explanation, 'Unterminated `s` command');
    assert.strictEqual(run('sed', ['s/[[.].]/]/x/'], { input: 'a/]\n' }).stdout.toString(), 'ax]\n');
    assert.match(allTokens(explainSed('s/[[.].]/]/x/', 'bre', 'en'))[0].explanation, /^Substitute: replace the first match of `\[\[\.\]\.\]\/\]` on each line with `x`$/);
  });
});
