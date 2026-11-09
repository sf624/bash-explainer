import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Analyzer, type Token } from '../src/analyzer';
import { EMBEDDED, type EmbeddedContext } from '../src/embedded/registry';
import { explainHostedLine, extractShell, hostKind } from '../src/hosts';
import { type EmbeddedLang, type EmbeddedToken, holeChar } from '../src/embedded/types';
import { maskCarried } from '../src/messages-levels';
import { literalContent } from '../src/staticword';
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
    tokens: ['s/$x/Z/ 5-12', 's 5-6', '/ 6-7', '$x 7-9', '/ 9-10', 'Z 10-11', '/ 11-12'],
    says: /^Pattern \(regex\) `\$x`: .*special meaning\. A `\/` or a newline in it ends the pattern early$/,
    tools: [
      { x: 'b', input: 'abc\n', out: 'aZc\n' },
      { x: 'a.c', input: 'abc\n', out: 'Z\n' },
      { x: 'a/c', input: 'abc\n', fails: true },
      { x: 'a\nc', input: 'abc\n', fails: true },
    ],
  },
  {
    line: 'sed "s/b/$x/"',
    tokens: ['s/b/$x/ 5-12', 's 5-6', '/ 6-7', 'b 7-8', 'b 7-8', '/ 8-9', '$x 9-11', '/ 11-12'],
    says: /^Replacement `\$x`: `&` in the value stands for the whole match, `\\` starts an escape, and a `\/` or a newline ends the replacement early$/,
    tools: [
      { x: 'Q', input: 'abc\n', out: 'aQc\n' },
      { x: '[&]', input: 'abc\n', out: 'a[b]c\n' },
      { x: 'p\\tq', input: 'abc\n', out: 'ap\tqc\n' },
      { x: 'p/q', input: 'abc\n', fails: true },
      { x: 'p\nq', input: 'abc\n', fails: true },
    ],
  },
  {
    line: 'sed "s|^$x=.*|$x=1|"',
    tokens: ['s|^$x=.*|$x=1| 5-19', 's 5-6', '| 6-7', '^$x=.* 7-13', '^ 7-8', '$x 8-10', '= 10-11', '. 11-12', '* 12-13', '| 13-14', '$x=1 14-18', '$x 14-16', '=1 16-18', '| 18-19'],
    says: /A `\|` or a newline in it ends the pattern early/,
    tools: [
      { x: 'a', input: 'a=0\nb=0\n', out: 'a=1\nb=0\n' },
      { x: '.', input: 'b=0\n', out: '.=1\n' },
      { x: 'a|b', input: 'a=0\n', fails: true },
    ],
  },
  {
    line: 'sed -E "s/($x)(b)/\\2/"',
    tokens: ['s/($x)(b)/\\2/ 8-21', 's 8-9', '/ 9-10', '($x)(b) 10-17', '($x) 10-14', '$x 11-13', '(b) 14-17', 'b 15-16', '/ 17-18', '\\2 18-20', '\\2 18-20', '/ 20-21'],
    says: /as if the value were a complete regex with no group, no alternation \(`\|`\) of its own/,
    tools: [
      { x: 'a', input: 'ab\n', out: 'b\n' },
      // (A group in the value: `\2` is not the `(b)` the reading names, which the note says it assumes.)
      { x: '(a)', input: 'ab\n', out: 'a\n' },
    ],
  },
  {
    line: 'sed "/$x/d"',
    tokens: ['/$x/d 5-10', '/$x/ 5-9', '$x 6-8', 'd 9-10'],
    says: /read as a regex.*A `\/` or a newline in it ends the pattern early/,
    tools: [
      { x: 'b', input: 'a\nb\n', out: 'a\n' },
      { x: '.', input: 'a\nb\n', out: '' },
      { x: 'a/b', input: 'a\n', fails: true },
      { x: 'a\nb', input: 'a\n', fails: true },
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
    tokens: ['1i $x 5-10', '1 5-6', 'i 6-7', '$x 8-10'],
    says: /sed reads a `\\` in the value, and a newline ends the text/,
    tools: [
      { x: 'hello', input: 'a\n', out: 'hello\na\n' },
      { x: 'u\nd', input: 'a\n', out: 'u\n' },
    ],
  },
  {
    line: 'grep "$x\\.log"',
    tokens: ['$x 6-8', '\\. 8-10', 'log 10-13'],
    note: /basic regex \(BRE\).*If the value of `\$x` starts with `-`, `grep` reads this word as options/,
    says: /read as a regex.*as if the value were a complete regex with no group, no alternation \(`\|`\) and no newline of its own/,
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
    says: /read as a regex.*A `\/` or a newline in it ends the pattern early/,
    tools: [
      { x: 'b', input: 'a\nb\n', out: 'b\n' },
      { x: '.', input: 'a\nb\n', out: 'a\nb\n' },
      { x: 'a/b', input: 'a\n', fails: true },
      { x: 'a\nb', input: 'a\n', fails: true },
    ],
  },
  {
    line: 'awk "{print \\"$x\\"}"',
    tokens: ['{print \\"$x\\"} 5-19', 'print \\"$x\\" 6-18', '$x 14-16'],
    says: /goes into an awk string: a `"` or a newline in it ends the string, and a `\\` starts an escape/,
    tools: [
      { x: 'Q', input: 'a\n', out: 'Q\n' },
      { x: 'p\\tq', input: 'a\n', out: 'p\tq\n' },
      // (The `"` ends the string early: `"a"b"` has one too few.)
      { x: 'a"b', input: 'a\n', fails: true },
      { x: 'a\nb', input: 'a\n', fails: true },
    ],
  },
  {
    line: 'perl -pe "s/$x/Z/"',
    tokens: ['s/$x/Z/ 10-17', '$x 12-14', 'Z 15-16'],
    says: /: `\.`.*special meaning\. A `\/` in it ends the pattern early\. perl expands `\$` and `@` in it first$/,
    tools: [
      { x: 'b', input: 'abc\n', out: 'aZc\n' },
      { x: 'a.c', input: 'abc\n', out: 'Z\n' },
      { x: 'a/c', input: 'abc\n', fails: true },
      // (A newline is one character of the regex here: it ends nothing.)
      { x: 'a\nb', input: 'abc\n', out: 'abc\n' },
      // (perl reads `$0` of the value first: the name of the program, `-e`.)
      { x: '$0', input: 'x-ey\n', out: 'xZy\n' },
    ],
  },
  {
    line: 'perl -pe "s/b/$x/"',
    tokens: ['s/b/$x/ 10-17', 'b 12-13', 'b 12-13', '$x 14-16'],
    says: /perl reads as a double-quoted string: `\$`, `@` and `\\` in the value are special, and a `\/` ends the replacement early/,
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
    says: /characters to replace: the value of `\$x`\. `a-z`, `\[:upper:\]` and `\\` work in the value too/,
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
    says: /a `%` in it is a conversion that takes an argument, and a `\\` starts an escape\. What follows is read as if the value held no `%`/,
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
  // (gawk's `\x4` and `\1` take the digits of the value, as sed's and PCRE's do.)
  { line: 'awk "/\\x4$x/"', note: /`\$x`/, shows: [{ x: '1', input: 'A\n', out: 'A\n' }, { x: '2', input: 'A\nB\n', out: 'B\n' }] },
  { line: 'awk "/\\10$x/"', note: /`\$x`/, shows: [{ x: '1', input: 'A\n', out: 'A\n' }, { x: '2', input: 'A\nB\n', out: 'B\n' }] },
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
  'sed s/$x/b/', 'sed "s/$@/b/"', 'sed "$@"', 'sed "s/${a[@]}/b/"', 'grep "$x"* f', 'grep "$@" f', 'grep "${@:2}" f',
  'grep ~/"$x" f', 'grep {a,b}"$x" f', 'grep -F "$x" f', 'find . -name "[$x]"', 'find . -name "\'$x\'"',
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

  it('a hole after blanks is an address only where a command starts', () => {
    assert.deepStrictEqual(shape('sed "s/a/b/\t $x p"'), []);
    assert.ok(shape('sed "p;\t $x p"').includes('$x 9-11'));
  });

  it('perl\'s `s{…}{…}` has no one delimiter that a value would end the part at', () => {
    const says = allTokens('perl -pe "s{a}{$x}"').find((t) => t.origin === 'embedded' && t.explanation.startsWith('Replacement'))!;
    assert.match(says.explanation, /`\$`, `@` and `\\` in the value are special$/);
    assert.doesNotMatch(allTokens('perl -pe "s{$x}{b}"').map((t) => t.explanation).join('|'), /ends the pattern early/);
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
    const hole = tokens.find((t) => t.origin === 'embedded' && t.label === '$(date +%F)' && t.explanation.startsWith('Pattern'))!;
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
    // (The pattern, which says what its hole would: the reader's own token, and no second, bash's.)
    assert.strictEqual(nodes.filter((n) => n.layer === 'language' && n.label === '$a').length, 1);
  });

  it('a command inside `[ ]`, `test` or `$( )` says each risk of its holes once, as it does alone', () => {
    // The sentences of the inner command's own tokens (its subtree, from the token that names it).
    const sentences = (line: string, name: string, a: Analyzer): string[] => {
      const all = walk(explained(line, a).items);
      const at = all.filter((t) => t.kind === 'command' && t.label === name).pop()!;
      return walk(at.children).map((t) => t.explanation);
    };
    const pairs: [string, string, string][] = [
      ['grep "^$a" f', 'grep', '[ -z "$(grep "^$a" f)" ]'],
      ['grep "^$a" f', 'grep', 'test -z "$(grep "^$a" f)"'],
      ['sed -n "${n}p" f', 'sed', '[ "$(sed -n "${n}p" f)" = x ]'],
      ['sed -n "${n}p" f', 'sed', 'test "$(sed -n "${n}p" f)" = x'],
    ];
    for (const a of [en, ja]) {
      for (const [alone, name, inside] of pairs) {
        const expected = sentences(alone, name, a);
        assert.deepStrictEqual(sentences(inside, name, a), expected, inside);
        // The first hole says its risk in full (and not "the same way").
        assert.ok(expected.some((e) => /regex|sed|正規表現|スクリプト|アドレス|address|line number|行番号/i.test(e) && !/read the same way|同じように読/.test(e)), alone);
      }
    }
    // A risk a hole said before the test stays said: the later hole only names the first.
    const later = walk(explained('grep "^$a" f; [ -z "$(grep "^$b" f)" ]').items).filter((t) => t.label === '$b').map((t) => t.explanation);
    assert.deepStrictEqual(later, ['The value of `$b`, read like `$a`', 'Expands to the value of `b`']);
    assert.match(sentences('grep "^$a" f', 'grep', en).join('\n'), /The value of `\$a` is read as a regex: `\.`, `\*`, `\[` and the like in the value have their special meaning/);
    assert.match(sentences('grep "^$a" f', 'grep', ja).join('\n'), /特別な意味を持つ/);
  });

  it('in zsh a word with an expansion stays unread: `$a[1]` is a subscript and `$a:t` a modifier there', () => {
    const src = '#!/bin/zsh\ngrep "$a[1].b"\ngrep "$a:t"\n';
    for (const [i, word] of [[1, '"$a[1].b"'], [2, '"$a:t"']] as const) {
      const items = walk(new Analyzer('en').explainLine(parser.parse(src), i, 'zsh').items);
      assert.deepStrictEqual(items.map((t) => [t.label, t.explanation]), [
        ['grep', 'Print lines matching a pattern (regex)'],
        [word, 'search pattern (regex)'],
        [word, 'Double-quoted string: `$vars` and `$(…)` expand, but no word splitting or globbing (stays one argument)'],
        ['$a', 'Expands to the value of `a`'],
      ]);
    }
  });

  it('says it in Japanese', () => {
    const items = walk(explained('sed "s/$a/$b/"; find . -name "$c*"; date +"$d"; printf "$e"; echo -e "\\t$f"; tr "$g" x; grep "[$h]*$i*"; sed "1i $j"; sed -n "${k}p"; awk "{print \\"$l\\"}"; perl -pe "s/a/$m/"', ja).items);
    const said = items.map((t) => t.explanation).join('\n');
    for (const text of ['特別な意味を持つ', '一致した部分全体', 'パターンの一部として読まれる', '表示書式の一部になる', '書式の一部になる', 'エスケープとして読まれる', '値の中の `a-z`', 'この集合に加わる', '最後の要素', 'テキストをそこで終わらせる', 'アドレスの位置にある', 'awk の文字列に入る', 'ダブルクォートの文字列として読む']) assert.ok(said.includes(text), text);
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
        lang: 'en', flavor: () => 'bre', trSet: () => ({ role: 'from', sets: [], complement: false, truncate: false }), letters: () => new Set(), given: () => false, records: () => false, bash: () => undefined, awkGnu: () => true, shell: undefined, invalid: () => 'plain' as never, reached: () => true,
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
      assert.deepStrictEqual(Object.keys(claimed).filter((k) => claimed[k]).sort(), ['awk', 'bazeltarget', 'date', 'echo', 'glob', 'perl', 'printf', 'regex', 'sed', 'trset']);
    });
    describe('a script that holds a noncharacter a hole is written as: the parser masks it (`maskCarried`), so no reader takes it for one', () => {
      const words = (c: string): string[] => [
        `case x in ${c}*) ;; esac`, `[[ x == ${c}* ]]`, `[[ x =~ ${c}* ]]`, `echo \${x#${c}}`, `ls ${c}*`, `echo $'\\n${c}'`,
        `sed 's/${c}/b/'`, `sed "s/${c}$x/b/"`, `grep "${c}$x" f`, `find . -name '${c}*'`, `date +'${c}%F'`, `printf '${c}%s' a`,
      ];
      const look = (line: string): void => {
        const all = allTokens(line);
        assert.deepStrictEqual(all.filter((t) => !t.explanation).map((t) => t.label), [], `${line}: a row with nothing to say`);
        assert.ok(!all.some((t) => /[\ufdd2-\ufdef]/.test(t.label)), `${line}: a raw one in a label`);
      };
      it('every word that a reader reads, over the whole range', () => {
        for (let k = 0xfdd0; k <= 0xfdef; k++) words(String.fromCharCode(k)).forEach(look);
      });
      it('what is left of it is the text, as `\ufffd`', () => {
        assert.strictEqual(maskCarried('a\ufdd2b\ufdefc'), 'a\ufffdb\ufffdc');
        for (const line of ['case x in \ufdd2*) ;; esac', '[[ x == \ufdd2* ]]', 'ls \ufdd2*']) assert.ok(allTokens(line).some((t) => t.explanation === 'The text `\ufffd` itself'), line);
      });
      it('a value decoded by `$\'…\'` is no hole either', () => {
        for (const line of ["ls $'\\uFDD2'*", "case x in $'\\uFDD2'*) ;; esac", "[[ x == $'\\uFDD2'* ]]", "[[ x =~ $'\\uFDD2'* ]]", "echo \${x#$'\\uFDD2'}", "PS1=$'\\uFDD2'", "sed $'s/\\uFDD2/b/'", "grep $'\\uFDD2' f"]) {
          assert.deepStrictEqual(allTokens(line).filter((t) => !t.explanation).map((t) => t.label), [], line);
        }
      });
      it('a word of a hole beside it keeps its places', () => {
        assert.deepStrictEqual(shape('grep "\ufdd2$x" f'), ['\ufffd 6-7', '$x 7-9']);
      });
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
      assert.ok(hosted('FROM a\nRUN sed "s/$a/b/" f\n', 'Dockerfile', 1).some((t) => t.label === '$a' && /^Pattern \(regex\) `\$a`: /.test(t.explanation)));
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
      assert.ok(hosted('all:\n\tsed "s/$$x/b/" f\n', 'Makefile', 1).some((t) => /^Pattern \(regex\) `\$x`: /.test(t.explanation)));
    });
  });

  describe('what the review with the real tools found', () => {
    /** The text a word's rows give, all of them. */
    const said = (line: string): string => allTokens(line).map((t) => t.explanation).join(' | ');
    /** Each row: what the line says or not, and what the real tool does, which decides it. */
    interface Case { line: string; has?: RegExp; hasNot?: RegExp; tools: Tool[] }
    const table = (name: string, rows: Case[]): void => {
      describe(name, () => {
        for (const row of rows) {
          it(row.line, () => {
            if (row.has) assert.match(said(row.line), row.has);
            if (row.hasNot) assert.doesNotMatch(said(row.line), row.hasNot);
          });
        }
        it('what the tools do', () => {
          const cases = rows.flatMap((row) => row.tools.map((tool) => ({ line: row.line, tool })));
          runAll(cases).forEach((got, i) => check(cases[i].line, got, cases[i].tool));
        });
      });
    };
    /** Runs `script` in a new folder that holds `files`; its output. */
    const inFolder = (files: string[], script: string): string => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hole-words-'));
      try {
        for (const f of files) fs.writeFileSync(path.join(dir, f), '');
        return run('bash', ['-c', `cd ${q(dir)}\n${script}`], { check: true }).stdout.toString();
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    };

    describe('find has no extended globs', () => {
      const FILES = ['ab', 'ax(b)', 'a', 'a!(x)', 'x(1).txt', 'x1.txt'];
      for (const [line, x, out] of [
        ['find . -name "$x?(b)"', 'a', './ax(b)\n'],
        ['find . -name "$x!(x)"', 'a', './a!(x)\n'],
        ['find . -name "$x*(1).txt"', 'x', './x(1).txt\n'],
      ]) {
        it(line, () => {
          assert.doesNotMatch(said(line), /extended glob/);
          assert.strictEqual(inFolder(FILES, `x=${x}; ${line}`), out);
        });
      }
      it('nor one without a hole', () => {
        assert.doesNotMatch(said(`find . -name 'a?(b)'`), /extended glob/);
        assert.strictEqual(inFolder(FILES, `find . -name 'a?(b)'`), './ax(b)\n');
      });
    });

    const DASH = /starts with `-`/;
    table('a word is an option only as the command\'s parser says', [
      { line: 'echo -e "$x\\n"', hasNot: DASH, tools: [{ x: '-n', out: '-n\n\n' }] },
      { line: 'echo -e "$x\\tb"', hasNot: DASH, tools: [{ x: '-n', out: '-n\tb\n' }] },
      { line: 'env printf "$x\\n"', hasNot: DASH, tools: [{ x: '-q', out: '-q\n' }] },
      { line: 'printf "$x\\n"', has: /If the value of `\$x` starts with `-`, `printf` reads this word as options/, tools: [{ x: '-q', fails: true }] },
      { line: 'grep "$x\\.log"', has: DASH, tools: [{ x: '-q', input: 'a.log\n', fails: true }] },
    ]);

    table('a value beside other text in a part', [
      { line: 'perl -pe "s/b/x$x/"', has: /The value of `\$x` goes into the replacement, which perl reads as a double-quoted string: `\$`, `@` and `\\` in it are special/, tools: [{ x: '$0', input: 'abc\n', out: 'ax-ec\n' }] },
      { line: 'sed "1i $x foo"', has: /The value of `\$x` goes into this text: sed reads a `\\` in it, and a newline ends the text/, tools: [{ x: 'p\\tq', input: 'a\n', out: 'p\tq foo\na\n' }] },
      { line: 'tr "a$x" Z', has: /The value of `\$x` is read as part of the set: `a-z`, `\[:upper:\]` and `\\` work in it too/, tools: [{ x: 'b', input: 'abc', out: 'ZZc' }, { x: 'b-d', input: 'abcde', out: 'ZZZZe' }] },
    ]);

    const FORMAT = /a `%` in it is a conversion that takes an argument, and a `\\` starts an escape/;
    table('a format of printf is printf\'s', [
      { line: 'printf "$x"', has: FORMAT, hasNot: /What follows/, tools: [{ x: 'a\\tb', out: 'a\tb' }, { x: '%d', out: '0' }] },
      { line: 'printf "%s$x" a', has: FORMAT, hasNot: /What follows|is read as a conversion/, tools: [{ x: '\\t', out: 'a\t' }] },
      { line: 'printf "%%$x"', has: FORMAT, hasNot: /What follows|is read as a conversion/, tools: [{ x: '\\t', out: '%\t' }] },
      { line: `printf '%s'"$x" a`, has: FORMAT, hasNot: /What follows|is read as a conversion/, tools: [{ x: '\\t', out: 'a\t' }] },
      { line: 'printf "$x%s" a', has: /What follows is read as if the value held no `%`/, tools: [{ x: '%', out: '%s' }] },
    ]);

    const ASSUMED = /no group, no alternation \(`\|`\) and no newline of its own/;
    table('what stands around a value that is more than one alternative', [
      { line: 'grep -E "^$x"', has: ASSUMED, tools: [{ x: 'a|c', input: 'ab\ncb\nb/c\nz\n', out: 'ab\ncb\nb/c\n' }] },
      { line: 'grep "^$x"', has: ASSUMED, tools: [{ x: 'a\\|c', input: 'ab\ncb\nb/c\nz\n', out: 'ab\ncb\nb/c\n' }, { x: 'foo\nc', input: 'foo\nb/c\nz\n', out: 'foo\nb/c\n' }] },
      { line: 'grep -E "$x$"', has: ASSUMED, tools: [{ x: 'a|c', input: 'ab\nc\nz\n', out: 'ab\nc\n' }] },
      // (A delimiter says the newline: it fails.)
      { line: 'sed "s/^$x/Z/"', has: /no group, no alternation \(`\|`\) of its own/, tools: [{ x: 'a\\|c', input: 'ab\nbc\n', out: 'Zb\nbZ\n' }, { x: 'a\nc', input: 'a\n', fails: true }] },
    ]);

    const RANGE = /`1,5`/;
    table('an address that is a value', [
      { line: 'sed "1,${x}d"', hasNot: RANGE, tools: [{ x: '1,2', input: 'a\nb\n', fails: true }, { x: '2', input: 'a\nb\nc\n', out: 'c\n' }, { x: '/b/', input: 'a\nb\nc\n', out: 'c\n' }] },
      { line: 'sed "$x,2 d"', hasNot: RANGE, tools: [{ x: '1,2', input: 'a\nb\n', fails: true }, { x: '1', input: 'a\nb\nc\n', out: 'c\n' }] },
      { line: 'sed "${x}d"', has: RANGE, tools: [{ x: '1,2', input: 'a\nb\nc\n', out: 'c\n' }] },
    ]);

    const FOLLOWS = /What follows is read as if the value held no `%`/;
    table('what follows a value in a format of date', [
      { line: 'date -u -d @0 +"$x%F"', has: FOLLOWS, tools: [{ x: '%', out: '%F\n' }, { x: 'Q', out: 'Q1970-01-01\n' }] },
      { line: 'date -u -d @86400 +"${x}d"', has: FOLLOWS, tools: [{ x: '%-', out: '2\n' }, { x: 'Q', out: 'Qd\n' }] },
      { line: 'date -u -d @0 +"%F $x"', hasNot: FOLLOWS, tools: [{ x: '%', out: '1970-01-01 %\n' }] },
    ]);

    it('a pattern of find names the backslash of a value', () => {
      assert.match(said('find . -name "$x*"'), /and a `\\` makes the next character plain/);
      assert.strictEqual(inFolder(['a*', 'ab'], `x='a\\'; find . -name "$x*"`), './a*\n');
    });

    describe('each kind\'s risk once on a line', () => {
      const count = (line: string, re: RegExp): number => allTokens(line).filter((t) => re.test(t.explanation)).length;
      const rows = (src: string, line = 0): number => walk(en.explainLine(parser.parse(src), line).items).length;
      it('a part with only a value in it has one row, and bash\'s under it', () => {
        assert.deepStrictEqual(allTokens('sed "s/$a/b/"').filter((t) => t.label === '$a').map((t) => t.origin), ['embedded', 'shell']);
        assert.strictEqual(rows('sed "s/$old/$new/g"'), 13);
      });
      it('later holes of a kind say nothing again', () => {
        const line = 'sed "s/$a/$b/;s/$c/$d/"';
        assert.strictEqual(rows(line), 21);
        assert.strictEqual(count(line, /special meaning/), 1);
        assert.strictEqual(count(line, /ends the pattern early/), 1);
        assert.strictEqual(count(line, /ends the replacement early/), 1);
        const of = (label: string): string => allTokens(line).find((t) => t.origin === 'embedded' && t.label === label)!.explanation;
        assert.strictEqual(of('$c'), 'Pattern (regex) `$c`');
        assert.strictEqual(of('$d'), 'Replacement `$d`');
      });
      it('a later hole that is not a whole part names the first', () => {
        const of = (line: string, label: string): string => allTokens(line).find((t) => t.origin === 'embedded' && t.label === label && t.kind === 'variable')!.explanation;
        assert.strictEqual(of('sed "s/^$a=/b/;s/^$c=/d/"', '$c'), 'The value of `$c`, read like `$a`');
        assert.strictEqual(of('find . -name "$p*" -o -name "$q*"', '$q'), 'The value of `$q`, read like `$p`');
        assert.deepStrictEqual(allTokens('grep "^$x$x"').filter((t) => t.origin === 'embedded' && t.label === '$x').map((t) => t.explanation).slice(1), ['The value of `$x`, read the same way']);
      });
      it('what a later hole adds is said: another delimiter, or what stands around it', () => {
        assert.match(said('sed "s/$a/b/;s|$c|d|"'), /Pattern \(regex\) `\$c`: A `\|` or a newline in it ends the pattern early/);
        assert.match(said('sed "s/$a/b/;s/^$c=/d/"'), /The value of `\$c`, read like `\$a`\. What stands around it/);
        assert.strictEqual(count('date +"%F $a"; date +"$b%F"', /a `%` in it is read as a conversion/), 2);
        assert.strictEqual(count('date +"$a%F"; date +"%F $b"', /a `%` in it is read as a conversion/), 1);
      });
      it('a repeat keeps what it repeats, and says the rest once', () => {
        assert.deepStrictEqual(allTokens('grep "$a*$b*"').filter((t) => t.label === '*').map((t) => t.explanation.includes('with an empty value')), [true, false]);
      });
      it('the option of a value and the way to pass one as data, once for a command', () => {
        assert.match(said('grep "$a\\.x" f; grep "$b\\.x" g'), /value of `\$a` starts with `-`/);
        assert.doesNotMatch(said('grep "$a\\.x" f; grep "$b\\.x" g'), /value of `\$b` starts with `-`/);
        const notes = allTokens('awk "$a" f; awk "$b" g').map((t) => t.explanation).filter((t) => /depends on the value/.test(t));
        assert.deepStrictEqual(notes.map((t) => t.includes('-v name=value')), [true, false]);
      });
    });

    describe('where it is said', () => {
      it('a value with nothing after it, and plain text before it: no sentence on what stands around it', () => {
        const sample = fs.readFileSync(path.join(__dirname, 'fixtures/sample.sh'), 'utf8');
        const line = sample.split('\n').findIndex((l) => l.startsWith('grep -rn "ERROR $USER"'));
        const all = walk(en.explainLine(parser.parse(sample), line).items).map((t) => t.explanation).join(' | ');
        assert.match(all, /The value of `\$USER` is read as a regex/);
        assert.doesNotMatch(all, /What stands around/);
      });
      it('a group or an anchor before it: the sentence', () => {
        for (const line of ['grep -E "(a)$x"', 'grep "^$x"', 'grep "$x\\.log"']) assert.match(allTokens(line).map((t) => t.explanation).join(' | '), /What stands around/, line);
      });
      it('the word of `tr` names the value once', () => {
        const word = allTokens('tr "$a" x').find((t) => t.label === '"$a"' && t.kind === 'argument')!;
        assert.strictEqual(word.explanation.split('`$a`').length - 1, 1, word.explanation);
      });
    });

    describe('a word that bash gives as one is read, whatever joins it', () => {
      const FORMS = ['"$*"', '"${a[*]}"', '"${!a*}"', '"${!a[*]}"', '"${*:2}"', '"${a[*]:-y}"', '"x${a[*]}y"'];
      it('bash gives one word for each', () => {
        const out = run('bash', ['-c', `count() { echo $#; }; set -- p q r; a=(x y); ab=1; ${FORMS.map((f) => `count ${f}`).join('; ')}; a=(); count "\${a[*]}"; a=(x); count "\${!a[*]:-y}"; set --; count "$*"`], { check: true }).stdout.toString();
        assert.strictEqual(out, '1\n'.repeat(FORMS.length + 3));
      });
      for (const form of [...FORMS, '"${!a[*]:-y}"']) {
        it(`${form} in a regex is a value`, () => {
          assert.ok(allTokens(`grep "^${form.slice(1, -1)}\\.log" f`).some((t) => t.origin === 'embedded' && t.label === (form.includes('x$') ? form.slice(2, -2) : form.slice(1, -1)) && /read as a regex/.test(t.explanation)), form);
        });
      }
      it('`sed "$*"` says its script depends on the value', () => {
        assert.match(said('sed "$*"'), /depends on the value of `\$\*`/);
      });
      it('and what gives one word per element stays unread', () => {
        for (const line of ['grep "^$@" f', 'grep "^${a[@]}" f', 'grep "^${a[@]:-y}" f', 'grep "^${!a@}" f']) assert.deepStrictEqual(shape(line), [], line);
      });
    });

    table('the escapes of each reader, before a value', [
      { line: 'sed "s/a/\\U$x/"', has: /`\\U`|uppercase what follows/, tools: [{ x: 'foo', input: 'a\n', out: 'FOO\n' }] },
      { line: 'sed "s/a/\\u$x/"', has: /uppercase/, tools: [{ x: 'foo', input: 'a\n', out: 'Foo\n' }] },
      { line: 'sed "s/a/\\L$x/"', has: /lowercase/, tools: [{ x: 'FOO', input: 'a\n', out: 'foo\n' }] },
      { line: 'grep -P "\\d$x"', has: /a digit.*read as a regex/, tools: [{ x: 'a', input: '1a\nb\n', out: '1a\n' }] },
    ]);
    it('those read the value', () => {
      assert.ok(shape('sed "s/a/\\U$x/"').includes('$x 11-13'));
      assert.ok(shape('grep -P "\\d$x"').includes('$x 11-13'));
    });
    const STOPS: { line: string; shows: [Tool, Tool] }[] = [
      { line: 'grep -P "(a)\\1$x"', shows: [{ x: '', input: 'aa\nb\n', out: 'aa\n' }, { x: '0', input: 'aa\n', out: '' }] },
      { line: 'grep -P "\\U$x"', shows: [{ x: 'a', input: 'a\n', fails: true }, { x: 'b', input: 'b\n', fails: true }] },
      { line: 'sed "s/a/\\o10$x/"', shows: [{ x: '1', input: 'a\n', out: 'A\n' }, { x: '2', input: 'a\n', out: 'B\n' }] },
      { line: 'sed "s/a/\\d06$x/"', shows: [{ x: '5', input: 'a\n', out: 'A\n' }, { x: '6', input: 'a\n', out: 'B\n' }] },
      { line: 'printf "\\u004$x"', shows: [{ x: '1', out: 'A' }, { x: '2', out: 'B' }] },
      { line: 'printf "\\10$x"', shows: [{ x: '1', out: 'A' }, { x: '2', out: 'B' }] },
    ];
    describe('the escapes that do take the value stay unread', () => {
      for (const { line } of STOPS) it(line, () => assert.deepStrictEqual(shape(line), []));
      it('what the tools do', () => {
        const cases = STOPS.flatMap(({ line, shows }) => shows.map((tool) => ({ line, tool })));
        runAll(cases).forEach((got, i) => check(cases[i].line, got, cases[i].tool));
      });
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
