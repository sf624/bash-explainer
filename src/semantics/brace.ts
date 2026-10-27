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

/**
 * The words the word of `nodes` gives by brace expansion, in bash's order (each word of a list, then the words after
 * it: `{a,b}{1,2}` is `a1 a2 b1 b2`); undefined when it has no brace expression, null when it gives too many to list.
 * (The words left empty are dropped, as bash drops empty unquoted words: `{,}`; a quoted empty one stays: `{"",a}`.)
 */
export function braceAlternatives(nodes: readonly SyntaxNode[]): BraceAlternative[] | null | undefined {
  const parts = nodes.flatMap((n) => (n.type === 'concatenation' ? n.namedChildren : [n]));
  if (!parts.some((n) => n.type === 'brace_expression')) return undefined;
  const words = product(parts.map(alternativesOf));
  return words && words.filter((w) => w.some((p) => typeof p !== 'string' || p !== ''));
}

/** The word `w`, or after brace expansion each word it gives; undefined when they are not known here. */
export function wordAlternatives(w: WordMeaning): BraceAlternative[] | undefined {
  const brace = w.steps[0];
  if (brace.applies === false) return [[...w.nodes]];
  // (A word whose brace step applies has a brace expression; null: too many words to list.)
  const words = brace.applies === 'unknown' ? undefined : braceAlternatives(w.nodes) ?? undefined;
  return words?.some(rejoined) ? undefined : words;
}

/**
 * Whether bash reads a word of a brace expansion otherwise than its parts say, since the braces are gone: a `$x` that
 * the text after it lengthens (`{,$x}a` gives `$xa`), or a `$` the text after it makes an expansion (`{a$,b}x`).
 */
export function rejoined(w: BraceAlternative): boolean {
  return w.some((p, i) => (typeof p === 'string'
    ? /(?:^|[^\\])(?:\\\\)*\$[\w{('"@*#?$!-]/.test(p)
    : p.type === 'simple_expansion' && p.namedChildren[0].type === 'variable_name' && typeof w[i + 1] === 'string' && /^\w/.test(w[i + 1] as string)));
}

/**
 * The values of the words a brace expansion gives, when they are known without running anything, quotes removed
 * (`{a,"b c"}` is `a` and `b c`); undefined when one is not known (`{a,$x}`), null when they are too many to list.
 */
export function braceValues(nodes: readonly SyntaxNode[]): string[] | null | undefined {
  const words = braceAlternatives(nodes);
  if (!words || words.some(rejoined)) return words && undefined;
  const values = words.map((w) => w.map((p) => (typeof p === 'string' ? p.replace(/\\(.|$)/gs, '$1') : staticWordValue(p))));
  return values.some((v) => v.includes(undefined)) ? undefined : values.map((v) => v.join(''));
}

/** The words a brace expansion gives, as text: undefined and null as `braceAlternatives` says. */
export function braceTexts(nodes: readonly SyntaxNode[]): string[] | null | undefined {
  const words = braceAlternatives(nodes);
  // (The backslashes of plain text are removed later, by quote removal.)
  return words && words.map((w) => w.map((p) => (typeof p === 'string' ? p : p.text)).join('').replace(/\\(.|$)/gs, '$1'));
}

/** The words a part of a word gives: a brace expression its items or its sequence, any other part itself. */
function alternativesOf(n: SyntaxNode): BraceAlternative[] | null {
  if (n.type === 'concatenation') return product(n.namedChildren.map(alternativesOf));
  if (n.type === 'word' || n.type === 'number') return [[n.text]];
  if (n.type !== 'brace_expression') return [[n]];
  // (The parser makes a sequence only of a valid one.)
  if (braceKind(n) === 'sequence') return braceSequence(n.text)?.map((w) => [w]) ?? null;
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
