// The notice to a user who had the inline summary on, which was removed (docs/design/hover.md). Pure code: the
// extension asks it whether to show the notice, and what it says.
import type { Lang } from '../i18n';

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
  return lang === 'ja'
    ? {
      message: 'インライン要約は削除され、bashExplainer.inline.enabled には効果がなくなりました。単語にマウスを乗せるとその解説、Ctrl+K Ctrl+E で行全体の解説を表示します。名前どおりのものを実行しないコマンド名にはヒントが付きます。',
      open: '設定を開く', dismiss: '今後表示しない',
    }
    : {
      message: 'The inline summary was removed, and bashExplainer.inline.enabled no longer has an effect. Hover a word for what it is, or press Ctrl+K Ctrl+E for the whole line; command names that do not run what they suggest get a hint.',
      open: 'Open settings', dismiss: "Don't show again",
    };
}
