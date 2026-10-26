// The web page: links to a script keep the script out of the address bar, run for real in headless Chromium
// (the build, the server and the browser are shared by all test/web-*.test.ts files: test/support/site.ts).
// Skipped when no browser can start, unless $BASH_EXPLAINER_BROWSER is set (as in CI).
import * as assert from 'assert';
import type { Browser, BrowserContext, Page } from 'playwright-core';
import { openSite, until } from './support/site';

describe('the web page: share links', function () {
  this.timeout(120000);
  let browser: Browser;
  let base = '';

  before(async function () {
    ({ browser, base } = await openSite(this));
  });

  const open = async (): Promise<{ ctx: BrowserContext; page: Page }> => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-US' });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base.slice(0, -1) });
    return { ctx, page: await ctx.newPage() };
  };
  const text = (page: Page) => page.evaluate('document.querySelector(".cm-content").innerText') as Promise<string>;
  const hash = (page: Page) => page.evaluate('location.hash') as Promise<string>;
  const link = (script: string, extra = '') => `${base}#${extra}t=${Buffer.from(script).toString('base64url')}`;

  it('copies the link to the clipboard only: the address bar keeps no fragment', async () => {
    const { ctx, page } = await open();
    await page.goto(base);
    await page.locator('.cm-content').click();
    await page.keyboard.insertText('echo COPIED\n');
    await until('the typed script', () => text(page), (t) => t.includes('COPIED'));
    await page.evaluate('navigator.clipboard.writeText("")');
    await page.locator('#share').click();
    const url = await until('the copied link', () => page.evaluate('navigator.clipboard.readText()') as Promise<string>, (t) => t.startsWith(`${base}#`));
    assert.match(url, /#lang=en&kind=shell&(z|t)=/);
    assert.strictEqual(await hash(page), '');
    assert.strictEqual(page.url(), base);
    // The copied link opens the script, in another page, with no fragment left.
    const other = await ctx.newPage();
    await other.goto(url);
    await until('the shared script', () => text(other), (t) => t.includes('COPIED'));
    assert.strictEqual(await hash(other), '');
    assert.strictEqual(other.url(), base);
    await ctx.close();
  });

  it('reads the fragment of a link and removes it; a reload keeps the script; the history is not extended', async () => {
    const { ctx, page } = await open();
    await page.goto('about:blank');
    await page.goto(link('echo RELOADED\n', 'lang=ja&kind=shell&'));
    await until('the shared script', () => text(page), (t) => t.includes('RELOADED'));
    assert.strictEqual(await hash(page), '');
    assert.strictEqual(page.url(), base);
    assert.strictEqual(await page.evaluate('document.documentElement.lang'), 'ja');
    assert.strictEqual(await page.evaluate('history.length'), 2);
    // A reload: the script and the language stay.
    await page.reload();
    await until('the script after the reload', () => text(page), (t) => t.includes('RELOADED'));
    assert.strictEqual(await page.evaluate('document.documentElement.lang'), 'ja');
    assert.strictEqual(await hash(page), '');
    // Back and forward: no entry of the fragment was added, and the page comes back with the script.
    await page.goBack();
    assert.strictEqual(page.url(), 'about:blank');
    await page.goForward();
    await until('the script after going forward', () => text(page), (t) => t.includes('RELOADED'));
    assert.strictEqual(page.url(), base);
    // The same address typed again in this tab is a plain visit: the sample.
    await page.goto('about:blank');
    await page.goto(base);
    await until('the sample', () => text(page), (t) => !t.includes('RELOADED') && t.length > 50);
    await ctx.close();
  });

  it('opens a link twice in a tab (the second replaces the first), and drops a link pasted into the open page', async () => {
    const { ctx, page } = await open();
    await page.goto(link('echo FIRST\n'));
    await until('the first script', () => text(page), (t) => t.includes('FIRST'));
    await page.goto('about:blank');
    await page.goto(link('echo SECOND\n'));
    await until('the second script', () => text(page), (t) => t.includes('SECOND'));
    await page.reload();
    await until('the second after a reload', () => text(page), (t) => t.includes('SECOND') && !t.includes('FIRST'));
    // A link pasted into the address bar of the open page (a change of the fragment only) leaves no fragment.
    await page.evaluate(`location.hash = 't=${Buffer.from('echo PASTED\n').toString('base64url')}'`);
    await until('no fragment', () => hash(page), (h) => h === '');
    // The open page does not change under the user; the reload reads the link, as it did when the fragment stayed.
    assert.ok((await text(page)).includes('SECOND'));
    await page.reload();
    await until('the pasted link after a reload', () => text(page), (t) => t.includes('PASTED'));
    await ctx.close();
  });

  it('keeps other fragments, and ignores a broken link', async () => {
    const { ctx, page } = await open();
    await page.goto(`${base}#anchor`);
    await page.locator('.cm-line').nth(5).waitFor();
    assert.strictEqual(await hash(page), '#anchor');
    const broken = await ctx.newPage();
    await broken.goto(`${base}#kind=makefile&z=!!!`);
    await broken.locator('.cm-line').nth(5).waitFor();
    assert.strictEqual(await hash(broken), '');
    await ctx.close();
  });

  it('works without session storage: the link opens, a reload shows the sample', async () => {
    const { ctx, page } = await open();
    await ctx.addInitScript("Object.defineProperty(window, 'sessionStorage', { get() { throw new Error('blocked'); } });");
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(link('echo NOSTORE\n'));
    await until('the script', () => text(page), (t) => t.includes('NOSTORE'));
    assert.strictEqual(await hash(page), '');
    await page.reload();
    await page.locator('.cm-line').nth(5).waitFor();
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  });
});
