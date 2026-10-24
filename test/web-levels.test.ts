// The levels of the notes on the web page (docs/design/note-levels.md), run for real in headless Chromium (the
// build, the server and the browser are shared by all test/web-*.test.ts files: test/support/site.ts): the panel
// draws each note with the icon and the word of its level, warnings first, in web/theme.css's colours, and underlines
// the problems in its copy of the line; the Problems list marks each problem with ⚠ or ⓘ in the same colours.
import * as assert from 'assert';
import type { Browser } from 'playwright-core';
import { openSite, until } from './support/site';

const rgb = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;

describe('the web page: the levels of the notes', function () {
  this.timeout(120000);
  let browser: Browser;
  let base = '';

  before(async function () {
    ({ browser, base } = await openSite(this));
  });

  for (const [scheme, warning, info] of [['light', '#855f00', '#005fb8'], ['dark', '#cca700', '#3794ff']] as const) {
    it(`shows the levels in the panel and in the Problems list, ${scheme}`, async () => {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: scheme, locale: 'en-US' });
      const page = await ctx.newPage();
      await page.goto(base);
      const panel = () => page.frames().find((f) => f.url().endsWith('/panel.html'))!;
      await until('the panel', () => Promise.resolve(panel()), (f) => !!f);
      await page.locator('.cm-content').click();
      await page.keyboard.press('Control+A');
      await page.keyboard.insertText('exit 300; read line; x = 1');
      await until('the line explained', () => panel().locator('#notes .note').count(), (n) => n === 3);
      const notes = await panel().evaluate(`[...document.querySelectorAll('#notes .note')].map((p) => {
        const label = p.querySelector('.note-label');
        return [p.className, p.querySelector('svg.note-icon').dataset.icon, label ? label.textContent : '', getComputedStyle(p.querySelector('svg.note-icon')).fill];
      })`) as string[][];
      assert.deepStrictEqual(notes.map((n) => n.slice(0, 3)), [['note level-warning', 'warning', 'Pitfall:'], ['note level-info', 'info', 'Caveat:'], ['note level-note', 'info', '']]);
      assert.deepStrictEqual(notes.slice(0, 2).map((n) => n[3]), [rgb(warning), rgb(info)]);
      // The panel's copy of the line underlines the problems the editor shows.
      const marked = await until('the squiggles', () => panel().locator('#line .squiggle').allTextContents(), (t) => t.length > 0);
      assert.strictEqual(marked.join('').replace(/\s/g, ''), 'readlinex=1');
      // The Problems list: ⚠ and ⓘ, in the levels' colours.
      const rows = await until('the problems', () => page.locator('#problem-list .icon').evaluateAll((els) => els.map((e) => [e.textContent, e.ownerDocument.defaultView!.getComputedStyle(e).color])), (r) => r.length === 2);
      assert.deepStrictEqual(rows, [['ⓘ', rgb(info)], ['⚠', rgb(warning)]]);
      await ctx.close();
    });
  }
});
