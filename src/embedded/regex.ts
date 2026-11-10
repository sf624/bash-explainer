import { awkEscapeAt, sedEscapeAt } from '../ctlchars';
import type { Lang } from '../i18n';
import { tokenSaid } from '../messages-tokens';
import { codeShown, shownWord } from '../messages-values';
import { EmbeddedToken, escapeIntoHole, hasHole, holeStop, holeToken, isHole, pick } from './types';
import { charOfCode, codeEscape, hexOf, namedChar, PCRE_ESCAPE_LETTERS, PCRE_ONLY, PERL_CASE, POSIX_CLASS_WORDS, SHORTHANDS } from './regex-escapes';
import { FLAG_LETTERS, IF_FLAG, NO_PYTHON_FLAGS, PYTHON_DOT, pythonGlobalFlags, type PythonRegexOptions, pythonWidth, VERBOSE_SPACE, type Width } from './regex-python';
import { pythonClassAtom, pythonEscape, pythonFinish, pythonFlagGroup, pythonGroupHead, type PythonHead, pythonRange, pythonSetWarnings, refusedRepeat } from './regex-python-read';
import { caseText, type ClassAtom, escapedLiteral, type Flavor, groupEnd, type MatchUnit, ownSaid, pcreLike, refusal, type RegexTool, type State, strictRepeats } from './regex-state';

export { pcreLike } from './regex-state';
export type { Flavor, MatchUnit, RegexTool, ShellFlavor } from './regex-state';

/** The unit of each tool (bash's `[[ =~ ]]` and awk's `~` and `match` read the string whole; no tool but `grep`/`sed` splits it). */
const UNITS: Record<RegexTool | 'perl', MatchUnit> = { grep: 'line', sed: 'line', awk: 'text', bash: 'text', perl: 'text', bazel: 'text', python: 'text' };

/** The programs whose `$` at the end of the text also stands before a final newline (Perl's, Python's `re` without `MULTILINE`). */
const END_BEFORE_NEWLINE: ReadonlySet<RegexTool | 'perl'> = new Set(['perl', 'python']);

/** A variable Perl puts in before it reads the regex (`$x`, `${x}`, `$::x`, `$&`, `@a`). */
const PERL_VARIABLE = /\$[\w{:&]|@[A-Za-z_{:]/;

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
  /** Whether the shell gets to the command (`Explainer.reachedAt`, true when not given): where it does not, an error of the regex is no problem, only its row. */
  reached?: boolean;
  /** The text is one part of the regex, with others after it (`[[ x =~ ^("a"|b)$ ]]`): a `[` or a group it leaves open is no error here. */
  part?: boolean;
  /** Python's flags (the flavor `python`): from the call's flags argument, and whether the pattern is bytes. None: no flags, a str pattern. */
  python?: PythonRegexOptions;
}

/** Explain a regular expression as a flat sequence of tokens (groups nest their contents). */
export function explainRegex(src: string, flavor: Flavor, lang: Lang, opts: RegexOptions = {}): EmbeddedToken[] {
  return readRegex(src, flavor, lang, opts).tokens;
}

/**
 * The same, with the capture groups: how many, and the number of each named one (what a template of Python's `re.sub` may name);
 * none where a construct the reader leaves unread may hold some.
 */
export function readRegex(src: string, flavor: Flavor, lang: Lang, opts: RegexOptions = {}): { tokens: EmbeddedToken[]; groups?: { count: number; names: ReadonlyMap<string, number> } } {
  // (`\Q$x\E`: the value is plain text there, which this reader does not follow.)
  if (flavor === 'pcre' && src.includes('\\Q') && hasHole(src)) return { tokens: [holeStop(0)] };
  const st = stateOf(src, flavor, lang, opts);
  if (st.py?.verbose === 'unknown') {
    // (Read with `re.VERBOSE` too, for its refusals only: `UNLESS_VERBOSE`.)
    const verbose = stateOf(src, flavor, lang, { ...opts, python: { ...st.py, verbose: true } });
    finish(verbose, sequence(verbose, 0));
    st.verboseRefused = verbose.refused;
  }
  const tokens = finish(st, sequence(st, 0));
  return { tokens: mergeLiterals(tokens, st), ...(st.unread ? {} : { groups: { count: st.groups, names: st.names } }) };
}

/** The reader's state at the start of a regex. */
function stateOf(src: string, flavor: Flavor, lang: Lang, opts: RegexOptions): State {
  const tool = opts.perl ? 'perl' : opts.tool ?? (opts.sedEscapes ? 'sed' : 'grep');
  const py = flavor === 'python' ? { ...(opts.python ?? NO_PYTHON_FLAGS) } : undefined;
  return { src, i: 0, flavor, groups: 0, lang, s: pick(lang), reached: opts.reached ?? true, rest: opts.part ? 'part' : tool === 'perl' && PERL_VARIABLE.test(src.replace(/\\./g, '')) ? 'variable' : undefined, literals: new Map(), names: new Map(), open: new Set(), sedEscapes: !!opts.sedEscapes, tool, hole: { delimiter: opts.delimiter, perl: opts.perl }, mawk: !!opts.mawk, unit: opts.unit ?? UNITS[tool], base: opts.unit ?? UNITS[tool], refused: new Set(),
    widths: new Map(), lookbehinds: [], globals: [], conditionals: [], late: new Set(), ...(py ? { py, given: py, globalAt: pythonGlobalFlags(src, py.verbose === true, py.bytes).at } : {}) };
}

/**
 * What the program refuses once the whole pattern is read: Python's own (`pythonFinish`), and in grep -P a conditional whose group the
 * pattern has not (`(?(2)…)` with one group: "reference to non-existent subpattern"; a later group may be it; Perl takes it, as a
 * group that did not take part).
 */
function finish(st: State, tokens: EmbeddedToken[]): EmbeddedToken[] {
  if (st.py) pythonFinish(st);
  else if (!st.unread && st.tool === 'grep') {
    for (const c of st.conditionals) {
      if (c.group === undefined ? st.names.has(c.name!) : c.group <= st.groups) continue;
      c.token.kind = 'error';
      c.token.explanation += st.s('。', '. ') + tokenSaid(st.lang, st.reached ? 'regex-pcre-missing-group' : 'regex-pcre-missing-group-if-reached');
    }
  }
  return tokens;
}

/**
 * `^` and `$`: the start and the end of what the tool matches, a line or a text; Perl's `$` also stands before a final newline. In
 * Python's `re`, by `MULTILINE`: at each line too, or not, or a word that says the flags are not known.
 */
function anchor(st: State, c: '^' | '$'): string {
  const { s } = st;
  if (st.py) {
    const m = st.py.multiline;
    if (m === true) return c === '^' ? s('`^`: 文字列と各行の先頭（`re.MULTILINE`）', '`^`: start of the text and of each line (`re.MULTILINE`)') : s('`$`: 各行と文字列の末尾（`re.MULTILINE`）', '`$`: end of each line and of the text (`re.MULTILINE`)');
    if (m === 'unknown') {
      return c === '^' ? s('`^`: 文字列の先頭（フラグが分からない: `re.MULTILINE` では各行の先頭も）', '`^`: start of the text (and of each line with `re.MULTILINE`: the flags are not known)')
        : s('`$`: 文字列の末尾（末尾の改行の前も可。フラグが分からない: `re.MULTILINE` では各行の末尾も）', '`$`: end of the text, or before a final newline (and the end of each line with `re.MULTILINE`: the flags are not known)');
    }
  }
  if (st.unit === 'record') return c === '^' ? s('`^`: レコード（`$0`）の先頭', '`^`: start of the text (the record, `$0`)') : s('`$`: レコード（`$0`）の末尾', '`$`: end of the text (the record, `$0`)');
  if (c === '^') return st.unit === 'line' ? s('`^`: 行の先頭', '`^`: start of the line') : s('`^`: 文字列の先頭', '`^`: start of the text');
  if (st.unit === 'line') return s('`$`: 行の末尾', '`$`: end of the line');
  return END_BEFORE_NEWLINE.has(st.tool) ? s('`$`: 文字列の末尾（末尾の改行の前も可）', '`$`: end of the text (or before a final newline)') : s('`$`: 文字列の末尾', '`$`: end of the text');
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
    // (GNU grep and sed take `\{,\}` as `*`.)
    if (m && (m[1] || m[2] || m[3])) len = m[0].length;
  }
  if (len && pcreLike(st) && (src[i + len] === '?' || src[i + len] === '+')) len++;
  return len;
}

function sequence(st: State, depth: number): EmbeddedToken[] {
  const { s } = st;
  const out: EmbeddedToken[] = [];
  const strict = strictRepeats(st);
  const atStart = () => out.length === 0 || (out[out.length - 1].kind === 'operator' && out[out.length - 1].label === '|');
  while (st.i < st.src.length) {
    const start = st.i;
    const c = st.src[start];
    if (depth > 0 && isGroupClose(st)) return out;
    if (st.py?.verbose === true && (VERBOSE_SPACE.has(c) || c === '#')) {
      const t = verboseSkip(st, start);
      if (t) out.push(t);
      continue;
    }
    if (isHole(c)) {
      st.i++;
      // (Something after it, or before it other than plain text: their reading rests on what the value is.)
      const verbose = st.py?.verbose;
      out.push(holeToken(start, 'regex', { ...st.hole, around: st.src.length > start + 1 || out.some((t) => !st.literals.has(t)), ...(verbose ? { verbose } : {}) }));
      continue;
    }
    if (holeDecides(st, start, c)) {
      st.i++;
      out.push(holeStop(start));
      continue;
    }
    let n: number;
    if (st.flavor === 'bre' && st.src.startsWith('\\{', start) && nothingBefore(out, atStart())) {
      st.i += 2;
      out.push(braceFirst(st, start));
      continue;
    }
    if ((n = isAlternation(st))) {
      st.i += n;
      out.push({ start, end: st.i, kind: 'operator', label: '|', explanation: s('`|`: 左右どちらかに一致すればよい（または）', '`|`: either the left or the right side (or)'), children: [] });
      continue;
    }
    if ((n = quantifierLength(st, atStart()))) {
      st.i += n;
      const refused = strict ? refusedRepeat(st, start, out) : undefined;
      out.push(refused ? { start, end: st.i, kind: 'error', explanation: refusal(st, refused.message, () => tokenSaid(st.lang, st.reached ? 'regex-pcre-repeat' : 'regex-pcre-repeat-if-reached', { kind: refused.kind })), children: [] } : quantifier(st, start, lastItem(out)));
      continue;
    }
    if (c === ')' && strict) {
      // (A `)` that closes a group returned above: this one closes none.)
      st.i++;
      // (Python says it once its parser has read the pattern: `pythonFinish`.)
      const message = `unbalanced parenthesis at position ${start}`;
      st.late.add(message);
      out.push({ start, end: st.i, kind: 'error', explanation: refusal(st, message, () => tokenSaid(st.lang, st.reached ? 'regex-pcre-unmatched-paren' : 'regex-pcre-unmatched-paren-if-reached')), children: [] });
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
      out.push({ start, end: st.i, kind: 'error', explanation: tokenSaid(st.lang, st.reached ? 'regex-interval-incomplete' : 'regex-interval-incomplete-if-reached', { tool: st.tool }), children: [] });
      continue;
    }
    if (c === '\\') {
      out.push(escape(st));
      continue;
    }
    st.i++;
    if (c === '.') {
      const [ja, en] = st.py ? PYTHON_DOT[String(st.py.dotall) as 'true'] : ['任意の1文字', 'any single character'];
      out.push({ start, end: st.i, kind: 'pattern', explanation: s(`\`.\`: ${ja}`, `\`.\`: ${en}`), children: [] });
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

/**
 * Whether nothing stands before `\{` in a basic regex that it could repeat: the start of the regex, of a group or of an
 * alternative, or an anchor (`^`, `\<`, `\b`: GNU grep and sed read `\<\{` as `\{` at the start).
 */
function nothingBefore(out: readonly EmbeddedToken[], atStart: boolean): boolean {
  return atStart || out[out.length - 1].kind === 'keyword';
}

/** `\{` with nothing before it to repeat (`\{1\}`, `^\{`): GNU grep reads it as the character, and GNU sed refuses it. */
function braceFirst(st: State, start: number): EmbeddedToken {
  if (st.tool === 'sed') return { start, end: st.i, kind: 'error', explanation: tokenSaid(st.lang, st.reached ? 'regex-interval-nothing-before' : 'regex-interval-nothing-before-if-reached'), children: [] };
  return { start, end: st.i, kind: 'string', explanation: st.s('文字「{」そのもの（`grep` は、前に繰り返すものがない `\\{` を文字として読む）', 'A literal "{" (`grep` reads a `\\{` with nothing before it to repeat as the character)'), children: [] };
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
  const t: EmbeddedToken = { start, end: st.i, kind: 'string', explanation: literalText(st, c, st.py, false), children: [] };
  st.literals.set(t, st.py);
  return t;
}

/**
 * The text of a literal (`merged`: a run of characters), with what Python's flags where it stands make of it (`py`): letters in either
 * case with `IGNORECASE`, and a word where a flag it depends on is not known.
 */
function literalText(st: State, text: string, py: PythonRegexOptions | undefined, merged: boolean): string {
  const said = merged ? st.s(`文字列「${text}」`, `Literal "${text}"`) : st.s(`文字「${text}」`, `Literal "${text}"`);
  return said + caseText(st, text, py) + (py?.verbose === 'unknown' && /[\s#]/.test(text) ? st.s(...IF_FLAG.verbose) : '');
}

/** The last token of `out` that is an item: not a comment, nor whitespace that VERBOSE ignores. */
function lastItem(out: readonly EmbeddedToken[]): EmbeddedToken | undefined {
  let k = out.length - 1;
  while (k >= 0 && out[k].kind === 'comment') k--;
  return out[k];
}

/**
 * What VERBOSE skips at `start` (`st.i` is moved past it): a `#` comment to the end of the line, a comment token; or a run of
 * whitespace, a token only between two items of a line (none for a line's indentation, nor before a comment or the line's end).
 */
function verboseSkip(st: State, start: number): EmbeddedToken | undefined {
  const { src } = st;
  if (src[start] === '#') {
    const nl = src.indexOf('\n', start);
    st.i = nl < 0 ? src.length : nl;
    return { start, end: st.i, kind: 'comment', explanation: tokenSaid(st.lang, 'python-regex-verbose-comment'), children: [] };
  }
  let end = start;
  while (end < src.length && VERBOSE_SPACE.has(src[end])) end++;
  st.i = end;
  const between = start > 0 && end < src.length && src[end] !== '#' && !src.slice(start, end).includes('\n');
  // (Labelled as the outputs show a blank, `␣` for a space, so that its row is not blank: `shownWord`.)
  return between ? { start, end, kind: 'comment', label: shownWord(src.slice(start, end)).text, explanation: tokenSaid(st.lang, 'python-regex-verbose-space'), children: [] } : undefined;
}

/** Join adjacent plain characters into one literal, except a character that a quantifier binds to (past whitespace VERBOSE ignores). */
function mergeLiterals(tokens: EmbeddedToken[], st: State): EmbeddedToken[] {
  const out: EmbeddedToken[] = [];
  const isQuantifier = (x: EmbeddedToken | undefined) => x?.kind === 'operator' && x.label !== '|';
  // (The next token of each that is not a comment, read once from the end.)
  const next: (EmbeddedToken | undefined)[] = [];
  for (let k = tokens.length - 1, after: EmbeddedToken | undefined; k >= 0; k--) {
    next[k] = after;
    if (tokens[k].kind !== 'comment') after = tokens[k];
  }
  tokens.forEach((t, idx) => {
    t.children = mergeLiterals(t.children, st);
    const prev = out[out.length - 1];
    if (prev && st.literals.has(prev) && st.literals.has(t) && prev.end === t.start && !isQuantifier(next[idx])) {
      prev.end = t.end;
      prev.explanation = literalText(st, st.src.slice(prev.start, prev.end), st.literals.get(prev), true);
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
  if (pcreLike(st) && q.length > 1 && /[?+]$/.test(q)) {
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
    else if (!hi) times = s(`${lo || 0}回以上`, `${lo || 0} or more times`);
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
  // (An inline `(?m)` lasts to the end of its group, and so do Python's flags of `(?i:…)`.)
  const unit = st.unit;
  const py = st.py;
  let explanation: string;
  let group: number | undefined;
  const rest = st.src.slice(st.i);
  const flagged = py && rest[0] === '?' && (FLAG_LETTERS.has(rest[1]) || rest[1] === '-') ? pythonFlagGroup(st, start) : undefined;
  if (flagged && !('scopedText' in flagged)) return flagged;
  const ext = flagged ? undefined : GROUP_EXTENSIONS[st.flavor]?.exec(rest);
  const head = flagged || ext || rest[0] !== '?' ? undefined : groupHead(st, start, rest);
  if (head?.kind === 'token') return head.token;
  if (head?.kind === 'stop') return holeStop(start);
  // (`(?$x)`: the value may be what follows the `?`.)
  if (pcreLike(st) && !ext && !head && !flagged && rest[0] === '?' && hasHole(rest)) return holeStop(start);
  const unread = UNREAD_GROUP[st.flavor];
  if (unread && !ext && !head && !flagged && unread.at.test(rest)) {
    // `(?|`, `(?1)`, `(?R)`, `(?(R)…)`, `(*VERB)`: the whole group, unread.
    st.i = groupEnd(st.src, start);
    st.unread = true;
    const text = st.src.slice(start, st.i);
    const { ja, en } = unread;
    return { start, end: st.i, kind: 'pattern', explanation: s(`\`${text}\`: ${ja}`, `\`${text}\`: ${en}`), children: [] };
  }
  const cond = head?.kind === 'conditional' ? head : undefined;
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
      [group, explanation] = named(st, name);
    } else if (ext[5] === ':') {
      explanation = s(`\`(?${ext[4]}:…)\`: このグループの中だけマッチのオプションを切り替える（番号は付かない）`, `\`(?${ext[4]}:…)\`: set matching options inside this group only (no number)`);
    } else {
      return { start, end: st.i, kind: 'keyword', explanation: s(`\`(?${k}\`: 以降のマッチのオプションを切り替える（i: 大小文字を区別しない など）`, `\`(?${k}\`: set matching options from here (i: case-insensitive, …)`), children: [] };
    }
  } else if (head?.kind === 'named') {
    st.i = head.end;
    [group, explanation] = named(st, head.name);
  } else if (cond) {
    st.i = cond.end;
    explanation = tokenSaid(st.lang, 'regex-conditional', { written: st.src.slice(start, cond.end), ...(cond.name === undefined ? { group: cond.group! } : { name: cond.name }) });
  } else if (flagged) {
    explanation = flagged.scopedText;
  } else {
    group = ++st.groups;
    explanation = s(`グループ ${group}: 中身をひとまとめにする（\`\\${group}\` で一致した文字列を参照できる）`, `Group ${group}: treats its contents as one unit (\`\\${group}\` refers to what it matched)`);
  }
  // (Python's lookbehind: references in it may not name a group opened in it, and its contents must have one width.)
  const behind = !!py && (ext?.[1] === '<=' || ext?.[1] === '<!');
  const from = st.lookbehindFrom;
  if (behind && from === undefined) st.lookbehindFrom = st.groups;
  if (group) st.open.add(group);
  const children = sequence(st, 1);
  if (group) st.open.delete(group);
  st.lookbehindFrom = from;
  const close = isGroupClose(st);
  st.i += close;
  st.unit = unit;
  st.py = py;
  const bars = cond ? branches(st, children) : 0;
  if (!close && st.rest) {
    explanation += st.rest === 'part' ? s('。この部分には閉じる `)` がない（右辺はほかの部分と合わせて1つの正規表現）', '. No `)` closes it in this part (the right side is one regex with its other parts)')
      : s('。閉じる `)` はないが、変数の値が閉じることがある', '. No `)` closes it here, but the value of a variable may');
  } else if (!close) {
    const said = refusal(st, `missing ), unterminated subpattern at position ${start}`, () => tokenSaid(st.lang, st.reached ? 'regex-group-unclosed' : 'regex-group-unclosed-if-reached', { tool: st.tool, close: st.flavor === 'bre' ? '\\)' : ')' }));
    return { start, end: st.i, kind: 'error', explanation: explanation + s('。', '. ') + said, children, ...(group ? { group } : {}) };
  }
  const token: EmbeddedToken = { start, end: st.i, kind: 'block', explanation, children, ...(group ? { group } : {}) };
  if (cond) st.conditionals.push({ token, ...(cond.name === undefined ? { group: cond.group } : { name: cond.name }), at: cond.at });
  if (py) {
    // (Each group's width once, from those of the groups in it; a conditional without a `|` may match nothing.)
    const width = pythonWidth(children, st.src, (t) => knownWidth(st, t));
    const own: Width | undefined = width && cond && !bars ? [0, width[1]] : width;
    st.widths.set(token, own);
    if (group) st.widths.set(group, own);
    if (behind && own && own[0] !== own[1]) st.lookbehinds.push({ token, width: own });
  }
  return token;
}

/** A named group (`(?P<n>…)`, `(?<n>…)`): its number, and its text. */
function named(st: State, name: string): [group: number, explanation: string] {
  const group = ++st.groups;
  st.names.set(name, group);
  return [group, st.s(`名前付きグループ \`${name}\`（グループ ${group}）: 一致した部分を名前で参照できる`, `Named group \`${name}\` (group ${group})`)];
}

/**
 * What a group that `(?` opens at `start` is, where the flavor's table (`GROUP_EXTENSIONS`) does not say: in Python, as its parser reads
 * it (`pythonGroupHead`: every other form, or its refusal); in PCRE (not bazel's Java, which has neither), a reference by name
 * (`(?P=n)`) and a conditional on a group (`PCRE_CONDITION`).
 */
function groupHead(st: State, start: number, rest: string): PythonHead | undefined {
  const reference = (group: number | undefined, name: string) => backreference(st, start, group, name);
  if (st.py) return pythonGroupHead(st, start, reference);
  if (st.flavor !== 'pcre' || st.tool === 'bazel') return undefined;
  const ref = /^\?P=([A-Za-z_]\w*)\)/.exec(rest);
  if (ref) {
    st.i = start + 1 + ref[0].length;
    return { kind: 'token', token: reference(st.names.get(ref[1]), ref[1]) };
  }
  const cond = PCRE_CONDITION.exec(rest);
  if (!cond) return undefined;
  const name = cond[2] ?? cond[3] ?? cond[4];
  return { kind: 'conditional', ...(name === undefined ? { group: Number(cond[1]) } : { name }), at: start + 3, end: start + 1 + cond[0].length };
}

/**
 * The conditions on a group that the reader reads of a PCRE conditional: a number (`(?(1)`), a name in `<…>`, in quotes, or bare
 * (`(?(n)`). Others are left unread (`UNREAD_GROUP`): a relative number (`(?(+1)`), recursion (`(?(R)`, `(?(R1)`, `(?(R&n)`),
 * `(?(DEFINE)`, `(?(VERSION>=10)`, and an assertion (`(?(?=a)`).
 */
const PCRE_CONDITION = /^\?\((?:(\d+)|<([A-Za-z_]\w*)>|'([A-Za-z_]\w*)'|(?!R\d*\)|R&|DEFINE\)|VERSION)([A-Za-z_]\w*))\)/;

/**
 * The branches of a conditional, its `children` (`(?(1)yes|no)`): its first `|` says what it does there, and one more is refused, as
 * a conditional has two branches at most (Python's message; grep -P's "conditional subpattern contains more than two branches").
 * The count of its `|`, to the second.
 */
function branches(st: State, children: EmbeddedToken[]): number {
  const bars = children.filter((t) => t.kind === 'operator' && t.label === '|');
  if (bars[0]) bars[0].explanation = tokenSaid(st.lang, 'regex-conditional-else');
  const extra = bars[1];
  if (extra) {
    extra.kind = 'error';
    extra.explanation = st.py ? ownSaid(st, `conditional backref with more than two branches at position ${extra.start}`)
      : tokenSaid(st.lang, st.reached ? 'regex-pcre-conditional-branches' : 'regex-pcre-conditional-branches-if-reached', { tool: st.tool });
  }
  return Math.min(bars.length, 2);
}

/**
 * The width of a group of a Python pattern read so far, or of the group a reference names (`\1`, `(?P=n)`, a token of the kind
 * `variable`, which has its group): none for one whose contents have a hole.
 */
function knownWidth(st: State, t: EmbeddedToken): Width | undefined {
  return st.widths.get(t.kind === 'block' ? t : t.group!);
}

/**
 * What `(?` starts in the flavors that have it (the groups of each: the kind, a name in `<…>` or in quotes, the flags, and what
 * follows them). Python's other forms are read by its parser's rules (`groupHead`), its flags by `pythonFlagGroup`.
 */
const GROUP_EXTENSIONS: Partial<Record<Flavor, RegExp>> = {
  pcre: /^\?(:|=|!|<=|<!|>|#[^)]*\)?|P?<([A-Za-z_]\w*)>|'([A-Za-z_]\w*)'|([imsxnUJ-]+)([:)]))/,
  python: /^\?(:|=|!|<=|<!|>)/,
};

/**
 * A group of the PCRE paths the reader does not read, by flavor: how it starts after `(` (`at`), and what it is said to be. Python's
 * every `(?` form is read or refused (`groupHead`), and it has no `(*VERB)`: its `(*` is a group whose `*` has nothing to repeat.
 */
const UNREAD_GROUP: Partial<Record<Flavor, { at: RegExp; ja: string; en: string }>> = {
  pcre: { at: /^[?*]/, ja: 'この解説では読めない PCRE の構文', en: 'a PCRE construct this explainer does not read' },
};

/** `(?m)` and `(?-m)` (also `(?i-m:`): with `m` `^` and `$` stand at every line; without it, at the ends of the text (of the line, in grep). */
function inlineFlags(st: State, flags: string): void {
  const [on, off = ''] = flags.split('-');
  if (on.includes('m')) st.unit = 'line';
  else if (off.includes('m')) st.unit = st.tool === 'grep' ? st.base : 'text';
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
  /** The first escape the flavor refuses in the set (Python's message). */
  let refused: string | undefined;
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
    const cls = POSIX_CLASSES.has(st.flavor) ? /^\[:(\w+):\]/.exec(src.slice(i)) : null;
    if (cls) {
      const d = POSIX_CLASS_WORDS[cls[1]];
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
    if (pcreLike(st)) {
      // (A character, or a range of two: `[\x00-\x7F]`. A class such as `\d` is a set, and ends no range.)
      const atomAt = CLASS_ATOMS[st.flavor]!;
      const from = i;
      const a = atomAt(st, i);
      i += a.length;
      // (Python stops at the first escape it refuses: the set is that error; and at a range it refuses: `[\d-z]`, `[z-a]`.)
      refused ??= a.error;
      if (rangeAt(i) && (a.code === undefined || atomAt(st, i + 1).code === undefined)) badRange = true;
      if ((a.code !== undefined || st.py) && src[i] === '-' && i + 1 < src.length && src[i + 1] !== ']') {
        const b = atomAt(st, i + 1);
        if (st.py) refused ??= b.error ?? pythonRange(src, from, i, a, b);
        if (a.code !== undefined && b.code !== undefined) {
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
  if (refused) {
    st.i = Math.min(i + 1, src.length);
    return { start, end: st.i, kind: 'error', explanation: ownSaid(st, refused), children: holes };
  }
  if (i >= src.length) {
    st.i = start + 1;
    if (st.rest) {
      return { start, end: st.i, kind: 'pattern', children: [], explanation: st.rest === 'part' ? s('`[`: 文字クラスの始まり。この部分には閉じる `]` がない（右辺はほかの部分と合わせて1つの正規表現）', '`[`: the start of a set, which no `]` closes in this part (the right side is one regex with its other parts)')
        : s('`[`: 文字クラスの始まり。閉じる `]` はないが、変数の値が閉じることがある', '`[`: the start of a set, which no `]` closes here, but the value of a variable may') };
    }
    const said = refusal(st, `unterminated character set at position ${start}`, () => tokenSaid(st.lang, st.reached ? 'regex-bracket-unclosed' : 'regex-bracket-unclosed-if-reached', { tool: st.tool }));
    return { start, end: st.i, kind: 'error', explanation: said, children: [] };
  }
  st.i = i + 1;
  if (badRange) return { start, end: st.i, kind: 'error', explanation: tokenSaid(st.lang, st.reached ? 'regex-pcre-range-set' : 'regex-pcre-range-set-if-reached'), children: holes };
  const list = items.join(s('、', ', '));
  // (Python warns of a set that a later release may read otherwise: `[[:alpha:]]` is the set `[[:alpha:]`, then a `]`.)
  const warnings = st.py ? pythonSetWarnings(src, start, st.py.bytes) : [];
  const posix = st.py && /^\[\[:\w+:\]/.exec(src.slice(start))?.[0];
  return {
    start, end: st.i, kind: 'pattern', children: holes,
    explanation: (negated
      ? s(`文字クラス: ${list} 以外の1文字`, `Character class: one character other than ${list}`)
      : s(`文字クラス: ${list} のどれか1文字`, `Character class: one of ${list}`))
      // (Letters written as themselves, not those of an escape: `[\d]` has none whose case matters.)
      + caseText(st, src.slice(start, st.i).replace(/\\[\s\S]/g, ''), st.py)
      + (warnings.length ? s('。', '. ') + tokenSaid(st.lang, 'regex-python-set-warning', { messages: warnings, ...(posix ? { posix: posix + ']' } : {}) }) : ''),
  };
}

/** A code as a range end is told: `0x41` and, when the character shows, `("A")`. */
function codeLabel(code: number): string {
  return code < 32 || (code >= 127 && code < 160) || code > 0x10ffff ? hexOf(code) : `${hexOf(code)} ("${String.fromCodePoint(code)}")`;
}

/** The flavors whose sets read POSIX classes (`[[:alpha:]]`); Python's do not (its `[[:alpha:]` is a set of the characters, then `]`). */
const POSIX_CLASSES: ReadonlySet<Flavor> = new Set(['bre', 'ere', 'pcre']);

/** What a set holds at `i` in each flavor of the PCRE paths. */
const CLASS_ATOMS: Partial<Record<Flavor, (st: State, i: number) => ClassAtom>> = { pcre: pcreClassAtom, python: (st, i) => pythonClassAtom(st, i, pcreClassAtom) };

const CLASS_CONTROLS: Record<string, number> = { t: 9, n: 10, r: 13, f: 12, e: 27, a: 7, b: 8 };

function pcreClassAtom(st: State, i: number): ClassAtom {
  const { src, s } = st;
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
    if (st.tool === 'bazel') return tok('error', javaEscape(st, c));
    if (st.tool !== 'perl') {
      return tok('error', tokenSaid(st.lang, st.reached ? 'regex-pcre-case-escape' : 'regex-pcre-case-escape-if-reached', { c }));
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
    return backreference(st, start, name === undefined ? (rel < 0 ? st.groups + 1 + rel : rel) : st.names.get(name), name);
  }
  if (c === '<' || c === '>') return tok('string', s(`文字「${c}」そのもの（PCRE の \`\\${c}\` は単語の境界ではない）`, `A literal "${c}" (in PCRE \`\\${c}\` is not a word boundary)`));
  if (/[A-Za-z]/.test(c) && !SHORTHANDS[c]) {
    // (A letter PCRE knows but this reader does not: `\C`, or `\g`, `\k`, `\p`… in a form it cannot take.)
    if (PCRE_ESCAPE_LETTERS.includes(c)) return tok('pattern', s(`\`\\${c}\`: この解説では読めない PCRE のエスケープ`, `\`\\${c}\`: a PCRE escape this explainer does not read`));
    // (Perl passes it through with a warning; PCRE2 refuses it.)
    if (st.tool === 'perl') return tok('string', s(`\`\\${c}\`: Perl では文字「${c}」扱い（警告 "Unrecognized escape \\${c} passed through" が出る）`, `\`\\${c}\`: Perl reads it as "${c}" (with the warning "Unrecognized escape \\${c} passed through")`));
    return tok('error', st.tool === 'bazel' ? javaEscape(st, c) : tokenSaid(st.lang, st.reached ? 'regex-pcre-unknown-escape' : 'regex-pcre-unknown-escape-if-reached', { c }));
  }
  return undefined;
}

/** A letter Java's regex has no escape of (bazel 9.3.2: "Illegal/unsupported escape sequence"); Perl's case escapes are such letters there. */
const javaEscape = (st: State, c: string): string => tokenSaid(st.lang, st.reached ? 'regex-java-unknown-escape' : 'regex-java-unknown-escape-if-reached', { c });

function escape(st: State): EmbeddedToken {
  const { s, src } = st;
  const start = st.i;
  const se = charEscape(st, start);
  // (`\x$n`, `\c$x`, `\x4$n`: the escape takes characters of the value.)
  const reader = st.tool === 'awk' ? 'awk' : st.sedEscapes ? 'sed' : pcreLike(st) ? 'pcre' : undefined;
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
  if (c === undefined) {
    const said = refusal(st, `bad escape (end of pattern) at position ${start}`, () => tokenSaid(st.lang, st.reached ? 'regex-trailing-backslash' : 'regex-trailing-backslash-if-reached', { tool: st.tool }));
    return { start, end: st.i, kind: 'error', explanation: said, children: [] };
  }
  const own = FLAVOR_ESCAPES[st.flavor]?.(st, start, c);
  if (own) return own;
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
  const sh = SHORTHANDS[c];
  if (sh && (pcreLike(st) || sh.gnu)) {
    const kind = /[bB<>AzZ]/.test(c) ? 'keyword' : 'pattern';
    return { start, end: st.i, kind, explanation: `\`\\${c}\`: ${s(sh.ja, sh.en)}`, children: [] };
  }
  if (sh && !sh.gnu) {
    // (Only grep has `-P`; sed, awk and bash have no such escape: the letter stands for itself.)
    const tool = { grep: '', sed: 'sed', awk: 'awk', perl: '', bash: 'bash', bazel: '', python: '' }[st.tool];
    return {
      start, end: st.i, kind: 'string', children: [],
      explanation: tool ? s(`\`\\${c}\`: ${tool} の正規表現には \`\\${c}\` がなく、文字「${c}」扱い`, `\`\\${c}\`: just "${c}"; the ${tool} regex has no \`\\${c}\``)
        : s(`\`\\${c}\`: この正規表現（POSIX）では文字「${c}」扱い。「${sh.ja}」の意味にするには \`-P\` が必要`,
          `\`\\${c}\`: just "${c}" in POSIX regex; it means ${sh.en} only with \`-P\``),
    };
  }
  return escapedLiteral(st, start, c);
}

/**
 * What the flavor reads after a backslash before the shared table does (`st.i` is past the backslash and `c`): PCRE's own escapes
 * (undefined for one the shared table reads), and every escape of Python's `re`.
 */
const FLAVOR_ESCAPES: Partial<Record<Flavor, (st: State, start: number, c: string) => EmbeddedToken | undefined>> = {
  pcre: pcreEscape,
  python: (st, start, c) => pythonEscape(st, start, c, (group) => backreference(st, start, group)),
};

/**
 * A backreference from `start` to `st.i` (`\1`, `\k<n>`, `(?P=n)`): the group by its number (none, or past those so far, where the
 * pattern has no such group before it) and by its name where it is written with one.
 */
function backreference(st: State, start: number, group: number | undefined, name?: string): EmbeddedToken {
  const text = st.src.slice(start, st.i);
  const missing = !(group && group >= 1 && group <= st.groups);
  const what = name === undefined ? String(group) : `${name}${group ? ` (${group})` : ''}`;
  return {
    start, end: st.i, kind: 'variable', children: [], ...(missing || !group ? {} : { group }),
    explanation: st.s(`後方参照 \`${text}\`: グループ ${what} に一致したのと同じ文字列${missing ? '（ここまでにそのグループがない）' : ''}`,
      `Backreference \`${text}\`: the same text group ${what} matched${missing ? ' (no such group before this point)' : ''}`),
  };
}

