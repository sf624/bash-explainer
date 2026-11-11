// The web page: what a new script resets (docs/design/usability-9.md, 2.6, 2.9 and Q8), and the depths' names on the view
// control (Q1, 2.10), run in headless Chromium (test/support/site.ts). Clear, a whole script pasted (over all of the text,
// or into an empty editor), and Open start a new script: its kind from the text (or the file), "untitled" (or the file's name), the shell back to
// Auto, with a toast whose Undo puts it all back. The depth stays. Skipped when no browser can start, unless
// $BASH_EXPLAINER_BROWSER is set (as in CI). Screenshots in $BASH_EXPLAINER_SHOTS.
import * as assert from 'assert';
import * as path from 'path';
import type { Browser, BrowserContext, Frame, Page } from 'playwright-core';
import { contrast, parseColour, type RGB } from '../src/ui/colour';
import { chooseDepth, currentShell, FRAMES, kindChosen, menuItem, openSite, pickKind, setShell, toastText, until } from './support/site';

const DOCKERFILE = 'FROM alpine:3.20\nRUN apk add --no-cache curl\nCMD ["sh"]\n';
const BATS = '#!/usr/bin/env bats\n@test "x" {\n  run true\n}\n';
/** A script with no shebang, as the usability test's logins.sh: nothing in it says another kind. */
const LOGINS = 'grep -c "$USER" /var/log/auth.log\nwho | wc -l\n';
/** A bash script with no shebang, which the strip offers to check as POSIX sh. */
const MINE = 'names=(a b)\necho "${names[@]}"\n';

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
        : 'サンプルを消去しました。ファイルの種類をシェルスクリプトにしました。シェルを自動に戻しました。');
      // The depth is a view's preference: it stays.
      assert.strictEqual(await depthOf(page), '2');
      // Only the words are the live region; the Undo is a button beside it.
      assert.strictEqual(await page.locator('#status [role="status"] button').count(), 0);
      await page.locator('#status .status-action').click();
      // (CodeMirror draws only the lines in view: its start says the sample is back.)
      await until('the sample back', () => text(page), (t) => t.slice(0, 80) === sample.slice(0, 80));
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

  it('a file open stays the file: Open resets the shell (Undo chooses it again), typing into it emptied by hand keeps it, and Clear asks before it forgets its changes', async () => {
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
    // Emptied by hand, then a script typed: the file, its kind and the shell stay (a paste there starts a new script: below).
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Delete');
    await page.keyboard.insertText(LOGINS);
    await until('the text', () => text(page), (t) => t.trim() === LOGINS.trim());
    await page.waitForTimeout(300);
    assert.deepStrictEqual(await state(page), ['bats', 'test.bats', 'sh']);
    // Clear on the file changed since it was opened asks first, as Load the sample does; Cancel keeps all.
    await menuItem(page, '#menu-clear');
    await page.locator('#discard-cancel').click();
    assert.strictEqual((await text(page)).trim(), LOGINS.trim());
    assert.deepStrictEqual(await state(page), ['bats', 'test.bats', 'sh']);
    await menuItem(page, '#menu-clear');
    assert.strictEqual(await page.locator('#discard-open').innerText(), 'Discard and clear');
    await page.locator('#discard-open').click();
    await until('empty', () => text(page), (t) => !t.trim());
    assert.deepStrictEqual(await state(page), ['shell', 'untitled.sh', 'auto']);
    // Ctrl+Z takes it all back, as the toast's Undo does: the text, the file, its kind and the shell.
    await page.locator('.cm-content').focus();
    await page.keyboard.press('Control+Z');
    await until('the file back', () => shownName(page), (n) => n === 'test.bats');
    await until('sh back', () => currentShell(page), (s) => s === 'sh');
    assert.deepStrictEqual(await state(page), ['bats', 'test.bats', 'sh']);
    assert.strictEqual((await text(page)).trim(), LOGINS.trim());
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  });

  it('Ctrl+Z after Clear brings back the Dockerfile, its file and the shell chosen, and Ctrl+Shift+Z clears again', async () => {
    const { ctx, page, errors } = await open();
    await openFile(page, 'Dockerfile', DOCKERFILE);
    await until('the file', () => shownName(page), (n) => n === 'Dockerfile');
    await setShell(page, 'sh');
    assert.deepStrictEqual(await state(page), ['dockerfile', 'Dockerfile', 'sh']);
    await menuItem(page, '#menu-clear');
    await until('empty', () => text(page), (t) => !t.trim());
    assert.deepStrictEqual(await state(page), ['shell', 'untitled.sh', 'auto']);
    await page.locator('.cm-content').focus();
    await page.keyboard.press('Control+Z');
    await until('the Dockerfile', () => text(page), (t) => t.trim() === DOCKERFILE.trim());
    await until('its kind', () => kindChosen(page), (k) => k === 'dockerfile');
    assert.deepStrictEqual(await state(page), ['dockerfile', 'Dockerfile', 'sh']);
    // The toast is gone with the edit; nothing of the new script is left.
    assert.strictEqual(await toastText(page), '');
    await page.keyboard.press('Control+Shift+Z');
    await until('empty again', () => text(page), (t) => !t.trim());
    await until('a shell script', () => kindChosen(page), (k) => k === 'shell');
    assert.deepStrictEqual(await state(page), ['shell', 'untitled.sh', 'auto']);
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  });

  it('Ctrl+Z of a Clear that changed no text takes the toast with it, so that its Undo cannot take back an earlier step', async () => {
    const { ctx, page, errors } = await open();
    await page.locator('.cm-content').focus();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText('echo mine\n');
    await menuItem(page, '#menu-clear');
    await until('empty', () => text(page), (t) => !t.trim());
    await setShell(page, 'zsh');
    // The second Clear changes only the shell: one step of the history, with its toast.
    await menuItem(page, '#menu-clear');
    await until('the toast', () => toastText(page), (t) => t === 'Editor cleared. Shell set back to Auto.');
    await page.locator('.cm-content').focus();
    await page.keyboard.press('Control+Z');
    await until('zsh back', () => currentShell(page), (s) => s === 'zsh');
    assert.strictEqual(await toastText(page), '');
    assert.strictEqual(await page.locator('#status .status-action').count(), 0);
    // (Before, the toast stayed, and its Undo brought back the first Clear's text.)
    assert.strictEqual((await text(page)).trim(), '');
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  });

  it('a whole script pasted over the sample and its reset are one step of the history: Ctrl+Z gives the sample back, with its kind and the shell', async () => {
    const { ctx, page, errors } = await open();
    await setShell(page, 'sh');
    await page.locator('.cm-content').focus();
    await page.keyboard.press('Control+A');
    await paste(page, DOCKERFILE);
    await until('a Dockerfile', () => kindChosen(page), (k) => k === 'dockerfile');
    assert.deepStrictEqual(await state(page), ['dockerfile', 'Dockerfile', 'auto']);
    await page.keyboard.press('Control+Z');
    // (CodeMirror draws only the lines in view: the sample's first line says it is back.)
    await until('the sample back', () => text(page), (t) => t.startsWith('#!/usr/bin/env bash\n') && !t.includes('FROM alpine'));
    await until('its kind', () => kindChosen(page), (k) => k === 'shell');
    assert.deepStrictEqual(await state(page), ['shell', 'untitled.sh', 'sh']);
    assert.strictEqual(await toastText(page), '');
    // And Ctrl+Shift+Z makes it again.
    await page.keyboard.press('Control+Shift+Z');
    await until('the Dockerfile again', () => kindChosen(page), (k) => k === 'dockerfile');
    assert.deepStrictEqual(await state(page), ['dockerfile', 'Dockerfile', 'auto']);
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  });

  it('starts no new script for a paste that leaves some of the old text: a line added to the sample, a part of the user\'s own script replaced', async () => {
    const { ctx, page } = await open();
    await pickKind(page, 'dockerfile');
    await until('the Dockerfile sample', () => text(page), (t) => t.startsWith('FROM') || t.includes('\nFROM'));
    await page.locator('.cm-content').focus();
    await page.keyboard.press('Control+End');
    await paste(page, '\nRUN apt-get update\n');
    await until('the line', () => text(page), (t) => t.includes('RUN apt-get update'));
    await page.waitForTimeout(300);
    assert.deepStrictEqual(await state(page), ['dockerfile', 'Dockerfile', 'auto']);
    // The user's own script, zsh chosen, then all of it but its first character replaced by a paste: zsh stays.
    await menuItem(page, '#menu-clear');
    await until('empty', () => text(page), (t) => !t.trim());
    await page.locator('.cm-content').focus();
    await page.keyboard.insertText('echo mine\n');
    await setShell(page, 'zsh');
    await page.locator('.cm-content').focus();
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Shift+Control+Home');
    await page.keyboard.press('Shift+ArrowRight');
    await paste(page, 'print -l *.txt\n');
    await until('the paste', () => text(page), (t) => t.includes('print'));
    await page.waitForTimeout(300);
    assert.ok((await text(page)).startsWith('e'), 'the first character kept');
    assert.deepStrictEqual(await state(page), ['shell', 'untitled.sh', 'zsh']);
    assert.strictEqual(await toastText(page), '');
    await ctx.close();
  });

  it('select all and paste after "Switch to POSIX sh" starts a new script (usability test, run 3): the shell back to Auto, with a toast; its Undo keeps the paste, Ctrl+Z takes the whole step back', async () => {
    for (const lang of ['en', 'ja'] as const) {
      const { ctx, page, errors } = await open({ lang });
      await page.locator('.cm-content').focus();
      await page.keyboard.press('Control+A');
      await page.keyboard.insertText(MINE);
      await page.locator('#problems-sh:not([hidden])').waitFor({ state: 'attached', timeout: 20000 });
      await page.locator('#sh-hint-button').click();
      await until('POSIX sh', () => currentShell(page), (v) => v === 'sh');
      assert.deepStrictEqual(await state(page), ['shell', 'untitled.sh', 'sh'], lang);
      await page.locator('.cm-content').focus();
      await page.keyboard.press('Control+A');
      await paste(page, LOGINS);
      await until('Auto', () => currentShell(page), (v) => v === 'auto');
      assert.deepStrictEqual(await state(page), ['shell', 'untitled.sh', 'auto'], lang);
      assert.strictEqual(await toastText(page), lang === 'en' ? 'Shell set back to Auto.' : 'シェルを自動に戻しました。');
      // Only the words are the live region; the Undo is a button beside it.
      assert.strictEqual(await page.locator('#status [role="status"] button').count(), 0);
      // The toast's Undo puts back what it says, the text as pasted.
      await page.locator('#status .status-action').click();
      await until('sh again', () => currentShell(page), (v) => v === 'sh');
      assert.deepStrictEqual(await state(page), ['shell', 'untitled.sh', 'sh'], lang);
      assert.strictEqual((await text(page)).trim(), LOGINS.trim(), lang);
      // Pasted again, then Ctrl+Z: the script before it, its kind and POSIX sh, in one step.
      await page.locator('.cm-content').focus();
      await page.keyboard.press('Control+A');
      await paste(page, DOCKERFILE);
      await until('a Dockerfile', () => kindChosen(page), (k) => k === 'dockerfile');
      assert.deepStrictEqual(await state(page), ['dockerfile', 'Dockerfile', 'auto'], lang);
      await page.keyboard.press('Control+Z');
      await until('the paste before', () => text(page), (t) => t.trim() === LOGINS.trim());
      await until('sh back', () => currentShell(page), (v) => v === 'sh');
      assert.deepStrictEqual(await state(page), ['shell', 'untitled.sh', 'sh'], lang);
      assert.strictEqual(await toastText(page), '');
      assert.deepStrictEqual(errors, []);
      await ctx.close();
    }
  });

  it('a paste over all but the last empty line is a whole paste too: blank space left around it counts as none', async () => {
    const { ctx, page, errors } = await open();
    await page.locator('.cm-content').focus();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText(MINE);
    await setShell(page, 'sh');
    // Everything but the last line break (a phone's drag that misses the last empty line selects so).
    await page.locator('.cm-content').focus();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Shift+ArrowLeft');
    await paste(page, LOGINS.trimEnd());
    await until('Auto', () => currentShell(page), (v) => v === 'auto');
    assert.strictEqual(await toastText(page), 'Shell set back to Auto.');
    // Text left around the paste is no blank space: an ordinary edit, the shell stays.
    await setShell(page, 'sh');
    await page.locator('.cm-content').focus();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Shift+ArrowLeft');
    await page.keyboard.press('Shift+ArrowLeft');
    await paste(page, 'echo x');
    await until('the paste', () => text(page), (t) => t.includes('echo x'));
    await page.waitForTimeout(300);
    assert.strictEqual(await currentShell(page), 'sh');
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  });

  it('a paste into an empty editor starts a new script, from the keyboard and from the Paste button: a shell chosen since goes back to Auto', async () => {
    const { ctx, page, errors } = await open();
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base.slice(0, -1) });
    await menuItem(page, '#menu-clear');
    await until('empty', () => text(page), (t) => !t.trim());
    await setShell(page, 'zsh');
    await page.locator('.cm-content').focus();
    await paste(page, 'print -l *.txt\n');
    await until('Auto', () => currentShell(page), (v) => v === 'auto');
    assert.deepStrictEqual(await state(page), ['shell', 'untitled.sh', 'auto']);
    assert.strictEqual(await toastText(page), 'Shell set back to Auto.');
    // The empty editor's Paste button (the phone's way to paste) goes the same way.
    await menuItem(page, '#menu-clear');
    await until('empty', () => text(page), (t) => !t.trim());
    await setShell(page, 'sh');
    await page.evaluate(`navigator.clipboard.writeText(${JSON.stringify(BATS)})`);
    await page.locator('#empty-paste').click();
    await until('bats', () => kindChosen(page), (k) => k === 'bats');
    assert.deepStrictEqual(await state(page), ['bats', 'untitled.bats', 'auto']);
    assert.strictEqual(await toastText(page), 'Detected: bats. Shell set back to Auto.');
    assert.strictEqual(await page.evaluate("document.activeElement?.classList.contains('cm-content')"), true, 'the focus in the editor');
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  });

  it('a whole paste over a file open: unchanged, it starts a new script, whose Undo keeps the paste as the file; changed, it asks first, as Clear does', async () => {
    for (const lang of ['en', 'ja'] as const) {
      const { ctx, page, errors } = await open({ lang });
      await openFile(page, 'test.bats', BATS);
      await until('the file', () => shownName(page), (n) => n === 'test.bats');
      await setShell(page, 'sh');
      // Unchanged: no question; the toast says the name went back too.
      await page.locator('.cm-content').focus();
      await page.keyboard.press('Control+A');
      await paste(page, LOGINS);
      await until('untitled', () => shownName(page), (n) => n === 'untitled.sh');
      assert.deepStrictEqual(await state(page), ['shell', 'untitled.sh', 'auto'], lang);
      assert.strictEqual(await toastText(page), lang === 'en'
        ? 'File type set to Shell script. Name set back to untitled. Shell set back to Auto.'
        : 'ファイルの種類をシェルスクリプトにしました。名前を untitled に戻しました。シェルを自動に戻しました。');
      // Its Undo makes the paste an edit of the file: the file, its kind and the shell, with the text as pasted.
      await page.locator('#status .status-action').click();
      await until('the file again', () => shownName(page), (n) => n === 'test.bats');
      assert.deepStrictEqual(await state(page), ['bats', 'test.bats', 'sh'], lang);
      assert.strictEqual((await text(page)).trim(), LOGINS.trim());
      // Changed since it was opened: the paste asks first, as Clear does. Cancel keeps all, the focus back in the editor.
      await page.locator('.cm-content').focus();
      await page.keyboard.press('Control+A');
      await paste(page, DOCKERFILE);
      await page.locator('#discard-cancel').waitFor();
      assert.strictEqual(await page.locator('#discard-open').innerText(), lang === 'en' ? 'Discard and paste' : '破棄して貼り付ける');
      // What a screen reader hears: a dialog named by its question, which says what the paste does.
      const asked = await page.locator('#discard-dialog').ariaSnapshot();
      assert.match(asked, lang === 'en' ? /dialog "Discard unsaved changes\?"[\s\S]*Pasting over the whole script starts a new script/ : /dialog "保存していない変更を破棄しますか？"[\s\S]*スクリプト全体に貼り付けると新しいスクリプトになり/, asked);
      await page.locator('#discard-cancel').click();
      await until('the focus back', () => page.evaluate("document.activeElement?.classList.contains('cm-content')"), (v) => v === true);
      assert.strictEqual((await text(page)).trim(), LOGINS.trim());
      assert.deepStrictEqual(await state(page), ['bats', 'test.bats', 'sh'], lang);
      // Cancel, and at once (in the same task, before the dialog's close event) a paste again: the second question is
      // its own. (Before, the first one's late close event answered it "Cancel" and left the dialog open, deaf.)
      await page.keyboard.press('Control+A');
      await paste(page, DOCKERFILE);
      await page.locator('#discard-cancel').waitFor();
      await page.evaluate(`(() => {
        document.getElementById('discard-cancel').click();
        const data = new DataTransfer();
        data.setData('text/plain', ${JSON.stringify(DOCKERFILE)});
        document.querySelector('.cm-content').dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
      })()`);
      await page.evaluate(FRAMES);
      assert.strictEqual(await page.locator('#discard-dialog').evaluate((d) => (d as unknown as { open: boolean }).open), true, `${lang}: asked again`);
      // Discard and paste: the paste as it was, and the new script.
      await page.locator('#discard-open').click();
      await until('the Dockerfile', () => text(page), (t) => t.trim() === DOCKERFILE.trim());
      await until('a Dockerfile', () => kindChosen(page), (k) => k === 'dockerfile');
      assert.deepStrictEqual(await state(page), ['dockerfile', 'Dockerfile', 'auto'], lang);
      assert.strictEqual(await page.evaluate("document.activeElement?.classList.contains('cm-content')"), true, `${lang}: the focus in the editor`);
      // Ctrl+Z takes it all back: the text, the file, its kind and the shell.
      await page.keyboard.press('Control+Z');
      await until('the file back', () => shownName(page), (n) => n === 'test.bats');
      await until('sh back', () => currentShell(page), (v) => v === 'sh');
      assert.deepStrictEqual(await state(page), ['bats', 'test.bats', 'sh'], lang);
      assert.strictEqual((await text(page)).trim(), LOGINS.trim());
      assert.deepStrictEqual(errors, []);
      await ctx.close();
    }
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

  // (docs/design/usability-9.md, 2.6: the headline's word is the note's label; the icon then says the level, from the level table.)
  it('names the level of a problem by its icon where the headline\'s word does not, and on the row\'s chip', async () => {
    const { ctx, page } = await open();
    await page.locator('.cm-content').focus();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText('#!/bin/sh\necho -e "a\\tb"\n');
    await page.keyboard.press('Control+Home');
    await page.keyboard.press('ArrowDown');
    const panel = panelOf(page);
    await until('the box', () => panel.locator('#problems .problem-head').count(), (n) => n > 0);
    const box = await panel.locator('#problems').ariaSnapshot();
    assert.match(box, /img "Warning"[\s\S]*Portability/, box);
    // ("Error" says its level itself: its icon is not read twice.)
    assert.doesNotMatch(box, /img "Error"/, box);
    const chips = await panel.locator('.problem-chip').evaluateAll((cs) => cs.map((c) => c.getAttribute('aria-label')));
    assert.ok(chips.includes('Go to the problem: Warning, Portability'), JSON.stringify(chips));
    await ctx.close();
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
