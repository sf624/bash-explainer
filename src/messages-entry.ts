import type { BasisSpec } from './basis';
import type { ConventionId } from './conventions';
import type { Text } from './i18n';
import type { NoteLevel } from './levels';
import type { Head } from './messages-levels';
import type { Rewrite } from './rewrite';

// An entry of the message catalog (src/messages.ts, whose modules src/messages-facts-*.ts hold the entries by subject),
// and the functions that make one: its kind, the sections it cites, its texts, its level, and, on every entry that can
// be a problem, its headline.

/**
 * A clause of the sentence of a line on the models (src/linesentence.ts, src/messages-sentence.ts): a pipeline's status
 * (3.2.3, `pipeStatus`), and what `set -e` does when the statement fails (4.3.1, `errexit`).
 */
export type SentenceClause = 'pipeStatus' | 'errexit';

/** `note`: a fact of the models, always said. `pitfall`: advice on how a script is written, said only when the pitfalls are on. */
export type FactKind = 'note' | 'pitfall';

export interface Entry<P> {
  kind: FactKind;
  refs: readonly string[];
  /** The sections the fact cites in a case, some of `refs` (all it may cite), when they depend on the params. */
  refsOf?: (p: P) => readonly string[];
  /** The text in Japanese and English, without the mark (and the heading) that `level` and `kind` give. */
  text: (p: P) => readonly [ja: string, en: string];
  /**
   * The headline, on every entry that can be a problem (`Catalog` requires it): one sentence with what happens, which
   * the panel's box "Problems on this line" shows first (docs/design/panel-redesign.md, P7b), the whole text being its
   * "more". It says only what the text says in the same case, with no fix; by case where the text has cases (a level by
   * params, `set -e` on or off).
   */
  head?: (p: P) => Head;
  /** Only on a pitfall: what follows the mark in place of "落とし穴: " / "注意: " (empty: nothing). */
  heading?: Text;
  /** The level (by default `warning` for a pitfall, `note` for a note); a function when it depends on the params. */
  level?: NoteLevel | ((p: P) => NoteLevel);
  /** `false`: a warning or caveat that stays a note, never a problem in the editors (`notProblem`, `isProblem`). */
  problem?: false;
  /**
   * Where the fact is bash's behaviour rather than the manual's, or has a command to try it: the probe row that checks
   * it (src/basis.ts, `withBasis`); a function when it depends on the params. None: the manual's sections in `refs`.
   */
  basis?: BasisSpec | ((p: P) => BasisSpec | undefined);
  /**
   * A pitfall whose advice is a habit (sorted "both": docs/design/basis-spec-convention.md, 2.3): the habit, from the
   * table of src/conventions.ts (`withConvention`). The basis stays the fact's.
   */
  convention?: ConventionId;
  /** The clauses of a line's sentence that this fact says too (`saying`): where it is a problem of the line, the sentence leaves them out. */
  says?: readonly SentenceClause[];
  /** The rewrites the fact carries (`Fact.rewrite`, docs/design/oracles.md 3.2), from the params, as `suggests` gives them. */
  rewrite?: (p: P) => readonly Rewrite[];
}

/**
 * The entries of the catalog, as its type checks them: a note, which is never a problem, or an entry that can be one (a
 * pitfall, or one with a level: an error, a warning), which has its headline. A new entry of the second kind without
 * one does not compile.
 */
export type Catalog = Record<string, Plain<never> | Headed<never>>;

/** A note that is never a problem: no level, and no headline. */
type Plain<P> = Entry<P> & { kind: 'note'; level?: undefined; head?: undefined };

/** An entry that can be a problem: it has its headline. */
type Headed<P> = Entry<P> & { head: (p: P) => Head };

/** The parameters of an entry, for what a wrapper adds to it. */
type ParamsOf<E> = E extends Entry<infer P> ? P : never;

export const note = <P = Record<string, never>>(refs: readonly string[], text: (p: P) => readonly [string, string]): Plain<P> => ({ kind: 'note', refs, text });
/**
 * A fact that says the line fails every time it runs: a note at the level `error`, said whatever the pitfalls settings
 * say. Each has a row in the bash test of test/error-level.test.ts that runs it and sees it fail.
 */
export const failure = <P = Record<string, never>>(refs: readonly string[], text: (p: P) => readonly [string, string], head: (p: P) => Head): Headed<P> & { level: 'error' } =>
  ({ kind: 'note', refs, text, head, level: 'error' });
export const pitfall = <P = Record<string, never>>(refs: readonly string[], text: (p: P) => readonly [string, string], head: (p: P) => Head, heading?: Text, level?: NoteLevel | ((p: P) => NoteLevel)): Headed<P> & { kind: 'pitfall' } =>
  ({ kind: 'pitfall', refs, text, head, ...(heading ? { heading } : {}), ...(level ? { level } : {}) });
/**
 * A pitfall at the level `error`: the line fails every time as written (docs/design/three-levels.md, section 2), said
 * whatever the pitfalls settings say. Each has a row in the bash test of test/error-level.test.ts that runs it and sees it fail.
 */
export const broken = <P = Record<string, never>>(refs: readonly string[], text: (p: P) => readonly [string, string], head: (p: P) => Head, heading?: Text): Headed<P> & { kind: 'pitfall' } => pitfall(refs, text, head, heading, 'error');
/** A pitfall at the level `info`: harmless with most values, systems or paths. */
export const caveat = <P = Record<string, never>>(refs: readonly string[], text: (p: P) => readonly [string, string], head: (p: P) => Head, heading?: Text): Headed<P> & { kind: 'pitfall' } => pitfall(refs, text, head, heading, 'info');
/**
 * A caveat that stays a note: the panel, the hover and the CLI say it with its level, but it is no problem in the
 * editors, since it is often meant, or wrong where a file is read after the option is set (docs/design/note-levels.md,
 * "Notes as problems").
 */
export const notProblem = <E>(e: E): E => ({ ...e, problem: false });
/**
 * An entry that says what a clause of a line's sentence on the models says (`SentenceClause`): a problem of the line
 * that is this fact leaves the clause out (src/linesentence.ts).
 */
export const saying = <E>(e: E, ...says: SentenceClause[]): E => ({ ...e, says });
/** An entry with its basis: the probe row that checks it and gives a try-it (src/basis.ts, docs/design/basis.md). */
export const withBasis = <E>(e: E, basis: BasisSpec | ((p: ParamsOf<E>) => BasisSpec | undefined)): E => ({ ...e, basis });
/** A pitfall whose advice is a habit, beside the fact it states (src/conventions.ts). */
export const withConvention = <E>(e: E, convention: ConventionId): E => ({ ...e, convention });
/** An entry whose suggestion is rewrites: its params carry them (`rewrite`), its text renders their code, its fact those with edits. */
export const suggests = <E>(e: E): E => ({ ...e, rewrite: (p: { rewrite: readonly Rewrite[] }) => p.rewrite.filter((r) => r.edits.length) });

/**
 * The level of a pitfall that fails every time but in some cases, where it is a caveat: `unread` (`unreadClause`),
 * `reader` (`readByBashrc`), `sent` (ssh may send the variable: src/messages-wrappers.ts).
 */
export const byCase = ({ unread, reader, sent }: { unread?: boolean; reader?: string; sent?: boolean }): NoteLevel => (unread || reader || sent ? 'info' : 'error');

/** Headings of pitfalls whose text names its own kind of problem. */
export const NO_HEADING: Text = { ja: '', en: '' };
export const SYSTEM_DEPENDENT: Text = { ja: '環境依存: ', en: 'System-dependent: ' };

/** A text in both languages, for a parameter that is itself words (where `set -e` is ignored…). */
export type Words = Text;
