// The words of a command that the tool running it replaces first (find's `{}`, xargs's `-I%`): `PlaceholderSpec` says what the text is,
// and the interpreter gives the command's role the words that are it (`CommandRole.placeholder`).
import type { ArgWord } from './interpret';
import type { InEffect } from './modes';
import type { PlaceholderSpec } from './spec';
import { untilWord } from './until';

/**
 * The words of a command that the tool running it replaces first (`PlaceholderSpec`): the text, the option that replaces it (`-exec`, `-I`), what with, and
 * the words (their indices) that are that text alone (`whole`: `{}`, `'{}'`) and those that hold it with other text (`within`: `%.bak`).
 */
export interface PlaceholderRole { by: string; text: string; with: PlaceholderSpec['with']; whole: number[]; within: number[] }

/**
 * The words from `from` to `to` that the tool replaces before it runs the command, by their value after quote removal, as the field `placeholder`
 * of the command's role (none when no word is); `anywhere`: also those that hold the text among other text. `flag` is the option that has the text where
 * the spec does not name one (find's `-exec`); else the text is the value of the option in effect of the spec's mode (`inEffect`, `settleModes`: a
 * later `-n2` turns `-I` off), or the spec's default where it takes none; a value not known, or empty, is none.
 */
export function placeholderIn(p: PlaceholderSpec | undefined, words: readonly ArgWord[], inEffect: Map<string, InEffect> | undefined, from: number, to: number, anywhere: boolean, flag?: string): { placeholder?: PlaceholderRole } {
  if (!p) return {};
  let text: string | undefined;
  let by = flag!;
  if (typeof p.text === 'string') text = p.text;
  else {
    const e = inEffect?.get(p.text.mode);
    if (!e) return {};
    text = e.present ? e.value : p.text.default;
    by = e.flag;
  }
  if (!text) return {};
  const whole: number[] = [];
  const within: number[] = [];
  for (let i = from; i < to; i++) {
    const w = untilWord(words[i]);
    if (w === text) whole.push(i);
    else if (anywhere && w?.includes(text)) within.push(i);
  }
  return whole.length || within.length ? { placeholder: { by, text, with: p.with, whole, within } } : {};
}
