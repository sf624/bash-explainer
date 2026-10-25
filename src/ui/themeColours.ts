// Reads the active colour theme's token colours for the panel (`bashExplainer.panel.colors`). VS Code has no API for
// them: the theme is found among the extensions' `contributes.themes` by `workbench.colorTheme` (or the preferred
// theme of the kind in use, when the theme follows the system), read with the files it includes, and the user's
// customizations are applied over it (src/ui/themeTokens.ts). An extension sees only the extensions of its own
// extension host: in a remote window the themes are on the local side, so VS Code's default themes are taken from our
// copy (src/ui/builtinThemes.ts), and the others cannot be read. Only the reading is here; the rest is pure.
import * as vscode from 'vscode';
import { parseJsonc } from '../settings';
import { builtinTheme } from './builtinThemes';
import { customize, emptyTheme, joinPath, loadTheme, roleColours, semanticOn, type Role, type ThemeTokens } from './themeTokens';

/** The name of the theme in use (`workbench.colorTheme`), or the preferred one when the theme follows the system. */
export function activeThemeName(): string | undefined {
  const wb = vscode.workspace.getConfiguration('workbench');
  const win = vscode.workspace.getConfiguration('window');
  const kind = vscode.window.activeColorTheme.kind;
  const hc = kind === vscode.ColorThemeKind.HighContrast || kind === vscode.ColorThemeKind.HighContrastLight;
  if (hc && win.get<boolean>('autoDetectHighContrast')) {
    return wb.get<string>(kind === vscode.ColorThemeKind.HighContrast ? 'preferredHighContrastColorTheme' : 'preferredHighContrastLightColorTheme');
  }
  if (!hc && win.get<boolean>('autoDetectColorScheme')) return wb.get<string>(kind === vscode.ColorThemeKind.Light ? 'preferredLightColorTheme' : 'preferredDarkColorTheme');
  return wb.get<string>('colorTheme');
}

interface ThemeContribution { id?: string; label?: string; path: string }

/** A theme's label, `%key%` read from the extension's package.nls.json (VS Code usually gives it already resolved). */
async function labelOf(ext: vscode.Extension<unknown>, label: string): Promise<string> {
  const key = /^%(.+)%$/.exec(label)?.[1];
  if (!key) return label;
  try {
    const nls = parseJsonc(new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(ext.extensionUri, 'package.nls.json')))) as Record<string, string | { message: string }>;
    const v = nls[key];
    return typeof v === 'string' ? v : v?.message ?? label;
  } catch {
    return label;
  }
}

/** The extension that contributes the theme `name` (its id, else its label) and the theme's file in it. */
async function findTheme(name: string, extensions: readonly vscode.Extension<unknown>[]): Promise<{ ext: vscode.Extension<unknown>; file: string } | undefined> {
  for (const ext of extensions) {
    const themes = (ext.packageJSON as { contributes?: { themes?: ThemeContribution[] } }).contributes?.themes ?? [];
    for (const t of themes) {
      if ((t.id ?? (await labelOf(ext, t.label ?? ''))) === name) return { ext, file: joinPath('package.json', t.path) };
    }
  }
  return undefined;
}

/** The scopes our package.json gives each semantic token type, for shell scripts (`semanticTokenScopes`). */
function ourScopes(ctx: vscode.ExtensionContext): Record<string, string[]> {
  const entries = ((ctx.extension.packageJSON as { contributes?: { semanticTokenScopes?: { language?: string; scopes: Record<string, string[]> }[] } })
    .contributes?.semanticTokenScopes ?? []);
  return Object.assign({}, ...entries.filter((e) => !e.language).map((e) => e.scopes), ...entries.filter((e) => e.language === 'shellscript').map((e) => e.scopes));
}

/** The token colours of the theme `name`: from the extension that contributes it here, else from our copy of VS Code's default ones. */
async function readTheme(name: string, extensions: readonly vscode.Extension<unknown>[]): Promise<ThemeTokens | undefined> {
  const found = await findTheme(name, extensions);
  if (found) {
    const theme = emptyTheme();
    try {
      await loadTheme(found.file, async (f) => new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(found.ext.extensionUri, f))), theme);
      return theme;
    } catch {
      // (A theme file that cannot be read or parsed: our copy, if the theme is a default one.)
    }
  }
  return builtinTheme(name);
}

/**
 * The colour of each role in the active theme as the editor draws it. A string, the theme's name, when the theme
 * cannot be read (only another extension host has it, or its files cannot be read); undefined when no theme is named.
 * `extensions`: those of this extension host (the integration test leaves them out, as a remote window does the themes).
 */
export async function themeRoleColours(ctx: vscode.ExtensionContext, ourHighlight: boolean, extensions: readonly vscode.Extension<unknown>[] = vscode.extensions.all): Promise<Record<Role, string | undefined> | string | undefined> {
  const name = activeThemeName();
  if (!name) return undefined;
  const theme = await readTheme(name, extensions);
  if (!theme) return name;
  const editor = vscode.workspace.getConfiguration('editor', { languageId: 'shellscript' });
  customize(theme, { tokens: editor.get('tokenColorCustomizations'), semantic: editor.get('semanticTokenColorCustomizations') }, name);
  return roleColours(theme, semanticOn(theme, editor.get('semanticHighlighting.enabled'), ourHighlight), ourScopes(ctx));
}

/** The settings of VS Code whose change can change the colours (ours, `panel.colors` and `highlight.enabled`, refresh the panel). */
export const THEME_SETTINGS = [
  'workbench.colorTheme', 'workbench.preferredDarkColorTheme', 'workbench.preferredLightColorTheme', 'workbench.preferredHighContrastColorTheme',
  'workbench.preferredHighContrastLightColorTheme', 'window.autoDetectColorScheme', 'window.autoDetectHighContrast', 'editor.tokenColorCustomizations',
  'editor.semanticTokenColorCustomizations', 'editor.semanticHighlighting.enabled',
];
