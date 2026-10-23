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
    // (The kinds of statement the analyzer collects on a line.)
    const nodes = descendants(parser.parse(src).root, ['command', 'redirected_statement', 'list', 'pipeline', 'extended_test', 'while_statement']);
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
  it('reads the words as bash makes them, in any order or spelling', function () {
    if (!have) return this.skip();
    // `; pwd` as well as `&& pwd`: both print the script's directory.
    assert.match(idioms('d=$(cd "$(dirname "$0")"; pwd)'), /absolute path of the directory/);
    assert.doesNotMatch(idioms('d=$(cd "$(dirname "$0")"; pwd)'), /moves to the directory/);
    // `-d ''` before `-r` is still `read -r` with IFS empty.
    assert.match(idioms('IFS= read -d "" -r x'), /`IFS= read -r`/);
    assert.match(idioms('IFS="" read -r x'), /`IFS= read -r`/);
    // stderr then stdout to /dev/null prints nothing, as `>/dev/null 2>&1` does.
    assert.strictEqual(bash('command -v sh 2>/dev/null >/dev/null; echo "[$?]"'), '[0]\n');
    assert.match(idioms('command -v sh 2>/dev/null >/dev/null'), /checks quietly/);
    assert.doesNotMatch(idioms('command -v sh 2>/dev/null'), /checks quietly/);
    // Each way of sending both outputs to /dev/null prints nothing; one left on the terminal does not.
    for (const quiet of ['&>>/dev/null', '>&/dev/null', '2>/dev/null >&2', '2>/dev/null 1>&2', '>/dev/null 2>&1']) {
      assert.strictEqual(bash(`command -v sh ${quiet}; type -P sh ${quiet}; command -v nosuch-cmd ${quiet}; echo end`), 'end\n', quiet);
      assert.match(idioms(`command -v sh ${quiet}`), /checks quietly/, quiet);
    }
    for (const loud of ['>&"$f"', '>/dev/null 2>&3', '>/dev/null']) assert.doesNotMatch(idioms(`command -v sh ${loud}`), /checks quietly/, loud);
    // `command sh` and `type sh` run or describe it: not the check.
    assert.doesNotMatch(idioms('command sh -c : >/dev/null 2>&1'), /checks quietly/);
    assert.doesNotMatch(idioms('type sh >/dev/null 2>&1'), /checks quietly/);
    assert.match(idioms('type -P sh >/dev/null 2>&1'), /checks quietly/);
    // stderr through tee is not the log of what is printed; `>>` and `&>>` send stdout through it as `>` and `&>` do.
    assert.match(idioms('exec &> >(tee -a log)'), /everything printed also goes to a log/);
    assert.doesNotMatch(idioms('exec 2> >(tee -a log)'), /everything printed/);
    for (const r of ['>', '>>', '1>>', '&>>']) {
      assert.strictEqual(bash(`exec 3>&1; exec ${r} >(sed 's/^/L:/' >&3); echo hi; exec >&- 2>&-; wait $!`), 'L:hi\n', r);
      assert.match(idioms(`exec ${r} >(tee -a log)`), /everything printed also goes to a log/, r);
    }
    assert.strictEqual(bash(`exec 3>&1; exec 2>> >(sed 's/^/L:/' >&3); echo hi; exec 2>&-; wait $!`), 'hi\n');
    assert.doesNotMatch(idioms('exec 2>> >(tee -a log)'), /everything printed/);
    // A value in the option's word (`-p'…'`), and one known only when it runs.
    assert.match(idioms("read -rp'Sure [y/N] ' ans"), /a yes\/no question/);
    assert.doesNotMatch(idioms('read -r -d "$d" x'), /up to a NUL byte/);
    assert.match(idioms('[ "$0" = "$BASH_SOURCE" ]'), /run directly rather than sourced/);
    assert.match(idioms('exec 1> >(tee -a log) 2>&1'), /everything printed also goes to a log/);
    assert.match(idioms('sudo -u www-data xargs -0 rm -f'), /`xargs -0`/);
  });
  it('knows the common spellings of each idiom, as bash runs them', function () {
    if (!have) return this.skip();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explain-bash-idioms-'));
    try {
      // `cd --`, `dirname --` and `&> /dev/null` on `cd`: still the script's directory.
      const dirOf = '$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )';
      fs.mkdirSync(path.join(dir, 'sub'));
      fs.writeFileSync(path.join(dir, 'sub', 's.sh'), `echo "${dirOf}"\n`);
      assert.strictEqual(bash('bash sub/s.sh', dir), `${fs.realpathSync(dir)}/sub\n`);
      assert.match(idioms(`d=${dirOf}`), /absolute path of the directory/);
      assert.doesNotMatch(idioms(`d=${dirOf}`), /moves to the directory/);
      // `${#}` is `$#`; `(( $# != 0 ))` loops as `(( $# > 0 ))` does.
      for (const cond of ['[ ${#} -gt 0 ]', '(( $# != 0 ))']) {
        assert.strictEqual(bash(`set -- a b; while ${cond}; do printf '[%s]' "$1"; shift; done`), '[a][b]', cond);
        assert.match(idioms(`while ${cond}; do shift; done`), /a loop over the arguments/, cond);
      }
      // `0` (any number that is 0) and `exit` name EXIT.
      for (const sig of ['0', '00', "' 0'", '+0', 'exit', 'Exit']) {
        assert.strictEqual(bash(`trap 'echo bye' ${sig}; echo end`), 'end\nbye\n', sig);
        assert.match(idioms(`trap cleanup ${sig}`), /runs clean-up/, sig);
      }
      for (const sig of ['1', "' exit'"]) {
        assert.notStrictEqual(bash(`trap 'echo bye' ${sig}; echo end`), 'end\nbye\n', sig);
        assert.doesNotMatch(idioms(`trap cleanup ${sig}`), /runs clean-up/, sig);
      }
      // `!=`: sourced or not, the same question.
      fs.writeFileSync(path.join(dir, 'r.sh'), '[[ $BASH_SOURCE != $0 ]] && { echo sourced; return; }\necho direct\n');
      assert.strictEqual(bash('bash r.sh; source r.sh', dir), 'direct\nsourced\n');
      assert.match(idioms('[[ $BASH_SOURCE != $0 ]] && return'), /run directly rather than sourced/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  it('says nothing where bash does something else', function () {
    if (!have) return this.skip();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explain-bash-idioms-'));
    try {
      // `trap - EXIT`, `trap '' EXIT` and `trap -p EXIT` leave nothing to run at the exit; an action does run.
      assert.strictEqual(bash("trap 'echo bye' EXIT; echo end"), 'end\nbye\n');
      assert.match(idioms("trap 'echo bye' EXIT"), /runs clean-up/);
      for (const t of ['trap - EXIT', "trap '' EXIT", 'trap -- - EXIT']) {
        assert.strictEqual(bash(`trap 'echo bye' EXIT; ${t}; echo end`), 'end\n', t);
        assert.doesNotMatch(idioms(t), /runs clean-up/, t);
      }
      // (`-p` prints the action set before, and sets none.)
      assert.strictEqual(bash('trap -p EXIT; echo end'), 'end\n');
      assert.doesNotMatch(idioms('trap -p EXIT'), /runs clean-up/);
      // `-rd''` is the word `-rd`: `-d` takes the next word, so `f` is the delimiter and the line goes to REPLY.
      assert.strictEqual(bash("printf 'abfcd\\0' | { read -rd'' f; echo \"[$REPLY][$f]\"; }"), '[ab][]\n');
      assert.strictEqual(bash("printf 'abfcd\\0' | { read -rd '' f; echo \"[$f]\"; }"), '[abfcd]\n');
      assert.doesNotMatch(idioms("read -rd'' f"), /up to a NUL byte/);
      assert.match(idioms("read -rd '' f"), /up to a NUL byte/);
      // In `[ ]`, `> 0` sends stdout to a file named 0, and `[ $# ]` is true even when `$#` is 0: the loop does not end.
      assert.strictEqual(bash('set -- a; n=0; while [ $# > 0 ]; do shift; n=$((n+1)); [ $n = 3 ] && break; done; echo $n; ls', dir), '3\n0\n');
      assert.strictEqual(bash('set -- a; n=0; while [ $# -gt 0 ]; do shift; n=$((n+1)); done; echo $n'), '1\n');
      assert.doesNotMatch(idioms('while [ $# > 0 ]; do shift; done'), /a loop over the arguments/);
      assert.match(idioms('while [[ $# > 0 ]]; do shift; done'), /a loop over the arguments/);
      // Text in quotes is not run.
      assert.strictEqual(bash("echo '$(mktemp)' IFS= read -r x"), '$(mktemp) IFS= read -r x\n');
      assert.strictEqual(idioms("echo '$(mktemp)' IFS= read -r x"), '');
      assert.match(idioms('t=$(mktemp)'), /`mktemp`/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
