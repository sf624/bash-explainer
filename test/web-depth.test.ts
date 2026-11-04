// One view with a depth (docs/design/panel-redesign.md, P8), in the web page and in the panel's page, with CI's fonts: the depth is chosen in
// the view slot or with the keys 1 and 2 when the focus is in the panel, kept for the next visit (a view kept before the depths opens at the
// depth it has become). A deeper depth only adds: the rows of depth 1 stay, in order, saying the same; each row of depth 2 has one role line
// at one place; a pipe is a connector of one line; a word's steps fold where no step acts, with `panel.animations`; the page has a length budget.
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import type { Browser, Frame, Page } from 'playwright-core';
import { servePanel, type PanelServer } from './support/panel-page';
import { chooseDepth, openSite, until } from './support/site';

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
 */
const BUDGET = { on: { 1280: 1420, 390: 1980 }, off: { 1280: 1280, 390: 1820 } } as const;

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
      await ctx.addInitScript(`try { localStorage.setItem('bash-explainer-settings', JSON.stringify({ 'bashExplainer.panel.animations': false })); localStorage.setItem('bash-explainer-panel', '{"depth":2,"receives":${receives === 'on'}}'); } catch {}`);
      const page = await ctx.newPage();
      const panel = await open(page, SCRIPTS.s2[0]);
      await depthDrawn(panel, 2);
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
      // (A row whose parts all come at depth 2 starts folded; a glob's folded example keeps its title.)
      assert.deepStrictEqual(got.folded, ['/var/log/*.log']);
      assert.strictEqual(await panel.locator('#tree details.example > summary').first().isVisible(), true);
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
          assert.ok(h <= BUDGET[receives][width], `${name}, ${lang}: ${h} px`);
        }
        await ctx.close();
      }
    });
  }

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
