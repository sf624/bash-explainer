// The panel keeps the row the viewer acted on where it is on the screen (media/panel.js, `hold`): a row folded or
// unfolded in the Meaning and Reading views, and the first row on the screen when a step of the Reading view
// changes, stay put right after the change, at every frame of the motion and after it, also near the end of the
// page, where a blank spacer holds the page and goes as the viewer scrolls up. In headless Chromium, in the web
// page's frame (wide, and on a phone) and in VS Code's panel (test/support/panel-page.ts), with motion and without.
import * as assert from 'assert';
import type { Browser, BrowserContext, Frame, Page } from 'playwright-core';
import { servePanel, type PanelServer } from './support/panel-page';
import { chooseView, openSite, until } from './support/site';

const LINE = `find . -type f -name '*.log' -mtime +7 -print0 | xargs -0 grep -l "ERROR $(date +%Y)" | sort | uniq -c | awk '{print $2}' | sed 's/a/b/g' > out.txt 2>&1 && echo done || echo failed`;

/** What a change did to rows (by selector), sampled in the page: before, right after it, then after each frame drawn, for 600 ms (null: not drawn). */
interface Track {
  before: (number | null)[];
  /** `start`: the page is where the step controls start to stick (they are under the line, and the tree starts under them). */
  samples: { tops: (number | null)[]; moving: number; spacer: number; start: boolean }[];
}

/**
 * Clicks `target` (or presses a key on it) in the panel's document and samples where the rows of `selectors` are (found again
 * each time: a step draws the tree anew). A sample is taken after a frame is drawn (in a task after the frame's
 * callbacks), as the viewer sees it, and one right after the change (once its microtasks have run).
 */
const TRACK = `async ([selectors, target]) => {
  const tops = () => selectors.map((s) => { const e = document.querySelector(s); return e && e.getClientRects().length ? e.getBoundingClientRect().top : null; });
  const reading = document.getElementById('reading');
  const start = () => !!reading && !reading.hidden && Math.abs(reading.getBoundingClientRect().top - parseFloat(getComputedStyle(document.getElementById('layers')).top)) <= 1;
  const at = () => ({ start: start(), tops: tops(), moving: document.getAnimations().filter((a) => !(a instanceof CSSTransition) && a.playState === 'running').length, spacer: document.getElementById('scroll-spacer').getBoundingClientRect().height });
  const before = tops();
  // ("key:K selector": the key K pressed on the element, as the tree's keys are read.)
  const key = /^key:(\\S+) (.*)$/.exec(target);
  if (key) document.querySelector(key[2]).dispatchEvent(new KeyboardEvent('keydown', { key: key[1], bubbles: true, cancelable: true }));
  else document.querySelector(target).click();
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

  before(async function () {
    ({ browser, base } = await openSite(this));
    vscode = await servePanel(LINE, 'cleanup.sh');
  });
  after(async () => vscode?.close());

  interface Host {
    name: string;
    open(view: 'list' | 'tree', animations: boolean, reduced?: boolean): Promise<{ ctx: BrowserContext; panel: Frame }>;
  }

  /** The web page, `width` wide (390: a phone), its panel showing `LINE` in `view`. */
  const web = (width: number): Host => ({
    name: width < 520 ? `the web page on a phone (${width}px)` : `the web page (${width}px)`,
    async open(view, animations, reduced = false) {
      const { devices } = await import('playwright-core');
      const phone = width < 520 ? { ...devices['iPhone 13'] } : {};
      const ctx = await browser.newContext({ ...phone, viewport: { width, height: 800 }, locale: 'en-US', reducedMotion: reduced ? 'reduce' : 'no-preference' });
      if (!animations) await ctx.addInitScript(`try { localStorage.setItem('bash-explainer-settings', JSON.stringify({ 'bashExplainer.panel.animations': false })); } catch {}`);
      const page = await ctx.newPage();
      await page.goto(base);
      const panel = () => page.frames().find((f) => f.url().endsWith('/panel.html'))!;
      await until('the panel', () => Promise.resolve(panel()), (f) => !!f);
      await page.locator('.cm-content').click();
      await page.keyboard.press('Control+A');
      await page.keyboard.insertText(LINE);
      await until('the line explained', async () => (await panel().locator('#line').textContent()) ?? '', (t) => t.includes(LINE.slice(0, 12)));
      await chooseView(page, view);
      if (view === 'tree') await until('the tree', () => panel().locator('#reading-tree li').count(), (n) => n > 20);
      return { ctx, panel: panel() };
    },
  });

  /** VS Code's panel (its page outside VS Code), 600 by 500. */
  const code: Host = {
    name: "VS Code's panel",
    async open(view, animations, reduced = false) {
      const ctx = await browser.newContext({ viewport: { width: 600, height: 500 }, reducedMotion: reduced ? 'reduce' : 'no-preference' });
      const page: Page = await ctx.newPage();
      await page.goto(vscode.url('dark', 'en', view));
      await until('the line', () => page.locator('#where').textContent(), (t) => !!t);
      if (!animations) await page.evaluate(`document.body.classList.add('vscode-reduce-motion')`);
      if (view === 'tree') {
        // (The harness starts at the step kept as `level: 2`: step 6.)
        await page.locator('#layers button.step[data-step="8"]').click();
        await until('the tree', () => page.locator('#reading-tree li').count(), (n) => n > 20);
      }
      return { ctx, panel: page.mainFrame() };
    },
  };

  const track = (panel: Frame, selectors: string[], target: string) => panel.evaluate(`(${TRACK})(${JSON.stringify([selectors, target])})`) as Promise<Track>;

  const rowSel = (view: 'list' | 'tree', path: string) => (view === 'list' ? `#tree li[data-path="${path}"] > .row` : `#reading-tree li[data-path="${path}"] > .trow`);


  /** The rows with parts that are unfolded and drawn, with their tops on the screen (`below`: under the sticky rows). */
  async function foldable(panel: Frame, view: 'list' | 'tree'): Promise<{ path: string; top: number; below: number }[]> {
    return panel.evaluate(`(() => {
      const items = ${view === 'list'} ? [...document.querySelectorAll('#tree li[data-path]')].filter((li) => li.querySelector(':scope > .body > ul') && !li.classList.contains('collapsed'))
        : [...document.querySelectorAll('#reading-tree li[aria-expanded="true"]')];
      const below = (${view === 'list'} ? document.getElementById('top') : document.getElementById('layers')).getBoundingClientRect().bottom;
      return items.filter((li) => li.getClientRects().length).map((li) => ({ path: li.dataset.path, top: li.firstElementChild.getBoundingClientRect().top, below }));
    })()`);
  }
  const onScreenRows = <T extends { top: number; below: number }>(rows: T[], height: number) => rows.filter((r) => r.top > r.below + 4 && r.top < height - 40);

  /** The paths of the rows of the reading tree on the screen, below the controls, in order. */
  const onScreen = (panel: Frame) => panel.evaluate(`(() => {
    const below = document.getElementById('layers').getBoundingClientRect().bottom;
    return [...document.querySelectorAll('#reading-tree li[role="treeitem"]')].filter((li) => {
      const r = li.firstElementChild.getBoundingClientRect();
      return r.height && r.bottom > below && r.top < innerHeight;
    }).map((li) => li.dataset.path);
  })()`) as Promise<string[]>;

  const scrollTo = (panel: Frame, y: number | 'end') => panel.evaluate(`(() => { window.scrollTo({ top: ${y === 'end' ? 'document.documentElement.scrollHeight' : y}, behavior: 'instant' }); return scrollY; })()`) as Promise<number>;
  const spacer = (panel: Frame) => panel.evaluate(`document.getElementById('scroll-spacer').getBoundingClientRect().height`) as Promise<number>;
  const height = (panel: Frame) => panel.evaluate('innerHeight') as Promise<number>;
  const still = (panel: Frame) => until('the motion over', () => panel.evaluate(`document.getAnimations().filter((a) => !(a instanceof CSSTransition) && a.playState === 'running').length`), (n) => n === 0, 3000);

  /**
   * Folds or unfolds the row at `path` and checks that it never moves: with a click on its twisty (the list) or on
   * the row (the tree), or `how`: a click on the row in the list, a key in the tree.
   */
  async function click(panel: Frame, view: 'list' | 'tree', path: string, what: string, animations: boolean, how: 'row' | 'key' | '' = ''): Promise<void> {
    const sel = rowSel(view, path);
    const target = how === 'key' ? `key:Enter #reading-tree li[data-path="${path}"]` : view === 'list' && how !== 'row' ? `${sel} > .twisty` : sel;
    const t = await track(panel, [sel], target);
    const off = t.samples.filter((s) => s.tops[0] === null || Math.abs(s.tops[0] - t.before[0]!) > 1);
    assert.deepStrictEqual(off.map((s) => s.tops[0]), [], `${what}: the row moved from ${t.before[0]}`);
    if (animations) assert.ok(t.samples.some((s) => s.moving > 0), `${what}: it moved (samples during the motion)`);
    else assert.ok(t.samples.every((s) => s.moving === 0), `${what}: nothing moves`);
    await still(panel);
  }

  /** Scrolls up 40 px at a time until the spacer is gone: each time, the rows move by the scroll and no more, and the spacer only shrinks. */
  async function scrollAway(panel: Frame, view: 'list' | 'tree', path: string): Promise<void> {
    const sel = rowSel(view, path);
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
    for (const view of ['list', 'tree'] as const) {
      const name = view === 'list' ? 'Meaning' : 'Reading';
      it(`${host.name}, ${name}${off}: folds and unfolds a row near the end of the page and in the middle without moving it; the spacer goes as the page scrolls up`, async () => {
        const { ctx, panel } = await host.open(view, animations && !reduced, reduced);
        const errors: string[] = [];
        panel.page().on('pageerror', (e) => errors.push(e.message));
        const h = await height(panel);
        assert.ok(await scrollTo(panel, 'end') > 100, 'the page scrolls');
        const rows = onScreenRows(await foldable(panel, view), h);
        assert.ok(rows.length, 'a row to fold on the screen');
        const row = rows[rows.length - 1];
        await click(panel, view, row.path, 'folded at the end', animations);
        assert.ok(await spacer(panel) > 0, 'a spacer holds the page');
        await click(panel, view, row.path, 'unfolded again', animations);
        await click(panel, view, row.path, 'folded again', animations);
        await scrollAway(panel, view, row.path);
        // A row in the middle of the page, in the middle of the screen.
        await scrollTo(panel, 0);
        const all = await foldable(panel, view);
        const m = all[Math.floor(all.length / 2)];
        await scrollTo(panel, Math.max(0, Math.round(m.top - h / 2)));
        await click(panel, view, m.path, 'folded in the middle', animations);
        await click(panel, view, m.path, 'unfolded in the middle', animations);
        await click(panel, view, m.path, view === 'list' ? 'folded with a click on the row' : 'folded with Enter', animations, view === 'list' ? 'row' : 'key');
        await click(panel, view, m.path, view === 'list' ? 'unfolded with a click on the row' : 'unfolded with Enter', animations, view === 'list' ? 'row' : 'key');
        assert.deepStrictEqual(errors, []);
        await ctx.close();
      });
    }
  }

  /**
   * What is on the screen once the motion is over: the rows of `view` drawn between the sticky rows and the bottom
   * of the screen, whether the sticky rows (the line, and the controls of the tree) are on the screen, and where the
   * page and its content end.
   */
  const screen = (panel: Frame, view: 'list' | 'tree') => panel.evaluate(`(() => {
    const sticky = document.getElementById(${JSON.stringify(view === 'list' ? 'top' : 'layers')}).getBoundingClientRect();
    const rows = [...document.querySelectorAll(${JSON.stringify(view === 'list' ? '#tree li[data-path] > .row' : '#reading-tree li[role="treeitem"] > .trow')})].filter((r) => {
      const b = r.getBoundingClientRect();
      return b.height && b.bottom > sticky.bottom && b.top < innerHeight;
    });
    return { rows: rows.length, stickyTop: sticky.top, stickyBottom: sticky.bottom, y: scrollY, h: innerHeight,
      content: document.documentElement.getBoundingClientRect().bottom + scrollY };
  })()`) as Promise<{ rows: number; stickyTop: number; stickyBottom: number; y: number; h: number; content: number }>;

  for (const [host, animations] of [[web1280, true], [phone, true], [code, true], [web1280, false]] as const) {
    for (const view of ['list', 'tree'] as const) {
      const name = view === 'list' ? 'Meaning' : 'Reading';
      for (const where of ['middle', 'end'] as const) {
        it(`${host.name}, ${name}${animations ? '' : ', the setting off'}: Collapse all scrolled to the ${where} leaves rows on the screen`, async () => {
          const { ctx, panel } = await host.open(view, animations);
          const errors: string[] = [];
          panel.page().on('pageerror', (e) => errors.push(e.message));
          const max = await panel.evaluate('document.documentElement.scrollHeight - innerHeight') as number;
          assert.ok(max > 300, 'the page scrolls');
          await scrollTo(panel, where === 'end' ? 'end' : Math.round(max / 2));
          await panel.evaluate(`document.getElementById('toggle').click()`);
          await still(panel);
          const s = await screen(panel, view);
          assert.ok(s.rows > 0, `rows on the screen after Collapse all: ${JSON.stringify(s)}`);
          assert.ok(s.stickyTop >= -1 && s.stickyBottom <= s.h, `the sticky rows on the screen: ${JSON.stringify(s)}`);
          assert.ok(s.y < s.content, `the page is within its content: ${JSON.stringify(s)}`);
          // Expand all again: still rows on the screen.
          await panel.evaluate(`document.getElementById('toggle').click()`);
          await still(panel);
          assert.ok((await screen(panel, view)).rows > 0, 'rows on the screen after Expand all');
          assert.deepStrictEqual(errors, []);
          await ctx.close();
        });
      }
    }
  }

  for (const [from, to] of [['tree', 'list'], ['list', 'tree']] as const) {
    it(`the web page: a fold near the end, then the page's own switch to ${to === 'list' ? 'Meaning' : 'Reading'}, leaves no blank room below the content`, async () => {
      const { ctx, panel } = await web1280.open(from, true);
      const h = await height(panel);
      await scrollTo(panel, 'end');
      const rows = onScreenRows(await foldable(panel, from), h);
      await click(panel, from, rows[rows.length - 1].path, 'folded at the end', true);
      assert.ok(await spacer(panel) > 0, 'a spacer holds the page');
      await chooseView(panel.page(), to);
      await until('the view', () => panel.locator(to === 'list' ? '#tree' : '#reading').isVisible(), (v) => v);
      await still(panel);
      assert.strictEqual(await spacer(panel), 0, 'the spacer is gone');
      const end = await panel.evaluate('({ y: scrollY + innerHeight, content: document.documentElement.scrollHeight })') as { y: number; content: number };
      assert.ok(end.y <= end.content + 1, `no blank room: ${JSON.stringify(end)}`);
      await ctx.close();
    });
  }

  for (const [host, animations, off] of [[web1280, true, ''], [phone, true, ''], [code, true, ''], [web1280, false, ', the setting off']] as const) {
    it(`${host.name}, Reading${off}: a step change keeps the controls and the first row on the screen in place`, async () => {
      const { ctx, panel } = await host.open('tree', animations);
      for (const [from, to] of [[8, 3], [3, 8], [8, 7], [7, 5], [5, 8], [8, 1]]) {
        if (await panel.locator('#layers button.step[aria-current="step"]').getAttribute('data-step') !== String(from)) await panel.evaluate(`document.querySelector('#layers button.step[data-step="${from}"]').click()`);
        await still(panel);
        await scrollTo(panel, Math.round(await panel.evaluate('(document.documentElement.scrollHeight - innerHeight) / 2') as number));
        const on = await onScreen(panel);
        const t = await track(panel, ['#layers', ...on.map((p) => rowSel('tree', p))], `#layers button.step[data-step="${to}"]`);
        const moved = (i: number) => t.samples.filter((s) => s.tops[i] !== null && Math.abs(s.tops[i]! - t.before[i]!) > 1).map((s) => s.tops[i]);
        assert.deepStrictEqual(moved(0), [], `${from} → ${to}: the controls moved from ${t.before[0]}`);
        // The row kept: the first on the screen that the step still shows (when one does). It moves only up, when
        // the rows above it that go would leave it further down than the start of the tree under the controls.
        const shown = new Set(await panel.evaluate(`[...document.querySelectorAll('#reading-tree li[role="treeitem"]')].map((li) => li.dataset.path)`) as string[]);
        const k = on.findIndex((p) => shown.has(p));
        if (k >= 0) {
          const off = t.samples.filter((s) => s.tops[k + 1] !== null && Math.abs(s.tops[k + 1]! - t.before[k + 1]!) > 1 && !(s.start && s.tops[k + 1]! < t.before[k + 1]!));
          assert.deepStrictEqual(off.map((s) => s.tops[k + 1]), [], `${from} → ${to}: the row ${on[k]} moved from ${t.before[k + 1]}`);
        }
        else assert.ok(to === 1 || from > to, `${from} → ${to}: a step forward keeps every row`);
        if (animations) assert.ok(t.samples.some((s) => s.moving > 0), 'it moved');
      }
      await ctx.close();
    });
  }
});
