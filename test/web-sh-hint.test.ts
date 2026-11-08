// The web page's hint toward POSIX sh (docs/design/usability-9.md, 2.1; Q2, Q3), run for real in headless Chromium: a line
// of the Problems strip, after the list or in place of "No problems", for a script whose shell comes from
// `#!/usr/bin/env bash` or from no shebang; its count from `dialectIssues` for sh; its button reads the script as sh, as the
// chip's popover does; it is never a problem (the counts, the list and the Problems tab do not hold it); laid out inside
// the pane and the sheet at 390 and 1280 px, in both languages. Unit tests of the count: test/sh-hint.test.ts.
import * as assert from 'assert';
import type { Browser, BrowserContextOptions, Page } from 'playwright-core';
import { dialectIssues } from '../src/dialect';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { currentShell, openSite, pickKind, problemRows, problemsShown, until } from './support/site';

// Bash has no problem with these lines; POSIX sh has two ([[ ]] and an array).
const ONLY_SH = '[[ -f a ]] && echo y\narr=(a b)\n';
// Bash has one problem here (`local` outside a function); POSIX sh three more (and the same one).
const BOTH = `${ONLY_SH}local v=1\n`;

const parser = createUnbashParser();
/** The count the hint must say: the dialect issues of the text for sh. */
const shIssues = (text: string): number => dialectIssues(parser.parse(text), 'sh', 'en').length;

describe('the web page: the hint toward POSIX sh', function () {
  this.timeout(180000);
  let browser: Browser;
  let base = '';

  before(async function () {
    ({ browser, base } = await openSite(this));
  });

  async function open(options: BrowserContextOptions, text: string): Promise<Page> {
    const ctx = await browser.newContext(options);
    const page = await ctx.newPage();
    await page.goto(base);
    await page.locator('.cm-line').first().waitFor();
    await until('the sample\'s problems', () => problemsShown(page), (v) => v, 20000);
    // (The sample has a hint of its own, which the page works out when idle, after the check: the text's hint is waited for past it.)
    // (By its attribute: on a phone the sheet shows another tab, and the line has no box.)
    await page.locator('#problems-sh:not([hidden])').waitFor({ state: 'attached', timeout: 20000 });
    const sampleSaid = await page.locator('#sh-hint-text').textContent();
    await page.locator('.cm-content').focus();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText(text);
    // (The page starts with the sample, which has many problems and a hint of its own: the text is checked once few are left.)
    await until('the text checked', () => problemRows(page).count(), (c) => c <= 10, 15000);
    await until('the text\'s hint', async () => (await page.locator('#problems-sh:not([hidden])').count()) > 0 && (await page.locator('#sh-hint-text').textContent()) === sampleSaid, (stale) => !stale, 15000);
    return page;
  }

  const desktop = (width: number, lang: 'en' | 'ja'): BrowserContextOptions => ({ viewport: { width, height: 800 }, locale: lang === 'ja' ? 'ja-JP' : 'en-US' });
  const hint = (page: Page) => page.locator('#problems-sh');

  it('shows for #!/usr/bin/env bash and for no shebang, with the count of the dialect issues for sh, and for no other shebang', async () => {
    const want = (text: string) => `${shIssues(text)} constructs not in POSIX sh`;
    const cases: [string, string, string | undefined][] = [
      ['env bash', `#!/usr/bin/env bash\n${BOTH}`, want(`#!/usr/bin/env bash\n${BOTH}`)],
      ['env -S bash', `#!/usr/bin/env -S bash -e\n${BOTH}`, want(`#!/usr/bin/env -S bash -e\n${BOTH}`)],
      ['no shebang', BOTH, want(BOTH)],
      ['/bin/bash', `#!/bin/bash\n${BOTH}`, undefined],
      ['/usr/bin/bash', `#!/usr/bin/bash\n${BOTH}`, undefined],
      ['sh', `#!/bin/sh\n${BOTH}`, undefined],
      ['a ShellCheck directive', `# shellcheck shell=bash\n${BOTH}`, undefined],
    ];
    for (const [name, text, said] of cases) {
      const page = await open(desktop(1280, 'en'), text);
      if (said === undefined) {
        // (The strip is checked: the hint would be there by now.)
        assert.strictEqual(await hint(page).isVisible(), false, name);
      } else {
        await hint(page).waitFor({ state: 'visible' });
        assert.strictEqual(await page.locator('#sh-hint-text').textContent(), said, name);
        assert.strictEqual(await page.locator('#sh-hint-button').textContent(), 'Check as POSIX sh', name);
      }
      await page.context().close();
    }
  });

  it('is not shown for a bats file, whatever its lines', async () => {
    const page = await open(desktop(1280, 'en'), `#!/usr/bin/env bats\n@test "a" {\n  [[ -f a ]]\n  arr=(a b)\n}\n`);
    await pickKind(page, 'bats');
    await until('the kind', () => page.locator('#scope-kinds [aria-checked="true"]').getAttribute('data-value'), (v) => v === 'bats');
    await until('the bats file\'s hint gone', () => hint(page).isVisible(), (v) => !v);
    await page.context().close();
  });

  it('says one problem in the singular, and nothing for a script POSIX sh reads without a problem', async () => {
    const one = '#!/usr/bin/env bash\n[[ -f a ]]\n';
    assert.strictEqual(shIssues(one), 1);
    const page = await open(desktop(1280, 'en'), one);
    await hint(page).waitFor({ state: 'visible' });
    assert.strictEqual(await page.locator('#sh-hint-text').textContent(), '1 construct not in POSIX sh');
    await page.locator('.cm-content').focus();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText('#!/usr/bin/env bash\necho hi\n');
    await until('the hint gone', () => hint(page).isVisible(), (v) => !v);
    await page.context().close();
  });

  for (const lang of ['en', 'ja'] as const) {
    it(`is a line of the strip, never a problem: the counts, the list and "No problems" stay as they were (${lang})`, async () => {
      const page = await open(desktop(1280, lang), ONLY_SH);
      await hint(page).waitFor({ state: 'visible' });
      const none = lang === 'en' ? 'No problems' : '問題なし';
      // In place of "No problems": the strip says it, the fold has nothing to open, and the hint is the line after it.
      assert.strictEqual(await page.locator('#problems-title').textContent(), none);
      assert.strictEqual(await page.locator('#problems-said').textContent(), none);
      assert.strictEqual(await page.locator('#problems-toggle').isDisabled(), true);
      assert.strictEqual(await page.locator('#problems-counts .count').count(), 0);
      assert.strictEqual(await problemRows(page).count(), 0);
      const n = shIssues(ONLY_SH);
      assert.strictEqual(await page.locator('#sh-hint-text').textContent(), lang === 'en' ? `${n} constructs not in POSIX sh` : `POSIX sh にない書き方が ${n} 件`);
      assert.strictEqual(await page.locator('#sh-hint-button').textContent(), lang === 'en' ? 'Check as POSIX sh' : 'POSIX sh として確認');
      // The strip's row is as high as ever; the hint is below it, inside the box.
      const [strip, line, box] = await Promise.all(['.problems-strip', '#problems-sh', '#problems'].map((s) => page.locator(s).boundingBox()));
      assert.strictEqual(Math.round(strip!.height), 32);
      assert.ok(line!.y >= strip!.y + strip!.height - 0.5 && line!.y + line!.height <= box!.y + box!.height + 0.5, JSON.stringify([strip, line, box]));
      // A problem of bash's own: the list opens, the counts hold it alone, and the hint is after the list.
      await page.locator('.cm-content').focus();
      await page.keyboard.press('Control+A');
      await page.keyboard.insertText(BOTH);
      await until('the problem', () => problemRows(page).count(), (c) => c === 1);
      assert.deepStrictEqual(await page.locator('#problems-counts .count').count(), 1);
      assert.strictEqual(await page.locator('#problems-said').textContent(), lang === 'en' ? 'Problems: 1 caveat' : '問題：注意 1 件');
      await until('the hint for the new text', () => page.locator('#sh-hint-text').textContent(), (t) => t === (lang === 'en' ? `${shIssues(BOTH)} constructs not in POSIX sh` : `POSIX sh にない書き方が ${shIssues(BOTH)} 件`));
      const [list, after] = await Promise.all(['#problem-list', '#problems-sh'].map((s) => page.locator(s).boundingBox()));
      assert.ok(after!.y >= list!.y + list!.height - 0.5, JSON.stringify([list, after]));
      // Folded, the list goes and the hint stays.
      await page.locator('#problems-toggle').click();
      assert.strictEqual(await page.locator('#problem-list').isVisible(), (await page.locator('#problems-toggle').getAttribute('aria-expanded')) === 'true');
      assert.strictEqual(await hint(page).isVisible(), true);
      await page.context().close();
    });
  }

  it('has a button that reads the script as POSIX sh, as the chip does, and the list then has the sh problems', async () => {
    const page = await open(desktop(1280, 'en'), BOTH);
    await hint(page).waitFor({ state: 'visible' });
    assert.strictEqual(await currentShell(page), 'auto');
    // (Bash's own problem: `local` outside a function.)
    await until('bash\'s problem', () => problemRows(page).count(), (c) => c === 1);
    await page.locator('#sh-hint-button').click();
    assert.strictEqual(await currentShell(page), 'sh');
    await until('the hint gone', () => hint(page).isVisible(), (v) => !v);
    // The list holds the problems of bash that sh keeps, and at least as many more as the hint counted (sh's explanations may add others: the count is of the dialect issues alone).
    const rows = problemRows(page);
    await until('the sh problems', () => rows.count(), (c) => c >= 1 + shIssues(BOTH));
    // The focus stayed in the strip, on the fold, not on the page.
    await until('the focus', () => page.evaluate('document.activeElement && document.activeElement.id'), (id) => id === 'problems-toggle');
    // Back to Auto (the chip's popover): the hint is back.
    await page.locator('#scope-chip').click();
    await page.locator('#scope-shell-auto').click();
    await hint(page).waitFor({ state: 'visible' });
    await page.context().close();
  });

  it('keeps the list its room when the hint comes under a list set to its least height: the least moves with it', async () => {
    const page = await open(desktop(1280, 'en'), '#!/bin/bash\nlocal a=1\nlocal b=2\nlocal c=3\n');
    await until('the three problems', () => problemRows(page).count(), (c) => c === 3);
    assert.strictEqual(await hint(page).isVisible(), false);
    await page.locator('#problems-resize').focus();
    await page.keyboard.press('Home');
    const listHeight = () => page.locator('#problem-list').evaluate((e) => Math.round(e.getBoundingClientRect().height));
    const least = Number(await page.locator('#problems-resize').getAttribute('aria-valuemin'));
    const room = await listHeight();
    assert.ok(room >= 36, `${room}`);
    // The first line says env bash: the hint comes, under the list.
    await page.locator('.cm-content').focus();
    await page.keyboard.press('Control+Home');
    await page.keyboard.press('Shift+End');
    await page.keyboard.insertText('#!/usr/bin/env bash');
    await hint(page).waitFor({ state: 'visible' });
    const line = (await hint(page).boundingBox())!;
    await until('the least height with the hint', () => page.locator('#problems-resize').getAttribute('aria-valuemin'), (v) => Number(v) === least + Math.round(line.height));
    // The list has what it had; the hint took its room from nowhere else.
    await until('the list keeps its room', listHeight, (h) => h >= room - 1);
    // And back: the hint goes, the least goes back.
    await page.keyboard.press('Control+Home');
    await page.keyboard.press('Shift+End');
    await page.keyboard.insertText('#!/bin/bash');
    await until('the hint gone', () => hint(page).isVisible(), (v) => !v);
    await until('the least back', () => page.locator('#problems-resize').getAttribute('aria-valuemin'), (v) => Number(v) === least);
    await page.context().close();
  });

  for (const width of [390, 1280]) {
    for (const lang of ['en', 'ja'] as const) {
      it(`lays out inside the pane without overflow or overlap: ${width} px, ${lang}`, async () => {
        const page = await open(desktop(width, lang), BOTH);
        await hint(page).waitFor({ state: 'visible' });
        const boxes = await page.evaluate(`['#source', '#problems', '.problems-strip', '#problems-sh', '#sh-hint-text', '#sh-hint-button'].map((s) => {
          const r = document.querySelector(s).getBoundingClientRect();
          return { x: r.x, y: r.y, w: r.width, h: r.height };
        })`) as { x: number; y: number; w: number; h: number }[];
        const [pane, box, strip, line, text, button] = boxes;
        const at = JSON.stringify(boxes);
        for (const b of [line, text, button]) assert.ok(b.x >= pane.x - 0.5 && b.x + b.w <= pane.x + pane.w + 0.5, `inside the pane: ${at}`);
        assert.ok(line.y + line.h <= box.y + box.h + 0.5 && line.y >= strip.y + strip.h - 0.5, `below the strip, inside the box: ${at}`);
        // The text and the button do not overlap: side by side, or one above the other.
        assert.ok(text.x + text.w <= button.x + 0.5 || text.y + text.h <= button.y + 0.5, `no overlap: ${at}`);
        for (const b of [text, button]) assert.ok(b.y >= line.y - 0.5 && b.y + b.h <= line.y + line.h + 0.5, `inside the line: ${at}`);
        // (A narrow page has the touch targets of 44 px.)
        const narrow = await page.evaluate('document.documentElement.classList.contains("narrow")');
        assert.ok(button.h >= (narrow ? 44 : 28) - 0.5, at);
        assert.strictEqual(await page.evaluate('document.documentElement.scrollWidth <= innerWidth'), true, at);
        assert.strictEqual(await page.locator('#sh-hint-text').evaluate((e) => e.scrollWidth <= e.clientWidth + 1), true, at);
        await page.context().close();
      });
    }
  }

  it('keeps the focus in the sheet after the phone\'s button: on the first problem, or on the Problems tab', async () => {
    const options: BrowserContextOptions = { ...(await import('playwright-core')).devices['iPhone 13'], viewport: { width: 390, height: 740 }, locale: 'en-US' };
    for (const text of [ONLY_SH, BOTH]) {
      const page = await open(options, text);
      if (await page.locator('#readtip').isVisible()) await page.locator('#readtip-close').tap();
      await page.locator('#tab-problems').tap();
      await hint(page).waitFor({ state: 'visible' });
      await page.locator('#sh-hint-button').focus();
      await page.locator('#sh-hint-button').press('Enter');
      await until('the hint gone', () => hint(page).isVisible(), (v) => !v);
      // (The list now holds the sh problems: the focus is on its first row, or on the tab, never on the page.)
      const focused = () => page.evaluate("(() => { const a = document.activeElement; return a ? (a.id || a.className || a.tagName) : ''; })()");
      await until('the focus kept', focused, (f) => f !== 'BODY' && f !== '' && f !== 'sh-hint-button');
      assert.strictEqual(await page.evaluate("document.activeElement.closest('#problems, #panel-head') !== null"), true, String(await focused()));
      await page.context().close();
    }
  });

  it('is the same line in the phone\'s Problems tab, in place of "No problems" and after the list', async () => {
    const options: BrowserContextOptions = { ...(await import('playwright-core')).devices['iPhone 13'], viewport: { width: 390, height: 740 }, locale: 'en-US' };
    for (const text of [ONLY_SH, BOTH]) {
      const page = await open(options, text);
      if (await page.locator('#readtip').isVisible()) await page.locator('#readtip-close').tap();
      await page.locator('#tab-problems').tap();
      await hint(page).waitFor({ state: 'visible' });
      // The tab counts the problems of bash alone (one caveat), or says there are none with the hint's count, which is no problem.
      const said = await page.locator('#tab-problems').getAttribute('aria-label');
      assert.strictEqual(said, text === ONLY_SH ? `No problems; ${shIssues(text)} constructs not in POSIX sh` : 'Problems: 1 caveat');
      const [pane, line, button] = await Promise.all(['#panel-pane', '#problems-sh', '#sh-hint-button'].map((s) => page.locator(s).boundingBox()));
      assert.ok(line!.x >= pane!.x - 0.5 && line!.x + line!.width <= pane!.x + pane!.width + 0.5, JSON.stringify([pane, line]));
      assert.ok(line!.y + line!.height <= pane!.y + pane!.height + 0.5 && button!.height >= 44 - 0.5, JSON.stringify([pane, line, button]));
      assert.strictEqual(await page.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), true);
      await page.context().close();
    }
  });

  // The phone's Problems tab (usability-9.md, U12; the maintainer's decision of 2026-11-08, after run 4): with no problem,
  // ✓ and the hint's count, "✓ · sh 2", so that a reader finds the hint behind the tab; in its name too. With problems,
  // their counts alone, as before; nothing where POSIX sh lacks nothing.
  const phone = async (width: number, lang: 'en' | 'ja'): Promise<BrowserContextOptions> => ({ ...(await import('playwright-core')).devices['iPhone 13'], viewport: { width, height: 740 }, locale: lang === 'ja' ? 'ja-JP' : 'en-US' });
  const tab = (page: Page) => page.locator('#tab-problems');
  const shSaid = (lang: 'en' | 'ja', n: number) => (lang === 'en' ? `${n} constructs not in POSIX sh` : `POSIX sh にない書き方が ${n} 件`);
  /** The sheet's row as drawn: whether it was squeezed, how far its tabs and the view control reach past the row (px, 0 when inside), and the page's own overflow. */
  const row = (page: Page) => page.evaluate(`(() => {
    const head = document.getElementById('panel-head');
    const shown = (e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden';
    const parts = [...head.querySelectorAll('#panel-tabs [role=tab], #view-slot')].filter(shown).map((e) => e.getBoundingClientRect());
    const hr = head.getBoundingClientRect();
    const tab = document.getElementById('tab-problems');
    return {
      squeeze: head.dataset.squeeze !== undefined,
      past: Math.max(0, head.scrollWidth - head.clientWidth, ...parts.map((r) => r.right - hr.right), ...parts.map((r) => hr.left - r.left), tab.scrollWidth - tab.clientWidth),
      overlap: parts.some((a, i) => parts.some((b, j) => j > i && a.left < b.right - 0.5 && b.left < a.right - 0.5)),
      page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  })()`) as Promise<{ squeeze: boolean; past: number; overlap: boolean; page: number }>;
  /** How the row lays out the tab: the form's parts, and where the count lies against the ✓ (beside it, past the dot, or under it). */
  const form = (page: Page) => page.evaluate(`(() => {
    const head = document.getElementById('panel-head');
    const tab = document.getElementById('tab-problems');
    const mark = tab.querySelector('.tab-counts').getBoundingClientRect();
    const sh = tab.querySelector('.sh-count')?.getBoundingClientRect();
    const dot = tab.querySelector('.tab-sep')?.getBoundingClientRect();
    return {
      parts: { view: document.getElementById('view-slot').dataset.form, tabs: head.dataset.tabs, line: head.dataset.line },
      sh: head.dataset.sh,
      beside: !!sh && !!dot && mark.right <= dot.left + 0.5 && dot.right <= sh.left + 0.5 && Math.abs((sh.top + sh.bottom) / 2 - (mark.top + mark.bottom) / 2) < 3,
      under: !!sh && !dot && sh.top >= mark.bottom - 0.5,
    };
  })()`) as Promise<{ parts: object; sh: string; beside: boolean; under: boolean }>;
  async function retype(page: Page, text: string): Promise<void> {
    await page.locator('.cm-content').focus();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText(text);
  }

  for (const width of [390, 360]) {
    for (const lang of ['en', 'ja'] as const) {
      it(`shows the count of the constructs not in POSIX sh on the phone's Problems tab with no problem, and says it: ${width} px, ${lang}`, async () => {
        const page = await open(await phone(width, lang), ONLY_SH);
        const n = shIssues(ONLY_SH);
        await until('the tab\'s count', () => tab(page).textContent(), (t) => t === `✓·sh ${n}` || t === `✓sh ${n}`);
        const none = lang === 'en' ? 'No problems; ' : '問題なし。';
        assert.strictEqual(await tab(page).getAttribute('aria-label'), none + shSaid(lang, n));
        assert.match(await tab(page).ariaSnapshot(), new RegExp(`^- tab "${none}${shSaid(lang, n)}": ✓( · | ?)sh ${n}$`));
        const f = await form(page);
        assert.ok(f.sh === 'dot' ? f.beside : f.under, JSON.stringify(f));
        assert.deepStrictEqual(await row(page), { squeeze: false, past: 0, overlap: false, page: 0 });
        // With a problem of bash's own: its count alone, as before (the hint is the line in the tab).
        await retype(page, BOTH);
        await until('the tab\'s count', () => tab(page).textContent(), (t) => t === 'ⓘ1');
        assert.strictEqual(await tab(page).getAttribute('aria-label'), lang === 'en' ? 'Problems: 1 caveat' : '問題：注意 1 件');
        // A script POSIX sh reads as bash does: ✓ alone, and "No problems".
        await retype(page, 'echo hi\n');
        await until('the ✓ alone', () => tab(page).textContent(), (t) => t === '✓');
        assert.strictEqual(await tab(page).getAttribute('aria-label'), lang === 'en' ? 'No problems' : '問題なし');
        await page.context().close();
      });
    }
  }

  // The count costs the row nothing it shows with ✓ alone (as main lays it out: the depth's segments 「概要」「単語ごと」 and
  // 「早見表」 in Japanese, the line "Ln 3" in English); beside the ✓ at 390 px, the iPhone 13's width, and under it where
  // the row has no room for it there.
  for (const [width, lang, parts, sh] of [
    [390, 'en', { view: 'menu', tabs: 'short', line: 'true' }, 'dot'],
    [430, 'en', { view: 'menu', tabs: 'full', line: 'true' }, undefined],
    [360, 'en', { view: 'menu', tabs: 'short', line: 'false' }, undefined],
    [390, 'ja', { view: 'segments', tabs: 'full', line: 'true' }, 'dot'],
    [360, 'ja', { view: 'segments', tabs: 'full', line: 'true' }, undefined],
    [320, 'ja', { view: 'segments', tabs: 'full', line: 'true' }, undefined],
  ] as const) {
    it(`keeps the row's other parts beside the sh count: ${width} px, ${lang}`, async () => {
      const page = await open(await phone(width, lang), ONLY_SH);
      await until('the tab\'s count', () => tab(page).locator('.sh-count').count(), (c) => c === 1);
      await page.waitForTimeout(300);
      const f = await form(page);
      assert.deepStrictEqual(f.parts, parts, JSON.stringify(f));
      if (sh) assert.strictEqual(f.sh, sh, JSON.stringify(f));
      assert.ok(f.sh === 'dot' ? f.beside : f.under, JSON.stringify(f));
      assert.deepStrictEqual(await row(page), { squeeze: false, past: 0, overlap: false, page: 0 });
      await page.context().close();
    });
  }

  // A long count with no problem ("sh 12"): inside the row at every phone width.
  const MANY = `${'[[ -f a ]] && echo y\n'.repeat(11)}arr=(a b)\n`;
  for (const width of [320, 360, 390]) {
    for (const lang of ['en', 'ja'] as const) {
      it(`keeps the sheet's row inside its width with a two-digit sh count: ${width} px, ${lang}`, async () => {
        const page = await open(await phone(width, lang), ONLY_SH);
        await retype(page, MANY);
        const sh = shIssues(MANY);
        assert.ok(sh >= 10, String(sh));
        await until('the long count', () => tab(page).locator('.sh-count').textContent(), (t) => t === `sh ${sh}`);
        await page.waitForTimeout(300);
        const m = await row(page);
        assert.deepStrictEqual({ past: m.past, overlap: m.overlap, page: m.page }, { past: 0, overlap: false, page: 0 }, JSON.stringify(m));
        // (In English at 320 px the Explanation tab's word is cut with ✓ alone too: never the row.)
        if (lang === 'ja' || width > 320) assert.strictEqual(m.squeeze, false, JSON.stringify(m));
        await page.context().close();
      });
    }
  }

  // The Explanation tab's line has the room of the document's last line: a move of the cursor from Ln 9 to Ln 10, or
  // from Ln 99 to Ln 100, moves no box of the row and keeps its form (it flipped the sh count's form at 390 px).
  for (const [width, lang] of [[390, 'en'], [430, 'en'], [390, 'ja']] as const) {
    it(`moves nothing in the sheet's row when the cursor goes from line 9 to 10, and 99 to 100: ${width} px, ${lang}`, async () => {
      const page = await open(await phone(width, lang), ONLY_SH);
      const boxes = () => page.evaluate(`(() => {
        const head = document.getElementById('panel-head');
        const at = (s) => { const r = document.querySelector(s).getBoundingClientRect(); return [r.left, r.right, r.top, r.bottom].map((v) => Math.round(v * 10) / 10).join(' '); };
        return { form: head.dataset.sh + ' ' + head.dataset.line + ' ' + head.dataset.tabs, explain: at('#tab-explain'), problems: at('#tab-problems'), ref: at('#tab-ref'), view: at('#view-slot'), line: document.querySelector('#tab-explain .tab-line-at').textContent };
      })()`) as Promise<{ form: string; explain: string; problems: string; ref: string; view: string; line: string }>;
      const label = (n: number) => (lang === 'en' ? `Ln ${n}` : `行 ${n}`);
      for (const [lines, from] of [[12, 9], [120, 99]]) {
        await retype(page, ONLY_SH + 'echo hi\n'.repeat(lines - 3));
        await until('the sh count', () => tab(page).locator('.sh-count').count(), (c) => c === 1);
        await page.keyboard.press('Control+Home');
        for (let i = 1; i < from; i++) await page.keyboard.press('ArrowDown');
        const before = await until('the line', boxes, (b) => b.line === label(from));
        await page.keyboard.press('ArrowDown');
        const after = await until('the next line', boxes, (b) => b.line === label(from + 1));
        assert.deepStrictEqual({ ...after, line: '' }, { ...before, line: '' }, `${lines} lines: ${JSON.stringify([before, after])}`);
        assert.deepStrictEqual(await row(page), { squeeze: false, past: 0, overlap: false, page: 0 });
      }
      await page.context().close();
    });
  }
});
