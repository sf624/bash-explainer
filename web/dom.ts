// Small helpers for the elements of the page (the compare page has fewer of them than the main page).

/** An element the page is known to have. */
export const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/** Sets the text of an element the page has. */
export function put(id: string, text: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

/** Adds a listener to an element the page has. */
export function on(id: string, type: string, fn: (e: Event) => void): void {
  document.getElementById(id)?.addEventListener(type, fn);
}
