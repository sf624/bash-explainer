import type { Lang } from '../i18n';
import type { Flavor } from './regex';
import { pick } from './types';

/** The name of a regex flavor, or of a fixed string: what a reading says a text is written in. */
export function flavorName(f: Flavor | 'fixed', lang: Lang): string {
  const s = pick(lang);
  switch (f) {
    case 'bre': return s('基本正規表現(BRE)', 'basic regex (BRE)');
    case 'ere': return s('拡張正規表現(ERE)', 'extended regex (ERE)');
    case 'pcre': return s('Perl 互換正規表現(PCRE)', 'Perl-compatible regex (PCRE)');
    case 'python': return s('Python の正規表現', 'Python regex');
    case 'fixed': return s('固定文字列（正規表現として解釈しない）', 'fixed string (not a regex)');
  }
}
