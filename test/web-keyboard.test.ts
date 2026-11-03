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
 * it down by `by`: the keyboard's top is then lower in the window, by as much; or zoom the page by `scale` and scroll it
 * right by `left`); the window keeps its size. A grey box stands for the keyboard in screenshots.
 */
const IOS = `(() => {
  const vv = window.visualViewport;
  const proto = Object.getPrototypeOf(vv);
  const real = (name) => Object.getOwnPropertyDescriptor(proto, name).get.call(vv);
  let kb = 0;
  let top = 0;
  let zoom = 1;
  let side = 0;
  Object.defineProperty(vv, 'height', { get: () => (real('height') - kb) / zoom });
  Object.defineProperty(vv, 'width', { get: () => real('width') / zoom });
  Object.defineProperty(vv, 'offsetTop', { get: () => real('offsetTop') + top });
  Object.defineProperty(vv, 'offsetLeft', { get: () => real('offsetLeft') + side });
  Object.defineProperty(vv, 'scale', { get: () => zoom });
  window.keyboard = (px, by = 0, scale = 1, left = 0) => {
    kb = px;
    top = by;
    zoom = scale;
    side = left;
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

  /** The page on a phone, the read-mode tip closed (or kept: `tip`), the sample's problems counted, the cursor on line 20 (its pitfall). */
  const open = async (width: number, lang: 'en' | 'ja', more: BrowserContextOptions = {}, tip = false): Promise<Page> => {
    const ctx = await browser.newContext({ ...(await phone(width, lang)), ...more });
    await ctx.addInitScript(IOS);
    const page = await ctx.newPage();
    await page.goto(base);
    await page.locator('.cm-line').nth(5).waitFor();
    if (!tip && (await page.locator('#readtip').isVisible())) await page.locator('#readtip-close').tap();
    await until('the sample\'s problems', () => problemsShown(page), (v) => v, 20000);
    await cursorToLine(page, 20);
    await until('the row of line 20', () => page.locator('#summary-line').textContent(), (t) => t === (lang === 'ja' ? '行 20' : 'Ln 20'));
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
    // The row says the line: there is no tabs row to say it.
    assert.strictEqual(await page.locator('#summary-line').isVisible(), true, where);
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
      assert.strictEqual(await page.locator('#sheet-summary').getAttribute('aria-label'), lang === 'ja' ? `行 20：警告。${text}` : `Line 20: Warning. ${text}`);
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

  /** Opens the keyboard over the editor, as `how` does. */
  const keyboardOn = async (page: Page, how: 'iOS' | 'Android') => {
    if (how === 'iOS') await page.evaluate(`window.keyboard(${KEYBOARD})`);
    else await page.setViewportSize({ width: 390, height: HEIGHT - KEYBOARD });
  };

  it('shows the explanation on a tap of the row, whichever tab was chosen, at the peek and with the keyboard open', async () => {
    const selected = (page: Page) => page.evaluate("[...document.querySelectorAll('#panel-tabs [role=tab]')].filter((t) => t.getAttribute('aria-selected') === 'true').map((t) => t.id)");
    for (const tab of ['tab-problems', 'tab-ref']) {
      for (const how of ['peek', 'iOS', 'Android'] as const) {
        const where = `${tab}, ${how}`;
        const page = await open(390, 'en');
        await page.locator(`#${tab}`).tap();
        await until(`${where}: the tab`, () => selected(page), (v) => JSON.stringify(v) === JSON.stringify([tab]));
        if (how === 'peek') {
          await page.locator('#sheet-grab').focus();
          await page.keyboard.press('Home');
          await until(`${where}: the row`, () => page.locator('#sheet-summary').isVisible(), (v) => v);
        } else {
          await cursorToLine(page, 20);
          await keyboardOn(page, how);
          await folded(page, HEIGHT - KEYBOARD, where);
        }
        await page.locator('#sheet-summary').tap();
        await until(`${where}: the Explanation tab`, () => selected(page), (v) => JSON.stringify(v) === '["tab-explain"]');
        const after = await state(page);
        assert.deepStrictEqual([after.sheet, after.keyboard, after.inEditor, after.focus], ['half', false, false, 'sheet-grab'], where);
        assert.strictEqual(await page.locator('#panel-body').isVisible(), true, where);
        assert.strictEqual(await page.locator('#panel-pane').getAttribute('data-problems'), null, where);
        await page.context().close();
      }
    }
  });

  it('takes a window short for another reason for no keyboard: resized before the editor has the focus, then a real keyboard from there', async () => {
    const page = await open(390, 'en');
    // Split screen, a foldable: the window shrinks while the focus is elsewhere.
    await page.locator('#sheet-grab').focus();
    await page.setViewportSize({ width: 390, height: 400 });
    await page.waitForTimeout(200);
    await cursorToLine(page, 20);
    await page.waitForTimeout(200);
    assert.strictEqual((await state(page)).keyboard, false);
    assert.strictEqual(await page.locator('#panel-head').isVisible(), true);
    // A keyboard over that window folds it, and closing it with the focus kept brings the sheet back.
    await page.evaluate('window.keyboard(200)');
    await until('the keyboard', () => state(page), (v) => v.keyboard);
    const row = await box(page, '#sheet-summary');
    assert.ok(Math.abs(row.y + row.height - 200) < 1, JSON.stringify(row));
    await page.evaluate('window.keyboard(0)');
    await until('closed', () => state(page), (v) => !v.keyboard);
    assert.strictEqual((await state(page)).inEditor, true);
    await page.context().close();
  });

  it('goes on with F6 while the keyboard is open: the fold ends, and the focus lands on what is shown', async () => {
    // At half: the explanation's frame.
    let page = await open(390, 'en');
    await keyboardOn(page, 'iOS');
    await folded(page, HEIGHT - KEYBOARD, 'F6 at half');
    await page.keyboard.press('F6');
    await until('the frame', () => state(page), (v) => v.focus === 'panel');
    assert.deepStrictEqual(await state(page), { sheet: 'half', keyboard: false, inEditor: false, focus: 'panel' });
    assert.strictEqual(await page.locator('#panel-body').isVisible(), true);
    await page.context().close();
    // Folded: the grabber, with the tabs row back.
    page = await open(390, 'en');
    await page.locator('#sheet-grab').focus();
    await page.keyboard.press('Home');
    await cursorToLine(page, 20);
    await keyboardOn(page, 'iOS');
    await folded(page, HEIGHT - KEYBOARD, 'F6 at the peek');
    await page.keyboard.press('F6');
    await until('the grabber', () => state(page), (v) => v.focus === 'sheet-grab');
    assert.deepStrictEqual(await state(page), { sheet: 'peek', keyboard: false, inEditor: false, focus: 'sheet-grab' });
    assert.strictEqual(await page.locator('#panel-head').isVisible(), true);
    await page.context().close();
  });

  it('keeps the row along the visual viewport of a zoomed page (iOS zooms into a small field), whole and at its own size', async () => {
    const page = await open(390, 'en');
    // Zoomed by 1.25, scrolled by (20, 40): the visual viewport is 312 × 352 at (20, 40).
    await page.evaluate(`window.keyboard(${KEYBOARD}, 40, 1.25, 20)`);
    await until('the keyboard', () => state(page), (v) => v.keyboard);
    const row = await stable('the row', () => box(page, '#sheet-summary'));
    const close = (a: number, b: number) => Math.abs(a - b) < 1;
    assert.ok(close(row.x, 20) && close(row.width, 312) && close(row.height, 48 / 1.25) && close(row.y + row.height, 40 + 352), JSON.stringify(row));
    const end = await box(page, '#sheet-summary .chev');
    assert.ok(end.x + end.width <= 332 - 12 / 1.25 + 0.5, JSON.stringify(end));
    await page.context().close();
  });

  it('folds at once with motion on, at the first open and the next: the sheet never lies over the editor on the keyboard\'s top', async () => {
    const page = await open(390, 'en', { reducedMotion: 'no-preference' });
    const openNow = `(() => { window.keyboard(${KEYBOARD}); const r = document.getElementById('panel-pane').getBoundingClientRect(); return { top: r.top, height: r.height }; })()`;
    for (const round of ['first', 'second', 'third']) {
      const at = await page.evaluate(openNow) as { top: number; height: number };
      assert.ok(Math.abs(at.height - 49) < 1 && Math.abs(at.top - (HEIGHT - KEYBOARD - 49)) < 1, `${round}: ${JSON.stringify(at)}`);
      await page.evaluate('window.keyboard(0)');
      await until(`${round}: closed`, () => box(page, '#panel-pane'), (b) => b.height > 300);
      await page.waitForTimeout(350);
    }
    await page.context().close();
  });

  it('says of a line what the Problems list says: a problem turned off in the script is not in the row', async () => {
    const page = await open(390, 'en');
    await page.locator('.cm-content').focus();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText('# bash-explainer disable=rm-empty-variable-root,unquoted-variable-as-path\nrm -rf $DIR/*\nrm -rf $DIR/*\n');
    await cursorToLine(page, 2);
    await until('the row of line 2', () => page.locator('#sheet-summary').getAttribute('aria-label'), (t) => !!t && t.startsWith('Line 2: ') && !t.includes('Warning'));
    assert.strictEqual(await page.locator('#summary-mark').textContent(), '');
    assert.match((await page.locator('#summary-text').textContent())!, /^Runs rm /);
    await page.context().close();
  });

  it('places the row by the layout viewport, also where a browser reports the visual viewport as the window\'s size', async () => {
    const page = await open(390, 'en');
    // (Safari is said to give innerWidth and innerHeight of the visual viewport on a zoomed page.)
    await page.evaluate(`(() => {
      Object.defineProperty(window, 'innerHeight', { configurable: true, get: () => Math.round(visualViewport.height) });
      Object.defineProperty(window, 'innerWidth', { configurable: true, get: () => Math.round(visualViewport.width) });
      window.keyboard(${KEYBOARD}, 40, 1.25, 20);
    })()`);
    await until('the keyboard', () => state(page), (v) => v.keyboard);
    const row = await stable('the row', () => box(page, '#sheet-summary'));
    assert.ok(Math.abs(row.y + row.height - (40 + 352)) < 1 && Math.abs(row.width - 312) < 1, JSON.stringify(row));
    await page.context().close();
  });

  it('says a new height once: on the row\'s Enter and tap, the grabber takes the focus first and says it', async () => {
    for (const how of ['Enter', 'tap'] as const) {
      const page = await open(390, 'en');
      await page.locator('#sheet-grab').focus();
      await page.keyboard.press('Home');
      await until('the peek', () => page.locator('#sheet-summary').isVisible(), (v) => v);
      await page.waitForTimeout(700);
      await page.evaluate(`(() => {
        const region = document.getElementById('announce');
        window.said = [];
        new MutationObserver(() => window.said.push(region.textContent)).observe(region, { childList: true, characterData: true, subtree: true });
      })()`);
      if (how === 'Enter') {
        await page.locator('#sheet-summary').focus();
        await page.keyboard.press('Enter');
      } else await page.locator('#sheet-summary').tap();
      assert.strictEqual((await state(page)).focus, 'sheet-grab', how);
      await page.waitForTimeout(100);
      assert.deepStrictEqual(await page.evaluate('window.said'), [], how);
      await page.context().close();
    }
  });

  it('stays folded on F6 when the focus cannot leave the editor: the Problems tab chosen, the frame hidden', async () => {
    const page = await open(390, 'en');
    await page.locator('#tab-problems').tap();
    await until('the tab', () => page.locator('#tab-problems').getAttribute('aria-selected'), (v) => v === 'true');
    await cursorToLine(page, 20);
    await keyboardOn(page, 'iOS');
    await folded(page, HEIGHT - KEYBOARD, 'Problems');
    await page.keyboard.press('F6');
    await page.waitForTimeout(100);
    const after = await state(page);
    assert.deepStrictEqual([after.inEditor, after.keyboard], [true, true]);
    await page.context().close();
  });

  it('sends Tab on to the grabber while the keyboard is open: the focus never falls to a hidden row or to the page', async () => {
    const page = await open(390, 'en');
    await keyboardOn(page, 'iOS');
    await folded(page, HEIGHT - KEYBOARD, 'Tab');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(100);
    // The next stop once the fold has ended: the sheet's grabber, shown.
    const at = await page.evaluate(`(() => { const e = document.activeElement; return { id: e.id, shown: e.checkVisibility({ visibilityProperty: true }) }; })()`);
    assert.deepStrictEqual(at, { id: 'sheet-grab', shown: true });
    assert.strictEqual((await state(page)).keyboard, false);
    await page.context().close();
  });

  it('keeps the read tip under Read as the strip moves up with the fold, with motion and without', async () => {
    for (const reducedMotion of ['reduce', 'no-preference'] as const) {
      const page = await open(390, 'en', { reducedMotion }, true);
      assert.strictEqual(await page.locator('#readtip').isVisible(), true, reducedMotion);
      await keyboardOn(page, 'iOS');
      await until('the keyboard', () => state(page), (v) => v.keyboard);
      await page.waitForTimeout(400);
      const [read, tip] = [await box(page, '#mode-read'), await box(page, '#readtip')];
      assert.ok(Math.abs(tip.y - (read.y + read.height + 10)) < 1.5, `${reducedMotion}: ${JSON.stringify([read, tip])}`);
      await page.context().close();
    }
  });

  it('leaves the editor where the reader scrolled it when the visual viewport pans; the cursor comes back when the fold starts', async () => {
    const page = await open(390, 'en');
    await keyboardOn(page, 'iOS');
    await folded(page, HEIGHT - KEYBOARD, 'pan');
    const scroller = page.locator('.cm-scroller');
    // (Far from the cursor's line, and from the end, where more room would move it.)
    await scroller.evaluate((e) => { e.scrollTop = 1500; });
    await page.waitForTimeout(150);
    const top = await scroller.evaluate((e) => e.scrollTop);
    await page.evaluate(`window.keyboard(${KEYBOARD}, 40)`);
    await page.waitForTimeout(200);
    assert.strictEqual(await scroller.evaluate((e) => e.scrollTop), top);
    // The keyboard closed and opened again: the cursor's line is back in view above the row.
    await page.evaluate('window.keyboard(0)');
    await until('closed', () => state(page), (v) => !v.keyboard);
    await page.evaluate(`window.keyboard(${KEYBOARD})`);
    await folded(page, HEIGHT - KEYBOARD, 'open again');
    await page.context().close();
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
        'button', lang === 'ja' ? `行 20：警告。${text}` : `Line 20: Warning. ${text}`, lang === 'ja' ? '解説を表示' : 'Show the explanation',
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
