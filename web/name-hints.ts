// The name hints in the editor (docs/design/hover.md, "Name hints"): after a command name that does not run what a
// reader would guess from it, a muted label, as VS Code shows an inlay hint. The hints are those of VS Code and the
// Language Server (src/ui/nameHints.ts), worked out for the lines in view. Hovering one shows its tooltip; a click
// puts the cursor on the name, so the panel explains that line.
import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, hoverTooltip, WidgetType } from '@codemirror/view';
import type { NameHint } from '../src/ui/nameHints';

/** A hint placed in the editor: where it goes, and how far before it its name starts (where a click puts the cursor). */
export interface PlacedHint { at: number; back: number; hint: NameHint }

/** New hints for the text the editor has now. */
export const setHints = StateEffect.define<PlacedHint[]>();

/** The hint of each widget's element, for its tooltip. */
const hintOf = new WeakMap<HTMLElement, PlacedHint>();

class HintWidget extends WidgetType {
  constructor(readonly placed: PlacedHint) {
    super();
  }
  eq(other: HintWidget): boolean {
    return other.placed.hint.label === this.placed.hint.label && other.placed.hint.tooltip === this.placed.hint.tooltip && other.placed.back === this.placed.back;
  }
  toDOM(view: EditorView): HTMLElement {
    const span = document.createElement('span');
    span.className = 'cm-bx-hint';
    span.textContent = this.placed.hint.label;
    hintOf.set(span, this.placed);
    // The editor ignores what happens in the widget (`ignoreEvent`): a press does not move the cursor into it, and the
    // click puts the cursor on the name instead.
    span.addEventListener('mousedown', (e) => e.preventDefault());
    span.addEventListener('click', () => {
      // (Where the widget is now: the text may have changed since the hints were made.)
      const name = Math.max(0, view.posAtDOM(span) - hintOf.get(span)!.back);
      view.dispatch({ selection: { anchor: name }, scrollIntoView: true });
      if (window.matchMedia('(pointer: fine)').matches) view.focus();
    });
    return span;
  }
  updateDOM(dom: HTMLElement): boolean {
    dom.textContent = this.placed.hint.label;
    hintOf.set(dom, this.placed);
    return true;
  }
}

const hintField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(set, tr) {
    for (const e of tr.effects) {
      if (e.is(setHints)) return Decoration.set(e.value.map((p) => Decoration.widget({ widget: new HintWidget(p), side: 1 }).range(p.at)), true);
    }
    // While the text changes, the hints move with it until the new ones come.
    return tr.docChanged ? set.map(tr.changes) : set;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** The tooltip's Markdown as DOM nodes: paragraphs, `code` and **bold** (never HTML). */
function markdown(text: string): HTMLElement[] {
  return text.split('\n\n').map((para) => {
    const p = document.createElement('p');
    p.append(...para.split(/(`[^`]+`|\*\*[^*]+\*\*)/).filter(Boolean).map((part) => {
      if (part.startsWith('`') && part.endsWith('`') && part.length > 1) return Object.assign(document.createElement('code'), { textContent: part.slice(1, -1) });
      if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return Object.assign(document.createElement('strong'), { textContent: part.slice(2, -2) });
      return document.createTextNode(part);
    }));
    return p;
  });
}

/** The tooltip of the hint under the pointer: what runs and why; then how to open the line in the panel. */
const hintTooltip = (clickText: () => string) => hoverTooltip((view, pos) => {
  const el = view.contentDOM.querySelector<HTMLElement>('.cm-bx-hint:hover');
  const placed = el && hintOf.get(el);
  if (!placed || view.posAtDOM(el) !== pos) return null;
  return {
    pos, above: true,
    create: () => {
      const dom = document.createElement('div');
      dom.className = 'cm-bx-hint-tip';
      const open = Object.assign(document.createElement('p'), { className: 'cm-bx-hint-open', textContent: clickText() });
      dom.append(...markdown(placed.hint.tooltip), open);
      return { dom };
    },
  };
});

/** The hints' field and tooltip; `clickText` says what a click does, in the page's language. */
export function nameHintsExtension(clickText: () => string) {
  return [hintField, hintTooltip(clickText)];
}
