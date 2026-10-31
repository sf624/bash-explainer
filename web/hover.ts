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
import { CARD_GRACE, cardPlace, PointerAt, towardCard } from '../src/ui/cardPlace';
import { blankRange, partAt, ProblemAt, rangeOnLine } from '../src/ui/hoverParts';
import { HoverInput, lineCard, partHover } from '../src/ui/hoverView';
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
  return { md: chain.length ? partHover(x, chain) : lineCard(x), from: l.from + span.start.character, to: l.from + span.end.character, line };
}

// A card opened by the keyboard stays until Escape, a click elsewhere, an edit or a move of the cursor.
const openCard = StateEffect.define<{ pos: number; above: boolean } | null>();

/** The whole line, on the web: the cursor goes to the line (where it is, if on it; else to its first word), and the panel explains it. */
function wholeLineInPanel(view: EditorView, line: number): void {
  const start = view.state.doc.line(line + 1);
  const head = view.state.selection.main.head;
  const anchor = head >= start.from && head <= start.to ? head : start.from + (/^\s*/.exec(start.text)![0].length);
  view.dispatch({ selection: { anchor }, effects: [openCard.of(null), closeHoverTooltips], scrollIntoView: true });
  if (window.matchMedia('(pointer: fine)').matches) view.focus();
}

/**
 * The rows of the line at `pos`, from the top of its first to the bottom of its last (a wrapped line is one), at the
 * position's own left: where a card is anchored, so that it goes under the whole line, or above it, never over a row.
 */
function lineRows(view: EditorView, pos: number): { left: number; right: number; top: number; bottom: number } {
  const block = view.lineBlockAt(pos);
  const at = view.coordsAtPos(pos, 1) ?? { left: view.contentDOM.getBoundingClientRect().left };
  return { left: at.left, right: at.left, top: view.documentTop + block.top, bottom: view.documentTop + block.bottom };
}

/**
 * Where a card for `pos` goes, inside the editor's pane (src/ui/cardPlace.ts): above or below the line, and its height
 * at most, set as a CSS variable on the editor (read by the theme below), with the pane's width. It reads the layout,
 * so it runs where a card is asked for (the pointer, a key), never while CodeMirror updates.
 */
function placeCard(view: EditorView, pos: number): boolean {
  const pane = view.dom.getBoundingClientRect();
  const place = cardPlace(lineRows(view, pos), { top: Math.max(pane.top, 0), bottom: Math.min(pane.bottom, window.innerHeight) }, window.innerHeight);
  view.dom.style.setProperty('--bx-hover-room', `${place.maxHeight}px`);
  view.dom.style.setProperty('--bx-hover-width', `${Math.max(200, Math.round(Math.min(pane.width, window.innerWidth) - 16))}px`);
  return place.above;
}

function cardDom(host: HoverHost, view: EditorView, card: Card, pinned: boolean): HTMLElement {
  const dom = renderCard(card.md);
  const act = (a: HTMLElement) => {
    const command = a.dataset.command;
    if (command === 'bashExplainer.explainLine' || command === 'bashExplainer.openPanel') wholeLineInPanel(view, card.line);
    else if (command === 'bashExplainer.openSettings') {
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
        const { pos, above } = e.value;
        return {
          pos, above, strictSide: true, arrow: false,
          create: (view) => {
            // (From the keyboard no lint tooltip shows: the card keeps every note.)
            const c = cardAt(host, view, pos, []);
            return { dom: c ? cardDom(host, view, c, true) : document.createElement('div'), getCoords: (at: number) => lineRows(view, at) };
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
  /** The card the pointer opened, while it shows. */
  let hovered: Card | undefined;
  // The pointer on its way from a part to its card crosses the line's other rows, whose words would take the hover
  // over: while it moves towards the card (src/ui/cardPlace.ts, `towardCard`), the editor does not see those moves.
  const grace = ViewPlugin.define((view) => {
    /** The pointer's last place on the part, and its last place. */
    let onPart: PointerAt | undefined;
    let last: PointerAt | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const move = (e: MouseEvent) => {
      const tip = view.dom.querySelector<HTMLElement>('.cm-tooltip-hover');
      last = { x: e.clientX, y: e.clientY, time: e.timeStamp };
      const card = hovered;
      if (!card || !tip?.querySelector('.cm-bx-hover')) return void (onPart = undefined);
      const box = tip.getBoundingClientRect();
      if (last.x >= box.left && last.x <= box.right && last.y >= box.top && last.y <= box.bottom) return void (onPart = undefined);
      const at = view.posAtCoords(last, false);
      if (at >= card.from && at <= card.to && view.state.doc.lineAt(at).number === card.line + 1) return void (onPart = last);
      if (onPart && towardCard(onPart, last, lineRows(view, card.from), box)) {
        e.stopPropagation();
        clearTimeout(timer);
        const since = onPart.time;
        // Still not on the card when the time is up: it closes, as the editor would have closed it.
        timer = setTimeout(() => {
          const now = view.dom.querySelector<HTMLElement>('.cm-tooltip-hover')?.getBoundingClientRect();
          const inCard = now && last && last.x >= now.left && last.x <= now.right && last.y >= now.top && last.y <= now.bottom;
          if (!inCard && hovered === card) view.dispatch({ effects: closeHoverTooltips });
        }, Math.max(0, since + CARD_GRACE - performance.now()) + 20);
        return;
      }
      onPart = undefined;
    };
    view.dom.addEventListener('mousemove', move, true);
    return {
      destroy() {
        clearTimeout(timer);
        view.dom.removeEventListener('mousemove', move, true);
      },
    };
  });
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
    const above = placeCard(view, pos);
    view.dispatch({ effects: [closeHoverTooltips, openCard.of({ pos, above })] });
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
      const above = placeCard(view, c.from);
      return {
        pos: c.from, end: c.to, above, strictSide: true,
        create: () => {
          hovered = c;
          return { dom: cardDom(host, view, c, false), getCoords: (at: number) => lineRows(view, at), destroy: () => void (hovered === c && (hovered = undefined)) };
        },
      };
    }, { hoverTime: 350 }),
    grace,
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
