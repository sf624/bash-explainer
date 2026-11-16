import { type Text, tx } from '../i18n';
import { codeSpan } from '../label';
import { cmd, GNU_INFO, optionOf, pos } from './types';

// GNU cut, as coreutils 9.4 is released: it counts bytes in every locale, `-c` as `-b` ("The same as ‘-b’ for now, but
// internationalization will change that": the coreutils manual, "cut invocation"), and a delimiter is one byte. The i18n
// patch of some distributions makes `-c` count characters in a UTF-8 locale.

const files = pos('対象のファイル', 'target file');

/** What cut says of a delimiter of more than one byte, before the cause. */
const REFUSED = tx('cut は1バイトより長い区切り文字を受け付けない: `the delimiter must be a single character` と表示し、何もせずに終了ステータス 1 で終わる',
  'cut refuses a delimiter of more than one byte: it says `the delimiter must be a single character`, and exits with status 1, doing nothing');

/**
 * GNU cut takes a delimiter of one byte (coreutils 9.4, in every locale): `-d ab` and `-dé` are refused, with the cause that
 * applies (several characters, or one of several bytes in UTF-8); `-d '\t'` is a backslash and `t`, and tab is the default.
 * (`-d ''` is the NUL byte.)
 */
function cutDelimiter(v: string): Text | undefined {
  const bytes = new TextEncoder().encode(v).length;
  if (bytes <= 1) return undefined;
  const chars = [...v].length;
  const why = v === '\\t'
    ? tx('cut は `\\t` をタブとして読まない（バックスラッシュと `t` の2文字）。タブは既定の区切り文字なので、`-d` を書かないか、`-d $\'\\t\'` と書く',
      'cut does not read `\\t` as a tab: it is a backslash and `t`. Tab is the default delimiter: leave out `-d`, or write `-d $\'\\t\'`')
    : chars > 1 ? tx(`${codeSpan(v)} は${chars}文字`, `${codeSpan(v)} is ${chars} characters`)
      : tx(`${codeSpan(v)} は1文字だが、UTF-8 では${bytes}バイトになる`, `${codeSpan(v)} is one character, but ${bytes} bytes in UTF-8`);
  return tx(`${REFUSED.ja}。${why.ja}`, `${REFUSED.en}. ${why.en}`);
}

export const cut = cmd('各行から指定した列（フィールド）や文字位置を切り出す', 'Cut out selected fields or characters from each line', [
  ['-s|--only-delimited', '区切り文字のない行は出力しない', 'do not print lines without the delimiter'],
  ['--complement', '指定した以外を出力する', 'select everything except the given fields'],
  ['--output-delimiter', '出力の区切り文字', 'output delimiter', 'arg'],
  ['-z|--zero-terminated', '行の区切りを改行でなく NUL にする', 'lines end with NUL, not newline'],
  { ...optionOf(['-d|--delimiter', '区切り文字（既定はタブ）', 'field delimiter (default: tab)']), value: { name: 'VALUE', refuses: cutDelimiter } },
  ['-f|--fields', '取り出すフィールド番号（例: `1,3` や `2-`）', 'fields to select (e.g. `1,3`, `2-`)', 'arg lang:cutfields'],
  ['-c|--characters', '取り出す文字位置。リリースされている GNU coreutils の cut は `-b` と同じくバイトで数える（UTF-8 のロケールで文字を数えるディストリビューションもある）',
    'character positions to select; GNU coreutils as released counts bytes, as for `-b` (some distributions count characters in a UTF-8 locale)', 'arg lang:cutchars'],
  ['-b|--bytes', '取り出すバイト位置', 'byte positions to select', 'arg lang:cutchars'],
  ['-n', '何もしない（互換のため受け付ける）', 'ignored (accepted for compatibility)'],
  ...GNU_INFO,
], { example: 'cut', parser: 'getopt_long', positional: [files], positionalIo: ['input'] });
