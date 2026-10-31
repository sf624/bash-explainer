// The web page with the keyboard alone and for a screen reader, in headless Chromium: the Meaning view's fold buttons
// (media/panel.js), the Problems list's buttons (web/problem-list.ts), the editor's name and the hint on how to leave it,
// the live region that says what the line is about and F6 between the editor and the explanation (web/a11y.ts), the
// hover card opened by the keyboard (web/hover.ts), the example's input box named by its label, the Reading view's row
// kept clear of the sticky rows, forced colours, and the reference links that say they open a new tab. In English and
// in Japanese where the page says something.
import * as assert from 'assert';
import type { Browser, BrowserContext, Frame, Page } from 'playwright-core';
import { chooseView, frames, menuItem, openSite, until, type Site } from './support/site';

// A pitfall on line 3 (`set -e` and `(( count++ ))`), a pipeline with parts, and a command whose example has input boxes.
const SCRIPT = 'set -e\ncount=0\n(( count++ ))\ngrep -c foo f | sort\nsort a.txt b.txt';

describe('the web page: keyboard and screen reader access', function () {
  this.timeout(120000);
  let browser: Browser;
  let firstVisit: Site['firstVisit'];
  let base = '';

  before(async function () {
    ({ browser, firstVisit, base } = await openSite(this));
  });

  async function context(lang: 'en' | 'ja' = 'en', options: Parameters<Browser['newContext']>[0] = {}): Promise<BrowserContext> {
    const ctx = await browser.newContext({ locale: lang === 'ja' ? 'ja-JP' : 'en-US', viewport: { width: 1400, height: 800 }, ...options });
    // (Rows drawn at once: the tests look at the layout right after a key.)
    await ctx.addInitScript(`try { localStorage.setItem('bash-explainer-settings', JSON.stringify({ 'bashExplainer.panel.animations': false })); } catch {}`);
    return ctx;
  }

  const panelOf = (page: Page) => page.frames().find((f) => f.url().endsWith('/panel.html'))!;

  /** Opens the page with `text` in the editor, the cursor on `line` (1-based), and the focus in the editor. */
  async function open(page: Page, text = SCRIPT, line = 1): Promise<Frame> {
    await page.goto(base);
    await until('the panel', () => Promise.resolve(panelOf(page)), (f) => !!f);
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText(text);
    await page.keyboard.press('Control+Home');
    for (let i = 1; i < line; i++) await page.keyboard.press('ArrowDown');
    const want = text.split('\n')[line - 1].slice(0, 10);
    await until('the line explained', async () => (await panelOf(page).locator('#line').textContent()) ?? '', (t) => t.includes(want));
    return panelOf(page);
  }

  /** What has the focus: in the page, or in the panel's frame (`frame:` and the element there). */
  const focused = (page: Page) => page.evaluate(`(() => {
    const d = (e) => e ? e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\\s+/).join('.') : '') : 'none';
    const a = document.activeElement;
    if (a && a.tagName === 'IFRAME') return 'frame:' + d(a.contentDocument.activeElement);
    return d(a);
  })()`) as Promise<string>;

  /** Presses Tab (Shift+Tab with `back`) until `ok` accepts what has the focus; fails after `max` presses. */
  async function tabTo(page: Page, ok: (f: string) => boolean, back = false, max = 60): Promise<string> {
    for (let i = 0; i < max; i++) {
      await page.keyboard.press(back ? 'Shift+Tab' : 'Tab');
      const f = await focused(page);
      if (ok(f)) return f;
    }
    throw new Error(`the focus never came: last on ${await focused(page)}`);
  }

  it('names the editor, shows how to leave it when the keyboard enters it, and lets Escape then Tab leave it', async () => {
    for (const lang of ['en', 'ja'] as const) {
      const ctx = await context(lang);
      const page = await ctx.newPage();
      await open(page);
      const content = page.locator('.cm-content');
      const want = lang === 'en' ? ['Script', 'To leave the editor, press Escape, then Tab.'] : ['スクリプト', 'エディタから出るには、Esc を押してから Tab を押します。'];
      assert.strictEqual(await content.getAttribute('aria-label'), want[0]);
      assert.strictEqual(await content.getAttribute('aria-describedby'), 'editor-hint');
      assert.strictEqual(await page.locator('#editor-hint').textContent(), want[1]);
      // The click put the focus in the editor: no hint.
      assert.strictEqual(await page.locator('#editor-hint').isVisible(), false);
      // Tab indents; Escape then Tab goes on to what follows the editor.
      await page.keyboard.press('End');
      await page.keyboard.press('Tab');
      assert.ok((await focused(page)).includes('cm-content'), 'Tab stays in the editor');
      await page.keyboard.press('Escape');
      await page.keyboard.press('Tab');
      assert.ok(!(await focused(page)).includes('cm-content'), 'Escape, Tab leaves it');
      // Back in by the keyboard: the hint shows, at the top of the editor, and goes when the focus leaves.
      await tabTo(page, (f) => f.includes('cm-content'), true);
      await until('the hint', () => page.locator('#editor-hint').isVisible(), (v) => v);
      const [hint, pane] = await Promise.all([page.locator('#editor-hint').boundingBox(), page.locator('#editor').boundingBox()]);
      assert.ok(hint!.y >= pane!.y && hint!.y + hint!.height < pane!.y + pane!.height / 2 && hint!.x + hint!.width <= pane!.x + pane!.width, JSON.stringify([hint, pane]));
      await page.keyboard.press('Escape');
      await page.keyboard.press('Tab');
      await until('no hint', () => page.locator('#editor-hint').isVisible(), (v) => !v);
      await ctx.close();
    }
  });

  it('says what the line is about in a live region when the cursor moves to another line', async () => {
    for (const lang of ['en', 'ja'] as const) {
      const ctx = await context(lang);
      const page = await ctx.newPage();
      await open(page);
      const region = page.locator('#announce');
      assert.strictEqual(await region.getAttribute('aria-live'), 'polite');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowDown');
      const want = lang === 'en' ? 'Line 3: (( count++ )), Arithmetic evaluation (( )); 1 warning' : '3 行目：(( count++ ))、算術評価 (( ))。警告 1 件';
      const said = await until('the summary', async () => (await region.textContent()) ?? '', (t) => t.startsWith(lang === 'en' ? 'Line 3' : '3 行目'));
      assert.strictEqual(said, want);
      // Typing on the same line says nothing new; another line does.
      await page.keyboard.press('End');
      await page.keyboard.insertText(' ');
      await page.waitForTimeout(800);
      assert.strictEqual(await region.textContent(), said);
      await page.keyboard.press('ArrowDown');
      await until('the next line', async () => (await region.textContent()) ?? '', (t) => t.startsWith(lang === 'en' ? 'Line 4: grep | sort' : '4 行目：grep | sort'));
      // A line with an error and a warning: both counted, the error first.
      await page.keyboard.press('Control+End');
      await page.keyboard.insertText('\nx = 1; [ -f a');
      await page.keyboard.press('ArrowUp');
      await page.keyboard.press('ArrowDown');
      const both = await until('the line of problems', async () => (await region.textContent()) ?? '', (t) => t.startsWith(lang === 'en' ? 'Line 6' : '6 行目'));
      assert.ok(both.endsWith(lang === 'en' ? '; 1 error, 1 warning' : '。エラー 1 件、警告 1 件'), both);
      await ctx.close();
    }
  });

  it('goes from the editor to the explanation and back with F6, in both views, and lists the key in the menu', async () => {
    const ctx = await context();
    const page = await ctx.newPage();
    await open(page, SCRIPT, 4);
    await page.keyboard.press('F6');
    await until('the explanation', () => focused(page), (f) => f === 'frame:main#main');
    await page.keyboard.press('F6');
    await until('the editor', () => focused(page), (f) => f.includes('cm-content'));
    await chooseView(page, 'tree');
    const panel = panelOf(page);
    await until('the tree', () => panel.locator('#reading-tree li').count(), (n) => n > 3);
    await page.locator('.cm-content').focus();
    await page.keyboard.press('F6');
    await until('the tree item', () => focused(page), (f) => f.startsWith('frame:li'));
    assert.strictEqual(await panel.evaluate('document.activeElement.getAttribute("tabindex")'), '0');
    await page.keyboard.press('Shift+F6');
    await until('the editor', () => focused(page), (f) => f.includes('cm-content'));
    // The menu has it, with its key, in Help (Open and Save have theirs in Script).
    await page.locator('#menu-open').click();
    assert.deepStrictEqual(await page.locator('#drawer .menu-item:has(kbd)').evaluateAll((els) => els.map((e) => e.textContent)), ['Open file…Ctrl+O', 'Saveuntitled.shCtrl+S', 'Go to the explanation and backF6']);
    assert.strictEqual(await page.locator('#menu-panes').evaluate((e) => e.closest('section')!.id), 'menu-g-help');
    await page.locator('#menu-panes').click();
    await until('the tree item', () => focused(page), (f) => f.startsWith('frame:li'));
    await ctx.close();
  });

  it('folds and unfolds the Meaning view\'s parts with buttons that say their state', async () => {
    for (const lang of ['en', 'ja'] as const) {
      const ctx = await context(lang);
      const page = await ctx.newPage();
      const panel = await open(page, SCRIPT, 4);
      const buttons = panel.locator('#tree button.twisty');
      assert.ok(await buttons.count() >= 1);
      const first = buttons.first();
      assert.strictEqual(await first.getAttribute('aria-label'), lang === 'en' ? 'Parts of grep | sort' : 'grep | sort の内訳');
      assert.strictEqual(await first.getAttribute('aria-expanded'), 'true');
      // Rows with no parts have no button.
      assert.strictEqual(await panel.locator('#tree span.twisty').count() > 0, true);
      // With the keyboard alone: F6 into the explanation, Tab to the button, Enter folds, Space unfolds.
      await page.keyboard.press('F6');
      await until('the explanation', () => focused(page), (f) => f === 'frame:main#main');
      await tabTo(page, (f) => f.startsWith('frame:button.twisty'));
      const body = panel.locator('#tree > li').first().locator(':scope > .body > ul');
      assert.strictEqual(await body.isVisible(), true);
      await page.keyboard.press('Enter');
      await until('folded', () => first.getAttribute('aria-expanded'), (v) => v === 'false');
      assert.strictEqual(await body.isVisible(), false);
      assert.strictEqual(await first.textContent(), '▸');
      // (The button keeps the focus.)
      assert.ok((await focused(page)).startsWith('frame:button.twisty'));
      await page.keyboard.press('Space');
      await until('unfolded', () => first.getAttribute('aria-expanded'), (v) => v === 'true');
      assert.strictEqual(await body.isVisible(), true);
      // The button looks as the glyph did: no box, the muted colour, in the row's fold column.
      // (Read in one go: the panel draws the line again when its problems come.)
      const look = await panel.evaluate(`(() => {
        const b = document.querySelector('#tree button.twisty');
        const cs = getComputedStyle(b);
        return { border: cs.borderTopWidth, bg: cs.backgroundColor, left: Math.round(b.getBoundingClientRect().left - b.parentElement.getBoundingClientRect().left) };
      })()`) as { border: string; bg: string; left: number };
      assert.deepStrictEqual([look.border, look.bg], ['0px', 'rgba(0, 0, 0, 0)']);
      assert.ok(look.left >= 0 && look.left < 12, JSON.stringify(look));
      await ctx.close();
    }
  });

  it('opens a problem of the list with Enter, which puts the cursor on its line in the editor', async () => {
    const ctx = await context();
    const page = await ctx.newPage();
    await open(page);
    const button = page.locator('#problem-list button.problem').first();
    // (The script's problems, not those of the sample the page opened with.)
    await until('the problems', () => page.locator('#problem-list button.problem .where').allTextContents(), (w) => w[0] === 'Ln 3', 15000);
    assert.match((await button.getAttribute('class'))!, /problem/);
    assert.deepStrictEqual(await button.locator('.icon').evaluate((e) => [e.getAttribute('role'), e.getAttribute('aria-label')]), ['img', 'Warning']);
    // From the editor: Escape, Tab, and on to the list (the list itself is no stop of its own).
    await page.keyboard.press('Escape');
    await page.keyboard.press('Tab');
    const stops: string[] = [];
    await tabTo(page, (f) => (stops.push(f), f.startsWith('button.problem')));
    assert.ok(!stops.some((f) => f.startsWith('ul#problem-list')), stops.join(' '));
    await page.keyboard.press('Enter');
    await until('the editor', () => focused(page), (f) => f.includes('cm-content'));
    assert.strictEqual(await page.locator('.cm-activeLine').textContent(), '(( count++ ))');
    await ctx.close();
  });

  it('opens the hover card with Ctrl+K Ctrl+I and says so; again puts the focus in it, and Escape closes it', async () => {
    for (const lang of ['en', 'ja'] as const) {
      const ctx = await context(lang);
      const page = await ctx.newPage();
      await open(page, SCRIPT, 4);
      await page.keyboard.press('End');
      await page.keyboard.press('ArrowLeft');
      await page.mouse.move(5, 5);
      await page.keyboard.press('Control+K');
      await page.keyboard.press('Control+I');
      const card = page.locator('.cm-bx-hover-pinned');
      await until('the card', () => card.count(), (n) => n === 1);
      assert.strictEqual(await card.getAttribute('role'), 'dialog');
      await until('said', async () => (await page.locator('#announce').textContent()) ?? '', (t) => t === (lang === 'en'
        ? 'Card shown. Press Ctrl+K Ctrl+I again to move into it; Escape closes it.'
        : '解説のカードを表示しました。もう一度 Ctrl+K Ctrl+I を押すとカードに移り、Esc で閉じます。'));
      await page.keyboard.press('Control+K');
      await page.keyboard.press('Control+I');
      await until('the focus in the card', () => focused(page), (f) => f.includes('cm-bx-hover-pinned'));
      await page.keyboard.press('Escape');
      await until('no card', () => card.count(), (n) => n === 0);
      assert.ok((await focused(page)).includes('cm-content'));
      await ctx.close();
    }
  });

  it('names an example\'s input box by its label', async () => {
    const ctx = await context();
    const page = await ctx.newPage();
    const panel = await open(page, SCRIPT, 5);
    const names = await panel.locator('.example textarea').evaluateAll((areas) => areas.map((a) => {
      const label = a.ownerDocument.getElementById(a.getAttribute('aria-labelledby') ?? '');
      return label ? label.textContent!.replace(/ — .*/, '') : null;
    }));
    assert.deepStrictEqual(names, ['Input: a.txt (sample contents)', 'Input: b.txt (sample contents)']);
    await ctx.close();
  });

  it('says that the manual\'s links open a new tab', async () => {
    for (const lang of ['en', 'ja'] as const) {
      const ctx = await context(lang);
      const page = await ctx.newPage();
      const panel = await open(page, SCRIPT, 3);
      const link = panel.locator('#tree .refs a').first();
      assert.strictEqual(await link.getAttribute('target'), '_blank');
      const name = (await link.getAttribute('aria-label'))!;
      const text = (await link.textContent())!;
      assert.ok(name.startsWith(`${text} `), name);
      assert.ok(name.endsWith(lang === 'en' ? ' (opens in a new tab)' : '（新しいタブで開く）'), name);
      await ctx.close();
    }
  });

  it('keeps the focused row of the Reading view clear of the sticky line and steps', async () => {
    const ctx = await context('en', { viewport: { width: 1280, height: 500 } });
    const page = await ctx.newPage();
    const panel = await open(page, 'grep -rn "ERROR $USER" ./src 2>&1 | sort -u > errors.txt && echo "done: $(date +%F)" || exit 1');
    await chooseView(page, 'tree');
    await until('the tree', () => panel.locator('#reading-tree li').count(), (n) => n > 10);
    await panel.locator('#reading-tree li[tabindex="0"]').focus();
    const place = () => panel.evaluate(`(() => {
      const row = document.activeElement.querySelector(':scope > .trow').getBoundingClientRect();
      const cover = Math.max(document.getElementById('top').getBoundingClientRect().bottom, document.getElementById('layers').getBoundingClientRect().bottom);
      return { top: row.top - cover, bottom: innerHeight - row.bottom };
    })()`) as Promise<{ top: number; bottom: number }>;
    const hidden: string[] = [];
    for (const key of [...Array(20).fill('ArrowDown'), ...Array(20).fill('ArrowUp')]) {
      await page.keyboard.press(key);
      await frames(panel);
      const p = await place();
      if (p.top < -1 || p.bottom < -1) hidden.push(`${key} ${JSON.stringify(p)}`);
    }
    assert.deepStrictEqual(hidden, []);
    await ctx.close();
  });

  it('shows the current step and the cursor\'s line with forced colours', async () => {
    const ctx = await context('en');
    const page = await ctx.newPage();
    await page.emulateMedia({ forcedColors: 'active' });
    const panel = await open(page, SCRIPT, 4);
    await chooseView(page, 'tree');
    await until('the steps', () => panel.locator('#layers button.step').count(), (n) => n > 1);
    /** A system colour as this browser computes it. */
    const system = (where: Page | Frame, name: string) => where.evaluate(`(() => {
      const p = document.createElement('span');
      p.style.color = '${name}';
      document.body.append(p);
      const c = getComputedStyle(p).color;
      p.remove();
      return c;
    })()`) as Promise<string>;
    const steps = await panel.locator('#layers button.step').evaluateAll((bs) => bs.map((b) => [b.getAttribute('aria-current'), b.ownerDocument.defaultView!.getComputedStyle(b).backgroundColor]));
    const highlight = await system(panel, 'Highlight');
    assert.deepStrictEqual(steps.filter(([c]) => c === 'step').map(([, bg]) => bg), [highlight]);
    assert.ok(steps.filter(([c]) => c !== 'step').every(([, bg]) => bg !== highlight), JSON.stringify(steps));
    const line = await page.locator('.cm-activeLine').evaluate((e) => [e.ownerDocument.defaultView!.getComputedStyle(e).outlineStyle, e.ownerDocument.defaultView!.getComputedStyle(e).outlineColor]);
    assert.deepStrictEqual(line, ['solid', await system(page, 'Highlight')]);
    await ctx.close();
  });

  it('walks the app bar and the editor\'s header with the keyboard: Copy a link, Open, Save, the name and ⋯, with Escape giving the focus back', async () => {
    for (const lang of ['en', 'ja'] as const) {
      // A first visit: its hint is in the order too, after the header and before the editor.
      const ctx = await firstVisit({ locale: lang === 'ja' ? 'ja-JP' : 'en-US', viewport: { width: 1400, height: 800 } });
      await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base.slice(0, -1) });
      const page = await ctx.newPage();
      await page.goto(base);
      await page.locator('.cm-line').nth(3).waitFor();
      assert.strictEqual(await page.locator('#first-hint').isVisible(), true);
      await page.locator('#settings-open').focus();
      const order: string[] = [];
      for (let i = 0; i < 9; i++) {
        await page.keyboard.press('Tab');
        order.push(await focused(page));
      }
      assert.deepStrictEqual(order.map((f) => f.split('.')[0]), ['a#github', 'a#install', 'button#open-btn', 'button#save-btn', 'button#file-name', 'button#ed-more', 'button#hint-own', 'button#hint-open', 'button#first-hint-close']);
      // Copy a link with Enter: "Copied" on the button, which keeps the focus.
      await page.locator('#share').focus();
      await page.keyboard.press('Enter');
      await until('Copied', () => page.locator('#share').innerText(), (t) => t === (lang === 'ja' ? 'コピーしました' : 'Copied'));
      assert.strictEqual(await focused(page), 'button#share.text-btn.desk-bar.copied');
      // ⋯: Enter opens it on its first item, Escape closes it and the focus is back on ⋯.
      await page.locator('#ed-more').focus();
      await page.keyboard.press('Enter');
      assert.strictEqual(await focused(page), 'button#more-rename.popitem');
      await page.keyboard.press('Escape');
      assert.strictEqual(await focused(page), 'button#ed-more.icon-btn');
      assert.strictEqual(await page.locator('#ed-more-menu').isVisible(), false);
      // ArrowDown opens it too; Tab leaves it closed.
      await page.keyboard.press('ArrowDown');
      assert.strictEqual(await focused(page), 'button#more-rename.popitem');
      await page.keyboard.press('Tab');
      assert.strictEqual(await page.locator('#ed-more-menu').isVisible(), false);
      // Rename…: the field, then Escape gives the focus back to the name, unchanged.
      await page.locator('#ed-more').focus();
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter');
      assert.strictEqual(await focused(page), 'input#file-name-input.file-name-input');
      assert.strictEqual(await page.locator('#file-name-input').getAttribute('aria-label'), lang === 'ja' ? 'ファイル名' : 'File name');
      await page.keyboard.insertText('other');
      await page.keyboard.press('Escape');
      assert.strictEqual((await focused(page)).split('.')[0], 'button#file-name');
      assert.strictEqual(await page.evaluate("document.getElementById('file-name-stem').textContent + document.getElementById('file-name-ext').textContent"), 'untitled.sh');
      // The name says its state to a screen reader.
      assert.strictEqual(await page.locator('#file-name').getAttribute('aria-label'), lang === 'ja' ? '名前を変更: untitled.sh（未保存）' : 'Rename: untitled.sh (not saved yet)');
      // The hint's ×: closed, the focus goes on to the editor's text with the next Tab.
      await page.locator('#first-hint-close').focus();
      await page.keyboard.press('Enter');
      assert.strictEqual(await page.locator('#first-hint').isVisible(), false);
      await ctx.close();
    }
  });

  it('keeps the menu\'s items reachable (the shortcut item is a button)', async () => {
    const ctx = await context('ja');
    const page = await ctx.newPage();
    await open(page);
    await menuItem(page, '#menu-panes');
    await until('the explanation', () => focused(page), (f) => f.startsWith('frame:'));
    await page.locator('#menu-open').click();
    assert.strictEqual(await page.locator('#menu-panes-label').textContent(), '解説とエディタを行き来する');
    await ctx.close();
  });

  it('goes through the settings with the keyboard: their order, Jump to, the search, Escape, and the focus back on the gear', async () => {
    for (const lang of ['en', 'ja'] as const) {
      const ctx = await context(lang);
      const page = await ctx.newPage();
      await open(page);
      const id = () => page.evaluate('document.activeElement ? document.activeElement.id : ""') as Promise<string>;
      const isOpen = () => page.locator('#settings-dialog').evaluate((d) => (d as unknown as { open: boolean }).open);
      await page.locator('#settings-open').focus();
      await page.keyboard.press('Enter');
      await until('the settings', isOpen, (v) => v);
      // From the close button: the "Jump to" links, the search, then the first setting (the folded sections' rows are out of the way).
      await page.locator('#settings-close').focus();
      const order: string[] = [];
      for (let i = 0; i < 8; i++) {
        await page.keyboard.press('Tab');
        order.push(await id());
      }
      assert.deepStrictEqual(order, ['settings-jump-common', 'settings-jump-examples', 'settings-jump-checks', 'settings-jump-editor', 'settings-jump-data', 'settings-search', 'setting-language', 'setting-theme'], lang);
      // Jump to with Enter: Checks unfolds and its heading takes the focus; Tab goes on to its first setting.
      await page.locator('#settings-jump-checks').focus();
      await page.keyboard.press('Enter');
      assert.strictEqual(await id(), 'settings-fold-checks');
      assert.strictEqual(await page.locator('#settings-fold-checks').getAttribute('aria-expanded'), 'true');
      // (Its description's link to "bash version", and its "More" when the text takes more than two lines, come before the select.)
      const passed: string[] = [];
      for (let i = 0; i < 3 && (await id()) !== 'setting-shell'; i++) {
        await page.keyboard.press('Tab');
        passed.push(await page.evaluate('document.activeElement.id || document.activeElement.className') as string);
      }
      assert.strictEqual(passed[passed.length - 1], 'setting-shell', passed.join(' '));
      assert.ok(passed.slice(0, -1).every((p) => ['setting-link', 'setting-shell-desc-more'].includes(p)), passed.join(' '));
      // The heading folds it with Space.
      await page.locator('#settings-fold-checks').focus();
      await page.keyboard.press('Space');
      assert.strictEqual(await page.locator('#settings-fold-checks').getAttribute('aria-expanded'), 'false');
      // The search: what it finds comes next in the order, its section's heading first.
      await page.locator('#settings-search').focus();
      await page.keyboard.insertText('hints');
      await page.keyboard.press('Tab');
      assert.strictEqual(await id(), 'settings-fold-editor');
      await page.keyboard.press('Tab');
      assert.strictEqual(await id(), 'setting-hints-names');
      // Escape in the search clears it; again, it closes the sheet, and the focus is back on the gear.
      await page.locator('#settings-search').focus();
      await page.keyboard.press('Escape');
      assert.strictEqual(await page.locator('#settings-search').inputValue(), '');
      assert.strictEqual(await isOpen(), true);
      await page.keyboard.press('Escape');
      await until('the settings closed', isOpen, (v) => !v);
      assert.strictEqual(await id(), 'settings-open');
      await ctx.close();
    }
  });
});
