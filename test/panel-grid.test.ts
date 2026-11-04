// The Meaning view's rows in the panel's page (docs/design/panel-redesign.md, P7c): two columns, code and text, with a box around
// each command, in headless Chromium with CI's CJK fonts. What is measured is against the rows' own boxes, never how wide a word is
// in a font (CLAUDE.md). The rows come from the row model alone (src/ui/panelRows.ts): what is drawn is compared with the message.
import * as assert from 'assert';
import type { Browser, Page } from 'playwright-core';
import type { ModelRow } from '../src/ui/panelRows';
import { message, PanelServer, PanelTheme, servePanel } from './support/panel-page';
import { until } from './support/site';

const PIPELINE = 'grep -h "$USER" /var/log/*.log | sort -rn | uniq -c | head -5';
const COMPOUND = 'if [[ -f config.ini && $DEBUG == 1 ]]; then source config.ini; fi';
/** One long word with no blank to wrap at, long names of files and options, a command in a word in a word. */
const LONG = [
  'cat /usr/share/doc/some_very_long_package_name_with_many_parts/examples/configuration_file_template_of_the_package.conf.example',
  'some_very_long_command_name_of_a_tool_nobody_has_ever_heard_of --an-option-with-a-really-long-name=its_value_is_long_too | tee "$(date +%F)-top-errors-of-the-day.txt"',
  'for f in /a/b/*; do echo "$(basename "$(dirname "$f")")" | sed -E "s/(a|b)+/x/g" >> /tmp/a-log-file-with-a-long-name.log; done',
];

/** Each drawn row: its boxes and what would be cut or stick out. */
const ROWS = `[...document.querySelectorAll('#tree .row')].filter((r) => r.getClientRects().length).map((r) => {
  const box = (e) => { const b = e.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom }; };
  const label = r.querySelector(':scope > .code > .label');
  const frame = r.closest('.frame');
  return {
    label: label.textContent, row: box(r), code: box(r.querySelector(':scope > .code')), text: box(r.querySelector(':scope > .text')), frame: frame && box(frame),
    cut: label.scrollWidth > label.clientWidth + 1, lvl: Number(r.closest('li').style.getPropertyValue('--lvl')),
  };
})`;
interface Box { left: number; right: number; top: number; bottom: number }
interface Row { label: string; row: Box; code: Box; text: Box; frame: Box | null; cut: boolean; lvl: number }

describe('the panel: the grid and the boxes', function () {
  this.timeout(120000);
  let browser: Browser | undefined;
  const servers: PanelServer[] = [];

  before(async function () {
    if (Number(process.versions.node.split('.')[0]) < 20) return this.skip();
    try {
      const { chromium } = await import('playwright-core');
      browser = await chromium.launch();
    } catch (e) {
      if (process.env.BASH_EXPLAINER_BROWSER) throw e;
      return this.skip();
    }
  });

  after(async () => {
    await browser?.close();
    await Promise.all(servers.map((s) => s.close()));
  });

  async function open(line: string, width = 640, lang: 'en' | 'ja' = 'en', theme: PanelTheme = 'dark'): Promise<Page> {
    const server = await servePanel(line, 'a.sh', true);
    servers.push(server);
    const page = await browser!.newPage({ viewport: { width, height: 700 } });
    await page.goto(server.url(theme, lang));
    await until('the rows', () => page.locator('#tree .row').count(), (n) => n > 0);
    return page;
  }
  const rows = (page: Page) => page.evaluate(ROWS) as Promise<Row[]>;

  for (const lang of ['en', 'ja'] as const) {
    for (const width of [640, 1280]) {
      it(`keeps the text column at one place on every row (${lang}, ${width} px)`, async () => {
        const page = await open(PIPELINE, width, lang);
        const drawn = await rows(page);
        assert.ok(drawn.length >= 8);
        const lefts = new Set(drawn.map((r) => Math.round(r.text.left)));
        assert.strictEqual(lefts.size, 1, `the columns start at ${[...lefts]} in ${JSON.stringify(drawn.map((r) => [r.label, r.text.left]))}`);
        // (And each text beside its code, on the first line of the row.)
        for (const r of drawn) assert.ok(r.text.top < r.code.bottom && r.text.left >= r.code.right - 1, r.label);
        await page.close();
      });
    }

    it(`puts the text under its code on a phone, in one column (${lang}, 390 px)`, async () => {
      for (const line of [PIPELINE, COMPOUND]) {
        const page = await open(line, 390, lang);
        for (const r of await rows(page)) assert.ok(r.text.top >= r.code.bottom - 1, `${r.label} ${JSON.stringify(r)}`);
        await page.close();
      }
    });

    for (const width of [390, 640, 1280]) {
      it(`cuts nothing and lets nothing stick out, with long names (${lang}, ${width} px)`, async () => {
        for (const line of [PIPELINE, COMPOUND, ...LONG]) {
          const page = await open(line, width, lang);
          for (const r of await rows(page)) {
            assert.ok(!r.cut, `${r.label} is cut`);
            for (const part of [r.code, r.text]) {
              assert.ok(part.right <= r.row.right + 0.5, `${r.label} sticks out of its row: ${JSON.stringify(r)}`);
              assert.ok(part.left >= r.row.left - 0.5, `${r.label} sticks out of its row: ${JSON.stringify(r)}`);
            }
            if (r.frame) assert.ok(r.row.right <= r.frame.right + 0.5, `${r.label} sticks out of its frame: ${JSON.stringify(r)}`);
          }
          assert.deepStrictEqual(await page.evaluate('[document.documentElement.scrollWidth <= document.documentElement.clientWidth]'), [true], line);
          await page.close();
        }
      });
    }
  }

  it('gives a word longer than the code column the room it needs, and its text the whole row under it', async () => {
    const page = await open(LONG[0], 640);
    const r = (await rows(page)).find((x) => x.label.startsWith('/usr/share'))!;
    assert.ok(r.text.top >= r.code.bottom - 1);
    // (The text starts under the code, not in the column: it has the row.)
    assert.ok(Math.abs(r.text.left - r.code.left) < 1, JSON.stringify(r));
    await page.close();
  });

  it('draws what the row model says: each row in its order, with its frame, and no other', async () => {
    // (A line with two top rows, and with rows of every kind: the page may neither turn them around nor hide one.)
    const twoTop = 'ls -l "$x" # a note';
    for (const line of [twoTop, PIPELINE, COMPOUND, ...LONG]) {
      const page = await open(line);
      const msg = message('en', line, 'a.sh', true) as { rows: ModelRow[] };
      if (line === twoTop) assert.strictEqual(msg.rows.length, 2);
      const want: [string, string, string][] = [];
      const walk = (rs: readonly ModelRow[], at: string): void => rs.forEach((r, i) => {
        want.push([`${at}${i}`, r.frame ?? '', r.label.replace(/[‹›]/g, '')]);
        walk(r.children, `${at}${i}.`);
      });
      walk(msg.rows, '');
      // (Those a reader sees: a row that is there but hidden is no row.)
      const drawn = await page.evaluate(`[...document.querySelectorAll('#tree .row')].filter((r) => r.getClientRects().length).map((r) => {
        const li = r.closest('li');
        return [li.dataset.path, /frame-(\\w+)/.exec(li.firstElementChild.className)?.[1] ?? '', r.querySelector(':scope > .code > .label').textContent];
      })`);
      assert.deepStrictEqual(drawn, want);
      await page.close();
    }
  });

  it('has a box that holds parts be a group named by its code, with no word for the box', async () => {
    const page = await open(PIPELINE);
    const pipeline = page.getByRole('group', { name: 'grep | sort | uniq | head', exact: true });
    assert.strictEqual(await pipeline.count(), 1);
    assert.strictEqual(await pipeline.getByRole('group', { name: 'grep', exact: true }).count(), 1);
    assert.strictEqual(await pipeline.getByRole('group', { name: 'sort', exact: true }).count(), 1);
    // (A row is a list's item as before, in the group of the command it belongs to.)
    assert.strictEqual(await pipeline.getByRole('listitem').first().evaluate((li) => li.closest('[role=group]')!.getAttribute('aria-labelledby')), 'row-code-0');
    await page.close();
    // (A box of one row has nothing to group: the row says its name.)
    const one = await open('sort');
    assert.strictEqual(await one.locator('.frame-command').count(), 1);
    assert.strictEqual(await one.locator('#tree [role=group]').count(), 0);
    await one.close();
  });

  it('still folds with the keyboard and a pointer, in a box', async () => {
    const page = await open(PIPELINE);
    const part = page.locator('#tree li[data-path="0.0.0"]');
    const twisty = page.locator('#tree li[data-path="0.0"] > .item > .row > button.twisty');
    assert.strictEqual(await twisty.getAttribute('aria-label'), 'Parts of grep');
    await twisty.focus();
    await page.keyboard.press('Enter');
    await until('folded', () => part.isVisible(), (v) => !v);
    assert.strictEqual(await twisty.getAttribute('aria-expanded'), 'false');
    await page.locator('#tree li[data-path="0.0"] > .item > .row > .code > .label').click();
    await until('unfolded', () => part.isVisible(), (v) => v);
    assert.strictEqual(await twisty.getAttribute('aria-expanded'), 'true');
    await page.close();
  });

  it('colours the line box by every token, and a part with no row goes to the row around it', async () => {
    const page = await open(PIPELINE);
    // (`$USER`, in a word, keeps its colour: the line box does not change with the rows of a depth.)
    assert.strictEqual(await page.locator('#line .seg.kind-variable').first().textContent(), '$USER');
    await page.close();
    const line = 'if [ -f a ]; then echo b; fi';
    const p = await open(line);
    const then = p.locator('#line .seg', { hasText: /^then$/ });
    await then.hover();
    await until('its row', () => p.locator('#tree .row.active .label').first().textContent(), (t) => t?.startsWith('if') === true);
    // (All that row covers is lit, the commands in it too.)
    assert.strictEqual(await p.locator('#line .seg.active', { hasText: /^echo$/ }).count(), 1);
    assert.strictEqual(await p.evaluate('window.POSTED.filter((m) => m.type === "highlight").at(-1).span.start.character'), 0);
    await p.close();
  });

  it('folds the example of the whole line above the rows, and keeps it open when the line is drawn again', async () => {
    const page = await open('printf "a\\n" | sort');
    const whole = page.locator('#whole-line details.whole-line');
    assert.strictEqual(await whole.count(), 1);
    assert.strictEqual(await whole.getAttribute('open'), null);
    assert.strictEqual(await page.evaluate(`document.querySelector('#whole-line').compareDocumentPosition(document.querySelector('#tree')) & Node.DOCUMENT_POSITION_FOLLOWING`), 4);
    assert.strictEqual(await page.locator('#tree .example').count(), 0);
    await whole.locator('summary').focus();
    await page.keyboard.press('Enter');
    await until('open', () => whole.getAttribute('open'), (v) => v !== null);
    assert.ok(await whole.locator('.example-label').first().isVisible());
    // (Drawn again: the settings changed, say.)
    await page.evaluate(`window.postMessage({ ...window.MSGS.en, animations: false }, '*')`);
    await until('redrawn', () => page.evaluate(`document.querySelector('#whole-line details').open`), (v) => v === true);
    // (And the focus stays on its title, as it does on a fold button or a link of the rows.)
    assert.strictEqual(await page.evaluate(`document.activeElement === document.querySelector('#whole-line details > summary')`), true);
    await page.close();
  });

  it('forgets on another line which examples were open, and keeps two of one title apart', async () => {
    const page = await open('sort f | uniq; sort g | wc -l');
    const folds = page.locator('#whole-line details.whole-line');
    assert.strictEqual(await folds.count(), 2);
    const titles = await folds.locator('summary').allTextContents();
    assert.strictEqual(titles[0], titles[1]);
    await folds.nth(0).locator('summary').click();
    await until('the first open', () => folds.nth(0).getAttribute('open'), (v) => v !== null);
    assert.strictEqual(await folds.nth(1).getAttribute('open'), null);
    // (The same line again: the first stays open, the second closed.)
    await page.evaluate(`window.postMessage({ ...window.MSGS.en, animations: false }, '*')`);
    await until('redrawn', () => page.evaluate(`document.querySelector('#whole-line details').open`), (v) => v === true);
    assert.strictEqual(await folds.nth(1).getAttribute('open'), null);
    // (Another line, with examples of the same titles.)
    await page.evaluate(`window.postMessage({ ...window.MSGS.en, explanation: { ...window.MSGS.en.explanation, line: 7 } }, '*')`);
    await until('closed on the other line', () => page.evaluate(`[...document.querySelectorAll('#whole-line details')].filter((d) => d.open).length`), (n) => n === 0);
    await page.close();
  });

  it('counts `time` and `!` as parts of the whole line\'s pipeline', async () => {
    for (const line of ['time sort f | uniq', '! sort f | uniq']) {
      const page = await open(line);
      assert.strictEqual(await page.locator('#whole-line details.whole-line').count(), 1, line);
      assert.strictEqual(await page.locator('#tree .example').count(), 0, line);
      await page.close();
    }
  });

  for (const theme of ['dark', 'light', 'hc'] as const) {
    it(`shows the frames against the page (${theme})`, async () => {
      const page = await open(PIPELINE, 640, 'en', theme);
      const [border, bracket, operator, background] = await page.evaluate(`(() => {
        const s = (q) => getComputedStyle(document.querySelector(q));
        const probe = document.createElement('span');
        probe.className = 'kind-operator';
        document.body.append(probe);
        return [s('.frame-command').borderTopColor, s('.frame-group').borderLeftColor, getComputedStyle(probe).color, getComputedStyle(document.body).backgroundColor];
      })()`) as string[];
      assert.notStrictEqual(border, background);
      // (The bracket has a role's colour: no new palette.)
      assert.strictEqual(bracket, operator);
      await page.close();
    });
  }
});
