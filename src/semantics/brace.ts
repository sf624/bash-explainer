// Brace expansion in the word model (src/semantics/words.ts reads it): which words of a word have one, the words it
// gives, and whether the step applies in the shell the model is of (the manual's 3.5.1; the shells, src/dialect.ts).
// The parser makes a brace expression of every brace expansion bash makes (src/syntax/adapters/braces.ts).
import { bracesWork, type Shell } from '../shellfeatures';
import { braceSequence } from '../examples/shellwords';
import { staticWordValue } from '../staticword';
import { braceKind, type SyntaxNode } from '../syntax/tree';
import type { Tri } from './state';
import type { Applies, ExpansionStep, WordMeaning } from './words';

/** The plain words of a word that are brace expressions (`{a,b}`, `{1..3}`). */
export function bracedWords(plain: readonly SyntaxNode[]): SyntaxNode[] {
  return plain.filter((n) => n.type === 'brace_expression');
}

/** A word of a brace expansion: its parts, the text of plain words and the nodes of the others (a quote, an expansion). */
export type BraceAlternative = (SyntaxNode | string)[];

/** How many words a brace expansion may give before we stop listing them. */
const MAX_WORDS = 500;

/** Marks for the characters of a letter sequence that bash reads again in the word they end up in (`reread`). */
const BACKSLASH = '\uE000';
const BACKQUOTE = '\uE001';
const MARKS: Readonly<Record<string, string>> = { '\\': BACKSLASH, '`': BACKQUOTE };
const MARKED = /[\uE000\uE001]/;
const unmarked = (t: string): string => t.replace(/\uE000/g, '\\').replace(/\uE001/g, '`');

/**
 * A text of a word of a brace expansion as bash reads it again: the `\` and `` ` `` of a letter sequence (`{Z..a}`) are
 * unquoted characters of the word, which bash reads after the braces are gone (bash 5.2 and 5.3). A `\` quotes the
 * character after it, and is an empty string at the end of the word (`x{Z..a}` gives `x`, and `{Z..a}` an empty word);
 * a `` ` `` at the end of the word is itself, and else starts a command substitution that nothing closes (bash fails,
 * "bad substitution"). `last`: the text ends the word. Its text as written (backslashes and all), and whether an empty
 * quoted string ends it; undefined where that is not known here (before another part, or where bash fails).
 */
export function reread(text: string, last: boolean): { text: string; empty: boolean } | undefined {
  if (!MARKED.test(text)) return { text, empty: false };
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === BACKSLASH && i + 1 < text.length) out += `\\${unmarked(text[++i])}`;
    else if (c !== BACKSLASH && c !== BACKQUOTE) out += c;
    else if (!last || i + 1 < text.length) return undefined;
    else return { text: c === BACKQUOTE ? `${out}\\\`` : out, empty: c === BACKSLASH };
  }
  return { text: out, empty: false };
}

/** Whether bash fails on a word of a brace expansion: a `` ` `` of a letter sequence that text follows (`reread`). */
export function rereadFails(w: BraceAlternative): boolean {
  return w.some((p, i) => typeof p === 'string' && [...p].some((c, k) => c === BACKQUOTE && (k + 1 < p.length || i + 1 < w.length)));
}

/**
 * The words the word of `nodes` gives by brace expansion, in bash's order (each word of a list, then the words after
 * it: `{a,b}{1,2}` is `a1 a2 b1 b2`); undefined when it has no brace expression, null when it gives too many to list.
 * (The words left empty are dropped, as bash drops empty unquoted words: `{,}`; a quoted empty one stays: `{"",a}`.
 * With `part`, the nodes are a part of a longer word, whose other parts the empty words join: they stay.)
 */
export function braceAlternatives(nodes: readonly SyntaxNode[], part = false): BraceAlternative[] | null | undefined {
  const parts = nodes.flatMap((n) => (n.type === 'concatenation' ? n.namedChildren : [n]));
  if (!parts.some((n) => n.type === 'brace_expression')) return undefined;
  const words = product(parts.map(alternativesOf));
  return words && (part ? words : words.filter((w) => w.some((p) => typeof p !== 'string' || p !== '')));
}

/**
 * The word `w`, or after brace expansion each word it gives; undefined when they are not known here. `applies`: whether
 * brace expansion applies, when the caller reads one reading of a step not known (`mayGiveNoField`).
 */
export function wordAlternatives(w: WordMeaning, applies = w.steps[0].applies): BraceAlternative[] | undefined {
  if (applies === false) return [[...w.nodes]];
  // (A word whose brace step applies has a brace expression; null: too many words to list.)
  const words = applies === 'unknown' ? undefined : braceAlternatives(w.nodes) ?? undefined;
  return words?.some(rejoined) ? undefined : words;
}

/**
 * Whether bash reads a word of a brace expansion otherwise than its parts say, since the braces are gone: a `$x` that
 * the text after it lengthens (`{,$x}a` gives `$xa`), or a `$` the text after it makes an expansion (`{a$,b}x`).
 */
export function rejoined(w: readonly (SyntaxNode | string)[]): boolean {
  return w.some((p, i) => (typeof p === 'string'
    ? /(?:^|[^\\])(?:\\\\)*\$[\w{('"@*#?$!-]/.test(p)
    : p.type === 'simple_expansion' && p.namedChildren[0].type === 'variable_name' && typeof w[i + 1] === 'string' && /^\w/.test(w[i + 1] as string)));
}

/**
 * The values of the words a brace expansion gives, when they are known without running anything, quotes removed
 * (`{a,"b c"}` is `a` and `b c`); undefined when one is not known (`{a,$x}`), null when they are too many to list.
 * `part`: as for `braceAlternatives`.
 */
export function braceValues(nodes: readonly SyntaxNode[], part = false): string[] | null | undefined {
  const words = braceAlternatives(nodes, part);
  if (!words || words.some(rejoined)) return words && undefined;
  // (The text as bash reads it again: `reread`.)
  const values = words.map((w) => w.map((p, i) => (typeof p === 'string' ? reread(p, i === w.length - 1)?.text.replace(/\\(.|$)/gs, '$1') : staticWordValue(p))));
  return values.some((v) => v.includes(undefined)) ? undefined : values.map((v) => v.join(''));
}

/** The words a brace expansion gives, as text: undefined and null as `braceAlternatives` says (`part` too). */
export function braceTexts(nodes: readonly SyntaxNode[], part = false): string[] | null | undefined {
  const words = braceAlternatives(nodes, part);
  // (The backslashes of plain text are removed later, by quote removal.)
  return words && words.map((w) => w.map((p) => (typeof p === 'string' ? unmarked(p) : p.text)).join('').replace(/\\(.|$)/gs, '$1'));
}

/** The words a part of a word gives: a brace expression its items or its sequence, any other part itself. */
function alternativesOf(n: SyntaxNode): BraceAlternative[] | null {
  if (n.type === 'concatenation') return product(n.namedChildren.map(alternativesOf));
  if (n.type === 'word' || n.type === 'number') return [[n.text]];
  if (n.type !== 'brace_expression') return [[n]];
  // (The parser makes a sequence only of a valid one.)
  // (A `\` or `` ` `` of a letter sequence is marked: bash reads it again, `reread`.)
  if (braceKind(n) === 'sequence') return braceSequence(n.text)?.map((w) => [MARKS[w] ?? w]) ?? null;
  const out: BraceAlternative[] = [];
  let item: SyntaxNode | undefined;
  for (const c of n.children.slice(1)) {
    if (c.named) item = c;
    else {
      const words = item ? alternativesOf(item) : [['']];
      if (!words) return null;
      out.push(...words);
      item = undefined;
    }
  }
  return out.length > MAX_WORDS ? null : out;
}

/** Every word made of one word of each list, in order, with the texts side by side joined. */
function product(lists: (BraceAlternative[] | null)[]): BraceAlternative[] | null {
  let out: BraceAlternative[] = [[]];
  for (const list of lists) {
    if (!list || out.length * list.length > MAX_WORDS) return null;
    out = out.flatMap((a) => list.map((b) => {
      const w = [...a, ...b];
      // (Two texts side by side are one: `a` and `1` of `a{1,2}`.)
      const i = a.length;
      return i > 0 && typeof w[i - 1] === 'string' && typeof w[i] === 'string' ? [...w.slice(0, i - 1), (w[i - 1] as string) + (w[i] as string), ...w.slice(i + 1)] : w;
    }));
  }
  return out;
}

/**
 * The brace step of a word whose plain words `braced` are brace expressions, in a context that has it or not
 * (`context`), with `set -o braceexpand` as `braceOpt` says. The shell must have each kind of brace expansion of
 * the word: none of them in dash and POSIX sh, no ranges in mksh (`dialect`); a shell that has some of them: not known.
 */
export function braceStep(braced: readonly SyntaxNode[], context: boolean, braceOpt: Tri, shell: Shell | undefined, plain: SyntaxNode[]): Omit<ExpansionStep, 'manual'> {
  const works = braced.filter((b) => bracesWork(b, shell)).length;
  const dialect: Applies = works === braced.length ? true : works === 0 ? false : 'unknown';
  const brace = context && braced.length > 0;
  const applies: Applies = !brace || dialect === false ? false : braceOpt === 'unknown' || dialect === 'unknown' ? 'unknown' : braceOpt === 'on';
  const why = brace && dialect === false ? 'dialect' : brace && braceOpt !== 'on' ? 'braceexpand-off' : !context ? 'context' : undefined;
  return { kind: 'brace', applies, ...(why ? { why } : {}), parts: brace ? plain : [] };
}
