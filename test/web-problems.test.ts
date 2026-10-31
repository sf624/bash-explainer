// The web page's Problems strip (docs/design/chrome-redesign.md, C2), run for real in headless Chromium (the build, the
// server and the browser are shared by the test/web-*.test.ts files: test/support/site.ts): "› Problems ⓧ 1 ⚠ 1 ⓘ 2",
// the count of each level from the level table; at the right "Ln 2 · 3/4" with ‹ › and F8 / Shift+F8, round from the
// last problem to the first; the list folded or open as the user left it, and never opened by the page; each problem's
// tooltip with its line from 1 and its rule; the strip on one row at every width, in both languages; "No problems".
import * as assert from 'assert';
import type { Browser, Page } from 'playwright-core';
import { cursorToLine, openSite, until } from './support/site';

// Line 1: a caveat; line 2: a warning, then a caveat; line 3: an error.
const SCRIPT = 'read line\nsource lib.sh; read other\n[ -f a';

describe('the web page: the Problems strip', function () {
  this.timeout(120000);
  let browser: Browser;
  let base = '';

  before(async function () {
    ({ browser, base } = await openSite(this));
  });

  async function open(page: Page, text = SCRIPT): Promise<void> {
    await page.goto(base);
    await page.locator('.cm-line').first().waitFor();
    await page.locator('.cm-content').focus();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText(text);
  }

  const pos = (page: Page) => page.locator('#problem-pos-text').textContent();
  const activeLine = (page: Page) => page.locator('.cm-activeLine').first().textContent();

  for (const lang of ['en', 'ja'] as const) {
    it(`counts each level's problems, says where the cursor is, and goes round them with F8 and ‹ › (${lang})`, async () => {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: lang === 'ja' ? 'ja-JP' : 'en-US' });
      const page = await ctx.newPage();
      await open(page);
      const rows = page.locator('#problem-list .problem');
      await until('the problems', () => rows.count(), (n) => n === 4, 15000);
      // The strip's counts equal the document's problems, per level (the rows' marks), the worst level first.
      const byLevel = await rows.evaluateAll((els) => els.map((e) => e.querySelector('.icon')!.className.replace('icon ', '')));
      const counts = await page.locator('#problems-counts .count').evaluateAll((els) => els.map((e) => [e.querySelector('.icon')!.className.replace('icon ', ''), Number(e.textContent!.replace(/\D/g, ''))]));
      assert.deepStrictEqual(counts, [['level-error', 1], ['level-warning', 1], ['level-info', 2]]);
      for (const [level, n] of counts) assert.strictEqual(byLevel.filter((l) => l === level).length, n, String(level));
      assert.strictEqual(await page.locator('#problems-said').textContent(), lang === 'en' ? 'Problems: 1 error, 1 warning, 2 caveats' : '問題：エラー 1 件、警告 1 件、注意 2 件');
      // The rows in the order of the script; each tooltip has the line from 1, the whole message and the rule, and no
      // locator of 0-based numbers ("94:7:…").
      const tips = await rows.evaluateAll((els) => els.map((e) => e.getAttribute('title') ?? ''));
      assert.deepStrictEqual(tips.map((t) => t.split(/[:：]/)[0]), lang === 'en' ? ['Ln 1', 'Ln 2', 'Ln 2', 'Ln 3'] : ['1 行目', '2 行目', '2 行目', '3 行目']);
      for (const t of tips) {
        assert.ok(!/\d+:\d+:/.test(t), t);
        assert.match(t, /[(（][a-z-]+[)）]$/);
        assert.ok(!t.includes('`'), t);
      }
      // A line with two problems: the first of the line, until the cursor is in the second (here, from the list).
      const ln = (line: number, i: number) => (lang === 'en' ? `Ln ${line} · ${i}/4` : `${line} 行目 · ${i}/4`);
      await cursorToLine(page, 2);
      await until('the first of line 2', () => pos(page), (t) => t === ln(2, 2));
      await rows.nth(2).click();
      await until('the second of line 2', () => pos(page), (t) => t === ln(2, 3));
      assert.strictEqual(await activeLine(page), 'source lib.sh; read other');
      assert.strictEqual(await page.locator('#problem-pos-said').textContent(), lang === 'en' ? 'Problem 3 of 4, line 2' : '4 件中 3 件目の問題、2 行目');
      // F8 from the last problem goes round to the first; Shift+F8 back to the last.
      await page.keyboard.press('Control+End');
      await until('the last', () => pos(page), (t) => t === ln(3, 4));
      await page.keyboard.press('F8');
      await until('round to the first', () => pos(page), (t) => t === ln(1, 1));
      assert.strictEqual(await activeLine(page), 'read line');
      await page.keyboard.press('Shift+F8');
      await until('back to the last', () => pos(page), (t) => t === ln(3, 4));
      // Every problem once, in order, with ‹ › too (the two of line 2 included).
      for (const want of [ln(1, 1), ln(2, 2), ln(2, 3), ln(3, 4)]) {
        await page.locator('#problem-next').click();
        await until(`the next: ${want}`, () => pos(page), (t) => t === want);
      }
      await page.locator('#problem-prev').click();
      await until('the previous', () => pos(page), (t) => t === ln(2, 3));
      // ‹ › name what they do and their keys; between problems, no position.
      assert.deepStrictEqual(await page.locator('#problem-next').evaluate((b) => [b.getAttribute('aria-label'), b.getAttribute('aria-keyshortcuts'), b.title]),
        lang === 'en' ? ['Next problem', 'F8', 'Next problem (F8)'] : ['次の問題', 'F8', '次の問題 (F8)']);
      await page.keyboard.press('Control+End');
      await page.keyboard.insertText('\n\necho ok');
      await until('no position', () => pos(page), (t) => t === '');
      await ctx.close();
    });
  }

  it('opens the list on a first visit, then keeps the choice, and never opens it when a problem appears', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    await open(page);
    const toggle = page.locator('#problems-toggle');
    const expanded = () => toggle.getAttribute('aria-expanded');
    const listShown = () => page.locator('#problem-list li').first().isVisible();
    await until('the problems', () => page.locator('#problem-list li').count(), (n) => n === 4, 15000);
    assert.strictEqual(await expanded(), 'true');
    assert.strictEqual(await listShown(), true);
    await toggle.click();
    assert.strictEqual(await expanded(), 'false');
    // Folded, the list gives its room to the editor: the strip alone, 32 px, at the pane's bottom.
    const strip = (await page.locator('.problems-strip').boundingBox())!;
    const pane = (await page.locator('#source').boundingBox())!;
    assert.strictEqual(Math.round(strip.height), 32);
    assert.ok(Math.abs(strip.y + strip.height - (pane.y + pane.height)) <= 1, JSON.stringify({ strip, pane }));
    await page.reload();
    await page.locator('.cm-line').first().waitFor();
    await until('the strip', () => page.locator('#problems-counts .count').count(), (n) => n > 0, 15000);
    assert.strictEqual(await expanded(), 'false');
    // A new problem while typing: counted, and the list stays folded.
    await page.locator('.cm-content').focus();
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText('\nx = 2');
    await until('the new warning', () => page.locator('#problems-said').textContent(), (t) => /\d+ warnings/.test(t ?? ''), 15000);
    assert.strictEqual(await expanded(), 'false');
    assert.strictEqual(await listShown(), false);
    await toggle.click();
    await page.reload();
    await page.locator('.cm-line').first().waitFor();
    await until('open after the reload', expanded, (v) => v === 'true');
    await ctx.close();
  });

  it('says "No problems" alone, with nothing to open or go to', async () => {
    for (const lang of ['en', 'ja'] as const) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: lang === 'ja' ? 'ja-JP' : 'en-US' });
      const page = await ctx.newPage();
      await open(page, 'echo "hello"');
      await until('no problems', () => page.locator('#problems-title').textContent(), (t) => t === (lang === 'en' ? 'No problems' : '問題なし'), 15000);
      assert.strictEqual(await page.locator('#problems-said').textContent(), lang === 'en' ? 'No problems' : '問題なし');
      assert.strictEqual(await page.locator('#problems-toggle').isDisabled(), true);
      assert.deepStrictEqual(await Promise.all(['#problem-prev', '#problem-next', '#problem-list', '#problems-resize'].map((s) => page.locator(s).isVisible())), [false, false, false, false]);
      assert.strictEqual(await page.locator('#problems-counts .count').count(), 0);
      assert.strictEqual(Math.round((await page.locator('.problems-strip').boundingBox())!.height), 32);
      // The fold says no state and controls nothing, and the strip has no empty part for a screen reader.
      const toggle = page.locator('#problems-toggle');
      assert.deepStrictEqual(await toggle.evaluate((b) => [b.getAttribute('aria-expanded'), b.getAttribute('aria-controls')]), [null, null]);
      assert.strictEqual(await page.locator('.problems-strip').ariaSnapshot(), `- heading "${lang === 'en' ? 'No problems' : '問題なし'}" [level=2]:\n  - button "${lang === 'en' ? 'No problems' : '問題なし'}" [disabled]`);
      // F8 has nowhere to go.
      await page.locator('.cm-content').focus();
      await page.keyboard.press('F8');
      assert.strictEqual(await activeLine(page), 'echo "hello"');
      // A problem comes: the fold says its state again, and what it opens.
      await page.keyboard.press('End');
      await page.keyboard.insertText('\nread a');
      await until('the fold back', () => toggle.getAttribute('aria-expanded'), (v) => v === 'true', 15000);
      assert.strictEqual(await toggle.getAttribute('aria-controls'), 'problem-list');
      await page.keyboard.press('F8');
      await until('the position', () => pos(page), (t) => !!t);
      const said = lang === 'en' ? 'Problems: 1 caveat' : '問題：注意 1 件';
      // (The snapshot quotes a line with ": " in it, as YAML does: the quotes are left out here.)
      assert.strictEqual((await page.locator('.problems-strip').ariaSnapshot()).replace(/'/g, ''), [
        `- heading "${said}" [level=2]:`, `  - button "${said}" [expanded]`, `- text: ${lang === 'en' ? 'Problem 1 of 1, line 2' : '1 件中 1 件目の問題、2 行目'}`,
        `- button "${lang === 'en' ? 'Previous problem' : '前の問題'}"`, `- button "${lang === 'en' ? 'Next problem' : '次の問題'}"`,
      ].join('\n'));
      await ctx.close();
    }
  });

  it('goes to where the problems are after an edit, before the next check (a line deleted, then F8 at once)', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    await open(page, 'read a\necho one\necho two\nread b\necho three\nread c');
    await until('the problems', () => page.locator('#problem-list .problem').count(), (n) => n === 3, 15000);
    await page.keyboard.press('Control+Home');
    await until('the first', () => pos(page), (t) => t === 'Ln 1 · 1/3');
    // The first line and its problem go; the others move up a line at once.
    await page.keyboard.press('Control+Shift+K');
    assert.strictEqual(await pos(page), '');
    await page.keyboard.press('F8');
    assert.strictEqual(await activeLine(page), 'read b');
    assert.strictEqual(await page.evaluate('getSelection().toString()').then((t) => (t as string).startsWith('read')), true);
    assert.strictEqual(await pos(page), 'Ln 3 · 1/2');
    // The check that follows agrees, and keeps the cursor where F8 put it.
    await until('the check', () => page.locator('#problem-list .problem').count(), (n) => n === 2, 15000);
    assert.strictEqual(await pos(page), 'Ln 3 · 1/2');
    assert.strictEqual(await activeLine(page), 'read b');
    // A line added above: the position moves with it at once.
    await page.keyboard.press('Control+Home');
    await page.keyboard.press('Enter');
    await page.keyboard.press('F8');
    assert.strictEqual(await pos(page), 'Ln 4 · 1/2');
    await ctx.close();
  });

  it('leaves F8 and F6 to an input method while it composes', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    await open(page);
    await until('the problems', () => page.locator('#problem-list .problem').count(), (n) => n === 4, 15000);
    await page.keyboard.press('Control+Home');
    const key = (k: string, isComposing: boolean) => page.evaluate(`(() => {
      const e = new KeyboardEvent('keydown', { key: '${k}', isComposing: ${isComposing}, bubbles: true, cancelable: true });
      document.querySelector('.cm-content').dispatchEvent(e);
      return e.defaultPrevented;
    })()`) as Promise<boolean>;
    // Composing: neither key is taken, and the cursor (nothing selected) and the focus stay.
    assert.deepStrictEqual([await key('F8', true), await key('F6', true)], [false, false]);
    assert.strictEqual(await page.evaluate('document.activeElement.className'), 'cm-content cm-lineWrapping');
    assert.strictEqual(await pos(page), 'Ln 1 · 1/4');
    // Not composing: F8 goes to the next problem.
    assert.strictEqual(await page.evaluate('getSelection().toString()'), '');
    assert.strictEqual(await key('F8', false), true);
    await until('a problem selected', () => page.evaluate('getSelection().toString()') as Promise<string>, (t) => t.length > 0);
    await ctx.close();
  });

  for (const width of [390, 640, 1280]) {
    it(`lays the strip out on one row inside the editor's pane: ${width} px, both languages`, async () => {
      for (const lang of ['en', 'ja'] as const) {
        const { devices } = await import('playwright-core');
        const ctx = await browser.newContext({ ...(width < 520 ? devices['iPhone 13'] : {}), viewport: { width, height: 800 }, locale: lang === 'ja' ? 'ja-JP' : 'en-US' });
        const page = await ctx.newPage();
        // (Three levels, two-digit counts, a line of three digits: the widest strip.)
        await open(page, `${'read a\n'.repeat(12)}${'x = 1\n'.repeat(10)}${'\n'.repeat(80)}[ -f a`);
        await until('the counts', () => page.locator('#problems-counts .count').count(), (n) => n === 3, 15000);
        await page.locator('.cm-content').focus();
        await page.keyboard.press('Control+End');
        await until('the position', () => pos(page), (t) => /103/.test(t ?? ''));
        const boxes = await page.evaluate(`['.problems-strip', '#problems-toggle', '#problem-pos-text', '#problem-prev', '#problem-next', '#source'].map((s) => {
          const r = document.querySelector(s).getBoundingClientRect();
          return { x: r.x, y: r.y, w: r.width, h: r.height };
        })`) as { x: number; y: number; w: number; h: number }[];
        const [strip, toggle, text, prev, next, pane] = boxes;
        const at = JSON.stringify(boxes);
        // (A narrow page, one pane above the other, has the phone's 44 px targets.)
        const narrow = await page.evaluate('document.documentElement.classList.contains("narrow")');
        const bar = narrow ? 44 : 32;
        // (On a touch screen the strip keeps clear of the edges' swipe strips and of the divider's grab area: padding.)
        assert.ok(strip.h >= bar && strip.h <= bar + 8, at);
        assert.strictEqual(Math.round(toggle.h), bar, at);
        for (const b of [toggle, text, prev, next]) {
          assert.ok(b.y >= strip.y - 0.5 && b.y + b.h <= strip.y + strip.h + 0.5, `inside the strip's row: ${at}`);
          assert.ok(b.x >= pane.x - 0.5 && b.x + b.w <= pane.x + pane.w + 0.5, `inside the pane: ${at}`);
        }
        // In order, with no overlap, the position whole (not cut), and the buttons as large as the bar asks.
        assert.ok(toggle.x + toggle.w <= text.x + 0.5 && text.x + text.w <= prev.x + 0.5 && prev.x + prev.w <= next.x + 0.5, at);
        // (Within a pixel: the widths are whole numbers.)
        assert.strictEqual(await page.locator('#problem-pos').evaluate((e) => e.scrollWidth <= e.clientWidth + 1), true, at);
        for (const b of [prev, next]) assert.ok(b.w >= (narrow ? 44 : 24) && b.h >= (narrow ? 44 : 24), at);
        // Below a pane of 520 px the position is "23/23" alone; the line is said to a screen reader still.
        assert.strictEqual(await page.locator('#problem-pos .pos-ln').isVisible(), pane.w >= 520);
        assert.match((await page.locator('#problem-pos-said').textContent())!, /103/);
        assert.strictEqual(await page.evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
        await ctx.close();
      }
    });
  }

  it('shows the rule from a pane of 520 px, and the line in a column of its own', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    await open(page, `read a\n${'\n'.repeat(120)}x = 1`);
    await until('the problems', () => page.locator('#problem-list .problem').count(), (n) => n === 2, 15000);
    const look = () => page.locator('#problem-list .problem').evaluateAll((els) => els.map((e) => [
      Math.round(e.querySelector('.message')!.getBoundingClientRect().x), e.querySelector('.code')!.getBoundingClientRect().width > 0,
    ]));
    // "Ln 1" and "Ln 122": the messages start at one x.
    const wide = await look();
    assert.strictEqual(wide[0][0], wide[1][0]);
    assert.deepStrictEqual(wide.map((r) => r[1]), [true, true]);
    // A narrow editor's pane (the divider moved): the rule only in the tooltip.
    await page.locator('#splitter').focus();
    for (let i = 0; i < 30 && (await page.locator('#source').boundingBox())!.width >= 520; i++) await page.keyboard.press('ArrowLeft');
    assert.ok((await page.locator('#source').boundingBox())!.width < 520);
    assert.deepStrictEqual((await until('the rule hidden', look, (r) => !r[0][1])).map((r) => r[1]), [false, false]);
    await ctx.close();
  });
});
