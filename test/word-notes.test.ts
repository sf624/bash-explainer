// What the explanations say about words, from the word model (src/semantics/words.ts): splitting and globbing by
// context, tildes, glob options, redirection targets. What bash does with each case is in the probes
// (test/fixtures/probes/words.json, checked by test/word-probes.test.ts) and in the cases run here.
import * as assert from 'assert';
import { runBash } from './support/bash';
import { Analyzer } from '../src/analyzer';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { allTokens } from './support/explain';

const parser = createUnbashParser();
const explain = (src: string, lang: 'ja' | 'en' = 'en', line?: number) => {
  const tree = parser.parse(src);
  return new Analyzer(lang).explainLine(tree, line ?? src.split('\n').length - 1);
};
/** The explanation of the last token labelled `label` on the last line of `src`. */
const expl = (src: string, label: string, lang: 'ja' | 'en' = 'en'): string => {
  const t = allTokens(explain(src, lang).items).filter((x) => x.label === label).pop();
  assert.ok(t, `${label} in ${src}`);
  return t.explanation;
};
const labels = (src: string, label: string): string[] => allTokens(explain(src).items).filter((x) => x.label === label).map((t) => t.explanation);

/** What bash prints for `script`, run in a directory with a few files. */
function bash(script: string, posix = false): string {
  const r = runBash(script, { files: ['a.txt', 'b.txt', 'c.log', '.hidden'], posix });
  return r.status === 0 ? r.stdout : `error: ${r.stderr.trim().replace(/^.*?: line \d+: /, '')}`;
}

describe('word notes: splitting by context', () => {
  it('splits an unquoted expansion only where bash does', () => {
    assert.match(expl('echo $x', '$x'), /\(unquoted, it is word-split and globbed\)$/);
    assert.strictEqual(expl('cat <<< $x', '$x'), 'Expands to the value of `x`');
    assert.strictEqual(bash("x='a  *'; cat <<< $x"), 'a  *\n');
    assert.strictEqual(expl('x=$y', '$y'), 'Expands to the value of `y`');
    assert.strictEqual(expl('[[ $x ]]', '$x'), 'Expands to the value of `x`');
    assert.match(expl('declare "c"=$x', '$x'), /word-split and globbed/);
    assert.strictEqual(bash("x='a  b'; declare \"c\"=$x; declare -p c b"), 'declare -- c="a"\ndeclare -- b\n');
  });

  it('says that a redirection target must be one word, and that POSIX mode neither splits nor globs it', () => {
    assert.match(expl('cat > $x', '$x'), /word-split and globbed; a result that is not exactly one word is an error \(ambiguous redirect\)\)$/);
    assert.match(expl('cat > $x', '$x', 'ja'), /。結果がちょうど1語にならないとエラー（ambiguous redirect））$/);
    assert.strictEqual(bash("x='a b'; echo hi > $x"), 'error: $x: ambiguous redirect');
    assert.match(expl('set -o posix\ncat > $x', '$x'), /\(unquoted, in POSIX mode a redirection target is neither word-split nor globbed\)$/);
    assert.match(expl('set -o posix\ncat > $x', '$x', 'ja'), /POSIX モードではリダイレクト先は単語分割もグロブ展開もされない/);
    assert.strictEqual(bash("x='a b'; echo hi > $x; cat 'a b'", true), 'hi\n');
  });

  it('says when globbing may be off', () => {
    const src = 'if a; then set -f; fi\n';
    assert.match(expl(`${src}echo $x`, '$x'), /it is word-split \(globbing is off on some paths, after `set -f`\)\)$/);
    assert.match(expl(`${src}IFS=:; echo $x`, '$x'), /\(set to `:` on line 2\), not on spaces; globbing is off on some paths, after `set -f`\)$/);
    assert.match(expl(`${src}IFS=; echo $x`, '$x'), /so it is not word-split \(and globbing is off on some paths, after `set -f`\)\)$/);
    assert.match(expl(`${src}IFS=$v; echo $x`, '$x'), /value not known here\); globbing is off on some paths, after `set -f`\)$/);
    assert.match(expl(`${src}IFS=$v; echo $x`, '$x', 'ja'), /グロブ展開が無効になる経路もある/);
    assert.match(expl('set -f; IFS=$v; echo $x', '$x'), /value not known here\); globbing is off after `set -f`\)$/);
    assert.match(expl('IFS=$v; echo $x', '$x', 'ja'), /その文字で分割され、グロブ展開もされる）$/);
    assert.match(allTokens(explain(`${src}echo *`).items).find((t) => t.label === '*')!.explanation, /Glob pattern/);
  });
});

describe('word notes: tildes', () => {
  it('expands a tilde after `=` of an argument that looks like an assignment, in bash mode only', () => {
    const kids = labels('echo x=~/a:~/b', '~');
    assert.deepStrictEqual(kids, ['Tilde expansion (after `=`): `~` becomes the home directory (`$HOME`)', 'Tilde expansion (after `:`): `~` becomes the home directory (`$HOME`)']);
    assert.match(expl('echo x=~/a:~/b', 'x=~/a:~/b'), /It looks like an assignment, so bash expands a `~` after the `=` and after each `:` too/);
    assert.match(expl('echo x=~/a:~/b', 'x=~/a:~/b', 'ja'), /代入の形をした引数/);
    assert.strictEqual(bash('echo x=~/a:~/b --o=~/c'), 'x=/home/w/a:/home/w/b --o=~/c\n');
    assert.deepStrictEqual(labels('set -o posix\necho x=~/a', '~'), []);
    assert.strictEqual(bash('echo x=~/a', true), 'x=~/a\n');
    // A word that is not an argument of a command: `env` is a command too, so its operand is one.
    assert.strictEqual(expl('a=(x=~/y)', 'x=~/y'), 'Word `x=~/y`');
  });

  it('expands a tilde after each `:` of an assignment', () => {
    assert.deepStrictEqual(labels('x=a:~/b', '~'), ['Tilde expansion (after `:`): `~` becomes the home directory (`$HOME`)']);
    assert.deepStrictEqual(labels('x=~/a:~/b', '~'), ['Tilde expansion: `~` becomes the home directory (`$HOME`)', 'Tilde expansion (after `:`): `~` becomes the home directory (`$HOME`)']);
    assert.match(expl('x=~/a:~/b', '~/a:~/b', 'ja'), /^代入する値/);
    assert.strictEqual(bash('x=a:~/b; echo $x'), 'a:/home/w/b\n');
    // `~1` is the directory stack: not explained.
    assert.deepStrictEqual(labels('echo ~1', '~1'), ['text to print']);
  });
});

describe('word notes: globs', () => {
  it('says that an assignment does no file-name expansion', () => {
    assert.strictEqual(expl('x=*.txt', '*.txt'), 'Value `*.txt`. An assignment does no file-name expansion, so `*` and `?` are assigned as they are');
    assert.strictEqual(allTokens(explain('x=*.txt').items).filter((t) => t.label === '*').length, 0);
    assert.strictEqual(bash('x=*.txt; echo "$x"'), '*.txt\n');
  });

  it('says what nullglob, failglob and GLOBIGNORE do', () => {
    assert.match(expl('shopt -s nullglob; ls *.zz', '*.zz'), /with nullglob on, a pattern that matches nothing goes away \(one argument fewer; with no other argument, the command runs with none\)$/);
    assert.strictEqual(bash('shopt -s nullglob; ls *.zz'), 'a.txt\nb.txt\nc.log\n');
    assert.match(expl('shopt -s nullglob; for f in *.zz; do :; done', '*.zz'), /\(the loop does not run for it, and not at all when there is no other word\)$/);
    assert.strictEqual(bash('shopt -s nullglob; for f in *.zz; do echo "[$f]"; done; echo end'), 'end\n');
    assert.match(expl('shopt -s failglob; ls *.zz', '*.zz'), /with failglob on, a pattern that matches nothing is an error, and the command does not run$/);
    assert.match(bash('shopt -s failglob; ls *.zz; echo after'), /no match: \*\.zz$/);
    assert.match(expl('if a; then shopt -s nullglob; fi; ls *.zz', '*.zz'), /goes away on the paths where nullglob is on, and stays as written on the others$/);
    assert.match(expl('shopt -s nullglob; ls *.zz', '*.zz', 'ja'), /nullglob が有効なので/);
    const g = explain("GLOBIGNORE='*.log'; ls *");
    assert.match(allTokens(g.items).find((t) => t.label === '*' && t.kind === 'argument')!.explanation,
      /setting `GLOBIGNORE` turned dotglob on, so it also matches names starting with `\.` \(not `\.` and `\.\.`\); names that match `\*\.log` of `GLOBIGNORE` are left out$/);
    assert.strictEqual(bash("GLOBIGNORE='*.log'; echo *"), '.hidden a.txt b.txt\n');
    const ex = g.examples.find((e) => e.kind === 'glob')!;
    assert.ok(ex.sections[0].lines.includes('.app') && !ex.interactive);
    const log = explain("GLOBIGNORE='*.log'; ls *.log").examples.find((e) => e.kind === 'glob')!;
    assert.ok(!log.sections.some((s) => /^Matching/.test(s.label)) && log.sections[0].lines.includes('app.log'));
    assert.ok(explain('shopt -s dotglob; ls *').examples.find((e) => e.kind === 'glob')!.interactive);
    assert.match(allTokens(explain("GLOBIGNORE='*.log'; ls *", 'ja').items).find((t) => t.label === '*')!.explanation, /`GLOBIGNORE` を設定したので dotglob が有効になり/);
  });

  it('says what a glob or braces in a redirection target do', () => {
    assert.match(expl('echo > *.log', '> *.log'), /`\*\.log` is a glob: it becomes the one file it matches; matching two or more is an error \("ambiguous redirect"\), and matching none leaves the name as it is$/);
    assert.match(expl('echo > *.txt', '> *.txt', 'ja'), /グロブなので/);
    assert.strictEqual(bash('echo hi > *.txt'), 'error: *.txt: ambiguous redirect');
    assert.match(expl('echo > {a,b}', '> {a,b}'), /Brace expansion makes several words of it, so bash reports "ambiguous redirect"$/);
    assert.strictEqual(bash('echo hi > {a,b}'), 'error: {a,b}: ambiguous redirect');
    // (`{a,}` is the one word `a`: bash writes the file `a`.)
    assert.match(expl('echo > {a,}', '> {a,}'), /^Write stdout \(fd 1\) to file `a` \(overwrite\)\. Brace expansion makes `\{a,\}` the one word `a`$/);
    assert.match(expl('echo > {1..9999}', '> {1..9999}'), /Brace expansion makes several words/);
    assert.match(expl('set -o posix\necho > *.log', '> *.log'), /But in POSIX mode a redirection target is not globbed: the file has this very name$/);
    assert.strictEqual(bash('echo hi > *.txt; ls', true), '*.txt\na.txt\nb.txt\nc.log\n');
    assert.doesNotMatch(expl('if a; then set -o posix; fi\necho > *.log', '> *.log'), /POSIX|glob/);
    assert.doesNotMatch(expl('set -f; echo > *.log', '> *.log'), /glob:/);
    assert.doesNotMatch(expl('echo > a.log', '> a.log'), /glob/);
  });
});

describe('word notes: after the review', () => {
  it('says that globbing may be off on a glob word as on an expansion of the same line', () => {
    const src = 'if a; then set -f; fi\necho *.c $x';
    assert.match(allTokens(explain(src).items).find((t) => t.label === '*.c')!.explanation, /globbing is off on some paths, after `set -f` \(there it stays as written\)/);
    assert.match(expl(src, '$x'), /globbing is off on some paths/);
    assert.match(allTokens(explain(src, 'ja').items).find((t) => t.label === '*.c')!.explanation, /グロブ展開が無効になる経路もある/);
  });

  it('says nothing of dotglob on a pattern that starts with `.`', () => {
    assert.doesNotMatch(allTokens(explain('shopt -s dotglob; ls .*').items).find((t) => t.label === '.*')!.explanation, /dotglob/);
    assert.match(allTokens(explain('shopt -s dotglob; ls *').items).find((t) => t.label === '*')!.explanation, /dotglob/);
  });

  it('says that an unquoted expansion in a pattern is a pattern', () => {
    assert.match(expl('case $x in $p) ;; esac', '$p'), /\. Unquoted here, its value is read as a pattern \(`\*`, `\?` and `\[…\]` in it match; quote it to compare text\)$/);
    assert.strictEqual(bash("x='a b'; p='a*'; case $x in $p) echo pattern;; esac; case $x in \"$p\") echo text;; *) echo no;; esac"), 'pattern\nno\n');
    assert.match(expl('[[ $x == $p ]]', '$p', 'ja'), /値はパターンとして読まれる/);
    assert.match(expl('[[ $x =~ $re ]]', '$re'), /\. Unquoted here, its value is read as a regex$/);
    assert.match(expl('[[ $x =~ $re ]]', '$re', 'ja'), /値は正規表現として読まれる$/);
    assert.strictEqual(bash('x=abc; re="a.c"; [[ $x =~ $re ]] && echo regex; [[ $x =~ "$re" ]] || echo text'), 'regex\ntext\n');
    assert.doesNotMatch(expl('[[ $x == "$p" ]]', '$p'), /pattern/);
    assert.doesNotMatch(expl('[[ $x == $p ]]', '$x'), /pattern/);
  });

  it('expands a tilde after a `:` of an assignment that starts with an expansion', () => {
    assert.deepStrictEqual(labels('PATH=$PATH:~/bin', '~'), ['Tilde expansion (after `:`): `~` becomes the home directory (`$HOME`)']);
    assert.strictEqual(bash('P=/p; PATH2=$P:~/bin; echo $PATH2'), '/p:/home/w/bin\n');
  });
});
