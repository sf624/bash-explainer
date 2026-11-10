import { tokenSaid } from '../messages-tokens';
import { charOfCode, namedChar } from './regex-escapes';
import { FLAG_LETTERS, groupNameRefused, PYTHON_SINCE, pythonCode, pythonFlags, pythonFlagsRefused, pythonLetters, pythonShorthand, pyRepr, Refusal, Tokens, widthSaid } from './regex-python';
import { type ClassAtom, escapedLiteral, groupEnd, ownSaid, type State } from './regex-state';
import { type EmbeddedToken, isHole } from './types';

// What the regex reader (src/embedded/regex.ts) reads of Python's `re` on its own (docs/design/python-regex.md, section 3): the heads
// of its groups, its inline flags, its escapes in and out of a set, its ranges and the warnings of a set, and its refusals as its
// `re._parser` makes them, each with Python's message: those of the parser where it reads, and once the whole pattern is read, the
// `ValueError` of the flags (`fix_flags`), a conditional's group that is not there, and a lookbehind of more than one width (its
// compiler's). test/regex-python-real.test.ts holds them against the reference Python.

/** The number of groups Python's `re` allows (`MAXGROUPS`): a conditional's number from it on is refused where it is read. */
const MAX_GROUPS = 1073741823;

/**
 * What a group of Python's `re` that opens at `start` is, as its parser reads what follows `(?` (`_parse`, with its tokenizer): a
 * token made already (a reference by name, `(?P=n)`; a comment; a refusal, the whole group; a hole of an f-string that decides it,
 * `stop`), a named group (`(?P<n>`) or a conditional (`(?(1)`, `(?(n)`) whose contents follow `end`; or undefined for what the
 * flavor's table reads (`(?:`, lookarounds, `(?>`, and the flags, read by `pythonFlagGroup`).
 */
export type PythonHead =
  | { kind: 'token'; token: EmbeddedToken }
  | { kind: 'stop' }
  | { kind: 'named'; name: string; end: number }
  | { kind: 'conditional'; group?: number; name?: string; at: number; end: number };

export function pythonGroupHead(st: State, start: number, reference: (group: number, name: string) => EmbeddedToken): PythonHead | undefined {
  const { src } = st;
  const t = new Tokens(src);
  const refuse = (message: string): PythonHead => {
    st.i = groupEnd(src, start);
    return { kind: 'token', token: { start, end: st.i, kind: 'error', explanation: ownSaid(st, message), children: [] } };
  };
  /** `getuntil` of the tokenizer: a name to `terminator` (`missing` names it in a message); 'stop' where a hole is in it. */
  const until = (terminator: string, missing: string): string | 'stop' => {
    let name = '';
    for (;;) {
      const c = t.get();
      if (c === undefined) throw name ? t.error(`missing ${terminator}, unterminated name`, name.length) : t.error(`missing ${missing}`);
      if ([...c].some(isHole)) return 'stop';
      if (c === terminator) {
        if (!name) throw t.error(`missing ${missing}`, 1);
        return name;
      }
      name += c;
    }
  };
  /** `checklookbehindgroup`: in a lookbehind, a group referred to must be closed, and opened before it. */
  const lookbehind = (group: number) => {
    if (st.lookbehindFrom === undefined) return;
    if (group > st.groups || st.open.has(group)) throw t.error('cannot refer to an open group');
    if (group > st.lookbehindFrom) throw t.error('cannot refer to group defined in the same lookbehind subpattern');
  };
  const bytes = st.py!.bytes;
  try {
    t.seek(start + 2);
    const char = t.get();
    if (char === undefined) throw t.error('unexpected end of pattern');
    if ([...char].some(isHole)) return { kind: 'stop' };
    if (char === 'P') {
      const kind = t.get();
      if (kind === '<') {
        const name = until('>', 'group name');
        if (name === 'stop') return { kind: 'stop' };
        const bad = groupNameRefused(name, bytes);
        if (bad) throw t.error(bad, name.length + 1);
        const was = st.names.get(name);
        if (was !== undefined) throw t.error(`redefinition of group name ${pyRepr(name, false)} as group ${st.groups + 1}; was group ${was}`, name.length + 1);
        return { kind: 'named', name, end: t.tell() };
      }
      if (kind === '=') {
        const name = until(')', 'group name');
        if (name === 'stop') return { kind: 'stop' };
        const bad = groupNameRefused(name, bytes);
        if (bad) throw t.error(bad, name.length + 1);
        const group = st.names.get(name);
        if (group === undefined) throw t.error(`unknown group name ${pyRepr(name, false)}`, name.length + 1);
        if (st.open.has(group)) throw t.error('cannot refer to an open group', name.length + 1);
        lookbehind(group);
        st.i = t.tell();
        return { kind: 'token', token: reference(group, name) };
      }
      if (kind === undefined) throw t.error('unexpected end of pattern');
      if ([...kind].some(isHole)) return { kind: 'stop' };
      throw t.error(`unknown extension ?P${kind}`, kind.length + 2);
    }
    if (char === '#') {
      for (;;) {
        if (t.next === undefined) throw t.error('missing ), unterminated comment', t.tell() - start);
        if (t.get() === ')') break;
      }
      st.i = t.tell();
      return { kind: 'token', token: { start, end: st.i, kind: 'comment', explanation: st.s('`(?#…)`: コメント（一致には関係しない）', '`(?#…)`: a comment (does not affect matching)'), children: [] } };
    }
    if (char === '<') {
      const next = t.get();
      if (next === undefined) throw t.error('unexpected end of pattern');
      if (next === '=' || next === '!') return undefined;
      if ([...next].some(isHole)) return { kind: 'stop' };
      throw t.error(`unknown extension ?<${next}`, next.length + 2);
    }
    if (char === '(') {
      const name = until(')', 'group name');
      if (name === 'stop') return { kind: 'stop' };
      let group: number;
      if (/^[0-9]+$/.test(name)) {
        group = Number(name);
        if (!group) throw t.error('bad group number', name.length + 1);
        if (group >= MAX_GROUPS) throw t.error(`invalid group reference ${name.replace(/^0+/, '')}`, name.length + 1);
      } else {
        const bad = groupNameRefused(name, bytes);
        if (bad) throw t.error(bad, name.length + 1);
        const known = st.names.get(name);
        if (known === undefined) throw t.error(`unknown group name ${pyRepr(name, false)}`, name.length + 1);
        group = known;
      }
      lookbehind(group);
      return { kind: 'conditional', group, ...(/^[0-9]/.test(name) ? {} : { name }), at: t.tell() - name.length - 1, end: t.tell() };
    }
    if (':=!>'.includes(char) || char === '-' || FLAG_LETTERS.has(char)) return undefined;
    throw t.error(`unknown extension ?${char}`, char.length + 1);
  } catch (e) {
    /* c8 ignore next */
    if (!(e instanceof Refusal)) throw e;
    return refuse(e.message);
  }
}

/**
 * A group of Python's inline flags that opens at `start` (`(?i)`, `(?i-m:`), read as `_parse_flags` of its `re._parser` reads it:
 * a token for global flags (they must start the pattern: `State.globalAt`), or for one it refuses, with its message; else, for flags of the
 * group only, its text (the flags are in effect in `st.py` from here; the group restores them).
 */
export function pythonFlagGroup(st: State, start: number): EmbeddedToken | { scopedText: string } {
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
  if (!st.globalAt!.has(start)) return tok('error', ownSaid(st, `global flags not at the start of the expression at position ${start}`, { since: PYTHON_SINCE.globalFlagsAtStart }));
  st.py = py;
  const token = tok('keyword', tokenSaid(st.lang, 'python-regex-inline-flags', { written: st.src.slice(start, st.i), on: names(read.on), off: [], scoped: false }));
  st.globals.push({ token, py });
  return token;
}

/** Python's controls of one letter in a set: `\b` is a backspace there. */
const PYTHON_CONTROLS: Record<string, number> = { a: 7, b: 8, f: 12, n: 10, r: 13, t: 9, v: 11 };

/**
 * What a set of Python's `re` holds at `i`: a character (by an escape too: `\x41`, octal `\101`), a class of one letter (`\d`, a
 * `set`), or a refused escape; `plain`, the set's reader for a character written as it is.
 */
export function pythonClassAtom(st: State, i: number, plain: (st: State, i: number) => ClassAtom): ClassAtom {
  const { src, s } = st;
  const { bytes } = st.py!;
  if (src[i] === '\\' && i + 1 >= src.length) return { length: 1, text: '', error: `bad escape (end of pattern) at position ${i}` };
  if (src[i] !== '\\') return plain(st, i);
  const c = src[i + 1];
  const code = pythonCode(src, i, true, bytes);
  if (code?.error) return { length: code.length, text: '', error: code.error };
  if (code) return { length: code.length, text: code.name === undefined ? charOfCode(code.code!, s) : namedChar(code.name, s), ...(code.code === undefined ? {} : { code: code.code }) };
  if (/[A-Za-z0-9]/.test(c) && !pythonLetters(bytes).inClass.includes(c)) return { length: 2, text: '', error: `bad escape \\${c} at position ${i}` };
  // (A character other than a letter or digit stands for itself: `[\<]` is "<".)
  if (!/[A-Za-z]/.test(c)) return { length: 2, code: c.codePointAt(0), text: s(`「${c}」`, `"${c}"`) };
  const said = pythonShorthand(st.py!, c)!;
  if (c in PYTHON_CONTROLS) return { length: 2, code: PYTHON_CONTROLS[c], text: c === 'b' ? s('バックスペース', 'a backspace') : s(said.ja, said.en) };
  return { length: 2, text: s(said.ja, said.en), set: true };
}

/**
 * Python's refusal of a range of a set from the item `a` at `from` to `b` after the `-` at `dash`, if it refuses it: a class at an end
 * (`[\d-z]`), or the end below the start (`[z-a]`). Its message names each end by the token its tokenizer read (`\x` of `\x41`), and
 * its position is where the range ends less those tokens. An end named `\N{…}` has no code here: nothing is refused.
 */
export function pythonRange(src: string, from: number, dash: number, a: ClassAtom, b: ClassAtom): string | undefined {
  if (!a.set && !b.set && (a.code === undefined || b.code === undefined || b.code >= a.code)) return undefined;
  const token = (at: number) => (src[at] === '\\' ? src.slice(at, at + 2) : String.fromCodePoint(src.codePointAt(at)!));
  const [one, two] = [token(from), token(dash + 1)];
  return `bad character range ${one}-${two} at position ${dash + 1 + b.length - (one.length + 1 + two.length)}`;
}

/**
 * The warnings (FutureWarning) Python's `re` gives for the set that opens at `start`, read as its parser reads a set: a `[` first
 * ("Possible nested set", as in `[[:alpha:]]`), and a doubled `-`, `&`, `~` or `|` after an item, which a later release may read as
 * an operation of sets. None past where it refuses the set (the reader says that refusal).
 */
export function pythonSetWarnings(src: string, start: number, bytes: boolean): string[] {
  const out: string[] = [];
  const t = new Tokens(src);
  const escape = (token: string) => {
    // (The rest of an escape that names a character: `\x41`.)
    const code = pythonCode(src, t.tell() - token.length, true, bytes);
    if (code && code.length > 2) t.seek(t.tell() - token.length + code.length);
  };
  try {
    t.seek(start + 1);
    if (t.next === '[') out.push(`Possible nested set at position ${t.tell()}`);
    if (t.next === '^') t.get();
    for (let items = 0; ; items++) {
      const one = t.get();
      if (one === undefined || (one === ']' && items)) break;
      if (one[0] === '\\') escape(one);
      else if (items && '-&~|'.includes(one) && t.next === one) {
        const op = { '-': 'difference', '&': 'intersection', '~': 'symmetric difference', '|': 'union' }[one as '-'];
        out.push(`Possible set ${op} at position ${t.tell() - 1}`);
      }
      if (t.next !== '-') continue;
      t.get();
      const two = t.get();
      if (two === undefined || two === ']') break;
      if (two[0] === '\\') escape(two);
      else if (two === '-') out.push(`Possible set difference at position ${t.tell() - 2}`);
    }
  } catch (e) {
    /* c8 ignore next */
    if (!(e instanceof Refusal)) throw e;
  }
  return out;
}

/**
 * Python's escapes outside a set: a letter it has (else "bad escape"), a code, a group by its number, or a character made literal;
 * `reference`, the reader's token of a backreference.
 */
export function pythonEscape(st: State, start: number, c: string, reference: (group: number) => EmbeddedToken): EmbeddedToken {
  const { s, src } = st;
  const tok = (kind: EmbeddedToken['kind'], explanation: string): EmbeddedToken => ({ start, end: st.i, kind, explanation, children: [] });
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
    return reference(group);
  }
  if (!/[A-Za-z0-9]/.test(c)) return escapedLiteral(st, start, c);
  if (!pythonLetters(st.py!.bytes).out.includes(c)) return refused(`bad escape \\${c} at position ${start}`);
  const sh = pythonShorthand(st.py!, c)!;
  const since = c === 'z' ? s('（', ' (') + tokenSaid(st.lang, 'python-regex-since', { since: PYTHON_SINCE.endZ }) + s('）', ')') : '';
  return tok(/[bBAzZ]/.test(c) ? 'keyword' : 'pattern', `\`\\${c}\`: ${s(sh.ja, sh.en)}${since}`);
}

/**
 * Why a program that reads repeats strictly (`strictRepeats`: Python, grep -P) refuses the quantifier at `start` (`st.i` past it) after
 * the tokens `out`, if it does, with Python's message: a count whose minimum is over its maximum, nothing to repeat (the start, `|`, an
 * anchor or inline flags; a comment `(?#…)` is no item), or a quantifier before it.
 */
export function refusedRepeat(st: State, start: number, out: readonly EmbeddedToken[]): { kind: 'count' | 'nothing' | 'multiple'; message: string } | undefined {
  const count = /^\{(\d+),(\d+)\}/.exec(st.src.slice(start, st.i));
  if (count && Number(count[2]) < Number(count[1])) return { kind: 'count', message: `min repeat greater than max repeat at position ${start + 1}` };
  let k = out.length - 1;
  while (k >= 0 && out[k].kind === 'comment') k--;
  const before = out[k];
  if (!before || before.kind === 'keyword' || (before.kind === 'operator' && before.label === '|')) return { kind: 'nothing', message: `nothing to repeat at position ${start}` };
  return before.kind === 'operator' ? { kind: 'multiple', message: `multiple repeat at position ${start}` } : undefined;
}

/**
 * What Python refuses once its parser has read the whole pattern, each where no refusal came before it, in its order: flags that do not
 * go together (`fix_flags`: a `ValueError`; at the global flags that make it, as the call's argument says its own), a `)` that closes
 * no group (said where it is read), a conditional's group by number that is not there, and a lookbehind whose contents may match more
 * characters or fewer (`a|bc`, `a+`), which its compiler refuses (the contents are still read).
 */
export function pythonFinish(st: State): void {
  const only = (allowed: ReadonlySet<string>) => [...st.refused].every((m) => allowed.has(m));
  if (!pythonFlagsRefused(st.given!) && only(st.late)) {
    const conflict = st.globals.find((g) => pythonFlagsRefused(g.py));
    if (conflict) error(conflict.token, st.s('。', '. ') + ownSaid(st, pythonFlagsRefused(conflict.py)!.message, { flags: true }));
  }
  if (only(new Set())) {
    for (const c of st.conditionals) if (c.group! > st.groups) error(c.token, st.s('。', '. ') + ownSaid(st, `invalid group reference ${c.group} at position ${c.at}`));
  }
  if (st.refused.size) return;
  for (const { token, width } of st.lookbehinds) {
    const [ja, en] = widthSaid(width);
    error(token, st.s(`。中身は${ja}に一致しうる。`, `. Its contents may match ${en}. `) + ownSaid(st, 'look-behind requires fixed-width pattern'));
  }
}

/** Makes a token the error `text` says, after its own text. */
function error(token: EmbeddedToken, text: string): void {
  token.kind = 'error';
  token.explanation += text;
}
