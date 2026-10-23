import * as assert from 'assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Analyzer } from '../src/analyzer';
import { findIdioms } from '../src/idioms';
import { shellState } from '../src/semantics/state';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { descendants } from '../src/syntax/tree';
import { wordFacts } from '../src/wordfacts';

// Facts about words and pipelines come from the model of the script (splitting and globbing as the options in
// effect make them, what a name runs, the variables a stage sets), not from node types or text. Each case is run
// in bash, which shows both what changes and what must stay.

const parser = createUnbashParser();
const bash = (script: string, cwd?: string): string => spawnSync('bash', ['-c', script], { encoding: 'utf8', cwd }).stdout;
const have = spawnSync('bash', ['-c', ':']).status === 0;

const asPath = (src: string, line = 0) => {
  const tree = parser.parse(src);
  return wordFacts(tree.root, line, 'en', shellState(tree)).some((f) => f.id === 'unquoted-variable-as-path');
};

describe('an unquoted variable as a path follows the options in effect', () => {
  let dir: string;
  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explain-bash-facts-'));
    fs.writeFileSync(path.join(dir, 'f1'), '');
  });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  // Whether bash changes either value by splitting or globbing (the directory holds one file, `f1`).
  const changed = (prelude: string): boolean => {
    const out = bash(`${prelude}; for v in 'x *' '*'; do a=$v; set -- $a; [ "$#" = 1 ] && [ "$1" = "$v" ] || echo changed; done`, dir);
    return out.includes('changed');
  };

  const cases: [string, boolean][] = [
    ['', true],
    ['set -f', true], // still split
    ['IFS=', true], // still globbed
    ['IFS=; set -f', false], // neither: the token says "not split", so the note goes
    ['set -f; IFS=', false],
    ['IFS=; set -f; set +f', true], // back on
  ];
  for (const [prelude, warns] of cases) {
    it(`${prelude || '(default)'}: bash ${warns ? 'splits or globs' : 'leaves it alone'}`, function () {
      if (!have) return this.skip();
      assert.strictEqual(changed(prelude || ':'), warns, 'bash');
      assert.strictEqual(asPath(`${prelude ? `${prelude}\n` : ''}cp $a b`, prelude ? 1 : 0), warns, 'the note');
    });
  }

  it('is about the command the name runs, not the name', function () {
    if (!have) return this.skip();
    // A function named `rm` is called with the words already split (bash: 2 words), so the warning stays.
    assert.strictEqual(bash('rm() { echo $#; }; f="a b"; rm $f'), '2\n');
    assert.strictEqual(asPath('rm() { command rm -i "$@"; }\nrm $f', 1), true);
    assert.strictEqual(asPath('cp $a b'), true);
    // An alias of `rm` is `rm`; one of another command is not.
    assert.strictEqual(asPath('shopt -s expand_aliases\nalias del=rm\ndel $a', 2), true);
    assert.strictEqual(asPath('shopt -s expand_aliases\nalias del=echo\ndel $a', 2), false);
    assert.strictEqual(asPath('/bin/rm $a'), true);
    assert.strictEqual(asPath('command rm $a'), false); // (a wrapper: `command` is the name)
    assert.strictEqual(asPath('echo $a'), false);
  });
});

describe('a prefix assignment is read before the command, only by an expansion', () => {
  const notes = (src: string) => {
    const tree = parser.parse(src);
    return wordFacts(tree.root, 0, 'en', shellState(tree)).some((f) => f.id === 'prefix-assignment-expanded-first');
  };
  const cases: [string, string, boolean][] = [
    ['X=1 echo "\\$X"', '$X', false], // not an expansion: the text `$X`
    ['X=1 echo \\$X', '$X', false],
    ["X=1 echo '$X'", '$X', false],
    ['X=1 echo "$X"', 'old', true],
    ['X=1 echo $X', 'old', true],
    ['X=1 echo "${X:-d}"', 'old', true],
    ['X=1 echo "a$(echo $X)"', 'aold', true],
  ];
  for (const [src, printed, warns] of cases) {
    it(`${src}: bash prints ${printed}`, function () {
      if (!have) return this.skip();
      assert.strictEqual(bash(`X=old; ${src}`).trim(), printed, 'bash');
      assert.strictEqual(notes(src), warns);
    });
  }
});

describe('a variable set at the end of a pipeline is gone after it', () => {
  const warns = (src: string): boolean => /run in subshells/.test(
    new Analyzer('en').explainLine(parser.parse(src), 0).notes.join('\n'));
  const cases: [string, string, boolean][] = [
    // bash prints the text between the brackets: empty when the value is gone.
    ["printf 'a\\n' | while read -r l; do ((count++)); done; echo \"[$count]\"", '[]', true],
    ["printf 'a\\n' | while read -r l; do ((count += 1)); done; echo \"[$count]\"", '[]', true],
    ["printf 'a\\n' | { printf -v m x; }; echo \"[$m]\"", '[]', true],
    ["printf 'a\\n' | { mapfile arr; }; echo \"[${arr[0]}]\"", '[]', true],
    ["printf 'a\\n' | while read -r l; do n=1; done; echo \"[$n]\"", '[]', true],
    ["printf 'a\\n' | read n; echo \"[$n]\"", '[]', true],
    // Not a read: single quotes.
    ["printf 'a\\n' | while read n; do :; done; echo '[$n]'", '[$n]', false],
    // A function called in the last stage sets what its body sets.
    ["g() { gv=1; }; printf 'a\\n' | g; echo \"[$gv]\"", '[]', true],
    ["g() { gv=1; }; printf 'a\\n' | g; gv=2; echo \"[$gv]\"", '[2]', false],
    ["g() { local gv=1; }; printf 'a\\n' | g; echo \"[$gv]\"", '[]', false],
    // A local is not the shell's variable: `local`, `declare`, `typeset` (without `-g`), also with lastpipe off or on.
    ["f() { declare dv=1; }; printf 'a\\n' | f; echo \"[$dv]\"", '[]', false],
    ["f() { typeset dv=1; }; printf 'a\\n' | f; echo \"[$dv]\"", '[]', false],
    ["f() { local dv=1; dv=2; }; printf 'a\\n' | f; echo \"[$dv]\"", '[]', false],
    ["f() { declare -g dv=1; }; printf 'a\\n' | f; echo \"[$dv]\"", '[]', true],
    ["printf 'a\\n' | { declare dv=1; }; echo \"[$dv]\"", '[]', true],
    // A subshell inside the stage keeps what it sets.
    ["f() { ( sv=1 ); }; printf 'a\\n' | f; echo \"[$sv]\"", '[]', false],
    ["printf 'a\\n' | { ( x=1 ); }; echo \"[$x]\"", '[]', false],
    ["printf 'a\\n' | { y=$(z=1); }; echo \"[$z]\"", '[]', false],
    ["printf 'a\\n' | { ( x=1 ); y=2; }; echo \"[$y]\"", '[]', true],
    // Set again before it is read.
    ["printf 'a\\n' | while read n; do :; done; n=2; echo \"[$n]\"", '[2]', false],
    // The last stage runs in the shell.
    ["shopt -s lastpipe; printf 'a\\n' | while read l; do n=1; done; echo \"[$n]\"", '[1]', false],
    // A variable the stage does not set.
    ["printf 'a\\n' | while read n; do :; done; echo \"[$other]\"", '[]', false],
  ];
  for (const [src, printed, expected] of cases) {
    it(`${src}`, function () {
      if (!have) return this.skip();
      assert.strictEqual(bash(src).trim(), printed, 'bash');
      assert.strictEqual(warns(src), expected);
    });
  }
});

describe('idioms follow the tree, not the spelling', () => {
  const idioms = (src: string): string => {
    const nodes = descendants(parser.parse(src).root, ['command', 'redirected_statement', 'list', 'pipeline', 'while_statement']);
    return findIdioms(nodes, 'en').join('\n');
  };
  it('knows an endless loop however it is spaced or broken over lines', function () {
    if (!have) return this.skip();
    for (const src of ['while true; do break; done', 'while  true ; do break; done', 'while :\ndo break; done', 'while true\ndo\n  break\ndone']) {
      assert.match(idioms(src), /an endless loop/, src);
      // (bash runs each of them as a loop that ends only with `break`.)
      assert.strictEqual(bash(`${src}; echo end`).trim(), 'end', src);
    }
  });
  it('is not fooled by other conditions', () => {
    for (const src of ['while true && false; do :; done', 'while echo true; do :; done', 'while [ true ]; do :; done', 'until true; do :; done']) {
      assert.doesNotMatch(idioms(src), /an endless loop/, src);
    }
  });
  it('reads a file line by line however the loop is laid out', () => {
    assert.match(idioms('while read -r l\ndo\n  :\ndone < f'), /`while read … done < file`/);
    assert.match(idioms('while  IFS= read -r l ;  do :; done  <  f'), /`while read … done < file`/);
    assert.match(idioms('while read -r l\ndo :; done < <(ls)'), /done < <\(command\)/);
    // Not a here-string, and not two redirections.
    assert.doesNotMatch(idioms('while read -r l; do :; done <<< x'), /line by line/);
    assert.doesNotMatch(idioms('while read -r l; do :; done < f > g'), /line by line/);
  });
  it('knows a loop over the arguments and getopts with other spacing', () => {
    assert.match(idioms('while  [ "$#" -gt 0 ]; do shift; done'), /a loop over the arguments/);
    assert.match(idioms('while getopts  ab: opt\ndo :; done'), /`while getopts`/);
    assert.doesNotMatch(idioms('while [ "$#" -gt 1 ]; do shift; done'), /a loop over the arguments/);
  });
});
