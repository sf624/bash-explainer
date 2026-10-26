// The part hover of VS Code in the web page's editor (docs/design/hover.md, "Web page"). The cards are the very
// Markdown that VS Code shows (src/ui/hoverView.ts: `partHover`, `lineCard`), turned into DOM by web/hover-markdown.ts.
//
// The page's panel is the whole line. The pointer on a part shows its card (CodeMirror's hoverTooltip), in one box with
// the problem there if any, and the card leaves out the notes that problem says (`HoverInput.problems`, as in VS Code);
// on no part (the indentation, between statements), the line card. Ctrl+K Ctrl+I shows the part at the cursor, and
// again puts the focus in the card; Escape closes it. Ctrl+K Ctrl+E and the links "Whole line" and "Open in panel" put
// the cursor on the line, so that the panel explains it whole: there is no whole-line card on the web. A touch screen
// gets no hover (the panel follows the tapped line). `hover.enabled` off frees the keys for the browser.
import { forEachDiagnostic } from '@codemirror/lint';
import { Compartment, Extension, Prec, StateEffect, StateField } from '@codemirror/state';
import { closeHoverTooltips, EditorView, hoverTooltip, keymap, showTooltip, Tooltip, tooltips, ViewPlugin } from '@codemirror/view';
import type { LineExplanation } from '../src/analyzer';
import { heredocAt, ShellDocument } from '../src/document';
import { Lang } from '../src/i18n';
import { Settings } from '../src/settings';
import { blankRange, partAt, ProblemAt, rangeOnLine } from '../src/ui/hoverParts';
import { HoverInput, lineCard, partHover } from '../src/ui/hoverView';
import { joinParts, labelParts } from '../src/label';
import type { Token } from '../src/analyzer';
import { colored, ui } from '../src/ui/render';
import { CHROME } from './chrome-text';
import type { ThemeKind } from '../src/ui/palette';
import { isMac } from './file-io';
import { renderCard } from './hover-markdown';
import { TEXT } from './text';

/** What the hover asks of the page. */
export interface HoverHost {
  lang(): Lang;
  settings(): Settings;
  document(): ShellDocument | undefined;
  explainer(): ((line: number) => LineExplanation) | undefined;
  /** The card's link "Settings". */
  openSettings(): void;
  /** The card's link "Hide hover cards" (the page's footer, proto/chrome-3). */
  hideHover?(): void;
  /** Says a short message to a screen reader (the page's live region): a card opened by the keyboard. */
  announce?(text: string): void;
}

/** The theme the page shows now, for the labels' colours (src/ui/palette.ts). */
function themeKind(): ThemeKind {
  const set = document.documentElement.getAttribute('data-theme');
  if (set === 'light' || set === 'dark') return set;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * The problems CodeMirror's lint shows in the same box as the card, at `pos` (the rule of its own tooltip,
 * `lintTooltip` in @codemirror/lint): the card leaves out their notes. A problem's `source` is its code (web/editor.ts).
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

interface Card { md: string; from: number; to: number; line: number }

/**
 * The card for a position: the part there, or the line card on no part; with the range it is about. The card is the
 * whole one: `hover.maxDepth` and `examples.inHover` are VS Code's settings, and the page has none of them.
 */
function cardAt(host: HoverHost, view: EditorView, pos: number, problems: ProblemAt[]): Card | null {
  const explain = host.explainer();
  const doc = host.document();
  if (!explain || !doc) return null;
  const l = view.state.doc.lineAt(pos);
  const line = l.number - 1;
  const ex = explain(line);
  if (!ex.items.length) return null;
  const x: HoverInput = {
    ex, lang: host.lang(), theme: themeKind(), lineText: l.text, placement: host.settings()['examples.placement'], problems,
    panelLink: 'command:bashExplainer.openPanel', lineLink: 'command:bashExplainer.explainLine', keys: isMac() ? '⌘K ⌘E' : 'Ctrl+K Ctrl+E',
  };
  const at = { line, character: pos - l.from };
  const chain = partAt(ex.items, at, heredocAt(doc, line));
  const span = chain.length ? rangeOnLine(chain[chain.length - 1].span, line, l.text.length) : blankRange(l.text, at);
  const md = pageCard(chain.length ? partHover(x, chain) : lineCard(x), chain, x, line, !!host.hideHover);
  return { md, from: l.from + span.start.character, to: l.from + span.end.character, line };
}

/** Text for an attribute of the card's HTML. */
const attrText = (text: string) => text.replace(/[&"<>]/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * The page's own changes to VS Code's card (prototype, proto/chrome-3): the breadcrumb of the parts around the part
 * names each part whole and wraps (to two lines at most, web/page.css) instead of cutting each name at 18 characters;
 * the footer is "Line 8 · Open in panel · Hide hover cards" (the link turns the setting off, with an Undo).
 */
function pageCard(md: string, chain: Token[], x: HoverInput, line: number, canHide: boolean): string {
  const lines = md.split('\n');
  const glue = '</small> &nbsp; ';
  if (chain.length > 1) {
    const at = lines[0].indexOf(glue);
    const sep = ' <span style="color:var(--vscode-descriptionForeground);">›</span> ';
    const crumb = (tok: Token) => {
      let left = 60;
      const text = joinParts(labelParts(tok), (p) => {
        if (left <= 0) return '';
        let t = p.text.replace(/\s*\n\s*/g, ' ⏎ ');
        if (t.length > left) t = `${t.slice(0, left - 1)}…`;
        left -= t.length;
        return p.placeholder ? `<i>${colored(t, 'comment', x.theme)}</i>` : colored(t, tok.kind, x.theme);
      });
      return `<span title="${attrText(tok.explanation.replace(/`/g, ''))}">${text}</span>`;
    };
    if (at >= 0) lines[0] = `<small>${chain.slice(0, -1).map(crumb).join(sep)}${sep}${glue}${lines[0].slice(at + glue.length)}`;
  }
  const last = lines.length - 1;
  const open = /\[\$\(comment-discussion\)[^\]]*\]\([^)]*\)/.exec(lines[last])?.[0];
  if (open && lines[last - 1] === '---') {
    const hide = canHide ? ` &nbsp;·&nbsp; [${CHROME[x.lang].hideHover}](command:bashExplainer.hideHover)` : '';
    lines[last] = `<small>${ui[x.lang].line(line + 1)}</small> &nbsp;·&nbsp; ${open}${hide}`;
  }
  return lines.join('\n');
}

// A card opened by the keyboard stays until Escape, a click elsewhere, an edit or a move of the cursor.
const openCard = StateEffect.define<{ pos: number } | null>();

/** The whole line, on the web: the cursor goes to the line (where it is, if on it; else to its first word), and the panel explains it. */
function wholeLineInPanel(view: EditorView, line: number): void {
  const start = view.state.doc.line(line + 1);
  const head = view.state.selection.main.head;
  const anchor = head >= start.from && head <= start.to ? head : start.from + (/^\s*/.exec(start.text)![0].length);
  view.dispatch({ selection: { anchor }, effects: [openCard.of(null), closeHoverTooltips], scrollIntoView: true });
  if (window.matchMedia('(pointer: fine)').matches) view.focus();
}

/**
 * Keeps the cards inside the editor's pane: the room above or below `pos`, whichever is larger, for their height, and
 * the pane's width (CSS variables on the editor, read by the theme below). It reads the layout, so it runs where a card
 * is asked for (the pointer, a key), never while CodeMirror updates.
 */
function measureRoom(view: EditorView, pos: number): void {
  const pane = view.dom.getBoundingClientRect();
  const at = view.coordsAtPos(pos);
  const room = at ? Math.max(at.top - pane.top, pane.bottom - at.bottom) - 12 : 300;
  view.dom.style.setProperty('--bx-hover-room', `${Math.max(120, Math.round(room))}px`);
  view.dom.style.setProperty('--bx-hover-width', `${Math.max(200, Math.round(Math.min(pane.width, window.innerWidth) - 16))}px`);
}

function cardDom(host: HoverHost, view: EditorView, card: Card, pinned: boolean): HTMLElement {
  const dom = renderCard(card.md);
  const act = (a: HTMLElement) => {
    const command = a.dataset.command;
    if (command === 'bashExplainer.explainLine' || command === 'bashExplainer.openPanel') wholeLineInPanel(view, card.line);
    else if (command === 'bashExplainer.hideHover') {
      view.dispatch({ effects: [openCard.of(null), closeHoverTooltips] });
      host.hideHover?.();
    } else if (command === 'bashExplainer.openSettings') {
      view.dispatch({ effects: [openCard.of(null), closeHoverTooltips] });
      host.openSettings();
    }
  };
  // A command link keeps the focus where it is (in the editor) and does the page's own action.
  dom.addEventListener('mousedown', (e) => {
    if ((e.target as Element).closest('a[data-command]')) e.preventDefault();
  });
  dom.addEventListener('click', (e) => {
    const a = (e.target as Element).closest<HTMLElement>('a[data-command]');
    if (!a) return;
    e.preventDefault();
    act(a);
  });
  dom.addEventListener('keydown', (e) => {
    const a = (e.target as Element).closest<HTMLElement>('a[data-command]');
    if (a && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      act(a);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      // (A card the pointer opened closes with the tooltips; one opened by the keyboard, with its field.)
      view.dispatch({ effects: [openCard.of(null), closeHoverTooltips] });
      view.focus();
    }
  });
  if (pinned) {
    dom.classList.add('cm-bx-hover-pinned');
    dom.tabIndex = -1;
    dom.setAttribute('role', 'dialog');
    dom.setAttribute('aria-label', 'Bash Explainer');
  }
  return dom;
}

/** The card opened by the keyboard (Ctrl+K Ctrl+I). */
function pinnedField(host: HoverHost) {
  return StateField.define<Tooltip | null>({
    create: () => null,
    update(tip, tr) {
      for (const e of tr.effects) {
        if (!e.is(openCard)) continue;
        if (!e.value) return null;
        const { pos } = e.value;
        return {
          pos, above: false, strictSide: false, arrow: false,
          create: (view) => {
            // (From the keyboard no lint tooltip shows: the card keeps every note.)
            const c = cardAt(host, view, pos, []);
            return { dom: c ? cardDom(host, view, c, true) : document.createElement('div') };
          },
        };
      }
      return tip && (tr.docChanged || tr.selection) ? null : tip;
    },
    provide: (f) => showTooltip.from(f),
  });
}

/** The hover of the page's editor, and what turns its keys on and off. */
export interface WebHover {
  extension: Extension;
  /** Binds or frees the keys (`hover.enabled`), and closes a card opened by the keyboard; call it when the settings change. */
  enable(view: EditorView, on: boolean): void;
}

export function webHover(host: HoverHost): WebHover {
  const field = pinnedField(host);
  const close = (view: EditorView) => {
    if (view.state.field(field)) view.dispatch({ effects: openCard.of(null) });
  };
  const showPart = (view: EditorView) => {
    // Asked again while it is open: the focus goes into the card (to scroll it, to reach its links), as VS Code does.
    if (view.state.field(field)) {
      view.dom.querySelector<HTMLElement>('.cm-bx-hover-pinned')?.focus();
      return true;
    }
    const pos = view.state.selection.main.head;
    measureRoom(view, pos);
    view.dispatch({ effects: [closeHoverTooltips, openCard.of({ pos })] });
    // The focus stays in the editor: a screen reader is told that the card is there, and how to reach it.
    if (view.dom.querySelector('.cm-bx-hover-pinned')) host.announce?.(TEXT[host.lang()].cardOpened(isMac() ? '⌘K ⌘I' : 'Ctrl+K Ctrl+I'));
    return true;
  };
  const keys = keymap.of([
    { key: 'Mod-k Mod-i', run: showPart, preventDefault: true },
    { key: 'Mod-k Mod-e', run: (view) => (wholeLineInPanel(view, view.state.doc.lineAt(view.state.selection.main.head).number - 1), true), preventDefault: true },
    { key: 'Escape', run: (view) => (view.state.field(field) ? (close(view), true) : false) },
  ]);
  // The keys, in a compartment of their own: with `hover.enabled` off they are not bound, and the browser keeps Ctrl+K and Ctrl+E.
  const compartment = new Compartment();
  // A click or the focus outside the editor (and its cards) closes the card opened by the keyboard.
  const outside = ViewPlugin.define((view) => {
    const down = (e: MouseEvent) => {
      if (!view.dom.contains(e.target as Node)) close(view);
    };
    const out = (e: FocusEvent) => {
      if (e.relatedTarget instanceof Node && !view.dom.contains(e.relatedTarget)) close(view);
    };
    document.addEventListener('mousedown', down, true);
    view.dom.addEventListener('focusout', out);
    return {
      destroy() {
        document.removeEventListener('mousedown', down, true);
        view.dom.removeEventListener('focusout', out);
      },
    };
  });
  const extension = [
    field,
    outside,
    // Every tooltip of the editor (cards, problems, name hints) stays inside its pane, 8 px from the window's edges:
    // a card near the top does not cover the page's top bar.
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
      measureRoom(view, pos);
      return { pos: c.from, end: c.to, above: true, create: () => ({ dom: cardDom(host, view, c, false) }) };
    }, { hoverTime: 350 }),
    Prec.highest(compartment.of(host.settings()['hover.enabled'] ? keys : [])),
    EditorView.theme({
      // The box: no higher than the room by the position; it scrolls as one, the problem above the card with it, as
      // VS Code's hover does (on a narrow pane a long problem would leave the card no room).
      '.cm-tooltip-hover:has(> .cm-bx-hover)': {
        maxHeight: 'var(--bx-hover-room, 420px)', maxWidth: 'min(520px, var(--bx-hover-width, calc(100vw - 16px)))', overflow: 'auto',
      },
      '.cm-tooltip-hover > .cm-bx-hover': { overflow: 'visible' },
      // A card opened by the keyboard scrolls itself, so that the focus in it scrolls it.
      '.cm-bx-hover-pinned': { maxHeight: 'min(420px, var(--bx-hover-room, 420px))' },
      // The card: the page's own fonts and colours, VS Code's hover sizes (500 px wide at most, scrolled when long).
      '.cm-bx-hover': {
        '--vscode-badge-background': '#616161', '--vscode-badge-foreground': '#f8f8f8',
        boxSizing: 'border-box', maxWidth: 'min(520px, var(--bx-hover-width, calc(100vw - 16px)))', overflow: 'auto', overflowWrap: 'anywhere',
        padding: '4px 10px', fontFamily: 'var(--vscode-font-family)', fontSize: 'var(--vscode-font-size)', lineHeight: '1.45', outline: 'none',
        '& p': { margin: '6px 0' },
        '& hr': { border: 'none', borderTop: '1px solid var(--vscode-panel-border)', margin: '6px -10px' },
        '& h1, & h2, & h3, & h4, & h5, & h6': { margin: '8px 0 4px', fontSize: '1em' },
        '& blockquote': { margin: '6px 0', padding: '2px 0 2px 8px', borderLeft: '3px solid var(--vscode-textBlockQuote-border)', background: 'var(--vscode-textBlockQuote-background)' },
        '& blockquote p': { margin: '0' },
        '& code': { fontFamily: 'var(--vscode-editor-font-family)', backgroundColor: 'var(--vscode-textCodeBlock-background)', padding: '0 3px', borderRadius: '3px' },
        '& pre': { margin: '4px 0', padding: '4px 8px', backgroundColor: 'var(--vscode-textCodeBlock-background)', overflowX: 'auto' },
        '& pre code': { padding: '0', background: 'none' },
        '& table': { borderCollapse: 'collapse', margin: '4px 0' },
        '& td': { verticalAlign: 'top', padding: '1px 8px 1px 0' },
        '& td:first-child': { whiteSpace: 'nowrap', maxWidth: '12em' },
        '& a': { color: 'var(--vscode-textLink-foreground)', textDecoration: 'none', cursor: 'pointer' },
        '& a:hover, & a:focus-visible': { textDecoration: 'underline' },
        '& small': { fontSize: '90%' },
      },
      '.cm-bx-hover-icon': { width: '14px', height: '14px', verticalAlign: '-2px', fill: 'currentColor' },
      '.cm-bx-hover-pinned:focus-visible': { outline: '1px solid var(--vscode-focusBorder)' },
    }),
  ];
  return {
    extension,
    enable(view, on) {
      close(view);
      view.dispatch({ effects: compartment.reconfigure(on ? keys : []) });
    },
  };
}
