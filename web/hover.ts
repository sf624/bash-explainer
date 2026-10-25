// PROTOTYPE (branch proto/web-hover, option B of the design study; not for main): the part hover of VS Code in the web
// page's editor (docs/design/hover.md). The cards are the very Markdown that VS Code shows (src/ui/hoverView.ts:
// `partHover`, `lineCard`), turned into DOM here by a reader of the small dialect that hoverView writes (paragraphs,
// rules, quotes, `####` headings, fences, HTML tables, links, `$(icon)`), then kept to an allow-list of elements and
// attributes, as VS Code's own hover does. So the content has one source; only this reader is the web's.
//
// Option B: the page's panel is the whole line. The pointer on a part shows its card (CodeMirror's hoverTooltip), above
// the problem there if any, and the card leaves out the notes that problem says (`HoverInput.problems`, as in VS
// Code); Ctrl+K Ctrl+I shows the part at the cursor; Ctrl+K Ctrl+E and the link "Whole line" put the cursor on the
// line, so that the panel explains it whole. Escape closes a card opened by the keyboard. A touch screen gets no hover
// (the panel follows the tapped line). `hover.enabled` off frees the keys for the browser.
import { forEachDiagnostic } from '@codemirror/lint';
import { Compartment, Prec, StateEffect, StateField } from '@codemirror/state';
import { EditorView, hoverTooltip, keymap, showTooltip, Tooltip, tooltips } from '@codemirror/view';
import type { LineExplanation } from '../src/analyzer';
import { heredocAt, ShellDocument } from '../src/document';
import { Lang } from '../src/i18n';
import { Settings } from '../src/settings';
import { blankRange, partAt, ProblemAt, rangeOnLine } from '../src/ui/hoverParts';
import { HoverInput, lineCard, partHover } from '../src/ui/hoverView';
import type { ThemeKind } from '../src/ui/palette';
import { pruneDepth } from '../src/ui/render';
import { drawIcon } from './icons';

/** What the hover asks of the page. */
export interface HoverHost {
  lang(): Lang;
  settings(): Settings;
  document(): ShellDocument | undefined;
  explainer(): ((line: number) => LineExplanation) | undefined;
  openSettings(): void;
}

// ---- The reader of hoverView's Markdown ---------------------------------------------------------

const ICONS = new Set(['warning', 'info', 'gear']);

/** Inline Markdown to HTML: code spans, links, bold, italics and icons; the rest is HTML already (hoverView escapes text). */
function inline(text: string): string {
  const out: string[] = [];
  // Code spans first: what is inside is text.
  const parts = text.split(/(`+)([^`]*?)\1/);
  for (let i = 0; i < parts.length; i += 3) {
    let s = parts[i];
    s = s.replace(/\[([^\]]*)\]\(([^\s)]+)(?:\s+"([^"]*)")?\)/g, (_m, label: string, href: string, title?: string) =>
      `<a href="${href.replace(/"/g, '&quot;')}"${title ? ` title="${title.replace(/"/g, '&quot;')}"` : ''}>${label}</a>`);
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[\s(>])[_*]([^_*\s][^_*]*?)[_*](?=$|[\s).,:;<])/g, '$1<em>$2</em>');
    s = s.replace(/\$\(([a-z-]+)\)/g, (_m, name: string) => (ICONS.has(name) ? `<span data-icon="${name}"></span>` : ''));
    out.push(s);
    if (i + 2 < parts.length) out.push(`<code>${parts[i + 2].trim().replace(/&/g, '&amp;').replace(/</g, '&lt;')}</code>`);
  }
  return out.join('');
}

/** hoverView's Markdown to HTML, block by block. */
export function markdownToHtml(md: string): string {
  const lines = md.split('\n');
  const html: string[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) html.push(`<p>${inline(para.join('\n'))}</p>`);
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = /^(`{3,})/.exec(line);
    if (fence) {
      flush();
      const body: string[] = [];
      while (++i < lines.length && lines[i] !== fence[1]) body.push(lines[i]);
      html.push(`<pre><code>${body.join('\n').replace(/&/g, '&amp;').replace(/</g, '&lt;')}</code></pre>`);
    } else if (line.startsWith('<table>')) {
      flush();
      const body: string[] = [];
      for (; i < lines.length && !lines[i].startsWith('</table>'); i++) body.push(lines[i]);
      html.push(body.join('') + '</table>');
    } else if (!line.trim()) flush();
    else if (line === '---') {
      flush();
      html.push('<hr>');
    } else if (/^#{1,6} /.test(line)) {
      flush();
      html.push(`<h4>${inline(line.replace(/^#+ /, ''))}</h4>`);
    } else if (line.startsWith('> ')) {
      flush();
      html.push(`<blockquote>${inline(line.slice(2))}</blockquote>`);
    } else para.push(line);
  }
  flush();
  return html.join('');
}

const ELEMENTS = new Set(['P', 'HR', 'BLOCKQUOTE', 'H4', 'PRE', 'CODE', 'B', 'STRONG', 'I', 'EM', 'SMALL', 'BR', 'SPAN', 'TABLE', 'TBODY', 'TR', 'TD', 'A']);
/** The one shape of `style` that VS Code's hover keeps on a span (test/hover-view.test.ts). */
const STYLE = /^(color:(#[0-9a-fA-F]{3,8}|var\(--vscode-[\w-]+\));)?(background-color:(#[0-9a-fA-F]{3,8}|var\(--vscode-[\w-]+\));)?(display:inline-block;)?(border-radius:\d+px;)?$/;

/** A copy of the HTML with only the allowed elements and attributes (as VS Code's hover keeps); the others leave their text. */
function sanitize(from: Node, to: Node): void {
  for (const n of Array.from(from.childNodes)) {
    if (n.nodeType === Node.TEXT_NODE) to.appendChild(document.createTextNode(n.textContent ?? ''));
    if (n.nodeType !== Node.ELEMENT_NODE) continue;
    const el = n as Element;
    if (!ELEMENTS.has(el.tagName)) {
      sanitize(el, to);
      continue;
    }
    const copy = document.createElement(el.tagName.toLowerCase());
    const style = el.getAttribute('style');
    if (el.tagName === 'SPAN' && style && STYLE.test(style)) copy.setAttribute('style', style);
    const title = el.getAttribute('title');
    if (title && (el.tagName === 'SPAN' || el.tagName === 'A')) copy.setAttribute('title', title);
    const icon = el.getAttribute('data-icon');
    if (el.tagName === 'SPAN' && icon && ICONS.has(icon)) copy.setAttribute('data-icon', icon);
    if (el.tagName === 'A') {
      const href = el.getAttribute('href') ?? '';
      if (/^https:\/\//.test(href)) Object.assign(copy, { href, target: '_blank', rel: 'noopener noreferrer' });
      else if (href.startsWith('command:')) copy.setAttribute('data-command', href.slice('command:'.length).split('?')[0]);
    }
    to.appendChild(copy);
    sanitize(el, copy);
  }
}

/** The card's DOM, from hoverView's Markdown. */
export function renderCard(md: string): HTMLElement {
  const tpl = document.createElement('template');
  tpl.innerHTML = markdownToHtml(md);
  const root = document.createElement('div');
  root.className = 'cm-bx-hover';
  sanitize(tpl.content, root);
  for (const span of Array.from(root.querySelectorAll<HTMLElement>('span[data-icon]'))) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('class', 'cm-bx-hover-icon');
    svg.setAttribute('aria-hidden', 'true');
    drawIcon(svg, span.dataset.icon!);
    span.replaceWith(svg);
  }
  return root;
}

// ---- The cards ------------------------------------------------------------------------------------

/** The theme the page shows now, for the labels' colours (src/ui/palette.ts). */
function themeKind(): ThemeKind {
  const set = document.documentElement.getAttribute('data-theme');
  if (set === 'light' || set === 'dark') return set;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

const mac = () => /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * The problems CodeMirror's lint shows in the same box as the card, at `pos` (the rule of its own lint tooltip): the
 * card leaves out their notes. `source` is the problem's code (web/editor.ts).
 */
function problemsAt(view: EditorView, pos: number, side: -1 | 1): ProblemAt[] {
  const out: ProblemAt[] = [];
  const place = (at: number) => {
    const l = view.state.doc.lineAt(at);
    return { line: l.number - 1, character: at - l.from };
  };
  forEachDiagnostic(view.state, (d, from, to) => {
    const on = pos >= from && pos <= to && (from === to || ((pos > from || side > 0) && (pos < to || side < 0)));
    if (on && d.source) out.push({ code: d.source, span: { start: place(from), end: place(to) } });
  });
  return out;
}

/** The card for a position: the part, or the line card on no part; with the range it is about. */
function cardAt(host: HoverHost, view: EditorView, pos: number, problems: ProblemAt[]): { md: string; from: number; to: number; line: number } | null {
  const explain = host.explainer();
  const doc = host.document();
  if (!explain || !doc) return null;
  const l = view.state.doc.lineAt(pos);
  const line = l.number - 1;
  const full = explain(line);
  if (!full.items.length) return null;
  const settings = host.settings();
  const ex = { ...full, items: pruneDepth(full.items, settings['hover.maxDepth']), examples: settings['examples.inHover'] ? full.examples : [] };
  const x: HoverInput = {
    ex, lang: host.lang(), theme: themeKind(), lineText: l.text, placement: settings['examples.placement'], problems,
    panelLink: 'command:bashExplainer.openPanel', lineLink: 'command:bashExplainer.explainLine', keys: mac() ? '⌘K ⌘E' : 'Ctrl+K Ctrl+E',
  };
  const at = { line, character: pos - l.from };
  const chain = partAt(ex.items, at, heredocAt(doc, line));
  const span = chain.length ? rangeOnLine(chain[chain.length - 1].span, line, l.text.length) : blankRange(l.text, at);
  return { md: chain.length ? partHover(x, chain) : lineCard(x), from: l.from + span.start.character, to: l.from + span.end.character, line };
}

/** The whole line, on the web: the cursor goes to the line (where it is, if on it; else its first word), and the panel explains it. */
function wholeLineInPanel(view: EditorView, line: number): void {
  const start = view.state.doc.line(line + 1);
  const head = view.state.selection.main.head;
  const anchor = head >= start.from && head <= start.to ? head : start.from + (/^\s*/.exec(start.text)![0].length);
  view.dispatch({ selection: { anchor }, effects: openCard.of(null), scrollIntoView: true });
  if (window.matchMedia('(pointer: fine)').matches) view.focus();
}

// A card opened by the keyboard stays until Escape, a click elsewhere, an edit or a move of the cursor.
const openCard = StateEffect.define<{ pos: number; room: number } | null>();

/**
 * The room the editor's pane has above or below a position, for a card's height (cards stay inside the pane). It reads
 * the layout, so it runs where the hover is asked for (the pointer, a key), never while CodeMirror updates.
 */
function roomAt(view: EditorView, pos: number): number {
  const pane = view.dom.getBoundingClientRect();
  const at = view.coordsAtPos(pos);
  if (!at) return 300;
  return Math.max(at.top - pane.top, pane.bottom - at.bottom) - 12;
}

function cardDom(host: HoverHost, view: EditorView, md: string, line: number, room: number, pinned: boolean): HTMLElement {
  const dom = renderCard(md);
  dom.tabIndex = -1;
  dom.setAttribute('role', 'dialog');
  dom.style.maxHeight = `${Math.max(120, Math.min(420, room))}px`;
  dom.addEventListener('mousedown', (e) => {
    if ((e.target as Element).closest('a[data-command]')) e.preventDefault();
  });
  dom.addEventListener('click', (e) => {
    const a = (e.target as Element).closest<HTMLElement>('a[data-command]');
    if (!a) return;
    e.preventDefault();
    const command = a.dataset.command;
    if (command === 'bashExplainer.explainLine' || command === 'bashExplainer.openPanel') wholeLineInPanel(view, line);
    else if (command === 'bashExplainer.openSettings') {
      view.dispatch({ effects: openCard.of(null) });
      host.openSettings();
    }
  });
  dom.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      view.dispatch({ effects: openCard.of(null) });
      view.focus();
    }
  });
  if (pinned) dom.classList.add('cm-bx-hover-pinned');
  return dom;
}

function pinnedField(host: HoverHost) {
  return StateField.define<Tooltip | null>({
    create: () => null,
    update(tip, tr) {
      for (const e of tr.effects) {
        if (!e.is(openCard)) continue;
        if (!e.value) return null;
        const { pos, room } = e.value;
        return {
          pos, above: false, strictSide: false, arrow: false,
          create: (view) => {
            // (From the keyboard no lint tooltip shows: the card keeps every note.)
            const c = cardAt(host, view, pos, []);
            return { dom: c ? cardDom(host, view, c.md, c.line, room, true) : document.createElement('div') };
          },
        };
      }
      return tip && (tr.docChanged || tr.selection) ? null : tip;
    },
    provide: (f) => showTooltip.from(f),
  });
}

/** The keys, in a compartment of their own: with `hover.enabled` off they are not bound, and the browser keeps Ctrl+K and Ctrl+E. */
const keys = new Compartment();

/** Binds or frees the hover's keys (call when the settings change). */
export function setHoverKeys(view: EditorView, on: boolean): void {
  view.dispatch({ effects: keys.reconfigure(on ? hoverKeymap : []) });
}

let hoverKeymap: ReturnType<typeof keymap.of> | [] = [];

/** The hover, its keys and its look. */
export function hoverExtension(host: HoverHost) {
  const field = pinnedField(host);
  const showPart = (view: EditorView) => {
    // Asked again while it is open: the focus goes into the card (to scroll it, to reach its links), as VS Code does.
    if (view.state.field(field)) {
      view.dom.querySelector<HTMLElement>('.cm-bx-hover-pinned')?.focus();
      return true;
    }
    const pos = view.state.selection.main.head;
    view.dispatch({ effects: openCard.of({ pos, room: roomAt(view, pos) }) });
    return true;
  };
  hoverKeymap = keymap.of([
    { key: 'Mod-k Mod-i', run: showPart, preventDefault: true },
    { key: 'Mod-k Mod-e', run: (view) => (wholeLineInPanel(view, view.state.doc.lineAt(view.state.selection.main.head).number - 1), true), preventDefault: true },
    { key: 'Escape', run: (view) => (view.state.field(field) ? (view.dispatch({ effects: openCard.of(null) }), true) : false) },
  ]);
  return [
    field,
    // Every tooltip of the editor (cards, problems, name hints) stays inside its pane, 8 px from the window's edges:
    // a card near the top no longer covers the page's top bar.
    tooltips({
      tooltipSpace: (view) => {
        const r = view.dom.getBoundingClientRect();
        return { top: r.top, left: Math.max(r.left, 8), right: Math.min(r.right, window.innerWidth - 8), bottom: r.bottom };
      },
    }),
    hoverTooltip((view, pos, side) => {
      if (!host.settings()['hover.enabled'] || window.matchMedia('(hover: none)').matches) return null;
      // Past the end of the line VS Code does not ask; on a name hint, the hint's own tooltip answers.
      const l = view.state.doc.lineAt(pos);
      if (pos === l.to && side > 0) return null;
      if (view.contentDOM.querySelector('.cm-bx-hint:hover')) return null;
      const c = cardAt(host, view, pos, problemsAt(view, pos, side));
      if (!c) return null;
      const room = roomAt(view, pos);
      return { pos: c.from, end: c.to, above: true, create: () => ({ dom: cardDom(host, view, c.md, c.line, room, false) }) };
    }, { hoverTime: 350 }),
    Prec.highest(keys.of(host.settings()['hover.enabled'] ? hoverKeymap : [])),
    EditorView.theme({
      // The card: the page's own fonts and colours, VS Code's hover sizes (500 px wide at most, scrolled when long).
      '.cm-tooltip:has(> .cm-bx-hover), .cm-tooltip-section:has(> .cm-bx-hover)': { maxWidth: 'min(520px, calc(100vw - 16px))' },
      '.cm-bx-hover': {
        '--vscode-badge-background': '#616161', '--vscode-badge-foreground': '#f8f8f8',
        boxSizing: 'border-box', maxWidth: 'min(520px, calc(100vw - 18px))', overflow: 'auto', overflowWrap: 'anywhere',
        padding: '4px 10px', fontFamily: 'var(--vscode-font-family)', fontSize: 'var(--vscode-font-size)', lineHeight: '1.45', outline: 'none',
        '& p': { margin: '6px 0' },
        '& hr': { border: 'none', borderTop: '1px solid var(--vscode-panel-border)', margin: '6px -10px' },
        '& h4': { margin: '8px 0 4px', fontSize: '1em' },
        '& blockquote': { margin: '6px 0', padding: '2px 0 2px 8px', borderLeft: '3px solid var(--vscode-textBlockQuote-border)', background: 'var(--vscode-textBlockQuote-background)' },
        '& code': { fontFamily: 'var(--vscode-editor-font-family)', backgroundColor: 'var(--vscode-textCodeBlock-background)', padding: '0 3px', borderRadius: '3px' },
        '& pre': { margin: '4px 0', padding: '4px 8px', backgroundColor: 'var(--vscode-textCodeBlock-background)', overflowX: 'auto' },
        '& pre code': { padding: 0, background: 'none' },
        '& table': { borderCollapse: 'collapse', margin: '4px 0' },
        '& td': { verticalAlign: 'top', padding: '1px 8px 1px 0' },
        '& td:first-child': { whiteSpace: 'nowrap', maxWidth: '12em' },
        '& a': { color: 'var(--vscode-textLink-foreground)', textDecoration: 'none', cursor: 'pointer' },
        '& a:hover': { textDecoration: 'underline' },
        '& small': { fontSize: '90%' },
      },
      '.cm-bx-hover-icon': { width: '14px', height: '14px', verticalAlign: '-2px', fill: 'currentColor' },
      '.cm-bx-hover-pinned:focus-visible': { outline: '1px solid var(--vscode-focusBorder)' },
    }),
  ];
}
