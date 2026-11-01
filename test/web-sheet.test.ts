// The web page on a phone: the explanation as a bottom sheet over the editor (docs/design/chrome-redesign.md, step C8a),
// run for real in headless Chromium with the CJK fonts of CI. Its heights and where a drag, a tap or a key leaves it
// are src/ui/sheet.ts (test/sheet.test.ts); here the page measures, draws and wires them: the header row's boxes at
// every height and tab, a finger's drag (touch events, as a phone sends them), the taps, the keys, the focus, the app
// bar at full height, the toast above the sheet, the editor's cursor in view, and reduced motion.
import * as assert from 'assert';
import type { Browser, BrowserContextOptions, CDPSession, Page } from 'playwright-core';
import { frames, openSite, problemsShown, stable, until } from './support/site';

type Snap = 'peek' | 'half' | 'full';
type Box = { x: number; y: number; width: number; height: number };

describe('the web page: the phone\'s sheet', function () {
  this.timeout(240000);
  let browser: Browser;
  let base = '';

  before(async function () {
    ({ browser, base } = await openSite(this));
  });

  const phone = async (width: number, lang: 'en' | 'ja', more: BrowserContextOptions = {}): Promise<BrowserContextOptions> => ({
    ...(await import('playwright-core')).devices['iPhone 13'], viewport: { width, height: 740 }, locale: lang === 'ja' ? 'ja-JP' : 'en-US', ...more,
  });

  /** The page on a phone, the read-mode tip closed and the sample's problems counted. */
  const open = async (options: BrowserContextOptions, init?: string): Promise<Page> => {
    const ctx = await browser.newContext(options);
    if (init) await ctx.addInitScript(init);
    const page = await ctx.newPage();
    await page.goto(base);
    await page.locator('.cm-line').nth(5).waitFor();
    if (await page.locator('#readtip').isVisible()) await page.locator('#readtip-close').tap();
    await until('the sample\'s problems', () => problemsShown(page), (v) => v, 20000);
    return page;
  };

  const box = async (page: Page, selector: string): Promise<Box> => {
    const b = (await page.locator(selector).boundingBox())!;
    return { x: Math.round(b.x * 10) / 10, y: Math.round(b.y * 10) / 10, width: Math.round(b.width * 10) / 10, height: Math.round(b.height * 10) / 10 };
  };

  /** Waits until the sheet has stopped moving, and gives its height's name and box. */
  const settled = async (page: Page) => {
    const pane = await stable('the sheet', () => box(page, '#panel-pane'), 4);
    return { snap: (await page.evaluate('document.documentElement.dataset.sheet')) as Snap, pane };
  };

  /** Moves the sheet to a height from the keyboard, on its grabber (Home is the peek, then ↑ one height each). */
  const snapTo = async (page: Page, snap: Snap) => {
    await page.locator('#sheet-grab').focus();
    await page.keyboard.press('Home');
    for (let i = 0; i < ['peek', 'half', 'full'].indexOf(snap); i++) await page.keyboard.press('ArrowUp');
    const s = await settled(page);
    assert.strictEqual(s.snap, snap);
    return s.pane;
  };

  /** The header row's controls (the tabs, the view control's pill) and the strip's above the editor. */
  const ROW = ['#tab-explain', '#tab-problems', '#tab-ref', '#view-slot'];
  const STRIP = ['#mode-read', '#mode-edit', '#scope-chip', '#ed-more'];

  it('has one 48 px row at every height and tab, with the same boxes, 44 px controls and no horizontal scroll: 320 to 430 px, en and ja, and 130% text', async () => {
    const cases: [number, 'en' | 'ja', number][] = [];
    for (const width of [320, 360, 390, 430]) for (const lang of ['en', 'ja'] as const) cases.push([width, lang, 1]);
    cases.push([300, 'en', 1.3], [300, 'ja', 1.3]);
    for (const [width, lang, scale] of cases) {
      const where = `${width}px ${lang}${scale === 1 ? '' : ` ${scale * 100}%`}`;
      const page = await open(await phone(width, lang, { reducedMotion: 'reduce' }), scale === 1 ? undefined : `document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = '${scale * 100}%'; })`);
      const row = async () => Promise.all(ROW.map((s) => box(page, s)));
      let first: Box[] | undefined;
      for (const [snap, tab] of [['half', 'explain'], ['full', 'explain'], ['peek', 'explain'], ['half', 'problems'], ['half', 'ref'], ['full', 'problems'], ['half', 'explain']] as [Snap, string][]) {
        const pane = await snapTo(page, snap);
        if ((await page.locator(`#tab-${tab}`).getAttribute('aria-selected')) !== 'true') {
          await page.locator(`#tab-${tab}`).click();
          await until(`the tab ${tab}`, () => page.locator(`#tab-${tab}`).getAttribute('aria-selected'), (v) => v === 'true');
          await settled(page);
        }
        const at = `${where}, ${snap}, ${tab}`;
        const head = await box(page, '#panel-head');
        assert.ok(Math.abs(head.height - 48) < 0.5, `${at}: the row is ${head.height} px`);
        const boxes = await row();
        // The same place in the row at every height and tab (its top moves with the sheet).
        const shape = boxes.map((b) => ({ x: b.x, width: b.width, height: b.height, dy: Math.round((b.y - head.y) * 10) / 10 }));
        first ??= shape as unknown as Box[];
        assert.deepStrictEqual(shape, first, at);
        for (const [i, b] of boxes.entries()) assert.ok(b.height >= 44 && b.x >= 0 && b.x + b.width <= width + 0.5, `${at}: ${ROW[i]} ${JSON.stringify(b)}`);
        const fit = await page.evaluate("[document.documentElement.scrollWidth <= document.documentElement.clientWidth, document.getElementById('panel-head').scrollWidth <= document.getElementById('panel-head').clientWidth]");
        assert.deepStrictEqual(fit, [true, true], at);
        for (const s of STRIP) {
          const b = await box(page, s);
          assert.ok(b.height >= 44 && b.width >= 44 && b.x >= 0 && b.x + b.width <= width + 0.5, `${at}: ${s} ${JSON.stringify(b)}`);
        }
        // The app bar slides away at full height (and leaves the focus order), and is back below it.
        const bar = await box(page, 'header.top');
        const inert = await page.evaluate("document.querySelector('header.top').inert");
        const strip = await box(page, '#ed-head');
        if (snap === 'full') {
          assert.ok(bar.y + bar.height <= 0.5 && inert && Math.abs(pane.y - (strip.y + strip.height)) < 1.5, `${at}: ${JSON.stringify([bar, strip, pane])}`);
        } else {
          assert.ok(bar.y >= 0 && !inert && pane.y > strip.y + strip.height, `${at}: ${JSON.stringify([bar, pane])}`);
        }
        if (snap === 'peek') assert.ok(Math.abs(pane.height - 49) < 1 && Math.round(pane.y + pane.height) === 740, `${at}: ${JSON.stringify(pane)}`);
      }
      // The desktop strip under the editor is not shown: Problems is a tab.
      assert.strictEqual(await page.locator('.problems-strip').isVisible(), false, where);
      await page.context().close();
    }
  });

  /** A finger on the screen, as a phone sends it: touch events through the browser's input (pointer events of type touch). */
  const finger = (cdp: CDPSession, page: Page) => async (x: number, from: number, to: number, ms: number, steps = 10, middle?: () => Promise<void>) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: from }] });
    for (let i = 1; i <= steps; i++) {
      await page.waitForTimeout(ms / steps);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: from + ((to - from) * i) / steps }] });
      if (i === Math.floor(steps / 2)) await middle?.();
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };

  it('follows a finger on its header, and settles on a height from where it is let go and how fast', async () => {
    const page = await open(await phone(390, 'en'));
    const cdp = await page.context().newCDPSession(page);
    const drag = finger(cdp, page);
    let pane = (await settled(page)).pane;
    // Half of 740 px, at first.
    assert.ok(Math.abs(pane.height - 407) < 1, JSON.stringify(pane));
    // Slowly up by 250 px: it follows the finger, and lets go nearer full than half.
    await drag(6, pane.y + 24, pane.y + 24 - 250, 1000, 10, async () => {
      await frames(page);
      const h = (await box(page, '#panel-pane')).height;
      assert.ok(Math.abs(h - (407 + 125)) < 3, `mid-drag: ${h}`);
    });
    let s = await settled(page);
    assert.deepStrictEqual([s.snap, Math.round(s.pane.y + s.pane.height)], ['full', 740]);
    // Slowly down by 100 px from half: back to half; by 300 px: the peek.
    await snapTo(page, 'half');
    pane = (await settled(page)).pane;
    await drag(6, pane.y + 24, pane.y + 124, 1000);
    assert.strictEqual((await settled(page)).snap, 'half');
    await drag(6, pane.y + 24, pane.y + 324, 1000);
    assert.strictEqual((await settled(page)).snap, 'peek');
    // A quick flick of 60 px goes to the next height that way: up from half to full, down from full to half.
    await snapTo(page, 'half');
    pane = (await settled(page)).pane;
    await drag(6, pane.y + 24, pane.y - 36, 50, 3);
    assert.strictEqual((await settled(page)).snap, 'full');
    pane = (await settled(page)).pane;
    await drag(6, pane.y + 24, pane.y + 84, 50, 3);
    assert.strictEqual((await settled(page)).snap, 'half');
    // A drag that starts on a tab moves the sheet and does not choose the tab.
    pane = (await settled(page)).pane;
    const ref = await box(page, '#tab-ref');
    await drag(ref.x + ref.width / 2, ref.y + 24, ref.y + 324, 1000);
    assert.strictEqual((await settled(page)).snap, 'peek');
    assert.strictEqual(await page.locator('#tab-explain').getAttribute('aria-selected'), 'true');
    // The view control's pill (a menu here) opens its options upwards on a folded sheet, inside the window; the height stays.
    await page.locator('#slot-open').tap();
    const options = await box(page, '#slot-tree');
    const pill = await box(page, '#slot-open');
    assert.ok(options.y + options.height <= pill.y && options.y >= 0 && options.x + options.width <= 390.5, JSON.stringify([options, pill]));
    assert.strictEqual((await settled(page)).snap, 'peek');
    // The sheet keeps its scroll inside: dragging it does not pull the page.
    assert.strictEqual(await page.evaluate("getComputedStyle(document.getElementById('panel-pane')).overscrollBehaviorY"), 'contain');
    assert.strictEqual(await page.evaluate('scrollY'), 0);
    await page.context().close();
  });

  it('cycles its heights on a tap of the header or of the tab chosen, and opens to show another tab', async () => {
    const page = await open(await phone(390, 'ja'));
    const tapAt = async (x: number) => {
      const head = await box(page, '#panel-head');
      await page.touchscreen.tap(x, head.y + 30);
      return (await settled(page)).snap;
    };
    // The header around the tabs (its edge), and the tab already chosen.
    assert.strictEqual((await settled(page)).snap, 'half');
    assert.strictEqual(await tapAt(5), 'full');
    assert.strictEqual(await tapAt(5), 'peek');
    const explain = await box(page, '#tab-explain');
    assert.strictEqual(await tapAt(explain.x + explain.width / 2), 'half');
    assert.strictEqual(await tapAt(explain.x + explain.width / 2), 'full');
    // Another tab: chosen, and the height stays; on a folded sheet, the sheet opens to half.
    const problems = await box(page, '#tab-problems');
    assert.strictEqual(await tapAt(problems.x + problems.width / 2), 'full');
    assert.strictEqual(await page.locator('#tab-problems').getAttribute('aria-selected'), 'true');
    await snapTo(page, 'peek');
    assert.strictEqual(await tapAt(explain.x + explain.width / 2), 'half');
    assert.strictEqual(await page.locator('#tab-explain').getAttribute('aria-selected'), 'true');
    await page.context().close();
  });

  it('moves with the keys on its grabber, says its height, keeps the focus off what it hides, and shows its hint once', async () => {
    const page = await open(await phone(390, 'en'));
    const grab = page.locator('#sheet-grab');
    // In the Tab order before the tabs; named by its height.
    await page.locator('#tab-explain').focus();
    await page.keyboard.press('Shift+Tab');
    assert.strictEqual(await page.evaluate('document.activeElement.id'), 'sheet-grab');
    assert.strictEqual(await grab.getAttribute('aria-label'), 'Explanation height: Half');
    assert.strictEqual(await page.locator('#sheet-hint').isVisible(), false);
    await page.keyboard.press('ArrowUp');
    assert.strictEqual((await settled(page)).snap, 'full');
    assert.strictEqual(await grab.getAttribute('aria-label'), 'Explanation height: Full');
    // The first full sheet: the hint, once.
    assert.strictEqual(await page.locator('#sheet-hint').isVisible(), true);
    assert.match(await page.locator('#sheet-hint').innerText(), /Tap or drag this bar/);
    // At full, the editor is out of the focus order; at the peek, the explanation is.
    assert.deepStrictEqual(await page.evaluate("[document.getElementById('editor').inert, document.getElementById('panel-body').inert]"), [true, false]);
    await page.keyboard.press('Home');
    assert.strictEqual((await settled(page)).snap, 'peek');
    assert.strictEqual(await page.locator('#sheet-hint').isVisible(), false);
    assert.deepStrictEqual(await page.evaluate("[document.getElementById('editor').inert, document.getElementById('panel-body').inert, document.getElementById('problems').inert]"), [false, true, true]);
    // Enter cycles; the focus stays on the grabber.
    await page.keyboard.press('Enter');
    assert.strictEqual((await settled(page)).snap, 'half');
    await page.keyboard.press('End');
    assert.strictEqual((await settled(page)).snap, 'full');
    assert.strictEqual(await page.locator('#sheet-hint').isVisible(), false, 'shown once');
    assert.strictEqual(await page.evaluate('document.activeElement.id'), 'sheet-grab');
    // The focus in the editor when the sheet goes full: on the grabber, never on the page's body.
    await page.keyboard.press('ArrowDown');
    await page.locator('.cm-content').focus();
    await page.evaluate("document.getElementById('sheet-grab').dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))");
    assert.strictEqual((await settled(page)).snap, 'full');
    assert.strictEqual(await page.evaluate('document.activeElement.id'), 'sheet-grab');
    // Not again after a reload.
    await page.reload();
    await page.locator('.cm-line').first().waitFor();
    await snapTo(page, 'full');
    assert.strictEqual(await page.locator('#sheet-hint').isVisible(), false);
    await page.context().close();

    // Without storage: the hint shows once in the page, and nothing throws.
    const bare = await open(await phone(360, 'ja'), 'Object.defineProperty(window, "localStorage", { get() { throw new Error("no storage"); } })');
    const errors: string[] = [];
    bare.on('pageerror', (e) => errors.push(e.message));
    await snapTo(bare, 'full');
    assert.match(await bare.locator('#sheet-hint').innerText(), /このバーを/);
    assert.strictEqual(await bare.locator('#sheet-grab').getAttribute('aria-label'), '解説の高さ: 全体');
    await snapTo(bare, 'half');
    await snapTo(bare, 'full');
    assert.strictEqual(await bare.locator('#sheet-hint').isVisible(), false);
    assert.deepStrictEqual(errors, []);
    await bare.context().close();
  });

  it('has Problems as a tab, with its counts by level: a problem chosen goes to its line, with its explanation at half height', async () => {
    const page = await open(await phone(390, 'en'));
    const tab = page.locator('#tab-problems');
    assert.match((await tab.getAttribute('aria-label'))!, /^Problems: \d+ errors?, \d+ warnings?, \d+ /);
    assert.match(await tab.innerText(), /^ⓧ\s*\d+\s*⚠\s*\d+\s*ⓘ\s*\d+$/);
    assert.match(await page.locator('#tab-explain').innerText(), /^Explanation\s*Ln \d+$/);
    // The tabs as one Tab stop: the arrows reach Problems, which shows the list in the sheet.
    await page.locator('#tab-explain').focus();
    await page.keyboard.press('ArrowRight');
    assert.strictEqual(await tab.getAttribute('aria-selected'), 'true');
    assert.deepStrictEqual(await page.evaluate("[document.getElementById('problems').getAttribute('role'), document.getElementById('panel-pane').contains(document.getElementById('problems')), document.getElementById('panel-body').getClientRects().length]"), ['tabpanel', true, 0]);
    await snapTo(page, 'full');
    const row = page.locator('#problem-list .problem').nth(1);
    const line = Number((await row.locator('.where').innerText()).replace(/\D/g, ''));
    await row.focus();
    await page.keyboard.press('Enter');
    assert.strictEqual((await settled(page)).snap, 'half');
    assert.strictEqual(await page.locator('#tab-explain').getAttribute('aria-selected'), 'true');
    await until('the line', () => page.locator('#tab-explain .tab-line').innerText(), (t) => t === `Ln ${line}`);
    // The line shows above the sheet.
    const active = await box(page, '.cm-activeLine');
    const pane = (await settled(page)).pane;
    assert.ok(active.y + active.height <= pane.y && active.y >= (await box(page, '#editor')).y - 0.5, JSON.stringify([active, pane]));
    await page.context().close();
  });

  it('keeps the cursor\'s line above the sheet as it moves, and the toast above its tabs row', async () => {
    const page = await open(await phone(390, 'en'));
    await page.locator('#mode-read').tap();
    // A line low in the editor, tapped at half: the line stays in view at every height below full.
    await page.locator('.cm-line').nth(12).tap();
    for (const snap of ['peek', 'half', 'peek', 'half'] as Snap[]) {
      const pane = await snapTo(page, snap);
      const active = await box(page, '.cm-activeLine');
      const editor = await box(page, '#editor');
      assert.ok(active.y >= editor.y - 0.5 && active.y + active.height <= pane.y + 0.5, `${snap}: ${JSON.stringify([active, editor, pane])}`);
    }
    // A toast (Copy as Markdown, from the menu while the row has no room for the tools) lies just above the sheet's top.
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base.slice(0, -1) });
    assert.strictEqual(await page.locator('#copy-md').isVisible(), false);
    for (const snap of ['half', 'peek', 'full'] as Snap[]) {
      const pane = await snapTo(page, snap);
      await page.locator(snap === 'full' ? '#ed-more' : '#menu-open').tap();
      if (snap === 'full') {
        await page.keyboard.press('Escape');
        await page.locator('#sheet-grab').focus();
        await page.keyboard.press('ArrowDown');
        await settled(page);
        await page.locator('#menu-open').tap();
      }
      await page.locator('#menu-copy-md').tap();
      const toast = await stable('the toast', () => box(page, '#status'));
      const now = (await settled(page)).pane;
      // (At full the room above the sheet is only the strip: the toast stays in the window, over the tabs row at most.)
      if (snap === 'full') assert.ok(toast.y >= 0 && toast.y + toast.height <= now.y + 48, `${snap}: ${JSON.stringify([toast, now, pane])}`);
      else assert.ok(toast.y + toast.height <= now.y && now.y - (toast.y + toast.height) <= 16, `${snap}: ${JSON.stringify([toast, now, pane])}`);
      assert.match(await page.evaluate('navigator.clipboard.readText()') as string, /`/);
    }
    await page.context().close();
  });

  it('moves the sheet and the app bar without animation with reduced motion, and with one otherwise', async () => {
    for (const motion of ['reduce', 'no-preference'] as const) {
      const page = await open(await phone(390, 'en', { reducedMotion: motion }));
      const durations = () => page.evaluate("[getComputedStyle(document.getElementById('panel-pane')).transitionDuration, getComputedStyle(document.querySelector('header.top')).transitionDuration]");
      assert.deepStrictEqual(await durations(), motion === 'reduce' ? ['0s', '0s'] : ['0.25s', '0.25s'], motion);
      // At once, in the same frame as the key: no step between.
      await page.locator('#sheet-grab').focus();
      const at = await page.evaluate(`new Promise((resolve) => {
        document.getElementById('sheet-grab').dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
        requestAnimationFrame(() => resolve([document.getElementById('panel-pane').getBoundingClientRect().top, document.querySelector('header.top').getBoundingClientRect().bottom]));
      })`) as [number, number];
      const end = (await settled(page)).pane;
      if (motion === 'reduce') assert.ok(Math.abs(at[0] - end.y) < 0.5 && at[1] <= 0.5, JSON.stringify([at, end]));
      else assert.ok(at[0] > end.y + 20, JSON.stringify([at, end]));
      await page.context().close();
    }
  });
});
