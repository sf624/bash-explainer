// Everything the web page keeps in the browser (localStorage), in one place: the settings dialog's
// "Clear stored data" removes exactly these. A new key goes here (the clear-data test in test/web-phone.test.ts fails on a
// 'bash-explainer-…' key anywhere else in web/).
//
// The page works without storage (a private window, blocked site data): every access to localStorage is in
// this file, in one try/catch each, and a refusal leaves the page with what it has until it is closed.

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
  /** The height of the Problems list under the editor, and whether it is folded away. */
  problems: 'bash-explainer-problems',
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
}
