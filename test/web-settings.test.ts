// The web page: theme and settings, run for real in headless Chromium (the build, the server and the browser
// are shared by all test/web-*.test.ts files: test/support/site.ts). Skipped when no browser can start,
// unless $BASH_EXPLAINER_BROWSER is set (as in CI).
import * as assert from 'assert';
import * as fs from 'fs';
import type { Browser, Frame, Page } from 'playwright-core';
import { openSite, choose, until } from './support/site';

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
      const body = await page.locator('.settings-body').innerText();
      assert.ok(!/#bashExplainer|\]\(|\*\*|`/.test(body), `${locale}: raw Markdown left in the dialog`);
      await ctx.close();
    }
  });

  it('wraps long lines in the editor when the editor.wrap setting is on: kept, exported, imported and reset', async () => {
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
    const off = await until('the three lines', metrics, (m) => m.height > 0);
    assert.ok(off.over && off.height < off.short * 1.5, 'off: one row, scrolls sideways');
    await page.locator('#settings-open').click();
    assert.strictEqual(await page.locator('#setting-editor-wrap').isChecked(), false);
    assert.match(await page.locator('[data-key="editor.wrap"]').innerText(), /Wrap long lines/);
    await page.locator('#setting-editor-wrap').check();
    await page.locator('#settings-done').click();
    const on = await until('the wrapped line', metrics, (m) => !m.over);
    assert.ok(on.height > on.short * 2 && !on.over, `on: wrapped, no horizontal scroll ${JSON.stringify(on)}`);
    // Clicking the start of the line puts the cursor on it, and the active line is the whole wrapped line.
    const box = (await page.locator('.cm-line').nth(1).boundingBox())!;
    await page.mouse.click(box.x + 2, box.y + 4);
    assert.match(await page.locator('.cm-activeLine').innerText(), /^echo word0 /);
    // Kept across a reload, and in the export.
    await page.reload();
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText(`echo first\n${long}\necho last`);
    const again = await until('wrapping after reload', metrics, (m) => m.height > 0 && !m.over);
    assert.ok(again.height > again.short || again.height > 30);
    await page.locator('#settings-open').click();
    assert.strictEqual(await page.locator('#setting-editor-wrap').isChecked(), true);
    const text = await page.evaluate('localStorage.getItem("bash-explainer-settings")') as string;
    assert.deepStrictEqual(JSON.parse(text), { 'bashExplainer.editor.wrap': true });
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#settings-export').click()]);
    const file = await download.path();
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { 'bashExplainer.editor.wrap': true });
    // Reset turns it off; importing the file turns it on again.
    await page.locator('#settings-reset').click();
    assert.strictEqual(await page.evaluate('localStorage.getItem("bash-explainer-settings")'), null);
    assert.strictEqual(await page.locator('#setting-editor-wrap').isChecked(), false);
    await page.locator('#settings-done').click();
    assert.ok((await metrics()).over, 'reset: sideways scroll again');
    await page.locator('#settings-open').click();
    await page.locator('#settings-file').setInputFiles(file);
    await until('the import', () => page.locator('#setting-editor-wrap').isChecked(), (c) => c);
    await page.locator('#settings-done').click();
    assert.ok(!(await metrics()).over);
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
    await until('the pitfall', panelText, (t) => /Pitfall/.test(t));
    assert.strictEqual(await page.locator('#problems').isHidden(), true);

    // The dialog lists the settings that apply here, and none that do not.
    await page.locator('#settings-open').click();
    assert.strictEqual(await page.locator('#settings-dialog').isVisible(), true);
    assert.strictEqual(await page.locator('#setting-notes-pitfalls').isChecked(), true);
    assert.strictEqual(await page.locator('#setting-hover-enabled').count(), 0);
    assert.match(await page.locator('.settings-elsewhere').innerText(), /panel\.autoOpen/);
    // A note turned off goes from the explanation at once.
    await page.locator('#setting-notes-pitfalls').uncheck();
    await until('no pitfall', panelText, (t) => !/Pitfall/.test(t));
    // The shell: the script is checked for sh, and the panel's own menu says so.
    await page.locator('#setting-shell').selectOption('sh');
    await until('the problem', () => page.locator('#problem-list').innerText(), (t) => /dbracket/.test(t));
    await until('the panel\'s shell', () => page.locator('#shell').inputValue(), (v) => v === 'sh');
    // A warning code left out.
    await page.locator('#setting-diagnostics-ignore').fill('dbracket');
    await page.locator('#setting-diagnostics-ignore-add').click();
    await until('no problem', () => page.locator('#problems').isHidden(), (h) => h);
    assert.match(await page.locator('[data-key="diagnostics.ignore"] .setting-list').innerText(), /dbracket/);
    // Examples off by kind.
    await page.locator('#setting-examples-disabled-regex').check();
    // The language follows the toolbar, and the other way round.
    await page.locator('#setting-language').selectOption('ja');
    assert.strictEqual(await page.locator('#lang').inputValue(), 'ja');
    assert.strictEqual(await page.locator('#settings-title').textContent(), '設定');
    await page.locator('#settings-done').click();
    await until('the dialog closed', () => page.locator('#settings-dialog').isVisible(), (v) => !v);
    await choose(page, '#lang', 'en');
    // The panel's header is not shown on the page; a shell chosen in the menu is the setting.
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
    await until('the shell after the reload', () => page.locator('#shell').inputValue(), (v) => v === 'dash');
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
    await page.locator('#settings-open').click();
    const area = page.locator('#setting-customCommands');
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
    await page.locator('#settings-open').click();
    await page.locator('#setting-shell').selectOption('sh');
    await page.locator('#setting-notes-pitfalls').uncheck();
    await page.locator('#setting-examples-disabled-regex').check();
    await page.locator('#setting-customCommands').fill('{ "deploy": { "summary": "Deploy to production" } }');
    const saved = () => page.evaluate('localStorage.getItem("bash-explainer-settings")') as Promise<string | null>;
    const before = await saved();
    const expected = {
      'bashExplainer.notes.pitfalls': false, 'bashExplainer.shell': 'sh', 'bashExplainer.examples.disabled': ['regex'],
      'bashExplainer.customCommands': { deploy: { summary: 'Deploy to production' } },
    };
    // Export: the keys of settings.json, only those changed, pretty-printed.
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
      buffer: Buffer.from('{\n  // from VS Code\n  "bashExplainer.shell": "dash",\n  "bashExplainer.hover.enabled": false,\n  "editor.fontSize": 14,\n  "examples": { "placement": "nowhere" },\n}'),
    });
    const status = await until('the second import', () => page.locator('#settings-io-status').innerText(), (t) => /Imported 1 setting;/.test(t));
    assert.match(status, /editor\.fontSize — not a setting/);
    assert.match(status, /examples\.placement — wrong value \(expected one of first, last, bottom\)/);
    assert.match(status, /hover\.enabled — not used on this page/);
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
    await page.locator('#setting-shell').selectOption('dash');
    const panel = page.frames().find((f) => f.url().endsWith('/panel.html'))!;
    await until('the menu\'s shell', () => page.locator('#shell').inputValue(), (v) => v === 'dash');
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  });
});
