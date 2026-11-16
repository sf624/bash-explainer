import { tx } from '../i18n';
import { cmd, GNU_INFO, optionOf, pos } from './types';

// GNU cut (coreutils 9.4). It counts bytes in every locale: `-c` as `-b`, and a delimiter is one byte.

const files = pos('対象のファイル', 'target file');

/**
 * GNU cut takes a delimiter of one byte (coreutils 9.4, in every locale): `-d ab` and `-dé` are refused, `-d ''` is the
 * NUL byte.
 */
const CUT_DELIMITER = {
  when: (v: string) => new TextEncoder().encode(v).length > 1,
  text: tx('cut は1バイトより長い区切り文字を受け付けない: `the delimiter must be a single character` と表示し、何もせずに終了ステータス 1 で終わる。ASCII 以外の文字は UTF-8 では複数バイトになる（`é` は2バイト、`、` は3バイト）',
    'cut refuses a delimiter of more than one byte: it says `the delimiter must be a single character`, and exits with status 1, doing nothing. A character beyond ASCII is several bytes in UTF-8 (`é` is 2, `、` is 3)'),
};

export const cut = cmd('各行から指定した列（フィールド）や文字位置を切り出す', 'Cut out selected fields or characters from each line', [
  ['-s|--only-delimited', '区切り文字のない行は出力しない', 'do not print lines without the delimiter'],
  ['--complement', '指定した以外を出力する', 'select everything except the given fields'],
  ['--output-delimiter', '出力の区切り文字', 'output delimiter', 'arg'],
  ['-z|--zero-terminated', '行の区切りを改行でなく NUL にする', 'lines end with NUL, not newline'],
  { ...optionOf(['-d|--delimiter', '区切り文字（既定はタブ）', 'field delimiter (default: tab)']), value: { name: 'VALUE', refuses: CUT_DELIMITER } },
  ['-f|--fields', '取り出すフィールド番号（例: `1,3` や `2-`）', 'fields to select (e.g. `1,3`, `2-`)', 'arg lang:cutfields'],
  ['-c|--characters', '取り出す文字位置（GNU の cut は `-b` と同じくバイトで数える。ASCII 以外の文字は UTF-8 では複数バイトなので、文字の途中で切れることがある）',
    'character positions to select (GNU cut counts bytes, as for `-b`: a character beyond ASCII is several bytes in UTF-8, and may be cut in two)', 'arg lang:cutchars'],
  ['-b|--bytes', '取り出すバイト位置', 'byte positions to select', 'arg lang:cutchars'],
  ['-n', '何もしない（互換のため受け付ける）', 'ignored (accepted for compatibility)'],
  ...GNU_INFO,
], { example: 'cut', parser: 'getopt_long', positional: [files], positionalIo: ['input'] });
