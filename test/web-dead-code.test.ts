// Code that never runs, faded in the web page's editor (a CodeMirror hint range with the class `cm-bx-dead`, from
// `deadCodeHints`), in headless Chromium: the faded text is the dead statements only, over their lines; it is not in
// the Problems list; its tooltip says why; `bashExplainer.hints.deadCode` turns it off; and a screenshot of the
// faded branch in both colour schemes is kept when `DEAD_CODE_SHOTS` names a directory.
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import type { Browser, Page } from 'playwright-core';
import { openSite, openProblems, problemsShown, until } from './support/site';

const SCRIPT = '#!/bin/bash\nx=1\nif [ "$x" = 2 ]; then\n  echo "never"\n  rm -rf /tmp/build\nelse\n  echo "always"\nfi\nexit 0\necho "after exit"';

describe('the web page: code that never runs, faded in the editor', function () {
  this.timeout(120000);
  let browser: Browser;
  let base = '';
  before(async function () {
    ({ browser, base } = await openSite(this));
  });

  const faded = (page: Page) => page.locator('.cm-bx-dead').allTextContents();

  async function open(page: Page, text: string): Promise<void> {
    await page.goto(base);
    await until('the editor', () => page.locator('.cm-content').count(), (n) => n > 0);
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText(text);
  }

  for (const [lang, locale] of [['en', 'en-US'], ['ja', 'ja-JP']] as const) {
    it(`fades the statements that never run, and says why in the tooltip (${lang})`, async () => {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale });
      const page = await ctx.newPage();
      await open(page, SCRIPT);
      const got = await until('the faded text', () => faded(page), (t) => t.length > 0);
      // (A range over two lines is drawn once on each line.)
      assert.deepStrictEqual(got.map((t) => t.trim()).filter(Boolean), ['echo "never"', 'rm -rf /tmp/build', 'echo "after exit"']);
      assert.strictEqual(await page.evaluate("getComputedStyle(document.querySelector('.cm-bx-dead')).opacity"), '0.5');
      // Not a problem: none in the Problems list, no mark in the gutter.
      assert.strictEqual(await problemsShown(page), false);
      assert.strictEqual(await page.locator('.cm-lint-marker').count(), 0);
      await page.locator('.cm-bx-dead').first().hover();
      const tip = await until('the tooltip', () => page.locator('.cm-tooltip-lint').allInnerTexts(), (t) => t.length === 1);
      assert.match(tip[0], lang === 'ja' ? /ここは実行されない/ : /This never runs/);
      // Typing code that runs fades nothing.
      await page.locator('.cm-content').click();
      await page.keyboard.press('Control+A');
      await page.keyboard.insertText('echo hi\nif [ -f x ]; then echo y; fi');
      await until('nothing faded', () => faded(page), (t) => t.length === 0);
      await ctx.close();
    });
  }

  it('follows the setting, and keeps the faded text apart from the warnings', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-US' });
    const page = await ctx.newPage();
    // (A warning in live code: `x = 1`, with dead code after it.)
    await open(page, 'x = 1\nexit\necho dead');
    await until('the faded text', () => faded(page), (t) => t.length > 0);
    assert.strictEqual(await (await openProblems(page)).count(), 1, 'only the warning is listed');
    await page.locator('#settings-open').click();
    const box = page.locator('[data-key="hints.deadCode"] input[type=checkbox]');
    assert.strictEqual(await box.isChecked(), true);
    assert.match(await page.locator('[data-key="hints.deadCode"]').innerText(), /Fade code that never runs/);
    await box.uncheck();
    await until('nothing faded', () => faded(page), (t) => t.length === 0);
    await box.check();
    await until('faded again', () => faded(page), (t) => t.length > 0);
    await page.locator('#settings-done').click();
    await ctx.close();
  });

  for (const scheme of ['light', 'dark'] as const) {
    it(`draws a faded branch (${scheme})`, async () => {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: scheme, locale: 'en-US' });
      const page = await ctx.newPage();
      await open(page, SCRIPT);
      await until('the faded text', () => faded(page), (t) => t.length > 0);
      await page.mouse.move(5, 5);
      const dir = process.env.DEAD_CODE_SHOTS;
      if (dir) {
        fs.mkdirSync(dir, { recursive: true });
        await page.screenshot({ path: path.join(dir, `dead-code-${scheme}.png`) });
      }
      // The faded text is dimmer than the live text next to it.
      const [live, dead] = await page.evaluate(`(() => {
        const line = (text) => [...document.querySelectorAll('.cm-line')].find((l) => l.textContent.includes(text));
        const opacity = (l) => Number(getComputedStyle(l.querySelector('span') ?? l).opacity);
        return [opacity(line('always')), Number(getComputedStyle(line('never').querySelector('.cm-bx-dead')).opacity)];
      })()`) as [number, number];
      assert.ok(dead < live, `${dead} < ${live}`);
      await ctx.close();
    });
  }
});
