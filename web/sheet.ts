// The phone's bottom sheet (docs/design/chrome-redesign.md, step C8a): on a phone, and on a touch screen held upright up
// to 1024 px (theme-init.js sets `bottom-sheet` on the page), the explanation's pane is a sheet over the editor, at three
// heights. The whole header is its grabber: a tap on it cycles the heights, a drag moves the sheet and lets it settle,
// and the arrow keys step it. At full height the app bar slides away (page.css follows `data-sheet` on the page). The
// heights and where a drag, a tap or a key leaves the sheet are decided in src/ui/sheet.ts; here they are measured,
// drawn and wired. The Problems list is the sheet's Problems tab: it moves into the sheet while the layout is on.
// Under the tabs row of the folded sheet, a summary row says what the cursor's line is (src/ui/summaryRow.ts); while the
// keyboard is open over the editor (web/keyboard.ts), the sheet is that row alone, on the keyboard's top, and the app bar
// hides (step C8b). A tap on the row shows the explanation, at half.
import type { LineExplanation } from '../src/analyzer';
import type { Lang } from '../src/i18n';
import { LEVELS } from '../src/levels';
import type { Keyboard } from '../src/ui/keyboard';
import { keyed, settle, sheetHeight, type Snap, type SnapHeights, snapHeights, SNAPS, tapped } from '../src/ui/sheet';
import { summaryRow } from '../src/ui/summaryRow';
import { narrow } from './layout';
import { readStored, STORAGE_KEYS, writeStored } from './storage';
import { TEXT } from './text';

export interface SheetHost {
  lang(): Lang;
  /** The sheet moved or settled, or the layout changed: the editor measures again and keeps its cursor in view, the toast moves. */
  moved(): void;
  /** Read mode is on (a tap on a line raises a folded sheet, to show its explanation). */
  reading(): boolean;
  /** Shows the Explanation tab (after a problem was chosen in the Problems tab). */
  explain(): void;
  /** Says a short message in the page's live region (a new height). */
  announce(text: string): void;
  /** Gives the focus back to the editor (Escape on the summary row). */
  home(): void;
}

/** The sheet's layout is on (a class of the page, from theme-init.js). */
export const sheetLayout = (): boolean => document.documentElement.classList.contains('bottom-sheet');

/** A move of the finger shorter than this is a tap. */
const SLOP = 6;
/** The speed of a release is measured over the moves of this many ms before it. */
const SPEED_MS = 100;

export class BottomSheet {
  /** The height shown: half at first, so that the explanation of the sample's line shows. */
  snap: Snap = 'half';
  private readonly root = document.documentElement;
  private readonly head: HTMLElement;
  private readonly grab: HTMLElement;
  private readonly hint: HTMLElement | null;
  private readonly summary: HTMLElement;
  /** The keyboard over the editor (web/keyboard.ts): while it is open the sheet is its summary row alone. */
  private keyboard: Pick<Keyboard, 'open' | 'overlap'> = { open: false, overlap: 0 };
  private readonly problems: HTMLElement | null;
  private readonly source: HTMLElement | null;
  /** The hint showed in this page: it shows once. */
  private hinted = false;

  constructor(private readonly pane: HTMLElement, private readonly host: SheetHost) {
    this.head = pane.querySelector<HTMLElement>('.panel-head')!;
    this.grab = pane.querySelector<HTMLElement>('#sheet-grab')!;
    this.hint = pane.querySelector<HTMLElement>('#sheet-hint');
    this.summary = pane.querySelector<HTMLElement>('#sheet-summary')!;
    this.problems = document.getElementById('problems');
    this.source = document.getElementById('source');
    // (First: the click that ends a drag goes nowhere.)
    this.drags();
    this.grab.addEventListener('keydown', (e) => {
      const to = keyed(this.snap, e.key);
      if (to === undefined || e.altKey || e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      this.set(to);
    });
    // A tap on the header around its tabs and pill (the grabber lets it through to the header), or a screen reader's
    // press of the grabber, cycles the heights (Enter on it too: `keyed`); so does a tap on the tab already chosen.
    // Another tab, on a folded sheet, opens it.
    // (Read before the tab's own listener, which chooses it and draws the tabs again: the target may be gone after.)
    let press: { tab: Element | null; chosen: boolean; control: boolean } | undefined;
    this.head.addEventListener('click', (e) => {
      const tab = (e.target as Element).closest('[role="tab"]');
      press = { tab, chosen: tab?.getAttribute('aria-selected') === 'true', control: !!(e.target as Element).closest('.view-slot, .panel-tools') };
    }, true);
    this.head.addEventListener('click', () => {
      const p = press;
      press = undefined;
      if (!this.on || !p || (!p.tab && p.control)) return;
      if (!p.tab || p.chosen) this.set(tapped(this.snap));
      else if (this.snap === 'peek') this.set('half');
    });
    // A tap on the summary row (Enter, Space) shows the explanation at half, and closes the keyboard: the focus leaves the
    // editor for the grabber. (The press keeps the editor's focus until the click: the keyboard, and the row with it,
    // must not go before the tap ends.) Escape gives the focus back to the editor.
    this.summary.addEventListener('mousedown', (e) => e.preventDefault());
    this.summary.addEventListener('click', () => {
      (document.activeElement as HTMLElement | null)?.blur();
      this.keyboard = { open: false, overlap: 0 };
      this.set('half');
      this.grab.focus({ preventScroll: true });
    });
    this.summary.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      host.home();
    });
    // A tap on a line in Read mode, on a folded sheet: the sheet opens to show the line's explanation.
    document.getElementById('editor')?.addEventListener('click', () => {
      if (this.on && this.snap === 'peek' && host.reading()) this.set('half');
    });
    // The heights follow the window (a phone turned, the browser's bars), and the layout may come or go.
    window.addEventListener('resize', () => this.apply());
    narrow.addEventListener('change', () => this.layout());
    // (Where the sheet ends its move, the toast takes its place above it.)
    pane.addEventListener('transitionend', (e) => {
      if (e.target === pane && this.on) host.moved();
    });
    this.layout();
  }

  get on(): boolean {
    return sheetLayout();
  }

  /** The sheet is full: it covers the editor, which is inert (`inert`). The keyboard is never open then. */
  get covers(): boolean {
    return this.on && this.snap === 'full' && !this.keyboard.open;
  }

  /** The sheet is folded, or the keyboard is open: its content, the explanation and the Problems list, is inert (`inert`). */
  get folded(): boolean {
    return this.on && (this.snap === 'peek' || this.keyboard.open);
  }

  /** The sheet's own stop has the focus: the grabber, or the summary row. */
  get focused(): boolean {
    return document.activeElement === this.grab || document.activeElement === this.summary;
  }

  /**
   * The focus on the sheet's own stop: the editor's while the sheet covers it, the explanation's while folded
   * (`paneStops`). That is the grabber, or the summary row while the keyboard is open (the tabs row is hidden then).
   */
  focus(): void {
    (this.keyboard.open ? this.summary : this.grab).focus({ preventScroll: true });
  }

  /** The keyboard opened over the editor, closed, or covers another part of the window (web/keyboard.ts). */
  typing(k: Pick<Keyboard, 'open' | 'overlap'>): void {
    this.keyboard = { open: k.open, overlap: k.overlap };
    if (k.open) this.hideHint();
    if (k.open) this.root.dataset.keyboard = '';
    else delete this.root.dataset.keyboard;
    this.apply();
  }

  /** Draws the summary row of the cursor's line (`line`, from 0): "Ln 20", its first problem's mark, and its text. */
  summarize(ex: LineExplanation, line: number): void {
    const t = TEXT[this.host.lang()];
    const row = summaryRow(ex, this.host.lang());
    const part = (id: string) => this.summary.querySelector<HTMLElement>(`#${id}`)!;
    part('summary-line').textContent = t.line(line + 1);
    part('summary-mark').textContent = row.mark;
    part('summary-mark').className = row.level ? `icon ${LEVELS[row.level].className}` : 'icon';
    part('summary-text').textContent = row.text;
    this.summary.setAttribute('aria-label', t.summaryName(line + 1, row.level && LEVELS[row.level].name[this.host.lang()], row.text));
    this.summary.title = t.summaryTip;
  }

  /**
   * The heights for this window: the full sheet reaches the strip above the editor, under the banner when there is one.
   * The header row and the summary row are measured at every height (the summary row only shows folded, but keeps its box).
   */
  heights(): SnapHeights {
    const banner = document.getElementById('channel-banner');
    const strip = document.getElementById('ed-head');
    const top = (banner && !banner.hidden ? banner.offsetHeight : 0) + (strip?.offsetHeight ?? 0);
    // (The header row with the sheet's top edge, and the room the window's bottom keeps: the safe area of a phone without a home button.)
    const cs = getComputedStyle(this.pane);
    const row = this.head.offsetHeight + parseFloat(cs.borderTopWidth) + parseFloat(cs.paddingBottom);
    return snapHeights(window.innerHeight, top, Math.round(row), this.summary.offsetHeight);
  }

  /**
   * Shows a height. While the grabber has the focus, a screen reader says its new value (the slider's `aria-valuetext`);
   * a new height from elsewhere (a tap, a drag, a problem chosen) is said in the page's live region, once.
   */
  set(snap: Snap): void {
    const moved = snap !== this.snap;
    if (moved) this.hideHint();
    this.snap = snap;
    this.apply();
    if (moved && this.on && !this.focused) {
      const t = TEXT[this.host.lang()];
      this.host.announce(t.sheetMoved(t.sheetHeights[snap]));
    }
    if (snap === 'full') this.showHint();
  }

  /** A problem was chosen in the Problems tab: its line shows above the sheet, and its explanation in it. */
  picked(): void {
    if (!this.on) return;
    this.host.explain();
    this.set('half');
  }

  /** Into the sheet's layout or out of it: the Problems list goes into the sheet (its Problems tab) or back under the editor. */
  private layout(): void {
    const on = this.on;
    if (this.problems && this.source) {
      const home = on ? this.pane : this.source;
      if (this.problems.parentElement !== home) home.append(this.problems);
      if (on) {
        this.problems.setAttribute('role', 'tabpanel');
        this.problems.setAttribute('aria-labelledby', 'tab-problems');
      } else {
        this.problems.removeAttribute('role');
        this.problems.removeAttribute('aria-labelledby');
      }
    }
    if (!on) {
      delete this.root.dataset.sheet;
      delete this.root.dataset.keyboard;
      this.root.style.removeProperty('--sheet-h');
      this.root.style.removeProperty('--sheet-rest');
      this.hideHint();
      this.inert(false, false);
      return this.host.moved();
    }
    this.apply();
  }

  /** Draws the height shown: the sheet's height, the editor's room above it, what is out of sight, and the grabber's name. */
  private apply(): void {
    if (!this.on) return;
    // (While the keyboard is open, the summary row with the sheet's edge; the keyboard covers the rest.)
    const shown = sheetHeight(this.heights(), this.snap, this.keyboard, this.summary.offsetHeight + parseFloat(getComputedStyle(this.pane).borderTopWidth));
    this.root.dataset.sheet = this.snap;
    this.root.style.setProperty('--sheet-h', `${shown.height}px`);
    this.root.style.setProperty('--sheet-rest', `${shown.rest}px`);
    this.inert(this.folded, this.covers);
    this.name();
    this.host.moved();
  }

  /**
   * The grabber is a slider over the heights (its keys are a slider's: ↑ ↓, Home, End), named once; its value is the
   * height shown, as a number and in words, set at once (never stale while it has the focus); its tooltip says how to
   * change it. A new height is also said in the live region (`set`).
   */
  name(): void {
    const t = TEXT[this.host.lang()];
    this.grab.setAttribute('aria-label', t.sheetGrab);
    this.grab.setAttribute('aria-valuenow', String(SNAPS.indexOf(this.snap)));
    this.grab.setAttribute('aria-valuetext', t.sheetHeights[this.snap]);
    this.grab.title = t.sheetHint;
    if (this.hint) this.hint.textContent = t.sheetHint;
  }

  /**
   * What the sheet hides is out of the focus order: its content while it is folded; the editor and the app bar while it
   * is full. A focus inside what goes goes to the grabber, never to the page's body.
   */
  private inert(folded: boolean, full: boolean): void {
    const hidden: [Element | null, boolean][] = [
      [this.pane.querySelector('.panel-body'), folded], [this.problems, folded && this.on], [this.hint, folded],
      [document.getElementById('editor'), full], [document.getElementById('first-hint'), full], [document.getElementById('empty-editor'), full],
      [document.querySelector('header.top'), full || (folded && this.keyboard.open)],
    ];
    const had = document.activeElement;
    for (const [el, on] of hidden) if (el instanceof HTMLElement) el.inert = on;
    if (had instanceof HTMLElement && had !== document.body && hidden.some(([el, on]) => on && el?.contains(had))) this.focus();
  }

  /** The first time the sheet is full (in this browser), a hint under its header says how to change the height. */
  private showHint(): void {
    if (this.hinted || !this.hint || readStored(STORAGE_KEYS.sheetHint) === '1') return;
    this.hinted = true;
    writeStored(STORAGE_KEYS.sheetHint, '1');
    this.hint.hidden = false;
  }

  private hideHint(): void {
    if (this.hint) this.hint.hidden = true;
  }

  /**
   * The header follows a finger (or a pointer) up and down, from anywhere but the view control and the tools; once let
   * go, the sheet settles on a height from where it is and how fast it went. A tap is left to the grabber or the tab
   * under it; the click that ends a drag does nothing.
   */
  private drags(): void {
    let drag: { id: number; y: number; h: number; moved: boolean; moves: { t: number; h: number }[]; heights: SnapHeights } | undefined;
    let quietUntil = 0;
    this.head.addEventListener('click', (e) => {
      if (performance.now() >= quietUntil) return;
      e.stopImmediatePropagation();
      e.preventDefault();
    }, true);
    this.head.addEventListener('pointerdown', (e) => {
      if (!this.on || e.button !== 0 || (e.target as Element).closest('.view-slot, .panel-tools')) return;
      const h = this.pane.getBoundingClientRect().height;
      drag = { id: e.pointerId, y: e.clientY, h, moved: false, moves: [{ t: e.timeStamp, h }], heights: this.heights() };
    });
    this.head.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dy = drag.y - e.clientY;
      if (!drag.moved && Math.abs(dy) < SLOP) return;
      if (!drag.moved) {
        drag.moved = true;
        this.head.setPointerCapture(e.pointerId);
        this.pane.classList.add('dragging');
        this.hideHint();
      }
      const at = (y: number) => Math.min(drag!.heights.full, Math.max(drag!.heights.peek, drag!.h + drag!.y - y));
      // (Each move the browser merged into this event, with its own time: a phone sends them once a frame.)
      const merged = e.getCoalescedEvents?.() ?? [];
      const moves = (merged.length ? merged : [e]).map((m) => ({ t: m.timeStamp, h: at(m.clientY) }));
      const last = moves[moves.length - 1];
      drag.moves = [...drag.moves, ...moves].filter((m) => last.t - m.t <= SPEED_MS);
      this.root.style.setProperty('--sheet-h', `${last.h}px`);
    });
    const end = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      const { moved, heights } = drag;
      // (The moves of the last SPEED_MS before the finger left.)
      const moves = drag.moves.filter((m) => e.timeStamp - m.t <= SPEED_MS);
      if (!moves.length) moves.push(drag.moves[drag.moves.length - 1]);
      drag = undefined;
      if (!moved) return;
      this.pane.classList.remove('dragging');
      if (this.head.hasPointerCapture(e.pointerId)) this.head.releasePointerCapture(e.pointerId);
      quietUntil = performance.now() + 400;
      const last = moves[moves.length - 1];
      const first = moves[0];
      const speed = last.t > first.t ? (last.h - first.h) / (last.t - first.t) : 0;
      // (A cancelled drag goes back to the nearest height, with no fling.)
      this.set(settle(heights, last.h, e.type === 'pointerup' ? speed : 0));
    };
    this.head.addEventListener('pointerup', end);
    this.head.addEventListener('pointercancel', end);
  }
}
