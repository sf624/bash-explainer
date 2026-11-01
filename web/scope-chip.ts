// The chip of the file type and the shell in the editor's header (docs/design/chrome-redesign.md, decision 12, step C5):
// "Shell script · bash (auto)", and its popover with the lists File type, Shell, and yq when the cursor's line runs yq.
// Beside the editor the popover lies under the chip; on a phone (and in the narrow layout) it is a sheet from the
// bottom, a modal dialog with Done. What it shows comes from the page's state (the kind, the `shell` and `yq.flavor`
// settings, `autoShellAt`'s reading of the cursor's line), through src/ui/scope.ts: the chip's forms, widest first, of which the header takes
// the first that fits, and the words of the automatic shell. A choice goes to the page as the menu's selects did.
//
// The lists are radio groups whose arrows move without choosing: choosing a file type may ask whether to load its
// sample, so it waits for Enter, Space or a click. The checked item of File type has the focus when the popover opens;
// Escape closes it and gives the focus back to the chip.
import type { AutoShell, Shell } from '../src/dialect';
import type { Lang } from '../src/i18n';
import { scopeChip, ScopeForm, shellChoices } from '../src/ui/scope';
import { fitsRow, narrow } from './layout';
import { closed, focusBack, opening } from './popover';
import { Kind, KINDS } from './samples';
import { TEXT } from './text';

/** What the chip reads from the page, and what a choice asks of it. */
export interface ScopeHost {
  lang(): Lang;
  kind(): Kind;
  /** The shell chosen (the setting), and the automatic one of the cursor's line (`autoShellAt`, src/document.ts). */
  shells(): { forced?: Shell; auto?: AutoShell };
  /** The yq choices of the cursor's line, as the panel offers them (none: the line runs no yq), and the one chosen. */
  yq(): { options?: readonly (readonly string[])[]; value: string };
  chooseKind(kind: Kind): void;
  choose(key: 'shell' | 'yq', value: string): void;
}

type Group = 'kind' | 'shell' | 'yq';

export class ScopeControl {
  private readonly chip: HTMLButtonElement;
  private readonly text: HTMLElement;
  private readonly pop: HTMLDialogElement;
  private readonly head: HTMLElement;
  private readonly nameBox: HTMLElement | null;
  private forms: ScopeForm[] = [];
  /** What the forms were last taken for (the forms, the name, the header's width): nothing to measure when it is the same. */
  private fitted = '';
  /** Whether the popover is the phone's sheet (a modal dialog) rather than a popover beside the editor. */
  private modal = false;
  private readonly closer = () => this.close(false);

  constructor(private readonly host: ScopeHost) {
    this.chip = document.getElementById('scope-chip') as HTMLButtonElement;
    this.text = document.getElementById('scope-chip-text')!;
    this.pop = document.getElementById('scope-pop') as HTMLDialogElement;
    this.head = document.getElementById('ed-head')!;
    this.nameBox = this.head.querySelector('.file-box');
    this.chip.addEventListener('click', () => (this.pop.open ? this.close(true) : this.open()));
    this.chip.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      this.open();
    });
    this.pop.addEventListener('click', (e) => {
      const item = (e.target as Element).closest<HTMLElement>('[role="radio"]');
      if (item) return this.pick(item);
      // (A click on the sheet's backdrop is a click on the dialog itself, outside its box.)
      if (e.target === this.pop && this.modal && !inside(this.pop, e)) this.close(true);
    });
    this.pop.addEventListener('keydown', (e) => this.key(e));
    // The sheet's own ways to close (the back gesture is a cancel): the chip has the focus back.
    this.pop.addEventListener('close', () => {
      if (this.chip.getAttribute('aria-expanded') !== 'true') return;
      this.closedNow();
      const at = document.activeElement;
      if (!at || at === document.body) focusBack(this.chip);
    });
    document.getElementById('scope-done')?.addEventListener('click', () => this.close(true));
    // Beside the editor: a press elsewhere, Tab out of it, or a click in the panel's frame (the window loses the focus) closes it.
    document.addEventListener('pointerdown', (e) => {
      if (this.pop.open && !this.modal && !this.chip.contains(e.target as Node) && !this.pop.contains(e.target as Node)) this.close(false);
    });
    window.addEventListener('blur', () => {
      if (!this.modal) this.close(false);
    });
    this.pop.addEventListener('focusout', (e) => {
      const to = e.relatedTarget as Node | null;
      if (!this.modal && to && !this.pop.contains(to) && to !== this.chip) this.close(false);
    });
    narrow.addEventListener('change', () => this.close(false));
    new ResizeObserver(() => this.fit()).observe(this.head);
    // (The widths change once the page's fonts have loaded.)
    void document.fonts?.ready.then(() => {
      this.fitted = '';
      this.fit();
    });
    this.draw();
  }

  /** Draws the chip, its words and the lists from the page's state, and takes the form that fits. */
  draw(): void {
    const lang = this.host.lang();
    const t = TEXT[lang];
    const kind = this.host.kind();
    const name = t.kinds[kind] ?? KINDS.find((k) => k.kind === kind)!.name;
    const { forced, auto } = this.host.shells();
    const chip = scopeChip(lang, t.scopeTitle, { name, short: t.kindsShort[kind] ?? name }, forced, auto);
    this.chip.setAttribute('aria-label', chip.name);
    this.chip.title = chip.tip;
    this.forms = chip.forms;
    for (const [id, text] of [['scope-title', t.scopeTitle], ['scope-kind-label', t.scopeKinds], ['scope-shell-label', t.scopeShell], ['scope-done', t.scopeDone], ['menu-scope-label', t.scopeMenu], ['menu-scope-note', chip.forms[0].chip]]) {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    }
    this.lists();
    this.fit();
  }

  /** Opens the popover (the chip, or the menu's "File type and shell…"), with the focus on the file type checked. */
  open(): void {
    if (this.pop.open) return;
    opening(this.closer);
    this.lists();
    this.modal = narrow.matches;
    this.pop.classList.toggle('sheet-pop', this.modal);
    if (this.modal) {
      this.pop.showModal();
    } else {
      this.pop.show();
      this.keepInView();
    }
    this.chip.setAttribute('aria-expanded', 'true');
    this.pop.querySelector<HTMLElement>('#scope-kinds [aria-checked="true"]')?.focus();
  }

  /** Closes the popover; `focusChip`: the chip has the focus back, when the popover had it. */
  close(focusChip: boolean): void {
    if (!this.pop.open) return;
    const had = this.pop.contains(document.activeElement);
    this.closedNow();
    this.pop.close();
    if (focusChip && had) focusBack(this.chip);
  }

  private closedNow(): void {
    this.chip.setAttribute('aria-expanded', 'false');
    closed(this.closer);
  }

  /** Beside the editor the popover is under the chip, at its right edge; in a narrow pane it moves right to stay on the screen. */
  private keepInView(): void {
    this.pop.style.right = '';
    const left = this.pop.getBoundingClientRect().left;
    if (left < 8) this.pop.style.right = `${Math.round(left - 8)}px`;
  }

  /** The three lists, from the page's state. An item keeps its element (and the focus) while its group offers the same values. */
  private lists(): void {
    const lang = this.host.lang();
    const t = TEXT[lang];
    const { forced, auto } = this.host.shells();
    const yq = this.host.yq();
    this.fill('kind', KINDS.map((k) => [k.kind, t.kinds[k.kind] ?? k.name]), this.host.kind());
    this.fill('shell', shellChoices(lang, auto), forced ?? 'auto');
    this.fill('yq', yq.options ?? [], yq.value);
    document.getElementById('scope-yq-list')!.hidden = !yq.options;
  }

  private fill(group: Group, options: readonly (readonly string[])[], value: string): void {
    const box = document.getElementById(`scope-${group}s`)!;
    const items = () => [...box.children] as HTMLElement[];
    const same = items().length === options.length && items().every((b, i) => b.dataset.value === options[i][0]);
    if (!same) box.replaceChildren(...options.map(([v]) => radio(group, v)));
    const focused = items().find((b) => b === document.activeElement);
    items().forEach((b, i) => {
      b.querySelector('.scope-name')!.textContent = options[i][1];
      b.setAttribute('aria-checked', String(options[i][0] === value));
    });
    // One Tab stop per group: the item with the focus, else the checked one.
    const stop = focused ?? items().find((b) => b.getAttribute('aria-checked') === 'true') ?? items()[0];
    for (const b of items()) b.tabIndex = b === stop ? 0 : -1;
  }

  /** An item chosen: the page takes it, and the chip and the lists show the state it makes. */
  private pick(item: HTMLElement): void {
    if (item.getAttribute('aria-checked') === 'true') return;
    const { group, value } = item.dataset as { group: Group; value: string };
    if (group === 'kind') this.host.chooseKind(value as Kind);
    else this.host.choose(group, value);
    this.draw();
  }

  /** The arrows, Home and End move in a list without choosing; Escape closes. */
  private key(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      return this.close(true);
    }
    const item = (e.target as Element).closest<HTMLElement>('[role="radio"]');
    if (!item) return;
    const items = [...item.parentElement!.children] as HTMLElement[];
    const at = items.indexOf(item);
    const to = ({ ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: items.length - 1 } as Record<string, number>)[e.key];
    if (to === undefined) return;
    e.preventDefault();
    const next = items[(to + items.length) % items.length];
    for (const b of items) b.tabIndex = b === next ? 0 : -1;
    next.focus();
  }

  /**
   * Takes the first form that fits the header: the chip's text, Open and Save with their words or as icons, the name
   * there or in the menu only. The name keeps about a dozen characters of its stem (all of a shorter one) before the chip
   * gives way. When no form fits, the chip's text is cut with "…".
   */
  private fit(): void {
    const key = JSON.stringify([this.forms, this.nameBox?.textContent, this.head.clientWidth]);
    if (key === this.fitted || !this.forms.length) return;
    this.fitted = key;
    this.head.classList.remove('squeezed');
    this.head.dataset.name = 'shown';
    this.floorName();
    for (const form of this.forms) {
      this.text.textContent = form.chip;
      this.head.dataset.tools = form.tools;
      this.head.dataset.name = form.name ? 'shown' : 'menu';
      if (fitsRow(this.head)) return;
    }
    this.head.classList.add('squeezed');
  }

  /** The name's least width: its own, up to 18ch with its extension and pencil (its stem is cut with "…" down to that). */
  private floorName(): void {
    const box = this.nameBox;
    if (!box) return;
    box.style.minWidth = '';
    box.style.flex = 'none';
    const natural = Math.ceil(box.getBoundingClientRect().width);
    box.style.flex = '';
    box.style.minWidth = `min(${natural}px, 18ch)`;
  }
}

/** An item of a list: a radio button with its mark and its name. */
function radio(group: Group, value: string): HTMLElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.id = `scope-${group}-${value}`;
  b.className = 'scope-opt';
  b.setAttribute('role', 'radio');
  b.dataset.group = group;
  b.dataset.value = value;
  const dot = document.createElement('span');
  dot.className = 'scope-dot';
  dot.setAttribute('aria-hidden', 'true');
  const name = document.createElement('span');
  name.className = 'scope-name';
  b.append(dot, name);
  return b;
}

/** Whether a click lies inside an element's box. */
function inside(el: HTMLElement, e: MouseEvent): boolean {
  const r = el.getBoundingClientRect();
  return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
}
