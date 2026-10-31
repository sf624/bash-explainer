// Long lines in the web page's editor wrap between shell words (web/word-wrap.ts, src/ui/wrapRuns.ts), and the hover
// cards go under the whole wrapped line (web/hover.ts, src/ui/cardPlace.ts): docs/design/chrome-redesign.md, C1a. In
// headless Chromium, at a phone's width and two desktop widths, in both languages (CI draws Japanese with its CJK
// fonts). Where a row ends depends on the font, so the tests check where rows may end (at the start of a run of the
// tree), not where they do.
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import type { Browser, Page } from 'playwright-core';
import type { Lang } from '../src/i18n';
import { openDocument } from '../src/document-setup';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { CARD_CAP, CARD_MIN } from '../src/ui/cardPlace';
import { wrapRuns } from '../src/ui/wrapRuns';
import { cursorToLine, openSite, until } from './support/site';

const sample = fs.readFileSync(path.join(__dirname, 'fixtures', 'sample.sh'), 'utf8');
/** Line 8 of the sample, which the design's screenshots wrap (0-based 7). */
const LINE = 7;
const parser = createUnbashParser();
/** Where a row may start on each line of a script: the start of a run. */
const runStarts = (text: string) => wrapRuns(openDocument(text, 'shell', (t) => parser.parse(t))).map((runs) => runs.map(([a]) => a));

/**
 * The rows of an editor line, as the column each starts at, from the layout (the tops of its characters), and the
 * marks ↪ of the line's gutter. Name hints (widgets) are left out of the columns.
 */
function rowsOf(page: Page, line: number): Promise<{ starts: number[]; marks: number; top: number; bottom: number }> {
  return page.evaluate(`((line) => {
    const el = document.querySelectorAll('.cm-content > .cm-line')[line];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const starts = [];
    let col = 0, last = -Infinity;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.parentElement.closest('[contenteditable="false"]')) continue;
      for (let i = 0; i < n.data.length; i++, col++) {
        if (n.data[i] === ' ') continue;
        const r = document.createRange();
        r.setStart(n, i);
        r.setEnd(n, i + 1);
        const top = r.getBoundingClientRect().top;
        if (top > last + 4) starts.push(col);
        last = Math.max(last, top);
      }
    }
    const box = el.getBoundingClientRect();
    const gutter = Array.from(document.querySelectorAll('.cm-bx-wrap-gutter .cm-gutterElement')).find((g) => {
      const b = g.getBoundingClientRect();
      return Math.abs(b.top - box.top) < 2 && b.height > 0;
    });
    return { starts, marks: gutter ? gutter.querySelectorAll('.cm-bx-wrapmarks > span').length : 0, top: box.top, bottom: box.bottom };
  })(${line})`);
}

/** Whether the editor scrolls sideways. */
const sideways = (page: Page) => page.evaluate("(() => { const s = document.querySelector('.cm-scroller'); return s.scrollWidth > s.clientWidth + 1; })()") as Promise<boolean>;

describe('the web page: long lines wrap between shell words, and hover cards go under the line', function () {
  this.timeout(240000);
  let browser: Browser;
  let base = '';
  before(async function () {
    ({ browser, base } = await openSite(this));
  });

  async function open(width: number, lang: Lang, height = 800): Promise<Page> {
    const phone = width < 520;
    const ctx = await browser.newContext({
      viewport: { width, height: phone ? 844 : height }, locale: lang === 'ja' ? 'ja-JP' : 'en-US',
      ...(phone ? { hasTouch: true, isMobile: true, deviceScaleFactor: 3 } : {}),
    });
    await ctx.addInitScript("try { localStorage.setItem('bash-explainer-read-tip-seen', '1'); } catch {}");
    const page = await ctx.newPage();
    await page.goto(base);
    await until('the sample', () => page.locator('.cm-content > .cm-line').count(), (n) => n > 20);
    // The runs come with the first tree.
    await until('the runs', () => page.locator('.cm-bx-run').count(), (n) => n > 0);
    return page;
  }

  const starts = runStarts(sample);
  const lines = sample.split('\n');
  /**
   * Whether a row of line `l` may start at column `s`, given the line's row starts `rows`: at the start of a run; after
   * a blank (inside a run too wide for a row, which breaks at its own blanks); or, as the last resort, inside a stretch
   * with no blank that started on an earlier row (wider than a row).
   */
  const mayStart = (l: number, s: number, rows: number[]) => {
    if (starts[l].includes(s) || lines[l][s - 1] === ' ') return true;
    const stretch = lines[l].lastIndexOf(' ', s) + 1;
    const i = rows.indexOf(s);
    return i > 0 && rows[i - 1] >= stretch;
  };
  for (const width of [390, 640, 1280]) {
    for (const lang of ['en', 'ja'] as const) {
      it(`wraps line 8 of the sample between its words, with ↪ on each row after the first, and no sideways scroll (${width} px, ${lang})`, async () => {
        const page = await open(width, lang);
        try {
          assert.strictEqual(await sideways(page), false);
          const rows = await rowsOf(page, LINE);
          if (width < 1000) assert.ok(rows.starts.length >= 2, `${width} px: line 8 wraps (${JSON.stringify(rows)})`);
          assert.strictEqual(rows.marks, rows.starts.length - 1, `the marks ↪ (${JSON.stringify(rows)})`);
          // Each word of line 8 fits on a row: its rows start at words.
          for (const s of rows.starts) assert.ok(starts[LINE].includes(s), `a row starts inside a word, at column ${s}: ${lines[LINE].slice(s, s + 20)}`);
          // Every line of the editor that wraps does so between runs, or inside a run too wide for a row.
          const drawn = await page.locator('.cm-content > .cm-line').count();
          for (let l = 0; l < Math.min(drawn, 40); l++) {
            const r = await rowsOf(page, l);
            for (const s of r.starts) assert.ok(mayStart(l, s, r.starts), `line ${l + 1}: a row starts at column ${s}: ${lines[l].slice(s, s + 20)}`);
          }
        } finally {
          await page.context().close();
        }
      });
    }
  }

  it('keeps the earlier rows of a wrapped line while typing at its end, before and after the next tree', async () => {
    const page = await open(1280, 'en');
    try {
      const before = await rowsOf(page, LINE);
      assert.ok(before.starts.length >= 2, JSON.stringify(before));
      // The cursor at the end of line 8: a click on its last word, then End (the end of the line's last row).
      const p = await pointAt(page, LINE, 'exit 1');
      await page.mouse.click(p.x, p.y);
      await page.keyboard.press('End');
      const added = ' && echo "one two three"';
      for (const w of added.split(/(?= )/)) await page.keyboard.insertText(w);
      const typed = await rowsOf(page, LINE);
      assert.deepStrictEqual(typed.starts.slice(0, before.starts.length), before.starts, 'while typing');
      await page.waitForTimeout(400);
      const after = await rowsOf(page, LINE);
      assert.deepStrictEqual(after.starts.slice(0, before.starts.length), before.starts, 'after the tree');
      assert.strictEqual(await page.locator('.cm-content > .cm-line').nth(LINE).evaluate((e) => e.textContent), lines[LINE] + added);
      // The new quoted word is one run once the tree has it.
      assert.strictEqual(await page.locator('.cm-content > .cm-line').nth(LINE).locator('.cm-bx-run', { hasText: '"one two three"' }).count(), 1);
    } finally {
      await page.context().close();
    }
  });

  it('marks only the lines in view: the work per key press does not grow with the script', async () => {
    const long = Array.from({ length: 2000 }, (_, i) => `echo "line ${i}" | grep -c "some words here" > /dev/null && printf '%s\\n' "$(date +%F) ${i}"`).join('\n');
    /** Types into a 2,000-line script: the lines marked per key press, and the time of each key press to the next frame (p50, p95). */
    const typing = async (page: Page) => {
      await page.locator('.cm-content').focus();
      await page.keyboard.press('Control+A');
      await page.keyboard.insertText(long);
      await page.waitForTimeout(800);
      const marked = () => page.evaluate("Number(document.querySelector('.cm-editor').dataset.wrapMarked || 0)") as Promise<number>;
      const start = await marked();
      // From the input event to after the next frame's layout and paint.
      await page.evaluate("window.__keyTimes = []; document.addEventListener('beforeinput', () => { const t = performance.now(); requestAnimationFrame(() => setTimeout(() => window.__keyTimes.push(performance.now() - t))); }, true)");
      const keys = 40;
      for (let i = 0; i < keys; i++) await page.keyboard.insertText('x');
      await page.waitForTimeout(400);
      const times = (await page.evaluate('window.__keyTimes') as number[]).sort((a, b) => a - b);
      assert.strictEqual(times.length, keys);
      return { perKey: ((await marked()) - start) / keys, p50: times[keys >> 1], p95: times[Math.floor(keys * 0.95)] };
    };
    const page = await open(1280, 'en');
    try {
      const on = await typing(page);
      const drawn = await page.locator('.cm-content > .cm-line').count();
      assert.ok(drawn < 200, `${drawn} lines drawn`);
      // Each key press marks the line it changed (and the tree that follows a few key presses, the lines in view once
      // more), never the lines in view on each key, nor the script.
      assert.ok(on.perKey <= 5, `${on.perKey} lines marked per key press, ${drawn} drawn`);
      // The time is reported beside the editor without the wrap (as on main), not checked: CI's machines vary.
      await page.evaluate("localStorage.setItem('bash-explainer-settings', JSON.stringify({ 'bashExplainer.editor.wrap': false }))");
      await page.reload();
      await until('the sample', () => page.locator('.cm-content > .cm-line').count(), (n) => n > 20);
      const off = await typing(page);
      console.log(`      (wrap on: ${on.perKey.toFixed(1)} lines marked per key press, ${drawn} drawn; to the next frame ${on.p50.toFixed(1)} ms, p95 ${on.p95.toFixed(1)} ms; off: ${off.p50.toFixed(1)} ms, p95 ${off.p95.toFixed(1)} ms)`);
    } finally {
      await page.context().close();
    }
  });

  /** The middle of the first character of `text` on an editor line, from the layout. */
  async function pointAt(page: Page, line: number, text: string, nth = 0): Promise<{ x: number; y: number }> {
    const p = await page.evaluate(`(([line, text, nth]) => {
      const el = document.querySelectorAll('.cm-content > .cm-line')[line];
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const nodes = [];
      for (let n = walker.nextNode(); n; n = walker.nextNode()) if (!n.parentElement.closest('[contenteditable="false"]')) nodes.push(n);
      let at = -1;
      for (let k = 0; k <= nth; k++) at = nodes.map((n) => n.data).join('').indexOf(text, at + 1);
      if (at < 0) return null;
      for (const n of nodes) {
        if (at < n.data.length) {
          const r = document.createRange();
          r.setStart(n, at);
          r.setEnd(n, at + 1);
          const b = r.getBoundingClientRect();
          return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
        }
        at -= n.data.length;
      }
      return null;
    })(${JSON.stringify([line, text, nth])})`) as { x: number; y: number } | null;
    assert.ok(p, `${JSON.stringify(text)} on line ${line + 1}`);
    return p;
  }

  const tip = (page: Page) => page.locator('.cm-tooltip-hover');
  const tipBox = async (page: Page) => (await until('the card', () => tip(page).boundingBox(), (b) => !!b && b.height > 20))!;

  for (const lang of ['en', 'ja'] as const) {
    it(`puts the card under the whole wrapped line, from each of its rows, no higher than the cap (${lang})`, async () => {
      // (At 1280 px the editor's pane is about 640 px wide: line 8 wraps, with room under it.)
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: lang === 'ja' ? 'ja-JP' : 'en-US' });
      const desk = await ctx.newPage();
      try {
        await desk.goto(base);
        await until('the runs', () => desk.locator('.cm-bx-run').count(), (n) => n > 0);
        const rows = await rowsOf(desk, LINE);
        assert.ok(rows.starts.length >= 2, JSON.stringify(rows));
        for (const [word, nth] of [['grep', 0], ['echo', 0], ['exit', 0]] as const) {
          await desk.mouse.move(5, 300);
          await until('no card', () => tip(desk).count(), (n) => n === 0);
          const p = await pointAt(desk, LINE, word, nth);
          await desk.mouse.move(p.x, p.y);
          const b = await tipBox(desk);
          const now = await rowsOf(desk, LINE);
          assert.ok(b.y >= now.bottom - 1, `${word}: the card's top ${b.y} is under the line's last row ${now.bottom}`);
          assert.ok(b.height <= Math.min(CARD_CAP, 400) + 1, `${word}: ${b.height} px high`);
          // At the part's x, unless that would put it past the pane's right edge.
          assert.ok(Math.abs(b.x - p.x) < 40 || b.x + b.width >= 600, `${word}: at x ${b.x}, the part at ${p.x}`);
        }
      } finally {
        await ctx.close();
      }
    });
  }

  it('keeps the card while the pointer crosses the line\'s later rows to it', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-US' });
    const page = await ctx.newPage();
    try {
      await page.goto(base);
      await until('the runs', () => page.locator('.cm-bx-run').count(), (n) => n > 0);
      const p = await pointAt(page, LINE, 'grep');
      await page.mouse.move(5, 300);
      await page.mouse.move(p.x, p.y);
      const b = await tipBox(page);
      const text = await tip(page).innerText();
      // Down through the line's later rows, over their words, to the card, in a few steps.
      const rows = await rowsOf(page, LINE);
      const target = { x: b.x + 30, y: b.y + 20 };
      for (let i = 1; i <= 8; i++) await page.mouse.move(p.x + ((target.x - p.x) * i) / 8, p.y + ((target.y - p.y) * i) / 8);
      await page.waitForTimeout(800);
      assert.strictEqual(await tip(page).count(), 1, 'the card stayed');
      assert.strictEqual(await tip(page).innerText(), text, 'the same card');
      assert.ok(rows.bottom <= b.y + 1);
      // Moving away from the card (up, off the line) closes it.
      await page.mouse.move(5, 5);
      await until('closed', () => tip(page).count(), (n) => n === 0);
    } finally {
      await ctx.close();
    }
  });

  /** A page of 1280 px (800 high unless said), the sample's line 8 wrapped, the pointer away from it and no card. */
  async function desk(height = 800): Promise<Page> {
    const ctx = await browser.newContext({ viewport: { width: 1280, height }, locale: 'en-US' });
    const page = await ctx.newPage();
    await page.goto(base);
    await until('the runs', () => page.locator('.cm-bx-run').count(), (n) => n > 0);
    await page.mouse.move(5, 300);
    return page;
  }

  /** Moves the pointer from `a` to `b` in `steps` moves, as a hand does. */
  const glide = async (page: Page, a: { x: number; y: number }, b: { x: number; y: number }, steps = 8, pause = 0) => {
    for (let i = 1; i <= steps; i++) {
      await page.mouse.move(a.x + ((b.x - a.x) * i) / steps, a.y + ((b.y - a.y) * i) / steps);
      if (pause) await page.waitForTimeout(pause);
    }
  };

  it('shows the card of another part of the line the pointer moves to and rests on, on its row or a later one', async () => {
    const page = await desk();
    try {
      const rows = await rowsOf(page, LINE);
      assert.ok(rows.starts.length >= 2, JSON.stringify(rows));
      for (const word of ['sort', 'exit']) {
        await page.mouse.move(5, 300);
        await until('no card', () => tip(page).count(), (n) => n === 0);
        const from = await pointAt(page, LINE, 'grep');
        await page.mouse.move(from.x, from.y);
        await tipBox(page);
        const first = await tip(page).innerText();
        // Along the row to `sort`, or down across the rows to `exit` (on a later row): there it rests.
        const to = await pointAt(page, LINE, word);
        if (word === 'sort') assert.ok(Math.abs(to.y - from.y) < 2, `sort on grep's row: ${to.y}, ${from.y}`);
        else assert.ok(to.y > from.y + 10, `exit on a later row: ${to.y}, ${from.y}`);
        await glide(page, from, to);
        const text = await until(`the card of ${word}`, () => tip(page).innerText().catch(() => ''), (t) => t !== '' && t !== first);
        assert.ok(text.includes(word), `${word}: ${text.slice(0, 200)}`);
      }
    } finally {
      await page.context().close();
    }
  });

  it('selects the span a drag crosses, across the line\'s rows, with a card open', async () => {
    const page = await desk();
    try {
      const from = await pointAt(page, LINE, 'grep');
      await page.mouse.move(from.x, from.y);
      await tipBox(page);
      const to = await pointAt(page, LINE, 'exit');
      // From the left of `grep` straight down to `exit`'s row (towards the card, as a pointer going to it would), then
      // along that row to the right of `exit`'s `x`, quickly (within the way to the card's time).
      const start = { x: from.x - 4, y: from.y };
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      assert.strictEqual(await tip(page).count(), 1, 'the card is open as the drag starts');
      await glide(page, start, { x: start.x, y: to.y }, 4);
      await glide(page, { x: start.x, y: to.y }, { x: to.x + 20, y: to.y }, 8);
      assert.strictEqual(await tip(page).count(), 0, 'the card closed');
      await page.mouse.up();
      const selected = await page.evaluate('getSelection().toString()') as string;
      assert.ok(selected.startsWith('grep') && /\|\| exi/.test(selected.replace(/\s+/g, ' ')), JSON.stringify(selected));
    } finally {
      await page.context().close();
    }
  });

  for (const [hold, pause] of [[900, 0], [300, 100]] as const) {
    it(`keeps the drag a press starts while the way to the card runs (held ${hold} ms, then dragged ${pause ? 'slowly' : 'quickly'})`, async () => {
      const page = await desk();
      try {
        const from = await pointAt(page, LINE, 'grep');
        await page.mouse.move(from.x, from.y);
        await tipBox(page);
        const to = await pointAt(page, LINE, 'exit');
        // Down from `grep` to the next row, towards the card: the way to the card runs. A press there, held past the
        // way's time, or dragged while that time ends.
        const next = { x: from.x, y: to.y };
        // (A little lower on `grep` first, still on its row, then on the next row.)
        await page.mouse.move(from.x, from.y + 5);
        await page.mouse.move(next.x, next.y);
        assert.strictEqual(await tip(page).count(), 1, 'the card stays on the way to it');
        await page.mouse.down();
        await page.waitForTimeout(hold);
        await glide(page, next, { x: to.x + 20, y: to.y }, 8, pause);
        await page.mouse.up();
        const selected = (await page.evaluate('getSelection().toString()') as string).replace(/\s+/g, ' ');
        assert.match(selected, /\|\| exi/, JSON.stringify(selected));
      } finally {
        await page.context().close();
      }
    });
  }

  /** The index among the drawn lines of the line holding `text` (the editor draws only the lines near the view). */
  const drawnLine = (page: Page, text: string) => page.evaluate(`Array.from(document.querySelectorAll('.cm-content > .cm-line')).findIndex((l) => l.textContent.includes(${JSON.stringify(text)}))`) as Promise<number>;
  /** Scrolls the editor so that the drawn line `i` starts `gap` pixels under the pane's top. */
  const scrollLineTo = async (page: Page, i: number, gap: number) => {
    await page.evaluate(`(() => {
      const s = document.querySelector('.cm-scroller');
      const line = document.querySelectorAll('.cm-content > .cm-line')[${i}].getBoundingClientRect();
      s.scrollTop += line.top - s.getBoundingClientRect().top - ${gap};
    })()`);
    await page.waitForTimeout(300);
  };

  it('puts the box of a word with a problem where the card goes, the problem above the card', async () => {
    const page = await desk();
    try {
      // `cat $file` (an unquoted variable: a problem), placed so that the room under it is a little over 200 px (the
      // card goes there) and the room above larger: a box of that height would fit above too, where the lint's problem
      // asks for.
      await cursorToLine(page, sample.split('\n').findIndex((l) => l === 'cat $file') + 1);
      let i = await drawnLine(page, 'cat $file');
      const pane = (await page.locator('.cm-editor').boundingBox())!;
      const gap = Math.round(pane.height - 20 - 8 - 225);
      assert.ok(gap - 8 > 225, `the pane is ${pane.height} px high`);
      await scrollLineTo(page, i, gap);
      i = await drawnLine(page, 'cat $file');
      const p = await pointAt(page, i, '$file');
      await page.mouse.move(5, 300);
      await page.mouse.move(p.x + 4, p.y);
      await until('the problem and the card', () => tip(page).locator('> *').count(), (n) => n === 2);
      await page.waitForTimeout(300);
      const rows = await rowsOf(page, i);
      const b = (await tip(page).boundingBox())!;
      assert.ok(b.y >= rows.bottom - 1, `the box ${JSON.stringify(b)} under the line ${JSON.stringify(rows)}`);
      const room = await page.locator('.cm-editor').evaluate((e) => parseFloat((e as unknown as { style: { getPropertyValue(n: string): string } }).style.getPropertyValue('--bx-hover-room')));
      assert.ok(b.height <= room + 1, `${b.height} px high, the room ${room} px`);
      const [problem, card] = await Promise.all(['.cm-tooltip-lint', '.cm-bx-hover'].map(async (s) => (await tip(page).locator(s).boundingBox())!));
      assert.ok(problem.y < card.y, 'the problem above the card');
    } finally {
      await page.context().close();
    }
  });

  it('moves the keyboard\'s card to the other side of the line when the editor scrolls its side away', async () => {
    const page = await desk(420);
    try {
      // The card of `cat $file` from the keyboard, with the line low in the pane: the card goes above it.
      await cursorToLine(page, sample.split('\n').findIndex((l) => l === 'cat $file') + 1);
      let i = await drawnLine(page, 'cat $file');
      await scrollLineTo(page, i, 280);
      await page.keyboard.press('Control+K');
      await page.keyboard.press('Control+I');
      const card = page.locator('.cm-bx-hover-pinned');
      await until('the card', () => card.count(), (n) => n === 1);
      i = await drawnLine(page, 'cat $file');
      let rows = await rowsOf(page, i);
      let b = (await card.boundingBox())!;
      assert.ok(b.y + b.height <= rows.top + 1, `above: the card ${JSON.stringify(b)}, the line ${JSON.stringify(rows)}`);
      // The line scrolled near the pane's top: the card goes under it, whole, not a sliver above it.
      await scrollLineTo(page, i, 20);
      i = await drawnLine(page, 'cat $file');
      rows = await rowsOf(page, i);
      b = (await card.boundingBox())!;
      const whole = await card.evaluate((e) => e.scrollHeight);
      assert.ok(b.y >= rows.bottom - 1, `under: the card ${JSON.stringify(b)}, the line ${JSON.stringify(rows)}`);
      assert.ok(b.height >= Math.min(CARD_MIN, whole) - 1, `${b.height} px high`);
    } finally {
      await page.context().close();
    }
  });

  it('gives a line taller than any room a card of CARD_MIN at least, by the hovered row', async () => {
    const words = Array.from({ length: 150 }, (_, i) => `word${i}`).join(' ');
    for (const [width, height] of [[1280, 420], [640, 700]] as const) {
      const ctx = await browser.newContext({ viewport: { width, height }, locale: 'en-US' });
      const page = await ctx.newPage();
      try {
        await page.goto(base);
        await until('the runs', () => page.locator('.cm-bx-run').count(), (n) => n > 0);
        await page.locator('.cm-content').focus();
        await page.keyboard.press('Control+A');
        await page.keyboard.insertText(`echo ${words}`);
        await until('one line', () => page.locator('.cm-content > .cm-line').count(), (n) => n === 1);
        await until('the runs', () => page.locator('.cm-bx-run').count(), (n) => n > 100);
        const pane = (await page.locator('.cm-editor').boundingBox())!;
        const line = await rowsOf(page, 0);
        assert.ok(line.bottom - line.top > pane.height - 2 * CARD_MIN, `${width}×${height}: the line ${line.bottom - line.top} px, the pane ${pane.height} px`);
        /** The card's height, the height it would have whole, and the room it was given. */
        const size = (sel: string, room: string) => page.locator(sel).evaluate((e, room) => ({
          height: e.getBoundingClientRect().height, whole: e.scrollHeight, top: e.getBoundingClientRect().top,
          room: parseFloat((e.closest('.cm-editor') as unknown as { style: { getPropertyValue(n: string): string } }).style.getPropertyValue(room)),
        }), room);
        /** Whether a card leaves the text of the row at `y` uncovered (its glyphs reach about 8 px each side of the middle). */
        const clear = (c: { top: number; height: number }, y: number) => c.top >= y + 6 || c.top + c.height <= y - 6;
        // The pointer on a word in view, at the top of the line.
        await page.keyboard.press('Control+Home');
        await page.mouse.move(5, 5);
        const p = await pointAt(page, 0, 'echo');
        await page.mouse.move(p.x + 2, p.y);
        await tipBox(page);
        const hovered = await size('.cm-tooltip-hover', '--bx-hover-room');
        assert.ok(hovered.room >= CARD_MIN && hovered.height >= Math.min(CARD_MIN, hovered.whole) - 1, `${width}×${height}, the pointer: ${JSON.stringify(hovered)}`);
        assert.ok(clear(hovered, p.y), `${width}×${height}, the pointer: the card ${JSON.stringify(hovered)} covers the hovered row at ${p.y}`);
        // The keyboard: Ctrl+K Ctrl+I at the cursor.
        await page.mouse.move(5, 5);
        await page.keyboard.press('Control+Home');
        await page.keyboard.press('Control+K');
        await page.keyboard.press('Control+I');
        await until('the card', () => page.locator('.cm-bx-hover-pinned').count(), (n) => n === 1);
        const pinned = await size('.cm-bx-hover-pinned', '--bx-pinned-room');
        assert.ok(pinned.room >= CARD_MIN && pinned.height >= Math.min(CARD_MIN, pinned.whole) - 1, `${width}×${height}, the keyboard: ${JSON.stringify(pinned)}`);
        assert.ok(clear(pinned, p.y), `${width}×${height}, the keyboard: the card ${JSON.stringify(pinned)} covers the cursor's row at ${p.y}`);
        console.log(`      (${width}×${height}: the line ${Math.round(line.bottom - line.top)} px in a pane of ${Math.round(pane.height)} px; the card ${Math.round(hovered.height)} px, from the keyboard ${Math.round(pinned.height)} px)`);
      } finally {
        await ctx.close();
      }
    }
  });

  it('scrolls a long card inside, with the keyboard too', async () => {
    // A low window: a card is at most half of it high. (Side by side, the editor's pane is the window's height, so line 8
    // has room under it; a lower pane leaves the line no room, and the card goes by the row, as tested above.)
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 420 }, locale: 'en-US' });
    const page = await ctx.newPage();
    try {
      await page.goto(base);
      await until('the runs', () => page.locator('.cm-bx-run').count(), (n) => n > 0);
      // The cursor on `grep` of line 8, from the keyboard; Ctrl+K Ctrl+I shows its card, again puts the focus in it.
      await cursorToLine(page, LINE + 1);
      await page.keyboard.press('Control+K');
      await page.keyboard.press('Control+I');
      const card = page.locator('.cm-bx-hover-pinned');
      await until('the card', () => card.count(), (n) => n === 1);
      const size = await card.evaluate((e) => ({ height: e.getBoundingClientRect().height, scroll: e.scrollHeight }));
      assert.ok(size.height <= 210 + 1, `${size.height} px high: at most half the window`);
      assert.ok(size.scroll > size.height, 'longer than it shows');
      await page.keyboard.press('Control+K');
      await page.keyboard.press('Control+I');
      await until('the focus in the card', () => page.evaluate("document.activeElement?.classList.contains('cm-bx-hover-pinned')"), (f) => f === true);
      await page.keyboard.press('PageDown');
      await until('scrolled', () => card.evaluate((e) => e.scrollTop), (t) => t > 0);
      // Never over a row of the line.
      const rows = await rowsOf(page, LINE);
      const b = (await card.boundingBox())!;
      assert.ok(b.y >= rows.bottom - 1 || b.y + b.height <= rows.top + 1, `card ${JSON.stringify(b)}, line ${JSON.stringify(rows)}`);
    } finally {
      await ctx.close();
    }
  });
});
