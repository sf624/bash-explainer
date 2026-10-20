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
export const ordinal = (n: number): string => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
