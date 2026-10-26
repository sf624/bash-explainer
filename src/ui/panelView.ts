import { controlMarks } from '../ctlchars';
import { LineExplanation, Span, Token } from '../analyzer-types';
import { Shell, SHELL_NAMES } from '../dialect';
import { YQ_NAMES } from '../embedded/yq';
import { RerunSpec } from '../examples/rerun';
import { Lang } from '../i18n';
import type { DocumentIssue } from '../document';
import type { NoteLevel } from '../messages';
import { ExamplePlacement, noteRefs, notesByLevel, placeExamples, ui } from './render';
import { reference, referenceLabel } from '../references';
import { readingNodes } from '../reading';
import type { PanelBase } from './themePalette';

// The explanation panel (media/panel.js) as both the extension and the web page drive it.

/** Messages from the panel. */
export type FromPanel =
  | { type: 'ready' }
  | { type: 'highlight'; span: Span | null }
  /** `preserveFocus`: the tree view's keys and clicks select the range without taking the focus from the panel. */
  | { type: 'reveal'; span: Span; preserveFocus?: boolean }
  | { type: 'openSettings' }
  /** `inputs`: the text of each input box, in order. */
  | { type: 'rerun'; id: number; spec: RerunSpec; inputs: string[] }
  | { type: 'copy' }
  | { type: 'override'; key: 'shell' | 'yq'; value: string }
  | { type: 'reference' }
  /** The view and step chosen: the host keeps them for the next visit (VS Code's global state, the web page's storage), builds the tree only in the tree view, and sends them back as `panelState` when the panel starts. */
  | { type: 'panelState'; state: PanelState }
  /** What the panel draws text on, and its own colours, in the theme in use (asked for by `themeWatch`). */
  | { type: 'themeBase'; base: PanelBase };

/**
 * What the panel remembers per viewer: the list or the tree view, and the step of the tree it shows (1–8: the line
 * alone up to every layer). `level` (1–4: the layers) is what it kept before the steps, read when there is no step.
 */
export interface PanelState { view?: 'list' | 'tree'; level?: number; step?: number; /** Prototype B: the depth of the one view (1–2). */ depth?: number; /** Prototype B: whether the program's side is shown. */ who?: boolean; /** Prototype B: whether the examples are drawn open. */ examples?: 'open' | 'closed'; /** Prototype B: the line under the controls hidden. */ captions?: 'hidden'; /** (Round 7) The reserved words of compound commands drawn as rows. */ keywords?: 'shown'; /** (Round 9) The keywords and separators shown, by depth. */ kw?: Record<number, boolean> }

export interface PanelLine {
  lang: Lang;
  explanation: LineExplanation;
  /** Shown in the header with the line number. */
  file: string;
  line: number;
  lineText: string;
  /** The shell and yq chosen for the file ('auto' when not). */
  choice: { shell?: Shell; yq?: string };
  /** The shell the file says, shown next to "auto". */
  detected?: Shell;
  placement: ExamplePlacement;
  /** Whether rows grow and shrink when they are unfolded and folded (`panel.animations`). */
  animations: boolean;
  /** The problems on the line, as the editor underlines them: columns from 0, and the level of each. */
  marks?: { from: number; to: number; level: NoteLevel }[];
  /** (Prototype B) The lines of the blocks around the line (`LineExplanation.context`), with the problems on each. */
  around?: AroundLine[];
  /** The web page's panel, whose links open in a new tab (VS Code opens them in the browser). */
  web?: boolean;
}

/**
 * The references the rows and notes cite (src/references.ts), for their links: the link's text (§3.7.2, execve(2)),
 * the label ("Bash manual 3.7.2"), what it is about and its page.
 */
function manualLinks(lang: Lang, ex: LineExplanation, around: readonly AroundLine[] = []): Record<string, { text: string; label: string; title: string; url: string }> {
  const ids = new Set<string>(ex.notes.flatMap((n) => noteRefs(ex, n) ?? []));
  // (Prototype B: and those of the problems of the lines around, drawn as the line's own.)
  for (const a of around) for (const p of a.problems) for (const id of p.refs) ids.add(id);
  const walk = (t: Token): void => {
    for (const id of t.refs ?? []) ids.add(id);
    t.children.forEach(walk);
  };
  ex.items.forEach(walk);
  // (And those of the tree view: the sections of bash's own reading, where no token says them.)
  for (const n of ex.reading ? readingNodes(ex.reading) : []) for (const id of n.refs ?? []) ids.add(id);
  return Object.fromEntries([...ids].map((id) => {
    const r = reference(id)!;
    return [id, { text: r.text, label: referenceLabel(lang, r), title: r.title, url: r.url }];
  }));
}

/** (Prototype B) A line of a block around the line shown: its text, what the block is, and the problems on it, as the notes of a line are drawn. */
export interface AroundLine { line: number; label: string; text: string; problems: { level: NoteLevel; text: string; label: string; body: string; refs: readonly string[] }[] }

/**
 * (Prototype B) The lines of the blocks around the line shown (the `for` of a loop body), with their problems: each as
 * the note of its line says it (`explainAt`: its level, its heading, its sections), else as the editor does.
 */
export function aroundLines(ex: LineExplanation, issues: readonly DocumentIssue[], textOf: (line: number) => string, explainAt?: (line: number) => LineExplanation): AroundLine[] {
  return ex.context.map((c) => {
    const there = issues.filter((i) => i.startLine === c.line);
    const own = there.length && explainAt ? explainAt(c.line) : undefined;
    return {
      line: c.line, label: c.label, text: textOf(c.line),
      problems: there.map((i) => {
        const n = own && notesByLevel(own).find((x) => x.text === i.message);
        return n ? { level: n.level, text: n.text, label: n.label, body: n.body, refs: noteRefs(own, n.text) ?? [] } : { level: i.severity, text: i.message, label: '', body: i.message, refs: [] };
      }),
    };
  });
}

/** The problems on `line`, as the panel underlines them in its copy of the line (to its end when they go on). */
export function lineMarks(issues: readonly DocumentIssue[], line: number): { from: number; to: number; level: NoteLevel }[] {
  return issues.filter((i) => i.startLine === line && (i.endLine > line || i.endCol > i.startCol))
    .map((i) => ({ from: i.startCol, to: i.endLine === line ? i.endCol : Number.MAX_SAFE_INTEGER, level: i.severity }));
}

/** The message that shows a line's explanation in the panel. */
export function panelUpdate(p: PanelLine) {
  const { lang, explanation: ex } = p;
  const t = ui[lang];
  const tp = t.panel;
  return {
    type: 'update',
    // (The page's language: the web page's panel has none of its own, and the styles follow it, `:lang(ja)`.)
    lang,
    labels: tp,
    // (The control pictures with the name the panel draws for each, and what it stands for: the label of the mark, for a screen reader.)
    controlMarks: controlMarks((ja, en) => (lang === 'ja' ? ja : en)),
    dialect: {
      shells: [['auto', `${tp.auto}${p.detected ? (lang === 'ja' ? `（${SHELL_NAMES[p.detected]}）` : ` (${SHELL_NAMES[p.detected]})`) : ''}`], ...Object.entries(SHELL_NAMES)],
      shell: p.choice.shell ?? 'auto',
      // The yq choice only matters on lines that run yq.
      yqs: ex.notes.some((n) => n.startsWith('yq:')) ? [['auto', tp.auto], ...Object.entries(YQ_NAMES).map(([k, v]) => [k, v[lang === 'ja' ? 0 : 1]])] : undefined,
      yq: p.choice.yq ?? 'auto',
    },
    file: p.file,
    lineLabel: t.line(p.line + 1) + (ex.shell ? ` · ${t.forShell(SHELL_NAMES[ex.shell])}` : ''),
    lineText: p.lineText,
    explanation: p.placement === 'bottom' ? ex : placeExamples(ex),
    manual: manualLinks(lang, ex, p.around),
    // (Said after a link's name, for a screen reader: the links open outside the panel.)
    linkNote: p.web ? tp.opensTab : tp.opensBrowser,
    examplesFirst: p.placement === 'first',
    animations: p.animations,
    contextLabels: ex.context.map((c) => `${c.label} (${t.lineShort(c.line + 1)})`),
    // The notes as drawn: warnings first, each with its level and the word after its mark (src/messages.ts).
    // (Prototype B: and the ranges each is about, so that the panel says it on the row of its word.)
    notes: notesByLevel(ex).map(({ text, level, label, body }) => ({ level, label, body, refs: noteRefs(ex, text) ?? [], spans: ex.anchors?.filter((a) => a.text === text).map((a) => a.span) ?? [] })),
    around: p.around ?? [],
    levelLabels: lang === 'ja' ? { warning: '警告', info: '情報', note: '補足' } : { warning: 'Warning', info: 'Information', note: 'Note' },
    marks: p.marks ?? [],
    emptyMessage: t.empty,
    settingsLabel: t.settings,
  };
}

/**
 * The panel's markup, inside <body> and before its script. The header is a view's title bar, as in VS Code: the
 * line shown, the shell (and yq) dropdown and the view switch (words, both views of the same line), then icon
 * buttons (media/panel.js draws their icons and names them; on the web page the top bar stands in for it). It
 * wraps only between its groups (.here: the line and the shell; the yq dropdown; .actions: the views and the
 * buttons), so a narrow panel's rows do not depend on how wide the words are in the font (media/panel.css).
 */
export const PANEL_BODY = `<div id="top">
<header>
  <div class="here">
    <div class="where"><span id="where"></span><span id="context"></span></div>
    <label id="shell-box" class="pick" hidden><span id="shell-label" class="sr-only"></span><span class="dropdown"><select id="shell"></select><svg class="ico" data-icon="chevron-down" viewBox="0 0 16 16" aria-hidden="true"></svg></span></label>
  </div>
  <label id="yq-box" class="pick" hidden><span id="yq-label" class="sr-only"></span><span class="dropdown"><select id="yq"></select><svg class="ico" data-icon="chevron-down" viewBox="0 0 16 16" aria-hidden="true"></svg></span></label>
  <div class="actions">
    <div id="views" class="segmented" role="group">
      <button id="view-list" type="button" aria-pressed="true"></button><button id="view-tree" type="button" aria-pressed="false"></button>
    </div>
    <div class="tools">
      <button id="toggle" class="tb" type="button"><svg class="ico" data-icon="collapse-all" viewBox="0 0 16 16" aria-hidden="true"></svg></button>
      <button id="copy" class="tb" type="button"><svg class="ico" data-icon="copy" viewBox="0 0 16 16" aria-hidden="true"></svg></button>
      <button id="ref" class="tb" type="button" aria-pressed="false"><svg class="ico" data-icon="book" viewBox="0 0 16 16" aria-hidden="true"></svg></button>
      <button id="settings" class="tb" type="button"><svg class="ico" data-icon="gear" viewBox="0 0 16 16" aria-hidden="true"></svg></button>
    </div>
  </div>
</header>
<pre id="line"></pre>
</div>
<main id="main">
  <div id="layers" role="group" hidden><span id="layers-label"></span></div>
  <div id="depth-caption" aria-live="polite" hidden></div>
  <div id="notes"></div>
  <ul id="tree"></ul>
  <section id="reading" hidden>
    <ul id="reading-tree" role="tree"></ul>
  </section>
  <div id="examples"></div>
  <p id="empty" hidden></p>
</main>
<section id="reference" hidden>
  <input id="ref-search" type="search">
  <div id="ref-list"></div>
</section>`;
