// The web page's first ten seconds on a touch screen, and the small things around it (UX review of November 2026): one
// message on the first load, in Read mode, with the cursor's line above the sheet; the Problems rows of a phone; the toast
// beside the empty editor's block, and at the divider's far end; no empty line box. Run for real in headless Chromium
// (test/support/site.ts). docs/design/chrome-redesign.md, C3, C8 and section 8.
import * as assert from 'assert';
import type { Browser, BrowserContextOptions, Page } from 'playwright-core';
import { openSite, openProblems, stable, until, type Site } from './support/site';

interface Box { x: number; y: number; width: number; height: number; right: number; bottom: number }

describe('the web page: the first ten seconds on a touch screen, and what is around it', function () {
  this.timeout(180000);
  let browser: Browser;
  let firstVisit: Site['firstVisit'];
  let base = '';

  before(async function () {
    ({ browser, firstVisit, base } = await openSite(this));
  });

  const devices = async () => (await import('playwright-core')).devices;
  const phone = async (width: number, height: number, lang: 'en' | 'ja'): Promise<BrowserContextOptions> => ({
    ...(await devices())[width > height ? 'iPhone 13 landscape' : 'iPhone 13'], viewport: { width, height }, locale: lang === 'ja' ? 'ja-JP' : 'en-US',
  });

  const box = (page: Page, selector: string): Promise<Box | null> =>
    page.evaluate(`((s) => {
      const e = document.querySelector(s);
      if (!e || e.hidden) return null;
      const r = e.getBoundingClientRect();
      return r.width || r.height ? { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom } : null;
    })(${JSON.stringify(selector)})`) as Promise<Box | null>;
  const must = async (page: Page, selector: string): Promise<Box> => {
    const b = await box(page, selector);
    assert.ok(b, `${selector} is not shown`);
    return b;
  };
  const read = (page: Page) => page.evaluate("document.getElementById('mode-read').getAttribute('aria-pressed') === 'true'");
  const ready = async (page: Page, sheet = true) => {
    await page.locator('.cm-line').nth(5).waitFor();
    if (sheet) await until('the sheet', async () => (await page.evaluate("document.documentElement.dataset.sheet")) as string, (v) => !!v);
    return page;
  };
  /** Closes the switch's tip, which lies over the editor's top while it shows (the page is in Edit mode there). */
  const closeTip = async (page: Page) => {
    if (await page.locator('#readtip').isVisible()) await page.locator('#readtip-close').tap();
  };
  /** The cursor's line (all its rows) and the sheet's top, in the window. */
  const lineAndSheet = (page: Page) =>
    page.evaluate(`(() => {
      const rows = [...document.querySelectorAll('.cm-activeLine')].map((l) => l.getBoundingClientRect());
      return { top: Math.min(...rows.map((r) => r.top)), bottom: Math.max(...rows.map((r) => r.bottom)), sheet: document.getElementById('panel-pane').getBoundingClientRect().top, strip: document.getElementById('first-hint').getBoundingClientRect().bottom };
    })()`) as Promise<{ top: number; bottom: number; sheet: number; strip: number }>;

  for (const lang of ['en', 'ja'] as const) {
    for (const [width, height] of [[390, 664], [390, 844], [320, 568]]) {
      it(`shows one message, in Read mode, with the cursor's line above the sheet on the first load (${width} x ${height}, ${lang})`, async () => {
        const ctx = await firstVisit(await phone(width, height, lang));
        const page = await ctx.newPage();
        await page.goto(base);
        await ready(page);
        // One message, and not the tip of the switch: the page is in Read already.
        assert.strictEqual(await read(page), true);
        assert.strictEqual(await box(page, '#readtip'), null);
        const hint = await must(page, '#first-hint');
        // ...in one row of the bar's height or two lines of text, with no buttons: the editor keeps its room.
        assert.ok(hint.height <= 64, `the hint is ${hint.height} px high`);
        assert.strictEqual(await box(page, '.hint-actions'), null);
        assert.strictEqual(await page.locator('#first-hint-text').innerText(), lang === 'ja' ? '行をタップで解説を読む。入力は「編集」を選ぶ。' : 'Tap a line to read it, or tap Edit to type.');
        // The cursor's line (line 8, three rows long) is in view above the sheet, all of it, below the hint.
        const at = await stable('the cursor\'s line', async () => JSON.stringify(await lineAndSheet(page)));
        const { top, bottom, sheet, strip } = JSON.parse(at) as Awaited<ReturnType<typeof lineAndSheet>>;
        assert.ok(top >= strip - 1 && bottom <= sheet + 1, `the line is ${top}..${bottom}, the hint ends at ${strip}, the sheet starts at ${sheet}`);
        // A tap on a line shows its explanation, and nothing folds the sheet: Read mode keeps the keyboard away.
        const before = await must(page, '#panel-pane');
        await page.locator('.cm-line').nth(4).tap();
        await until('the cursor on the tapped line', async () => Number(await page.locator('.cm-lineNumbers .cm-activeLineGutter').first().textContent()), (n) => n === 5);
        assert.strictEqual(await page.evaluate('document.documentElement.dataset.keyboard ?? ""'), '');
        assert.strictEqual((await must(page, '#panel-pane')).y, before.y);
        assert.strictEqual(await page.evaluate('document.documentElement.dataset.sheet'), 'half');
        await ctx.close();
      });
    }
  }

  it('keeps the mode the user chose, and starts in Edit for a script from a link', async () => {
    const options = await phone(390, 664, 'en');
    // Edit chosen on the first visit: the next load stays in Edit, whatever the page shows (and no tip: the switch was used).
    const ctx = await firstVisit(options);
    const page = await ctx.newPage();
    await page.goto(base);
    await ready(page);
    await page.locator('#mode-edit').tap();
    assert.strictEqual(await page.evaluate("localStorage.getItem('bash-explainer-read-mode')"), '0');
    await page.reload();
    await ready(page);
    assert.strictEqual(await read(page), false);
    assert.strictEqual(await box(page, '#readtip'), null);
    // Read chosen again: kept too.
    await page.locator('#mode-read').tap();
    await page.reload();
    await ready(page);
    assert.strictEqual(await read(page), true);
    // A script from a link, with a mode chosen: the choice stands.
    await page.goto(`${base}#t=${Buffer.from('echo hi\n').toString('base64url')}`);
    await page.reload();
    await page.locator('.cm-line').first().waitFor();
    assert.strictEqual(await page.locator('.cm-line').first().innerText(), 'echo hi');
    assert.strictEqual(await read(page), true);
    await ctx.close();
    // With no mode chosen, a script that is not the sample starts in Edit, with the switch's tip: nothing to read yet.
    const second = await firstVisit(options);
    const p2 = await second.newPage();
    await p2.goto(`${base}#t=${Buffer.from('echo hi\n').toString('base64url')}`);
    await p2.locator('.cm-line').first().waitFor();
    await until('the tip', () => p2.locator('#readtip').isVisible(), (v) => v);
    assert.strictEqual(await read(p2), false);
    assert.strictEqual(await p2.evaluate("localStorage.getItem('bash-explainer-read-mode')"), null);
    // Typing and opening never choose a mode: nothing is stored until the switch is used.
    await p2.locator('#readtip-close').tap();
    await p2.locator('#ed-more').tap();
    await p2.locator('#more-sample').tap();
    assert.strictEqual(await p2.evaluate("localStorage.getItem('bash-explainer-read-mode')"), null);
    assert.strictEqual(await read(p2), false);
    await second.close();
  });

  it('keeps Edit one tap away and reachable from the hint\'s words: the switch is in the strip, 44 px high', async () => {
    const ctx = await firstVisit(await phone(390, 664, 'en'));
    const page = await ctx.newPage();
    await page.goto(base);
    await ready(page);
    const edit = await must(page, '#mode-edit');
    assert.ok(edit.height >= 44 && edit.width >= 44);
    await page.locator('#mode-edit').tap();
    assert.strictEqual(await read(page), false);
    assert.strictEqual(await page.evaluate("document.querySelector('.cm-content').getAttribute('inputmode')"), null);
    await ctx.close();
  });

  it('starts an upright iPad Mini in Read too, with the cursor\'s line above the sheet; a desktop at 640 px is unchanged', async () => {
    const ctx = await firstVisit({ ...(await devices())['iPad Mini'], locale: 'en-US' });
    const page = await ctx.newPage();
    await page.goto(base);
    await ready(page);
    assert.strictEqual(await read(page), true);
    assert.strictEqual(await box(page, '#readtip'), null);
    const hint = await must(page, '#first-hint');
    assert.ok(hint.height <= 64);
    const { bottom, sheet } = await stable('the line', async () => (JSON.stringify(await lineAndSheet(page)) as string)).then((s) => JSON.parse(s) as { bottom: number; sheet: number });
    assert.ok(bottom <= sheet + 1);
    await ctx.close();

    const desk = await firstVisit({ viewport: { width: 640, height: 800 }, locale: 'en-US' });
    const d = await desk.newPage();
    await d.goto(base);
    await d.locator('.cm-line').nth(5).waitFor();
    assert.strictEqual(await box(d, '#readtip'), null);
    assert.strictEqual(await d.locator('#first-hint-text').innerText(), 'This is a sample: put the cursor on any line.');
    // The hint keeps its two buttons, and the editor takes the keyboard (no inputmode="none").
    assert.ok(await must(d, '.hint-actions'));
    assert.strictEqual(await d.evaluate("document.querySelector('.cm-content').getAttribute('inputmode')"), null);
    await desk.close();
  });

  for (const lang of ['en', 'ja'] as const) {
    for (const [width, height] of [[320, 568], [390, 664], [390, 844]]) {
      it(`keeps a toast clear of the empty editor's buttons on a phone (${width} x ${height}, ${lang})`, async () => {
        const ctx = await browser.newContext(await phone(width, height, lang));
        const page = await ctx.newPage();
        await page.goto(base);
        await ready(page);
        await closeTip(page);
        await page.locator('#ed-more').tap();
        await page.locator('#more-clear').tap();
        await until('the toast', () => box(page, '#status'), (b) => !!b && b.width > 0);
        await stable('the toast', async () => JSON.stringify([await box(page, '#status'), await box(page, '#empty-sample')]));
        const toast = await must(page, '#status');
        const sheet = (await must(page, '#panel-pane')).y;
        for (const id of ['#empty-paste', '#empty-open', '#empty-sample']) {
          const b = await must(page, id);
          // Not overlapped by the toast, above the sheet, at least 44 px high and wide, and what is at its centre is itself.
          assert.ok(b.bottom <= toast.y + 0.5 || b.y >= toast.bottom || b.right <= toast.x || b.x >= toast.right, `${id} is under the toast`);
          assert.ok(b.bottom <= sheet + 0.5, `${id} is under the sheet`);
          assert.ok(b.width >= 44 && b.height >= 44, `${id} is ${b.width} x ${b.height}`);
          assert.strictEqual(await page.evaluate(`!!document.elementFromPoint(${b.x + b.width / 2}, ${b.y + b.height / 2})?.closest(${JSON.stringify(id)})`), true, id);
        }
        assert.ok(toast.bottom <= sheet + 0.5);
        // ("Undo" is pressable too: its centre is the button.)
        const undo = await must(page, '#status-action');
        assert.strictEqual(await page.evaluate(`document.elementFromPoint(${undo.x + undo.width / 2}, ${undo.y + undo.height / 2})?.id`), 'status-action');
        await ctx.close();
      });
    }
  }

  it('shows no empty line box over "Nothing to explain on this line." at any width', async () => {
    for (const [name, options] of [['phone', await phone(390, 664, 'en')], ['desktop', { viewport: { width: 1280, height: 800 }, locale: 'en-US' }]] as const) {
      const ctx = await browser.newContext(options);
      const page = await ctx.newPage();
      await page.goto(base);
      await ready(page, name === 'phone');
      if (name === 'phone') await closeTip(page);
      const panel = () => page.frames().find((f) => f.url().endsWith('/panel.html'))!;
      assert.strictEqual(await panel().locator('#line').isVisible(), true, name);
      // An empty line of the sample (line 2) and a cleared editor.
      await page.locator('.cm-line').nth(1).click();
      await until('the empty line', () => panel().locator('#empty').isVisible(), (v) => v);
      assert.strictEqual(await panel().locator('#line').isVisible(), false, name);
      await page.locator('.cm-line').nth(3).click();
      await until('a line again', () => panel().locator('#line').isVisible(), (v) => v);
      await ctx.close();
    }
  });

  it('keeps the toast readable with the divider far to the left, inside the window (768 px, 15%)', async () => {
    const ctx = await browser.newContext({ viewport: { width: 768, height: 800 }, locale: 'en-US' });
    await ctx.addInitScript("try { localStorage.setItem('bash-explainer-split', '{\"wide\":15}'); } catch {}");
    const page = await ctx.newPage();
    await page.goto(base);
    await page.locator('.cm-line').nth(5).waitFor();
    assert.ok(Math.abs((await must(page, '#source')).width - 115) < 2);
    await page.locator('#ed-more').click();
    await page.locator('#more-clear').click();
    const toast = await until('the toast', () => must(page, '#status'), (b) => b.width > 0);
    await stable('the toast', async () => JSON.stringify(await box(page, '#status')));
    const t = await must(page, '#status');
    assert.ok(t.width >= 200, `the toast is ${t.width} px wide`);
    assert.ok(t.height <= 80, `the toast is ${t.height} px high`);
    assert.ok(t.x >= 0 && t.right <= 768 && t.y >= 0 && t.bottom <= 800);
    void toast;
    await ctx.close();
  });

  describe('the Problems rows', () => {
    const rowBoxes = (page: Page) =>
      page.evaluate(`(() => {
        const row = document.querySelector('#problem-list .problem');
        const r = (s) => { const b = row.querySelector(s).getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height, right: b.right, bottom: b.bottom }; };
        const b = row.getBoundingClientRect();
        return { row: r('.where'), message: r('.message'), code: r('.code'), button: { width: b.width } };
      })()`) as Promise<{ message: Box; code: Box; button: { width: number } }>;

    for (const lang of ['en', 'ja'] as const) {
      for (const [width, height] of [[320, 568], [390, 664], [844, 390]]) {
        it(`keeps the message whole beside the code or over it (${width} x ${height}, ${lang})`, async () => {
          const ctx = await browser.newContext(await phone(width, height, lang));
          const page = await ctx.newPage();
          await page.goto(base);
          await page.locator('.cm-line').nth(5).waitFor();
          await openProblems(page).catch(() => undefined);
          await until('the rows', () => page.locator('#problem-list .problem').count(), (n) => n > 0);
          const sheet = await page.evaluate("document.documentElement.classList.contains('bottom-sheet')");
          await stable('the row', async () => JSON.stringify(await rowBoxes(page)));
          const { message, code, button } = await rowBoxes(page);
          assert.ok(message.width > 0);
          const wide = button.width >= 520;
          if (sheet && !wide) {
            // On a phone's sheet: the code is under the message, in its columns, and the message has the row's width.
            assert.ok(code.y >= message.bottom - 1, `the code (${code.y}) is not under the message (${message.bottom})`);
            assert.ok(Math.abs(code.x - message.x) < 1);
            assert.ok(message.width >= button.width * 0.6, `the message is ${message.width} of ${button.width} px`);
          } else if ((await page.evaluate("getComputedStyle(document.querySelector('#problem-list .code')).display")) !== 'none') {
            // Wide (a window held sideways, a tablet): the code in a column of its own, beside the message.
            assert.ok(code.x >= message.right - 1, `${JSON.stringify({ message, code })}`);
          }
          await ctx.close();
        });
      }
    }

    it('keeps the rule beside the message on an upright iPad Mini\'s sheet, and on a desktop', async () => {
      for (const options of [{ ...(await devices())['iPad Mini'], locale: 'en-US' }, { viewport: { width: 1280, height: 800 }, locale: 'en-US' }]) {
        const ctx = await browser.newContext(options);
        const page = await ctx.newPage();
        await page.goto(base);
        await page.locator('.cm-line').nth(5).waitFor();
        await openProblems(page);
        await until('the rows', () => page.locator('#problem-list .problem').count(), (n) => n > 0);
        await stable('the row', async () => JSON.stringify(await rowBoxes(page)));
        const { message, code } = await rowBoxes(page);
        assert.ok(code.width > 0 && code.x >= message.right - 1 && Math.abs(code.y - message.y) < 6, `${JSON.stringify({ message, code })}`);
        await ctx.close();
      }
    });
  });
});
