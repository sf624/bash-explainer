// The steps of the panel's Reading view on the web page (media/panel.js, STEPS), in headless Chromium: a button per
// step, the keys, what a polite live region says, the stepper and its menu where the buttons do not fit, the
// controls staying under the line; and the motion of folding by hand (both views) and of the steps, which the
// setting `panel.animations` and reduced motion turn off. test/web-anchor.test.ts checks that nothing jumps.
import * as assert from 'assert';
import type { Browser, BrowserContext, Frame, Page } from 'playwright-core';
import { chooseView, openSite, until } from './support/site';

const LINE = `find . -name '*.sh' | xargs grep -n "$(date +%Y)" && echo done`;

describe('the web page: the steps of the tree view, and motion', function () {
  this.timeout(120000);
  let browser: Browser;
  let base = '';

  before(async function () {
    ({ browser, base } = await openSite(this));
  });

  /** A context; `animations: false` turns the setting off (the page keeps it in its storage). */
  async function context(options: Parameters<Browser['newContext']>[0] = {}, animations = true): Promise<BrowserContext> {
    const ctx = await browser.newContext({ locale: 'en-US', ...options });
    if (!animations) await ctx.addInitScript(`try { localStorage.setItem('bash-explainer-settings', JSON.stringify({ 'bashExplainer.panel.animations': false })); } catch {}`);
    return ctx;
  }

  /** Opens the page, types `line`, and returns the panel's frame in the view asked, once it shows the line. */
  async function open(page: Page, view: 'tree' | 'list' = 'tree', line = LINE): Promise<Frame> {
    await page.goto(base);
    const panel = () => page.frames().find((f) => f.url().endsWith('/panel.html'))!;
    await until('the panel', () => Promise.resolve(panel()), (f) => !!f);
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText(line);
    await until('the line explained', async () => (await panel().locator('#line').textContent()) ?? '', (t) => t.includes(line.slice(0, 12)));
    if (view === 'tree') {
      await chooseView(page, 'tree');
      await until('the tree', () => panel().locator('#reading-tree li').count(), (n) => n > 3);
    }
    return panel();
  }

  const current = (panel: Frame) => panel.locator('#layers button.step[aria-current="step"]').getAttribute('data-step');
  const live = (panel: Frame) => panel.locator('#tp-live').textContent();
  /** The kinds of the nodes drawn, by layer. */
  const drawn = (panel: Frame) => panel.locator('#reading-tree').evaluate((t) => [...t.querySelectorAll('li')].map((li) => li.className.match(/l-(\w+)/)![1] + ':' + li.querySelector(':scope > .trow .chip')!.textContent));
  /** How many rows move (not the CSS transitions of a row's background under the pointer). */
  const moving = (panel: Frame) => panel.evaluate('document.getAnimations().filter((a) => !(a instanceof CSSTransition)).length') as Promise<number>;

  it('shows the step buttons in the web page\'s panel at 1280px', async () => {
    const ctx = await context({ viewport: { width: 1280, height: 800 } }, false);
    const page = await ctx.newPage();
    const panel = await open(page);
    assert.strictEqual(await panel.locator('#layers button.step').first().isVisible(), true, await panel.locator('#layers').getAttribute('class') ?? '');
    await ctx.close();
  });

  it('has a button per step: a click jumps to it, the arrows step, Home and End go to either end, and a live region says it', async () => {
    const ctx = await context({ viewport: { width: 1700, height: 800 } }, false);
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const panel = await open(page);
    const steps = panel.locator('#layers button.step');
    assert.strictEqual(await steps.count(), 8);
    assert.deepStrictEqual(await steps.evaluateAll((bs) => bs.map((b) => b.textContent)),
      ['1Line', '2Lists', '3Commands', '4Words', '5Inside', '6Scripts', '7Arguments', '8Languages']);
    assert.strictEqual(await current(panel), '8', 'every layer by default');
    assert.strictEqual(await steps.nth(3).getAttribute('aria-label'), 'Step 4 of 8: words');
    // One Tab stop: the step shown.
    assert.deepStrictEqual(await steps.evaluateAll((bs) => bs.map((b) => b.getAttribute('tabindex'))), ['-1', '-1', '-1', '-1', '-1', '-1', '-1', '0']);

    await steps.nth(0).click();
    assert.deepStrictEqual(await drawn(panel), ['bash:bash reads the line']);
    assert.strictEqual(await live(panel), 'Step 1 of 8: the line');
    await steps.nth(2).click();
    const three = await drawn(panel);
    assert.ok(three.includes('bash:pipeline') && three.includes('bash:simple command') && !three.some((k) => /argument|operand/.test(k)), three.join());
    assert.strictEqual(await current(panel), '3');
    assert.strictEqual(await panel.evaluate('document.activeElement.dataset.step'), '3');

    // The keys, on the buttons.
    await page.keyboard.press('ArrowRight');
    assert.strictEqual(await current(panel), '4');
    assert.strictEqual(await panel.evaluate('document.activeElement.dataset.step'), '4', 'the focus follows the step');
    assert.ok((await drawn(panel)).includes('bash:argument'));
    assert.strictEqual(await live(panel), 'Step 4 of 8: words');
    await page.keyboard.press('ArrowLeft');
    assert.strictEqual(await current(panel), '3');
    await page.keyboard.press('End');
    assert.strictEqual(await current(panel), '8');
    assert.ok((await drawn(panel)).some((k) => k.startsWith('language:')));
    await page.keyboard.press('Home');
    assert.strictEqual(await current(panel), '1');
    // Back and forward step too, and say when there is nothing more.
    assert.strictEqual(await panel.locator('#tp-back').getAttribute('aria-disabled'), 'true');
    await panel.locator('#tp-forward').click();
    assert.strictEqual(await current(panel), '2');
    // The step is kept as the viewer's choice.
    await until('the step kept', () => page.evaluate("localStorage.getItem('bash-explainer-panel')"), (v) => v === JSON.stringify({ view: 'tree', step: 2, level: 1 }));
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  });

  it('marks a step that adds nothing to the line, and passes it over with the arrows', async () => {
    const ctx = await context({ viewport: { width: 1700, height: 800 } }, false);
    const page = await ctx.newPage();
    // No substitution, no language: steps 6 and 8 add nothing.
    const panel = await open(page, 'tree', 'echo hi | cat');
    const six = panel.locator('#layers button.step[data-step="6"]');
    assert.strictEqual(await six.getAttribute('aria-label'), 'Step 6 of 8: scripts inside (Adds nothing on this line)');
    assert.strictEqual(await six.evaluate((b) => b.classList.contains('empty')), true);
    await panel.locator('#layers button.step[data-step="5"]').click();
    await page.keyboard.press('ArrowRight');
    assert.strictEqual(await current(panel), '7');
    await ctx.close();
  });

  it('keeps the general text of a kind on the same row from step to step', async () => {
    const ctx = await context({ viewport: { width: 1700, height: 800 } }, false);
    const page = await ctx.newPage();
    const panel = await open(page);
    const about = () => panel.locator('#reading-tree li').evaluateAll((lis) => lis.filter((li) => li.querySelector(':scope > .trow > .text.about')).map((li) => `${li.getAttribute('data-path')} ${li.querySelector(':scope > .trow > .text')!.textContent!.slice(0, 20)}`));
    const seen = new Map<string, string>();
    for (const s of [2, 3, 4, 5, 6, 7, 8]) {
      await panel.locator(`#layers button.step[data-step="${s}"]`).click();
      for (const a of await about()) {
        const [path, ...text] = a.split(' ');
        const key = text.join(' ');
        if (seen.has(key)) assert.strictEqual(path, seen.get(key), `step ${s}: "${key}" moved`);
        seen.set(key, path);
      }
    }
    assert.ok(seen.size > 3);
    await ctx.close();
  });

  for (const [width, phone, size] of [[300, false, 24], [390, true, 40]] as const) {
    it(`folds the steps into a stepper with a menu at ${width}px, with targets of ${size}px and nothing past the edge`, async () => {
      const ctx = await context({ viewport: { width: phone ? width : 1280, height: 800 } }, false);
      const page = await ctx.newPage();
      const panel = await open(page);
      if (!phone) {
        // The panel as VS Code's: a frame of that width, without the web page's class.
        await page.evaluate(`(() => { const f = [...document.querySelectorAll('iframe')].find((x) => x.src.endsWith('panel.html')); f.style.cssText += ';position:fixed;inset:0;width:${width}px;height:800px;z-index:9999'; })()`);
        await panel.evaluate(`document.documentElement.classList.remove('bx-web')`);
      }
      await until('the stepper', () => panel.locator('#layers').evaluate((b) => b.classList.contains('compact')), (v) => v);
      const fits = () => panel.evaluate(`(() => {
        const box = document.getElementById('layers');
        const shown = [...box.querySelectorAll('button')].filter((b) => b.getClientRects().length && !b.closest('#steps'));
        return { over: box.scrollWidth > box.clientWidth || document.documentElement.scrollWidth > document.documentElement.clientWidth,
          right: Math.max(...shown.map((b) => b.getBoundingClientRect().right)) <= document.documentElement.clientWidth,
          small: shown.filter((b) => b.getBoundingClientRect().height < ${size} || b.getBoundingClientRect().width < ${size}).map((b) => b.id) };
      })()`);
      assert.deepStrictEqual(await fits(), { over: false, right: true, small: [] });
      const menu = panel.locator('#step-menu');
      assert.strictEqual(await menu.textContent(), '8/8 Languages▾');
      assert.strictEqual(await menu.getAttribute('aria-expanded'), 'false');
      await menu.click();
      assert.strictEqual(await menu.getAttribute('aria-expanded'), 'true');
      assert.strictEqual(await panel.evaluate('document.activeElement.dataset.step'), '8', 'the menu opens on the step shown');
      await page.keyboard.press('ArrowUp');
      await page.keyboard.press('ArrowUp');
      await page.keyboard.press('ArrowUp');
      await page.keyboard.press('ArrowUp');
      assert.strictEqual(await panel.evaluate('document.activeElement.dataset.step'), '4');
      await page.keyboard.press('Enter');
      assert.strictEqual(await current(panel), '4');
      assert.strictEqual(await menu.getAttribute('aria-expanded'), 'false');
      assert.strictEqual(await panel.evaluate('document.activeElement.id'), 'step-menu', 'the focus back on the stepper');
      // Escape closes the menu; the arrows step from the stepper too.
      await menu.click();
      await page.keyboard.press('Escape');
      assert.strictEqual(await menu.getAttribute('aria-expanded'), 'false');
      await page.keyboard.press('ArrowRight');
      assert.strictEqual(await current(panel), '5');
      assert.deepStrictEqual(await fits(), { over: false, right: true, small: [] });
      // One group (the controls), and a stepper that opens a plain box of buttons, not a popup.
      assert.deepStrictEqual(await panel.evaluate(`[document.getElementById('layers').getAttribute('role'), document.getElementById('steps').getAttribute('role'), document.getElementById('step-menu').getAttribute('aria-haspopup')]`), ['group', null, null]);
      if (!phone) {
        // The menu open, then the panel wide again: the buttons are back, and the stepper says it is closed.
        await menu.click();
        assert.strictEqual(await menu.getAttribute('aria-expanded'), 'true');
        await page.evaluate(`(() => { const f = [...document.querySelectorAll('iframe')].find((x) => x.src.endsWith('panel.html')); f.style.width = '1280px'; })()`);
        await until('the buttons back', () => panel.locator('#layers').evaluate((b) => b.classList.contains('compact')), (v) => !v);
        assert.strictEqual(await menu.getAttribute('aria-expanded'), 'false');
        assert.strictEqual(await panel.locator('#layers').evaluate((b) => b.classList.contains('open')), false);
      }
      await ctx.close();
    });
  }

  it('does nothing on a click on the step shown, or on ◁ at the first step: a step back that moves goes on', async () => {
    const ctx = await context({ viewport: { width: 1700, height: 800 } });
    const page = await ctx.newPage();
    const panel = await open(page);
    const click = (sel: string) => panel.evaluate(`document.querySelector('${sel}').click()`);
    await click('#layers button.step[data-step="3"]');
    assert.ok(await moving(panel) > 0, 'the rows shrink');
    const rows = await panel.locator('#reading-tree li').count();
    await click('#layers button.step[data-step="3"]');
    assert.ok(await moving(panel) > 0, 'they still shrink');
    assert.strictEqual(await panel.locator('#reading-tree li').count(), rows, 'nothing drawn anew');
    await until('the motion over', () => moving(panel), (n) => n === 0);
    await click('#layers button.step[data-step="1"]');
    assert.ok(await moving(panel) > 0, 'the rows shrink to the line');
    assert.strictEqual(await panel.locator('#tp-back').getAttribute('aria-disabled'), 'true');
    await click('#tp-back');
    assert.ok(await moving(panel) > 0, '◁ at the first step leaves them shrinking');
    assert.strictEqual(await current(panel), '1');
    await ctx.close();
  });

  it('keeps the step buttons at 600px, with their numbers and the step back and forward buttons', async () => {
    const ctx = await context({ viewport: { width: 1280, height: 800 } }, false);
    const page = await ctx.newPage();
    const panel = await open(page);
    await page.evaluate(`(() => { const f = [...document.querySelectorAll('iframe')].find((x) => x.src.endsWith('panel.html')); f.style.cssText += ';position:fixed;inset:0;width:600px;height:800px;z-index:9999'; })()`);
    await panel.evaluate(`document.documentElement.classList.remove('bx-web')`);
    await until('the panel narrower', () => panel.evaluate('document.documentElement.clientWidth') as Promise<number>, (w) => w === 600);
    const box = panel.locator('#layers');
    await until('the buttons fitted', () => box.getAttribute('class'), (c) => /snug/.test(c ?? ''));
    assert.strictEqual(await box.evaluate((b) => b.classList.contains('compact')), false);
    assert.strictEqual(await panel.locator('#layers button.step').nth(7).isVisible(), true);
    assert.strictEqual(await panel.locator('#layers .num').first().isVisible(), true);
    assert.strictEqual(await panel.locator('#tp-back').isVisible(), true);
    assert.strictEqual(await box.evaluate((b) => b.scrollWidth <= b.clientWidth), true);
    await ctx.close();
  });

  it('keeps the controls under the line while the tree scrolls, and scrolls a row into view below them', async () => {
    const ctx = await context({ viewport: { width: 390, height: 700 } }, false);
    const page = await ctx.newPage();
    const panel = await open(page);
    await panel.evaluate('window.scrollTo(0, 600)');
    await until('scrolled', () => panel.evaluate('scrollY') as Promise<number>, (y) => y > 300);
    const at = await panel.evaluate(`(() => ({ top: document.getElementById('top').getBoundingClientRect().bottom, layers: document.getElementById('layers').getBoundingClientRect().top, bottom: document.getElementById('layers').getBoundingClientRect().bottom }))()`) as { top: number; layers: number; bottom: number };
    assert.ok(Math.abs(at.layers - at.top) <= 1, JSON.stringify(at));
    // A tree item reached with the keys is not left under them.
    await panel.locator('#reading-tree li[tabindex="0"]').focus();
    for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowDown');
    for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowUp');
    const top = await panel.evaluate('document.activeElement.getBoundingClientRect().top') as number;
    assert.ok(top >= at.bottom - 1, `${top} below ${at.bottom}`);
    await ctx.close();
  });

  it('grows and shrinks rows folded by hand, in the tree and the list, and when a step changes', async () => {
    const ctx = await context({ viewport: { width: 1700, height: 800 } });
    const page = await ctx.newPage();
    const panel = await open(page);
    const item = panel.locator('#reading-tree li[aria-level="2"]').first();
    const group = item.locator('> ul[role="group"]');
    const full = (await group.boundingBox())!.height;
    await item.locator('> .trow').click();
    // Folded at once for the keys and the screen readers, drawn while it shrinks.
    assert.strictEqual(await item.getAttribute('aria-expanded'), 'false');
    assert.ok(await moving(panel) > 0, 'it moves');
    assert.strictEqual(await group.isVisible(), true, 'still drawn while it shrinks');
    await until('folded', () => group.isVisible(), (v) => !v, 2000);
    assert.strictEqual(await moving(panel), 0);
    // Unfolded: it grows from nothing, without a jump at the end.
    await item.locator('> .trow').click();
    const h = (await group.boundingBox())!.height;
    assert.ok(h < full, `${h} < ${full}`);
    await until('unfolded', () => moving(panel), (n) => n === 0, 2000);
    assert.strictEqual((await group.boundingBox())!.height, full);

    // A step back shrinks what it takes away, then draws the tree without it; a step forward grows the new rows.
    await panel.locator('#layers button.step[data-step="3"]').click();
    assert.ok(await moving(panel) > 0);
    await until('the step drawn', () => panel.locator('#reading-tree li[data-closing]').count(), (n) => n === 0, 2000);
    assert.ok(!(await drawn(panel)).some((k) => /argument/.test(k)));
    await panel.locator('#layers button.step[data-step="4"]').click();
    assert.ok(await moving(panel) > 0);
    assert.ok((await drawn(panel)).some((k) => /argument/.test(k)));

    // The list.
    await chooseView(page, 'list');
    const li = panel.locator('#tree li:has(> .body > ul)').first();
    await li.locator('> .row > .twisty').click();
    assert.strictEqual(await li.evaluate((e) => e.classList.contains('collapsed')), true);
    assert.ok(await moving(panel) > 0);
    assert.strictEqual(await li.locator('> .body').isVisible(), true, 'still drawn while it shrinks');
    await until('folded', () => li.locator('> .body').isVisible(), (v) => !v, 2000);
    await ctx.close();
  });

  for (const [what, options, animations] of [
    ['the setting is off', {}, false],
    ['the system asks for reduced motion', { reducedMotion: 'reduce' }, true],
  ] as const) {
    it(`draws rows at once when ${what}`, async () => {
      const ctx = await context({ viewport: { width: 1700, height: 800 }, ...options }, animations);
      const page = await ctx.newPage();
      const panel = await open(page);
      const item = panel.locator('#reading-tree li[aria-level="2"]').first();
      await item.locator('> .trow').click();
      assert.strictEqual(await moving(panel), 0);
      assert.strictEqual(await item.locator('> ul[role="group"]').isVisible(), false);
      await panel.locator('#layers button.step[data-step="2"]').click();
      assert.strictEqual(await moving(panel), 0);
      assert.strictEqual(await panel.locator('#reading-tree li[data-closing]').count(), 0);
      await chooseView(page, 'list');
      const li = panel.locator('#tree li:has(> .body > ul)').first();
      await li.locator('> .row > .twisty').click();
      assert.strictEqual(await moving(panel), 0);
      assert.strictEqual(await li.locator('> .body').isVisible(), false);
      await ctx.close();
    });
  }
});
