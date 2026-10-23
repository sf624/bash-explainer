// The colours of the web page's editor: the explanation panel's own palette, one colour for each kind of part,
// so that a word has the same colour in the editor and in the explanation.
//
// Planned for a later release: colours that follow the editor's theme, as VS Code's shell grammar and the
// active theme's `tokenColors` give them (in VS Code, the panel would read the theme; on the web page, the
// 2026 default themes). Release 0.7.0 ships only this palette.
import type { Kind } from '../src/analyzer';
import type { HighlightKind } from '../src/highlight';

/** The colour roles: the highlight kinds, and `argument` (a plain word after the command, which the panel colours but the editor has no kind for). */
export type ColourRole = HighlightKind | 'argument';

/**
 * The colour role of each kind of the explanation panel (media/panel.css, `.kind-*`), which takes the
 * colour of the role. subcommand, expansion (`{a,b}`, arrays, `?:`), test (`[ … ]`'s whole expression) and
 * block (groups, loop bodies) take the colour of a command, a variable and an operator.
 */
export const PANEL_KIND_ROLE: Record<Kind, ColourRole> = {
  command: 'command', subcommand: 'command', builtin: 'builtin', function: 'function', keyword: 'keyword', option: 'option',
  argument: 'argument', operator: 'operator', redirect: 'redirect', variable: 'variable', expansion: 'variable', substitution: 'substitution',
  string: 'string', number: 'number', comment: 'comment', assignment: 'assignment', test: 'operator', pattern: 'glob', block: 'operator', error: 'error',
};

/**
 * The palette: VS Code's chart colours (the values of `--c-*` in media/panel.css; a test compares them). The
 * editor uses it with the roles below; plain arguments, which the editor has no kind for, stay in the foreground there.
 */
export const CLASSIC_COLOURS = {
  command: 'var(--vscode-charts-blue, #3794ff)',
  option: 'var(--vscode-charts-orange, #d18616)',
  argument: 'var(--vscode-charts-green, #89d185)',
  operator: 'var(--vscode-charts-purple, #b180d7)',
  redirect: 'var(--vscode-charts-yellow, #cca700)',
  variable: 'var(--vscode-charts-red, #ff5c65)',
  muted: 'var(--vscode-descriptionForeground, #888)',
} as const;

/** The colour each role takes (the panel's `.kind-*` classes, by way of PANEL_KIND_ROLE). */
export const CLASSIC_ROLE: Record<ColourRole, keyof typeof CLASSIC_COLOURS> = {
  comment: 'muted', keyword: 'operator', builtin: 'command', command: 'command', function: 'command', functionName: 'command', option: 'option',
  argument: 'argument', string: 'argument', heredoc: 'argument', heredocDelimiter: 'argument', variable: 'variable', assignment: 'variable',
  substitution: 'variable', number: 'argument', operator: 'operator', redirect: 'redirect', glob: 'redirect', error: 'variable',
};

/** The CSS colour of a kind in the editor. */
export function kindColour(kind: HighlightKind): string {
  return kind === 'error' ? 'var(--vscode-errorForeground)' : CLASSIC_COLOURS[CLASSIC_ROLE[kind]];
}
