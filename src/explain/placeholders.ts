// The words a command replaces with each path or input line before it runs another (find's `{}` of `-exec`, `-execdir`, `-ok` and `-okdir`, xargs's
// `-I%`): the interpreter finds them by their value (`CommandRole.placeholder`, from `PlaceholderSpec`), so `'{}'` and `\{\}` are too.
import type { SyntaxNode } from '../syntax/tree';
import type { Span, Token } from '../analyzer-types';
import type { CommandRole } from '../argv/interpret';
import type { PlaceholderRole } from '../argv/placeholders';
import { fact } from '../messages';
import { plainOf } from '../messages-levels';
import { spanOf } from '../noteanchors';
import { readingNodes } from '../reading';
import type { ExecEnv, SlotLink } from '../semantics/env';
import { type NestedScript, scriptSourceIndex } from '../semantics/nested';
import type { Explainer } from './context';
import { lineStarts, posOf, sameSpan } from './nodes';

/** The words that the option of `role` replaces, those that are the text alone and those that hold it (`nodes` are the words the role's indices count). */
export interface PlaceholderWords { whole: SyntaxNode[]; within: SyntaxNode[]; role: PlaceholderRole }

/**
 * The words that the option of `role` replaces (`nodes` are the words the role's indices count), made known to the command being explained and to
 * the commands it runs, which read them (`Explainer.command`: `$1` of `sh -c '…' _ {}`).
 */
export function placeholderWords(cx: Explainer, role: CommandRole, nodes: SyntaxNode[]): PlaceholderWords | undefined {
  const p = role.placeholder;
  if (!p) return undefined;
  const found = { whole: p.whole.map((i) => nodes[i]), within: p.within.map((i) => nodes[i]), role: p };
  if (cx.command) {
    const map = (cx.command.placeholders ??= new Map());
    for (const w of found.whole) map.set(w, { by: p.by, text: p.text, with: p.with, within: false });
    found.within.forEach((w, k) => map.set(w, { by: p.by, text: p.text, with: p.with, within: true, at: p.at[k] }));
  }
  return found;
}

/**
 * Says of the tokens of the words that are the text alone (in `tokens`) that the command around replaces it, and that it reads it, not the one it runs;
 * of a word that holds the text, that it is replaced in it, with what else the word says.
 */
export function markPlaceholders(cx: Explainer, found: PlaceholderWords | undefined, tokens: Token[]): void {
  if (!found) return;
  const { by, text, with: what } = found.role;
  const whole = found.whole.map(spanOf);
  const within = found.within.map(spanOf);
  // (What the word says stays; this is added to it. A word that is the text alone is bash's own string where no operand describes it, and has nothing under it.)
  const mark = (ts: Token[]): void => ts.forEach((t) => {
    const isWhole = whole.some((s) => sameSpan(s, t.span));
    if (isWhole || within.some((s) => sameSpan(s, t.span))) {
      t.explanation += cx.text('placeholder-replaced', { text, what, by, within: !isWhole });
      if (isWhole) {
        t.placeholder = what;
        t.origin = 'argv';
        t.children = [];
      }
    } else mark(t.children);
  });
  mark(tokens);
}

/**
 * Of the words of a string a shell reads as code (`words`, which `env` runs: `sh -c 'echo {}'`), those that hold the text the command around replaces
 * among other text (`Replaced.at`): the tool pastes the path or the item into the code before the shell reads it. Says so once for the string, with the
 * shell's arguments as the fix where it has them (`notes`: not where nothing runs it); and, where the string is read (`script`, `tokens`), says of the part
 * of its reading that holds each place that it is replaced first, and that its reading takes it for a plain name: a part that is the text alone is the
 * tool's placeholder (`Token.placeholder`), with nothing under it.
 */
export function pastedIntoScript(cx: Explainer, words: readonly SyntaxNode[], env: ExecEnv, notes: boolean, script?: NestedScript, tokens: Token[] = []): void {
  const pasted = words.flatMap((w) => {
    const r = cx.command?.placeholders?.get(w);
    return r?.at ? [{ w, r }] : [];
  });
  if (!pasted.length) return;
  const { by, text, with: what } = pasted[0].r;
  const link = env.links.at(-1) as SlotLink;
  if (notes) cx.note(fact(cx.lang, 'placeholder-in-shell-string', { by, text, what, ...(link.slot.params ? { via: link.via } : {}) }), pasted.map((p) => p.w));
  if (!script) return;
  const lines = lineStarts(cx.source);
  // (Where each word starts in the string's text: its first character's source is in the word; a space between two words is before it.)
  const places = pasted.flatMap(({ w, r }) => {
    const base = script.starts.findIndex((s) => s >= w.startIndex);
    return r.at!.map((k): Span => ({ start: posOf(lines, scriptSourceIndex(script, base + k, false)), end: posOf(lines, scriptSourceIndex(script, base + k + text.length, true)) }));
  });
  const before = (x: Span['start'], y: Span['start']): boolean => x.line < y.line || (x.line === y.line && x.character <= y.character);
  const holds = (t: Token, sp: Span): boolean => before(t.span.start, sp.start) && before(sp.end, t.span.end);
  const said = new Set<Token>();
  // (The reading of the string, which depth 2 shows: a part of it says what its token says.)
  const read = tokens.flatMap((t) => (t.reading ?? []).flatMap(readingNodes));
  // (The innermost part that holds the place; one that holds two says it once.)
  const mark = (ts: readonly Token[], sp: Span): boolean => {
    const t = ts.find((x) => holds(x, sp));
    if (!t) return false;
    if (mark(t.children, sp) || said.has(t)) return true;
    said.add(t);
    const whole = sameSpan(t.span, sp);
    const was = t.explanation;
    t.explanation += cx.text('placeholder-pasted', { text, what, by, whole });
    if (whole) {
      t.placeholder = what;
      t.children = [];
    }
    for (const n of read) {
      if (!sameSpan(n.span, t.span) || n.text !== was) continue;
      n.text = plainOf(t.explanation);
      if (whole) n.placeholder = what;
    }
    return true;
  };
  for (const sp of places) mark(tokens, sp);
}
