// The web page: the file kind, run for real in headless Chromium (the build, the server and the browser
// are shared by all test/web-*.test.ts files: test/support/site.ts). Skipped when no browser can start,
// unless $BASH_EXPLAINER_BROWSER is set (as in CI).
import * as assert from 'assert';
import type { Browser } from 'playwright-core';
import { openSite, choose, currentShell, kindChosen, pickKind, toastText, until } from './support/site';

describe('the web page: the file kind', function () {
  this.timeout(120000);
  let browser: Browser;
  let base = '';

  before(async function () {
    ({ browser, base } = await openSite(this));
  });

  it('chooses the file kind and the shell in the chip\'s popover (768px and up), by mouse and by keyboard, and the sample follows', async () => {
    for (const [width, height] of [[768, 800], [1280, 800]]) {
      const ctx = await browser.newContext({ viewport: { width, height }, locale: 'en-US' });
      const page = await ctx.newPage();
      await page.goto(base);
      await page.locator('.cm-line').nth(5).waitFor();
      const chip = page.locator('#scope-chip');
      const pop = page.locator('#scope-pop');
      const text = () => page.evaluate('document.querySelector(".cm-content").innerText') as Promise<string>;
      const focused = () => page.evaluate('[document.activeElement.id, document.activeElement.dataset.value ?? ""]') as Promise<[string, string]>;
      // A button that says what it opens; its name says the kind and the shell, and contains what it shows.
      assert.strictEqual(await chip.getAttribute('aria-haspopup'), 'dialog');
      assert.strictEqual(await chip.getAttribute('aria-expanded'), 'false');
      assert.strictEqual(await chip.getAttribute('aria-label'), 'File type and shell: Shell script · bash (auto)');
      assert.strictEqual(await chip.getAttribute('title'), 'File type and shell: Shell script · Auto: bash (from #!)');
      assert.ok((await chip.getAttribute('aria-label'))!.toLowerCase().includes((await chip.innerText()).toLowerCase()), await chip.innerText());
      assert.strictEqual(await pop.isVisible(), false);

      // By mouse: open; two radio groups, the kind and the shell checked; choose a kind: the popover stays, the sample is the new kind's.
      await chip.click();
      assert.strictEqual(await chip.getAttribute('aria-expanded'), 'true');
      assert.strictEqual(await pop.isVisible(), true);
      assert.strictEqual(await pop.evaluate((d) => d.matches(':modal')), false);
      assert.strictEqual(await page.locator('#scope-kinds').getAttribute('role'), 'radiogroup');
      assert.strictEqual(await page.locator('#scope-kinds [role="radio"]').count(), 9);
      assert.deepStrictEqual(await page.locator('#scope-shells [role="radio"]').allInnerTexts(), ['Auto: bash (from #!)', 'bash', 'POSIX sh', 'dash', 'busybox ash', 'yash', 'ksh93', 'mksh', 'zsh']);
      assert.strictEqual(await page.locator('#scope-kinds [aria-checked="true"]').innerText(), 'Shell script');
      assert.strictEqual(await page.locator('#scope-shells [aria-checked="true"]').innerText(), 'Auto: bash (from #!)');
      assert.deepStrictEqual(await focused(), ['scope-kind-shell', 'shell']);
      // The popover is in the window.
      const pb = (await pop.boundingBox())!;
      assert.ok(pb.x >= 0 && pb.x + pb.width <= width && pb.y + pb.height <= height, JSON.stringify(pb));
      await page.locator('#scope-kind-dockerfile').click();
      assert.strictEqual(await pop.isVisible(), true);
      assert.strictEqual(await kindChosen(page), 'dockerfile');
      await until('the Dockerfile sample', text, (t) => /^FROM /m.test(t));
      assert.strictEqual(await page.locator('#kind-dialog[open]').count(), 0);
      // (A Dockerfile's RUN runs in sh: the chip says the shell the line is explained as, not the default bash.)
      assert.strictEqual(await chip.getAttribute('aria-label'), 'File type and shell: Dockerfile · POSIX sh (auto)');
      assert.strictEqual(await page.locator('#scope-shell-auto').innerText(), 'Auto: POSIX sh (from the file type)');
      // (The chip shows all of it where the pane has the room: in a pane of 384px, the shell alone, with Open and Save as icons.)
      assert.strictEqual(await chip.innerText(), width === 768 ? 'POSIX sh' : 'Dockerfile · POSIX sh (auto)');
      // A press outside closes it without a change.
      await page.mouse.click(width - 5, height - 5);
      assert.strictEqual(await pop.isVisible(), false);
      assert.strictEqual(await chip.getAttribute('aria-expanded'), 'false');
      assert.strictEqual(await kindChosen(page), 'dockerfile');

      // By keyboard: the focus goes to the kind checked, the arrows move without choosing, Escape closes without a change
      // and gives the focus back; Enter chooses.
      await chip.focus();
      await page.keyboard.press('ArrowDown');
      assert.strictEqual(await pop.isVisible(), true);
      assert.deepStrictEqual(await focused(), ['scope-kind-dockerfile', 'dockerfile']);
      await page.keyboard.press('ArrowDown');
      assert.deepStrictEqual(await focused(), ['scope-kind-makefile', 'makefile']);
      assert.strictEqual(await kindChosen(page), 'dockerfile');
      await page.keyboard.press('Escape');
      assert.strictEqual(await pop.isVisible(), false);
      assert.deepStrictEqual(await focused(), ['scope-chip', '']);
      assert.strictEqual(await kindChosen(page), 'dockerfile');
      await page.keyboard.press('Enter');
      assert.strictEqual(await pop.isVisible(), true);
      await page.keyboard.press('End');
      assert.deepStrictEqual(await focused(), ['scope-kind-bats', 'bats']);
      await page.keyboard.press('ArrowDown');
      assert.deepStrictEqual(await focused(), ['scope-kind-shell', 'shell']);
      await page.keyboard.press('ArrowUp');
      await page.keyboard.press('ArrowUp');
      assert.deepStrictEqual(await focused(), ['scope-kind-jenkinsfile', 'jenkinsfile']);
      await page.keyboard.press('Home');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      assert.strictEqual(await kindChosen(page), 'makefile');
      await until('the Makefile sample', text, (t) => !/^FROM /m.test(t) && /^\S+:/m.test(t));
      // The focus stays on the item chosen; Tab goes to the Shell list, on its item checked; Space chooses there.
      assert.deepStrictEqual(await focused(), ['scope-kind-makefile', 'makefile']);
      await page.keyboard.press('Tab');
      assert.deepStrictEqual(await focused(), ['scope-shell-auto', 'auto']);
      await page.keyboard.press('End');
      await page.keyboard.press('Space');
      assert.strictEqual(await currentShell(page), 'zsh');
      await until('the chip', () => chip.innerText(), (t) => t === 'Makefile · zsh');
      // Back to auto; Tab out of the popover closes it.
      await page.keyboard.press('Home');
      await page.keyboard.press('Enter');
      assert.strictEqual(await currentShell(page), 'auto');
      await page.keyboard.press('Tab');
      assert.strictEqual(await pop.isVisible(), false);

      // The names follow the language.
      await choose(page, '#lang', 'ja');
      await until('ja name', async () => (await chip.getAttribute('aria-label')) ?? '', (t) => t === 'ファイルの種類とシェル: Makefile · POSIX sh（自動）');
      await chip.click();
      assert.strictEqual(await page.locator('#scope-kind-label').innerText(), 'ファイルの種類');
      assert.strictEqual(await page.locator('#scope-kind-shell').innerText(), 'シェルスクリプト');
      assert.strictEqual(await page.locator('#scope-shell-auto').innerText(), '自動: POSIX sh（ファイルの種類から）');
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
    assert.strictEqual(await kindChosen(page), 'makefile');
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
    // Keep: the text stays, the focus goes back to the chip (the popover closed when the question came).
    await page.locator('#kind-keep').click();
    assert.strictEqual(await dialog.isVisible(), false);
    assert.strictEqual((await text()).trim(), 'echo mine');
    assert.strictEqual(await focused(), 'scope-chip');
    assert.strictEqual(await toast.innerText(), '');
    // Esc keeps it too.
    await pickKind(page, 'yaml');
    await dialog.waitFor();
    await page.keyboard.press('Escape');
    await until('the dialog closed', () => dialog.isVisible(), (v) => !v);
    assert.strictEqual((await text()).trim(), 'echo mine');
    assert.strictEqual(await kindChosen(page), 'yaml');
    assert.strictEqual(await focused(), 'scope-chip');
    // Replace: the sample comes in, and the toast offers to undo it; Undo brings the text back and the kind stays.
    await pickKind(page, 'dockerfile');
    await page.locator('#kind-replace').click();
    await until('the Dockerfile sample', text, (t) => /^FROM /m.test(t));
    assert.strictEqual(await toast.locator('.toast-text').getAttribute('role'), 'status');
    assert.match(await toastText(page), /^Sample loaded/);
    await toast.locator('button').click();
    await until('the text back', text, (t) => t.trim() === 'echo mine');
    assert.strictEqual(await kindChosen(page), 'dockerfile');
    // ⋯ › Load the sample replaces the text at once, asking nothing, and offers to undo; typing takes the offer away.
    const asked: string[] = [];
    page.on('dialog', (d) => {
      asked.push(d.message());
      void d.dismiss();
    });
    const loadSample = async () => {
      await page.locator('#ed-more').click();
      await page.locator('#more-sample').click();
    };
    await loadSample();
    await toast.locator('button').waitFor();
    await toast.locator('button').click();
    await until('the text back', text, (t) => t.trim() === 'echo mine');
    await loadSample();
    await toast.locator('button').waitFor();
    await page.locator('.cm-content').click();
    await page.keyboard.insertText('x');
    await until('the toast gone', () => toast.innerText(), (t) => t === '');
    assert.deepStrictEqual(asked, []);
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

  it('asks on a phone too: the chip\'s sheet closes, the choices are touch targets in the window, and Undo is one in the toast', async () => {
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
      await page.locator('#scope-chip').tap();
      await page.locator('#scope-kind-dockerfile').tap();
      await dialog.waitFor();
      assert.strictEqual(await page.locator('#scope-pop').evaluate((d) => (d as unknown as { open: boolean }).open), false);
      const boxes = await Promise.all([dialog, page.locator('#kind-replace'), page.locator('#kind-keep')].map(async (l) => (await l.boundingBox())!));
      for (const b of boxes) assert.ok(b.x >= 0 && b.x + b.width <= 390 && b.y >= 0 && b.y + b.height <= 740, `${scheme} ${JSON.stringify(b)}`);
      // One above the other, the sample first, each the dialog's width less its padding and 40px or more high.
      const [d, replace, keep] = boxes;
      assert.ok(replace.y + replace.height <= keep.y && replace.width === keep.width && replace.width >= d.width - 48, `${scheme} ${JSON.stringify(boxes)}`);
      assert.ok(replace.height >= 40 && keep.height >= 40, `${scheme} ${JSON.stringify(boxes)}`);
      // Keep: the kind has changed, the text stays, and the focus is back on the chip.
      await page.locator('#kind-keep').tap();
      assert.strictEqual((await text()).trim(), 'echo phone');
      assert.strictEqual(await kindChosen(page), 'dockerfile');
      assert.strictEqual(await page.evaluate('document.activeElement.id'), 'scope-chip');
      // Replace: the sample, and Undo in the toast (from the menu's row this time).
      await page.locator('#menu-open').tap();
      await page.locator('#menu-scope').tap();
      await page.locator('#scope-kind-bats').tap();
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
    assert.strictEqual(await kindChosen(page), 'makefile');
    assert.strictEqual(await page.locator('#kind-dialog').count(), 0);
    // A deflated link too (the script arrives a moment after the page).
    const z = await page.evaluate(`(async () => { const s = new Blob([new TextEncoder().encode('FROM alpine\\nRUN echo zipped\\n')]).stream().pipeThrough(new CompressionStream('deflate-raw')); const b = new Uint8Array(await new Response(s).arrayBuffer()); return btoa(String.fromCharCode(...b)).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, ''); })()`) as string;
    const zipped = await ctx.newPage();
    await zipped.goto(`${base}#lang=en&kind=dockerfile&z=${z}`);
    await until('the deflated script', () => zipped.evaluate('document.querySelector(".cm-content").innerText') as Promise<string>, (s) => s.includes('RUN echo zipped'));
    assert.strictEqual(await kindChosen(zipped), 'dockerfile');
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

  it('has the logo and the name in the top bar of a phone, and the link in the menu; from 320px to 430px, in both themes, nothing overflows and every button is 40px or more', async () => {
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
        await page.locator('#mode-read').tap();
        const ids = ['menu-open', 'settings-open'];
        const m = (await page.evaluate(`(() => {
          const t = document.querySelector('.top');
          const boxes = ${JSON.stringify(ids)}.map((id) => { const e = document.getElementById(id); const r = e.getBoundingClientRect(); return [id, e.getClientRects().length > 0, r.left, r.right, r.width, r.height]; });
          const name = document.querySelector('.brand-name'), brand = document.querySelector('.brand'), img = document.querySelector('.brand .logo');
          const shown = (sel) => document.querySelector(sel).getClientRects().length > 0;
          return { h: t.getBoundingClientRect().height, bar: t.scrollWidth <= t.clientWidth, page: document.documentElement.scrollWidth <= document.documentElement.clientWidth, boxes,
            brand: [brand.getBoundingClientRect().left, brand.getBoundingClientRect().right, img.getBoundingClientRect().width], whole: name.scrollWidth <= name.clientWidth, text: name.textContent, rows: Math.round(name.getBoundingClientRect().height / parseFloat(getComputedStyle(name).lineHeight)),
            hidden: ['#share'].map((s) => shown(s)), href: brand.getAttribute('href') };
        })()`)) as { h: number; bar: boolean; page: boolean; boxes: [string, boolean, number, number, number, number][]; brand: [number, number, number]; whole: boolean; text: string; rows: number; hidden: boolean[]; href: string };
        const where = `${width}px ${scheme}`;
        assert.ok(m.h <= 49 && m.bar && m.page && m.whole, `${where}: ${JSON.stringify(m)}`);
        assert.strictEqual(m.text, 'Bash Explainer');
        assert.strictEqual(m.href, './');
        assert.ok(m.brand[2] >= 24, where);
        // One line from 390px, two lines below it.
        assert.strictEqual(m.rows, width >= 390 ? 1 : 2, where);
        assert.deepStrictEqual(m.hidden, [false], where);
        for (const [id, shown, left, right, w, h] of m.boxes) {
          assert.ok(shown && left >= 0 && right <= width + 0.5 && w >= 40 && h >= 40, `${where}: ${id} ${[shown, left, right, w, h]}`);
        }
        // In order, and not on each other: the menu, the logo and name, then the buttons.
        assert.ok(m.brand[0] >= m.boxes[0][3] - 0.5 && m.boxes[1][2] >= m.brand[1] - 0.5, where);
        for (let i = 1; i < m.boxes.length; i++) assert.ok(m.boxes[i][2] >= m.boxes[i - 1][3] - 0.5, `${where}: ${m.boxes[i][0]}`);
        if (scheme === 'light' && (width === 320 || width === 390)) {
          // The menu's selects share one column (same left edge and width), and no name is cut.
          await page.locator('#menu-open').tap();
          const cols = (await page.evaluate(`(() => { const c = document.createElement('canvas').getContext('2d'); return [...document.querySelectorAll('#drawer .field select')].filter((s) => s.clientWidth).map((s) => { const r = s.getBoundingClientRect(); const cs = getComputedStyle(s); c.font = cs.font; const room = s.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight); return [s.id, Math.round(r.left * 10) / 10, Math.round(r.width * 10) / 10, Math.max(...[...s.options].map((o) => c.measureText(o.text).width)) <= room]; }); })()`)) as [string, number, number, boolean][];
          assert.ok(cols.length >= 2 && cols.every(([, l, w, fits]) => l === cols[0][1] && w === cols[0][2] && fits), `${where}: ${JSON.stringify(cols)}`);
          await page.locator('#menu-close').tap();
        }
        if (scheme === 'light' && (width === 320 || width === 390)) {
          // The copy and the link work from the menu (the sheet's row has no room for the panel's tools).
          await page.evaluate('navigator.clipboard.writeText("")');
          await page.locator('.cm-line').nth(7).tap();
          assert.strictEqual(await page.locator('#copy-md').isVisible(), false, where);
          await page.locator('#menu-open').tap();
          await page.locator('#menu-copy-md').tap();
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

  it('chooses the file kind in the chip\'s sheet on a phone (and from the menu\'s row), with 44px rows and Done, and the names follow the language', async () => {
    const { devices } = await import('playwright-core');
    const ctx = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 740 }, locale: 'en-US' });
    const page = await ctx.newPage();
    await page.goto(base);
    await page.locator('.cm-line').nth(5).waitFor();
    await page.locator('#readtip-close').tap().catch(() => undefined);
    const text = () => page.evaluate('document.querySelector(".cm-content").innerText') as Promise<string>;
    const chip = page.locator('#scope-chip');
    const pop = page.locator('#scope-pop');
    // The chip is a 44px box in the header's row.
    const cb = (await chip.boundingBox())!;
    assert.ok(cb.height >= 44 && cb.width >= 44 && cb.x + cb.width <= 390, JSON.stringify(cb));
    await chip.tap();
    // A sheet from the bottom over the page (a modal dialog), with its title and Done, every row 44px, all in the window.
    assert.strictEqual(await pop.evaluate((d) => d.matches(':modal')), true);
    assert.strictEqual(await page.locator('#scope-title').innerText(), 'File type and shell');
    const sheet = (await pop.boundingBox())!;
    assert.ok(sheet.x === 0 && sheet.width === 390 && Math.abs(sheet.y + sheet.height - 740) <= 1, JSON.stringify(sheet));
    const rows = await page.locator('#scope-pop [role="radio"], #scope-done').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [e.id, r.width, r.height, r.bottom]; }));
    for (const [id, w, h, bottom] of rows as [string, number, number, number][]) assert.ok(w >= 44 && h >= 44 && bottom <= 740, `${id} ${w}x${h} ${bottom}`);
    // An untouched sample gives way to the new kind's; the sheet stays open.
    await page.locator('#scope-kind-dockerfile').tap();
    await until('the Dockerfile sample', text, (t) => /^FROM /m.test(t));
    assert.strictEqual(await pop.isVisible(), true);
    // Done closes it, the focus back on the chip.
    await page.locator('#scope-done').tap();
    assert.strictEqual(await pop.isVisible(), false);
    assert.strictEqual(await page.evaluate('document.activeElement.id'), 'scope-chip');
    // The menu's row says the type and the shell, and opens the same sheet.
    await page.locator('#menu-open').tap();
    assert.strictEqual(await page.locator('#menu-scope').innerText(), 'File type and shell…\nDockerfile · POSIX sh (auto)');
    await page.locator('#menu-scope').tap();
    assert.strictEqual(await pop.isVisible(), true);
    assert.strictEqual(await page.locator('#drawer').evaluate((d) => (d as unknown as { open: boolean }).open), false);
    await page.locator('#scope-kind-bats').tap();
    await until('the bats sample', text, (t) => /^@test /m.test(t));
    // A tap on the backdrop closes it.
    await page.mouse.click(200, 40);
    assert.strictEqual(await pop.isVisible(), false);
    assert.strictEqual(await page.locator('#kind-dialog').count(), 0);
    // The language: the title, the lists' names.
    await choose(page, '#lang', 'ja');
    await chip.tap();
    await until('ja title', () => page.locator('#scope-title').innerText(), (t) => t === 'ファイルの種類とシェル');
    assert.strictEqual(await page.locator('#scope-done').innerText(), '完了');
    assert.strictEqual(await page.locator('#scope-kind-shell').innerText(), 'シェルスクリプト');
    assert.strictEqual(await kindChosen(page), 'bats');
    await ctx.close();
  });
});
