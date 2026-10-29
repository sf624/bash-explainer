// The lines where the analyzer's old argument walk read a word wrongly, found by comparing it with the
// argument interpreter (src/argv/interpret.ts) before the walk was replaced by it. Each row says what the
// word is now; the comment says how the real tool reads it.
import * as assert from 'assert';
import { Analyzer, Kind, Token } from '../src/analyzer';
import { countIn } from '../src/semantics/argwords';
import { shellState } from '../src/semantics/state';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { descendants, fields } from '../src/syntax/tree';
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
    // (Braces that do not expand: `set +B; x='p q'; cp {a,$x}` runs `cp {a,p q}`.)
    assert.strictEqual(tokenOf('set +B; x="p q"; cp {a,$x}', '{a,$x}').explanation, hedge('{a,$x}'));
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
    // (A known field that starts with `-` may be an option, which the interpreter does not read: the range stays.)
    assert.deepStrictEqual(count('x=-r; cp {a,$x}'), { min: 1 });
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
    assert.strictEqual(tokenOf('cmp $a', '$a').explanation, 'first file (`-` for stdin) when `$a` expands to a single word; when it expands to 2 words, they are first file (`-` for stdin), then second file; when it expands to 3 words, they are first file (`-` for stdin), then second file, then bytes to skip in the first file; when it expands to more, they are first file (`-` for stdin), then second file, then bytes to skip in the first file, then bytes to skip in the second file');
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
    assert.strictEqual(tokenOf('cmp {a,b}* f', 'f').explanation, 'bytes to skip in the first file when `{a,b}*` expands to 2 words; bytes to skip in the second file when it expands to more');
    assert.strictEqual(tokenOf('cmp {a,b}* f', 'f', 'ja').explanation, '`{a,b}*` が2語に展開されるなら1 つ目のファイルで読み飛ばすバイト数、3語以上なら2 つ目のファイルで読み飛ばすバイト数');
    assert.strictEqual(tokenOf('cmp {a,b}* f $c', 'f').explanation, 'bytes to skip in the first file when `{a,b}*`, `$c` expand to as few words as each can; when any of them expands to more, it is bytes to skip in the first file or bytes to skip in the second file');
    assert.strictEqual(tokenOf('cmp {a,b}* f $c', 'f', 'ja').explanation, '`{a,b}*`・`$c` がそれぞれ最も少ない語数に展開されるなら1 つ目のファイルで読み飛ばすバイト数、どれかがそれより多いならこの語は1 つ目のファイルで読み飛ばすバイト数・2 つ目のファイルで読み飛ばすバイト数のどれか');
    // (The same roles for every count it gives: `chmod a* b*` is the mode, then files.)
    assert.strictEqual(tokenOf('chmod {a,b}*', '{a,b}*').explanation, 'when `{a,b}*` expands to 2 words or more, they are mode (e.g. `755`, `+x`, `u+w`), then target file');
    // (A brace expansion of globs gives at least one word each.)
    assert.strictEqual(tokenOf('cp {a,b}*.txt dir', 'dir').explanation, 'destination directory');
  });

  it('gives the roles any counts give where two words may give several, and a role for each count of the one other', () => {
    // (bash: with `a='x y'` and `b=z`, `cp $a $b` runs `cp x y z` (`z` a directory), `gosu $a $b` with `a='u ls'` runs
    // `ls z` as `u`, `cmp $a $b` reads `z` as the bytes to skip in the first file; with `a=x` and `b='y z'`, `y` is the
    // destination directory, `ls` runs `z`, cmp reads `y` as the second file.)
    assert.strictEqual(tokenOf('cp $a $b', '$b').explanation, 'destination (the new name, or an existing directory) when `$a`, `$b` expand to a single word; when any of them expands to more, each of its words is source or destination directory; source when `$a` expands to nothing');
    assert.strictEqual(tokenOf('cp $a $b', '$a').explanation, 'source');
    assert.strictEqual(tokenOf('gosu $a $b', '$b').explanation, 'command to run when `$a`, `$b` expand to a single word; when any of them expands to more, each of its words is command to run or argument to the command; user (or `user:group`) when `$a` expands to nothing');
    assert.strictEqual(tokenOf('cmp $a $b', '$b').explanation, 'second file when `$a`, `$b` expand to a single word; when any of them expands to more, each of its words is second file, bytes to skip in the first file or bytes to skip in the second file; first file (`-` for stdin) when `$a` expands to nothing');
    assert.strictEqual(tokenOf('cp $a $b', '$b', 'ja').explanation, '`$a`・`$b` が1語に展開されるならコピー先（新しい名前、または既存のディレクトリ）、どれかが2語以上ならこの語の各語はコピー元・コピー先のディレクトリのどれか、`$a` が0語ならコピー元');
    // (Its own fewest words of two roles: none is its own; `chmod a* b* c` is the mode, then files.)
    assert.strictEqual(tokenOf('chmod {a,b}* $c', '{a,b}*').explanation, 'each of its words is mode (e.g. `755`, `+x`, `u+w`) or target file, by how many words `{a,b}*`, `$c` expand to');
    assert.strictEqual(tokenOf('chmod {a,b}* $c', '{a,b}*', 'ja').explanation, '`{a,b}*`・`$c` が展開される語数により、この語の各語は権限（例: `755`, `+x` は実行権限を付与, `u+w`）・対象のファイルのどれか');
    // (After one such word, a role for each count: `cmp x y f` skips `f` bytes in the first file, `cmp x y z f` in the
    // second.)
    assert.strictEqual(tokenOf('cmp $a f', 'f').explanation, 'second file when `$a` expands to a single word; bytes to skip in the first file when it expands to 2 words; bytes to skip in the second file when it expands to more; first file (`-` for stdin) when `$a` expands to nothing');
    assert.strictEqual(tokenOf('cmp $a f', 'f', 'ja').explanation, '`$a` が1語に展開されるなら2 つ目のファイル、2語なら1 つ目のファイルで読み飛ばすバイト数、3語以上なら2 つ目のファイルで読み飛ばすバイト数、`$a` が0語なら1 つ目のファイル（`-` で標準入力）');
    assert.strictEqual(tokenOf('cmp {a,b}* f g', 'g').explanation, 'bytes to skip in the second file');
    // (One role for any count but the fewest: `cmp x y z f` skips `f` bytes in the second file.)
    assert.strictEqual(tokenOf('cmp $a $b f', 'f').explanation, 'bytes to skip in the first file when `$a`, `$b` expand to a single word; when any of them expands to more, it is bytes to skip in the second file; first file (`-` for stdin) when `$a`, `$b` expand to nothing');
    assert.strictEqual(tokenOf('cmp $a $b f', 'f', 'ja').explanation, '`$a`・`$b` が1語に展開されるなら1 つ目のファイルで読み飛ばすバイト数、どれかが2語以上ならこの語は2 つ目のファイルで読み飛ばすバイト数、`$a`・`$b` が0語なら1 つ目のファイル（`-` で標準入力）');
  });

  it('reads the hedges of many words that may give several in about the time of the line (review of #484)', function () {
    this.timeout(30000);
    // (The hedges are read when the explanation asks, each reading once: 80 words took 5.6 s, against 30 ms before them.)
    const many = (prefix: string, word: (i: number) => string) => `${prefix} ${Array.from({ length: 80 }, (_, i) => word(i)).join(' ')}`;
    for (const line of [many('cp', (i) => `$a${i}`), many('echo', (i) => `*.x${i}`), many('rm -f', (i) => `*.x${i}`)]) {
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
    assert.strictEqual(tokenOf('cp $a $a/x', '$a/x').explanation, 'destination (the new name, or an existing directory) when `$a`, `$a/x` expand to a single word; when any of them expands to more, each of its words is source or destination directory; source when `$a` expands to nothing');
    assert.strictEqual(tokenOf('cp $a $b c', 'c').explanation, 'destination directory; source when `$a`, `$b` expand to nothing');
    assert.strictEqual(tokenOf('cp $a b', 'b', 'ja').explanation, '`$a` が1語に展開されるならコピー先（新しい名前、または既存のディレクトリ）、2語以上ならコピー先のディレクトリ、`$a` が0語ならコピー元');
    assert.strictEqual(tokenOf('cp $a $b c', 'c', 'ja').explanation, 'コピー先のディレクトリ、`$a`・`$b` が0語ならコピー元');
    // (Not where the model says the word gives a word: a value set here, `$#`; with nullglob, a glob may give none.)
    assert.strictEqual(tokenOf('a=1; cp $a b', 'b').explanation, 'destination (the new name, or an existing directory) when `$a` expands to a single word; destination directory when it expands to more');
    assert.strictEqual(tokenOf('grep -c $# f', 'f').explanation, 'file to search (default: stdin)');
    assert.strictEqual(tokenOf('shopt -s nullglob; grep -c *.txt f', 'f').explanation, 'file to search (default: stdin); search pattern (regex) when `*.txt` expands to nothing');
    // (Nor where the role stays: `rm $a b`; `ln -s $a $b`, where `$a` is the target either way, with more said of it when
    // `$b` gives none.)
    assert.strictEqual(tokenOf('rm $a b', 'b').explanation, 'file to remove');
    assert.strictEqual(tokenOf('ln -s $a $b', '$a').explanation, 'target');
    // (The words of a builtin turned off, read again as the program's, from the model too: `$#` is never empty.)
    assert.strictEqual(tokenOf('enable -n printf; command printf $# x', 'x').explanation, 'value for the format');
    // (In Japanese the roles of more words are a list with `・`, and the reading with none comes after a `、`.)
    assert.strictEqual(tokenOf('mv $a $b', '$b', 'ja').explanation, '`$a`・`$b` が1語に展開されるなら移動先（新しい名前、または既存のディレクトリ）、どれかが2語以上ならこの語の各語は移動元・移動先のディレクトリのどれか、`$a` が0語なら移動元');
  });
});
