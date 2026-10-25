// Copies the token colours of VS Code's default colour themes (its extension theme-defaults: Dark 2026, Dark Modern,
// Light+, the high contrast ones…) into src/ui/vscodeThemes.json, for `bashExplainer.panel.colors` in a window whose
// extension host does not have them (a remote one: WSL, SSH, a container; src/ui/builtinThemes.ts). Only what the
// panel reads is kept: the `include`, the TextMate rules that give a foreground, `semanticTokenColors` and
// `semanticHighlighting`. They are Microsoft's, under the MIT license of microsoft/vscode (THIRD_PARTY_NOTICES.md,
// scripts/notices.ts). The other themes VS Code ships (Monokai, Solarized…) come from elsewhere, under other terms,
// and are not copied.
//
//   npx tsx scripts/vscode-themes.ts           rewrite src/ui/vscodeThemes.json from the VS Code in .vscode-test
//   npx tsx scripts/vscode-themes.ts --check   fail if the file differs from what that VS Code gives
import * as fs from 'fs';
import * as path from 'path';
import { parseJsonc } from '../src/settings';
import type { BuiltinThemes } from '../src/ui/builtinThemes';
import type { TextMateRule } from '../src/ui/themeTokens';
import { vscodeExtensions } from '../test/support/themes';

export const OUT = path.join(__dirname, '..', 'src', 'ui', 'vscodeThemes.json');

/** The extensions whose themes are copied. */
export const COPIED_EXTENSIONS = ['theme-defaults'];

/** The default themes in `extDir` (a VS Code build's `resources/app/extensions`) of VS Code `version`. */
export function copyThemes(extDir: string, version: string): BuiltinThemes {
  const out: BuiltinThemes = { vscode: version, themes: {}, files: {} };
  for (const dir of COPIED_EXTENSIONS) {
    const pkg = JSON.parse(fs.readFileSync(path.join(extDir, dir, 'package.json'), 'utf8')) as { contributes?: { themes?: { id?: string; label: string; path: string }[] } };
    const nlsFile = path.join(extDir, dir, 'package.nls.json');
    const nls = fs.existsSync(nlsFile) ? (parseJsonc(fs.readFileSync(nlsFile, 'utf8')) as Record<string, string | { message: string }>) : {};
    for (const t of pkg.contributes?.themes ?? []) {
      const key = /^%(.+)%$/.exec(t.label)?.[1];
      const v = key ? nls[key] : undefined;
      const name = t.id ?? (key ? (typeof v === 'string' ? v : v?.message ?? t.label) : t.label);
      out.themes[name] = path.posix.join(dir, t.path);
      copyFile(extDir, path.posix.join(dir, t.path), out);
    }
  }
  return out;
}

/** A theme file, and the files it includes, trimmed to what the panel reads. */
function copyFile(extDir: string, file: string, out: BuiltinThemes): void {
  if (out.files[file]) return;
  const json = parseJsonc(fs.readFileSync(path.join(extDir, file), 'utf8')) as BuiltinThemes['files'][string] & { tokenColors?: TextMateRule[] | string };
  if (typeof json.tokenColors === 'string') throw new Error(`${file}: tokenColors names a file; copy it too`);
  const rules = (json.tokenColors ?? []).filter((r) => r.settings?.foreground).map((r) => ({ ...(r.scope !== undefined ? { scope: r.scope } : {}), settings: { foreground: r.settings!.foreground } }));
  out.files[file] = {
    ...(json.include ? { include: json.include } : {}),
    ...(rules.length ? { tokenColors: rules } : {}),
    ...(json.semanticTokenColors ? { semanticTokenColors: json.semanticTokenColors } : {}),
    ...(json.semanticHighlighting !== undefined ? { semanticHighlighting: json.semanticHighlighting } : {}),
  };
  if (json.include) copyFile(extDir, path.posix.join(path.posix.dirname(file), json.include), out);
}

/** The version of the VS Code whose extensions folder is `extDir`. */
export function versionOf(extDir: string): string {
  return (JSON.parse(fs.readFileSync(path.join(extDir, '..', 'package.json'), 'utf8')) as { version: string }).version;
}

/** The file's text for the themes of `extDir`. */
export const render = (extDir: string): string => `${JSON.stringify(copyThemes(extDir, versionOf(extDir)), null, 1)}\n`;

/* c8 ignore start */
if (require.main === module) {
  const ext = vscodeExtensions();
  if (!ext) throw new Error('no VS Code build: run `npm run test:integration -- --download-only` first');
  const text = render(ext);
  if (process.argv.includes('--check')) {
    if (fs.readFileSync(OUT, 'utf8') !== text) {
      console.error(`src/ui/vscodeThemes.json differs from the themes of VS Code ${versionOf(ext)}: run npx tsx scripts/vscode-themes.ts`);
      process.exit(1);
    }
  } else {
    fs.writeFileSync(OUT, text);
    console.log(`src/ui/vscodeThemes.json: the themes of VS Code ${versionOf(ext)}`);
  }
}
/* c8 ignore stop */
