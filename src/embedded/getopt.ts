import type { Lang } from '../i18n';
import { EmbeddedToken, pick } from './types';

/** Explain getopt's short option string (`-o hv:c::`), with an optional leading `+` or `-`. */
export function explainGetoptShort(src: string, lang: Lang): { tokens: EmbeddedToken[]; note: string } | undefined {
  const s = pick(lang);
  if (!/^[+-]?([A-Za-z0-9](::?)?)*$/.test(src) || !src) return undefined;
  const tokens: EmbeddedToken[] = [];
  const accepted: string[] = [];
  let i = 0;
  if (src[0] === '+') {
    tokens.push({ start: 0, end: 1, kind: 'operator', children: [], explanation: s('先頭の `+`: 最初のオプションでない引数でオプションの解析をやめる（以降はすべて通常の引数）', 'Leading `+`: stop at the first non-option argument (everything after it is a plain argument)') });
    i = 1;
  } else if (src[0] === '-') {
    tokens.push({ start: 0, end: 1, kind: 'operator', children: [], explanation: s('先頭の `-`: オプションでない引数を後ろに回さず、元の位置のまま出力する', 'Leading `-`: keep non-option arguments in place instead of moving them after `--`') });
    i = 1;
  }
  while (i < src.length) {
    const c = src[i];
    const colons = src.startsWith('::', i + 1) ? 2 : src[i + 1] === ':' ? 1 : 0;
    tokens.push({
      start: i, end: i + 1 + colons, kind: 'option', children: [],
      explanation: colons === 2
        ? s(`\`${c}::\`: オプション -${c} は値を省略できる（値は \`-${c}値\` のように続けて書く。省略すると空文字）`, `\`${c}::\`: option -${c} takes an optional value (written attached, \`-${c}VALUE\`; empty if omitted)`)
        : colons === 1
          ? s(`\`${c}:\`: オプション -${c} は値を取る（\`-${c} 値\` または \`-${c}値\`）`, `\`${c}:\`: option -${c} takes a value (\`-${c} VALUE\` or \`-${c}VALUE\`)`)
          : s(`\`${c}\`: オプション -${c}（値なし）`, `\`${c}\`: option -${c} (no value)`),
    });
    accepted.push(colons === 2 ? s(`-${c}[値]`, `-${c}[VALUE]`) : colons ? s(`-${c} 値`, `-${c} VALUE`) : `-${c}`);
    i += 1 + colons;
  }
  return { tokens, note: s(`受け付ける短いオプション: ${accepted.join('、')}`, `short options: ${accepted.join(', ')}`) };
}

/** Explain getopt's long option list (`--long help,verbose:,color::`). */
export function explainGetoptLong(src: string, lang: Lang): { tokens: EmbeddedToken[]; note: string } | undefined {
  const s = pick(lang);
  if (!/^[A-Za-z0-9][\w-]*(::?)?(,[A-Za-z0-9][\w-]*(::?)?)*$/.test(src)) return undefined;
  const tokens: EmbeddedToken[] = [];
  const accepted: string[] = [];
  let at = 0;
  for (const part of src.split(',')) {
    if (at) tokens.push({ start: at - 1, end: at, kind: 'operator', children: [], explanation: s('`,`: 長いオプションの区切り', '`,` separates long options') });
    const name = part.replace(/:+$/, '');
    const colons = part.length - name.length;
    tokens.push({
      start: at, end: at + part.length, kind: 'option', children: [],
      explanation: colons === 2
        ? s(`\`${part}\`: オプション --${name} は値を省略できる（\`--${name}=値\` の形で書く）`, `\`${part}\`: option --${name} takes an optional value (written \`--${name}=VALUE\`)`)
        : colons === 1
          ? s(`\`${part}\`: オプション --${name} は値を取る（\`--${name} 値\` または \`--${name}=値\`）`, `\`${part}\`: option --${name} takes a value (\`--${name} VALUE\` or \`--${name}=VALUE\`)`)
          : s(`\`${part}\`: オプション --${name}（値なし）`, `\`${part}\`: option --${name} (no value)`),
    });
    accepted.push(colons === 2 ? s(`--${name}[=値]`, `--${name}[=VALUE]`) : colons ? s(`--${name} 値`, `--${name} VALUE`) : `--${name}`);
    at += part.length + 1;
  }
  return { tokens, note: s(`受け付ける長いオプション: ${accepted.join('、')}（一意に決まれば \`--${src.split(',')[0].replace(/:+$/, '').slice(0, 3)}\` のように省略可）`, `long options: ${accepted.join(', ')} (unique prefixes such as \`--${src.split(',')[0].replace(/:+$/, '').slice(0, 3)}\` also work)`) };
}
