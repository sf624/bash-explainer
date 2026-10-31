// The script's name on the page: in the editor's header and as the menu's first row (docs/design/chrome-redesign.md,
// C4). Muted while the script was never saved or opened, ● after it while a file has changes not saved; a click (or
// ⋯ › Rename…) turns it into a field, where Enter or leaving it renames and Escape keeps the old name. What it shows
// comes from src/ui/fileName.ts; this module draws it and wires the field.
import type { Lang } from '../src/i18n';
import { FileNameView, MAX_NAME, nameParts, stemEnd, typedName } from '../src/ui/fileName';
import { TEXT } from './text';

/** The two places of the name: the button, its parts, its dot and its field. */
const PLACES = [
  { button: 'file-name', stem: 'file-name-stem', ext: 'file-name-ext', dot: 'file-dot', input: 'file-name-input' },
  { button: 'menu-file', stem: 'menu-file-name', ext: undefined, dot: 'menu-file-dot', input: 'menu-file-input' },
] as const;

export interface NameHost {
  lang(): Lang;
  /** The name's state now. */
  view(): FileNameView;
  /** Gives the script the name typed (already cleaned, and not the current one). */
  rename(next: string): void;
}

export class FileNameControl {
  constructor(private readonly host: NameHost) {
    for (const place of PLACES) this.wire(place.button, place.input);
  }

  /** Draws the name in both places, with its state in words for a screen reader and in the tooltip. */
  show(): void {
    const v = this.host.view();
    const t = TEXT[this.host.lang()];
    const label = t.renameName(`${v.name}${v.muted ? t.notSavedYet : v.dot ? t.unsaved : ''}`);
    for (const place of PLACES) {
      const button = document.getElementById(place.button);
      if (!button) continue;
      // The header cuts a long stem with "…" and keeps the extension; the menu's row has the room for the whole name.
      const [stem, ext] = place.ext ? nameParts(v.name) : [v.name, ''];
      button.querySelector(`#${place.stem}`)!.textContent = stem;
      if (place.ext) button.querySelector(`#${place.ext}`)!.textContent = ext;
      (button.querySelector(`#${place.dot}`) as HTMLElement).hidden = !v.dot;
      button.classList.toggle('draft', v.muted);
      button.setAttribute('aria-label', label);
      button.title = label;
    }
  }

  /** Starts renaming in the header (⋯ › Rename…). */
  start(): void {
    this.edit(document.getElementById('file-name')!, document.getElementById('file-name-input') as HTMLInputElement);
  }

  /** Turns a name's button into its field, with the stem selected. */
  private edit(button: HTMLElement, input: HTMLInputElement): void {
    const name = this.host.view().name;
    input.value = name;
    input.setAttribute('aria-label', TEXT[this.host.lang()].fileNameField);
    input.maxLength = MAX_NAME;
    input.style.width = `${Math.min(28, Math.max(8, name.length + 2))}ch`;
    button.hidden = true;
    input.hidden = false;
    input.focus();
    input.setSelectionRange(0, stemEnd(name));
  }

  private wire(buttonId: string, inputId: string): void {
    const button = document.getElementById(buttonId);
    const input = document.getElementById(inputId) as HTMLInputElement | null;
    if (!button || !input) return;
    const end = (commit: boolean) => {
      if (input.hidden) return;
      const hadFocus = document.activeElement === input;
      const next = commit ? typedName(input.value, this.host.view().name) : undefined;
      input.hidden = true;
      button.hidden = false;
      if (next) this.host.rename(next);
      if (hadFocus) button.focus();
    };
    button.addEventListener('click', () => this.edit(button, input));
    input.addEventListener('input', () => {
      input.style.width = `${Math.min(28, Math.max(8, input.value.length + 2))}ch`;
    });
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== 'Escape') return;
      // Enter that confirms an IME conversion (Japanese, Chinese, Korean) is not the end of the rename; keyCode 229 is
      // what Safari reports for it after the composition has ended.
      if (e.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      // Escape here keeps the old name; it does not close the menu around the field.
      e.stopPropagation();
      end(e.key === 'Enter');
    });
    // Leaving the field (a click elsewhere, Tab) keeps what was typed, as a rename in a file manager does.
    input.addEventListener('blur', () => end(true));
  }
}
