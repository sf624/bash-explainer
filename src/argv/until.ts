import type { OptionSpec } from './spec';

/**
 * Where the command of an option with `until` ends: the index of its terminator in `words` (from `from`, before `end`), or
 * `end` when none ends it. A terminator that `endsAfter` names counts only right after a word holding its text (`+` after
 * `{}`; the first word of the command has no word before it), else it is a word of the command. The tool refuses the whole
 * line, and runs nothing (`refused`), when no terminator ends the command (find: "missing argument to `-exec'"), when the
 * word before such a terminator is not that text alone ("the {} must appear by itself"), or when another word holds it
 * ("Only one instance of {} is supported"). Words whose value is not known (`undefined`) hold nothing.
 */
export function untilEnd(until: NonNullable<OptionSpec['until']>, words: readonly (string | undefined)[], from: number, end: number): { at: number; refused: boolean } {
  let at = from;
  let marker: string | undefined;
  for (; at < end; at++) {
    const w = words[at] ?? '';
    if (!until.terminators.includes(w)) continue;
    marker = until.endsAfter?.[w];
    if (marker === undefined || (at > from && words[at - 1]?.includes(marker))) break;
    marker = undefined;
  }
  const batched = marker !== undefined && at < end;
  return { at, refused: at >= end || (batched && (words[at - 1] !== marker || words.slice(from, at - 1).some((x) => x?.includes(marker!)))) };
}
