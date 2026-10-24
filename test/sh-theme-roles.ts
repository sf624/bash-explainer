// Design study helper (not a test): the panel's role colours resolved from VS Code's bundled themes.
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'jsonc-parser';
import { roleColours, type ThemeTokens } from '../src/themeColours';

const EXT = '/home/shun/explain-bash/.vscode-test/vscode-linux-x64-1.142.0/resources/app/extensions';
const load = (file: string, out: ThemeTokens): void => {
  const j = parse(fs.readFileSync(file, 'utf8'), [], { allowTrailingComma: true });
  if (j.include) load(path.join(path.dirname(file), j.include), out);
  if (Array.isArray(j.tokenColors)) out.rules.push(...j.tokenColors);
  else if (typeof j.tokenColors === 'string') console.log(`  (${path.basename(file)}: tokenColors in ${j.tokenColors}, not read)`);
  Object.assign(out.semantic, j.semanticTokenColors ?? {});
  if (j.semanticHighlighting !== undefined) out.semanticHighlighting = j.semanticHighlighting;
};
for (const f of ['theme-defaults/themes/dark_modern.json', 'theme-defaults/themes/light_modern.json', 'theme-defaults/themes/2026-dark.json', 'theme-monokai/themes/monokai-color-theme.json',
  'theme-solarized-dark/themes/solarized-dark-color-theme.json', 'theme-defaults/themes/hc_black.json', 'theme-defaults/themes/hc_light.json', 'theme-abyss/themes/abyss-color-theme.json']) {
  const t: ThemeTokens = { rules: [], semantic: {}, semanticHighlighting: false };
  load(path.join(EXT, f), t);
  console.log(path.basename(f), JSON.stringify(roleColours(t)));
}
