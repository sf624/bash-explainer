import type { Refused } from '../argv/spec';
import { tx } from '../i18n';
import { codeSpan } from '../label';
import { cmd, GNU_INFO, optionOf, pos, refusing } from './types';

// GNU cut, as coreutils 9.4 is released: it counts bytes in every locale, `-c` as `-b` ("The same as ‘-b’ for now, but
// internationalization will change that": the coreutils manual, "cut invocation"), and a delimiter is one byte. The i18n
// patch of some distributions makes `-c` count characters in a UTF-8 locale.

const files = pos('対象のファイル', 'target file');

/** The node of the coreutils manual on cut's words (src/references.ts). */
const CUT_REF = 'coreutils-cut-invocation';

/**
 * GNU cut takes a delimiter of one byte (coreutils 9.4, in every locale): `-d ab` and `-dé` are refused as it reads the
 * option, with the cause that applies (several characters, or one of several bytes in UTF-8: BSD cut takes that one); `-d '\t'`
 * is a backslash and `t`, and tab is the default. (`-d ''` is the NUL byte.)
 */
function cutDelimiter(v: string): Refused | undefined {
  const bytes = new TextEncoder().encode(v).length;
  if (bytes <= 1) return undefined;
  const chars = [...v].length;
  const why = v === '\\t'
    ? tx('cut は `\\t` をタブとして読まない（バックスラッシュと `t` の2文字）。タブは既定の区切り文字なので、`-d` を書かないか、`-d $\'\\t\'` と書く',
      'cut does not read `\\t` as a tab: it is a backslash and `t`. Tab is the default delimiter: leave out `-d`, or write `-d $\'\\t\'`')
    : chars > 1 ? tx(`区切り文字は1バイトでなければならず、${codeSpan(v)} は${chars}文字`, `The delimiter must be one byte, and ${codeSpan(v)} is ${chars} characters`)
      : tx(`区切り文字は1バイトでなければならず、${codeSpan(v)} は1文字だが、UTF-8 では${bytes}バイトになる`, `The delimiter must be one byte, and ${codeSpan(v)} is one character, but ${bytes} bytes in UTF-8`);
  return { says: 'the delimiter must be a single character', status: 1, why, ref: CUT_REF, ...(chars === 1 ? { gnu: true as const } : {}) };
}

/**
 * A list of GNU cut (`-f 1,3-`, `-c 0`): numbers and ranges, by commas or blanks, which it reads once it has read all its
 * options, item by item: it refuses a 0 where an item starts (`0`, `0-3`, `1,0`: `zero`, "fields are numbered from 1"), and a
 * range whose end is before its start (`3-1`, `1-0`, `-0`: "invalid decreasing range"), the first one first. An item it
 * cannot read (`x`, an empty one) has a message of its own, and gives nothing here.
 */
const listRefused = (zero: string) => (v: string): (Refused & { late: true }) | undefined => {
  const said = (says: string): Refused & { late: true } => ({ says, status: 1, late: true, ref: CUT_REF });
  for (const item of v.split(/[,\t ]/)) {
    const m = /^(\d*)(-?)(\d*)$/.exec(item);
    if (!m || (!m[1] && !m[3])) return undefined;
    const [, lo, , hi] = m;
    if (/^0+$/.test(lo)) return said(zero);
    if (!lo ? /^0+$/.test(hi) : hi && Number(hi) < Number(lo)) return said('invalid decreasing range');
  }
  return undefined;
};

const POSITIONS = listRefused('byte/character positions are numbered from 1');

export const cut = cmd('各行から指定した列（フィールド）や文字位置を切り出す', 'Cut out selected fields or characters from each line', [
  ['-s|--only-delimited', '区切り文字のない行は出力しない', 'do not print lines without the delimiter'],
  ['--complement', '指定した以外を出力する', 'select everything except the given fields'],
  ['--output-delimiter', '出力の区切り文字', 'output delimiter', 'arg'],
  ['-z|--zero-terminated', '行の区切りを改行でなく NUL にする', 'lines end with NUL, not newline'],
  { ...optionOf(['-d|--delimiter', '区切り文字（既定はタブ）', 'field delimiter (default: tab)']), value: { name: 'VALUE', refuses: cutDelimiter } },
  { ...refusing(['-f|--fields', '取り出すフィールド番号（例: `1,3` や `2-`）', 'fields to select (e.g. `1,3`, `2-`)', 'arg lang:cutfields'], listRefused('fields are numbered from 1')), selects: 'fields' },
  { ...refusing(['-c|--characters', '取り出す文字位置。リリースされている GNU coreutils の cut は `-b` と同じくバイトで数える（UTF-8 のロケールで文字を数えるディストリビューションもある）',
    'character positions to select; GNU coreutils as released counts bytes, as for `-b` (some distributions count characters in a UTF-8 locale)', 'arg lang:cutchars'], POSITIONS), selects: 'positions' },
  { ...refusing(['-b|--bytes', '取り出すバイト位置', 'byte positions to select', 'arg lang:cutchars'], POSITIONS), selects: 'positions' },
  ['-n', '何もしない（互換のため受け付ける）', 'ignored (accepted for compatibility)'],
  ...GNU_INFO,
], {
  example: 'cut', parser: 'getopt_long', positional: [files], positionalIo: ['input'],
  // (One list, of `-b`, `-c` or `-f`, given once: GNU cut refuses a second one as it reads it. BSD cut refuses `-f` with
  // `-b` or `-c`, but takes `-b` with `-c`, or two `-f`: the second refusal is GNU's.)
  modes: [{ name: 'positions' }, { name: 'fields' }],
  conflictingModes: { says: 'only one list may be specified', status: 1, ref: CUT_REF, once: { says: 'only one list may be specified', status: 1, gnu: true, ref: CUT_REF } },
  needsMode: { says: 'you must specify a list of bytes, characters, or fields', status: 1, ref: CUT_REF },
});
