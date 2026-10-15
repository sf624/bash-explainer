// @ts-check
(function () {
  // @ts-ignore acquireVsCodeApi is injected by VS Code.
  const vscode = acquireVsCodeApi();
  const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

  /** @type {Array<{ token: any, el: HTMLElement }>} */
  let flat = [];
  /** @type {HTMLElement[]} */
  let segments = [];

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.type === 'update') render(msg);
    if (msg.type === 'empty') showEmpty(msg.message);
  });
  vscode.postMessage({ type: 'ready' });

  function showEmpty(/** @type {string} */ message) {
    $('where').textContent = '';
    $('context').textContent = '';
    $('line').replaceChildren();
    $('notes').replaceChildren();
    $('tree').replaceChildren();
    $('empty').textContent = message;
    $('empty').hidden = false;
  }

  function render(msg) {
    const ex = msg.explanation;
    $('where').textContent = `${msg.file} · ${msg.lineLabel}`;
    $('context').textContent = msg.contextLabels.length ? ' › ' + msg.contextLabels.join(' › ') : '';

    flat = [];
    const tree = $('tree');
    tree.replaceChildren(...ex.items.map((t) => item(t, 0)));

    renderLine(msg.lineText, ex.line, ex.items);

    $('notes').replaceChildren(...ex.notes.map((n) => {
      const p = document.createElement('p');
      p.className = 'note';
      p.append(...inline(n));
      return p;
    }));
    $('empty').textContent = msg.emptyMessage;
    $('empty').hidden = ex.items.length > 0;
  }

  /** Tree item for a token and its children. */
  function item(token, depth) {
    const li = document.createElement('li');
    const row = document.createElement('div');
    row.className = `row kind-${token.kind}`;
    const label = document.createElement('code');
    label.className = 'label';
    label.textContent = token.label;
    const text = document.createElement('span');
    text.className = 'text';
    text.append(...inline(token.explanation));
    row.append(label, text);
    li.append(row);
    const index = flat.length;
    flat.push({ token, el: row });
    row.addEventListener('mouseenter', () => focus(index));
    row.addEventListener('mouseleave', () => focus(-1));
    row.addEventListener('click', () => vscode.postMessage({ type: 'reveal', span: token.span }));
    if (token.children.length) {
      const ul = document.createElement('ul');
      ul.append(...token.children.map((c) => item(c, depth + 1)));
      li.append(ul);
    }
    return li;
  }

  /** Colour each character of the line by the deepest token covering it. */
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
    segments = [];
    let i = 0;
    while (i < text.length) {
      let j = i;
      while (j < text.length && owner[j] === owner[i]) j++;
      const span = document.createElement('span');
      span.textContent = text.slice(i, j);
      const idx = owner[i];
      if (idx >= 0 && text.slice(i, j).trim()) {
        span.className = `seg kind-${flat[idx].token.kind}`;
        span.dataset.idx = String(idx);
        span.addEventListener('mouseenter', () => focus(idx));
        span.addEventListener('mouseleave', () => focus(-1));
        span.addEventListener('click', () => {
          flat[idx].el.scrollIntoView({ block: 'nearest' });
          vscode.postMessage({ type: 'reveal', span: flat[idx].token.span });
        });
      }
      pre.append(span);
      segments.push(span);
      i = j;
    }
    if (!text.length) pre.textContent = ' ';
  }

  /** Highlight a token in the tree, its characters in the line, and its range in the editor. */
  function focus(idx) {
    flat.forEach((f, i) => f.el.classList.toggle('active', i === idx));
    const covered = new Set();
    if (idx >= 0) {
      const mark = (t) => {
        covered.add(flat.findIndex((f) => f.token === t));
        t.children.forEach(mark);
      };
      mark(flat[idx].token);
    }
    segments.forEach((s) => s.classList.toggle('active', covered.has(Number(s.dataset.idx))));
    vscode.postMessage({ type: 'highlight', span: idx >= 0 ? flat[idx].token.span : null });
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
})();
