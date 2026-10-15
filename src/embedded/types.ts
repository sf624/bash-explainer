import type { Kind } from '../analyzer';
import type { Lang } from '../i18n';

/** A token inside an embedded language (regex, sed script, jq filter, awk program). */
export interface EmbeddedToken {
  /** Offsets into the embedded source text. */
  start: number;
  end: number;
  kind: Kind;
  explanation: string;
  children: EmbeddedToken[];
  /** Defaults to the source text between start and end. */
  label?: string;
}

export type EmbeddedLang = 'regex' | 'sed' | 'awk' | 'jq' | 'printf' | 'date' | 'glob';

/** Pick the string for the current language. */
export function pick(lang: Lang) {
  return (ja: string, en: string) => (lang === 'ja' ? ja : en);
}

/** Shift every token (and its children) by `delta`. */
export function shift(tokens: EmbeddedToken[], delta: number): EmbeddedToken[] {
  return tokens.map((t) => ({ ...t, start: t.start + delta, end: t.end + delta, children: shift(t.children, delta) }));
}
