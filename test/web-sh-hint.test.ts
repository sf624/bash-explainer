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
    await page.locator('.cm-content').focus();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText(text);
    // (The page starts with the sample, which has many problems and a hint of its own: the text is checked once few are left.)
    await until('the text checked', () => problemRows(page).count(), (c) => c <= 10, 15000);
    return page;
  }

  const desktop = (width: number, lang: 'en' | 'ja'): BrowserContextOptions => ({ viewport: { width, height: 800 }, locale: lang === 'ja' ? 'ja-JP' : 'en-US' });
  const hint = (page: Page) => page.locator('#problems-sh');

  it('shows for #!/usr/bin/env bash and for no shebang, with the count of the dialect issues for sh, and for no other shebang', async () => {
    const want = (text: string) => `${shIssues(text)} problems in POSIX sh`;
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
        await page.waitForTimeout(300);
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
    await page.waitForTimeout(300);
    assert.strictEqual(await hint(page).isVisible(), false);
    await page.context().close();
  });

  it('says one problem in the singular, and nothing for a script POSIX sh reads without a problem', async () => {
    const one = '#!/usr/bin/env bash\n[[ -f a ]]\n';
    assert.strictEqual(shIssues(one), 1);
    const page = await open(desktop(1280, 'en'), one);
    await hint(page).waitFor({ state: 'visible' });
    assert.strictEqual(await page.locator('#sh-hint-text').textContent(), '1 problem in POSIX sh');
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
      assert.strictEqual(await page.locator('#sh-hint-text').textContent(), lang === 'en' ? `${n} problems in POSIX sh` : `POSIX sh では ${n} 件の問題`);
      assert.strictEqual(await page.locator('#sh-hint-button').textContent(), lang === 'en' ? 'Check as POSIX sh' : 'POSIX sh 向けとして確認');
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
      assert.strictEqual(await page.locator('#sh-hint-text').textContent(), lang === 'en' ? `${shIssues(BOTH)} problems in POSIX sh` : `POSIX sh では ${shIssues(BOTH)} 件の問題`);
      const [list, after] = await Promise.all(['#problem-list', '#problems-sh'].map((s) => page.locator(s).boundingBox()));
      assert.ok(after!.y >= list!.y + list!.height - 0.5, JSON.stringify([list, after]));
      // Folded, the list goes and the hint stays.
      await page.locator('#problems-toggle').click();
      assert.strictEqual(await page.locator('#problem-list').isVisible(), (await page.locator('#problems-toggle').getAttribute('aria-expanded')) === 'true');
      assert.strictEqual(await hint(page).isVisible(), true);
      await page.context().close();
    });
  }

  it('has a button that reads the script as POSIX sh, as the chip does, and the strip then lists the problems the hint counted', async () => {
    const page = await open(desktop(1280, 'en'), BOTH);
    await hint(page).waitFor({ state: 'visible' });
    assert.strictEqual(await currentShell(page), 'auto');
    // (Bash's own problem: `local` outside a function.)
    await until('bash\'s problem', () => problemRows(page).count(), (c) => c === 1);
    await page.locator('#sh-hint-button').click();
    assert.strictEqual(await currentShell(page), 'sh');
    await until('the hint gone', () => hint(page).isVisible(), (v) => !v);
    // The list holds the problems of bash that sh keeps, with the ones the hint counted.
    const rows = problemRows(page);
    await until('the sh problems', () => rows.count(), (c) => c === 1 + shIssues(BOTH));
    // The focus stayed in the strip, on the fold, not on the page.
    await until('the focus', () => page.evaluate('document.activeElement && document.activeElement.id'), (id) => id === 'problems-toggle');
    // Back to Auto (the chip's popover): the hint is back.
    await page.locator('#scope-chip').click();
    await page.locator('#scope-shell-auto').click();
    await hint(page).waitFor({ state: 'visible' });
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
