// The words of a command as the argument interpreter (src/argv/interpret.ts) takes them: their value after
// quote removal when it is known, the start that is known otherwise, and how many words they become.
import { parseExpansion, type ParsedExpansion } from '../expansion';
import { bracesWork, type Shell } from '../shellfeatures';
import { globToRegex } from '../examples/shellwords';
import { braceAlternatives, rejoined } from '../semantics/brace';
import { givesElements } from '../semantics/elements';
import { staticWordValue } from '../staticword';
import { descendants, type SyntaxNode } from '../syntax/tree';
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

const UNQUOTED_EXPANSION = new Set(['simple_expansion', 'expansion', 'command_substitution', 'arithmetic_expansion']);
/** The parts of plain text, where a glob character is one. */
const PLAIN = new Set(['word', 'number']);
/** A glob character in plain text (`*.txt`; not `\*`, and not in quotes: `'*'` is a part of its own). */
const GLOB = /(^|[^\\])[*?[]/;

type Count = { min: number; max?: number };

/** What the parts of one word of a brace expansion are (the whole word, where its braces do not expand). */
function partsOf(w: readonly (SyntaxNode | string)[]): { split: boolean; text: boolean; glob: boolean } {
  const out = { split: false, text: false, glob: false };
  const visit = (p: SyntaxNode | string): void => {
    if (typeof p === 'string') {
      out.text ||= p !== '';
      out.glob ||= GLOB.test(p);
    } else if (UNQUOTED_EXPANSION.has(p.type)) out.split = true;
    // (Only in double quotes: `'"$@"'` is text. `"${@:2}"`, `"${a[@]/x/y}"` and `"pre$@post"` too: src/semantics/elements.ts.)
    else if (p.type === 'string' && givesElements(p)) {
      out.split = true;
      out.text ||= p.namedChildren.some((e) => e.type === 'string_content');
    } else if (p.type === 'brace_expression' || p.type === 'concatenation') {
      // (The braces and commas of braces that do not expand are text; the parts between them are parts of the word.)
      out.text = true;
      p.namedChildren.forEach(visit);
    } else {
      out.text = true;
      out.glob ||= PLAIN.has(p.type) && GLOB.test(p.text);
    }
  };
  w.forEach(visit);
  return out;
}

/**
 * Whether one word of a brace expansion holds what may make other than one word of it: an unquoted expansion, `"$@"`
 * or `"${a[@]}"`, or a `$` that the braces leave before text bash then reads otherwise (`rejoined`: `{,$x}a` is `$xa`).
 */
export const splitsIn = (w: readonly (SyntaxNode | string)[]): boolean => rejoined(w) || partsOf(w).split;

/**
 * How many words one word of a brace expansion gives (the whole word, where its braces do not expand): with what may
 * split it (`splitsIn`) any number, none or more when nothing else in it is text (`$x`, `"$@"`, `"$@$x"`), one or more
 * otherwise (text in it makes one word of the first element or of nothing: `"pre$@post"` is `prepost`, as an empty
 * string does, `"$@"""`), but none or more where the braces leave a `$` before text; a glob at least one; anything else
 * one. A part of braces that do not expand is text with its parts in it (`set +B; x='p q'; cp {a,$x}` is `{a,p` and `q}`).
 */
function wordCount(w: readonly (SyntaxNode | string)[]): Count {
  const { split, text, glob } = partsOf(w);
  if (rejoined(w)) return { min: 0 };
  if (split) return { min: text ? 1 : 0 };
  return glob ? { min: 1 } : { min: 1, max: 1 };
}

/** The count of words side by side: the sum of each. */
const sum = (counts: Count[]): Count => {
  const max = counts.every((c) => c.max !== undefined) ? counts.reduce((a, c) => a + c.max!, 0) : undefined;
  return { min: counts.reduce((a, c) => a + c.min, 0), ...(max !== undefined ? { max } : {}) };
};

/**
 * How many words a word gives, when that is not one: the sum of what each word of its brace expansion gives
 * (`wordCount`), where `braces` says the step applies (the model's brace step, src/semantics/argwords.ts; without the
 * model, where the `shell` has it, whatever `set +B` says), with its quoted parts (`'%s,'{a..c}` is three words; `'a'{,}`
 * two, `{,}` none); an unquoted expansion an unknown number (`{a,$x}` two or more; `"$@"` none or more).
 */
export function countOf(n: SyntaxNode, shell?: Shell, braces: boolean | 'unknown' = bracesWork(n, shell)): ArgWord['count'] {
  const whole = wordCount(n.type === 'concatenation' ? n.namedChildren : [n]);
  const words = braces === false ? undefined : braceAlternatives([n]);
  // (Too many words to list: `{1..100000}`.)
  const count = words === null ? { min: 1 } : !words ? whole : sum(words.map(wordCount));
  // (With `set -o braceexpand` not known: the word itself, or its words.)
  const either = braces === 'unknown' && words ? (count.min === whole.min && count.max === whole.max ? count : { min: Math.min(count.min, whole.min) }) : count;
  return either.min === 1 && either.max === 1 ? undefined : either;
}

/** The parameter of a word that is one unquoted expansion of it and nothing else (`ArgWord.param`: `$a`, `${a}`, `$@`). */
function loneParameter(n: SyntaxNode): string | undefined {
  if (n.type === 'simple_expansion') return n.text.slice(1);
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

/**
 * The pattern one word of a brace expansion globs with, its expansions standing for any text (`*`): `-*$x` is `-**`.
 * Whether it may match `-` or `--`, which a command reads otherwise than an option (`-*` with the file `--`).
 */
function mayGiveDashes(w: readonly (SyntaxNode | string)[], shell?: Shell): boolean {
  const pattern = w.map((p) => {
    if (typeof p === 'string' || PLAIN.has(p.type)) return typeof p === 'string' ? p : p.text;
    const v = staticWordValue(p, false, shell);
    return v === undefined ? '*' : v.replace(/[*?[\\]/g, '\\$&');
  }).join('');
  const re = globToRegex(pattern, 'file');
  return !re || re.test('-') || re.test('--');
}

/**
 * The words a word's words come in (`ArgWord.parts`; one of them: `ArgWord.prefixEach`), where it has a known start: for
 * each word of its brace expansion (where `braces` says the step applies, and the words are not too many to list), the
 * words of its first field, which keep the start (one; where it globs, `fewest` or more), then, where it may split, the
 * words splitting adds after them (none or more, of unknown text). `dashes` where a word that globs has a start of `-` or
 * `--` and its pattern may match `-` or `--` (`-*`, not `-?x` nor `-[av]*`). Undefined otherwise.
 */
function startParts(n: SyntaxNode, prefix: string, braces: boolean | 'unknown', fewest: number, shell?: Shell): ArgWord[] | 'dashes' | undefined {
  if (!prefix) return undefined;
  const alternatives = braces === false ? undefined : braceAlternatives([n]);
  if (alternatives === null || (alternatives && braces === 'unknown')) return undefined;
  const words = alternatives ?? [n.type === 'concatenation' ? n.namedChildren : [n]];
  if ((prefix === '-' || prefix === '--') && words.some((w) => partsOf(w).glob && mayGiveDashes(w, shell))) return 'dashes';
  return words.flatMap((w): ArgWord[] => {
    const head: ArgWord = { prefix, ...(partsOf(w).glob ? { prefixEach: true as const, count: { min: fewest } } : {}) };
    return splitsIn(w) ? [head, { count: { min: 0 } }] : [head];
  });
}

/**
 * The words of the command line as the interpreter reads them, in a script for `shell` (bash when absent); `count` how
 * many words each gives, where the caller knows more than `countOf` (the model's fields, src/semantics/argwords.ts).
 */
export const argWordFor = (shell?: Shell, braces?: (n: SyntaxNode) => boolean | 'unknown', count = (n: SyntaxNode) => countOf(n, shell, braces?.(n))) => (n: SyntaxNode): ArgWord => {
  const value = staticWordValue(n, false, shell);
  const words = count(n);
  const param = loneParameter(n);
  const assigns = assignsOf(n);
  const prefix = value === undefined ? prefixOf(n, shell) : undefined;
  // (Which of its words keep its known start: all of one part, `-v*`; or some of several, `-v*$x`.)
  // (A glob gives none only where the glob options say so, `nullglob`: the model's count.)
  const parts = words && prefix !== undefined ? startParts(n, prefix, braces?.(n) ?? bracesWork(n, shell), Math.min(words.min, 1), shell) : undefined;
  // (One part: each of its words keeps the start, the words of a glob.)
  const kept = parts === 'dashes' ? { dashes: true as const } : parts?.length === 1 ? { prefixEach: true as const } : parts ? { parts } : {};
  return { ...(value !== undefined ? { value } : { prefix }), ...kept, ...(words ? { count: words } : {}), ...(param ? { param } : {}), ...(assigns ? { assigns } : {}) };
};

/** A word of the command line as the interpreter reads it in bash. */
export const argWord = argWordFor();
