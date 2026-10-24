// The sections of the Bash manual that tokens and facts cite (src/manual.ts, src/refs.ts): every one is a known
// section with a page on gnu.org, and the table follows the bash 5.2 manual itself (bashref.texi, read from a
// bash git checkout given in BASH_SOURCE_DIR; skipped without one).
import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { Analyzer, Token } from '../src/analyzer';
import { BUILTIN_SECTIONS, manualLabel, manualUrl, MANUAL_VERSION, SECTIONS } from '../src/manual';
import { MESSAGES } from '../src/messages';
import { CONSTRUCTS, NODES, OPERATORS } from '../src/refs';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import type { BashParser } from '../src/syntax/tree';

let parser: BashParser;
before(() => {
  parser = createUnbashParser();
});

const tokens = (items: Token[]): Token[] => items.flatMap((t) => [t, ...tokens(t.children)]);

/** The refs of the tokens whose label is `label`, on line `line` of `src` (those that have some, if any do). */
function refsOf(src: string, label: string, line = 0): (readonly string[] | undefined)[] {
  const ex = new Analyzer('en').explainLine(parser.parse(src), line);
  const found = tokens(ex.items).filter((t) => t.label === label);
  assert.ok(found.length, `no token ${label} in ${src}`);
  const refs = found.map((t) => t.refs).filter((r) => r);
  return refs.length ? refs : [undefined];
}

describe('the manual table', () => {
  it('has a page on gnu.org for every section, numbered as in bash 5.2', () => {
    assert.strictEqual(MANUAL_VERSION, '5.2');
    assert.ok(SECTIONS.size > 80);
    for (const [id, s] of SECTIONS) {
      assert.match(id, /^[3-9](\.\d+)*$/);
      assert.strictEqual(s.id, id);
      assert.match(s.url, /^https:\/\/www\.gnu\.org\/software\/bash\/manual\/html_node\/[\w-]+\.html(#[\w-]+)?$/, id);
      assert.strictEqual(manualUrl(id), s.url);
    }
    assert.strictEqual(manualUrl('3.7.2'), 'https://www.gnu.org/software/bash/manual/html_node/Command-Search-and-Execution.html');
    assert.strictEqual(manualUrl('3.6.6'), 'https://www.gnu.org/software/bash/manual/html_node/Redirections.html#Here-Documents');
    assert.strictEqual(manualLabel('en', ['3.7.2', '6.11']), 'Bash manual 3.7.2, 6.11');
    assert.strictEqual(manualLabel('ja', ['3.7.2']), 'Bash マニュアル 3.7.2');
  });

  it('knows every section that a token, a builtin or a fact cites', () => {
    const cited = [
      ...Object.values(CONSTRUCTS), ...Object.values(NODES), ...Object.values(OPERATORS),
      ...Object.values(BUILTIN_SECTIONS).map((s) => [s]), ...Object.values(MESSAGES).map((m) => m.refs), ['4.4', '3.7.1', '3.7.2', '3.7.4', '6.6', '3.3'],
    ];
    for (const refs of cited) for (const id of refs) assert.ok(SECTIONS.has(id), id);
  });

  it('gives every token of the sample a known section', () => {
    const src = fs.readFileSync(path.join(__dirname, 'fixtures/sample.sh'), 'utf8');
    const tree = parser.parse(src);
    const analyzer = new Analyzer('en');
    const seen = new Set<string>();
    src.split('\n').forEach((_, line) => {
      for (const t of tokens(analyzer.explainLine(tree, line).items)) {
        for (const id of t.refs ?? []) {
          assert.ok(SECTIONS.has(id), `${t.label}: ${id}`);
          seen.add(id);
        }
      }
    });
    // The tour cites most of chapter 3.
    assert.ok(seen.size > 30, [...seen].join(' '));
  });
});

describe('the sections of tokens', () => {
  it('cites the subsection of each redirection', () => {
    const cases: [string, string, string][] = [
      ['cat < f', '< f', '3.6.1'], ['echo > f', '> f', '3.6.2'], ['echo >| f', '>| f', '3.6.2'], ['echo >> f', '>> f', '3.6.3'],
      ['echo &> f', '&> f', '3.6.4'], ['echo >& f', '>& f', '3.6.4'], ['echo &>> f', '&>> f', '3.6.5'],
      ['echo 2>&1', '2>&1', '3.6.8'], ['read <&3', '<&3', '3.6.8'], ['echo 2>&-', '2>&-', '3.6.8'], ['echo 3>&1-', '3>&1-', '3.6.9'],
      ['exec 3<> f', '3<> f', '3.6.10'], ['cat <<EOF\nx\nEOF', '<<EOF', '3.6.6'], ['cat <<< x', '<<< x', '3.6.7'],
    ];
    for (const [src, label, id] of cases) assert.deepStrictEqual(refsOf(src, label), [[id]], src);
  });

  it('cites the constructs, operators, quotes and expansions', () => {
    assert.deepStrictEqual(refsOf('if true; then :; fi', 'if'), [['3.2.5.2']]);
    assert.deepStrictEqual(refsOf('while true; do :; done', 'do'), [['3.2.5.1']]);
    assert.deepStrictEqual(refsOf('a | b && c', '|'), [['3.2.3']]);
    assert.deepStrictEqual(refsOf('a | b && c', '&&'), [['3.2.4']]);
    assert.deepStrictEqual(refsOf('[[ -n $a && -n $b ]]', '[[ -n $a && -n $b ]]'), [['3.2.5.2', '6.4']]);
    assert.deepStrictEqual(refsOf('case $x in a) :;; esac', ';;'), [['3.2.5.2']]);
    assert.deepStrictEqual(refsOf("echo 'a' \"$1\" $'\\n' $? ${x}", "'a'"), [['3.1.2.2']]);
    assert.deepStrictEqual(refsOf("echo 'a' \"$1\" $'\\n' $? ${x}", '$1'), [['3.4.1']]);
    assert.deepStrictEqual(refsOf("echo 'a' \"$1\" $'\\n' $? ${x}", '$?'), [['3.4.2']]);
    assert.deepStrictEqual(refsOf("echo 'a' \"$1\" $'\\n' $? ${x}", '${x}'), [['3.5.3']]);
    assert.deepStrictEqual(refsOf('echo $(date) $((1+2)) <(ls)', '$(date)'), [['3.5.4']]);
    assert.deepStrictEqual(refsOf('#!/bin/bash', '#!/bin/bash'), [['3.8']]);
    assert.deepStrictEqual(refsOf('echo $# $10', '$#'), [['3.4.2']]);
    // (bash 5.2's manual has `$_` with the Bash variables; `$_x` is a variable like any other.)
    assert.deepStrictEqual(refsOf('echo $_ $_x', '$_'), [['5.2']]);
    assert.deepStrictEqual(refsOf('echo $_ $_x', '$_x'), [['3.5.3']]);
    assert.deepStrictEqual(refsOf('echo ~/x {a,b}', '~/x'), [['3.5.2']]);
    assert.deepStrictEqual(refsOf('echo ~/x {a,b}', '{a,b}'), [['3.5.1']]);
    assert.deepStrictEqual(refsOf('ls *.txt', '*.txt'), [['3.5.8']]);
    assert.deepStrictEqual(refsOf('# a comment', '# a comment'), [undefined]);
  });

  it('cites what a command name runs: a builtin, a special builtin, a function, an alias', () => {
    assert.deepStrictEqual(refsOf('echo hi', 'echo'), [['4.2']]);
    assert.deepStrictEqual(refsOf('exit 1', 'exit'), [['4.1', '4.4']]);
    assert.deepStrictEqual(refsOf('set -e', 'set'), [['4.3.1', '4.4']]);
    assert.deepStrictEqual(refsOf('export X=1', 'export'), [['4.1', '4.4']]);
    assert.deepStrictEqual(refsOf('declare -i n', 'declare'), [['4.2']]);
    assert.deepStrictEqual(refsOf('f() { :; }\nf', 'f', 1), [['3.3']]);
    assert.deepStrictEqual(refsOf('shopt -s expand_aliases\nalias ll="ls -l"\nll', 'll', 2), [['6.6']]);
    assert.deepStrictEqual(refsOf('./run.sh', './run.sh'), [['3.7.2']]);
    assert.deepStrictEqual(refsOf('$cmd x', '$cmd'), [['3.7.1'], ['3.5.3']]);
    // A program the dictionary describes is not a part of bash.
    assert.deepStrictEqual(refsOf('grep x', 'grep'), [undefined]);
    // An assignment before a command is in its environment (and stays after a special builtin in POSIX mode).
    assert.deepStrictEqual(refsOf('X=1 env', 'X=1'), [['3.7.4']]);
    assert.deepStrictEqual(refsOf('set -o posix\nX=1 export Y', 'X=1', 1), [['3.7.4', '4.4']]);
  });
});

/** makeinfo's file and anchor names: letters and digits as they are, a space as `-`, anything else as `_00xx`. */
const mangle = (s: string): string => [...s].map((c) => (/[A-Za-z0-9]/.test(c) ? c : c === ' ' ? '-' : `_${c.charCodeAt(0).toString(16).padStart(4, '0')}`)).join('');

describe('the manual table against bashref.texi of bash 5.2', function () {
  const dir = process.env.BASH_SOURCE_DIR;
  before(function () {
    if (!dir) this.skip();
  });

  it('has the numbers, titles, pages and builtins of the manual', () => {
    const show = (file: string) => execFileSync('git', ['-C', dir!, 'show', `bash-5.2:${file}`], { encoding: 'utf8' });
    const texi = show('doc/bashref.texi')
      .replace(/^@include rluser\.texi$/m, () => show('lib/readline/doc/rluser.texi'))
      .replace(/^@include hsuser\.texi$/m, () => show('lib/readline/doc/hsuser.texi'));
    const sections = new Map<string, { title: string; url: string }>();
    const builtins: Record<string, string> = {};
    const firstOfNode = new Set<string>();
    let node = '';
    let current = '';
    const num = [0, 0, 0, 0];
    for (const line of texi.split('\n')) {
      const n = /^@node ([^,]+)/.exec(line);
      if (n) node = n[1].trim();
      const s = /^@(chapter|section|subsection|subsubsection) (.*)$/.exec(line);
      if (s) {
        const depth = ['chapter', 'section', 'subsection', 'subsubsection'].indexOf(s[1]);
        num[depth]++;
        num.fill(0, depth + 1);
        const id = num.slice(0, depth + 1).join('.');
        current = id;
        const anchor = firstOfNode.has(node) ? `#${mangle(s[2])}` : '';
        firstOfNode.add(node);
        sections.set(id, { title: s[2], url: `https://www.gnu.org/software/bash/manual/html_node/${mangle(node)}.html${anchor}` });
      }
      const b = /^@btindex (.*)$/.exec(line);
      if (b) builtins[b[1]] = current;
    }
    for (const [id, s] of SECTIONS) assert.deepStrictEqual({ title: s.title, url: s.url }, sections.get(id), id);
    assert.deepStrictEqual(BUILTIN_SECTIONS, builtins);
  });
});
