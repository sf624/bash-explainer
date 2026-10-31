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
      // The text was an untouched sample: the new kind's sample takes its place, with no question.
      assert.strictEqual(await kind.getAttribute('aria-label'), 'File: Dockerfile');
      await until('the Dockerfile sample', text, (t) => /^FROM /m.test(t));
      assert.strictEqual(await page.locator('#kind-dialog[open]').count(), 0);
      assert.strictEqual(await page.evaluate('document.activeElement.id'), 'kind');
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

  it('loads the new kind\'s sample in place of a sample or nothing, and asks before it replaces the user\'s text (Keep, Esc, Replace and Undo)', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-US' });
    const page = await ctx.newPage();
    await page.goto(base);
    await page.locator('.cm-line').nth(5).waitFor();
    const text = () => page.evaluate('document.querySelector(".cm-content").innerText') as Promise<string>;
    const toast = page.locator('#status');
    const dialog = page.locator('#kind-dialog');
    const focused = () => page.evaluate('document.activeElement.id') as Promise<string>;
    // An untouched sample gives way to the new kind's, with no question and no toast.
    await pickKind(page, 'dockerfile');
    await until('the Dockerfile sample', text, (t) => /^FROM /m.test(t));
    assert.strictEqual(await dialog.count(), 0);
    assert.strictEqual(await toast.innerText(), '');
    // The user's text: the kind changes at once, and the page asks.
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText('echo mine\n');
    await pickKind(page, 'makefile');
    await dialog.waitFor();
    assert.strictEqual(await page.locator('#kind').getAttribute('aria-label'), 'File: Makefile');
    assert.strictEqual(await dialog.getAttribute('role'), 'alertdialog');
    assert.strictEqual(await dialog.getAttribute('aria-modal'), 'true');
    assert.strictEqual(await page.locator(`#${await dialog.getAttribute('aria-labelledby')}`).innerText(), 'Load the Makefile sample?');
    assert.match(await page.locator(`#${await dialog.getAttribute('aria-describedby')}`).innerText(), /^The file kind is now Makefile\./);
    assert.strictEqual(await page.locator('#kind-replace').innerText(), 'Replace with the sample');
    assert.strictEqual(await page.locator('#kind-keep').innerText(), 'Keep my script');
    // The focus starts on the choice that changes nothing and stays in the dialog.
    assert.strictEqual(await focused(), 'kind-keep');
    for (const [key, id] of [['Tab', 'kind-replace'], ['Tab', 'kind-keep'], ['Shift+Tab', 'kind-replace'], ['Shift+Tab', 'kind-keep']]) {
      await page.keyboard.press(key);
      assert.strictEqual(await focused(), id, key);
    }
    // The rest of the page is out of reach while it is open.
    assert.strictEqual(await page.evaluate('document.querySelector("#kind-dialog").matches(":modal")'), true);
    // Keep: the text stays, the focus goes back to the kind's button.
    await page.locator('#kind-keep').click();
    assert.strictEqual(await dialog.isVisible(), false);
    assert.strictEqual((await text()).trim(), 'echo mine');
    assert.strictEqual(await focused(), 'kind');
    assert.strictEqual(await toast.innerText(), '');
    // Esc keeps it too.
    await pickKind(page, 'yaml');
    await dialog.waitFor();
    await page.keyboard.press('Escape');
    await until('the dialog closed', () => dialog.isVisible(), (v) => !v);
    assert.strictEqual((await text()).trim(), 'echo mine');
    assert.strictEqual(await page.locator('#kind').getAttribute('aria-label'), 'File: GitHub Actions / GitLab CI');
    assert.strictEqual(await focused(), 'kind');
    // Replace: the sample comes in, and the toast offers to undo it; Undo brings the text back and the kind stays.
    await pickKind(page, 'dockerfile');
    await page.locator('#kind-replace').click();
    await until('the Dockerfile sample', text, (t) => /^FROM /m.test(t));
    assert.strictEqual(await toast.getAttribute('role'), 'status');
    assert.match(await toast.innerText(), /^Sample loaded/);
    await toast.locator('button').click();
    await until('the text back', text, (t) => t.trim() === 'echo mine');
    assert.strictEqual(await page.locator('#kind').getAttribute('aria-label'), 'File: Dockerfile');
    // ⋯ › Load the sample still asks (the browser's confirmation) and offers to undo; typing takes the offer away.
    const loadSample = async () => {
      await page.locator('#ed-more').click();
      await page.locator('#more-sample').click();
    };
    page.once('dialog', (d) => void d.accept());
    await loadSample();
    await toast.locator('button').waitFor();
    await toast.locator('button').click();
    await until('the text back', text, (t) => t.trim() === 'echo mine');
    page.once('dialog', (d) => void d.accept());
    await loadSample();
    await toast.locator('button').waitFor();
    await page.locator('.cm-content').click();
    await page.keyboard.insertText('x');
    await until('the toast gone', () => toast.innerText(), (t) => t === '');
    // An empty editor, or only spaces, counts as untouched: the sample of the kind chosen, with no question.
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Delete');
    await page.keyboard.insertText(' \n ');
    await pickKind(page, 'bats');
    await until('the bats sample', text, (t) => /^@test /m.test(t));
    assert.strictEqual(await dialog.isVisible(), false);
    // The sample loaded so is untouched too: the next kind's sample follows.
    await pickKind(page, 'shell');
    await until('the shell sample', text, (t) => t.startsWith('#!/usr/bin/env bash'));
    assert.strictEqual(await dialog.isVisible(), false);
    // The words follow the language.
    await choose(page, '#lang', 'ja');
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText('\n# mine');
    await pickKind(page, 'makefile');
    await dialog.waitFor();
    assert.strictEqual(await page.locator('#kind-dialog-title').innerText(), 'Makefile のサンプルを読み込みますか？');
    assert.strictEqual(await page.locator('#kind-replace').innerText(), 'サンプルに置き換える');
    assert.strictEqual(await page.locator('#kind-keep').innerText(), 'スクリプトをそのままにする');
    await page.locator('#kind-replace').click();
    await until('the Japanese toast', () => toast.innerText(), (t) => t.includes('サンプルを読み込みました'));
    assert.strictEqual(await toast.locator('button').innerText(), '元に戻す');
    await ctx.close();
  });

  it('asks on a phone too: the menu closes, the choices are touch targets in the window, and Undo is one in the toast', async () => {
    const { devices } = await import('playwright-core');
    for (const scheme of ['light', 'dark'] as const) {
      const ctx = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 740 }, locale: 'en-US', colorScheme: scheme });
      const page = await ctx.newPage();
      await page.goto(base);
      await page.locator('.cm-line').nth(5).waitFor();
      const text = () => page.evaluate('document.querySelector(".cm-content").innerText') as Promise<string>;
      const dialog = page.locator('#kind-dialog');
      // The sample's pitfalls fill the Problems list, so the editor is short: the read-mode tip would cover it.
      await page.locator('#readtip-close').tap();
      await page.locator('.cm-content').click();
      await page.keyboard.press('Control+A');
      await page.keyboard.insertText('echo phone\n');
      await page.locator('#menu-open').tap();
      await page.locator('#kind-menu').selectOption('dockerfile');
      await dialog.waitFor();
      assert.strictEqual(await page.locator('#drawer').evaluate((d) => (d as unknown as { open: boolean }).open), false);
      const boxes = await Promise.all([dialog, page.locator('#kind-replace'), page.locator('#kind-keep')].map(async (l) => (await l.boundingBox())!));
      for (const b of boxes) assert.ok(b.x >= 0 && b.x + b.width <= 390 && b.y >= 0 && b.y + b.height <= 740, `${scheme} ${JSON.stringify(b)}`);
      // One above the other, the sample first, each the dialog's width less its padding and 40px or more high.
      const [d, replace, keep] = boxes;
      assert.ok(replace.y + replace.height <= keep.y && replace.width === keep.width && replace.width >= d.width - 48, `${scheme} ${JSON.stringify(boxes)}`);
      assert.ok(replace.height >= 40 && keep.height >= 40, `${scheme} ${JSON.stringify(boxes)}`);
      // Keep: the kind has changed, the text stays, and the focus is back on the menu's button.
      await page.locator('#kind-keep').tap();
      assert.strictEqual((await text()).trim(), 'echo phone');
      assert.strictEqual(await page.locator('#kind-menu').inputValue(), 'dockerfile');
      assert.strictEqual(await page.evaluate('document.activeElement.id'), 'menu-open');
      // Replace: the sample, and Undo in the toast.
      await page.locator('#menu-open').tap();
      await page.locator('#kind-menu').selectOption('bats');
      await page.locator('#kind-replace').tap();
      await until('the bats sample', text, (t) => /^@test /m.test(t));
      const undo = page.locator('#status button');
      const box = (await undo.boundingBox())!;
      assert.ok(box.height >= 40 && box.y + box.height <= 740 && box.x >= 0 && box.x + box.width <= 390, JSON.stringify(box));
      await undo.tap();
      await until('the text back', text, (t) => t.trim() === 'echo phone');
      await ctx.close();
    }
  });

  it('keeps the kind and the script of a shared link on load, and asks about them as the user\'s text', async () => {
    const t = Buffer.from('all:\n\techo shared\n').toString('base64url');
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-US' });
    const page = await ctx.newPage();
    await page.goto(`${base}#lang=en&kind=makefile&t=${t}`);
    const text = () => page.evaluate('document.querySelector(".cm-content").innerText') as Promise<string>;
    await until('the shared script', text, (s) => s.includes('echo shared'));
    assert.strictEqual(await page.locator('#kind').getAttribute('aria-label'), 'File: Makefile');
    assert.strictEqual(await page.locator('#kind-dialog').count(), 0);
    // A deflated link too (the script arrives a moment after the page).
    const z = await page.evaluate(`(async () => { const s = new Blob([new TextEncoder().encode('FROM alpine\\nRUN echo zipped\\n')]).stream().pipeThrough(new CompressionStream('deflate-raw')); const b = new Uint8Array(await new Response(s).arrayBuffer()); return btoa(String.fromCharCode(...b)).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, ''); })()`) as string;
    const zipped = await ctx.newPage();
    await zipped.goto(`${base}#lang=en&kind=dockerfile&z=${z}`);
    await until('the deflated script', () => zipped.evaluate('document.querySelector(".cm-content").innerText') as Promise<string>, (s) => s.includes('RUN echo zipped'));
    assert.strictEqual(await zipped.locator('#kind').getAttribute('aria-label'), 'File: Dockerfile');
    // The link's script is the user's: changing the kind asks.
    await pickKind(page, 'shell');
    await page.locator('#kind-dialog').waitFor();
    await page.keyboard.press('Escape');
    assert.ok((await text()).includes('echo shared'));
    await ctx.close();
  });

  it('asks and loads the sample when the browser refuses storage', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-US' });
    await ctx.addInitScript("Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } });");
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base);
    await page.locator('.cm-line').nth(5).waitFor();
    const text = () => page.evaluate('document.querySelector(".cm-content").innerText') as Promise<string>;
    await pickKind(page, 'makefile');
    await until('the Makefile sample', text, (t) => /^\S+:/m.test(t) && !t.startsWith('#!'));
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText('echo blocked\n');
    await pickKind(page, 'dockerfile');
    await page.locator('#kind-replace').click();
    await until('the Dockerfile sample', text, (t) => /^FROM /m.test(t));
    await page.locator('#status button').click();
    await until('the text back', text, (t) => t.trim() === 'echo blocked');
    assert.deepStrictEqual(errors, []);
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
          const name = document.querySelector('.brand-name'), brand = document.querySelector('.brand'), img = document.querySelector('.brand .logo');
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
          assert.ok(cols.length >= 4 && cols.every(([, l, w, fits]) => l === cols[0][1] && w === cols[0][2] && fits), `${where}: ${JSON.stringify(cols)}`);
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
    // An untouched sample gives way to the new kind's; the menu stays open.
    await select.selectOption('dockerfile');
    assert.strictEqual(await select.inputValue(), 'dockerfile');
    await until('the Dockerfile sample', text, (t) => /^FROM /m.test(t));
    assert.strictEqual(await select.isVisible(), true);
    // The last kind, bats, and its sample.
    await select.selectOption('bats');
    assert.strictEqual(await select.inputValue(), 'bats');
    await until('the bats sample', text, (t) => /^@test /m.test(t));
    await select.selectOption('dockerfile');
    await until('the Dockerfile sample again', text, (t) => /^FROM /m.test(t));
    assert.strictEqual(await page.locator('#kind-dialog').count(), 0);
    // The language: the label and the names of the kinds.
    await choose(page, '#lang', 'ja');
    await until('ja label', async () => (await select.getAttribute('aria-label')) ?? '', (t) => t === 'ファイル');
    assert.strictEqual(await page.locator('#kind-label').textContent(), 'ファイル');
    assert.strictEqual(await select.locator('option[value="shell"]').textContent(), 'シェルスクリプト');
    assert.strictEqual(await select.inputValue(), 'dockerfile');
    await ctx.close();
  });
});
