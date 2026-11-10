// One record per token (docs/design/sources.md, row 15, SB3c): what a token's row holds, whichever output draws it. The panel
// (media/panel.js `item`), the hover (src/ui/hoverView.ts), Markdown (src/ui/render.ts `toPlainMarkdown`) and the command line
// (cli/main.ts `textOutput`) read this record and differ only in the markup; test/row-source.test.ts fails on an output that reads
// a token's text by itself. The panel's row model (docs/design/panel-redesign.md, P7a) builds on it.
import type { Kind, Token, TokenMark, ValueInfo } from '../analyzer-types';
import type { Basis, TryIt } from '../basis';
import { pictureText } from '../ctlchars';
import type { Lang } from '../i18n';
import { type LabelPart, labelParts } from '../label';
import { LEVELS, type NoteLevel } from '../levels';
import { basisSaid, type BasisSaid, type FactId } from '../messages';
import type { TokenTextId } from '../messages-tokens';
import type { NameInfo } from '../namefacts';
import type { TokenRole } from '../roles';
import { markedText, type TextPart, textParts } from '../tokenmarks';
import { sameSpan } from './hoverParts';

/** What a view marks on a note or a row that rests on bash's behaviour (docs/design/basis.md, 3): the chip, and the try-it. */
export interface NoteBasis extends BasisSaid { tryIt: { code: string; output: string } }

/**
 * The basis a view marks on a fact, a token or a node of Reading (`basis`, `tryIt`: docs/design/basis.md, step 4), as
 * on a note: for `checked` and `differs` only, with the try-it.
 */
export function partBasis(x: { basis?: Basis; tryIt?: TryIt }, lang: Lang): NoteBasis | undefined {
  const said = basisSaid(lang, x.basis);
  if (!said) return undefined;
  // (A basis and its try-it come from the same probe row: one with a basis has a try-it, src/basis.ts.)
  const { code, output } = x.tryIt!;
  return { ...said, tryIt: { code, output } };
}

/** What a token's row holds. */
export interface TokenRow {
  /** Its kind, which the outputs' tables of colours read until there is one such table (docs/design/sources.md, SC10). */
  kind: Kind;
  /** The colour role of its kind (src/roles.ts). */
  role: TokenRole;
  /** A regex capture group (or a reference to one), coloured alike wherever it shows. */
  group?: number;
  /** The label as plain text, for a name (`‹name›` for a placeholder). */
  label: string;
  /** The label as code and placeholders (`if` *condition* `then`). */
  labelParts: readonly LabelPart[];
  /** What it means (marked text: code in backticks), with the level's mark before each warning in it. */
  text: string;
  /** The same text cut at its warnings, for a view that draws each mark in its level's look (src/ui/panelRows.ts). */
  parts: readonly TextPart[];
  /** The texts of the catalog of token texts it says. */
  texts?: readonly TokenTextId[];
  /** The warnings in its text: each with its id, its level and its text. */
  marks?: readonly TokenMark[];
  /** The strongest level of its warnings. */
  level?: NoteLevel;
  /** The facts of the catalog of notes the line says about this part. */
  facts?: readonly FactId[];
  /** What its command name is, and who looks it up. */
  name?: NameInfo;
  /** The value of the expansion where it runs. */
  value?: ValueInfo;
  /** Where its command reads that value in a language of its own: the rows of that reading, under the value's line (`valueRows`). */
  reading?: ValueRows;
  /** The references it cites. */
  refs?: readonly string[];
  /** The chip and the try-it of what it rests on, where that is bash's behaviour rather than the manual. */
  basis?: NoteBasis;
  /** How a pipeline's connector names the command, where its label is not enough (`[ -f c ]` for the command `[`: `Token.stage`). */
  stage?: string;
}

/** A row of the reading of a known value (`ValueReading`): a token's row, with the rows of the tokens under it. */
export interface ReadingRow extends TokenRow { children: readonly ReadingRow[] }

/** The reading of a known value as rows: the text above them, where it assumes no file name matches (`ValueSaid.readingLead`), and the rows. */
export interface ValueRows { lead?: string; rows: readonly ReadingRow[] }

/** The strongest level among warnings. */
export const strongestLevel = (marks: readonly TokenMark[] | undefined): NoteLevel | undefined => marks?.map((m) => m.level).sort((a, b) => LEVELS[a].rank - LEVELS[b].rank)[0];

/** The row of a token. */
export function tokenRow(tok: Token, lang: Lang): TokenRow {
  return {
    kind: tok.kind,
    // (Every token of a line has it by now: `markTokens`.)
    role: tok.role!,
    group: tok.group,
    label: tok.label,
    labelParts: labelParts(tok),
    text: markedText(tok),
    parts: textParts(tok),
    texts: tok.texts,
    marks: tok.marks,
    level: strongestLevel(tok.marks),
    facts: tok.facts,
    name: tok.name,
    value: tok.value,
    ...valueRows(tok.value, lang),
    refs: tok.refs,
    basis: partBasis(tok, lang),
    ...(tok.stage ? { stage: tok.stage } : {}),
  };
}

/** The value of the expansion a part is, also when the part is a word made of it alone: the token of the same range holds it. */
function valueOf(tok: Token): ValueInfo | undefined {
  const same = tok.children.find((c) => sameSpan(c.span, tok.span));
  return tok.value ?? (same && valueOf(same));
}

/**
 * The row of a part as a view that folds a child of the same range shows it (the hover: `shown`): with the value of the
 * expansion it is made of alone (`$msg` as an argument), which the child it leaves out holds.
 */
export const partRow = (tok: Token, lang: Lang): TokenRow => {
  const value = valueOf(tok);
  return { ...tokenRow(tok, lang), value, ...valueRows(value, lang) };
};

/** The rows of the reading of a value (`ValueInfo.reading`), each as a token's row, with its parts. */
function valueRows(value: ValueInfo | undefined, lang: Lang): { reading?: ValueRows } {
  if (!value?.reading) return {};
  const row = (t: Token): ReadingRow => ({ ...tokenRow(t, lang), children: t.children.map(row) });
  return { reading: { ...(value.said.readingLead ? { lead: value.said.readingLead } : {}), rows: value.reading.tokens.map(row) } };
}

/** A row's text with what its command name is, for an output with no badge (the hover's plain form, Markdown, the CLI): "Print arguments to stdout (builtin)". */
export const rowPlain = (r: TokenRow): string => pictureText(r.name ? r.text + r.name.said.short : r.text);
