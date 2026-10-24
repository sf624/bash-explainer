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
  /** The sections of the manual the rows and notes cite: { '3.7.2': { label, title, url } }. */
  let manual = /** @type {Record<string, { label: string, title: string, url: string }>} */ ({});
  /** Editable examples by id: where to show the result of a rerun. */
  /** @type {Map<number, { spec: any, layer: HTMLElement, results: HTMLElement, empty: string }>} */
  const editors = new Map();
  let nextId = 0;
  /** Quick reference entries, loaded on first use. */
  /** @type {Array<{ category: string, syntax: string, meaning: string }> | undefined} */
  let reference;

  /** The view shown ('list' or 'tree') and the step of the tree shown (1–8, see STEPS): what the viewer chose last. */
  let view = 'list';
  let step = 8;
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
    measureSteps();
    stopPlay(true);
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
    animations = msg.animations !== false;
    $('where').textContent = `${msg.file} · ${msg.lineLabel}`;
    $('context').textContent = msg.contextLabels.length ? ' › ' + msg.contextLabels.join(' › ') : '';
    renderDialect(msg.dialect);

    flat = [];
    editors.clear();
    const where = `${msg.file}\n${ex.line}`;
    if (where !== shownLine) {
      // A cursor move stops the tree's play: the new line is shown whole.
      stopPlay(true);
      collapsedKeys = new Set();
      foldedKeys = new Set();
      currentKey = '';
    }
    shownLine = where;
    shownLineNo = ex.line;
    reading = ex.reading ?? null;
    measureSteps();
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

  /** Folds or unfolds an item of the list; the change returned says how what lies under it moves (see `fold`). */
  function setCollapsed(/** @type {HTMLElement} */ li, /** @type {boolean} */ want) {
    li.classList.toggle('collapsed', want);
    const path = String(li.dataset.path);
    if (want) collapsedKeys.add(path);
    else collapsedKeys.delete(path);
    const tw = li.querySelector(':scope > .row > .twisty');
    if (tw) tw.textContent = want ? '▸' : '▾';
    const body = /** @type {HTMLElement | null} */ (li.querySelector(':scope > .body'));
    return body && { el: body, open: !want };
  }

  const isCollapsed = (/** @type {HTMLElement} */ li) => li.classList.contains('collapsed');

  function toggle(/** @type {HTMLElement} */ li) {
    fold([setCollapsed(li, !isCollapsed(li))]);
  }

  $('toggle').addEventListener('click', () => {
    if (view === 'tree' && reading) {
      // The tree view: fold everything below the line, or unfold it all.
      const all = /** @type {HTMLElement[]} */ (Array.from($('reading-tree').querySelectorAll('li[aria-expanded]')));
      const close = !all.some((li) => li.getAttribute('aria-expanded') === 'false');
      const want = (/** @type {HTMLElement} */ li) => close && li.getAttribute('aria-level') !== '1';
      fold(all.filter((li) => want(li) !== (li.getAttribute('aria-expanded') === 'false')).map((li) => setFolded(li, want(li))));
      updateToggle();
      return;
    }
    const items = Array.from($('tree').querySelectorAll('li')).filter((li) => li.querySelector(':scope > .body > ul'));
    const collapse = !items.some(isCollapsed);
    // Collapse below the top level, so the outline stays visible.
    const want = (/** @type {HTMLElement} */ li) => collapse && li.parentElement !== $('tree');
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
    const on = !$('reading').hidden;
    document.documentElement.style.setProperty('--controls-h', `${on ? steps.offsetHeight : 0}px`);
    steps.classList.toggle('stuck', on && window.scrollY > 0 && steps.getBoundingClientRect().top <= top.offsetHeight + 1);
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

  /** The layers, in the order the steps add them. */
  const LEVEL = /** @type {Record<string, number>} */ ({ bash: 1, child: 2, command: 3, language: 4 });

  /**
   * The steps of the tree view, from the line alone to every layer. Steps 1 to 5 unfold bash's own reading by the
   * kind of its nodes: the line, its lists and pipelines, its commands, their words, and what is inside the words
   * (quotes, expansions, the scripts of substitutions as bash reads them). Steps 6 to 8 add the other readers: the
   * scripts inside (a child shell), each command's reading of its arguments, and the languages.
   */
  const STEPS = 8;
  const BASH_STEP = /** @type {Record<string, number>} */ ({
    line: 1, list: 2, pipeline: 2, command: 3, compound: 3, clause: 3, coprocess: 3, function: 3,
    commandName: 4, aliasWord: 4, expandedName: 4, option: 4, argument: 4, assignmentArgument: 4, word: 4, name: 4,
    assignment: 4, redirect: 4, heredoc: 4, operator: 4, keyword: 4, comment: 4,
  });
  /** The step a node appears at by itself: in bash's reading by its kind (5: a part of a word), else its layer's. */
  const ownStep = (/** @type {any} */ n) => (n.layer === 'bash' ? BASH_STEP[n.kind] ?? 5 : LEVEL[n.layer] + 4);
  /** The layer a step shows up to (1–4). */
  const levelOf = (/** @type {number} */ s) => Math.max(1, s - 4);

  /** Tells the host the choice: it keeps it for the next time (VS Code's global state, the web page's storage) and, in the list view, builds no tree. */
  function save() {
    // (`level` too: what the panel kept before the steps.)
    const state = { view, step, level: levelOf(step) };
    vscode.setState(state);
    vscode.postMessage({ type: 'panelState', state });
  }

  /** The view and step the viewer chose (VS Code's webview state; on the web page, the page sends them). */
  function applyState(/** @type {any} */ state) {
    if (!state || typeof state !== 'object') return;
    if (state.view === 'tree' || state.view === 'list') view = state.view;
    // (Before the steps, the panel kept the layers shown, 1–4: each is the last step of its layer.)
    if (Number.isInteger(state.step) && state.step >= 1 && state.step <= 8) step = state.step;
    else if ([1, 2, 3, 4].includes(state.level)) step = state.level + 4;
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
    requestAnimationFrame(syncLine);
  }

  for (const [id, v] of [['view-list', 'list'], ['view-tree', 'tree']]) {
    $(id).addEventListener('click', () => {
      if (view === v) return;
      stopPlay();
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


  /** The step each node of the line shown appears at: its own, or its parent's when that is later (a node is drawn under its parent). */
  let appear = /** @type {WeakMap<object, number>} */ (new WeakMap());
  /** How many nodes each step adds to the line (index 0: step 1); a step that adds none is passed over by the play. */
  let added = /** @type {number[]} */ (new Array(STEPS).fill(0));
  /**
   * The nodes that show what their kind is in general (where no token says more): for each kind, the first node to
   * appear, by step and then in order. The text stays on that node from step to step, and is not on every argument.
   */
  let aboutAt = /** @type {Set<object>} */ (new Set());

  const aboutKey = (/** @type {any} */ n) => (n.kind === 'language' && n.reader === 'bash' ? 'bashLanguage' : n.kind);

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

  // ---------------------------------------------------------------- the steps of the tree, and playing them

  /**
   * How the step control is laid out. 'segments', the default: a button per step, which fold into a stepper with a
   * menu of the steps where they do not fit. The others are kept for comparing layouts, behind a temporary switch
   * (`data-step-layout` on <html>, or `?stepLayout=` on the web page): 'slider' (a range, with the steps' numbers
   * and the name of the one shown) and 'layers' (the four readers' buttons, and bash's own depth as a stepper).
   */
  function layoutOf() {
    let q = document.documentElement.dataset.stepLayout ?? null;
    try {
      q = new URLSearchParams(window.parent.location.search).get('stepLayout') ?? q;
    } catch {
      // (A frame of another origin, as in VS Code: only the attribute.)
    }
    return q === 'slider' || q === 'layers' ? q : 'segments';
  }
  new MutationObserver(() => renderControls()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-step-layout'] });

  /** The time a step of the play is shown (ms). */
  const STEP_MS = 1200;
  /** The play's timer, while it plays. */
  let playTimer = 0;

  /** The steps that add something to the line shown (the line itself always), in order. */
  const playable = () => Array.from({ length: STEPS }, (_, i) => i + 1).filter((s) => s === 1 || added[s - 1] > 0);

  /** The step `d` steps from the one shown, among those that add something (the one shown at either end). */
  function stepFrom(/** @type {number} */ d) {
    const list = playable();
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
  const layerOfStep = (/** @type {number} */ s) => LAYERS[levelOf(s) - 1];

  /** Makes the controls of a layout (once; again when the layout is switched). */
  function buildControls(/** @type {HTMLElement} */ box, /** @type {string} */ layout) {
    box.dataset.layout = layout;
    box.classList.remove('tight', 'tighter', 'compact', 'open');
    // (Step back and forward on either side of the steps; Play and Replay at the end.)
    const parts = [el('span', { id: 'layers-label' }), el('button', { type: 'button', id: 'tp-back' }, icon('◁'))];
    if (layout === 'segments') {
      const steps = el('div', { id: 'steps', role: 'group' });
      for (let s = 1; s <= STEPS; s++) {
        steps.append(el('button', { type: 'button', class: `step l-${layerOfStep(s)}`, 'data-step': String(s) },
          el('span', { class: 'num', 'aria-hidden': 'true' }, String(s)), el('span', { class: 'short' })));
      }
      parts.push(el('span', { class: 'step-pick' },
        el('button', { type: 'button', id: 'step-menu', 'aria-haspopup': 'true', 'aria-expanded': 'false', 'aria-controls': 'steps' },
          el('span', { class: 'sm-count' }), ' ', el('span', { class: 'sm-name' }), el('span', { class: 'sm-caret', 'aria-hidden': 'true' }, '▾')),
        steps));
    } else if (layout === 'slider') {
      const ticks = el('div', { class: 'ticks', 'aria-hidden': 'true' });
      for (let s = 1; s <= STEPS; s++) {
        const tick = el('button', { type: 'button', tabindex: '-1', class: `tick l-${layerOfStep(s)}`, 'data-step': String(s) }, String(s));
        // (Through the CSSOM: the panel's content security policy refuses style attributes.)
        tick.style.setProperty('--at', String((s - 1) / (STEPS - 1)));
        ticks.append(tick);
      }
      parts.push(el('span', { class: 'slider' },
        el('input', { type: 'range', id: 'step-range', min: '1', max: String(STEPS), step: '1' }), ticks),
      el('span', { id: 'step-name' }));
    } else {
      LAYERS.forEach((layer, i) => {
        const b = el('button', { type: 'button', class: `layer l-${layer}`, 'data-level': String(i + 1) });
        if (i) parts.push(b);
        else {
          parts.push(el('span', { class: 'bash-group l-bash' }, b,
            el('span', { class: 'depth', role: 'group' },
              el('button', { type: 'button', id: 'depth-down' }, icon('−')), el('span', { id: 'depth-at' }), el('button', { type: 'button', id: 'depth-up' }, icon('+')))));
        }
      });
    }
    parts.push(el('button', { type: 'button', id: 'tp-forward' }, icon('▷')), el('span', { id: 'tree-play' },
      el('button', { type: 'button', id: 'tp-play' }, icon('▶'), el('span', { class: 'tp-name' })),
      el('button', { type: 'button', id: 'tp-replay' }, icon('↻'))),
    el('span', { id: 'tp-live', class: 'tp-live', 'aria-live': 'polite' }));
    box.replaceChildren(...parts);
  }

  /** The words of step `s`: its short name, its name, and "Step 4 of 8: words" (with what it adds, when nothing). */
  function stepWords(/** @type {number} */ s) {
    const t = labels.tree;
    const [short, name] = t.steps[s - 1];
    const said = t.play.step.replace('{i}', String(s)).replace('{n}', String(STEPS)).replace('{name}', name);
    return { short, name, said, full: added[s - 1] || s === 1 ? said : `${said} (${t.play.empty})` };
  }

  /** Draws the controls as the step and the play are now. */
  function renderControls() {
    const t = labels.tree;
    if (!t) return;
    const p = t.play;
    const box = $('layers');
    const layout = layoutOf();
    if (box.dataset.layout !== layout) buildControls(box, layout);
    box.setAttribute('aria-label', p.group);
    $('layers-label').textContent = t.show;
    const here = stepWords(step);
    if (layout === 'segments') {
      $('steps').setAttribute('aria-label', p.group);
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
      fitControls();
    } else if (layout === 'slider') {
      const range = /** @type {HTMLInputElement} */ ($('step-range'));
      range.value = String(step);
      range.setAttribute('aria-label', p.group);
      range.setAttribute('aria-valuetext', here.full);
      range.style.setProperty('--fill', String((step - 1) / (STEPS - 1)));
      box.querySelectorAll('button.tick').forEach((b) => {
        const s = Number(/** @type {HTMLElement} */ (b).dataset.step);
        b.classList.toggle('current', s === step);
        b.classList.toggle('passed', s < step);
        b.classList.toggle('empty', s > 1 && !added[s - 1]);
        /** @type {HTMLElement} */ (b).title = stepWords(s).full;
      });
      $('step-name').textContent = `${step}/${STEPS} ${here.short}`;
    } else {
      box.querySelectorAll('button.layer').forEach((b, i) => {
        b.textContent = t.levels[i];
        b.setAttribute('aria-pressed', String(levelOf(step) === i + 1));
      });
      const depth = Math.min(step, 5);
      $('depth-at').textContent = `${depth}/5`;
      $('depth-at').title = stepWords(depth).name;
      box.querySelector('.depth')?.setAttribute('aria-label', p.depth);
      $('depth-down').setAttribute('aria-label', `${p.depth} −: ${depth > 1 ? stepWords(depth - 1).name : ''}`);
      $('depth-up').setAttribute('aria-label', `${p.depth} +: ${depth < 5 ? stepWords(depth + 1).name : ''}`);
      $('depth-down').setAttribute('aria-disabled', String(depth <= 1));
      $('depth-up').setAttribute('aria-disabled', String(step >= 5));
    }
    const playing = !!playTimer;
    const pb = $('tp-play');
    pb.setAttribute('aria-pressed', String(playing));
    pb.setAttribute('aria-label', p.play);
    pb.title = playing ? p.pause : p.play;
    /** @type {HTMLElement} */ (pb.querySelector('.tp-icon')).textContent = playing ? '❚❚' : '▶';
    /** @type {HTMLElement} */ (pb.querySelector('.tp-name')).textContent = playing ? p.pause : p.play;
    for (const [id, text] of [['tp-back', p.back], ['tp-forward', p.forward], ['tp-replay', p.replay]]) {
      $(id).setAttribute('aria-label', text);
      $(id).title = text;
    }
    // (aria-disabled, not disabled: a button that the focus is on keeps it at the first or the last step.)
    $('tp-back').setAttribute('aria-disabled', String(stepFrom(-1) === step));
    $('tp-forward').setAttribute('aria-disabled', String(stepFrom(1) === step));
  }

  /**
   * The step buttons stay on one line: where they do not fit, the label and Play's text go first (.tight), then the
   * steps' numbers and the step back and forward buttons (.tighter: the steps are at hand), and last the buttons fold
   * into a stepper with a menu of the steps (.compact).
   */
  function fitControls() {
    const box = $('layers');
    if (box.dataset.layout !== 'segments' || box.closest('[hidden]')) return;
    const open = box.classList.contains('open');
    box.classList.remove('tight', 'tighter', 'compact', 'open');
    for (const level of ['tight', 'tighter', 'compact']) {
      if (box.scrollWidth <= box.clientWidth + 1) return;
      box.classList.add(level);
    }
    box.classList.toggle('open', open);
  }
  new ResizeObserver(() => {
    fitControls();
    syncLine();
  }).observe($('layers'));

  function announce(/** @type {string} */ text) {
    const live = document.getElementById('tp-live');
    if (live) live.textContent = text;
  }

  /** Opens or closes the menu of the steps (the stepper of narrow panels). */
  function stepMenu(/** @type {boolean} */ open, /** @type {boolean} */ focusIt = true) {
    const box = $('layers');
    if (!box.classList.contains('compact')) return;
    box.classList.toggle('open', open);
    $('step-menu').setAttribute('aria-expanded', String(open));
    if (!focusIt) return;
    if (open) /** @type {HTMLElement | null} */ (box.querySelector('button.step[aria-current]'))?.focus();
    else $('step-menu').focus();
  }

  /** A step chosen by hand: the play stops there. */
  function choose(/** @type {number} */ s) {
    stopPlay();
    setStep(s, true);
    save();
  }

  /** Shows step `s`; with `animate`, the rows it adds grow from their parent and those it takes away shrink into it. */
  function setStep(/** @type {number} */ s, /** @type {boolean} */ animate, /** @type {boolean} */ follow = false) {
    s = Math.max(1, Math.min(STEPS, s));
    if (flushMotion()) renderReading();
    const was = step;
    step = s;
    if (s !== was && reading) announce(stepWords(s).full);
    if (s === was || view !== 'tree' || !reading || !animate || !motion()) {
      renderReading();
      return;
    }
    if (s > was) {
      const before = new Set(Array.from($('reading-tree').querySelectorAll('li[role="treeitem"]'), (li) => /** @type {HTMLElement} */ (li).dataset.path ?? ''));
      renderReading();
      growIn(before, follow);
      return;
    }
    renderControls();
    const gone = /** @type {HTMLElement[]} */ (Array.from($('reading-tree').querySelectorAll('li[role="treeitem"]')))
      .filter((li) => !shown(readingNodes.get(li)) && shown(readingNodes.get(/** @type {HTMLElement} */ (li.parentElement?.closest('li[role="treeitem"]')))));
    shrinking = fold(gone.map((li) => ({ el: li, open: false })), () => {
      shrinking = null;
      renderReading();
    });
  }

  /** Stops the play; with `whole`, every layer is shown (a new line, or the panel emptied, while it played). */
  function stopPlay(whole = false) {
    if (!playTimer) return;
    clearTimeout(playTimer);
    playTimer = 0;
    if (whole) {
      step = STEPS;
      save();
    }
    if (document.getElementById('tp-play')) renderControls();
  }

  /** The play's next step; at the last one that adds something, it ends with every layer shown, as the steps say. */
  function tick() {
    const next = stepFrom(1);
    if (next !== step) setStep(next, true, true);
    if (stepFrom(1) === step) {
      playTimer = 0;
      step = STEPS;
      save();
      renderControls();
      return;
    }
    playTimer = window.setTimeout(tick, STEP_MS);
    renderControls();
  }

  /** Play or pause; a play at the last step starts from the line alone. Without motion, the steps change at once. */
  function togglePlay(/** @type {boolean} */ fromStart = false) {
    if (!reading) return;
    if (playTimer) {
      stopPlay();
      save();
      announce(labels.tree.play.paused);
      return;
    }
    if (fromStart || stepFrom(1) === step) setStep(1, true);
    playTimer = window.setTimeout(tick, STEP_MS);
    renderControls();
  }

  $('layers').addEventListener('click', (e) => {
    const b = e.target instanceof Element ? e.target.closest('button') : null;
    if (!b) return;
    const box = $('layers');
    if (b.matches('button.step, button.tick')) {
      const inMenu = box.classList.contains('open');
      choose(Number(/** @type {HTMLElement} */ (b).dataset.step));
      if (inMenu) stepMenu(false);
      else if (b.matches('button.step')) /** @type {HTMLElement | null} */ (box.querySelector('button.step[aria-current]'))?.focus();
    } else if (b.id === 'step-menu') stepMenu(!box.classList.contains('open'));
    else if (b.matches('button.layer')) choose(Number(/** @type {HTMLElement} */ (b).dataset.level) + 4);
    else if (b.id === 'depth-down') choose(Math.max(1, Math.min(step, 5) - 1));
    else if (b.id === 'depth-up') choose(Math.min(5, step + 1));
    else if (b.id === 'tp-back' || b.id === 'tp-forward') {
      stopPlay();
      setStep(stepFrom(b.id === 'tp-back' ? -1 : 1), true);
      save();
    } else if (b.id === 'tp-play') togglePlay();
    else if (b.id === 'tp-replay') {
      stopPlay();
      togglePlay(true);
    }
  });
  $('layers').addEventListener('input', (e) => {
    if (e.target instanceof HTMLInputElement && e.target.id === 'step-range') choose(Number(e.target.value));
  });
  // The arrows step (among the steps that add something), Home and End go to the line alone and to every layer. In
  // the menu of the steps, the arrows up and down move the focus, and Escape closes it.
  $('layers').addEventListener('keydown', (e) => {
    const box = $('layers');
    if (e.target instanceof HTMLInputElement) return;
    const onStep = e.target instanceof Element && e.target.matches('button.step');
    if (box.classList.contains('open')) {
      const list = /** @type {HTMLElement[]} */ (Array.from(box.querySelectorAll('button.step')));
      const i = list.indexOf(/** @type {HTMLElement} */ (e.target));
      if (e.key === 'Escape') stepMenu(false);
      else if (e.key === 'ArrowDown' && i >= 0) list[Math.min(list.length - 1, i + 1)].focus();
      else if (e.key === 'ArrowUp' && i >= 0) list[Math.max(0, i - 1)].focus();
      else if (e.key === 'Home' && i >= 0) list[0].focus();
      else if (e.key === 'End' && i >= 0) list[list.length - 1].focus();
      else if (e.key === 'Tab') {
        stepMenu(false, false);
        return;
      } else return;
      e.preventDefault();
      return;
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      stopPlay();
      setStep(stepFrom(e.key === 'ArrowLeft' ? -1 : 1), true);
      save();
    } else if (e.key === 'Home') choose(1);
    else if (e.key === 'End') choose(STEPS);
    else return;
    e.preventDefault();
    if (onStep) /** @type {HTMLElement | null} */ (box.querySelector('button.step[aria-current]'))?.focus();
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
    const moves = [];
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
      moves.push(a);
      let over = false;
      const end = () => {
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
      };
      a.oncancel = end;
    });
    return { cancel: () => moves.forEach((a) => a.cancel()) };
  }

  /**
   * The rows a step adds grow from their parent (each new subtree, one after the other), and a new reader's band
   * takes its tint from the band around it. While the tree plays, the first new row is scrolled into view, under the
   * line and the controls at the top, in the panel only (not the page around the web page's frame).
   */
  function growIn(/** @type {Set<string>} */ before, /** @type {boolean} */ follow) {
    const ul = $('reading-tree');
    const roots = /** @type {HTMLElement[]} */ (Array.from(ul.querySelectorAll('li[role="treeitem"]')))
      .filter((li) => !before.has(li.dataset.path ?? '') && before.has((li.dataset.path ?? '').replace(/\.\d+$/, '')));
    const first = roots[0];
    if (first && follow) {
      const r = first.getBoundingClientRect();
      const topLine = $('layers').getBoundingClientRect().bottom;
      const room = window.innerHeight - topLine;
      const over = r.top + Math.min(r.height, room * 0.6) - window.innerHeight;
      if (over > 0 || r.top < topLine) window.scrollBy({ top: r.top < topLine ? r.top - topLine - 8 : over + 16, behavior: 'smooth' });
    }
    fold(roots.map((li, k) => ({ el: li, open: true, delay: Math.min(k, 8) * 30 })));
    roots.forEach((li, k) => {
      if (!li.classList.contains('band')) return;
      const to = getComputedStyle(li).backgroundColor;
      const parent = li.parentElement?.closest('li');
      const from = parent ? getComputedStyle(parent).backgroundColor : 'transparent';
      li.animate([{ backgroundColor: from }, { backgroundColor: to }], { duration: MOTION_MS + 200, delay: Math.min(k, 8) * 30 + 80, easing: 'ease-out', fill: 'backwards' });
    });
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
    li.focus();
  }

  function toggleItem(/** @type {HTMLElement} */ li) {
    const group = li.querySelector(':scope > ul[role="group"]');
    if (!group) return;
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
        if (group && group.hidden) fold([setFolded(li, false)]);
        else if (group) next = /** @type {HTMLElement} */ (group.firstElementChild);
        break;
      case 'ArrowLeft':
        if (group && !group.hidden) fold([setFolded(li, true)]);
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
