// Marks the command over several lines at the cursor (src/ui/blockAt.ts) in the page's editor, with the setting
// `blockOutline`: a bar in the left margin of its lines (`bar`), or a faint background (`tint`); `off` has no extension
// at all, so nothing runs. A line decoration only adds a class; the drawing is a pseudo-element or an inset shadow that
// takes no room, so no text moves, and a selection, the active line and wrapped rows stay as they are.
//
// The block comes from the document the page has parsed already (`document`, shared with the panel and the problems):
// a move of the cursor looks it up in that tree, and the text is parsed again only by the page's own timer, which
// then sends `refreshOutline` (Editor.shade()).
import { StateEffect } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';
import type { ShellDocument } from '../src/document';
import type { BlockOutline } from '../src/settings';
import { blockAt, placeOf } from '../src/ui/blockAt';

/** The page has parsed the text (sent with its shading) or the mode changed: look the block up again. */
export const refreshOutline = StateEffect.define<null>();

const MARKS = {
  first: Decoration.line({ class: 'cm-bx-blk cm-bx-blk-first' }),
  mid: Decoration.line({ class: 'cm-bx-blk cm-bx-blk-mid' }),
  last: Decoration.line({ class: 'cm-bx-blk cm-bx-blk-last' }),
};

/** The extension for a mode: none for `off`. */
export function blockOutline(mode: BlockOutline, document: () => ShellDocument | undefined) {
  if (mode === 'off') return [];
  return [
    ViewPlugin.fromClass(class {
      // (Nothing at first: the page's document is not there yet while the editor is made; its first shading sends `refreshOutline`.)
      decorations: DecorationSet = Decoration.none;
      update(u: ViewUpdate): void {
        if (u.transactions.some((t) => t.effects.some((e) => e.is(refreshOutline)))) this.decorations = this.build(u.view);
        // The tree trails typing: the marks move with the text until the page has parsed it.
        else if (u.docChanged) this.decorations = this.decorations.map(u.changes);
        else if (u.selectionSet) this.decorations = this.build(u.view);
      }
      build(view: EditorView): DecorationSet {
        const state = view.state;
        const doc = document();
        if (!doc || doc.lines.length !== state.doc.lines) return Decoration.none;
        const head = state.selection.main.head;
        const at = state.doc.lineAt(head);
        const block = blockAt(doc, at.number - 1, head - at.from);
        if (!block) return Decoration.none;
        const ranges = [];
        for (let n = block.startLine; n <= block.endLine; n++) ranges.push(MARKS[placeOf(block, n)].range(state.doc.line(n + 1).from));
        return Decoration.set(ranges);
      }
    }, { decorations: (p) => p.decorations }),
    EditorView.baseTheme(mode === 'bar' ? barTheme : tintTheme),
  ];
}

// The bar is the text's colour at a little over half (the same on the page's light and dark themes); a system that
// forces colours draws it in the system's text colour.
const BAR = 'color-mix(in srgb, var(--vscode-editor-foreground) 55%, transparent)';

// (Each rule only draws: `position: relative` on a line and an absolute pseudo-element change no size.)
const barTheme = {
  '.cm-bx-blk': { position: 'relative' },
  '.cm-bx-blk::before': { content: '""', position: 'absolute', top: 0, bottom: 0, left: '1px', width: '3px', pointerEvents: 'none', background: BAR },
  '.cm-bx-blk-first::before': { top: '2px', borderRadius: '2px 2px 0 0' },
  '.cm-bx-blk-last::before': { bottom: '2px', borderRadius: '0 0 2px 2px' },
  '@media (forced-colors: active)': { '.cm-bx-blk::before': { background: 'CanvasText' } },
};
// The tint is a translucent shadow, so that a selection under it shows through, as through the active line's.
const tintTheme = {
  '.cm-bx-blk': { position: 'relative', boxShadow: 'inset 0 0 0 100vmax rgba(127, 127, 127, 0.09)' },
  // (A system that forces colours draws no shadows: a bar takes its place.)
  '.cm-bx-blk::before': { content: '""', position: 'absolute', top: 0, bottom: 0, left: '1px', width: '3px', pointerEvents: 'none' },
  '@media (forced-colors: active)': { '.cm-bx-blk': { boxShadow: 'none' }, '.cm-bx-blk::before': { background: 'CanvasText' } },
};
