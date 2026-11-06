import { controlMarks } from '../ctlchars';
import { ExplainOptions, LineExplanation, Span, Token } from '../analyzer-types';
import { type AutoShell, Shell, SHELL_NAMES } from '../dialect';
import { autoShellText } from '../messages-shell';
import { YQ_NAMES } from '../embedded/yq';
import { RerunSpec } from '../examples/rerun';
import { Lang } from '../i18n';
import type { DocumentIssue, IssueFilter, ShellDocument } from '../document';
import { LEVELS, problemLevel } from '../levels';
import { ExamplePlacement, lineOwners, noteBasis, noteRefs, notesByLevel, placeExamples } from './render';
import { boxProblems, isListed, problemsAround } from './panelProblems';
import { type Depth, rowModel, wholeLineExamples } from './panelRows';
import { panelTexts, ui } from './texts';
import { reference, referenceLabel } from '../references';
import { readingNodes } from '../reading';
import { lineParts, lineRuns, showsLineBox } from './lineBox';
import { panelTools, viewControlForms } from './panelHead';
import type { PanelBase } from './themePalette';

// The explanation panel (media/panel.js) as both the extension and the web page drive it.

/** Messages from the panel. */
export type FromPanel =
  | { type: 'ready' }
  | { type: 'highlight'; span: Span | null }
  /** `preserveFocus`: the range is selected without taking the focus from the panel. */
  | { type: 'reveal'; span: Span; preserveFocus?: boolean }
  | { type: 'openSettings' }
  /** `inputs`: the text of each input box, in order. */
  | { type: 'rerun'; id: number; spec: RerunSpec; inputs: string[] }
  | { type: 'copy' }
  | { type: 'override'; key: 'shell' | 'yq'; value: string }
  | { type: 'reference' }
  /** What the viewer chose: the host keeps it for the next visit (VS Code's global state, the web page's storage), explains the line with what it needs (`explainNeeds`), and sends it back as `panelState` when the panel starts. */
  | { type: 'panelState'; state: PanelState }
  /** What the panel draws text on, and its own colours, in the theme in use (asked for by `themeWatch`). */
  | { type: 'themeBase'; base: PanelBase }
  /** The state of the header's fold and quick reference buttons (something folded; the quick reference open): the web page's own tools show the same. */
  | { type: 'header'; folded: boolean; reference: boolean };

/** An icon button of the panel's header: its name (tooltip and accessible name) and its icon. */
export interface HeaderButton { name: string; icon: string }

/** What the panel remembers per viewer: how deep it reads the line, and whether it shows what each program receives. */
export interface PanelState { depth?: Depth; receives?: boolean }

/**
 * A state as kept (VS Code's global state, the web page's storage, a message): the depth, and the switch once it was chosen. A version from before
 * the depths kept a view: Reading opens at depth 2, Meaning at depth 1. What is none of them is left out.
 */
export function panelState(kept: unknown): PanelState {
  const s = (kept && typeof kept === 'object' ? kept : {}) as Record<string, unknown>;
  const depth = s.depth === 1 || s.depth === 2 ? s.depth : s.view === 'tree' ? 2 : s.view === 'list' ? 1 : undefined;
  return { ...(depth ? { depth } : {}), ...(typeof s.receives === 'boolean' ? { receives: s.receives } : {}) };
}

/** What the panel asks of an explanation: the options of a state, which both hosts pass (`ExplainOptions`). */
export type ExplainNeeds = Required<Pick<ExplainOptions, 'reading' | 'argv' | 'notPosix'>>;

/** What the explanation needs for the state: the reading tree at depth 2, what each program receives with the switch on, and the marks of what POSIX sh lacks, which show either way. */
export function explainNeeds(state: PanelState): ExplainNeeds {
  const shown = { ...PANEL_DEFAULTS, ...state };
  return { reading: shown.depth === 2, argv: shown.receives, notPosix: true };
}

/** Whether another state needs another explanation. */
export function needsDiffer(a: ExplainNeeds, b: ExplainNeeds): boolean {
  return a.reading !== b.reading || a.argv !== b.argv;
}

/** An option of the view control (docs/design/panel-redesign.md, 6.1). */
export interface ViewOption {
  id: 'depth1' | 'depth2';
  /** An icon drawn before the short name (none yet: the depths are named in words). */
  icon?: string;
  /** The option's digit, drawn before its name; the name only when the option is shown. */
  digit?: string;
  /** The name on the control. */
  short: string;
  /** The tooltip and the accessible name, where it says more than `short`. */
  full: string;
  /** What a screen reader hears when it is chosen. */
  said: string;
  pressed: boolean;
  /** What a press changes in the state: a host applies it without knowing what the option means. */
  sets: PanelState;
}

/** The panel's view control as data: the web page draws its view switch from it, the panel its own header. */
export interface ViewControl {
  /** The control's accessible name. */
  label: string;
  options: ViewOption[];
}

/** What the panel shows when the state does not say: depth 1 (media/panel.js starts so), and what each program receives. */
export const PANEL_DEFAULTS: Required<PanelState> = { depth: 1, receives: true };

/**
 * Whether an option is the one shown: the state, with its defaults, has everything the option `sets`. media/panel.js
 * `pressed` applies the same rule to its own state, so that a press shows at once.
 */
export function isPressed(state: PanelState, sets: PanelState): boolean {
  const shown: PanelState = { ...PANEL_DEFAULTS, ...state };
  return (Object.keys(sets) as (keyof PanelState)[]).every((k) => shown[k] === sets[k]);
}

/** The view control for a state: the depths, the one shown pressed. */
export function viewControl(state: PanelState, lang: Lang, shell?: string): ViewControl {
  const tp = panelTexts(lang, shell);
  const option = (o: Omit<ViewOption, 'pressed'>): ViewOption => ({ ...o, pressed: isPressed(state, o.sets) });
  return {
    label: tp.views,
    options: ([1, 2] as const).map((depth) => option({ id: `depth${depth}`, digit: String(depth), short: tp.depths[depth].short, full: tp.depths[depth].full, said: `${tp.views} ${depth}: ${tp.depths[depth].full}`, sets: { depth } })),
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
  /** The shell the line is explained as when none is chosen, shown next to "auto", and where it comes from (`autoShellAt`). */
  detected?: AutoShell;
  placement: ExamplePlacement;
  /** Whether rows grow and shrink when they are unfolded and folded (`panel.animations`). */
  animations: boolean;
  /** The document's problems: the line's squiggles (`lineMarks`), and the pointers to those on the lines around it (`problemsAround`). */
  issues?: readonly DocumentIssue[];
  /**
   * What the settings, the file's comments and `diagnostics.ignore` let through as a problem (`issueFilter`, src/document.ts): the box of
   * the line's problems keeps the problem notes it lets through, the others stay notes. Without it, all of them are problems.
   */
  shown?: IssueFilter;
  /** The web page's panel, whose links open in a new tab (VS Code opens them in the browser). */
  web?: boolean;
  /** The depth chosen, for the rows and the view control (`viewControl`). */
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
  // (And those of the role lines: the sections of bash's own reading, where no token says them.)
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
  // (The example of the whole line is drawn apart, folded: above the rows where examples come first, else with those at the end.)
  const whole = wholeLineExamples(ex);
  const others = { ...ex, examples: ex.examples.filter((e) => !whole.includes(e)) };
  const { reading: _reading, items, ...explanation } = p.placement === 'bottom' ? others : placeExamples(others);
  const issues = p.issues ?? [];
  const shown = p.shown ?? (() => true);
  // (The rows of the depth chosen, with the switch as it is.)
  const { depth, receives } = { ...PANEL_DEFAULTS, ...p.state };
  const model = rowModel({ ...ex, items }, { depth, receives }, lang);
  const box = boxProblems(ex, model.places, lang, shown);
  return {
    type: 'update',
    // (The page's language: the web page's panel has none of its own, and the styles follow it, `:lang(ja)`.)
    lang,
    labels: tp,
    // (The control pictures with the name the panel draws for each, and what it stands for: the label of the mark, for a screen reader.)
    controlMarks: controlMarks((ja, en) => (lang === 'ja' ? ja : en)),
    dialect: {
      shells: [['auto', autoShellText(lang, 'option', p.detected)], ...Object.entries(SHELL_NAMES)],
      shell: p.choice.shell ?? 'auto',
      // The yq choice only matters on lines that run yq.
      yqs: ex.facts?.some((f) => f.id === 'yq-flavour') ? [['auto', tp.auto], ...Object.entries(YQ_NAMES).map(([k, v]) => [k, v[lang === 'ja' ? 0 : 1]])] : undefined,
      yq: p.choice.yq ?? 'auto',
    },
    file: p.file,
    lineLabel: t.line(p.line + 1) + (ex.shell ? ` · ${t.forShell(SHELL_NAMES[ex.shell])}` : ''),
    lineText: p.lineText,
    lineShown: showsLineBox(p.lineText),
    // (The line box: its text as runs that stay on one row and the blanks between them, when it wraps there; one row has no use for them.)
    lineParts: p.wrap === true ? lineParts(p.lineText, lineRuns(p.doc, p.line, p.lineText)) : undefined,
    wrap: p.wrap === true,
    explanation,
    // (Which rows, in which order, and what each holds: the one row model, src/ui/panelRows.ts.)
    rows: model.rows,
    lineRole: model.line,
    wholeLine: whole,
    // (The line box: each run coloured by the kind of the deepest token, and the row a pointer on it goes to.)
    lineRuns: lineOwners(p.lineText, ex.line, items).map(({ from, to, owner }) => ({ from, to, ...(owner ? { kind: owner.kind, row: model.places.get(owner) } : {}) })),
    // (The look of a warning on a row, from the level table.)
    levels: Object.fromEntries(Object.entries(LEVELS).map(([level, { className, codicon, name }]) => [level, { className, icon: codicon, name: name[lang] }])),
    depth,
    receives,
    // (What the marks of the rows say, and the Legend of what is drawn: src/ui/panelRows.ts.)
    rowMarks: model.marks,
    key: model.key,
    control: viewControl(p.state ?? {}, lang, ex.shell),
    // (The forms the panel's own header may draw the view control in, widest first, and the names and icons of its tools: src/ui/panelHead.ts.)
    viewForms: viewControlForms(viewControl(p.state ?? {}, lang, ex.shell)),
    tools: panelTools(lang),
    manual: manualLinks(lang, ex),
    // (Said after a link's name, for a screen reader: the links open outside the panel.)
    linkNote: p.web ? tp.opensTab : tp.opensBrowser,
    examplesFirst: p.placement === 'first',
    animations: p.animations,
    contextLabels: ex.context.map((c) => `${c.label} (${t.lineShort(c.line + 1)})`),
    // The box "Problems on this line" (src/ui/panelProblems.ts), and the problems of the constructs around it.
    problems: box,
    around: problemsAround(ex, issues, box, lang),
    // The other notes as drawn: each with its level's look (its class, its icon and the icon's name, from the
    // level table, src/levels.ts) and the word after its mark (src/messages.ts), and, where it rests on bash's
    // behaviour rather than the manual, its chip and try-it (`noteBasis`, docs/design/basis.md).
    notes: notesByLevel(ex).filter((n) => !isListed(ex, n, shown)).map(({ text, level, label, body }) => {
      const basis = noteBasis(ex, text, lang);
      const { className, codicon, name } = LEVELS[level];
      // (A note that is no problem is a fact of the catalog, which has its sections.)
      return { level, className, icon: codicon, iconName: name[lang], label, body, refs: noteRefs(ex, text)!, ...(basis ? { basis } : {}) };
    }),
    marks: lineMarks(issues, p.line),
    emptyMessage: t.empty,
    settingsLabel: t.settings,
  };
}

/**
 * The panel's markup, inside <body> and before its script. The header is a view's title bar, as in VS Code: the
 * line shown, the shell (and yq) dropdown and the view control (media/view-control.js), then icon buttons
 * (media/panel.js draws their icons and names them; on the web page the page's panel header stands in for it). It
 * wraps only between its groups (.here: the line and the shell; the yq dropdown; .actions: the views and the
 * buttons), so a narrow panel's rows do not depend on how wide the words are in the font (media/panel.css).
 */
export const PANEL_BODY = `<div id="top">
<p id="said" class="sr-only" aria-live="polite"></p>
<header>
  <div class="here">
    <div class="where"><span id="where"></span><span id="context"></span></div>
    <label id="shell-box" class="pick" hidden><span id="shell-label" class="sr-only"></span><span class="dropdown"><select id="shell"></select><svg class="ico" data-icon="chevron-down" viewBox="0 0 16 16" aria-hidden="true"></svg></span></label>
  </div>
  <label id="yq-box" class="pick" hidden><span id="yq-label" class="sr-only"></span><span class="dropdown"><select id="yq"></select><svg class="ico" data-icon="chevron-down" viewBox="0 0 16 16" aria-hidden="true"></svg></span></label>
  <div class="actions">
    <div id="views"></div>
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
  <div id="view-row" hidden>
    <button id="receives" type="button" role="switch" aria-checked="true"><span class="switch-track" aria-hidden="true"></span><span id="receives-name"></span></button>
    <button id="key-open" type="button" aria-expanded="false" aria-controls="key"></button>
  </div>
  <ul id="key" hidden></ul>
  <p id="short" hidden></p>
  <section id="problems" hidden></section>
  <div id="notes"></div>
  <div id="whole-line"></div>
  <ul id="tree"></ul>
  <div id="line-role"></div>
  <div id="examples"></div>
  <p id="empty" hidden></p>
</main>
<section id="reference" hidden>
  <input id="ref-search" type="search">
  <div id="ref-list"></div>
</section>`;
