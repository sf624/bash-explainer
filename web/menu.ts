// The words of the menu (its groups: Script; Share and Explanation, stacked only; Preferences; Help; About) and of the
// app bar's "Copy a link" (docs/design/chrome-redesign.md, C4). The menu's items are wired in web/main.ts.
import type { Lang } from '../src/i18n';
import { confirming, shortcut } from './editor-head';
import { isMac } from './file-io';
import { TEXT } from './text';

export function showMenuTexts(lang: Lang): void {
  const t = TEXT[lang];
  const put = (id: string, text: string) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };
  for (const [id, text] of [
    ['menu-h-script', t.menuScript], ['menu-h-share', t.menuShare], ['menu-h-explanation', t.menuExplanation],
    ['menu-h-prefs', t.menuPrefs], ['menu-h-help', t.menuHelp], ['menu-h-about', t.menuAbout], ['menu-keys-title', t.keys],
    ['menu-clear-label', t.clear], ['menu-copy-script-label', t.copyScript], ['share-note', t.shareNote],
  ]) put(id, text);
  // Help: every key of the page, with ⌘ on a Mac.
  document.getElementById('menu-keys')?.replaceChildren(...t.keyRows(isMac() ? '⌘' : 'Ctrl+').flatMap(([keys, what]) => [
    Object.assign(document.createElement('dt'), { textContent: keys }),
    Object.assign(document.createElement('dd'), { textContent: what }),
  ]));
  // "Copy a link" says what it copies in words; its tooltip says where the script is in the link. (While it says "Copied", its words wait.)
  const share = document.getElementById('share');
  if (share && document.getElementById('share-label')) {
    if (!confirming(share)) put('share-label', t.copyLink);
    share.title = t.shareNote;
  }
  const menuShare = document.getElementById('menu-share');
  if (menuShare && !confirming(menuShare)) put('menu-share-label', t.share);
  menuShare?.setAttribute('title', t.shareNote);
  put('menu-open-key', shortcut('O'));
  put('menu-save-key', shortcut('S'));
}

/** The words a "Copy a link" button goes back to after "Copied". */
export function linkWords(id: 'share' | 'menu-share', lang: Lang): string {
  return id === 'share' ? TEXT[lang].copyLink : TEXT[lang].share;
}
