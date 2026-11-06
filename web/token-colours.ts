// The colours of the shell code in the editor, from the explanation's tokens (docs/design/one-colour-source.md): the
// lines in view are explained (the lean explanation the problems share, src/document.ts `leanExplanation`), and each
// run takes the role of the deepest token over it, as the panel's line box colours it (src/ui/lineColours.ts).
//
// While the text changes, the marks move with it; the lines in view are coloured again once the text has rested, a few
// at a time, so that a long script never blocks typing for more than one slice (after the models of the script, which
// the first line explained builds). A line outside the view keeps the marks it had until it comes into view.
import { StateEffect, StateField, type Text } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view';
import type { LineExplanation } from '../src/analyzer';
import { type ColourRun, lineColours } from '../src/ui/lineColours';
import type { TokenRole } from '../src/roles';
import { roleClass } from './editor-colors';

/** The colours of some lines (0-based), worked out from the text the editor has when they are sent. */
const paint = StateEffect.define<readonly { line: number; runs: readonly ColourRun[] }[]>();

const marks = new Map<TokenRole, Decoration>();
const mark = (role: TokenRole) => marks.get(role) ?? marks.set(role, Decoration.mark({ class: roleClass(role) })).get(role)!;

/** The marks of the shell's colours: each painted line's own, replacing what it had, and the others moved with the text. */
export const tokenColourField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(set, tr) {
    let out = tr.docChanged ? set.map(tr.changes) : set;
    for (const e of tr.effects) {
      if (!e.is(paint)) continue;
      for (const { line, runs } of e.value) {
        const l = tr.state.doc.line(line + 1);
        const add = runs.filter((r) => r.to > r.from && l.from + r.to <= l.to).map((r) => mark(r.role).range(l.from + r.from, l.from + r.to));
        out = out.update({ filterFrom: l.from, filterTo: l.to, filter: (from, to) => !(from < l.to && to > l.from), add });
      }
    }
    return out;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** What the colours are made from: the explanations of the text as it is now, and what they depend on besides it. */
export interface ColourSource {
  /** The parse and the settings the explanations are for: lines explained for another are explained again. */
  key: object;
  explain(line: number): LineExplanation;
}

/** How long one slice of the work may take, in ms, before the page gets the main thread back. */
const SLICE = 12;

/** Colours the lines in view from their explanations, a slice at a time. */
export class TokenColours {
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** The lines coloured for `key`. */
  private done = new Set<number>();
  private key: object | undefined;

  constructor(private readonly view: EditorView, private readonly source: () => ColourSource | undefined) {}

  /** Colours the lines in view after `ms` (0: in the next task). */
  schedule(ms: number): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.run(), ms);
  }

  /** Something the colours depend on changed (the shell, the kind of file, a setting): every line is coloured again. */
  stale(): void {
    this.done.clear();
    this.key = undefined;
  }

  /** The lines of the view, those on the screen first, then the rest of what the editor has drawn. */
  private wanted(text: Text): number[] {
    const out: number[] = [];
    const seen = new Set<number>();
    const add = (from: number, to: number) => {
      for (let n = text.lineAt(from).number; n <= text.lineAt(to).number; n++) {
        if (!seen.has(n - 1)) out.push(n - 1);
        seen.add(n - 1);
      }
    };
    for (const r of this.view.visibleRanges) add(r.from, r.to);
    add(this.view.viewport.from, this.view.viewport.to);
    return out.filter((n) => !this.done.has(n));
  }

  /** Colours the lines in view not coloured yet for the text and settings of now. */
  run(): void {
    clearTimeout(this.timer);
    const source = this.source();
    if (!source) return;
    if (source.key !== this.key) {
      this.done.clear();
      this.key = source.key;
    }
    const text = this.view.state.doc;
    const todo = this.wanted(text);
    const slice = () => {
      // (The text changed meanwhile: its change schedules the colours of the new one.)
      if (this.view.state.doc !== text || this.key !== source.key) return;
      const start = performance.now();
      const painted: { line: number; runs: ColourRun[] }[] = [];
      while (todo.length && (!painted.length || performance.now() - start < SLICE)) {
        const line = todo.shift()!;
        const lineText = text.line(line + 1).text;
        painted.push({ line, runs: lineText.trim() ? lineColours(lineText, source.explain(line)) : [] });
        this.done.add(line);
      }
      this.view.dispatch({ effects: paint.of(painted) });
      // (For the measurements of docs/design/one-colour-source.md: each slice, and the end of the work.)
      performance.measure('bx-colours-slice', { start, detail: painted.length });
      if (todo.length) this.timer = setTimeout(slice, 0);
      else performance.mark('bx-colours-done');
    };
    if (todo.length) slice();
  }

  /** The text changed: the marks move with it (the field), and every line will be coloured again. */
  changed(ms: number): void {
    this.done.clear();
    this.schedule(ms);
  }
}
