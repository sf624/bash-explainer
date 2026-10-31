// The web page: a pasted (or dropped) script decides the file kind (src/hosts/detect.ts), run in headless Chromium
// (test/support/site.ts). Skipped when no browser can start, unless $BASH_EXPLAINER_BROWSER is set (as in CI).
import * as assert from 'assert';
import type { Browser, BrowserContext, Page } from 'playwright-core';
import { kindChosen, openSite, pickKind, toastText, until } from './support/site';

const DOCKERFILE = 'FROM alpine:3.20\nRUN apk add --no-cache curl\nCMD ["sh"]\n';
const MAKEFILE = 'all: build\n\nbuild:\n\tgo build ./...\n';

/** Pastes `text` into the editor as the context menu does: a paste event with the text in its DataTransfer. */
async function paste(page: Page, text: string): Promise<void> {
  // A string, run in the page (the tests are compiled without the DOM's types).
  await page.evaluate(`(() => {
    const data = new DataTransfer();
    data.setData('text/plain', ${JSON.stringify(text)});
    document.querySelector('.cm-content').dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  })()`);
}

/** Drops `text` on the start of the editor's first line. */
async function drop(page: Page, text: string): Promise<void> {
  await page.evaluate(`(() => {
    const line = document.querySelector('.cm-line');
    const r = line.getBoundingClientRect();
    const data = new DataTransfer();
    data.setData('text/plain', ${JSON.stringify(text)});
    line.dispatchEvent(new DragEvent('drop', { dataTransfer: data, clientX: r.left + 1, clientY: r.top + r.height / 2, bubbles: true, cancelable: true }));
  })()`);
}

describe('the web page: the file kind of a pasted script', function () {
  this.timeout(120000);
  let browser: Browser;
  let base = '';

  before(async function () {
    ({ browser, base } = await openSite(this));
  });

  async function open(width = 1280, init?: string): Promise<{ ctx: BrowserContext; page: Page; errors: string[] }> {
    const ctx = await browser.newContext({ viewport: { width, height: 800 }, locale: 'en-US' });
    if (init) await ctx.addInitScript(init);
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base);
    await page.locator('.cm-line').nth(5).waitFor();
    return { ctx, page, errors };
  }
  const text = (page: Page) => page.evaluate('document.querySelector(".cm-content").innerText') as Promise<string>;
  const kindOf = (page: Page) => kindChosen(page);

  it('switches the kind when a Dockerfile replaces the sample, keeps the text, says so in a polite toast, and Undo goes back', async () => {
    const { ctx, page, errors } = await open();
    const toast = page.locator('#status');
    assert.strictEqual(await toast.getAttribute('role'), null);
    assert.strictEqual(await toast.locator('.toast-text').getAttribute('role'), 'status'); // announced politely, the text only (not the buttons)
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    await paste(page, DOCKERFILE);
    await until('the kind', () => kindOf(page), (k) => k === 'dockerfile');
    assert.strictEqual((await text(page)).trim(), DOCKERFILE.trim());
    assert.strictEqual(await toastText(page), 'Detected: Dockerfile');
    assert.strictEqual(await toast.locator('.status-action').innerText(), 'Undo');
    assert.strictEqual(await page.locator('#kind-dialog[open]').count(), 0);
    // Undo: the kind goes back, the text stays.
    await page.locator('.status-action').click();
    await until('the kind back', () => kindOf(page), (k) => k === 'shell');
    assert.strictEqual((await text(page)).trim(), DOCKERFILE.trim());
    assert.strictEqual(await toast.innerText(), '');
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  });

  it('Enter on the Undo of the detected kind goes back, and the focus is in the editor', async () => {
    const { ctx, page, errors } = await open();
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    await paste(page, DOCKERFILE);
    await until('the kind', () => kindOf(page), (k) => k === 'dockerfile');
    await until('the toast', () => toastText(page), (t) => t === 'Detected: Dockerfile');
    // F6 to the explanation, F6 to the toast: where a keyboard user goes.
    await page.keyboard.press('F6');
    await until('the explanation', () => page.evaluate('document.activeElement?.id'), (id) => id === 'panel');
    await page.waitForTimeout(300);
    await page.keyboard.press('F6');
    await until('the Undo', () => page.evaluate('document.activeElement?.id'), (id) => id === 'status-action');
    await page.keyboard.press('Enter');
    await until('the kind back', () => kindOf(page), (k) => k === 'shell');
    assert.strictEqual(await page.evaluate("document.activeElement?.classList.contains('cm-content')"), true, 'the focus in the editor');
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  });

  it('works with the keyboard paste (Ctrl+V) and with a drop of text, and leaves the kind when nothing is clear', async () => {
    const { ctx, page } = await open();
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
    await page.evaluate(`navigator.clipboard.writeText(${JSON.stringify(MAKEFILE)})`);
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Control+V');
    await until('the kind', () => kindOf(page), (k) => k === 'makefile');
    // (innerText doubles an empty line's line break.)
    assert.strictEqual((await text(page)).replace(/\n+/g, '\n').trim(), MAKEFILE.replace(/\n+/g, '\n').trim());
    // A drop of a whole script: a Dockerfile now.
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Delete');
    await drop(page, DOCKERFILE);
    await until('the kind', () => kindOf(page), (k) => k === 'dockerfile');
    // A script that says nothing clear keeps the kind.
    await page.keyboard.press('Control+A');
    await paste(page, 'echo hello\nls -l\n');
    await until('the paste', () => text(page), (t) => t.trim() === 'echo hello\nls -l');
    assert.strictEqual(await kindOf(page), 'dockerfile');
    await ctx.close();
  });

  it('never changes the kind for a few lines pasted into the user\'s own script, but does on the next whole paste, after a choice by hand', async () => {
    const { ctx, page } = await open();
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText('#!/bin/bash\nset -eu\nfor f in *.txt; do\n  wc -l "$f"\ndone\necho done\n');
    await page.keyboard.press('Control+End');
    await paste(page, 'FROM alpine\nRUN ls\n');
    await until('the paste', () => text(page), (t) => t.includes('RUN ls'));
    // Let a deferred change of kind happen, if there were one.
    await page.waitForTimeout(300);
    assert.strictEqual(await kindOf(page), 'shell');
    assert.strictEqual(await page.locator('#status').innerText(), '');
    // The kind chosen by hand (the user keeps their script), then a whole paste: detected again.
    await pickKind(page, 'yaml');
    await page.locator('#kind-keep').click();
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    await paste(page, MAKEFILE);
    await until('the kind', () => kindOf(page), (k) => k === 'makefile');
    await ctx.close();
  });

  it('switches from an empty editor, and from the sample when the paste goes into it, and works without storage', async () => {
    const refuse = `(() => {
      const refuse = () => { throw new DOMException('refused', 'SecurityError'); };
      Storage.prototype.getItem = refuse;
      Storage.prototype.setItem = refuse;
      Storage.prototype.removeItem = refuse;
    })()`;
    const { ctx, page, errors } = await open(1280, refuse);
    // Into the untouched sample, without selecting it: the sample was not the user's.
    await page.locator('.cm-line').nth(3).click();
    await paste(page, MAKEFILE);
    await until('the kind', () => kindOf(page), (k) => k === 'makefile');
    // Into nothing.
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Delete');
    await paste(page, '#!/usr/bin/env bats\n@test "x" {\n  run true\n}\n');
    await until('the kind', () => kindOf(page), (k) => k === 'bats');
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  });

  it('keeps the toast on a phone and on a desktop in the window (screenshots in $BASH_EXPLAINER_SHOTS)', async () => {
    for (const width of [390, 1280]) {
      const { ctx, page } = await open(width);
      await page.locator('.cm-content').click();
      await page.keyboard.press('Control+A');
      await paste(page, DOCKERFILE);
      const toast = page.locator('#status');
      await until('the toast', () => toastText(page), (t) => t.startsWith('Detected: Dockerfile'));
      const box = (await toast.boundingBox())!;
      assert.ok(box.x >= 0 && box.x + box.width <= width && box.y + box.height <= 800, JSON.stringify(box));
      const button = (await page.locator('.status-action').boundingBox())!;
      assert.ok(button.height >= 24, JSON.stringify(button));
      const dir = process.env.BASH_EXPLAINER_SHOTS;
      // After the toast's fade-in.
      if (dir) await page.waitForTimeout(600);
      if (dir) await page.screenshot({ path: `${dir}/pastekind-${width}.png` });
      await ctx.close();
    }
  });
});
