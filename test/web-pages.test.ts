// The web page: release, development and preview pages, the panel view and the comparison, run for real in headless Chromium (the build, the server and the browser
// are shared by all test/web-*.test.ts files: test/support/site.ts). Skipped when no browser can start,
// unless $BASH_EXPLAINER_BROWSER is set (as in CI).
import * as assert from 'assert';
import type { Browser } from 'playwright-core';
import { openSite, choose, until } from './support/site';

describe('the web page: release, development and preview pages, the panel view and the comparison', function () {
  this.timeout(120000);
  let browser: Browser;
  let base = '';

  before(async function () {
    ({ browser, base } = await openSite(this));
  });

  it('switches between the release page and the development page, keeping the script and the language', async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(base);
    assert.strictEqual(await page.locator('#channel-banner').isHidden(), true);
    // The link to the development version is in the menu.
    assert.strictEqual(await page.locator('#dev-link').isVisible(), false);
    await page.locator('#menu-open').click();
    assert.strictEqual(await page.locator('#dev-link').isVisible(), true);
    await page.locator('#menu-close').click();
    await choose(page, '#lang', 'ja');
    await page.locator('.cm-content').click();
    await page.keyboard.press('Enter');
    await page.keyboard.insertText('echo NEXTMARK');
    await choose(page, '#channel', 'next');
    await page.waitForURL(`${base}next/**`);
    await until('the typed script', () => page.locator('.cm-content').innerText(), (t) => t.includes('NEXTMARK'));
    assert.strictEqual(await page.locator('#channel-banner').isVisible(), true);
    assert.match(await page.locator('#banner-text').innerText(), /開発版/);
    assert.strictEqual(await page.locator('#channel').inputValue(), 'next');
    assert.strictEqual(await page.locator('meta[name=robots]').getAttribute('content'), 'noindex');
    // A link copied here points to this page.
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base.slice(0, -1) });
    // The clipboard is shared by the browser's contexts: empty it, so that the wait below sees this
    // page's link and not one an earlier test copied.
    await page.evaluate('navigator.clipboard.writeText("")');
    await page.locator('#share').click();
    const link = await until('the copied link', () => page.evaluate('navigator.clipboard.readText()') as Promise<string>, (t) => t.includes('#'));
    assert.ok(link.startsWith(`${base}next/#`), link);
    await choose(page, '#channel', 'release');
    await page.waitForURL(new RegExp(`^${base}#`));
    await until('the script back', () => page.locator('.cm-content').innerText(), (t) => t.includes('NEXTMARK'));
    await ctx.close();
  });

  it('shows the preview of a pull request with a banner, and switches to the other pages', async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${base}pr/123/`);
    assert.strictEqual(await page.locator('#channel-banner').isVisible(), true);
    assert.match(await page.locator('#banner-text').innerText(), /^Preview of pull request #123 \(commit [0-9a-f]{7}\)\. Not released\.$/);
    assert.strictEqual(await page.locator('#banner-pr').getAttribute('href'), 'https://github.com/sf624/bash-explainer/pull/123');
    assert.match((await page.locator('#banner-commit').getAttribute('href')) ?? '', /\/commit\/[0-9a-f]{7}$/);
    assert.strictEqual(await page.locator('meta[name=robots]').getAttribute('content'), 'noindex');
    assert.strictEqual(await page.locator('#channel').inputValue(), 'pr');
    assert.strictEqual(await page.locator('#dev-link').isHidden(), true);
    await choose(page, '#lang', 'ja');
    assert.match(await page.locator('#banner-text').innerText(), /^プルリクエスト #123（コミット [0-9a-f]{7}）のプレビュー。未リリース。$/);
    await choose(page, '#channel', 'next');
    await page.waitForURL(`${base}next/**`);
    await page.goBack();
    await choose(page, '#channel', 'release');
    await page.waitForURL(new RegExp(`^${base}#`));
    await ctx.close();
  });

  it('shows only the explanation panel with ?view=panel, and explains a script posted to it', async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    // The page around: a stub that posts a script to the frame and keeps what the frame says.
    await page.goto(`${base}stub`); // a 404 page of the same origin, with no content security policy
    await page.evaluate(`window.got = []; window.addEventListener('message', (e) => window.got.push(e.data));
      document.body.insertAdjacentHTML('beforeend', '<iframe id="f" src="${base}pr/123/?view=panel" style="width:700px;height:500px"></iframe>');`);
    const ready = await until('the handshake', () => page.evaluate('window.got.find((m) => m.type === "bx-ready") || null') as Promise<Record<string, string> | null>, (m) => !!m);
    assert.strictEqual(ready!.channel, 'pr');
    assert.strictEqual(ready!.pr, '123');
    const f = page.frames().find((x) => x.url().includes('view=panel'))!;
    assert.strictEqual(await f.locator('.top').isHidden(), true);
    assert.strictEqual(await f.locator('#splitter').isHidden(), true);
    assert.strictEqual(await f.locator('#channel-banner').isHidden(), true);
    assert.strictEqual(await f.locator('#editor').isHidden(), true);
    await page.evaluate(`document.getElementById('f').contentWindow.postMessage({ type: 'bx-state', text: 'echo one\\nsort -u a.txt\\n', kind: 'shell', line: 1, col: 0, lang: 'en', theme: 'auto', choice: {} }, location.origin)`);
    const inner = () => page.frames().find((x) => x.url().endsWith('/pr/123/panel.html') && x !== page.mainFrame())!;
    await until('the line explained', async () => (await inner()?.locator('#line').textContent().catch(() => '')) ?? '', (t) => t.includes('sort -u'));
    // The panel fills the frame.
    const box = await f.locator('#panel').boundingBox();
    assert.ok(box && box.width >= 699 && box.height >= 499, JSON.stringify(box));
    // A click on a row asks the page around to select.
    await inner().locator('.row .label').nth(1).click();
    const reveal = await until('the reveal', () => page.evaluate('window.got.find((m) => m.type === "bx-reveal") || null') as Promise<{ span: { start: { line: number } } } | null>, (m) => !!m);
    assert.strictEqual(reveal!.span.start.line, 1);
    // The settings come with the script: here, no worked examples. The panel's ⚙ button is hidden, as there is no dialog to open.
    assert.match(await inner().locator('#main').innerText(), /Example/);
    await page.evaluate(`document.getElementById('f').contentWindow.postMessage({ type: 'bx-state', text: 'echo one\\nsort -u a.txt\\n', kind: 'shell', line: 1, col: 0, lang: 'en', theme: 'auto', choice: {}, settings: { 'bashExplainer.examples.enabled': false } }, location.origin)`);
    await until('no example', () => inner().locator('#main').innerText(), (t) => !/Example/.test(t));
    assert.strictEqual(await inner().locator('#settings').isHidden(), true);
    await ctx.close();
  });

  it('keeps the header and the source line of the panel together at the top where the header shows (VS Code)', async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${base}stub`);
    await page.evaluate(`window.got = []; window.addEventListener('message', (e) => window.got.push(e.data));
      document.body.insertAdjacentHTML('beforeend', '<iframe id="f" src="${base}pr/123/?view=panel" style="width:300px;height:420px"></iframe>');`);
    await until('the handshake', () => page.evaluate('window.got.find((m) => m.type === "bx-ready") || null') as Promise<unknown>, (m) => !!m);
    const text = 'grep -rn "ERROR $USER" ./src 2>&1 | sort | uniq -c | sort -rn | head -n 5 | tee out.txt\n';
    await page.evaluate(`document.getElementById('f').contentWindow.postMessage({ type: 'bx-state', text: ${JSON.stringify(text)}, kind: 'shell', line: 0, col: 0, lang: 'en', theme: 'auto', choice: {} }, location.origin)`);
    const inner = () => page.frames().find((x) => x.url().endsWith('/pr/123/panel.html') && x !== page.mainFrame())!;
    await until('the line explained', async () => (await inner()?.locator('#line').textContent().catch(() => '')) ?? '', (t) => t.includes('ERROR'));
    const geometry = () => inner().evaluate(`(() => {
      const h = document.querySelector('header').getBoundingClientRect();
      const l = document.getElementById('line').getBoundingClientRect();
      const lh = parseFloat(getComputedStyle(document.querySelector('.where')).lineHeight) || 20;
      return { hTop: h.top, hBottom: h.bottom, hHeight: h.height, lTop: l.top, scrollY: window.scrollY, max: document.documentElement.scrollHeight - innerHeight, lh };
    })()`) as Promise<{ hTop: number; hBottom: number; hHeight: number; lTop: number; scrollY: number; max: number; lh: number }>;
    const start = await geometry();
    assert.ok(start.max > 50, 'the explanation scrolls');
    assert.ok(start.hHeight > start.lh * 2.2, `the header wraps to two rows: ${JSON.stringify(start)}`);
    assert.ok(Math.abs(start.lTop - start.hBottom) < 9, JSON.stringify(start));
    for (const y of [3, 20, 100000]) {
      await inner().evaluate(`window.scrollTo(0, ${y})`);
      const at = await until('scrolled', geometry, (x) => x.scrollY > 0);
      assert.ok(Math.abs(at.hTop - start.hTop) < 0.5, JSON.stringify({ y, start, at }));
      assert.ok(Math.abs(at.lTop - start.lTop) < 0.5, JSON.stringify({ y, start, at }));
      assert.ok(Math.abs(at.lTop - at.hBottom - (start.lTop - start.hBottom)) < 1, JSON.stringify({ y, start, at }));
    }
    const above = await inner().evaluate(`(() => {
      const line = document.getElementById('line');
      const r = line.getBoundingClientRect();
      const out = [];
      for (let y = 0; y <= r.bottom; y++) for (let x = 0; x < innerWidth; x += 2) {
        const e = document.elementFromPoint(x, y);
        if (e && e !== document.body && e !== document.documentElement && e.id !== 'top' && !line.contains(e) && !document.querySelector('header').contains(e)) out.push(x + ',' + y + ' ' + e.tagName + '.' + e.className);
      }
      return out.slice(0, 5);
    })()`) as string[];
    assert.deepStrictEqual(above, []);
    await ctx.close();
  });

  it('compares a pull request with main: typing goes to both panels, and a click in either selects in the editor', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`${base}pr/123/`);
    assert.strictEqual(await page.locator('#banner-compare').textContent(), 'Compare with main');
    await page.locator('#banner-compare').click();
    await page.waitForURL(`${base}pr/123/compare.html**`);
    await page.locator('.cm-content').waitFor();
    const mine = () => page.frames().find((f) => f.url().endsWith('/pr/123/panel.html'));
    const main = () => page.frames().find((f) => f.url().endsWith('/next/panel.html'));
    await until('both panels', () => Promise.resolve([mine(), main()]), (fs) => fs.every(Boolean));
    // Three columns of about the same width.
    const cols = await page.locator('.compare > section').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().width)));
    assert.strictEqual(cols.length, 3);
    assert.ok(Math.max(...cols) - Math.min(...cols) <= 2, cols.join());
    await until('the headers', () => page.locator('.copy-head').allInnerTexts(), (t) => /^PR #123 \([0-9a-f]{7}\)$/.test(t[1]) && /^main \([0-9a-f]{7}\)$/.test(t[2]));
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText('echo hello | tr a-z A-Z');
    for (const f of [mine, main]) await until('the line explained', async () => (await f()!.locator('#line').textContent().catch(() => '')) ?? '', (t) => t.includes('tr a-z'));
    // A click on a tree row in either panel selects its token in the editor.
    for (const [f, text] of [[mine, 'echo'], [main, 'tr']] as const) {
      await page.keyboard.press('Control+Home');
      await page.evaluate('window.getSelection().removeAllRanges()');
      const before = await page.locator('.cm-selectionBackground').count();
      await f()!.locator('.row .label', { hasText: new RegExp(`^${text}$`) }).first().click();
      await until(`${text} selected`, () => page.evaluate('document.querySelector(".cm-content").ownerDocument.defaultView.getSelection().toString()') as Promise<string>, (t) => t.trim().startsWith(text) && t.length < 20);
      void before;
    }
    // The editor's own choice of language reaches both.
    await choose(page, '#lang', 'ja');
    for (const f of [mine, main]) await until('Japanese', async () => (await f()!.locator('#tree').textContent().catch(() => '')) ?? '', (t) => /[ぁ-ん]/.test(t));
    await ctx.close();
  });

  it('says so when the other copy of the comparison does not answer, and carries the script over from the page', async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    // The release page of the stub has no panel-only view: it is a page that never answers.
    await page.route(`${base}?view=panel`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<p>old page</p>' }));
    await page.goto(`${base}next/`);
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText('echo CARRIED');
    assert.strictEqual(await page.locator('#banner-compare').textContent(), 'Compare with release');
    await page.locator('#banner-compare').click();
    await page.waitForURL(`${base}next/compare.html**`);
    await until('the script', () => page.locator('.cm-content').innerText(), (t) => t.includes('CARRIED'));
    assert.strictEqual(await page.locator('#note-other').isVisible(), false);
    await until('the message', () => page.locator('#note-other').isVisible(), (v) => v, 15000);
    assert.match(await page.locator('#note-other').innerText(), /^This version cannot be compared/);
    assert.strictEqual(await page.locator('#note-this').isHidden(), true);
    assert.strictEqual(await page.locator('#frame-other').isHidden(), true);
    // The same for a page that is not there.
    await page.unroute(`${base}?view=panel`);
    await page.route(`${base}?view=panel`, (route) => route.fulfill({ status: 404, body: '' }));
    await page.reload();
    await until('the message', () => page.locator('#note-other').isVisible(), (v) => v, 15000);
    assert.strictEqual(await page.locator('#frame-this').isVisible(), true);
    await ctx.close();
  });

  it('draws the compare page without sideways scrolling on a phone, and stacks it below 1000px', async () => {
    const { devices } = await import('playwright-core');
    const ctx = await browser.newContext({ ...devices['iPhone 13'] });
    const page = await ctx.newPage();
    await page.goto(`${base}pr/123/compare.html`);
    await page.locator('.cm-line').first().waitFor();
    await until('the headers', () => page.locator('.copy-head').allInnerTexts(), (t) => /^PR #123/.test(t[1]) && /^main/.test(t[2]));
    assert.strictEqual(await page.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), true);
    const tops = await page.locator('.compare > section').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
    assert.ok(tops[0] < tops[1] && tops[1] < tops[2], tops.join());
    await ctx.close();
    const wide = await browser.newContext({ viewport: { width: 900, height: 800 } });
    const p2 = await wide.newPage();
    await p2.goto(`${base}pr/123/compare.html`);
    await p2.locator('.cm-line').first().waitFor();
    const rects = await p2.locator('.compare > section').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { top: Math.round(r.top), left: Math.round(r.left) }; }));
    assert.strictEqual(rects[1].top, rects[2].top);
    assert.ok(rects[0].top < rects[1].top && rects[1].left < rects[2].left, JSON.stringify(rects));
    assert.strictEqual(await p2.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), true);
    await wide.close();
  });

  it('lists the problems of the script on the compare page, without a page error', async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${base}pr/123/compare.html`);
    await page.locator('.cm-line').first().waitFor();
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText('#!/bin/sh\n[[ -f a ]] && echo ok');
    const items = await until('the problems', () => page.locator('#problem-list li').count(), (n) => n > 0, 15000);
    assert.ok(items > 0);
    assert.strictEqual(await page.locator('#problems').isVisible(), true);
    assert.strictEqual(await page.locator('#problems-count').textContent(), String(items));
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  });
});
