// The editor's header and what lies over the editor (docs/design/chrome-redesign.md, C4): Open, Save, the file name
// (web/file-name.ts) and ⋯ (Rename…, Copy the script, Load the sample, Clear the editor); the first visit's hint over
// the editor while it holds the sample; the empty editor's block (Paste a script, Open a file…, Load the sample); and
// "Copy a link", which says "Copied" on its own button. The page's state and its actions are web/main.ts's: this
// module draws and wires.
import type { Lang } from '../src/i18n';
import type { Editor } from './editor';
import { isMac } from './file-io';
import { FileNameControl } from './file-name';
import { popover } from './popover';
import { readStored, STORAGE_KEYS, writeStored } from './storage';
import { TEXT } from './text';

export interface HeadHost {
  lang(): Lang;
  editor: Editor;
  names: FileNameControl;
  openFile(): void;
  saveFile(): void;
  /** Loads the sample of the current kind (over the user's own text, as the page's "Load the sample" does). */
  loadSample(): void;
  clear(): void;
  copyScript(): void;
  /** Whether the editor holds a sample as the page loads it. */
  holdsSample(): boolean;
  /** Whether another first-run tip shows (the phone's read-mode switch): the hint waits for it. */
  tipShown(): boolean;
  /** Says something in the page's toast. */
  status(text: string): void;
}

/** A shortcut's key: ⌘S on a Mac, Ctrl+S elsewhere. */
export const shortcut = (key: string) => (isMac() ? `⌘${key}` : `Ctrl+${key}`);

/** Whether the screen has no mouse: a phone or a tablet (its texts say "tap", and it has no keys to show). */
const touchOnly = () => window.matchMedia('(hover: none) and (pointer: coarse)').matches;

export class EditorHead {
  private readonly hint = document.getElementById('first-hint');
  private readonly empty = document.getElementById('empty-editor');
  /** Closed in this page (storage may refuse to keep it). */
  private hintClosed = false;

  constructor(private readonly host: HeadHost) {
    const on = (id: string, fn: () => void) => document.getElementById(id)?.addEventListener('click', fn);
    on('open-btn', () => host.openFile());
    on('save-btn', () => host.saveFile());
    const more = document.getElementById('ed-more');
    const menu = document.getElementById('ed-more-menu');
    if (more && menu) popover(more, menu);
    on('more-rename', () => host.names.start());
    on('more-copy', () => host.copyScript());
    on('more-sample', () => host.loadSample());
    on('more-clear', () => host.clear());
    on('first-hint-close', () => this.closeHint());
    on('hint-own', () => {
      this.closeHint();
      host.clear();
    });
    on('hint-open', () => {
      this.closeHint();
      host.openFile();
    });
    // The empty editor's block and the hint on how to leave the editor (web/a11y.ts) lie over the editor's own box, under
    // the header and the first visit's hint.
    for (const over of [this.empty, document.getElementById('editor-hint')]) if (over) document.getElementById('editor')?.append(over);
    on('empty-paste', () => void this.paste());
    on('empty-open', () => host.openFile());
    on('empty-sample', () => host.loadSample());
  }

  /** Puts the header's, the hint's and the block's words in the page's language. */
  showTexts(): void {
    const t = TEXT[this.host.lang()];
    const put = (id: string, text: string) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    };
    put('open-btn-label', t.openShort);
    put('save-btn-label', t.save);
    put('more-rename-label', t.rename);
    put('more-copy-label', t.copyScript);
    put('more-sample-label', t.sample);
    put('more-clear-label', t.clear);
    put('first-hint-text', touchOnly() ? t.hintTouch : t.hintDesk);
    put('hint-own', t.useOwn);
    put('hint-open', t.openFile);
    put('empty-paste-label', touchOnly() ? t.paste : t.pasteScript);
    put('empty-paste-key', touchOnly() ? '' : shortcut('V'));
    put('empty-open-label', t.openFile);
    put('empty-sample-label', t.sample);
    put('empty-drop', t.orDrop);
    const open = document.getElementById('open-btn');
    if (open) {
      open.title = `${t.openTip} (${shortcut('O')})`;
      open.setAttribute('aria-keyshortcuts', isMac() ? 'Meta+O' : 'Control+O');
    }
    document.getElementById('save-btn')?.setAttribute('aria-keyshortcuts', isMac() ? 'Meta+S' : 'Control+S');
    for (const [id, name] of [['ed-more', t.more], ['first-hint-close', t.close]]) {
      document.getElementById(id)?.setAttribute('aria-label', name);
      document.getElementById(id)?.setAttribute('title', name);
    }
    this.host.names.show();
  }

  /** Follows the script: the name, Save's tooltip, the hint (while the editor holds the sample) and the empty block. */
  show(saveTitle: string): void {
    this.host.names.show();
    const save = document.getElementById('save-btn');
    if (save) save.title = `${saveTitle} (${shortcut('S')})`;
    this.showHint();
    if (this.empty) this.empty.hidden = this.host.editor.view.state.doc.length > 0;
  }

  /** The hint shows on a visit until it is closed or acted on, while the editor holds a sample and no other tip shows. */
  private showHint(): void {
    if (!this.hint) return;
    const show = !this.hintClosed && readStored(STORAGE_KEYS.firstHint) !== '1' && this.host.holdsSample() && !this.host.tipShown();
    if (this.hint.hidden === !show) return;
    this.hint.hidden = !show;
    this.host.editor.view.requestMeasure();
  }

  private closeHint(): void {
    // Without storage it shows again on the next visit.
    this.hintClosed = true;
    writeStored(STORAGE_KEYS.firstHint, '1');
    this.showHint();
  }

  /** "Paste a script": reads the clipboard (the browser may ask), and puts its text in as a paste, so that its kind is detected. */
  private async paste(): Promise<void> {
    const view = this.host.editor.view;
    let text: string | undefined;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      text = undefined;
    }
    if (text === undefined) {
      // Refused, or a browser without the API: the editor takes the focus, and the toast says which key pastes.
      view.focus();
      return this.host.status(TEXT[this.host.lang()].pasteRefused(shortcut('V')));
    }
    if (text) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, selection: { anchor: 0 }, userEvent: 'input.paste', scrollIntoView: true });
    view.focus();
  }
}

const confirmTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

/**
 * Confirms a copy on the button that made it (decision 8 of the design): its icon becomes ✓ and its words "Copied" for
 * about 2 s, at no less than its own width (nothing beside it moves), and the live region `said` says it in words. Then
 * the button takes its words again from `words` (the language may have changed meanwhile).
 */
export function confirmCopied(button: HTMLElement, lang: Lang, said: HTMLElement | null, words: () => string): void {
  const t = TEXT[lang];
  const label = button.querySelector<HTMLElement>('span[id$="-label"]')!;
  const icon = button.querySelector('use')!;
  if (!confirmTimers.has(button)) button.style.minWidth = `${button.getBoundingClientRect().width}px`;
  clearTimeout(confirmTimers.get(button));
  label.textContent = t.linkCopied;
  icon.setAttribute('href', '#i-check');
  button.classList.add('copied');
  if (said) {
    // A change of text is what a live region says: emptied first, so that a second copy is said again.
    said.textContent = '';
    setTimeout(() => { said.textContent = t.linkCopiedSaid; }, 50);
  }
  confirmTimers.set(button, setTimeout(() => {
    confirmTimers.delete(button);
    label.textContent = words();
    icon.setAttribute('href', '#i-link');
    button.classList.remove('copied');
    button.style.minWidth = '';
    if (said) said.textContent = '';
  }, 2000));
}

/** Whether a button is saying "Copied" now (its words then wait until it is done). */
export const confirming = (button: HTMLElement | null) => !!button && confirmTimers.has(button);
