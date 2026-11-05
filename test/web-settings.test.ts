// The web page: theme and settings, run for real in headless Chromium (the build, the server and the browser
// are shared by all test/web-*.test.ts files: test/support/site.ts). Skipped when no browser can start,
// unless $BASH_EXPLAINER_BROWSER is set (as in CI).
import * as assert from 'assert';
import * as fs from 'fs';
import type { Browser, Frame, Page } from 'playwright-core';
import { classicScrollbars, cursorToLine, FRAMES, MARK_READING, openSite, choose, currentShell, openSettingsSection, READ_MARK, ReadingPlace, readingMoved, setShell, problemList, problemsShown, settingControl, stable, until } from './support/site';

describe('the web page: theme and settings', function () {
  this.timeout(120000);
  let browser: Browser;
  let base = '';

  before(async function () {
    ({ browser, base } = await openSite(this));
  });

  it('has a theme switch (Auto, Light, Dark) that is remembered and works without storage', async () => {
    const LIGHT = 'rgb(255, 255, 255)';
    const DARK = 'rgb(31, 31, 31)';
    const bg = (p: Page | Frame) => p.evaluate('getComputedStyle(document.body).backgroundColor') as Promise<string>;
    const ctx = await browser.newContext({ colorScheme: 'dark' });
    const page = await ctx.newPage();
    await page.goto(base);
    await until('the panel', () => Promise.resolve(page.frames().find((f) => f.url().endsWith('/panel.html'))), (f) => !!f);
    const panel = () => page.frames().find((f) => f.url().endsWith('/panel.html'))!;
    // Auto follows the system, and the system changing.
    assert.strictEqual(await bg(page), DARK);
    await page.emulateMedia({ colorScheme: 'light' });
    assert.strictEqual(await bg(page), LIGHT);
    assert.strictEqual(await bg(panel()), LIGHT);
    // Dark is dark whatever the system says, in the editor and the panel too, and survives a reload.
    await choose(page, '#theme', 'dark');
    assert.strictEqual(await page.evaluate('document.documentElement.dataset.theme'), 'dark');
    assert.strictEqual(await bg(page), DARK);
    assert.strictEqual(await page.evaluate("getComputedStyle(document.querySelector('.cm-editor')).backgroundColor"), DARK);
    await until('the dark panel', () => bg(panel()), (c) => c === DARK);
    await page.reload();
    assert.strictEqual(await page.locator('#theme').inputValue(), 'dark');
    assert.strictEqual(await bg(page), DARK);
    await until('the dark panel after the reload', async () => bg(panel()), (c) => c === DARK);
    // Light, with the system dark.
    await page.emulateMedia({ colorScheme: 'dark' });
    await choose(page, '#theme', 'light');
    assert.strictEqual(await bg(page), LIGHT);
    await until('the light panel', () => bg(panel()), (c) => c === LIGHT);
    // The Japanese label.
    await choose(page, '#lang', 'ja');
    assert.strictEqual(await page.locator('#theme-label').textContent(), 'テーマ');
    // Auto again forgets the choice.
    await choose(page, '#theme', 'auto');
    assert.strictEqual(await page.evaluate('document.documentElement.dataset.theme'), undefined);
    assert.strictEqual(await bg(page), DARK);
    await ctx.close();

    // Storage that throws: the page works, as Auto, and the switch still changes the colours.
    const blocked = await browser.newContext({ colorScheme: 'dark' });
    await blocked.addInitScript("Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } });");
    const p2 = await blocked.newPage();
    const errors: string[] = [];
    p2.on('pageerror', (e) => errors.push(e.message));
    await p2.goto(base);
    assert.strictEqual(await bg(p2), DARK);
    await choose(p2, '#theme', 'light');
    assert.strictEqual(await bg(p2), LIGHT);
    assert.deepStrictEqual(errors, []);
    await blocked.close();
  });

  it('colours the editor and the panel alike, in the panel\'s palette, light and dark', async () => {
    const ctx = await browser.newContext({ locale: 'en-US', colorScheme: 'light' });
    // Settings kept by a build that had the colors setting (before 0.7.0): the key is ignored.
    await ctx.addInitScript("try { if (!localStorage.getItem('bash-explainer-settings')) localStorage.setItem('bash-explainer-settings', JSON.stringify({ colors: 'vscode' })); } catch {}");
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base);
    const panel = () => page.frames().find((f) => f.url().endsWith('/panel.html'))!;
    await until('the panel', () => Promise.resolve(panel()), (f) => !!f);
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText('grep -rn "x" f 2>&1');
    const colour = (loc: ReturnType<Page['locator']>) => (loc.first().evaluate(new Function('e', 'return getComputedStyle(e).color') as never) as Promise<string>);
    const both = async (kind: string) => [
      await until(`the ${kind} in the editor`, () => colour(page.locator(`.cm-bx-${kind}`)), (c) => !!c),
      await until(`the ${kind} in the panel`, async () => (await panel().locator(`.kind-${kind}`).count() ? colour(panel().locator(`.kind-${kind}`)) : ''), (c) => !!c),
    ];
    // The panel's palette (src/ui/palette.ts): orange options and blue commands, light, then dark.
    assert.deepStrictEqual(await both('option'), ['rgb(159, 92, 0)', 'rgb(159, 92, 0)']);
    assert.deepStrictEqual(await both('command'), ['rgb(1, 97, 248)', 'rgb(1, 97, 248)']);
    await page.emulateMedia({ colorScheme: 'dark' });
    await until('the dark option', async () => (await both('option')).join('|'), (c) => c === 'rgb(209, 134, 22)|rgb(209, 134, 22)');
    assert.deepStrictEqual(await both('command'), ['rgb(55, 148, 255)', 'rgb(55, 148, 255)']);
    // No palette to choose in the settings.
    await page.locator('#settings-open').click();
    assert.strictEqual(await page.locator('#setting-colors, [data-key="colors"]').count(), 0);
    await page.locator('#settings-done').click();
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  });

  it('shows the descriptions of the settings without VS Code-only Markdown (#bashExplainer.key# links, command links)', async () => {
    for (const locale of ['en-US', 'ja-JP']) {
      const ctx = await browser.newContext({ locale });
      const page = await ctx.newPage();
      await page.goto(base);
      await page.locator('#settings-open').click();
      // Every section unfolded, every description whole, with the setting names and without.
      for (const id of ['examples', 'checks', 'editor', 'data']) await page.locator(`#settings-fold-${id}`).click();
      for (const names of [false, true]) {
        if (names) await page.locator('#settings-show-keys').check();
        for (const more of await page.locator('.desc-more:visible').all()) await more.click();
        const body = await page.locator('.settings-body').innerText();
        assert.ok(!/#bashExplainer|\]\(|\*\*|`/.test(body), `${locale}: raw Markdown left in the dialog`);
        assert.strictEqual(/bashExplainer\.bashVersion/.test(body), names, `${locale}: the names only with "Show VS Code setting names"`);
      }
      await ctx.close();
    }
  });

  it('wraps long lines in the editor unless the editor.wrap setting is off: kept, exported, imported and reset', async () => {
    const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 360, height: 740 } });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base);
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    const long = `echo ${Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ')}`;
    await page.keyboard.insertText(`echo first\n${long}\necho last`);
    const metrics = () => page.evaluate(`(() => {
      const lines = document.querySelectorAll('.cm-line');
      const sc = document.querySelector('.cm-scroller');
      if (lines.length !== 3) return { height: 0, short: 0, over: false };
      return { height: lines[1].getBoundingClientRect().height, short: lines[0].getBoundingClientRect().height, over: sc.scrollWidth > sc.clientWidth + 1 };
    })()`) as Promise<{ height: number; short: number; over: boolean }>;
    // On by default: the long line wraps, and nothing scrolls sideways.
    const on = await until('the wrapped line', metrics, (m) => m.height > 0 && !m.over);
    assert.ok(on.height > on.short * 2 && !on.over, `on: wrapped, no horizontal scroll ${JSON.stringify(on)}`);
    // Clicking the start of the line puts the cursor on it, and the active line is the whole wrapped line.
    const box = (await page.locator('.cm-line').nth(1).boundingBox())!;
    await page.mouse.click(box.x + 2, box.y + 4);
    assert.match(await page.locator('.cm-activeLine').innerText(), /^echo word0 /);
    await page.locator('#settings-open').click();
    assert.strictEqual(await page.locator('#setting-editor-wrap').isChecked(), true);
    assert.match(await page.locator('[data-key="editor.wrap"]').innerText(), /Wrap long lines/);
    await page.locator('#setting-editor-wrap').uncheck();
    await page.locator('#settings-done').click();
    const off = await until('one row', metrics, (m) => m.over);
    assert.ok(off.over && off.height < off.short * 1.5, 'off: one row, scrolls sideways');
    // Kept across a reload, and in the export.
    await page.reload();
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText(`echo first\n${long}\necho last`);
    await until('one row after reload', metrics, (m) => m.height > 0 && m.over);
    await page.locator('#settings-open').click();
    assert.strictEqual(await page.locator('#setting-editor-wrap').isChecked(), false);
    const text = await page.evaluate('localStorage.getItem("bash-explainer-settings")') as string;
    assert.deepStrictEqual(JSON.parse(text), { 'bashExplainer.editor.wrap': false });
    await openSettingsSection(page, 'data');
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#settings-export').click()]);
    const file = await download.path();
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { 'bashExplainer.editor.wrap': false });
    // Reset turns it on again; importing the file turns it off.
    await page.locator('#settings-reset').click();
    assert.strictEqual(await page.evaluate('localStorage.getItem("bash-explainer-settings")'), null);
    assert.strictEqual(await page.locator('#setting-editor-wrap').isChecked(), true);
    await page.locator('#settings-done').click();
    await until('wrapped after the reset', metrics, (m) => !m.over);
    await page.locator('#settings-open').click();
    await page.locator('#settings-file').setInputFiles(file);
    await until('the import', () => page.locator('#setting-editor-wrap').isChecked(), (c) => !c);
    await page.locator('#settings-done').click();
    assert.ok((await metrics()).over);
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  });

  it('has a settings dialog: a change shows at once, stays in sync with the toolbar and the panel, is kept, and can be reset', async () => {
    const ctx = await browser.newContext({ locale: 'en-US' });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base);
    const panel = () => page.frames().find((f) => f.url().endsWith('/panel.html'))!;
    await until('the panel', () => Promise.resolve(panel()), (f) => !!f);
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText('#!/bin/bash\n[[ -f x ]] && for f in $(ls); do echo "$f"; done');
    const panelText = () => panel().locator('#main').innerText();
    await until('the pitfall', panelText, (t) => /The output of \$\(ls …\) is split/.test(t));
    // The pitfall is also a problem.
    await until('the pitfall as a problem', () => problemList(page), (t) => /for-over-ls-output/.test(t));

    // The dialog lists the settings that apply here, and none that do not.
    await page.locator('#settings-open').click();
    assert.strictEqual(await page.locator('#settings-dialog').isVisible(), true);
    assert.strictEqual(await page.locator('#setting-notes-pitfalls').isChecked(), true);
    assert.strictEqual(await page.locator('#setting-diagnostics-pitfalls').isChecked(), true);
    // The hover is here, with the page's own description (not VS Code's); how it follows the cursor is VS Code's only.
    assert.strictEqual(await page.locator('#setting-hover-enabled').count(), 1);
    assert.match(await page.locator('[data-key="hover.enabled"]').innerText(), /in a card, as VS Code's hover does[\s\S]*the browser keeps Ctrl\+K and Ctrl\+E/);
    assert.doesNotMatch(await page.locator('[data-key="hover.enabled"]').innerText(), /Explain Bash on Current Line/);
    assert.strictEqual(await page.locator('#setting-hover-followCursor').count(), 0);
    assert.match(await page.locator('.settings-elsewhere').innerText(), /hover\.followCursor/);
    assert.match(await page.locator('.settings-elsewhere').innerText(), /panel\.autoOpen/);
    // A note turned off goes from the explanation and from the problems at once.
    await page.locator('#setting-notes-pitfalls').uncheck();
    await until('no pitfall', panelText, (t) => !/Problems on this line/.test(t));
    await until('no pitfall problem', () => problemsShown(page), (shown) => !shown);
    // The shell: the script is checked for sh, and the panel's own menu says so.
    await (await settingControl(page, 'shell')).selectOption('sh');
    await until('the problem', () => problemList(page), (t) => /dbracket/.test(t));
    await until('the panel\'s shell', () => currentShell(page), (v) => v === 'sh');
    // A warning code left out.
    await page.locator('#setting-diagnostics-ignore').fill('dbracket');
    await page.locator('#setting-diagnostics-ignore-add').click();
    await until('no problem', () => problemsShown(page), (shown) => !shown);
    assert.match(await page.locator('[data-key="diagnostics.ignore"] .setting-list').innerText(), /dbracket/);
    // Examples off by kind.
    await openSettingsSection(page, 'examples');
    await page.locator('#setting-examples-disabled-regex').check();
    // The language follows the toolbar, and the other way round.
    await page.locator('#setting-language').selectOption('ja');
    assert.strictEqual(await page.locator('#lang').inputValue(), 'ja');
    assert.strictEqual(await page.locator('#settings-title').textContent(), '設定');
    await page.locator('#settings-done').click();
    await until('the dialog closed', () => page.locator('#settings-dialog').isVisible(), (v) => !v);
    await choose(page, '#lang', 'en');
    // The panel's header is not shown on the page; the shell is a setting, chosen in the editor header's chip.
    await until('the header hidden', () => panel().locator('header').isHidden(), (h) => h);
    await setShell(page, 'dash');
    await page.locator('#settings-open').click();
    await until('the dialog', () => page.locator('#settings-dialog').isVisible(), (v) => v);
    assert.strictEqual(await page.locator('#setting-shell').inputValue(), 'dash');
    assert.strictEqual(await page.locator('#setting-language').inputValue(), 'en');
    await page.keyboard.press('Escape');
    await until('the dialog closed', () => page.locator('#settings-dialog').isVisible(), (v) => !v);

    // Kept across a reload, as VS Code keys.
    assert.deepStrictEqual(JSON.parse(await page.evaluate('localStorage.getItem("bash-explainer-settings")') as string), {
      'bashExplainer.language': 'en', 'bashExplainer.notes.pitfalls': false, 'bashExplainer.shell': 'dash',
      'bashExplainer.diagnostics.ignore': ['dbracket'], 'bashExplainer.examples.disabled': ['regex'],
    });
    await page.reload();
    await until('the panel after the reload', () => Promise.resolve(panel()), (f) => !!f);
    await until('the shell after the reload', () => currentShell(page), (v) => v === 'dash');
    await page.locator('#settings-open').click();
    assert.strictEqual(await page.locator('#setting-notes-pitfalls').isChecked(), false);
    assert.strictEqual(await page.locator('#setting-examples-disabled-regex').isChecked(), true);
    // Reset: the defaults, and nothing kept.
    await page.locator('#settings-reset').click();
    assert.strictEqual(await page.locator('#setting-notes-pitfalls').isChecked(), true);
    assert.strictEqual(await page.locator('#setting-shell').inputValue(), 'auto');
    assert.strictEqual(await page.evaluate('localStorage.getItem("bash-explainer-settings")'), null);
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  });

  it('checks the JSON of customCommands as it is typed, and applies it when it is valid', async () => {
    const ctx = await browser.newContext({ locale: 'en-US' });
    const page = await ctx.newPage();
    await page.goto(base);
    const panel = () => page.frames().find((f) => f.url().endsWith('/panel.html'))!;
    await until('the panel', () => Promise.resolve(panel()), (f) => !!f);
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText('deploy web');
    await until('the line explained', () => panel().locator('#main').innerText(), (t) => /deploy/.test(t));
    const area = await settingControl(page, 'customCommands');
    await area.fill('{ "deploy": ');
    assert.match(await page.locator('#setting-customCommands-error').innerText(), /^Not applied: /);
    assert.strictEqual(await area.getAttribute('aria-invalid'), 'true');
    await area.fill('[]');
    assert.match(await page.locator('#setting-customCommands-error').innerText(), /expected an object/);
    // What is typed stays while another setting changes.
    await page.locator('#setting-notes-idioms').uncheck();
    assert.strictEqual(await area.inputValue(), '[]');
    await area.fill('{\n  // comments are allowed, as in settings.json\n  "deploy": { "summary": "Deploy to production" },\n}');
    assert.strictEqual(await page.locator('#setting-customCommands-error').isHidden(), true);
    assert.strictEqual(await area.getAttribute('aria-invalid'), 'false');
    await until('the command described', () => panel().locator('#main').innerText(), (t) => /Deploy to production/.test(t));
    const saved = JSON.parse(await page.evaluate('localStorage.getItem("bash-explainer-settings")') as string);
    assert.deepStrictEqual(saved['bashExplainer.customCommands'], { deploy: { summary: 'Deploy to production' } });
    await ctx.close();
  });

  it('exports the settings as a settings file, and imports one, saying which keys it left out', async () => {
    const ctx = await browser.newContext({ locale: 'en-US', acceptDownloads: true });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base.slice(0, -1) });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base);
    await (await settingControl(page, 'shell')).selectOption('sh');
    await page.locator('#setting-notes-pitfalls').uncheck();
    await (await settingControl(page, 'examples.disabled')).locator('#setting-examples-disabled-regex').check();
    await page.locator('#setting-customCommands').fill('{ "deploy": { "summary": "Deploy to production" } }');
    const saved = () => page.evaluate('localStorage.getItem("bash-explainer-settings")') as Promise<string | null>;
    const before = await saved();
    const expected = {
      'bashExplainer.notes.pitfalls': false, 'bashExplainer.shell': 'sh', 'bashExplainer.examples.disabled': ['regex'],
      'bashExplainer.customCommands': { deploy: { summary: 'Deploy to production' } },
    };
    // Export: the keys of settings.json, only those changed, pretty-printed.
    await openSettingsSection(page, 'data');
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#settings-export').click()]);
    assert.strictEqual(download.suggestedFilename(), 'bash-explainer-settings.json');
    const file = await download.path();
    const text = fs.readFileSync(file, 'utf8');
    assert.deepStrictEqual(JSON.parse(text), expected);
    assert.strictEqual(text, `${JSON.stringify(expected, null, 2)}\n`);
    assert.match(await page.locator('#settings-io-status').innerText(), /Downloaded bash-explainer-settings\.json/);
    // Copy gives the same text.
    await page.evaluate('navigator.clipboard.writeText("")');
    await page.locator('#settings-copy').click();
    assert.strictEqual(await until('the copied settings', () => page.evaluate('navigator.clipboard.readText()') as Promise<string>, (t) => t !== ''), text);
    // Round trip: reset, then import the exported file.
    await page.locator('#settings-reset').click();
    assert.strictEqual(await saved(), null);
    await page.locator('#settings-file').setInputFiles(file);
    await until('the import', () => page.locator('#settings-io-status').innerText(), (t) => /Imported 4 settings/.test(t));
    assert.strictEqual(await saved(), before);
    assert.strictEqual(await page.locator('#setting-shell').inputValue(), 'sh');
    assert.strictEqual(await page.locator('#setting-notes-pitfalls').isChecked(), false);
    // A file with keys that are not settings, not used here, or of the wrong type: the rest replaces the settings.
    await page.locator('#settings-file').setInputFiles({
      name: 'vscode.json', mimeType: 'application/json',
      buffer: Buffer.from('{\n  // from VS Code\n  "bashExplainer.shell": "dash",\n  "bashExplainer.hover.followCursor": true,\n  "editor.fontSize": 14,\n  "examples": { "placement": "nowhere" },\n}'),
    });
    const status = await until('the second import', () => page.locator('#settings-io-status').innerText(), (t) => /Imported 1 setting;/.test(t));
    assert.match(status, /editor\.fontSize — not a setting/);
    assert.match(status, /examples\.placement — wrong value \(expected one of first, last, bottom\)/);
    assert.match(status, /hover\.followCursor — not used on this page/);
    assert.strictEqual(await page.locator('#setting-shell').inputValue(), 'dash');
    assert.strictEqual(await page.locator('#setting-notes-pitfalls').isChecked(), true);
    const afterSecond = await saved();
    assert.deepStrictEqual(JSON.parse(afterSecond!), { 'bashExplainer.shell': 'dash' });
    // JSON that does not parse, pasted: an error, and nothing changes.
    await page.locator('#settings-paste summary').click();
    await page.locator('#settings-paste-text').fill('{ "bashExplainer.shell": ');
    await page.locator('#settings-paste-import').click();
    assert.match(await page.locator('#settings-io-status').innerText(), /^Not imported, nothing changed: /);
    assert.strictEqual(await saved(), afterSecond);
    await page.locator('#settings-paste-text').fill('["shell"]');
    await page.locator('#settings-paste-import').click();
    assert.match(await page.locator('#settings-io-status').innerText(), /nothing changed: expected an object of settings/);
    // Pasted JSON that is right.
    await page.locator('#settings-paste-text').fill('{ "shell": "ksh" }');
    await page.locator('#settings-paste-import').click();
    assert.strictEqual(await page.locator('#setting-shell').inputValue(), 'ksh');
    // A file dropped on the dialog.
    await page.evaluate(`(() => {
      const dt = new DataTransfer();
      dt.items.add(new File(['{ "bashExplainer.shell": "zsh" }'], 'drop.json', { type: 'application/json' }));
      document.getElementById('settings-dialog').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    })()`);
    await until('the dropped file', () => page.locator('#setting-shell').inputValue(), (v) => v === 'zsh');
    // Without a clipboard, the JSON is shown to copy by hand.
    await page.evaluate('navigator.clipboard.writeText = () => Promise.reject(new Error("denied"))');
    await page.locator('#settings-copy').click();
    await until('the fallback', () => page.locator('#settings-io-status').innerText(), (t) => /does not let the page copy/.test(t));
    assert.deepStrictEqual(JSON.parse(await page.locator('#settings-paste-text').inputValue()), { 'bashExplainer.shell': 'zsh' });
    // In Japanese.
    await page.locator('#setting-language').selectOption('ja');
    assert.strictEqual(await page.locator('#settings-export').textContent(), 'ファイルにエクスポート');
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  });

  it('keeps the settings sheet inside a phone screen, and works without storage', async () => {
    const { devices } = await import('playwright-core');
    const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'en-US' });
    await ctx.addInitScript("Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } });");
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base);
    await page.locator('#settings-open').tap();
    assert.match(await page.locator('.settings-intro').innerText(), /does not let the page keep them/);
    // Once it has slid in.
    await page.evaluate("Promise.all(document.getElementById('settings-dialog').getAnimations().map((a) => a.finished))");
    const fit = await page.evaluate(`(() => {
      const d = document.getElementById('settings-dialog').getBoundingClientRect();
      const body = document.querySelector('.settings-body');
      const out = [...document.querySelectorAll('#settings-dialog *')].filter((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && (r.left < d.left - 0.5 || r.right > d.right + 0.5);
      }).map((e) => e.tagName + (e.id ? '#' + e.id : ''));
      return { left: d.left, right: innerWidth - d.right, top: d.top, bottom: innerHeight - d.bottom, sideways: body.scrollWidth > body.clientWidth, page: document.documentElement.scrollWidth > innerWidth, out };
    })()`) as { left: number; right: number; top: number; bottom: number; sideways: boolean; page: boolean; out: string[] };
    // On a phone the settings take the whole screen, as a sheet.
    assert.deepStrictEqual(fit, { left: 0, right: 0, top: 0, bottom: 0, sideways: false, page: false, out: [] });
    // Without storage, a change still applies for as long as the page is open.
    await (await settingControl(page, 'shell')).selectOption('dash');
    const panel = page.frames().find((f) => f.url().endsWith('/panel.html'))!;
    await until('the menu\'s shell', () => currentShell(page), (v) => v === 'dash');
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  });

  /** The boxes of the sheet, the editor's pane, the divider, the explanation's pane and its frame. */
  type Box = { left: number; right: number; width: number; top: number; bottom: number };
  type Pt = { left: number; right: number; top: number };
  const boxes = (page: Page) => page.evaluate(`(() => {
    const r = (e) => { const b = e.getBoundingClientRect(); return { left: b.left, right: b.right, width: b.width, top: b.top, bottom: b.bottom }; };
    return { sheet: r(document.getElementById('settings-dialog')), pane: r(document.querySelector('main > .source')), split: r(document.getElementById('splitter')), side: r(document.getElementById('panel-pane')), panel: r(document.getElementById('panel')) };
  })()`) as Promise<Record<'sheet' | 'pane' | 'split' | 'side' | 'panel', Box>>;
  const isOpen = (page: Page) => page.locator('#settings-dialog').evaluate((d) => (d as unknown as { open: boolean }).open);
  /** Opens the sheet by the gear, and waits until it and the panes are at rest. */
  const opened = async (page: Page) => {
    await page.locator('#settings-open').click();
    await until('open', () => isOpen(page), (v) => v);
    await stable('at rest', () => boxes(page).then((b) => JSON.stringify(b)));
  };
  /** One frame of a move: the sheet's left edge, the gap to the pane beside it, the widths of the frame and of the editor's text, and whether the move waits for the long frame. */
  interface MoveFrame { left: number; gap: number; frame: number; text: number; held: boolean }
  /**
   * Runs `act` in the page and samples each frame after it, in one go inside the page, while the sheet is open: a sample from
   * outside would miss frames. `side` is what lies beside the sheet.
   */
  const framesWhile = (page: Page, act: string, side = '#panel-pane') => page.evaluate(`(async () => {
    const box = (e) => e.getBoundingClientRect();
    const sheet = document.getElementById('settings-dialog');
    const beside = document.querySelector('${side}');
    const frame = document.querySelector('main iframe');
    const text = document.querySelector('main .cm-editor');
    const out = [];
    ${act};
    const end = performance.now() + 900;
    while (performance.now() < end) {
      await new Promise((r) => requestAnimationFrame(r));
      if (sheet.open) out.push({ left: box(sheet).left, gap: box(sheet).left - box(beside).right, frame: box(frame).width, text: box(text).width, held: sheet.classList.contains('holding') });
    }
    return out;
  })()`) as Promise<MoveFrame[]>;

  it('opens from the right edge side by side, a third of the window, so that a change shows in the explanation while the sheet is open', async () => {
    // 768 px is the narrowest side by side (web/theme-init.js: up to 767 px, the narrow layout).
    for (const width of [1280, 768, 1920]) {
      const ctx = await browser.newContext({ locale: 'en-US', viewport: { width, height: 800 } });
      const page = await ctx.newPage();
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(base);
      const panel = () => page.frames().find((f) => f.url().endsWith('/panel.html'))!;
      await until('the panel', () => Promise.resolve(panel()), (f) => !!f);
      await page.locator('.cm-content').click();
      await page.keyboard.press('Control+A');
      await page.keyboard.insertText('#!/bin/bash\nfor f in $(ls); do echo "$f"; done');
      const panelText = () => panel().locator('#main').innerText();
      await until('the pitfall', panelText, (t) => /The output of \$\(ls …\) is split/.test(t));
      await page.locator('#settings-open').click();
      await stable('the sheet slid in', () => page.locator('#settings-dialog').evaluate((d) => d.getBoundingClientRect().left));
      const b = await boxes(page);
      const seen = `${width}: ${JSON.stringify(b)}`;
      // Along the right edge, below the top bar, as high as the editor's pane; the explanation lies beside it, to its left, uncovered
      // (the sheet comes from the right at every width: the gear that opens it is at the right).
      assert.ok(Math.abs(b.sheet.right - width) < 0.05 && b.sheet.top === b.pane.top && b.sheet.bottom === b.pane.bottom, seen);
      // The third column: a third of the window, up to 640 px, and the explanation touching it.
      assert.ok(Math.abs(b.sheet.width - Math.min(640, width / 3)) < 0.05, seen);
      assert.ok(Math.abs(b.side.right - b.sheet.left) < 0.05 && b.pane.left === 0, seen);
      const pad = await page.locator('#settings-dialog .settings-body').evaluate((e) => parseFloat(e.ownerDocument.defaultView!.getComputedStyle(e).paddingLeft));
      assert.strictEqual(pad, 16, seen);
      // Not a modal dialog: there is no backdrop, and the page behind it is not shut.
      assert.strictEqual(await page.locator('#settings-dialog').evaluate((d) => d.matches(':modal')), false, seen);
      // A change shows in the explanation at once, with the sheet still open.
      await page.locator('#setting-notes-pitfalls').uncheck();
      await until('no pitfall', panelText, (t) => !/Problems on this line/.test(t) && /for/.test(t));
      assert.strictEqual(await isOpen(page), true);
      // A click on the panel leaves the sheet open (decision 7: the panel stays in view and live).
      await page.mouse.click(b.panel.left + 40, 400);
      assert.strictEqual(await isOpen(page), true);
      assert.deepStrictEqual(errors, []);
      await ctx.close();
    }
    // In the narrow layout (a 640 px window, no touch), the settings take the whole screen, as on a phone.
    const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 640, height: 800 } });
    const page = await ctx.newPage();
    await page.goto(base);
    await page.locator('#settings-open').click();
    await stable('the sheet slid in', () => page.locator('#settings-dialog').evaluate((d) => d.getBoundingClientRect().left));
    const { sheet, side } = await boxes(page);
    assert.deepStrictEqual([sheet.left, sheet.width, sheet.top, sheet.bottom], [0, 640, 0, 800]);
    // (The panes do not make room there: the explanation lies below the editor, under the modal sheet.)
    assert.deepStrictEqual([side.left, side.right], [0, 640]);
    // There the sheet is modal, and Esc shuts it.
    assert.strictEqual(await page.locator('#settings-dialog').evaluate((d) => d.matches(':modal')), true);
    await page.keyboard.press('Escape');
    await until('the sheet closed', () => isOpen(page), (v) => !v);
    await ctx.close();
  });

  it('is a third column side by side: the editor and the explanation share what is left in their ratio, in view and in use, and closing gives back the same boxes', async function () {
    this.timeout(240000);
    // Each width, with the divider in the middle and towards both ends. 768 px is the narrowest side by side. The floors have a test of their own.
    for (const [width, split] of [[768, 50], [1024, 50], [1024, 33], [1280, 50], [1280, 30], [1280, 60], [1920, 50], [1920, 80], [2560, 50]] as const) {
      const ctx = await browser.newContext({ locale: 'en-US', viewport: { width, height: 700 } });
      await ctx.addInitScript(`try { localStorage.setItem('bash-explainer-split', JSON.stringify({ wide: ${split} })); } catch {}`);
      const page = await ctx.newPage();
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(base);
      const panel = () => page.frames().find((f) => f.url().endsWith('/panel.html'))!;
      await until('the panel', () => Promise.resolve(panel()), (f) => !!f);
      await page.locator('.cm-content').click();
      await page.keyboard.press('Control+A');
      await page.keyboard.insertText(`echo ${Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ')}`);
      await until('the rows', async () => panel().locator('#tree .row').count(), (n) => n > 40);
      const before = await boxes(page);
      const seen = `${width}/${split}: ${JSON.stringify(before)}`;
      await opened(page);
      const after = await boxes(page);
      const seenAfter = `${seen}\n after: ${JSON.stringify(after)}`;
      // A third of the window, up to 640 px, along the right edge.
      const sheet = Math.min(640, width / 3);
      assert.ok(Math.abs(after.sheet.width - sheet) < 0.05 && Math.abs(after.sheet.right - width) < 0.05, seenAfter);
      // Left to right, touching, with no gap and no overlap: the editor, the divider, the explanation, the sheet.
      assert.ok(Math.abs(after.pane.left) < 0.05 && Math.abs(after.pane.right - after.split.left) < 0.05 && Math.abs(after.split.right - after.side.left) < 0.05 && Math.abs(after.side.right - after.sheet.left) < 0.05, seenAfter);
      // The ratio stays: the share of the room each had before.
      assert.ok(Math.abs(after.pane.width - (split / 100) * (width - sheet)) < 1, seenAfter);
      assert.ok(Math.abs(before.pane.width - (split / 100) * width) < 1, seen);
      // The frame ends where it did, and is as wide as its pane at rest.
      assert.ok(Math.abs(after.panel.bottom - before.panel.bottom) < 0.01 && Math.abs(after.panel.width - after.side.width) < 0.05, seenAfter);
      // Each part is what the eye finds there, and takes the pointer.
      const top = await page.evaluate(`document.elementFromPoint(${after.panel.left + after.panel.width / 2}, ${after.panel.top + 120})?.id`);
      assert.strictEqual(top, 'panel', `${top}; ${seenAfter}`);
      const text = await page.evaluate(`!!document.elementFromPoint(${after.pane.left + after.pane.width / 2}, ${after.panel.top + 40})?.closest('.cm-editor')`);
      assert.strictEqual(text, true, seenAfter);
      for (const id of ['source', 'splitter']) assert.strictEqual(await page.evaluate(`document.getElementById('${id}').inert`), false, id);
      // The app bar and the sheet's top stay as they are.
      assert.strictEqual(await page.evaluate("document.querySelector('header.top').getBoundingClientRect().bottom"), await page.evaluate("document.getElementById('settings-dialog').getBoundingClientRect().top"));
      // A change made in the sheet shows in the explanation at once.
      await page.locator('#setting-notes-pitfalls').uncheck();
      await page.locator('#settings-open').click();
      await until('the sheet closed', () => isOpen(page), (v) => !v);
      await stable('at rest', () => boxes(page).then((b) => JSON.stringify(b)));
      // Back as it was: the same boxes, to the bit.
      assert.deepStrictEqual(await boxes(page), before, seen);
      assert.deepStrictEqual(errors, []);
      await ctx.close();
    }
  });
  it('moves the sheet and the panes as one on every frame of opening and closing, by every way to close, with the frame and the text at one width meanwhile', async function () {
    this.timeout(120000);
    const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 700 } });
    const page = await ctx.newPage();
    await page.goto(base);
    await page.locator('.cm-line').first().waitFor();
    const before = await boxes(page);
    const seen = (frames: MoveFrame[]) => JSON.stringify(frames);
    // Every frame of the move: no gap, no overlap, the left edge of the sheet going one way, the frame and the editor's text at the
    // width they have beside the sheet from the first move to the last.
    const movesAsOne = (frames: MoveFrame[], opening: boolean) => {
      const moved = frames.filter((f) => f.left > 1280 - 1280 / 3 + 0.5 && f.left < 1279.5);
      assert.ok(moved.length >= 5, seen(frames));
      assert.ok(frames.every((f) => Math.abs(f.gap) < 0.05), seen(frames));
      moved.forEach((f, i) => assert.ok(!i || (opening ? f.left <= moved[i - 1].left : f.left >= moved[i - 1].left), seen(frames)));
      for (const key of ['frame', 'text'] as const) assert.strictEqual(new Set(moved.map((f) => f[key].toFixed(1))).size, 1, `${key}: ${seen(frames)}`);
      assert.ok(Math.abs(moved[0].frame - (1280 - 1280 / 3) / 2 + 7) < 1, seen(frames));
      assert.ok(Math.abs(moved[0].text - (1280 - 1280 / 3) / 2) < 1, seen(frames));
    };
    let frames = await framesWhile(page, "document.getElementById('settings-open').click()");
    movesAsOne(frames, true);
    // The first frame, which rewraps the panes' text and draws the sheet, is before the move: it does not eat the start of it.
    assert.ok(frames[0].held && frames[0].left > 1279.5 && Math.abs(frames[0].frame - frames[frames.length - 1].frame) < 0.05, seen(frames));
    assert.ok(!frames[frames.length - 1].held, seen(frames));
    // (The value of the move is not inherited: a value the whole page inherits restyles it on every frame.)
    assert.strictEqual(await page.evaluate("getComputedStyle(document.getElementById('source')).getPropertyValue('--sheet-in')"), '0');
    await stable('at rest', () => boxes(page).then((b) => JSON.stringify(b)));
    const rest = await boxes(page);
    // At rest nothing holds a width of its own, and the sheet is no layer.
    assert.strictEqual(await page.evaluate("document.getElementById('panel').style.width + document.querySelector('.cm-editor').style.width"), '');
    assert.strictEqual(await page.evaluate("document.getElementById('settings-dialog').classList.contains('moving')"), false);
    // The gear, × and Close all slide it out, and Esc from the sheet.
    for (const close of ["document.getElementById('settings-open').click()", "document.getElementById('settings-close').click()", "document.getElementById('settings-done').click()"]) {
      frames = await framesWhile(page, close);
      movesAsOne(frames, false);
      await until('closed', () => isOpen(page), (v) => !v);
      await stable('at rest', () => boxes(page).then((b) => JSON.stringify(b)));
      assert.deepStrictEqual(await boxes(page), before);
      await opened(page);
      assert.deepStrictEqual(await boxes(page), rest);
    }
    // The gear again while it slides out: it comes back from where it was, with no jump.
    frames = await framesWhile(page, "(document.getElementById('settings-open').click(), setTimeout(() => document.getElementById('settings-open').click(), 90))");
    assert.ok(frames.every((f) => Math.abs(f.gap) < 0.05), seen(frames));
    for (let i = 1; i < frames.length; i++) assert.ok(Math.abs(frames[i].left - frames[i - 1].left) < 200, seen(frames));
    await stable('at rest', () => boxes(page).then((b) => JSON.stringify(b)));
    assert.strictEqual(await isOpen(page), true);
    assert.deepStrictEqual(await boxes(page), rest);
    await page.locator('#settings-open').click();
    await until('closed', () => isOpen(page), (v) => !v);
    await ctx.close();
  });

  it('has the sheet follow a swipe with the panes beside it on a touch screen side by side, and follows a window that is resized while it is open', async function () {
    this.timeout(120000);
    const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 700 }, hasTouch: true });
    const page = await ctx.newPage();
    await page.goto(base);
    await page.locator('.cm-line').first().waitFor();
    const before = await boxes(page);
    // A swipe towards the right edge: the panes go with the finger, and the sheet closes at the end of a long swipe and goes back
    // after a short one.
    await opened(page);
    const rest = await boxes(page);
    const cdp = await ctx.newCDPSession(page);
    const touch = (type: string, x?: number) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: x === undefined ? [] : [{ x, y: 300 }] } as never);
    await touch('touchStart', 900);
    for (let i = 1; i <= 4; i++) await touch('touchMove', 900 + i * 25);
    await until('the sheet followed the finger', () => page.locator('#settings-dialog').evaluate((d) => d.getBoundingClientRect().left), (x) => x >= rest.sheet.left + 90);
    await stable('the drag', () => page.locator('#settings-dialog').evaluate((d) => d.getBoundingClientRect().left));
    const dragged = await boxes(page);
    assert.ok(Math.abs(dragged.sheet.left - (rest.sheet.left + 100)) < 12, JSON.stringify(dragged.sheet));
    assert.ok(Math.abs(dragged.side.right - dragged.sheet.left) < 0.05 && dragged.side.right > rest.side.right + 90, JSON.stringify([dragged.sheet, dragged.side]));
    // (The explanation's frame waits at its width: a finger moves the boxes alone, as the slide does.)
    assert.ok(Math.abs(dragged.panel.width - rest.panel.width) < 0.05, JSON.stringify([dragged.panel, rest.panel]));
    await touch('touchEnd');
    // 100 px is more than 80: it closes.
    await until('the swipe closed the sheet', () => isOpen(page), (v) => !v);
    await stable('at rest', () => boxes(page).then((b) => JSON.stringify(b)));
    assert.deepStrictEqual(await boxes(page), before);
    await opened(page);
    await touch('touchStart', 900);
    for (let i = 1; i <= 3; i++) await touch('touchMove', 900 + i * 10);
    await touch('touchEnd');
    // A short swipe (30 px): the sheet and the panes go back to their places.
    await stable('back', () => boxes(page).then((b) => JSON.stringify(b)));
    assert.strictEqual(await isOpen(page), true);
    assert.deepStrictEqual(await boxes(page), rest);
    assert.strictEqual(await page.evaluate("document.getElementById('panel').style.width"), '');

    // A window resized while the sheet is open: the sheet and the panes follow at once, still side by side. In the page, at every
    // frame from before the resize on, the explanation's right edge is the sheet's left edge, and some frames are seen at all.
    const gapsWhile = (move: () => Promise<void>) => {
      const sampling = page.evaluate(`(async () => {
        const out = [];
        const end = performance.now() + 800;
        while (performance.now() < end) {
          const box = (id) => document.getElementById(id).getBoundingClientRect();
          out.push(Math.abs(box('settings-dialog').left - box('panel-pane').right));
          await new Promise((r) => requestAnimationFrame(r));
        }
        return out;
      })()`) as Promise<number[]>;
      return move().then(() => sampling);
    };
    for (const width of [900, 768, 1100, 1500]) {
      const gaps = await gapsWhile(() => page.setViewportSize({ width, height: 700 }));
      assert.ok(gaps.length >= 8 && gaps.every((g) => g < 0.05), `${width}: ${gaps.join()}`);
      const b = await stable('the resized boxes', () => boxes(page).then((x) => JSON.stringify(x))).then((x) => JSON.parse(x) as Awaited<ReturnType<typeof boxes>>);
      assert.ok(Math.abs(b.sheet.right - width) < 0.05 && Math.abs(b.sheet.width - Math.min(640, width / 3)) < 0.05 && b.pane.left === 0 && Math.abs(b.side.right - b.sheet.left) < 0.05, `${width}: ${JSON.stringify(b)}`);
    }
    await ctx.close();
  });

  it('keeps the row being read and the cursor\'s line in view when the sheet opens and closes, though the text rewraps', async function () {
    this.timeout(120000);
    const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 700 } });
    const page = await ctx.newPage();
    await page.goto(base);
    const panel = () => page.frames().find((f) => f.url().endsWith('/panel.html'))!;
    await until('the panel', () => Promise.resolve(panel()), (f) => !!f);
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    // A long script whose lines wrap in the narrower pane, the cursor far down on a long line.
    const long = `echo ${Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ')}`;
    await page.keyboard.insertText(Array.from({ length: 300 }, (_, i) => `echo line${i} with some more words to wrap in the editor when it is narrower than it is now`).join('\n') + `\n${long}\n`);
    await page.keyboard.press('ArrowUp');
    await until('the rows', async () => panel().locator('#tree .row').count(), (n) => n > 40);
    const cursorInView = () => page.evaluate(`(() => {
      const line = document.querySelector('.cm-activeLine');
      const box = document.querySelector('.cm-scroller').getBoundingClientRect();
      if (!line) return false;
      const b = line.getBoundingClientRect();
      return b.top >= box.top - 1 && b.top < box.bottom;
    })()`) as Promise<boolean>;
    assert.strictEqual(await cursorInView(), true);
    // A row with the focus, far down, stays where it is.
    await panel().evaluate(`(async () => {
      const row = document.querySelectorAll('#tree .row')[45];
      row.tabIndex = -1;
      window.scrollTo(0, 0);
      window.scrollTo(0, row.getBoundingClientRect().top - 300);
      row.focus({ preventScroll: true });
      window.kept = row;
      await ${FRAMES};
    })()`);
    const focusedAt = () => panel().evaluate("({ top: window.kept.getBoundingClientRect().top, under: document.getElementById('top').getBoundingClientRect().bottom })") as Promise<{ top: number; under: number }>;
    const was = await focusedAt();
    const near = (at: { top: number; under: number }, what: string) => assert.ok(Math.abs(at.top - was.top) <= 3, `${what}: ${JSON.stringify(at)} after ${JSON.stringify(was)}`);
    await opened(page);
    near(await stable('the row', focusedAt), 'opened');
    assert.strictEqual(await stable('the cursor\'s line', cursorInView), true, 'the cursor\'s line, opened');
    await page.locator('#settings-open').click();
    await until('closed', () => isOpen(page), (v) => !v);
    near(await stable('the row', focusedAt), 'closed');
    assert.strictEqual(await stable('the cursor\'s line', cursorInView), true, 'the cursor\'s line, closed');
    // A cursor the viewer has scrolled away from stays away: the sheet does not bring it back.
    await page.evaluate("document.querySelector('.cm-scroller').scrollTop = 0");
    await until('the cursor out of view', cursorInView, (v) => !v);
    await opened(page);
    assert.strictEqual(await stable('the cursor\'s line', cursorInView), false);
    await ctx.close();
  });

  const moved = (from: ReadingPlace, to: ReadingPlace, what: string) => assert.ok(readingMoved(from, to), `${what}: from ${JSON.stringify(from)} to ${JSON.stringify(to)}`);
  const stages = ['grep -v "^#"', "sed -e 's/foo/bar/g'", "awk '{ print $1, $3 }'", 'sort -u', 'cut -d: -f1,2', 'tr a-z A-Z', 'uniq -c', 'head -n 20', 'tail -n +2', 'wc -l'];
  const LONG_PIPELINE = `cat /var/log/app.log | ${Array.from({ length: 36 }, (_, i) => stages[i % stages.length]).join(' | ')}`;
  /** With no motion, so that a width is there at once: the slide changes the frame's width once, as this does. */
  const reading = async (script: string, line: number) => {
    const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.goto(base);
    await page.locator('.cm-line').first().waitFor();
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText(script);
    await cursorToLine(page, line);
    const panel = () => page.frames().find((f) => f.url().endsWith('/panel.html'))!;
    await until('the rows', async () => panel().locator('#tree .row').count(), (n) => n > 20);
    await stable('the height', () => panel().evaluate('document.documentElement.scrollHeight'));
    await panel().evaluate('document.activeElement.blur()');
    const go = async (y: number | string) => {
      await panel().evaluate(`(async () => { scrollTo({ top: ${y}, behavior: 'instant' }); await ${FRAMES}; })()`);
      return await panel().evaluate(MARK_READING) as ReadingPlace;
    };
    const after = async (act: string) => {
      await page.evaluate(`(async () => { ${act}; await ${FRAMES}; })()`);
      await panel().evaluate(FRAMES);
      return await panel().evaluate(READ_MARK) as ReadingPlace;
    };
    const step = (key: string) => `document.getElementById('splitter').dispatchEvent(new KeyboardEvent('keydown', { key: '${key}', shiftKey: true, bubbles: true, cancelable: true }))`;
    const gear = "document.getElementById('settings-open').click()";
    return { ctx, page, panel, go, after, step, gear };
  };

  it('keeps the text at the reading line in place when the panel\'s width changes: in a row that starts above it, between two rows, in a tall example, and at the ends', async function () {
    this.timeout(120000);
    const { ctx, panel, go, after, step, gear } = await reading(`${LONG_PIPELINE}\n`, 1);
    /** Each kind of place, as a scroll position that puts the reading line there. */
    const positions = await panel().evaluate(`(() => {
      const under = document.getElementById('top').getBoundingClientRect().bottom;
      const page = (e) => e.getBoundingClientRect().top + scrollY;
      const rows = [...document.querySelectorAll('#tree .row')].filter((r) => r.getClientRects().length);
      const tallRow = rows.reduce((a, b) => (b.offsetHeight > a.offsetHeight ? b : a));
      const gap = rows.findIndex((r, i) => i > 8 && rows[i + 1] && page(rows[i + 1]) - (page(r) + r.offsetHeight) > 4);
      const tall = [...document.querySelectorAll('#tree li > .item > :not(.row)')].filter((e) => e.getClientRects().length).reduce((a, b) => (b.offsetHeight > a.offsetHeight ? b : a));
      const at = (y) => y - under - 1;
      return {
        'a row that starts above the line': at(page(tallRow) + tallRow.offsetHeight * 0.6),
        'between two rows': at(page(rows[gap]) + rows[gap].offsetHeight + 2),
        'a tall example': at(page(tall) + tall.offsetHeight * 0.5),
        'a tall height': tall.offsetHeight,
        'the very bottom': document.documentElement.scrollHeight - innerHeight,
      };
    })()`) as Record<string, number>;
    assert.ok(positions['a tall height'] > 150, JSON.stringify(positions));
    const { 'a tall height': _, ...places } = positions;
    for (const [what, y] of Object.entries(places)) {
      const from = await go(y);
      assert.ok(from.y > 300, `${what}: ${JSON.stringify(from)}`);
      moved(from, await after(step('ArrowRight')), `${what}, a step narrower`);
      moved(from, await after(step('ArrowLeft')), `${what}, and back`);
      moved(from, await after(gear), `${what}, the settings opened`);
      moved(from, await after(gear), `${what}, the settings closed`);
    }
    // At the very top the page stays at its top, whatever grows under the sticky rows.
    await go(0);
    await after(gear);
    assert.strictEqual(await panel().evaluate('scrollY'), 0);
    await after(gear);
    assert.strictEqual(await panel().evaluate('scrollY'), 0);
    // A scroll of the viewer's own takes a new place: what comes next keeps that one, not the last.
    const first = await go(2000);
    await after(step('ArrowRight'));
    const second = await go(3000);
    assert.notStrictEqual(first.text + first.top, second.text + second.top + 1);
    moved(second, await after(step('ArrowLeft')), 'a place taken after the scroll');
    await ctx.close();
  });

  it('keeps the text at the reading line in place at every scroll position, on a long pipeline and on a line of the sample', async function () {
    this.timeout(180000);
    const sample = fs.readFileSync('test/fixtures/sample.sh', 'utf8');
    for (const [script, line, step] of [[`${LONG_PIPELINE}\n`, 1, 211], [sample, 8, 53]] as const) {
      const { ctx, panel, go, after, step: nudge, gear } = await reading(script, line);
      const end = await panel().evaluate('document.documentElement.scrollHeight - innerHeight') as number;
      assert.ok(end > 800, `the range: ${end}`);
      for (let y = 0; y < end + step; y += step) {
        const at = Math.min(y, end);
        const from = await go(at);
        // (At the very top the page stays at its top: below.)
        if (!from.y) continue;
        moved(from, await after(nudge('ArrowRight')), `${at}, a step narrower`);
        moved(from, await after(nudge('ArrowLeft')), `${at}, and back`);
        moved(await go(at), await after(gear), `${at}, the settings opened`);
        // (From where it started: the drift of a round trip.)
        const back = await after(gear);
        assert.ok(Math.abs(back.top - from.top) <= 2, `${at}, the settings closed: ${JSON.stringify(back)} after ${JSON.stringify(from)}`);
      }
      await ctx.close();
    }
  });

  /** What holds still while the sheet moves is let go: nothing of a move is left on the sheet or the panes. */
  const leftOfMove = (page: Page) => page.evaluate(`(() => ({
    sheet: document.getElementById('settings-dialog').className,
    frame: document.getElementById('panel').getAttribute('style'),
    text: document.querySelector('.cm-editor').getAttribute('style'),
  }))()`) as Promise<{ sheet: string; frame: string | null; text: string | null }>;
  const atRest = { sheet: 'sheet', frame: null, text: null };

  it('ends a move that never ran: asked to close and to open again before a frame is drawn, and the frame then fills its pane in any new width', async function () {
    this.timeout(60000);
    const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 700 } });
    const page = await ctx.newPage();
    await page.goto(base);
    await page.locator('.cm-line').first().waitFor();
    await opened(page);
    assert.deepStrictEqual(await leftOfMove(page), atRest);
    // (As two clicks that arrive together when the page has been busy: no style pass between them.)
    await page.evaluate(`(async () => {
      const gear = document.getElementById('settings-open');
      gear.click();
      await Promise.resolve();
      await Promise.resolve();
      gear.click();
    })()`);
    await until('the end of the move', () => leftOfMove(page), (v) => v.sheet === 'sheet');
    assert.deepStrictEqual(await leftOfMove(page), atRest);
    assert.strictEqual(await isOpen(page), true);
    await page.setViewportSize({ width: 800, height: 700 });
    const b = await stable('the resized boxes', () => boxes(page).then((x) => JSON.stringify(x))).then((x) => JSON.parse(x) as Awaited<ReturnType<typeof boxes>>);
    assert.ok(Math.abs(b.panel.width - b.side.width) < 1.5, JSON.stringify(b));
    // A browser that runs no transition of it at all, though it was not asked for reduced motion: no event will come.
    await page.locator('#settings-open').click();
    await until('closed', () => isOpen(page), (v) => !v);
    await page.addStyleTag({ content: 'main, #settings-dialog { transition: none !important; }' });
    await page.locator('#settings-open').click();
    await until('open', () => isOpen(page), (v) => v);
    await until('the end of the move', () => leftOfMove(page), (v) => v.sheet === 'sheet');
    assert.deepStrictEqual(await leftOfMove(page), atRest);
    await ctx.close();
  });

  it('ends a move when reduced motion comes on in the middle of it, opening and closing', async function () {
    this.timeout(60000);
    const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 700 } });
    const page = await ctx.newPage();
    await page.goto(base);
    await page.locator('.cm-line').first().waitFor();
    const before = await boxes(page);
    // (A slow move, so that it is still going when the switch comes.)
    await page.addStyleTag({ content: 'html { --sheet-time: 20s; }' });
    const going = () => page.locator('#settings-dialog').evaluate((d) => d.getAnimations().length > 0 && !d.classList.contains('holding'));
    await page.locator('#settings-open').click();
    await until('the sheet moving', going, (v) => v);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await until('the end of opening', () => leftOfMove(page), (v) => v.sheet === 'sheet', 3000);
    assert.deepStrictEqual(await leftOfMove(page), atRest);
    assert.strictEqual(await isOpen(page), true);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    // (Without the safety timer of closing: its own end, or nothing in the 20 s.)
    await page.evaluate(`(() => {
      const set = window.setTimeout;
      window.setTimeout = (f, ms, ...rest) => (ms === 500 ? 0 : set(f, ms, ...rest));
    })()`);
    await page.locator('#settings-open').click();
    await until('the sheet moving', going, (v) => v);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await until('the end of closing', () => isOpen(page), (v) => !v, 3000);
    await until('the end of closing', () => leftOfMove(page), (v) => v.sheet === 'sheet', 3000);
    assert.deepStrictEqual(await leftOfMove(page), atRest);
    assert.deepStrictEqual(await boxes(page).then((b) => [b.pane, b.side]), [before.pane, before.side]);
    await ctx.close();
  });

  it('lets go of a swipe when the window crosses to the narrow layout under the finger', async function () {
    this.timeout(60000);
    const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 700 }, hasTouch: true });
    const page = await ctx.newPage();
    await page.goto(base);
    await page.locator('.cm-line').first().waitFor();
    const before = await boxes(page);
    await opened(page);
    const cdp = await ctx.newCDPSession(page);
    const touch = (type: string, x?: number) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: x === undefined ? [] : [{ x, y: 300 }] } as never);
    await touch('touchStart', 900);
    for (let i = 1; i <= 4; i++) await touch('touchMove', 900 + i * 25);
    const held = () => page.evaluate(`[document.querySelector('main').style.getPropertyValue('--sheet-in'), document.getElementById('settings-dialog').style.getPropertyValue('--sheet-in'), document.getElementById('settings-dialog').className].join()`) as Promise<string>;
    await until('the hold', held, (v) => /dragging/.test(v));
    await page.setViewportSize({ width: 700, height: 700 });
    await until('the sheet modal', () => page.evaluate("document.getElementById('settings-dialog').matches(':modal')"), (v) => v === true);
    await until('the hold let go', held, (v) => v === ',,sheet');
    await touch('touchEnd').catch(() => undefined);
    // Back in the wide layout and closed: the page has the whole window again.
    await page.setViewportSize({ width: 1280, height: 700 });
    await until('the sheet beside the panes', () => page.evaluate("document.getElementById('settings-dialog').matches(':modal')"), (v) => v === false);
    assert.strictEqual(await held(), ',,sheet');
    await page.locator('#settings-open').click();
    await until('closed', () => isOpen(page), (v) => !v);
    await stable('at rest', () => boxes(page).then((b) => JSON.stringify(b)));
    assert.deepStrictEqual(await boxes(page).then((b) => [b.pane, b.side]), [before.pane, before.side]);
    await ctx.close();
  });

  it('keeps the share chosen when the divider did not move on the screen, and says what the divider shows while the sheet is open', async function () {
    this.timeout(60000);
    const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 768, height: 700 } });
    await ctx.addInitScript("try { if (!sessionStorage.getItem('stored')) { sessionStorage.setItem('stored', '1'); localStorage.setItem('bash-explainer-split', JSON.stringify({ wide: 15 })); } } catch {}");
    const page = await ctx.newPage();
    await page.goto(base);
    await page.locator('.cm-line').first().waitFor();
    const stored = () => page.evaluate("JSON.parse(localStorage.getItem('bash-explainer-split'))") as Promise<{ wide: number }>;
    const aria = () => page.locator('#splitter').evaluate((h) => ['valuemin', 'valuenow', 'valuemax'].map((a) => Number(h.getAttribute(`aria-${a}`))));
    assert.deepStrictEqual(await aria(), [15, 15, 85]);
    const shut = await boxes(page);
    assert.ok(Math.abs(shut.pane.width - 115.2) < 1, JSON.stringify(shut.pane));
    await opened(page);
    // Beside the sheet the editor holds its floor: 190 px of 512 is 37 %, and the divider goes as far as the panel's floor leaves it.
    const at = await boxes(page);
    assert.ok(Math.abs(at.pane.width - 190) < 1, JSON.stringify(at.pane));
    const full = at.sheet.left;
    const low = Math.round((190 / full) * 100);
    const high = Math.round(((full - at.split.width - 200) / full) * 100);
    assert.deepStrictEqual(await until('what it says', aria, (v) => v[1] === low), [low, low, high]);
    // A key, a press and a release, and a small move: against the floor nothing changes on the screen, so nothing is kept.
    await page.locator('#splitter').focus();
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Home');
    const x = at.split.left + at.split.width / 2;
    await page.mouse.move(x, 300);
    await page.mouse.down();
    await page.mouse.up();
    await page.mouse.down();
    await page.mouse.move(x - 1, 300);
    await page.mouse.up();
    assert.deepStrictEqual(await stored(), { wide: 15 });
    await page.locator('#settings-open').click();
    await until('closed', () => isOpen(page), (v) => !v);
    await stable('at rest', () => boxes(page).then((b) => JSON.stringify(b)));
    assert.ok(Math.abs((await boxes(page)).pane.width - 115.2) < 1, 'the share kept');
    assert.deepStrictEqual(await until('what it says, closed', aria, (v) => v[1] === 15), [15, 15, 85]);
    // A move that shows takes its value from where the divider is shown.
    await opened(page);
    await page.locator('#splitter').focus();
    await page.keyboard.press('ArrowRight');
    assert.ok(Math.abs((await stored()).wide - ((190 / full) * 100 + 5)) < 0.01, JSON.stringify(await stored()));
    assert.strictEqual((await aria())[1], low + 5);
    await ctx.close();
  });

  it('keeps the editor\'s ⋯ menu in the window, and the Problems strip in its pane, at every width of the editor beside the settings', async function () {
    this.timeout(180000);
    const sample = fs.readFileSync('test/fixtures/sample.sh', 'utf8');
    for (const locale of ['en-US', 'ja-JP']) {
      const ctx = await browser.newContext({ locale, viewport: { width: 1280, height: 700 } });
      const page = await ctx.newPage();
      await page.goto(base);
      await page.locator('.cm-line').first().waitFor();
      await page.locator('.cm-content').click();
      await page.keyboard.press('Control+A');
      // Counts of two digits at each level, and a problem chosen, so that its place shows.
      await page.keyboard.insertText(sample.repeat(11));
      await until('the counts', () => page.locator('#problems-counts .count').allTextContents(), (c) => c.length === 3 && c.every((n) => /\d\d/.test(n)));
      await page.keyboard.press('F8');
      await until('the place', () => page.locator('#problem-pos-text').textContent(), (t) => !!t);
      for (const [width, split, sheet] of [[768, 'Enter', true], [900, 'Enter', true], [768, 'Home', true], [1280, 'Enter', true], [1280, 'Home', false], [1000, 'Home', false], [768, 'Home', false]] as const) {
        await page.setViewportSize({ width, height: 700 });
        if ((await isOpen(page)) !== sheet) await page.evaluate("document.getElementById('settings-open').click()");
        await until('the sheet', () => page.locator('#settings-dialog').evaluate((d) => (d as unknown as { open: boolean }).open && !d.classList.contains('moving')), (v) => v === sheet);
        await page.locator('#splitter').focus();
        await page.keyboard.press(split);
        await stable('at rest', () => boxes(page).then((b) => JSON.stringify(b)));
        const seen = `${locale} ${width} ${split} ${sheet}`;
        const strip = await page.evaluate(`(() => {
          const r = (e) => e.getBoundingClientRect();
          const st = document.querySelector('.problems-strip');
          const box = r(document.getElementById('problems-counts'));
          const shown = [...document.querySelectorAll('#problems-counts .count')].filter((c) => r(c).top < box.bottom - 1 && r(c).right <= box.right + 0.5);
          return {
            over: st.scrollWidth - st.clientWidth, pane: r(document.querySelector('main > .source')).right,
            order: ['#problems-toggle', '#problem-pos', '#problem-prev', '#problem-next'].map((q) => [r(document.querySelector(q)).left, r(document.querySelector(q)).right]),
            counts: box.right, shown: shown.length, said: document.getElementById('problems-said').textContent,
          };
        })()`) as { over: number; pane: number; order: [number, number][]; counts: number; shown: number; said: string };
        const said = `${seen}: ${JSON.stringify(strip)}`;
        assert.ok(strip.over <= 0, said);
        // In one row, none over the next, and what is dropped goes whole, down to the highest level: the pane's edge cuts nothing.
        strip.order.forEach(([, right], i) => assert.ok(right <= (strip.order[i + 1]?.[0] ?? strip.pane) + 0.5, said));
        assert.ok(strip.counts <= strip.order[1][0] + 0.5, said);
        if (sheet) assert.ok(strip.shown >= 1, said);
        // A screen reader has them all.
        assert.ok(/11.*55.*77/.test(strip.said), said);
        await page.locator('#ed-more').click();
        const menu = await page.evaluate(`(() => {
          const m = document.getElementById('ed-more-menu');
          const b = m.getBoundingClientRect();
          const on = (x, y) => m.contains(document.elementFromPoint(x, y));
          return { left: b.left, right: b.right, on: [on(b.left + 12, b.top + 20), on(b.right - 12, b.top + 20), on(b.left + 12, b.bottom - 20), on(b.right - 12, b.bottom - 20)] };
        })()`) as { left: number; right: number; on: boolean[] };
        assert.ok(menu.left >= 0 && menu.right <= width, `${seen}: ${JSON.stringify(menu)}`);
        assert.deepStrictEqual(menu.on, [true, true, true, true], seen);
        await page.keyboard.press('Escape');
      }
      await ctx.close();
    }
    // With nothing to count, the words stay.
    const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 768, height: 700 } });
    await ctx.addInitScript(`try { localStorage.setItem('bash-explainer-split', ${JSON.stringify(JSON.stringify({ wide: 15 }))}); } catch {}`);
    const page = await ctx.newPage();
    await page.goto(base);
    await page.locator('.cm-line').first().waitFor();
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText('echo hello\n');
    await until('no problems', () => page.locator('#problems').getAttribute('class'), (c) => !!c?.includes('empty'));
    await opened(page);
    assert.strictEqual(await page.locator('#problems-title').isVisible(), true);
    await ctx.close();
  });

  it('makes room for the sheet on the compare page too: the script and the two copies share what is left, and it takes the whole window up to 1000 px', async function () {
    this.timeout(120000);
    const compare = `${base}compare.html`;
    const rects = (page: Page) => page.evaluate(`(() => {
      const r = (id) => { const b = document.getElementById(id).getBoundingClientRect(); return { left: b.left, right: b.right, width: b.width, top: b.top, bottom: b.bottom }; };
      return { sheet: r('settings-dialog'), pane: (({ left, right, width, top, bottom }) => ({ left, right, width, top, bottom }))(document.querySelector('.compare > .source').getBoundingClientRect()), this: r('col-this'), other: r('col-other'), modal: document.getElementById('settings-dialog').matches(':modal') };
    })()`) as Promise<{ sheet: Box; pane: Box; this: Box; other: Box; modal: boolean }>;
    for (const width of [1001, 1280, 1920]) {
      const ctx = await browser.newContext({ locale: 'en-US', viewport: { width, height: 800 } });
      const page = await ctx.newPage();
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(compare);
      await page.locator('.cm-line').first().waitFor();
      const before = await rects(page);
      const frames = await framesWhile(page, "document.getElementById('settings-open').click()", '#col-other');
      assert.ok(frames.length >= 8 && frames.every((f) => Math.abs(f.gap) < 0.05), JSON.stringify(frames.map((f) => f.gap)));
      await stable('at rest', () => rects(page).then((x) => JSON.stringify(x)));
      const open = await rects(page);
      const seen = `${width}: ${JSON.stringify(before)}\n ${JSON.stringify(open)}`;
      const sheet = Math.min(640, width / 3);
      assert.strictEqual(open.modal, false, seen);
      assert.ok(Math.abs(open.sheet.width - sheet) < 0.05 && Math.abs(open.sheet.right - width) < 0.05, seen);
      // Three equal columns in what is left, as they were in the whole, touching, and the sheet touching the last.
      for (const key of ['pane', 'this', 'other'] as const) assert.ok(Math.abs(open[key].width - (width - sheet) / 3) < 1, `${key}: ${seen}`);
      assert.ok(Math.abs(open.pane.left) < 0.05 && Math.abs(open.pane.right - open.this.left) < 0.05 && Math.abs(open.this.right - open.other.left) < 0.05 && Math.abs(open.other.right - open.sheet.left) < 0.05, seen);
      // What is shown is what the eye finds there.
      for (const id of ['frame-this', 'frame-other']) {
        const hit = await page.evaluate(`(() => { const b = document.getElementById('${id}').getBoundingClientRect(); return document.elementFromPoint(b.left + b.width / 2, b.top + 100)?.id; })()`);
        assert.strictEqual(hit, id, seen);
      }
      // Back as it was.
      await page.locator('#settings-open').click();
      await until('the sheet closed', () => isOpen(page), (v) => !v);
      await stable('at rest', () => rects(page).then((x) => JSON.stringify(x)));
      assert.deepStrictEqual({ ...(await rects(page)), sheet: before.sheet }, before, seen);
      assert.deepStrictEqual(errors, []);
      await ctx.close();
    }
    // Up to 1000 px the script lies above the copies: there is no third column, so the sheet takes the whole window, as a modal dialog.
    for (const width of [1000, 768]) {
      const ctx = await browser.newContext({ locale: 'en-US', viewport: { width, height: 800 } });
      const page = await ctx.newPage();
      await page.goto(compare);
      await page.locator('.cm-line').first().waitFor();
      const before = await rects(page);
      await page.locator('#settings-open').click();
      await stable('the sheet slid in', () => page.locator('#settings-dialog').evaluate((d) => d.getBoundingClientRect().left));
      const open = await rects(page);
      assert.strictEqual(open.modal, true, JSON.stringify(open));
      assert.deepStrictEqual([open.sheet.left, open.sheet.width, open.sheet.top, open.sheet.bottom], [0, width, 0, 800]);
      assert.deepStrictEqual([open.this, open.other], [before.this, before.other]);
      await page.keyboard.press('Escape');
      await until('the sheet closed', () => isOpen(page), (v) => !v);
      await ctx.close();
    }
    // A window crossing 1000 px with the sheet open: it opens again in the other kind.
    const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    await page.goto(compare);
    await page.locator('.cm-line').first().waitFor();
    await page.locator('#settings-open').click();
    await stable('the sheet slid in', () => page.locator('#settings-dialog').evaluate((d) => d.getBoundingClientRect().left));
    assert.strictEqual((await rects(page)).modal, false);
    await page.setViewportSize({ width: 900, height: 800 });
    await until('modal', async () => (await rects(page)).modal, (v) => v);
    await page.setViewportSize({ width: 1100, height: 800 });
    await until('beside', async () => (await rects(page)).modal, (v) => !v);
    await stable('at rest', () => rects(page).then((x) => JSON.stringify(x)));
    const b = await rects(page);
    assert.ok(Math.abs(b.pane.left) < 0.05 && Math.abs(b.other.right - b.sheet.left) < 0.05, JSON.stringify(b));
    await ctx.close();
  });

  it('keeps the sheet a modal dialog inside the window where the compare page scrolls, with classic scrollbars: no cut text, out to the right, the page behind still, the gear in view after', async function () {
    this.timeout(120000);
    // (The default browser hides its scrollbars, and so hides how much room a scrollbar takes: this one draws them.)
    const classic = await classicScrollbars(this);
    for (const [path, width] of [['compare.html', 900], ['compare.html', 767], ['compare.html', 500], ['', 767], ['', 500]] as const) {
      const ctx = await classic.newContext({ locale: 'en-US', viewport: { width, height: 700 } });
      const page = await ctx.newPage();
      await page.goto(`${base}${path}`);
      await page.locator('.cm-line').first().waitFor();
      const seen = `${path || 'index'} at ${width}`;
      await page.locator('#settings-open').click();
      await stable('the sheet slid in', () => page.locator('#settings-dialog').evaluate((d) => d.getBoundingClientRect().left));
      const at = (await page.evaluate(`(() => {
        const r = (e) => { const b = e.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top }; };
        const d = document.getElementById('settings-dialog');
        return { modal: d.matches(':modal'), sheet: r(d), jump: r(d.querySelector('.settings-jump')), close: r(document.getElementById('settings-close')), room: document.documentElement.clientWidth, bar: window.innerWidth - document.documentElement.clientWidth };
      })()`)) as { modal: boolean; sheet: Pt; jump: Pt; close: Pt; room: number; bar: number };
      assert.strictEqual(at.modal, true, seen);
      // The whole window, from its left edge to the right one, with no scrollbar left beside it: nothing is cut at the left.
      assert.deepStrictEqual([at.sheet.left, at.sheet.right, at.bar], [0, width, 0], `${seen}: ${JSON.stringify(at)}`);
      assert.ok(at.jump.left >= 0 && at.close.right <= width, `${seen}: ${JSON.stringify(at)}`);
      // A wheel over the sheet's head does not scroll the page behind it.
      await page.mouse.move(width / 2, 30);
      await page.mouse.wheel(0, 400);
      assert.strictEqual(await stable('the page', () => page.evaluate('window.scrollY')), 0, seen);
      // × slides it out to the right, the edge it came from.
      const out = await page.evaluate(`(() => { document.getElementById('settings-close').click(); return document.getElementById('settings-dialog').style.transform; })()`);
      assert.strictEqual(out, 'translateX(100%)', seen);
      await until('the sheet closed', () => isOpen(page), (v) => !v);
      // Opened again and shut by Esc: the gear, which has the focus, is in view.
      await page.locator('#settings-open').click();
      await until('the sheet open', () => isOpen(page), (v) => v);
      await page.keyboard.press('Escape');
      await until('the sheet closed by Esc', () => isOpen(page), (v) => !v);
      const gear = await page.evaluate(`(() => { const b = document.getElementById('settings-open').getBoundingClientRect(); return { focused: document.activeElement.id, top: b.top, scroll: window.scrollY }; })()`) as { focused: string; top: number; scroll: number };
      assert.deepStrictEqual([gear.focused, gear.top >= 0, gear.scroll], ['settings-open', true, 0], `${seen}: ${JSON.stringify(gear)}`);
      // The page scrolls again once the sheet is gone.
      if (path) assert.strictEqual(await page.evaluate('(scrollTo(0, 300), scrollY)'), 300, seen);
      await ctx.close();
    }
  });

  it('holds the panes\' floors beside the sheet, each giving up width to the other only there', async function () {
    this.timeout(120000);
    // The panes keep their ratio until one would go below its floor (page.css: 190 px, 200 px).
    for (const [width, share, editor, side] of [[768, 50, 256, 249], [768, 37, 190, 315], [768, 15, 190, 315], [768, 60, 305, 200], [768, 85, 305, 200], [1280, 15, 190, 656.33], [1280, 85, 646.33, 200]] as const) {
      const ctx = await browser.newContext({ locale: 'en-US', viewport: { width, height: 700 } });
      await ctx.addInitScript(`try { localStorage.setItem('bash-explainer-split', JSON.stringify({ wide: ${share} })); } catch {}`);
      const page = await ctx.newPage();
      await page.goto(base);
      await page.locator('.cm-line').first().waitFor();
      const before = await boxes(page);
      await opened(page);
      const b = await boxes(page);
      const seen = `${width} px, ${share} %: ${JSON.stringify(b)}`;
      assert.strictEqual(await page.evaluate("document.getElementById('settings-dialog').matches(':modal')"), false, seen);
      assert.ok(Math.abs(b.pane.width - editor) < 1.5 && Math.abs(b.side.width - side) < 1.5, seen);
      assert.ok(Math.abs(b.pane.left) < 0.05 && Math.abs(b.side.right - b.sheet.left) < 0.05, seen);
      await page.locator('#settings-open').click();
      await until('closed', () => isOpen(page), (v) => !v);
      await stable('at rest', () => boxes(page).then((x) => JSON.stringify(x)));
      // The share chosen is what comes back.
      assert.deepStrictEqual(await boxes(page), before, seen);
      await ctx.close();
    }
  });

  it('keeps the divider live while the sheet is open: dragged or moved with the keys, the panes follow, up to their floors, and closing keeps the new share', async function () {
    this.timeout(60000);
    const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 700 } });
    const page = await ctx.newPage();
    await page.goto(base);
    await page.locator('.cm-line').first().waitFor();
    await opened(page);
    const at = await boxes(page);
    const room = at.sheet.left;
    const drag = async (from: number, to: number) => {
      await page.mouse.move(from, 300);
      await page.mouse.down();
      await page.mouse.move((from + to) / 2, 300);
      await page.mouse.move(to, 300);
      await page.mouse.up();
    };
    // Dragged: the divider follows the pointer, and the panes touch it and the sheet.
    await drag(at.split.left + 3, 300);
    let b = await boxes(page);
    assert.ok(Math.abs(b.split.left + 3 - 300) < 1.5 && Math.abs(b.pane.right - b.split.left) < 0.05 && Math.abs(b.split.right - b.side.left) < 0.05 && Math.abs(b.side.right - b.sheet.left) < 0.05, JSON.stringify(b));
    assert.ok(Math.abs(b.sheet.left - room) < 0.05, JSON.stringify(b));
    // Past a floor it stops at the floor, and it answers at once on the way back: the share does not run on unseen.
    await drag(b.split.left + 3, 40);
    b = await boxes(page);
    assert.ok(Math.abs(b.pane.width - 190) < 1, JSON.stringify(b));
    await page.locator('#settings-open').click();
    await until('closed', () => isOpen(page), (v) => !v);
    await stable('at rest', () => boxes(page).then((x) => JSON.stringify(x)));
    assert.ok(Math.abs((await boxes(page)).pane.width - (190 / room) * 1280) < 1, 'the share stopped at the floor');
    await opened(page);
    b = await boxes(page);
    await drag(b.split.left + 3, b.split.left + 53);
    const back = await boxes(page);
    assert.ok(Math.abs(back.pane.width - 240) < 1.5, JSON.stringify(back));
    // Moved with the keys.
    await page.locator('#splitter').focus();
    await page.keyboard.press('ArrowRight');
    b = await boxes(page);
    assert.ok(Math.abs(b.pane.width - (240 + 0.05 * room)) < 2, JSON.stringify(b));
    const share = b.pane.width / room;
    // Closing: the same share of the whole page, and the sheet's own column is gone.
    await page.locator('#settings-open').click();
    await until('closed', () => isOpen(page), (v) => !v);
    await stable('at rest', () => boxes(page).then((x) => JSON.stringify(x)));
    b = await boxes(page);
    assert.ok(Math.abs(b.pane.width - share * 1280) < 1.5 && Math.abs(b.side.right - 1280) < 0.05, JSON.stringify(b));
    await ctx.close();
  });

  it('puts the focus back on the setting that had it when the window crosses between the layouts with the sheet open', async function () {
    this.timeout(60000);
    const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 1100, height: 800 } });
    const page = await ctx.newPage();
    await page.goto(`${base}compare.html`);
    await page.locator('.cm-line').first().waitFor();
    await page.locator('#settings-open').click();
    await stable('the sheet slid in', () => page.locator('#settings-dialog').evaluate((d) => d.getBoundingClientRect().left));
    for (const [width, modal] of [[900, true], [1100, false], [900, true]] as const) {
      await page.locator('#setting-notes-pitfalls').focus();
      await page.setViewportSize({ width, height: 800 });
      await until(`${width} px`, () => page.evaluate("document.getElementById('settings-dialog').matches(':modal')") as Promise<boolean>, (v) => v === modal);
      assert.strictEqual(await page.evaluate('document.activeElement.id'), 'setting-notes-pitfalls', `${width} px`);
    }
    await ctx.close();
  });

  it('closes the sheet like any close when the window crosses between the layouts while it slides out: what was typed in it is gone, the focus is back on the gear', async function () {
    this.timeout(60000);
    const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 1100, height: 800 } });
    const page = await ctx.newPage();
    await page.goto(`${base}compare.html`);
    await page.locator('.cm-line').first().waitFor();
    // Without a clipboard the settings come out as text to copy by hand: a status and a paste box with their text.
    await page.evaluate('navigator.clipboard.writeText = () => Promise.reject(new Error("denied"))');
    await page.locator('#settings-open').click();
    await stable('the sheet slid in', () => page.locator('#settings-dialog').evaluate((d) => d.getBoundingClientRect().left));
    await openSettingsSection(page, 'data');
    await page.locator('#settings-copy').click();
    await until('the status', () => page.locator('#settings-io-status').innerText(), (t) => t !== '');
    assert.notStrictEqual(await page.locator('#settings-paste-text').inputValue(), '');
    // × starts the slide out; the animation is held there while the window crosses 1000 px.
    await page.evaluate(`(async () => {
      const set = window.setTimeout;
      window.setTimeout = (f, ms, ...rest) => (ms === 500 ? 0 : set(f, ms, ...rest));
      try {
        document.getElementById('settings-close').click();
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        for (const a of document.getAnimations()) a.pause();
      } finally {
        window.setTimeout = set;
      }
    })()`);
    assert.strictEqual(await page.evaluate("document.getElementById('settings-dialog').classList.contains('closing')"), true);
    await page.setViewportSize({ width: 900, height: 800 });
    await page.evaluate('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))');
    await page.evaluate('for (const a of document.getAnimations()) a.finish()');
    await until('the sheet closed', () => isOpen(page), (v) => !v);
    // Closed as it would be without the crossing: the focus is on the gear, and it opens again with nothing left of before.
    await until('the focus on the gear', () => page.evaluate('document.activeElement.id') as Promise<string>, (id) => id === 'settings-open');
    await page.locator('#settings-open').click();
    await until('open again', () => isOpen(page), (v) => v);
    assert.strictEqual(await page.locator('#settings-io-status').innerText(), '');
    assert.strictEqual(await page.locator('#settings-paste-text').inputValue(), '');
    assert.strictEqual(await page.locator('#settings-paste').evaluate((d) => (d as unknown as { open: boolean }).open), false);
    await ctx.close();
  });

  it('crosses 768 px with the sheet open, both ways: the panes make room only while the sheet is beside them, and go with it', async function () {
    this.timeout(60000);
    const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 1000, height: 700 } });
    const page = await ctx.newPage();
    await page.goto(base);
    await page.locator('.cm-line').first().waitFor();
    const modal = () => page.evaluate("document.getElementById('settings-dialog').matches(':modal')") as Promise<boolean>;
    await opened(page);
    for (const [width, narrow] of [[700, true], [1000, false], [700, true], [1000, false]] as const) {
      await page.setViewportSize({ width, height: 700 });
      await until(`${width} px`, modal, (v) => v === narrow);
      await stable('at rest', () => boxes(page).then((b) => JSON.stringify(b)));
      const b = await boxes(page);
      // (The narrow layout: the panes one above the other, the whole window wide.)
      if (narrow) assert.ok(Math.abs(b.side.right - width) < 0.5 && Math.abs(b.sheet.left) < 0.5, JSON.stringify(b));
      else assert.ok(Math.abs(b.side.right - b.sheet.left) < 0.05 && b.pane.left === 0 && Math.abs(b.sheet.right - width) < 0.05, JSON.stringify(b));
    }
    // Narrow to wide: the panes and the sheet come together, not one at once and the other sliding. The gap between them is
    // sampled in the page, frame by frame, from before the window changes (a sample started after a round trip could
    // begin when the move is over), at every frame the sheet is beside them.
    await page.setViewportSize({ width: 700, height: 700 });
    await until('narrow', modal, (v) => v);
    await stable('at rest', () => boxes(page).then((b) => JSON.stringify(b)));
    const sampling = page.evaluate(`(async () => {
      const out = [];
      const end = performance.now() + 1000;
      const d = document.getElementById('settings-dialog');
      while (performance.now() < end) {
        if (!d.matches(':modal')) out.push(Math.abs(d.getBoundingClientRect().left - document.getElementById('panel-pane').getBoundingClientRect().right));
        await new Promise((r) => requestAnimationFrame(r));
      }
      return out;
    })()`) as Promise<number[]>;
    await page.setViewportSize({ width: 1000, height: 700 });
    const gaps = await sampling;
    assert.ok(gaps.length >= 8, `frames seen beside: ${gaps.length}`);
    assert.ok(gaps.every((g) => g < 0.05), gaps.join());
    await ctx.close();
  });

  it('puts the toast in the editor\'s pane, above its strip, beside the settings as without them, never over the explanation', async function () {
    this.timeout(90000);
    for (const [width, locale, split] of [[1280, 'en-US', 50], [768, 'en-US', 50], [768, 'ja-JP', 50], [768, 'en-US', 15]] as const) {
      const ctx = await browser.newContext({ locale, viewport: { width, height: 700 }, acceptDownloads: true });
      // (A save is a download, with its toast: without the file pickers of the browser.)
      await ctx.addInitScript('delete window.showOpenFilePicker; delete window.showSaveFilePicker;');
      await ctx.addInitScript(`try { localStorage.setItem('bash-explainer-split', JSON.stringify({ wide: ${split} })); } catch {}`);
      const page = await ctx.newPage();
      await page.goto(base);
      await page.locator('.cm-content').click();
      await page.keyboard.press('Control+A');
      await page.keyboard.insertText('echo hello');
      const toast = () => page.evaluate(`(() => { const e = document.getElementById('status'); const b = e.getBoundingClientRect(); const p = document.getElementById('panel-pane').getBoundingClientRect(); const m = document.getElementById('source').getBoundingClientRect(); const st = document.getElementById('problems').getBoundingClientRect(); const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return { shown: e.classList.contains('shown'), box: [b.left, b.top, b.right, b.bottom], panel: [p.left, p.top, p.right, p.bottom], pane: [m.left, m.top, m.right, m.bottom], strip: st.top, hitInToast: !!hit && e.contains(hit), button: !!e.querySelector('button') }; })()`) as Promise<{ shown: boolean; box: number[]; panel: number[]; pane: number[]; strip: number; hitInToast: boolean; button: boolean }>;
      const fits = (t: Awaited<ReturnType<typeof toast>>) => {
        const seen = `${width} ${locale}: ${JSON.stringify(t)}`;
        assert.ok(t.shown && t.hitInToast, seen);
        // Inside the pane, above the strip, and not over the explanation.
        assert.ok(t.box[0] >= t.pane[0] - 0.5 && t.box[2] <= t.pane[2] + 0.5 && t.box[3] <= t.strip + 0.5 && t.box[2] <= t.panel[0] + 0.5, seen);
      };
      // It fits in the pane beside the sheet: not higher than a third of the window. (The pane has at least the editor's floor there.)
      const short = (t: Awaited<ReturnType<typeof toast>>) => assert.ok(t.box[3] - t.box[1] < 700 / 3, `${width} ${locale}: ${JSON.stringify(t)}`);
      const save = async () => { await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+S')]); await until('the toast', async () => (await toast()).shown, (v) => v); };
      // A toast shown with the sheet open.
      await opened(page);
      await page.locator('#settings-search').focus();
      await save();
      await stable('at rest', () => page.locator('#status').evaluate((d) => d.getBoundingClientRect().bottom));
      fits(await toast());
      short(await toast());
      // The sheet shuts with the toast still there: it follows the pane.
      await page.locator('#settings-open').click();
      await until('the sheet closed', () => isOpen(page), (v) => !v);
      await stable('at rest', () => page.locator('#status').evaluate((d) => d.getBoundingClientRect().right + d.getBoundingClientRect().width));
      fits(await toast());
      // A toast already showing as the sheet opens stays in the pane.
      await opened(page);
      await stable('at rest', () => page.locator('#status').evaluate((d) => d.getBoundingClientRect().right + d.getBoundingClientRect().width));
      fits(await toast());
      short(await toast());
      await ctx.close();
    }
  });

  it('with reduced motion, has the sheet and the panes at their places at once, and puts them back after a long swipe, which closes the sheet at once', async function () {
    this.timeout(60000);
    const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 1180, height: 700 }, hasTouch: true, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.goto(base);
    await page.locator('.cm-line').first().waitFor();
    const before = await boxes(page);
    // No frame between: opened and read in one go, and nothing moving or held.
    const at = await page.evaluate(`(async () => {
      document.getElementById('settings-open').click();
      const d = document.getElementById('settings-dialog');
      const first = { sheet: d.getBoundingClientRect().left, panel: document.getElementById('panel-pane').getBoundingClientRect().right, moving: d.classList.contains('moving'), holding: d.classList.contains('holding'), running: document.getAnimations().length };
      return first;
    })()`) as { sheet: number; panel: number; moving: boolean; holding: boolean; running: number };
    assert.ok(Math.abs(at.sheet - (1180 - 1180 / 3)) < 0.5 && Math.abs(at.panel - at.sheet) < 0.05, JSON.stringify(at));
    assert.deepStrictEqual([at.moving, at.holding, at.running], [false, false, 0], JSON.stringify(at));
    const rest = await boxes(page);
    await page.evaluate("document.getElementById('settings-close').click()");
    assert.strictEqual(await isOpen(page), false);
    assert.deepStrictEqual(await boxes(page), before);
    await opened(page);
    const cdp = await ctx.newCDPSession(page);
    const touch = (type: string, x?: number) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: x === undefined ? [] : [{ x, y: 300 }] } as never);
    await touch('touchStart', 900);
    for (let i = 1; i <= 5; i++) await touch('touchMove', 900 + i * 30);
    await touch('touchEnd');
    await until('the swipe closed the sheet', () => isOpen(page), (v) => !v);
    assert.deepStrictEqual(await boxes(page), before);
    assert.strictEqual(await page.evaluate("document.querySelector('main').style.getPropertyValue('--sheet-in')"), '');
    await opened(page);
    assert.deepStrictEqual(await boxes(page), rest);
    await ctx.close();
  });

  it('slides the sheet as before with "Animations in the panel" off: that setting is the panel\'s own', async function () {
    this.timeout(60000);
    const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 700 } });
    await ctx.addInitScript(`try { localStorage.setItem('bash-explainer-settings', JSON.stringify({ 'panel.animations': false })); } catch {}`);
    const page = await ctx.newPage();
    await page.goto(base);
    await page.locator('.cm-line').first().waitFor();
    const frames = await framesWhile(page, "document.getElementById('settings-open').click()");
    assert.ok(new Set(frames.map((f) => Math.round(f.left))).size >= 4, JSON.stringify(frames.map((f) => f.left)));
    await ctx.close();
  });

  it('keeps the panel in use while the sheet is open side by side: it scrolls and takes a click, Esc and the gear shut the sheet, and the focus goes back', async () => {
    const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 600 } });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base);
    const panel = () => page.frames().find((f) => f.url().endsWith('/panel.html'))!;
    await until('the panel', () => Promise.resolve(panel()), (f) => !!f);
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    // (The panel explains the line of the cursor: one long line, so that the panel is longer than the window.)
    await page.keyboard.insertText(`echo ${Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ')}`);
    const scrolled = () => panel().evaluate('(document.scrollingElement || document.documentElement).scrollTop') as Promise<number>;
    const rows = () => panel().locator('#tree > li > .item > .row > button.twisty');
    await until('the rows', async () => panel().locator('#tree .row').count(), (n) => n > 40);
    await page.locator('#settings-open').click();
    await stable('the sheet slid in', () => page.locator('#settings-dialog').evaluate((d) => d.getBoundingClientRect().left));
    assert.strictEqual(await isOpen(page), true);
    // The focus went into the sheet.
    assert.strictEqual(await page.evaluate("document.getElementById('settings-dialog').contains(document.activeElement)"), true);
    const { panel: box } = await boxes(page);
    // The panel scrolls under the wheel ...
    assert.strictEqual(await scrolled(), 0);
    await page.mouse.move(box.left + box.width / 2, box.top + 200);
    await page.mouse.wheel(0, 300);
    await until('the panel scrolled', scrolled, (y) => y > 100);
    assert.strictEqual(await isOpen(page), true);
    // ... and a part in it takes a click (it folds), with the sheet still open.
    const row = rows().first();
    await row.scrollIntoViewIfNeeded();
    const was = await row.getAttribute('aria-expanded');
    await row.click();
    await until('the row folded or unfolded', async () => row.getAttribute('aria-expanded'), (v) => v !== was);
    assert.strictEqual(await isOpen(page), true);
    // Esc shuts the sheet (from the sheet), and the focus goes back to the gear.
    await page.locator('#settings-search').focus();
    await page.keyboard.press('Escape');
    await until('the sheet closed by Esc', () => isOpen(page), (v) => !v);
    assert.strictEqual(await page.evaluate('document.activeElement.id'), 'settings-open');
    // The gear opens it again, and shuts it.
    await page.locator('#settings-open').click();
    await until('the sheet open', () => isOpen(page), (v) => v);
    await page.locator('#settings-open').click();
    await until('the sheet closed by the gear', () => isOpen(page), (v) => !v);
    await page.locator('#settings-open').click();
    await until('the sheet open again', () => isOpen(page), (v) => v);
    await page.locator('#settings-done').click();
    await until('the sheet closed by Close', () => isOpen(page), (v) => !v);
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  });

  it('finds settings by their title or their key, in their sections, and says when none matches', async () => {
    const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    await page.goto(base);
    await page.locator('#settings-open').click();
    const search = page.locator('#settings-search');
    const find = async (text: string) => {
      await search.fill('');
      await search.click();
      await page.keyboard.insertText(text);
      return page.evaluate("[...document.querySelectorAll('#settings-dialog .setting, #settings-dialog .settings-part')].filter((r) => r.getClientRects().length).map((r) => r.dataset.key ?? r.id ?? r.dataset.title)") as Promise<string[]>;
    };
    // By title: the folded Checks unfolds to show it, and nothing else shows.
    assert.strictEqual(await page.locator('#settings-items-checks').isVisible(), false);
    assert.deepStrictEqual(await find('version'), ['bashVersion']);
    assert.strictEqual(await page.locator('#setting-bashVersion').isVisible(), true);
    assert.strictEqual(await page.locator('#settings-section-common').isVisible(), false);
    // By key, with or without the prefix, whatever the case.
    assert.deepStrictEqual(await find('bashExplainer.hints'), ['hints.names', 'hints.deadCode']);
    assert.deepStrictEqual(await find('DIAGNOSTICS.IGNORE'), ['diagnostics.ignore']);
    // The page's own parts by their title: the theme, the export.
    assert.deepStrictEqual(await find('theme'), ['setting-theme-row']);
    assert.ok((await find('export')).length === 1 && await page.locator('#settings-export').isVisible());
    // Nothing: it says so.
    assert.strictEqual(await page.locator('#settings-nomatch').isVisible(), false);
    assert.deepStrictEqual(await find('zzz'), []);
    assert.strictEqual(await page.locator('#settings-nomatch').isVisible(), true);
    // Escape clears the search (the sheet stays open, Checks folds again); Escape again closes the sheet.
    await page.keyboard.press('Escape');
    assert.strictEqual(await search.inputValue(), '');
    assert.strictEqual(await isOpen(page), true);
    assert.strictEqual(await page.locator('#setting-language').isVisible(), true);
    assert.strictEqual(await page.locator('#settings-items-checks').isVisible(), false);
    await page.keyboard.press('Escape');
    await until('the sheet closed', () => isOpen(page), (v) => !v);
    await ctx.close();
    // In Japanese, by the Japanese title.
    const ja = await browser.newContext({ locale: 'ja-JP' });
    const p2 = await ja.newPage();
    await p2.goto(base);
    await p2.locator('#settings-open').click();
    await p2.locator('#settings-search').click();
    await p2.keyboard.insertText('バージョン');
    await until('bash のバージョン', () => p2.locator('#setting-bashVersion').isVisible(), (v) => v);
    assert.strictEqual(await p2.locator('#setting-language').isVisible(), false);
    await ja.close();
  });

  it('unfolds a section from its Jump to link and brings it to the top, and folds it from its heading', async () => {
    const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    await page.goto(base);
    await page.locator('#settings-open').click();
    const fold = page.locator('#settings-fold-checks');
    assert.strictEqual(await fold.getAttribute('aria-expanded'), 'false');
    assert.deepStrictEqual(await page.locator('#settings-nav a').allInnerTexts(), ['Common', 'Examples', 'Checks', 'Editor', 'Data']);
    await page.locator('#settings-jump-checks').click();
    assert.strictEqual(await page.locator('#setting-shell').isVisible(), true);
    assert.strictEqual(await fold.getAttribute('aria-expanded'), 'true');
    // Its heading is at the top of the sheet's body, and has the focus.
    const top = () => page.evaluate("document.getElementById('settings-section-checks').getBoundingClientRect().top - document.querySelector('.settings-body').getBoundingClientRect().top") as Promise<number>;
    assert.ok(Math.abs(await stable('the scroll', top)) <= 1, String(await top()));
    // Only the body scrolled: the sheet's header and its links stay at the top, its footer at the bottom.
    assert.deepStrictEqual(await page.evaluate("[document.getElementById('settings-dialog').scrollTop, document.querySelector('.settings-head').getBoundingClientRect().top, Math.round(document.querySelector('.settings-foot').getBoundingClientRect().bottom)]"), [0, 48, 800]);
    assert.strictEqual(await page.evaluate('document.activeElement.id'), 'settings-fold-checks');
    // Common is a link too: back to the top.
    await page.locator('#settings-jump-common').click();
    assert.ok(Math.abs(await stable('the scroll', () => page.evaluate("document.getElementById('settings-section-common').getBoundingClientRect().top - document.querySelector('.settings-body').getBoundingClientRect().top") as Promise<number>)) <= 1);
    // The heading folds it, and unfolds it.
    await fold.click();
    assert.strictEqual(await page.locator('#setting-shell').isVisible(), false);
    assert.strictEqual(await fold.getAttribute('aria-expanded'), 'false');
    await fold.click();
    assert.strictEqual(await page.locator('#setting-shell').isVisible(), true);
    // Data: the export and the stored data.
    await page.locator('#settings-jump-data').click();
    assert.strictEqual(await page.locator('#settings-export').isVisible(), true);
    assert.strictEqual(await page.locator('#settings-clear').isVisible(), true);
    await ctx.close();
  });

  it('shows two lines of a description with More after the last word, option labels in words, and the VS Code names only when asked', async () => {
    const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 768, height: 800 } });
    const page = await ctx.newPage();
    await page.goto(base);
    await openSettingsSection(page, 'checks');
    const desc = page.locator('#setting-bashVersion-desc');
    const more = page.locator('#setting-bashVersion-desc-more');
    const lines = () => desc.evaluate((d) => Math.round(d.getBoundingClientRect().height / parseFloat(d.ownerDocument.defaultView!.getComputedStyle(d).lineHeight)));
    // Cut to two lines, "… More" inside the text, after its last word shown; the rest is there for a screen reader.
    assert.strictEqual(await lines(), 2);
    assert.strictEqual(await more.innerText(), 'More');
    assert.strictEqual(await desc.evaluate((d) => !!d.querySelector('.desc-more')), true);
    assert.match(await desc.innerText(), /… More/);
    assert.strictEqual(await more.getAttribute('aria-label'), 'More: bash version');
    await more.click();
    assert.ok(await lines() > 2);
    assert.strictEqual(await more.innerText(), 'Less');
    assert.strictEqual(await more.getAttribute('aria-expanded'), 'true');
    assert.strictEqual(await page.evaluate('document.activeElement.id'), 'setting-bashVersion-desc-more');
    await more.click();
    assert.strictEqual(await lines(), 2);
    // The values in words, without their names; a setting named in a text is its title, a link to it.
    await openSettingsSection(page, 'examples');
    const placement = () => page.locator('#setting-examples-placement option').allInnerTexts();
    assert.ok((await placement()).every((o) => !/^(first|last|bottom) — /.test(o)), String(await placement()));
    assert.strictEqual(await page.locator('.setting-key').count(), 0);
    await page.locator('#setting-shell-desc-more').click();
    const link = page.locator('#setting-shell-desc a.setting-link');
    assert.strictEqual(await link.innerText(), 'bash version');
    await link.click();
    assert.strictEqual(await page.evaluate('document.activeElement.id'), 'setting-bashVersion');
    // "Show VS Code setting names": the keys, the values' names, and the names in the texts; kept.
    await page.locator('#settings-show-keys').check();
    assert.ok((await placement())[0].startsWith('first — '), String(await placement()));
    assert.strictEqual(await page.locator('[data-key="bashVersion"] .setting-key').innerText(), 'bashExplainer.bashVersion');
    await page.reload();
    await openSettingsSection(page, 'checks');
    assert.strictEqual(await page.locator('#settings-show-keys').isChecked(), true);
    assert.strictEqual(await page.locator('[data-key="shell"] .setting-key').innerText(), 'bashExplainer.shell');
    await ctx.close();
  });

  it('keeps the editor in use beside the sheet: typing, the cursor, the divider, F6, Tab and Esc, and the top bar stays above and in use', async () => {
    const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 700 }, acceptDownloads: true });
    // (A save is a download: without the file pickers of the browser.)
    await ctx.addInitScript('delete window.showOpenFilePicker; delete window.showSaveFilePicker;');
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base);
    const panel = () => page.frames().find((f) => f.url().endsWith('/panel.html'))!;
    await until('the panel', () => Promise.resolve(panel()), (f) => !!f);
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    const script = `echo ${Array.from({ length: 20 }, (_, i) => `word${i}`).join(' ')}`;
    await page.keyboard.insertText(script);
    await until('the rows', async () => panel().locator('#tree .row').count(), (n) => n > 10);
    const text = () => page.evaluate("document.querySelector('.cm-content').textContent") as Promise<string>;
    await opened(page);
    // The sheet lies below the top bar, as high as the editor's pane, and covers neither the bar nor the pane.
    const geometry = await page.evaluate(`(() => {
      const r = (e) => { const b = e.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom].map(Math.round); };
      return { sheet: r(document.getElementById('settings-dialog')), pane: r(document.getElementById('source')), bar: r(document.querySelector('header.top')) };
    })()`) as Record<'sheet' | 'pane' | 'bar', number[]>;
    assert.strictEqual(geometry.sheet[1], geometry.pane[1], JSON.stringify(geometry));
    assert.ok(geometry.sheet[1] >= geometry.bar[3] - 1 && geometry.sheet[3] >= geometry.pane[3] - 1 && geometry.pane[2] <= geometry.sheet[0], JSON.stringify(geometry));
    for (const id of ['menu-open', 'share', 'settings-open', 'open-btn', 'ed-more', 'splitter']) {
      const on = await page.evaluate(`(() => { const e = document.getElementById('${id}'); const b = e.getBoundingClientRect(); return e.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)); })()`);
      assert.strictEqual(on, true, `${id} is under something`);
    }
    for (const id of ['source', 'splitter', 'panel-pane']) assert.strictEqual(await page.evaluate(`document.getElementById('${id}').inert`), false, id);
    // Typing and the cursor: a click in the text puts the cursor there, the sheet stays open, and the explanation follows.
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' zz');
    assert.strictEqual(await text(), `${script} zz`);
    assert.strictEqual(await isOpen(page), true);
    await until('the panel follows', () => panel().locator('#tree').innerText(), (t) => t.includes('zz'));
    // Esc in the editor keeps its own use there (Esc, then Tab, leaves the editor, as with the sheet shut): the sheet stays.
    await page.keyboard.press('Escape');
    await page.evaluate(FRAMES);
    assert.deepStrictEqual(await page.locator('#settings-dialog').evaluate((d) => [(d as unknown as { open: boolean }).open, d.classList.contains('closing')]), [true, false]);
    await page.keyboard.press('Tab');
    assert.strictEqual(await page.evaluate("document.activeElement.classList.contains('cm-content')"), false);
    assert.strictEqual(await text(), `${script} zz`);
    // Tab goes through the whole page in its order on the screen: the bar, the editor's head, the editor, the divider, the panel's
    // head, the frame, the sheet. (Tab stays in the editor until Esc: as with the sheet shut.)
    const where = () => page.evaluate(`(() => { const a = document.activeElement; return a.closest('header.top') ? 'bar' : a.closest('#ed-head') ? 'head' : a.classList.contains('cm-content') ? 'editor' : a.closest('#problems') ? 'problems' : a.id === 'splitter' ? 'divider' : a.closest('#panel-head') ? 'panel head' : a.id === 'panel' ? 'frame' : a.closest('#status') ? 'toast' : a.closest('#settings-dialog') ? 'sheet' : a.tagName; })()`) as Promise<string>;
    await page.locator('#menu-open').focus();
    const stops = ['bar'];
    for (let i = 0; i < 120 && stops[stops.length - 1] !== 'sheet'; i++) {
      if (stops[stops.length - 1] === 'editor') await page.keyboard.press('Escape');
      await page.keyboard.press('Tab');
      const at = await where();
      if (at !== stops[stops.length - 1]) stops.push(at);
    }
    assert.deepStrictEqual(stops.filter((x) => x !== 'problems'), ['bar', 'head', 'editor', 'divider', 'panel head', 'frame', 'sheet'], stops.join());
    assert.strictEqual(await isOpen(page), true);
    // Ctrl+S saves with the sheet open, with the focus in the sheet (the toast "Downloaded ..." has a button).
    await page.locator('#settings-search').focus();
    const [saved] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+S')]);
    assert.ok(saved.suggestedFilename().endsWith('.sh'));
    await until('the toast', () => page.evaluate("!!document.querySelector('#status [id=status-action], #status button')") as Promise<boolean>, (v) => v);
    // F6 goes round the parts as they lie on the screen: editor, explanation, sheet, toast, editor (Shift+F6 the other way).
    const part = () => page.evaluate(`(() => { const a = document.activeElement; return a.id === 'panel' ? 'panel' : a.closest('#status') ? 'toast' : a.closest('#settings-dialog') ? 'sheet' : a.classList.contains('cm-content') ? 'editor' : a.tagName; })()`) as Promise<string>;
    for (const [key, to] of [['F6', 'toast'], ['F6', 'editor'], ['F6', 'panel'], ['F6', 'sheet'], ['Shift+F6', 'panel'], ['Shift+F6', 'editor'], ['Shift+F6', 'toast'], ['Shift+F6', 'sheet'], ['Shift+F6', 'panel']] as const) {
      await page.keyboard.press(key);
      await until(`${key} to ${to}`, part, (w) => w === to);
    }
    // Ctrl+S from the panel too.
    const [again] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+S')]);
    assert.ok(again.suggestedFilename().endsWith('.sh'));
    // Esc in the explanation shuts the sheet, and the focus stays there.
    await page.keyboard.press('Escape');
    await until('closed by Esc in the panel', () => isOpen(page), (v) => !v);
    assert.strictEqual(await part(), 'panel');
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  });


  it('keeps the top bar working while the sheet is open side by side: the menu takes its place, the gear shuts it', async () => {
    const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 700 } });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base);
    const drawerOpen = () => page.evaluate("document.getElementById('drawer').open") as Promise<boolean>;
    await page.locator('#settings-open').click();
    await until('the sheet open', () => isOpen(page), (v) => v);
    await openSettingsSection(page, 'checks');
    // ☰ shuts the sheet and opens the menu; the editor is not left inert.
    await page.locator('#menu-open').click();
    await until('the menu open', drawerOpen, (v) => v);
    await until('the sheet closed', () => isOpen(page), (v) => !v);
    // The focus is in the menu, not lost to the page's body; Esc shuts the menu and the focus goes back to ☰.
    assert.strictEqual(await page.evaluate("document.getElementById('drawer').contains(document.activeElement)"), true);
    await page.keyboard.press('Escape');
    await until('the menu closed', drawerOpen, (v) => !v);
    assert.strictEqual(await page.evaluate('document.activeElement.id'), 'menu-open');
    // The settings open again, and the gear shuts them.
    await page.locator('#settings-open').click();
    await until('the sheet open again', () => isOpen(page), (v) => v);
    await page.locator('#settings-open').click();
    await until('the sheet closed by the gear', () => isOpen(page), (v) => !v);
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  });

  it('puts the focus on the editor, not the page, when a toast or an Undo that had it goes while the sheet is open side by side', async () => {
    for (const width of [1280, 900]) {
      const ctx = await browser.newContext({ locale: 'en-US', viewport: { width, height: 700 } });
      const page = await ctx.newPage();
      await page.goto(base);
      const where = () => page.evaluate(`(() => { const a = document.activeElement; return a.id === 'panel' ? 'panel' : a.closest('#status') ? 'toast' : a.closest('#settings-dialog') ? 'sheet' : a.closest('#source') ? 'editor' : a === document.body ? 'BODY' : a.tagName + '#' + a.id; })()`) as Promise<string>;
      for (const how of ['Enter', 'Escape']) {
        // Clear the editor from the editor's ⋯ (a toast with Undo), open the settings, F6 to the toast's Undo (the stop after the sheet).
        await page.locator('.cm-content').click();
        await page.keyboard.press('Control+A');
        await page.keyboard.insertText('echo mine');
        await page.locator('#ed-more').click();
        await page.locator('#more-clear').click();
        await until('the toast', () => page.evaluate("!!document.querySelector('#status button')") as Promise<boolean>, (v) => v);
        await page.locator('#settings-open').click();
        await until('the sheet', () => isOpen(page), (v) => v);
        await page.locator('#settings-search').focus();
        await page.keyboard.press('F6');
        await until('the toast', where, (w) => w === 'toast');
        await page.keyboard.press(how);
        await until('the toast gone', () => page.evaluate("!document.querySelector('#status button')") as Promise<boolean>, (v) => v);
        // The editor is in view and in use beside the sheet: the focus goes home, as it does with the sheet shut.
        assert.strictEqual(await where(), 'editor', `${width} ${how}`);
        assert.strictEqual(await isOpen(page), true);
        // (Shut the sheet for the next round.)
        await page.locator('#settings-done').click();
        await until('closed', () => isOpen(page), (v) => !v);
      }
      await ctx.close();
    }
  });

  it('keeps the links in the cut-off part of a description out of the Tab order, and brings them back when it is expanded', async () => {
    const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    await page.goto(base);
    await openSettingsSection(page, 'checks');
    await openSettingsSection(page, 'examples');
    await openSettingsSection(page, 'editor');
    const hidden = page.locator('.setting-desc .sr-only a');
    assert.ok(await hidden.count() > 0, 'a link is cut off');
    assert.deepStrictEqual(await hidden.evaluateAll((as) => as.map((a) => (a as unknown as { tabIndex: number }).tabIndex)), (await hidden.all()).map(() => -1));
    // Tab through the sheet: no stop is in a cut-off part.
    await page.locator('#settings-search').focus();
    const stops: string[] = [];
    for (let i = 0; i < 80; i++) {
      await page.keyboard.press('Tab');
      const at = await page.evaluate("(() => { const a = document.activeElement; return a.closest('#settings-dialog') ? (a.closest('.sr-only') ? 'CUT ' : '') + (a.id || a.tagName) : 'outside'; })()") as string;
      stops.push(at);
      if (at === 'outside') break;
    }
    assert.ok(stops.length > 30, stops.join());
    assert.deepStrictEqual(stops.filter((x) => x.startsWith('CUT')), []);
    // Expanded, the link is a stop again.
    await page.locator('#setting-diagnostics-pitfalls-desc-more').click();
    const link = page.locator('#setting-diagnostics-pitfalls-desc a.setting-link');
    assert.strictEqual(await link.evaluate((a) => (a as unknown as { tabIndex: number }).tabIndex), 0);
    await link.focus();
    assert.strictEqual(await page.evaluate('document.activeElement.className'), 'setting-link');
    // Folded again, it is out once more.
    await page.locator('#setting-diagnostics-pitfalls-desc-more').click();
    assert.strictEqual(await page.locator('#setting-diagnostics-pitfalls-desc .sr-only a.setting-link').evaluate((a) => (a as unknown as { tabIndex: number }).tabIndex), -1);
    await ctx.close();
  });

  it('keeps an expanded description expanded when a setting changes', async () => {
    const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 768, height: 800 } });
    const page = await ctx.newPage();
    await page.goto(base);
    await openSettingsSection(page, 'checks');
    const desc = page.locator('#setting-bashVersion-desc');
    const more = page.locator('#setting-bashVersion-desc-more');
    await more.click();
    assert.strictEqual(await more.innerText(), 'Less');
    await page.locator('#setting-diagnostics-pitfalls').uncheck();
    assert.strictEqual(await desc.evaluate((d) => d.classList.contains('open')), true);
    assert.strictEqual(await more.innerText(), 'Less');
    assert.strictEqual(await more.getAttribute('aria-expanded'), 'true');
    assert.strictEqual(await more.getAttribute('aria-label'), 'Less: bash version');
    await more.click();
    await page.locator('#setting-diagnostics-pitfalls').check();
    assert.strictEqual(await desc.evaluate((d) => d.classList.contains('open')), false);
    assert.strictEqual(await more.innerText(), 'More');
    await ctx.close();
  });

  it('says Auto first in a select where it is chosen, and has its own word for Less', async () => {
    for (const [locale, lang, auto, less] of [['en-US', 'en', 'Auto: ', 'Less'], ['ja-JP', 'ja', '自動: ', 'たたむ']]) {
      const ctx = await browser.newContext({ locale, viewport: { width: 1280, height: 800 } });
      const page = await ctx.newPage();
      await page.goto(base);
      await choose(page, '#lang', lang);
      await openSettingsSection(page, 'checks');
      for (const id of ['setting-shell', 'setting-yq-flavor']) {
        const options = await page.locator(`#${id} option`).allInnerTexts();
        // (The Shell setting's Auto says the shell the script reads as now: decision 12.)
        const first = id === 'setting-shell' ? auto.replace(': ', lang === 'ja' ? '（' : ' (') : auto;
        assert.ok(options[0].startsWith(first), `${lang} ${id}: ${options[0]}`);
        assert.ok(options.slice(1).every((o) => !o.startsWith(auto.slice(0, -2))), String(options));
      }
      // The language keeps its own words.
      assert.ok(!(await page.locator('#setting-language option').first().innerText()).startsWith(auto));
      const more = page.locator('.desc-more:visible').first();
      await more.click();
      assert.strictEqual(await more.innerText(), less);
      assert.notStrictEqual(await page.locator('#settings-done').innerText(), less);
      await ctx.close();
    }
  });

  it('says in the Shell setting\'s Auto the shell the script reads as now, and where from (decision 12), also for a file opened while the sheet is open', async () => {
    for (const [locale, lang, now, opened] of [
      ['en-US', 'en', 'Auto (now: bash, from #!)', 'Auto (now: zsh, from the file name)'],
      ['ja-JP', 'ja', '自動（今: bash、#! 行から）', '自動（今: zsh、ファイル名から）'],
    ]) {
      const ctx = await browser.newContext({ locale, viewport: { width: 1280, height: 800 } });
      // (Open goes through a file input, which Playwright can fill.)
      await ctx.addInitScript('delete window.showOpenFilePicker; delete window.showSaveFilePicker;');
      const page = await ctx.newPage();
      await page.goto(base);
      await page.locator('.cm-line').nth(5).waitFor();
      await choose(page, '#lang', lang);
      await openSettingsSection(page, 'checks');
      const auto = page.locator('#setting-shell option[value="auto"]');
      assert.strictEqual(await auto.innerText(), now);
      // The sheet lies over the editor, and Ctrl+O still opens a file: a name that says zsh.
      const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.keyboard.press('Control+O')]);
      await chooser.setFiles({ name: 'setup.zsh', mimeType: 'text/plain', buffer: Buffer.from('echo one\n') });
      await until('the reading of the file', () => auto.innerText(), (t) => t === opened);
      assert.strictEqual(await isOpen(page), true);
      await ctx.close();
    }
  });

  it('finds a setting typed in full-width letters, waits for an input method to finish, and leaves its Esc alone', async () => {
    const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    await page.goto(base);
    await page.locator('#settings-open').click();
    const search = page.locator('#settings-search');
    await search.fill('ｂａｓｈ');
    assert.strictEqual(await page.locator('[data-key="bashVersion"]').isVisible(), true);
    assert.strictEqual(await page.locator('#settings-nomatch').isHidden(), true);
    // An Esc that belongs to the input method (mid-composition) changes nothing: the text stays, the sheet stays.
    const press = (init: string) => page.evaluate(`document.getElementById('settings-search').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, ...${init} }))`);
    await press('{"isComposing":true}');
    await press('{"keyCode":229}');
    assert.strictEqual(await search.inputValue(), 'ｂａｓｈ');
    assert.strictEqual(await isOpen(page), true);
    // While composing, the list waits.
    await search.fill('');
    await page.evaluate(`(() => {
      const i = document.getElementById('settings-search');
      i.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      i.value = 'ほ';
      i.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
    })()`);
    assert.strictEqual(await page.locator('#settings-nomatch').isHidden(), true);
    await page.evaluate(`(() => {
      const i = document.getElementById('settings-search');
      i.value = 'ほげ';
      i.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    })()`);
    assert.strictEqual(await page.locator('#settings-nomatch').isVisible(), true);
    // A plain Esc clears the search.
    await search.press('Escape');
    assert.strictEqual(await search.inputValue(), '');
    await ctx.close();
  });

  it('keeps the theme as the menu does', async () => {
    const ctx = await browser.newContext({ locale: 'en-US', colorScheme: 'light' });
    const page = await ctx.newPage();
    await page.goto(base);
    await page.locator('#settings-open').click();
    assert.strictEqual(await page.locator('#setting-theme').inputValue(), 'auto');
    await page.locator('#setting-theme').selectOption('dark');
    assert.strictEqual(await page.evaluate('document.documentElement.dataset.theme'), 'dark');
    assert.strictEqual(await page.locator('#theme').inputValue(), 'dark');
    await page.reload();
    assert.strictEqual(await page.evaluate('document.documentElement.dataset.theme'), 'dark');
    await page.locator('#settings-open').click();
    assert.strictEqual(await page.locator('#setting-theme').inputValue(), 'dark');
    await ctx.close();
  });

  it('on a phone, takes the whole screen with 44 px rows and whole descriptions, and opens again where it was left', async () => {
    const { devices } = await import('playwright-core');
    const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'en-US' });
    const page = await ctx.newPage();
    await page.goto(base);
    const panel = () => page.frames().find((f) => f.url().endsWith('/panel.html'))!;
    await until('the panel', () => Promise.resolve(panel()), (f) => !!f);
    await page.locator('#settings-open').tap();
    for (const id of ['examples', 'checks', 'editor', 'data']) await page.locator(`#settings-fold-${id}`).tap();
    // Every row and control is a 44 px target; no "More" (the texts show whole); a setting named in a text is no link.
    const small = await page.evaluate(`[...document.querySelectorAll('#settings-dialog :is(.setting-head label, .setting-choices label, .settings-show-keys, select, input:not([type=checkbox]):not([type=file]), button, textarea, summary, .settings-nav a)')]
      .filter((e) => e.getClientRects().length && e.getBoundingClientRect().height < 43.5).map((e) => (e.id || e.className || e.tagName) + ' ' + Math.round(e.getBoundingClientRect().height))`) as string[];
    assert.deepStrictEqual(small, []);
    assert.strictEqual(await page.locator('.desc-more:visible').count(), 0);
    assert.strictEqual(await page.locator('#settings-dialog a.setting-link').count(), 0);
    // The hover cards never show on a touch screen: no setting for them.
    assert.strictEqual(await page.locator('#setting-hover-enabled').count(), 0);
    // A change shows in the explanation once the settings close.
    const panelText = () => panel().locator('#main').innerText();
    await page.locator('#settings-done').tap();
    // (Focused, not clicked: on a phone the middle of the editor's content lies under the explanation's sheet.)
    await page.locator('.cm-content').focus();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText('#!/bin/bash\nfor f in $(ls); do echo "$f"; done');
    await until('the pitfall', panelText, (t) => /The output of \$\(ls …\) is split/.test(t));
    await page.locator('#settings-open').tap();
    await page.locator('#setting-notes-pitfalls').uncheck();
    // Closed and opened again: the same place, the same sections open.
    await page.locator('.settings-body').evaluate((b) => b.scrollTo(0, 900));
    const at = await page.locator('.settings-body').evaluate((b) => b.scrollTop);
    assert.ok(at > 800, String(at));
    await page.locator('#settings-done').tap();
    await until('the sheet closed', () => isOpen(page), (v) => !v);
    await until('no pitfall', panelText, (t) => !/Problems on this line/.test(t));
    await page.locator('#settings-open').tap();
    assert.strictEqual(await page.locator('.settings-body').evaluate((b) => b.scrollTop), at);
    assert.strictEqual(await page.locator('#setting-shell').isVisible(), true);
    await ctx.close();
  });
});
