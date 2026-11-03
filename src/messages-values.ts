import { invisibleList, pictureList, visibleChar } from './ctlchars';
import type { Lang } from './i18n';
import { codeSpan } from './label';
import type { ExpansionValue } from './semantics/values';

// What the outputs say of the value of an expansion (`Token.value`), out of the catalog (src/messages.ts re-exports it).

/**
 * What the outputs say of the value of an expansion where it runs (`Token.value`; docs/design/expansion-values.md):
 * the model's value, from the script's own assignments, not bash's output. The panel draws `value` and the words of
 * `split` as chips between the texts; the other outputs show `text`.
 */
export interface ValueSaid {
  /** Before the value: "Value here, from the script:". */
  lead: string;
  /** The value as shown (control characters as pictures, cut when long); absent when it is empty (then `empty`). */
  value?: string;
  /** How many characters at each end of `value` are marks of a space (`␣`), for the outputs that draw them (see `spaceLabel`). */
  valueEnds?: SpaceEnds;
  /** "an empty string", in place of `value`. */
  empty?: string;
  /** What word splitting makes of it, when that is not the value itself: the text before the words, and the words as shown. */
  split?: { said: string; words: string[]; wordEnds: SpaceEnds[] };
  /** What a drawn mark of a space is called ("space"), when `value` or a word has one: the label of the panel's and the hover's mark. */
  spaceLabel?: string;
  /** After the rest: a glob in the value, what the control characters' pictures are (inline Markdown, with no value in it). */
  tail?: string;
  /** The whole line in inline Markdown, for the outputs with no chips (the hover, Markdown, the CLI). */
  text: string;
}

/** The characters at the start and at the end of a shown text that are marks of a space. */
export type SpaceEnds = readonly [lead: number, trail: number];

/** How long a value, or a word of it, is shown; a longer one is cut. */
const VALUE_SHOWN = 80;
/**
 * How a space at either end of a value, and an empty word of a split value, are shown in the outputs that are text only.
 * U+2423 (OPEN BOX) is in far more fonts than U+2420 (SYMBOL FOR SPACE), which a machine with few fonts draws as a box;
 * the panel and the hover draw the mark themselves (`SpaceEnds`), and use this one only where a note names it.
 */
export const SPACE_MARK = '␣';
export const EMPTY_WORD = '∅';
/** How many words of a split value are shown. */
const WORDS_SHOWN = 12;

/**
 * A value, or a word of it, as the outputs show it: control characters as pictures, a space at either end as `␣`, an
 * empty word as `∅`, cut when long; `ends`: how many characters at each end are marks of a space.
 */
export function shownWord(t: string): { text: string; ends: SpaceEnds } {
  // (A newline is shown as `␊`, as in the notes on quote removal, so that it is not read as the two characters `\n`.
  // A space at either end is `␣`: Markdown takes one space at each end of a code span as padding, and a chip or a
  // hover would hide it. An empty word of a split value is `∅`. The cut is on characters, not on UTF-16 units.)
  if (t === '') return { text: EMPTY_WORD, ends: [0, 0] };
  const chars = [...t].map((c) => (c === '\n' ? '␊' : visibleChar(c)));
  const cut = chars.length > VALUE_SHOWN;
  const units = cut ? [...chars.slice(0, VALUE_SHOWN - 1), '…'] : chars;
  const first = units.findIndex((c) => c !== ' ');
  const last = units.map((c) => c !== ' ').lastIndexOf(true);
  const marked = units.map((c, i) => c === ' ' && (i < first || (!cut && i > last)));
  const firstText = marked.indexOf(false);
  const lead = firstText < 0 ? 0 : firstText;
  const trail = firstText < 0 ? marked.length : marked.length - 1 - marked.lastIndexOf(false);
  return { text: units.map((c, i) => (marked[i] ? SPACE_MARK : c)).join(''), ends: [lead, trail] };
}

/** The texts of the value of an expansion, in `lang`; `bash`: false in a script of sh or dash (the shell runs it, not bash). */
export function valueSaid(lang: Lang, v: ExpansionValue, bash = true): ValueSaid {
  const ja = lang === 'ja';
  const show = shownWord;
  const lead = ja ? 'スクリプトから分かるここでの値:' : 'Value here, from the script:';
  const shownValue = v.text === '' ? undefined : show(v.text);
  const value = shownValue?.text;
  const words = v.words;
  let split: ValueSaid['split'];
  if (words && !(words.length === 1 && words[0] === v.text)) {
    const n = words.length;
    const shown = words.slice(0, WORDS_SHOWN).map(show);
    const more = n > WORDS_SHOWN ? (ja ? `（最初の ${WORDS_SHOWN} 語）` : ` (the first ${WORDS_SHOWN})`) : '';
    split = n === 0
      ? { said: ja ? '。クォートしていないので単語分割され、単語は残らない' : '; unquoted, it is split and gives no word', words: [], wordEnds: [] }
      : { said: ja ? `。クォートしていないので単語分割され、${n} 語になる${more}:` : `; unquoted, it is split into ${n === 1 ? '1 word' : `${n} words`}${more}:`, words: shown.map((w) => w.text), wordEnds: shown.map((w) => w.ends) };
  }
  const tails: string[] = [];
  if (v.glob && v.joined) {
    tails.push(ja ? '。クォートしていないので、ワイルドカードを含む単語が前後の文字列とつながったままパターンとして働き、実行するときにファイル名と照合される（ここでは照合しない）'
      : '. Unquoted, the word its wildcards end up in, with the text around it, is a pattern: bash matches it against file names when the line runs (not done here)');
  } else if (v.glob) {
    tails.push(ja ? '。クォートしていないのでパターンとして働き、実行するときにファイル名と照合される（ここでは照合しない）'
      : `. Unquoted, it is a pattern: ${bash ? 'bash' : 'the shell'} matches it against file names when the line runs (not done here)`);
  }
  const shownTexts = [value ?? '', ...(split?.words ?? [])];
  const pictures = pictureList(shownTexts, (j, e) => (ja ? j : e));
  if (pictures) tails.push(ja ? `（制御文字は記号で表している: ${pictures}）` : ` (control characters are shown as symbols: ${pictures})`);
  const escapes = invisibleList(shownTexts, (j, e) => (ja ? j : e));
  if (escapes) tails.push(ja ? `（見えない文字はコードで表している: ${escapes}）` : ` (invisible characters are shown as their code: ${escapes})`);
  const spaced = [shownValue?.ends, ...(split?.wordEnds ?? [])].some((e) => e && e[0] + e[1] > 0);
  const marks = [
    ...(spaced ? [ja ? `\`${SPACE_MARK}\` は端の空白` : `\`${SPACE_MARK}\` is a space at an end`] : []),
    ...(split?.words.includes(EMPTY_WORD) ? [ja ? `\`${EMPTY_WORD}\` は空の単語` : `\`${EMPTY_WORD}\` is an empty word`] : []),
  ];
  if (marks.length) tails.push(ja ? `（${marks.join('、')}）` : ` (${marks.join(', ')})`);
  const tail = tails.length ? tails.join('') : undefined;
  const empty = ja ? '空文字列' : 'an empty string';
  const text = `${lead} ${value !== undefined ? codeSpan(value) : empty}${split ? split.said + split.words.map((w) => ` ${codeSpan(w)}`).join('') : ''}${tail ?? ''}`;
  return {
    lead,
    ...(value !== undefined ? { value, valueEnds: shownValue!.ends } : { empty }),
    ...(split ? { split } : {}),
    ...(spaced ? { spaceLabel: ja ? '空白' : 'space' } : {}),
    ...(tail ? { tail } : {}),
    text,
  };
}
