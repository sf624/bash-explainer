// The web page: the top bar, run for real in headless Chromium (the build, the server and the browser
// are shared by all test/web-*.test.ts files: test/support/site.ts). Skipped when no browser can start,
// unless $BASH_EXPLAINER_BROWSER is set (as in CI).
import * as assert from 'assert';
import type { Browser } from 'playwright-core';
import { openSite, choose, until } from './support/site';

describe('the web page: the top bar', function () {
  this.timeout(120000);
  let browser: Browser;
  let base = '';

  before(async function () {
    ({ browser, base } = await openSite(this));
  });

  it('on a phone, tapping a row of the explanation selects its token without focusing the editor, and the page does not scroll sideways', async () => {
    const { devices } = await import('playwright-core');
    const ctx = await browser.newContext({ ...devices['iPhone 13'] });
    const page = await ctx.newPage();
    await page.goto(base);
    await page.locator('#menu-open').tap();
    await page.locator('#menu-sample').tap();
    await page.locator('.cm-line').nth(3).waitFor();
    assert.strictEqual(await page.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), true);
    assert.strictEqual(await page.evaluate('window.matchMedia("(pointer: fine)").matches'), false);
    const panel = page.frames().find((f) => f.url().endsWith('/panel.html'))!;
    await until('the tree', () => panel.locator('.row .label').count(), (n) => n > 1);
    // The editor was not focused by the tap on "Load the sample" either; make sure of the start.
    await page.evaluate('document.activeElement && document.activeElement.blur()');
    await panel.locator('.row .label').nth(1).tap();
    await until('the selection', () => page.locator('.cm-selectionBackground').count(), (n) => n > 0);
    assert.strictEqual(await page.evaluate('!!document.activeElement && !!document.activeElement.closest(".cm-content")'), false);
    // In the narrow panel a long label may take the whole row (it was cut at 45% of it).
    const share = await panel.evaluate('(() => { const l = document.querySelector(".row .label"); return [l.getBoundingClientRect().width / l.parentElement.getBoundingClientRect().width, l.scrollWidth <= l.clientWidth]; })()') as [number, boolean];
    assert.ok(share[0] > 0.5 && share[1], String(share));
    // ...and its explanation then goes under it, not into a narrow column beside it.
    const below = await panel.evaluate('(() => { const r = document.querySelector(".row"); return r.querySelector(".text").getBoundingClientRect().top >= r.querySelector(".label").getBoundingClientRect().bottom - 1; })()');
    assert.strictEqual(below, true);
    // ...with the fold mark and the label on one line.
    const oneLine = await panel.evaluate('(() => { const r = document.querySelector(".row"); return Math.abs(r.querySelector(".twisty").getBoundingClientRect().top - r.querySelector(".label").getBoundingClientRect().top) < 8; })()');
    assert.strictEqual(oneLine, true);
    // Nothing in the top bar or the menu is cut: every option fits its select (measured with the
    // select's font, less the room of its arrow), in both languages.
    for (const lang of ['en', 'ja']) {
      await choose(page, '#lang', lang);
      await page.locator('#menu-open').tap();
      const clipped = await page.evaluate(`(() => {
        const c = document.createElement('canvas').getContext('2d');
        const bad = [];
        for (const s of document.querySelectorAll('.top select, #drawer select')) {
          if (!s.clientWidth) continue;
          const cs = getComputedStyle(s);
          c.font = cs.font;
          const room = s.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
          // The file kind may cut a long name with "…"; the others show every option whole.
          const widest = Math.max(...[...s.options].filter((o) => s.id !== 'kind' || o.selected).map((o) => c.measureText(o.text).width));
          if (widest > room) bad.push(s.id + ' ' + Math.round(widest) + ' > ' + Math.round(room));
        }
        for (const b of document.querySelectorAll('.top button, #drawer button, #drawer a')) if (b.scrollWidth > b.clientWidth) bad.push(b.id);
        return bad;
      })()`);
      assert.deepStrictEqual(clipped, [], lang);
      await page.locator('#menu-close').tap();
      await until('the menu closed', () => page.locator('#drawer').evaluate((d) => (d as unknown as { open: boolean }).open), (v) => !v);
    }
    // The top bar is one row, and its controls are big enough to tap.
    const bar = await page.evaluate('document.querySelector(".top").getBoundingClientRect().height') as number;
    assert.ok(bar <= 49, String(bar));
    const small = await page.evaluate('[...document.querySelectorAll(".top select, .top button")].filter((e) => e.getClientRects().length && e.getBoundingClientRect().height < 40).map((e) => e.id)');
    assert.deepStrictEqual(small, []);
    await ctx.close();
  });

  it('has no panel header on the page: fold, quick reference and copy are in the top bar from 768px up (on a phone the copy and the link are in the menu), the shell in the menu or the top bar (1200px and up)', async () => {
    for (const [width, height] of [[768, 800], [1280, 800]]) {
      const ctx = await browser.newContext({ viewport: { width, height }, locale: 'en-US' });
      await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base.slice(0, -1) });
      const page = await ctx.newPage();
      await page.goto(base);
      await page.locator('.cm-line').nth(5).waitFor();
      const panel = () => page.frames().find((f) => f.url().endsWith('/panel.html'))!;
      await until('the explanation', async () => (await panel()?.locator('#line').textContent().catch(() => '')) ?? '', (t) => t.length > 0);
      // The header (the title row and its buttons) is not there to see or to tab to, and the page does not scroll sideways.
      assert.strictEqual(await panel().locator('header').isHidden(), true, `${width}px`);
      assert.strictEqual(await panel().locator('header button:visible, header select:visible, #where:visible').count(), 0);
      assert.strictEqual(await page.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), true);
      // The editor shows the start of its lines: not scrolled sideways, the first character right of the gutter.
      const start = (await page.evaluate(`(() => {
        const line = document.querySelector('.cm-line');
        const r = document.createRange();
        r.setStart(line.firstChild, 0);
        r.setEnd(line.firstChild, 1);
        return [document.querySelector('.cm-scroller').scrollLeft, r.getBoundingClientRect().left, document.querySelector('.cm-gutters').getBoundingClientRect().right, line.textContent.slice(0, 2)];
      })()`)) as [number, number, number, string];
      assert.ok(start[0] === 0 && start[1] >= start[2] - 0.5 && start[3] === '#!', `${width}px: ${start}`);
      const wide = width >= 1200;
      // The three buttons are in the top bar, inside it, and not in the menu (the copy is there on a phone only).
      for (const id of ['#collapse', '#ref', '#copy-md']) {
        assert.strictEqual(await page.locator(id).isVisible(), true, `${id} at ${width}px`);
        assert.strictEqual(await page.locator(`.top ${id}`).count(), 1);
      }
      assert.strictEqual(await page.locator('#menu-collapse, #menu-ref').count(), 0);
      // The view switch too (on a phone it is in the menu).
      assert.strictEqual(await page.locator('.top #views-top').isVisible(), true, `the view switch at ${width}px`);
      await page.locator('#menu-open').click();
      assert.strictEqual(await page.locator('#menu-copy').isVisible(), false);
      await page.evaluate("document.getElementById('drawer').close()");
      assert.strictEqual(await page.locator('#shell-top').isVisible(), wide);
      // Still one row of 48px, with nothing hanging out of the bar.
      const bar = (await page.evaluate('(() => { const t = document.querySelector(".top"); return [t.getBoundingClientRect().height, t.scrollWidth <= t.clientWidth]; })()')) as [number, boolean];
      assert.deepStrictEqual(bar, [48, true]);
      const names = await page.evaluate('["collapse", "copy-md", "ref"].map((id) => [document.getElementById(id).getAttribute("aria-label"), document.getElementById(id).title])');
      assert.deepStrictEqual(names, [['Collapse all', 'Collapse all'], ['Copy as Markdown', 'Copy as Markdown'], ['Quick reference', 'Quick reference']]);
      if (wide) assert.strictEqual(await page.locator('#shell-top').getAttribute('aria-label'), 'Shell');

      // Shell: the setting, as the panel's select was.
      if (wide) await page.locator('#shell-top').selectOption('dash');
      else await choose(page, '#shell', 'dash');
      await until('the problems for dash', () => page.locator('#problem-list').innerText(), (t) => t.includes('dbracket'));
      assert.strictEqual(await page.locator('#shell').inputValue(), 'dash');
      assert.strictEqual(await page.locator('#shell-top').inputValue(), 'dash');

      // Collapse all, then Expand all.
      await page.locator('.cm-line').nth(7).click();
      await until('a tree', () => panel().locator('#tree li li').count(), (n) => n > 0);
      await page.locator('#collapse').click();
      await until('collapsed', () => panel().locator('#tree .collapsed').count(), (n) => n > 0);
      await until('the name', async () => (await page.locator('#collapse').getAttribute('aria-label')) ?? '', (t) => t === 'Expand all');
      assert.strictEqual(await page.locator('#collapse').getAttribute('title'), 'Expand all');
      await page.locator('#collapse').click();
      await until('expanded', () => panel().locator('#tree .collapsed').count(), (n) => n === 0);

      // Copy as Markdown.
      await page.evaluate('navigator.clipboard.writeText("")');
      await page.locator('#copy-md').click();
      const md = await until('the copy', () => page.evaluate('navigator.clipboard.readText()') as Promise<string>, (t) => t.length > 0);
      assert.match(md, /`/);

      // Quick reference, and back.
      await page.locator('#ref').click();
      await until('the reference', () => panel().locator('#reference').isVisible(), (v) => v);
      assert.strictEqual(await page.locator('#ref').getAttribute('aria-pressed'), 'true');
      await until('the name', async () => (await page.locator('#ref').getAttribute('aria-label')) ?? '', (t) => t === '← Back to the explanation');
      await page.locator('#ref').click();
      await until('the explanation again', () => panel().locator('#main').isVisible(), (v) => v);
      assert.strictEqual(await page.locator('#ref').getAttribute('aria-pressed'), 'false');

      // Keyboard access: the buttons are in the tab order and work with Enter and Space.
      await page.locator('#collapse').focus();
      await page.keyboard.press('Enter');
      await until('collapsed by the keyboard', () => panel().locator('#tree .collapsed').count(), (n) => n > 0);
      await page.keyboard.press('Tab');
      assert.strictEqual(await page.evaluate('document.activeElement.id'), 'ref');
      await page.keyboard.press('Space');
      await until('the reference by the keyboard', () => panel().locator('#reference').isVisible(), (v) => v);
      // (The quick reference takes the focus to its search field.)
      await page.locator('#ref').focus();
      await page.keyboard.press('Enter');
      await until('the explanation by the keyboard', () => panel().locator('#main').isVisible(), (v) => v);
      await page.locator('#ref').focus();
      await page.keyboard.press('Tab');
      assert.strictEqual(await page.evaluate('document.activeElement.id'), 'copy-md');

      // Japanese names.
      await choose(page, '#lang', 'ja');
      await until('ja names', async () => (await page.locator('#copy-md').getAttribute('aria-label')) ?? '', (t) => t === 'Markdown でコピー');
      assert.strictEqual(await page.locator('#copy-md').getAttribute('title'), 'Markdown でコピー');
      assert.strictEqual(await page.locator('#shell-label').textContent(), 'シェル');
      await ctx.close();
    }
  });

  it("links to the repository with GitHub's mark, black on a light page and white on a dark one, at the size of the other icons", async () => {
    for (const scheme of ['light', 'dark'] as const) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: scheme, locale: 'en-US' });
      const page = await ctx.newPage();
      await page.goto(base);
      await page.locator('.cm-line').first().waitFor();
      const look = (sel: string) => page.evaluate(`(() => { const s = document.querySelector('${sel} svg'); const cs = getComputedStyle(s); const r = s.getBoundingClientRect(); return [cs.fill, cs.stroke, Math.round(r.width), Math.round(r.height), s.querySelector('use').getAttribute('href')]; })()`);
      const fill = scheme === 'light' ? 'rgb(0, 0, 0)' : 'rgb(255, 255, 255)';
      assert.deepStrictEqual(await look('#github'), [fill, 'none', 18, 18, '#i-github']);
      assert.strictEqual(await page.locator('#github').getAttribute('aria-label'), 'GitHub repository');
      assert.strictEqual(await page.locator('#github').getAttribute('href'), 'https://github.com/sf624/bash-explainer');
      // The same size as the other buttons, and smaller than the page's own logo.
      const [gh, share, logo] = await Promise.all(['#github', '#share', '.brand img'].map(async (s) => (await page.locator(s).boundingBox())!));
      assert.ok(gh.width === share.width && gh.height === share.height && logo.height > 18, JSON.stringify([gh, share, logo]));
      await page.locator('#menu-open').click();
      assert.deepStrictEqual(await look('#menu-github'), [fill, 'none', 18, 18, '#i-github']);
      await page.evaluate("document.getElementById('drawer').close()");
      // In Japanese too.
      await choose(page, '#lang', 'ja');
      await until('ja name', async () => (await page.locator('#github').getAttribute('aria-label')) ?? '', (t) => t === 'GitHub リポジトリ');
      await ctx.close();
    }
  });
});
