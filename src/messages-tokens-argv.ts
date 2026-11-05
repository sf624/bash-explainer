import type { Text } from './i18n';
import { tokenText } from './messages-levels';

// What the tokens of the words of a command, as src/explain/argv.ts and its modules read them say.

export const ARGV_TEXTS = {
  /** `$opts` as an option word: its expansion is read by the command as options. */
  'option-open': tokenText(() => [
    '実行時に決まるオプション（展開した結果を、コマンドがオプションとして読む）',
    'Options known only at run time (the command reads what the expansion gives as options)']),
  /** `find . -exec cmd {} +`: the `+` that ends `-exec` (`of`). */
  'find-exec-end-batch': tokenText<{ of: string }>(({ of }) => [
    `\`${of}\` の終わり: 見つかったファイルをまとめて1回のコマンドに渡す`,
    `End of \`${of}\`: pass all matches to one command invocation`]),
  /** `find . -exec cmd {} \;`: the `;` that ends `-exec` (`escaped`: a shell reads the word, so the `;` has to be escaped from it). */
  'find-exec-end-each': tokenText<{ of: string; escaped: boolean }>(({ of, escaped }) => [
    `\`${of}\` の終わり: 見つかったファイル1件ごとにコマンドを実行${escaped ? '（\`;\` はシェルに解釈されないようエスケープが必要）' : ''}`,
    `End of \`${of}\`: run once per match${escaped ? ' (\`;\` must be escaped from the shell)' : ''}`]),
  /** `find . -exec cmd {} \;`: the `{}` that find replaces with each path. */
  'find-exec-placeholder': tokenText(() => [
    '`{}`: 見つかったファイルのパスに置き換わる',
    '`{}`: replaced with the path that was found']),
  /** `find . \( -a -o -b \)`: the group as a whole. */
  'find-group': tokenText(() => [
    'グループ: 括弧の中を先にまとめて評価する',
    'Group: evaluated as one condition']),
  /** `find . ! -name a`: the `!`. */
  'find-not': tokenText(() => [
    '`!`: 直後の条件を否定する',
    '`!`: negates what follows']),
  /** `find . \( -name a \)`: the opening `\(`. */
  'find-group-open': tokenText(() => [
    '`\\(`: グループの開始（シェルに解釈されないよう `\\` でエスケープする）',
    '`\\(`: start of a group (escaped so the shell leaves it alone)']),
  /** `find . \( -name a \)`: the closing `\)`. */
  'find-group-close': tokenText(() => [
    '`\\)`: グループの終わり',
    '`\\)`: end of the group']),
  /** `git remote add x y`: an argument that is a subcommand's word, where no shell reads the words (Docker's exec form). */
  'subcommand-argument-no-shell': tokenText<{ command: string }>(({ command }) => [
    `（シェルを通さずに \`${command}\` が受け取る引数で、\`${command}\` 自身が解釈する）`,
    ` (an argument \`${command}\` gets with no shell in between, and interprets itself)`]),
  /** `git remote add x y`: the subcommand `remote` is, to the shell, an argument. */
  'subcommand-argument-shell': tokenText<{ command: string }>(({ command }) => [
    `（シェルから見れば \`${command}\` への引数で、\`${command}\` 自身が解釈する）`,
    ` (to the shell it is an argument to \`${command}\`, which interprets it itself)`]),
  /** `git remote add x y`: the subcommand's label, before its summary. */
  'subcommand-label': tokenText<{ command: string }>(({ command }) => [
    `サブコマンド \`${command}\`: `,
    `Subcommand \`${command}\`: `]),
  /** `declare -g v`: the option has no text of its own. */
  'option-plain': tokenText(() => ['オプション', 'Option']),
  /** `ls -- -x`: the `--`. */
  'option-end-of-options': tokenText(() => [
    'オプションの終わり: 以降は `-` で始まっていても通常の引数として扱う',
    'End of options: everything after is a plain argument']),
  /** `ls -lah`: short options written together (`labels`: the options, in quotes). */
  'option-combined-short': tokenText<{ labels: string }>(({ labels }) => [
    `短いオプション ${labels} をまとめて指定`,
    `Combined short options ${labels}`]),
  /** `sort --key=3`: the value after `=`, with what the spec knows of it (`known`: its meaning, if any). */
  'option-equals-value': tokenText<{ val: string; known?: string }>(({ val, known }) => [
    `（値: \`${val}\`${known ? ' — ' + known : ''}）`,
    ` (value: \`${val}\`${known ? ' — ' + known : ''})`]),
  /** `sed -pie`: the rest of the word is the value of `-i`, and is also an option letter. */
  'option-attached-value-trap': tokenText<{ val: string; flag: string }>(({ val, flag }) => [
    `。注意: \`${val}\` は別のオプションではなく \`${flag}\` の値として扱われる`,
    `. Note: \`${val}\` is taken as the value of \`${flag}\`, not as more options`]),
  /** `sed -i.bak`: the value that only attaches to the option. */
  'option-attached-value': tokenText<{ flag: string; val: string }>(({ flag, val }) => [
    `\`${flag}\` の値 \`${val}\``,
    `Value \`${val}\` for \`${flag}\``]),
  /** `sort -k3`, `jq --arg n v`: the value of the option `flag`. */
  'option-value-for': tokenText<{ flag: string }>(({ flag }) => [
    `\`${flag}\` の値`,
    `Value for \`${flag}\``]),
  /** `jq --arg n v`: the name that `--arg` takes. */
  'option-name-for': tokenText<{ flag: string }>(({ flag }) => [
    `\`${flag}\` の名前`,
    `Name for \`${flag}\``]),
  /** `jq --arg n v`: the name is used in the filter with a `$`. */
  'option-name-filter-hint': tokenText(() => [
    '（フィルタでは `$` を付けて使う）',
    ' (use it as `$name` in the filter)']),
  /** `sed "s/\\./x/"`: bash took the backslash of each escape in `taken` (`\$`) away before the command read its text. */
  'embedded-backslash-removed': tokenText<{ taken: readonly string[] }>(({ taken }) => {
    const list = taken.map((e) => `\`${e}\` → \`${e[1]}\``).join(', ');
    return [
      `シェルが先にバックスラッシュを取り除くので、コマンドに渡る文字は ${list} になる`,
      `bash removes the backslash before the command gets the text: ${list}`];
  }),
  /** `sort -t"|"`: the value is written with quotes (`val`: what it is without them). */
  'option-value-unquoted': tokenText<{ val: string }>(({ val }) => [
    `（クォートを外すと \`${val}\`）`,
    ` (\`${val}\` after quote removal)`]),
  /** `env FOO=1 cmd`: the assignment `FOO=1` is for the command's environment. */
  'operand-env-assignment': tokenText<{ name: string }>(({ name }) => [
    `環境変数 \`${name}\` の設定（実行するコマンドの環境にだけ入る）`,
    `Sets the variable \`${name}\` for the command to run`]),
  /** `kill %1`: a job spec (`job`: what it stands for). */
  'operand-job-spec': tokenText<{ job: Text }>(({ job }) => [
    `ジョブ指定: ${job.ja}`,
    `Job spec: ${job.en}`]),
  /** `export 1x`: bash refuses the word as a name. */
  'declare-invalid-name': tokenText(() => [
    'bash はこの語を受け付けない: 変数の名前として正しくない（「not a valid identifier」で終了ステータス 1）',
    'Bash refuses this word: it is not a valid variable name ("not a valid identifier", status 1)']),
  /** `declare -f name`: the word names a function. */
  'declare-function-target': tokenText<{ name: string }>(({ name }) => [
    `関数 \`${name}\` を対象にする`,
    `Function \`${name}\``]),
  /** `declare name`: the word names a variable. */
  'declare-variable-target': tokenText<{ name: string }>(({ name }) => [
    `変数 \`${name}\` を対象にする`,
    `Variable \`${name}\``]),
  /** `command declare a=1` in POSIX mode: bash expands the word as an assignment (`what`: the assignment, in words). */
  'declare-assignment-posix': tokenText<{ what: string; command: string }>(({ what, command }) => [
    `${what}（\`${command}\` がこの語を代入として読む）。POSIX モードの bash は、\`command\` の後でもこの語を代入として展開する（単語分割もグロブ展開もしない）`,
    `${what} (\`${command}\` reads the word as an assignment). In POSIX mode, bash expands it as an assignment after \`command\` too (no word splitting or globbing)`]),
  /** `sudo declare a=1`: the command reads the word as an assignment, bash as an argument (`split`: the word is split and globbed). */
  'declare-assignment-argument': tokenText<{ what: string; command: string; split: boolean }>(({ what, command, split }) => [
    `${what}（\`${command}\` がこの語を代入として読む）。ただし bash にとっては普通の引数で、代入ではない（コマンド名が \`${command}\` そのものではないため）${split ? '。クォートしない展開は単語分割とグロブ展開を受ける' : ''}`,
    `${what} (\`${command}\` reads the word as an assignment). To bash it is an ordinary argument, not an assignment, since the command name is not \`${command}\` itself${split ? ': an unquoted expansion in it is split and globbed' : ''}`]),
  /** `find . -exec ls {} \;`: the command `-exec` runs, before its explanation. */
  'wrapped-command-to-run': tokenText(() => [
    '実行するコマンド: ',
    'Command to run: ']),
  /** `sudo ls`: what the wrapped command's token says first (`name`: the program). */
  'wrapped-runs': tokenText<{ name: string }>(({ name }) => [
    `\`${name}\` を実行: `,
    `runs \`${name}\`: `]),
  /** `[ -f a ]`: the last `]`. */
  'test-last-bracket': tokenText(() => [
    '`[` に渡す最後の引数。`[` はこれで式の終わりを確かめる（ないとエラー）',
    'The last argument passed to `[`. `[` checks it to find the end of the expression (without it, an error)']),
};
