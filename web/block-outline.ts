// Marks the command over several lines at the cursor (src/ui/blockAt.ts) in the page's editor, with the setting
// `blockOutline`: a bar in the left margin of its lines (`bar`), or a faint background (`tint`); `off` has no extension
// at all, so nothing runs. A line decoration only adds classes; the drawing is a pseudo-element or an inset shadow that
// takes no room, so no text moves, and a selection, the active line and wrapped rows stay as they are.
//
// The block comes from `document` (the page's, shared with the panel and the problems), which parses the text when it
// has changed, so no stale tree is read. A move of the cursor looks the block up there; typing moves the block's two
// ends with the text (a line typed or removed inside it is in it at once, and the bar has no hole), and the page's own
// timer, which parses and shades, sends `refreshOutline` for the block of the new text.
//
// There is one theme for both marks, in the page for good once a mode other than `off` is used (CodeMirror never
// removes a style it mounted): the mode is a class of the line (`cm-bx-as-bar`, `cm-bx-as-tint`), so that a switch
// changes the classes and leaves exactly one mark.
import { type EditorState, StateEffect } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';
import type { ShellDocument } from '../src/document';
import type { BlockOutline } from '../src/settings';
import { blockAt, placeOf } from '../src/ui/blockAt';

/** The page has parsed the text (sent with its shading) or the mode changed: look the block up again. */
export const refreshOutline = StateEffect.define<null>();

const MARKS = Object.fromEntries((['bar', 'tint'] as const).map((mode) => [mode, {
  first: Decoration.line({ class: `cm-bx-blk cm-bx-as-${mode} cm-bx-blk-first` }),
  mid: Decoration.line({ class: `cm-bx-blk cm-bx-as-${mode} cm-bx-blk-mid` }),
  last: Decoration.line({ class: `cm-bx-blk cm-bx-as-${mode} cm-bx-blk-last` }),
}])) as Record<'bar' | 'tint', Record<'first' | 'mid' | 'last', Decoration>>;

/** The block as the start of its first and of its last line in the text. */
interface Placed { from: number; to: number }

/** The extension for a mode: none for `off`. */
export function blockOutline(mode: BlockOutline, document: () => ShellDocument | undefined) {
  if (mode === 'off') return [];
  const marks = MARKS[mode];
  /** The lines from `placed.from` to `placed.to`, marked: none for fewer than two lines. */
  const draw = (state: EditorState, placed: Placed | undefined): DecorationSet => {
    if (!placed) return Decoration.none;
    const first = state.doc.lineAt(placed.from).number;
    const last = state.doc.lineAt(placed.to).number;
    if (last <= first) return Decoration.none;
    const ranges = [];
    for (let n = first; n <= last; n++) ranges.push(marks[placeOf({ startLine: first, endLine: last }, n)].range(state.doc.line(n).from));
    return Decoration.set(ranges);
  };
  return [
    ViewPlugin.fromClass(class {
      // (Nothing at first: the page's document is not there yet while the editor is made; its first shading sends `refreshOutline`.)
      decorations: DecorationSet = Decoration.none;
      placed: Placed | undefined;
      update(u: ViewUpdate): void {
        if (u.transactions.some((t) => t.effects.some((e) => e.is(refreshOutline)))) this.look(u.view);
        // The tree trails typing: the ends of the block move with the text until the page has parsed it.
        else if (u.docChanged) {
          if (this.placed) this.placed = { from: u.changes.mapPos(this.placed.from, 1), to: u.changes.mapPos(this.placed.to, 1) };
          this.decorations = draw(u.state, this.placed);
        } else if (u.selectionSet) this.look(u.view);
      }
      look(view: EditorView): void {
        const state = view.state;
        const head = state.selection.main.head;
        const at = state.doc.lineAt(head);
        const doc = document();
        const block = doc && blockAt(doc, at.number - 1, head - at.from);
        this.placed = block ? { from: state.doc.line(block.startLine + 1).from, to: state.doc.line(block.endLine + 1).from } : undefined;
        this.decorations = draw(state, this.placed);
      }
    }, { decorations: (p) => p.decorations }),
    outlineTheme,
  ];
}

// The bar is the text's colour at a little over half (the same on the page's light and dark themes); a system that
// forces colours draws it in the system's text colour.
const BAR = 'color-mix(in srgb, var(--vscode-editor-foreground) 55%, transparent)';

// (Made once: a theme made on each call mounts its rules again, and they stay.)
// (Each rule only draws: `position: relative` on a line and an absolute pseudo-element change no size.)
const theme = {
  '.cm-bx-blk.cm-bx-as-bar, .cm-bx-blk.cm-bx-as-tint': { position: 'relative' },
  '.cm-bx-blk.cm-bx-as-bar::before, .cm-bx-blk.cm-bx-as-tint::before': { content: '""', position: 'absolute', top: 0, bottom: 0, left: '1px', width: '3px', pointerEvents: 'none' },
  '.cm-bx-blk.cm-bx-as-bar::before': { background: BAR },
  '.cm-bx-blk.cm-bx-as-bar.cm-bx-blk-first::before': { top: '2px', borderRadius: '2px 2px 0 0' },
  '.cm-bx-blk.cm-bx-as-bar.cm-bx-blk-last::before': { bottom: '2px', borderRadius: '0 0 2px 2px' },
  // The tint is a translucent shadow, so that a selection under it shows through, as through the active line's.
  '.cm-bx-blk.cm-bx-as-tint': { boxShadow: 'inset 0 0 0 100vmax rgba(127, 127, 127, 0.09)' },
  // (A system that forces colours draws no shadows: a bar takes the tint's place.)
  '@media (forced-colors: active)': {
    '.cm-bx-blk.cm-bx-as-bar::before, .cm-bx-blk.cm-bx-as-tint::before': { background: 'CanvasText' },
    '.cm-bx-blk.cm-bx-as-tint': { boxShadow: 'none' },
  },
};
const outlineTheme = EditorView.baseTheme(theme);
