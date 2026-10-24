// The colour themes the theme-colour tests read: those bundled with the VS Code that the integration tests download
// (.vscode-test, in this checkout or a folder above it, as in a worktree; or `$BASH_EXPLAINER_VSCODE_BUILD`), and
// unpacked theme extensions in `$BASH_EXPLAINER_THEMES` (one folder per extension). They are read at test time
// only; none is copied into the repository. Without them, the tests that need them are skipped.
import * as fs from 'fs';
import * as path from 'path';
import { parseJsonc } from '../../src/settings';
import type { PanelBase } from '../../src/ui/themePalette';
import { emptyTheme, loadTheme, ROLES, type Role, type ThemeTokens } from '../../src/ui/themeTokens';

/** The extensions folder of the VS Code build, if there is one. */
export function vscodeExtensions(): string | undefined {
  const env = process.env.BASH_EXPLAINER_VSCODE_BUILD;
  const builds: string[] = [];
  if (env) builds.push(env);
  for (let dir = path.join(__dirname, '..', '..'); ; dir = path.dirname(dir)) {
    const t = path.join(dir, '.vscode-test');
    if (fs.existsSync(t)) builds.push(...fs.readdirSync(t).filter((d) => d.startsWith('vscode-')).sort().reverse().map((d) => path.join(t, d)));
    if (path.dirname(dir) === dir) break;
  }
  for (const b of builds) {
    const ext = [path.join(b, 'resources', 'app', 'extensions'), path.join(b, 'VSCode-linux-x64', 'resources', 'app', 'extensions')].find((e) => fs.existsSync(e));
    if (ext) return ext;
  }
  return undefined;
}

export interface ThemeEntry {
  /** The name VS Code knows it by (`workbench.colorTheme`): its id, else its label. */
  name: string;
  uiTheme: string;
  /** The theme file. */
  file: string;
}

/** The themes the extensions in `dir` contribute. */
export function themesIn(dir: string): ThemeEntry[] {
  const out: ThemeEntry[] = [];
  for (const e of fs.readdirSync(dir).sort()) {
    const pkgFile = path.join(dir, e, 'package.json');
    if (!fs.existsSync(pkgFile)) continue;
    const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
    const nlsFile = path.join(dir, e, 'package.nls.json');
    const nls = fs.existsSync(nlsFile) ? (parseJsonc(fs.readFileSync(nlsFile, 'utf8')) as Record<string, string | { message: string }>) : {};
    for (const t of pkg.contributes?.themes ?? []) {
      const key = /^%(.+)%$/.exec(t.label)?.[1];
      const v = key ? nls[key] : undefined;
      const label = key ? (typeof v === 'string' ? v : v?.message ?? t.label) : t.label;
      out.push({ name: t.id ?? label, uiTheme: t.uiTheme, file: path.join(dir, e, t.path) });
    }
  }
  return out;
}

/** All the themes the tests can read: the bundled ones, then those of `$BASH_EXPLAINER_THEMES`. */
export function availableThemes(): ThemeEntry[] {
  const dirs = [vscodeExtensions(), process.env.BASH_EXPLAINER_THEMES].filter((d): d is string => !!d && fs.existsSync(d));
  return dirs.flatMap(themesIn);
}

/** A theme read from its files. */
export async function readTheme(file: string): Promise<ThemeTokens> {
  const theme = emptyTheme();
  await loadTheme(file.split(path.sep).join('/'), async (f) => fs.readFileSync(f, 'utf8'), theme);
  return theme;
}

/** VS Code's defaults of the colours the panel reads, by kind (dark, light, high contrast dark, high contrast light). */
const DEFAULTS: Record<string, Record<string, string>> = {
  'vs-dark': {
    'editor.background': '#1e1e1e', 'editor.foreground': '#d4d4d4', 'textCodeBlock.background': '#0a0a0a66', 'list.hoverBackground': '#2a2d2e', descriptionForeground: '#ccccccb3',
    'charts.blue': '#3794ff', 'charts.orange': '#d18616', 'charts.green': '#89d185', 'charts.purple': '#b180d7', 'charts.yellow': '#cca700', 'charts.red': '#f14c4c',
  },
  vs: {
    'editor.background': '#ffffff', 'editor.foreground': '#000000', 'textCodeBlock.background': '#dcdcdc66', 'list.hoverBackground': '#f0f0f0', descriptionForeground: '#717171',
  },
  'hc-black': { 'editor.background': '#000000', 'editor.foreground': '#ffffff', 'textCodeBlock.background': '#000000', descriptionForeground: '#ffffffb3' },
  'hc-light': { 'editor.background': '#ffffff', 'editor.foreground': '#292929', 'textCodeBlock.background': '#ffffff', descriptionForeground: '#292929' },
};

/** The panel's own colours (media/panel.css) where they replace the theme's chart colours, by kind. */
const OWN: Record<string, Record<string, string>> = {
  'vs-dark': { variable: '#ff5c65' },
  vs: { command: '#0161f8', option: '#9f5c00', argument: '#1f7c2b', keyword: '#5f2489', redirect: '#645000', variable: '#d0020f' },
  'hc-black': { command: '#6badff', option: '#f69d3d', argument: '#89d185', keyword: '#c796ee', redirect: '#efd62f', variable: '#ff888e' },
  'hc-light': { command: '#0148bc', option: '#794402', argument: '#015f15', keyword: '#5f2489', redirect: '#453e01', variable: '#a20222' },
};

/** The classic palette's colour of each role: the group whose `--c-*` the kind's class takes (media/panel.css). */
const CLASSIC_OF: Record<Role, [string, string]> = {
  command: ['command', 'charts.blue'], builtin: ['command', 'charts.blue'], option: ['option', 'charts.orange'], argument: ['argument', 'charts.green'],
  string: ['argument', 'charts.green'], number: ['argument', 'charts.green'], keyword: ['keyword', 'charts.purple'], operator: ['keyword', 'charts.purple'],
  redirect: ['redirect', 'charts.yellow'], pattern: ['redirect', 'charts.yellow'], variable: ['variable', 'charts.red'], assignment: ['variable', 'charts.red'], comment: ['comment', 'descriptionForeground'],
};

/** What the webview would report in a theme (as far as the theme's file says; VS Code's defaults for the rest). */
export function baseOf(theme: ThemeTokens, uiTheme: string): PanelBase {
  const d = DEFAULTS[uiTheme];
  const c = (k: string) => theme.colors[k] ?? d[k] ?? DEFAULTS['vs-dark'][k];
  const classic = Object.fromEntries(ROLES.map((r) => [r, OWN[uiTheme][CLASSIC_OF[r][0]] ?? c(CLASSIC_OF[r][1])])) as Record<Role, string>;
  return {
    highContrast: uiTheme.startsWith('hc'),
    backgrounds: [c('editor.background'), c('textCodeBlock.background'), ...(theme.colors['list.hoverBackground'] ?? d['list.hoverBackground'] ? [c('list.hoverBackground')] : [])],
    foreground: c('editor.foreground'),
    classic,
  };
}
