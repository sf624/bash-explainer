// The notice to a user who had the inline summary on, which was removed (docs/design/hover.md). Pure code: the
// extension asks it whether to show the notice, and what it says.
import type { Lang } from '../i18n';
import { ui } from './texts';

/** The key in VS Code's global state that remembers "Don't show again". */
export const INLINE_NOTICE_KEY = 'bashExplainer.inlineRemovedNotice.dismissed';

/** The values of `bashExplainer.inline.enabled` in each scope (VS Code's `inspect`). */
export interface Scoped<T> { globalValue?: T; workspaceValue?: T; workspaceFolderValue?: T }

/** Whether to tell the user: the setting is on in some scope, and the notice was not dismissed for good. */
export function inlineNoticeDue(inline: Scoped<unknown> | undefined, dismissed: unknown): boolean {
  return !dismissed && !!inline && [inline.globalValue, inline.workspaceValue, inline.workspaceFolderValue].includes(true);
}

/** What the notice says (plain text: a notification shows no Markdown), and its buttons. */
export function inlineNotice(lang: Lang): { message: string; open: string; dismiss: string } {
  return ui[lang].inlineNotice;
}
