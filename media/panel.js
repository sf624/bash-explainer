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

  /**
   * The fold and quick reference buttons as drawn (src/ui/panelView.ts `HeaderButton`): the web page draws its own
   * buttons for them the same, from the `header` message (they are in its top bar).
   */
  const header = /** @type {{ toggle?: { name: string, icon: string }, ref?: { name: string, icon: string, pressed: boolean } }} */ ({});
  let headerSent = '';
  function postHeader() {
    const said = JSON.stringify(header);
    if (!header.toggle || !header.ref || said === headerSent) return;
    headerSent = said;
    vscode.postMessage({ type: 'header', buttons: { toggle: header.toggle, ref: header.ref } });
  }

  /** The fold button says what it will do: unfold when something is folded, else fold. */
  function nameToggle(/** @type {boolean} */ folded) {
    header.toggle = { name: folded ? labels.expandAll : labels.collapseAll, icon: folded ? 'expand-all' : 'collapse-all' };
    nameButton('toggle', header.toggle.name, header.toggle.icon);
    postHeader();
  }

  /** The quick reference's button: pressed while it is open, and then it says how to go back. */
  function nameRef() {
    const open = !$('reference').hidden;
    header.ref = { name: open ? labels.back : labels.reference, icon: open ? 'arrow-left' : 'book', pressed: open };
    nameButton('ref', header.ref.name, header.ref.icon);
    $('ref').setAttribute('aria-pressed', String(open));
    postHeader();
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

  /** The view shown ('list' or 'tree') and the step of the tree shown (1–8, see `stepNames`): what the viewer chose last. */
  let view = 'list';
  let step = 8;
  applyState(vscode.getState());
  /** The reading tree of the line shown, as drawn (src/ui/readingSteps.ts `ReadingView`: each node with its step, chip, band…), if any. */
  let reading = /** @type {any} */ (null);
  /** The steps of the line shown (`StepView`: whether each adds something, its words, where the arrows go from it). */
  let lineSteps = /** @type {{ adds: boolean, said: string, full: string, back: number, forward: number }[]} */ ([]);
  /** The view control (src/ui/panelView.ts `viewControl`), from the host with each line: the header's view switch. */
  let control = /** @type {{ label: string, options: { id: string, short: string, full: string, sets: any, steps?: { short: string, name: string, layer: string }[] }[] }} */ ({ label: '', options: [] });
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
      const was = view;
      applyState(msg.state);
      // (The web page's own switch of views: the room kept below the other view goes, as with the panel's buttons.)
      if (view !== was) dropSpacer();
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
    lineSteps = [];
    dropSpacer();
    $('reading').hidden = true;
    $('empty').textContent = message;
    $('empty').hidden = false;
  }

  function render(msg) {
    const ex = msg.explanation;
    labels = msg.labels ?? labels;
    control = msg.control ?? control;
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
      // (And the line box opened whole: a new line shows three rows at most.)
      lineOpen = false;
    }
    // The same line drawn again (its problems came, the settings changed): a fold button or a link of the list that had the
    // focus gets it back in the new rows.
    const kept = where === shownLine ? focusInList() : null;
    shownLine = where;
    shownLineNo = ex.line;
    reading = msg.reading?.root ?? null;
    lineSteps = msg.reading?.steps ?? [];
    const tree = $('tree');
    tree.replaceChildren(...ex.items.map((t, i) => item(t, `${i}`)));
    if (kept) {
      const row = tree.querySelector(`li[data-path="${kept.path}"] > .row`);
      const target = row && (kept.link < 0 ? row.querySelector(':scope > button.twisty') : row.querySelectorAll('.refs a')[kept.link]);
      if (target instanceof HTMLElement) target.focus({ preventScroll: true });
    }

    renderLine(msg.lineText, ex.line, ex.items, msg.marks ?? [], msg.lineParts, msg.wrap === true);

    // Each note with the icon of its level in place of its mark, and the word that names the level in bold: the icon's
    // shape and the word say it without the colour. The class, the icon and its name come from the level table
    // (src/levels.ts, through `panelUpdate`); an icon with no name (where the word names the level, "Error:") is hidden
    // from a screen reader, which says the word.
    $('notes').replaceChildren(...(msg.notes ?? []).map((/** @type {{ className: string, icon: string, iconName: string, label: string, body: string, refs: string[], basis?: any }} */ n) => {
      const p = document.createElement('p');
      p.className = `note ${n.className}`;
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 16 16');
      svg.setAttribute('class', 'note-icon');
      if (n.iconName) {
        svg.setAttribute('role', 'img');
        svg.setAttribute('aria-label', n.iconName);
      } else svg.setAttribute('aria-hidden', 'true');
      drawIcon(svg, n.icon);
      const text = document.createElement('span');
      text.className = 'note-text';
      if (n.label) {
        const label = document.createElement('strong');
        label.className = 'note-label';
        label.textContent = n.label;
        text.append(label, ' ');
      }
      text.append(...inline(n.body), ...refLinks(n.refs), ...basisParts(n.basis));
      p.append(svg, text);
      return p;
    }));
    $('examples').replaceChildren(...(ex.examples ?? []).map((e) => example(e, false)));
    $('empty').textContent = msg.emptyMessage;
    $('empty').hidden = ex.items.length > 0;
    applyView();
    renderReading();
  }

  /**
   * What a note rests on where it is bash's behaviour rather than the manual (src/ui/render.ts `noteBasis`,
   * docs/design/basis.md): a quiet chip with the words the extension gives (its tooltip says what it means), and the
   * try-it folded under it: a command for the reader's terminal, never run here, with a copy button, and its output.
   */
  function basisParts(/** @type {{ kind: string, label: string, title: string, tryIt: { code: string, output: string } } | undefined} */ b) {
    if (!b) return [];
    const chip = document.createElement('span');
    chip.className = `basis basis-${b.kind}`;
    chip.title = b.title;
    chip.textContent = b.label;
    return [chip, tryItBox(b.tryIt)];
  }

  /**
   * Code split for wrapping: each run of non-blanks in a span that wraps only when it is wider than the box
   * (media/panel.css `.tryit-word`), the blanks between them as text. A browser breaks a line after a hyphen, and
   * `unset -` / `fv` would read as two words; here a line breaks only between words.
   */
  function shellWords(/** @type {string} */ text) {
    return text.split(/(\s+)/).filter((s) => s !== '').map((s) => {
      if (/^\s+$/.test(s)) return document.createTextNode(s);
      const w = document.createElement('span');
      w.className = 'tryit-word';
      w.textContent = s;
      return w;
    });
  }

  /** The try-its the reader opened, by their code: an update of the panel (the same line again) keeps them open. */
  const openTryIts = new Set();

  /** A try-it, folded: "Try it in your terminal", then the command with a copy button, and what it printed. */
  function tryItBox(/** @type {{ code: string, output: string }} */ t) {
    const box = document.createElement('details');
    box.className = 'tryit';
    box.open = openTryIts.has(t.code);
    box.addEventListener('toggle', () => (box.open ? openTryIts.add(t.code) : openTryIts.delete(t.code)));
    // (A click in it is not a click on the note or the row; Enter and Space on it are its own, not the tree's.)
    box.addEventListener('click', (e) => e.stopPropagation());
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
    });
    const head = document.createElement('summary');
    head.className = 'tryit-head';
    head.textContent = labels.tryIt ?? 'Try it in your terminal';
    head.title = labels.tryItHint ?? '';
    const code = document.createElement('code');
    code.className = 'tryit-code';
    code.append(...shellWords(t.code));
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'tryit-copy';
    copy.textContent = labels.copyCode ?? 'Copy';
    copy.addEventListener('click', () => {
      const done = () => {
        copy.textContent = labels.copiedCode ?? 'Copied';
        setTimeout(() => { copy.textContent = labels.copyCode ?? 'Copy'; }, 1500);
      };
      // (Where the page may not write to the clipboard, the code is selected, for the reader to copy.)
      const select = () => getSelection()?.selectAllChildren(code);
      if (navigator.clipboard) navigator.clipboard.writeText(t.code).then(done, select);
      else select();
    });
    const line = document.createElement('span');
    line.className = 'tryit-line';
    line.append(code, copy);
    const prints = document.createElement('span');
    prints.className = 'tryit-prints';
    prints.textContent = labels.prints ?? 'Output';
    const output = document.createElement('code');
    output.className = 'tryit-output';
    output.append(...shellWords(t.output));
    const body = document.createElement('div');
    body.className = 'tryit-body';
    body.append(line, prints, output);
    box.append(head, body);
    return box;
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
    // Where the text rests on bash's behaviour rather than the manual: its chip after the text, as a note's, and its
    // try-it under the row, as wide as the row (beside the label, the text's column is narrow on a phone).
    const [chip, ...tryIt] = basisParts(token.basisShown);
    if (chip) text.append(chip);
    row.append(twisty, label, ...nameBadge(token.name), text, ...refLinks(token.refs), ...tryIt);
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
    const on = !$('reading').hidden;
    document.documentElement.style.setProperty('--controls-h', `${on ? steps.offsetHeight : 0}px`);
    steps.classList.toggle('stuck', on && window.scrollY > 0 && steps.getBoundingClientRect().top <= top.offsetHeight + 1);
  }
  window.addEventListener('scroll', syncLine, { passive: true });
  window.addEventListener('resize', syncLine);

  /**
   * Draws the line at the top, each character coloured by the deepest token covering it. Its parts (src/ui/lineBox.ts)
   * are runs that stay on one row (`.run`) and the blanks between them, where a row may end when the box wraps
   * (`wrap`: the web page's `editor.wrap`, VS Code's `editor.wordWrap`); otherwise it is one row that scrolls sideways.
   */
  function renderLine(text, line, items, marks = [], parts = null, wrap = false) {
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
    const rows = document.createElement('span');
    rows.className = 'rows';
    pre.replaceChildren(rows);
    pre.classList.toggle('wrap', wrap);
    segments = [];
    /** @type {{ from: number, to: number, run: boolean }[]} */
    const cut = parts ?? [{ from: 0, to: text.length, run: false }];
    for (const part of cut) {
      const box = part.run ? Object.assign(document.createElement('span'), { className: 'run' }) : rows;
      if (box !== rows) rows.append(box);
      drawPart(box, part.from, part.to);
    }
    if (!text.length) rows.textContent = ' ';
    fitLine();
    requestAnimationFrame(syncLine);

    /** The characters [from, to) of the line in `box`, a span per token. */
    function drawPart(/** @type {HTMLElement} */ box, /** @type {number} */ from, /** @type {number} */ to) {
      let i = from;
      while (i < to) {
        let j = i;
        while (j < to && owner[j] === owner[i]) j++;
        box.append(segment(i, j));
        i = j;
      }
    }

    function segment(/** @type {number} */ i, /** @type {number} */ j) {
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
      // (Under the problems of the line, the editor's squiggle in its level's class: where two overlap, the level of the
      // lower rank wins, a warning over an information.)
      const mark = marks.filter((/** @type {any} */ m) => m.from < j && i < m.to).sort((/** @type {any} */ a, /** @type {any} */ b) => a.rank - b.rank)[0];
      if (mark && text.slice(i, j).trim()) span.classList.add('squiggle', mark.className);
      segments.push(span);
      return span;
    }
  }

  /** The line box was opened whole (a click, Enter or Space): it stays open while the same line is drawn again. */
  let lineOpen = false;
  /** The line box's width when its runs were last measured. */
  let lineWidth = -1;

  /**
   * Fits a wrapping line box to its width. A run wider than a row may break at its own blanks, and as a last resort
   * anywhere (`.wide`); the others stay whole. A box of more than three rows shows three and a fade (`.clamped`)
   * until it is opened. The widths are measured, not estimated from the font.
   */
  function fitLine() {
    const pre = $('line');
    const rows = /** @type {HTMLElement | null} */ (pre.querySelector(':scope > .rows'));
    const runs = /** @type {HTMLElement[]} */ (Array.from(pre.querySelectorAll('.run')));
    runs.forEach((r) => r.classList.remove('wide'));
    const shown = pre.classList.contains('wrap') && rows && pre.getClientRects().length > 0;
    lineWidth = shown ? pre.clientWidth : -1;
    if (!shown) {
      rows?.removeAttribute('data-marks');
      setLineFold(false);
      return;
    }
    // (A row after the first is the narrowest: it hangs in by the room of the mark ↪.)
    const room = rows.clientWidth - parseFloat(getComputedStyle(rows).paddingLeft);
    const wide = runs.filter((r) => r.getBoundingClientRect().width > room + 0.5);
    wide.forEach((r) => r.classList.add('wide'));
    const row = parseFloat(getComputedStyle(rows).lineHeight);
    const height = rows.getBoundingClientRect().height;
    // (A mark ↪ for each row after the first, drawn by the style from this attribute: see `.rows::before`.)
    rows.dataset.marks = '\n\u21AA'.repeat(Math.max(0, Math.round(height / row) - 1));
    setLineFold(height > 3 * row + 1);
  }

  /** Whether the line box has more than three rows: then it folds to three, and a click or a key opens it whole. */
  function setLineFold(/** @type {boolean} */ foldable) {
    const pre = $('line');
    pre.classList.toggle('clamped', foldable && !lineOpen);
    pre.classList.toggle('open', foldable && lineOpen);
    if (foldable) {
      pre.tabIndex = 0;
      pre.setAttribute('role', 'button');
      pre.setAttribute('aria-expanded', String(lineOpen));
      pre.title = lineOpen ? labels.lineFold ?? '' : labels.lineOpen ?? '';
    } else {
      pre.removeAttribute('tabindex');
      pre.removeAttribute('role');
      pre.removeAttribute('aria-expanded');
      pre.removeAttribute('title');
    }
  }

  /** Opens the line box whole, or folds it to three rows again. */
  function toggleLine() {
    lineOpen = !lineOpen;
    setLineFold(true);
    requestAnimationFrame(syncLine);
  }

  // A folded box opens at a click anywhere in it (a click on a part also does the part's own: it shows its row); an
  // open one folds at a click beside its parts (a blank, the margin, the marks ↪), so that the parts stay clickable.
  $('line').addEventListener('click', (e) => {
    const pre = $('line');
    if (selecting() || !pre.hasAttribute('aria-expanded')) return;
    const onPart = e.target instanceof Element && e.target.closest('.seg');
    if (pre.classList.contains('clamped') || !onPart) toggleLine();
  });
  $('line').addEventListener('keydown', (e) => {
    if (e.target !== $('line') || !$('line').hasAttribute('aria-expanded') || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    toggleLine();
  });
  // (Measured again when the box's width changes: the panel's, the window's, the fonts'.)
  new ResizeObserver(() => {
    if ($('line').clientWidth !== lineWidth) fitLine();
  }).observe($('line'));


  // ---------------------------------------------------------------- tree view (src/reading.ts)

  /** The steps of the tree view (src/ui/readingSteps.ts `stepNames`): the option of the view control that has them, Reading's. */
  const stepNames = () => control.options.find((o) => o.steps)?.steps ?? [];

  /** Tells the host the choice: it keeps it for the next time (VS Code's global state, the web page's storage) and, in the list view, builds no tree. */
  function save() {
    // (The host keeps it with `level` too, what the panel kept before the steps: src/ui/panelView.ts `panelState`.)
    const state = { view, step };
    vscode.setState(state);
    vscode.postMessage({ type: 'panelState', state });
  }

  /**
   * The view and step the viewer chose (VS Code's webview state; the host sends them as it keeps them, src/ui/panelView.ts
   * `panelState`), or what an option of the view control sets.
   */
  function applyState(/** @type {any} */ state) {
    if (!state || typeof state !== 'object') return;
    if (state.view === 'tree' || state.view === 'list') view = state.view;
    // (The eight steps of src/ui/readingSteps.ts `STEPS`.)
    if (Number.isInteger(state.step) && state.step >= 1 && state.step <= 8) step = state.step;
  }

  /** Whether an option of the view control is the one shown: the state has what it sets (the rule of src/ui/panelView.ts `isPressed`). */
  const pressed = (/** @type {{ sets: Record<string, unknown> }} */ o) => Object.entries(o.sets).every(([k, v]) => /** @type {Record<string, unknown>} */ ({ view, step })[k] === v);

  /** Draws the header's view switch from the view control: a button per option, its short name, its full name where it says more. */
  function drawViews() {
    if (!control.options.length) return;
    const box = $('views');
    box.setAttribute('aria-label', control.label);
    const buttons = control.options.map((o) => {
      const id = `view-${o.id}`;
      const b = document.getElementById(id) ?? Object.assign(document.createElement('button'), { id, type: 'button' });
      b.dataset.option = o.id;
      b.textContent = o.short;
      b.setAttribute('aria-pressed', String(pressed(o)));
      for (const attr of ['title', 'aria-label']) {
        if (o.full === o.short) b.removeAttribute(attr);
        else b.setAttribute(attr, o.full);
      }
      return b;
    });
    if (buttons.length !== box.children.length || buttons.some((b, i) => box.children[i] !== b)) box.replaceChildren(...buttons);
  }

  /** Shows the list or the tree view. */
  function applyView() {
    const tree = view === 'tree';
    drawViews();
    $('tree').hidden = tree;
    $('examples').hidden = tree;
    $('reading').hidden = !tree || !reading;
    if (labels.expandAll) updateToggle();
    markLine(null);
    requestAnimationFrame(syncLine);
  }

  $('views').addEventListener('click', (e) => {
    const b = e.target instanceof Element ? /** @type {HTMLElement | null} */ (e.target.closest('button[data-option]')) : null;
    const option = b && control.options.find((o) => o.id === b.dataset.option);
    if (!option || pressed(option)) return;
    dropSpacer();
    applyState(option.sets);
    save();
    applyView();
    renderReading();
  });

  /** Whether a node is drawn at the step shown. */
  const shown = (/** @type {any} */ c) => (c.appears ?? 1) <= step;

  function renderReading() {
    // (A step back whose rows are still shrinking: the tree is drawn at the step now.)
    flushMotion();
    const ul = $('reading-tree');
    // A new update or step redraws the tree: the focus goes back to the item it was on.
    const hadFocus = ul.contains(document.activeElement);
    const t = labels.tree;
    if (!t) return void ul.replaceChildren();
    ul.setAttribute('aria-label', t.label);
    renderControls();
    // (The rows are replaced in one step, after the controls have measured themselves: that layout, with the tree
    // emptied, let the browser scroll the shorter page back to the top when the same line was drawn again.)
    if (!reading || view !== 'tree') return void ul.replaceChildren();
    ul.replaceChildren(treeItem(reading, '0', 1, 1, 1));
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

  // ---------------------------------------------------------------- the steps of the tree

  /** The step `d` steps from the one shown, among those that add something (the one shown at either end). */
  const stepFrom = (/** @type {number} */ d) => lineSteps[step - 1]?.[d > 0 ? 'forward' : 'back'] ?? step;

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

  /**
   * Makes the controls (once): step back, a button per step, and step forward; where the buttons do not fit, a
   * stepper whose middle opens the steps as a menu (see `fitControls`). A polite live region says the step.
   */
  function buildControls(/** @type {HTMLElement} */ box) {
    // (A plain box: #layers is the group of the controls, and the stepper's menu opens this box of its buttons.)
    const steps = el('div', { id: 'steps' });
    stepNames().forEach(({ layer }, i) => {
      steps.append(el('button', { type: 'button', class: `step l-${layer}`, 'data-step': String(i + 1) },
        el('span', { class: 'num', 'aria-hidden': 'true' }, String(i + 1)), el('span', { class: 'short' })));
    });
    box.replaceChildren(el('span', { id: 'layers-label' }), el('button', { type: 'button', id: 'tp-back' }, icon('◁')),
      el('span', { class: 'step-pick' },
        el('button', { type: 'button', id: 'step-menu', 'aria-expanded': 'false', 'aria-controls': 'steps' },
          el('span', { class: 'sm-count' }), ' ', el('span', { class: 'sm-name' }), el('span', { class: 'sm-caret', 'aria-hidden': 'true' }, '▾')),
        steps),
      el('button', { type: 'button', id: 'tp-forward' }, icon('▷')),
      el('span', { id: 'tp-live', class: 'tp-live', 'aria-live': 'polite' }));
  }

  /** The words of step `s` on the line shown: its short name, and "Step 4 of 8: words" (with what it adds, when nothing). */
  function stepWords(/** @type {number} */ s) {
    return { short: stepNames()[s - 1].short, ...lineSteps[s - 1] };
  }

  /** Draws the controls as the step is now (the line's steps: there are none without a reading tree, and the controls are hidden then). */
  function renderControls() {
    const t = labels.tree;
    if (!t || !lineSteps.length) return;
    const p = t.stepper;
    const box = $('layers');
    if (!document.getElementById('steps')) buildControls(box);
    box.setAttribute('aria-label', p.group);
    $('layers-label').textContent = t.show;
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
      b.classList.toggle('empty', !w.adds);
      // (One stop for Tab: the step shown; the arrows go to the others.)
      /** @type {HTMLElement} */ (b).tabIndex = s === step ? 0 : -1;
    });
    const menu = $('step-menu');
    /** @type {HTMLElement} */ (menu.querySelector('.sm-count')).textContent = `${step}/${stepNames().length}`;
    /** @type {HTMLElement} */ (menu.querySelector('.sm-name')).textContent = here.short;
    menu.setAttribute('aria-label', `${p.jump}: ${here.said}`);
    menu.title = p.jump;
    menu.className = `l-${stepNames()[step - 1].layer}`;
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
    box.classList.remove('tight', 'tighter', 'compact', 'open');
    for (const level of ['tight', 'tighter', 'compact']) {
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
    s = Math.max(1, Math.min(stepNames().length, s));
    if (flushMotion()) renderReading();
    const was = step;
    if (s !== was && view === 'tree' && reading) hold(firstRowKept(s), stuckRange(), $('layers').getBoundingClientRect().bottom);
    step = s;
    if (s !== was && reading) announce(lineSteps[s - 1].full);
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
    else if (e.key === 'End') choose(stepNames().length);
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
    return firstOnScreen(visibleItems(), 'reading', $('layers').getBoundingClientRect().bottom, (li) => (readingNodes.get(li)?.appears ?? 1) <= s);
  }

  /** A node of the reading tree as an item of the ARIA tree, with the visible layers of its children. */
  function treeItem(n, path, depth, pos, size) {
    const li = document.createElement('li');
    li.setAttribute('role', 'treeitem');
    li.setAttribute('aria-level', String(depth));
    li.setAttribute('aria-posinset', String(pos));
    li.setAttribute('aria-setsize', String(size));
    li.tabIndex = -1;
    li.dataset.path = path;
    li.className = `ti l-${n.layer}`;
    // (A band starts where the reader changes: another layer, another command, another shell.)
    const band = n.band !== undefined;
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
    chip.textContent = n.chip;
    // The first line: the code in a pill (in the colour of its role, as in the list) and the kind; at its right,
    // where a reader takes over, the reader's name, and the links. The text has a line of its own under them.
    const head = document.createElement('span');
    head.className = 'thead';
    const code = !['line', 'language'].includes(n.kind) ? n.label : '';
    if (code) {
      const c = document.createElement('code');
      c.className = `tcode kind-${n.role}`;
      c.textContent = code;
      head.append(c);
    }
    // (The badge after the code, then the kind of node; a reserved word's kind says what it is.)
    const badge = n.kind === 'keyword' ? [] : nameBadge(n.name);
    head.append(...badge, chip);
    const about = n.text ?? n.about ?? '';
    const text = document.createElement('span');
    // (What the kind is in general, where no token says more: quieter than an explanation.)
    text.className = n.text === undefined ? 'text about' : 'text';
    text.append(...inline(about), ...(n.text === undefined ? [] : basisParts(n.basisShown)));
    const links = refLinks(n.refs);
    links.forEach((l) => l.querySelectorAll('a').forEach((a) => { a.tabIndex = -1; }));
    const right = document.createElement('span');
    right.className = 'tright';
    const bandName = n.band ?? '';
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
    li.setAttribute('aria-label', `${chip.textContent}${code ? ` ${code}` : ''}${spoken}. ${n.readBy}. ${spokenMarks(about.replace(/`/g, ''))}${also ? `. ${also.textContent}` : ''}`);
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
      group.append(...kids.map((/** @type {any} */ c, /** @type {number} */ i) => treeItem(c, `${path}.${n.children.indexOf(c)}`, depth + 1, i + 1, kids.length)));
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
