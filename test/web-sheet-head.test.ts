// The web page on a phone: the sheet's header row (src/ui/sheet.ts, `sheetForms`; web/panel-head.ts). Its controls never lie
// over one another, and the drawn ones (the depth's control, the tools) keep off the grab bar; a phone's row has no tools in
// any language, so that the form does not depend on the words' widths; the depth's menu button is drawn as high as the
// file type's chip (32 px in a 44 px target). Seen on an Android phone in Japanese at about 410 px, with an empty editor:
// the depth's menu with Collapse and Markdown beside it lay over the grab bar. With CI's CJK fonts (test/support/site.ts).
import * as assert from 'assert';
import type { Browser, Page } from 'playwright-core';
import { menuItem, openSite, until } from './support/site';

interface Box { id: string; l: number; r: number; t: number; b: number }

describe('the web page on a phone: the sheet\'s header row', function () {
  this.timeout(240000);
  let browser: Browser;
  let base = '';

  before(async function () {
    ({ browser, base } = await openSite(this));
  });

  async function open(width: number, lang: 'en' | 'ja', dark: boolean): Promise<Page> {
    const { devices } = await import('playwright-core');
    const ctx = await browser.newContext({ ...devices['iPhone 13'], viewport: { width, height: 800 }, locale: lang === 'ja' ? 'ja-JP' : 'en-US', colorScheme: dark ? 'dark' : 'light' });
    const page = await ctx.newPage();
    await page.goto(base);
    await page.locator('.cm-line').nth(3).waitFor();
    return page;
  }

  /** The row's controls as drawn, the grab bar, and the form taken. */
  const measure = (page: Page) => page.evaluate(`(() => {
    const head = document.getElementById('panel-head');
    const box = (e) => { const r = e.getBoundingClientRect(); return { id: e.id || e.className, l: r.left, r: r.right, t: r.top, b: r.bottom }; };
    const shown = (e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden';
    const controls = [...head.querySelectorAll('#panel-tabs [role=tab], #slot-open, #view-slot .vc-options button, #collapse, #copy-md')].filter(shown).map(box);
    const drawn = [...head.querySelectorAll('#slot-open, #view-slot .vc-options, .panel-tools')].filter((e) => shown(e) && getComputedStyle(e).display !== 'none').map(box);
    const grab = document.getElementById('sheet-grab');
    const g = grab.getBoundingClientRect();
    const before = getComputedStyle(grab, '::before');
    const w = parseFloat(before.width);
    const top = g.top + parseFloat(before.top);
    const bar = { id: 'bar', l: g.left + g.width / 2 - w / 2, r: g.left + g.width / 2 + w / 2, t: top, b: top + parseFloat(before.height) };
    const tall = (s) => { const e = document.querySelector(s); return e && shown(e) ? [e.clientHeight, e.offsetHeight] : null; };
    return { controls, drawn, bar, tools: head.dataset.tools, form: document.getElementById('view-slot').dataset.form, squeeze: head.dataset.squeeze !== undefined, pill: tall('#slot-open'), chip: tall('#scope-chip') };
  })()`) as Promise<{ controls: Box[]; drawn: Box[]; bar: Box; tools: string; form: string; squeeze: boolean; pill: number[] | null; chip: number[] | null }>;
  const meets = (a: Box, c: Box) => a.l < c.r - 0.5 && c.l < a.r - 0.5 && a.t < c.b - 0.5 && c.t < a.b - 0.5;

  for (const width of [390, 412, 430]) {
    it(`lays the controls side by side, off the grab bar, with no tools, empty and with the sample, en and ja, ${width} px`, async () => {
      for (const lang of ['en', 'ja'] as const) {
        for (const empty of [true, false]) {
          const seen = `${lang} ${width} ${empty ? 'empty' : 'sample'}`;
          const page = await open(width, lang, lang === 'ja');
          if (empty) {
            await menuItem(page, '#menu-clear');
            await until('the ✓', () => page.locator('#tab-problems').innerText(), (t) => t.includes('✓'));
          }
          await page.waitForTimeout(300);
          const m = await measure(page);
          // (A phone's row: the same tools in both languages, none.)
          assert.strictEqual(m.tools, 'none', `${seen}: ${JSON.stringify(m)}`);
          assert.strictEqual(m.squeeze, false, seen);
          for (let i = 0; i < m.controls.length; i++) for (let j = i + 1; j < m.controls.length; j++) assert.ok(!meets(m.controls[i], m.controls[j]), `${seen}: ${m.controls[i].id} over ${m.controls[j].id}`);
          // (The tabs pass under the bar, their words below it; what draws a fill or an edge keeps off it.)
          for (const d of m.drawn) assert.ok(d.r <= m.bar.l + 0.5 || d.l >= m.bar.r - 0.5, `${seen}: ${d.id} [${d.l}, ${d.r}] over the bar [${m.bar.l}, ${m.bar.r}]`);
          // The depth's menu button is as high as the file type's chip: drawn 32 px high, in a target of 44.
          if (m.form === 'menu') assert.deepStrictEqual(m.pill, m.chip, `${seen}: the pill ${m.pill}, the chip ${m.chip}`);
          if (m.pill) assert.deepStrictEqual(m.pill, [32, 44], seen);
          await page.context().close();
        }
      }
    });
  }

  it('says the row to a screen reader as before: the tabs, the depth, and Copy as Markdown in the menu', async () => {
    const page = await open(430, 'ja', true);
    await menuItem(page, '#menu-clear');
    await until('the ✓', () => page.locator('#tab-problems').innerText(), (t) => t.includes('✓'));
    // (The grabber, the tabs and the depth: no tools on a phone's row.)
    assert.strictEqual(await page.locator('#panel-head').ariaSnapshot(), [
      '- slider "解説の高さ"', '- tablist "パネル":', '  - tab "解説 行 1" [selected]', '  - tab "問題なし": ✓', '  - tab "早見表"',
      '- group "深さ":', '  - button "概要" [pressed]', '  - button "単語ごと"',
    ].join('\n'));
    // (Copy as Markdown is in the menu while the row has no tools.)
    await page.locator('#menu-open').click();
    assert.strictEqual(await page.locator('#menu-copy-md').isVisible(), true);
    await page.context().close();
  });
});
