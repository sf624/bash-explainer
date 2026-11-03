// The panel's page (media/panel.js) reads messages of its own origin only, and makes a link of an https address only.
// Run for real in headless Chromium (test/support/site.ts), with requests outside this machine blocked: an update from
// another origin (`localhost` against 127.0.0.1) is ignored, whether it is posted to the panel's frame or to the page
// that holds it, and the same update from the panel's own origin is shown (the control). The panel also draws its
// updates when VS Code's preload has hidden `window.parent`, `window.top` and `window.frameElement` from it, as the
// versions before 1.103 do (by `delete`) and the later ones (by assignment).
import * as assert from 'assert';
import * as http from 'http';
import type { AddressInfo } from 'net';
import type { Browser, BrowserContext, Frame } from 'playwright-core';
import { message, servePanel } from './support/panel-page';
import { openSite, until } from './support/site';

describe('the panel: messages and links', function () {
  this.timeout(120000);
  let browser: Browser;
  let base = '';
  let other: http.Server;
  let outside = '';
  /** The line of the update that is posted. */
  const SAID = 'echo from-outside';
  const update = message('en', SAID, 'a.sh');

  before(async function () {
    ({ browser, base } = await openSite(this));
    // The other origin: the same machine under another name.
    other = http.createServer((_, res) => res.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><title>other</title>'));
    await new Promise<void>((r) => other.listen(0, '127.0.0.1', r));
    outside = `http://localhost:${(other.address() as AddressInfo).port}/`;
  });

  after(async () => {
    if (!other) return; // (Skipped: no browser to start.)
    // (The browser keeps its connections open.)
    other.closeAllConnections();
    await new Promise((r) => other.close(r));
  });

  async function context(): Promise<BrowserContext> {
    const ctx = await browser.newContext();
    await ctx.route('**/*', (route) => (/^http:\/\/(127\.0\.0\.1|localhost):/.test(route.request().url()) ? route.continue() : route.abort()));
    return ctx;
  }

  /** Posts `update` to the window `target` (an expression in the page) from the page, and returns once `panel` has had it. */
  async function post(page: import('playwright-core').Page, target: string, panel: Frame): Promise<void> {
    // (This listener comes after the panel's own, so the panel has dealt with the message when it runs.)
    await panel.evaluate("(() => { window.had = new Promise((r) => window.addEventListener('message', () => setTimeout(r), { once: true })); })()");
    await page.evaluate(`(${target}).postMessage(${JSON.stringify(update)}, '*')`);
    await panel.evaluate('window.had');
  }

  const panelFrame = (page: import('playwright-core').Page) => page.frames().find((f) => f.url().endsWith('/panel.html'));

  it('shows an update from its own origin, and ignores one from another origin', async () => {
    // The control: a page of its own origin.
    const ctx = await context();
    const own = await ctx.newPage();
    await own.goto(`${base}stub`);
    await own.evaluate(`document.body.insertAdjacentHTML('beforeend', '<iframe id="f" src="${base}panel.html"></iframe>')`);
    const ownPanel = (await until('the frame', async () => panelFrame(own), (f) => !!f))!;
    await ownPanel.waitForLoadState('load');
    await post(own, "document.getElementById('f').contentWindow", ownPanel);
    await until('the line', () => ownPanel.locator('#line').textContent().then((t) => t ?? ''), (t) => t.includes(SAID));
    // Another origin.
    const page = await ctx.newPage();
    await page.goto(outside);
    await page.evaluate(`document.body.insertAdjacentHTML('beforeend', '<iframe id="f" src="${base}panel.html"></iframe>')`);
    const panel = (await until('the frame', async () => panelFrame(page), (f) => !!f))!;
    await panel.waitForLoadState('load');
    await post(page, "document.getElementById('f').contentWindow", panel);
    assert.strictEqual(await panel.locator('#line').textContent(), '');
    assert.ok(!(await panel.locator('body').innerText()).includes(SAID));
    await ctx.close();
  });

  it("ignores an update from another origin posted to the frame of the page, and keeps the page's own", async () => {
    const ctx = await context();
    const page = await ctx.newPage();
    await page.goto(outside);
    await page.evaluate(`window.opened = window.open(${JSON.stringify(base)})`);
    const popup = await until('the page', async () => ctx.pages().find((p) => p !== page), (p) => !!p);
    const panel = (await until('the frame', async () => panelFrame(popup!), (f) => !!f))!;
    // The page's own update: its editor's line, explained.
    const own = await until('the line', () => panel.locator('#line').textContent().then((t) => t ?? ''), (t) => t.length > 0);
    assert.ok(!own.includes(SAID), own);
    await post(page, 'window.opened.frames[0]', panel);
    assert.strictEqual(await panel.locator('#line').textContent(), own);
    assert.ok(!(await panel.locator('body').innerText()).includes(SAID));
    await ctx.close();
  });

  it('makes a link of an https address only, and shows any other as text', async () => {
    const server = await servePanel();
    const ctx = await context();
    try {
      const page = await ctx.newPage();
      await page.goto(server.url());
      await until('the explanation', () => page.locator('.refs').count(), (n) => n > 0);
      const links = () => page.evaluate("Array.from(document.querySelectorAll('.refs > *')).map((e) => [e.localName, e.getAttribute('href'), e.textContent])") as Promise<[string, string | null, string][]>;
      /** Draws the line again, with the address of each reference given by `url`. */
      const draw = async (label: string, bad?: string[]) => {
        await page.evaluate(`(() => {
          const bad = ${JSON.stringify(bad ?? null)};
          const m = JSON.parse(JSON.stringify(window.MSGS.en));
          if (bad) Object.values(m.manual).forEach((s, i) => (s.url = bad[i % bad.length]));
          m.lineLabel = ${JSON.stringify(label)};
          window.postMessage(m, '*');
        })()`);
        await until(`drawn ${label}`, () => page.locator('#where').textContent(), (t) => !!t?.includes(label));
        return links();
      };
      const before = await links();
      assert.ok(before.length > 1 && before.every(([tag, href]) => tag === 'a' && href!.startsWith('https://')), JSON.stringify(before));
      // Addresses that are not https, or are no address: text, with no link.
      const after = await draw('again', ['javascript:void(0)', 'http://example.com/', 'data:text/html,x', 'not an address', '//example.com/']);
      assert.deepStrictEqual(after, before.map(([, , text]) => ['span', null, text]));
      // And the addresses of the panel's data are links again.
      assert.deepStrictEqual(await draw('third'), before);
    } finally {
      await ctx.close();
      await server.close();
    }
  });

  // What VS Code's preload does to the panel's page: `pre/index.html` deletes the three properties up to VS Code 1.102
  // and assigns them from 1.103 (where the assignment changes nothing, as `parent` and `top` are read-only).
  const PRELOADS: Record<string, string> = {
    'deleted (VS Code 1.85 to 1.102)': 'delete window.parent; delete window.top; delete window.frameElement;',
    'assigned (VS Code 1.103 and later)': 'window.parent = window; window.top = window; window.frameElement = null;',
  };
  for (const [how, preload] of Object.entries(PRELOADS)) {
    it(`draws the update of the page around it when its parent, top and frame element are ${how}`, async () => {
      const server = await servePanel();
      const ctx = await context();
      try {
        await ctx.addInitScript(`if (location.pathname.endsWith('/panel.html')) { try { ${preload} } catch {} }`);
        const page = await ctx.newPage();
        const origin = new URL(server.url()).origin;
        await page.goto(`${origin}/stub`);
        await page.evaluate(`document.body.insertAdjacentHTML('beforeend', '<iframe id="f" src="${server.url()}"></iframe>')`);
        const panel = (await until('the frame', async () => page.frames().find((f) => f.url().includes('/panel.html')), (f) => !!f))!;
        // The panel's own stub drew the line (it answers 'ready' with the first update).
        await until('rows', () => panel.locator('#tree .row').count(), (n) => n > 0);
        // An update from the page around it: another line label.
        const m = (await panel.evaluate('window.MSGS.en')) as object;
        await page.evaluate(`document.getElementById('f').contentWindow.postMessage(${JSON.stringify({ ...m, lineLabel: 'from-the-page' })}, '*')`);
        await until('the update', () => panel.locator('#where').textContent(), (t) => !!t?.includes('from-the-page'));
        assert.ok((await panel.locator('#tree .row').count()) > 0);
      } finally {
        await ctx.close();
        await server.close();
      }
    });
  }
});
