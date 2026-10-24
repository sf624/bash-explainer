// The tree view of the explanation panel on the web page (media/panel.js, src/reading.ts), in headless Chromium: the
// switch from the list, folding and moving with the keyboard as the ARIA tree pattern says, the layers, and the
// choice kept for the next visit (web/storage.ts).
import * as assert from 'assert';
import type { Browser, Frame, Page } from 'playwright-core';
import { frames, openSite, until } from './support/site';

describe('the web page: the tree view of the panel', function () {
  this.timeout(120000);
  let browser: Browser;
  let base = '';

  before(async function () {
    ({ browser, base } = await openSite(this));
  });

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
    const ctx = await browser.newContext({ locale: 'en-US' });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    let panel = await open(page, 'x=$(grep -c foo f) && [ "$x" -gt 0 ]');
    assert.strictEqual(await panel.locator('#reading').isHidden(), true, 'the list first');
    await panel.locator('#view-tree').click();
    // (The host builds the tree when the view is chosen.)
    await until('the tree', () => panel.locator('#reading-tree li').count(), (n) => n > 3);
    assert.strictEqual(await panel.locator('#tree').isHidden(), true);
    assert.strictEqual(await panel.locator('#view-tree').getAttribute('aria-pressed'), 'true');
    const tree = panel.locator('#reading-tree');
    assert.strictEqual(await tree.getAttribute('role'), 'tree');
    // One item takes the Tab key: the first.
    assert.strictEqual(await tree.locator('li[tabindex="0"]').count(), 1);

    // The keys of the tree pattern.
    await tree.locator('li[tabindex="0"]').focus();
    assert.deepStrictEqual(await focused(panel), { role: 'treeitem', level: '1', expanded: 'true', name: 'bash reads the line' });
    await page.keyboard.press('ArrowDown');
    assert.deepStrictEqual(await focused(panel), { role: 'treeitem', level: '2', expanded: 'true', name: 'list x=$(grep -c foo f) && [ "$x" -gt 0 ]' });
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
    assert.strictEqual((await focused(panel)).name, 'argument ]');
    await page.keyboard.press('Enter');
    assert.strictEqual((await focused(panel)).name, 'argument ]', 'Enter on a leaf folds nothing');

    // The layers: bash alone, then up to the languages.
    const layers = async () => panel.locator('#reading-tree').evaluate((t) => [...new Set([...t.querySelectorAll('li')].map((li) => li.className.match(/l-(\w+)/)![1]))].sort());
    await panel.locator('#layers button[data-level="1"]').click();
    assert.deepStrictEqual(await layers(), ['bash']);
    await panel.locator('#layers button[data-level="2"]').click();
    assert.deepStrictEqual(await layers(), ['bash', 'child']);
    assert.strictEqual(await panel.locator('#layers button[data-level="2"]').getAttribute('aria-pressed'), 'true');
    await panel.locator('#layers button[data-level="4"]').click();
    assert.deepStrictEqual(await layers(), ['bash', 'child', 'command', 'language']);
    await panel.locator('#layers button[data-level="3"]').click();

    // The view and the layers are kept for the next visit.
    await until('the choice kept', () => page.evaluate("localStorage.getItem('bash-explainer-panel')"), (v) => v === JSON.stringify({ view: 'tree', level: 3 }));
    panel = await open(page, "find . -name '*.sh' | xargs grep -n 'set -e'");
    await until('the tree view', () => panel.locator('#reading').isVisible(), (v) => v);
    assert.strictEqual(await panel.locator('#layers button[data-level="3"]').getAttribute('aria-pressed'), 'true');
    assert.deepStrictEqual(await layers(), ['bash', 'command']);
    // A click on a row folds it, as in the list.
    const tree2 = panel.locator('#reading-tree');
    await tree2.locator('li[aria-level="2"] > .trow').first().click();
    assert.strictEqual(await tree2.locator('li[aria-level="2"]').first().getAttribute('aria-expanded'), 'false');
    // And back to the list.
    await panel.locator('#view-list').click();
    assert.strictEqual(await panel.locator('#reading').isHidden(), true);
    assert.strictEqual(await panel.locator('#tree').isVisible(), true);
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  });

  /** The tree view of `line`, with the item at `level` focused (its path is the tab stop). */
  async function treeOf(page: Page, line: string): Promise<Frame> {
    const panel = await open(page, line);
    await panel.locator('#view-tree').click();
    await until('the tree', () => panel.locator('#reading-tree li').count(), (n) => n > 3);
    return panel;
  }
  const pause = (page: Page) => page.waitForTimeout(700);
  const activeName = (panel: Frame) => panel.evaluate(`(() => { const e = document.activeElement; return (e.getAttribute('aria-label') || e.id || e.tagName).split('.')[0]; })()`) as Promise<string>;

  it('keeps the focus on the layer button pressed, and on the item after Enter', async () => {
    const ctx = await browser.newContext({ locale: 'en-US' });
    const page = await ctx.newPage();
    const panel = await treeOf(page, 'x=$(grep -c foo f) && [ "$x" -gt 0 ]');
    const button = panel.locator('#layers button[data-level="2"]');
    await button.click();
    assert.strictEqual(await button.getAttribute('aria-pressed'), 'true');
    assert.strictEqual(await panel.evaluate(`document.activeElement.dataset.level`), '2', 'the button keeps the focus');
    await page.keyboard.press('Space');
    assert.strictEqual(await panel.evaluate(`document.activeElement.dataset.level`), '2', 'and again after another render');

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
    const ctx = await browser.newContext({ locale: 'en-US' });
    const page = await ctx.newPage();
    const panel = await treeOf(page, 'x=$(grep -c foo f) && [ "$x" -gt 0 ]');
    const tree = panel.locator('#reading-tree');
    await tree.locator('li[tabindex="0"]').focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowRight');
    assert.strictEqual((await focused(panel)).level, '3');
    await panel.evaluate(`document.getElementById('toggle').click()`);
    assert.strictEqual(await panel.locator('#toggle').textContent(), 'Expand all');
    assert.strictEqual(await tree.locator('li[tabindex="0"]').count(), 1);
    assert.strictEqual(await tree.locator('li[tabindex="0"]').isVisible(), true);
    await panel.locator('#view-list').click();
    assert.strictEqual(await panel.locator('#toggle').textContent(), 'Collapse all', 'the list is not folded');
    await panel.locator('#view-tree').click();
    await until('the tree', () => panel.locator('#reading-tree li').count(), (n) => n > 3);
    assert.strictEqual(await panel.locator('#toggle').textContent(), 'Expand all');
    await ctx.close();
  });

  it('reaches the manual links of the focused item with Tab', async () => {
    const ctx = await browser.newContext({ locale: 'en-US' });
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

  it('works when the browser refuses storage', async () => {
    const ctx = await browser.newContext({ locale: 'en-US' });
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
    await panel.locator('#layers button[data-level="1"]').click();
    await panel.locator('#view-list').click();
    assert.strictEqual(await panel.locator('#tree').isVisible(), true);
    await panel.locator('#view-tree').click();
    await until('the tree again', () => panel.locator('#reading-tree li').count(), (n) => n > 0);
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  });

  it('fits a phone: no sideways scroll, in Japanese', async () => {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 800 }, locale: 'ja-JP' });
    const page = await ctx.newPage();
    const panel = await open(page, "find . -name '*.sh' | xargs grep -n 'set -e'");
    await panel.locator('#view-tree').click();
    await until('the tree', () => panel.locator('#reading-tree li').count(), (n) => n > 10);
    assert.strictEqual(await panel.locator('#view-tree').textContent(), 'ツリー');
    assert.strictEqual(await panel.locator('#reading-tree li').count() > 10, true);
    assert.strictEqual(await panel.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), true);
    await ctx.close();
  });
});
