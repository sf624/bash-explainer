import type { Condition, OperandAlt } from '../argv/spec';
import { byCount, cmd, EXTRA_OPERAND, extraOperand, GNU_INFO, lackingOperand, pos } from './types';

/**
 * The operands of `tr`, by the options and the count (checked against GNU coreutils 9.4): the sets to delete (`-d`) or
 * to squeeze (`-s`), or to translate (neither); with `-d` alone only one set is taken (the second word is refused with
 * a line of its own, the later ones without); a lone set when translating, or when deleting and squeezing, is refused.
 */
const TR_BOTH: Condition = { all: [{ option: ['-d', '--delete'] }, { option: ['-s', '--squeeze-repeats'] }] };
const TR_DELETE = pos('削除する文字集合', 'character set to delete');
const TR_TRANSLATE = [pos('変換元の文字集合（例: `a-z`）', 'source character set (e.g. `a-z`)'), pos('変換先の文字集合（例: `A-Z`）', 'target character set (e.g. `A-Z`)')];
// (GNU tr reads options up to the first operand, `+` in its getopt string: `tr a -d` translates `a` to `-`, `tr a b -d` refuses `-d`.)
const TR_OPERANDS: OperandAlt[] = [
  { when: TR_BOTH, ...byCount(0, [], { extra: lackingOperand('missing operand after', 'Two strings must be given when both deleting and squeezing repeats.', 1) }) },
  { when: TR_BOTH, ...byCount(2, [TR_DELETE, pos('連続を1つにまとめる文字集合', 'character set whose repeats are squeezed')], { langs: ['trset', 'trset'], extra: EXTRA_OPERAND }) },
  byCount(1, [TR_DELETE], { when: '-d|--delete', langs: ['trset'], extra: extraOperand('extra operand', 1, { also: 'Only one string may be given when deleting without squeezing repeats.', once: true }) }),
  byCount(1, [TR_DELETE], { when: '-d|--delete', langs: ['trset'], extra: EXTRA_OPERAND }),
  byCount(1, [pos('連続を1つにまとめる文字集合', 'character set whose repeats are squeezed')], { when: '-s|--squeeze-repeats', langs: ['trset'] }),
  byCount(2, TR_TRANSLATE, { when: '-s|--squeeze-repeats', langs: ['trset', 'trset'], extra: EXTRA_OPERAND }),
  byCount(0, [], { extra: lackingOperand('missing operand after', 'Two strings must be given when translating.', 1) }),
  byCount(2, TR_TRANSLATE, { langs: ['trset', 'trset'], extra: EXTRA_OPERAND }),
];

export const tr = cmd('文字を置換・削除する（標準入力のみ）', 'Translate or delete characters (stdin only)', [
  ['-t|--truncate-set1', '1つ目の文字集合を2つ目の長さに切り詰める', 'truncate the first set to the length of the second'],
  ['-d|--delete', '指定した文字を削除する', 'delete the characters'],
  ['-s|--squeeze-repeats', '連続する同じ文字を1つにまとめる', 'squeeze repeated characters'],
  ['-c|-C|--complement', '指定した文字以外を対象にする', 'use the complement of the set'],
  ...GNU_INFO,
], { example: 'tr', parser: 'getopt_long', optionsFirst: true, operands: TR_OPERANDS });
