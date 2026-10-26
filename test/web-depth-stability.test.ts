// Prototype B (one view with a depth, and the program's side): a deeper step only adds. Run for real in headless
// Chromium (test/support/site.ts): every row drawn at depth 1 is drawn at depth 2, and with the program's side shown,
// with the same text and the same colour; and a word of a statement shown whole says the same, and has the same
// colour and fill, whatever line of the statement the cursor is on (the body of a loop, on the loop's first line).
import * as assert from 'assert';
import type { Browser, Frame, Page } from 'playwright-core';
import { openSite, until } from './support/site';

/** The survey's scripts, and the lines to put the cursor on (from 1). */
const SCRIPTS: { text: string; lines: number[]; argv?: Record<number, string[][]> }[] = [
  { text: 'for f in *.txt; do\n  wc -l "$f"\ndone', lines: [1, 2, 3], argv: { 2: [['wc', '-l', "‹the loop's current item from *.txt›"]] } },
  {
    text: 'grep -h "$USER" /var/log/*.log | sort | uniq -c | sort -rn | head -5', lines: [1],
    argv: { 1: [['grep', '-h', '‹current user name›', '‹each name matching /var/log/*.log›'], ['sort'], ['uniq', '-c'], ['sort', '-rn'], ['head', '-5']] },
  },
  {
    text: 'backup="${HOME}/backup-$(date +%F).tar.gz"\ntar -czf "$backup" ~/docs 2>/dev/null || echo "failed" >&2', lines: [1, 2],
    // (Round 9: a command in `$( )` has its receives line too.)
    argv: { 1: [['date', '+%F']], 2: [['tar', '-czf', '‹home directory›/backup-‹output of date +%F›.tar.gz', '‹home directory›/docs'], ['failed']] },
  },
  { text: 'if [[ -f config.ini && $DEBUG == 1 ]]; then source config.ini; fi', lines: [1], argv: { 1: [['config.ini']] } },
];

interface Row { text: string; kind: string; read: boolean }

describe('the web page: the depths of the explanation add, and never move a text', function () {
  this.timeout(180000);
  let browser: Browser;
  let base = '';

  before(async function () {
    ({ browser, base } = await openSite(this));
  });

  /** The rows drawn, by the range of the line they are about: the first text (without what the program reads), the colour, the fill. */
  const rows = async (f: Frame): Promise<Map<string, Row>> => new Map(await f.evaluate(`[...document.querySelectorAll('#tree .u-row')].filter((r) => !r.classList.contains('u-around')).map((r) => {
    const t = r.querySelector('.u-l1 > .text')?.cloneNode(true);
    t?.querySelectorAll('.u-reads').forEach((x) => x.remove());
    return [r.dataset.span, { text: (t?.textContent ?? '').trim(), kind: [...r.classList].find((c) => c.startsWith('kind-')), read: r.classList.contains('u-read') }];
  })`) as [string, Row][]);

  /** The argv lines drawn (the program's side): for each, its words' texts and the ranges of the words they come from. */
  const argvs = async (f: Frame): Promise<{ words: string[]; spans: string[] }[]> => f.evaluate(`[...document.querySelectorAll('#tree .u-argv')].map((l) => ({
    words: [...l.querySelectorAll('.u-arg')].map((w) => w.textContent),
    spans: [...l.querySelectorAll('.u-arg')].map((w) => w.dataset.span),
  }))`) as Promise<{ words: string[]; spans: string[] }[]>;
  /**
   * The argv chips broken across lines where they need not be (round 7: the line wraps between chips; a chip wraps
   * inside only when it is wider than the line, and then only after a `/`): their texts. A chip is one box; one higher
   * than 1.8 times its font size is as wide as its line, and no piece of it is broken.
   */
  const brokenChips = async (f: Frame): Promise<string[]> => f.evaluate(`[...document.querySelectorAll('#tree .u-arg')].filter((c) => {
    const rects = c.getClientRects();
    const size = parseFloat(getComputedStyle(c).fontSize);
    if (rects.length !== 1) return true;
    if (rects[0].height <= size * 1.8) return false;
    return rects[0].width < 0.9 * c.parentElement.clientWidth || [...c.children].some((p) => p.getClientRects().length > 1);
  }).map((c) => c.textContent)`) as Promise<string[]>;
  /** The line boxes of an element's text: one per line, with its left and right. */
  const LINES = `const lines = (e) => { const rg = document.createRange(); rg.selectNodeContents(e); const rs = [...rg.getClientRects()].filter((x) => x.width > 0).sort((a, b) => a.top - b.top); const out = []; for (const x of rs) { const l = out.find((o) => Math.abs(o.bottom - x.bottom) < 4); if (l) { l.left = Math.min(l.left, x.left); l.right = Math.max(l.right, x.right); } else out.push({ left: x.left, right: x.right, bottom: x.bottom }); } return out; };`;
  /**
   * (Round 7) The rows whose text wraps while its first line is narrower than 70% of the meaning column, on a row with
   * no chips (the chips are a line of their own; nothing else takes the text's width): their codes.
   */
  const narrowTexts = async (f: Frame): Promise<string[]> => f.evaluate(`(() => { ${LINES} return [...document.querySelectorAll('#tree .u-row')].filter((r) => {
    const t = r.querySelector('.u-l1 > .text');
    if (!t || r.querySelector('.u-side') || !t.getClientRects().length) return false;
    const ls = lines(t);
    return ls.length > 1 && ls[0].right - ls[0].left < 0.7 * r.querySelector('.u-desc').clientWidth;
  }).map((r) => r.querySelector('.label').textContent); })()`) as Promise<string[]>;
  /** (Round 7) The code spans of the texts broken across lines (a long one, `.u-long`, and a form's may wrap): their texts. */
  const brokenCode = async (f: Frame): Promise<string[]> => f.evaluate(`(() => { ${LINES} return [...document.querySelectorAll('#tree .u-desc code, #u-summary code, #u-risks code')]
    .filter((c) => c.getClientRects().length && !c.classList.contains('u-long') && !c.closest('.u-argv, .u-form, .u-cond') && lines(c).length > 1).map((c) => c.textContent); })()`) as Promise<string[]>;
  /**
   * (Round 8) One home per risk: each text of the box "Risks on this line" appears once in the panel (its rows have
   * a marker only); no text is cut inside a word with "…"; and the tint follows the line "X receives:": a row's code
   * is tinted only when the word is in its command's receives line (round 9: as the very text written there, so the
   * tint never says other than the chips). Returns the problems found.
   */
  const oneHome = async (f: Frame): Promise<string[]> => f.evaluate(`(() => {
    const out = [];
    const panel = document.getElementById('main').innerText;
    for (const t of [...document.querySelectorAll('#u-risks .u-risk-head')].map((x) => x.innerText.trim())) {
      const n = panel.split(t).length - 1;
      if (n !== 1) out.push('risk said ' + n + ' times: ' + t.slice(0, 40));
    }
    if (document.querySelector('#tree .u-problem.level-info, #tree .u-problem.level-warning, #notes .level-info, #notes .level-warning')) out.push('a risk drawn outside the box');
    for (const m of panel.match(/[\\p{L}\\p{N}]…/gu) ?? []) out.push('cut word: ' + m);
    if (document.getElementById('main').classList.contains('u-who')) {
      const got = new Map([...document.querySelectorAll('#tree .u-argv .u-arg')].map((w) => [w.dataset.span, w.textContent]));
      for (const r of document.querySelectorAll('#tree .u-row.u-read')) {
        if (!got.has(r.dataset.span)) out.push('tinted, not received: ' + r.dataset.span);
        else if (got.get(r.dataset.span) !== r.querySelector('.label').textContent.trim()) out.push('tinted, received as other text: ' + r.querySelector('.label').textContent + ' / ' + got.get(r.dataset.span));
      }
    }
    return out;
  })()`) as Promise<string[]>;

  /** "1:2-1:4": its start, as a number that orders the ranges. */
  const startOf = (span: string): number => {
    const [l, c] = span.split('-')[0].split(':').map(Number);
    return l * 10000 + c;
  };

  /** Shows depth `step`, with the program's side or not. */
  const show = async (f: Frame, step: number, who: boolean): Promise<void> => {
    await f.evaluate(`document.querySelector('#steps button.step[data-step="${step}"]').click()`);
    if ((await f.evaluate("document.getElementById('who-toggle').getAttribute('aria-pressed') === 'true'")) !== who) await f.evaluate("document.getElementById('who-toggle').click()");
    await until('the step', () => f.evaluate(`document.getElementById('main').dataset.depth + document.getElementById('main').classList.contains('u-who')`) as Promise<string>, (s) => s === `${step}${who}`);
  };

  /** Opens the page with `text`, the cursor on `line`. */
  const open = async (page: Page, text: string, line: number): Promise<Frame> => {
    await page.goto(base);
    const panel = () => page.frames().find((x) => x.url().endsWith('/panel.html'))!;
    await until('the panel', () => Promise.resolve(panel()), (x) => !!x);
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText(text);
    await page.keyboard.press('Control+Home');
    for (let i = 1; i < line; i++) await page.keyboard.press('ArrowDown');
    const want = text.split('\n')[line - 1].trim();
    await until('the line', async () => (await panel().locator('#line').textContent()) ?? '', (t) => t.trim() === want);
    await until('the rows', () => panel().locator('#tree .u-row').count(), (n) => n > 0);
    return panel();
  };

  for (const script of SCRIPTS) {
    it(`keeps every text of depth 1 at depth 2 and with the program's side: ${script.text.split('\n')[0]}`, async () => {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-US' });
      const page = await ctx.newPage();
      /** The rows of each line, at depth 2 with the program's side. */
      const byLine: Map<string, Row>[] = [];
      for (const line of script.lines) {
        const f = await open(page, script.text, line);
        await show(f, 1, false);
        const first = await rows(f);
        // (On `done` alone, depth 1 draws only the loop around it.)
        assert.ok(first.size > 0 || line === 3);
        for (const [step, who] of [[2, false], [2, true], [1, true]] as const) {
          await show(f, step, who);
          const deeper = await rows(f);
          for (const [span, r] of first) {
            const d = deeper.get(span);
            assert.ok(d, `line ${line}: the row of ${span} ("${r.text}") at depth ${step}${who ? ' with the program\'s side' : ''}`);
            assert.strictEqual(d.text, r.text, `line ${line}, ${span}`);
            assert.strictEqual(d.kind, r.kind, `line ${line}, ${span}`);
          }
        }
        // The program's side: one argv line per simple command, the same at both depths; its words in source order,
        // the first the command's name (the program receives it, as argv[0]).
        await show(f, 1, true);
        const a1 = await argvs(f);
        await show(f, 2, true);
        const a2 = await argvs(f);
        assert.deepStrictEqual(a2, a1, `line ${line}: the argv lines at depth 1 and 2`);
        for (const a of a2) {
          // (A builtin's line, `source`, holds its arguments only: bash calls it with the words after its name.)
          const starts = a.spans.map(startOf);
          for (let i = 1; i < starts.length; i++) assert.ok(starts[i] >= starts[i - 1], `line ${line}: argv ${a.words.join(' ')} out of order`);
        }
        if (script.argv?.[line]) assert.deepStrictEqual(a2.map((a) => a.words), script.argv[line], `line ${line}: the argv lines`);
        assert.deepStrictEqual(await brokenChips(f), [], `line ${line}: argv chips broken across lines`);
        for (const [step, who] of [[1, false], [2, false], [2, true], [1, true]] as const) {
          await show(f, step, who);
          assert.deepStrictEqual(await oneHome(f), [], `line ${line}, depth ${step}${who ? ' with the program\'s side' : ''}`);
        }
        await show(f, 2, true);
        byLine.push(await rows(f));
        // Every row drawn says something.
        for (const [span, r] of byLine[byLine.length - 1]) if (r.kind !== 'kind-simple') assert.ok(r.text, `line ${line}, ${span}: no text`);
      }
      // A row drawn with the cursor on two lines of the statement says the same, in the same colour and fill.
      for (let i = 1; i < byLine.length; i++) {
        for (const [span, r] of byLine[i]) {
          const o = byLine[0].get(span);
          if (o) assert.deepStrictEqual(o, r, `${span}: line ${script.lines[0]} vs line ${script.lines[i]}`);
        }
      }
      if (script.lines.length === 3) {
        // The body of the loop, on its first line, as on its own: `wc`, `-l` and `"$f"` say what they do.
        for (const span of ['1:2-1:4', '1:5-1:7', '1:8-1:12']) assert.ok(byLine[0].get(span)?.text, span);
        assert.strictEqual(byLine[0].get('1:5-1:7')!.read, true);
      }
      await ctx.close();
    });
  }

  for (const lang of ['en', 'ja'] as const) {
    it(`gives the text the column's width, and never breaks a code span (${lang})`, async () => {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: lang === 'ja' ? 'ja-JP' : 'en-US' });
      const page = await ctx.newPage();
      for (const script of SCRIPTS) {
        for (const line of script.lines.slice(0, 2)) {
          const f = await open(page, script.text, line);
          for (const [step, who] of [[1, false], [2, false], [2, true]] as const) {
            await show(f, step, who);
            const at = `${script.text.split('\n')[line - 1]}: depth ${step}${who ? ' with the program\'s side' : ''}`;
            assert.deepStrictEqual(await narrowTexts(f), [], `${at}: a text narrower than its column`);
            assert.deepStrictEqual(await brokenCode(f), [], `${at}: code broken across lines`);
          }
        }
      }
      await ctx.close();
    });
  }

  /**
   * (Round 9) The toolbar: its height, and the pairs of its boxes that overlap (the segments of the depth share their
   * border: 1.5 px is allowed). Round 10: one row of controls (the depth, the switch, "Key"), no legend line; `rows`:
   * how many rows its controls take (their middles apart by more than half a control's height).
   */
  const toolbar = async (f: Frame): Promise<{ height: number; overlaps: string[]; rows: number }> => f.evaluate(`(() => {
    const vis = (e) => e.getClientRects().length > 0;
    const height = Math.round(document.getElementById('layers').getBoundingClientRect().height);
    const boxes = [...document.querySelectorAll('#layers #layers-label, #layers button.step, #layers #who-toggle, #layers #key-button')]
      .filter(vis).map((e) => [e.id || e.className, e.getBoundingClientRect()]);
    const mids = boxes.map(([, b]) => (b.top + b.bottom) / 2).sort((a, b) => a - b);
    let rows = mids.length ? 1 : 0;
    for (let i = 1; i < mids.length; i++) if (mids[i] - mids[i - 1] > 12) rows++;
    const overlaps = [];
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const [n1, a] = boxes[i];
      const [n2, b] = boxes[j];
      if (a.left < b.right - 1.5 && b.left < a.right - 1.5 && a.top < b.bottom - 1.5 && b.top < a.bottom - 1.5) overlaps.push(n1 + ' / ' + n2);
    }
    return { height, overlaps, rows };
  })()`) as Promise<{ height: number; overlaps: string[]; rows: number }>;

  for (const lang of ['en', 'ja'] as const) {
    for (const width of [1280, 390]) {
      it(`keeps the toolbar the same on every line, with no box over another (${lang}, ${width} px)`, async () => {
        const ctx = await browser.newContext({ viewport: { width, height: 900 }, locale: lang === 'ja' ? 'ja-JP' : 'en-US' });
        const page = await ctx.newPage();
        const heights = new Map<string, number>();
        for (const script of SCRIPTS) {
          for (const line of script.lines) {
            const f = await open(page, script.text, line);
            for (const [step, who] of [[1, false], [2, false], [2, true], [1, true]] as const) {
              await show(f, step, who);
              const at = `${script.text.split('\n')[line - 1]}: depth ${step}${who ? ' with the program\'s side' : ''}`;
              const t = await toolbar(f);
              assert.deepStrictEqual(t.overlaps, [], `${at}: toolbar boxes overlap`);
              // (Round 10: no switch of the keywords; one row of controls at a desktop width.)
              assert.strictEqual(await f.evaluate("document.getElementById('kw-toggle')"), null, `${at}: the keywords' switch is gone`);
              if (width >= 1280) assert.strictEqual(t.rows, 1, `${at}: the toolbar in one row`);
              const key = `${step}${who}`;
              if (!heights.has(key)) heights.set(key, t.height);
              assert.strictEqual(t.height, heights.get(key), `${at}: the toolbar's height`);
            }
          }
        }
        // (And the same with the switch on and off, at either depth.)
        assert.strictEqual(new Set(heights.values()).size, 1, `the toolbar's heights: ${JSON.stringify([...heights])}`);
        await ctx.close();
      });
    }
  }

  /**
   * (Round 10) What the panel says once and what every row has: the definition of a simple command and the rule of
   * double quotes at most once in the panel; at depth 2, exactly one chip of its role to bash on every row (none at
   * depth 1); the descriptions starting at the same x on every row, line, depth and switch state at a given width.
   */
  const facts = async (f: Frame): Promise<{ simple: number; dquote: number; chips: string[]; xs: number[]; depth: string }> => f.evaluate(`(() => {
    const text = document.getElementById('main').innerText;
    const count = (t) => text.split(t).length - 1;
    const rows = [...document.querySelectorAll('#tree .u-row')].filter((r) => r.getClientRects().length && !r.classList.contains('u-around'));
    const depth = document.getElementById('main').dataset.depth;
    const chips = rows.filter((r) => r.querySelectorAll('.u-side .u-role').length !== (depth === '2' ? 1 : 0)).map((r) => r.querySelector('.label').textContent + ': ' + r.querySelectorAll('.u-side .u-role').length);
    const xs = [...new Set(rows.map((r) => Math.round(r.querySelector('.u-desc').getBoundingClientRect().left)))];
    return { simple: count('Simple command:'), dquote: count('Double quotes:'), chips, xs, depth };
  })()`) as Promise<{ simple: number; dquote: number; chips: string[]; xs: number[]; depth: string }>;

  it('says each definition once, gives every row of depth 2 one role chip, and keeps the description column in place', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-US' });
    const page = await ctx.newPage();
    const xs = new Set<number>();
    for (const script of SCRIPTS) {
      for (const line of script.lines) {
        const f = await open(page, script.text, line);
        for (const [step, who] of [[1, false], [2, false], [2, true], [1, true]] as const) {
          await show(f, step, who);
          const at = `${script.text.split('\n')[line - 1]}: depth ${step}${who ? ' with the program\'s side' : ''}`;
          const x = await facts(f);
          assert.ok(x.simple <= 1, `${at}: "Simple command:" said ${x.simple} times`);
          assert.ok(x.dquote <= 1, `${at}: "Double quotes:" said ${x.dquote} times`);
          assert.deepStrictEqual(x.chips, [], `${at}: rows without exactly one role chip`);
          for (const v of x.xs) xs.add(v);
        }
      }
    }
    assert.strictEqual(xs.size, 1, `the description column's x: ${[...xs].join(', ')}`);
    await ctx.close();
  });

  it('shows every reserved word and operator at depth 2, none at depth 1 but a line made of one', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-US' });
    const page = await ctx.newPage();
    const labels = async (f: Frame): Promise<string[]> => f.evaluate(`[...document.querySelectorAll('#tree .u-row')].filter((r) => r.getClientRects().length && !r.classList.contains('u-around')).map((r) => r.querySelector('.label').textContent.trim())`) as Promise<string[]>;
    const want: [number, number, string[]][] = [[0, 1, ['for', 'in', ';', 'do', 'done']], [1, 1, ['|', '|', '|', '|']], [2, 2, ['||']], [3, 1, ['[[', '&&', '==', ']]', ';', 'then', ';', 'fi']]];
    const syntax = /^(for|in|do|done|if|then|fi|\[\[|\]\]|;|\||\|\||&&|==)$/;
    for (const [i, line, words] of want) {
      const f = await open(page, SCRIPTS[i].text, line);
      await show(f, 2, true);
      const got = (await labels(f)).filter((l) => syntax.test(l));
      for (const w of words) assert.ok(got.includes(w), `${SCRIPTS[i].text.split('\n')[line - 1]}: ${w} at depth 2 (${got.join(' ')})`);
      assert.strictEqual(got.filter((l) => l === '|').length, words.filter((w) => w === '|').length);
      await show(f, 1, true);
      assert.deepStrictEqual((await labels(f)).filter((l) => syntax.test(l)), [], `${SCRIPTS[i].text.split('\n')[line - 1]}: syntax rows at depth 1`);
    }
    // (A line that is only `done`: its row at depth 1, saying which loop it ends.)
    const f = await open(page, SCRIPTS[0].text, 3);
    await show(f, 1, false);
    assert.deepStrictEqual(await labels(f), ['done']);
    assert.match(await f.evaluate("document.querySelector('#tree .u-row:not(.u-around) .u-l1 > .text').textContent") as string, /End of the for loop that starts on line 1/);
    // (The loop's body once at depth 2: no row of `do … done` besides its `do` and `done`.)
    const g = await open(page, SCRIPTS[0].text, 1);
    await show(g, 2, false);
    assert.deepStrictEqual((await labels(g)).filter((l) => /^do\b[\s\S]*done$/.test(l)), []);
    await ctx.close();
  });

  it('never breaks an argv chip where it need not, on a phone either', async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, locale: 'en-US' });
    const page = await ctx.newPage();
    for (const script of SCRIPTS) {
      for (const line of Object.keys(script.argv ?? {}).map(Number)) {
        const f = await open(page, script.text, line);
        for (const step of [1, 2]) {
          await show(f, step, true);
          assert.ok((await argvs(f)).length > 0);
          assert.deepStrictEqual(await brokenChips(f), [], `${script.text.split('\n')[line - 1]}: depth ${step}`);
        }
      }
    }
    await ctx.close();
  });
});
