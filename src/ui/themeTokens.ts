// The colours a colour theme gives the parts of a shell line (the panel's roles), as VS Code colours them in the
// editor: the theme's file (JSON with comments, or a TextMate `.tmTheme` plist) and the files it includes, then the
// user's `editor.tokenColorCustomizations` and `editor.semanticTokenColorCustomizations`; each role resolved from the
// semantic token we give it (`semanticTokenColors`, then the TextMate scopes package.json gives the token type), or,
// without semantic highlighting, from the scopes of VS Code's shell grammar.
// Pure: src/ui/themeColours.ts finds the theme and reads its files; src/ui/themePalette.ts makes the panel's colours.
import { parseJsonc } from '../settings';
import { ROLES, type Role } from '../roles';
import { SUPER_TYPES, type TokenType } from '../semanticTokens';

/** A TextMate theme rule (an item of `tokenColors`, or of `editor.tokenColorCustomizations.textMateRules`). */
export interface TextMateRule {
  name?: string;
  scope?: string | string[];
  settings?: { foreground?: string; background?: string; fontStyle?: string };
}

/** A semantic token style: a colour, or an object with one. */
export type SemanticStyle = string | { foreground?: string; fontStyle?: string; bold?: boolean; italic?: boolean; underline?: boolean };

/** What a theme says about tokens, with later rules winning. */
export interface ThemeTokens {
  rules: TextMateRule[];
  /** `semanticTokenColors`: a selector (`function.defaultLibrary`, `*.readonly`, `variable:shellscript`) to a style. */
  semantic: Record<string, SemanticStyle>;
  /** Whether the theme turns semantic highlighting on (`semanticHighlighting`), when it says. */
  semanticHighlighting?: boolean;
  /** The workbench colours (`colors`): `editor.background`, `editor.foreground`… */
  colors: Record<string, string>;
}

/** An empty theme, to load files into. */
export const emptyTheme = (): ThemeTokens => ({ rules: [], semantic: {}, colors: {} });

/** A path joined to the folder of `from` (paths with `/`; `..` and `.` resolved). */
export function joinPath(from: string, rel: string): string {
  if (rel.startsWith('/')) return rel;
  const out = from.split('/').slice(0, -1);
  for (const seg of rel.split('/')) {
    if (seg === '..') out.pop();
    else if (seg !== '.' && seg !== '') out.push(seg);
  }
  return out.join('/');
}

type Plist = string | number | boolean | Plist[] | { [k: string]: Plist };

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

/** A property list in XML (a `.tmTheme`): dictionaries, arrays, strings, numbers and booleans. */
export function parsePlist(xml: string): Plist {
  // The tags and the text between them, without the prolog, comments and the <plist> element.
  // Each tag written one way: `<string />` as `<string/>`, `</key >` as `</key>`.
  const parts = (xml.replace(/<\?[^]*?\?>|<!--[^]*?-->|<!DOCTYPE[^>]*>|<\/?plist[^>]*>/g, '').match(/<[^>]+>|[^<]+/g) ?? [])
    .map((p) => p.replace(/^<\s*(\/?)\s*(\w+)[^>/]*(\/?)\s*>$/, '<$1$2$3>'));
  let i = 0;
  const text = (s: string) => s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_, e: string) =>
    e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e]);
  const skip = () => {
    while (i < parts.length && !parts[i].startsWith('<')) i++;
  };
  const value = (): Plist => {
    skip();
    const tag = parts[i++];
    if (tag === '<true/>') return true;
    if (tag === '<false/>') return false;
    if (tag === '<dict/>') return {};
    if (tag === '<array/>') return [];
    if (tag === '<string/>') return '';
    if (tag?.endsWith('/>')) return ''; // (`<data/>`, `<integer/>`: nothing in a theme's rules)
    const name = /^<(\w+)>$/.exec(tag)?.[1];
    if (name === 'dict') {
      const out: Record<string, Plist> = {};
      for (skip(); parts[i] === '<key>' || parts[i] === '<key/>'; skip()) {
        let key = '';
        if (parts[i++] === '<key>') {
          if (parts[i] !== '</key>') key = text(parts[i++]);
          i++;
        }
        out[key] = value();
      }
      i++;
      return out;
    }
    if (name === 'array') {
      const out: Plist[] = [];
      for (skip(); i < parts.length && parts[i] !== '</array>'; skip()) out.push(value());
      i++;
      return out;
    }
    // A string, an integer or a real: its text up to the closing tag.
    let s = '';
    while (i < parts.length && parts[i] !== `</${name}>`) s += parts[i++];
    i++;
    return name === 'integer' || name === 'real' ? Number(s) : text(s);
  };
  return value();
}

/** The rules of a `.tmTheme`; the first item, with no scope, holds the editor's colours. */
function tmThemeRules(xml: string, theme: ThemeTokens): void {
  const settings = ((parsePlist(xml) as Record<string, Plist>).settings ?? []) as unknown as TextMateRule[];
  for (const r of settings) {
    if (r.scope === undefined && r.settings) {
      if (r.settings.foreground) theme.colors['editor.foreground'] ??= r.settings.foreground;
      if (r.settings.background) theme.colors['editor.background'] ??= r.settings.background;
    }
    theme.rules.push(r);
  }
}

/**
 * Reads a theme file and the files it includes into `theme`, as VS Code does: an included theme first, then the
 * theme's own rules after them; `tokenColors` may name a `.tmTheme`. `read` gives a file's text by its path.
 * Returns the theme's `name`, when it has one.
 */
export async function loadTheme(file: string, read: (file: string) => Promise<string>, theme: ThemeTokens = emptyTheme(), depth = 0): Promise<string | undefined> {
  if (depth > 8) throw new Error(`too many includes: ${file}`);
  const text = await read(file);
  if (/\.tmTheme$/i.test(file)) {
    tmThemeRules(text, theme);
    return undefined;
  }
  const json = parseJsonc(text) as {
    name?: string; include?: string; tokenColors?: TextMateRule[] | string; colors?: Record<string, string>;
    semanticTokenColors?: Record<string, SemanticStyle>; semanticHighlighting?: boolean;
  };
  if (json.include) await loadTheme(joinPath(file, json.include), read, theme, depth + 1);
  if (typeof json.tokenColors === 'string') tmThemeRules(await read(joinPath(file, json.tokenColors)), theme);
  else if (Array.isArray(json.tokenColors)) theme.rules.push(...json.tokenColors);
  Object.assign(theme.colors, json.colors ?? {});
  Object.assign(theme.semantic, json.semanticTokenColors ?? {});
  if (json.semanticHighlighting !== undefined) theme.semanticHighlighting = json.semanticHighlighting;
  return json.name;
}

/** Whether a scope (`keyword.operator.pipe.shell`) is a selector's segment or under it (`keyword.operator`). */
const under = (scope: string, segment: string) => scope === segment || scope.startsWith(segment + '.');

/** How specific a matching selector is: the parts of its last segment, and its parent segments, innermost first. */
export interface Specificity { depth: number; parents: string[] }

/**
 * Whether one selector (`source.shell keyword.operator`, `meta.a > keyword`) matches the innermost scope of a stack
 * (outermost first), as vscode-textmate reads theme rules: split at single spaces, the last segment a prefix of the
 * innermost scope, the others outer scopes in order (`>`: the very next one). An exclusion (`a - b`) is not a
 * selector there: its `-` is a parent segment no scope matches. Undefined when it does not match.
 */
export function selectorMatch(selector: string, stack: readonly string[]): Specificity | undefined {
  const segs = selector.trim().split(' ');
  const last = segs.pop()!;
  if (!stack.length || !under(stack[stack.length - 1], last)) return undefined;
  const parents = segs.reverse();
  let at = stack.length - 2;
  for (let i = 0; i < parents.length; i++) {
    const strict = parents[i] === '>';
    if (strict && ++i >= parents.length) return undefined;
    while (at >= 0 && !under(stack[at], parents[i])) {
      if (strict) return undefined;
      at--;
    }
    if (at-- < 0) return undefined;
  }
  return { depth: last.split('.').length, parents };
}

/** Which of two matching selectors wins, as vscode-textmate sorts them: > 0 when `b` is more specific. */
export function compareSpecificity(a: Specificity, b: Specificity): number {
  if (a.depth !== b.depth) return b.depth - a.depth;
  const pa = a.parents.filter((x) => x !== '>');
  const pb = b.parents.filter((x) => x !== '>');
  for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
    if (pa[i].length !== pb[i].length) return pb[i].length - pa[i].length;
  }
  return pb.length - pa.length;
}

/** The selectors of a rule: its scope's items, or its scope split at commas. */
function selectors(rule: TextMateRule): string[] {
  const scope = rule.scope ?? '';
  return (Array.isArray(scope) ? scope : String(scope).split(',')).map((s) => String(s).trim()).filter(Boolean);
}

/** A colour vscode-textmate takes: `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa` (others are dropped). */
const validColour = (c: unknown): c is string => typeof c === 'string' && /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(c);

/** The foreground the best rule gives the innermost scope of `stack` (a later rule wins a tie), if any rule matches it. */
function levelForeground(rules: readonly TextMateRule[], stack: readonly string[]): string | undefined {
  let best: Specificity | undefined;
  let colour: string | undefined;
  for (const r of rules) {
    const fg = r.settings?.foreground;
    if (!validColour(fg)) continue;
    for (const s of selectors(r)) {
      const m = selectorMatch(s, stack);
      if (m && (!best || compareSpecificity(best, m) >= 0)) {
        best = m;
        colour = fg;
      }
    }
  }
  return colour;
}

/**
 * The foreground of a token whose scopes are `stack` (outermost first), as the editor draws it: each scope pushed
 * takes the colour of the rule that matches it best, and keeps the outer one's when none does. Undefined: the editor's foreground.
 */
export function textMateForeground(rules: readonly TextMateRule[], stack: readonly string[]): string | undefined {
  let colour: string | undefined;
  for (let d = 1; d <= stack.length; d++) colour = levelForeground(rules, stack.slice(0, d)) ?? colour;
  return colour;
}

/** The foreground the semantic rules give a token type with modifiers (`function.defaultLibrary`) in a language, if any. */
export function semanticForeground(semantic: Record<string, SemanticStyle>, token: string, language = 'shellscript'): string | undefined {
  const [type, ...mods] = token.split('.');
  let best = -1;
  let colour: string | undefined;
  for (const [selector, style] of Object.entries(semantic)) {
    const score = tokenScore(selector, type, mods, language);
    const fg = typeof style === 'string' ? style : style?.foreground;
    if (score >= 0 && fg && score >= best) {
      best = score;
      colour = fg;
    }
  }
  return colour;
}

/** The user's customizations, as VS Code's settings give them. */
export interface Customizations {
  /** `editor.tokenColorCustomizations`. */
  tokens?: Record<string, unknown>;
  /** `editor.semanticTokenColorCustomizations`. */
  semantic?: Record<string, unknown>;
}

/** The shorthands of `editor.tokenColorCustomizations`, as the scopes VS Code gives them. */
const SHORTHANDS: Record<string, string[]> = {
  comments: ['comment', 'punctuation.definition.comment'],
  strings: ['string', 'meta.embedded.assembly'],
  keywords: ['keyword - keyword.operator', 'keyword.control', 'storage', 'storage.type'],
  numbers: ['constant.numeric'],
  types: ['entity.name.type', 'entity.name.class', 'support.type', 'support.class'],
  functions: ['entity.name.function', 'support.function'],
  variables: ['variable', 'entity.name.variable'],
};

/** Whether a key `[Theme A][Monokai*]` names the theme (`*` matches any text). */
function namesTheme(key: string, theme: string): boolean {
  const names = /^\[(.+)\]$/.exec(key)?.[1].split('][') ?? [];
  return names.some((n) => new RegExp(`^${n.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`).test(theme));
}

/** The user's customizations applied over the theme: those for every theme, then those for this one (`"[Name]": {…}`). */
export function customize(theme: ThemeTokens, custom: Customizations, name: string): void {
  const scoped = (c: Record<string, unknown> | undefined) => [c, ...Object.entries(c ?? {}).filter(([k]) => namesTheme(k, name)).map(([, v]) => v as Record<string, unknown>)];
  for (const c of scoped(custom.tokens)) {
    if (!c || typeof c !== 'object') continue;
    for (const [k, scopes] of Object.entries(SHORTHANDS)) {
      const v = c[k];
      const fg = typeof v === 'string' ? v : (v as { foreground?: string } | undefined)?.foreground;
      if (fg) theme.rules.push({ scope: scopes, settings: { foreground: fg } });
    }
    if (Array.isArray(c.textMateRules)) theme.rules.push(...(c.textMateRules as TextMateRule[]));
  }
  for (const c of scoped(custom.semantic)) {
    if (!c || typeof c !== 'object') continue;
    if (typeof c.enabled === 'boolean') theme.semanticHighlighting = c.enabled;
    if (c.rules && typeof c.rules === 'object') Object.assign(theme.semantic, c.rules);
  }
}

/** The panel's colour roles (src/roles.ts, where each kind of token gets one). */
export { ROLES, type Role };

/**
 * What the editor colours each role as: our semantic token (src/semanticTokens.ts, `TOKEN_OF`; none for a plain
 * argument) and the scopes VS Code's shell grammar gives it (outermost first, under `source.shell`).
 */
export const ROLE_PROBES: Record<Role, { token?: string; grammar: string[] }> = {
  command: { token: 'function', grammar: ['entity.name.function.call.shell', 'entity.name.command.shell'] },
  builtin: { token: 'function.defaultLibrary', grammar: ['support.function.builtin.shell'] },
  option: { token: 'parameter', grammar: ['string.unquoted.argument.shell', 'constant.other.option.shell'] },
  argument: { grammar: ['string.unquoted.argument.shell'] },
  string: { token: 'string', grammar: ['string.quoted.double.shell'] },
  number: { token: 'number', grammar: ['constant.numeric.shell', 'constant.numeric.integer.shell'] },
  keyword: { token: 'keyword', grammar: ['keyword.control.shell'] },
  operator: { token: 'operator', grammar: ['keyword.operator.pipe.shell'] },
  redirect: { token: 'operator', grammar: ['keyword.operator.redirect.shell'] },
  pattern: { token: 'regexp', grammar: ['string.unquoted.pattern.shell', 'string.regexp.unquoted.shell'] },
  variable: { token: 'variable', grammar: ['variable.other.normal.shell'] },
  assignment: { token: 'variable.modification', grammar: ['variable.other.assignment.shell'] },
  comment: { token: 'comment', grammar: ['comment.line.number-sign.shell'] },
  shebang: { token: 'shebang', grammar: ['comment.line.number-sign.shell', 'meta.shebang.shell'] },
};

/**
 * VS Code's own default rules for our token types (its `registerTokenType` scopes, src/vs/platform/theme/common/
 * tokenClassificationRegistry.ts); package.json's `semanticTokenScopes` add to them.
 */
const DEFAULT_SCOPES: Record<string, string[]> = {
  comment: ['comment'], string: ['string'], keyword: ['keyword.control'], number: ['constant.numeric'], regexp: ['constant.regexp'],
  operator: ['keyword.operator'], function: ['entity.name.function', 'support.function'], 'function.defaultLibrary': ['support.function'],
  parameter: ['variable.parameter'], variable: ['variable.other.readwrite', 'entity.name.variable'],
};

/**
 * How a selector of token rules (`function.defaultLibrary`, `*.readonly`, `variable:shellscript`) matches a token: its
 * score, -1 if not. A selector of a type's super type matches it too, a point lower (`comment` for `shebang`).
 */
function tokenScore(selector: string, type: string, mods: string[], language: string): number {
  const [sel, lang] = selector.split(':');
  const [sType, ...sMods] = sel.split('.');
  const depth = [type, ...(type in SUPER_TYPES ? [SUPER_TYPES[type as TokenType]] : [])].indexOf(sType);
  if ((sType !== '*' && depth < 0) || !sMods.every((m) => mods.includes(m)) || (lang && lang !== language)) return -1;
  return (sType === '*' ? 0 : 100 - depth) + sMods.length * 100 + (lang ? 10 : 0);
}

/**
 * The colour of a semantic token from the theme's TextMate rules, as VS Code finds it when the theme has no semantic
 * rule for it: every default rule whose selector matches the token (VS Code's own, then ours), the most specific
 * first (a later one first on a tie), each probing its scopes; the first that the theme colours.
 */
export function tokenFallback(rules: readonly TextMateRule[], token: string, scopes: Record<string, string[]>, language = 'shellscript'): string | undefined {
  const [type, ...mods] = token.split('.');
  const candidates = [...Object.entries(DEFAULT_SCOPES), ...Object.entries(scopes)]
    .map(([sel, probes], i) => ({ score: tokenScore(sel, type, mods, language), probes, i }))
    .filter((c) => c.score >= 0)
    .sort((a, b) => b.score - a.score || b.i - a.i);
  for (const c of candidates) {
    for (const p of c.probes) {
      const colour = textMateForeground(rules, p.split(' '));
      if (colour) return colour;
    }
  }
  return undefined;
}

/**
 * Whether the editor draws our semantic tokens: our highlighting is on (`bashExplainer.highlight.enabled`), and
 * `editor.semanticHighlighting.enabled` is true, or left to the theme (`configuredByTheme`) and the theme (or the
 * user's customization) turns it on.
 */
export function semanticOn(theme: ThemeTokens, editorSetting: unknown, ours: boolean): boolean {
  return ours && (editorSetting === true || (editorSetting !== false && theme.semanticHighlighting === true));
}

/**
 * The colour of each role as the editor draws it: with semantic tokens, the theme's semantic rule for the token,
 * else the rules that match the scopes our package.json gives the token type (`scopes`, `semanticTokenScopes`); without
 * them, or when nothing matches, the grammar's scopes. Undefined: the role is drawn in the editor's foreground.
 */
export function roleColours(theme: ThemeTokens, semantic: boolean, scopes: Record<string, string[]>): Record<Role, string | undefined> {
  const out = {} as Record<Role, string | undefined>;
  for (const role of ROLES) {
    const { token, grammar } = ROLE_PROBES[role];
    let colour: string | undefined;
    if (semantic && token) colour = semanticForeground(theme.semantic, token) ?? tokenFallback(theme.rules, token, scopes);
    out[role] = colour ?? textMateForeground(theme.rules, ['source.shell', ...grammar]);
  }
  return out;
}
