// Everything the web page keeps in the browser (localStorage), in one place: the settings dialog's
// "Clear stored data" removes exactly these. A new key goes here (test/web.test.ts fails on a
// 'bash-explainer-…' key anywhere else in web/).

export const STORAGE_KEYS = {
  /** The settings that differ from the defaults. */
  settings: 'bash-explainer-settings',
  /** The theme chosen (theme-init.js reads it before the first paint; it is a plain script and repeats the name). */
  theme: 'bash-explainer-theme',
  /** Read mode on a touch screen. */
  readMode: 'bash-explainer-read-mode',
  /** The first-run tip of the read-mode button was seen. */
  readTipSeen: 'bash-explainer-read-tip-seen',
  /** The share of the editor in the page, side by side and one above the other. */
  split: 'bash-explainer-split',
} as const;

/** Removes everything the page keeps. Without storage there is nothing to remove. */
export function clearStoredData(): void {
  try {
    for (const key of Object.values(STORAGE_KEYS)) localStorage.removeItem(key);
  } catch {
    // No storage, or it refuses.
  }
}
