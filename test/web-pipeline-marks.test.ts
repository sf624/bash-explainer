// The marks of a pipeline example on the web page (media/panel.js `markedLines`, `sideways`), in headless Chromium at a
// desktop's and a phone's width, in English and Japanese: what the next stage reads is marked, named for a screen
// reader; a section wider than the panel starts scrolled so that its first mark is in view, the header row with it;
// and its edges fade where more lies beyond them. The geometry is read from positions, not from how wide a font draws.
import * as assert from 'assert';
import type { Browser, Frame } from 'playwright-core';
import { frames, openSite, stable, until } from './support/site';

interface Section {
  label: string;
  said: string[];
  marks: string[];
  /** The first mark's left and right, and the scroller's box (its client area). */
  first?: { left: number; right: number };
  box: { left: number; right: number };
  /** Where `COMMAND` starts in the header row, in the same scroller. */
  command?: number;
  scrolled: number;
  more: [boolean, boolean];
  leftOut: number;
}

const sections = (f: Frame) => f.evaluate(`[...document.querySelectorAll('.example pre')].filter((p) => p.querySelector('mark.ex-read')).map((pre) => {
  const r = pre.getBoundingClientRect();
  const marks = [...pre.querySelectorAll('mark.ex-read')];
  const text = (m) => [...m.childNodes].filter((n) => !(n instanceof Element && n.classList.contains('sr-only'))).map((n) => n.textContent).join('');
  const m = marks[0].getBoundingClientRect();
  const head = pre.firstChild;
  const at = head.textContent.indexOf('COMMAND');
  let command;
  if (at >= 0) {
    const range = document.createRange();
    const node = head.firstChild;
    range.setStart(node, at);
    range.setEnd(node, at + 1);
    command = range.getBoundingClientRect().left;
  }
  return {
    label: pre.previousElementSibling.textContent,
    said: [...new Set(marks.map((m) => m.querySelector('.sr-only').textContent))],
    marks: marks.map(text),
    first: { left: m.left, right: m.right },
    box: { left: r.left + pre.clientLeft, right: r.left + pre.clientLeft + pre.clientWidth },
    command,
    scrolled: pre.scrollLeft,
    more: [pre.classList.contains('ex-more-left'), pre.classList.contains('ex-more-right')],
    leftOut: pre.querySelectorAll('.ex-left-out').length,
  };
})`) as Promise<Section[]>;

describe('the web page: what the next stage of a pipeline reads is marked, and in view', function () {
  this.timeout(120000);
  let browser: Browser;
  let base = '';
  before(async function () {
    ({ browser, base } = await openSite(this));
  });

  for (const [width, locale] of [[1280, 'en-US'], [1280, 'ja-JP'], [390, 'en-US'], [390, 'ja-JP']] as const) {
    it(`marks what grep matches and awk reads at ${width} px (${locale}), the first mark in view`, async () => {
      // Imported here: playwright-core does not load on Node.js 18, where the browser tests are skipped.
      const { devices } = await import('playwright-core');
      const ctx = await browser.newContext(width < 600 ? { ...devices['iPhone 13'], viewport: { width, height: 900 }, locale } : { viewport: { width, height: 900 }, locale });
      await ctx.addInitScript(`try { localStorage.setItem('bash-explainer-settings', JSON.stringify({ 'bashExplainer.panel.animations': false })); } catch {}`);
      const page = await ctx.newPage();
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(base);
      const panel = () => page.frames().find((f) => f.url().endsWith('/panel.html'))!;
      await until('the panel', () => Promise.resolve(panel()), (f) => !!f);
      await page.locator('.cm-content').click();
      await page.keyboard.press('Control+A');
      await page.keyboard.insertText("ps aux | grep nginx | awk '{print $2}'");
      await until('the line explained', async () => (await panel().locator('#line').textContent()) ?? '', (t) => t.includes('grep nginx'));
      await frames(panel());
      const got = await stable('the marked sections', () => sections(panel()));
      const ja = locale === 'ja-JP';
      assert.deepStrictEqual(got.map((s) => s.said), ja ? [['grep nginx が一致する部分：'], ["awk '{print $2}' が読む部分："]] : [['matched by grep nginx: '], ["read by awk '{print $2}': "]]);
      assert.deepStrictEqual(got.map((s) => s.marks), [['nginx', 'nginx', 'nginx', 'nginx'], ['845', '846', '2389']]);
      // The lines grep leaves out (the header, and five processes) are dimmer.
      assert.deepStrictEqual(got.map((s) => s.leftOut), [6, 0]);
      for (const s of got) {
        assert.ok(s.first!.left >= s.box.left - 0.5 && s.first!.right <= s.box.right + 0.5, `${s.label}: the first mark ${JSON.stringify(s.first)} is in ${JSON.stringify(s.box)}`);
      }
      // The made-up `ps aux` is wider than the panel at both widths: it starts scrolled, the header with its rows
      // (COMMAND over the command `nginx` starts), with a fade on the left and none on the right but where more is.
      const [ps] = got;
      assert.ok(ps.scrolled > 0, `scrolled by ${ps.scrolled}`);
      assert.ok(Math.abs(ps.command! - ps.first!.left) < 1, `COMMAND at ${ps.command}, the mark at ${ps.first!.left}`);
      assert.strictEqual(ps.more[0], true);
      assert.deepStrictEqual(errors, []);
      await ctx.close();
    });
  }

  it('keeps the place the user scrolls to, and fades only the edges with more beyond them', async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, locale: 'en-US' });
    await ctx.addInitScript(`try { localStorage.setItem('bash-explainer-settings', JSON.stringify({ 'bashExplainer.panel.animations': false })); } catch {}`);
    const page = await ctx.newPage();
    await page.goto(base);
    const panel = () => page.frames().find((f) => f.url().endsWith('/panel.html'))!;
    await until('the panel', () => Promise.resolve(panel()), (f) => !!f);
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText("ps aux | grep nginx | awk '{print $2}'");
    await until('the line explained', async () => (await panel().locator('#line').textContent()) ?? '', (t) => t.includes('grep nginx'));
    await frames(panel());
    await stable('the marked sections', () => sections(panel()));
    const pre = panel().locator('.example pre:has(mark.ex-read)').first();
    await pre.evaluate((p) => { p.scrollLeft = 0; });
    await frames(panel());
    assert.deepStrictEqual((await sections(panel()))[0].more, [false, true]);
    // A resize does not take it back to the mark.
    await page.setViewportSize({ width: 420, height: 900 });
    await frames(panel(), 4);
    assert.strictEqual((await sections(panel()))[0].scrolled, 0);
    await ctx.close();
  });
});
