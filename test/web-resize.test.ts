// The web page: resizing the panes and the Problems list, run for real in headless Chromium (the build, the server and the browser
// are shared by all test/web-*.test.ts files: test/support/site.ts). Skipped when no browser can start,
// unless $BASH_EXPLAINER_BROWSER is set (as in CI).
import * as assert from 'assert';
import type { Browser } from 'playwright-core';
import { openSettingsSection, openSite, stable, until } from './support/site';

describe('the web page: resizing the panes and the Problems list', function () {
  this.timeout(120000);
  let browser: Browser;
  let base = '';

  before(async function () {
    ({ browser, base } = await openSite(this));
  });

  it('resizes the editor and the explanation with the divider: a drag, the keys, a double click; the size is kept', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
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
    const phone = await browser.newContext({ ...devices['iPhone 13'] });
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
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    const open = async () => {
      await page.goto(base);
      await page.locator('.cm-line').first().waitFor();
    };
    // The script's problems, in place of the sample's pitfalls (the rows' text is there when they are folded too).
    const scriptProblems = () => until('the script\'s problems', () => page.locator('#problem-list').textContent(),
      (t) => !!t && !/Pitfall/.test(t) && (t.match(/dbracket/g) ?? []).length >= 6);
    await open();
    // The sample's pitfalls are problems already; the script's own replace them.
    await until('the sample\'s problems', () => page.locator('#problems').isVisible(), (v) => v);
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText(SCRIPT);
    await scriptProblems();
    const list = async () => Math.round((await page.locator('#problems').boundingBox())!.height);
    const value = () => page.locator('#problems-resize').getAttribute('aria-valuenow');
    const rows = () => page.locator('#problem-list li').first().isVisible();
    assert.match((await page.locator('#problems-said').textContent())!, /^Problems: \d+ \w+/);
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
    await scriptProblems();
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
    assert.match((await page.locator('#problems-said').textContent())!, /^Problems: \d+ \w+/);
    await open();
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText(SCRIPT);
    await scriptProblems();
    assert.strictEqual(await page.locator('#problems').isVisible(), true);
    assert.strictEqual(await page.locator('#problems-toggle').getAttribute('aria-expanded'), 'false');
    assert.strictEqual(await rows(), false);
    // Opened again, it has the height it had.
    await page.locator('#problems-toggle').click();
    assert.strictEqual(await rows(), true);
    assert.strictEqual(await list(), first + 30);

    // Cleared with the stored data.
    assert.ok((await page.evaluate('Object.keys(localStorage)') as string[]).includes('bash-explainer-problems'));
    await page.locator('#problems-toggle').click();
    await openSettingsSection(page, 'data');
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
    const phone = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 360, height: 740 } });
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
    // A phone starts with the list folded; unfold it for the drag.
    assert.strictEqual(await p2.locator('#problems-toggle').getAttribute('aria-expanded'), 'false');
    await p2.locator('#problems-toggle').tap();
    await until('the list unfolds', () => p2.locator('#problems-toggle').getAttribute('aria-expanded'), (v) => v === 'true');
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
    // Right after a CDP touch sequence Chromium drops the click of the next tap, and nothing in the page shows
    // it (a fixed wait of 300 ms was not enough on a slow runner). So tap, wait for the list to go, and tap
    // again if it has not (at most 5 taps). The toggle counts its own flips, so a tap that works twice, or a
    // toggle that does not work, cannot pass by accident: the list must be hidden after an odd number of flips.
    // Only a change of value is a flip: the page writes the same aria-expanded again whenever the list's box
    // resizes (folding it shrinks the box, so a write follows a frame later), and on a loaded runner that write
    // lands before the count is read. Each record's old value is the value before it, so the values in turn are
    // the old values of the records, then the attribute as it is now.
    await p2.evaluate(`window.__flips = 0;
      const toggle = document.getElementById('problems-toggle');
      new MutationObserver((records) => {
        const values = [...records.map((r) => r.oldValue), toggle.getAttribute('aria-expanded')];
        for (let i = 1; i < values.length; i++) if (values[i] !== values[i - 1]) window.__flips++;
      }).observe(toggle, { attributes: true, attributeOldValue: true, attributeFilter: ['aria-expanded'] })`);
    const hidden = async () => !(await p2.locator('#problem-list li').first().isVisible());
    let taps = 0;
    do {
      await p2.locator('#problems-toggle').tap();
      taps++;
      const end = Date.now() + 500;
      while (Date.now() < end && !(await hidden())) await new Promise((r) => setTimeout(r, 50));
    } while (!(await hidden()) && taps < 5);
    assert.strictEqual(await hidden(), true, `still visible after ${taps} taps`);
    const flips = await p2.evaluate('window.__flips') as number;
    assert.strictEqual(flips % 2, 1, `${flips} flips`);
    assert.strictEqual(await p2.locator('#problems-toggle').getAttribute('aria-expanded'), 'false');
    assert.strictEqual(await flat(), true);
    await phone.close();
  });

  it('starts with the Problems list folded on a phone and open on a wide screen; a stored choice wins', async () => {
    const { devices } = await import('playwright-core');
    const phone = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 740 } });
    const p = await phone.newPage();
    await p.goto(base);
    await p.locator('.cm-line').first().waitFor();
    await until('the sample\'s problems', () => p.locator('#problems').isVisible(), (v) => v);
    const toggle = p.locator('#problems-toggle');
    const expanded = () => toggle.getAttribute('aria-expanded');
    assert.strictEqual(await expanded(), 'false');
    assert.strictEqual(await p.locator('#problem-list li').first().isVisible(), false);
    // The strip says the counts and is a touch target.
    assert.match((await p.locator('#problems-said').textContent())!, /^Problems: [1-9]\d* \w+/);
    assert.ok((await toggle.boundingBox())!.height >= 44);
    // (The strip, 44 px, and its room clear of the divider's grab area under it.)
    assert.ok((await p.locator('#problems').boundingBox())!.height <= 54);
    // The editor keeps the height the list leaves it: folded, it has the most room.
    const editorHeight = async () => Math.round((await p.locator('.cm-editor').boundingBox())!.height);
    const folded = await editorHeight();
    // Unfolding works and is remembered (a stored choice, not the default).
    await toggle.tap();
    await until('the list unfolds', expanded, (v) => v === 'true');
    assert.strictEqual(await p.locator('#problem-list li').first().isVisible(), true);
    assert.ok(await editorHeight() < folded);
    await p.reload();
    await p.locator('.cm-line').first().waitFor();
    await until('the sample\'s problems', () => p.locator('#problems').isVisible(), (v) => v);
    assert.strictEqual(await expanded(), 'true');
    // Without a stored choice the default follows the width.
    await p.evaluate('localStorage.clear()');
    await p.reload();
    await p.locator('.cm-line').first().waitFor();
    await until('folded again', expanded, (v) => v === 'false');
    // A phone zoomed out is wider in CSS pixels, but still a phone (test/web-phone.test.ts).
    const cdp = await phone.newCDPSession(p);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 1897, deviceScaleFactor: 1.17, mobile: true, screenWidth: 390, screenHeight: 844 });
    await until('the zoom', () => p.evaluate('innerWidth') as Promise<number>, (w) => w === 1000);
    assert.strictEqual(await stable('the list on a zoomed-out phone', expanded), 'false');
    await phone.close();

    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const w = await ctx.newPage();
    await w.goto(base);
    await w.locator('.cm-line').first().waitFor();
    await until('the sample\'s problems', () => w.locator('#problems').isVisible(), (v) => v);
    assert.strictEqual(await w.locator('#problems-toggle').getAttribute('aria-expanded'), 'true');
    assert.strictEqual(await w.locator('#problem-list li').first().isVisible(), true);
    // A desktop window made narrow is laid out as a phone, and wide again as before.
    await w.setViewportSize({ width: 390, height: 720 });
    await until('folded in a narrow window', () => w.locator('#problems-toggle').getAttribute('aria-expanded'), (v) => v === 'false');
    await w.setViewportSize({ width: 1000, height: 720 });
    await until('open in a wide window', () => w.locator('#problems-toggle').getAttribute('aria-expanded'), (v) => v === 'true');
    await ctx.close();
  });
});
