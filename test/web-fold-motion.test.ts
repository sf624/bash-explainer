import * as assert from 'assert';
import type { Browser, Frame, Page } from 'playwright-core';
import { chooseDepth, openSite, stable, until } from './support/site';

// A box that folds shrinks to nothing before it is hidden (media/panel.js, `fold`; media/panel.css keeps it drawn while it moves, `data-closing`),
// and one that unfolds grows. Every kind of fold is measured: the moves are paused half way (`currentTime`), so that no timer is raced.
// (A rule of the style sheet that hid a closing box at once went through unseen: the box had no motion left, and nothing measured it.)

/**
 * Runs in the panel's page. Clicks `click`, pauses the moves of the boxes `boxes` and returns what is drawn half way. `before` is each box's
 * height before the click. A 1px marker under the rows shows how far everything below moves: at rest before the click (\`rest\`), at the start
 * of the move, and a hair before its end, which \`END\` compares with the marker when the move has ended and the box is hidden or shown as
 * it is at rest (a box's margins that lie outside its height jump in or out there).
 */
const MID = `(async ([boxes, click]) => {
  const all = () => boxes.flatMap((s) => [...document.querySelectorAll(s)]);
  const height = (e) => e.getBoundingClientRect().height;
  if (!document.getElementById('mark')) document.getElementById('tree').insertAdjacentHTML('afterend', '<div id="mark" style="height:1px"></div>');
  const mark = () => document.getElementById('mark').getBoundingClientRect().top + scrollY;
  const before = all().map(height);
  const rest = mark();
  document.querySelector(click).click();
  const moving = all().map((b) => b.getAnimations());
  const total = moving.flat().map((a) => a.effect.getComputedTiming().duration);
  for (const a of moving.flat()) { a.pause(); a.currentTime = 0; }
  const start = mark();
  for (const a of moving.flat()) a.currentTime = a.effect.getComputedTiming().duration - 0.01;
  window.markEnd = mark();
  for (const a of moving.flat()) a.currentTime = a.effect.getComputedTiming().duration / 2;
  const markMid = mark();
  return all().map((b, i) => ({
    animations: moving[i].length, duration: moving[i][0]?.effect.getComputedTiming().duration ?? 0, display: getComputedStyle(b).display, visible: b.checkVisibility(),
    before: before[i], mid: height(b), closing: b.hasAttribute('data-closing'), open: b.closest('details')?.open ?? null, rest, start, markEnd: window.markEnd, markMid,
  }));
})`;

/** Runs in the panel's page. Lets the paused moves of the boxes end, and returns what is drawn after. */
const END = `(async ([boxes]) => {
  const all = boxes.flatMap((s) => [...document.querySelectorAll(s)]);
  for (const b of all) for (const a of b.getAnimations()) { a.play(); a.finish(); }
  // (The events of the ends, then the frame that follows them.)
  await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
  return all.map((b) => ({
    animations: b.getAnimations().length, display: getComputedStyle(b).display, visible: b.checkVisibility(), end: b.getBoundingClientRect().height,
    closing: b.hasAttribute('data-closing'), clip: b.style.clipPath, open: b.closest('details')?.open ?? null,
    markAfter: document.getElementById('mark').getBoundingClientRect().top + scrollY,
  }));
})`;

describe('the panel: boxes that fold and unfold move', function () {
  this.timeout(120000);
  let browser: Browser;
  let base = '';

  before(async function () {
    ({ browser, base } = await openSite(this));
  });

  type Options = { width?: number; animations?: boolean; reducedMotion?: 'reduce' | 'no-preference' };
  async function open(text: string, options: Options = {}, depth: 1 | 2 = 1): Promise<{ page: Page; panel: Frame; close: () => Promise<void> }> {
    const ctx = await browser.newContext({ viewport: { width: options.width ?? 1280, height: 800 }, locale: 'en-US', reducedMotion: options.reducedMotion ?? 'no-preference' });
    if (options.animations === false) await ctx.addInitScript(`try { localStorage.setItem('bash-explainer-settings', JSON.stringify({ 'bashExplainer.panel.animations': false })); } catch {}`);
    const page = await ctx.newPage();
    await page.goto(base);
    const panelOf = (): Frame | undefined => page.frames().find((f) => f.url().endsWith('/panel.html'));
    await until('the panel', () => Promise.resolve(panelOf()), (f) => !!f);
    await page.locator('.cm-content').focus();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText(text);
    await page.keyboard.press('Control+Home');
    const panel = panelOf()!;
    await until('the line explained', async () => (await panel.locator('#line').textContent()) ?? '', (t) => t.includes(text.slice(0, 6)));
    if (depth === 2) {
      await chooseDepth(page, 2);
      await until('depth 2', () => panel.evaluate('document.body.dataset.depth'), (d) => d === '2');
    }
    // (The rows are drawn again when the page learns more of the line: wait until they have not been drawn again for half a second.)
    await panel.evaluate(`window.drawn = 0; new MutationObserver(() => { window.drawn++; }).observe(document.getElementById('tree'), { childList: true })`);
    await stable('the rows', () => panel.evaluate('window.drawn'), 12);
    // (Nothing moves yet: the first drawing of the rows has ended.)
    await until('no motion', () => panel.evaluate('document.getAnimations().filter((a) => a.playState === "running").length'), (n) => n === 0);
    return { page, panel, close: () => ctx.close() };
  }

  type Mid = { markMid: number; animations: number; duration: number; rest: number; start: number; markEnd: number; display: string; visible: boolean; before: number; mid: number; closing: boolean; open: boolean | null };
  type End = { markAfter: number; animations: number; display: string; visible: boolean; end: number; closing: boolean; clip: string; open: boolean | null };
  const mid = (panel: Frame, boxes: string[], click: string) => panel.evaluate(`${MID}(${JSON.stringify([boxes, click])})`) as Promise<Mid[]>;
  const end = (panel: Frame, boxes: string[]) => panel.evaluate(`${END}(${JSON.stringify([boxes])})`) as Promise<End[]>;

  /** The parts of the first row that has some: its box, and its twisty. */
  const LOOP = 'for f in *.txt; do\n  wc -l "$f"\ndone';
  const PARTS = '#tree > li > .item > .body > ul';
  const TWISTY = '#tree > li > .item > .row > button.twisty';

  const shape = (e: End) => ({ ...e, end: 0, markAfter: 0 });
  /** How far a move of a box jumps what lies below it, at its start and at its end (px): a box's margins that lie outside its height would. */
  function noJump(m: Mid, after: End, limit: number, what: string): void {
    assert.ok(Math.abs(m.start - m.rest) <= limit, `${what}: at the start of the move, what lies below moved by ${m.start - m.rest}`);
    assert.ok(Math.abs(after.markAfter - m.markEnd) <= limit, `${what}: at the end of the move, what lies below moved by ${after.markAfter - m.markEnd}`);
  }
  /** What a box of this height (px) takes to move (ms): `motionMs` in media/panel.js. */
  const takes = (height: number) => Math.min(400, Math.max(220, Math.round(120 + height / 2)));

  /** A box that is drawn half way: neither hidden nor at its full height nor at nothing. */
  function drawnHalf(m: Mid, what: string): void {
    assert.strictEqual(m.animations, 1, `${what}: one move`);
    assert.notStrictEqual(m.display, 'none', `${what}: drawn`);
    assert.strictEqual(m.visible, true, `${what}: visible`);
    assert.ok(m.mid > 0, `${what}: higher than nothing (${m.mid})`);
  }

  it('a row\'s twisty: folding shrinks the parts to nothing and hides them; unfolding grows them', async () => {
    const { panel, close } = await open(LOOP);
    const [full] = (await panel.evaluate(`[document.querySelector(${JSON.stringify(PARTS)}).getBoundingClientRect().height]`)) as number[];
    assert.ok(full > 0);
    const [fold] = await mid(panel, [PARTS], TWISTY);
    drawnHalf(fold, 'folding');
    assert.strictEqual(fold.before, full);
    assert.ok(fold.mid < full, `folding: lower than the full height (${fold.mid} of ${full})`);
    assert.strictEqual(fold.closing, true);
    const [folded] = await end(panel, [PARTS]);
    // (The parts of a row lie between margins that do not meet once they are drawn; what is left of them is under 3 px, before it was 4.8.)
    noJump(fold, folded, 3, 'folding the parts');
    assert.strictEqual(fold.duration, takes(full), 'a tall box takes longer');
    assert.deepStrictEqual(shape(folded), { animations: 0, display: 'none', visible: false, end: 0, markAfter: 0, closing: false, clip: '', open: null });
    assert.strictEqual(await panel.locator(TWISTY).getAttribute('aria-expanded'), 'false');

    const [unfold] = await mid(panel, [PARTS], TWISTY);
    drawnHalf(unfold, 'unfolding');
    const [unfolded] = await end(panel, [PARTS]);
    noJump(unfold, unfolded, 3, 'unfolding the parts');
    assert.ok(unfold.mid < unfolded.end, `unfolding: lower than the full height (${unfold.mid} of ${unfolded.end})`);
    assert.strictEqual(unfolded.end, full);
    assert.deepStrictEqual(shape(unfolded), { animations: 0, display: 'block', visible: true, end: 0, markAfter: 0, closing: false, clip: '', open: null });
    await close();
  });

  for (const width of [1280, 390]) it(`a tall row's twisty, ${width} px: the parts move for as long as their height asks, and nothing below them jumps by more than the gap between two rows`, async () => {
    const { panel, close } = await open("ps aux | grep nginx | awk '{print $2}'", { width });
    const full = (await panel.evaluate(`document.querySelector(${JSON.stringify(PARTS)}).getBoundingClientRect().height`)) as number;
    assert.ok(full > 300, `a tall box (${full})`);
    const [fold] = await mid(panel, [PARTS], TWISTY);
    drawnHalf(fold, 'folding');
    const [folded] = await end(panel, [PARTS]);
    // (Before, the margins of the first row lay outside the parts: 4.8 px jumped away at the end. What is left, 2.4 px, is the margin of the row above, which no longer meets the next one's.)
    noJump(fold, folded, 2.5, 'folding the tall parts');
    assert.strictEqual(fold.duration, takes(full));
    const [unfold] = await mid(panel, [PARTS], TWISTY);
    const [unfolded] = await end(panel, [PARTS]);
    noJump(unfold, unfolded, 2.5, 'unfolding the tall parts');
    assert.strictEqual(unfold.duration, takes(unfolded.end));
    await close();
  });

  // The line of the maintainer's report: the row of `sort` holds an example (open, not folded) and its parts; `+%F` of `date` too.
  const LINE = 'grep -rn "ERROR $USER" ./src 2>&1 | sort -u > errors.txt && echo "done: $(date +%F)" || exit 1';
  /** The boxes a row folds: its parts, and the example that lies under it. */
  const under = (path: string) => [`#tree li[data-path="${path}"] > .item > .body > ul`, `#tree li[data-path="${path}"] > .item > .body > section.example`];
  const twistyOf = (path: string) => `#tree li[data-path="${path}"] > .item > .row > button.twisty`;

  for (const [depth, path] of [[1, '0.0.1'], [2, '0.0.2'], [1, '0.1.0.0.0.0']] as const) {
    it(`a row that holds an example folds the example with its parts: the line of the report, the row ${path} at depth ${depth}`, async () => {
      const { panel, close } = await open(LINE, {}, depth);
      const boxes = under(path);
      const [parts, example] = await mid(panel, boxes, twistyOf(path));
      for (const [m, what] of [[parts, 'the parts'], [example, 'the example']] as const) {
        drawnHalf(m, `folding ${what}`);
        assert.ok(m.mid < m.before, `${what}: lower than before (${m.mid} of ${m.before})`);
        assert.strictEqual(m.closing, true);
      }
      assert.ok(example.before > 100, `a tall example (${example.before})`);
      // (They move side by side, for as long as both are high: before, the example was gone in the first frame, 270 px at once.)
      assert.strictEqual(parts.duration, example.duration);
      assert.strictEqual(example.duration, takes(parts.before + example.before));
      // (The margins of the example and of the parts, drawn side by side, no longer meet: up to 3.5 px at the start; before, the whole example, 270 px.)
      assert.ok(Math.abs(parts.start - parts.rest) <= 3.5, `the start of the move: what lies below moved by ${parts.start - parts.rest}`);
      const folded = await end(panel, boxes);
      assert.ok(parts.markMid < parts.rest && parts.markMid > folded[0].markAfter, `half way: ${folded[0].markAfter} < ${parts.markMid} < ${parts.rest}`);
      // (What lies below has moved by about half of the height the row loses, after the ease: more than a tenth and less than nine tenths.)
      const lost = parts.rest - folded[0].markAfter;
      assert.ok(lost > parts.before + example.before - 5, `the row loses its parts and its example (${lost})`);
      assert.ok(parts.rest - parts.markMid > lost / 10 && parts.rest - parts.markMid < (lost * 9) / 10, `half way, what lies below has moved by ${parts.rest - parts.markMid} of ${lost}`);
      noJump(parts, folded[0], 3.5, 'folding the row');
      for (const m of folded) assert.deepStrictEqual(shape(m), { animations: 0, display: 'none', visible: false, end: 0, markAfter: 0, closing: false, clip: '', open: null });
      // Unfolded again, both grow.
      const [grow, growEx] = await mid(panel, boxes, twistyOf(path));
      drawnHalf(grow, 'unfolding the parts');
      drawnHalf(growEx, 'unfolding the example');
      const unfolded = await end(panel, boxes);
      noJump(grow, unfolded[0], 3.5, 'unfolding the row');
      assert.strictEqual(unfolded[1].end, example.before);
      assert.strictEqual(unfolded[0].markAfter, parts.rest);
      await close();
    });
  }

  it('the fold button on the line of the report folds the examples with their rows', async () => {
    const { panel, close } = await open(LINE, {}, 1);
    const outer = [under('0.0')[0], under('0.1')[0]];
    const boxes = [...outer, ...under('0.0.1'), ...under('0.1.0.0.0.0')];
    const ms = await mid(panel, boxes, '#toggle');
    ms.forEach((m, i) => {
      assert.notStrictEqual(m.display, 'none', `box ${i}: drawn`);
      assert.strictEqual(m.closing, true, `box ${i}: kept drawn`);
    });
    // (Only the outermost box of a branch moves: the parts of `grep | sort` and of `echo` carry the rows inside them, with the examples of `sort` and `+%F`.)
    assert.deepStrictEqual(ms.map((m) => m.animations), [1, 1, 0, 0, 0, 0]);
    for (const m of ms.slice(0, 2)) assert.ok(m.mid > 0 && m.mid < m.before, `${m.mid} of ${m.before}`);
    // (Each outermost box that folds, two here, holds the margins of its first and last rows: up to 5 px each at the start; before, the examples of 270 and 180 px.)
    assert.ok(Math.abs(ms[0].start - ms[0].rest) <= 10, `the start of the fold: what lies below moved by ${ms[0].start - ms[0].rest}`);
    const folded = await end(panel, boxes);
    for (const m of folded) assert.deepStrictEqual(shape(m), { animations: 0, display: 'none', visible: false, end: 0, markAfter: 0, closing: false, clip: '', open: null });
    // (The same, about 9 px for each of the two boxes, at the end: the margins of their rows, which meet once the boxes are gone.)
    assert.ok(Math.abs(folded[0].markAfter - ms[0].markEnd) <= 20, `the end of the fold: what lies below moved by ${folded[0].markAfter - ms[0].markEnd}`);
    assert.ok(ms[0].rest - folded[0].markAfter > 700, 'the examples and the parts are all gone');
    await close();
  });

  it('a fold, an unfold and a fold within one frame leave the boxes moving: the late end of the first two clears nothing of the third', async () => {
    const { panel, close } = await open(LINE, {}, 1);
    const boxes = under('0.0.1');
    const state = await panel.evaluate(`(async ([boxes, twisty]) => {
      const all = boxes.map((s) => document.querySelector(s));
      for (let i = 0; i < 3; i++) document.querySelector(twisty).click();
      // (Paused, so that nothing ends; the cancelled moves end a frame later.)
      for (const b of all) for (const a of b.getAnimations()) { a.pause(); a.currentTime = 100; }
      await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
      return all.map((b) => ({ animations: b.getAnimations().length, display: getComputedStyle(b).display, inline: b.style.display, clip: b.style.clipPath !== '', closing: b.hasAttribute('data-closing'), height: b.getBoundingClientRect().height }));
    })`
      + `(${JSON.stringify([boxes, twistyOf('0.0.1')])})`) as { animations: number; display: string; inline: string; clip: boolean; closing: boolean; height: number }[];
    for (const b of state) {
      assert.deepStrictEqual({ ...b, height: b.height > 0 }, { animations: 1, display: 'flow-root', inline: 'flow-root', clip: true, closing: true, height: true });
    }
    await close();
  });

  it('folded, then unfolded half way: the parts grow again from where they were, and stay drawn', async () => {
    const { panel, close } = await open(LOOP);
    const [full] = (await panel.evaluate(`[document.querySelector(${JSON.stringify(PARTS)}).getBoundingClientRect().height]`)) as number[];
    const [fold] = await mid(panel, [PARTS], TWISTY);
    drawnHalf(fold, 'folding');
    // (The twisty is clicked again while the parts shrink.)
    const [back] = await mid(panel, [PARTS], TWISTY);
    drawnHalf(back, 'back');
    assert.ok(back.mid >= fold.mid && back.mid < full, `grows from ${fold.mid} towards ${full}: ${back.mid}`);
    const [after] = await end(panel, [PARTS]);
    assert.strictEqual(after.end, full);
    assert.deepStrictEqual(shape(after), { animations: 0, display: 'block', visible: true, end: 0, markAfter: 0, closing: false, clip: '', open: null });
    await close();
  });

  /** Scripts with rows below the top level that have parts, and the depth to look at them. A box inside another one that folds has no move of its own. */
  const NESTED: [string, 1 | 2][] = [[LOOP, 2], ['if [[ -f config.ini && $DEBUG == 1 ]]; then source config.ini; fi', 1], ['if [[ -f config.ini && $DEBUG == 1 ]]; then source config.ini; fi', 2], ['backup="${HOME}/backup-$(date +%F).tar.gz"', 2]];
  for (const [text, depth] of NESTED) {
    it(`the fold button: the boxes it unfolds grow, and the boxes it folds shrink, then are hidden (${JSON.stringify(text.slice(0, 20))}, depth ${depth})`, async () => {
      const { panel, close } = await open(text, {}, depth);
      const paths = (await panel.evaluate(`[...document.querySelectorAll('#tree li')].filter((li) => li.parentElement.id !== 'tree' && li.querySelector(':scope > .item > .body > ul')).map((li) => li.dataset.path)`)) as string[];
      assert.ok(paths.length >= 1, 'rows below the top level have parts');
      const sel = paths.map((p) => `#tree li[data-path="${p}"] > .item > .body > ul`);
      const unfold = async () => {
        const half = await mid(panel, sel, '#toggle');
        assert.ok(half.some((m) => m.animations > 0));
        for (const m of half) assert.strictEqual(m.visible, true, 'drawn');
        const done = await end(panel, sel);
        half.forEach((m, i) => {
          if (m.animations) drawnHalf(m, 'unfolding');
          if (m.animations) assert.ok(m.mid < done[i].end, `unfolding: lower than the full height (${m.mid} of ${done[i].end})`);
          assert.deepStrictEqual(shape(done[i]), { animations: 0, display: 'block', visible: true, end: 0, markAfter: 0, closing: false, clip: '', open: null });
        });
      };
      const fold = async () => {
        const half = await mid(panel, sel, '#toggle');
        assert.ok(half.some((m) => m.animations > 0));
        half.forEach((m, i) => {
          assert.strictEqual(m.visible, true, `box ${i}: drawn`);
          assert.strictEqual(m.closing, true, `box ${i}: kept drawn`);
          if (!m.animations) return;
          drawnHalf(m, 'folding');
          assert.ok(m.mid < m.before, `folding: lower than the full height (${m.mid} of ${m.before})`);
        });
        for (const m of await end(panel, sel)) assert.deepStrictEqual(shape(m), { animations: 0, display: 'none', visible: false, end: 0, markAfter: 0, closing: false, clip: '', open: null });
      };
      // (The button unfolds when something is folded, else folds: at depth 2 the rows whose parts all come at depth 2 start folded.)
      if (await panel.evaluate(`document.querySelector('#tree li.collapsed') !== null`)) { await unfold(); await fold(); } else { await fold(); await unfold(); }
      await close();
    });
  }

  for (const width of [1280, 390]) it(`a folded example opens and closes with motion, ${width} px: the body is drawn half way, nothing below it jumps, and the closed box hides it`, async () => {
    const { panel, close } = await open("ps aux | grep nginx | awk '{print $2}'", { width });
    const body = 'details.whole-line > .fold-body';
    const [opening] = await mid(panel, [body], 'details.whole-line > summary');
    drawnHalf(opening, 'opening');
    assert.strictEqual(opening.open, true);
    const [opened] = await end(panel, [body]);
    noJump(opening, opened, 0.5, 'opening the example');
    assert.strictEqual(opening.duration, takes(opened.end), 'a tall example takes longer');
    assert.ok(opening.duration > 220 && opening.duration < 400, `${opening.duration} ms`);
    assert.ok(opening.mid < opened.end);
    assert.deepStrictEqual(shape(opened), { animations: 0, display: 'flow-root', visible: true, end: 0, markAfter: 0, closing: false, clip: '', open: true });
    const [closing] = await mid(panel, [body], 'details.whole-line > summary');
    drawnHalf(closing, 'closing');
    assert.ok(closing.mid < closing.before, `lower than before (${closing.mid} of ${closing.before})`);
    assert.strictEqual(closing.open, true, 'still open while it shrinks');
    const [closed] = await end(panel, [body]);
    noJump(closing, closed, 0.5, 'closing the example');
    assert.strictEqual(closing.duration, opening.duration, 'closes as long as it opens');
    assert.deepStrictEqual(shape(closed), { animations: 0, display: 'flow-root', visible: false, end: 0, markAfter: 0, closing: false, clip: '', open: false });
    await close();
  });

  it('the steps of a word, and the "more" of a problem, open and close with motion', async () => {
    for (const [text, depth, box] of [['echo "failed" "$a" $((1 + 2))', 2, 'details.steps > .fold-body'], ['echo $((09))', 1, 'details.problem-more > .fold-body']] as const) {
      const { panel, close } = await open(text, {}, depth);
      const click = box.replace(' > .fold-body', ' > summary');
      const [opening] = await mid(panel, [box], click);
      drawnHalf(opening, `${box} opening`);
      const [opened] = await end(panel, [box]);
      noJump(opening, opened, 0.5, `${box} opening`);
      assert.ok(opening.mid < opened.end);
      assert.strictEqual(opened.open, true);
      const [closing] = await mid(panel, [box], click);
      drawnHalf(closing, `${box} closing`);
      assert.ok(closing.mid < closing.before, `${box}: lower than before (${closing.mid} of ${closing.before})`);
      const [closed] = await end(panel, [box]);
      noJump(closing, closed, 0.5, `${box} closing`);
      assert.strictEqual(closed.open, false);
      assert.strictEqual(closed.visible, false);
      await close();
    }
  });

  for (const [what, options] of [['`panel.animations` is off', { animations: false }], ['the system asks for reduced motion', { reducedMotion: 'reduce' }]] as const) {
    it(`folds and unfolds at once when ${what}`, async () => {
      const { panel, close } = await open(LOOP, options);
      // (The same turn as the click: nothing has had a frame to move in.)
      const now = (click: string) => panel.evaluate(`(() => {
        const box = document.querySelector(${JSON.stringify(PARTS)});
        document.querySelector(${JSON.stringify(click)}).click();
        return { animations: document.getAnimations().length, display: getComputedStyle(box).display, closing: box.hasAttribute('data-closing') };
      })()`);
      assert.deepStrictEqual(await now(TWISTY), { animations: 0, display: 'none', closing: false });
      assert.deepStrictEqual(await now(TWISTY), { animations: 0, display: 'block', closing: false });
      await close();
    });
  }
});
