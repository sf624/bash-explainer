// The web page, run for real: built into a temporary directory, served on 127.0.0.1 and driven in
// headless Chromium. Every request to anything but that server is blocked and fails the test, and
// after loading, the browser is put offline while scripts are explained, checked and edited.
// Needs playwright-core's Chromium (npx playwright-core install chromium-headless-shell); skipped
// when it cannot start, unless $BASH_EXPLAINER_BROWSER is set (as in CI).
import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import type { AddressInfo } from 'net';
import * as os from 'os';
import * as path from 'path';
import type { Browser, Frame, Page } from 'playwright-core';

const root = path.join(__dirname, '..');
const TYPES: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png',
};
/** What the page may load: its own files, nothing else. */
const FILES = ['/', '/app.js', '/icon.png', '/page.css', '/panel-host.js', '/panel-page.css', '/panel.css', '/panel.html', '/panel.js', '/theme.css', '/theme-init.js'];
/** Typed into the editor: it must not appear in any request. */
const MARKER = 'secret-7f3a9c';

async function until<T>(what: string, get: () => Promise<T>, ok: (v: T) => boolean, ms = 10000): Promise<T> {
  const end = Date.now() + ms;
  let v = await get();
  while (!ok(v)) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}: ${JSON.stringify(v)}`);
    await new Promise((r) => setTimeout(r, 100));
    v = await get();
  }
  return v;
}

describe('the web page in a browser', function () {
  this.timeout(120000);
  let browser: Browser | undefined;
  let server: http.Server | undefined;
  let dir = '';
  let base = '';

  before(async function () {
    // Playwright exits the process on Node.js before 20 instead of throwing.
    if (Number(process.versions.node.split('.')[0]) < 20) return this.skip();
    try {
      const { chromium } = await import('playwright-core');
      browser = await chromium.launch();
    } catch (e) {
      if (process.env.BASH_EXPLAINER_BROWSER) throw e;
      this.skip();
    }
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bash-explainer-web-'));
    execFileSync(process.execPath, ['--import', 'tsx', 'scripts/build-web.ts', `--outdir=${dir}`], { cwd: root, stdio: 'pipe' });
    // The development version, under /next/ as on GitHub Pages.
    execFileSync(process.execPath, ['--import', 'tsx', 'scripts/build-web.ts', `--outdir=${path.join(dir, 'next')}`, '--channel=next'], { cwd: root, stdio: 'pipe' });
    // The preview of a pull request, under /pr/N/.
    execFileSync(process.execPath, ['--import', 'tsx', 'scripts/build-web.ts', `--outdir=${path.join(dir, 'pr', '123')}`, '--channel=pr', '--pr=123'], { cwd: root, stdio: 'pipe' });
    server = http.createServer((req, res) => {
      const name = path.normalize(decodeURIComponent((req.url ?? '/').split('?')[0])).replace(/^(\.\.[/\\])+/, '');
      let file = path.join(dir, name);
      if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
      if (!file.startsWith(dir) || !fs.existsSync(file)) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' }).end(fs.readFileSync(file));
    });
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  });

  after(async () => {
    await browser?.close();
    await new Promise((r) => (server ? server.close(r) : r(undefined)));
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('switches between the release page and the development page, keeping the script and the language', async () => {
    const ctx = await browser!.newContext();
    const page = await ctx.newPage();
    await page.goto(base);
    assert.strictEqual(await page.locator('#channel-banner').isHidden(), true);
    assert.strictEqual(await page.locator('#dev-link').isVisible(), true);
    await page.locator('#lang').selectOption('ja');
    await page.locator('.cm-content').click();
    await page.keyboard.press('Enter');
    await page.keyboard.insertText('echo NEXTMARK');
    await page.locator('#channel').selectOption('next');
    await page.waitForURL(`${base}next/**`);
    await until('the typed script', () => page.locator('.cm-content').innerText(), (t) => t.includes('NEXTMARK'));
    assert.strictEqual(await page.locator('#channel-banner').isVisible(), true);
    assert.match(await page.locator('#banner-text').innerText(), /開発版/);
    assert.strictEqual(await page.locator('#channel').inputValue(), 'next');
    assert.strictEqual(await page.locator('meta[name=robots]').getAttribute('content'), 'noindex');
    // A link copied here points to this page.
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base.slice(0, -1) });
    // The clipboard is shared by the browser's contexts: empty it, so that the wait below sees this
    // page's link and not one an earlier test copied.
    await page.evaluate('navigator.clipboard.writeText("")');
    await page.locator('#share').click();
    const link = await until('the copied link', () => page.evaluate('navigator.clipboard.readText()') as Promise<string>, (t) => t.includes('#'));
    assert.ok(link.startsWith(`${base}next/#`), link);
    await page.locator('#channel').selectOption('release');
    await page.waitForURL(new RegExp(`^${base}#`));
    await until('the script back', () => page.locator('.cm-content').innerText(), (t) => t.includes('NEXTMARK'));
    await ctx.close();
  });

  it('draws an indent guide in the column of the row border beside what lies under an item, clear of the rows, and none below the last', async () => {
    const ctx = await browser!.newContext();
    const page = await ctx.newPage();
    await page.goto(base);
    const panel = () => page.frames().find((f) => f.url().endsWith('/panel.html'))!;
    await until('the panel', () => Promise.resolve(panel()), (f) => !!f);
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText('echo hello | tr a-z A-Z');
    await until('the line explained', async () => (await panel().locator('#line').textContent()) ?? '', (t) => t.includes('tr a-z'));
    // The parts of the first item with parts: beside what lies under each one but the last, a line in the
    // column of the row's own border that keeps clear of the rows, as an example's rule does.
    const kids = panel().locator('#tree > li > .body > ul > li');
    const n = await kids.count();
    assert.ok(n >= 2, `${n} parts`);
    const info = (i: number) => kids.nth(i).evaluate((li) => {
      const w = li.ownerDocument.defaultView!;
      const body = li.querySelector(':scope > .body');
      if (!body) return { line: false };
      const b = w.getComputedStyle(body, '::before');
      if (b.content === 'none' || b.content === 'normal') return { line: false };
      const box = body.getBoundingClientRect();
      const row = li.querySelector(':scope > .row')!.getBoundingClientRect();
      const next = li.nextElementSibling?.querySelector(':scope > .row')?.getBoundingClientRect();
      const top = box.top + parseFloat(b.top), bottom = box.bottom - parseFloat(b.bottom);
      return {
        line: true, column: box.left === row.left, width: b.borderLeftWidth, style: b.borderLeftStyle,
        clearOfRows: top > row.bottom && (!next || bottom < next.top),
      };
    });
    const lines = [];
    for (let i = 0; i < n; i++) lines.push(await info(i));
    assert.strictEqual(lines.some((l) => l.line), true, 'some part has a line beside what lies under it');
    for (const l of lines.slice(0, -1).filter((l) => l.line)) {
      assert.deepStrictEqual(l, { line: true, column: true, width: '2px', style: 'solid', clearOfRows: true });
    }
    assert.deepStrictEqual(lines[n - 1], { line: false }, 'no line below the last part');
    await ctx.close();
  });

  it('folds a tree row on a click anywhere in it, and still selects its text in the editor', async () => {
    const ctx = await browser!.newContext();
    const page = await ctx.newPage();
    await page.goto(base);
    const panel = () => page.frames().find((f) => f.url().endsWith('/panel.html'))!;
    await until('the panel', () => Promise.resolve(panel()), (f) => !!f);
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText('echo hello | tr a-z A-Z');
    await until('the line explained', async () => (await panel().locator('#line').textContent()) ?? '', (t) => t.includes('tr a-z'));
    const selected = () => page.locator('.cm-selectionBackground').count();
    // The first row with parts, and a row without.
    const parent = () => panel().locator('#tree li:has(> .body > ul)').first();
    const folded = async () => parent().evaluate((li) => li.classList.contains('collapsed'));
    const twisty = async () => (await parent().locator('> .row > .twisty').textContent()) ?? '';
    const leaf = () => panel().locator('#tree li:not(:has(> .body > ul)) > .row').first();

    // A click on the text of the row folds it, and again unfolds it.
    await page.keyboard.press('Home');
    assert.strictEqual(await folded(), false);
    await parent().locator('> .row > .text').click();
    assert.strictEqual(await folded(), true);
    assert.strictEqual(await twisty(), '▸');
    await until('the token selected', selected, (n) => n > 0);
    await parent().locator('> .row > .label').click();
    assert.strictEqual(await folded(), false);
    assert.strictEqual(await twisty(), '▾');

    // The twisty folds once, not twice.
    await parent().locator('> .row > .twisty').click();
    assert.strictEqual(await folded(), true);
    await parent().locator('> .row > .twisty').click();
    assert.strictEqual(await folded(), false);

    // Dragging over the text to select it does not fold.
    const text = parent().locator('> .row > .text');
    const box = (await text.boundingBox())!;
    await page.mouse.move(box.x + 2, box.y + 8);
    await page.mouse.down();
    await page.mouse.move(box.x + 200, box.y + 8, { steps: 5 });
    await page.mouse.up();
    assert.strictEqual(await folded(), false);

    // A row without parts only selects.
    await page.keyboard.press('Home');
    await panel().locator('body').click({ position: { x: 1, y: 1 } });
    const before = await panel().locator('#tree .collapsed').count();
    await leaf().click();
    assert.strictEqual(await panel().locator('#tree .collapsed').count(), before);
    await until('the leaf selected', selected, (n) => n > 0);

    // A fold survives the panel being drawn again for the same line (here by another shell being chosen).
    await panel().evaluate('getSelection().removeAllRanges()');
    await parent().locator('> .row > .text').click();
    assert.strictEqual(await folded(), true);
    await parent().evaluate((li) => ((li as any).mark = 1));
    await panel().locator('#shell').selectOption('dash');
    await until('the panel drawn again', () => parent().evaluate((li) => !(li as any).mark), (redrawn) => redrawn);
    assert.strictEqual(await folded(), true);
    assert.strictEqual(await twisty(), '▸');
    // "Expand all" and "Collapse all" still work.
    await panel().locator('#toggle').click();
    assert.strictEqual(await panel().locator('#tree .collapsed').count(), 0);
    await panel().locator('#toggle').click();
    assert.strictEqual(await folded(), false);
    assert.strictEqual(await panel().locator('#tree .collapsed').count() > 0, true);
    await ctx.close();
  });

  it('shows the preview of a pull request with a banner, and switches to the other pages', async () => {
    const ctx = await browser!.newContext();
    const page = await ctx.newPage();
    await page.goto(`${base}pr/123/`);
    assert.strictEqual(await page.locator('#channel-banner').isVisible(), true);
    assert.match(await page.locator('#banner-text').innerText(), /^Preview of pull request #123 \(commit [0-9a-f]{7}\)\. Not released\.$/);
    assert.strictEqual(await page.locator('#banner-pr').getAttribute('href'), 'https://github.com/sf624/bash-explainer/pull/123');
    assert.match((await page.locator('#banner-commit').getAttribute('href')) ?? '', /\/commit\/[0-9a-f]{7}$/);
    assert.strictEqual(await page.locator('meta[name=robots]').getAttribute('content'), 'noindex');
    assert.strictEqual(await page.locator('#channel').inputValue(), 'pr');
    assert.strictEqual(await page.locator('#dev-link').isHidden(), true);
    await page.locator('#lang').selectOption('ja');
    assert.match(await page.locator('#banner-text').innerText(), /^プルリクエスト #123（コミット [0-9a-f]{7}）のプレビュー。未リリース。$/);
    await page.locator('#channel').selectOption('next');
    await page.waitForURL(`${base}next/**`);
    await page.goBack();
    await page.locator('#channel').selectOption('release');
    await page.waitForURL(new RegExp(`^${base}#`));
    await ctx.close();
  });

  it('has a theme switch (Auto, Light, Dark) that is remembered and works without storage', async () => {
    const LIGHT = 'rgb(255, 255, 255)';
    const DARK = 'rgb(31, 31, 31)';
    const bg = (p: Page | Frame) => p.evaluate('getComputedStyle(document.body).backgroundColor') as Promise<string>;
    const ctx = await browser!.newContext({ colorScheme: 'dark' });
    const page = await ctx.newPage();
    await page.goto(base);
    await until('the panel', () => Promise.resolve(page.frames().find((f) => f.url().endsWith('/panel.html'))), (f) => !!f);
    const panel = () => page.frames().find((f) => f.url().endsWith('/panel.html'))!;
    // Auto follows the system, and the system changing.
    assert.strictEqual(await bg(page), DARK);
    await page.emulateMedia({ colorScheme: 'light' });
    assert.strictEqual(await bg(page), LIGHT);
    assert.strictEqual(await bg(panel()), LIGHT);
    // Dark is dark whatever the system says, in the editor and the panel too, and survives a reload.
    await page.locator('#theme').selectOption('dark');
    assert.strictEqual(await page.evaluate('document.documentElement.dataset.theme'), 'dark');
    assert.strictEqual(await bg(page), DARK);
    assert.strictEqual(await page.evaluate("getComputedStyle(document.querySelector('.cm-editor')).backgroundColor"), DARK);
    await until('the dark panel', () => bg(panel()), (c) => c === DARK);
    await page.reload();
    assert.strictEqual(await page.locator('#theme').inputValue(), 'dark');
    assert.strictEqual(await bg(page), DARK);
    await until('the dark panel after the reload', async () => bg(panel()), (c) => c === DARK);
    // Light, with the system dark.
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.locator('#theme').selectOption('light');
    assert.strictEqual(await bg(page), LIGHT);
    await until('the light panel', () => bg(panel()), (c) => c === LIGHT);
    // The Japanese label.
    await page.locator('#lang').selectOption('ja');
    assert.strictEqual(await page.locator('#theme-label').textContent(), 'テーマ');
    // Auto again forgets the choice.
    await page.locator('#theme').selectOption('auto');
    assert.strictEqual(await page.evaluate('document.documentElement.dataset.theme'), undefined);
    assert.strictEqual(await bg(page), DARK);
    await ctx.close();

    // Storage that throws: the page works, as Auto, and the switch still changes the colours.
    const blocked = await browser!.newContext({ colorScheme: 'dark' });
    await blocked.addInitScript("Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } });");
    const p2 = await blocked.newPage();
    const errors: string[] = [];
    p2.on('pageerror', (e) => errors.push(e.message));
    await p2.goto(base);
    assert.strictEqual(await bg(p2), DARK);
    await p2.locator('#theme').selectOption('light');
    assert.strictEqual(await bg(p2), LIGHT);
    assert.deepStrictEqual(errors, []);
    await blocked.close();
  });

  it('explains, checks and shares scripts without any request to another site, and keeps working offline', async () => {
    const ctx = await browser!.newContext({ viewport: { width: 1400, height: 900 } });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base.slice(0, -1) });
    const requests: { url: string; method: string; body: string }[] = [];
    const elsewhere: string[] = [];
    await ctx.route('**/*', (route) => {
      const r = route.request();
      requests.push({ url: r.url(), method: r.method(), body: r.postData() ?? '' });
      if (r.url().startsWith(base)) return route.continue();
      elsewhere.push(r.url());
      return route.abort();
    });
    const errors: string[] = [];
    const watch = (p: Page) => {
      p.on('pageerror', (e) => errors.push(e.message));
      p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    };
    const page = await ctx.newPage();
    watch(page);
    const panel = (p: Page = page): Frame => p.frames().find((f) => f.url().endsWith('/panel.html'))!;
    const text = (sel: string, p?: Page) => async () => (await panel(p)?.locator(sel).textContent().catch(() => '')) ?? '';

    await page.goto(base);
    await until('the first explanation', text('#where'), (t) => t.includes('Line 8'));

    // From here on, the browser has no network at all.
    await ctx.setOffline(true);
    const editor = page.locator('.cm-content');
    await editor.click();
    await page.keyboard.press('Control+End');
    // Typed key by key, the keys could arrive out of order in CI ("ecret…" with the "s" at the end).
    await page.keyboard.press('Enter');
    await page.keyboard.insertText(`echo "${MARKER}" | tr a-z A-Z`);
    await until('the typed line explained', text('#line'), (t) => t.includes(MARKER));

    // A worked example, edited: the sed line of the sample (test/fixtures/sample.sh).
    const sedLine = fs.readFileSync(path.join(root, 'test/fixtures/sample.sh'), 'utf8').split('\n').findIndex((l) => l.startsWith('sed -E'));
    await page.keyboard.press('Control+Home');
    for (let i = 0; i < sedLine; i++) await page.keyboard.press('ArrowDown');
    await until('the sed line', text('#line'), (t) => t.startsWith('sed -E'));
    await panel().locator('textarea').first().fill('user=alice');
    await until('the rerun example', text('#tree'), (t) => t.includes('alice=user'));

    // Pointing at a part highlights it in the editor.
    await panel().locator('#tree li').first().hover();
    await until('the highlight', () => page.locator('.cm-bx-highlight').count(), (n) => n > 0);

    // Another shell: the problems and their quick fixes.
    await panel().locator('#shell').selectOption('dash');
    await until('the problems for dash', () => page.locator('#problem-list').innerText(), (t) => t.includes('dbracket'));

    // A link to the script, opened online in a new page: the script travels after '#' only.
    // The clipboard is shared by the browser's contexts: empty it, so that the wait below sees this
    // page's link and not one an earlier test copied.
    await page.evaluate('navigator.clipboard.writeText("")');
    await page.locator('#share').click();
    const link = await until('the copied link', () => page.evaluate('navigator.clipboard.readText()') as Promise<string>, (t) => t.includes('#'));
    await ctx.setOffline(false);
    const page2 = await ctx.newPage();
    watch(page2);
    await page2.goto(link);
    await until('the shared script', () => page2.locator('.cm-content').innerText(), (t) => t.includes(MARKER));

    // Japanese, which reloads the panel from the page's own files.
    await page2.locator('#lang').selectOption('ja');
    await until('the Japanese panel', text('#where', page2), (t) => t.includes('行目'));

    await ctx.close();
    assert.deepStrictEqual(elsewhere, [], 'requests to other sites');
    for (const r of requests) {
      assert.strictEqual(r.method, 'GET', r.url);
      assert.ok(FILES.includes(new URL(r.url).pathname), `unexpected request: ${r.url}`);
      assert.strictEqual(new URL(r.url).search, '', r.url);
      assert.ok(!r.url.includes(MARKER) && !r.body.includes(MARKER), `the script was sent: ${r.url}`);
    }
    assert.deepStrictEqual(errors, []);
  });
});
