import type { Lang } from '../i18n';
import { tokenSaid } from '../messages-tokens';
import { IF_FLAG, type PythonRegexOptions, type Width } from './regex-python';
import type { EmbeddedToken } from './types';

// The state of the regex reader (src/embedded/regex.ts) as it reads a pattern, and what its modules share: the flavors, the
// programs, and how a refusal is said. Python's own reading is in src/embedded/regex-python-read.ts.

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

/** What a regex is matched against: one line (grep, sed), or a whole string that may hold newlines (bash, awk, Perl). */
/** (`record`: the text is awk's record, `$0`, which a rule's `/re/` matches.) */
export type MatchUnit = 'line' | 'text' | 'record';

/**
 * The program that reads a regex; `grep` stands for GNU grep, whose `-P` is the PCRE flavor; `bazel`, bazel's query, whose Java regex the
 * PCRE flavor reads; `python`, Python's `re` (the flavor `python`).
 */
export type RegexTool = 'grep' | 'sed' | 'awk' | 'bash' | 'bazel' | 'python';

/**
 * How a flavor says a pattern its program refuses, where it is in the program's own words: Python's `re` says its message
 * (`regex-python-error`); the others say the shell's entry of each kind of error.
 */
export const OWN_REFUSAL: Partial<Record<Flavor, { said: 'regex-python-error' }>> = { python: { said: 'regex-python-error' } };

/**
 * Whether the program also refuses a quantifier with nothing to repeat (`*.txt`, `^*`, `(?i)*`) or after another (`a**`), a count whose
 * minimum is over its maximum (`x{2,1}`), and a `)` that closes no group: Python's `re`, and GNU grep's `-P` (PCRE2), alike
 * (docs/design/python-regex.md, step 3). Perl and Java's regex (bazel) take some of them (`^*`; Perl `x{2,1}`), and are not read so.
 */
export const strictRepeats = (st: State): boolean => st.flavor === 'python' || (st.flavor === 'pcre' && st.tool === 'grep');

/**
 * Whether the quantifier at `i` is a `{,n}` of grep -P (a `{` the reader takes as a quantifier, with no minimum: `{,2}`), which PCRE2
 * 10.43 and later read as a repeat and earlier releases as text: neither it nor a quantifier right after it is refused or said as one
 * reading (`regex-pcre-max-brace`).
 */
export const releaseBrace = (st: State, i: number): boolean => st.flavor === 'pcre' && st.tool === 'grep' && st.src.startsWith('{,', i);

/**
 * Where `re.VERBOSE` is not known (a flags argument not read), a pattern is read without it, and each refusal is an Error only where the
 * reading with it refuses the same (docs/design/python-regex.md, 5.2): a refusal of that reading alone says it depends on the flags.
 */
const UNLESS_VERBOSE = 'regex-python-error-unless-verbose';

export interface State {
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
  /** Python's flags of the call's argument (`RegexOptions.python`), before any inline flag. */
  given?: PythonRegexOptions;
  /** Where Python's global flags (`(?i)`) may stand: at the start of the pattern, one after another (`pythonGlobalFlags`). */
  globalAt?: ReadonlySet<number>;
  /** Python's global flags read, each with the flags in effect after it (what `fix_flags` checks: `pythonFlagsRefused`). */
  globals: { token: EmbeddedToken; py: PythonRegexOptions }[];
  /**
   * Of Python's lookbehinds, which must match one width (`pythonWidth`): the width of each group closed, by its number and its token;
   * the groups opened before the outermost lookbehind the reader is in (a reference in it may not name one opened in it); and those
   * of more than one width, refused where Python compiles the pattern (`lookbehindWidths`).
   */
  widths: Map<number | EmbeddedToken, Width | undefined>;
  lookbehindFrom?: number;
  lookbehinds: { token: EmbeddedToken; width: Width }[];
  /**
   * The conditionals read (`(?(1)…)`, `(?(name)…)`), with the group each tests, by number (whether it is there is known only at the
   * end: a later group may be it) or by name, and where its number is written.
   */
  conditionals: { token: EmbeddedToken; group?: number; name?: string; at: number }[];
  /** A construct the reader leaves unread (`UNREAD_GROUP`), which may hold groups: their count is not known. */
  unread?: true;
  /** The messages of the refusals said so far, in the program's own words (`ownSaid`). */
  refused: Set<string>;
  /** Of those, the ones Python says only once its parser has read the whole pattern: a `)` that closes no group (`unbalanced parenthesis`). */
  late: Set<string>;
  /** Where Python's `re.VERBOSE` is not known: the messages of the refusals of the reading with it (`UNLESS_VERBOSE`). */
  verboseRefused?: ReadonlySet<string>;
}

/**
 * The text of a pattern the program refuses: in the program's own words where the flavor says them (`OWN_REFUSAL`: Python's `re`,
 * its `message`), else the shell's entry of the kind of error (`shell`).
 */
export function refusal(st: State, message: string, shell: () => string): string {
  return OWN_REFUSAL[st.flavor] ? ownSaid(st, message) : shell();
}

/**
 * The text of a pattern the flavor's program refuses in its own words (`OWN_REFUSAL`): its `message`, which ends with the position
 * where its parser refuses it, and the line and column of it where the pattern has a newline, as Python's `re.error` writes them (its
 * compiler's messages have no position); `since`, the release since which it is an error, where that changed in a release still
 * supported (docs/design/python-regex.md, section 8); `flags`, a `ValueError` of the flags (`regex-python-flags-error`), which has none.
 */
export function ownSaid(st: State, message: string, opts: { since?: string; flags?: true } = {}): string {
  const { src } = st;
  st.refused.add(message);
  const own = opts.flags ? 'regex-python-flags-error' : OWN_REFUSAL[st.flavor]!.said;
  const said = st.verboseRefused && !st.verboseRefused.has(message) ? UNLESS_VERBOSE : own;
  const at = / at position (\d+)$/.exec(message);
  if (at) {
    // (The reader's offsets count UTF-16 units, Python's positions characters: a character past U+FFFF is one.)
    const before = src.slice(0, Number(at[1]));
    const pos = characters(before);
    const nl = before.lastIndexOf('\n');
    message = message.slice(0, at.index) + ` at position ${pos}`;
    if (src.includes('\n')) message += ` (line ${before.split('\n').length}, column ${pos - (nl < 0 ? -1 : characters(before.slice(0, nl)))})`;
  }
  return tokenSaid(st.lang, said, { message, ...(opts.since ? { since: opts.since } : {}) });
}

/** The characters of a text, as Python counts them: a surrogate pair is one. */
const characters = (text: string): number => text.length - (text.match(/[\ud800-\udbff][\udc00-\udfff]/g)?.length ?? 0);

/** The end of the group that opens at `open` (an unclosed one ends with the text). */
export function groupEnd(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '\\') i++;
    else if (src[i] === '(') depth++;
    else if (src[i] === ')' && --depth === 0) return i + 1;
  }
  return src.length;
}

/** What `IGNORECASE` makes of a text with a letter that has a case, in Python's `re` (`py`): either case, or a word that the flags are not known. */
export function caseText(st: State, text: string, py: PythonRegexOptions | undefined): string {
  if (!py?.ignorecase || text.toLowerCase() === text.toUpperCase()) return '';
  return py.ignorecase === true ? st.s('（大文字小文字を区別しない）', ', in either case') : st.s(...IF_FLAG.ignorecase);
}

/** `\c` that stands for the character `c`: an operator made literal (`\.`, in ERE `\+`), or a character with no escape of its own. */
export function escapedLiteral(st: State, start: number, c: string): EmbeddedToken {
  const { s } = st;
  if (st.flavor !== 'bre' && '(){}|+?'.includes(c) || /[.[\]*^$\\/]/.test(c)) {
    return { start, end: st.i, kind: 'string', explanation: s(`文字「${c}」そのもの（\`\\\` で特別な意味を無効にしている）`, `A literal "${c}" (escaped)`), children: [] };
  }
  return { start, end: st.i, kind: 'string', explanation: s(`文字「${c}」`, `Literal "${c}"`) + caseText(st, c, st.py), children: [] };
}

/**
 * What `[…]` of PCRE holds at an offset: one character (with its code, and the text when it was written plainly), or a class of one
 * letter (`set`: `\d`, which Python refuses at an end of a range); or an escape the flavor refuses there (`error`: Python's message).
 */
export interface ClassAtom { length: number; text: string; code?: number; plain?: string; set?: true; error?: string }
