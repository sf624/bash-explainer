// The name hints in the web page's editor (web/name-hints.ts, from src/ui/nameHints.ts as in VS Code), in headless
// Chromium: a hint after a command name that does not run what it suggests, none after one that does, in both
// languages; its tooltip; a click explains its line in the panel; `bashExplainer.hints.names` turns them off; and at a
// phone's widths a long hint wraps with the line (with `editor.wrap`) and nothing runs past the right edge. The
// geometry is read from positions, not from how wide a font draws the words.
import * as assert from 'assert';
import type { Browser, Page } from 'playwright-core';
import { openSite, until } from './support/site';

const SHADOWED = 'cd() { builtin cd "$@"; }; cd /tmp';

describe('the web page: name hints in the editor', function () {
  this.timeout(120000);
  let browser: Browser;
  let base = '';
  before(async function () {
    ({ browser, base } = await openSite(this));
  });

  const panel = (page: Page) => page.frames().find((f) => f.url().endsWith('/panel.html'))!;
  const hints = (page: Page) => page.locator('.cm-bx-hint').allTextContents();

  async function open(page: Page, text: string): Promise<void> {
    await page.goto(base);
    await until('the panel', () => Promise.resolve(panel(page)), (f) => !!f);
    await type(page, text);
  }

  async function type(page: Page, text: string): Promise<void> {
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText(text);
  }

  for (const [lang, label] of [['en', 'function, not the builtin'], ['ja', '関数（ビルトインではない）']] as const) {
    it(`marks a function that hides a builtin, not the builtin itself (${lang})`, async () => {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: lang === 'ja' ? 'ja-JP' : 'en-US' });
      const page = await ctx.newPage();
      await open(page, SHADOWED);
      assert.deepStrictEqual(await until('the hint', () => hints(page), (h) => h.length > 0), [label]);
      // Just after the second `cd`, the one that calls the function.
      const before = await page.evaluate(`(() => {
        const h = document.querySelector('.cm-bx-hint');
        const line = h.closest('.cm-line').textContent;
        return line.slice(0, line.indexOf(h.textContent));
      })()`);
      assert.strictEqual(before, 'cd() { builtin cd "$@"; }; cd');
      // The tooltip: what runs, and what a click does.
      await page.locator('.cm-bx-hint').hover();
      const tip = await until('the tooltip', () => page.locator('.cm-bx-hint-tip').allInnerTexts(), (t) => t.length === 1);
      assert.match(tip[0], lang === 'ja' ? /cd\s*関数[\s\S]*パネルに表示/ : /cd\s*function[\s\S]*Click to explain this line in the panel/);
      // A plain `cd` runs the builtin, as its name says: no hint.
      await type(page, 'cd /tmp');
      await until('no hint', () => hints(page), (h) => h.length === 0);
      await page.waitForTimeout(600);
      assert.deepStrictEqual(await hints(page), []);
      await ctx.close();
    });
  }

  it('explains the line of a hint clicked, and follows the setting', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-US' });
    const page = await ctx.newPage();
    await open(page, `echo first\n${SHADOWED}`);
    await until('the hint', () => hints(page), (h) => h.length === 1);
    await page.keyboard.press('Control+Home');
    await until('the first line explained', async () => (await panel(page).locator('#line').textContent()) ?? '', (t) => t.includes('echo first'));
    await page.locator('.cm-bx-hint').click();
    await until('the hint\'s line explained', async () => (await panel(page).locator('#line').textContent()) ?? '', (t) => t.includes('cd /tmp'));
    // The cursor is on the name the hint is about.
    assert.deepStrictEqual(await page.evaluate(`(() => { const s = getSelection(); return [s.anchorNode.textContent, s.anchorOffset]; })()`), ['cd', 0]);
    // Off in the settings: no hints; on again: back.
    await page.locator('#settings-open').click();
    assert.strictEqual(await page.locator('#setting-hints-names').isChecked(), true);
    assert.match(await page.locator('[data-key="hints.names"]').innerText(), /Name hints/);
    await page.locator('#setting-hints-names').uncheck();
    await until('no hint', () => hints(page), (h) => h.length === 0);
    await page.locator('#setting-hints-names').check();
    await until('the hint again', () => hints(page), (h) => h.length === 1);
    await page.locator('#settings-done').click();
    await ctx.close();
  });

  for (const lang of ['en', 'ja'] as const) {
    it(`stays inside the editor at a phone's widths, with long lines wrapped (${lang})`, async () => {
      const ctx = await browser.newContext({ viewport: { width: 320, height: 760 }, locale: lang === 'ja' ? 'ja-JP' : 'en-US', hasTouch: true, isMobile: true });
      await ctx.addInitScript("try { localStorage.setItem('bash-explainer-settings', JSON.stringify({ 'editor.wrap': true })); } catch {}");
      const page = await ctx.newPage();
      await open(page, `${SHADOWED}\nsudo cd /root/a/long/directory/name\nenable -n echo; echo hi`);
      await until('the hints', () => hints(page), (h) => h.length === 3);
      // Every width from 320 to 440: where a line wraps depends on how wide the font draws the words, so a few widths
      // chosen in advance would pass or fail by the font (a hint cut at the end of a line once ran past the edge).
      for (let width = 320; width <= 440; width++) {
        await page.setViewportSize({ width, height: 760 });
        await page.evaluate('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))');
        const got = await page.evaluate(`(() => {
          const content = document.querySelector('.cm-content').getBoundingClientRect();
          const sc = document.querySelector('.cm-scroller');
          return { vw: document.documentElement.clientWidth, sw: document.documentElement.scrollWidth, over: sc.scrollWidth - sc.clientWidth,
            right: content.right, hints: [...document.querySelectorAll('.cm-bx-hint')].flatMap((h) => [...h.getClientRects()].map((r) => r.right)) };
        })()`) as { vw: number; sw: number; over: number; right: number; hints: number[] };
        assert.ok(got.sw <= got.vw, `${width}: the page is ${got.sw} wide`);
        assert.ok(got.over <= 1, `${width}: the editor scrolls sideways by ${got.over}px`);
        for (const r of got.hints) assert.ok(r <= Math.min(got.right, got.vw) + 0.5, `${width}: a hint ends at ${r}, the text at ${got.right}`);
      }
      await ctx.close();
    });
  }
});
