// What a finished line is (docs/design/python-regex.md, 2.5; docs/design/sources.md, row 34): the steps after the walk that
// do not read the tree, shared by a shell line (`Analyzer.explained`, src/analyzer.ts) and a line of a part of a host file in
// another language (`explainLanguageLine`, src/hosts/languages.ts). The bases and try-its of the tokens, the ids of the catalog's
// texts taken off them, the notes the caller works out with those, the examples the settings keep, the summary, the origin
// given to the tokens and the labels their texts echo dropped, and the facts put on their tokens. What depends on the walk (the
// sentence, `argv`, the reading tree of bash's layers) stays with the shell path.
import type { ContextEntry, Example, ExampleKind, ExplainOptions, LineExplanation, NoteAnchor, Span, Token, TokenMark, TokenOrigin } from './analyzer-types';
import { pictureNote } from './ctlchars';
import type { Lang } from './i18n';
import { onceBy } from './lists';
import { type Fact, type Note, tokenNote } from './messages';
import { saysProblem } from './messages-tokens';
import { isBash, type Shell } from './shellfeatures';
import { type RestingText, withoutBases, withTokenBases } from './tokenbases';
import { KIND_ROLES } from './roles';
import { eachOwn, keep } from './tokenkept';
import { claim, dropLabelEcho, markSaid, markTokens, summaryOf } from './tokenmarks';

/** What a line's walk, or a reader, has made of the line. */
export interface LineMade {
  line: number;
  /** The shell the line is explained as, when it is not bash. */
  shell?: Shell;
  /** The line's tokens, in the order of the text. */
  items: Token[];
  /** Those of them the line made itself: not the finished tokens of a statement over several lines (src/tokenkept.ts). */
  own: Token[];
  /** The texts of the line that state a behaviour, with what each rests on (`withTokenBases`). */
  rested: readonly RestingText[];
  context: ContextEntry[];
  /** Who reads the tokens that no one claimed (`claim`): `shell` on a shell line. */
  origin: TokenOrigin;
}

/** What the line says, which the caller works out once the tokens have their texts (`said` of `finishLine`). */
export interface LineSaid {
  notes: string[];
  noteInfo: Note[];
  facts: readonly Fact[];
  anchors: readonly NoteAnchor[];
  /** The facts and anchors put on the tokens (`markTokens`): the line's own, where a statement over several lines has its own already. */
  marked: { facts: Fact[]; anchors: readonly NoteAnchor[] };
  /** The examples the settings keep (`keptExamples`). */
  examples: Example[];
  /** A token's summary where it is not its own (a statement explained once for the document). */
  summary?: (t: Token) => string | undefined;
}

/**
 * The finished line: the tokens of `made` get their bases (none with `notes.basis` off) and the ids of their texts, then the
 * caller says what the line says (`said`), and `end` closes the caller's walk. The summary is made from the full texts; then the
 * tokens no one claimed take `made.origin`, their labels' echoes are dropped, and each token gets its role and the facts about it.
 */
export function finishLine(made: LineMade, opts: ExplainOptions, said: () => LineSaid, end?: () => void): LineExplanation {
  const { items, own, line, shell } = made;
  if (opts.basis === false) withoutBases(own);
  else withTokenBases(own, made.rested);
  markSaid(own);
  const s = said();
  const result: LineExplanation = {
    line,
    ...(isBash(shell) !== 'yes' ? { shell } : {}),
    items,
    context: made.context,
    notes: s.notes,
    noteInfo: s.noteInfo,
    ...(s.facts.length ? { facts: [...s.facts] } : {}),
    ...(s.anchors.length ? { anchors: [...s.anchors] } : {}),
    examples: s.examples,
    summary: items.filter((t) => t.kind !== 'comment' || items.length === 1).map((t) => s.summary?.(t) ?? summaryOf(t)).join(' ; '),
  };
  end?.();
  // The summary above was made with the full explanations; the tree drops what its labels already say.
  for (const item of own) dropLabelEcho(claim(item, made.origin));
  result.items = markTokens(items, s.marked);
  return result;
}

/**
 * Tokens that are no part of a line's tree, finished when they are made, as a line finishes its own (`finishLine`): the ids of
 * their texts (`markSaid`), their labels' echoes dropped (`dropLabelEcho`) and their roles; then kept (src/tokenkept.ts), so that
 * every line that shows them reads them as they are. The reading of a known value (`ValueReading`, docs/design/known-values.md, 4.1).
 */
export function finishedApart(tokens: Token[]): readonly Token[] {
  markSaid(tokens);
  for (const t of tokens) {
    dropLabelEcho(t);
    eachOwn(t, (x) => {
      x.role = KIND_ROLES[x.kind];
    });
    keep(t);
  }
  return Object.freeze(tokens);
}

/** Whether the settings show an example of a kind: examples are on, and the kind is not turned off. */
export function wantsKind(opts: ExplainOptions, kind: ExampleKind | undefined): boolean {
  const o = opts.examples;
  if (!o) return true;
  return o.enabled && !(kind && o.disabled.includes(kind));
}

const wantsExample = (opts: ExplainOptions, e: Example): boolean => wantsKind(opts, e.kind);

/**
 * The examples, each with what it is for in its title (`Example.target`), on a line of several: the commands of a shell line
 * (`runsSeveral`, src/explain/examples.ts), the calls of a line of a part in another language (src/hosts/languages.ts).
 */
export function titledExamples(lang: Lang, examples: readonly Example[]): Example[] {
  return examples.map((e) => {
    if (!e.target) return e;
    const target = `\`${e.target}\``;
    const title = lang === 'ja'
      ? e.title.replace(/^例/, () => `${target} の例`)
      : e.title.replace(/^Example/, () => `Example for ${target}`);
    return { ...e, title };
  });
}

/** The examples the settings keep, each once, with a note on the control characters they show as symbols. */
export function keptExamples(examples: readonly Example[], opts: ExplainOptions, lang: Lang): Example[] {
  const s = (ja: string, en: string) => (lang === 'ja' ? ja : en);
  return onceBy(examples.filter((e) => wantsExample(opts, e)), (e) => JSON.stringify(e)).map((e) => {
    const note = pictureNote(e.sections.flatMap((sec) => sec.lines), s);
    return note ? { ...e, note } : e;
  });
}

/**
 * The errors the tokens of a line say (`tokenError`, `Token.marks`), as notes about each token: a token warning stays on its
 * row, but "fails every time" is a problem of the line (docs/design/panel-redesign.md, P7b). `sayAt` records each where the
 * line keeps its notes (`LineExplainer.sayAt`, or a language line's anchors: `sayAt` of src/noteanchors.ts). From there it goes
 * the way of every note: the box, the hover, Markdown, the Problems strip, `--check`.
 */
export function tokenErrors(lang: Lang, items: readonly Token[], sayAt: (n: Note & { code: string }, span: Span) => string): string[] {
  const found: string[] = [];
  eachProblem(items, (m, t) => found.push(sayAt(tokenNote(lang, m), t.span)));
  return [...new Set(found)];
}

/** Whether a token of `items`, or under them, says a problem (`tokenErrors`): a known value's reading that finds an error in it. */
export function saysProblemIn(items: readonly Token[]): boolean {
  let found = false;
  eachProblem(items, () => { found = true; });
  return found;
}

/** Each mark of a token of `items`, or under them, that says a problem, with its token. */
function eachProblem(items: readonly Token[], f: (m: TokenMark, t: Token) => void): void {
  const walk = (t: Token) => {
    for (const m of t.marks ?? []) if (saysProblem(m)) f(m, t);
    t.children.forEach(walk);
    // (A known value read in its command's language has its tokens apart from the tree: an error in the value is the line's, as a literal's.)
    t.value?.reading?.tokens.forEach(walk);
  };
  items.forEach(walk);
}
