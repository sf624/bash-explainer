// The colours of the web page's editor: the explanation panel's own, one colour for each role of a token
// (src/roles.ts), so that a part has the same colour in the editor and in the explanation
// (docs/design/one-colour-source.md). The editor's shell code is coloured from the explanation's tokens
// (web/token-colours.ts); the host files' own modes (Dockerfile, YAML…) take the role that means the same.
import { ROLES, type TokenRole } from '../src/roles';

/** VS Code's chart colours, as media/panel.css gives them to the roles (the values of its `--c-*` on body). */
const CHART = {
  blue: 'var(--vscode-charts-blue, #3794ff)',
  orange: 'var(--vscode-charts-orange, #d18616)',
  green: 'var(--vscode-charts-green, #89d185)',
  purple: 'var(--vscode-charts-purple, #b180d7)',
  yellow: 'var(--vscode-charts-yellow, #cca700)',
  red: 'var(--vscode-charts-red, #ff5c65)',
  muted: 'var(--vscode-descriptionForeground, #888)',
} as const;

/**
 * The CSS colour of each role: the colour media/panel.css gives its `.kind-*` rules, through the variables of body
 * (test/editorColours.test.ts compares them). On the web page, the panel's frame has no theme kind's class, so these
 * are the colours it shows.
 */
export const ROLE_COLOURS: Readonly<Record<TokenRole, string>> = {
  command: CHART.blue, builtin: CHART.blue, shebang: CHART.blue,
  option: CHART.orange,
  argument: CHART.green, string: CHART.green, number: CHART.green,
  keyword: CHART.purple, operator: CHART.purple,
  redirect: CHART.yellow, pattern: CHART.yellow,
  variable: CHART.red, assignment: CHART.red,
  comment: CHART.muted,
  error: 'var(--vscode-editorError-foreground, var(--vscode-charts-red, #f14c4c))',
};

/** The roles in italics, as VS Code's themes draw comments. */
const ITALIC: ReadonlySet<TokenRole> = new Set(['comment', 'shebang']);

/** The class of a role's marks in the editor. */
export const roleClass = (role: TokenRole): string => `cm-bx-${role}`;

/** The editor's rules for the marks of every role. */
export const ROLE_STYLES: Record<string, { color: string; fontStyle?: string }> = Object.fromEntries(
  [...ROLES, 'error' as const].map((r) => [`.${roleClass(r)}`, { color: ROLE_COLOURS[r], ...(ITALIC.has(r) ? { fontStyle: 'italic' } : {}) }]),
);
