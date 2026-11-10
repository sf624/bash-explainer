// The pieces of an argument's explanation that the options, the operands and the command itself all use (src/explain/argv.ts): the
// own-property lookup, the dash of an option, the parts of a word, a positional word, the spans of an option's letters.

import type { Kind, Token } from '../analyzer-types';
import { type ArgRole } from '../argv/interpret';
import { SHELL_OPTION_TABLES } from '../dict/builtins';
import { OPTION_SECTIONS } from '../manual';
import { globIntro, hasGlob } from '../embedded/glob';
import type { EmbeddedLang } from '../embedded/types';
import { prefixCharAt } from '../argv/words';
import { isPlainWord, literalContent, plainText, sourceIndex } from '../staticword';
import { type SyntaxNode } from '../syntax/tree';
import type { Explainer } from './context';
import { embedded } from './embedded';
import { sortTokens, sourcePos, graftExpansions } from './nodes';
import { type StepKind } from '../semantics/words';
import { elementsOf } from '../semantics/elements';
import { globOff, wordAt } from './reads';
import { braceWord, globChildren, globNotes, tilde, tildeNote, valueNote, word } from './words';

/** The entry of a table of a spec for a word of the script (`set -o constructor` finds none). */
export const own = <T>(table: Readonly<Record<string, T>> | undefined, word: string): T | undefined => (table && Object.hasOwn(table, word) ? table[word] : undefined);

/**
 * The section of chapter 6 that describes the shell option `word`, when `values` are the names of shell options
 * (`set -o posix`: 6.11; `SHELL_OPTION_TABLES`, `OPTION_SECTIONS`).
 */
export function optionRefs(values: object | undefined, word: string): { refs?: string[] } {
  // (Only a name the table has: `shopt -s posix` is no `shopt` option.)
  const section = values && SHELL_OPTION_TABLES.has(values) && Object.hasOwn(values, word) ? own(OPTION_SECTIONS, word) : undefined;
  return section ? { refs: [section] } : {};
}

/** `+x` (an option turned off) is written as `-x` in texts. */
export const dash = (flag: string): string => flag.replace(/^\+/, '-');

/**
 * Marks the token of a word the command reads as an argument with how bash changes the word before the command gets
 * it (`Token.expands`), from the word's meaning: a glob that applies, an unquoted expansion that splits, a brace expansion,
 * an expansion that gives one word per element (`"$@"`).
 */
export function expanded(cx: Explainer, a: SyntaxNode, t: Token): Token {
  if (t.kind !== 'argument') return t;
  const w = wordAt(cx, a)!;
  const on = (k: StepKind): boolean => w.steps.some((x) => x.kind === k && x.applies === true);
  const kind = on('split') ? 'split' : on('glob') ? 'glob' : on('brace') ? 'brace' : elementsOf(w).length ? 'elements' : undefined;
  return kind ? { ...t, expands: kind } : t;
}

/** The tokens of an expansion in a word read as an option (`-$opts`), if any. */
export function wordParts(cx: Explainer, a: SyntaxNode): Token[] {
  return isPlainWord(a) ? [] : cx.sub(a);
}

/** A letter of an option word (`-e` of `-euo`, `c` of `tar cf`), as a token over its character. */
export function part(a: SyntaxNode, role: Extract<ArgRole, { role: 'option' | 'unknown-option' }>, label: string, explanation: string): Token {
  const [from, to] = role.part!;
  return span(a, from, to, 'option', explanation, label);
}

/** A token over the characters `from` to `to` of the value of the word `a`. */
export function span(a: SyntaxNode, from: number, to: number, kind: Kind, explanation: string, label: string): Token {
  const lit = literalContent(a);
  const at = (i: number, isEnd: boolean): number => (lit ? sourceIndex(lit, isEnd ? i + 1 : i, isEnd) : isEnd ? prefixCharAt(a.text, i) + 1 : prefixCharAt(a.text, i));
  return { kind, label, explanation, children: [], span: { start: sourcePos(a, at(from, false)), end: sourcePos(a, to < 0 ? a.text.length : at(to - 1, true)) } };
}

export function positional(cx: Explainer, a: SyntaxNode, desc: string | undefined, lang?: EmbeddedLang): Token {
  const emb = lang && embedded(cx, a, lang);
  if (emb && desc && emb.note) desc += ` — ${emb.note}`;
  // (A word of plain text with braces, `x{a,b}`, is read as one: its brace expansion, or its text where it has none.)
  if (plainText(a)) {
    // Arguments in another language are positional ones the dictionary describes.
    if (emb) return cx.tok(a, 'argument', desc!, emb.tokens);
    const brace = braceWord(cx, a);
    const base = brace ?? word(cx, a);
    // (A word that is only a tilde expansion is still an operand the command reads: bash's token is under it.)
    if (!desc) return base.kind === 'expansion' && !brace ? cx.tok(a, 'argument', cx.text('word-plain', { text: a.text }), [base]) : base;
    if (brace) return cx.tok(a, 'argument', desc, [brace]);
    const tl = tilde(cx, a);
    // (Tildes after `=` and `:` come as a word with them as its children.)
    if (tl) return tl.kind === 'expansion' ? cx.tok(a, 'argument', desc, [tl]) : cx.tok(a, 'argument', desc + tildeNote(cx, a), tl.children);
    const off = hasGlob(a.text) && globOff(cx, a);
    if (off) return cx.tok(a, 'argument', desc + off);
    const glob = hasGlob(a.text) ? ` — ${globIntro(cx.lang, 'file')}` + globNotes(cx, a.text, a) : '';
    const t = cx.tok(a, 'argument', desc + glob + valueNote(cx, a), hasGlob(a.text) ? globChildren(cx, a, a.text, 0) : []);
    if (glob) t.refs = ['3.5.8'];
    return t;
  }
  const inner = cx.sub(a);
  // The embedded tokens sit inside the quotes, so they become children of the string token.
  if (emb && inner[0]) {
    if (emb.holes) graftExpansions(inner[0], emb.tokens, emb.holes);
    inner[0].children = sortTokens([...inner[0].children, ...emb.tokens]);
  }
  if (!desc) return inner[0];
  // Describe the role, then what the quoting/expansion does.
  return cx.tok(a, 'argument', desc, inner);
}
