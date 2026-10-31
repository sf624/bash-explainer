// The panel's line box (`#line`, drawn by media/panel.js) wraps a long line between shell words, as the web page's
// editor does (docs/design/chrome-redesign.md, C1b). The runs that must not break come from src/ui/wrapRuns.ts and
// travel in the panel's update message as parts of the line's text, so that media/panel.js draws a span per run
// without reading shell syntax. The breaking itself is the browser's: a run stays on one row (media/panel.css), the
// blanks between runs are where a row may end.
import type { ShellDocument } from '../document';
import type { SyntaxTree } from '../syntax/tree';
import { blankRuns, type Run, wrapRuns } from './wrapRuns';

/**
 * A part of the line box's text, as [from, to) columns of the line (UTF-16 code units): a run that stays on one row,
 * or the blanks between two runs (and before the first, after the last), where a row may end.
 */
export interface LinePart { from: number; to: number; run: boolean }

/** The runs of every line, per parse: the panel asks for one line at each move of the cursor. */
const known = new WeakMap<SyntaxTree, Run[][]>();

/**
 * The runs of a line of a document (src/ui/wrapRuns.ts). Without the document, or when its line is not the text shown
 * (a document parsed before the last edit), the line breaks at its blanks.
 */
export function lineRuns(doc: ShellDocument | undefined, line: number, text: string): Run[] {
  if (!doc || doc.lines[line] !== text) return blankRuns(text);
  let runs = known.get(doc.tree);
  if (!runs) known.set(doc.tree, (runs = wrapRuns(doc)));
  return runs[line];
}

/** The line's text cut into its runs and the blanks between them: every character in one part, in order. */
export function lineParts(text: string, runs: readonly Run[]): LinePart[] {
  const out: LinePart[] = [];
  let at = 0;
  for (const [from, to] of runs) {
    if (from > at) out.push({ from: at, to: from, run: false });
    out.push({ from, to, run: true });
    at = to;
  }
  if (text.length > at) out.push({ from: at, to: text.length, run: false });
  return out;
}

/**
 * Whether the line box wraps in VS Code: it follows the editor's `editor.wordWrap` for the document. "off" keeps one
 * row that scrolls sideways; "on", "wordWrapColumn" and "bounded" wrap (the box has no column of its own).
 */
export function wrapsLikeEditor(wordWrap: unknown): boolean {
  return typeof wordWrap === 'string' && wordWrap !== 'off';
}
