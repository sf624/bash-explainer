// The value of an expansion where it runs (media/panel.js `valueLine`, docs/design/expansion-values.md), on the web
// page in headless Chromium, at a desktop's and a phone's width: a line under the meaning of the expansion, with the
// value and the words of a split one as chips, and nothing past the right edge. The geometry is read from positions,
// not from how wide a font draws the words.
import * as assert from 'assert';
import type { Browser, Frame } from 'playwright-core';
import { frames, openSite, until } from './support/site';

const SCRIPT = 'msg="hello world"\nfile=report.tar.gz\necho $msg "${file%.*}"';

interface Line { text: string; chips: string[]; right: number; chipsRight: number[]; under: boolean }

/** Each value line shown: its text, its chips, where it ends, and whether it is under the meaning's first line. */
const lines = (f: Frame) => f.evaluate(`(() => ({ vw: document.documentElement.clientWidth, sw: document.documentElement.scrollWidth,
  items: [...document.querySelectorAll('.ev-value')].map((v) => {
    const text = v.parentElement.getBoundingClientRect();
    const r = v.getBoundingClientRect();
    const chips = [...v.querySelectorAll('.ev-word')];
    return { text: v.textContent, chips: chips.map((c) => c.textContent), right: r.right, chipsRight: chips.map((c) => c.getBoundingClientRect().right), under: r.top > text.top + 1 };
  }) }))()`) as Promise<{ vw: number; sw: number; items: Line[] }>;

describe('the web page: the values of expansions in Meaning', function () {
  this.timeout(120000);
  let browser: Browser;
  let base = '';
  before(async function () {
    ({ browser, base } = await openSite(this));
  });

  for (const [width, locale] of [[1280, 'en-US'], [390, 'ja-JP']] as const) {
    it(`shows the values at ${width} px (${locale})`, async () => {
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
      await page.keyboard.insertText(SCRIPT);
      await until('the line explained', async () => (await panel().locator('#line').textContent()) ?? '', (t) => t.includes('echo $msg'));
      await frames(panel());
      const got = await lines(panel());
      assert.deepStrictEqual(got.items.map((l) => l.chips), [['hello world', 'hello', 'world'], ['report.tar']]);
      assert.match(got.items[0].text, locale === 'ja-JP' ? /^スクリプトから分かるここでの値: hello world。クォートしていないので単語分割され、2 語になる: hello world$/ : /^Value here, from the script: hello world; unquoted, it is split into 2 words: hello world$/);
      assert.ok(got.sw <= got.vw, `the page is ${got.sw} wide, the view ${got.vw}`);
      for (const l of got.items) {
        assert.ok(l.under, `${l.text} is under the meaning`);
        assert.ok(l.right <= got.vw + 0.5 && l.chipsRight.every((r) => r <= got.vw + 0.5), `${l.text} ends at ${l.right}, its chips at ${l.chipsRight}`);
      }
      assert.deepStrictEqual(errors, []);
      await ctx.close();
    });
  }
});

describe('the web page: a value with a backtick, a space at an end or an invisible character', function () {
  this.timeout(120000);
  let browser: Browser;
  let base = '';
  before(async function () {
    ({ browser, base } = await openSite(this));
  });

  it('shows them as chips that read back the value (a space at an end drawn by CSS, a bidi control as <U+202E>)', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1000, height: 900 }, locale: 'en-US' });
    await ctx.addInitScript(`try { localStorage.setItem('bash-explainer-settings', JSON.stringify({ 'bashExplainer.panel.animations': false })); } catch {}`);
    const page = await ctx.newPage();
    await page.goto(base);
    const panel = () => page.frames().find((f) => f.url().endsWith('/panel.html'))!;
    await until('the panel', () => Promise.resolve(panel()), (f) => !!f);
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText("a=' a '; b='x`y'; e='a\u202eb'; f=' p q '\necho \"$a\" \"$b\" \"$e\" $f");
    await until('the line explained', async () => (await panel().locator('#line').textContent()) ?? '', (t) => t.includes('echo "$a"'));
    await frames(panel());
    const got = await lines(panel());
    assert.deepStrictEqual(got.items.map((l) => l.chips), [[' a '], ['x`y'], ['a<U+202E>b'], [' p q ', 'p', 'q']]);
    assert.match(got.items[3].text, / is a space at an end\)$/);
    // The space is a real space in an element that CSS draws, with a name, and no glyph that a font may lack is used.
    const marks = await panel().evaluate(`[...document.querySelectorAll('.ev-value .ev-sp')].map((m) => {
      const s = getComputedStyle(m);
      const r = m.getBoundingClientRect();
      return { text: m.textContent, label: m.getAttribute('aria-label'), role: m.getAttribute('role'), bottom: s.borderBottomStyle + ' ' + s.borderBottomWidth, top: s.borderTopStyle, display: s.display, w: r.width, h: r.height,
        inChip: !!m.closest('code.ev-word'), note: !m.closest('.ev-word') };
    })`) as { text: string; label: string; role: string; bottom: string; top: string; display: string; w: number; h: number; inChip: boolean; note: boolean }[];
    // a: 2 marks and the note's; f: 2 marks and the note's (the words p and q have none).
    assert.strictEqual(marks.length, 6);
    for (const m of marks) {
      assert.deepStrictEqual([m.text, m.label, m.role, m.bottom, m.top, m.display], [' ', 'space', 'img', 'solid 1px', 'none', 'inline-block']);
      assert.ok(m.w > 2 && m.h > 2, `a mark is ${m.w} x ${m.h}`);
    }
    assert.deepStrictEqual(marks.map((m) => m.inChip), [true, true, false, true, true, false]);
    assert.ok(!/[\u2420\u2423]/.test(await panel().evaluate(`document.querySelector('#line').textContent`) as string));
    // BASH_EXPLAINER_SHOT=<file.png> saves a screenshot of the page for a look.
    if (process.env.BASH_EXPLAINER_SHOT) await page.screenshot({ path: process.env.BASH_EXPLAINER_SHOT });
    await ctx.close();
  });
});
