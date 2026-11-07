// The words of a command that the tool running it replaces first (find's `{}`, xargs's `-I%`): `PlaceholderSpec` says what the text is,
// and the interpreter gives the command's role the words that are it (`CommandRole.placeholder`).
import type { ArgWord } from './interpret';
import type { InEffect } from './modes';
import type { PlaceholderSpec } from './spec';
import { untilWord } from './until';

/**
 * The words of a command that the tool running it replaces first (`PlaceholderSpec`): the text, the option that replaces it (`-exec`, `-I`), what with, and
 * the words (their indices) that are that text alone (`whole`: `{}`, `'{}'`) and those that hold it with other text (`within`: `%.bak`), with where the
 * text starts in each of these, by its value (`at`, as `within`: the tool replaces each from the left, `{}` of `mv {} {}.bak`, past what it replaced).
 */
export interface PlaceholderRole { by: string; text: string; with: PlaceholderSpec['with']; whole: number[]; within: number[]; at: number[][] }

/**
 * The words from `from` to `to` that the tool replaces before it runs the command, by their value after quote removal, as the field `placeholder`
 * of the command's role (none when no word is); with `anywhere`, also those that hold the text among other text, unless the command is run in batches
 * (`batch`: find's `+` replaces only the one `{}` before it). `flag` is the option that has the text where the spec does not name one (find's `-exec`); else the text is the value of the option in effect of the spec's mode (`inEffect`, `settleModes`: a
 * later `-n2` turns `-I` off, and then the operands are not those of its mode), or the spec's default where it takes none; a value not known, or empty, is none.
 */
export function placeholderIn(p: PlaceholderSpec | undefined, words: readonly ArgWord[], inEffect: Map<string, InEffect> | undefined, from: number, to: number, flag?: string, batch = false): { placeholder?: PlaceholderRole } {
  if (!p) return {};
  let text: string | undefined;
  let by = flag!;
  if (typeof p.text === 'string') text = p.text;
  else {
    // (The operands of that mode are read only while the mode is in effect, so its option is: `settleModes` gave it.)
    const e = inEffect!.get(p.text.mode)!;
    text = e.present ? e.value : p.text.default;
    by = e.flag;
  }
  if (!text) return {};
  const whole: number[] = [];
  const within: number[] = [];
  const at: number[][] = [];
  for (let i = from; i < to; i++) {
    const w = untilWord(words[i]);
    if (w === text) whole.push(i);
    else if (p.anywhere && !batch && w?.includes(text)) {
      within.push(i);
      const starts: number[] = [];
      for (let k = w.indexOf(text); k >= 0; k = w.indexOf(text, k + text.length)) starts.push(k);
      at.push(starts);
    }
  }
  return whole.length || within.length ? { placeholder: { by, text, with: p.with, whole, within, at } } : {};
}
