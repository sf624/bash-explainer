import type { Lang, Text } from './i18n';

// The message catalog: the notes and pitfalls that render a fact of the semantic models (src/semantics/: the shell
// state, where code runs, words, names, status), each with a stable id, its texts in ja and en, and the sections of
// the Bash manual it is about (src/manual.ts). The renderers show the sections as links, or as "(Bash manual 3.7.5)"
// in the CLI; the JSON output gives the id.
//
// The texts are the analyzer's: a fact is found where the model is read (src/analyzer.ts, src/statusfacts.ts,
// src/wordfacts.ts), and said here. The style checks of src/pitfalls.ts are not facts and have no entry.

/** `note`: said with ℹ. `pitfall`: with ⚠, and only when the pitfalls are on. */
export type FactKind = 'note' | 'pitfall';

interface Entry<P> {
  kind: FactKind;
  refs: readonly string[];
  /** The text in Japanese and English, without the ℹ or ⚠ that `kind` gives. */
  text: (p: P) => readonly [ja: string, en: string];
}

const entry = <P = Record<string, never>>(kind: FactKind, refs: readonly string[], text: (p: P) => readonly [string, string]): Entry<P> => ({ kind, refs, text });

/** A text in both languages, for a parameter that is itself words (where `set -e` is ignored…). */
type Words = Text;

export const MESSAGES = {
  // ---------------------------------------------------------------- exit status (3.7.5)
  'exit-modulo': entry<{ value: string; status: number }>('note', ['3.7.5'], ({ value, status }) => [
    `終了ステータスは 0〜255 なので、\`${value}\` は 256 で割った余りの ${status} になる`,
    `An exit status is 0–255, so \`${value}\` becomes ${status} (the value modulo 256)`]),
} satisfies Record<string, Entry<never>>;

export type FactId = keyof typeof MESSAGES;
type Params<K extends FactId> = Parameters<(typeof MESSAGES)[K]['text']>[0];

/** A fact as a note: its id, its text (with ℹ or ⚠), and the sections it cites. */
export interface Fact { id: FactId; kind: FactKind; text: string; refs: readonly string[] }

const PREFIX: Record<FactKind, Text> = {
  note: { ja: 'ℹ ', en: 'ℹ ' },
  pitfall: { ja: '⚠ 落とし穴: ', en: '⚠ Pitfall: ' },
};

/** The note of a fact, in `lang`. */
export function fact<K extends FactId>(lang: Lang, id: K, ...params: Params<K> extends Record<string, never> ? [] : [Params<K>]): Fact {
  const e = MESSAGES[id] as Entry<unknown>;
  const [ja, en] = e.text(params[0]);
  return { id, kind: e.kind, text: PREFIX[e.kind][lang] + (lang === 'ja' ? ja : en), refs: e.refs };
}

export type { Words };
