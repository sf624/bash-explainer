export type Lang = 'ja' | 'en';

/** A piece of text available in every supported language. */
export interface Text {
  ja: string;
  en: string;
}

export const tx = (ja: string, en: string): Text => ({ ja, en });

export function resolveLang(setting: string | undefined, uiLanguage: string): Lang {
  if (setting === 'ja' || setting === 'en') return setting;
  return uiLanguage.toLowerCase().startsWith('ja') ? 'ja' : 'en';
}

/** An English ordinal: 1st, 2nd, 3rd, 4th, 11th, 21st. */
export const ordinal = (n: number | bigint): string => {
  const r = typeof n === 'bigint' ? Number(n % 100n) : n % 100;
  return `${n}${r >= 11 && r <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][r % 10] ?? 'th'}`;
};

/**
 * How a line number is written (the one source of the label; docs/design/sources.md, row 17). Japanese writes it 行 N
 * everywhere (docs/japanese-style.md). English has three forms: `long` heads a view ("Line 5"), `inline` sits inside a
 * sentence or in brackets ("line 5"), `compact` is the status line of the web page's editor ("Ln 5").
 */
export type LineForm = 'long' | 'inline' | 'compact';

const LINE_EN: Record<LineForm, (n: number) => string> = {
  long: (n) => `Line ${n}`,
  inline: (n) => `line ${n}`,
  compact: (n) => `Ln ${n}`,
};

/** The label of line `n` (counted from 1) in the form asked for. */
export const lineLabel = (lang: Lang, n: number, form: LineForm = 'long'): string => (lang === 'ja' ? `行 ${n}` : LINE_EN[form](n));

/** A range of lines (counted from 1): `行 3〜5`, `lines 3–5`; one line when both ends are the same. */
export const lineRangeLabel = (lang: Lang, a: number, b: number): string =>
  a === b ? lineLabel(lang, a, 'inline') : lang === 'ja' ? `行 ${a}〜${b}` : `lines ${a}–${b}`;

/** The lines of a list of numbers (counted from 1, in the order given): `行 1、3`, `line 1`, `lines 1 and 3`, `lines 1, 2 and 3`. */
export const lineListLabel = (lang: Lang, lines: readonly number[]): string =>
  lang === 'ja' ? `行 ${lines.join('、')}` : lines.length === 1 ? lineLabel(lang, lines[0]!, 'inline') : `lines ${lines.slice(0, -1).join(', ')} and ${lines.at(-1)}`;
