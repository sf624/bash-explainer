// The web page: what a new script resets (docs/design/usability-9.md, 2.6, 2.9 and Q8), and the depths' names on the view
// control (Q1, 2.10), run in headless Chromium (test/support/site.ts). Clear, a whole script pasted into an empty or untouched
// editor, and Open start a new script: its kind from the text (or the file), "untitled" (or the file's name), the shell back to
// Auto, with a toast whose Undo puts it all back. The depth stays. Skipped when no browser can start, unless
// $BASH_EXPLAINER_BROWSER is set (as in CI). Screenshots in $BASH_EXPLAINER_SHOTS.
import * as assert from 'assert';
import * as path from 'path';
import type { Browser, BrowserContext, Frame, Page } from 'playwright-core';
import { contrast, parseColour, type RGB } from '../src/ui/colour';
import { chooseDepth, currentShell, kindChosen, menuItem, openSite, pickKind, setShell, toastText, until } from './support/site';

const BATS = '#!/usr/bin/env bats\n@test "x" {\n  run true\n}\n';
/** A script with no shebang, as the usability test's logins.sh: nothing in it says another kind. */
const LOGINS = 'grep -c "$USER" /var/log/auth.log\nwho | wc -l\n';

/** Pastes `text` into the editor as the context menu does: a paste event with the text in its DataTransfer. */
async function paste(page: Page, text: string): Promise<void> {
  await page.evaluate(`(() => {
    const data = new DataTransfer();
    data.setData('text/plain', ${JSON.stringify(text)});
    document.querySelector('.cm-content').dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  })()`);
}

describe('the web page: what a new script resets, and the depths\' names', function () {
  this.timeout(240000);
  let browser: Browser;
  let base = '';

  before(async function () {
    ({ browser, base } = await openSite(this));
  });

  async function open(opts: { width?: number; lang?: 'en' | 'ja'; dark?: boolean } = {}): Promise<{ ctx: BrowserContext; page: Page; errors: string[] }> {
    const { width = 1280, lang = 'en', dark = false } = opts;
    const ctx = await browser.newContext({ viewport: { width, height: 800 }, locale: lang === 'ja' ? 'ja-JP' : 'en-US', colorScheme: dark ? 'dark' : 'light' });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base);
    await page.locator('.cm-line').nth(5).waitFor();
    return { ctx, page, errors };
  }
  const text = (page: Page) => page.evaluate('document.querySelector(".cm-content").innerText') as Promise<string>;
  const shownName = (page: Page) => page.evaluate("document.getElementById('file-name-stem').textContent + document.getElementById('file-name-ext').textContent") as Promise<string>;
  const panelOf = (page: Page): Frame => page.frames().find((f) => f.url().endsWith('/panel.html'))!;
  const depthOf = (page: Page) => panelOf(page).evaluate('document.body.dataset.depth') as Promise<string>;
  /** The kind, the name and the shell the page has: what a new script resets. */
  const state = async (page: Page) => [await kindChosen(page), await shownName(page), await currentShell(page)];

  /** Opens a file as the Open button does, with no picker of the browser (test/web-toast.test.ts). */
  async function openFile(page: Page, name: string, body: string): Promise<void> {
    await page.evaluate('delete window.showOpenFilePicker');
    const button = page.locator('#open-btn');
    await button.waitFor({ state: 'visible' });
    const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 10000 }), button.click()]);
    await chooser.setFiles({ name, mimeType: 'text/x-sh', buffer: Buffer.from(body) });
  }

  it('Clear starts a new script: a shell script, untitled, the shell back to Auto, the depth kept; Undo puts it all back', async () => {
    for (const lang of ['en', 'ja'] as const) {
      const { ctx, page, errors } = await open({ lang });
      await setShell(page, 'sh');
      await pickKind(page, 'bats');
      await until('the bats sample', () => text(page), (t) => t.includes('@test'));
      await chooseDepth(page, 2);
      await until('depth 2', () => depthOf(page), (d) => d === '2');
      const sample = await text(page);
      assert.deepStrictEqual(await state(page), ['bats', 'untitled.bats', 'sh'], lang);
      await menuItem(page, '#menu-clear');
      await until('empty', () => text(page), (t) => !t.trim());
      assert.deepStrictEqual(await state(page), ['shell', 'untitled.sh', 'auto'], lang);
      assert.strictEqual(await toastText(page), lang === 'en'
        ? 'Sample cleared. File type set to Shell script. Shell set back to Auto.'
        : 'サンプルを消去しました。ファイルの種類を シェルスクリプト にしました。シェルを自動に戻しました。');
      // The depth is a view's preference: it stays.
      assert.strictEqual(await depthOf(page), '2');
      // Only the words are the live region; the Undo is a button beside it.
      assert.strictEqual(await page.locator('#status [role="status"] button').count(), 0);
      await page.locator('#status .status-action').click();
      await until('the sample back', () => text(page), (t) => t === sample);
      assert.deepStrictEqual(await state(page), ['bats', 'untitled.bats', 'sh'], lang);
      assert.strictEqual(await page.evaluate("document.activeElement?.classList.contains('cm-content')"), true, `${lang}: the focus in the editor`);
      assert.deepStrictEqual(errors, []);
      await ctx.close();
    }
  });

  it('Clear twice, then Undo: the second has nothing to reset, and the first\'s Undo still brings everything back, from the keyboard', async () => {
    const { ctx, page, errors } = await open();
    await setShell(page, 'dash');
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText('echo mine\n');
    await menuItem(page, '#menu-clear');
    await until('the toast', () => toastText(page), (t) => t === 'Editor cleared. Shell set back to Auto.');
    await menuItem(page, '#menu-clear');
    assert.strictEqual(await toastText(page), 'Editor cleared. Shell set back to Auto.');
    // F6 to the explanation, F6 to the toast's Undo, Enter.
    await page.locator('.cm-content').focus();
    await page.keyboard.press('F6');
    await until('the explanation', () => page.evaluate('document.activeElement?.id'), (id) => id === 'panel');
    await page.waitForTimeout(300);
    await page.keyboard.press('F6');
    await until('the Undo', () => page.evaluate('document.activeElement?.id'), (id) => id === 'status-action');
    await page.keyboard.press('Enter');
    await until('the text back', () => text(page), (t) => t.trim() === 'echo mine');
    assert.strictEqual(await currentShell(page), 'dash');
    assert.strictEqual(await page.evaluate("document.activeElement?.classList.contains('cm-content')"), true, 'the focus in the editor, not on <body>');
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  });

  it('a script pasted into an editor emptied by hand is a new script: the opened test.bats gives way to untitled.sh, and Undo brings it back', async () => {
    const { ctx, page, errors } = await open();
    await setShell(page, 'sh');
    // Open puts the shell back to Auto too, and its Undo chooses it again (the file stays).
    await openFile(page, 'test.bats', BATS);
    await until('the file', () => shownName(page), (n) => n === 'test.bats');
    assert.strictEqual(await toastText(page), 'Opened test.bats. Shell set back to Auto.');
    assert.deepStrictEqual(await state(page), ['bats', 'test.bats', 'auto']);
    await page.locator('#status .status-action').click();
    await until('sh again', () => currentShell(page), (s) => s === 'sh');
    assert.deepStrictEqual(await state(page), ['bats', 'test.bats', 'sh']);
    // Emptied by hand, then a script with no shebang pasted: before, it stayed test.bats, a bats file.
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Delete');
    await paste(page, LOGINS);
    await until('a shell script', () => kindChosen(page), (k) => k === 'shell');
    assert.deepStrictEqual(await state(page), ['shell', 'untitled.sh', 'auto']);
    assert.strictEqual(await toastText(page), 'File type set to Shell script. Shell set back to Auto.');
    assert.strictEqual((await text(page)).trim(), LOGINS.trim());
    await page.locator('#status .status-action').click();
    await until('the file back', () => shownName(page), (n) => n === 'test.bats');
    assert.deepStrictEqual(await state(page), ['bats', 'test.bats', 'sh']);
    // (The text stays as pasted.)
    assert.strictEqual((await text(page)).trim(), LOGINS.trim());
    // A few lines pasted into the user's own script reset nothing.
    await page.keyboard.press('Control+End');
    await paste(page, BATS);
    await page.waitForTimeout(300);
    assert.deepStrictEqual(await state(page), ['bats', 'test.bats', 'sh']);
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  });

  it('a script pasted over the sample brings its kind, says it with the shell put back, and the sample\'s own kind gives way to a plain script', async () => {
    const { ctx, page } = await open();
    await setShell(page, 'sh');
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    await paste(page, BATS);
    await until('bats', () => kindChosen(page), (k) => k === 'bats');
    assert.strictEqual(await toastText(page), 'Detected: bats. Shell set back to Auto.');
    assert.strictEqual(await currentShell(page), 'auto');
    await ctx.close();
    // The bats sample, then a script that says nothing: a shell script again (before, it stayed bats).
    const other = await open();
    await pickKind(other.page, 'bats');
    await until('the bats sample', () => text(other.page), (t) => t.includes('@test'));
    await other.page.locator('.cm-content').focus();
    await other.page.keyboard.press('Control+A');
    await paste(other.page, LOGINS);
    await until('a shell script', () => kindChosen(other.page), (k) => k === 'shell');
    assert.strictEqual(await toastText(other.page), 'File type set to Shell script.');
    await other.ctx.close();
  });

  it('keys 1 and 2 typed in the editor change the text, not the depth; the control draws no digit', async () => {
    const { ctx, page } = await open();
    await until('the panel', () => Promise.resolve(panelOf(page)), (f) => !!f);
    await until('depth 1', () => depthOf(page), (d) => d === '1');
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.press('2');
    await page.keyboard.press('1');
    await page.waitForTimeout(300);
    assert.ok((await text(page)).trimEnd().endsWith('21'), 'typed into the script');
    assert.strictEqual(await depthOf(page), '1');
    assert.deepStrictEqual(await page.locator('#slot-options button').allInnerTexts(), ['Overview', 'Word by word']);
    await ctx.close();
  });

  /** The text's colour of `sel` and the colour under it, with every translucent background between (the page's own first). */
  const colours = (page: Page, sel: string) => page.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(sel)});
    const backs = [];
    for (let e = el; e; e = e.parentElement) backs.push(getComputedStyle(e).backgroundColor);
    return { fg: getComputedStyle(el).color, backs: backs.reverse() };
  })()`) as Promise<{ fg: string; backs: string[] }>;
  const measured = ({ fg, backs }: { fg: string; backs: string[] }): number => {
    let under: RGB = [255, 255, 255];
    for (const b of backs) under = parseColour(b, under) ?? under;
    return contrast(parseColour(fg, under)!, under);
  };

  for (const width of [1280, 390]) {
    it(`keeps the names readable and the toast in the window, light and dark, en and ja, ${width} px (screenshots in $BASH_EXPLAINER_SHOTS)`, async () => {
      for (const lang of ['en', 'ja'] as const) {
        for (const dark of [false, true]) {
          const seen = `${lang} ${dark ? 'dark' : 'light'} ${width}`;
          const { ctx, page } = await open({ width, lang, dark });
          if (width === 1280) {
            // Both names, with their measured contrast: the option shown and the other one.
            assert.strictEqual(await page.locator('#view-slot').getAttribute('data-form'), 'segments', seen);
            for (const id of ['#slot-depth1', '#slot-depth2']) {
              const ratio = measured(await colours(page, `${id} .vc-name`));
              assert.ok(ratio >= 4.5, `${seen} ${id}: ${ratio.toFixed(2)}`);
            }
          }
          await setShell(page, 'sh');
          await menuItem(page, '#menu-clear');
          await until('the toast', () => toastText(page), (t) => t.length > 0);
          const box = (await page.locator('#status').boundingBox())!;
          assert.ok(box.x >= 0 && box.x + box.width <= width && box.y + box.height <= 800, `${seen}: ${JSON.stringify(box)}`);
          assert.ok(await page.evaluate('document.documentElement.scrollWidth <= innerWidth'), `${seen}: no sideways scroll`);
          const dir = process.env.BASH_EXPLAINER_SHOTS;
          if (dir) {
            await page.waitForTimeout(600);
            await page.screenshot({ path: path.join(dir, `newscript-${width}-${lang}-${dark ? 'dark' : 'light'}.png`) });
          }
          await ctx.close();
        }
      }
    });
  }
});
