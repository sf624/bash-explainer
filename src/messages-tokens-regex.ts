import { tokenError, type TokenEntry, type TokenProblem, tokenText } from './messages-levels';

// What the regex reader (src/embedded/regex.ts) says of a pattern its program refuses: grep, sed, awk and Perl stop with an
// error, bash's `[[ =~ ]]` gives status 2, and bazel's query (Java's regex) stops, every time. Each kind of error is one entry, shared by the flavors, with the
// program as a parameter. Where the shell does not get to the command, the same row is plain text (`…-if-reached`,
// `Explainer.reachedAt`). test/regex-errors-real.test.ts holds each against the real programs.

/** The program that reads the regex: GNU grep (`-G`, `-E`, `-P`), GNU sed, awk, Perl, bash's `[[ =~ ]]`, or bazel's query (`filter`, `kind`, `attr`; Java's `java.util.regex`). */
export type RegexProgram = 'grep' | 'sed' | 'awk' | 'perl' | 'bash' | 'bazel';

/** What the program does with a regex it refuses. */
const FAILS: Record<RegexProgram, readonly [ja: string, en: string]> = {
  grep: ['`grep` はエラーで止まる（終了ステータス 2）', '`grep` stops with an error (status 2)'],
  sed: ['`sed` はエラーで止まる（終了ステータス 1）', '`sed` stops with an error (status 1)'],
  awk: ['`awk` はエラーで止まる', '`awk` stops with an error'],
  perl: ['`perl` はエラーで止まる（終了ステータス 255）', '`perl` stops with an error (status 255)'],
  bash: ['`[[ … ]]` はメッセージを出さずに終了ステータス 2 を返す', '`[[ … ]]` gives status 2, with no message'],
  // (bazel 9.3.2: "illegal 'filter' pattern regexp", and "Wrong query syntax" for aquery's own filters.)
  bazel: ['`bazel` はエラーで止まる（`bazel query` は終了ステータス 7、`cquery`・`aquery` は 1）', '`bazel` stops with an error (status 7; 1 for `cquery` and `aquery`)'],
};

const INVALID: TokenProblem = {
  head: ['この正規表現は不正なので、このコマンドは実行するたびに失敗する。', 'This regex is not valid: the command fails every time it runs.'],
  then: ['このコマンドは実行するたびに失敗し、本来の処理をしない', 'The command fails every time it runs, and does not do its work'],
};

type Row<P> = (p: P) => readonly [string, string];

/** An error of a regex, and the same row where the shell does not get to the command. */
function invalid<P = Record<string, never>>(row: Row<P>): { error: TokenEntry<P>; unreached: TokenEntry<P> } {
  return { error: tokenError<P>(INVALID, row), unreached: tokenText<P>(row) };
}

/** `[a`, `[[:alpha:]`: no `]` closes a set. */
const BRACKET = invalid<{ tool: RegexProgram }>(({ tool }) => [`\`[\` に対応する \`]\` がない。${FAILS[tool][0]}`, `No \`]\` closes this \`[\`: ${FAILS[tool][1]}`]);
/** `(a`, `\(a`: no `)` closes a group (`close`: `)`, or `\)` in a basic regex). */
const GROUP = invalid<{ tool: RegexProgram; close: string }>(({ tool, close }) => [
  `このグループを閉じる \`${close}\` がない。${FAILS[tool][0]}`, `No \`${close}\` closes this group: ${FAILS[tool][1]}`]);
/** `a\`: a backslash ends the regex. */
const TRAILING = invalid<{ tool: RegexProgram }>(({ tool }) => [`末尾の \`\\\` の後に文字がない。${FAILS[tool][0]}`, `Nothing follows the final \`\\\`: ${FAILS[tool][1]}`]);
/** `a\{`, `a\{x\}`: a basic regex's `\{` after something to repeat, with no count of the form `\{n,m\}` (grep and sed). */
const INTERVAL = invalid<{ tool: RegexProgram }>(({ tool }) => [
  `\`\\{\` は \`\\{n\\}\` や \`\\{n,m\\}\` の形でないと使えない（"Unmatched \\{" や "Invalid content of \\{\\}"）。${FAILS[tool][0]}`,
  `\`\\{\` must start a complete \`\\{n\\}\` or \`\\{n,m\\}\` ("Unmatched \\{" or "Invalid content of \\{\\}"): ${FAILS[tool][1]}`]);
/** `\{1\}` at the start of sed's basic regex: nothing before it to repeat (GNU grep reads that `\{` as the character). */
const NOTHING_BEFORE = invalid(() => [
  '先頭の `\\{` の前には繰り返すものがない。`sed` はエラーで止まる（終了ステータス 1、"Invalid preceding regular expression"）',
  '`\\{` has nothing before it to repeat: `sed` stops with an error (status 1, "Invalid preceding regular expression")']);
/** `[\d-z]` of grep -P: a set at an end of a range. */
const RANGE_SET = invalid(() => [
  '範囲の端に `\\d` のような集合があり、不正な範囲。`grep -P` はエラーで止まる（終了ステータス 2、"invalid range in character class"）',
  'Invalid range: a set such as `\\d` is at one end. `grep -P` stops with an error (status 2, "invalid range in character class")']);
/** `\U` of grep -P: Perl's case escapes, which PCRE2 has not. */
const CASE_ESCAPE = invalid<{ c: string }>(({ c }) => [
  `\`\\${c}\` は PCRE2 のエスケープにない。\`grep -P\` はエラーで止まる（終了ステータス 2、"PCRE2 does not support \\F, \\L, \\l, \\N{name}, \\U, or \\u"。Perl には大文字・小文字にする \`\\${c}\` がある）`,
  `\`\\${c}\` is no PCRE2 escape: \`grep -P\` stops with an error (status 2, "PCRE2 does not support \\F, \\L, \\l, \\N{name}, \\U, or \\u"; Perl has a \`\\${c}\` that changes case)`]);
/** `\q`, `\U` of bazel's query: a letter Java's regex has no escape of (Perl's case escapes too). */
const JAVA_ESCAPE = invalid<{ c: string }>(({ c }) => [
  `\`\\${c}\` は Java の正規表現のエスケープにない。\`bazel\` はエラーで止まる（"Illegal/unsupported escape sequence"。\`bazel query\` は終了ステータス 7、\`cquery\`・\`aquery\` は 1）`,
  `\`\\${c}\` is no escape of Java's regex: \`bazel\` stops with an error ("Illegal/unsupported escape sequence"; status 7, 1 for \`cquery\` and \`aquery\`)`]);
/** `\q` of grep -P: a letter PCRE2 has no escape of. */
const UNKNOWN_ESCAPE = invalid<{ c: string }>(({ c }) => [
  `\`\\${c}\` は PCRE のエスケープにない。\`grep -P\` はエラーで止まる（終了ステータス 2、"unrecognized character follows \\"。Perl は文字「${c}」として扱う）`,
  `\`\\${c}\` is no PCRE escape: \`grep -P\` stops with an error (status 2, "unrecognized character follows \\"; Perl reads it as "${c}")`]);

export const REGEX_TEXTS = {
  'regex-bracket-unclosed': BRACKET.error,
  'regex-bracket-unclosed-if-reached': BRACKET.unreached,
  'regex-group-unclosed': GROUP.error,
  'regex-group-unclosed-if-reached': GROUP.unreached,
  'regex-trailing-backslash': TRAILING.error,
  'regex-trailing-backslash-if-reached': TRAILING.unreached,
  'regex-interval-incomplete': INTERVAL.error,
  'regex-interval-incomplete-if-reached': INTERVAL.unreached,
  'regex-interval-nothing-before': NOTHING_BEFORE.error,
  'regex-interval-nothing-before-if-reached': NOTHING_BEFORE.unreached,
  'regex-pcre-range-set': RANGE_SET.error,
  'regex-pcre-range-set-if-reached': RANGE_SET.unreached,
  'regex-pcre-case-escape': CASE_ESCAPE.error,
  'regex-pcre-case-escape-if-reached': CASE_ESCAPE.unreached,
  'regex-pcre-unknown-escape': UNKNOWN_ESCAPE.error,
  'regex-pcre-unknown-escape-if-reached': UNKNOWN_ESCAPE.unreached,
  'regex-java-unknown-escape': JAVA_ESCAPE.error,
  'regex-java-unknown-escape-if-reached': JAVA_ESCAPE.unreached,
};
