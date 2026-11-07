// One view with a depth (docs/design/panel-redesign.md, P8), in the web page and in the panel's page, with CI's fonts: the depth is chosen in
// the view slot or with the keys 1 and 2 when the focus is in the panel, kept for the next visit (a view kept before the depths opens at the
// depth it has become). A deeper depth only adds: the rows of depth 1 stay, in order, saying the same; each row of depth 2 has one role line
// at one place; a pipe is a connector of one line; a word's steps fold where no step acts, with `panel.animations`; the page has a length budget.
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import type { Browser, Frame, Page } from 'playwright-core';
import { servePanel, type PanelServer } from './support/panel-page';
import { chooseDepth, openSettingsSection, openSite, until } from './support/site';

/** The four test scripts of the panel redesign (panel-redesign.md, section 2), and the line each shows. */
const SCRIPTS = {
  s1: ['for f in *.txt; do\n  wc -l "$f"\ndone', 1],
  's1-body': ['for f in *.txt; do\n  wc -l "$f"\ndone', 2],
  s2: ['grep -h "$USER" /var/log/*.log | sort | uniq -c | sort -rn | head -5', 1],
  's3-assign': ['backup="${HOME}/backup-$(date +%F).tar.gz"\ntar -czf "$backup" ~/docs 2>/dev/null || echo "failed" >&2', 1],
  s3: ['backup="${HOME}/backup-$(date +%F).tar.gz"\ntar -czf "$backup" ~/docs 2>/dev/null || echo "failed" >&2', 2],
  s4: ['if [[ -f config.ini && $DEBUG == 1 ]]; then source config.ini; fi', 1],
} as const;

/**
 * The longest a page may be at depth 2, in px, by the page's width. The plan proposed 750 and 1,500, half the prototype's; what each row must
 * hold leaves more: panel-redesign.md, "The length budget". These are what the folds and the closer rows reach, with room for a font's width: with
 * the switch "What the program receives" on (its row, and a line under each command: 1,380 and 1,921) and off (its row: 1,244 and 1,771).
 * The maintainer accepted this budget on 2026-11-05, after a check on a real device; the usability test judges the length again.
 * The fix out of "More", as the whole line (docs/design/usability-9.md, U1), added up to 59 px on the lines with a fix (s2, s3):
 * in CI, 1,485 and 2,054 on, 1,324 and 1,898 off, with about the same room as before over them.
 * U5 (usability-9.md, Q4) gave each script its budget, the room over CI's figures as before (about 55 px over these, measured with CI's fonts,
 * the larger of en and ja). On s2 the glob example opens on grep's stage, where its cursor is, with its names to try and its results, and the
 * row of its word no longer folds: 1,474 to 1,895 and 2,039 to 2,536 on, 1,313 to 1,734 and 1,878 to 2,376 off. On s4, `$DEBUG` has a row at
 * depth 1 for bash's steps, so the condition of `[[` no longer folds at depth 2: 1,279 to 1,482 and 1,812 to 2,092 on, 1,255 to 1,457 and
 * 1,758 to 2,038 off. The others do not change.
 * U7 (usability-9.md, 2.7) measured them again, with CI's fonts: at depth 2 the stages of s2 the cursor is not on fold to their own row, and
 * "In short" leaves out the parenthetical parts of the summaries. s2: 1,706 and 2,250 on, 1,545 and 2,089 off (the larger of en and ja); s4:
 * 1,462 and 2,072 on, 1,438 and 2,019 off; s3 1,365 and 1,794 on. The budgets of s2 and s4 come down by as much, with the same room over
 * them. s2 stays above the 1,420 px of 2026-11-05, by about the glob example U5 opens on grep's stage: the maintainer accepted it on
 * 2026-11-07, to be judged in the usability re-test (U9).
 * No script here holds a `[`: its condition has rows of its own at depth 2 (its pages are measured in the PR that gave them).
 */
const BUDGET: Record<keyof typeof SCRIPTS, Record<'on' | 'off', Record<1280 | 390, number>>> = {
  s1: { on: { 1280: 840, 390: 1070 }, off: { 1280: 840, 390: 1060 } },
  's1-body': { on: { 1280: 450, 390: 530 }, off: { 1280: 430, 390: 510 } },
  s2: { on: { 1280: 1760, 390: 2310 }, off: { 1280: 1600, 390: 2150 } },
  's3-assign': { on: { 1280: 1010, 390: 1270 }, off: { 1280: 990, 390: 1250 } },
  s3: { on: { 1280: 1420, 390: 1850 }, off: { 1280: 1350, 390: 1780 } },
  s4: { on: { 1280: 1520, 390: 2130 }, off: { 1280: 1500, 390: 2075 } },
};

/**
 * In the panel's page: the updates it gets come `window.slowUpdates` ms late, as on a slow phone (its message listeners are wrapped
 * before media/panel.js adds its own).
 */
const SLOW_UPDATES = `if (location.pathname.endsWith('/panel.html')) {
  const add = window.addEventListener;
  window.addEventListener = function (type, fn, options) {
    if (type !== 'message') return add.call(this, type, fn, options);
    return add.call(this, type, (e) => (window.slowUpdates && e.data && e.data.type === 'update' ? setTimeout(() => fn(e), window.slowUpdates) : fn(e)), options);
  };
}`;

describe('the panel: one view with a depth', function () {
  this.timeout(240000);
  let browser: Browser;
  let base = '';
  let server: PanelServer;

  before(async function () {
    ({ browser, base } = await openSite(this));
    server = await servePanel('grep -h "$USER" /var/log/*.log | sort | uniq -c | sort -rn | head -5', 'p.sh');
  });
  after(async () => {
    await server?.close();
  });

  /** A context in a language, with the panel's rows drawn at once where `animations` is false. */
  async function context(width: number, lang: 'en' | 'ja', options: { animations?: boolean; kept?: unknown } = {}) {
    const ctx = await browser.newContext({ locale: lang === 'ja' ? 'ja-JP' : 'en-US', viewport: { width, height: 800 } });
    if (options.animations === false) await ctx.addInitScript(`try { localStorage.setItem('bash-explainer-settings', JSON.stringify({ 'bashExplainer.panel.animations': false })); } catch {}`);
    if (options.kept) await ctx.addInitScript(`try { if (!sessionStorage.getItem('kept')) { sessionStorage.setItem('kept', '1'); localStorage.setItem('bash-explainer-panel', ${JSON.stringify(JSON.stringify(options.kept))}); } } catch {}`);
    return ctx;
  }
  const panelOf = (page: Page): Frame => page.frames().find((f) => f.url().endsWith('/panel.html'))!;
  /** Opens the page and types `text`, the cursor on its `line`th line. */
  async function open(page: Page, text: string, line = 1): Promise<Frame> {
    await page.goto(base);
    await until('the panel', () => Promise.resolve(panelOf(page)), (f) => !!f);
    await page.locator('.cm-content').focus();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText(text);
    // (On a phone a long line wraps: one press of an arrow is one row of the screen.)
    const shown = text.split('\n')[line - 1].trim().slice(0, 8);
    await page.keyboard.press('Control+Home');
    for (let i = 0; i < 12 && line > 1 && !(await panelOf(page).locator('#line').textContent())?.includes(shown); i++) {
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(120);
    }
    await until('the line explained', async () => (await panelOf(page).locator('#line').textContent()) ?? '', (t) => t.includes(shown));
    return panelOf(page);
  }
  /** Marks the rows drawn now, for `redrawn`. */
  const markRows = (panel: Frame) => panel.evaluate(`document.querySelectorAll('#tree > li').forEach((li) => { li.dataset.old = '1'; })`);
  /** Until the panel has drawn its rows again, since `markRows`. */
  const redrawn = (panel: Frame) => until('the rows drawn again', () => panel.evaluate(`!!document.querySelector('#tree > li') && !document.querySelector('#tree > li[data-old]')`) as Promise<boolean>, (v) => v);
  const depthDrawn = (panel: Frame, depth: number) => until(`the rows of depth ${depth}`, () => panel.evaluate('document.body.dataset.depth'), (d) => d === String(depth));
  /** The rows as drawn: key, code and text (its own and what it says more), without the role lines and the steps. */
  const rows = (panel: Frame) => panel.evaluate(`[...document.querySelectorAll('#tree li[data-key]')].map((li) => {
    const row = li.querySelector(':scope > .item > .row');
    const text = row.querySelector(':scope > .text').cloneNode(true);
    text.querySelectorAll('.role-line, .steps, .row-more, .refs, .problem-chip').forEach((e) => e.remove());
    return { key: li.dataset.key, code: row.querySelector(':scope > .code .label').textContent, text: text.textContent.trim() };
  })`) as Promise<{ key: string; code: string; text: string }[]>;

  it('chooses the depth in the slot and with the keys 1 and 2, keeps it, and a view kept before the depths opens at the depth it has become', async () => {
    const ctx = await context(1280, 'en', { animations: false });
    const page = await ctx.newPage();
    const panel = await open(page, SCRIPTS.s2[0]);
    assert.strictEqual(await page.locator('#slot-depth1').getAttribute('aria-pressed'), 'true');
    assert.strictEqual(await panel.locator('.role-line').count(), 0, 'depth 1 has no role line');
    // No view switch is left in the page: the slot holds the one control.
    assert.strictEqual(await page.locator('#view-switch, [data-view-switch], #views-list').count(), 0);
    assert.strictEqual(await page.locator('#view-slot').count(), 1);
    await chooseDepth(page, 2);
    await depthDrawn(panel, 2);
    assert.ok(await panel.locator('.role-line').count() > 5);
    // The keys, when the focus is in the panel; not while a text is typed.
    await panel.locator('#main').evaluate((e) => { e.tabIndex = -1; e.focus(); });
    await panel.locator('#main').press('1');
    await depthDrawn(panel, 1);
    assert.strictEqual(await page.locator('#slot-depth1').getAttribute('aria-pressed'), 'true', 'the slot follows the key');
    await panel.locator('#main').press('2');
    await depthDrawn(panel, 2);
    await panel.locator('#ref').evaluate((b) => (b as unknown as { click(): void }).click());
    await panel.locator('#ref-search').press('1');
    assert.strictEqual(await panel.evaluate('document.body.dataset.depth'), '2', 'typing in a box chooses nothing');
    assert.strictEqual(await panel.locator('#ref-search').inputValue(), '1');
    await panel.locator('#ref').evaluate((b) => (b as unknown as { click(): void }).click());
    // The editor keeps its keys: the page binds none of them.
    await page.locator('.cm-content').focus();
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText(' 1');
    assert.strictEqual(await panel.evaluate('document.body.dataset.depth'), '2');
    assert.ok((await page.locator('.cm-content').textContent())!.endsWith(' 1'));
    // Kept for the next visit.
    await page.reload();
    await until('the panel', () => Promise.resolve(panelOf(page)), (f) => !!f);
    await depthDrawn(panelOf(page), 2);
    await ctx.close();
    // A view kept by a version before the depths.
    for (const [kept, depth] of [[{ view: 'tree', step: 5, level: 1 }, 2], [{ view: 'list', step: 8 }, 1]] as const) {
      const old = await context(1280, 'en', { animations: false, kept });
      const p = await old.newPage();
      const f = await open(p, 'ls -l');
      await depthDrawn(f, depth);
      assert.strictEqual(await p.locator(`#slot-depth${depth}`).getAttribute('aria-pressed'), 'true');
      await old.close();
    }
  });

  it('"Clear stored data" puts the depth and the switch back at once, with nothing kept again (no reload)', async () => {
    const ctx = await context(1280, 'en', { animations: false });
    const page = await ctx.newPage();
    const panel = await open(page, SCRIPTS.s2[0]);
    const key = () => page.evaluate(`localStorage.getItem('bash-explainer-panel')`);
    await chooseDepth(page, 2);
    await depthDrawn(panel, 2);
    await panel.locator('#receives').click();
    await until('the switch off', () => panel.locator('#tree .receives').count(), (n) => n === 0);
    assert.notStrictEqual(await key(), null);
    // A setting of the dialog that is kept apart from the settings: the VS Code setting names.
    await page.locator('#settings-open').click();
    await page.locator('#settings-show-keys').check();
    await openSettingsSection(page, 'data');
    await page.locator('#settings-clear').click();
    await page.locator('#settings-clear-yes').click();
    assert.match(await page.locator('#settings-clear-status').innerText(), /Cleared/);
    await depthDrawn(panel, 1);
    assert.strictEqual(await page.locator('#slot-depth1').getAttribute('aria-pressed'), 'true');
    assert.strictEqual(await panel.locator('#receives').getAttribute('aria-checked'), 'true');
    await until('the lines received', () => panel.locator('#tree .receives').count(), (n) => n > 0);
    assert.strictEqual(await panel.locator('.role-line').count(), 0);
    assert.strictEqual(await page.locator('#settings-show-keys').isChecked(), false);
    // Not written again by the reset, and still after the panel has had time to answer.
    await page.waitForTimeout(1500);
    assert.strictEqual(await key(), null);
    assert.deepStrictEqual(await page.evaluate('Object.keys(localStorage).filter((k) => k !== "bash-explainer-settings" && k !== "bash-explainer-sheet-hint")'), []);
    await ctx.close();
  });

  it('names the keys in the panel in the page\'s Help', async () => {
    const ctx = await context(1280, 'en');
    const page = await ctx.newPage();
    await open(page, 'ls');
    await page.locator('#menu-open').click();
    assert.match(await page.locator('#menu-keys').textContent() ?? '', /1, 2.*depth.*in the panel/i);
    await ctx.close();
  });

  for (const [width, lang] of [[1280, 'en'], [640, 'ja'], [390, 'ja'], [390, 'en']] as const) {
    it(`only adds: the rows of depth 1 stay in order, saying the same, ${width} px, ${lang}`, async () => {
      const ctx = await context(width, lang, { animations: false });
      const page = await ctx.newPage();
      for (const [text, line] of Object.values(SCRIPTS)) {
        const panel = await open(page, text, line);
        await chooseDepth(page, 1);
        await depthDrawn(panel, 1);
        const one = await rows(panel);
        await chooseDepth(page, 2);
        await depthDrawn(panel, 2);
        const two = await rows(panel);
        const keys = two.map((r) => r.key);
        assert.deepStrictEqual(one.map((r) => r.key), keys.filter((k) => one.some((r) => r.key === k)), `${text}: the order`);
        for (const r of one) {
          const deep = two.find((d) => d.key === r.key)!;
          assert.deepStrictEqual([deep.code, deep.text], [r.code, r.text], `${text}: ${r.key}`);
        }
        assert.ok(two.length > one.length, `${text}: depth 2 adds`);
      }
      await ctx.close();
    });
  }

  for (const [width, lang, theme] of [[1280, 'en', 'dark'], [1280, 'ja', 'light'], [640, 'en', 'light'], [640, 'ja', 'dark'], [390, 'en', 'dark'], [390, 'ja', 'light']] as const) {
    it(`draws one role line at one place on each row, a pipe on one line, nothing sticking out, ${width} px, ${lang}, ${theme}`, async () => {
      const ctx = await browser.newContext({ locale: lang === 'ja' ? 'ja-JP' : 'en-US', viewport: { width, height: 800 }, colorScheme: theme });
      await ctx.addInitScript(`try { localStorage.setItem('bash-explainer-settings', JSON.stringify({ 'bashExplainer.panel.animations': false })); localStorage.setItem('bash-explainer-panel', '{"depth":2}'); } catch {}`);
      const page = await ctx.newPage();
      const panel = await open(page, SCRIPTS.s2[0]);
      await depthDrawn(panel, 2);
      // (The cursor on the last stage: the glob example of grep's stage is closed, and its row folded. On grep's, it opens with the row,
      // whose pieces of a word have no role line.)
      await page.locator('.cm-content').focus();
      await page.keyboard.press('Control+End');
      // (The rows start again at the other depth and back, the cursor on the last stage: every stage folded, grep's with its glob's row
      // and example (usability-9.md, 2.7). The move alone closes nothing: the panel only opens what the model or the reader opens.)
      await chooseDepth(page, 1);
      await depthDrawn(panel, 1);
      await chooseDepth(page, 2);
      await depthDrawn(panel, 2);
      await until('the glob example closed', () => panel.evaluate(`[...document.querySelectorAll('#tree details.example')].map((d) => d.open).join()`), (o) => o === 'false');
      // (The other depth and back once more draws the same.)
      const folded = () => panel.evaluate(`[...document.querySelectorAll('#tree li.collapsed > .item > .row .label')].map((l) => l.textContent)`);
      const all = ['grep', '/var/log/*.log', 'uniq', 'sort', 'head'];
      await until('every stage folded', folded, (f) => JSON.stringify(f) === JSON.stringify(all));
      await chooseDepth(page, 1);
      await depthDrawn(panel, 1);
      await chooseDepth(page, 2);
      await depthDrawn(panel, 2);
      await until('the rows started again', folded, (f) => JSON.stringify(f) === JSON.stringify(all));
      // (Every stage opened by its fold button, so that the role line of each part is measured; the glob's row stays folded: its pieces
      // of a word have no role line.)
      for (const name of ['grep', 'uniq', 'sort', 'head']) {
        await panel.locator('#tree li.collapsed', { has: panel.locator(':scope > .item > .row > .code .label', { hasText: new RegExp('^' + name + '$') }) }).locator(':scope > .item > .row > button.twisty').click();
      }
      await until('every stage open', folded, (f) => JSON.stringify(f) === JSON.stringify(['/var/log/*.log']));
      const got = await panel.evaluate(`(() => {
        const rows = [...document.querySelectorAll('#tree .row')].filter((r) => r.getClientRects().length);
        const lines = rows.map((r) => [...r.querySelectorAll(':scope > .text > .role-line')]);
        const lefts = rows.filter((r) => !r.classList.contains('connector')).map((r) => {
          const code = r.querySelector(':scope > .code').getBoundingClientRect(), text = r.querySelector(':scope > .text').getBoundingClientRect();
          // (Under its code, on a phone or under a long code; else in the text column.)
          return text.top >= code.bottom - 1 ? null : Math.round(r.querySelector(':scope > .text > .role-line').getBoundingClientRect().left);
        }).filter((x) => x !== null);
        const pipes = [...document.querySelectorAll('#tree .row.connector')];
        const sticking = rows.filter((r) => [...r.querySelectorAll('.code, .text, .role-line, .steps')].some((c) => c.getBoundingClientRect().right > r.getBoundingClientRect().right + 0.5)).map((r) => r.textContent.slice(0, 30));
        return {
          everyRowOne: lines.every((l) => l.length === 1), lefts: [...new Set(lefts)], over: document.documentElement.scrollWidth - document.documentElement.clientWidth, sticking,
          pipes: pipes.map((p) => p.querySelector('.text').textContent), pipeHeights: pipes.map((p) => p.getBoundingClientRect().height), line: parseFloat(getComputedStyle(pipes[0]).lineHeight),
          folded: [...document.querySelectorAll('#tree li.collapsed > .item > .row .label')].map((l) => l.textContent),
        };
      })()`) as { everyRowOne: boolean; lefts: number[]; over: number; sticking: string[]; pipes: string[]; pipeHeights: number[]; line: number; folded: string[] };
      assert.ok(got.everyRowOne, 'one role line on each row');
      assert.ok(got.lefts.length <= 1, `one place: ${got.lefts}`);
      assert.strictEqual(got.over, 0);
      assert.deepStrictEqual(got.sticking, []);
      assert.strictEqual(got.pipes.length, 4);
      assert.match(got.pipes[0], lang === 'en' ? /stdout of grep → stdin of sort/ : /grep の標準出力 → sort の標準入力/);
      // (Its sign and its text on one line; its role beside them, or a line more on a phone.)
      for (const h of got.pipeHeights) assert.ok(h <= 2 * got.line + 4, `the pipe: ${h} px, a line ${got.line} px`);
      // (A row whose parts all come at depth 2 starts folded: the glob's, still so once the stages are open.)
      assert.deepStrictEqual(got.folded, ['/var/log/*.log']);
      const dir = process.env.BASH_EXPLAINER_SHOTS;
      if (dir) await page.screenshot({ path: path.join(dir, `depth2-${width}-${lang}-${theme}.png`), fullPage: true });
      await ctx.close();
    });
  }

  for (const animations of [true, false]) {
    it(`folds a word's steps where no step acts, and opens them ${animations ? 'with' : 'without'} motion (\`panel.animations\`)`, async () => {
      const ctx = await context(1280, 'en', { animations });
      const page = await ctx.newPage();
      const panel = await open(page, 'echo "failed" "$a" $((1 + 2))');
      await chooseDepth(page, 2);
      await depthDrawn(panel, 2);
      const lines = await panel.locator('.row:has(.steps) .steps').allTextContents();
      assert.strictEqual(lines.length, 3);
      assert.match(lines[0], /^bash's steps: nothing expands/);
      assert.match(lines[1], /parameter expansion → no word splitting or globbing \(quoted\) → quote removal/);
      assert.match(lines[2], /arithmetic expansion/, 'arithmetic expansion is named');
      const fold = panel.locator('details.steps').first();
      // (A click, then a look at the next frame: the fold's motion runs or it does not.)
      const moved = await panel.evaluate(`new Promise((done) => {
        const d = document.querySelector('details.steps');
        d.querySelector('summary').click();
        requestAnimationFrame(() => done(d.open && document.getAnimations().length > 0));
      })`) as boolean;
      assert.strictEqual(moved, animations, 'the fold moves as the setting says');
      assert.strictEqual(await fold.getAttribute('open'), '');
      await until('the motion over', () => panel.evaluate('document.getAnimations().filter((a) => a.playState === "running").length'), (n) => n === 0);
      assert.match(await fold.textContent() ?? '', /no brace expansion, tilde expansion.*word splitting or globbing → quote removal/);
      await fold.locator('summary').click();
      await until('closed', () => fold.getAttribute('open'), (o) => o === null);
      await ctx.close();
    });
  }

  it('unfolds the parts of a folded row with its twisty, and Expand all opens them all', async () => {
    const ctx = await context(1280, 'en', { animations: false });
    const page = await ctx.newPage();
    const panel = await open(page, 'cat <<EOF 2>/dev/null\nx\nEOF');
    await chooseDepth(page, 2);
    await depthDrawn(panel, 2);
    const redirect = panel.locator('#tree li:has(> .item > .row .label:text-is("2>/dev/null"))');
    assert.strictEqual(await redirect.evaluate((li) => li.classList.contains('collapsed')), true);
    await redirect.locator(':scope > .item > .row > .twisty').click();
    assert.deepStrictEqual(await redirect.locator(':scope > .item > .body .label').allTextContents(), ['2', '>', '/dev/null']);
    // (What was opened stays open when the same line is drawn again, by the row's key: the other depth, and back.)
    await chooseDepth(page, 1);
    await depthDrawn(panel, 1);
    await chooseDepth(page, 2);
    await depthDrawn(panel, 2);
    assert.strictEqual(await redirect.evaluate((li) => li.classList.contains('collapsed')), false);
    await ctx.close();
  });

  it('draws `[` as `test`: one row for the command, with its badge and what it receives, and its arguments one level below, at both depths', async () => {
    const ctx = await context(1280, 'en', { animations: false });
    const page = await ctx.newPage();
    /** The rows of the line: how deep each is, its code, and on a command its badge and the words it receives. */
    const drawn = (panel: Frame) => panel.evaluate(`[...document.querySelectorAll('#tree li[data-key]')].map((li) => {
      let level = 0;
      for (let up = li.parentElement.closest('li[data-key]'); up; up = up.parentElement.closest('li[data-key]')) level++;
      const row = li.querySelector(':scope > .item > .row');
      return {
        level, code: row.querySelector(':scope > .code .label').textContent,
        receives: [...row.querySelectorAll(':scope .receives-words > *')].map((w) => w.textContent.trim()),
        name: !!row.querySelector(':scope .name-line, :scope .name-badge'),
      };
    })`) as Promise<{ level: number; code: string; receives: string[]; name: boolean }[]>;
    for (const depth of [1, 2] as const) {
      const panel = await open(page, '[ -a file ]');
      await chooseDepth(page, depth);
      await depthDrawn(panel, depth);
      const bracket = await drawn(panel);
      const other = await open(page, 'test -a file');
      await depthDrawn(other, depth);
      const test = await drawn(other);
      assert.strictEqual(bracket[0].code, '[', `depth ${depth}`);
      assert.strictEqual(bracket[0].level, 0);
      // (A builtin runs inside the shell: no name among its words, for `[` as for `test`.)
      assert.deepStrictEqual(bracket[0].receives, ['-a', 'file', ']']);
      assert.deepStrictEqual(test[0].receives, ['-a', 'file']);
      assert.strictEqual(bracket[0].name, test[0].name);
      assert.deepStrictEqual(bracket.filter((r) => r.code === ']').map((r) => r.level), [1], 'the row of `]` is under the command');
      assert.deepStrictEqual(bracket.filter((r) => r.code === '[').length, 1, 'no second row of the name');
      assert.deepStrictEqual(bracket.slice(1).filter((r) => r.code !== ']').map((r) => [r.level, r.code]), test.slice(1).map((r) => [r.level, r.code]), `depth ${depth}`);
    }
    // `[[` is syntax: no program, so no words received, with the condition below.
    const syntax = await open(page, '[[ -a file ]]');
    const keyword = await drawn(syntax);
    assert.deepStrictEqual([keyword[0].level, keyword[0].code, keyword[0].receives], [0, '[[ -a file ]]', []]);
    assert.ok(keyword.some((r) => r.level === 1 && r.code === '-a file'), JSON.stringify(keyword));
    await ctx.close();
  });

  it('unfolds the condition of `[`, `test` and `[[` at depth 2 to its operator and its operand, as one', async () => {
    const ctx = await context(1280, 'en', { animations: false });
    const page = await ctx.newPage();
    /** The row of the condition: whether it starts folded, the rows under it once its twisty is pressed, and that they show. */
    const unfolded = async (panel: Frame) => {
      const li = panel.locator('#tree li[data-key]', { has: panel.locator(':scope > .item > .row > .code .label', { hasText: /^-a file$/ }) });
      const under = () => li.locator(':scope > .item > .body > ul > li[data-key]');
      const was = await li.evaluate((e) => e.classList.contains('collapsed'));
      assert.strictEqual(await under().first().isVisible(), false, 'folded at first');
      await li.locator(':scope > .item > .row > button.twisty').click();
      await until('the parts shown', () => under().first().isVisible(), (v) => v);
      const parts = await panel.evaluate(`[...document.querySelectorAll('#tree li[data-key]')].filter((li) => li.querySelector(':scope > .item > .row > .code .label').textContent === '-a file')
        .flatMap((li) => [...li.querySelectorAll(':scope > .item > .body > ul > li[data-key]')].map((e) => {
          const row = e.querySelector(':scope > .item > .row');
          const text = row.querySelector(':scope > .text').cloneNode(true);
          text.querySelectorAll('.role-line, .steps, .row-more, .refs, .problem-chip').forEach((x) => x.remove());
          return [row.querySelector(':scope > .code .label').textContent, text.textContent.trim()];
        }))`) as string[][];
      return { was, parts };
    };
    const expected = { was: true, parts: [['-a', 'exists (same as -e, obsolescent)'], ['file', 'The file -a tests']] };
    for (const src of ['[ -a file ]', 'test -a file', '[[ -a file ]]']) {
      const panel = await open(page, src);
      await chooseDepth(page, 2);
      await depthDrawn(panel, 2);
      assert.deepStrictEqual(await unfolded(panel), expected, src);
    }
    await ctx.close();
  });

  // At depth 2 every stage of a pipeline starts folded whenever the line is drawn anew: another line, a new text of it, another depth.
  // Typing and a paste open nothing, though they leave the cursor at the end. A stage opens when the reader moves the cursor into it with
  // no edit (a click or a tap in the editor, a key), which also drops a fold the viewer chose there; a click on its row opens or folds it.
  // Drawn again with the same line, text and depth, the panel folds or closes nothing (the maintainer's rule of 2026-11-07; usability-9.md, 2.7).
  /** The labels of the rows drawn folded, in order. */
  const foldedRows = (panel: Frame) => panel.evaluate(`[...document.querySelectorAll('#tree li.collapsed > .item > .row .label')].map((l) => l.textContent).join()`) as Promise<string>;
  /** The whole text `name`, as a regular expression. */
  const exactly = (name: string) => new RegExp('^' + name.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&') + '$');
  /** The label of the row `name`. */
  const rowNamed = (panel: Frame, name: string) => panel.locator('#tree li[data-key] > .item > .row > .code .label', { hasText: exactly(name) });
  /** The top of the row `name` on the screen, in whole pixels. */
  const topOf = (panel: Frame, name: string) => rowNamed(panel, name).evaluate((e) => Math.round(e.getBoundingClientRect().top));
  /** The fold button of the row `name`. */
  const foldButton = (panel: Frame, name: string) => panel.locator('#tree li[data-key]', { has: panel.locator(':scope > .item > .row > .code .label', { hasText: exactly(name) }) }).locator(':scope > .item > .row > button.twisty');
  /** Clicks the editor on the first `word` of its first line, as a pointer does: the cursor goes there. */
  async function clickWord(page: Page, word: string): Promise<void> {
    const at = await page.evaluate(`(() => {
      const line = document.querySelector('.cm-content .cm-line');
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
      const at = line.textContent.indexOf(${JSON.stringify(word)});
      let seen = 0;
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (at - seen >= 0 && at - seen < node.data.length) {
          const r = document.createRange();
          r.setStart(node, at - seen);
          r.setEnd(node, at - seen + 1);
          const b = r.getBoundingClientRect();
          return { x: b.right, y: b.top + b.height / 2 };
        }
        seen += node.data.length;
      }
      return null;
    })()`) as { x: number; y: number } | null;
    if (!at) throw new Error(`no ${word} on the first line`);
    await page.mouse.click(at.x, at.y);
  }
  /** Flips the switch of what each command receives, and waits for the rows drawn again: a redraw that does not move the cursor. */
  async function flipReceives(panel: Frame): Promise<void> {
    await markRows(panel);
    await panel.locator('#receives').click();
    await redrawn(panel);
  }

  /** A page at depth 2 with an empty editor, its cursor there. */
  async function emptyAtDepth2(lang: 'en' | 'ja'): Promise<{ page: Page; panel: Frame; close: () => Promise<void> }> {
    const ctx = await context(1280, lang, { animations: false });
    const page = await ctx.newPage();
    const panel = await open(page, 'echo');
    await chooseDepth(page, 2);
    await depthDrawn(panel, 2);
    await page.locator('.cm-content').focus();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    return { page, panel, close: () => ctx.close() };
  }
  const PIPELINE = 'grep -r pattern . | sort -r | uniq -c';
  /** The number of examples drawn in the stage `name`'s row (none where it is folded). */
  const examplesShown = (panel: Frame, name: string) => panel.evaluate(`(() => {
    const li = [...document.querySelectorAll('#tree li[data-key]')].find((l) => l.querySelector(':scope > .item > .row .label').textContent === ${JSON.stringify(name)});
    return [...li.querySelectorAll('.example')].filter((e) => e.getClientRects().length).length;
  })()`) as Promise<number>;

  it('starts every stage of a pipeline folded at depth 2 when the line is pasted, or typed in parts: the cursor left at its end opens nothing (usability-9.md, 2.7)', async () => {
    // (The maintainer's check on a phone, 2026-11-07: after a paste, uniq's stage was open, only because the paste leaves the cursor there.)
    const { page, panel, close } = await emptyAtDepth2('ja');
    await page.keyboard.insertText(PIPELINE);
    await until('every stage folded', () => foldedRows(panel), (f) => f === 'grep,sort,uniq');
    await page.waitForTimeout(400);
    assert.deepStrictEqual([await foldedRows(panel), await examplesShown(panel, 'grep')], ['grep,sort,uniq', 0]);
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    for (const part of ['grep -r pattern .', ' | sort -r', ' | uniq -c']) {
      await page.keyboard.type(part, { delay: 20 });
      await page.waitForTimeout(400);
    }
    await until('every stage folded', () => foldedRows(panel), (f) => f === 'grep,sort,uniq');
    await page.waitForTimeout(300);
    assert.strictEqual(await foldedRows(panel), 'grep,sort,uniq');
    await close();
  });

  it('opens a stage at depth 2 when the reader moves the cursor into it, by a click or a key, and folds nothing as the cursor moves on (usability-9.md, 2.7)', async () => {
    const { page, panel, close } = await emptyAtDepth2('en');
    await page.keyboard.insertText(PIPELINE);
    await until('every stage folded', () => foldedRows(panel), (f) => f === 'grep,sort,uniq');
    // (A click on `sort` in the editor: its stage opens, and nothing else.)
    await clickWord(page, 'sort');
    await until('sort open', () => foldedRows(panel), (f) => f === 'grep,uniq');
    await page.waitForTimeout(300);
    assert.strictEqual(await foldedRows(panel), 'grep,uniq');
    // (A key moves the cursor into grep's stage: it opens, and sort's, which the cursor left, stays open.)
    await page.keyboard.press('Home');
    await until('grep open', () => foldedRows(panel), (f) => f === 'uniq');
    await page.keyboard.press('End');
    await until('uniq open', () => foldedRows(panel), (f) => f === '');
    await page.keyboard.press('Home');
    await page.waitForTimeout(300);
    assert.strictEqual(await foldedRows(panel), '');
    await close();
  });

  it('opens again at depth 2 a stage the viewer folded with ▸ when the reader clicks into it in the editor; ▸ and its redraw fold only that stage (usability-9.md, 2.7)', async () => {
    const { page, panel, close } = await emptyAtDepth2('en');
    await page.keyboard.insertText(PIPELINE);
    await until('every stage folded', () => foldedRows(panel), (f) => f === 'grep,sort,uniq');
    await clickWord(page, 'grep');
    await until('grep open', () => foldedRows(panel), (f) => f === 'sort,uniq');
    // (▸ folds grep, and selects its range in the editor: that is no move of the reader's, and grep stays folded.)
    await foldButton(panel, 'grep').click();
    await page.waitForTimeout(400);
    assert.strictEqual(await foldedRows(panel), 'grep,sort,uniq');
    // (A click on `sort` opens it, grep stays folded; a click on `grep` opens it again.)
    await clickWord(page, 'sort');
    await until('sort open', () => foldedRows(panel), (f) => f === 'grep,uniq');
    await clickWord(page, 'grep');
    await until('grep open again', () => foldedRows(panel), (f) => f === 'uniq');
    await close();
  });

  it('opens again at depth 2 a stage the viewer folded with ▸ when the reader taps it in the editor where the cursor is in it already (usability-9.md, 2.7)', async () => {
    // (The maintainer's complaint: tap `grep`, ▸ on grep, tap `grep` again: it stayed folded, as the cursor had not left it. A pointer's
    // move drops the fold of the stage it lands in; a key's, only of a stage it enters, as the test below keeps.)
    const { page, panel, close } = await emptyAtDepth2('en');
    await page.keyboard.insertText(PIPELINE);
    await until('every stage folded', () => foldedRows(panel), (f) => f === 'grep,sort,uniq');
    await clickWord(page, 'grep');
    await until('grep open', () => foldedRows(panel), (f) => f === 'sort,uniq');
    await foldButton(panel, 'grep').click();
    await until('grep folded', () => foldedRows(panel), (f) => f === 'grep,sort,uniq');
    await clickWord(page, 'rep -r');
    await until('grep open again', () => foldedRows(panel), (f) => f === 'sort,uniq');
    await close();
  });

  it('opens at depth 2 the stage of a pipeline in `$( )` the reader moves the cursor into (usability-9.md, 2.7)', async () => {
    const { page, panel, close } = await emptyAtDepth2('en');
    await page.keyboard.insertText('out=$(grep -r pattern . | sort -r)');
    await until('both stages folded', () => foldedRows(panel), (f) => f === 'grep,sort');
    await clickWord(page, 'sort');
    await until('sort open', () => foldedRows(panel), (f) => f === 'grep');
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(300);
    assert.strictEqual(await foldedRows(panel), 'grep', 'the cursor on `out`: no stage');
    for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
    await until('grep open', () => foldedRows(panel), (f) => f === '');
    await close();
  });

  it('keeps folded at depth 2 a stage the viewer folded while a key moves the cursor inside it; a move out and back in opens it (usability-9.md, 2.7)', async () => {
    const { page, panel, close } = await emptyAtDepth2('en');
    await page.keyboard.insertText(PIPELINE);
    await until('every stage folded', () => foldedRows(panel), (f) => f === 'grep,sort,uniq');
    // (A key inside the stage the paste left the cursor in opens it: the model folded it, not the viewer.)
    await page.keyboard.press('ArrowLeft');
    await until('uniq open', () => foldedRows(panel), (f) => f === 'grep,sort');
    await clickWord(page, 'grep');
    await until('grep open', () => foldedRows(panel), (f) => f === 'sort');
    await foldButton(panel, 'grep').click();
    await until('grep folded', () => foldedRows(panel), (f) => f === 'grep,sort');
    await page.locator('.cm-content').focus();
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(400);
    assert.strictEqual(await foldedRows(panel), 'grep,sort', 'a key inside grep keeps the fold the viewer made');
    await clickWord(page, 'uniq');
    await page.waitForTimeout(300);
    await clickWord(page, 'grep');
    await until('grep open again', () => foldedRows(panel), (f) => f === 'sort');
    // (▸ on a stage the cursor is not in, then a click into it: it opens again.)
    await foldButton(panel, 'uniq').click();
    await until('uniq folded', () => foldedRows(panel), (f) => f === 'sort,uniq');
    await clickWord(page, 'uniq');
    await until('uniq open again', () => foldedRows(panel), (f) => f === 'sort');
    await close();
  });

  it('folds every stage again at depth 2 when the line is drawn anew: a character typed, or depth 1 and back (usability-9.md, 2.7)', async () => {
    const ctx = await context(1280, 'en', { animations: false });
    const page = await ctx.newPage();
    const panel = await open(page, 'grep -h x f | uniq -c | head -5');
    await chooseDepth(page, 2);
    await depthDrawn(panel, 2);
    await until('every stage folded', () => foldedRows(panel), (f) => f === 'grep,uniq,head');
    await page.locator('.cm-content').focus();
    await page.keyboard.press('End');
    await until('head open', () => foldedRows(panel), (f) => f === 'grep,uniq');
    await page.keyboard.press('Home');
    await until('grep open', () => foldedRows(panel), (f) => f === 'uniq');
    // (Depth 1 and back: every stage folded again, the cursor on grep.)
    await chooseDepth(page, 1);
    await depthDrawn(panel, 1);
    await chooseDepth(page, 2);
    await depthDrawn(panel, 2);
    await until('the start of depth 2', () => foldedRows(panel), (f) => f === 'grep,uniq,head');
    await page.locator('.cm-content').focus();
    await page.keyboard.press('End');
    await until('head open', () => foldedRows(panel), (f) => f === 'grep,uniq');
    // (A character typed at the end: a new text, and every stage folds again.)
    await page.keyboard.type('0');
    await until('the start of the new text', () => foldedRows(panel), (f) => f === 'grep,uniq,head');
    await page.waitForTimeout(300);
    assert.strictEqual(await foldedRows(panel), 'grep,uniq,head');
    await ctx.close();
  });

  it('folds nothing and moves no row under a click on a row at depth 2, however late the redraw it brings comes (usability-9.md, 2.7)', async () => {
    // (On a slow phone the redraw came after the 1.5 s that the panel once waited for it, and folded the stage above the row tapped.)
    const ctx = await context(1280, 'en', { animations: false });
    await ctx.addInitScript(SLOW_UPDATES);
    const page = await ctx.newPage();
    const panel = await open(page, 'grep -h x f | sort -r | uniq -c | head -5');
    await chooseDepth(page, 2);
    await depthDrawn(panel, 2);
    await until('every stage folded', () => foldedRows(panel), (f) => f === 'grep,sort,uniq,head');
    // (One click, its redraw 2.5 s late.)
    await rowNamed(panel, 'sort').scrollIntoViewIfNeeded();
    const sort = await topOf(panel, 'sort');
    await panel.evaluate('window.slowUpdates = 2500');
    await markRows(panel);
    await rowNamed(panel, 'sort').click();
    await redrawn(panel);
    assert.deepStrictEqual([await foldedRows(panel), await topOf(panel, 'sort')], ['grep,uniq,head', sort]);
    // (Two clicks, each with its own late redraw: the row clicked last stays where it is.)
    await rowNamed(panel, 'uniq').scrollIntoViewIfNeeded();
    await markRows(panel);
    await rowNamed(panel, 'uniq').click();
    await page.waitForTimeout(300);
    await rowNamed(panel, 'head').click();
    const [uniq, head] = [await topOf(panel, 'uniq'), await topOf(panel, 'head')];
    await redrawn(panel);
    await page.waitForTimeout(800);
    assert.deepStrictEqual([await foldedRows(panel), await topOf(panel, 'uniq'), await topOf(panel, 'head')], ['grep', uniq, head]);
    // (A redraw that does not move the cursor: the switch of what each command receives. Nothing folds either.)
    await panel.evaluate('window.slowUpdates = 0');
    await flipReceives(panel);
    assert.strictEqual(await foldedRows(panel), 'grep');
    await ctx.close();
  });

  it('keeps at depth 2 a fold the viewer made through redraws and moves of the cursor elsewhere, and a row clicked three times is as clicked once (usability-9.md, 2.7)', async () => {
    const ctx = await context(1280, 'en', { animations: false });
    const page = await ctx.newPage();
    const src = 'grep -h x f | uniq -c | head -5';
    let panel = await open(page, src);
    await chooseDepth(page, 2);
    await depthDrawn(panel, 2);
    await until('every stage folded', () => foldedRows(panel), (f) => f === 'grep,uniq,head');
    // (A click opens uniq's row and moves the cursor there; its fold button folds it again: it stays folded, through a redraw and a move
    // of the cursor to another stage.)
    await markRows(panel);
    await rowNamed(panel, 'uniq').click();
    await redrawn(panel);
    assert.strictEqual(await foldedRows(panel), 'grep,head');
    await foldButton(panel, 'uniq').click();
    assert.strictEqual(await foldedRows(panel), 'grep,uniq,head');
    await flipReceives(panel);
    await clickWord(page, 'head');
    await until('head open', () => foldedRows(panel), (f) => f === 'grep,uniq');
    await flipReceives(panel);
    assert.strictEqual(await foldedRows(panel), 'grep,uniq');
    // (A click on grep's row and one on a part's row put the cursor there, the keys move it on in its stage, and a redraw comes: nothing folds.)
    await markRows(panel);
    await rowNamed(panel, 'grep').click();
    await redrawn(panel);
    await rowNamed(panel, '-h').click();
    await page.waitForTimeout(300);
    await page.locator('.cm-content').focus();
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(300);
    await flipReceives(panel);
    assert.strictEqual(await foldedRows(panel), 'uniq');
    // (A row clicked once, or three times, each click's redraw drawn: the same rows, then as the cursor moves.)
    const after = async (clicks: number) => {
      panel = await open(page, src);
      await depthDrawn(panel, 2);
      await until('the start', () => foldedRows(panel), (f) => f === 'uniq,head');
      for (let i = 0; i < clicks; i++) {
        await rowNamed(panel, 'head').click();
        await page.waitForTimeout(400);
      }
      const drawn = await foldedRows(panel);
      await page.locator('.cm-content').focus();
      await page.keyboard.press('Home');
      await page.waitForTimeout(400);
      return [drawn, await foldedRows(panel)];
    };
    assert.deepStrictEqual(await after(1), ['uniq', 'uniq']);
    assert.deepStrictEqual(await after(3), ['uniq', 'uniq']);
    await ctx.close();
  });

  it('keeps open at depth 2 the glob example of the stage above a row clicked, and the row where it was, until the line is drawn anew (usability-9.md, 2.7)', async () => {
    // (Before, the stage stayed open but its example, which opens where the cursor is, closed: the row clicked moved up by its height.)
    const ctx = await context(1280, 'en', { animations: false });
    const page = await ctx.newPage();
    const panel = await open(page, 'grep x /var/log/*.log | sort | uniq -c');
    await chooseDepth(page, 2);
    await depthDrawn(panel, 2);
    const opened = () => panel.evaluate(`(() => {
      const li = [...document.querySelectorAll('#tree li[data-key]')].find((l) => l.querySelector(':scope > .item > .row .label').textContent === 'grep');
      return [...li.querySelectorAll('details.example')].filter((e) => e.open && e.getClientRects().length).length;
    })()`);
    // (Every stage starts folded; a key moves the cursor in grep's stage: it opens, with its glob example.)
    await until('grep folded', async () => (await foldedRows(panel)).split(','), (f) => f.includes('grep'));
    assert.strictEqual(await opened(), 0);
    await page.locator('.cm-content').focus();
    await page.keyboard.press('ArrowRight');
    await until('the glob example open', opened, (n) => n === 1);
    await rowNamed(panel, 'sort').scrollIntoViewIfNeeded();
    const before = await topOf(panel, 'sort');
    await markRows(panel);
    await rowNamed(panel, 'sort').click();
    await redrawn(panel);
    assert.deepStrictEqual([await opened(), await topOf(panel, 'sort')], [1, before]);
    // (The keys move the cursor to `uniq`: grep's stage and its example stay open.)
    await markRows(panel);
    await page.locator('.cm-content').focus();
    await page.keyboard.press('End');
    await redrawn(panel);
    assert.deepStrictEqual([await opened(), (await foldedRows(panel)).split(',').includes('grep')], [1, false]);
    // (Depth 1 and back: the rows start again, the cursor on uniq: grep's stage folded, its example closed.)
    await chooseDepth(page, 1);
    await depthDrawn(panel, 1);
    await chooseDepth(page, 2);
    await depthDrawn(panel, 2);
    await until('grep folded', async () => (await foldedRows(panel)).split(','), (f) => f.includes('grep'));
    assert.strictEqual(await opened(), 0);
    await ctx.close();
  });

  it('keeps the focus on a stage that folds at depth 2, where it was on a part of it at depth 1', async () => {
    // (Before, the focus went to the part's row, which the fold hides, and fell to the page's body.)
    const ctx = await context(1280, 'en', { animations: false });
    const page = await ctx.newPage();
    const panel = await open(page, 'grep -h x f | uniq -c | head -5');
    await chooseDepth(page, 1);
    await depthDrawn(panel, 1);
    await panel.evaluate(`(() => {
      const li = [...document.querySelectorAll('#tree li[data-key]')].find((l) => l.querySelector(':scope > .item > .row .label').textContent === '-c');
      const row = li.querySelector(':scope > .item > .row');
      row.tabIndex = -1;
      row.focus();
    })()`);
    await page.keyboard.press('2');
    await depthDrawn(panel, 2);
    const at = await panel.evaluate(`(() => {
      const a = document.activeElement;
      const li = a && a.closest('li[data-key]');
      return [a ? a.tagName : '', a && a.matches('button.twisty') ? 'twisty' : '', li ? li.querySelector(':scope > .item > .row .label').textContent : '', li ? li.classList.contains('collapsed') : false];
    })()`);
    assert.deepStrictEqual(at, ['BUTTON', 'twisty', 'uniq', true]);
    await ctx.close();
  });

  for (const width of [1280, 390] as const) {
    for (const receives of ['on', 'off'] as const) it(`keeps the page at depth 2 within its budget for each line of the four test scripts, ${width} px, in both languages, with the switch ${receives}`, async () => {
      for (const lang of ['en', 'ja'] as const) {
        const ctx = await browser.newContext({ locale: lang === 'ja' ? 'ja-JP' : 'en-US', viewport: { width, height: 800 } });
        await ctx.addInitScript(`try { localStorage.setItem('bash-explainer-settings', JSON.stringify({ 'bashExplainer.panel.animations': false })); localStorage.setItem('bash-explainer-panel', '{"depth":2,"receives":${receives === 'on'}}'); } catch {}`);
        const page = await ctx.newPage();
        for (const [name, [text, line]] of Object.entries(SCRIPTS)) {
          const panel = await open(page, text, line);
          await depthDrawn(panel, 2);
          await page.waitForTimeout(100);
          const h = await panel.evaluate(`Math.ceil(document.getElementById('main').getBoundingClientRect().bottom + scrollY)`) as number;
          // (PRINT_HEIGHTS=1 prints what each page measures, to set the budgets from.)
          if (process.env.PRINT_HEIGHTS) console.log(`height ${name} ${width} ${receives} ${lang}: ${h}`);
          assert.ok(h <= BUDGET[name as keyof typeof SCRIPTS][receives][width], `${name}, ${lang}: ${h} px`);
        }
        await ctx.close();
      }
    });
  }

  for (const [width, lang] of [[1280, 'en'], [390, 'ja']] as const) {
    it(`shows bash's steps at depth 1 in one line on a word a step changes, and nothing on one none changes, ${width} px, ${lang}`, async () => {
      const ctx = await context(width, lang, { animations: false });
      const page = await ctx.newPage();
      const panel = await open(page, 'ls ~/docs "$USER" $a *.txt plain "q"');
      await chooseDepth(page, 1);
      await depthDrawn(panel, 1);
      const got = await panel.evaluate(`[...document.querySelectorAll('#tree .row')].map((r) => {
        const s = r.querySelector(':scope > .text > .steps');
        return [r.querySelector(':scope > .code .label').textContent, s ? s.tagName + ' ' + s.textContent : ''];
      })`) as [string, string][];
      const steps = Object.fromEntries(got);
      const t = lang === 'en'
        ? { lead: "bash's steps: ", tilde: 'tilde expansion', param: 'parameter expansion → no word splitting or globbing (quoted) → quote removal', split: 'parameter expansion → word splitting → globbing', glob: 'globbing' }
        : { lead: 'bash の手順: ', tilde: 'チルダ展開', param: 'パラメータ展開 → 単語分割・グロブはしない（クォート内） → クォート除去', split: 'パラメータ展開 → 単語分割 → グロブ', glob: 'グロブ' };
      assert.strictEqual(steps['~/docs'], `SPAN ${t.lead}${t.tilde}`);
      assert.strictEqual(steps['"$USER"'], `SPAN ${t.lead}${t.param}`);
      assert.strictEqual(steps.$a, `SPAN ${t.lead}${t.split}`);
      assert.strictEqual(steps['*.txt'], `SPAN ${t.lead}${t.glob}`);
      // (A word no step changes, and the command: nothing new. The folded line of such a word is depth 2's.)
      assert.strictEqual(steps.plain, '');
      assert.strictEqual(steps['"q"'], '');
      assert.strictEqual(await panel.locator('details.steps, .role-line').count(), 0);
      // (Each line in its row's text column, wrapping there: nothing sticks out, and the page does not scroll sideways.)
      assert.deepStrictEqual(await panel.evaluate(`[...document.querySelectorAll('#tree .row > .text > .steps')].filter((s) => {
        const text = s.parentElement.getBoundingClientRect(), r = s.getBoundingClientRect();
        return r.left < text.left - 0.5 || r.right > text.right + 0.5;
      }).map((s) => s.textContent)`), []);
      assert.strictEqual(await panel.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth'), 0);
      const dir = process.env.BASH_EXPLAINER_SHOTS;
      if (dir) await page.screenshot({ path: path.join(dir, `depth1-steps-${width}-${lang}.png`), fullPage: true });
      await ctx.close();
    });
  }

  it('opens the glob example where it is the line\'s only example or the cursor\'s stage has it, and keeps the names typed across a depth and a move', async () => {
    const ctx = await context(1280, 'en', { animations: false });
    const page = await ctx.newPage();
    const examples = () => panel.evaluate(`[...document.querySelectorAll('#tree details.example')].map((d) => d.open)`) as Promise<boolean[]>;
    let panel = await open(page, 'ls /var/log/*.log');
    assert.deepStrictEqual(await examples(), [true], 'the only example');
    panel = await open(page, 'ls *.txt; ls *.md');
    assert.deepStrictEqual(await examples(), [true, false], 'the cursor on the first stage');
    // Names typed in the first: kept at depth 2, and back at depth 1.
    const box = panel.locator('#tree details.example').first().locator('textarea');
    await box.fill('mine.txt\nother.md');
    const result = () => panel.locator('#tree details.example').first().evaluate((d) => d.querySelector('textarea')!.value + '|' + [...d.querySelectorAll('pre:not(.layer)')].map((p) => p.textContent).join('/'));
    // (Its matching names, then those it does not match.)
    await until('the rerun', result, (r) => r === 'mine.txt\nother.md|mine.txt/other.md');
    const typed = await result();
    for (const depth of [2, 1] as const) {
      await chooseDepth(page, depth);
      await depthDrawn(panel, depth);
      assert.strictEqual(await result(), typed, `depth ${depth}`);
    }
    // The cursor on the second stage: its example opens, and the first stays open (the panel only opens what the model opens, until the
    // line is drawn anew: usability-9.md, 2.7); back, the names are still there.
    await page.locator('.cm-content').focus();
    await page.keyboard.press('Control+End');
    await until('the second open', examples, (o) => o.join() === 'true,true');
    await page.keyboard.press('Control+Home');
    await page.waitForTimeout(300);
    assert.deepStrictEqual(await examples(), [true, true]);
    assert.strictEqual(await result(), typed);
    // A choice of the reader's stays as it was made: the first, closed, stays closed on its stage.
    await panel.locator('#tree details.example > summary').first().click();
    await until('closed', examples, (o) => o.join() === 'false,true');
    await page.locator('.cm-content').focus();
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(300);
    assert.deepStrictEqual(await examples(), [false, true]);
    await ctx.close();
  });

  it('in VS Code\'s panel: the depth control in the header, the key, what the host is told', async () => {
    const page = await browser.newPage({ viewport: { width: 600, height: 700 } });
    await page.goto(server.url('dark', 'en', 1));
    await until('the rows', () => page.locator('#tree .row').count(), (n) => n > 3);
    assert.strictEqual(await page.locator('.role-line').count(), 0);
    await page.locator('#main').evaluate((e) => { e.tabIndex = -1; e.focus(); });
    await page.keyboard.press('2');
    await until('the role lines', () => page.locator('.role-line').count(), (n) => n > 3);
    assert.strictEqual(await page.locator('#view-depth2').getAttribute('aria-pressed'), 'true');
    assert.deepStrictEqual(await page.evaluate('window.POSTED.filter((m) => m.type === "panelState").map((m) => m.state)'), [{ depth: 2 }]);
    await page.close();
  });

  // (The eight steps' markup, styles and scripts are gone.)
  it('has no trace of the tabs in the panel\'s files', () => {
    const root = path.join(__dirname, '..');
    for (const file of ['media/panel.js', 'media/panel.css', 'web/index.html', 'web/panel-bridge.ts', 'web/panel-head.ts']) {
      assert.doesNotMatch(fs.readFileSync(path.join(root, file), 'utf8'), /reading-tree|#layers|\.trow|stepper|treeitem/, file);
    }
  });
});
