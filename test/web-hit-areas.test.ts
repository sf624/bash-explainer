// The web page: the hit areas of its controls (docs/design/chrome-redesign.md, section 5 "Hit areas", C0). On a phone
// every control's hit area is at least 44x44 px, side by side at least 24x24. Today's smaller controls are on an
// allow-list (test/fixtures/hit-areas.json) that may only shrink: a control under the bar that is not on it fails,
// and so does an entry whose control now meets the bar. A new control is never on the list.
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import type { Browser, BrowserContextOptions, Frame, Page } from 'playwright-core';
import { openSite, menuItem, stable, until, type Site } from './support/site';
import { compare, hitAreas, listed, DESKTOP_BAR, PHONE_BAR, type Allowed, type HitArea } from './support/hit-areas';

const listPath = path.join(__dirname, 'fixtures/hit-areas.json');
const allowed = Object.fromEntries(
  Object.entries(JSON.parse(fs.readFileSync(listPath, 'utf8')) as Record<string, unknown>).filter(([k]) => k !== '//'),
) as Allowed;

/** The page at the widths of the design: a phone (touch), 640 px and 1280 px (a mouse). */
const profiles: { name: string; bar: number; options: (locale: string) => Promise<BrowserContextOptions> }[] = [
  { name: '390', bar: PHONE_BAR, options: async (locale) => ({ ...(await import('playwright-core')).devices['iPhone 13'], viewport: { width: 390, height: 844 }, locale }) },
  { name: '640', bar: DESKTOP_BAR, options: async (locale) => ({ viewport: { width: 640, height: 800 }, locale }) },
  { name: '1280', bar: DESKTOP_BAR, options: async (locale) => ({ viewport: { width: 1280, height: 800 }, locale }) },
];

/** Waits until a dialog has stopped moving (it slides in), so that its controls are where a pointer would find them. */
const settled = (page: Page, selector: string) => stable(`${selector} to settle`, () => page.locator(selector).boundingBox(), 4);

const byKey = (where: string, areas: HitArea[]): Record<string, HitArea> => Object.fromEntries(areas.map((a) => [`${where} ${a.key}`, a]));

describe('the web page: hit areas', function () {
  this.timeout(180000);
  let browser: Browser;
  let firstVisit: Site['firstVisit'];
  let base = '';

  before(async function () {
    ({ browser, firstVisit, base } = await openSite(this));
  });

  // UPDATE_HIT_AREAS=1 writes the list from what the page has now (to see the diff; a list may only shrink, so look at it).
  const update = process.env.UPDATE_HIT_AREAS === '1';
  const written: Allowed = {};

  after(() => {
    if (!update) return;
    const text = JSON.stringify({ '//': (JSON.parse(fs.readFileSync(listPath, 'utf8')) as Record<string, string>)['//'], ...written }, (_k, v) => v, 2);
    fs.writeFileSync(listPath, text.replace(/\[\s+(\d+),\s+(\d+)\s+\]/g, '[$1, $2]') + '\n');
  });

  it('keeps the list of smaller controls honest (no entry for a profile that is not measured)', () => {
    const names = profiles.flatMap((q) => ['en', 'ja'].map((l) => `${q.name} ${l}`));
    assert.deepStrictEqual(Object.keys(allowed).filter((p) => !names.includes(p)), []);
  });

  for (const lang of ['en', 'ja']) {
    for (const profile of profiles) {
      it(`has no control under ${profile.bar}x${profile.bar} that is not on the allow-list: ${profile.name} px, ${lang}`, async function () {
        // A first visit, so that the hint over the editor is measured too.
        const ctx = await firstVisit(await profile.options(lang === 'ja' ? 'ja-JP' : 'en-US'));
        const page = await ctx.newPage();
        await page.goto(base);
        await page.locator('.cm-line').first().waitFor();
        // The sample has problems, so the strip and its rows are on the page.
        await menuItem(page, '#menu-sample');
        await until('the sample\'s problems', () => page.locator('#problems').isVisible(), (v) => v, 20000);
        const panel = page.frames().find((f) => f.url().endsWith('/panel.html')) as Frame;
        await until('the tree', () => panel.locator('.row').count(), (n) => n > 1);
        // The phone's first-run tip of the read-mode switch lies over the editor's header until it is closed: its own
        // controls are measured with it, the page's others without it.
        const withTip = byKey('page', await hitAreas(page));
        if (await page.locator('#readtip-close').isVisible()) await page.locator('#readtip-close').click();
        const measured: Record<string, HitArea> = {
          ...Object.fromEntries(Object.entries(withTip).filter(([k]) => k.includes('readtip'))),
          ...Object.fromEntries(Object.entries(byKey('page', await hitAreas(page))).filter(([k]) => !k.includes('readtip'))),
          ...byKey('panel', await hitAreas(panel)),
        };
        // The menu, the settings, the editor header's ⋯ and the file kinds' list: each open on its own.
        await page.locator('#menu-open').click();
        await settled(page, '#drawer');
        Object.assign(measured, byKey('menu', await hitAreas(page, '#drawer')));
        await page.locator('#menu-close').click();
        await until('the menu closed', () => page.locator('#drawer').evaluate((d) => (d as unknown as { open: boolean }).open), (v) => !v);
        await page.locator('#settings-open').click();
        await page.locator('#settings-dialog').waitFor({ state: 'visible' });
        await settled(page, '#settings-dialog');
        Object.assign(measured, byKey('settings', await hitAreas(page, '#settings-dialog')));
        await page.keyboard.press('Escape');
        await page.locator('#settings-dialog').waitFor({ state: 'hidden' });
        // The editor header's ⋯ menu.
        await page.locator('#ed-more').click();
        await page.locator('#ed-more-menu').waitFor({ state: 'visible' });
        Object.assign(measured, byKey('more', await hitAreas(page, '#ed-more-menu')));
        await page.keyboard.press('Escape');
        await page.locator('#ed-more-menu').waitFor({ state: 'hidden' });
        // (On a narrow page the file kind is chosen in the menu, which was measured above.)
        if (await page.locator('#kind').isVisible()) {
          await page.locator('#kind').click();
          await page.locator('#kind-list').waitFor({ state: 'visible' });
          await settled(page, '#kind-list');
          Object.assign(measured, byKey('kind', await hitAreas(page, '#kind-list')));
          await page.keyboard.press('Escape');
        }
        await ctx.close();

        const name = `${profile.name} ${lang}`;
        if (update) {
          written[name] = Object.fromEntries(Object.entries(measured).filter(([, a]) => a.width < profile.bar || a.height < profile.bar).map(([k, a]) => [k, listed(a, profile.bar)]));
        } else {
          assert.deepStrictEqual(compare(name, measured, allowed[name] ?? {}, profile.bar), []);
        }
        assert.ok(Object.keys(measured).length > 10, String(Object.keys(measured).length));
      });
    }
  }

  it('measures a covered control as 0x0, and a control with a larger hit area than its box as the larger', async () => {
    const ctx = await browser.newContext({ viewport: { width: 400, height: 300 } });
    const page = await ctx.newPage();
    await page.setContent(`<style>
      body { margin: 0 }
      #small { position: absolute; left: 100px; top: 100px; width: 10px; height: 10px; padding: 0; border: 0; overflow: hidden; font-size: 0 }
      #large { position: absolute; left: 200px; top: 100px; width: 10px; height: 10px; padding: 0; border: 0 }
      #large::after { content: ''; position: absolute; inset: -17px }
      #under { position: absolute; left: 100px; top: 200px; width: 30px; height: 30px; padding: 0 }
      #cover { position: absolute; left: 90px; top: 190px; width: 60px; height: 60px; background: red }
    </style>
    <button id="small">a</button><button id="large">b</button><button id="under">c</button><div id="cover"></div>`);
    const areas = Object.fromEntries((await hitAreas(page)).map((a) => [a.key, [a.width, a.height]]));
    assert.deepStrictEqual(areas, { '#small': [10, 10], '#large': [44, 44], '#under': [0, 0] });
    await ctx.close();
  });

  it('compares with the allow-list: new, shrunk, stale and gone entries each fail', () => {
    const area = (width: number, height: number): HitArea => ({ key: 'k', name: 'n', width, height });
    const check = (m: Record<string, HitArea>, l: Record<string, [number, number]>) => compare('p', m, l, 24);
    assert.deepStrictEqual(check({ 'page #a': area(30, 30) }, {}), []);
    assert.deepStrictEqual(check({ 'page #a': area(20, 30) }, { 'page #a': [20, 30] }), []);
    assert.match(check({ 'page #a': area(20, 30) }, {})[0], /not on the allow-list/);
    assert.match(check({ 'page #a': area(10, 30) }, { 'page #a': [20, 24] })[0], /shrank from 20x24 to 10x30/);
    // Only a dimension under the bar is compared: 121 to 112 above a bar of 24 is no shrink, 24 to 12 is.
    assert.deepStrictEqual(check({ 'page #a': area(112, 20) }, { 'page #a': [24, 20] }), []);
    assert.deepStrictEqual(check({ 'page #a': area(30, 20) }, { 'page #a': [121, 20] }), []);
    assert.match(check({ 'page #a': area(12, 20) }, { 'page #a': [24, 20] })[0], /shrank from 24x20 to 12x20/);
    assert.match(check({ 'page #a': area(40, 10) }, { 'page #a': [40, 20] })[0], /shrank from 40x20 to 40x10/);
    assert.deepStrictEqual(check({ 'page #a': area(18, 28) }, { 'page #a': [20, 30] }), []); // (a pixel or two of difference between machines)
    assert.match(check({ 'page #a': area(24, 24) }, { 'page #a': [20, 30] })[0], /remove it from/);
    assert.match(check({}, { 'page #a': [20, 30] })[0], /not on the page/);
  });
});
