import { LineExplanation, Span, Token } from '../analyzer-types';
import { Shell, SHELL_NAMES } from '../dialect';
import { YQ_NAMES } from '../embedded/yq';
import { RerunSpec } from '../examples/rerun';
import { Lang } from '../i18n';
import { ExamplePlacement, noteRefs, placeExamples, ui } from './render';
import { manualLabel, SECTIONS } from '../manual';
import { readingNodes } from '../reading';

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
  /** The view and layers chosen: the host keeps them for the next visit (VS Code's global state, the web page's storage), builds the tree only in the tree view, and sends them back as `panelState` when the panel starts. */
  | { type: 'panelState'; state: PanelState };

/** What the panel remembers per viewer: the list or the tree view, and how many layers of the tree it shows (1–4). */
export interface PanelState { view?: 'list' | 'tree'; level?: number }

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
}

/**
 * The sections of the manual the rows and notes cite, for their links: the label ("Bash manual 3.7.2"), the
 * section's title and its page.
 */
function manualLinks(lang: Lang, ex: LineExplanation): Record<string, { label: string; title: string; url: string }> {
  const ids = new Set<string>(ex.notes.flatMap((n) => noteRefs(ex, n) ?? []));
  const walk = (t: Token): void => {
    for (const id of t.refs ?? []) ids.add(id);
    t.children.forEach(walk);
  };
  ex.items.forEach(walk);
  // (And those of the tree view: the sections of bash's own reading, where no token says them.)
  for (const n of ex.reading ? readingNodes(ex.reading) : []) for (const id of n.refs ?? []) ids.add(id);
  return Object.fromEntries([...ids].map((id) => [id, { label: manualLabel(lang, [id]), title: SECTIONS.get(id)!.title, url: SECTIONS.get(id)!.url }]));
}

/** The message that shows a line's explanation in the panel. */
export function panelUpdate(p: PanelLine) {
  const { lang, explanation: ex } = p;
  const t = ui[lang];
  const tp = t.panel;
  return {
    type: 'update',
    labels: tp,
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
    manual: manualLinks(lang, ex),
    examplesFirst: p.placement === 'first',
    contextLabels: ex.context.map((c) => `${c.label} (${t.lineShort(c.line + 1)})`),
    emptyMessage: t.empty,
    settingsLabel: t.settings,
  };
}

/** The panel's markup, inside <body> and before its script. */
export const PANEL_BODY = `<div id="top">
<header>
  <div class="where"><span id="where"></span><span id="context"></span></div>
  <div class="tools">
    <label id="shell-box" hidden><span id="shell-label"></span> <select id="shell"></select></label>
    <label id="yq-box" hidden><span id="yq-label"></span> <select id="yq"></select></label>
    <button id="toggle" type="button"></button>
    <button id="copy" type="button"></button>
    <button id="ref" type="button"></button>
    <button id="settings" type="button"></button>
  </div>
</header>
<pre id="line"></pre>
</div>
<main id="main">
  <div id="views" role="group">
    <button id="view-list" type="button" aria-pressed="true"></button><button id="view-tree" type="button" aria-pressed="false"></button>
  </div>
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
