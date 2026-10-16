// Generates THIRD_PARTY_NOTICES.md from what the builds actually include: the packages esbuild
// bundled (from its metafile) and the wasm files copied next to the bundles.
// Usage: npx tsx scripts/notices.ts [--check]   (--check: fail if the file is out of date)
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const root = path.join(__dirname, '..');
export const NOTICES = path.join(root, 'THIRD_PARTY_NOTICES.md');

/** Licenses whose terms the MIT-licensed Bash Explainer can meet by reproducing their text. */
export const ALLOWED_LICENSES = ['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD'];

/** The files the builds copy as they are, and the package each comes from. */
export const ASSETS: Record<string, string> = {
  'tree-sitter.wasm': 'web-tree-sitter',
  'tree-sitter-bash.wasm': 'tree-sitter-bash',
};

export interface Package {
  name: string;
  version: string;
  license: string;
  url: string;
  licenseText: string;
}

export interface Target {
  title: string;
  /** Package name → how it is included ("bundled into …", copied files). */
  uses: Map<string, string[]>;
}

const packageDir = (name: string) => path.join(root, 'node_modules', name);

export function packageInfo(name: string): Package {
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

/** Builds the extension and the web page into a temporary directory and lists what they include. */
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
    // esbuild.mjs copies the wasm files into dist/, which the .vsix includes.
    for (const file of fs.readdirSync(path.join(root, 'dist')).filter((f) => f.endsWith('.wasm')).sort()) add(extension.uses, owner(file), `\`dist/${file}\``);

    const web: Target = { title: 'In the web version', uses: new Map() };
    for (const name of bundled(path.join(tmp, 'web.json'))) add(web.uses, name, 'bundled into `app.js`');
    for (const file of fs.readdirSync(path.join(tmp, 'site')).filter((f) => f.endsWith('.wasm')).sort()) add(web.uses, owner(file), `\`${file}\``);
    node(['--import', 'tsx', 'scripts/build-cli.ts', `--outdir=${path.join(tmp, 'cli')}`, `--metafile=${path.join(tmp, 'cli.json')}`]);
    const cli: Target = { title: 'In the command-line tool (npm package bash-explainer)', uses: new Map() };
    for (const name of bundled(path.join(tmp, 'cli.json'))) add(cli.uses, name, 'bundled into `dist/cli.js`');
    for (const file of fs.readdirSync(path.join(tmp, 'cli', 'dist')).filter((f) => f.endsWith('.wasm')).sort()) add(cli.uses, owner(file), `\`dist/${file}\``);

    return [extension, web, cli];
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function owner(file: string): string {
  const name = ASSETS[file];
  if (!name) throw new Error(`${file} is shipped, but scripts/notices.ts does not know which package it comes from (ASSETS)`);
  return name;
}

export function render(targets: Target[]): string {
  const names = [...new Set(targets.flatMap((t) => [...t.uses.keys()]))].sort();
  const packages = new Map(names.map((n) => [n, packageInfo(n)]));
  const licenses = [...new Set([...packages.values()].map((p) => p.license))].sort();
  const out: string[] = [
    '# Third-party notices',
    '',
    `Bash Explainer includes the following third-party software (${licenses.join(', ')}). Their license texts are reproduced below.`,
    '',
    '<!-- Generated by `npm run notices` (scripts/notices.ts) from what the builds include. A test fails when this file is out of date. -->',
  ];
  for (const t of targets) {
    out.push('', `## ${t.title}`, '', '| Component | Version | License | Included as |', '| --- | --- | --- | --- |');
    for (const name of [...t.uses.keys()].sort()) {
      const p = packages.get(name)!;
      out.push(`| [${name}](${p.url}) | ${p.version} | ${p.license} | ${t.uses.get(name)!.join('; ')} |`);
    }
  }
  out.push('', '## License texts');
  // Packages with the very same license text share one copy.
  const byText = new Map<string, string[]>();
  for (const p of packages.values()) byText.set(p.licenseText, [...(byText.get(p.licenseText) ?? []), p.name]);
  for (const [text, group] of [...byText].sort((a, b) => a[1][0].localeCompare(b[1][0]))) {
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
