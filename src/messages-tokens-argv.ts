import { blankName } from './messages-values';
import type { Text } from './i18n';
import { codeSpan } from './label';
import { tokenText } from './messages-levels';
import type { PlaceholderWith } from './argv/spec';

// What the tokens of the words of a command, as src/explain/argv.ts and its modules read them say.

/** What the characters of a variable's value do where a command reads it as a regex: said by a hole, and by `pattern-from-variable` (src/pitfalls.ts). */
export const REGEX_VALUE_SPECIAL = {
  ja: '値の中の `.`・`*`・`[` などは特別な意味を',
  en: '`.`, `*`, `[` and the like in the value have their special meaning',
};

export const ARGV_TEXTS = {
  /** bazel's `--nostamp` and `-t-` (the parser rule `negation`): the boolean option `name` turned off; `on`, what the option does when it is on. */
  'option-negated': tokenText<{ name: string; on: string }>(({ name, on }) => [
    `\`${name}\` を無効にする（\`${name}\` は「${on}」）`, `Turns \`${name}\` off (\`${name}\` is "${on}")`]),
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
  /**
   * `find . -exec cmd {} \;`, `xargs -I% mv % %.bak`: a word the command around replaces before it runs the other, added to what the word says (`within`:
   * the word holds the text among other text; `what`: with a path, or an item of the input).
   */
  'placeholder-replaced': tokenText<{ text: string; what: PlaceholderWith; by: string; within: boolean }>(({ text, what, by, within }) => [
    `。\`${by}\` が${within ? `語の中の \`${text}\` を` : 'これを'}${what === 'path' ? '見つけたファイルのパス' : '入力の1件'}に置き換えてから、コマンドを実行する`,
    `. \`${by}\` replaces ${within ? `\`${text}\` in it` : 'it'} with ${what === 'path' ? 'the path that was found' : 'the input item'} before it runs the command`]),
  /**
   * `find . -exec sh -c 'echo {}' \;`, `xargs -I% sh -c 'mv % %.bak'`: a part of the string a shell reads where the command around pastes the path or
   * the item first (`whole`: the part is the text alone; else it holds `text`), added to what the part says; the risk is the note's
   * (`placeholder-in-shell-string`), and this says what the reading of the part assumes.
   */
  'placeholder-pasted': tokenText<{ text: string; what: PlaceholderWith; by: string; whole: boolean }>(({ text, what, by, whole }) => [
    `。シェルが文字列を読む前に、\`${by}\` が${whole ? 'ここ' : `この中の \`${text}\` `}を${what === 'path' ? '見つけたファイルのパス' : '入力の1件'}に置き換える（ここでは、空白や記号のない名前として解説）`,
    `. \`${by}\` puts ${what === 'path' ? 'the path that was found' : 'the input item'} ${whole ? 'here' : `in place of \`${text}\` in it`} before the shell reads the string (explained here as a name with no blanks or special characters)`]),
  /**
   * `find . -exec sh -c '…' _ {} \;`, `xargs -I% sh -c '…' _ %`: `$0` (`k` is 0) or `$1`… of the string a shell runs, whose word the command around
   * replaces first (`word`: as written; `within`: it holds the text `text` among other text).
   */
  'string-param-replaced': tokenText<{ via: string; k: number; by: string; text: string; word: string; what: PlaceholderWith; within: boolean }>(({ via, k, by, text, word, what, within }) => {
    const ja = what === 'path' ? '見つけたパス' : '入力の1件';
    const en = what === 'path' ? 'the path it found' : 'the input item';
    const ofJa = `\`${via}\` の文字列`;
    const ofEn = `the \`${via}\` string`;
    if (within) return k === 0 ? [
      `${ofJa}の \`$0\`: そのあとに渡した名前。\`${by}\` が \`${word}\` の中の \`${text}\` を${ja}に置き換えてから渡す（エラーメッセージに出る）`,
      `\`$0\` of ${ofEn}: the name given after it; \`${by}\` replaces \`${text}\` in \`${word}\` with ${en} first (shown in error messages)`] : [
      `位置パラメータ: ${ofJa}への ${k} 番目の引数。\`${by}\` が \`${word}\` の中の \`${text}\` を${ja}に置き換えてから渡す`,
      `Positional parameter: argument #${k} of ${ofEn}; \`${by}\` replaces \`${text}\` in \`${word}\` with ${en} first`];
    return k === 0 ? [
      `${ofJa}の \`$0\`: そのあとに渡した名前。\`${by}\` が \`${word}\` を${ja}に置き換えてから渡す（エラーメッセージに出る）`,
      `\`$0\` of ${ofEn}: the name given after it; \`${by}\` replaces \`${word}\` with ${en} first (shown in error messages)`] : [
      `位置パラメータ: ${ofJa}への ${k} 番目の引数。\`${by}\` が \`${word}\` の代わりに、${ja}を渡す`,
      `Positional parameter: argument #${k} of ${ofEn}; \`${by}\` passes ${en} in place of \`${word}\``];
  }),
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
  /**
   * `grep "$x\\.log" f`, `sed "s/$old/…/"`: a hole (`isHole`, src/embedded/types.ts) in a regex: the sentences not yet said on this line (`holeText`, src/explain/embedded.ts).
   * `special`: what its characters do; `part`: the row says it is a regex, as that of a part with nothing else in it does.
   * `newline`: one ends the pattern too; `patterns`: the command takes one as two patterns.
   */
  'hole-regex': tokenText<{ value: string; special?: boolean; part?: boolean; delimiter?: string; newline?: boolean; perl?: boolean; around?: boolean; patterns?: boolean }>(({ value, special, part, delimiter, newline, perl, around, patterns }) => {
    const ja: string[] = [];
    const en: string[] = [];
    if (special) {
      ja.push(`${part ? '' : `${value} の値は正規表現として読まれる。`}${REGEX_VALUE_SPECIAL.ja}持つ`);
      en.push(`${part ? '' : `The value of ${value} is read as a regex: `}${REGEX_VALUE_SPECIAL.en}`);
    }
    if (delimiter) {
      const close = codeSpan(delimiter);
      ja.push(`値の中の ${close}${newline ? ' と改行' : ''}はパターンをそこで終わらせる`);
      en.push(`A ${close}${newline ? ' or a newline' : ''} in it ends the pattern early`);
    }
    if (perl) {
      ja.push('値の中の `$`・`@` は先に perl が展開する');
      en.push('perl expands `$` and `@` in it first');
    }
    if (around) {
      ja.push(`前後は、値がグループも選択（\`|\`）${patterns ? 'も改行' : ''}も持たない完結した正規表現であるものとして読んでいる`);
      en.push(`What stands around it is read as if the value were a complete regex with no group, no alternation (\`|\`)${patterns ? ' and no newline' : ''} of its own`);
    }
    return [ja.join('。'), en.join('. ')];
  }),
  /** A hole whose kind a hole before it on this line has said (`holeText`). */
  'hole-like': tokenText<{ value: string; like: string }>(({ value, like }) => (value === like
    ? [`${value} の値（同じ読まれ方）`, `The value of ${value}, read the same way`]
    : [`${value} の値（読まれ方は ${like} と同じ）`, `The value of ${value}, read like ${like}`])),
  /** `[$x]`: a hole in a bracket expression. */
  'hole-class': tokenText<{ value: string }>(({ value }) => [
    `${value} の値の文字がこの集合に加わる。値の中の \`]\`・\`-\`・\`^\` は特別な意味を持つ`,
    `The characters of the value of ${value} join the set; \`]\`, \`-\` and \`^\` in it have their special meaning`]),
  /** `$x*`: a quantifier after a hole applies to what the value ends with. */
  'hole-repeat': tokenText<{ value: string; written: string; like?: string }>(({ value, written, like }) => [
    `${codeSpan(written)}: ${value} の値の最後の要素（1文字、文字の集合、グループ）を繰り返す。値全体ではない${like ? '' : `（値が空なら、${value} がないものとして読まれる）`}`,
    `${codeSpan(written)}: repeats the last item of the value of ${value} (a character, a set or a group), not the whole value${like ? '' : ` (with an empty value, it reads as if ${value} were not there)`}`]),
  /** `s/a/$new/`: a hole in the replacement of sed's `s`. */
  'hole-replacement': tokenText<{ value: string; delimiter?: string; part?: boolean }>(({ value, delimiter, part }) => [
    `${part ? '' : `${value} の値は置換後の文字列に入る。`}値の中の \`&\` は一致した部分全体、\`\\\` はエスケープとして読まれ、${codeSpan(delimiter!)} と改行は置換後の文字列をそこで終わらせる`,
    `${part ? '' : `The value of ${value} goes into the replacement: `}\`&\` in ${part ? 'the value' : 'it'} stands for the whole match, \`\\\` starts an escape, and a ${codeSpan(delimiter!)} or a newline ends the replacement early`]),
  /** `s/a/$new/` of perl: its replacement is a double-quoted string. */
  'hole-perl-replacement': tokenText<{ value: string; delimiter?: string; part?: boolean }>(({ value, delimiter, part }) => [
    `${part ? '' : `${value} の値は置換後の文字列に入り、`}perl がダブルクォートの文字列として読む。値の中の \`$\`・\`@\`・\`\\\` は特別な意味を持つ${delimiter ? `。${codeSpan(delimiter)} は置換後の文字列をそこで終わらせる` : ''}`,
    `${part ? 'perl reads' : `The value of ${value} goes into the replacement, which perl reads`} as a double-quoted string: \`$\`, \`@\` and \`\\\` in ${part ? 'the value' : 'it'} are special${delimiter ? `, and a ${codeSpan(delimiter)} ends the replacement early` : ''}`]),
  /** `sed "1i $x"`: a hole in the text of `a`, `i` or `c`. */
  'hole-sed-text': tokenText<{ value: string; part?: boolean }>(({ value, part }) => [
    `${part ? '' : `${value} の値はこのテキストに入る。`}値の中の \`\\\` は sed が読み、改行はテキストをそこで終わらせる（続きは sed のコマンドとして読まれる）`,
    `${part ? '' : `The value of ${value} goes into this text: `}sed reads a \`\\\` in ${part ? 'the value' : 'it'}, and a newline ends the text (what follows is read as sed commands)`]),
  /** `sed -n "${n}p"`: a hole where an address goes; `around`: beside a `,`, where the value cannot be a range. */
  'hole-address': tokenText<{ value: string; around?: boolean }>(({ value, around }) => [
    `${value} の値はアドレスの位置にある（\`3\` は行 3、${around ? '' : '`1,5` は範囲、'}\`/x/\` は正規表現）。sed はこの値をスクリプトの一部として読むので、アドレスでない値なら別のコマンドになる`,
    `The value of ${value} stands where an address goes (\`3\` is line 3, ${around ? '' : '`1,5` a range, '}\`/x/\` a regex). sed reads it as part of the script, so a value that is no address makes another command`]),
  /** `awk "{print \"$x\"}"`: a hole in a string of awk. */
  'hole-awk-string': tokenText<{ value: string }>(({ value }) => [
    `${value} の値は awk の文字列に入る。値の中の \`"\` と改行は文字列をそこで終わらせ、\`\\\` はエスケープとして読まれる`,
    `The value of ${value} goes into an awk string: a \`"\` or a newline in it ends the string, and a \`\\\` starts an escape`]),
  /** `find -name "$p*.txt"`: a hole in a pattern of find. */
  'hole-glob': tokenText<{ value: string }>(({ value }) => [
    `${value} の値はパターンの一部として読まれる。値の中の \`*\`・\`?\`・\`[\` はワイルドカードになり、\`\\\` は次の文字をただの文字にする`,
    `The value of ${value} is read as part of the pattern: \`*\`, \`?\` and \`[\` in it are wildcards, and a \`\\\` makes the next character plain`]),
  /** `bazel build "//$pkg/..."`: a hole in the package's path of a target pattern, after its start (`//`, `@repo//` or a relative directory). */
  'hole-target-package': tokenText<{ value: string }>(({ value }) => [
    `${value} の値はパッケージのパスの一部として読まれる。値の中の \`/\` はディレクトリを区切り、\`:\` はパッケージを終えてターゲットの名前を始め、最後のディレクトリの \`...\` はその下のすべてのパッケージになる`,
    `The value of ${value} is read as part of the package's path: a \`/\` in it separates directories, a \`:\` ends the package and starts the target's name, and \`...\` as the last directory stands for every package below`]),
  /** `bazel build "//app:$t"`: a hole in the target's name, after `:` (bazel 9.3.2: `//app:a:b` is refused, `//app:...` and `//app:sub/x` are names). */
  'hole-target-name': tokenText<{ value: string }>(({ value }) => [
    `${value} の値はターゲットの名前（またはその一部）として読まれる。名前全体が \`all\` ならすべてのルール、\`*\`・\`all-targets\` ならすべてのターゲットになる。値の中の \`/\` は名前の一部で、\`:\` は bazel が拒否する`,
    `The value of ${value} is read as the target's name, or part of it: as the whole name, \`all\` is every rule and \`*\` or \`all-targets\` every target of the package; a \`/\` in it is part of the name, and bazel refuses a \`:\``]),
  /** `buildozer "add deps $dep" //app:main`: a hole in an argument of a command of buildozer, which splits the command at spaces itself. */
  'hole-buildozer': tokenText<{ value: string }>(({ value }) => [
    `${value} の値は buildozer のコマンドの一部になる。buildozer はコマンドを空白と改行で区切るので、値の中の空白で引数が分かれる（\`\\ \` は区切らない）`,
    `The value of ${value} becomes part of buildozer's command, which buildozer splits at spaces and newlines itself: a space in the value starts another argument (a \`\\ \` does not)`]),
  /** `date +"%F $x"`: a hole in date's format. */
  'hole-date': tokenText<{ value: string; around?: boolean }>(({ value, around }) => [
    `${value} の値は表示書式の一部になる。値の中の \`%\` は書式指定として読まれる${around ? '。後ろは、値に `%` がないものとして読んでいる' : ''}`,
    `The value of ${value} is part of the format: a \`%\` in it is read as a conversion${around ? '. What follows is read as if the value held no `%`' : ''}`]),
  /** `printf "%s $x\n" a`: a hole in a format of printf. */
  'hole-printf': tokenText<{ value: string; around?: boolean }>(({ value, around }) => [
    `${value} の値は書式の一部になる。値の中の \`%\` は引数を取る書式指定として、\`\\\` はエスケープとして読まれる${around ? '。後ろは、値に `%` がないものとして読んでいる' : ''}`,
    `The value of ${value} is part of the format: a \`%\` in it is a conversion that takes an argument, and a \`\\\` starts an escape${around ? '. What follows is read as if the value held no `%`' : ''}`]),
  /** `echo -e "a\t$x"`: a hole in a text whose escapes echo reads. */
  'hole-echo': tokenText<{ value: string }>(({ value }) => [
    `${value} の値も出力される。値の中の \`\\\` もエスケープとして読まれる`,
    `The value of ${value} is printed too, with a \`\\\` in it read as an escape`]),
  /** `tr "$from" "$to"`: a hole in a set of tr. `part`: the row names the value. */
  'hole-tr': tokenText<{ value: string; part?: boolean }>(({ value, part }) => [
    `${part ? '' : `${value} の値は文字の集合の一部として読まれる。`}値の中の \`a-z\`・\`[:upper:]\`・\`\\\` も特別な意味を持つ`,
    part ? `\`a-z\`, \`[:upper:]\` and \`\\\` work in the value too` : `The value of ${value} is read as part of the set: \`a-z\`, \`[:upper:]\` and \`\\\` work in it too`]),
  /** `grep "$x\\.log" f`: the first operand starts with a hole, the parser of the command reads such a word as options (`rulesOf`), and no `--` stands before it. */
  'hole-leading-dash': tokenText<{ value: string; command: string }>(({ value, command }) => [
    `${value} の値が \`-\` で始まると、\`${command}\` はこの語をオプションとして読む`,
    `If the value of ${value} starts with \`-\`, \`${command}\` reads this word as options`]),
  /** `sed "$x"`, `awk "{print \$$n}"`: a hole stands where the value decides what the script is. */
  'hole-script': tokenText<{ values: readonly string[]; command: string; data?: string }>(({ values, command, data }) => [
    `スクリプトの内容は ${values.join('・')} の値で決まる: \`${command}\` はその値をコードとして読む${data ? `。値をデータとして渡すには ${data} を使う` : ''}`,
    `What this script does depends on the value of ${values.join(', ')}: \`${command}\` reads it as code${data ? `. To pass a value as data, use ${data}` : ''}`]),
  /** `sed "s/\\./x/"`: bash took the backslash of each escape in `taken` (`\$`) away before the text was read. */
  'embedded-backslash-removed': tokenText<{ taken: readonly string[] }>(({ taken }) => {
    const list = taken.map((e) => `${codeSpan(e)} → ${codeSpan([...e][1])}`).join(', ');
    return [
      `先にシェルがバックスラッシュを取り除いている: ${list}`,
      `bash has already removed the backslash: ${list}`];
  }),
  /** `sort -t"|"`: the value is written with quotes (`val`: what it is without them). */
  'option-value-unquoted': tokenText<{ val: string }>(({ val }) => [
    `（クォートを外すと${blankName(val, true) ?? ` \`${val}\``}）`,
    ` (${blankName(val, false) ?? `\`${val}\``} after quote removal)`]),
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
