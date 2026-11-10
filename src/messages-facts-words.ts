import {
  broken, type Catalog, caveat, failure, NO_HEADING, note, pitfall, suggests, withBasis, withConvention, type Words,
} from './messages-entry';
import { type FindRefusalParams, findRefusalRefs, findRefusalText } from './messages-find';
import { type LoopHow, type LoopPattern, unmatchedGlobText } from './messages-glob';
import { codeSpan, shorten } from './label';
import { globsNamed } from './messages-values';
import type { Rewrite } from './rewrite';
import type { ShebangRefusal } from './semantics/state';

// The catalog's facts on pipelines and words (src/wordfacts.ts): what a subshell loses, unquoted expansions, prefix
// assignments, redirections run by the shell, the shebang, and `[[ =~ ]]`. Spread into `MESSAGES` (src/messages.ts).

export const WORD_MESSAGES = {
  // ---------------------------------------------------------------- pipelines and globs (3.2.3, 3.7.3, 3.5.8)
  // (5.2 says that `BASH_SUBSHELL` is "incremented by one within each subshell", and 3.2.3 that each command of a
  // pipeline runs in its own subshell; bash does not count the subshell of a simple command in a pipeline while it
  // expands the command's words (what the command runs, an `eval` string or a function, sees it counted): differs.)
  'bash-subshell-not-counted': withBasis(note(['5.2', '3.2.3'], () => [
    'パイプラインの中の単純コマンドはサブシェルで実行される（最後のコマンドは、`shopt -s lastpipe` が有効でジョブ制御が無効のとき以外）が、bash はこのサブシェルを `$BASH_SUBSHELL` に数えないので、値はパイプラインの外のシェルと同じになる。サブシェルかどうかは `$BASHPID` と `$$` を比べて確かめる',
    'A simple command in a pipeline runs in a subshell (the last one too, unless `shopt -s lastpipe` is on and job control is off), but bash does not count this subshell in `$BASH_SUBSHELL`: the value is that of the shell around the pipeline. To tell whether code runs in a subshell, compare `$BASHPID` with `$$`']),
  { kind: 'differs', probe: 'words#bash-subshell-stage' }),
  'pipeline-subshell-variable': pitfall<{ used: string; fix: Words; partial: boolean }>(['3.2.3', '3.7.3'], ({ used, fix, partial }) => [
    `パイプ（\`|\`）でつないだコマンドはサブシェルで実行されるので、右側で設定した \`${used}\` はパイプラインが終わると消え、あとの \`$${used}\` には届きません。${fix.ja}`
      + (partial ? '（この前で `shopt -s lastpipe` を有効にしているのは一部の経路だけです）' : ''),
    `the commands of a pipeline (\`|\`) run in subshells, so \`${used}\` set on the right side is gone when the pipeline ends; the later \`$${used}\` does not see it. ${fix.en}`
      + (partial ? ' (only some paths before here turn `shopt -s lastpipe` on)' : '')],
    ({ used, partial }) => (partial
      ? [`\`lastpipe\` が有効でない経路では、パイプの右側で設定した \`${used}\` は消える。`, `Where \`lastpipe\` is off, \`${used}\` set on the right side of the pipe is gone when the pipeline ends.`]
      : [`パイプの右側で設定した \`${used}\` は、パイプラインが終わると消える。`, `\`${used}\` set on the right side of the pipe is gone when the pipeline ends.`]), undefined,
  // (`partial`: the other paths keep the variable, as with `extglob-maybe-on`: a caveat.)
  ({ partial }) => (partial ? 'info' : 'error')),
  // (`rewrite`: a test first in the body, where each pass of the loop is over a pattern, and `shopt -s nullglob` where the shell has it.)
  'unmatched-glob-runs-once': withConvention(suggests(caveat<{ glob: string; patterns: readonly LoopPattern[]; v: string; alone: boolean; rewrite: readonly Rewrite[]; how: LoopHow }>(['3.5.8', '3.2.5.1', '3.2.5.2'], ({ glob, patterns, v, alone, rewrite, how }) => unmatchedGlobText(glob, patterns, v, alone, rewrite, how),
    ({ glob, v, how }) => (how.menu
      ? [`\`${glob}\` に一致するファイルがなくても、メニューには項目が出る。`, `When no file matches \`${glob}\`, the menu still shows an entry for it.`]
      : [`\`${glob}\` に一致するファイルがなくても、\`${v}\` がパターンの文字列のままでループが実行される。`, `When no file matches \`${glob}\`, the loop still runs, with \`${v}\` set to the pattern's text.`]))), 'guard-unmatched-glob'),
  // (The shell sets the standard input up, but a command given a file to read reads that instead: jq, sort, cat…)
  'stdin-not-read': note<{ cmd: string; file: string; stdin: Words }>(['3.2.3', '3.6'], ({ cmd, file, stdin }) => [
    `\`${cmd}\` には読むファイル（\`${file}\`）が指定されているので、標準入力（${stdin.ja}）は読まない（\`-\` を指定すると標準入力も読む）`,
    `\`${cmd}\` is given a file to read (\`${file}\`), so it does not read its stdin (${stdin.en}); \`-\` would make it read stdin too`]),

  // ---------------------------------------------------------------- words (3.7.1, 3.5.7, 3.4.2, 3.6; src/wordfacts.ts)
  // (`rewrite`: the command through `sh -c`, src/wordfacts.ts, `throughShell`.)
  // (`apart`: the command acts on this shell, `cd`, or is a function or an alias, which no other shell has: set it first.)
  'prefix-assignment-expanded-first': suggests(broken<{ v: string; name: string; use: string; apart: boolean; rewrite: readonly Rewrite[] }>(['3.7.1', '3.7.4'], ({ v, name, use, apart, rewrite: [sh] }) => [
    `\`${v}=…\` は \`${name}\` の環境にだけ入ります。\`${use}\` は、その前に今のシェルが展開します（今の値で、なければ空）。新しい値を使うなら${apart ? `、先に \`${sh.code}\` のように別に代入します` : ` \`${v}=… ${sh.code}\` のようにシェル経由にします`}`,
    `\`${v}=…\` is set only in the environment of \`${name}\`; the current shell expands \`${use}\` before that (to its present value, or nothing). To use the new value, ${apart ? `assign it first, apart: \`${sh.code}\`` : `go through a shell: \`${v}=… ${sh.code}\``}`],
    ({ v, name, use }) => [`\`${v}=…\` が \`${name}\` に届く前に、今のシェルが \`${use}\` を展開する。`, `The current shell expands \`${use}\` before \`${v}=…\` reaches \`${name}\`.`])),
  // (`rewrite`: the word with only its expansions in quotes, so a glob or a tilde in it still works: `"$DIR"/*`; none
  // when quotes would change it, as in `${x:-*.txt}`.)
  // (`destroys`: the command deletes or overwrites what the word names, `rm`, `mv`, `cp`: a wrong name cannot be undone.)
  // (`known`: the one word the model knows it gives here; then it does no harm as it is, and is a caveat.)
  'unquoted-variable-as-path': withConvention(suggests(pitfall<{ bare: string; rewrite: readonly Rewrite[]; destroys?: boolean; known?: string }>(['3.5.7', '3.5.8'], ({ bare, rewrite: [quoted], destroys, known }) => [
    `\`${bare}\` をクォートしていないので、値に空白や \`*\` があると別々の引数に分かれたり、ファイル名に展開されたりする${destroys ? '。このコマンドは意図しないファイルを削除したり上書きしたりすることになる' : ''}${known !== undefined ? `（ここでの値では1つの引数 \`${known}\` のままだが、値が変わると壊れる）` : ''}${quoted ? `。\`${quoted.code}\` と書く` : ''}`,
    `\`${bare}\` is not quoted, so a value with spaces or \`*\` is split into several arguments or expanded to file names${destroys ? ', and this command then deletes or overwrites files it should not' : ''}${known !== undefined ? ` (with its value here it stays one argument, \`${known}\`, but another value breaks it)` : ''}${quoted ? `. Write \`${quoted.code}\`` : ''}`],
    ({ bare, destroys }) => (destroys
      ? [`クォートしていない \`${bare}\` は値によって分かれたり展開されたりし、意図しないファイルを削除や上書きすることがある。`, `Unquoted \`${bare}\` can split or expand, and this command may then delete or overwrite files it should not.`]
      : [`クォートしていない \`${bare}\` は、値に空白や \`*\` があると分かれたり展開されたりする。`, `Unquoted \`${bare}\` is split or expanded when its value has spaces or \`*\`.`]),
  undefined, ({ destroys, known }) => (destroys && known === undefined ? 'warning' : 'info'))), 'quote-expansions'),
  // (A word a command reads as data, not as a file name: an operand or a value in another language, a pattern, a regex, a
  // program (`grep -E $p f`). `value`: the value the model knows; `glob`, bash matches it against file names (a file
  // whose name matches takes its place; with nullglob the word is gone, with failglob the line fails); `words`, how
  // many words word splitting makes of it, where several. Checked with bash 5.2: test/unquoted-data.test.ts.)
  // (Globbed only, the glob is said as what bash does before the command gets the value, and its parts are named (`globs`): the
  // value is a regex or a script all the same, which the command reads where no file name matches. docs/design/known-values.md, 12.)
  'unquoted-value-as-data': withConvention(suggests(caveat<{ bare: string; value: string; glob: boolean; words?: number; command: string; globs: readonly string[]; rewrite: readonly Rewrite[] }>(['3.5.7', '3.5.8'], ({ bare, value, glob, words, command, globs, rewrite: [quoted] }) => {
    const v = codeSpan(shorten(value, 40));
    const ja = words && glob ? `値は単語分割されて ${words} 個の引数に分かれ、グロブのパターンとしても働く（一致するファイルがあるとその名前に置き換わる）`
      : words ? `値は単語分割されて ${words} 個の引数に分かれる` : `bash は \`${command}\` に渡す前に値をグロブのパターンとしても読み（${globsNamed(globs, true)}）、一致するファイルがあるとその名前に置き換わる`;
    const en = words && glob ? `it is split into ${words} arguments, and is a glob pattern too (a file name that matches takes its place)`
      : words ? `it is split into ${words} arguments` : `bash also reads it as a glob pattern (its ${globsNamed(globs, false)}) before \`${command}\` gets it, and a file name that matches it takes its place`;
    // (Split, it never reaches the command as it is; globbed only, it does where no file matches.)
    return [
      `\`${bare}\` をクォートしていないので、値 ${v} はそのままコマンドに渡${words ? 'らない' : 'るとは限らない'}。${ja}${quoted ? `。値をそのまま渡すには \`${quoted.code}\` と書く` : ''}`,
      `\`${bare}\` is not quoted, so its value ${v} ${words ? 'does' : 'may'} not reach the command as it is: ${en}${quoted ? `. To pass the value as it is, write \`${quoted.code}\`` : ''}`];
  },
  ({ bare, words }) => (words
    ? [`クォートしていない \`${bare}\` の値は、そのままコマンドに渡らない。`, `Unquoted \`${bare}\` does not pass its value as it is.`]
    : [`クォートしていない \`${bare}\` の値は、そのままコマンドに渡るとは限らない。`, `Unquoted \`${bare}\` may not pass its value as it is.`]))), 'quote-expansions'),
  'for-over-ls-output': withConvention(caveat<{ cmd: string }>(['3.5.7'], ({ cmd }) => [
    `\`$(${cmd} …)\` の結果は空白や改行で区切られるので、空白を含むファイル名が壊れます。${cmd === 'ls' ? '`for f in *.txt` のようにグロブを使います' : '`find … -print0 | while IFS= read -r -d \'\' f` や `find -exec` を使います'}`,
    `the output of \`$(${cmd} …)\` is split on spaces and newlines, so file names with spaces break. ${cmd === 'ls' ? 'Use a glob, as in `for f in *.txt`' : "Use `find … -print0 | while IFS= read -r -d '' f` or `find -exec`"}`],
    ({ cmd }) => [`\`$(${cmd} …)\` の出力は空白と改行で分かれるので、空白を含むファイル名が壊れる。`, `The output of \`$(${cmd} …)\` is split on spaces and newlines, so file names with spaces break.`]), 'no-loop-over-command-output'),
  'for-over-unquoted-args': withConvention(suggests(caveat<{ value: string; rewrite: readonly Rewrite[] }>(['3.4.2', '3.5.7'], ({ value, rewrite: [quoted, bare] }) => [
    `\`${value}\` をクォートしないと、空白を含む引数が分かれてしまいます。\`${quoted.code}\`${bare ? `（または \`${bare.code}\` だけ）` : ' '}と書きます`,
    `unquoted \`${value}\` splits arguments that contain spaces. Write \`${quoted.code}\`${bare ? ` (or just \`${bare.code}\`)` : ''}`],
    ({ value }) => [`クォートしていない \`${value}\` は、空白を含む引数を分けてしまう。`, `Unquoted \`${value}\` splits arguments that contain spaces.`])), 'quote-all-arguments'),
  // (`args`: `$@`, which 3.4.2 states: "In contexts where word splitting is not performed, this expands to a single word
  // with each positional parameter separated by a space" (3.4: no word splitting in an assignment). For an array,
  // 6.7 says only that `${a[@]}` "is analogous to the expansion of the special parameters": checked.)
  'array-joined-in-assignment': withConvention(withBasis(suggests(caveat<{ v: string; op: string; word: string; args: boolean; rewrite: readonly Rewrite[] }>(['3.4', '3.4.2', '6.7'], ({ v, op, word, args, rewrite: r }) => [
    `\`${v}${op}${word}\` では${args ? '引数' : '要素'}が空白で区切られて1つの文字列につながり、\`${v}\` はただの文字列になります（空白を含む${args ? '引数' : '要素'}は元に戻せません）。別々に残すには配列にして \`${v}${op}${r[0].code}\` と書${r[1] ? `き、1つの文字列にするつもりなら \`${v}${op}${r[1].code}\` と書きます` : 'きます'}`,
    `\`${v}${op}${word}\` joins the ${args ? 'arguments' : 'elements'} into one string, separated by spaces: \`${v}\` is a plain string, and ${args ? 'arguments' : 'elements'} with spaces cannot be told apart again. To keep them apart, assign an array: \`${v}${op}${r[0].code}\`${r[1] ? `; if one string is meant, write \`${v}${op}${r[1].code}\`` : ''}`],
    ({ v, args }) => (args
      ? [`引数が空白でつながり、\`${v}\` は1つの文字列になる。`, `The arguments are joined by spaces, and \`${v}\` is one string.`]
      : [`要素が空白でつながり、\`${v}\` は1つの文字列になる。`, `The elements are joined by spaces, and \`${v}\` is one string.`]))),
  ({ args }) => (args ? { kind: 'manual', probe: 'state#assign-at' } : { kind: 'checked', probe: 'state#assign-array' })), 'array-for-a-list'),
  // (`zsh`: the shell is zsh, not bash. For bash, 4.1 says that `[ -n ]` (one argument, not null) is true, and that two
  // arguments whose first is no unary operator are false, where bash fails with status 2 (`[ = y ]`): differs.)
  'unquoted-variable-in-test': withConvention(withBasis(suggests(caveat<{ bare: string; zsh?: boolean; rewrite: readonly Rewrite[] }>(['3.5.7', '4.1'], ({ bare, zsh, rewrite: [q] }) => zsh ? [
    `\`[ ]\` の中の \`${bare}\` をクォートしないと、zsh では空白で分かれはしませんが、値が空のときは引数ごと消えるので条件式が壊れます（\`[ -n $x ]\` は空でも真になります）${q ? `。\`${q.code}\` と書きます` : ''}`,
    `unquoted \`${bare}\` inside \`[ ]\` is not split in zsh, but an empty value drops the word, which breaks the test (an empty \`[ -n $x ]\` is true)${q ? `. Write \`${q.code}\`` : ''}`] : [
    `\`[ ]\` の中の \`${bare}\` をクォートしないと、値が空や空白入りのときに条件式が壊れます（\`unary operator expected\` などのエラーや、誤った結果。空の \`[ -n $x ]\` は真になります）${q ? `。\`${q.code}\` と書きます` : ''}`,
    `unquoted \`${bare}\` inside \`[ ]\` breaks the test when the value is empty or has spaces (an error such as "unary operator expected", or a wrong result: an empty \`[ -n $x ]\` is true)${q ? `. Write \`${q.code}\`` : ''}`],
    ({ bare, zsh }) => (zsh
      ? [`クォートしていない \`${bare}\` は、値が空のとき \`[ ]\` の条件式を壊す。`, `Unquoted \`${bare}\` breaks the \`[ ]\` test when it is empty.`]
      : [`クォートしていない \`${bare}\` は、値が空や空白入りのとき \`[ ]\` の条件式を壊す。`, `Unquoted \`${bare}\` breaks the \`[ ]\` test when it is empty or has spaces.`]))),
  ({ zsh }) => (zsh ? undefined : { kind: 'differs', probe: 'state#test-empty-operand' })), 'quote-expansions'),
  // (`set -u` on every path, and no value on every path: src/semantics/unbound.ts, `unboundRead`. `shell`: the
  // messages of bash and dash are quoted, another shell's are not.)
  // (4.3.1: with `-u`, "a non-interactive shell will exit". Where bash fails only the command (`exits: 'command'`, a
  // redirection of a program), and goes on, it differs.)
  'nounset-unbound': withBasis(suggests(pitfall<{
    v: string; name: string; exits: 'script' | 'subshell' | 'shell' | 'command'; shell: 'bash' | 'dash' | 'other'; environment: 'maybe' | 'unlikely' | 'no'; errexit?: 'script' | 'subshell'; rewrite: readonly Rewrite[];
  }>(['4.3.1', '3.5.3'], ({ v, name, exits, shell, environment, errexit, rewrite: [fix] }) => {
    const message = `${v}: ${shell === 'bash' ? 'unbound variable' : 'parameter not set'}`;
    return [
      `ここでは \`${v}\` に値が設定されていない${errexit ? `ので、${errexit === 'script' ? 'スクリプト' : 'これを実行するサブシェル'}が終了する` : ''}。\`set -u\` が有効なので、${shell === 'other' ? '読むとエラーになり' : `${shell} は \`${message}\` のエラーを出し`}、`
        + `${exits === 'script' ? 'スクリプトが終了する' : exits === 'subshell' ? 'これを実行するサブシェルが終了する' : exits === 'shell' ? 'これを実行するシェルが終了する' : `このコマンドは実行されず、終了ステータス 1 で失敗する${errexit ? `。\`set -e\` がこの失敗で${errexit === 'script' ? 'スクリプト' : 'これを実行するサブシェル'}を止める` : ''}`}`
        + `${environment !== 'no' ? `（\`${name}\` が環境変数から来るときを除く）` : ''}。${fix ? `設定されていないことがあるなら \`${fix.code}\` と書く` : 'この前で値を設定しておく'}`,
      `\`${v}\` is not set here${errexit ? `, so ${errexit === 'script' ? 'the script' : 'the subshell running it'} stops` : ''}: with \`set -u\` on, ${shell === 'other' ? 'reading it is an error, and' : `${shell} fails with "${message}" and`} `
        + `${exits === 'script' ? 'the script exits' : exits === 'subshell' ? 'the subshell running it exits' : exits === 'shell' ? 'the shell running it exits' : `the command does not run: it fails with status 1${errexit ? `, and \`set -e\` stops ${errexit === 'script' ? 'the script' : 'the subshell running it'} on that failure` : ''}`}`
        + `${environment !== 'no' ? ` (unless \`${name}\` comes from the environment)` : ''}. ${fix ? `If it may be unset, write \`${fix.code}\`` : 'Set it before this line'}`];
  },
    ({ v, name, environment }) => (environment === 'no'
      ? [`\`${v}\` はここで設定されておらず、\`set -u\` では読むとエラーになる。`, `\`${v}\` is not set here, and with \`set -u\` reading it is an error.`]
      : [`\`${name}\` が環境変数から来なければ、\`set -u\` では \`${v}\` を読むとエラーになる。`, `Unless \`${name}\` comes from the environment, reading \`${v}\` is an error with \`set -u\`.`]), undefined,
  // (Unset on every path, the shell stops or the command fails (`cat < "$f"`) every time: an error. A name that may come
  // from the environment (`fromEnvironment`), only when it lacks it: a stop halfway is a warning, a command that fails a caveat.)
  ({ exits, errexit, environment }) => (environment === 'no' ? 'error' : exits === 'command' && !errexit ? 'info' : 'warning'))),
  ({ exits, shell }) => (exits === 'command' && shell === 'bash' ? { kind: 'differs', probe: 'state#nounset-redirect' } : undefined)),
  // (src/semantics/state.ts, `shebangRefused`.)
  'shebang-refused': broken<ShebangRefusal>(['6.1', '3.8', 'execve(2)'], (r) => [
    `Linux ではシバンのインタープリタの後ろの \`${r.rest}\` 全体が bash への1つの引数になり、bash はそれを受け付けない（${r.why === 'blank' ? '空白はオプションではない'
      : r.why === 'letter' ? `\`-${r.letter}\` というオプションはない` : r.why === 'name' ? '`o` が次の引数のスクリプトのパスをオプション名として読む'
        : r.why === 'shopt' ? '`O` が次の引数のスクリプトのパスを shopt のオプション名として読む' : 'その名前の長いオプションはない'}）。`
      + `直接実行すると、スクリプトは何も実行せずにエラーで終わる。オプションは次の行に \`set\`${r.rest.includes('O') ? '（`-O` は `shopt -s`）' : ''} で書く（\`bash スクリプト\` で実行すると、シバンのオプションは読まれない）`,
    `on Linux the whole \`${r.rest}\` after the interpreter is one argument to bash, which refuses it (${r.why === 'blank' ? 'a blank is not an option'
      : r.why === 'letter' ? `bash has no option \`-${r.letter}\`` : r.why === 'name' ? '`o` takes the next argument, the script\'s path, as an option name'
        : r.why === 'shopt' ? '`O` takes the next argument, the script\'s path, as a shopt option name' : 'no long option has that name'}). `
      + `Run directly, the script stops with an error before running anything. Write the options with \`set\`${r.rest.includes('O') ? ' (`-O` with `shopt -s`)' : ''} on the next line (\`bash script\` ignores the options of the shebang)`],
    ({ rest }) => [`Linux では bash が \`${rest}\` を1つの引数として拒否し、直接実行すると何も実行せずに止まる。`, `On Linux bash refuses \`${rest}\` as one argument: run directly, the script stops before running anything.`]),
  // (find: an action whose command find refuses; the reasons, the messages and the sections of each case: src/messages-find.ts.)
  'find-action-refused': { ...suggests(failure<FindRefusalParams>(['3.2.4', '3.1.2.1', '3.1.2.2'], findRefusalText,
    ({ option }) => [`find はこの \`${option}\` を拒否し、エラーで止まる。`, `find refuses this \`${option}\` and stops with an error.`])), refsOf: findRefusalRefs },
  // (src/wordfacts.ts: a first word `\uFEFF#!…` at the start of the file; `word` without the mark.)
  'shebang-bom': broken<{ word: string; slash: boolean }>(['3.8', 'execve(2)'], ({ word, slash }) => [
    `1行目が見えないバイト順マーク(BOM、U+FEFF)で始まっているので、シバンにならない。カーネルはファイルの先頭2バイトが \`#!\` のときだけインタープリタを起動し、`
      + `bash はこの行を BOM の付いた \`${word}\` という名前のコマンドとして実行して失敗する（${slash ? 'No such file or directory' : 'command not found'}）。BOM を付けずに保存する`,
    `the first line starts with an invisible byte order mark (BOM, U+FEFF), so it is no shebang: the kernel starts an interpreter only when the file's first two bytes are \`#!\`, `
      + `and bash runs this line as a command named \`${word}\` with the BOM before it, which fails (${slash ? '"No such file or directory"' : '"command not found"'}). Save the file without the BOM`],
    () => ['先頭の見えない BOM のせいで、1行目はシバンではなく、失敗するコマンドになる。', 'An invisible BOM makes the first line no shebang but a command that fails.']),
  // (src/wordfacts.ts: `op` is the operator as written; `file` is a static path under a directory only root writes, an
  // error, as it fails every time it runs as meant, not as root; without it, a caveat: only a file of root's fails.)
  'redirect-by-your-shell': pitfall<{ op: string; kind: 'write' | 'append' | 'other' | 'read'; file?: string }>(['3.6', '3.7.3'], ({ op, kind, file }) => {
    const read = kind === 'read';
    const f = (ja: boolean) => file ?? (ja ? 'ファイル' : 'file');
    const sh = (ja: boolean) => `sudo bash -c '… ${op} ${f(ja)}'`;
    return [
      (file ? `\`${file}\` はふつう root しか書き込めない。` : read ? 'ファイルが root しか読めないなら、' : 'ファイルが root しか書き込めないなら、')
        + `リダイレクト（\`${op}\`）は sudo ではなく今のシェルが今のユーザーの権限で開くので、sudo が動く前に「Permission denied」で失敗し、コマンドは実行されない。`
        + (read ? `コマンドにファイルを引数で渡すか、\`${sh(true)}\` のようにリダイレクトも sudo の中で行う`
          : kind === 'write' ? `\`… | sudo tee ${f(true)}\`（追記なら \`sudo tee -a\`）を使う`
            : kind === 'append' ? `\`… | sudo tee -a ${f(true)}\` を使う`
              : `\`${sh(true)}\` のようにリダイレクトも sudo の中で行う`),
      (file ? `\`${file}\` is normally writable only by root: ` : read ? 'if the file is readable only by root, ' : 'if the file is writable only by root, ')
        + `the redirection (\`${op}\`) is opened by your own shell with your rights, before sudo starts, so it fails with "Permission denied" and the command does not run. `
        + (read ? `Pass the file to the command as an argument, or do the redirection inside sudo too: \`${sh(false)}\``
          : kind === 'write' ? `Use \`… | sudo tee ${f(false)}\` (\`sudo tee -a\` to append)`
            : kind === 'append' ? `Use \`… | sudo tee -a ${f(false)}\``
              : `Use \`${sh(false)}\`, so that the redirection is done inside sudo too`)];
  },
    ({ op, file }) => (file
      ? [`\`${file}\` はふつう root しか書き込めないが、\`${op}\` を開くのは sudo ではなく今のシェルなので、失敗する。`, `\`${file}\` is normally writable only by root, and your shell, not sudo, opens \`${op}\`, so it fails.`]
      : [`リダイレクト \`${op}\` を開くのは sudo ではなく今のシェルなので、権限が足りないと失敗する。`, `Your shell, not sudo, opens the redirection \`${op}\`, so it fails without the rights.`]), undefined, ({ file }) => (file ? 'error' : 'info')),

  // ---------------------------------------------------------------- regexes of `[[ =~ ]]` (3.5.9, 3.2.5.2)
  // (`digits`: `\d` or `\D` among them, which no POSIX regex has, even from a variable; `others`: an operator of glibc's
  // regexes among them, `\s`, `\b`…, which a variable keeps. `rewrite`: `[0-9]` in place, or the regex in a variable;
  // none when one is inside a bracket expression, `[\s]`, where a backslash is no operator either way.)
  'regex-backslash-dropped': suggests(broken<{ list: string; digits: boolean; others: boolean; rewrite: readonly Rewrite[] }>(['3.5.9', '3.2.5.2'], ({ list, digits, others, rewrite: [fix] }) => [
    [`\`[[ =~ ]]\` の右辺に書いた ${list} は、クォート除去でバックスラッシュが消えて普通の文字になる（正規表現の演算子にならない）`,
      ...(digits ? [`POSIX の正規表現には \`\\d\` がなく、変数に入れても \`d\` という文字になるので、\`\\d\` は \`[0-9]\`、\`\\D\` は \`[^0-9]\` と書く${!others && fix ? `（\`${fix.code}\`）` : ''}`] : []),
      ...(others ? [fix ? `演算子として使うには変数に入れる（\`${fix.code}\`）か、\`[[:space:]]\` や \`[[:alnum:]_]\` のような書き方にする` : '`[[:space:]]` や `[[:alnum:]_]` のような書き方にする（`[ ]` の中のバックスラッシュは、変数に入れても演算子にならない）'] : [])].join('。'),
    [`In \`[[ =~ ]]\`, an unquoted ${list} loses its backslash to quote removal and is an ordinary character, not a regex operator`,
      ...(digits ? [`POSIX regexes have no \`\\d\`: even from a variable it is the letter \`d\`. Write \`[0-9]\` for \`\\d\` and \`[^0-9]\` for \`\\D\`${!others && fix ? ` (\`${fix.code}\`)` : ''}`] : []),
      ...(others ? [fix ? `Keep the regex in a variable (\`${fix.code}\`) or use \`[[:space:]]\` or \`[[:alnum:]_]\` instead` : 'Use `[[:space:]]` or `[[:alnum:]_]` instead (inside `[ ]`, a backslash is no operator, even from a variable)'] : [])].join('. ')],
    ({ list }) => [`\`[[ =~ ]]\` の右辺の ${list} はバックスラッシュが消え、正規表現の演算子にならない。`, `In \`[[ =~ ]]\`, ${list} loses its backslash and is no regex operator.`], NO_HEADING)),
} satisfies Catalog;
