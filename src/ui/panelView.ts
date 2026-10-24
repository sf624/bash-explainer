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
  /** The view and step chosen: the host keeps them for the next visit (VS Code's global state, the web page's storage), builds the tree only in the tree view, and sends them back as `panelState` when the panel starts. */
  | { type: 'panelState'; state: PanelState };

/**
 * What the panel remembers per viewer: the list or the tree view, and the step of the tree it shows (1–8: the line
 * alone up to every layer). `level` (1–4: the layers) is what it kept before the steps, read when there is no step.
 */
export interface PanelState { view?: 'list' | 'tree'; level?: number; step?: number }

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
    // (The page's language: the web page's panel has none of its own, and the styles follow it, `:lang(ja)`.)
    lang,
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
    animations: p.animations,
    contextLabels: ex.context.map((c) => `${c.label} (${t.lineShort(c.line + 1)})`),
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
