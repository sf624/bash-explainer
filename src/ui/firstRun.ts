// What a touch screen's first visit shows (docs/design/chrome-redesign.md, C8c): the mode it starts in, how that start
// follows the script while no mode is chosen, and whether the tip of the Read | Edit switch is due. The page keeps the
// mode (web/read-edit.ts); this is only the decision.

/** What the editor holds, as the start's mode reads it: nothing, a sample as the page loads it (web/kinds.ts), or a script. */
export type Showing = 'empty' | 'sample' | 'script';

/** Whether the user chose a mode with the switch (`stored`: '1' Read, '0' Edit). */
export const modeChosen = (stored: string | null | undefined): boolean => stored === '1' || stored === '0';

/**
 * Whether the page starts in Read mode (the on-screen keyboard stays hidden while lines are tapped to read their
 * explanations). Only where the switch shows (`hasSwitch`: a touch screen, on the editor's page): nothing else could leave
 * Read, and no keyboard could open. There a mode the user chose stands. With no choice, the page starts in Read while it
 * shows the untouched sample, which is for reading: the first tap on a line then shows its explanation, and does not fold
 * the sheet behind the keyboard. Any other script starts in Edit.
 */
export function startInRead(stored: string | null | undefined, hasSwitch: boolean, sample: boolean): boolean {
  if (!hasSwitch) return false;
  return modeChosen(stored) ? stored === '1' : sample;
}

/**
 * The mode of a page that started in Read with no mode chosen, as its script changes. An empty editor has nothing to
 * read and everything to type: Edit, so that a tap raises the keyboard, and it stays up as the first words are typed. The
 * sample again (Undo, Load the sample): Read. A script pasted, typed or opened changes nothing. A chosen mode never
 * comes here, and nothing here is stored.
 */
export function readAsTextChanges(read: boolean, showing: Showing): boolean {
  return showing === 'script' ? read : showing === 'sample';
}

/**
 * Whether the first-run tip under the Read | Edit switch is due: where the switch shows, in Edit mode, until it was closed
 * or the switch used. In Read mode there is nothing to point at (the sample's own hint says how to type).
 */
export function tipDue(hasSwitch: boolean, read: boolean, seen: boolean): boolean {
  return hasSwitch && !read && !seen;
}
