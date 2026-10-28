// The web page: opening a file (the menu, Ctrl+O, a drop) and saving the script (Ctrl+S, the menu), run in headless
// Chromium (test/support/site.ts). The File System Access API is taken away for the fallbacks (<input type=file>, a
// download), and stubbed for its own branch (a picker cannot be driven from a test). Skipped when no browser can start,
// unless $BASH_EXPLAINER_BROWSER is set (as in CI).
import * as assert from 'assert';
import * as fs from 'fs';
import type { Browser, BrowserContext, Page } from 'playwright-core';
import { menuItem, openSite, choose, pickKind, until } from './support/site';

const DOCKERFILE = 'FROM alpine:3.20\nRUN apk add --no-cache curl\nCMD ["sh"]\n';

/** Takes the File System Access API away: the page falls back to <input type=file> and downloads. */
const NO_PICKERS = `for (const o of [window, Window.prototype]) { delete o.showOpenFilePicker; delete o.showSaveFilePicker; }`;

/**
 * Stands in for the File System Access API: the pickers return handles that keep what is written to them
 * (`window.__written`, by name), and count their calls (`window.__picks`). `window.__nextOpen` is the file the open picker
 * gives; `window.__refuseWrite` makes a write fail as a refused permission does.
 */
const PICKERS = `(() => {
  window.__written = {};
  window.__picks = [];
  const handle = (name, file) => ({
    kind: 'file', name,
    getFile: async () => file,
    createWritable: async () => {
      if (window.__refuseWrite) throw new DOMException('refused', 'NotAllowedError');
      const parts = [];
      return { write: async (b) => parts.push(new Uint8Array(b)), close: async () => { window.__written[name] = [...parts.flatMap((p) => [...p])]; } };
    },
  });
  window.showSaveFilePicker = async (o) => { window.__picks.push(['save', o && o.suggestedName]); return handle(window.__saveAs || o.suggestedName); };
  window.showOpenFilePicker = async () => {
    window.__picks.push(['open']);
    const f = window.__nextOpen;
    if (!f) throw new DOMException('cancelled', 'AbortError');
    return [handle(f.name, f)];
  };
})()`;

/** Pretends to be a Mac, where the shortcuts are ⌘S and ⌘O. */
const MAC = `Object.defineProperty(Navigator.prototype, 'platform', { get: () => 'MacIntel' });`;

describe('the web page: opening a file and saving the script', function () {
  this.timeout(120000);
  let browser: Browser;
  let base = '';

  before(async function () {
    ({ browser, base } = await openSite(this));
  });

  async function open(init: string[] = [], width = 1280, locale = 'en-US'): Promise<{ ctx: BrowserContext; page: Page; errors: string[] }> {
    const ctx = await browser.newContext({ viewport: { width, height: 800 }, locale, acceptDownloads: true });
    for (const s of init) await ctx.addInitScript(s);
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    // Playwright takes the file choosers only while a listener waits for them, and starts doing so a moment after the
    // listener is added: a chooser opened in that moment (a key pressed at once, on a loaded machine) is lost. One
    // listener from the start keeps them taken.
    page.on('filechooser', () => undefined);
    await page.goto(base);
    await page.locator('.cm-line').nth(5).waitFor();
    return { ctx, page, errors };
  }
  /** Replaces the editor's text by typing it. */
  async function type(page: Page, text: string, mod = 'Control'): Promise<void> {
    await page.locator('.cm-content').click();
    await page.keyboard.press(`${mod}+A`);
    await page.keyboard.press('Delete');
    await page.keyboard.insertText(text);
  }
  /** Saves with the keys and returns the download's name and bytes. */
  async function download(page: Page, keys = 'Control+S'): Promise<{ name: string; bytes: Buffer }> {
    const [d] = await Promise.all([page.waitForEvent('download'), page.keyboard.press(keys)]);
    return { name: d.suggestedFilename(), bytes: fs.readFileSync((await d.path())!) };
  }
  /** Drops a file (its name and bytes) on the editor, after dragging it over (the drop target shows). */
  async function drop(page: Page, name: string, bytes: number[]): Promise<boolean> {
    return page.evaluate(`(() => {
      const target = document.querySelector('.cm-line');
      const r = target.getBoundingClientRect();
      const data = new DataTransfer();
      data.items.add(new File([new Uint8Array(${JSON.stringify(bytes)})], ${JSON.stringify(name)}));
      const at = { dataTransfer: data, clientX: r.left + 5, clientY: r.top + 5, bubbles: true, cancelable: true };
      target.dispatchEvent(new DragEvent('dragenter', at));
      target.dispatchEvent(new DragEvent('dragover', at));
      const shown = !document.getElementById('drop-target').hidden;
      target.dispatchEvent(new DragEvent('drop', at));
      return shown && document.getElementById('drop-target').hidden;
    })()`) as Promise<boolean>;
  }
  const kindOf = (page: Page) => page.locator('#kind').getAttribute('aria-label');
  const text = (page: Page) => page.evaluate('document.querySelector(".cm-content").innerText') as Promise<string>;
  const toast = (page: Page) => page.locator('#status').evaluate((el) => el.firstChild?.textContent ?? '');
  const bytesOf = (s: string) => [...Buffer.from(s, 'utf8')];

  it('saves with Ctrl+S as a download where the browser cannot write files: the exact text, named after the kind, and the browser does not save the page', async () => {
    const { ctx, page, errors } = await open([NO_PICKERS]);
    assert.strictEqual(await page.evaluate('typeof window.showSaveFilePicker'), 'undefined');
    // No newline at the end, and none added; non-ASCII text as UTF-8.
    const script = '#!/bin/bash\necho "héllo, 世界"\nexit 0';
    await type(page, script);
    // Seen after the page's own handler: the key was taken from the browser.
    await page.evaluate("window.__prevented = []; window.addEventListener('keydown', (e) => { if (e.key.toLowerCase() === 's') window.__prevented.push(e.defaultPrevented); })");
    const saved = await download(page);
    assert.deepStrictEqual(await page.evaluate('window.__prevented'), [true]);
    assert.strictEqual(saved.name, 'script.sh');
    assert.deepStrictEqual([...saved.bytes], bytesOf(script));
    assert.match(await toast(page), /^Downloaded script\.sh\. This browser cannot write to a file itself/);
    // The name now shows in the top bar and the title, with no mark: it is saved.
    assert.strictEqual(await page.locator('#file-label').innerText(), 'script.sh');
    assert.strictEqual(await page.title(), 'script.sh — Bash Explainer');
    // An edit marks it, in words for a screen reader too. (At the end, said so: once, in a full run under load, the
    // letter went to the start of the text. What moved the cursor was not found, in 70 runs under load; this test is
    // about the save.)
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText('x');
    await until('the mark', () => page.title(), (t) => t === '● script.sh — Bash Explainer');
    assert.strictEqual(await page.locator('#file-label').textContent(), 'script.sh ● (unsaved changes)');
    assert.strictEqual(await page.locator('#file-label').getAttribute('title'), 'script.sh (unsaved changes)');
    const again = await download(page);
    assert.deepStrictEqual([...again.bytes], bytesOf(`${script}x`));
    await until('no mark', () => page.title(), (t) => t === 'script.sh — Bash Explainer');
    // The name follows the kind for a script that came from no file: a Dockerfile.
    const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-US', acceptDownloads: true });
    await ctx2.addInitScript(NO_PICKERS);
    const page2 = await ctx2.newPage();
    await page2.goto(base);
    await page2.locator('.cm-line').nth(5).waitFor();
    await pickKind(page2, 'dockerfile');
    await until('the Dockerfile sample', () => text(page2), (t) => /^FROM /m.test(t));
    const docker = await download(page2);
    assert.strictEqual(docker.name, 'Dockerfile');
    // The menu's Save does the same, and says where the script goes.
    await page2.locator('#menu-open').click();
    assert.strictEqual(await page2.locator('#menu-save-name').innerText(), 'Dockerfile');
    assert.strictEqual(await page2.locator('#menu-save-key').innerText(), 'Ctrl+S');
    assert.strictEqual(await page2.locator('#menu-open-key').innerText(), 'Ctrl+O');
    assert.match((await page2.locator('#menu-save').getAttribute('title'))!, /Nothing is uploaded/);
    assert.match((await page2.locator('#menu-open-file').getAttribute('title'))!, /uploaded nowhere/);
    const [viaMenu] = await Promise.all([page2.waitForEvent('download'), page2.locator('#menu-save').click()]);
    assert.strictEqual(viaMenu.suggestedFilename(), 'Dockerfile');
    assert.strictEqual(await page2.locator('#drawer').evaluate((d) => (d as unknown as { open: boolean }).open), false);
    assert.deepStrictEqual(errors, []);
    await ctx2.close();
    await ctx.close();
  });

  it('uses ⌘S and ⌘O on a Mac (Ctrl+S is left alone there), and Ctrl+S also with the focus in the explanation panel', async () => {
    const { ctx, page } = await open([NO_PICKERS, MAC]);
    await type(page, 'echo mac\n', 'Meta');
    const saved = await download(page, 'Meta+S');
    assert.deepStrictEqual([...saved.bytes], bytesOf('echo mac\n'));
    let downloads = 0;
    page.on('download', () => downloads++);
    await page.keyboard.press('Control+S');
    await page.waitForTimeout(300);
    assert.strictEqual(downloads, 0);
    await page.locator('#menu-open').click();
    assert.strictEqual(await page.locator('#menu-save-key').innerText(), '⌘S');
    assert.strictEqual(await page.locator('#menu-open-key').innerText(), '⌘O');
    await page.keyboard.press('Escape');
    // ⌘O opens the file input.
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Meta+O')]);
    await chooser.setFiles({ name: 'tool.sh', mimeType: 'text/plain', buffer: Buffer.from('echo tool\n') });
    await until('the file', () => text(page), (t) => t.trim() === 'echo tool');
    await ctx.close();
    // Not a Mac: Ctrl+S, also from inside the panel's frame.
    const other = await open([NO_PICKERS]);
    const panel = other.page.frames().find((f) => f.url().endsWith('/panel.html'))!;
    await until('the panel', () => panel.locator('.row .label').count(), (n) => n > 0);
    await panel.evaluate('document.body.tabIndex = -1; document.body.focus()');
    assert.strictEqual(await other.page.evaluate('document.activeElement.id'), 'panel');
    const fromPanel = await download(other.page);
    assert.strictEqual(fromPanel.name, 'script.sh');
    await other.ctx.close();
  });

  it('opens a file with the menu or Ctrl+O through <input type=file>, sets the kind from its name, replaces the text, and undo does not bring the old text back', async () => {
    const { ctx, page, errors } = await open([NO_PICKERS]);
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), menuItem(page, '#menu-open-file')]);
    assert.strictEqual(chooser.isMultiple(), false);
    await chooser.setFiles({ name: 'Dockerfile', mimeType: 'application/octet-stream', buffer: Buffer.from(DOCKERFILE) });
    await until('the kind', () => kindOf(page), (k) => k === 'File: Dockerfile');
    assert.strictEqual((await text(page)).trim(), DOCKERFILE.trim());
    assert.strictEqual(await toast(page), 'Opened Dockerfile.');
    assert.strictEqual(await page.locator('#file-label').innerText(), 'Dockerfile');
    assert.strictEqual(await page.title(), 'Dockerfile — Bash Explainer');
    // The sample was not the user's text: no question. Undo does not go back to it.
    assert.strictEqual(await page.locator('#discard-dialog[open]').count(), 0);
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+Z');
    await page.waitForTimeout(200);
    assert.strictEqual((await text(page)).trim(), DOCKERFILE.trim());
    // Ctrl+O: a Makefile by its name (its content alone says nothing clear), then by content: a .txt with a bats shebang.
    for (const [name, content, kind] of [['build.mk', 'x = 1\n', 'File: Makefile'], ['notes.txt', '#!/usr/bin/env bats\n@test "a" {\n  true\n}\n', 'File: bats'], ['run', 'echo plain\n', 'File: Shell script'], ['ci.yaml', 'jobs:\n', 'File: GitHub Actions / GitLab CI']]) {
      const [c] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Control+O')]);
      await c.setFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(content) });
      await until(`the kind of ${name}`, () => kindOf(page), (k) => k === kind);
      await until(`the text of ${name}`, () => text(page), (t) => t.includes(content.split('\n')[0]));
    }
    // Saving now names the file opened.
    const saved = await download(page);
    assert.strictEqual(saved.name, 'ci.yaml');
    // An empty file is the user's too: choosing another kind asks before the sample takes its place.
    const [e] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Control+O')]);
    await e.setFiles({ name: 'new.sh', mimeType: 'text/plain', buffer: Buffer.alloc(0) });
    await until('the empty file', () => page.title(), (t) => t === 'new.sh — Bash Explainer');
    await pickKind(page, 'makefile');
    await until('the question', () => page.locator('#kind-dialog').isVisible(), (v) => v);
    await page.locator('#kind-keep').click();
    assert.strictEqual((await text(page)).trim(), '');
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  });

  it('opens a file dropped on the editor, showing a drop target while it is dragged over, and leaves text drops to the editor', async () => {
    const { ctx, page } = await open([NO_PICKERS]);
    assert.strictEqual(await page.locator('#drop-target').isVisible(), false);
    // While a file is over the editor, the target shows what a drop does.
    await page.evaluate(`(() => {
      const t = document.querySelector('.cm-line');
      const data = new DataTransfer();
      data.items.add(new File(['x'], 'x.sh'));
      t.dispatchEvent(new DragEvent('dragover', { dataTransfer: data, bubbles: true, cancelable: true }));
    })()`);
    assert.strictEqual(await page.locator('#drop-target').isVisible(), true);
    assert.strictEqual(await page.locator('#drop-title').innerText(), 'Drop a file to open it');
    assert.strictEqual(await page.locator('#drop-note').innerText(), 'It is read in this browser and uploaded nowhere.');
    // It goes when the drag leaves (no more dragover).
    await until('the target gone', () => page.locator('#drop-target').isVisible(), (v) => !v);
    // ...or at once when it leaves the editor for the rest of the page.
    await page.evaluate(`(() => {
      const t = document.querySelector('.cm-line');
      const data = new DataTransfer();
      data.items.add(new File(['x'], 'x.sh'));
      t.dispatchEvent(new DragEvent('dragover', { dataTransfer: data, bubbles: true, cancelable: true }));
      t.dispatchEvent(new DragEvent('dragleave', { dataTransfer: data, bubbles: true, relatedTarget: document.querySelector('.top') }));
    })()`);
    assert.strictEqual(await page.locator('#drop-target').isVisible(), false);
    assert.strictEqual(await drop(page, 'Makefile', bytesOf('all:\n\techo hi\n')), true);
    await until('the kind', () => kindOf(page), (k) => k === 'File: Makefile');
    assert.match(await text(page), /^all:\n\techo hi/);
    assert.strictEqual(await page.locator('#file-label').innerText(), 'Makefile');
    // A file dropped elsewhere on the page is not shown by the browser in the page's place.
    const prevented = await page.evaluate(`(() => {
      const data = new DataTransfer();
      data.items.add(new File(['x'], 'x.sh'));
      const e = new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true });
      document.querySelector('.top').dispatchEvent(e);
      return e.defaultPrevented;
    })()`);
    assert.strictEqual(prevented, true);
    // Text dragged in (no file) is the editor's, as before: it goes where it is dropped, with no drop target.
    const textDrop = await page.evaluate(`(() => {
      const line = document.querySelector('.cm-line');
      const r = line.getBoundingClientRect();
      const data = new DataTransfer();
      data.setData('text/plain', '# dropped ');
      const at = { dataTransfer: data, clientX: r.left + 1, clientY: r.top + r.height / 2, bubbles: true, cancelable: true };
      line.dispatchEvent(new DragEvent('dragover', at));
      const shown = !document.getElementById('drop-target').hidden;
      line.dispatchEvent(new DragEvent('drop', at));
      return shown;
    })()`);
    assert.strictEqual(textDrop, false);
    await until('the text dropped', () => text(page), (t) => t.startsWith('# dropped all:'));
    assert.strictEqual(await page.locator('#file-label').innerText(), 'Makefile');
    await ctx.close();
  });

  it('asks before a file replaces changes not saved: Cancel (the focus first) and Esc keep them, Discard opens the file', async () => {
    const { ctx, page } = await open([NO_PICKERS]);
    await type(page, 'echo mine\n');
    const dialog = page.locator('#discard-dialog');
    const offer = async () => {
      const [c] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Control+O')]);
      await c.setFiles({ name: 'other.sh', mimeType: 'text/plain', buffer: Buffer.from('echo other\n') });
      await until('the question', () => dialog.isVisible(), (v) => v, 20000);
    };
    await offer();
    assert.strictEqual(await dialog.getAttribute('role'), 'alertdialog');
    assert.strictEqual(await page.locator('#discard-dialog-title').innerText(), 'Discard unsaved changes?');
    assert.strictEqual(await page.locator('#discard-dialog-message').innerText(), 'Opening other.sh replaces the script in the editor, and its changes are not saved. To keep them, cancel and save first (Ctrl+S).');
    assert.strictEqual(await page.evaluate('document.activeElement.id'), 'discard-cancel');
    // Ctrl+S does not save under the question.
    let downloads = 0;
    page.on('download', () => downloads++);
    await page.keyboard.press('Control+S');
    await page.keyboard.press('Escape');
    await until('closed', () => dialog.isVisible(), (v) => !v);
    assert.strictEqual(downloads, 0);
    assert.strictEqual((await text(page)).trim(), 'echo mine');
    // The focus is back in the editor.
    assert.strictEqual(await page.evaluate('!!document.activeElement.closest(".cm-content")'), true);
    await offer();
    await page.locator('#discard-cancel').click();
    assert.strictEqual((await text(page)).trim(), 'echo mine');
    await offer();
    await page.locator('#discard-open').click();
    await until('the file', () => text(page), (t) => t.trim() === 'echo other');
    // Just opened: nothing to lose, so the next file opens with no question; an edit, then an undo back, neither.
    await page.locator('.cm-content').click();
    await page.keyboard.insertText('x');
    await until('the mark', () => page.title(), (t) => t === '● other.sh — Bash Explainer');
    await page.keyboard.press('Control+Z');
    await until('no mark', () => page.title(), (t) => t === 'other.sh — Bash Explainer');
    const [c] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Control+O')]);
    await c.setFiles({ name: 'third.sh', mimeType: 'text/plain', buffer: Buffer.from('echo third\n') });
    await until('the file', () => text(page), (t) => t.trim() === 'echo third');
    assert.strictEqual(await dialog.isVisible(), false);
    // A sample is not the user's text either (the page as it opens): no question.
    await ctx.close();
    const fresh = await open([NO_PICKERS]);
    assert.strictEqual(await drop(fresh.page, 'a.sh', bytesOf('echo a\n')), true);
    await until('the file', () => text(fresh.page), (t) => t.trim() === 'echo a');
    assert.strictEqual(await fresh.page.locator('#discard-dialog').count(), 0);
    await fresh.ctx.close();
  });

  it('on a touch screen, the question says to save from the menu, as there is no keyboard for the shortcut', async () => {
    const { devices } = await import('playwright-core');
    const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'en-US' });
    await ctx.addInitScript(NO_PICKERS);
    const page = await ctx.newPage();
    await page.goto(base);
    await page.locator('.cm-line').nth(5).waitFor();
    await page.locator('#readtip-close').tap();
    await page.locator('.cm-line').first().tap();
    await page.keyboard.insertText('# mine\n');
    assert.strictEqual(await drop(page, 'other.sh', bytesOf('echo other\n')), true);
    await until('the question', () => page.locator('#discard-dialog').isVisible(), (v) => v);
    assert.match(await page.locator('#discard-dialog-message').innerText(), /save first \(Menu, then Save\)\.$/);
    // The shortcuts are not shown in the menu either.
    await page.locator('#discard-cancel').tap();
    await page.locator('#menu-open').tap();
    assert.strictEqual(await page.locator('#menu-save').isVisible(), true);
    assert.strictEqual(await page.locator('#menu-save-key').isVisible(), false);
    await ctx.close();
  });

  it('refuses a file larger than 1 MiB, not UTF-8 text, or with a CR that ends no line, and keeps the text', async () => {
    const { ctx, page } = await open([NO_PICKERS]);
    await type(page, 'echo keep\n');
    for (const [name, bytes, message] of [
      ['big.sh', Buffer.alloc(1024 * 1024 + 1, 0x61), 'big.sh was not opened: it is larger than 1 MiB, too large to explain again after every change.'],
      ['a.out', Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x00, 0x00]), 'a.out was not opened: it is not a text file in UTF-8.'],
      ['latin1.sh', Buffer.from([0x65, 0x63, 0x68, 0x6f, 0x20, 0xe9, 0x0a]), 'latin1.sh was not opened: it is not a text file in UTF-8.'],
      ['progress.sh', Buffer.from("printf '50%\r'\necho\n"), 'progress.sh was not opened: it has a CR that ends no line, which the editor would turn into a line break.'],
    ] as const) {
      const [c] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Control+O')]);
      await c.setFiles({ name, mimeType: 'application/octet-stream', buffer: bytes });
      await until(`the refusal of ${name}`, () => toast(page), (t) => t === message);
      assert.strictEqual(await page.locator('#discard-dialog[open]').count(), 0);
      assert.strictEqual((await text(page)).trim(), 'echo keep');
    }
    // Exactly 1 MiB opens.
    const [c] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Control+O')]);
    await c.setFiles({ name: 'max.sh', mimeType: 'text/plain', buffer: Buffer.from('# c\n'.repeat(1024 * 1024 / 4)) });
    await until('the question', () => page.locator('#discard-dialog').isVisible(), (v) => v);
    await page.locator('#discard-open').click();
    await until('opened', () => page.title(), (t) => t === 'max.sh — Bash Explainer', 30000);
    await ctx.close();
  });

  it('saves a file opened with CRLF line ends and a BOM byte for byte, warns about the CRLF, and says when it mixed line ends', async () => {
    const { ctx, page } = await open([NO_PICKERS]);
    page.on('dialog', (d) => void d.accept()); // the sample button's confirmation
    const crlf = '﻿#!/bin/bash\r\nif true; then\r\n  echo hi\r\nfi\r\n';
    assert.strictEqual(await drop(page, 'win.sh', bytesOf(crlf)), true);
    await until('opened', () => toast(page), (t) => t === 'Opened win.sh.');
    // bash would read the CRs: the page says so, as for the file on disk.
    await until('the CRLF warning', () => page.locator('#problem-list').innerText(), (t) => /crlf/.test(t));
    // The BOM is not part of the script (nor of the text in the editor): the first line is a shebang.
    assert.ok((await text(page)).startsWith('#!/bin/bash'));
    const same = await download(page);
    assert.strictEqual(same.name, 'win.sh');
    assert.deepStrictEqual([...same.bytes], bytesOf(crlf));
    // The sample, then its Undo: the file comes back with its name and line ends.
    await page.locator('#sample').click();
    await until('the sample', () => text(page), (t) => t.startsWith('#!/usr/bin/env bash'));
    assert.strictEqual(await page.locator('#file-label').isVisible(), false);
    await page.locator('#status .status-action').click();
    await until('the file back', () => page.title(), (t) => t === 'win.sh — Bash Explainer');
    const back = await download(page);
    assert.strictEqual(back.name, 'win.sh');
    assert.deepStrictEqual([...back.bytes], bytesOf(crlf));
    // An edit keeps the file's line ends.
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText('exit 0\n');
    const edited = await download(page);
    assert.deepStrictEqual([...edited.bytes], bytesOf(`${crlf}exit 0\r\n`));
    // Mixed line ends: saved with the more common one, and the toast says so.
    assert.strictEqual(await drop(page, 'mixed.sh', bytesOf('a\r\nb\r\nc\n')), true);
    await until('the note', () => toast(page), (t) => t === 'mixed.sh mixes line ends: saving writes CRLF throughout.');
    const mixed = await download(page);
    assert.deepStrictEqual([...mixed.bytes], bytesOf('a\r\nb\r\nc\r\n'));
    // A sample is no file's: its line ends are LF again, and Save asks for a name again.
    await page.locator('#sample').click();
    await until('the sample', () => text(page), (t) => t.startsWith('#!/usr/bin/env bash'));
    const sample = await download(page);
    assert.strictEqual(sample.name, 'script.sh');
    assert.strictEqual(sample.bytes.includes(13), false);
    await ctx.close();
  });

  it('with the File System Access API: Ctrl+S asks where once, then writes to that file; a file opened is written back to; a refused write says so, and the next save asks where', async () => {
    const { ctx, page, errors } = await open([PICKERS]);
    page.on('dialog', (d) => void d.accept()); // the sample button's confirmation
    let downloads = 0;
    page.on('download', () => downloads++);
    await type(page, 'echo one\n');
    await page.evaluate("window.__saveAs = 'chosen.zsh'");
    await page.keyboard.press('Control+S');
    await until('written', () => page.evaluate('window.__written["chosen.zsh"]') as Promise<number[] | undefined>, (v) => !!v);
    assert.deepStrictEqual(await page.evaluate('window.__written["chosen.zsh"]'), bytesOf('echo one\n'));
    assert.deepStrictEqual(await page.evaluate('window.__picks'), [['save', 'script.sh']]);
    assert.strictEqual(await toast(page), 'Saved chosen.zsh.');
    assert.strictEqual(await page.locator('#file-label').innerText(), 'chosen.zsh');
    // The name says zsh: the script is explained as zsh now, as a file of that name is in VS Code.
    await until('the shell from the name', () => page.locator('#shell-top option:checked').innerText(), (v) => v === 'Auto (zsh)');
    // The second save writes to the same file, without asking.
    await page.keyboard.insertText('echo two\n');
    await page.keyboard.press('Control+S');
    await until('written again', () => page.evaluate('window.__written["chosen.zsh"].length') as Promise<number>, (n) => n === bytesOf('echo one\necho two\n').length);
    assert.strictEqual((await page.evaluate('window.__picks.length')) as number, 1);
    // A file opened with the picker is written back to.
    await page.evaluate(`window.__nextOpen = new File(['FROM alpine\\nRUN ls\\n'], 'Containerfile')`);
    await page.keyboard.press('Control+O');
    await until('the kind', () => kindOf(page), (k) => k === 'File: Dockerfile');
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText('CMD ["sh"]');
    await page.keyboard.press('Control+S');
    await until('written back', () => page.evaluate('window.__written["Containerfile"]') as Promise<number[] | undefined>, (v) => !!v);
    assert.deepStrictEqual(await page.evaluate('window.__written["Containerfile"]'), bytesOf('FROM alpine\nRUN ls\nCMD ["sh"]'));
    // A cancelled open changes nothing.
    await page.evaluate('window.__nextOpen = undefined');
    await page.keyboard.press('Control+O');
    await page.waitForTimeout(200);
    assert.strictEqual(await kindOf(page), 'File: Dockerfile');
    // A refused permission: nothing is written, and the toast says so; the mark stays.
    await page.evaluate('window.__refuseWrite = true');
    await page.keyboard.insertText('\n');
    await page.keyboard.press('Control+S');
    await until('the refusal', () => toast(page), (t) => t === 'Not saved: the browser could not write to Containerfile. Save again to choose where.');
    await until('the mark', () => page.title(), (t) => t.startsWith('● Containerfile'));
    await page.evaluate("window.__refuseWrite = false; window.__saveAs = 'Containerfile.copy'");
    await page.keyboard.press('Control+S');
    await until('written elsewhere', () => page.evaluate('window.__written["Containerfile.copy"]') as Promise<number[] | undefined>, (v) => !!v);
    assert.deepStrictEqual(await page.evaluate('window.__picks.at(-1)'), ['save', 'Containerfile']);
    assert.strictEqual(downloads, 0);
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  });

  it('fits the menu and the top bar at 320, 390 and 1280 px in English and Japanese, with the file name cut in the bar rather than overflowing', async () => {
    const long = 'a-very-long-file-name-for-the-deployment-of-the-whole-service-to-production.sh';
    for (const locale of ['en-US', 'ja-JP']) {
      for (const width of [320, 390, 1280]) {
        const { ctx, page } = await open([NO_PICKERS], width, locale);
        assert.strictEqual(await drop(page, long, bytesOf('echo hi\n')), true);
        await until('opened', () => page.title(), (t) => t.startsWith(long));
        await page.locator('.cm-content').click();
        await page.keyboard.insertText('x');
        await until('the mark', () => page.title(), (t) => t.startsWith('●'));
        const seen = `${locale} ${width}`;
        assert.strictEqual(await page.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), true, seen);
        // The label shows on a wide screen, cut inside the bar; a phone has no room for it.
        const label = await page.locator('#file-label').evaluate((el) => {
          const r = el.getBoundingClientRect();
          return { shown: r.width > 0, right: r.right, cut: el.scrollWidth > el.clientWidth, bar: el.parentElement!.getBoundingClientRect().height };
        });
        if (width === 1280) {
          assert.strictEqual(label.shown, true, seen);
          assert.strictEqual(label.cut, true, seen);
          const actions = (await page.locator('.top .actions').boundingBox())!;
          assert.ok(label.right <= actions.x, `${seen}: ${JSON.stringify(label)} ${JSON.stringify(actions)}`);
        } else {
          assert.strictEqual(label.shown, false, seen);
        }
        const bar = await page.evaluate('document.querySelector(".top").getBoundingClientRect().height') as number;
        assert.ok(bar <= 49, `${seen}: ${bar}`);
        await page.locator('#menu-open').click();
        await until('the menu', () => page.locator('#drawer').evaluate((d) => d.getBoundingClientRect().x), (x) => Math.abs(x) < 0.5);
        const overflow = await page.evaluate(`[...document.querySelectorAll('#drawer .menu-item')].filter((b) => b.getClientRects().length && (b.scrollWidth > b.clientWidth || b.getBoundingClientRect().right > document.getElementById('drawer').getBoundingClientRect().right)).map((b) => b.id)`);
        assert.deepStrictEqual(overflow, [], seen);
        // The Save item says the file, cut with "…", and that it is not saved.
        assert.ok((await page.locator('#menu-save-name').textContent())!.endsWith(locale === 'ja-JP' ? ' ●（未保存の変更あり）' : ' ● (unsaved changes)'), seen);
        assert.strictEqual(await page.locator('#menu-save-name').evaluate((el) => el.scrollWidth > el.clientWidth), true, seen);
        assert.strictEqual(await page.locator('#menu-open-label').innerText(), locale === 'ja-JP' ? 'ファイルを開く…' : 'Open file…');
        await ctx.close();
      }
    }
  });

  it('keeps the link of a script working: Copy a link carries the text and kind of the file opened, and the link opens them', async () => {
    const { ctx, page } = await open([NO_PICKERS]);
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base.slice(0, -1) });
    assert.strictEqual(await drop(page, 'Dockerfile', bytesOf(DOCKERFILE)), true);
    await until('the kind', () => kindOf(page), (k) => k === 'File: Dockerfile');
    await page.locator('#share').click();
    const url = await until('the link', () => page.evaluate('navigator.clipboard.readText()') as Promise<string>, (t) => t.startsWith(`${base}#`));
    assert.strictEqual(await page.evaluate('location.hash'), '');
    await ctx.close();
    const other = await open([NO_PICKERS]);
    await other.page.goto(url);
    await other.page.reload();
    await until('the shared Dockerfile', () => text(other.page), (t) => t.trim() === DOCKERFILE.trim());
    assert.strictEqual(await kindOf(other.page), 'File: Dockerfile');
    // A shared script is not the user's unsaved work... until it is edited.
    assert.strictEqual(await other.page.locator('#file-label').isVisible(), false);
    assert.strictEqual(await drop(other.page, 'x.sh', bytesOf('echo x\n')), true);
    await until('opened', () => text(other.page), (t) => t.trim() === 'echo x');
    await choose(other.page, '#lang', 'ja');
    assert.strictEqual(await other.page.title(), 'x.sh — Bash Explainer');
    await other.ctx.close();
  });
});
