// The panel's header on the web page (web/panel-head.ts, media/view-control.js, src/ui/panelHead.ts;
// docs/design/chrome-redesign.md, decisions 4 and 11, step C7), in headless Chromium with the fonts of CI where they are
// set (FONTCONFIG_FILE): one row that takes the first of its forms that fits, never wider than the panel; a press, a
// tab or a fold moves nothing in it; Collapse and Copy keep a word at every width; the view control's menu and the
// tabs work from the keyboard. The press of the view control is kept after a reload: test/web-tree.test.ts.
import * as assert from 'assert';
import type { Browser, Frame, Page } from 'playwright-core';
import { chooseDepth, frames, openSite, until } from './support/site';

describe('the web page: the panel\'s header', function () {
  this.timeout(180000);
  let browser: Browser;
  let base = '';

  before(async function () {
    ({ browser, base } = await openSite(this));
  });

  /** Opens the page in `lang` at `width`, its panel drawing at once (no animations), and returns it once the panel explains a line. */
  async function open(lang: 'en' | 'ja', width: number): Promise<{ page: Page; panel: () => Frame; close: () => Promise<void> }> {
    const ctx = await browser.newContext({ locale: lang === 'ja' ? 'ja-JP' : 'en-US', viewport: { width, height: 800 } });
    await ctx.addInitScript(`try { localStorage.setItem('bash-explainer-settings', JSON.stringify({ 'bashExplainer.panel.animations': false })); } catch {}`);
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base);
    const panel = () => page.frames().find((f) => f.url().endsWith('/panel.html'))!;
    await until('the explanation', async () => (await panel()?.locator('#line').textContent().catch(() => '')) ?? '', (t) => t.length > 0);
    return { page, panel, close: async () => { assert.deepStrictEqual(errors, []); await ctx.close(); } };
  }

  /** Resizes the page and waits until the header has taken its form for the new width. */
  async function resize(page: Page, width: number): Promise<void> {
    await page.setViewportSize({ width, height: 800 });
    await until('the new width', () => page.evaluate('innerWidth') as Promise<number>, (w) => w === width);
    await frames(page, 3);
  }

  /** The header as measured: its form, whether its row overflows (or runs into its end padding: `end` < 0), and the boxes of its parts. */
  const measure = (page: Page) => page.evaluate(`(() => {
    const head = document.getElementById('panel-head');
    const box = (s) => { const r = document.querySelector(s).getBoundingClientRect(); return [Math.round(r.left * 10) / 10, Math.round(r.width * 10) / 10, Math.round(r.top * 10) / 10, Math.round(r.height * 10) / 10]; };
    const word = (id) => { const w = document.getElementById(id); const r = w.getBoundingClientRect(); return w.firstChild && w.firstChild.textContent && r.width > 0 && r.height > 0 && getComputedStyle(w).visibility === 'visible'; };
    return {
      view: document.getElementById('view-slot').dataset.form, tools: head.dataset.tools, tabs: head.dataset.tabs, wrap: head.classList.contains('wrap'),
      over: head.scrollWidth - head.clientWidth, head: box('#panel-head'), frame: box('#panel'), slot: box('#view-slot'), collapse: box('#collapse'), copy: box('#copy-md'),
      tabsBox: box('#panel-tabs'), words: [word('collapse-word'), word('copy-md-word')],
      copyWord: [...document.getElementById('copy-md-word').children].filter((c) => getComputedStyle(c).display !== 'none').map((c) => c.textContent).join('|'),
      end: Math.round((head.getBoundingClientRect().right - parseFloat(getComputedStyle(head).paddingRight) - document.getElementById('copy-md').getBoundingClientRect().right) * 10) / 10,
    };
  })()`) as Promise<{ view: string; tools: string; tabs: string; wrap: boolean; over: number; end: number; head: number[]; frame: number[]; slot: number[]; collapse: number[]; copy: number[]; tabsBox: number[]; words: boolean[]; copyWord: string }>;

  it('takes the first form that fits: the segments with the tools\' words beside them at 1280px, one row from 640 to 1440px, words on Collapse and Copy at every width', async () => {
    for (const lang of ['en', 'ja'] as const) {
      const { page, close } = await open(lang, 1440);
      let last = '';
      for (let width = 1440; width >= 320; width -= width > 800 ? 80 : 40) {
        await resize(page, width);
        const m = await measure(page);
        const at = `${lang} ${width}px: ${JSON.stringify(m)}`;
        // Never wider than the panel, nor into its end padding, and as wide as its frame.
        assert.ok(m.over <= 0 && m.end >= -0.5, at);
        assert.ok(Math.abs(m.head[0] - m.frame[0]) < 1 && Math.abs(m.head[1] - m.frame[1]) < 1, at);
        // Side by side (from 640px: the panel is beside the editor from 768px, under it below), one row: no form has to wrap.
        if (width >= 640) assert.strictEqual(m.wrap, false, at);
        // Collapse and Copy always show a word (decision 11): beside the icon, or under it.
        assert.deepStrictEqual(m.words, [true, true], at);
        // (Copy says what it copies beside its icon, and "Markdown" under it: docs/design/usability-9.md, Q5.)
        assert.strictEqual(m.copyWord, m.tools === 'beside' ? (lang === 'en' ? 'Copy as Markdown' : 'Markdown でコピー') : 'Markdown', at);
        if (width === 1280) assert.deepStrictEqual([m.view, m.tools, m.tabs], ['segments', 'beside', 'full'], at);
        // The forms only narrow as the window does (widest first: src/ui/panelHead.ts).
        const rank = ['segments beside full', 'segments under full', 'menu beside full', 'menu under full', 'menu under short'];
        const now = `${m.view} ${m.tools} ${m.tabs}`;
        assert.ok(rank.includes(now), at);
        // (Side by side and stacked are two layouts: the panel grows when the window crosses 768px.)
        if (last && width !== 760) assert.ok(rank.indexOf(now) >= rank.indexOf(last), `${at} after ${last}`);
        last = now;
      }
      await close();
    }
  });

  it('moves nothing when an option is pressed, the other tab is chosen or everything is folded: the slot keeps its room, unseen on the quick reference', async () => {
    for (const lang of ['en', 'ja'] as const) {
      for (const width of [1280, 900, 390]) {
        const { page, panel, close } = await open(lang, width);
        const at = `${lang} ${width}px`;
        const before = await measure(page);
        const same = async (what: string) => {
          const m = await measure(page);
          assert.deepStrictEqual([m.view, m.tools, m.tabs, m.slot, m.collapse, m.copy, m.tabsBox], [before.view, before.tools, before.tabs, before.slot, before.collapse, before.copy, before.tabsBox], `${at}, ${what}`);
        };
        await chooseDepth(page, 2);
        await until('the rows of depth 2', () => panel().evaluate('document.body.dataset.depth'), (d) => d === '2');
        await same('depth 2');
        // (Two rows of this line start folded at depth 2, so the button says Expand all: one press opens everything, the next folds it. The state in the panel, and the
        // name it sends the page a moment later: the name alone is that of the state before until the answer comes.)
        const toggle = lang === 'en' ? { fold: 'Collapse all', unfold: 'Expand all' } : { fold: 'すべて折りたたむ', unfold: 'すべて展開する' };
        const says = (what: string, name: string, folded: (rows: number) => boolean) => until(what, async () => [await page.locator('#collapse').getAttribute('aria-label'), await panel().evaluate(`document.querySelectorAll('#tree li.collapsed').length`)] as const, ([n, rows]) => n === name && folded(rows as number));
        await says('some rows folded at first', toggle.unfold, (rows) => rows === 2);
        await same('some rows folded');
        await page.locator('#collapse').click();
        await says('everything open', toggle.fold, (rows) => rows === 0);
        await same('everything open');
        await page.locator('#collapse').click();
        await says('everything folded', toggle.unfold, (rows) => rows > 2);
        await same('folded');
        await page.locator('#tab-ref').click();
        await until('the reference', () => panel().locator('#reference').isVisible(), (v) => v);
        await until('the tab', () => page.locator('#tab-ref').getAttribute('aria-selected'), (v) => v === 'true');
        await same('the quick reference');
        assert.deepStrictEqual(await page.evaluate(`['#view-slot', '#collapse', '#copy-md'].map((s) => getComputedStyle(document.querySelector(s)).visibility)`), ['hidden', 'hidden', 'visible'], at);
        assert.strictEqual(await page.locator('#panel-body').getAttribute('aria-labelledby'), 'tab-ref');
        await page.locator('#tab-explain').click();
        await until('the explanation', () => panel().locator('#main').isVisible(), (v) => v);
        await chooseDepth(page, 1);
        await until('the rows of depth 1', () => panel().evaluate('document.body.dataset.depth'), (d) => d === '1');
        await same('depth 1 again');
        await close();
      }
    }
  });

  it('opens the view control\'s menu from the keyboard, gives the focus back to its button, and moves the focus along when the form changes', async () => {
    const { page, panel, close } = await open('en', 1280);
    // Where the menu is drawn (narrow enough for it), from the keyboard.
    for (let width = 1240; width >= 320 && (await measure(page)).view === 'segments'; width -= 40) await resize(page, width);
    const button = page.locator('#slot-open');
    assert.strictEqual(await button.getAttribute('aria-label'), 'Depth: Overview (What it does)');
    assert.strictEqual((await button.innerText()).trim(), 'Overview');
    assert.strictEqual(await button.getAttribute('aria-controls'), 'slot-options');
    await button.focus();
    await page.keyboard.press('Enter');
    assert.strictEqual(await button.getAttribute('aria-expanded'), 'true');
    assert.strictEqual(await page.evaluate('document.activeElement.id'), 'slot-depth1');
    await page.keyboard.press('Escape');
    assert.strictEqual(await page.locator('#slot-options').isHidden(), true);
    assert.strictEqual(await page.evaluate('document.activeElement.id'), 'slot-open');
    await page.keyboard.press('Space');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await until('the rows of depth 2', () => panel().evaluate('document.body.dataset.depth'), (d) => d === '2');
    assert.strictEqual(await page.evaluate('document.activeElement.id'), 'slot-open');
    assert.strictEqual(await button.getAttribute('aria-label'), 'Depth: Word by word (How bash reads it, word by word)');
    assert.strictEqual((await button.innerText()).trim(), 'Word by word');
    // Tab leaves the open menu and closes it.
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    assert.strictEqual(await page.locator('#slot-options').isHidden(), true);
    // The window grows with the focus on the menu's button: the segments come back, and the focus goes to the option shown.
    await button.focus();
    await resize(page, 1280);
    assert.strictEqual((await measure(page)).view, 'segments');
    assert.strictEqual(await page.evaluate('document.activeElement.id'), 'slot-depth2');
    // And back: from the option to the menu's button.
    for (let width = 1240; width >= 320 && (await measure(page)).view === 'segments'; width -= 40) await resize(page, width);
    assert.strictEqual(await page.evaluate('document.activeElement.id'), 'slot-open');
    await close();
  });

  it('names each control by its full name: the tabs, the view control and its options, Collapse and Copy as Markdown', async () => {
    for (const lang of ['en', 'ja'] as const) {
      const { page, close } = await open(lang, 1280);
      const names = await page.evaluate(`['#tab-explain', '#tab-ref', '#slot-options', '#collapse', '#copy-md'].map((s) => { const e = document.querySelector(s); return [e.getAttribute('aria-label'), e.getAttribute('role')]; })`);
      assert.deepStrictEqual(names, lang === 'en'
        ? [['Explanation', 'tab'], ['Reference', 'tab'], ['Depth', 'group'], ['Collapse all', null], ['Copy as Markdown', null]]
        : [['解説', 'tab'], ['早見表', 'tab'], ['深さ', 'group'], ['すべて折りたたむ', null], ['Markdown でコピー', null]]);
      // (docs/design/usability-9.md, Q1 and 2.10: each depth by its name, which is its accessible name; no digit drawn, the key in the tooltip.)
      assert.deepStrictEqual(await page.evaluate(`[...document.querySelectorAll('#slot-options button')].map((b) => [b.innerText, b.getAttribute('aria-label'), b.title, b.getAttribute('aria-pressed')])`),
        lang === 'en'
          ? [['Overview', null, 'What it does (key 1 in the panel)', 'true'], ['Word by word', null, 'How bash reads it, word by word (key 2 in the panel)', 'false']]
          : [['概要', null, '何をするか（パネルの中ではキー 1）', 'true'], ['単語ごと', null, 'bash が単語ごとにどう読むか（パネルの中ではキー 2）', 'false']]);
      assert.strictEqual(await page.locator('#view-slot .vc-digit, #view-slot .vc-label').count(), 0);
      // What a screen reader hears: the group by its label, each option by its name, the one shown pressed.
      assert.strictEqual(await page.locator('#slot-options').ariaSnapshot(), lang === 'en'
        ? '- group "Depth":\n  - button "Overview" [pressed]\n  - button "Word by word"'
        : '- group "深さ":\n  - button "概要" [pressed]\n  - button "単語ごと"');
      // The tabs are one stop of Tab; the tabpanel holds the frame.
      assert.deepStrictEqual(await page.evaluate(`['#tab-explain', '#tab-ref'].map((s) => document.querySelector(s).tabIndex)`), [0, -1]);
      assert.strictEqual(await page.locator('#panel-body[role="tabpanel"] #panel').count(), 1);
      await close();
    }
  });
});
