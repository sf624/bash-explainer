// The panel's side of `bashExplainer.panel.colors` (media/panel.js), in headless Chromium (test/support/panel-page.ts):
// asked by `themeWatch`, it reports what it draws on and its own colour of each role (`themeBase`), again when the
// theme changes, and sets the role colours of `themeColours` (the roles it groups, a builtin with the commands, apart).
// Skipped when no browser can start, unless $BASH_EXPLAINER_BROWSER is set.
import * as assert from 'assert';
import type { Browser, Page } from 'playwright-core';
import { panelPalette, paletteVars, type PanelBase } from '../src/ui/themePalette';
import { ROLES, type Role } from '../src/ui/themeTokens';
import { PanelServer, servePanel } from './support/panel-page';
import { until } from './support/site';

describe('the VS Code panel: colours from the theme', function () {
  this.timeout(60000);
  let browser: Browser | undefined;
  let panel: PanelServer;

  before(async function () {
    if (Number(process.versions.node.split('.')[0]) < 20) return this.skip();
    try {
      const { chromium } = await import('playwright-core');
      browser = await chromium.launch();
    } catch (e) {
      if (process.env.BASH_EXPLAINER_BROWSER) throw e;
      return this.skip();
    }
    panel = await servePanel('ll -a "$HOME" 2>/dev/null | grep -v x; cd /tmp');
  });

  after(async () => {
    await browser?.close();
    await panel?.close();
  });

  const bases = (page: Page) => page.evaluate('window.POSTED.filter((m) => m.type === "themeBase").map((m) => m.base)') as Promise<PanelBase[]>;
  const colourOf = (page: Page, kind: string) => page.evaluate(`getComputedStyle(document.querySelector('#line .kind-${kind}')).color`) as Promise<string>;
  const send = (page: Page, msg: unknown) => page.evaluate(`window.postMessage(${JSON.stringify(msg)}, '*')`);

  it('reports its colours when asked, sets the theme\'s, and reports again when the theme changes', async () => {
    const page = await browser!.newPage({ viewport: { width: 700, height: 400 } });
    await page.goto(panel.url('dark'));
    await until('the line', () => page.locator('#line .kind-builtin').count(), (n) => n > 0);
    // Not asked: nothing reported (the web page never asks).
    await page.waitForTimeout(200);
    assert.deepStrictEqual(await bases(page), []);
    const classicBuiltin = await colourOf(page, 'builtin');
    assert.strictEqual(classicBuiltin, await colourOf(page, 'command'));

    await send(page, { type: 'themeWatch', on: true });
    const [base] = await until('the report', () => bases(page), (b) => b.length === 1);
    assert.strictEqual(base.highContrast, false);
    assert.deepStrictEqual(base.backgrounds.slice(0, 2), ['#1f1f1f', '#2b2b2b']);
    assert.ok(base.foreground);
    assert.deepStrictEqual(Object.keys(base.classic), [...ROLES]);
    assert.strictEqual(base.classic.builtin, classicBuiltin);
    assert.strictEqual(base.classic.string, base.classic.argument);

    // The host's answer: each role its own variable; a builtin apart from a command.
    const theme = Object.fromEntries(ROLES.map((r) => [r, undefined])) as Record<Role, string | undefined>;
    Object.assign(theme, { command: '#dcdcaa', builtin: '#4ec9b0' });
    await send(page, { type: 'themeColours', vars: paletteVars(panelPalette('theme', theme, base)) });
    await until('the colours', () => colourOf(page, 'builtin'), (c) => c === 'rgb(78, 201, 176)');
    assert.strictEqual(await colourOf(page, 'command'), 'rgb(220, 220, 170)');

    // VS Code changes the theme: its variables on <html>, its kind on <body>. The panel reports its own colours again.
    await page.evaluate(`document.documentElement.style.setProperty('--vscode-editor-background', '#ffffff'); document.body.classList.replace('vscode-dark', 'vscode-light')`);
    const again = await until('the second report', () => bases(page), (b) => b.length === 2);
    assert.strictEqual(again[1].backgrounds[0], '#ffffff');
    assert.strictEqual(again[1].classic.command, 'rgb(1, 97, 248)');
    // (The theme's colours stay until the host answers.)
    assert.strictEqual(await colourOf(page, 'builtin'), 'rgb(78, 201, 176)');

    // Back to the panel's own colours.
    await send(page, { type: 'themeWatch', on: false });
    await until('the own colours', () => colourOf(page, 'builtin'), (c) => c === 'rgb(1, 97, 248)');
    await page.evaluate(`document.body.classList.replace('vscode-light', 'vscode-dark')`);
    await page.waitForTimeout(200);
    assert.strictEqual((await bases(page)).length, 2);
    await page.close();
  });
});
