// The switch "What the program receives" and the marks of the rows (docs/design/panel-redesign.md, P9), in the web page with CI's fonts: on by default, kept once
// chosen, key W when the focus is in the panel; the words under each command as chips that stay whole, at three widths, in both languages and both themes; the Key lists the marks
// drawn, and only those; a mark "not portable to sh" opens what it says, for a phone and a keyboard.
import * as assert from 'assert';
import type { Browser, Frame, Page } from 'playwright-core';
import { openSite, until } from './support/site';

const PIPE = 'grep -h "$USER" /var/log/*.log | sort | uniq -c';
const IF = 'if [[ -f config.ini && $DEBUG == 1 ]]; then source config.ini; fi';
const TAR = 'tar -czf "$backup" ~/docs 2>/dev/null || echo "failed" >&2';
const LONG = 'cp /very/long/path/with/many/components/that/does/not/break/anywhere-at-all/because/it/has/no/blanks/in/it/at/all/file.tar.gz "$HOME/a very long name here"';

describe('the panel: what the program receives, drawn', function () {
  this.timeout(240000);
  let browser: Browser;
  let base = '';

  before(async function () {
    ({ browser, base } = await openSite(this));
  });

  const panelOf = (page: Page): Frame => page.frames().find((f) => f.url().endsWith('/panel.html'))!;
  async function open(text: string, options: { width?: number; lang?: 'en' | 'ja'; theme?: 'light' | 'dark'; kept?: unknown } = {}): Promise<{ page: Page; panel: Frame }> {
    const ctx = await browser.newContext({ locale: options.lang === 'ja' ? 'ja-JP' : 'en-US', viewport: { width: options.width ?? 1280, height: 800 }, colorScheme: options.theme ?? 'light' });
    if (options.kept) await ctx.addInitScript(`try { localStorage.setItem('bash-explainer-panel', ${JSON.stringify(JSON.stringify(options.kept))}); } catch {}`);
    const page = await ctx.newPage();
    await page.goto(base);
    await until('the panel', () => Promise.resolve(panelOf(page)), (f) => !!f);
    await page.locator('.cm-content').focus();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText(text);
    await page.keyboard.press('Control+Home');
    await until('the line explained', async () => (await panelOf(page).locator('#line').textContent()) ?? '', (t) => t.includes(text.slice(0, 8)));
    return { page, panel: panelOf(page) };
  }
  /** What each command's line says: its lead, then its chips. */
  const lines = (panel: Frame) => panel.evaluate(`[...document.querySelectorAll('#tree .receives')].map((b) => [b.querySelector('.ev-lead').textContent, ...[...b.querySelectorAll('.recv-word')].map((c) => c.textContent)])`) as Promise<string[][]>;
  const checked = (panel: Frame) => panel.locator('#receives').getAttribute('aria-checked');

  it('is on by default, says the words of each command, and tints those received as written', async () => {
    const { page, panel } = await open(PIPE);
    assert.strictEqual(await checked(panel), 'true');
    assert.strictEqual(await panel.locator('#receives-name').textContent(), 'What the program receives');
    await until('the chips', () => lines(panel), (l) => l.length === 3);
    assert.deepStrictEqual(await lines(panel), [
      ['receives:', 'grep', '-h', '‹current user name›', '‹each file name matching /var/log/*.log, else the pattern itself› (not always one word)'],
      ['receives only its name:', 'sort'],
      ['receives:', 'uniq', '-c'],
    ]);
    const tints = await panel.evaluate(`[...document.querySelectorAll('#tree .recv-word')].map((c) => getComputedStyle(c).backgroundColor)`) as string[];
    assert.strictEqual(tints[0], tints[1]);
    assert.strictEqual(tints[2], tints[3]);
    assert.notStrictEqual(tints[0], tints[2]);
    assert.strictEqual(await panel.locator('#tree li[data-key] .label.recv-asWritten').first().textContent(), 'grep');
    await page.context().close();
  });

  it('turns with a press and with W, leaves the rows where they are, and is kept for the next visit once chosen', async () => {
    const { page, panel } = await open(PIPE);
    await until('the chips', () => lines(panel), (l) => l.length === 3);
    // (Not kept while it was not chosen.)
    const kept = () => page.evaluate(`JSON.parse(localStorage.getItem('bash-explainer-panel') ?? '{}').receives`);
    assert.strictEqual(await kept(), undefined);
    await panel.locator('#receives').click();
    await until('no chips', () => lines(panel), (l) => l.length === 0);
    assert.strictEqual(await checked(panel), 'false');
    assert.strictEqual(await panel.locator('#tree .mk-handled').count(), 0);
    assert.strictEqual(await panel.locator('#tree .recv-asWritten').count(), 0);
    assert.strictEqual(await kept(), false);
    await until('it is said', () => panel.locator('#said').textContent(), (t) => t === 'Not showing what each program receives');
    await panel.locator('#receives').focus();
    await page.keyboard.press('w');
    await until('the chips again', () => lines(panel), (l) => l.length === 3);
    assert.strictEqual(await checked(panel), 'true');
    assert.strictEqual(await kept(), true);
    await page.keyboard.press('Shift+W');
    await until('no chips', () => lines(panel), (l) => l.length === 0);
    await page.reload();
    await until('the panel', () => Promise.resolve(panelOf(page)), (f) => !!f);
    await until('the line', () => panelOf(page).locator('#line').textContent(), (t) => !!t);
    assert.strictEqual(await checked(panelOf(page)), 'false');
    assert.strictEqual(await panelOf(page).locator('#tree .receives').count(), 0);
    await page.context().close();
  });

  it('keeps the words whole and nothing over the side at each width, language and theme', async () => {
    for (const width of [390, 640, 1280]) {
      for (const lang of ['en', 'ja'] as const) {
        for (const theme of ['light', 'dark'] as const) {
          for (const text of [PIPE, TAR, LONG]) {
            const { page, panel } = await open(text, { width, lang, theme, kept: { depth: 2 } });
            await until('the chips', () => panel.locator('#tree .recv-word').count(), (n) => n > 0);
            const m = await panel.evaluate(`(() => {
              const side = document.documentElement.clientWidth;
              const line = parseFloat(getComputedStyle(document.querySelector('.receives')).lineHeight) || 24;
              return {
                over: document.documentElement.scrollWidth - side,
                out: [...document.querySelectorAll('.recv-word, .mk, #receives, #key-open')].filter((e) => { const r = e.getBoundingClientRect(); return r.right > side + 1 || r.left < 0; }).map((e) => e.textContent),
                // (A word wraps only when it is as wide as what holds it, less the gap after it: then, and only then, it is taller than a line.)
                split: [...document.querySelectorAll('.recv-word')].filter((e) => { const r = e.getBoundingClientRect(); const room = e.closest('.text').getBoundingClientRect().width; return r.height > line * 1.6 && r.width < room - parseFloat(getComputedStyle(e).marginRight) - 2; }).map((e) => e.textContent),
                marks: [...document.querySelectorAll('.mk')].filter((e) => e.getBoundingClientRect().height > line * 1.3).map((e) => e.textContent),
              };
            })()`) as { over: number; out: string[]; split: string[]; marks: string[] };
            assert.deepStrictEqual(m, { over: 0, out: [], split: [], marks: [] }, `${width} ${lang} ${theme} ${text.slice(0, 12)}`);
            await page.context().close();
          }
        }
      }
    }
  });

  // (The UX review of main: the chips of a long line read as a table row, with the darkest edges of the panel, nearly touching, and one alone on the last row.)
  it('draws the chips as a list: a lighter edge, a gap of 3 to 4 px, and none alone on the last row of a wrapped row', async () => {
    const LINE8 = 'grep -rn "ERROR $USER" ./src 2>&1 | sort -u > errors.txt && echo "done: $(date +%F)" || exit 1';
    for (const width of [390, 1280]) {
      for (const lang of ['en', 'ja'] as const) {
        for (const theme of ['light', 'dark'] as const) {
          const { page, panel } = await open(LINE8, { width, lang, theme, kept: { depth: 2 } });
          await until('the chips', () => panel.locator('#tree .recv-word').count(), (n) => n > 0);
          const m = await panel.evaluate(`(() => {
            const out = { gaps: [], alone: [], alpha: [] };
            for (const box of document.querySelectorAll('#tree .receives-words')) {
              const rows = [];
              for (const c of box.children) {
                const r = c.getBoundingClientRect();
                const row = rows.find((x) => Math.abs(x[0].y - r.y) < 3);
                if (row) row.push(r); else rows.push([r]);
              }
              for (const row of rows) row.slice(1).forEach((r, i) => out.gaps.push(r.x - row[i].right));
              // (The lead is on the first row beside the first chips: a chip alone on the last row of several is what the rule avoids.)
              if (rows.length > 1 && rows[rows.length - 1].length === 1 && rows.some((x) => x.length > 1)) out.alone.push(box.lastElementChild.textContent);
              for (const c of box.children) { const s = getComputedStyle(c); out.alpha.push(/ \\/ ([\\d.]+)\\)$/.exec(s.borderTopColor)?.[1] ?? '1'); }
            }
            return out;
          })()`) as { gaps: number[]; alone: string[]; alpha: string[] };
          const at = `${width} ${lang} ${theme}`;
          assert.ok(m.gaps.length > 0 && m.gaps.every((g) => g >= 3 && g <= 4.5), `${at}: gaps ${m.gaps.join(' ')}`);
          assert.deepStrictEqual(m.alone, [], at);
          assert.ok(m.alpha.every((a) => Number(a) < 0.6), `${at}: the edges are light: ${m.alpha.join(' ')}`);
          await page.context().close();
        }
      }
    }
  });

  it('has the Key list the marks drawn, and only those', async () => {
    /** Which of the Key's marks the rows draw, by the Key's id. */
    const FOUND = `(() => {
      const has = (s) => !!document.querySelector('#tree ' + s);
      const rows = [...document.querySelectorAll('#tree .row')];
      return {
        'mark:handled': has('.mk-handled'), 'mark:notPosix': has('.mk-posix'), 'received:asWritten': has('.recv-asWritten'), 'received:changed': has('.recv-changed'), 'received:hole': has('.recv-word .ph'), 'received:many': has('.recv-many'),
        'frame:command': has('.frame-command'), 'frame:compound': has('.frame-compound'), 'frame:group': has('.frame-group'),
        'name:program': has('.nk-program'), 'name:builtin': has('.nk-builtin'), 'name:keyword': has('.nk-keyword'), 'name:function': has('.nk-function'),
        roleLine: has('.role-line'),
      };
    })()`;
    for (const [text, depth] of [[PIPE, 1], [IF, 2], [TAR, 1]] as const) {
      const { page, panel } = await open(text, { kept: { depth } });
      await until('the rows', () => panel.locator('#tree li[data-key]').count(), (n) => n > 0);
      await panel.locator('#key-open').click();
      assert.strictEqual(await panel.locator('#key-open').getAttribute('aria-expanded'), 'true');
      const ids = await panel.evaluate(`[...document.querySelectorAll('#key li')].map((li) => li.dataset.keyId)`) as string[];
      const found = await panel.evaluate(FOUND) as Record<string, boolean>;
      for (const [id, on] of Object.entries(found)) assert.strictEqual(ids.includes(id), on, `${text.slice(0, 8)}: ${id}, the Key: ${ids.join(' ')}`);
      assert.ok(ids.every((id) => id.includes(':') ? id in found || /^(level|role|name):/.test(id) : true), ids.join(' '));
      await page.keyboard.press('Control+End');
      await panel.locator('#receives').click();
      await until('the switch off', () => panel.locator('#tree .receives').count(), (n) => n === 0);
      const off = await panel.evaluate(`[...document.querySelectorAll('#key li')].map((li) => li.dataset.keyId)`) as string[];
      assert.deepStrictEqual(off.filter((id) => id.startsWith('received') || id === 'mark:handled'), [], 'what the switch drew goes with it');
      await panel.locator('#key-open').click();
      assert.strictEqual(await panel.locator('#key').isHidden(), true);
      await page.context().close();
    }
  });

  it('marks a construct once at both depths, and "not portable to sh" opens what it says', async () => {
    const { page, panel } = await open(IF);
    const marked = () => panel.evaluate(`[...document.querySelectorAll('#tree .mk-handled')].map((m) => m.closest('.row').querySelector('.label').textContent)`) as Promise<string[]>;
    await until('depth 1', () => marked(), (m) => m.length === 2);
    assert.deepStrictEqual(await marked(), ['if condition then commands fi', '[[ expression ]]']);
    await panel.locator('#receives').focus();
    await page.keyboard.press('2');
    await until('depth 2', () => panel.evaluate('document.body.dataset.depth'), (d) => d === '2');
    assert.deepStrictEqual(await marked(), ['if condition then commands fi', '[[ expression ]]']);
    const posix = panel.locator('#tree .mk-posix');
    assert.deepStrictEqual(await posix.allTextContents(), ['not portable to sh', 'not portable to sh']);
    const first = posix.first();
    assert.strictEqual(await first.getAttribute('aria-expanded'), 'false');
    const rowCount = await panel.locator('#tree li[data-key]').count();
    await first.click();
    assert.strictEqual(await first.getAttribute('aria-expanded'), 'true');
    assert.strictEqual(await panel.locator('.posix-said:visible').textContent(), '[[ ]] is not POSIX sh (it fails in dash). Instead, use [ ].');
    assert.strictEqual(await panel.locator('#tree li[data-key]').count(), rowCount, 'it does not fold the row');
    await first.press('Enter');
    assert.strictEqual(await panel.locator('.posix-said:visible').count(), 0);
    // (Key W with the focus on it: the same mark has the focus after the switch turns, and a key held down turns it once.)
    await first.focus();
    await page.keyboard.press('w');
    await until('the switch off', () => checked(panel), (c) => c === 'false');
    await until('the rows again', () => lines(panel), (l) => l.length === 0);
    assert.strictEqual(await panel.evaluate(`document.activeElement.classList.contains('mk-posix')`), true);
    await page.keyboard.down('w');
    await until('the switch on', () => checked(panel), (c) => c === 'true');
    await page.keyboard.down('w');
    await page.keyboard.down('w');
    await page.keyboard.up('w');
    await page.waitForTimeout(100);
    assert.strictEqual(await checked(panel), 'true', 'a repeat of the key does not turn it again');
    await page.context().close();
  });

  it('keeps the first row on the screen where it is when the switch turns', async () => {
    const { page, panel } = await open(PIPE, { width: 390, kept: { depth: 2 } });
    await until('the chips', () => lines(panel), (l) => l.length === 3);
    const rowTop = `[...document.querySelectorAll('#tree .frame-command > .row')].at(-1).getBoundingClientRect().top`;
    await panel.evaluate(`[...document.querySelectorAll('#tree .frame-command > .row')].at(-1).scrollIntoView({ block: 'center' })`);
    await page.waitForTimeout(100);
    const before = await panel.evaluate(rowTop) as number;
    await panel.evaluate(`document.getElementById('receives').click()`);
    await until('no chips', () => lines(panel), (l) => l.length === 0);
    await page.waitForTimeout(300);
    const after = await panel.evaluate(rowTop) as number;
    assert.ok(Math.abs(after - before) < 40, `${before} → ${after}`);
    await page.context().close();
  });

  describe('the mark of a space at an end of a word', () => {
    // A line with every kind: a space beside a placeholder (shown as it is) and at the ends of the word (marked), and a value with a space at an end.
    const SPACES = `a=' a '; echo "ERROR $USER" "$USER " " $USER" "$a $b" "a  $USER" " " "  "`;

    it('is drawn at the ends of a word only, with its name as a tooltip; a space beside a placeholder is a plain one, as wide as it is', async () => {
      const { page, panel } = await open(SPACES.replace("a=' a '; ", ''));
      await until('the chips', () => lines(panel), (l) => l.length === 1 && l[0].length > 4);
      const chips = await panel.evaluate(`[...document.querySelectorAll('#tree .recv-word')].map((c) => ({
        text: c.textContent, marks: [...c.querySelectorAll('.ev-sp')].map((m) => [m.title, m.getAttribute('aria-label'), [...c.children].indexOf(m)]),
        white: getComputedStyle(c).whiteSpace }))`) as { text: string; marks: [string, string, number][]; white: string }[];
      // (A mark holds a real space, which `textContent` reads; where it stands is told by `marks`.)
      assert.deepStrictEqual(chips.map((c) => c.text), ['ERROR ‹current user name›', '‹current user name› ', ' ‹current user name›', '‹value of $a› ‹value of $b›', 'a  ‹current user name›', ' ', '  ']);
      assert.deepStrictEqual(chips.map((c) => c.marks.length), [0, 1, 1, 0, 0, 1, 2]);
      assert.deepStrictEqual(chips[1].marks[0], ['space', 'space', 1]);
      assert.deepStrictEqual(chips[2].marks[0], ['space', 'space', 0]);
      for (const c of chips) assert.ok(c.white === 'pre-wrap' || c.white === 'pre', c.white);
      // A plain space keeps its width: `a  ` before the placeholder is as wide as two spaces.
      const widths = await panel.evaluate(`(() => {
        const t = [...document.querySelectorAll('#tree .recv-word')][4].firstChild;
        const r = document.createRange();
        r.setStart(t, 1); r.setEnd(t, 3);
        const two = r.getBoundingClientRect().width;
        r.setStart(t, 1); r.setEnd(t, 2);
        return [two, r.getBoundingClientRect().width];
      })()`) as number[];
      assert.ok(widths[1] > 1 && Math.abs(widths[0] - 2 * widths[1]) < 1, `${widths}`);
      await page.context().close();
    });

    for (const lang of ['en', 'ja'] as const) {
      it(`names the mark (${lang}) in a tooltip`, async () => {
        const { page, panel } = await open(SPACES.replace("a=' a '; ", ''), { lang });
        await until('the chips', () => lines(panel), (l) => l.length === 1 && l[0].length > 4);
        const titles = await panel.evaluate(`[...document.querySelectorAll('#tree .ev-sp')].map((m) => m.title + '|' + m.getAttribute('aria-label'))`) as string[];
        const name = lang === 'ja' ? '空白' : 'space';
        assert.ok(titles.length >= 5, String(titles.length));
        for (const t of titles) assert.strictEqual(t, `${name}|${name}`);
        await page.context().close();
      });
    }

    // Where the mark appears: the chips of the receives line, the value line of an expansion (depth 2), and a note that shows it. Its bottom is on the baseline of the text beside it.
    for (const [lang, theme, depth] of [['en', 'light', 1], ['ja', 'dark', 1], ['en', 'dark', 2], ['ja', 'light', 2]] as const) {
      it(`sits on the baseline of the text (${lang}, ${theme}, depth ${depth})`, async () => {
        const text = lang === 'ja' ? `a=' あ '; echo "日本語 $USER " "あ $a" "$a"` : SPACES;
        const { page, panel } = await open(text, { lang, theme, kept: { depth } });
        await until('the chips', () => lines(panel), (l) => l.length > 0 && l[0].length > 3);
        const got = await panel.evaluate(`(() => [...document.querySelectorAll('#tree .ev-sp')].map((m) => {
          // A probe of no size beside the mark, on the baseline: its bottom is where the text's letters stand.
          const probe = document.createElement('span');
          probe.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
          m.parentNode.insertBefore(probe, m);
          const base = probe.getBoundingClientRect().bottom;
          probe.remove();
          const r = m.getBoundingClientRect();
          return { bottom: r.bottom, base, h: r.height, where: m.closest('.receives') ? 'receives' : m.closest('.ev-value') ? 'value' : 'note' };
        }))()`) as { bottom: number; base: number; h: number; where: string }[];
        assert.ok(got.some((g) => g.where === 'receives'), JSON.stringify(got));
        for (const g of got) {
          assert.ok(g.h > 2, JSON.stringify(g));
          assert.ok(Math.abs(g.bottom - g.base) <= 1, `${g.where}: the mark's bottom is ${g.bottom - g.base} px from the baseline`);
        }
        if (depth === 2) assert.ok(got.some((g) => g.where !== 'receives'), 'the mark in a value or a note too');
        if (process.env.BASH_EXPLAINER_SHOT_DIR) await page.screenshot({ path: `${process.env.BASH_EXPLAINER_SHOT_DIR}/mark-${lang}-${theme}-${depth}.png` });
        await page.context().close();
      });
    }
  });
});
