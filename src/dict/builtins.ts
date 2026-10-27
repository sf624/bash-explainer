import { Text, tx } from '../i18n';
import type { BuiltinCall, CommandSlot, CommandSpec, NameOptions, OperandSpec, OptionSpec, PatternOption, ValueSpec, ValueType, VariableSet } from '../argv/spec';
import { args, cmd, operand, optionOf, OptSpec, runs, wordTable } from './types';
import { declarationCommands, declarationFlags, declarationOffFlags, exportFlags, readonlyFlags } from './syntax';

export const shellOptions = {
  errexit: tx('コマンドが失敗したら即座にスクリプトを終了する（`-e` と同じ。ただし、`if`・`while`・`until` の条件、`&&`・`||` の最後以外のコマンド、`pipefail` なしならパイプラインの最後以外のコマンド、`!` を付けたコマンド、およびそこから呼んだ関数の中では終了しない）', 'exit immediately when a command fails (same as `-e`; but not in the condition of `if`, `while` or `until`, in a `&&` or `||` list except its last command, in a pipeline except its last command (unless `pipefail` is on), after `!`, or in a function called from those places)'),
  nounset: tx('未定義の変数を参照したらエラー（`-u` と同じ）', 'error on unset variables (same as `-u`)'),
  pipefail: tx('パイプライン中のどれかが失敗したら、パイプライン全体を失敗扱いにする', 'a pipeline fails if any command in it fails'),
  xtrace: tx('実行するコマンドを表示する（`-x` と同じ）', 'print commands as they run (same as `-x`)'),
  noclobber: tx('`>` で既存ファイルを上書きしない（`-C` と同じ）', 'do not overwrite files with `>` (same as `-C`)'),
  noglob: tx('グロブ（ワイルドカード展開）を無効化（`-f` と同じ）', 'disable globbing (same as `-f`)'),
  vi: tx('行編集を vi モードにする', 'use vi-style line editing'),
  emacs: tx('行編集を emacs モードにする', 'use emacs-style line editing'),
  posix: tx('POSIX 互換モードにする', 'POSIX compatibility mode'),
  allexport: tx('代入した変数を自動でエクスポートする（`-a` と同じ）', 'export every variable that is set (same as `-a`)'),
  errtrace: tx('`ERR` トラップを関数やサブシェルの中でも効かせる（`-E` と同じ）', 'make the `ERR` trap work in functions and subshells too (same as `-E`)'),
  functrace: tx('`DEBUG` と `RETURN` のトラップを関数の中でも効かせる（`-T` と同じ）', 'make the `DEBUG` and `RETURN` traps work in functions too (same as `-T`)'),
  noexec: tx('コマンドを読むだけで実行しない（`-n` と同じ）', 'read commands but do not run them (same as `-n`)'),
  verbose: tx('読み込んだ行をそのまま表示する（`-v` と同じ）', 'print input lines as they are read (same as `-v`)'),
  monitor: tx('ジョブ制御を有効にする（`-m` と同じ）', 'turn on job control (same as `-m`)'),
  ignoreeof: tx('Ctrl-D（EOF）ではシェルを終了しない', 'do not exit the shell on end-of-file (Ctrl-D)'),
  history: tx('コマンド履歴を有効にする', 'turn on command history'),
  histexpand: tx('`!!` や `!$` の履歴展開を有効にする（`-H` と同じ）', 'turn on `!!` and `!$` history expansion (same as `-H`)'),
  physical: tx('`cd` でシンボリックリンクをたどらず物理パスで移動する（`-P` と同じ）', 'do not follow symlinks in `cd` (same as `-P`)'),
  privileged: tx('特権モード（`$ENV` を読まず、環境の関数を取り込まない。`-p` と同じ）', 'privileged mode (reads no `$ENV`, imports no functions; same as `-p`)'),
  braceexpand: tx('波括弧展開 `{a,b}` を有効にする（既定。`-B` と同じ）', 'turn on brace expansion `{a,b}` (the default; same as `-B`)'),
  notify: tx('バックグラウンドジョブの終了をすぐに知らせる（`-b` と同じ）', 'report the end of background jobs at once (same as `-b`)'),
  hashall: tx('実行したコマンドのパスを記憶する（既定。`-h` と同じ）', 'remember the path of the commands run (the default; same as `-h`)'),
  onecmd: tx('1つコマンドを読んで実行したら終了する（`-t` と同じ）', 'exit after reading and running one command (same as `-t`)'),
  keyword: tx('コマンド名の前だけでなく、どこにある `name=value` も環境変数として渡す（`-k` と同じ）', 'put every `name=value` in the words into the command\'s environment, not only those before its name (same as `-k`)'),
  'interactive-comments': tx('対話シェルでも `#` 以降をコメントとして扱う', 'treat `#` as a comment in an interactive shell too'),
  nolog: tx('何もしない（bash は受け付けるが無視する）', 'ignored (bash accepts it and does nothing)'),
};

/** `set +e`, `set +o errexit`: what turning errexit off does. */
const ERREXIT_OFF = tx('コマンドが失敗しても終了しないようにする（既定）', 'go on when a command fails (the default)');

/** Options of bash's `shopt`. */
export const shoptOptions = {
  globstar: tx('`**` が任意の深さのディレクトリに一致する（`**/*.sh` でサブディレクトリの中まで）', '`**` matches directories at any depth (`**/*.sh` reaches into subdirectories)'),
  nullglob: tx('何にも一致しないグロブを、そのままの文字列ではなく空にする', 'a glob that matches nothing expands to nothing instead of itself'),
  failglob: tx('何にも一致しないグロブをエラーにする', 'a glob that matches nothing is an error'),
  dotglob: tx('`*` などが `.` で始まる名前にも一致する', '`*` and the like also match names starting with `.`'),
  extglob: tx('拡張グロブ `@(…)`、`!(…)`、`+(…)` などを使えるようにする', 'enable extended globs such as `@(…)`, `!(…)` and `+(…)`'),
  nocaseglob: tx('グロブで大文字と小文字を区別しない', 'globs ignore case'),
  nocasematch: tx('`[[ == ]]` や `case` のパターンで大文字と小文字を区別しない', '`[[ == ]]` and `case` patterns ignore case'),
  inherit_errexit: tx('`$(…)` の中でも `set -e` を効かせる', 'keep `set -e` inside `$(…)`'),
  lastpipe: tx('パイプラインの最後のコマンドを今のシェルで実行する（`… | read x` の `x` が残る）', 'run the last command of a pipeline in the current shell (so `… | read x` keeps `x`)'),
  expand_aliases: tx('スクリプトの中でもエイリアスを展開する', 'expand aliases in scripts too'),
  // (The others of the manual, 4.3.2.)
  assoc_expand_once: tx('連想配列の添字を一度だけ展開する（算術式の中と、配列の要素を代入・参照する組み込みで）', 'expand the subscripts of associative arrays only once (in arithmetic, and in the builtins that assign or read array elements)'),
  autocd: tx('ディレクトリの名前をコマンドとして入力すると、`cd` の引数として扱ってそこへ移動する（対話シェルだけ）', 'a command name that is a directory is run as `cd` to it (interactive shells only)'),
  cdable_vars: tx('`cd` の引数がディレクトリでなければ、その名前の変数の値を移動先にする', 'an argument of `cd` that is not a directory is the name of a variable whose value is the directory'),
  cdspell: tx('`cd` のディレクトリ名の小さな綴り間違い（2文字の入れ替わり、1文字の抜けや余分）を直して移動する（対話シェルだけ）', 'correct small spelling errors in the directory names given to `cd` (two letters swapped, one missing or one too many; interactive shells only)'),
  checkhash: tx('ハッシュ表で覚えたコマンドがまだあるかを実行前に確かめ、なければ PATH から探し直す', 'check that a command remembered in the hash table still exists before running it, and search PATH again if not'),
  checkjobs: tx('対話シェルの終了時に、停止中と実行中のジョブを表示する（実行中のジョブがあれば、もう一度 `exit` するまで終了しない）', 'list the stopped and running jobs when an interactive shell exits (with running jobs, it exits only at a second `exit`)'),
  checkwinsize: tx('外部コマンドを実行するたびにウィンドウの大きさを調べ、`LINES` と `COLUMNS` を更新する（既定で有効）', 'check the window size after each external command, and update `LINES` and `COLUMNS` (on by default)'),
  cmdhist: tx('複数行のコマンドを履歴の1つの項目に保存する（既定で有効。履歴が有効なときだけ効く）', 'save all lines of a multi-line command in one history entry (on by default; only with history on)'),
  compat31: tx('bash 3.1 の動作に合わせる互換モード（変わる点はマニュアルの Shell Compatibility Mode にある）', 'compatibility mode: behave as bash 3.1 did where it differs (the manual lists how under Shell Compatibility Mode)'),
  compat32: tx('bash 3.2 の動作に合わせる互換モード（変わる点はマニュアルの Shell Compatibility Mode にある）', 'compatibility mode: behave as bash 3.2 did where it differs (the manual lists how under Shell Compatibility Mode)'),
  compat40: tx('bash 4.0 の動作に合わせる互換モード（変わる点はマニュアルの Shell Compatibility Mode にある）', 'compatibility mode: behave as bash 4.0 did where it differs (the manual lists how under Shell Compatibility Mode)'),
  compat41: tx('bash 4.1 の動作に合わせる互換モード（変わる点はマニュアルの Shell Compatibility Mode にある）', 'compatibility mode: behave as bash 4.1 did where it differs (the manual lists how under Shell Compatibility Mode)'),
  compat42: tx('bash 4.2 の動作に合わせる互換モード（変わる点はマニュアルの Shell Compatibility Mode にある）', 'compatibility mode: behave as bash 4.2 did where it differs (the manual lists how under Shell Compatibility Mode)'),
  compat43: tx('bash 4.3 の動作に合わせる互換モード（変わる点はマニュアルの Shell Compatibility Mode にある）', 'compatibility mode: behave as bash 4.3 did where it differs (the manual lists how under Shell Compatibility Mode)'),
  compat44: tx('bash 4.4 の動作に合わせる互換モード（変わる点はマニュアルの Shell Compatibility Mode にある）', 'compatibility mode: behave as bash 4.4 did where it differs (the manual lists how under Shell Compatibility Mode)'),
  complete_fullquote: tx('補完したファイル名の中のシェルのメタ文字をすべてクォートする（既定で有効）', 'quote all shell metacharacters in file names when completing (on by default)'),
  direxpand: tx('ファイル名の補完で、ディレクトリ名を展開した結果に置き換える', 'replace directory names with the result of their expansion when completing file names'),
  dirspell: tx('単語の補完で、ディレクトリ名がなければ綴りを直そうとする', 'try to correct the spelling of a directory name that does not exist when completing a word'),
  execfail: tx('`exec` がファイルを実行できなくても、非対話シェルを終了しない', 'a non-interactive shell does not exit when `exec` cannot run its file'),
  extdebug: tx('デバッガ向けの動作を有効にする（`declare -F` が関数の定義のファイルと行を表示する、`DEBUG` トラップの終了ステータスで次のコマンドを飛ばせる、など）', 'turn on the behaviour meant for debuggers (`declare -F` prints the file and line of each function, the status of the `DEBUG` trap can skip the next command, and more)'),
  extquote: tx('ダブルクォートの中の `${…}` でも `$\'…\'` と `$"…"` のクォートを行う（既定で有効）', 'perform `$\'…\'` and `$"…"` quoting inside `${…}` within double quotes (on by default)'),
  force_fignore: tx('`FIGNORE` の接尾辞で終わる語を、ほかに候補がなくても補完で無視する（既定で有効）', 'ignore the words with the suffixes in `FIGNORE` when completing, even when they are the only candidates (on by default)'),
  globasciiranges: tx('パターンの角括弧の範囲（`[a-z]` など）を、ロケールの照合順ではなく C ロケールの順で比べる（既定で有効）', 'compare the ranges of bracket expressions in patterns (`[a-z]`) in the order of the C locale, not the collation of the locale (on by default)'),
  globskipdots: tx('ファイル名展開が、`.` で始まるパターンでも `.` と `..` には一致しない（既定で有効）', 'filename expansion never matches `.` and `..`, even with a pattern that starts with `.` (on by default)'),
  gnu_errfmt: tx('シェルのエラーメッセージを GNU の標準の形式で出力する', 'write the error messages of the shell in the standard GNU format'),
  histappend: tx('シェルの終了時に、履歴を `HISTFILE` のファイルに上書きせず追記する', 'append the history to the file `HISTFILE` names when the shell exits, instead of overwriting it'),
  histreedit: tx('履歴展開に失敗した行を Readline でもう一度編集できるようにする', 'with Readline, let the user edit a failed history substitution again'),
  histverify: tx('履歴展開の結果をすぐに実行せず、Readline の編集行に読み込む', 'with Readline, load the result of a history substitution into the editing line instead of running it at once'),
  hostcomplete: tx('`@` を含む語の補完でホスト名を補完する（Readline。既定で有効）', 'complete host names in a word that contains `@` (with Readline; on by default)'),
  huponexit: tx('対話的なログインシェルの終了時に、すべてのジョブに `SIGHUP` を送る', 'send `SIGHUP` to all jobs when an interactive login shell exits'),
  interactive_comments: tx('対話シェルでも、`#` で始まる語から行末までをコメントとして無視する（既定で有効）', 'in an interactive shell too, a word that starts with `#` and the rest of the line are a comment (on by default)'),
  lithist: tx('`cmdhist` が有効なとき、複数行のコマンドを `;` でつながず、改行のまま履歴に保存する', 'with `cmdhist` on, save multi-line commands in the history with their newlines instead of `;`'),
  localvar_inherit: tx('関数のローカル変数が、値を代入されるまで、外側の同じ名前の変数の値と属性を受け継ぐ（nameref の属性は受け継がない）', 'a local variable takes the value and attributes of the variable of the same name in an outer scope until it is assigned (not the nameref attribute)'),
  localvar_unset: tx('呼び出し元の関数のローカル変数を `unset` すると、その関数が戻るまで未設定に見える（今の関数のローカル変数と同じ）', '`unset` of a local variable of a calling function makes it look unset until that function returns, as for one of the current function'),
  login_shell: tx('ログインシェルとして起動したときにシェルが設定する（変えられない）', 'set by the shell when it starts as a login shell (it cannot be changed)'),
  mailwarn: tx('メールを確かめるファイルが前回の確認の後で読まれていたら、`The mail in … has been read` と表示する', 'print `The mail in … has been read` when a mail file bash checks was read since the last check'),
  no_empty_cmd_completion: tx('空の行での補完で、PATH のコマンドを探さない（Readline）', 'do not search PATH for completions on an empty line (with Readline)'),
  noexpand_translation: tx('`$"…"` の翻訳の結果を、ダブルクォートではなくシングルクォートで囲む', 'enclose the translated result of `$"…"` in single quotes instead of double quotes'),
  patsub_replacement: tx('`${x/pat/rep}` の置換文字列の `&` を、パターンに一致した文字列に置き換える（既定で有効）', 'in `${x/pat/rep}`, a `&` in the replacement stands for the text the pattern matched (on by default)'),
  progcomp: tx('プログラム可能な補完（`complete` で登録した補完）を有効にする（既定で有効）', 'turn on programmable completion (what `complete` registers; on by default)'),
  progcomp_alias: tx('補完の登録がないコマンド名をエイリアスとして展開し、展開後のコマンドの補完を使う', 'complete a command name with no completion of its own as the command its alias expands to'),
  promptvars: tx('プロンプトの文字列に、パラメータ展開・コマンド置換・算術展開とクォート除去を行う（既定で有効）', 'expand parameters, command substitutions and arithmetic in the prompt strings, and remove their quotes (on by default)'),
  restricted_shell: tx('制限付きシェルとして起動したときにシェルが設定する（変えられない）', 'set by the shell when it starts in restricted mode (it cannot be changed)'),
  shift_verbose: tx('`shift` の数が位置パラメータの数より大きいとき、エラーメッセージを表示する', '`shift` prints an error message when the count is greater than the number of positional parameters'),
  sourcepath: tx('`.`（`source`）が、`/` のないファイル名を PATH から探す（既定で有効）', '`.` (`source`) looks for a file name with no `/` in PATH (on by default)'),
  varredir_close: tx('`{変数名}` のリダイレクトで開いたファイル記述子を、コマンドの終わりに自動で閉じる', 'close the file descriptors opened by a `{varname}` redirection when the command ends'),
  xpg_echo: tx('`echo` が既定でバックスラッシュエスケープを解釈する（`-e` を付けたのと同じ）', '`echo` reads backslash escapes by default (as with `-e`)'),
  // (bash 5.3's: SHELL_OPTIONS_SINCE in src/bashversion.ts.)
  array_expand_once: tx('bash 5.3: 配列の添字を一度だけ展開する（算術式の中と、配列の要素を代入・参照する組み込みで）。`assoc_expand_once` の新しい名前', 'bash 5.3: evaluate array subscripts only once (in arithmetic, and in builtins that assign or read elements); the new name of `assoc_expand_once`'),
  bash_source_fullpath: tx('bash 5.3: `BASH_SOURCE` にファイルのフルパスを入れる', 'bash 5.3: put the full path of each file in `BASH_SOURCE`'),
};

/**
 * An option whose value names a variable the builtin sets (`read -a NAME`, `printf -v NAME`; `sets`), or a function
 * it runs later (`complete -F f`, `compgen -F f`): the effects src/semantics/effects.ts reads.
 */
function naming(opt: OptSpec, type: ValueType, sets?: VariableSet): OptionSpec {
  const o = optionOf(opt);
  return { ...o, value: { ...(o.value as ValueSpec), type, ...(sets ? { sets } : {}) } };
}

/**
 * An option whose value is code bash runs (`mapfile -C 'cmd'`: this shell reads the text, with the index and the line
 * after it, as `eval` does; `compgen -C cmd`: a subshell runs it, as `$( )` does).
 */
function running(opt: OptSpec, command: CommandSlot): OptionSpec {
  const o = optionOf(opt);
  return { ...o, value: { ...(o.value as ValueSpec), command } };
}

const MAPFILE_OPTIONS: (OptSpec | OptionSpec)[] = [
    ['-t', '各行末の改行を取り除く', 'strip trailing newlines'],
    ['-n', '読む行数の上限（0 なら全部）', 'max lines to read (0 = all)', 'arg'],
    ['-d', '行区切り文字（空文字なら NUL）', 'line delimiter (an empty string means NUL)', 'arg'],
    ['-s', '最初に読み飛ばす行数', 'number of lines to skip first', 'arg'],
    ['-O', '代入を始める配列の添字（既定は 0）', 'index to start assigning at (default 0)', 'arg'],
    ['-u', '標準入力の代わりに読むファイルディスクリプタ', 'file descriptor to read instead of stdin', 'arg'],
    // (bash reads the text with the index and the line appended, in this shell: `mapfile -C 'x=2; :'` sets `x`.)
    running(['-C', '`-c` 行ごとに実行するコールバック（今のシェルが読み直して実行する文字列。添字と行が後ろに付く）', 'callback run every `-c` lines (a string the current shell reads again and runs, with the index and the line appended)', 'arg'], { run: 'current-shell' }),
    ['-c', '`-C` を呼び出す間隔の行数', 'number of lines between callbacks', 'arg'],
  ];

const MAPFILE_OPERANDS = args(operand('ARRAY', '格納する配列名（省略時は MAPFILE）', 'array name (default MAPFILE)', { type: 'variable', sets: 'lines' }));
const MAPFILE_DEFAULT = { byDefault: { name: 'MAPFILE', sets: 'lines' as const } };

/** The kinds of candidates of `complete` and `compgen`, one letter each (`-A` names them too: `-A user` is `-u`). */
const COMPLETION_ACTIONS: OptSpec[] = [
  ['-a', 'エイリアス名', 'alias names'], ['-b', '組み込みコマンド名', 'builtin names'], ['-c', 'コマンド名', 'command names'],
  ['-d', 'ディレクトリ名', 'directory names'], ['-e', 'エクスポートされた変数名', 'exported variable names'], ['-f', 'ファイル名', 'file names'],
  ['-g', 'グループ名', 'group names'], ['-j', 'ジョブ名', 'job names'], ['-k', '予約語', 'reserved words'],
  ['-s', 'サービス名', 'service names'], ['-u', 'ユーザー名', 'user names'], ['-v', '変数名', 'variable names'],
];

/** What `complete` and `compgen` do to the candidates: as text, with no expansion. */
const COMPLETION_FILTERS: OptSpec[] = [
  ['-X', '指定したパターンに合う候補を除く（先頭が `!` なら、合わない候補を除く）', 'remove the candidates that match the given pattern (with a leading `!`, those that do not)', 'arg'],
  ['-P', '各候補の前に付ける文字列', 'text to put before each candidate', 'arg'],
  ['-S', '各候補の後に付ける文字列', 'text to put after each candidate', 'arg'],
];

/** `complete -D`, `-E`, `-I` (also `compopt`): the completion of no command in particular. */
const COMPLETION_TARGETS: OptSpec[] = [
  ['-D', '補完の登録がないコマンドの既定の補完を対象にする', 'the default completion, for commands with no registration of their own'],
  ['-E', '空の行での補完を対象にする', 'the completion of an empty line'],
  ['-I', 'コマンド名の位置の単語の補完を対象にする', 'the completion of the word in the place of the command name'],
];

/** A signal number of Linux (0 to 64, leading zeros allowed), as `trap` checks its first word. */
const SIGNAL_NUMBER = /^0*(?:\d|[1-5]\d|6[0-4])$/;

/** `+N` and `-N` of `pushd`, `popd` and `dirs`: a place in the directory stack, from the left (`+`) or the right (`-`) of what `dirs` prints. */
/** `pushd -x`: a word with a dash is a place in the stack, and this one is no number (bash: `invalid number`, status 2). */
const STACK_NUMBER = tx('bash は `-` で始まる語をスタックの位置（`-N`）として読むが、数ではない: `invalid number` と表示し、何もせずに失敗する（終了ステータス 2）', 'bash reads a word that starts with `-` as a place in the stack (`-N`), and this is no number: it says `invalid number`, and fails with status 2, doing nothing');
/** The meanings of option names as the text of an operand: `Shell option \`x\`: …` (`OperandSpec.values`). */
const named = (options: Record<string, Text>): Record<string, Text> =>
  Object.fromEntries(Object.entries(options).map(([name, t]) => [name, tx(`シェルオプション \`${name}\`: ${t.ja}`, `Shell option \`${name}\`: ${t.en}`)]));
const SIDE_JA = { left: '左', right: '右' };
const stackPosition = (text: (side: 'left' | 'right', n: string) => Text): PatternOption => ({
  pattern: /^([+-])(\d+)$/,
  text: ([, sign, n]) => text(sign === '+' ? 'left' : 'right', n),
});

type Rest = Omit<Partial<CommandSpec>, 'summary' | 'options'>;

/** A builtin of bash: it reads options up to its first operand (`-` words after it are operands). */
const b = (ja: string, en: string, opts: (OptSpec | OptionSpec)[] = [], rest: Rest = {}): CommandSpec =>
  cmd(ja, en, opts, { builtin: 'regular', optionsFirst: true, ...rest });
/** A POSIX special builtin: an assignment before it stays in POSIX mode, and an error in it exits a POSIX shell. */
const special = (ja: string, en: string, opts: (OptSpec | OptionSpec)[] = [], rest: Rest = {}): CommandSpec => b(ja, en, opts, { builtin: 'special', ...rest });

/**
 * The one operand of `exit`, `return`, `shift`, `break` and `continue`, a number. They take no options:
 * `exit -1` exits with 255, and `shift -1` says the count is out of range (`--` still ends the options).
 */
const numeric = (o: OperandSpec): Rest => ({ parser: 'letters', ...args(o) });

/** `export -f`, `readonly -f`: functions. */
const FUNCTION_NAMES: NameOptions['options'] = [['-f', 'function']];
/** `declare -f` (and `-F`, `local -f`): functions; `-n`: the name reference itself. */
const DECLARE_NAMES: NameOptions['options'] = [['-f', 'function'], ['-F', 'function'], ['-n', 'nameref']];

/**
 * A declaration builtin. Its operands name what it declares (`acts`): functions with `-f` (and `-F`), the name
 * reference itself with `-n` for those that have it (`export -n` unexports instead).
 */
function declarationSpec(name: string, flags: Record<string, Text>, options: NameOptions['options'], rest: Rest = {}, off: Record<string, Text> = {}): CommandSpec {
  const t = declarationCommands[name];
  return b(t.ja, t.en, Object.entries(flags).map(([flag, text]) => ({ names: [flag], text, ...(off[flag] ? { offText: off[flag] } : {}) })), {
    ...args(operand('NAME', '変数名（`名前=値` も可。`-f` なら関数名）', 'variable name (`name=value` too; function names with `-f`)', { type: 'variable', acts: 'declares', names: { options } })),
    ...rest,
  });
}

/** `source -p PATH` (bash 5.3): the directories to look in, instead of `$PATH` (checked: test/bash53.test.ts). */
const SOURCE_OPTIONS: OptSpec[] = [
  ['-p', 'bash 5.3: ファイルを `$PATH` ではなく、指定したコロン区切りのディレクトリから探す（カレントディレクトリは、空の要素があるときだけ）', 'bash 5.3: look for the file in the given directories, separated by colons, instead of `$PATH` (the current directory only for an empty entry)', 'arg since:5.3'],
];
const SOURCE_OPERANDS = args(operand('FILE', '読み込むファイル', 'file to source', { io: 'run', searchesPath: { shopt: 'sourcepath', instead: ['-p'] } }), operand('ARG', 'そのファイルに渡す引数（実行中は $1, $2…になる）', 'arguments passed to it (they are $1, $2… while it runs)'));

/** The signals `kill` knows by name (`-TERM`, `-SIGTERM`), as Linux and the BSDs name them. */
const SIGNALS = 'HUP|INT|QUIT|ILL|TRAP|ABRT|BUS|FPE|KILL|USR1|SEGV|USR2|PIPE|ALRM|TERM|STKFLT|CHLD|CONT|STOP|TSTP|TTIN|TTOU|URG|XCPU|XFSZ|VTALRM|PROF|WINCH|IO|PWR|SYS|EMT|INFO|POLL|CLD|IOT';
/**
 * `kill -9 -1`: only the first signal is one; then a word like `-1` is a PID (bash's `saw_signal`). The
 * options and patterns that give a signal mark the line, and those that look like one are taken only before.
 */
const SIGNAL_GIVEN = { marks: 'signal', unlessMarked: 'signal' };
/** `TERM` in any case: `[Tt][Ee][Rr][Mm]`. */
const anyCase = (s: string): string => s.replace(/[A-Z]/g, (c) => `[${c}${c.toLowerCase()}]`);
const KILL_LISTING = tx('シグナルは送られない（`-l` があるので一覧の表示だけで、この語は無視される）', 'No signal is sent (with `-l`, kill only lists signals and ignores this word)');
const KILL_PATTERNS: PatternOption[] = [
  {
    pattern: /^-(\d+)$/, ...SIGNAL_GIVEN, inMode: { list: KILL_LISTING },
    text: ([, n]) => tx(`送るシグナルの番号 ${n}（\`-n ${n}\` と同じ。\`kill -l ${n}\` で名前がわかる）`, `Send signal number ${n} (same as \`-n ${n}\`; \`kill -l ${n}\` prints its name)`),
    open: tx('展開した名前か番号のシグナルを送る（`-s 名前` と同じ）', 'Send the signal the expansion names (same as `-s NAME`)'),
  },
  {
    // `-s` is followed by a name and `-n` by a number: bash reads any other word of this shape as one signal spec, which it refuses.
    pattern: /^-((?:s(?![A-Za-z])|n(?!\d)).+)$/, unlessMarked: 'signal',
    text: ([, s]) => tx(`bash は \`${s}\` を 1 つのシグナル指定として読み、受け付けない（\`-s\` には名前、\`-n\` には番号をつなげる。離して書けば値になる）`, `Invalid: bash reads \`${s}\` as one signal spec and refuses it (attached to \`-s\` a name works, attached to \`-n\` a number; written apart, either is a value)`),
  },
  {
    // A name in any case, with or without `SIG`; but bash reads `-s` and a letter as `-s NAME` (`-sigterm`, `-stop`: the signal `igterm`, `top`).
    pattern: new RegExp(`^-(?!s[A-Za-z])(?:${anyCase('SIG')})?(${anyCase(SIGNALS)})$`), ...SIGNAL_GIVEN, inMode: { list: KILL_LISTING },
    text: ([, s]) => tx(`送るシグナル \`${s.toUpperCase()}\`（\`-s ${s.toUpperCase()}\` と同じ。\`kill -l\` で一覧）`, `Send the signal \`${s.toUpperCase()}\` (same as \`-s ${s.toUpperCase()}\`; \`kill -l\` lists them)`),
  },
];

/** procps kill: `-N` is `-s N`, and a name may start with `s` (`/bin/kill -stop` sends STOP). */
const PROCPS_KILL_PATTERNS: PatternOption[] = [
  { ...KILL_PATTERNS[0], text: ([, n]) => tx(`送るシグナルの番号 ${n}（\`-s ${n}\` と同じ。\`kill -l ${n}\` で名前がわかる）`, `Send signal number ${n} (same as \`-s ${n}\`; \`kill -l ${n}\` prints its name)`) },
  { ...KILL_PATTERNS[1], pattern: new RegExp(`^-(?:${anyCase('SIG')})?(${anyCase(SIGNALS)})$`) },
];

/** What echo reads, as the builtin and as the program of coreutils, which read the same words. */
const ECHO_OPTIONS: OptionSpec[] = [
  { names: ['-n'], text: tx('末尾の改行を出力しない', 'do not print the trailing newline') },
  { names: ['-e'], text: tx('`\\n` などのバックスラッシュエスケープを解釈する', 'interpret backslash escapes like `\\n`'), selects: 'escapes' },
  { names: ['-E'], text: tx('バックスラッシュエスケープを解釈しない（既定）', 'do not interpret escapes (default)'), selects: 'plain' },
];
const ECHO_READING: Rest = {
  parser: 'letters', dashDash: 'literal', modes: [{ name: 'escapes' }, { name: 'plain', default: true }], lastModeWins: true, prints: 'words',
  operands: [
    { when: { mode: 'escapes' }, pattern: [operand('TEXT', '表示する文字列', 'text to print', { repeat: '*', lang: 'echo' })] },
    { pattern: [operand('TEXT', '表示する文字列', 'text to print', { repeat: '*' })] },
  ],
};
const TEST_OPTIONS: OptSpec[] = [
  ['-z', '文字列が空なら真', 'true if the string is empty'], ['-n', '文字列が空でなければ真', 'true if the string is not empty'],
  ['-e', 'ファイルが存在すれば真', 'true if the file exists'], ['-f', '通常のファイルなら真', 'true if it is a regular file'],
  ['-d', 'ディレクトリなら真', 'true if it is a directory'], ['-s', 'ファイルが空でなければ真', 'true if the file is not empty'],
  ['-r', '読めるなら真', 'true if readable'], ['-w', '書けるなら真', 'true if writable'], ['-x', '実行できるなら真', 'true if executable'],
  ['-L|-h', 'シンボリックリンクなら真', 'true if it is a symbolic link'],
  ['-eq', '数値として等しい', 'numerically equal'], ['-ne', '数値として等しくない', 'numerically not equal'],
  ['-lt', 'より小さい', 'less than'], ['-le', '以下', 'less than or equal'], ['-gt', 'より大きい', 'greater than'], ['-ge', '以上', 'greater than or equal'],
];
const TEST_SUMMARY = ['条件式を評価し、真なら 0、偽なら 1 を返す（`[ ]` と同じ）', 'Evaluate a conditional expression; exit 0 if true (same as `[ ]`)'] as const;
/** `[` is `test` with a last argument `]`. */
const BRACKET_SUMMARY = ['条件式を評価し、真なら 0、偽なら 1 を返す（`test` と同じで、最後の引数は `]`）', 'Evaluate a conditional expression; exit 0 if true (same as `test`, with a last argument `]`)'] as const;
const BRACKET_READING: Rest = { parser: 'single-dash', operandParser: 'test-expression', closingOperand: ']' };

/**
 * The programs named like builtins (coreutils, procps), which a path (`/bin/kill`) or a wrapper that starts a
 * program (`env echo`, `sudo kill`) runs instead of the builtin. Their options may differ: procps kill has no
 * `-n` and no job specs, printf has no `-v`, and pwd reads `-P` by default.
 */
const PROGRAMS: Record<string, CommandSpec> = {
  echo: cmd('引数を空白区切りで標準出力に表示する（coreutils 版）', 'Print arguments to stdout, separated by spaces (from coreutils)', ECHO_OPTIONS, ECHO_READING),
  printf: cmd('書式を指定して文字列を出力する（coreutils 版。`-v` はない）', 'Print formatted output (from coreutils, with no `-v`)', [], {
    parser: 'letters', example: 'printf', prints: 'format', ...args(operand('FORMAT', '書式文字列', 'format string', { lang: 'printf' }), operand('ARG', '書式に埋め込む値', 'value for the format')),
  }),
  pwd: cmd('カレントディレクトリのパスを表示する（coreutils 版。既定は `-P`）', 'Print the current directory (from coreutils; `-P` is the default)', [
    ['-P|--physical', 'シンボリックリンクを解決した物理パスを表示（既定）', 'print the physical path (default)'],
    ['-L|--logical', '環境変数 `PWD` の論理パスを表示', 'print the logical path from `PWD`'],
    ['--help', 'ヘルプを表示する', 'show help'], ['--version', 'バージョンを表示する', 'print the version'],
  ]),
  kill: cmd('プロセスにシグナルを送る（procps 版。既定は TERM、ジョブ指定は使えない）', 'Send a signal to a process (from procps; default TERM, no job specs)', [
    { names: ['-s', '--signal'], text: tx('送るシグナル', 'signal to send'), value: { name: 'SIGNAL', type: 'signal' }, marks: 'signal' },
    ['-q|--queue', 'シグナルと一緒に送る整数', 'integer to send with the signal', 'arg'],
    ['-l|--list', 'シグナル名の一覧を表示（`--list=シグナル` なら名前と番号を直す）', 'list signal names (`--list=SIG` translates one)', 'attached'],
    ['-L|--table', 'シグナルの一覧を表にして表示', 'list the signals in a table'],
    ['-h|--help', 'ヘルプを表示する', 'show help'], ['-V|--version', 'バージョンを表示する', 'print the version'],
  ], {
    optionsFirst: true, patternOptions: PROCPS_KILL_PATTERNS,
    operands: [
      { when: { option: ['-l'] }, pattern: [operand('SIGNAL', '名前か番号に直すシグナル', 'signal to translate between name and number', { repeat: '*' })] },
      ...args(operand('PID', '対象のプロセス ID', 'target PID')).operands!,
    ],
  }),
  '[': cmd(`${BRACKET_SUMMARY[0]}（coreutils 版）`, `${BRACKET_SUMMARY[1]} (from coreutils)`, TEST_OPTIONS, BRACKET_READING),
  test: cmd(`${TEST_SUMMARY[0]}（coreutils 版）`, `${TEST_SUMMARY[1]} (from coreutils)`, TEST_OPTIONS, { parser: 'single-dash', operandParser: 'test-expression' }),
  true: cmd('何もせず成功（終了ステータス 0）を返す（coreutils 版）', 'Do nothing and succeed (exit 0; from coreutils)', [], { parser: 'letters' }),
  false: cmd('何もせず失敗（終了ステータス 1）を返す（coreutils 版）', 'Do nothing and fail (exit 1; from coreutils)', [], { parser: 'letters' }),
};
// (All of them are in /usr/bin: coreutils, and procps for kill.)
for (const [name, spec] of Object.entries(PROGRAMS)) spec.path = `/usr/bin/${name}`;

/**
 * A builtin whose effect is on the shell that runs it (`CommandSpec.shellEffect`): it changes its state, or ends
 * it (`exit`). In a subshell, that is the subshell only. `how`: `exits`, or the calls that change the shell when
 * not all of them do (the others only print: `set +o`, `umask`, `trap -p`).
 */
const actsOnShell = (spec: CommandSpec, when?: (call: BuiltinCall) => boolean, more: Omit<NonNullable<CommandSpec['shellEffect']>, 'does' | 'when'> = {}): CommandSpec =>
  ({ ...spec, shellEffect: { does: 'changes', ...(when ? { when } : {}), ...more } });
const has = (call: BuiltinCall, ...flags: string[]): boolean => call.flags.some((f) => flags.includes(f));
/** `declare`, `typeset`: no name, `-p` and `-F` print, and so does `-f` without an attribute to give. */
const declares = (c: BuiltinCall): boolean => c.operands.length > 0 && !has(c, '-p', '-F') && !(has(c, '-f') && !c.flags.some((f) => /^[-+][xrt]$/.test(f)));

/** `set +f`, `set +o noglob`. */
const GLOB_AGAIN = tx('グロブ（ワイルドカード展開）を再び有効にする', 'enable globbing (wildcard expansion) again');

/** The builtins of bash that sh-like shells (dash, ksh…) are not taken to have: there they are programs, if any. */
export const BASH_ONLY_BUILTINS: ReadonlySet<string> = new Set(['shopt', 'mapfile', 'readarray']);

export const builtins: Record<string, CommandSpec> = wordTable({
  export: actsOnShell(declarationSpec('export', exportFlags, FUNCTION_NAMES, { builtin: 'special' }), (c) => c.operands.length > 0 && !has(c, '-p')),
  readonly: actsOnShell(declarationSpec('readonly', readonlyFlags, FUNCTION_NAMES, { builtin: 'special' }), (c) => c.operands.length > 0 && !has(c, '-p')),
  // `declare +x`: a `+` turns the attribute off.
  declare: actsOnShell(declarationSpec('declare', declarationFlags, DECLARE_NAMES, { plusOptions: true, locals: 'unless-g' }, declarationOffFlags), declares),
  typeset: actsOnShell(declarationSpec('typeset', declarationFlags, DECLARE_NAMES, { plusOptions: true, locals: 'unless-g' }, declarationOffFlags), declares),
  local: actsOnShell(declarationSpec('local', declarationFlags, DECLARE_NAMES, { plusOptions: true, scope: { only: 'function', except: ['zsh', 'mksh', 'yash', 'ksh'] }, locals: 'unless-g', localOptions: true }, declarationOffFlags), (c) => c.operands.length > 0),
  // `echo` knows only `-n`, `-e` and `-E`, alone or joined; any other word, `--` too, is text to print.
  // The last of `-e` and `-E` decides whether backslash escapes are read.
  echo: b('引数を空白区切りで標準出力に表示する', 'Print arguments to stdout, separated by spaces', ECHO_OPTIONS, { program: PROGRAMS.echo, ...ECHO_READING }),
  printf: b('書式を指定して文字列を出力する（`%s` 文字列, `%d` 整数, `\\n` 改行 など）', 'Print formatted output (`%s` string, `%d` integer, `\\n` newline…)', [
    naming(['-v', '出力せず、結果を指定した変数に代入する', 'assign the output to a variable instead of printing', 'arg'], 'variable', 'string'),
  ], { program: PROGRAMS.printf, example: 'printf', prints: 'format', ...args(operand('FORMAT', '書式文字列', 'format string', { lang: 'printf' }), operand('ARG', '書式に埋め込む値', 'value for the format')) }),
  read: actsOnShell(b('標準入力から1行読み、変数に代入する', 'Read a line from stdin into variables', [
    ['-r', 'バックスラッシュをエスケープ文字として扱わない（ほぼ常に付けるべき）', 'do not treat backslashes as escapes (almost always wanted)'],
    ['-p', '入力前にプロンプトを表示する', 'show a prompt first', 'arg'],
    ['-s', '入力を画面に表示しない（パスワード入力用）', 'silent mode (for passwords)'],
    naming(['-a', '単語に分割して配列に代入する', 'read words into an array', 'arg'], 'variable', 'array'),
    ['-n', '指定した文字数だけ読む', 'read only the given number of characters', 'arg'],
    ['-t', 'タイムアウト秒数', 'timeout in seconds', 'arg'],
    ['-d', '改行の代わりに指定した文字まで読む', 'read up to the given delimiter instead of newline', 'arg'],
    ['-u', '指定したファイルディスクリプタから読む', 'read from the given file descriptor', 'arg'],
    ['-N', '区切り文字に関係なく、ちょうど指定した文字数を読む', 'read exactly the given number of characters, whatever the delimiter', 'arg'],
    ['-i', '`-e` の編集行に最初から入れておく文字列', 'text to put in the `-e` edit line to begin with', 'arg'],
    ['-e', 'Readline で行編集しながら読む（対話シェル用）', 'read with Readline line editing (interactive shells)'],
    ['-E', 'bash 5.3: Readline で行編集しながら読み、補完に bash の既定の補完を使う（対話シェル用）', "bash 5.3: read with Readline line editing and bash's own completion (interactive shells)", 'since:5.3'],
  ], {
    example: 'read',
    operands: [
      // With `-a`, bash sets only the array: the names are ignored.
      { when: { option: ['-a'] }, pattern: [operand('NAME', '読み込んだ値を入れる変数名', 'variable to store the input', { repeat: '*' })] },
      ...args(operand('NAME', '読み込んだ値を入れる変数名', 'variable to store the input', { type: 'variable', sets: 'string' })).operands!,
    ],
  }), undefined, { byDefault: { name: 'REPLY', sets: 'string' } }),
  cd: actsOnShell(b('カレントディレクトリを移動する', 'Change the current directory', [
    ['-P', 'シンボリックリンクを解決した物理パスに移動', 'use the physical path (resolve symlinks)'],
    ['-L', 'シンボリックリンクをたどる（既定）', 'follow symlinks (default)'],
    ['-e', '`-P` と一緒に使い、移動後のカレントディレクトリが分からなければ失敗を返す', 'with `-P`, fail when the new current directory cannot be determined'],
  ], { ...args(operand('DIR', '移動先のディレクトリ（`-` は直前のディレクトリ、省略時は $HOME）', 'target directory (`-` = previous, default $HOME)')), restricted: {} })),
  pwd: b('カレントディレクトリのパスを表示する', 'Print the current directory', [
    ['-P', 'シンボリックリンクを解決した物理パスを表示', 'print the physical path'],
    ['-L', 'シンボリックリンクを含んだ論理パスを表示（既定）', 'print the logical path, with symlinks (default)'],
  ], { program: PROGRAMS.pwd }),
  logout: b('ログインシェルを終了する（ログインシェル以外ではエラー）', 'Exit a login shell (an error in other shells)', [], numeric(operand('STATUS', '終了ステータス', 'exit status'))),
  exit: special('シェル（スクリプト）を終了する', 'Exit the shell or script', [], { ...numeric(operand('STATUS', '終了ステータス（0 が成功、省略時は直前のコマンドのステータス）', 'exit status (0 = success; default: status of last command)')), ends: 'shell' }),
  return: special('関数から戻る', 'Return from a function', [], { ...numeric(operand('STATUS', '戻り値となる終了ステータス', 'exit status to return')), ends: 'function' }),
  set: actsOnShell(special('シェルオプションや位置パラメータを設定する', 'Set shell options or positional parameters', [
    { names: ['-e'], text: tx('コマンドが失敗したら即座にスクリプトを終了する（ただし、`if`・`while`・`until` の条件、`&&`・`||` の最後以外のコマンド、`pipefail` なしならパイプラインの最後以外のコマンド、`!` を付けたコマンド、およびそこから呼んだ関数の中では終了しない）', 'exit immediately if a command fails (but not in the condition of `if`, `while` or `until`, in a `&&` or `||` list except its last command, in a pipeline except its last command (unless `pipefail` is on), after `!`, or in a function called from those places)'), offText: ERREXIT_OFF },
    ['-u', '未定義の変数を参照したらエラーにする', 'treat unset variables as an error'],
    ['-x', '実行するコマンドを展開後の形で表示する（デバッグ用）', 'print each command after expansion (debugging)'],
    ['-v', '読み込んだ行をそのまま表示する', 'print input lines as they are read'],
    // `set -euo pipefail`: bash's `set` takes the name of `-o` from the next word, and reads the letters after it.
    {
      names: ['-o'], text: tx('名前でオプションを有効にする', 'enable an option by name'), offText: tx('名前で指定したオプションを無効にする', 'disable an option by name'),
      value: { name: 'VALUE', how: 'next-only', values: shellOptions, offValues: { noglob: GLOB_AGAIN, errexit: ERREXIT_OFF } },
      noValue: {
        text: tx('`-o` だけ（名前なし）: 現在のオプションの設定（`allexport  off` など）を一覧表示する。何も変えない', '`-o` alone (no name): list the current option settings (`allexport  off`…); nothing is changed'),
        offText: tx('`+o` だけ（名前なし）: 現在の設定を再現するコマンド（`set +o allexport` など）を表示する。何も変えない', '`+o` alone (no name): print the commands that recreate the current settings (`set +o allexport`…); nothing is changed'),
      },
    },
    { names: ['-f'], text: tx('グロブ（ワイルドカード展開）を無効にする', 'disable globbing'), offText: GLOB_AGAIN },
    ['-C', '`>` で既存ファイルを上書きしない', 'do not overwrite files with `>`'],
    ['-n', 'コマンドを読むだけで実行しない（構文チェック）', 'read commands but do not execute (syntax check)'],
    ['-a', '以降に設定した変数を自動でエクスポートする', 'export all subsequently set variables'],
    ['-E', '`trap … ERR` を関数やサブシェルの中でも効かせる（`set -Eeuo pipefail` の定番）', 'make `trap … ERR` work inside functions and subshells too (as in `set -Eeuo pipefail`)'],
    ['-T', '`trap … DEBUG` と `RETURN` を関数の中でも効かせる', 'make `trap … DEBUG` and `RETURN` work inside functions too'],
    ['-m', 'ジョブ制御を有効にする（対話シェルの既定）', 'turn on job control (the default in interactive shells)'],
    ['-b', 'バックグラウンドジョブの終了をすぐに知らせる', 'report the end of background jobs at once'],
    ['-h', '実行したコマンドのパスを記憶する（既定）', 'remember the path of the commands run (the default)'],
    ['-k', 'コマンド名の前だけでなく、どこにある `name=value` も環境変数として渡す', 'put every `name=value` in the words into the command\'s environment'],
    ['-B', '波括弧展開 `{a,b}` を有効にする（既定）', 'turn on brace expansion `{a,b}` (the default)'],
    ['-H', '`!!` や `!$` の履歴展開を有効にする', 'turn on `!!` and `!$` history expansion'],
    ['-P', '`cd` でシンボリックリンクをたどらず物理パスで移動する', 'do not follow symlinks in `cd`'],
    ['-p', '特権モード（`$ENV` を読まず、環境の関数を取り込まない）', 'privileged mode (reads no `$ENV`, imports no functions)'],
    ['-t', '1つコマンドを読んで実行したら終了する', 'exit after reading and running one command'],
    ['--', 'オプションの終わり。続く語は `-` で始まっていても位置パラメータ `$1`、`$2`… になる（なければ位置パラメータをすべて削除する）', 'ends the options; the words after it become the positional parameters `$1`, `$2`…, even those that start with `-` (with none, the positional parameters are unset)'],
  ], {
    plusOptions: true,
    operands: [
      // (`set - a b`: a lone `-` ends the options too, and turns `-x` and `-v` off.)
      {
        when: { operand: 0, matches: /^-$/ }, pattern: [
          operand('-', 'オプションの終わり。`-x` と `-v` も無効にする。続く語が位置パラメータになる（なければ位置パラメータはそのまま）', 'ends the options, and turns `-x` and `-v` off; the words after it become the positional parameters (with none, they stay as they are)', { matches: /^-$/ }),
          operand('ARG', '位置パラメータ `$N` になる', 'becomes the positional parameter `$N`', { repeat: '*' }),
        ],
      },
      ...args(operand('ARG', '位置パラメータ `$N` になる', 'becomes the positional parameter `$N`')).operands!,
    ],
  }), (c) => c.operands.length > 0 || c.flags.some((f) => !c.bare.includes(f)), { alters: ['options'] }),
  shopt: actsOnShell(b('bash 固有のシェルオプションを設定・表示する', 'Set or show bash-specific shell options', [
    ['-s', 'オプションを有効にする', 'enable the options'],
    ['-u', 'オプションを無効にする', 'disable the options'],
    ['-q', '何も表示せず、終了ステータスで状態を返す', 'quiet; report via exit status'],
    ['-p', '再入力できる形（`shopt -s 名前`）で表示する', 'print in a reusable form (`shopt -s name`)'],
    ['-o', '`shopt` のオプションではなく、`set -o` のオプション名を対象にする', 'work on the `set -o` option names instead of the `shopt` ones'],
  ], {
    operands: [
      // With `-o` the names are those of `set -o`.
      { when: { option: ['-o'] }, pattern: [operand('OPTNAME', '`set -o` のオプション名（例: errexit, pipefail, noglob）', '`set -o` option name (e.g. errexit, pipefail, noglob)', { repeat: '*', values: named(shellOptions) })] },
      ...args(operand('OPTNAME', 'オプション名（例: nullglob, globstar, extglob）', 'option name (e.g. nullglob, globstar, extglob)', { type: 'shell-option', values: named(shoptOptions) })).operands!,
    ],
  }), (c) => has(c, '-s', '-u') && !has(c, '-p') && c.operands.length > 0, { alters: ['options'] }),
  print: b('引数を表示する（ksh・mksh・zsh の組み込み。bash にはない。`echo` と違いオプションの扱いが決まっている）', 'Print the arguments (a ksh, mksh and zsh builtin, not in bash; unlike `echo` its options are well defined)', [
    ['-n', '最後に改行を出さない', 'do not print a trailing newline'],
    ['-r', '`\\` によるエスケープを解釈しない', 'do not interpret `\\` escapes'],
    ['-R', '`-r` に加えて、以降の `-` で始まる引数もオプションとして扱わない', 'like `-r`, and treat later `-` arguments as text'],
    ['-u', '指定したファイル記述子に書き出す（`-u2` で標準エラー出力）', 'write to the given file descriptor (`-u2` for stderr)', 'arg'],
    ['-f', 'printf と同じ書式で表示する（ksh93）', 'format like printf (ksh93)', 'arg'],
    ['-s', 'コマンド履歴に追加する', 'append to the command history'],
    ['-l', '引数を1行ずつ表示する（zsh）', 'print each argument on its own line (zsh)'],
  ]),
  whence: b('コマンド名がどう解釈されるか（パスやエイリアスなど）を表示する（ksh・mksh・zsh の組み込み。bash の `type`・`command -v` に相当）', 'Show how a command name is interpreted (a ksh, mksh and zsh builtin; like bash\'s `type` / `command -v`)', [
    ['-v', '種類（組み込み・関数・エイリアスなど）も表示する', 'say what kind of command it is'],
    ['-p', '関数やエイリアスを無視して PATH から探す', 'search PATH only, ignoring functions and aliases'],
    ['-a', '見つかったものをすべて表示する', 'show every match'],
  ], args(operand('NAME', '調べるコマンド名', 'command name to look up'))),
  trap: actsOnShell(special('シグナルや終了時に実行するコマンドを登録する', 'Run a command when a signal or event occurs', [
    ['-l', 'シグナル名の一覧を表示', 'list signal names'],
    ['-p', '登録済みの trap を表示', 'show registered traps'],
    ['-P', 'bash 5.3: 指定したシグナルに登録されたコマンドだけを表示する（シグナルが1つ以上必要。`-p` とは一緒に使えない）', 'bash 5.3: print only the command set for each signal given (at least one; not with `-p`)', 'since:5.3'],
  ], {
    operands: [
      // `trap INT` (one word) resets the signal; with -p, -P and -l the words are signals only.
      { when: { not: { option: ['-p', '-P', '-l'] } }, pattern: [operand('SIGNAL', '既定の動作に戻すシグナル（コマンドを書かない `trap INT` は登録の解除）', 'signal to reset to its default (`trap INT`, with no command, removes the trap)')] },
      { when: { option: ['-p'] }, pattern: [operand('SIGNAL', '表示するシグナル（EXIT, ERR, INT, TERM など）', 'signal to show (EXIT, ERR, INT, TERM…)', { repeat: '*' })] },
      { when: { option: ['-P'] }, pattern: [operand('SIGNAL', '登録されたコマンドを表示するシグナル', 'signal whose command to print', { repeat: '+' })] },
      { when: { option: ['-l'] }, pattern: [operand('SIGNAL', '名前か番号に直すシグナル', 'signal to translate between name and number', { repeat: '*' })] },
      // `trap 1 2`: a signal number first resets every signal named (bash reads it so for old scripts).
      { when: { operand: 0, matches: SIGNAL_NUMBER }, pattern: [operand('SIGNAL', '既定の動作に戻すシグナル（最初の語がシグナル番号なら、どの語もシグナル）', 'signal to reset to its default (when the first word is a signal number, every word is a signal)', { repeat: '+' })] },
      // `trap - INT`: `-` resets the signals to their defaults (no command runs).
      { when: { operand: 0, matches: /^-$/ }, pattern: [operand('RESET', '`-`: 続くシグナルの動作を既定に戻す', '`-`: reset the signals that follow to their default action'), operand('SIGNAL', '既定の動作に戻すシグナル', 'signal to reset to its default', { repeat: '+' })] },
      ...args(operand('ACTION', '実行するコマンド（`-` でリセット、空文字で無視）', 'command to run (`-` resets, empty string ignores)', { command: { run: 'current-shell', later: true } }), operand('SIGNAL', '対象のシグナル（EXIT, ERR, INT, TERM など）', 'signal (EXIT, ERR, INT, TERM…)')).operands!,
    ],
  }), (c) => (c.operands.length > 0 || has(c, '--')) && !has(c, '-p', '-P', '-l')),
  source: actsOnShell(special('ファイルを読み込み、現在のシェルで実行する（変数や関数が現在のシェルに残る）', 'Run a file in the current shell (its variables and functions persist)', SOURCE_OPTIONS, { ...SOURCE_OPERANDS, restricted: { slash: 'operand' } }), undefined, { runsUnread: 'file' }),
  '.': actsOnShell(special('ファイルを読み込み、現在のシェルで実行する（`source` と同じ）', 'Run a file in the current shell (same as `source`)', SOURCE_OPTIONS, { ...SOURCE_OPERANDS, restricted: { slash: 'operand' } }), undefined, { runsUnread: 'file' }),
  // The words are joined with spaces and read again as a command of this shell.
  eval: cmd('引数を連結して文字列をコマンドとして再解釈・実行する（注入に注意）', 'Concatenate arguments and execute the result as a command (beware of injection)', [], {
    builtin: 'special', optionsFirst: true, operands: [{ pattern: [operand('STRING', 'もう一度読んで実行する文字列', 'text to read and run again', { repeat: '?', command: { run: 'current-shell', joinsWords: true } })] }],
  }),
  exec: cmd('現在のシェルを指定したコマンドで置き換える。引数なしならリダイレクトをシェル自体に適用', 'Replace the shell with the command; without a command, apply redirections to the shell itself', [
    ['-a', 'コマンドに 0 番目の引数（`$0`）として渡す名前', 'name to pass as the zeroth argument (`$0`) of the command', 'arg'],
    ['-c', '環境変数を空にしてコマンドを実行する', 'run the command with an empty environment'],
    ['-l', 'コマンドの 0 番目の引数の先頭に `-` を付ける（ログインシェルのように）', 'put a `-` in front of the zeroth argument (as a login shell has)'],
  ], { builtin: 'special', optionsFirst: true, operands: [{ pattern: [runs({ run: 'exec', replacesShell: true })] }], restricted: { command: true } }),
  shift: actsOnShell(special('位置パラメータを左にずらす（$2 が $1 になる）', 'Shift positional parameters left ($2 becomes $1)', [], numeric(operand('N', 'ずらす数（省略時は 1）', 'how many (default 1)')))),
  getopts: actsOnShell(b('スクリプトのオプション引数を1つずつ解析する（`while getopts … ; do case … esac; done` の形で使い、次に読む位置は $OPTIND）', 'Parse script options one at a time (used as `while getopts …; do case … esac; done`; $OPTIND tracks the position)', [], args(
    operand('OPTSTRING', '受け付けるオプション文字（`:` 付きは引数を取る）', 'option letters (`:` means takes an argument)', { lang: 'getopts' }),
    operand('NAME', '見つけたオプションの文字を入れる変数名', 'variable that receives the option letter', { type: 'variable', sets: 'string' }),
    operand('ARG', '解析する単語（省略時は位置パラメータ $@）', 'words to parse (default: the positional parameters `$@`)'),
  ))),
  wait: b('バックグラウンドジョブの終了を待つ', 'Wait for background jobs to finish', [
    ['-n', 'どれか1つの終了を待つ', 'wait for any single job'],
    ['-f', 'ジョブが止まっただけでなく、終了するまで待つ', 'wait until the job has ended, not only changed state'],
    naming(['-p', '終了したジョブの ID を入れる変数名（`-n` と使う）', 'name of the variable that receives the ID of the job that ended (use with `-n`)', 'arg'], 'variable', 'job-id'),
  ], args(operand('ID', '待つプロセス ID かジョブ指定（省略時は全て）', 'PID or job spec to wait for (default: all)', { type: 'job' }))),
  kill: b('プロセスにシグナルを送る（既定は TERM で終了要求）', 'Send a signal to a process (default TERM)', [
    { names: ['-9', '-KILL'], text: tx('強制終了（KILL シグナル）', 'force kill (SIGKILL)'), ...SIGNAL_GIVEN, inMode: { list: KILL_LISTING } },
    { names: ['-s'], text: tx('送るシグナル名', 'signal name to send'), value: { name: 'VALUE' }, marks: 'signal', inMode: { list: KILL_LISTING } },
    { names: ['-n'], text: tx('送るシグナルの番号', 'signal number to send'), value: { name: 'VALUE' }, marks: 'signal', inMode: { list: KILL_LISTING } },
    { names: ['-l', '-L'], text: tx('シグナル一覧を表示（番号や名前を渡すと、もう一方に直す）', 'list signals (given a number or a name, print the other one)'), selects: 'list' },
    { names: ['-0'], text: tx('プロセスが存在するか確認するだけ', 'only check whether the process exists'), ...SIGNAL_GIVEN, inMode: { list: KILL_LISTING } },
  ], {
    program: PROGRAMS.kill, patternOptions: KILL_PATTERNS, modes: [{ name: 'list' }],
    // (bash reads any other `-WORD` as a signal: `kill -Z 1`.)
    unknownOption: tx('bash はシグナルの名前として読むが、その名前のシグナルはない: `invalid signal specification` と表示し、何も送らずに失敗する（終了ステータス 1）', 'bash reads it as the name of a signal, and there is none: it says `invalid signal specification`, and fails with status 1, sending nothing'),
    operands: [
      { when: { option: ['-l'] }, pattern: [operand('SIGNAL', '名前か番号に直すシグナル', 'signal to translate between name and number', { repeat: '*' })] },
      ...args(operand('PID', '対象のプロセス ID かジョブ指定（`%1`）', 'target PID or job spec (`%1`)', { type: 'job' })).operands!,
    ],
  }),
  test: b(TEST_SUMMARY[0], TEST_SUMMARY[1], TEST_OPTIONS, { program: PROGRAMS.test, parser: 'single-dash', operandParser: 'test-expression' }),
  '[': b(BRACKET_SUMMARY[0], BRACKET_SUMMARY[1], TEST_OPTIONS, { program: PROGRAMS['['], ...BRACKET_READING }),
  compgen: b('補完の候補を生成して表示する（補完関数の中で使う）', 'Generate completion candidates (used in completion functions)', [
    ['-G', '指定したグロブに合うファイル名（`compgen -G パターン` は一致があるかの判定によく使う）', 'file names matching the given glob (`compgen -G pattern` is a common way to test for a match)', 'arg'],
    ['-W', '指定した単語の一覧から候補を作る', 'candidates from the given word list', 'arg'], ['-A', '候補の種類（`file`、`command`、`variable`…）', 'kind of candidates (`file`, `command`, `variable`…)', 'arg'],
    ...COMPLETION_ACTIONS,
    ['-o', '補完の動作オプション', 'completion option', 'arg'],
    // (`-F` runs the function in this shell, and bash warns that it "may not work as you expect" outside completion.)
    naming(['-F', '指定した関数を現在のシェルで実行し、`COMPREPLY` に入れた候補を使う', 'run the given function in the current shell and use the candidates it puts in `COMPREPLY`', 'arg'], 'function'),
    running(['-C', '指定したコマンドをサブシェルで実行し、その出力を候補にする', "run the given command in a subshell and use its output as candidates", 'arg'], { run: 'subshell' }),
    ...COMPLETION_FILTERS,
    naming(['-V', 'bash 5.3: 候補を表示せず、指定した名前の配列に入れる', 'bash 5.3: store the candidates in the named indexed array instead of printing them', 'arg since:5.3'], 'variable', 'array'),
  ], args(operand('WORD', '補完中の単語（これで始まる候補だけ）', 'word being completed (only candidates starting with it)'))),
  complete: b('コマンドの引数の補完方法を登録する', "Register how a command's arguments are completed", [
    naming(['-F', '指定した関数で候補を作る', 'use the given function to generate candidates', 'arg'], 'function'), ['-W', '指定した単語の一覧から候補を作る', 'candidates from the given word list', 'arg'],
    // (A command, which may be a function of the script, run in a subshell when the command is completed: never in a script.)
    running(['-C', '指定したコマンドの出力を候補にする', "use the given command's output as candidates", 'arg'], { run: 'subshell' }), ['-o', '補完の動作オプション（`nospace`、`default`…）', 'completion option (`nospace`, `default`…)', 'arg'],
    ['-r', '登録を削除する', 'remove the registration'], ['-p', '登録を表示する', 'print the registrations'],
    ['-A', '候補の種類（`file`、`command`、`variable`…）', 'kind of candidates (`file`, `command`, `variable`…)', 'arg'],
    ['-G', '指定したグロブに合うファイル名を候補にする', 'file names matching the given glob', 'arg'],
    ...COMPLETION_ACTIONS,
    ...COMPLETION_FILTERS,
    ...COMPLETION_TARGETS,
  ], args(operand('NAME', '対象のコマンド名', 'command name'))),
  compopt: b('補完中に補完の動作オプションを変える', 'Change completion options while completing', [
    ['-o', 'オプションを有効にする（`nospace`、`nosort`…）', 'enable an option (`nospace`, `nosort`…)', 'arg'], ['+o', 'オプションを無効にする', 'disable an option', 'arg'],
    ...COMPLETION_TARGETS,
  ]),
  setopt: b('zsh のオプションを有効にする', 'Turn zsh options on', [], args(operand('OPTION', 'オプション名（`local_options`、`extended_glob`…）', 'option name (`local_options`, `extended_glob`…)'))),
  unsetopt: b('zsh のオプションを無効にする', 'Turn zsh options off', [], args(operand('OPTION', 'オプション名', 'option name'))),
  // (`:`, `true` and `false` take no options: `true -x` ignores its words, as any others.)
  true: b('何もせず成功（終了ステータス 0）を返す', 'Do nothing and succeed (exit 0)', [], { program: PROGRAMS.true, parser: 'letters' }),
  false: b('何もせず失敗（終了ステータス 1）を返す', 'Do nothing and fail (exit 1)', [], { program: PROGRAMS.false, parser: 'letters' }),
  ':': special('何もしないコマンド（常に成功）。無限ループ `while :` や引数の展開だけしたい時に使う', 'No-op that always succeeds; used in `while :` or to evaluate expansions', [], { parser: 'letters' }),
  alias: actsOnShell(b('コマンドの別名を定義する', 'Define a command alias', [
    ['-p', '定義済みの別名を再入力できる形で表示する', 'print the aliases in a reusable form'],
  ], {
    // `alias NAME=VALUE` defines, `alias NAME` prints; a line of both says both.
    operands: [
      { pattern: [operand('DEFINITION', '別名の定義: `=` の前の名前が、後ろの文字列を表す', 'an alias definition: the name before `=` stands for the text after it', { repeat: '+', matches: /^[^=]+=/ })] },
      { pattern: [operand('NAME', '定義を表示する別名（なければ失敗する）', 'alias whose definition to print (it fails when there is none)', { repeat: '+', matches: /^[^=]*$/ })] },
      ...args(operand('NAME', '`名前=値` なら別名の定義（`=` の前の名前が後ろの文字列を表す）、名前だけならその定義の表示', 'with `=`, an alias definition (the name stands for the text after `=`); a name alone prints its definition')).operands!,
    ],
  }), (c) => c.operands.some((o) => o === undefined || o.includes('=')), { alters: ['aliases'] }),
  unalias: actsOnShell(b('別名を削除する', 'Remove an alias', [
    ['-a', 'すべての別名を削除する', 'remove all aliases'],
  ], args(operand('NAME', '削除する別名', 'alias to remove'))), undefined, { alters: ['aliases'] }),
  type: b('コマンドの種類（ビルトイン・関数・外部コマンドなど）を表示する', 'Show how a name would be interpreted (builtin, function, file…)', [
    ['-t', '種類だけを1語で表示', 'print only the kind'],
    ['-a', '該当する全ての候補を表示', 'show all matches'],
    ['-P', '外部コマンドのパスを表示（同名のビルトインや関数があっても）', 'print the path of the executable (even if a builtin or function has the name)'],
    ['-p', '外部コマンドのパスだけを表示（ビルトイン・関数・別名なら何も出さない）', 'print the path only when the name would run an executable (nothing for a builtin, function or alias)'],
    ['-f', '関数を無視する', 'ignore functions'],
  ], args(operand('NAME', '調べる名前', 'name to look up'))),
  command: cmd('関数や別名を無視してコマンドを実行する。`-v` で存在確認によく使う', 'Run a command ignoring functions/aliases; `-v` is often used to check existence', [
    ['-v', 'コマンドのパスまたは名前を表示（存在確認に使う）', 'print the command path or name (existence check)'],
    ['-V', 'コマンドの詳しい説明を表示', 'print a verbose description'],
    ['-p', '標準の PATH で検索する', 'use a default PATH'],
  ], {
    builtin: 'regular', optionsFirst: true,
    operands: [
      // `command -v git`: the names are looked up, and nothing runs.
      { when: { option: ['-v', '-V'] }, pattern: [operand('NAME', '調べる名前', 'name to look up', { repeat: '*' })] },
      { pattern: [runs({ run: 'current-shell', lookup: 'no-functions' })] },
    ],
    restricted: { options: ['-p'], namesOption: true },
  }),
  builtin: cmd('同名の関数があってもシェルのビルトインを実行する', 'Run the shell builtin even if a function has the same name', [], { builtin: 'regular', optionsFirst: true, operands: [{ pattern: [runs({ run: 'current-shell', lookup: 'builtins-only' })] }] }),
  hash: actsOnShell(b('コマンドのパスのキャッシュを操作する', 'Manage the command path cache', [
    ['-r', 'キャッシュを空にする（コマンドを移動・インストールした後に使う）', 'empty the cache (after moving or installing a command)'],
    ['-d', '名前をキャッシュから削除する', 'forget the names given'],
    ['-l', '再入力できる形で表示する', 'print in a reusable form'],
    ['-p', '名前に対応するパスを指定して覚えさせる', 'remember the given path for the name', 'arg'],
    ['-t', '覚えているパスを表示する', 'print the remembered path of each name'],
  ], {
    restricted: { slash: '-p' },
    // (bash reads `-t` first, then `-p`, then `-d`; with none, it looks each name up in PATH.)
    operands: [
      { when: { option: ['-t'] }, pattern: [operand('NAME', '覚えているパスを表示する名前', 'name whose remembered path to print', { repeat: '*' })] },
      { when: { option: ['-p'] }, pattern: [operand('NAME', '`-p` のパスを覚えさせる名前', 'name that gets the path of `-p`', { repeat: '*' })] },
      { when: { option: ['-d'] }, pattern: [operand('NAME', 'キャッシュから削除する名前', 'name to forget', { repeat: '*' })] },
      ...args(operand('NAME', 'PATH から探してパスを覚えるコマンド名（`hash -r` まで探し直さない）', 'command to look up in PATH now and remember (bash does not look it up again until `hash -r`)')).operands!,
    ],
  }), (c) => !has(c, '-t', '-l') && (c.operands.length > 0 || has(c, '-r', '-d', '-p'))),
  jobs: b('現在のジョブ一覧を表示する', 'List current jobs', [
    ['-l', 'プロセス ID も表示する', 'show process IDs too'],
    ['-p', 'プロセス ID だけを表示する', 'show only the process IDs'],
    ['-n', '前回の通知から状態が変わったジョブだけを表示する', 'show only jobs whose state changed since the last notice'],
    ['-r', '実行中のジョブだけを表示する', 'show only running jobs'],
    ['-s', '停止中のジョブだけを表示する', 'show only stopped jobs'],
    ['-x', 'ジョブ指定をプロセス ID に置き換えてコマンドを実行する', 'replace job specs with process IDs and run the command'],
  ], {
    operands: [
      // `jobs -x cmd %1`: the command runs in this shell, with the job specs among its words replaced by process IDs.
      { when: { option: ['-x'] }, pattern: [runs({ run: 'current-shell' })] },
      ...args(operand('JOB', '対象のジョブ指定（`%1`。省略時は全て）', 'job spec (`%1`; default: all)', { type: 'job' })).operands!,
    ],
  }),
  fg: b('ジョブをフォアグラウンドに戻す', 'Bring a job to the foreground', [], args(operand('JOB', 'ジョブ指定（`%1`。省略時は現在のジョブ）', 'job spec (`%1`; default: the current job)', { type: 'job' }))),
  bg: b('停止中のジョブをバックグラウンドで再開する', 'Resume a stopped job in the background', [], args(operand('JOB', 'ジョブ指定（`%1`。省略時は現在のジョブ）', 'job spec (`%1`; default: the current job)', { type: 'job' }))),
  disown: b('ジョブをシェルの管理から外す（シェル終了時に終了させない）', 'Remove jobs from the job table (they survive shell exit)', [
    ['-h', 'ジョブ表には残すが、シェルが終了したときに `SIGHUP` を送らない', 'keep the job in the table, but do not send it `SIGHUP` when the shell exits'],
    ['-a', 'すべてのジョブを対象にする', 'act on all jobs'],
    ['-r', '実行中のジョブだけを対象にする', 'act on running jobs only'],
  ], args(operand('JOB', 'ジョブ指定（`%1`。省略時は現在のジョブ）', 'job spec (`%1`; default: the current job)', { type: 'job' }))),
  umask: actsOnShell(b('新規ファイルのパーミッションマスク（作成時に外す権限）を設定・表示する', 'Set or show the file creation mask (permissions removed from new files)', [
    ['-S', '記号形式（u=rwx,g=rx,o=rx など）で表示する', 'show in symbolic form (u=rwx,g=rx,…)'],
    ['-p', '再入力できる形で表示する', 'output in a reusable form'],
  ], args(operand('MODE', 'マスク値（例: `022`）', 'mask (e.g. `022`)', { lang: 'umask' }), operand('MODE', 'マスク値（例: `022`）', 'mask (e.g. `022`)'))), (c) => c.operands.length > 0),
  ulimit: actsOnShell(b('プロセスのリソース上限を設定・表示する', 'Set or show resource limits', [
    ['-n', 'オープンできるファイル数', 'max open files'],
    ['-c', 'コアダンプのサイズ', 'core dump size'],
    ['-a', '全ての上限を表示', 'show all limits'],
    ['-H', 'ハードリミットを対象にする', 'use the hard limit'],
    ['-S', 'ソフトリミットを対象にする', 'use the soft limit'],
    ['-f', '作れるファイルの最大サイズ', 'maximum file size'],
    ['-u', '最大のプロセス数', 'maximum number of user processes'],
    ['-v', '仮想メモリの最大サイズ', 'maximum virtual memory size'],
    ['-s', 'スタックの最大サイズ', 'maximum stack size'],
    ['-t', 'CPU 時間の上限（秒）', 'maximum CPU time in seconds'],
    ['-l', 'ロックできるメモリの最大サイズ', 'maximum locked memory'],
    ['-d', 'データ領域の最大サイズ', 'maximum data segment size'],
    ['-m', '常駐メモリの最大サイズ', 'maximum resident set size'],
    ['-p', 'パイプのサイズ', 'pipe size'],
    ['-q', 'POSIX メッセージキューの最大バイト数', 'maximum bytes in POSIX message queues'],
    ['-x', 'ファイルロックの最大数', 'maximum number of file locks'],
    ['-e', 'スケジューリングの優先度（nice）の上限', 'maximum scheduling priority (nice)'],
    ['-i', '待機中のシグナルの最大数', 'maximum number of pending signals'],
    ['-r', 'リアルタイム優先度の上限', 'maximum real-time priority'],
    ['-b', 'ソケットバッファの最大サイズ', 'maximum socket buffer size'],
    ['-R', 'リアルタイムのプロセスがブロックせずに走れる時間（マイクロ秒）', 'time a real-time process may run without blocking (microseconds)'],
    // (bash also lists -k, -P and -T, which Linux lacks: "invalid option".)
  ], args(operand('LIMIT', '新しい上限: 資源の単位の数（大きさは多くが KiB 単位。`ulimit -a` に単位がある）か、`unlimited`（上限なし）・`soft`・`hard`（今のソフトリミット・ハードリミット）。資源のオプションがなければファイルの大きさ（`-f`）の上限', 'the new limit: a number in the unit of the resource (most sizes in KiB; `ulimit -a` shows the units), or `unlimited`, `soft` or `hard` (the current soft or hard limit); with no option for a resource, the limit of file size (`-f`)'))), (c) => c.operands.length > 0),
  mapfile: actsOnShell(b('標準入力の各行を配列に読み込む', 'Read lines from stdin into an array', MAPFILE_OPTIONS, MAPFILE_OPERANDS), undefined, MAPFILE_DEFAULT),
  readarray: actsOnShell(b('標準入力の各行を配列に読み込む（mapfile と同じ）', 'Read lines from stdin into an array (same as mapfile)', MAPFILE_OPTIONS, MAPFILE_OPERANDS), undefined, MAPFILE_DEFAULT),
  // `let` has no options: `let -a` is an expression.
  let: b('算術式を評価する（例: `let i++`）', 'Evaluate arithmetic expressions (e.g. `let i++`)', [], {
    parser: 'letters',
    ...args(operand('EXPR', '算術式（引数ごとに1つ。左から順に評価され、前の結果が後ろの式から見える）',
      'arithmetic expression (one per argument, evaluated left to right, so later ones see earlier results)', { type: 'arith', lang: 'arith' })),
  }),
  pushd: actsOnShell(b('ディレクトリスタックに積んで移動する', 'Push a directory onto the stack and cd to it', [
    ['-n', '移動せず、スタックだけを変える', 'change only the stack, do not cd'],
  ], { ...args(operand('DIR', 'スタックに積んで移動するディレクトリ', 'directory to push onto the stack and cd to')), restricted: { unless: ['-n'] }, unknownOption: STACK_NUMBER, patternOptions: [stackPosition((side, n) => tx(`スタックを回して、\`dirs\` の${SIDE_JA[side]}から ${n} 番目（0 始まり）を先頭にして移動する`, `Rotate the stack so that entry ${n}, counted from the ${side} of \`dirs\` (from 0), is on top, and cd there`))] })),
  popd: actsOnShell(b('ディレクトリスタックから取り出してそこへ戻る', 'Pop the directory stack and cd to it', [
    ['-n', '移動せず、スタックだけを変える', 'change only the stack, do not cd'],
  ], { restricted: { unless: ['-n'] }, unknownOption: STACK_NUMBER, patternOptions: [stackPosition((side, n) => tx(`\`dirs\` の${SIDE_JA[side]}から ${n} 番目（0 始まり）をスタックから取り除く`, `Remove entry ${n}, counted from the ${side} of \`dirs\` (from 0), from the stack`))] })),
  dirs: b('ディレクトリスタックを表示する', 'Show the directory stack', [
    ['-c', 'スタックを空にする', 'clear the stack'],
    ['-l', '`~` を使わず、ホームからのパスを全部書く', 'print full paths, not `~`'],
    ['-p', '1行に1つずつ表示する', 'print one entry per line'],
    ['-v', '番号を付けて1行に1つずつ表示する', 'print one entry per line with its index'],
  ], { unknownOption: STACK_NUMBER, patternOptions: [stackPosition((side, n) => tx(`\`dirs\` の${SIDE_JA[side]}から ${n} 番目（0 始まり）だけを表示する`, `Show only entry ${n}, counted from the ${side} (from 0)`))] }),
  break: special('ループを抜ける', 'Exit from a loop', [], { ...numeric(operand('N', '抜けるループの段数', 'number of loop levels')), ends: 'loop' }),
  continue: special('ループの次の繰り返しに進む', 'Skip to the next loop iteration', [], { ...numeric(operand('N', '対象のループの段数', 'number of loop levels')), ends: 'pass' }),
  unset: actsOnShell(special('変数や関数を削除する', 'Unset variables or functions', [
    ['-v', '変数を削除', 'unset variables'],
    ['-f', '関数を削除', 'unset functions'],
    ['-n', '名前参照（`declare -n`）そのものを削除する（参照先の変数は残る）', 'unset the name reference itself, not the variable it points to'],
  ], args(operand('NAME', '削除する名前', 'name to unset', {
    type: 'variable', acts: 'unsets', names: { options: [['-f', 'function'], ['-n', 'nameref'], ['-v', 'variable']], orFunction: true, exclusive: ['-f', '-v'] },
  })))),
  enable: actsOnShell(b('ビルトインを有効・無効にする', 'Enable or disable builtins', [
    ['-n', 'ビルトインを無効にする（同名の外部コマンドが使われる）', 'disable the builtin (an external command of that name runs)'],
    ['-a', 'すべてのビルトインを対象にする', 'act on all builtins'],
    ['-p', '再入力できる形で表示する', 'print in a reusable form'],
    ['-s', 'POSIX の特殊ビルトインだけを対象にする', 'act on POSIX special builtins only'],
    ['-d', '`-f` で読み込んだビルトインを取り除く', 'remove a builtin loaded with `-f`'],
    ['-f', '共有オブジェクトからビルトインを読み込む', 'load a builtin from a shared object', 'arg'],
  ], {
    restricted: { options: ['-f', '-d'] },
    // (With `-p`, bash lists the builtins and does nothing with the names; then `-f`, `-d` and `-n`.)
    operands: [
      { when: { option: ['-p'] }, pattern: [operand('NAME', '無視される（`-p` があると、`enable` はビルトインの一覧を表示するだけ）', 'ignored: with `-p`, `enable` only lists the builtins', { repeat: '*' })] },
      { when: { option: ['-f'] }, pattern: [operand('NAME', '共有オブジェクトから読み込むビルトインの名前', 'name of the builtin to load from the shared object', { repeat: '*' })] },
      { when: { option: ['-d'] }, pattern: [operand('NAME', '取り除くビルトイン（`-f` で読み込んだもの）', 'builtin to remove (one loaded with `-f`)', { repeat: '*' })] },
      { when: { option: ['-n'] }, pattern: [operand('NAME', '無効にするビルトイン（同じ名前の外部コマンドが動くようになる）', 'builtin to turn off (a program of that name runs instead)', { repeat: '*' })] },
      ...args(operand('NAME', '有効にするビルトイン（`enable -n` で無効にしたものを戻す）', 'builtin to turn on (again, after `enable -n`)')).operands!,
    ],
  }), (c) => c.operands.length > 0 && !has(c, '-p'), { alters: ['builtins'] }),
  help: b('ビルトインのヘルプを表示する', 'Show help for builtins', [
    ['-d', '1行の説明だけを表示する', 'print a one-line description'],
    ['-m', 'man ページの形式で表示する', 'print in man page format'],
    ['-s', '使い方だけを表示する', 'print only the usage'],
  ], args(operand('PATTERN', 'ヘルプを表示するビルトイン（グロブのパターンなら、一致するものすべて）', 'builtin to show the help of (with a glob pattern, every builtin it matches)'))),
  history: b('コマンド履歴を表示・操作する', 'Show or manipulate command history', [
    ['-c', '履歴をすべて削除する', 'clear the history'],
    ['-d', '指定した番号の履歴を1件削除する', 'delete the entry with the given number', 'arg'],
    ['-a', '今回のセッションの履歴を履歴ファイルに追記する', 'append this session\'s history to the history file'],
    ['-r', '履歴ファイルを読み込む', 'read the history file'],
    ['-w', '履歴をファイルに書き出す', 'write the history to the file'],
    ['-n', '履歴ファイルの未読分を読み込む', 'read the lines of the history file not yet read'],
    ['-p', '履歴展開した結果を表示するだけで、履歴には入れない', 'print the result of history expansion without saving it'],
    ['-s', '引数を履歴の最後の1件として追加する', 'add the arguments as one entry to the history'],
  ], { restricted: { options: ['-a', '-r', '-w', '-n'], slash: 'operand' } }),
  fc: b('履歴のコマンドを一覧したり、エディタで編集して再実行する', 'List history commands, or edit and re-run one in an editor', [
    ['-l', '編集せずに一覧を表示する', 'list instead of editing'],
    ['-n', '一覧に番号を付けない', 'omit the numbers in the list'],
    ['-r', '新しいものから順に並べる', 'list in reverse order'],
    ['-s', '編集せずにそのまま再実行する（`旧=新` で置換もできる）', 're-run at once without editing (`old=new` substitutes)'],
    ['-e', '使うエディタ', 'editor to use', 'arg'],
  ], args(operand('FIRST', '履歴の番号か、コマンドの先頭の文字列', 'history number or the start of a command'))),
  bind: b('Readline のキー割り当てを表示・変更する', 'Show or change Readline key bindings', [
    ['-l', '関数名の一覧を表示する', 'list the function names'],
    ['-p', '割り当てを再入力できる形で表示する', 'print the bindings in a reusable form'],
    ['-P', '割り当てを読みやすい形で表示する', 'print the bindings in a readable form'],
    ['-s', 'マクロの割り当てを再入力できる形で表示する', 'print the macro bindings in a reusable form'],
    ['-S', 'マクロの割り当てを読みやすい形で表示する', 'print the macro bindings in a readable form'],
    ['-v', '変数を再入力できる形で表示する', 'print the variables in a reusable form'],
    ['-V', '変数を読みやすい形で表示する', 'print the variables in a readable form'],
    ['-q', '指定した関数に割り当てられているキーを表示する', 'print the keys that call the given function', 'arg'],
    ['-u', '指定した関数のキー割り当てを外す', 'remove the bindings of the given function', 'arg'],
    ['-r', '指定したキーの割り当てを外す', 'remove the binding of the given key sequence', 'arg'],
    ['-f', 'キー割り当てをファイルから読み込む', 'read key bindings from the file', 'arg'],
    ['-x', 'キーにシェルコマンドを割り当てる（`"キー":コマンド`）', 'bind a key to a shell command (`"keys":command`)', 'arg'],
    ['-m', '使うキーマップ', 'keymap to use', 'arg'],
    ['-X', '`-x` の割り当てを再入力できる形で表示する', 'print the `-x` bindings in a reusable form'],
  ]),
  suspend: b('シェルを一時停止する（`fg` で再開）', 'Suspend the shell (resume it with `fg`)', [
    ['-f', 'ログインシェルでも停止する', 'suspend even a login shell'],
  ]),
  times: special('シェルと子プロセスの累積CPU時間を表示する', 'Print accumulated CPU times'),
  caller: b('呼び出し元の行番号・関数名を表示する（デバッグ用）', 'Print the caller context (debugging)', [], args(operand('EXPR', '表示する呼び出しの深さ（0 は今の関数を呼んだところ）。指定すると行番号・関数名・ファイル名を表示する', 'which call to print, counted from the current one (0: where the current function was called); with it, `caller` prints the line, the function and the file of that call'))),
});
