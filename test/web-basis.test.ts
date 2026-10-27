// The basis of a note on the web page (docs/design/basis.md, step 2), run for real in headless Chromium (the build,
// the server and the browser are shared by all test/web-*.test.ts files: test/support/site.ts): a note that rests on
// bash's behaviour rather than the manual has a quiet chip and a folded "Try it in your terminal", with the command,
// a copy button and its output; nothing is cut or overlaps, at the width of a desktop and of a phone, in both
// languages; and the setting `notes.basis` turns both off. With $BASH_EXPLAINER_SHOTS set to a directory, the notes
// are saved there as screenshots (basis-<width>-<lang>-<note>.png), to look at.
import * as assert from 'assert';
import * as path from 'path';
import type { Browser, Frame } from 'playwright-core';
import { frames, openSite, until } from './support/site';

const LINE = 'x=1; unset -fv x f; exit 300';

describe('the web page: what a note rests on', function () {
  this.timeout(120000);
  let browser: Browser;
  let base = '';

  before(async function () {
    ({ browser, base } = await openSite(this));
  });

  /** A page with the line typed in, and its panel; `settings` are kept as the page keeps them. */
  async function open(width: number, locale: string, settings: Record<string, unknown> = {}) {
    const { devices } = await import('playwright-core');
    const ctx = await browser.newContext(width < 600 ? { ...devices['iPhone 13'], viewport: { width, height: 900 }, locale } : { viewport: { width, height: 900 }, locale });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
    await ctx.addInitScript(`try { localStorage.setItem('bash-explainer-settings', ${JSON.stringify(JSON.stringify({ 'bashExplainer.panel.animations': false, ...settings }))}); } catch {}`);
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base);
    const panel = (): Frame => page.frames().find((f) => f.url().endsWith('/panel.html'))!;
    await until('the panel', () => Promise.resolve(panel()), (f) => !!f);
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText(LINE);
    await until('the line explained', async () => (await panel().locator('#line').textContent()) ?? '', (t) => t.includes('exit 300'));
    await until('the notes', () => panel().locator('#notes .note').count(), (n) => n === 2);
    return { ctx, page, panel, errors };
  }

  for (const [width, locale] of [[1280, 'en-US'], [1280, 'ja-JP'], [390, 'en-US'], [390, 'ja-JP']] as const) {
    it(`marks the notes that rest on bash's behaviour, with a try-it, at ${width} px (${locale})`, async () => {
      const ja = locale === 'ja-JP';
      const { ctx, panel, errors } = await open(width, locale);
      const chips = await panel().locator('#notes .basis').allTextContents();
      assert.deepStrictEqual(chips, Array(2).fill(ja ? 'マニュアルに記述なし・bash 5.2 で確認' : 'Not in the manual · checked with bash 5.2'));
      assert.match(await panel().locator('#notes .basis').first().getAttribute('title') ?? '', ja ? /bash 5\.2 で実行して確かめた/ : /checked by running bash 5\.2/);
      // Folded at first; a click opens it, and a click in it does not fold it again.
      const heads = panel().locator('#notes summary.tryit-head');
      assert.deepStrictEqual(await heads.allTextContents(), Array(2).fill(ja ? '端末で試す' : 'Try it in your terminal'));
      assert.strictEqual(await panel().locator('#notes details.tryit[open]').count(), 0);
      for (let i = 0; i < 2; i++) await heads.nth(i).click();
      await frames(panel());
      assert.strictEqual(await panel().locator('#notes details.tryit[open]').count(), 2);
      assert.deepStrictEqual(await panel().locator('#notes .tryit-output').allTextContents(), [
        'bash: line 1: unset: cannot simultaneously unset a function and a variable\nstatus 1, x=1\nfunction', '44']);
      assert.deepStrictEqual(await panel().locator('#notes .tryit-prints').allTextContents(), Array(2).fill(ja ? '出力' : 'Output'));
      // Nothing is cut or overlaps: the chip, the code, its button and the output stay in their note, the button is
      // beside the code, and the panel does not scroll sideways.
      const boxes = await panel().evaluate(`[...document.querySelectorAll('#notes .note')].map((n) => {
        const r = (el) => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom }; };
        return { note: r(n), chip: r(n.querySelector('.basis')), code: r(n.querySelector('.tryit-code')), copy: r(n.querySelector('.tryit-copy')), output: r(n.querySelector('.tryit-output')) };
      })`) as Record<string, { left: number; right: number; top: number; bottom: number }>[];
      for (const [i, b] of boxes.entries()) {
        for (const part of ['chip', 'code', 'copy', 'output']) {
          assert.ok(b[part].left >= b.note.left - 0.5 && b[part].right <= b.note.right + 0.5, `note ${i}: the ${part} ${JSON.stringify(b[part])} is in ${JSON.stringify(b.note)}`);
        }
        assert.ok(b.copy.left >= b.code.right - 0.5, `note ${i}: the button ${JSON.stringify(b.copy)} is right of the code ${JSON.stringify(b.code)}`);
        assert.ok(b.output.top >= b.code.bottom - 0.5, `note ${i}: the output is under the code`);
      }
      assert.ok(await panel().evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), 'the panel scrolls sideways');
      if (process.env.BASH_EXPLAINER_SHOTS) {
        // (One note at a time: a frame's screenshot holds only what its viewport shows.)
        for (let i = 0; i < 2; i++) {
          await panel().locator('#notes .note').nth(i).screenshot({ path: path.join(process.env.BASH_EXPLAINER_SHOTS, `basis-${width}-${ja ? 'ja' : 'en'}-${i + 1}.png`) });
        }
      }
      // The copy button puts the command on the clipboard, and says so.
      await panel().locator('#notes .tryit-copy').nth(1).click();
      await until('copied', () => panel().locator('#notes .tryit-copy').nth(1).textContent(), (t) => t === (ja ? 'コピーしました' : 'Copied'));
      assert.strictEqual(await panel().evaluate('navigator.clipboard.readText()'), "bash -c '(exit 300); echo $?'");
      assert.deepStrictEqual(errors, []);
      await ctx.close();
    });
  }

  it('shows no chip and no try-it with `notes.basis` off', async () => {
    const { ctx, panel } = await open(1280, 'en-US', { 'bashExplainer.notes.basis': false });
    assert.strictEqual(await panel().locator('#notes .basis, #notes .tryit').count(), 0);
    await ctx.close();
  });
});
