// The web page: no request to another site, and offline, run for real in headless Chromium (the build, the server and the browser
// are shared by all test/web-*.test.ts files: test/support/site.ts). Skipped when no browser can start,
// unless $BASH_EXPLAINER_BROWSER is set (as in CI).
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import type { Browser, Frame, Page } from 'playwright-core';
import { openSite, choose, problemList, setShell, FILES, MARKER, root, until } from './support/site';

describe('the web page: no request to another site, and offline', function () {
  this.timeout(120000);
  let browser: Browser;
  let base = '';

  before(async function () {
    ({ browser, base } = await openSite(this));
  });

  it('explains, checks and shares scripts without any request to another site, and keeps working offline', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base.slice(0, -1) });
    const requests: { url: string; method: string; body: string }[] = [];
    const elsewhere: string[] = [];
    await ctx.route('**/*', (route) => {
      const r = route.request();
      requests.push({ url: r.url(), method: r.method(), body: r.postData() ?? '' });
      if (r.url().startsWith(base)) return route.continue();
      elsewhere.push(r.url());
      return route.abort();
    });
    const errors: string[] = [];
    const watch = (p: Page) => {
      p.on('pageerror', (e) => errors.push(e.message));
      p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    };
    const page = await ctx.newPage();
    watch(page);
    const panel = (p: Page = page): Frame => p.frames().find((f) => f.url().endsWith('/panel.html'))!;
    const text = (sel: string, p?: Page) => async () => (await panel(p)?.locator(sel).textContent().catch(() => '')) ?? '';

    await page.goto(base);
    await until('the first explanation', text('#line'), (t) => t.length > 0);

    // From here on, the browser has no network at all.
    await ctx.setOffline(true);
    const editor = page.locator('.cm-content');
    await editor.click();
    await page.keyboard.press('Control+End');
    // Typed key by key, the keys could arrive out of order in CI ("ecret…" with the "s" at the end).
    await page.keyboard.press('Enter');
    await page.keyboard.insertText(`echo "${MARKER}" | tr a-z A-Z`);
    await until('the typed line explained', text('#line'), (t) => t.includes(MARKER));

    // A worked example, edited: the sed line of the sample (test/fixtures/sample.sh).
    const sedLine = fs.readFileSync(path.join(root, 'test/fixtures/sample.sh'), 'utf8').split('\n').findIndex((l) => l.startsWith('sed -E'));
    await page.keyboard.press('Control+Home');
    for (let i = 0; i < sedLine; i++) await page.keyboard.press('ArrowDown');
    await until('the sed line', text('#line'), (t) => t.startsWith('sed -E'));
    await panel().locator('textarea').first().fill('user=alice');
    await until('the rerun example', text('#tree'), (t) => t.includes('alice=user'));

    // Pointing at a part highlights it in the editor. The pointer goes on the part's row: the middle of
    // the whole item may fall between rows (a nested list's margin), depending on the fonts.
    await panel().locator('#tree > li > .row').first().hover();
    const lit = await until('the highlight', () => page.locator('.cm-bx-highlight').allTextContents(), (t) => t.length > 0);
    assert.ok(lit.join('').startsWith('sed -E'), lit.join(''));

    // A skeleton label (the `while` line of the sample): code in monospace, placeholders apart in muted italics.
    const whileLine = fs.readFileSync(path.join(root, 'test/fixtures/sample.sh'), 'utf8').split('\n').findIndex((l) => l.startsWith('while read'));
    // The keys must reach the editor again: hovering the panel left the focus there.
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+Home');
    for (let i = 0; i < whileLine; i++) await page.keyboard.press('ArrowDown');
    await until('the while line', text('#line'), (t) => t.startsWith('while read'));
    const label = panel().locator('#tree .label').first();
    assert.strictEqual(await label.innerText(), 'while condition do commands done < input.txt');
    // A function, not a string: `evaluate` runs a string as an expression and does not call it. The tests
    // have no DOM types, hence `any`.
    const style = (el: any) => { const c = (globalThis as any).getComputedStyle(el); return { style: c.fontStyle as string, color: c.color as string, family: c.fontFamily as string }; };
    const ph = await label.locator('.ph').first().evaluate(style);
    const parent = await label.evaluate(style);
    assert.strictEqual(ph.style, 'italic');
    assert.notStrictEqual(ph.family, parent.family);
    assert.notStrictEqual(ph.color, parent.color);

    // Another shell: the problems and their quick fixes.
    await setShell(page, 'dash');
    await until('the problems for dash', () => problemList(page), (t) => t.includes('dbracket'));

    // A link to the script, opened online in a new page: the script travels after '#' only.
    // The clipboard is shared by the browser's contexts: empty it, so that the wait below sees this
    // page's link and not one an earlier test copied.
    await page.evaluate('navigator.clipboard.writeText("")');
    await page.locator('#share').click();
    const link = await until('the copied link', () => page.evaluate('navigator.clipboard.readText()') as Promise<string>, (t) => t.includes('#'));
    await ctx.setOffline(false);
    const page2 = await ctx.newPage();
    watch(page2);
    await page2.goto(link);
    await until('the shared script', () => page2.locator('.cm-content').innerText(), (t) => t.includes(MARKER));

    // Japanese, which reloads the panel from the page's own files.
    await choose(page2, '#lang', 'ja');
    await until('the Japanese menu', async () => (await page2.locator('#shell-label').textContent()) ?? '', (t) => t === 'シェル');

    await ctx.close();
    assert.deepStrictEqual(elsewhere, [], 'requests to other sites');
    for (const r of requests) {
      assert.strictEqual(r.method, 'GET', r.url);
      assert.ok(FILES.includes(new URL(r.url).pathname), `unexpected request: ${r.url}`);
      assert.strictEqual(new URL(r.url).search, '', r.url);
      assert.ok(!r.url.includes(MARKER) && !r.body.includes(MARKER), `the script was sent: ${r.url}`);
    }
    assert.deepStrictEqual(errors, []);
  });
});
