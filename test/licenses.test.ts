// Bash Explainer is MIT-licensed and passes on the notices of what it includes. These checks keep
// THIRD_PARTY_NOTICES.md true to what the builds actually include, the licenses ones Bash Explainer
// can meet, and the notices shipped with both the extension and the web page.
import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ALLOWED_LICENSES, collect, NOTICES, packageInfo, render, Target } from '../scripts/notices';

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

  it('includes only software under licenses whose terms reproducing the notice meets', () => {
    for (const t of targets) {
      for (const name of t.uses.keys()) {
        const p = packageInfo(name);
        assert.ok(ALLOWED_LICENSES.includes(p.license), `${name} ${p.version} (${t.title.toLowerCase()}) is under ${p.license}: review it, then extend ALLOWED_LICENSES in scripts/notices.ts if it is fine`);
        assert.ok(p.licenseText.length > 100, `${name}: the license text looks empty`);
      }
    }
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
