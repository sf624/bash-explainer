import type { Condition, OperandAlt } from '../argv/spec';
import { byCount, cmd, EXTRA_OPERAND, extraOperand, GNU_INFO, lackingOperand, pos } from './types';

/**
 * The operands of `tr`, by the options and the count (checked against GNU coreutils 9.4): the sets to delete (`-d`) or
 * to squeeze (`-s`), or to translate (neither); with `-d` alone only one set is taken (the second word is refused with
 * a line of its own, the later ones without); a lone set when translating, or when deleting and squeezing, is refused.
 */
const TR_DELETE_OPT: Condition = { option: ['-d', '--delete'] };
const TR_SQUEEZE_OPT: Condition = { option: ['-s', '--squeeze-repeats'] };
const TR_BOTH: Condition = { all: [TR_DELETE_OPT, TR_SQUEEZE_OPT] };
const TR_DELETING: Condition = { all: [TR_DELETE_OPT, { not: TR_SQUEEZE_OPT }] };
const TR_SQUEEZING: Condition = { all: [TR_SQUEEZE_OPT, { not: TR_DELETE_OPT }] };
const TR_COMPLEMENT: Condition = { option: ['-c', '-C', '--complement'] };
/** The same options as `when`, with `-c`: the set is the characters left alone, and tr works on all the others. */
const withComplement = (when: Condition | undefined): Condition => ({ all: when ? [TR_COMPLEMENT, when] : [TR_COMPLEMENT] });
const TR_DELETE = pos('削除する文字集合', 'character set to delete');
const TR_KEEP = pos('残す文字集合（これ以外をすべて削除する）', 'character set to keep (every other character is deleted)');
const TR_SQUEEZE_REST = pos('そのままにする文字集合（これ以外の文字の連続を1つにまとめる）', 'character set to leave alone (repeats of every other character are squeezed)');
const TR_TRANSLATE_REST = [pos('そのままにする文字集合（これ以外をすべて置き換える）', 'character set to leave as is (every other character is replaced)'), pos('変換先の文字集合（例: `A-Z`）', 'target character set (e.g. `A-Z`)')];
const TR_TRANSLATE = [pos('変換元の文字集合（例: `a-z`）', 'source character set (e.g. `a-z`)'), pos('変換先の文字集合（例: `A-Z`）', 'target character set (e.g. `A-Z`)')];
// (GNU tr reads options up to the first operand, `+` in its getopt string: `tr a -d` translates `a` to `-`, `tr a b -d` refuses `-d`.)
// (`-c` complements the first set only: `-cds` keeps a set and squeezes another, and the labels follow.)
const TR_OPERANDS: OperandAlt[] = [
  { when: withComplement(TR_BOTH), ...byCount(2, [TR_KEEP, pos('連続を1つにまとめる文字集合', 'character set whose repeats are squeezed')], { langs: ['trset', 'trset'], extra: EXTRA_OPERAND }) },
  { when: withComplement(TR_DELETING), ...byCount(1, [TR_KEEP], { langs: ['trset'], extra: extraOperand('extra operand', 1, { also: 'Only one string may be given when deleting without squeezing repeats.', once: true }) }) },
  { when: withComplement(TR_DELETING), ...byCount(1, [TR_KEEP], { langs: ['trset'], extra: EXTRA_OPERAND }) },
  { when: withComplement(TR_SQUEEZING), ...byCount(1, [TR_SQUEEZE_REST], { langs: ['trset'] }) },
  { when: withComplement(TR_SQUEEZING), ...byCount(2, TR_TRANSLATE_REST, { langs: ['trset', 'trset'], extra: EXTRA_OPERAND }) },
  { when: withComplement(undefined), ...byCount(2, TR_TRANSLATE_REST, { langs: ['trset', 'trset'], extra: EXTRA_OPERAND }) },
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
