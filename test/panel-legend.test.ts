// The Legend of the VS Code panel (src/ui/panelView.ts PANEL_BODY, media/panel.js `drawKey`, media/panel.css `#key`) is a
// popover (docs/design/usability-9.md, 2.4): it opens under its button over the explanation and never pushes it down,
// it stays inside the window and under the sticky header, Escape closes it and the focus goes back to its button, so
// does a click outside it, the focus leaving the panel and a new line; with nothing to key there is no button. In
// headless Chromium with the theme variables of VS Code's own themes (test/support/panel-page.ts). Skipped when no
// browser can start, unless $BASH_EXPLAINER_BROWSER is set.
import * as assert from 'assert';
import type { Browser, Page } from 'playwright-core';
import { PanelServer, PanelTheme, servePanel } from './support/panel-page';
import { until } from './support/site';

describe('the VS Code panel: its Legend', function () {
  this.timeout(60000);
  let browser: Browser | undefined;
  let panel: PanelServer;

  before(async function () {
    if (Number(process.versions.node.split('.')[0]) < 20) return this.skip();
    try {
      const { chromium } = await import('playwright-core');
      browser = await chromium.launch();
    } catch (e) {
      if (process.env.BASH_EXPLAINER_BROWSER) throw e;
      return this.skip();
    }
    panel = await servePanel();
  });

  after(async () => {
    await browser?.close();
    await panel?.close();
  });

  async function open(theme: PanelTheme, width: number, lang: 'en' | 'ja', height = 420): Promise<Page> {
    const page = await browser!.newPage({ viewport: { width, height } });
    await page.goto(panel.url(theme, lang));
    await until('the line', () => page.locator('#where').textContent(), (t) => !!t);
    await until('the Legend button', () => page.locator('#key-open').isVisible(), (v) => v);
    return page;
  }

  const shown = (page: Page) => page.locator('#key').isVisible();
  const state = (page: Page) => page.locator('#key-open').getAttribute('aria-expanded');
  /** Posts the sample's update message again with changes (as the host does for another line, or a line with nothing to key). */
  const post = (page: Page, change: string) => page.evaluate(`window.postMessage({ ...window.MSGS[document.documentElement.lang], ${change} }, '*')`);

  for (const [theme, width, lang] of [['dark', 600, 'en'], ['light', 320, 'ja'], ['dark', 320, 'en'], ['light', 900, 'ja']] as const) {
    it(`opens over the explanation, inside the window, under the header (${theme}, ${width} px, ${lang})`, async () => {
      const page = await open(theme, width, lang);
      const treeTop = () => page.evaluate("document.getElementById('tree').getBoundingClientRect().top") as Promise<number>;
      const before = await treeTop();
      await page.locator('#key-open').click();
      assert.strictEqual(await shown(page), true);
      assert.strictEqual(await state(page), 'true');
      assert.ok(await page.locator('#key li').count() > 0);
      // The tree stays where it was: the box floats over it.
      assert.strictEqual(await treeTop(), before);
      assert.strictEqual(await page.evaluate("getComputedStyle(document.getElementById('key')).position"), 'absolute');
      const r = await page.evaluate(`(() => {
        const b = (id) => { const r = document.getElementById(id).getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; };
        return { key: b('key'), button: b('key-open'), top: b('top'), width: innerWidth, height: innerHeight, scrollW: document.documentElement.scrollWidth };
      })()`) as Record<string, { top: number; bottom: number; left: number; right: number }> & { width: number; height: number; scrollW: number };
      // Inside the window, below the header and the button (nothing of them is covered), and no sideways scroll.
      assert.ok(r.key.left >= 0 && r.key.right <= r.width, JSON.stringify(r.key));
      assert.ok(r.key.bottom <= r.height, `bottom ${r.key.bottom} of ${r.height}`);
      assert.ok(r.key.top >= r.button.bottom - 0.5 && r.key.top >= r.top.bottom - 0.5, JSON.stringify(r));
      assert.ok(r.scrollW <= r.width, `scroll width ${r.scrollW}`);
      // The box is opaque: nothing of the rows shows through, and it is the topmost thing at its middle.
      assert.strictEqual(await page.evaluate("(() => { const k = document.getElementById('key').getBoundingClientRect(); return document.elementFromPoint(k.left + k.width / 2, k.top + Math.min(20, k.height / 2)).closest('#key') !== null; })()"), true);
      await page.close();
    });
  }

  it('closes on Escape and gives the focus back to its button, in any theme', async () => {
    for (const theme of ['dark', 'light', 'hc'] as const) {
      const page = await open(theme, 600, 'en');
      await page.locator('#key-open').click();
      assert.strictEqual(await shown(page), true);
      // The focus is elsewhere in the panel (the switch): Escape closes the Legend all the same.
      await page.evaluate("document.getElementById('receives').focus()");
      await page.keyboard.press('Escape');
      assert.strictEqual(await shown(page), false, theme);
      assert.strictEqual(await state(page), 'false');
      assert.strictEqual(await page.evaluate('document.activeElement.id'), 'key-open');
      // Escape with it closed does nothing to the focus.
      await page.evaluate("document.getElementById('receives').focus()");
      await page.keyboard.press('Escape');
      assert.strictEqual(await page.evaluate('document.activeElement.id'), 'receives');
      await page.close();
    }
  });

  it('closes on a click outside it, on a new line and when the focus leaves the panel; a click on the button toggles it', async () => {
    const page = await open('dark', 600, 'en');
    const button = page.locator('#key-open');
    await button.click();
    assert.strictEqual(await shown(page), true);
    // A click inside the box keeps it.
    await page.locator('#key li').first().click();
    assert.strictEqual(await shown(page), true);
    await button.click();
    assert.strictEqual(await shown(page), false);
    // A click outside: on the explanation, and on the line box.
    for (const outside of ['#where', '#line', 'the margin']) {
      await button.click();
      assert.strictEqual(await shown(page), true);
      if (outside === 'the margin') await page.mouse.click(3, 200);
      else await page.locator(outside).first().click({ position: { x: 3, y: 3 } });
      assert.strictEqual(await shown(page), false, outside);
    }
    // Another line.
    await button.click();
    await post(page, "file: 'other.sh'");
    await until('the new line', () => page.locator('#where').textContent(), (t) => !!t && t.includes('other.sh'));
    assert.strictEqual(await shown(page), false);
    assert.strictEqual(await state(page), 'false');
    // The same line again (another depth, a re-draw) keeps it open.
    await button.click();
    await post(page, "file: 'other.sh'");
    await page.waitForTimeout(200);
    assert.strictEqual(await shown(page), true);
    // The focus leaves the panel (a click in the editor).
    await page.evaluate("window.dispatchEvent(new Event('blur'))");
    assert.strictEqual(await shown(page), false);
    await page.close();
  });

  it('has no button when there is nothing to key, and no empty box', async () => {
    const page = await open('dark', 600, 'en');
    await page.locator('#key-open').click();
    assert.strictEqual(await shown(page), true);
    await post(page, 'key: []');
    await until('no button', () => page.locator('#key-open').isVisible(), (v) => !v);
    assert.strictEqual(await shown(page), false);
    // The next line with entries brings the button back, closed.
    await post(page, "file: 'next.sh'");
    await until('the button', () => page.locator('#key-open').isVisible(), (v) => v);
    assert.strictEqual(await shown(page), false);
    await page.close();
  });

  it('keeps inside the window when the button is low in a short window', async () => {
    const page = await open('dark', 600, 'en', 300);
    // Scrolled so that the button is near the bottom of the window.
    await page.evaluate("document.getElementById('key-open').scrollIntoView({ block: 'end' })");
    await page.locator('#key-open').click();
    const r = await page.evaluate(`(() => { const k = document.getElementById('key').getBoundingClientRect(); const t = document.getElementById('top').getBoundingClientRect(); return { top: k.top, bottom: k.bottom, height: innerHeight, header: t.bottom }; })()`) as { top: number; bottom: number; height: number; header: number };
    assert.ok(r.bottom <= r.height + 0.5, JSON.stringify(r));
    assert.ok(r.top >= r.header - 0.5, JSON.stringify(r));
    await page.close();
  });
});
