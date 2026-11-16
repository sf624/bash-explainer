// The words of a command as the argument interpreter (src/argv/interpret.ts) takes them: their value after
// quote removal when it is known, the start that is known otherwise, and how many words they become.
import { parseExpansion, type ParsedExpansion } from '../expansion';
import type { Shell } from '../shellfeatures';
import { guardedApart } from '../examples/regexguard';
import { globToRegex } from '../examples/shellwords';
import { rejoined } from '../semantics/brace';
import { type Char, patternOfChars } from '../semantics/chars';
import { givesElements } from '../semantics/elements';
import { textAsWritten, type WordView, wordViewAsWritten } from '../semantics/wordview';
import { staticWordValue } from '../staticword';
import { descendants, nameText, type SyntaxNode } from '../syntax/tree';
import type { ArgWord } from './interpret';

/** The text known at the start of a word whose value is not known (`--file=` of `--file=$f`, `-I` of `-I{}`), in a script for `shell`. */
export function prefixOf(n: SyntaxNode, shell?: Shell): string {
  if (n.type === 'word' || n.type === 'number') return /^(?:\\.|[^\\*?[{~])*/s.exec(n.text)![0].replace(/\\(.)/gs, '$1');
  let out = '';
  if (n.type === 'concatenation') {
    for (const c of n.namedChildren) {
      const v = staticWordValue(c, false, shell);
      if (v === undefined) return out + prefixOf(c, shell);
      out += v;
    }
  }
  if (n.type === 'string') {
    for (const c of n.namedChildren) {
      if (c.type !== 'string_content') return out;
      out += c.text;
    }
  }
  return out;
}

const QUOTES = /["']/;

/** Where the known start of a word (`prefixOf`) has come to after `i` of its characters, in the word's text, and the quote still open there. */
function afterPrefix(text: string, i: number): { at: number; quote: string } {
  let at = 0;
  let quote = '';
  for (let n = 0; n < i; at++) {
    if (quote ? text[at] === quote : QUOTES.test(text[at])) quote = quote ? '' : text[at];
    else {
      if (text[at] === '\\' && !quote) at++;
      n++;
    }
  }
  return text[at] === quote ? { at: at + 1, quote: '' } : { at, quote };
}

/** Where character `i` of the known start of a word lies in its text (`"-j$x"`: `j` is at 2). */
export function prefixCharAt(text: string, i: number): number {
  let { at, quote } = afterPrefix(text, i);
  while (QUOTES.test(text[at])) {
    quote = quote ? '' : text[at];
    at++;
  }
  return !quote && text[at] === '\\' ? at + 1 : at;
}

/**
 * The value attached to an option in a word whose value is not known, as written: from character `i` of the known start to the end
 * of the word, with the opening quote of a string it starts with (`-j"$x"`), and without the closing quote of one it starts in
 * (`"-j$x"`, `-"j$x"y`). `from` and `to` are places in the word's text.
 */
export function attachedWritten(a: SyntaxNode, i: number): { from: number; to: number; text: string; nodes: SyntaxNode[] } {
  const { at: from, quote } = afterPrefix(a.text, i);
  const start = a.startIndex + from;
  const pieces = a.type === 'concatenation' ? a.namedChildren : [a];
  // (The parts bash expands: a part of its own after the known start, or those inside the string the start ends in.)
  const nodes = pieces.flatMap((c) => (c.startIndex >= start ? [c] : c.endIndex > start && c.type === 'string' ? c.namedChildren.filter((x) => x.startIndex >= start && x.type !== 'string_content') : []));
  if (!quote) return { from, to: a.text.length, text: a.text.slice(from), nodes };
  const close = pieces.find((c) => c.endIndex > start)!.endIndex - a.startIndex - 1;
  const text = a.text.slice(from, close) + a.text.slice(close + 1);
  return { from, to: close + 1 === a.text.length ? close : a.text.length, text, nodes };
}

const UNQUOTED_EXPANSION = new Set(['simple_expansion', 'expansion', 'command_substitution', 'arithmetic_expansion']);

/**
 * Whether one word of a brace expansion holds what may make other than one word of it: an unquoted expansion, `"$@"`
 * or `"${a[@]}"` (only in double quotes: `'"$@"'` is text; src/semantics/elements.ts), or a `$` that the braces leave
 * before text bash then reads otherwise (`rejoined`: `{,$x}a` is `$xa`).
 */
export const splitsIn = (w: readonly (SyntaxNode | string)[]): boolean => rejoined(w) || w.some(splits);
// (The words of braces come with their parts in a row, `braceAlternatives`: no part holds another.)
const splits = (p: SyntaxNode | string): boolean => typeof p !== 'string' && (UNQUOTED_EXPANSION.has(p.type) || (p.type === 'string' && givesElements(p)));

/** The parameter of a word that is one unquoted expansion of it and nothing else (`ArgWord.param`: `$a`, `${a}`, `$@`). */
function loneParameter(n: SyntaxNode): string | undefined {
  if (n.type === 'simple_expansion') return nameText(n).slice(1);
  const p = n.type === 'expansion' ? parseExpansion(n.text) : undefined;
  return p?.parts.length === 1 ? p.name : undefined;
}

/** What may assign when it is expanded: a text with none of these holds no assignment, arithmetic, substitution or indirection. */
const MAY_ASSIGN = /[=[:!@`(]|\$\{[\s|]/;

/**
 * Whether expanding `${…}` may assign any name: arithmetic (a subscript but `[@]`, `[*]`; an offset, a length), which
 * may assign through a value it reads as arithmetic (`x='a=1'; $((x))`); an indirection, whose name may hold a subscript
 * or a `${a:=x}` of its own (`x='b[a=5]'; ${!x}`), but not the names `${!x*}`, `${!x@}` nor the keys `${!a[@]}`; and
 * `@P`, which expands its value as a prompt.
 */
function evaluates(p: ParsedExpansion): boolean {
  const subscript = p.parts.find((q) => q.role === 'subscript');
  if (subscript && !/^\[[@*]\]$/.test(subscript.text)) return true;
  if (p.parts.some((q) => q.role === 'offset' || q.role === 'length' || (q.role === 'transform' && q.text === 'P'))) return true;
  return p.prefix === '!' && !(p.parts.length === 3 && (subscript || p.op === '*' || p.op === '@'));
}

/**
 * What expanding a word may assign (`ArgWord.assigns`): the names of `${a:=x}` and `${a=x}`; `?` for `$( )` and
 * backquotes, which set the status; `!` for `<( )` and `>( )`, which start a process in the background; and `*` (any) for
 * arithmetic, an indirection or `@P` (`evaluates`), a `${…}` that is not understood (`${!r:=x}`), and `${ cmd; }`, which
 * runs in the shell.
 */
function assignsOf(n: SyntaxNode): string[] | undefined {
  if (!MAY_ASSIGN.test(n.text)) return undefined;
  const names = new Set<string>();
  for (const x of descendants(n, ['expansion', 'arithmetic_expansion', 'command_substitution', 'process_substitution'])) {
    if (x.type === 'process_substitution') names.add('!');
    else if (x.type === 'command_substitution') {
      if (x.text.startsWith('${')) return ['*'];
      names.add('?');
    } else {
      // (`$(( ))` is no expansion of a name: `p` is undefined, any name.)
      const p = x.type === 'expansion' ? parseExpansion(x.text) : undefined;
      if (!p || evaluates(p)) return ['*'];
      if (p.op === '=' || p.op === ':=') names.add(p.name);
    }
  }
  return names.size ? [...names] : undefined;
}

/** What a pattern's run on `-` and `--` may cost: its length, about (a pattern of the longest read is about 3e5). */
const WORD_LIMIT = 1e6;

/**
 * Whether the characters `chars` of one word of a brace expansion, a pattern, may match `-` or `--`, which a command
 * reads otherwise than an option (`-*` with the file `--`). A hole is read as empty: after a start of `-` or `--`, a
 * pattern matches one of them with the hole as any text only where it does with the hole empty.
 */
function mayGiveDashes(chars: readonly Char[]): boolean {
  const pattern = patternOfChars(chars);
  // (No more than a pattern's length costs here: its limit is its own, as it is kept with the model's words.)
  return guardedApart(WORD_LIMIT, () => {
    const re = globToRegex(pattern, 'file');
    return !re || re.test('-') || re.test('--');
    // (Refused only as too long to read: such a word gives no `-`.)
  }, () => false);
}

/**
 * The words a word's words come in (`ArgWord.parts`; one of them: `ArgWord.prefixEach`), where it has a known start
 * (`prefix`): for each word of its brace expansion (`WordView.words`, where they are known), the words of its first
 * field, which keep that word's own start (one; where it is a pattern, `fewest` or more), then, where it may split, the
 * words splitting adds after them (none or more, of unknown text); a word with no start of its own that may split, any
 * words. `dashes` where a word that is a pattern has a start of `-` or `--` and may match `-` or `--` (`-*`, not `-?x`
 * nor `-[av]*`). Undefined otherwise, and for one word whose first field is one word (`bin/$n`), which needs no parts:
 * its first word keeps the start, the others do not.
 */
function startParts(v: WordView, prefix: string, fewest: number): ArgWord[] | 'dashes' | undefined {
  if (!prefix || !v.words.length) return undefined;
  const words = v.words.map((x) => {
    // (A word whose characters are not known, of braces not read, `--file={,$x}a`: its own start, then any words.)
    const chars = x.chars ?? [];
    const splits = !x.chars || chars.some((c) => c.split || c.hole?.kind === 'elements');
    // (A pattern of its own characters, or, where it does not split, of a part not known: `IFS=; cp a$y d`.)
    return { chars, start: x.lead ?? '', glob: chars.some((c) => c.pattern) || (!splits && x.globs !== false), splits };
  });
  if (words.some((x) => (x.start === '-' || x.start === '--') && x.glob && mayGiveDashes(x.chars))) return 'dashes';
  // (No parts for one word whose first field is one word: `bin/$n`.)
  if (words.length === 1 && !words[0].glob) return undefined;
  return words.flatMap((x): ArgWord[] => {
    if (!x.start && x.splits) return [{ count: { min: 0 } }];
    const head: ArgWord = { prefix: x.start, ...(x.glob ? { prefixEach: true as const, count: { min: fewest } } : {}) };
    return x.splits ? [head, { count: { min: 0 } }] : [head];
  });
}

/**
 * The text every word a word gives starts with (`ArgWord.prefix`): of one field, its start (`WordView.start`, with the
 * values the model knows: `"$x"` with `x=-v`); else the word's own text before its first part not known, which its brace
 * words share (`WordView.lead`: `--file=$f`, `-v$x` under nullglob, `project/{src,test}` is `project/`, `{a,$x}` none),
 * not the start of a first field that a value gives (`opts='-n -e x*'; grep $opts f`: the other fields are not known).
 */
const startOf = (v: WordView): string => (v.count.min === 1 && v.count.max === 1 ? v.start : undefined) ?? v.lead ?? '';

/**
 * How many words the interpreter takes a word to give: its count (`viewCount`), but one at least, no more, where a known
 * value splits it into more fields than it has words of braces, not all known (`opts='-n -e err.*'; grep $opts log`): their texts are not passed on,
 * and words of no known text would be read as operands, though `-n` and `-e` are options. Reading each such field as a
 * word of its own is step 5b (docs/design/word-source.md, 3.4).
 */
function readCount(v: WordView): ArgWord['count'] {
  const count = viewCount(v);
  // (More fields than words of braces, of a known value split: `{a,$x}` with `x='*'` is two words, of known texts.)
  const splitValue = v.words.some((x) => !x.fields && x.chars?.some((c) => c.split && !c.hole));
  return count && splitValue && count.min > Math.max(v.words.length, 1) ? { min: 1 } : count;
}

/** How many words a word gives (`ArgWord.count`), from its view: none where that is one. */
export const viewCount = (v: WordView): ArgWord['count'] => (v.count.min === 1 && v.count.max === 1 ? undefined : { ...v.count });

/**
 * The words of the command line as the interpreter reads them, each from its view (`view`: the finished model's, the
 * walk's, or as written, `argWordAsWritten`): its value where it is plain, else the start of its first field, how many
 * words it gives, and which of them keep a start (`startParts`). A word that is text as written (`textAsWritten`) is read
 * at once; one outside a word of the model (the tree's option of a keyword, `time -p`) is its text.
 */
export const argWordFor = (view: (n: SyntaxNode) => WordView | undefined) => (n: SyntaxNode): ArgWord => {
  const text = textAsWritten(n);
  if (text !== undefined) return { value: text };
  const v = view(n);
  if (!v) return { value: n.text };
  const value = v.value;
  const words = readCount(v);
  const param = loneParameter(n);
  const assigns = assignsOf(n);
  const prefix = value === undefined ? startOf(v) : undefined;
  // (Which of its words keep its known start: all of one part, `-v*`; or some of several, `-v*$x`.)
  // (A glob gives none only where the glob options say so, `nullglob`: the view's count.)
  const parts = words && prefix !== undefined ? startParts(v, prefix, Math.min(words.min, 1)) : undefined;
  // (One part: each of its words keeps the start, the words of a glob; or, of no start of its own, none of them: no parts.)
  const kept = parts === 'dashes' ? { dashes: true as const } : parts?.length === 1 ? (parts[0].prefixEach ? { prefixEach: true as const } : {}) : parts ? { parts } : {};
  return { ...(value !== undefined ? { value } : { prefix }), ...kept, ...(words ? { count: words } : {}), ...(param ? { param } : {}), ...(assigns ? { assigns } : {}) };
};

/** The words of the command line as the interpreter reads them before or without a model, in a script for `shell` (bash when absent): from the view as written. */
export const argWordAsWritten = (shell?: Shell): ((n: SyntaxNode) => ArgWord) => argWordFor((n) => wordViewAsWritten(n, shell));

/** A word of the command line as the interpreter reads it in bash. */
export const argWord = argWordAsWritten();
