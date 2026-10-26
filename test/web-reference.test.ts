// The web page: the quick reference (the book button of the panel), run for real in headless Chromium
// (test/support/site.ts). Skipped when no browser can start, unless $BASH_EXPLAINER_BROWSER is set (as in CI).
import * as assert from 'assert';
import type { Browser } from 'playwright-core';
import { openSite, until } from './support/site';
import { quickReference } from '../src/ui/reference';

describe('the web page: the quick reference', function () {
  this.timeout(120000);
  let browser: Browser;
  let base = '';

  before(async function () {
    ({ browser, base } = await openSite(this));
  });

  it('lists every entry, with the commands sorted by name, and a search narrows the list', async () => {
    const page = await (await browser.newContext({ locale: 'en-US' })).newPage();
    await page.goto(base);
    const panel = (await until('the panel', async () => page.frames().find((f) => f.url().endsWith('/panel.html')), (f) => !!f))!;
    await page.locator('#ref').click();
    const expected = quickReference('en');
    // The list once stopped after 300 entries, without saying so.
    await until('every entry', () => panel.locator('#ref-list .ref-row').count(), (n) => n === expected.length);
    const rows = await panel.locator('#ref-list .ref-row > code').evaluateAll((els) => els.map((e) => e.textContent));
    assert.deepStrictEqual(rows, expected.map((e) => e.syntax));
    const commands = expected.filter((e) => e.category === 'Commands').map((e) => e.syntax);
    assert.ok(commands.length > 400);
    assert.deepStrictEqual(commands, [...commands].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    assert.strictEqual(rows[rows.length - 1], commands[commands.length - 1]);
    await panel.locator('#ref-search').focus();
    await page.keyboard.insertText('2>&1');
    await until('the hits', () => panel.locator('#ref-list .ref-row').count(), (n) => n > 0 && n < 10);
  });
});
