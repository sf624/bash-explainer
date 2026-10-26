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
    argv: { 2: [['tar', '-czf', '‹home directory›/backup-‹output of date +%F›.tar.gz', '‹home directory›/docs'], ['echo', 'failed']] },
  },
  { text: 'if [[ -f config.ini && $DEBUG == 1 ]]; then source config.ini; fi', lines: [1], argv: { 1: [['source', 'config.ini']] } },
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
          assert.ok(a.words.length > 0, `line ${line}: an empty argv line`);
          const starts = a.spans.map(startOf);
          for (let i = 1; i < starts.length; i++) assert.ok(starts[i] >= starts[i - 1], `line ${line}: argv ${a.words.join(' ')} out of order`);
        }
        if (script.argv?.[line]) assert.deepStrictEqual(a2.map((a) => a.words), script.argv[line], `line ${line}: the argv lines`);
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
});
