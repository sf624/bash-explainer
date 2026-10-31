// The quick fixes of the web page's editor (CodeMirror's lint actions, web/editor.ts), in headless Chromium: a note
// that suggests rewrites (docs/design/panel-redesign.md, P3) shows each as a button in its tooltip, the first the one
// it recommends, in the page's language; a press makes its edits. The tooltip stays inside the window at a phone's
// width, where it scrolls to its last button. Screenshots of the tooltip are kept when `QUICKFIX_SHOTS` names a directory.
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import type { Browser, Page } from 'playwright-core';
import { openSite, until } from './support/site';

describe('the web page: the quick fixes of the notes', function () {
  this.timeout(120000);
  let browser: Browser;
  let base = '';
  before(async function () {
    ({ browser, base } = await openSite(this));
  });

  async function open(page: Page, text: string): Promise<void> {
    await page.goto(base);
    await until('the editor', () => page.locator('.cm-content').count(), (n) => n > 0);
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText(text);
  }

  const TITLES = {
    en: ['Rewrite as `source "$(dirname "${BASH_SOURCE[0]}")"/lib.sh`', 'Rewrite as `source ./lib.sh`'],
    ja: ['`source "$(dirname "${BASH_SOURCE[0]}")"/lib.sh` に書き換える', '`source ./lib.sh` に書き換える'],
  };
  for (const [lang, locale] of [['en', 'en-US'], ['ja', 'ja-JP']] as const) {
    for (const width of [390, 1280]) {
      it(`offers each rewrite of a note in its tooltip, and makes it (${lang}, ${width} px)`, async () => {
        const ctx = await browser.newContext({ viewport: { width, height: 800 }, locale });
        const page = await ctx.newPage();
        await open(page, '#!/bin/bash\nsource lib.sh\necho done');
        await until('the warning', () => page.locator('.cm-lintRange-warning').count(), (n) => n > 0);
        await page.locator('.cm-lintRange-warning').first().hover();
        const buttons = page.locator('.cm-tooltip-lint .cm-diagnosticAction');
        assert.deepStrictEqual(await until('the quick fixes', () => buttons.allTextContents(), (t) => t.length === 2), TITLES[lang]);
        // (Inside the window: no part of the tooltip, nor of a button, past its right edge.)
        const right = await page.locator('.cm-tooltip-lint').evaluate((tip) => Math.max(...[tip, ...tip.querySelectorAll('.cm-diagnosticAction')].map((e) => e.getBoundingClientRect().right)));
        assert.ok(right <= width, `${right} > ${width}`);
        // (On a narrow pane the box is as high as the room by the line, and scrolls: the last button comes into view.)
        await buttons.last().scrollIntoViewIfNeeded();
        const seen = await buttons.last().evaluate((b) => {
          const [box, tip] = [b.getBoundingClientRect(), b.closest('.cm-tooltip')!.getBoundingClientRect()];
          return box.top >= tip.top && box.bottom <= tip.bottom;
        });
        assert.ok(seen, 'the last quick fix scrolls into view');
        const dir = process.env.QUICKFIX_SHOTS;
        if (dir) {
          fs.mkdirSync(dir, { recursive: true });
          await page.screenshot({ path: path.join(dir, `quickfix-${lang}-${width}.png`) });
        }
        await buttons.first().click();
        await until('the rewrite', () => page.locator('.cm-content').innerText(), (t) => t.includes('source "$(dirname "${BASH_SOURCE[0]}")"/lib.sh'));
        await until('no warning left', () => page.locator('.cm-lintRange-warning').count(), (n) => n === 0);
        await ctx.close();
      });
    }
  }
});
