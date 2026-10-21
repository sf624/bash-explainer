import { LineExplanation, Span } from '../analyzer';
import { Shell, SHELL_NAMES } from '../dialect';
import { YQ_NAMES } from '../embedded/yq';
import { RerunSpec } from '../examples/rerun';
import { Lang } from '../i18n';
import { ExamplePlacement, placeExamples, ui } from './render';

// The explanation panel (media/panel.js) as both the extension and the web page drive it.

/** Messages from the panel. */
export type FromPanel =
  | { type: 'ready' }
  | { type: 'highlight'; span: Span | null }
  | { type: 'reveal'; span: Span }
  | { type: 'openSettings' }
  | { type: 'rerun'; id: number; spec: RerunSpec; input: string }
  | { type: 'copy' }
  | { type: 'override'; key: 'shell' | 'yq'; value: string }
  | { type: 'reference' };

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
  /** The palette of the token kinds (media/panel.css). */
  colors: 'vscode' | 'classic';
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
    examplesFirst: p.placement === 'first',
    contextLabels: ex.context.map((c) => `${c.label} (${t.lineShort(c.line + 1)})`),
    colors: p.colors,
    emptyMessage: t.empty,
    settingsLabel: t.settings,
  };
}

/** The panel's markup, inside <body> and before its script. */
export const PANEL_BODY = `<header>
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
<main id="main">
  <pre id="line"></pre>
  <div id="notes"></div>
  <ul id="tree"></ul>
  <div id="examples"></div>
  <p id="empty" hidden></p>
</main>
<section id="reference" hidden>
  <input id="ref-search" type="search">
  <div id="ref-list"></div>
</section>`;
