// The panel keeps the row the viewer acted on where it is on the screen (media/panel.js, `hold`): a row folded or
// unfolded at either depth, and the first row on the screen when the depth
// changes, stay put right after the change, at every frame of the motion and after it, also near the end of the
// page, where a blank spacer holds the page and goes as the viewer scrolls up. In headless Chromium, in the web
// page's frame (wide, and on a phone) and in VS Code's panel (test/support/panel-page.ts), with motion and without.
import * as assert from 'assert';
import type { Browser, BrowserContext, Frame, Page } from 'playwright-core';
import { servePanel, type PanelServer } from './support/panel-page';
import { chooseDepth, openSite, until } from './support/site';

/** A loop over several lines (test/fixtures/sample.sh). */
const LOOP = `while getopts ":hv:o:" opt; do
  case "$opt" in
    h) usage ;;
    v) verbose=$OPTARG ;;
    \\?) echo "unknown option: -$OPTARG" >&2 ;;
  esac
done`;
const LINE = `find . -type f -name '*.log' -mtime +7 -print0 | xargs -0 grep -l "ERROR $(date +%Y)" | sort | uniq -c | awk '{print $2}' | sed 's/a/b/g' > out.txt 2>&1 && echo done || echo failed`;

/** What a change did to rows (by selector), sampled in the page: before, right after it, then after each frame drawn, for 600 ms (null: not drawn). */
interface Track {
  before: (number | null)[];
  samples: { tops: (number | null)[]; moving: number; spacer: number }[];
}

/**
 * Clicks `target` (or presses a key on it) in the panel's document and samples where the rows of `selectors` are (found again
 * each time: another depth draws the rows anew). A sample is taken after a frame is drawn (in a task after the frame's
 * callbacks), as the viewer sees it, and one right after the change (once its microtasks have run).
 */
const TRACK = `async ([selectors, target]) => {
  const tops = () => selectors.map((s) => { const e = document.querySelector(s); return e && e.getClientRects().length ? e.getBoundingClientRect().top : null; });
  const at = () => ({ tops: tops(), moving: document.getAnimations().filter((a) => !(a instanceof CSSTransition) && a.playState === 'running').length, spacer: document.getElementById('scroll-spacer').getBoundingClientRect().height });
  const before = tops();
  // (A click is the pointer's: it goes down first.)
  const el = document.querySelector(target);
  el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, isPrimary: true }));
  el.click();
  await Promise.resolve();
  await Promise.resolve();
  const samples = [at()];
  await new Promise((done) => {
    const end = performance.now() + 600;
    const tick = () => requestAnimationFrame(() => setTimeout(() => { samples.push(at()); if (performance.now() < end) tick(); else done(); }, 0));
    tick();
  });
  return { before, samples };
}`;

describe('the panel keeps the row acted on in place', function () {
  this.timeout(180000);
  let browser: Browser;
  let base = '';
  let vscode: PanelServer;
  let loop: PanelServer;

  before(async function () {
    ({ browser, base } = await openSite(this));
    vscode = await servePanel(LINE, 'cleanup.sh');
    loop = await servePanel(LOOP, 'opts.sh');
  });
  after(async () => {
    await vscode?.close();
    await loop?.close();
  });

  interface Host {
    name: string;
    open(depth: 1 | 2, animations: boolean, reduced?: boolean): Promise<{ ctx: BrowserContext; panel: Frame }>;
  }

  /** The web page, `width` wide (390: a phone), its panel showing `text` at `depth` (its first line, when it has several). */
  const web = (width: number, text = LINE): Host => ({
    name: width < 520 ? `the web page on a phone (${width}px)` : `the web page (${width}px)`,
    async open(depth, animations, reduced = false) {
      const { devices } = await import('playwright-core');
      const phone = width < 520 ? { ...devices['iPhone 13'] } : {};
      const ctx = await browser.newContext({ ...phone, viewport: { width, height: 800 }, locale: 'en-US', reducedMotion: reduced ? 'reduce' : 'no-preference' });
      if (!animations) await ctx.addInitScript(`try { localStorage.setItem('bash-explainer-settings', JSON.stringify({ 'bashExplainer.panel.animations': false })); } catch {}`);
      const page = await ctx.newPage();
      await page.goto(base);
      const panel = () => page.frames().find((f) => f.url().endsWith('/panel.html'))!;
      await until('the panel', () => Promise.resolve(panel()), (f) => !!f);
      // (Focused, not clicked: on a phone the middle of the editor's content lies under the explanation's sheet.)
      await page.locator('.cm-content').focus();
      await page.keyboard.press('Control+A');
      await page.keyboard.insertText(text);
      if (text.includes('\n')) await page.keyboard.press('Control+Home');
      await until('the line explained', async () => (await panel().locator('#line').textContent()) ?? '', (t) => t.includes(text.slice(0, 12)));
      await chooseDepth(page, depth);
      await until('the rows', () => panel().evaluate('document.body.dataset.depth'), (d) => d === String(depth));
      await still(panel());
      return { ctx, panel: panel() };
    },
  });

  /** VS Code's panel (its page outside VS Code), 600 by 500, showing what `server` serves (`LINE`). */
  const vsCode = (server = () => vscode): Host => ({
    name: "VS Code's panel",
    async open(depth, animations, reduced = false) {
      const ctx = await browser.newContext({ viewport: { width: 600, height: 500 }, reducedMotion: reduced ? 'reduce' : 'no-preference' });
      const page: Page = await ctx.newPage();
      await page.goto(server().url('dark', 'en', depth));
      await until('the line', () => page.locator('#where').textContent(), (t) => !!t);
      if (!animations) await page.evaluate(`document.body.classList.add('vscode-reduce-motion')`);
      return { ctx, panel: page.mainFrame() };
    },
  });
  const code = vsCode();

  const track = (panel: Frame, selectors: string[], target: string) => panel.evaluate(`(${TRACK})(${JSON.stringify([selectors, target])})`) as Promise<Track>;

  const rowSel = (path: string) => `#tree li[data-path="${path}"] > .item > .row`;


  /** The rows with parts that are unfolded and drawn, with their tops on the screen (`below`: under the sticky rows). */
  async function foldable(panel: Frame): Promise<{ path: string; top: number; below: number }[]> {
    return panel.evaluate(`(() => {
      const items = [...document.querySelectorAll('#tree li[data-path]')].filter((li) => li.querySelector(':scope > .item > .body > ul') && !li.classList.contains('collapsed'));
      const below = document.getElementById('top').getBoundingClientRect().bottom;
      return items.filter((li) => li.getClientRects().length).map((li) => ({ path: li.dataset.path, top: li.querySelector(':scope > .item > .row').getBoundingClientRect().top, below }));
    })()`);
  }
  const onScreenRows = <T extends { top: number; below: number }>(rows: T[], height: number) => rows.filter((r) => r.top > r.below + 4 && r.top < height - 40);

  /** The keys of the rows on the screen, below the line, in order. */
  const onScreen = (panel: Frame) => panel.evaluate(`(() => {
    const below = document.getElementById('top').getBoundingClientRect().bottom;
    return [...document.querySelectorAll('#tree li[data-key]')].filter((li) => {
      const r = li.querySelector(':scope > .item > .row').getBoundingClientRect();
      return r.height && r.bottom > below && r.top < innerHeight;
    }).map((li) => li.dataset.key);
  })()`) as Promise<string[]>;

  const scrollTo = (panel: Frame, y: number | 'end') => panel.evaluate(`(() => { window.scrollTo({ top: ${y === 'end' ? 'document.documentElement.scrollHeight' : y}, behavior: 'instant' }); return scrollY; })()`) as Promise<number>;
  const spacer = (panel: Frame) => panel.evaluate(`document.getElementById('scroll-spacer').getBoundingClientRect().height`) as Promise<number>;
  const height = (panel: Frame) => panel.evaluate('innerHeight') as Promise<number>;
  /** What a failure near the end of the page needs to say: the spacer, the scroll position, where the content ends, and the row's place and its subtree's height. */
  const where = (panel: Frame, path: string) => panel.evaluate(`(() => {
    const li = document.querySelector('#tree li[data-path="${path}"]');
    const r = li && li.getBoundingClientRect(), row = li && li.querySelector(':scope > .item > .row').getBoundingClientRect();
    return JSON.stringify({ path: ${JSON.stringify(path)}, spacer: document.getElementById('scroll-spacer').getBoundingClientRect().height, y: scrollY, h: innerHeight,
      scrollHeight: document.documentElement.scrollHeight, content: document.documentElement.getBoundingClientRect().bottom + scrollY,
      rowTop: row && row.top, rowBottom: row && row.bottom, subtree: r && r.height, collapsed: li && li.classList.contains('collapsed'),
      moving: document.getAnimations().filter((a) => a.playState === 'running').length });
  })()`) as Promise<string>;
  const frames = (panel: Frame) => panel.evaluate('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))');
  const still = (panel: Frame) => until('the motion over', () => panel.evaluate(`document.getAnimations().filter((a) => !(a instanceof CSSTransition) && a.playState === 'running').length`), (n) => n === 0, 3000);

  /** Folds or unfolds the row at `path` and checks that it never moves: with a click on its twisty, or (`row`) on the row. */
  async function click(panel: Frame, path: string, what: string, animations: boolean, how: 'row' | '' = ''): Promise<void> {
    const sel = rowSel(path);
    const t = await track(panel, [sel], how === 'row' ? sel : `${sel} > .twisty`);
    const off = t.samples.filter((s) => s.tops[0] === null || Math.abs(s.tops[0] - t.before[0]!) > 1);
    assert.deepStrictEqual(off.map((s) => s.tops[0]), [], `${what}: the row moved from ${t.before[0]}`);
    if (animations) assert.ok(t.samples.some((s) => s.moving > 0), `${what}: it moved (samples during the motion)`);
    else assert.ok(t.samples.every((s) => s.moving === 0), `${what}: nothing moves`);
    await still(panel);
  }

  /** Scrolls up 40 px at a time until the spacer is gone: each time, the rows move by the scroll and no more, and the spacer only shrinks. */
  async function scrollAway(panel: Frame, path: string): Promise<void> {
    const sel = rowSel(path);
    let left = await spacer(panel);
    for (let i = 0; i < 200 && left > 0; i++) {
      const r = await panel.evaluate(`(async () => {
        const row = document.querySelector('${sel}');
        const y = scrollY, top = row.getBoundingClientRect().top;
        window.scrollBy({ top: -40, behavior: 'instant' });
        await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
        return { dy: y - scrollY, moved: row.getBoundingClientRect().top - top, spacer: document.getElementById('scroll-spacer').getBoundingClientRect().height, y: scrollY };
      })()`) as { dy: number; moved: number; spacer: number; y: number };
      assert.ok(Math.abs(r.moved - r.dy) <= 1, `scrolled ${r.dy}, the row moved ${r.moved}`);
      assert.ok(r.spacer <= left + 0.5, `the spacer shrinks: ${r.spacer} after ${left}`);
      left = r.spacer;
      if (r.y === 0) break;
    }
    assert.strictEqual(await spacer(panel), 0, 'the spacer is gone');
  }

  const web1280 = web(1280);
  const phone = web(390);
  // With motion everywhere; without: the setting (the web page), VS Code's reduced motion, the system's (a phone).
  const runs: [Host, boolean, string, boolean][] = [
    [web1280, true, '', false], [phone, true, '', false], [code, true, '', false],
    [web1280, false, ', the setting off', false], [code, false, ", VS Code's reduced motion", false], [phone, false, ", the system's reduced motion", true],
  ];
  for (const [host, animations, off, reduced] of runs) {
    for (const depth of [1, 2] as const) {
      it(`${host.name}, depth ${depth}${off}: folds and unfolds a row near the end of the page and in the middle without moving it; the spacer goes as the page scrolls up`, async () => {
        const { ctx, panel } = await host.open(depth, animations && !reduced, reduced);
        const errors: string[] = [];
        panel.page().on('pageerror', (e) => errors.push(e.message));
        const h = await height(panel);
        assert.ok(await scrollTo(panel, 'end') > 100, 'the page scrolls');
        const rows = onScreenRows(await foldable(panel), h);
        assert.ok(rows.length, 'a row to fold on the screen');
        const row = rows[rows.length - 1];
        const was = await where(panel, row.path);
        await click(panel, row.path, 'folded at the end', animations);
        assert.ok(await spacer(panel) > 0, `a spacer holds the page: before ${was}, after ${await where(panel, row.path)}`);
        await click(panel, row.path, 'unfolded again', animations);
        await click(panel, row.path, 'folded again', animations);
        await scrollAway(panel, row.path);
        // A row in the middle of the page, in the middle of the screen.
        await scrollTo(panel, 0);
        const all = await foldable(panel);
        const m = all[Math.floor(all.length / 2)];
        await scrollTo(panel, Math.max(0, Math.round(m.top - h / 2)));
        await click(panel, m.path, 'folded in the middle', animations);
        await click(panel, m.path, 'unfolded in the middle', animations);
        await click(panel, m.path, 'folded with a click on the row', animations, 'row');
        await click(panel, m.path, 'unfolded with a click on the row', animations, 'row');
        assert.deepStrictEqual(errors, []);
        await ctx.close();
      });
    }
  }

  /** What is on the screen once the motion is over: the rows drawn between the sticky line and the bottom of the screen, where the line is, and where the page and its content end. */
  const screen = (panel: Frame) => panel.evaluate(`(() => {
    const sticky = document.getElementById('top').getBoundingClientRect();
    const rows = [...document.querySelectorAll('#tree li[data-path] > .item > .row')].filter((r) => {
      const b = r.getBoundingClientRect();
      return b.height && b.bottom > sticky.bottom && b.top < innerHeight;
    });
    return { rows: rows.length, stickyTop: sticky.top, stickyBottom: sticky.bottom, y: scrollY, h: innerHeight,
      content: document.documentElement.getBoundingClientRect().bottom + scrollY };
  })()`) as Promise<{ rows: number; stickyTop: number; stickyBottom: number; y: number; h: number; content: number }>;

  for (const [host, animations] of [[web1280, true], [phone, true], [code, true], [web1280, false]] as const) {
    for (const depth of [1, 2] as const) {
      for (const where of ['middle', 'end'] as const) {
        it(`${host.name}, depth ${depth}${animations ? '' : ', the setting off'}: Collapse all scrolled to the ${where} leaves rows on the screen`, async () => {
          const { ctx, panel } = await host.open(depth, animations);
          const errors: string[] = [];
          panel.page().on('pageerror', (e) => errors.push(e.message));
          const max = await panel.evaluate('document.documentElement.scrollHeight - innerHeight') as number;
          assert.ok(max > 300, 'the page scrolls');
          await scrollTo(panel, where === 'end' ? 'end' : Math.round(max / 2));
          await panel.evaluate(`document.getElementById('toggle').click()`);
          await still(panel);
          const s = await screen(panel);
          assert.ok(s.rows > 0, `rows on the screen after Collapse all: ${JSON.stringify(s)}`);
          assert.ok(s.stickyTop >= -1 && s.stickyBottom <= s.h, `the sticky rows on the screen: ${JSON.stringify(s)}`);
          assert.ok(s.y < s.content, `the page is within its content: ${JSON.stringify(s)}`);
          // Expand all again: still rows on the screen.
          await panel.evaluate(`document.getElementById('toggle').click()`);
          await still(panel);
          assert.ok((await screen(panel)).rows > 0, 'rows on the screen after Expand all');
          assert.deepStrictEqual(errors, []);
          await ctx.close();
        });
      }
    }
  }

  // Another depth of the same line: the first row on the screen that the new depth still has stays where it is, as the rows come from the host.
  for (const [host, animations, off] of [[web1280, true, ''], [phone, true, ''], [code, true, ''], [web1280, false, ', the setting off']] as const) {
    it(`${host.name}${off}: another depth keeps the first row on the screen in place, and adds or takes rows around it`, async () => {
      const { ctx, panel } = await host.open(1, animations);
      for (const to of [2, 1, 2] as const) {
        await scrollTo(panel, Math.round(await panel.evaluate('(document.documentElement.scrollHeight - innerHeight) / 2') as number));
        const on = await onScreen(panel);
        // (A row hidden in a fold is not shown: at depth 2 a pipeline's stages start folded.)
        const top = (key: string) => panel.evaluate(`(() => { const r = document.querySelector('#tree li[data-key="${key}"] > .item > .row'); return r && r.getClientRects().length ? r.getBoundingClientRect().top : null; })()`) as Promise<number | null>;
        const before = await Promise.all(on.map(top));
        if (host === code) await panel.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: '${to}', bubbles: true }))`);
        else await chooseDepth(panel.page(), to);
        await until('the rows of the depth', () => panel.evaluate('document.body.dataset.depth'), (d) => d === String(to));
        await still(panel);
        await frames(panel);
        const after = await Promise.all(on.map(top));
        const k = after.findIndex((t) => t !== null);
        // (Going to depth 1, the screen may hold only rows that go: the row around them then comes under the line. On a phone it may hold an
        // example and no row at all.)
        assert.ok(k >= 0 || to === 1 || !on.length, `${to}: a row stays`);
        if (k >= 0) assert.ok(Math.abs(after[k]! - before[k]!) <= 1, `depth ${to}: the row ${on[k]} moved from ${before[k]} to ${after[k]}`);
        // (A page that became shorter is held by the spacer, which goes as the viewer scrolls up.)
        await scrollTo(panel, 0);
        await frames(panel);
        assert.strictEqual(await spacer(panel), 0, 'the spacer is gone');
      }
      await ctx.close();
    });
  }

  // The same line drawn again (its problems came, a setting changed) leaves the rows where they were. Before, the
  // page went back to the top: in the web page, the problems of a line just typed come a moment after it is explained,
  // and a test that had scrolled meanwhile clicked a row that had moved.
  for (const depth of [1, 2] as const) {
    it(`VS Code's panel, depth ${depth}: the same line drawn again, with other problems or a setting changed, leaves the page and its rows where they are`, async () => {
      const { ctx, panel } = await code.open(depth, true);
      const msg = depth === 2 ? 'window.DEEP.en' : 'window.MSGS.en';
      const tops = () => panel.evaluate(`JSON.stringify([...document.querySelectorAll('#tree li[data-path] > .item > .row')].map((r) => Math.round(r.getBoundingClientRect().top)))`) as Promise<string>;
      assert.ok(await panel.locator('#line .squiggle').count() > 0, 'the line has problems');
      const max = await panel.evaluate('document.documentElement.scrollHeight - innerHeight') as number;
      assert.ok(max > 300, 'the page scrolls');
      for (const y of [Math.round(max / 2), max]) {
        const at = await scrollTo(panel, y);
        const was = await tops();
        for (const marks of ['[]', `${msg}.marks`]) {
          await panel.evaluate(`window.postMessage({ ...${msg}, marks: ${marks} }, '*')`);
          await until('the line drawn again', () => panel.locator('#line .squiggle').count(), (n) => (marks === '[]' ? n === 0 : n > 0));
          assert.ok(Math.abs(await panel.evaluate('scrollY') as number - at) <= 0.5, `scrolled to ${at}: still there (marks ${marks})`);
          assert.strictEqual(await tops(), was, `the rows stay (marks ${marks})`);
        }
        await panel.evaluate(`window.postMessage({ ...${msg}, lineLabel: 'again' }, '*')`);
        await until('the rows drawn anew', () => panel.locator('#where').textContent(), (t) => !!t?.includes('again'));
        assert.ok(Math.abs(await panel.evaluate('scrollY') as number - at) <= 0.5, `scrolled to ${at}: still there (rows drawn anew)`);
        assert.strictEqual(await tops(), was, 'the rows stay (rows drawn anew)');
        await panel.evaluate(`window.postMessage(${msg}, '*')`);
        await until('back', () => panel.locator('#where').textContent(), (t) => !t?.includes('again'));
      }
      await ctx.close();
    });
  }

  // A row whose range goes over several lines (a loop) only folds: before, a click selected its characters in the editor, the cursor went
  // to the other line, and the panel explained it instead. A row on the line selects its characters.
  for (const [host, animations] of [[web(1280, LOOP), true], [web(390, LOOP), true], [vsCode(() => loop), true], [web(1280, LOOP), false]] as const) {
    it(`${host.name}, depth 2${animations ? '' : ', the setting off'}: a click on the row of a loop over several lines folds it; the line explained and the row stay`, async () => {
      const { ctx, panel } = await host.open(2, animations);
      const errors: string[] = [];
      panel.page().on('pageerror', (e) => errors.push(e.message));
      const line = await panel.locator('#line').textContent();
      const item = panel.locator('#tree li[data-path="0"]');
      await item.locator(':scope > .item > .row').scrollIntoViewIfNeeded();
      for (const [want, what] of [[true, 'folded'], [false, 'unfolded']] as const) {
        await click(panel, '0', `the loop ${what}`, animations, 'row');
        assert.strictEqual(await item.evaluate((li) => li.classList.contains('collapsed')), want, `the loop ${what}`);
        // (The editor's selection would come back as another line to explain: give it time.)
        await panel.waitForTimeout(400);
        assert.strictEqual(await panel.locator('#line').textContent(), line, `the line explained stays (the loop ${what})`);
        assert.strictEqual(await item.evaluate((li) => li.classList.contains('collapsed')), want, `the loop stays ${what}`);
      }
      const posted = (await panel.evaluate(`JSON.stringify((window.POSTED ?? []).filter((m) => m.type === 'reveal').map((m) => m.span))`)) as string;
      assert.deepStrictEqual(JSON.parse(posted), [], 'no range selected in the editor for the loop');
      const getopts = await panel.evaluate(`[...document.querySelectorAll('#tree li[data-path]')].find((li) => li.querySelector(':scope > .item > .row .label')?.textContent.startsWith('getopts'))?.dataset.path ?? null`) as string | null;
      assert.ok(getopts, 'the getopts command has a row');
      await panel.locator(rowSel(getopts)).scrollIntoViewIfNeeded();
      await click(panel, getopts, 'the command on the line folded', animations, 'row');
      await panel.waitForTimeout(400);
      assert.strictEqual(await panel.locator('#line').textContent(), line, 'the line explained stays (a row on it)');
      if (host.name.startsWith('VS Code')) {
        const spans = JSON.parse(await panel.evaluate(`JSON.stringify(window.POSTED.filter((m) => m.type === 'reveal').map((m) => m.span.start.line))`) as string) as number[];
        assert.deepStrictEqual(spans, [1], 'the command on the line is selected in the editor');
      }
      assert.deepStrictEqual(errors, []);
      await ctx.close();
    });
  }
});
