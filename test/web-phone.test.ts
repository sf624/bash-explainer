// The web page: touch screens, stored data and the window, run for real in headless Chromium (the build, the server and the browser
// are shared by all test/web-*.test.ts files: test/support/site.ts). Skipped when no browser can start,
// unless $BASH_EXPLAINER_BROWSER is set (as in CI).
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { isDeepStrictEqual } from 'util';
import type { Browser } from 'playwright-core';
import { openSite, choose, currentShell, openSettingsSection, problemsShown, setShell, root, stable, until } from './support/site';

describe('the web page: touch screens, stored data and the window', function () {
  this.timeout(120000);
  let browser: Browser;
  let base = '';

  before(async function () {
    ({ browser, base } = await openSite(this));
  });

  it('does not move the focus to the quick reference\'s search field on a touch screen (no on-screen keyboard), and does with a mouse', async () => {
    const { devices } = await import('playwright-core');
    for (const touch of [true, false]) {
      const ctx = await browser.newContext(touch ? { ...devices['iPhone 13'], viewport: { width: 390, height: 740 }, locale: 'en-US' } : { viewport: { width: 1280, height: 800 }, locale: 'en-US' });
      const page = await ctx.newPage();
      await page.goto(base);
      await page.locator('.cm-line').nth(5).waitFor();
      const panel = () => page.frames().find((f) => f.url().endsWith('/panel.html'))!;
      if (touch) await page.locator('#tab-ref').tap();
      else await page.locator('#tab-ref').click();
      await until('the reference', () => panel().locator('#reference').isVisible(), (v) => v);
      const focused = () => panel().evaluate('document.activeElement && document.activeElement.id');
      if (touch) {
        // (The search field would be focused by now, if it were going to be.)
        assert.notStrictEqual(await stable('the focus', async () => String(await focused())), 'ref-search');
        assert.strictEqual(await page.evaluate('document.activeElement.id'), 'tab-ref');
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
    const ctx = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 360, height: 740 }, locale: 'en-US' });
    const page = await ctx.newPage();
    await page.goto(base);
    await page.locator('.cm-line').first().waitFor();
    const stored = () => page.evaluate('Object.keys(localStorage).sort()') as Promise<string[]>;
    // The tip shows the first time; closing it, the theme, the shell and read mode are kept.
    await until('the tip', () => page.locator('#readtip').isVisible(), (v) => v);
    await page.locator('#readtip-close').tap();
    await page.locator('#readmode').tap();
    await choose(page, '#theme', 'dark');
    await setShell(page, 'dash');
    await until('the keys', stored, (k) => k.includes('bash-explainer-settings') && k.includes('bash-explainer-theme') && k.includes('bash-explainer-read-mode') && k.includes('bash-explainer-read-tip-seen'));
    assert.strictEqual(await page.locator('#readtip').isVisible(), false);

    await page.locator('#settings-open').tap();
    await page.locator('#settings-jump-data').tap();
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
    assert.strictEqual(await currentShell(page), 'auto');
    assert.strictEqual(await page.locator('#theme').inputValue(), 'auto');
    assert.strictEqual(await page.evaluate('document.documentElement.getAttribute("data-theme")'), null);
    assert.strictEqual(await page.locator('#readmode').getAttribute('aria-pressed'), 'false');
    assert.strictEqual(await page.locator('.cm-content').getAttribute('inputmode'), null);
    await page.locator('#settings-done').tap();
    await until('the tip again', () => page.locator('#readtip').isVisible(), (v) => v);
    await ctx.close();

    // The Japanese words, and no storage at all: nothing throws, the page still goes back to its defaults.
    const bare = await browser.newContext({ viewport: { width: 1280, height: 720 }, locale: 'ja-JP' });
    await bare.addInitScript('Object.defineProperty(window, "localStorage", { get() { throw new Error("no storage"); } })');
    const p2 = await bare.newPage();
    const errors: string[] = [];
    p2.on('pageerror', (e) => errors.push(e.message));
    await p2.goto(base);
    await p2.locator('.cm-line').first().waitFor();
    await openSettingsSection(p2, 'data');
    assert.strictEqual(await p2.locator('#settings-clear').textContent(), '保存したデータを消去');
    await p2.locator('#settings-clear').click();
    await p2.locator('#settings-clear-yes').click();
    assert.match(await p2.locator('#settings-clear-status').innerText(), /消去しました/);
    assert.deepStrictEqual(errors, []);
    await bare.close();
  });

  it('read mode: on a phone a tap places the cursor without the keyboard, the choice is kept, and the top bar stays one row at 360px', async () => {
    const { devices } = await import('playwright-core');
    const ctx = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 360, height: 740 }, locale: 'en-US' });
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
    const desk = await browser.newContext({ viewport: { width: 1200, height: 800 } });
    await desk.addInitScript('Object.defineProperty(window, "localStorage", { get() { throw new Error("no storage"); } })');
    const d = await desk.newPage();
    await d.goto(base);
    await d.locator('.cm-line').first().waitFor();
    assert.strictEqual(await d.locator('#readmode').isVisible(), false);
    await d.evaluate('document.getElementById("readmode").click()');
    assert.strictEqual(await d.locator('.cm-content').getAttribute('inputmode'), 'none');
    await desk.close();
  });

  it('has the view control in the panel\'s header on a phone, as a 44px pill and its menu, and remembers the view', async () => {
    const { devices } = await import('playwright-core');
    for (const width of [320, 390, 430]) {
      const ctx = await browser.newContext({ ...devices['iPhone 13'], viewport: { width, height: 740 }, locale: width === 390 ? 'ja-JP' : 'en-US' });
      const page = await ctx.newPage();
      await page.goto(base);
      await page.locator('.cm-line').nth(5).waitFor();
      const panel = () => page.frames().find((f) => f.url().endsWith('/panel.html'))!;
      // The bar: one row, every button 40px or more, nothing hanging out; the view control is not in it.
      const bar = await page.evaluate(`(() => {
        const t = document.querySelector('.top');
        const sizes = [...t.querySelectorAll('button, a')].filter((e) => e.getBoundingClientRect().width > 0).map((e) => Math.min(e.getBoundingClientRect().width, e.getBoundingClientRect().height));
        return [t.getBoundingClientRect().height, t.scrollWidth <= t.clientWidth, document.documentElement.scrollWidth <= document.documentElement.clientWidth, Math.min(...sizes.filter((s) => s > 30))];
      })()`) as [number, boolean, boolean, number];
      assert.ok(bar[0] <= 49 && bar[1] && bar[2] && bar[3] >= 40, `${width}px: ${bar}`);
      assert.strictEqual(await page.locator('.top .vc').count(), 0, `${width}px`);
      // In the panel's header: the segments where they fit, else the pill that opens them; each 44px high, inside the window.
      const open = page.locator('#slot-open');
      if (await open.isVisible()) {
        // (Once the page has settled: the explanation's first drawing moves the panes.)
        const pill = JSON.parse(await stable('the pill', async () => JSON.stringify(await open.boundingBox()))) as { x: number; width: number; height: number };
        assert.ok(pill.height >= 44 && pill.x >= 0 && pill.x + pill.width <= width, `${width}px: ${JSON.stringify(pill)}`);
        await open.tap();
      }
      const options = await Promise.all(['#slot-list', '#slot-tree'].map(async (id) => (await page.locator(id).boundingBox())!));
      for (const b of options) assert.ok(b.width >= 44 && b.height >= 44 && b.x >= 0 && b.x + b.width <= width, `${width}px: ${JSON.stringify(b)}`);
      assert.strictEqual(await page.locator('#slot-list').getAttribute('aria-pressed'), 'true');
      await page.locator('#slot-tree').tap();
      assert.strictEqual(await page.locator('#slot-tree').getAttribute('aria-pressed'), 'true');
      await until('the tree', () => panel().locator('#reading').isVisible(), (v) => v);
      await page.reload();
      await page.locator('.cm-line').first().waitFor();
      assert.strictEqual(await page.locator('#slot-tree').getAttribute('aria-pressed'), 'true', 'remembered');
      await until('the tree after a reload', () => panel()?.locator('#reading').isVisible() ?? Promise.resolve(false), (v) => v);
      await ctx.close();
    }
  });

  it('read-mode tip: shown once on a phone, closed by the button or by using the switch, never on a desktop', async () => {
    const { devices } = await import('playwright-core');
    const phone = { ...devices['iPhone 13'], viewport: { width: 360, height: 740 }, locale: 'en-US' };
    const ctx = await browser.newContext(phone);
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
    const ctx2 = await browser.newContext(phone);
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
    const ctx3 = await browser.newContext({ ...phone, locale: 'ja-JP' });
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
    const desk = await browser.newContext({ viewport: { width: 1200, height: 800 } });
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
      const ctx = await browser.newContext(size);
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
      // (The explanation's pane: its header, then the panel's frame, down to the bottom.)
      const ed = (await page.locator('.source').boundingBox())!;
      const bar = (await page.locator('.top').boundingBox())!;
      const pane = (await page.locator('#panel-pane').boundingBox())!;
      assert.ok(bar.height <= 49, String(bar.height));
      assert.ok(Math.round(box.y + box.height) === height && box.y > pane.y, JSON.stringify([pane, box]));
      if (width < 768) assert.ok(ed.width === width && pane.width === width && pane.y > ed.y + ed.height && Math.round(pane.y + pane.height) === height, JSON.stringify([ed, pane]));
      else assert.ok(pane.x > ed.x + ed.width && Math.round(ed.height) === height - bar.height && Math.round(pane.height) === height - bar.height, JSON.stringify([ed, pane]));
      await ctx.close();
    }
  });

  it('keeps the phone layout on a phone at every zoom (a wider viewport in CSS pixels), and follows the width on a desktop and a tablet', async () => {
    const { devices } = await import('playwright-core');
    /** What tells the phone layout: the bar's Copy a link hidden, the panes one above the other, and the Problems list folded. */
    const layout = async (page: import('playwright-core').Page) => {
      await page.locator('.cm-line').first().waitFor();
      await until('the sample\'s problems', () => problemsShown(page), (v) => v);
      return async () => {
        const ed = (await page.locator('#editor').boundingBox())!;
        const box = (await page.locator('#panel').boundingBox())!;
        return {
          share: await page.locator('#share').isVisible(),
          stacked: box.y >= ed.y + ed.height,
          splitter: await page.locator('#splitter').getAttribute('aria-orientation'),
          problems: await page.locator('#problems-toggle').getAttribute('aria-expanded'),
        };
      };
    };
    /** Waits for the layout expected, then checks that it stays. */
    const expectLayout = async (page: import('playwright-core').Page, expected: object, label: string) => {
      const read = await layout(page);
      await until(label, read, (v) => isDeepStrictEqual(v, expected)).catch(() => undefined);
      assert.deepStrictEqual(await stable(label, read, 6), expected, label);
    };
    const phoneLayout = { share: false, stacked: true, splitter: 'horizontal', problems: 'false' };
    const wideLayout = { share: true, stacked: false, splitter: 'vertical', problems: 'true' };

    // A 390×844 phone, zoomed out to 50% and 33%: the CSS viewport grows and a device pixel is less of a CSS
    // pixel. At 780 the screen stays as at 100%, as Safari reports it; at 1170 it is in CSS pixels of the zoom, as in Chrome.
    // (Playwright's setViewportSize would make the screen the viewport's size, which no zoom does.)
    const phone = { ...devices['iPhone 13'], viewport: { width: 390, height: 740 }, screen: { width: 390, height: 844 }, deviceScaleFactor: 3, locale: 'en-US' };
    const ctx = await browser.newContext(phone);
    const page = await ctx.newPage();
    await page.goto(base);
    await expectLayout(page, phoneLayout, '390');
    const cdp = await ctx.newCDPSession(page);
    for (const [width, screenScales] of [[780, false], [1170, true]] as const) {
      const z = width / 390;
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width, height: Math.round(740 * z), deviceScaleFactor: 3 / z, mobile: true,
        screenWidth: screenScales ? width : 390, screenHeight: screenScales ? Math.round(844 * z) : 844,
      });
      await until('the zoom', () => page.evaluate('innerWidth') as Promise<number>, (w) => w === width);
      await expectLayout(page, phoneLayout, `zoomed to ${width}`);
      // A page loaded zoomed out: on a phone seen before, the shape of its screen, which no zoom changes, is remembered.
      await page.reload();
      await expectLayout(page, phoneLayout, `loaded at ${width}`);
    }
    await ctx.close();
    // A tablet as big as that zoomed-out phone, never seen as a phone, follows the width as before.
    const tablet = await browser.newContext({ ...phone, viewport: { width: 780, height: 1480 }, screen: { width: 780, height: 1688 }, deviceScaleFactor: 1.5 });
    const t = await tablet.newPage();
    await t.goto(base);
    await expectLayout(t, wideLayout, 'tablet 780');
    await t.setViewportSize({ width: 700, height: 1480 });
    await expectLayout(t, phoneLayout, 'tablet window 700');
    await tablet.close();

    // A desktop: wide, the phone layout when the window is made narrow, and wide again.
    const desk = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-US' });
    const d = await desk.newPage();
    await d.goto(base);
    await expectLayout(d, wideLayout, 'desktop 1280');
    await d.setViewportSize({ width: 390, height: 800 });
    await expectLayout(d, phoneLayout, 'desktop 390');
    await d.setViewportSize({ width: 1280, height: 800 });
    await expectLayout(d, wideLayout, 'desktop 1280 again');
    await desk.close();
  });

  it('shows the desktop layout on a phone whose browser asks for the desktop site, and the phone layout again in the normal mode, also after a reload', async () => {
    const { devices } = await import('playwright-core');
    const phoneLayout = { share: false, stacked: true, splitter: 'horizontal', problems: 'false' };
    const wideLayout = { share: true, stacked: false, splitter: 'vertical', problems: 'true' };
    const read = async (page: import('playwright-core').Page) => {
      await page.locator('.cm-line').first().waitFor();
      await until('the sample\'s problems', () => problemsShown(page), (v) => v);
      return async () => {
        const ed = (await page.locator('#editor').boundingBox())!;
        const box = (await page.locator('#panel').boundingBox())!;
        return {
          share: await page.locator('#share').isVisible(),
          stacked: box.y >= ed.y + ed.height,
          splitter: await page.locator('#splitter').getAttribute('aria-orientation'),
          problems: await page.locator('#problems-toggle').getAttribute('aria-expanded'),
        };
      };
    };
    const expectLayout = async (page: import('playwright-core').Page, expected: object, label: string) => {
      const layout = await read(page);
      await until(label, layout, (v) => isDeepStrictEqual(v, expected)).catch(() => undefined);
      assert.deepStrictEqual(await stable(label, layout, 6), expected, label);
    };
    const mobileUA = devices['iPhone 13'].userAgent;
    const desktopUA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
    const macUA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
    const meta = (mobile: boolean) => ({ platform: mobile ? 'iOS' : 'Linux', platformVersion: '15.0', architecture: '', model: '', mobile });

    const phone = { ...devices['iPhone 13'], viewport: { width: 390, height: 740 }, screen: { width: 390, height: 844 }, deviceScaleFactor: 3, locale: 'en-US' };
    const ctx = await browser.newContext(phone);
    const page = await ctx.newPage();
    await page.goto(base);
    await expectLayout(page, phoneLayout, 'the phone');
    assert.ok((await page.evaluate("localStorage.getItem('bash-explainer-phone-screens')")) !== null, 'the phone\'s screen is remembered');
    const cdp = await ctx.newCDPSession(page);
    /** The browser's mode, as a phone's browser sends it: the User-Agent (and its client hints, when `hints` is set) and the viewport (980px wide in the desktop-site mode). */
    const mode = async (ua: string, hints: boolean | undefined, width: number, screenScales: boolean) => {
      await cdp.send('Emulation.setUserAgentOverride', { userAgent: ua, ...(hints === undefined ? {} : { userAgentMetadata: meta(hints) }) });
      const z = width / 390;
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width, height: Math.round(740 * z), deviceScaleFactor: 3 / z, mobile: true,
        screenWidth: screenScales ? width : 390, screenHeight: screenScales ? Math.round(844 * z) : 844,
      });
      await until('the viewport', () => page.evaluate('innerWidth') as Promise<number>, (w) => w === width);
      await page.reload();
    };

    // Chrome's "Desktop site": a desktop User-Agent, `userAgentData.mobile` false, a viewport of about 980px; the screen as the phone's
    // or in CSS pixels of the viewport. The remembered phone screen does not make it a phone.
    for (const screenScales of [false, true]) {
      await mode(desktopUA, false, 980, screenScales);
      assert.strictEqual(await page.evaluate('navigator.userAgentData.mobile'), false);
      await expectLayout(page, wideLayout, `desktop site (screen scales: ${screenScales})`);
      assert.strictEqual(await page.evaluate('document.documentElement.classList.contains("phone")'), false);
      // The normal mode again, zoomed out (the page is reloaded by the browser): the phone layout.
      await mode(mobileUA, true, 780, screenScales);
      assert.strictEqual(await page.evaluate('navigator.userAgentData.mobile'), true);
      await expectLayout(page, phoneLayout, `normal mode zoomed out (screen scales: ${screenScales})`);
    }
    // Even in the desktop-site mode, the window's width still decides: zoomed in to 600px it is narrow.
    await mode(desktopUA, false, 600, false);
    await expectLayout(page, phoneLayout, 'desktop site zoomed in');
    await mode(mobileUA, undefined, 390, false);
    await expectLayout(page, phoneLayout, 'normal mode');
    await ctx.close();

    // A phone's first visit in the desktop-site mode records nothing.
    const fresh = await browser.newContext(phone);
    const f = await fresh.newPage();
    const fcdp = await fresh.newCDPSession(f);
    await fcdp.send('Emulation.setUserAgentOverride', { userAgent: desktopUA, userAgentMetadata: meta(false) });
    await fcdp.send('Emulation.setDeviceMetricsOverride', { width: 980, height: 1865, deviceScaleFactor: 3 * 390 / 980, mobile: true, screenWidth: 390, screenHeight: 844 });
    await f.goto(base);
    await expectLayout(f, wideLayout, 'first visit in the desktop-site mode');
    assert.strictEqual(await f.evaluate("localStorage.getItem('bash-explainer-phone-screens')"), null);
    await fresh.close();

    // Safari's "Request Desktop Website": the Macintosh User-Agent and no client hints (hidden here, as Chromium always has them
    // on a secure origin): the User-Agent decides. The iPhone's own one, without hints, keeps the phone layout.
    for (const [ua, expected] of [[macUA, wideLayout], [mobileUA, phoneLayout]] as const) {
      const safari = await browser.newContext({ ...phone, userAgent: ua });
      await safari.addInitScript("Object.defineProperty(Navigator.prototype, 'userAgentData', { value: undefined })");
      const s = await safari.newPage();
      const scdp = await safari.newCDPSession(s);
      const wide = ua === macUA;
      await scdp.send('Emulation.setDeviceMetricsOverride', {
        width: wide ? 980 : 390, height: wide ? 1865 : 740, deviceScaleFactor: wide ? 3 * 390 / 980 : 3, mobile: true, screenWidth: 390, screenHeight: 844,
      });
      await s.goto(base);
      assert.strictEqual(await s.evaluate('navigator.userAgentData'), undefined);
      await expectLayout(s, expected, wide ? 'desktop website (Macintosh User-Agent)' : 'iPhone User-Agent');
      await safari.close();
    }
  });
});
