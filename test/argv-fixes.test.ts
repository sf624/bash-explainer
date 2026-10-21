// The lines where the analyzer's old argument walk read a word wrongly, found by comparing it with the
// argument interpreter (src/argv/interpret.ts) before the walk was replaced by it. Each row says what the
// word is now; the comment says how the real tool reads it.
import * as assert from 'assert';
import { Analyzer, Kind, Token } from '../src/analyzer';
import { createUnbashParser } from '../src/syntax/adapters/unbash';

const parser = createUnbashParser();
const all = (ts: Token[]): Token[] => ts.flatMap((t) => [t, ...all(t.children)]);
/** The outermost token of the last occurrence of `word` in `line`. */
function tokenOf(line: string, word: string): Token {
  const col = line.lastIndexOf(word);
  const t = all(new Analyzer('en').explainLine(parser.parse(line), 0).items).find((x) => x.span.start.character === col && x.label === word);
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
  // (`ssh -G localhost ls -l` still shows the user of the login, so `-l` is not ssh's).
  ['ssh host ls -la', '-la', 'argument', 'remote command'],
  ['ssh host ls -l', '-l', 'argument', 'remote command'],
  ['ssh -p 22 host -t ls -l', '-l', 'argument', 'remote command'],
  ['ssh and su -c: the remote shell', '-c:', 'argument', 'remote command'],
  ['ssh and su -c: the remote shell', 'the', 'argument', 'remote command'],
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
  });

  it('gives the roles for one word and for more when the count is not known', () => {
    assert.strictEqual(tokenOf('cp *.txt dir', 'dir').explanation, 'destination (the new name, or an existing directory) when `*.txt` expands to a single word; destination directory when it expands to more');
    assert.strictEqual(tokenOf('cp "$@"', '"$@"').explanation, 'source when `"$@"` expands to a single word; when it expands to more, they are source, then destination directory');
    // (A brace expansion of globs gives at least one word each.)
    assert.strictEqual(tokenOf('cp {a,b}*.txt dir', 'dir').explanation, 'destination directory');
  });
});
