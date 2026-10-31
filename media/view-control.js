// @ts-check
// The view control (docs/design/chrome-redesign.md, decision 4, step C7): one component, drawn by the web page in its
// panel header (web/panel-head.ts) and by the VS Code panel in its own (media/panel.js). What it shows is data of
// src/ui: the label and the options (src/ui/panelView.ts `viewControl`), and the forms it may take, widest first
// (src/ui/panelHead.ts `viewControlForms`). Each host measures the forms and takes the first that fits; a press says
// what the option sets, and the host keeps the state and draws the control again.
//
// One markup serves every form: the menu's button, then the options (toggle buttons). As segments, the options are in
// the row and the button is not drawn; as a menu, the button is drawn and opens the options under it (a disclosure).
// Each text that changes with the option shown is drawn over the others it may become, unseen, so that the control
// keeps the width of the longest: a press moves nothing.
(function () {
  /**
   * @typedef {{ id: string, digit?: string, short: string, full: string, pressed: boolean, sets: Record<string, unknown> }} Option
   * @typedef {{ label: string, options: Option[] }} Control
   * @typedef {{ kind: 'segments' | 'menu', label?: string, button?: { text: string, name: string }[] }} Form
   */

  /**
   * A text drawn over the other texts it may become (`others`, unseen and unread): its box is as wide as the widest.
   * @param {Document} doc
   * @param {string} text
   * @param {string[]} others
   */
  function stack(doc, text, others) {
    const box = doc.createElement('span');
    box.className = 'vc-stack';
    const shown = doc.createElement('span');
    shown.textContent = text;
    box.append(shown);
    for (const o of others) {
      if (o === text) continue;
      const size = doc.createElement('span');
      size.className = 'vc-size';
      size.setAttribute('aria-hidden', 'true');
      size.textContent = o;
      box.append(size);
    }
    return box;
  }

  /**
   * Makes the control in `root` (an empty element). Its ids start with `prefix`: the menu's button `<prefix>-open`, the
   * options' group `<prefix>-options`, each option `<prefix>-<id>`. `press` gets what a pressed option sets.
   * `focus` gives the focus to a control of it (a host may mark how it got there); the focus moves only where the
   * control hid the element that had it: from an option to the menu's button when the menu closes, and between the
   * button and the option shown when the form changes.
   * @param {HTMLElement} root
   * @param {string} prefix
   * @param {(sets: Record<string, unknown>) => void} press
   * @param {(el: HTMLElement) => void} [focus]
   */
  function create(root, prefix, press, focus = (el) => el.focus()) {
    const doc = root.ownerDocument;
    root.classList.add('vc');
    const label = doc.createElement('span');
    label.className = 'vc-label';
    // (The group's accessible name says it.)
    label.setAttribute('aria-hidden', 'true');
    const open = doc.createElement('button');
    open.type = 'button';
    open.id = `${prefix}-open`;
    open.className = 'vc-open';
    open.setAttribute('aria-expanded', 'false');
    open.setAttribute('aria-controls', `${prefix}-options`);
    const group = doc.createElement('div');
    group.id = `${prefix}-options`;
    group.className = 'vc-options';
    group.setAttribute('role', 'group');
    root.append(label, open, group);

    /** @type {Control} */
    let control = { label: '', options: [] };
    /** @type {Form} */
    let form = { kind: 'segments' };

    const buttons = () => /** @type {HTMLElement[]} */ (Array.from(group.querySelectorAll('button[data-option]')));
    const shownOption = () => buttons().find((b) => b.getAttribute('aria-pressed') === 'true') ?? buttons()[0];
    const isOpen = () => root.dataset.open === 'true';
    /** Opens or closes the menu; closing gives the focus back to its button when an option had it. */
    function setOpen(/** @type {boolean} */ on) {
      if (on === isOpen()) return;
      const had = group.contains(doc.activeElement);
      root.dataset.open = String(on);
      open.setAttribute('aria-expanded', String(on));
      if (on) shownOption()?.focus();
      else if (had) focus(open);
    }

    open.addEventListener('click', () => setOpen(!isOpen()));
    group.addEventListener('click', (e) => {
      const b = e.target instanceof Element ? /** @type {HTMLElement | null} */ (e.target.closest('button[data-option]')) : null;
      const option = b && control.options.find((o) => o.id === b.dataset.option);
      if (!option) return;
      if (form.kind === 'menu') setOpen(false);
      if (!option.pressed) press(option.sets);
    });
    root.addEventListener('keydown', (e) => {
      if (!isOpen()) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        return;
      }
      // The arrows, Home and End move between the options of the open menu.
      const list = buttons();
      const at = list.indexOf(/** @type {HTMLElement} */ (doc.activeElement));
      const to = /** @type {Record<string, number>} */ ({ ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: list.length - 1 })[e.key];
      if (at < 0 || to === undefined) return;
      e.preventDefault();
      list[(to + list.length) % list.length]?.focus();
    });
    // The menu closes when the focus leaves the control (Tab), or on a press elsewhere. (A press on an option may take
    // the focus from it to nowhere first, as Safari's does: the press closes the menu itself.)
    let pressing = false;
    root.addEventListener('pointerdown', () => {
      pressing = true;
    }, true);
    for (const type of ['pointerup', 'pointercancel']) doc.addEventListener(type, () => setTimeout(() => (pressing = false), 0), true);
    root.addEventListener('focusout', (e) => {
      if (isOpen() && !pressing && !(e.relatedTarget instanceof Node && root.contains(e.relatedTarget))) setOpen(false);
    });
    doc.addEventListener('pointerdown', (e) => {
      if (isOpen() && !(e.target instanceof Node && root.contains(e.target))) setOpen(false);
    }, true);

    /** Draws the control's label, options and the menu's button in the form taken. */
    function draw() {
      const shown = control.options.findIndex((o) => o.pressed);
      root.dataset.form = form.kind;
      label.textContent = form.label ?? '';
      label.hidden = !form.label;
      group.setAttribute('aria-label', control.label);
      const names = control.options.map((o) => o.short);
      const kept = new Map(buttons().map((b) => [b.dataset.option, b]));
      const list = control.options.map((o) => {
        const b = kept.get(o.id) ?? Object.assign(doc.createElement('button'), { type: 'button', id: `${prefix}-${o.id}` });
        b.dataset.option = o.id;
        b.setAttribute('aria-pressed', String(o.pressed));
        const kids = [];
        if (o.digit !== undefined) {
          const d = doc.createElement('span');
          d.className = 'vc-digit';
          d.textContent = o.digit;
          kids.push(d);
        }
        // (With a digit, the name is drawn only on the option shown, as wide as the longest name.)
        const name = o.digit !== undefined ? stack(doc, o.short, names) : doc.createElement('span');
        if (o.digit === undefined) name.textContent = o.short;
        name.classList.add('vc-name');
        kids.push(name);
        b.replaceChildren(...kids);
        // The full name where it says more than the button: the tooltip and the accessible name.
        const said = o.digit !== undefined || o.full !== o.short;
        for (const attr of ['title', 'aria-label']) {
          if (said) b.setAttribute(attr, o.full);
          else b.removeAttribute(attr);
        }
        return b;
      });
      if (list.length !== group.children.length || list.some((b, i) => group.children[i] !== b)) group.replaceChildren(...list);
      const texts = (form.button ?? []).map((t) => t.text);
      const now = form.button?.[shown < 0 ? 0 : shown];
      const chevron = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
      chevron.setAttribute('class', 'vc-chev');
      chevron.setAttribute('viewBox', '0 0 12 12');
      chevron.setAttribute('aria-hidden', 'true');
      const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', 'M3 4.5l3 3 3-3');
      chevron.append(path);
      open.replaceChildren(stack(doc, now?.text ?? '', texts), chevron);
      if (now) {
        open.setAttribute('aria-label', now.name);
        open.title = now.name;
      }
      if (form.kind !== 'menu') setOpen(false);
    }

    return {
      /**
       * Shows `c` in the form `f`. Where the form change hides the element with the focus, the focus goes to the
       * control's element of the new form: the menu's button, or the option shown.
       * @param {Control} c
       * @param {Form} f
       */
      draw(c, f) {
        const before = doc.activeElement;
        const inside = before instanceof HTMLElement && root.contains(before);
        control = c;
        form = f;
        draw();
        if (inside && !before.getClientRects().length) {
          const to = form.kind === 'menu' ? open : shownOption();
          if (to) focus(to);
        }
      },
      /** Closes the menu, if it is open. */
      close() {
        setOpen(false);
      },
    };
  }

  /** @type {any} */ (globalThis).BashExplainerViewControl = { create };
})();
