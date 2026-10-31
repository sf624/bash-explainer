// The web page: theme and settings, run for real in headless Chromium (the build, the server and the browser
// are shared by all test/web-*.test.ts files: test/support/site.ts). Skipped when no browser can start,
// unless $BASH_EXPLAINER_BROWSER is set (as in CI).
import * as assert from 'assert';
import * as fs from 'fs';
import type { Browser, Frame, Page } from 'playwright-core';
import { openSite, choose, currentShell, pickKind, openSettingsSection, problemList, problemsShown, settingControl, stable, until } from './support/site';

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
    await until('the pitfall', panelText, (t) => /Caveat: the output of/.test(t));
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
    await until('no pitfall', panelText, (t) => !/Caveat/.test(t));
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
    // The panel's header is not shown on the page; the shell is a setting. This one is chosen in the menu's select on
    // purpose (`setShell` takes the top bar's at this width, which test/web-topbar.test.ts covers): both are the setting.
    await until('the header hidden', () => panel().locator('header').isHidden(), (h) => h);
    await choose(page, '#shell', 'dash');
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

  /** The boxes of the sheet, the editor's pane and the panel. */
  const boxes = (page: Page) => page.evaluate(`(() => {
    const r = (e) => { const b = e.getBoundingClientRect(); return { left: b.left, right: b.right, width: b.width, top: b.top, bottom: b.bottom }; };
    return { sheet: r(document.getElementById('settings-dialog')), pane: r(document.querySelector('main > .source')), panel: r(document.getElementById('panel')) };
  })()`) as Promise<Record<'sheet' | 'pane' | 'panel', { left: number; right: number; width: number; top: number; bottom: number }>>;
  const isOpen = (page: Page) => page.locator('#settings-dialog').evaluate((d) => (d as unknown as { open: boolean }).open);

  it('opens over the editor side by side, never wider than its pane, so that a change shows in the explanation while the sheet is open', async () => {
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
      await until('the pitfall', panelText, (t) => /Caveat: the output of/.test(t));
      await page.locator('#settings-open').click();
      await stable('the sheet slid in', () => page.locator('#settings-dialog').evaluate((d) => d.getBoundingClientRect().left));
      const b = await boxes(page);
      const seen = `${width}: ${JSON.stringify(b)}`;
      // Along the left edge, over the editor's pane (below the top bar) and no wider: the panel is beside it, uncovered.
      assert.ok(Math.abs(b.sheet.left) < 0.5 && b.sheet.top === b.pane.top && b.sheet.bottom === b.pane.bottom, seen);
      assert.ok(b.sheet.width <= b.pane.width + 0.5 && b.sheet.right <= b.panel.left + 0.5, seen);
      // The pane's width, so that no strip of the (inert) editor shows beside it; the text keeps a column of 40rem, centred.
      assert.ok(Math.abs(b.sheet.width - b.pane.width) < 1, seen);
      const pad = await page.locator('#settings-dialog .settings-body').evaluate((e) => parseFloat(e.ownerDocument.defaultView!.getComputedStyle(e).paddingLeft));
      const column = await page.locator('#settings-dialog .settings-intro').evaluate((e) => e.getBoundingClientRect().width);
      if (width === 1920) assert.ok(Math.abs(pad - ((b.pane.width - 640) / 2 + 16)) < 1 && column <= 640, `${pad} ${column}; ${seen}`);
      else assert.ok(pad <= 16 && column <= 640, `${pad} ${column}; ${seen}`);
      // Not a modal dialog: there is no backdrop, and the page behind it is not shut.
      assert.strictEqual(await page.locator('#settings-dialog').evaluate((d) => d.matches(':modal')), false, seen);
      // A change shows in the explanation at once, with the sheet still open.
      await page.locator('#setting-notes-pitfalls').uncheck();
      await until('no pitfall', panelText, (t) => !/Caveat/.test(t) && /for/.test(t));
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
    const { sheet } = await boxes(page);
    assert.deepStrictEqual([sheet.left, sheet.width, sheet.top, sheet.bottom], [0, 640, 0, 800]);
    // There the sheet is modal, and Esc shuts it.
    assert.strictEqual(await page.locator('#settings-dialog').evaluate((d) => d.matches(':modal')), true);
    await page.keyboard.press('Escape');
    await until('the sheet closed', () => isOpen(page), (v) => !v);
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
    const rows = () => panel().locator('#tree > li > .row > button.twisty');
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

  it('keeps what the sheet covers out of reach while it is open side by side: the editor takes no focus and no key, the top bar stays above and in use', async () => {
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
    const inSource = "(() => { const a = document.activeElement; return !!a && !!a.closest('#source'); })()";
    const text = () => page.evaluate("document.querySelector('.cm-content').textContent") as Promise<string>;
    await page.locator('#settings-open').click();
    await stable('the sheet slid in', () => page.locator('#settings-dialog').evaluate((d) => d.getBoundingClientRect().left));
    // The sheet lies exactly over the editor's pane, below the top bar, which is not covered.
    const geometry = await page.evaluate(`(() => {
      const r = (e) => { const b = e.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom].map(Math.round); };
      return { sheet: r(document.getElementById('settings-dialog')), pane: r(document.getElementById('source')), bar: r(document.querySelector('header.top')) };
    })()`) as Record<'sheet' | 'pane' | 'bar', number[]>;
    assert.strictEqual(geometry.sheet[1], geometry.pane[1], JSON.stringify(geometry));
    assert.ok(geometry.sheet[1] >= geometry.bar[3] - 1 && geometry.sheet[3] >= geometry.pane[3] - 1, JSON.stringify(geometry));
    for (const id of ['menu-open', 'kind', 'settings-open']) {
      const on = await page.evaluate(`(() => { const e = document.getElementById('${id}'); const b = e.getBoundingClientRect(); return document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2) === e || e.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)); })()`);
      assert.strictEqual(on, true, `${id} is under the sheet`);
    }
    assert.strictEqual(await page.evaluate("document.getElementById('source').inert"), true);
    // A click on a part of the explanation selects it in the editor, but the focus stays in the panel: what is typed does not reach the editor under the sheet.
    await panel().locator('#tree .row .label', { hasText: 'word5' }).click();
    assert.strictEqual(await page.evaluate(inSource), false);
    await page.keyboard.type('zz');
    assert.strictEqual(await text(), script);
    // Tab from the sheet goes through the top bar and the panel, never to the editor's head, the editor or its problems.
    await page.locator('#settings-close').focus();
    const stops: string[] = [];
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab');
      stops.push(await page.evaluate(`(() => { const a = document.activeElement; return (a.closest('#source') ? 'COVERED ' : '') + (a.id || a.tagName); })()`) as string);
    }
    assert.deepStrictEqual(stops.filter((x) => x.startsWith('COVERED')), [], stops.join());
    assert.ok(stops.some((x) => x === 'menu-open' || x === 'kind'), stops.join());
    // Ctrl+S saves with the sheet open, with the focus in the sheet (the toast "Downloaded ..." has a button).
    await page.locator('#settings-search').focus();
    const [saved] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+S')]);
    assert.ok(saved.suggestedFilename().endsWith('.sh'));
    await until('the toast', () => page.evaluate("!!document.querySelector('#status [id=status-action], #status button')") as Promise<boolean>, (v) => v);
    // F6 goes round the parts in reach, not into the editor: sheet, explanation, toast, sheet (Shift+F6 the other way).
    const where = () => page.evaluate(`(() => { const a = document.activeElement; return a.id === 'panel' ? 'panel' : a.closest('#status') ? 'toast' : a.closest('#settings-dialog') ? 'sheet' : a.closest('#source') ? 'EDITOR' : a.tagName; })()`) as Promise<string>;
    await page.keyboard.press('F6');
    await until('F6 to the explanation', where, (w) => w === 'panel');
    await page.waitForTimeout(300);
    await page.keyboard.press('F6');
    await until('F6 to the toast', where, (w) => w === 'toast');
    await page.keyboard.press('F6');
    await until('F6 to the sheet', where, (w) => w === 'sheet');
    await page.keyboard.press('Shift+F6');
    await until('Shift+F6 to the toast', where, (w) => w === 'toast');
    await page.keyboard.press('Shift+F6');
    await until('Shift+F6 to the explanation', where, (w) => w === 'panel');
    // Ctrl+S from the panel too.
    const [again] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+S')]);
    assert.ok(again.suggestedFilename().endsWith('.sh'));
    // Esc in the explanation shuts the sheet, and gives the editor back.
    await page.keyboard.press('Escape');
    await until('closed by Esc in the panel', () => isOpen(page), (v) => !v);
    await until('the editor back', () => page.evaluate("document.getElementById('source').inert") as Promise<boolean>, (v) => !v);
    await page.locator('.cm-content').click();
    assert.strictEqual(await page.evaluate(inSource), true);
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  });

  it('gives the editor back when the sheet is shut, and when the window crosses to the narrow layout', async () => {
    const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 700 } });
    const page = await ctx.newPage();
    await page.goto(base);
    const inert = () => page.evaluate("document.getElementById('source').inert") as Promise<boolean>;
    await page.locator('#settings-open').click();
    await until('open', () => isOpen(page), (v) => v);
    assert.strictEqual(await inert(), true);
    // Narrow: the sheet opens again as a modal dialog, and the editor is not inert (the dialog shuts the page itself).
    await page.setViewportSize({ width: 600, height: 700 });
    await until('modal', () => page.locator('#settings-dialog').evaluate((d) => d.matches(':modal')), (v) => v);
    assert.strictEqual(await inert(), false);
    await page.setViewportSize({ width: 1280, height: 700 });
    await until('not modal', () => page.locator('#settings-dialog').evaluate((d) => d.matches(':modal')), (v) => !v);
    assert.strictEqual(await inert(), true);
    await page.locator('#settings-done').click();
    // The editor is back as the sheet starts to slide out, not when it is gone.
    assert.strictEqual(await inert(), false);
    await until('closed', () => isOpen(page), (v) => !v);
    assert.strictEqual(await inert(), false);
    await ctx.close();
  });

  it('keeps the top bar working while the sheet is open side by side: the menu takes its place, a shell chosen in the bar shows in the sheet, the gear shuts it', async () => {
    const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 700 } });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base);
    const drawerOpen = () => page.evaluate("document.getElementById('drawer').open") as Promise<boolean>;
    await page.locator('#settings-open').click();
    await until('the sheet open', () => isOpen(page), (v) => v);
    await openSettingsSection(page, 'checks');
    // The shell chosen in the bar is the Shell setting: the sheet shows it at once.
    await page.locator('#shell-top').selectOption('dash');
    assert.strictEqual(await page.locator('#setting-shell').inputValue(), 'dash');
    assert.strictEqual(await isOpen(page), true);
    // The file kind chosen in the bar: the page takes it, the sheet stays.
    await pickKind(page, 'makefile');
    assert.strictEqual(await isOpen(page), true);
    assert.match(await page.locator('#kind').innerText(), /Makefile/);
    // ☰ shuts the sheet and opens the menu; the editor is not left inert.
    await page.locator('#menu-open').click();
    await until('the menu open', drawerOpen, (v) => v);
    await until('the sheet closed', () => isOpen(page), (v) => !v);
    assert.strictEqual(await page.evaluate("document.getElementById('source').inert"), false);
    // The focus is in the menu, not lost to the page's body; Esc shuts the menu and the focus goes back to ☰.
    assert.strictEqual(await page.evaluate("document.getElementById('drawer').contains(document.activeElement)"), true);
    await page.keyboard.press('Escape');
    await until('the menu closed', drawerOpen, (v) => !v);
    assert.strictEqual(await page.evaluate('document.activeElement.id'), 'menu-open');
    // The settings open again with what the bar chose, and the gear shuts them.
    await page.locator('#settings-open').click();
    await until('the sheet open again', () => isOpen(page), (v) => v);
    await openSettingsSection(page, 'checks');
    assert.strictEqual(await page.locator('#setting-shell').inputValue(), 'dash');
    await page.locator('#settings-open').click();
    await until('the sheet closed by the gear', () => isOpen(page), (v) => !v);
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  });

  it('puts the focus on the sheet, not the page, when a toast or an Undo that had it goes while the sheet is open side by side', async () => {
    for (const width of [1280, 900]) {
      const ctx = await browser.newContext({ locale: 'en-US', viewport: { width, height: 700 } });
      const page = await ctx.newPage();
      await page.goto(base);
      const where = () => page.evaluate(`(() => { const a = document.activeElement; return a.id === 'panel' ? 'panel' : a.closest('#status') ? 'toast' : a.closest('#settings-dialog') ? 'sheet' : a.closest('#source') ? 'EDITOR' : a === document.body ? 'BODY' : a.tagName + '#' + a.id; })()`) as Promise<string>;
      for (const how of ['Enter', 'Escape']) {
        // Clear the editor from the editor's ⋯ (a toast with Undo), open the settings, F6 to the toast's Undo.
        await page.locator('.cm-content').click();
        await page.keyboard.press('Control+A');
        await page.keyboard.insertText('echo mine');
        await page.locator('#ed-more').click();
        await page.locator('#more-clear').click();
        await until('the toast', () => page.evaluate("!!document.querySelector('#status button')") as Promise<boolean>, (v) => v);
        await page.locator('#settings-open').click();
        await until('the sheet', () => isOpen(page), (v) => v);
        await page.keyboard.press('F6');
        await until('the explanation', where, (w) => w === 'panel');
        await page.waitForTimeout(300);
        await page.keyboard.press('F6');
        await until('the toast', where, (w) => w === 'toast');
        await page.keyboard.press(how);
        await until('the toast gone', () => page.evaluate("!document.querySelector('#status button')") as Promise<boolean>, (v) => v);
        assert.strictEqual(await where(), 'sheet', `${width} ${how}`);
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
        assert.ok(options[0].startsWith(auto), `${lang} ${id}: ${options[0]}`);
        assert.ok(options.slice(1).every((o) => !o.startsWith(auto)), String(options));
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
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText('#!/bin/bash\nfor f in $(ls); do echo "$f"; done');
    await until('the pitfall', panelText, (t) => /Caveat: the output of/.test(t));
    await page.locator('#settings-open').tap();
    await page.locator('#setting-notes-pitfalls').uncheck();
    // Closed and opened again: the same place, the same sections open.
    await page.locator('.settings-body').evaluate((b) => b.scrollTo(0, 900));
    const at = await page.locator('.settings-body').evaluate((b) => b.scrollTop);
    assert.ok(at > 800, String(at));
    await page.locator('#settings-done').tap();
    await until('the sheet closed', () => isOpen(page), (v) => !v);
    await until('no pitfall', panelText, (t) => !/Caveat/.test(t));
    await page.locator('#settings-open').tap();
    assert.strictEqual(await page.locator('.settings-body').evaluate((b) => b.scrollTop), at);
    assert.strictEqual(await page.locator('#setting-shell').isVisible(), true);
    await ctx.close();
  });
});
