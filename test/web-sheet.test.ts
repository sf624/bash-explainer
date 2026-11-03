// The web page on a phone: the explanation as a bottom sheet over the editor (docs/design/chrome-redesign.md, step C8a),
// run for real in headless Chromium with the CJK fonts of CI. Its heights and where a drag, a tap or a key leaves it
// are src/ui/sheet.ts (test/sheet.test.ts); here the page measures, draws and wires them: the header row's boxes at
// every height and tab, a finger's drag (touch events, as a phone sends them), what shows of the editor on each frame of
// a move, the taps, the keys, the focus, the app bar at full height, the toast above the sheet, the editor's cursor in
// view, and reduced motion.
import * as assert from 'assert';
import type { Browser, BrowserContextOptions, CDPSession, Page } from 'playwright-core';
import { frames, openSite, problemsShown, stable, until } from './support/site';

type Snap = 'peek' | 'half' | 'full';
type Box = { x: number; y: number; width: number; height: number };

describe('the web page: the phone\'s sheet', function () {
  this.timeout(240000);
  let browser: Browser;
  let base = '';

  before(async function () {
    ({ browser, base } = await openSite(this));
  });

  const phone = async (width: number, lang: 'en' | 'ja', more: BrowserContextOptions = {}): Promise<BrowserContextOptions> => ({
    ...(await import('playwright-core')).devices['iPhone 13'], viewport: { width, height: 740 }, locale: lang === 'ja' ? 'ja-JP' : 'en-US', ...more,
  });

  /** The page on a phone, the read-mode tip closed and the sample's problems counted. */
  const open = async (options: BrowserContextOptions, init?: string, at = ''): Promise<Page> => {
    const ctx = await browser.newContext(options);
    if (init) await ctx.addInitScript(init);
    const page = await ctx.newPage();
    await page.goto(base + at);
    await page.locator('.cm-line').nth(5).waitFor();
    if (await page.locator('#readtip').isVisible()) await page.locator('#readtip-close').tap();
    await until('the sample\'s problems', () => problemsShown(page), (v) => v, 20000);
    return page;
  };

  const box = async (page: Page, selector: string): Promise<Box> => {
    const b = (await page.locator(selector).boundingBox())!;
    return { x: Math.round(b.x * 10) / 10, y: Math.round(b.y * 10) / 10, width: Math.round(b.width * 10) / 10, height: Math.round(b.height * 10) / 10 };
  };

  /** Waits until the sheet has stopped moving, and gives its height's name and box. */
  const settled = async (page: Page) => {
    const pane = await stable('the sheet', () => box(page, '#panel-pane'), 4);
    return { snap: (await page.evaluate('document.documentElement.dataset.sheet')) as Snap, pane };
  };

  /** Moves the sheet to a height from the keyboard, on its grabber (Home is the peek, then ↑ one height each). */
  const snapTo = async (page: Page, snap: Snap) => {
    await page.locator('#sheet-grab').focus();
    await page.keyboard.press('Home');
    for (let i = 0; i < ['peek', 'half', 'full'].indexOf(snap); i++) await page.keyboard.press('ArrowUp');
    const s = await settled(page);
    assert.strictEqual(s.snap, snap);
    return s.pane;
  };

  /**
   * What a screen reader is told of an element (Chromium's accessibility tree): its role, name, value and focus, and
   * the value in words its page gives (`aria-valuetext`: the tree, as the DevTools protocol shows it, has the number only).
   */
  const said = async (page: Page, selector: string) => {
    const cdp = await page.context().newCDPSession(page);
    const { root } = await cdp.send('DOM.getDocument');
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
    const { nodes } = await cdp.send('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false });
    await cdp.detach();
    const n = nodes[0];
    const property = (name: string) => n.properties?.find((p) => p.name === name)?.value.value;
    const words = await page.locator(selector).getAttribute('aria-valuetext');
    return { role: n.role?.value, name: n.name?.value, value: n.value?.value, words, focused: property('focused') ?? false };
  };

  /** The width of the swipe strips along the screen's edges (.edge), which the rows' controls keep clear of. */
  const EDGE = 12;

  /**
   * The row's last control (the rightmost one shown, but the sheet's grabber under the row): the gap from its right edge
   * to the row's, and whether a tap 1 px inside that edge, at its middle, finds it (and not the edge's swipe strip over it).
   */
  const lastEnd = (page: Page, row: string) => page.evaluate(`(() => {
    const head = document.querySelector(${JSON.stringify(row)});
    const items = [...head.querySelectorAll('button, [role=tab]')].filter((c) => c.id !== 'sheet-grab' && c.checkVisibility({ visibilityProperty: true }));
    const last = items.reduce((a, b) => (b.getBoundingClientRect().right > a.getBoundingClientRect().right ? b : a));
    const r = last.getBoundingClientRect();
    const hit = document.elementFromPoint(r.right - 1, r.top + r.height / 2);
    return { last: last.id || last.className, right: r.right, gap: head.getBoundingClientRect().right - r.right, inside: !!hit && last.contains(hit), hit: hit && (hit.id || hit.className) };
  })()`) as Promise<{ last: string; right: number; gap: number; inside: boolean; hit: string | null }>;

  /** The header row's controls (the tabs, the view control's pill) and the strip's above the editor. */
  const ROW = ['#tab-explain', '#tab-problems', '#tab-ref', '#view-slot'];
  const STRIP = ['#mode-read', '#mode-edit', '#scope-chip', '#ed-more'];

  it('has one 48 px row at every height and tab, with the same boxes, 44 px controls and no horizontal scroll: 320 to 430 px, en and ja, and 130% text', async () => {
    const cases: [number, 'en' | 'ja', number][] = [];
    for (const width of [320, 360, 390, 430]) for (const lang of ['en', 'ja'] as const) cases.push([width, lang, 1]);
    cases.push([300, 'en', 1.3], [300, 'ja', 1.3]);
    for (const [width, lang, scale] of cases) {
      const where = `${width}px ${lang}${scale === 1 ? '' : ` ${scale * 100}%`}`;
      const page = await open(await phone(width, lang, { reducedMotion: 'reduce' }), scale === 1 ? undefined : `document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = '${scale * 100}%'; })`);
      const row = async () => Promise.all(ROW.map((s) => box(page, s)));
      let first: Box[] | undefined;
      for (const [snap, tab] of [['half', 'explain'], ['full', 'explain'], ['peek', 'explain'], ['half', 'problems'], ['half', 'ref'], ['full', 'problems'], ['half', 'explain']] as [Snap, string][]) {
        const pane = await snapTo(page, snap);
        if ((await page.locator(`#tab-${tab}`).getAttribute('aria-selected')) !== 'true') {
          await page.locator(`#tab-${tab}`).click();
          await until(`the tab ${tab}`, () => page.locator(`#tab-${tab}`).getAttribute('aria-selected'), (v) => v === 'true');
          await settled(page);
        }
        const at = `${where}, ${snap}, ${tab}`;
        const head = await box(page, '#panel-head');
        assert.ok(Math.abs(head.height - 48) < 0.5, `${at}: the row is ${head.height} px`);
        const boxes = await row();
        // The same place in the row at every height and tab (its top moves with the sheet).
        const shape = boxes.map((b) => ({ x: b.x, width: b.width, height: b.height, dy: Math.round((b.y - head.y) * 10) / 10 }));
        first ??= shape as unknown as Box[];
        assert.deepStrictEqual(shape, first, at);
        // Clear of the edges' swipe strips (12 px each side, over the sheet too): inside the rows' padding.
        for (const [i, b] of boxes.entries()) assert.ok(b.height >= 44 && b.x >= EDGE - 0.5 && b.x + b.width <= width - EDGE + 0.5, `${at}: ${ROW[i]} ${JSON.stringify(b)}`);
        assert.strictEqual(await page.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), true, at);
        // A tap at the inner edge of the row's last control finds that control, not the edge's strip.
        const end = await lastEnd(page, '#panel-head');
        assert.ok(end.inside && end.gap >= EDGE - 0.5, `${at}: ${JSON.stringify(end)}`);
        for (const s of STRIP) {
          const b = await box(page, s);
          assert.ok(b.height >= 44 && b.width >= 44 && b.x >= EDGE - 0.5 && b.x + b.width <= width - EDGE + 0.5, `${at}: ${s} ${JSON.stringify(b)}`);
        }
        // The app bar slides away at full height (and leaves the focus order), and is back below it.
        const bar = await box(page, 'header.top');
        const inert = await page.evaluate("document.querySelector('header.top').inert");
        const strip = await box(page, '#ed-head');
        if (snap === 'full') {
          assert.ok(bar.y + bar.height <= 0.5 && inert && Math.abs(pane.y - (strip.y + strip.height)) < 1.5, `${at}: ${JSON.stringify([bar, strip, pane])}`);
        } else {
          assert.ok(bar.y >= 0 && !inert && pane.y > strip.y + strip.height, `${at}: ${JSON.stringify([bar, pane])}`);
        }
        // The peek is the row and the summary row under it (step C8b, about 96 px), at the window's bottom; the summary
        // row's parts keep clear of the edges' swipe strips, and its text is cut at its end, never wrapped.
        const summary = await box(page, '#sheet-summary');
        if (snap === 'peek') {
          assert.ok(Math.abs(pane.height - 97) < 1 && Math.round(pane.y + pane.height) === 740, `${at}: ${JSON.stringify(pane)}`);
          assert.ok(Math.abs(summary.y - (head.y + head.height)) < 0.5 && Math.abs(summary.height - 48) < 0.5 && summary.x === 0 && summary.width === width, `${at}: ${JSON.stringify([head, summary])}`);
          const parts = await page.locator('#sheet-summary > :not(:empty)').evaluateAll((els) => els.filter((e) => e.checkVisibility()).map((e) => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; }));
          for (const r of parts) assert.ok(r.left >= EDGE - 0.5 && r.right <= width - EDGE + 0.5 && r.top >= summary.y && r.bottom <= summary.y + summary.height, `${at}: ${JSON.stringify([summary, parts])}`);
          const text = await page.locator('#summary-text').evaluate((e) => ({ one: e.scrollHeight <= e.clientHeight + 1, words: e.textContent }));
          assert.ok(text.one && text.words, `${at}: ${JSON.stringify(text)}`);
          // "Ln 8" in one place: in the tabs row, or in this row where the tabs row's form has none (its name always has it).
          const inTabs = (await page.locator('#panel-head').getAttribute('data-line')) === 'true';
          assert.strictEqual(await page.locator('#tab-explain .tab-line').isVisible(), inTabs, at);
          assert.strictEqual(await page.locator('#summary-line').isVisible(), !inTabs, at);
          assert.match((await page.locator('#sheet-summary').getAttribute('aria-label'))!, lang === 'ja' ? /^行 \d+：/ : /^Line \d+: /, at);
        } else {
          assert.strictEqual(await page.locator('#sheet-summary').isVisible(), false, at);
        }
      }
      // The desktop strip under the editor is not shown: Problems is a tab.
      assert.strictEqual(await page.locator('.problems-strip').isVisible(), false, where);
      await page.context().close();
    }
  });

  /** A finger on the screen, as a phone sends it: touch events through the browser's input (pointer events of type touch). */
  const finger = (cdp: CDPSession, page: Page) => async (x: number, from: number, to: number, ms: number, steps = 10, middle?: () => Promise<void>) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: from }] });
    for (let i = 1; i <= steps; i++) {
      await page.waitForTimeout(ms / steps);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: from + ((to - from) * i) / steps }] });
      if (i === Math.floor(steps / 2)) await middle?.();
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };

  it('follows a finger on its header, and settles on a height from where it is let go and how fast', async () => {
    const page = await open(await phone(390, 'en'));
    const cdp = await page.context().newCDPSession(page);
    const drag = finger(cdp, page);
    let pane = (await settled(page)).pane;
    // Half of 740 px, at first.
    assert.ok(Math.abs(pane.height - 407) < 1, JSON.stringify(pane));
    // Slowly up by 250 px: it follows the finger, and lets go nearer full than half.
    await drag(6, pane.y + 24, pane.y + 24 - 250, 1000, 10, async () => {
      await frames(page);
      const h = 740 - (await box(page, '#panel-pane')).y;
      assert.ok(Math.abs(h - (407 + 125)) < 3, `mid-drag: ${h}`);
    });
    let s = await settled(page);
    assert.deepStrictEqual([s.snap, Math.round(s.pane.y + s.pane.height)], ['full', 740]);
    // Slowly down by 100 px from half: back to half; by 300 px: the peek.
    await snapTo(page, 'half');
    pane = (await settled(page)).pane;
    await drag(6, pane.y + 24, pane.y + 124, 1000);
    assert.strictEqual((await settled(page)).snap, 'half');
    await drag(6, pane.y + 24, pane.y + 324, 1000);
    assert.strictEqual((await settled(page)).snap, 'peek');
    // A quick flick goes to the next height that way, from nearer the one it left: up from half to full, down from full
    // to half. (Of 100 px: each of the three moves waits for a frame here, so the flick takes about 100 ms, twice the
    // speed of a fling; of 60 px, it had none to spare, and a busy machine made it a slow drag.)
    await snapTo(page, 'half');
    pane = (await settled(page)).pane;
    await drag(6, pane.y + 24, pane.y - 76, 50, 3);
    assert.strictEqual((await settled(page)).snap, 'full');
    pane = (await settled(page)).pane;
    await drag(6, pane.y + 24, pane.y + 124, 50, 3);
    assert.strictEqual((await settled(page)).snap, 'half');
    // A drag that starts on a tab moves the sheet and does not choose the tab.
    pane = (await settled(page)).pane;
    const ref = await box(page, '#tab-ref');
    await drag(ref.x + ref.width / 2, ref.y + 24, ref.y + 324, 1000);
    assert.strictEqual((await settled(page)).snap, 'peek');
    assert.strictEqual(await page.locator('#tab-explain').getAttribute('aria-selected'), 'true');
    // The view control's pill (a menu here) opens its options upwards on a folded sheet, inside the window; the height stays.
    await page.locator('#slot-open').tap();
    const options = await box(page, '#slot-tree');
    const pill = await box(page, '#slot-open');
    assert.ok(options.y + options.height <= pill.y && options.y >= 0 && options.x + options.width <= 390.5, JSON.stringify([options, pill]));
    assert.strictEqual((await settled(page)).snap, 'peek');
    // Dragging the sheet does not pull the page: the browser leaves the header's moves to the page (touch-action), the
    // page itself never scrolls nor pulls to refresh (overscroll-behavior on the root), and the Problems tab's list,
    // the scroller in the sheet, keeps its scroll inside. (The sheet's pane does not scroll: its own would do nothing.)
    assert.deepStrictEqual(await page.evaluate(`(() => {
      const s = (selector) => getComputedStyle(document.querySelector(selector));
      return [s('#panel-head').touchAction, s('html').overscrollBehaviorY, s('body').overscrollBehaviorY, s('#problem-list').overflowY, s('#problem-list').overscrollBehaviorY];
    })()`), ['none', 'none', 'none', 'auto', 'contain']);
    assert.strictEqual(await page.evaluate('scrollY'), 0);
    await page.context().close();
  });

  /**
   * Starts reading, as each frame was painted (a task right after its animation callbacks, so CodeMirror's measure of
   * that frame has run): the rows of what shows of the editor, between its strip and the sheet's top, that lie inside
   * the text's range with no line of the text over them; where the sheet's top is; and where the editor's box ends.
   */
  const FRAMES = `(() => {
    const read = () => {
      const pane = document.getElementById('panel-pane').getBoundingClientRect();
      const scroller = document.querySelector('.cm-scroller').getBoundingClientRect();
      const content = document.querySelector('.cm-content');
      const box = content.getBoundingClientRect();
      const style = getComputedStyle(content);
      const from = Math.ceil(Math.max(document.getElementById('ed-head').getBoundingClientRect().bottom, box.top + parseFloat(style.paddingTop)));
      const to = Math.floor(Math.min(pane.top, box.bottom - parseFloat(style.paddingBottom)));
      const lines = [...document.querySelectorAll('.cm-line')].map((l) => l.getBoundingClientRect())
        .map((r) => [Math.max(r.top, scroller.top), Math.min(r.bottom, scroller.bottom)]).filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]);
      let y = from, blank = 0;
      for (const [a, b] of lines) {
        if (a > y) blank += Math.max(0, Math.min(a, to) - y);
        y = Math.max(y, b);
      }
      return { blank: Math.round(blank + Math.max(0, to - y)), top: pane.top, end: Math.round(scroller.bottom) };
    };
    const seen = [];
    const channel = new MessageChannel();
    channel.port1.onmessage = () => seen.push(read());
    let on = true;
    const frame = () => {
      if (!on) return;
      channel.port2.postMessage(0);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    window.stopFrames = () => {
      on = false;
      return seen;
    };
  })()`;

  /** The page on a phone 844 px tall, with a script of 400 lines. */
  const openLong = async (lang: 'en' | 'ja'): Promise<Page> => {
    const page = await open(await phone(390, lang, { viewport: { width: 390, height: 844 } }));
    await page.locator('#mode-edit').tap();
    await page.locator('.cm-content').click({ position: { x: 100, y: 10 } });
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText(Array.from({ length: 400 }, (_, i) => `echo line ${i + 1}`).join('\n') + '\n');
    await page.keyboard.press('Control+Home');
    await until('the long script', () => page.locator('.cm-lineNumbers .cm-activeLineGutter').innerText(), (v) => v === '1');
    return page;
  };

  const scrollTo = async (page: Page, top: number) => {
    await page.evaluate(`document.querySelector('.cm-scroller').scrollTop = ${top}`);
    await frames(page);
  };

  it('shows the code under every row it uncovers, in each direction, through the drag and the settling, with no blank and no layout per frame', async () => {
    const page = await openLong('ja');
    const cdp = await page.context().newCDPSession(page);
    const drag = finger(cdp, page);
    await cdp.send('Performance.enable');
    const layouts = async () => (await cdp.send('Performance.getMetrics')).metrics.find((m) => m.name === 'LayoutCount')!.value;
    const edge = { peek: 0, half: 0, full: 0 };
    for (const snap of ['peek', 'half', 'full'] as Snap[]) edge[snap] = (await snapTo(page, snap)).y;
    const way: [Snap, Snap][] = [['half', 'peek'], ['peek', 'half'], ['half', 'full'], ['full', 'half'], ['full', 'peek'], ['peek', 'full']];
    const cases: { from: Snap; to: Snap; part: number; ms: number; steps: number; scroll: number }[] = [
      // Let go at the height, or on the way to it (the settling then does the rest).
      ...way.flatMap(([from, to]) => [1, 0.7].map((part) => ({ from, to, part, ms: 400, steps: 25, scroll: 0 }))),
      // From the middle of the script, with no line of it at the top of the window's text.
      { from: 'half', to: 'peek', part: 0.7, ms: 400, steps: 25, scroll: 2000 }, { from: 'peek', to: 'half', part: 0.7, ms: 400, steps: 25, scroll: 2000 },
      // A fling.
      { from: 'half', to: 'peek', part: 0.3, ms: 60, steps: 4, scroll: 0 }, { from: 'peek', to: 'half', part: 0.3, ms: 60, steps: 4, scroll: 0 },
    ];
    for (const c of cases) {
      const at = `${c.from} to ${c.to}, ${c.part} of the way in ${c.ms} ms, the script scrolled by ${c.scroll}`;
      await snapTo(page, c.from);
      await scrollTo(page, c.scroll);
      await page.evaluate(FRAMES);
      const before = await layouts();
      const y = edge[c.from] + 24;
      await drag(6, y, y + (edge[c.to] - edge[c.from]) * c.part, c.ms, c.steps, undefined);
      // (The moves lay out nothing: the pane once as tall as a drag needs, once when the finger lifts, and the odd one of the page's own.)
      const during = (await layouts()) - before;
      assert.ok(c.steps < 10 || during < c.steps / 2, `${at}: ${during} layouts in ${c.steps} moves`);
      await settled(page);
      await frames(page);
      const seen = await page.evaluate('window.stopFrames()') as { blank: number; top: number; end: number }[];
      assert.ok(seen.length >= 5, `${at}: ${seen.length} frames`);
      for (const f of seen) {
        assert.ok(f.blank <= 1, `${at}: ${f.blank} rows of the text show blank, with the sheet's top at ${f.top}`);
        // (The sheet stays where a finger can take it: it never leaves by the bottom on its way to rest.)
        assert.ok(f.top >= edge.full - 1 && f.top <= edge.peek + 1, `${at}: the sheet's top at ${f.top}`);
      }
      assert.deepStrictEqual([...new Set(seen.map((f) => f.end))], [Math.round(edge.peek)], `${at}: the editor's box ends at the lowest height`);
    }
    await page.context().close();
  });

  it('leaves the text where it is through a drag, and shows no blank when the drag is cancelled, either way', async () => {
    const page = await openLong('en');
    const cdp = await page.context().newCDPSession(page);
    const scrolled = () => page.evaluate("document.querySelector('.cm-scroller').scrollTop");
    for (const [snap, step] of [['half', 12], ['peek', -12]] as [Snap, number][]) {
      const y = (await snapTo(page, snap)).y + 24;
      await scrollTo(page, 500);
      await page.evaluate(FRAMES);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 6, y }] });
      for (let i = 1; i <= 20; i++) {
        await page.waitForTimeout(16);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 6, y: y + i * step }] });
      }
      assert.strictEqual(await scrolled(), 500, `${snap}: a drag leaves the text where it is`);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
      await settled(page);
      await frames(page);
      const seen = await page.evaluate('window.stopFrames()') as { blank: number }[];
      assert.ok(seen.length >= 5 && seen.every((f) => f.blank <= 1), `${snap}: ${JSON.stringify(seen.map((f) => f.blank))}`);
    }
    await page.context().close();
  });

  it('keeps the cursor\'s line, the end of the text and the empty editor\'s block above the sheet, though the editor\'s box goes on under it', async () => {
    const page = await openLong('en');
    const lineBox = async () => (await page.locator('.cm-activeLine').boundingBox())!;
    // On a folded sheet, a line low in the window: the sheet's half height would cover it, and it comes back above the sheet.
    await snapTo(page, 'peek');
    await page.locator('.cm-content').focus();
    for (let i = 0; i < 30; i++) await page.keyboard.press('ArrowDown');
    await frames(page);
    assert.ok((await lineBox()).y > 500, JSON.stringify(await lineBox()));
    const half = await snapTo(page, 'half');
    await frames(page);
    const at = await lineBox();
    assert.ok(at.y + at.height <= half.y + 0.5 && at.y >= 0, JSON.stringify({ at, half }));
    // The arrow keys go on scrolling above the sheet.
    await page.locator('.cm-content').focus();
    for (let i = 0; i < 30; i++) await page.keyboard.press('ArrowDown');
    await frames(page);
    const moved = await lineBox();
    assert.ok(moved.y + moved.height <= half.y + 0.5, JSON.stringify({ moved, half }));
    // The last line reaches the sheet's top at half, and at the end of the scroll a move changes nothing of the text.
    await page.keyboard.press('Control+End');
    await frames(page);
    await scrollTo(page, 1e7);
    const scroll = () => page.evaluate("document.querySelector('.cm-scroller').scrollTop");
    const end = await scroll();
    const last = await lineBox();
    assert.ok(Math.abs(last.y + last.height - half.y) <= 6, JSON.stringify({ last, half }));
    await snapTo(page, 'peek');
    await frames(page);
    assert.strictEqual(await scroll(), end);
    // The empty editor's block lies above a half sheet.
    await snapTo(page, 'half');
    await page.locator('.cm-content').focus();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Delete');
    await page.locator('#empty-editor .empty-box').waitFor();
    const block = await box(page, '#empty-editor .empty-box');
    assert.ok(block.y + block.height <= half.y, JSON.stringify({ block, half }));
    await page.context().close();
  });

  it('takes a finger on its header at the very edge of the screen, where a swipe strip lies over the rest of the sheet', async () => {
    const page = await open(await phone(390, 'en'));
    const hit = (x: number, y: number) => page.evaluate(`(document.elementFromPoint(${x}, ${y}).closest('#panel-head, .edge') ?? {}).id`);
    for (const snap of ['peek', 'half', 'full'] as Snap[]) {
      const top = (await snapTo(page, snap)).y;
      for (const x of [2, 387]) {
        assert.strictEqual(await hit(x, top + 24), 'panel-head', `${snap}, ${x}`);
        if (snap !== 'peek') assert.match(String(await hit(x, top + 100)), /^edge/, `${snap}, ${x}, under the header`);
      }
    }
    await page.context().close();
  });

  it('cycles its heights on a tap of the header or of the tab chosen, and opens to show another tab', async () => {
    const page = await open(await phone(390, 'ja'));
    const tapAt = async (x: number) => {
      const head = await box(page, '#panel-head');
      await page.touchscreen.tap(x, head.y + 30);
      return (await settled(page)).snap;
    };
    // The header around the tabs (its edge), and the tab already chosen.
    assert.strictEqual((await settled(page)).snap, 'half');
    assert.strictEqual(await tapAt(5), 'full');
    assert.strictEqual(await tapAt(5), 'peek');
    const explain = await box(page, '#tab-explain');
    assert.strictEqual(await tapAt(explain.x + explain.width / 2), 'half');
    assert.strictEqual(await tapAt(explain.x + explain.width / 2), 'full');
    // Another tab: chosen, and the height stays; on a folded sheet, the sheet opens to half.
    const problems = await box(page, '#tab-problems');
    assert.strictEqual(await tapAt(problems.x + problems.width / 2), 'full');
    assert.strictEqual(await page.locator('#tab-problems').getAttribute('aria-selected'), 'true');
    await snapTo(page, 'peek');
    assert.strictEqual(await tapAt(explain.x + explain.width / 2), 'half');
    assert.strictEqual(await page.locator('#tab-explain').getAttribute('aria-selected'), 'true');
    await page.context().close();
  });

  it('moves with the keys on its grabber, says its height, keeps the focus off what it hides, and shows its hint once', async () => {
    const page = await open(await phone(390, 'en'));
    const grab = page.locator('#sheet-grab');
    // In the Tab order before the tabs. A slider over the heights (its keys are a slider's), named once, its value the
    // height: the control asked for says the height shown, at once, even while it has the focus.
    await page.locator('#tab-explain').focus();
    await page.keyboard.press('Shift+Tab');
    assert.strictEqual(await page.evaluate('document.activeElement.id'), 'sheet-grab');
    assert.deepStrictEqual(await said(page, '#sheet-grab'), { role: 'slider', name: 'Explanation height', value: 1, words: 'Half', focused: true });
    assert.strictEqual(await page.locator('#sheet-hint').isVisible(), false);
    // A key on the grabber changes its value, which a screen reader says: the live region says nothing then (it would be
    // said twice). A tap or a drag from elsewhere is said there once; a window that changes size says nothing.
    await page.evaluate(`(() => {
      const region = document.getElementById('announce');
      window.said = [];
      new MutationObserver(() => window.said.push(region.textContent)).observe(region, { childList: true, characterData: true, subtree: true });
    })()`);
    await page.keyboard.press('ArrowUp');
    assert.strictEqual((await settled(page)).snap, 'full');
    assert.deepStrictEqual(await said(page, '#sheet-grab'), { role: 'slider', name: 'Explanation height', value: 2, words: 'Full', focused: true });
    // The first full sheet: the hint, once.
    assert.strictEqual(await page.locator('#sheet-hint').isVisible(), true);
    assert.match(await page.locator('#sheet-hint').innerText(), /Tap or drag this bar/);
    await page.keyboard.press('End');
    assert.deepStrictEqual(await page.evaluate('window.said'), []);
    const head = await box(page, '#panel-head');
    await page.touchscreen.tap(5, head.y + 30);
    assert.strictEqual((await settled(page)).snap, 'peek');
    assert.notStrictEqual(await page.evaluate('document.activeElement.id'), 'sheet-grab');
    assert.deepStrictEqual(await page.evaluate('window.said'), ['Explanation height: Folded']);
    assert.deepStrictEqual(await said(page, '#sheet-grab'), { role: 'slider', name: 'Explanation height', value: 0, words: 'Folded', focused: false });
    await page.setViewportSize({ width: 390, height: 700 });
    await settled(page);
    await page.setViewportSize({ width: 390, height: 740 });
    await settled(page);
    assert.deepStrictEqual(await page.evaluate('window.said'), ['Explanation height: Folded']);
    await grab.focus();
    await page.keyboard.press('End');
    assert.strictEqual((await settled(page)).snap, 'full');
    assert.deepStrictEqual(await grab.evaluate((e) => ['aria-orientation', 'aria-valuemin', 'aria-valuenow', 'aria-valuemax'].map((a) => e.getAttribute(a))), ['vertical', '0', '2', '2']);
    // At full, the editor is out of the focus order; at the peek, the explanation is.
    assert.deepStrictEqual(await page.evaluate("[document.getElementById('editor').inert, document.getElementById('panel-body').inert]"), [true, false]);
    await page.keyboard.press('Home');
    assert.strictEqual((await settled(page)).snap, 'peek');
    assert.strictEqual(await page.locator('#sheet-hint').isVisible(), false);
    assert.deepStrictEqual(await page.evaluate("[document.getElementById('editor').inert, document.getElementById('panel-body').inert, document.getElementById('problems').inert]"), [false, true, true]);
    // Enter cycles; the focus stays on the grabber.
    await page.keyboard.press('Enter');
    assert.strictEqual((await settled(page)).snap, 'half');
    await page.keyboard.press('End');
    assert.strictEqual((await settled(page)).snap, 'full');
    assert.strictEqual(await page.locator('#sheet-hint').isVisible(), false, 'shown once');
    assert.strictEqual(await page.evaluate('document.activeElement.id'), 'sheet-grab');
    // The focus in the editor when the sheet goes full: on the grabber, never on the page's body.
    await page.keyboard.press('ArrowDown');
    await page.locator('.cm-content').focus();
    await page.evaluate("document.getElementById('sheet-grab').dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))");
    assert.strictEqual((await settled(page)).snap, 'full');
    assert.strictEqual(await page.evaluate('document.activeElement.id'), 'sheet-grab');
    assert.deepStrictEqual(await said(page, '#sheet-grab'), { role: 'slider', name: 'Explanation height', value: 2, words: 'Full', focused: true });
    // Not again after a reload.
    await page.reload();
    await page.locator('.cm-line').first().waitFor();
    await snapTo(page, 'full');
    assert.strictEqual(await page.locator('#sheet-hint').isVisible(), false);
    await page.context().close();

    // Without storage: the hint shows once in the page, and nothing throws.
    const bare = await open(await phone(360, 'ja'), 'Object.defineProperty(window, "localStorage", { get() { throw new Error("no storage"); } })');
    const errors: string[] = [];
    bare.on('pageerror', (e) => errors.push(e.message));
    await snapTo(bare, 'full');
    assert.match(await bare.locator('#sheet-hint').innerText(), /このバーを/);
    assert.deepStrictEqual(await said(bare, '#sheet-grab'), { role: 'slider', name: '解説の高さ', value: 2, words: '全体', focused: true });
    assert.strictEqual(await bare.locator('#announce').textContent(), '', 'the keys on the grabber: its value only');
    await snapTo(bare, 'half');
    await snapTo(bare, 'full');
    assert.strictEqual(await bare.locator('#sheet-hint').isVisible(), false);
    assert.deepStrictEqual(errors, []);
    await bare.context().close();
  });

  it('has Problems as a tab, with its counts by level: a problem chosen goes to its line, with its explanation at half height', async () => {
    const page = await open(await phone(390, 'en'));
    const tab = page.locator('#tab-problems');
    // At 390 px in English the tab shows its highest level only, and keeps the line (decision 9: the counts go before
    // the line); its name has every count. At 430 px it shows every level.
    assert.match((await tab.getAttribute('aria-label'))!, /^Problems: \d+ errors?, \d+ warnings?, \d+ /);
    assert.match(await tab.innerText(), /^ⓧ\s*\d+$/);
    assert.match(await page.locator('#tab-explain').innerText(), /^Explanation\s*Ln \d+$/);
    await page.setViewportSize({ width: 430, height: 740 });
    await until('every level', () => tab.innerText(), (t) => /^ⓧ\s*\d+\s*⚠\s*\d+\s*ⓘ\s*\d+$/.test(t));
    await page.setViewportSize({ width: 390, height: 740 });
    await until('the highest level', () => tab.innerText(), (t) => /^ⓧ\s*\d+$/.test(t));
    await settled(page);
    // The tabs as one Tab stop: the arrows reach Problems, which shows the list in the sheet.
    await page.locator('#tab-explain').focus();
    await page.keyboard.press('ArrowRight');
    assert.strictEqual(await tab.getAttribute('aria-selected'), 'true');
    assert.deepStrictEqual(await page.evaluate("[document.getElementById('problems').getAttribute('role'), document.getElementById('panel-pane').contains(document.getElementById('problems')), document.getElementById('panel-body').getClientRects().length]"), ['tabpanel', true, 0]);
    await snapTo(page, 'full');
    const row = page.locator('#problem-list .problem').nth(1);
    const line = Number((await row.locator('.where').innerText()).replace(/\D/g, ''));
    await row.focus();
    await page.keyboard.press('Enter');
    assert.strictEqual((await settled(page)).snap, 'half');
    assert.strictEqual(await page.locator('#tab-explain').getAttribute('aria-selected'), 'true');
    await until('the line', () => page.locator('#tab-explain .tab-line').innerText(), (t) => t === `Ln ${line}`);
    // The line shows above the sheet.
    const active = await box(page, '.cm-activeLine');
    const pane = (await settled(page)).pane;
    assert.ok(active.y + active.height <= pane.y && active.y >= (await box(page, '#editor')).y - 0.5, JSON.stringify([active, pane]));
    await page.context().close();
  });

  it('keeps the cursor\'s line above the sheet as it moves, and the toast above its tabs row', async () => {
    const page = await open(await phone(390, 'en'));
    await page.locator('#mode-read').tap();
    // A line low in the editor, tapped at half: the line stays in view at every height below full.
    await page.locator('.cm-line').nth(12).tap();
    for (const snap of ['peek', 'half', 'peek', 'half'] as Snap[]) {
      const pane = await snapTo(page, snap);
      const active = await box(page, '.cm-activeLine');
      const editor = await box(page, '#editor');
      assert.ok(active.y >= editor.y - 0.5 && active.y + active.height <= pane.y + 0.5, `${snap}: ${JSON.stringify([active, editor, pane])}`);
    }
    // A toast (Copy as Markdown, from the menu while the row has no room for the tools) lies just above the sheet's top.
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base.slice(0, -1) });
    assert.strictEqual(await page.locator('#copy-md').isVisible(), false);
    for (const snap of ['half', 'peek', 'full'] as Snap[]) {
      const pane = await snapTo(page, snap);
      await page.locator(snap === 'full' ? '#ed-more' : '#menu-open').tap();
      if (snap === 'full') {
        await page.keyboard.press('Escape');
        await page.locator('#sheet-grab').focus();
        await page.keyboard.press('ArrowDown');
        await settled(page);
        await page.locator('#menu-open').tap();
      }
      await page.locator('#menu-copy-md').tap();
      const toast = await stable('the toast', () => box(page, '#status'));
      const now = (await settled(page)).pane;
      // (At full the room above the sheet is only the strip: the toast stays in the window, over the tabs row at most.)
      if (snap === 'full') assert.ok(toast.y >= 0 && toast.y + toast.height <= now.y + 48, `${snap}: ${JSON.stringify([toast, now, pane])}`);
      else assert.ok(toast.y + toast.height <= now.y && now.y - (toast.y + toast.height) <= 16, `${snap}: ${JSON.stringify([toast, now, pane])}`);
      assert.match(await page.evaluate('navigator.clipboard.readText()') as string, /`/);
    }
    await page.context().close();
  });

  it('sends the focus home to its grabber while it is full: a toast closed with the focus in it, on a touch screen', async () => {
    const ctx = await browser.newContext(await phone(390, 'en', { reducedMotion: 'reduce' }));
    const page = await ctx.newPage();
    await page.goto(`${base}#lang=en&t=${Buffer.from('echo mine\n').toString('base64url')}`);
    const text = () => page.evaluate('document.querySelector(".cm-content").innerText') as Promise<string>;
    await until('the text', text, (t) => t.includes('echo mine'));
    if (await page.locator('#readtip').isVisible()) await page.locator('#readtip-close').tap();
    // The sample over the user's text: a toast with Undo.
    await page.locator('#menu-open').tap();
    await page.locator('#menu-sample').tap();
    const undo = page.locator('#status button');
    await undo.waitFor();
    await snapTo(page, 'full');
    // The editor is inert under the full sheet: the focus closing the toast goes to the grabber, not the page's body.
    await undo.focus();
    await page.keyboard.press('Escape');
    await until('the toast gone', () => undo.count(), (n) => n === 0);
    assert.strictEqual(await page.evaluate('document.activeElement.id'), 'sheet-grab');
    await ctx.close();
  });

  it('keeps F6 off what it hides: at full the grabber is the editor\'s stop, folded it is the explanation\'s', async () => {
    const page = await open(await phone(390, 'en'));
    const where = () => page.evaluate(`(() => {
      const a = document.activeElement;
      return a.id === 'panel' ? 'panel' : a.closest('.cm-editor') ? 'editor' : a.id || a.tagName;
    })()`) as Promise<string>;
    const press = async (key: string) => {
      await page.keyboard.press(key);
      await frames(page, 2);
      return where();
    };
    // Full: the editor is inert; F6 goes between the grabber and the explanation, each way.
    await snapTo(page, 'full');
    assert.deepStrictEqual([await press('F6'), await press('F6'), await press('Shift+F6'), await press('Shift+F6')], ['panel', 'sheet-grab', 'panel', 'sheet-grab']);
    // Folded: the explanation is inert; F6 goes between the editor and the grabber, never into the frame.
    await snapTo(page, 'peek');
    assert.deepStrictEqual([await press('F6'), await press('F6'), await press('Shift+F6'), await press('Shift+F6')], ['editor', 'sheet-grab', 'editor', 'sheet-grab']);
    // Half: the explanation and the editor, as on a desktop (from the sheet's header, the next is the explanation).
    await snapTo(page, 'half');
    assert.deepStrictEqual([await press('F6'), await press('F6'), await press('F6')], ['panel', 'editor', 'panel']);
    await page.context().close();
  });

  it('moves the sheet and the app bar without animation with reduced motion, and with one otherwise', async () => {
    for (const motion of ['reduce', 'no-preference'] as const) {
      const page = await open(await phone(390, 'en', { reducedMotion: motion }));
      const durations = () => page.evaluate("[getComputedStyle(document.getElementById('panel-pane')).transitionDuration, getComputedStyle(document.querySelector('header.top')).transitionDuration]");
      assert.deepStrictEqual(await durations(), motion === 'reduce' ? ['0s', '0s'] : ['0.25s', '0.25s'], motion);
      // At once, in the same frame as the key: no step between.
      await page.locator('#sheet-grab').focus();
      const at = await page.evaluate(`new Promise((resolve) => {
        document.getElementById('sheet-grab').dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
        requestAnimationFrame(() => resolve([document.getElementById('panel-pane').getBoundingClientRect().top, document.querySelector('header.top').getBoundingClientRect().bottom]));
      })`) as [number, number];
      const end = (await settled(page)).pane;
      if (motion === 'reduce') assert.ok(Math.abs(at[0] - end.y) < 0.5 && at[1] <= 0.5, JSON.stringify([at, end]));
      else assert.ok(at[0] > end.y + 20, JSON.stringify([at, end]));
      await page.context().close();
    }
  });

  it('lets nothing of the app bar cover the banner of the development page and the previews at full height, and keeps the banner\'s links reachable', async () => {
    for (const [width, lang, at] of [[320, 'en', 'pr/123/'], [430, 'ja', 'pr/123/'], [320, 'ja', 'next/'], [430, 'en', 'next/']] as const) {
      const where = `${at} ${width}px ${lang}`;
      const page = await open(await phone(width, lang), undefined, at);
      const banner = await box(page, '#channel-banner');
      assert.ok(banner.height > 0, where);
      // What is painted on top at a point, whatever may be tapped: the bar is made takeable for the question (an inert element is
      // not hit, but it is painted), so the answer is the paint order's. Un-inerting also ends the rule that slides the bar
      // (.top[inert]), so its margin is pinned to what it is while the question is asked.
      const painted = (selector: string) => page.evaluate(`(() => {
        const bar = document.querySelector('header.top');
        const was = bar.inert;
        bar.style.marginTop = getComputedStyle(bar).marginTop;
        bar.inert = false;
        const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        bar.inert = was;
        bar.style.marginTop = '';
        return { id: hit && (hit.id || hit.className), inBar: !!hit && bar.contains(hit), inBanner: !!hit && !!hit.closest('#channel-banner'), y: r.top + r.height / 2 };
      })()`) as Promise<{ id: string; inBar: boolean; inBanner: boolean; y: number }>;
      const links = ['#banner-release', '#banner-compare', '#banner-commit', ...(at === 'pr/123/' ? ['#banner-pr'] : [])];
      for (const snap of ['peek', 'half', 'full'] as const) {
        await snapTo(page, snap);
        const at2 = `${where} ${snap}`;
        const reachable = await page.evaluate(`${JSON.stringify(links)}.map((s) => { const r = document.querySelector(s).getClientRects()[0]; const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!hit && hit.closest(s) !== null; })`);
        assert.deepStrictEqual(reachable, links.map(() => true), at2);
        if (snap === 'full') {
          // The bar has slid up over the banner's place: it must not be painted over it, nor take a tap.
          for (const control of ['#menu-open', '.brand', '#settings-open']) {
            const p = await painted(control);
            assert.ok(!p.inBar && (p.y < 0 || p.inBanner), `${at2}: ${control} ${JSON.stringify(p)}`);
            const r = (await page.locator(control).boundingBox())!;
            const hit = await page.evaluate(`(() => { const e = document.elementFromPoint(${r.x + r.width / 2}, ${r.y + r.height / 2}); return !!e && !!e.closest('header.top'); })()`);
            assert.strictEqual(hit, false, `${at2}: ${control}`);
          }
        } else {
          // Below full the bar is there, and a tap on its menu button opens the menu, and goes nowhere else.
          const p = await painted('#menu-open');
          assert.ok(p.id === 'menu-open' || p.inBar, `${at2}: ${JSON.stringify(p)}`);
          await page.locator('#menu-open').tap();
          await until('the menu', () => page.evaluate("document.getElementById('drawer').open"), (v) => v === true);
          assert.strictEqual(page.url().split('#')[0], base + at, at2);
          await page.keyboard.press('Escape');
          await until('the menu closed', () => page.evaluate("document.getElementById('drawer').open"), (v) => v === false);
        }
      }
      await page.context().close();
    }
  });
});
