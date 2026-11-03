import type { Kind } from './analyzer-types';

// The colour role of each kind of token (`Token.role`; docs/design/sources.md, SB3a): the one table of what a token is
// coloured as, which media/panel.css writes out as its `.kind-*` rules (test/token-roles.test.ts checks them against
// it) and the row model of the panel will read (docs/design/panel-redesign.md, P7a). The roles are those of the
// palettes (src/ui/themePalette.ts), as far as an editor colours them apart (src/ui/themeTokens.ts, `ROLE_PROBES`).

/** The panel's colour roles, as far as an editor colours them apart. */
export const ROLES = ['command', 'builtin', 'option', 'argument', 'string', 'number', 'keyword', 'operator', 'redirect', 'pattern', 'variable', 'assignment', 'comment', 'shebang'] as const;
export type Role = (typeof ROLES)[number];

/** The role of a token: a colour role, or `error`, a part bash cannot read (the colour of an error). */
export type TokenRole = Role | 'error';

/**
 * The role of each kind of token: a command name of any kind but a builtin is a command; the parts of the grammar a
 * keyword does not start (a block, a test, an operator) are operators; an expansion of any kind is a variable.
 */
export const KIND_ROLES: Readonly<Record<Kind, TokenRole>> = {
  command: 'command', subcommand: 'command', function: 'command', alias: 'command', builtin: 'builtin',
  option: 'option', argument: 'argument', string: 'string', number: 'number', pattern: 'pattern',
  keyword: 'keyword', operator: 'operator', block: 'operator', test: 'operator', redirect: 'redirect',
  variable: 'variable', expansion: 'variable', substitution: 'variable', assignment: 'assignment',
  comment: 'comment', shebang: 'shebang', error: 'error',
};
