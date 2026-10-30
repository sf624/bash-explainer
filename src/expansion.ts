import { evalArith, intValue } from './arith';
import { Lang } from './i18n';
import { bracketEnd, bracketItems, bracketRegex, patsubMiscounts, type BracketItem } from './bracket';
import { messageText, unquoteWord } from './staticword';

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

const OPS = [':-', ':=', ':+', ':?', '##', '%%', '//', '/#', '/%', '^^', ',,', '~~', '-', '=', '+', '?', '#', '%', '/', '^', ',', '~'];

/** Index of the first `stop` character at nesting depth 0 (outside quotes, `${…}`, `$(…)`, `[…]`). */
function findTopLevel(s: string, from: number, stop: string, ternary = false): number {
  let depth = 0;
  // In an arithmetic expression, a `:` that closes a `?` belongs to the ternary (`${s:1?2:3}`: the offset is `1?2:3`).
  let pending = 0;
  let quote: string | undefined;
  for (let i = from; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') { i++; continue; }
    if (quote) { if (c === quote) quote = undefined; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '$' && (s[i + 1] === '{' || s[i + 1] === '(')) { depth++; i++; continue; }
    if (c === '{' || c === '(' || c === '[') { depth++; continue; }
    if ((c === '}' || c === ')' || c === ']') && depth > 0) { depth--; continue; }
    if (ternary && depth === 0 && c === '?') pending++;
    else if (depth === 0 && c === stop) {
      if (!ternary || pending === 0) return i;
      pending--;
    }
  }
  return -1;
}

/**
 * The `/` that ends the pattern of `${x/p/r}` in `s`, from `from`, or -1: the first one that is not escaped, quoted or
 * inside `${…}`, `$(…)` or backquotes. Brackets, parentheses and braces do not hide it: `${x//[/]/r}` replaces a `[`
 * with `]/r`, as bash reads it.
 */
function patternSlash(s: string, from: number): number {
  for (let i = from; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') i++;
    else if (c === "'" || c === '`') {
      i = s.indexOf(c, i + 1);
      if (i < 0) return -1;
    } else if (c === '"') {
      for (i++; i < s.length && s[i] !== '"'; i++) if (s[i] === '\\') i++;
    } else if (c === '$' && (s[i + 1] === '{' || s[i + 1] === '(')) {
      i = findTopLevel(s, i + 2, s[i + 1] === '{' ? '}' : ')');
      if (i < 0) return -1;
    } else if (c === '/') return i;
  }
  return -1;
}

/**
 * The argument of `${v/pat/rep}` cut where its pattern ends (`patternSlash`); no replacement part if there is none.
 * `global`: the argument of `${v//pat/rep}`, where a `/` first is part of the pattern (`${v///x}` removes `/x`).
 */
export function splitReplacement(arg: string, global = false): { pattern: string; replacement?: string } {
  const slash = patternSlash(arg, global && arg[0] === '/' ? 1 : 0);
  return slash < 0 ? { pattern: arg } : { pattern: arg.slice(0, slash), replacement: arg.slice(slash + 1) };
}

/** Parse the text of a `${…}` expansion. Returns undefined for forms it does not understand. */
export function parseExpansion(text: string, hashIsName = false): ParsedExpansion | undefined {
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
  // (With more after the name, `${#-x}` and `${##x}` are `$#` with an operator: see `hashIsName`.)
  if (!hashIsName && /^(?:#[A-Za-z_0-9@*#?$!-]|![A-Za-z_0-9@*#?$!])/.test(inner)) {
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
  // `${#?x}`, `${##x}`, `${#-x}`: not the length of `$?`, but `$#` with an operator.
  if (prefix === '#') return parseExpansion(text, true);
  if (prefix) return undefined;

  if (rest[0] === '@' && rest.length === 2) {
    add('op', i, i + 1);
    add('transform', i + 1, i + 2);
    return { name, subscript, op: '@', parts };
  }
  if (rest[0] === ':' && !/^:[-=+?]/.test(rest)) {
    const colon = findTopLevel(inner, i + 1, ':', true);
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
    // (After `//`, a `/` first is part of the pattern: `${v///x}` removes `/x`.)
    const slash = patternSlash(inner, op === '//' && inner[argStart] === '/' ? argStart + 1 : argStart);
    if (slash < 0) add('pattern', argStart, inner.length);
    else {
      add('pattern', argStart, slash);
      add('op', slash, slash + 1);
      add('replacement', slash + 1, inner.length);
    }
  } else if (/^[#%^,~]/.test(op)) {
    if (argStart < inner.length) add('pattern', argStart, inner.length);
  } else {
    add('word', argStart, inner.length);
  }
  return { name, subscript, op, parts };
}

// ---------------------------------------------------------------- glob patterns

export type GlobPart = { type: 'any' } | { type: 'one' } | { type: 'class'; body: string } | { type: 'text'; text: string };

/**
 * A pattern as a glob with backslash escapes: its quotes removed, and each quoted character escaped (`"[a]"` is
 * `\[a\]`; `['!']` is `[\!]`, where the `!` is the character). Undefined with an expansion, an extended glob or a
 * quote that does not close.
 */
export function globText(pattern: string): string | undefined {
  if (/\$|`|[?*+@!]\(/.test(pattern)) return undefined;
  const esc = (c: string): string => (/\w/.test(c) ? c : `\\${c}`);
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '\\' && i + 1 < pattern.length) out += c + pattern[++i];
    else if (c === "'") {
      const end = pattern.indexOf(c, i + 1);
      if (end < 0) return undefined;
      out += [...pattern.slice(i + 1, end)].map(esc).join('');
      i = end;
    } else if (c === '"') {
      // (In double quotes a backslash escapes `\` and `"`; `$` and backquotes are not read here.)
      for (i++; pattern[i] !== '"'; i++) {
        if (i >= pattern.length) return undefined;
        if (pattern[i] === '\\' && /^[\\"]$/.test(pattern[i + 1])) i++;
        out += esc(pattern[i]);
      }
    } else out += c;
  }
  return out;
}

/** Split a glob into parts. Returns undefined if it contains expansions, extglobs or brackets we cannot evaluate. */
export function globParts(pattern: string): GlobPart[] | undefined {
  const glob = globText(pattern);
  if (glob === undefined) return undefined;
  const out: GlobPart[] = [];
  const text = (s: string) => {
    const last = out[out.length - 1];
    if (last?.type === 'text') last.text += s;
    else out.push({ type: 'text', text: s });
  };
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '\\' && i + 1 < glob.length) text(glob[++i]);
    else if (c === '*') out.push({ type: 'any' });
    else if (c === '?') out.push({ type: 'one' });
    else if (c === '[') {
      const end = bracketEnd(glob, i);
      if (end < 0) { text(c); continue; }
      const body = glob.slice(i + 1, end);
      if (!bracketItems(body)) return undefined;
      out.push({ type: 'class', body });
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
      case 'class': return bracketRegex(p.body)!;
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
        const read = bracketItems(p.body);
        // (One that bash reads by rules of its own, or by the locale: `[[.space.]]`, `[[=a=]]`.)
        if (!read) return ja ? `\`[${p.body}]\` に一致する1文字` : `one character that \`[${p.body}]\` matches`;
        const { negated } = read;
        const set = describeSet(read.items, lang);
        return ja ? `${set}${negated ? '以外の' : 'のどれか'}1文字` : `one character ${negated ? 'other than' : 'from'} ${set}`;
      }
      case 'text': return ja ? `「${p.text}」` : `"${p.text}"`;
    }
  }).join(' + ');
}

function describeSet(items: BracketItem[], lang: Lang): string {
  const ja = lang === 'ja';
  const named: Record<string, [string, string]> = {
    digit: ['数字', 'digits'], alpha: ['英字', 'letters'], alnum: ['英数字', 'letters/digits'],
    space: ['空白', 'whitespace'], upper: ['大文字', 'uppercase letters'], lower: ['小文字', 'lowercase letters'],
  };
  const words = items.map((item) => {
    if (item.type === 'range') return `${item.from}${ja ? '〜' : '-'}${item.to}`;
    if (item.type === 'char') return item.ch;
    return named[item.name]?.[ja ? 0 : 1] ?? `[:${item.name}:]`;
  });
  // Characters and ranges run together (`HL`, `a〜cx`); classes are told apart, and so is a `-` between two others,
  // which would read as a range (`[a\-c]` is `a`, `-` or `c`), and a `[` before `:`, `.` or `=`, which would read as a
  // class (`[[\:alpha\:]` is one of `[`, `:`, `a`…).
  const char = (k: number, re: RegExp): boolean => {
    const item = items[k];
    return item.type === 'char' && re.test(item.ch);
  };
  const apart = items.some((item, k) => item.type === 'class' || (char(k, /^-$/) && k > 0 && k < items.length - 1) || (char(k, /^\[$/) && k + 1 < items.length && char(k + 1, /^[:.=]$/)));
  return words.join(apart && items.length > 1 ? (ja ? '、' : ', ') : '');
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

// ---------------------------------------------------------------- case modification

/**
 * `${v^pat}` `${v^^pat}` `${v,pat}` `${v,,pat}` `${v~pat}` `${v~~pat}`: the first character, or every one, goes
 * to upper case, lower case, or the other case; with a pattern, only the characters it matches one by one.
 */
function convertCase(value: string, op: string, matches?: (c: string) => boolean): string {
  const change = (c: string): string => (op[0] === '^' ? c.toUpperCase() : op[0] === ',' ? c.toLowerCase() : c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase());
  return [...value].map((c, i) => ((op.length === 2 || i === 0) && (!matches || matches(c)) ? change(c) : c)).join('');
}

/** Whether a character is one the pattern of `${v^pat}` matches (undefined: no pattern, every one); null when the pattern is not one we read. */
function caseMatcher(pattern: string | undefined): ((c: string) => boolean) | undefined | null {
  const glob = pattern === undefined ? undefined : globParts(pattern);
  if (pattern !== undefined && !glob) return null;
  const one = glob && new RegExp(`^(?:${globRegex(glob)})$`);
  return one ? (c: string) => one.test(c) : undefined;
}

function caseExamples(p: ParsedExpansion, pattern: string | undefined, set: (val: string, result: string) => ExpansionCase): ExpansionCase[] | undefined {
  const op = p.op!;
  const matches = caseMatcher(pattern);
  if (matches === null) return undefined;
  const dflt = op[0] === '^' ? 'hello world' : op[0] === ',' ? 'HELLO World' : 'Hello World';
  // (For a pattern such as `l`, a value that starts with that letter, in either case.)
  const samples = [dflt, 'hello world', 'HELLO World', 'Hello World', 'HELLO', 'hello', 'report.tar.gz', 'ABC-123-xyz',
    ...[...'abcdefghijklmnopqrstuvwxyz'].flatMap((c) => [`${c}ello world`, `${c.toUpperCase()}ELLO World`])];
  const result = (v: string) => convertCase(v, op, matches);
  if (!matches) return [set(dflt, result(dflt))];
  // A value the pattern limits: it changes some characters but not all that the operator would.
  const limited = samples.find((v) => result(v) !== v && result(v) !== convertCase(v, op)) ?? samples.find((v) => result(v) !== v) ?? dflt;
  const cases = [set(limited, result(limited))];
  // With one character only the first is tried, so show a value that the pattern turns away.
  const refused = op.length === 1 ? samples.find((v) => result(v) === v && convertCase(v, op) !== v) : undefined;
  return refused ? [...cases, set(refused, refused)] : cases;
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
  /** The value of the parameter the condition gives it (`hello` of "When `msg=hello`"), when it gives one. */
  value?: string;
}

/**
 * The value the script itself gives the variable where the expansion runs, and what the expansion gives with it, when
 * the model knows it (src/explain/values.ts).
 */
export interface ScriptValue { value: string; result?: string }

/**
 * What the forms of `${…}` the model does not follow give with the script's value `v` (`${v@Q}`, `${v^^[a-c]}`,
 * `${v~}`), by the rules of the samples; only for printable ASCII, whose case is the same in every locale.
 */
function resultWith(p: ParsedExpansion, v: string): string | undefined {
  if (!/^[\x20-\x7e]*$/.test(v)) return undefined;
  const part = (role: ExpansionPart['role']) => p.parts.find((x) => x.role === role)?.text;
  if (p.op === '@') {
    const t = part('transform');
    return t === 'U' ? v.toUpperCase() : t === 'L' ? v.toLowerCase() : t === 'u' ? v.slice(0, 1).toUpperCase() + v.slice(1) : t === 'Q' ? sq(v) : undefined;
  }
  // (The model follows `${v^}`, `${v^^}`, `${v,}` and `${v,,}` without a pattern: what it does not give is not known.)
  if (!p.op || !/^[~^,]/.test(p.op) || (p.op[0] !== '~' && part('pattern') === undefined)) return undefined;
  // (A pattern we do not read has no samples either: `exampleFor` has returned before.)
  return convertCase(v, p.op, caseMatcher(part('pattern')) as ((c: string) => boolean) | undefined);
}

/** Arrays the shell fills in itself: bash code that sets them, and what they then hold. */
const SET_BY_SHELL: Record<string, { setup: string; values: string[]; ja: string; en: string }> = {
  PIPESTATUS: { setup: 'false | true', values: ['1', '0'], ja: '`false | true` の後', en: 'After `false | true`' },
  BASH_REMATCH: { setup: '[[ abc =~ (b)(c) ]]', values: ['bc', 'b', 'c'], ja: '`[[ abc =~ (b)(c) ]]` の後', en: 'After `[[ abc =~ (b)(c) ]]`' },
};

/**
 * What `${y:=w}` gives for an integer `y` that is unset or empty: the value of `w` as an arithmetic expression, which
 * `y` is assigned (`p=3` is 3, and sets `p`). A word with a name or a substitution in it has no value known here.
 */
function integerResult(word: string, ja: boolean): string {
  const value = evalArith(word.replace(/^(?:[A-Za-z_]\w*=(?!=))+/, ''));
  return value !== undefined ? String(value) : ja ? `算術式 \`${word}\` の値` : `the value of the arithmetic expression \`${word}\``;
}

const sq = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;

/** "When `msg=hello`": a case of the named variable `ref` with the value `val` (in the form `shown` gives). */
function valueCase(ref: string, val: string, shown: string, result: string, ja: boolean, integer = false): ExpansionCase {
  return { when: ja ? `\`${ref}=${shown}\` のとき` : `When \`${ref}=${shown}\``, result, setup: `${integer ? `declare -i ${ref}; ` : ''}${ref}=${sq(val)}`, value: val };
}

/** "When `msg=""`": the named variable `ref` set to an empty string. */
function emptyValueCase(ref: string, result: string, ja: boolean): ExpansionCase {
  return { when: ja ? `\`${ref}=""\` のとき` : `When \`${ref}=""\``, result, setup: `${ref}=`, value: '' };
}

/**
 * The worked example with the script's own value (docs/design/expansion-values.md): the case of that value takes the place
 * of the case of a sample value, or of the case with the same condition. When the script's value does not show what the
 * operator does (`${x#z}` of `abc`) and the sample does, both are shown, the script's first. A value that is not set, or not
 * known, leaves the samples as they are.
 */
function withScriptValue(p: ParsedExpansion, cases: ExpansionCase[], own: ExpansionCase): ExpansionCase[] {
  const same = cases.findIndex((c) => c.when === own.when);
  if (same >= 0) return cases.map((c, i) => (i === same ? own : c));
  // (The length always shows what `#` does.)
  const shows = (c: ExpansionCase) => c.result !== c.value || p.prefix === '#';
  const sample = own.value ? cases.findIndex((c) => !!c.value) : -1;
  if (sample >= 0 && (/^:?[-=+?]$/.test(p.op ?? '') || shows(own) || !shows(cases[sample]))) return cases.map((c, i) => (i === sample ? own : c));
  return [own, ...cases];
}

/**
 * Worked examples such as `file=report.tar.gz` → `report.tar`, computed with the same matching
 * rules as bash. Undefined when the expansion depends on values we cannot know. `ctx.quoted`: the expansion is in double quotes; `ctx.assoc`: the array is associative (its keys are strings, in no fixed order); `ctx.integer`: the scalar variable has the integer attribute (an assignment is arithmetic: `declare -i y; ${y:=p=3}` gives 3 and sets `p`, and `y=hello` is 0); `ctx.assigned`: its word is expanded as an assignment's value (`a=${x:+x:~}`).
 */
export function exampleFor(p: ParsedExpansion, lang: Lang, ctx: { quoted?: boolean; assoc?: boolean; integer?: boolean; assigned?: boolean; script?: ScriptValue } = {}): ExpansionCase[] | undefined {
  const cases = sampleCases(p, lang, ctx);
  const own = ctx.script;
  // (Only a variable of the script has its value: not an argument, an element, a special parameter, nor `${!x}`.)
  if (!cases || !own || !/^[A-Za-z_]\w*$/.test(p.name) || p.subscript !== undefined || p.prefix === '!') return cases;
  const v = own.value;
  const result = own.result ?? resultWith(p, v);
  if (result === undefined) return cases;
  const shown = /^[\w.,:@%+/=^-]+$/.test(v) ? v : /["$`\\!]/.test(v) ? sq(v) : `"${v}"`;
  return withScriptValue(p, cases, v === '' ? emptyValueCase(p.name, result, lang === 'ja') : valueCase(p.name, v, shown, result, lang === 'ja', ctx.integer));
}

/**
 * The word of `${x:-word}` with its tilde prefixes `~` written `$HOME`: one at its start (`~/d`), and with `colons` one
 * after each `:` outside quotes (`x:~`); undefined when it has none, null when one may be another directory (`~root`,
 * `~+`: the example leaves the word out).
 */
function homeOf(word: string, colons: boolean): string | undefined | null {
  // (A tilde prefix runs to the first `/`, and with `colons` to a `:`; a quoted character makes it none: `~"root"`.)
  const prefix = colons ? /^~([^/:]*)/ : /^~([^/]*)/;
  const skip = /\\.|'[^']*'|"(?:\\.|[^"\\])*"/sy;
  let out = '';
  // (Whether the text so far ends with a `:` outside quotes, or is empty.)
  let start = true;
  for (let i = 0; i < word.length; i++) {
    skip.lastIndex = i;
    const m = skip.exec(word);
    if (m) i += m[0].length - 1;
    const user = !m && start ? prefix.exec(word.slice(i))?.[1] : undefined;
    if (user && !/[\\'"]/.test(user)) return null;
    const tilde = user === '';
    out += tilde ? '$HOME' : m ? m[0] : word[i];
    start = colons && !m && word[i] === ':';
  }
  return out === word ? undefined : out;
}

/** The worked examples with sample values (`exampleFor`). */
function sampleCases(p: ParsedExpansion, lang: Lang, ctx: { quoted?: boolean; assoc?: boolean; integer?: boolean; assigned?: boolean }): ExpansionCase[] | undefined {
  const quoted = ctx.quoted ?? false;
  const ja = lang === 'ja';
  const name = p.name;
  // `$1`, `$2`… cannot be assigned (`2=abc` is not bash), so they are described as arguments.
  const positional = /^[1-9]\d*$/.test(name);
  // `$@` and `$*` cannot be assigned either; their values are the arguments.
  const args = name === '@' || name === '*';
  // `${a[1]:-x}`: one element of an array (the others are unset), not the scalar `a`.
  const element = p.subscript !== undefined && p.subscript !== '@' && p.subscript !== '*';
  // An integer variable: what it holds is a number (`y=hello` is 0), and it is declared before the worked examples set it.
  const integer = !!ctx.integer && !positional && !args && p.subscript === undefined && p.prefix !== '!';
  if (element && !/^\d+$/.test(p.subscript!)) return undefined;
  const ref = element ? `${name}[${p.subscript}]` : name;
  // Values are never empty here (an empty one is `emptyCase`).
  const shown = (val: string) => (/[\s']/.test(val) ? `"${val}"` : val);
  const set = (val: string, result: string): ExpansionCase => (args || positional ? {
    when: args
      ? (ja ? `引数が \`${shown(val)}\` のとき` : `When the arguments are \`${shown(val)}\``)
      : (ja ? `${name} 番目の引数が \`${shown(val)}\` のとき` : `When argument ${name} is \`${shown(val)}\``),
    result,
    setup: args ? `set -- ${sq(val)}` : undefined,
  } : valueCase(ref, val, shown(val), result, ja, integer));
  // `coproc` fills these in with descriptor numbers and a process ID: no example holds on every run.
  if (name === 'COPROC' || name === 'COPROC_PID') return undefined;
  const shellSet = Object.hasOwn(SET_BY_SHELL, name) ? SET_BY_SHELL[name] : undefined;
  const values = shellSet?.values ?? ['a', 'b', 'c'];
  const array = (result: string): ExpansionCase => shellSet
    ? { when: ja ? shellSet.ja : shellSet.en, result, setup: shellSet.setup }
    : { when: ja ? `\`${name}=(a b c)\` のとき` : `When \`${name}=(a b c)\``, result, setup: `${name}=(a b c)` };
  /** "unset or empty" (with `:`) or just "unset", phrased for a variable or an argument. */
  const missing = (orEmpty: boolean, result: string): ExpansionCase => ({
    when: args
      ? (ja ? `引数が無い${orEmpty ? 'か、空の1つだけの' : ''}とき` : `When there are no arguments${orEmpty ? ' or only an empty one' : ''}`)
      : positional
        ? (ja ? `${name} 番目の引数が無い${orEmpty ? 'か空の' : ''}とき` : `When argument ${name} is missing${orEmpty ? ' or empty' : ''}`)
        : (ja ? `${ref} が未設定${orEmpty ? 'か空' : ''}のとき` : `When ${ref} is unset${orEmpty ? ' or empty' : ''}`),
    result,
    setup: args ? 'set --' : positional ? undefined : integer ? `declare -i ${name}` : `unset ${name}`,
  });

  // The special parameters cannot be assigned (`#=hello` is not bash), and their values are not ours to choose.
  const special = /^[#?$!-]$/.test(name);
  if (ctx.assoc && p.subscript !== undefined && !shellSet) {
    // The keys of an associative array are strings, and bash lists them in an order of its own: only the count is fixed.
    if (p.prefix === '#' && (p.subscript === '@' || p.subscript === '*')) {
      const decl = `declare -A ${name}=([a]=1 [b]=2 [c]=3)`;
      return [{ when: ja ? `\`${decl}\` のとき` : `When \`${decl}\``, result: '3', setup: decl }];
    }
    return undefined;
  }
  if (p.prefix === '#') {
    if (p.subscript === '@' || p.subscript === '*') return [array(String(values.length))];
    // `${#@}` and `${#*}` count the positional parameters; they are not the length of a string.
    if (name === '@' || name === '*') return [{ when: ja ? '引数が `a b c` のとき' : 'When the arguments are `a b c`', result: '3', setup: 'set -- a b c' }];
    // `${##}` is the length of `$#`, so `set -- a b c` gives 1; the others have no fixed value.
    if (name === '#') return [{ when: ja ? '引数が `a b c` のとき' : 'When the arguments are `a b c`', result: '1', setup: 'set -- a b c' }];
    if (special) return undefined;
    return [integer ? set('12345', '5') : set('hello', '5')];
  }
  if (special && !p.prefix) return undefined;
  if (p.prefix === '!') {
    // `${!#}` is the last argument: `$#` is the number of the last one.
    if (name === '#') return [{ when: ja ? '引数が `p q r` のとき' : 'When the arguments are `p q r`', result: 'r', setup: 'set -- p q r' }];
    if (p.op === '*' || p.op === '@') {
      const [a, b] = [`${name}${name.endsWith('_') ? '' : '_'}A`, `${name}${name.endsWith('_') ? '' : '_'}B`];
      return [{ when: ja ? `${a} と ${b} があるとき` : `When ${a} and ${b} are set`, result: `${a} ${b}`, setup: `${a}=1 ${b}=2` }];
    }
    if (p.subscript === '@' || p.subscript === '*') return [array(values.map((_, i) => i).join(' '))];
    return [{ when: ja ? `\`${name}=HOME\` のとき` : `When \`${name}=HOME\``, result: ja ? '$HOME の値' : 'the value of $HOME' }];
  }
  if (!p.op) {
    if (p.subscript === '@' || p.subscript === '*') return [array(values.join(' '))];
    if (p.subscript && /^\d+$/.test(p.subscript)) {
      return [array(values[Number(p.subscript)] ?? '')];
    }
    return undefined;
  }
  const part = (role: ExpansionPart['role']) => p.parts.find((x) => x.role === role)?.text;
  // The word of `${u-'x'}` after quote removal. Inside double quotes the single quotes stay (`"${u-'x'}"` is `'x'`).
  const rawWord = part('word') ?? '';
  // An unquoted `~/d` in the word expands to the home directory (not inside double quotes: `"${x-~/d}"` stays `~/d`),
  // and in an assignment's value one after each `:` too (`a=${x:+x:~}`).
  const homed = quoted ? undefined : homeOf(rawWord, !!ctx.assigned);
  if (homed === null) return undefined;
  const homeWord = homed !== undefined;
  const word = homed ?? unquoteWord(rawWord, quoted) ?? rawWord;
  // A plausible value for "when it has a value", chosen to look like the default.
  const sample = integer ? '42' : homeWord || /^\/|^~/.test(word) ? '/data' : /^-?\d+$/.test(word) ? '42' : 'hello';
  const expanded = (w: string) => `${w}${/\$/.test(w) ? (ja ? '（展開結果）' : ' (expanded)') : ''}`;
  // (An integer variable set to nothing holds 0: `y=` is `y=0`, so it has no case of an empty value.)
  const empties = (c: ExpansionCase): ExpansionCase[] => (integer ? [] : [c]);
  const emptyCase = (result: string): ExpansionCase => (args || positional ? {
    when: args ? (ja ? '引数が空の1つだけのとき' : 'When the only argument is empty') : (ja ? `${name} 番目の引数が空のとき` : `When argument ${name} is empty`),
    result,
    setup: args ? "set -- ''" : undefined,
  } : emptyValueCase(ref, result, ja));
  // The arguments cannot be assigned to: bash stops with "cannot assign in this way" when the default would be used.
  const noAssign = ja ? 'エラー「cannot assign in this way」で止まる' : 'fails with "cannot assign in this way"';
  switch (p.op) {
    case ':=':
      if (positional || args) return [missing(true, noAssign), set(sample, sample)];
      return [missing(true, integer ? integerResult(word, ja) : expanded(word)), set(sample, sample)];
    case ':-':
      return [missing(true, expanded(word)), set(sample, sample)];
    case '=':
      if (positional || args) return [missing(false, noAssign), emptyCase(''), set(sample, sample)];
      return [missing(false, integer ? integerResult(word, ja) : expanded(word)), ...empties(emptyCase('')), set(sample, sample)];
    case '-':
      return [missing(false, expanded(word)), ...empties(emptyCase('')), set(sample, sample)];
    case ':+':
      return [set(sample, expanded(word)), missing(true, '')];
    case '+':
      return [set(sample, expanded(word)), ...empties(emptyCase(expanded(word))), missing(false, '')];
    case ':?': case '?': {
      // (`${x:?""}` prints an empty message; only a missing word gives bash's own. The quotes of the word go also inside
      // double quotes: `"${x:?'a'}"` prints `a`, as the token says.)
      const msg = rawWord ? messageText(rawWord) : ja ? '（既定のメッセージ）' : '(a default message)';
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
      // The pattern is always there, if empty (`${v/}`).
      const glob = globParts(part('pattern')!);
      const rep = part('replacement') ?? '';
      // The quotes and backslashes of the replacement are removed (`\}` is `}`); `&` stands for the match in bash 5.2.
      const repText = unquoteWord(rep);
      if (!glob || repText === undefined || /&/.test(rep)) return undefined;
      // (A pattern that bash counts otherwise than it matches, `[!]]`, finds nothing here: no example.)
      if (patsubMiscounts(globText(part('pattern')!)!)) return undefined;
      const test = new RegExp(globRegex(glob));
      // For `/` and `//` show a value with two matches, so "first" vs "every" is visible.
      const twice = p.op === '/' || p.op === '//';
      const value = (twice ? pickSample((s) => (s.match(new RegExp(globRegex(glob), 'g')) ?? []).length > 1) ?? synthesizeReplace(glob, p.op) : undefined)
        ?? pickSample((s) => test.test(s) && replace(s, glob, repText, p.op as '/') !== s)
        ?? synthesizeReplace(glob, p.op);
      if (!value) return undefined;
      return [set(value, replace(value, glob, repText, p.op as '/'))];
    }
    case '^': case '^^': case ',': case ',,': case '~': case '~~': return caseExamples(p, part('pattern'), set);
    case ':': {
      // Offset and length are arithmetic: `010` is 8, `0x2` is 2.
      const o = intValue(part('offset')!.trim());
      const lenText = part('length')?.trim();
      const l = lenText === undefined ? undefined : intValue(lenText);
      if (o === undefined || (lenText !== undefined && l === undefined)) return undefined;
      if (slicesElements(p)) {
        // Elements, not characters: `${a[@]:1:2}`, `${@:2}` (which counts from $1; $0 is the script).
        const items = ['a', 'b', 'c', 'd', 'e'];
        const args = name === '@' || name === '*';
        if ((args && o === 0) || (l !== undefined && l < 0)) return undefined;
        const start = o < 0 ? Math.max(0, items.length + o) : args ? o - 1 : o;
        const result = items.slice(start, l === undefined ? undefined : start + l).join(' ');
        return [args
          ? { when: ja ? '引数が `a b c d e` のとき' : 'When the arguments are `a b c d e`', result, setup: 'set -- a b c d e' }
          : { when: ja ? `\`${name}=(a b c d e)\` のとき` : `When \`${name}=(a b c d e)\``, result, setup: `${name}=(a b c d e)` }];
      }
      const s = 'abcdefgh';
      const start = o < 0 ? Math.max(0, s.length + o) : o;
      let end = s.length;
      if (l !== undefined) end = l < 0 ? s.length + l : start + l;
      return [set(s, s.slice(start, Math.max(start, end)))];
    }
    // `@`: a transformation.
    default: {
      const t = part('transform');
      const ex: Record<string, [string, string]> = {
        Q: ["it's", `'it'\\''s'`], E: ['a\\tb', ja ? 'a<タブ>b' : 'a<TAB>b'], U: ['hello', 'HELLO'], u: ['hello', 'Hello'],
        L: ['HELLO', 'hello'], A: ['abc', `${name}='abc'`], P: ['\\u@\\h', ja ? 'ユーザー名@ホスト名' : 'user@host'],
      };
      // (`${a[1]@A}` is a `declare` statement for the whole array: not shown.)
      const e = t && !(element && t === 'A') && ex[t];
      return e ? [set(e[0], e[1])] : undefined;
    }
  }
}

/** A character that the bracket expression `[body]` matches. */
function classSample(body: string): string {
  const { negated, items } = bracketItems(body)!;
  const first = items[0];
  const re = new RegExp(`^${bracketRegex(body)!}$`);
  const candidates = [negated ? '_' : first.type === 'char' ? first.ch : first.type === 'range' ? first.from : '', ...'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_-.]^\\!'];
  return candidates.find((c) => c && re.test(c)) ?? 'x';
}

/** Build a sample that the pattern clearly matches at the given end. */
function synthesize(glob: GlobPart[], from: 'start' | 'end'): string | undefined {
  const lit = glob.map((g) => (g.type === 'text' ? g.text : g.type === 'any' ? 'xx' : g.type === 'one' ? 'x' : classSample(g.body))).join('');
  if (!lit) return undefined;
  return from === 'start' ? `${lit}name` : `name${lit}`;
}

function synthesizeReplace(glob: GlobPart[], op: string): string | undefined {
  const lit = glob.map((g) => (g.type === 'text' ? g.text : g.type === 'any' ? 'xx' : g.type === 'one' ? 'x' : classSample(g.body))).join('');
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
  '~': ['先頭の1文字の大文字と小文字を入れ替える（あまり知られていない書き方）', 'Swap the case of the first character (a little-known form)'],
  '~~': ['すべての文字の大文字と小文字を入れ替える（あまり知られていない書き方）', 'Swap the case of every character (a little-known form)'],
  '^': ['先頭の1文字を大文字にする', 'Uppercase the first character'],
  '^^': ['すべての文字を大文字にする', 'Uppercase every character'],
  ',': ['先頭の1文字を小文字にする', 'Lowercase the first character'],
  ',,': ['すべての文字を小文字にする', 'Lowercase every character'],
  ':': ['部分文字列を取り出す（`:開始位置:長さ`）', 'Take a substring (`:offset:length`)'],
  '@': ['値を変換する（`@` の後の1文字で変換の種類を指定）', 'Transform the value (the letter after `@` selects how)'],
};

/**
 * What transform `letter` does to the value of `p`. `K` and `k` give keys and values only for all the elements of an
 * array (`${a[@]@K}`); on any other value (`${s@K}`, `${a@K}`, `${@@K}`) they quote it as `Q` does.
 */
export function transformOf(letter: string, p: { subscript?: string }): [string, string] | undefined {
  return (letter === 'K' || letter === 'k') && p.subscript !== '@' && p.subscript !== '*'
    ? ['シェルに再入力できる形に `@Q` と同じくクォートする（キーと値の組になるのは配列の全要素 `${a[@]@' + letter + '}` だけ）', 'quote it as `@Q` does, so it can be reused as shell input (only all the elements of an array, `${a[@]@' + letter + '}`, give keys and values)']
    : transformMeaning[letter];
}

export const transformMeaning: Record<string, [string, string]> = {
  Q: ['シェルに再入力できる形にクォートする', 'quote it so it can be reused as shell input'],
  E: ['バックスラッシュエスケープ（`\\n` など）を解釈済みの文字列にする（`$\'…\'` と同じ）', 'expand backslash escapes like `\\n` (as in `$\'…\'`)'],
  P: ['プロンプト文字列（PS1 と同じ書式）として展開した文字列にする', 'expand it as a prompt string (like PS1)'],
  A: ['再現用の代入文（`name=\'value\'`、配列や属性があれば `declare` の形）にする', 'turn it into an assignment statement that recreates it (a `declare` statement for an array or a variable with attributes)'],
  K: ['キーと値の組（値は引用符付き、通常の配列では添字と値の組）の形にする', 'show it as key/value pairs with quoted values (index/value pairs for an indexed array)'],
  k: ['キーと値を交互に並べた単語（通常の配列では添字と値）に分ける', 'expand it into alternating keys and values (indices and values for an indexed array)'],
  a: ['変数の属性を表す文字（`declare` のオプション文字。`i` は整数、`r` は読み取り専用など）にする', 'give the variable\'s attribute flags (as for `declare`, such as `i` for integer, `r` for read-only)'],
  U: ['すべて大文字にする', 'uppercase every character'],
  u: ['先頭の1文字を大文字にする', 'uppercase the first character'],
  L: ['すべて小文字にする', 'lowercase every character'],
};
