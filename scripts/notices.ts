// Generates THIRD_PARTY_NOTICES.md from what the builds actually include: the packages esbuild
// bundled (from its metafile), and the works copied into our own files (COPIED).
// Usage: npx tsx scripts/notices.ts [--check]   (--check: fail if the file is out of date)
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const root = path.join(__dirname, '..');
export const NOTICES = path.join(root, 'THIRD_PARTY_NOTICES.md');

/**
 * Licenses whose terms the MIT-licensed Bash Explainer can meet by reproducing their text, or, for CC BY 4.0
 * (artwork, not code), by the attribution it asks for: the creator, the copyright notice, the license's
 * name and link, the disclaimer, and whether the work was changed.
 */
export const ALLOWED_LICENSES = ['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD', 'CC-BY-4.0'];

export interface Package {
  name: string;
  version: string;
  license: string;
  url: string;
  licenseText: string;
}

/** A work copied into our own files (no package of it is installed or bundled), with where it is in each product. */
export interface Copied extends Package {
  /** Target title → how it is included. */
  uses: Record<string, string>;
}

/** The works copied into our own files, with their notices. test/licenses.test.ts checks that the files hold them. */
export const COPIED: Record<string, Copied> = {
  '@vscode/codicons': {
    name: '@vscode/codicons',
    version: '0.0.46-24',
    license: 'CC-BY-4.0',
    url: 'https://github.com/microsoft/vscode-codicons',
    licenseText: [
      'Codicons (the icons of Visual Studio Code)',
      'Copyright (c) Microsoft Corporation. https://github.com/microsoft/vscode-codicons',
      '',
      'The icons are licensed under the Creative Commons Attribution 4.0 International License (CC BY 4.0):',
      'https://creativecommons.org/licenses/by/4.0/legalcode',
      '',
      'Bash Explainer copies seven of the icons (collapse-all, expand-all, copy, book, arrow-left, gear,',
      'chevron-down) from src/icons/*.svg of @vscode/codicons 0.0.46-24, unmodified, as SVG path data drawn',
      "in the theme's text colour, in the header of the extension's panel and in the top bar of the web page.",
      'The licensor offers the icons as-is and makes no representations or warranties of any kind concerning',
      'them (Section 5 of the license).',
    ].join('\n'),
    uses: {
      'In the extension': 'icons copied into `media/icons.js`',
      'In the web version': 'icons copied into `icons.js`',
    },
  },
};

export interface Target {
  title: string;
  /** Package name → how it is included ("bundled into …", copied files). */
  uses: Map<string, string[]>;
}

/** The parser every product is built on: listed first in every table and under "License texts"; the rest follow in alphabetical order. */
export const FIRST = 'unbash';

/** Package names in the order the notices list them: FIRST, then the others alphabetically. */
export const order = (names: Iterable<string>): string[] =>
  [...names].sort((a, b) => Number(b === FIRST) - Number(a === FIRST) || a.localeCompare(b, 'en'));

const packageDir = (name: string) => path.join(root, 'node_modules', name);

export function packageInfo(name: string): Package {
  if (COPIED[name]) return COPIED[name];
  const json = JSON.parse(fs.readFileSync(path.join(packageDir(name), 'package.json'), 'utf8'));
  const licenseFile = fs.readdirSync(packageDir(name)).find((f) => /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(f));
  if (!licenseFile) throw new Error(`${name} has no license file`);
  const repo = typeof json.repository === 'string' ? json.repository : json.repository?.url ?? '';
  const url = json.homepage ?? repo.replace(/^git\+/, '').replace(/\.git$/, '').replace(/^git:\/\//, 'https://');
  return {
    name,
    version: json.version,
    license: typeof json.license === 'string' ? json.license : String(json.license?.type ?? 'UNKNOWN'),
    url,
    licenseText: fs.readFileSync(path.join(packageDir(name), licenseFile), 'utf8').replace(/\r\n/g, '\n').trim(),
  };
}

/** Packages in a metafile's inputs (node_modules/<name>/… or node_modules/@scope/<name>/…). */
function bundled(metafile: string, key?: string): string[] {
  const json = JSON.parse(fs.readFileSync(metafile, 'utf8'));
  const inputs = Object.keys((key ? json[key] : json).inputs);
  return [...new Set(inputs.map((p) => p.replace(/\\/g, '/').match(/node_modules\/((?:@[^/]+\/)?[^/]+)\//)?.[1]).filter((n): n is string => !!n))];
}

function add(uses: Map<string, string[]>, name: string, use: string): void {
  uses.set(name, [...(uses.get(name) ?? []), use]);
}

/** Builds the extension, the web page and the command-line tool into a temporary directory and lists what they include. */
export function collect(): Target[] {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bash-explainer-notices-'));
  try {
    const node = (args: string[]) => execFileSync(process.execPath, args, { cwd: root, stdio: 'pipe' });
    node(['esbuild.mjs', '--production', `--outfile=${path.join(tmp, 'extension.js')}`, `--metafile=${path.join(tmp, 'extension.json')}`]);
    node(['--import', 'tsx', 'scripts/build-web.ts', `--outdir=${path.join(tmp, 'site')}`, `--metafile=${path.join(tmp, 'web.json')}`]);

    const extension: Target = { title: 'In the extension', uses: new Map() };
    // esbuild.mjs builds one bundle for VS Code on the desktop and one for VS Code on the web.
    for (const name of bundled(path.join(tmp, 'extension.json'), 'node')) add(extension.uses, name, 'bundled into `dist/extension.js`');
    for (const name of bundled(path.join(tmp, 'extension.json'), 'web')) add(extension.uses, name, 'bundled into `dist/web/extension.js`');

    const web: Target = { title: 'In the web version', uses: new Map() };
    for (const name of bundled(path.join(tmp, 'web.json'))) add(web.uses, name, 'bundled into `app.js`');
    node(['--import', 'tsx', 'scripts/build-cli.ts', `--outdir=${path.join(tmp, 'cli')}`, `--metafile=${path.join(tmp, 'cli.json')}`]);
    const cli: Target = { title: 'In the command-line tool (npm package bash-explainer)', uses: new Map() };
    for (const name of bundled(path.join(tmp, 'cli.json'))) add(cli.uses, name, 'bundled into `dist/cli.js`');

    for (const [name, c] of Object.entries(COPIED)) {
      for (const t of [extension, web, cli]) if (c.uses[t.title]) add(t.uses, name, c.uses[t.title]);
    }
    return [extension, web, cli];
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

export function render(targets: Target[]): string {
  const names = order(new Set(targets.flatMap((t) => [...t.uses.keys()])));
  const packages = new Map(names.map((n) => [n, packageInfo(n)]));
  const licenses = [...new Set([...packages.values()].map((p) => p.license))].sort();
  const out: string[] = [
    '# Third-party notices',
    '',
    licenses.includes('CC-BY-4.0')
      ? `Bash Explainer includes the following third-party software and artwork (${licenses.join(', ')}). Their license texts, and for the artwork under CC BY 4.0 the attribution it asks for, are reproduced below.`
      : `Bash Explainer includes the following third-party software (${licenses.join(', ')}). Their license texts are reproduced below.`,
    '',
    '<!-- Generated by `npm run notices` (scripts/notices.ts) from what the builds include. A test fails when this file is out of date. -->',
  ];
  for (const t of targets) {
    out.push('', `## ${t.title}`, '', '| Component | Version | License | Included as |', '| --- | --- | --- | --- |');
    for (const name of order(t.uses.keys())) {
      const p = packages.get(name)!;
      out.push(`| [${name}](${p.url}) | ${p.version} | ${p.license} | ${t.uses.get(name)!.join('; ')} |`);
    }
  }
  out.push('', '## License texts');
  // Packages with the very same license text share one copy.
  const byText = new Map<string, string[]>();
  for (const p of packages.values()) byText.set(p.licenseText, [...(byText.get(p.licenseText) ?? []), p.name]);
  for (const [text, group] of [...byText].sort((a, b) => order([a[1][0], b[1][0]])[0] === a[1][0] ? -1 : 1)) {
    out.push('', `### ${group.join(', ')}`, '', '```text', text, '```');
  }
  return out.join('\n') + '\n';
}

if (require.main === module) {
  const text = render(collect());
  if (process.argv.includes('--check')) {
    if (fs.readFileSync(NOTICES, 'utf8') !== text) {
      console.error('THIRD_PARTY_NOTICES.md is out of date: run `npm run notices`.');
      process.exit(1);
    }
  } else {
    fs.writeFileSync(NOTICES, text);
    console.log(`Wrote ${path.relative(root, NOTICES)}`);
  }
}
