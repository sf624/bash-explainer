import { LEVELS, type NoteLevel } from '../levels';

/**
 * The colours of the parts of a line (the roles), where VS Code's chart colours are not readable as text.
 *
 * The panel, the hover and the web page colour each part with one of six roles. They take VS Code's chart
 * colours (`--vscode-charts-*`), which are made for charts, not text: in the light themes they fall below
 * WCAG's 4.5:1 for text (charts.orange is 2.94:1 on white), and in the dark ones charts.red falls below it on a
 * code block. Where they do, a theme kind has its own colours here; media/panel.css (`body.vscode-*`) and
 * web/theme.css hold the same values, and test/contrast.test.ts compares them and measures their contrast.
 */

/** A colour role: the colours of web/editor-colors.ts (CLASSIC_COLOURS), but the muted one. */
export type Role = 'command' | 'option' | 'argument' | 'operator' | 'redirect' | 'variable';

/** The kind of the active colour theme, as VS Code's `ColorThemeKind` gives it. */
export type ThemeKind = 'light' | 'dark' | 'highContrast' | 'highContrastLight';

/** The chart colour each role takes from the theme. */
export const CHART_VARIABLE: Record<Role, string> = {
  command: '--vscode-charts-blue',
  option: '--vscode-charts-orange',
  argument: '--vscode-charts-green',
  operator: '--vscode-charts-purple',
  redirect: '--vscode-charts-yellow',
  variable: '--vscode-charts-red',
};

/**
 * The colours that replace the theme's chart colours, by theme kind. Light: each chart colour darkened (in OKLCH,
 * keeping its hue near) to at least 4.5:1 on white, #f8f8f8 and #f2f2f2 (code blocks, a hovered row, the active
 * line); yellow and purple a little darker too, so that no two roles come closer than before. Dark: only red, which
 * is 3.96:1 on a code block (#2b2b2b). High contrast: at least 7:1 on black or white and on a code block.
 */
export const THEME_COLOURS: Record<ThemeKind, Partial<Record<Role, string>>> = {
  light: { command: '#0161f8', option: '#9f5c00', argument: '#1f7c2b', operator: '#5f2489', redirect: '#645000', variable: '#d0020f' },
  dark: { variable: '#ff5c65' },
  highContrast: { command: '#6badff', option: '#f69d3d', argument: '#89d185', operator: '#c796ee', redirect: '#efd62f', variable: '#ff888e' },
  highContrastLight: { command: '#0148bc', option: '#794402', argument: '#015f15', operator: '#5f2489', redirect: '#453e01', variable: '#a20222' },
};

/**
 * The colour of an error (a part that cannot be read), where the theme's `errorForeground` has too little contrast as text:
 * Light Modern's #e51400 is 4.23:1 on a code block, Dark Modern's #f85149 4.22:1. In high contrast, the theme's.
 */
export const ERROR_COLOURS: Partial<Record<ThemeKind, string>> = { light: '#d0020f', dark: '#fd6358' };

/** The CSS colour of an error in a theme kind. */
export function errorColour(theme: ThemeKind): string {
  return ERROR_COLOURS[theme] ?? 'var(--vscode-errorForeground)';
}

/** The CSS colour of a role in a theme kind: its own colour, or the theme's chart colour. */
export function roleColour(role: Role, theme: ThemeKind): string {
  return THEME_COLOURS[theme][role] ?? `var(${CHART_VARIABLE[role]})`;
}

/**
 * The CSS colour of a level in a theme kind (src/levels.ts): the editor's, or ours where it is not readable as text; a
 * plain note's is the muted one.
 */
export function levelColour(level: NoteLevel, theme: ThemeKind): string {
  const c = LEVELS[level].colour;
  return c ? c.ours[theme] ?? `var(${c.variable})` : 'var(--vscode-descriptionForeground)';
}
