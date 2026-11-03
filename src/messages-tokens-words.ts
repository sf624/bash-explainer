import type { Text } from './i18n';
import { plainOf, tokenText } from './messages-levels';

// What the tokens of words and expansions (src/explain/words.ts) say.

export const WORD_TEXTS = {
  /** `ls a[$x]`: the `]` of a bracket expression that an expansion opens (`closes`: the text of the part that opens it). */
  'glob-bracket-closes': tokenText<{ closes: string }>(({ closes }) => [
    `\`]\` は \`${closes}\` の \`[…]\` の終わり`,
    `\`]\` closes the \`[…]\` of \`${closes}\``]),
  /** `ls [$x]!`: the `[!` or `[^` that opens a negated bracket expression (`mark`: the `[` and the negation, `opens`: the part that closes it). */
  'glob-bracket-opens-negated': tokenText<{ mark: string; opens: string }>(({ mark, opens }) => [
    `\`${mark}\` は \`${opens}\` の \`[…]\` の始まり: 間にある文字（展開した値の文字も含む）以外の1文字に一致する`,
    `\`${mark}\` opens the \`[…]\` of \`${opens}\`: it matches any one character except those between, the characters the expansions give included`]),
  /** `ls [$x`: the `[` that opens a bracket expression an expansion closes. */
  'glob-bracket-opens': tokenText<{ opens: string }>(({ opens }) => [
    `\`[\` は \`${opens}\` の \`[…]\` の始まり: 間にある文字（展開した値の文字も含む）のどれか1文字に一致する`,
    `\`[\` opens the \`[…]\` of \`${opens}\`: it matches one character of those between, the characters the expansions give included`]),
  /** `echo hello`, `ls ~`: a word that stays as it is, or that is only a tilde expansion, as an operand. */
  'word-plain': tokenText<{ text: string }>(({ text }) => [
    `文字列 \`${text}\``,
    `Word \`${text}\``]),
  /** `echo $"hello"`: a string translated by the locale. */
  'string-locale': tokenText(() => [
    '`$"…"` 文字列: ロケールに応じて翻訳される文字列（翻訳がなければそのまま。中の変数は展開される）',
    '`$"…"` string: translated according to the locale (as it is when there is no translation; variables inside expand)']),
  /** `echo "a$@b"`: a double-quoted string with `$@` or `${a[@]}` and text beside it. */
  'string-double-per-element-with-text': tokenText(() => [
    'ダブルクォート文字列: 中の `$変数` や `$(…)` は展開され、単語分割やグロブ展開はされない。ただし `"$@"` や `"${配列[@]}"` は、クォートの中でも要素ごとに別々の単語になる。前の文字列は最初の要素に、後ろの文字列は最後の要素にくっつく（要素が無ければ文字列だけで1つの単語になる）',
    'Double-quoted string: `$vars` and `$(…)` expand, with no word splitting or globbing. But `"$@"` and `"${array[@]}"` still give one word per element, even inside the quotes: the text before joins the first element, and the text after the last (with no elements, the text alone makes one word)']),
  /** `echo "$@"`: a double-quoted string that gives one word per element. */
  'string-double-per-element': tokenText(() => [
    'ダブルクォート文字列: 中の `$変数` や `$(…)` は展開され、単語分割やグロブ展開はされない。ただし `"$@"` や `"${配列[@]}"` は、クォートの中でも要素ごとに別々の単語になる（要素が無ければ単語は0個）',
    'Double-quoted string: `$vars` and `$(…)` expand, with no word splitting or globbing. But `"$@"` and `"${array[@]}"` still give one word per element, even inside the quotes (no word at all when there are none)']),
  /** `echo "$x"`: a double-quoted string. */
  'string-double': tokenText(() => [
    'ダブルクォート文字列: 中の `$変数` や `$(…)` は展開されるが、単語分割やグロブ展開はされない（1つの引数のまま）',
    'Double-quoted string: `$vars` and `$(…)` expand, but no word splitting or globbing (stays one argument)']),
  /** `echo {a,b}$x`: a brace expansion whose words are not known. */
  'brace-expansion-many': tokenText<{ text: string }>(({ text }) => [
    `ブレース展開: \`${text}\` は多くの単語に展開される`,
    `Brace expansion: \`${text}\` expands to many words`]),
  /**
   * `echo {a,b}`: a brace expansion (`list`: the words in code spans; `later`, `refused` and `fails`: sentences in the line's
   * language that follow it, or empty; `comma`: an escaped comma; `pad`: a number padded with zeros).
   */
  'brace-expansion-words': tokenText<{ text: string; count: number; list: string; later: string; comma: boolean; pad: boolean; refused: string; fails: string }>(
    ({ text, count, list, later, comma, pad, refused, fails }) => [
      `ブレース展開: \`${text}\` は ${count} 個の単語 ${list} に展開される${later}${comma ? '（\\, は区切りではなく、コンマそのもの）' : ''}${pad ? '（先頭が 0 の数があるので、桁数をそろえて 0 で埋める）' : ''}${refused}${fails}`,
      `Brace expansion: \`${text}\` expands to ${count} ${count === 1 ? 'word' : 'words'}: ${list}${later}${comma ? ' (an escaped comma is not a separator, just a comma)' : ''}${pad ? ' (a number with a leading 0 pads all of them with zeros to the same width)' : ''}${refused}${fails}`]),
  /** `echo {,}`: a brace expansion of empty words. */
  'brace-expansion-empty': tokenText<{ text: string }>(({ text }) => [
    `ブレース展開: \`${text}\` は空の単語に展開され、空の単語は取り除かれるので、何も残らない`,
    `Brace expansion: \`${text}\` expands to empty words, which are dropped, so nothing is left`]),
  /** `cd ~/src`: a tilde prefix at the start of a word (`target`: what it becomes, from `tildeTarget`). */
  'tilde-expansion': tokenText<{ target: string | undefined }>(({ target }) => [
    `チルダ展開: ${target}に置き換わる`,
    `Tilde expansion: ${target}`]),
  /** `x=a:~/b`: a tilde prefix after a `=` or `:` (`after`: that character). */
  'tilde-expansion-after': tokenText<{ after: string; target: string | undefined }>(({ after, target }) => [
    `チルダ展開（\`${after}\` の後ろ）: ${target}に置き換わる`,
    `Tilde expansion (after \`${after}\`): ${target}`]),
  /** `case $x in a) …`: a pattern with no wildcard. */
  'pattern-literal': tokenText<{ text: string }>(({ text }) => [
    `パターン \`${text}\`（ワイルドカードを含まないので、この文字列そのものに一致）`,
    `Pattern \`${text}\` (no wildcards, so it matches exactly this text)`]),
  /** `case $x in "$q") …`: a pattern whose expansions are all quoted. */
  'pattern-quoted-expansion': tokenText<{ text: string }>(({ text }) => [
    `パターン \`${text}\`: 展開はクォートされているので、その値は文字列そのものとして照合される（値の中の \`*\` や \`?\` はワイルドカードにならない）`,
    `Pattern \`${text}\`: the expansion is quoted, so its value is matched as literal text (\`*\` and \`?\` in the value are not wildcards)`]),
  /** `case $x in $p"*") …`: a pattern with an unquoted expansion and a quoted part. */
  'pattern-mixed-expansion': tokenText<{ text: string }>(({ text }) => [
    `パターン \`${text}\`: クォートしていない展開の結果はパターンになり、クォートした部分は文字列そのものとして照合される`,
    `Pattern \`${text}\`: what the unquoted expansions give is a pattern, and the quoted parts are matched as literal text`]),
  /** `case $x in $p) …`: a pattern that an unquoted expansion gives. */
  'pattern-expansion': tokenText<{ text: string }>(({ text }) => [
    `パターン \`${text}\`: 展開した結果がパターンになる`,
    `Pattern \`${text}\`: what it expands to is the pattern`]),
  /** `echo $x`: a variable with no description. */
  'variable-plain': tokenText<{ name: string }>(({ name }) => [
    `変数 \`${name}\``,
    `Variable \`${name}\``]),
  /** `echo $x`: a variable's value (`note`: what splitting and globbing do, from the model). */
  'variable-expands-with-note': tokenText<{ name: string; note: Text }>(({ name, note }) => [
    `変数 \`${name}\` の値に置き換わる（クォートしないと${note.ja.startsWith('`') ? ' ' : ''}${note.ja}）`,
    `Expands to the value of \`${name}\` (unquoted, ${note.en})`]),
  /** `echo "$x"`: a variable's value. */
  'variable-expands': tokenText<{ name: string }>(({ name }) => [
    `変数 \`${name}\` の値に置き換わる`,
    `Expands to the value of \`${name}\``]),
  /** `a=([k1]=v1 v2)`: a value of an associative array that bash refuses, after a first value with a subscript. */
  'array-assoc-missing-subscript': tokenText(() => [
    'bash はこの値を受け付けない: 最初の値が `[キー]=` で始まるので、どの値にも `[キー]=` が要る（「must use subscript when assigning associative array」）。bash 5.2 はそう表示して続けるが、bash 5.3 はさらにこの行の残りを実行しない（終了ステータス 1）',
    'Bash refuses this value: the first value starts with `[key]=`, so each one needs its `[key]=` ("must use subscript when assigning associative array"). bash 5.2 says so and goes on; bash 5.3 also abandons the rest of the line (status 1)']),
  /** `declare -A m=(k v)`: a key of an associative array's list. */
  'array-key': tokenText<{ text: string }>(({ text }) => [
    `キー \`${text}\``,
    `Key \`${text}\``]),
  /** `declare -A m=(k v)`: a value of an associative array's list (`key`: the key before it). */
  'array-value-of-key': tokenText<{ key: string; text: string }>(({ key, text }) => [
    `キー \`${key}\` の値 \`${text}\``,
    `Value \`${text}\` of the key \`${key}\``]),
  /** `a=([k{1,2}]=v)`: an element whose word bash 5.2 brace-expands first (`braces`: its words). */
  'array-brace-value': tokenText<{ braces: readonly string[]; key: string; value: string; plus: boolean }>(({ braces, key, value, plus }) => [
    `bash 5.2 はこの語を先にブレース展開し、${braces.map((w) => `\`${w}\``).join('・')} という添字のない値にする（それぞれが次の要素になる）。bash 5.3 はブレース展開せず、添字 \`${key}\` の要素に \`${value}\` を${plus ? '追記' : '代入'}する`,
    `bash 5.2 brace-expands this word first, into the values ${braces.map((w) => `\`${w}\``).join(', ')}, with no index of their own (each is the next element); bash 5.3 does not, and ${plus ? 'appends' : 'sets'} \`${value}\` ${plus ? 'to' : 'as'} the element with the index \`${key}\``]),
  /** `declare -A m=([k]=v)`: the key of an element of an associative array. */
  'array-element-key': tokenText<{ key: string }>(({ key }) => [
    `キー \`${key}\`（文字列で、計算はされない）`,
    `key \`${key}\` (a string, not evaluated)`]),
  /** `a=([i]=v)` with `a` not known to be indexed or associative. */
  'array-element-subscript-unknown': tokenText<{ key: string }>(({ key }) => [
    `添字 \`${key}\`（連想配列ならキー、そうでなければ算術式）`,
    `subscript \`${key}\` (a key if the array is associative, an arithmetic expression otherwise)`]),
  /** `a=([1+1]=v)`: an index that is arithmetic with a value (`value`) other than its text. */
  'array-element-index-computed': tokenText<{ key: string; value: string | number }>(({ key, value }) => [
    `添字 \`${key}\`（算術式として計算すると ${value}）`,
    `index \`${key}\` (an arithmetic expression: ${value})`]),
  /** `a=([1]=v)`: an index that is a plain number. */
  'array-element-index': tokenText<{ key: string }>(({ key }) => [
    `添字 \`${key}\``,
    `index \`${key}\``]),
  /** `a=([i]=v)`: an index that is a variable's name. */
  'array-element-index-variable': tokenText<{ key: string }>(({ key }) => [
    `添字 \`${key}\`（算術式なので変数 \`${key}\` の値。未設定なら 0）`,
    `index \`${key}\` (an arithmetic expression: the value of the variable \`${key}\`, 0 when it is not set)`]),
  /** `a=([i+j]=v)`: an index that is arithmetic. */
  'array-element-index-arithmetic': tokenText<{ key: string }>(({ key }) => [
    `添字 \`${key}\`（算術式として計算される）`,
    `index \`${key}\` (an arithmetic expression)`]),
  /** `a=([1]=v)`: an element with an index of its own (`what`: the index or key as one of the entries above says it). */
  'array-element-set': tokenText<{ what: string; value: string; append: boolean }>(({ what, value, append }) => [
    `${what}${plainOf(what).endsWith('`') ? ' ' : ''}の要素に \`${value}\` を${append ? '追記' : '代入'}する`,
    `Element with ${what}: ${append ? 'append' : 'set it to'} \`${value}\``]),
  /** `(( a[@] ))`: all elements in arithmetic. */
  'subscript-all-in-arithmetic': tokenText<{ text: string; name: string }>(({ text, name }) => [
    `算術式では \`${text}\` は使えず、エラーになる（\`bad array subscript\`）。要素は \`${name}[0]\` のように1つずつ指定する`,
    `Not allowed in arithmetic: \`${text}\` is an error (\`bad array subscript\`); name one element, such as \`${name}[0]\``]),
  /** `(( m[k] ))` with `m` an associative array. */
  'subscript-assoc-element': tokenText<{ name: string; key: string }>(({ name, key }) => [
    `連想配列 \`${name}\` のキー \`${key}\`（文字列）の要素`,
    `Element of associative array \`${name}\` with the key \`${key}\` (a string)`]),
  /** `(( a[1] ))`: an element of an array. */
  'subscript-element': tokenText<{ name: string; index: string }>(({ name, index }) => [
    `配列 \`${name}\` の要素 \`[${index}]\``,
    `Element \`[${index}]\` of array \`${name}\``]),
  /** `(( a, b ))`: the comma operator. */
  'arith-comma-operator': tokenText(() => [
    '`,` コンマ演算子: 左の式を評価して値を捨て、右の式に進む',
    '`,` comma operator: evaluate the left expression, drop its value, go on to the right one']),
  /** `echo $((1+2))`: an arithmetic expansion. */
  'arith-expansion': tokenText(() => [
    '算術展開: 中の式を整数として計算した結果に置き換える',
    'Arithmetic expansion: replaced by the integer result of the expression']),
  /** `echo $[1+2]`: the obsolete form of an arithmetic expansion. */
  'arith-expansion-obsolete': tokenText(() => [
    '。`$[…]` は古い書き方（廃止予定）で、`$((…))` と同じ意味',
    '. `$[…]` is the obsolete form of `$((…))`']),
  /** `echo 'a b'`: a single-quoted string. */
  'string-single': tokenText(() => [
    'シングルクォート文字列: 中身は一切展開されず、そのままの文字列になる',
    'Single-quoted string: taken literally, nothing is expanded']),
  /** `(( 1 + 2 ))`: a number. */
  'arith-number': tokenText(() => ['数値', 'Number']),
  /** `a=(x y)`: an array built from its elements. */
  'array-compound': tokenText(() => [
    '配列: `( )` 内の要素から配列を作る',
    'Array: built from the elements inside `( )`']),
};
