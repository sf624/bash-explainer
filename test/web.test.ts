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

/**
 * Chooses a value in a select of the page's menu (the language, the theme, the version), opening the
 * menu first and closing it after; the compare page has these in its top bar.
 */
async function choose(page: Page, id: string, value: string): Promise<void> {
  const drawer = page.locator('#drawer');
  if (await drawer.count()) {
    if (!(await drawer.evaluate((d) => (d as unknown as { open: boolean }).open))) await page.locator('#menu-open').click();
  }
  await page.locator(id).selectOption(value);
  // The version is another page: the menu then went with the page.
  await page.evaluate("document.getElementById('drawer')?.close()").catch(() => undefined);
}

/** Presses an item of the page's menu (the panel's own header is not shown on the page). */
async function menuItem(page: Page, id: string): Promise<void> {
  await page.locator('#menu-open').click();
  await page.locator(id).click();
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
    // The link to the development version is in the menu.
    assert.strictEqual(await page.locator('#dev-link').isVisible(), false);
    await page.locator('#menu-open').click();
    assert.strictEqual(await page.locator('#dev-link').isVisible(), true);
    await page.locator('#menu-close').click();
    await choose(page, '#lang', 'ja');
    await page.locator('.cm-content').click();
    await page.keyboard.press('Enter');
    await page.keyboard.insertText('echo NEXTMARK');
    await choose(page, '#channel', 'next');
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
    await choose(page, '#channel', 'release');
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

  it('links each row and note to its section of the Bash manual, opened in a new tab', async () => {
    const ctx = await browser!.newContext();
    // The manual is not fetched here: the tab that opens gets a stub.
    await ctx.route('https://www.gnu.org/**', (r) => r.fulfill({ contentType: 'text/html', body: 'manual' }));
    const page = await ctx.newPage();
    await page.goto(base);
    const panel = () => page.frames().find((f) => f.url().endsWith('/panel.html'))!;
    await until('the panel', () => Promise.resolve(panel()), (f) => !!f);
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText('exit 300');
    await until('the line explained', async () => (await panel().locator('#line').textContent()) ?? '', (t) => t.includes('exit 300'));
    const links = (sel: string) => panel().locator(sel).evaluateAll((as) => as.map((a) => [a.textContent, a.getAttribute('href'), a.getAttribute('target'), a.getAttribute('title')]));
    const manual = 'https://www.gnu.org/software/bash/manual/html_node/';
    assert.deepStrictEqual(await links('#notes .refs a'), [['§3.7.5', `${manual}Exit-Status.html`, '_blank', 'Bash manual 3.7.5: Exit Status']]);
    assert.deepStrictEqual(await links('#tree > li > .row .refs a'), [
      ['§4.1', `${manual}Bourne-Shell-Builtins.html`, '_blank', 'Bash manual 4.1: Bourne Shell Builtins'],
      ['§4.4', `${manual}Special-Builtins.html`, '_blank', 'Bash manual 4.4: Special Builtins'],
    ]);
    // The links end the row, after its explanation, on the same line.
    const box = await panel().locator('#tree > li > .row').first().evaluate((row) => {
      const r = row.getBoundingClientRect(), refs = row.querySelector('.refs')!.getBoundingClientRect(), text = row.querySelector('.text')!.getBoundingClientRect();
      return { inside: refs.right <= r.right + 0.5 && refs.left >= text.right, sameLine: Math.abs(refs.top - text.top) < 8 };
    });
    assert.deepStrictEqual(box, { inside: true, sameLine: true });
    // A click opens the page in a new tab.
    const [tab] = await Promise.all([ctx.waitForEvent('page'), panel().locator('#notes .refs a').click()]);
    await tab.waitForLoadState();
    assert.strictEqual(tab.url(), `${manual}Exit-Status.html`);
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
    await choose(page, '#shell', 'dash');
    await until('the panel drawn again', () => parent().evaluate((li) => !(li as any).mark), (redrawn) => redrawn);
    assert.strictEqual(await folded(), true);
    assert.strictEqual(await twisty(), '▸');
    // "Expand all" and "Collapse all" still work.
    await menuItem(page, '#menu-collapse');
    assert.strictEqual(await panel().locator('#tree .collapsed').count(), 0);
    await menuItem(page, '#menu-collapse');
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
    await choose(page, '#lang', 'ja');
    assert.match(await page.locator('#banner-text').innerText(), /^プルリクエスト #123（コミット [0-9a-f]{7}）のプレビュー。未リリース。$/);
    await choose(page, '#channel', 'next');
    await page.waitForURL(`${base}next/**`);
    await page.goBack();
    await choose(page, '#channel', 'release');
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
    assert.strictEqual(await f.locator('#splitter').isHidden(), true);
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
    // The settings come with the script: here, no worked examples. The panel's ⚙ button is hidden, as there is no dialog to open.
    assert.match(await inner().locator('#main').innerText(), /Example/);
    await page.evaluate(`document.getElementById('f').contentWindow.postMessage({ type: 'bx-state', text: 'echo one\\nsort -u a.txt\\n', kind: 'shell', line: 1, col: 0, lang: 'en', theme: 'auto', choice: {}, settings: { 'bashExplainer.examples.enabled': false } }, location.origin)`);
    await until('no example', () => inner().locator('#main').innerText(), (t) => !/Example/.test(t));
    assert.strictEqual(await inner().locator('#settings').isHidden(), true);
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
    await choose(page, '#lang', 'ja');
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
    // CodeMirror draws the selection layer on the next frame.
    await until('the selection drawn', () => page.locator('.cm-selectionBackground').count(), (n) => n > 0);
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

  it('colours the script from its own syntax tree: code again after a heredoc, and the shell code of a host file', async () => {
    const ctx = await browser!.newContext();
    const page = await ctx.newPage();
    await page.goto(base);
    /** The colour and the highlight class of each piece of a line of the editor, as `text|class|colour`. */
    const pieces = (start: string) => page.locator('.cm-line').filter({ hasText: start }).first().evaluate((line) => {
      const out: string[] = [];
      // No named functions in here: tsx would wrap them in a helper the page does not have.
      const texts = (globalThis as any).document.createTreeWalker(line, 4);
      for (let n = texts.nextNode(); n; n = texts.nextNode()) {
        if (!n.textContent.trim()) continue;
        const el = n.parentElement;
        const cls = [...el.classList].find((c) => (c as string).startsWith('cm-bx-')) ?? '';
        out.push(`${n.textContent.trim()}|${cls}|${(globalThis as any).getComputedStyle(el).color}`);
      }
      return out;
    });
    await page.locator('.cm-scroller').evaluate((e) => (e.scrollTop = e.scrollHeight));
    const shopt = await until('the shopt line coloured', () => pieces('shopt -s extglob'), (p) => p.some((x) => x.startsWith('shopt|cm-bx-builtin')));
    assert.deepEqual(shopt.map((x) => x.split('|').slice(0, 2).join('|')), ['shopt|cm-bx-builtin', '-s|cm-bx-option', 'extglob|']);
    const body = await pieces('tabs are removed');
    assert.deepEqual(body.map((x) => x.split('|')[1]), ['cm-bx-heredoc']);
    // A string and a builtin do not share a colour.
    assert.notStrictEqual(body[0].split('|')[2], shopt[0].split('|')[2]);
    // Typing colours the new text too.
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText('\necho "typed"');
    await until('the typed line coloured', () => pieces('echo "typed"'), (p) => p.some((x) => x.startsWith('"typed"|cm-bx-string')));
    // A Dockerfile: its own mode for FROM and RUN, ours for the shell code after RUN.
    await page.locator('#kind').selectOption('dockerfile');
    page.once('dialog', (d) => void d.accept()); // replace the typed script with the sample
    await page.locator('#sample').click();
    const run = await until('the RUN line coloured', () => pieces('RUN apt-get update'), (p) => p.some((x) => x.startsWith('apt-get|cm-bx-command')));
    assert.deepEqual(run.map((x) => x.split('|')[1]), ['', 'cm-bx-command', '']);
    assert.notStrictEqual(run[0].split('|')[2], run[2].split('|')[2], 'RUN is coloured by the Dockerfile mode');
    const entry = await pieces('ENTRYPOINT');
    assert.ok(entry.some((x) => x.startsWith('${PORT:-8080}|cm-bx-variable')), entry.join('\n'));
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
    await choose(page, '#theme', 'dark');
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
    await choose(page, '#theme', 'light');
    assert.strictEqual(await bg(page), LIGHT);
    await until('the light panel', () => bg(panel()), (c) => c === LIGHT);
    // The Japanese label.
    await choose(page, '#lang', 'ja');
    assert.strictEqual(await page.locator('#theme-label').textContent(), 'テーマ');
    // Auto again forgets the choice.
    await choose(page, '#theme', 'auto');
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
    await choose(p2, '#theme', 'light');
    assert.strictEqual(await bg(p2), LIGHT);
    assert.deepStrictEqual(errors, []);
    await blocked.close();
  });

  it('colours the editor and the panel alike, in the VS Code palette or the classic one (the colors setting), light and dark', async () => {
    const ctx = await browser!.newContext({ locale: 'en-US', colorScheme: 'light' });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base);
    const panel = () => page.frames().find((f) => f.url().endsWith('/panel.html'))!;
    await until('the panel', () => Promise.resolve(panel()), (f) => !!f);
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText('grep -rn "x" f 2>&1');
    const colour = (loc: ReturnType<Page['locator']>) => (loc.first().evaluate(new Function('e', 'return getComputedStyle(e).color') as never) as Promise<string>);
    const both = async () => [
      await until('the option in the editor', () => colour(page.locator('.cm-bx-option')), (c) => !!c),
      await until('the option in the panel', async () => (await panel().locator('.kind-option').count() ? colour(panel().locator('.kind-option')) : ''), (c) => !!c),
    ];
    // VS Code's default themes: Light Modern, then Dark Modern.
    assert.deepStrictEqual(await both(), ['rgb(0, 0, 255)', 'rgb(0, 0, 255)']);
    await page.emulateMedia({ colorScheme: 'dark' });
    assert.deepStrictEqual(await both(), ['rgb(86, 156, 214)', 'rgb(86, 156, 214)']);
    assert.strictEqual(await colour(page.locator('.cm-bx-command')), 'rgb(220, 220, 170)');
    // Classic: the panel's own palette in both, orange options and blue commands (the dark chart colours).
    await page.locator('#settings-open').click();
    assert.strictEqual(await page.locator('#setting-colors').inputValue(), 'vscode');
    await page.locator('#setting-colors').selectOption('classic');
    await until('the classic option', async () => (await both()).join('|'), (c) => c === 'rgb(209, 134, 22)|rgb(209, 134, 22)');
    assert.strictEqual(await colour(page.locator('.cm-bx-command')), 'rgb(55, 148, 255)');
    assert.strictEqual(await colour(panel().locator('.kind-command')), 'rgb(55, 148, 255)');
    await page.locator('#settings-done').click();
    // It is kept for the next visit, and back to the default.
    await page.reload();
    await until('the editor', () => colour(page.locator('.cm-bx-option')), (c) => c === 'rgb(209, 134, 22)');
    await page.locator('#settings-open').click();
    await page.locator('#setting-colors').selectOption('vscode');
    await until('the VS Code option', () => colour(page.locator('.cm-bx-option')), (c) => c === 'rgb(86, 156, 214)');
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  });

  it('has a settings dialog: a change shows at once, stays in sync with the toolbar and the panel, is kept, and can be reset', async () => {
    const ctx = await browser!.newContext({ locale: 'en-US' });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base);
    const panel = () => page.frames().find((f) => f.url().endsWith('/panel.html'))!;
    await until('the panel', () => Promise.resolve(panel()), (f) => !!f);
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText('#!/bin/bash\n[[ -f x ]] && for f in $(ls); do echo "$f"; done');
    const panelText = () => panel().locator('#main').innerText();
    await until('the pitfall', panelText, (t) => /Pitfall/.test(t));
    assert.strictEqual(await page.locator('#problems').isHidden(), true);

    // The dialog lists the settings that apply here, and none that do not.
    await page.locator('#settings-open').click();
    assert.strictEqual(await page.locator('#settings-dialog').isVisible(), true);
    assert.strictEqual(await page.locator('#setting-notes-pitfalls').isChecked(), true);
    assert.strictEqual(await page.locator('#setting-hover-enabled').count(), 0);
    assert.match(await page.locator('.settings-elsewhere').innerText(), /panel\.autoOpen/);
    // A note turned off goes from the explanation at once.
    await page.locator('#setting-notes-pitfalls').uncheck();
    await until('no pitfall', panelText, (t) => !/Pitfall/.test(t));
    // The shell: the script is checked for sh, and the panel's own menu says so.
    await page.locator('#setting-shell').selectOption('sh');
    await until('the problem', () => page.locator('#problem-list').innerText(), (t) => /dbracket/.test(t));
    await until('the panel\'s shell', () => page.locator('#shell').inputValue(), (v) => v === 'sh');
    // A warning code left out.
    await page.locator('#setting-diagnostics-ignore').fill('dbracket');
    await page.locator('#setting-diagnostics-ignore-add').click();
    await until('no problem', () => page.locator('#problems').isHidden(), (h) => h);
    assert.match(await page.locator('[data-key="diagnostics.ignore"] .setting-list').innerText(), /dbracket/);
    // Examples off by kind.
    await page.locator('#setting-examples-disabled-regex').check();
    // The language follows the toolbar, and the other way round.
    await page.locator('#setting-language').selectOption('ja');
    assert.strictEqual(await page.locator('#lang').inputValue(), 'ja');
    assert.strictEqual(await page.locator('#settings-title').textContent(), '設定');
    await page.locator('#settings-done').click();
    assert.strictEqual(await page.locator('#settings-dialog').isVisible(), false);
    await choose(page, '#lang', 'en');
    // The panel's header is not shown on the page; a shell chosen in the menu is the setting.
    assert.strictEqual(await panel().locator('header').isHidden(), true);
    await choose(page, '#shell', 'dash');
    await page.locator('#settings-open').click();
    await until('the dialog', () => page.locator('#settings-dialog').isVisible(), (v) => v);
    assert.strictEqual(await page.locator('#setting-shell').inputValue(), 'dash');
    assert.strictEqual(await page.locator('#setting-language').inputValue(), 'en');
    await page.keyboard.press('Escape');
    assert.strictEqual(await page.locator('#settings-dialog').isVisible(), false);

    // Kept across a reload, as VS Code keys.
    assert.deepStrictEqual(JSON.parse(await page.evaluate('localStorage.getItem("bash-explainer-settings")') as string), {
      'bashExplainer.language': 'en', 'bashExplainer.notes.pitfalls': false, 'bashExplainer.shell': 'dash',
      'bashExplainer.diagnostics.ignore': ['dbracket'], 'bashExplainer.examples.disabled': ['regex'],
    });
    await page.reload();
    await until('the panel after the reload', () => Promise.resolve(panel()), (f) => !!f);
    await until('the shell after the reload', () => page.locator('#shell').inputValue(), (v) => v === 'dash');
    await page.locator('#settings-open').click();
    assert.strictEqual(await page.locator('#setting-notes-pitfalls').isChecked(), false);
    assert.strictEqual(await page.locator('#setting-examples-disabled-regex').isChecked(), true);
    // Reset: the defaults, and nothing kept.
    await page.locator('#settings-reset').click();
    assert.strictEqual(await page.locator('#setting-notes-pitfalls').isChecked(), true);
    assert.strictEqual(await page.locator('#setting-shell').inputValue(), 'auto');
    assert.strictEqual(await page.evaluate('localStorage.getItem("bash-explainer-settings")'), null);
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  });

  it('checks the JSON of customCommands as it is typed, and applies it when it is valid', async () => {
    const ctx = await browser!.newContext({ locale: 'en-US' });
    const page = await ctx.newPage();
    await page.goto(base);
    const panel = () => page.frames().find((f) => f.url().endsWith('/panel.html'))!;
    await until('the panel', () => Promise.resolve(panel()), (f) => !!f);
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText('deploy web');
    await until('the line explained', () => panel().locator('#main').innerText(), (t) => /deploy/.test(t));
    await page.locator('#settings-open').click();
    const area = page.locator('#setting-customCommands');
    await area.fill('{ "deploy": ');
    assert.match(await page.locator('#setting-customCommands-error').innerText(), /^Not applied: /);
    assert.strictEqual(await area.getAttribute('aria-invalid'), 'true');
    await area.fill('[]');
    assert.match(await page.locator('#setting-customCommands-error').innerText(), /expected an object/);
    // What is typed stays while another setting changes.
    await page.locator('#setting-notes-idioms').uncheck();
    assert.strictEqual(await area.inputValue(), '[]');
    await area.fill('{\n  // comments are allowed, as in settings.json\n  "deploy": { "summary": "Deploy to production" },\n}');
    assert.strictEqual(await page.locator('#setting-customCommands-error').isHidden(), true);
    assert.strictEqual(await area.getAttribute('aria-invalid'), 'false');
    await until('the command described', () => panel().locator('#main').innerText(), (t) => /Deploy to production/.test(t));
    const saved = JSON.parse(await page.evaluate('localStorage.getItem("bash-explainer-settings")') as string);
    assert.deepStrictEqual(saved['bashExplainer.customCommands'], { deploy: { summary: 'Deploy to production' } });
    await ctx.close();
  });

  it('exports the settings as a settings file, and imports one, saying which keys it left out', async () => {
    const ctx = await browser!.newContext({ locale: 'en-US', acceptDownloads: true });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base.slice(0, -1) });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base);
    await page.locator('#settings-open').click();
    await page.locator('#setting-shell').selectOption('sh');
    await page.locator('#setting-notes-pitfalls').uncheck();
    await page.locator('#setting-examples-disabled-regex').check();
    await page.locator('#setting-customCommands').fill('{ "deploy": { "summary": "Deploy to production" } }');
    const saved = () => page.evaluate('localStorage.getItem("bash-explainer-settings")') as Promise<string | null>;
    const before = await saved();
    const expected = {
      'bashExplainer.notes.pitfalls': false, 'bashExplainer.shell': 'sh', 'bashExplainer.examples.disabled': ['regex'],
      'bashExplainer.customCommands': { deploy: { summary: 'Deploy to production' } },
    };
    // Export: the keys of settings.json, only those changed, pretty-printed.
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#settings-export').click()]);
    assert.strictEqual(download.suggestedFilename(), 'bash-explainer-settings.json');
    const file = await download.path();
    const text = fs.readFileSync(file, 'utf8');
    assert.deepStrictEqual(JSON.parse(text), expected);
    assert.strictEqual(text, `${JSON.stringify(expected, null, 2)}\n`);
    assert.match(await page.locator('#settings-io-status').innerText(), /Downloaded bash-explainer-settings\.json/);
    // Copy gives the same text.
    await page.evaluate('navigator.clipboard.writeText("")');
    await page.locator('#settings-copy').click();
    assert.strictEqual(await until('the copied settings', () => page.evaluate('navigator.clipboard.readText()') as Promise<string>, (t) => t !== ''), text);
    // Round trip: reset, then import the exported file.
    await page.locator('#settings-reset').click();
    assert.strictEqual(await saved(), null);
    await page.locator('#settings-file').setInputFiles(file);
    await until('the import', () => page.locator('#settings-io-status').innerText(), (t) => /Imported 4 settings/.test(t));
    assert.strictEqual(await saved(), before);
    assert.strictEqual(await page.locator('#setting-shell').inputValue(), 'sh');
    assert.strictEqual(await page.locator('#setting-notes-pitfalls').isChecked(), false);
    // A file with keys that are not settings, not used here, or of the wrong type: the rest replaces the settings.
    await page.locator('#settings-file').setInputFiles({
      name: 'vscode.json', mimeType: 'application/json',
      buffer: Buffer.from('{\n  // from VS Code\n  "bashExplainer.shell": "dash",\n  "bashExplainer.hover.enabled": false,\n  "editor.fontSize": 14,\n  "examples": { "placement": "nowhere" },\n}'),
    });
    const status = await until('the second import', () => page.locator('#settings-io-status').innerText(), (t) => /Imported 1 setting;/.test(t));
    assert.match(status, /editor\.fontSize — not a setting/);
    assert.match(status, /examples\.placement — wrong value \(expected one of first, last, bottom\)/);
    assert.match(status, /hover\.enabled — not used on this page/);
    assert.strictEqual(await page.locator('#setting-shell').inputValue(), 'dash');
    assert.strictEqual(await page.locator('#setting-notes-pitfalls').isChecked(), true);
    const afterSecond = await saved();
    assert.deepStrictEqual(JSON.parse(afterSecond!), { 'bashExplainer.shell': 'dash' });
    // JSON that does not parse, pasted: an error, and nothing changes.
    await page.locator('#settings-paste summary').click();
    await page.locator('#settings-paste-text').fill('{ "bashExplainer.shell": ');
    await page.locator('#settings-paste-import').click();
    assert.match(await page.locator('#settings-io-status').innerText(), /^Not imported, nothing changed: /);
    assert.strictEqual(await saved(), afterSecond);
    await page.locator('#settings-paste-text').fill('["shell"]');
    await page.locator('#settings-paste-import').click();
    assert.match(await page.locator('#settings-io-status').innerText(), /nothing changed: expected an object of settings/);
    // Pasted JSON that is right.
    await page.locator('#settings-paste-text').fill('{ "shell": "ksh" }');
    await page.locator('#settings-paste-import').click();
    assert.strictEqual(await page.locator('#setting-shell').inputValue(), 'ksh');
    // A file dropped on the dialog.
    await page.evaluate(`(() => {
      const dt = new DataTransfer();
      dt.items.add(new File(['{ "bashExplainer.shell": "zsh" }'], 'drop.json', { type: 'application/json' }));
      document.getElementById('settings-dialog').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    })()`);
    await until('the dropped file', () => page.locator('#setting-shell').inputValue(), (v) => v === 'zsh');
    // Without a clipboard, the JSON is shown to copy by hand.
    await page.evaluate('navigator.clipboard.writeText = () => Promise.reject(new Error("denied"))');
    await page.locator('#settings-copy').click();
    await until('the fallback', () => page.locator('#settings-io-status').innerText(), (t) => /does not let the page copy/.test(t));
    assert.deepStrictEqual(JSON.parse(await page.locator('#settings-paste-text').inputValue()), { 'bashExplainer.shell': 'zsh' });
    // In Japanese.
    await page.locator('#setting-language').selectOption('ja');
    assert.strictEqual(await page.locator('#settings-export').textContent(), 'ファイルにエクスポート');
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  });

  it('keeps the settings sheet inside a phone screen, and works without storage', async () => {
    const { devices } = await import('playwright-core');
    const ctx = await browser!.newContext({ ...devices['iPhone 13'], locale: 'en-US' });
    await ctx.addInitScript("Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } });");
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base);
    await page.locator('#settings-open').tap();
    assert.match(await page.locator('.settings-intro').innerText(), /does not let the page keep them/);
    // Once it has slid in.
    await page.evaluate("Promise.all(document.getElementById('settings-dialog').getAnimations().map((a) => a.finished))");
    const fit = await page.evaluate(`(() => {
      const d = document.getElementById('settings-dialog').getBoundingClientRect();
      const body = document.querySelector('.settings-body');
      const out = [...document.querySelectorAll('#settings-dialog *')].filter((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && (r.left < d.left - 0.5 || r.right > d.right + 0.5);
      }).map((e) => e.tagName + (e.id ? '#' + e.id : ''));
      return { left: d.left, right: innerWidth - d.right, top: d.top, bottom: innerHeight - d.bottom, sideways: body.scrollWidth > body.clientWidth, page: document.documentElement.scrollWidth > innerWidth, out };
    })()`) as { left: number; right: number; top: number; bottom: number; sideways: boolean; page: boolean; out: string[] };
    // On a phone the settings take the whole screen, as a sheet.
    assert.deepStrictEqual(fit, { left: 0, right: 0, top: 0, bottom: 0, sideways: false, page: false, out: [] });
    // Without storage, a change still applies for as long as the page is open.
    await page.locator('#setting-shell').selectOption('dash');
    const panel = page.frames().find((f) => f.url().endsWith('/panel.html'))!;
    await until('the menu\'s shell', () => page.locator('#shell').inputValue(), (v) => v === 'dash');
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  });

  it('on a phone, tapping a row of the explanation selects its token without focusing the editor, and the page does not scroll sideways', async () => {
    const { devices } = await import('playwright-core');
    const ctx = await browser!.newContext({ ...devices['iPhone 13'] });
    const page = await ctx.newPage();
    await page.goto(base);
    await page.locator('#menu-open').tap();
    await page.locator('#menu-sample').tap();
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
    const share = await panel.evaluate('(() => { const l = document.querySelector(".row .label"); return [l.getBoundingClientRect().width / l.parentElement.getBoundingClientRect().width, l.scrollWidth <= l.clientWidth]; })()') as [number, boolean];
    assert.ok(share[0] > 0.5 && share[1], String(share));
    // ...and its explanation then goes under it, not into a narrow column beside it.
    const below = await panel.evaluate('(() => { const r = document.querySelector(".row"); return r.querySelector(".text").getBoundingClientRect().top >= r.querySelector(".label").getBoundingClientRect().bottom - 1; })()');
    assert.strictEqual(below, true);
    // ...with the fold mark and the label on one line.
    const oneLine = await panel.evaluate('(() => { const r = document.querySelector(".row"); return Math.abs(r.querySelector(".twisty").getBoundingClientRect().top - r.querySelector(".label").getBoundingClientRect().top) < 8; })()');
    assert.strictEqual(oneLine, true);
    // Nothing in the top bar or the menu is cut: every option fits its select (measured with the
    // select's font, less the room of its arrow), in both languages.
    for (const lang of ['en', 'ja']) {
      await choose(page, '#lang', lang);
      await page.locator('#menu-open').tap();
      const clipped = await page.evaluate(`(() => {
        const c = document.createElement('canvas').getContext('2d');
        const bad = [];
        for (const s of document.querySelectorAll('.top select, #drawer select')) {
          if (!s.clientWidth) continue;
          const cs = getComputedStyle(s);
          c.font = cs.font;
          const room = s.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
          // The file kind may cut a long name with "…"; the others show every option whole.
          const widest = Math.max(...[...s.options].filter((o) => s.id !== 'kind' || o.selected).map((o) => c.measureText(o.text).width));
          if (widest > room) bad.push(s.id + ' ' + Math.round(widest) + ' > ' + Math.round(room));
        }
        for (const b of document.querySelectorAll('.top button, #drawer button, #drawer a')) if (b.scrollWidth > b.clientWidth) bad.push(b.id);
        return bad;
      })()`);
      assert.deepStrictEqual(clipped, [], lang);
      await page.locator('#menu-close').tap();
    }
    // The top bar is one row, and its controls are big enough to tap.
    const bar = await page.evaluate('document.querySelector(".top").getBoundingClientRect().height') as number;
    assert.ok(bar <= 49, String(bar));
    const small = await page.evaluate('[...document.querySelectorAll(".top select, .top button")].filter((e) => e.getClientRects().length && e.getBoundingClientRect().height < 40).map((e) => e.id)');
    assert.deepStrictEqual(small, []);
    await ctx.close();
  });

  it('has no panel header on the page: its controls are in the top bar (1200px) and the menu (360px and up)', async () => {
    for (const [width, height] of [[360, 740], [1200, 800]]) {
      const ctx = await browser!.newContext({ viewport: { width, height }, locale: 'en-US' });
      await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base.slice(0, -1) });
      const page = await ctx.newPage();
      await page.goto(base);
      await page.locator('.cm-line').nth(5).waitFor();
      const panel = () => page.frames().find((f) => f.url().endsWith('/panel.html'))!;
      await until('the explanation', async () => (await panel()?.locator('#line').textContent().catch(() => '')) ?? '', (t) => t.length > 0);
      // The header (the title row and its buttons) is not there to see or to tab to, and the page does not scroll sideways.
      assert.strictEqual(await panel().locator('header').isHidden(), true, `${width}px`);
      assert.strictEqual(await panel().locator('header button:visible, header select:visible, #where:visible').count(), 0);
      assert.strictEqual(await page.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), true);
      const wide = width >= 1200;
      const via = async (top: string, menu: string) => {
        if (wide) return page.locator(top).click();
        await page.locator('#menu-open').click();
        return page.locator(menu).click();
      };
      assert.strictEqual(await page.locator('#collapse').isVisible(), wide);
      assert.strictEqual(await page.locator('#shell-top').isVisible(), wide);
      if (wide) {
        // Still one row of 48px, with nothing hanging out of the bar.
        const bar = (await page.evaluate('(() => { const t = document.querySelector(".top"); return [t.getBoundingClientRect().height, t.scrollWidth <= t.clientWidth]; })()')) as [number, boolean];
        assert.deepStrictEqual(bar, [48, true]);
        const names = await page.evaluate('["collapse", "copy-md", "ref", "shell-top"].map((id) => document.getElementById(id).getAttribute("aria-label"))');
        assert.deepStrictEqual(names, ['Collapse all', 'Copy as Markdown', 'Quick reference', 'Shell']);
      }

      // Shell: the setting, as the panel's select was.
      if (wide) await page.locator('#shell-top').selectOption('dash');
      else await choose(page, '#shell', 'dash');
      await until('the problems for dash', () => page.locator('#problem-list').innerText(), (t) => t.includes('dbracket'));
      assert.strictEqual(await page.locator('#shell').inputValue(), 'dash');
      assert.strictEqual(await page.locator('#shell-top').inputValue(), 'dash');

      // Collapse all, then Expand all.
      await page.locator('.cm-line').nth(7).click();
      await until('a tree', () => panel().locator('#tree li li').count(), (n) => n > 0);
      await via('#collapse', '#menu-collapse');
      await until('collapsed', () => panel().locator('#tree .collapsed').count(), (n) => n > 0);
      assert.strictEqual(await page.locator('#collapse').getAttribute('aria-label'), 'Expand all');
      assert.strictEqual(await page.locator('#menu-collapse-label').textContent(), 'Expand all');
      await via('#collapse', '#menu-collapse');
      await until('expanded', () => panel().locator('#tree .collapsed').count(), (n) => n === 0);

      // Copy as Markdown.
      await page.evaluate('navigator.clipboard.writeText("")');
      await via('#copy-md', '#menu-copy');
      const md = await until('the copy', () => page.evaluate('navigator.clipboard.readText()') as Promise<string>, (t) => t.length > 0);
      assert.match(md, /`/);

      // Quick reference, and back.
      await via('#ref', '#menu-ref');
      await until('the reference', () => panel().locator('#reference').isVisible(), (v) => v);
      assert.strictEqual(await page.locator('#ref').getAttribute('aria-pressed'), 'true');
      assert.strictEqual(await page.locator('#menu-ref-label').textContent(), '← Back to the explanation');
      await via('#ref', '#menu-ref');
      await until('the explanation again', () => panel().locator('#main').isVisible(), (v) => v);

      // Keyboard access: the menu's items are buttons in the tab order.
      await page.locator('#menu-open').focus();
      await page.keyboard.press('Enter');
      await page.locator('#menu-copy').focus();
      assert.strictEqual(await page.evaluate('document.activeElement.id'), 'menu-copy');
      await page.evaluate("document.getElementById('drawer').close()");

      // Japanese names.
      await choose(page, '#lang', 'ja');
      await until('ja names', async () => (await page.locator('#menu-copy-label').textContent()) ?? '', (t) => t === 'Markdown でコピー');
      assert.strictEqual(await page.locator('#shell-label').textContent(), 'シェル');
      await ctx.close();
    }
  });

  it('clears everything the page stores from the settings dialog, after a confirmation, and applies the defaults and the tip at once', async () => {
    // Every storage key is listed in web/storage.ts, which is what the dialog clears.
    for (const file of fs.readdirSync(path.join(root, 'web')).filter((f) => /\.(ts|js)$/.test(f) && f !== 'storage.ts' && f !== 'theme-init.js')) {
      assert.doesNotMatch(fs.readFileSync(path.join(root, 'web', file), 'utf8').replace(/^\s*\/\/.*$/gm, ''), /'bash-explainer-[a-z-]+'/, file);
    }
    const { devices } = await import('playwright-core');
    const ctx = await browser!.newContext({ ...devices['iPhone 13'], viewport: { width: 360, height: 740 }, locale: 'en-US' });
    const page = await ctx.newPage();
    await page.goto(base);
    await page.locator('.cm-line').first().waitFor();
    const stored = () => page.evaluate('Object.keys(localStorage).sort()') as Promise<string[]>;
    // The tip shows the first time; closing it, the theme, the shell and read mode are kept.
    await until('the tip', () => page.locator('#readtip').isVisible(), (v) => v);
    await page.locator('#readtip-close').tap();
    await page.locator('#readmode').tap();
    await choose(page, '#theme', 'dark');
    await choose(page, '#shell', 'dash');
    await until('the keys', stored, (k) => k.includes('bash-explainer-settings') && k.includes('bash-explainer-theme') && k.includes('bash-explainer-read-mode') && k.includes('bash-explainer-read-tip-seen'));
    assert.strictEqual(await page.locator('#readtip').isVisible(), false);

    await page.locator('#settings-open').tap();
    await page.locator('#settings-clear').tap();
    // Asked first: a cancel changes nothing.
    assert.match(await page.locator('#settings-dialog').innerText(), /This cannot be undone/);
    await page.locator('#settings-clear-no').tap();
    assert.strictEqual(await page.locator('#settings-clear').isVisible(), true);
    assert.ok((await stored()).includes('bash-explainer-settings'));
    await page.locator('#settings-clear').tap();
    await page.locator('#settings-clear-yes').tap();
    assert.match(await page.locator('#settings-clear-status').innerText(), /Cleared/);
    // No reload: the dialog, the page and the storage are back to the defaults.
    assert.deepStrictEqual(await stored(), []);
    assert.strictEqual(await page.locator('#setting-shell').inputValue(), 'auto');
    assert.strictEqual(await page.locator('#shell').inputValue(), 'auto');
    assert.strictEqual(await page.locator('#theme').inputValue(), 'auto');
    assert.strictEqual(await page.evaluate('document.documentElement.getAttribute("data-theme")'), null);
    assert.strictEqual(await page.locator('#readmode').getAttribute('aria-pressed'), 'false');
    assert.strictEqual(await page.locator('.cm-content').getAttribute('inputmode'), null);
    await page.locator('#settings-done').tap();
    await until('the tip again', () => page.locator('#readtip').isVisible(), (v) => v);
    await ctx.close();

    // The Japanese words, and no storage at all: nothing throws, the page still goes back to its defaults.
    const bare = await browser!.newContext({ viewport: { width: 1280, height: 720 }, locale: 'ja-JP' });
    await bare.addInitScript('Object.defineProperty(window, "localStorage", { get() { throw new Error("no storage"); } })');
    const p2 = await bare.newPage();
    const errors: string[] = [];
    p2.on('pageerror', (e) => errors.push(e.message));
    await p2.goto(base);
    await p2.locator('.cm-line').first().waitFor();
    await p2.locator('#settings-open').click();
    assert.strictEqual(await p2.locator('#settings-clear').textContent(), '保存したデータを消去');
    await p2.locator('#settings-clear').click();
    await p2.locator('#settings-clear-yes').click();
    assert.match(await p2.locator('#settings-clear-status').innerText(), /消去しました/);
    assert.deepStrictEqual(errors, []);
    await bare.close();
  });

  it('read mode: on a phone a tap places the cursor without the keyboard, the choice is kept, and the top bar stays one row at 360px', async () => {
    const { devices } = await import('playwright-core');
    const ctx = await browser!.newContext({ ...devices['iPhone 13'], viewport: { width: 360, height: 740 }, locale: 'en-US' });
    const page = await ctx.newPage();
    await page.goto(base);
    await page.locator('.cm-line').nth(5).waitFor();
    const btn = page.locator('#readmode');
    assert.strictEqual(await btn.isVisible(), true);
    assert.strictEqual(await btn.getAttribute('aria-pressed'), 'false');
    assert.match((await btn.getAttribute('aria-label'))!, /^Read mode/);
    assert.strictEqual(await page.locator('.cm-content').getAttribute('inputmode'), null);
    const fits = async () => page.evaluate('(() => { const t = document.querySelector(".top"); const k = document.querySelector("#kind").getBoundingClientRect(); return [t.getBoundingClientRect().height, k.width, document.documentElement.scrollWidth <= document.documentElement.clientWidth]; })()') as Promise<[number, number, boolean]>;
    await btn.tap();
    assert.strictEqual(await btn.getAttribute('aria-pressed'), 'true');
    assert.strictEqual(await page.locator('.cm-content').getAttribute('inputmode'), 'none');
    const [h, w, ok] = await fits();
    assert.ok(h <= 49 && w > 100 && ok, String([h, w, ok]));
    // A tap in the editor moves the cursor, and the explanation follows.
    const panel = page.frames().find((f) => f.url().endsWith('/panel.html'))!;
    const lineOf = () => page.evaluate('document.querySelector(".cm-activeLine") && [...document.querySelectorAll(".cm-line")].indexOf(document.querySelector(".cm-activeLine"))') as Promise<number>;
    await page.locator('.cm-line').nth(5).tap();
    await until('the cursor line', lineOf, (n) => n === 5);
    const first = await panel.locator('.row .label').first().innerText();
    await page.locator('.cm-line').nth(2).tap();
    await until('the cursor line', lineOf, (n) => n === 2);
    await until('the explanation', () => panel.locator('.row .label').first().innerText(), (t) => t !== first);
    // The choice is kept; turning it off lets the editor take text again.
    await page.reload();
    await page.locator('.cm-line').first().waitFor();
    assert.strictEqual(await page.locator('#readmode').getAttribute('aria-pressed'), 'true');
    assert.strictEqual(await page.locator('.cm-content').getAttribute('inputmode'), 'none');
    await page.locator('#readmode').tap();
    assert.strictEqual(await page.locator('.cm-content').getAttribute('inputmode'), null);
    await ctx.close();
    // Not on a desktop (a fine pointer), and the mode works without storage.
    const desk = await browser!.newContext({ viewport: { width: 1200, height: 800 } });
    await desk.addInitScript('Object.defineProperty(window, "localStorage", { get() { throw new Error("no storage"); } })');
    const d = await desk.newPage();
    await d.goto(base);
    await d.locator('.cm-line').first().waitFor();
    assert.strictEqual(await d.locator('#readmode').isVisible(), false);
    await d.evaluate('document.getElementById("readmode").click()');
    assert.strictEqual(await d.locator('.cm-content').getAttribute('inputmode'), 'none');
    await desk.close();
  });

  it('read-mode tip: shown once on a phone, closed by the button or by using the switch, never on a desktop', async () => {
    const { devices } = await import('playwright-core');
    const phone = { ...devices['iPhone 13'], viewport: { width: 360, height: 740 }, locale: 'en-US' };
    const ctx = await browser!.newContext(phone);
    const page = await ctx.newPage();
    await page.goto(base);
    await page.locator('.cm-line').nth(5).waitFor();
    const tip = page.locator('#readtip');
    assert.strictEqual(await tip.isVisible(), true);
    assert.match(await tip.innerText(), /Tap here to turn off editing/);
    const close = page.locator('#readtip-close');
    assert.strictEqual(await close.getAttribute('aria-label'), 'Close');
    // Inside the window, the arrow over the switch, and no horizontal scroll.
    const geo = await page.evaluate('(() => { const t = document.querySelector("#readtip").getBoundingClientRect(); const b = document.querySelector("#readmode").getBoundingClientRect(); const x = parseFloat(getComputedStyle(document.querySelector("#readtip")).getPropertyValue("--arrow-x")); return { l: t.left, r: t.right, top: t.top, bottom: b.bottom, arrow: t.left + x, mid: b.left + b.width / 2, ok: document.documentElement.scrollWidth <= document.documentElement.clientWidth }; })()') as { l: number; r: number; top: number; bottom: number; arrow: number; mid: number; ok: boolean };
    assert.ok(geo.l >= 0 && geo.r <= 360 && geo.ok && geo.top >= geo.bottom, JSON.stringify(geo));
    assert.ok(Math.abs(geo.arrow - geo.mid) < 1, JSON.stringify(geo));
    await close.tap();
    assert.strictEqual(await tip.isVisible(), false);
    await page.reload();
    await page.locator('.cm-line').first().waitFor();
    assert.strictEqual(await tip.isVisible(), false);
    await ctx.close();
    // Using the switch also counts as seeing it.
    const ctx2 = await browser!.newContext(phone);
    const p2 = await ctx2.newPage();
    await p2.goto(base);
    await p2.locator('.cm-line').first().waitFor();
    assert.strictEqual(await p2.locator('#readtip').isVisible(), true);
    await p2.locator('#readmode').tap();
    assert.strictEqual(await p2.locator('#readtip').isVisible(), false);
    await p2.reload();
    await p2.locator('.cm-line').first().waitFor();
    assert.strictEqual(await p2.locator('#readtip').isVisible(), false);
    await ctx2.close();
    // Without storage it shows, and the button hides it for the session.
    const ctx3 = await browser!.newContext({ ...phone, locale: 'ja-JP' });
    await ctx3.addInitScript('Object.defineProperty(window, "localStorage", { get() { throw new Error("no storage"); } })');
    const p3 = await ctx3.newPage();
    await p3.goto(base);
    await p3.locator('.cm-line').first().waitFor();
    assert.strictEqual(await p3.locator('#readtip').isVisible(), true);
    assert.match(await p3.locator('#readtip').innerText(), /ここをタップ/);
    await p3.locator('#readtip-close').tap();
    assert.strictEqual(await p3.locator('#readtip').isVisible(), false);
    await ctx3.close();
    // Not on a desktop.
    const desk = await browser!.newContext({ viewport: { width: 1200, height: 800 } });
    const d = await desk.newPage();
    await d.goto(base);
    await d.locator('.cm-line').first().waitFor();
    assert.strictEqual(await d.locator('#readtip').isVisible(), false);
    await desk.close();
  });

  it('fits the window on phones and desktops: the page never scrolls, the editor and the explanation scroll inside', async () => {
    const { devices } = await import('playwright-core');
    const sizes = [
      { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } },
      { ...devices['Galaxy S9+'], viewport: { width: 360, height: 740 } },
      { viewport: { width: 1440, height: 900 } },
      { viewport: { width: 1280, height: 720 } },
    ];
    for (const size of sizes) {
      const ctx = await browser!.newContext(size);
      const page = await ctx.newPage();
      await page.goto(base);
      const panel = () => page.frames().find((f) => f.url().endsWith('/panel.html'))!;
      await until('the tree', () => panel()?.locator('.row .label').count().catch(() => 0) ?? Promise.resolve(0), (n) => n > 1);
      const { width, height } = size.viewport;
      // A wheel over the explanation and over the editor scrolls them, not the page. (Chromium's synthetic
      // touch scrolling moves no scroller inside a page here, on the old page either: the wheel it is.)
      const box = (await page.locator('#panel').boundingBox())!;
      const ed0 = (await page.locator('#editor').boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.wheel(0, 400);
      await page.mouse.move(ed0.x + ed0.width / 2, ed0.y + ed0.height / 2);
      await page.mouse.wheel(0, 400);
      await until('the editor scrolled', () => page.evaluate("document.querySelector('.cm-scroller').scrollTop") as Promise<number>, (t) => t > 0);
      await page.evaluate('window.scrollTo(0, 500)');
      const m = await page.evaluate(`(() => {
        const s = document.querySelector('.cm-scroller');
        return {
          page: [document.scrollingElement.scrollHeight - innerHeight, document.scrollingElement.scrollWidth - innerWidth, scrollY],
          footer: document.querySelectorAll('footer').length,
          editor: s.scrollTop > 0 && s.scrollHeight > s.clientHeight,
        };
      })()`);
      assert.deepStrictEqual(m, { page: [0, 0, 0], footer: 0, editor: true }, `${width}×${height}`);
      const inner = await until('the explanation scrolled', () => panel().evaluate('[document.scrollingElement.scrollHeight > innerHeight, scrollY > 0]') as Promise<boolean[]>, (v) => v[1]);
      assert.deepStrictEqual(inner, [true, true], `${width}×${height}`);
      // The editor and the explanation take the window below the top bar, side by side or one above the other.
      const ed = (await page.locator('.source').boundingBox())!;
      const bar = (await page.locator('.top').boundingBox())!;
      assert.ok(bar.height <= 49, String(bar.height));
      if (width < 768) assert.ok(ed.width === width && box.width === width && box.y > ed.y + ed.height && Math.round(box.y + box.height) === height, JSON.stringify([ed, box]));
      else assert.ok(box.x > ed.x + ed.width && Math.round(ed.height) === height - bar.height && Math.round(box.height) === height - bar.height, JSON.stringify([ed, box]));
      await ctx.close();
    }
  });

  it('has a menu that opens from the left with its button (at the left end of the top bar) or a swipe from the left edge, closes with Esc, × or a swipe, and holds what the toolbar and the footer had', async () => {
    const { devices } = await import('playwright-core');
    const ctx = await browser!.newContext({ ...devices['iPhone 13'], locale: 'en-US' });
    const page = await ctx.newPage();
    await page.goto(base);
    await page.locator('.cm-line').first().waitFor();
    const open = () => page.locator('#drawer').evaluate((d) => (d as unknown as { open: boolean }).open);
    // On a phone the top bar has the file kind, the link, the settings and the menu; the rest is in the menu.
    const shown = async (ids: string[]) => Promise.all(ids.map(async (id) => [id, await page.locator(id).isVisible()]));
    assert.deepStrictEqual(await shown(['#kind', '#share', '#settings-open', '#menu-open', '#sample', '#github', '#install']),
      [['#kind', true], ['#share', true], ['#settings-open', true], ['#menu-open', true], ['#sample', false], ['#github', false], ['#install', false]]);
    assert.strictEqual(await page.locator('#menu-open').getAttribute('aria-label'), 'Menu');
    assert.strictEqual(await page.locator('#share').getAttribute('aria-label'), 'Copy a link to this script');
    await page.locator('#menu-open').tap();
    assert.strictEqual(await open(), true);
    // The focus stays in the menu.
    assert.strictEqual(await page.evaluate("!!document.activeElement.closest('#drawer')"), true);
    // The menu has no Settings entry (the gear is in the top bar), and sits along the left edge.
    assert.strictEqual(await page.locator('#menu-settings').count(), 0);
    const sheet = await until('the sheet in place', async () => (await page.locator('#drawer').boundingBox())!, (b) => Math.abs(b.x) < 0.5);
    assert.ok(sheet.width < 390, JSON.stringify(sheet));
    for (const id of ['#lang', '#theme', '#channel', '#menu-sample', '#menu-share', '#menu-install', '#dev-link', '#privacy', '#version', '#notices', '#drawer a[href="LICENSE.txt"]', '#drawer a[href="https://github.com/sf624/bash-explainer"]']) {
      assert.strictEqual(await page.locator(id).isVisible(), true, id);
    }
    assert.match(await page.locator('#version').innerText(), /^Bash Explainer \d+\.\d+\.\d+/);
    // Esc closes it, and the focus goes back to the button.
    await page.keyboard.press('Escape');
    assert.strictEqual(await open(), false);
    assert.strictEqual(await page.evaluate('document.activeElement.id'), 'menu-open');
    // A swipe from the left edge opens it, a swipe back to the left closes it (real touches).
    const cdp = await ctx.newCDPSession(page);
    const swipe = async (from: number, to: number) => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from, y: 500 }] });
      for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from + ((to - from) * i) / 8, y: 500 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    await swipe(4, 140);
    await until('the menu open', open, (v) => v);
    await swipe(250, 20);
    await until('the menu closed', open, (v) => !v);
    // A tap beside it closes it too; the × does.
    await page.locator('#menu-open').tap();
    await page.mouse.click(380, 400);
    assert.strictEqual(await open(), false);
    await page.locator('#menu-open').tap();
    await page.locator('#menu-close').tap();
    assert.strictEqual(await open(), false);
    // Its items do what the buttons did: the sample, the link. The gear opens the settings.
    await page.locator('#settings-open').tap();
    assert.strictEqual(await page.locator('#settings-dialog').isVisible(), true);
    await page.locator('#settings-done').tap();
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Delete');
    await until('an empty editor', () => page.locator('.cm-content').innerText(), (t) => !t.trim());
    await page.locator('#menu-open').tap();
    await page.locator('#menu-sample').tap();
    await until('the sample', () => page.locator('.cm-content').innerText(), (t) => t.startsWith('#!/usr/bin/env bash'));
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base.slice(0, -1) });
    await page.evaluate('navigator.clipboard.writeText("")');
    await page.locator('#menu-open').tap();
    await page.locator('#menu-share').tap();
    await until('the copied link', () => page.evaluate('navigator.clipboard.readText()') as Promise<string>, (t) => t.startsWith(`${base}#`));
    // ...and says so in a toast, inside the screen.
    const toast = (await page.locator('#status').boundingBox())!;
    assert.ok(toast.x >= 16 && toast.x + toast.width <= 390 - 16 + 0.5, JSON.stringify(toast));
    await ctx.close();
  });

  it('resizes the editor and the explanation with the divider: a drag, the keys, a double click; the size is kept', async () => {
    const ctx = await browser!.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    await page.goto(base);
    await page.locator('.cm-line').first().waitFor();
    const width = async () => Math.round((await page.locator('.source').boundingBox())!.width);
    const value = () => page.locator('#splitter').getAttribute('aria-valuenow');
    assert.strictEqual(await value(), '50');
    assert.strictEqual(await page.locator('#splitter').getAttribute('aria-orientation'), 'vertical');
    const handle = (await page.locator('#splitter').boundingBox())!;
    await page.mouse.move(handle.x + handle.width / 2, 400);
    await page.mouse.down();
    // Over the explanation's frame too: the drag goes on.
    await page.mouse.move(900, 400, { steps: 8 });
    await page.mouse.up();
    assert.ok(Math.abs(await width() - 896) < 6, String(await width()));
    assert.strictEqual(await value(), '70');
    // The keys: 5% a step, Home and End for the ends (15% and 85%), Enter for the default.
    await page.locator('#splitter').focus();
    await page.keyboard.press('ArrowLeft');
    assert.strictEqual(await value(), '65');
    await page.keyboard.press('End');
    assert.strictEqual(await value(), '85');
    await page.keyboard.press('Home');
    assert.strictEqual(await value(), '15');
    await page.keyboard.press('Enter');
    assert.strictEqual(await value(), '50');
    await page.keyboard.press('ArrowRight');
    await page.reload();
    await page.locator('.cm-line').first().waitFor();
    assert.strictEqual(await value(), '55');
    await page.locator('#splitter').dblclick();
    assert.strictEqual(await value(), '50');
    await ctx.close();

    // On a phone, one above the other: a drag with a finger.
    const { devices } = await import('playwright-core');
    const phone = await browser!.newContext({ ...devices['iPhone 13'] });
    const p2 = await phone.newPage();
    await p2.goto(base);
    await p2.locator('.cm-line').first().waitFor();
    assert.strictEqual(await p2.locator('#splitter').getAttribute('aria-orientation'), 'horizontal');
    const h = (await p2.locator('#splitter').boundingBox())!;
    const before = (await p2.locator('.source').boundingBox())!.height;
    const cdp = await phone.newCDPSession(p2);
    const x = h.x + h.width / 2, y = h.y + h.height / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - 20 * i }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const after = (await p2.locator('.source').boundingBox())!.height;
    assert.ok(Math.abs(before - 120 - after) < 6, `${before} → ${after}`);
    assert.strictEqual(await p2.evaluate('document.scrollingElement.scrollHeight === innerHeight'), true);
    await phone.close();
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
    await until('the first explanation', text('#line'), (t) => t.length > 0);

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

    // Pointing at a part highlights it in the editor. The pointer goes on the part's row: the middle of
    // the whole item may fall between rows (a nested list's margin), depending on the fonts.
    await panel().locator('#tree > li > .row').first().hover();
    const lit = await until('the highlight', () => page.locator('.cm-bx-highlight').allTextContents(), (t) => t.length > 0);
    assert.ok(lit.join('').startsWith('sed -E'), lit.join(''));

    // A skeleton label (the `while` line of the sample): code in monospace, placeholders apart in muted italics.
    const whileLine = fs.readFileSync(path.join(root, 'test/fixtures/sample.sh'), 'utf8').split('\n').findIndex((l) => l.startsWith('while read'));
    // The keys must reach the editor again: hovering the panel left the focus there.
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+Home');
    for (let i = 0; i < whileLine; i++) await page.keyboard.press('ArrowDown');
    await until('the while line', text('#line'), (t) => t.startsWith('while read'));
    const label = panel().locator('#tree .label').first();
    assert.strictEqual(await label.innerText(), 'while condition do commands done < input.txt');
    // A function, not a string: `evaluate` runs a string as an expression and does not call it. The tests
    // have no DOM types, hence `any`.
    const style = (el: any) => { const c = (globalThis as any).getComputedStyle(el); return { style: c.fontStyle as string, color: c.color as string, family: c.fontFamily as string }; };
    const ph = await label.locator('.ph').first().evaluate(style);
    const parent = await label.evaluate(style);
    assert.strictEqual(ph.style, 'italic');
    assert.notStrictEqual(ph.family, parent.family);
    assert.notStrictEqual(ph.color, parent.color);

    // Another shell: the problems and their quick fixes.
    await choose(page, '#shell', 'dash');
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
    await choose(page2, '#lang', 'ja');
    await until('the Japanese menu', async () => (await page2.locator('#shell-label').textContent()) ?? '', (t) => t === 'シェル');

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
