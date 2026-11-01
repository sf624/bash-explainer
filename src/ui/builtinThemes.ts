// The token colours of VS Code's default colour themes (its extension theme-defaults: Dark 2026, Dark Modern, Light+…),
// copied by scripts/vscode-themes.ts into vscodeThemes.json. src/ui/themeColours.ts reads a theme from the extension
// that contributes it; but an extension sees only the extensions of its own extension host, and in a remote window
// (WSL, SSH, a container) the themes are on the local side while this extension runs on the remote one. VS Code has no
// API for a theme's token colours, so the panel takes the default themes from this copy there.
import type { Lang } from '../i18n';
import { emptyTheme, loadTheme, type SemanticStyle, type TextMateRule, type ThemeTokens } from './themeTokens';
import { ui } from './texts';
import copied from './vscodeThemes.json';

/** The copy: the VS Code it comes from, each theme's file by its name, and the files trimmed to what the panel reads. */
export interface BuiltinThemes {
  vscode: string;
  themes: Record<string, string>;
  files: Record<string, { include?: string; tokenColors?: TextMateRule[]; semanticTokenColors?: Record<string, SemanticStyle>; semanticHighlighting?: boolean }>;
}

const BUILTIN = copied as BuiltinThemes;

/** The names an older VS Code gives the default themes (a newer one moves `workbench.colorTheme` from them), to their name in the copy. */
const FORMER: Record<string, string> = {
  'Default Dark Modern': 'Dark Modern', 'Default Light Modern': 'Light Modern', 'Default Dark+': 'Dark+', 'Default Light+': 'Light+',
  'Experimental Dark': 'Dark 2026', 'VS Code Dark': 'Dark 2026', 'Experimental Light': 'Light 2026', 'VS Code Light': 'Light 2026',
};

/** The token colours of the default theme `name` (`workbench.colorTheme`), or undefined when it is not one of them. */
export async function builtinTheme(name: string): Promise<ThemeTokens | undefined> {
  const own = (n: string | undefined) => (n !== undefined && Object.hasOwn(BUILTIN.themes, n) ? BUILTIN.themes[n] : undefined);
  const file = own(name) ?? own(Object.hasOwn(FORMER, name) ? FORMER[name] : undefined);
  if (!file) return undefined;
  const theme = emptyTheme();
  await loadTheme(file, async (f) => JSON.stringify(BUILTIN.files[f]), theme);
  return theme;
}

/**
 * What the panel says, once a session for each theme, when it keeps its own colours because the theme `name` cannot be
 * read (plain text: a notification shows no Markdown). `remote`: the extension runs on the remote side of a remote
 * window, where VS Code has none of the theme extensions; on the local side it reads them all (package.json `extensionKind`).
 */
export function unreadableThemeNotice(lang: Lang, name: string, remote: boolean): string {
  return ui[lang].unreadableTheme(name, remote);
}
