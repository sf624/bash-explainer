// The panel's line box wraps a long line between shell words, as the editor does (src/ui/lineBox.ts, media/panel.js
// `fitLine`; docs/design/chrome-redesign.md, C1b): up to three rows, then a fade, and a click opens it whole. With
// the page's `editor.wrap` off it is one row that scrolls sideways. In headless Chromium at a phone's width and two
// desktop widths, in both languages (CI draws Japanese with its CJK fonts). Where a row ends depends on the font, so
// the tests check where rows may start (at the start of a run of the tree), not where they do.
import * as assert from 'assert';
import type { Browser, Frame, Page } from 'playwright-core';
import type { Lang } from '../src/i18n';
import { openDocument } from '../src/document-setup';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { wrapRuns } from '../src/ui/wrapRuns';
import { openSite, until } from './support/site';

/** Lines 1 to 4: line 8 of the sample; many quoted words; one word with blanks, wider than a row; one with no blank, wider than a row. */
const LINES = [
  'grep -rn "ERROR $USER" ./src 2>&1 | sort -u > errors.txt && echo "done: $(date +%F)" || exit 1',
  `echo ${'"word word" '.repeat(40)}| sort -u > out.txt`,
  `printf '%s\\n' "${'a b '.repeat(70)}end"`,
  `echo ${'x'.repeat(320)} done`,
];
const SCRIPT = LINES.join('\n') + '\n';
const parser = createUnbashParser();
/** Where a row may start on each line: the start of a run. */
const starts = wrapRuns(openDocument(SCRIPT, 'shell', (t) => parser.parse(t))).map((runs) => runs.map(([a]) => a));

interface Box {
  /** The column each row starts at, and whether that column is inside a run too wide for a row (`.wide`). */
  rows: { col: number; wide: boolean }[];
  /** The height of a row, and of the box's text as shown (without its padding). */
  row: number;
  shown: number;
  /** Whether the box scrolls sideways, or has text below what it shows. */
  sideways: boolean;
  below: boolean;
  wrap: boolean;
  clamped: boolean;
  faded: boolean;
  expanded: string | null;
  /** The height of the column of marks ↪, and of the text. */
  marks: number;
  text: number;
}

/** The line box as drawn: its rows (from the tops of its characters), its height and its state. */
function box(panel: Frame): Promise<Box> {
  return panel.evaluate(`(() => {
    const pre = document.getElementById('line');
    const rows = pre.querySelector('.rows');
    const walker = document.createTreeWalker(rows, NodeFilter.SHOW_TEXT);
    const out = [];
    let col = 0, last = -Infinity;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const wide = !!n.parentElement.closest('.run.wide');
      for (let i = 0; i < n.data.length; i++, col++) {
        if (n.data[i] === ' ') continue;
        const r = document.createRange();
        r.setStart(n, i);
        r.setEnd(n, i + 1);
        const top = r.getBoundingClientRect().top;
        if (top > last + 2) out.push({ col, wide });
        last = top;
      }
    }
    const cs = getComputedStyle(pre);
    const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    return {
      rows: out, row: parseFloat(getComputedStyle(rows).lineHeight), shown: pre.clientHeight - pad,
      sideways: pre.scrollWidth > pre.clientWidth + 1, below: pre.scrollHeight > pre.clientHeight + 1,
      wrap: pre.classList.contains('wrap'), clamped: pre.classList.contains('clamped'),
      faded: (cs.maskImage || cs.webkitMaskImage || 'none') !== 'none', expanded: pre.getAttribute('aria-expanded'),
      marks: parseFloat(getComputedStyle(rows, '::before').height) || 0, text: rows.getBoundingClientRect().height,
    };
  })()`) as Promise<Box>;
}

describe('the web page: the panel\'s line box wraps between shell words', function () {
  this.timeout(240000);
  let browser: Browser;
  let base = '';
  before(async function () {
    ({ browser, base } = await openSite(this));
  });

  async function open(width: number, lang: Lang): Promise<{ page: Page; panel: () => Frame }> {
    const ctx = await browser.newContext({ viewport: { width, height: width < 520 ? 844 : 800 }, locale: lang === 'ja' ? 'ja-JP' : 'en-US' });
    const page = await ctx.newPage();
    await page.goto(base);
    const panel = () => page.frames().find((f) => f.url().endsWith('/panel.html'))!;
    await until('the panel', () => Promise.resolve(panel()), (f) => !!f);
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText(SCRIPT);
    return { page, panel };
  }

  /**
   * Puts the cursor on line `line` (from 1), as test/support/site.ts `cursorToLine` does, with more presses: ArrowDown
   * moves by row, and these lines wrap over many rows on a phone.
   */
  async function cursorToLine(page: Page, line: number): Promise<void> {
    await page.locator('.cm-content').focus();
    await page.keyboard.press('Control+Home');
    const at = async () => Number(await page.locator('.cm-lineNumbers .cm-activeLineGutter').first().textContent());
    for (let i = 0; i < 100 && (await at()) < line; i++) await page.keyboard.press('ArrowDown');
    assert.strictEqual(await at(), line, 'the cursor\'s line');
  }

  /** Puts the cursor on line `l` (from 0) and waits for the panel to draw it. */
  async function show(page: Page, panel: () => Frame, l: number): Promise<Box> {
    await cursorToLine(page, l + 1);
    await until(`line ${l + 1} in the panel`, async () => (await panel().locator('#line').textContent()) ?? '', (t) => t === LINES[l]);
    // (The runs are measured in the frame after it is drawn.)
    return until(`line ${l + 1} fitted`, () => box(panel()), (b) => b.rows.length > 0 && b.wrap);
  }

  /** Every row starts at a run, or inside a run too wide for a row. */
  function assertRows(l: number, b: Box, where: string): void {
    for (const { col, wide } of b.rows.slice(1)) {
      assert.ok(starts[l].includes(col) || wide, `${where}, line ${l + 1}: a row starts inside a word, at column ${col}: ${LINES[l].slice(col, col + 20)}`);
    }
  }

  for (const width of [390, 640, 1280]) {
    for (const lang of ['en', 'ja'] as const) {
      it(`wraps between runs, shows three rows and a fade, and opens whole at a click (${width} px, ${lang})`, async () => {
        const { page, panel } = await open(width, lang);
        const where = `${width} px, ${lang}`;
        try {
          for (let l = 0; l < LINES.length; l++) {
            const b = await show(page, panel, l);
            const info = `${where}, line ${l + 1}: ${JSON.stringify({ ...b, rows: b.rows.length })}`;
            assert.strictEqual(b.sideways, false, info);
            // (Lines 2 to 4 are long enough for more than three rows at every width; line 8 of the sample wraps on a phone.)
            if (l > 0) assert.ok(b.rows.length > 3, info);
            if (width < 520) assert.ok(b.rows.length >= 2, info);
            assertRows(l, b, where);
            // (The column of marks ↪ is as tall as the text: one mark on each row after the first.)
            assert.ok(Math.abs(b.marks - b.text) < 1, info);
            if (b.rows.length <= 3) {
              assert.ok(!b.clamped && !b.faded && b.expanded === null, info);
              assert.ok(Math.abs(b.shown - b.rows.length * b.row) < 2, info);
              continue;
            }
            // More than three rows: three are shown, then the fade.
            assert.ok(b.clamped && b.faded && b.expanded === 'false' && b.below, info);
            assert.ok(Math.abs(b.shown - 3 * b.row) < 2, info);
            // A run too wide for a row breaks: at its blanks (line 3), else anywhere (line 4).
            if (l >= 2) assert.ok(b.rows.some((r) => r.wide), info);
            // A click opens it whole (a box of more rows than 40% of the panel scrolls).
            await panel().locator('#line').click({ position: { x: 4, y: 4 } });
            const opened = await until('opened', () => box(panel()), (x) => x.expanded === 'true');
            assert.ok(!opened.clamped && !opened.faded, JSON.stringify(opened));
            const cap = await panel().evaluate('innerHeight * 0.4') as number;
            assert.ok(Math.abs(opened.shown - opened.rows.length * opened.row) < 2 || opened.shown + 30 > cap, JSON.stringify({ ...opened, cap }));
            // A click on a part shows it in the editor, and leaves the box open.
            await page.evaluate('window.getSelection().removeAllRanges()');
            await panel().locator('#line .seg').nth(1).click();
            await until('the part selected', () => page.locator('.cm-selectionBackground').count(), (n) => n > 0);
            assert.strictEqual((await box(panel())).expanded, 'true');
            // A click beside the parts (the margin of the marks ↪) folds it again.
            await panel().locator('#line').click({ position: { x: 4, y: 4 } });
            await until('folded', () => box(panel()), (x) => x.expanded === 'false' && x.clamped);
            // So do Enter and Space, with the focus on it.
            await panel().locator('#line').focus();
            await page.keyboard.press('Enter');
            await until('opened by Enter', () => box(panel()), (x) => x.expanded === 'true');
            await page.keyboard.press('Space');
            await until('folded by Space', () => box(panel()), (x) => x.expanded === 'false');
          }
          // With `editor.wrap` off, the box is one row that scrolls sideways, as the editor's line.
          await page.evaluate("localStorage.setItem('bash-explainer-settings', JSON.stringify({ 'bashExplainer.editor.wrap': false }))");
          await page.reload();
          await until('the panel', () => Promise.resolve(panel()), (f) => !!f);
          await page.locator('.cm-content').click();
          await page.keyboard.press('Control+A');
          await page.keyboard.insertText(SCRIPT);
          await cursorToLine(page, 2);
          const off = await until('line 2, one row', () => panel().evaluate(`(() => {
            const pre = document.getElementById('line');
            return { text: pre.textContent, wrap: pre.classList.contains('wrap'), clamped: pre.classList.contains('clamped'), white: getComputedStyle(pre).whiteSpace,
              sideways: pre.scrollWidth > pre.clientWidth, high: pre.querySelector('.rows').getBoundingClientRect().height, row: parseFloat(getComputedStyle(pre).lineHeight) || 0 };
          })()`) as Promise<{ text: string; wrap: boolean; clamped: boolean; white: string; sideways: boolean; high: number; row: number }>, (x) => x.text === LINES[1]);
          assert.ok(!off.wrap && !off.clamped && off.white === 'pre' && off.sideways, JSON.stringify(off));
          assert.ok(off.high < 40, JSON.stringify(off));
        } finally {
          await page.context().close();
        }
      });
    }
  }
});
