// The words of a brace expansion in its example (media/panel.js `wordList`, `ExampleSection.words`), on the web page in
// headless Chromium, at a desktop's and a phone's width: chips with an edge in a row, in a list named by the section's
// label, so that they read as separate arguments, and what echo prints under them. The geometry is read from positions,
// not from how wide a font draws the words.
import * as assert from 'assert';
import type { Browser, Frame } from 'playwright-core';
import { frames, openSite, until } from './support/site';

interface Words { label: string; chips: string[]; items: number; role: string | null; tops: number[]; rights: number[]; border: string; display: string; after: string | null; next: string }

/** Each section of words shown: its label (through `aria-labelledby`), its chips, where they are, and what follows. */
const words = (f: Frame) => f.evaluate(`(() => ({ vw: document.documentElement.clientWidth, sw: document.documentElement.scrollWidth,
  lists: [...document.querySelectorAll('.example-words')].map((box) => {
    const ul = box.querySelector('ul');
    const chips = [...box.querySelectorAll('code.ev-word')];
    const s = getComputedStyle(chips[0]);
    const next = box.nextElementSibling;
    return { label: document.getElementById(ul.getAttribute('aria-labelledby')).textContent, chips: chips.map((c) => c.textContent),
      items: ul.querySelectorAll(':scope > li').length, role: ul.getAttribute('role'),
      tops: chips.map((c) => c.getBoundingClientRect().top), rights: chips.map((c) => c.getBoundingClientRect().right),
      border: s.borderTopStyle + ' ' + s.borderTopWidth, display: getComputedStyle(ul).display,
      after: box.querySelector('.example-words-after')?.textContent ?? null,
      next: next && next.nextElementSibling ? next.textContent + ': ' + next.nextElementSibling.textContent : '' };
  }) }))()`) as Promise<{ vw: number; sw: number; lists: Words[] }>;

describe('the web page: the words of a brace expansion in its example', function () {
  this.timeout(120000);
  let browser: Browser;
  let base = '';
  before(async function () {
    ({ browser, base } = await openSite(this));
  });

  for (const [width, locale] of [[1280, 'en-US'], [390, 'ja-JP']] as const) {
    it(`shows them as chips in a row at ${width} px (${locale})`, async () => {
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
      await page.keyboard.insertText('echo {1..100}\necho {1..10..3}');
      await until('the line explained', async () => (await panel().locator('#line').textContent()) ?? '', (t) => t.includes('echo {1..10..3}'));
      await frames(panel());
      const got = await words(panel());
      const ja = locale === 'ja-JP';
      assert.strictEqual(got.lists.length, 1);
      const [w] = got.lists;
      assert.deepStrictEqual([w.chips, w.items, w.role, w.border, w.display], [['1', '4', '7', '10'], 4, 'list', 'solid 1px', 'flex']);
      assert.strictEqual(w.label, ja ? '展開後の単語（echo が受け取る別々の引数 4 個）' : 'Resulting words (4 separate arguments of echo)');
      // In a row: the chips are side by side, on one line, and none is past the right edge.
      assert.ok(w.tops.every((t) => Math.abs(t - w.tops[0]) < 1), `the chips are at ${w.tops}`);
      assert.ok(w.rights.every((r, i) => i === 0 || r > w.rights[i - 1]), `the chips end at ${w.rights}`);
      assert.ok(got.sw <= got.vw && w.rights.every((r) => r <= got.vw + 0.5), `the page is ${got.sw} wide, the view ${got.vw}`);
      assert.strictEqual(w.after, null);
      assert.strictEqual(w.next, ja ? '出力: 1 4 7 10' : 'Output: 1 4 7 10');

      // A long expansion is cut, and says how many words there are.
      await page.keyboard.press('Control+Home');
      await until('the first line explained', async () => (await panel().locator('#line').textContent()) ?? '', (t) => t.includes('echo {1..100}'));
      await frames(panel());
      const long = (await words(panel())).lists[0];
      assert.deepStrictEqual([long.chips.length, long.items, long.after], [11, 11, ja ? '…（全 100 語）' : '… 100 words in all']);
      assert.deepStrictEqual(errors, []);
      await ctx.close();
    });
  }
});
