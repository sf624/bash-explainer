import * as assert from 'assert';
import type { Browser, BrowserContext, Frame, Page } from 'playwright-core';
import { chooseView, cursorToLine, openSite, stable, until } from './support/site';

// The box "Problems on this line" on the web page (docs/design/panel-redesign.md, P7b), and an error's mark with the Problems strip.

/** Whether the first problem's "more" is open. */
const MORE_OPEN = `document.querySelector('details.problem-more').open`;

describe('the web page: the box of the line\'s problems', function () {
  this.timeout(60000);
  let browser: Browser;
  let base = '';

  before(async function () {
    ({ browser, base } = await openSite(this));
  });

  const open = async (text: string, line = 1, width = 1280, lang: 'en' | 'ja' = 'en'): Promise<{ ctx: BrowserContext; page: Page; panel: () => Frame; errors: string[] }> => {
    const ctx = await browser.newContext({ viewport: { width, height: 800 }, locale: lang === 'ja' ? 'ja-JP' : 'en-US' });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base);
    const panel = (): Frame => page.frames().find((f) => f.url().endsWith('/panel.html'))!;
    await until('the panel', () => Promise.resolve(panel()), (f) => !!f);
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText(text);
    await cursorToLine(page, line);
    await until('the line explained', async () => (await panel().locator('#where').textContent()) ?? '', (t) => new RegExp(`(Ln|line|Line|行) ?${line}\\b`).test(t));
    return { ctx, page, panel, errors };
  };

  it('shows a token\'s error in the box, the strip and the editor together', async () => {
    const { ctx, page, panel, errors } = await open('echo $((09))');
    const heads = await until('the box', () => panel().locator('#problems .problem-head').allTextContents(), (h) => h.length === 1);
    assert.match(heads[0], /^Error This number is not valid/);
    await until('the row\'s mark', () => panel().locator('#tree .row', { hasText: 'ⓧ' }).count(), (n) => n > 0);
    // (The strip counts it: never a mark beside "no problems".)
    await until('the strip', () => page.locator('#problems-counts .count').allTextContents(), (c) => c.join(' ').includes('1'));
    await until('the squiggle', () => page.locator('.cm-lintRange-error, .cm-lintRange').count(), (n) => n > 0);
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  });

  it('says the same in the box and in the row, where the fault is not the part it cannot read', async () => {
    const { ctx, panel, errors } = await open('{ ; }');
    const heads = await until('the box', () => panel().locator('#problems .problem-head').allTextContents(), (h) => h.length === 1);
    assert.match(heads[0], /^Error A command is missing here: the shell stops with a syntax error if it reaches this line\./);
    const row = await until('the row', () => panel().locator('#tree .row', { hasText: 'Syntax error' }).allTextContents(), (r) => r.length > 0);
    assert.match(row[0], /Syntax error: a command is missing here/);
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  });

  it('shows a syntax error in the box, in the words of its row', async () => {
    const { ctx, panel, errors } = await open('echo ok )');
    const heads = await until('the box', () => panel().locator('#problems .problem-head').allTextContents(), (h) => h.length === 1);
    assert.match(heads[0], /^Error `?\)`? cannot stand here: the shell stops with a syntax error if it reaches this line\./);
    const row = await until('the row', () => panel().locator('#tree .row', { hasText: 'Syntax error' }).allTextContents(), (r) => r.length > 0);
    assert.match(row[0], /Syntax error: `?\)`? cannot stand here/);
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  });

  it('has no box on a clean line, and keeps a plain note below it', async () => {
    const { ctx, panel } = await open('echo hello');
    assert.strictEqual(await panel().locator('#problems').isHidden(), true);
    assert.strictEqual(await panel().locator('#problems .note').count(), 0);
    await ctx.close();
    const noted = await open('exit 300');
    await until('the note', () => noted.panel().locator('#notes .note').count(), (n) => n === 1);
    assert.strictEqual(await noted.panel().locator('#problems').isHidden(), true);
    await noted.ctx.close();
  });

  it('links a problem and its row, both ways, with the row\'s parents opened', async () => {
    const { ctx, panel } = await open('echo $((09))');
    const head = panel().locator('#problems .problem-head').first();
    await head.waitFor();
    // (Folded, the row's parents are opened by the link.)
    await panel().locator('#tree > li > .row > button.twisty').first().click();
    await until('the row folded', () => panel().locator('#tree .problem-chip').first().isVisible(), (v) => !v);
    await head.click();
    const chip = panel().locator('#tree .problem-chip').first();
    await until('the row opened', () => chip.isVisible(), (v) => v);
    assert.strictEqual(await panel().evaluate(`document.activeElement.className`), 'problem-chip level-error');
    assert.match(await chip.getAttribute('aria-label') ?? '', /Go to the problem: Error/);
    assert.strictEqual(await panel().evaluate(MORE_OPEN), false);
    await chip.click();
    assert.strictEqual(await panel().evaluate(MORE_OPEN), true);
    assert.match(await panel().evaluate(`document.activeElement.className`) as string, /problem-head/);
    // ("More" stays open when the same line is drawn again, and says the whole text.)
    assert.match(await panel().locator('.problem-text').first().textContent() ?? '', /^Error: Invalid number 09: a number starting with 0/);
    await ctx.close();
  });

  it('brings a problem into view below the panel\'s header, from a row far down', async () => {
    const { ctx, panel } = await open(`echo ${Array.from({ length: 60 }, (_, i) => `w${i}`).join(' ')} $((09))`);
    await panel().locator('#problems .problem-head').first().click();
    const chip = panel().locator('#tree .problem-chip').first();
    await until('the row in view', () => chip.evaluate((e) => e.getBoundingClientRect().bottom <= e.ownerDocument.documentElement.clientHeight), (v) => v);
    assert.ok(await panel().evaluate('window.scrollY') as number > 0);
    await chip.click();
    const places = await stable('the box', () => panel().evaluate(`[document.getElementById('problem-0').getBoundingClientRect().top, document.getElementById('top').getBoundingClientRect().bottom]`) as Promise<number[]>);
    assert.ok(places[0] >= places[1], places.join(' '));
    await ctx.close();
  });

  it('gives a fix to copy, and points to the problem on the line of a construct around', async () => {
    const { ctx, page, panel } = await open('read line\nfor f in $(ls); do\n  echo hi\ndone', 1);
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
    await panel().locator('details.problem-more > summary').first().click();
    assert.strictEqual(await panel().locator('.problem-fix-code').first().textContent(), 'read -r');
    await panel().locator('.problem-fix .tryit-copy').first().click();
    await until('copied', () => panel().locator('.problem-fix .tryit-copy').first().textContent(), (t) => t === 'Copied');
    assert.strictEqual(await page.evaluate('navigator.clipboard.readText()'), 'read -r');
    await cursorToLine(page, 3);
    const pointer = panel().locator('.problem-pointer').first();
    await pointer.waitFor();
    assert.match(await pointer.textContent() ?? '', /↑Caveat on line 2 The output of/);
    await pointer.click();
    await until('the cursor there', () => page.locator('.cm-lineNumbers .cm-activeLineGutter').first().textContent(), (t) => t === '2');
    await ctx.close();
  });

  it('in Reading, a click on a headline opens what it says', async () => {
    const { ctx, page, panel } = await open('echo $((09))');
    await panel().locator('#problems .problem-head').first().waitFor();
    await chooseView(page, 'tree');
    await until('Reading', () => panel().locator('#tree').isHidden(), (v) => v);
    assert.strictEqual(await panel().locator('#problems').isVisible(), true);
    const head = panel().locator('#problems .problem-head').first();
    // (The tooltip says what the click does: here no row is drawn to go to.)
    await head.hover();
    assert.strictEqual(await head.getAttribute('title'), 'Show or hide the details');
    await head.click();
    assert.strictEqual(await panel().evaluate(MORE_OPEN), true);
    await chooseView(page, 'list');
    await until('the list', () => panel().locator('#tree').isVisible(), (v) => v);
    await head.hover();
    assert.strictEqual(await head.getAttribute('title'), 'Go to its row');
    await ctx.close();
  });

  it('leaves a silenced problem out of the box and the strip, and keeps it as a plain note', async () => {
    const { ctx, page, panel, errors } = await open('# bash-explainer disable=arith-invalid-number\necho $((09))', 2);
    await until('the note', () => panel().locator('#notes .note').count(), (n) => n === 1);
    assert.strictEqual(await panel().locator('#problems').isHidden(), true);
    assert.match(await panel().locator('#notes .note').first().textContent() ?? '', /Invalid number/);
    // (The row says what the token is, and keeps its mark: a silence is the reader's own choice.)
    await until('the row\'s mark', () => panel().locator('#tree .row', { hasText: 'ⓧ' }).count(), (n) => n > 0);
    await until('the strip empty', () => page.locator('#problems-counts .count').count(), (n) => n === 0);
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  });

  it('keeps the focus on a pointer when the same line is sent again', async () => {
    const { ctx, page, panel } = await open('for f in *.txt; do\n  echo hi\ndone', 1);
    await panel().evaluate(`window.addEventListener('message', (e) => { if (e.data && e.data.type === 'update') window.LAST = e.data; })`);
    await cursorToLine(page, 3);
    const pointer = panel().locator('.problem-pointer').first();
    await pointer.waitFor();
    await until('the last update', () => panel().evaluate('Boolean(window.LAST)') as Promise<boolean>, (v) => v);
    await pointer.focus();
    assert.strictEqual(await panel().evaluate(`document.activeElement.className.startsWith('problem-pointer')`), true);
    await panel().evaluate(`window.postMessage(window.LAST, '*')`);
    // (A message is handled in a later task: the same line again draws nothing anew.)
    await panel().evaluate(`new Promise((r) => setTimeout(r, 100))`);
    assert.strictEqual(await panel().evaluate(`document.activeElement.className.startsWith('problem-pointer')`), true);
    assert.strictEqual(await panel().locator('.problem-pointer').count(), 1);
    await ctx.close();
  });

  it('gives a chip a target of 40 x 40 on a phone', async () => {
    const { ctx, panel } = await open('echo $((09))', 1, 390);
    const chip = panel().locator('#tree .problem-chip').first();
    await chip.waitFor();
    const box = await stable('the chip', () => chip.boundingBox(), 4);
    assert.ok(box && box.width >= 40 && box.height >= 40, JSON.stringify(box));
    await ctx.close();
  });

  for (const width of [640, 1280]) {
    for (const lang of ['en', 'ja'] as const) {
      it(`clips nothing, with long names, at ${width} in ${lang}`, async () => {
        const name = `a_very_long_variable_name_${'x'.repeat(60)}`;
        const { ctx, panel } = await open(`set -u; read line; rm -rf $${name}/*; echo $((09)) $undefined_${name}`, 1, width, lang);
        await until('the box', () => panel().locator('#problems .problem-head').count(), (n) => n > 2);
        await panel().evaluate(`document.querySelectorAll('details.problem-more').forEach((d) => { d.open = true; })`);
        const out = await stable('the box', () => panel().evaluate(`(() => {
          const w = document.documentElement.clientWidth;
          const past = [...document.querySelectorAll('#problems, #problems *')].filter((e) => e.getBoundingClientRect().right > w + 1).map((e) => e.className);
          return { past, scroll: document.documentElement.scrollWidth - w };
        })()`) as Promise<{ past: string[]; scroll: number }>);
        assert.deepStrictEqual(out, { past: [], scroll: 0 });
        await ctx.close();
      });
    }
  }
});
