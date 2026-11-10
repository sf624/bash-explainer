import { invisibleList, pictureList, visible, visibleChar } from './ctlchars';
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
  /**
   * Above the rows of a reading of the value that assumes no file name matches it (`ValueReading.assumes`; inline Markdown):
   * "Read below as `grep` gets it where no file name matches".
   */
  readingLead?: string;
}

/** Where the value is read in the language of its command (docs/design/known-values.md, 12): the command, and the parts of the value that make it a glob pattern. */
export interface ValueRead { command: string; globs: readonly string[] }

/** How many glob parts of a value are named (`its [A-Z], [0-9]`). */
const GLOBS_NAMED = 3;

/** The glob parts of a value named in a sentence: "`[A-Z]`, `[0-9]`" (Japanese "`[A-Z]`・`[0-9]`"), the first few. */
export function globsNamed(globs: readonly string[], ja: boolean): string {
  const named = globs.slice(0, GLOBS_NAMED).map(codeSpan).join(ja ? '・' : ', ');
  return globs.length > GLOBS_NAMED ? named + (ja ? 'など' : ' …') : named;
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
/** How a value made only of blanks, and an empty one, are named. */
const BLANKS: Record<string, readonly [ja: string, en: string, enPlural: string]> = { ' ': ['空白', 'space', 'spaces'], '\t': ['タブ', 'tab', 'tabs'] };

/** The bare name of a blank character (`' '`: 空白, space; `'\t'`: タブ, tab): the one table of these words (the IFS, the `tr` sets, the mark of a space). */
export function blankWord(ch: ' ' | '\t', ja: boolean): string {
  return BLANKS[ch][ja ? 0 : 1];
}

/** What an empty string is called in a sentence. */
export const emptyName = (ja: boolean): string => (ja ? '空文字列' : 'an empty string');

/**
 * What a value made only of blanks (spaces and tabs) is called: "a space", "2 spaces", "a tab", "a space and a tab" (Japanese
 * "空白", "空白2文字", "空白とタブ"); undefined for any other value, empty included. Such a value is invisible in a code span.
 */
export function blankName(v: string, ja: boolean): string | undefined {
  if (!/^[ \t]+$/.test(v)) return undefined;
  const runs = v.match(/ +|\t+/g)!.map((r) => {
    const [j, e, ep] = BLANKS[r[0]];
    return ja ? `${j}${r.length > 1 ? `${r.length}文字` : ''}` : r.length > 1 ? `${r.length} ${ep}` : `a ${e}`;
  });
  return runs.join(ja ? 'と' : ' and ');
}

/**
 * A value of a script in a sentence, as inline Markdown: a code span (`codeSpan`), and for a value that code cannot show, its name:
 * a value of blanks only gets it in parentheses after the span (`` ` ` (a space) ``, `` `⇥`（タブ） ``), an empty one is said
 * as "an empty string" with no span. `note`: a remark that belongs in the parentheses after the value, merged with the name
 * (`` ` ` (a space; no wildcards…) ``), so that two parentheses do not follow each other. `after`: in Japanese, the text that
 * follows a plain span (a space between code and kana), left out where the name's parenthesis ends the text.
 */
export function codeShown(v: string, ja: boolean, after = '', note = ''): string {
  const paren = (inner: string) => (ja ? `（${inner}）` : ` (${inner})`);
  const name = v === '' ? emptyName(ja) : blankName(v, ja);
  if (name === undefined) return codeSpan(v) + (note ? paren(note) : ja ? after : '');
  const said = note ? `${name}${ja ? '。' : '; '}${note}` : name;
  return v === '' ? name + (note ? paren(note) : '') : codeSpan(visible(v)) + paren(said);
}

/** How many words of a split value are shown. */
const WORDS_SHOWN = 12;

/**
 * A value, or a word of it, as the outputs show it: control characters as pictures, a space at either end as `␣`, an
 * empty word as `∅`, cut when long; `ends`: how many characters at each end are marks of a space.
 */
export function shownWord(t: string): { text: string; ends: SpaceEnds } {
  return shownPiece(t, { lead: true, trail: true });
}

/** `shownWord` of a piece of a word: `edges` say whether it starts (`lead`) and ends (`trail`) the whole word. (Not an optional parameter of `shownWord`: `.map(shownWord)` would pass an index.) */
export function shownPiece(t: string, edges: { lead: boolean; trail: boolean }): { text: string; ends: SpaceEnds } {
  // (A newline is shown as `␊`, as in the notes on quote removal, so that it is not read as the two characters `\n`.
  // A space at either end is `␣`: Markdown takes one space at each end of a code span as padding, and a chip or a
  // hover would hide it. An empty word of a split value is `∅`. The cut is on characters, not on UTF-16 units.)
  if (t === '') return { text: EMPTY_WORD, ends: [0, 0] };
  const chars = [...t].map((c) => (c === '\n' ? '␊' : visibleChar(c)));
  const cut = chars.length > VALUE_SHOWN;
  const units = cut ? [...chars.slice(0, VALUE_SHOWN - 1), '…'] : chars;
  const first = units.findIndex((c) => c !== ' ');
  const last = units.map((c) => c !== ' ').lastIndexOf(true);
  // (`edges`: which ends of the text are an end of the whole word. A piece of a word beside a placeholder has an inner end, where a space shows as it is.
  // A text of spaces only has both ends in one: it is marked if either is an end of the word.)
  const marked = units.map((c, i) => c === ' ' && ((edges.lead && (first < 0 || i < first)) || (edges.trail && !cut && (first < 0 || i > last))));
  const firstText = marked.indexOf(false);
  const lead = firstText < 0 ? 0 : firstText;
  const trail = firstText < 0 ? marked.length : marked.length - 1 - marked.lastIndexOf(false);
  return { text: units.map((c, i) => (marked[i] ? SPACE_MARK : c)).join(''), ends: [lead, trail] };
}

/**
 * The texts of the value of an expansion, in `lang`; `bash`: false in a script of sh or dash (the shell runs it, not bash).
 * `read`: the command reads the value in a language of its own, so a glob in it is said as what bash does before the command
 * gets it (docs/design/known-values.md, 12), with the lead of the reading's rows.
 */
export function valueSaid(lang: Lang, v: ExpansionValue, bash = true, read?: ValueRead): ValueSaid {
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
    tails.push(ja ? '。クォートしていないので、ワイルドカードを含む単語が前後の文字列とつながったままグロブのパターンとして働き、実行するときにファイル名と照合される（ここでは照合しない）'
      : '. Unquoted, the word its wildcards end up in, with the text around it, is a glob pattern: bash matches it against file names when the line runs (not done here)');
  } else if (v.glob && read) {
    const named = globsNamed(read.globs, ja);
    tails.push(ja ? `。クォートしていないので、${bash ? 'bash ' : 'シェル'}は \`${read.command}\` に渡す前に値をグロブのパターンとしても読み（${named}）、実行するときにファイル名と照合する（ここでは照合しない）`
      : `. Unquoted, ${bash ? 'bash' : 'the shell'} also reads it as a glob pattern (its ${named}) before \`${read.command}\` gets it, and matches it against file names when the line runs (not done here)`);
  } else if (v.glob) {
    tails.push(ja ? '。クォートしていないのでグロブのパターンとして働き、実行するときにファイル名と照合される（ここでは照合しない）'
      : `. Unquoted, it is a glob pattern: ${bash ? 'bash' : 'the shell'} matches it against file names when the line runs (not done here)`);
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
  const empty = emptyName(ja);
  const text = `${lead} ${value !== undefined ? codeSpan(value) : empty}${split ? split.said + split.words.map((w) => ` ${codeSpan(w)}`).join('') : ''}${tail ?? ''}`;
  return {
    lead,
    ...(value !== undefined ? { value, valueEnds: shownValue!.ends } : { empty }),
    ...(split ? { split } : {}),
    ...(spaced ? { spaceLabel: blankWord(' ', ja) } : {}),
    ...(tail ? { tail } : {}),
    text,
    ...(v.glob && read ? { readingLead: ja ? `以下は、一致するファイル名がないときに \`${read.command}\` が受け取る値の読み方` : `Read below as \`${read.command}\` gets it where no file name matches` } : {}),
  };
}
