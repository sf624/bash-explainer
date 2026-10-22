// A compact choice of one value: a button that shows the current one and opens a list under it.
// It is a listbox popup (the ARIA pattern of a "select-only combobox", with a button): the button has
// aria-haspopup and aria-expanded; in the list, the arrows, Home and End move, Enter or Space chooses,
// Escape closes, and the focus goes back to the button.

export interface PickerOption {
  value: string;
  /** The name in the list, and the button's name for screen readers. */
  name: string;
  /** What the button shows on a narrow screen (the full name on a wide one). */
  short: string;
}

export class Picker {
  private options: PickerOption[] = [];
  private value = '';
  private label = '';

  constructor(
    private readonly button: HTMLButtonElement,
    private readonly list: HTMLElement,
    private readonly onChoose: (value: string) => void,
  ) {
    button.setAttribute('aria-haspopup', 'listbox');
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', list.id);
    list.setAttribute('role', 'listbox');
    list.tabIndex = -1;
    list.hidden = true;
    button.addEventListener('click', () => (this.isOpen ? this.close(true) : this.open()));
    button.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      this.open();
    });
    list.addEventListener('keydown', (e) => this.key(e));
    list.addEventListener('click', (e) => {
      const item = (e.target as Element).closest('[role="option"]');
      if (item instanceof HTMLElement && item.dataset.value !== undefined) this.choose(item.dataset.value);
    });
    // A press anywhere else, or a click in a frame (the window loses the focus), closes the list.
    document.addEventListener('pointerdown', (e) => {
      if (this.isOpen && !button.contains(e.target as Node) && !list.contains(e.target as Node)) this.close(false);
    });
    window.addEventListener('blur', () => this.close(false));
    list.addEventListener('focusout', (e) => {
      const to = e.relatedTarget as Node | null;
      if (to && !list.contains(to) && to !== button) this.close(false);
    });
  }

  get isOpen(): boolean {
    return !this.list.hidden;
  }

  /** Sets the choices, the current one and the name of what is chosen ("File"). */
  set(options: PickerOption[], value: string, label: string): void {
    this.options = options;
    this.label = label;
    this.list.setAttribute('aria-label', label);
    this.list.replaceChildren(...options.map((o) => {
      const li = document.createElement('li');
      li.id = `${this.list.id}-${o.value}`;
      li.setAttribute('role', 'option');
      li.tabIndex = -1;
      li.dataset.value = o.value;
      li.textContent = o.name;
      return li;
    }));
    this.show(value);
  }

  /** Shows a value as the current one (without telling onChoose). */
  show(value: string): void {
    this.value = value;
    const o = this.options.find((x) => x.value === value) ?? this.options[0];
    if (!o) return;
    const name = this.button.querySelector('.picker-name');
    const short = this.button.querySelector('.picker-short');
    if (name) name.textContent = o.name;
    if (short) short.textContent = o.short;
    this.button.setAttribute('aria-label', `${this.label}: ${o.name}`);
    this.button.title = `${this.label}: ${o.name}`;
    for (const li of this.items()) li.setAttribute('aria-selected', String(li.dataset.value === o.value));
  }

  private items(): HTMLElement[] {
    return [...this.list.querySelectorAll<HTMLElement>('[role="option"]')];
  }

  private open(): void {
    if (this.isOpen) return;
    this.list.hidden = false;
    this.button.setAttribute('aria-expanded', 'true');
    const items = this.items();
    (items.find((li) => li.dataset.value === this.value) ?? items[0])?.focus();
  }

  private close(focusButton: boolean): void {
    if (!this.isOpen) return;
    this.list.hidden = true;
    this.button.setAttribute('aria-expanded', 'false');
    if (focusButton) this.button.focus();
  }

  private choose(value: string): void {
    this.close(true);
    if (value === this.value) return;
    this.show(value);
    this.onChoose(value);
  }

  private key(e: KeyboardEvent): void {
    const items = this.items();
    const at = items.indexOf(document.activeElement as HTMLElement);
    const go = (i: number) => items[Math.max(0, Math.min(items.length - 1, i))]?.focus();
    switch (e.key) {
      case 'ArrowDown': go(at + 1); break;
      case 'ArrowUp': go(at - 1); break;
      case 'Home': go(0); break;
      case 'End': go(items.length - 1); break;
      case 'Enter':
      case ' ':
        if (at >= 0) this.choose(items[at].dataset.value!);
        break;
      case 'Escape': this.close(true); break;
      // The focus goes back to the button first, so that Tab moves on from there.
      case 'Tab': this.close(true); return;
      default: return;
    }
    e.preventDefault();
  }
}
