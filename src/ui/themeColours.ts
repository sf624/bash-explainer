// Design study (prototype): reads the active colour theme's token rules, for the panel's colours (src/themeColours.ts).
// VS Code has no API for them: the theme is found among the extensions' `contributes.themes` by the setting
// `workbench.colorTheme` (or the preferred theme of the kind in use), read as JSONC with its `include` chain, and the
// user's `editor.tokenColorCustomizations` and `editor.semanticTokenColorCustomizations` are applied over it.
import * as vscode from 'vscode';
// (The ESM build: esbuild cannot follow the UMD build's own requires.)
import { parse as parseJsonc } from 'jsonc-parser/lib/esm/main.js';
import { roleColours, type TextMateRule, type ThemeTokens } from '../themeColours';

/** The id of the theme in use: `workbench.colorTheme`, or the preferred one when the theme follows the OS. */
function activeThemeId(): string | undefined {
  const c = vscode.workspace.getConfiguration('workbench');
  const w = vscode.workspace.getConfiguration('window');
  const kind = vscode.window.activeColorTheme.kind;
  const hc = kind === vscode.ColorThemeKind.HighContrast || kind === vscode.ColorThemeKind.HighContrastLight;
  if (hc && w.get<boolean>('autoDetectHighContrast')) {
    return c.get<string>(kind === vscode.ColorThemeKind.HighContrast ? 'preferredHighContrastColorTheme' : 'preferredHighContrastLightColorTheme');
  }
  if (w.get<boolean>('autoDetectColorScheme')) return c.get<string>(kind === vscode.ColorThemeKind.Light ? 'preferredLightColorTheme' : 'preferredDarkColorTheme');
  return c.get<string>('colorTheme');
}

async function readJsonc(uri: vscode.Uri): Promise<unknown> {
  return parseJsonc(new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)), [], { allowTrailingComma: true });
}

/** The label of a theme, with `%key%` read from the extension's package.nls.json. */
async function label(ext: vscode.Extension<unknown>, text: string): Promise<string> {
  const m = /^%(.+)%$/.exec(text);
  if (!m) return text;
  try {
    const nls = (await readJsonc(vscode.Uri.joinPath(ext.extensionUri, 'package.nls.json'))) as Record<string, string | { message: string }>;
    const v = nls[m[1]];
    return typeof v === 'string' ? v : v?.message ?? text;
  } catch {
    return text;
  }
}

/** The theme file of `id` (a theme's `id`, or its label when it has none), and the extension that contributes it. */
async function findTheme(id: string): Promise<vscode.Uri | undefined> {
  for (const ext of vscode.extensions.all) {
    const themes = (ext.packageJSON as { contributes?: { themes?: { id?: string; label: string; path: string }[] } }).contributes?.themes ?? [];
    for (const t of themes) {
      if ((t.id ?? (await label(ext, t.label))) === id) return vscode.Uri.joinPath(ext.extensionUri, t.path);
    }
  }
  return undefined;
}

/** The token rules of a theme file and the files it includes (included first). `.tmTheme` (plist) files are not read. */
async function load(uri: vscode.Uri, out: ThemeTokens, depth = 0): Promise<string | undefined> {
  if (depth > 5) return;
  const json = (await readJsonc(uri)) as { include?: string; tokenColors?: TextMateRule[] | string; semanticTokenColors?: ThemeTokens['semantic']; semanticHighlighting?: boolean; name?: string };
  if (json.include) await load(vscode.Uri.joinPath(uri, '..', json.include), out, depth + 1);
  if (Array.isArray(json.tokenColors)) out.rules.push(...json.tokenColors);
  else if (typeof json.tokenColors === 'string' && json.tokenColors.endsWith('.json')) {
    const inc = (await readJsonc(vscode.Uri.joinPath(uri, '..', json.tokenColors))) as { tokenColors?: TextMateRule[] };
    out.rules.push(...(inc.tokenColors ?? []));
  }
  Object.assign(out.semantic, json.semanticTokenColors ?? {});
  if (json.semanticHighlighting !== undefined) out.semanticHighlighting = json.semanticHighlighting;
  return json.name;
}

/** `editor.tokenColorCustomizations`'s shorthands, as the scopes VS Code gives them. */
const SHORTHANDS: Record<string, string[]> = {
  comments: ['comment', 'punctuation.definition.comment'], strings: ['string', 'meta.embedded.assembly'], keywords: ['keyword - keyword.operator', 'keyword.control', 'storage', 'storage.type'],
  numbers: ['constant.numeric'], types: ['entity.name.type', 'entity.name.class', 'support.type', 'support.class'], functions: ['entity.name.function', 'support.function'],
  variables: ['variable', 'entity.name.variable'],
};

/** The user's customizations for all themes, then for this one (`"[Theme Name]": {…}`), applied over the theme. */
function customize(out: ThemeTokens, id: string): void {
  const editor = vscode.workspace.getConfiguration('editor');
  const apply = (c: Record<string, unknown> | undefined): void => {
    if (!c) return;
    for (const [k, scopes] of Object.entries(SHORTHANDS)) {
      const v = c[k];
      const fg = typeof v === 'string' ? v : (v as { foreground?: string } | undefined)?.foreground;
      if (fg) out.rules.push({ scope: scopes, settings: { foreground: fg } });
    }
    if (Array.isArray(c.textMateRules)) out.rules.push(...(c.textMateRules as TextMateRule[]));
  };
  const tm = editor.get<Record<string, unknown>>('tokenColorCustomizations') ?? {};
  apply(tm);
  apply(tm[`[${id}]`] as Record<string, unknown> | undefined);
  const sem = editor.get<Record<string, unknown>>('semanticTokenColorCustomizations') ?? {};
  for (const c of [sem, sem[`[${id}]`] as Record<string, unknown> | undefined]) {
    if (!c) continue;
    if (typeof c.enabled === 'boolean') out.semanticHighlighting = c.enabled;
    Object.assign(out.semantic, (c.rules as ThemeTokens['semantic']) ?? {});
  }
}

/** The CSS colour variables of the panel's roles (`--c-command`…) in the active theme; undefined when it cannot be read. */
export async function themeRoleColours(): Promise<{ theme: string; vars: Record<string, string> } | undefined> {
  const id = activeThemeId();
  if (!id) return undefined;
  const uri = await findTheme(id);
  if (!uri) return undefined;
  const tokens: ThemeTokens = { rules: [], semantic: {}, semanticHighlighting: false };
  try {
    await load(uri, tokens);
  } catch {
    return undefined;
  }
  customize(tokens, id);
  const roles = roleColours(tokens);
  return { theme: id, vars: Object.fromEntries(Object.entries(roles).map(([role, colour]) => [`--c-${role}`, colour])) };
}
