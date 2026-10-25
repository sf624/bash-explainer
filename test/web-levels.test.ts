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
      // The editor: a wavy squiggle in the level's colour, and in the gutter the panel's icon (the Codicon of
      // media/icons.js, as a mask) in that colour. (A line's marker is of its worst problem: a line of information.)
      await page.keyboard.press('Control+End');
      await page.keyboard.insertText('\nread other');
      await until('the information marker', () => page.locator('.cm-lint-marker-info').count(), (n) => n === 1);
      const marks = await page.evaluate(`(['warning', 'info']).map((level) => {
        const range = getComputedStyle(document.querySelector('.cm-lintRange-' + level));
        const marker = getComputedStyle(document.querySelector('.cm-lint-marker-' + level));
        const mask = marker.maskImage || marker.webkitMaskImage;
        const icon = BashExplainerIcons.ICONS[level][0];
        return [level, range.textDecorationLine, range.textDecorationStyle, range.textDecorationColor, range.backgroundImage,
          marker.backgroundColor, mask.includes(encodeURIComponent(icon.slice(0, 40)))];
      })`) as unknown[][];
      assert.deepStrictEqual(marks, [
        ['warning', 'underline', 'wavy', rgb(warning), 'none', rgb(warning), true],
        ['info', 'underline', 'wavy', rgb(info), 'none', rgb(info), true],
      ]);
      // The gutter's tooltip starts each problem with that icon, named for a screen reader.
      await page.locator('.cm-lint-marker-info').hover();
      const icons = await until('the tooltip', () => page.locator('.cm-tooltip-lint svg.cm-bx-level').evaluateAll((els) => els.map((e) => [e.getAttribute('data-icon'), e.getAttribute('role'), e.getAttribute('aria-label'), e.ownerDocument.defaultView!.getComputedStyle(e).fill])), (r) => r.length > 0);
      assert.deepStrictEqual(icons, [['info', 'img', 'Information', rgb(info)]]);
      await ctx.close();
    });
  }

  it('lists every warning and caveat of the explanations as a problem, on its part, and says it once in the hover', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-US' });
    const page = await ctx.newPage();
    await page.goto(base);
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    // A caveat of the catalog, a failure, and a plain fact (`exit 300`), none of them a problem before.
    await page.keyboard.insertText('#!/bin/bash\nf() {\n  local x=$(false)\n}\n[ -f a\nexit 300');
    const rows = await until('the problems', () => page.locator('#problem-list li').evaluateAll((els) => els.map((e) => [...e.querySelectorAll('.icon, .where, .code')].map((x) => x.textContent))), (r) => r.length === 2);
    assert.deepStrictEqual(rows, [['ⓘ', 'Ln 3', 'declaration-masks-status'], ['⚠', 'Ln 5', 'bracket-missing-close']]);
    // The squiggles cover the parts the notes are about.
    const ranges = await page.evaluate(`(['info', 'warning']).map((level) => [...document.querySelectorAll('.cm-lintRange-' + level)].map((e) => e.textContent).join(''))`);
    assert.deepStrictEqual(ranges, ['local x=$(false)', '[ -f a']);
    // The hover on `local`: the problem in the lint's section, and not again in the card.
    const p = await page.evaluate(`(() => {
      const el = document.querySelectorAll('.cm-line')[2];
      const r = document.createRange();
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      while (walker.nextNode() && !walker.currentNode.data.includes('local'));
      const at = walker.currentNode.data.indexOf('local');
      r.setStart(walker.currentNode, at);
      r.setEnd(walker.currentNode, at + 1);
      const b = r.getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    })()`) as { x: number; y: number };
    await page.mouse.move(p.x, p.y);
    const box = page.locator('.cm-tooltip-hover');
    await until('the problem and the card', () => box.locator('> *').count(), (n) => n === 2);
    const all = await box.innerText();
    assert.strictEqual(all.split('hides a failure inside').length - 1, 1, all);
    await ctx.close();
  });
});
