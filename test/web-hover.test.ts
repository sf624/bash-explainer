// The hover cards of the web page's editor (web/hover.ts, docs/design/hover.md "Web page"), in headless Chromium: the
// pointer on a part shows the part's card of VS Code, on a blank the line card; a problem there is said once, in the
// lint's section; Ctrl+K Ctrl+I shows the part at the cursor (again: the focus goes into the card; Escape closes it);
// Ctrl+K Ctrl+E and the card's links put the cursor on the line for the panel, with no card; `hover.enabled` off shows
// none and leaves the keys to the browser; a touch screen shows none; the box stays inside the editor's pane. And the
// reader of the Markdown (web/hover-markdown.ts): every card of the sample leaves no Markdown syntax in the page, and
// the allow-list drops what VS Code's hover drops. Positions are read from the layout, not from how wide a font draws.
import * as assert from 'assert';
import { buildSync } from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';
import type { Browser, BrowserContext, Page } from 'playwright-core';
import { Analyzer } from '../src/analyzer';
import { explainDocumentLine, heredocAt } from '../src/document';
import { openDocument } from '../src/document-setup';
import type { Lang } from '../src/i18n';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { partAt } from '../src/ui/hoverParts';
import { HoverInput, lineCard, partHover } from '../src/ui/hoverView';
import { ui } from '../src/ui/render';
import { frames, openSite, root, until } from './support/site';

const SCRIPT = '#!/bin/bash\nfor f in $(ls); do\n    grep -n TODO "$f"\ndone\necho end';

describe('the web page: hover cards in the editor', function () {
  this.timeout(180000);
  let browser: Browser;
  let base = '';
  before(async function () {
    ({ browser, base } = await openSite(this));
  });

  const panel = (page: Page) => page.frames().find((f) => f.url().endsWith('/panel.html'))!;
  const panelLine = async (page: Page) => (await panel(page).locator('#line').textContent()) ?? '';
  const box = (page: Page) => page.locator('.cm-tooltip-hover');
  const card = (page: Page) => page.locator('.cm-tooltip .cm-bx-hover');

  async function open(page: Page, text = SCRIPT): Promise<void> {
    await page.goto(base);
    await until('the panel', () => Promise.resolve(panel(page)), (f) => !!f);
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText(text);
    // The text is explained, and its problems are found (the lint marks).
    await until('the explanation', () => panelLine(page), (t) => t.length > 0);
    await page.waitForTimeout(500);
  }

  async function context(opts: { lang?: Lang; width?: number; height?: number; touch?: boolean } = {}): Promise<BrowserContext> {
    return browser.newContext({
      viewport: { width: opts.width ?? 1280, height: opts.height ?? 800 }, locale: opts.lang === 'ja' ? 'ja-JP' : 'en-US',
      ...(opts.touch ? { hasTouch: true, isMobile: true } : {}),
    });
  }

  /** The middle of the first character of `text` on the editor's line `line` (0-based), from the layout. */
  async function pointAt(page: Page, line: number, text: string): Promise<{ x: number; y: number }> {
    const p = await page.evaluate(`(([line, text]) => {
      const el = document.querySelectorAll('.cm-line')[line];
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      const at = nodes.map((n) => n.data).join('').indexOf(text);
      if (at < 0) return null;
      let left = at;
      for (const n of nodes) {
        if (left < n.data.length) {
          const r = document.createRange();
          r.setStart(n, left);
          r.setEnd(n, left + 1);
          const b = r.getBoundingClientRect();
          return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
        }
        left -= n.data.length;
      }
      return null;
    })(${JSON.stringify([line, text])})`) as { x: number; y: number } | null;
    assert.ok(p, `${JSON.stringify(text)} on line ${line + 1}`);
    return p;
  }

  /** Moves the pointer away (to the top bar), then onto `text` of line `line`, and waits for what shows there. */
  async function hoverAt(page: Page, line: number, text: string): Promise<void> {
    await page.mouse.move(5, 5);
    await until('no box', () => box(page).count(), (n) => n === 0);
    const p = await pointAt(page, line, text);
    await page.mouse.move(p.x, p.y);
  }

  const cardText = (page: Page) => until('the card', () => card(page).allInnerTexts(), (t) => t.length === 1).then((t) => t[0]);

  /** Puts the cursor before `text` on line `line` with the keyboard (a click would also hover there). */
  async function cursorTo(page: Page, line: number, text: string): Promise<void> {
    const col = (await page.locator('.cm-line').nth(line).innerText()).indexOf(text);
    assert.ok(col >= 0);
    await page.locator('.cm-content').focus();
    // (From the start of the text, ArrowDown keeps the column 0.)
    await page.keyboard.press('Control+Home');
    for (let i = 0; i < line; i++) await page.keyboard.press('ArrowDown');
    for (let i = 0; i < col; i++) await page.keyboard.press('ArrowRight');
  }

  /** Records whether the page let the browser have each key (keydown on the window, after the editor). */
  async function recordKeys(page: Page): Promise<() => Promise<[string, boolean][]>> {
    await page.evaluate(`window.__keys = []; window.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key.length === 1) window.__keys.push([e.key.toLowerCase(), e.defaultPrevented]); })`);
    return () => page.evaluate('window.__keys.splice(0)') as Promise<[string, boolean][]>;
  }

  for (const lang of ['en', 'ja'] as const) {
    it(`shows the card of the part under the pointer, and the line card on a blank (${lang})`, async () => {
      const ctx = await context({ lang });
      const page = await ctx.newPage();
      await open(page);
      const t = ui[lang];
      await hoverAt(page, 2, '-n');
      const text = await cardText(page);
      // The part's card: the parts around it and the link to the whole line, the part, the command it belongs to, the links.
      assert.match(text, new RegExp(`^grep ›\\s+${t.hover.wholeLine}\\n`));
      assert.match(text, /\n-n\n/);
      assert.ok(text.includes(t.openInPanel) && text.includes(t.settings), text);
      // Its links are drawn with VS Code's icons, and the box is the card alone (no problem here).
      assert.strictEqual(await card(page).locator('svg.cm-bx-hover-icon').count(), 3);
      assert.deepStrictEqual(await page.evaluate("Array.from(document.querySelectorAll('.cm-tooltip-hover > *')).map((e) => e.classList.contains('cm-bx-hover'))"), [true]);
      // The labels' colours of the theme, kept on their spans.
      assert.ok(await card(page).locator('span[style^="color:#"]').count() > 0);
      // On the indentation: the line card, the line's structure and the link.
      await hoverAt(page, 2, '  ');
      const line = await cardText(page);
      assert.match(line, new RegExp(`^grep\\s+${t.hover.wholeLine}\\n`));
      assert.ok(!line.includes('-n'), line);
      // Past the end of a line: no card.
      const end = await pointAt(page, 4, 'd');
      await page.mouse.move(5, 5);
      await page.mouse.move(end.x + 200, end.y);
      await page.waitForTimeout(800);
      assert.strictEqual(await card(page).count(), 0);
      await ctx.close();
    });
  }

  it('says a problem once: in the lint\'s section of the box, not again in the card', async () => {
    const ctx = await context();
    const page = await ctx.newPage();
    await open(page);
    // On `$(ls)`, the part the note is about.
    await hoverAt(page, 1, '$(ls)');
    await until('the problem and the card', () => box(page).locator('> *').count(), (n) => n === 2);
    const lint = await box(page).locator('.cm-tooltip-lint').innerText();
    assert.match(lint, /the output of/);
    const said = /the output of[^.]*/.exec(lint)![0];
    const all = await box(page).innerText();
    assert.strictEqual(all.split(said).length - 1, 1, all);
    assert.match(await card(page).innerText(), /\n\$\(ls\)\s/);
    // From the keyboard no problem shows, so the card says it.
    await cursorTo(page, 1, '$(ls)');
    await page.mouse.move(5, 5);
    await page.keyboard.press('Control+K');
    await page.keyboard.press('Control+I');
    const pinned = await until('the card', () => page.locator('.cm-bx-hover-pinned').allInnerTexts(), (t) => t.length === 1);
    assert.ok(pinned[0].includes(said), pinned[0]);
    await ctx.close();
  });

  it('shows the part at the cursor with Ctrl+K Ctrl+I; again puts the focus in the card; Escape closes it', async () => {
    const ctx = await context();
    const page = await ctx.newPage();
    await open(page);
    const keys = await recordKeys(page);
    await cursorTo(page, 2, 'TODO');
    await page.mouse.move(5, 5);
    await page.keyboard.press('Control+K');
    await page.keyboard.press('Control+I');
    const pinned = page.locator('.cm-bx-hover-pinned');
    assert.match((await until('the card', () => pinned.allInnerTexts(), (t) => t.length === 1))[0], /\nTODO\n/);
    assert.deepStrictEqual(await keys(), [['k', true], ['i', true]]);
    // The focus stays in the editor; asked again, it goes into the card.
    assert.ok(await page.evaluate("document.activeElement.classList.contains('cm-content')"));
    await page.keyboard.press('Control+K');
    await page.keyboard.press('Control+I');
    await until('the focus in the card', () => page.evaluate("document.activeElement.classList.contains('cm-bx-hover-pinned')"), (v) => v === true);
    // Its links can be reached with Tab.
    await page.keyboard.press('Tab');
    assert.strictEqual(await page.evaluate("document.activeElement.getAttribute('role')"), 'link');
    await page.keyboard.press('Escape');
    await until('no card', () => pinned.count(), (n) => n === 0);
    assert.ok(await page.evaluate("document.activeElement.classList.contains('cm-content')"));
    // Escape in the editor closes it too, and so does a move of the cursor.
    await page.keyboard.press('Control+K');
    await page.keyboard.press('Control+I');
    await until('the card', () => pinned.count(), (n) => n === 1);
    await page.keyboard.press('Escape');
    await until('no card', () => pinned.count(), (n) => n === 0);
    await page.keyboard.press('Control+K');
    await page.keyboard.press('Control+I');
    await until('the card', () => pinned.count(), (n) => n === 1);
    await page.keyboard.press('ArrowRight');
    await until('no card', () => pinned.count(), (n) => n === 0);
    // A click outside the editor closes it.
    await page.keyboard.press('Control+K');
    await page.keyboard.press('Control+I');
    await until('the card', () => pinned.count(), (n) => n === 1);
    await page.mouse.click(5, 5);
    await until('no card', () => pinned.count(), (n) => n === 0);
    await ctx.close();
  });

  it('puts the cursor on the line for the panel with Ctrl+K Ctrl+E and the card\'s links, with no card', async () => {
    const ctx = await context();
    const page = await ctx.newPage();
    await open(page);
    const keys = await recordKeys(page);
    await cursorTo(page, 4, 'end');
    await until('line 5 in the panel', () => panelLine(page), (t) => t.includes('echo end'));
    await page.mouse.move(5, 5);
    await page.keyboard.press('Control+K');
    await page.keyboard.press('Control+E');
    assert.deepStrictEqual(await keys(), [['k', true], ['e', true]]);
    await page.waitForTimeout(500);
    assert.strictEqual(await card(page).count(), 0);
    assert.match(await panelLine(page), /echo end/);
    // "Whole line" in the card of another line: the cursor goes to that line's first word, and the panel explains it.
    const t = ui.en;
    for (const [link, line, at] of [[t.hover.wholeLine, 2, 'grep'], [t.openInPanel, 1, 'for']] as const) {
      await hoverAt(page, line, line === 2 ? 'TODO' : 'ls');
      await cardText(page);
      await card(page).locator('a[data-command]', { hasText: link }).click();
      await until(`line ${line + 1} in the panel`, () => panelLine(page), (s) => s.includes(at));
      await until('no card', () => card(page).count(), (n) => n === 0);
      assert.ok(await page.evaluate("document.activeElement.classList.contains('cm-content')"));
      // The cursor is before the line's first word: from there to the end of the line.
      await page.keyboard.press('Shift+End');
      assert.strictEqual(await page.evaluate('getSelection().toString()'), (await page.locator('.cm-line').nth(line).innerText()).trimStart());
      assert.ok((await page.evaluate('getSelection().toString()') as string).startsWith(at));
    }
    // "Settings" opens the page's settings.
    await hoverAt(page, 2, 'TODO');
    await cardText(page);
    await card(page).locator('a[data-command]', { hasText: t.settings }).click();
    await until('the settings', () => page.locator('#settings-dialog').isVisible(), (v) => v);
    await ctx.close();
  });

  it('shows no card and leaves Ctrl+K and Ctrl+E to the browser with hover.enabled off', async () => {
    const ctx = await context();
    const page = await ctx.newPage();
    await open(page);
    const keys = await recordKeys(page);
    await page.locator('#settings-open').click();
    await page.locator('#setting-hover-enabled').uncheck();
    await page.locator('#settings-done').click();
    await cursorTo(page, 2, 'TODO');
    await page.keyboard.press('Control+K');
    await page.keyboard.press('Control+I');
    await page.keyboard.press('Control+K');
    await page.keyboard.press('Control+E');
    // (Ctrl+I alone is the editor's own key: it selects the syntax around the cursor.)
    assert.deepStrictEqual(await keys(), [['k', false], ['i', true], ['k', false], ['e', false]]);
    assert.strictEqual(await page.locator('.cm-bx-hover-pinned').count(), 0);
    await hoverAt(page, 2, '-n');
    await page.waitForTimeout(900);
    assert.strictEqual(await card(page).count(), 0);
    // On again: the card, and the keys are the page's.
    await page.locator('#settings-open').click();
    await page.locator('#setting-hover-enabled').check();
    await page.locator('#settings-done').click();
    await hoverAt(page, 2, '-n');
    await cardText(page);
    await cursorTo(page, 2, 'TODO');
    await page.keyboard.press('Control+K');
    await page.keyboard.press('Control+I');
    assert.deepStrictEqual(await keys(), [['k', true], ['i', true]]);
    await ctx.close();
  });

  it('shows no card on a touch screen', async () => {
    const ctx = await context({ width: 390, height: 740, touch: true });
    const page = await ctx.newPage();
    await open(page);
    assert.strictEqual(await page.evaluate("matchMedia('(hover: none)').matches"), true);
    await hoverAt(page, 2, '-n');
    await page.waitForTimeout(900);
    assert.strictEqual(await card(page).count(), 0);
    const p = await pointAt(page, 2, '-n');
    await page.touchscreen.tap(p.x, p.y);
    await page.waitForTimeout(900);
    assert.strictEqual(await card(page).count(), 0);
    await ctx.close();
  });

  // A long card (examples, a table of parts) by the first line, and by the last one in view.
  const LONG = "printf 'b\\na\\nb\\n' | sort | uniq -c | sort -rn\n" + Array.from({ length: 40 }, (_, i) => `echo ${i}`).join('\n') + "\nprintf 'b\\na\\nb\\n' | sort | uniq -c | sort -rn";
  for (const lang of ['en', 'ja'] as const) {
    for (const width of [1280, 390]) {
      it(`keeps the box inside the editor's pane at ${width} px (${lang})`, async () => {
        const ctx = await context({ lang, width, height: width > 400 ? 800 : 740 });
        const page = await ctx.newPage();
        await open(page, LONG);
        const pane = async () => page.locator('.cm-editor').boundingBox();
        const check = async (what: string) => {
          await until(`the card ${what}`, () => card(page).count(), (n) => n === 1);
          await frames(page, 3);
          const p = (await pane())!;
          const b = (await box(page).boundingBox())!;
          const where = `${what}: box ${JSON.stringify(b)}, pane ${JSON.stringify(p)}`;
          assert.ok(b.y >= p.y - 1 && b.y + b.height <= p.y + p.height + 1, where);
          assert.ok(b.x >= Math.max(p.x, 8) - 1 && b.x + b.width <= Math.min(p.x + p.width, width - 8) + 1, where);
        };
        // (Typed, the text is scrolled to its end.)
        await page.keyboard.press('Control+Home');
        await frames(page, 3);
        await hoverAt(page, 0, 'uniq');
        await check('by the first line');
        // The last line in view: scroll to the end, and hover the last line.
        await page.locator('.cm-content').focus();
        await page.keyboard.press('Control+End');
        await frames(page, 3);
        const lines = await page.locator('.cm-line').count();
        await hoverAt(page, lines - 1, 'uniq');
        await check('by the last line');
        await ctx.close();
      });
    }
  }

  it('reads every card of the sample into HTML with no Markdown left, and keeps to the allow-list', async () => {
    const ctx = await context();
    const page = await ctx.newPage();
    // A page of its own (the web page's policy allows no inline script), with the icons of the page.
    await page.goto('about:blank');
    await page.addScriptTag({ content: fs.readFileSync(path.join(root, 'media/icons.js'), 'utf8') });
    const bundle = buildSync({
      stdin: { contents: "import { renderCard } from './web/hover-markdown'; (window as any).bxRenderCard = renderCard;", resolveDir: root, loader: 'ts' },
      bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2020',
    }).outputFiles[0].text;
    await page.addScriptTag({ content: bundle });
    // Every card hoverView makes for the sample, in both languages and themes: each part (every 2nd column) and each line card.
    const parser = createUnbashParser();
    const sample = openDocument(fs.readFileSync(path.join(root, 'test/fixtures/sample.sh'), 'utf8'), 'shell', (t) => parser.parse(t));
    const cards = new Set<string>();
    for (const lang of ['en', 'ja'] as const) {
      for (const theme of ['light', 'dark'] as const) {
        for (let line = 0; line < sample.lines.length; line++) {
          const ex = explainDocumentLine(new Analyzer(lang), sample, line, lang, {}, {});
          if (!ex.items.length) continue;
          const x: HoverInput = { ex, lang, theme, lineText: sample.lines[line], placement: 'first', panelLink: 'command:bashExplainer.openPanel', lineLink: 'command:bashExplainer.explainLine', keys: 'Ctrl+K Ctrl+E' };
          cards.add(lineCard(x));
          for (let c = 0; c <= sample.lines[line].length; c += 2) {
            const chain = partAt(ex.items, { line, character: c }, heredocAt(sample, line));
            if (chain.length) cards.add(partHover(x, chain));
          }
        }
      }
    }
    assert.ok(cards.size > 1500, String(cards.size));
    // The icons a card asks for: `$(name)` outside code.
    const icons = (md: string) => (md.replace(/^(`{3,})text\n[\s\S]*?\n\1$/gm, '').replace(/(`+)(?:(?!\1)[\s\S])*?\1/g, '').match(/\$\([a-z-]+\)/g) ?? []).length;
    // A character hoverView writes as an entity is text (a label's `**/*.sh`, `$(date)`): it becomes a character of the
    // private use area, so that what is left of `*`, `` ` ``, `$(`… in the text is Markdown that was not read.
    const literal = (md: string) => md.replace(/&#(35|36|42|62|91|92|93|95|96|124|126);|&gt;/g, (m, n?: string) => `&#${0xe000 + Number(n ?? 62)};`);
    const list = [...cards].map((md) => ({ md: literal(md), icons: icons(md) }));
    // (The functions run in the page, given as text: this file is compiled without the DOM's types.)
    const problems = await page.evaluate(`((list) => {
      const out = [];
      for (const { md, icons } of list) {
        const el = window.bxRenderCard(md);
        // The text a reader sees outside code: no Markdown syntax is left.
        const copy = el.cloneNode(true);
        for (const c of copy.querySelectorAll('code, pre')) c.remove();
        const text = copy.textContent;
        const blocks = Array.from(copy.querySelectorAll('p, h1, h2, h3, h4, h5, h6, blockquote, td')).map((b) => b.textContent.trim());
        const leak = /\\*\\*|\`|\\$\\([a-z-]+\\)|\\]\\(/.exec(text)?.[0] ?? blocks.find((b) => /^(> |#{1,6} |-{3,}$)/.test(b));
        if (leak) out.push(JSON.stringify(leak) + ' in ' + md.slice(0, 300));
        const drawn = el.querySelectorAll('svg.cm-bx-hover-icon').length;
        if (drawn !== icons) out.push(icons + ' icons asked, ' + drawn + ' drawn: ' + md.slice(0, 200));
        // Every link is a page on the web or one of the extension's commands.
        for (const a of el.querySelectorAll('a')) {
          if (!(a.getAttribute('href')?.startsWith('https://') || a.dataset.command)) out.push('link ' + a.outerHTML);
        }
        if (out.length > 5) break;
      }
      return out;
    })(${JSON.stringify(list)})`);
    assert.deepStrictEqual(problems, []);
    // What the allow-list drops: scripts and styles with what they hold, handlers, other styles, links that are not https.
    const hostile = [
      'a <script>window.bxRan = 1</script> b',
      '<style>body { display: none }</style>text',
      '<img src="x" onerror="window.bxRan = 2"> <iframe src="https://example.com"></iframe>',
      '<span style="position:fixed;top:0" onclick="window.bxRan = 3" title="t">s</span> <span style="color:#fff;">kept</span>',
      '[js](javascript:window.bxRan=4) [http](http://example.com) [data](data:text/html,x) [ok](https://example.com "T")',
      '<a href="javascript:void(0)" onmouseover="x">a</a> <div class="x" id="y">d</div>',
      '<table><tr><td onclick="x">cell</td></tr></table>',
      '<svg><script>1</script></svg><math>m</math><textarea>t</textarea>',
      '[$(gear) Settings](command:bashExplainer.openSettings) $(unknown-icon) `**not bold**` **bold** _em_ snake_case_word 2 * 3 * 4',
    ];
    const got = await page.evaluate(`((list) => list.map((md) => {
      const el = window.bxRenderCard(md);
      document.body.appendChild(el);
      const all = Array.from(el.querySelectorAll('*'));
      const attrs = all.flatMap((e) => Array.from(e.attributes).map((a) => e.tagName.toLowerCase() + '[' + a.name + '=' + a.value + ']'));
      const html = el.innerHTML;
      el.remove();
      return { tags: [...new Set(all.map((e) => e.tagName.toLowerCase()))].sort(), attrs, text: el.textContent, html };
    }))(${JSON.stringify(hostile)})`) as { tags: string[]; attrs: string[]; text: string; html: string }[];
    assert.strictEqual(await page.evaluate('window.bxRan'), undefined);
    for (const g of got.slice(0, 8)) for (const t of ['script', 'style', 'img', 'iframe', 'div', 'svg', 'math', 'textarea']) assert.ok(!g.tags.includes(t), `<${t}> kept: ${g.html}`);
    for (const g of got) {
      for (const a of g.attrs) {
        assert.doesNotMatch(a, /\[on|\[class=x|\[id=|position:fixed|javascript:|http:|data:text/, a);
      }
    }
    assert.match(got[0].text!, /^a\s+b$/);
    assert.strictEqual(got[1].text, 'text');
    assert.deepStrictEqual(got[3].attrs, ['span[title=t]', 'span[style=color:#fff;]']);
    assert.deepStrictEqual(got[4].attrs.sort(), ['a[href=https://example.com]', 'a[rel=noopener noreferrer]', 'a[target=_blank]', 'a[title=T]']);
    assert.strictEqual(got[4].text, 'js http data ok');
    assert.strictEqual(got[6].html, '<table><tbody><tr><td>cell</td></tr></tbody></table>');
    assert.strictEqual(got[7].text, '');
    // The extension's command is the page's action; an unknown icon draws nothing; code is text; emphasis by CommonMark's rules.
    assert.ok(got[8].attrs.includes('a[data-command=bashExplainer.openSettings]'), got[8].attrs.join(' '));
    assert.match(got[8].html, /<code>\*\*not bold\*\*<\/code> <strong>bold<\/strong> <em>em<\/em> snake_case_word 2 \* 3 \* 4/);
    assert.strictEqual((got[8].html.match(/<svg/g) ?? []).length, 1);
    await ctx.close();
  });
});
