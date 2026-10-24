// The header of the VS Code panel (src/ui/panelView.ts PANEL_BODY, media/panel.js, media/panel.css), in headless
// Chromium with the theme variables of VS Code's own themes (test/support/panel-page.ts): its icon buttons have
// names and tooltips, VS Code's hover and focus ring, and do what they say; the view switch and the dropdowns work;
// a narrow panel wraps it in two rows. Skipped when no browser can start, unless $BASH_EXPLAINER_BROWSER is set.
import * as assert from 'assert';
import type { Browser, Page } from 'playwright-core';
import { PanelServer, PanelTheme, servePanel } from './support/panel-page';
import { until } from './support/site';

describe('the VS Code panel: its header', function () {
  this.timeout(60000);
  let browser: Browser | undefined;
  let panel: PanelServer;

  before(async function () {
    if (Number(process.versions.node.split('.')[0]) < 20) return this.skip();
    try {
      const { chromium } = await import('playwright-core');
      browser = await chromium.launch();
    } catch (e) {
      if (process.env.BASH_EXPLAINER_BROWSER) throw e;
      return this.skip();
    }
    panel = await servePanel();
  });

  after(async () => {
    await browser?.close();
    await panel?.close();
  });

  /** Opens the panel; `errors` collects what the page reports (a script error, a refused style or script). */
  async function open(theme: PanelTheme = 'dark', width = 600, lang: 'en' | 'ja' = 'en', server = panel): Promise<Page & { errors: string[] }> {
    const page = await browser!.newPage({ viewport: { width, height: 420 } });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.goto(server.url(theme, lang));
    await until('the line', () => page.locator('#where').textContent(), (t) => !!t);
    return Object.assign(page, { errors });
  }
  const posted = (page: Page) => page.evaluate('window.POSTED.map((m) => m.type)') as Promise<string[]>;
  const icon = (page: Page, id: string) => page.evaluate(`(() => { const s = document.querySelector('#${id} svg'); return s.dataset.icon + ' ' + s.querySelectorAll('path').length; })()`) as Promise<string>;

  it('names every icon button, as its tooltip and its accessible name, and draws its icon', async () => {
    const page = await open();
    const names = await page.evaluate(`[...document.querySelectorAll('header .tb')].map((b) => [b.id, b.title, b.getAttribute('aria-label'), b.textContent, b.querySelector('svg').getAttribute('aria-hidden')])`);
    assert.deepStrictEqual(names, [
      ['toggle', 'Collapse all', 'Collapse all', '', 'true'],
      ['copy', 'Copy as Markdown', 'Copy as Markdown', '', 'true'],
      ['ref', 'Quick reference', 'Quick reference', '', 'true'],
      ['settings', 'Settings', 'Settings', '', 'true'],
    ]);
    for (const [id, want] of [['toggle', 'collapse-all 3'], ['copy', 'copy 1'], ['ref', 'book 1'], ['settings', 'gear 1']]) assert.strictEqual(await icon(page, id), want);
    assert.strictEqual(await page.locator('#ref').getAttribute('aria-pressed'), 'false');
    // The shell's dropdown: named by its label (for screen readers only) and its tooltip; its arrow is an icon.
    assert.strictEqual(await page.getByRole('combobox', { name: 'Shell' }).getAttribute('title'), 'Shell');
    assert.strictEqual(await page.locator('#shell-box .ico path').count(), 1);
    // The view switch: two words, the view shown pressed.
    assert.deepStrictEqual(await page.evaluate(`[...document.querySelectorAll('#views button')].map((b) => b.textContent + ' ' + b.getAttribute('aria-pressed'))`), ['List true', 'Tree false']);
    assert.strictEqual(await page.locator('#views').getAttribute('aria-label'), 'View');
    assert.strictEqual(await page.locator('header #views').count(), 1, 'the view switch is in the header');
    const ja = await open('dark', 600, 'ja');
    assert.deepStrictEqual(await ja.evaluate(`[...document.querySelectorAll('header .tb, #views button')].map((b) => b.title || b.textContent)`), ['一覧', 'ツリー', 'すべて折りたたむ', 'Markdown でコピー', '早見表', '設定']);
    assert.deepStrictEqual([...page.errors, ...ja.errors], []);
    await page.close();
    await ja.close();
  });

  it('posts what the buttons do, and changes the name and the icon of the fold and the reference buttons', async () => {
    const page = await open();
    await page.locator('#copy').click();
    await page.locator('#settings').click();
    assert.deepStrictEqual((await posted(page)).filter((t) => t === 'copy' || t === 'openSettings'), ['copy', 'openSettings']);
    await page.locator('#toggle').click();
    assert.strictEqual(await page.locator('#toggle').getAttribute('aria-label'), 'Expand all');
    assert.strictEqual(await page.locator('#toggle').getAttribute('title'), 'Expand all');
    assert.strictEqual(await icon(page, 'toggle'), 'expand-all 1');
    await page.locator('#toggle').click();
    assert.strictEqual(await page.locator('#toggle').getAttribute('aria-label'), 'Collapse all');
    assert.strictEqual(await icon(page, 'toggle'), 'collapse-all 3');
    await page.locator('#ref').click();
    assert.strictEqual(await page.locator('#reference').isVisible(), true);
    assert.deepStrictEqual(await page.evaluate(`['aria-pressed', 'aria-label', 'title'].map((a) => document.getElementById('ref').getAttribute(a))`), ['true', '← Back to the explanation', '← Back to the explanation']);
    assert.strictEqual(await icon(page, 'ref'), 'arrow-left 1');
    await page.locator('#ref').click();
    assert.strictEqual(await page.locator('#ref').getAttribute('aria-pressed'), 'false');
    assert.strictEqual(await icon(page, 'ref'), 'book 1');
    // The view switch: the tree, then the list again, each time told to the host.
    await page.locator('#view-tree').click();
    assert.deepStrictEqual(await page.evaluate(`[...document.querySelectorAll('#views button')].map((b) => b.getAttribute('aria-pressed'))`), ['false', 'true']);
    assert.strictEqual(await page.locator('#reading').isVisible(), true);
    assert.deepStrictEqual(await page.evaluate('window.POSTED.filter((m) => m.type === "panelState").map((m) => m.state.view)'), ['tree']);
    await page.locator('#view-list').click();
    assert.strictEqual(await page.locator('#tree').isVisible(), true);
    assert.deepStrictEqual(page.errors, []);
    await page.close();
  });

  it('has VS Code\'s hover and 1px focus ring in each theme, a dashed hover outline in high contrast', async () => {
    // (toolbar.hoverOutline is set in high contrast only: elsewhere the outline is transparent.)
    const none = 'dashed rgba(0, 0, 0, 0)';
    const want: Record<PanelTheme, { focus: string; hover: string; outline: string }> = {
      dark: { focus: 'rgb(0, 120, 212)', hover: 'rgba(90, 93, 94, 0.31)', outline: none },
      light: { focus: 'rgb(0, 95, 184)', hover: 'rgba(184, 184, 184, 0.31)', outline: none },
      hc: { focus: 'rgb(243, 133, 24)', hover: 'rgba(0, 0, 0, 0)', outline: 'dashed rgb(243, 133, 24)' },
    };
    for (const theme of ['dark', 'light', 'hc'] as const) {
      const page = await open(theme);
      await page.locator('#copy').hover();
      const hover = await page.evaluate(`(() => { const s = getComputedStyle(document.getElementById('copy')); return [s.backgroundColor, s.outlineStyle + ' ' + s.outlineColor]; })()`) as string[];
      assert.deepStrictEqual(hover, [want[theme].hover, want[theme].outline], theme);
      await page.mouse.move(0, 400);
      // The keyboard: from the fold button to the copy button.
      await page.locator('#toggle').focus();
      await page.keyboard.press('Tab');
      assert.strictEqual(await page.evaluate('document.activeElement.id'), 'copy');
      const ring = await page.evaluate(`(() => { const s = getComputedStyle(document.getElementById('copy')); return [s.outlineStyle, s.outlineWidth, s.outlineColor].join(' '); })()`);
      assert.strictEqual(ring, `solid 1px ${want[theme].focus}`, theme);
      assert.deepStrictEqual(page.errors, [], theme);
      await page.close();
    }
  });

  it('keeps the line and the shell on the first row of a narrow panel, the views and the buttons on the second', async () => {
    for (const lang of ['en', 'ja'] as const) {
      const page = await open('dark', 300, lang);
      const box = (s: string) => page.locator(s).boundingBox().then((b) => b!);
      const [where, shell, views, tools] = await Promise.all(['.where', '#shell', '#views', '.tools'].map(box));
      assert.ok(Math.abs(where.y + where.height / 2 - (shell.y + shell.height / 2)) < 1, lang);
      assert.ok(views.y > shell.y + shell.height && Math.abs(views.y - tools.y) < 1, lang);
      assert.ok(tools.x + tools.width <= 300 - 16 + 0.5, lang);
      assert.strictEqual(await page.evaluate('document.documentElement.scrollWidth <= innerWidth'), true, lang);
      await page.close();
    }
  });

  it('shows the yq dropdown on a line that runs yq, and posts the choice', async () => {
    const yq = await servePanel("yq '.a' config.yaml");
    try {
      const page = await open('dark', 600, 'en', yq);
      assert.strictEqual(await page.locator('#yq-box').isVisible(), true);
      assert.strictEqual(await page.getByRole('combobox', { name: 'yq' }).count(), 1);
      const value = await page.locator('#yq option').nth(1).getAttribute('value');
      await page.locator('#yq').selectOption(value!);
      assert.deepStrictEqual(await page.evaluate('window.POSTED.filter((m) => m.type === "override").map((m) => [m.key, m.value])'), [['yq', value]]);
      await page.close();
    } finally {
      await yq.close();
    }
  });
});
