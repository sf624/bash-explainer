import { awkEscapeAt, sedEscapeAt } from '../ctlchars';
import type { Lang } from '../i18n';
import { codeShown } from '../messages-values';
import { EmbeddedToken, escapeIntoHole, hasHole, holeStop, holeToken, isHole, pick } from './types';
import { wordTable } from '../wordtable';

/** POSIX basic (grep, sed), POSIX extended (grep -E, sed -E, [[ =~ ]]) or Perl-compatible (grep -P). */
export type Flavor = 'bre' | 'ere' | 'pcre';

const CLASSES: Record<string, [string, string]> = wordTable({
  alpha: ['英字', 'letters'], digit: ['数字', 'digits'], alnum: ['英数字', 'letters and digits'],
  upper: ['大文字', 'uppercase letters'], lower: ['小文字', 'lowercase letters'], space: ['空白文字', 'whitespace'],
  blank: ['空白とタブ', 'spaces and tabs'], punct: ['記号', 'punctuation'], xdigit: ['16進数字', 'hex digits'],
  cntrl: ['制御文字', 'control characters'], print: ['表示可能な文字', 'printable characters'], graph: ['空白以外の表示可能な文字', 'visible characters'],
});

/**
 * `\w`, `\d`… Whether each is available in each flavor (GNU tools support some in BRE/ERE), and what a JavaScript RegExp
 * reads for it in PCRE (`js`: `=` the same escape, else the JavaScript text; none, when JavaScript reads it otherwise).
 * The worked examples (src/examples/regex.ts) take their JavaScript from here and from PCRE_ONLY, never from a table of their own.
 */
const SHORTHANDS: Record<string, { ja: string; en: string; gnu: boolean; js?: string }> = {
  w: { ja: '英数字またはアンダースコア1文字', en: 'a word character (letter, digit or underscore)', gnu: true, js: '=' },
  W: { ja: '英数字とアンダースコア以外の1文字', en: 'a non-word character', gnu: true, js: '=' },
  s: { ja: '空白文字1文字', en: 'a whitespace character', gnu: true, js: '=' },
  S: { ja: '空白以外の1文字', en: 'a non-whitespace character', gnu: true, js: '=' },
  d: { ja: '数字1文字', en: 'a digit', gnu: false, js: '=' },
  D: { ja: '数字以外の1文字', en: 'a non-digit', gnu: false, js: '=' },
  b: { ja: '単語の境界（文字は消費しない）', en: 'a word boundary (matches no character)', gnu: true, js: '=' },
  B: { ja: '単語の境界ではない位置', en: 'a position that is not a word boundary', gnu: true, js: '=' },
  '<': { ja: '単語の先頭', en: 'the start of a word', gnu: true },
  '>': { ja: '単語の末尾', en: 'the end of a word', gnu: true },
  A: { ja: '文字列の先頭', en: 'the start of the text', gnu: false, js: '^' },
  z: { ja: '文字列の末尾', en: 'the end of the text', gnu: false, js: '$' },
  Z: { ja: '文字列の末尾（末尾の改行の前も可）', en: 'the end of the text (or before a final newline)', gnu: false, js: '$' },
  t: { ja: 'タブ', en: 'a tab', gnu: false, js: '=' },
  n: { ja: '改行', en: 'a newline', gnu: false, js: '=' },
  r: { ja: '復帰文字(CR)', en: 'a carriage return', gnu: false, js: '=' },
  f: { ja: '改ページ', en: 'a form feed', gnu: false, js: '=' },
  e: { ja: 'ESC 文字', en: 'an escape character (ESC)', gnu: false, js: '\\x1b' },
  a: { ja: 'ベル文字(BEL)', en: 'a bell character (BEL)', gnu: false, js: '\\x07' },
  h: { ja: '水平方向の空白（タブなど）1文字', en: 'a horizontal whitespace character (space, tab…)', gnu: false, js: '[ \\t]' },
  H: { ja: '水平方向の空白以外の1文字', en: 'a character that is not horizontal whitespace', gnu: false, js: '[^ \\t]' },
  v: { ja: '垂直方向の空白（改行、改ページなど）1文字', en: 'a vertical whitespace character (newline, form feed…)', gnu: false },
  V: { ja: '垂直方向の空白以外の1文字', en: 'a character that is not vertical whitespace', gnu: false },
};

/** PCRE escapes that no other flavor has, and that mean nothing inside `[…]`. */
const PCRE_ONLY: Record<string, { ja: string; en: string; kind: 'keyword' | 'pattern'; js?: string }> = {
  K: { ja: 'ここまでに一致した部分を、報告する一致から外す（`grep -o` はこの後ろだけを表示する。文字は消費しない）', en: 'keep what has matched so far out of the reported match (`grep -o` prints only what follows; consumes nothing)', kind: 'keyword' },
  G: { ja: '前の一致の終わりの位置（最初は先頭）', en: 'the position where the previous match ended (the start at first)', kind: 'keyword' },
  R: { ja: '改行1つ（`\\r\\n`、`\\n`、`\\r` など）', en: 'one line break (`\\r\\n`, `\\n`, `\\r`…)', kind: 'pattern' },
  N: { ja: '改行以外の1文字', en: 'any one character except a newline', kind: 'pattern', js: '[^\\n]' },
  X: { ja: '見た目の1文字（結合文字を含む）', en: 'one extended grapheme cluster (a character with its combining marks)', kind: 'pattern' },
};

/** Letters PCRE2 accepts after a backslash; any other letter makes `grep -P` stop with an error. */
const PCRE_ESCAPE_LETTERS = 'aAbBcCdDeEfgGhHkKnNopPQrRsStvVwWxXzZ';

/** Perl's case escapes (`\U…\E`), which it applies before the regex is compiled; PCRE2 has none (`grep -P` stops). */
const PERL_CASE = 'ULFul';

/**
 * What a JavaScript RegExp reads for the PCRE escape `\c` (not in a class: `inClass` false), when it means what PCRE means:
 * the JavaScript text. In a class only the escapes that are one set of characters (`\d`, `\h`…) qualify. Undefined when no
 * JavaScript text means the same, so no example is made. The one place that decides it for the reader's tables.
 */
export function pcreJs(c: string, inClass: boolean): string | undefined {
  const js = SHORTHANDS[c]?.js ?? PCRE_ONLY[c]?.js;
  if (js === undefined) return undefined;
  if (js === '=') return `\\${c}`;
  if (!inClass) return js;
  // (A class of one escape: `\h` is `[ \t]` outside a class and ` \t` inside; a negated one, or an anchor, cannot be inside.)
  return js.startsWith('[') && !js.startsWith('[^') ? js.slice(1, -1) : undefined;
}

/** The character code `\x41`, `\x{263a}`, `\101`, `\o{101}` or `\cA` stands for at `at` in a PCRE source, and its length. */
export function pcreCharCode(src: string, at: number, inClass: boolean): { length: number; code: number } | undefined {
  const e = codeEscape(src, at, inClass);
  return e?.code === undefined ? undefined : { length: e.length, code: e.code };
}

interface State {
  src: string;
  i: number;
  flavor: Flavor;
  groups: number;
  s: (ja: string, en: string) => string;
  /** Plain single-character literals, which may be merged into runs. */
  literals: Set<EmbeddedToken>;
  /** PCRE named groups, by name. */
  names: Map<string, number>;
  /** GNU sed turns `\t`, `\n`… into characters before compiling the regex, even inside `[…]`. */
  sedEscapes: boolean;
  /** Of a hole here (`RegexOptions`). */
  hole: { delimiter?: string; perl?: boolean };
  /** The program that reads the regex: what a backslash and a letter mean differs between them. */
  tool: RegexTool | 'perl';
  /** mawk reads the awk regex (`\y` is the letter). */
  mawk: boolean;
  /** What `^` and `$` stand at the ends of here (`RegexOptions.unit`; an inline `(?m)` changes it from where it stands). */
  unit: MatchUnit;
  /** What they stand at the ends of before any `(?m)`. */
  base: MatchUnit;
}

/** What a regex is matched against: one line (grep, sed), or a whole string that may hold newlines (bash, awk, Perl). */
/** (`record`: the text is awk's record, `$0`, which a rule's `/re/` matches.) */
export type MatchUnit = 'line' | 'text' | 'record';

/** The unit of each tool (bash's `[[ =~ ]]` and awk's `~` and `match` read the string whole; no tool but `grep`/`sed` splits it). */
const UNITS: Record<RegexTool | 'perl', MatchUnit> = { grep: 'line', sed: 'line', awk: 'text', bash: 'text', perl: 'text' };

/** A variable Perl puts in before it reads the regex (`$x`, `${x}`, `$::x`, `$&`, `@a`). */
const PERL_VARIABLE = /\$[\w{:&]|@[A-Za-z_{:]/;

/** The program that reads a regex; `grep` stands for GNU grep, whose `-P` is the PCRE flavor. */
export type RegexTool = 'grep' | 'sed' | 'awk' | 'bash';

export interface RegexOptions {
  /** Interpret `\t`, `\n`… as GNU sed does. */
  sedEscapes?: boolean;
  /** The character that ends this regex where a command delimits it (`s/…/`), for what a hole says. */
  delimiter?: string;
  /** Perl reads the text before the regex does. */
  perl?: boolean;
  /** The program that reads the regex (`grep` when not given, `sed` with `sedEscapes`, `perl` with `perl`). */
  tool?: RegexTool;
  /** The awk is mawk, which has none of gawk's regex escapes (`\y`). */
  mawk?: boolean;
  /** What `^` and `$` stand at the ends of, where the tool's usual unit is not it (`grep -z` reads a record, Perl's `/m` a line). */
  unit?: MatchUnit;
}

/** Explain a regular expression as a flat sequence of tokens (groups nest their contents). */
export function explainRegex(src: string, flavor: Flavor, lang: Lang, opts: RegexOptions = {}): EmbeddedToken[] {
  // (`\Q$x\E`: the value is plain text there, which this reader does not follow.)
  if (flavor === 'pcre' && src.includes('\\Q') && hasHole(src)) return [holeStop(0)];
  const tool = opts.perl ? 'perl' : opts.tool ?? (opts.sedEscapes ? 'sed' : 'grep');
  const st: State = { src, i: 0, flavor, groups: 0, s: pick(lang), literals: new Set(), names: new Map(), sedEscapes: !!opts.sedEscapes, tool, hole: { delimiter: opts.delimiter, perl: opts.perl }, mawk: !!opts.mawk, unit: opts.unit ?? UNITS[tool], base: opts.unit ?? UNITS[tool] };
  return mergeLiterals(sequence(st, 0), st);
}

/** `^` and `$`: the start and the end of what the tool matches, a line or a text; Perl's `$` also stands before a final newline. */
function anchor(st: State, c: '^' | '$'): string {
  const { s } = st;
  if (st.unit === 'record') return c === '^' ? s('`^`: レコード（`$0`）の先頭', '`^`: start of the text (the record, `$0`)') : s('`$`: レコード（`$0`）の末尾', '`$`: end of the text (the record, `$0`)');
  if (c === '^') return st.unit === 'line' ? s('`^`: 行の先頭', '`^`: start of the line') : s('`^`: 文字列の先頭', '`^`: start of the text');
  if (st.unit === 'line') return s('`$`: 行の末尾', '`$`: end of the line');
  return st.tool === 'perl' ? s('`$`: 文字列の末尾（末尾の改行の前も可）', '`$`: end of the text (or before a final newline)') : s('`$`: 文字列の末尾', '`$`: end of the text');
}

/** The escape of a character that the tool turns into it before it reads the regex (GNU sed's `\t`, gawk's `\101`), if one is at `i`. */
function charEscape(st: State, i: number): ReturnType<typeof sedEscapeAt> {
  return st.tool === 'awk' ? awkEscapeAt(st.src, i) : st.sedEscapes ? sedEscapeAt(st.src, i) : undefined;
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
    if (isHole(c)) {
      st.i++;
      // (Something after it, or before it other than plain text: their reading rests on what the value is.)
      out.push(holeToken(start, 'regex', { ...st.hole, around: st.src.length > start + 1 || out.some((t) => !st.literals.has(t)) }));
      continue;
    }
    if (holeDecides(st, start, c)) {
      st.i++;
      out.push(holeStop(start));
      continue;
    }
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
    if (st.flavor === 'bre' && st.src.startsWith('\\{', start)) {
      // (A valid `\{n,m\}` was taken as a quantifier above.)
      st.i += 2;
      out.push({ start, end: st.i, kind: 'error', explanation: s('`\\{` は `\\{n\\}` や `\\{n,m\\}` の形でないと使えない。grep と sed は "Unmatched \\{" などのエラーで止まる', '`\\{` must start a complete `\\{n\\}` or `\\{n,m\\}`; grep and sed stop with an error such as "Unmatched \\{"'), children: [] });
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
      out.push({ start, end: st.i, kind: 'keyword', explanation: anchor(st, '^'), children: [] });
    } else if (c === '$' && (st.flavor !== 'bre' || st.i === st.src.length || isGroupClose(st) || isAlternation(st))) {
      out.push({ start, end: st.i, kind: 'keyword', explanation: anchor(st, '$'), children: [] });
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

/** Sticky: a `{` whose count a hole is part of (`a{$n}`, `a{1,$n}`), and a set with a class a hole is part of (`[[:$c:]]`). */
const COUNT_WITH_HOLE = /\{[\d,]*[\ufdd2-\ufdef]/y;
const CLASS_WITH_HOLE = /\[[:.=][^\]]*[\ufdd2-\ufdef]/y;
const at = (re: RegExp, src: string, i: number): boolean => {
  re.lastIndex = i;
  return re.test(src);
};

/**
 * Whether what a character at `i` is depends on the value of a hole next to it. A count (`a{$n}`, `\{$n\}` is an error
 * token of its own). In a basic regex, `^` after a hole and `$` before one, which an empty value makes anchors.
 */
function holeDecides(st: State, i: number, c: string): boolean {
  const { src, flavor } = st;
  if (c === '{') return flavor !== 'bre' && at(COUNT_WITH_HOLE, src, i);
  return flavor === 'bre' && ((c === '^' && isHole(src[i - 1])) || (c === '$' && isHole(src[i + 1])));
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
  // (After a hole, it repeats what the value ends with, whatever the value is.)
  if (target?.hole?.place === 'regex') return { start, end: st.i, kind: 'operator', explanation: '', children: [], hole: { place: 'repeat', of: st.src[target.start], written: raw } };
  const of = (ja: boolean): string => target ? codeShown(st.src.slice(target.start, target.end), ja, ' ') : ja ? '直前の要素 ' : 'the previous item';
  let q = raw.replace(/^\\/, '').replace(/\\\}$/, '}').replace(/^\\\{/, '{');
  let mode = '';
  // PCRE: a trailing `?` makes it lazy, a `+` possessive (`*?`, `{2,}+`).
  if (st.flavor === 'pcre' && q.length > 1 && /[?+]$/.test(q)) {
    mode = q.slice(-1);
    q = q.slice(0, -1);
  }
  let times: string;
  if (q === '*') times = s('0回以上', 'zero or more times');
  else if (q === '+') times = s('1回以上', 'one or more times');
  else if (q === '?') times = s('0回か1回（あってもなくてもよい）', 'zero or one time (optional)');
  else {
    // `{n}`, `{n,}`, `{,m}` or `{n,m}`: quantifierLength takes no other braces.
    const [, lo, comma, hi] = /^\{(\d*)(,?)(\d*)\}$/.exec(q)!;
    if (!comma) times = s(`ちょうど${lo}回`, `exactly ${lo} times`);
    else if (!hi) times = s(`${lo}回以上`, `${lo} or more times`);
    else if (!lo) times = s(`${hi}回以下`, `at most ${hi} times`);
    else times = s(`${lo}〜${hi}回`, `${lo} to ${hi} times`);
  }
  const greed = mode === '?' ? s('（できるだけ少なく）', ' (as few as possible)')
    : mode === '+' ? s('（バックトラックしない）', ' (possessive, no backtracking)')
      : '';
  return { start, end: st.i, kind: 'operator', explanation: s(`\`${raw}\`: ${of(true)}を${times}繰り返す${greed}`, `\`${raw}\`: repeat ${of(false)} ${times}${greed}`), children: [] };
}

function group(st: State, openLen: number): EmbeddedToken {
  const { s } = st;
  const start = st.i;
  st.i += openLen;
  // (An inline `(?m)` lasts to the end of its group.)
  const unit = st.unit;
  let explanation: string;
  let group: number | undefined;
  const rest = st.src.slice(st.i);
  // (`(?$x)`: the value may be what follows the `?`.)
  const ext = st.flavor === 'pcre' ? /^\?(:|=|!|<=|<!|>|#[^)]*\)?|P?<([A-Za-z_]\w*)>|'([A-Za-z_]\w*)'|([imsxnUJ-]+)([:)]))/.exec(rest) : null;
  if (st.flavor === 'pcre' && !ext && rest[0] === '?' && hasHole(rest)) return holeStop(start);
  if (st.flavor === 'pcre' && !ext && /^[?*]/.test(rest)) {
    // `(?|`, `(?1)`, `(?R)`, `(?P=n)`, `(?(…)…)`, `(*VERB)`: the whole group, unread.
    st.i = groupEnd(st.src, start);
    const text = st.src.slice(start, st.i);
    return { start, end: st.i, kind: 'pattern', explanation: s(`\`${text}\`: この解説では読めない PCRE の構文`, `\`${text}\`: a PCRE construct this explainer does not read`), children: [] };
  }
  if (ext) {
    st.i += ext[0].length;
    const k = ext[1];
    const name = ext[2] ?? ext[3];
    if (ext[4]) inlineFlags(st, ext[4]);
    if (k === ':') explanation = s('`(?:…)`: まとめるだけのグループ（番号は付かない）', '`(?:…)`: non-capturing group');
    else if (k === '=') explanation = s('`(?=…)`: 直後に … が続く位置（先読み。文字は消費しない）', '`(?=…)`: followed by … (lookahead, consumes nothing)');
    else if (k === '!') explanation = s('`(?!…)`: 直後に … が続かない位置（否定先読み）', '`(?!…)`: not followed by … (negative lookahead)');
    else if (k === '<=') explanation = s('`(?<=…)`: 直前が … である位置（後読み）', '`(?<=…)`: preceded by … (lookbehind)');
    else if (k === '<!') explanation = s('`(?<!…)`: 直前が … ではない位置（否定後読み）', '`(?<!…)`: not preceded by … (negative lookbehind)');
    else if (k === '>') explanation = s('`(?>…)`: 一度一致したらやり直さないグループ（アトミックグループ。番号は付かない）', '`(?>…)`: atomic group (once matched, never backtracked into; no number)');
    else if (k[0] === '#') {
      return { start, end: st.i, kind: 'comment', explanation: s('`(?#…)`: コメント（一致には関係しない）', '`(?#…)`: a comment (does not affect matching)'), children: [] };
    } else if (name) {
      group = ++st.groups;
      st.names.set(name, group);
      explanation = s(`名前付きグループ \`${name}\`（グループ ${group}）: 一致した部分を名前で参照できる`, `Named group \`${name}\` (group ${group})`);
    } else if (ext[5] === ':') {
      explanation = s(`\`(?${ext[4]}:…)\`: このグループの中だけマッチのオプションを切り替える（番号は付かない）`, `\`(?${ext[4]}:…)\`: set matching options inside this group only (no number)`);
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
  st.unit = unit;
  return { start, end: st.i, kind: 'block', explanation, children, ...(group ? { group } : {}) };
}

/** `(?m)` and `(?-m)` (also `(?i-m:`): with `m` `^` and `$` stand at every line; without it, at the ends of the text (of the line, in grep). */
function inlineFlags(st: State, flags: string): void {
  const [on, off = ''] = flags.split('-');
  if (on.includes('m')) st.unit = 'line';
  else if (off.includes('m')) st.unit = st.tool === 'grep' ? st.base : 'text';
}

/** The end of the group that opens at `open` (an unclosed one ends with the text). */
function groupEnd(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '\\') i++;
    else if (src[i] === '(') depth++;
    else if (src[i] === ')' && --depth === 0) return i + 1;
  }
  return src.length;
}

function bracket(st: State): EmbeddedToken {
  const { s, src } = st;
  const start = st.i;
  let i = start + 1;
  let negated = false;
  if (src[i] === '^') { negated = true; i++; }
  const items: string[] = [];
  const holes: EmbeddedToken[] = [];
  // (grep -P refuses a range that has a set at an end: `[\w-.]`, `[a-\d]`, `[[:alpha:]-z]`.)
  let badRange = false;
  const rangeAt = (k: number) => st.flavor === 'pcre' && st.tool === 'grep' && src[k] === '-' && k + 1 < src.length && src[k + 1] !== ']';
  let first = true;
  while (i < src.length && (src[i] !== ']' || first)) {
    first = false;
    // (A range with a hole at one end, and a class with one in it, are what the value makes them.)
    if (at(CLASS_WITH_HOLE, src, i) || (src[i + 1] === '-' && src[i + 2] !== ']' && (isHole(src[i]) || isHole(src[i + 2])))) {
      st.i = start + 1;
      return holeStop(start);
    }
    if (isHole(src[i])) {
      holes.push(holeToken(i, 'class'));
      items.push(s(`\`${src[i]}\` の値の文字`, `the characters of the value of \`${src[i]}\``));
      i++;
      continue;
    }
    const cls = /^\[:(\w+):\]/.exec(src.slice(i));
    if (cls) {
      const d = CLASSES[cls[1]];
      items.push(d ? s(d[0], d[1]) : cls[0]);
      i += cls[0].length;
      if (rangeAt(i)) badRange = true;
      continue;
    }
    const se = charEscape(st, i);
    if (se) {
      items.push(se.text(s));
      i += se.length;
      continue;
    }
    if (st.tool === 'awk' && src[i] === '\\' && i + 1 < src.length) {
      // (awk: a backslash in a class makes the next character itself, never a range or a set: `[\.]` is ".", `[\]]` is "]", `[\d]` is "d".)
      items.push(s(`「${src[i + 1]}」`, `"${src[i + 1]}"`));
      i += 2;
      continue;
    }
    if (st.flavor === 'pcre') {
      // (A character, or a range of two: `[\x00-\x7F]`. A class such as `\d` is a set, and ends no range.)
      const a = pcreClassAtom(src, i, s);
      i += a.length;
      if (rangeAt(i) && (a.code === undefined || pcreClassAtom(src, i + 1, s).code === undefined)) badRange = true;
      if (a.code !== undefined && src[i] === '-' && i + 1 < src.length && src[i + 1] !== ']') {
        const b = pcreClassAtom(src, i + 1, s);
        if (b.code !== undefined) {
          items.push(a.plain && b.plain ? s(`${a.plain}〜${b.plain}`, `${a.plain}-${b.plain}`)
            : s(`文字コード ${codeLabel(a.code)}〜${codeLabel(b.code)} の範囲の文字`, `the characters with codes ${codeLabel(a.code)} to ${codeLabel(b.code)}`));
          i += 1 + b.length;
          continue;
        }
      }
      items.push(a.text);
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
  if (badRange) return { start, end: st.i, kind: 'error', explanation: s('範囲の端に `\\d` のような集合があり、不正な範囲（grep -P はエラーにする: invalid range in character class）', 'Invalid range: a set such as `\\d` is at one end (grep -P fails with "invalid range in character class")'), children: holes };
  const list = items.join(s('、', ', '));
  return {
    start, end: st.i, kind: 'pattern', children: holes,
    explanation: negated
      ? s(`文字クラス: ${list} 以外の1文字`, `Character class: one character other than ${list}`)
      : s(`文字クラス: ${list} のどれか1文字`, `Character class: one of ${list}`),
  };
}

const hexOf = (code: number) => `0x${code.toString(16).toUpperCase().padStart(2, '0')}`;

/** A code as a range end is told: `0x41` and, when the character shows, `("A")`. */
function codeLabel(code: number): string {
  return code < 32 || (code >= 127 && code < 160) || code > 0x10ffff ? hexOf(code) : `${hexOf(code)} ("${String.fromCodePoint(code)}")`;
}

/** What `[…]` of PCRE holds at `i`: one character (with its code, and the text when it was written plainly), or a set. */
interface ClassAtom { length: number; text: string; code?: number; plain?: string }

const CLASS_CONTROLS: Record<string, number> = { t: 9, n: 10, r: 13, f: 12, e: 27, a: 7, b: 8 };

function pcreClassAtom(src: string, i: number, s: (ja: string, en: string) => string): ClassAtom {
  if (src[i] !== '\\' || i + 1 >= src.length) {
    const ch = String.fromCodePoint(src.codePointAt(i)!);
    return { length: ch.length, code: ch.codePointAt(0), plain: ch, text: s(`「${ch}」`, `"${ch}"`) };
  }
  const c = src[i + 1];
  const code = codeEscape(src, i, true);
  if (code) return { length: code.length, code: code.code, text: code.text(s) };
  const d = c in CLASS_CONTROLS && c !== 'b' || /[wWsSdDhHvV]/.test(c) ? SHORTHANDS[c] : undefined;
  // (`\b` is a backspace in a class; the other letters PCRE knows are errors there, and the rest stand for themselves.)
  if (d) return { length: 2, text: s(d.ja, d.en), ...(c in CLASS_CONTROLS ? { code: CLASS_CONTROLS[c] } : {}) };
  if (c === 'b') return { length: 2, code: 8, text: s('バックスペース', 'a backspace') };
  if (/[A-Za-z]/.test(c)) return { length: 2, text: `\`\\${c}\`${s('（クラスの中では使えない）', ' (not valid in a class)')}` };
  return { length: 2, code: c.codePointAt(0), text: s(`「${c}」`, `"${c}"`) };
}

/** `\x41`, `\x{263a}`, `\012`, `\o{101}`, `\cA`, `\p{L}`: the PCRE escapes that name a character or a property. In a class `\101` is octal too. */
function codeEscape(src: string, at: number, inClass = false): { length: number; code?: number; text: (s: (ja: string, en: string) => string) => string } | undefined {
  const rest = src.slice(at);
  const charOf = (code: number, s: (ja: string, en: string) => string) => {
    const hex = hexOf(code);
    return code < 32 || code === 127 || code > 0x10ffff ? s(`文字コード ${hex} の文字`, `the character with code ${hex}`)
      : s(`文字コード ${hex} の文字「${String.fromCodePoint(code)}」`, `the character with code ${hex} ("${String.fromCodePoint(code)}")`);
  };
  let m: RegExpExecArray | null;
  if ((m = /^\\x(?:\{([0-9A-Fa-f]+)\}|([0-9A-Fa-f]{0,2}))/.exec(rest))) { const code = parseInt(m[1] ?? (m[2] || '0'), 16); return { length: m[0].length, code, text: (s) => charOf(code, s) }; }
  if ((m = (inClass ? /^\\(?:([0-7]{1,3})|o\{([0-7]+)\})/ : /^\\(?:0([0-7]{0,2})|o\{([0-7]+)\})/).exec(rest))) { const code = parseInt(m[1] ?? m[2]!, 8) || 0; return { length: m[0].length, code, text: (s) => charOf(code, s) }; }
  if ((m = /^\\c([\x20-\x7e])/.exec(rest))) { const code = m[1].toUpperCase().charCodeAt(0) ^ 0x40; return { length: m[0].length, code, text: (s) => s(`制御文字 Ctrl-${m![1].toUpperCase()}`, `the control character Ctrl-${m![1].toUpperCase()}`) }; }
  if ((m = /^\\([pP])(?:\{(\^?)([\w &]+)\}|(\w))/.exec(rest))) {
    const not = (m[1] === 'P') !== (m[2] === '^');
    const prop = m[3] ?? m[4];
    return { length: m[0].length, text: (s) => (not ? s(`Unicode の性質 \`${prop}\` を持たない1文字`, `a character without the Unicode property \`${prop}\``) : s(`Unicode の性質 \`${prop}\` を持つ1文字`, `a character with the Unicode property \`${prop}\``)) };
  }
  return undefined;
}

/** The PCRE escapes that no other flavor has; undefined for one read by the shared table. */
function pcreEscape(st: State, start: number, c: string): EmbeddedToken | undefined {
  const { s, src } = st;
  const text = () => src.slice(start, st.i);
  const tok = (kind: EmbeddedToken['kind'], explanation: string, extra: Partial<EmbeddedToken> = {}): EmbeddedToken => ({ start, end: st.i, kind, explanation, children: [], ...extra });
  const only = PCRE_ONLY[c];
  if (only) return tok(only.kind, `\`\\${c}\`: ${s(only.ja, only.en)}`);
  if (c === 'Q') {
    const end = src.indexOf('\\E', start + 2);
    st.i = end < 0 ? src.length : end + 2;
    const body = src.slice(start + 2, end < 0 ? src.length : end);
    // (Perl reads `$x` and `@x` in a regex before `\Q` quotes what they hold; grep -P has no variables, `$x` is the text.)
    if (st.tool === 'perl' && PERL_VARIABLE.test(body.replace(/\\./g, ''))) {
      return tok('string', s(`\`\\Q…\\E\`: 間の「${body}」の変数をまず値に置き換え、その結果の文字列をそのまま（記号も特別扱いしない）一致させる`,
        `\`\\Q…\\E\`: Perl first replaces the variables in "${body}" with their values, then takes the resulting text literally (no character in it is special)`));
    }
    return tok('string', s(`\`\\Q…\\E\`: 間の文字列「${body}」をそのまま（記号も特別扱いしない）`, `\`\\Q…\\E\`: the text "${body}" taken literally (no character in it is special)`));
  }
  if (c === 'E') return tok('keyword', s('`\\E`: `\\Q` の終わり（それだけでは何にも一致しない）', '`\\E`: the end of a `\\Q` (matches nothing by itself)'));
  if (PERL_CASE.includes(c)) {
    // (Perl's string escapes, applied before the regex is read: `/\Ux\E/` matches X. PCRE2 has none and `grep -P` stops.)
    if (st.tool !== 'perl') {
      return tok('error', s(`\`\\${c}\` は PCRE2 のエスケープにない。\`grep -P\` は "PCRE2 does not support \\F, \\L, \\l, \\N{name}, \\U, or \\u" で止まる（Perl には大文字・小文字にする \`\\${c}\` がある）`,
        `\`\\${c}\` is no PCRE2 escape: \`grep -P\` stops with "PCRE2 does not support \\F, \\L, \\l, \\N{name}, \\U, or \\u" (Perl has a \`\\${c}\` that changes case)`));
    }
    const upper = c === 'U' || c === 'u';
    const change = (t: string) => (upper ? t.toUpperCase() : t.toLowerCase());
    // (Perl puts the value of a variable in first, and changes the case of that: `\u$x` makes the first letter of the value a capital.)
    const variable = c === 'u' || c === 'l' ? /^(?:\$\{\w+\}|\$\w+)/.exec(src.slice(start + 2))?.[0] : undefined;
    if (variable) {
      st.i = start + 2 + variable.length;
      return tok('keyword', s(`\`\\${c}${variable}\`: \`${variable}\` の値をまず入れ、その最初の1文字を${upper ? '大文字' : '小文字'}にしてから正規表現として読む`,
        `\`\\${c}${variable}\`: Perl first puts the value of \`${variable}\` in, and ${upper ? 'upper' : 'lower'}-cases its first character before the regex is read`));
    }
    if (c === 'u' || c === 'l') {
      const next = start + 2 < src.length && src[start + 2] !== '\\' ? String.fromCodePoint(src.codePointAt(start + 2)!) : '';
      st.i = start + 2 + next.length;
      return tok('keyword', next ? s(`\`\\${c}${next}\`: 次の文字「${next}」を${upper ? '大文字' : '小文字'}「${change(next)}」にしてから正規表現として読む`, `\`\\${c}${next}\`: "${next}" is ${upper ? 'upper' : 'lower'}-cased to "${change(next)}" before the regex is read`)
        : s(`\`\\${c}\`: 次の1文字を${upper ? '大文字' : '小文字'}にしてから正規表現として読む`, `\`\\${c}\`: ${upper ? 'upper' : 'lower'}-cases the next character before the regex is read`));
    }
    const end = src.indexOf('\\E', start + 2);
    st.i = end < 0 ? src.length : end + 2;
    const body = src.slice(start + 2, end < 0 ? src.length : end);
    if (PERL_VARIABLE.test(body.replace(/\\./g, ''))) {
      const how = c === 'F' ? s('大文字小文字の区別をなくす形に', 'case-folded') : upper ? s('大文字に', 'upper-cased') : s('小文字に', 'lower-cased');
      return tok('keyword', s(`\`\\${c}…\\E\`: 間の「${body}」の変数をまず値に置き換え、その結果の文字列を${how}してから正規表現として読む`,
        `\`\\${c}…\\E\`: Perl first replaces the variables in "${body}" with their values, then the resulting text is ${how} before the regex is read`));
    }
    const what = c === 'F' ? s('大文字小文字の区別をなくす形（フォールドケース）に', 'case-folded') : upper ? s(`大文字「${change(body)}」に`, `upper-cased to "${change(body)}"`) : s(`小文字「${change(body)}」に`, `lower-cased to "${change(body)}"`);
    return tok('keyword', s(`\`\\${c}…\\E\`: 間の「${body}」を${what}してから正規表現として読む`, `\`\\${c}…\\E\`: the text "${body}" is ${what} before the regex is read`));
  }
  const code = codeEscape(src, start);
  if (code) {
    st.i = start + code.length;
    return tok('pattern', `\`${text()}\`: ${code.text(s)}`);
  }
  const ref = /^\\(?:g(?:\{(-?\d+)\}|(-?\d+)|\{(\w+)\})|k(?:<(\w+)>|\{(\w+)\}|'(\w+)'))/.exec(src.slice(start));
  if (ref) {
    st.i = start + ref[0].length;
    const name = ref[3] ?? ref[4] ?? ref[5] ?? ref[6];
    const rel = Number(ref[1] ?? ref[2]);
    const group = name === undefined ? (rel < 0 ? st.groups + 1 + rel : rel) : st.names.get(name);
    const missing = !(group && group >= 1 && group <= st.groups);
    const what = name === undefined ? String(group) : `${name}${group ? ` (${group})` : ''}`;
    return tok('variable', s(`後方参照 \`${text()}\`: グループ ${what} に一致したのと同じ文字列${missing ? '（ここまでにそのグループがない）' : ''}`,
      `Backreference \`${text()}\`: the same text group ${what} matched${missing ? ' (no such group before this point)' : ''}`), missing || !group ? {} : { group });
  }
  if (c === '<' || c === '>') return tok('string', s(`文字「${c}」そのもの（PCRE の \`\\${c}\` は単語の境界ではない）`, `A literal "${c}" (in PCRE \`\\${c}\` is not a word boundary)`));
  if (/[A-Za-z]/.test(c) && !SHORTHANDS[c]) {
    // (A letter PCRE knows but this reader does not: `\C`, or `\g`, `\k`, `\p`… in a form it cannot take.)
    if (PCRE_ESCAPE_LETTERS.includes(c)) return tok('pattern', s(`\`\\${c}\`: この解説では読めない PCRE のエスケープ`, `\`\\${c}\`: a PCRE escape this explainer does not read`));
    // (Perl passes it through with a warning; PCRE2 refuses it.)
    if (st.tool === 'perl') return tok('string', s(`\`\\${c}\`: Perl では文字「${c}」扱い（警告 "Unrecognized escape \\${c} passed through" が出る）`, `\`\\${c}\`: Perl reads it as "${c}" (with the warning "Unrecognized escape \\${c} passed through")`));
    return tok('error', s(`\`\\${c}\` は PCRE のエスケープにない。\`grep -P\` は "unrecognized character follows \\" で止まる（Perl は文字「${c}」として扱う）`, `\`\\${c}\` is no PCRE escape: \`grep -P\` stops with "unrecognized character follows \\" (Perl reads it as "${c}")`));
  }
  return undefined;
}

function escape(st: State): EmbeddedToken {
  const { s, src } = st;
  const start = st.i;
  const se = charEscape(st, start);
  // (`\x$n`, `\c$x`, `\x4$n`: the escape takes characters of the value.)
  const reader = st.tool === 'awk' ? 'awk' : st.sedEscapes ? 'sed' : st.flavor === 'pcre' ? 'pcre' : undefined;
  if (reader && escapeIntoHole(src, start, reader)) {
    st.i += 2;
    return holeStop(start);
  }
  if (se) {
    st.i += se.length;
    return { start, end: st.i, kind: 'pattern', explanation: `\`${src.slice(start, st.i)}\`: ${se.text(s)}`, children: [] };
  }
  const c = src[start + 1];
  st.i += c === undefined ? 1 : 2;
  if (c === undefined) return { start, end: st.i, kind: 'error', explanation: s('末尾の `\\` の後に文字がない', 'Trailing `\\`'), children: [] };
  // (PCRE: `\12` is group 12 when there are that many groups, otherwise the octal code 012.)
  const many = st.flavor === 'pcre' ? /^\\[1-9]\d+/.exec(src.slice(start))?.[0] : undefined;
  if (many && /^\\[0-7]/.test(many) && Number(many.slice(1)) > Math.max(9, st.groups)) {
    const octal = /^\\[0-7]{1,3}/.exec(src.slice(start))!;
    st.i = start + octal[0].length;
    return { start, end: st.i, kind: 'pattern', explanation: `\`${octal[0]}\`: ${codeEscape('\\o{' + octal[0].slice(1) + '}', 0)!.text(s)}`, children: [] };
  }
  if (st.tool === 'awk' && !st.mawk && c === 'y') {
    return { start, end: st.i, kind: 'keyword', explanation: `\`\\y\`: ${s('単語の境界（gawk。文字は消費しない）', 'a word boundary (gawk; matches no character)')}`, children: [] };
  }
  // (gawk reads `\1` as the octal code 001, which awkEscapeAt has taken above; `\8` is the character 8.)
  if (/[1-9]/.test(c) && st.tool !== 'awk') {
    if (many) st.i = start + many.length;
    const num = many ? many.slice(1) : c;
    const missing = Number(num) > st.groups;
    return {
      start, end: st.i, kind: 'variable', children: [], group: Number(num),
      explanation: s(`後方参照 \`\\${num}\`: グループ ${num} に一致したのと同じ文字列${missing ? '（ここまでにグループ ' + num + ' がない）' : ''}`,
        `Backreference \`\\${num}\`: the same text group ${num} matched${missing ? ` (no group ${num} before this point)` : ''}`),
    };
  }
  if (st.flavor === 'pcre') {
    const t = pcreEscape(st, start, c);
    if (t) return t;
  }
  const sh = SHORTHANDS[c];
  if (sh && (st.flavor === 'pcre' || sh.gnu)) {
    const kind = /[bB<>AzZ]/.test(c) ? 'keyword' : 'pattern';
    return { start, end: st.i, kind, explanation: `\`\\${c}\`: ${s(sh.ja, sh.en)}`, children: [] };
  }
  if (sh && !sh.gnu) {
    // (Only grep has `-P`; sed, awk and bash have no such escape: the letter stands for itself.)
    const tool = { grep: '', sed: 'sed', awk: 'awk', perl: '', bash: 'bash' }[st.tool];
    return {
      start, end: st.i, kind: 'string', children: [],
      explanation: tool ? s(`\`\\${c}\`: ${tool} の正規表現には \`\\${c}\` がなく、文字「${c}」扱い`, `\`\\${c}\`: just "${c}"; the ${tool} regex has no \`\\${c}\``)
        : s(`\`\\${c}\`: この正規表現（POSIX）では文字「${c}」扱い。「${sh.ja}」の意味にするには \`-P\` が必要`,
          `\`\\${c}\`: just "${c}" in POSIX regex; it means ${sh.en} only with \`-P\``),
    };
  }
  if (st.flavor !== 'bre' && '(){}|+?'.includes(c) || /[.[\]*^$\\/]/.test(c)) {
    return { start, end: st.i, kind: 'string', explanation: s(`文字「${c}」そのもの（\`\\\` で特別な意味を無効にしている）`, `A literal "${c}" (escaped)`), children: [] };
  }
  return { start, end: st.i, kind: 'string', explanation: s(`文字「${c}」`, `Literal "${c}"`), children: [] };
}

export function flavorName(f: Flavor | 'fixed', lang: Lang): string {
  const s = pick(lang);
  switch (f) {
    case 'bre': return s('基本正規表現(BRE)', 'basic regex (BRE)');
    case 'ere': return s('拡張正規表現(ERE)', 'extended regex (ERE)');
    case 'pcre': return s('Perl 互換正規表現(PCRE)', 'Perl-compatible regex (PCRE)');
    case 'fixed': return s('固定文字列（正規表現として解釈しない）', 'fixed string (not a regex)');
  }
}
