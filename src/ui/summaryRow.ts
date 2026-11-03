import type { LineExplanation } from '../analyzer-types';
import { type DocumentIssue, plain } from '../document';
import type { Lang } from '../i18n';
import { LEVELS, type NoteLevel, problemLevel, problemLevels } from '../levels';
import { ui } from './texts';

// The phone's summary row of the cursor's line (docs/design/chrome-redesign.md, step C8b): one line under the sheet's
// tabs row when it is folded, and alone on the keyboard's top while the user types. The page (web/sheet.ts) draws it
// after "Ln 20" and cuts it at the row's end; a tap shows the explanation.

export interface SummaryRow {
  /** The level of the problem the row shows; none for the line's sentence. */
  level?: NoteLevel;
  /** The level's mark (the level table), or '' with no problem. */
  mark: string;
  /** What follows the mark, as plain text: code without its backticks. */
  text: string;
}

/**
 * The row of line `line`: its first problem of those the Problems list shows (`problems`, the list itself, which has
 * decided what is turned off), the highest level first and then from the left, in the list's words ("Pitfall: …", an
 * error without "Error:"); else its "In short" sentence (`LineExplanation.sentence`, on every line with code); else the
 * line's summary (`LineExplanation.summary`: what a comment or a shebang is); else that there is nothing to explain.
 */
export function summaryRow(ex: LineExplanation, problems: readonly DocumentIssue[], line: number, lang: Lang): SummaryRow {
  const [first] = problems.filter((i) => i.startLine === line).sort((a, b) => problemLevel(a.severity).rank - problemLevel(b.severity).rank || a.startCol - b.startCol);
  if (first) {
    const [level] = problemLevels([first.severity]);
    return { level, mark: LEVELS[level].mark, text: plain(first.message, { backticks: false }) };
  }
  return { mark: '', text: plain(ex.sentence ?? (ex.summary || ui[lang].empty), { backticks: false }) };
}
