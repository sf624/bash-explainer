// A line is explained the same whichever lines were explained before it (docs/design/line-budget.md, "A statement over several lines"): the
// panel and the hover ask for the cursor's line, in any order, of one Analyzer. A statement over several lines is kept for the document and
// read by each of its lines, so a line that wrote to it would change the lines read after, or fail (`line-not-explained`): one Analyzer moving
// forward, backward and shuffled gives what a new one gives for each line, on a document read again.
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { Analyzer, type LineExplanation } from '../src/analyzer';
import { explainDocumentLine } from '../src/document';
import { openDocument, shellsOf } from '../src/document-setup';
import { hostKind } from '../src/hosts';
import type { FileKind } from '../src/hosts/detect';
import { fact } from '../src/messages';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import './support/failures-throw';

const parser = createUnbashParser();
const root = path.join(__dirname, '..');
const OPTS = { sentence: true, reading: true, argv: true };
const NOT_EXPLAINED = fact('en', 'line-not-explained').text;

const rows = (n: number, row: (i: number) => string) => Array.from({ length: n }, (_, i) => row(i)).join('\n');
const file = (...p: string[]) => fs.readFileSync(path.join(root, 'test', 'fixtures', ...p), 'utf8');

/** The shapes of a statement over several lines inside another token (a pattern, a header, a substitution), and of test/line-budget.test.ts. */
const SHAPES: [string, string, FileKind?][] = [
  ['a multi-line pattern in a case in a case', 'for o; do\n  case $o in\n    -d*)\n      case $u in\n        *"\n"enable_$u"\n"*) ;;\n        *) a=1 ;;\n      esac ;;\n  esac\ndone\n'],
  ['a multi-line pattern in a case', 'case $x in\n  "a\nb"*) echo hit ;;\n  *) echo no ;;\nesac\n'],
  ['a pattern with a substitution over lines', 'case $x in\n  $(\n    echo a\n  )|b) echo hit ;;\nesac\n'],
  ['a here-document in a case in a loop', 'for x in a; do\n  case $x in\n    a) cat <<EOF\nUsage $x\nmore\nEOF\n    ;;\n  esac\ndone\n'],
  ['continuations in a case branch', 'case $x in\n  a) docker run \\\n    -e A=$y \\\n    img ;;\nesac\n'],
  ['a string over lines in a test', 'if [[ $x == "a\nb" ]]; then\n  echo "c\n$d"\nfi\n'],
  ['a string over lines in a loop header', 'for x in "a\nb" c; do\n  echo "$x"\ndone\n'],
  ['a substitution over lines in a word', 'echo "a $(\n  echo b \\\n  c\n) d" | wc \\\n  -l\n'],
  ['a shell string over lines', 'sudo bash -c \'\ncase $1 in\n  "a\nb") echo x ;;\nesac\n\' _ "$v"\n'],
  ['a function with an array', 'f() {\n  local a=(\n    "x\ny"\n    $z\n  )\n  echo "${a[@]}"\n}\n'],
  ['a loop with a redirection over lines', 'while read -r l; do\n  echo "$l"\ndone <<EOF\na $v\nb\nEOF\n'],
  ['a pipe over lines', 'cat f |\n  while read -r l; do\n    echo "$l"\n  done |\n  sort\n'],
  ['a here-document', `cat <<EOF\n${rows(12, (i) => `Usage line ${i} $v`)}\nEOF\n`],
  ['a string', `echo "\n${rows(12, (i) => `line ${i}`)}\n"\n`],
  ['awk', `awk '\n${rows(12, (i) => `{ print $${i % 9} }`)}\n' f\n`],
  ['sed', `sed '\n${rows(12, (i) => `s/${i}/b/`)}\n' f\n`],
  ['a trap', `trap '\n${rows(12, (i) => `echo ${i}`)}\n' EXIT\n`],
  ['an array', `arr=(\n${rows(12, (i) => `item${i}`)}\n)\n`],
  ['continuations', `docker run \\\n${rows(12, (i) => `  -e X${i}=$v \\`)}\n  img\n`],
  ['a substitution', `x=$(\n${rows(12, (i) => `echo ${i}`)}\n)\n`],
  ['set -u and a word over lines', 'set -u\necho $a \\\n  $b\n'],
  ['a block with a statement over lines', '{ echo $x \\\n  b; echo $y; }\n'],
  ['two statements that meet on a line', '{ a \\\n  b; c \\\n  d\n  e; }\n'],
  ['directives of bats inside statements over lines', '@test "x" {\n  run foo \\\n    -a \\\n    # bats test_tags=a\n    -b\n  a=(\n    one\n    # bats test_tags=b\n    two\n  )\n}\n', 'bats'],
];

const HOSTS = fs.readdirSync(path.join(root, 'test/fixtures/hosts')).sort();

/** The text, the kind, and a name, of each document the table reads. */
const DOCUMENTS: { name: string; text: string; kind: FileKind }[] = [
  ...SHAPES.map(([name, text, kind]) => ({ name, text, kind: kind ?? 'shell' })),
  { name: 'sample.sh', text: file('sample.sh'), kind: 'shell' },
  ...HOSTS.map((f) => ({ name: `hosts/${f}`, text: file('hosts', f), kind: (hostKind('', f) ?? 'shell') as FileKind })),
];

/** The lines of a document in the order of a walk (`forward`, `backward`) or in one that is neither (`shuffled`, the same on every run). */
function order(n: number, how: 'forward' | 'backward' | 'shuffled'): number[] {
  const lines = Array.from({ length: n }, (_, i) => i);
  if (how === 'backward') return lines.reverse();
  if (how === 'shuffled') {
    let seed = 12345;
    for (let i = n - 1; i > 0; i--) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      const j = seed % (i + 1);
      [lines[i], lines[j]] = [lines[j], lines[i]];
    }
  }
  return lines;
}

const said = (e: LineExplanation) => JSON.stringify({ ...e, examples: e.examples.map(({ interactive: _, ...x }) => x) });

/** The explanation of each line, by an Analyzer that goes through `lines` in order, on a document read for it. */
function through(text: string, kind: FileKind, lines: readonly number[]): Map<number, string> {
  const doc = openDocument(text, kind, (t) => parser.parse(t));
  const shells = shellsOf(doc.lines, 'x', undefined);
  const an = new Analyzer('en');
  return new Map(lines.map((l) => [l, said(explainDocumentLine(an, doc, l, 'en', shells, OPTS))]));
}

describe('a line is explained the same in any order', () => {
  for (const { name, text, kind } of DOCUMENTS) {
    it(name, function () {
      // sample.sh (127 lines) takes 6.5-8.5 s locally and hit mocha's 10 s on CI under load: the baseline reads the document anew for every line
      // (127 parses and cold Analyzers), which is what the test checks, so it is not made cheaper; the limit leaves a margin of several times.
      this.timeout(60000);
      const n = text.split('\n').length;
      // (A new Analyzer for each line, on a tree read for it: nothing kept from another line.)
      const fresh = new Map(Array.from({ length: n }, (_, l) => [l, through(text, kind, [l]).get(l)!] as const));
      for (const [l, got] of fresh) assert.ok(!got.includes(NOT_EXPLAINED), `fresh, line ${l + 1}`);
      for (const how of ['forward', 'backward', 'shuffled'] as const) {
        const got = through(text, kind, order(n, how));
        for (const [l, one] of got) {
          assert.ok(!one.includes(NOT_EXPLAINED), `${how}, line ${l + 1} is not explained`);
          assert.ok(one === fresh.get(l), `${how}, line ${l + 1} differs from a new Analyzer's`);
        }
      }
    });
  }
});

describe('what a line says of a part of a kept token that lies under a token of the line', () => {
  it('is on a copy of it, and the kept token stays as it was', () => {
    const tree = parser.parse('for o; do case $x in\n  $(\n   cat $a;\n   rm -rf $b/\n  )) ;;\nesac; done\n');
    const an = new Analyzer('en');
    const factsOf = (l: number) => {
      const out: [string, string[]][] = [];
      const walk = (t: LineExplanation['items'][number]) => {
        if (t.facts) out.push([t.label, t.facts]);
        t.children.forEach(walk);
      };
      an.explainLine(tree, l, 'bash', OPTS).items.forEach(walk);
      return out;
    };
    // (The lines inside the pattern, asked in turn, then again: each has the facts about its own word only.)
    for (const l of [2, 3, 2, 3]) {
      assert.deepStrictEqual(factsOf(l), [[l === 2 ? '$a' : '$b/', ['unquoted-variable-as-path']]], `line ${l + 1}`);
    }
    assert.deepStrictEqual(factsOf(4), []);
  });
});
