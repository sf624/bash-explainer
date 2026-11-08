import { basisOf, type Basis, type TryIt } from './basis';
import type { ConventionId } from './conventions';
import type { Lang } from './i18n';
import { alwaysFails, LEVELS, namesLevel, type NoteLevel, severityOf } from './levels';
import type { Catalog, Entry, FactKind, SentenceClause, Words } from './messages-entry';
import { COMMAND_MESSAGES } from './messages-facts-commands';
import { BATS_MESSAGES } from './messages-facts-bats';
import { HOST_MESSAGES } from './messages-facts-hosts';
import { LINE_MESSAGES } from './messages-facts-lines';
import { SHELL_MESSAGES } from './messages-facts-shells';
import { STATUS_MESSAGES } from './messages-facts-status';
import { WORD_MESSAGES } from './messages-facts-words';
import { IDIOM_MESSAGES } from './messages-idioms';
import { type Head, marked, PORTABILITY, PROBLEM_LEVELS, type ProblemNote, STYLE_CHECKS, styleLevel, type StyleCase, type StyleCode, type TokenEntry } from './messages-levels';
import { TOKEN_TEXTS } from './messages-tokens';
import { TOOL_NOTES, UNREAD } from './messages-unread';
import type { TokenMark } from './analyzer-types';
import type { Rewrite } from './rewrite';

// The message catalog: the notes and pitfalls that render a fact of the semantic models (src/semantics/: the shell
// state, where code runs, words, names, status), each with a stable id, its texts in ja and en, the sections of the
// Bash manual it is about (src/manual.ts), and, on each that can be a problem, its headline. The renderers show the
// sections as links, or as "(Bash manual 3.7.5)" in the CLI; the JSON output gives the id.
//
// The texts are the analyzer's: a fact is found where the model is read (src/explain/, src/statusfacts.ts,
// src/wordfacts.ts), and said here. The entries are in modules by subject (src/messages-facts-*.ts, and those of the
// tool, the idioms), made by the functions of src/messages-entry.ts, whose type `Catalog` checks each. The style checks
// of src/pitfalls.ts are not facts and have no entry: their levels and headlines are in src/messages-levels.ts
// (`STYLE_CHECKS`).

export type { Entry, FactKind, Head, SentenceClause };

/**
 * A note's level (how every output shows it: the level table, src/levels.ts) comes from here, each entry's `level`, and
 * beside it from src/messages-levels.ts, the style checks' and the other problems'. A level that depends on the case
 * (the command a word is given to, how far a failure reaches) is a function of the params (`unquoted-variable-as-path`,
 * `nounset-unbound`).
 */
export type { NoteLevel };
export { severityOf };

export const MESSAGES = {
  ...STATUS_MESSAGES,
  ...COMMAND_MESSAGES,
  ...SHELL_MESSAGES,
  ...WORD_MESSAGES,
  ...BATS_MESSAGES,
  ...TOOL_NOTES,
  ...UNREAD,
  ...HOST_MESSAGES,
  ...LINE_MESSAGES,
  ...IDIOM_MESSAGES,
} satisfies Catalog;


export type FactId = keyof typeof MESSAGES;
export type Params<K extends FactId> = Parameters<(typeof MESSAGES)[K]['text']>[0];

/** The facts that can be problems: those whose entry has a headline, which `Catalog` requires of each that is a pitfall or has a level. */
export type ProblemFactId = { [K in FactId]: (typeof MESSAGES)[K] extends { head: unknown } ? K : never }[FactId];

/**
 * A note as data (docs/design/note-levels.md): its text as the line's notes have it (`LineExplanation.notes`: the mark,
 * the word, the body), its level, the word after the mark that names the level or the kind of problem ("Pitfall:",
 * "Caveat:", "Script injection risk:"; empty when there is none), and the rest. `code`: the problem it is, in the
 * editors (`DocumentIssue.code`: a fact's id, a style check, a dialect issue). The views read the level and the word
 * from here, never from the text. `head`: one sentence with what happens, on every note that can be a problem (a fact's
 * and a style check's from its entry, a dialect issue's, a token's error's from its text's entry), which the
 * panel's box shows first. `convention`: the habit its advice is, beside the fact it states (src/conventions.ts; data
 * only, no view shows it).
 */
export interface Note { text: string; level: NoteLevel; label: string; body: string; head?: string; code?: string; convention?: ConventionId }

/**
 * A fact as a note: its id (also its `code`), its kind, and the sections it cites; where it is bash's behaviour rather
 * than the manual's, its `basis` (none: the manual's sections in `refs`, `basisFor`), and a command that shows it
 * (`tryIt`), both from the probe row that checks it (src/basis.ts); a pitfall whose advice is a habit, its `convention`;
 * where it suggests mechanical rewrites, those (`rewrite`: alternatives, each complete, the first recommended;
 * src/rewrite.ts), which its text renders.
 */
export interface Fact extends Note { id: FactId; kind: FactKind; refs: readonly string[]; code: FactId; basis?: Basis; tryIt?: TryIt; rewrite?: readonly Rewrite[] }

/**
 * The note of a style check of src/pitfalls.ts, which is no fact of the catalog (its text is the check's): a pitfall,
 * at its level from `STYLE_CHECKS` (by what the check found, `c`), with its code and its headline.
 */
export function styleNote(lang: Lang, code: StyleCode, body: string, c: StyleCase = {}): Note & { code: StyleCode } {
  return { ...marked(lang, styleLevel(code, c), body, { kind: 'pitfall', head: STYLE_CHECKS[code].head(c) }), code };
}

/**
 * The note of a dialect issue of src/dialect.ts, which is no fact of the catalog (its text is the dialect table's), at
 * its level from `PROBLEM_LEVELS`: `unsupported`, "Error:"; `differs` (a warning) and `behaviour` (information),
 * "Portability:"; `parse`, information (src/messages-levels.ts).
 */
export function problemNote(lang: Lang, kind: 'unsupported' | 'differs' | 'behaviour' | 'parse', code: string, body: string, head: Head): Note & { code: string } {
  return { ...marked(lang, PROBLEM_LEVELS[kind], body, { head, ...(kind === 'behaviour' || kind === 'differs' ? { heading: PORTABILITY } : {}) }), code };
}

/**
 * The note of a token's text that says the command fails every time (`tokenError`, src/messages-levels.ts): the row's
 * text and what follows from it. As a note it reaches the panel's box and the problems by the one path of every note (`noteIssues`).
 * Its code is the text's id, as for `# bash-explainer disable=`.
 */
export function tokenNote(lang: Lang, { id, level, text }: TokenMark): Note & { code: string } {
  const { head, then } = (TOKEN_TEXTS[id] as TokenEntry<never>).problem!;
  return { ...marked(lang, level, lang === 'ja' ? `${text}。${then[0]}` : `${text}. ${then[1]}`, { head }), code: id };
}

/**
 * A note's text in the problem outputs (`DocumentIssue.message`: the Problems panels, `--check`, the annotations,
 * SARIF), which show its level themselves: without the word of its level where the level says it on every note
 * ("Error:", `namesLevel`), so that the level is said once (`file:2:1: error: …`). A heading and a kind's word
 * ("Pitfall:") stay; the explanations, the hover and Copy as Markdown keep the whole text.
 */
export function problemText(n: Note, lang: Lang): string {
  return namesLevel(n.level, n.label, lang) ? `${LEVELS[n.level].mark} ${n.body}` : n.text;
}

/** The note of a fact, in `lang`. */
export function fact<K extends FactId>(lang: Lang, id: K, ...params: Params<K> extends Record<string, never> ? [] : [Params<K>]): Fact {
  const e = MESSAGES[id] as Entry<unknown>;
  const [ja, en] = e.text(params[0]);
  const level = typeof e.level === 'function' ? e.level(params[0]) : e.level ?? (e.kind === 'pitfall' ? 'warning' : 'note');
  const head = e.head?.(params[0]);
  const { text, label, body, head: said } = marked(lang, level, lang === 'ja' ? ja : en, { kind: e.kind, heading: e.heading, head });
  const { basis, tryIt } = basisOf(typeof e.basis === 'function' ? e.basis(params[0]) : e.basis);
  const rewrite = e.rewrite?.(params[0]);
  return { id, kind: e.kind, level, text, refs: e.refsOf?.(params[0]) ?? e.refs, label, body, ...(said ? { head: said } : {}), code: id, ...(basis ? { basis } : {}), ...(tryIt ? { tryIt } : {}), ...(e.convention ? { convention: e.convention } : {}), ...(rewrite?.length ? { rewrite } : {}) };
}

/** The fact `f` where a shell may not read the text as it is written (`readAs`, src/semantics/scriptstops.ts): a warning with the same words. */
export function warningOf(lang: Lang, f: Fact): Fact {
  // (An error is a problem, so it has its headline: `Catalog`.)
  const { text, level, label } = marked(lang, 'warning', f.body, { kind: f.kind, heading: (MESSAGES[f.id] as Entry<unknown>).heading, head: [f.head!, f.head!] });
  return { ...f, text, level, label };
}

/** The clauses of a line's sentence that the fact `code` says (none for a code that is no fact: a style check, a dialect issue). */
export function clausesOf(code: string): readonly SentenceClause[] {
  return (MESSAGES as Record<string, Entry<never>>)[code]?.says ?? [];
}

/** Whether the note with `code` is a problem when it is a warning or a caveat: all are, but the facts that `notProblem` marks. */
export function isProblem(code: string): boolean {
  return (MESSAGES as Record<string, Entry<never>>)[code]?.problem !== false;
}

/** Whether a note of a line is a problem in the editors: a warning, a caveat or an error, which the catalog does not keep a note (`isProblem`). */
export function isProblemNote<N extends Pick<Note, 'level' | 'code'>>(n: N): n is N & ProblemNote {
  return n.level !== 'note' && isProblem(n.code!);
}

/** A fact before its language is chosen: its id and its params (language-free, or `Words`). */
export type FactSpec = { [K in FactId]: { id: K; params: Params<K> } }[FactId];

/** The note of a `FactSpec`, in `lang`. */
export function factOf(lang: Lang, spec: FactSpec): Fact {
  return (fact as (l: Lang, id: FactId, p: unknown) => Fact)(lang, spec.id, spec.params);
}

export type { Words };

/**
 * The one rule of the `notes.pitfalls` setting: whether a pitfall of `level` is said, which it is unless the pitfalls
 * are off; one at a level that fails every time (an error) is said either way, since it is a bug, not advice. `said`
 * reads it for the facts, the analyzer for the style checks (src/pitfalls.ts).
 */
export function pitfallSaid(level: NoteLevel, pitfalls: boolean | undefined): boolean {
  return pitfalls !== false || alwaysFails(level);
}

/**
 * The one gate of the `notes.pitfalls` setting for the facts: those that are said, which are all but the pitfalls when
 * the pitfalls are off, but the errors (`pitfallSaid`). The analyzer, the bats facts and the host notes all say their
 * facts through it.
 */
export function said(facts: readonly Fact[], pitfalls: boolean | undefined): Fact[] {
  return facts.filter((f) => f.kind !== 'pitfall' || pitfallSaid(f.level, pitfalls));
}

/**
 * The one gate of the `notes.basis` setting (docs/design/basis.md, 4): the fact, or a note's data, as the explanation
 * carries it, with no basis, no try-it and no convention when the setting is off, as `said` leaves the pitfalls out.
 */
export function basisGate<N extends Note & { basis?: Basis; tryIt?: TryIt }>(f: N, basis: boolean | undefined): N {
  if (basis !== false || (!f.basis && !f.tryIt && !f.convention)) return f;
  const { basis: _b, tryIt: _t, convention: _c, ...rest } = f;
  return rest as N;
}

/** A note's convention, as a field of another record (a problem of `--check`): none when it has none. */
export function conventionOf({ convention }: Note): { convention?: ConventionId } {
  return convention ? { convention } : {};
}

// ---------------------------------------------------------------- what an explanation rests on (docs/design/basis.md)

/** A basis the views mark, in a language: the chip's words and its tooltip. */
export interface BasisSaid { kind: 'checked' | 'differs'; label: string; title: string }

/** The releases a try-it passed: "5.2", "5.2 and 5.3" / 「5.2・5.3」. */
const releases = (lang: Lang, bash: readonly string[]): string => (lang === 'ja' ? bash.join('・') : bash.join(' and '));

/**
 * The chip of a basis the views mark (`checked`, `differs`; none for the others): the releases are those the try-it
 * passed in CI (`Basis.bash`), whatever `bashVersion` is set to.
 */
export function basisSaid(lang: Lang, b: Basis | undefined): BasisSaid | undefined {
  if (b?.kind !== 'checked' && b?.kind !== 'differs') return undefined;
  const r = releases(lang, b.bash);
  const [label, title] = b.kind === 'checked'
    ? (lang === 'ja'
      ? [`マニュアルに記述なし・bash ${r} で確認`, `Bash マニュアルに書かれていない bash の実際の動き。bash ${r} で実行して確かめた（メッセージは \`LC_ALL=C\` のときのもの）`]
      : [`Not in the manual · checked with bash ${r}`, `bash's actual behaviour, which the Bash manual does not state: checked by running bash ${r} (messages as with \`LC_ALL=C\`)`])
    : (lang === 'ja'
      ? [`マニュアルの記述と異なる・bash ${r} で確認`, `Bash マニュアルの記述とは異なる bash の実際の動き。bash ${r} で実行して確かめた（メッセージは \`LC_ALL=C\` のときのもの）`]
      : [`Differs from the manual · checked with bash ${r}`, `bash's actual behaviour, which differs from what the Bash manual says: checked by running bash ${r} (messages as with \`LC_ALL=C\`)`]);
  return { kind: b.kind, label, title };
}

export { type NameSaid, nameKindWord, nameSaid } from './messages-names';
export { blankName, blankWord, codeShown, EMPTY_WORD, emptyName, shownPiece, shownWord, SPACE_MARK, type SpaceEnds, valueSaid, type ValueSaid } from './messages-values';
