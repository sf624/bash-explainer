// The web page: the app bar's "Copy a link", the editor's header (Open, Save, the file name, ⋯), the first visit's hint,
// the empty editor's block and the menu's groups (docs/design/chrome-redesign.md, C4), run for real in headless Chromium
// (test/support/site.ts). Skipped when no browser can start, unless $BASH_EXPLAINER_BROWSER is set (as in CI).
import * as assert from 'assert';
import type { Browser, BrowserContextOptions, Page } from 'playwright-core';
import { frames, openSite, stable, until, type Site } from './support/site';

/** No File System Access API: a save is a download (as in Firefox and Safari). */
const NO_PICKERS = 'delete window.showOpenFilePicker; delete window.showSaveFilePicker;';

describe('the web page: the app bar and the editor\'s header', function () {
  this.timeout(120000);
  let browser: Browser;
  let firstVisit: Site['firstVisit'];
  let base = '';

  before(async function () {
    ({ browser, firstVisit, base } = await openSite(this));
  });

  // The first visit's hint is tested on its own (`hint`): the other tests start as a later visit (test/support/site.ts).
  const open = async (options: BrowserContextOptions = {}, { hint = false } = {}) => {
    const ctx = await (hint ? firstVisit : browser.newContext.bind(browser))({ viewport: { width: 1280, height: 800 }, locale: 'en-US', acceptDownloads: true, ...options });
    await ctx.addInitScript(NO_PICKERS);
    const page = await ctx.newPage();
    await page.goto(base);
    await page.locator('.cm-line').nth(3).waitFor();
    return { ctx, page };
  };
  const text = (page: Page) => page.evaluate('document.querySelector(".cm-content").innerText') as Promise<string>;
  const toast = (page: Page) => page.locator('#status').evaluate((el) => el.firstChild?.textContent ?? '');
  const focused = (page: Page) => page.evaluate('document.activeElement && document.activeElement.id') as Promise<string>;
  const name = (page: Page) => page.evaluate(`(() => {
    const b = document.getElementById('file-name');
    return { text: document.getElementById('file-name-stem').textContent + document.getElementById('file-name-ext').textContent, draft: b.classList.contains('draft'), dot: !document.getElementById('file-dot').hidden, label: b.getAttribute('aria-label') };
  })()`) as Promise<{ text: string; draft: boolean; dot: boolean; label: string }>;

  it('says "Copied" on Copy a link for about 2 s, keeps its width, and has the privacy sentence as its tooltip and description', async () => {
    for (const [locale, words, copied, said, note] of [
      ['en-US', 'Copy a link', 'Copied', 'Link copied', 'The script is in the part after #, which browsers do not send to the server.'],
      ['ja-JP', 'リンクをコピー', 'コピーしました', 'リンクをコピーしました', 'スクリプトは # より後ろに入っていて、ブラウザはこの部分をサーバーに送りません。'],
    ]) {
      const { ctx, page } = await open({ locale });
      await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base.slice(0, -1) });
      const share = page.locator('#share');
      assert.strictEqual(await share.innerText(), words);
      assert.strictEqual(await share.getAttribute('title'), note);
      // Its accessible name is its words; its description the sentence.
      const a11y = await page.evaluate(`(() => { const b = document.getElementById('share'); return [b.getAttribute('aria-label'), b.getAttribute('aria-describedby'), document.getElementById(b.getAttribute('aria-describedby')).textContent]; })()`);
      assert.deepStrictEqual(a11y, [null, 'share-note', note]);
      const before = (await share.boundingBox())!;
      const icon = () => page.locator('#share use').getAttribute('href');
      assert.strictEqual(await icon(), '#i-link');
      await page.evaluate('navigator.clipboard.writeText("")');
      await share.click();
      await until('the link', () => page.evaluate('navigator.clipboard.readText()') as Promise<string>, (t) => t.startsWith(`${base}#`));
      await until('Copied', () => share.innerText(), (t) => t === copied);
      assert.strictEqual(await icon(), '#i-check');
      await until('the live region', () => page.locator('#share-said').textContent(), (t) => t === said);
      assert.strictEqual(await page.locator('#share-said').getAttribute('role'), 'status');
      // Nothing moved: the button is as wide as before, or wider; no toast.
      const during = (await share.boundingBox())!;
      assert.ok(during.width >= before.width - 0.5 && Math.abs(during.x + during.width - before.x - before.width) < 1, JSON.stringify([before, during]));
      assert.strictEqual(await toast(page), '');
      // About 2 s later it is "Copy a link" again.
      const t0 = Date.now();
      await until('back', () => share.innerText(), (t) => t === words, 4000);
      const waited = Date.now() - t0;
      assert.ok(waited > 1000, String(waited));
      assert.strictEqual(await icon(), '#i-link');
      assert.deepStrictEqual((await share.boundingBox())!.width, before.width);
      await ctx.close();
    }
  });

  it('on a phone, Copy a link is in the menu\'s Share group and says "Copied" on its item, the menu staying open', async () => {
    const { devices } = await import('playwright-core');
    const { ctx, page } = await open({ ...devices['iPhone 13'] });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base.slice(0, -1) });
    assert.strictEqual(await page.locator('#share').isVisible(), false);
    await page.locator('#readtip-close').tap();
    await page.locator('#menu-open').tap();
    await page.locator('#menu-share').tap();
    await until('the link', () => page.evaluate('navigator.clipboard.readText()') as Promise<string>, (t) => t.startsWith(`${base}#`));
    await until('Copied', () => page.locator('#menu-share').innerText(), (t) => t === 'Copied');
    await until('said', () => page.locator('#menu-share-said').textContent(), (t) => t === 'Link copied');
    assert.strictEqual(await page.locator('#drawer').evaluate((d) => (d as unknown as { open: boolean }).open), true);
    assert.strictEqual(await page.locator('#menu-share').getAttribute('aria-describedby'), 'share-note');
    await until('back', () => page.locator('#menu-share').innerText(), (t) => t === 'Copy a link to this script', 4000);
    await ctx.close();
  });

  it('shows the name muted while never saved, ● after an edit of a saved file and none after Save; Save has no dot', async () => {
    const { ctx, page } = await open();
    assert.deepStrictEqual(await name(page), { text: 'untitled.sh', draft: true, dot: false, label: 'Rename: untitled.sh (not saved yet)' });
    assert.strictEqual(await page.locator('#file-name').getAttribute('title'), 'Rename: untitled.sh (not saved yet)');
    const muted = await page.evaluate("[getComputedStyle(document.getElementById('file-name')).color, getComputedStyle(document.getElementById('open-btn')).color]") as string[];
    assert.notStrictEqual(muted[0], muted[1]);
    // An edit of a script never saved: still muted, no dot (nothing on disk to differ from).
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText('echo mine\n');
    await page.waitForTimeout(300);
    assert.deepStrictEqual(await name(page), { text: 'untitled.sh', draft: true, dot: false, label: 'Rename: untitled.sh (not saved yet)' });
    // Saved (a download): the name in the normal colour, no dot.
    const [first] = await Promise.all([page.waitForEvent('download'), page.locator('#save-btn').click()]);
    assert.strictEqual(first.suggestedFilename(), 'untitled.sh');
    await until('saved', () => name(page), (n) => !n.draft);
    assert.deepStrictEqual(await name(page), { text: 'untitled.sh', draft: false, dot: false, label: 'Rename: untitled.sh' });
    // An edit: ● after the name, and the title; Save itself has no dot.
    await page.locator('.cm-content').click();
    await page.keyboard.insertText('x');
    await until('the dot', () => name(page), (n) => n.dot);
    assert.strictEqual((await name(page)).label, 'Rename: untitled.sh (unsaved changes)');
    assert.strictEqual(await page.title(), '● untitled.sh — Bash Explainer');
    assert.strictEqual(await page.locator('#save-btn').innerText(), 'Save');
    assert.strictEqual(await page.locator('#save-btn .file-dot, #save-btn [class*=dot]').count(), 0);
    assert.strictEqual(await page.locator('#save-btn').getAttribute('title'), 'Save as untitled.sh (Ctrl+S)');
    // Save: the dot goes.
    await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+S')]);
    await until('no dot', () => name(page), (n) => !n.dot);
    assert.strictEqual(await page.title(), 'untitled.sh — Bash Explainer');
    await ctx.close();
  });

  it('renames in place with the mouse and with the keyboard; Escape keeps the old name and gives the focus back', async () => {
    const { ctx, page } = await open();
    // The mouse: a click turns the name into a field with the stem selected; typing replaces the stem.
    await page.locator('#file-name').click();
    const input = page.locator('#file-name-input');
    assert.strictEqual(await input.isVisible(), true);
    assert.strictEqual(await page.locator('#file-name').isVisible(), false);
    assert.strictEqual(await focused(page), 'file-name-input');
    assert.strictEqual(await input.getAttribute('aria-label'), 'File name');
    assert.deepStrictEqual(await input.evaluate((i) => [(i as unknown as { selectionStart: number }).selectionStart, (i as unknown as { selectionEnd: number }).selectionEnd]), [0, 8]);
    await page.keyboard.insertText('deploy');
    // A click elsewhere keeps what was typed.
    await page.locator('.cm-content').click();
    await until('renamed', () => name(page), (n) => n.text === 'deploy.sh');
    assert.deepStrictEqual(await name(page), { text: 'deploy.sh', draft: true, dot: false, label: 'Rename: deploy.sh (not saved yet)' });
    assert.strictEqual(await page.title(), 'deploy.sh — Bash Explainer');
    // (A script without a #! line: the name decides its shell.)
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText('echo hi\n');
    // The keyboard: Tab to the name, Enter, a new name, Enter: the focus is back on the name.
    await page.locator('#save-btn').focus();
    await page.keyboard.press('Tab');
    assert.strictEqual(await focused(page), 'file-name');
    await page.keyboard.press('Enter');
    assert.strictEqual(await focused(page), 'file-name-input');
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText('setup.zsh');
    await page.keyboard.press('Enter');
    assert.strictEqual(await focused(page), 'file-name');
    assert.strictEqual((await name(page)).text, 'setup.zsh');
    // A name that says zsh: the script is explained as zsh, as a file of that name is.
    await until('zsh from the name', () => page.locator('#shell-top option:checked').innerText(), (v) => v === 'Auto (zsh)');
    // Escape keeps the old name, and the focus goes back to it.
    await page.keyboard.press('Enter');
    await page.keyboard.insertText('other');
    await page.keyboard.press('Escape');
    assert.strictEqual(await focused(page), 'file-name');
    assert.strictEqual((await name(page)).text, 'setup.zsh');
    // An empty name, or slashes only, changes nothing.
    await page.keyboard.press('Enter');
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText(' / ');
    await page.keyboard.press('Enter');
    assert.strictEqual((await name(page)).text, 'setup.zsh');
    // ⋯ › Rename… opens the same field; the first save suggests the name given.
    await page.locator('#ed-more').click();
    await page.locator('#more-rename').click();
    assert.strictEqual(await focused(page), 'file-name-input');
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText('final.sh');
    await page.keyboard.press('Enter');
    const [saved] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+S')]);
    assert.strictEqual(saved.suggestedFilename(), 'final.sh');
    await until('saved', () => name(page), (n) => !n.draft);
    // Renaming a saved file marks it: the new name is not on disk yet.
    await page.locator('#file-name').click();
    await page.keyboard.insertText('renamed');
    await page.keyboard.press('Enter');
    assert.deepStrictEqual(await name(page), { text: 'renamed.sh', draft: false, dot: true, label: 'Rename: renamed.sh (unsaved changes)' });
    // The menu's first row is the name, and renames there too; Escape there keeps the name and the menu.
    await page.locator('#menu-open').click();
    assert.strictEqual(await page.locator('#menu-file').textContent(), 'renamed.sh●');
    await page.locator('#menu-file').click();
    assert.strictEqual(await focused(page), 'menu-file-input');
    await page.keyboard.insertText('x');
    await page.keyboard.press('Escape');
    assert.strictEqual(await page.locator('#drawer').evaluate((d) => (d as unknown as { open: boolean }).open), true);
    assert.strictEqual(await focused(page), 'menu-file');
    await page.keyboard.press('Enter');
    await page.keyboard.insertText('menu');
    await page.keyboard.press('Enter');
    assert.strictEqual(await page.locator('#menu-file-name').innerText(), 'menu.sh');
    await page.keyboard.press('Escape');
    assert.strictEqual((await name(page)).text, 'menu.sh');
    await ctx.close();
  });

  it('has ⋯ with Rename…, Copy the script, Load the sample and Clear the editor: a menu that the arrows walk and Escape closes', async () => {
    const { ctx, page } = await open();
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base.slice(0, -1) });
    const more = page.locator('#ed-more');
    assert.deepStrictEqual([await more.getAttribute('aria-label'), await more.getAttribute('aria-haspopup'), await more.getAttribute('aria-expanded')], ['More actions', 'menu', 'false']);
    await more.focus();
    await page.keyboard.press('Enter');
    assert.strictEqual(await more.getAttribute('aria-expanded'), 'true');
    assert.deepStrictEqual(await page.locator('#ed-more-menu [role=menuitem]').allInnerTexts(), ['Rename…', 'Copy the script', 'Load the sample', 'Clear the editor']);
    assert.strictEqual(await focused(page), 'more-rename');
    await page.keyboard.press('ArrowDown');
    assert.strictEqual(await focused(page), 'more-copy');
    await page.keyboard.press('End');
    assert.strictEqual(await focused(page), 'more-clear');
    await page.keyboard.press('ArrowDown');
    assert.strictEqual(await focused(page), 'more-rename');
    await page.keyboard.press('ArrowUp');
    assert.strictEqual(await focused(page), 'more-clear');
    await page.keyboard.press('Escape');
    assert.strictEqual(await page.locator('#ed-more-menu').isVisible(), false);
    assert.strictEqual(await focused(page), 'ed-more');
    assert.strictEqual(await more.getAttribute('aria-expanded'), 'false');
    // Copy the script: the clipboard has the text, and the focus is back on ⋯.
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    assert.strictEqual(await focused(page), 'more-copy');
    await page.keyboard.press('Enter');
    await until('the copy', () => page.evaluate('navigator.clipboard.readText()') as Promise<string>, (t) => t.startsWith('#!/usr/bin/env bash'));
    assert.strictEqual(await focused(page), 'ed-more');
    await until('the toast', () => toast(page), (t) => t === 'Copied the script.');
    // Clear the editor (with the mouse): the empty block shows, and the toast's Undo brings the sample back.
    await more.click();
    await page.locator('#more-clear').click();
    await until('empty', () => text(page), (t) => !t.trim());
    await until('the empty block', () => page.locator('#empty-editor').isVisible(), (v) => v);
    assert.strictEqual(await toast(page), 'Sample cleared');
    await page.locator('#status .status-action').click();
    await until('the sample back', () => text(page), (t) => t.startsWith('#!/usr/bin/env bash'));
    await until('no empty block', () => page.locator('#empty-editor').isVisible(), (v) => !v);
    // A press outside closes it without a choice.
    await more.click();
    await page.mouse.click(900, 400);
    assert.strictEqual(await page.locator('#ed-more-menu').isVisible(), false);
    await ctx.close();
  });

  it('shows the first visit\'s hint over the sample until it is closed or used; Use my own script empties the editor, whose block pastes, opens or loads', async () => {
    const { ctx, page } = await open({}, { hint: true });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base.slice(0, -1) });
    const hint = page.locator('#first-hint');
    assert.strictEqual(await hint.isVisible(), true);
    assert.strictEqual(await page.locator('#first-hint-text').innerText(), 'This is a sample: put the cursor on any line.');
    assert.strictEqual(await page.locator('#first-hint-close').getAttribute('aria-label'), 'Close');
    // It lies between the header and the editor, and covers none of the code.
    const [head, box, ed] = await Promise.all(['#ed-head', '#first-hint', '#editor'].map(async (s) => (await page.locator(s).boundingBox())!));
    assert.ok(Math.abs(box.y - head.y - head.height) < 1 && Math.abs(ed.y - box.y - box.height) < 1, JSON.stringify([head, box, ed]));
    await page.locator('#hint-own').click();
    await until('empty', () => text(page), (t) => !t.trim());
    assert.strictEqual(await hint.isVisible(), false);
    await until('the empty block', () => page.locator('#empty-editor').isVisible(), (v) => v);
    assert.deepStrictEqual(await page.locator('#empty-editor button').allInnerTexts(), ['Paste a script\nCtrl+V', 'Open a file…', 'Load the sample']);
    assert.strictEqual(await page.locator('#empty-drop').innerText(), 'or drop a file here');
    // Paste a script: the clipboard's text, as a paste (its kind is detected).
    await page.evaluate('navigator.clipboard.writeText("FROM alpine\\nRUN echo hi\\n")');
    await page.locator('#empty-paste').click();
    await until('pasted', () => text(page), (t) => t.startsWith('FROM alpine'));
    await until('the kind', () => page.locator('#kind').getAttribute('aria-label'), (k) => k === 'File: Dockerfile');
    assert.strictEqual(await page.locator('#empty-editor').isVisible(), false);
    // Closed for good: a reload of the sample shows no hint.
    await page.reload();
    await page.locator('.cm-line').first().waitFor();
    await frames(page);
    assert.strictEqual(await hint.isVisible(), false);
    await ctx.close();
    // The ×, and the block's Load the sample.
    const second = await open({}, { hint: true });
    await second.page.locator('#first-hint-close').click();
    assert.strictEqual(await second.page.locator('#first-hint').isVisible(), false);
    assert.strictEqual(await second.page.evaluate("localStorage.getItem('bash-explainer-first-hint')"), '1');
    await second.page.locator('#ed-more').click();
    await second.page.locator('#more-clear').click();
    await until('the empty block', () => second.page.locator('#empty-editor').isVisible(), (v) => v);
    await second.page.locator('#empty-sample').click();
    await until('the sample', () => text(second.page), (t) => t.startsWith('#!/usr/bin/env bash'));
    await second.ctx.close();
  });

  it('shows Open and Save in words from a 481 px pane and as icons below, and cuts a long name in its stem, in English and Japanese', async () => {
    const long = 'a-very-long-file-name-for-the-deployment-of-the-whole-service.sh';
    for (const locale of ['en-US', 'ja-JP']) {
      for (const [width, words] of [[1280, true], [900, false], [640, true], [390, false]] as const) {
        const { devices } = await import('playwright-core');
        const { ctx, page } = await open(width === 390 ? { ...devices['iPhone 13'], locale } : { viewport: { width, height: 800 }, locale });
        const seen = `${locale} ${width}`;
        // (The phone's first-run tip of the read-mode switch lies over the header until it is closed.)
        if (await page.locator('#readtip-close').isVisible()) await page.locator('#readtip-close').click();
        const pane = (await page.locator('#source').boundingBox())!;
        assert.strictEqual(pane.width >= 481, words, `${seen}: pane ${pane.width}`);
        for (const id of ['#open-btn', '#save-btn']) {
          const lbl = await page.locator(`${id} .lbl`).boundingBox();
          assert.strictEqual((lbl?.width ?? 0) > 2, words, `${seen} ${id}`);
          // Its name is its word either way.
          assert.strictEqual(await page.locator(id).evaluate((b) => b.textContent), locale === 'ja-JP' ? (id === '#open-btn' ? '開く' : '保存') : (id === '#open-btn' ? 'Open' : 'Save'));
        }
        await page.locator('#file-name').click();
        await page.keyboard.press('Control+A');
        await page.keyboard.insertText(long);
        await page.keyboard.press('Enter');
        await until('the long name', () => page.locator('#file-name').getAttribute('aria-label'), (l) => !!l?.includes(long));
        // Nothing overflows: the header is one row, the name cut in its stem with its extension kept, ⋯ at the right end.
        const m = await page.evaluate(`(() => {
          const head = document.getElementById('ed-head').getBoundingClientRect();
          const stem = document.getElementById('file-name-stem');
          const ext = document.getElementById('file-name-ext').getBoundingClientRect();
          const more = document.getElementById('ed-more').getBoundingClientRect();
          return { overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth, cut: stem.scrollWidth > stem.clientWidth, ext: ext.width, extRight: ext.right, moreLeft: more.left, moreRight: more.right, headRight: head.right, height: head.height, top: more.top - head.top };
        })()`) as Record<string, number | boolean>;
        assert.strictEqual(m.overflow, false, seen);
        assert.strictEqual(m.cut, true, `${seen}: ${JSON.stringify(m)}`);
        assert.ok((m.ext as number) > 5 && (m.extRight as number) <= (m.moreLeft as number), `${seen}: ${JSON.stringify(m)}`);
        assert.ok((m.headRight as number) - (m.moreRight as number) <= (width === 390 ? 12.5 : 4.5), `${seen}: ${JSON.stringify(m)}`);
        // A stacked page (under 768 px) has the 44 px controls of a phone.
        assert.strictEqual(m.height, width <= 640 ? 44 : 36, seen);
        await ctx.close();
      }
    }
  });

  it('groups the menu: Script (first row: the name); Share and Explanation when stacked; Preferences; Help (its keys not on a touch screen, its way to the explanation on every screen); About', async () => {
    const { devices } = await import('playwright-core');
    for (const [width, options, stacked, help] of [
      [390, { ...devices['iPhone 13'] }, true, false],
      [640, { viewport: { width: 640, height: 800 } }, true, true],
      [1280, { viewport: { width: 1280, height: 800 } }, false, true],
    ] as const) {
      for (const locale of ['en-US', 'ja-JP']) {
        const { ctx, page } = await open({ ...options, locale });
        if (await page.locator('#readtip-close').isVisible()) await page.locator('#readtip-close').tap();
        await page.locator('#menu-open').click();
        await stable('the menu', () => page.locator('#drawer').boundingBox());
        const seen = `${width} ${locale}`;
        const heads = await page.locator('#drawer .menu-h').evaluateAll((hs) => hs.filter((h) => h.getClientRects().length).map((h) => h.textContent));
        const ja = locale === 'ja-JP';
        const all = ja ? ['スクリプト', '共有', '解説', '表示と言語', 'ヘルプ', 'このアプリについて'] : ['Script', 'Share', 'Explanation', 'Preferences', 'Help', 'About'];
        assert.deepStrictEqual(heads, all.filter((_h, i) => stacked || (i !== 1 && i !== 2)), seen);
        assert.strictEqual(await page.locator('#drawer-title').innerText(), 'Bash Explainer');
        // The first row of the menu is the file name.
        const first = await page.evaluate("[...document.querySelectorAll('#drawer .sheet-body button, #drawer .sheet-body select, #drawer .sheet-body a')].find((e) => e.getClientRects().length).id");
        assert.strictEqual(first, 'menu-file', seen);
        assert.strictEqual(await page.locator('#menu-file-name').innerText(), 'untitled.sh');
        // Each group's controls in it: Copy a link and the script in Share, Copy as Markdown in Explanation.
        const group = (id: string) => page.locator(`#${id}`).evaluate((e) => e.closest('section')!.getAttribute('aria-labelledby'));
        assert.deepStrictEqual(await Promise.all(['menu-file', 'menu-open-file', 'menu-save', 'menu-sample', 'menu-clear', 'menu-share', 'menu-copy-script', 'menu-copy', 'lang', 'theme', 'menu-panes', 'menu-install'].map(group)),
          ['menu-h-script', 'menu-h-script', 'menu-h-script', 'menu-h-script', 'menu-h-script', 'menu-h-share', 'menu-h-share', 'menu-h-explanation', 'menu-h-prefs', 'menu-h-prefs', 'menu-h-help', 'menu-h-about']);
        if (help) {
          // Help's list of shortcuts: every key of the page.
          const keys = await page.locator('#menu-keys dt').allInnerTexts();
          assert.deepStrictEqual(keys, ['Ctrl+O', 'Ctrl+S', 'F6', 'Ctrl+K Ctrl+I', ja ? 'Esc、Tab の順' : 'Escape, then Tab'], seen);
          assert.deepStrictEqual(await page.locator('#menu-keys dd').allInnerTexts(), ja
            ? ['ファイルを開く', '保存', '解説とエディタを行き来する', 'カーソル位置の部分のカードを表示', 'エディタから出る']
            : ['Open a file', 'Save', 'Go to the explanation and back', 'Show the card of the part at the cursor', 'Leave the editor'], seen);
          assert.strictEqual(await page.locator('#menu-keys').getAttribute('aria-labelledby'), 'menu-keys-title');
        } else {
          assert.strictEqual(await page.locator('#menu-keys').isVisible(), false, seen);
        }
        assert.strictEqual(await page.locator('#menu-panes').isVisible(), true, seen);
        // Nothing in it is cut or sticks out.
        const bad = await page.evaluate(`[...document.querySelectorAll('#drawer .menu-item, #drawer .menu-h')].filter((b) => b.getClientRects().length && (b.scrollWidth > b.clientWidth + 1 || b.getBoundingClientRect().right > document.getElementById('drawer').getBoundingClientRect().right + 0.5)).map((b) => b.id || b.textContent)`);
        assert.deepStrictEqual(bad, [], seen);
        await ctx.close();
      }
    }
  });

  it('keeps the app bar to ≡, the logo, the pickers, the view and panel buttons, Copy a link, ⚙, GitHub and Install (from 1100 px), in one row', async () => {
    for (const [width, install] of [[1280, true], [1100, true], [1099, false], [800, false]] as const) {
      for (const locale of ['en-US', 'ja-JP']) {
        const { ctx, page } = await open({ viewport: { width, height: 800 }, locale });
        const seen = `${width} ${locale}`;
        assert.strictEqual(await page.locator('#install').isVisible(), install, seen);
        for (const id of ['#menu-open', '.brand', '#share', '#settings-open', '#github']) assert.strictEqual(await page.locator(id).isVisible(), true, `${seen} ${id}`);
        // Gone from the bar: the sample (⋯ and the menu have it), the file's name (the editor's header has it), the tagline.
        assert.strictEqual(await page.locator('.top #sample, .top #file-name, .top .tagline').count(), 0);
        const bar = await page.evaluate('(() => { const t = document.querySelector(".top"); return [t.getBoundingClientRect().height, t.scrollWidth <= t.clientWidth]; })()');
        assert.deepStrictEqual(bar, [48, true], seen);
        // Copy a link sits before ⚙, GitHub and Install, at the right.
        const xs = await Promise.all(['#share', '#settings-open', '#github'].map(async (s) => (await page.locator(s).boundingBox())!.x));
        assert.ok(xs[0] < xs[1] && xs[1] < xs[2], `${seen}: ${xs}`);
        await ctx.close();
      }
    }
  });

  it('gives the focus back without a ring after a pointer closes the menu, and with one after a key', async () => {
    const { ctx, page } = await open();
    const ring = () => page.evaluate("(() => { const e = document.activeElement; return [e.id, e.matches(':focus-visible') && getComputedStyle(e).outlineStyle !== 'none']; })()");
    await page.locator('#menu-open').click();
    await stable('the menu', () => page.locator('#drawer').boundingBox());
    await page.locator('#menu-close').click();
    await until('closed', () => page.locator('#drawer').evaluate((d) => (d as unknown as { open: boolean }).open), (v) => !v);
    await until('the focus back, no ring', ring, (r) => JSON.stringify(r) === JSON.stringify(['menu-open', false]));
    // The next key brings the ring back.
    await page.keyboard.press('Shift');
    assert.deepStrictEqual(await ring(), ['menu-open', true]);
    // Closed with Escape: the ring stays.
    await page.keyboard.press('Enter');
    await stable('the menu', () => page.locator('#drawer').boundingBox());
    await page.keyboard.press('Escape');
    await until('the focus back, a ring', ring, (r) => JSON.stringify(r) === JSON.stringify(['menu-open', true]));
    // ⋯ after a click on an item that leaves the focus to it: no ring on ⋯.
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base.slice(0, -1) });
    await page.locator('#ed-more').click();
    await page.locator('#more-copy').click();
    assert.deepStrictEqual(await ring(), ['ed-more', false]);
    await ctx.close();
  });
  it('does not end the rename when Enter confirms an IME conversion', async () => {
    const { ctx, page } = await open();
    await page.locator('#file-name').click();
    const input = page.locator('#file-name-input');
    await page.keyboard.insertText('かな');
    // The Enter that confirms a conversion: composing (Chromium) or keyCode 229 (Safari, after the composition ended).
    for (const init of [{ isComposing: true }, { keyCode: 229 }]) {
      const prevented = await input.evaluate((el, i) => {
        const e = new (globalThis as unknown as { KeyboardEvent: new (type: string, init: object) => Event }).KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...i });
        el.dispatchEvent(e);
        return e.defaultPrevented;
      }, init);
      assert.strictEqual(prevented, false);
      assert.strictEqual(await input.isVisible(), true);
      assert.strictEqual((await name(page)).text, 'untitled.sh');
    }
    // The next Enter, not composing, renames.
    await page.keyboard.press('Enter');
    await until('renamed', () => name(page), (n) => n.text === 'かな.sh');
    await ctx.close();
  });

  it('keeps the name within 255 characters and refuses "." and ".."', async () => {
    const { ctx, page } = await open();
    await page.locator('#file-name').click();
    assert.strictEqual(await page.locator('#file-name-input').getAttribute('maxlength'), '255');
    for (const bad of ['.', '..', ' .. ']) {
      await page.keyboard.press('Control+A');
      await page.keyboard.insertText(bad);
      await page.keyboard.press('Enter');
      assert.strictEqual((await name(page)).text, 'untitled.sh', bad);
      await page.locator('#file-name').click();
    }
    await page.keyboard.press('Escape');
    await ctx.close();
  });

  it('gives the file kind the name says, as opening a file of that name does; a name that says nothing keeps it', async () => {
    const { ctx, page } = await open();
    const kind = () => page.locator('#kind-menu').evaluate((el) => (el as unknown as { value: string }).value);
    const rename = async (to: string) => {
      await page.locator('#file-name').click();
      await page.keyboard.press('Control+A');
      await page.keyboard.insertText(to);
      await page.keyboard.press('Enter');
      await until(`renamed to ${to}`, () => name(page), (n) => n.text === to);
    };
    assert.strictEqual(await kind(), 'shell');
    for (const [to, want] of [['test.bats', 'bats'], ['Makefile', 'makefile'], ['x.py', 'python'], ['notes.txt', 'python'], ['run.sh', 'shell'], ['Dockerfile.dev', 'dockerfile']]) {
      await rename(to);
      await until(`kind of ${to}`, kind, (k) => k === want);
    }
    await ctx.close();
  });

  it('shows the same name wherever it shows one: Copy as Markdown and the panel say untitled.sh, as the header does', async () => {
    const { ctx, page } = await open({ viewport: { width: 390, height: 800 } });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base.slice(0, -1) });
    await page.locator('.cm-line').nth(7).click();
    await page.evaluate('navigator.clipboard.writeText("")');
    await page.locator('#menu-open').click();
    await page.locator('#menu-copy').click();
    const md = await until('the copy', () => page.evaluate('navigator.clipboard.readText()') as Promise<string>, (t) => t.length > 0);
    assert.match(md, /untitled\.sh:8/);
    assert.doesNotMatch(md, /script\.sh/);
    await ctx.close();
  });

  it('says so in the toast when the browser refuses to copy, and leaves no unhandled rejection', async () => {
    const { ctx, page } = await open();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.evaluate("navigator.clipboard.writeText = () => Promise.reject(new DOMException('refused', 'NotAllowedError'))");
    const refused = 'The browser did not let the page copy. Select the text and copy it yourself.';
    await page.locator('#share').click();
    await until('the toast', () => toast(page), (t) => t === refused);
    assert.strictEqual(await page.locator('#share').innerText(), 'Copy a link');
    await page.locator('#status').evaluate((el) => el.replaceChildren());
    await page.locator('#ed-more').click();
    await page.locator('#more-copy').click();
    await until('the toast', () => toast(page), (t) => t === refused);
    await page.waitForTimeout(200);
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  });

  it('clears the dot when an undo brings the text back to the saved one, and when a renamed file gets its own name back', async () => {
    const { ctx, page } = await open();
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText('echo one\n');
    await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+S')]);
    await until('saved', () => name(page), (n) => !n.draft);
    // (An edit within half a second of the one before joins its undo step.)
    await page.waitForTimeout(700);
    await page.keyboard.insertText('echo two\n');
    await until('the dot', () => name(page), (n) => n.dot);
    await page.keyboard.press('Control+Z');
    await until('no dot', () => name(page), (n) => !n.dot);
    // A rename marks the file, and the name it had clears the mark again.
    await page.locator('#file-name').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText('other.sh');
    await page.keyboard.press('Enter');
    assert.strictEqual((await name(page)).dot, true);
    await page.locator('#file-name').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText('untitled.sh');
    await page.keyboard.press('Enter');
    assert.deepStrictEqual(await name(page), { text: 'untitled.sh', draft: false, dot: false, label: 'Rename: untitled.sh' });
    await ctx.close();
  });

  it('keeps the menu\'s Save row free of the dot, and the keyboard-shortcut help reachable on a touch screen', async () => {
    const { ctx, page } = await open();
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+End');
    await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+S')]);
    await page.keyboard.insertText('x');
    await until('the dot', () => name(page), (n) => n.dot);
    await page.locator('#menu-open').click();
    assert.strictEqual(await page.locator('#menu-save-name').textContent(), 'untitled.sh');
    assert.strictEqual(await page.locator('#menu-file').textContent(), 'untitled.sh●');
    // The sentence that describes Copy a link is a description only, not text a screen reader reads on its own.
    assert.strictEqual(await page.locator('#share-note').evaluate((el) => (el as unknown as { hidden: boolean }).hidden), true);
    await ctx.close();
    const touch = await open({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true });
    await touch.page.locator('#menu-open').tap();
    // "Go to the explanation and back" stays (F6 has no key on a touch screen, but a screen reader can reach it); the list of keys goes.
    assert.strictEqual(await touch.page.locator('#menu-panes').isVisible(), true);
    assert.strictEqual(await touch.page.locator('#menu-keys').isVisible(), false);
    await touch.ctx.close();
  });
});
