// Design study (prototype): the colours of the panel's roles from a colour theme's token rules, resolved as VS Code
// resolves our semantic tokens: the theme's `semanticTokenColors` for the token's type (and modifiers), else its
// TextMate rules (`tokenColors`) matched against the scopes package.json gives the type (`semanticTokenScopes`).
// Pure: the extension (src/ui/themeColours.ts) finds and reads the theme; the web page could use its own themes.

/** A TextMate theme rule (`tokenColors` item, or `editor.tokenColorCustomizations.textMateRules`). */
export interface TextMateRule {
  scope?: string | string[];
  settings: { foreground?: string; fontStyle?: string };
}

/** What a theme says about tokens, in order of precedence (later wins): included themes first, then the theme, then the user's. */
export interface ThemeTokens {
  rules: TextMateRule[];
  /** `semanticTokenColors` merged: selector (`function.defaultLibrary`, `*.readonly`) to a colour or a style. */
  semantic: Record<string, string | { foreground?: string }>;
  /** Whether the theme turns semantic highlighting on (`semanticHighlighting`); else the semantic rules do not apply. */
  semanticHighlighting: boolean;
}

/** The panel's colour roles (media/panel.css `--c-*`), each as our semantic token and the TextMate scopes probed for it. */
export const ROLE_TOKENS: Record<string, { type: string; scopes: string[] }> = {
  command: { type: 'function', scopes: ['entity.name.function.call.shell', 'entity.name.function'] },
  builtin: { type: 'function.defaultLibrary', scopes: ['support.function.builtin.shell', 'support.function'] },
  option: { type: 'parameter', scopes: ['constant.other.option.shell', 'variable.parameter'] },
  argument: { type: 'string', scopes: ['string.unquoted.argument.shell', 'string'] },
  keyword: { type: 'keyword', scopes: ['keyword.control.shell', 'keyword'] },
  operator: { type: 'operator', scopes: ['keyword.operator.pipe.shell', 'keyword.operator'] },
  redirect: { type: 'operator', scopes: ['keyword.operator.redirect.shell', 'keyword.operator'] },
  variable: { type: 'variable', scopes: ['variable.other.normal.shell', 'variable'] },
  number: { type: 'number', scopes: ['constant.numeric.shell', 'constant.numeric'] },
  pattern: { type: 'regexp', scopes: ['string.regexp.unquoted.shell', 'string.regexp'] },
  comment: { type: 'comment', scopes: ['comment.line.number-sign.shell', 'comment'] },
};

/** How well a selector of one scope (`keyword.control`) matches `scope`: its number of segments, -1 if it does not. */
function prefixScore(selector: string, scope: string): number {
  return scope === selector || scope.startsWith(selector + '.') ? selector.split('.').length : -1;
}

/**
 * The score of a rule's selector (`source.shell keyword`, `- comment` is not supported: such a selector is skipped)
 * against a scope stack (outermost first), as vscode-textmate ranks them: the last segment must match the innermost
 * scope; the others, outer scopes in order. Deeper and more parent segments win; -1 when it does not match.
 */
export function selectorScore(selector: string, stack: readonly string[]): number {
  if (selector.includes(' - ') || selector.startsWith('-') || selector.includes('|')) return -1;
  const parts = selector.trim().split(/\s+/).filter((p) => p !== '>');
  const last = parts.pop();
  if (!last) return -1;
  const inner = prefixScore(last, stack[stack.length - 1]);
  if (inner < 0) return -1;
  let at = stack.length - 2;
  for (let i = parts.length - 1; i >= 0; i--) {
    while (at >= 0 && prefixScore(parts[i], stack[at]) < 0) at--;
    if (at < 0) return -1;
    at--;
  }
  return inner * 100 + parts.length;
}

/** The foreground the rules give the innermost scope of `stack`: the best score, the later rule on a tie. */
export function textMateForeground(rules: readonly TextMateRule[], stack: readonly string[]): string | undefined {
  let best = -1;
  let colour: string | undefined;
  for (const r of rules) {
    if (!r.settings?.foreground || r.scope === undefined) continue;
    const selectors = (Array.isArray(r.scope) ? r.scope : r.scope.split(',')).map((s) => s.trim()).filter(Boolean);
    for (const s of selectors) {
      const score = selectorScore(s, stack);
      if (score >= 0 && score >= best) {
        best = score;
        colour = r.settings.foreground;
      }
    }
  }
  return colour;
}

/** The foreground of a semantic token type (`function.defaultLibrary`) from the theme's semantic rules, if any. */
function semanticForeground(semantic: ThemeTokens['semantic'], type: string): string | undefined {
  const [base, ...mods] = type.split('.');
  let best = -1;
  let colour: string | undefined;
  for (const [selector, style] of Object.entries(semantic)) {
    const [sType, ...sMods] = selector.split(':')[0].split('.');
    if (sType !== '*' && sType !== base) continue;
    if (!sMods.every((m) => mods.includes(m))) continue;
    const score = (sType === '*' ? 0 : 1) + sMods.length * 100;
    const fg = typeof style === 'string' ? style : style.foreground;
    if (fg && score >= best) {
      best = score;
      colour = fg;
    }
  }
  return colour;
}

/** The colour of each role in the theme, where it gives one (roles it leaves to the foreground are left out). */
export function roleColours(theme: ThemeTokens): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [role, { type, scopes }] of Object.entries(ROLE_TOKENS)) {
    const fromSemantic = theme.semanticHighlighting ? semanticForeground(theme.semantic, type) : undefined;
    const colour = fromSemantic ?? scopes.map((s) => textMateForeground(theme.rules, ['source.shell', s])).find((c) => c);
    if (colour) out[role] = colour;
  }
  return out;
}
