// What the editor scrolls into view when the room around it changes (web/editor.ts `keepCursorInView`): the cursor's whole line
// when it fits in the room, so that the reader sees the line the explanation is about; else the cursor, which is where a
// reader types (a wrapped line taller than the room would otherwise scroll its end out of view while typing).

/** What to bring into view: the cursor's line (all the rows it wraps to) or the cursor alone. */
export function viewTarget(lineHeight: number, room: number): 'line' | 'cursor' {
  return lineHeight <= room ? 'line' : 'cursor';
}
