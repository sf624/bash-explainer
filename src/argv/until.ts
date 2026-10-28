import type { OptionSpec } from './spec';

/**
 * Why the tool refuses a command of an option with `until`: no terminator ends it (`missing`: find "missing argument to
 * `-exec'"), the terminator comes first (`empty`: "invalid argument `;' to `-exec'"), the word before a batching terminator
 * is not the marker alone (`alone`, with that `word`: "the {} must appear by itself"), or another word holds the marker
 * (`once`: "Only one instance of {} is supported").
 */
export interface UntilRefusal { why: 'missing' | 'empty' | 'alone' | 'once'; word?: string }

/**
 * Where the command of an option with `until` ends: the index of its terminator in `words` (from `from`, before `end`), or
 * `end` when none ends it. A terminator that `endsAfter` names counts only right after a word holding its text (`+` after
 * `{}`; the first word of the command has no word before it), else it is a word of the command. The tool refuses the whole
 * line, and runs nothing (`refusal`), when the command is wrong in one of the ways of `UntilRefusal`. Words whose value is
 * not known (`undefined`) hold nothing.
 */
export function untilEnd(until: NonNullable<OptionSpec['until']>, words: readonly (string | undefined)[], from: number, end: number): { at: number; refusal?: UntilRefusal } {
  let at = from;
  let marker: string | undefined;
  for (; at < end; at++) {
    const w = words[at] ?? '';
    if (!until.terminators.includes(w)) continue;
    marker = until.endsAfter?.[w];
    if (marker === undefined || (at > from && words[at - 1]?.includes(marker))) break;
    marker = undefined;
  }
  if (at >= end) return { at, refusal: { why: 'missing' } };
  if (at === from) return { at, refusal: { why: 'empty' } };
  if (marker === undefined) return { at };
  if (words.slice(from, at - 1).some((x) => x?.includes(marker!))) return { at, refusal: { why: 'once' } };
  return words[at - 1] === marker ? { at } : { at, refusal: { why: 'alone', word: words[at - 1] } };
}
