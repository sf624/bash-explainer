// The web page: the menu and the settings sheet, run for real in headless Chromium (the build, the server and the browser
// are shared by all test/web-*.test.ts files: test/support/site.ts). Skipped when no browser can start,
// unless $BASH_EXPLAINER_BROWSER is set (as in CI).
import * as assert from 'assert';
import type { Browser } from 'playwright-core';
import { openSite, stable, until } from './support/site';

describe('the web page: the menu and the settings sheet', function () {
  this.timeout(120000);
  let browser: Browser;
  let base = '';

  before(async function () {
    ({ browser, base } = await openSite(this));
  });

  it('has a menu that opens from the left with its button (at the left end of the top bar) or a swipe from the left edge, closes with Esc, × or a swipe, and holds what the toolbar and the footer had, in groups', async () => {
    const { devices } = await import('playwright-core');
    const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'en-US' });
    const page = await ctx.newPage();
    await page.goto(base);
    await page.locator('.cm-line').first().waitFor();
    const open = () => page.locator('#drawer').evaluate((d) => (d as unknown as { open: boolean }).open);
    // On a phone the top bar has the menu, the logo and name and the settings; the link and the rest are in the menu,
    // Read | Edit, the file type and the shell in the strip above the editor. The explanation's tabs and view are in the
    // sheet's row, which has no room for Collapse and Copy: Copy as Markdown is in the menu.
    const shown = async (ids: string[]) => Promise.all(ids.map(async (id) => [id, await page.locator(id).isVisible()]));
    assert.deepStrictEqual(await shown(['#scope-chip', '#read-edit', '.brand', '#collapse', '#tab-ref', '#copy-md', '#share', '#settings-open', '#menu-open', '#ed-more', '#github', '#install']),
      [['#scope-chip', true], ['#read-edit', true], ['.brand', true], ['#collapse', false], ['#tab-ref', true], ['#copy-md', false], ['#share', false], ['#settings-open', true], ['#menu-open', true], ['#ed-more', true], ['#github', false], ['#install', false]]);
    assert.strictEqual(await page.locator('.top :is(#collapse, #tab-ref, #copy-md)').count(), 0);
    assert.strictEqual(await page.locator('#menu-open').getAttribute('aria-label'), 'Menu');
    assert.strictEqual(await page.locator('#menu-share').innerText(), 'Copy a link to this script');
    await page.locator('#menu-open').tap();
    assert.strictEqual(await open(), true);
    // The focus stays in the menu.
    assert.strictEqual(await page.evaluate("!!document.activeElement.closest('#drawer')"), true);
    // The menu has no Settings entry (the gear is in the top bar), and sits along the left edge.
    assert.strictEqual(await page.locator('#menu-settings').count(), 0);
    const sheet = await until('the sheet in place', async () => (await page.locator('#drawer').boundingBox())!, (b) => Math.abs(b.x) < 0.5);
    assert.ok(sheet.width < 390, JSON.stringify(sheet));
    for (const id of ['#menu-scope', '#lang', '#theme', '#menu-sample', '#menu-share', '#menu-install', '#privacy', '#version', '#notices', '#drawer a[href="LICENSE.txt"]', '#drawer a[href="https://github.com/sf624/bash-explainer"]']) {
      assert.strictEqual(await page.locator(id).isVisible(), true, id);
    }
    // The release page has no version switch and no link to the development version.
    assert.strictEqual(await page.locator('#channel, #channel-label, #dev-link').count(), 0);
    // The menu has no copy of the explanation's controls.
    assert.strictEqual(await page.locator('#drawer :is(#menu-copy, #views-menu)').count(), 0);
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
    // The sample's pitfalls fill the Problems list, so the editor is short: the read-mode tip would cover it.
    await page.locator('#readtip-close').tap();
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
    assert.strictEqual(await page.evaluate('location.hash'), '');
    // ...and says so on the item itself, the menu staying open (test/web-editor-head.test.ts has the details).
    await until('Copied', () => page.locator('#menu-share').innerText(), (t) => t === 'Copied');
    await ctx.close();
  });

  it('opens the settings with a swipe from the right edge on a phone, closes them with a swipe back, and never opens both sheets', async () => {
    const { devices } = await import('playwright-core');
    const ctx = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 360, height: 740 }, locale: 'en-US' });
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
    // The menu comes from the left; the settings from the right on a phone, where they fill the screen, and from the
    // left side by side, over the editor.
    for (const [name, dialog, opener, closer, signs] of [['menu', '#drawer', '#menu-open', '#menu-close', { phone: -1, wide: -1 }], ['settings', '#settings-dialog', '#settings-open', '#settings-dialog .settings-x', { phone: 1, wide: -1 }]] as const) {
      const start = async (options: Parameters<Browser['newContext']>[0]) => {
        const ctx = await browser.newContext(options);
        const page = await ctx.newPage();
        await page.goto(base);
        await page.locator('.cm-line').first().waitFor();
        const isOpen = () => page.locator(dialog).evaluate((d) => (d as unknown as { open: boolean }).open);
        await page.locator(opener).click();
        await until(`${name} open`, isOpen, (v) => v);
        // It has slid in.
        await stable(`${name} slid in`, () => page.locator(dialog).evaluate((d) => d.getBoundingClientRect().x));
        return { ctx, page, isOpen };
      };
      for (const [screen, env, how] of ['x', 'escape', 'backdrop'].flatMap((h) => [['phone', phone, h], ['wide', wide, h]]) as ['phone' | 'wide', Parameters<Browser['newContext']>[0], 'x' | 'escape' | 'backdrop'][]) {
        // The settings fill the screen of a phone: no backdrop to tap. Side by side they are not modal: no backdrop, and a
        // click beside them is a click on the page.
        if (how === 'backdrop' && name === 'settings') continue;
        const backdrop = !(name === 'settings' && screen === 'wide');
        const { ctx, page, isOpen } = await start(env);
        const sign = signs[screen];
        const home = await page.locator(dialog).evaluate((d) => d.getBoundingClientRect().x);
        // Watch the sheet from inside the page: its position frame by frame, and the transitions it runs (with the
        // keyframes they go through), as they happen. The frames a loaded machine draws can be few and
        // late (a CI run saw the sheet at its place, then already 324 px out), so what shows that it slides, rather
        // than vanishes, is the transitions, not the frames caught in the middle.
        await page.evaluate(`(() => {
          const d = document.querySelector(${JSON.stringify(dialog)});
          const t0 = performance.now();
          const at = () => ({ t: Math.round(performance.now() - t0), x: d.getBoundingClientRect().x, open: d.open, closing: d.classList.contains('closing') });
          window.__frames = [];
          window.__events = [];
          const tick = () => {
            window.__frames.push(at());
            if (d.open) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
          new MutationObserver(() => window.__events.push({ type: d.classList.contains('closing') ? 'closing' : 'not closing', ...at() })).observe(d, { attributeFilter: ['class'] });
          for (const type of ['transitionrun', 'transitionend', 'transitioncancel']) d.addEventListener(type, (e) => {
            if (e.target !== d) return;
            const a = type === 'transitionrun' && d.getAnimations({ subtree: true }).find((a) => a.transitionProperty === e.propertyName && (a.effect.pseudoElement ?? '') === e.pseudoElement);
            window.__events.push({ type, property: e.pseudoElement + e.propertyName, ...at(), ...(a ? { keyframes: a.effect.getKeyframes().map((k) => k[e.propertyName]), ms: a.effect.getTiming().duration } : {}) });
          });
        })()`);
        const width = await page.locator(dialog).evaluate((d) => d.getBoundingClientRect().width);
        if (how === 'x') await page.locator(closer).click();
        else if (how === 'escape') await page.keyboard.press('Escape');
        else await page.mouse.click(screen === 'wide' ? (sign > 0 ? 100 : 1200) : sign > 0 ? 5 : 385, 400);
        await until(`${name} ${how} closed`, isOpen, (v) => !v);
        const frames = (await page.evaluate('window.__frames')) as { t: number; x: number; open: boolean }[];
        const events = (await page.evaluate('window.__events')) as { type: string; property?: string; open: boolean; keyframes?: string[]; ms?: number }[];
        const seen = `${screen}: events ${JSON.stringify(events)}, frames ${JSON.stringify(frames)}`;
        // It slid out towards its own edge while still open (not closed at once), the backdrop faded with it, and
        // only then did it close (the first event seen closed).
        const close = events.findIndex((e) => !e.open);
        const ran = (property: string, keyframes: string[]) => {
          const i = events.findIndex((e) => e.type === 'transitionrun' && e.property === property);
          assert.ok(i >= 0 && i < close && events[i].open, `${name} ${how}: a transition of ${property} while open, before the close; ${seen}`);
          assert.deepStrictEqual(events[i].keyframes, keyframes, `${name} ${how}: ${property}; ${seen}`);
          assert.ok(events[i].ms! > 0, `${name} ${how}: ${property} takes time; ${seen}`);
        };
        ran('transform', ['none', `translateX(${sign * 100}%)`]);
        if (backdrop) ran('::backdropopacity', ['1', '0']);
        // The frames drawn meanwhile go towards that edge, never back, and never past where it leaves the screen.
        const xs = frames.filter((f) => f.open).map((f) => f.x);
        for (let i = 1; i < xs.length; i++) assert.ok(sign * (xs[i] - xs[i - 1]) >= -0.5, `${name} ${how}: monotonic; ${seen}`);
        assert.ok(xs.every((v) => sign * (v - home) >= -0.5 && sign * (v - home) <= width + 0.5), `${name} ${how}: between its place and the edge (${home}, width ${width}); ${seen}`);
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
        // Wait longer than the 500 ms safety timer of closeSheet (web/layout.ts): a timer left running by the reopening would close the sheet then.
        await page.waitForTimeout(600);
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
});
