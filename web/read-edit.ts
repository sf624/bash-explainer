// Read | Edit, in the strip above the editor on a touch screen (docs/design/chrome-redesign.md, step C8a): in Read mode
// a tap on the script places the cursor without the on-screen keyboard, to read the explanation of the line tapped.
// The choice is kept in this browser. A first-run tip points at the switch until it is closed or the switch is used.
import type { Lang } from '../src/i18n';
import { readStored, STORAGE_KEYS, writeStored } from './storage';
import { TEXT } from './text';

export interface ReadEditHost {
  /** The editor follows the mode. */
  set(read: boolean): void;
  /** The tip went: the first visit's hint over the editor, which waits for it, may show (one at a time). */
  tipGone(): void;
}

export class ReadEdit {
  /** Read mode is on. */
  read = readStored(STORAGE_KEYS.readMode) === '1';
  private readonly group = document.getElementById('read-edit');
  private readonly tip = document.getElementById('readtip');

  constructor(private readonly host: ReadEditHost) {
    for (const [id, read] of [['mode-read', true], ['mode-edit', false]] as const) {
      document.getElementById(id)?.addEventListener('click', () => {
        this.hideTip(true);
        if (read !== this.read) this.choose(read);
      });
    }
    document.getElementById('readtip-close')?.addEventListener('click', () => this.hideTip(true));
    window.addEventListener('resize', () => this.placeTip());
    this.show();
    this.showTip();
  }

  private choose(read: boolean): void {
    this.read = read;
    this.host.set(read);
    this.show();
    writeStored(STORAGE_KEYS.readMode, read ? '1' : '0');
  }

  /** The words, the names and the tip's text in the page's language. */
  draw(lang: Lang): void {
    const t = TEXT[lang];
    this.group?.setAttribute('aria-label', t.readEdit);
    for (const [id, word, tip] of [['mode-read', t.readWord, t.readMode], ['mode-edit', t.editWord, t.editMode]]) {
      const b = document.getElementById(id);
      if (!b) continue;
      b.textContent = word;
      b.title = tip;
    }
    const text = document.getElementById('readtip-text');
    if (text) text.textContent = t.readTip;
    const close = document.getElementById('readtip-close');
    close?.setAttribute('aria-label', t.close);
    close?.setAttribute('title', t.close);
    this.placeTip();
  }

  private show(): void {
    document.getElementById('mode-read')?.setAttribute('aria-pressed', String(this.read));
    document.getElementById('mode-edit')?.setAttribute('aria-pressed', String(!this.read));
  }

  /** Back to Edit, and the tip shows again (the stored data was cleared). */
  reset(): void {
    this.read = false;
    this.host.set(false);
    this.show();
    this.showTip();
  }

  /** Puts the bubble under Read (below the banner too, on the development version and previews), its arrow at the middle of Read. */
  placeTip(): void {
    const read = document.getElementById('mode-read');
    if (!this.tip || !read || this.tip.hidden) return;
    const b = read.getBoundingClientRect();
    const width = this.tip.getBoundingClientRect().width;
    this.tip.style.top = `${b.bottom + 10}px`;
    // (Its left edge under Read, but never out of the window.)
    const left = Math.max(8, Math.min(b.left, window.innerWidth - 8 - width));
    this.tip.style.left = `${left}px`;
    this.tip.style.setProperty('--arrow-x', `${b.left + b.width / 2 - left}px`);
  }

  private hideTip(remember: boolean): void {
    if (this.tip) this.tip.hidden = true;
    if (remember) writeStored(STORAGE_KEYS.readTipSeen, '1');
    this.host.tipGone();
  }

  /** Shows the tip, if the switch shows (a coarse pointer) and the tip was not seen. */
  private showTip(): void {
    const read = document.getElementById('mode-read');
    if (!this.tip || !read || !window.matchMedia('(pointer: coarse)').matches || readStored(STORAGE_KEYS.readTipSeen) === '1') return;
    this.tip.hidden = false;
    this.placeTip();
  }

  tipShown(): boolean {
    return this.tip?.hidden === false;
  }
}
