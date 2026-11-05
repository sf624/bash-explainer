// The reader's place in the page's editor while the settings open and close beside it (docs/design/chrome-redesign.md, "The place
// across a rewrap"), measured on each frame in headless Chromium: what is read is what that frame draws.
import * as assert from 'assert';
import type { Browser, Page } from 'playwright-core';
import { classicScrollbars, cursorToLine, openSite, stable, until } from './support/site';

/** The probe: which row is the place (the rule of src/ui/editorPlace.ts, read again from what is drawn), and a sample per frame. */
const PROBE = `(() => {
  const scroller = () => document.querySelector('.cm-scroller');
  const firstChar = (line, from = 0) => {
    const walk = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    let skip = from;
    for (let t = walk.nextNode(); t; t = walk.nextNode()) {
      if (skip >= t.data.length) { skip -= t.data.length; continue; }
      const r = document.createRange();
      r.setStart(t, skip);
      r.setEnd(t, skip + 1);
      return r.getClientRects()[0];
    }
  };
  const lines = () => [...document.querySelectorAll('.cm-line')];
  window.place = {
    /** Whether the first row of the cursor's line lies whole in the view. */
    cursor() {
      const line = document.querySelector('.cm-activeLine');
      const b = line && (firstChar(line) ?? line.getBoundingClientRect());
      const s = scroller().getBoundingClientRect();
      return !!b && b.top >= s.top && b.bottom <= s.bottom;
    },
    /** Marks the row to follow: the cursor's (at the start of its line), or the first that shows. */
    mark(kind, column = 0) {
      const top = scroller().getBoundingClientRect().top;
      let line = document.querySelector('.cm-activeLine');
      let text = line?.textContent ?? '';
      let from = column < 0 ? text.length + column : column;
      if (kind !== 'cursor') {
        // The first character that is not a blank whose box reaches below the top of the view.
        const spot = lines().flatMap((l) => [...l.textContent].map((ch, k) => ({ l, ch, k }))).find(({ l, ch, k }) => /\\S/.test(ch) && firstChar(l, k)?.bottom > top + 1);
        ({ l: line, k: from } = spot);
        text = line.textContent;
      }
      window.place.row = { text, from, y: (firstChar(line, from) ?? line.getBoundingClientRect()).top, height: line.getBoundingClientRect().height };
      return window.place.read();
    },
    read() {
      const row = window.place.row;
      const same = lines().filter((l) => l.textContent === row.text);
      let best = null;
      for (const l of same) {
        const c = firstChar(l, row.from) ?? l.getBoundingClientRect();
        if (c && (!best || Math.abs(c.top - row.y) < Math.abs(best.c.top - row.y))) best = { l, c };
      }
      const box = scroller();
      const at = best ? { y: best.c.top, height: best.l.getBoundingClientRect().height } : { y: null, height: null };
      row.y = at.y ?? row.y;
      return { ...at, scroll: box.scrollTop, left: box.scrollLeft, sheet: document.getElementById('settings-dialog').getBoundingClientRect().left, bottom: box.getBoundingClientRect().bottom };
    },
    /** The marked character's box. */
    char() {
      const row = window.place.row;
      return firstChar(lines().find((l) => l.textContent === row.text), row.from);
    },
    /**
     * Samples each frame, what it is about to draw, until \`stop\`: in a ResizeObserver, which runs after the frame's callbacks and
     * its layout and before its paint (a box given a new size in each frame's callback makes it run).
     */
    start() {
      const out = [];
      const box = document.createElement('div');
      box.style.cssText = 'position: fixed; left: -10px; top: 0; height: 1px; width: 1px';
      document.body.append(box);
      let size = 1;
      let request = 0;
      const seen = new ResizeObserver(() => out.push(window.place.read()));
      seen.observe(box);
      const tick = () => {
        size = 3 - size;
        box.style.width = size + 'px';
        request = requestAnimationFrame(tick);
      };
      request = requestAnimationFrame(tick);
      window.place.stop = () => {
        cancelAnimationFrame(request);
        seen.disconnect();
        box.remove();
        return out;
      };
    },
  };
})()`;

interface Sample { y: number | null; height: number | null; scroll: number; left: number; sheet: number; bottom: number }

/** The scroll, at rest. */
const scrollStill = (page: Page) => stable('the scroll', () => page.evaluate("document.querySelector('.cm-scroller').scrollTop") as Promise<number>);

/** Waits for text just typed to have its marks: the tree that brings them trails the typing, and they can change the rows. */
const rowsStill = (page: Page) => stable('the rows', () => page.evaluate("document.querySelector('.cm-content').offsetHeight") as Promise<number>, 40);

/** Puts the cursor on `line` and waits for the editor to have scrolled to it. */
async function cursorAt(page: Page, line: number): Promise<void> {
  await cursorToLine(page, line);
  await scrollStill(page);
}

/** Runs `use` on the page at `width`, and closes it whatever happens: a page left open keeps the site's server from closing. */
async function onPage(browser: Browser, base: string, width: number, use: (page: Page) => Promise<void>): Promise<void> {
  const ctx = await browser.newContext({ locale: 'en-US', viewport: { width, height: 720 } });
  try {
    const page = await ctx.newPage();
    await page.goto(base);
    await page.locator('.cm-line').first().waitFor();
    await page.evaluate(PROBE);
    await use(page);
  } finally {
    await ctx.close();
  }
}

const isOpen = (page: Page) => page.evaluate("document.getElementById('settings-dialog').open") as Promise<boolean>;

/** Runs the gear (or `act`) and samples each frame until the sheet and the editor have rested. */
async function motion(page: Page, act: () => Promise<void> = () => page.locator('#settings-open').click()): Promise<Sample[]> {
  const was = await isOpen(page);
  await page.evaluate('window.place.start()');
  await act();
  if (was !== await isOpen(page) || !was) await until('the sheet', () => isOpen(page), (v) => v !== was);
  await page.evaluate(`new Promise((done) => {
    const rest = () => !document.getElementById('settings-dialog').getAnimations().length && !document.getElementById('settings-dialog').classList.contains('moving');
    let quiet = 0;
    const look = () => { quiet = rest() ? quiet + 1 : 0; if (quiet > 20) done(); else requestAnimationFrame(look); };
    look();
  })`);
  return page.evaluate('window.place.stop()') as Promise<Sample[]>;
}

/** The farthest any frame's row lies from `from`, and from the frame before it; and how often the row's line changed height. */
function worst(frames: Sample[], from: number): { off: number; step: number; rewraps: number; samples: number } {
  let off = 0, step = 0, rewraps = 0, y = from;
  for (let i = 0; i < frames.length; i++) {
    const at = frames[i];
    assert.notStrictEqual(at.y, null, `the row is not drawn in frame ${i} of ${frames.length}`);
    off = Math.max(off, Math.abs(at.y! - from));
    step = Math.max(step, Math.abs(at.y! - y));
    y = at.y!;
    if (i && at.height !== frames[i - 1].height) rewraps++;
  }
  return { off, step, rewraps, samples: frames.length };
}

/** How far (in px) a row may lie from where it was. */
const ROWS = 1;
const report: string[] = [];
/** Where the page keeps its settings (web/storage.ts). */
const SETTINGS_KEY = 'bash-explainer-settings';

/** Opens and closes the sheet over a marked row, and holds both motions to it. Returns the worst values. */
async function roundTrip(page: Page, kind: 'cursor' | 'first', what: string, column = 0): Promise<void> {
  const before = await page.evaluate(`window.place.mark(${JSON.stringify(kind)}, ${column})`) as Sample;
  const opening = await motion(page);
  const open = worst(opening, before.y!);
  assert.ok(open.off <= ROWS, `${what}, open: ${JSON.stringify(open)} ${JSON.stringify(opening.map((f) => f.y))}`);
  assert.ok(open.rewraps <= 1, `${what}, open: ${JSON.stringify(open)}`);
  const closing = await motion(page);
  const shut = worst(closing, before.y!);
  assert.ok(shut.off <= ROWS, `${what}, close: ${JSON.stringify(shut)} ${JSON.stringify(closing.map((f) => f.y))}`);
  assert.ok(shut.rewraps <= 1, `${what}, close: ${JSON.stringify(shut)}`);
  const after = await page.evaluate('window.place.read()') as Sample;
  assert.ok(Math.abs(after.y! - before.y!) <= ROWS, `${what}: the row at ${before.y}, then at ${after.y}`);
  // (CodeMirror estimates the heights of lines it does not draw, and a round trip can change an estimate above the view: the
  // scroll then differs by that much, with the row in place.)
  assert.ok(Math.abs(after.scroll - before.scroll) <= 20, `${what}: the scroll at ${before.scroll}, then at ${after.scroll}`);
  report.push(`${what}: y ${before.y} open off ${open.off.toFixed(2)} (${open.samples} frames, ${open.rewraps} rewrap) close off ${shut.off.toFixed(2)} (${shut.samples} frames, ${shut.rewraps} rewrap) scroll ${before.scroll} -> ${after.scroll}`);
}

describe('the web page: the place in the editor beside the settings', function () {
  this.timeout(180000);
  let browser: Browser;
  let base = '';

  before(async function () {
    ({ browser, base } = await openSite(this));
  });

  after(() => {
    if (process.env.BASH_EXPLAINER_PLACE_REPORT) console.log(report.join('\n'));
  });

  for (const width of [1280, 1000, 768]) {
    it(`keeps the cursor's row on line 95 on every frame of the open and the close, at ${width} px`, async () => {
      await onPage(browser, base, width, async (page) => {
        await cursorAt(page, 95);
        assert.strictEqual(await page.evaluate('window.place.cursor()'), true);
        await roundTrip(page, 'cursor', `line 95 at ${width}`);
      });
    });

    it(`keeps the cursor's row on line 1 on every frame of the open and the close, at ${width} px`, async () => {
      await onPage(browser, base, width, async (page) => {
        await cursorAt(page, 1);
        await roundTrip(page, 'cursor', `line 1 at ${width}`);
      });
    });

    it(`keeps the first row that shows with the cursor off the screen, at ${width} px`, async () => {
      await onPage(browser, base, width, async (page) => {
        await cursorAt(page, 1);
        await page.evaluate("document.querySelector('.cm-scroller').scrollTop = 1500");
        const scrolled = await scrollStill(page);
        assert.strictEqual(await page.evaluate('window.place.cursor()'), false, `scrolled to ${scrolled}`);
        await roundTrip(page, 'first', `off screen at ${width}`);
      });
    });
  }

  /** Text for the editor, the cursor then on line `line`. */
  const typed = async (page: Page, text: string, line: number) => {
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText(text);
    await until('the text', () => page.evaluate("document.querySelector('.cm-lineNumbers .cm-activeLineGutter').textContent"), (n) => Number(n) >= line);
    await page.keyboard.press('Control+Home');
    for (let i = 1; i < line; i++) await page.keyboard.press('ArrowDown');
    await rowsStill(page);
  };
  const LONG_SCRIPT = Array.from({ length: 2000 }, (_, i) => `echo line${i} with some more words to wrap in the editor when it is narrower than it is now, word ${i * 7} and ${i * 13}`).join('\n') + '\n';

  it('keeps the place in a script of 2,000 lines, the cursor far down or off the screen', async () => {
    await onPage(browser, base, 1280, async (page) => {
      await page.locator('.cm-content').click();
      await page.keyboard.press('Control+A');
      await page.keyboard.insertText(LONG_SCRIPT.trimEnd());
      await rowsStill(page);
      // (Far down and at the end of the text: the lines above it are CodeMirror's estimates.)
      await page.evaluate("document.querySelector('.cm-scroller').scrollTop = document.querySelector('.cm-scroller').scrollHeight");
      await scrollStill(page);
      assert.strictEqual(await page.evaluate('window.place.cursor()'), true);
      await roundTrip(page, 'cursor', '2,000 lines, the last line', -1);
      await page.evaluate("document.querySelector('.cm-scroller').scrollTop = 20000");
      await scrollStill(page);
      assert.strictEqual(await page.evaluate('window.place.cursor()'), false);
      await roundTrip(page, 'first', '2,000 lines, the middle');
    });
  });

  it('keeps the place on a line wrapped in many rows, whichever row of it shows first', async () => {
    await onPage(browser, base, 1280, async (page) => {
      const huge = `echo ${Array.from({ length: 900 }, (_, i) => `word${i}`).join(' ')}`;
      await typed(page, `# before\n${'# some line\n'.repeat(20)}${huge}`, 22);
      await page.keyboard.press('Control+End');
      await scrollStill(page);
      // The cursor at the end of the line, which moves far as the rows above it in that line grow.
      await roundTrip(page, 'cursor', 'many rows, the cursor at the end of the line', -1);
      // The first row in the middle of that line.
      await page.evaluate(`(() => {
        const box = document.querySelector('.cm-scroller');
        box.scrollTop += document.querySelector('.cm-activeLine').getBoundingClientRect().top - box.getBoundingClientRect().top + 500;
      })()`);
      await scrollStill(page);
      await roundTrip(page, 'first', 'many rows, the first row inside the line');
    });
  });

  it('keeps the place the reader has now, when they scrolled or moved the cursor with the sheet open', async () => {
    await onPage(browser, base, 1280, async (page) => {
      await cursorAt(page, 95);
      await page.evaluate("window.place.mark('cursor')");
      await motion(page);
      // A wheel over the editor: the first row that shows is the place from here on.
      const box = (await page.locator('.cm-scroller').boundingBox())!;
      await page.mouse.move(box.x + 100, box.y + 100);
      await page.mouse.wheel(0, -400);
      await scrollStill(page);
      const wheeled = await page.evaluate('window.place.cursor()');
      const held = await page.evaluate(`window.place.mark(${JSON.stringify(wheeled ? 'cursor' : 'first')})`) as Sample;
      const closing = worst(await motion(page), held.y!);
      assert.ok(closing.off <= ROWS, `scrolled: ${JSON.stringify(closing)}`);
      // The cursor moved with the sheet open.
      await cursorAt(page, 40);
      await page.evaluate("window.place.mark('cursor')");
      await motion(page);
      await page.locator('.cm-content').focus();
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowDown');
      await scrollStill(page);
      const moved = await page.evaluate("window.place.mark('cursor')") as Sample;
      const shut = worst(await motion(page), moved.y!);
      assert.ok(shut.off <= ROWS, `moved: ${JSON.stringify(shut)}`);
    });
  });

  it('lets typing go on in the editor beside the open sheet, and keeps the cursor there', async () => {
    await onPage(browser, base, 1000, async (page) => {
      await cursorAt(page, 60);
      await page.evaluate("window.place.mark('cursor')");
      await motion(page);
      await page.locator('.cm-content').focus();
      await page.keyboard.insertText('x');
      await page.keyboard.press('Home');
      await scrollStill(page);
      assert.ok(((await page.locator('.cm-activeLine').textContent()) ?? '').includes('x'));
      assert.strictEqual(await page.evaluate("document.querySelector('.cm-content').matches(':focus')"), true);
      const typedAt = await page.evaluate("window.place.mark('cursor')") as Sample;
      const shut = worst(await motion(page), typedAt.y!);
      assert.ok(shut.off <= ROWS, `typed: ${JSON.stringify(shut)}`);
    });
  });

  it('keeps the place with reduced motion, where the sheet is there or gone at once', async () => {
    await onPage(browser, base, 1280, async (page) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await cursorAt(page, 95);
      await roundTrip(page, 'cursor', 'reduced motion, line 95');
    });
  });

  it('keeps the place with classic scrollbars, which take room, in the narrowest layout that has the column', async function () {
    const classic = await classicScrollbars(this);
    await onPage(classic, base, 768, async (page) => {
      await cursorAt(page, 95);
      await roundTrip(page, 'cursor', 'classic scrollbars, line 95 at 768');
    });
  });

  it('keeps the place without wrapping, the cursor shown at the side, and the sideways scroll back on the close', async () => {
    await onPage(browser, base, 1280, async (page) => {
      await page.evaluate(`localStorage.setItem(${JSON.stringify(SETTINGS_KEY)}, JSON.stringify({ 'bashExplainer.editor.wrap': false }))`);
      await page.reload();
      await page.locator('.cm-line').first().waitFor();
      await page.evaluate(PROBE);
      await typed(page, `${'# some line\n'.repeat(30)}echo ${'word '.repeat(60)}\n${'# some line\n'.repeat(30)}`, 31);
      assert.strictEqual(await page.evaluate("document.querySelector('.cm-content').classList.contains('cm-lineWrapping')"), false);
      // At a column that shows now and that the narrower editor would hide.
      await page.keyboard.press('Home');
      for (let i = 0; i < 60; i++) await page.keyboard.press('ArrowRight');
      const col = await page.evaluate("window.place.mark('cursor', 59)") as Sample;
      const shown = () => page.evaluate(`(() => {
        const s = document.querySelector('.cm-scroller').getBoundingClientRect();
        const c = window.place.char();
        return { shown: c.left >= s.left && c.right <= s.right, y: c.top, left: document.querySelector('.cm-scroller').scrollLeft };
      })()`) as Promise<{ shown: boolean; y: number; left: number }>;
      const before = await stable('the cursor', shown);
      assert.strictEqual(before.shown, true);
      await page.locator('#settings-open').click();
      await until('open', () => isOpen(page), (v) => v);
      const opened = await stable('the cursor', shown);
      assert.strictEqual(opened.shown, true, JSON.stringify(opened));
      assert.ok(Math.abs(opened.y - col.y!) <= ROWS, JSON.stringify(opened));
      await page.locator('#settings-open').click();
      await until('closed', () => isOpen(page), (v) => !v);
      const shut = await stable('the cursor', shown);
      assert.ok(Math.abs(shut.y - col.y!) <= ROWS && Math.abs(shut.left - before.left) <= 1, `${JSON.stringify(before)} then ${JSON.stringify(shut)}`);
    });
  });

  // The cursor at `column` of the line, and a wheel of `wheel` px beside the open sheet: it stays in view at column 30 and 90 px,
  // and the scroll hides it in the others (5 px only brings it to the gutter's edge), where the close must not reveal it again.
  for (const width of [1280, 768]) {
    for (const [column, wheel, hidden] of [[30, 90, 'shown'], [0, 300, 'hidden'], [0, 5, 'edge'], [30, 600, 'hidden']] as const) {
      it(`keeps a sideways scroll made beside the open sheet, without wrapping, the cursor at column ${column}, a wheel of ${wheel} px, at ${width} px`, async () => {
        await onPage(browser, base, width, async (page) => {
          await page.evaluate(`localStorage.setItem(${JSON.stringify(SETTINGS_KEY)}, JSON.stringify({ 'bashExplainer.editor.wrap': false }))`);
          await page.reload();
          await page.locator('.cm-line').first().waitFor();
          await page.evaluate(PROBE);
          await typed(page, `${'# some line\n'.repeat(3)}echo ${'word '.repeat(80)}\n${'# some line\n'.repeat(3)}`, 4);
          await page.keyboard.press('Home');
          for (let i = 0; i < column; i++) await page.keyboard.press('ArrowRight');
          await scrollStill(page);
          await page.evaluate(`window.place.mark('cursor', ${column})`);
          const sideways = () => page.evaluate("document.querySelector('.cm-scroller').scrollLeft") as Promise<number>;
          const shown = () => page.evaluate(`(() => {
            const s = document.querySelector('.cm-scroller').getBoundingClientRect();
            const c = window.place.char();
            // (The gutter stays over the text's left side.)
            return c.left >= document.querySelector('.cm-gutters').getBoundingClientRect().right - 0.5 && c.right <= s.right;
          })()`) as Promise<boolean>;
          await page.locator('#settings-open').click();
          await until('open', () => isOpen(page), (v) => v);
          await stable('sideways', sideways);
          const box = (await page.locator('.cm-scroller').boundingBox())!;
          await page.mouse.move(box.x + 100, box.y + 40);
          await page.mouse.wheel(wheel, 0);
          const scrolled = await stable('sideways', sideways);
          assert.ok(scrolled >= wheel - 10, `scrolled to ${scrolled}`);
          if (hidden !== 'edge') assert.strictEqual(await shown(), hidden === 'shown', `the cursor at scroll ${scrolled}`);
          await page.locator('#settings-open').click();
          await until('closed', () => isOpen(page), (v) => !v);
          const after = await stable('sideways', sideways);
          assert.strictEqual(after, scrolled, `${scrolled}, then ${after}`);
        });
      });
    }
  }

  it('puts the row back where it was with classic scrollbars, when the narrow editor has a sideways scrollbar that the wide one lacks', async function () {
    const classic = await classicScrollbars(this);
    await onPage(classic, base, 1280, async (page) => {
      await page.evaluate(`localStorage.setItem(${JSON.stringify(SETTINGS_KEY)}, JSON.stringify({ 'bashExplainer.editor.wrap': false }))`);
      await page.reload();
      await page.locator('.cm-line').first().waitFor();
      await page.evaluate(PROBE);
      // Lines that fit the editor as it is (625 px wide) and not beside the sheet (412 px), the cursor on the bottom row, with lines under it (the close can give the row its 15 px back only if the text goes on).
      await typed(page, `${'# some line\n'.repeat(80)}echo ${'word '.repeat(11)}\n${'# some line\n'.repeat(30)}`, 81);
      await scrollStill(page);
      const bar = () => page.evaluate("(() => { const s = document.querySelector('.cm-scroller'); return s.offsetHeight - s.clientHeight; })()") as Promise<number>;
      assert.strictEqual(await bar(), 0, 'a sideways scrollbar in the wide editor');
      const before = await page.evaluate("window.place.mark('cursor')") as Sample;
      await page.locator('#settings-open').click();
      await until('open', () => isOpen(page), (v) => v);
      await scrollStill(page);
      const opened = await page.evaluate('window.place.read()') as Sample;
      assert.ok(await bar() > 0, 'no sideways scrollbar in the narrow editor');
      // The scrollbar takes 15 px from the view's height, so the row has to rise to stay in it.
      assert.ok(opened.y! + before.height! <= opened.bottom - 15 + 1 && opened.y! >= before.y! - 40, `the row at ${before.y}, then at ${opened.y}, the edge at ${opened.bottom}`);
      await page.locator('#settings-open').click();
      await until('closed', () => isOpen(page), (v) => !v);
      await scrollStill(page);
      const after = await page.evaluate('window.place.read()') as Sample;
      assert.ok(Math.abs(after.y! - before.y!) <= ROWS, `the row at ${before.y}, then at ${after.y}`);
    });
  });

  /** Where the cursor's row lies under the view's bottom edge, in px, after `lower` makes the view lower beside the sheet and the sheet closes. */
  const outsideAfter = async (page: Page, lower: () => Promise<void>): Promise<number> => {
    await cursorAt(page, 95);
    await page.evaluate("window.place.mark('cursor')");
    await motion(page);
    await lower();
    await scrollStill(page);
    await motion(page);
    await scrollStill(page);
    const at = await page.evaluate('window.place.read()') as Sample;
    assert.notStrictEqual(at.y, null, 'the row is not drawn');
    // (The row ends at the edge: the view's room is used, the row is not left far above it.)
    assert.ok(at.y! + 20 - at.bottom >= -2, `the row at ${at.y}, the edge at ${at.bottom}`);
    return at.y! + 20 - at.bottom;
  };

  it('does not put the cursor\'s row where the view has gone: the Problems list opened beside the sheet', async () => {
    await onPage(browser, base, 1280, async (page) => {
      const list = page.locator('#problems-toggle');
      if (await list.getAttribute('aria-expanded') === 'true') await list.click();
      const tall = (await page.locator('.cm-scroller').boundingBox())!.height;
      const outside = await outsideAfter(page, async () => {
        await list.click();
        const low = (await page.locator('.cm-scroller').boundingBox())!.height;
        assert.ok(low < tall - 100, `from ${tall} to ${low}`);
      });
      assert.ok(outside <= 1, `${outside} px under the edge`);
    });
  });

  it('does not put the cursor\'s row where the view has gone: a lower window', async () => {
    await onPage(browser, base, 1280, async (page) => {
      const outside = await outsideAfter(page, () => page.setViewportSize({ width: 1280, height: 560 }));
      assert.ok(outside <= 1, `${outside} px under the edge`);
    });
  });

  it('leaves F6 and the focus as they were', async () => {
    await onPage(browser, base, 1280, async (page) => {
      await cursorAt(page, 95);
      await page.evaluate("window.place.mark('cursor')");
      await motion(page);
      assert.strictEqual(await page.evaluate("document.getElementById('settings-dialog').contains(document.activeElement)"), true);
      const held = await page.evaluate('window.place.read()') as Sample;
      // F6 goes on from the sheet, and back to the editor, without moving it.
      for (let i = 0; i < 6 && !(await page.evaluate("document.querySelector('.cm-content').matches(':focus')")); i++) await page.keyboard.press('F6');
      assert.strictEqual(await page.evaluate("document.querySelector('.cm-content').matches(':focus')"), true);
      const back = await stable('the row', () => page.evaluate('window.place.read().y') as Promise<number>);
      assert.ok(Math.abs(back - held.y!) <= ROWS, `${held.y} then ${back}`);
    });
  });

  it('holds the place through the divider and a window resized beside the sheet, and comes back on the close', async () => {
    await onPage(browser, base, 1280, async (page) => {
      await cursorAt(page, 95);
      await page.evaluate("window.place.mark('cursor')");
      await motion(page);
      // Neither of these is the reader moving away: the cursor's line is still drawn, and the close goes on working.
      await page.setViewportSize({ width: 1100, height: 720 });
      await scrollStill(page);
      const box = (await page.locator('#splitter').boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + 100);
      await page.mouse.down();
      await page.mouse.move(box.x - 30, box.y + 100, { steps: 3 });
      await page.mouse.up();
      await scrollStill(page);
      await motion(page);
      assert.strictEqual(await isOpen(page), false);
      assert.strictEqual(await page.evaluate("document.querySelector('.cm-editor').hasAttribute('style')"), false);
    });
  });
});
