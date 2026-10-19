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

  it('shows only the explanation panel with ?view=panel, and explains a script posted to it', async () => {
    const ctx = await browser!.newContext();
    const page = await ctx.newPage();
    // The page around: a stub that posts a script to the frame and keeps what the frame says.
    await page.goto(`${base}stub`); // a 404 page of the same origin, with no content security policy
    await page.evaluate(`window.got = []; window.addEventListener('message', (e) => window.got.push(e.data));
      document.body.insertAdjacentHTML('beforeend', '<iframe id="f" src="${base}pr/123/?view=panel" style="width:700px;height:500px"></iframe>');`);
    const ready = await until('the handshake', () => page.evaluate('window.got.find((m) => m.type === "bx-ready") || null') as Promise<Record<string, string> | null>, (m) => !!m);
    assert.strictEqual(ready!.channel, 'pr');
    assert.strictEqual(ready!.pr, '123');
    const f = page.frames().find((x) => x.url().includes('view=panel'))!;
    assert.strictEqual(await f.locator('.top').isHidden(), true);
    assert.strictEqual(await f.locator('.toolbar').isHidden(), true);
    assert.strictEqual(await f.locator('#channel-banner').isHidden(), true);
    assert.strictEqual(await f.locator('#editor').isHidden(), true);
    await page.evaluate(`document.getElementById('f').contentWindow.postMessage({ type: 'bx-state', text: 'echo one\\nsort -u a.txt\\n', kind: 'shell', line: 1, col: 0, lang: 'en', theme: 'auto', choice: {} }, location.origin)`);
    const inner = () => page.frames().find((x) => x.url().endsWith('/pr/123/panel.html') && x !== page.mainFrame())!;
    await until('the line explained', async () => (await inner()?.locator('#line').textContent().catch(() => '')) ?? '', (t) => t.includes('sort -u'));
    // The panel fills the frame.
    const box = await f.locator('#panel').boundingBox();
    assert.ok(box && box.width >= 699 && box.height >= 499, JSON.stringify(box));
    // A click on a row asks the page around to select.
    await inner().locator('.row .label').nth(1).click();
    const reveal = await until('the reveal', () => page.evaluate('window.got.find((m) => m.type === "bx-reveal") || null') as Promise<{ span: { start: { line: number } } } | null>, (m) => !!m);
    assert.strictEqual(reveal!.span.start.line, 1);
    await ctx.close();
  });

  it('compares a pull request with main: typing goes to both panels, and a click in either selects in the editor', async () => {
    const ctx = await browser!.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`${base}pr/123/`);
    assert.strictEqual(await page.locator('#banner-compare').textContent(), 'Compare with main');
    await page.locator('#banner-compare').click();
    await page.waitForURL(`${base}pr/123/compare.html**`);
    await page.locator('.cm-content').waitFor();
    const mine = () => page.frames().find((f) => f.url().endsWith('/pr/123/panel.html'));
    const main = () => page.frames().find((f) => f.url().endsWith('/next/panel.html'));
    await until('both panels', () => Promise.resolve([mine(), main()]), (fs) => fs.every(Boolean));
    // Three columns of about the same width.
    const cols = await page.locator('.compare > section').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().width)));
    assert.strictEqual(cols.length, 3);
    assert.ok(Math.max(...cols) - Math.min(...cols) <= 2, cols.join());
    await until('the headers', () => page.locator('.copy-head').allInnerTexts(), (t) => /^PR #123 \([0-9a-f]{7}\)$/.test(t[1]) && /^main \([0-9a-f]{7}\)$/.test(t[2]));
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText('echo hello | tr a-z A-Z');
    for (const f of [mine, main]) await until('the line explained', async () => (await f()!.locator('#line').textContent().catch(() => '')) ?? '', (t) => t.includes('tr a-z'));
    // A click on a tree row in either panel selects its token in the editor.
    for (const [f, text] of [[mine, 'echo'], [main, 'tr']] as const) {
      await page.keyboard.press('Control+Home');
      await page.evaluate('window.getSelection().removeAllRanges()');
      const before = await page.locator('.cm-selectionBackground').count();
      await f()!.locator('.row .label', { hasText: new RegExp(`^${text}$`) }).first().click();
      await until(`${text} selected`, () => page.evaluate('document.querySelector(".cm-content").ownerDocument.defaultView.getSelection().toString()') as Promise<string>, (t) => t.trim().startsWith(text) && t.length < 20);
      void before;
    }
    // The editor's own choice of language reaches both.
    await page.locator('#lang').selectOption('ja');
    for (const f of [mine, main]) await until('Japanese', async () => (await f()!.locator('#tree').textContent().catch(() => '')) ?? '', (t) => /[ぁ-ん]/.test(t));
    await ctx.close();
  });

  it('says so when the other copy of the comparison does not answer, and carries the script over from the page', async () => {
    const ctx = await browser!.newContext();
    const page = await ctx.newPage();
    // The release page of the stub has no panel-only view: it is a page that never answers.
    await page.route(`${base}?view=panel`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<p>old page</p>' }));
    await page.goto(`${base}next/`);
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText('echo CARRIED');
    assert.strictEqual(await page.locator('#banner-compare').textContent(), 'Compare with release');
    await page.locator('#banner-compare').click();
    await page.waitForURL(`${base}next/compare.html**`);
    await until('the script', () => page.locator('.cm-content').innerText(), (t) => t.includes('CARRIED'));
    assert.strictEqual(await page.locator('#note-other').isVisible(), false);
    await until('the message', () => page.locator('#note-other').isVisible(), (v) => v, 15000);
    assert.match(await page.locator('#note-other').innerText(), /^This version cannot be compared/);
    assert.strictEqual(await page.locator('#note-this').isHidden(), true);
    assert.strictEqual(await page.locator('#frame-other').isHidden(), true);
    // The same for a page that is not there.
    await page.unroute(`${base}?view=panel`);
    await page.route(`${base}?view=panel`, (route) => route.fulfill({ status: 404, body: '' }));
    await page.reload();
    await until('the message', () => page.locator('#note-other').isVisible(), (v) => v, 15000);
    assert.strictEqual(await page.locator('#frame-this').isVisible(), true);
    await ctx.close();
  });

  it('draws the compare page without sideways scrolling on a phone, and stacks it below 1000px', async () => {
    const { devices } = await import('playwright-core');
    const ctx = await browser!.newContext({ ...devices['iPhone 13'] });
    const page = await ctx.newPage();
    await page.goto(`${base}pr/123/compare.html`);
    await page.locator('.cm-line').first().waitFor();
    await until('the headers', () => page.locator('.copy-head').allInnerTexts(), (t) => /^PR #123/.test(t[1]) && /^main/.test(t[2]));
    assert.strictEqual(await page.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), true);
    const tops = await page.locator('.compare > section').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
    assert.ok(tops[0] < tops[1] && tops[1] < tops[2], tops.join());
    await ctx.close();
    const wide = await browser!.newContext({ viewport: { width: 900, height: 800 } });
    const p2 = await wide.newPage();
    await p2.goto(`${base}pr/123/compare.html`);
    await p2.locator('.cm-line').first().waitFor();
    const rects = await p2.locator('.compare > section').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { top: Math.round(r.top), left: Math.round(r.left) }; }));
    assert.strictEqual(rects[1].top, rects[2].top);
    assert.ok(rects[0].top < rects[1].top && rects[1].left < rects[2].left, JSON.stringify(rects));
    assert.strictEqual(await p2.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), true);
    await wide.close();
  });

  it('shows a selection made with Shift and the arrow keys on the line of the cursor', async () => {
    const ctx = await browser!.newContext();
    const page = await ctx.newPage();
    await page.goto(base);
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText('echo hello world');
    for (let i = 0; i < 6; i++) await page.keyboard.press('Shift+ArrowLeft');
    assert.strictEqual(await page.locator('.cm-selectionBackground').count() > 0, true);
    // The active line lies over the selection layer: its background must let the selection show through.
    const alpha = await page.locator('.cm-activeLine').evaluate((el) => {
      const c = (globalThis as any).getComputedStyle(el).backgroundColor as string;
      const m = /rgba?\(([^)]*)\)/.exec(c);
      const parts = m ? m[1].split(',').map((x) => parseFloat(x)) : [];
      return parts.length === 4 ? parts[3] : 1;
    });
    assert.ok(alpha < 0.5, `the active line's background alpha is ${alpha}`);
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

  it('on a phone, tapping a row of the explanation selects its token without focusing the editor, and the page does not scroll sideways', async () => {
    const { devices } = await import('playwright-core');
    const ctx = await browser!.newContext({ ...devices['iPhone 13'] });
    const page = await ctx.newPage();
    await page.goto(base);
    await page.locator('#sample').tap();
    await page.locator('.cm-line').nth(3).waitFor();
    assert.strictEqual(await page.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), true);
    assert.strictEqual(await page.evaluate('window.matchMedia("(pointer: fine)").matches'), false);
    const panel = page.frames().find((f) => f.url().endsWith('/panel.html'))!;
    await until('the tree', () => panel.locator('.row .label').count(), (n) => n > 1);
    // The editor was not focused by the tap on "Load the sample" either; make sure of the start.
    await page.evaluate('document.activeElement && document.activeElement.blur()');
    await panel.locator('.row .label').nth(1).tap();
    await until('the selection', () => page.locator('.cm-selectionBackground').count(), (n) => n > 0);
    assert.strictEqual(await page.evaluate('!!document.activeElement && !!document.activeElement.closest(".cm-content")'), false);
    // In the narrow panel a long label may take the whole row (it was cut at 45% of it).
    const share = await panel.evaluate('(() => { const l = document.querySelector(".row .label"); return l.getBoundingClientRect().width / l.parentElement.getBoundingClientRect().width; })()') as number;
    assert.ok(share > 0.6, String(share));
    // ...and its explanation then goes under it, not into a narrow column beside it.
    const below = await panel.evaluate('(() => { const r = document.querySelector(".row"); return r.querySelector(".text").getBoundingClientRect().top >= r.querySelector(".label").getBoundingClientRect().bottom - 1; })()');
    assert.strictEqual(below, true);
    // ...with the fold mark and the label on one line.
    const oneLine = await panel.evaluate('(() => { const r = document.querySelector(".row"); return Math.abs(r.querySelector(".twisty").getBoundingClientRect().top - r.querySelector(".label").getBoundingClientRect().top) < 8; })()');
    assert.strictEqual(oneLine, true);
    // Nothing in the toolbar is cut: every option fits its select (measured with the select's font), in both languages.
    for (const lang of ['en', 'ja']) {
      await page.locator('#lang').selectOption(lang);
      const clipped = await page.evaluate(`(() => {
        const c = document.createElement('canvas').getContext('2d');
        const bad = [];
        for (const s of document.querySelectorAll('.toolbar select')) {
          const cs = getComputedStyle(s);
          c.font = cs.font;
          const room = s.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
          const widest = Math.max(...[...s.options].map((o) => c.measureText(o.text).width));
          if (widest > room) bad.push(s.id + ' ' + Math.round(widest) + ' > ' + Math.round(room));
        }
        for (const b of document.querySelectorAll('.toolbar button')) if (b.scrollWidth > b.clientWidth) bad.push(b.id);
        return bad;
      })()`);
      assert.deepStrictEqual(clipped, [], lang);
    }
    // The toolbar is three rows of two, no taller than it was (173px) when it had five rows of small controls.
    const toolbar = await page.evaluate('document.querySelector(".toolbar").getBoundingClientRect().height') as number;
    assert.ok(toolbar < 175, String(toolbar));
    // The controls of the toolbar are big enough to tap.
    const small = await page.evaluate('[...document.querySelectorAll(".toolbar select, .toolbar button")].filter((e) => e.getBoundingClientRect().height < 43).length');
    assert.strictEqual(small, 0);
    await ctx.close();
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

    // A skeleton label (the `while` line of the sample): code in monospace, placeholders apart in muted italics.
    const whileLine = fs.readFileSync(path.join(root, 'test/fixtures/sample.sh'), 'utf8').split('\n').findIndex((l) => l.startsWith('while read'));
    // The keys must reach the editor again: hovering the panel left the focus there.
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+Home');
    for (let i = 0; i < whileLine; i++) await page.keyboard.press('ArrowDown');
    await until('the while line', text('#line'), (t) => t.startsWith('while read'));
    const label = panel().locator('#tree .label').first();
    assert.strictEqual(await label.innerText(), 'while condition do commands done < input.txt');
    const style = 'el => { const c = getComputedStyle(el); return { style: c.fontStyle, color: c.color, family: c.fontFamily }; }';
    const ph = (await label.locator('.ph').first().evaluate(style)) as { style: string; color: string; family: string };
    const parent = (await label.evaluate(style)) as { style: string; color: string; family: string };
    assert.strictEqual(ph.style, 'italic');
    assert.notStrictEqual(ph.family, parent.family);
    assert.notStrictEqual(ph.color, parent.color);

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
