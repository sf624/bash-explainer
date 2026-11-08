import { lineLabel, type Text } from './i18n';
import { insideLastBracket, tokenText } from './messages-levels';
import { listSaid } from './messages-sentence';

// What the tokens of a command name, and what runs it (src/explain/commands.ts) say.

/** The names of the descriptors in English: `stdout (fd 1)`, `stdout (fd 1) and stderr (fd 2)`. */
const enNames = (names: readonly Text[]): string | undefined =>
  names.length > 1 ? `${names.slice(0, -1).map((x) => x.en).join(', ')} and ${names[names.length - 1].en}` : names[0]?.en;

export const COMMAND_TEXTS = {
  /** `exec >log 2>&1`: no command to run, so the redirections apply to this shell (`names`: the descriptors, `cmd`: the command's text). */
  'cmd-redirect-no-command': tokenText<{ cmd: string; names: readonly Text[] }>(({ cmd, names }) => [
    `コマンドのない \`${cmd}\` のリダイレクト: このシェル自体の${names.length ? names.map((x) => x.ja).join('・') : '入出力'}を切り替える。この後のコマンドもすべて、切り替えた先を使う`,
    `Redirections of \`${cmd}\` with no command: they apply to this shell itself, so ${enNames(names) ? `its ${enNames(names)} ${names.length > 1 ? 'stay' : 'stays'} redirected` : 'they stay'} for every command after it`]),
  /** `sort <in >out`: the shell sets the redirections up before the command starts. */
  'cmd-redirect-around': tokenText<{ cmd: string; names: readonly Text[] }>(({ cmd, names }) => [
    `入出力のリダイレクト: \`${cmd}\` の${names.length ? names.map((x) => x.ja).join('・') + 'を' : '入出力を'}切り替える。シェルがコマンドの起動前に設定するので、コマンド自身にはリダイレクトは見えない`,
    `Redirection applied to \`${cmd}\`${names.length ? `: its ${enNames(names)} ${names.length > 1 ? 'are' : 'is'} redirected` : ''}. The shell sets this up before the command starts, so the command does not see the redirections`]),
  /** `alias s='sudo '; s ll`: the word after an alias whose text ends with a blank is checked for an alias too (`chain`: the alias it runs, if that is an alias too). */
  'cmd-alias-next-word': tokenText<{ line: number; name: string; value: string; chain: string }>(({ line, name, value, chain }) => [
    `${lineLabel('ja', line)} で定義したエイリアス \`${name}\`: \`${value}\` に置き換わる${chain}。前のエイリアスの置き換え先が空白で終わるので、bash はこの単語もエイリアスか調べる`,
    `The alias \`${name}\` defined on ${lineLabel('en', line, 'inline')}: replaced by \`${value}\`${chain}. The text of the alias before it ends with a blank, so bash checks this word for an alias too`]),
  /** `x=1 export x`: an assignment before a builtin that takes the name as its argument (`named`: that builtin, `what`: the assignment's own explanation). */
  'cmd-prefix-assignment-named': tokenText<{ named: string; what: string }>(({ named, what }) => [
    `\`${named}\` がこの名前を受け取るので、この代入はコマンドの後も残り、エクスポートされる: ${what}`,
    `\`${named}\` gets this name, so this assignment stays after the command, exported: ${what}`]),
  /** `x=1 eval :` where POSIX mode may be on: an assignment before a special builtin stays. */
  'cmd-prefix-assignment-posix-maybe': tokenText<{ name: string; what: string }>(({ name, what }) => [
    `\`${name}\` は POSIX の特殊ビルトインなので、ここで POSIX モードなら（この前で有効にしているのは一部の経路だけ）、この代入はコマンドの後も残る: ${what}`,
    `\`${name}\` is a POSIX special builtin, so if POSIX mode is on here (only some paths before here turn it on), this assignment stays after the command: ${what}`]),
  /** `set -o posix; x=1 eval :`: an assignment before a special builtin stays. */
  'cmd-prefix-assignment-posix': tokenText<{ name: string; what: string }>(({ name, what }) => [
    `\`${name}\` は POSIX の特殊ビルトインなので、この代入はコマンドの後も残る（bash の通常モードでは実行中だけ）: ${what}`,
    `\`${name}\` is a POSIX special builtin, so this assignment stays after the command (in bash's normal mode it would last only while the command runs): ${what}`]),
  /** `x=1 $cmd`: the name may expand to no word at all. */
  'cmd-prefix-assignment-env-maybe-alone': tokenText<{ name: string; what: string }>(({ name, what }) => [
    `このコマンドの実行中だけ設定される環境変数（\`${name}\` が何の語にもならなければ、シェルの変数として残る）: ${what}`,
    `Environment variable set only for this command (if \`${name}\` expands to no word at all, it stays as a shell variable): ${what}`]),
  /** `x=1 $cmd $arg`: the name and the words after it may expand to no word at all. */
  'cmd-prefix-assignment-env-maybe': tokenText<{ name: string; what: string }>(({ name, what }) => [
    `このコマンドの実行中だけ設定される環境変数（\`${name}\` もその後の語も何の語にもならなければ、シェルの変数として残る）: ${what}`,
    `Environment variable set only for this command (if \`${name}\` and the words after it expand to no word at all, it stays as a shell variable): ${what}`]),
  /** `LC_ALL=C sort`: an assignment before the name lasts as long as the command. */
  'cmd-prefix-assignment-env': tokenText<{ what: string }>(({ what }) => [
    `このコマンドの実行中だけ設定される環境変数: ${what}`,
    `Environment variable set only for this command: ${what}`]),
  /** `[ -n x ]` where `[` is the builtin: the name's token. */
  'cmd-bracket-builtin-name': tokenText(() => [
    'コマンド `[`（`test` の別名）',
    'Command `[` (another name for `test`)']),
  /** `[ -n x ]` where `[` is a program (`command -p [ -n x ]`). */
  'cmd-bracket-program-name': tokenText(() => [
    'プログラム `[`（`test` と同じ）',
    'The program `[` (the same as `test`)']),
  /** `{echo,hi}`: brace expansion gives the command (`word`: as written, `expanded`: the words it gives, `command`: the first, `off`: a caveat on the braces, `what`: the command's own explanation). */
  'cmd-brace-expansion-command': tokenText<{ word: string; expanded: string; command: string; off: string; what: string }>(({ word, expanded, command, off, what }) => [
    `ブレース展開で \`${word}\` は \`${expanded}\` になるので、コマンド \`${command}\` を実行する（\`{ }\` のグループではない）${off}。${what}`,
    `Brace expansion turns \`${word}\` into \`${expanded}\`, so this runs the command \`${command}\` (it is not a \`{ }\` group)${off}. ${what}`]),
  /** `e\c'h'"o" hi`: the name is the command it spells once the quotes are removed. */
  'cmd-name-unquoted': tokenText<{ word: string; spelled: string; what: string }>(({ word, spelled, what }) => [
    `コマンド名 \`${word}\` は、クォートやバックスラッシュ、空の \`$(…)\` を取り除くと \`${spelled}\` になる。${what}`,
    `The command name \`${word}\` becomes \`${spelled}\` once the quotes, backslashes and empty \`$(…)\` are removed. ${what}`]),
  /** `hash -p /opt/bin/x x; x`: the command may run a path `hash -p` gave (`what`: the explanation, `clause`: what may run instead); the clause goes in the explanation's last bracket. */
  'cmd-hashed-clause': tokenText<{ what: string; clause: string }>(({ what, clause }) => [
    insideLastBracket(what, '）', `。${clause}`) ?? `${what}（${clause}）`,
    insideLastBracket(what, ')', `; ${clause}`) ?? `${what} (${clause})`]),
  /** `$cmd args`, `f*`: a name that expands to the command. */
  'cmd-run-expanded': tokenText(() => [
    '展開した結果をコマンドとして実行する',
    'Run the expanded value as a command']),
  /** `alias ll='ls -l'; ll`: the alias surely runs (`sure`: the bracket on the alias it runs, or on `hash -p`, or empty). */
  'cmd-alias-defined-script': tokenText<{ line: number; name: string; value: string; sure: string }>(({ line, name, value, sure }) => [
    `このスクリプトの${lineLabel('ja', line)} で定義したエイリアス \`${name}\`: \`${value}\` に置き換わる${sure}`,
    `The alias \`${name}\` defined on ${lineLabel('en', line, 'inline')}: replaced by \`${value}\`${sure}`]),
  /** A file with no shebang, `alias ll='ls -l'; ll`: aliases are expanded only when an interactive shell reads it. */
  'cmd-alias-defined-file': tokenText<{ line: number; name: string; value: string; chain: string }>(({ line, name, value, chain }) => [
    `このファイルの${lineLabel('ja', line)} で定義したエイリアス \`${name}\`: \`${value}\` に置き換わる${chain}。ただし、それは対話シェルがこのファイルを読むとき（\`.bashrc\` や、端末で打つ \`source\`）か、\`shopt -s expand_aliases\` の後だけ。スクリプトとして実行すると、bash はエイリアスを展開しない`,
    `The alias \`${name}\` defined on ${lineLabel('en', line, 'inline')}: replaced by \`${value}\`${chain}, but only when an interactive shell reads this file (\`.bashrc\`, or \`source\` typed in a terminal), or after \`shopt -s expand_aliases\`. Run as a script, bash does not expand aliases`]),
  /** `if c; then shopt -s expand_aliases; fi; ll`: only some paths turn the expansion of aliases on. */
  'cmd-alias-defined-expand-partial': tokenText<{ line: number; name: string; value: string; chain: string }>(({ line, name, value, chain }) => [
    `このスクリプトの${lineLabel('ja', line)} で定義したエイリアス \`${name}\`: \`${value}\` に置き換わる${chain}。ただし、それは \`shopt -s expand_aliases\` が効いているときだけで、この前で有効にしているのは一部の経路（分岐やループ）だけ`,
    `The alias \`${name}\` defined on ${lineLabel('en', line, 'inline')}: replaced by \`${value}\`${chain}, but only when \`shopt -s expand_aliases\` is on, and only some paths before here (a branch or a loop) turn it on`]),
  /** `if c; then alias ll='ls -l'; fi; ll`: only some paths define the alias. */
  'cmd-alias-defined-partial': tokenText<{ line: number; name: string; value: string; chain: string }>(({ line, name, value, chain }) => [
    `このスクリプトの${lineLabel('ja', line)} で定義したエイリアス \`${name}\`: \`${value}\` に置き換わる${chain}。ただし、それは定義する行を通ったときだけ（この前で定義しているのは一部の経路だけ）`,
    `The alias \`${name}\` defined on ${lineLabel('en', line, 'inline')}: replaced by \`${value}\`${chain}, but only when its definition has run (only some paths before here define it)`]),
  /** `alias ll='ls -l'; shopt -u expand_aliases; ll`: the expansion of aliases is off (`unless`: the clause on code not read). */
  'cmd-alias-expansion-off': tokenText<{ line: number; name: string; value: string; unless: string }>(({ line, name, value, unless }) => [
    `このスクリプトの${lineLabel('ja', line)} で定義したエイリアス \`${name}\`（\`${value}\`）。ただし、ここでは \`shopt -u expand_aliases\` でエイリアスの展開が無効なので、対話シェルでも「command not found」になる${unless}`,
    `The alias \`${name}\` defined on ${lineLabel('en', line, 'inline')} (\`${value}\`). But alias expansion is off here (\`shopt -u expand_aliases\`), so this is "command not found", also in an interactive shell${unless}`]),
  /** `alias ll='ls -l'; ll` in a script of bash: aliases are not expanded without `expand_aliases`. */
  'cmd-alias-not-expanded-in-script': tokenText<{ line: number; name: string; value: string; unless: string }>(({ line, name, value, unless }) => [
    `このスクリプトの${lineLabel('ja', line)} で定義したエイリアス \`${name}\`（\`${value}\`）。ただし bash はスクリプトの中でエイリアスを展開しない（\`shopt -s expand_aliases\` がない）ので、実際には「command not found」になる${unless}。sh や dash なら \`${value}\` に置き換わる`,
    `The alias \`${name}\` defined on ${lineLabel('en', line, 'inline')} (\`${value}\`). But bash does not expand aliases in a script (no \`shopt -s expand_aliases\`), so this is "command not found"${unless}. With sh or dash it would be replaced by \`${value}\``]),
  /** `ll; alias ll='ls -l'`: the alias is defined after the command, so the program runs. */
  'cmd-alias-defined-later': tokenText<{ name: string; line: number }>(({ name, line }) => [
    `コマンド \`${name}\` を実行する（${lineLabel('ja', line)} のエイリアスはここではまだ効かない）`,
    `Run the command \`${name}\` (the alias of ${lineLabel('en', line, 'inline')} is not in effect here)`]),
  /** `source lib.sh; mytool`: a name the dictionary does not know may be a function of the file read. */
  'cmd-maybe-sourced-function': tokenText<{ name: string; line: number }>(({ name, line }) => [
    `\`${name}\` を実行する。${lineLabel('ja', line)} で読み込んだファイルの関数かもしれない（そうでなければ外部コマンド）`,
    `Run \`${name}\`: maybe a function of the file read on ${lineLabel('en', line, 'inline')}, else an external command`]),
  /** A name that every path runs from a path of `hash -p`, but not the same one (`why`: the clause on the paths). */
  'cmd-external-hashed-maybe': tokenText<{ why: string }>(({ why }) => [
    `外部コマンドを実行する（${why}）`,
    `Run an external command (${why})`]),
  /** `enable -n echo; echo hi`, `hash -p /opt/bin/x x; x`: the program of the name (`runs`: what runs, `why`: why, `summary`: the program's summary, if the dictionary has it). */
  'cmd-off-builtin-or-hashed': tokenText<{ runs: string; why: string; summary?: string }>(({ runs, why, summary }) => [
    `${runs}（${why}）${summary !== undefined ? `: ${summary}` : ''}`,
    `${runs} (${why})${summary !== undefined ? `: ${summary}` : ''}`]),
  /** A command of the customCommands setting: what follows its summary. */
  'cmd-custom-setting': tokenText(() => [
    '（設定 customCommands で定義）',
    ' (from the customCommands setting)']),
  /** `[ -n x ]`: the builtin `[` (`zsh`: the shell is zsh, which splits and globs no unquoted variable). */
  'cmd-bracket-builtin': tokenText<{ zsh: boolean }>(({ zsh }) => [
    `コマンド \`[\`（\`test\` の別名）: 引数の条件を評価し、真なら成功(0)を返す。シェルの構文ではなく普通のコマンドなので、\`]\` は最後の引数にすぎず（\`[\` が動くときに確かめる）、${zsh ? '中の引数はほかのコマンドの引数と同じく展開される（クォートしない変数は、空なら引数ごと消える。`[[ ]]` なら消えない）' : '中の引数には単語分割とグロブ展開がかかる（`[[ ]]` ならかからない）'}`,
    `Command \`[\` (another name for \`test\`): evaluates the condition in its arguments and succeeds (0) if it is true. It is an ordinary command, not shell syntax: \`]\` is only its last argument, checked when \`[\` runs, and ${zsh ? 'the arguments inside are expanded as any command\'s are (an unquoted variable that is empty is dropped; `[[ ]]` keeps it)' : 'the arguments inside undergo word splitting and globbing (`[[ ]]` does not)'}`]),
  /** `ll` in a README: a distribution's alias or function (`what`: `エイリアス` or `関数` in the line's language, `alias`: whether it is an alias, `meaning`: what it does, `defs`: the definitions). */
  'cmd-distro-alias': tokenText<{ what: string; alias: boolean; name: string; meaning: string; defs: string }>(({ what, alias, name, meaning, defs }) => [
    `${what} \`${name}\`: ${meaning}（${defs}）`,
    `${alias ? 'Alias' : 'Function'} \`${name}\`: ${meaning} (${defs})`]),
  /** Docker's exec form, `["/bin/ls", "-l"]`: the path is run as it is. */
  'cmd-path-no-shell': tokenText<{ name: string }>(({ name }) => [
    `パス \`${name}\` にあるプログラム・スクリプトを、シェルを通さずにそのまま実行する`,
    `Run the program or script at \`${name}\` as it is, with no shell`]),
  /** `./run.sh`, `/usr/bin/x`: a name with a slash is a path. */
  'cmd-path': tokenText<{ name: string }>(({ name }) => [
    `パス \`${name}\` にあるプログラム・スクリプトを実行する`,
    `Run the program or script at \`${name}\``]),
  /** `mytool --help`: a name the dictionary does not know. */
  'cmd-external-unknown': tokenText<{ name: string }>(({ name }) => [
    `外部コマンド \`${name}\` を実行する（辞書に未登録。\`man ${name}\` や \`${name} --help\` を参照）`,
    `Run the external command \`${name}\` (not in the dictionary; see \`man ${name}\`)`]),
  /**
   * `source` in a sh script, `setopt` in bash: a builtin the script's shell is not counted on to have (`builtinShells`), so it is looked up in PATH.
   * `shell`: the script's shell; `lacks`, in `sh`, the common ones that have no such builtin; `has`, the shells that have it; `summary`: what the builtin does there.
   */
  'cmd-builtin-not-in-shell': tokenText<{ shell: string; lacks?: readonly string[]; has: readonly string[]; summary: string }>(({ shell, lacks, has, summary }) => [
    `${shell} のビルトインではない${lacks ? `（${listSaid('ja', lacks)} にはない）` : ''}ので、PATH から探すが、この名前のプログラムはふつうない。${listSaid('ja', has)} のビルトインとしては: ${summary}`,
    `Not a builtin of ${shell}${lacks ? ` (${listSaid('en', lacks)} ${lacks.length > 1 ? 'have' : 'has'} none)` : ''}, so it is looked up in PATH, where there is usually no program of this name. As a builtin of ${listSaid('en', has)}: ${summary}`]),
  /** Docker's exec form, `["cd", "/tmp"]`: a builtin's name is looked up in PATH (`summary`: what the builtin does). */
  'cmd-no-shell-builtin': tokenText<{ name: string; summary: string }>(({ name, summary }) => [
    `シェルのビルトイン \`${name}\`（${summary}）。この単語を読むシェルはないので、PATH からプログラムとして探すが、この名前のプログラムはふつうなく、コマンドが見つからずに失敗する`,
    `The shell's builtin \`${name}\` (${summary}). No shell reads these words, so it is looked up in PATH as a program, and there is usually none of this name: the command is not found`]),
  /** Docker's exec form, `["if", "x"]`: a reserved word is looked up in PATH. */
  'cmd-no-shell-keyword': tokenText<{ name: string }>(({ name }) => [
    `\`${name}\` はシェルの予約語で、コマンドではない。この単語を読むシェルはないので、PATH からプログラムとして探すが、この名前のプログラムはなく、コマンドが見つからずに失敗する`,
    `\`${name}\` is a reserved word of the shell, not a command. No shell reads these words, so it is looked up in PATH as a program, and there is none of this name: the command is not found`]),
  /** `set -o posix; time`: `time` alone, in POSIX mode. */
  'cmd-time-alone-posix': tokenText(() => [
    'パイプラインのない `time`: POSIX モードなので、このシェルと終了した子プロセスがここまでに使ったユーザー時間とシステム時間を表示する',
    '`time` with no pipeline: in POSIX mode, it prints the user and system time this shell and its finished children have used so far']),
  /** `time`: alone. */
  'cmd-time-alone': tokenText(() => [
    'パイプラインのない `time`: 何も計測せず、0 の時間を表示する（POSIX モードなら、シェルがここまでに使った時間）',
    '`time` with no pipeline: it times nothing, and prints zero times (in POSIX mode, the times the shell has used so far)']),
  /** `time >o`: the word, on its own row: the row of the whole says what it does here. */
  'cmd-time-word': tokenText(() => ['予約語 `time`', 'The reserved word `time`']),
  /** `set -o posix; time -p ls`: the program `time`, not the reserved word. */
  'cmd-time-program': tokenText(() => [
    'POSIX モードの bash は、`-` で始まる語が続く `time` を予約語として読まない: これはプログラムの `time`（ふつうは `/usr/bin/time`）を実行するコマンドで、関数や組み込みコマンドは実行できない（`cannot run`）',
    'In POSIX mode bash does not read `time` before a word that starts with `-` as the reserved word: this runs the program `time` (usually `/usr/bin/time`), which cannot run a function or a builtin (`cannot run`)']),
  /** `set -o posix; time -p`: the program `time` with no command to run (said after a separator). */
  'cmd-time-program-no-command': tokenText(() => [
    '実行するコマンドがないので失敗する（GNU の `time` は `missing program to run`、終了ステータス 125）',
    'With no command to run, it fails (GNU `time`: `missing program to run`, status 125)']),
  /** `time -- ls`: bash reads `--` after the reserved word, and the next word is the command, even if it starts with a dash. */
  'cmd-time-end-of-options': tokenText(() => [
    '`time` のオプションはここまで',
    'the end of the options of `time`']),
  /** `time -p ls`: the option `-p`. */
  'cmd-time-posix-format': tokenText(() => [
    'POSIX 形式で時間を表示する',
    'print the times in the POSIX format']),
};
