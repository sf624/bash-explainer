// The web page on a phone: the sheet's header row (src/ui/sheet.ts, `sheetForms`; web/panel-head.ts). Its controls never lie
// over one another, and none lies in the grab strip above it (usability-9.md, 2.5); a phone's row has no tools in
// any language, so that the form does not depend on the words' widths; the depth's menu button is drawn as high as the
// file type's chip (32 px in a 44 px target), and every phone pill's ends are half circles, on hover and in forced colours
// too. Seen on an Android phone in Japanese at about 410 px, with an empty editor: the depth's menu with Collapse and
// Markdown beside it lay over the grab bar, which was drawn in the row then. With CI's CJK fonts (test/support/site.ts).
import * as assert from 'assert';
import type { Browser, BrowserContextOptions, Page } from 'playwright-core';
import { SHEET_TOOLS_WIDTH } from '../src/ui/sheet';
import { menuItem, openSite, until } from './support/site';

interface Box { id: string; l: number; r: number; t: number; b: number }

describe('the web page on a phone: the sheet\'s header row', function () {
  this.timeout(240000);
  let browser: Browser;
  let base = '';

  before(async function () {
    ({ browser, base } = await openSite(this));
  });

  async function open(width: number, lang: 'en' | 'ja', dark: boolean, more: BrowserContextOptions = {}): Promise<Page> {
    const { devices } = await import('playwright-core');
    const ctx = await browser.newContext({ ...devices['iPhone 13'], viewport: { width, height: 800 }, locale: lang === 'ja' ? 'ja-JP' : 'en-US', colorScheme: dark ? 'dark' : 'light', ...more });
    const page = await ctx.newPage();
    await page.goto(base);
    await page.locator('.cm-line').nth(3).waitFor();
    return page;
  }

  /** The row's controls as drawn, the grab strip, and the form taken. */
  const measure = (page: Page) => page.evaluate(`(() => {
    const head = document.getElementById('panel-head');
    const box = (e) => { const r = e.getBoundingClientRect(); return { id: e.id || e.className, l: r.left, r: r.right, t: r.top, b: r.bottom }; };
    const shown = (e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden';
    const controls = [...head.querySelectorAll('#panel-tabs [role=tab], #slot-open, #view-slot .vc-options button, #collapse, #copy-md')].filter(shown).map(box);
    const drawn = [...head.querySelectorAll('#slot-open, #view-slot .vc-options, .panel-tools')].filter((e) => shown(e) && getComputedStyle(e).display !== 'none').map(box);
    const strip = box(document.getElementById('sheet-grab'));
    // (What draws a pill, its ::before, and the box of its target.)
    const drawnHeight = (e) => { const b = getComputedStyle(e, '::before'); return parseFloat(b.height) + (b.boxSizing === 'border-box' ? 0 : parseFloat(b.borderTopWidth) + parseFloat(b.borderBottomWidth)); };
    const tall = (s) => { const e = document.querySelector(s); return e && shown(e) ? [drawnHeight(e), e.offsetHeight] : null; };
    return { controls, drawn, strip, tools: head.dataset.tools, form: document.getElementById('view-slot').dataset.form, squeeze: head.dataset.squeeze !== undefined, pill: tall('#slot-open'), chip: tall('#scope-chip') };
  })()`) as Promise<{ controls: Box[]; drawn: Box[]; strip: Box; tools: string; form: string; squeeze: boolean; pill: number[] | null; chip: number[] | null }>;
  const meets = (a: Box, c: Box) => a.l < c.r - 0.5 && c.l < a.r - 0.5 && a.t < c.b - 0.5 && c.t < a.b - 0.5;

  // (600 and 620: a tablet's row, with the tools.)
  for (const width of [390, 412, 430, 600, 620]) {
    it(`lays the controls side by side, under the grab strip, with no tools on a phone, empty and with the sample, en and ja, ${width} px`, async () => {
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
          if (width < SHEET_TOOLS_WIDTH) assert.strictEqual(m.tools, 'none', `${seen}: ${JSON.stringify(m)}`);
          assert.strictEqual(m.squeeze, false, seen);
          for (let i = 0; i < m.controls.length; i++) for (let j = i + 1; j < m.controls.length; j++) assert.ok(!meets(m.controls[i], m.controls[j]), `${seen}: ${m.controls[i].id} over ${m.controls[j].id}`);
          // (The grab strip is 10 px high across the row's top, and nothing a finger presses or that draws lies in it.)
          assert.ok(Math.abs(m.strip.b - m.strip.t - 10) < 0.5, `${seen}: ${JSON.stringify(m.strip)}`);
          for (const d of [...m.controls, ...m.drawn]) assert.ok(d.t >= m.strip.b - 0.5, `${seen}: ${d.id} [${d.t}, ${d.b}] in the grab strip [${m.strip.t}, ${m.strip.b}]`);
          // The depth's menu button is as high as the file type's chip: drawn 32 px high, in a target of 44.
          if (m.form === 'menu') assert.deepStrictEqual(m.pill, m.chip, `${seen}: the pill ${m.pill}, the chip ${m.chip}`);
          if (m.pill) assert.deepStrictEqual(m.pill, [32, 44], seen);
          await page.context().close();
        }
      }
    });
  }

  /**
   * The ends of each phone pill as drawn, at its left or right end: the height of what draws the fill and edge, and its
   * corner's radius across and down there (the used radius, scaled down as CSS does when the radii are too big for the
   * box, less the border that is not drawn). A round end is a half circle: both radii half the height.
   */
  const ends = (page: Page) => page.evaluate(`(() => {
    const px = (v) => parseFloat(v) || 0;
    const corner = (v) => { const [x, y = x] = v.split(' ').map(px); return [x, y]; };
    const end = (el, pseudo, side) => {
      const cs = getComputedStyle(el, pseudo);
      if (pseudo && cs.content === 'none') return null;
      const bt = px(cs.borderTopWidth), bb = px(cs.borderBottomWidth), bl = px(cs.borderLeftWidth), br = px(cs.borderRightWidth);
      const outerH = pseudo ? px(cs.height) + (cs.boxSizing === 'border-box' ? 0 : bt + bb) : el.offsetHeight;
      const outerW = pseudo ? px(cs.width) + (cs.boxSizing === 'border-box' ? 0 : bl + br) : el.offsetWidth;
      const [tl, tr, blc] = [corner(cs.borderTopLeftRadius), corner(cs.borderTopRightRadius), corner(cs.borderBottomLeftRadius)];
      const f = Math.min(1, outerW / (tl[0] + tr[0] || 1), outerH / (tl[1] + blc[1] || 1));
      const [r, b] = side === 'left' ? [tl, bl] : [tr, br];
      // (A transparent border over a fill clipped to the padding box is not drawn: the fill is the padding box. Else the border box is.)
      const clear = (cs.borderTopColor === 'rgba(0, 0, 0, 0)' || cs.borderTopColor === 'transparent') && cs.backgroundClip === 'padding-box';
      const h = clear ? outerH - bt - bb : outerH;
      return { h, across: r[0] * f - (clear ? b : 0), down: r[1] * f - (clear ? bt : 0) };
    };
    const at = (id, pseudo, side) => { const e = document.getElementById(id); return e && e.getClientRects().length ? end(e, pseudo, side) : null; };
    return {
      chip: [at('scope-chip', '::before', 'left'), at('scope-chip', '::before', 'right')],
      pill: [at('slot-open', '::before', 'left'), at('slot-open', '::before', 'right')],
      segments: [at('slot-depth1', '::before', 'left'), at('slot-depth2', '::before', 'right')],
      readEdit: [at('mode-read', '::before', 'left'), at('mode-edit', '::before', 'right')],
    };
  })()`) as Promise<Record<string, ({ h: number; across: number; down: number } | null)[]>>;

  it('draws the ends of every phone pill as half circles, the file type\'s chip, the depth\'s menu and segments, and Read | Edit, light and dark, 412 px', async () => {
    const seen = new Set<string>();
    for (const lang of ['en', 'ja'] as const) {
      for (const dark of [false, true]) {
        const page = await open(412, lang, dark);
        await page.waitForTimeout(300);
        const all = await ends(page);
        for (const [name, list] of Object.entries(all)) {
          for (const e of list) {
            if (!e) continue;
            seen.add(name);
            const at = `${lang} ${dark ? 'dark' : 'light'} ${name}: ${JSON.stringify(e)}`;
            assert.ok(Math.abs(e.across - e.h / 2) < 0.5 && Math.abs(e.down - e.h / 2) < 0.5, at);
          }
        }
        // (The pills of the sheet's row are as high as the chip: 32 px, Read | Edit 30.)
        for (const name of ['pill', 'segments']) for (const e of all[name]) if (e) assert.strictEqual(e.h, all.chip[0]!.h, `${lang} ${name}`);
        await page.context().close();
      }
    }
    assert.deepStrictEqual([...seen].sort(), ['chip', 'pill', 'readEdit', 'segments']);
  });

  /** What the box of each pill draws itself: its border's width and its fill (none: its ::before draws it). */
  const boxes = (page: Page) => page.evaluate(`['scope-chip', 'slot-open'].map((id) => document.getElementById(id)).filter((e) => e && e.getClientRects().length).map((e) => {
    const cs = getComputedStyle(e);
    return [e.id, cs.borderTopWidth, cs.borderBottomWidth, cs.backgroundColor, cs.boxShadow];
  })`) as Promise<string[][]>;

  it('keeps the pills drawn 32 px high with round ends under a mouse pointer (hover), at 360 px', async () => {
    // (A window as narrow as a phone with a mouse: html.narrow, and hover.)
    const ctx = await browser.newContext({ viewport: { width: 360, height: 800 }, locale: 'en-US' });
    const page = await ctx.newPage();
    await page.goto(base);
    await page.locator('.cm-line').nth(3).waitFor();
    for (const id of ['#scope-chip', '#slot-open']) {
      await page.locator(id).hover();
      await page.waitForTimeout(250);
      const all = await ends(page);
      const name = id === '#scope-chip' ? 'chip' : 'pill';
      for (const e of all[name]) assert.ok(e && e.h === 32 && Math.abs(e.across - 16) < 0.5 && Math.abs(e.down - 16) < 0.5, `${id} on hover: ${JSON.stringify(e)}`);
      // (Before, the box took `button:hover`: its 6 px bands drew grey, its fill grew to 44 px.)
      for (const [box, top, bottom, fill, shadow] of await boxes(page)) assert.deepStrictEqual([top, bottom, fill, shadow], ['0px', '0px', 'rgba(0, 0, 0, 0)', 'none'], `${id} on hover: ${box}`);
    }
    await ctx.close();
  });

  it('draws the pills in forced colours as a thin edge 32 px high, the box drawing nothing', async () => {
    for (const lang of ['en', 'ja'] as const) {
      const page = await open(412, lang, false, { forcedColors: 'active' });
      await page.waitForTimeout(300);
      const all = await ends(page);
      for (const name of ['chip', 'pill', 'segments']) {
        for (const e of all[name]) if (e) assert.ok(e.h === 32 && Math.abs(e.across - 16) < 0.5, `${lang} ${name}: ${JSON.stringify(e)}`);
      }
      const edges = await page.evaluate(`['scope-chip', 'slot-open', 'slot-depth1'].map((id) => document.getElementById(id)).filter((e) => e && e.getClientRects().length).map((e) => [e.id, getComputedStyle(e).borderTopWidth, getComputedStyle(e, '::before').borderTopWidth])`) as string[][];
      for (const [id, box, drawn] of edges) assert.deepStrictEqual([box, drawn], ['0px', '1px'], `${lang} ${id}`);
      // (The option shown keeps a fill of its own there, the system's selection, as Read | Edit's mode does.)
      const fills = await page.evaluate(`['mode-read', 'mode-edit', 'slot-depth1', 'slot-depth2'].map((id) => document.getElementById(id)).filter((e) => e && e.getClientRects().length).map((e) => [e.getAttribute('aria-pressed'), getComputedStyle(e, '::before').backgroundColor])`) as string[][];
      const pressed = new Set(fills.filter(([p]) => p === 'true').map(([, c]) => c));
      const other = new Set(fills.filter(([p]) => p !== 'true').map(([, c]) => c));
      assert.ok(pressed.size === 1 && ![...pressed].some((c) => other.has(c)), `${lang}: ${JSON.stringify(fills)}`);
      const dir = process.env.BASH_EXPLAINER_SHOTS;
      if (dir) await page.screenshot({ path: `${dir}/forced-412-${lang}.png` });
      await page.context().close();
    }
  });

  /**
   * Each segment of the phone's pills (the depth's segments, Read | Edit) as drawn: the gaps between its label's text (a
   * Range over its text) and the drawn pill's edge or the divider, at its left and right. The pill is the button's ::before,
   * whose left and right borders are the pill's edge and the divider.
   */
  const gaps = (page: Page) => page.evaluate(`['slot-depth1', 'slot-depth2', 'mode-read', 'mode-edit'].map((id) => document.getElementById(id)).filter((b) => b && b.getClientRects().length && getComputedStyle(b, '::before').content !== 'none').map((b) => {
    const walker = document.createTreeWalker(b, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.textContent.trim() && !n.parentElement.closest('[aria-hidden="true"], .vc-size') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP) });
    const text = walker.nextNode();
    const range = document.createRange();
    range.selectNodeContents(text);
    const t = range.getBoundingClientRect();
    const r = b.getBoundingClientRect();
    const cs = getComputedStyle(b, '::before');
    const left = r.left + parseFloat(cs.borderLeftWidth), right = r.right - parseFloat(cs.borderRightWidth);
    return { id: b.id, text: text.textContent, left: t.left - left, right: right - t.right };
  })`) as Promise<{ id: string; text: string; left: number; right: number }[]>;

  for (const width of [390, 412, 430, 620]) {
    it(`centres each segment's label between the pill's edge and the divider, en and ja, ${width} px`, async () => {
      const seen = new Set<string>();
      for (const lang of ['en', 'ja'] as const) {
        const page = await open(width, lang, false);
        await page.waitForTimeout(300);
        for (const g of await gaps(page)) {
          seen.add(g.id);
          assert.ok(Math.abs(g.left - g.right) <= 1, `${lang} ${width} ${g.id} 「${g.text}」: left ${g.left.toFixed(2)}, right ${g.right.toFixed(2)}`);
        }
        await page.context().close();
      }
      assert.ok(seen.has('mode-read') && seen.has('mode-edit'), [...seen].join());
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
