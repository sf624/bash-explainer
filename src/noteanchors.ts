// Where a note is about (docs/design/hover.md, "Notes"): the range of the node a note was found on. The line's notes
// are texts (`LineExplanation.notes`) beside their data (`LineExplanation.noteInfo`), so an anchor ties a note's text
// to a range; the part hover shows only the notes about the part, and the problems are made from them.
import type { NoteAnchor, Span } from './analyzer-types';
import type { Note } from './messages';
import type { Point } from './syntax/tree';

/** What has a place in the script: a node, or the place of a dialect issue. */
export interface Placed { readonly startPosition: Point; readonly endPosition: Point }

export function spanOf(n: Placed): Span {
  return {
    start: { line: n.startPosition.row, character: n.startPosition.column },
    end: { line: n.endPosition.row, character: n.endPosition.column },
  };
}

/** A note found on a node (none: about the line). */
export type Found = Note & { node?: Placed };

/**
 * The texts of notes found on nodes, each once, in the order found; each is recorded in `anchors` with its node's
 * range (and its problem's code), and its data in `data` (by its text).
 */
export function anchored(found: readonly Found[], anchors: NoteAnchor[], data: Map<string, Note>): string[] {
  for (const f of found) {
    if (f.node) anchors.push({ text: f.text, span: spanOf(f.node), ...(f.code ? { code: f.code } : {}) });
    if (!data.has(f.text)) data.set(f.text, { text: f.text, level: f.level, label: f.label, body: f.body, ...(f.code ? { code: f.code } : {}), ...(f.headline ? { headline: f.headline } : {}), ...(f.fix ? { fix: f.fix } : {}) });
  }
  return [...new Set(found.map((f) => f.text))];
}
