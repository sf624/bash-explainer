// The web page's Problems strip (docs/design/chrome-redesign.md, C2), run for real in headless Chromium (the build, the
// server and the browser are shared by the test/web-*.test.ts files: test/support/site.ts): "› Problems ⓧ 1 ⚠ 1 ⓘ 2",
// the count of each level from the level table; at the right "Ln 2 · 3/4" with ‹ › and F8 / Shift+F8, round from the
// last problem to the first; the list folded or open as the user left it, and never opened by the page; each problem's
// tooltip with its line from 1 and its rule; the strip on one row at every width, in both languages; "No problems".
import * as assert from 'assert';
import * as fs from 'fs';
import type { Browser, Page } from 'playwright-core';
import { cursorToLine, FRAMES, openSite, until } from './support/site';

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
      assert.deepStrictEqual(tips.map((t) => t.split(/[:：]/)[0]), lang === 'en' ? ['Ln 1', 'Ln 2', 'Ln 2', 'Ln 3'] : ['行 1', '行 2', '行 2', '行 3']);
      for (const t of tips) {
        assert.ok(!/\d+:\d+:/.test(t), t);
        assert.match(t, /[(（][a-z-]+[)）]$/);
        assert.ok(!t.includes('`'), t);
      }
      // A line with two problems: the first of the line, until the cursor is in the second (here, from the list).
      const ln = (line: number, i: number) => (lang === 'en' ? `Ln ${line} · ${i}/4` : `行 ${line} · ${i}/4`);
      await cursorToLine(page, 2);
      await until('the first of line 2', () => pos(page), (t) => t === ln(2, 2));
      await rows.nth(2).click();
      await until('the second of line 2', () => pos(page), (t) => t === ln(2, 3));
      assert.strictEqual(await activeLine(page), 'source lib.sh; read other');
      assert.strictEqual(await page.locator('#problem-pos-said').textContent(), lang === 'en' ? 'Problem 3 of 4, line 2' : '4 件中 3 件目の問題、行 2');
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

  it('counts a syntax error, not "No problems" beside a red row', async () => {
    for (const [text, line] of [['echo ok )', 1], ['echo a\nif true; then', 2], ["echo 'a", 1]] as const) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-US' });
      const page = await ctx.newPage();
      await open(page, text);
      await until('the error counted', () => page.locator('#problems-said').textContent(), (t) => t === 'Problems: 1 error', 15000);
      const rows = page.locator('#problem-list .problem');
      const tip = await until('the row', () => rows.first().getAttribute('title'), (t) => !!t);
      assert.match(tip!, new RegExp(`^Ln ${line}: .*a syntax error.*\\(syntax-error\\)$`));
      await ctx.close();
    }
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
        `- heading "${said}" [level=2]:`, `  - button "${said}" [expanded]`, `- text: ${lang === 'en' ? 'Problem 1 of 1, line 2' : '1 件中 1 件目の問題、行 2'}`,
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
        // (390 px: a narrow window. A phone has no strip: its list is a tab of the explanation's sheet, test/web-sheet.test.ts.)
        const ctx = await browser.newContext({ viewport: { width, height: 800 }, locale: lang === 'ja' ? 'ja-JP' : 'en-US' });
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

  // What each part of the strip shows at a pane's width, from where it lies and what clips it (never from the width of a
  // text): "whole" inside every box that clips it, "hidden" outside them all (or not drawn), "cut" between the two. The
  // natural widths are read from the parts that were dropped, which keep their size.
  const LOOK = `(() => {
    const r = (e) => e.getBoundingClientRect();
    const state = (e) => {
      if (!e) return 'none';
      const b = r(e);
      if (!(b.width > 0 && b.height > 0)) return 'hidden';
      let clip = { l: -1e9, t: -1e9, r: 1e9, b: 1e9 };
      for (let p = e.parentElement; p; p = p.parentElement) {
        const cs = getComputedStyle(p);
        if (cs.display === 'none') return 'hidden';
        if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') { const c = r(p); clip = { l: Math.max(clip.l, c.left), t: Math.max(clip.t, c.top), r: Math.min(clip.r, c.right), b: Math.min(clip.b, c.bottom) }; }
      }
      const w = Math.min(b.right, clip.r) - Math.max(b.left, clip.l), h = Math.min(b.bottom, clip.b) - Math.max(b.top, clip.t);
      if (w <= 0.5 || h <= 0.5) return 'hidden';
      return b.left >= clip.l - 0.5 && b.right <= clip.r + 0.5 && b.top >= clip.t - 0.5 && b.bottom <= clip.b + 0.5 ? 'whole' : 'cut';
    };
    const part = (name, e) => ({ name, state: state(e), left: e ? r(e).left : 0, right: e ? r(e).right : 0, width: e ? r(e).width : 0 });
    const title = document.getElementById('problems-title');
    // (The word's own width: the same text on one line.)
    const probe = title.cloneNode(true);
    probe.removeAttribute('id');
    probe.style.cssText = 'position:fixed;left:0;top:0;visibility:hidden;white-space:nowrap;width:max-content;overflow:visible';
    title.parentElement.append(probe);
    const wordWidth = r(probe).width;
    probe.remove();
    const parts = [
      part('chevron', document.querySelector('#problems-toggle .chev')),
      part('word', title),
      ...[...document.querySelectorAll('#problems-counts .count')].map((c, i) => part('count' + (i + 1), c)),
      part('place', document.getElementById('problem-pos-text')),
      part('prev', document.getElementById('problem-prev')),
      part('next', document.getElementById('problem-next')),
    ];
    const strip = r(document.querySelector('.problems-strip'));
    const box = document.querySelector('.strip-main') || document.querySelector('.problems-strip');
    const fit = document.querySelector('#problems .fit') || title.parentElement;
    return {
      parts, wordWidth, pane: r(document.querySelector('main > .source')).width,
      strip: { left: strip.left, right: strip.right, over: document.querySelector('.problems-strip').scrollWidth - document.querySelector('.problems-strip').clientWidth },
      main: { left: r(box).left, right: r(box).right },
      row: { left: r(fit).left, right: r(fit).right },
      placeBox: r(document.getElementById('problem-pos')).width, padEnd: parseFloat(getComputedStyle(document.getElementById('problems-toggle')).paddingRight),
      said: document.getElementById('problems-said').textContent,
    };
  })()`;
  interface Part { name: string; state: 'whole' | 'hidden' | 'cut' | 'none'; left: number; right: number; width: number }
  interface Look { parts: Part[]; wordWidth: number; pane: number; strip: { left: number; right: number; over: number }; main: { left: number; right: number }; row: { left: number; right: number }; placeBox: number; padEnd: number; said: string }

  it('drops the word first, then the place, then the counts from the lowest level, each whole, at every width of the pane', async function () {
    this.timeout(240000);
    const sample = fs.readFileSync('test/fixtures/sample.sh', 'utf8');
    const PANES = [115, 130, 190, 239, 240, 260, 283, 300, 640];
    const GAP = 10;
    for (const locale of ['en-US', 'ja-JP']) {
      // One digit and two digits in the counts, and no problem chosen and one chosen (its place shows).
      for (const [times, chosen] of [[1, false], [11, false], [1, true], [11, true]] as const) {
        const ctx = await browser.newContext({ locale, viewport: { width: 1280, height: 700 } });
        const page = await ctx.newPage();
        await open(page, sample.repeat(times));
        await until('the counts', () => page.locator('#problems-counts .count').count(), (n) => n === 3, 20000);
        if (chosen) {
          await until('the place', async () => {
            await page.keyboard.press('F8');
            return page.locator('#problem-pos-text').textContent();
          }, (t) => !!t, 20000);
        }
        const look = async (pane: number): Promise<Look> => {
          // The divider's share, set where it is kept; the pane is read back, so that the gutter does not count.
          for (let i = 0; i < 4; i++) {
            const width = (await page.evaluate("document.querySelector('main > .source').getBoundingClientRect().width")) as number;
            if (Math.abs(width - pane) < 0.5) break;
            await page.evaluate(`(() => { const m = document.getElementById('split'); const have = parseFloat(m.style.getPropertyValue('--split')) || 50; m.style.setProperty('--split', (have * ${pane} / ${width}) + '%'); })()`);
            await page.evaluate(FRAMES);
          }
          const got = (await page.evaluate(LOOK)) as Look;
          assert.ok(Math.abs(got.pane - pane) < 1, `pane ${pane}: ${got.pane}`);
          return got;
        };
        const seen: Look[] = [];
        const widths = [...PANES, ...Array.from({ length: 56 }, (_, i) => 115 + i * 4)].sort((a, b) => a - b);
        for (const pane of widths) {
          const l = await look(pane);
          seen.push(l);
          const said = `${locale} x${times} ${chosen ? 'chosen' : 'none chosen'} pane ${pane}: ${JSON.stringify(l.parts.map((p) => [p.name, p.state, Math.round(p.left), Math.round(p.right)]))} main ${JSON.stringify(l.main)} row ${JSON.stringify(l.row)} word ${l.wordWidth}`;
          const part = (name: string) => l.parts.find((p) => p.name === name)!;
          const shown = l.parts.filter((p) => p.state === 'whole');
          // Whole or not drawn, never cut; in one row, in order, none over another, inside the pane; the arrows always there.
          assert.deepStrictEqual(l.parts.filter((p) => p.state === 'cut').map((p) => p.name), [], said);
          assert.ok(l.strip.over <= 0, said);
          shown.forEach((p, i) => {
            assert.ok(p.right <= (shown[i + 1]?.left ?? l.strip.right) + 0.5, said);
            assert.ok(p.left >= l.strip.left - 0.5, said);
          });
          assert.deepStrictEqual([part('prev').state, part('next').state], ['whole', 'whole'], said);
          assert.ok(/11.*55.*77|1.*5.*7/.test(l.said), said);
          const counts = l.parts.filter((p) => /^count/.test(p.name));
          const wholeCounts = counts.filter((p) => p.state === 'whole');
          // The counts go from the last: the shown are the highest levels, from the first.
          assert.deepStrictEqual(wholeCounts.map((p) => p.name), counts.slice(0, wholeCounts.length).map((p) => p.name), said);
          // The word goes first: it shows only with every count, and where it is dropped, it did not fit after them.
          const room = l.row.right - l.row.left;
          const countsWidth = counts.reduce((sum, p) => sum + p.width, 0) + GAP * (counts.length - 1);
          if (part('word').state === 'whole') assert.strictEqual(wholeCounts.length, counts.length, said);
          else assert.ok(l.wordWidth + 8 + countsWidth > room - 0.5, said);
          // The highest level's count shows wherever it fits beside the mark and the arrows, and a count is dropped only when it did not fit.
          const first = counts[0];
          if (first.width + (first.left - part('chevron').right) <= l.main.right - part('chevron').right - 0.5) assert.strictEqual(first.state, 'whole', said);
          counts.forEach((p, i) => {
            if (p.state !== 'hidden' || i === 0 || counts[i - 1].state !== 'whole') return;
            assert.ok(counts[i - 1].right + GAP + p.width > l.row.right - 0.5, said);
            // With no place to stand beside (none is chosen), the counts have the strip's whole room.
            if (!chosen) assert.ok(counts[i - 1].right + GAP + p.width + l.padEnd > l.main.right - 0.5, said);
          });
          if (chosen) {
            // The place stays whole (never cut to "1…") and beside the mark and the count of the highest level; it goes only when it cannot stand there.
            const widest = Math.max(...counts.map((p) => p.width));
            if (part('place').state === 'whole') assert.strictEqual(first.state, 'whole', said);
            else assert.ok(first.left - l.main.left + widest + l.padEnd + l.placeBox + 2 > l.main.right - l.main.left - 0.5, said);
          } else assert.strictEqual(part('place').state, 'hidden', said);
        }
        // No width where something drops and returns while the pane grows: the word, the highest count and the place only ever come in.
        for (const name of ['word', 'count1', 'place']) {
          const states = seen.map((l) => l.parts.find((p) => p.name === name)!.state === 'whole');
          assert.deepStrictEqual(states, [...states].sort((a, b) => Number(a) - Number(b)), `${locale} x${times} ${chosen}: ${name} ${states.map(Number).join('')}`);
        }
        await ctx.close();
      }
    }
  });

  it('keeps the words "No problems" in a narrow pane, where there is nothing to count', async () => {
    const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 700 } });
    const page = await ctx.newPage();
    await open(page, 'echo hello\n');
    await until('no problems', () => page.locator('#problems-title').textContent(), (t) => t === 'No problems', 15000);
    await page.evaluate("document.getElementById('split').style.setProperty('--split', '10%')");
    await page.evaluate(FRAMES);
    const got = (await page.evaluate(LOOK)) as Look;
    assert.ok(got.pane < 140, String(got.pane));
    assert.strictEqual(got.parts.find((p) => p.name === 'word')!.state, 'whole', JSON.stringify(got.parts));
    await ctx.close();
  });

  it('goes round with F8 and Shift+F8 beside the settings\' column, and not behind the modal sheet', async () => {
    const script = 'read line\nsource lib.sh; read other\nread more\n';
    const wide = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-US' });
    const page = await wide.newPage();
    await open(page, script);
    await until('the problems', () => page.locator('#problem-list .problem').count(), (n) => n > 2, 15000);
    await cursorToLine(page, 2);
    await until('where the cursor is', () => pos(page), (t) => !!t && t.startsWith('Ln 2'));
    await page.keyboard.press('F8');
    const at = await pos(page);
    await page.locator('#settings-open').click();
    await until('the column', () => page.evaluate("document.getElementById('settings-dialog').open && !document.getElementById('settings-dialog').matches(':modal')"), (v) => v === true);
    await page.keyboard.press('F8');
    await until('the next problem', () => pos(page), (t) => t !== at);
    await page.keyboard.press('Shift+F8');
    await until('back again', () => pos(page), (t) => t === at);
    await wide.close();
    // The sheet that takes the whole window shuts the page behind it.
    const small = await browser.newContext({ viewport: { width: 700, height: 800 }, locale: 'en-US' });
    const shut = await small.newPage();
    await open(shut, script);
    await until('the problems', () => shut.locator('#problem-list .problem').count(), (n) => n > 2, 15000);
    await cursorToLine(shut, 2);
    await until('where the cursor is', () => pos(shut), (t) => !!t && t.startsWith('Ln 2'));
    await shut.keyboard.press('F8');
    const here = await pos(shut);
    await shut.locator('#settings-open').click();
    await until('the modal sheet', () => shut.evaluate("document.getElementById('settings-dialog').matches(':modal')"), (v) => v === true);
    await shut.keyboard.press('F8');
    await shut.keyboard.press('Shift+F8');
    await shut.evaluate(FRAMES);
    assert.strictEqual(await pos(shut), here);
    assert.strictEqual(await shut.evaluate("document.getElementById('settings-dialog').contains(document.activeElement)"), true);
    await small.close();
  });
});
