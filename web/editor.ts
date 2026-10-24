// The script editor (CodeMirror): the shell's colours from our own syntax tree, the host files' modes, the
// problems found in the script, and the few things the page does to the text and the selection.
import { defaultKeymap, history, historyKeymap, indentWithTab, isolateHistory } from '@codemirror/commands';
import { HighlightStyle, StreamLanguage, StreamParser, syntaxHighlighting } from '@codemirror/language';
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile';
import { groovy } from '@codemirror/legacy-modes/mode/groovy';
import { json } from '@codemirror/legacy-modes/mode/javascript';
import { python } from '@codemirror/legacy-modes/mode/python';
import { yaml } from '@codemirror/legacy-modes/mode/yaml';
import { Diagnostic, forceLinting, linter, lintGutter } from '@codemirror/lint';
import { Compartment, EditorState, Prec, RangeSetBuilder, StateEffect, StateField } from '@codemirror/state';
import { Decoration, DecorationSet, drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { Span } from '../src/analyzer';
import { DocumentIssue, diagnosticsFor, plain, ShellDocument, Shells } from '../src/document';
import { documentHighlight, HighlightKind, HIGHLIGHT_KINDS } from '../src/highlight';
import { Lang } from '../src/i18n';
import { Settings } from '../src/settings';
import { CLASSIC_COLOURS, kindColour } from './editor-colors';
import { Kind } from './samples';

// The shell code is coloured from our own syntax tree (src/highlight.ts); these modes colour the rest of a host file.
const MODES: Partial<Record<Kind, StreamParser<unknown>>> = {
  dockerfile: dockerFile, yaml, npm: json, python, jenkinsfile: groovy,
};
const wrapFor = (on: boolean) => (on ? EditorView.lineWrapping : []);
const inputModeFor = (on: boolean) => EditorView.contentAttributes.of(on ? { inputmode: 'none' } : {});
const modeFor = (k: Kind) => (MODES[k] ? StreamLanguage.define(MODES[k]!) : []);

/** The part of the line the pointer is on in the panel. */
const setHighlight = StateEffect.define<{ from: number; to: number } | null>();
const highlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(set, tr) {
    for (const e of tr.effects) {
      if (e.is(setHighlight)) return e.value && e.value.to > e.value.from ? Decoration.set([Decoration.mark({ class: 'cm-bx-highlight' }).range(e.value.from, e.value.to)]) : Decoration.none;
    }
    return tr.docChanged ? Decoration.none : set;
  },
  provide: (f) => EditorView.decorations.from(f),
});

// ---- Shell highlighting: from the tree the explanations are made from (src/highlight.ts) ----------

/** A span to colour, in editor positions. */
interface Shading { from: number; to: number; kind: HighlightKind }

const marks = new Map<HighlightKind, Decoration>();
const mark = (k: HighlightKind) => marks.get(k) ?? marks.set(k, Decoration.mark({ class: `cm-bx-${k}` })).get(k)!;
/** New spans for the text the editor has now. */
const setShadings = StateEffect.define<Shading[]>();

/**
 * Marks the visible part of the script with the spans. While the text changes, the marks move with it
 * until the new spans come (debounced, as the panel is), so typing never waits for a parse.
 */
const shading = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  spans: Shading[] = [];
  /** Whether `spans` are positions in the current text. */
  current = false;
  constructor(view: EditorView) {
    this.decorations = this.build(view);
  }
  update(u: ViewUpdate): void {
    const fresh = u.transactions.flatMap((tr) => tr.effects.filter((e) => e.is(setShadings)));
    if (fresh.length) {
      // shade() sends them alone, made from the text of that moment.
      this.spans = fresh[fresh.length - 1].value as Shading[];
      this.current = true;
    } else if (u.docChanged) {
      this.current = false;
    }
    if (this.current && (fresh.length || u.viewportChanged)) this.decorations = this.build(u.view);
    else if (u.docChanged) this.decorations = this.decorations.map(u.changes);
  }
  build(view: EditorView): DecorationSet {
    const b = new RangeSetBuilder<Decoration>();
    let i = 0;
    for (const r of view.visibleRanges) {
      // The first span that ends after the start of the range.
      let lo = i, hi = this.spans.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (this.spans[mid].to <= r.from) lo = mid + 1;
        else hi = mid;
      }
      for (i = lo; i < this.spans.length && this.spans[i].from < r.to; i++) b.add(this.spans[i].from, this.spans[i].to, mark(this.spans[i].kind));
    }
    return b.finish();
  }
}, { decorations: (p) => p.decorations });

// The colours of the panel (editor-colors.ts): the shell's kinds, and the host files' modes (Dockerfile, YAML,
// Makefile, …) by the kind that means the same.
const highlightStyle = HighlightStyle.define([
  { tag: [tags.keyword, tags.controlKeyword], color: kindColour('keyword') },
  { tag: tags.operator, color: kindColour('operator') },
  { tag: [tags.string, tags.special(tags.string)], color: kindColour('string') },
  { tag: tags.comment, color: kindColour('comment'), fontStyle: 'italic' },
  { tag: [tags.variableName, tags.special(tags.variableName), tags.definition(tags.variableName)], color: kindColour('variable') },
  { tag: [tags.number, tags.bool, tags.atom], color: kindColour('number') },
  { tag: [tags.function(tags.variableName), tags.standard(tags.variableName), tags.propertyName, tags.attributeName], color: kindColour('function') },
  { tag: tags.meta, color: CLASSIC_COLOURS.muted },
]);

const shellColours = Object.fromEntries(HIGHLIGHT_KINDS.map((k) => [`.cm-bx-${k}`, { color: kindColour(k), ...(k === 'comment' ? { fontStyle: 'italic' } : {}) }]));

const editorTheme = EditorView.theme({
  '&': { height: '100%', color: 'var(--vscode-editor-foreground)', backgroundColor: 'var(--vscode-editor-background)', fontSize: 'var(--vscode-editor-font-size)' },
  '.cm-scroller': { fontFamily: 'var(--vscode-editor-font-family)', lineHeight: '1.5' },
  '.cm-content': { caretColor: 'var(--vscode-editor-foreground)' },
  '.cm-gutters': { backgroundColor: 'var(--vscode-editor-background)', color: 'var(--vscode-descriptionForeground)', border: 'none' },
  // The active line is drawn over the selection layer, so its colour must let a selection on it show through.
  '.cm-activeLine': { backgroundColor: 'rgba(127, 127, 127, 0.1)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--vscode-list-hoverBackground)' },
  '&.cm-focused .cm-cursor': { borderLeftColor: 'var(--vscode-editor-foreground)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: 'rgba(0, 120, 212, 0.3)' },
  '.cm-bx-highlight': { backgroundColor: 'var(--vscode-editor-findMatchHighlightBackground)', borderRadius: '2px' },
  // The shell's colours: the panel's (editor-colors.ts).
  ...shellColours,
  '.cm-tooltip': { backgroundColor: 'var(--vscode-input-background)', color: 'var(--vscode-foreground)', border: '1px solid var(--vscode-panel-border)' },
});

/** Line and column (0-based) to a position in the editor, clamped to the document. */
export function pos(state: EditorState, line: number, col: number): number {
  const l = state.doc.line(Math.max(1, Math.min(line + 1, state.doc.lines)));
  return Math.min(l.from + Math.max(0, col), l.to);
}

const relint = StateEffect.define<null>();

/** What the editor asks of the page around it. */
export interface EditorHost {
  kind(): Kind;
  lang(): Lang;
  settings(): Settings;
  /** The script as the explainers see it, parsed once per change. */
  document(): ShellDocument | undefined;
  shells(): Shells;
  /** The problems found in the script (the ones shown), and the warning codes in it. */
  problems(shown: DocumentIssue[], codes: string[]): void;
  /** The text or the selection changed. */
  changed(u: ViewUpdate): void;
}

export interface EditorInit {
  parent: HTMLElement;
  text: string;
  /** Read mode (for touch screens): the editor says it takes no text input, so a tap places the cursor without the soft keyboard. */
  readMode: boolean;
  /** Whether the page has its own lint marks and problems (not in panel mode). */
  problems: boolean;
}

/** The editor of the page: the CodeMirror view, and what the page does to it. */
export class Editor {
  readonly view: EditorView;
  private readonly languageMode = new Compartment();
  /** Wrapping of long lines (the `editor.wrap` setting). */
  private readonly wrapMode = new Compartment();
  private readonly inputMode = new Compartment();
  private readonly shadings = new WeakMap<ShellDocument, { shell: string; spans: Shading[] }>();
  private shadingTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly host: EditorHost, init: EditorInit) {
    const problems = linter((v): Diagnostic[] => {
      const doc = host.document();
      if (!doc) return [];
      const lang = host.lang();
      const found = diagnosticsFor(() => doc, () => host.shells(), lang, host.settings(), 'web');
      const list = found.shown;
      host.problems(list, [...new Set(found.all.map((i) => i.code))].sort());
      return list.map((i) => ({
        from: pos(v.state, i.startLine, i.startCol),
        to: pos(v.state, i.endLine, i.endCol),
        severity: i.severity,
        message: plain(i.message),
        source: i.code,
        actions: i.fix ? [{
          name: i.fix.title[lang === 'ja' ? 0 : 1],
          apply: (view: EditorView) => view.dispatch({ changes: i.fix!.edits.map((e) => ({ from: pos(view.state, e.startLine, e.startCol), to: pos(view.state, e.endLine, e.endCol), insert: e.text })) }),
        }] : undefined,
      }));
    }, {
      delay: 300,
      // The problems depend on the shell and the language too, not only on the text.
      needsRefresh: (u) => u.transactions.some((tr) => tr.effects.some((e) => e.is(relint))),
    });
    this.view = new EditorView({
      parent: init.parent,
      state: EditorState.create({
        doc: init.text,
        selection: { anchor: 0 },
        extensions: [
          lineNumbers(), highlightActiveLineGutter(), highlightActiveLine(), drawSelection(), history(),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          this.languageMode.of(modeFor(host.kind())), this.inputMode.of(inputModeFor(init.readMode)), this.wrapMode.of(wrapFor(host.settings()['editor.wrap'])),
          syntaxHighlighting(highlightStyle), editorTheme,
          highlightField, Prec.highest(shading), ...(init.problems ? [problems, lintGutter()] : []),
          EditorView.updateListener.of((u) => {
            host.changed(u);
            if (u.docChanged) {
              clearTimeout(this.shadingTimer);
              this.shadingTimer = setTimeout(() => this.shade(), 100);
            }
          }),
        ],
      }),
    });
  }

  get text(): string {
    return this.view.state.doc.toString();
  }

  /** The spans of the whole script, worked out once per parse. */
  private spansOf(): Shading[] {
    const doc = this.host.document()!;
    // (What a command name runs depends on the shell too.)
    const shells = this.host.shells();
    const shell = `${shells.forced ?? ''}/${shells.detected ?? ''}`;
    const known = this.shadings.get(doc);
    if (known?.shell === shell) return known.spans;
    const lines = this.view.state.doc;
    const spans = documentHighlight(doc, { shells }).map((s) => {
      const start = lines.line(s.line + 1).from;
      return { from: start + s.from, to: start + s.to, kind: s.kind };
    });
    this.shadings.set(doc, { shell, spans });
    return spans;
  }

  /** Colours the script as it is now (the parse is shared with the panel and the problems). */
  shade(): void {
    clearTimeout(this.shadingTimer);
    this.view.dispatch({ effects: setShadings.of(this.spansOf()) });
  }

  /** Checks the script again now (forceLinting alone only hurries a check the text already asked for). */
  recheck(): void {
    this.view.dispatch({ effects: relint.of(null) });
    forceLinting(this.view);
  }

  /** The file kind changed: its colours. */
  setKind(kind: Kind): void {
    this.view.dispatch({ effects: this.languageMode.reconfigure(modeFor(kind)) });
  }

  setWrap(on: boolean): void {
    this.view.dispatch({ effects: this.wrapMode.reconfigure(wrapFor(on)) });
  }

  setReadMode(on: boolean): void {
    this.view.dispatch({ effects: this.inputMode.reconfigure(inputModeFor(on)) });
  }

  placeCursor(lineNumber: number): void {
    const line = this.view.state.doc.line(Math.min(lineNumber, this.view.state.doc.lines));
    this.view.dispatch({ selection: { anchor: line.from }, scrollIntoView: true });
  }

  setText(text: string, cursorLine: number): void {
    // On its own in the history, so that one undo takes back the replacement and nothing typed just before it.
    this.view.dispatch({ changes: { from: 0, to: this.view.state.doc.length, insert: text }, annotations: isolateHistory.of('full') });
    this.placeCursor(cursorLine);
  }

  /** Replaces the text as it is (panel mode: not a user edit, no history entry of its own). */
  replaceText(text: string): void {
    if (text !== this.text) this.view.dispatch({ changes: { from: 0, to: this.view.state.doc.length, insert: text } });
  }

  /** Puts the cursor at a line and column (0-based). */
  setCursor(line: number, col: number): void {
    this.view.dispatch({ selection: { anchor: pos(this.view.state, line, col) } });
  }

  /** The cursor, as a 0-based line and column. */
  cursor(): { line: number; col: number } {
    const head = this.view.state.selection.main.head;
    const l = this.view.state.doc.lineAt(head);
    return { line: l.number - 1, col: head - l.from };
  }

  /** The line (0-based) the cursor is on. */
  cursorLine(): number {
    return this.view.state.doc.lineAt(this.view.state.selection.main.head).number - 1;
  }

  /** Selects a range given as lines and columns, bringing it into view. */
  select(startLine: number, startCol: number, endLine: number, endCol: number): void {
    this.view.dispatch({ selection: { anchor: pos(this.view.state, startLine, startCol), head: pos(this.view.state, endLine, endCol) }, scrollIntoView: true });
    this.focusUnlessTouch();
  }

  /** Focusing the editor opens the soft keyboard on a phone: do it only with a mouse or a pen. */
  focusUnlessTouch(): void {
    if (window.matchMedia('(pointer: fine)').matches) this.view.focus();
  }

  private spanRange(span: Span): { from: number; to: number } {
    return { from: pos(this.view.state, span.start.line, span.start.character), to: pos(this.view.state, span.end.line, span.end.character) };
  }

  /** Selects a span of the panel's explanation; `preserveFocus` leaves the focus where it is (in the panel's tree). */
  selectSpan(span: Span, preserveFocus = false): void {
    const r = this.spanRange(span);
    // Bring the start of the token into view, and move sideways only as far as that needs (the
    // end of a long span, as `scrollIntoView` does, could hide the start of every line).
    this.view.dispatch({ selection: { anchor: r.from, head: r.to }, effects: EditorView.scrollIntoView(r.from, { x: 'nearest', y: 'nearest', xMargin: 40 }) });
    if (!preserveFocus) this.focusUnlessTouch();
  }

  /** Marks the part of the line the pointer is on in the panel (null: none). */
  highlight(span: Span | null): void {
    this.view.dispatch({ effects: setHighlight.of(span ? this.spanRange(span) : null) });
  }

  /** The cursor's line stays in view when the editor's pane changes size (the phone turned, the divider moved). */
  keepCursorInView(): void {
    this.view.dispatch({ effects: EditorView.scrollIntoView(this.view.state.selection.main.head, { y: 'center' }) });
  }
}
