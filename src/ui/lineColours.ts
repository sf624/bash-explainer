import type { LineExplanation } from '../analyzer-types';
import { KIND_ROLES, type TokenRole } from '../roles';
import { lineOwners } from './render';

/** A run of a line in one colour: characters `from` to `to` (0-based, in the line), and the role they take. */
export interface ColourRun { from: number; to: number; role: TokenRole }

/**
 * The colours of a line, from its explanation (docs/design/one-colour-source.md): each character takes the role of the
 * deepest token over it, as the panel's line box colours it (`lineOwners`, the panel's `lineRuns`). A run no token covers
 * (the blanks between words) has no colour. The editor colours its lines with these runs, so that a part has the same
 * colour in the editor and in the panel.
 */
export function lineColours(lineText: string, ex: LineExplanation): ColourRun[] {
  const out: ColourRun[] = [];
  for (const { from, to, owner } of lineOwners(lineText, ex.line, ex.items)) {
    if (!owner) continue;
    // (The role of its kind, as the panel's `.kind-*` rules colour it: `Token.role` is the same.)
    const role = KIND_ROLES[owner.kind];
    const last = out[out.length - 1];
    if (last && last.to === from && last.role === role) last.to = to;
    else out.push({ from, to, role });
  }
  return out;
}
