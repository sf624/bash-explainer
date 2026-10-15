import type { Lang } from '../i18n';
import { EmbeddedToken, pick } from './types';

/** Explain a getopts option string such as `:ab:c:`. */
export function explainGetopts(src: string, lang: Lang): { tokens: EmbeddedToken[]; note: string } | undefined {
  const s = pick(lang);
  if (!/^:?([A-Za-z0-9?]:?)+$/.test(src)) return undefined;
  const tokens: EmbeddedToken[] = [];
  const accepted: string[] = [];
  let i = 0;
  if (src[0] === ':') {
    tokens.push({
      start: 0, end: 1, kind: 'operator', children: [],
      explanation: s(
        '先頭の `:`: エラーを自分で処理するモード（不明なオプションでは変数に `?`、値の欠けたオプションでは `:` が入り、そのオプション文字が $OPTARG に入る。エラーメッセージは出ない）',
        'Leading `:`: silent error mode (an unknown option sets the variable to `?`, a missing value to `:`, with the option letter in $OPTARG; no messages are printed)',
      ),
    });
    i = 1;
  }
  while (i < src.length) {
    const c = src[i];
    const takesValue = src[i + 1] === ':';
    tokens.push({
      start: i, end: i + (takesValue ? 2 : 1), kind: 'option', children: [],
      explanation: takesValue
        ? s(`\`${c}:\`: オプション -${c} は値を取る（\`-${c} 値\`。値は $OPTARG に入る）`, `\`${c}:\`: option -${c} takes a value (\`-${c} VALUE\`, available in $OPTARG)`)
        : s(`\`${c}\`: オプション -${c}（値なし）`, `\`${c}\`: option -${c} (no value)`),
    });
    accepted.push(takesValue ? s(`-${c} 値`, `-${c} VALUE`) : `-${c}`);
    i += takesValue ? 2 : 1;
  }
  return { tokens, note: s(`受け付けるオプション: ${accepted.join('、')}`, `accepts ${accepted.join(', ')}`) };
}
