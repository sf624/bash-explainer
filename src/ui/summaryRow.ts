import type { LineExplanation } from '../analyzer-types';
import { plain } from '../document';
import type { Lang } from '../i18n';
import { LEVELS, type NoteLevel } from '../levels';
import { isProblemNote, problemText } from '../messages';
import { notesByLevel, ui } from './render';

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
 * The row of a line: its first problem by level (`notesByLevel`: an error, a pitfall, then a caveat; `isProblemNote`),
 * in the words of the Problems list (`problemText`: "Pitfall: …", an error without "Error:"); else its "In short" sentence (`LineExplanation.sentence`, on every line
 * with code); else the line's summary (`LineExplanation.summary`: what a comment or a shebang is); else that there is
 * nothing to explain.
 */
export function summaryRow(ex: LineExplanation, lang: Lang): SummaryRow {
  const problem = notesByLevel(ex).find(isProblemNote);
  if (problem) return { level: problem.level, mark: LEVELS[problem.level].mark, text: plain(problemText(problem, lang), { backticks: false }) };
  return { mark: '', text: plain(ex.sentence ?? (ex.summary || ui[lang].empty), { backticks: false }) };
}
