// The tree view of the explanation panel on the web page (media/panel.js, src/reading.ts), in headless Chromium: the
// switch from the list (the page's own, in its top bar or its menu: web/panel-bridge.ts), folding and moving with the keyboard as the ARIA tree pattern says, the layers, and the
// choice kept for the next visit (web/storage.ts).
import * as assert from 'assert';
import type { Browser, Frame, Page } from 'playwright-core';
import { chooseView, frames, openSite, until } from './support/site';

describe('the web page: the tree view of the panel', function () {
  this.timeout(120000);
  let browser: Browser;
  let base = '';

  before(async function () {
    ({ browser, base } = await openSite(this));
  });

  /** A context whose panel draws its rows at once (the setting `panel.animations` off): these tests look at the layout right after a click. */
  async function context(options: Parameters<Browser['newContext']>[0] = {}) {
    // (Wide enough for the panel to show the step buttons, not the stepper.)
    const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 1700, height: 800 }, ...options });
    await ctx.addInitScript(`try { localStorage.setItem('bash-explainer-settings', JSON.stringify({ 'bashExplainer.panel.animations': false })); } catch {}`);
    return ctx;
  }

  /** Opens the page, types `line`, and returns the panel's frame once it explains the line. */
  async function open(page: Page, line: string): Promise<Frame> {
    await page.goto(base);
    const panel = () => page.frames().find((f) => f.url().endsWith('/panel.html'))!;
    await until('the panel', () => Promise.resolve(panel()), (f) => !!f);
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText(line);
    await until('the line explained', async () => (await panel().locator('#line').textContent()) ?? '', (t) => t.includes(line.slice(0, 12)));
    return panel();
  }

  /** The focused item of the tree: its level, whether it is expanded, and its name. */
  const focused = (panel: Frame) => panel.evaluate(`(() => {
    const li = document.activeElement;
    return { role: li.getAttribute('role'), level: li.getAttribute('aria-level'), expanded: li.getAttribute('aria-expanded'), name: li.getAttribute('aria-label').split('.')[0] };
  })()`) as Promise<{ role: string; level: string; expanded: string | null; name: string }>;

  it('switches to the tree, folds and moves with the keyboard, shows the layers chosen, and keeps the choice', async () => {
    const ctx = await context();
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    let panel = await open(page, 'x=$(grep -c foo f) && [ "$x" -gt 0 ]');
    assert.strictEqual(await panel.locator('#reading').isHidden(), true, 'the list first');
    // The view control is the page's, in the panel's header; the panel shows no copy of it.
    assert.deepStrictEqual(await page.evaluate(`[...document.querySelectorAll('#slot-options button')].map((b) => b.textContent + ' ' + b.getAttribute('aria-pressed'))`), ['Meaning true', 'Reading false']);
    assert.strictEqual(await page.locator('#slot-options').getAttribute('aria-label'), 'View');
    assert.strictEqual(await panel.locator('#views').isHidden(), true);
    await chooseView(page, 'tree');
    // (The host builds the tree when the view is chosen.)
    await until('the tree', () => panel.locator('#reading-tree li').count(), (n) => n > 3);
    assert.strictEqual(await panel.locator('#tree').isHidden(), true);
    assert.strictEqual(await page.locator('#slot-tree').getAttribute('aria-pressed'), 'true');
    assert.strictEqual(await page.locator('#slot-list').getAttribute('aria-pressed'), 'false');
    const tree = panel.locator('#reading-tree');
    assert.strictEqual(await tree.getAttribute('role'), 'tree');
    // One item takes the Tab key: the first.
    assert.strictEqual(await tree.locator('li[tabindex="0"]').count(), 1);

    // The keys of the tree pattern.
    await tree.locator('li[tabindex="0"]').focus();
    assert.deepStrictEqual(await focused(panel), { role: 'treeitem', level: '1', expanded: 'true', name: 'bash reads the line' });
    await page.keyboard.press('ArrowDown');
    assert.deepStrictEqual(await focused(panel), { role: 'treeitem', level: '2', expanded: 'true', name: 'AND list x=$(grep -c foo f) && [ "$x" -gt 0 ]' });
    // The focused part is marked in the line at the top.
    await frames(panel);
    assert.strictEqual(await panel.locator('#line span.mark').count() > 0, true);
    await page.keyboard.press('ArrowLeft');
    assert.strictEqual((await focused(panel)).expanded, 'false');
    assert.strictEqual(await tree.locator('li[aria-level="3"]').first().isVisible(), false, 'folded');
    await page.keyboard.press('ArrowDown');
    assert.strictEqual((await focused(panel)).level, '2', 'a folded item is passed over');
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowRight');
    assert.strictEqual((await focused(panel)).expanded, 'true', 'unfolded again');
    await page.keyboard.press('ArrowRight');
    assert.deepStrictEqual(await focused(panel), { role: 'treeitem', level: '3', expanded: 'true', name: 'simple command x=$(grep -c foo f)' });
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    assert.strictEqual((await focused(panel)).level, '2', 'to the parent');
    await page.keyboard.press('End');
    assert.strictEqual((await focused(panel)).name, 'operand ]');
    await page.keyboard.press('Enter');
    assert.strictEqual((await focused(panel)).name, 'operand ]', 'Enter on a leaf folds nothing');

    // The steps: bash alone (all of its reading at step 5), then up to the languages.
    const layers = async () => panel.locator('#reading-tree').evaluate((t) => [...new Set([...t.querySelectorAll('li')].map((li) => li.className.match(/l-(\w+)/)![1]))].sort());
    const stepButton = (s: number) => panel.locator(`#layers button.step[data-step="${s}"]`);
    await stepButton(5).click();
    assert.deepStrictEqual(await layers(), ['bash']);
    await stepButton(6).click();
    assert.deepStrictEqual(await layers(), ['bash', 'child']);
    assert.strictEqual(await stepButton(6).getAttribute('aria-current'), 'step');
    assert.strictEqual(await stepButton(5).getAttribute('aria-current'), null);
    await stepButton(8).click();
    assert.deepStrictEqual(await layers(), ['bash', 'child', 'command', 'language']);
    await stepButton(7).click();

    // The view and the step are kept for the next visit.
    await until('the choice kept', () => page.evaluate("localStorage.getItem('bash-explainer-panel')"), (v) => v === JSON.stringify({ view: 'tree', step: 7, level: 3 }));
    panel = await open(page, "find . -name '*.sh' | xargs grep -n 'set -e'");
    await until('the tree view', () => panel.locator('#reading').isVisible(), (v) => v);
    assert.strictEqual(await page.locator('#slot-tree').getAttribute('aria-pressed'), 'true', 'the switch remembers it');
    assert.strictEqual(await stepButton(7).getAttribute('aria-current'), 'step');
    assert.deepStrictEqual(await layers(), ['bash', 'command']);
    // A click on a row folds it, as in the list.
    const tree2 = panel.locator('#reading-tree');
    await tree2.locator('li[aria-level="2"] > .trow').first().click();
    assert.strictEqual(await tree2.locator('li[aria-level="2"]').first().getAttribute('aria-expanded'), 'false');
    // And back to the list.
    await chooseView(page, 'list');
    await until('the list', () => panel.locator('#tree').isVisible(), (v) => v);
    assert.strictEqual(await panel.locator('#reading').isHidden(), true);
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  });

  /** The tree view of `line`, with the item at `level` focused (its path is the tab stop). */
  async function treeOf(page: Page, line: string): Promise<Frame> {
    const panel = await open(page, line);
    await chooseView(page, 'tree');
    await until('the tree', () => panel.locator('#reading-tree li').count(), (n) => n > 3);
    return panel;
  }
  const pause = (page: Page) => page.waitForTimeout(700);
  const activeName = (panel: Frame) => panel.evaluate(`(() => { const e = document.activeElement; return (e.getAttribute('aria-label') || e.id || e.tagName).split('.')[0]; })()`) as Promise<string>;

  it('keeps the focus on the step button pressed, and on the item after Enter', async () => {
    const ctx = await context();
    const page = await ctx.newPage();
    const panel = await treeOf(page, 'x=$(grep -c foo f) && [ "$x" -gt 0 ]');
    const button = panel.locator('#layers button.step[data-step="6"]');
    await button.click();
    assert.strictEqual(await button.getAttribute('aria-current'), 'step');
    assert.strictEqual(await panel.evaluate(`document.activeElement.dataset.step`), '6', 'the button keeps the focus');
    await page.keyboard.press('Space');
    assert.strictEqual(await panel.evaluate(`document.activeElement.dataset.step`), '6', 'and again after another render');

    // Enter on an item folds it and selects its range in the editor; the focus stays in the tree.
    const tree = panel.locator('#reading-tree');
    await tree.locator('li[tabindex="0"]').focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowRight');
    const before = await activeName(panel);
    await page.keyboard.press('Enter');
    await pause(page);
    assert.strictEqual(await activeName(panel), before, 'the same item after the update');
    assert.strictEqual(await page.evaluate(`document.activeElement.tagName`), 'IFRAME', 'the editor did not take the focus');
    await ctx.close();
  });

  it('keeps the Tab stop on a visible item after Collapse all, and the button says what the view does', async () => {
    const ctx = await context();
    const page = await ctx.newPage();
    const panel = await treeOf(page, 'x=$(grep -c foo f) && [ "$x" -gt 0 ]');
    const tree = panel.locator('#reading-tree');
    await tree.locator('li[tabindex="0"]').focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowRight');
    assert.strictEqual((await focused(panel)).level, '3');
    await page.locator('#collapse').click();
    await until('the name', async () => (await page.locator('#collapse').getAttribute('aria-label')) ?? '', (t) => t === 'Expand all');
    assert.strictEqual(await tree.locator('li[tabindex="0"]').count(), 1);
    assert.strictEqual(await tree.locator('li[tabindex="0"]').isVisible(), true);
    await chooseView(page, 'list');
    await until('the list is not folded', async () => (await page.locator('#collapse').getAttribute('aria-label')) ?? '', (t) => t === 'Collapse all');
    await chooseView(page, 'tree');
    await until('the tree', () => panel.locator('#reading-tree li').count(), (n) => n > 3);
    await until('the name', async () => (await page.locator('#collapse').getAttribute('aria-label')) ?? '', (t) => t === 'Expand all');
    await ctx.close();
  });

  it('reaches the manual links of the focused item with Tab', async () => {
    const ctx = await context();
    const page = await ctx.newPage();
    const panel = await treeOf(page, 'x=$(grep -c foo f) && [ "$x" -gt 0 ]');
    const tree = panel.locator('#reading-tree');
    const li = tree.locator('li:has(> .trow .refs a)').first();
    await li.focus();
    assert.strictEqual(await li.locator(':scope > .trow .refs a').first().getAttribute('tabindex'), '0');
    await page.keyboard.press('Tab');
    assert.strictEqual(await panel.evaluate(`document.activeElement.tagName`), 'A');
    await page.keyboard.press('Shift+Tab');
    assert.strictEqual(await panel.evaluate(`document.activeElement.getAttribute('role')`), 'treeitem');
    await ctx.close();
  });

  /**
   * The outline's geometry, for each item in a group: where its elbow is, from the middle of its first line (the
   * code's pill, or the kind where there is no code); where the group's line is, from the middle of the parent's
   * twisty; how far the line goes below the elbow (the last child); the links' middle, from the pill's; the band's
   * background; and how far the row's parts reach past the panel's right edge.
   */
  const outline = (panel: Frame) => panel.evaluate(`(() => {
    const px = (v) => parseFloat(v) || 0;
    const middle = (r) => (r.top + r.bottom) / 2;
    const width = document.documentElement.clientWidth;
    return [...document.querySelectorAll('#reading-tree ul[role="group"] > li')].map((li) => {
      const r = li.getBoundingClientRect();
      const after = getComputedStyle(li, '::after');
      const before = getComputedStyle(li, '::before');
      const row = li.querySelector(':scope > .trow');
      const pill = row.querySelector('.tcode');
      const first = (pill ?? row.querySelector('.chip')).getBoundingClientRect();
      // (A long code wraps in its pill: the elbow is at the middle of its first line.)
      const lh = px(getComputedStyle(row).lineHeight);
      const mid = first.height > lh * 1.5 ? first.top + 1 + lh / 2 : middle(first);
      // (The lines are placed from the item's padding box: a band's edges are borders around it.)
      const box = getComputedStyle(li);
      const elbow = r.top + px(box.borderTopWidth) + px(after.top) + px(after.marginTop) + px(after.borderTopWidth) / 2;
      const twisty = li.parentElement.closest('li').querySelector(':scope > .trow > .twisty').getBoundingClientRect();
      const line = r.left + px(box.borderLeftWidth) + px(before.left) + px(before.borderLeftWidth) / 2;
      const refs = row.querySelector('.refs');
      const parts = [...row.querySelectorAll('*')].map((e) => e.getBoundingClientRect().right);
      return {
        text: row.textContent.slice(0, 40), pill: !!pill, last: !li.nextElementSibling, band: li.classList.contains('band'),
        layer: li.className.match(/l-(\\w+)/)[1], background: getComputedStyle(li).backgroundColor,
        elbow: elbow - mid, line: line - (twisty.left + twisty.right) / 2, below: r.top + px(box.borderTopWidth) + px(before.top) + px(before.height) - elbow,
        refs: refs ? middle(refs.getBoundingClientRect()) - mid : null, overflow: Math.max(...parts) - width,
        edges: [box.borderLeftWidth, box.borderTopWidth, box.borderBottomWidth, box.borderRightWidth].join(' '), rule: box.borderLeftColor, colour: getComputedStyle(row.querySelector('.chip')).color,
      };
    });
  })()`) as Promise<{ text: string; pill: boolean; last: boolean; band: boolean; layer: string; background: string; elbow: number; line: number; below: number; refs: number | null; overflow: number; edges: string; rule: string; colour: string }[]>;

  it('draws the outline: elbows at the pills, lines under the twisties, links level with the code, one tint per layer', async () => {
    for (const width of [1280, 360]) {
      for (const line of ['x=$(grep -c foo f) && [ "$x" -gt 0 ]', 'sudo ls -l /tmp | xargs grep -n x']) {
        const ctx = await context({ viewport: { width, height: 800 } });
        const page = await ctx.newPage();
        const panel = await treeOf(page, line);
        const items = await outline(panel);
        const at = `${width}px, ${line}`;
        assert.ok(items.length > 15, `${at}: ${items.length} items`);
        for (const i of items) {
          const it = `${at}: ${JSON.stringify(i)}`;
          if (i.pill) assert.ok(Math.abs(i.elbow) <= 1.5, `the elbow at the pill's middle, ${it}`);
          assert.ok(Math.abs(i.line) <= 1, `the line under the parent's twisty, ${it}`);
          if (i.last) assert.ok(Math.abs(i.below) <= 1, `no line below the last child, ${it}`);
          if (i.refs !== null) assert.ok(Math.abs(i.refs) <= 2, `the links level with the code, ${it}`);
          assert.ok(i.overflow <= 0, `nothing past the right edge, ${it}`);
        }
        // A band's tint is opaque, and the same for a layer at every depth (not laid over the band around it).
        const tints = new Map<string, Set<string>>();
        for (const i of items.filter((x) => x.band)) tints.set(i.layer, (tints.get(i.layer) ?? new Set()).add(i.background));
        assert.ok(tints.size >= 2, `${at}: bands of ${[...tints.keys()]}`);
        for (const [layer, set] of tints) {
          assert.strictEqual(set.size, 1, `${at}: one tint for ${layer}: ${[...set]}`);
          assert.ok(!/rgba|\/ 0\.|\/ 0\)/.test([...set][0]), `${at}: ${layer}'s tint is opaque: ${[...set]}`);
        }
        assert.ok(items.some((i) => !i.band && i.background === 'rgba(0, 0, 0, 0)'), `${at}: an item in a band shows the band's tint`);
        // A band's edges: a rule in the layer's colour (the colour of its kind) on its left, hairlines at its top and bottom, none on the right.
        for (const i of items) assert.strictEqual(i.edges, i.band ? '2px 1px 1px 0px' : '0px 0px 0px 0px', `${at}: the edges of ${JSON.stringify(i)}`);
        for (const i of items.filter((x) => x.band)) assert.strictEqual(i.rule, i.colour, `${at}: the rule in the layer's colour, ${JSON.stringify(i)}`);
        assert.strictEqual(await panel.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), true, `${at}: no sideways scroll`);
        // On a phone, a command name's row wraps its text, not its links.
        if (width === 360) assert.ok(await panel.locator('#reading-tree .trow', { hasText: 'command name' }).evaluateAll((rs) => rs.some((r) => r.getBoundingClientRect().height > 30)), `${at}: a row wraps`);
        await ctx.close();
      }
    }
  });

  it('works when the browser refuses storage', async () => {
    const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 1700, height: 800 } });
    await ctx.addInitScript(`(() => {
      const refuse = () => { throw new DOMException('refused', 'SecurityError'); };
      Storage.prototype.getItem = refuse;
      Storage.prototype.setItem = refuse;
      Storage.prototype.removeItem = refuse;
    })()`);
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const panel = await treeOf(page, 'echo hi | cat');
    assert.strictEqual(await panel.locator('#reading').isVisible(), true);
    await panel.locator('#layers button.step[data-step="1"]').click();
    await chooseView(page, 'list');
    await until('the list', () => panel.locator('#tree').isVisible(), (v) => v);
    await chooseView(page, 'tree');
    await until('the tree again', () => panel.locator('#reading-tree li').count(), (n) => n > 0);
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  });

  it('fits a phone: no sideways scroll, in Japanese; the view control is a menu in the panel\'s header', async () => {
    const ctx = await context({ viewport: { width: 320, height: 800 }, locale: 'ja-JP' });
    const page = await ctx.newPage();
    const panel = await open(page, "find . -name '*.sh' | xargs grep -n 'set -e'");
    assert.strictEqual(await page.locator('#slot-options').isHidden(), true);
    assert.strictEqual(await page.locator('#slot-open').getAttribute('aria-label'), '表示: 意味');
    await chooseView(page, 'tree');
    await until('the tree', () => panel.locator('#reading-tree li').count(), (n) => n > 10);
    assert.strictEqual(await page.locator('#slot-options').isHidden(), true, 'the menu closed');
    assert.strictEqual(await page.locator('#slot-open .vc-stack > :first-child').textContent(), '読まれ方');
    assert.strictEqual(await page.locator('#slot-open').getAttribute('aria-label'), '表示: 読まれ方');
    assert.strictEqual(await page.locator('#slot-tree').getAttribute('aria-pressed'), 'true');
    assert.strictEqual(await panel.locator('#reading-tree li').count() > 10, true);
    assert.strictEqual(await panel.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), true);
    await ctx.close();
  });
});
