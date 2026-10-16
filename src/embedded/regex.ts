import type { Lang } from '../i18n';
import { EmbeddedToken, pick } from './types';

/** POSIX basic (grep, sed), POSIX extended (grep -E, sed -E, [[ =~ ]]) or Perl-compatible (grep -P). */
export type Flavor = 'bre' | 'ere' | 'pcre';

const CLASSES: Record<string, [string, string]> = {
  alpha: ['英字', 'letters'], digit: ['数字', 'digits'], alnum: ['英数字', 'letters and digits'],
  upper: ['大文字', 'uppercase letters'], lower: ['小文字', 'lowercase letters'], space: ['空白文字', 'whitespace'],
  blank: ['スペースとタブ', 'spaces and tabs'], punct: ['記号', 'punctuation'], xdigit: ['16進数字', 'hex digits'],
  cntrl: ['制御文字', 'control characters'], print: ['表示可能な文字', 'printable characters'], graph: ['空白以外の表示可能な文字', 'visible characters'],
};

/** `\w`, `\d`… Whether each is available in each flavor (GNU tools support some in BRE/ERE). */
const SHORTHANDS: Record<string, { ja: string; en: string; gnu: boolean }> = {
  w: { ja: '英数字またはアンダースコア1文字', en: 'a word character (letter, digit or underscore)', gnu: true },
  W: { ja: '英数字とアンダースコア以外の1文字', en: 'a non-word character', gnu: true },
  s: { ja: '空白文字1文字', en: 'a whitespace character', gnu: true },
  S: { ja: '空白以外の1文字', en: 'a non-whitespace character', gnu: true },
  d: { ja: '数字1文字', en: 'a digit', gnu: false },
  D: { ja: '数字以外の1文字', en: 'a non-digit', gnu: false },
  b: { ja: '単語の境界（文字は消費しない）', en: 'a word boundary (matches no character)', gnu: true },
  B: { ja: '単語の境界ではない位置', en: 'a position that is not a word boundary', gnu: true },
  '<': { ja: '単語の先頭', en: 'the start of a word', gnu: true },
  '>': { ja: '単語の末尾', en: 'the end of a word', gnu: true },
  A: { ja: '文字列の先頭', en: 'the start of the subject', gnu: false },
  z: { ja: '文字列の末尾', en: 'the end of the subject', gnu: false },
  Z: { ja: '文字列の末尾（末尾の改行の前も可）', en: 'the end of the subject (or before a final newline)', gnu: false },
  t: { ja: 'タブ', en: 'a tab', gnu: false },
  n: { ja: '改行', en: 'a newline', gnu: false },
  r: { ja: '復帰文字(CR)', en: 'a carriage return', gnu: false },
};

interface State {
  src: string;
  i: number;
  flavor: Flavor;
  groups: number;
  s: (ja: string, en: string) => string;
  /** Plain single-character literals, which may be merged into runs. */
  literals: Set<EmbeddedToken>;
  /** GNU sed turns `\t`, `\n`… into characters before compiling the regex, even inside `[…]`. */
  sedEscapes: boolean;
}

const SED_ESCAPES: Record<string, [string, string]> = { t: ['タブ', 'a tab'], n: ['改行', 'a newline'], r: ['復帰文字(CR)', 'a carriage return'], f: ['改ページ', 'a form feed'], v: ['垂直タブ', 'a vertical tab'] };

export interface RegexOptions {
  /** Interpret `\t`, `\n`… as GNU sed does. */
  sedEscapes?: boolean;
}

/** Explain a regular expression as a flat sequence of tokens (groups nest their contents). */
export function explainRegex(src: string, flavor: Flavor, lang: Lang, opts: RegexOptions = {}): EmbeddedToken[] {
  const st: State = { src, i: 0, flavor, groups: 0, s: pick(lang), literals: new Set(), sedEscapes: !!opts.sedEscapes };
  return mergeLiterals(sequence(st, 0), st);
}

function isGroupOpen(st: State): number {
  const { src, i, flavor } = st;
  if (flavor === 'bre') return src.startsWith('\\(', i) ? 2 : 0;
  return src[i] === '(' ? 1 : 0;
}

function isGroupClose(st: State): number {
  const { src, i, flavor } = st;
  if (flavor === 'bre') return src.startsWith('\\)', i) ? 2 : 0;
  return src[i] === ')' ? 1 : 0;
}

function isAlternation(st: State): number {
  const { src, i, flavor } = st;
  if (flavor === 'bre') return src.startsWith('\\|', i) ? 2 : 0;
  return src[i] === '|' ? 1 : 0;
}

/** Length of a quantifier at the current position, or 0. */
function quantifierLength(st: State, atStart: boolean): number {
  const { src, i, flavor } = st;
  let len = 0;
  if (src[i] === '*' && !(flavor === 'bre' && atStart)) len = 1;
  else if (flavor !== 'bre' && (src[i] === '+' || src[i] === '?')) len = 1;
  else if (flavor === 'bre' && (src.startsWith('\\+', i) || src.startsWith('\\?', i))) len = 2;
  else if (flavor !== 'bre' && src[i] === '{') {
    const m = /^\{(\d*)(,?)(\d*)\}/.exec(src.slice(i));
    if (m && (m[1] || m[3])) len = m[0].length;
  } else if (flavor === 'bre' && src.startsWith('\\{', i)) {
    const m = /^\\\{(\d*)(,?)(\d*)\\\}/.exec(src.slice(i));
    if (m && (m[1] || m[3])) len = m[0].length;
  }
  if (len && flavor === 'pcre' && (src[i + len] === '?' || src[i + len] === '+')) len++;
  return len;
}

function sequence(st: State, depth: number): EmbeddedToken[] {
  const { s } = st;
  const out: EmbeddedToken[] = [];
  const atStart = () => out.length === 0 || (out[out.length - 1].kind === 'operator' && out[out.length - 1].label === '|');
  while (st.i < st.src.length) {
    const start = st.i;
    const c = st.src[start];
    if (depth > 0 && isGroupClose(st)) return out;
    let n: number;
    if ((n = isAlternation(st))) {
      st.i += n;
      out.push({ start, end: st.i, kind: 'operator', label: '|', explanation: s('`|`: 左右どちらかに一致すればよい（または）', '`|`: either the left or the right side (or)'), children: [] });
      continue;
    }
    if ((n = quantifierLength(st, atStart()))) {
      st.i += n;
      out.push(quantifier(st, start, out[out.length - 1]));
      continue;
    }
    if ((n = isGroupOpen(st))) {
      out.push(group(st, n));
      continue;
    }
    if (c === '[') {
      out.push(bracket(st));
      continue;
    }
    if (c === '\\') {
      out.push(escape(st));
      continue;
    }
    st.i++;
    if (c === '.') {
      out.push({ start, end: st.i, kind: 'pattern', explanation: s('`.`: 任意の1文字', '`.`: any single character'), children: [] });
    } else if (c === '^' && (st.flavor !== 'bre' || atStart())) {
      out.push({ start, end: st.i, kind: 'keyword', explanation: s('`^`: 行の先頭', '`^`: start of the line'), children: [] });
    } else if (c === '$' && (st.flavor !== 'bre' || st.i === st.src.length || isGroupClose(st) || isAlternation(st))) {
      out.push({ start, end: st.i, kind: 'keyword', explanation: s('`$`: 行の末尾', '`$`: end of the line'), children: [] });
    } else if (st.flavor === 'bre' && '+?{}()|'.includes(c)) {
      out.push({
        start, end: st.i, kind: 'string', explanation: s(
          `文字「${c}」そのもの（基本正規表現では \`${c}\` は特別な意味を持たない。\`-E\` を付けると拡張正規表現の記号になる）`,
          `A literal "${c}" (in basic regex \`${c}\` is not special; with \`-E\` it is an operator)`),
        children: [],
      });
    } else {
      out.push(literal(st, start, c));
    }
  }
  return out;
}

function literal(st: State, start: number, c: string): EmbeddedToken {
  const t: EmbeddedToken = { start, end: st.i, kind: 'string', explanation: st.s(`文字「${c}」`, `Literal "${c}"`), children: [] };
  st.literals.add(t);
  return t;
}

/** Join adjacent plain characters into one literal, except a character that a quantifier binds to. */
function mergeLiterals(tokens: EmbeddedToken[], st: State): EmbeddedToken[] {
  const out: EmbeddedToken[] = [];
  const isQuantifier = (x: EmbeddedToken | undefined) => x?.kind === 'operator' && x.label !== '|';
  tokens.forEach((t, idx) => {
    t.children = mergeLiterals(t.children, st);
    const prev = out[out.length - 1];
    if (prev && st.literals.has(prev) && st.literals.has(t) && prev.end === t.start && !isQuantifier(tokens[idx + 1])) {
      prev.end = t.end;
      const text = st.src.slice(prev.start, prev.end);
      prev.explanation = st.s(`文字列「${text}」`, `Literal "${text}"`);
      return;
    }
    out.push(t);
  });
  return out;
}

function quantifier(st: State, start: number, target: EmbeddedToken | undefined): EmbeddedToken {
  const { s } = st;
  const raw = st.src.slice(start, st.i);
  const of = target ? `\`${st.src.slice(target.start, target.end)}\`` : s('直前の要素', 'the previous item');
  let q = raw.replace(/^\\/, '').replace(/\\\}$/, '}').replace(/^\\\{/, '{');
  let mode = '';
  if (st.flavor === 'pcre' && q.length > 1 && /[?+]$/.test(q) && !/^\{.*\}$/.test(q)) {
    mode = q.slice(-1);
    q = q.slice(0, -1);
  } else if (st.flavor === 'pcre' && /\}[?+]$/.test(q)) {
    mode = q.slice(-1);
    q = q.slice(0, -1);
  }
  let times: string;
  const m = /^\{(\d*)(,?)(\d*)\}$/.exec(q);
  if (q === '*') times = s('0回以上', 'zero or more times');
  else if (q === '+') times = s('1回以上', 'one or more times');
  else if (q === '?') times = s('0回か1回（あってもなくてもよい）', 'zero or one time (optional)');
  else if (m && !m[2]) times = s(`ちょうど${m[1]}回`, `exactly ${m[1]} times`);
  else if (m && !m[3]) times = s(`${m[1]}回以上`, `${m[1]} or more times`);
  else if (m && !m[1]) times = s(`${m[3]}回以下`, `at most ${m[3]} times`);
  else if (m) times = s(`${m[1]}〜${m[3]}回`, `${m[1]} to ${m[3]} times`);
  else times = raw;
  const greed = mode === '?' ? s('（できるだけ少なく）', ' (as few as possible)')
    : mode === '+' ? s('（バックトラックしない）', ' (possessive, no backtracking)')
      : '';
  return { start, end: st.i, kind: 'operator', explanation: s(`\`${raw}\`: ${of} を${times}繰り返す${greed}`, `\`${raw}\`: repeat ${of} ${times}${greed}`), children: [] };
}

function group(st: State, openLen: number): EmbeddedToken {
  const { s } = st;
  const start = st.i;
  st.i += openLen;
  let explanation: string;
  let group: number | undefined;
  const rest = st.src.slice(st.i);
  const ext = st.flavor === 'pcre' ? /^\?(:|=|!|<=|<!|P?<([A-Za-z_]\w*)>|[imsx-]+\))/.exec(rest) : null;
  if (ext) {
    st.i += ext[0].length;
    const k = ext[1];
    if (k === ':') explanation = s('`(?:…)`: まとめるだけのグループ（番号は付かない）', '`(?:…)`: non-capturing group');
    else if (k === '=') explanation = s('`(?=…)`: 直後に … が続く位置（先読み。文字は消費しない）', '`(?=…)`: followed by … (lookahead, consumes nothing)');
    else if (k === '!') explanation = s('`(?!…)`: 直後に … が続かない位置（否定先読み）', '`(?!…)`: not followed by … (negative lookahead)');
    else if (k === '<=') explanation = s('`(?<=…)`: 直前が … である位置（後読み）', '`(?<=…)`: preceded by … (lookbehind)');
    else if (k === '<!') explanation = s('`(?<!…)`: 直前が … ではない位置（否定後読み）', '`(?<!…)`: not preceded by … (negative lookbehind)');
    else if (ext[2]) {
      group = ++st.groups;
      explanation = s(`名前付きグループ \`${ext[2]}\`（グループ ${group}）: 一致した部分を名前で参照できる`, `Named group \`${ext[2]}\` (group ${group})`);
    } else {
      return { start, end: st.i, kind: 'keyword', explanation: s(`\`(?${k}\`: 以降のマッチのオプションを切り替える（i: 大小文字を区別しない など）`, `\`(?${k}\`: set matching options from here (i: case-insensitive, …)`), children: [] };
    }
  } else {
    group = ++st.groups;
    explanation = s(`グループ ${group}: 中身をひとまとめにする（\`\\${group}\` で一致した文字列を参照できる）`, `Group ${group}: treats its contents as one unit (\`\\${group}\` refers to what it matched)`);
  }
  const children = sequence(st, 1);
  const close = isGroupClose(st);
  if (close) st.i += close;
  else explanation += s('（閉じ括弧がない）', ' (missing closing parenthesis)');
  return { start, end: st.i, kind: 'block', explanation, children, ...(group ? { group } : {}) };
}

function bracket(st: State): EmbeddedToken {
  const { s, src } = st;
  const start = st.i;
  let i = start + 1;
  let negated = false;
  if (src[i] === '^') { negated = true; i++; }
  const items: string[] = [];
  let first = true;
  while (i < src.length && (src[i] !== ']' || first)) {
    first = false;
    const cls = /^\[:(\w+):\]/.exec(src.slice(i));
    if (cls) {
      const d = CLASSES[cls[1]];
      items.push(d ? s(d[0], d[1]) : cls[0]);
      i += cls[0].length;
      continue;
    }
    if (st.sedEscapes && src[i] === '\\' && SED_ESCAPES[src[i + 1]]) {
      items.push(s(SED_ESCAPES[src[i + 1]][0], SED_ESCAPES[src[i + 1]][1]));
      i += 2;
      continue;
    }
    if (st.flavor === 'pcre' && src[i] === '\\' && i + 1 < src.length) {
      const d = SHORTHANDS[src[i + 1]];
      items.push(d ? s(d.ja, d.en) : `「${src[i + 1]}」`);
      i += 2;
      continue;
    }
    if (src[i + 1] === '-' && src[i + 2] && src[i + 2] !== ']') {
      items.push(s(`${src[i]}〜${src[i + 2]}`, `${src[i]}-${src[i + 2]}`));
      i += 3;
      continue;
    }
    items.push(s(`「${src[i]}」`, `"${src[i]}"`));
    i++;
  }
  if (i >= src.length) {
    st.i = start + 1;
    return { start, end: st.i, kind: 'error', explanation: s('`[` に対応する `]` がない', 'Unclosed `[`'), children: [] };
  }
  st.i = i + 1;
  const list = items.join(s('、', ', '));
  return {
    start, end: st.i, kind: 'pattern', children: [],
    explanation: negated
      ? s(`文字クラス: ${list} 以外の1文字`, `Character class: one character other than ${list}`)
      : s(`文字クラス: ${list} のどれか1文字`, `Character class: one of ${list}`),
  };
}

function escape(st: State): EmbeddedToken {
  const { s, src } = st;
  const start = st.i;
  const c = src[start + 1];
  st.i += c === undefined ? 1 : 2;
  if (c === undefined) return { start, end: st.i, kind: 'error', explanation: s('末尾の `\\` の後に文字がない', 'Trailing `\\`'), children: [] };
  if (/[1-9]/.test(c)) {
    const missing = Number(c) > st.groups;
    return {
      start, end: st.i, kind: 'variable', children: [], group: Number(c),
      explanation: s(`後方参照 \`\\${c}\`: グループ ${c} に一致したのと同じ文字列${missing ? '（ここまでにグループ ' + c + ' がない）' : ''}`,
        `Backreference \`\\${c}\`: the same text group ${c} matched${missing ? ` (no group ${c} before this point)` : ''}`),
    };
  }
  if (st.sedEscapes && SED_ESCAPES[c]) {
    return { start, end: st.i, kind: 'pattern', explanation: `\`\\${c}\`: ${s(SED_ESCAPES[c][0], SED_ESCAPES[c][1])}`, children: [] };
  }
  const sh = SHORTHANDS[c];
  if (sh && (st.flavor === 'pcre' || sh.gnu)) {
    const kind = /[bB<>AzZ]/.test(c) ? 'keyword' : 'pattern';
    return { start, end: st.i, kind, explanation: `\`\\${c}\`: ${s(sh.ja, sh.en)}`, children: [] };
  }
  if (sh && !sh.gnu) {
    return {
      start, end: st.i, kind: 'string', children: [],
      explanation: s(`\`\\${c}\`: この正規表現（POSIX）では文字「${c}」扱い。「${sh.ja}」の意味にするには \`-P\` が必要`,
        `\`\\${c}\`: just "${c}" in POSIX regex; it means ${sh.en} only with \`-P\``),
    };
  }
  if (st.flavor !== 'bre' && '(){}|+?'.includes(c) || /[.[\]*^$\\/]/.test(c)) {
    return { start, end: st.i, kind: 'string', explanation: s(`文字「${c}」そのもの（\`\\\` で特別な意味を打ち消している）`, `A literal "${c}" (escaped)`), children: [] };
  }
  return { start, end: st.i, kind: 'string', explanation: s(`文字「${c}」`, `Literal "${c}"`), children: [] };
}

export function flavorName(f: Flavor | 'fixed', lang: Lang): string {
  const s = pick(lang);
  switch (f) {
    case 'bre': return s('基本正規表現 (BRE)', 'basic regex (BRE)');
    case 'ere': return s('拡張正規表現 (ERE)', 'extended regex (ERE)');
    case 'pcre': return s('Perl 互換正規表現 (PCRE)', 'Perl-compatible regex (PCRE)');
    case 'fixed': return s('固定文字列（正規表現として解釈しない）', 'fixed string (not a regex)');
  }
}
