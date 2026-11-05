import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Analyzer, type Token } from '../src/analyzer';
import { EMBEDDED, type EmbeddedContext } from '../src/embedded/registry';
import { explainHostedLine, extractShell, hostKind } from '../src/hosts';
import { type EmbeddedLang, type EmbeddedToken, holeChar } from '../src/embedded/types';
import { holedContent, literalContent } from '../src/staticword';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { run } from './support/run';

// A word with an expansion in double quotes is read by the command's reader with the expansion as a hole
// (src/embedded/types.ts): only what is true whatever the value is, or what a note says it assumes. A hole that decides
// what the command is leaves the word unread. Each read row names values and what the real tool does with them, so what
// the explanation claims is checked, and so is the assumption it states.

const parser = createUnbashParser();
const en = new Analyzer('en');
const ja = new Analyzer('ja');
const HOLE = /[\ufdd2-\ufdef]/;

const explained = (line: string, a = en) => a.explainLine(parser.parse(line), 0);
const walk = (ts: readonly Token[], out: Token[] = []): Token[] => {
  for (const t of ts) {
    out.push(t);
    walk(t.children, out);
  }
  return out;
};
const allTokens = (line: string): Token[] => walk(explained(line).items);
/** The tokens of the reader, as `label start-end`. */
const shape = (line: string): string[] => allTokens(line).filter((t) => t.origin === 'embedded').map((t) => `${t.label} ${t.span.start.character}-${t.span.end.character}`);
const wordOf = (line: string, word: string): Token => allTokens(line).find((t) => t.kind === 'argument' && t.label === word)!;

interface Tool {
  /** The value of `x` (and the other variables of the line). */
  x: string;
  vars?: Record<string, string>;
  /** What the tool reads: stdin, or a file `f`. */
  input?: string;
  out?: string;
  /** The tool fails: the value is what the explanation says it must not be. */
  fails?: true;
}

interface ReadRow {
  line: string;
  /** Every token of the reader. */
  tokens: string[];
  /** What the note of the word says. */
  note?: RegExp;
  /** What a token of a hole says. */
  says: RegExp;
  tools: Tool[];
}

const q = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

const READ: ReadRow[] = [
  {
    line: 'sed "s/$x/Z/"',
    tokens: ['s/$x/Z/ 5-12', 's 5-6', '/ 6-7', '$x 7-9', '$x 7-9', '/ 9-10', 'Z 10-11', '/ 11-12'],
    says: /read as a regex.*special meaning.*A `\/` in it ends the pattern early/,
    tools: [
      { x: 'b', input: 'abc\n', out: 'aZc\n' },
      { x: 'a.c', input: 'abc\n', out: 'Z\n' },
      { x: 'a/c', input: 'abc\n', fails: true },
    ],
  },
  {
    line: 'sed "s/b/$x/"',
    tokens: ['s/b/$x/ 5-12', 's 5-6', '/ 6-7', 'b 7-8', 'b 7-8', '/ 8-9', '$x 9-11', '$x 9-11', '/ 11-12'],
    says: /goes into the replacement: `&` in it stands for the whole match, `\\` starts an escape, and a `\/` ends the replacement early/,
    tools: [
      { x: 'Q', input: 'abc\n', out: 'aQc\n' },
      { x: '[&]', input: 'abc\n', out: 'a[b]c\n' },
      { x: 'p\\tq', input: 'abc\n', out: 'ap\tqc\n' },
      { x: 'p/q', input: 'abc\n', fails: true },
    ],
  },
  {
    line: 'sed "s|^$x=.*|$x=1|"',
    tokens: ['s|^$x=.*|$x=1| 5-19', 's 5-6', '| 6-7', '^$x=.* 7-13', '^ 7-8', '$x 8-10', '= 10-11', '. 11-12', '* 12-13', '| 13-14', '$x=1 14-18', '$x 14-16', '=1 16-18', '| 18-19'],
    says: /A `\|` in it ends the pattern early/,
    tools: [
      { x: 'a', input: 'a=0\nb=0\n', out: 'a=1\nb=0\n' },
      { x: '.', input: 'b=0\n', out: '.=1\n' },
      { x: 'a|b', input: 'a=0\n', fails: true },
    ],
  },
  {
    line: 'sed -E "s/($x)(b)/\\2/"',
    tokens: ['s/($x)(b)/\\2/ 8-21', 's 8-9', '/ 9-10', '($x)(b) 10-17', '($x) 10-14', '$x 11-13', '(b) 14-17', 'b 15-16', '/ 17-18', '\\2 18-20', '\\2 18-20', '/ 20-21'],
    says: /as if the value were a complete regex with no group of its own/,
    tools: [
      { x: 'a', input: 'ab\n', out: 'b\n' },
      // (A group in the value: `\2` is not the `(b)` the reading names, which the note says it assumes.)
      { x: '(a)', input: 'ab\n', out: 'a\n' },
    ],
  },
  {
    line: 'sed "/$x/d"',
    tokens: ['/$x/d 5-10', '/$x/ 5-9', '$x 6-8', 'd 9-10'],
    says: /read as a regex.*A `\/` in it ends the pattern early/,
    tools: [
      { x: 'b', input: 'a\nb\n', out: 'a\n' },
      { x: '.', input: 'a\nb\n', out: '' },
      { x: 'a/b', input: 'a\n', fails: true },
    ],
  },
  {
    line: 'sed -n "${x}p"',
    tokens: ['${x}p 8-13', '${x} 8-12', 'p 12-13'],
    says: /stands where an address goes.*a value that is no address makes another command/,
    tools: [
      { x: '2', input: 'a\nb\nc\n', out: 'b\n' },
      { x: '1,2', input: 'a\nb\nc\n', out: 'a\nb\n' },
      { x: '/c/', input: 'a\nb\nc\n', out: 'c\n' },
      { x: 's/a/Z/;', input: 'a\nb\n', out: 'Z\nb\n' },
    ],
  },
  {
    line: 'sed "1i $x"',
    tokens: ['1i $x 5-10', '1 5-6', 'i 6-7', '$x 8-10', '$x 8-10'],
    says: /goes into this text: sed reads a `\\` in it, and a newline ends the text/,
    tools: [
      { x: 'hello', input: 'a\n', out: 'hello\na\n' },
      { x: 'u\nd', input: 'a\n', out: 'u\n' },
    ],
  },
  {
    line: 'grep "$x\\.log"',
    tokens: ['$x 6-8', '\\. 8-10', 'log 10-13'],
    note: /basic regex \(BRE\).*If the value of `\$x` starts with `-`, `grep` reads this word as options/,
    says: /read as a regex.*as if the value were a complete regex/,
    tools: [
      { x: 'a', input: 'a.log\naxlog\nb.log\n', out: 'a.log\n' },
      { x: '.', input: 'a.log\n', out: 'a.log\n' },
      { x: '[', input: 'a.log\n', fails: true },
    ],
  },
  {
    line: 'grep -E "^($x|y)\\$"',
    tokens: ['^ 9-10', '($x|y) 10-16', '$x 11-13', '| 13-14', 'y 14-15', '\\$ 16-18'],
    note: /bash has already removed the backslash: `\\\$` → `\$`/,
    says: /read as a regex/,
    tools: [
      { x: 'a', input: 'a\ny\nz\n', out: 'a\ny\n' },
      { x: 'a|z', input: 'a\nz\nb\n', out: 'a\nz\n' },
    ],
  },
  {
    line: 'grep "^$x*$"',
    tokens: ['^ 6-7', '$x 7-9', '* 9-10', '$ 10-11'],
    says: /read as a regex/,
    tools: [
      // (`*` repeats what the value ends with, not the whole value.)
      { x: 'ab', input: 'abbb\nabab\n', out: 'abbb\n' },
      { x: '[ab]', input: 'abab\nc\n', out: 'abab\n' },
      // (With an empty value, as if `$x` were not there: `^*$`, where `*` stands for itself.)
      { x: '', input: '*\nz\n', out: '*\n' },
    ],
  },
  {
    line: 'grep "[$x]"',
    tokens: ['[$x] 6-10', '$x 7-9'],
    says: /join the set; `\]`, `-` and `\^` in it have their special meaning/,
    tools: [
      { x: 'ab', input: 'a\nz\n', out: 'a\n' },
      { x: 'a-c', input: 'b\nz\n', out: 'b\n' },
      { x: '^a', input: 'a\nz\n', out: 'z\n' },
    ],
  },
  {
    line: 'awk "/$x/ {print}"',
    tokens: ['/$x/ {print} 5-17', '/$x/ 5-9', '$x 6-8', '{print} 10-17', 'print 11-16'],
    says: /read as a regex.*A `\/` in it ends the pattern early/,
    tools: [
      { x: 'b', input: 'a\nb\n', out: 'b\n' },
      { x: '.', input: 'a\nb\n', out: 'a\nb\n' },
      { x: 'a/b', input: 'a\n', fails: true },
    ],
  },
  {
    line: 'awk "{print \\"$x\\"}"',
    tokens: ['{print \\"$x\\"} 5-19', 'print \\"$x\\" 6-18', '$x 14-16'],
    says: /goes into an awk string: a `"` in it ends the string, and a `\\` starts an escape/,
    tools: [
      { x: 'Q', input: 'a\n', out: 'Q\n' },
      { x: 'p\\tq', input: 'a\n', out: 'p\tq\n' },
      // (The `"` ends the string early: `"a"b"` has one too few.)
      { x: 'a"b', input: 'a\n', fails: true },
    ],
  },
  {
    line: 'perl -pe "s/$x/Z/"',
    tokens: ['s/$x/Z/ 10-17', '$x 12-14', '$x 12-14', 'Z 15-16'],
    says: /read as a regex.*A `\/` in it ends the pattern early\. perl expands `\$` and `@` in it first/,
    tools: [
      { x: 'b', input: 'abc\n', out: 'aZc\n' },
      { x: 'a.c', input: 'abc\n', out: 'Z\n' },
      { x: 'a/c', input: 'abc\n', fails: true },
      // (perl reads `$0` of the value first: the name of the program, `-e`.)
      { x: '$0', input: 'x-ey\n', out: 'xZy\n' },
    ],
  },
  {
    line: 'perl -pe "s/b/$x/"',
    tokens: ['s/b/$x/ 10-17', 'b 12-13', 'b 12-13', '$x 14-16', '$x 14-16'],
    says: /goes into the replacement, which perl reads as a double-quoted string: `\$`, `@` and `\\` in it are special, and a `\/` ends the replacement early/,
    tools: [
      { x: 'Q', input: 'abc\n', out: 'aQc\n' },
      { x: '$0', input: 'abc\n', out: 'a-ec\n' },
      { x: 'p\\tq', input: 'abc\n', out: 'ap\tqc\n' },
      { x: 'p/q', input: 'abc\n', fails: true },
    ],
  },
  {
    line: 'perl -ne "print if /$x/"',
    tokens: ['print if /$x/ 10-23', 'print 10-15', '/$x/ 19-23', '$x 20-22'],
    says: /read as a regex/,
    tools: [
      { x: 'b', input: 'a\nb\n', out: 'b\n' },
      { x: '.', input: 'a\n', out: 'a\n' },
    ],
  },
  {
    line: 'tr "$x" Z',
    tokens: ['Z 8-9'],
    note: /characters to replace: the value of `\$x`/,
    says: /read as part of the set: `a-z`, `\[:upper:\]` and `\\` work in it too/,
    tools: [
      { x: 'a', input: 'abc', out: 'Zbc' },
      { x: 'a-c', input: 'abcd', out: 'ZZZd' },
      { x: '[:lower:]', input: 'aB', out: 'ZB' },
    ],
  },
  {
    line: 'date -u -d @0 +"%F $x"',
    tokens: ['+ 14-15', '%F 16-18', ' 18-19', '$x 19-21'],
    says: /part of the format: a `%` in it is read as a conversion/,
    tools: [
      { x: 'Q', out: '1970-01-01 Q\n' },
      { x: '%Y', out: '1970-01-01 1970\n' },
    ],
  },
  {
    line: 'printf "%s $x\\n" a b',
    tokens: ['%s 8-10', ' 10-11', '$x 11-13', '\\n 13-15'],
    says: /a `%` in it is a conversion that takes an argument, and a `\\` starts an escape\. What stands around it is read as if the value held no `%`/,
    tools: [
      { x: 'Q', out: 'a Q\nb Q\n' },
      // (One `%s` more: the two arguments go in one use of the format.)
      { x: '%s', out: 'a b\n' },
      { x: 'p\\tq', out: 'a p\tq\nb p\tq\n' },
    ],
  },
  {
    line: 'echo -e "a\\t$x"',
    tokens: ['a 9-10', '\\t 10-12', '$x 12-14'],
    says: /printed too, with a `\\` in it read as an escape/,
    tools: [
      { x: 'Q', out: 'a\tQ\n' },
      { x: 'p\\tq', out: 'a\tp\tq\n' },
    ],
  },
];

/** Lines whose word stays unread, with a value that makes the tool do something else. */
interface StopRow { line: string; note?: RegExp; shows: [Tool, Tool]; other?: string[] }

const STOP: StopRow[] = [
  { line: 'sed "$x"', note: /depends on the value of `\$x`: `sed` reads it as code/, shows: [{ x: 'p', input: 'a\n', out: 'a\na\n' }, { x: 'd', input: 'a\n', out: '' }] },
  { line: 'sed "$x/a/b/"', note: /`\$x`/, shows: [{ x: 's', input: 'a\n', out: 'b\n' }, { x: 'y', input: 'aa\n', out: 'bb\n' }] },
  { line: 'sed "s$x"', note: /`\$x`/, shows: [{ x: '/a/b/', input: 'a\n', out: 'b\n' }, { x: '/a/b/;d', input: 'a\n', out: '' }] },
  { line: 'sed "s/a/b/$x"', note: /`\$x`/, shows: [{ x: 'g', input: 'aa\n', out: 'bb\n' }, { x: '', input: 'aa\n', out: 'ba\n' }] },
  { line: 'sed "p;$x"', note: /`\$x`/, shows: [{ x: 'd', input: 'a\n', out: 'a\n' }, { x: '', input: 'a\n', out: 'a\na\n' }] },
  { line: 'sed "y/$x/b/"', note: /`\$x`/, shows: [{ x: 'a', input: 'a\n', out: 'b\n' }, { x: 'ab', input: 'a\n', fails: true }] },
  { line: 'sed "s/\\x4$x/Z/"', shows: [{ x: '1', input: 'A\n', out: 'Z\n' }, { x: 'z', input: 'A\n', out: 'A\n' }], note: /`\$x`/ },
  { line: 'awk "$x"', note: /depends on the value of `\$x`: `awk` reads it as code\. To pass a value as data, use `-v name=value`/, shows: [{ x: '{print}', input: 'a\n', out: 'a\n' }, { x: 'BEGIN{print "z"}', out: 'z\n' }] },
  { line: 'awk "BEGIN { x = $x; print x }"', note: /`\$x`/, shows: [{ x: '1', out: '1\n' }, { x: '1; print "z"', out: 'z\n1\n' }] },
  { line: 'awk "{print \\$$x}"', note: /`\$x`/, shows: [{ x: '1', input: 'a b\n', out: 'a\n' }, { x: '2; print "z"', input: 'a b\n', out: 'b\nz\n' }] },
  { line: 'jq "$x"', note: /depends on the value of `\$x`: `jq` reads it as code\. To pass a value as data, use `--arg name value`/, shows: [{ x: '.a', input: '{"a":1}', out: '1\n' }, { x: 'keys', input: '{"a":1}', out: '[\n  "a"\n]\n' }] },
  { line: 'jq ".$x"', note: /`\$x`/, shows: [{ x: 'a', input: '{"a":1}', out: '1\n' }, { x: 'a,.a', input: '{"a":1}', out: '1\n1\n' }] },
  { line: 'perl -e "$x; print 2"', note: /`\$x`: `perl` reads it as code/, shows: [{ x: 'print 1', out: '12' }, { x: 'exit', out: '' }] },
  { line: 'perl -pe "s/a/$x/e"', note: /`\$x`/, shows: [{ x: '1+1', input: 'a\n', out: '2\n' }, { x: '"z"', input: 'a\n', out: 'z\n' }] },
  // (No reading and no note of its own: what a value makes of these is the regex's to say.)
  { line: 'grep -E "a{$x}"', shows: [{ x: '2', input: 'aa\na{b}\n', out: 'aa\n' }, { x: 'b', input: 'a{b}\n', out: 'a{b}\n' }] },
  { line: 'grep "$x^a"', shows: [{ x: '', input: 'ab\nb^a\n', out: 'ab\n' }, { x: 'b', input: 'ab\nb^a\n', out: 'b^a\n' }] },
  { line: 'grep "a\\$$x"', shows: [{ x: '', input: 'a\na$b\n', out: 'a\n' }, { x: 'b', input: 'a\na$b\n', out: 'a$b\n' }] },
  { line: 'grep "[[:$x:]]"', shows: [{ x: 'digit', input: '1\nz\n', out: '1\n' }, { x: 'alpha', input: '1\nz\n', out: 'z\n' }] },
  { line: 'grep -P "\\Q$x\\E"', shows: [{ x: '.', input: 'a\n', fails: true }, { x: 'a', input: 'a\n', out: 'a\n' }] },
  { line: 'date -u -d @0 +"%$x"', shows: [{ x: '%', out: '%\n' }, { x: 'Y', out: '1970\n' }] },
  { line: 'printf "%${x}s" a', shows: [{ x: '3', out: '  a' }, { x: '-3', out: 'a  ' }] },
  { line: 'grep -P "(?$x)a"', shows: [{ x: 'i', input: 'A\n', out: 'A\n' }, { x: ':', input: 'A\n', fails: true }] },
  { line: 'grep -P "\\x4$x"', shows: [{ x: '1', input: 'A\n', out: 'A\n' }, { x: '2', input: 'A\nB\n', out: 'B\n' }] },
  { line: 'grep "[a-$x]"', shows: [{ x: 'c', input: 'b\n', out: 'b\n' }, { x: 'a', input: 'b\n', fails: true }] },
  { line: 'grep "[$x-z]"', shows: [{ x: 'a', input: 'b\n', out: 'b\n' }, { x: 'c', input: 'b\n', fails: true }] },
  { line: 'grep "[$x"', shows: [{ x: 'a]', input: 'a\n', out: 'a\n' }, { x: 'a', input: 'a\n', fails: true }] },
  { line: 'sed "s/a/\\x$x/"', note: /`\$x`/, shows: [{ x: '41', input: 'a\n', out: 'A\n' }, { x: '42', input: 'a\n', out: 'B\n' }] },
  { line: 'sed "s/a/\\x4$x/"', note: /`\$x`/, shows: [{ x: '1', input: 'a\n', out: 'A\n' }, { x: '2', input: 'a\n', out: 'B\n' }] },
  { line: 'perl -e "print \\$$x"', note: /`\$x`/, shows: [{ x: '0', out: '-e' }, { x: '_', out: '' }] },
  { line: 'date -u -d @0 +"%-$x"', shows: [{ x: 'H', out: '0\n' }, { x: 'Y', out: '1970\n' }] },
  { line: 'printf "\\x4$x"', shows: [{ x: '1', out: 'A' }, { x: 'z', out: '\x04z' }] },
  { line: 'tr "$x-z" Z', other: ['Z 10-11'], shows: [{ x: 'a', input: 'b', out: 'Z' }, { x: 'b', input: 'a', out: 'a' }] },
  { line: 'tr "\\1$x" Z', other: ['Z 10-11'], shows: [{ x: '1', input: 'I', out: 'I' }, { x: '', input: '\x01', out: 'Z' }] },
  { line: 'grep "a\\{$x\\}"', shows: [{ x: '2', input: 'aa\n', out: 'aa\n' }, { x: 'b', input: 'a\n', fails: true }] },
  { line: 'tr "[:$x:]" Z', other: ['Z 12-13'], shows: [{ x: 'digit', input: '1a', out: 'Za' }, { x: 'alpha', input: '1a', out: '1Z' }] },
  { line: 'echo -e "\\x4$x"', shows: [{ x: '1', out: 'A\n' }, { x: 'z', out: '\x04z\n' }] },
  { line: 'grep "\\\\$x"', shows: [{ x: '.', input: 'a\n.\n', out: '.\n' }, { x: 'd', input: 'd\n', out: 'd\n' }] },
];

/** Words that may be several, or are read by the shell in other ways, keep what they say today: no reading and no note of a script. */
const KEPT: string[] = [
  'sed s/$x/b/', 'sed "s/$@/b/"', 'sed "$@"', 'sed "$*"', 'sed "s/${a[@]}/b/"', 'sed "s/${a[*]}/b/"', 'grep "$x"* f', 'grep "$@" f', 'grep "${@:2}" f', 'grep "${!a*}" f', 'grep "${!a[*]}" f', 'grep "${*:2}" f', 
  'grep ~/"$x" f', 'grep {a,b}"$x" f', 'grep -F "$x" f', 'find . -name "[$x]"', 'find . -name "\'$x\'"', 'find . -name "@($x|b)"',
];

/** Runs the cases of the table in one shell: `script` of each case, and the status. */
function runAll(cases: { line: string; tool: Tool }[]): { out: string; status: number }[] {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hole-words-'));
  try {
    let script = 'cd ' + q(dir) + '\n';
    cases.forEach(({ line, tool }, i) => {
      fs.writeFileSync(path.join(dir, `in${i}`), tool.input ?? '');
      const vars = `x=${q(tool.x)}\n`;
      script += `(${vars}${line} < in${i}) > out${i} 2>/dev/null; echo $? > st${i}\n`;
    });
    run('bash', ['-c', script], { check: true });
    return cases.map((_, i) => ({ out: fs.readFileSync(path.join(dir, `out${i}`), 'utf8'), status: Number(fs.readFileSync(path.join(dir, `st${i}`), 'utf8')) }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const check = (name: string, got: { out: string; status: number }, tool: Tool): void => {
  if (tool.fails) assert.notStrictEqual(got.status, 0, `${name}: the tool should fail with x=${tool.x}`);
  else assert.strictEqual(got.out, tool.out, `${name} with x=${JSON.stringify(tool.x)}`);
};

describe('words with an expansion read with the expansion as a hole', function () {
  this.timeout(60000);

  describe('what is read', () => {
    for (const row of READ) {
      it(row.line, () => {
        assert.deepStrictEqual(shape(row.line), row.tokens);
        const tokens = allTokens(row.line);
        // bash's reading stays: the expansion, under the reader's token.
        const shell = tokens.filter((t) => t.origin === 'shell' && t.label.startsWith('$'));
        assert.ok(shell.some((t) => /^(Expands|Value) /.test(t.explanation)), 'the token of the expansion');
        assert.ok(tokens.some((t) => row.says.test(t.explanation)), `a hole says ${row.says}: ${tokens.map((t) => t.explanation).join(' | ')}`);
        if (row.note) assert.match(tokens.map((t) => t.explanation).join(' | '), row.note);
        // No example: it would need a value made up.
        assert.deepStrictEqual(explained(row.line).examples.filter((e) => e.kind !== 'date'), []);
      });
    }
    it('what the real tools do with those values', () => {
      const cases = READ.flatMap((row) => row.tools.map((tool) => ({ line: row.line, tool })));
      runAll(cases).forEach((got, i) => check(cases[i].line, got, cases[i].tool));
    });
  });

  describe('what stops the reader', () => {
    for (const row of STOP) {
      it(row.line, () => {
        assert.deepStrictEqual(shape(row.line), row.other ?? [], 'no token of the reader');
        const text = allTokens(row.line).map((t) => t.explanation).join(' | ');
        if (row.note) assert.match(text, row.note);
        else assert.doesNotMatch(text, /depends on the value/);
      });
    }
    it('the value changes what the command does', () => {
      const cases = STOP.flatMap((row) => row.shows.map((tool) => ({ line: row.line, tool })));
      runAll(cases).forEach((got, i) => check(cases[i].line, got, cases[i].tool));
    });
    for (const line of KEPT) {
      it(`${line} stays as it was`, () => {
        assert.deepStrictEqual(shape(line), []);
        assert.doesNotMatch(allTokens(line).map((t) => t.explanation).join(' | '), /depends on the value|is read as|goes into/);
      });
    }
    it('an unquoted expansion and "$@" may make several arguments', () => {
      const out = run('bash', ['-c', `count() { echo $#; }; a='x y'; count s/$a/b/; set -- p q; count "s/$@/b/"`], { check: true }).stdout.toString();
      assert.strictEqual(out, '2\n2\n');
    });
  });

  it('a hole beside a backslash is not read: it escapes the first character of the value', () => {
    assert.deepStrictEqual(shape('sed "s/\\\\$x/b/"'), []);
    assert.ok(shape('sed "s/\\\\\\\\$x/b/"').includes('$x 11-13'), 'an escaped backslash leaves the hole alone');
  });

  it('a regex that is only the value stays as it was: the word says it is a pattern, and the pitfall what its characters do', () => {
    assert.deepStrictEqual(shape('grep "$x" f'), []);
    const said = explained('grep "$x" f');
    assert.match(said.notes.join(' | '), /reads the value of `\$x` as a regular expression.*`\.`, `\*`, `\[` and the like in the value have their special meaning/);
    const got = runAll([{ line: 'grep "$x"', tool: { x: 'a.', input: 'ab\nz\n', out: 'ab\n' } }]);
    assert.strictEqual(got[0].out, 'ab\n');
  });

  it('reads the escapes around a hole with `echo -e`', () => {
    assert.ok(allTokens('echo -e "\\e$x"').some((t) => t.label === '\\e' && t.origin === 'embedded'));
  });

  it('a hole after `\\$` is not an expansion of the shell, and one that follows is', () => {
    assert.deepStrictEqual(shape('sed "s/\\$x/b/"').filter((s) => s.startsWith('$x')), []);
    assert.ok(shape('sed "s/\\$x$y/b/"').includes('$y 10-12'));
  });

  it('reads a sed script of several commands and a range of holes', () => {
    assert.deepStrictEqual(shape('sed -n "$a,$b p;/$c/d"').filter((s) => /^(\$\w|\/\$)/.test(s)), ['$a,$b p 8-15', '$a 8-10', '$b 11-13', '/$c/d 16-21', '/$c/ 16-20', '$c 17-19']);
    assert.deepStrictEqual(shape('sed "/a/{${x}p}"').filter((s) => s.startsWith('${x}')), ['${x}p 9-14', '${x} 9-13']);
  });

  it('the children of `$( )` and `$(( ))` are still explained, under the reader\'s token', () => {
    const line = 'sed "s/$(date +%F)/$((1+2))/"';
    const tokens = allTokens(line);
    assert.ok(tokens.some((t) => t.label === 'date' && t.explanation.includes('Print or set the date')), 'the command in `$( )`');
    assert.ok(tokens.some((t) => t.label === '1+2' && t.explanation.includes('Arithmetic')), 'the arithmetic');
    const hole = tokens.find((t) => t.origin === 'embedded' && t.label === '$(date +%F)' && t.explanation.startsWith('The value'))!;
    assert.strictEqual(hole.children[0].kind, 'substitution');
    assert.strictEqual(hole.children[0].origin, 'shell');
  });

  it('keeps the expansion in bash\'s layer of the reading tree, and out of the language\'s', () => {
    const reading = en.explainLine(parser.parse('sed "s/$a/b/"'), 0, 'bash', { reading: true }).reading!;
    const nodes: { layer: string; label: string }[] = [];
    const visit = (n: typeof reading): void => {
      nodes.push({ layer: n.layer, label: n.label });
      n.children.forEach(visit);
    };
    visit(reading);
    assert.ok(nodes.some((n) => n.layer === 'bash' && n.label === '$a'));
    // (The pattern and its hole: the reader's own two tokens, and no third, bash's.)
    assert.strictEqual(nodes.filter((n) => n.layer === 'language' && n.label === '$a').length, 2);
  });

  it('says it in Japanese', () => {
    const items = walk(explained('sed "s/$a/$b/"; find . -name "$c*"; date +"$d"; printf "$e"; echo -e "\\t$f"; tr "$g" x; grep "[$h]*$i*"; sed "1i $j"; sed -n "${k}p"; awk "{print \\"$l\\"}"; perl -pe "s/a/$m/"', ja).items);
    const said = items.map((t) => t.explanation).join('\n');
    for (const text of ['正規表現として読まれる', '置換後の文字列に入る', 'パターンの一部として読まれる', '表示書式の一部になる', '書式の一部になる', 'エスケープとして読まれる', '文字の集合の一部として読まれる', 'この集合に加わる', '最後の要素', 'このテキストに入る', 'アドレスの位置にある', 'awk の文字列に入る', 'ダブルクォートの文字列として読む']) assert.ok(said.includes(text), text);
    assert.match(walk(explained('sed "$x"', ja).items).map((t) => t.explanation).join('\n'), /スクリプトの内容は `\$x` の値で決まる/);
  });

  describe('no other reader of a word\'s text takes a hole', () => {
    it('literalContent refuses a word with an expansion', () => {
      for (const word of ['"a$x"', '"$x"', '+"%F $x"', '"s/$a/b/"']) assert.strictEqual(literalContent(parser.parse(`f ${word}`).root.namedChildren[0].namedChildren[1]), undefined, word);
    });
    const NO_EXAMPLE = ['cat "a$x"', 'jq . "a$x"', 'sed s/a/b/ "a$x"', 'awk -F"$x" \'{print $1}\' f', 'awk -v a="$x" \'{print a}\' f', 'tr a "$x"'];
    for (const line of NO_EXAMPLE) {
      it(`no example or input section takes the text of ${line}`, () => {
        assert.deepStrictEqual(explained(line).examples.flatMap((e) => e.sections).map((s) => s.label).filter((l) => /\ufdd2/.test(l)), []);
        assert.doesNotMatch(JSON.stringify(explained(line).examples), /Input: `a\$x`.*b\.txt/);
      });
    }
    it('`[ "$x" = "a$y" ]` is not read as a comparison with a text', () => {
      const said = JSON.stringify(explained('[ "$x" = "a$y" ]'));
      assert.doesNotMatch(said, /always|\ufdd2/i);
    });
    it('only the readers that know a position of data claim a hole', () => {
      const cx: EmbeddedContext = {
        lang: 'en', flavor: () => 'bre', trSet: () => ({ role: 'from', sets: [] }), letters: () => new Set(), given: () => false, bash: () => undefined, shell: undefined, invalid: () => 'plain' as never,
      };
      const claims = (ts: readonly EmbeddedToken[]): boolean => ts.some((t) => !!t.hole || claims(t.children));
      const hole = holeChar(0);
      const claimed: Record<string, boolean> = {};
      for (const lang of Object.keys(EMBEDDED) as EmbeddedLang[]) {
        // (A text of each language's own, with a hole where its data would stand.)
        const texts = [hole, `+%F ${hole}`, `\\t${hole}`, `s/${hole}/b/`, `/${hole}/`, `"${hole}"`, `${hole}p`, `.${hole}`, `1,${hole}`, `${hole}:`];
        claimed[lang] = texts.some((text) => {
          const r = EMBEDDED[lang](text, cx);
          return !!r && claims(r.tokens);
        });
      }
      assert.deepStrictEqual(Object.keys(claimed).filter((k) => claimed[k]).sort(), ['awk', 'date', 'echo', 'glob', 'perl', 'printf', 'regex', 'sed', 'trset']);
    });
    it('a text that holds a character a hole is written as stays unread', () => {
      assert.deepStrictEqual(shape(`sed 's/\ufdd2/b/'`), []);
      assert.deepStrictEqual(shape(`sed "s/\ufdd2$x/b/"`), []);
      assert.strictEqual(holedContent(parser.parse('f "' + holeChar(0) + '$x"').root.namedChildren[0].namedChildren[1], () => true), undefined);
      assert.doesNotMatch(JSON.stringify(explained(`grep "\ufdd2$x" f`).items.map((t) => t.span)), /NaN/);
    });
    it('a word with more different expansions than there are characters for holes stays unread', () => {
      const many = Array.from({ length: 33 }, (_, i) => `$v${i}`).join('');
      assert.deepStrictEqual(shape(`grep "${many}" f`), []);
      const same = Array.from({ length: 40 }, () => '$v').join('');
      assert.strictEqual(shape(`grep "${same}" f`).length, 40);
    });
    const hosted = (src: string, file: string, line: number): Token[] => {
      const extracted = extractShell(hostKind('', file, src)!, src);
      return walk(explainHostedLine(en, parser.parse(extracted.text), extracted, src.split('\n'), line, 'en')!.items);
    };
    it('Docker\'s exec form has no shell: `$x` is text there', () => {
      const tokens = hosted('FROM a\nCMD ["sed", "s/$a/b/", "f"]\n', 'Dockerfile', 1);
      assert.ok(tokens.some((t) => t.label === '$a' && t.explanation === 'Literal "$a"'));
      assert.ok(!tokens.some((t) => /read as a regex/.test(t.explanation)));
    });
    it('a shell\'s `$a` in a Dockerfile\'s RUN is a hole', () => {
      assert.ok(hosted('FROM a\nRUN sed "s/$a/b/" f\n', 'Dockerfile', 1).some((t) => t.label === '$a' && /read as a regex/.test(t.explanation)));
    });
    it('what a host pastes before the shell reads the line is no hole: it may close the quotes', () => {
      const none = (tokens: Token[]): void => {
        assert.ok(!tokens.some((t) => t.origin === 'embedded'), tokens.filter((t) => t.origin === 'embedded').map((t) => t.label).join());
        assert.doesNotMatch(tokens.map((t) => t.explanation).join('|'), /depends on the value/);
      };
      none(hosted('jobs:\n  a:\n    steps:\n      - run: sed "s/${{ env.Y }}/b/" f\n', '.github/workflows/x.yml', 3));
      none(hosted('jobs:\n  a:\n    steps:\n      - run: |\n          sed "s/$a/${{ env.Y }}/" f\n', '.github/workflows/x.yml', 4));
      none(hosted('all:\n\tsed "s/$(VAR)/b/" f\n', 'Makefile', 1));
    });
    it('…and a shell\'s `$$x` in a recipe is a hole', () => {
      assert.ok(hosted('all:\n\tsed "s/$$x/b/" f\n', 'Makefile', 1).some((t) => /read as a regex/.test(t.explanation)));
    });
  });

  describe('guards over the corpus', () => {
    const snippets: string[] = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/snippets.json'), 'utf8'));
    const sample = fs.readFileSync(path.join(__dirname, 'fixtures/sample.sh'), 'utf8');
    const FORMS = ['$x', '${x}', '$(c a)', '$((1+2))', '`c`', '${x:-y}', '$1', '$?', '${a[0]}'];
    const lines = FORMS.flatMap((v) => [
      `sed "s/${v}/b/" f`, `sed "s/a/${v}/g" f`, `grep "${v}" f`, `grep -E "^(${v}|a)+$" f`, `sed -n "${v}p" f`, `find . -name "${v}.txt"`, `date +"%F ${v}"`, `awk "/${v}/" f`, `awk "{print ${v}}" f`, `jq ".${v}" f`,
      `tr "${v}" z`, `printf "%s ${v}\\n" a`, `perl -pe "s/${v}/b/"`, `echo -e "\\n${v}"`, `yq ".${v}" f`,
    ]);
    const check1 = (src: string, line: number, a: Analyzer): void => {
      const tree = parser.parse(src);
      const ex = a.explainLine(tree, line);
      assert.doesNotMatch(JSON.stringify(ex), HOLE, `${src}: a hole leaks`);
      const visit = (t: Token, within?: Token): void => {
        const { start, end } = t.span;
        for (const n of [start.line, start.character, end.line, end.character]) assert.ok(Number.isInteger(n), `${src}: ${t.label}`);
        assert.ok(start.line < end.line || (start.line === end.line && start.character <= end.character), `${src}: ${t.label} in order`);
        if (within && t.origin === 'embedded' && within.origin !== 'argv') {
          const w = within.span;
          assert.ok((w.start.line < start.line || (w.start.line === start.line && w.start.character <= start.character))
            && (end.line < w.end.line || (end.line === w.end.line && end.character <= w.end.character)), `${src}: ${t.label} lies in ${within.label}`);
        }
        t.children.forEach((c) => visit(c, t));
      };
      ex.items.forEach((t) => visit(t));
    };
    it('no output holds a hole, every token in order and inside its word: generated lines', () => {
      for (const line of lines) for (const a of [en, ja]) check1(line, 0, a);
    });
    it('…: the sample', () => {
      const count = sample.split('\n').length;
      for (let i = 0; i < count; i++) check1(sample, i, en);
    });
    it('…: the snippets', () => {
      for (const s of snippets.filter((x) => /["$]/.test(x))) if (s.split('\n').length < 5) check1(s, 0, en);
    });
  });

  describe('speed', () => {
    const time = (f: () => void): number => {
      const t = process.hrtime.bigint();
      f();
      return Number(process.hrtime.bigint() - t) / 1e6;
    };
    it('a word of 100k characters with many holes stays about linear', () => {
      const word = (n: number): string => `sed "s/${'a$x'.repeat(n)}/${'$y-'.repeat(n)}/" f`;
      const small = time(() => shape(word(4000)));
      const large = time(() => shape(word(16000)));
      assert.ok(large < Math.max(small * 8, 2000), `${small} ms, then ${large} ms for four times as much`);
      const many = 'grep "' + Array.from({ length: 5000 }, (_, i) => `$v${i}`).join('') + '" f';
      assert.ok(time(() => shape(many)) < 20000);
    });
    it('a script of 5000 such lines stays about linear', () => {
      const script = (n: number): string => Array.from({ length: n }, (_, i) => `sed -i "s|^$k${i}=.*|$k=$v|" f`).join('\n');
      const a = script(1000);
      const b = script(5000);
      const lineOf = (src: string, n: number): number => {
        const tree = parser.parse(src);
        return time(() => {
          for (let i = 0; i < n; i += 100) en.explainLine(tree, i);
        });
      };
      const small = lineOf(a, 1000);
      const large = lineOf(b, 5000);
      assert.ok(large < Math.max(small * 15, 5000), `${small} ms, then ${large} ms`);
    });
  });
});
