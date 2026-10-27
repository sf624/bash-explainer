// The basis of a note on the web page (docs/design/basis.md, step 2), run for real in headless Chromium (the build,
// the server and the browser are shared by all test/web-*.test.ts files: test/support/site.ts): a note that rests on
// bash's behaviour rather than the manual has a quiet chip and a folded "Try it in your terminal", with the command,
// a copy button and its output; nothing is cut or overlaps, at the width of a desktop and of a phone, in both
// languages; and the setting `notes.basis` turns both off. With $BASH_EXPLAINER_SHOTS set to a directory, the notes
// are saved there as screenshots (basis-<width>-<lang>-<note>.png), to look at.
import * as assert from 'assert';
import * as path from 'path';
import type { Browser, Frame } from 'playwright-core';
import { chooseView, frames, openSite, until } from './support/site';

const LINE = 'x=1; unset -fv x f; exit 300';
/** A line whose rows rest on bash's behaviour (step 4): `UID=0` before a command (it differs), `$COLUMNS` (not in the manual). */
const ROWS = 'UID=0 echo "$COLUMNS"';

/**
 * The boxes of each part of `sel` (a note, a row of Meaning or Reading) that has a chip, with its open try-it: they
 * stay in it, the copy button is right of the code, the output under it.
 */
const boxesOf = (sel: string) => `[...document.querySelectorAll(${JSON.stringify(sel)})].filter((n) => n.querySelector('.basis')).map((n) => {
  const r = (el) => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom }; };
  return { note: r(n), chip: r(n.querySelector('.basis')), code: r(n.querySelector('.tryit-code')), copy: r(n.querySelector('.tryit-copy')), output: r(n.querySelector('.tryit-output')) };
})`;

/** Where a line of the code or the output of a try-it breaks inside a word (none should). */
const BREAKS = `[...document.querySelectorAll('.tryit-code, .tryit-output')].flatMap((box) => {
  const text = box.textContent;
  const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
  const tops = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    for (let i = 0; i < node.length; i++) {
      const r = document.createRange();
      r.setStart(node, i);
      r.setEnd(node, i + 1);
      const rect = r.getClientRects()[0];
      tops.push(rect ? Math.round(rect.top) : null);
    }
  }
  const out = [];
  for (let i = 1; i < text.length; i++) {
    if (tops[i] === null || tops[i - 1] === null || tops[i] <= tops[i - 1]) continue;
    if (!/\\s/.test(text[i - 1]) && !/\\s/.test(text[i])) out.push(text.slice(Math.max(0, i - 8), i) + '|' + text.slice(i, i + 8));
  }
  return out;
})`;

type Box = { left: number; right: number; top: number; bottom: number };

/**
 * Opens the try-its in `sel` that are folded, with a click on each. (An update of the same line may draw the panel
 * again between a click and its toggle, and the new box is then folded: it is clicked again, a few times at most.)
 */
async function openAll(panel: Frame, sel: string): Promise<void> {
  const closed = panel.locator(`${sel} details.tryit:not([open]) > summary`);
  for (let i = 0; i < 6 && await closed.count(); i++) {
    await closed.first().click();
    await frames(panel);
  }
}

/** Checks the boxes of `boxesOf`: `what` names the parts in a message. */
function assertBoxes(boxes: Record<string, Box>[], what: string): void {
  for (const [i, b] of boxes.entries()) {
    for (const part of ['chip', 'code', 'copy', 'output']) {
      assert.ok(b[part].left >= b.note.left - 0.5 && b[part].right <= b.note.right + 0.5, `${what} ${i}: the ${part} ${JSON.stringify(b[part])} is in ${JSON.stringify(b.note)}`);
    }
    assert.ok(b.copy.left >= b.code.right - 0.5, `${what} ${i}: the button ${JSON.stringify(b.copy)} is right of the code ${JSON.stringify(b.code)}`);
    assert.ok(b.output.top >= b.code.bottom - 0.5, `${what} ${i}: the output is under the code`);
  }
}

describe('the web page: what a note rests on', function () {
  this.timeout(120000);
  let browser: Browser;
  let base = '';

  before(async function () {
    ({ browser, base } = await openSite(this));
  });

  /** A page with the line typed in, and its panel; `settings` are kept as the page keeps them. */
  async function open(width: number, locale: string, settings: Record<string, unknown> = {}, line = LINE, notes = 2) {
    const { devices } = await import('playwright-core');
    const ctx = await browser.newContext(width < 600 ? { ...devices['iPhone 13'], viewport: { width, height: 900 }, locale } : { viewport: { width, height: 900 }, locale });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
    await ctx.addInitScript(`try { localStorage.setItem('bash-explainer-settings', ${JSON.stringify(JSON.stringify({ 'bashExplainer.panel.animations': false, ...settings }))}); } catch {}`);
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base);
    const panel = (): Frame => page.frames().find((f) => f.url().endsWith('/panel.html'))!;
    await until('the panel', () => Promise.resolve(panel()), (f) => !!f);
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText(line);
    await until('the line explained', async () => (await panel().locator('#line').textContent()) ?? '', (t) => t.includes(line.slice(-8)));
    await until('the notes', () => panel().locator('#notes .note').count(), (n) => n === notes);
    return { ctx, page, panel, errors };
  }

  for (const [width, locale] of [[1280, 'en-US'], [1280, 'ja-JP'], [390, 'en-US'], [390, 'ja-JP']] as const) {
    it(`marks the notes that rest on bash's behaviour, with a try-it, at ${width} px (${locale})`, async () => {
      const ja = locale === 'ja-JP';
      const { ctx, panel, errors } = await open(width, locale);
      const chips = await panel().locator('#notes .basis').allTextContents();
      assert.deepStrictEqual(chips, Array(2).fill(ja ? 'マニュアルに記述なし・bash 5.2・5.3 で確認' : 'Not in the manual · checked with bash 5.2 and 5.3'));
      assert.match(await panel().locator('#notes .basis').first().getAttribute('title') ?? '', ja ? /bash 5\.2・5\.3 で実行して確かめた/ : /checked by running bash 5\.2 and 5\.3/);
      // Folded at first; a click opens it, and a click in it does not fold it again.
      const heads = panel().locator('#notes summary.tryit-head');
      assert.deepStrictEqual(await heads.allTextContents(), Array(2).fill(ja ? '端末で試す' : 'Try it in your terminal'));
      assert.strictEqual(await panel().locator('#notes details.tryit[open]').count(), 0);
      await openAll(panel(), '#notes');
      assert.strictEqual(await panel().locator('#notes details.tryit[open]').count(), 2);
      assert.deepStrictEqual(await panel().locator('#notes .tryit-output').allTextContents(), [
        'bash: line 1: unset: cannot simultaneously unset a function and a variable\nstatus 1, x=1\nfunction', '44']);
      assert.deepStrictEqual(await panel().locator('#notes .tryit-prints').allTextContents(), Array(2).fill(ja ? '出力' : 'Output'));
      // Nothing is cut or overlaps: the chip, the code, its button and the output stay in their note, the button is
      // beside the code, and the panel does not scroll sideways.
      const boxes = await panel().evaluate(`[...document.querySelectorAll('#notes .note')].map((n) => {
        const r = (el) => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom }; };
        return { note: r(n), chip: r(n.querySelector('.basis')), code: r(n.querySelector('.tryit-code')), copy: r(n.querySelector('.tryit-copy')), output: r(n.querySelector('.tryit-output')) };
      })`) as Record<string, { left: number; right: number; top: number; bottom: number }>[];
      for (const [i, b] of boxes.entries()) {
        for (const part of ['chip', 'code', 'copy', 'output']) {
          assert.ok(b[part].left >= b.note.left - 0.5 && b[part].right <= b.note.right + 0.5, `note ${i}: the ${part} ${JSON.stringify(b[part])} is in ${JSON.stringify(b.note)}`);
        }
        assert.ok(b.copy.left >= b.code.right - 0.5, `note ${i}: the button ${JSON.stringify(b.copy)} is right of the code ${JSON.stringify(b.code)}`);
        assert.ok(b.output.top >= b.code.bottom - 0.5, `note ${i}: the output is under the code`);
      }
      assert.ok(await panel().evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), 'the panel scrolls sideways');
      // The code and the output wrap only between words: no line ends inside one, as after the `-` of `-fv`
      // (`unset -` / `fv` would read as two words). Each line is the characters drawn at one height.
      const breaks = await panel().evaluate(`[...document.querySelectorAll('#notes .tryit-code, #notes .tryit-output')].flatMap((box) => {
        const text = box.textContent;
        const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
        const tops = [];
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          for (let i = 0; i < node.length; i++) {
            const r = document.createRange();
            r.setStart(node, i);
            r.setEnd(node, i + 1);
            const rect = r.getClientRects()[0];
            tops.push(rect ? Math.round(rect.top) : null);
          }
        }
        // (A break is where the next drawn character is lower; one inside a word has no blank on either side.)
        const out = [];
        for (let i = 1; i < text.length; i++) {
          if (tops[i] === null || tops[i - 1] === null || tops[i] <= tops[i - 1]) continue;
          if (!/\\s/.test(text[i - 1]) && !/\\s/.test(text[i])) out.push(text.slice(Math.max(0, i - 8), i) + '|' + text.slice(i, i + 8));
        }
        return out;
      })`) as string[];
      assert.deepStrictEqual(breaks, [], 'a line breaks inside a word');
      if (process.env.BASH_EXPLAINER_SHOTS) {
        // (One note at a time: a frame's screenshot holds only what its viewport shows.)
        for (let i = 0; i < 2; i++) {
          await panel().locator('#notes .note').nth(i).screenshot({ path: path.join(process.env.BASH_EXPLAINER_SHOTS, `basis-${width}-${ja ? 'ja' : 'en'}-${i + 1}.png`) });
        }
      }
      // The copy button puts the command on the clipboard, and says so.
      await panel().locator('#notes .tryit-copy').nth(1).click();
      await until('copied', () => panel().locator('#notes .tryit-copy').nth(1).textContent(), (t) => t === (ja ? 'コピーしました' : 'Copied'));
      assert.strictEqual(await panel().evaluate('navigator.clipboard.readText()'), "bash -c '(exit 300); echo $?'");
      assert.deepStrictEqual(errors, []);
      await ctx.close();
    });
  }

  // Step 4: the rows of Meaning and the nodes of Reading whose text rests on bash's behaviour.
  for (const [width, locale] of [[1280, 'en-US'], [1280, 'ja-JP'], [390, 'en-US'], [390, 'ja-JP']] as const) {
    it(`marks the rows and the nodes of Reading that rest on bash's behaviour, with a try-it, at ${width} px (${locale})`, async () => {
      const ja = locale === 'ja-JP';
      const { ctx, page, panel, errors } = await open(width, locale, {}, ROWS, 1);
      const differs = ja ? 'マニュアルの記述と異なる・bash 5.2・5.3 で確認' : 'Differs from the manual · checked with bash 5.2 and 5.3';
      const checked = ja ? 'マニュアルに記述なし・bash 5.2・5.3 で確認' : 'Not in the manual · checked with bash 5.2 and 5.3';
      // (The rows are drawn with the notes; an update of the same line may follow the first.)
      await until('the chips of the rows', () => panel().locator('#tree .row .basis').allTextContents(), (t) => t.length === 2);
      assert.deepStrictEqual(await panel().locator('#tree .row .basis').allTextContents(), [differs, checked]);
      // A click on the try-it opens it, and neither folds the row nor moves the cursor; the row's other parts stay.
      await openAll(panel(), '#tree .row');
      assert.strictEqual(await panel().locator('#tree .row details.tryit[open]').count(), 2);
      assert.deepStrictEqual(await panel().locator('#tree .row .tryit-output').allTextContents(), ['bash: line 1: x: readonly variable\nruns\nstatus 0', 'COLUMNS=unset LINES=unset']);
      assertBoxes(await panel().evaluate(boxesOf('#tree .row')) as Record<string, Box>[], 'row');
      assert.ok(await panel().evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), 'the panel scrolls sideways');
      assert.deepStrictEqual(await panel().evaluate(BREAKS), [], 'a line breaks inside a word');
      const shots = process.env.BASH_EXPLAINER_SHOTS;
      if (shots) {
        const rows = panel().locator('#tree .row').filter({ has: panel().locator('.basis') });
        for (let i = 0; i < await rows.count(); i++) await rows.nth(i).screenshot({ path: path.join(shots, `basis-rows-${width}-${ja ? 'ja' : 'en'}-${i + 1}.png`) });
      }
      // Reading: the nodes with the same texts, the chip under the text.
      await chooseView(page, 'tree');
      await until('the tree', () => panel().locator('#reading-tree .trow .basis').count(), (n) => n >= 2);
      assert.deepStrictEqual([...new Set(await panel().locator('#reading-tree .trow .basis').allTextContents())].sort(), [differs, checked].sort());
      // (A try-it opened in Meaning is open here too: the panel keeps it open by its code. The others open with a click.)
      const n = await panel().locator('#reading-tree .trow details.tryit').count();
      await openAll(panel(), '#reading-tree .trow');
      assert.strictEqual(await panel().locator('#reading-tree .trow details.tryit[open]').count(), n);
      // (A click in it does not fold the item: its parts stay.)
      assert.strictEqual(await panel().locator('#reading-tree ul[role="group"][hidden]').count(), 0);
      assertBoxes(await panel().evaluate(boxesOf('#reading-tree .trow')) as Record<string, Box>[], 'node');
      assert.ok(await panel().evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), 'Reading scrolls sideways');
      assert.deepStrictEqual(await panel().evaluate(BREAKS), [], 'a line breaks inside a word in Reading');
      if (shots) {
        const rows = panel().locator('#reading-tree .trow').filter({ has: panel().locator('.basis') });
        for (let i = 0; i < await rows.count(); i++) await rows.nth(i).screenshot({ path: path.join(shots, `basis-reading-${width}-${ja ? 'ja' : 'en'}-${i + 1}.png`) });
      }
      assert.deepStrictEqual(errors, []);
      await ctx.close();
    });
  }

  it('shows no chip and no try-it with `notes.basis` off', async () => {
    const { ctx, panel } = await open(1280, 'en-US', { 'bashExplainer.notes.basis': false });
    assert.strictEqual(await panel().locator('#notes .basis, #notes .tryit').count(), 0);
    await ctx.close();
    const rows = await open(1280, 'en-US', { 'bashExplainer.notes.basis': false }, ROWS, 1);
    assert.strictEqual(await rows.panel().locator('.basis, .tryit').count(), 0);
    await rows.ctx.close();
  });
});
