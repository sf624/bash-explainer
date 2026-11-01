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
 * How a line number is written (the one source of the label; docs/design/sources.md, row 17). `long` heads a view
 * ("Line 5", "5 行目"); `inline` sits inside a sentence or in brackets ("line 5", "行 5": docs/japanese-style.md writes
 * a line number as 行 N); `compact` is the status line of the web page's editor ("Ln 5").
 */
export type LineForm = 'long' | 'inline' | 'compact';

const LINE_FORMS: Record<LineForm, Record<Lang, (n: number) => string>> = {
  long: { ja: (n) => `${n} 行目`, en: (n) => `Line ${n}` },
  inline: { ja: (n) => `行 ${n}`, en: (n) => `line ${n}` },
  compact: { ja: (n) => `${n} 行目`, en: (n) => `Ln ${n}` },
};

/** The label of line `n` (counted from 1) in the form asked for. */
export const lineLabel = (lang: Lang, n: number, form: LineForm = 'long'): string => LINE_FORMS[form][lang](n);
