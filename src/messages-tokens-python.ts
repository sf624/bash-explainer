import { charOfCode } from './embedded/regex-escapes';
import { tokenError, type TokenProblem, tokenText } from './messages-levels';
import { visible } from './ctlchars';
import { blankName, codeShown } from './messages-values';

// What a `.py` file's calls of `re` say beyond their pattern (src/hosts/languages.ts; docs/design/python-regex.md, 5.1 and 6): the
// replacement template of `re.sub` and `re.subn`, read by src/embedded/regex-template.ts as `parse_template` of Python's
// `re._parser` reads it, and the calls of a compiled pattern's methods, linked to the `re.compile` that made it.

/** A template Python's `re` refuses: the call raises an error each time it runs, whatever the string is. */
const TEMPLATE_INVALID: TokenProblem = {
  head: ['この置換後の文字列は不正なので、呼び出すたびにエラーが出る。', 'This replacement is not valid: the call raises an error every time it runs.'],
  then: ['この呼び出しは実行するたびにエラーになり、置換をしない', 'The call fails every time it runs, and replaces nothing'],
};

const said = (code: number): readonly [string, string] => [charOfCode(code, (j) => j), charOfCode(code, (_, e) => e)];

export const PYTHON_TEXTS = {
  /**
   * The replacement of `re.sub` or `re.subn` (`call` as written), a literal: `template`, it has a backslash, which Python reads as a
   * template; `unread`, the fields of an f-string whose values decide how it reads, where it is not read.
   */
  'python-template': tokenText<{ call: string; template: boolean; unread?: readonly string[] }>(({ call, template, unread }) => [
    `\`${call}\` の置換後の文字列: 一致した部分それぞれをこれに置き換える${template ? '。バックスラッシュは Python がテンプレートとして読む（`\\1` や `\\g<name>` はグループに一致した文字列）' : ''}${unread ? `。${unread.join('・')} の値によって読み方が変わるので、ここでは読まない` : ''}`,
    `The replacement of \`${call}\`: it takes the place of each match${template ? '. Python reads its backslashes as a template (`\\1` and `\\g<name>` put in what a group matched)' : ''}${unread ? `; not read here, as how it reads depends on the value of ${unread.join(', ')}` : ''}`]),
  /** Plain text of a template, as its value has it (a control character as its picture: `'\1'` of a string that is not raw). */
  'python-template-text': tokenText<{ text: string }>(({ text }) => {
    const shown = blankName(text, false) ? text : visible(text);
    return [`文字列 ${codeShown(shown, true, ' ')}がそのまま入る`, `The text ${codeShown(shown, false)}, put in as it is`];
  }),
  /** An escape of a template that is one character: `\n`, `\\`, an octal escape (`\012`, `\0`). */
  'python-template-char': tokenText<{ written: string; code: number }>(({ written, code }) => [`\`${written}\`: ${said(code)[0]}`, `\`${written}\`: ${said(code)[1]}`]),
  /** `\-`: an escape that is no ASCII letter and not of the table, which Python keeps with its backslash. */
  'python-template-kept': tokenText<{ written: string }>(({ written }) => [
    `\`${written}\`: バックスラッシュも含めてそのまま入る（Python のテンプレートにこのエスケープはない）`,
    `\`${written}\`: put in as written, the backslash too (Python's templates have no such escape)`]),
  /**
   * A group of a template: `\1`, `\g<1>`, `\g<name>` (`name`); `group`, its number, which is not known where the pattern's groups are not.
   * A group that did not take part in the match puts in nothing (since Python 3.5).
   */
  'python-template-group': tokenText<{ written: string; group?: number; name?: string }>(({ written, group, name }) => {
    const which = (j: boolean) => (name === undefined ? (j ? `グループ ${group}` : `group ${group}`) : group === undefined ? (j ? `グループ \`${name}\`` : `the group \`${name}\``) : j ? `グループ \`${name}\`（グループ ${group}）` : `the group \`${name}\` (group ${group})`);
    return [`\`${written}\`: ${which(true)}に一致した文字列（グループが一致に加わらなかったときは空文字）`, `\`${written}\`: what ${which(false)} matched (nothing where the group did not take part)`];
  }),
  /** `\g<0>`: the whole match. */
  'python-template-match': tokenText<{ written: string }>(({ written }) => [`\`${written}\`: 一致した部分全体`, `\`${written}\`: the whole match`]),
  /**
   * Python refuses the template: `message` is its own (`invalid group reference 3 at position 1`), held against the reference Python
   * (test/regex-python-real.test.ts); `raises`, the exception (`IndexError` for a name the pattern has no group of).
   */
  'regex-python-template-error': tokenError<{ message: string; raises: 're.error' | 'IndexError' }>(TEMPLATE_INVALID, ({ message, raises }) => [
    `Python の \`re\` はこの置換後の文字列を受け付けない（"${message}"。\`${raises}\` が出る）`,
    `Python's \`re\` refuses this replacement ("${message}"; it raises \`${raises}\`)`]),
  /**
   * A method of a compiled pattern (`PAT.sub`, `call`), linked to the one `re.compile` of the file that binds `name` (`line`, as
   * `lineLabel` writes it; `pattern`, its literal shortened); what its function adds (`anchors`), and the release it needs (`since`).
   */
  'python-regex-method': tokenText<{ call: string; method: string; name: string; line: string; pattern: string; anchors?: 'start' | 'whole'; since?: string }>(({ call, method, name, line, pattern, anchors, since }) => [
    `\`${call}\`: ${line} で \`${name}\` にコンパイルしたパターン \`${pattern}\`（Python の正規表現）のメソッド \`${method}\`${anchors === 'start' ? '。文字列の先頭（`pos` の位置）から一致する' : anchors === 'whole' ? '。文字列全体に一致する' : ''}${since ? `（Python ${since} 以降）` : ''}`,
    `\`${call}\`: the method \`${method}\` of the pattern \`${pattern}\` (Python regex), compiled into \`${name}\` on ${line}${anchors === 'start' ? '; matched at the start of the string (at `pos`)' : anchors === 'whole' ? '; matched against the whole string' : ''}${since ? ` (Python ${since} or later)` : ''}`]),
  /** `re.sub(p, f'{x}!', s)`: a field of an f-string in a replacement template, whose value Python reads as part of the template. */
  'hole-python-template': tokenText<{ value: string }>(({ value }) => [
    `${value} の値は置換後の文字列に入る。値の中の \`\\\` は Python がテンプレートとして読む（\`\\1\` はグループに一致した文字列、知らないエスケープはエラー）`,
    `The value of ${value} goes into the replacement: Python reads a \`\\\` in it as part of the template (\`\\1\` puts in what a group matched, and an escape it does not know is an error)`]),
  /** `pos` of a method of a compiled pattern (`written`, as given). */
  'python-regex-pos': tokenText<{ written: string }>(({ written }) => [
    `引数 \`pos\`（\`${written}\`）: この位置から照合を始める。文字列を切り出すのとは違い、\`^\` と \`\\A\` は本当の先頭にしか一致せず、後読みと \`\\b\` はその前の文字も見る`,
    `The argument \`pos\` (\`${written}\`): the search starts at this index. Unlike a slice of the string, \`^\` and \`\\A\` match at its real start only, and a lookbehind and \`\\b\` see the characters before it`]),
  /** `endpos` of a method of a compiled pattern. */
  'python-regex-endpos': tokenText<{ written: string }>(({ written }) => [
    `引数 \`endpos\`（\`${written}\`）: 文字列がこの長さで終わるものとして照合する（\`$\` はそこに一致する）`,
    `The argument \`endpos\` (\`${written}\`): the string is matched as if it ended at this index (\`$\` matches there)`]),
};
