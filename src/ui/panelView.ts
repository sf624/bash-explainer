import { controlMarks } from '../ctlchars';
import { LineExplanation, Span, Token } from '../analyzer-types';
import { Shell, SHELL_NAMES } from '../dialect';
import { YQ_NAMES } from '../embedded/yq';
import { RerunSpec } from '../examples/rerun';
import { Lang } from '../i18n';
import type { DocumentIssue, ShellDocument } from '../document';
import { LEVELS, problemLevel } from '../levels';
import { ExamplePlacement, noteBasis, noteRefs, notesByLevel, placeExamples, ui, withBasisShown } from './render';
import { reference, referenceLabel } from '../references';
import { readingNodes } from '../reading';
import { levelOf, readingView, StepName, stepNames, STEPS } from './readingSteps';
import { lineParts, lineRuns } from './lineBox';
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
  | { type: 'themeBase'; base: PanelBase }
  /** The header's fold and quick reference buttons as the panel draws them now: the web page's own buttons show the same. */
  | { type: 'header'; buttons: Record<'toggle' | 'ref', HeaderButton> };

/** An icon button of the panel's header: its name (tooltip and accessible name), its icon, and whether it is pressed. */
export interface HeaderButton { name: string; icon: string; pressed?: boolean }

/**
 * What the panel remembers per viewer: the list or the tree view, and the step of the tree it shows (1–8: the line
 * alone up to every layer). `level` (1–4: the layers) is what it kept before the steps, read when there is no step.
 */
export interface PanelState { view?: 'list' | 'tree'; level?: number; step?: number }

/**
 * A state as kept (VS Code's global state, the web page's storage, a message): the view, the step (from `level`
 * when there is none), and `level` for a version from before the steps. What is not one of them is left out.
 */
export function panelState(kept: unknown): PanelState {
  const s = (kept && typeof kept === 'object' ? kept : {}) as Record<string, unknown>;
  const view = s.view === 'tree' || s.view === 'list' ? s.view : undefined;
  const valid = (n: unknown, max: number): n is number => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= max;
  const step = valid(s.step, STEPS) ? s.step : valid(s.level, 4) ? s.level + 4 : undefined;
  return { ...(view ? { view } : {}), ...(step ? { step, level: levelOf(step) } : {}) };
}

/** Whether the explanation needs the reading tree for the state: the hosts build it only then (the tree view). */
export function needsReading(state: PanelState): boolean {
  return state.view === 'tree';
}

/** An option of the view control (docs/design/panel-redesign.md, 6.1). */
export interface ViewOption {
  id: 'list' | 'tree';
  /** An icon drawn before the short name (none yet: the views are named in words). */
  icon?: string;
  /** The name on the control. */
  short: string;
  /** The tooltip and the accessible name, where it says more than `short`. */
  full: string;
  pressed: boolean;
  /** What a press changes in the state: a host applies it without knowing what the option means. */
  sets: PanelState;
  /** The steps the option has: Reading's eight, drawn in the panel's own row. */
  steps?: StepName[];
}

/** The panel's view control as data: the web page draws its view switch from it, the panel its own header. */
export interface ViewControl {
  /** The control's accessible name. */
  label: string;
  options: ViewOption[];
}

/** What the panel shows when the state does not say: the list view, at the last step (media/panel.js starts so). */
export const PANEL_DEFAULTS: Required<Pick<PanelState, 'view' | 'step'>> = { view: 'list', step: STEPS };

/**
 * Whether an option is the one shown: the state, with its defaults, has everything the option `sets`. media/panel.js
 * `pressed` applies the same rule to its own state, so that a press shows at once.
 */
export function isPressed(state: PanelState, sets: PanelState): boolean {
  const shown: PanelState = { ...PANEL_DEFAULTS, ...state };
  return (Object.keys(sets) as (keyof PanelState)[]).every((k) => shown[k] === sets[k]);
}

/** The view control for a state: Meaning | Reading, the one shown pressed. */
export function viewControl(state: PanelState, lang: Lang): ViewControl {
  const tp = ui[lang].panel;
  const option = (o: Omit<ViewOption, 'pressed'>): ViewOption => ({ ...o, pressed: isPressed(state, o.sets) });
  return {
    label: tp.views,
    options: [
      option({ id: 'list', short: tp.listView, full: tp.listView, sets: { view: 'list' } }),
      option({ id: 'tree', short: tp.treeView, full: tp.treeView, sets: { view: 'tree' }, steps: stepNames(lang) }),
    ],
  };
}

export interface PanelLine {
  lang: Lang;
  explanation: LineExplanation;
  /** Shown in the header with the line number. */
  file: string;
  line: number;
  lineText: string;
  /** The document the line is of: where the line box may wrap comes from its syntax tree (src/ui/lineBox.ts). */
  doc?: ShellDocument;
  /** Whether the line box wraps a long line (the web page's `editor.wrap`, VS Code's `editor.wordWrap`), or scrolls sideways. */
  wrap?: boolean;
  /** The shell and yq chosen for the file ('auto' when not). */
  choice: { shell?: Shell; yq?: string };
  /** The shell the file says, shown next to "auto". */
  detected?: Shell;
  placement: ExamplePlacement;
  /** Whether rows grow and shrink when they are unfolded and folded (`panel.animations`). */
  animations: boolean;
  /** The problems on the line, as the editor underlines them (`lineMarks`). */
  marks?: LineMark[];
  /** The web page's panel, whose links open in a new tab (VS Code opens them in the browser). */
  web?: boolean;
  /** The view and step chosen, for the view control (`viewControl`). */
  state?: PanelState;
}

/**
 * The references the rows and notes cite (src/references.ts), for their links: the link's text (§3.7.2, execve(2)),
 * the label ("Bash manual 3.7.2"), what it is about and its page.
 */
function manualLinks(lang: Lang, ex: LineExplanation): Record<string, { text: string; label: string; title: string; url: string }> {
  const ids = new Set<string>(ex.notes.flatMap((n) => noteRefs(ex, n) ?? []));
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

/**
 * A problem on the line, as the panel underlines it: columns from 0, the class of its level's squiggle, and its level's
 * rank (where two overlap, the lower wins), from the level table (src/levels.ts).
 */
export interface LineMark { from: number; to: number; className: string; rank: number }

/** The problems on `line`, as the panel underlines them in its copy of the line (to its end when they go on). */
export function lineMarks(issues: readonly DocumentIssue[], line: number): LineMark[] {
  return issues.filter((i) => i.startLine === line && (i.endLine > line || i.endCol > i.startCol)).map((i) => {
    const { className, rank } = problemLevel(i.severity);
    return { from: i.startCol, to: i.endLine === line ? i.endCol : Number.MAX_SAFE_INTEGER, className, rank };
  });
}

/** The message that shows a line's explanation in the panel. */
export function panelUpdate(p: PanelLine) {
  const { lang, explanation: ex } = p;
  const t = ui[lang];
  const tp = t.panel;
  // (Each row and node of Reading with the chip and try-it of what it rests on, in the panel's language.)
  const shown = withBasisShown(p.placement === 'bottom' ? ex : placeExamples(ex), lang);
  const { reading, ...explanation } = shown;
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
    // (The line box: its text as runs that stay on one row and the blanks between them, when it wraps there; one row has no use for them.)
    lineParts: p.wrap === true ? lineParts(p.lineText, lineRuns(p.doc, p.line, p.lineText)) : undefined,
    wrap: p.wrap === true,
    explanation,
    // (Reading's tree, with what each node and each step shows: src/ui/readingSteps.ts.)
    reading: reading && readingView(reading, lang),
    control: viewControl(p.state ?? {}, lang),
    manual: manualLinks(lang, ex),
    // (Said after a link's name, for a screen reader: the links open outside the panel.)
    linkNote: p.web ? tp.opensTab : tp.opensBrowser,
    examplesFirst: p.placement === 'first',
    animations: p.animations,
    contextLabels: ex.context.map((c) => `${c.label} (${t.lineShort(c.line + 1)})`),
    // The notes as drawn: warnings first, each with its level's look (its class, its icon and the icon's name, from the
    // level table, src/levels.ts) and the word after its mark (src/messages.ts), and, where it rests on bash's
    // behaviour rather than the manual, its chip and try-it (`noteBasis`, docs/design/basis.md).
    notes: notesByLevel(ex).map(({ text, level, label, body }) => {
      const basis = noteBasis(ex, text, lang);
      const { className, codicon, name } = LEVELS[level];
      return { level, className, icon: codicon, iconName: name[lang], label, body, refs: noteRefs(ex, text) ?? [], ...(basis ? { basis } : {}) };
    }),
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
    <div id="views" class="segmented" role="group"></div>
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
  <div id="notes"></div>
  <ul id="tree"></ul>
  <section id="reading" hidden>
    <div id="layers" role="group"><span id="layers-label"></span></div>
    <ul id="reading-tree" role="tree"></ul>
  </section>
  <div id="examples"></div>
  <p id="empty" hidden></p>
</main>
<section id="reference" hidden>
  <input id="ref-search" type="search">
  <div id="ref-list"></div>
</section>`;
