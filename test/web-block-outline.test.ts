// The web page marks the command over several lines at the cursor (web/block-outline.ts, src/ui/blockAt.ts), with the
// setting `blockOutline`: a bar (the default), a faint background, or nothing. In headless Chromium: the mark is on
// exactly the block's rows, it follows the cursor and typing, a change of the setting applies at once and is kept, and
// the mark moves nothing (lines, text, selection, the active line, scrolling), with wrapped lines or not, with classic
// scrollbars, and at a phone's width with the settings sheet open.
import * as assert from 'assert';
import type { Browser, Page } from 'playwright-core';
import { classicScrollbars, cursorToLine, openSite, settingControl, stable, until } from './support/site';

const LONG = `echo "${'word '.repeat(70)}end"`;
const SCRIPT = ['#!/bin/bash', 'echo head', 'for f in a b; do', '  if [ -n "$f" ]; then', `    ${LONG}`, '  fi', 'done', 'echo tail', ''].join('\n');

type Mode = 'bar' | 'tint' | 'off';
interface Open { width?: number; mode?: Mode; wrap?: boolean; browser?: Browser; forced?: boolean; scheme?: 'light' | 'dark' }

describe('the web page: the mark of the command at the cursor', function () {
  this.timeout(240000);
  let browser: Browser;
  let base = '';
  before(async function () {
    ({ browser, base } = await openSite(this));
  });

  /** The page with the script typed in, the cursor on its last line. */
  async function open(o: Open = {}, text = SCRIPT): Promise<Page> {
    const phone = (o.width ?? 1280) < 520;
    const settings: Record<string, unknown> = { 'bashExplainer.panel.animations': false };
    if (o.mode) settings['bashExplainer.blockOutline'] = o.mode;
    if (o.wrap === false) settings['bashExplainer.editor.wrap'] = false;
    const ctx = await (o.browser ?? browser).newContext({
      viewport: { width: o.width ?? 1280, height: phone ? 844 : 800 }, locale: 'en-US', colorScheme: o.scheme ?? 'light',
      ...(o.forced ? { forcedColors: 'active' as const } : {}),
      ...(phone ? { hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : {}),
    });
    await ctx.addInitScript(`try { if (!localStorage.getItem('bash-explainer-settings')) localStorage.setItem('bash-explainer-settings', ${JSON.stringify(JSON.stringify(settings))}); } catch {}`);
    const page = await ctx.newPage();
    await page.goto(base);
    await until('the sample', () => page.locator('.cm-content > .cm-line').count(), (n) => n > 20);
    await page.locator('.cm-content').focus();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText(text);
    await until('the script', () => page.locator('.cm-content > .cm-line').count(), (n) => n === text.split('\n').length);
    return page;
  }

  /** The rows (1-based) the mark is on, with their places. */
  const marks = (page: Page) => page.evaluate(`Array.from(document.querySelectorAll('.cm-content > .cm-line')).flatMap((el, i) => el.classList.contains('cm-bx-blk') ? [(i + 1) + ' ' + /cm-bx-blk-(\\w+)/.exec(el.className)[1]] : [])`) as Promise<string[]>;

  /** What a line draws for the mark: the shadow of the tint, and the bar (a pseudo-element). */
  const paint = (page: Page, line: number) => page.evaluate(`(() => {
    const el = document.querySelectorAll('.cm-content > .cm-line')[${line - 1}];
    const s = getComputedStyle(el), b = getComputedStyle(el, '::before');
    return { shadow: s.boxShadow, bar: b.content !== 'none' && b.content !== 'normal' && b.backgroundColor !== 'rgba(0, 0, 0, 0)', barLeft: parseFloat(b.left), barWidth: parseFloat(b.width), padding: parseFloat(s.paddingLeft), top: b.top, bottom: b.bottom };
  })()`) as Promise<{ shadow: string; bar: boolean; barLeft: number; barWidth: number; padding: number; top: string; bottom: string }>;

  /** How many style rules the page has that mention the mark. */
  const ruleCount = (page: Page) => page.evaluate("Array.from(document.styleSheets).flatMap((s) => Array.from(s.cssRules)).flatMap((r) => r.cssRules ? Array.from(r.cssRules) : [r]).filter((r) => r.cssText.includes('cm-bx-blk')).length") as Promise<number>;

  /** Everything the mark must not move: the rects of the lines, the first and last character of each, the gutters, the selection, the active line, the scrolling. */
  const layout = (page: Page): Promise<any> => stable('the layout', () => page.evaluate(`(() => {
    const r = (el) => { const b = el.getBoundingClientRect(); return [b.left, b.top, b.width, b.height].map((v) => Math.round(v * 100) / 100); };
    const q = (s) => Array.from(document.querySelectorAll(s)).map(r);
    const chars = Array.from(document.querySelectorAll('.cm-content > .cm-line')).map((el) => {
      const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let first = null, last = null;
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        if (!n.data.trim() || n.parentElement.closest('[contenteditable="false"]')) continue;
        const a = document.createRange(); a.setStart(n, 0); a.setEnd(n, 1);
        const z = document.createRange(); z.setStart(n, n.data.length - 1); z.setEnd(n, n.data.length);
        first ??= r(a); last = r(z);
      }
      return [first, last];
    });
    const s = document.querySelector('.cm-scroller');
    const active = document.querySelector('.cm-activeLine');
    return {
      lines: q('.cm-content > .cm-line'), content: q('.cm-content'), gutters: q('.cm-gutters'), gutterElements: q('.cm-gutterElement'), chars,
      selection: q('.cm-selectionBackground'), selectionColour: getComputedStyle(document.querySelector('.cm-selectionBackground') ?? document.body).backgroundColor,
      activeLine: active ? [r(active), getComputedStyle(active).backgroundColor, getComputedStyle(active).outline] : null,
      scroller: [s.scrollWidth, s.scrollHeight, s.clientWidth, s.clientHeight, s.scrollLeft, s.scrollTop], page: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
    };
  })()`));

  /** Chooses the mode in the settings (they open as a column or a sheet), and closes them. */
  async function choose(page: Page, mode: Mode, close = true): Promise<void> {
    await (await settingControl(page, 'blockOutline')).selectOption(mode);
    if (!close) return;
    await page.locator('#settings-done').click();
    await until('the settings closed', () => page.locator('#settings-dialog').isVisible(), (v) => !v);
  }

  const BLOCK_3_7 = ['3 first', '4 mid', '5 mid', '6 mid', '7 last'];
  const BLOCK_4_6 = ['4 first', '5 mid', '6 last'];

  it('is a bar by default, on exactly the rows of the block, and moves with the cursor', async () => {
    const page = await open();
    assert.deepStrictEqual(await marks(page), []);
    await cursorToLine(page, 5);
    assert.deepStrictEqual(await until('the block of the if', () => marks(page), (m) => m.length > 0), BLOCK_4_6);
    for (const line of [4, 5, 6]) {
      const p = await paint(page, line);
      assert.ok(p.bar && p.shadow === 'none', `line ${line}: ${JSON.stringify(p)}`);
      // The bar lies in the margin before the text: it covers none of it.
      assert.ok(p.barLeft + p.barWidth <= p.padding, `line ${line}: bar ${p.barLeft}+${p.barWidth} in padding ${p.padding}`);
    }
    for (const line of [1, 2, 3, 7, 8, 9]) {
      const p = await paint(page, line);
      assert.ok(!p.bar && p.shadow === 'none', `line ${line}: ${JSON.stringify(p)}`);
    }
    // The ends of the bar are rounded in: they leave a little of the first and last row.
    assert.strictEqual((await paint(page, 4)).top, '2px');
    assert.strictEqual((await paint(page, 6)).bottom, '2px');
    // Up to the `for`: the outer block. Onto `echo head`: none. A key moves it at once.
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    assert.deepStrictEqual(await until('the block of the for', () => marks(page), (m) => m.length === 5), BLOCK_3_7);
    await page.keyboard.press('ArrowUp');
    assert.deepStrictEqual(await until('no block', () => marks(page), (m) => m.length === 0), []);
    // Back down onto `done`, and a click on the `if` line.
    await cursorToLine(page, 7);
    assert.deepStrictEqual(await until('the for again', () => marks(page), (m) => m.length === 5), BLOCK_3_7);
    await page.locator('.cm-content > .cm-line').nth(5).click();
    assert.deepStrictEqual(await until('the if again', () => marks(page), (m) => m.length === 3), BLOCK_4_6);
    await page.context().close();
  });

  it('is a faint background with `tint`, on the same rows, and nothing with `off`', async () => {
    const tint = await open({ mode: 'tint' });
    await cursorToLine(tint, 5);
    assert.deepStrictEqual(await until('the block', () => marks(tint), (m) => m.length > 0), BLOCK_4_6);
    for (const line of [4, 5, 6]) {
      const p = await paint(tint, line);
      assert.match(p.shadow, /rgba\(127, 127, 127, 0\.09\)/, `line ${line}`);
      // (No bar: the tint is all.)
      assert.strictEqual(p.bar, false);
    }
    for (const line of [3, 7]) assert.strictEqual((await paint(tint, line)).shadow, 'none');
    await tint.context().close();

    const off = await open({ mode: 'off' });
    await cursorToLine(off, 5);
    await off.keyboard.press('ArrowUp');
    await off.keyboard.press('ArrowDown');
    assert.deepStrictEqual(await marks(off), []);
    // Nothing is added to the page: no rule of the mark, no plugin.
    assert.strictEqual(await off.evaluate("Array.from(document.styleSheets).some((s) => Array.from(s.cssRules).some((r) => r.cssText.includes('cm-bx-blk')))"), false);
    await off.context().close();
  });

  it('draws in the system colours when colours are forced: a bar, also for the tint', async () => {
    for (const mode of ['bar', 'tint'] as const) {
      const page = await open({ mode, forced: true });
      await cursorToLine(page, 5);
      await until('the block', () => marks(page), (m) => m.length > 0);
      const p = await paint(page, 5);
      assert.ok(p.bar && p.shadow === 'none', `${mode}: ${JSON.stringify(p)}`);
      assert.strictEqual(await page.evaluate("getComputedStyle(document.querySelectorAll('.cm-content > .cm-line')[4], '::before').backgroundColor"), await page.evaluate("(() => { const d = document.createElement('div'); d.style.color = 'CanvasText'; document.body.append(d); const c = getComputedStyle(d).color; d.remove(); return c; })()"), mode);
      await page.context().close();
    }
  });

  it('follows typing: the marks move with the text at once and the block is looked up again when the page has parsed it', async () => {
    const page = await open();
    await cursorToLine(page, 5);
    await until('the block', () => marks(page), (m) => m.length === 3);
    // A line typed inside the block, at the end of its first line.
    await page.locator('.cm-content > .cm-line').nth(3).click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.insertText('    echo more');
    // (At once, in the same frame: the bar has no hole while the page has not parsed the new text yet.)
    assert.deepStrictEqual(await marks(page), ['4 first', '5 mid', '6 mid', '7 last']);
    assert.deepStrictEqual(await until('the block of four rows, parsed', () => marks(page), (m) => m.length === 4), ['4 first', '5 mid', '6 mid', '7 last']);
    // Undo takes the row away at once as well.
    await page.keyboard.press('Control+z');
    assert.deepStrictEqual(await marks(page), BLOCK_4_6);
    await page.keyboard.press('Control+y');
    assert.deepStrictEqual(await marks(page), ['4 first', '5 mid', '6 mid', '7 last']);
    // The block closed with a `fi` line removed: the if goes on to the end of the text; typing a new line after the for.
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText('\nif x; then\n  y\nfi');
    await until('no block on the last line', () => marks(page), (m) => m.length === 3 && m[0].startsWith('10 '));
    assert.deepStrictEqual(await marks(page), ['10 first', '11 mid', '12 last']);
    await page.context().close();
  });

  it('applies a change of the setting at once, with no reload, keeps it, and is back to the default after a reset', async () => {
    const page = await open();
    await cursorToLine(page, 5);
    await until('the block', () => marks(page), (m) => m.length === 3);
    const control = await settingControl(page, 'blockOutline');
    assert.strictEqual(await control.inputValue(), 'bar');
    assert.deepStrictEqual(await control.locator('option').evaluateAll((os) => os.map((o) => (o as unknown as { value: string }).value)), ['bar', 'tint', 'off']);
    // At once: with the settings still open.
    await control.selectOption('tint');
    await until('the tint', () => paint(page, 5), (p) => /127/.test(p.shadow));
    assert.deepStrictEqual(await marks(page), BLOCK_4_6);
    await control.selectOption('off');
    await until('nothing', () => marks(page), (m) => m.length === 0);
    assert.strictEqual(JSON.parse(await page.evaluate('localStorage.getItem("bash-explainer-settings")') as string)['bashExplainer.blockOutline'], 'off');
    await page.locator('#settings-done').click();
    // Kept: after a reload it is still off, and a move of the cursor draws nothing.
    await page.reload();
    await until('the page', () => page.locator('.cm-content > .cm-line').count(), (n) => n > 20);
    await cursorToLine(page, 5);
    await page.keyboard.press('ArrowUp');
    assert.deepStrictEqual(await marks(page), []);
    assert.strictEqual(await (await settingControl(page, 'blockOutline')).inputValue(), 'off');
    await (await settingControl(page, 'blockOutline')).selectOption('bar');
    // Back to the default: the setting is not stored any more.
    assert.strictEqual(JSON.parse(await page.evaluate('localStorage.getItem("bash-explainer-settings")') as string)['bashExplainer.blockOutline'], undefined);
    await page.context().close();
  });

  it('draws exactly the mark of the mode after every switch of the setting: never both, and no style is added', async () => {
    const page = await open();
    await cursorToLine(page, 5);
    await until('the block', () => marks(page), (m) => m.length === 3);
    const control = await settingControl(page, 'blockOutline');
    const TINT = 'rgba(127, 127, 127, 0.09) 0px 0px 0px 1280px inset';  // (100vmax of a 1280 by 800 viewport)
    /** What line 5 draws: the exact shadow, and the bar's width, left and colour, or none. */
    const mark = async () => {
      return await page.evaluate(`(() => {
        const el = document.querySelectorAll('.cm-content > .cm-line')[4];
        const s = getComputedStyle(el), b = getComputedStyle(el, '::before');
        return { shadow: s.boxShadow, content: b.content, width: b.width, left: b.left, background: b.backgroundColor };
      })()`) as { shadow: string; content: string; width: string; left: string; background: string };
    };
    const BAR = (await mark());
    assert.strictEqual(BAR.shadow, 'none');
    assert.deepStrictEqual([BAR.content, BAR.width, BAR.left], ['""', '3px', '1px']);
    assert.strictEqual(BAR.background, 'color(srgb 0.231373 0.231373 0.231373 / 0.55)');  // (the editor's text colour at 55%, on the light theme)
    const bar = async (why: string) => { const m = await until(why, mark, (v) => v.shadow === 'none' && v.content === '""'); assert.deepStrictEqual(m, BAR, why); };
    const tint = async (why: string) => {
      const m = await until(why, mark, (v) => v.shadow !== 'none');
      assert.strictEqual(m.shadow, TINT, why);
      // (The pseudo-element is there, but draws nothing: no bar.)
      assert.strictEqual(m.background, 'rgba(0, 0, 0, 0)', why);
    };
    const rules = await ruleCount(page);
    await control.selectOption('tint');
    await tint('tint after bar');
    const both = await ruleCount(page);
    await control.selectOption('bar');
    await bar('bar after tint');
    await control.selectOption('tint');
    await tint('tint again');
    await control.selectOption('bar');
    await bar('bar again');
    await control.selectOption('off');
    await until('off', () => marks(page), (m) => m.length === 0);
    await control.selectOption('bar');
    await bar('bar after off');
    await control.selectOption('tint');
    await tint('tint before the reset');
    await page.locator('#settings-reset').click();
    await bar('bar after Reset to defaults');
    assert.deepStrictEqual(await marks(page), BLOCK_4_6);
    // The styles of both marks are in the page from the first switch on, and no switch adds one.
    assert.ok(rules <= both, `${rules} rules before, ${both} with both modes`);
    assert.strictEqual(await ruleCount(page), both);
    await page.context().close();
  });

  // The mark moves nothing: the same cursor and selection, the lines, the characters, the gutters, the selection, the
  // active line and the scrolling are the same with the mark and without.
  const places: Array<[string, Open]> = [
    ['with long lines wrapped', {}],
    ['without wrapping (the long line scrolls sideways)', { wrap: false }],
    ['with classic scrollbars', { browser: undefined }],
    ['at a phone\'s width, with the settings sheet', { width: 390 }],
    ['at a phone\'s width, without wrapping', { width: 390, wrap: false }],
  ];
  for (const [where, o] of places) {
    it(`moves nothing ${where}`, async function () {
      const classic = where.includes('classic') ? await classicScrollbars(this) : undefined;
      const page = await open({ ...o, ...(classic ? { browser: classic } : {}) });
      // The cursor on a row inside the if, and a selection over rows of the block.
      await cursorToLine(page, 4);
      await page.keyboard.press('Home');
      await page.keyboard.down('Shift');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.up('Shift');
      await until('the selection drawn', () => page.locator('.cm-selectionBackground').count(), (n) => n > 0);
      await choose(page, 'off');
      const without = await layout(page);
      assert.deepStrictEqual(await marks(page), []);
      assert.ok(without.selection.length > 0 && without.activeLine, 'a selection and the active line are there to compare');
      for (const mode of ['bar', 'tint'] as const) {
        await choose(page, mode);
        await until('the block', () => marks(page), (m) => m.length > 0);
        assert.deepStrictEqual(await layout(page), without, mode);
        await choose(page, 'off');
      }
      if ((o.width ?? 1280) < 520) {
        // With the sheet open over the editor: the lines under it are where they are.
        await choose(page, 'off', false);
        assert.ok(await page.locator('#settings-dialog').isVisible());
        const under = await layout(page);
        for (const mode of ['bar', 'tint'] as const) {
          await choose(page, mode, false);
          await until('the block', () => marks(page), (m) => m.length > 0);
          assert.deepStrictEqual(await layout(page), under, `${mode}, sheet open`);
          await choose(page, 'off', false);
        }
      }
      await page.context().close();
    });
  }

  it('keeps a long line of the block in one block when it wraps: the mark spans all its rows', async () => {
    const page = await open({ width: 700 });
    await cursorToLine(page, 5);
    await until('the block', () => marks(page), (m) => m.length === 3);
    const box = await page.evaluate(`(() => { const l = document.querySelectorAll('.cm-content > .cm-line'); const r = (i) => l[i].getBoundingClientRect(); return { fiveHeight: r(4).height, rowHeight: parseFloat(getComputedStyle(l[0]).lineHeight), gap: r(4).top - r(3).bottom, gap2: r(5).top - r(4).bottom }; })()`) as { fiveHeight: number; rowHeight: number; gap: number; gap2: number };
    assert.ok(box.fiveHeight > box.rowHeight * 2, `the long line wraps: ${JSON.stringify(box)}`);
    // The bar of that line runs from its top to its bottom: the lines touch, so the bar is whole.
    assert.ok(Math.abs(box.gap) < 0.5 && Math.abs(box.gap2) < 0.5, JSON.stringify(box));
    await page.context().close();
  });
});
