// The web page: the file kind, run for real in headless Chromium (the build, the server and the browser
// are shared by all test/web-*.test.ts files: test/support/site.ts). Skipped when no browser can start,
// unless $BASH_EXPLAINER_BROWSER is set (as in CI).
import * as assert from 'assert';
import type { Browser } from 'playwright-core';
import { openSite, choose, pickKind, until } from './support/site';

describe('the web page: the file kind', function () {
  this.timeout(120000);
  let browser: Browser;
  let base = '';

  before(async function () {
    ({ browser, base } = await openSite(this));
  });

  it('chooses the file kind with a compact picker in the top bar (768px and up), by mouse and by keyboard, and the sample follows', async () => {
    for (const [width, height] of [[768, 800], [1280, 800]]) {
      const ctx = await browser.newContext({ viewport: { width, height }, locale: 'en-US' });
      const page = await ctx.newPage();
      await page.goto(base);
      await page.locator('.cm-line').nth(5).waitFor();
      const kind = page.locator('#kind');
      const list = page.locator('#kind-list');
      const text = () => page.evaluate('document.querySelector(".cm-content").innerText') as Promise<string>;
      // A button that says what it opens, with the kind as its name; a short name on a phone, the whole one on a desktop.
      assert.strictEqual(await kind.getAttribute('aria-haspopup'), 'listbox');
      assert.strictEqual(await kind.getAttribute('aria-expanded'), 'false');
      assert.strictEqual(await kind.getAttribute('aria-label'), 'File: Shell script');
      assert.strictEqual(await kind.innerText(), 'Shell script');
      const box = (await kind.boundingBox())!;
      assert.ok(box.height >= 30 && box.width >= 40, JSON.stringify(box));
      assert.strictEqual(await list.isVisible(), false);

      // By mouse: open, choose; the list closes, the sample is the new kind's.
      await kind.click();
      assert.strictEqual(await kind.getAttribute('aria-expanded'), 'true');
      assert.strictEqual(await list.isVisible(), true);
      assert.strictEqual(await list.getAttribute('role'), 'listbox');
      assert.strictEqual(await list.locator('[role="option"]').count(), 9);
      assert.strictEqual(await list.locator('[aria-selected="true"]').innerText(), 'Shell script');
      // The list is in the window.
      const lb = (await list.boundingBox())!;
      assert.ok(lb.x >= 0 && lb.x + lb.width <= width && lb.y + lb.height <= height, JSON.stringify(lb));
      await list.locator('[data-value="dockerfile"]').click();
      assert.strictEqual(await list.isVisible(), false);
      assert.strictEqual(await kind.getAttribute('aria-expanded'), 'false');
      // Only the reading changed; the text, an untouched sample, stays until the sample button loads the new kind's.
      assert.strictEqual(await kind.getAttribute('aria-label'), 'File: Dockerfile');
      assert.ok((await text()).startsWith('#!/usr/bin/env bash'));
      assert.strictEqual(await page.evaluate('document.activeElement.id'), 'kind');
      await page.locator('#sample').click();
      await until('the Dockerfile sample', text, (t) => /^FROM /m.test(t));
      assert.strictEqual(await kind.innerText(), 'Dockerfile');
      // A press outside closes it without a change.
      await kind.click();
      await page.mouse.click(width - 5, height - 5);
      assert.strictEqual(await list.isVisible(), false);
      assert.strictEqual(await kind.getAttribute('aria-label'), 'File: Dockerfile');

      // By keyboard: the focus goes to the chosen one, the arrows move, Escape closes without a change
      // and gives the focus back, Enter chooses.
      await kind.focus();
      await page.keyboard.press('ArrowDown');
      assert.strictEqual(await list.isVisible(), true);
      assert.strictEqual(await page.evaluate('document.activeElement.dataset.value'), 'dockerfile');
      await page.keyboard.press('ArrowDown');
      assert.strictEqual(await page.evaluate('document.activeElement.dataset.value'), 'makefile');
      await page.keyboard.press('Escape');
      assert.strictEqual(await list.isVisible(), false);
      assert.strictEqual(await page.evaluate('document.activeElement.id'), 'kind');
      assert.strictEqual(await kind.getAttribute('aria-label'), 'File: Dockerfile');
      await page.keyboard.press('Enter');
      assert.strictEqual(await list.isVisible(), true);
      await page.keyboard.press('End');
      assert.strictEqual(await page.evaluate('document.activeElement.dataset.value'), 'bats');
      await page.keyboard.press('ArrowUp');
      assert.strictEqual(await page.evaluate('document.activeElement.dataset.value'), 'jenkinsfile');
      await page.keyboard.press('Home');
      assert.strictEqual(await page.evaluate('document.activeElement.dataset.value'), 'shell');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      assert.strictEqual(await list.isVisible(), false);
      assert.strictEqual(await page.evaluate('document.activeElement.id'), 'kind');
      assert.strictEqual(await kind.getAttribute('aria-label'), 'File: Makefile');
      assert.ok(/^FROM /m.test(await text()));
      await page.locator('#sample').click();
      await until('the Makefile sample', text, (t) => !/^FROM /m.test(t) && /^\S+:/m.test(t));
      // Tab closes the list and goes on from the button.
      await kind.focus();
      await page.keyboard.press('Space');
      assert.strictEqual(await list.isVisible(), true);
      await page.keyboard.press('Tab');
      assert.strictEqual(await list.isVisible(), false);
      assert.notStrictEqual(await page.evaluate('document.activeElement.id'), 'kind');

      // The names follow the language.
      await choose(page, '#lang', 'ja');
      await until('ja name', async () => (await kind.getAttribute('aria-label')) ?? '', (t) => t === 'ファイル: Makefile');
      await kind.click();
      assert.strictEqual(await list.getAttribute('aria-label'), 'ファイル');
      assert.strictEqual(await list.locator('[data-value="shell"]').innerText(), 'シェルスクリプト');
      await ctx.close();
    }
  });

  it('keeps the text when the file kind changes (an empty editor gets the sample), and the sample button offers to undo what it replaced', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-US' });
    const page = await ctx.newPage();
    await page.goto(base);
    await page.locator('.cm-line').nth(5).waitFor();
    const text = () => page.evaluate('document.querySelector(".cm-content").innerText') as Promise<string>;
    const toast = page.locator('#status');
    // An untouched sample stays too: only the reading changes.
    await pickKind(page, 'dockerfile');
    assert.strictEqual(await page.locator('#kind').getAttribute('aria-label'), 'File: Dockerfile');
    assert.ok((await text()).startsWith('#!/usr/bin/env bash'));
    // The user's text stays.
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText('echo mine\n');
    await pickKind(page, 'makefile');
    assert.strictEqual((await text()).trim(), 'echo mine');
    assert.strictEqual(await toast.innerText(), '');
    // The sample button replaces it (after the confirmation) and offers to undo; the toast does not cover the top bar.
    page.once('dialog', (d) => void d.accept());
    await page.locator('#sample').click();
    await until('the Makefile sample', text, (t) => t.length > 100);
    assert.strictEqual(await toast.getAttribute('role'), 'status');
    assert.strictEqual(await toast.locator('button').innerText(), 'Undo');
    assert.match(await toast.innerText(), /^Sample loaded/);
    await toast.locator('button').click();
    await until('the text back', text, (t) => t.trim() === 'echo mine');
    assert.strictEqual(await toast.innerText(), '');
    // A second press of the sample button, and typing, which takes the offer away (Undo would undo the typing).
    page.once('dialog', (d) => void d.accept());
    await page.locator('#sample').click();
    await toast.locator('button').waitFor();
    await page.locator('.cm-content').click();
    await page.keyboard.insertText('x');
    await until('the toast gone', () => toast.innerText(), (t) => t === '');
    // No toast when the sample replaced a sample, or nothing.
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Delete');
    await until('an empty editor', text, (t) => !t.trim());
    await page.locator('#sample').click();
    await until('the sample', text, (t) => t.length > 100);
    assert.strictEqual(await toast.innerText(), '');
    await pickKind(page, 'shell');
    await page.locator('#sample').click();
    assert.strictEqual(await toast.innerText(), '');
    // An empty editor gets the sample of the kind chosen.
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Delete');
    await page.keyboard.insertText(' \n ');
    await pickKind(page, 'dockerfile');
    await until('the Dockerfile sample', text, (t) => /^FROM /m.test(t));
    // The words follow the language.
    await choose(page, '#lang', 'ja');
    await page.keyboard.press('Control+End');
    await page.locator('.cm-content').click();
    await page.keyboard.insertText('\n# mine');
    page.once('dialog', (d) => void d.accept());
    await page.locator('#sample').click();
    await until('the Japanese toast', () => toast.innerText(), (t) => t.includes('サンプルを読み込みました'));
    assert.strictEqual(await toast.locator('button').innerText(), '元に戻す');
    await ctx.close();
  });

  it('keeps the text when the file kind changes on a phone, and Undo is a touch target in the toast', async () => {
    const { devices } = await import('playwright-core');
    const ctx = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 740 }, locale: 'en-US' });
    const page = await ctx.newPage();
    await page.goto(base);
    await page.locator('.cm-line').nth(5).waitFor();
    const text = () => page.evaluate('document.querySelector(".cm-content").innerText') as Promise<string>;
    // The sample's pitfalls fill the Problems list, so the editor is short: the read-mode tip would cover it.
    await page.locator('#readtip-close').tap();
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText('echo phone\n');
    await page.locator('#menu-open').tap();
    await page.locator('#kind-menu').selectOption('dockerfile');
    assert.strictEqual((await text()).trim(), 'echo phone');
    page.once('dialog', (d) => void d.accept());
    await page.locator('#menu-sample').tap();
    await until('the Dockerfile sample', text, (t) => /^FROM /m.test(t));
    const undo = page.locator('#status button');
    const box = (await undo.boundingBox())!;
    assert.ok(box.height >= 40 && box.y + box.height <= 740 && box.x >= 0 && box.x + box.width <= 390, JSON.stringify(box));
    await undo.tap();
    await until('the text back', text, (t) => t.trim() === 'echo phone');
    await ctx.close();
  });

  it('has the logo and the name in the top bar of a phone, and the file kind, the copy and the link in the menu; from 320px to 430px, in both themes, nothing overflows and every button is 40px or more', async () => {
    const { devices } = await import('playwright-core');
    for (const scheme of ['light', 'dark'] as const) {
      for (const width of [320, 360, 390, 430]) {
        const ctx = await browser.newContext({ ...devices['iPhone 13'], viewport: { width, height: 740 }, locale: 'en-US', colorScheme: scheme });
        await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base.slice(0, -1) });
        const page = await ctx.newPage();
        await page.goto(base);
        await page.locator('.cm-line').nth(2).waitFor();
        // Read mode on, as on a phone in use.
        await page.locator('#readtip-close').tap().catch(() => undefined);
        await page.locator('#readmode').tap();
        const ids = ['menu-open', 'collapse', 'ref', 'readmode', 'settings-open'];
        const m = (await page.evaluate(`(() => {
          const t = document.querySelector('.top');
          const boxes = ${JSON.stringify(ids)}.map((id) => { const e = document.getElementById(id); const r = e.getBoundingClientRect(); return [id, e.getClientRects().length > 0, r.left, r.right, r.width, r.height]; });
          const name = document.querySelector('.brand-name'), brand = document.querySelector('.brand'), img = document.querySelector('.brand img');
          const shown = (sel) => document.querySelector(sel).getClientRects().length > 0;
          return { h: t.getBoundingClientRect().height, bar: t.scrollWidth <= t.clientWidth, page: document.documentElement.scrollWidth <= document.documentElement.clientWidth, boxes,
            brand: [brand.getBoundingClientRect().left, brand.getBoundingClientRect().right, img.getBoundingClientRect().width], whole: name.scrollWidth <= name.clientWidth, text: name.textContent, rows: Math.round(name.getBoundingClientRect().height / parseFloat(getComputedStyle(name).lineHeight)),
            hidden: ['#kind', '#copy-md', '#share'].map((s) => shown(s)), href: brand.getAttribute('href') };
        })()`)) as { h: number; bar: boolean; page: boolean; boxes: [string, boolean, number, number, number, number][]; brand: [number, number, number]; whole: boolean; text: string; rows: number; hidden: boolean[]; href: string };
        const where = `${width}px ${scheme}`;
        assert.ok(m.h <= 49 && m.bar && m.page && m.whole, `${where}: ${JSON.stringify(m)}`);
        assert.strictEqual(m.text, 'Bash Explainer');
        assert.strictEqual(m.href, './');
        assert.ok(m.brand[2] >= 24, where);
        // One line from 390px, two lines below it.
        assert.strictEqual(m.rows, width >= 390 ? 1 : 2, where);
        assert.deepStrictEqual(m.hidden, [false, false, false], where);
        for (const [id, shown, left, right, w, h] of m.boxes) {
          assert.ok(shown && left >= 0 && right <= width + 0.5 && w >= 40 && h >= 40, `${where}: ${id} ${[shown, left, right, w, h]}`);
        }
        // In order, and not on each other: the menu, the logo and name, then the buttons.
        assert.ok(m.brand[0] >= m.boxes[0][3] - 0.5 && m.boxes[1][2] >= m.brand[1] - 0.5, where);
        for (let i = 1; i < m.boxes.length; i++) assert.ok(m.boxes[i][2] >= m.boxes[i - 1][3] - 0.5, `${where}: ${m.boxes[i][0]}`);
        if (scheme === 'light' && (width === 320 || width === 390)) {
          // The menu's selects share one column (same left edge and width), and no kind name is cut.
          await page.locator('#menu-open').tap();
          const cols = (await page.evaluate(`(() => { const c = document.createElement('canvas').getContext('2d'); return [...document.querySelectorAll('#drawer .field select')].filter((s) => s.clientWidth).map((s) => { const r = s.getBoundingClientRect(); const cs = getComputedStyle(s); c.font = cs.font; const room = s.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight); return [s.id, Math.round(r.left * 10) / 10, Math.round(r.width * 10) / 10, Math.max(...[...s.options].map((o) => c.measureText(o.text).width)) <= room]; }); })()`)) as [string, number, number, boolean][];
          assert.ok(cols.length >= 5 && cols.every(([, l, w, fits]) => l === cols[0][1] && w === cols[0][2] && fits), `${where}: ${JSON.stringify(cols)}`);
          await page.locator('#menu-close').tap();
        }
        if (scheme === 'light' && (width === 320 || width === 390)) {
          // The copy and the link work from the menu.
          await page.evaluate('navigator.clipboard.writeText("")');
          await page.locator('.cm-line').nth(7).tap();
          await page.locator('#menu-open').tap();
          await page.locator('#menu-copy').tap();
          assert.strictEqual(await page.locator('#drawer').evaluate((d) => (d as unknown as { open: boolean }).open), false);
          const md = await until('the copy', () => page.evaluate('navigator.clipboard.readText()') as Promise<string>, (t) => t.length > 0);
          assert.match(md, /`/);
          await page.evaluate('navigator.clipboard.writeText("")');
          await page.locator('#menu-open').tap();
          await page.locator('#menu-share').tap();
          const link = await until('the link', () => page.evaluate('navigator.clipboard.readText()') as Promise<string>, (t) => t.includes('#'));
          assert.ok(link.startsWith(base), link);
        }
        await ctx.close();
      }
    }
  });

  it('chooses the file kind from the menu on a phone, the sample follows, and the names follow the language', async () => {
    const { devices } = await import('playwright-core');
    const ctx = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 740 }, locale: 'en-US' });
    const page = await ctx.newPage();
    await page.goto(base);
    await page.locator('.cm-line').nth(5).waitFor();
    const text = () => page.evaluate('document.querySelector(".cm-content").innerText') as Promise<string>;
    assert.strictEqual(await page.locator('#kind').isVisible(), false);
    await page.locator('#menu-open').tap();
    const select = page.locator('#kind-menu');
    // The first control of the menu, named "File", with every kind.
    assert.strictEqual(await select.isVisible(), true);
    assert.strictEqual(await select.getAttribute('aria-label'), 'File');
    assert.strictEqual(await select.inputValue(), 'shell');
    assert.strictEqual(await select.locator('option').count(), 9);
    assert.strictEqual(await page.evaluate("document.querySelector('#drawer .field select').id"), 'kind-menu');
    assert.ok((await select.boundingBox())!.height >= 40);
    const loadSample = async () => {
      await page.locator('#menu-sample').tap();
      await page.locator('#menu-open').tap();
    };
    await select.selectOption('dockerfile');
    assert.strictEqual(await select.inputValue(), 'dockerfile');
    assert.ok((await text()).startsWith('#!/usr/bin/env bash'), 'the text stays');
    await loadSample();
    await until('the Dockerfile sample', text, (t) => /^FROM /m.test(t));
    // The last kind, bats, and its sample.
    await select.selectOption('bats');
    assert.strictEqual(await select.inputValue(), 'bats');
    assert.ok(/^FROM /m.test(await text()), 'the text stays');
    await loadSample();
    await until('the bats sample', text, (t) => /^@test /m.test(t));
    await select.selectOption('dockerfile');
    await loadSample();
    await until('the Dockerfile sample again', text, (t) => /^FROM /m.test(t));
    // The language: the label and the names of the kinds.
    await choose(page, '#lang', 'ja');
    await until('ja label', async () => (await select.getAttribute('aria-label')) ?? '', (t) => t === 'ファイル');
    assert.strictEqual(await page.locator('#kind-label').textContent(), 'ファイル');
    assert.strictEqual(await select.locator('option[value="shell"]').textContent(), 'シェルスクリプト');
    assert.strictEqual(await select.inputValue(), 'dockerfile');
    await ctx.close();
  });
});
