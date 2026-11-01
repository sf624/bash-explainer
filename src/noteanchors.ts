// Where a note is about (docs/design/hover.md, "Notes"): the range of the node a note was found on. The line's notes
// are texts (`LineExplanation.notes`) beside their data (`LineExplanation.noteInfo`), so an anchor ties a note's text
// to a range; the part hover shows only the notes about the part, and the problems are made from them.
import type { NoteAnchor, Pos, Span } from './analyzer-types';
import { conventionOf, type Note } from './messages';
import type { Rewrite } from './rewrite';
import type { Point } from './syntax/tree';

/** What has a place in the script: a node, or the place of a dialect issue. */
export interface Placed { readonly startPosition: Point; readonly endPosition: Point }

export function spanOf(n: Placed): Span {
  return {
    start: { line: n.startPosition.row, character: n.startPosition.column },
    end: { line: n.endPosition.row, character: n.endPosition.column },
  };
}

const atOrBefore = (a: Pos, b: Pos): boolean => a.line < b.line || (a.line === b.line && a.character <= b.character);
/** Whether the range `inner` lies within `outer` (the same range too). */
export const spanWithin = (inner: Span, outer: Span): boolean => atOrBefore(outer.start, inner.start) && atOrBefore(inner.end, outer.end);
/** Whether two ranges are the same. */
export const sameSpan = (a: Span, b: Span): boolean => spanWithin(a, b) && spanWithin(b, a);

/**
 * A note found on a node (none: about the line), with the rewrites it suggests there (`Fact.rewrite`, `StyleFinding.rewrite`).
 * Every note said on a line has a code: a fact's id, a style check's, a dialect issue's (docs/design/sources.md, SB3a).
 */
export type Found = Note & { code: string; node?: Placed; rewrite?: readonly Rewrite[] };

/**
 * The texts of notes found on nodes, each once, in the order found; each is recorded in `anchors` with its node's
 * range (and its problem's code, and the rewrites it suggests at that place: the quick fixes of the problem), and its
 * data in `data` (by its text).
 */
export function anchored(found: readonly Found[], anchors: NoteAnchor[], data: Map<string, Note>): string[] {
  for (const f of found) {
    if (f.node) anchors.push({ text: f.text, span: spanOf(f.node), code: f.code, ...(f.rewrite?.length ? { rewrite: f.rewrite } : {}) });
    if (!data.has(f.text)) data.set(f.text, { text: f.text, level: f.level, label: f.label, body: f.body, code: f.code, ...conventionOf(f) });
  }
  return [...new Set(found.map((f) => f.text))];
}
