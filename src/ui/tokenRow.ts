// One record per token (docs/design/sources.md, row 15, SB3c): what a token's row holds, whichever output draws it. The panel
// (media/panel.js `item`), the hover (src/ui/hoverView.ts), Markdown (src/ui/render.ts `toPlainMarkdown`) and the command line
// (cli/main.ts `textOutput`) read this record and differ only in the markup; test/row-source.test.ts fails on an output that reads
// a token's text by itself. The panel's row model (docs/design/panel-redesign.md, P7a) builds on it.
import type { Example, Kind, Span, Token, TokenMark, ValueInfo } from '../analyzer-types';
import type { Basis, TryIt } from '../basis';
import { pictureText } from '../ctlchars';
import type { Lang } from '../i18n';
import { type LabelPart, labelParts } from '../label';
import { LEVELS, type NoteLevel } from '../levels';
import { basisSaid, type BasisSaid, type FactId } from '../messages';
import type { TokenTextId } from '../messages-tokens';
import type { NameInfo } from '../namefacts';
import { KIND_ROLES, type TokenRole } from '../roles';
import { markedText } from '../tokenmarks';
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
  /** The references it cites. */
  refs?: readonly string[];
  /** The chip and the try-it of what it rests on, where that is bash's behaviour rather than the manual. */
  basis?: NoteBasis;
}

/** The row of a token. */
export function tokenRow(tok: Token, lang: Lang): TokenRow {
  return {
    kind: tok.kind,
    role: KIND_ROLES[tok.kind],
    group: tok.group,
    label: tok.label,
    labelParts: labelParts(tok),
    text: markedText(tok),
    texts: tok.texts,
    marks: tok.marks,
    level: tok.marks?.map((m) => m.level).sort((a, b) => LEVELS[a].rank - LEVELS[b].rank)[0],
    facts: tok.facts,
    name: tok.name,
    value: tok.value,
    refs: tok.refs,
    basis: partBasis(tok, lang),
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
export const partRow = (tok: Token, lang: Lang): TokenRow => ({ ...tokenRow(tok, lang), value: valueOf(tok) });

/** A row's text with what its command name is, for an output with no badge (the hover's plain form, Markdown, the CLI): "Print arguments to stdout (builtin)". */
export const rowPlain = (r: TokenRow): string => pictureText(r.name ? r.text + r.name.said.short : r.text);

/** A row as the panel gets it: the record, with the place it selects, the examples placed under it and its parts. */
export interface PanelRow extends TokenRow { span: Span; examples?: Example[]; children: PanelRow[] }

/** The rows of a line's tokens, for the panel (media/panel.js has no way to make them: it is plain script, and only draws). */
export function panelRows(items: readonly Token[], lang: Lang): PanelRow[] {
  return items.map((t) => ({ ...tokenRow(t, lang), span: t.span, examples: t.examples, children: panelRows(t.children, lang) }));
}
