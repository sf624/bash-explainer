// The README of a package page (Marketplace, Open VSX, npm) must show the images and links of its own
// version: pinned to the release's tag, not to HEAD or main (scripts/readme-pins.ts, docs/publishing.md).
import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { findUnpinned, pinnedImages, pinReadme, readZipEntry, stripDevelopmentNote, withoutUnreleased } from '../scripts/readme-pins';

const root = path.join(__dirname, '..');
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), 'utf8');
const BASE = 'https://github.com/sf624/bash-explainer';
const RAW = 'https://raw.githubusercontent.com/sf624/bash-explainer';

describe('pinning a README to a tag', () => {
  const pin = (text: string, dir = '') => pinReadme(text, dir, 'v1.2.3');

  it('turns relative links into links at the tag, and relative images into raw images at the tag', () => {
    assert.strictEqual(pin('[a](docs/x.md#top) ![b](images/b.png "t")'), `[a](${BASE}/blob/v1.2.3/docs/x.md#top) ![b](${RAW}/v1.2.3/images/b.png "t")`);
    assert.strictEqual(pin('[a](./README.ja.md) [b](/LICENSE) [c](docs/)'), `[a](${BASE}/blob/v1.2.3/README.ja.md) [b](${BASE}/blob/v1.2.3/LICENSE) [c](${BASE}/tree/v1.2.3/docs/)`);
  });

  it('resolves a relative target against the README\'s directory', () => {
    assert.strictEqual(pin('![x](../images/a.png) [l](../LICENSE) [m](sub/f.md)', 'cli'), `![x](${RAW}/v1.2.3/images/a.png) [l](${BASE}/blob/v1.2.3/LICENSE) [m](${BASE}/blob/v1.2.3/cli/sub/f.md)`);
    assert.throws(() => pin('[x](../../etc/passwd)', 'cli'), /leaves the repository/);
  });

  it('treats an image inside a link, a reference definition and an HTML tag as what they are', () => {
    assert.strictEqual(pin('[![b](images/b.png)](docs/b.md)'), `[![b](${RAW}/v1.2.3/images/b.png)](${BASE}/blob/v1.2.3/docs/b.md)`);
    assert.strictEqual(pin('[ref]: docs/x.md\n[pic]: images/p.png'), `[ref]: ${BASE}/blob/v1.2.3/docs/x.md\n[pic]: ${RAW}/v1.2.3/images/p.png`);
    assert.strictEqual(pin('<img src="images/a.png" width="10"> <a href="docs/a.md">a</a>'), `<img src="${RAW}/v1.2.3/images/a.png" width="10"> <a href="${BASE}/blob/v1.2.3/docs/a.md">a</a>`);
  });

  it('moves a URL that names main or HEAD to the tag, and leaves other URLs alone', () => {
    assert.strictEqual(pin(`![a](${RAW}/main/images/a.png) [b](${BASE}/blob/HEAD/x.md) [c](${BASE}/raw/main/y.png) [d](${BASE}/tree/main/z)`),
      `![a](${RAW}/v1.2.3/images/a.png) [b](${BASE}/blob/v1.2.3/x.md) [c](${BASE}/raw/v1.2.3/y.png) [d](${BASE}/tree/v1.2.3/z)`);
    const same = `[a](#top) [b](mailto:a@b.c) [c](https://example.com/x.png) ![d](https://img.shields.io/x.svg) [e](${BASE}/releases/latest) [f](${BASE}/blob/v0.9.0/old.md) [g](data:text/plain,x)`;
    assert.strictEqual(pin(same), same);
  });

  it('is what findUnpinned accepts', () => {
    const text = '![a](images/a.png) [b](docs/b.md) ![c](../x.png)';
    assert.strictEqual(findUnpinned(text, 'v1.2.3').length, 3);
    assert.deepStrictEqual(findUnpinned(pin(text, 'cli'), 'v1.2.3'), []);
    assert.deepStrictEqual(pinnedImages(pin(text, 'cli'), 'v1.2.3'), [`${RAW}/v1.2.3/cli/images/a.png`, `${RAW}/v1.2.3/x.png`]);
  });
});

describe('checking a packaged README', () => {
  it('names what is relative, on a branch or on another tag', () => {
    const text = `![a](images/a.png) ![b](${RAW}/main/b.png) [c](${BASE}/blob/HEAD/c.md) [d](${BASE}/blob/v0.9.0/d.md) [e](${BASE}/blob/v1.0.0/e.md)`;
    assert.deepStrictEqual(findUnpinned(text, 'v1.0.0').map((u) => u.why), [
      'a relative link (it resolves to the default branch)', 'pinned to main, not v1.0.0', 'pinned to HEAD, not v1.0.0', 'pinned to v0.9.0, not v1.0.0',
    ]);
    // A changelog links to the tags of its older versions, but not to a branch.
    assert.deepStrictEqual(findUnpinned(text, 'v1.0.0', true).map((u) => u.url), ['images/a.png', `${RAW}/main/b.png`, `${BASE}/blob/HEAD/c.md`]);
  });

  it('leaves the Unreleased section of the changelog out', () => {
    const log = `# Changelog\n\n## Unreleased\n\n[x](${BASE}/blob/main/docs/changes/unreleased.md)\n\n## 0.8.0\n\n[y](${BASE}/blob/v0.8.0/a.md)\n`;
    assert.strictEqual(withoutUnreleased(log), `# Changelog\n\n## 0.8.0\n\n[y](${BASE}/blob/v0.8.0/a.md)\n`);
    assert.strictEqual(withoutUnreleased('## Unreleased\n\nonly\n'), '');
    assert.strictEqual(withoutUnreleased(undefined), undefined);
  });

  it('takes the development note out of the README, and requires exactly one', () => {
    for (const name of ['README.md', 'README.ja.md']) {
      const text = read(name);
      assert.strictEqual(text.split('<!-- development-note -->').length, 2, `${name} has one note`);
      const stripped = stripDevelopmentNote(text);
      assert.doesNotMatch(stripped, /development-note/);
      assert.ok(stripped.length < text.length);
    }
    assert.throws(() => stripDevelopmentNote('# no note'), /exactly one/);
    assert.throws(() => stripDevelopmentNote('<!-- development-note -->a<!-- /development-note -->\n<!-- development-note -->b<!-- /development-note -->'), /exactly one/);
  });

  it('says when a file is not a zip', () => {
    assert.throws(() => readZipEntry(Buffer.from('not a zip file at all, not a zip'), 'x'), /not a zip file/);
  });
});

describe('the READMEs in the repository', () => {
  /** The relative targets of a README (not the pinned ones: those are made at package time). */
  function relative(text: string): string[] {
    return findUnpinned(text, 'v0.0.0').filter((u) => /relative/.test(u.why)).map((u) => u.url.replace(/[?#].*$/, '')).filter(Boolean);
  }

  for (const [file, dir] of [['README.md', '.'], ['README.ja.md', '.'], ['cli/README.md', 'cli']]) {
    it(`${file} links only to files that exist, and to no URL of this repository on a branch`, () => {
      const text = read(file);
      assert.ok(relative(text).length > 0, 'it has relative targets');
      for (const url of relative(text)) assert.ok(fs.existsSync(path.join(root, dir, url)), `${file}: ${url} does not exist`);
      assert.doesNotMatch(text, /(raw\.githubusercontent\.com|github\.com)\/sf624\/bash-explainer\/((blob|raw|tree)\/)?(main|HEAD|master)\//, file);
    });
  }

  it('README.md and README.ja.md use the images in images/readme/', () => {
    for (const file of ['README.md', 'README.ja.md']) {
      const images = relative(read(file)).filter((u) => /\.(gif|png)$/.test(u));
      assert.ok(images.length >= 4, file);
      for (const image of images) assert.match(image, /^images\/readme\//, `${file}: ${image}`);
    }
  });
});

describe('the packages, as the Release workflow builds them', function () {
  this.timeout(120000);
  let dir = '';
  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bash-explainer-pins-'));
  });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const version: string = JSON.parse(read('package.json')).version;
  const tag = `v${version}`;

  it('pins the extension\'s README and changelog to the tag and drops the development note', () => {
    // The files that go into the .vsix, with stubs for the bundles (the build is not this test's business).
    const copy = path.join(dir, 'extension');
    fs.mkdirSync(path.join(copy, 'dist', 'web'), { recursive: true });
    fs.writeFileSync(path.join(copy, 'dist', 'extension.js'), '// stub\n');
    fs.writeFileSync(path.join(copy, 'dist', 'web', 'extension.js'), '// stub\n');
    fs.cpSync(path.join(root, 'media'), path.join(copy, 'media'), { recursive: true });
    for (const f of ['package.json', 'package.nls.json', 'package.nls.ja.json', 'README.md', 'CHANGELOG.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', '.vscodeignore']) fs.copyFileSync(path.join(root, f), path.join(copy, f));
    const vsix = path.join(dir, 'x.vsix');
    execFileSync(process.execPath, ['--import', 'tsx', 'scripts/package-vsix.ts', '--root', copy, '--out', vsix], { cwd: root, stdio: 'pipe' });

    const zip = fs.readFileSync(vsix);
    const readme = readZipEntry(zip, 'extension/README.md')!;
    assert.strictEqual(readZipEntry(zip, 'extension/readme.md'), readme, 'found by its name in any case');
    assert.strictEqual(readZipEntry(zip, 'extension/none.md'), undefined);
    assert.deepStrictEqual(findUnpinned(readme, tag), []);
    assert.deepStrictEqual(pinnedImages(readme, tag).map((u) => u.replace(`${BASE}/raw/${tag}/`, '')).sort(),
      ['images/readme/demo.gif', 'images/readme/hover.gif', 'images/readme/name-hints.png', 'images/readme/panel.gif']);
    assert.doesNotMatch(readme, /describes the development version on/);
    assert.deepStrictEqual(findUnpinned(withoutUnreleased(readZipEntry(zip, 'extension/CHANGELOG.md'))!, tag, true), []);
    // The program says the same, and fails for another tag.
    const check = (t: string) => execFileSync(process.execPath, ['--import', 'tsx', 'scripts/readme-pins.ts', '--vsix', vsix, '--tag', t], { cwd: root, stdio: 'pipe', encoding: 'utf8' });
    assert.match(check(tag), /pinned to/);
    assert.throws(() => check('v99.0.0'), /not pinned to v99\.0\.0/);
  });

  it('pins the npm package\'s README to the tag', () => {
    const cli = path.join(dir, 'cli');
    const build = (...extra: string[]) => execFileSync(process.execPath, ['--import', 'tsx', 'scripts/build-cli.ts', `--outdir=${cli}`, ...extra], { cwd: root, stdio: 'pipe' });
    build();
    assert.ok(findUnpinned(fs.readFileSync(path.join(cli, 'README.md'), 'utf8'), tag).length > 0, 'without --tag the README is the source\'s');
    build(`--tag=${tag}`);
    execFileSync('npm', ['pack', cli, '--pack-destination', dir, '--silent'], { stdio: 'pipe' });
    const tgz = path.join(dir, `bash-explainer-${JSON.parse(read('cli', 'package.json')).version}.tgz`);
    const out = execFileSync(process.execPath, ['--import', 'tsx', 'scripts/readme-pins.ts', '--tgz', tgz, '--tag', tag], { cwd: root, stdio: 'pipe', encoding: 'utf8' });
    assert.match(out, new RegExp(`pinned to ${tag}`));
    assert.deepStrictEqual(pinnedImages(execFileSync('tar', ['-xzOf', tgz, 'package/README.md'], { encoding: 'utf8' }), tag), [`${RAW}/${tag}/images/action-annotations.png`]);
    assert.throws(() => execFileSync(process.execPath, ['--import', 'tsx', 'scripts/build-cli.ts', `--tag=${tag}`], { cwd: root, stdio: 'pipe' }), /--tag needs another --outdir/);
  });
});
