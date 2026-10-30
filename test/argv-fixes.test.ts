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
import { type ArgRole } from '../src/argv/interpret';
import type { OperandSpec } from '../src/argv/spec';
import { wordsBound } from '../src/argv/readings';
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
    assert.strictEqual(tokenOf('if c; then set +B; fi; cp {a,b} d', 'd').explanation, 'destination (the new name, or an existing directory). When `{a,b}` expands to several words, it is destination directory');
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
    const hedge = (w: string) => `source when \`${w}\` expands to a single word; when it expands to 2 words, they are source, then destination (the new name, or an existing directory); when it expands to more words, they are source, then destination directory`;
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
    assert.strictEqual(tokenOf('cp *.txt dir', 'dir').explanation, 'destination (the new name, or an existing directory). When `*.txt` expands to several words, it is destination directory');
    // (bash runs `cp a b` with two words, the two-operand form: `b` is a new name or an existing directory; with three,
    // `cp a b c`, the last must be a directory. Also `ln -s a b`: the link `b`; and `cmp`, a form for each count.)
    const dest = 'they are source, then destination (the new name, or an existing directory)';
    assert.strictEqual(tokenOf('cp "$@"', '"$@"').explanation, `source when \`"$@"\` expands to a single word; when it expands to 2 words, ${dest}; when it expands to more words, they are source, then destination directory`);
    assert.strictEqual(tokenOf('cp $a', '$a', 'ja').explanation, '`$a` が1語に展開されるならコピー元、2語なら順にコピー元・コピー先（新しい名前、または既存のディレクトリ）、3語以上なら順にコピー元・コピー先のディレクトリ');
    assert.strictEqual(tokenOf('ln -s $x', '$x').explanation, 'target (the link is made in the current directory, with the same name) when `$x` expands to a single word; when it expands to 2 words, they are target, then link name (or an existing directory to make the link in); when it expands to more words, they are target, then directory to make the links in');
    // (`a=1; cp $a{,.bak}`: the model knows the words, #483.)
    assert.strictEqual(tokenOf('a=1; cp $a{,.bak}', '$a{,.bak}').explanation, 'expands to `1` (source) and `1.bak` (destination: the new name, or an existing directory)');
    assert.strictEqual(tokenOf('cmp $a', '$a').explanation, 'first file (`-` for stdin); when `$a` expands to several words, this is the role of the first word `$a` gives, and the others are second file, bytes to skip in the first file, bytes to skip in the second file, then extra operand, which the command refuses (it prints `extra operand` and exits with status 2, doing nothing)');
    // (A word after: the same form for two words and more, `cp b x y`; a word before it is a source for any count.)
    assert.strictEqual(tokenOf('cp b $a', '$a').explanation, 'destination (the new name, or an existing directory) when `$a` expands to a single word; when it expands to more words, they are source, then destination directory');
    assert.deepStrictEqual(['$a', 'd'].map((w) => tokenOf('cp $a d', w).explanation), ['source', 'destination (the new name, or an existing directory). When `$a` expands to nothing, it is source. When `$a` expands to several words, it is destination directory']);
    // (A word that gives two words at least, each of `{a,b}*` a glob: no reading for one; nor one when it is the same for
    // any count, `rm $a`.)
    assert.strictEqual(tokenOf('cp {a,b}*', '{a,b}*').explanation, `when \`{a,b}*\` expands to 2 words, ${dest}; when it expands to more words, they are source, then destination directory`);
    assert.strictEqual(tokenOf('cp {a,b}*', '{a,b}*', 'ja').explanation, '`{a,b}*` が2語に展開されるなら順にコピー元・コピー先（新しい名前、または既存のディレクトリ）、3語以上なら順にコピー元・コピー先のディレクトリ');
    assert.strictEqual(tokenOf('rm $a', '$a').explanation, 'file to remove');
    // (A word after it, read with its fewest words: `cmp a* b* f` skips `f` bytes in the first file, `cmp a1 a2 b* f` in
    // the second. With another word that may give several, as few as each can.)
    assert.strictEqual(tokenOf('cmp {a,b}* f', 'f').explanation, 'bytes to skip in the first file. When `{a,b}*` expands to 3 words, it is bytes to skip in the second file. When `{a,b}*` expands to 4 words or more, it is extra operand, which the command refuses (it prints `extra operand` and exits with status 2, doing nothing)');
    assert.strictEqual(tokenOf('cmp {a,b}* f', 'f', 'ja').explanation, '1 つ目のファイルで読み飛ばすバイト数。`{a,b}*` が3語なら2 つ目のファイルで読み飛ばすバイト数。`{a,b}*` が4語以上なら余分なオペランド（コマンドは受け付けず、`extra operand` と表示して何もせずに終了ステータス 2 で終わる）');
    assert.strictEqual(tokenOf('cmp {a,b}* f $c', 'f').explanation, 'bytes to skip in the first file. When `{a,b}*` expands to 3 words, it is bytes to skip in the second file. When `{a,b}*` expands to 4 words or more, it is extra operand, which the command refuses (it prints `extra operand` and exits with status 2, doing nothing)');
    assert.strictEqual(tokenOf('cmp {a,b}* f $c', 'f', 'ja').explanation, '1 つ目のファイルで読み飛ばすバイト数。`{a,b}*` が3語なら2 つ目のファイルで読み飛ばすバイト数。`{a,b}*` が4語以上なら余分なオペランド（コマンドは受け付けず、`extra operand` と表示して何もせずに終了ステータス 2 で終わる）');
    // (The same roles for every count it gives: `chmod a* b*` is the mode, then files.)
    assert.strictEqual(tokenOf('chmod {a,b}*', '{a,b}*').explanation, 'its words are mode (e.g. `755`, `+x`, `u+w`), then target file');
    // (A brace expansion of globs gives at least one word each.)
    assert.strictEqual(tokenOf('cp {a,b}*.txt dir', 'dir').explanation, 'destination directory');
  });

  it('gives the roles any counts give where two words may give several, and a role for each count of the one other', () => {
    // (bash: with `a='x y'` and `b=z`, `cp $a $b` runs `cp x y z` (`z` a directory), `gosu $a $b` with `a='u ls'` runs
    // `ls z` as `u`, `cmp $a $b` reads `z` as the bytes to skip in the first file; with `a=x` and `b='y z'`, `y` is the
    // destination directory, `ls` runs `z`, cmp reads `y` as the second file.)
    assert.strictEqual(tokenOf('cp $a $b', '$b').explanation, 'destination (the new name, or an existing directory) when `$b` expands to a single word; when it expands to more words, they are source, then destination directory. When `$a` expands to nothing: source when `$b` expands to a single word; when it expands to 2 words, they are source, then destination (the new name, or an existing directory); when it expands to more words, they are source, then destination directory. When `$a` expands to several words: destination directory when `$b` expands to a single word; when it expands to more words, they are source, then destination directory');
    assert.strictEqual(tokenOf('cp $a $b', '$a').explanation, 'source. When `$b` expands to nothing: source when `$a` expands to a single word; when it expands to 2 words, they are source, then destination (the new name, or an existing directory); when it expands to more words, they are source, then destination directory');
    assert.strictEqual(tokenOf('gosu $a $b', '$b').explanation, 'command to run; when `$b` expands to several words, this is the role of the first word `$b` gives, and each of the others is argument to the command. When `$a` expands to nothing, its words are user (or `user:group`), command to run, then argument to the command. When `$a` expands to several words, it is argument to the command');
    assert.strictEqual(tokenOf('cmp $a $b', '$b').explanation, 'second file; when `$b` expands to several words, this is the role of the first word `$b` gives, and the others are bytes to skip in the first file, bytes to skip in the second file, then extra operand, which the command refuses (it prints `extra operand` and exits with status 2, doing nothing). When `$a` expands to nothing, its words are first file (`-` for stdin), second file, bytes to skip in the first file, bytes to skip in the second file, then extra operand, which the command refuses (it prints `extra operand` and exits with status 2, doing nothing). When `$a` expands to 2 words, its words are bytes to skip in the first file, bytes to skip in the second file, then extra operand, which the command refuses (it prints `extra operand` and exits with status 2, doing nothing). When `$a` expands to 3 words, its words are bytes to skip in the second file, then extra operand, which the command refuses (it prints `extra operand` and exits with status 2, doing nothing). When `$a` expands to 4 words or more, it is extra operand, which the command refuses (it prints `extra operand` and exits with status 2, doing nothing)');
    assert.strictEqual(tokenOf('cp $a $b', '$b', 'ja').explanation, '`$b` が1語に展開されるならコピー先（新しい名前、または既存のディレクトリ）、2語以上なら順にコピー元・コピー先のディレクトリ。`$a` が0語のときは、`$b` が1語に展開されるならコピー元、2語なら順にコピー元・コピー先（新しい名前、または既存のディレクトリ）、3語以上なら順にコピー元・コピー先のディレクトリ。`$a` が2語以上のときは、`$b` が1語に展開されるならコピー先のディレクトリ、2語以上なら順にコピー元・コピー先のディレクトリ');
    // (Its own fewest words of two roles: none is its own; `chmod a* b* c` is the mode, then files.)
    assert.strictEqual(tokenOf('chmod {a,b}* $c', '{a,b}*').explanation, 'its words are mode (e.g. `755`, `+x`, `u+w`), then target file');
    assert.strictEqual(tokenOf('chmod {a,b}* $c', '{a,b}*', 'ja').explanation, '順に権限（例: `755`, `+x` は実行権限を付与, `u+w`）・対象のファイル');
    // (After one such word, a role for each count: `cmp x y f` skips `f` bytes in the first file, `cmp x y z f` in the
    // second.)
    assert.strictEqual(tokenOf('cmp $a f', 'f').explanation, 'second file. When `$a` expands to nothing, it is first file (`-` for stdin). When `$a` expands to 2 words, it is bytes to skip in the first file. When `$a` expands to 3 words, it is bytes to skip in the second file. When `$a` expands to 4 words or more, it is extra operand, which the command refuses (it prints `extra operand` and exits with status 2, doing nothing)');
    assert.strictEqual(tokenOf('cmp $a f', 'f', 'ja').explanation, '2 つ目のファイル。`$a` が0語なら1 つ目のファイル（`-` で標準入力）。`$a` が2語なら1 つ目のファイルで読み飛ばすバイト数。`$a` が3語なら2 つ目のファイルで読み飛ばすバイト数。`$a` が4語以上なら余分なオペランド（コマンドは受け付けず、`extra operand` と表示して何もせずに終了ステータス 2 で終わる）');
    assert.strictEqual(tokenOf('cmp {a,b}* f g', 'g').explanation, 'bytes to skip in the second file. When `{a,b}*` expands to 3 words or more, it is extra operand, which the command refuses (it prints `extra operand` and exits with status 2, doing nothing)');
    // (Every count of each, none too: `a='x y' b=` runs `cmp x y f`, `f` the bytes to skip in the first file; `a= b=x`
    // runs `cmp x f`, `f` the second file.)
    assert.strictEqual(tokenOf('cmp $a $b f', 'f').explanation, 'bytes to skip in the first file. When `$a` and `$b` expand to nothing, it is first file (`-` for stdin). When `$a` and `$b` expand to one word in all, it is second file. When `$a` and `$b` expand to 3 words in all, it is bytes to skip in the second file. When `$a` and `$b` expand to 4 words or more in all, it is extra operand, which the command refuses (it prints `extra operand` and exits with status 2, doing nothing)');
    assert.strictEqual(tokenOf('cmp $a $b f', 'f', 'ja').explanation, '1 つ目のファイルで読み飛ばすバイト数。`$a`・`$b` が0語なら1 つ目のファイル（`-` で標準入力）。`$a`・`$b` が合わせて1語なら2 つ目のファイル。`$a`・`$b` が合わせて3語なら2 つ目のファイルで読み飛ばすバイト数。`$a`・`$b` が合わせて4語以上なら余分なオペランド（コマンドは受け付けず、`extra operand` と表示して何もせずに終了ステータス 2 で終わる）');
    // (`a='1 2' b=; seq $a $b f` runs `seq 1 2 f`: `f` is the last; with more, `seq 1 2 3 f` refuses it.)
    assert.strictEqual(tokenOf('seq $a $b f', 'f').explanation, 'last. When `$a` and `$b` expand to nothing, it is last (counting from 1). When `$a` and `$b` expand to 3 words or more in all, it is extra operand, which the command refuses (it prints `extra operand` and exits with status 1, doing nothing)');
    // (Globs give a word at least: `seq *.a *.b 5` with three files or more refuses `5`, seq: extra operand.)
    assert.strictEqual(tokenOf('seq *.a *.b 5', '5').explanation, 'last. When `*.a` and `*.b` expand to 3 words or more in all, it is extra operand, which the command refuses (it prints `extra operand` and exits with status 1, doing nothing)');
  });

  it('reads the hedges of many words that may give several in about the time of the line (review of #484)', function () {
    this.timeout(60000);
    // (The hedges are read when the explanation asks, each reading once: 80 words took 5.6 s, against 30 ms before them.
    // Since the table of readings (docs/design/count-hedges.md) the three lines of `cp`, `echo` and `rm` take 0.7 to 0.9 s
    // here, 2 to 3.4 times that on a GitHub runner, so a bound in milliseconds fell between the two (2062 to 2688 ms
    // failed on main). The bound is a multiple of the time the same lines take with the words written out, in the same
    // process: it moves with the speed of the machine. The lines take 6 to 13 times that; the old blow-up 75 times.)
    const many = (prefix: string, word: (i: number) => string) => `${prefix} ${Array.from({ length: 80 }, (_, i) => word(i)).join(' ')}`;
    // (And the line read again without each value that may give none, once: `grep -e $a1 -e $a3 …`, after #482.)
    const lines: [string, string][] = [
      [many('cp', (i) => `$a${i}`), many('cp', (i) => `a${i}`)],
      [many('echo', (i) => `*.x${i}`), many('echo', (i) => `x${i}`)],
      [many('rm -f', (i) => `*.x${i}`), many('rm -f', (i) => `x${i}`)],
      [many('grep', (i) => (i % 2 ? `$a${i}` : '-e')), many('grep', (i) => (i % 2 ? `a${i}` : '-e'))],
      [many('tar -cf $f', (i) => `$a${i}`), many('tar -cf $f', (i) => `a${i}`)],
    ];
    const time = (line: string): number => {
      const start = performance.now();
      new Analyzer('en').explainLine(parser.parse(line), 0);
      return performance.now() - start;
    };
    // (The fewest of three runs of the five lines with their words written out; the first run also warms the tables up.)
    const unit = Math.min(...[0, 1, 2].map(() => lines.reduce((sum, [, written]) => sum + time(written), 0)));
    for (const [line] of lines) {
      // (A slow run is read again once: a pause of the machine does not repeat, a blow-up does.)
      let ms = time(line);
      if (ms > 40 * unit) ms = Math.min(ms, time(line));
      assert.ok(ms <= 40 * unit, `${line.slice(0, 20)}…: ${Math.round(ms)} ms, ${(ms / unit).toFixed(1)} times the ${Math.round(unit)} ms of the lines with their words written out`);
    }
  });

  it('gives the role a word takes when the words before it expand to nothing, where the model says they may', () => {
    // With `a` empty, bash runs `cp b` (cp: missing destination file operand after 'b'), `grep -c f` (the pattern `f`,
    // read from stdin) and `cp /x`.
    assert.strictEqual(tokenOf('cp $a b', 'b').explanation, 'destination (the new name, or an existing directory). When `$a` expands to nothing, it is source. When `$a` expands to several words, it is destination directory');
    assert.strictEqual(tokenOf('grep -c ${x} f', 'f').explanation, 'file to search (default: stdin). When `${x}` expands to nothing, it is search pattern (regex)');
    assert.strictEqual(tokenOf('cp $a $a/x', '$a/x').explanation, 'destination (the new name, or an existing directory) when `$a/x` expands to a single word; when it expands to more words, they are source, then destination directory. When `$a` expands to nothing: source when `$a/x` expands to a single word; when it expands to 2 words, they are source, then destination (the new name, or an existing directory); when it expands to more words, they are source, then destination directory. When `$a` expands to several words: destination directory when `$a/x` expands to a single word; when it expands to more words, they are source, then destination directory');
    assert.strictEqual(tokenOf('cp $a $b c', 'c').explanation, 'destination directory. When `$a` and `$b` expand to nothing, it is source. When `$a` and `$b` expand to one word in all, it is destination (the new name, or an existing directory)');
    assert.strictEqual(tokenOf('cp $a b', 'b', 'ja').explanation, 'コピー先（新しい名前、または既存のディレクトリ）。`$a` が0語ならコピー元。`$a` が2語以上ならコピー先のディレクトリ');
    assert.strictEqual(tokenOf('cp $a $b c', 'c', 'ja').explanation, 'コピー先のディレクトリ。`$a`・`$b` が0語ならコピー元。`$a`・`$b` が合わせて1語ならコピー先（新しい名前、または既存のディレクトリ）');
    // (Not where the model says the word gives a word: a value set here, read as its one field (`cp 1 b`), `$#`; with
    // nullglob, a glob may give none.)
    assert.strictEqual(tokenOf('a=1; cp $a b', 'b').explanation, 'destination (the new name, or an existing directory)');
    assert.strictEqual(tokenOf('grep -c $# f', 'f').explanation, 'file to search (default: stdin)');
    assert.strictEqual(tokenOf('shopt -s nullglob; grep -c *.txt f', 'f').explanation, 'file to search (default: stdin). When `*.txt` expands to nothing, it is search pattern (regex)');
    // (Nor where the role stays: `rm $a b`; `ln -s $a $b`, where `$a` is the target either way, with more said of it when
    // `$b` gives none.)
    assert.strictEqual(tokenOf('rm $a b', 'b').explanation, 'file to remove');
    assert.strictEqual(tokenOf('ln -s $a $b', '$a').explanation, 'target. When `$b` expands to nothing: target (the link is made in the current directory, with the same name) when `$a` expands to a single word; when it expands to 2 words, they are target, then link name (or an existing directory to make the link in); when it expands to more words, they are target, then directory to make the links in');
    // (The words of a builtin turned off, read again as the program's, from the model too: `$#` is never empty.)
    assert.strictEqual(tokenOf('enable -n printf; command printf $# x', 'x').explanation, 'value for the format');
    // (In Japanese the roles of more words are a list with `・`, and the reading with none comes after a `、`.)
    assert.strictEqual(tokenOf('mv $a $b', '$b', 'ja').explanation, '`$b` が1語に展開されるなら移動先（新しい名前、または既存のディレクトリ）、2語以上なら順に移動元・移動先のディレクトリ。`$a` が0語のときは、`$b` が1語に展開されるなら移動元、2語なら順に移動元・移動先（新しい名前、または既存のディレクトリ）、3語以上なら順に移動元・移動先のディレクトリ。`$a` が2語以上のときは、`$b` が1語に展開されるなら移動先のディレクトリ、2語以上なら順に移動元・移動先のディレクトリ');
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
    assert.strictEqual(tokenOf('tar -cf $a b', 'b').explanation, 'Word `b`. When `$a` expands to nothing, it is value for `-f`');
    assert.strictEqual(tokenOf('tar cf $a b', 'b').explanation, 'Word `b`. When `$a` expands to nothing, it is value for `f`');
    assert.strictEqual(tokenOf('cp -t $d $a', '$a').explanation, 'source. When `$d` expands to nothing, its words are value for `-t`, then source');
    assert.strictEqual(tokenOf('cp -t $d a b', 'b').explanation, 'source');
    assert.strictEqual(tokenOf('grep -e $p f', 'f').explanation, 'file to search (default: stdin). When `$p` expands to nothing, it is value for `-e`');
    assert.strictEqual(tokenOf('grep -e $p -i f', '-i').explanation, 'ignore case. When `$p` expands to nothing, it is value for `-e`');
    assert.strictEqual(tokenOf('grep -e $p -i f', 'f').explanation, 'file to search (default: stdin)');
    assert.strictEqual(tokenOf('read -p $q -r x', '-r').explanation, 'do not treat backslashes as escapes (almost always wanted). When `$q` expands to nothing, it is value for `-p`. When `$q` expands to several words, it is variable to store the input');
    assert.strictEqual(tokenOf('shopt -s nullglob; tar -cf *.tar b', 'b').explanation, 'Word `b`. When `*.tar` expands to nothing, it is value for `-f`');
    assert.strictEqual(tokenOf('tar -cf $a b', 'b', 'ja').explanation, '文字列 `b`。`$a` が0語なら `-f` オプションの値');
    assert.strictEqual(tokenOf('tar cf $a b', 'b', 'ja').explanation, '文字列 `b`。`$a` が0語なら `f` の値');
    assert.strictEqual(tokenOf('cp -t $d $a', '$a', 'ja').explanation, 'コピー元。`$d` が0語なら順に `-t` オプションの値・コピー元');
    assert.strictEqual(tokenOf('grep -e $p -i f', '-i', 'ja').explanation, '大文字・小文字を区別しない。`$p` が0語なら `-e` オプションの値');
    // (Any option, and the end of options: `grep -e -- f` reads the pattern `--` from stdin, `head -c -5 f` prints all but
    // the last 5 bytes, `grep -e --nope f` looks for `--nope`.)
    assert.strictEqual(tokenOf('grep -e $p -- f', '--').explanation, 'End of options: everything after is a plain argument. When `$p` expands to nothing, it is value for `-e`');
    assert.strictEqual(tokenOf('head -c $n -5 f', '-5').explanation, '5 lines (old way to write `-n 5`). When `$n` expands to nothing, it is value for `-c`');
    assert.strictEqual(tokenOf('grep -e $p --nope f', '--nope').explanation, 'Option (not in the dictionary; see `man grep`). When `$p` expands to nothing, it is value for `-e`');
    assert.strictEqual(tokenOf('grep -e $p -- f', '--', 'ja').explanation, 'オプションの終わり: 以降は `-` で始まっていても通常の引数として扱う。`$p` が0語なら `-e` オプションの値');
  });

  it('gives the role a value takes when a value before it expands to nothing, and the hedge of an operand with its own', () => {
    // `grep -e -e x -e y f`: the pattern `-e`, then `x` is a file (grep: x: No such file or directory), and `y` is still a
    // pattern; `grep -e -e x -ic f` reads `-ic` as options still.
    const pattern = 'Value for `-e`: specify a pattern (useful for several or `-`-prefixed ones) — basic regex (BRE)';
    assert.strictEqual(tokenOf('grep -e $p -e x -e y', 'x').explanation, `${pattern}. When \`$p\` expands to nothing, it is file to search (default: stdin)`);
    assert.strictEqual(tokenOf('grep -e $p -e x -e y', 'y').explanation, pattern);
    assert.strictEqual(tokenOf('grep -e $p -e x -ic f', '-ic').explanation, 'Combined short options `-i` `-c`');
    assert.strictEqual(tokenOf('grep -e $p -e x -e y', 'x', 'ja').explanation, '`-e` オプションの値: 検索パターンを指定（`-` で始まるパターンや複数指定に使う） — 基本正規表現(BRE)。`$p` が0語なら検索対象のファイル（省略時は標準入力）');
    // (`grep -m -c f`: `-c` is the count, which grep refuses: "invalid max count". `f` keeps the hedge of `$x`.)
    assert.strictEqual(tokenOf('grep -m $n -c $x f', '-c').explanation, 'print a count of matching lines. When `$n` expands to nothing, it is value for `-m`');
    // (With `$n` of two words, `grep -m 1 2 -c f` reads `2` as the pattern: `f` is a file still.)
    assert.strictEqual(tokenOf('grep -m $n -c $x f', 'f').explanation, 'file to search (default: stdin). When `$n` expands to nothing and `$x` to nothing, or when `$n` expands to a single word and `$x` to nothing, it is search pattern (regex)');
    // (`tar cfC arc.tar sub g`: each letter takes the next word left, so `d` is the archive and `x` the directory.)
    assert.strictEqual(tokenOf('tar cfC $a d x', 'd').explanation, 'Value for `C`. When `$a` expands to nothing, it is value for `f`. When `$a` expands to several words, it is argument');
    assert.strictEqual(tokenOf('tar cfC $a d x', 'x').explanation, 'Word `x`. When `$a` expands to nothing, it is value for `C`');
    assert.strictEqual(tokenOf('tar cfC $a d x', 'd', 'ja').explanation, '`C` の値。`$a` が0語なら `f` の値。`$a` が2語以上なら引数');
    // (`jq --arg v .`: `v` is the name, and `.` its value.)
    assert.strictEqual(tokenOf('jq --arg $n v .', 'v').explanation, 'Value for `--arg`. When `$n` expands to nothing, it is name for `--arg`. When `$n` expands to 2 words, it is jq filter (e.g. `.items[].name`). When `$n` expands to 3 words or more, it is input JSON file');
    assert.strictEqual(tokenOf('jq --arg $n v .', '.').explanation, 'jq filter (e.g. `.items[].name`). When `$n` expands to nothing, it is value for `--arg`. When `$n` expands to several words, it is input JSON file');
    assert.strictEqual(tokenOf('jq --arg $n v .', 'v', 'ja').explanation, '`--arg` の値。`$n` が0語なら `--arg` の名前。`$n` が2語なら jq フィルタ（例: `.items[].name`）。`$n` が3語以上なら入力 JSON ファイル');
    // (After the note on the pattern's language, which is of the reading where `$v` gives a word: `grep -d a b`.)
    assert.strictEqual(tokenOf('grep -d $v a b', 'a').explanation, 'search pattern (regex) — basic regex (BRE). When `$v` expands to nothing, it is value for `-d`. When `$v` expands to several words, it is file to search (default: stdin)');
  });

  it('says nothing where the value gives a word, or the role stays; says an option and a word the spec does not describe', () => {
    // (A value known as one word, or none (`tar -cf b`, #485); a quoted one.)
    assert.strictEqual(tokenOf('a=x; tar -cf $a b', 'b').explanation, 'Word `b`');
    assert.strictEqual(tokenOf('a=; tar -cf $a b', 'b').explanation, 'Value for `-f`');
    assert.strictEqual(tokenOf('tar -cf "$a" b', 'b').explanation, 'Word `b`');
    // (`tar -f -f x b`: `x` is a file to archive, which tar's spec does not describe; `grep -e -e -i f`, `-i` an option.)
    assert.strictEqual(tokenOf('tar -f $a -f x b', 'x').explanation, 'Value for `-f`. When `$a` expands to nothing, it is argument');
    assert.match(tokenOf('grep -e $p -e -i f', '-i').explanation, /basic regex \(BRE\)\. When `\$p` expands to nothing, it is option `-i` \(ignore case\)$/);
    // (Nor where the role stays: an option, letters, a word the spec does not describe.)
    assert.strictEqual(tokenOf('grep -e $p -e x -i f', '-i').explanation, 'ignore case');
    assert.strictEqual(tokenOf('tar -cf $a b c', 'c').explanation, 'Word `c`');
    // (`sudo -u ls` takes `ls` as the user, and runs nothing; `git -C status` changes to `status`: the command and the
    // subcommand say it, as an option before them does: `sudo -u -i ls` runs `ls` as the user `-i`; `git -C -p status`
    // fails "cannot change to '-p'". With two words of `$u`, `sudo -u a b -i ls` runs `b`, a command the dictionary does
    // not describe, whose words are its arguments.)
    assert.strictEqual(tokenOf('sudo -u $u ls', 'ls').explanation, 'runs `ls`: List directory contents. When `$u` expands to nothing, it is value for `-u`. When `$u` expands to several words, it is argument of the command a word of `$u` names');
    assert.match(tokenOf('sudo -u $u -i ls', '-i').explanation, /\. When `\$u` expands to nothing, it is value for `-u`\. When `\$u` expands to several words, it is argument of the command a word of `\$u` names$/);
    assert.match(tokenOf('git -C $d -p status', '-p').explanation, /\. When `\$d` expands to nothing, it is value for `-C`$/);
    assert.match(tokenOf('git -C $d -p status', 'status').explanation, /^Subcommand `git status`/);
  });

  it('names the word it is of, joins equal readings, and keeps the code spans and the Japanese spacing (review of #487)', () => {
    // (git cuts its words at `--` before it reads an option: `git log -n -- f` fails "-n requires an argument". rsync takes
    // `--` as the value: `rsync -e -- a b` copies with the remote shell `--`.)
    assert.strictEqual(tokenOf('git log -n $n -- f', '--').explanation, 'End of options: everything after is a plain argument');
    assert.strictEqual(tokenOf('git log --author $n -- f', '--').explanation, 'End of options: everything after is a plain argument');
    assert.strictEqual(tokenOf('git show --pretty $p -- f', '--').explanation, 'End of options: everything after is a plain argument');
    assert.strictEqual(tokenOf('rsync -e $e -- a b', '--').explanation, 'End of options: everything after is a plain argument. When `$e` expands to nothing, it is value for `-e`');
    // (Only the first word of a word that may give several is the value: `tar -cf a b c` with `a=` and `y='a b'`.)
    assert.strictEqual(tokenOf('grep -e $p "$@"', '"$@"').explanation, 'file to search (default: stdin). When `$p` expands to nothing, its words are value for `-e`, then file to search (default: stdin)');
    assert.strictEqual(tokenOf('grep -e $p "$@"', '"$@"', 'ja').explanation, '検索対象のファイル（省略時は標準入力）。`$p` が0語なら順に `-e` オプションの値・検索対象のファイル（省略時は標準入力）');
    assert.strictEqual(tokenOf('y="a b"; tar -cf $a $y c', '$y').explanation, 'expands to `a` (argument) and `b` (argument). When `$a` expands to nothing, its words are value for `-f`, then argument');
    assert.strictEqual(tokenOf('y="a b"; tar -cf $a $y c', '$y', 'ja').explanation, '`a`（引数）と `b`（引数）に展開される。`$a` が0語なら順に `-f` オプションの値・引数');
    // (A field that is an option says it too: `grep -e -i x f` looks for `-i` in `x` and `f`.)
    assert.strictEqual(tokenOf('y="-i x"; grep -e $p $y f', '$y').explanation, 'expands to `-i` (option: ignore case) and `x` (file to search: default: stdin). When `$p` expands to nothing, its words are value for `-e`, then file to search (default: stdin)');
    // (The sum of a run: `jq --arg n .` and `jq --arg v .` both take `.` as the value, `jq --arg a b c .` a file.)
    assert.strictEqual(tokenOf('jq --arg $n $v .', '.').explanation, 'jq filter (e.g. `.items[].name`). When `$n` and `$v` expand to one word in all, it is value for `--arg`. When `$n` and `$v` expand to 3 words or more in all, it is input JSON file');
    assert.strictEqual(tokenOf('jq --arg $n $v .', '.', 'ja').explanation, 'jq フィルタ（例: `.items[].name`）。`$n`・`$v` が合わせて1語なら `--arg` の値。`$n`・`$v` が合わせて3語以上なら入力 JSON ファイル');
    // (A space before a role in Latin letters; a fence around a word with a backquote.)
    assert.strictEqual(tokenOf('jq --arg n $v . f', 'f', 'ja').explanation, '入力 JSON ファイル。`$v` が0語なら jq フィルタ（例: `.items[].name`）');
    assert.strictEqual(tokenOf('grep -e `cmd` -i f', '-i').explanation, 'ignore case. When `` `cmd` `` expands to nothing, it is value for `-e`');
  });

  it('says no role of the first word where its own count changes it, when the others give none (review of #490)', () => {
    // (With `b`, `c` empty, `seq 11` reads `11` as the last and `seq 11 12` as the first; `tr a1` is one set and `tr a1 a2`
    // a translation. The hedge of every count says the roles.)
    const extra = 'extra operand, which the command refuses (it prints `extra operand` and exits with status 1, doing nothing)';
    assert.strictEqual(tokenOf('seq $a $b $c', '$a').explanation, `first; when \`$a\` expands to several words, this is the role of the first word \`$a\` gives, and the others are increment, last, then ${extra}. When \`$b\` and \`$c\` expand to nothing: last (counting from 1) when \`$a\` expands to a single word; when it expands to 2 words, they are first, then last; when it expands to 3 words, they are first, increment, then last; when it expands to more words, they are first, increment, last, then ${extra}`);
    // (`tr a1` is one set, which tr refuses; `tr a1 a2` a translation: a reading for each count of `$a` when `$b` gives none.)
    assert.match(tokenOf('tr $a $b', '$a').explanation, /\. When `\$b` expands to nothing: lone character set, .* when `\$a` expands to a single word; when it expands to 2 words, they are source character set \(e\.g\. `a-z`\), then target character set/);
    // (Where its count does not change it, the reading stays: `grep -e "$@"` takes its first word as the pattern.)
    assert.strictEqual(tokenOf('grep -e $p "$@"', '"$@"').explanation, 'file to search (default: stdin). When `$p` expands to nothing, its words are value for `-e`, then file to search (default: stdin)');
    assert.strictEqual(tokenOf('cp $a b', 'b').explanation, 'destination (the new name, or an existing directory). When `$a` expands to nothing, it is source. When `$a` expands to several words, it is destination directory');
  });

  it('says what the words after the first of a value that gives several are, and what the words after it then are (review of #490)', () => {
    // (`head -n 1 g f` reads `g` as a file; `cut -d : g f` too; `grep -e p g f` searches `g`.)
    assert.strictEqual(tokenOf('head -n $a f', '$a').explanation, 'Value for `-n`; when `$a` expands to several words, this is the role of the first word `$a` gives, and each of the others is target file');
    assert.strictEqual(tokenOf('head -n $a f', '$a', 'ja').explanation, '`-n` オプションの値。`$a` が2語以上に展開されるときは、その最初の語がこの役割で、残りの各語は対象のファイル');
    // (An operand before the value too: `head f -n 1 g` reads `f` and `g`.)
    assert.strictEqual(tokenOf('head f -n $a', '$a').explanation, 'Value for `-n`; when `$a` expands to several words, this is the role of the first word `$a` gives, and each of the others is target file');
    assert.strictEqual(tokenOf('cut -d $a f', '$a').explanation, 'Value for `-d`; when `$a` expands to several words, this is the role of the first word `$a` gives, and each of the others is target file');
    assert.match(tokenOf('grep -e $a f', '$a').explanation, /; when `\$a` expands to several words, this is the role of the first word `\$a` gives, and each of the others is file to search \(default: stdin\)$/);
    // (Words the spec does not describe, a command run: the words after it. `jq --arg a b c v .` takes `b` as the value,
    // `c` as the filter, and `v` as a file.)
    assert.strictEqual(tokenOf('tar -cf $a b', '$a', 'ja').explanation, '`-f` オプションの値。`$a` が2語以上に展開されるときは、その最初の語がこの役割で、残りの各語は引数');
    assert.strictEqual(tokenOf('sudo -u $u tar -cf x y', '$u').explanation, 'Value for `-u`; when `$u` expands to several words, this is the role of the first word `$u` gives, and the others are command to run, then argument of the command a word of `$u` names');
    assert.strictEqual(tokenOf('jq --arg $n v .', '$n').explanation, 'Name for `--arg` (use it as `$name` in the filter); when `$n` expands to several words, this is the role of the first word `$n` gives, and the others are value for `--arg`, jq filter (e.g. `.items[].name`), then input JSON file');
    // (`seq -s x 1`: `1` is the last, counting from 1; `seq -s x y 1`, the last after the first `y`; `seq -s x y z w 1`, an
    // extra operand.)
    assert.strictEqual(tokenOf('seq -s $a 1', '1').explanation, 'last (counting from 1). When `$a` expands to nothing, it is value for `-s`. When `$a` expands to 2 words, or when `$a` expands to 3 words, it is last. When `$a` expands to 4 words or more, it is extra operand, which the command refuses (it prints `extra operand` and exits with status 1, doing nothing)');
    // (`timeout -s KILL x 5 ls` runs `5`, `timeout -s KILL x y 5 ls` runs `y` with the argument `5`; `jq --arg "$x"a "$x"b`, the name and its value; `sudo -u "$x"a "$x"b ls` runs `"$x"b`.)
    assert.strictEqual(tokenOf('timeout -s $s 5 ls', '5').explanation, 'time limit (`5`, `30s`, `2m`, `1h`). When `$s` expands to nothing, it is value for `-s`. When `$s` expands to 2 words, it is command to run. When `$s` expands to 3 words or more, it is argument of the command a word of `$s` names');
    assert.strictEqual(tokenOf('jq --arg "$x"{a,b} . f', '"$x"{a,b}').explanation, 'expands to `"$x"a` (name for `--arg`) and `"$x"b` (value for `--arg`)');
    assert.strictEqual(tokenOf('sudo -u "$x"{a,b} ls', '"$x"{a,b}').explanation, 'expands to `"$x"a` (value for `-u`) and `"$x"b` (the command to run)');
    // (The same roles after two values are one reading: `seq -s x y -f %g 1`, `seq -s : -f x y 1`.)
    assert.strictEqual(tokenOf('seq -s $a -f $b 1', '1').explanation, 'last (counting from 1). It can also be last, extra operand, which the command refuses (it prints `extra operand` and exits with status 1, doing nothing) or value for `-f`, by how many words `$a` and `$b` give');
    assert.strictEqual(tokenOf('seq -s $a -f $b 1', '1', 'ja').explanation, '終了値（開始値は 1）。`$a`・`$b` が展開される語数により、終了値・余分なオペランド（コマンドは受け付けず、`extra operand` と表示して何もせずに終了ステータス 1 で終わる）・`-f` オプションの値のどれかにもなる');
    // (A command string of an option keeps its role: `su -s x y -c ls`.)
    assert.match(tokenOf('su -s $s -c ls', 'ls').explanation, /^Value for `-c`\. The shell that runs it is not known here/);
    // (Nothing where the words after it keep their role: `head -n 1 g f` reads `f` as a file still.)
    assert.strictEqual(tokenOf('head -n $a f', 'f').explanation, 'target file. When `$a` expands to nothing, it is value for `-n`');
  });

  it('reads a word of a known start, and one of two words or more, at every count (review of #516; jq and GNU grep)', function () {
    this.timeout(20000);
    // (A word of a known start whose first field is one word: its first word keeps the start, the others are the words
    // after it. `grep -e xy g f` searches `g` and `f`; `sudo -u ua b ls` runs `b`.)
    assert.strictEqual(tokenOf('gcc -o bin/$n a.c', 'bin/$n').explanation, 'Value for `-o`; when `bin/$n` expands to several words, this is the role of the first word `bin/$n` gives, and each of the others is source file');
    assert.strictEqual(tokenOf('grep -e x$p f', 'x$p').explanation, 'Value for `-e`: specify a pattern (useful for several or `-`-prefixed ones); when `x$p` expands to several words, this is the role of the first word `x$p` gives, and each of the others is file to search (default: stdin)');
    assert.strictEqual(tokenOf('sudo -u u$u ls', 'ls').explanation, 'runs `ls`: List directory contents. When `u$u` expands to several words, it is argument of the command a word of `u$u` names');
    // (A word of two words or more is read as written at its fewest: `jq --arg Xa Xb . f` takes `.` as the filter, with
    // `y` empty or `p`, and `jq --arg a b . f` too, with no positional parameters.)
    const filter = 'jq filter (e.g. `.items[].name`)';
    assert.strictEqual(tokenOf('jq --arg "$x"{a,b}$y . f', '.').explanation, `${filter}. When \`"$x"{a,b}$y\` expands to 3 words or more, it is input JSON file`);
    assert.strictEqual(tokenOf('jq --arg "$x"{a,b}$y . f', '"$x"{a,b}$y').explanation, `its words are name for \`--arg\`, value for \`--arg\`, ${filter}, then input JSON file`);
    assert.strictEqual(tokenOf('jq --arg "$x"{a,b}$y . f', '"$x"{a,b}$y', 'ja').explanation, '順に `--arg` の名前・`--arg` の値・jq フィルタ（例: `.items[].name`）・入力 JSON ファイル');
    assert.strictEqual(tokenOf('jq --arg "$@"{a,b} . f', '.').explanation, `${filter}. When \`"$@"{a,b}\` expands to 3 words or more, it is input JSON file`);
    assert.strictEqual(tokenOf('jq --arg n "$@"{a,b} f', 'f').explanation, 'input JSON file');
    const out = runBash('printf 1 > f; printf "xy\\n" > g; x=X; for y in "" p; do jq --arg "$x"{a,b}$y . f; done; set --; jq --arg "$@"{a,b} . f; p="y g"; grep -e x$p f', { files: ['.keep'] }).stdout;
    assert.deepStrictEqual(out.split('\n').filter(Boolean), ['1', '1', '1', 'g:xy']);
  });

  it('reads every count up to the bound of the spec (`wordsBound`)', () => {
    const o = (en: string): OperandSpec => ({ name: en, text: { ja: en, en } });
    // (Two, the most values an option takes, one at least, and the longest pattern; no values without options.)
    const x = { names: ['-x'], text: { ja: '', en: '' }, value: [{ name: 'A' }, { name: 'B' }] };
    assert.strictEqual(wordsBound({ summary: { ja: '', en: '' }, options: [x, { ...x, value: { name: 'A' } }], operands: [{ pattern: [o('a'), o('b')] }] }), 6);
    assert.strictEqual(wordsBound({ summary: { ja: '', en: '' }, options: [{ ...x, value: undefined }] }), 3);
    assert.strictEqual(wordsBound({ summary: { ja: '', en: '' }, operands: [{ pattern: [o('a')] }] }), 3);
  });

  it('gives a command run and a subcommand the role they take when a value before them gives none or several (review of #490)', () => {
    // (`git -C log` changes to `log`; `git -C r x log` runs `git x`, with the argument `log`; `sudo -u tar …` runs nothing.)
    assert.strictEqual(tokenOf('git -C $d log', 'log').explanation, 'Subcommand `git log`: Show commit logs (to the shell it is an argument to `git`, which interprets it itself). When `$d` expands to nothing, it is value for `-C`. When `$d` expands to several words, it is argument');
    assert.strictEqual(tokenOf('git -C $d log', 'log', 'ja').explanation, 'サブコマンド `git log`: コミット履歴を表示する（シェルから見れば `git` への引数で、`git` 自身が解釈する）。`$d` が0語なら `-C` オプションの値。`$d` が2語以上なら引数');
    const tar = allTokens(new Analyzer('en').explainLine(parser.parse('sudo -u $u tar -cf x y'), 0).items).find((t) => t.kind === 'command' && t.label.startsWith('tar'))!;
    assert.strictEqual(tar.explanation, 'runs `tar`: Create or extract tar archives. When `$u` expands to nothing, it is value for `-u`. When `$u` expands to several words, it is argument of the command a word of `$u` names');
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

  it('does not point to a manual for an option of a command word the model cannot read', () => {
    // The command word is an expansion (or a wrapper's word that is one): what reads the option depends on its value, as
    // `-n 5 ls` is `nice`'s when `a` is empty and `echo`'s when `a=echo`, and `$a -x` runs `-x` then.
    const en = 'Looks like an option; which command reads it depends on what the expansion gives';
    const ja = 'オプションに見える語（どのコマンドが読むかは、展開した結果で決まる）';
    for (const [line, word] of [['$cmd -x', '-x'], ['"$@" -x', '-x'], ['$(which x) -y', '-y'], ['f* -x', '-x'], ['x=; $x -Z', '-Z'], ['x=ls; $x -Z', '-Z'], ['nice f* -x', '-x']]) {
      assert.strictEqual(tokenOf(line, word).explanation, en, line);
      assert.strictEqual(tokenOf(line, word, 'ja').explanation, ja, line);
    }
    // (A wrapper's word that may give none: with `$a` empty, the wrapper reads the option itself, `sudo -x`.)
    assert.strictEqual(tokenOf('nice $a -n 5 ls', '-n').explanation, `${en}. When \`$a\` expands to nothing, it is option \`-n\` (niceness adjustment) of \`nice\``);
    assert.strictEqual(tokenOf('nice $a -n 5 ls', '-n', 'ja').explanation, `${ja}。\`$a\` が0語なら \`nice\` のオプション \`-n\`（優先度の調整値）`);
    for (const [line, of] of [['sudo $a -x', 'sudo'], ['sudo $a -x file', 'sudo'], ['env $a -x', 'env'], ['command $a -x', 'command']]) {
      assert.strictEqual(tokenOf(line, '-x').explanation, `${en}. When \`$a\` expands to nothing, it is option \`-x\` (not in the dictionary) of \`${of}\``, line);
      assert.strictEqual(tokenOf(line, '-x', 'ja').explanation, `${ja}。\`$a\` が0語なら \`${of}\` のオプション \`-x\`（辞書に未登録）`, line);
    }
    // Where the model reads the value after a wrapper, the word is the command's own option.
    assert.strictEqual(tokenOf('x=ls; sudo $x -Z', '-Z').explanation, 'print the SELinux security context');
    // Quotes and escapes make a name, not an expansion: `man` is for what they spell.
    for (const line of ['\'a"b\' -x', '\'a\\b\' -x', 'nice \'a"b\' -x']) assert.match(tokenOf(line, '-x').explanation, /^Option \(not in the dictionary; see `man a.b`\)$/, line);
    // A name written out, also as a wrapper's command; a path gives the manual of its last part (`man ./foo` reads a
    // file); a name with a blank has none.
    assert.strictEqual(tokenOf('foo -x', '-x').explanation, 'Option (not in the dictionary; see `man foo`)');
    assert.strictEqual(tokenOf('nice foo -x', '-x').explanation, 'Option (not in the dictionary; see `man foo`)');
    for (const line of ['./foo -x', '~/bin/foo -x', 'nice ./foo -x', '/opt/x/foo -x']) assert.strictEqual(tokenOf(line, '-x').explanation, 'Option (not in the dictionary; see `man foo`)', line);
    assert.strictEqual(tokenOf('/opt/x/foo -x', '-x', 'ja').explanation, 'オプション（辞書に未登録。`man foo` を参照）');
    for (const line of ["'my prog' -x", "nice 'my prog' -x", 'foo/ -x']) assert.strictEqual(tokenOf(line, '-x').explanation, 'Option (not in the dictionary)', line);
    assert.strictEqual(tokenOf("'my prog' -x", '-x', 'ja').explanation, 'オプション（辞書に未登録）');
    // A subcommand's unknown option points to the program's manual.
    assert.strictEqual(tokenOf('git nope --zzz', '--zzz').explanation, 'Option (not in the dictionary; see `man git`)');
  });

  it('reads a command word with a glob as the alias or the function of that name when there is one (bash expands aliases before globs)', () => {
    // bash 5.2: `alias 'l*=echo ALIAS'` with a file `lx`: `l* -Z` prints `ALIAS -Z`; `f*() { echo FUNC "$@"; }` runs when no
    // file matches `f*`, and the first matching file name runs as the command when one does (checked with bash).
    const last = (src: string, label: string, lang: 'en' | 'ja' = 'en'): Token => {
      const t = allTokens(new Analyzer(lang).explainLine(parser.parse(src), src.split('\n').length - 1).items).find((x) => x.label === label);
      assert.ok(t, `no token for ${label} in ${src}`);
      return t;
    };
    const alias = "shopt -s expand_aliases; alias 'l*=ls'\nl* -Z";
    assert.strictEqual(last(alias, 'l*').kind, 'alias');
    assert.match(last(alias, 'l*').explanation, /^The alias `l\*` defined on line 1: replaced by `ls`/);
    assert.strictEqual(last(alias, '-Z').explanation, 'print the SELinux security context');
    const fn = 'f*() { echo FUNC "$@"; }\nf* -x';
    assert.strictEqual(last(fn, 'f*').kind, 'function');
    assert.strictEqual(last(fn, 'f*').explanation, 'Call the function `f*` defined on line 1. But if a file matches the name, the command of the first matching file name runs instead');
    assert.strictEqual(last(fn, 'f*', 'ja').explanation, 'このスクリプトの行 1 で定義された関数 `f*` を呼び出す。ただし、名前に一致するファイルがあれば、その最初のファイル名のコマンドが代わりに実行される');
    // (Not a glob: no such sentence.)
    assert.doesNotMatch(last('f() { :; }\nf -x', 'f').explanation, /matches the name/);
    // The expansion branch is not about variables only: a glob and a substitution are expansions too.
    for (const [line, word] of [['*.sh -x', '*.sh'], ['x[12] -x', 'x[12]'], ['$(which x) -y', '$(which x)'], ['$cmd -x', '$cmd']]) {
      assert.strictEqual(tokenOf(line, word).explanation, 'Run the expanded value as a command', line);
      assert.strictEqual(tokenOf(line, word, 'ja').explanation, '展開した結果をコマンドとして実行する', line);
    }
  });
});
