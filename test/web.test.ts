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

/** Chooses the file kind with the top bar's picker, by mouse. */
async function pickKind(page: Page, kind: string): Promise<void> {
  await page.locator('#kind').click();
  await page.locator(`#kind-list [data-value="${kind}"]`).click();
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

  it('keeps the source line of the panel at the top while the explanation scrolls, and is capped', async () => {
    const ctx = await browser!.newContext({ viewport: { width: 1280, height: 420 } });
    const page = await ctx.newPage();
    await page.goto(base);
    const panel = () => page.frames().find((f) => f.url().endsWith('/panel.html'))!;
    await until('the panel', () => Promise.resolve(panel()), (f) => !!f);
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText('grep -rn "ERROR $USER" ./src 2>&1 | sort | uniq -c | sort -rn | head -n 5 | tee out.txt');
    await page.keyboard.press('Control+Home');
    await until('the line explained', async () => (await panel().locator('#line').textContent()) ?? '', (t) => t.includes('ERROR'));
    const geometry = () => panel().evaluate(`(() => {
      const line = document.getElementById('line').getBoundingClientRect();
      const rows = [...document.querySelectorAll('#tree .row')].map((r) => r.getBoundingClientRect());
      return { lineTop: line.top, scrollY: window.scrollY, max: document.documentElement.scrollHeight - innerHeight, below: rows.some((r) => r.top >= line.bottom && r.bottom <= innerHeight) };
    })()`) as Promise<{ lineTop: number; scrollY: number; max: number; below: boolean }>;
    const start = await geometry();
    assert.ok(start.max > 50, 'the explanation scrolls');
    // It does not move at all, not even for the first pixels (it sticks where it starts).
    for (const y of [3, 20, 100000]) {
      await panel().evaluate(`window.scrollTo(0, ${y})`);
      const at = await until('scrolled', geometry, (x) => x.scrollY > 0);
      assert.ok(Math.abs(at.lineTop - start.lineTop) < 0.5, JSON.stringify({ y, start, at }));
    }
    const g = await geometry();
    assert.ok(g.below, JSON.stringify(g));
    await until('the edge', () => panel().locator('#top').evaluate((e) => e.classList.contains('stuck')), (v) => v);
    // Nothing scrolled under it shows above it, not even at its rounded corners.
    const above = await panel().evaluate(`(() => {
      const line = document.getElementById('line');
      const r = line.getBoundingClientRect();
      const out = [];
      for (let y = 0; y <= r.top + 3; y++) for (let x = 0; x < innerWidth; x += 2) {
        const e = document.elementFromPoint(x, y);
        if (e && e !== document.body && e !== document.documentElement && e.id !== 'top' && !line.contains(e)) out.push(x + ',' + y + ' ' + e.tagName + '.' + e.className);
      }
      return out.slice(0, 5);
    })()`) as string[];
    assert.deepStrictEqual(above, []);
    // Hovering a token of the sticky line still lights a segment and its row.
    await panel().locator('#line .seg').first().hover();
    assert.ok((await panel().locator('.seg.active').count()) > 0);
    // The block shows the cursor's own line only, so it is one line tall; a very long line scrolls inside the box, and the box is capped at 40% of the panel anyway.
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText(`echo ${'word '.repeat(120)}| sort`);
    await page.keyboard.press('Control+Home');
    await until('the long line explained', async () => (await panel().locator('#line').textContent()) ?? '', (t) => t.includes('word word'));
    const long = await until('the long line', () => panel().evaluate(`(() => { const l = document.getElementById('line'); return { h: l.getBoundingClientRect().height, sw: l.scrollWidth, cw: l.clientWidth, max: parseFloat(getComputedStyle(l).maxHeight), inner: innerHeight }; })()`) as Promise<{ h: number; sw: number; cw: number; max: number; inner: number }>, (x) => x.sw > x.cw);
    assert.ok(long.h < 80, JSON.stringify(long));
    assert.ok(Math.abs(long.max - long.inner * 0.4) < 1, JSON.stringify(long));
    // Selecting a row scrolls the line sideways to its characters, as the editor does; and back.
    const shown = (word: string) => panel().evaluate(`(() => {
      const l = document.getElementById('line').getBoundingClientRect();
      const s = [...document.querySelectorAll('#line .seg')].find((e) => e.textContent.trim() === ${JSON.stringify(word)}).getBoundingClientRect();
      return { left: document.getElementById('line').scrollLeft, inside: s.left >= l.left && s.right <= l.right };
    })()`) as Promise<{ left: number; inside: boolean }>;
    assert.deepStrictEqual(await shown('echo'), { left: 0, inside: true });
    await panel().locator('#tree code.label', { hasText: /^sort$/ }).first().click();
    const end = await until('scrolled to sort', () => shown('sort'), (x) => x.inside);
    assert.ok(end.left > 0, JSON.stringify(end));
    await panel().locator('#tree code.label', { hasText: /^echo$/ }).first().click();
    assert.deepStrictEqual(await until('scrolled back', () => shown('echo'), (x) => x.inside), { left: 0, inside: true });
    await ctx.close();
  });

  it('folds a row over several lines without moving the cursor to its last line', async () => {
    const ctx = await browser!.newContext();
    const page = await ctx.newPage();
    await page.goto(base);
    const panel = () => page.frames().find((f) => f.url().endsWith('/panel.html'))!;
    await until('the panel', () => Promise.resolve(panel()), (f) => !!f);
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText('if [ -z "${1:-}" ]; then\n  echo none\nfi');
    await page.keyboard.press('Control+Home');
    await until('the line explained', async () => (await panel().locator('#line').textContent()) ?? '', (t) => t.includes('-z'));
    // The if covers lines 1 to 3: a click folds it, and the cursor and the panel stay on line 1.
    await panel().locator('#tree > li > .row .label').first().click();
    await until('folded', () => panel().locator('#tree > li').first().evaluate((e) => e.classList.contains('collapsed')), (v) => v);
    await page.waitForTimeout(300);
    assert.match((await panel().locator('#line').textContent()) ?? '', /-z/);
    assert.match(await page.locator('.cm-activeLine').innerText(), /^if \[/);
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
    await page.locator('#collapse').click();
    assert.strictEqual(await panel().locator('#tree .collapsed').count(), 0);
    await page.locator('#collapse').click();
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

  it('keeps the header and the source line of the panel together at the top where the header shows (VS Code)', async () => {
    const ctx = await browser!.newContext();
    const page = await ctx.newPage();
    await page.goto(`${base}stub`);
    await page.evaluate(`window.got = []; window.addEventListener('message', (e) => window.got.push(e.data));
      document.body.insertAdjacentHTML('beforeend', '<iframe id="f" src="${base}pr/123/?view=panel" style="width:300px;height:420px"></iframe>');`);
    await until('the handshake', () => page.evaluate('window.got.find((m) => m.type === "bx-ready") || null') as Promise<unknown>, (m) => !!m);
    const text = 'grep -rn "ERROR $USER" ./src 2>&1 | sort | uniq -c | sort -rn | head -n 5 | tee out.txt\n';
    await page.evaluate(`document.getElementById('f').contentWindow.postMessage({ type: 'bx-state', text: ${JSON.stringify(text)}, kind: 'shell', line: 0, col: 0, lang: 'en', theme: 'auto', choice: {} }, location.origin)`);
    const inner = () => page.frames().find((x) => x.url().endsWith('/pr/123/panel.html') && x !== page.mainFrame())!;
    await until('the line explained', async () => (await inner()?.locator('#line').textContent().catch(() => '')) ?? '', (t) => t.includes('ERROR'));
    const geometry = () => inner().evaluate(`(() => {
      const h = document.querySelector('header').getBoundingClientRect();
      const l = document.getElementById('line').getBoundingClientRect();
      const lh = parseFloat(getComputedStyle(document.querySelector('.where')).lineHeight) || 20;
      return { hTop: h.top, hBottom: h.bottom, hHeight: h.height, lTop: l.top, scrollY: window.scrollY, max: document.documentElement.scrollHeight - innerHeight, lh };
    })()`) as Promise<{ hTop: number; hBottom: number; hHeight: number; lTop: number; scrollY: number; max: number; lh: number }>;
    const start = await geometry();
    assert.ok(start.max > 50, 'the explanation scrolls');
    assert.ok(start.hHeight > start.lh * 2.2, `the header wraps to two rows: ${JSON.stringify(start)}`);
    assert.ok(Math.abs(start.lTop - start.hBottom) < 9, JSON.stringify(start));
    for (const y of [3, 20, 100000]) {
      await inner().evaluate(`window.scrollTo(0, ${y})`);
      const at = await until('scrolled', geometry, (x) => x.scrollY > 0);
      assert.ok(Math.abs(at.hTop - start.hTop) < 0.5, JSON.stringify({ y, start, at }));
      assert.ok(Math.abs(at.lTop - start.lTop) < 0.5, JSON.stringify({ y, start, at }));
      assert.ok(Math.abs(at.lTop - at.hBottom - (start.lTop - start.hBottom)) < 1, JSON.stringify({ y, start, at }));
    }
    const above = await inner().evaluate(`(() => {
      const line = document.getElementById('line');
      const r = line.getBoundingClientRect();
      const out = [];
      for (let y = 0; y <= r.bottom; y++) for (let x = 0; x < innerWidth; x += 2) {
        const e = document.elementFromPoint(x, y);
        if (e && e !== document.body && e !== document.documentElement && e.id !== 'top' && !line.contains(e) && !document.querySelector('header').contains(e)) out.push(x + ',' + y + ' ' + e.tagName + '.' + e.className);
      }
      return out.slice(0, 5);
    })()`) as string[];
    assert.deepStrictEqual(above, []);
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
    await pickKind(page, 'dockerfile');
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

  it('colours the editor and the panel alike, in the panel\'s palette, light and dark', async () => {
    const ctx = await browser!.newContext({ locale: 'en-US', colorScheme: 'light' });
    // Settings kept by a build that had the colors setting (before 0.7.0): the key is ignored.
    await ctx.addInitScript("try { if (!localStorage.getItem('bash-explainer-settings')) localStorage.setItem('bash-explainer-settings', JSON.stringify({ colors: 'vscode' })); } catch {}");
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
    const both = async (kind: string) => [
      await until(`the ${kind} in the editor`, () => colour(page.locator(`.cm-bx-${kind}`)), (c) => !!c),
      await until(`the ${kind} in the panel`, async () => (await panel().locator(`.kind-${kind}`).count() ? colour(panel().locator(`.kind-${kind}`)) : ''), (c) => !!c),
    ];
    // VS Code's chart colours: orange options and blue commands, light, then dark.
    assert.deepStrictEqual(await both('option'), ['rgb(194, 107, 0)', 'rgb(194, 107, 0)']);
    assert.deepStrictEqual(await both('command'), ['rgb(26, 133, 255)', 'rgb(26, 133, 255)']);
    await page.emulateMedia({ colorScheme: 'dark' });
    await until('the dark option', async () => (await both('option')).join('|'), (c) => c === 'rgb(209, 134, 22)|rgb(209, 134, 22)');
    assert.deepStrictEqual(await both('command'), ['rgb(55, 148, 255)', 'rgb(55, 148, 255)']);
    // No palette to choose in the settings.
    await page.locator('#settings-open').click();
    assert.strictEqual(await page.locator('#setting-colors, [data-key="colors"]').count(), 0);
    await page.locator('#settings-done').click();
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  });

  it('shows the descriptions of the settings without VS Code-only Markdown (#bashExplainer.key# links, command links)', async () => {
    for (const locale of ['en-US', 'ja-JP']) {
      const ctx = await browser!.newContext({ locale });
      const page = await ctx.newPage();
      await page.goto(base);
      await page.locator('#settings-open').click();
      const body = await page.locator('.settings-body').innerText();
      assert.ok(!/#bashExplainer|\]\(|\*\*|`/.test(body), `${locale}: raw Markdown left in the dialog`);
      await ctx.close();
    }
  });

  it('wraps long lines in the editor when the editor.wrap setting is on: kept, exported, imported and reset', async () => {
    const ctx = await browser!.newContext({ locale: 'en-US', viewport: { width: 360, height: 740 } });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base);
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    const long = `echo ${Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ')}`;
    await page.keyboard.insertText(`echo first\n${long}\necho last`);
    const metrics = () => page.evaluate(`(() => {
      const lines = document.querySelectorAll('.cm-line');
      const sc = document.querySelector('.cm-scroller');
      if (lines.length !== 3) return { height: 0, short: 0, over: false };
      return { height: lines[1].getBoundingClientRect().height, short: lines[0].getBoundingClientRect().height, over: sc.scrollWidth > sc.clientWidth + 1 };
    })()`) as Promise<{ height: number; short: number; over: boolean }>;
    const off = await until('the three lines', metrics, (m) => m.height > 0);
    assert.ok(off.over && off.height < off.short * 1.5, 'off: one row, scrolls sideways');
    await page.locator('#settings-open').click();
    assert.strictEqual(await page.locator('#setting-editor-wrap').isChecked(), false);
    assert.match(await page.locator('[data-key="editor.wrap"]').innerText(), /Wrap long lines/);
    await page.locator('#setting-editor-wrap').check();
    await page.locator('#settings-done').click();
    const on = await until('the wrapped line', metrics, (m) => !m.over);
    assert.ok(on.height > on.short * 2 && !on.over, `on: wrapped, no horizontal scroll ${JSON.stringify(on)}`);
    // Clicking the start of the line puts the cursor on it, and the active line is the whole wrapped line.
    const box = (await page.locator('.cm-line').nth(1).boundingBox())!;
    await page.mouse.click(box.x + 2, box.y + 4);
    assert.match(await page.locator('.cm-activeLine').innerText(), /^echo word0 /);
    // Kept across a reload, and in the export.
    await page.reload();
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText(`echo first\n${long}\necho last`);
    const again = await until('wrapping after reload', metrics, (m) => m.height > 0 && !m.over);
    assert.ok(again.height > again.short || again.height > 30);
    await page.locator('#settings-open').click();
    assert.strictEqual(await page.locator('#setting-editor-wrap').isChecked(), true);
    const text = await page.evaluate('localStorage.getItem("bash-explainer-settings")') as string;
    assert.deepStrictEqual(JSON.parse(text), { 'bashExplainer.editor.wrap': true });
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#settings-export').click()]);
    const file = await download.path();
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { 'bashExplainer.editor.wrap': true });
    // Reset turns it off; importing the file turns it on again.
    await page.locator('#settings-reset').click();
    assert.strictEqual(await page.evaluate('localStorage.getItem("bash-explainer-settings")'), null);
    assert.strictEqual(await page.locator('#setting-editor-wrap').isChecked(), false);
    await page.locator('#settings-done').click();
    assert.ok((await metrics()).over, 'reset: sideways scroll again');
    await page.locator('#settings-open').click();
    await page.locator('#settings-file').setInputFiles(file);
    await until('the import', () => page.locator('#setting-editor-wrap').isChecked(), (c) => c);
    await page.locator('#settings-done').click();
    assert.ok(!(await metrics()).over);
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
    await until('the dialog closed', () => page.locator('#settings-dialog').isVisible(), (v) => !v);
    await choose(page, '#lang', 'en');
    // The panel's header is not shown on the page; a shell chosen in the menu is the setting.
    assert.strictEqual(await panel().locator('header').isHidden(), true);
    await choose(page, '#shell', 'dash');
    await page.locator('#settings-open').click();
    await until('the dialog', () => page.locator('#settings-dialog').isVisible(), (v) => v);
    assert.strictEqual(await page.locator('#setting-shell').inputValue(), 'dash');
    assert.strictEqual(await page.locator('#setting-language').inputValue(), 'en');
    await page.keyboard.press('Escape');
    await until('the dialog closed', () => page.locator('#settings-dialog').isVisible(), (v) => !v);

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
      await until('the menu closed', () => page.locator('#drawer').evaluate((d) => (d as unknown as { open: boolean }).open), (v) => !v);
    }
    // The top bar is one row, and its controls are big enough to tap.
    const bar = await page.evaluate('document.querySelector(".top").getBoundingClientRect().height') as number;
    assert.ok(bar <= 49, String(bar));
    const small = await page.evaluate('[...document.querySelectorAll(".top select, .top button")].filter((e) => e.getClientRects().length && e.getBoundingClientRect().height < 40).map((e) => e.id)');
    assert.deepStrictEqual(small, []);
    await ctx.close();
  });

  it('has no panel header on the page: fold, quick reference and copy are in the top bar from 768px up (on a phone the copy and the link are in the menu), the shell in the menu or the top bar (1200px and up)', async () => {
    for (const [width, height] of [[768, 800], [1280, 800]]) {
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
      // The editor shows the start of its lines: not scrolled sideways, the first character right of the gutter.
      const start = (await page.evaluate(`(() => {
        const line = document.querySelector('.cm-line');
        const r = document.createRange();
        r.setStart(line.firstChild, 0);
        r.setEnd(line.firstChild, 1);
        return [document.querySelector('.cm-scroller').scrollLeft, r.getBoundingClientRect().left, document.querySelector('.cm-gutters').getBoundingClientRect().right, line.textContent.slice(0, 2)];
      })()`)) as [number, number, number, string];
      assert.ok(start[0] === 0 && start[1] >= start[2] - 0.5 && start[3] === '#!', `${width}px: ${start}`);
      const wide = width >= 1200;
      // The three buttons are in the top bar, inside it, and not in the menu (the copy is there on a phone only).
      for (const id of ['#collapse', '#ref', '#copy-md']) {
        assert.strictEqual(await page.locator(id).isVisible(), true, `${id} at ${width}px`);
        assert.strictEqual(await page.locator(`.top ${id}`).count(), 1);
      }
      assert.strictEqual(await page.locator('#menu-collapse, #menu-ref').count(), 0);
      await page.locator('#menu-open').click();
      assert.strictEqual(await page.locator('#menu-copy').isVisible(), false);
      await page.evaluate("document.getElementById('drawer').close()");
      assert.strictEqual(await page.locator('#shell-top').isVisible(), wide);
      // Still one row of 48px, with nothing hanging out of the bar.
      const bar = (await page.evaluate('(() => { const t = document.querySelector(".top"); return [t.getBoundingClientRect().height, t.scrollWidth <= t.clientWidth]; })()')) as [number, boolean];
      assert.deepStrictEqual(bar, [48, true]);
      const names = await page.evaluate('["collapse", "copy-md", "ref"].map((id) => [document.getElementById(id).getAttribute("aria-label"), document.getElementById(id).title])');
      assert.deepStrictEqual(names, [['Collapse all', 'Collapse all'], ['Copy as Markdown', 'Copy as Markdown'], ['Quick reference', 'Quick reference']]);
      if (wide) assert.strictEqual(await page.locator('#shell-top').getAttribute('aria-label'), 'Shell');

      // Shell: the setting, as the panel's select was.
      if (wide) await page.locator('#shell-top').selectOption('dash');
      else await choose(page, '#shell', 'dash');
      await until('the problems for dash', () => page.locator('#problem-list').innerText(), (t) => t.includes('dbracket'));
      assert.strictEqual(await page.locator('#shell').inputValue(), 'dash');
      assert.strictEqual(await page.locator('#shell-top').inputValue(), 'dash');

      // Collapse all, then Expand all.
      await page.locator('.cm-line').nth(7).click();
      await until('a tree', () => panel().locator('#tree li li').count(), (n) => n > 0);
      await page.locator('#collapse').click();
      await until('collapsed', () => panel().locator('#tree .collapsed').count(), (n) => n > 0);
      await until('the name', async () => (await page.locator('#collapse').getAttribute('aria-label')) ?? '', (t) => t === 'Expand all');
      assert.strictEqual(await page.locator('#collapse').getAttribute('title'), 'Expand all');
      await page.locator('#collapse').click();
      await until('expanded', () => panel().locator('#tree .collapsed').count(), (n) => n === 0);

      // Copy as Markdown.
      await page.evaluate('navigator.clipboard.writeText("")');
      await page.locator('#copy-md').click();
      const md = await until('the copy', () => page.evaluate('navigator.clipboard.readText()') as Promise<string>, (t) => t.length > 0);
      assert.match(md, /`/);

      // Quick reference, and back.
      await page.locator('#ref').click();
      await until('the reference', () => panel().locator('#reference').isVisible(), (v) => v);
      assert.strictEqual(await page.locator('#ref').getAttribute('aria-pressed'), 'true');
      await until('the name', async () => (await page.locator('#ref').getAttribute('aria-label')) ?? '', (t) => t === '← Back to the explanation');
      await page.locator('#ref').click();
      await until('the explanation again', () => panel().locator('#main').isVisible(), (v) => v);
      assert.strictEqual(await page.locator('#ref').getAttribute('aria-pressed'), 'false');

      // Keyboard access: the buttons are in the tab order and work with Enter and Space.
      await page.locator('#collapse').focus();
      await page.keyboard.press('Enter');
      await until('collapsed by the keyboard', () => panel().locator('#tree .collapsed').count(), (n) => n > 0);
      await page.keyboard.press('Tab');
      assert.strictEqual(await page.evaluate('document.activeElement.id'), 'ref');
      await page.keyboard.press('Space');
      await until('the reference by the keyboard', () => panel().locator('#reference').isVisible(), (v) => v);
      // (The quick reference takes the focus to its search field.)
      await page.locator('#ref').focus();
      await page.keyboard.press('Enter');
      await until('the explanation by the keyboard', () => panel().locator('#main').isVisible(), (v) => v);
      await page.locator('#ref').focus();
      await page.keyboard.press('Tab');
      assert.strictEqual(await page.evaluate('document.activeElement.id'), 'copy-md');

      // Japanese names.
      await choose(page, '#lang', 'ja');
      await until('ja names', async () => (await page.locator('#copy-md').getAttribute('aria-label')) ?? '', (t) => t === 'Markdown でコピー');
      assert.strictEqual(await page.locator('#copy-md').getAttribute('title'), 'Markdown でコピー');
      assert.strictEqual(await page.locator('#shell-label').textContent(), 'シェル');
      await ctx.close();
    }
  });

  it("links to the repository with GitHub's mark, black on a light page and white on a dark one, at the size of the other icons", async () => {
    for (const scheme of ['light', 'dark'] as const) {
      const ctx = await browser!.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: scheme, locale: 'en-US' });
      const page = await ctx.newPage();
      await page.goto(base);
      await page.locator('.cm-line').first().waitFor();
      const look = (sel: string) => page.evaluate(`(() => { const s = document.querySelector('${sel} svg'); const cs = getComputedStyle(s); const r = s.getBoundingClientRect(); return [cs.fill, cs.stroke, Math.round(r.width), Math.round(r.height), s.querySelector('use').getAttribute('href')]; })()`);
      const fill = scheme === 'light' ? 'rgb(0, 0, 0)' : 'rgb(255, 255, 255)';
      assert.deepStrictEqual(await look('#github'), [fill, 'none', 18, 18, '#i-github']);
      assert.strictEqual(await page.locator('#github').getAttribute('aria-label'), 'GitHub repository');
      assert.strictEqual(await page.locator('#github').getAttribute('href'), 'https://github.com/sf624/bash-explainer');
      // The same size as the other buttons, and smaller than the page's own logo.
      const [gh, share, logo] = await Promise.all(['#github', '#share', '.brand img'].map(async (s) => (await page.locator(s).boundingBox())!));
      assert.ok(gh.width === share.width && gh.height === share.height && logo.height > 18, JSON.stringify([gh, share, logo]));
      await page.locator('#menu-open').click();
      assert.deepStrictEqual(await look('#menu-github'), [fill, 'none', 18, 18, '#i-github']);
      await page.evaluate("document.getElementById('drawer').close()");
      // In Japanese too.
      await choose(page, '#lang', 'ja');
      await until('ja name', async () => (await page.locator('#github').getAttribute('aria-label')) ?? '', (t) => t === 'GitHub リポジトリ');
      await ctx.close();
    }
  });

  it('chooses the file kind with a compact picker in the top bar (768px and up), by mouse and by keyboard, and the sample follows', async () => {
    for (const [width, height] of [[768, 800], [1280, 800]]) {
      const ctx = await browser!.newContext({ viewport: { width, height }, locale: 'en-US' });
      const page = await ctx.newPage();
      await page.goto(base);
      await page.locator('.cm-line').nth(5).waitFor();
      const kind = page.locator('#kind');
      const list = page.locator('#kind-list');
      const text = () => page.evaluate('document.querySelector(".cm-content").innerText') as Promise<string>;
      // A button that says what it opens, with the kind as its name; a short name on a phone, the whole one on a desktop.
      assert.strictEqual(await kind.getAttribute('aria-haspopup'), 'listbox');
      assert.strictEqual(await kind.getAttribute('aria-expanded'), 'false');
      assert.strictEqual(await kind.getAttribute('aria-label'), 'File: Shell script');
      assert.strictEqual(await kind.innerText(), 'Shell script');
      const box = (await kind.boundingBox())!;
      assert.ok(box.height >= 30 && box.width >= 40, JSON.stringify(box));
      assert.strictEqual(await list.isVisible(), false);

      // By mouse: open, choose; the list closes, the sample is the new kind's.
      await kind.click();
      assert.strictEqual(await kind.getAttribute('aria-expanded'), 'true');
      assert.strictEqual(await list.isVisible(), true);
      assert.strictEqual(await list.getAttribute('role'), 'listbox');
      assert.strictEqual(await list.locator('[role="option"]').count(), 8);
      assert.strictEqual(await list.locator('[aria-selected="true"]').innerText(), 'Shell script');
      // The list is in the window.
      const lb = (await list.boundingBox())!;
      assert.ok(lb.x >= 0 && lb.x + lb.width <= width && lb.y + lb.height <= height, JSON.stringify(lb));
      await list.locator('[data-value="dockerfile"]').click();
      assert.strictEqual(await list.isVisible(), false);
      assert.strictEqual(await kind.getAttribute('aria-expanded'), 'false');
      await until('the Dockerfile sample', text, (t) => /^FROM /m.test(t));
      assert.strictEqual(await kind.getAttribute('aria-label'), 'File: Dockerfile');
      assert.strictEqual(await kind.innerText(), 'Dockerfile');
      assert.strictEqual(await page.evaluate('document.activeElement.id'), 'kind');
      // A press outside closes it without a change.
      await kind.click();
      await page.mouse.click(width - 5, height - 5);
      assert.strictEqual(await list.isVisible(), false);
      assert.strictEqual(await kind.getAttribute('aria-label'), 'File: Dockerfile');

      // By keyboard: the focus goes to the chosen one, the arrows move, Escape closes without a change
      // and gives the focus back, Enter chooses.
      await kind.focus();
      await page.keyboard.press('ArrowDown');
      assert.strictEqual(await list.isVisible(), true);
      assert.strictEqual(await page.evaluate('document.activeElement.dataset.value'), 'dockerfile');
      await page.keyboard.press('ArrowDown');
      assert.strictEqual(await page.evaluate('document.activeElement.dataset.value'), 'makefile');
      await page.keyboard.press('Escape');
      assert.strictEqual(await list.isVisible(), false);
      assert.strictEqual(await page.evaluate('document.activeElement.id'), 'kind');
      assert.strictEqual(await kind.getAttribute('aria-label'), 'File: Dockerfile');
      await page.keyboard.press('Enter');
      assert.strictEqual(await list.isVisible(), true);
      await page.keyboard.press('End');
      assert.strictEqual(await page.evaluate('document.activeElement.dataset.value'), 'bats');
      await page.keyboard.press('ArrowUp');
      assert.strictEqual(await page.evaluate('document.activeElement.dataset.value'), 'jenkinsfile');
      await page.keyboard.press('Home');
      assert.strictEqual(await page.evaluate('document.activeElement.dataset.value'), 'shell');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      assert.strictEqual(await list.isVisible(), false);
      assert.strictEqual(await page.evaluate('document.activeElement.id'), 'kind');
      await until('the Makefile sample', text, (t) => !/^FROM /m.test(t) && /^\S+:/m.test(t));
      assert.strictEqual(await kind.getAttribute('aria-label'), 'File: Makefile');
      // Tab closes the list and goes on from the button.
      await page.keyboard.press('Space');
      assert.strictEqual(await list.isVisible(), true);
      await page.keyboard.press('Tab');
      assert.strictEqual(await list.isVisible(), false);
      assert.notStrictEqual(await page.evaluate('document.activeElement.id'), 'kind');

      // The names follow the language.
      await choose(page, '#lang', 'ja');
      await until('ja name', async () => (await kind.getAttribute('aria-label')) ?? '', (t) => t === 'ファイル: Makefile');
      await kind.click();
      assert.strictEqual(await list.getAttribute('aria-label'), 'ファイル');
      assert.strictEqual(await list.locator('[data-value="shell"]').innerText(), 'シェルスクリプト');
      await ctx.close();
    }
  });

  it('has the logo and the name in the top bar of a phone, and the file kind, the copy and the link in the menu; from 320px to 430px, in both themes, nothing overflows and every button is 40px or more', async () => {
    const { devices } = await import('playwright-core');
    for (const scheme of ['light', 'dark'] as const) {
      for (const width of [320, 360, 390, 430]) {
        const ctx = await browser!.newContext({ ...devices['iPhone 13'], viewport: { width, height: 740 }, locale: 'en-US', colorScheme: scheme });
        await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base.slice(0, -1) });
        const page = await ctx.newPage();
        await page.goto(base);
        await page.locator('.cm-line').nth(2).waitFor();
        // Read mode on, as on a phone in use.
        await page.locator('#readtip-close').tap().catch(() => undefined);
        await page.locator('#readmode').tap();
        const ids = ['menu-open', 'collapse', 'ref', 'readmode', 'settings-open'];
        const m = (await page.evaluate(`(() => {
          const t = document.querySelector('.top');
          const boxes = ${JSON.stringify(ids)}.map((id) => { const e = document.getElementById(id); const r = e.getBoundingClientRect(); return [id, e.getClientRects().length > 0, r.left, r.right, r.width, r.height]; });
          const name = document.querySelector('.brand-name'), brand = document.querySelector('.brand'), img = document.querySelector('.brand img');
          const shown = (sel) => document.querySelector(sel).getClientRects().length > 0;
          return { h: t.getBoundingClientRect().height, bar: t.scrollWidth <= t.clientWidth, page: document.documentElement.scrollWidth <= document.documentElement.clientWidth, boxes,
            brand: [brand.getBoundingClientRect().left, brand.getBoundingClientRect().right, img.getBoundingClientRect().width], whole: name.scrollWidth <= name.clientWidth, text: name.textContent, rows: Math.round(name.getBoundingClientRect().height / parseFloat(getComputedStyle(name).lineHeight)),
            hidden: ['#kind', '#copy-md', '#share'].map((s) => shown(s)), href: brand.getAttribute('href') };
        })()`)) as { h: number; bar: boolean; page: boolean; boxes: [string, boolean, number, number, number, number][]; brand: [number, number, number]; whole: boolean; text: string; rows: number; hidden: boolean[]; href: string };
        const where = `${width}px ${scheme}`;
        assert.ok(m.h <= 49 && m.bar && m.page && m.whole, `${where}: ${JSON.stringify(m)}`);
        assert.strictEqual(m.text, 'Bash Explainer');
        assert.strictEqual(m.href, './');
        assert.ok(m.brand[2] >= 24, where);
        // One line from 390px, two lines below it.
        assert.strictEqual(m.rows, width >= 390 ? 1 : 2, where);
        assert.deepStrictEqual(m.hidden, [false, false, false], where);
        for (const [id, shown, left, right, w, h] of m.boxes) {
          assert.ok(shown && left >= 0 && right <= width + 0.5 && w >= 40 && h >= 40, `${where}: ${id} ${[shown, left, right, w, h]}`);
        }
        // In order, and not on each other: the menu, the logo and name, then the buttons.
        assert.ok(m.brand[0] >= m.boxes[0][3] - 0.5 && m.boxes[1][2] >= m.brand[1] - 0.5, where);
        for (let i = 1; i < m.boxes.length; i++) assert.ok(m.boxes[i][2] >= m.boxes[i - 1][3] - 0.5, `${where}: ${m.boxes[i][0]}`);
        if (scheme === 'light' && (width === 320 || width === 390)) {
          // The menu's selects share one column (same left edge and width), and no kind name is cut.
          await page.locator('#menu-open').tap();
          const cols = (await page.evaluate(`(() => { const c = document.createElement('canvas').getContext('2d'); return [...document.querySelectorAll('#drawer .field select')].filter((s) => s.clientWidth).map((s) => { const r = s.getBoundingClientRect(); const cs = getComputedStyle(s); c.font = cs.font; const room = s.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight); return [s.id, Math.round(r.left * 10) / 10, Math.round(r.width * 10) / 10, Math.max(...[...s.options].map((o) => c.measureText(o.text).width)) <= room]; }); })()`)) as [string, number, number, boolean][];
          assert.ok(cols.length >= 5 && cols.every(([, l, w, fits]) => l === cols[0][1] && w === cols[0][2] && fits), `${where}: ${JSON.stringify(cols)}`);
          await page.locator('#menu-close').tap();
        }
        if (scheme === 'light' && (width === 320 || width === 390)) {
          // The copy and the link work from the menu.
          await page.evaluate('navigator.clipboard.writeText("")');
          await page.locator('.cm-line').nth(7).tap();
          await page.locator('#menu-open').tap();
          await page.locator('#menu-copy').tap();
          assert.strictEqual(await page.locator('#drawer').evaluate((d) => (d as unknown as { open: boolean }).open), false);
          const md = await until('the copy', () => page.evaluate('navigator.clipboard.readText()') as Promise<string>, (t) => t.length > 0);
          assert.match(md, /`/);
          await page.evaluate('navigator.clipboard.writeText("")');
          await page.locator('#menu-open').tap();
          await page.locator('#menu-share').tap();
          const link = await until('the link', () => page.evaluate('navigator.clipboard.readText()') as Promise<string>, (t) => t.includes('#'));
          assert.ok(link.startsWith(base), link);
        }
        await ctx.close();
      }
    }
  });

  it('chooses the file kind from the menu on a phone, the sample follows, and the names follow the language', async () => {
    const { devices } = await import('playwright-core');
    const ctx = await browser!.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 740 }, locale: 'en-US' });
    const page = await ctx.newPage();
    await page.goto(base);
    await page.locator('.cm-line').nth(5).waitFor();
    const text = () => page.evaluate('document.querySelector(".cm-content").innerText') as Promise<string>;
    assert.strictEqual(await page.locator('#kind').isVisible(), false);
    await page.locator('#menu-open').tap();
    const select = page.locator('#kind-menu');
    // The first control of the menu, named "File", with every kind.
    assert.strictEqual(await select.isVisible(), true);
    assert.strictEqual(await select.getAttribute('aria-label'), 'File');
    assert.strictEqual(await select.inputValue(), 'shell');
    assert.strictEqual(await select.locator('option').count(), 8);
    assert.strictEqual(await page.evaluate("document.querySelector('#drawer .field select').id"), 'kind-menu');
    assert.ok((await select.boundingBox())!.height >= 40);
    await select.selectOption('dockerfile');
    await until('the Dockerfile sample', text, (t) => /^FROM /m.test(t));
    assert.strictEqual(await select.inputValue(), 'dockerfile');
    // The language: the label and the names of the kinds.
    await choose(page, '#lang', 'ja');
    await until('ja label', async () => (await select.getAttribute('aria-label')) ?? '', (t) => t === 'ファイル');
    assert.strictEqual(await page.locator('#kind-label').textContent(), 'ファイル');
    assert.strictEqual(await select.locator('option[value="shell"]').textContent(), 'シェルスクリプト');
    assert.strictEqual(await select.inputValue(), 'dockerfile');
    await ctx.close();
  });

  it('does not move the focus to the quick reference\'s search field on a touch screen (no on-screen keyboard), and does with a mouse', async () => {
    const { devices } = await import('playwright-core');
    for (const touch of [true, false]) {
      const ctx = await browser!.newContext(touch ? { ...devices['iPhone 13'], viewport: { width: 390, height: 740 }, locale: 'en-US' } : { viewport: { width: 1280, height: 800 }, locale: 'en-US' });
      const page = await ctx.newPage();
      await page.goto(base);
      await page.locator('.cm-line').nth(5).waitFor();
      const panel = () => page.frames().find((f) => f.url().endsWith('/panel.html'))!;
      if (touch) await page.locator('#ref').tap();
      else await page.locator('#ref').click();
      await until('the reference', () => panel().locator('#reference').isVisible(), (v) => v);
      const focused = () => panel().evaluate('document.activeElement && document.activeElement.id');
      if (touch) {
        await page.waitForTimeout(300);
        assert.notStrictEqual(await focused(), 'ref-search');
        assert.strictEqual(await page.evaluate('document.activeElement.id'), 'ref');
      } else {
        await until('the search field', async () => String(await focused()), (id) => id === 'ref-search');
      }
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
    const fits = async () => page.evaluate('(() => { const t = document.querySelector(".top"); const k = document.querySelector(".brand").getBoundingClientRect(); return [t.getBoundingClientRect().height, k.width, document.documentElement.scrollWidth <= document.documentElement.clientWidth]; })()') as Promise<[number, number, boolean]>;
    await btn.tap();
    assert.strictEqual(await btn.getAttribute('aria-pressed'), 'true');
    assert.strictEqual(await page.locator('.cm-content').getAttribute('inputmode'), 'none');
    const [h, w, ok] = await fits();
    assert.ok(h <= 49 && w >= 40 && ok, String([h, w, ok]));
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
    // With the banner of the development version above the bar, the bubble moves down with the switch.
    const below = await page.evaluate('(() => { document.getElementById("channel-banner").hidden = false; document.getElementById("banner-text").textContent = "Built from main at abc1234. Not released yet, may change."; window.dispatchEvent(new Event("resize")); const t = document.querySelector("#readtip").getBoundingClientRect(); const b = document.querySelector("#readmode").getBoundingClientRect(); return { top: t.top, bottom: b.bottom }; })()') as { top: number; bottom: number };
    assert.ok(below.bottom > 48 && below.top >= below.bottom, JSON.stringify(below));
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
    // On a phone the top bar has the menu, the logo and name, the fold, the quick reference, read mode and the
    // settings; the file kind, the copy, the link and the rest are in the menu.
    const shown = async (ids: string[]) => Promise.all(ids.map(async (id) => [id, await page.locator(id).isVisible()]));
    assert.deepStrictEqual(await shown(['#kind', '.brand', '#collapse', '#ref', '#copy-md', '#share', '#settings-open', '#menu-open', '#sample', '#github', '#install']),
      [['#kind', false], ['.brand', true], ['#collapse', true], ['#ref', true], ['#copy-md', false], ['#share', false], ['#settings-open', true], ['#menu-open', true], ['#sample', false], ['#github', false], ['#install', false]]);
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
    for (const id of ['#kind-menu', '#menu-copy', '#lang', '#theme', '#channel', '#menu-sample', '#menu-share', '#menu-install', '#dev-link', '#privacy', '#version', '#notices', '#drawer a[href="LICENSE.txt"]', '#drawer a[href="https://github.com/sf624/bash-explainer"]']) {
      assert.strictEqual(await page.locator(id).isVisible(), true, id);
    }
    assert.match(await page.locator('#version').innerText(), /^Bash Explainer \d+\.\d+\.\d+/);
    // Esc closes it, and the focus goes back to the button.
    await page.keyboard.press('Escape');
    await until('the menu closed', open, (v) => !v);
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
    await until('the menu closed', open, (v) => !v);
    await page.locator('#menu-open').tap();
    await page.locator('#menu-close').tap();
    await until('the menu closed', open, (v) => !v);
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

  it('opens the settings with a swipe from the right edge on a phone, closes them with a swipe back, and never opens both sheets', async () => {
    const { devices } = await import('playwright-core');
    const ctx = await browser!.newContext({ ...devices['iPhone 13'], viewport: { width: 360, height: 740 }, locale: 'en-US' });
    const page = await ctx.newPage();
    await page.goto(base);
    await page.locator('.cm-line').first().waitFor();
    const settings = () => page.locator('#settings-dialog').evaluate((d) => (d as unknown as { open: boolean }).open);
    const menu = () => page.locator('#drawer').evaluate((d) => (d as unknown as { open: boolean }).open);
    const cdp = await ctx.newCDPSession(page);
    const swipe = async (from: number, to: number) => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from, y: 500 }] });
      for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from + ((to - from) * i) / 8, y: 500 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    assert.strictEqual(await page.locator('#edge-right').isVisible(), true);
    await swipe(356, 220);
    await until('the settings open', settings, (v) => v);
    assert.strictEqual(await menu(), false);
    // A swipe from the left edge does not open the menu over them (the dialog is modal).
    await swipe(4, 140);
    assert.strictEqual(await menu(), false);
    // A swipe back to the right closes them.
    await swipe(120, 340);
    await until('the settings closed', settings, (v) => !v);
    // The left edge still opens the menu, and the right edge then does nothing.
    await swipe(4, 140);
    await until('the menu open', menu, (v) => v);
    await swipe(356, 220);
    assert.strictEqual(await settings(), false);
    await ctx.close();
  });

  it('slides the menu and the settings out when they are closed with ×, Esc or the backdrop on a phone and on a wide screen, and at once with reduced motion', async () => {
    const { devices } = await import('playwright-core');
    const phone = { ...devices['iPhone 13'], viewport: { width: 390, height: 844 }, locale: 'en-US' };
    const wide = { viewport: { width: 1280, height: 800 }, locale: 'en-US' };
    for (const [name, dialog, opener, closer, sign] of [['menu', '#drawer', '#menu-open', '#menu-close', -1], ['settings', '#settings-dialog', '#settings-open', '#settings-dialog .settings-x', 1]] as const) {
      const start = async (options: Parameters<Browser['newContext']>[0]) => {
        const ctx = await browser!.newContext(options);
        const page = await ctx.newPage();
        await page.goto(base);
        await page.locator('.cm-line').first().waitFor();
        const isOpen = () => page.locator(dialog).evaluate((d) => (d as unknown as { open: boolean }).open);
        await page.locator(opener).click();
        await until(`${name} open`, isOpen, (v) => v);
        await page.waitForTimeout(500);
        return { ctx, page, isOpen };
      };
      for (const [screen, env, how] of ['x', 'escape', 'backdrop'].flatMap((h) => [['phone', phone, h], ['wide', wide, h]]) as ['phone' | 'wide', Parameters<Browser['newContext']>[0], 'x' | 'escape' | 'backdrop'][]) {
        // The settings fill the screen of a phone: no backdrop to tap.
        if (how === 'backdrop' && name === 'settings' && screen === 'phone') continue;
        const { ctx, page, isOpen } = await start(env);
        const home = await page.locator(dialog).evaluate((d) => d.getBoundingClientRect().x);
        // Watch the sheet's position and the backdrop's opacity from inside the page, frame by frame.
        await page.evaluate(`(() => {
          const d = document.querySelector(${JSON.stringify(dialog)});
          window.__frames = [];
          const tick = () => {
            window.__frames.push({ x: d.getBoundingClientRect().x, open: d.open, back: getComputedStyle(d, '::backdrop').opacity });
            if (d.open) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        })()`);
        if (how === 'x') await page.locator(closer).click();
        else if (how === 'escape') await page.keyboard.press('Escape');
        else await page.mouse.click(screen === 'wide' ? (sign > 0 ? 100 : 1200) : sign > 0 ? 5 : 385, 400);
        // Not closed right after: it is on its way.
        assert.strictEqual(await isOpen(), true, `${name} ${how} ${screen}: still open right after`);
        await until(`${name} ${how} closed`, isOpen, (v) => !v);
        const frames = (await page.evaluate('window.__frames')) as { x: number; open: boolean; back: string }[];
        const xs = frames.filter((f) => f.open).map((f) => f.x);
        // It moved towards its own edge in several steps, never back, and the backdrop faded.
        assert.ok(xs.some((v) => sign * (v - home) > 20 && sign * (v - home) < 300), `${name} ${how}: intermediate ${xs}`);
        for (let i = 1; i < xs.length; i++) assert.ok(sign * (xs[i] - xs[i - 1]) >= -0.5, `${name} ${how}: monotonic ${xs}`);
        assert.ok(frames.some((f) => f.open && Number(f.back) < 1 && Number(f.back) > 0), `${name} ${how}: backdrop fades ${JSON.stringify(frames.map((f) => f.back))}`);
        // Afterwards: nothing left over, and the focus is back on the opener.
        assert.strictEqual(await page.locator(dialog).evaluate((d) => d.classList.contains('closing') || (d as unknown as { style: { transform: string } }).style.transform !== ''), false);
        assert.strictEqual(await page.evaluate(`document.activeElement === document.querySelector(${JSON.stringify(opener)})`), true, `${name} ${how}: focus`);
        // It opens again.
        await page.locator(opener).click();
        await until(`${name} reopened`, isOpen, (v) => v);
        await ctx.close();
      }
      {
        // A second close while sliding out is ignored; opened again while sliding out, it comes back and stays open.
        for (const env of [phone, wide]) {
        const { ctx, page, isOpen } = await start(env);
        const home = await page.locator(dialog).evaluate((d) => d.getBoundingClientRect().x);
        await page.evaluate(`(() => {
          const c = document.querySelector(${JSON.stringify(closer)});
          c.click();
          c.click();
          document.querySelector(${JSON.stringify(opener)}).click();
        })()`);
        await page.waitForTimeout(700);
        assert.strictEqual(await isOpen(), true, `${name}: reopened while sliding out`);
        assert.strictEqual(await page.locator(dialog).evaluate((d) => d.getBoundingClientRect().x), home);
        assert.strictEqual(await page.locator(dialog).evaluate((d) => d.classList.contains('closing')), false);
        await ctx.close();
        }
      }
      for (const [label, options] of [['reduced motion', { ...phone, reducedMotion: 'reduce' as const }], ['reduced motion on a wide screen', { ...wide, reducedMotion: 'reduce' as const }]] as const) {
        const { ctx, page, isOpen } = await start(options);
        await page.locator(closer).click();
        // Closed in the same task as the click.
        assert.strictEqual(await isOpen(), false, `${name}, ${label}: closes at once`);
        await ctx.close();
      }
    }
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

  it('resizes and folds the Problems list under the editor; both are kept, and clearing the stored data resets them', async () => {
    const SCRIPT = '#!/bin/sh\n' + Array.from({ length: 6 }, (_, i) => `[[ -f file${i} ]] && echo ok${i}`).join('\n');
    const ctx = await browser!.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    const open = async () => {
      await page.goto(base);
      await page.locator('.cm-line').first().waitFor();
    };
    await open();
    assert.strictEqual(await page.locator('#problems').isHidden(), true);
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText(SCRIPT);
    await until('the problems', () => page.locator('#problem-list li').count(), (n) => n >= 6);
    const list = async () => Math.round((await page.locator('#problems').boundingBox())!.height);
    const value = () => page.locator('#problems-resize').getAttribute('aria-valuenow');
    const rows = () => page.locator('#problem-list li').first().isVisible();
    assert.match(await page.locator('#problems-toggle').innerText(), /problems\s+\d+/i);
    // The backtick spans of a message are code, not raw backticks.
    assert.ok(!(await page.locator('#problem-list').innerText()).includes('`'));
    assert.strictEqual(await page.locator('#problem-list li').first().locator('.message code').first().innerText(), '[[ ]]');
    assert.strictEqual(await page.locator('#problems-resize').getAttribute('role'), 'separator');
    assert.strictEqual(await page.locator('#problems-toggle').getAttribute('aria-expanded'), 'true');
    const first = await list();
    assert.strictEqual(Number(await value()), first);

    // A drag upwards makes the list taller; the editor keeps its lines.
    const handle = (await page.locator('#problems-resize').boundingBox())!;
    const x = handle.x + handle.width / 2, y = handle.y + handle.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y - 100, { steps: 6 });
    await page.mouse.up();
    const grown = await list();
    assert.ok(Math.abs(grown - (first + 100)) < 8, `${first} → ${grown}`);
    assert.strictEqual(Number(await value()), grown);
    // Too far: the editor keeps at least about three lines.
    await page.mouse.move(x, y - 100);
    await page.mouse.down();
    await page.mouse.move(x, 0, { steps: 6 });
    await page.mouse.up();
    assert.ok((await page.locator('#editor').boundingBox())!.height >= 60);
    // Too far down: the header and a row stay.
    const h2 = (await page.locator('#problems-resize').boundingBox())!;
    await page.mouse.move(h2.x + 50, h2.y + h2.height / 2);
    await page.mouse.down();
    await page.mouse.move(h2.x + 50, 719, { steps: 6 });
    await page.mouse.up();
    assert.ok(await list() >= 70);
    assert.strictEqual(await rows(), true);

    // The keys: Up makes it taller (30 px a step), Home and End for the ends, Enter for the default.
    await page.locator('#problems-resize').focus();
    const small = await list();
    await page.keyboard.press('ArrowUp');
    assert.strictEqual(await list(), small + 30);
    await page.keyboard.press('ArrowDown');
    assert.strictEqual(await list(), small);
    await page.keyboard.press('End');
    assert.ok(Number(await value()) > small);
    await page.keyboard.press('Home');
    assert.strictEqual(await list(), small);
    await page.keyboard.press('Enter');
    assert.strictEqual(await list(), first);
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    const kept = await list();
    assert.strictEqual(kept, first + 60);

    // Kept over a reload.
    await open();
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText(SCRIPT);
    await until('the problems', () => page.locator('#problem-list li').count(), (n) => n >= 6);
    assert.strictEqual(await list(), kept);
    assert.strictEqual(Number(await value()), kept);
    await page.locator('#problems-resize').dblclick();
    assert.strictEqual(await list(), first);
    await page.locator('#problems-resize').focus();
    await page.keyboard.press('ArrowUp');

    // Folded: the rows are hidden, only the header stays, with the count.
    await page.locator('#problems-toggle').click();
    assert.strictEqual(await page.locator('#problems-toggle').getAttribute('aria-expanded'), 'false');
    assert.strictEqual(await rows(), false);
    assert.strictEqual(await page.locator('#problems-resize').isHidden(), true);
    assert.ok(await list() < 50, String(await list()));
    assert.match(await page.locator('#problems-toggle').innerText(), /problems\s+\d+/i);
    await open();
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText(SCRIPT);
    await until('the problems', () => page.locator('#problems').isVisible(), (v) => v);
    assert.strictEqual(await page.locator('#problems-toggle').getAttribute('aria-expanded'), 'false');
    assert.strictEqual(await rows(), false);
    // Opened again, it has the height it had.
    await page.locator('#problems-toggle').click();
    assert.strictEqual(await rows(), true);
    assert.strictEqual(await list(), first + 30);

    // Cleared with the stored data.
    assert.ok((await page.evaluate('Object.keys(localStorage)') as string[]).includes('bash-explainer-problems'));
    await page.locator('#problems-toggle').click();
    await page.locator('#settings-open').click();
    await page.locator('#settings-clear').click();
    await page.locator('#settings-clear-yes').click();
    assert.deepStrictEqual(await page.evaluate('Object.keys(localStorage)'), []);
    await page.locator('#settings-done').click();
    assert.strictEqual(await page.locator('#problems-toggle').getAttribute('aria-expanded'), 'true');
    assert.strictEqual(await rows(), true);
    assert.strictEqual(await list(), first);
    await ctx.close();

    // A phone: nothing runs over the side, folded or not, and a finger drags the handle.
    const { devices } = await import('playwright-core');
    const phone = await browser!.newContext({ ...devices['iPhone 13'], viewport: { width: 360, height: 740 } });
    const p2 = await phone.newPage();
    await p2.goto(base);
    await p2.locator('.cm-line').first().waitFor();
    await p2.locator('#readtip-close').tap();
    await p2.locator('.cm-line').first().tap({ position: { x: 30, y: 5 } });
    await p2.keyboard.press('Control+A');
    await p2.keyboard.insertText(SCRIPT);
    await until('the problems', () => p2.locator('#problem-list li').count(), (n) => n >= 6);
    const flat = () => p2.evaluate('document.documentElement.scrollWidth <= innerWidth && document.scrollingElement.scrollHeight === innerHeight && document.querySelector("#problems").scrollWidth <= document.querySelector("#problems").clientWidth');
    assert.strictEqual(await flat(), true);
    const before = (await p2.locator('#problems').boundingBox())!.height;
    const hb = (await p2.locator('#problems-resize').boundingBox())!;
    const cdp = await phone.newCDPSession(p2);
    const px = hb.x + hb.width / 2, py = hb.y + hb.height / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: px, y: py }] });
    for (let i = 1; i <= 5; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: px, y: py - 20 * i }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const after = (await p2.locator('#problems').boundingBox())!.height;
    assert.ok(Math.abs(before + 100 - after) < 8, `${before} → ${after}`);
    assert.strictEqual(await flat(), true);
    await p2.waitForTimeout(300);
    await p2.locator('#problems-toggle').tap();
    assert.strictEqual(await p2.locator('#problem-list li').first().isVisible(), false);
    assert.strictEqual(await flat(), true);
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
