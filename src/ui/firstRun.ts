// What a touch screen's first visit shows (docs/design/chrome-redesign.md, C8): the mode it starts in, and whether the
// tip of the Read | Edit switch is due. The page keeps the choice of a mode (web/read-edit.ts); this is only the decision.

/**
 * Whether the page starts in Read mode (the on-screen keyboard stays hidden while lines are tapped to read their
 * explanations). A mode the user chose stands (`stored`: '1' Read, '0' Edit). With no choice, a touch screen starts in
 * Read while the page shows the untouched sample, which is for reading: the first tap on a line then shows its
 * explanation, and does not fold the sheet behind the keyboard. A script that is not the sample (a link, a file) and a
 * screen with a mouse start in Edit, as before. Nothing in the text of the script changes a mode afterwards.
 */
export function startInRead(stored: string | null | undefined, touch: boolean, sample: boolean): boolean {
  if (stored === '1') return true;
  if (stored === '0') return false;
  return touch && sample;
}

/**
 * Whether the first-run tip under the Read | Edit switch is due: on a touch screen, in Edit mode, until it was closed or
 * the switch used. In Read mode there is nothing to point at (the sample's own hint says how to type).
 */
export function tipDue(touch: boolean, read: boolean, seen: boolean): boolean {
  return touch && !read && !seen;
}
