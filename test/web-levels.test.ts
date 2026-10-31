// The levels of the notes on the web page (docs/design/note-levels.md), run for real in headless Chromium (the
// build, the server and the browser are shared by all test/web-*.test.ts files: test/support/site.ts): the panel
// draws each note with the icon and the word of its level, errors first, in web/theme.css's colours, and underlines
// the problems in its copy of the line; the Problems list marks each problem with ⓧ, ⚠ or ⓘ in the same colours.
import * as assert from 'assert';
import type { Browser } from 'playwright-core';
import { openSite, openProblems, problemRows, until } from './support/site';

const rgb = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;

describe('the web page: the levels of the notes', function () {
  this.timeout(120000);
  let browser: Browser;
  let base = '';

  before(async function () {
    ({ browser, base } = await openSite(this));
  });

  for (const [scheme, error, warning, info] of [['light', '#d0020f', '#855f00', '#005fb8'], ['dark', '#fd6358', '#cca700', '#3794ff']] as const) {
    it(`shows the levels in the panel and in the Problems list, ${scheme}`, async () => {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: scheme, locale: 'en-US' });
      const page = await ctx.newPage();
      await page.goto(base);
      const panel = () => page.frames().find((f) => f.url().endsWith('/panel.html'))!;
      await until('the panel', () => Promise.resolve(panel()), (f) => !!f);
      await page.locator('.cm-content').click();
      await page.keyboard.press('Control+A');
      await page.keyboard.insertText('exit 300; read line; source lib.sh; [ -f a');
      await until('the line explained', () => panel().locator('#notes .note').count(), (n) => n === 4);
      const notes = await panel().evaluate(`[...document.querySelectorAll('#notes .note')].map((p) => {
        const label = p.querySelector('.note-label');
        const icon = p.querySelector('svg.note-icon');
        return [p.className, icon.dataset.icon, label ? label.textContent : '', [icon.getAttribute('role'), icon.getAttribute('aria-label'), icon.getAttribute('aria-hidden')].join(), getComputedStyle(icon).fill, label ? getComputedStyle(label).color : ''];
      })`) as string[][];
      // (The error's icon has no name: its word says "Error". A warning's says "Warning", which "Pitfall" does not.)
      assert.deepStrictEqual(notes.map((n) => n.slice(0, 4)), [
        ['note level-error', 'error', 'Error:', ',,true'], ['note level-warning', 'warning', 'Pitfall:', 'img,Warning,'],
        ['note level-info', 'info', 'Caveat:', 'img,Information,'], ['note level-note', 'info', '', 'img,Note,'],
      ]);
      assert.deepStrictEqual(notes.slice(0, 3).map((n) => n.slice(4)), [[rgb(error), rgb(error)], [rgb(warning), rgb(warning)], [rgb(info), rgb(info)]]);
      // The panel's copy of the line underlines the problems the editor shows, each in its level's colour.
      const marked = await until('the squiggles', () => panel().locator('#line .squiggle').evaluateAll((els) => els.map((e) => [e.textContent, e.className, e.ownerDocument.defaultView!.getComputedStyle(e).textDecorationColor])), (t) => t.length > 2);
      // (Each part of the line is a span of its own: the parts of a level's squiggle, joined.)
      const levels = new Map<string, string[]>();
      for (const [t, c, colour] of marked) {
        const key = `${/level-\w+/.exec(c!)![0]} ${colour}`;
        levels.set(key, [...(levels.get(key) ?? []), t!]);
      }
      assert.deepStrictEqual([...levels].map(([key, parts]) => [parts.join('').replace(/\s/g, ''), ...key.split(/ (?=rgb)/)]), [
        ['readline', 'level-info', rgb(info)], ['lib.sh', 'level-warning', rgb(warning)], ['[-fa', 'level-error', rgb(error)],
      ]);
      // The Problems list: ⓧ, ⚠ and ⓘ, in the levels' colours, an error's message without the word "Error:"; in the
      // order of the script.
      await openProblems(page);
      const rows = await until('the problems', () => page.locator('#problem-list .problem').evaluateAll((els) => els.map((e) => {
        const icon = e.querySelector('.icon')!;
        return [icon.textContent, e.ownerDocument.defaultView!.getComputedStyle(icon).color, e.querySelector('.message')?.textContent?.slice(0, 8)];
      })), (r) => r.length === 3);
      assert.deepStrictEqual(rows, [['ⓘ', rgb(info), 'Caveat: '], ['⚠', rgb(warning), 'Pitfall:'], ['ⓧ', rgb(error), '[ has no']]);
      // The strip: the count of each level, its mark in its colour, the worst first; in words for a screen reader.
      const counts = await page.locator('#problems-counts .count').evaluateAll((els) => els.map((e) => {
        const icon = e.querySelector('.icon')!;
        return [e.textContent, e.ownerDocument.defaultView!.getComputedStyle(icon).color];
      }));
      assert.deepStrictEqual(counts, [['ⓧ1', rgb(error)], ['⚠1', rgb(warning)], ['ⓘ1', rgb(info)]]);
      assert.strictEqual(await page.locator('#problems-said').textContent(), 'Problems: 1 error, 1 warning, 1 caveat');
      // The editor: a wavy squiggle in the level's colour, and in the gutter the panel's icon (the Codicon of
      // media/icons.js, as a mask) in that colour. (A line's marker is of its worst problem: a line of errors, one of
      // information, one of a warning.)
      await page.keyboard.press('Control+End');
      await page.keyboard.insertText('\nread other\nsource lib2.sh');
      await until('the markers', () => page.locator('.cm-lint-marker-info, .cm-lint-marker-warning').count(), (n) => n === 2);
      const marks = await page.evaluate(`(['error', 'warning', 'info']).map((level) => {
        const range = getComputedStyle(document.querySelector('.cm-lintRange-' + level));
        const marker = getComputedStyle(document.querySelector('.cm-lint-marker-' + level));
        const mask = marker.maskImage || marker.webkitMaskImage;
        const icon = BashExplainerIcons.ICONS[level][0];
        return [level, range.textDecorationLine, range.textDecorationStyle, range.textDecorationColor, range.backgroundImage,
          marker.backgroundColor, mask.includes(encodeURIComponent(icon.slice(0, 40)))];
      })`) as unknown[][];
      assert.deepStrictEqual(marks, [
        ['error', 'underline', 'wavy', rgb(error), 'none', rgb(error), true],
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
    await openProblems(page);
    const rows = await until('the problems', () => problemRows(page).evaluateAll((els) => els.map((e) => [...e.querySelectorAll('.icon, .where, .code')].map((x) => x.textContent))), (r) => r.length === 2);
    assert.deepStrictEqual(rows, [['ⓘ', 'Ln 3', 'declaration-masks-status'], ['ⓧ', 'Ln 5', 'bracket-missing-close']]);
    // The squiggles cover the parts the notes are about.
    const ranges = await page.evaluate(`(['info', 'error']).map((level) => [...document.querySelectorAll('.cm-lintRange-' + level)].map((e) => e.textContent).join(''))`);
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
