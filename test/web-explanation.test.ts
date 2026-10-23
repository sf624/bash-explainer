// The web page: the explanation panel and the editor, run for real in headless Chromium (the build, the server and the browser
// are shared by all test/web-*.test.ts files: test/support/site.ts). Skipped when no browser can start,
// unless $BASH_EXPLAINER_BROWSER is set (as in CI).
import * as assert from 'assert';
import type { Browser } from 'playwright-core';
import { openSite, choose, pickKind, stable, until } from './support/site';

describe('the web page: the explanation panel and the editor', function () {
  this.timeout(120000);
  let browser: Browser;
  let base = '';

  before(async function () {
    ({ browser, base } = await openSite(this));
  });

  it('draws an indent guide in the column of the row border beside what lies under an item, clear of the rows, and none below the last', async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(base);
    const panel = () => page.frames().find((f) => f.url().endsWith('/panel.html'))!;
    await until('the panel', () => Promise.resolve(panel()), (f) => !!f);
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText('echo hello | tr a-z A-Z');
    await until('the line explained', async () => (await panel().locator('#line').textContent()) ?? '', (t) => t.includes('tr a-z'));
    // The parts of the first item with parts: beside what lies under each one but the last, a line in the
    // column of the row's own border that keeps clear of the rows, as an example's rule does.
    const kids = panel().locator('#tree > li > .body > ul > li');
    const n = await kids.count();
    assert.ok(n >= 2, `${n} parts`);
    const info = (i: number) => kids.nth(i).evaluate((li) => {
      const w = li.ownerDocument.defaultView!;
      const body = li.querySelector(':scope > .body');
      if (!body) return { line: false };
      const b = w.getComputedStyle(body, '::before');
      if (b.content === 'none' || b.content === 'normal') return { line: false };
      const box = body.getBoundingClientRect();
      const row = li.querySelector(':scope > .row')!.getBoundingClientRect();
      const next = li.nextElementSibling?.querySelector(':scope > .row')?.getBoundingClientRect();
      const top = box.top + parseFloat(b.top), bottom = box.bottom - parseFloat(b.bottom);
      return {
        line: true, column: box.left === row.left, width: b.borderLeftWidth, style: b.borderLeftStyle,
        clearOfRows: top > row.bottom && (!next || bottom < next.top),
      };
    });
    const lines = [];
    for (let i = 0; i < n; i++) lines.push(await info(i));
    assert.strictEqual(lines.some((l) => l.line), true, 'some part has a line beside what lies under it');
    for (const l of lines.slice(0, -1).filter((l) => l.line)) {
      assert.deepStrictEqual(l, { line: true, column: true, width: '2px', style: 'solid', clearOfRows: true });
    }
    assert.deepStrictEqual(lines[n - 1], { line: false }, 'no line below the last part');
    await ctx.close();
  });

  it('gives each file an example reads a box of its own, and runs the example again on all of them', async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(base);
    const panel = () => page.frames().find((f) => f.url().endsWith('/panel.html'))!;
    await until('the panel', () => Promise.resolve(panel()), (f) => !!f);
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText('sort a.txt b.txt');
    await until('the line explained', async () => (await panel().locator('#line').textContent()) ?? '', (t) => t.includes('sort a.txt'));
    const labels = await panel().locator('.example .example-label').allTextContents();
    assert.deepStrictEqual(labels.slice(0, 2).map((l) => l.replace(/ — .*/, '')), ['Input: a.txt (sample contents)', 'Input: b.txt (sample contents)']);
    const boxes = panel().locator('.example textarea');
    assert.strictEqual(await boxes.count(), 2);
    await boxes.nth(0).fill('zebra');
    await boxes.nth(1).fill('apple\nmango');
    const out = () => panel().locator('.example pre:not(.layer)').last().textContent();
    await until('the rerun example', async () => (await out()) ?? '', (t) => t === 'apple\nmango\nzebra');
    await ctx.close();
  });

  it('keeps the source line of the panel at the top while the explanation scrolls, and is capped', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 420 } });
    const page = await ctx.newPage();
    await page.goto(base);
    const panel = () => page.frames().find((f) => f.url().endsWith('/panel.html'))!;
    await until('the panel', () => Promise.resolve(panel()), (f) => !!f);
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText('grep -rn "ERROR $USER" ./src 2>&1 | sort | uniq -c | sort -rn | head -n 5 | tee out.txt');
    await page.keyboard.press('Control+Home');
    await until('the line explained', async () => (await panel().locator('#line').textContent()) ?? '', (t) => t.includes('ERROR'));
    const geometry = () => panel().evaluate(`(() => {
      const line = document.getElementById('line').getBoundingClientRect();
      const rows = [...document.querySelectorAll('#tree .row')].map((r) => r.getBoundingClientRect());
      return { lineTop: line.top, scrollY: window.scrollY, max: document.documentElement.scrollHeight - innerHeight, below: rows.some((r) => r.top >= line.bottom && r.bottom <= innerHeight) };
    })()`) as Promise<{ lineTop: number; scrollY: number; max: number; below: boolean }>;
    const start = await geometry();
    assert.ok(start.max > 50, 'the explanation scrolls');
    // It does not move at all, not even for the first pixels (it sticks where it starts).
    for (const y of [3, 20, 100000]) {
      await panel().evaluate(`window.scrollTo(0, ${y})`);
      const at = await until('scrolled', geometry, (x) => x.scrollY > 0);
      assert.ok(Math.abs(at.lineTop - start.lineTop) < 0.5, JSON.stringify({ y, start, at }));
    }
    const g = await geometry();
    assert.ok(g.below, JSON.stringify(g));
    await until('the edge', () => panel().locator('#top').evaluate((e) => e.classList.contains('stuck')), (v) => v);
    // Nothing scrolled under it shows above it, not even at its rounded corners.
    const above = await panel().evaluate(`(() => {
      const line = document.getElementById('line');
      const r = line.getBoundingClientRect();
      const out = [];
      for (let y = 0; y <= r.top + 3; y++) for (let x = 0; x < innerWidth; x += 2) {
        const e = document.elementFromPoint(x, y);
        if (e && e !== document.body && e !== document.documentElement && e.id !== 'top' && !line.contains(e)) out.push(x + ',' + y + ' ' + e.tagName + '.' + e.className);
      }
      return out.slice(0, 5);
    })()`) as string[];
    assert.deepStrictEqual(above, []);
    // Hovering a token of the sticky line still lights a segment and its row.
    await panel().locator('#line .seg').first().hover();
    assert.ok((await panel().locator('.seg.active').count()) > 0);
    // The block shows the cursor's own line only, so it is one line tall; a very long line scrolls inside the box, and the box is capped at 40% of the panel anyway.
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText(`echo ${'word '.repeat(120)}| sort`);
    await page.keyboard.press('Control+Home');
    await until('the long line explained', async () => (await panel().locator('#line').textContent()) ?? '', (t) => t.includes('word word'));
    const long = await until('the long line', () => panel().evaluate(`(() => { const l = document.getElementById('line'); return { h: l.getBoundingClientRect().height, sw: l.scrollWidth, cw: l.clientWidth, max: parseFloat(getComputedStyle(l).maxHeight), inner: innerHeight }; })()`) as Promise<{ h: number; sw: number; cw: number; max: number; inner: number }>, (x) => x.sw > x.cw);
    assert.ok(long.h < 80, JSON.stringify(long));
    assert.ok(Math.abs(long.max - long.inner * 0.4) < 1, JSON.stringify(long));
    // Selecting a row scrolls the line sideways to its characters, as the editor does; and back.
    const shown = (word: string) => panel().evaluate(`(() => {
      const l = document.getElementById('line').getBoundingClientRect();
      const s = [...document.querySelectorAll('#line .seg')].find((e) => e.textContent.trim() === ${JSON.stringify(word)}).getBoundingClientRect();
      return { left: document.getElementById('line').scrollLeft, inside: s.left >= l.left && s.right <= l.right };
    })()`) as Promise<{ left: number; inside: boolean }>;
    assert.deepStrictEqual(await shown('echo'), { left: 0, inside: true });
    await panel().locator('#tree code.label', { hasText: /^sort$/ }).first().click();
    const end = await until('scrolled to sort', () => shown('sort'), (x) => x.inside);
    assert.ok(end.left > 0, JSON.stringify(end));
    await panel().locator('#tree code.label', { hasText: /^echo$/ }).first().click();
    assert.deepStrictEqual(await until('scrolled back', () => shown('echo'), (x) => x.inside), { left: 0, inside: true });
    await ctx.close();
  });

  it('folds a row over several lines without moving the cursor to its last line', async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(base);
    const panel = () => page.frames().find((f) => f.url().endsWith('/panel.html'))!;
    await until('the panel', () => Promise.resolve(panel()), (f) => !!f);
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText('if [ -z "${1:-}" ]; then\n  echo none\nfi');
    await page.keyboard.press('Control+Home');
    await until('the line explained', async () => (await panel().locator('#line').textContent()) ?? '', (t) => t.includes('-z'));
    // The if covers lines 1 to 3: a click folds it, and the cursor and the panel stay on line 1.
    await panel().locator('#tree > li > .row .label').first().click();
    await until('folded', () => panel().locator('#tree > li').first().evaluate((e) => e.classList.contains('collapsed')), (v) => v);
    // (The panel follows the cursor after a short delay: look at it once it has settled.)
    const shown = await stable('the panel', async () => ({ line: (await panel().locator('#line').textContent()) ?? '', active: await page.locator('.cm-activeLine').innerText() }));
    assert.match(shown.line, /-z/);
    assert.match(shown.active, /^if \[/);
    await ctx.close();
  });

  it('links each row and note to its section of the Bash manual, opened in a new tab', async () => {
    const ctx = await browser.newContext();
    // The manual is not fetched here: the tab that opens gets a stub.
    await ctx.route('https://www.gnu.org/**', (r) => r.fulfill({ contentType: 'text/html', body: 'manual' }));
    const page = await ctx.newPage();
    await page.goto(base);
    const panel = () => page.frames().find((f) => f.url().endsWith('/panel.html'))!;
    await until('the panel', () => Promise.resolve(panel()), (f) => !!f);
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText('exit 300');
    await until('the line explained', async () => (await panel().locator('#line').textContent()) ?? '', (t) => t.includes('exit 300'));
    const links = (sel: string) => panel().locator(sel).evaluateAll((as) => as.map((a) => [a.textContent, a.getAttribute('href'), a.getAttribute('target'), a.getAttribute('title')]));
    const manual = 'https://www.gnu.org/software/bash/manual/html_node/';
    assert.deepStrictEqual(await links('#notes .refs a'), [['§3.7.5', `${manual}Exit-Status.html`, '_blank', 'Bash manual 3.7.5: Exit Status']]);
    assert.deepStrictEqual(await links('#tree > li > .row .refs a'), [
      ['§4.1', `${manual}Bourne-Shell-Builtins.html`, '_blank', 'Bash manual 4.1: Bourne Shell Builtins'],
      ['§4.4', `${manual}Special-Builtins.html`, '_blank', 'Bash manual 4.4: Special Builtins'],
    ]);
    // The links end the row, after its explanation, on the same line.
    const box = await panel().locator('#tree > li > .row').first().evaluate((row) => {
      const r = row.getBoundingClientRect(), refs = row.querySelector('.refs')!.getBoundingClientRect(), text = row.querySelector('.text')!.getBoundingClientRect();
      return { inside: refs.right <= r.right + 0.5 && refs.left >= text.right, sameLine: Math.abs(refs.top - text.top) < 8 };
    });
    assert.deepStrictEqual(box, { inside: true, sameLine: true });
    // A click opens the page in a new tab.
    const [tab] = await Promise.all([ctx.waitForEvent('page'), panel().locator('#notes .refs a').click()]);
    await tab.waitForLoadState();
    assert.strictEqual(tab.url(), `${manual}Exit-Status.html`);
    await ctx.close();
  });

  it('folds a tree row on a click anywhere in it, and still selects its text in the editor', async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(base);
    const panel = () => page.frames().find((f) => f.url().endsWith('/panel.html'))!;
    await until('the panel', () => Promise.resolve(panel()), (f) => !!f);
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText('echo hello | tr a-z A-Z');
    await until('the line explained', async () => (await panel().locator('#line').textContent()) ?? '', (t) => t.includes('tr a-z'));
    const selected = () => page.locator('.cm-selectionBackground').count();
    // The first row with parts, and a row without.
    const parent = () => panel().locator('#tree li:has(> .body > ul)').first();
    const folded = async () => parent().evaluate((li) => li.classList.contains('collapsed'));
    const twisty = async () => (await parent().locator('> .row > .twisty').textContent()) ?? '';
    const leaf = () => panel().locator('#tree li:not(:has(> .body > ul)) > .row').first();

    // A click on the text of the row folds it, and again unfolds it.
    await page.keyboard.press('Home');
    assert.strictEqual(await folded(), false);
    await parent().locator('> .row > .text').click();
    assert.strictEqual(await folded(), true);
    assert.strictEqual(await twisty(), '▸');
    await until('the token selected', selected, (n) => n > 0);
    await parent().locator('> .row > .label').click();
    assert.strictEqual(await folded(), false);
    assert.strictEqual(await twisty(), '▾');

    // The twisty folds once, not twice.
    await parent().locator('> .row > .twisty').click();
    assert.strictEqual(await folded(), true);
    await parent().locator('> .row > .twisty').click();
    assert.strictEqual(await folded(), false);

    // Dragging over the text to select it does not fold.
    const text = parent().locator('> .row > .text');
    const box = (await text.boundingBox())!;
    await page.mouse.move(box.x + 2, box.y + 8);
    await page.mouse.down();
    await page.mouse.move(box.x + 200, box.y + 8, { steps: 5 });
    await page.mouse.up();
    assert.strictEqual(await folded(), false);

    // A row without parts only selects.
    await page.keyboard.press('Home');
    await panel().locator('body').click({ position: { x: 1, y: 1 } });
    const before = await panel().locator('#tree .collapsed').count();
    await leaf().click();
    assert.strictEqual(await panel().locator('#tree .collapsed').count(), before);
    await until('the leaf selected', selected, (n) => n > 0);

    // A fold survives the panel being drawn again for the same line (here by another shell being chosen).
    await panel().evaluate('getSelection().removeAllRanges()');
    await parent().locator('> .row > .text').click();
    assert.strictEqual(await folded(), true);
    await parent().evaluate((li) => ((li as any).mark = 1));
    await choose(page, '#shell', 'dash');
    await until('the panel drawn again', () => parent().evaluate((li) => !(li as any).mark), (redrawn) => redrawn);
    assert.strictEqual(await folded(), true);
    assert.strictEqual(await twisty(), '▸');
    // "Expand all" and "Collapse all" still work.
    await page.locator('#collapse').click();
    assert.strictEqual(await panel().locator('#tree .collapsed').count(), 0);
    await page.locator('#collapse').click();
    assert.strictEqual(await folded(), false);
    assert.strictEqual(await panel().locator('#tree .collapsed').count() > 0, true);
    await ctx.close();
  });

  it('shows a selection made with Shift and the arrow keys on the line of the cursor', async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(base);
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText('echo hello world');
    for (let i = 0; i < 6; i++) await page.keyboard.press('Shift+ArrowLeft');
    // CodeMirror draws the selection layer on the next frame.
    await until('the selection drawn', () => page.locator('.cm-selectionBackground').count(), (n) => n > 0);
    // The active line lies over the selection layer: its background must let the selection show through.
    const alpha = await page.locator('.cm-activeLine').evaluate((el) => {
      const c = (globalThis as any).getComputedStyle(el).backgroundColor as string;
      const m = /rgba?\(([^)]*)\)/.exec(c);
      const parts = m ? m[1].split(',').map((x) => parseFloat(x)) : [];
      return parts.length === 4 ? parts[3] : 1;
    });
    assert.ok(alpha < 0.5, `the active line's background alpha is ${alpha}`);
    await ctx.close();
  });

  it('colours the script from its own syntax tree: code again after a heredoc, and the shell code of a host file', async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(base);
    /** The colour and the highlight class of each piece of a line of the editor, as `text|class|colour`. */
    const pieces = (start: string) => page.locator('.cm-line').filter({ hasText: start }).first().evaluate((line) => {
      const out: string[] = [];
      // No named functions in here: tsx would wrap them in a helper the page does not have.
      const texts = (globalThis as any).document.createTreeWalker(line, 4);
      for (let n = texts.nextNode(); n; n = texts.nextNode()) {
        if (!n.textContent.trim()) continue;
        const el = n.parentElement;
        const cls = [...el.classList].find((c) => (c as string).startsWith('cm-bx-')) ?? '';
        out.push(`${n.textContent.trim()}|${cls}|${(globalThis as any).getComputedStyle(el).color}`);
      }
      return out;
    });
    await page.locator('.cm-scroller').evaluate((e) => (e.scrollTop = e.scrollHeight));
    const shopt = await until('the shopt line coloured', () => pieces('shopt -s extglob'), (p) => p.some((x) => x.startsWith('shopt|cm-bx-builtin')));
    assert.deepEqual(shopt.map((x) => x.split('|').slice(0, 2).join('|')), ['shopt|cm-bx-builtin', '-s|cm-bx-option', 'extglob|']);
    const body = await pieces('tabs are removed');
    assert.deepEqual(body.map((x) => x.split('|')[1]), ['cm-bx-heredoc']);
    // A string and a builtin do not share a colour.
    assert.notStrictEqual(body[0].split('|')[2], shopt[0].split('|')[2]);
    // Typing colours the new text too.
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText('\necho "typed"');
    await until('the typed line coloured', () => pieces('echo "typed"'), (p) => p.some((x) => x.startsWith('"typed"|cm-bx-string')));
    // A Dockerfile: its own mode for FROM and RUN, ours for the shell code after RUN.
    await pickKind(page, 'dockerfile');
    page.once('dialog', (d) => void d.accept()); // replace the typed script with the sample
    await page.locator('#sample').click();
    const run = await until('the RUN line coloured', () => pieces('RUN apt-get update'), (p) => p.some((x) => x.startsWith('apt-get|cm-bx-command')));
    assert.deepEqual(run.map((x) => x.split('|')[1]), ['', 'cm-bx-command', '']);
    assert.notStrictEqual(run[0].split('|')[2], run[2].split('|')[2], 'RUN is coloured by the Dockerfile mode');
    const entry = await pieces('ENTRYPOINT');
    assert.ok(entry.some((x) => x.startsWith('${PORT:-8080}|cm-bx-variable')), entry.join('\n'));
    await ctx.close();
  });
});
