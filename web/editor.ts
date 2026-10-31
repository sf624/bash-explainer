// The script editor (CodeMirror): the shell's colours from our own syntax tree, the host files' modes, the
// problems found in the script, and the few things the page does to the text and the selection.
import { defaultKeymap, history, historyKeymap, indentWithTab, isolateHistory } from '@codemirror/commands';
import { HighlightStyle, StreamLanguage, StreamParser, syntaxHighlighting } from '@codemirror/language';
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile';
import { groovy } from '@codemirror/legacy-modes/mode/groovy';
import { json } from '@codemirror/legacy-modes/mode/javascript';
import { python } from '@codemirror/legacy-modes/mode/python';
import { yaml } from '@codemirror/legacy-modes/mode/yaml';
import { Diagnostic, forEachDiagnostic, forceLinting, linter, lintGutter, setDiagnosticsEffect } from '@codemirror/lint';
import { Compartment, EditorState, Prec, RangeSetBuilder, StateEffect, StateField } from '@codemirror/state';
import { Decoration, DecorationSet, drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import type { LineExplanation, Span } from '../src/analyzer';
import { DocumentIssue, diagnosticsFor, plain, ShellDocument, Shells } from '../src/document';
import { documentHighlight, HighlightKind, HIGHLIGHT_KINDS } from '../src/highlight';
import type { HighlightModifier } from '../src/semanticFacts';
import { Lang } from '../src/i18n';
import { FADED, LEVELS, type ProblemSeverity, problemLevel, SEVERITIES } from '../src/levels';
import type { ProblemSpan } from '../src/ui/problemNav';
import { Settings } from '../src/settings';
import { nameHints, type NameHint } from '../src/ui/nameHints';
import { CLASSIC_COLOURS, kindColour } from './editor-colors';
import { drawIcon, iconMask } from './icons';
import { webHover, WebHover } from './hover';
import { nameHintsExtension, PlacedHint, setHints } from './name-hints';
import { withCode } from './problem-list';
import { Kind } from './samples';
import { TEXT } from './text';
import { setWrapRuns, wordWrap } from './word-wrap';
import { wrapRuns } from '../src/ui/wrapRuns';

// The shell code is coloured from our own syntax tree (src/highlight.ts); these modes colour the rest of a host file.
const MODES: Partial<Record<Kind, StreamParser<unknown>>> = {
  dockerfile: dockerFile, yaml, npm: json, python, jenkinsfile: groovy,
};
// Long lines wrap between shell words, with a hanging indent and ↪ (web/word-wrap.ts).
const wrapFor = (on: boolean) => (on ? wordWrap : []);
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
interface Shading { from: number; to: number; kind: HighlightKind; modifiers?: readonly HighlightModifier[] }

const marks = new Map<string, Decoration>();
/** The mark of a kind, with a class for each modifier (`cm-bx-variable cm-bx-readonly`), as the semantic tokens have them. */
const mark = (s: Shading) => {
  const cls = [`cm-bx-${s.kind}`, ...(s.modifiers ?? []).map((m) => `cm-bx-${m}`)].join(' ');
  return marks.get(cls) ?? marks.set(cls, Decoration.mark({ class: cls })).get(cls)!;
};
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
      for (i = lo; i < this.spans.length && this.spans[i].from < r.to; i++) b.add(this.spans[i].from, this.spans[i].to, mark(this.spans[i]));
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

const shellColours = {
  ...Object.fromEntries(HIGHLIGHT_KINDS.map((k) => [`.cm-bx-${k}`, { color: kindColour(k), ...(k === 'comment' || k === 'shebang' ? { fontStyle: 'italic' } : {}) }])),
  // A readonly variable in bold, an exported one underlined (dotted): the palette keeps the variable's colour.
  '.cm-bx-readonly': { fontWeight: 'bold' },
  '.cm-bx-exported': { textDecoration: 'underline dotted' },
};

/**
 * The problems' levels (docs/design/note-levels.md), as the panel and the Problems list show them: the squiggle, the
 * gutter's icon (the panel's Codicon, media/icons.js) and the tooltip's border in the level's colour (the level table,
 * src/levels.ts; the colour's name is page.css's). CodeMirror draws its squiggle as an image of a fixed colour, so a
 * wavy underline in the colour takes its place; and the gutter's marker, an element it makes, shows the icon as a mask.
 */
const levelStyles = Object.fromEntries(Object.values(SEVERITIES).flatMap(({ level, codemirror }) => {
  const { colour: c, codicon, className } = LEVELS[level];
  if (!c) return [];
  const colour = `var(${c.name})`;
  return [
    [`.cm-lintRange-${codemirror}`, { backgroundImage: 'none', textDecoration: `underline wavy ${colour}`, textDecorationThickness: '1px', textUnderlineOffset: '3px', textDecorationSkipInk: 'none' }],
    [`.cm-lintPoint-${codemirror}`, { '&:after': { borderBottomColor: colour } }],
    [`.cm-lint-marker-${codemirror}`, {
      content: 'normal', backgroundColor: colour,
      maskImage: iconMask(codicon), maskSize: '100% 100%', maskRepeat: 'no-repeat',
      WebkitMaskImage: iconMask(codicon), WebkitMaskSize: '100% 100%', WebkitMaskRepeat: 'no-repeat',
    }],
    [`.cm-diagnostic-${codemirror}`, { borderLeftColor: colour }],
    [`.cm-bx-level.${className}`, { fill: colour }],
  ];
}));

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
  ...levelStyles,
  // Code that never runs (a hint tagged as unnecessary, as in VS Code): faded, with none of the hint's own underline.
  [`.cm-lintRange-${SEVERITIES[FADED].codemirror}.cm-bx-dead`]: { backgroundImage: 'none', opacity: '0.5' },
  '.cm-bx-level': { width: '14px', height: '14px', verticalAlign: '-2px', marginRight: '6px', flex: 'none' },
  '@media (forced-colors: active)': {
    '.cm-lint-marker': { backgroundColor: 'CanvasText', forcedColorAdjust: 'none' },
    '.cm-bx-level': { fill: 'CanvasText' },
    // The active line's tint is gone with forced colours: a frame in the system's highlight shows the cursor's line.
    '.cm-activeLine, .cm-activeLineGutter': { outline: '1px solid Highlight', outlineOffset: '-1px' },
  },
  // A name hint (web/name-hints.ts): muted, on a faint tint, as VS Code draws an inlay hint. Inline, so that it
  // wraps with the line when long lines wrap. Its padding and margin stay at its two ends (the default
  // `box-decoration-break: slice`): Chromium breaks a line without room for the padding that `clone` adds where a hint
  // is cut, so a hint cut at the end of a line ran a few pixels past the editor's edge, at widths that depend on the font.
  '.cm-bx-hint': {
    color: 'var(--vscode-descriptionForeground)', backgroundColor: 'rgba(127, 127, 127, 0.14)', borderRadius: '3px',
    padding: '0 4px', margin: '0 2px 0 4px', fontSize: '90%', cursor: 'pointer', userSelect: 'none',
  },
  '.cm-bx-hint:hover': { color: 'var(--vscode-foreground)' },
  '.cm-bx-hint-tip': {
    padding: '2px 8px', maxWidth: 'min(440px, calc(100vw - 32px))', fontFamily: 'var(--vscode-font-family)', fontSize: 'var(--vscode-font-size)', lineHeight: '1.45',
    '& p': { margin: '4px 0' },
    '& code': { fontFamily: 'var(--vscode-editor-font-family)', backgroundColor: 'var(--vscode-textCodeBlock-background)', padding: '0 3px', borderRadius: '3px' },
  },
  '.cm-bx-hint-open': { color: 'var(--vscode-descriptionForeground)' },
});

/** A problem's message in its tooltip: the level's icon, named for a screen reader, then the text with its code. */
function levelMessage(severity: ProblemSeverity, text: string, lang: Lang): () => Node {
  return () => {
    const level = problemLevel(severity);
    const span = document.createElement('span');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('class', `cm-bx-level ${level.className}`);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', level.name[lang]);
    drawIcon(svg, level.codicon);
    span.append(svg, ...withCode(text));
    return span;
  };
}

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
  /** Explains the lines of the script as it is now (for the name hints); undefined while there is nothing to explain. */
  explainer(): ((line: number) => LineExplanation) | undefined;
  /** The problems found in the script (the ones shown), and the warning codes in it. */
  problems(shown: DocumentIssue[], codes: string[]): void;
  /** The text or the selection changed. */
  changed(u: ViewUpdate): void;
  /** The hover card's link "Settings" (web/hover.ts). */
  openSettings(): void;
  /** Says a short message in the page's live region (web/a11y.ts). */
  announce?(text: string): void;
}

export interface EditorInit {
  parent: HTMLElement;
  text: string;
  /** Read mode (for touch screens): the editor says it takes no text input, so a tap places the cursor without the soft keyboard. */
  readMode: boolean;
  /** Whether the page has its own lint marks, problems and name hints (not in panel mode). */
  problems: boolean;
}

/** The name hints worked out for one parse, by line, with what else they depend on. */
interface HintCache { lang: Lang; shell: string; settings: Settings; lines: Map<number, NameHint[]> }

/** The editor of the page: the CodeMirror view, and what the page does to it. */
export class Editor {
  readonly view: EditorView;
  private readonly languageMode = new Compartment();
  /** Wrapping of long lines (the `editor.wrap` setting). */
  private readonly wrapMode = new Compartment();
  private readonly inputMode = new Compartment();
  /** The text box's name and description (`setLabels`), in the page's language. */
  private readonly labelMode = new Compartment();
  /** The undo history: emptied when a file is opened (openText). */
  private readonly historyMode = new Compartment();
  /** The room a toast takes at the editor's bottom (web/toast.ts): the cursor's line is kept above it. */
  private readonly marginMode = new Compartment();
  private bottomMargin = 0;
  private readonly shadings = new WeakMap<ShellDocument, { shell: string; spans: Shading[] }>();
  /** The runs where long lines must not break (src/ui/wrapRuns.ts), worked out once per parse. */
  private readonly runs = new WeakMap<ShellDocument, Array<readonly [number, number]>>();
  private shadingTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly hintCaches = new WeakMap<ShellDocument, HintCache>();
  private hintTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly withHints: boolean;
  /** The part hover of VS Code (web/hover.ts), where the page has its own problems. */
  private readonly hover: WebHover | undefined;

  constructor(private readonly host: EditorHost, init: EditorInit) {
    this.withHints = init.problems;
    this.hover = init.problems ? webHover(host) : undefined;
    const problems = linter((v): Diagnostic[] => {
      const doc = host.document();
      if (!doc) return [];
      const lang = host.lang();
      const found = diagnosticsFor(() => doc, () => host.shells(), lang, host.settings(), 'web');
      const list = found.shown;
      host.problems(list, [...new Set(found.all.map((i) => i.code))].sort());
      // Code that never runs: a hint, faded (as VS Code fades `DiagnosticTag.Unnecessary`); not in the Problems list.
      const faded: Diagnostic[] = found.faded.map((r) => ({
        from: pos(v.state, r.startLine, r.startCol), to: pos(v.state, r.endLine, r.endCol),
        severity: SEVERITIES[r.severity].codemirror, message: plain(r.message), markClass: 'cm-bx-dead', source: r.code,
      }));
      return [...faded, ...list.map((i): Diagnostic => ({
        from: pos(v.state, i.startLine, i.startCol),
        to: pos(v.state, i.endLine, i.endCol),
        severity: SEVERITIES[i.severity].codemirror,
        message: plain(i.message),
        renderMessage: levelMessage(i.severity, plain(i.message), lang),
        source: i.code,
        actions: i.fix ? [{
          name: i.fix.title[lang === 'ja' ? 0 : 1],
          apply: (view: EditorView) => view.dispatch({ changes: i.fix!.edits.map((e) => ({ from: pos(view.state, e.startLine, e.startCol), to: pos(view.state, e.endLine, e.endCol), insert: e.text })) }),
        }] : undefined,
      }))];
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
          lineNumbers(), highlightActiveLineGutter(), highlightActiveLine(), drawSelection(), this.historyMode.of(history()),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          this.languageMode.of(modeFor(host.kind())), this.inputMode.of(inputModeFor(init.readMode)), this.labelMode.of([]), this.marginMode.of([]), this.wrapMode.of(wrapFor(host.settings()['editor.wrap'])),
          syntaxHighlighting(highlightStyle), editorTheme,
          highlightField, Prec.highest(shading), ...(init.problems ? [problems, lintGutter({ markerFilter: (ds) => ds.filter((d) => d.severity !== SEVERITIES[FADED].codemirror) }), nameHintsExtension(() => TEXT[host.lang()].hintClick), this.hover!.extension] : []),
          EditorView.updateListener.of((u) => {
            host.changed(u);
            if (u.docChanged) {
              clearTimeout(this.shadingTimer);
              this.shadingTimer = setTimeout(() => this.shade(), 100);
            }
            // The hints of the lines in view, after the text has rested (as the problems are checked) or at once on a scroll.
            if (u.docChanged || u.viewportChanged) this.scheduleHints(u.docChanged ? 300 : 50);
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
      return { from: start + s.from, to: start + s.to, kind: s.kind, ...(s.modifiers ? { modifiers: s.modifiers } : {}) };
    });
    this.shadings.set(doc, { shell, spans });
    return spans;
  }

  /** The runs of the whole script, in editor positions, worked out once per parse. */
  private runsOf(): Array<readonly [number, number]> {
    const doc = this.host.document()!;
    const known = this.runs.get(doc);
    if (known) return known;
    const lines = this.view.state.doc;
    const runs = wrapRuns(doc).slice(0, lines.lines).flatMap((line, i) => {
      const start = lines.line(i + 1).from;
      return line.map(([a, b]) => [start + a, start + b] as const);
    });
    this.runs.set(doc, runs);
    return runs;
  }

  /** Colours the script as it is now (the parse is shared with the panel and the problems), and where its long lines may wrap. */
  shade(): void {
    clearTimeout(this.shadingTimer);
    const wrap = this.host.settings()['editor.wrap'];
    this.view.dispatch({ effects: [setShadings.of(this.spansOf()), ...(wrap ? [setWrapRuns.of(this.runsOf())] : [])] });
  }

  /** Checks the script again now (forceLinting alone only hurries a check the text already asked for), and its name hints. */
  recheck(): void {
    this.view.dispatch({ effects: relint.of(null) });
    forceLinting(this.view);
    this.refreshHints();
    // (The hover's keys are bound only while the hover is on.)
    this.hover?.enable(this.view, this.host.settings()['hover.enabled']);
  }

  private scheduleHints(ms: number): void {
    if (!this.withHints) return;
    clearTimeout(this.hintTimer);
    this.hintTimer = setTimeout(() => this.refreshHints(), ms);
  }

  /**
   * Puts the name hints (src/ui/nameHints.ts) on the lines in view, as VS Code asks for its inlay hints, unless
   * `bashExplainer.hints.names` is off. A line is explained once per parse, language, shell and settings.
   */
  refreshHints(): void {
    if (!this.withHints) return;
    clearTimeout(this.hintTimer);
    const settings = this.host.settings();
    const explain = settings['hints.names'] ? this.host.explainer() : undefined;
    const placed: PlacedHint[] = [];
    if (explain) {
      const doc = this.host.document()!;
      const lang = this.host.lang();
      const shells = this.host.shells();
      const shell = `${shells.forced ?? ''}/${shells.detected ?? ''}`;
      let cache = this.hintCaches.get(doc);
      if (!cache || cache.lang !== lang || cache.shell !== shell || cache.settings !== settings) {
        cache = { lang, shell, settings, lines: new Map() };
        this.hintCaches.set(doc, cache);
      }
      const text = this.view.state.doc;
      const seen = new Set<number>();
      for (const r of this.view.visibleRanges) {
        for (let n = text.lineAt(r.from).number; n <= text.lineAt(r.to).number; n++) {
          const line = n - 1;
          if (seen.has(line)) continue;
          seen.add(line);
          const lineText = text.line(n).text;
          let hints = cache.lines.get(line);
          if (!hints) cache.lines.set(line, (hints = lineText.trim() ? nameHints(explain(line), line, lineText, lang) : []));
          for (const h of hints) {
            const at = pos(this.view.state, h.position.line, h.position.character);
            placed.push({ at, back: at - pos(this.view.state, h.tok.span.start.line, h.tok.span.start.character), hint: h });
          }
        }
      }
    }
    this.view.dispatch({ effects: setHints.of(placed.sort((a, b) => a.at - b.at)) });
  }

  /** The file kind changed: its colours. */
  setKind(kind: Kind): void {
    this.view.dispatch({ effects: this.languageMode.reconfigure(modeFor(kind)) });
  }

  setWrap(on: boolean): void {
    this.view.dispatch({ effects: this.wrapMode.reconfigure(wrapFor(on)) });
    if (on) this.view.dispatch({ effects: setWrapRuns.of(this.runsOf()) });
  }

  /** Names the text box for a screen reader (`aria-label`, `aria-describedby`: web/a11y.ts). */
  setLabels(attrs: Record<string, string>): void {
    this.view.dispatch({ effects: this.labelMode.reconfigure(EditorView.contentAttributes.of(attrs)) });
  }

  /**
   * Keeps `px` at the editor's bottom free for the cursor (a toast lies there): CodeMirror's scroll margin, and as much
   * padding under the text, since the scroll cannot go past the end of the text and the last line would stay under the
   * toast. When the cursor's line shows, it is scrolled above the toast.
   */
  setBottomMargin(px: number): void {
    if (px === this.bottomMargin) return;
    this.bottomMargin = px;
    const head = this.view.state.selection.main.head;
    const at = this.view.coordsAtPos(head);
    const box = this.view.scrollDOM.getBoundingClientRect();
    const inView = !!at && at.bottom > box.top && at.top < box.bottom;
    this.view.dispatch({
      effects: [
        this.marginMode.reconfigure(px ? [EditorView.scrollMargins.of(() => ({ bottom: px })), EditorView.theme({ '.cm-content': { paddingBottom: `${px}px` } })] : []),
        ...(inView && px ? [EditorView.scrollIntoView(head, { y: 'nearest' })] : []),
      ],
    });
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

  /**
   * Puts in the text of a file just opened, as a new document: the undo history starts again, so that no undo brings
   * back the text before it, which a save would then write into the file.
   */
  openText(text: string): void {
    this.view.dispatch({ effects: this.historyMode.reconfigure([]) });
    this.view.dispatch({ changes: { from: 0, to: this.view.state.doc.length, insert: text } });
    this.view.dispatch({ effects: this.historyMode.reconfigure(history()) });
    this.placeCursor(1);
  }

  /** Replaces the text as it is (panel mode: not a user edit, no history entry of its own). */
  replaceText(text: string): void {
    if (text !== this.text) this.view.dispatch({ changes: { from: 0, to: this.view.state.doc.length, insert: text } });
  }

  /** Puts the cursor at a line and column (0-based). */
  setCursor(line: number, col: number): void {
    this.view.dispatch({ selection: { anchor: pos(this.view.state, line, col) } });
  }

  /**
   * The problems the editor shows, where they are now: CodeMirror maps its diagnostics through every change until the
   * next check, so a line deleted or added moves them at once (code that never runs is no problem).
   */
  problemSpans(): ProblemSpan[] {
    const doc = this.view.state.doc;
    const spans: ProblemSpan[] = [];
    forEachDiagnostic(this.view.state, (d, from, to) => {
      if (d.severity === SEVERITIES[FADED].codemirror) return;
      const a = doc.lineAt(from);
      const b = doc.lineAt(to);
      spans.push({ startLine: a.number - 1, startCol: from - a.from, endLine: b.number - 1, endCol: to - b.from, code: d.source ?? '' });
    });
    return spans;
  }

  /** Whether an update moved the cursor or the problems (an edit, or a check that gave new ones): `problemSpans` changed. */
  static problemsMoved(u: ViewUpdate): boolean {
    return u.docChanged || u.selectionSet || u.transactions.some((tr) => tr.effects.some((e) => e.is(setDiagnosticsEffect)));
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
