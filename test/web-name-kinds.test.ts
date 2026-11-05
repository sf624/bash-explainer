// The badge of what a command name is (media/panel.js `nameBadge`, src/namefacts.ts), in both views of the panel, in
// headless Chromium: on the web page at a desktop's and a phone's width, and in the VS Code panel's page
// (test/support/panel-page.ts). The badge follows the name on its line, says who looks the name up, a name with
// another meaning has its muted line, and nothing runs past the right edge. The geometry is read from positions,
// not from how wide a font draws the words.
import * as assert from 'assert';
import type { Browser, Frame, Page } from 'playwright-core';
import { servePanel, type PanelServer } from './support/panel-page';
import { chooseDepth, frames, openSite, until } from './support/site';

const LINE = 'sudo echo hi; echo hi';

interface Badge { text: string; by: string; left: number; right: number; top: number; bottom: number; nameRight: number; nameTop: number; nameBottom: number; also: string; label: string }

/** Each badge of the view shown, with its name's box, what follows it, and the tree item's name for a screen reader. */
const badges = (f: Frame | Page) => f.evaluate(`(() => {
  const vw = document.documentElement.clientWidth;
  return { vw, sw: document.documentElement.scrollWidth, items: [...document.querySelectorAll('.nk-badge')].filter((b) => b.getClientRects().length).map((b) => {
    const r = b.getBoundingClientRect();
    const name = b.previousElementSibling.getBoundingClientRect();
    const by = b.nextElementSibling && b.nextElementSibling.classList.contains('nk-by') ? b.nextElementSibling.textContent : '';
    const row = b.closest('.row, .trow');
    const also = row.querySelector('.nk-also');
    const li = b.closest('li[role="treeitem"]');
    return { text: b.textContent, by, left: r.left, right: r.right, top: r.top, bottom: r.bottom, nameRight: name.right, nameTop: name.top, nameBottom: name.bottom,
      also: also ? also.textContent : '', label: li ? li.getAttribute('aria-label') : '' };
  }) };
})()`) as Promise<{ vw: number; sw: number; items: Badge[] }>;

function checkGeometry(where: string, got: { vw: number; sw: number; items: Badge[] }): void {
  assert.ok(got.sw <= got.vw, `${where}: the page is ${got.sw} wide, the view ${got.vw}`);
  for (const b of got.items) {
    assert.ok(b.right <= got.vw, `${where}: ${b.text} ends at ${b.right}`);
    // After its name, on the name's line (their boxes overlap vertically), or under it where the row wraps.
    assert.ok(b.left >= b.nameRight - 0.5 || b.top >= b.nameBottom - 0.5, `${where}: ${b.text} before its name`);
    assert.ok(b.left >= b.nameRight - 0.5 ? b.top < b.nameBottom && b.bottom > b.nameTop : true, `${where}: ${b.text} off its name's line`);
  }
}

describe('the web page: what a command name is, at both depths', function () {
  this.timeout(120000);
  let browser: Browser;
  let base = '';
  before(async function () {
    ({ browser, base } = await openSite(this));
  });

  async function open(page: Page): Promise<Frame> {
    await page.goto(base);
    const panel = () => page.frames().find((f) => f.url().endsWith('/panel.html'))!;
    await until('the panel', () => Promise.resolve(panel()), (f) => !!f);
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText(LINE);
    await until('the line explained', async () => (await panel().locator('#line').textContent()) ?? '', (t) => t.includes(LINE.slice(0, 12)));
    return panel();
  }

  for (const width of [1280, 390]) {
    it(`shows the badges at ${width} px`, async () => {
      // Imported here: playwright-core does not load on Node.js 18, where the browser tests are skipped.
      const { devices } = await import('playwright-core');
      const ctx = await browser.newContext(width < 600
        ? { ...devices['iPhone 13'], viewport: { width, height: 900 }, locale: 'en-US' }
        : { viewport: { width, height: 900 }, locale: 'en-US' });
      await ctx.addInitScript(`try { localStorage.setItem('bash-explainer-settings', JSON.stringify({ 'bashExplainer.panel.animations': false })); } catch {}`);
      const page = await ctx.newPage();
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      const panel = await open(page);
      await frames(panel);
      const list = await badges(panel);
      assert.deepStrictEqual(list.items.map((b) => [b.text, b.by]), [['program', ''], ['program', 'run by sudo'], ['builtin', '']]);
      assert.strictEqual(list.items[1].also, 'sudo looks the name up, so this is the program, not bash\'s builtin');
      assert.strictEqual(list.items[2].also, 'Same name, also: a program, usually /usr/bin/echo (run with env echo)');
      checkGeometry(`depth 1, ${width}`, list);
      // (The panel's page takes the language of the explanation: its styles follow it, `:lang(ja)`.)
      assert.strictEqual(await panel.evaluate('document.documentElement.lang'), 'en');
      // (The badge's word is in the row's text, for a screen reader.)
      assert.match(await panel.locator('.row').filter({ hasText: 'Print arguments' }).last().textContent() ?? '', /echobuiltinPrint arguments/);

      // At depth 2 the same rows, with the same badges: each row's role line says "command name", not what it runs.
      await chooseDepth(page, 2);
      await until('the role lines', () => panel.locator('#tree .role-line').count(), (n) => n > 3);
      await frames(panel);
      const deep = await badges(panel);
      assert.deepStrictEqual(deep.items.map((b) => [b.text, b.by]), list.items.map((b) => [b.text, b.by]));
      checkGeometry(`depth 2, ${width}`, deep);
      assert.deepStrictEqual(await panel.locator('#tree .role-chip').allTextContents().then((cs) => cs.filter((c) => c.includes('·'))), []);
      assert.deepStrictEqual(errors, []);
      await ctx.close();
    });
  }

  it('keeps the badge of the reserved word at both depths, and none on a subcommand', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-US' });
    const page = await ctx.newPage();
    await page.goto(base);
    const panel = () => page.frames().find((f) => f.url().endsWith('/panel.html'))!;
    await until('the panel', () => Promise.resolve(panel()), (f) => !!f);
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText('time git commit -m x');
    await until('the line explained', async () => (await panel().locator('#line').textContent()) ?? '', (t) => t.includes('time git'));
    // (The reserved word has its row: with its badge and what else its name is, as a command's has.)
    const meaning = (await badges(panel())).items;
    assert.deepStrictEqual(meaning.map((b) => b.text), ['keyword', 'program']);
    assert.match(meaning[0].also, /usually \/usr\/bin\/time/);
    await chooseDepth(page, 2);
    await until('the role lines', () => panel().locator('#tree .role-line').count(), (n) => n > 3);
    assert.deepStrictEqual((await badges(panel())).items.map((b) => b.text), ['keyword', 'program']);
    await ctx.close();
  });
});

describe('the VS Code panel: what a command name is', function () {
  this.timeout(60000);
  let browser: Browser | undefined;
  let server: PanelServer;
  before(async function () {
    if (Number(process.versions.node.split('.')[0]) < 20) return this.skip();
    try {
      const { chromium } = await import('playwright-core');
      browser = await chromium.launch();
    } catch (e) {
      if (process.env.BASH_EXPLAINER_BROWSER) throw e;
      return this.skip();
    }
    server = await servePanel(LINE);
  });
  after(async () => {
    await browser?.close();
    await server?.close();
  });

  for (const [theme, depth, width] of [['dark', 1, 300], ['light', 2, 300], ['hc', 2, 600]] as const) {
    it(`shows the badges, ${theme}, depth ${depth}, ${width} px`, async () => {
      const page = await browser!.newPage({ viewport: { width, height: 700 } });
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
      await page.goto(server.url(theme, 'ja', depth));
      const want = [['プログラム', ''], ['プログラム', 'sudo が実行'], ['ビルトイン', '']];
      await until('the badges', () => page.locator('.nk-badge:visible').count(), (n) => n === want.length);
      await frames(page);
      const got = await badges(page);
      assert.deepStrictEqual(got.items.map((b) => [b.text, b.by]), want);
      checkGeometry(`${theme} ${depth} ${width}`, got);
      assert.deepStrictEqual(errors, []);
      await page.close();
    });
  }

  // (Dashed says "the program receives this word changed", not "a program": the program's badge has a quiet solid edge in the muted colour.)
  for (const theme of ['light', 'dark', 'hc'] as const) {
    it(`draws the badge of a program with a solid edge, not a dashed one (${theme})`, async () => {
      const page = await browser!.newPage({ viewport: { width: 600, height: 700 } });
      await page.goto(server.url(theme, 'en', 1));
      await until('the badges', () => page.locator('.nk-badge').count(), (n) => n === 3);
      const [style, edge, muted, builtin] = await page.evaluate(`(() => {
        const p = document.querySelector('.nk-program'); const s = getComputedStyle(p);
        const probe = document.createElement('span'); probe.style.color = 'var(--c-muted)'; document.body.append(probe);
        return [s.borderTopStyle, s.borderTopColor, getComputedStyle(probe).color, getComputedStyle(document.querySelector('.nk-builtin')).borderTopColor];
      })()`) as string[];
      assert.deepStrictEqual([style, edge], ['solid', muted]);
      assert.notStrictEqual(edge, builtin, 'a builtin keeps its own edge');
      await page.close();
    });
  }

  it('keeps the "run by" upright in Japanese', async () => {
    const page = await browser!.newPage({ viewport: { width: 700, height: 700 } });
    await page.goto(server.url('light', 'ja', 1));
    await until('the badges', () => page.locator('.nk-by:visible').count(), (n) => n === 1);
    assert.strictEqual(await page.evaluate("getComputedStyle(document.querySelector('.nk-by')).fontStyle"), 'normal');
    await page.close();
  });

  it('draws the badge in the system colours when colours are forced', async () => {
    const page = await browser!.newPage({ viewport: { width: 600, height: 700 }, forcedColors: 'active' });
    await page.goto(server.url('dark', 'en', 1));
    await until('the badges', () => page.locator('.nk-badge').count(), (n) => n === 3);
    const [color, edge, text] = await page.evaluate(`(() => {
      const b = document.querySelector('.nk-badge'); const s = getComputedStyle(b);
      const probe = document.createElement('span'); probe.style.color = 'CanvasText'; document.body.append(probe);
      return [s.color, s.borderTopColor, getComputedStyle(probe).color];
    })()`) as string[];
    assert.deepStrictEqual([color, edge], [text, text]);
    await page.close();
  });
});
