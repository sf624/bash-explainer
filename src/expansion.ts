import { Lang } from './i18n';

/** A part of a `${…}` expansion; offsets are relative to the start of the whole `${…}` text. */
export interface ExpansionPart {
  role: 'prefix' | 'name' | 'subscript' | 'op' | 'word' | 'pattern' | 'replacement' | 'offset' | 'length' | 'transform';
  text: string;
  start: number;
  end: number;
}

export interface ParsedExpansion {
  /** `#` (length) or `!` (indirection / keys / names). */
  prefix?: '#' | '!';
  name: string;
  subscript?: string;
  op?: string;
  parts: ExpansionPart[];
}

const OPS = [':-', ':=', ':+', ':?', '##', '%%', '//', '/#', '/%', '^^', ',,', '-', '=', '+', '?', '#', '%', '/', '^', ','];

/** Index of the first `stop` character at nesting depth 0 (outside quotes, `${…}`, `$(…)`, `[…]`). */
function findTopLevel(s: string, from: number, stop: string): number {
  let depth = 0;
  let quote: string | undefined;
  for (let i = from; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') { i++; continue; }
    if (quote) { if (c === quote) quote = undefined; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '$' && (s[i + 1] === '{' || s[i + 1] === '(')) { depth++; i++; continue; }
    if (c === '{' || c === '(' || c === '[') { depth++; continue; }
    if ((c === '}' || c === ')' || c === ']') && depth > 0) { depth--; continue; }
    if (depth === 0 && c === stop) return i;
  }
  return -1;
}

/** Parse the text of a `${…}` expansion. Returns undefined for forms it does not understand. */
export function parseExpansion(text: string): ParsedExpansion | undefined {
  if (!text.startsWith('${') || !text.endsWith('}')) return undefined;
  const inner = text.slice(2, -1);
  const base = 2;
  const parts: ExpansionPart[] = [];
  const add = (role: ExpansionPart['role'], from: number, to: number) => {
    if (role === 'offset' || role === 'length') {
      // `${s: -2}`: the space only separates `:` from `-`; keep it out of the part.
      while (from < to && inner[from] === ' ') from++;
      while (to > from && inner[to - 1] === ' ') to--;
    }
    parts.push({ role, text: inner.slice(from, to), start: base + from, end: base + to });
  };
  let i = 0;
  let prefix: ParsedExpansion['prefix'];
  // `${#x}` (length) and `${!x}` (indirection); a lone `${#}` / `${!}` is the special variable itself.
  if (/^[#!][A-Za-z_0-9@*#?$!]/.test(inner)) {
    prefix = inner[0] as '#' | '!';
    add('prefix', 0, 1);
    i = 1;
  }
  const m = /^([A-Za-z_][A-Za-z0-9_]*|\d+|[@*#?$!0-])/.exec(inner.slice(i));
  if (!m) return undefined;
  const name = m[1];
  add('name', i, i + name.length);
  i += name.length;
  let subscript: string | undefined;
  if (inner[i] === '[') {
    const close = findTopLevel(inner, i + 1, ']');
    if (close < 0) return undefined;
    subscript = inner.slice(i + 1, close);
    add('subscript', i, close + 1);
    i = close + 1;
  }
  const rest = inner.slice(i);
  if (!rest) return { prefix, name, subscript, parts };

  // `${!prefix*}` / `${!prefix@}`: names of variables starting with a prefix.
  if (prefix === '!' && (rest === '*' || rest === '@')) {
    add('op', i, i + 1);
    return { prefix, name, subscript, op: rest, parts };
  }
  if (prefix) return undefined;

  if (rest[0] === '@' && rest.length === 2) {
    add('op', i, i + 1);
    add('transform', i + 1, i + 2);
    return { name, subscript, op: '@', parts };
  }
  if (rest[0] === ':' && !/^:[-=+?]/.test(rest)) {
    const colon = findTopLevel(inner, i + 1, ':');
    add('op', i, i + 1);
    if (colon < 0) add('offset', i + 1, inner.length);
    else {
      add('offset', i + 1, colon);
      add('op', colon, colon + 1);
      add('length', colon + 1, inner.length);
    }
    return { name, subscript, op: ':', parts };
  }
  const op = OPS.find((o) => rest.startsWith(o));
  if (!op) return undefined;
  add('op', i, i + op.length);
  const argStart = i + op.length;
  if (op[0] === '/') {
    const slash = findTopLevel(inner, argStart, '/');
    if (slash < 0) add('pattern', argStart, inner.length);
    else {
      add('pattern', argStart, slash);
      add('op', slash, slash + 1);
      add('replacement', slash + 1, inner.length);
    }
  } else if (/^[#%^,]/.test(op)) {
    if (argStart < inner.length) add('pattern', argStart, inner.length);
  } else {
    add('word', argStart, inner.length);
  }
  return { name, subscript, op, parts };
}

// ---------------------------------------------------------------- glob patterns

type GlobPart = { type: 'any' } | { type: 'one' } | { type: 'class'; set: string; negated: boolean } | { type: 'text'; text: string };

/** Split a glob into parts. Returns undefined if it contains expansions or extglobs we cannot evaluate. */
export function globParts(pattern: string): GlobPart[] | undefined {
  if (/\$|`|[?*+@!]\(/.test(pattern)) return undefined;
  const out: GlobPart[] = [];
  const text = (s: string) => {
    const last = out[out.length - 1];
    if (last?.type === 'text') last.text += s;
    else out.push({ type: 'text', text: s });
  };
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '\\' && i + 1 < pattern.length) text(pattern[++i]);
    else if (c === '"' || c === "'") {
      const end = pattern.indexOf(c, i + 1);
      if (end < 0) return undefined;
      text(pattern.slice(i + 1, end));
      i = end;
    } else if (c === '*') out.push({ type: 'any' });
    else if (c === '?') out.push({ type: 'one' });
    else if (c === '[') {
      const end = pattern.indexOf(']', i + 2);
      if (end < 0) { text(c); continue; }
      let set = pattern.slice(i + 1, end);
      const negated = set[0] === '!' || set[0] === '^';
      if (negated) set = set.slice(1);
      out.push({ type: 'class', set, negated });
      i = end;
    } else text(c);
  }
  return out;
}

function globRegex(parts: GlobPart[]): string {
  return parts.map((p) => {
    switch (p.type) {
      case 'any': return '[\\s\\S]*';
      case 'one': return '[\\s\\S]';
      case 'class': return `[${p.negated ? '^' : ''}${p.set.replace(/[\\\]]/g, '\\$&')}]`;
      case 'text': return p.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }).join('');
}

/** Describe a glob in words, e.g. `.*` → 「.」 + any string. */
export function describeGlob(parts: GlobPart[], lang: Lang): string {
  const ja = lang === 'ja';
  return parts.map((p) => {
    switch (p.type) {
      case 'any': return ja ? '任意の文字列' : 'any string';
      case 'one': return ja ? '任意の1文字' : 'any one character';
      case 'class': {
        const set = describeSet(p.set, lang);
        return ja ? `${set}${p.negated ? '以外の' : 'のどれか'}1文字` : `one character ${p.negated ? 'other than' : 'from'} ${set}`;
      }
      case 'text': return ja ? `「${p.text}」` : `"${p.text}"`;
    }
  }).join(' + ');
}

function describeSet(set: string, lang: Lang): string {
  const named: Record<string, [string, string]> = {
    '[:digit:]': ['数字', 'digits'], '[:alpha:]': ['英字', 'letters'], '[:alnum:]': ['英数字', 'letters/digits'],
    '[:space:]': ['空白', 'whitespace'], '[:upper:]': ['大文字', 'uppercase letters'], '[:lower:]': ['小文字', 'lowercase letters'],
  };
  if (named[set]) return named[set][lang === 'ja' ? 0 : 1];
  return set.replace(/(.)-(.)/g, (_, a, b) => (lang === 'ja' ? `${a}〜${b}` : `${a}-${b}`));
}

/** The prefix (`#`) or suffix (`%`) of `value` removed by a pattern, shortest or longest. */
function strip(value: string, parts: GlobPart[], from: 'start' | 'end', longest: boolean): string {
  const re = new RegExp(`^(?:${globRegex(parts)})$`);
  const n = value.length;
  const lengths = Array.from({ length: n + 1 }, (_, k) => (longest ? n - k : k));
  for (const len of lengths) {
    const piece = from === 'start' ? value.slice(0, len) : value.slice(n - len);
    if (re.test(piece)) return from === 'start' ? value.slice(len) : value.slice(0, n - len);
  }
  return value;
}

function replace(value: string, parts: GlobPart[], rep: string, mode: '/' | '//' | '/#' | '/%'): string {
  const src = globRegex(parts);
  if (!src) return value;
  if (mode === '/#') return value.replace(new RegExp(`^(?:${src})`), () => rep);
  if (mode === '/%') {
    // Longest suffix match: try the earliest start position whose rest matches.
    for (let k = 0; k <= value.length; k++) {
      if (new RegExp(`^(?:${src})$`).test(value.slice(k))) return value.slice(0, k) + rep;
    }
    return value;
  }
  return value.replace(new RegExp(src, mode === '//' ? 'g' : ''), () => rep);
}

const SAMPLES = [
  'report.tar.gz', '/usr/local/bin/app.sh', 'src/main/app.log', 'v1.2.3', '2026-10-16', 'hello world',
  'foo_bar_baz', 'ABC-123-xyz', 'image.png', 'key=value',
];

function pickSample(test: (s: string) => boolean): string | undefined {
  return SAMPLES.find(test);
}

// ---------------------------------------------------------------- examples

/** Whether `:offset:length` takes elements (`${a[@]:1}`, `${@:2}`) rather than characters. */
export function slicesElements(p: ParsedExpansion): boolean {
  return p.subscript === '@' || p.subscript === '*' || p.name === '@' || p.name === '*';
}

/** One case of a worked example: a condition (Markdown) and what the expansion gives. */
export interface ExpansionCase {
  when: string;
  result: string;
  /** Bash that sets up the condition (for named variables), used by the tests. */
  setup?: string;
}

const sq = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;

/**
 * Worked examples such as `file=report.tar.gz` → `report.tar`, computed with the same matching
 * rules as bash. Undefined when the expansion depends on values we cannot know.
 */
export function exampleFor(p: ParsedExpansion, lang: Lang): ExpansionCase[] | undefined {
  const ja = lang === 'ja';
  const name = p.name;
  // `$1`, `$2`… cannot be assigned (`2=abc` is not bash), so they are described as arguments.
  const positional = /^[1-9]\d*$/.test(name);
  const shown = (val: string) => (/[\s']/.test(val) ? `"${val}"` : val || '""');
  const set = (val: string, result: string): ExpansionCase => ({
    when: positional
      ? (ja ? `${name} 番目の引数が \`${shown(val)}\` のとき` : `When argument ${name} is \`${shown(val)}\``)
      : (ja ? `\`${name}=${shown(val)}\` のとき` : `When \`${name}=${shown(val)}\``),
    result,
    setup: positional ? undefined : `${name}=${sq(val)}`,
  });
  const array = (result: string): ExpansionCase => ({ when: ja ? `\`${name}=(a b c)\` のとき` : `When \`${name}=(a b c)\``, result, setup: `${name}=(a b c)` });
  /** "unset or empty" (with `:`) or just "unset", phrased for a variable or an argument. */
  const missing = (orEmpty: boolean, result: string): ExpansionCase => ({
    when: positional
      ? (ja ? `${name} 番目の引数が無い${orEmpty ? 'か空の' : ''}とき` : `When argument ${name} is missing${orEmpty ? ' or empty' : ''}`)
      : (ja ? `${name} が未設定${orEmpty ? 'か空' : ''}のとき` : `When ${name} is unset${orEmpty ? ' or empty' : ''}`),
    result,
    setup: positional ? undefined : `unset ${name}`,
  });

  if (p.prefix === '#') {
    if (p.subscript === '@' || p.subscript === '*') return [array('3')];
    return [set('hello', '5')];
  }
  if (p.prefix === '!') {
    if (p.op === '*' || p.op === '@') {
      return [{ when: ja ? `${name}_A と ${name}_B があるとき` : `When ${name}_A and ${name}_B are set`, result: `${name}_A ${name}_B`, setup: `${name}_A=1 ${name}_B=2` }];
    }
    if (p.subscript === '@' || p.subscript === '*') return [array('0 1 2')];
    return [{ when: ja ? `\`${name}=HOME\` のとき` : `When \`${name}=HOME\``, result: ja ? '$HOME の値' : 'the value of $HOME' }];
  }
  if (!p.op) {
    if (p.subscript === '@' || p.subscript === '*') return [array('a b c')];
    if (p.subscript && /^\d+$/.test(p.subscript)) {
      return [array(['a', 'b', 'c'][Number(p.subscript)] ?? '')];
    }
    return undefined;
  }
  const part = (role: ExpansionPart['role']) => p.parts.find((x) => x.role === role)?.text;
  const word = part('word') ?? '';
  // A plausible value for "when it has a value", chosen to look like the default.
  const sample = /^\/|^~/.test(word) ? '/data' : /^-?\d+$/.test(word) ? '42' : 'hello';
  const expanded = (w: string) => `${w}${/\$/.test(w) ? (ja ? '（展開結果）' : ' (expanded)') : ''}`;
  const emptyCase = (result: string): ExpansionCase => ({
    when: positional ? (ja ? `${name} 番目の引数が空のとき` : `When argument ${name} is empty`) : (ja ? `\`${name}=""\` のとき` : `When \`${name}=""\``),
    result,
    setup: positional ? undefined : `${name}=`,
  });
  switch (p.op) {
    case ':-': case ':=':
      return [missing(true, expanded(word)), set(sample, sample)];
    case '-': case '=':
      return [missing(false, expanded(word)), emptyCase(''), set(sample, sample)];
    case ':+':
      return [set(sample, expanded(word)), missing(true, '')];
    case '+':
      return [set(sample, expanded(word)), emptyCase(expanded(word)), missing(false, '')];
    case ':?': case '?': {
      const msg = word || (ja ? '（既定のメッセージ）' : '(a default message)');
      const fail = ja ? `エラー「${msg}」を表示して終了` : `prints the error "${msg}" and exits`;
      return [missing(p.op === ':?', fail), set(sample, sample)];
    }
    case '#': case '##': case '%': case '%%': {
      const glob = globParts(part('pattern') ?? '');
      if (!glob) return undefined;
      const from = p.op[0] === '#' ? 'start' : 'end';
      const longest = p.op.length === 2;
      const removes = (s: string) => strip(s, glob, from, longest) !== s;
      // Prefer a sample where the shortest and longest matches differ, so `%` vs `%%` is visible.
      const value = pickSample((s) => removes(s) && strip(s, glob, from, true) !== strip(s, glob, from, false))
        ?? pickSample(removes)
        ?? synthesize(glob, from);
      if (!value) return undefined;
      return [set(value, strip(value, glob, from, longest))];
    }
    case '/': case '//': case '/#': case '/%': {
      const glob = globParts(part('pattern') ?? '');
      const rep = part('replacement') ?? '';
      if (!glob || /[$`]/.test(rep)) return undefined;
      const repText = rep.replace(/^["']|["']$/g, '');
      const test = new RegExp(globRegex(glob));
      // For `/` and `//` show a value with two matches, so "first" vs "every" is visible.
      const twice = p.op === '/' || p.op === '//';
      const value = (twice ? pickSample((s) => (s.match(new RegExp(globRegex(glob), 'g')) ?? []).length > 1) ?? synthesizeReplace(glob, p.op) : undefined)
        ?? pickSample((s) => test.test(s) && replace(s, glob, repText, p.op as '/') !== s)
        ?? synthesizeReplace(glob, p.op);
      if (!value) return undefined;
      return [set(value, replace(value, glob, repText, p.op as '/'))];
    }
    case '^': return [set('hello world', 'Hello world')];
    case '^^': return [set('hello world', 'HELLO WORLD')];
    case ',': return [set('HELLO World', 'hELLO World')];
    case ',,': return [set('HELLO World', 'hello world')];
    case ':': {
      const off = part('offset')?.trim();
      const len = part('length')?.trim();
      if (!off || !/^-?\d+$/.test(off) || (len !== undefined && !/^-?\d+$/.test(len))) return undefined;
      if (slicesElements(p)) {
        // Elements, not characters: `${a[@]:1:2}`, `${@:2}` (which counts from $1; $0 is the script).
        const items = ['a', 'b', 'c', 'd', 'e'];
        const args = name === '@' || name === '*';
        const o = Number(off);
        if ((args && o === 0) || (len !== undefined && Number(len) < 0)) return undefined;
        const start = o < 0 ? Math.max(0, items.length + o) : args ? o - 1 : o;
        const result = items.slice(start, len === undefined ? undefined : start + Number(len)).join(' ');
        return [args
          ? { when: ja ? '引数が `a b c d e` のとき' : 'When the arguments are `a b c d e`', result, setup: 'set -- a b c d e' }
          : { when: ja ? `\`${name}=(a b c d e)\` のとき` : `When \`${name}=(a b c d e)\``, result, setup: `${name}=(a b c d e)` }];
      }
      const s = 'abcdefgh';
      const o = Number(off);
      const start = o < 0 ? Math.max(0, s.length + o) : o;
      let end = s.length;
      if (len !== undefined) end = Number(len) < 0 ? s.length + Number(len) : start + Number(len);
      return [set(s, s.slice(start, Math.max(start, end)))];
    }
    case '@': {
      const t = part('transform');
      const ex: Record<string, [string, string]> = {
        Q: ["it's", `'it'\\''s'`], E: ['a\\tb', ja ? 'a<タブ>b' : 'a<TAB>b'], U: ['hello', 'HELLO'], u: ['hello', 'Hello'],
        L: ['HELLO', 'hello'], A: ['abc', `${name}='abc'`], P: ['\\u@\\h', ja ? 'ユーザー名@ホスト名' : 'user@host'],
      };
      const e = t && ex[t];
      return e ? [set(e[0], e[1])] : undefined;
    }
  }
  return undefined;
}

/** Build a sample that the pattern clearly matches at the given end. */
function synthesize(glob: GlobPart[], from: 'start' | 'end'): string | undefined {
  const lit = glob.map((g) => (g.type === 'text' ? g.text : g.type === 'any' ? 'xx' : g.type === 'one' ? 'x' : g.negated ? '_' : g.set[0])).join('');
  if (!lit) return undefined;
  return from === 'start' ? `${lit}name` : `name${lit}`;
}

function synthesizeReplace(glob: GlobPart[], op: string): string | undefined {
  const lit = glob.map((g) => (g.type === 'text' ? g.text : g.type === 'any' ? 'xx' : g.type === 'one' ? 'x' : g.negated ? '_' : g.set[0])).join('');
  if (!lit) return undefined;
  if (op === '/#') return `${lit}-abc`;
  if (op === '/%') return `abc-${lit}`;
  // A space or other separator reads best between words.
  return /\w/.test(lit) ? `a-${lit}-b-${lit}` : `foo${lit}bar${lit}baz`;
}

// ---------------------------------------------------------------- part explanations

export const opMeaning: Record<string, [string, string]> = {
  ':-': ['既定値の演算子: 左の変数が未設定または空なら右の値を使う（`:` があると空文字も未設定と同じ扱い）', 'Default operator: use the right side if the variable is unset or empty (the `:` makes empty count as unset)'],
  '-': ['既定値の演算子: 左の変数が未設定のときだけ右の値を使う（空文字なら空のまま）', 'Default operator: use the right side only if the variable is unset (empty stays empty)'],
  ':=': ['既定値の代入演算子: 未設定または空なら右の値を変数に代入してから使う', 'Assign-default operator: if unset or empty, assign the right side to the variable and use it'],
  '=': ['既定値の代入演算子: 未設定のときだけ右の値を変数に代入してから使う', 'Assign-default operator: if unset, assign the right side and use it'],
  ':+': ['代替値の演算子: 変数が設定済みかつ空でないときだけ右の値を使う', 'Alternate-value operator: use the right side only if the variable is set and non-empty'],
  '+': ['代替値の演算子: 変数が設定済みなら（空でも）右の値を使う', 'Alternate-value operator: use the right side if the variable is set (even if empty)'],
  ':?': ['エラー演算子: 未設定または空ならメッセージを表示してスクリプトを終了する', 'Error operator: if unset or empty, print the message and exit'],
  '?': ['エラー演算子: 未設定ならメッセージを表示してスクリプトを終了する', 'Error operator: if unset, print the message and exit'],
  '#': ['先頭から、パターンに一致する最も短い部分を取り除く', 'Remove the shortest prefix matching the pattern'],
  '##': ['先頭から、パターンに一致する最も長い部分を取り除く', 'Remove the longest prefix matching the pattern'],
  '%': ['末尾から、パターンに一致する最も短い部分を取り除く', 'Remove the shortest suffix matching the pattern'],
  '%%': ['末尾から、パターンに一致する最も長い部分を取り除く', 'Remove the longest suffix matching the pattern'],
  '/': ['最初に一致した部分だけを置換する', 'Replace the first match'],
  '//': ['一致した部分をすべて置換する', 'Replace every match'],
  '/#': ['先頭で一致した場合だけ置換する', 'Replace a match at the start'],
  '/%': ['末尾で一致した場合だけ置換する', 'Replace a match at the end'],
  '^': ['先頭の1文字を大文字にする', 'Uppercase the first character'],
  '^^': ['すべての文字を大文字にする', 'Uppercase every character'],
  ',': ['先頭の1文字を小文字にする', 'Lowercase the first character'],
  ',,': ['すべての文字を小文字にする', 'Lowercase every character'],
  ':': ['部分文字列を取り出す（`:開始位置:長さ`）', 'Take a substring (`:offset:length`)'],
  '@': ['値を変換する（`@` の後の1文字で変換の種類を指定）', 'Transform the value (the letter after `@` selects how)'],
};

export const transformMeaning: Record<string, [string, string]> = {
  Q: ['シェルに再入力できる形にクォートする', 'quote it so it can be reused as shell input'],
  E: ['`\\n` や `\\t` などのバックスラッシュエスケープを展開する（`$\'…\'` と同じ）', 'expand backslash escapes like `\\n` (as in `$\'…\'`)'],
  P: ['プロンプト文字列（PS1 と同じ書式）として展開する', 'expand it as a prompt string (like PS1)'],
  A: ['同じ値を再現する代入文（`name=\'value\'`）にする', 'turn it into an assignment statement that recreates it'],
  K: ['連想配列をキーと値の組として表示する', 'show an associative array as key/value pairs'],
  k: ['連想配列をキーと値を交互に並べた単語に分ける', 'expand an associative array into alternating keys and values'],
  a: ['変数の属性フラグ（`declare` のオプション文字）を返す', 'give the variable\'s attribute flags (as for `declare`)'],
  U: ['すべて大文字にする', 'uppercase every character'],
  u: ['先頭の1文字を大文字にする', 'uppercase the first character'],
  L: ['すべて小文字にする', 'lowercase every character'],
};
