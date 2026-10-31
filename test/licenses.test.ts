// Bash Explainer is MIT-licensed and passes on the notices of what it includes. These checks keep
// THIRD_PARTY_NOTICES.md true to what the builds actually include, the licenses ones Bash Explainer
// can meet, and the notices shipped with both the extension and the web page.
import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ALLOWED_LICENSES, collect, COPIED, FIRST, NOTICES, order, packageInfo, render, Target } from '../scripts/notices';

const root = path.join(__dirname, '..');

describe('licenses', function () {
  this.timeout(120000);
  let targets: Target[];
  before(() => {
    targets = collect();
  });

  it('THIRD_PARTY_NOTICES.md lists exactly what the extension and the web page include (npm run notices)', () => {
    assert.strictEqual(fs.readFileSync(NOTICES, 'utf8'), render(targets), 'THIRD_PARTY_NOTICES.md is out of date: run `npm run notices` and check the changes');
  });

  it('lists unbash, the parser, first in every table and under "License texts", then the rest alphabetically', () => {
    assert.deepStrictEqual(order(['w3c-keyname', 'unbash', '@codemirror/view', 'crelt']), [FIRST, '@codemirror/view', 'crelt', 'w3c-keyname']);
    const text = fs.readFileSync(NOTICES, 'utf8');
    for (const section of text.split(/^## /m).slice(1)) {
      const first = /^\| \[([^\]]+)\]|^### (.+)$/m.exec(section.replace(/^[^\n]*\n/, ''));
      assert.strictEqual(first?.[1] ?? first?.[2], FIRST, section.split('\n')[0]);
    }
  });

  it('includes only software under licenses whose terms reproducing the notice meets', () => {
    for (const t of targets) {
      for (const name of t.uses.keys()) {
        const p = packageInfo(name);
        assert.ok(ALLOWED_LICENSES.includes(p.license), `${name} ${p.version} (${t.title.toLowerCase()}) is under ${p.license}: review it, then extend ALLOWED_LICENSES in scripts/notices.ts if it is fine`);
        assert.ok(p.licenseText.length > 100, `${name}: the license text looks empty`);
      }
    }
  });

  it('lists the Codicons the panel and the web page draw, by name, with their license at the icons', () => {
    const js = fs.readFileSync(path.join(root, 'media', 'icons.js'), 'utf8');
    const table = js.slice(js.indexOf('const ICONS'), js.indexOf('});', js.indexOf('const ICONS')));
    const names = [...table.matchAll(/^ {4}'([a-z-]+)': /gm)].map((m) => m[1]);
    const c = COPIED['@vscode/codicons'];
    assert.match(c.licenseText, new RegExp(`\\(${names.join(', ')}\\)`.replace(/, /g, ',\\s+')), 'the notice names the icons media/icons.js has');
    assert.match(c.licenseText, new RegExp(`${({ 7: 'seven', 9: 'nine', 11: 'eleven', 12: 'twelve' } as Record<number, string>)[names.length] ?? String(names.length)} of the icons`));
    assert.match(js, /@vscode\/codicons 0\.0\.46-24[^]*CC BY 4\.0, \(c\) Microsoft Corporation/);
    assert.ok(js.includes(`@vscode/codicons ${c.version}`));
    // Every icon of the table is drawn somewhere (the notice names no icon we do not use), and nothing draws
    // an icon the table lacks: the panel's markup and script, and the web page's markup and scripts.
    const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), 'utf8');
    const sources = [read('src', 'ui', 'panelView.ts'), read('src', 'ui', 'panelHead.ts'), read('media', 'panel.js'), read('web', 'index.html'), read('web', 'compare.html')];
    // (The web page's hover cards draw the icons that src/ui/hoverView.ts names, from the list in web/hover-markdown.ts;
    // the levels' icons are the level table's, src/levels.ts.)
    const drawn = new Set([...sources, read('web', 'hover-markdown.ts'), read('src', 'levels.ts')].flatMap((text) => [...text.matchAll(/data-icon="([a-z-]+)"|'([a-z-]+)'/g)].map((m) => m[1] ?? m[2])).filter((n) => names.includes(n)));
    for (const text of sources) for (const m of text.matchAll(/data-icon="([^"]+)"/g)) assert.ok(names.includes(m[1]), `${m[1]} is not in media/icons.js`);
    assert.deepStrictEqual([...drawn].sort(), [...names].sort());
    // Both products ship the file, and the notice says where.
    assert.strictEqual(c.uses['In the extension'], 'icons copied into `media/icons.js`');
    assert.strictEqual(c.uses['In the web version'], 'icons copied into `icons.js`');
    assert.match(read('scripts', 'build-web.ts'), /copy\('media\/icons\.js'\)/);
    for (const page of ['index.html', 'compare.html']) assert.ok(read('web', page).includes('<script src="icons.js"></script>\n<script src="app.js"></script>'), page);
  });

  it('names the VS Code whose default themes src/ui/vscodeThemes.json copies, and only those', () => {
    const copy = JSON.parse(fs.readFileSync(path.join(root, 'src', 'ui', 'vscodeThemes.json'), 'utf8')) as { vscode: string; files: Record<string, unknown> };
    const c = COPIED['microsoft/vscode'];
    assert.strictEqual(c.version, copy.vscode);
    assert.ok(c.licenseText.includes(`of VS Code ${copy.vscode}:`));
    assert.deepStrictEqual(Object.keys(copy.files).filter((f) => !f.startsWith('theme-defaults/themes/')), []);
  });

  it('is itself under the MIT License', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    assert.strictEqual(pkg.license, 'MIT');
    assert.match(fs.readFileSync(path.join(root, 'LICENSE'), 'utf8'), /^MIT License\n\nCopyright \(c\) \d{4} /);
  });

  it('ships the license and the notices in the .vsix', () => {
    const shipped = fs.readFileSync(path.join(root, '.vscodeignore'), 'utf8').split(/\r?\n/);
    for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) assert.ok(shipped.includes(`!${file}`), `.vscodeignore leaves out ${file}`);
  });

  it('ships the license and the notices in the npm package, at the same version as the extension', () => {
    const cli = JSON.parse(fs.readFileSync(path.join(root, 'cli', 'package.json'), 'utf8'));
    const extension = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    assert.strictEqual(cli.license, 'MIT');
    assert.strictEqual(cli.version, extension.version, 'cli/package.json and package.json must have the same version');
    for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'dist/cli.js']) assert.ok(cli.files.includes(file), `cli/package.json leaves out ${file}`);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bash-explainer-cli-'));
    try {
      execFileSync(process.execPath, ['--import', 'tsx', 'scripts/build-cli.ts', `--outdir=${dir}`], { cwd: root, stdio: 'pipe' });
      assert.strictEqual(fs.readFileSync(path.join(dir, 'LICENSE'), 'utf8'), fs.readFileSync(path.join(root, 'LICENSE'), 'utf8'));
      assert.strictEqual(fs.readFileSync(path.join(dir, 'THIRD_PARTY_NOTICES.md'), 'utf8'), fs.readFileSync(NOTICES, 'utf8'));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ships the license and the notices with the web page, linked from it', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bash-explainer-site-'));
    try {
      execFileSync(process.execPath, ['--import', 'tsx', 'scripts/build-web.ts', `--outdir=${dir}`], { cwd: root, stdio: 'pipe' });
      assert.strictEqual(fs.readFileSync(path.join(dir, 'LICENSE.txt'), 'utf8'), fs.readFileSync(path.join(root, 'LICENSE'), 'utf8'));
      assert.strictEqual(fs.readFileSync(path.join(dir, 'THIRD_PARTY_NOTICES.txt'), 'utf8'), fs.readFileSync(NOTICES, 'utf8'));
      const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
      assert.match(html, /href="LICENSE\.txt"/);
      assert.match(html, /href="THIRD_PARTY_NOTICES\.txt"/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
