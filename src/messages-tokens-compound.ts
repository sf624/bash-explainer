import { lineLabel, ordinal, type Text } from './i18n';
import { tokenText } from './messages-levels';
import { syntaxErrorWhat, type SyntaxErrorWhat } from './messages-syntax';

// What the tokens of the compound commands, tests, lists, redirections and the rest of src/explain/ say.

/** The part of a list's separator or end that says what bash waits for (`a; b`: the end of `a`; `coproc a; b`: nothing). */
const waitJa = ({ what, gap, co }: { what: string; gap: string; co?: string }): string =>
  co ? `\`coproc\` がバックグラウンドで実行する ${co} は待たない` : `${what}${gap}の終了を待つ`;
const waitEn = ({ what, co }: { what: string; co?: string }): string =>
  co ? `do not wait for ${co}, which \`coproc\` runs in the background` : `wait for ${what} to end`;

/** What a list's `;` says before a reserved word (`if a; then`): the list ends there. */
const endBefore = (p: { what: string; gap: string; co?: string; closer: string }): readonly [ja: string, en: string] => [
  p.co ? `\`${p.closer}\` の前でリストを終え、${waitJa(p)}` : `\`${p.closer}\` の前でリストを終える`,
  p.co ? `End of the list before \`${p.closer}\`: ${waitEn(p)}` : `End of the list before \`${p.closer}\``];

export const COMPOUND_TEXTS = {
  /** `do … done`: the body of a loop, which is no command of its own. */
  'loop-body': tokenText(() => [
    'ループ本体: `do` から `done` までを繰り返し実行する',
    'Loop body: the commands between `do` and `done`']),
  // The words of the shell.
  /** `{ cd /x; } | cat`: a group that runs in a subshell. */
  'group-start-subshell': tokenText(() => [
    'コマンドグループの開始（ここではサブシェルで実行される）',
    'Start of a command group (here it runs in a subshell)']),
  /** `error`: a part the parser could not read (`echo "a`). */
  'not-parsed': tokenText(() => [
    '構文エラー: この部分は正しく解析できませんでした（クォートや括弧の閉じ忘れなど）',
    'Syntax error: this part could not be parsed (unclosed quote or bracket?)']),
  /** `echo ok )`: what the shell stops at, in a script where that is known (`syntaxFault`): in the words of the problem. */
  'syntax-error-here': tokenText<{ what: SyntaxErrorWhat }>(({ what }) => {
    const [ja, en] = syntaxErrorWhat(what);
    return [`構文エラー: ${ja}`, `Syntax error: ${en}`];
  }),
  // Comments.
  /** `# bash-explainer disable-file SC2086`: a directive for the whole file. */
  'comment-directive-file': tokenText<{ codes: string }>(({ codes }) => [
    `Bash Explainer への指示コメント: このファイル全体で警告 ${codes} を出さない`,
    `Bash Explainer directive: no ${codes} warnings in this file`]),
  /** `# bash-explainer disable-next-line SC2086`, or after a command on its line (`inline`). */
  'comment-directive-line': tokenText<{ codes: string; inline: boolean }>(({ codes, inline }) => [
    `Bash Explainer への指示コメント: ${inline ? 'この行' : '次の行'}で警告 ${codes} を出さない`,
    `Bash Explainer directive: no ${codes} warnings on ${inline ? 'this' : 'the next'} line`]),
  /** `# shellcheck disable=SC2086`. */
  'comment-shellcheck': tokenText(() => [
    'ShellCheck への指示コメント（警告の抑制など）',
    'ShellCheck directive (e.g. disable a warning)']),
  /** `# a comment`. */
  'comment-plain': tokenText(() => [
    'コメント: `#` から行末までは実行されない',
    'Comment: everything after `#` is ignored']),
  // Function definitions and co-processes.
  /** `f() { …; }`: the name of the function. */
  'function-name': tokenText(() => ['関数名', 'Function name']),
  /** `f() { echo; }`, with a redirection after the body (`redirected`), and the line it is on (`lineRef`). */
  'function-definition': tokenText<{ name: string; redirected: boolean; lineRef: string }>(({ name, redirected, lineRef }) => [
    `関数 \`${name}\` の定義: 以後 \`${name}\` をコマンドのように呼び出せる（引数は関数内で $1, $2… になる）${redirected ? '。本体のあとのリダイレクトは、定義した時ではなく関数を呼ぶたびに適用される' : ''}${lineRef}`,
    `Defines function \`${name}\`; call it like a command (arguments become $1, $2…)${redirected ? '. The redirection after the body is applied each time the function is called, not when it is defined' : ''}${lineRef}`]),
  /** `coproc NAME { cmd; }`: the name of the co-process. */
  'coproc-name': tokenText<{ arr: string }>(({ arr }) => [
    `コプロセスの名前: 配列 \`${arr}\` と変数 \`${arr}_PID\` の名前になる`,
    `Name of the co-process: names the array \`${arr}\` and the variable \`${arr}_PID\``]),
  /** `coproc NAME { cmd; }`. */
  'coproc-statement': tokenText<{ arr: string; lineRef: string }>(({ arr, lineRef }) => [
    `\`coproc\`: コマンドをバックグラウンドのコプロセスとして実行し、その出力と入力につながるファイルディスクリプタを配列 \`${arr}\` に入れる（\`\${${arr}[0]}\` はコプロセスの出力を読む側、\`\${${arr}[1]}\` はその入力に書く側）。プロセス ID は \`${arr}_PID\`${lineRef}`,
    `\`coproc\`: runs the command in the background as a co-process and puts the descriptors connected to its output and input in the array \`${arr}\` (\`\${${arr}[0]}\` reads its output, \`\${${arr}[1]}\` writes to its input). Its process ID is \`${arr}_PID\`${lineRef}`]),
  // Loops and `case`.
  /** `select x in a b; do …; done`: the variable. */
  'select-variable': tokenText(() => [
    '選んだ単語が入る変数: 入力した番号の単語（メニューの番号でない行なら空文字列）',
    'Variable set to the chosen word: the one whose number is typed (an empty string when the line is not one of the numbers)']),
  /** `for x in a b; do …; done`: the variable. */
  'for-variable': tokenText(() => [
    'ループ変数: 繰り返しごとに次の値が入る',
    'Loop variable: receives the next value on each iteration']),
  /** `for x in "$a" b`: a word of the list (`what`: its own explanation). */
  'for-value': tokenText<{ what: string }>(({ what }) => [`繰り返す値: ${what}`, `Value to iterate: ${what}`]),
  /** `case "$x" in …`: the value (`what`: its own explanation). */
  'case-value': tokenText<{ what: string }>(({ what }) => [`照合する値: ${what}`, `Value to match: ${what}`]),
  /** `case $x in`: the `in`. */
  'case-in': tokenText(() => [
    '値の後に、パターンごとの分岐を並べる',
    'Introduces the list of pattern branches']),
  /** `case $x in a) …;; esac`, or `case` alone (`value` empty). */
  'case-statement': tokenText<{ value: string }>(({ value }) => [
    `case 文: ${value ? `\`${value}\` ` : '値（まだ書かれていない）'}を各パターンと上から順に照合し、最初に一致した分岐を実行`,
    `case statement: match ${value ? `\`${value}\`` : 'the value (not written yet)'} against each pattern in order and run the first match`]),
  /** `a | b`. */
  'pipeline': tokenText(() => [
    `パイプライン: 各コマンドの標準出力を次のコマンドの標準入力につないで、同時に実行する`,
    `Pipeline: each command's stdout feeds the next command's stdin; they run concurrently`]),
  // Lists.
  /** `sleep 1 &`: the part before the `&` (`what`) runs in the background; `gap` is the space before a Japanese particle. */
  'list-background': tokenText<{ what: string; gap: string; next: boolean }>(({ what, gap, next }) => [
    `${what}${gap}をバックグラウンドで実行する: シェルはサブシェルで非同期に実行し、終了を待たずに${next ? '次へ' : '先へ'}進む（終了ステータスは 0）`,
    `Run ${what} in the background: the shell runs it asynchronously in a subshell and goes on${next ? ' to the next' : ''} without waiting (the status is 0)`]),
  /** `a; b`, or `coproc a; b` (`co`: the coprocess's command, which the shell does not wait for). */
  'list-separator': tokenText<{ what: string; gap: string; co?: string }>((p) => [
    p.co ? `区切り: \`coproc\` がバックグラウンドで実行する ${p.co} は待たずに、次を実行する` : `区切り: ${p.what}${p.gap}の終了を待ってから、次を実行する`,
    `Separator: ${waitEn(p)}, then run the next`]),
  /** `a;` at the end of a script. */
  'list-end': tokenText<{ what: string; gap: string; co?: string }>((p) => [`リストの終わり: ${waitJa(p)}`, `End of the list: ${waitEn(p)}`]),
  /** `if a; then`: the `;` is needed, since `then` after the words of a command would be one more word. */
  'list-end-before-words': tokenText<{ what: string; gap: string; co?: string; closer: string }>((p) => {
    const [ja, en] = endBefore(p);
    return [`${ja}（ここに \`;\` か改行がないと、\`${p.closer}\` は予約語として読まれない）`, `${en} (without a \`;\` or a newline here, \`${p.closer}\` would not be read as a reserved word)`];
  }),
  /** `{ coproc cat; }`: bash reads a reserved word after `coproc` and one word. */
  'list-end-before-coproc': tokenText<{ what: string; gap: string; co?: string; closer: string }>((p) => {
    const [ja, en] = endBefore(p);
    return [`${ja}（\`coproc\` と単語1つの後では bash が予約語を読むので、ここでは省いてもよい）`, `${en} (bash reads a reserved word after \`coproc\` and one word, so it may be left out here)`];
  }),
  /** `if [[ a ]]; then`: after a compound command bash reads the reserved word at once. */
  'list-end-before-compound': tokenText<{ what: string; gap: string; co?: string; closer: string }>((p) => {
    const [ja, en] = endBefore(p);
    return [`${ja}（複合コマンドの後では bash が \`${p.closer}\` を予約語として読むので、省いてもよい）`, `${en} (it may be left out: after a compound command, bash reads \`${p.closer}\` as a reserved word)`];
  }),
  // Redirections.
  /** `f() { …; } >&2`, `(…) >log`: a redirection of the whole (`target`: the text of the command, cut; `ofFunction`: a function's). */
  'redirect-whole': tokenText<{ target?: string; ofFunction: boolean }>(({ target, ofFunction }) => [
    `入出力のリダイレクト: ${target !== undefined ? `\`${target}\` 全体` : 'コマンド'}の入出力を切り替える${ofFunction ? '。関数に付けたリダイレクトは関数と一緒に保存され、関数を呼ぶたびに適用される' : ''}`,
    `Redirection applied to ${target !== undefined ? `\`${target}\` as a whole` : 'the command'}${ofFunction ? '. A redirection on a function is stored with it and applied each time the function is called' : ''}`]),
  /** `while read l; do …; done < in`: a redirection after the closing word (`kind`: what it applies to; `num`: the descriptor). */
  'redirect-whole-construct': tokenText<{ kind: Text; reads: boolean; writes: boolean; num: number }>(({ kind, reads, writes, num }) => [
    `。${kind.ja}全体に付いている: 中のコマンドすべてに働く${reads ? '（標準入力を読むコマンド、たとえば `read` は、ここから読む。同じ入力を分け合うので、1つが読んだ分は次のコマンドには届かない）' : writes ? `（中のコマンドが${num === 1 ? '標準出力' : '標準エラー出力'}に出すものはここに出る）` : ''}`,
    `. It applies to the whole ${kind.en}: every command in it${reads ? ' that reads stdin, such as `read`, reads from here; they share this one input, so what one reads is not left for the next' : writes ? ` has its ${num === 1 ? 'stdout' : 'stderr'} sent here` : ' is affected'}`]),
  /** `cat <<` while typing (`op`: the operator; `to`: where the text goes). */
  'heredoc-no-delimiter': tokenText<{ op: string; to: string }>(({ op, to }) => [
    `ヒアドキュメント \`${op}\`: 区切り語がまだない。次の行から区切り語だけの行までを${to}として渡す`,
    `Here-document \`${op}\`: the delimiter is not written yet. The following lines up to a line containing only the delimiter become ${to}`]),
  /** `cat <<< a < f`: a here-string that a later redirection of the same descriptor replaces (`later`: it). */
  'herestring-replaced': tokenText<{ to: string; later: string }>(({ to, later }) => [
    `ヒアストリング \`<<<\`: 続く文字列（末尾に改行が付く）。${to}として開かれるが、後の \`${later}\` が続けて${to}を置き換えるので、コマンドはこれを読まない`,
    `Here-string \`<<<\`: the following word (plus a newline), opened as ${to}; but the later \`${later}\` then replaces ${to}, so the command does not read it`]),
  /** `cat <<< word`. */
  'herestring': tokenText<{ to: string }>(({ to }) => [
    `ヒアストリング \`<<<\`: 続く文字列（末尾に改行が付く）を${to}として渡す`,
    `Here-string \`<<<\`: the following word (plus a newline) becomes ${to}`]),
  // Strings read as scripts and strings of a host.
  /** `bash -c $'a\nb'`: a line of the string. */
  'script-string-line': tokenText<{ line: number }>(({ line }) => [`文字列の${lineLabel('ja', line)}`, `${lineLabel('en', line)} of the string`]),
  /** `eval "$x"`: a string read and run again. */
  'script-run-again': tokenText(() => ['もう一度読んで実行する文字列', 'Text to read and run again']),
  /** A word of a host's string no shell reads (`word`: how the host calls it). */
  'host-string-word': tokenText<{ word: readonly [string, string]; value: string; pictures: string | undefined }>(({ word, value, pictures }) => [
    `${word[0]}: \`${value}\` がそのまま1つの単語としてコマンドに渡る${pictures ? `（制御文字は記号で表している: ${pictures}）` : ''}。先にシェルが \`$\`・\`*\`・クォート・空白を読むことはない`,
    `${word[1]}: \`${value}\` goes to the command as one word, as it is${pictures ? ` (control characters are shown as symbols: ${pictures})` : ''}. No shell reads its \`$\`, \`*\`, quotes or spaces first`]),
  // `$'…'` strings.
  /** `$'a\'b'` in dash: its quote ends at the `\'`. */
  'ansi-c-dash-quote-ends': tokenText(() => [
    'bash・ksh・zsh の `$\'…\'` 文字列だが、dash にはこの書き方がない。dash では `$` はただの文字で、`\'…\'` はシングルクォートの文字列だが、その引用は `\\\'` で終わり、その後の `\'` から別の引用が始まる',
    'A bash, ksh and zsh `$\'…\'` string, which dash does not have: in dash, `$` is plain text and `\'…\'` a single-quoted string, but that quote ends at the `\\\'`, and the `\'` after it opens another quoted string']),
  /** `$'a\n'` in dash (`escapes`: it has a backslash). */
  'ansi-c-dash': tokenText<{ escapes: boolean }>(({ escapes }) => [
    `bash・ksh・zsh の \`$'…'\` 文字列だが、dash にはこの書き方がない。dash では \`$\` はただの文字で、\`'…'\` はシングルクォートの文字列${escapes ? 'なので、エスケープは書いたまま残る' : 'になる'}`,
    `A bash, ksh and zsh \`$'…'\` string, which dash does not have: in dash, \`$\` is plain text and \`'…'\` a single-quoted string${escapes ? ', so the escapes stay as written' : ''}`]),
  /** `$'a'` in another POSIX shell. */
  'ansi-c-not-posix': tokenText(() => [
    'bash・ksh・zsh の `$\'…\'` 文字列（エスケープを解釈した文字列になる）だが、POSIX sh のすべてにあるわけではない。dash では `$` はただの文字で、`\'…\'` はシングルクォートの文字列になる',
    'A bash, ksh and zsh `$\'…\'` string (backslash escapes are interpreted), which not every POSIX sh has: in dash, `$` is plain text and `\'…\'` a single-quoted string']),
  /** `$'a\n'` in bash. */
  'ansi-c-string': tokenText(() => [
    '`$\'…\'` 文字列: `\\n` `\\t` などのエスケープを解釈した文字列になる',
    '`$\'…\'` string: backslash escapes such as `\\n` are interpreted']),
  // Assignments.
  /** `a=1 b=2`: several assignments. */
  'assignments-several': tokenText(() => ['複数の変数への代入', 'Several variable assignments']),
  /** `x=$y` and the like: the value of an assignment. */
  'assignment-value': tokenText<{ value: string }>(({ value }) => [`代入する値 \`${value}\``, `Value \`${value}\``]),
  // Brace expansions of sequences.
  /** `{1..9}`: the start. */
  'brace-start': tokenText<{ x: string }>(({ x }) => [`開始: \`${x}\``, `Start: \`${x}\``]),
  /** `{1..9}`: the end. */
  'brace-end': tokenText<{ y: string }>(({ y }) => [`終わり: \`${y}\``, `End: \`${y}\``]),
  /** `{1..9..2}`: the increment of numbers (`down`: counting down; `sign`: the note on a sign or a 0). */
  'brace-increment-numbers': tokenText<{ z: string; step: bigint; down: boolean; sign: string }>(({ z, step, down, sign }) => [
    `増分: \`${z}\`（単語ごとに ${step} ${down ? '減る' : '増える'}）${sign}`,
    `Increment: \`${z}\` (each word is ${step} ${down ? 'less' : 'more'} than the one before)${sign}`]),
  /** `{a..z..2}`: the increment of letters. */
  'brace-increment-letters': tokenText<{ z: string; step: bigint; down: boolean; sign: string }>(({ z, step, down, sign }) => [
    `増分: \`${z}\`（${step} 文字ごとに${down ? '逆向きに' : ''}進む）${sign}`,
    `Increment: \`${z}\` (${step === 1n ? 'each letter' : `every ${ordinal(step)} letter`}, counting ${down ? 'down' : 'up'})${sign}`]),
  // Tests and arithmetic.
  /** `[[ =~ a.c ]]`: a regular expression. */
  'regex-ere': tokenText(() => ['正規表現（拡張正規表現 ERE）', 'Regular expression (extended, ERE)']),
  /** `[[ $a && -n`, while typing: no operand yet. */
  'test-unary-missing': tokenText<{ op: string }>(({ op }) => [
    `単項演算 \`${op}\`: 対象がまだ書かれていない`,
    `Unary operator \`${op}\`: the operand is not written yet`]),
  /** `[[ ! -f a ]]`. */
  'test-negation': tokenText<{ operand: string }>(({ operand }) => [
    `否定: \`${operand}\` が偽なら真`,
    `Negation: true if \`${operand}\` is false`]),
  /** `[[ -f a ]]` (`what`: what the operator tests, in the line's language). */
  'test-unary': tokenText<{ operand: string; what: string }>(({ operand, what }) => [
    `条件: \`${operand}\` が${what}`,
    `Condition: \`${operand}\` ${what}`]),
  /** `$((-a))`. */
  'arith-unary': tokenText<{ op: string }>(({ op }) => [`算術の単項演算 \`${op}\``, `Arithmetic unary operator \`${op}\``]),
  /** `$((1 +))`: an operator with no operand (`abandons`: in an expansion, which abandons the command of the script). */
  'arith-operand-missing': tokenText<{ op: string; abandons: boolean }>(({ op, abandons }) => [
    `算術式の構文エラー: \`${op}\` の後ろに被演算子がない。bash は \`syntax error: operand expected\` と表示し${abandons ? '、それを含むスクリプトのコマンドの残り（この行、または囲む繰り返しや関数呼び出し）を中断する（終了ステータス 1。POSIX モードではスクリプトが終了する）' : '、このコマンドは失敗する（終了ステータス 1）'}`,
    `Arithmetic syntax error: \`${op}\` has no operand after it. bash says \`syntax error: operand expected\`${abandons ? ', and abandons the rest of the command of the script it is in (the line, or the loop or function call around it), status 1 (in POSIX mode, a script ends there)' : ', and the command fails (status 1)'}`]),
  /** `[[ $a == b ]]` (`text`: what the operator does; `num`: a note on numbers). */
  'test-binary': tokenText<{ left: string | undefined; right: string; text: string; num: string }>(({ left, right, text, num }) => [
    `条件: \`${left}\` と \`${right}\` を比較 — ${text}${num}`,
    `Condition: \`${left}\` vs \`${right}\` — ${text}${num}`]),
  /** `$((a = 1))`. */
  'arith-assignment': tokenText<{ left: string | undefined; op: string; right: string }>(({ left, op, right }) => [
    `算術代入: \`${left}\` ${op} \`${right}\``,
    `Arithmetic assignment: \`${left}\` ${op} \`${right}\``]),
  /** `$((a + 1))`. */
  'arith-binary': tokenText<{ left: string | undefined; op: string; right: string }>(({ left, op, right }) => [
    `算術演算: \`${left}\` ${op} \`${right}\``,
    `Arithmetic: \`${left}\` ${op} \`${right}\``]),
  /** `$((a ? 1 : 2))`. */
  'arith-ternary': tokenText(() => ['三項演算子: 条件 ? 真のときの値 : 偽のときの値', 'Ternary: cond ? if-true : if-false']),
  /** `$((i++))` (`increment`: `++`, not `--`). */
  'arith-postfix': tokenText<{ text: string; increment: boolean }>(({ text, increment }) => [
    `算術: \`${text}\`（${increment ? '1 増やす' : '1 減らす'}）`,
    `Arithmetic: \`${text}\` (${increment ? 'increment' : 'decrement'})`]),
  /** `$(( (a) ))`. */
  'arith-parenthesized': tokenText(() => ['括弧でまとめた式', 'Parenthesized expression']),
};
