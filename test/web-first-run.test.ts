// The web page's first ten seconds on a touch screen, and the small things around it (UX review of November 2026): one
// message on the first load, in Read mode, with the cursor's line above the sheet; the Problems rows of a phone; the toast
// beside the empty editor's block, and at the divider's far end; no empty line box. Run for real in headless Chromium
// (test/support/site.ts). docs/design/chrome-redesign.md, C3, C8 and section 8.
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import type { Browser, BrowserContextOptions, Page } from 'playwright-core';
import { frames, openSite, root, openProblems, stable, until, type Site } from './support/site';

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

  /** The hint's words in Read mode, where they are true, and in Edit. */
  const HINT_READ = { en: 'Tap a line to read it, or tap Edit to type.', ja: '行をタップで解説。入力は「編集」へ。' };
  const HINT_EDIT = { en: 'This is a sample: put the cursor on any line.', ja: 'サンプルです。好きな行を選んでください。' };
  const inputmode = (page: Page) => page.evaluate("document.querySelector('.cm-content').getAttribute('inputmode')");
  const storedMode = (page: Page) => page.evaluate("localStorage.getItem('bash-explainer-read-mode')");
  const link = (text: string) => `#t=${Buffer.from(text).toString('base64url')}`;
  /** The rows of text an element's words take: its boxes' distinct tops. */
  const textRows = (page: Page, selector: string) =>
    page.evaluate(`(() => {
      const range = document.createRange();
      range.selectNodeContents(document.querySelector(${JSON.stringify(selector)}));
      return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
    })()`) as Promise<number>;
  const scroller = (page: Page) => page.evaluate("(() => { const s = document.querySelector('.cm-scroller'); return { top: s.scrollTop, left: s.scrollLeft }; })()") as Promise<{ top: number; left: number }>;
  const settledScroll = (page: Page) => stable('the scroll', () => scroller(page));
  /** Moves the sheet to a height from the keyboard, on its grabber (Home is the peek, then ↑ one height each). */
  const snapTo = async (page: Page, snap: 'peek' | 'half' | 'full') => {
    await page.locator('#sheet-grab').focus();
    await page.keyboard.press('Home');
    for (let i = 0; i < ['peek', 'half', 'full'].indexOf(snap); i++) await page.keyboard.press('ArrowUp');
    await until('the sheet', () => page.evaluate('document.documentElement.dataset.sheet'), (v) => v === snap);
    await stable('the sheet', () => box(page, '#panel-pane'));
  };

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
        // ...one row of 48 px, whatever the words take in it: the words, "Use my own script" and the ✕.
        assert.strictEqual(hint.height, 48);
        assert.strictEqual(await page.locator('#first-hint-text').innerText(), HINT_READ[lang]);
        const own = await must(page, '#hint-own');
        const close = await must(page, '#first-hint-close');
        assert.ok(own.width >= 96 && own.height === 44, `Use my own script is ${own.width} x ${own.height}`);
        assert.deepStrictEqual([close.width, close.height], [44, 44]);
        assert.strictEqual(await box(page, '#hint-open'), null);
        assert.strictEqual(await page.evaluate(`document.elementFromPoint(${own.x + own.width / 2}, ${own.y + own.height / 2})?.id`), 'hint-own');
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
    // Loading the sample over it does not choose a mode either: it stays in Edit, and nothing is stored.
    await p2.locator('#readtip-close').tap();
    await p2.locator('#ed-more').tap();
    await p2.locator('#more-sample').tap();
    assert.strictEqual(await storedMode(p2), null);
    assert.strictEqual(await read(p2), false);
    await second.close();
  });

  describe('a script put in while the page starts in Read: pasted, opened or dropped, it changes no mode and stores none', () => {
    const NEW = 'echo pasted\n';
    const shown = (page: Page) => page.locator('.cm-content').innerText();
    const cases: [string, (page: Page) => Promise<unknown>][] = [
      ['pasted, as the system\'s menu does', (page) => page.evaluate(`(() => {
        const data = new DataTransfer();
        data.setData('text/plain', ${JSON.stringify(NEW)});
        document.querySelector('.cm-content').dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
      })()`)],
      ['opened from the menu', async (page) => {
        await page.evaluate('for (const o of [window, Window.prototype]) { delete o.showOpenFilePicker; delete o.showSaveFilePicker; }');
        await page.locator('#menu-open').tap();
        await until('the menu', () => page.locator('#menu-open-file').isVisible(), (v) => v);
        const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('#menu-open-file').tap()]);
        await chooser.setFiles({ name: 'a.sh', mimeType: 'text/plain', buffer: Buffer.from(NEW) });
      }],
      ['a file dropped', (page) => page.evaluate(`(() => {
        const target = document.querySelector('.cm-line');
        const r = target.getBoundingClientRect();
        const data = new DataTransfer();
        data.items.add(new File([${JSON.stringify(NEW)}], 'a.sh'));
        const at = { dataTransfer: data, clientX: r.left + 5, clientY: r.top + 5, bubbles: true, cancelable: true };
        target.dispatchEvent(new DragEvent('dragenter', at));
        target.dispatchEvent(new DragEvent('dragover', at));
        target.dispatchEvent(new DragEvent('drop', at));
      })()`)],
    ];
    for (const [name, put] of cases) {
      it(name, async () => {
        const ctx = await firstVisit(await phone(390, 664, 'en'));
        const page = await ctx.newPage();
        await page.goto(base);
        await ready(page);
        assert.strictEqual(await inputmode(page), 'none');
        await put(page);
        await until('the script', () => shown(page), (t) => t.includes('echo pasted'));
        assert.strictEqual(await read(page), true);
        assert.strictEqual(await inputmode(page), 'none');
        assert.strictEqual(await storedMode(page), null);
        // (It is the sample's hint: another script has none.)
        await until('the hint gone', async () => box(page, '#first-hint'), (b) => b === null);
        await ctx.close();
      });
    }
  });

  it('says what a tap does in the mode the page is in: after Edit is tapped, after a reload with Edit stored, and on the sample loaded over a link', async () => {
    for (const lang of ['en', 'ja'] as const) {
      const ctx = await firstVisit(await phone(390, 664, lang));
      const page = await ctx.newPage();
      await page.goto(base);
      await ready(page);
      const words = () => page.locator('#first-hint-text').innerText();
      assert.strictEqual(await words(), HINT_READ[lang]);
      await page.locator('#mode-edit').tap();
      assert.strictEqual(await words(), HINT_EDIT[lang]);
      assert.strictEqual(await inputmode(page), null);
      assert.strictEqual((await must(page, '#first-hint')).height, 48);
      await page.reload();
      await ready(page);
      assert.strictEqual(await storedMode(page), '0');
      assert.strictEqual(await words(), HINT_EDIT[lang]);
      assert.strictEqual(await inputmode(page), null);
      await page.locator('#mode-read').tap();
      assert.strictEqual(await words(), HINT_READ[lang]);
      assert.strictEqual(await inputmode(page), 'none');
      await ctx.close();

      // From a link, then the sample: the page stays in Edit, and says so.
      const second = await firstVisit(await phone(390, 664, lang));
      const p2 = await second.newPage();
      await p2.goto(`${base}${link('echo hi\n')}`);
      await p2.locator('.cm-line').first().waitFor();
      await until('the tip', () => p2.locator('#readtip').isVisible(), (v) => v);
      await p2.locator('#readtip-close').tap();
      await p2.locator('#ed-more').tap();
      await p2.locator('#more-sample').tap();
      await until('the hint', () => box(p2, '#first-hint'), (b) => b !== null);
      assert.strictEqual(await p2.locator('#first-hint-text').innerText(), HINT_EDIT[lang]);
      assert.strictEqual(await inputmode(p2), null);
      assert.strictEqual(await read(p2), false);
      await second.close();
    }
  });

  it('takes the sample from a link for the sample: one reading of what the sample is', async () => {
    const sample = fs.readFileSync(path.join(root, 'test/fixtures/sample.sh'), 'utf8');
    const ctx = await firstVisit(await phone(390, 664, 'en'));
    const page = await ctx.newPage();
    await page.goto(`${base}${link(sample)}`);
    await ready(page);
    assert.strictEqual(await read(page), true);
    assert.strictEqual(await inputmode(page), 'none');
    assert.strictEqual(await page.locator('#first-hint-text').innerText(), HINT_READ.en);
    await ctx.close();
  });

  it('has the hint\'s words in as many rows as they need, and its height stays', async () => {
    // (Rows of text, not of the bar: two beside the button on a phone upright, one on a wider screen.)
    const want: [number, number, 'en' | 'ja', number][] = [
      [390, 664, 'en', 2], [390, 664, 'ja', 2], [360, 640, 'en', 2], [360, 640, 'ja', 2], [320, 568, 'en', 2], [320, 568, 'ja', 2], [844, 390, 'en', 1], [844, 390, 'ja', 1],
    ];
    for (const [width, height, lang, rows] of want) {
      const ctx = await firstVisit(await phone(width, height, lang));
      const page = await ctx.newPage();
      await page.goto(base);
      await ready(page);
      await must(page, '#first-hint');
      assert.deepStrictEqual([width, lang, await textRows(page, '#first-hint-text'), (await must(page, '#first-hint')).height], [width, lang, rows, 48]);
      assert.strictEqual(await textRows(page, '#hint-own'), 2, `${width} ${lang}`);
      await ctx.close();
    }
  });

  it('breaks the Japanese hint between its two sentences, and never inside the name of Edit', async () => {
    for (const [width, height] of [[320, 568], [360, 640], [390, 664]]) {
      const ctx = await firstVisit(await phone(width, height, 'ja'));
      const page = await ctx.newPage();
      await page.goto(base);
      await ready(page);
      const rows = await page.evaluate(`(() => {
        const text = document.getElementById('first-hint-text').firstChild;
        const range = document.createRange();
        const rows = [];
        for (let i = 0; i < text.length; i++) {
          range.setStart(text, i);
          range.setEnd(text, i + 1);
          const top = Math.round(range.getClientRects()[0].top);
          if (rows.at(-1)?.top !== top) rows.push({ top, text: '' });
          rows.at(-1).text += text.data[i];
        }
        return rows.map((r) => r.text);
      })()`);
      assert.deepStrictEqual(rows, ['行をタップで解説。', '入力は「編集」へ。'], `${width}`);
      const own = await page.evaluate(`(() => {
        const text = document.getElementById('hint-own').firstChild;
        const range = document.createRange();
        range.setStart(text, 0);
        range.setEnd(text, 3);
        const first = range.getClientRects()[0].top;
        range.setStart(text, 4);
        range.setEnd(text, 5);
        return range.getClientRects()[0].top > first;
      })()`);
      assert.strictEqual(own, true, 'the button breaks before スクリプト');
      await ctx.close();
    }
  });

  describe('my own script, on a touch screen', () => {
    for (const lang of ['en', 'ja'] as const) {
      it(`goes from the hint to an empty editor that a tap can type in, and stores nothing (${lang})`, async () => {
        const ctx = await firstVisit(await phone(390, 664, lang));
        const page = await ctx.newPage();
        await page.goto(base);
        await ready(page);
        assert.strictEqual(await inputmode(page), 'none');
        await page.locator('#hint-own').tap();
        await until('the empty editor', () => box(page, '#empty-editor'), (b) => b !== null);
        assert.strictEqual(await box(page, '#first-hint'), null);
        assert.strictEqual(await inputmode(page), null);
        assert.strictEqual(await read(page), false);
        assert.strictEqual(await storedMode(page), null);
        // The first letters keep the keyboard: no attribute takes it away as the text stops being empty.
        await page.locator('.cm-line').first().tap();
        await page.keyboard.insertText('echo');
        await until('the text', () => page.evaluate("document.querySelector('.cm-line').textContent"), (t) => t === 'echo');
        assert.strictEqual(await inputmode(page), null);
        assert.strictEqual(await read(page), false);
        assert.strictEqual(await storedMode(page), null);
        await ctx.close();
      });
    }

    it('goes to Edit on Clear with no mode chosen, and back to Read with the sample (Undo, Load the sample)', async () => {
      const ctx = await firstVisit(await phone(390, 664, 'en'));
      const page = await ctx.newPage();
      await page.goto(base);
      await ready(page);
      const clear = async () => {
        await page.locator('#ed-more').tap();
        await page.locator('#more-clear').tap();
        await until('the empty editor', () => box(page, '#empty-editor'), (b) => b !== null);
      };
      await clear();
      assert.deepStrictEqual([await inputmode(page), await read(page), await storedMode(page)], [null, false, null]);
      await page.locator('#status-action').tap();
      await until('the sample', () => box(page, '#empty-editor'), (b) => b === null);
      assert.deepStrictEqual([await inputmode(page), await read(page), await storedMode(page)], ['none', true, null]);
      assert.strictEqual(await page.locator('#first-hint-text').innerText(), HINT_READ.en);
      await clear();
      await page.locator('#empty-sample').tap();
      await until('the sample', () => box(page, '#empty-editor'), (b) => b === null);
      assert.deepStrictEqual([await inputmode(page), await read(page), await storedMode(page)], ['none', true, null]);
      await ctx.close();
    });

    it('keeps Read when the user chose it, on an empty editor too; Edit stored stays Edit', async () => {
      for (const [stored, im, pressed] of [['1', 'none', true], ['0', null, false]] as const) {
        const ctx = await firstVisit(await phone(390, 664, 'en'));
        await ctx.addInitScript(`try { localStorage.setItem('bash-explainer-read-mode', '${stored}'); localStorage.setItem('bash-explainer-read-tip-seen', '1'); } catch {}`);
        const page = await ctx.newPage();
        await page.goto(base);
        await ready(page);
        await page.locator('#ed-more').tap();
        await page.locator('#more-clear').tap();
        await until('the empty editor', () => box(page, '#empty-editor'), (b) => b !== null);
        assert.deepStrictEqual([await inputmode(page), await read(page), await storedMode(page)], [im, pressed, stored]);
        await ctx.close();
      }
    });
  });

  describe('the pages without the switch', () => {
    for (const stored of [null, '1', '0']) {
      it(`keeps the keyboard on compare.html on a touch screen (read mode stored: ${stored})`, async () => {
        const ctx = await firstVisit(await phone(390, 844, 'en'));
        if (stored) await ctx.addInitScript(`try { localStorage.setItem('bash-explainer-read-mode', '${stored}'); } catch {}`);
        const page = await ctx.newPage();
        await page.goto(`${base}compare.html`);
        await page.locator('.cm-line').nth(5).waitFor();
        assert.strictEqual(await page.locator('#mode-read').count(), 0);
        assert.strictEqual(await inputmode(page), null);
        await ctx.close();
      });
    }
  });

  describe('where the reader is', () => {
    const scrolledAway = async (page: Page, top: number) => {
      await page.evaluate(`document.querySelector('.cm-scroller').scrollTop = ${top}`);
      // (CodeMirror measures the lines it draws now, and keeps the first in place: the number moves a little, once.)
      const at = await settledScroll(page);
      assert.ok(at.top > top / 2, `scrolled to ${at.top}`);
      const away = await page.evaluate(`(() => {
        const line = document.querySelector('.cm-activeLine');
        return !line || line.getBoundingClientRect().bottom <= document.querySelector('.cm-scroller').getBoundingClientRect().top;
      })()`);
      assert.strictEqual(away, true, 'the cursor\'s line is above what shows');
      return at;
    };

    it('stays when the hint is closed, far from the cursor (desktop, 1280 x 800)', async () => {
      const ctx = await firstVisit({ viewport: { width: 1280, height: 800 }, locale: 'en-US' });
      const page = await ctx.newPage();
      await page.goto(base);
      await ready(page, false);
      await must(page, '#first-hint');
      const at = await scrolledAway(page, 900);
      await page.locator('#first-hint-close').click();
      assert.strictEqual(await box(page, '#first-hint'), null);
      assert.deepStrictEqual(await settledScroll(page), at);
      await ctx.close();
    });

    it('stays when the hint is closed, far from the cursor (phone, 390 x 664)', async () => {
      const ctx = await firstVisit(await phone(390, 664, 'en'));
      const page = await ctx.newPage();
      await page.goto(base);
      await ready(page);
      await must(page, '#first-hint');
      const at = await scrolledAway(page, 900);
      await page.locator('#first-hint-close').tap();
      assert.strictEqual(await box(page, '#first-hint'), null);
      assert.deepStrictEqual(await settledScroll(page), at);
      await ctx.close();
    });

    it('stays when the cursor\'s line is under the sheet and the hint is closed (phone, 390 x 664)', async () => {
      const ctx = await firstVisit(await phone(390, 664, 'en'));
      const page = await ctx.newPage();
      await page.goto(base);
      await ready(page);
      await must(page, '#first-hint');
      // The cursor on a line further down, then scrolled so that the whole line is below the sheet's top, in the editor's box.
      await page.evaluate("document.querySelector('.cm-scroller').scrollTop = 300");
      await settledScroll(page);
      await page.locator('.cm-line').nth(3).waitFor();
      const target = await page.evaluate(`(() => {
        const box = document.querySelector('.cm-scroller').getBoundingClientRect();
        const line = [...document.querySelectorAll('.cm-line')].find((l) => l.getBoundingClientRect().top > box.top + 8);
        const r = line.getBoundingClientRect();
        return { x: r.left + 40, y: r.top + 5 };
      })()`) as { x: number; y: number };
      await page.touchscreen.tap(target.x, target.y);
      await settledScroll(page);
      const { top, sheet } = await lineAndSheet(page);
      const was = (await scroller(page)).top;
      // (Further than the hint's 48 px, which the code rises by when it goes.)
      const to = was - (sheet - top) - 60;
      assert.ok(to >= 0, `the line is at ${top}, the sheet at ${sheet}, the scroll at ${was}`);
      await page.evaluate(`document.querySelector('.cm-scroller').scrollTop = ${to}`);
      const at = await settledScroll(page);
      await page.locator('#first-hint-close').tap();
      assert.strictEqual(await box(page, '#first-hint'), null);
      assert.deepStrictEqual(await settledScroll(page), at);
      await ctx.close();
    });

    it('stays when the switch\'s tip is closed with Edit stored, and the hint comes', async () => {
      const ctx = await firstVisit(await phone(390, 664, 'en'));
      await ctx.addInitScript("try { localStorage.setItem('bash-explainer-read-mode', '0'); } catch {}");
      const page = await ctx.newPage();
      await page.goto(base);
      await ready(page);
      await until('the tip', () => page.locator('#readtip').isVisible(), (v) => v);
      assert.strictEqual(await box(page, '#first-hint'), null);
      const at = await scrolledAway(page, 900);
      await page.locator('#readtip-close').tap();
      await until('the hint', () => box(page, '#first-hint'), (b) => b !== null);
      assert.deepStrictEqual(await settledScroll(page), at);
      await ctx.close();
    });

    it('keeps the whole of the cursor\'s line above the sheet when the sheet rises, with the cursor\'s line in view before', async () => {
      const ctx = await browser.newContext(await phone(390, 664, 'en'));
      const page = await ctx.newPage();
      await page.goto(base);
      await ready(page);
      await closeTip(page);
      await snapTo(page, 'peek');
      await snapTo(page, 'half');
      const { top, bottom, sheet } = JSON.parse(await stable('the line', async () => JSON.stringify(await lineAndSheet(page)))) as Awaited<ReturnType<typeof lineAndSheet>>;
      // (Line 8 of the sample wraps: more than a row.)
      assert.ok(bottom - top > 30, `the line is ${bottom - top} px high`);
      assert.ok(bottom <= sheet, `the line ends at ${bottom}, the sheet starts at ${sheet}`);
      await ctx.close();
    });

    const LONG = `echo ${'word '.repeat(600)}\nls\n`;
    const noWrap = "try { localStorage.setItem('bash-explainer-settings', JSON.stringify({ 'bashExplainer.editor.wrap': false })); } catch {}";

    it('does not move sideways when the settings open and close, with long lines unwrapped (desktop, 1100 x 600)', async () => {
      const ctx = await browser.newContext({ viewport: { width: 1100, height: 600 }, locale: 'en-US' });
      await ctx.addInitScript(noWrap);
      const page = await ctx.newPage();
      await page.goto(`${base}${link(LONG)}`);
      await page.locator('.cm-line').first().waitFor();
      assert.strictEqual(await page.locator('.cm-lineWrapping').count(), 0);
      assert.strictEqual((await scroller(page)).left, 0);
      await page.locator('#settings-open').click();
      await until('the settings', () => page.locator('#settings-dialog').evaluate((d: { open?: boolean }) => !!d.open), (v) => v);
      assert.strictEqual((await settledScroll(page)).left, 0);
      await page.keyboard.press('Escape');
      await until('the settings closed', () => page.locator('#settings-dialog').evaluate((d: { open?: boolean }) => !!d.open), (v) => !v);
      assert.strictEqual((await settledScroll(page)).left, 0);
      await ctx.close();
    });

    it('does not move sideways when the sheet goes to full, with long lines unwrapped (phone, 390 x 664)', async () => {
      const ctx = await browser.newContext(await phone(390, 664, 'en'));
      await ctx.addInitScript(noWrap);
      const page = await ctx.newPage();
      await page.goto(`${base}${link(LONG)}`);
      await page.locator('.cm-line').first().waitFor();
      await until('the sheet', () => page.evaluate('document.documentElement.dataset.sheet'), (v) => !!v);
      await closeTip(page);
      await page.evaluate("document.querySelector('.cm-scroller').scrollLeft = 55");
      assert.strictEqual((await settledScroll(page)).left, 55);
      await snapTo(page, 'full');
      assert.strictEqual((await settledScroll(page)).left, 55);
      await snapTo(page, 'half');
      assert.strictEqual((await settledScroll(page)).left, 55);
      await ctx.close();
    });

    it('does not move when the settings close with the cursor in view and its line wrapped past the room (wrap on, 1100 x 400)', async () => {
      const ctx = await browser.newContext({ viewport: { width: 1100, height: 400 }, locale: 'en-US' });
      const page = await ctx.newPage();
      await page.goto(`${base}${link(`echo ${'word '.repeat(30)}\n`.repeat(12))}`);
      await page.locator('.cm-line').nth(5).waitFor();
      // The cursor on the first row of the line that the editor's end cuts: the rest of the line is past the end.
      const cut = await page.evaluate(`(() => {
        const end = document.querySelector('.cm-scroller').getBoundingClientRect().bottom;
        const line = [...document.querySelectorAll('.cm-line')].find((l) => l.getBoundingClientRect().bottom > end);
        const r = line.getBoundingClientRect();
        return { x: r.left + 10, y: r.top + 5, top: r.top, bottom: r.bottom, end };
      })()`) as { x: number; y: number; top: number; bottom: number; end: number };
      assert.ok(cut.top + 30 < cut.end && cut.bottom > cut.end, JSON.stringify(cut));
      await page.mouse.click(cut.x, cut.y);
      const at = await settledScroll(page);
      assert.strictEqual(at.top, 0);
      const dialog = () => page.locator('#settings-dialog').evaluate((d: { open?: boolean }) => !!d.open);
      await page.locator('#settings-open').click();
      await until('the settings', dialog, (v) => v);
      await page.keyboard.press('Escape');
      await until('the settings closed', dialog, (v) => !v);
      await frames(page, 4);
      assert.strictEqual((await settledScroll(page)).top, 0);
      await ctx.close();
    });
  });

  describe('the line box and the quick reference', () => {
    const line = (page: Page) => page.frames().find((f) => f.url().endsWith('/panel.html'))!.locator('#line');
    for (const [name, options] of [['1280 x 800', () => ({ viewport: { width: 1280, height: 800 }, locale: 'en-US' })], ['390 x 664', () => phone(390, 664, 'en')]] as const) {
      it(`never shows the box over the quick reference; a blank line has none when it closes (${name})`, async () => {
        const ctx = await browser.newContext(await options());
        const page = await ctx.newPage();
        await page.goto(base);
        await ready(page, name !== '1280 x 800');
        await closeTip(page);
        const panel = page.frames().find((f) => f.url().endsWith('/panel.html'))!;
        const click = (n: number) => (name === '1280 x 800' ? page.locator('.cm-line').nth(n).click() : page.locator('.cm-line').nth(n).tap());
        const press = (id: string) => (name === '1280 x 800' ? page.locator(id).click() : page.locator(id).tap());
        await until('the box', () => line(page).isVisible(), (v) => v);
        await press('#tab-ref');
        await until('the reference', () => panel.locator('#reference').isVisible(), (v) => v);
        assert.strictEqual(await line(page).isVisible(), false);
        // The cursor moves while it is open: an update comes, and the box stays away.
        await click(3);
        await until('the line', () => page.locator('.cm-lineNumbers .cm-activeLineGutter').first().textContent(), (n) => n === '4');
        await frames(page, 4);
        await panel.evaluate('new Promise((done) => setTimeout(done, 300))');
        assert.strictEqual(await line(page).isVisible(), false);
        assert.strictEqual(await panel.locator('#reference').isVisible(), true);
        // A blank line, then back to the explanation: no box.
        await click(1);
        await until('the line', () => page.locator('.cm-lineNumbers .cm-activeLineGutter').first().textContent(), (n) => n === '2');
        await panel.evaluate('new Promise((done) => setTimeout(done, 300))');
        await press('#tab-explain');
        await until('the explanation', () => panel.locator('#reference').isVisible(), (v) => !v);
        assert.strictEqual(await line(page).isVisible(), false);
        // A line with words: the box is back.
        await click(3);
        await until('the box', () => line(page).isVisible(), (v) => v);
        await ctx.close();
      });
    }

    it('draws the box for a line of a no-break or an ideographic space; a line of spaces and tabs in a heredoc keeps its rows and has no box', async () => {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-US' });
      const page = await ctx.newPage();
      await page.goto(`${base}${link('\u3000\n\u00a0\ncat <<EOF\n \t \nEOF\n')}`);
      await page.locator('.cm-line').nth(3).waitFor();
      const panel = () => page.frames().find((f) => f.url().endsWith('/panel.html'))!;
      await until('the box', () => line(page).isVisible(), (v) => v);
      await page.locator('.cm-line').nth(1).click();
      await until('the second line', () => page.locator('.cm-lineNumbers .cm-activeLineGutter').first().textContent(), (n) => n === '2');
      await until('its text', () => line(page).textContent(), (t) => t === '\u00a0');
      assert.strictEqual(await line(page).isVisible(), true);
      await page.locator('.cm-line').nth(3).click();
      await until('no box', () => line(page).isVisible(), (v) => !v);
      assert.strictEqual(await panel().locator('#empty').isVisible(), false);
      assert.ok(await panel().locator('#tree > *').count() > 0);
      await ctx.close();
    });
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
    assert.strictEqual((await must(page, '#first-hint')).height, 48);
    assert.ok(await must(page, '#hint-own'));
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
    for (const [width, height] of [[320, 568], [390, 664], [390, 844], [844, 390], [568, 320]]) {
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
        // And nothing moves when the toast goes.
        const paste = await must(page, '#empty-paste');
        await page.evaluate("document.getElementById('status').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
        await until('the toast gone', () => page.evaluate("document.getElementById('status').classList.contains('shown')"), (v) => !v);
        assert.deepStrictEqual(await stable('the block', () => must(page, '#empty-paste')), paste);
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
      // And an editor with nothing in it.
      await page.locator('#ed-more').click();
      await page.locator('#more-clear').click();
      await until('the empty editor', () => box(page, '#empty-editor'), (b) => b !== null);
      await until('no box', () => panel().locator('#line').isVisible(), (v) => !v);
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
