// The rows of the explanation panel on the web page (media/panel.css): a long label (a shebang, a pipeline, a
// long path) does not squeeze its explanation into a narrow column, and a short one keeps its place, in both
// views, both languages and from a desktop to a small phone. Measured in headless Chromium against the row's own
// width, never against how wide a font draws a word (CI's fonts are not a desktop's).
import * as assert from 'assert';
import type { Browser, Frame, Page } from 'playwright-core';
import { chooseView, frames, openSite, until } from './support/site';

/** Lines whose labels are long: a shebang, a pipeline, a long path (one word, no space to break at). */
const LONG = [
  '#!/usr/bin/env -S bash -e',
  'grep -i error app.log | sort | uniq -c | sort -rn | head -n 3 | tee top-errors-of-the-day.txt | mail -s "errors $(date +%F)" admin@example.com',
  'echo "${file%.*}"',
  'cat /usr/share/doc/some-very-long-package-name-with-many-parts/examples/configuration-file-template.conf.example',
];

/** What each Meaning row looks like: its box, its label's, its explanation's, and what is cut or sticks out. */
const meaningRows = (panel: Frame) => panel.evaluate(`(() => [...document.querySelectorAll('#tree .row')].filter((r) => r.getClientRects().length).map((r) => {
  const box = (e) => { const b = e.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width, height: b.height }; };
  const label = r.querySelector(':scope > .label');
  const text = r.querySelector(':scope > .text');
  const twisty = r.querySelector(':scope > .twisty');
  const cs = getComputedStyle(r);
  const before = text.previousElementSibling;
  const sticksOut = [...r.children].filter((c) => c.getBoundingClientRect().right > r.getBoundingClientRect().right - parseFloat(cs.paddingRight) + 0.5).map((c) => c.className);
  return {
    label: label.textContent, folds: !!twisty.textContent, row: box(r), l: box(label), t: box(text), tw: box(twisty), before: box(before),
    gap: parseFloat(cs.columnGap), lineHeight: parseFloat(getComputedStyle(label).lineHeight) || label.getBoundingClientRect().height,
    natural: (() => { const c = label.cloneNode(true); c.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;max-width:none;width:max-content'; r.append(c); const w = c.getBoundingClientRect().width; c.remove(); return w; })(),
    contentWidth: r.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight),
    cut: label.scrollWidth > label.clientWidth + 0.5 || label.scrollHeight > label.clientHeight + 0.5,
    overflow: r.scrollWidth > r.clientWidth + 0.5, sticksOut,
  };
}))()`) as Promise<Array<{
  label: string; folds: boolean; row: Box; l: Box; t: Box; tw: Box; before: Box; gap: number; lineHeight: number; natural: number; contentWidth: number;
  cut: boolean; overflow: boolean; sticksOut: string[];
}>>;

interface Box { left: number; right: number; top: number; bottom: number; width: number; height: number }

describe('the web page: long labels in the panel', function () {
  this.timeout(300000);
  let browser: Browser;
  let base = '';

  before(async function () {
    ({ browser, base } = await openSite(this));
  });

  async function open(width: number, lang: string): Promise<{ page: Page; panel: () => Frame; close: () => Promise<void> }> {
    const ctx = await browser.newContext({ locale: lang === 'ja' ? 'ja-JP' : 'en-US', viewport: { width, height: 800 } });
    await ctx.addInitScript(`try { localStorage.setItem('bash-explainer-settings', JSON.stringify({ 'bashExplainer.panel.animations': false })); } catch {}`);
    const page = await ctx.newPage();
    await page.goto(base);
    const panel = () => page.frames().find((f) => f.url().endsWith('/panel.html'))!;
    await until('the panel', () => Promise.resolve(panel()), (f) => !!f);
    await page.locator('.cm-line').first().waitFor();
    return { page, panel, close: () => ctx.close() };
  }

  async function type(page: Page, panel: () => Frame, line: string): Promise<void> {
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText(line);
    await until('the line explained', async () => (await panel().locator('#line').textContent()) ?? '', (t) => t.includes(line.slice(0, 15)));
    await frames(panel(), 2);
  }

  it('keeps a wide column for the explanation beside a long label, or puts it under the label, and cuts nothing', async () => {
    for (const width of [1280, 900, 600, 390, 320]) for (const lang of ['en', 'ja']) {
      const { page, panel, close } = await open(width, lang);
      for (const line of LONG) {
        await type(page, panel, line);
        await chooseView(page, 'list');
        await until('the rows', () => panel().locator('#tree .row').count(), (n) => n > 0);
        const where = `${width} ${lang} ${line.slice(0, 20)}`;
        const rows = await meaningRows(panel());
        for (const r of rows) {
          const at = `${where}: ${r.label.slice(0, 30)}`;
          assert.ok(!r.cut, `${at}: the label is cut`);
          assert.ok(!r.overflow && r.sticksOut.length === 0, `${at}: sticks out (${r.sticksOut})`);
          // Beside the label (on its first line), the explanation has at least half of the row; under it, it
          // starts in line with the label.
          const beside = r.t.top < r.l.top + r.lineHeight;
          if (beside) assert.ok(r.t.width >= 0.45 * r.contentWidth, `${at}: ${Math.round(r.t.width)} of ${Math.round(r.contentWidth)} beside the label`);
          else {
            assert.ok(r.t.top >= r.l.bottom - 1, `${at}: under the label`);
            assert.ok(Math.abs(r.t.left - r.l.left) < 1, `${at}: in line with the label (${r.t.left}, ${r.l.left})`);
          }
          // The fold mark stays before the label, on its first line.
          if (r.folds) assert.ok(r.tw.right <= r.l.left && Math.abs(r.tw.top - r.l.top) < r.lineHeight / 2, `${at}: the twisty`);
        }
        // The long pipeline's label is too long to stand beside its explanation: shown whole, over the row.
        if (line.startsWith('grep')) {
          const r = rows[0];
          assert.ok(r.l.height > 1.5 * r.lineHeight || r.t.top >= r.l.bottom - 1, `${where}: the pipeline's label`);
        }
        // Nothing on the page scrolls sideways.
        assert.strictEqual(await panel().evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), true, where);
        // Reading: the code's pill and the explanation stay inside their row.
        await chooseView(page, 'tree');
        await until('the tree', () => panel().locator('#reading-tree .trow').count(), (n) => n > 0);
        const out = await panel().evaluate(`[...document.querySelectorAll('#reading-tree .trow')].filter((r) => {
          const right = r.getBoundingClientRect().right;
          return r.scrollWidth > r.clientWidth + 0.5 || [...r.querySelectorAll('.tcode, .text')].some((c) => c.getBoundingClientRect().right > right + 0.5);
        }).map((r) => r.textContent.slice(0, 40))`);
        assert.deepStrictEqual(out, [], `${where}: Reading`);
        await chooseView(page, 'list');
      }
      await close();
    }
  });

  it('keeps a short label on one line, with its explanation right after it, as before', async () => {
    for (const width of [1280, 600, 390]) {
      const { page, panel, close } = await open(width, 'en');
      for (const line of ['grep -rn "ERROR $USER" ./src 2>&1 | sort -u > errors.txt && echo "done: $(date +%F)" || exit 1', 'sudo -u www-data tar -xzf site.tar.gz -C /var/www']) {
        await type(page, panel, line);
        await chooseView(page, 'list');
        const rows = await meaningRows(panel());
        const short = rows.filter((r) => r.natural <= r.contentWidth / 3);
        assert.ok(short.length >= 5, `${width}: ${short.length} short labels`);
        for (const r of short) {
          const at = `${width} ${r.label}`;
          assert.ok(r.l.height < 1.5 * r.lineHeight && Math.abs(r.l.width - r.natural) < 0.5, `${at}: on one line, whole`);
          // After the twisty and the gap, and the explanation after the label (or its badge) and the gap, on its line.
          assert.ok(Math.abs(r.l.left - (r.tw.right + r.gap)) < 0.5, `${at}: the label's place`);
          // (On a phone, a label with a badge and links may leave less than 60% of the row: the explanation then
          // goes under it, as before.)
          if (width > 520 || r.t.top < r.l.bottom) assert.ok(Math.abs(r.t.left - (r.before.right + r.gap)) < 0.5 && r.t.top < r.l.bottom, `${at}: the explanation's place`);
          else assert.ok(Math.abs(r.t.left - r.l.left) < 0.5, `${at}: the explanation under the label`);
        }
      }
      await close();
    }
  });
});
