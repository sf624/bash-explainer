import type { PythonFlag } from './embedded/regex-python';
import { tokenError, type TokenEntry, type TokenProblem, tokenText } from './messages-levels';

// What the regex reader (src/embedded/regex.ts) says of a pattern its program refuses: grep, sed, awk and Perl stop with an
// error, bash's `[[ =~ ]]` gives status 2, and bazel's query (Java's regex) stops, every time. Each kind of error is one entry, shared by the flavors, with the
// program as a parameter. Where the shell does not get to the command, the same row is plain text (`…-if-reached`,
// `Explainer.reachedAt`). test/regex-errors-real.test.ts holds each against the real programs.

/**
 * The program that reads the regex: GNU grep (`-G`, `-E`, `-P`), GNU sed, awk, Perl, bash's `[[ =~ ]]`, bazel's query (`filter`, `kind`,
 * `attr`; Java's `java.util.regex`), or Python's `re`, whose refusals say its own message (`regex-python-error`).
 */
export type RegexProgram = 'grep' | 'sed' | 'awk' | 'perl' | 'bash' | 'bazel' | 'python';

/** What the program does with a regex it refuses. */
const FAILS: Record<RegexProgram, readonly [ja: string, en: string]> = {
  grep: ['`grep` はエラーで止まる（終了ステータス 2）', '`grep` stops with an error (status 2)'],
  sed: ['`sed` はエラーで止まる（終了ステータス 1）', '`sed` stops with an error (status 1)'],
  awk: ['`awk` はエラーで止まる', '`awk` stops with an error'],
  perl: ['`perl` はエラーで止まる（終了ステータス 255）', '`perl` stops with an error (status 255)'],
  bash: ['`[[ … ]]` はメッセージを出さずに終了ステータス 2 を返す', '`[[ … ]]` gives status 2, with no message'],
  // (bazel 9.3.2: "illegal 'filter' pattern regexp", and "Wrong query syntax" for aquery's own filters.)
  bazel: ['`bazel` はエラーで止まる（`bazel query` は終了ステータス 7、`cquery`・`aquery` は 1）', '`bazel` stops with an error (status 7; 1 for `cquery` and `aquery`)'],
  python: ['Python は `re.error` を出す', 'Python raises `re.error`'],
};

const INVALID: TokenProblem = {
  head: ['この正規表現は不正なので、このコマンドは実行するたびに失敗する。', 'This regex is not valid: the command fails every time it runs.'],
  then: ['このコマンドは実行するたびに失敗し、本来の処理をしない', 'The command fails every time it runs, and does not do its work'],
};

type Row<P> = (p: P) => readonly [string, string];

/** A pattern Python's `re` refuses: it raises `re.error` (named `re.PatternError` since 3.13) each time it compiles it. */
const PYTHON_INVALID: TokenProblem = {
  head: ['このパターンは不正なので、コンパイルするたびに `re.error` が出る。', 'This pattern is not valid: compiling it raises `re.error` every time.'],
  then: ['このパターンをコンパイルするたびに `re.error`（`re.PatternError`）が出る', 'Compiling it raises `re.error` (`re.PatternError`) every time'],
};

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
  /**
   * The pattern of a call of Python's `re` in a `.py` file (src/hosts/languages.ts): `call` as the file writes it, what the function adds to it
   * (`anchors`: `match` at the start, `fullmatch` at both ends), and the release a function needs (`since`: `prefixmatch`, 3.15).
   */
  'python-regex-pattern': tokenText<{ call: string; anchors?: 'start' | 'whole'; since?: string }>(({ call, anchors, since }) => [
    `\`${call}\` のパターン（Python の正規表現）${anchors === 'start' ? '。文字列の先頭から一致する' : anchors === 'whole' ? '。文字列全体に一致する' : ''}${since ? `（Python ${since} 以降）` : ''}`,
    `The pattern of \`${call}\` (Python regex)${anchors === 'start' ? ', matched at the start of the string' : anchors === 'whole' ? ', matched against the whole string' : ''}${since ? ` (Python ${since} or later)` : ''}`]),
  /**
   * Python's `re` refuses the pattern: `message` is Python's own (`bad escape \e at position 0`), held against the reference Python
   * (test/regex-python-real.test.ts); `since`, the release since which it is an error, where that changed in a release still supported.
   */
  'regex-python-error': tokenError<{ message: string; since?: string }>(PYTHON_INVALID, ({ message, since }) => [
    `Python の \`re\` はこのパターンを受け付けない（"${message}"${since ? `。Python ${since} からエラー` : ''}）`,
    `Python's \`re\` refuses this pattern ("${message}"${since ? `; an error since Python ${since}` : ''})`]),
  /**
   * A refusal of Python's `re` (`regex-python-error`) where `re.VERBOSE` is not known and the pattern read with it gives no such refusal
   * (src/embedded/regex.ts, `UNLESS_VERBOSE`): it may compile, so no Error.
   */
  'regex-python-error-unless-verbose': tokenText<{ message: string; since?: string }>(({ message, since }) => [
    `\`re.VERBOSE\` がなければ、Python の \`re\` はこのパターンを受け付けない（"${message}"${since ? `。Python ${since} からエラー` : ''}。フラグが分からない）`,
    `Without \`re.VERBOSE\`, Python's \`re\` refuses this pattern ("${message}"${since ? `; an error since Python ${since}` : ''}; the flags are not known)`]),
  /**
   * Inline flags of a Python pattern (`(?i)`, written as is; `(?i-m:…)`, `scoped`): the flags turned on, each with what it does
   * (`FLAG_MEANINGS`), and those turned off in a group, each with what the group does without it (`FLAG_OFF`).
   */
  'python-regex-inline-flags': tokenText<{ written: string; on: readonly PythonFlag[]; off: readonly PythonFlag[]; scoped: boolean }>(({ written, on, off, scoped }) => {
    const list = (flags: readonly PythonFlag[], ja: boolean) => flags.map((f) => `\`re.${f}\`${ja ? `（${FLAG_MEANINGS[f][0]}）` : ` (${FLAG_MEANINGS[f][1]})`}`).join(ja ? '、' : ', ');
    const offJa = off.map((f) => `\`re.${f}\` を外す（${FLAG_OFF[f]![0]}）`).join('、');
    const offEn = off.map((f) => `without \`re.${f}\` (${FLAG_OFF[f]![1]})`).join(', ');
    return scoped
      ? [`\`${written}\`: このグループの中だけ（番号は付かない）: ${[list(on, true), offJa].filter((t) => t).join('。')}`, `\`${written}\`: inside this group only (no number): ${[list(on, false), offEn].filter((t) => t).join('; ')}`]
      : [`\`${written}\`: パターン全体のフラグ: ${list(on, true)}`, `\`${written}\`: flags for the whole pattern: ${list(on, false)}`];
  }),
  /** Whitespace between two items of a VERBOSE pattern, which Python's `re` ignores. */
  'python-regex-verbose-space': tokenText(() => ['空白: 無視される（`re.VERBOSE`）', 'Whitespace: ignored (`re.VERBOSE`)']),
  /** A `#` comment of a VERBOSE pattern. */
  'python-regex-verbose-comment': tokenText(() => ['行末までのコメント（`re.VERBOSE`）: 一致には関係しない', 'A comment to the end of the line (`re.VERBOSE`): ignored']),
  /** A name of a flag in the flags argument of a call of `re` (`re.I`, `IGNORECASE` after `from re import IGNORECASE`; `0`, as `NOFLAG`). */
  'python-regex-flag': tokenText<{ written: string; flag: PythonFlag }>(({ written, flag }) => {
    const long = written === flag || written.endsWith(`.${flag}`) || written === '0' ? '' : ` (\`re.${flag}\`)`;
    return [`\`${written}\`${long ? `（\`re.${flag}\`）` : ''}: ${FLAG_MEANINGS[flag][0]}`, `\`${written}\`${long}: ${FLAG_MEANINGS[flag][1]}`];
  }),
  /** A flags argument that is not names of `re` (`flags=opts`): what depends on the flags says so. */
  'python-regex-flags-unknown': tokenText<{ written: string }>(({ written }) => [
    `フラグ \`${written}\`: ここでは値が分からないので、フラグで意味が変わるパターンの要素はそのことを書く`,
    `The flags \`${written}\`: not known here, so a part of the pattern whose meaning depends on them says so`]),
  /** Flags in the slot of `count` or `maxsplit` (the fact `python-regex-flag-as-count` says the problem). */
  'python-regex-flags-as-count': tokenText<{ written: string; param: 'count' | 'maxsplit'; value: number }>(({ written, param, value }) => [
    `ここでの \`${written}\` はフラグではなく引数 \`${param}\`（値は ${value}）`, `\`${written}\` here is the argument \`${param}\` (the value ${value}), not a flag`]),
};

/** What each flag of Python's `re` does (`PYTHON_FLAGS`, src/embedded/regex-python.ts), for the texts of a flags argument and of inline flags. */
const FLAG_MEANINGS: Record<PythonFlag, readonly [ja: string, en: string]> = {
  ASCII: ['`\\w`・`\\d`・`\\s`・`\\b` が ASCII の文字だけに一致する', '`\\w`, `\\d`, `\\s` and `\\b` match ASCII characters only'],
  IGNORECASE: ['大文字小文字を区別しない', 'letters match in either case'],
  LOCALE: ['bytes のパターンで、`\\w`・`\\b` と大文字小文字の区別が実行時のロケールに従う', 'in a bytes pattern, `\\w`, `\\b` and case follow the current locale'],
  MULTILINE: ['`^` と `$` が各行の先頭と末尾にも一致する', '`^` and `$` match at the start and end of each line too'],
  DOTALL: ['`.` が改行にも一致する', '`.` matches a newline too'],
  VERBOSE: ['パターン中の空白を無視し、`#` から行末までをコメントにする（文字クラスの中とバックスラッシュの後を除く）', 'whitespace in the pattern is ignored, and `#` starts a comment to the end of the line (not in a set or after a backslash)'],
  UNICODE: ['Unicode で一致させる（str のパターンでは初めからそう）', 'Unicode matching, which a str pattern has already'],
  DEBUG: ['コンパイルしたパターンをデバッグ用に表示する', 'prints the compiled pattern, for debugging'],
  NOFLAG: ['フラグなし', 'no flags'],
};

/** What a group does without a flag that its inline flags turn off (`(?-i:…)`): the flags that may be turned off (not `a`, `u`, `L`). */
const FLAG_OFF: Partial<Record<PythonFlag, readonly [ja: string, en: string]>> = {
  IGNORECASE: ['大文字小文字を区別する', 'case-sensitive'],
  MULTILINE: ['`^` と `$` は文字列の先頭と末尾だけに一致し、各行には一致しない', '`^` and `$` match at the start and end of the text only, not of each line'],
  DOTALL: ['`.` は改行に一致しない', '`.` does not match a newline'],
  VERBOSE: ['空白と `#` も文字として一致する', 'whitespace and `#` match as characters'],
};
