import type { NoteLevel } from './levels';

// What an entry of the catalog of token texts is (src/messages-tokens.ts), apart from the catalog, so that its parts can use it.

/** A text a token says: in Japanese and English, and, for a warning inside a row's sentence, its level. */
export interface TokenEntry<P> {
  text: (p: P) => readonly [ja: string, en: string];
  level?: NoteLevel;
}

/** A token's text. */
export const tokenText = <P = Record<string, never>>(text: (p: P) => readonly [string, string]): TokenEntry<P> => ({ text });

/** A text that warns: a row draws the level's mark before it, and has its level. */
export const tokenWarning = <P = Record<string, never>>(text: (p: P) => readonly [string, string]): TokenEntry<P> => ({ text, level: 'warning' });
