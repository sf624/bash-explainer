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
   * The tools' names and icons for each state (src/ui/panelHead.ts `panelTools`), from the host with each line; and
   * the state of the fold and quick reference buttons, told to the host (`header`): the web page's panel header
   * draws its own tools from it.
   */
  let tools = /** @type {{ toggle: Record<'fold' | 'unfold', { name: string, icon: string }>, ref: Record<'open' | 'close', { name: string, icon: string }>, copy: { name: string, icon: string } } | null} */ (null);
  const header = { folded: false, reference: false };
  let headerSent = '';
  function postHeader() {
    const said = JSON.stringify(header);
    if (!tools || said === headerSent) return;
    headerSent = said;
    vscode.postMessage({ type: 'header', ...header });
  }

  /** The fold button says what it will do: unfold when something is folded, else fold. */
  function nameToggle(/** @type {boolean} */ folded) {
    header.folded = folded;
    const b = tools?.toggle[folded ? 'unfold' : 'fold'];
    if (b) nameButton('toggle', b.name, b.icon);
    postHeader();
  }

  /** The quick reference's button: pressed while it is open, and then it says how to go back. */
  function nameRef() {
    const open = !$('reference').hidden;
    header.reference = open;
    const b = tools?.ref[open ? 'close' : 'open'];
    if (b) nameButton('ref', b.name, b.icon);
    $('ref').setAttribute('aria-pressed', String(open));
    postHeader();
  }

  /** @type {Array<{ token: any, el: HTMLElement, end: number }>} */
  let flat = [];
  /** What each level looks like on a row (`levels`, src/ui/panelView.ts). */
  let levels = /** @type {Record<string, { className: string, icon: string, name: string }>} */ ({});
  let examplesFirst = true;
  /** @type {HTMLElement[]} */
  let segments = [];
  /** The last rendered update; an identical one is ignored so a text selection survives. */
  let lastUpdate = '';
  /** The pointers last drawn (`drawAround`), as JSON. */
  let lastAround = '[]';
  /** What the viewer folded and unfolded of the line shown, by row (`key`: the same at both depths); kept when the same line is drawn again. */
  let foldChoices = /** @type {Map<string, boolean>} */ (new Map());
  /** The file and line `foldChoices` belongs to, and the depth drawn. */
  let shownLine = '';
  let shownDepth = 1;
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

  /** The depth shown (1 what it does, 2 how bash reads it): what the viewer chose last. */
  let depth = 1;
  applyState(vscode.getState());
  /** The view control (src/ui/panelView.ts `viewControl`), from the host with each line: the header's depth. */
  let control = /** @type {{ label: string, options: { id: string, digit?: string, short: string, full: string, pressed: boolean, sets: any }[] }} */ ({ label: '', options: [] });
  /** The forms the view control may take, widest first (src/ui/panelHead.ts `viewControlForms`): the first that fits is drawn. */
  let viewForms = /** @type {{ kind: 'segments' | 'menu', label?: string, button?: { text: string, name: string }[] }[]} */ ([{ kind: 'segments' }]);
  /** The line shown (its number in the document). */
  let shownLineNo = 0;
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

  // Messages come only from the panel's own origin (VS Code's webview host and the web page have it). The sender window is
  // not asked for: the webview host changes what the panel sees of `window.parent` and `window.frameElement`, and
  // differently between VS Code versions (deleted up to 1.102; from 1.103 `parent` is the window itself).
  window.addEventListener('message', (event) => {
    if (event.origin !== location.origin) return;
    const msg = event.data;
    if (msg.type === 'themeWatch') {
      themeWatching = msg.on;
      themeSent = '';
      if (!msg.on) setThemeVars({});
      postThemeBase();
    }
    if (msg.type === 'themeColours') setThemeVars(msg.vars);
    if (msg.type === 'update') {
      // (Without the line's problems: they come a moment after the line is explained, and change only its squiggles.)
      const key = JSON.stringify({ ...msg, marks: undefined, around: undefined });
      if (key === lastUpdate) {
        // (The pointers are drawn again only when they changed: a focus on one stays, panel-redesign.md section 5.)
        if (JSON.stringify(msg.around ?? []) !== lastAround) drawAround(msg.around ?? []);
        return squiggleLine(msg.marks ?? []);
      }
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
    // The web page's panel header: its tools say the state they want (something folded, the quick reference open).
    if (msg.type === 'tools') {
      if (msg.reference !== undefined && msg.reference === $('reference').hidden) toggleReference(msg.focus === true);
      if (msg.folded !== undefined && msg.folded !== header.folded) toggleAll();
    }
    if (msg.type === 'panelState') {
      applyState(msg.state);
      drawViews();
    }
  });
  vscode.postMessage({ type: 'ready' });

  function showEmpty(/** @type {string} */ message) {
    $('where').textContent = '';
    $('context').textContent = '';
    $('line').replaceChildren();
    $('notes').replaceChildren();
    $('problems').replaceChildren();
    $('problems').hidden = true;
    lastAround = '[]';
    $('short').replaceChildren();
    $('short').hidden = true;
    $('tree').replaceChildren();
    $('examples').replaceChildren();
    $('whole-line').replaceChildren();
    dropSpacer();
    $('empty').textContent = message;
    $('empty').hidden = false;
  }

  function render(msg) {
    const ex = msg.explanation;
    labels = msg.labels ?? labels;
    levels = msg.levels ?? levels;
    control = msg.control ?? control;
    viewForms = msg.viewForms ?? viewForms;
    tools = msg.tools ?? tools;
    controlMarks = msg.controlMarks ?? controlMarks;
    if (msg.lang) document.documentElement.lang = msg.lang;
    manual = msg.manual ?? {};
    linkNote = msg.linkNote ?? '';
    nameButton('settings', msg.settingsLabel);
    if (tools) nameButton('copy', tools.copy.name);
    // The quick reference stays open while the cursor moves; keep its button saying how to go back.
    nameRef();
    // (The fold button is named once the rows are drawn, below. Naming it "Collapse all" first would tell
    // the host for a moment that nothing is folded while a fold kept for this line is drawn again.)
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
      foldChoices = new Map();
      openExamples = new Set();
      openSteps = new Set();
      openRoles = new Map();
      // (And the line box opened whole: a new line shows three rows at most.)
      lineOpen = false;
    }
    // The same line drawn again (the settings changed; for its problems alone, see `squiggleLine`): a fold button or a link
    // of the list that had the focus gets it back in the new rows.
    const kept = where === shownLine ? focusInList() : null;
    const keptRole = where === shownLine && document.activeElement instanceof HTMLElement && $('line-role').contains(document.activeElement) ? document.activeElement.dataset.role : undefined;
    const keptFold = where === shownLine ? [...document.querySelectorAll('details.whole-line > summary')].indexOf(/** @type {Element} */ (document.activeElement)) : -1;
    // Another depth of the same line: the first row on the screen that it still shows stays where it is.
    if (where === shownLine && msg.depth !== shownDepth) {
      holdForDepth(msg.rows);
      // (A screen reader hears the depth, whichever control chose it: the panel's, the keys, the page's slot.)
      $('said').textContent = msg.control.options.find((/** @type {{ sets: any }} */ o) => o.sets.depth === msg.depth).said;
    }
    shownLine = where;
    shownDepth = msg.depth;
    document.body.dataset.depth = String(msg.depth);
    shownLineNo = ex.line;
    const tree = $('tree');
    drawnRoles = new Set();
    $('line-role').replaceChildren(...(msg.lineRole ? [roleLineOf(msg.lineRole, LINE_ROLE)] : []));
    tree.replaceChildren(...msg.rows.map((/** @type {any} */ r, /** @type {number} */ i) => item(r, `${i}`)));
    // (A name that the new rows do not have is no longer open. The rows of depth 1 have no names: they come back with depth 2.)
    if (msg.depth === 2) openRoles = new Map([...openRoles].filter(([key]) => drawnRoles.has(key)));
    if (keptRole) /** @type {HTMLElement | null} */ ($('line-role').querySelector(`[data-role="${keptRole}"]`))?.focus({ preventScroll: true });
    if (kept) focusAgain(kept);

    renderLine(msg.lineText, msg.lineRuns, msg.marks ?? [], msg.lineParts, msg.wrap === true);

    drawProblems(msg.problems ?? [], msg.around ?? []);
    // Each note with the icon of its level in place of its mark, and the word that names the level in bold: the icon's
    // shape and the word say it without the colour. The class, the icon and its name come from the level table
    // (src/levels.ts, through `panelUpdate`).
    $('notes').replaceChildren(...(msg.notes ?? []).map((/** @type {{ className: string, icon: string, iconName: string, label: string, body: string, refs: string[], basis?: any }} */ n) => {
      const p = document.createElement('p');
      p.className = `note ${n.className}`;
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 16 16');
      svg.setAttribute('class', 'note-icon');
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', n.iconName);
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
    // The sentence of the line, "In short" (src/linesentence.ts), at the top of the view: marked text, its
    // label in bold before it.
    const short = $('short');
    short.hidden = !ex.sentence;
    if (ex.sentence) {
      const label = document.createElement('strong');
      label.className = 'short-label';
      label.textContent = labels.inShort;
      short.replaceChildren(label, ' ', ...inline(ex.sentence));
    } else short.replaceChildren();
    // The example of the whole line, folded: above the rows where examples come first, else with those at the end.
    const whole = msg.wholeLine.map(foldedExample);
    $('whole-line').replaceChildren(...(examplesFirst ? whole : []));
    $('examples').replaceChildren(...(examplesFirst ? [] : whole), ...(ex.examples ?? []).map((e) => example(e, false)));
    whole[keptFold]?.querySelector('summary')?.focus({ preventScroll: true });
    $('empty').textContent = msg.emptyMessage;
    $('empty').hidden = msg.rows.length > 0;
    drawViews();
    if (tools) updateToggle();
    requestAnimationFrame(syncLine);
  }

  /** The icon of a level, in front of a word that names it (hidden from a screen reader, which says the word). */
  function levelIcon(/** @type {string} */ icon) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('class', 'note-icon');
    svg.setAttribute('aria-hidden', 'true');
    drawIcon(svg, icon);
    return svg;
  }

  /** The problems whose "more" the reader opened, by their text: an update of the panel (the same line again) keeps them open. */
  const openProblems = new Set();

  /** Brings a row or a problem into view, and shows for a moment where it is. */
  function flash(/** @type {HTMLElement} */ target) {
    // (The header stays over the top of the page: what comes into view stays below it.)
    target.style.scrollMarginTop = `${$('top').offsetHeight + 4}px`;
    target.scrollIntoView({ block: 'nearest' });
    target.classList.remove('flash');
    void target.offsetWidth;
    target.classList.add('flash');
  }

  /** Goes to the row at `path`: its folded parents open, and its chip (in the row) gets the focus. */
  function toRow(/** @type {string} */ path, /** @type {number} */ index) {
    const row = document.querySelector(`#tree li[data-path="${path}"] > .item > .row`);
    if (!(row instanceof HTMLElement)) return;
    for (let li = row.closest('li'); li; li = li.parentElement?.closest('li') ?? null) if (li.querySelector(':scope > .item > .row') !== row) setCollapsed(li, false);
    flash(row);
    const chip = row.querySelector(`.problem-chip[data-problem="${index}"]`);
    if (chip instanceof HTMLElement) chip.focus({ preventScroll: true });
  }

  /** Goes from a row's chip to its problem: its "more" opens, and its headline gets the focus. */
  function toProblem(/** @type {number} */ index) {
    const li = document.getElementById(`problem-${index}`);
    if (!li) return;
    const more = li.querySelector('details.problem-more');
    if (more instanceof HTMLDetailsElement) more.open = true;
    flash(li);
    const head = li.querySelector('.problem-head');
    if (head instanceof HTMLElement) head.focus({ preventScroll: true });
  }

  /** A fix of a problem: its code, and a button that copies it; where the page may not write to the clipboard, the code is selected. */
  function fixLine(/** @type {string} */ fix) {
    const code = el('code', { class: 'problem-fix-code' }, ...shellWords(fix));
    const copy = el('button', { type: 'button', class: 'tryit-copy' }, labels.copyCode);
    copy.addEventListener('click', () => {
      const done = () => {
        copy.textContent = labels.copiedCode;
        setTimeout(() => { copy.textContent = labels.copyCode; }, 1500);
      };
      const select = () => getSelection()?.selectAllChildren(code);
      if (navigator.clipboard) navigator.clipboard.writeText(fix).then(done, select);
      else select();
    });
    return el('span', { class: 'problem-fix' }, el('span', { class: 'problem-fix-label' }, labels.problems.fix), code, copy);
  }

  /** One problem of the box: its level's icon and word and its headline (a button to its row, where it has one), then "more". */
  function problemItem(/** @type {any} */ p, /** @type {number} */ index) {
    const head = el(p.rows.length ? 'button' : 'span', { class: 'problem-head' }, levelIcon(p.icon), el('strong', { class: 'note-label' }, p.word), ' ', el('span', { class: 'problem-head-text' }, ...inline(p.head)));
    if (p.rows.length) {
      head.setAttribute('type', 'button');
      head.setAttribute('title', labels.problems.toRow);
      head.addEventListener('click', () => toRow(p.rows[0], index));
    }
    const more = /** @type {HTMLDetailsElement} */ (el('details', { class: 'problem-more' }, el('summary', {}, labels.problems.more)));
    more.open = openProblems.has(p.text);
    more.addEventListener('toggle', () => (more.open ? openProblems.add(p.text) : openProblems.delete(p.text)));
    const whole = el('p', { class: 'problem-text' });
    if (p.label) whole.append(el('strong', { class: 'note-label' }, p.label), ' ');
    whole.append(...inline(p.body), ...refLinks(p.refs), ...basisParts(p.basis));
    const moreBody = el('div', { class: 'fold-body' }, whole, ...p.fixes.map(fixLine));
    more.append(moreBody);
    foldingDetails(more, moreBody);
    return el('li', { class: `note problem ${p.className}`, id: `problem-${index}` }, head, more);
  }

  /** A chip on each row a problem is about: its level's icon, a button back to the problem. */
  function problemChips(/** @type {any[]} */ problems) {
    problems.forEach((p, index) => {
      for (const path of p.rows) {
        const row = document.querySelector(`#tree li[data-path="${path}"] > .item > .row`);
        if (!row) continue;
        const chip = el('button', { type: 'button', class: `problem-chip ${p.className}`, 'data-problem': String(index), title: labels.problems.toProblem, 'aria-label': `${labels.problems.toProblem}: ${p.word}` }, levelIcon(p.icon));
        chip.addEventListener('click', (e) => {
          e.stopPropagation();
          toProblem(index);
        });
        const text = row.querySelector(':scope > .text');
        // (At depth 2, before the role line: a chip ends the row's text.)
        if (text) text.insertBefore(chip, text.querySelector(':scope > .role-line, :scope > .steps'));
      }
    });
  }

  /** The pointers of the box: a problem on the line of a construct around this one, a click on which goes there. */
  function drawAround(/** @type {any[]} */ around) {
    const box = $('problems');
    lastAround = JSON.stringify(around);
    box.querySelector('.problem-around')?.remove();
    if (around.length) {
      box.append(el('ul', { class: 'problem-around' }, ...around.map((/** @type {any} */ a) => {
        const go = el('button', { type: 'button', class: `problem-pointer ${a.className}`, title: a.title },
          el('span', { 'aria-hidden': 'true' }, '↑'), levelIcon(a.icon), el('strong', { class: 'note-label' }, a.where), ' ', el('span', { class: 'problem-head-text' }, ...inline(a.head)));
        go.addEventListener('click', () => vscode.postMessage({ type: 'reveal', span: { start: { line: a.line, character: a.column }, end: { line: a.line, character: a.endColumn } }, preserveFocus: false }));
        return el('li', {}, go);
      })));
    }
    box.hidden = !box.hasChildNodes();
  }

  /** The box "Problems on this line" (src/ui/panelProblems.ts): the line's problems, then the pointers to those around it. */
  function drawProblems(/** @type {any[]} */ problems, /** @type {any[]} */ around) {
    const box = $('problems');
    box.setAttribute('aria-label', labels.problems.title);
    box.replaceChildren(...(problems.length ? [el('strong', { class: 'problems-title' }, labels.problems.title), el('ul', { class: 'problem-list' }, ...problems.map(problemItem))] : []));
    drawAround(around);
    problemChips(problems);
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

  /** The address as a URL when it is https, else undefined. */
  function httpsUrl(/** @type {string} */ address) {
    try {
      const u = new URL(address);
      return u.protocol === 'https:' ? u.href : undefined;
    } catch {
      return undefined;
    }
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
      const url = httpsUrl(m.url);
      // (An address that is not https is shown as text, with no link.)
      const a = document.createElement(url ? 'a' : 'span');
      a.textContent = m.text;
      a.title = `${m.label}: ${m.title}`;
      if (url) {
        a.href = url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        // (A screen reader hears where it is, what it is about, and that it opens outside the panel.)
        // (Japanese runs its full-width parenthesis on: "§3.7.2 …（新しいタブで開く）".)
        a.setAttribute('aria-label', `${m.text} ${m.title}${linkNote.startsWith('(') ? ' ' : ''}${linkNote}`);
      }
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
    box.append(h, ...exampleBody(ex));
    return box;
  }

  /** What an example shows under its title: its note, then its sections, or the inputs to edit and the results. */
  function exampleBody(/** @type {any} */ ex) {
    const out = [];
    if (ex.note) {
      const note = document.createElement('p');
      note.className = 'example-note';
      note.append(...inline(ex.note));
      out.push(note);
    }
    out.push(...(ex.interactive ? editable(ex.interactive) : sections(ex.sections)));
    return out;
  }

  /** The folded examples the reader opened, by their place (two can have one title): the same line drawn again keeps them open, as `foldChoices` does. */
  let openExamples = new Set();

  /** A folded example (of the whole line, or a row's: `ModelRow.examples`), at its place `at`: under its title. */
  function foldedExample(/** @type {any} */ ex, /** @type {number | string} */ at) {
    const box = /** @type {HTMLDetailsElement} */ (el('details', { class: 'example whole-line' }, el('summary', {}, el('h3', {}, ...inline(ex.title)))));
    box.open = openExamples.has(at);
    box.addEventListener('toggle', () => (box.open ? openExamples.add(at) : openExamples.delete(at)));
    const body = el('div', { class: 'fold-body' }, ...exampleBody(ex));
    box.append(body);
    return foldingDetails(box, body);
  }

  /** The name opened on each role line, by its row's `key` (for the same line drawn again, as `foldChoices`). */
  let openRoles = /** @type {Map<string, string>} */ (new Map());
  /** The rows drawn just now whose open name is on them. */
  let drawnRoles = /** @type {Set<string>} */ (new Set());
  /** The `key` of the line's own role line, which no row has. */
  const LINE_ROLE = '';

  /**
   * A role line: the names of a row's roles, an arrow where another reader takes it, and who reads it last. A name is a button: a tap, a click or
   * Enter opens under the line what the kind is and who reads it, with the line's sections, and leaves the row as it is. One name is open on a line,
   * and the line is one stop of the Tab order: the arrows go from name to name, and the links are there only while it is open.
   */
  function roleLineOf(/** @type {any} */ line, /** @type {string} */ key) {
    const box = el('span', { class: 'role-line' });
    const said = el('span', { class: 'role-said', id: `role-said-${nextId++}` });
    const chips = line.chips.map((/** @type {{ id: string, text: string, said: string, changes: boolean }} */ c, /** @type {number} */ i) => {
      const chip = el('button', { type: 'button', class: 'role-chip', 'aria-controls': said.id, 'data-role': c.id, tabindex: i ? '-1' : '0' }, c.text);
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        hold(() => box);
        if (openRoles.get(key) === c.id) openRoles.delete(key);
        else openRoles.set(key, c.id);
        show();
      });
      if (i) box.append(c.changes ? ' → ' : ' · ');
      box.append(chip);
      return chip;
    });
    const show = () => {
      const open = line.chips.find((/** @type {{ id: string }} */ c) => c.id === openRoles.get(key));
      chips.forEach((/** @type {HTMLElement} */ chip) => chip.setAttribute('aria-expanded', String(chip.dataset.role === open?.id)));
      said.hidden = !open;
      said.replaceChildren(...(open ? [...inline(open.said), ...refLinks(line.refs)] : []));
      if (open) drawnRoles.add(key);
    };
    box.addEventListener('keydown', (e) => {
      const by = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      const at = chips.indexOf(e.target);
      if (!by || at < 0) return;
      e.preventDefault();
      const next = chips[(at + by + chips.length) % chips.length];
      chips.forEach((/** @type {HTMLElement} */ chip) => { chip.tabIndex = chip === next ? 0 : -1; });
      next.focus();
    });
    show();
    if (line.reader) box.append(' · ', line.reader);
    box.append(said);
    return box;
  }

  /** The steps of a word, in order: each says itself whether it acts (a line read aloud has no drawing), and one that does nothing says why. */
  function stepList(/** @type {{ text: string, off: boolean, why?: string }[]} */ steps) {
    return steps.flatMap((s, i) => [...(i ? [' → '] : []), el('span', { class: s.off ? 'step-off' : 'step-on' }, s.text), ...(s.why ? inline(s.why) : [])]);
  }

  /** The steps kept open by the reader, by row (for the same line drawn again). */
  let openSteps = new Set();

  /** What bash does to a word: its line, or, where no step acts, folded to one line (`StepsLine`, src/ui/panelSteps.ts). */
  function stepsOf(/** @type {any} */ line, /** @type {string} */ key) {
    if (line.acts) return el('span', { class: 'steps' }, el('span', { class: 'steps-lead' }, line.lead), ' ', ...stepList(line.steps));
    const body = el('div', { class: 'fold-body' }, ...stepList(line.steps));
    const box = /** @type {HTMLDetailsElement} */ (el('details', { class: 'steps' }, el('summary', {}, el('span', { class: 'steps-lead' }, line.lead), ' ', line.summary), body));
    box.open = openSteps.has(key);
    box.addEventListener('toggle', () => (box.open ? openSteps.add(key) : openSteps.delete(key)));
    return foldingDetails(box, body);
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
        said.append(...inline(marks.said), labels.saidSep ?? ': ');
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

  /** A text cut at its warnings (`TextPart`, src/tokenmarks.ts): each warning with its level's icon, named, and in its level's look. */
  function textParts(/** @type {{ text: string, level?: string }[]} */ parts) {
    return parts.flatMap((p) => {
      if (!p.level) return inline(p.text);
      const { className, icon, name } = levels[p.level];
      const svg = levelIcon(icon);
      svg.removeAttribute('aria-hidden');
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', name);
      return [el('span', { class: `row-mark ${className}` }, svg, ' ', ...inline(p.text))];
    });
  }

  /**
   * A row of the row model (src/ui/panelRows.ts: this draws what it holds, and decides none of it) and its parts. The row is a
   * grid of two columns, the code and what it means (media/panel.css): `--lvl` and `--bx` say how far it is indented, so that
   * its code column ends where the others do. A frame (`row.frame`) is a box around a command or a bracket around a pipeline or
   * a list; one that holds parts is a group named by the row's code, so that a screen reader says where they belong, with no
   * word for the box itself.
   */
  function item(/** @type {any} */ part, /** @type {string} */ path, lvl = 0, boxes = 0) {
    const li = document.createElement('li');
    li.dataset.path = path;
    const inner = boxes + (part.frame ? 1 : 0);
    li.style.setProperty('--lvl', String(lvl));
    li.style.setProperty('--bx', String(inner));
    li.dataset.key = part.key;
    const box = document.createElement('div');
    box.className = part.frame ? `item frame frame-${part.frame}` : 'item';
    const row = document.createElement('div');
    row.className = `row kind-${part.kind}${part.connector ? ' connector' : ''}`;
    // A row with parts folds with its twisty: a button for the keyboard and a screen reader (named by the row's label,
    // its state in `aria-expanded`); the glyph is only drawn. A row with no parts keeps the room of one.
    const twisty = document.createElement(part.children.length ? 'button' : 'span');
    twisty.className = 'twisty';
    if (part.children.length) {
      const b = /** @type {HTMLButtonElement} */ (twisty);
      b.type = 'button';
      b.setAttribute('aria-label', String(labels.partsOf ?? '{name}').replace('{name}', part.label));
      b.setAttribute('aria-expanded', 'true');
      b.append(el('span', { 'aria-hidden': 'true' }, '▾'));
      twisty.addEventListener('click', (e) => {
        e.stopPropagation();
        toggle(li);
      });
    }
    const label = document.createElement('code');
    label.className = part.group ? `label grp-label grp-${((part.group - 1) % 6) + 1}` : 'label';
    // A skeleton: code parts as they are (the label is monospace), placeholders apart in italics.
    part.labelParts.forEach((p, i) => {
      if (i && !p.tight) label.append(' ');
      if (p.placeholder) {
        const ph = document.createElement('span');
        ph.className = 'ph';
        ph.textContent = p.text;
        label.append(ph);
      } else label.append(p.text);
    });
    if (part.frame && part.children.length) {
      label.id = `row-code-${path}`;
      box.setAttribute('role', 'group');
      box.setAttribute('aria-labelledby', label.id);
    }
    const code = document.createElement('div');
    code.className = 'code';
    code.append(label, ...nameBadge(part.name));
    const text = document.createElement('span');
    text.className = 'text';
    text.append(...textParts(part.parts));
    for (const more of part.more) text.append(el('span', { class: 'row-more' }, ...textParts(more)));
    const also = nameAlso(part.name);
    if (also) text.append(also);
    const value = valueLine(part.value);
    if (value) text.append(value);
    // Where the text rests on bash's behaviour rather than the manual: its chip after the text, as a note's, and its
    // try-it under the row, as wide as the row (beside the label, the text's column is narrow on a phone).
    const [chip, ...tryIt] = basisParts(part.basis);
    if (chip) text.append(chip);
    text.append(...refLinks(part.refs));
    // At depth 2: what the part is to each reader, and what bash does to a word.
    if (part.roleLine) text.append(roleLineOf(part.roleLine, part.key));
    if (part.steps) text.append(stepsOf(part.steps, part.key));
    row.append(twisty, code, text, ...tryIt);
    box.append(row);
    li.append(box);
    if (part.children.length && (foldChoices.get(part.key) ?? part.folded === true)) setCollapsed(li, true);
    // Examples placed under this token go before (first) or after (last) its parts.
    const examples = (part.examples ?? []).map((/** @type {any} */ e, /** @type {number} */ i) => (e.folded ? foldedExample(e, `${part.key}/${i}`) : example(e, true)));
    // What lies under the row (its examples and parts), in one box: the indent guide is drawn beside it.
    const body = document.createElement('div');
    body.className = 'body';
    if (examplesFirst) body.append(...examples);
    const index = flat.length;
    const shown = { token: part, el: row, end: 0 };
    flat.push(shown);
    row.addEventListener('mouseenter', () => focus(index));
    row.addEventListener('mouseleave', () => focus(focusByKeys ? focusedRow() : -1));
    // As in VS Code's trees: a click on a row with parts folds or unfolds it, and still selects it.
    row.addEventListener('click', (e) => {
      if (selecting()) return;
      if (!(e.target instanceof Element && e.target.closest('a, button, input, textarea, select, .role-said'))) {
        if (part.children.length) toggle(li);
      }
      reveal(part);
      revealInLine(index);
    });
    if (part.children.length) {
      const ul = document.createElement('ul');
      ul.append(...part.children.map((/** @type {any} */ c, /** @type {number} */ i) => item(c, `${path}.${i}`, lvl + 1, inner)));
      body.append(ul);
    }
    if (!examplesFirst) body.append(...examples);
    if (body.childElementCount) box.append(body);
    // (The rows of a part follow it in `flat`: this one and its parts are the rows from its index up to `end`.)
    shown.end = flat.length;
    return li;
  }

  /** What of the list's rows has the focus: its row and the rows around it (`keys`, nearest first), and a row's fold button (`link` -1), its link number `link` or a role's name (`role`); null: nothing there. */
  function focusInList() {
    const a = document.activeElement;
    const li = a instanceof HTMLElement && $('tree').contains(a) ? /** @type {HTMLElement | null} */ (a.closest('li[data-path]')) : null;
    if (!li || !a) return null;
    const keys = [];
    for (let up = /** @type {HTMLElement | null | undefined} */ (li); up; up = up.parentElement?.closest('li[data-path]')) keys.push(String(up.dataset.key));
    const row = /** @type {Element} */ (li.querySelector(':scope > .item > .row'));
    const links = Array.from(row.querySelectorAll('.refs a'));
    return { keys, link: a.matches('button.twisty') ? -1 : links.indexOf(a), role: /** @type {HTMLElement} */ (a).dataset.role };
  }

  /**
   * The focus again, in the rows just drawn: on what had it, or, when that row is gone (its depth was left) or does not have it now, on the row that
   * owns it: its fold button, or the row itself, so that the next Tab goes on from there and not from the top of the page.
   */
  function focusAgain(/** @type {{ keys: string[], link: number, role?: string }} */ kept) {
    const row = kept.keys.map((key) => document.querySelector(`#tree li[data-key="${key}"] > .item > .row`)).find(Boolean);
    if (!(row instanceof HTMLElement)) return;
    const same = row === document.querySelector(`#tree li[data-key="${kept.keys[0]}"] > .item > .row`);
    const target = same && (kept.role ? row.querySelector(`.role-chip[data-role="${kept.role}"]`) : kept.link >= 0 ? row.querySelectorAll('.refs a')[kept.link] : null);
    if (target instanceof HTMLElement) {
      // (Where the Tab order has it: a name kept has the line's stop.)
      if (kept.role) row.querySelectorAll('.role-chip').forEach((c) => { /** @type {HTMLElement} */ (c).tabIndex = c === target ? 0 : -1; });
      target.focus({ preventScroll: true });
      return;
    }
    const fold = row.querySelector(':scope > button.twisty');
    if (fold instanceof HTMLElement) fold.focus({ preventScroll: true });
    else {
      row.tabIndex = -1;
      row.focus({ preventScroll: true });
    }
  }

  /** The number of the row that has the focus; -1: none has. */
  function focusedRow() {
    const a = document.activeElement;
    const li = a instanceof HTMLElement && $('tree').contains(a) ? a.closest('li[data-path]') : null;
    const row = li?.querySelector(':scope > .item > .row');
    return row ? flat.findIndex((f) => f.el === row) : -1;
  }

  /** When the pointer last went down: a focus soon after it is the pointer's, which marks its row by being on it. */
  let pointerAt = 0;
  document.addEventListener('pointerdown', () => { pointerAt = Date.now(); }, true);
  /** Whether the focus in the rows came from the keyboard. */
  let focusByKeys = false;
  // The focus of the keyboard marks its row and that row's characters in the line, as a pointer on it does.
  $('tree').addEventListener('focusin', () => {
    focusByKeys = Date.now() - pointerAt > 500;
    if (focusByKeys) focus(focusedRow());
  });
  $('tree').addEventListener('focusout', (e) => {
    if (e.relatedTarget instanceof Node && $('tree').contains(e.relatedTarget)) return;
    if (focusByKeys) focus(-1);
    focusByKeys = false;
  });

  /** Folds or unfolds an item of the list; the change returned says how what lies under it moves (see `fold`). */
  function setCollapsed(/** @type {HTMLElement} */ li, /** @type {boolean} */ want) {
    li.classList.toggle('collapsed', want);
    foldChoices.set(String(li.dataset.key), want);
    const tw = li.querySelector(':scope > .item > .row > button.twisty');
    if (tw) {
      tw.setAttribute('aria-expanded', String(!want));
      /** @type {Element} */ (tw.firstElementChild).textContent = want ? '▸' : '▾';
    }
    // (Everything that lies under the row moves together, its parts and its examples; a folded example stays as its title. panel.css, `li.collapsed`, hides the same.)
    return /** @type {HTMLElement[]} */ (Array.from(li.querySelectorAll(':scope > .item > .body > :not(details.example)'))).map((el) => ({ el, open: !want }));
  }

  const isCollapsed = (/** @type {HTMLElement} */ li) => li.classList.contains('collapsed');

  function toggle(/** @type {HTMLElement} */ li) {
    hold(rowAt(String(li.dataset.key)));
    fold(setCollapsed(li, !isCollapsed(li)));
    // (The fold button then says what it will do: unfold when something is folded.)
    updateToggle();
  }

  $('toggle').addEventListener('click', () => toggleAll());
  /** Folds everything below the top level, or unfolds it all (the fold button). */
  function toggleAll() {
    const items = Array.from($('tree').querySelectorAll('li')).filter((li) => li.querySelector(':scope > .item > .body > ul'));
    const collapse = !items.some(isCollapsed);
    // Collapse below the top level, so the outline stays visible.
    const want = (/** @type {HTMLElement} */ li) => collapse && li.parentElement !== $('tree');
    // (The first row on the screen that stays drawn stays where it is: a top-level row or one of its parts.)
    const top = (/** @type {Element | null | undefined} */ li) => li?.parentElement === $('tree');
    const shownItems = /** @type {HTMLElement[]} */ (Array.from($('tree').querySelectorAll('li[data-path]'))).filter((li) => li.getClientRects().length);
    const below = $('top').getBoundingClientRect().bottom;
    hold(firstOnScreen(shownItems, below, (li) => !collapse || top(li) || top(li.parentElement?.closest('li'))), null, below);
    fold(items.filter((li) => want(li) !== isCollapsed(li)).flatMap((li) => setCollapsed(li, want(li))));
    nameToggle(collapse);
  }
  /** The shared button says what it will do: unfold when something is folded, else fold. */
  function updateToggle() {
    nameToggle($('tree').querySelector('li.collapsed') !== null);
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

  /**
   * Draws the line at the top, each character coloured by the deepest token covering it. Its parts (src/ui/lineBox.ts)
   * are runs that stay on one row (`.run`) and the blanks between them, where a row may end when the box wraps
   * (`wrap`: the web page's `editor.wrap`, VS Code's `editor.wordWrap`); otherwise it is one row that scrolls sideways.
   */
  function renderLine(text, runs, marks = [], parts = null, wrap = false) {
    // (The rows by their paths: a run names the row a pointer on it goes to.)
    const indexOf = new Map(flat.map((f, i) => [f.el.closest('li')?.dataset.path, i]));
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
      for (const run of runs) {
        const i = Math.max(from, run.from), j = Math.min(to, run.to);
        if (i < j) box.append(segment(i, j, run));
      }
    }

    function segment(/** @type {number} */ i, /** @type {number} */ j, /** @type {{ kind?: string, row?: string }} */ run) {
      const span = document.createElement('span');
      span.textContent = text.slice(i, j);
      span.dataset.from = String(i);
      span.dataset.to = String(j);
      if (run.kind && text.slice(i, j).trim()) {
        // (Its colour is its token's; a token with no row at this depth goes to the row around it.)
        const idx = /** @type {number} */ (indexOf.get(run.row));
        span.className = `seg kind-${run.kind}`;
        span.dataset.idx = String(idx);
        span.addEventListener('mouseenter', () => focus(idx));
        span.addEventListener('mouseleave', () => focus(-1));
        span.addEventListener('click', () => {
          if (selecting()) return;
          flat[idx].el.scrollIntoView({ block: 'nearest' });
          reveal(flat[idx].token);
        });
      }
      squiggle(span, marks);
      segments.push(span);
      return span;
    }
  }

  /**
   * Under the problems of the line, the editor's squiggle in its level's class: where two overlap, the level of the
   * lower rank wins, a warning over an information.
   */
  function squiggle(/** @type {HTMLElement} */ span, /** @type {any[]} */ marks) {
    const from = Number(span.dataset.from), to = Number(span.dataset.to);
    const mark = marks.filter((m) => m.from < to && from < m.to).sort((a, b) => a.rank - b.rank)[0];
    if (span.dataset.squiggle) span.classList.remove('squiggle', span.dataset.squiggle);
    delete span.dataset.squiggle;
    if (!mark || !String(span.textContent).trim()) return;
    span.classList.add('squiggle', mark.className);
    span.dataset.squiggle = mark.className;
  }

  /**
   * The problems of the line changed, and nothing else. Only the squiggles change: drawing the rows anew would take a key
   * held on a fold button (Space acts when it is released, on the button it went down on), what is typed in an example's
   * box and the place of a screen reader, for a row that says the same.
   */
  function squiggleLine(/** @type {any[]} */ marks) {
    for (const span of segments) squiggle(span, marks);
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


  // ---------------------------------------------------------------- the depth

  /** Tells the host the choice: it keeps it for the next time (VS Code's global state, the web page's storage) and explains the line for it. */
  function save() {
    const state = { depth };
    vscode.setState(state);
    vscode.postMessage({ type: 'panelState', state });
  }

  /** The depth the viewer chose (VS Code's webview state; the host sends it as it keeps it, src/ui/panelView.ts `panelState`), or what an option of the view control sets. */
  function applyState(/** @type {any} */ state) {
    if (state?.depth === 1 || state?.depth === 2) depth = state.depth;
  }

  /** Whether an option of the view control is the one shown: the state has what it sets (the rule of src/ui/panelView.ts `isPressed`). */
  const pressed = (/** @type {{ sets: Record<string, unknown> }} */ o) => Object.entries(o.sets).every(([k, v]) => /** @type {Record<string, unknown>} */ ({ depth })[k] === v);

  /** A depth chosen: the control shows it at once, and the rows come with the host's next update. */
  function press(/** @type {any} */ sets) {
    applyState(sets);
    save();
    drawViews();
  }

  /** The header's view control (media/view-control.js, the component the web page draws too). */
  const viewControl = /** @type {any} */ (globalThis).BashExplainerViewControl.create($('views'), 'view', press);

  /** Draws the view control from the host's data, each option pressed by the panel's own state, in the first of its forms that fits the header's row. */
  function drawViews() {
    if (!control.options.length) return;
    const shown = { ...control, options: control.options.map((o) => ({ ...o, pressed: pressed(o) })) };
    const head = /** @type {HTMLElement} */ (document.querySelector('header'));
    for (const form of viewForms) {
      viewControl.draw(shown, form);
      if (head.scrollWidth <= head.clientWidth) break;
    }
  }
  // (Measured again when the header's width changes.)
  let headWidth = 0;
  new ResizeObserver(() => {
    const w = /** @type {HTMLElement} */ (document.querySelector('header')).clientWidth;
    if (w !== headWidth) {
      headWidth = w;
      drawViews();
    }
  }).observe(/** @type {HTMLElement} */ (document.querySelector('header')));

  // Keys 1 and 2 choose the depth when the focus is in the panel, not while a text is typed (an example's input, the search of the quick reference).
  document.addEventListener('keydown', (e) => {
    if ((e.key !== '1' && e.key !== '2') || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
    if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable]')) return;
    e.preventDefault();
    press({ depth: Number(e.key) });
  });

  const el = (/** @type {string} */ tag, /** @type {Record<string, string>} */ attrs = {}, /** @type {(Node | string)[]} */ ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') e.className = v;
      else e.setAttribute(k, v);
    }
    e.append(...kids);
    return e;
  };

  // ---------------------------------------------------------------- folding and unfolding, with motion

  /** How long a short box takes to grow or shrink (ms), and how. A taller one takes longer, up to `MOTION_MAX_MS`, so that a tall box does not rush (`motionMs`). */
  const MOTION_MS = 220;
  const MOTION_MAX_MS = 400;
  const motionMs = (/** @type {number} */ height) => Math.min(MOTION_MAX_MS, Math.max(MOTION_MS, Math.round(120 + height / 2)));
  const EASE = 'cubic-bezier(0.2, 0, 0, 1)';
  /** The setting `panel.animations`, from the host. */
  let animations = true;
  /** Whether rows move: the setting is on, and neither the system nor VS Code (`workbench.reduceMotion`) asks for less motion. */
  const motion = () => animations && !matchMedia('(prefers-reduced-motion: reduce)').matches && !document.body.classList.contains('vscode-reduce-motion');
  /** The move of each box that moves. */
  const running = /** @type {WeakMap<Element, Animation>} */ (new WeakMap());
  /** The boxes inside a box that moves, which are drawn (`data-closing`) until it has shrunk. */
  const insides = /** @type {WeakMap<Element, Element[]>} */ (new WeakMap());
  /** The moves of heights, while they run: the row held in place follows them (`hold`). */
  const moves = /** @type {Set<Animation>} */ (new Set());
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
    // (The size of a box as its style says it, with the margins, padding and borders that lie outside or around its height: all of them go
    // to nothing and come back with it, or what lies below would jump by them as the move starts and ends. A box without them has none.)
    const EDGES = ['marginTop', 'marginBottom', 'paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth'];
    const size = (/** @type {HTMLElement} */ e) => {
      const cs = getComputedStyle(e);
      return Object.fromEntries(['height', ...EDGES].map((k) => [k, /** @type {any} */ (cs)[k]]));
    };
    const none = Object.fromEntries(['height', ...EDGES].map((k) => [k, '0px']));
    const from = outer.map((c) => ({ h: running.has(c.el) || !c.open ? height(c.el) : 0, o: running.has(c.el) ? Number(getComputedStyle(c.el).opacity) : c.open ? 0 : 1, size: running.has(c.el) || !c.open ? size(c.el) : none }));
    outer.forEach((c) => running.get(c.el)?.cancel());
    // (What the moves that were cancelled kept drawn, and is not folded by this one, is hidden again, and a box that opens is no longer
    // kept drawn as one that folds; then the heights it grows to are measured.)
    for (const c of outer) {
      for (const x of insides.get(c.el) ?? []) if (!closing.some((o) => o.el === x)) delete /** @type {HTMLElement} */ (x).dataset.closing;
      if (c.open) delete c.el.dataset.closing;
    }
    const to = outer.map((c) => (c.open ? { h: height(c.el), size: size(c.el) } : { h: 0, size: none }));
    /** @type {Animation[]} */
    const started = [];
    let left = outer.length;
    if (!left) after();
    // (The boxes that move side by side, a row's parts and its examples, take as long as all of them are high.)
    const takes = outer.map((c, i) => motionMs(outer.reduce((n, o, j) => n + (o.el.parentElement === c.el.parentElement ? Math.max(from[j].h, to[j].h) : 0), 0)));
    outer.forEach((c, i) => {
      const box = c.el;
      const inner = list.filter((o) => o !== c && box.contains(o.el));
      insides.set(box, inner.map((o) => o.el));
      // (A clip, not overflow: the lines to the parent lie left of the box.)
      box.style.clipPath = 'inset(0 -100vw)';
      // (Its children's margins lie inside it while it moves, so that they grow and shrink with it.)
      box.style.display = 'flow-root';
      const a = box.animate([{ ...from[i].size, opacity: from[i].o }, { ...to[i].size, opacity: c.open ? 1 : 0 }],
        { duration: takes[i], delay: c.delay ?? 0, easing: EASE, fill: c.open ? 'backwards' : 'forwards' });
      running.set(box, a);
      moves.add(a);
      started.push(a);
      let over = false;
      const end = () => {
        moves.delete(a);
        if (over) return false;
        over = true;
        // (A move that was cancelled to start another on the same box ends late, after the other has started: it leaves the box as the other
        // has set it, and what it kept drawn is cleared when the other starts.)
        if (running.get(box) !== a) return false;
        running.delete(box);
        insides.delete(box);
        box.style.clipPath = '';
        box.style.display = '';
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

  /**
   * A `<details>` that moves when it opens or closes (`panel.animations`; off, or with reduced motion, at once). `body` holds what it folds.
   * A click on the summary still toggles it: the state is `open`, which the fold follows.
   */
  function foldingDetails(/** @type {HTMLDetailsElement} */ box, /** @type {HTMLElement} */ body) {
    const summary = /** @type {HTMLElement} */ (box.querySelector(':scope > summary'));
    summary.addEventListener('click', (e) => {
      if (selecting()) return;
      e.preventDefault();
      e.stopPropagation();
      hold(() => summary);
      if (box.open) fold([{ el: body, open: false }], () => { box.open = false; });
      else {
        box.open = true;
        fold([{ el: body, open: true }]);
      }
    });
    return box;
  }

  // ---------------------------------------------------------------- keeping the row acted on in place

  /*
   * A fold, an unfold or another depth changes the height of what lies around the row the viewer acted on. The panel
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

  /** Finds the row of the item `key`, as drawn when it is called. */
  const rowAt = (/** @type {string} */ key) => () => document.querySelector(`#tree li[data-key="${key}"] > .item > .row`);

  /**
   * Of `items`, the first row on the screen (below `below`, the sticky rows at the top) that `stays` after a change;
   * else the nearest item around the first on the screen that stays. With no row on the screen, only what lies under one (a long example): the
   * deepest item that reaches the screen, whose example is held where it is, so that it stays on the screen whatever its row above does.
   */
  function firstOnScreen(/** @type {HTMLElement[]} */ items, /** @type {number} */ below, /** @type {(li: HTMLElement) => boolean} */ stays) {
    const reaches = (/** @type {Element} */ e) => {
      const r = e.getBoundingClientRect();
      return r.bottom > below && r.top < window.innerHeight;
    };
    const on = items.filter((li) => reaches(/** @type {HTMLElement} */ (li.querySelector(':scope > .item > .row'))));
    if (!on.length) {
      const under = items.filter((li) => reaches(/** @type {HTMLElement} */ (li.querySelector(':scope > .item')))).pop();
      const place = under && Array.from(under.querySelectorAll(':scope > .item > .body > .example')).findIndex(reaches);
      if (under && stays(under) && place !== undefined && place >= 0) return () => document.querySelectorAll(`#tree li[data-key="${under.dataset.key}"] > .item > .body > .example`)[place] ?? null;
    }
    let li = /** @type {HTMLElement | null | undefined} */ (on.find(stays) ?? on[0] ?? items.filter((x) => reaches(/** @type {HTMLElement} */ (x.querySelector(':scope > .item')))).pop());
    while (li && !stays(li)) li = /** @type {HTMLElement | null} */ (li.parentElement?.closest('li'));
    return li ? rowAt(String(li.dataset.key)) : null;
  }

  /** Before the rows of another depth are drawn: the first row on the screen that they still have stays where it is. */
  function holdForDepth(/** @type {any[]} */ rows) {
    const keys = new Set();
    const add = (/** @type {any} */ r) => {
      keys.add(r.key);
      r.children.forEach(add);
    };
    rows.forEach(add);
    const items = /** @type {HTMLElement[]} */ (Array.from($('tree').querySelectorAll('li[data-key]'))).filter((li) => li.getClientRects().length);
    hold(firstOnScreen(items, $('top').getBoundingClientRect().bottom, (li) => keys.has(li.dataset.key)));
  }

  /** Selects a token's range in the editor, only when it lies on the line explained. A range on another line (a clause of a
      `case` under its `while`, one over several lines: an if, a loop, a function) would move the cursor there, and the panel
      would explain that line instead, when one only meant to fold the row; the hover already shows that range. */
  function reveal(token, /** @type {boolean} */ keepFocus = false) {
    if (token.span.start.line === shownLineNo && token.span.end.line === shownLineNo) vscode.postMessage({ type: 'reveal', span: token.span, preserveFocus: keepFocus });
  }

  /** Whether a row is the row `idx` or one of its parts; no row is, for -1. */
  const coveredBy = (/** @type {number} */ idx) => (/** @type {number} */ i) => idx >= 0 && i >= idx && i < flat[idx].end;

  /** Scrolls the line sideways to a token's characters, as the editor does when the row is selected. */
  function revealInLine(idx) {
    const pre = $('line');
    const covered = coveredBy(idx);
    const shown = segments.filter((s) => covered(Number(s.dataset.idx)));
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
    segments.forEach((s) => s.classList.toggle('active', covered(Number(s.dataset.idx))));
    vscode.postMessage({ type: 'highlight', span: idx >= 0 ? flat[idx].token.span : null });
  }

  // ---------------------------------------------------------------- quick reference

  $('ref').addEventListener('click', () => toggleReference(true));
  /** Opens or closes the quick reference; `focus`: its search field takes the focus (with a pointer that types). */
  function toggleReference(/** @type {boolean} */ focus) {
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
      if (focus && window.matchMedia('(pointer: fine)').matches) $('ref-search').focus();
    }
  }
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
    return codeSpans(text).flatMap(({ code, part }) => {
      if (code) {
        const c = document.createElement('code');
        c.append(...withMarks(part));
        return [c];
      }
      return withMarks(part).map((n) => (typeof n === 'string' ? document.createTextNode(n) : n));
    });
  }

  /**
   * A marked text cut into its code spans and the text between them, as CommonMark reads it (and the product writes it:
   * `codeSpan`, src/label.ts): a span opens with a run of backticks and closes at the next run of as many, so its code
   * may hold backticks (`` `date` ``); one space at each end is taken off when both are there and the code is not only
   * spaces. A run that is never closed is text.
   * @returns {{ code: boolean, part: string }[]}
   */
  function codeSpans(/** @type {string} */ text) {
    /** @type {{ code: boolean, part: string }[]} */
    const out = [];
    const runs = /`+/g;
    let plain = 0;
    /** @type {RegExpExecArray | null} */
    let open;
    while ((open = runs.exec(text))) {
      const fence = open[0];
      let close;
      while ((close = runs.exec(text)) && close[0].length !== fence.length);
      if (!close) {
        // (Not closed: the run is text, and the search goes on after it.)
        runs.lastIndex = open.index + fence.length;
        continue;
      }
      if (open.index > plain) out.push({ code: false, part: text.slice(plain, open.index) });
      const code = text.slice(open.index + fence.length, close.index);
      out.push({ code: true, part: /^ [\s\S]*[^ ][\s\S]* $/.test(code) ? code.slice(1, -1) : code });
      plain = runs.lastIndex;
    }
    if (plain < text.length) out.push({ code: false, part: text.slice(plain) });
    return out;
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
   * Puts the focus in the explanation (the web page's key from the editor, F6): the quick reference's search field, or else
   * the explanation itself, from where a screen reader reads on.
   */
  function focusExplanation() {
    if (!$('reference').hidden) return $('ref-search').focus();
    $('main').tabIndex = -1;
    $('main').focus();
  }
})();
