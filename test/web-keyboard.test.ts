// The web page on a phone with its on-screen keyboard (docs/design/chrome-redesign.md, step C8b), run for real in
// headless Chromium with the CJK fonts of CI: while the user types in the editor, the app bar goes and the sheet folds to
// the summary row of the cursor's line, on the keyboard's top; a tap on the row shows the explanation at half and closes
// the keyboard. Both ways a browser shows a keyboard are emulated: iOS, where only the visual viewport shrinks (its API
// is stubbed, so this tests the page's wiring; the real keyboard is checked on devices, section 8), and Android, where
// the window shrinks. Whether the keyboard is open is src/ui/keyboard.ts (test/keyboard.test.ts); the row's text is
// src/ui/summaryRow.ts (test/summary-row.test.ts); the peek's boxes are in test/web-sheet.test.ts.
import * as assert from 'assert';
import type { Browser, BrowserContextOptions, Page } from 'playwright-core';
import { cursorToLine, openSite, problemsShown, stable, until } from './support/site';

type Box = { x: number; y: number; width: number; height: number };

/**
 * iOS's keyboard, as the page sees it: the visual viewport loses `px` of its height at the bottom (and Safari may scroll
 * it down by `by`: the keyboard's top is then lower in the window, by as much); the window keeps its size. A grey box stands for the keyboard in screenshots.
 */
const IOS = `(() => {
  const vv = window.visualViewport;
  const proto = Object.getPrototypeOf(vv);
  const height = Object.getOwnPropertyDescriptor(proto, 'height');
  const top = Object.getOwnPropertyDescriptor(proto, 'offsetTop');
  let kb = 0;
  let scroll = 0;
  Object.defineProperty(vv, 'height', { get: () => height.get.call(vv) - kb });
  Object.defineProperty(vv, 'offsetTop', { get: () => top.get.call(vv) + scroll });
  window.keyboard = (px, by = 0) => {
    kb = px;
    scroll = by;
    let box = document.getElementById('test-keyboard');
    if (!box) {
      box = Object.assign(document.createElement('div'), { id: 'test-keyboard' });
      box.style.cssText = 'position: fixed; left: 0; right: 0; bottom: 0; background: #888; pointer-events: none; z-index: 99';
      document.documentElement.append(box);
    }
    box.style.height = px + 'px';
    vv.dispatchEvent(new Event('resize'));
  };
})();`;

/** The keyboard's height in the emulations, and the window's. */
const KEYBOARD = 300;
const HEIGHT = 740;

describe('the web page: the phone\'s keyboard and the summary row', function () {
  this.timeout(240000);
  let browser: Browser;
  let base = '';

  before(async function () {
    ({ browser, base } = await openSite(this));
  });

  const phone = async (width: number, lang: 'en' | 'ja'): Promise<BrowserContextOptions> => ({
    ...(await import('playwright-core')).devices['iPhone 13'], viewport: { width, height: HEIGHT }, locale: lang === 'ja' ? 'ja-JP' : 'en-US', reducedMotion: 'reduce',
  });

  /** The page on a phone, the read-mode tip closed, the sample's problems counted, the cursor on line 20 (its pitfall). */
  const open = async (width: number, lang: 'en' | 'ja'): Promise<Page> => {
    const ctx = await browser.newContext(await phone(width, lang));
    await ctx.addInitScript(IOS);
    const page = await ctx.newPage();
    await page.goto(base);
    await page.locator('.cm-line').nth(5).waitFor();
    if (await page.locator('#readtip').isVisible()) await page.locator('#readtip-close').tap();
    await until('the sample\'s problems', () => problemsShown(page), (v) => v, 20000);
    await cursorToLine(page, 20);
    await until('the row of line 20', () => page.locator('#summary-line').textContent(), (t) => t === (lang === 'ja' ? '20 行目' : 'Ln 20'));
    return page;
  };

  const box = async (page: Page, selector: string): Promise<Box> => {
    const b = (await page.locator(selector).boundingBox())!;
    return { x: Math.round(b.x * 10) / 10, y: Math.round(b.y * 10) / 10, width: Math.round(b.width * 10) / 10, height: Math.round(b.height * 10) / 10 };
  };

  const state = (page: Page) => page.evaluate(`({
    sheet: document.documentElement.dataset.sheet,
    keyboard: document.documentElement.dataset.keyboard !== undefined,
    inEditor: !!document.activeElement.closest('.cm-editor'),
    focus: document.activeElement.id,
  })`) as Promise<{ sheet: string; keyboard: boolean; inEditor: boolean; focus: string }>;

  /** The summary row folded on the keyboard's top (`top`, in the window), the app bar gone, the cursor's line in view above the row. */
  const folded = async (page: Page, top: number, where: string) => {
    await until(`${where}: the keyboard`, () => state(page), (s) => s.keyboard);
    const row = await stable('the row', () => box(page, '#sheet-summary'));
    const pane = await box(page, '#panel-pane');
    assert.ok(Math.abs(row.y + row.height - top) < 1 && Math.abs(row.height - 48) < 0.5 && Math.abs(pane.y - (row.y - 1)) < 1, `${where}: ${JSON.stringify([row, pane])}`);
    // No tabs row; the app bar is out of view and out of the focus order; the strip stays at the top.
    assert.strictEqual(await page.locator('#panel-head').isVisible(), false, where);
    const bar = await box(page, 'header.top');
    assert.ok(bar.y + bar.height <= 0.5 && await page.evaluate("document.querySelector('header.top').inert"), `${where}: ${JSON.stringify(bar)}`);
    const strip = await box(page, '#ed-head');
    assert.ok(Math.abs(strip.y) < 0.5, `${where}: ${JSON.stringify(strip)}`);
    // The cursor's line, between the strip and the row.
    const line = await box(page, '.cm-activeLine');
    assert.ok(line.y >= strip.y + strip.height - 0.5 && line.y + line.height <= row.y + 0.5, `${where}: ${JSON.stringify([strip, line, row])}`);
    // The focus stays in the editor while the user types.
    assert.strictEqual((await state(page)).inEditor, true, where);
    return row;
  };

  it('folds the sheet to the summary row on iOS\'s keyboard (the visual viewport shrinks), and comes back as it was when it closes', async () => {
    for (const lang of ['en', 'ja'] as const) {
      const page = await open(390, lang);
      const half = await box(page, '#panel-pane');
      assert.strictEqual((await state(page)).sheet, 'half');
      await page.evaluate(`window.keyboard(${KEYBOARD})`);
      await folded(page, HEIGHT - KEYBOARD, `iOS ${lang}`);
      // The row says the line's first problem, with its level's mark in its colour; its name says it all.
      assert.strictEqual(await page.locator('#summary-mark').textContent(), '⚠');
      assert.match(await page.locator('#summary-mark').getAttribute('class') ?? '', /level-warning/);
      const text = (await page.locator('#summary-text').textContent())!;
      assert.ok(text.startsWith(lang === 'ja' ? '落とし穴: ' : 'Pitfall: '), text);
      assert.strictEqual(await page.locator('#sheet-summary').getAttribute('aria-label'), lang === 'ja' ? `20 行目：警告。${text}` : `Line 20: Warning. ${text}`);
      // Safari scrolls the visual viewport to the caret: the row follows the keyboard's top, 40 px lower in the window.
      await page.evaluate(`window.keyboard(${KEYBOARD}, 40)`);
      await folded(page, HEIGHT - KEYBOARD + 40, `iOS ${lang}, scrolled`);
      await page.evaluate(`window.keyboard(${KEYBOARD})`);
      await folded(page, HEIGHT - KEYBOARD, `iOS ${lang}`);
      // Closed with the system's button (the focus stays in the editor): the sheet is back at half, and the app bar.
      await page.evaluate('window.keyboard(0)');
      await until(`iOS ${lang}: closed`, () => state(page), (s) => !s.keyboard && s.sheet === 'half');
      assert.deepStrictEqual(await stable('the sheet', () => box(page, '#panel-pane')), half);
      assert.ok((await box(page, 'header.top')).y >= 0);
      await page.context().close();
    }
  });

  it('folds the sheet to the summary row on Android\'s keyboard (the window shrinks)', async () => {
    for (const [width, lang] of [[390, 'en'], [360, 'ja']] as const) {
      const page = await open(width, lang);
      await page.setViewportSize({ width, height: HEIGHT - KEYBOARD });
      await folded(page, HEIGHT - KEYBOARD, `Android ${width} ${lang}`);
      await page.setViewportSize({ width, height: HEIGHT });
      await until(`Android ${lang}: closed`, () => state(page), (s) => !s.keyboard && s.sheet === 'half');
      await page.context().close();
    }
  });

  it('shows the explanation at half on a tap of the row, and closes the keyboard: no focus is left in the editor', async () => {
    for (const how of ['iOS', 'Android'] as const) {
      const page = await open(390, 'en');
      // From the peek: the sheet comes back at half, not folded.
      await page.locator('#sheet-grab').focus();
      await page.keyboard.press('Home');
      await cursorToLine(page, 20);
      if (how === 'iOS') await page.evaluate(`window.keyboard(${KEYBOARD})`);
      else await page.setViewportSize({ width: 390, height: HEIGHT - KEYBOARD });
      await folded(page, HEIGHT - KEYBOARD, how);
      await page.locator('#sheet-summary').tap();
      // (The browser takes the keyboard away once the editor has lost the focus.)
      if (how === 'iOS') await page.evaluate('window.keyboard(0)');
      else await page.setViewportSize({ width: 390, height: HEIGHT });
      const after = await until(`${how}: half`, () => state(page), (s) => s.sheet === 'half' && !s.keyboard);
      assert.deepStrictEqual(after, { sheet: 'half', keyboard: false, inEditor: false, focus: 'sheet-grab' }, how);
      assert.strictEqual(await page.evaluate("document.querySelector('.cm-editor').classList.contains('cm-focused')"), false, how);
      // The explanation of line 20 shows; the row is gone with the peek.
      assert.strictEqual(await page.locator('#tab-explain').getAttribute('aria-selected'), 'true');
      assert.strictEqual(await page.locator('#sheet-summary').isVisible(), false);
      await page.context().close();
    }
  });

  it('does not fold for a keyboard of another field, in Read mode, or for the browser\'s bars', async () => {
    const page = await open(390, 'en');
    // The browser's bar shown again: less than a keyboard.
    await page.setViewportSize({ width: 390, height: HEIGHT - 60 });
    await page.waitForTimeout(300);
    assert.strictEqual((await state(page)).keyboard, false);
    await page.setViewportSize({ width: 390, height: HEIGHT });
    // The focus out of the editor (the grabber): a keyboard there is not the editor's.
    await page.locator('#sheet-grab').focus();
    await page.evaluate(`window.keyboard(${KEYBOARD})`);
    await page.waitForTimeout(300);
    assert.strictEqual((await state(page)).keyboard, false);
    await page.evaluate('window.keyboard(0)');
    // Read mode: a tap places the cursor, and the editor takes no text.
    await page.locator('#mode-read').tap();
    await page.locator('.cm-line').nth(3).tap();
    await page.evaluate(`window.keyboard(${KEYBOARD})`);
    await page.waitForTimeout(300);
    assert.strictEqual((await state(page)).keyboard, false);
    await page.context().close();
  });

  it('is a named button in the Tab order of the folded sheet: Enter shows the explanation on the grabber, Escape goes back to the editor', async () => {
    for (const lang of ['en', 'ja'] as const) {
      const page = await open(390, lang);
      await page.locator('#sheet-grab').focus();
      await page.keyboard.press('Home');
      await until('the peek', () => page.locator('#sheet-summary').isVisible(), (v) => v);
      // After the tabs row's controls (the grabber, the tab chosen, the view's pill).
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      assert.strictEqual((await state(page)).focus, 'sheet-summary', lang);
      const cdp = await page.context().newCDPSession(page);
      const { root } = await cdp.send('DOM.getDocument');
      const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#sheet-summary' });
      const { nodes } = await cdp.send('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false });
      await cdp.detach();
      const text = (await page.locator('#summary-text').textContent())!;
      assert.deepStrictEqual([nodes[0].role?.value, nodes[0].name?.value, nodes[0].description?.value], [
        'button', lang === 'ja' ? `20 行目：警告。${text}` : `Line 20: Warning. ${text}`, lang === 'ja' ? '解説を表示' : 'Show the explanation',
      ]);
      // Escape: the focus back in the editor, the sheet as it was.
      await page.keyboard.press('Escape');
      assert.deepStrictEqual(await state(page), { sheet: 'peek', keyboard: false, inEditor: true, focus: '' });
      // Enter: the explanation at half, the focus on the grabber (the row goes).
      await page.locator('#sheet-summary').focus();
      await page.keyboard.press('Enter');
      assert.deepStrictEqual(await state(page), { sheet: 'half', keyboard: false, inEditor: false, focus: 'sheet-grab' });
      await page.context().close();
    }
  });
});
