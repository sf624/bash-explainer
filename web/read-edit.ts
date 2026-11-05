// Read | Edit, in the strip above the editor on a touch screen (docs/design/chrome-redesign.md, step C8a): in Read mode
// a tap on the script places the cursor without the on-screen keyboard, to read the explanation of the line tapped.
// The choice is kept in this browser. A first-run tip points at the switch until it is closed or the switch is used.
// Which mode a page starts in, and how it follows the script before a choice, is src/ui/firstRun.ts.
import type { Lang } from '../src/i18n';
import { modeChosen, readAsTextChanges, type Showing, startInRead, tipDue } from '../src/ui/firstRun';
import { touchScreen } from './layout';
import { readStored, STORAGE_KEYS, writeStored } from './storage';
import { TEXT } from './text';

export interface ReadEditHost {
  /** The editor follows the mode. */
  set(read: boolean): void;
  /** The tip went: the first visit's hint over the editor, which waits for it, may show (one at a time). */
  tipGone(): void;
  /** What the editor holds now: the start's mode follows it while no mode is chosen (`readAsTextChanges`). */
  showing(): Showing;
}

export class ReadEdit {
  /** Read mode is on: the user's choice, or with none, Read on a touch screen while the sample shows (`startInRead`). */
  read: boolean;
  /** The page started in Read with no mode chosen: the mode follows the script until the switch is used. */
  private follows: boolean;
  /** The tip was closed in this page (storage may refuse to keep it). */
  private tipClosed = false;
  private readonly group = document.getElementById('read-edit');
  private readonly tip = document.getElementById('readtip');

  /** `page`: this page has the switch (the editor's page, not compare.html or a panel copy); `sample`: it starts with a sample. */
  constructor(private readonly host: ReadEditHost, private readonly page: boolean, sample: boolean) {
    const stored = readStored(STORAGE_KEYS.readMode);
    this.read = startInRead(stored, this.hasSwitch(), sample);
    this.follows = this.read && !modeChosen(stored);
    for (const [id, read] of [['mode-read', true], ['mode-edit', false]] as const) {
      document.getElementById(id)?.addEventListener('click', () => {
        this.hideTip(true);
        if (read !== this.read) this.choose(read);
      });
    }
    document.getElementById('readtip-close')?.addEventListener('click', () => this.hideTip(true));
    window.addEventListener('resize', () => this.placeTip());
    // (The strip moves with the app bar, when it slides away and back.)
    document.querySelector('header.top')?.addEventListener('transitionend', () => this.placeTip());
    this.show();
    this.showTip();
  }

  /** Where the switch shows: only there may the editor hide the keyboard. */
  private hasSwitch(): boolean {
    return this.page && touchScreen();
  }

  private choose(read: boolean): void {
    this.follows = false;
    this.set(read);
    writeStored(STORAGE_KEYS.readMode, read ? '1' : '0');
  }

  private set(read: boolean): void {
    this.read = read;
    this.host.set(read);
    this.show();
  }

  /** The script changed. */
  textChanged(): void {
    if (!this.follows) return;
    const read = readAsTextChanges(this.read, this.host.showing());
    if (read !== this.read) this.set(read);
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

  /** The stored data was cleared: as a first visit with this script, in its mode (`startInRead`) and with the tip if it is due. */
  reset(): void {
    this.tipClosed = false;
    const read = startInRead(null, this.hasSwitch(), this.host.showing() === 'sample');
    this.follows = read;
    this.set(read);
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
    this.tipClosed = true;
    if (this.tip) this.tip.hidden = true;
    if (remember) writeStored(STORAGE_KEYS.readTipSeen, '1');
    this.host.tipGone();
  }

  /** Shows the tip, if it is due (`tipDue`: the switch shows, Read is not on, and the tip was not seen). */
  private showTip(): void {
    if (!this.tip || !tipDue(this.hasSwitch(), this.read, this.tipClosed || readStored(STORAGE_KEYS.readTipSeen) === '1')) return;
    this.tip.hidden = false;
    this.placeTip();
  }

  tipShown(): boolean {
    return this.tip?.hidden === false;
  }
}
