// The lines where the analyzer's old argument walk read a word wrongly, found by comparing it with the
// argument interpreter (src/argv/interpret.ts) before the walk was replaced by it. Each row says what the
// word is now; the comment says how the real tool reads it.
import * as assert from 'assert';
import { Analyzer, Kind, Token } from '../src/analyzer';
import { countIn } from '../src/semantics/argwords';
import { shellState } from '../src/semantics/state';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { descendants, fields } from '../src/syntax/tree';
import { chainAt } from '../src/ui/hoverParts';
import { runBash } from './support/bash';
import { allTokens } from './support/explain';

const parser = createUnbashParser();
/** The outermost token of the last occurrence of `word` in `line`. */
function tokenOf(line: string, word: string, lang: 'en' | 'ja' = 'en'): Token {
  const col = line.lastIndexOf(word);
  const t = allTokens(new Analyzer(lang).explainLine(parser.parse(line), 0).items).find((x) => x.span.start.character === col && x.label === word);
  assert.ok(t, `no token for ${word} in ${line}`);
  return t;
}

/** [line, word, its kind, the start of its explanation]. */
const FIXED: [string, string, Kind, string][] = [
  // bash passes a `--` after the first word of `eval` on to the string it runs (`bash -c 'eval set -- -x; echo $#'` prints 1, and xtrace stays off).
  ['eval set -- "$OPTS"', '--', 'argument', 'Word `--`'],
  // With `-s` every operand is a positional parameter, not a script (`echo 'echo "[$1]"' | sh -s -- --prefix x` prints `[--prefix]`).
  ['sh -s -- --prefix "$HOME/.local"', '--prefix', 'argument', 'Argument to the script (`$1`)'],
  // Quote removal makes the word `-f=${Package} ${Version}\n`, the option `-f` with its value
  // (`dpkg-query -W -f='${Package} ${Version}\n' bash` prints `bash 5.2.21-2ubuntu4`); `-f=X` prints `X`.
  ["dpkg-query -W -f='${Package} ${Version}\\n'", "-f='${Package} ${Version}\\n'", 'option', 'output format for `-W`'],
  ["dpkg-query -W -f='${Package}' bash", "-f='${Package}'", 'option', 'output format for `-W`'],
  // Quote removal makes `"xf"` the old-style letters `xf` (`tar "tf" a.tar` lists the archive like `tar tf a.tar`).
  ['tar "xf" a.tar', '"xf"', 'option', 'Old-style options (no dash): `x` `f`'],
  ['tar "xf" a.tar', 'a.tar', 'argument', 'Value for `f`'],
  // The dictionary's text for `-|-l|--login` (the old walk had one of its own).
  ['su - user', '-', 'option', 'as a login shell (fresh environment)'],
  ['su - root', '-', 'option', 'as a login shell (fresh environment)'],
  // With `--reference` every operand is a file, not a mode (`chmod --reference=r u+x` says `cannot access 'u+x'`).
  ['chmod --reference=ref.txt target.txt', 'target.txt', 'argument', 'target file'],
  ['chmod --reference=r u+x', 'u+x', 'argument', 'target file'],
  // After the host, the first operand starts the remote command, and the words after it are its own
  // (`ssh -G localhost ls -l` still shows the user of the login, so `-l` is not ssh's): the joined words are read
  // as the script the remote shell runs.
  ['ssh host ls -la', 'ls -la', 'argument', 'remote command'],
  ['ssh host ls -la', '-la', 'option', 'Combined short options `-l` `-a`'],
  ['ssh host ls -l', '-l', 'option', 'long format'],
  ['ssh -p 22 host -t ls -l', '-l', 'option', 'long format'],
  ['ssh and su -c: the remote shell', '-c:', 'option', 'run the given command with the shell'],
  ['ssh and su -c: the remote shell', 'su -c: the remote shell', 'argument', 'remote command'],
  // Only the first signal is one; then `-1` is a process group (`bash -c 'kill -9 -999999'` and
  // `bash -c 'kill -s TERM -999999'` say `(-999999) - No such process`; bash kill.def, `saw_signal`).
  ['kill -9 -1', '-1', 'argument', 'target PID or job spec'],
  ['kill -s TERM -1', '-1', 'argument', 'target PID or job spec'],
  // The expansion makes an option the program sees: `bash -c 'sig=TERM; kill -$sig 999999'` says
  // `(999999) - No such process` (the signal was read); `n=1; printf 'a\nb\n' | head -$n` prints `a`;
  // `opts=d; ls -$opts /` prints `/`, as `ls -d /`; `x=d; ls -l$x /` prints one long line for `/`.
  ['kill -$sig $pid', '-$sig', 'option', 'Send the signal the expansion names'],
  ['head -$n f', '-$n', 'option', 'as many lines as the expansion gives'],
  ['ls -$opts', '-$opts', 'option', 'Options known only at run time'],
  ['ls -l$x d', '-l$x', 'option', 'Options known only at run time'],
  // Options end at the file: `flock /tmp/l -n true` says `failed to execute -n`.
  ['flock /tmp/l -n true', '-n', 'command', 'runs `-n`'],
  ['flock /tmp/l -n true', 'true', 'argument', 'Word `true`'],
  // `+x` is an option (`bash +x /dev/null` exits 0).
  ['bash +x s.sh', '+x', 'option', 'Undo `-x`'],
  ['bash +x s.sh', 's.sh', 'argument', 'Script to run'],
  // `--5` is an adjustment of -5 (`nice --5 true` says `cannot set niceness: Permission denied`).
  ['nice --5 make', '--5', 'option', 'niceness adjustment -5'],
  // jq has no `=` form (`jq -n --arg=x y` says `Unknown option --arg=x`).
  ['jq --arg=x y .', '--arg=x', 'option', 'Option (not in the dictionary'],
  // The operands after the script are its arguments (a script printing `[$1]` run as `bash -e s.sh -x` prints `[-x]`).
  ['bash -ex script.sh -x', '-x', 'argument', 'Argument to the script (`$1`)'],
  // Quotes are removed before ls runs (`ls "-d" .` prints `.`, as `ls -d .`).
  ['ls "-l" "--all"', '"-l"', 'option', 'long format'],
  ['ls "-l" "--all"', '"--all"', 'option', 'include hidden files'],
  // let has no options: `bash -c 'let -1+2; echo $?'` prints 0.
  ['let -1+2', '-1+2', 'argument', 'arithmetic expression'],
  // mlocate(1) and plocate(1): `-r, --regexp REGEXP` takes a basic regular expression; `--regex` is a flag (EREs).
  ['locate -r ^/etc/hosts$', '^/etc/hosts$', 'argument', 'Value for `-r`'],
  ['locate --regex hosts$', 'hosts$', 'argument', 'pattern to search for'],
];

describe('argument roles the old walk read wrongly', () => {
  for (const [line, word, kind, text] of FIXED) {
    it(`${line}: ${word}`, () => {
      const t = tokenOf(line, word);
      assert.strictEqual(t.kind, kind);
      assert.ok(t.explanation.startsWith(text), t.explanation);
    });
  }

  it('names a quoted subcommand in the summary', () => {
    // `yq 'e' .` runs `yq eval .`: quote removal makes the word `e`.
    assert.strictEqual(new Analyzer('en').explainLine(parser.parse("yq 'e' ."), 0).items[0].summary, 'yq e: apply the expression to each document (`eval`)');
    assert.strictEqual(tokenOf("git \"log\" -1", '"log"').kind, 'subcommand');
    // The deepest subcommand names the summary.
    const summary = (line: string) => new Analyzer('en').explainLine(parser.parse(line), 0).items[0].summary;
    assert.strictEqual(summary('git stash push -m x'), 'git stash push: Stash the changes (the default)');
    assert.match(summary('docker compose -f x run web ls')!, /^docker compose run: Run a one-off command/);
  });

  it('reads an operand that is a file as a file, not in the language of another operand', () => {
    assert.deepStrictEqual(tokenOf('chmod --reference=r u+x', 'u+x').children, []);
  });
});

describe('an operand that becomes several words', () => {
  it('names the words of a brace expansion with their roles', () => {
    assert.strictEqual(tokenOf('cp config.yml{,.bak}', 'config.yml{,.bak}').explanation, 'expands to `config.yml` (source) and `config.yml.bak` (destination: the new name, or an existing directory)');
    assert.strictEqual(tokenOf('cp x{1,2,3}', 'x{1,2,3}').explanation, 'expands to `x1` (source), `x2` (source) and `x3` (destination directory)');
    assert.strictEqual(tokenOf('cp {a,b,c} dir', 'dir').explanation, 'destination directory');
    // (Braces next to a quoted part: each word keeps the part. bash runs `printf '%s,a' '%s,b' '%s,c'` and `trap 'echo a' 'echo b'`.)
    assert.strictEqual(tokenOf("printf '%s,'{a..c}", "'%s,'{a..c}").explanation, "expands to `'%s,'a` (format string), `'%s,'b` (value for the format) and `'%s,'c` (value for the format)");
    assert.match(tokenOf('trap "echo "{a,b}', '"echo "{a,b}').explanation, /^expands to `"echo "a` \(command to run: .*\) and `"echo "b` \(signal: /);
    assert.strictEqual(tokenOf('cp "$x"{1..3} d', 'd').explanation, 'destination directory');
    // (`'a'{,}` is `a a`: the empty words of the braces are not empty next to `'a'`.)
    assert.strictEqual(tokenOf("cp 'a'{,}", "'a'{,}").explanation, "expands to `'a'` (source) and `'a'` (destination: the new name, or an existing directory)");
    // (A quoted `*` is no glob: two words exactly.)
    assert.strictEqual(tokenOf("cp {'*',a}x d", 'd').explanation, 'destination directory');
  });

  it('counts the words of braces only where brace expansion is on (`set +B`)', () => {
    // (bash runs `cp {a,b} d`: a source and the destination.)
    assert.strictEqual(tokenOf('set +B; cp {a,b} d', 'd').explanation, 'destination (the new name, or an existing directory)');
    assert.strictEqual(tokenOf('if c; then set +B; fi; cp {a,b} d', 'd').explanation, 'destination (the new name, or an existing directory) when `{a,b}` expands to a single word; destination directory when it expands to more');
  });

  it('counts the words of braces whose words hold an expansion as bash gives them: a range, or the fields the model knows', () => {
    // bash 5.2: with `x='p q'`, `cp {a,$x}` runs `cp a p q`; with `x` empty `cp a`, and with `x='*'` `a` and the names.
    assert.strictEqual(tokenOf('x="p q"; cp {a,$x}', '{a,$x}').explanation, 'expands to `a` (source), `p` (source) and `q` (destination directory)');
    assert.strictEqual(tokenOf('x="p q"; cp "x"{a,$x}', '"x"{a,$x}').explanation, 'expands to `xa` (source), `xp` (source) and `q` (destination directory)');
    assert.strictEqual(tokenOf('x=; cp {a,$x}', '{a,$x}').explanation, 'source');
    // (As many fields as words of the braces, but not one each: `cp p q`, both of `$x`; then `cp p q`, both of `$y`.)
    assert.strictEqual(tokenOf('x="p q"; y=; cp {$x,$y}', '{$x,$y}').explanation, 'expands to `p` (source) and `q` (destination: the new name, or an existing directory)');
    assert.strictEqual(tokenOf('x=; y="p q"; cp {$x,$y}', '{$x,$y}').explanation, 'expands to `p` (source) and `q` (destination: the new name, or an existing directory)');
    assert.strictEqual(tokenOf('x=p; cp {a,$x} d', 'd').explanation, 'destination directory');
    const hedge = (w: string) => `source when \`${w}\` expands to a single word; when it expands to 2 words, they are source, then destination (the new name, or an existing directory); when it expands to more, they are source, then destination directory`;
    assert.strictEqual(tokenOf('cp {a,$x}', '{a,$x}').explanation, hedge('{a,$x}'));
    assert.strictEqual(tokenOf('x="*"; cp {a,$x}', '{a,$x}').explanation, hedge('{a,$x}'));
    // (`cp {a,$(echo b c)}` runs `cp a b c`; `set -- 1 2; cp {a,"$@"}` runs `cp a 1 2`, and with no parameters `cp a`.)
    assert.strictEqual(tokenOf('cp {a,$(echo b c)}', '{a,$(echo b c)}').explanation, hedge('{a,$(echo b c)}'));
    assert.strictEqual(tokenOf('cp {a,"$@"}', '{a,"$@"}').explanation, hedge('{a,"$@"}'));
    // (Braces that do not expand: `set +B; x='p q'; cp {a,$x}` runs `cp '{a,p' 'q}'`, the fields the model knows.)
    assert.strictEqual(tokenOf('set +B; x="p q"; cp {a,$x}', '{a,$x}').explanation, 'expands to `{a,p` (source) and `q}` (destination: the new name, or an existing directory)');
    // The brace token says the expansions in its words come after it, but where the model knows they make as many.
    const brace = (line: string, w: string): string => tokenOf(line, w).children.find((c) => c.kind === 'expansion' && c.label === w)!.explanation;
    assert.strictEqual(brace('cp {a,$x}', '{a,$x}'), 'Brace expansion: `{a,$x}` expands to 2 words: `a` `$x`, which the expansions after it may make into more or fewer words');
    assert.strictEqual(brace('cp {a,"$x"}', '{a,"$x"}'), 'Brace expansion: `{a,"$x"}` expands to 2 words: `a` `"$x"`');
    assert.strictEqual(brace('x=p; cp {a,$x} d', '{a,$x}'), 'Brace expansion: `{a,$x}` expands to 2 words: `a` `$x`');
    assert.strictEqual(brace('x="p q"; y=; cp {$x,$y}', '{$x,$y}'), 'Brace expansion: `{$x,$y}` expands to 2 words: `$x` `$y`, which the expansions after it may make into more or fewer words');
    // (A part of a longer word: `cp xa xp d`.)
    const part = (line: string, w: string): string => allTokens(new Analyzer('en').explainLine(parser.parse(line), 0).items).find((t) => t.kind === 'expansion' && t.label === w)!.explanation;
    assert.strictEqual(part('x=p; cp "x"{a,$x} d', '{a,$x}'), 'Brace expansion: `{a,$x}` expands to 2 words: `a` `$x`');
    assert.strictEqual(part('cp "x"{a,$x} d', '{a,$x}'), 'Brace expansion: `{a,$x}` expands to 2 words: `a` `$x`, which the expansions after it may make into more or fewer words');
    assert.strictEqual(tokenOf('cp {a,$x}', '{a,$x}', 'ja').children[0].explanation, 'ブレース展開: `{a,$x}` は 2 個の単語 `a` `$x` に展開される（その後の展開で、単語の数は増えたり減ったりしうる）');
  });

  it('counts the words each word of the braces gives (`countIn`), as bash 5.2 gives them', () => {
    const count = (line: string) => {
      const tree = parser.parse(line);
      const model = shellState(tree);
      const cmd = descendants(tree.root, ['command']).at(-1)!;
      return countIn(fields(cmd, 'argument')[0], model);
    };
    // (`cp {a,$x}` gives `a` and the fields of `$x`, none or more; `"x"{a,$x}` `xa` and at least `x`.)
    assert.deepStrictEqual(count('cp {a,$x}'), { min: 1 });
    assert.deepStrictEqual(count('cp "x"{a,$x}'), { min: 2 });
    assert.deepStrictEqual(count('cp {$x,"$@"}'), { min: 0 });
    assert.deepStrictEqual(count('cp {a,"x$@"}'), { min: 2 });
    // (Known values: `x='p q'`, three words; `x=`, one.)
    assert.deepStrictEqual(count('x="p q"; cp {a,$x}'), { min: 3, max: 3 });
    assert.strictEqual(count('x=; cp {a,$x}'), undefined);
    // (A known field that starts with `-` too: the interpreter reads it as an option, bug 7 of oracles.md 2.8.)
    assert.deepStrictEqual(count('x=-r; cp {a,$x}'), { min: 2, max: 2 });
    // (`{,$x}a` is `a` and `$xa`, the variable `xa`: none or more.)
    assert.deepStrictEqual(count('cp {,$x}a'), { min: 1 });
    assert.deepStrictEqual(count('cp {b,$x}a'), { min: 1 });
    // (Globs give at least one word each; quoted words exactly one.)
    assert.deepStrictEqual(count('cp {a,b}*'), { min: 2 });
    assert.deepStrictEqual(count('cp {a,"$x"}'), { min: 2, max: 2 });
    // (Braces that do not expand: the word with its parts, `{a,p` and `q}`.)
    assert.deepStrictEqual(count('set +B; cp {a,$x}'), { min: 1 });
    assert.deepStrictEqual(count('set +B; cp {a,*}'), { min: 1 });
    assert.strictEqual(count('set +B; cp {a,b}'), undefined);
    assert.deepStrictEqual(count('set +B; cp {a,b$x}'), { min: 1 });
    // (`{,a}$x` is `$x` and `a$x`: `a` at least.)
    assert.deepStrictEqual(count('cp {,a}$x'), { min: 1 });
    // (Brace expansion on some paths only: the word as it is, or its words; one word either way for `{,a}`.)
    assert.deepStrictEqual(count('if c; then set +B; fi; cp {a,$x}'), { min: 1 });
    assert.strictEqual(count('if c; then set +B; fi; cp {,a}'), undefined);
  });

  it('gives the roles for one word and for more when the count is not known', () => {
    assert.strictEqual(tokenOf('cp *.txt dir', 'dir').explanation, 'destination (the new name, or an existing directory) when `*.txt` expands to a single word; destination directory when it expands to more');
    // (bash runs `cp a b` with two words, the two-operand form: `b` is a new name or an existing directory; with three,
    // `cp a b c`, the last must be a directory. Also `ln -s a b`: the link `b`; and `cmp`, a form for each count.)
    const dest = 'they are source, then destination (the new name, or an existing directory)';
    assert.strictEqual(tokenOf('cp "$@"', '"$@"').explanation, `source when \`"$@"\` expands to a single word; when it expands to 2 words, ${dest}; when it expands to more, they are source, then destination directory`);
    assert.strictEqual(tokenOf('cp $a', '$a', 'ja').explanation, '`$a` が1語に展開されるならコピー元、2語なら順にコピー元・コピー先（新しい名前、または既存のディレクトリ）、3語以上なら順にコピー元・コピー先のディレクトリ');
    assert.strictEqual(tokenOf('ln -s $x', '$x').explanation, 'target (the link is made in the current directory, with the same name) when `$x` expands to a single word; when it expands to 2 words, they are target, then link name (or an existing directory to make the link in); when it expands to more, they are target, then directory to make the links in');
    // (`a=1; cp $a{,.bak}`: the model knows the words, #483.)
    assert.strictEqual(tokenOf('a=1; cp $a{,.bak}', '$a{,.bak}').explanation, 'expands to `1` (source) and `1.bak` (destination: the new name, or an existing directory)');
    assert.strictEqual(tokenOf('cmp $a', '$a').explanation, 'first file (`-` for stdin) when `$a` expands to a single word; when it expands to 2 words, they are first file (`-` for stdin), then second file; when it expands to 3 words, they are first file (`-` for stdin), then second file, then bytes to skip in the first file; when it expands to 4 words, they are first file (`-` for stdin), then second file, then bytes to skip in the first file, then bytes to skip in the second file; when it expands to more, they are first file (`-` for stdin), then second file, then bytes to skip in the first file, then bytes to skip in the second file, then extra operand, which the command refuses (it prints `extra operand` and exits with status 2, doing nothing)');
    // (A word after: the same form for two words and more, `cp b x y`; a word before it is a source for any count.)
    assert.strictEqual(tokenOf('cp b $a', '$a').explanation, 'destination (the new name, or an existing directory) when `$a` expands to a single word; when it expands to more, they are source, then destination directory');
    assert.deepStrictEqual(['$a', 'd'].map((w) => tokenOf('cp $a d', w).explanation), ['source', 'destination (the new name, or an existing directory) when `$a` expands to a single word; destination directory when it expands to more; source when `$a` expands to nothing']);
    // (A word that gives two words at least, each of `{a,b}*` a glob: no reading for one; nor one when it is the same for
    // any count, `rm $a`.)
    assert.strictEqual(tokenOf('cp {a,b}*', '{a,b}*').explanation, `when \`{a,b}*\` expands to 2 words, ${dest}; when it expands to more, they are source, then destination directory`);
    assert.strictEqual(tokenOf('cp {a,b}*', '{a,b}*', 'ja').explanation, '`{a,b}*` が2語に展開されるなら順にコピー元・コピー先（新しい名前、または既存のディレクトリ）、3語以上なら順にコピー元・コピー先のディレクトリ');
    assert.strictEqual(tokenOf('rm $a', '$a').explanation, 'file to remove');
    // (A word after it, read with its fewest words: `cmp a* b* f` skips `f` bytes in the first file, `cmp a1 a2 b* f` in
    // the second. With another word that may give several, as few as each can.)
    assert.strictEqual(tokenOf('cmp {a,b}* f', 'f').explanation, 'bytes to skip in the first file when `{a,b}*` expands to 2 words; bytes to skip in the second file when it expands to 3 words; extra operand, which the command refuses (it prints `extra operand` and exits with status 2, doing nothing) when it expands to more');
    assert.strictEqual(tokenOf('cmp {a,b}* f', 'f', 'ja').explanation, '`{a,b}*` が2語に展開されるなら1 つ目のファイルで読み飛ばすバイト数、3語なら2 つ目のファイルで読み飛ばすバイト数、4語以上なら余分なオペランド（コマンドは受け付けず、`extra operand` と表示して何もせずに終了ステータス 2 で終わる）');
    assert.strictEqual(tokenOf('cmp {a,b}* f $c', 'f').explanation, 'bytes to skip in the first file when `{a,b}*`, `$c` expand to as few words as each can; when any of them expands to more, it is bytes to skip in the first file, bytes to skip in the second file or extra operand, which the command refuses (it prints `extra operand` and exits with status 2, doing nothing)');
    assert.strictEqual(tokenOf('cmp {a,b}* f $c', 'f', 'ja').explanation, '`{a,b}*`・`$c` がそれぞれ最も少ない語数に展開されるなら1 つ目のファイルで読み飛ばすバイト数、どれかがそれより多いならこの語は1 つ目のファイルで読み飛ばすバイト数・2 つ目のファイルで読み飛ばすバイト数・余分なオペランド（コマンドは受け付けず、`extra operand` と表示して何もせずに終了ステータス 2 で終わる）のどれか');
    // (The same roles for every count it gives: `chmod a* b*` is the mode, then files.)
    assert.strictEqual(tokenOf('chmod {a,b}*', '{a,b}*').explanation, 'when `{a,b}*` expands to 2 words or more, they are mode (e.g. `755`, `+x`, `u+w`), then target file');
    // (A brace expansion of globs gives at least one word each.)
    assert.strictEqual(tokenOf('cp {a,b}*.txt dir', 'dir').explanation, 'destination directory');
  });

  it('gives the roles any counts give where two words may give several, and a role for each count of the one other', () => {
    // (bash: with `a='x y'` and `b=z`, `cp $a $b` runs `cp x y z` (`z` a directory), `gosu $a $b` with `a='u ls'` runs
    // `ls z` as `u`, `cmp $a $b` reads `z` as the bytes to skip in the first file; with `a=x` and `b='y z'`, `y` is the
    // destination directory, `ls` runs `z`, cmp reads `y` as the second file.)
    assert.strictEqual(tokenOf('cp $a $b', '$b').explanation, 'destination (the new name, or an existing directory) when `$a`, `$b` expand to a single word; when any of them expands to more, each of its words is source or destination directory; its first word is source when `$a` expands to nothing');
    assert.strictEqual(tokenOf('cp $a $b', '$a').explanation, 'source');
    assert.strictEqual(tokenOf('gosu $a $b', '$b').explanation, 'command to run when `$a`, `$b` expand to a single word; when any of them expands to more, each of its words is command to run or argument to the command; its first word is user (or `user:group`) when `$a` expands to nothing');
    assert.strictEqual(tokenOf('cmp $a $b', '$b').explanation, 'second file when `$a`, `$b` expand to a single word; when any of them expands to more, each of its words is second file, bytes to skip in the first file, bytes to skip in the second file or extra operand, which the command refuses (it prints `extra operand` and exits with status 2, doing nothing); its first word is first file (`-` for stdin) when `$a` expands to nothing');
    assert.strictEqual(tokenOf('cp $a $b', '$b', 'ja').explanation, '`$a`・`$b` が1語に展開されるならコピー先（新しい名前、または既存のディレクトリ）、どれかが2語以上ならこの語の各語はコピー元・コピー先のディレクトリのどれか、`$a` が0語ならこの語の最初の語はコピー元');
    // (Its own fewest words of two roles: none is its own; `chmod a* b* c` is the mode, then files.)
    assert.strictEqual(tokenOf('chmod {a,b}* $c', '{a,b}*').explanation, 'each of its words is mode (e.g. `755`, `+x`, `u+w`) or target file, by how many words `{a,b}*`, `$c` expand to');
    assert.strictEqual(tokenOf('chmod {a,b}* $c', '{a,b}*', 'ja').explanation, '`{a,b}*`・`$c` が展開される語数により、この語の各語は権限（例: `755`, `+x` は実行権限を付与, `u+w`）・対象のファイルのどれか');
    // (After one such word, a role for each count: `cmp x y f` skips `f` bytes in the first file, `cmp x y z f` in the
    // second.)
    assert.strictEqual(tokenOf('cmp $a f', 'f').explanation, 'second file when `$a` expands to a single word; bytes to skip in the first file when it expands to 2 words; bytes to skip in the second file when it expands to 3 words; extra operand, which the command refuses (it prints `extra operand` and exits with status 2, doing nothing) when it expands to more; first file (`-` for stdin) when `$a` expands to nothing');
    assert.strictEqual(tokenOf('cmp $a f', 'f', 'ja').explanation, '`$a` が1語に展開されるなら2 つ目のファイル、2語なら1 つ目のファイルで読み飛ばすバイト数、3語なら2 つ目のファイルで読み飛ばすバイト数、4語以上なら余分なオペランド（コマンドは受け付けず、`extra operand` と表示して何もせずに終了ステータス 2 で終わる）、`$a` が0語なら1 つ目のファイル（`-` で標準入力）');
    assert.strictEqual(tokenOf('cmp {a,b}* f g', 'g').explanation, 'bytes to skip in the second file when `{a,b}*` expands to 2 words; extra operand, which the command refuses (it prints `extra operand` and exits with status 2, doing nothing) when it expands to more');
    // (One role for any count but the fewest: `cmp x y z f` skips `f` bytes in the second file.)
    assert.strictEqual(tokenOf('cmp $a $b f', 'f').explanation, 'bytes to skip in the first file when `$a`, `$b` expand to a single word; when any of them expands to more, it is bytes to skip in the second file or extra operand, which the command refuses (it prints `extra operand` and exits with status 2, doing nothing); first file (`-` for stdin) when `$a`, `$b` expand to nothing');
    assert.strictEqual(tokenOf('cmp $a $b f', 'f', 'ja').explanation, '`$a`・`$b` が1語に展開されるなら1 つ目のファイルで読み飛ばすバイト数、どれかが2語以上ならこの語は2 つ目のファイルで読み飛ばすバイト数・余分なオペランド（コマンドは受け付けず、`extra operand` と表示して何もせずに終了ステータス 2 で終わる）のどれか、`$a`・`$b` が0語なら1 つ目のファイル（`-` で標準入力）');
  });

  it('reads the hedges of many words that may give several in about the time of the line (review of #484)', function () {
    this.timeout(30000);
    // (The hedges are read when the explanation asks, each reading once: 80 words took 5.6 s, against 30 ms before them.)
    const many = (prefix: string, word: (i: number) => string) => `${prefix} ${Array.from({ length: 80 }, (_, i) => word(i)).join(' ')}`;
    // (And the line read again without each value that may give none, once: `grep -e $a1 -e $a3 …`, after #482.)
    for (const line of [many('cp', (i) => `$a${i}`), many('echo', (i) => `*.x${i}`), many('rm -f', (i) => `*.x${i}`), many('grep', (i) => (i % 2 ? `$a${i}` : '-e')), many('tar -cf $f', (i) => `$a${i}`)]) {
      const start = performance.now();
      new Analyzer('en').explainLine(parser.parse(line), 0);
      assert.ok(performance.now() - start < 2000, `${line.slice(0, 20)}…: ${Math.round(performance.now() - start)} ms`);
    }
  });

  it('gives the role a word takes when the words before it expand to nothing, where the model says they may', () => {
    // With `a` empty, bash runs `cp b` (cp: missing destination file operand after 'b'), `grep -c f` (the pattern `f`,
    // read from stdin) and `cp /x`.
    assert.strictEqual(tokenOf('cp $a b', 'b').explanation, 'destination (the new name, or an existing directory) when `$a` expands to a single word; destination directory when it expands to more; source when `$a` expands to nothing');
    assert.strictEqual(tokenOf('grep -c ${x} f', 'f').explanation, 'file to search (default: stdin); search pattern (regex) when `${x}` expands to nothing');
    assert.strictEqual(tokenOf('cp $a $a/x', '$a/x').explanation, 'destination (the new name, or an existing directory) when `$a`, `$a/x` expand to a single word; when any of them expands to more, each of its words is source or destination directory; its first word is source when `$a` expands to nothing');
    assert.strictEqual(tokenOf('cp $a $b c', 'c').explanation, 'destination directory; source when `$a`, `$b` expand to nothing');
    assert.strictEqual(tokenOf('cp $a b', 'b', 'ja').explanation, '`$a` が1語に展開されるならコピー先（新しい名前、または既存のディレクトリ）、2語以上ならコピー先のディレクトリ、`$a` が0語ならコピー元');
    assert.strictEqual(tokenOf('cp $a $b c', 'c', 'ja').explanation, 'コピー先のディレクトリ、`$a`・`$b` が0語ならコピー元');
    // (Not where the model says the word gives a word: a value set here, read as its one field (`cp 1 b`), `$#`; with
    // nullglob, a glob may give none.)
    assert.strictEqual(tokenOf('a=1; cp $a b', 'b').explanation, 'destination (the new name, or an existing directory)');
    assert.strictEqual(tokenOf('grep -c $# f', 'f').explanation, 'file to search (default: stdin)');
    assert.strictEqual(tokenOf('shopt -s nullglob; grep -c *.txt f', 'f').explanation, 'file to search (default: stdin); search pattern (regex) when `*.txt` expands to nothing');
    // (Nor where the role stays: `rm $a b`; `ln -s $a $b`, where `$a` is the target either way, with more said of it when
    // `$b` gives none.)
    assert.strictEqual(tokenOf('rm $a b', 'b').explanation, 'file to remove');
    assert.strictEqual(tokenOf('ln -s $a $b', '$a').explanation, 'target');
    // (The words of a builtin turned off, read again as the program's, from the model too: `$#` is never empty.)
    assert.strictEqual(tokenOf('enable -n printf; command printf $# x', 'x').explanation, 'value for the format');
    // (In Japanese the roles of more words are a list with `・`, and the reading with none comes after a `、`.)
    assert.strictEqual(tokenOf('mv $a $b', '$b', 'ja').explanation, '`$a`・`$b` が1語に展開されるなら移動先（新しい名前、または既存のディレクトリ）、どれかが2語以上ならこの語の各語は移動元・移動先のディレクトリのどれか、`$a` が0語ならこの語の最初の語は移動元');
  });
});

describe('the fields of a word the model knows, read as bash gives them (bug 7 of oracles.md 2.8)', () => {
  it('reads a field that starts with `-` as an option, with its value and the end of options (bash 5.2, GNU coreutils)', () => {
    // bash runs `cp -r a d`, `cp -r a b` (also quoted: `"$x"` is one field, `-r`), `head -n 2 f` and `cp -- -r d`.
    assert.strictEqual(tokenOf('x="-r a"; cp $x d', '$x').explanation, 'expands to `-r` (option: copy directories recursively) and `a` (source)');
    assert.strictEqual(tokenOf('x="-r a"; cp $x d', 'd').explanation, 'destination (the new name, or an existing directory)');
    const quoted = tokenOf('x=-r; cp "$x" a b', '"$x"');
    assert.deepStrictEqual([quoted.kind, quoted.explanation], ['option', 'expands to `-r` (option: copy directories recursively)']);
    assert.strictEqual(tokenOf('x=-rf; cp $x a b', '$x').explanation, 'expands to `-rf` (option `-r`: copy directories recursively, option `-f`: force overwrite)');
    assert.strictEqual(tokenOf('x="-n 2"; head $x f', '$x').explanation, 'expands to `-n` (option: number of lines (`-n -5`: all but the last 5)) and `2` (value for `-n`)');
    assert.strictEqual(tokenOf('x="-- -r"; cp $x d', '$x').explanation, 'expands to `--` (end of options) and `-r` (source)');
    // `set {-e,-u}` turns on `-e` and `-u` (`$-` holds `e` and `u`); `x='-o pipefail'; set $x` turns on pipefail.
    const set = tokenOf('set {-e,-u}', '{-e,-u}');
    assert.strictEqual(set.kind, 'option');
    assert.match(set.explanation, /^expands to `-e` \(option: exit immediately .*\) and `-u` \(option: treat unset variables as an error\)$/);
    assert.strictEqual(tokenOf('x="-o pipefail"; set $x', '$x').explanation, 'expands to `-o` (option: enable an option by name) and `pipefail` (value for `-o`)');
    // (A subcommand and a command in the fields: `git commit -m msg`, `sudo ls -l f`.)
    assert.strictEqual(tokenOf('x="commit -m msg"; git $x', '$x').explanation, 'expands to `commit` (subcommand: Record staged changes), `-m` (option: commit message) and `msg` (value for `-m`)');
    assert.strictEqual(tokenOf('x="ls -l"; sudo $x f', 'f').explanation, 'file or directory (default: current)');
    assert.strictEqual(tokenOf('x="-r a"; cp $x d', '$x', 'ja').explanation, '`-r`（オプション: ディレクトリを再帰的にコピー）と `a`（コピー元）に展開される');
  });

  it('drops a word that gives no field, and reads the words of a known value with their roles', () => {
    // bash runs `cp p q` (`q` the destination), `cp c` and `cp d2` (cp: missing destination file operand), `cp a2 c2`.
    assert.strictEqual(tokenOf('z=""; p="a b"; cp $z $p', '$z').explanation, 'expands to no word, so `cp` does not get it');
    assert.strictEqual(tokenOf('z=""; p="a b"; cp $z $p', '$p').explanation, 'expands to `a` (source) and `b` (destination: the new name, or an existing directory)');
    assert.strictEqual(tokenOf('z=""; p="a b"; cp $p $z', '$p').explanation, 'expands to `a` (source) and `b` (destination: the new name, or an existing directory)');
    assert.strictEqual(tokenOf('z=; cp $z c', 'c').explanation, 'source');
    assert.strictEqual(tokenOf('x=; y=; cp {$x,$y} d', '{$x,$y}').explanation, 'expands to no word, so `cp` does not get it');
    assert.strictEqual(tokenOf('x=; y=; cp {$x,$y} d', 'd').explanation, 'source');
    assert.strictEqual(tokenOf('y=a; cp $y c', 'c').explanation, 'destination (the new name, or an existing directory)');
    assert.strictEqual(tokenOf('p="a b"; cp $p d', 'd').explanation, 'destination directory');
    assert.strictEqual(tokenOf('z=; cp $z c', '$z', 'ja').explanation, '展開すると語が残らないので、`cp` には渡らない');
    // (The words of `set --` after a word of two: `x` is `$3`.)
    assert.strictEqual(tokenOf('p="a b"; set -- $p x', 'x').explanation, 'becomes the positional parameter `$3`');
  });

  it('says what each field is: an option not in the dictionary, a pattern option, a letter with its value, old-style letters', () => {
    // (`cp --bogus a b` fails: an unrecognized option; `head -5 f`, `head -n5 f`, `tar cvf a.tar d`.)
    assert.strictEqual(tokenOf('x=--bogus; cp $x a b', '$x').explanation, 'expands to `--bogus` (option not in the dictionary)');
    assert.strictEqual(tokenOf('x="-r --bogus"; cp $x a b', '$x').explanation, 'expands to `-r` (option: copy directories recursively) and `--bogus` (option not in the dictionary)');
    assert.strictEqual(tokenOf('x=-5; head $x f', '$x').explanation, 'expands to `-5` (option: 5 lines (old way to write `-n 5`))');
    assert.strictEqual(tokenOf('x=-n5; head $x f', '$x').explanation, 'expands to `-n5` (option `-n`: number of lines (`-n -5`: all but the last 5), value `5`)');
    assert.strictEqual(tokenOf('x=cvf; tar $x a.tar d', '$x').explanation, 'expands to `cvf` (option `c`: create an archive, option `v`: list processed files, option `f`: archive file name)');
    assert.strictEqual(tokenOf('x=-zr; cp $x a b', '$x').explanation, 'expands to `-zr` (option `-z` not in the dictionary, option `-r`: copy directories recursively)');
    // (A word of a command run by another one: `sudo ls -l`; the words of a remote command, `ssh host ls -l`; find's
    // start and expression, `find . -name a`.)
    assert.strictEqual(tokenOf('x=-l; sudo ls $x', '$x').explanation, 'expands to `-l` (option: long format (permissions, owner, size, mtime))');
    assert.strictEqual(tokenOf('x="host ls -l"; ssh $x', '$x').explanation, 'expands to `host` (destination: `user@host`), `ls` (the command to run) and `-l` (a word of the command string)');
    assert.strictEqual(tokenOf('x=". -name"; find $x a', '$x').explanation, 'expands to `.` (starting directory) and `-name` (a word of the expression)');
    assert.strictEqual(tokenOf('z=; find . $z -name a', '-name').explanation, 'file name matches the glob');
    // (coreutils echo reads `--version` as an option only alone, and not with `POSIXLY_CORRECT` in its environment.)
    assert.strictEqual(tokenOf('x=--version; POSIXLY_CORRECT=1 /bin/echo $x', '$x').explanation, 'expands to `--version` (text to print: `POSIXLY_CORRECT` is in its environment, so `--version` is no option)');
    assert.strictEqual(runBash('x=--version; POSIXLY_CORRECT=1 /bin/echo $x').stdout, '--version\n');
    // (A function gets every word as an argument: `f -a b`.)
    assert.strictEqual(tokenOf('f() { :; }; x="-a b"; f $x', '$x').explanation, 'Arguments $1 (`-a`), $2 (`b`) to the function');
  });

  it('gives no example of a command one of whose words is read as fields that are options or values (review of #485)', () => {
    // (The examples read the words as written: `head -n 3 f` would show 10 lines, `sort -r` ascending, `grep -v` the matches.)
    const examples = (line: string) => new Analyzer('en').explainLine(parser.parse(line), 0).examples.map((e) => e.title);
    for (const line of ['h="-n 3"; head $h f', 'hn=-n; head $hn 3 f', 'k="-n3 f"; head $k', 'xn="-n 2"; tail $xn f', 'hx=-n; head $hx', 'xr=-r; sort $xr f', 'xi=-i; sed $xi s/a/b/ f', 'xv=-v; grep $xv a f']) {
      assert.deepStrictEqual(examples(line), [], line);
    }
    // (A brace expansion's example stays, and an expansion's.)
    assert.deepStrictEqual(examples('set {-e,-u}'), ['Example (brace expansion `{-e,-u}`)']);
    assert.deepStrictEqual(examples('x=-n; f=a.c; head $x 3 "${f%.c}"'), ['Example for `${f%.c}`']);
  });

  it('numbers the positional parameters from the fields the model knows (review of #485)', () => {
    // bash: `x=; f $x d` gives `$1=d`; `f $ff d` with `ff='-r a'` gives `$3=d`; `set -- $p d` sets `$1=a $2=b $3=d`.
    assert.strictEqual(tokenOf('f() { :; }; x=; f $x d', 'd').explanation, 'Argument $1 to the function');
    assert.strictEqual(tokenOf('f() { :; }; ff="-r a"; f $ff d', '$ff').explanation, 'Arguments $1 (`-r`), $2 (`a`) to the function');
    assert.strictEqual(tokenOf('f() { :; }; ff="-r a"; f $ff d', 'd').explanation, 'Argument $3 to the function');
    assert.strictEqual(tokenOf('f() { :; }; p="a b"; f $p d', 'd').explanation, 'Argument $3 to the function');
    assert.strictEqual(tokenOf('f() { :; }; f "$@" d', 'd').explanation, 'Argument $2 to the function (if this word or one before it expands to more or fewer words, the number shifts)');
    assert.strictEqual(tokenOf('f() { :; }; p="a b"; f $p d', '$p', 'ja').explanation, '関数への引数 $1（`a`）、$2（`b`）');
    assert.strictEqual(tokenOf('p="a b"; set -- $p d', '$p').explanation, 'expands to `a` (becomes the positional parameter `$1`) and `b` (becomes the positional parameter `$2`)');
    assert.strictEqual(tokenOf('p="a b"; set -- $p d', 'd').explanation, 'becomes the positional parameter `$3`');
    assert.deepStrictEqual(runBash('f() { echo "$#:$1:$3"; }; x=; f $x d; ff="-r a"; f $ff d; p="a b"; set -- $p d; echo "$3"').stdout, '1:d:\n3:-r:d\nd\n');
    // (Each field counts for its own role: `set $p d` with `p='-- a'` sets `$1=a $2=d`; `bash $p d` with `p='s.sh a'` runs
    // s.sh with `$1=a $2=d`; `bash -c 'echo $1' $p d` with `p='a b'` gives `$0=a $1=b $2=d`. Review of #485.)
    assert.strictEqual(tokenOf('p="-- a"; set $p d', '$p').explanation, 'expands to `--` (end of options) and `a` (becomes the positional parameter `$1`)');
    assert.strictEqual(tokenOf('p="-- a"; set $p d', 'd').explanation, 'becomes the positional parameter `$2`');
    assert.strictEqual(tokenOf('p="s.sh a"; bash $p d', '$p').explanation, 'expands to `s.sh` (Script to run) and `a` (Argument to the script: `$1`)');
    assert.strictEqual(tokenOf('p="s.sh a"; bash $p d', 'd').explanation, 'Argument to the script (`$2`)');
    assert.match(tokenOf("p='a b'; bash -c 'echo $1' $p d", '$p').explanation, /and `b` \(Positional parameter `\$1` of the command string\)$/);
    assert.strictEqual(tokenOf("p='a b'; bash -c 'echo $1' $p d", 'd').explanation, 'Positional parameter `$2` of the command string');
    // (After a word whose count is not known, the numbers may shift; with one word, `--` is a parameter too.)
    assert.strictEqual(tokenOf('p="a b"; set -- $u $p d', '$p').explanation, 'expands to `a` (becomes the positional parameter `$2`) and `b` (becomes the positional parameter `$3`) (if this word or one before it expands to more or fewer words, the number shifts)');
    assert.strictEqual(tokenOf('p="-- a"; set $u $p d', 'd').explanation, 'becomes the positional parameter `$4` (if this word or one before it expands to more or fewer words, the number shifts)');
    const script = 'echo "$1|$2"';
    assert.strictEqual(runBash(`p="-- a"; set $p d; echo "$1|$2"; printf '%s' '${script}' > s.sh; p="s.sh a"; bash $p d; p="a b"; bash -c 'echo $0:$1:$2' $p d`, { files: ['.keep'] }).stdout, 'a|d\na|d\na:b:d\n');
  });

  it("explains a word of find's expression that gives none, and gives no summary of words read as other fields (review of #485)", () => {
    // bash: `z=; find . $z -name x` is `find . -name x`; `find . -name x $fe` with `fe='-exec rm {} ;'` runs `rm` on each match.
    assert.strictEqual(tokenOf('z=; find . $z -name x', '$z').explanation, 'expands to no word, so `find` does not get it');
    const summary = allTokens(new Analyzer('en').explainLine(parser.parse('z=; find . -name x $z -print'), 0).items).find((t) => t.kind === 'test')!;
    assert.strictEqual(summary.explanation, 'Conditions and actions: if name matches x: print it');
    assert.strictEqual(tokenOf('z=; find . -name x $z -print', '$z').explanation, 'expands to no word, so `find` does not get it');
    // (Inside the summary's span, and of a group's, the word is a part of the innermost, so that a hover reaches it.)
    for (const line of ['z=; find . -name x $z -print', 'z=; find . -name $z x', 'z=; find . \\( -name x $z \\)', 'z=; find . \\( -name x $z \\) -print']) {
      const items = new Analyzer('en').explainLine(parser.parse(line), 0).items;
      const col = line.indexOf('$z') + 1;
      const chain = chainAt(items, { line: 0, character: col });
      assert.strictEqual(chain.at(-1)?.label === '$z' ? chain.at(-1)!.explanation : chain.at(-2)?.explanation, 'expands to no word, so `find` does not get it', line);
    }
    // (Also in a group over two lines.)
    const lines = 'z=; find . \\( -name x $z \\\n  -o -name y \\)';
    const over = chainAt(new Analyzer('en').explainLine(parser.parse(lines), 0).items, { line: 0, character: lines.indexOf('$z') + 1 });
    assert.strictEqual(over.find((t) => t.kind === 'argument' && t.label === '$z')?.explanation, 'expands to no word, so `find` does not get it');
    // (A field read as itself keeps the summary; one find may read as an option does not: `x=-print`.)
    const summaryOf = (line: string) => allTokens(new Analyzer('en').explainLine(parser.parse(line), 0).items).find((t) => t.kind === 'test')?.explanation;
    assert.strictEqual(summaryOf('p=a; find . -name "$p"'), 'Print what matches: name matches "$p" (no action is given, so `-print` is implied)');
    assert.strictEqual(summaryOf('x=-print; find . -name a $x'), undefined);
    const fe = allTokens(new Analyzer('en').explainLine(parser.parse('fe="-exec rm {} ;"; find . -name x $fe'), 0).items);
    assert.ok(!fe.some((t) => t.kind === 'test'), 'no summary of the words as written');
    assert.match(fe.find((t) => t.label === '$fe')!.explanation, /^expands to `-exec` \(option: run a command on each match/);
    // (A pitfall reads the words as the command gets them: `e=-e; grep $e pat f` reads `pat` as the pattern, not `$e`.)
    const notes = new Analyzer('en').explainLine(parser.parse('e=-e; grep $e pat f'), 0).notes;
    assert.ok(!notes.some((x) => /value of `\$e`/.test(x)), notes.join('\n'));
  });

  it('runs those lines in bash and GNU coreutils as said', function () {
    this.timeout(20000);
    const out = runBash('mkdir a; touch a/f q a2 g -- -r; x="-r a"; cp $x d && ls d; set {-e,-u}; echo "$-"; set +eu; z=""; pair="p q"; cp $z $pair; ls q; '
      + 'z=; cp $z c 2>&1 | head -1; y=a2; cp $y c2 && ls c2; printf "1\\n2\\n3\\n" > g; ov="-n 2"; head $ov g; od="-- -r"; cp $od dd && ls dd', { files: ['p'] }).stdout;
    assert.deepStrictEqual(out.split('\n').filter(Boolean), ['f', 'ehuBc', 'q', "cp: missing destination file operand after 'c'", 'c2', '1', '2', 'dd']);
  });
});

describe("an option's value that may give no word (after #482)", () => {
  it('gives the role a word after the value takes when the value expands to nothing', () => {
    // With `a` empty, bash runs `tar -cf b` (tar takes `b` as the archive: "Cowardly refusing to create an empty archive"),
    // `cp -t a b` (`a` is the directory, `b` the source), `grep -e f` (the pattern `f`, read from stdin) and `grep -e -i f`.
    assert.strictEqual(tokenOf('tar -cf $a b', 'b').explanation, 'Word `b`; value for `-f` when `$a` expands to nothing');
    assert.strictEqual(tokenOf('tar cf $a b', 'b').explanation, 'Word `b`; value for `f` when `$a` expands to nothing');
    assert.strictEqual(tokenOf('cp -t $d $a', '$a').explanation, 'source; its first word is value for `-t` when `$d` expands to nothing');
    assert.strictEqual(tokenOf('cp -t $d a b', 'b').explanation, 'source');
    assert.strictEqual(tokenOf('grep -e $p f', 'f').explanation, 'file to search (default: stdin); value for `-e` when `$p` expands to nothing');
    assert.strictEqual(tokenOf('grep -e $p -i f', '-i').explanation, 'ignore case; value for `-e` when `$p` expands to nothing');
    assert.strictEqual(tokenOf('grep -e $p -i f', 'f').explanation, 'file to search (default: stdin)');
    assert.strictEqual(tokenOf('read -p $q -r x', '-r').explanation, 'do not treat backslashes as escapes (almost always wanted); value for `-p` when `$q` expands to nothing');
    assert.strictEqual(tokenOf('shopt -s nullglob; tar -cf *.tar b', 'b').explanation, 'Word `b`; value for `-f` when `*.tar` expands to nothing');
    assert.strictEqual(tokenOf('tar -cf $a b', 'b', 'ja').explanation, '文字列 `b`、`$a` が0語なら `-f` オプションの値');
    assert.strictEqual(tokenOf('tar cf $a b', 'b', 'ja').explanation, '文字列 `b`、`$a` が0語なら `f` の値');
    assert.strictEqual(tokenOf('cp -t $d $a', '$a', 'ja').explanation, 'コピー元、`$d` が0語ならこの語の最初の語は `-t` オプションの値');
    assert.strictEqual(tokenOf('grep -e $p -i f', '-i', 'ja').explanation, '大文字・小文字を区別しない、`$p` が0語なら `-e` オプションの値');
    // (Any option, and the end of options: `grep -e -- f` reads the pattern `--` from stdin, `head -c -5 f` prints all but
    // the last 5 bytes, `grep -e --nope f` looks for `--nope`.)
    assert.strictEqual(tokenOf('grep -e $p -- f', '--').explanation, 'End of options: everything after is a plain argument; value for `-e` when `$p` expands to nothing');
    assert.strictEqual(tokenOf('head -c $n -5 f', '-5').explanation, '5 lines (old way to write `-n 5`); value for `-c` when `$n` expands to nothing');
    assert.strictEqual(tokenOf('grep -e $p --nope f', '--nope').explanation, 'Option (not in the dictionary; see `man grep`); value for `-e` when `$p` expands to nothing');
    assert.strictEqual(tokenOf('grep -e $p -- f', '--', 'ja').explanation, 'オプションの終わり: 以降は `-` で始まっていても通常の引数として扱う、`$p` が0語なら `-e` オプションの値');
  });

  it('gives the role a value takes when a value before it expands to nothing, and the hedge of an operand with its own', () => {
    // `grep -e -e x -e y f`: the pattern `-e`, then `x` is a file (grep: x: No such file or directory), and `y` is still a
    // pattern; `grep -e -e x -ic f` reads `-ic` as options still.
    const pattern = 'Value for `-e`: specify a pattern (useful for several or `-`-prefixed ones) — basic regex (BRE)';
    assert.strictEqual(tokenOf('grep -e $p -e x -e y', 'x').explanation, `${pattern}; file to search (default: stdin) when \`$p\` expands to nothing`);
    assert.strictEqual(tokenOf('grep -e $p -e x -e y', 'y').explanation, pattern);
    assert.strictEqual(tokenOf('grep -e $p -e x -ic f', '-ic').explanation, 'Combined short options `-i` `-c`');
    assert.strictEqual(tokenOf('grep -e $p -e x -e y', 'x', 'ja').explanation, '`-e` オプションの値: 検索パターンを指定（`-` で始まるパターンや複数指定に使う） — 基本正規表現(BRE)、`$p` が0語なら検索対象のファイル（省略時は標準入力）');
    // (`grep -m -c f`: `-c` is the count, which grep refuses: "invalid max count". `f` keeps the hedge of `$x`.)
    assert.strictEqual(tokenOf('grep -m $n -c $x f', '-c').explanation, 'print a count of matching lines; value for `-m` when `$n` expands to nothing');
    assert.strictEqual(tokenOf('grep -m $n -c $x f', 'f').explanation, 'file to search (default: stdin); search pattern (regex) when `$x` expands to nothing');
    // (`tar cfC arc.tar sub g`: each letter takes the next word left, so `d` is the archive and `x` the directory.)
    assert.strictEqual(tokenOf('tar cfC $a d x', 'd').explanation, 'Value for `C`; value for `f` when `$a` expands to nothing');
    assert.strictEqual(tokenOf('tar cfC $a d x', 'x').explanation, 'Word `x`; value for `C` when `$a` expands to nothing');
    assert.strictEqual(tokenOf('tar cfC $a d x', 'd', 'ja').explanation, '`C` の値、`$a` が0語なら `f` の値');
    // (`jq --arg v .`: `v` is the name, and `.` its value.)
    assert.strictEqual(tokenOf('jq --arg $n v .', 'v').explanation, 'Value for `--arg`; name for `--arg` when `$n` expands to nothing');
    assert.strictEqual(tokenOf('jq --arg $n v .', '.').explanation, 'jq filter (e.g. `.items[].name`); value for `--arg` when `$n` expands to nothing');
    assert.strictEqual(tokenOf('jq --arg $n v .', 'v', 'ja').explanation, '`--arg` の値、`$n` が0語なら `--arg` の名前');
    // (After the note on the pattern's language, which is of the reading where `$v` gives a word: `grep -d a b`.)
    assert.strictEqual(tokenOf('grep -d $v a b', 'a').explanation, 'search pattern (regex) — basic regex (BRE); value for `-d` when `$v` expands to nothing');
  });

  it('says nothing where the value gives a word, or the role it then takes is not an operand or a value', () => {
    // (A value known as one word, or none (`tar -cf b`, #485); a quoted one.)
    assert.strictEqual(tokenOf('a=x; tar -cf $a b', 'b').explanation, 'Word `b`');
    assert.strictEqual(tokenOf('a=; tar -cf $a b', 'b').explanation, 'Value for `-f`');
    assert.strictEqual(tokenOf('tar -cf "$a" b', 'b').explanation, 'Word `b`');
    // (`tar -f -f x b`: `x` is a file to archive, which tar's spec does not describe; `grep -e -e -i f`, `-i` an option.)
    assert.strictEqual(tokenOf('tar -f $a -f x b', 'x').explanation, 'Value for `-f`');
    assert.match(tokenOf('grep -e $p -e -i f', '-i').explanation, /basic regex \(BRE\)$/);
    // (Nor where the role stays: an option, letters, a word the spec does not describe.)
    assert.strictEqual(tokenOf('grep -e $p -e x -i f', '-i').explanation, 'ignore case');
    assert.strictEqual(tokenOf('tar -cf $a b c', 'c').explanation, 'Word `c`');
    // (Left: `sudo -u ls` takes `ls` as the user, and runs nothing; `git -C status` changes to `status`. An option before a
    // command or a subcommand says it: `sudo -u -i ls` runs `ls` as the user `-i`; `git -C -p status` fails "cannot change
    // to '-p'".)
    assert.match(tokenOf('sudo -u $u ls', 'ls').explanation, /^runs `ls`: List directory contents$/);
    assert.match(tokenOf('sudo -u $u -i ls', '-i').explanation, /; value for `-u` when `\$u` expands to nothing$/);
    assert.match(tokenOf('git -C $d -p status', '-p').explanation, /; value for `-C` when `\$d` expands to nothing$/);
    assert.match(tokenOf('git -C $d -p status', 'status').explanation, /^Subcommand `git status`/);
  });

  it('names the word it is of, joins equal readings, and keeps the code spans and the Japanese spacing (review of #487)', () => {
    // (git cuts its words at `--` before it reads an option: `git log -n -- f` fails "-n requires an argument". rsync takes
    // `--` as the value: `rsync -e -- a b` copies with the remote shell `--`.)
    assert.strictEqual(tokenOf('git log -n $n -- f', '--').explanation, 'End of options: everything after is a plain argument');
    assert.strictEqual(tokenOf('git log --author $n -- f', '--').explanation, 'End of options: everything after is a plain argument');
    assert.strictEqual(tokenOf('git show --pretty $p -- f', '--').explanation, 'End of options: everything after is a plain argument');
    assert.strictEqual(tokenOf('rsync -e $e -- a b', '--').explanation, 'End of options: everything after is a plain argument; value for `-e` when `$e` expands to nothing');
    // (Only the first word of a word that may give several is the value: `tar -cf a b c` with `a=` and `y='a b'`.)
    assert.strictEqual(tokenOf('grep -e $p "$@"', '"$@"').explanation, 'file to search (default: stdin); its first word is value for `-e` when `$p` expands to nothing');
    assert.strictEqual(tokenOf('grep -e $p "$@"', '"$@"', 'ja').explanation, '検索対象のファイル（省略時は標準入力）、`$p` が0語ならこの語の最初の語は `-e` オプションの値');
    assert.strictEqual(tokenOf('y="a b"; tar -cf $a $y c', '$y').explanation, 'expands to `a` (argument; value for `-f` when `$a` expands to nothing) and `b` (argument)');
    assert.strictEqual(tokenOf('y="a b"; tar -cf $a $y c', '$y', 'ja').explanation, '`a`（引数、`$a` が0語なら `-f` オプションの値）と `b`（引数）に展開される');
    // (A field that is an option says it too: `grep -e -i x f` looks for `-i` in `x` and `f`.)
    assert.strictEqual(tokenOf('y="-i x"; grep -e $p $y f', '$y').explanation, 'expands to `-i` (option: ignore case; value for `-e` when `$p` expands to nothing) and `x` (file to search: default: stdin)');
    // (The same reading after either of two words, once: `jq --arg n .` and `jq --arg v .` both take `.` as the value.)
    assert.strictEqual(tokenOf('jq --arg $n $v .', '.').explanation, 'jq filter (e.g. `.items[].name`); value for `--arg` when `$n` or `$v` expands to nothing');
    assert.strictEqual(tokenOf('jq --arg $n $v .', '.', 'ja').explanation, 'jq フィルタ（例: `.items[].name`）、`$n` か `$v` が0語なら `--arg` の値');
    // (A space before a role in Latin letters; a fence around a word with a backquote.)
    assert.strictEqual(tokenOf('jq --arg n $v . f', 'f', 'ja').explanation, '入力 JSON ファイル、`$v` が0語なら jq フィルタ（例: `.items[].name`）');
    assert.strictEqual(tokenOf('grep -e `cmd` -i f', '-i').explanation, 'ignore case; value for `-e` when `` `cmd` `` expands to nothing');
  });

  it('runs those lines in bash, GNU tar, cp, grep and git as said', function () {
    this.timeout(20000);
    const out = runBash('a=; mkdir d sub; touch sub/g; printf "f\\nx-i\\n--\\n" > f; tar -cf $a f 2>&1 | head -1; cp -t $a d 2>&1 | head -1; '
      + 'grep -e $a f < f; grep -e $a -i < f; grep -e $a -e x -e y f 2>&1; grep -m $a -c f 2>&1; echo "a\\b" | { read -p $a -r x; echo "$x"; } 2>/dev/null; '
      + 'grep -e $a -- f < f; head -c $a -5 f; echo; tar cfC $a arc.tar sub g && tar tf arc.tar; git -C $a -p status 2>&1; '
      + 'git init -q; git log -n $a -- f 2>&1; git log --author $a -- f 2>&1; y="arc2.tar f"; tar -cf $a $y && tar tf arc2.tar; y="-i x"; grep -e $a $y f 2>&1', { files: ['.keep'] }).stdout;
    assert.deepStrictEqual(out.split('\n').filter(Boolean), ['tar: Cowardly refusing to create an empty archive', 'cp: missing file operand', 'f', 'x-i', 'grep: x: No such file or directory', 'grep: invalid max count', 'ab', '--', 'f', 'x-', 'g', "fatal: cannot change to '-p': No such file or directory",
      'error: -n requires an argument', "fatal: Option '--author' requires a value", 'f', 'grep: x: No such file or directory', 'f:x-i']);
  });
});
