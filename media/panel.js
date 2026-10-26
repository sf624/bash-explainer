// @ts-check
(function () {
  // @ts-ignore acquireVsCodeApi is injected by VS Code.
  const vscode = acquireVsCodeApi();
  const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

  // ---------------------------------------------------------------- the header's icons and names

  /** The header's icons: Codicons, from media/icons.js (loaded before this script; the web page draws the same table). */
  const drawIcon = /** @type {(svg: Element, name: string) => void} */ (/** @type {any} */ (globalThis).BashExplainerIcons.drawIcon);
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
  /** The control pictures (`\u240a`) with the name drawn for each (`LF`) and what it stands for, from the extension (`controlMarks`, src/ctlchars.ts). */
  let controlMarks = /** @type {Record<string, [string, string]>} */ ({});
  /** The references the rows and notes cite: { '3.7.2': { text: '§3.7.2', label, title, url }, 'execve(2)': … }. */
  let manual = /** @type {Record<string, { text: string, label: string, title: string, url: string }>} */ ({});
  /** Said after a reference link's name: where it opens ("(opens in a new tab)"). */
  let linkNote = '';
  /** Editable examples by id: where to show the result of a rerun. */
  /** @type {Map<number, { spec: any, layer: HTMLElement, results: HTMLElement, empty: string }>} */
  const editors = new Map();
  let nextId = 0;
  /** Quick reference entries, loaded on first use. */
  /** @type {Array<{ category: string, syntax: string, meaning: string }> | undefined} */
  let reference;

  /**
   * The view shown: always the one view (prototype B, `drawList`), drawn in the list (`#tree`); 'tree' is the old
   * reading tree, no longer offered. `step` is the depth shown (1–4, see STEPS): what the viewer chose last.
   */
  let view = 'list';
  let step = 1;
  /** Whether the examples are drawn open (prototype B: folded unless the viewer opened one). */
  let examplesOpen = false;
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

  /**
   * The colours of the editor's theme (`bashExplainer.panel.colors`, VS Code only). When the host asks (`themeWatch`),
   * the panel tells it what it draws text on and its own colour of each role (`themeBase`), now and whenever the
   * theme changes; the host answers with the role colours to set (`themeColours`; none: the panel's own).
   */
  let themeVars = /** @type {string[]} */ ([]);
  let themeWatching = false;
  let themeSent = '';
  let themeTimer = 0;
  const THEME_ROLES = ['command', 'builtin', 'option', 'argument', 'string', 'number', 'keyword', 'operator', 'redirect', 'pattern', 'variable', 'assignment', 'comment', 'shebang'];
  function setThemeVars(/** @type {Record<string, string>} */ vars) {
    for (const k of themeVars) document.body.style.removeProperty(k);
    themeVars = Object.keys(vars);
    for (const [k, v] of Object.entries(vars)) document.body.style.setProperty(k, v);
  }
  function postThemeBase() {
    if (!themeWatching) return;
    // The panel's own colours, read with the theme's taken off (and put back at once: nothing is drawn in between).
    const set = Object.fromEntries(themeVars.map((k) => [k, document.body.style.getPropertyValue(k)]));
    setThemeVars({});
    const probe = document.createElement('span');
    probe.hidden = true;
    document.body.append(probe);
    const classic = Object.fromEntries(THEME_ROLES.map((r) => {
      probe.className = `kind-${r}`;
      return [r, getComputedStyle(probe).color];
    }));
    probe.remove();
    setThemeVars(set);
    const css = getComputedStyle(document.documentElement);
    const v = (/** @type {string} */ name) => css.getPropertyValue(name).trim();
    const backgrounds = [v('--vscode-editor-background') || getComputedStyle(document.body).backgroundColor, v('--vscode-textCodeBlock-background') || 'rgba(127, 127, 127, 0.1)', v('--vscode-list-hoverBackground')].filter(Boolean);
    const cls = document.body.classList;
    const base = { highContrast: cls.contains('vscode-high-contrast') || cls.contains('vscode-high-contrast-light'), backgrounds, foreground: v('--vscode-editor-foreground') || v('--vscode-foreground'), classic };
    const key = JSON.stringify(base);
    if (key === themeSent) return;
    themeSent = key;
    vscode.postMessage({ type: 'themeBase', base });
  }
  // VS Code sets the theme's colours on <html> and its kind as a class of <body>.
  new MutationObserver(() => {
    clearTimeout(themeTimer);
    themeTimer = setTimeout(postThemeBase, 50);
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
  new MutationObserver(() => {
    clearTimeout(themeTimer);
    themeTimer = setTimeout(postThemeBase, 50);
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] });

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.type === 'themeWatch') {
      themeWatching = msg.on;
      themeSent = '';
      if (!msg.on) setThemeVars({});
      postThemeBase();
    }
    if (msg.type === 'themeColours') setThemeVars(msg.vars);
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
    if (msg.type === 'focus') focusExplanation();
    if (msg.type === 'panelState') {
      const was = step;
      applyState(msg.state);
      if (step !== was) {
        dropSpacer();
        collapsedKeys = new Set();
        drawList();
      }
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
    shownItems = [];
    shownNotes = [];
    shownAround = [];
    measureDepths();
    dropSpacer();
    $('reading').hidden = true;
    $('empty').textContent = message;
    $('empty').hidden = false;
  }

  function render(msg) {
    const ex = msg.explanation;
    labels = msg.labels ?? labels;
    controlMarks = msg.controlMarks ?? controlMarks;
    if (msg.lang) document.documentElement.lang = msg.lang;
    manual = msg.manual ?? {};
    linkNote = msg.linkNote ?? '';
    nameButton('settings', msg.settingsLabel);
    nameButton('copy', labels.copy);
    // The quick reference stays open while the cursor moves; keep its button saying how to go back.
    nameRef();
    nameToggle(false);
    $('ref-search').setAttribute('placeholder', labels.search);
    examplesFirst = msg.examplesFirst !== false;
    animations = msg.animations !== false;
    $('where').textContent = `${msg.file} · ${msg.lineLabel}`;
    $('context').textContent = msg.contextLabels.length ? ' › ' + msg.contextLabels.join(' › ') : '';
    renderDialect(msg.dialect);

    flat = [];
    editors.clear();
    const where = `${msg.file}\n${ex.line}`;
    if (where !== shownLine) {
      // A new line is drawn anew: what was folded, and the room kept below the old one, go.
      dropSpacer();
      collapsedKeys = new Set();
      foldedKeys = new Set();
      currentKey = '';
    }
    // The same line drawn again (its problems came, the settings changed): a fold button or a link of the list that had the
    // focus gets it back in the new rows.
    const kept = where === shownLine ? focusInList() : null;
    shownLine = where;
    shownLineNo = ex.line;
    reading = ex.reading ?? null;
    shownItems = ex.items;
    shownRest = ex.examples ?? [];
    shownText = msg.lineText;
    shownMarks = msg.marks ?? [];
    shownNotes = msg.notes ?? [];
    shownAround = msg.around ?? [];
    levelLabels = msg.levelLabels ?? {};
    measureDepths();
    drawList();
    const tree = $('tree');
    if (kept) {
      const row = tree.querySelector(`li[data-path="${kept.path}"] > .row`);
      const target = row && (kept.link < 0 ? row.querySelector(':scope > button.twisty') : row.querySelectorAll('.refs a')[kept.link]);
      if (target instanceof HTMLElement) target.focus({ preventScroll: true });
    }

    // (The notes: on the row of the word each is about, the others above the rows; `drawList`.)
    $('empty').textContent = msg.emptyMessage;
    $('empty').hidden = ex.items.length > 0;
    applyView();
    renderReading();
  }

  /**
   * The references a row or a note cites, as small links (§3.7.2, execve(2)) to their pages. A link opens in
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
      a.textContent = m.text;
      a.title = `${m.label}: ${m.title}`;
      // (A screen reader hears where it is, what it is about, and that it opens outside the panel.)
      // (Japanese runs its full-width parenthesis on: "§3.7.2 …（新しいタブで開く）".)
      a.setAttribute('aria-label', `${m.text} ${m.title}${linkNote.startsWith('(') ? ' ' : ''}${linkNote}`);
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

  /** Section labels that say the input is made up (src/examples/source.ts, `streamLabel`; the names a glob is tried on). */
  const MADE_UP = /made-up|sample contents|sample output|Names to try|仮の行|中身の例|出力の例|試す名前/;

  /** One worked example: a heading, then a labelled block per section with one line per row. */
  function example(ex, nested) {
    // (Prototype B: an example folds by its title, folded at first; opening or folding one is kept for the next ones.
    // A title says when the input is made up.)
    const box = /** @type {HTMLDetailsElement} */ (document.createElement('details'));
    box.open = examplesOpen;
    box.className = nested ? 'example nested' : 'example';
    const h = document.createElement('h3');
    h.append(...inline(ex.title));
    if (labels.depth && MADE_UP.test(JSON.stringify([ex.sections, ex.interactive]))) h.append(el('span', { class: 'u-madeup' }, `${labels.depth.madeUp}${ex.interactive ? labels.depth.editable : ''}`));
    const summary = document.createElement('summary');
    summary.append(h);
    summary.addEventListener('click', () => {
      examplesOpen = !box.open;
      save();
    });
    box.append(summary);
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
      if (sec.words) return [label, wordList(sec, label)];
      const pre = document.createElement('pre');
      if (sec.lines.length) {
        pre.append(...(sec.marks ? markedLines(sec.lines, sec.marks) : withMarks(sec.lines.join('\n'))));
        sideways(pre);
      } else {
        pre.textContent = sec.empty ?? '';
        pre.classList.add('example-empty');
      }
      return [label, pre];
    });
  }

  /**
   * A section of words (`ExampleSection.words`: the words of a brace expansion): the words as chips in a row, as the
   * words of a value (`valueLine`), so that they read as separate arguments, not lines of output. A list, named by the
   * section's label, so that a screen reader says how many words there are; then what is said after them (the cut).
   */
  function wordList(/** @type {any} */ sec, /** @type {HTMLElement} */ label) {
    const box = document.createElement('div');
    box.className = 'example-words';
    if (!sec.lines.length) {
      box.classList.add('example-empty');
      box.textContent = sec.empty ?? '';
      return box;
    }
    label.id = `example-words-${nextId++}`;
    const list = document.createElement('ul');
    // (A list with no bullets is still a list: Safari drops the role of one styled with `list-style: none`.)
    list.setAttribute('role', 'list');
    list.setAttribute('aria-labelledby', label.id);
    sec.lines.forEach((/** @type {string} */ w, /** @type {number} */ i) => {
      const li = document.createElement('li');
      li.append(wordChip(w, sec.words.ends[i], sec.words.spaceLabel));
      list.append(li);
    });
    box.append(list);
    if (sec.words.after) {
      const after = document.createElement('span');
      after.className = 'example-words-after';
      after.append(...inline(sec.words.after).map((n) => {
        if (!(n instanceof HTMLElement) || n.textContent !== '\u2423') return n;
        const c = document.createElement('code');
        c.append(spaceMark(sec.words.spaceLabel));
        return c;
      }));
      box.append(after);
    }
    return box;
  }

  /**
   * The lines of a section that the next stage of a pipeline reads (`ExampleSection.marks`, src/examples/marks.ts): what
   * it matches or takes in a mark, named for a screen reader before it ("matched by `grep nginx`"), and the lines it
   * leaves out dimmer.
   */
  function markedLines(/** @type {string[]} */ lines, /** @type {any} */ marks) {
    const out = [];
    lines.forEach((line, i) => {
      if (i) out.push('\n');
      const row = document.createElement('span');
      row.className = marks.dropped?.includes(i) ? 'ex-row ex-left-out' : 'ex-row';
      let at = 0;
      for (const [start, end] of marks.ranges[i] ?? []) {
        row.append(...withMarks(line.slice(at, start)));
        const m = document.createElement('mark');
        m.className = 'ex-read';
        m.title = marks.said.replace(/`/g, '');
        const said = document.createElement('span');
        said.className = 'sr-only';
        said.append(...inline(marks.said), document.documentElement.lang === 'ja' ? '：' : ': ');
        m.append(said, ...withMarks(line.slice(start, end)));
        row.append(m);
        at = end;
      }
      row.append(...withMarks(line.slice(at)));
      out.push(row);
    });
    return out;
  }

  /**
   * A section's lines scroll sideways when they are wider than it. It starts scrolled so that its first mark is in view,
   * with the marks after it as far as they fit (the header row scrolls with the rows: they are one block), until the user
   * scrolls it; and its edges fade where more lies beyond them (`ex-more-left`, `ex-more-right`).
   */
  function sideways(/** @type {HTMLElement} */ pre) {
    const state = { placed: -1, user: false };
    const edges = () => {
      const max = pre.scrollWidth - pre.clientWidth;
      pre.classList.toggle('ex-more-left', max > 1 && pre.scrollLeft > 1);
      pre.classList.toggle('ex-more-right', max > 1 && pre.scrollLeft < max - 1);
    };
    const place = () => {
      const marks = [...pre.querySelectorAll('mark.ex-read')];
      if (!marks.length || state.user || !pre.clientWidth) return;
      const box = pre.getBoundingClientRect();
      const x = (/** @type {Element} */ m) => m.getBoundingClientRect().left - box.left + pre.scrollLeft;
      const firstLeft = x(marks[0]);
      const firstRight = firstLeft + marks[0].getBoundingClientRect().width;
      const right = Math.max(...marks.map((m) => x(m) + m.getBoundingClientRect().width));
      // A margin wider than the fade at an edge (2em, panel.css), so that no mark is under it.
      const em = parseFloat(getComputedStyle(pre).fontSize);
      const pad = em * 3;
      const width = pre.clientWidth;
      let left = Math.min(right + pad - width, firstLeft - pad);
      if (firstRight + pad - width > left) left = firstLeft - pad;
      // (No scroll of a few pixels: the marks are clear of the fade without it.)
      if (left < pad && right <= width - em * 2.5) left = 0;
      pre.scrollLeft = Math.max(0, Math.round(left));
      state.placed = pre.scrollLeft;
    };
    pre.addEventListener('scroll', () => {
      if (Math.abs(pre.scrollLeft - state.placed) > 1) state.user = true;
      edges();
    }, { passive: true });
    sizes.observe(pre);
    sized.set(pre, () => { place(); edges(); });
  }

  /** The sections that scroll sideways, placed again when their width changes (shown, or the panel resized). */
  const sized = new WeakMap();
  const sizes = new ResizeObserver((entries) => {
    for (const e of entries) {
      if (!e.target.isConnected) sizes.unobserve(e.target);
      else sized.get(e.target)?.();
    }
  });

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
      // (Named by its label: "Input: `a.txt` (sample contents) — Editable…".)
      label.id = `example-input-${nextId++}`;
      area.setAttribute('aria-labelledby', label.id);
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

  // ---------------------------------------------------------------- what a command name is

  /**
   * The badge of what a command name is (`Token.name`, src/namefacts.ts): the kind's word, with what the kind is as
   * its tooltip; and who looks the name up, when another command does ("run by `sudo`"). The extension gives the texts.
   */
  function nameBadge(/** @type {any} */ name) {
    if (!name) return [];
    const b = document.createElement('span');
    b.className = `nk-badge nk-${name.runs}`;
    b.textContent = name.said.kind;
    b.title = name.said.title;
    if (!name.said.by) return [b];
    const by = document.createElement('span');
    by.className = 'nk-by';
    by.append(...inline(name.said.by));
    return [b, by];
  }

  /** The muted line on what else the same name is, and the code that reaches it; null on a name with no other meaning. */
  function nameAlso(/** @type {any} */ name) {
    if (!name?.said.also) return null;
    const d = document.createElement('span');
    d.className = 'nk-also';
    d.append(...inline(name.said.also));
    return d;
  }

  /**
   * A space at an end of a shown text: a real space in an element that CSS draws (`.ev-sp`), with a name for a screen
   * reader (`label`): the glyph for it (`␠`) is a box where no font has it.
   */
  function spaceMark(/** @type {string | undefined} */ label) {
    const m = document.createElement('span');
    m.className = 'ev-sp';
    m.setAttribute('role', 'img');
    m.setAttribute('aria-label', label || '');
    m.textContent = ' ';
    return m;
  }

  /** A word as a chip with an edge; `ends`: how many characters at each end are marks of a space (`spaceMark`). */
  function wordChip(/** @type {string} */ text, /** @type {number[] | undefined} */ ends, /** @type {string | undefined} */ label) {
    const c = document.createElement('code');
    c.className = 'ev-word';
    const [before, after] = ends || [0, 0];
    const chars = [...text];
    for (let i = 0; i < before; i++) c.append(spaceMark(label));
    c.append(...withMarks(chars.slice(before, chars.length - after).join('')));
    for (let i = 0; i < after; i++) c.append(spaceMark(label));
    return c;
  }

  /**
   * The value of an expansion where it runs (`Token.value`, docs/design/expansion-values.md): the model's, from the
   * script's assignments, on a line of its own under the meaning. The value and the words splitting makes of it are
   * chips, so that separate words read as separate (`ValueSaid`, src/messages.ts, gives the texts).
   */
  function valueLine(/** @type {any} */ value) {
    if (!value) return null;
    const s = value.said;
    const d = document.createElement('span');
    d.className = 'ev-value';
    const space = () => spaceMark(s.spaceLabel);
    const chip = (/** @type {string} */ text, /** @type {number[] | undefined} */ ends) => wordChip(text, ends, s.spaceLabel);
    const lead = document.createElement('span');
    lead.className = 'ev-lead';
    lead.textContent = `${s.lead} `;
    d.append(lead, s.value !== undefined ? chip(s.value, s.valueEnds) : s.empty);
    if (s.split) {
      d.append(...inline(s.split.said));
      s.split.words.forEach((w, i) => d.append(' ', chip(w, s.split.wordEnds[i])));
    }
    if (s.tail) {
      // (The note that names the mark shows it the same way.)
      d.append(...inline(s.tail).map((n) => {
        if (!(n instanceof HTMLElement) || n.textContent !== '\u2423') return n;
        const c = document.createElement('code');
        c.append(space());
        return c;
      }));
    }
    return d;
  }

  /** A role (`u-chip`), or where a reader takes over (`u-reads`: "grep reads"), in the colour of its reader. */
  function chipEl(/** @type {any} */ c) {
    if (c.reads) return el('span', { class: `u-reads l-${c.layer}` }, c.reads);
    const e = el('span', { class: `u-chip l-${c.layer}` }, c.text);
    if (c.title) e.title = c.title;
    return e;
  }

  /** What the badge says, for a screen reader: "builtin, run by sudo" (`NameSaid.spoken`). */
  const nameSpoken = (/** @type {any} */ name) => (name ? name.said.spoken : '');

  // ---------------------------------------------------------------- tree

  /** Tree item for a token and its children. */
  function item(token, path) {
    const li = document.createElement('li');
    li.dataset.path = path;
    const row = document.createElement('div');
    row.className = `row kind-${token.kind}`;
    // A row with parts folds with its twisty: a button for the keyboard and a screen reader (named by the row's label,
    // its state in `aria-expanded`); the glyph is only drawn. A row with no parts keeps the room of one.
    const twisty = document.createElement(token.children.length ? 'button' : 'span');
    twisty.className = 'twisty';
    if (token.children.length) {
      const b = /** @type {HTMLButtonElement} */ (twisty);
      b.type = 'button';
      b.setAttribute('aria-label', String(labels.partsOf ?? '{name}').replace('{name}', token.label));
      b.setAttribute('aria-expanded', 'true');
      b.append(el('span', { 'aria-hidden': 'true' }, '▾'));
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
    const also = nameAlso(token.name);
    if (also) text.append(also);
    const value = valueLine(token.value);
    if (value) text.append(value);
    // (Prototype B: the roles from depth 2 on, and the texts of the other readers of the same part, each with its role.)
    for (const x of token.extra ?? []) {
      const line = el('span', { class: 'u-extra' }, chipEl(x.chip));
      if (x.text) line.append(' ', ...inline(x.text));
      text.append(line);
    }
    row.append(twisty, label, ...nameBadge(token.name), ...(token.chips ?? []).map(chipEl), text, ...refLinks(token.refs));
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

  /** What of the list's rows has the focus: a row's fold button (`link` -1) or its link number `link`; null: nothing there. */
  function focusInList() {
    const a = document.activeElement;
    const li = a instanceof HTMLElement && $('tree').contains(a) ? /** @type {HTMLElement | null} */ (a.closest('li[data-path]')) : null;
    if (!li || !a) return null;
    const row = li.querySelector(':scope > .row');
    if (a.matches('button.twisty')) return { path: String(li.dataset.path), link: -1 };
    const links = row ? Array.from(row.querySelectorAll('.refs a')) : [];
    return links.includes(a) ? { path: String(li.dataset.path), link: links.indexOf(a) } : null;
  }

  /** Folds or unfolds an item of the list; the change returned says how what lies under it moves (see `fold`). */
  function setCollapsed(/** @type {HTMLElement} */ li, /** @type {boolean} */ want) {
    li.classList.toggle('collapsed', want);
    const path = String(li.dataset.path);
    if (want) collapsedKeys.add(path);
    else collapsedKeys.delete(path);
    const tw = li.querySelector(':scope > .row > button.twisty');
    if (tw) {
      tw.setAttribute('aria-expanded', String(!want));
      /** @type {Element} */ (tw.firstElementChild).textContent = want ? '▸' : '▾';
    }
    const body = /** @type {HTMLElement | null} */ (li.querySelector(':scope > .body'));
    return body && { el: body, open: !want };
  }

  const isCollapsed = (/** @type {HTMLElement} */ li) => li.classList.contains('collapsed');

  function toggle(/** @type {HTMLElement} */ li) {
    hold(rowAt('list', String(li.dataset.path)));
    fold([setCollapsed(li, !isCollapsed(li))]);
    alignRows();
  }

  $('toggle').addEventListener('click', () => {
    if (view === 'tree' && reading) {
      // The tree view: fold everything below the line, or unfold it all.
      const all = /** @type {HTMLElement[]} */ (Array.from($('reading-tree').querySelectorAll('li[aria-expanded]')));
      const close = !all.some((li) => li.getAttribute('aria-expanded') === 'false');
      const want = (/** @type {HTMLElement} */ li) => close && li.getAttribute('aria-level') !== '1';
      // (The first row on the screen that stays drawn stays where it is, and so do the controls, as for a step.)
      const below = $('layers').getBoundingClientRect().bottom;
      hold(firstOnScreen(visibleItems(), 'reading', below, (li) => !close || Number(li.getAttribute('aria-level')) <= 2), stuckRange(), below);
      fold(all.filter((li) => want(li) !== (li.getAttribute('aria-expanded') === 'false')).map((li) => setFolded(li, want(li))));
      updateToggle();
      return;
    }
    const items = Array.from($('tree').querySelectorAll('li')).filter((li) => li.querySelector(':scope > .body > ul'));
    const collapse = !items.some(isCollapsed);
    // Collapse below the top level, so the outline stays visible.
    const want = (/** @type {HTMLElement} */ li) => collapse && li.parentElement !== $('tree');
    // (The first row on the screen that stays drawn stays where it is: a top-level row or one of its parts.)
    const top = (/** @type {Element | null | undefined} */ li) => li?.parentElement === $('tree');
    const shownItems = /** @type {HTMLElement[]} */ (Array.from($('tree').querySelectorAll('li[data-path]'))).filter((li) => li.getClientRects().length);
    const below = $('top').getBoundingClientRect().bottom;
    hold(firstOnScreen(shownItems, 'list', below, (li) => !collapse || top(li) || top(li.parentElement?.closest('li'))), null, below);
    fold(items.filter((li) => want(li) !== isCollapsed(li)).map((li) => setCollapsed(li, want(li))));
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
    // (And the tree view's steps, which stay under them: a row scrolled into view goes below both.)
    const steps = $('layers');
    const on = !$('layers').hidden;
    document.documentElement.style.setProperty('--controls-h', `${on ? steps.offsetHeight : 0}px`);
    steps.classList.toggle('stuck', on && window.scrollY > 0 && steps.getBoundingClientRect().top <= top.offsetHeight + 1);
  }
  window.addEventListener('scroll', syncLine, { passive: true });
  window.addEventListener('resize', syncLine);

  function renderLine(text, line, items, marks = []) {
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
      // (Under the problems of the line, the editor's squiggle: a warning wins over an information.)
      const mark = marks.filter((/** @type {any} */ m) => m.from < j && i < m.to).sort((/** @type {any} */ a, /** @type {any} */ b) => (a.level === 'warning' ? -1 : 0) - (b.level === 'warning' ? -1 : 0))[0];
      if (mark && text.slice(i, j).trim()) span.classList.add('squiggle', `squiggle-${mark.level}`);
      pre.append(span);
      segments.push(span);
      i = j;
    }
    if (!text.length) pre.textContent = ' ';
  }


  // ---------------------------------------------------------------- tree view (src/reading.ts)

  /** The layers, in the order the steps add them. */
  const LEVEL = /** @type {Record<string, number>} */ ({ bash: 1, child: 2, command: 3, language: 4 });

  /**
   * The steps of the tree view, from the line alone to every layer. Steps 1 to 5 unfold bash's own reading by the
   * kind of its nodes: the line, its lists and pipelines, its commands, their words, and what is inside the words
   * (quotes, expansions, the scripts of substitutions as bash reads them). Steps 6 to 8 add the other readers: the
   * scripts inside (a child shell), each command's reading of its arguments, and the languages.
   */
  const STEPS = 2;
  /** (Prototype B) Whether the program's side is shown: what each program receives, and what bash reads itself. */
  let who = false;
  /** (Prototype B) Whether the viewer hid the line under the controls that says what the depth shows (then the key says it). */
  let captionsHidden = false;
  /** (Round 7) Whether the reserved words and separators of compound commands are drawn as rows at depth 2. */
  let keywordsShown = false;
  const BASH_STEP = /** @type {Record<string, number>} */ ({
    line: 1, list: 2, andList: 2, orList: 2, pipeline: 2, command: 3, compound: 3, clause: 3, coprocess: 3, function: 3, part: 3,
    commandName: 4, aliasWord: 4, expandedName: 4, option: 4, argument: 4, assignmentArgument: 4, word: 4, name: 4,
    assignment: 4, redirect: 4, heredoc: 4, operator: 4, keyword: 4, comment: 4, shebang: 4, expression: 4, descriptor: 4, delimiter: 4,
  });
  /** The step a node appears at by itself: in bash's reading by its kind (5: a part of a word), else its layer's. */
  const ownStep = (/** @type {any} */ n) => (n.layer === 'bash' ? BASH_STEP[n.kind] ?? 5 : LEVEL[n.layer] + 4);
  /** The layer a step shows up to (1–4). */
  const levelOf = (/** @type {number} */ s) => Math.max(1, s - 4);

  /** Tells the host the choice: it keeps it for the next time (VS Code's global state, the web page's storage) and, in the list view, builds no tree. */
  function save() {
    // (`view: 'tree'`: the hosts build the reading tree, which the one view is drawn from.)
    const state = { view: 'tree', depth: step, who, examples: examplesOpen ? 'open' : 'closed', ...(captionsHidden ? { captions: 'hidden' } : {}), ...(keywordsShown ? { keywords: 'shown' } : {}) };
    vscode.setState(state);
    vscode.postMessage({ type: 'panelState', state });
  }

  /** The view and step the viewer chose (VS Code's webview state; on the web page, the page sends them). */
  function applyState(/** @type {any} */ state) {
    if (!state || typeof state !== 'object') return;
    // (Prototype B: one view, and the depth the viewer chose; the old view and its eight steps are not read.)
    // (Round 3's third depth, who reads each word, is now the program's side shown over depth 2.)
    if (Number.isInteger(state.depth) && state.depth >= 1 && state.depth <= 3) step = Math.min(state.depth, STEPS);
    if (typeof state.who === 'boolean') who = state.who;
    else if (state.depth === 3) who = true;
    if (state.examples === 'open' || state.examples === 'closed') examplesOpen = state.examples === 'open';
    captionsHidden = state.captions === 'hidden';
    keywordsShown = state.keywords === 'shown';
  }

  /** Shows the list or the tree view. */
  function applyView() {
    // (Prototype B: no switch of views; the depth control stands in for it, shown when there is a reading tree.)
    view = 'list';
    $('views').hidden = true;
    $('layers').hidden = !reading;
    const cap = document.getElementById('depth-caption');
    if (cap) cap.hidden = !reading;
    const tree = false;
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
    requestAnimationFrame(syncLine);
  }

  for (const [id, v] of [['view-list', 'list'], ['view-tree', 'tree']]) {
    $(id).addEventListener('click', () => {
      if (view === v) return;
      dropSpacer();
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
    // (A command another runs is a command name too, as bash's own are: its badge says what it is, and who runs it.)
    const named = n.name && ['command', 'builtin', 'function', 'alias'].includes(n.kind);
    // (A word that bash expands first: the command reads each word that comes out, not the word as written. When it is the value of an option too, the first of those words is the value.)
    if (n.layer === 'command' && n.expands && n.valueFor) return t.valueExpands.replace('{flag}', n.valueFor);
    // (A word the command reads as the value of an option says so, not that it is an operand.)
    if (n.layer === 'command' && n.valueFor) return t.valueFor.replace('{flag}', n.valueFor);
    let kind = (named && t.kinds.commandName) || (shell && t.kinds[n.kind]) || (n.layer === 'command' && t.commandKinds[n.kind]) || t.tokenKinds[n.kind] || n.kind;
    if (n.layer === 'command' && n.expands && t.expands[n.expands]) kind = t.expands[n.expands].replace('{kind}', kind);
    // (A command name's badge says what it runs.)
    return n.resolves && !n.name && t.resolves[n.resolves] ? `${kind} · ${t.resolves[n.resolves]}` : kind;
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
    commandName: 'command', aliasWord: 'command', expandedName: 'variable', argument: 'argument', assignmentArgument: 'name',
    word: 'argument', name: 'name', heredoc: 'redirect', quote: 'string', arithmetic: 'expansion', brace: 'expansion',
    list: 'operator', andList: 'operator', orList: 'operator', pipeline: 'operator', command: 'operator', compound: 'keyword', clause: 'keyword', coprocess: 'keyword',
    function: 'keyword', script: 'substitution', part: 'operator', expression: 'operator', descriptor: 'redirect', delimiter: 'redirect',
  });
  const roleOf = (/** @type {any} */ n) => ROLES[n.kind] ?? n.kind;


  /** The step each node of the line shown appears at: its own, or its parent's when that is later (a node is drawn under its parent). */
  let appear = /** @type {WeakMap<object, number>} */ (new WeakMap());
  /** How many nodes each step adds to the line (index 0: step 1); a step that adds none is passed over by the arrows. */
  let added = /** @type {number[]} */ (new Array(STEPS).fill(0));
  /**
   * The nodes that show what their kind is in general (where no token says more): for each kind, the first node to
   * appear, by step and then in order. The text stays on that node from step to step, and is not on every argument.
   */
  let aboutAt = /** @type {Set<object>} */ (new Set());

  // (A language's own tokens have no general text: its `keyword` is not bash's reserved word.)
  const aboutKey = (/** @type {any} */ n) => (n.kind === 'language' ? (n.reader === 'bash' ? 'bashLanguage' : 'language') : n.layer === 'language' ? '' : n.kind);

  /** Reads the steps of the line shown: when each node appears, what each step adds, and where the general texts go. */
  function measureSteps() {
    appear = new WeakMap();
    added = new Array(STEPS).fill(0);
    aboutAt = new Set();
    if (!reading) return;
    /** @type {Map<string, { node: object, at: number }>} */
    const first = new Map();
    const walk = (/** @type {any} */ n, /** @type {number} */ from) => {
      const at = Math.max(from, ownStep(n));
      appear.set(n, at);
      added[at - 1]++;
      if (n.text === undefined) {
        const o = first.get(aboutKey(n));
        if (!o || at < o.at) first.set(aboutKey(n), { node: n, at });
      }
      n.children.forEach((/** @type {any} */ c) => walk(c, at));
    };
    walk(reading, 1);
    for (const o of first.values()) aboutAt.add(o.node);
  }

  /** Whether a node is drawn at the step shown. */
  const shown = (/** @type {any} */ c) => (appear.get(c) ?? 1) <= step;

  /** What a kind is in general, where no token says more about the node (see `aboutAt`). */
  function aboutOf(/** @type {any} */ n) {
    return aboutAt.has(n) ? labels.tree.about[aboutKey(n)] ?? '' : '';
  }

  function renderReading() {
    // (A step back whose rows are still shrinking: the tree is drawn at the step now.)
    flushMotion();
    const ul = $('reading-tree');
    // A new update or step redraws the tree: the focus goes back to the item it was on.
    const hadFocus = ul.contains(document.activeElement);
    ul.replaceChildren();
    const t = labels.tree;
    if (!t) return;
    ul.setAttribute('aria-label', t.label);
    renderControls();
    if (!reading || view !== 'tree') return;
    ul.append(treeItem(reading, '0', 1, null, 1, 1));
    const items = visibleItems();
    const current = items.find((li) => li.dataset.path === currentKey) ?? items[0];
    if (current) current.tabIndex = 0;
    if (hadFocus) {
      // (The item itself, or the nearest one above it that is drawn: its step may be past.)
      let key = currentKey;
      let again = items.find((li) => li.dataset.path === key);
      while (!again && key.includes('.')) {
        key = key.slice(0, key.lastIndexOf('.'));
        again = items.find((li) => li.dataset.path === key);
      }
      if (again ?? current) focusItem(/** @type {HTMLElement} */ (again ?? current));
    }
  }

  // ---------------------------------------------------------------- one view with a depth (prototype B)

  /*
   * Prototype B: one view, drawn in the list (`#tree`) from the reading tree (src/reading.ts), at the step chosen.
   * 1 What it does: each command (by its name) and what it does, what it reads each word as, its redirections; the
   *   lists, the compound commands and the conditions of `[[ ]]`.
   * 2 Syntax: reserved words and operators, each simple command whole with its command name, and the parts of each
   *   word (quotes, expansions, literal text, patterns), with their roles and the sections of the manual.
   * 3 Who reads each word: bash, or the command it is passed to (a green fill), and what bash runs for each name.
   * The rows are built once for the line, each with the step it comes in at; a row comes in no later than its parts,
   * and an example has one place (the last thing under the row of its range), so a step deeper only adds rows and
   * lines, and never moves a row. Nodes about the same text (bash's argument, its quotes, the command's operand) are
   * one row, each saying its part.
   */

  /** The tokens, the examples left for the end, the text, problems, notes and blocks around of the line shown. */
  let shownItems = /** @type {any[]} */ ([]);
  let shownRest = /** @type {any[]} */ ([]);
  let shownText = '';
  let shownMarks = /** @type {any[]} */ ([]);
  let shownNotes = /** @type {any[]} */ ([]);
  let shownAround = /** @type {any[]} */ ([]);
  let levelLabels = /** @type {Record<string, string>} */ ({});
  /** The rows of the line shown, at every step (`buildRows`), and the examples left for the end. */
  let built = /** @type {{ rows: any[], rest: any[] } | null} */ (null);
  /** The outermost token of the list for each range of the line shown. */
  let tokenAt = /** @type {Map<string, any>} */ (new Map());

  const spanKey = (/** @type {any} */ s) => `${s.start.line}:${s.start.character}-${s.end.line}:${s.end.character}`;
  const posCmp = (/** @type {any} */ a, /** @type {any} */ b) => a.line - b.line || a.character - b.character;
  const spanCovers = (/** @type {any} */ outer, /** @type {any} */ inner) => posCmp(outer.start, inner.start) <= 0 && posCmp(inner.end, outer.end) <= 0;
  /** The kinds of the first word of a simple command. */
  const NAMES = new Set(['commandName', 'aliasWord', 'expandedName']);
  /** The kinds whose parts are parts of a word (an operator there is an escape or a glob's, not bash's syntax). */
  const WORDISH = new Set(['argument', 'assignmentArgument', 'word', 'quote', 'expansion', 'substitution', 'arithmetic', 'brace', 'commandName', 'expandedName', 'string']);
  /** The parts of a word, and bash's syntax: their texts come in at step 2. */
  const PART_KINDS = new Set(['quote', 'expansion', 'substitution', 'arithmetic', 'brace', 'string', 'pattern', 'number', 'keyword', 'operator', 'name']);
  const hasText = (/** @type {any} */ n) => typeof n.text === 'string' && n.text !== '';
  const isReader = (/** @type {any} */ m) => m.layer === 'command' || m.layer === 'language';
  /** A simple command as bash reads it (not a command another one runs). */
  const isSimple = (/** @type {any} */ m) => m.kind === 'command' && !isReader(m);

  /** The step at which a node's own text is said. */
  function textStep(/** @type {any} */ m, /** @type {any} */ parent) {
    if (isReader(m)) return 1;
    if (PART_KINDS.has(m.kind)) return 2;
    // (A word of a conditional expression, `config.ini` in `[[ -f config.ini ]]`: the syntax of the expression.)
    if (m.kind === 'word' && parent && (parent.kind === 'expression' || WORDISH.has(parent.kind))) return 2;
    return 1;
  }

  /** The source text of a range on the line shown (else the node's label). */
  function sourceOf(/** @type {any} */ n) {
    const sp = n.span;
    return sp.start.line === shownLineNo && sp.end.line === shownLineNo ? shownText.slice(sp.start.character, sp.end.character) : n.label;
  }

  /** The kind of quotes of a quote node: `double`, `single`, `ansi`; none for `"$@"` and the like. */
  function quoteKind(/** @type {any} */ q) {
    if (q.label.includes('@')) return '';
    if (q.label.startsWith("$'")) return 'ansi';
    if (q.label.startsWith('"')) return 'double';
    if (q.label.startsWith("'")) return 'single';
    return '';
  }

  /** "an option": the kind with its article, in English. */
  const article = (/** @type {string} */ k) => (document.documentElement.lang === 'ja' ? k : `${/^[aeiou]/i.test(k) ? 'an' : 'a'} ${k}`);
  /** Code in a text: `x`. */
  const codeOf = (/** @type {string} */ s) => `\`${s}\``;

  /** A node and those about the same text under it, and the other parts in the order of the text. */
  function groupOf(/** @type {any} */ n) {
    const members = [n];
    const rest = /** @type {{ node: any, parent: any }[]} */ ([]);
    const visit = (/** @type {any} */ x) => {
      for (const c of x.children) {
        // (A command's name is a row of its own, also when it is the whole command: `sort`.)
        if (x.kind !== 'line' && spanKey(c.span) === spanKey(x.span) && !(isSimple(x) && NAMES.has(c.kind))) {
          members.push(c);
          visit(c);
        } else rest.push({ node: c, parent: x });
      }
    };
    visit(n);
    rest.sort((a, b) => posCmp(a.node.span.start, b.node.span.start));
    return { members, rest };
  }

  /** Who reads a row: bash, the command or language that takes over, or the shell that parses a script again. */
  function readerKeyOf(/** @type {any[]} */ members) {
    const r = [...members].reverse().find(isReader);
    if (r) return `${r.layer}:${r.reader ?? ''}`;
    const c = members.find((m) => m.layer === 'child');
    return c ? `child:${c.process ?? 'subshell'}` : 'bash';
  }

  /** The expansions bash makes in a group of nodes (not in what a command reads, nor in a script inside). */
  function expansionsIn(/** @type {any[]} */ members) {
    const out = /** @type {any[]} */ ([]);
    const walk = (/** @type {any} */ x) => {
      if (x.layer !== 'bash') return;
      if (x.kind === 'expansion' || x.kind === 'substitution' || x.kind === 'arithmetic') out.push(x);
      if (x.kind !== 'substitution') x.children.forEach(walk);
    };
    members.forEach(walk);
    return [...new Set(out)];
  }

  /** Where the value of an expansion comes from, said short: "`$USER`: the user name", "`$backup`: set on line 1". */
  function fromText(/** @type {any} */ x) {
    const f = labels.depth.from;
    const code = codeOf(x.label);
    if (x.from.meaning) return f.meaning.replace('{code}', code).replace('{text}', x.from.meaning);
    return (x.from.loop ? f.loop : f.line).replace('{code}', code).replace('{n}', String(x.from.line));
  }

  /**
   * A text too long for one line, at step 1, with a remark in parentheses at its end ("Extended test `[[ ]]`:
   * evaluates a condition (bash-only; …)"): its head at the step, and the remark from step 2 on, on a line of its own.
   */
  function splitLong(/** @type {string} */ text) {
    if (text.length <= 90 || !/[)）]$/.test(text)) return [text];
    // (Round 7: the remark is the last parenthesis of the text, matched from its end: a parenthesis inside the head,
    // `成功（終了ステータス 0）を返す（…）`, stays in the head.)
    let depth = 0;
    for (let i = text.length - 1; i >= 0; i--) {
      if (text[i] === ')' || text[i] === '）') depth++;
      else if ((text[i] === '(' || text[i] === '（') && --depth === 0) {
        const head = text.slice(0, i).trimEnd();
        return head.length >= 12 && head.length <= 80 ? [head, text.slice(i + 1, -1)] : [text];
      }
    }
    return [text];
  }

  /** The texts of a row from the members that say something, the reader's first; their steps. */
  function memberTexts(/** @type {any[]} */ members, /** @type {any} */ parent, /** @type {boolean} */ nameRow) {
    const texts = /** @type {{ text: string, step: number, cls?: string }[]} */ ([]);
    const said = new Set();
    for (const m of [...members.filter(isReader).reverse(), ...members.filter((x) => !isReader(x))]) {
      if (!hasText(m) || m.kind === 'quote' || said.has(m.text)) continue;
      said.add(m.text);
      const step = nameRow ? 1 : textStep(m, parent);
      const [head, tail] = step === 1 && !texts.length ? splitLong(m.text) : [m.text];
      texts.push({ text: head, step, kind: m.kind, src: m });
      if (tail) texts.push({ text: tail, step: 2, cls: 'u-text2' });
    }
    return texts;
  }

  /** The kinds of rows that say where the values of the expansions in them come from (a word, an assignment). */
  const VALUED = new Set(['argument', 'assignmentArgument', 'assignment', 'word', 'commandName', 'expandedName']);

  /** A row: its parts are filled in by `plainRow` and `simpleRows`. */
  function newRow(/** @type {any} */ primary, /** @type {any[]} */ members) {
    return {
      members, primary, span: primary.span, keys: new Set(members.map((m) => spanKey(m.span))),
      label: '', labelParts: undefined, group: undefined, kind: '', name: undefined, value: undefined,
      texts: /** @type {{ text: string, step: number, cls?: string, kind?: string, max?: number }[]} */ ([]),
      lines: /** @type {{ text: string, step: number, cls: string, max?: number }[]} */ ([]),
      chips: /** @type {any[]} */ ([]),
      refs: /** @type {string[]} */ ([]),
      reads: /** @type {{ text: string, layer: string } | null} */ (null),
      bash: false, redir: '', read: false, also: null, badge: undefined, badgeText: '',
      defKind: '', quote: '',
      /** @type {any} */ argv: undefined, argv0: false, /** @type {any} */ nameRow: undefined, /** @type {any} */ form: undefined, /** @type {any[] | undefined} */ tildeRows: undefined,
      // (Round 6) `recv`: the row is one word the program receives whole; `struct`: a group of commands or of parts.
      recv: false, struct: false, /** @type {any} */ cond: undefined, /** @type {any} */ progRole: undefined,
      children: /** @type {any[]} */ ([]), examples: /** @type {any[]} */ ([]), problems: /** @type {any[]} */ ([]),
      step: 9, forced: 9, promote: false, drop: false, count: 0,
    };
  }

  /**
   * The row of node `n` (and those about the same text), with its parts; `ctx`: who reads the row above, and the
   * command whose redirections these are. A simple command with a name is two rows (`simpleRows`).
   */
  function buildRow(/** @type {any} */ n, /** @type {any} */ parent, /** @type {any} */ ctx) {
    const { members, rest } = groupOf(n);
    if (isSimple(members[0])) {
      const nameChild = rest.find((r) => NAMES.has(r.node.kind))?.node;
      if (nameChild) return simpleRows(members[0], nameChild, rest, ctx);
    }
    return plainRow(members, rest, parent, ctx);
  }

  /**
   * A simple command with a name: the row of its name says what the command does (from step 1, with what bash runs
   * for it: a program, a builtin), and its arguments are under it. From step 2, a row of the whole command comes
   * above it as a header, with its assignments and redirections beside the name; at step 1 they are drawn in its
   * place. Nothing moves: the name's row says the same at every step.
   */
  function simpleRows(/** @type {any} */ cmd, /** @type {any} */ nameChild, /** @type {any[]} */ rest, /** @type {any} */ ctx) {
    const t = labels.tree;
    const tok = tokenAt.get(spanKey(cmd.span));
    const inner = { readerKey: 'bash', redirectsOf: tok?.kind === 'redirect' ? sourceOf(nameChild) : undefined, removed: cmd.argv?.removed };
    const i = rest.findIndex((r) => r.node === nameChild);
    const before = rest.slice(0, i);
    const after = rest.slice(i + 1);
    const args = after.filter((r) => r.node.kind !== 'redirect');
    const own = after.filter((r) => !args.includes(r));
    const g = groupOf(nameChild);
    const nameRow = plainRow(g.members, g.rest, cmd, { readerKey: 'bash', name: true });
    const argRows = args.map((r) => buildRow(r.node, r.parent, inner));
    nameRow.children.push(...argRows);
    // (Round 6: a row is tinted only when it is one word the program receives whole: not a glob, whose matches it
    // receives, nor a part of a word, `-r` of `-rn`.)
    // (Round 7: the tint says "its result is in the words the program receives": a glob, whose matches it receives,
    // is tinted too.)
    if (cmd.argv) {
      const got = new Set(cmd.argv.words.map((/** @type {any} */ w) => spanKey(w.span)));
      for (const r of argRows) if (got.has(spanKey(r.span))) r.recv = true;
    }
    // (The examples of the command are under its name's row: the header is not drawn at step 1.)
    nameRow.keys.add(spanKey(cmd.span));
    nameRow.value = nameRow.value ?? tok?.value;
    // (A program receives its name too, as argv[0]: the name's row is tinted. A builtin or a function runs inside
    // bash and gets its arguments only (bash calls a builtin with the words after its name; a function's are $1…),
    // so its argv line leaves the name out.)
    const inside = nameRow.kind === 'builtin' || ['builtin', 'function'].includes(nameRow.name?.runs);
    if (cmd.argv && inside) cmd = { ...cmd, argv: { ...cmd.argv, inside: true, words: cmd.argv.words.slice(1), name: cmd.argv.words[0] } };
    nameRow.argv0 = !!cmd.argv && !inside;
    const chip = { text: t.kinds.command, layer: 'bash', def: t.about.command, step: 2 };
    const others = [...before, ...own].map((r) => buildRow(r.node, r.parent, inner));
    // (Every simple command has its header at depth 2, a bare `sort` too: the same shape for all.)
    const head = newRow(cmd, [cmd]);
    head.argv = cmd.argv;
    head.nameRow = nameRow;
    head.keys = new Set();
    head.label = sourceOf(cmd);
    head.kind = 'simple';
    head.chips.push(chip);
    head.refs = [...(cmd.refs ?? [])];
    head.promote = true;
    head.struct = true;
    // (Round 6: every header says what bash does with it, in plain text; the words it receives come under it.)
    head.texts = [{ text: labels.depth.simple.replace('{name}', codeOf(sourceOf(nameChild))), step: 2 }];
    head.children = [...others, nameRow].sort((a, b) => posCmp(a.span.start, b.span.start));
    return head;
  }

  /** A row of nodes about the same text: what each says, its roles, and what a program reads of it. */
  function plainRow(/** @type {any[]} */ members, /** @type {any[]} */ rest, /** @type {any} */ parent, /** @type {any} */ ctx) {
    const t = labels.tree;
    const d = labels.depth;
    const primary = members[0];
    const row = newRow(primary, members);
    const tok = tokenAt.get(spanKey(primary.span));
    const readerKey = readerKeyOf(members);
    const reader = [...members].reverse().find(isReader);
    const takesOver = !!reader && readerKey !== ctx.readerKey;
    row.texts = memberTexts(members, parent, !!ctx.name);
    // The values of the expansions in a word that says something at step 1: where each comes from. (At depth 2 an
    // expansion that is a part of the word has a row of its own, which says it there: once.)
    // (Round 7: at depth 2 the expansion's own row says it, with what bash does: once at each depth.)
    if (members.some((m) => m.layer === 'bash' && VALUED.has(m.kind))) {
      for (const x of expansionsIn(members.concat(rest.map((r) => r.node).filter((c) => c.layer === 'bash' && !NAMES.has(c.kind))))) {
        if (x.from) row.lines.push({ text: fromText(x), step: 1, cls: 'u-val', ...(members.includes(x) ? {} : { max: 1 }) });
      }
    }
    // The tilde prefixes of a word (3.5.2): a part of their own at depth 2, as an expansion is; the word's own line
    // on them is said there.
    const tw = members.find((m) => m.tildes);
    if (tw) {
      row.texts = row.texts.map((x, i) => (i > 0 && x.src === tw ? { ...x, max: 1 } : x));
      row.tildeRows = tw.tildes.map((/** @type {any} */ tl) => {
        const tr = newRow({ span: tl.span, kind: 'expansion', layer: 'bash', label: tl.text, children: [] }, []);
        const which = tl.user === '' ? 'home' : tl.user === '+' ? 'pwd' : tl.user === '-' ? 'oldpwd' : 'user';
        tr.label = tl.text;
        tr.kind = 'variable';
        tr.texts = [{ text: d.tilde[which].replace('{code}', codeOf(tl.text)).replace('{user}', codeOf(tl.user)), step: 2 }];
        tr.chips = [{ text: chipOf({ layer: 'bash', kind: 'expansion' }), layer: 'bash', def: t.about.expansion ?? '', step: 2 }];
        tr.refs = ['3.5.2'];
        tr.bash = true;
        return tr;
      });
      // (Round 7: and the literal text after each prefix, `/docs` of `~/docs`, a part of its own as a glob's are.)
      const sp = tw.span;
      if (sp.start.line === sp.end.line && sp.start.line === shownLineNo) {
        const ends = tw.tildes.map((/** @type {any} */ tl) => tl.span.end.character);
        tw.tildes.forEach((/** @type {any} */ tl, /** @type {number} */ i) => {
          const from = ends[i];
          const to = tw.tildes[i + 1]?.span.start.character ?? sp.end.character;
          const text = shownText.slice(from, to);
          if (!text || tl.span.start.line !== shownLineNo) return;
          const span = { start: { line: sp.start.line, character: from }, end: { line: sp.start.line, character: to } };
          const lr = newRow({ span, kind: 'string', layer: 'bash', label: text, children: [] }, []);
          lr.label = text;
          lr.kind = 'argument';
          lr.texts = [{ text: d.literal.replace('{code}', codeOf(text)), step: 2 }];
          lr.chips = [{ text: chipOf({ layer: 'bash', kind: 'string' }), layer: 'bash', def: t.about.string ?? '', step: 2 }];
          lr.bash = true;
          lr.lit = true;
          row.tildeRows.push(lr);
        });
      }
    }
    // A pipe of a pipeline: the two commands it joins, in source order (each `|` a row of its own).
    if (primary.kind === 'operator' && (primary.label === '|' || primary.label === '|&') && parent?.kind === 'pipeline') {
      const i = parent.children.indexOf(primary);
      const nameOf = (/** @type {any} */ c) => (c ? codeOf(c.children.find((x) => NAMES.has(x.kind))?.label ?? c.label) : '');
      const left = parent.children.slice(0, i).reverse().find((c) => c.kind !== 'operator');
      const right = parent.children.slice(i + 1).find((c) => c.kind !== 'operator');
      if (left && right) row.texts = [{ text: d.pipe.replace('{left}', nameOf(left)).replace('{right}', nameOf(right)), step: 2 }];
    }
    // A redirection of a command: only for that command, set up by bash before it starts (`Redirection applied to
    // …`, said once on the command's token), on the redirection's row at every depth.
    // (Round 7: its own text short, "Write stderr (fd 2) to `/dev/null`"; that it is not in the program's arguments
    // is said once, under the words the program receives; with the program's side off, only whose it is.)
    if (primary.kind === 'redirect' && ctx.redirectsOf) {
      const what = (ctx.removed ?? []).find((/** @type {any} */ x) => spanKey(x.span) === spanKey(primary.span));
      if (what?.say) row.texts = [{ text: what.say, step: 1, kind: 'redirect', src: primary }];
      row.lines.push({ text: d.redirFor.replaceAll('{name}', codeOf(ctx.redirectsOf)), step: 1, cls: 'u-note u-redir', off: true });
    }
    if (primary.cond) row.cond = primary.cond;
    // (Round 6: the role the program gives the word, `option`, `operand`, `value of -f`, beside its role to bash.)
    if (reader?.layer === 'command' && !['command', 'builtin', 'function', 'alias', 'subcommand'].includes(reader.kind)) row.progRole = { text: chipOf(reader), name: reader.reader ?? '' };
    const quote = members.find((m) => m.kind === 'quote');
    if (quote) row.quote = quoteKind(quote);
    for (const m of members) {
      if (isReader(m)) {
        if (m !== reader || !takesOver) continue;
        // (A language a command reads, `awk '{…}'`: who reads it. What a program reads of its words is the argv
        // line of its command, with the program's side.)
        if (m.kind === 'language') row.reads = { text: t.readers.language.replace('{name}', m.reader ?? ''), layer: m.layer };
        continue;
      }
      if (m.kind === 'script') {
        row.reads = { text: t.readers.child[m.process ?? 'subshell'], layer: 'child' };
        continue;
      }
      if (NAMES.has(m.kind)) {
        row.chips.push({ text: t.kinds[m.kind] ?? chipOf(m), layer: 'bash', def: t.about[m.kind] ?? '', step: 2 });
        continue;
      }
      const def = m.kind === 'quote' ? m.text : t.about[aboutKey(m)] ?? '';
      row.chips.push({ text: chipOf(m), layer: m.layer === 'child' ? 'bash' : m.layer, def, step: 2 });
    }
    const lang = primary.kind === 'language' ? (t.languages[primary.label] ?? primary.label) : '';
    if (!row.texts.length && lang) row.texts.push({ text: lang, step: isReader(primary) ? 1 : 2 });
    row.name = members.find((m) => m.name && m.kind !== 'keyword')?.name;
    const nameNode = members.find((m) => NAMES.has(m.kind));
    if (nameNode) {
      // What bash runs for the name: a program, a builtin, a function (from step 1); what else the name is (step 2).
      // (Beside the name, in the code's column: the chips at the right are the roles.)
      if (row.name) row.badge = row.name;
      else if (nameNode.resolves && t.resolves[nameNode.resolves]) row.badgeText = t.resolves[nameNode.resolves];
      if (row.name?.said.also) row.also = row.name.said.also;
    }
    row.refs = [...new Set(members.filter((m) => !isReader(m)).flatMap((m) => m.refs ?? []))];
    row.label = lang || (ctx.name ? sourceOf(primary) : (tok?.label ?? primary.label));
    row.labelParts = lang ? [{ text: lang, placeholder: true }] : ctx.name ? undefined : tok?.labelParts;
    row.group = ctx.name ? undefined : tok?.group;
    // (A variable's name is a name, not an expansion: the loop variable `f`, the name of an assignment.)
    row.kind = ctx.name || NAMES.has(primary.kind) ? (row.name?.runs === 'builtin' || nameNode?.resolves === 'builtin' ? 'builtin' : 'command')
      // (What the command reads it as, when no token of the line shown is about it: the body of a loop on its first line.)
      : primary.kind === 'name' ? 'name' : tok?.kind ?? (reader?.layer === 'command' ? reader.kind : roleOf(primary));
    row.value = tok?.value;
    row.read = readerKey.startsWith('command:') || readerKey.startsWith('language:');
    row.bash = !row.read && readerKey === 'bash' && !['list', 'andList', 'orList', 'pipeline', 'compound', 'part', 'line'].includes(primary.kind);
    // (An argument is defined by the simple command's definition: "the rest its arguments".)
    if (primary.kind === 'keyword') row.defKind = 'keyword';
    else if (primary.kind === 'expansion') row.defKind = 'expansion';
    // A compound command by its real code at every depth (`if [[ … ]]; then source config.ini; fi`); its grammar
    // (`if ‹condition› then ‹commands› fi`) from depth 2, under its text.
    if (primary.code && row.labelParts?.some((/** @type {any} */ p) => p.placeholder)) {
      row.form = row.labelParts;
      row.label = primary.code;
      row.labelParts = undefined;
    }
    const inner = { readerKey, redirectsOf: ctx.redirectsOf, removed: ctx.removed };
    row.children = [...rest.map((r) => buildRow(r.node, r.parent, inner)), ...(row.tildeRows ?? [])].sort((a, b) => posCmp(a.span.start, b.span.start));
    row.struct = ['pipeline', 'list', 'andList', 'orList', 'compound', 'clause', 'function', 'part', 'line'].includes(primary.kind);
    return row;
  }

  /** Whether two texts say the same thing: one is the other, or holds it whole. */
  const repeats = (/** @type {string} */ a, /** @type {string} */ b) => a === b || (a.length >= 8 && b.length >= 8 && (a.includes(b) || b.includes(a)));

  /** The rows of the line shown, with the examples on their rows, and the step each comes in at. */
  function buildRows() {
    if (!reading || !labels.tree || !labels.depth) return null;
    indexTokens();
    const d = labels.depth;
    let rows = reading.children.map((/** @type {any} */ c) => buildRow(c, reading, { readerKey: 'bash' }));
    // A block around the line (the `for` of a loop body), with the problems on its line, first.
    const around = shownAround.map((a) => ({
      ...newRow({ span: { start: { line: a.line, character: 0 }, end: { line: a.line, character: a.text.length } } }, []),
      keys: new Set(), label: a.text.trim(), kind: 'keyword',
      texts: [{ text: d.context.replace('{label}', a.label).replace('{n}', String(a.line + 1)), step: 1 }],
      step: 1, forced: 1, around: true,
      // (A problem's text starts with the mark of its level, which the icon stands for here.)
      problems: a.problems.map((/** @type {any} */ p) => ({ level: p.level, label: p.label ?? '', body: (p.body ?? p.text).replace(/^[⚠ⓘℹ]️?\s*/u, ''), refs: p.refs ?? [] })),
    }));
    // Each example on the row of its range, else on the deepest row of step 1 around it; examples with neither, at the end.
    const all = /** @type {{ row: any, depth: number }[]} */ ([]);
    const walk = (/** @type {any} */ r, /** @type {number} */ depth) => {
      all.push({ row: r, depth });
      r.children.forEach((/** @type {any} */ c) => walk(c, depth + 1));
    };
    rows.forEach((r) => walk(r, 0));
    const firstStep = (/** @type {any} */ r) => r.texts.some((/** @type {any} */ x) => x.step === 1);
    const rest = [...shownRest];
    const place = (/** @type {any} */ e) => {
      if (!e.anchor) return rest.push(e);
      const key = spanKey(e.anchor);
      let target = all.find((x) => x.row.keys.has(key))?.row;
      if (!target) {
        let best = /** @type {{ row: any, depth: number } | undefined} */ (undefined);
        for (const x of all) if (firstStep(x.row) && spanCovers(x.row.span, e.anchor) && (!best || x.depth >= best.depth)) best = x;
        target = best?.row;
      }
      if (!target) return rest.push(e);
      target.examples.push(e);
      target.forced = 1;
    };
    const visit = (/** @type {any} */ tok) => {
      (tok.examples ?? []).forEach(place);
      tok.children.forEach(visit);
    };
    shownItems.forEach(visit);

    // Nothing said twice. A text its parent row says already (or that says the parent's again) is left out (round 7: the
    // literal pieces of a glob keep their rows: every part of a word is one). A row left with nothing to say gives its place to its
    // parts. (Every operator keeps its row, in source order: each `|` says which two commands it joins.)
    const prune = (/** @type {any} */ r, /** @type {any} */ parent) => {
      const main = parent && !parent.promote ? parent.texts[0]?.text : undefined;
      if (main) r.texts = r.texts.filter((/** @type {any} */ x) => !repeats(x.text, main));
      // (A literal piece of a word, `/var/log/` of `/var/log/*.log`: text, not something bash does; no `bash` mark.)
      if (r.primary?.kind === 'string' && r.primary.layer === 'bash' && !r.children.length) r.lit = true;
      r.children.forEach((/** @type {any} */ c) => prune(c, r));
      if (!r.around && !r.promote && !r.texts.length && !r.lines.length && !r.examples.length) r.drop = true;
    };
    rows.forEach((r) => prune(r, null));
    // (A dropped row's parts take its place; a counted operator drops with no parts.)
    const lift = (/** @type {any[]} */ list) => list.flatMap((/** @type {any} */ r) => {
      r.children = lift(r.children);
      return r.drop ? r.children : [r];
    });
    rows = lift(rows);
    // The general definitions, once on the panel, from step 2: on the first simple command, argument, reserved
    // word and expansion; the full rule of each kind of quotes on the first word in them.
    const defs = new Set();
    const quotes = new Set();
    const define = (/** @type {any} */ r) => {
      const def = r.defKind === 'command' ? '' : d.defs[r.defKind];
      if (def && !defs.has(r.defKind)) {
        defs.add(r.defKind);
        if (r.promote || !r.texts.length) r.texts.unshift({ text: def, step: 2, cls: 'u-def' });
        else r.lines.push({ text: def, step: 2, cls: 'u-def' });
      }
      // An expansion whose value its word says at depth 1 (`$USER`: the user name; `$backup`: set on line 1): its
      // own row says it once, with what bash does with it.
      const from = r.defKind === 'expansion' ? r.primary.from : undefined;
      if (from) {
        const code = codeOf(r.label);
        const text = from.meaning
          ? d.param.meaning.replace('{code}', code).replace('{text}', document.documentElement.lang === 'ja' || !/^[A-Z][a-z]/.test(from.meaning) ? from.meaning : from.meaning[0].toLowerCase() + from.meaning.slice(1))
          : d.param[from.loop ? 'loop' : 'line'].replace('{code}', code).replace('{n}', String(from.line));
        r.texts = [{ text, step: 2 }, ...r.texts.filter((/** @type {any} */ x) => !(from.meaning && repeats(x.text, from.meaning)) && !/^(Expands to the value of|変数 )/.test(x.text))];
      }
      if (r.quote && !quotes.has(r.quote)) {
        quotes.add(r.quote);
        r.lines.push({ text: d.quotes[r.quote], step: 2, cls: 'u-note' });
      }
      r.children.forEach(define);
    };
    rows.forEach(define);
    // (Round 7) Whether a row is all bash's own, it and its parts (no word a program receives, no command name in
    // it): the `bash` mark goes on the top row of each such part only (`[[ … ]]`, not its operands; `*.txt`, not `*`).
    const bashOnly = (/** @type {any} */ r) => {
      const kids = r.children.map(bashOnly);
      const own = !r.around && !r.recv && !r.argv0 && !r.read && r.kind !== 'command' && r.kind !== 'builtin' && !r.nameRow
        && (r.bash || (r.struct && r.primary?.layer === 'bash'));
      return (r.bashOnly = own && kids.every(Boolean));
    };
    rows.forEach(bashOnly);
    // (Round 7) The reserved words and separators of a compound command (`if`, `then`, `;`, `fi`, `[[`, `]]`, `in`,
    // `do`, `done`) fold into its Form line at depth 2, one click away ("Show the keywords").
    const fold = (/** @type {any} */ r) => {
      for (const c of r.children) {
        const k = c.primary?.kind;
        if (r.form && !c.children.length && (k === 'keyword' || (k === 'operator' && /^(;|;;|&|\n)$/.test(c.primary.label)))) c.kw = true;
        fold(c);
      }
      r.kwCount = r.children.filter((/** @type {any} */ c) => c.kw).length;
    };
    rows.forEach(fold);
    // A row comes in at the first step it says something, and no later than its parts; a header (a simple command)
    // comes in at step 2, and its parts take its place before.
    const stepOf = (/** @type {any} */ r) => {
      const kids = r.children.map(stepOf);
      if (r.promote) return (r.step = 2);
      r.step = Math.min(r.forced, ...r.texts.map((/** @type {any} */ x) => x.step), ...r.lines.map((/** @type {any} */ x) => x.step), ...kids);
      // (A row its parts bring in early says its first text from then: every row drawn says something.)
      if (r.texts.length && !r.texts.some((/** @type {any} */ x) => x.step <= r.step)) r.texts[0].step = r.step;
      return r.step;
    };
    rows.forEach(stepOf);
    return { rows: [...around, ...rows], rest };
  }

  /** How much each step adds to the line shown; a step that adds nothing is passed over by ◁ ▷. */
  function measureDepths() {
    added = new Array(STEPS).fill(0);
    built = buildRows();
    if (!built) return;
    const count = (/** @type {any[]} */ rows, /** @type {number} */ s) => rows.reduce((n, r) => n + (r.step <= s ? 1 : 0)
      + r.texts.filter((/** @type {any} */ x) => x.step <= s).length + r.lines.filter((/** @type {any} */ x) => x.step <= s).length
      + r.chips.filter((/** @type {any} */ x) => x.step <= s).length + (s >= 2 && r.refs.length ? 1 : 0)
      + count(r.children, s), 0);
    let last = 0;
    for (let s = 1; s <= STEPS; s++) {
      const n = count(built.rows, s);
      added[s - 1] = s === 1 ? n : Math.max(0, n - last);
      last = n;
    }
  }

  /** Finds the outermost token for each range of the line shown. */
  function indexTokens() {
    tokenAt = new Map();
    const walk = (/** @type {any} */ t) => {
      const k = spanKey(t.span);
      if (!tokenAt.has(k)) tokenAt.set(k, t);
      t.children.forEach(walk);
    };
    shownItems.forEach(walk);
    // (And those of the other lines of a statement shown whole: a loop's body, on its first line.)
    (reading?.tokens ?? []).forEach(walk);
  }

  /** The rows of step `s`, as drawn: a header not drawn yet gives its place to its parts. */
  function viewOf(/** @type {any} */ r, /** @type {number} */ s) {
    return { ...r, children: viewList(r.children, s), problems: [...(r.problems ?? [])] };
  }
  function viewList(/** @type {any[]} */ rows, /** @type {number} */ s) {
    return rows.flatMap((/** @type {any} */ c) => {
      if (c.kw && !keywordsShown) return [];
      if (c.step <= s) return [viewOf(c, s)];
      if (!c.promote) return [];
      // (A simple command's header not drawn yet: its name's row stands for the command, with the words its program
      // receives, and its assignments and redirections under it, after its arguments: they are its own.)
      if (c.nameRow) {
        const own = c.children.filter((/** @type {any} */ x) => x !== c.nameRow);
        return viewList([{ ...c.nameRow, argv: c.argv, children: [...c.nameRow.children, ...own] }], s);
      }
      return viewList(c.children, s);
    });
  }
  /** Whether the first line of the words a program receives is drawn yet (it says what the first word is). */
  let argvShown = false;
  /** (Round 7) Whether the note that the quotes are removed is drawn yet: once on the panel. */
  let quotesShown = false;
  /** Whether a text or a line of a row is drawn at step `s`: from its step on, and up to its last (`max`) when it has one. */
  const atStep = (/** @type {any} */ x, /** @type {number} */ s) => x.step <= s && (!x.max || s <= x.max);

  /** Puts each note of the line that is about a range on the innermost row drawn around it; returns the others. */
  function placeNotes(/** @type {any[]} */ views) {
    const left = [];
    for (const n of shownNotes) {
      let best = /** @type {{ row: any, depth: number } | undefined} */ (undefined);
      const walk = (/** @type {any} */ r, /** @type {number} */ depth) => {
        if (!r.around && (n.spans ?? []).some((/** @type {any} */ sp) => spanCovers(r.span, sp)) && (!best || depth >= best.depth)) best = { row: r, depth };
        r.children.forEach((/** @type {any} */ c) => walk(c, depth + 1));
      };
      views.forEach((r) => walk(r, 0));
      if (best) best.row.problems.push(n);
      else left.push(n);
    }
    return left;
  }

  /** A note of the line, or a problem on a row: the icon of its level and the word that names it, then its text. */
  function noteEl(/** @type {{ level: string, label: string, body: string, refs: string[] }} */ n, /** @type {string} */ tag = 'p', /** @type {string} */ cls = 'note') {
    const p = document.createElement(tag);
    p.className = `${cls} level-${n.level}`;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('class', 'note-icon');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', levelLabels[n.level] ?? n.level);
    drawIcon(svg, n.level === 'warning' ? 'warning' : 'info');
    const text = document.createElement('span');
    text.className = 'note-text';
    if (n.label) text.append(el('strong', { class: 'note-label' }, n.label), ' ');
    text.append(...inline(n.body), ...refLinks(n.refs));
    p.append(svg, text);
    return p;
  }

  /** The sections a row cites, as one small link to the first (`§3.7.1+`), the others named in its tooltip. */
  function refLink(/** @type {string[]} */ refs) {
    const known = refs.filter((id) => manual[id]);
    if (!known.length) return null;
    const m = manual[known[0]];
    // (The first section only, as `§3.7.1`; every section the row cites is in the tooltip.)
    const a = /** @type {HTMLAnchorElement} */ (el('a', { href: m.url, target: '_blank', rel: 'noopener noreferrer', class: 'u-ref' }, m.text.startsWith('§') ? m.text : `§${m.text}`));
    a.title = known.map((id) => `${manual[id].text} ${manual[id].title}`).join('\n');
    a.setAttribute('aria-label', `${known.map((id) => `${manual[id].text} ${manual[id].title}`).join(', ')}${linkNote.startsWith('(') ? ' ' : ''}${linkNote}`);
    return el('span', { class: 'refs' }, a);
  }

  /** Code with placeholders (`labelParts`: `if ‹condition› then …`), as a `code` element. */
  function codeParts(/** @type {any[]} */ parts) {
    const c = document.createElement('code');
    parts.forEach((/** @type {any} */ p, /** @type {number} */ i) => {
      if (i && !p.tight) c.append(' ');
      if (p.placeholder) c.append(el('span', { class: 'ph' }, p.text));
      else c.append(p.text);
    });
    return c;
  }

  /**
   * The words a simple command's program receives (`ReadingNode.argv`, src/argvline.ts): "grep receives:" and each
   * word as a chip; the line wraps between chips, and a chip longer than the line only after a `/` (round 7); a value
   * known only when it runs as a placeholder ‹…›, dashed when it stands for any number of words. Then what bash did
   * that the program does not see: the redirections and assignments, each with what it does. `notes`: at depth 2, on
   * the first such line of the panel, what the first word is; on the first with quotes, that they are removed.
   */
  function argvEl(/** @type {any} */ argv, /** @type {{ argv0: boolean, quotes: boolean }} */ notes) {
    const a = labels.depth.argv;
    const named = argv.inside ? argv.name : argv.words[0];
    const name = named ? named.parts.map((/** @type {any} */ p) => p.text).join('') : '';
    const lead = argv.inside ? (argv.words.length ? a.inside : a.insideNone) : a.receives;
    const line = el('div', { class: 'u-argv', title: a.title }, el('span', { class: 'u-argv-lead' }, ...inline(lead.replace('{name}', codeOf(name)))));
    argv.words.forEach((/** @type {any} */ w, /** @type {number} */ i) => {
      const word = el('code', { class: `u-arg${w.many ? ' u-many' : ''}`, 'data-span': spanKey(w.span) });
      const titles = [];
      for (const p of w.parts) {
        // (Pieces that do not break: a placeholder whole, a text up to each `/`.)
        if (p.ph) word.append(el('span', { class: 'u-ph' }, `‹${p.text}›`));
        else for (const piece of String(p.text).split(/(?<=\/)/)) word.append(el('span', {}, piece));
        if (p.title) titles.push(p.title);
      }
      const whole = w.parts.map((/** @type {any} */ p) => (p.ph ? `‹${p.text}›` : p.text)).join('');
      word.title = [whole, ...titles, ...(w.many ? [a.many] : []), ...(i === 0 && !argv.inside ? [a.argv0] : [])].join('\n');
      line.append(' ', word);
    });
    const out = [line];
    if (notes.argv0) out.push(el('div', { class: 'u-note u-argv0' }, ...inline(cap(a.argv0))));
    if (notes.quotes) out.push(el('div', { class: 'u-note u-argv-quotes' }, ...inline(a.quotes.replace('{name}', codeOf(name)))));
    if (argv.removed.length) {
      const list = argv.removed.map((/** @type {any} */ x) => `${codeOf(x.text)}${x.effect ? a.effect.replace('{e}', x.effect) : ''}`).join(a.sep);
      out.push(el('div', { class: 'u-note u-argv-removed' }, ...inline(a.handled.replace('{name}', codeOf(name)).replace('{list}', list))));
    }
    return out;
  }
  /** A text with its first letter in capitals (English). */
  const cap = (/** @type {string} */ t) => (/^[a-z]/.test(t) ? t[0].toUpperCase() + t.slice(1) : t);

  /** Code with placeholders in ‹›, as a `code` element (the forms of the compound commands). */
  function formCode(/** @type {string} */ text) {
    const c = document.createElement('code');
    for (const part of text.split(/(‹[^›]*›)/).filter(Boolean)) c.append(part.startsWith('‹') ? el('span', { class: 'ph' }, part.slice(1, -1)) : part);
    return c;
  }

  /** What bash evaluates in `[[ … ]]` after expansion, as code: its words' placeholders in ‹›, a pattern marked. */
  function condCode(/** @type {any[]} */ parts) {
    const c = el('code', { class: 'u-cond' });
    parts.forEach((/** @type {any} */ p, /** @type {number} */ i) => {
      if (i && !p.tight) c.append(' ');
      if (p.word) {
        for (const w of p.word) c.append(w.ph ? el('span', { class: 'u-ph' }, `‹${w.text}›`) : w.text);
      } else if (p.tight) c.append(el('span', { class: 'u-condmark' }, p.text));
      else c.append(p.text);
    });
    return c;
  }

  /**
   * The code of a group of commands (`grep | sort | uniq`, `if [[ … ]]; then …; fi`) in pieces that do not break: it
   * wraps only before an operator of a pipeline or a list, or after a `;`.
   */
  function groupCode(/** @type {HTMLElement} */ label) {
    const text = label.textContent ?? '';
    const pieces = text.split(/ (?=\|\|? |&& )|(?<=;) /);
    if (pieces.length < 2) return;
    label.replaceChildren(...pieces.flatMap((p, i) => [...(i ? [' '] : []), el('span', { class: 'u-seg' }, p)]));
  }

  /** A role chip; with a definition, a button that opens it under the row. */
  function chipNode(/** @type {any} */ c, /** @type {HTMLElement} */ side, /** @type {HTMLElement} */ defs) {
    if (c.badge) return nameBadge(c.badge);
    if (!c.def) return [el('span', { class: `u-role l-${c.layer}${c.cls ? ` ${c.cls}` : ''}` }, c.text)];
    const chip = el('button', { type: 'button', class: `u-role l-${c.layer}`, 'aria-expanded': 'false', title: labels.depth.more }, c.text);
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = chip.getAttribute('aria-expanded') !== 'true';
      side.querySelectorAll('button.u-role').forEach((b) => b.setAttribute('aria-expanded', 'false'));
      chip.setAttribute('aria-expanded', String(open));
      defs.replaceChildren(...(open ? inline(c.def) : []));
      defs.hidden = !open;
    });
    return [chip];
  }

  /** (Round 7) One risk of the line in the list under "In short": its icon, its word and its first sentence; it goes to `at`. */
  function riskEl(/** @type {any} */ p, /** @type {HTMLElement} */ at) {
    const body = String(p.body ?? '');
    // (Its headline: up to the end of the first sentence, or to a colon outside code, which starts the details.)
    const sentence = body.split(/(?<=[.。])\s+|(?<=。)/)[0] ?? body;
    let ticks = 0;
    let cut = -1;
    for (let i = 0; i < sentence.length && cut < 0; i++) {
      if (sentence[i] === '`') ticks++;
      else if (!(ticks % 2) && i > 20 && /^(: |：)/.test(sentence.slice(i, i + 2))) cut = i;
    }
    const head = cut < 0 ? sentence : sentence.slice(0, cut);
    const b = el('button', { type: 'button', class: `u-risk level-${p.level}`, title: labels.depth.riskJump.replace('{label}', p.label || (levelLabels[p.level] ?? '')) });
    const icon = noteEl({ level: p.level, label: p.label, body: head, refs: [] }, 'span', 'u-risk-note');
    b.append(icon);
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const box = at.querySelector('details.u-problem');
      if (box) /** @type {HTMLDetailsElement} */ (box).open = true;
      at.scrollIntoView({ block: 'center', behavior: 'instant' });
      at.classList.remove('u-flash');
      void at.offsetWidth;
      at.classList.add('u-flash');
      const target = /** @type {HTMLElement | null} */ (box?.querySelector('summary') ?? null);
      target?.focus({ preventScroll: true });
    });
    return el('li', {}, b);
  }

  /**
   * A caveat or warning on a row: whole at depth 1 (`open`); at depth 2 folded to its first line, the whole text when
   * opened (it is in the Problems list too, and in the list of risks under "In short").
   */
  function problemEl(/** @type {any} */ p, /** @type {boolean} */ open) {
    if (open) return el('div', { class: `u-problem u-whole level-${p.level}` }, noteEl(p, 'span', 'u-problem-note'));
    const box = el('details', { class: `u-problem level-${p.level}` });
    const sum = el('summary', { title: labels.depth.problemsAlso });
    sum.append(noteEl(p, 'span', 'u-problem-note'));
    box.append(sum);
    return box;
  }

  /**
   * A row of the one view, on a grid: the code (indented by its level, with its fold button) in a column of the same
   * width on every row, and what it says from that column's edge on. Its first line holds the text, and at its right
   * the chips and one link to the manual (on hover or focus, but the role a program gives the word); the lines under
   * it, the values, notes, the words a program receives, definitions and problems.
   */
  function uitem(/** @type {any} */ row, /** @type {string} */ path, /** @type {number} */ s, /** @type {number} */ lvl, /** @type {any} */ up = null) {
    const d = labels.depth;
    const li = document.createElement('li');
    li.dataset.path = path;
    const r = document.createElement('div');
    r.className = `row u-row kind-${row.kind}`;
    r.dataset.span = spanKey(row.span);
    r.style.setProperty('--lvl', String(lvl));
    // (The program's side: a group of commands or of parts is structure, drawn with a hollow bar.)
    const struct = row.struct || row.promote;
    // (Round 7: the `bash` mark on the top row of each part that is all bash's own (`bashOnly`, buildRows), next to
    // its code; a row is tinted when the words the program receives come from it (a glob too); a part of such a word
    // that the program reads, `-c` of `-czf`, says so.)
    const marked = who && row.bashOnly && !row.lit && !(up && up.bashOnly);
    const partOf = who && !row.recv && !row.bashOnly && !struct && up?.recv && !row.bash ? up.label : '';
    if (struct) r.classList.add('u-struct');
    if (who && (row.recv || row.argv0)) r.classList.add('u-read');
    if (row.around) r.classList.add('u-around');
    if (row.promote) r.classList.add('u-head');
    // (A group's skeleton, `grep | sort | …`, `if [[ … ]]; then …; fi`: its code may wrap in the column.)
    if (row.promote || ['pipeline', 'list', 'andList', 'orList', 'compound', 'part', 'clause', 'function'].includes(row.primary?.kind)) r.classList.add('u-group');
    const folds = row.children.length > 0 || row.examples.length > 0;
    const twisty = document.createElement(folds ? 'button' : 'span');
    twisty.className = 'twisty';
    if (folds) {
      const b = /** @type {HTMLButtonElement} */ (twisty);
      b.type = 'button';
      b.setAttribute('aria-label', String(labels.partsOf ?? '{name}').replace('{name}', row.label));
      b.setAttribute('aria-expanded', 'true');
      b.append(el('span', { 'aria-hidden': 'true' }, '▾'));
      twisty.addEventListener('click', (e) => {
        e.stopPropagation();
        toggle(li);
      });
    }
    const label = codeParts(row.labelParts ?? [{ text: row.label }]);
    label.className = row.group ? `label grp-label grp-${((row.group - 1) % 6) + 1}` : 'label';
    if (r.classList.contains('u-group') && !(row.labelParts ?? []).some((/** @type {any} */ x) => x.placeholder)) groupCode(label);
    const badge = row.badge ? nameBadge(row.badge) : row.badgeText ? [el('span', { class: 'nk-badge nk-program' }, row.badgeText)] : [];
    const mark = marked ? [el('span', { class: 'u-bmark', title: d.bashMarkTitle }, d.bashMark)] : [];
    const tok = el('span', { class: 'u-tok' }, twisty, label, ...badge, ...mark);
    const desc = el('div', { class: 'u-desc' });
    const texts = row.texts.filter((/** @type {any} */ x) => atStep(x, s));
    const first = el('div', { class: 'u-l1' });
    const main = el('span', { class: `text${texts[0]?.cls ? ` ${texts[0].cls}` : ''}` }, ...(texts[0] ? inline(texts[0].text) : []));
    // Who reads a language in the word (`awk '{…}'`), after its text.
    if (row.reads) main.append(' ', el('span', { class: `u-reads l-${row.reads.layer}` }, '→ ', ...inline(row.reads.text)));
    // (Round 7: the chips and the link to the manual on a short line of their own under the text, all in sight at
    // depth 2; none at all on a row with none. The text takes the column's whole width.)
    const side = el('div', { class: 'u-side' });
    const defs = el('div', { class: 'u-def u-open', hidden: '' });
    const chips = row.chips.filter((/** @type {any} */ c) => c.step <= s);
    const prog = s >= 2 && chips.length ? row.progRole : undefined;
    if (chips.length) {
      const [c] = chipNode(chips[0], side, defs);
      const rest = chips.slice(1);
      if (rest.length && c instanceof HTMLElement) c.title = [c.title, d.moreRoles.replace('{list}', rest.map((/** @type {any} */ x) => x.text).join(', '))].filter(Boolean).join('\n');
      side.append(c);
    }
    if (prog) {
      // (A long role is said short, its whole text in the tooltip: `operand: each matching file name`. Who reads it,
      // only with the program's side off: on, the tint says it.)
      const [role, ...more] = String(prog.text).split(/:\s*/);
      const p = el('span', { class: 'u-prog l-command' }, d.progRole.replace('{role}', role));
      if (prog.name && !who) p.append(el('span', { class: 'u-prog-who' }, ` ${d.progRoleWho.replace('{name}', prog.name)}`));
      if (more.length) p.title = prog.text;
      side.append(p);
    }
    if (partOf) side.append(el('span', { class: 'u-partof' }, ...inline(d.partOf.replace('{code}', codeOf(partOf)))));
    const link = s >= 2 ? refLink(row.refs) : null;
    if (link) side.append(link);
    first.append(texts.length || row.reads ? main : el('span', { class: 'text u-blank' }, ' '));
    desc.append(first);
    if (side.childElementCount) desc.append(side);
    // (The words a program receives: right under the row that stands for its simple command, at every depth; what
    // the first word is and that the quotes are removed, once on the panel, at depth 2.)
    if (who && row.argv) {
      const notes = { argv0: s >= 2 && !argvShown && !row.argv.inside, quotes: s >= 2 && !quotesShown && !!row.argv.quotes };
      desc.append(...argvEl(row.argv, notes));
      if (notes.argv0) argvShown = true;
      if (notes.quotes) quotesShown = true;
    }
    texts.slice(1).forEach((/** @type {any} */ x) => desc.append(el('div', { class: `text ${x.cls ?? 'u-text2'}` }, ...inline(x.text))));
    for (const x of row.lines) if (atStep(x, s) && !(x.off && who)) desc.append(el('div', { class: x.cls }, ...inline(x.text)));
    // (`[[ … ]]` with the program's side: no program runs; what bash evaluates, once it has expanded the words.)
    if (who && row.cond) {
      desc.append(el('div', { class: 'u-cond-line' }, ...inline(d.cond.none.replace('{code}', codeOf('[[ … ]]')))));
      desc.append(el('div', { class: 'u-note' }, `${d.cond.after} `, condCode(row.cond)));
    }
    const formKey = row.form ? (row.label.match(/^(\[\[|\(\(|[{(]|[a-z]+)/)?.[1] ?? '') : '';
    if (s >= 2 && row.form) {
      const form = el('div', { class: 'u-note u-form' }, `${d.form} `, d.forms[formKey] ? formCode(d.forms[formKey]) : codeParts(row.form));
      // (Round 7: its reserved words and separators fold into this line; one click shows them as rows.)
      if (row.kwCount) {
        const b = el('button', { type: 'button', class: 'u-kwtoggle', 'aria-pressed': String(keywordsShown) },
          keywordsShown ? d.hideKeywords : d.showKeywords.replace('{n}', String(row.kwCount)));
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          keywordsShown = !keywordsShown;
          save();
          // (The rows drawn again get no mouseleave: the editor's mark of the row under the pointer goes now.)
          focus(-1);
          drawList();
        });
        form.append(' ', b);
      }
      desc.append(form);
    }
    if (s >= 2 && row.also) desc.append(el('div', { class: 'u-note' }, ...inline(row.also)));
    const value = valueLine(row.value);
    if (value) desc.append(value);
    for (const p of row.problems) desc.append(problemEl(p, s === 1));
    desc.append(defs);
    r.append(tok, desc);
    li.append(r);
    if (folds && collapsedKeys.has(path)) setCollapsed(li, true);
    const index = flat.length;
    flat.push({ token: row, el: r });
    r.addEventListener('mouseenter', () => focus(index));
    r.addEventListener('mouseleave', () => focus(-1));
    r.addEventListener('focusin', () => r.classList.add('u-focus'));
    r.addEventListener('focusout', () => r.classList.remove('u-focus'));
    r.addEventListener('click', (e) => {
      if (selecting()) return;
      // (Round 7: opening a caveat, or the keywords, leaves the editor alone: no selection there, no focus.)
      if (e.target instanceof Element && e.target.closest('.u-problem, .u-kwtoggle')) return;
      if (!(e.target instanceof Element && e.target.closest('a, button, input, textarea, select, summary'))) {
        if (folds) toggle(li);
      }
      if (!row.around) {
        reveal(row);
        revealInLine(index);
      }
    });
    const body = document.createElement('div');
    body.className = 'body';
    if (row.children.length) {
      const ul = document.createElement('ul');
      const me = { bashOnly: !!row.bashOnly, recv: !!row.recv, label: row.label };
      ul.append(...row.children.map((/** @type {any} */ c, /** @type {number} */ i) => uitem(c, `${path}.${i}`, s, lvl + 1, me)));
      body.append(ul);
    }
    // (Its examples last, under its parts: in the same place at every step.)
    for (const e of row.examples) {
      // (One pattern for every example's title: "Example: `sort -rn` · sample input, editable".)
      const code = e.anchor ? `\`${sourceOf({ span: e.anchor, label: '' }).replace(/\s+/g, ' ')}\`` : '';
      const title = !code ? e.title : e.kind === 'glob' ? d.globTitle.replace('{glob}', code) : e.kind === 'pipeline' ? d.chainTitle : d.exampleTitle.replace('{code}', code);
      const box = example({ ...e, title }, true);
      box.style.setProperty('--lvl', String(lvl + 1));
      body.append(box);
    }
    if (body.childElementCount) li.append(body);
    return li;
  }

  /**
   * The code column: one width for the panel, whatever the line (a share of the view's width, within bounds), so that
   * the meanings start at the same x from line to line and from depth to depth; a longer code wraps inside its
   * column and never pushes the meaning. On a narrow view the text goes under the code on every row.
   */
  function alignRows() {
    const tree = $('tree');
    if (!reading || !built || !tree.getClientRects().length) return;
    const width = tree.clientWidth;
    const stacked = width < 520;
    tree.classList.toggle('u-stacked', stacked);
    if (stacked) return;
    tree.style.setProperty('--codew', `${Math.round(Math.max(150, Math.min(width * 0.36, 280)))}px`);
  }
  new ResizeObserver(() => alignRows()).observe($('tree'));

  /** Draws the one view at the step chosen: its rows, the line at the top, the notes left, and the examples left for the end. */
  function drawList() {
    flat = [];
    argvShown = false;
    quotesShown = false;
    editors.clear();
    const unified = !!built;
    const views = unified ? viewList(/** @type {any} */ (built).rows, step) : shownItems;
    const left = unified ? placeNotes(views) : shownNotes;
    $('tree').replaceChildren(...views.map((/** @type {any} */ t, /** @type {number} */ i) => (unified ? uitem(t, `${i}`, step, 0) : item(t, `${i}`))));
    renderLine(shownText, shownLineNo, views.filter((/** @type {any} */ v) => !v.around), shownMarks);
    // (A note about no row of the line: above the rows, drawn as the caveats on the rows are.)
    $('notes').replaceChildren(...left.map((n) => noteEl(n, 'div', unified ? 'note u-problem' : 'note')));
    $('examples').replaceChildren(...(unified ? /** @type {any} */ (built).rest : shownRest).map((/** @type {any} */ e) => example(e, false)));
    // (Round 6: one sentence on the whole line, where src/linesummary.ts knows its pattern.)
    let sum = document.getElementById('u-summary');
    if (!sum) {
      sum = el('p', { id: 'u-summary' });
      $('notes').before(sum);
    }
    sum.hidden = !(unified && reading?.summary);
    sum.replaceChildren(...(unified && reading?.summary ? [el('strong', {}, labels.depth.summary), ' ', ...inline(reading.summary)] : []));
    // (Round 7) The risks of the line, right under "In short": each the first sentence of a warning or a caveat, a
    // button that goes to the row it is on (or to the note above the rows) and opens it there.
    let risks = document.getElementById('u-risks');
    if (!risks) {
      risks = el('div', { id: 'u-risks' });
      $('notes').before(risks);
    }
    const found = unified ? flat.flatMap((f) => (f.token.problems ?? []).map((/** @type {any} */ p) => ({ p, at: f.el }))) : [];
    const noteEls = [...$('notes').children];
    if (unified) left.forEach((n, i) => found.push({ p: n, at: /** @type {HTMLElement} */ (noteEls[i]) }));
    found.sort((a, b) => (a.p.level === 'warning' ? 0 : 1) - (b.p.level === 'warning' ? 0 : 1));
    risks.hidden = !found.length;
    risks.classList.toggle('has-warning', found.some(({ p }) => p.level === 'warning'));
    risks.replaceChildren(...(found.length ? [el('strong', { class: 'u-risks-title' }, labels.depth.risks), el('ul', {}, ...found.map(({ p, at }) => riskEl(p, at)))] : []));
    $('main').dataset.depth = String(unified ? step : 0);
    $('main').classList.toggle('u-who', unified && who);
    alignRows();
  }

  // ---------------------------------------------------------------- the steps of the tree

  /** The steps that add something to the line shown (the line itself always), in order. */
  const useful = () => Array.from({ length: STEPS }, (_, i) => i + 1).filter((s) => s === 1 || added[s - 1] > 0);

  /** The step `d` steps from the one shown, among those that add something (the one shown at either end). */
  function stepFrom(/** @type {number} */ d) {
    const list = useful();
    if (d > 0) return list.find((s) => s > step) ?? step;
    return [...list].reverse().find((s) => s < step) ?? step;
  }

  const el = (/** @type {string} */ tag, /** @type {Record<string, string>} */ attrs = {}, /** @type {(Node | string)[]} */ ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') e.className = v;
      else e.setAttribute(k, v);
    }
    e.append(...kids);
    return e;
  };
  const icon = (/** @type {string} */ text) => el('span', { class: 'tp-icon', 'aria-hidden': 'true' }, text);
  const LAYERS = ['bash', 'child', 'command', 'language'];
  // (Prototype B: the depths' tints: the meaning, the command's reading, bash's syntax, bash's reading of words.)
  // (Round 5: one colour for the depth chosen, whichever it is.)
  const layerOfStep = (/** @type {number} */ _s) => 'depth';

  /**
   * Makes the controls (once): step back, a button per step, and step forward; where the buttons do not fit, a
   * stepper whose middle opens the steps as a menu (see `fitControls`). A polite live region says the step.
   */
  function buildControls(/** @type {HTMLElement} */ box) {
    // (A plain box: #layers is the group of the controls, and the stepper's menu opens this box of its buttons.)
    const steps = el('div', { id: 'steps' });
    for (let s = 1; s <= STEPS; s++) {
      steps.append(el('button', { type: 'button', class: `step l-${layerOfStep(s)}`, 'data-step': String(s) },
        el('span', { class: 'num', 'aria-hidden': 'true' }, String(s)), el('span', { class: 'short' })));
    }
    box.replaceChildren(el('span', { id: 'layers-label' }), el('button', { type: 'button', id: 'tp-back' }, icon('◁')),
      el('span', { class: 'step-pick' },
        el('button', { type: 'button', id: 'step-menu', 'aria-expanded': 'false', 'aria-controls': 'steps' },
          el('span', { class: 'sm-count' }), ' ', el('span', { class: 'sm-name' }), el('span', { class: 'sm-caret', 'aria-hidden': 'true' }, '▾')),
        steps),
      el('button', { type: 'button', id: 'tp-forward' }, icon('▷')),
      // (Prototype B: the program's side, over either depth, and the key, at the right end; round 6: on a line of
      // their own, together, where the controls do not fit on one.)
      el('span', { class: 'u-break', 'aria-hidden': 'true' }),
      el('button', { type: 'button', id: 'who-toggle', 'aria-pressed': 'false' }, el('span', { class: 'u-switch', 'aria-hidden': 'true' }), el('span', { class: 'who-text' })),
      el('button', { type: 'button', id: 'key-button', 'aria-expanded': 'false', 'aria-controls': 'u-keybox' }),
      el('span', { id: 'tp-live', class: 'tp-live', 'aria-live': 'polite' }));
  }

  /** The words of step `s`: its short name, its name, and "Step 4 of 8: words" (with what it adds, when nothing). */
  function stepWords(/** @type {number} */ s) {
    const t = labels.tree;
    const [short, name] = t.steps[s - 1];
    const said = t.stepper.step.replace('{i}', String(s)).replace('{n}', String(STEPS)).replace('{name}', name);
    return { short, name, said, full: added[s - 1] || s === 1 ? said : `${said} (${t.stepper.empty})` };
  }

  /**
   * (Round 7) The marks of the view, as the line under the controls says them and the key starts: the tint, the
   * `bash` mark, the outline of a command; each with its swatch.
   */
  function legendItems(/** @type {boolean} */ withTint) {
    const g = labels.depth.legend;
    const items = [];
    if (withTint) {
      items.push(el('span', { class: 'u-leg' }, el('span', { class: 'u-swatch-tint', 'aria-hidden': 'true' }), ' ', g.tint));
      items.push(el('span', { class: 'u-leg' }, el('span', { class: 'u-bmark' }, labels.depth.bashMark), ' ', g.bash));
    }
    items.push(el('span', { class: 'u-leg' }, el('span', { class: 'u-swatch u-swatch-hollow', 'aria-hidden': 'true' }), ' ', g.box));
    return items.flatMap((x, i) => (i ? [el('span', { class: 'u-leg-sep', 'aria-hidden': 'true' }, ' · '), x] : [x]));
  }

  /**
   * The key to the view (prototype B), opened by its button at the right of the controls (round 7: one legend): the
   * marks of the line under the controls, then the colours of the left bars, each named, the chips, the risks, the
   * order of bash's expansions and the keys.
   */
  let keyOpen = false;
  function keyEl(/** @type {any} */ k) {
    const d = labels.depth;
    const box = el('div', { id: 'u-keybox', class: 'u-key' });
    const close = el('button', { type: 'button', class: 'u-cap-hide', title: d.keyClose, 'aria-label': d.keyClose }, el('span', { 'aria-hidden': 'true' }, '× '), d.keyClose);
    close.addEventListener('click', () => {
      keyOpen = false;
      renderControls();
    });
    const head = el('div', { class: 'u-khead' }, el('strong', {}, k.title), close);
    const marks = el('div', {}, el('strong', {}, `${k.marks}: `), ...legendItems(true), ' · ',
      el('span', { class: 'u-argv u-argv-sample' }, el('code', { class: 'u-arg' }, el('span', { class: 'u-ph' }, '‹…›'))), ' ', k.ph.replace(/^‹…›:\s*/, ''), ' · ',
      el('span', { class: 'u-argv u-argv-sample' }, el('code', { class: 'u-arg u-many' }, '…')), ' ', k.many.replace(/^[^:]*:\s*/, ''), ' · ',
      el('span', { class: 'u-partof' }, ...inline(d.partOf.replace('{code}', '`-czf`'))), ' ', ...inline(k.partOf.replace(/^[^:]*:\s*/, '')));
    const argv = el('div', {}, ...inline(k.argvText));
    const bars = el('div', {}, el('strong', {}, `${k.bars}: `));
    k.kinds.forEach((/** @type {string[]} */ [kind, name], /** @type {number} */ i) => {
      if (i) bars.append(' · ');
      bars.append(el('span', { class: `u-kitem kind-${kind}` }, el('span', { class: 'u-swatch', 'aria-hidden': 'true' }), name));
    });
    const ja = document.documentElement.lang === 'ja';
    const chips = el('div', { class: 'u-kchips' }, el('strong', {}, `${k.chips}: `),
      el('span', { class: 'u-role l-bash' }, k.role), ' ', k.roleText, ' · ',
      el('span', { class: 'u-prog l-command' }, k.prog), ' ', k.progText, ' · ',
      el('span', { class: 'nk-badge nk-program' }, ja ? 'プログラム' : 'program'), ' ', ...inline(k.badgeText), ' · ', k.ref);
    const problems = el('div', {}, el('strong', {}, `${k.problems}: `),
      el('span', { class: 'u-kprob level-warning' }, k.warning), ' ', el('span', { class: 'u-kprob level-info' }, k.info));
    // (The lines under the controls, once the viewer hid them.)
    const stop = ja ? '。' : '. ';
    const caps = captionsHidden ? [el('div', {}, ...inline(`1: ${d.captions[0]}${stop}2: ${d.captions[1]}${stop}${d.who.caption}`))] : [];
    box.append(head, marks, argv, bars, chips, problems, el('div', {}, k.order), ...caps, el('div', {}, ...inline(k.keys)));
    return box;
  }

  /** Turns the program's side on or off, and keeps the choice. */
  function setWho(/** @type {boolean} */ on) {
    if (on === who) return;
    who = on;
    drawList();
    renderControls();
    save();
  }

  /** Draws the controls as the step is now. */
  function renderControls() {
    const t = labels.tree;
    if (!t) return;
    const p = t.stepper;
    const box = $('layers');
    if (!document.getElementById('steps')) buildControls(box);
    box.setAttribute('aria-label', p.group);
    $('layers-label').textContent = t.show;
    // (Prototype B: what the depth shown adds, and that the steps add up.)
    const d = labels.depth;
    const cap = document.getElementById('depth-caption');
    if (d && cap) {
      cap.hidden = !reading;
      // (One line: what the program's side shows when it is on, else what the depth shows; hidden for good by its
      // button, then said in the key.)
      // (Round 7: one legend. With the program's side, the line is its marks with their swatches; else what the
      // depth shows, and the outline of a command. Its button says what it hides.)
      const hide = el('button', { type: 'button', class: 'u-cap-hide', title: d.hideTitle, 'aria-label': d.hideTitle }, el('span', { 'aria-hidden': 'true' }, '× '), d.hide);
      hide.addEventListener('click', () => {
        captionsHidden = true;
        save();
        renderControls();
      });
      const said = who ? legendItems(true) : [...inline(d.captions[step - 1]), el('span', { class: 'u-leg-sep', 'aria-hidden': 'true' }, ' · '), ...legendItems(false)];
      const line = el('div', { class: `u-cap${who ? ' u-cap-who' : ''}` }, el('span', {}, ...said), hide);
      cap.replaceChildren(...(captionsHidden ? [] : [line]), ...(keyOpen ? [keyEl(d.key)] : []));
      const wt = $('who-toggle');
      wt.setAttribute('aria-pressed', String(who));
      wt.title = d.who.title;
      /** @type {HTMLElement} */ (wt.querySelector('.who-text')).textContent = d.who.label;
      $('key-button').textContent = d.key.title;
      $('key-button').setAttribute('aria-expanded', String(keyOpen));
    }
    const here = stepWords(step);
    box.querySelectorAll('button.step').forEach((b) => {
      const s = Number(/** @type {HTMLElement} */ (b).dataset.step);
      const w = stepWords(s);
      /** @type {HTMLElement} */ (b.querySelector('.short')).textContent = w.short;
      b.setAttribute('aria-label', w.full);
      /** @type {HTMLElement} */ (b).title = w.full;
      if (s === step) b.setAttribute('aria-current', 'step');
      else b.removeAttribute('aria-current');
      b.classList.toggle('passed', s < step);
      b.classList.toggle('empty', s > 1 && !added[s - 1]);
      // (One stop for Tab: the step shown; the arrows go to the others.)
      /** @type {HTMLElement} */ (b).tabIndex = s === step ? 0 : -1;
    });
    const menu = $('step-menu');
    /** @type {HTMLElement} */ (menu.querySelector('.sm-count')).textContent = `${step}/${STEPS}`;
    /** @type {HTMLElement} */ (menu.querySelector('.sm-name')).textContent = here.short;
    menu.setAttribute('aria-label', `${p.jump}: ${here.said}`);
    menu.title = p.jump;
    menu.className = `l-${layerOfStep(step)}`;
    for (const [id, text] of [['tp-back', p.back], ['tp-forward', p.forward]]) {
      $(id).setAttribute('aria-label', text);
      $(id).title = text;
    }
    // (aria-disabled, not disabled: a button that the focus is on keeps it at the first or the last step.)
    $('tp-back').setAttribute('aria-disabled', String(stepFrom(-1) === step));
    $('tp-forward').setAttribute('aria-disabled', String(stepFrom(1) === step));
    fitControls();
  }

  /**
   * The step buttons stay on one line: where they do not fit, the label goes first (.tight), then the steps' numbers
   * and the step back and forward buttons (.tighter: the steps are at hand), and last the buttons fold into a
   * stepper with a menu of the steps (.compact).
   */
  function fitControls() {
    const box = $('layers');
    if (!document.getElementById('steps') || box.closest('[hidden]')) return;
    const open = box.classList.contains('open');
    box.classList.remove('tight', 'tighter', 'compact', 'open', 'wrap');
    // (Prototype B: the stepper keeps its label and ◁ ▷; the steps fold into the menu first; last, the toggle and
    // the key go to a line of their own.)
    // (Round 5: the label stays on a phone; the arrows come with the stepper only.)
    // (Round 6: never the stepper and its menu: the two segments stay, with their numbers only when their names do not fit.)
    for (const level of ['wrap', 'tighter']) {
      if (box.scrollWidth <= box.clientWidth + 1) break;
      box.classList.add(level);
    }
    // (The menu stays open only while the stepper is shown.)
    box.classList.toggle('open', open && box.classList.contains('compact'));
    $('step-menu').setAttribute('aria-expanded', String(box.classList.contains('open')));
  }
  new ResizeObserver(() => {
    fitControls();
    syncLine();
  }).observe($('layers'));

  function announce(/** @type {string} */ text) {
    const live = document.getElementById('tp-live');
    if (live) live.textContent = text;
  }

  /**
   * The focus moves among the controls without scrolling: they are on the screen (sticky), and Chromium would
   * scroll the page to where they would be without sticking.
   */
  const STAY = { preventScroll: true };

  /** Opens or closes the menu of the steps (the stepper of narrow panels). */
  function stepMenu(/** @type {boolean} */ open, /** @type {boolean} */ focusIt = true) {
    const box = $('layers');
    if (!box.classList.contains('compact')) return;
    box.classList.toggle('open', open);
    $('step-menu').setAttribute('aria-expanded', String(open));
    if (!focusIt) return;
    if (open) /** @type {HTMLElement | null} */ (box.querySelector('button.step[aria-current]'))?.focus(STAY);
    else $('step-menu').focus(STAY);
  }

  /** A step chosen by the viewer: shown, and kept. */
  function choose(/** @type {number} */ s) {
    // (The step shown, or ◁ and ▷ at either end: nothing to do, and a motion running goes on.)
    if (s === step) return;
    setStep(s);
    save();
  }

  /**
   * Shows step `s`: the rows it adds grow from their parent and those it takes away shrink into it. The controls
   * stay where they are, and so does the first row of the tree on the screen that the step keeps (`firstRowKept`).
   */
  function setStep(/** @type {number} */ s) {
    s = Math.max(1, Math.min(STEPS, s));
    // (Prototype B: the one view is drawn again at the depth chosen, its folds reset; no motion.)
    if (s !== step) {
      step = s;
      collapsedKeys = new Set();
      dropSpacer();
      drawList();
      if (reading) announce(stepWords(s).full);
      renderControls();
      return;
    }
    if (flushMotion()) renderReading();
    const was = step;
    if (s !== was && view === 'tree' && reading) hold(firstRowKept(s), stuckRange(), $('layers').getBoundingClientRect().bottom);
    step = s;
    if (s !== was && reading) announce(stepWords(s).full);
    if (s === was || view !== 'tree' || !reading || !motion()) {
      renderReading();
      return;
    }
    if (s > was) {
      const before = new Set(Array.from($('reading-tree').querySelectorAll('li[role="treeitem"]'), (li) => /** @type {HTMLElement} */ (li).dataset.path ?? ''));
      renderReading();
      growIn(before);
      return;
    }
    renderControls();
    const gone = /** @type {HTMLElement[]} */ (Array.from($('reading-tree').querySelectorAll('li[role="treeitem"]')))
      .filter((li) => !shown(readingNodes.get(li)) && shown(readingNodes.get(/** @type {HTMLElement} */ (li.parentElement?.closest('li[role="treeitem"]')))));
    if (!gone.length) {
      renderReading();
      return;
    }
    shrinking = fold(gone.map((li) => ({ el: li, open: false })), () => {
      shrinking = null;
      renderReading();
    });
  }

  $('layers').addEventListener('click', (e) => {
    const b = e.target instanceof Element ? e.target.closest('button') : null;
    if (!b) return;
    const box = $('layers');
    if (b.matches('button.step')) {
      const inMenu = box.classList.contains('open');
      choose(Number(/** @type {HTMLElement} */ (b).dataset.step));
      if (inMenu) stepMenu(false);
      else /** @type {HTMLElement | null} */ (box.querySelector('button.step[aria-current]'))?.focus(STAY);
    } else if (b.id === 'step-menu') stepMenu(!box.classList.contains('open'));
    else if (b.id === 'tp-back' || b.id === 'tp-forward') choose(stepFrom(b.id === 'tp-back' ? -1 : 1));
    else if (b.id === 'who-toggle') setWho(!who);
    else if (b.id === 'key-button') {
      keyOpen = !keyOpen;
      renderControls();
    }
  });
  // (Prototype B) Keys, outside a text field: `1` and `2` choose the depth, `W` shows the program's side.
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || !reading || !built) return;
    const t = e.target;
    if (t instanceof Element && t.closest('input, textarea, select, [contenteditable="true"], .cm-editor')) return;
    if (e.key === '1' || e.key === '2') choose(Number(e.key));
    else if (e.key === 'w' || e.key === 'W') setWho(!who);
    else return;
    e.preventDefault();
  });
  // The arrows step (among the steps that add something), Home and End go to the line alone and to every layer. In
  // the menu of the steps, the arrows up and down move the focus, and Escape closes it.
  $('layers').addEventListener('keydown', (e) => {
    const box = $('layers');
    const onStep = e.target instanceof Element && e.target.matches('button.step');
    if (box.classList.contains('open')) {
      const list = /** @type {HTMLElement[]} */ (Array.from(box.querySelectorAll('button.step')));
      const i = list.indexOf(/** @type {HTMLElement} */ (e.target));
      if (e.key === 'Escape') stepMenu(false);
      else if (e.key === 'ArrowDown' && i >= 0) list[Math.min(list.length - 1, i + 1)].focus(STAY);
      else if (e.key === 'ArrowUp' && i >= 0) list[Math.max(0, i - 1)].focus(STAY);
      else if (e.key === 'Home' && i >= 0) list[0].focus(STAY);
      else if (e.key === 'End' && i >= 0) list[list.length - 1].focus(STAY);
      else if (e.key === 'Tab') {
        stepMenu(false, false);
        return;
      } else return;
      e.preventDefault();
      return;
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') choose(stepFrom(e.key === 'ArrowLeft' ? -1 : 1));
    else if (e.key === 'Home') choose(1);
    else if (e.key === 'End') choose(STEPS);
    else return;
    e.preventDefault();
    if (onStep) /** @type {HTMLElement | null} */ (box.querySelector('button.step[aria-current]'))?.focus(STAY);
  });
  // A click or the focus elsewhere closes the menu.
  document.addEventListener('pointerdown', (e) => {
    if ($('layers').classList.contains('open') && !(e.target instanceof Node && $('layers').querySelector('.step-pick')?.contains(e.target))) stepMenu(false, false);
  });
  $('layers').addEventListener('focusout', (e) => {
    const pick = $('layers').querySelector('.step-pick');
    if ($('layers').classList.contains('open') && !(e.relatedTarget instanceof Node && pick?.contains(e.relatedTarget))) stepMenu(false, false);
  });

  // ---------------------------------------------------------------- folding and unfolding, with motion

  /** How long a row takes to grow or shrink (ms), and how. */
  const MOTION_MS = 220;
  const EASE = 'cubic-bezier(0.2, 0, 0, 1)';
  /** The setting `panel.animations`, from the host. */
  let animations = true;
  /** Whether rows move: the setting is on, and neither the system nor VS Code (`workbench.reduceMotion`) asks for less motion. */
  const motion = () => animations && !matchMedia('(prefers-reduced-motion: reduce)').matches && !document.body.classList.contains('vscode-reduce-motion');
  /** The move of each box that moves. */
  const running = /** @type {WeakMap<Element, Animation>} */ (new WeakMap());
  /** The moves of heights, while they run: the row held in place follows them (`hold`). */
  const moves = /** @type {Set<Animation>} */ (new Set());
  /** A step back whose rows are shrinking: they are drawn away when it ends. */
  let shrinking = /** @type {{ cancel(): void } | null} */ (null);

  /** Ends a step back at once (true when one was moving). */
  function flushMotion() {
    if (!shrinking) return false;
    const s = shrinking;
    shrinking = null;
    s.cancel();
    return true;
  }

  /**
   * @typedef {{ el: HTMLElement, open: boolean, delay?: number }} Fold
   * A box that has just been unfolded (`open`) or folded: the state is the new one already (the class, `hidden`,
   * `aria-expanded`), and the box only moves to it. One unfolded grows from nothing to its height and fades in; one
   * folded is kept drawn (`data-closing`, panel.css) while it shrinks to nothing and fades out.
   */

  /**
   * Moves boxes that fold or unfold. Only the outermost move: those inside follow them (a box folded inside one that
   * folds is drawn until that one has shrunk). `after` runs once all have ended. Without motion (the setting, reduced
   * motion), nothing moves and `after` runs at once. The handle stops the moves, and `after` does not run then.
   */
  function fold(/** @type {(Fold | null)[]} */ changes, after = () => {}) {
    const list = /** @type {Fold[]} */ (changes.filter(Boolean));
    if (!motion()) {
      after();
      return { cancel() {} };
    }
    const outer = list.filter((c) => !list.some((o) => o !== c && o.el.contains(c.el)));
    // (Those that fold are drawn again first, all of them, then the heights are measured: a box that starts to move
    // moves those around it.)
    const closing = list.filter((c) => !c.open);
    for (const c of closing) c.el.dataset.closing = '';
    const height = (/** @type {HTMLElement} */ e) => e.getBoundingClientRect().height;
    const from = outer.map((c) => ({ h: running.has(c.el) || !c.open ? height(c.el) : 0, o: running.has(c.el) ? Number(getComputedStyle(c.el).opacity) : c.open ? 0 : 1 }));
    outer.forEach((c) => running.get(c.el)?.cancel());
    const to = outer.map((c) => (c.open ? height(c.el) : 0));
    /** @type {Animation[]} */
    const started = [];
    let left = outer.length;
    if (!left) after();
    outer.forEach((c, i) => {
      const box = c.el;
      const inner = closing.filter((o) => o !== c && box.contains(o.el));
      // (A clip, not overflow: the lines to the parent lie left of the box.)
      box.style.clipPath = 'inset(0 -100vw)';
      const a = box.animate([{ height: `${from[i].h}px`, opacity: from[i].o }, { height: `${to[i]}px`, opacity: c.open ? 1 : 0 }],
        { duration: MOTION_MS, delay: c.delay ?? 0, easing: EASE, fill: c.open ? 'backwards' : 'forwards' });
      running.set(box, a);
      moves.add(a);
      started.push(a);
      let over = false;
      const end = () => {
        moves.delete(a);
        if (over) return false;
        over = true;
        if (running.get(box) === a) running.delete(box);
        box.style.clipPath = '';
        for (const x of c.open ? inner : [c, ...inner]) delete x.el.dataset.closing;
        return true;
      };
      a.onfinish = () => {
        if (!end()) return;
        // (Folded and no longer drawn: the end of the move can go.)
        if (!c.open) a.cancel();
        if (--left === 0) after();
        // (The row held in place, at the last height, before the frame is drawn.)
        keep();
      };
      a.oncancel = end;
    });
    return { cancel: () => started.forEach((a) => a.cancel()) };
  }

  /** The rows a step adds grow from their parent (each new subtree, one after the other), and a new reader's band takes its tint and its edges from the band around it. */
  function growIn(/** @type {Set<string>} */ before) {
    const ul = $('reading-tree');
    const roots = /** @type {HTMLElement[]} */ (Array.from(ul.querySelectorAll('li[role="treeitem"]')))
      .filter((li) => !before.has(li.dataset.path ?? '') && before.has((li.dataset.path ?? '').replace(/\.\d+$/, '')));
    fold(roots.map((li, k) => ({ el: li, open: true, delay: Math.min(k, 8) * 30 })));
    roots.forEach((li, k) => {
      if (!li.classList.contains('band')) return;
      const style = getComputedStyle(li);
      const parent = li.parentElement?.closest('li');
      const from = parent ? getComputedStyle(parent).backgroundColor : 'transparent';
      // (Its edges come in with the tint.)
      const to = { backgroundColor: style.backgroundColor, borderLeftColor: style.borderLeftColor, borderTopColor: style.borderTopColor, borderBottomColor: style.borderBottomColor };
      li.animate([{ backgroundColor: from, borderLeftColor: from, borderTopColor: from, borderBottomColor: from }, to], { duration: MOTION_MS + 200, delay: Math.min(k, 8) * 30 + 80, easing: 'ease-out', fill: 'backwards' });
    });
  }

  // ---------------------------------------------------------------- keeping the row acted on in place

  /*
   * A fold, an unfold or a step changes the height of what lies around the row the viewer acted on. The panel
   * scrolls so that this row stays where it was on the screen: right after the change, at every frame of the motion
   * (a frame's callback runs after the moves have stepped and before the frame is drawn), and at its end. CSS's own
   * scroll anchoring (`overflow-anchor`) is turned off (panel.css): it chooses its own row, it differs from browser
   * to browser, and it cannot keep a page whose end comes up.
   *
   * There the browser would pull the page down (it keeps the scroll position within the content): a blank spacer
   * below the content holds the page instead, and goes as the viewer scrolls up. Only its part below the screen is
   * taken away, so the scroll range narrows and nothing on the screen moves; it is gone once the content reaches
   * the bottom of the screen again, and dropped with a new line or another view.
   *
   * The panel scrolls as a page in all its hosts: VS Code's webview, and the web page's frame (beside the editor, or
   * under it on a phone).
   */
  const spacer = document.createElement('div');
  spacer.id = 'scroll-spacer';
  spacer.setAttribute('aria-hidden', 'true');
  document.body.append(spacer);
  /** Where the spacer ends, from the top of the page (0: no spacer). */
  let spacerEnd = 0;

  /** Where the content ends, from the top of the page: the bottom of <html>, which the spacer (placed absolutely) leaves as it is. */
  const contentEnd = () => document.documentElement.getBoundingClientRect().bottom + window.scrollY;

  /** Makes the page reach `end` at least (0: no spacer). */
  function setSpacer(/** @type {number} */ end) {
    spacerEnd = end;
    spacer.style.height = end ? `${end - (spacer.getBoundingClientRect().top + window.scrollY)}px` : '0px';
  }

  /**
   * Takes away the part of the spacer below the screen, and all of it once the content reaches the bottom of the
   * screen; not while a row is held, whose content may still shrink.
   */
  function trimSpacer() {
    if (!spacerEnd) return;
    const end = Math.min(spacerEnd, window.scrollY + window.innerHeight);
    setSpacer(!anchor && end <= contentEnd() + 0.5 ? 0 : end);
  }

  /** Lets go of the row held and drops the spacer: the content is drawn anew. */
  function dropSpacer() {
    if (anchor) cancelAnimationFrame(anchor.frame);
    anchor = null;
    if (spacerEnd) setSpacer(0);
  }
  window.addEventListener('scroll', () => {
    if (!anchor) trimSpacer();
  }, { passive: true });

  /** The row held in place: how to find it (it may be drawn again), where it is to stay on the screen, and the scroll position after the last correction. */
  let anchor = /** @type {{ find: () => Element | null, top: number, y: number, range: (() => number[]) | null, frame: number } | null} */ (null);

  /**
   * Holds the row `find` returns where it is on the screen while what is about to change does: called before the
   * change. Until the row's new place is known, the page is held at its scroll position (the spacer). `range`, when
   * given, says between which scroll positions the page is to stay (see `stuckRange`). A row above `below` (the top of
   * the screen under the sticky rows: an ancestor of the rows on the screen that go) is held just under it, so that the
   * page does not stay where nothing is drawn.
   */
  function hold(/** @type {(() => Element | null) | null} */ find, /** @type {(() => number[]) | null} */ range = null, below = 0) {
    settle();
    const row = find?.();
    if (!find || !row) return;
    setSpacer(Math.max(spacerEnd, window.scrollY + window.innerHeight));
    const r = row.getBoundingClientRect();
    const a = { find, top: r.bottom <= below ? below : r.top, y: window.scrollY, range, frame: 0 };
    anchor = a;
    // (After the change, which the caller makes next, before anything is drawn; then at each frame.)
    queueMicrotask(() => {
      if (anchor !== a) return;
      keep();
      a.frame = requestAnimationFrame(follow);
    });
  }

  /** Scrolls the row held back to its place, and takes away the spacer below the screen. */
  function keep() {
    const a = anchor;
    if (!a) return;
    const row = a.find();
    // (A scroll by the viewer meanwhile moves the row with it.)
    a.top -= window.scrollY - a.y;
    let y = window.scrollY;
    if (row && row.getClientRects().length) y += row.getBoundingClientRect().top - a.top;
    if (a.range) {
      const [lo, hi] = a.range();
      y = Math.min(Math.max(y, lo), Math.max(lo, hi));
    }
    y = Math.max(0, y);
    if (Math.abs(y - window.scrollY) > 0.25) {
      setSpacer(Math.max(spacerEnd, y + window.innerHeight));
      window.scrollTo({ top: y, behavior: 'instant' });
    }
    a.y = window.scrollY;
    trimSpacer();
  }

  /** At each frame while rows move; the row is let go once they stop. */
  function follow() {
    if (!anchor) return;
    keep();
    if (moves.size) anchor.frame = requestAnimationFrame(follow);
    else {
      anchor = null;
      trimSpacer();
    }
  }

  /** Lets go of the row held, after a last correction (another change is about to start). */
  function settle() {
    if (!anchor) return;
    cancelAnimationFrame(anchor.frame);
    keep();
    anchor = null;
    trimSpacer();
  }

  /** Finds the row of the item at `path` in the list (`#tree`) or in the reading tree, as drawn when it is called. */
  const rowAt = (/** @type {'list' | 'reading'} */ list, /** @type {string} */ path) => () =>
    document.querySelector(list === 'list' ? `#tree li[data-path="${path}"] > .row` : `#reading-tree li[data-path="${path}"] > .trow`);

  /**
   * Of `items`, the first row on the screen (below `below`, the sticky rows at the top) that `stays` after a change;
   * else the nearest item around the first on the screen that stays.
   */
  function firstOnScreen(/** @type {HTMLElement[]} */ items, /** @type {'list' | 'reading'} */ list, /** @type {number} */ below, /** @type {(li: HTMLElement) => boolean} */ stays) {
    const on = items.filter((li) => {
      const r = /** @type {HTMLElement} */ (li.firstElementChild).getBoundingClientRect();
      return r.bottom > below && r.top < window.innerHeight;
    });
    let li = /** @type {HTMLElement | null | undefined} */ (on.find(stays) ?? on[0]);
    while (li && !stays(li)) li = /** @type {HTMLElement | null} */ (li.parentElement?.closest('li'));
    return li ? rowAt(list, String(li.dataset.path)) : null;
  }

  /**
   * Where the step controls are stuck under the line, when they are: between the scroll position where they start
   * to stick and the one where the end of the tree (their section) would take them up with it. A step keeps them
   * where they are, before the row it holds: when that row would have to go further, it moves.
   */
  function stuckRange() {
    const box = $('layers');
    const top = parseFloat(getComputedStyle(box).top);
    const at = () => $('reading').getBoundingClientRect().top + window.scrollY - top;
    if (window.scrollY < at() - 0.5) return null;
    // (Sticky keeps the box with its margin inside the section.)
    return () => [at(), $('reading').getBoundingClientRect().bottom + window.scrollY - top - box.offsetHeight - parseFloat(getComputedStyle(box).marginBottom)];
  }

  /** The row of the reading tree a change to step `s` keeps in place: the first on the screen that the step still shows. */
  function firstRowKept(/** @type {number} */ s) {
    return firstOnScreen(visibleItems(), 'reading', $('layers').getBoundingClientRect().bottom, (li) => (appear.get(readingNodes.get(li)) ?? 1) <= s);
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
    const kids = n.children.filter((/** @type {any} */ c) => shown(c));
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
    // (The badge after the code, then the kind of node; a reserved word's kind says what it is.)
    const badge = n.kind === 'keyword' ? [] : nameBadge(n.name);
    head.append(...badge, chip);
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
    const also = nameAlso(n.name);
    if (also) row.append(also);
    const spoken = badge.length ? `, ${nameSpoken(n.name)}` : '';
    li.setAttribute('aria-label', `${chip.textContent}${code ? ` ${code}` : ''}${spoken}. ${readerOf(n)}. ${spokenMarks(about.replace(/`/g, ''))}${also ? `. ${also.textContent}` : ''}`);
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

  /** The items not inside a folded one (nor in a row a step takes away), in order. */
  function visibleItems() {
    return /** @type {HTMLElement[]} */ (Array.from($('reading-tree').querySelectorAll('li[role="treeitem"]')))
      .filter((li) => !li.parentElement?.closest('ul[role="group"][hidden]') && !li.closest('li[data-closing]'));
  }

  function focusedNode() {
    const li = document.activeElement instanceof HTMLElement && document.activeElement.closest('#reading-tree li[role="treeitem"]');
    return li ? readingNodes.get(li) : null;
  }

  function focusItem(/** @type {HTMLElement} */ li) {
    $('reading-tree').querySelectorAll('li[tabindex="0"]').forEach((x) => { /** @type {HTMLElement} */ (x).tabIndex = -1; });
    li.tabIndex = 0;
    currentKey = String(li.dataset.path);
    // (Not scrolled by the focus: a click leaves the row where it is, and the keys scroll it into view themselves.)
    li.focus({ preventScroll: true });
  }

  function toggleItem(/** @type {HTMLElement} */ li) {
    const group = li.querySelector(':scope > ul[role="group"]');
    if (!group) return;
    hold(rowAt('reading', String(li.dataset.path)));
    fold([setFolded(li, !/** @type {HTMLElement} */ (group).hidden)]);
  }

  /** Folds or unfolds an item of the tree; the change returned says how its group moves (see `fold`). */
  function setFolded(/** @type {HTMLElement} */ li, /** @type {boolean} */ fold) {
    const group = /** @type {HTMLElement | null} */ (li.querySelector(':scope > ul[role="group"]'));
    if (!group) return null;
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
    return { el: group, open: !fold };
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
    // (Tab into the tree: the browser shows the item, which may leave its row under the sticky rows.)
    if (li && e.target === li && Date.now() - pointerAt > 500) showRow(li);
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
        if (group && group.hidden) toggleItem(li);
        else if (group) next = /** @type {HTMLElement} */ (group.firstElementChild);
        break;
      case 'ArrowLeft':
        if (group && !group.hidden) toggleItem(li);
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
      showRow(next);
    }
  });

  /**
   * Scrolls an item's own row into view, below the sticky line and step controls (the page's `scroll-padding-top`):
   * the item holds its group too, taller than the screen, which the browser would take as in view already.
   */
  function showRow(/** @type {HTMLElement} */ li) {
    li.querySelector(':scope > .trow')?.scrollIntoView({ block: 'nearest' });
  }

  /** When the pointer last went down: a focus soon after it is the pointer's, and leaves the row where it is. */
  let pointerAt = 0;
  document.addEventListener('pointerdown', () => { pointerAt = Date.now(); }, true);

  /** Selects a token's range in the editor, only when it lies on the line explained. A range on another line (a clause of a
      `case` under its `while`, one over several lines: an if, a loop, a function) would move the cursor there, and the panel
      would explain that line instead, when one only meant to fold the row; the hover already shows that range. */
  function reveal(token, /** @type {boolean} */ keepFocus = false) {
    if (token.span.start.line === shownLineNo && token.span.end.line === shownLineNo) vscode.postMessage({ type: 'reveal', span: token.span, preserveFocus: keepFocus });
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
    dropSpacer();
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
    for (const e of hits) {
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
    return text.split(/(`[^`]+`)/).filter(Boolean).flatMap((part) => {
      if (part.startsWith('`') && part.endsWith('`') && part.length > 1) {
        const c = document.createElement('code');
        c.append(...withMarks(part.slice(1, -1)));
        // (Round 7: code never breaks inside a line of text, but a long one, which may.)
        if (part.length > 32) c.className = 'u-long';
        return [c];
      }
      return withMarks(part).map((n) => (typeof n === 'string' ? document.createTextNode(n) : n));
    });
  }

  /**
   * A text with each control picture (\u240a for a newline, \u21e5 for a tab) drawn by CSS (`.ev-ctl`): a small box with the
   * picture's name in it (`LF`), and what it stands for as its label. The pictures are boxes where no font has their block.
   */
  function withMarks(/** @type {string} */ text) {
    return text.split(/([\u2400-\u241f\u2421\u21e5])/u).map((part, i) => {
      if (!(i % 2)) return part;
      const [name, what] = controlMarks[part] ?? [part, part];
      const m = document.createElement('span');
      m.className = 'ev-ctl';
      m.setAttribute('role', 'img');
      m.setAttribute('aria-label', what);
      m.textContent = name;
      return m;
    });
  }

  /** A text with each control picture as the words it stands for, for a screen reader. */
  function spokenMarks(/** @type {string} */ text) {
    return text.replace(/[\u2400-\u241f\u2421\u21e5]/gu, (p) => (controlMarks[p] ? ` ${controlMarks[p][1]} ` : p));
  }

  $('settings').addEventListener('click', () => vscode.postMessage({ type: 'openSettings' }));

  /**
   * Puts the focus in the explanation (the web page's key from the editor, F6): the tree view's current item, the quick
   * reference's search field, or else the explanation itself, from where a screen reader reads on.
   */
  function focusExplanation() {
    if (!$('reference').hidden) return $('ref-search').focus();
    const li = view === 'tree' && reading ? /** @type {HTMLElement | null} */ ($('reading-tree').querySelector('li[tabindex="0"]')) : null;
    if (li) return li.focus();
    $('main').tabIndex = -1;
    $('main').focus();
  }
})();
