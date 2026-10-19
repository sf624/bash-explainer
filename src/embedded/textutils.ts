import type { Lang } from '../i18n';
import { controlSuffix } from '../ctlchars';
import { EmbeddedToken, pick } from './types';

export interface Explained {
  tokens: EmbeddedToken[];
  note?: string;
}

const SORT_OPTS: Record<string, [string, string]> = {
  n: ['数値として比較', 'compare as numbers'], g: ['一般的な数値（指数表記も）として比較', 'compare as general numbers (incl. exponents)'],
  h: ['単位付きの数値（2K, 1G）として比較', 'compare human-readable sizes (2K, 1G)'], r: ['逆順（降順）', 'reverse (descending)'],
  b: ['先頭の空白を無視', 'ignore leading blanks'], f: ['大文字・小文字を区別しない', 'ignore case'], d: ['英数字と空白だけで比較', 'dictionary order'],
  i: ['表示できない文字を無視', 'ignore non-printable characters'], M: ['月名（JAN〜DEC）として比較', 'compare as month names'],
  V: ['バージョン番号として比較', 'compare as version numbers'], R: ['ランダムに並べる', 'random order'],
};

/** `sort -k F[.C][opts][,F[.C][opts]]`. */
export function explainSortKey(src: string, lang: Lang): Explained | undefined {
  const s = pick(lang);
  const m = /^(\d+)(?:\.(\d+))?([bdfgiMhnRrV]*)(?:(,)(\d+)(?:\.(\d+))?([bdfgiMhnRrV]*))?$/.exec(src);
  if (!m) return undefined;
  const [, f1, c1, o1, comma, f2, c2, o2] = m;
  const tokens: EmbeddedToken[] = [];
  let i = 0;
  const push = (len: number, kind: EmbeddedToken['kind'], explanation: string) => {
    tokens.push({ start: i, end: i + len, kind, explanation, children: [] });
    i += len;
  };
  const field = (f: string, c: string | undefined, start: boolean) => {
    push(f.length, 'number', start ? s(`\`${f}\`: キーの開始は ${f} 列目`, `\`${f}\`: the key starts at field ${f}`) : s(`\`${f}\`: キーの終わりは ${f} 列目`, `\`${f}\`: the key ends at field ${f}`));
    if (c) push(c.length + 1, 'number', s(`\`.${c}\`: その列の ${c} 文字目`, `\`.${c}\`: character ${c} of that field`));
  };
  const opts = (o: string) => {
    for (const ch of o) push(1, 'option', `\`${ch}\`: ${s(SORT_OPTS[ch][0], SORT_OPTS[ch][1])}`);
  };
  field(f1, c1, true);
  opts(o1);
  if (comma) {
    push(1, 'operator', s('`,`: キーの開始と終わりの区切り', '`,`: separates the start and end of the key'));
    field(f2, c2, false);
    opts(o2);
  }
  const how = [...new Set((o1 + (o2 ?? '')).split(''))].filter(Boolean).map((ch) => s(SORT_OPTS[ch][0], SORT_OPTS[ch][1])).join(s('、', ', '));
  const range = !comma ? s(`${f1} 列目から行末まで`, `field ${f1} through the end of the line`)
    : f1 === f2 ? s(`${f1} 列目だけ`, `field ${f1} only`) : s(`${f1}〜${f2} 列目`, `fields ${f1} to ${f2}`);
  let note = s(`${range}をキーにする${how ? `（${how}）` : ''}`, `sort by ${range}${how ? ` (${how})` : ''}`);
  if (!comma) note += s(`。注意: 終わりを指定しないと行末までがキーになる（${f1} 列目だけなら \`-k${f1},${f1}\`）`, `. Note: without an end the key runs to the end of the line (use \`-k${f1},${f1}\` for one field)`);
  return { tokens, note };
}

/** `cut -f LIST` / `cut -c LIST`: comma-separated numbers and ranges. */
export function explainCutList(src: string, unit: 'field' | 'char', lang: Lang): Explained | undefined {
  const s = pick(lang);
  if (!/^(\d+|\d+-\d*|-\d+)(,(\d+|\d+-\d*|-\d+))*$/.test(src)) return undefined;
  const [uja, uen] = unit === 'field' ? ['列目', 'field'] : ['文字目', 'character'];
  const tokens: EmbeddedToken[] = [];
  const words: string[] = [];
  let pos = 0;
  for (const item of src.split(',')) {
    const [a, b] = item.split('-');
    let text: string;
    if (!item.includes('-')) text = s(`${a} ${uja}`, `${uen} ${a}`);
    else if (a && b) text = s(`${a}〜${b} ${uja}`, `${uen}s ${a} to ${b}`);
    else if (a) text = s(`${a} ${uja}以降すべて`, `${uen} ${a} onwards`);
    else text = s(`先頭から ${b} ${uja}まで`, `${uen}s 1 to ${b}`);
    tokens.push({ start: pos, end: pos + item.length, kind: 'number', explanation: `\`${item}\`: ${text}`, children: [] });
    words.push(text);
    pos += item.length + 1;
  }
  return { tokens, note: s(`取り出すのは ${words.join('、')}（番号は1始まり）`, `selects ${words.join(', ')} (numbered from 1)`) };
}

const TR_CLASSES: Record<string, [string, string]> = {
  upper: ['大文字', 'uppercase letters'], lower: ['小文字', 'lowercase letters'], alpha: ['英字', 'letters'], digit: ['数字', 'digits'],
  alnum: ['英数字', 'letters and digits'], space: ['空白文字（改行・タブを含む）', 'whitespace (incl. newline and tab)'], blank: ['スペースとタブ', 'spaces and tabs'],
  punct: ['記号', 'punctuation'], cntrl: ['制御文字', 'control characters'], print: ['表示可能な文字', 'printable characters'],
  graph: ['空白以外の表示可能な文字', 'visible characters'], xdigit: ['16進数字', 'hex digits'],
};

const TR_ESCAPES: Record<string, [string, string]> = {
  n: ['改行', 'newline'], t: ['タブ', 'tab'], r: ['復帰文字(CR。Windows の改行 CRLF の CR)', 'carriage return (the CR of Windows CRLF)'], '\\': ['バックスラッシュ', 'backslash'],
  a: ['ベル', 'bell'], b: ['バックスペース', 'backspace'], f: ['改ページ', 'form feed'], v: ['垂直タブ', 'vertical tab'],
};

/** One `tr` character set. `role` says how tr uses it. */
export function explainTrSet(src: string, role: 'from' | 'to' | 'delete' | 'squeeze', lang: Lang): Explained | undefined {
  const s = pick(lang);
  const tokens: EmbeddedToken[] = [];
  const names: string[] = [];
  let i = 0;
  while (i < src.length) {
    const rest = src.slice(i);
    let m: RegExpExecArray | null;
    let len: number;
    let text: string;
    if ((m = /^\[:(\w+):\]/.exec(rest)) && TR_CLASSES[m[1]]) {
      len = m[0].length;
      text = s(TR_CLASSES[m[1]][0], TR_CLASSES[m[1]][1]);
    } else if ((m = /^\[(.)\*(\d*)\]/.exec(rest))) {
      len = m[0].length;
      text = m[2] ? s(`「${m[1]}」を ${m[2]} 個`, `"${m[1]}" ${m[2]} times`) : s(`「${m[1]}」を必要なだけ繰り返す`, `"${m[1]}" repeated as needed`);
    } else if ((m = /^\\([0-7]{1,3})/.exec(rest))) {
      len = m[0].length;
      text = s(`8進数 ${m[1]} の文字${controlSuffix(parseInt(m[1], 8), s)}`, `the character with octal code ${m[1]}${controlSuffix(parseInt(m[1], 8), s)}`);
    } else if (rest[0] === '\\' && TR_ESCAPES[rest[1]]) {
      len = 2;
      text = s(TR_ESCAPES[rest[1]][0], TR_ESCAPES[rest[1]][1]);
    } else if (rest.length >= 3 && rest[1] === '-') {
      len = 3;
      text = s(`${rest[0]}〜${rest[2]}`, `${rest[0]}-${rest[2]}`);
    } else {
      len = rest[0] === '\\' && rest.length > 1 ? 2 : 1;
      const c = rest[len - 1];
      text = c === ' ' ? s('スペース', 'space') : s(`「${c}」`, `"${c}"`);
    }
    tokens.push({ start: i, end: i + len, kind: 'pattern', explanation: `\`${src.slice(i, i + len)}\`: ${text}`, children: [] });
    names.push(text);
    i += len;
  }
  if (!tokens.length) return undefined;
  const list = names.join(s('、', ', '));
  const note = role === 'delete' ? s(`削除する文字: ${list}`, `characters to delete: ${list}`)
    : role === 'squeeze' ? s(`連続したら1つにまとめる文字: ${list}`, `characters whose repeats are squeezed: ${list}`)
      : role === 'from' ? s(`変換元の文字: ${list}`, `characters to replace: ${list}`)
        : s(`変換先の文字: ${list}（1つ目の集合の各文字が、同じ位置のこの文字に置き換わる）`, `replacement characters: ${list} (each character of the first set becomes the one at the same position here)`);
  return { tokens, note };
}

/** A one-line summary of a tr call such as `tr '[:upper:]' '[:lower:]'`. */
export function trSummary(from: string, to: string | undefined, lang: Lang): string | undefined {
  const s = pick(lang);
  const cls = (x: string) => /^\[:(\w+):\]$/.exec(x)?.[1] ?? (x === 'a-z' ? 'lower' : x === 'A-Z' ? 'upper' : undefined);
  if (to === undefined) return undefined;
  const a = cls(from);
  const b = cls(to);
  if (a === 'upper' && b === 'lower') return s('大文字を小文字に変換する', 'converts uppercase to lowercase');
  if (a === 'lower' && b === 'upper') return s('小文字を大文字に変換する', 'converts lowercase to uppercase');
  return undefined;
}
