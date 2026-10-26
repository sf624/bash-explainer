// The web page: its opening (src/ui/opening.ts, web/theme-init.js, web/opening.ts), run for real in headless Chromium
// (test/support/site.ts). The other web tests see it as on a later load of the session: still, and gone as soon as
// the page is ready.
import * as assert from 'assert';
import type { Browser, Page } from 'playwright-core';
import { openSite, until, Site } from './support/site';

/** The overlay's state: there, whole or still, labelled, leaving. */
const state = (page: Page) =>
  page.evaluate(`(() => {
    const el = document.getElementById('opening');
    const root = document.documentElement;
    return {
      there: !!el,
      shown: !!el && getComputedStyle(el).display !== 'none',
      whole: root.classList.contains('opening-whole'),
      still: root.classList.contains('opening-still'),
      ready: !!el && el.classList.contains('ready'),
      leaving: !!el && el.classList.contains('out'),
    };
  })()`) as Promise<{ there: boolean; shown: boolean; whole: boolean; still: boolean; ready: boolean; leaving: boolean }>;
const ready = (page: Page) => page.locator('#editor .cm-line').first().waitFor();

describe('the web page: the opening', function () {
  this.timeout(120000);
  let browser: Browser;
  let firstLoad: Site['firstLoad'];
  let base = '';

  before(async function () {
    ({ browser, firstLoad, base } = await openSite(this));
  });

  it('on the first load of a session, covers the page, hidden from assistive technology and with nothing to focus, labels its line when the page is ready, then leaves', async () => {
    const ctx = await firstLoad({ locale: 'en-US' });
    const page = await ctx.newPage();
    await page.goto(base);
    const first = await state(page);
    assert.ok(first.shown && first.whole, 'whole on the first load');
    assert.strictEqual(await page.locator('#opening').getAttribute('aria-hidden'), 'true');
    assert.strictEqual(await page.locator('#opening :is(a, button, input, select, textarea, [tabindex])').count(), 0);
    // The labels are in the page's language, and the focus stays where the page puts it.
    // (Their blanks are no-break spaces.)
    const texts = async (css: string) => (await page.locator(css).allInnerTexts()).map((t) => t.replace(/\u00a0/g, ' '));
    assert.deepStrictEqual(await texts('#opening .opening-line .chip .l-en'), ['Sort lines', 'output only unique lines', 'target file', 'Pipe', 'Count lines, words and bytes', 'count lines']);
    assert.deepStrictEqual(await page.locator('#opening .l-ja').evaluateAll((els) => els.map((e) => e.ownerDocument.defaultView!.getComputedStyle(e).display)), new Array(12).fill('none'));
    await until('the labels', async () => (await state(page)).ready, (v) => v);
    assert.strictEqual(await page.evaluate("document.activeElement && document.activeElement.closest('#opening')"), null);
    await until('the opening to leave', async () => (await state(page)).there, (v) => !v);
    // A later load of the session shows it still.
    await page.reload();
    assert.ok((await state(page)).still || !(await state(page)).there);
    await ctx.close();
  });

  it('shows its labels in Japanese on a Japanese page', async () => {
    const ctx = await firstLoad({ locale: 'ja-JP' });
    const page = await ctx.newPage();
    await page.goto(base);
    assert.deepStrictEqual(await page.locator('#opening .opening-line .chip .l-ja').allInnerTexts(), ['行を並べ替える', '重複行を1つにまとめる', '対象のファイル', 'パイプ', '行数・単語数・バイト数を数える', '行数を数える']);
    await ctx.close();
  });

  it('ends at a key or a click once the page is ready, before its labels have stayed', async () => {
    for (const end of ['key', 'click'] as const) {
      const ctx = await firstLoad();
      const page = await ctx.newPage();
      await page.goto(base);
      await ready(page);
      assert.ok((await state(page)).there, 'still there when the page is ready');
      if (end === 'key') await page.keyboard.press('Shift');
      else await page.mouse.click(700, 400);
      await until(`the opening to leave at a ${end}`, async () => (await state(page)).there, (v) => !v, 1000);
      await ctx.close();
    }
  });

  it('with reduced motion, is a still picture that leaves as soon as the page is ready', async () => {
    const ctx = await firstLoad({ reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.goto(base, { waitUntil: 'commit' });
    await page.waitForSelector('html.opening-on');
    assert.ok((await state(page)).still);
    await ready(page);
    assert.strictEqual((await state(page)).there, false, 'gone when the editor is there');
    await ctx.close();
  });

  it('is still on a link to a script', async () => {
    const ctx = await firstLoad();
    const page = await ctx.newPage();
    await page.goto(`${base}#z=AAAA`, { waitUntil: 'commit' });
    await page.waitForSelector('html.opening-on');
    assert.ok((await state(page)).still);
    await ctx.close();
  });

  it('is not shown in the panel view, in the explanation frame or on the compare page', async () => {
    const ctx = await firstLoad();
    const page = await ctx.newPage();
    await page.goto(`${base}?view=panel`);
    await page.waitForLoadState('load');
    assert.deepStrictEqual(await state(page), { there: true, shown: false, whole: false, still: false, ready: false, leaving: false });
    await page.goto(base);
    await ready(page);
    const frame = page.frameLocator('#panel').locator('html');
    assert.strictEqual(await frame.evaluate((e) => e.classList.contains('opening-on')), false);
    await page.goto(`${base}compare.html`);
    await page.waitForLoadState('load');
    assert.strictEqual(await page.evaluate("document.documentElement.classList.contains('opening-on')"), false);
    await ctx.close();
  });

  it('is seen by the other tests as on a later load', async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(base, { waitUntil: 'commit' });
    await page.waitForSelector('html.opening-on');
    assert.ok((await state(page)).still);
    await ctx.close();
  });
});
