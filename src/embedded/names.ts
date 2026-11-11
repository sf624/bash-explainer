// The names of the languages written inside a command's words (src/embedded/registry.ts), in one place: the panel's chip of
// a language (src/ui/texts.ts) and the texts that say what reads a value as one (src/messages-tokens-argv.ts) read them.
import type { Lang, Text } from '../i18n';
import type { EmbeddedLang } from './types';

export const LANGUAGE_NAMES: Readonly<Record<EmbeddedLang, Text>> = {
  regex: { ja: '正規表現', en: 'regex' },
  glob: { ja: 'glob パターン', en: 'glob pattern' },
  sed: { ja: 'sed スクリプト', en: 'sed script' },
  awk: { ja: 'awk プログラム', en: 'awk program' },
  jq: { ja: 'jq フィルター', en: 'jq filter' },
  yq4: { ja: 'yq の式', en: 'yq expression' },
  yq3path: { ja: 'yq のパス', en: 'yq path' },
  printf: { ja: 'printf の書式', en: 'printf format' },
  echo: { ja: 'エスケープ', en: 'escapes' },
  date: { ja: 'date の書式', en: 'date format' },
  perl: { ja: 'Perl', en: 'Perl' },
  mode: { ja: 'ファイルモード', en: 'file mode' },
  umask: { ja: 'umask', en: 'umask' },
  sortkey: { ja: 'ソートキー', en: 'sort key' },
  cutfields: { ja: 'フィールドの範囲', en: 'field list' },
  cutchars: { ja: '文字の範囲', en: 'character list' },
  trset: { ja: '文字の集合', en: 'character set' },
  getopts: { ja: 'オプション文字', en: 'option letters' },
  getoptshort: { ja: 'オプション文字', en: 'option letters' },
  getoptlong: { ja: '長いオプション', en: 'long options' },
  gitformat: { ja: 'git の書式', en: 'git format' },
  gitdate: { ja: 'git の日付', en: 'git date' },
  arith: { ja: '算術式', en: 'arithmetic' },
  prompt: { ja: 'プロンプト文字列', en: 'prompt string' },
  bazeltarget: { ja: 'ターゲットのパターン', en: 'target pattern' },
  bazelquery: { ja: 'bazel のクエリ式', en: 'bazel query expression' },
  bazelcquery: { ja: 'bazel のクエリ式', en: 'bazel query expression' },
  bazelaquery: { ja: 'bazel のクエリ式', en: 'bazel query expression' },
  buildozer: { ja: 'buildozer のコマンドかラベル', en: 'buildozer command or label' },
};

/** The names of the languages in `lang`, by language. */
export const languageNames = (lang: Lang): Record<EmbeddedLang, string> =>
  Object.fromEntries(Object.entries(LANGUAGE_NAMES).map(([k, t]) => [k, t[lang]])) as Record<EmbeddedLang, string>;
