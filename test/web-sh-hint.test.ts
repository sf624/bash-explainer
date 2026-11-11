// The web page's hint toward POSIX sh (docs/design/usability-9.md, 2.1; Q2, Q3), run for real in headless Chromium: a line
// of the Problems strip, after the list or in place of "No problems", for a script with no shebang (any shebang, bash's
// too, says the author chose: decision of 2026-11-09, #761); its count from `dialectIssues` for sh; its button switches the page's
// shell to sh, as the chip's popover does, and says so (#746: the chip lights up, a toast with Undo); with no problem the strip
// says "No problems in bash" above it; it is never a problem (the counts, the list and the Problems tab do not hold it); laid out inside
// the pane and the sheet at 390 and 1280 px, in both languages. Unit tests of the count: test/sh-hint.test.ts.
import * as assert from 'assert';
import type { Browser, BrowserContextOptions, Page } from 'playwright-core';
import { dialectIssues } from '../src/dialect';
import { SH_COUNT_COMMANDS } from '../src/document';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { contrast, parseColour, type RGB } from '../src/ui/colour';
import { currentShell, FRAMES, openSite, pickKind, problemRows, problemsShown, setShell, toastText, until } from './support/site';

// Bash has no problem with these lines; POSIX sh has two ([[ ]] and an array).
const ONLY_SH = '[[ -f a ]] && echo y\narr=(a b)\n';
// Bash has one problem here (`local` outside a function); POSIX sh three more (and the same one).
const BOTH = `${ONLY_SH}local v=1\n`;
// More commands than the hint counts (src/document.ts, `SH_COUNT_COMMANDS`): the line says it does not count them.
const LARGE = `${BOTH}${'echo a\n'.repeat(SH_COUNT_COMMANDS)}`;

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
    await page.locator('.cm-content').focus();
    await page.keyboard.press('Control+A');
    const worked = Number(await page.locator('#problems-sh').getAttribute('data-worked') ?? 0);
    // (A long text is pasted, as the context menu does: `insertText` of so much is slow.)
    if (text.length < 1000) await page.keyboard.insertText(text);
    else {
      await page.evaluate(`(() => {
        const data = new DataTransfer();
        data.setData('text/plain', ${JSON.stringify(text)});
        document.querySelector('.cm-content').dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
      })()`);
    }
    // (The page starts with the sample, which has many problems: the text is checked once few are left. The sample has a shebang, so no hint is left from it.)
    await until('the text checked', () => problemRows(page).count(), (c) => c <= 10, 15000);
    // (The hint is worked out when the page is idle, shown or not: its count of runs says it was worked out for the text.)
    await until('the hint worked out', async () => Number(await page.locator('#problems-sh').getAttribute('data-worked') ?? 0), (n) => n > worked, 15000);
    return page;
  }

  const desktop = (width: number, lang: 'en' | 'ja'): BrowserContextOptions => ({ viewport: { width, height: 800 }, locale: lang === 'ja' ? 'ja-JP' : 'en-US' });
  const hint = (page: Page) => page.locator('#problems-sh');

  it('shows for no shebang, with the count of the dialect issues for sh, and for none of the shebangs', async () => {
    const want = (text: string) => `${shIssues(text)} constructs not in POSIX sh`;
    const cases: [string, string, string | undefined][] = [
      ['no shebang', BOTH, want(BOTH)],
      ['env bash', `#!/usr/bin/env bash\n${BOTH}`, undefined],
      ['env -S bash', `#!/usr/bin/env -S bash -e\n${BOTH}`, undefined],
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
        assert.strictEqual(await page.locator('#sh-hint-button').textContent(), 'Switch to POSIX sh', name);
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
    const one = '[[ -f a ]]\n';
    assert.strictEqual(shIssues(one), 1);
    const page = await open(desktop(1280, 'en'), one);
    await hint(page).waitFor({ state: 'visible' });
    assert.strictEqual(await page.locator('#sh-hint-text').textContent(), '1 construct not in POSIX sh');
    await page.locator('.cm-content').focus();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText('echo hi\n');
    await until('the hint gone', () => hint(page).isVisible(), (v) => !v);
    // (With the hint gone, the strip names no shell.)
    assert.strictEqual(await page.locator('#problems-title').textContent(), 'No problems');
    assert.strictEqual(await page.locator('#problems-said').textContent(), 'No problems');
    await page.context().close();
  });

  for (const lang of ['en', 'ja'] as const) {
    it(`is a line of the strip, never a problem: the counts and the list stay as they were, and "No problems" names bash (${lang})`, async () => {
      const page = await open(desktop(1280, lang), ONLY_SH);
      await hint(page).waitFor({ state: 'visible' });
      const none = lang === 'en' ? 'No problems in bash' : 'bash では問題なし';
      // In place of "No problems": the strip says there is none in bash (not a "No problems" the hint's line would
      // contradict: #746), the fold has nothing to open, and the hint is the line after it.
      assert.strictEqual(await page.locator('#problems-title').textContent(), none);
      assert.strictEqual(await page.locator('#problems-said').textContent(), none);
      assert.strictEqual(await page.locator('#problems-toggle').isDisabled(), true);
      assert.strictEqual(await page.locator('#problems-counts .count').count(), 0);
      assert.strictEqual(await problemRows(page).count(), 0);
      const n = shIssues(ONLY_SH);
      assert.strictEqual(await page.locator('#sh-hint-text').textContent(), lang === 'en' ? `${n} constructs not in POSIX sh` : `POSIX sh にない書き方が ${n} 件`);
      assert.strictEqual(await page.locator('#sh-hint-button').textContent(), lang === 'en' ? 'Switch to POSIX sh' : 'POSIX sh に切り替え');
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

  it('has a button that switches the shell to POSIX sh, as the chip does, and the list then has the sh problems', async () => {
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

  /** Whether two boxes overlap. */
  const overlap = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

  for (const [width, lang] of [390, 1280].flatMap((w) => (['en', 'ja'] as const).map((l) => [w, l] as const))) {
    it(`says that the button switched the shell (#746): the chip shows it and lights up, a toast with Undo sets back Auto (${width} px, ${lang})`, async () => {
      const page = await open(desktop(width, lang), ONLY_SH);
      await hint(page).waitFor({ state: 'visible' });
      const chip = page.locator('#scope-chip');
      const before = (await chip.boundingBox())!;
      await page.locator('#sh-hint-button').click();
      assert.strictEqual(await currentShell(page), 'sh');
      // The chip says the shell chosen, lit for a moment; its box keeps its place and its height (only its words changed).
      assert.match((await page.locator('#scope-chip-text').textContent()) ?? '', /POSIX sh$/);
      assert.strictEqual(await chip.evaluate((e) => e.classList.contains('lit')), true);
      const after = (await chip.boundingBox())!;
      assert.ok(Math.abs(after.y - before.y) < 0.5 && Math.abs(after.height - before.height) < 0.5, JSON.stringify([before, after]));
      // The toast says what the button did; only its words are the live region, the Undo is a button beside it.
      const said = lang === 'en' ? 'Shell set to POSIX sh.' : 'シェルを POSIX sh にしました。';
      const undoWord = lang === 'en' ? 'Undo' : '元に戻す';
      await until('the toast', () => toastText(page), (t) => t === said);
      assert.strictEqual(await page.locator('#status').ariaSnapshot(), `- status: ${said}\n- button "${undoWord}"`);
      const undo = page.locator('#status .status-action');
      assert.strictEqual(await undo.isEnabled(), true);
      // The focus stayed in the strip, and the toast is not over it (WCAG 2.2, 2.4.11), nor over the chip.
      const focused = await page.evaluate('(() => { const r = document.activeElement.getBoundingClientRect(); return { id: document.activeElement.id, x: r.x, y: r.y, width: r.width, height: r.height }; })()') as { id: string; x: number; y: number; width: number; height: number };
      assert.strictEqual(focused.id, 'problems-toggle');
      const toastBox = (await page.locator('#status').boundingBox())!;
      assert.ok(!overlap(toastBox, focused) && !overlap(toastBox, after), JSON.stringify([toastBox, focused, after]));
      // Undo from the keyboard: Auto again, the hint back with "No problems in bash", the toast gone, and the focus on the page's editor, not on <body>.
      await undo.focus();
      await page.keyboard.press('Enter');
      await until('Auto', () => currentShell(page), (v) => v === 'auto');
      await until('the toast gone', () => toastText(page), (t) => t === '');
      assert.strictEqual(await page.evaluate("document.activeElement.closest('.cm-editor') !== null"), true, String(await page.evaluate('document.activeElement.tagName')));
      await hint(page).waitFor({ state: 'visible' });
      assert.strictEqual(await page.locator('#problems-title').textContent(), lang === 'en' ? 'No problems in bash' : 'bash では問題なし');
      await page.context().close();
    });
  }

  it('takes the toast\'s Undo away when the shell is chosen again in the chip: it would undo that choice', async () => {
    const page = await open(desktop(1280, 'en'), ONLY_SH);
    await hint(page).waitFor({ state: 'visible' });
    await page.locator('#sh-hint-button').click();
    await until('the toast', () => toastText(page), (t) => t === 'Shell set to POSIX sh.');
    await setShell(page, 'zsh');
    await until('the toast gone', () => toastText(page), (t) => t === '');
    assert.strictEqual(await page.locator('#status .status-action').count(), 0);
    assert.strictEqual(await currentShell(page), 'zsh');
    await page.context().close();
  });

  /**
   * The chip's words, its edge (its ::before's on a narrow page, which draws the pill there) and the fills under them:
   * its ancestors' (the header around it), then its own and its ::before's (none beside the editor).
   */
  const chipColours = (page: Page, narrow: boolean) => page.evaluate(`(() => {
    const el = document.getElementById('scope-chip');
    const before = getComputedStyle(el, '::before');
    const around = [];
    for (let e = el.parentElement; e; e = e.parentElement) around.push(getComputedStyle(e).backgroundColor);
    return { fg: getComputedStyle(el).color, edge: (${narrow} ? before : getComputedStyle(el)).borderTopColor, around: around.reverse(), own: [getComputedStyle(el).backgroundColor, before.backgroundColor] };
  })()`) as Promise<{ fg: string; edge: string; around: string[]; own: string[] }>;

  for (const width of [390, 1280]) {
    it(`lights the chip up with an edge of 3:1 and words of 4.5:1, light and dark (${width} px)`, async () => {
      for (const colorScheme of ['light', 'dark'] as const) {
        const page = await open({ ...desktop(width, 'en'), colorScheme }, ONLY_SH);
        await hint(page).waitFor({ state: 'visible' });
        await page.locator('#sh-hint-button').click();
        // (Held at its start, where the accent is full, to measure it.)
        await page.evaluate(`document.getAnimations().forEach((a) => { if (a.animationName === 'scope-lit') { a.pause(); a.currentTime = 0; } })`);
        await page.evaluate(FRAMES);
        const narrow = await page.evaluate('document.documentElement.classList.contains("narrow")') as boolean;
        const colours = await chipColours(page, narrow);
        const { fg, edge } = colours;
        // (The header's own colour, then the chip's fill over it.)
        let around: RGB = [255, 255, 255];
        for (const b of colours.around) around = parseColour(b, around) ?? around;
        let fill = around;
        for (const b of colours.own) fill = parseColour(b, fill) ?? fill;
        const lit = parseColour(edge, around)!;
        assert.ok(contrast(lit, around) >= 3, `${colorScheme}: edge ${edge} on ${JSON.stringify(around)}: ${contrast(lit, around).toFixed(2)}`);
        assert.ok(contrast(parseColour(fg, fill)!, fill) >= 4.5, `${colorScheme}: words ${fg} on ${JSON.stringify(fill)}`);
        // (The fill is lit too, not only the edge.)
        assert.notDeepStrictEqual(fill, around, colorScheme);
        await page.context().close();
      }
    });
  }

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
    // The first line is a comment, not a shebang: the hint comes, under the list.
    await page.locator('.cm-content').focus();
    await page.keyboard.press('Control+Home');
    await page.keyboard.press('Shift+End');
    await page.keyboard.insertText('# no shebang');
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

  it('says that a script this large is not counted, with the same button', async () => {
    for (const lang of ['en', 'ja'] as const) {
      const page = await open(desktop(1280, lang), LARGE);
      await hint(page).waitFor({ state: 'visible' });
      assert.strictEqual(await page.locator('#sh-hint-text').textContent(), lang === 'en' ? 'POSIX sh: not checked in a script this large' : 'POSIX sh：大きなスクリプトでは確認しない');
      assert.strictEqual(await page.locator('#sh-hint-button').textContent(), lang === 'en' ? 'Switch to POSIX sh' : 'POSIX sh に切り替え');
      await page.locator('#sh-hint-button').click();
      await until('the shell', () => currentShell(page), (s) => s === 'sh');
      await page.context().close();
    }
  });

  for (const [width, lang, script] of [390, 1280].flatMap((w) => (['en', 'ja'] as const).flatMap((l) => [[w, l, BOTH], [w, l, LARGE]] as const))) {
    it(`lays out inside the pane without overflow or overlap: ${width} px, ${lang}${script === LARGE ? ', a script too large to count' : ''}`, async () => {
      const page = await open(desktop(width, lang), script);
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
      // The tab counts the problems of bash alone (nothing, or one caveat), as before.
      const said = await page.locator('#tab-problems').getAttribute('aria-label');
      assert.ok(text === ONLY_SH ? !/\d/.test(said ?? '') : /1/.test(said ?? ''), said ?? '');
      const [pane, line, button] = await Promise.all(['#panel-pane', '#problems-sh', '#sh-hint-button'].map((s) => page.locator(s).boundingBox()));
      assert.ok(line!.x >= pane!.x - 0.5 && line!.x + line!.width <= pane!.x + pane!.width + 0.5, JSON.stringify([pane, line]));
      assert.ok(line!.y + line!.height <= pane!.y + pane!.height + 0.5 && button!.height >= 44 - 0.5, JSON.stringify([pane, line, button]));
      assert.strictEqual(await page.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), true);
      await page.context().close();
    }
  });
});
