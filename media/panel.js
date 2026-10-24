// @ts-check
(function () {
  // @ts-ignore acquireVsCodeApi is injected by VS Code.
  const vscode = acquireVsCodeApi();
  const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

  // ---------------------------------------------------------------- the header's icons and names

  /**
   * The header's icons: Codicons, VS Code's own icons, copied from @vscode/codicons 0.0.46-24 (src/icons/*.svg).
   * The icons are licensed under CC BY 4.0, (c) Microsoft Corporation (https://github.com/microsoft/vscode-codicons;
   * listed in THIRD_PARTY_NOTICES.md). Drawn as inline SVG paths: the webview's CSP allows no font and no image.
   * Each is 16×16, filled with the text's colour; a path is its `d`, or `[d, fill-rule]`.
   */
  const ICONS = /** @type {Record<string, (string | string[])[]>} */ ({
    'collapse-all': ["M14 4.27051C14.5999 4.62053 15 5.26009 15 6V11C15 13.21 13.21 15 11 15H6C5.26009 15 4.62053 14.5999 4.27051 14H11C12.65 14 14 12.65 14 11V4.27051Z", "M9.5 7C9.776 7 10 7.224 10 7.5C10 7.776 9.776 8 9.5 8H5.5C5.224 8 5 7.776 5 7.5C5 7.224 5.224 7 5.5 7H9.5Z", ["M11 2C12.103 2 13 2.897 13 4V11C13 12.103 12.103 13 11 13H4C2.897 13 2 12.103 2 11V4C2 2.897 2.897 2 4 2H11ZM4 3C3.449 3 3 3.449 3 4V11C3 11.552 3.449 12 4 12H11C11.551 12 12 11.552 12 11V4C12 3.449 11.551 3 11 3H4Z", "evenodd"]],
    'expand-all': ["M15 6V11C15 13.21 13.21 15 11 15H6C5.26 15 4.62 14.6 4.27 14H11C12.65 14 14 12.65 14 11V4.27C14.6 4.62 15 5.26 15 6ZM11 13H4C2.897 13 2 12.103 2 11V4C2 2.897 2.897 2 4 2H11C12.103 2 13 2.897 13 4V11C13 12.103 12.103 13 11 13ZM4 12H11C11.551 12 12 11.552 12 11V4C12 3.449 11.551 3 11 3H4C3.449 3 3 3.449 3 4V11C3 11.552 3.449 12 4 12ZM9.5 7H8V5.5C8 5.224 7.776 5 7.5 5C7.224 5 7 5.224 7 5.5V7H5.5C5.224 7 5 7.224 5 7.5C5 7.776 5.224 8 5.5 8H7V9.5C7 9.776 7.224 10 7.5 10C7.776 10 8 9.776 8 9.5V8H9.5C9.776 8 10 7.776 10 7.5C10 7.224 9.776 7 9.5 7Z"],
    'copy': ["M3 5V12.73C2.4 12.38 2 11.74 2 11V5C2 2.79 3.79 1 6 1H9C9.74 1 10.38 1.4 10.73 2H6C4.35 2 3 3.35 3 5ZM11 15H6C4.897 15 4 14.103 4 13V5C4 3.897 4.897 3 6 3H11C12.103 3 13 3.897 13 5V13C13 14.103 12.103 15 11 15ZM12 5C12 4.448 11.552 4 11 4H6C5.448 4 5 4.448 5 5V13C5 13.552 5.448 14 6 14H11C11.552 14 12 13.552 12 13V5Z"],
    'book': ["M2.5 2C1.67157 2 1 2.67157 1 3.5V12.5C1 13.3284 1.67157 14 2.5 14H6C6.8178 14 7.54389 13.6073 8 13.0002C8.45612 13.6073 9.1822 14 10 14H13.5C14.3284 14 15 13.3284 15 12.5V3.5C15 2.67157 14.3284 2 13.5 2H10C9.1822 2 8.45612 2.39267 8 2.99976C7.54389 2.39267 6.8178 2 6 2H2.5ZM7.5 4.5V11.5C7.5 12.3284 6.82843 13 6 13H2.5C2.22386 13 2 12.7761 2 12.5V3.5C2 3.22386 2.22386 3 2.5 3H6C6.82843 3 7.5 3.67157 7.5 4.5ZM8.5 11.5V4.5C8.5 3.67157 9.17157 3 10 3H13.5C13.7761 3 14 3.22386 14 3.5V12.5C14 12.7761 13.7761 13 13.5 13H10C9.17157 13 8.5 12.3284 8.5 11.5Z"],
    'arrow-left': ["M13.5 8.00023H3.70701L7.85301 3.85423C8.04801 3.65923 8.04801 3.34223 7.85301 3.14723C7.65801 2.95223 7.34101 2.95223 7.14601 3.14723L2.14601 8.14723C1.95101 8.34223 1.95101 8.65923 2.14601 8.85423L7.14601 13.8542C7.24401 13.9522 7.37201 14.0002 7.50001 14.0002C7.62801 14.0002 7.75601 13.9512 7.85401 13.8542C8.04901 13.6592 8.04901 13.3422 7.85401 13.1472L3.70801 9.00123H13.501C13.777 9.00123 14.001 8.77723 14.001 8.50123C14.001 8.22523 13.777 8.00123 13.501 8.00123L13.5 8.00023Z"],
    'gear': ["M7.99997 6C6.89497 6 5.99997 6.895 5.99997 8C5.99997 9.105 6.89497 10 7.99997 10C9.10497 10 9.99997 9.105 9.99997 8C9.99997 6.895 9.10497 6 7.99997 6ZM7.99997 9C7.44797 9 6.99997 8.552 6.99997 8C6.99997 7.448 7.44797 7 7.99997 7C8.55197 7 8.99997 7.448 8.99997 8C8.99997 8.552 8.55197 9 7.99997 9ZM14.565 9.715L13.279 8.628C13.245 8.599 13.213 8.567 13.184 8.533C12.888 8.186 12.931 7.667 13.279 7.372L14.565 6.285C14.693 6.177 14.742 6.003 14.691 5.844C14.386 4.903 13.882 4.04 13.219 3.308C13.139 3.22 13.027 3.172 12.912 3.172C12.865 3.172 12.818 3.18 12.773 3.196L11.186 3.761C11.144 3.776 11.1 3.788 11.056 3.796C11.006 3.805 10.956 3.81 10.907 3.81C10.515 3.81 10.167 3.532 10.094 3.134L9.79097 1.482C9.76097 1.318 9.63397 1.188 9.46997 1.153C8.98997 1.051 8.49897 1 8.00097 1C7.50297 1 7.01097 1.052 6.53097 1.153C6.36697 1.188 6.23997 1.318 6.20997 1.482L5.90797 3.134C5.89997 3.178 5.88797 3.221 5.87297 3.263C5.75197 3.6 5.43397 3.81 5.09397 3.81C5.00197 3.81 4.90797 3.794 4.81597 3.762L3.22897 3.197C3.18397 3.181 3.13597 3.173 3.08997 3.173C2.97497 3.173 2.86297 3.221 2.78297 3.309C2.11897 4.041 1.61597 4.904 1.30997 5.845C1.25797 6.004 1.30797 6.178 1.43597 6.286L2.72197 7.373C2.75597 7.402 2.78797 7.434 2.81697 7.468C3.11297 7.815 3.06997 8.334 2.72197 8.629L1.43597 9.716C1.30797 9.824 1.25897 9.998 1.30997 10.157C1.61497 11.098 2.11897 11.961 2.78297 12.693C2.86297 12.781 2.97497 12.829 3.08997 12.829C3.13697 12.829 3.18397 12.821 3.22897 12.805L4.81597 12.24C4.85797 12.225 4.90197 12.213 4.94597 12.205C4.99597 12.196 5.04597 12.192 5.09497 12.192C5.48697 12.192 5.83497 12.47 5.90797 12.868L6.20997 14.52C6.23997 14.684 6.36697 14.814 6.53097 14.849C7.01097 14.951 7.50297 15.002 8.00097 15.002C8.49897 15.002 8.99097 14.95 9.46997 14.849C9.63397 14.814 9.76097 14.684 9.79097 14.52L10.094 12.868C10.102 12.824 10.114 12.781 10.129 12.739C10.25 12.402 10.568 12.192 10.908 12.192C11 12.192 11.094 12.208 11.186 12.24L12.772 12.805C12.818 12.821 12.865 12.829 12.911 12.829C13.026 12.829 13.138 12.781 13.218 12.693C13.882 11.961 14.385 11.098 14.69 10.157C14.742 9.998 14.692 9.824 14.564 9.716L14.565 9.715ZM12.728 11.726L11.521 11.296C11.323 11.226 11.117 11.19 10.908 11.19C10.139 11.19 9.44697 11.676 9.18797 12.399C9.15397 12.492 9.12897 12.588 9.11097 12.686L8.88097 13.937C8.59097 13.979 8.29597 14 8.00097 14C7.70597 14 7.41097 13.979 7.11997 13.936L6.89097 12.685C6.73197 11.818 5.97697 11.189 5.09497 11.189C4.98697 11.189 4.87697 11.199 4.76597 11.219C4.66897 11.237 4.57397 11.262 4.47997 11.295L3.27297 11.725C2.90497 11.264 2.61097 10.759 2.39397 10.214L3.36797 9.391C3.74097 9.076 3.96797 8.634 4.00797 8.148C4.04797 7.662 3.89497 7.19 3.57797 6.818C3.51397 6.743 3.44297 6.672 3.36797 6.608L2.39397 5.785C2.61097 5.24 2.90497 4.734 3.27297 4.274L4.47997 4.704C4.67797 4.774 4.88397 4.81 5.09397 4.81C5.86297 4.81 6.55497 4.324 6.81397 3.601C6.84797 3.507 6.87297 3.411 6.89097 3.314L7.11997 2.063C7.41097 2.021 7.70597 1.999 8.00097 1.999C8.29597 1.999 8.59097 2.02 8.88097 2.062L9.10997 3.313C9.26897 4.18 10.024 4.809 10.906 4.809C11.014 4.809 11.124 4.799 11.234 4.779C11.331 4.761 11.427 4.736 11.521 4.703L12.728 4.273C13.096 4.733 13.39 5.239 13.607 5.784L12.634 6.607C12.261 6.922 12.033 7.364 11.994 7.85C11.954 8.336 12.107 8.809 12.424 9.18C12.489 9.256 12.559 9.326 12.635 9.39L13.609 10.213C13.392 10.758 13.098 11.264 12.73 11.724L12.728 11.726Z"],
    'chevron-down': ["M3.14598 5.85423L7.64598 10.3542C7.84098 10.5492 8.15798 10.5492 8.35298 10.3542L12.853 5.85423C13.048 5.65923 13.048 5.34223 12.853 5.14723C12.658 4.95223 12.341 4.95223 12.146 5.14723L7.99998 9.29323L3.85398 5.14723C3.65898 4.95223 3.34198 4.95223 3.14698 5.14723C2.95198 5.34223 2.95098 5.65923 3.14598 5.85423Z"],
  });
  const SVG = 'http://www.w3.org/2000/svg';

  /** Draws the icon `name` in an <svg> of the markup (PANEL_BODY). */
  function drawIcon(/** @type {Element} */ svg, /** @type {string} */ name) {
    if (svg.getAttribute('data-icon') === name && svg.firstChild) return;
    svg.setAttribute('data-icon', name);
    svg.replaceChildren(...ICONS[name].map((p) => {
      const [d, rule] = Array.isArray(p) ? p : [p];
      const path = document.createElementNS(SVG, 'path');
      path.setAttribute('d', d);
      if (rule) path.setAttribute('fill-rule', rule);
      return path;
    }));
  }
  for (const svg of document.querySelectorAll('svg[data-icon]')) drawIcon(svg, /** @type {string} */ (svg.getAttribute('data-icon')));

  /** Names an icon button: its tooltip and its accessible name; `icon` changes its icon with it. */
  function nameButton(/** @type {string} */ id, /** @type {string} */ name, /** @type {string | undefined} */ icon = undefined) {
    const b = $(id);
    b.title = name;
    b.setAttribute('aria-label', name);
    const svg = b.querySelector('svg');
    if (icon && svg) drawIcon(svg, icon);
  }

  /** The fold button says what it will do: unfold when something is folded, else fold. */
  function nameToggle(/** @type {boolean} */ folded) {
    nameButton('toggle', folded ? labels.expandAll : labels.collapseAll, folded ? 'expand-all' : 'collapse-all');
  }

  /** The quick reference's button: pressed while it is open, and then it says how to go back. */
  function nameRef() {
    const open = !$('reference').hidden;
    nameButton('ref', open ? labels.back : labels.reference, open ? 'arrow-left' : 'book');
    $('ref').setAttribute('aria-pressed', String(open));
  }

  /** @type {Array<{ token: any, el: HTMLElement }>} */
  let flat = [];
  let examplesFirst = true;
  /** @type {HTMLElement[]} */
  let segments = [];
  /** The last rendered update; an identical one is ignored so a text selection survives. */
  let lastUpdate = '';
  /** Paths of the collapsed tree items of the line shown; kept when the same line is drawn again. */
  let collapsedKeys = new Set();
  /** The file and line `collapsedKeys` belongs to. */
  let shownLine = '';
  /** UI strings from the extension. */
  let labels = /** @type {any} */ ({});
  /** The sections of the manual the rows and notes cite: { '3.7.2': { label, title, url } }. */
  let manual = /** @type {Record<string, { label: string, title: string, url: string }>} */ ({});
  /** Editable examples by id: where to show the result of a rerun. */
  /** @type {Map<number, { spec: any, layer: HTMLElement, results: HTMLElement, empty: string }>} */
  const editors = new Map();
  let nextId = 0;
  /** Quick reference entries, loaded on first use. */
  /** @type {Array<{ category: string, syntax: string, meaning: string }> | undefined} */
  let reference;

  /** The view shown ('list' or 'tree') and how many layers the tree shows (1–4): what the viewer chose last. */
  let view = 'list';
  let level = 4;
  applyState(vscode.getState());
  /** The reading tree of the line shown (LineExplanation.reading), if any. */
  let reading = /** @type {any} */ (null);
  /** The line shown (its number in the document). */
  let shownLineNo = 0;
  /** Paths of the folded items of the tree view, and of the one with the focus; kept while the same line is shown. */
  let foldedKeys = new Set();
  let currentKey = '';

  /** True while the user has text selected (a drag to copy should not count as a click). */
  const selecting = () => String(window.getSelection() ?? '').length > 0;

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.type === 'update') {
      const key = JSON.stringify(msg);
      if (key === lastUpdate) return;
      lastUpdate = key;
      render(msg);
    }
    if (msg.type === 'empty') {
      lastUpdate = '';
      showEmpty(msg.message);
      nameButton('settings', msg.settingsLabel);
    }
    if (msg.type === 'rerunResult') {
      const ed = editors.get(msg.id);
      if (ed) showResult(ed, msg.result);
    }
    if (msg.type === 'reference') {
      reference = msg.entries;
      renderReference();
    }
    if (msg.type === 'panelState') {
      applyState(msg.state);
      applyView();
      renderReading();
    }
  });
  vscode.postMessage({ type: 'ready' });

  function showEmpty(/** @type {string} */ message) {
    $('where').textContent = '';
    $('context').textContent = '';
    $('line').replaceChildren();
    $('notes').replaceChildren();
    $('tree').replaceChildren();
    $('examples').replaceChildren();
    $('reading-tree').replaceChildren();
    reading = null;
    $('reading').hidden = true;
    $('empty').textContent = message;
    $('empty').hidden = false;
  }

  function render(msg) {
    const ex = msg.explanation;
    labels = msg.labels ?? labels;
    manual = msg.manual ?? {};
    nameButton('settings', msg.settingsLabel);
    nameButton('copy', labels.copy);
    // The quick reference stays open while the cursor moves; keep its button saying how to go back.
    nameRef();
    nameToggle(false);
    $('ref-search').setAttribute('placeholder', labels.search);
    examplesFirst = msg.examplesFirst !== false;
    $('where').textContent = `${msg.file} · ${msg.lineLabel}`;
    $('context').textContent = msg.contextLabels.length ? ' › ' + msg.contextLabels.join(' › ') : '';
    renderDialect(msg.dialect);

    flat = [];
    editors.clear();
    const where = `${msg.file}\n${ex.line}`;
    if (where !== shownLine) {
      collapsedKeys = new Set();
      foldedKeys = new Set();
      currentKey = '';
    }
    shownLine = where;
    shownLineNo = ex.line;
    reading = ex.reading ?? null;
    const tree = $('tree');
    tree.replaceChildren(...ex.items.map((t, i) => item(t, `${i}`)));

    renderLine(msg.lineText, ex.line, ex.items);

    $('notes').replaceChildren(...ex.notes.map((n) => {
      const p = document.createElement('p');
      p.className = 'note';
      p.append(...inline(n), ...refLinks(ex.facts?.find((f) => f.text === n)?.refs));
      return p;
    }));
    $('examples').replaceChildren(...(ex.examples ?? []).map((e) => example(e, false)));
    $('empty').textContent = msg.emptyMessage;
    $('empty').hidden = ex.items.length > 0;
    applyView();
    renderReading();
  }

  /**
   * The sections of the manual a row or a note is about, as small links (§3.7.2) to their pages. A link opens in
   * the browser: VS Code opens a webview's links outside it, and the web page in a new tab.
   */
  function refLinks(/** @type {string[] | undefined} */ refs) {
    const known = (refs ?? []).filter((id) => manual[id]);
    if (!known.length) return [];
    const box = document.createElement('span');
    box.className = 'refs';
    known.forEach((id, i) => {
      const m = manual[id];
      const a = document.createElement('a');
      a.href = m.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = `§${id}`;
      a.title = `${m.label}: ${m.title}`;
      if (i) box.append(' ');
      box.append(a);
    });
    return [box];
  }

  // ---------------------------------------------------------------- dialect (regex101's flavor)

  function renderDialect(d) {
    if (!d) return;
    const fill = (/** @type {string} */ id, /** @type {string[][] | undefined} */ options, /** @type {string} */ value, /** @type {string} */ label) => {
      const box = $(`${id}-box`);
      box.hidden = !options;
      if (!options) return;
      $(`${id}-label`).textContent = label;
      $(id).title = label;
      const sel = /** @type {HTMLSelectElement} */ ($(id));
      sel.replaceChildren(...options.map(([v, text]) => {
        const o = document.createElement('option');
        o.value = v;
        o.textContent = text;
        return o;
      }));
      sel.value = value;
    };
    fill('shell', d.shells, d.shell, labels.shell);
    fill('yq', d.yqs, d.yq, labels.yq);
  }
  for (const key of ['shell', 'yq']) {
    $(key).addEventListener('change', (e) => {
      vscode.postMessage({ type: 'override', key, value: /** @type {HTMLSelectElement} */ (e.target).value });
    });
  }

  // ---------------------------------------------------------------- examples

  /** One worked example: a heading, then a labelled block per section with one line per row. */
  function example(ex, nested) {
    const box = document.createElement('section');
    box.className = nested ? 'example nested' : 'example';
    const h = document.createElement('h3');
    h.append(...inline(ex.title));
    box.append(h);
    if (ex.note) {
      const note = document.createElement('p');
      note.className = 'example-note';
      note.append(...inline(ex.note));
      box.append(note);
    }
    if (ex.interactive) {
      box.append(...editable(ex.interactive));
      return box;
    }
    box.append(...sections(ex.sections));
    return box;
  }

  function sections(list) {
    return list.flatMap((sec) => {
      const label = document.createElement('div');
      label.className = 'example-label';
      label.append(...inline(sec.label));
      const pre = document.createElement('pre');
      if (sec.lines.length) pre.textContent = sec.lines.join('\n');
      else {
        pre.textContent = sec.empty ?? '';
        pre.classList.add('example-empty');
      }
      return [label, pre];
    });
  }

  /**
   * The inputs as editors (regex101's test string), one per file the command reads: a transparent textarea over a
   * layer that shows the same text with matches highlighted; then the results.
   */
  function editable(it) {
    const id = nextId++;
    const out = [];
    /** @type {{ layer: HTMLElement, area: HTMLTextAreaElement }[]} */
    const boxes = [];
    let timer;
    it.inputs.forEach((input, i) => {
      const label = document.createElement('div');
      label.className = 'example-label';
      label.append(...inline(input.label));
      if (i === 0) {
        const hint = document.createElement('span');
        hint.className = 'hint';
        hint.textContent = ` — ${labels.editHint}`;
        label.append(hint);
      }
      const wrap = document.createElement('div');
      wrap.className = 'editor';
      const layer = document.createElement('pre');
      layer.className = 'layer';
      const area = document.createElement('textarea');
      area.spellcheck = false;
      area.value = input.lines.join('\n');
      wrap.append(layer, area);
      boxes.push({ layer, area });
      // The textarea covers the layer (inset: 0), so it grows with the text the layer shows.
      area.addEventListener('input', () => {
        drawLayer(layer, area.value, undefined);
        clearTimeout(timer);
        timer = setTimeout(() => vscode.postMessage({ type: 'rerun', id, spec: it.spec, inputs: boxes.map((b) => b.area.value) }), 150);
      });
      out.push(label, wrap);
    });
    const results = document.createElement('div');
    const ed = { spec: it.spec, boxes, results, empty: '' };
    editors.set(id, ed);
    drawMarks(ed, it.result.marks);
    showResult(ed, it.result, false);
    return [...out, results];
  }

  /** Each box's text, with the marks of its lines (the marks are per line of all the boxes, in order). */
  function drawMarks(ed, marks) {
    let first = 0;
    for (const { layer, area } of ed.boxes) {
      const count = area.value.split('\n').length;
      drawLayer(layer, area.value, marks && marks.slice(first, first + count));
      first += count;
    }
  }

  function showResult(ed, result, redraw = true) {
    if (redraw && result.marks) drawMarks(ed, result.marks);
    ed.results.replaceChildren(...sections(result.sections));
  }

  /** The text with each match and capture group wrapped in a coloured span. */
  function drawLayer(layer, text, marks) {
    layer.replaceChildren();
    text.split('\n').forEach((line, i) => {
      if (i) layer.append('\n');
      const ms = (marks && marks[i]) || [];
      // For each character, the innermost (highest-numbered) group covering it; -1: none.
      const owner = new Array(line.length).fill(-1);
      for (const m of ms) for (let k = m.start; k < m.end && k < line.length; k++) owner[k] = Math.max(owner[k], m.group);
      let k = 0;
      while (k < line.length) {
        let j = k;
        while (j < line.length && owner[j] === owner[k]) j++;
        const piece = line.slice(k, j);
        if (owner[k] < 0) layer.append(piece);
        else {
          const span = document.createElement('span');
          span.className = owner[k] === 0 ? 'match' : `match grp grp-${((owner[k] - 1) % 6) + 1}`;
          span.textContent = piece;
          layer.append(span);
        }
        k = j;
      }
    });
    // Keep the last line's height when it is empty.
    layer.append('\n');
  }

  // ---------------------------------------------------------------- tree

  /** Tree item for a token and its children. */
  function item(token, path) {
    const li = document.createElement('li');
    li.dataset.path = path;
    const row = document.createElement('div');
    row.className = `row kind-${token.kind}`;
    const twisty = document.createElement('span');
    twisty.className = 'twisty';
    if (token.children.length) {
      twisty.textContent = '▾';
      twisty.addEventListener('click', (e) => {
        e.stopPropagation();
        toggle(li);
      });
    }
    const label = document.createElement('code');
    label.className = token.group ? `label grp-label grp-${((token.group - 1) % 6) + 1}` : 'label';
    // A skeleton: code parts as they are (the label is monospace), placeholders apart in italics.
    const parts = token.labelParts ?? [{ text: token.label }];
    parts.forEach((p, i) => {
      if (i && !p.tight) label.append(' ');
      if (p.placeholder) {
        const ph = document.createElement('span');
        ph.className = 'ph';
        ph.textContent = p.text;
        label.append(ph);
      } else label.append(p.text);
    });
    const text = document.createElement('span');
    text.className = 'text';
    text.append(...inline(token.explanation));
    row.append(twisty, label, text, ...refLinks(token.refs));
    li.append(row);
    if (token.children.length && collapsedKeys.has(path)) setCollapsed(li, true);
    // Examples placed under this token go before (first) or after (last) its parts.
    const examples = (token.examples ?? []).map((e) => example(e, true));
    // What lies under the row (its examples and parts), in one box: the indent guide is drawn beside it.
    const body = document.createElement('div');
    body.className = 'body';
    if (examplesFirst) body.append(...examples);
    const index = flat.length;
    flat.push({ token, el: row });
    row.addEventListener('mouseenter', () => focus(index));
    row.addEventListener('mouseleave', () => focus(-1));
    // As in VS Code's trees: a click on a row with parts folds or unfolds it, and still selects it.
    row.addEventListener('click', (e) => {
      if (selecting()) return;
      if (!(e.target instanceof Element && e.target.closest('a, button, input, textarea, select'))) {
        if (token.children.length) toggle(li);
      }
      reveal(token);
      revealInLine(index);
    });
    if (token.children.length) {
      const ul = document.createElement('ul');
      ul.append(...token.children.map((c, i) => item(c, `${path}.${i}`)));
      body.append(ul);
    }
    if (!examplesFirst) body.append(...examples);
    if (body.childElementCount) li.append(body);
    return li;
  }

  function setCollapsed(/** @type {HTMLElement} */ li, /** @type {boolean} */ want) {
    li.classList.toggle('collapsed', want);
    const path = String(li.dataset.path);
    if (want) collapsedKeys.add(path);
    else collapsedKeys.delete(path);
    const tw = li.querySelector(':scope > .row > .twisty');
    if (tw) tw.textContent = want ? '▸' : '▾';
  }

  function toggle(/** @type {HTMLElement} */ li) {
    setCollapsed(li, !li.classList.contains('collapsed'));
  }

  $('toggle').addEventListener('click', () => {
    if (view === 'tree' && reading) {
      // The tree view: fold everything below the line, or unfold it all.
      const all = /** @type {HTMLElement[]} */ (Array.from($('reading-tree').querySelectorAll('li[aria-expanded]')));
      const fold = !all.some((li) => li.getAttribute('aria-expanded') === 'false');
      for (const li of all) setFolded(li, fold && li.getAttribute('aria-level') !== '1');
      updateToggle();
      return;
    }
    const items = Array.from($('tree').querySelectorAll('li')).filter((li) => li.querySelector(':scope > .body > ul'));
    const collapse = !items.some((li) => li.classList.contains('collapsed'));
    // Collapse below the top level, so the outline stays visible.
    for (const li of items) {
      const top = li.parentElement === $('tree');
      const want = collapse && !top;
      setCollapsed(li, want);
    }
    nameToggle(collapse);
  });
  /** The shared button says what it will do in the view shown: unfold when something is folded, else fold. */
  function updateToggle() {
    const folded = view === 'tree' && reading ? foldedKeys.size > 0 : $('tree').querySelector('li.collapsed') !== null;
    nameToggle(folded);
  }
  $('copy').addEventListener('click', () => vscode.postMessage({ type: 'copy' }));

  /** Colour each character of the line by the deepest token covering it. */
  // The header and the line are sticky together (#top, panel.css): tell the CSS how tall they are, and whether rows are under them.
  function syncLine() {
    const pre = $('line');
    const top = $('top');
    document.documentElement.style.setProperty('--line-h', `${top.offsetHeight}px`);
    top.classList.toggle('stuck', window.scrollY > 0);
  }
  window.addEventListener('scroll', syncLine, { passive: true });
  window.addEventListener('resize', syncLine);

  function renderLine(text, line, items) {
    const owner = new Array(text.length).fill(-1);
    const depthAt = new Array(text.length).fill(-1);
    const visit = (token, depth) => {
      const idx = flat.findIndex((f) => f.token === token);
      const { start, end } = token.span;
      if (start.line <= line && end.line >= line) {
        const from = start.line < line ? 0 : start.character;
        const to = end.line > line ? text.length : end.character;
        for (let i = from; i < to && i < text.length; i++) {
          if (depth >= depthAt[i]) {
            depthAt[i] = depth;
            owner[i] = idx;
          }
        }
      }
      token.children.forEach((c) => visit(c, depth + 1));
    };
    items.forEach((t) => visit(t, 0));

    const pre = $('line');
    pre.replaceChildren();
    requestAnimationFrame(syncLine);
    segments = [];
    let i = 0;
    while (i < text.length) {
      let j = i;
      while (j < text.length && owner[j] === owner[i]) j++;
      const span = document.createElement('span');
      span.textContent = text.slice(i, j);
      span.dataset.from = String(i);
      span.dataset.to = String(j);
      const idx = owner[i];
      if (idx >= 0 && text.slice(i, j).trim()) {
        span.className = `seg kind-${flat[idx].token.kind}`;
        span.dataset.idx = String(idx);
        span.addEventListener('mouseenter', () => focus(idx));
        span.addEventListener('mouseleave', () => focus(-1));
        span.addEventListener('click', () => {
          if (selecting()) return;
          flat[idx].el.scrollIntoView({ block: 'nearest' });
          reveal(flat[idx].token);
        });
      }
      pre.append(span);
      segments.push(span);
      i = j;
    }
    if (!text.length) pre.textContent = ' ';
  }


  // ---------------------------------------------------------------- tree view (src/reading.ts)

  /** The layers, in the order the layer buttons add them. */
  const LEVEL = { bash: 1, child: 2, command: 3, language: 4 };

  /** Tells the host the choice: it keeps it for the next time (VS Code's global state, the web page's storage) and, in the list view, builds no tree. */
  function save() {
    vscode.setState({ view, level });
    vscode.postMessage({ type: 'panelState', state: { view, level } });
  }

  /** The view and layers the viewer chose (VS Code's webview state; on the web page, the page sends them). */
  function applyState(/** @type {any} */ state) {
    if (!state || typeof state !== 'object') return;
    if (state.view === 'tree' || state.view === 'list') view = state.view;
    if ([1, 2, 3, 4].includes(state.level)) level = state.level;
  }

  /** Shows the list or the tree view. */
  function applyView() {
    const tree = view === 'tree';
    const t = labels.tree;
    if (t) {
      $('views').setAttribute('aria-label', labels.views);
      $('view-list').textContent = labels.listView;
      $('view-tree').textContent = labels.treeView;
    }
    $('view-list').setAttribute('aria-pressed', String(!tree));
    $('view-tree').setAttribute('aria-pressed', String(tree));
    $('tree').hidden = tree;
    $('examples').hidden = tree;
    $('reading').hidden = !tree || !reading;
    if (labels.expandAll) updateToggle();
    markLine(null);
  }

  for (const [id, v] of [['view-list', 'list'], ['view-tree', 'tree']]) {
    $(id).addEventListener('click', () => {
      if (view === v) return;
      view = v;
      save();
      applyView();
      renderReading();
    });
  }

  /** The name a node is shown with: its kind (a command name with what it runs), or the language. */
  function chipOf(n) {
    const t = labels.tree;
    if (n.kind === 'line') return t.kinds.line;
    if (n.kind === 'language') return t.languages[n.label] ?? n.label;
    const shell = n.layer === 'bash' || n.layer === 'child';
    // (A word the command reads that is not an option is an operand: bash's arguments are called arguments.)
    const kind = (shell && t.kinds[n.kind]) || (n.layer === 'command' && t.commandKinds[n.kind]) || t.tokenKinds[n.kind] || n.kind;
    return n.resolves && t.resolves[n.resolves] ? `${kind} · ${t.resolves[n.resolves]}` : kind;
  }

  /** Who reads a node: bash, which shell parses it again, the command, or the language and who reads it. */
  function readerOf(n) {
    const r = labels.tree.readers;
    if (n.layer === 'child') return r.child[n.process ?? 'subshell'];
    if (n.layer === 'language' && n.reader === 'bash') return r.bashLanguage;
    return r[n.layer].replace('{name}', n.reader ?? '');
  }

  /** The name at the right of a band: where a new reader takes over. */
  function bandOf(n) {
    const t = labels.tree;
    if (n.layer === 'command') return t.reads.replace('{name}', n.reader ?? '');
    if (n.layer === 'language') return n.kind === 'language' ? chipOf(n) : '';
    if (n.layer === 'child') return t.bands.child[n.process ?? 'subshell'];
    return t.bands.bash;
  }

  /** The role a node's code is coloured with, as the list colours its tokens (`.kind-*`): a node of the other layers has its token's kind. */
  const ROLES = /** @type {Record<string, string>} */ ({
    commandName: 'command', aliasWord: 'command', expandedName: 'variable', argument: 'argument', assignmentArgument: 'assignment',
    word: 'argument', name: 'variable', heredoc: 'redirect', quote: 'string', arithmetic: 'expansion', brace: 'expansion',
    list: 'operator', pipeline: 'operator', command: 'operator', compound: 'keyword', clause: 'keyword', coprocess: 'keyword',
    function: 'keyword', script: 'substitution', part: 'operator',
  });
  const roleOf = (/** @type {any} */ n) => ROLES[n.kind] ?? n.kind;

  /** The kinds whose general text the tree shows already: once each, at their first node (`renderReading`). */
  let aboutShown = new Set();

  /** What a kind is in general, where no token says more about the node: at its first node only, not on every argument. */
  function aboutOf(n) {
    const about = labels.tree.about;
    const key = n.kind === 'language' && n.reader === 'bash' ? 'bashLanguage' : n.kind;
    if (aboutShown.has(key)) return '';
    aboutShown.add(key);
    return about[key] ?? '';
  }

  function renderReading() {
    const ul = $('reading-tree');
    // A new update or layer redraws the tree: the focus goes back to the item it was on.
    const hadFocus = ul.contains(document.activeElement);
    ul.replaceChildren();
    const t = labels.tree;
    if (!t) return;
    ul.setAttribute('aria-label', t.label);
    const box = $('layers');
    box.setAttribute('aria-label', t.show);
    $('layers-label').textContent = t.show;
    // The layer buttons are made once (a click must not take the focus with them) and only updated.
    if (!box.querySelector('button')) {
      t.levels.forEach((/** @type {string} */ _text, /** @type {number} */ i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `layer l-${['bash', 'child', 'command', 'language'][i]}`;
        b.dataset.level = String(i + 1);
        b.addEventListener('click', () => {
          level = i + 1;
          save();
          renderReading();
        });
        box.append(b);
      });
    }
    box.querySelectorAll('button').forEach((b, i) => {
      b.textContent = t.levels[i];
      b.setAttribute('aria-pressed', String(level === i + 1));
    });
    if (!reading || view !== 'tree') return;
    aboutShown = new Set();
    ul.append(treeItem(reading, '0', 1, null, 1, 1));
    const items = visibleItems();
    const current = items.find((li) => li.dataset.path === currentKey) ?? items[0];
    if (current) current.tabIndex = 0;
    if (hadFocus) {
      // (The item itself, or the nearest one above it that is drawn: its layer may be gone.)
      let key = currentKey;
      let again = items.find((li) => li.dataset.path === key);
      while (!again && key.includes('.')) {
        key = key.slice(0, key.lastIndexOf('.'));
        again = items.find((li) => li.dataset.path === key);
      }
      if (again ?? current) focusItem(/** @type {HTMLElement} */ (again ?? current));
    }
  }

  /** A node of the reading tree as an item of the ARIA tree, with the visible layers of its children. */
  function treeItem(n, path, depth, parent, pos, size) {
    const li = document.createElement('li');
    li.setAttribute('role', 'treeitem');
    li.setAttribute('aria-level', String(depth));
    li.setAttribute('aria-posinset', String(pos));
    li.setAttribute('aria-setsize', String(size));
    li.tabIndex = -1;
    li.dataset.path = path;
    li.className = `ti l-${n.layer}`;
    // (A band starts where the reader changes: another layer, another command, another shell.)
    const band = !parent || parent.layer !== n.layer || (n.layer === 'command' && parent.reader !== n.reader)
      || (n.layer === 'child' && parent.process !== n.process);
    if (band) li.classList.add('band');
    const kids = n.children.filter((/** @type {any} */ c) => LEVEL[c.layer] <= level);
    const row = document.createElement('div');
    row.className = 'trow';
    const twisty = document.createElement('span');
    twisty.className = 'twisty';
    twisty.setAttribute('aria-hidden', 'true');
    const folded = foldedKeys.has(path);
    if (kids.length) twisty.textContent = folded ? '▸' : '▾';
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = chipOf(n);
    // The first line: the code in a pill (in the colour of its role, as in the list) and the kind; at its right,
    // where a reader takes over, the reader's name, and the links. The text has a line of its own under them.
    const head = document.createElement('span');
    head.className = 'thead';
    const code = !['line', 'language'].includes(n.kind) ? n.label : '';
    if (code) {
      const c = document.createElement('code');
      c.className = `tcode kind-${roleOf(n)}`;
      c.textContent = code;
      head.append(c);
    }
    head.append(chip);
    const about = n.text ?? aboutOf(n);
    const text = document.createElement('span');
    // (What the kind is in general, where no token says more: quieter than an explanation.)
    text.className = n.text === undefined ? 'text about' : 'text';
    text.append(...inline(about));
    const links = refLinks(n.refs);
    links.forEach((l) => l.querySelectorAll('a').forEach((a) => { a.tabIndex = -1; }));
    const right = document.createElement('span');
    right.className = 'tright';
    const bandName = band ? bandOf(n) : '';
    if (bandName) {
      const b = document.createElement('span');
      b.className = 'band-label';
      b.setAttribute('aria-hidden', 'true');
      b.textContent = bandName;
      right.append(b);
    }
    right.append(...links);
    row.append(twisty, head, right);
    if (about) row.append(text);
    li.setAttribute('aria-label', `${chip.textContent}${code ? ` ${code}` : ''}. ${readerOf(n)}. ${about.replace(/`/g, '')}`);
    li.append(row);
    readingNodes.set(li, n);
    row.addEventListener('mouseenter', () => showNode(n));
    row.addEventListener('mouseleave', () => showNode(focusedNode()));
    row.addEventListener('click', (e) => {
      if (selecting()) return;
      focusItem(li);
      if (kids.length && !(e.target instanceof Element && e.target.closest('a'))) toggleItem(li);
      reveal(n, true);
    });
    if (kids.length) {
      li.setAttribute('aria-expanded', String(!folded));
      const group = document.createElement('ul');
      group.setAttribute('role', 'group');
      group.hidden = folded;
      group.append(...kids.map((/** @type {any} */ c, /** @type {number} */ i) => treeItem(c, `${path}.${n.children.indexOf(c)}`, depth + 1, n, i + 1, kids.length)));
      li.append(group);
    }
    return li;
  }

  /** The nodes of the items drawn. */
  const readingNodes = new WeakMap();

  /** The items not inside a folded one, in order. */
  function visibleItems() {
    return /** @type {HTMLElement[]} */ (Array.from($('reading-tree').querySelectorAll('li[role="treeitem"]')))
      .filter((li) => !li.parentElement?.closest('ul[role="group"][hidden]'));
  }

  function focusedNode() {
    const li = document.activeElement instanceof HTMLElement && document.activeElement.closest('#reading-tree li[role="treeitem"]');
    return li ? readingNodes.get(li) : null;
  }

  function focusItem(/** @type {HTMLElement} */ li) {
    $('reading-tree').querySelectorAll('li[tabindex="0"]').forEach((x) => { /** @type {HTMLElement} */ (x).tabIndex = -1; });
    li.tabIndex = 0;
    currentKey = String(li.dataset.path);
    li.focus();
  }

  function toggleItem(/** @type {HTMLElement} */ li) {
    const group = li.querySelector(':scope > ul[role="group"]');
    if (!group) return;
    const fold = !/** @type {HTMLElement} */ (group).hidden;
    setFolded(li, fold);
  }

  function setFolded(/** @type {HTMLElement} */ li, /** @type {boolean} */ fold) {
    const group = /** @type {HTMLElement | null} */ (li.querySelector(':scope > ul[role="group"]'));
    if (!group) return;
    group.hidden = fold;
    li.setAttribute('aria-expanded', String(!fold));
    const path = String(li.dataset.path);
    if (fold) foldedKeys.add(path);
    else foldedKeys.delete(path);
    if (fold) {
      // What was hidden cannot keep the focus or the Tab stop: they go to this item.
      if (group.contains(document.activeElement)) focusItem(li);
      else if (group.querySelector('li[tabindex="0"]')) {
        group.querySelectorAll('li[tabindex="0"]').forEach((x) => { /** @type {HTMLElement} */ (x).tabIndex = -1; });
        li.tabIndex = 0;
        currentKey = path;
      }
    }
    const tw = li.querySelector(':scope > .trow > .twisty');
    if (tw) tw.textContent = fold ? '▸' : '▾';
  }

  /** Highlights a node: its row, its characters in the line, its range in the editor (null: none). */
  function showNode(n) {
    $('reading-tree').querySelectorAll('.trow.active').forEach((r) => r.classList.remove('active'));
    if (n) {
      for (const li of visibleItems()) if (readingNodes.get(li) === n) li.querySelector(':scope > .trow')?.classList.add('active');
    }
    markLine(n ? n.span : null);
    vscode.postMessage({ type: 'highlight', span: n ? n.span : null });
  }

  /** Marks the characters of a span in the line at the top (the tree view's highlight). */
  function markLine(span) {
    for (const s of segments) {
      const from = Number(s.dataset.from), to = Number(s.dataset.to);
      let on = false;
      if (span && span.start.line <= shownLineNo && span.end.line >= shownLineNo) {
        const a = span.start.line < shownLineNo ? 0 : span.start.character;
        const b = span.end.line > shownLineNo ? Infinity : span.end.character;
        on = from < b && a < to;
      }
      s.classList.toggle('mark', on);
    }
  }

  /** The links of an item's row are in the Tab order only while the item has the focus: Tab goes into them, and on past the tree. */
  function linksTabbable(/** @type {HTMLElement | null} */ li) {
    $('reading-tree').querySelectorAll('.refs a').forEach((a) => {
      /** @type {HTMLAnchorElement} */ (a).tabIndex = li && a.closest('li') === li ? 0 : -1;
    });
  }

  $('reading-tree').addEventListener('focusin', (e) => {
    const li = e.target instanceof HTMLElement ? /** @type {HTMLElement | null} */ (e.target.closest('li[role="treeitem"]')) : null;
    linksTabbable(li);
    if (li) showNode(readingNodes.get(li));
  });
  $('reading-tree').addEventListener('focusout', (e) => {
    if (!(e.relatedTarget instanceof Node && $('reading-tree').contains(e.relatedTarget))) {
      linksTabbable(null);
      showNode(null);
    }
  });

  // The keys of the ARIA tree pattern.
  $('reading-tree').addEventListener('keydown', (e) => {
    const li = e.target instanceof HTMLElement ? /** @type {HTMLElement | null} */ (e.target.closest('li[role="treeitem"]')) : null;
    if (!li) return;
    // A key on one of the item's links is the link's (Enter follows it).
    if (e.target instanceof Element && e.target.closest('a') && (e.key === 'Enter' || e.key === ' ')) return;
    const items = visibleItems();
    const i = items.indexOf(li);
    const group = /** @type {HTMLElement | null} */ (li.querySelector(':scope > ul[role="group"]'));
    let next = /** @type {HTMLElement | null | undefined} */ (null);
    switch (e.key) {
      case 'ArrowDown': next = items[i + 1]; break;
      case 'ArrowUp': next = items[i - 1]; break;
      case 'Home': next = items[0]; break;
      case 'End': next = items[items.length - 1]; break;
      case 'ArrowRight':
        if (group && group.hidden) setFolded(li, false);
        else if (group) next = /** @type {HTMLElement} */ (group.firstElementChild);
        break;
      case 'ArrowLeft':
        if (group && !group.hidden) setFolded(li, true);
        else next = /** @type {HTMLElement | null} */ (li.parentElement?.closest('li[role="treeitem"]') ?? null);
        break;
      case 'Enter':
      case ' ':
        toggleItem(li);
        reveal(readingNodes.get(li), true);
        break;
      default:
        return;
    }
    e.preventDefault();
    if (next) {
      focusItem(next);
      next.scrollIntoView({ block: 'nearest' });
    }
  });

  /** Selects a token's range in the editor. Not one over several lines (an if, a loop, a function): the cursor would move to its last
      line, and the panel with it, when one only meant to fold the row; the hover already shows that range. */
  function reveal(token, /** @type {boolean} */ keepFocus = false) {
    if (token.span.start.line === token.span.end.line) vscode.postMessage({ type: 'reveal', span: token.span, preserveFocus: keepFocus });
  }

  /** The rows of a token and of all its parts. */
  function coveredBy(idx) {
    const covered = new Set();
    if (idx >= 0) {
      const mark = (t) => {
        covered.add(flat.findIndex((f) => f.token === t));
        t.children.forEach(mark);
      };
      mark(flat[idx].token);
    }
    return covered;
  }

  /** Scrolls the line sideways to a token's characters, as the editor does when the row is selected. */
  function revealInLine(idx) {
    const pre = $('line');
    const covered = coveredBy(idx);
    const shown = segments.filter((s) => covered.has(Number(s.dataset.idx)));
    if (!shown.length) return;
    const box = pre.getBoundingClientRect();
    const pad = parseFloat(getComputedStyle(pre).paddingLeft);
    const left = Math.min(...shown.map((s) => s.getBoundingClientRect().left)) - box.left + pre.scrollLeft;
    const right = Math.max(...shown.map((s) => s.getBoundingClientRect().right)) - box.left + pre.scrollLeft;
    if (left - pad < pre.scrollLeft) pre.scrollLeft = left - pad;
    else if (right + pad > pre.scrollLeft + pre.clientWidth) pre.scrollLeft = Math.min(left - pad, right + pad - pre.clientWidth);
  }

  /** Highlight a token in the tree, its characters in the line, and its range in the editor. */
  function focus(idx) {
    flat.forEach((f, i) => f.el.classList.toggle('active', i === idx));
    const covered = coveredBy(idx);
    segments.forEach((s) => s.classList.toggle('active', covered.has(Number(s.dataset.idx))));
    vscode.postMessage({ type: 'highlight', span: idx >= 0 ? flat[idx].token.span : null });
  }

  // ---------------------------------------------------------------- quick reference

  $('ref').addEventListener('click', () => {
    const open = $('reference').hidden;
    $('reference').hidden = !open;
    $('main').hidden = open;
    $('line').hidden = open;
    nameRef();
    if (open) {
      if (!reference) vscode.postMessage({ type: 'reference' });
      else renderReference();
      // Not on a touch screen: focusing the field would open the on-screen keyboard over the list.
      if (window.matchMedia('(pointer: fine)').matches) $('ref-search').focus();
    }
  });
  $('ref-search').addEventListener('input', () => renderReference());

  function renderReference() {
    if (!reference) return;
    const q = /** @type {HTMLInputElement} */ ($('ref-search')).value.trim().toLowerCase();
    const hits = reference.filter((e) => !q || e.syntax.toLowerCase().includes(q) || e.meaning.toLowerCase().includes(q) || e.category.toLowerCase().includes(q));
    const list = $('ref-list');
    list.replaceChildren();
    if (!hits.length) {
      const p = document.createElement('p');
      p.className = 'example-empty';
      p.textContent = labels.noMatch;
      list.append(p);
      return;
    }
    let category = '';
    for (const e of hits.slice(0, 300)) {
      if (e.category !== category) {
        category = e.category;
        const h = document.createElement('h3');
        h.textContent = category;
        list.append(h);
      }
      const row = document.createElement('div');
      row.className = 'ref-row';
      const code = document.createElement('code');
      code.textContent = e.syntax;
      const text = document.createElement('span');
      text.append(...inline(e.meaning));
      row.append(code, text);
      list.append(row);
    }
  }

  /** Render `code` spans in explanation text without using innerHTML. */
  function inline(text) {
    return text.split(/(`[^`]+`)/).filter(Boolean).map((part) => {
      if (part.startsWith('`') && part.endsWith('`') && part.length > 1) {
        const c = document.createElement('code');
        c.textContent = part.slice(1, -1);
        return c;
      }
      return document.createTextNode(part);
    });
  }
  $('settings').addEventListener('click', () => vscode.postMessage({ type: 'openSettings' }));
})();
