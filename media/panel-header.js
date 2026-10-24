// @ts-check
// PROTOTYPE (branch proto/panel-header; not to merge): three other looks for the panel's header, chosen by
// <html data-hdr="v1" | "v2" | "v3">. panel.ts sets it from $BASH_EXPLAINER_PANEL_HEADER; without it nothing
// changes. It runs before panel.js and only moves and dresses the header's own elements (same ids), so
// panel.js keeps driving them; panel.js names a button drawn as an icon through its .lbl (setLabel).
//   v1 "Native toolbar": icon buttons as in a VS Code view's title bar, the views as toggles, a native dropdown.
//   v2 "Segmented": List/Tree as a segmented control, the shell as a pill, the actions in a "…" menu.
//   v3 "Like the web page": a bar across the panel with the web page's icons and control shapes.
(function () {
  const variant = document.documentElement.dataset.hdr;
  if (variant !== 'v1' && variant !== 'v2' && variant !== 'v3') return;
  const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
  const NS = 'http://www.w3.org/2000/svg';

  /** Codicons (@vscode/codicons 0.0.46-24; the icons are CC BY 4.0, (c) Microsoft Corporation): 16×16, filled. */
  const CODICONS = /** @type {Record<string, (string | string[])[]>} */ ({
    "copy": ['M3 5V12.73C2.4 12.38 2 11.74 2 11V5C2 2.79 3.79 1 6 1H9C9.74 1 10.38 1.4 10.73 2H6C4.35 2 3 3.35 3 5ZM11 15H6C4.897 15 4 14.103 4 13V5C4 3.897 4.897 3 6 3H11C12.103 3 13 3.897 13 5V13C13 14.103 12.103 15 11 15ZM12 5C12 4.448 11.552 4 11 4H6C5.448 4 5 4.448 5 5V13C5 13.552 5.448 14 6 14H11C11.552 14 12 13.552 12 13V5Z'],
    "collapse-all": ['M14 4.27051C14.5999 4.62053 15 5.26009 15 6V11C15 13.21 13.21 15 11 15H6C5.26009 15 4.62053 14.5999 4.27051 14H11C12.65 14 14 12.65 14 11V4.27051Z','M9.5 7C9.776 7 10 7.224 10 7.5C10 7.776 9.776 8 9.5 8H5.5C5.224 8 5 7.776 5 7.5C5 7.224 5.224 7 5.5 7H9.5Z',['M11 2C12.103 2 13 2.897 13 4V11C13 12.103 12.103 13 11 13H4C2.897 13 2 12.103 2 11V4C2 2.897 2.897 2 4 2H11ZM4 3C3.449 3 3 3.449 3 4V11C3 11.552 3.449 12 4 12H11C11.551 12 12 11.552 12 11V4C12 3.449 11.551 3 11 3H4Z','evenodd']],
    "expand-all": ['M15 6V11C15 13.21 13.21 15 11 15H6C5.26 15 4.62 14.6 4.27 14H11C12.65 14 14 12.65 14 11V4.27C14.6 4.62 15 5.26 15 6ZM11 13H4C2.897 13 2 12.103 2 11V4C2 2.897 2.897 2 4 2H11C12.103 2 13 2.897 13 4V11C13 12.103 12.103 13 11 13ZM4 12H11C11.551 12 12 11.552 12 11V4C12 3.449 11.551 3 11 3H4C3.449 3 3 3.449 3 4V11C3 11.552 3.449 12 4 12ZM9.5 7H8V5.5C8 5.224 7.776 5 7.5 5C7.224 5 7 5.224 7 5.5V7H5.5C5.224 7 5 7.224 5 7.5C5 7.776 5.224 8 5.5 8H7V9.5C7 9.776 7.224 10 7.5 10C7.776 10 8 9.776 8 9.5V8H9.5C9.776 8 10 7.776 10 7.5C10 7.224 9.776 7 9.5 7Z'],
    "book": ['M2.5 2C1.67157 2 1 2.67157 1 3.5V12.5C1 13.3284 1.67157 14 2.5 14H6C6.8178 14 7.54389 13.6073 8 13.0002C8.45612 13.6073 9.1822 14 10 14H13.5C14.3284 14 15 13.3284 15 12.5V3.5C15 2.67157 14.3284 2 13.5 2H10C9.1822 2 8.45612 2.39267 8 2.99976C7.54389 2.39267 6.8178 2 6 2H2.5ZM7.5 4.5V11.5C7.5 12.3284 6.82843 13 6 13H2.5C2.22386 13 2 12.7761 2 12.5V3.5C2 3.22386 2.22386 3 2.5 3H6C6.82843 3 7.5 3.67157 7.5 4.5ZM8.5 11.5V4.5C8.5 3.67157 9.17157 3 10 3H13.5C13.7761 3 14 3.22386 14 3.5V12.5C14 12.7761 13.7761 13 13.5 13H10C9.17157 13 8.5 12.3284 8.5 11.5Z'],
    "gear": ['M7.99997 6C6.89497 6 5.99997 6.895 5.99997 8C5.99997 9.105 6.89497 10 7.99997 10C9.10497 10 9.99997 9.105 9.99997 8C9.99997 6.895 9.10497 6 7.99997 6ZM7.99997 9C7.44797 9 6.99997 8.552 6.99997 8C6.99997 7.448 7.44797 7 7.99997 7C8.55197 7 8.99997 7.448 8.99997 8C8.99997 8.552 8.55197 9 7.99997 9ZM14.565 9.715L13.279 8.628C13.245 8.599 13.213 8.567 13.184 8.533C12.888 8.186 12.931 7.667 13.279 7.372L14.565 6.285C14.693 6.177 14.742 6.003 14.691 5.844C14.386 4.903 13.882 4.04 13.219 3.308C13.139 3.22 13.027 3.172 12.912 3.172C12.865 3.172 12.818 3.18 12.773 3.196L11.186 3.761C11.144 3.776 11.1 3.788 11.056 3.796C11.006 3.805 10.956 3.81 10.907 3.81C10.515 3.81 10.167 3.532 10.094 3.134L9.79097 1.482C9.76097 1.318 9.63397 1.188 9.46997 1.153C8.98997 1.051 8.49897 1 8.00097 1C7.50297 1 7.01097 1.052 6.53097 1.153C6.36697 1.188 6.23997 1.318 6.20997 1.482L5.90797 3.134C5.89997 3.178 5.88797 3.221 5.87297 3.263C5.75197 3.6 5.43397 3.81 5.09397 3.81C5.00197 3.81 4.90797 3.794 4.81597 3.762L3.22897 3.197C3.18397 3.181 3.13597 3.173 3.08997 3.173C2.97497 3.173 2.86297 3.221 2.78297 3.309C2.11897 4.041 1.61597 4.904 1.30997 5.845C1.25797 6.004 1.30797 6.178 1.43597 6.286L2.72197 7.373C2.75597 7.402 2.78797 7.434 2.81697 7.468C3.11297 7.815 3.06997 8.334 2.72197 8.629L1.43597 9.716C1.30797 9.824 1.25897 9.998 1.30997 10.157C1.61497 11.098 2.11897 11.961 2.78297 12.693C2.86297 12.781 2.97497 12.829 3.08997 12.829C3.13697 12.829 3.18397 12.821 3.22897 12.805L4.81597 12.24C4.85797 12.225 4.90197 12.213 4.94597 12.205C4.99597 12.196 5.04597 12.192 5.09497 12.192C5.48697 12.192 5.83497 12.47 5.90797 12.868L6.20997 14.52C6.23997 14.684 6.36697 14.814 6.53097 14.849C7.01097 14.951 7.50297 15.002 8.00097 15.002C8.49897 15.002 8.99097 14.95 9.46997 14.849C9.63397 14.814 9.76097 14.684 9.79097 14.52L10.094 12.868C10.102 12.824 10.114 12.781 10.129 12.739C10.25 12.402 10.568 12.192 10.908 12.192C11 12.192 11.094 12.208 11.186 12.24L12.772 12.805C12.818 12.821 12.865 12.829 12.911 12.829C13.026 12.829 13.138 12.781 13.218 12.693C13.882 11.961 14.385 11.098 14.69 10.157C14.742 9.998 14.692 9.824 14.564 9.716L14.565 9.715ZM12.728 11.726L11.521 11.296C11.323 11.226 11.117 11.19 10.908 11.19C10.139 11.19 9.44697 11.676 9.18797 12.399C9.15397 12.492 9.12897 12.588 9.11097 12.686L8.88097 13.937C8.59097 13.979 8.29597 14 8.00097 14C7.70597 14 7.41097 13.979 7.11997 13.936L6.89097 12.685C6.73197 11.818 5.97697 11.189 5.09497 11.189C4.98697 11.189 4.87697 11.199 4.76597 11.219C4.66897 11.237 4.57397 11.262 4.47997 11.295L3.27297 11.725C2.90497 11.264 2.61097 10.759 2.39397 10.214L3.36797 9.391C3.74097 9.076 3.96797 8.634 4.00797 8.148C4.04797 7.662 3.89497 7.19 3.57797 6.818C3.51397 6.743 3.44297 6.672 3.36797 6.608L2.39397 5.785C2.61097 5.24 2.90497 4.734 3.27297 4.274L4.47997 4.704C4.67797 4.774 4.88397 4.81 5.09397 4.81C5.86297 4.81 6.55497 4.324 6.81397 3.601C6.84797 3.507 6.87297 3.411 6.89097 3.314L7.11997 2.063C7.41097 2.021 7.70597 1.999 8.00097 1.999C8.29597 1.999 8.59097 2.02 8.88097 2.062L9.10997 3.313C9.26897 4.18 10.024 4.809 10.906 4.809C11.014 4.809 11.124 4.799 11.234 4.779C11.331 4.761 11.427 4.736 11.521 4.703L12.728 4.273C13.096 4.733 13.39 5.239 13.607 5.784L12.634 6.607C12.261 6.922 12.033 7.364 11.994 7.85C11.954 8.336 12.107 8.809 12.424 9.18C12.489 9.256 12.559 9.326 12.635 9.39L13.609 10.213C13.392 10.758 13.098 11.264 12.73 11.724L12.728 11.726Z'],
    "ellipsis": ['M5 8C5 8.55229 4.55228 9 4 9C3.44772 9 3 8.55229 3 8C3 7.44772 3.44772 7 4 7C4.55228 7 5 7.44772 5 8ZM9 8C9 8.55229 8.55229 9 8 9C7.44772 9 7 8.55229 7 8C7 7.44772 7.44772 7 8 7C8.55229 7 9 7.44772 9 8ZM12 9C12.5523 9 13 8.55229 13 8C13 7.44772 12.5523 7 12 7C11.4477 7 11 7.44772 11 8C11 8.55229 11.4477 9 12 9Z'],
    "list-flat": ['M2 3.5C2 3.224 2.224 3 2.5 3H10.5C10.776 3 11 3.224 11 3.5C11 3.776 10.776 4 10.5 4H2.5C2.224 4 2 3.776 2 3.5ZM13.5 6H2.5C2.224 6 2 6.224 2 6.5C2 6.776 2.224 7 2.5 7H13.5C13.776 7 14 6.776 14 6.5C14 6.224 13.776 6 13.5 6ZM9.5 9H2.5C2.224 9 2 9.224 2 9.5C2 9.776 2.224 10 2.5 10H9.5C9.776 10 10 9.776 10 9.5C10 9.224 9.776 9 9.5 9Z','M2.5 12H11.5C11.776 12 12 12.224 12 12.5C12 12.776 11.776 13 11.5 13H2.5C2.224 13 2 12.776 2 12.5C2 12.224 2.224 12 2.5 12Z'],
    "list-tree": ['M2 3.5C2 3.22386 2.22386 3 2.5 3H13.5C13.7761 3 14 3.22386 14 3.5C14 3.77614 13.7761 4 13.5 4H6V6H13.5C13.7761 6 14 6.22386 14 6.5C14 6.77614 13.7761 7 13.5 7H6V9H13.5C13.7761 9 14 9.22386 14 9.5C14 9.77614 13.7761 10 13.5 10H6V12H13.5C13.7761 12 14 12.2239 14 12.5C14 12.7761 13.7761 13 13.5 13H5.5C5.22386 13 5 12.7761 5 12.5V4H2.5C2.22386 4 2 3.77614 2 3.5Z'],
    "chevron-down": ['M3.14598 5.85423L7.64598 10.3542C7.84098 10.5492 8.15798 10.5492 8.35298 10.3542L12.853 5.85423C13.048 5.65923 13.048 5.34223 12.853 5.14723C12.658 4.95223 12.341 4.95223 12.146 5.14723L7.99998 9.29323L3.85398 5.14723C3.65898 4.95223 3.34198 4.95223 3.14698 5.14723C2.95198 5.34223 2.95098 5.65923 3.14598 5.85423Z'],
    "arrow-left": ['M13.5 8.00023H3.70701L7.85301 3.85423C8.04801 3.65923 8.04801 3.34223 7.85301 3.14723C7.65801 2.95223 7.34101 2.95223 7.14601 3.14723L2.14601 8.14723C1.95101 8.34223 1.95101 8.65923 2.14601 8.85423L7.14601 13.8542C7.24401 13.9522 7.37201 14.0002 7.50001 14.0002C7.62801 14.0002 7.75601 13.9512 7.85401 13.8542C8.04901 13.6592 8.04901 13.3422 7.85401 13.1472L3.70801 9.00123H13.501C13.777 9.00123 14.001 8.77723 14.001 8.50123C14.001 8.22523 13.777 8.00123 13.501 8.00123L13.5 8.00023Z'],
  });
  /** The web page's own icons (web/index.html), and a few more drawn alike: 24×24, stroked. */
  const WEB = /** @type {Record<string, (string | string[])[]>} */ ({
    'collapse-all': ['M7 4l5 5 5-5M7 20l5-5 5 5'],
    'expand-all': ['M7 9l5-5 5 5M7 15l5 5 5-5'],
    copy: ['M5 15V6a2 2 0 0 1 2-2h8', 'M9 11a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2z'],
    book: ['M5 4h6a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H5zM19 4h-6v16a2 2 0 0 1 2-2h4z'],
    'arrow-left': ['M19 12H5M11 6l-6 6 6 6'],
    gear: ['M18.47 9.32L21.36 10.37L21.36 13.63L18.47 14.68L19.77 17.46L17.46 19.77L14.68 18.47L13.63 21.36L10.37 21.36L9.32 18.47L6.54 19.77L4.23 17.46L5.53 14.68L2.64 13.63L2.64 10.37L5.53 9.32L4.23 6.54L6.54 4.23L9.32 5.53L10.37 2.64L13.63 2.64L14.68 5.53L17.46 4.23L19.77 6.54Z', 'M15 12a3 3 0 1 1-6 0a3 3 0 1 1 6 0z'],
    'chevron-down': ['M7 10l5 5 5-5'],
  });

  function icon(/** @type {string} */ name) {
    const web = variant === 'v3';
    const s = document.createElementNS(NS, 'svg');
    s.setAttribute('aria-hidden', 'true');
    s.setAttribute('viewBox', web ? '0 0 24 24' : '0 0 16 16');
    s.classList.add('hdr-ico', web ? 'stroke' : 'fill');
    for (const p of (web ? WEB : CODICONS)[name]) {
      const [d, rule] = Array.isArray(p) ? p : [p];
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', d);
      if (rule) path.setAttribute('fill-rule', rule);
      s.append(path);
    }
    return s;
  }

  /** A button drawn as an icon; its name (set by panel.js) is the hidden .lbl and the tooltip. */
  function iconButton(/** @type {string} */ id, /** @type {string} */ name) {
    const b = $(id);
    const lbl = document.createElement('span');
    lbl.className = 'lbl sr-only';
    b.classList.add('hdr-btn');
    b.replaceChildren(icon(name), lbl);
    return b;
  }

  /** A select drawn as a dropdown, with its arrow (the CSP allows no image, so no CSS arrow) and its label for screen readers only. */
  function dropdown(/** @type {string} */ key) {
    const box = $(`${key}-box`);
    const sel = $(key);
    $(`${key}-label`).classList.add('sr-only');
    const wrap = document.createElement('span');
    wrap.className = 'hdr-select';
    sel.replaceWith(wrap);
    wrap.append(sel, icon('chevron-down'));
    box.classList.add('hdr-pick');
    return box;
  }

  // The labels, to tell "Collapse all" from "Expand all" when panel.js renames the toggle.
  /** @type {any} */
  let labels = {};
  window.addEventListener('message', (e) => {
    if (e.data && e.data.labels) labels = e.data.labels;
  });
  /** The toggle and the reference button change their icon with their name. */
  function follow(/** @type {string} */ id, /** @type {() => string} */ which) {
    const b = $(id);
    const lbl = b.querySelector('.lbl');
    if (!lbl) return;
    new MutationObserver(() => {
      const svg = b.querySelector('svg.hdr-ico');
      if (svg) svg.replaceWith(icon(which()));
      if (id === 'ref' && variant !== 'v2') b.setAttribute('aria-pressed', String(!$('reference').hidden));
    }).observe(lbl, { childList: true, characterData: true, subtree: true });
  }

  const header = /** @type {HTMLElement} */ (document.querySelector('#top > header'));
  const tools = /** @type {HTMLElement} */ (header.querySelector('.tools'));
  document.documentElement.classList.add(`hdr-${variant}`);

  if (variant === 'v1' || variant === 'v3') {
    const picks = [dropdown('shell'), dropdown('yq')];
    const actions = document.createElement('div');
    actions.className = 'hdr-actions';
    actions.setAttribute('role', 'toolbar');
    const ref = iconButton('ref', 'book');
    ref.setAttribute('aria-pressed', 'false');
    actions.append(iconButton('toggle', 'collapse-all'), iconButton('copy', 'copy'), ref, iconButton('settings', 'gear'));
    if (variant === 'v1') {
      // The view switch joins the toolbar as two toggles, as VS Code's "View as Tree / List".
      const views = $('views');
      views.classList.add('hdr-views');
      iconButton('view-list', 'list-flat');
      iconButton('view-tree', 'list-tree');
      const sep = () => Object.assign(document.createElement('span'), { className: 'hdr-sep' });
      // (The shell beside the line's name, the toggles after: in a narrow panel they wrap as two rows.)
      tools.before(...picks);
      tools.replaceChildren(views, sep(), actions);
    } else {
      tools.replaceChildren(...picks, actions);
    }
  } else {
    // v2: List/Tree and the shell in a row of their own, the actions in a menu.
    const row = document.createElement('div');
    row.className = 'hdr-row';
    const views = $('views');
    views.classList.add('hdr-seg');
    const more = document.createElement('button');
    more.type = 'button';
    more.id = 'hdr-more';
    more.className = 'hdr-btn';
    more.setAttribute('aria-haspopup', 'menu');
    more.setAttribute('aria-expanded', 'false');
    more.setAttribute('aria-controls', 'hdr-menu');
    more.title = document.documentElement.lang === 'ja' ? 'その他の操作' : 'More actions';
    more.append(icon('ellipsis'), Object.assign(document.createElement('span'), { className: 'sr-only', textContent: more.title }));
    const menu = document.createElement('div');
    menu.id = 'hdr-menu';
    menu.setAttribute('role', 'menu');
    menu.hidden = true;
    const items = ['toggle', 'copy', 'ref', 'settings'].map((id) => {
      const b = $(id);
      const lbl = document.createElement('span');
      lbl.className = 'lbl';
      b.replaceChildren(lbl);
      b.setAttribute('role', 'menuitem');
      b.tabIndex = -1;
      return b;
    });
    menu.append(...items);
    const spacer = Object.assign(document.createElement('span'), { className: 'hdr-spacer' });
    const wrap = Object.assign(document.createElement('div'), { className: 'hdr-more' });
    wrap.append(more, menu);
    row.append(views, dropdown('shell'), dropdown('yq'), spacer, wrap);
    tools.replaceWith(row);

    const open = (/** @type {boolean} */ on, focusFirst = true) => {
      menu.hidden = !on;
      more.setAttribute('aria-expanded', String(on));
      if (on && focusFirst) items[0].focus();
    };
    more.addEventListener('click', () => open(menu.hidden));
    more.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        open(true);
        if (e.key === 'ArrowUp') items[items.length - 1].focus();
      }
    });
    menu.addEventListener('keydown', (e) => {
      const i = items.indexOf(/** @type {HTMLElement} */ (document.activeElement));
      const go = (/** @type {number} */ k) => items[(k + items.length) % items.length].focus();
      if (e.key === 'ArrowDown') go(i + 1);
      else if (e.key === 'ArrowUp') go(i - 1);
      else if (e.key === 'Home') go(0);
      else if (e.key === 'End') go(items.length - 1);
      else if (e.key === 'Escape') {
        open(false);
        more.focus();
      } else if (e.key === 'Tab') open(false);
      else return;
      e.preventDefault();
    });
    // An item does its work (panel.js's handler), then the menu closes.
    for (const b of items) b.addEventListener('click', () => open(false));
    document.addEventListener('pointerdown', (e) => {
      if (!menu.hidden && !wrap.contains(/** @type {Node} */ (e.target))) open(false);
    });
  }

  follow('toggle', () => (($('toggle').querySelector('.lbl')?.textContent ?? '') === labels.expandAll ? 'expand-all' : 'collapse-all'));
  follow('ref', () => ($('reference').hidden ? 'book' : 'arrow-left'));
})();
