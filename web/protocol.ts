// The messages between the compare page and the copies of this page in panel mode, and the theme they share.
import type { Span } from '../src/analyzer';
import type { Shell } from '../src/dialect';
import type { Lang } from '../src/i18n';
import type { Kind } from './samples';

export const THEMES = ['auto', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

/** What a copy of the page in panel mode says about itself when it is ready. */
export interface CopyInfo { channel: 'release' | 'next' | 'pr'; version: string; pr: string; commit: string }
/** What the compare page sends to a copy in panel mode: everything the page would have read from its own editor. */
export interface CopyState {
  text: string; kind: Kind; line: number; col: number; lang: Lang; theme: Theme; choice: { shell?: Shell; yq?: string };
  /** The settings that differ from the defaults (copies built before the settings dialog read `choice` only). */
  settings?: Record<string, unknown>;
}
/** From the compare page to a copy. */
export type ToCopy = { type: 'bx-state' } & CopyState;
/** From a copy to the compare page: the handshake, then what a click in its panel asks of the editor. */
export type FromCopy =
  | ({ type: 'bx-ready' } & CopyInfo)
  | { type: 'bx-reveal'; span: Span; preserveFocus?: boolean }
  | { type: 'bx-highlight'; span: Span | null }
  | { type: 'bx-choice'; key: 'shell' | 'yq'; value: string };
