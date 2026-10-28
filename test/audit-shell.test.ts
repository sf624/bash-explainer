import * as assert from 'assert';
import { execFileSync, spawnSync } from 'child_process';
import type { Token } from '../src/analyzer';
import { Analyzer } from '../src/analyzer';
import type { Shell } from '../src/dialect';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { exampleFor, parseExpansion } from '../src/expansion';
import { allTokens, explain } from './support/explain';
import { runBash } from './support/bash';

/** The innermost token whose label, or the source text it covers, is `label` (a construct is labelled with its skeleton). */
function find(src: string, label: string, lang: 'ja' | 'en' = 'en', line = 0): Token {
  const lines = src.split('\n');
  const text = (x: Token) => x.span.start.line === x.span.end.line ? lines[x.span.start.line].slice(x.span.start.character, x.span.end.character) : undefined;
  const t = allTokens(explain(src, line, lang).items).filter((x) => x.label === label || text(x) === label).pop();
  assert.ok(t, `no token ${label} in ${src}`);
  return t;
}
const bash = (code: string) => execFileSync('bash', ['-c', code]).toString();

describe('shell audit fixes', () => {
  it('"$@" and "${a[@]}" are one word per element, "$*" is one word', () => {
    for (const w of ['"$@"', '"${a[@]}"', '"${!pre@}"', '"${@:2}"']) {
      assert.match(find(`echo ${w}`, w).explanation, /one word per element/, w);
      assert.match(find(`echo ${w}`, w, 'ja').explanation, /要素ごとに別々の単語/, w);
    }
    assert.match(find('echo "$*"', '"$*"').explanation, /stays one argument/);
    assert.match(find('echo "${#a[@]}"', '"${#a[@]}"').explanation, /stays one argument/);
    assert.match(find('echo "${!a[@]}"', '"${!a[@]}"').explanation, /one word per element/);
    assert.match(find('echo "x$y"', '"x$y"').explanation, /stays one argument/);
    assert.strictEqual(bash('set -- a b; printf "[%s]" "$@"'), '[a][b]');
    // Text in the quotes joins the first and the last element, and is one word when there are none.
    assert.match(find('echo "pre$@post"', '"pre$@post"').explanation, /the text before joins the first element, and the text after the last \(with no elements, the text alone makes one word\)$/);
    assert.match(find('echo "pre$@post"', '"pre$@post"', 'ja').explanation, /要素が無ければ文字列だけで1つの単語になる/);
    assert.match(find('echo "$@"', '"$@"').explanation, /no word at all when there are none/);
    assert.strictEqual(bash('set -- a "b c"; printf "[%s]" "pre$@post"; set --; printf "<%s>" "pre$@post"; f() { echo $#; }; f "$@"; f "pre$@post"'), '[prea][b cpost]<prepost>0\n1\n');
  });

  it('subscripted expansions are shown with an array element', () => {
    const ex = exampleFor(parseExpansion('${#a[1]}')!, 'en')!;
    assert.strictEqual(ex[0].when, 'When `a[1]=hello`');
    assert.strictEqual(ex[0].result, '5');
    assert.strictEqual(exampleFor(parseExpansion('${a[$i]:-x}')!, 'en'), undefined);
    assert.strictEqual(exampleFor(parseExpansion('${a[1]@A}')!, 'en'), undefined);
    assert.strictEqual(exampleFor(parseExpansion('${a[1]-x}')!, 'en')![1].when, 'When `a[1]=""`');
  });

  it('arguments cannot be assigned with := or =', () => {
    const t = find('echo ${1:=x}', '${1:=x}');
    assert.match(t.explanation, /cannot assign in this way/);
    assert.match(find('echo ${1:=x}', '${1:=x}', 'ja').explanation, /cannot assign in this way/);
    assert.match(find('echo ${1=x}', '${1=x}').explanation, /cannot assign in this way/);
    assert.match(find('echo ${1:=x}', ':=').explanation, /cannot be assigned to/);
    assert.match(find('echo ${1:=x}', 'x').explanation, /never assigned/);
    assert.match(find('echo ${v:=x}', '${v:=x}').explanation, /assign `x` to it/);
    assert.match(explain('echo ${1:=x}').examples[0].sections[0].lines[0], /cannot assign/);
    assert.match(explain('echo ${@=x}').examples[0].sections[0].lines[0], /cannot assign/);
    assert.match(spawnSync('bash', ['-c', 'echo ${1:=x}']).stderr.toString(), /cannot assign in this way/);
    // The arguments are worded as arguments, not as `@=hello`.
    const ex = exampleFor(parseExpansion('${@:-none}')!, 'en')!;
    assert.deepStrictEqual(ex.map((c) => c.when), ['When there are no arguments or only an empty one', 'When the arguments are `hello`']);
  });

  it('the arguments are worded in Japanese too', () => {
    assert.deepStrictEqual(exampleFor(parseExpansion('${@-x}')!, 'ja')!.map((c) => c.when), ['引数が無いとき', '引数が空の1つだけのとき', '引数が `hello` のとき']);
    assert.strictEqual(exampleFor(parseExpansion('${@:-x}')!, 'ja')![0].when, '引数が無いか、空の1つだけのとき');
  });

  it('an unquoted ~ in the word of ${x-~/d} is the home directory', () => {
    const unquoted = exampleFor(parseExpansion('${x-~/d}')!, 'en')!;
    assert.strictEqual(unquoted[0].result, '$HOME/d (expanded)');
    const quoted = exampleFor(parseExpansion('${x-~/d}')!, 'en', { quoted: true })!;
    assert.strictEqual(quoted[0].result, '~/d');
    assert.strictEqual(bash('unset x; HOME=/h; echo ${x-~/d} "${x-~/d}"'), '/h/d ~/d\n');
  });

  it('${!a[@]:-x} and ${!v:-x} are indirection with an operator', () => {
    assert.match(find('echo "${!a[@]:-x}"', '${!a[@]:-x}').explanation, /not the list of indices.*invalid variable name/);
    assert.match(find('echo "${!v:-x}"', '${!v:-x}').explanation, /Indirection: use the value of `v` as a variable name `<name>`\. Then: Use `x` if `<name>` is unset or empty/);
    assert.match(find('echo "${!a[@]:-x}"', '${!a[@]:-x}', 'ja').explanation, /invalid variable name/);
    assert.match(find('echo "${!a[@]}"', '${!a[@]}').explanation, /Indices/);
    assert.match(spawnSync('bash', ['-c', 'a=(a b); echo "${!a[@]:-x}"']).stderr.toString(), /invalid variable name/);
  });

  it('shopt on the same line works for the glob after it', () => {
    const note = (src: string, line = 0) => explain(src, line).notes.join('\n');
    assert.doesNotMatch(note('shopt -s globstar; ls **/*.txt'), /only after/);
    assert.match(note('ls **/*.txt; shopt -s globstar'), /only after/);
    assert.match(note('shopt -s extglob; ls !(a)'), /extglob/);
    const matching = explain('shopt -s globstar dotglob; ls **/*.txt').examples[0].sections[0].lines.join(' ');
    assert.match(matching, /\.app\.txt|\.cache/);
    assert.strictEqual(bash('mkdir -p /tmp/gs$$/s/t && touch /tmp/gs$$/s/t/f.txt && cd /tmp/gs$$ && shopt -s globstar; echo **/*.txt; rm -r /tmp/gs$$'), 's/t/f.txt\n');
  });

  it('IFS: unset IFS and a value that is not known', () => {
    const x = (src: string, line: number) => find(src, '$x', 'en', line).explanation;
    const src = 'IFS=,\nunset IFS\necho $x\nIFS=$old\necho $x';
    assert.match(x(src, 2), /it is word-split and globbed/);
    assert.match(x(src, 4), /a value not known here/);
    assert.match(find(src, '$x', 'ja', 4).explanation, /分からない値/);
    assert.strictEqual(bash('IFS=; unset IFS; x="a b"; set -- $x; echo $#'), '2\n');
    // unset -f IFS is a function, not the variable.
    assert.match(x('IFS=,\nunset -f IFS\necho $x', 2), /characters of `IFS`/);
  });

  it('IFS split note follows set -f', () => {
    assert.match(find('set -f; echo $x', '$x', 'en').explanation, /globbing is off after `set -f`/);
    assert.match(find('set -f; IFS=; echo $x', '$x').explanation, /not word-split \(and globbing is off/);
    assert.match(find('set -f; IFS=,; echo $x', '$x').explanation, /not on spaces; globbing is off after/);
    assert.match(find('set -f; IFS=,; echo $x', '$x', 'ja').explanation, /グロブ展開は無効/);
    assert.match(find('set -f; IFS=,; echo $x', '$x', 'ja').explanation, /グロブ展開は無効/);
    assert.match(find('IFS=$old; set -f; echo $x', '$x').explanation, /not known here\); globbing is off/);
    assert.match(find('echo $x', '$x').explanation, /word-split and globbed/);
  });

  it('a tab-indented end of a <<- here-document ends it', () => {
    const src = 'cat <<-END\n\tbody\n\tEND\necho after';
    assert.match(explain(src, 1).notes[0], /started by `<<-END` on line 1/);
    assert.match(explain(src, 2).notes[0], /`END` marks the end of the here-document started by `<<-END` on line 1/);
    assert.match(explain(src, 2, 'ja').notes[0], /`<<-END`/);
    assert.match(explain('cat <<EOF\nx\nEOF', 2).notes[0], /marks the end.*`<<EOF`/);
    assert.strictEqual(bash('cat <<-END\n\tbody\n\tEND\n'), 'body\n');
  });

  it('a { } group in a pipeline, in the background or in a coproc is a subshell', () => {
    const sub = /the group is a subshell/;
    assert.match(find('echo hi | { read x; echo $x; }', '{ read x; echo $x; }').explanation, sub);
    assert.match(find('{ a; } | cat', '{ a; }').explanation, sub);
    assert.match(find('{ x=1; } &', '{ x=1; }').explanation, /started in the background/);
    assert.match(find('{ a; } && b &', '{ a; }').explanation, sub);
    assert.match(find('coproc C { cat; }', '{ cat; }').explanation, /coprocess runs in a subshell/);
    assert.match(find('{ x=1; } &', '{ x=1; }', 'ja').explanation, /サブシェル/);
    assert.match(find('{ x=1; } &', '{').explanation, /here it runs in a subshell/);
    assert.match(find('{ x=1; }', '{ x=1; }').explanation, /in the current shell/);
    assert.match(find('foo & { c; }', '{ c; }').explanation, /in the current shell/);
    assert.match(find('{ x=1; }', '{').explanation, /runs in the current shell/);
    // With lastpipe the last stage stays in the shell; the others do not.
    assert.match(find('shopt -s lastpipe\necho hi | { read x; }', '{ read x; }', 'en', 1).explanation, /in the current shell/);
    assert.match(find('shopt -s lastpipe\n{ a; } | cat', '{ a; }', 'en', 1).explanation, sub);
    assert.strictEqual(bash('echo hi | { read x; }; echo "[$x]"'), '[]\n');
  });

  it('[]a] is a bracket expression', () => {
    assert.doesNotMatch(find('case $x in []a]) ;; esac', '[]a]', 'en').explanation, /no wildcards/);
    assert.match(find('case $x in [a) ;; esac', '[a').explanation, /no wildcards/);
    assert.match(find('case $x in [] ) ;; esac', '[]').explanation, /no wildcards/);
    assert.strictEqual(bash('x=]; case $x in []a]) echo y;; esac'), 'y\n');
  });

  it('((i++)), exit 256 and local outside a function', () => {
    assert.match(explain('((i++))').notes.join(), /exit status is 1 when `i` is 0/);
    assert.match(explain('((i--))').notes.join(), /before the decrement/);
    assert.match(explain('((a[1]++))', 0, 'ja').notes.join(), /終了ステータスは 1/);
    assert.doesNotMatch(explain('((++i))').notes.join(), /Pitfall/);
    assert.strictEqual(spawnSync('bash', ['-c', 'set -e; i=0; ((i++)); echo no']).stdout.toString(), '');
    assert.match(explain('exit 256').notes.join(), /`exit 256` gives 0/);
    assert.match(explain('f() { return 300; }').notes.join(), /`return 300` gives 44/);
    assert.match(explain('exit -1', 0, 'ja').notes.join(), /255/);
    assert.doesNotMatch(explain('exit 255').notes.join(), /modulo/);
    assert.doesNotMatch(explain('exit $?').notes.join(), /modulo/);
    assert.doesNotMatch(explain('exit').notes.join(), /modulo/);
    assert.strictEqual(spawnSync('bash', ['-c', 'exit 256']).status, 0);
    assert.strictEqual(spawnSync('bash', ['-c', 'f() { return 300; }; f']).status, 44);
    assert.match(explain('local y').notes.join(), /can be used only inside a function/);
    assert.doesNotMatch(explain('f() { local y; }').notes.join(), /only inside a function/);
    assert.match(spawnSync('bash', ['-c', 'local y']).stderr.toString(), /can only be used in a function/);
    // In a function, `eval`, `( )` and `$( )` run `local` in it; `bash -c` starts a shell outside any function.
    for (const src of ["f() { eval 'local y'; }", 'f() { ( local y ); }', 'f() { x=$(local y); }', "f() { x=$(eval 'local y'); }", "g() { eval 'local y'; }; eval g"]) assert.doesNotMatch(explain(src).notes.join(), /only inside a function/, src);
    assert.match(explain("f() { bash -c 'local y'; }").notes.join(), /can be used only inside a function/);
    assert.strictEqual(spawnSync('bash', ['-c', "f() { eval 'local y'; ( local y ); x=$(local y); x=$(eval 'local y'); }; f; g() { eval 'local y'; }; eval g"]).stderr.toString(), '');
    assert.match(spawnSync('bash', ['-c', "f() { bash -c 'local y'; }; f"]).stderr.toString(), /can only be used in a function/);
    // A trap's action runs later: EXIT and INT after `f` has returned, outside it. RETURN, and ERR while `f` runs,
    // run it in `f`, but the model does not tell the signals apart, so they get the pitfall too.
    const traps: [string, string, boolean][] = [
      ["f() { trap 'local y' EXIT; }", 'f', true], ["f() { trap 'local y' INT; }", 'f; kill -INT $$', true],
      ["f() { trap 'local y' RETURN; }", 'f', false], ["f() { trap 'local y' ERR; false; }", 'f', false],
    ];
    for (const [src, run, outside] of traps) {
      assert.match(explain(src).notes.join(), /can be used only inside a function/, src);
      assert.strictEqual(/can only be used in a function/.test(spawnSync('bash', ['-c', `${src}; ${run}`]).stderr.toString()), outside, src);
    }
  });

  it('local outside a function, in each shell', () => {
    const notes = (src: string, shell: Shell, lang: 'ja' | 'en' = 'en') => new Analyzer(lang).explainLine(createUnbashParser().parse(src), 0, shell).notes.join('\n');
    // bash, dash and busybox ash (and so a POSIX sh) refuse it outside a function: bash goes on (status 1), dash
    // stops the script.
    assert.match(notes('local y=1', 'bash'), /it fails with "can only be used in a function"/);
    for (const shell of ['sh', 'dash', 'ash'] as const) assert.match(notes('local y=1', shell), /outside one, dash and busybox ash stop the script with "local: not in a function"/, shell);
    assert.match(notes('local y=1', 'dash', 'ja'), /dash や busybox ash は「local: not in a function」のエラーでスクリプトを止めます/);
    assert.match(runBash('local y=1; echo "st=$? y=$y"').stdout, /^st=1 y=$/m);
    if (spawnSync('dash', ['-c', 'exit 0']).status === 0) {
      const r = spawnSync('dash', ['-c', 'local y=1; echo "st=$? y=$y"']);
      assert.strictEqual(r.stdout.toString(), '');
      assert.notStrictEqual(r.status, 0);
      assert.match(r.stderr.toString(), /local: not in a function/);
      // In a subshell, only the subshell ends.
      assert.strictEqual(spawnSync('dash', ['-c', '( local y; echo in ); echo "st=$?"; x=$(local z; echo in); echo "st=$? [$x]"']).stdout.toString(), 'st=2\nst=2 []\n');
    }
    for (const src of ['( local y )', 'x=$(local z; echo in)', 'echo | ( local y )']) {
      assert.match(notes(src, 'dash'), /outside one, dash and busybox ash end this subshell with "local: not in a function" \(status 2; what is outside the subshell goes on\)/, src);
    }
    assert.match(notes('( local y )', 'dash', 'ja'), /このサブシェルを終えます（終了ステータス 2。サブシェルの外は続きます）/);
    // (A shell not known to be the script or a subshell: the one a string runs in.)
    assert.match(notes(`sh -c 'local s'`, 'dash'), /stop the shell that runs it with "local: not in a function" \(in a subshell, only the subshell ends\)/);
    assert.match(notes(`sh -c 'local s'`, 'dash', 'ja'), /それを実行するシェルを止めます/);
    // zsh, mksh and yash document their `local` as `typeset` (which works anywhere, a global variable at the top level),
    // and ksh93 has no `local`, which the dialect note says: not run here (none of them is installed in CI).
    for (const shell of ['zsh', 'mksh', 'yash', 'ksh'] as const) assert.doesNotMatch(notes('local y=1', shell), /only inside a function/, shell);
    assert.match(notes('local y=1', 'ksh'), /`local` is not available in ksh93/);
  });

  // Bash reads `then` / `do` without a `;` as an argument of the last command, so the construct has no keyword and the
  // whole construct is a syntax error: the condition never runs, and no note says what `[` or `test` does "when it runs".
  it('in a condition without its then / do, [ and test get the syntax-error note only', () => {
    const notes = (src: string) => explain(src, 0, 'en').notes.join('\n');
    const broken = [
      'if [ -f a ] then echo x; fi', 'if test -f a then echo x; fi', 'if ! [ -f a ] then echo x; fi', 'if [ -f a ] && [ -d b ] then echo x; fi',
      'if [ -f a ]; then echo x; elif [ -d b ] then echo y; fi', 'while [ x ] do echo y; done', 'until [ x ] do echo y; done',
      'if [ a = ] then echo x; fi', 'if [ -f a ] then echo x',
    ];
    for (const src of broken) {
      const r = runBash(src);
      assert.strictEqual(r.status, 2, src);
      assert.match(r.stderr, /syntax error near unexpected token|unexpected end of file/, src);
      assert.match(notes(src), /Syntax error: a `;` or a newline is needed before `(then|do)`/, src);
      assert.doesNotMatch(notes(src), /when it runs|at run time/, src);
    }
    // With the `;`, the same command runs: bash reports the error of `[` / `test`, and we say so.
    for (const src of ['if [ -f a; then echo x; fi', 'if test -f a ] = ; then echo x; fi']) {
      const r = runBash(src);
      assert.doesNotMatch(r.stderr, /syntax error/, src);
      assert.match(notes(src), /fails when it runs/, src);
    }
    // `[[ ]]` is syntax: a reserved word may follow its `]]`, so `then` is read as the keyword.
    assert.strictEqual(runBash('if [[ -f a ]] then echo x; fi').status, 0);
    assert.doesNotMatch(notes('if [[ -f a ]] then echo x; fi'), /needed before/);
  });

  it('a missing ; or newline before then / do is a syntax error', () => {
    const note = (src: string, lang: 'ja' | 'en' = 'en') => explain(src, 0, lang).notes.join('\n');
    assert.match(note('if [ -f a ] then echo x; fi'), /a `;` or a newline is needed before `then`/);
    assert.match(note('for x in a b do echo $x; done'), /before `do`/);
    assert.match(note('while true do echo; done'), /before `do`/);
    assert.match(note('until false do echo; done'), /before `do`/);
    assert.match(note('if a; then b; elif c then d; fi'), /before `then`/);
    assert.match(note('select x in a b do echo; done'), /before `do`/);
    assert.match(note('if [ -f a ] then echo x; fi', 'ja'), /構文エラー/);
    assert.strictEqual(find('for x in a b do echo $x; done', 'for x in a b do echo $x;').kind, 'error');
    // Valid code, and code still being typed, is not flagged.
    for (const ok of ['echo then', 'for x in a b; do echo then; done', 'if echo then; then b; fi', 'if a', 'for x in a b', 'while true', 'if a; then b; elif c']) {
      assert.doesNotMatch(note(ok), /needed before/, ok);
    }
    for (const bad of ['if [ -f a ] then echo x; fi', 'for x in a b do echo $x; done', 'while true do echo; done', 'if a; then b; elif c then d; fi']) {
      assert.notStrictEqual(spawnSync('bash', ['-n', '-c', bad]).status, 0, bad);
    }
  });
});
