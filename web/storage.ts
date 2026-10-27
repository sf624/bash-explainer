// Everything the web page keeps in the browser (localStorage), in one place: the settings dialog's
// "Clear stored data" removes exactly these. A new key goes here (the clear-data test in test/web-phone.test.ts fails on a
// 'bash-explainer-…' key anywhere else in web/).
//
// The page works without storage (a private window, blocked site data): every access to localStorage is in
// this file, in one try/catch each, and a refusal leaves the page with what it has until it is closed. The one
// exception is web/theme-init.js, a plain script that reads the theme before the first paint (and repeats its
// key); test/web-storage.test.ts exempts it.

export const STORAGE_KEYS = {
  /** The settings that differ from the defaults. */
  settings: 'bash-explainer-settings',
  /** The theme chosen (theme-init.js reads it before the first paint; it is a plain script and repeats the name). */
  theme: 'bash-explainer-theme',
  /** The shapes of the screens seen as a phone's, so that a page loaded zoomed out keeps the phone layout (theme-init.js repeats the name). */
  phoneScreens: 'bash-explainer-phone-screens',
  /** Read mode on a touch screen. */
  readMode: 'bash-explainer-read-mode',
  /** The first-run tip of the read-mode button was seen. */
  readTipSeen: 'bash-explainer-read-tip-seen',
  /** The first-run hint over the editor was closed (prototype). */
  firstHint: 'bash-explainer-first-hint',
  /** The share of the editor in the page, side by side and one above the other. */
  split: 'bash-explainer-split',
  /** The height of the Problems list under the editor, and whether it is folded away. */
  problems: 'bash-explainer-problems',
  /** The panel's view (the list or the tree) and the step its tree shows (src/ui/panelView.ts `PanelState`). */
  panel: 'bash-explainer-panel',
  /** The settings dialog shows the VS Code names of the settings (prototype; off by default). */
  settingNames: 'bash-explainer-setting-names',
  /** The phone's one-time hint that a tap on the sheet's bar changes its height was seen (prototype). */
  sheetHint: 'bash-explainer-sheet-hint',
} as const;

/** The value kept under `key`: null when there is none, undefined when storage is unavailable. */
export function readStored(key: string): string | null | undefined {
  try {
    return localStorage.getItem(key);
  } catch {
    return undefined;
  }
}

/** The object kept as JSON under `key`; an empty one when there is none, it is not readable, or storage is unavailable. */
export function readStoredObject<T extends object>(key: string): T {
  try {
    const v = JSON.parse(readStored(key) ?? '{}');
    return v && typeof v === 'object' ? v : ({} as T);
  } catch {
    return {} as T;
  }
}

/** Keeps a value; false when storage refuses. */
export function writeStored(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/** Forgets a value; false when storage refuses. */
export function removeStored(key: string): boolean {
  try {
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

/** Removes everything the page keeps. Without storage there is nothing to remove. */
export function clearStoredData(): void {
  for (const key of Object.values(STORAGE_KEYS)) removeStored(key);
  try {
    sessionStorage.removeItem(SESSION_LINK);
    sessionStorage.removeItem(SESSION_OPENING);
  } catch {
    // Nothing kept, nothing to remove.
  }
}

/**
 * What a tab keeps for itself (sessionStorage), not for the next visit: the fragment of the link the tab was opened with
 * (theme-init.js reads it too, to leave the opening out, and repeats the name).
 */
const SESSION_LINK = 'bash-explainer-shared-link';
/** The opening was shown in this tab, so later loads show none (theme-init.js sets and reads it before the first paint, and repeats the name). */
const SESSION_OPENING = 'bash-explainer-opening';

/** The link fragment this tab kept; null when none, or when session storage is unavailable. */
export function readSessionLink(): string | null {
  try {
    return sessionStorage.getItem(SESSION_LINK);
  } catch {
    return null;
  }
}

/** Keeps the link fragment for a reload of this tab; false when session storage refuses. */
export function writeSessionLink(fragment: string): boolean {
  try {
    sessionStorage.setItem(SESSION_LINK, fragment);
    return true;
  } catch {
    return false;
  }
}
