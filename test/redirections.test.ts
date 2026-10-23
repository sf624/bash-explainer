// The redirections of a simple command are its children, wherever they are written (docs/design/syntax-tree.md,
// step 5): before its name, among its words, after them, and around the assignments of a command with no name. What
// the explanation says of them is compared with what bash does.
import * as assert from 'assert';
import { runBash } from './support/bash';
import { allTokens, explain } from './support/explain';

/** What bash prints after `script` runs in a fresh directory, followed by `ls`. */
const filesAfter = (script: string): string => runBash(`${script}\nls`, { files: [] }).stdout;

describe('redirections of a simple command', () => {
  it('are explained with the command, wherever they are written', () => {
    const kinds = [explain('>o echo a 2>e'), explain('echo a >o 2>&1'), explain('2>&1 >o echo'), explain('cmd <in >out'), explain('exec 3>f'),
      explain('exec >log 2>&1'), explain('cat <<E >o | x\nbody\nE'), explain('cmd &> >(tee log)'), explain('&> >(tee log) cmd'), explain('cmd &>> >(tee -a log) x')]
      .map((e) => e.items[0].kind);
    assert.deepEqual(kinds, ['redirect', 'redirect', 'redirect', 'redirect', 'redirect', 'redirect', 'operator', 'redirect', 'redirect', 'command']);
    // A compound command keeps its own: they apply to it as a whole.
    assert.match(explain('{ a; } >f').items[0].explanation, /as a whole/);
    assert.match(explain('if true; then :; fi >f').items[0].explanation, /as a whole/);
    assert.match(explain('f() { :; } >f').items[0].explanation, /each time the function is called/);
    assert.equal(explain('time cmd >f').items[0].kind, 'keyword');
    assert.equal(explain('! cmd >f').items[0].kind, 'operator');
  });

  it('of a command with no name, around or between its assignments', () => {
    assert.equal(explain('a=1 >f b=2').items[0].explanation, 'Several variable assignments');
    assert.match(explain('>f a=1').items[0].explanation, /Redirection applied to `a=1` as a whole/);
    assert.match(explain('>f a=1 >g').items[0].explanation, /Redirection applied to `a=1` as a whole/);
    assert.match(explain('a=1 b=2 >f').items[0].explanation, /Redirection applied to `a=1 b=2` as a whole/);
    assert.match(explain('a=1 >f b=2 2>g').items[0].explanation, /Redirection applied to `a=1 >f b=2` as a whole/);
    assert.equal(explain('>f').items[0].explanation, 'Redirection applied to the command');
    assert.equal(explain('>f >g').items[0].children.length, 2);
  });

  it('are expanded after the assignments of a command with no name, wherever they are written', () => {
    // bash makes the files `f2` and `h5`.
    assert.equal(filesAfter('a=1; a=2 >f$a; >h$d d=5'), 'f2\nh5\n');
    for (const e of [explain('a=1; a=2 >f$a'), explain('>h$d d=5')]) {
      const t = allTokens(e.items).find((x) => x.label === '$a' || x.label === '$d')!;
      assert.match(t.explanation, /The command has no name, so bash does its assignments first and expands its redirections after them/);
    }
    // (Not with a name: `x=1 cmd >$x` expands `$x` before the assignment, which is for the command only.)
    assert.doesNotMatch(allTokens(explain('a=2 echo >f$a').items).find((x) => x.label === '$a')!.explanation, /no name/);
  });

  it('say once where each descriptor ends up, also with one among the words', () => {
    // bash: `cat` reads no file named `b`… and its error goes to `f`, as its output does.
    assert.match(filesAfter('cat > f nofile 2>&1; cat f'), /nofile: No such file or directory/);
    assert.deepEqual(explain('cat > f nofile 2>&1').notes.filter((n) => n.startsWith('Redirections apply')), ['Redirections apply left to right. In the end: stdout → f, stderr → f']);
    // A here-string and more redirections: one note, not one for those after the words too.
    assert.equal(runBash('cat <<< x 2>&1 > f; cat f', { files: [] }).stdout, 'x\n');
    assert.equal(explain('cat <<< x 2>&1 > f').notes.filter((n) => n.startsWith('Redirections apply')).length, 1);
  });

  it('of a pipeline stage that writes elsewhere leave no example of the pipeline', () => {
    // bash: `grep` writes to `out`, so `sort` reads nothing and prints nothing.
    assert.equal(runBash("printf 'x\\nabc x xyz\\n1\\n' > in; grep >out x in | sort", { files: [] }).stdout, '');
    assert.equal(explain('grep >out x in | sort').examples.some((e) => /whole pipeline/.test(e.title)), false);
    assert.equal(explain('>out grep x in | sort').examples.some((e) => /whole pipeline/.test(e.title)), false);
    // (To stderr, or at the last stage, it keeps the example.)
    assert.equal(explain('grep 2>/dev/null x in | sort > out').examples.some((e) => /whole pipeline/.test(e.title)), true);
  });

  it('inside `[ ]` are a misread comparison only when written as one', () => {
    // bash runs `[ -f x ]`, with its stderr to /dev/null.
    assert.equal(runBash('touch x; [ -f x 2>/dev/null ]; echo $?; [ -f y 2>/dev/null ]; echo $?', { files: [] }).stdout, '0\n1\n');
    assert.equal(explain('[ -f x 2>/dev/null ]').notes.some((n) => /inside `\[ \]` is read as a redirection/.test(n)), false);
    assert.equal(explain('[ b > a ]').notes.some((n) => /`>` inside `\[ \]` is read as a redirection/.test(n)), true);
    assert.equal(explain('[ a 2>&1 ]').notes.some((n) => /inside `\[ \]`/.test(n)), false);
    // After the last word, it is the command's: no pitfall either.
    assert.equal(explain('[ a = b ] >/dev/null').notes.some((n) => /inside `\[ \]`/.test(n)), false);
    // But `N>M` reads as a comparison, and bash makes it a redirection of fd N: `[ ]` is false, `[ x ]` true, and the
    // files `3` and `5` appear.
    assert.equal(filesAfter('[ 5>3 ]; echo $?; a=x; [ $a 2>5 ]; echo $?'), '1\n0\n3\n5\n');
    assert.equal(explain('[ 5>3 ]').notes.some((n) => /`5>` inside `\[ \]` is read as a redirection/.test(n)), true);
    assert.equal(explain('[ $a 2>5 ]').notes.some((n) => /`2>` inside `\[ \]` is read as a redirection/.test(n)), true);
  });

  it('after `]` are not part of the label of the test', () => {
    const t = (src: string) => allTokens(explain(src).items).find((x) => x.kind === 'test')!;
    assert.equal(t('[ a = b ] >/dev/null').label, '[ a = b ]');
    assert.equal(explain('[ a = b ] >/dev/null').summary, 'test [ a = b ]');
    assert.equal(explain('[ a = b ] >o && echo y').items[0].label, '[ a = b ] && echo');
    assert.equal(explain('x | [ a ] >o').items[0].label, 'x | [ a ]');
    assert.equal(explain('! [ a ] >o').items[0].label, '! [ a ]');
    // The redirection token around it shows them.
    assert.equal(explain('[ a = b ] >o').items[0].label, '[ a = b ] >o');
    // (Among the words they stay: they are inside the brackets.)
    assert.equal(t('[ -f x 2>/dev/null ]').label, '[ -f x 2>/dev/null ]');
    // A long test is cut to its brackets, without them too.
    assert.equal(t('[ "$some_long_variable_name" = "another long value here" ] >o').label, '[ ‹expression› ]');
  });

  it('written before the name count for the idioms and the pitfalls', () => {
    // bash prints nothing: both outputs go to /dev/null.
    assert.equal(runBash('>/dev/null 2>&1 command -v bash; echo $?').stdout, '0\n');
    assert.ok(explain('>/dev/null 2>&1 command -v jq').notes.some((n) => /checks quietly whether a command is installed/.test(n)));
    assert.ok(explain('>/etc/motd sudo echo hi').notes.some((n) => /not by sudo/.test(n)));
  });
});
