// The sentence of the line, "In short" (src/linesentence.ts; docs/design/panel-redesign.md, P5), on the web page's
// panel (media/panel.js, the same panel as VS Code's), in headless Chromium: it is at the top of the Meaning view, above
// the problems, in the page's language, and gone in the Reading view; a long sentence wraps inside the panel at a
// phone's width. Screenshots are kept when `SENTENCE_SHOTS` names a directory.
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import type { Browser, Frame, Page } from 'playwright-core';
import { Analyzer } from '../src/analyzer';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { chooseView, openSite, until } from './support/site';

const SCRIPT = [
  '#!/bin/bash',
  'while read -r line; do',
  '  echo "$line"',
  'done < input.txt',
  'rm -rf $dir/ || echo "failed" >&2',
  'grep -rn "ERROR $USER" ./src 2>&1 | sort -u > errors.txt && echo "done: $(date +%F)" || exit 1',
].join('\n');

/** The sentence the analyzer gives a line of SCRIPT, as the panel draws it: the code spans' text alone. */
const expected = (line: number, lang: 'en' | 'ja'): string => new Analyzer(lang).explainLine(createUnbashParser().parse(SCRIPT), line, undefined, { sentence: true }).sentence!.replace(/`/g, '');

describe('the web page: the sentence of the line, "In short"', function () {
  this.timeout(120000);
  let browser: Browser;
  let base = '';
  before(async function () {
    ({ browser, base } = await openSite(this));
  });

  async function open(page: Page): Promise<Frame> {
    await page.goto(base);
    await until('the editor', () => page.locator('.cm-content').count(), (n) => n > 0);
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText(SCRIPT);
    return page.frames().find((f) => f.url().endsWith('/panel.html'))!;
  }

  /**
   * Puts the cursor on line `line` (0-based) and waits for the panel to explain it. (The last line by Ctrl+End: the long
   * line wraps, and a key down moves by a row of the screen.)
   */
  async function goTo(page: Page, panel: Frame, line: number): Promise<void> {
    await page.keyboard.press('Control+Home');
    if (line === SCRIPT.split('\n').length - 1) await page.keyboard.press('Control+End');
    else for (let i = 0; i < line; i++) await page.keyboard.press('ArrowDown');
    const text = SCRIPT.split('\n')[line].trim().slice(0, 12);
    await until('the line explained', async () => (await panel.locator('#line').textContent()) ?? '', (t) => t.includes(text));
  }

  for (const [lang, locale] of [['en', 'en-US'], ['ja', 'ja-JP']] as const) {
    for (const width of [390, 1280]) {
      it(`starts the Meaning view with the sentence, above the problems, wrapped in the panel (${lang}, ${width} px)`, async () => {
        const ctx = await browser.newContext({ viewport: { width, height: 900 }, locale });
        const page = await ctx.newPage();
        const panel = await open(page);
        const label = lang === 'ja' ? 'ひとことで' : 'In short';
        for (const [line, name] of [[3, 'closing'], [4, 'problem'], [5, 'long']] as const) {
          await goTo(page, panel, line);
          const short = panel.locator('#short');
          assert.strictEqual(await until('the sentence', async () => (await short.isVisible() ? await short.textContent() : '') ?? '', (t) => t.length > 0), `${label} ${expected(line, lang)}`);
          // (First in the view, above the problems; inside the panel, with no part past its right edge.)
          const box = await panel.evaluate(`(() => {
            const e = document.getElementById('short');
            const r = e.getBoundingClientRect();
            const notes = document.getElementById('notes').getBoundingClientRect();
            return { bottom: r.bottom, right: r.right, notes: notes.top, width: document.documentElement.clientWidth, scroll: e.scrollWidth - e.clientWidth, first: e.parentElement.firstElementChild === e };
          })()`) as { bottom: number; right: number; notes: number; width: number; scroll: number; first: boolean };
          assert.ok(box.first && box.bottom <= box.notes + 1 && box.right <= box.width && box.scroll <= 0, JSON.stringify(box));
          const dir = process.env.SENTENCE_SHOTS;
          if (dir) {
            fs.mkdirSync(dir, { recursive: true });
            await page.screenshot({ path: path.join(dir, `sentence-${name}-${lang}-${width}.png`) });
          }
        }
        // (The Reading view has none.)
        await chooseView(page, 'tree');
        await until('hidden in Reading', () => panel.locator('#short').isVisible(), (v) => !v);
        await ctx.close();
      });
    }
  }
});
