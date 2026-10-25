// The Codicons the page shares with the VS Code panel: media/icons.js, loaded before app.js (as icons.js), holds
// the one table of them and draws them. The page uses them for the actions the panel has too, so that an action
// shows the same icon in both; its other icons are its own (web/index.html).

interface Icons {
  ICONS: Record<string, (string | string[])[]>;
  drawIcon(svg: Element, name: string): void;
  drawIcons(root: ParentNode): void;
}

const icons = (): Icons => (globalThis as unknown as { BashExplainerIcons: Icons }).BashExplainerIcons;

/** Draws the icon `name` in `svg` (an <svg viewBox="0 0 16 16">). */
export function drawIcon(svg: Element, name: string): void {
  icons().drawIcon(svg, name);
}

/** Draws every <svg data-icon="…"> of the page. */
export function drawIcons(): void {
  icons().drawIcons(document);
}

/**
 * The icon `name` as a CSS image (`url("data:…")`), for a mask that takes the colour of `background-color`: where
 * CodeMirror draws an element we do not make (the lint gutter's markers).
 */
export function iconMask(name: string): string {
  const paths = icons().ICONS[name].map((p) => {
    const [d, rule] = Array.isArray(p) ? p : [p];
    return `<path d="${d}"${rule ? ` fill-rule="${rule}"` : ''}/>`;
  }).join('');
  return `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">${paths}</svg>`)}")`;
}
