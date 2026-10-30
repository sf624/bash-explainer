// What the explanations say about words, from the word model (src/semantics/words.ts): splitting and globbing by
// context, tildes, glob options, redirection targets. What bash does with each case is in the probes
// (test/fixtures/probes/words.json, checked by test/word-probes.test.ts) and in the cases run here.
import * as assert from 'assert';
import { runBash } from './support/bash';
import { Analyzer } from '../src/analyzer';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { allTokens } from './support/explain';
import { braceSequence } from '../src/examples/shellwords';

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
    // `~1` is an entry of the directory stack (6.8).
    assert.deepStrictEqual(labels('echo ~1', '~1'), ['text to print', 'Tilde expansion: `~1` becomes entry 1 of the directory stack, counted from the left of `dirs` from 0 (what `dirs +1` shows; unchanged if there is no such entry)']);
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

  it('says that an unquoted expansion inside a `[…]` of a pattern gives characters of its set', () => {
    // (With y='*', `[$y]` matches only a `*`; with y=a-c, a range.)
    assert.strictEqual(bash("y='*'; [[ a == [$y] ]] || echo 1; [[ '*' == [$y] ]] && echo 2; y=a-c; case b in [$y]) echo 3;; esac"), '1\n2\n3\n');
    // (But a `!` or `^` first negates the set, a `]` ends it, and `[:digit:]` is a class: the note says so.)
    assert.strictEqual(bash("y='!a'; [[ b == [$y] ]] && echo 1; [[ a == [$y] ]] || echo 2; y='^a'; [[ b == [$y] ]] && echo 3; y='a]'; [[ 'a]' == [$y] ]] && echo 4; [[ a == [$y] ]] || echo 5; y='[:digit:]'; [[ 5 == [$y] ]] && echo 6; [[ a == [$y] ]] || echo 7; y=']a'; [[ ']' == [$y] ]] && echo 8; y=']'; [[ ']' == [$y] ]] && echo 9; [[ ']' == [!$y] ]] || echo 10"), '1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n');
    const inside = /\. Unquoted here, its value is read as part of the pattern: inside the `\[…\]` of `\[!\$y\]`, its characters join the set \(a `\*` or `\?` in it is that character; a range such as `a-c` works; but a `!` or `\^` at the start of the set negates it, a `\]` after the first character ends it, and `\[:digit:\]` is a class\)$/;
    assert.match(expl('[[ $x == [!$y] ]]', '$y'), inside);
    assert.match(expl('case $x in a[$y]*) ;; esac', '$y'), /inside the `\[…\]` of `\[\$y\]`, its characters join the set/);
    assert.match(expl('case $x in [$y]) ;; esac', '$y', 'ja'), /`\[\$y\]` の `\[…\]` の中なので、値の文字は集合の文字になる/);
    // (Outside one, and in a file name glob, not so.)
    assert.match(expl('[[ $x == [a]$y ]]', '$y'), /\(`\*`, `\?` and `\[…\]` in it match/);
    assert.doesNotMatch(expl('ls [$y]', '$y'), /join the set/);
  });

  it('expands a tilde after a `:` of an assignment that starts with an expansion', () => {
    assert.deepStrictEqual(labels('PATH=$PATH:~/bin', '~'), ['Tilde expansion (after `:`): `~` becomes the home directory (`$HOME`)']);
    assert.strictEqual(bash('P=/p; PATH2=$P:~/bin; echo $PATH2'), '/p:/home/w/bin\n');
  });
});

describe('word notes: line continuations, sequences past intmax_t, here-strings and array elements', () => {
  const said = (src: string): string[] => allTokens(explain(src).items).map((t) => t.explanation);
  const examples = (src: string): string[] => explain(src).examples.flatMap((e) => e.sections.map((s) => `${s.label} → ${s.lines.join(' ') || s.empty}`));
  const TILDE = '`~` becomes the home directory (`$HOME`)';

  it('reads a sequence, a tilde and a glob without their line continuations', () => {
    assert.ok(said('echo {1..\\\n3} {1\\\n0..12}').includes('Brace expansion: `{1..3}` expands to 3 words: `1` `2` `3`'));
    assert.ok(said('echo {1..\\\n3} {1\\\n0..12}').includes('Start: `10`'));
    assert.strictEqual(bash('echo {1..\\\n3} {1\\\n0..12}'), '1 2 3 10 11 12\n');
    const t = allTokens(explain('echo a\\\n=~').items).find((x) => x.label === '~')!;
    assert.deepStrictEqual([t.explanation, t.span.start], [`Tilde expansion (after \`=\`): ${TILDE}`, { line: 1, character: 1 }]);
    assert.strictEqual(bash('echo a\\\n=~'), 'a=/home/w\n');
    assert.ok(said('echo *.t\\\nxt').includes('The text `.txt` itself'));
    assert.ok(!said('echo *.t\\\nxt').some((x) => /not a pattern symbol/.test(x)));
    assert.strictEqual(bash('echo *.t\\\nxt'), 'a.txt b.txt\n');
    assert.ok(said('shopt -s extglob\necho +\\\n(a).txt').some((x) => x.includes('Extended glob: `+(a)` is `a` repeated one or more times')));
    assert.strictEqual(bash('shopt -s extglob\necho +\\\n(a).txt'), 'a.txt\n');
  });

  it('keeps a sequence bash refuses as it is written, and counts past 2^53 exactly', () => {
    assert.ok(!said('echo {0..2..9223372036854775808} {a..c..9223372036854775808}').some((x) => x.startsWith('Brace expansion')));
    assert.strictEqual(bash('echo {0..2..9223372036854775808} {a..c..9223372036854775808}'), '{0..2..9223372036854775808} {a..c..9223372036854775808}\n');
    assert.ok(said('echo {9007199254740993..9007199254740991..2}').includes('Brace expansion: `{9007199254740993..9007199254740991..2}` expands to 2 words: `9007199254740993` `9007199254740991`'));
    assert.ok(said('echo {0..2..9223372036854775807}').includes('Increment: `9223372036854775807` (each word is 9223372036854775807 more than the one before)'));
    assert.ok(said('echo {a..e..-9223372036854775807}').includes('Increment: `-9223372036854775807` (every 9223372036854775807th letter, counting up); its sign does not count: the start and the end set the direction'));
    assert.strictEqual(bash('echo {9007199254740993..9007199254740991..2} {0..2..9223372036854775807} {a..e..-9223372036854775807}'), '9007199254740993 9007199254740991 0 a\n');
  });

  it('says that a here-string has a tilde after each `:`, not after `=`, and reads its line so', () => {
    assert.deepStrictEqual(labels('cat <<< x:~', '~'), [`Tilde expansion (after \`:\`): ${TILDE}`]);
    assert.deepStrictEqual(labels('cat <<< ~/x', '~/x'), [`Tilde expansion: ${TILDE}. The rest, \`/x\`, stays as it is`]);
    assert.deepStrictEqual(labels('cat <<< a=~', '~'), []);
    assert.strictEqual(bash('cat <<< x:~; cat <<< ~/x; cat <<< a=~'), 'x:/home/w\n/home/w/x\na=~\n');
    assert.ok(!examples('read a b <<< x:~').some((x) => x.includes('x:~')));
  });

  it('says that an element with a subscript has its tilde expanded after `=` and `:`, but in POSIX mode', () => {
    assert.deepStrictEqual(labels('r=([0]=~ [1]=x:~ [2]=~a@b)', '~'), [`Tilde expansion (after \`=\`): ${TILDE}`, `Tilde expansion (after \`:\`): ${TILDE}`]);
    assert.deepStrictEqual(labels('set -o posix; r=([0]=~)', '~'), []);
    assert.strictEqual(bash('r=([0]=~ [1]=x:~); echo "${r[@]}"'), '/home/w x:/home/w\n');
    assert.strictEqual(bash('r=([0]=~); echo "${r[@]}"', true), '~\n');
  });

  it("shows the word of `${x:+word}` in an assignment's value with its tildes", () => {
    assert.ok(examples('a=${x:+x:~}').includes('When `x=/data` → x:$HOME (expanded)'));
    assert.ok(examples("a=${x:+'a:'~:\\:~:~}").includes("When `x=/data` → 'a:'~:\\:~:$HOME (expanded)"));
    assert.ok(examples('echo ${x:+x:~}').includes('When `x=hello` → x:~'));
    assert.strictEqual(bash("x=1; a=${x:+x:~}; b=${x:+'a:'~:\\:~:~}; echo $a $b ${x:+x:~}"), 'x:/home/w a:~::~:/home/w x:~\n');
  });

  it('reads a pattern of `[[ == ]]` without its line continuations: no quoting, and its examples', () => {
    const src = 'v=x; [[ $v == @\\\n(x|y) ]]';
    assert.ok(examples(src).includes('Values that match → x y'), examples(src).join('\n'));
    assert.ok(!examples(src).some((x) => x.includes('\\')));
    assert.strictEqual(bash('shopt -s extglob; v=x; [[ $v == @\\\n(x|y) ]] && echo m; v=x.bak; [[ $v == @\\\n(x|y) ]] || echo n'), 'm\nn\n');
    const star = 'v=app; [[ $v == a\\\n* ]]';
    assert.ok(!said(star).some((x) => x.includes('literal text')));
    assert.ok(examples(star).some((x) => x.startsWith('Values that match → app')), examples(star).join('\n'));
    assert.strictEqual(bash('v=app; [[ $v == a\\\n* ]] && echo m'), 'm\n');
  });

  it('reads a backslash of a pattern as quoting the one character after it: `a\\\\*` is a pattern', () => {
    const literal = 'the right side is quoted, so it is literal text';
    const mixed = 'the quoted parts of the right side are literal text, the rest is a pattern';
    assert.ok(said("v='a\\xy'; [[ $v == a\\\\* ]]").some((x) => x.includes(mixed)));
    assert.ok(said("v='a\\xy'; [[ $v == a\\\\\\\n* ]]").some((x) => x.includes(mixed)));
    assert.ok(said('[[ $v == a\\* ]]').some((x) => x.includes(literal)));
    assert.ok(said('[[ $v == a\\\\ ]]').some((x) => x.includes(literal)));
    assert.strictEqual(bash("v='a\\xy'; [[ $v == a\\\\* ]] && echo 1; [[ $v == a\\\\\\\n* ]] && echo 2; v='a*'; [[ $v == a\\* ]] && echo 3; v=ab; [[ $v == a\\* ]] || echo 4; v='a\\'; [[ $v == a\\\\ ]] && echo 5"), '1\n2\n3\n4\n5\n');
  });

  it('leaves out the example of a word with a tilde of another directory (`~root`, `~+`)', () => {
    assert.ok(!examples('a=${n:-x:~/d:~root}').some((x) => x.includes('~root')));
    assert.ok(!examples('echo ${n:-~+/x}').some((x) => x.includes('~+')));
    assert.ok(examples('a=${n:-x:~/d:~"r"}').some((x) => x.includes('x:$HOME/d:~"r"')));
    assert.strictEqual(bash('cd /; n=; a=${n:-x:~/d:~root}; b=${n:-x:~/d:~"r"}; echo "$a" ${n:-~+/x} "$b"'), 'x:/home/w/d:/root //x x:/home/w/d:~r\n');
  });
});

describe('word notes: sequences in bash 5.2 and 5.3', () => {
  const parsed = (src: string, version: '5.2' | '5.3', lang: 'ja' | 'en') => new Analyzer(lang).explainLine(parser.parse(src), 0, undefined, { bashVersion: version });
  const said = (src: string, version: '5.2' | '5.3', lang: 'ja' | 'en' = 'en'): string[] => allTokens(parsed(src, version, lang).items).map((t) => t.explanation);
  const BASH53 = process.env.BASH_EXPLAINER_BASH53;
  /** What bash 5.2, and bash 5.3 where it is given, print for `script`. */
  const both = (script: string, b52: string, b53: string): void => {
    assert.strictEqual(bash(script), b52);
    if (BASH53) assert.strictEqual(runBash(script, { program: BASH53 }).stdout, b53);
  };

  it('pads past a C int and lands on the end as each bash does', () => {
    const src = 'echo {0001..2147483648..2147483647}';
    assert.ok(said(src, '5.2').includes('Brace expansion: `{0001..2147483648..2147483647}` expands to 2 words: `0000000001` `-2147483648` (a number with a leading 0 pads all of them with zeros to the same width)'));
    assert.ok(said(src, '5.2').includes('End: `2147483648`'));
    assert.ok(said(src, '5.3').includes('Brace expansion: `{0001..2147483648..2147483647}` expands to 2 words: `0000000001` `2147483648` (a number with a leading 0 pads all of them with zeros to the same width)'));
    assert.ok(said('echo {02147483648..2147483650}', '5.3').some((x) => x.includes('`02147483648` `02147483649` `02147483650`')));
    both(`${src}; echo {02147483648..2147483650}`, '0000000001 -2147483648\n-2147483648 -2147483647 -2147483646\n', '0000000001 2147483648\n02147483648 02147483649 02147483650\n');
  });

  it('says where the bash of the explanation leaves a sequence as written', () => {
    const wide = 'echo {9223372036854775806..0..9223372036854775806}';
    assert.ok(said(wide, '5.2').includes('Brace expansion: `{9223372036854775806..0..9223372036854775806}` expands to 1 word: `{9223372036854775806..0..9223372036854775806}` (bash 5.2 leaves `{9223372036854775806..0..9223372036854775806}` as written, since its start and its end are too far apart for it; bash 5.3 expands it)'));
    assert.ok(!said(wide, '5.2').some((x) => x.startsWith('Start:')));
    assert.ok(said(wide, '5.3').includes('Increment: `9223372036854775806` (each word is 9223372036854775806 less than the one before)'));
    const min = 'echo {2..0..-9223372036854775808}{a,b}';
    assert.ok(said(min, '5.2').some((x) => x.includes('expands to 2 words: `2a` `2b`')));
    assert.ok(said(min, '5.3').some((x) => x.includes('(bash 5.3 leaves `{2..0..-9223372036854775808}` as written, since it refuses the increment `-9223372036854775808`; bash 5.2 expands it)')));
    assert.ok(said('echo {1..3000000000}', '5.3').includes('Brace expansion: `{1..3000000000}` expands to many words'));
    assert.ok(said('echo {1..2147483646}x{0..4294967290..2}', '5.2').some((x) => x.endsWith('(bash 5.2 leaves `{1..2147483646}` as written, since it would make more than 2147483645 words; `{0..4294967290..2}` as written, since it would make more than 2147483645 words; bash 5.3 expands them)')));
    const far = 'echo {0..-9223372036854775808..9223372036854775807}';
    assert.ok(said(far, '5.3').some((x) => x.includes('(bash 5.3 leaves `{0..-9223372036854775808..9223372036854775807}` as written, since its start and its end are too far apart for it; bash 5.2 expands it)')));
    assert.ok(said(wide, '5.2', 'ja').some((x) => x.includes('（bash 5.2 は `{9223372036854775806..0..9223372036854775806}` を、開始と終わりが離れすぎているので展開せず、書いたまま残す。bash 5.3 は展開する）')));
    both(`${wide}; ${min}; ${far}`, '{9223372036854775806..0..9223372036854775806}\n2a 2b\n0 -9223372036854775807\n',
      '9223372036854775806 0\n{2..0..-9223372036854775808}a {2..0..-9223372036854775808}b\n{0..-9223372036854775808..9223372036854775807}\n');
    // (Only bash 5.2 runs these: bash 5.3 would make the words.)
    assert.strictEqual(bash('echo {1..2147483646}x{0..4294967290..2}'), '{1..2147483646}x{0..4294967290..2}\n');
  });

  it('gives the words of a sequence only where both bash give them, when the version is not known', () => {
    assert.deepStrictEqual(braceSequence('{1..3}'), ['1', '2', '3']);
    assert.strictEqual(braceSequence('{0001..2147483648..2147483647}'), null);
    assert.strictEqual(braceSequence('{1..3000000000}'), null);
    assert.strictEqual(braceSequence('{1..1000}'), null);
    assert.deepStrictEqual(braceSequence('{1..3000000000}', '5.2'), ['{1..3000000000}']);
    assert.deepStrictEqual(braceSequence('{2..0..-9223372036854775808}', '5.3'), ['{2..0..-9223372036854775808}']);
  });
});
