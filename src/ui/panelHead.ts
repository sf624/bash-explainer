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

/** The panel's tools as both hosts name and draw them: the fold button for each state, the quick reference's, and Copy as Markdown. */
export interface PanelTools {
  /** `fold` while nothing is folded (it folds), `unfold` while something is (it unfolds). */
  toggle: { fold: HeaderButton; unfold: HeaderButton };
  /** `open` while the quick reference is closed, `close` while it is open (it goes back to the explanation). */
  ref: { open: HeaderButton; close: HeaderButton };
  copy: HeaderButton;
}

export function panelTools(lang: Lang): PanelTools {
  const tp = ui[lang].panel;
  return {
    toggle: { fold: { name: tp.collapseAll, icon: 'collapse-all' }, unfold: { name: tp.expandAll, icon: 'expand-all' } },
    ref: { open: { name: tp.reference, icon: 'book', pressed: false }, close: { name: tp.back, icon: 'arrow-left', pressed: true } },
    copy: { name: tp.copy, icon: 'copy' },
  };
}
