// Where a note is about (docs/design/hover.md, "Notes"): the range of the node a note was found on. The notes are
// still strings (the bridge of docs/design/note-levels.md), so an anchor ties a note's text to a range; the part
// hover shows only the notes about the part.
import type { NoteAnchor, Span } from './analyzer-types';
import type { Point } from './syntax/tree';

/** What has a place in the script: a node, or the place of a dialect issue. */
export interface Placed { readonly startPosition: Point; readonly endPosition: Point }

export function spanOf(n: Placed): Span {
  return {
    start: { line: n.startPosition.row, character: n.startPosition.column },
    end: { line: n.endPosition.row, character: n.endPosition.column },
  };
}

/** The texts of notes found on nodes, each once, in the order found; each is recorded in `anchors` with its node's range. */
export function anchored(found: readonly { text: string; node?: Placed }[], anchors: NoteAnchor[]): string[] {
  for (const f of found) if (f.node) anchors.push({ text: f.text, span: spanOf(f.node) });
  return [...new Set(found.map((f) => f.text))];
}
