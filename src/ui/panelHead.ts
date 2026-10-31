import { Lang } from '../i18n';
import { HeaderButton, ViewControl } from './panelView';
import { ui } from './render';

// The panel's header as both hosts draw it (docs/design/chrome-redesign.md, decisions 4 and 11, step C7): the forms of
// the view control, widest first, and the names and icons of its tools. The web page draws the header above the
// panel's frame (web/panel-head.ts); the VS Code panel draws its own (media/panel.js). Both draw the view control with
// one component (media/view-control.js), measure the forms given here and take the first that fits: the rule is this
// data, the hosts only measure.

/** A form of the view control. */
export interface ViewForm {
  /** A button per option side by side, or one button that opens the options as a menu. */
  kind: 'segments' | 'menu';
  /** The label drawn before the segments, where the options need it ("Depth [1 Does] [2]": a digit alone says nothing). */
  label?: string;
  /** The menu's button for each option shown, in the order of the options: its text ("Depth 1", else the short name) and its accessible name. */
  button?: { text: string; name: string }[];
}

/**
 * The forms of the view control, widest first: the segments, then a menu. An option with a digit shows its digit, and
 * its name only when it is the one shown (`Depth [1 Does] [2]`); then the label is drawn before the segments, and the
 * menu's button says the label and the digit ("Depth 1 ⌄"). An option without a digit shows its name. The accessible
 * name of the menu's button says the label and the full name of the option shown.
 */
export function viewControlForms(control: ViewControl): ViewForm[] {
  const digits = control.options.some((o) => o.digit !== undefined);
  const button = control.options.map((o) => ({
    text: o.digit !== undefined ? `${control.label} ${o.digit}` : o.short,
    name: `${control.label}: ${o.digit !== undefined ? `${o.digit} ` : ''}${o.full}`,
  }));
  return [{ kind: 'segments', ...(digits ? { label: control.label } : {}) }, { kind: 'menu', button }];
}

/**
 * A form of the web page's panel header: the view control's form, the tools' words beside their icons or under them,
 * smaller, and the tabs' words in full or short ("Ref", as on a phone: decision 9).
 */
export interface HeaderForm {
  view: ViewForm;
  tools: 'beside' | 'under';
  tabs: 'full' | 'short';
}

/**
 * The forms of the web page's panel header, widest first. The segments are kept longer than the tools' words beside
 * their icons: the words only move under the icons (decision 11), the view would go into a menu. The tabs' short words
 * come last, with the narrowest of the others.
 */
export function panelHeaderForms(control: ViewControl): HeaderForm[] {
  const forms = viewControlForms(control).flatMap((view) => (['beside', 'under'] as const).map((tools) => ({ view, tools, tabs: 'full' as const })));
  return [...forms, { ...forms[forms.length - 1], tabs: 'short' }];
}

/**
 * A tool's button with the short word the web page's header shows beside its icon (or under it). The accessible name
 * (`name`) always contains the word, so that voice control by the visible word finds the button (WCAG 2.5.3, Label in
 * Name; test/panel-head.test.ts checks it).
 */
export interface ToolButton extends HeaderButton { word: string }

/** The panel's tools as both hosts name and draw them: the fold button for each state, the quick reference's, and Copy as Markdown. */
export interface PanelTools {
  /** `fold` while nothing is folded (it folds), `unfold` while something is (it unfolds). */
  toggle: { fold: ToolButton; unfold: ToolButton };
  /**
   * `open` while the quick reference is closed, `close` while it is open (it goes back to the explanation). The tab of
   * the web page's header says `open.word` ("Reference"), `open.short` ("Ref") where the room is short; the VS Code
   * panel draws icons only.
   */
  ref: { open: ToolButton & { short: string }; close: HeaderButton };
  copy: ToolButton;
}

/** The short words of the tools, by language (each is contained in the tool's name in `ui`: panelTools). */
const WORDS: Record<Lang, { collapse: string; expand: string; copy: string; reference: string; referenceShort: string }> = {
  en: { collapse: 'Collapse', expand: 'Expand', copy: 'Copy', reference: 'Reference', referenceShort: 'Ref' },
  ja: { collapse: '折りたたむ', expand: '展開する', copy: 'コピー', reference: '早見表', referenceShort: '早見表' },
};

export function panelTools(lang: Lang): PanelTools {
  const tp = ui[lang].panel;
  const w = WORDS[lang];
  return {
    toggle: { fold: { name: tp.collapseAll, icon: 'collapse-all', word: w.collapse }, unfold: { name: tp.expandAll, icon: 'expand-all', word: w.expand } },
    ref: { open: { name: tp.reference, icon: 'book', word: w.reference, short: w.referenceShort }, close: { name: tp.back, icon: 'arrow-left' } },
    copy: { name: tp.copy, icon: 'copy', word: w.copy },
  };
}
