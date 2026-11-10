import { awkEscapeAt, sedEscapeAt } from '../ctlchars';
import type { Lang } from '../i18n';
import { tokenSaid } from '../messages-tokens';
import { codeShown, shownWord } from '../messages-values';
import { EmbeddedToken, escapeIntoHole, hasHole, holeStop, holeToken, isHole, pick } from './types';
import { charOfCode, codeEscape, hexOf, namedChar, PCRE_ESCAPE_LETTERS, PCRE_ONLY, PERL_CASE, POSIX_CLASS_WORDS, SHORTHANDS } from './regex-escapes';
import { FLAG_LETTERS, IF_FLAG, NO_PYTHON_FLAGS, PYTHON_DOT, PYTHON_SINCE, pythonCode, pythonFlags, pythonGlobalFlags, pythonLetters, type PythonRegexOptions, pythonShorthand, pythonWidth, VERBOSE_SPACE, type Width, widthSaid } from './regex-python';

/**
 * POSIX basic (grep, sed), POSIX extended (grep -E, sed -E, [[ =~ ]]), Perl-compatible (grep -P), or Python's `re`
 * (docs/design/python-regex.md, section 3), which reads most of what PCRE does: the two share the paths of the reader
 * (`pcreLike`), and where Python differs, a table keyed by flavor says how.
 */
export type Flavor = 'bre' | 'ere' | 'pcre' | 'python';

/** The flavors of the shell's tools (grep, sed, awk, Perl, bash's `=~`, bazel's query). */
export type ShellFlavor = Exclude<Flavor, 'python'>;

/** The flavors read by the PCRE paths of the reader: PCRE, and Python's `re`. */
const PCRE_LIKE: ReadonlySet<Flavor> = new Set(['pcre', 'python']);
export const pcreLike = (st: { flavor: Flavor }): boolean => PCRE_LIKE.has(st.flavor);

/**
 * How a flavor says a pattern its program refuses, where it is in the program's own words: Python's `re` says its message
 * (`regex-python-error`); the others say the shell's entry of each kind of error. `strict`: the program also refuses a quantifier with
 * nothing to repeat (`*.txt`, `^*`) or after another (`a**`), a count whose minimum is over its maximum (`x{2,1}`), and a `)` that
 * closes no group (PCRE does too, and GNU grep's `x{2,1}`: docs/design/python-regex.md, step 3).
 */
const OWN_REFUSAL: Partial<Record<Flavor, { said: 'regex-python-error'; strict: true }>> = { python: { said: 'regex-python-error', strict: true } };

/**
 * Where `re.VERBOSE` is not known (a flags argument not read), a pattern is read without it, and each refusal is an Error only where the
 * reading with it refuses the same (docs/design/python-regex.md, 5.2): a refusal of that reading alone says it depends on the flags.
 */
const UNLESS_VERBOSE = 'regex-python-error-unless-verbose';

interface State {
  src: string;
  i: number;
  flavor: Flavor;
  groups: number;
  lang: Lang;
  s: (ja: string, en: string) => string;
  /** Whether the shell gets to the command (`RegexOptions.reached`). */
  reached: boolean;
  /** What may close a `[` or a group that this text leaves open (`RegexOptions.part`, or a variable Perl puts in): then it is no error. */
  rest?: 'part' | 'variable';
  /** Plain single-character literals, which may be merged into runs, with Python's flags where each stands (`py`: a run is in one sequence, whose flags change only in a group of its own) */
  literals: Map<EmbeddedToken, PythonRegexOptions | undefined>;
  /** PCRE named groups, by name. */
  names: Map<string, number>;
  /** The groups open where the reader is (Python refuses a reference to one). */
  open: Set<number>;
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
  /** Python's flags where the reader is (`RegexOptions.python`, then the inline flags; a group's own last to its end). */
  py?: PythonRegexOptions;
  /** Where Python's global flags (`(?i)`) may stand: at the start of the pattern, one after another (`pythonGlobalFlags`). */
  globalAt?: ReadonlySet<number>;
  /**
   * Of Python's lookbehinds, which must match one width (`pythonWidth`): the width of each group closed, by its number and its token;
   * the groups opened before the outermost lookbehind the reader is in (a reference in it may not name one opened in it); and those
   * of more than one width, refused where Python compiles the pattern (`lookbehindWidths`).
   */
  widths: Map<number | EmbeddedToken, Width | undefined>;
  lookbehindFrom?: number;
  lookbehinds: { token: EmbeddedToken; width: Width }[];
  /** A construct the reader leaves unread (`UNREAD_GROUP`), which may hold groups: their count is not known. */
  unread?: true;
  /** The messages of the refusals said so far, in the program's own words (`ownSaid`). */
  refused: Set<string>;
  /** Where Python's `re.VERBOSE` is not known: the messages of the refusals of the reading with it (`UNLESS_VERBOSE`). */
  verboseRefused?: ReadonlySet<string>;
}

/** What a regex is matched against: one line (grep, sed), or a whole string that may hold newlines (bash, awk, Perl). */
/** (`record`: the text is awk's record, `$0`, which a rule's `/re/` matches.) */
export type MatchUnit = 'line' | 'text' | 'record';

/** The unit of each tool (bash's `[[ =~ ]]` and awk's `~` and `match` read the string whole; no tool but `grep`/`sed` splits it). */
const UNITS: Record<RegexTool | 'perl', MatchUnit> = { grep: 'line', sed: 'line', awk: 'text', bash: 'text', perl: 'text', bazel: 'text', python: 'text' };

/** The programs whose `$` at the end of the text also stands before a final newline (Perl's, Python's `re` without `MULTILINE`). */
const END_BEFORE_NEWLINE: ReadonlySet<RegexTool | 'perl'> = new Set(['perl', 'python']);

/** A variable Perl puts in before it reads the regex (`$x`, `${x}`, `$::x`, `$&`, `@a`). */
const PERL_VARIABLE = /\$[\w{:&]|@[A-Za-z_{:]/;

/**
 * The program that reads a regex; `grep` stands for GNU grep, whose `-P` is the PCRE flavor; `bazel`, bazel's query, whose Java regex the
 * PCRE flavor reads; `python`, Python's `re` (the flavor `python`).
 */
export type RegexTool = 'grep' | 'sed' | 'awk' | 'bash' | 'bazel' | 'python';

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
    sequence(verbose, 0);
    lookbehindWidths(verbose);
    st.verboseRefused = verbose.refused;
  }
  const tokens = sequence(st, 0);
  lookbehindWidths(st);
  return { tokens: mergeLiterals(tokens, st), ...(st.unread ? {} : { groups: { count: st.groups, names: st.names } }) };
}

/** The reader's state at the start of a regex. */
function stateOf(src: string, flavor: Flavor, lang: Lang, opts: RegexOptions): State {
  const tool = opts.perl ? 'perl' : opts.tool ?? (opts.sedEscapes ? 'sed' : 'grep');
  const py = flavor === 'python' ? { ...(opts.python ?? NO_PYTHON_FLAGS) } : undefined;
  return { src, i: 0, flavor, groups: 0, lang, s: pick(lang), reached: opts.reached ?? true, rest: opts.part ? 'part' : tool === 'perl' && PERL_VARIABLE.test(src.replace(/\\./g, '')) ? 'variable' : undefined, literals: new Map(), names: new Map(), open: new Set(), sedEscapes: !!opts.sedEscapes, tool, hole: { delimiter: opts.delimiter, perl: opts.perl }, mawk: !!opts.mawk, unit: opts.unit ?? UNITS[tool], base: opts.unit ?? UNITS[tool], refused: new Set(),
    widths: new Map(), lookbehinds: [], ...(py ? { py, globalAt: pythonGlobalFlags(src, py.verbose === true, py.bytes).at } : {}) };
}

/**
 * Python compiles a pattern it has read, and refuses a lookbehind whose contents may match more characters or fewer (`a|bc`, `a+`):
 * where no other refusal came first, as its parser's do, each such lookbehind is an error token (its contents are still read).
 */
function lookbehindWidths(st: State): void {
  if (st.refused.size) return;
  for (const { token, width } of st.lookbehinds) {
    const [ja, en] = widthSaid(width);
    token.kind = 'error';
    token.explanation += st.s(`。中身は${ja}に一致しうる。`, `. Its contents may match ${en}. `) + ownSaid(st, 'look-behind requires fixed-width pattern');
  }
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
  const strict = OWN_REFUSAL[st.flavor];
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
      out.push(strict && refused ? { start, end: st.i, kind: 'error', explanation: ownSaid(st, refused), children: [] } : quantifier(st, start, lastItem(out)));
      continue;
    }
    if (c === ')' && strict) {
      // (A `)` that closes a group returned above: this one closes none.)
      st.i++;
      out.push({ start, end: st.i, kind: 'error', explanation: ownSaid(st, `unbalanced parenthesis at position ${start}`), children: [] });
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

/** What `IGNORECASE` makes of a text with a letter that has a case, in Python's `re` (`py`): either case, or a word that the flags are not known. */
function caseText(st: State, text: string, py: PythonRegexOptions | undefined): string {
  if (!py?.ignorecase || text.toLowerCase() === text.toUpperCase()) return '';
  return py.ignorecase === true ? st.s('（大文字小文字を区別しない）', ', in either case') : st.s(...IF_FLAG.ignorecase);
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
  // (`(?$x)`: the value may be what follows the `?`.)
  const ext = flagged ? undefined : GROUP_EXTENSIONS[st.flavor]?.exec(rest);
  if (pcreLike(st) && !ext && !flagged && rest[0] === '?' && hasHole(rest)) return holeStop(start);
  const unread = UNREAD_GROUP[st.flavor];
  if (unread && !ext && !flagged && unread.at.test(rest)) {
    // `(?|`, `(?1)`, `(?R)`, `(?P=n)`, `(?(…)…)`, `(*VERB)`: the whole group, unread.
    st.i = groupEnd(st.src, start);
    st.unread = true;
    const text = st.src.slice(start, st.i);
    const { ja, en } = unread;
    return { start, end: st.i, kind: 'pattern', explanation: s(`\`${text}\`: ${ja}`, `\`${text}\`: ${en}`), children: [] };
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
  if (!close && st.rest) {
    explanation += st.rest === 'part' ? s('。この部分には閉じる `)` がない（右辺はほかの部分と合わせて1つの正規表現）', '. No `)` closes it in this part (the right side is one regex with its other parts)')
      : s('。閉じる `)` はないが、変数の値が閉じることがある', '. No `)` closes it here, but the value of a variable may');
  } else if (!close) {
    const said = refusal(st, `missing ), unterminated subpattern at position ${start}`, () => tokenSaid(st.lang, st.reached ? 'regex-group-unclosed' : 'regex-group-unclosed-if-reached', { tool: st.tool, close: st.flavor === 'bre' ? '\\)' : ')' }));
    return { start, end: st.i, kind: 'error', explanation: explanation + s('。', '. ') + said, children, ...(group ? { group } : {}) };
  }
  const token: EmbeddedToken = { start, end: st.i, kind: 'block', explanation, children, ...(group ? { group } : {}) };
  if (py) {
    // (Each group's width once, from those of the groups in it.)
    const width = pythonWidth(children, st.src, (t) => knownWidth(st, t));
    st.widths.set(token, width);
    if (group) st.widths.set(group, width);
    if (behind && width && width[0] !== width[1]) st.lookbehinds.push({ token, width });
  }
  return token;
}

/**
 * The width of a group of a Python pattern read so far, or of the group a reference names (`\1`, `(?P=n)`): none for an open one, nor
 * for another construct the reader does not read (a conditional), which names no group (-1).
 */
function knownWidth(st: State, t: EmbeddedToken): Width | undefined {
  const name = /^\(\?P=(\w+)\)$/.exec(st.src.slice(t.start, t.end));
  return st.widths.get(t.kind === 'block' ? t : (name ? st.names.get(name[1]) : t.group) ?? -1);
}

/**
 * What `(?` starts in the flavors that have it (the groups of each: the kind, a name in `<…>` or in quotes, the flags, and what
 * follows them). Python names a group only as `(?P<name>…)` (the quoted form never matches there), and its flags are read by
 * `pythonFlagGroup` (the flags never match there).
 */
const GROUP_EXTENSIONS: Partial<Record<Flavor, RegExp>> = {
  pcre: /^\?(:|=|!|<=|<!|>|#[^)]*\)?|P?<([A-Za-z_]\w*)>|'([A-Za-z_]\w*)'|([imsxnUJ-]+)([:)]))/,
  python: /^\?(:|=|!|<=|<!|>|#[^)]*\)?|P<([A-Za-z_]\w*)>|(?!)'(\w*)')/,
};

/**
 * A group of Python's inline flags that opens at `start` (`(?i)`, `(?i-m:`), read as `_parse_flags` of its `re._parser` reads it:
 * a token for global flags (they must start the pattern: `State.globalAt`), or for one it refuses, with its message; else, for flags of the
 * group only, its text (the flags are in effect in `st.py` from here; the group restores them).
 */
function pythonFlagGroup(st: State, start: number): EmbeddedToken | { scopedText: string } {
  const read = pythonFlags(st.src, start, st.py!.bytes);
  const tok = (kind: EmbeddedToken['kind'], explanation: string): EmbeddedToken => ({ start, end: st.i, kind, explanation, children: [] });
  if ('error' in read) {
    st.i = groupEnd(st.src, start);
    return tok('error', ownSaid(st, read.error));
  }
  st.i = read.end;
  const names = (letters: string) => [...letters].map((l) => FLAG_LETTERS.get(l)!.name);
  const py = { ...st.py! };
  for (const [letters, on] of [[read.on, true], [read.off, false]] as const) {
    for (const l of letters) {
      const f = FLAG_LETTERS.get(l)!;
      if ('option' in f) py[f.option] = on;
    }
  }
  if (read.scoped) {
    st.py = py;
    return { scopedText: tokenSaid(st.lang, 'python-regex-inline-flags', { written: `${st.src.slice(start, st.i)}…)`, on: names(read.on), off: names(read.off), scoped: true }) };
  }
  if (!st.globalAt!.has(start)) return tok('error', ownSaid(st, `global flags not at the start of the expression at position ${start}`, PYTHON_SINCE.globalFlagsAtStart));
  st.py = py;
  return tok('keyword', tokenSaid(st.lang, 'python-regex-inline-flags', { written: st.src.slice(start, st.i), on: names(read.on), off: [], scoped: false }));
}

/**
 * A group of the PCRE paths the reader does not read, by flavor: how it starts after `(` (`at`), and what it is said to be. Python has no
 * `(*VERB)`: its `(*` is a group whose `*` has nothing to repeat.
 */
const UNREAD_GROUP: Partial<Record<Flavor, { at: RegExp; ja: string; en: string }>> = {
  pcre: { at: /^[?*]/, ja: 'この解説では読めない PCRE の構文', en: 'a PCRE construct this explainer does not read' },
  python: { at: /^\?/, ja: 'この解説では読めない Python の `re` の構文', en: "a construct of Python's `re` this explainer does not read" },
};


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
      const a = atomAt(st, i);
      i += a.length;
      // (Python stops at the first escape it refuses: the set is that error.)
      refused ??= a.error;
      if (rangeAt(i) && (a.code === undefined || atomAt(st, i + 1).code === undefined)) badRange = true;
      if (a.code !== undefined && src[i] === '-' && i + 1 < src.length && src[i + 1] !== ']') {
        const b = atomAt(st, i + 1);
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
  return {
    start, end: st.i, kind: 'pattern', children: holes,
    explanation: (negated
      ? s(`文字クラス: ${list} 以外の1文字`, `Character class: one character other than ${list}`)
      : s(`文字クラス: ${list} のどれか1文字`, `Character class: one of ${list}`))
      // (Letters written as themselves, not those of an escape: `[\d]` has none whose case matters.)
      + caseText(st, src.slice(start, st.i).replace(/\\[\s\S]/g, ''), st.py),
  };
}

/** A code as a range end is told: `0x41` and, when the character shows, `("A")`. */
function codeLabel(code: number): string {
  return code < 32 || (code >= 127 && code < 160) || code > 0x10ffff ? hexOf(code) : `${hexOf(code)} ("${String.fromCodePoint(code)}")`;
}

/**
 * What `[…]` of PCRE holds at `i`: one character (with its code, and the text when it was written plainly), or a set; or an escape
 * the flavor refuses there (`error`: Python's message).
 */
interface ClassAtom { length: number; text: string; code?: number; plain?: string; error?: string }

/** The flavors whose sets read POSIX classes (`[[:alpha:]]`); Python's do not (its `[[:alpha:]` is a set of the characters, then `]`). */
const POSIX_CLASSES: ReadonlySet<Flavor> = new Set(['bre', 'ere', 'pcre']);

/** What a set holds at `i` in each flavor of the PCRE paths. */
const CLASS_ATOMS: Partial<Record<Flavor, (st: State, i: number) => ClassAtom>> = { pcre: pcreClassAtom, python: pythonClassAtom };

/** Python's controls of one letter in a set: `\b` is a backspace there. */
const PYTHON_CONTROLS: Record<string, number> = { a: 7, b: 8, f: 12, n: 10, r: 13, t: 9, v: 11 };

/** What a set of Python's `re` holds at `i`: a character (by an escape too: `\x41`, octal `\101`), a class of one letter (`\d`), or a refused escape. */
function pythonClassAtom(st: State, i: number): ClassAtom {
  const { src, s } = st;
  const { bytes } = st.py!;
  if (src[i] === '\\' && i + 1 >= src.length) return { length: 1, text: '', error: `bad escape (end of pattern) at position ${i}` };
  if (src[i] !== '\\') return pcreClassAtom(st, i);
  const c = src[i + 1];
  const code = pythonCode(src, i, true, bytes);
  if (code?.error) return { length: code.length, text: '', error: code.error };
  if (code) return { length: code.length, text: code.name === undefined ? charOfCode(code.code!, s) : namedChar(code.name, s), ...(code.code === undefined ? {} : { code: code.code }) };
  if (/[A-Za-z0-9]/.test(c) && !pythonLetters(bytes).inClass.includes(c)) return { length: 2, text: '', error: `bad escape \\${c} at position ${i}` };
  const said = pythonShorthand(st.py!, c);
  if (c in PYTHON_CONTROLS) return { length: 2, code: PYTHON_CONTROLS[c], text: c === 'b' ? s('バックスペース', 'a backspace') : s(said!.ja, said!.en) };
  return said ? { length: 2, text: s(said.ja, said.en) } : { length: 2, code: c.codePointAt(0), text: s(`「${c}」`, `"${c}"`) };
}

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

/** `\c` that stands for the character `c`: an operator made literal (`\.`, in ERE `\+`), or a character with no escape of its own. */
function escapedLiteral(st: State, start: number, c: string): EmbeddedToken {
  const { s } = st;
  if (st.flavor !== 'bre' && '(){}|+?'.includes(c) || /[.[\]*^$\\/]/.test(c)) {
    return { start, end: st.i, kind: 'string', explanation: s(`文字「${c}」そのもの（\`\\\` で特別な意味を無効にしている）`, `A literal "${c}" (escaped)`), children: [] };
  }
  return { start, end: st.i, kind: 'string', explanation: s(`文字「${c}」`, `Literal "${c}"`) + caseText(st, c, st.py), children: [] };
}

/**
 * What the flavor reads after a backslash before the shared table does (`st.i` is past the backslash and `c`): PCRE's own escapes
 * (undefined for one the shared table reads), and every escape of Python's `re`.
 */
const FLAVOR_ESCAPES: Partial<Record<Flavor, (st: State, start: number, c: string) => EmbeddedToken | undefined>> = { pcre: pcreEscape, python: pythonEscape };

/**
 * The text of a pattern the program refuses: in the program's own words where the flavor says them (`OWN_REFUSAL`: Python's `re`,
 * its `message`), else the shell's entry of the kind of error (`shell`).
 */
function refusal(st: State, message: string, shell: () => string): string {
  return OWN_REFUSAL[st.flavor] ? ownSaid(st, message) : shell();
}

/**
 * The text of a pattern the flavor's program refuses in its own words (`OWN_REFUSAL`): its `message`, which ends with the position
 * where its parser refuses it, and the line and column of it where the pattern has a newline, as Python's `re.error` writes them (its
 * compiler's messages have no position); `since`, the release since which it is an error, where that changed in a release still
 * supported (docs/design/python-regex.md, section 8).
 */
function ownSaid(st: State, message: string, since?: string): string {
  const { src } = st;
  st.refused.add(message);
  const said = st.verboseRefused && !st.verboseRefused.has(message) ? UNLESS_VERBOSE : OWN_REFUSAL[st.flavor]!.said;
  const at = / at position (\d+)$/.exec(message);
  if (at && src.includes('\n')) {
    const pos = Number(at[1]);
    const before = src.slice(0, pos);
    message += ` (line ${before.split('\n').length}, column ${pos - before.lastIndexOf('\n')})`;
  }
  return tokenSaid(st.lang, said, { message, ...(since ? { since } : {}) });
}

/**
 * Why a strict flavor refuses the quantifier at `start` (`st.i` past it) after the tokens `out` (Python's message), if it does: a count
 * whose minimum is over its maximum, nothing to repeat (the start, `|`, an anchor or inline flags; a comment `(?#…)` is no item), or a
 * quantifier before it.
 */
function refusedRepeat(st: State, start: number, out: readonly EmbeddedToken[]): string | undefined {
  const count = /^\{(\d+),(\d+)\}/.exec(st.src.slice(start, st.i));
  if (count && Number(count[2]) < Number(count[1])) return `min repeat greater than max repeat at position ${start + 1}`;
  let k = out.length - 1;
  while (k >= 0 && out[k].kind === 'comment') k--;
  const before = out[k];
  if (!before || before.kind === 'keyword' || (before.kind === 'operator' && before.label === '|')) return `nothing to repeat at position ${start}`;
  return before.kind === 'operator' ? `multiple repeat at position ${start}` : undefined;
}

/** Python's escapes outside a set: a letter it has (else "bad escape"), a code, a group by its number, or a character made literal. */
function pythonEscape(st: State, start: number, c: string): EmbeddedToken {
  const { s, src } = st;
  const tok = (kind: EmbeddedToken['kind'], explanation: string, extra: Partial<EmbeddedToken> = {}): EmbeddedToken => ({ start, end: st.i, kind, explanation, children: [], ...extra });
  const refused = (message: string): EmbeddedToken => tok('error', ownSaid(st, message));
  const code = pythonCode(src, start, false, st.py!.bytes);
  if (code) st.i = start + code.length;
  if (code?.error) return refused(code.error);
  if (code) {
    return tok('pattern', `\`${src.slice(start, st.i)}\`: ${code.name === undefined ? charOfCode(code.code!, s) : namedChar(code.name, s)}`);
  }
  if (/[1-9]/.test(c)) {
    // (A group by its number, of one or two digits: one that is not there yet, or not closed, is refused, and in a lookbehind one
    // opened in it.)
    if (/\d/.test(src[st.i] ?? '')) st.i++;
    const group = Number(src.slice(start + 1, st.i));
    if (group > st.groups) return refused(`invalid group reference ${group} at position ${start + 1}`);
    if (st.open.has(group)) return refused(`cannot refer to an open group at position ${start}`);
    if (st.lookbehindFrom !== undefined && group > st.lookbehindFrom) return refused(`cannot refer to group defined in the same lookbehind subpattern at position ${st.i}`);
    return tok('variable', s(`後方参照 \`${src.slice(start, st.i)}\`: グループ ${group} に一致したのと同じ文字列`, `Backreference \`${src.slice(start, st.i)}\`: the same text group ${group} matched`), { group });
  }
  if (!/[A-Za-z0-9]/.test(c)) return escapedLiteral(st, start, c);
  if (!pythonLetters(st.py!.bytes).out.includes(c)) return refused(`bad escape \\${c} at position ${start}`);
  const sh = pythonShorthand(st.py!, c)!;
  return tok(/[bBAzZ]/.test(c) ? 'keyword' : 'pattern', `\`\\${c}\`: ${s(sh.ja, sh.en)}`);
}
