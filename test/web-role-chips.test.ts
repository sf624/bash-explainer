// What a row of depth 2 says of a part beyond its role line (docs/design/panel-redesign.md, P8, "The names on a role line"): a name is a button, for the
// keyboard, a phone and a pointer alike; and what the depth does to a screen reader and to the keyboard's focus. In the panel's page (VS Code's), and with
// the web page's storage refused.
import * as assert from 'assert';
import type { Browser, Page } from 'playwright-core';
import { servePanel, type PanelServer } from './support/panel-page';
import { chooseDepth, openSite, until } from './support/site';

const LONG = 'echo "a $b" "c $d" $e $f $g $h $i $j $k $l $m $n $o $p $q $r $s $t $u $v $w $x $y $z >/dev/null 2>&1';
const PIPE = 'grep -h "$USER" /var/log/*.log | sort | uniq -c | sort -rn | head -5';
const AWK = "awk -F: '$3 >= 1000 && $7 !~ /nologin/ {print $1, $3}' /etc/passwd | sed -E 's/^([a-z]+) ([0-9]+)$/{\"user\":\"\\1\",\"uid\":\\2}/' | jq -s 'map(select(.uid > 1000)) | sort_by(.uid) | .[0:5]'";

/** The stops of the Tab order in the rows and around them. */
const STOPS = `[...document.querySelectorAll('#main a[href], #main button, #main summary, #main input, #main textarea, #main [tabindex]')].filter((e) => e.getClientRects().length && e.tabIndex >= 0).length`;

describe('the panel at depth 2: the names on a role line, the depth and the focus', function () {
  this.timeout(240000);
  let browser: Browser;
  let base = '';
  const servers = new Map<string, PanelServer>();
  const serve = async (line: string): Promise<PanelServer> => {
    if (!servers.has(line)) servers.set(line, await servePanel(line, 'p.sh'));
    return servers.get(line)!;
  };

  before(async function () {
    ({ browser, base } = await openSite(this));
  });
  after(async () => {
    for (const s of servers.values()) await s.close();
  });

  /** The panel's page for `line`, at a depth, with its rows drawn. */
  async function open(line: string, options: { width?: number; height?: number; lang?: 'en' | 'ja'; depth?: 1 | 2; touch?: boolean; theme?: 'dark' | 'light' } = {}): Promise<Page> {
    const server = await serve(line);
    const ctx = await browser.newContext({ viewport: { width: options.width ?? 600, height: options.height ?? 800 }, hasTouch: options.touch });
    const page = await ctx.newPage();
    await page.goto(server.url(options.theme ?? 'dark', options.lang ?? 'en', options.depth ?? 2));
    await until('the rows', () => page.locator('#tree .row').count(), (n) => n > 0);
    return page;
  }
  const depthDrawn = (page: Page, depth: number) => until(`depth ${depth}`, () => page.evaluate('document.body.dataset.depth'), (d) => d === String(depth));
  const rowOf = (page: Page, label: string) => page.locator('#tree li[data-key]').filter({ has: page.locator(`:scope > .item > .row > .code .label:text-is(${JSON.stringify(label)})`) }).first();
  const chipOf = (page: Page, label: string, name: string) => rowOf(page, label).locator(`> .item > .row .role-chip:text-is(${JSON.stringify(name)})`);

  it('names a mixed AND/OR list by both on its row, and opens its long description', async () => {
    const line = 'grep -rn "ERROR $USER" ./src 2>&1 | sort -u > errors.txt && echo "done: $(date +%F)" || exit 1';
    for (const [lang, name, start] of [['en', 'AND and OR list', 'An AND and OR list: `&&` and `||` mixed'], ['ja', 'AND・OR リスト', 'AND・OR リスト: `&&` と `||` が混ざった']] as const) {
      const page = await open(line, { lang });
      const label = 'grep | sort && echo || exit';
      assert.strictEqual(await chipOf(page, label, name).count(), 1, `${lang}: the row of the list names both`);
      assert.strictEqual(await rowOf(page, label).locator('> .item > .row .role-chip').count(), 1);
      const chip = chipOf(page, label, name);
      await chip.click();
      const said = page.locator(`#${await chip.getAttribute('aria-controls')}`);
      assert.ok((await said.textContent())!.replace(/`/g, '').startsWith(start.replace(/`/g, '')), `${lang}: ${await said.textContent()}`);
      await page.context().close();
    }
  });

  it('opens a name with a click, with Enter and with a tap, under its line, and leaves the row as it is', async () => {
    const page = await open('grep -q x f', { width: 390, touch: true });
    const row = rowOf(page, '-q');
    const chip = chipOf(page, '-q', 'argument');
    assert.strictEqual(await chip.evaluate((e) => e.tagName), 'BUTTON');
    // One route for everyone: no tooltip holds the text.
    assert.strictEqual(await page.locator('.role-chip[title]').count(), 0);
    assert.strictEqual(await chip.getAttribute('aria-expanded'), 'false');
    const said = page.locator(`#${await chip.getAttribute('aria-controls')}`);
    assert.strictEqual(await said.isVisible(), false);
    const before = await page.evaluate('document.body.innerText.length') as number;
    // A tap.
    await chip.tap();
    assert.strictEqual(await chip.getAttribute('aria-expanded'), 'true');
    assert.match((await said.textContent())!, /^An argument: bash expands it/);
    assert.strictEqual(await said.isVisible(), true);
    assert.strictEqual(await page.locator('#tree li.collapsed').count(), 0, 'it folds nothing');
    assert.ok(await page.evaluate('document.body.innerText.length') as number > before);
    // Under the line.
    const [line, text] = await Promise.all([row.locator('> .item > .row .role-line').boundingBox(), said.boundingBox()]);
    assert.ok(text!.y >= line!.y, 'inside the line\'s box, under its names');
    const names = await chip.boundingBox();
    // (A name's box is taller than its line on a touch screen, for the finger.)
    assert.ok(text!.y >= names!.y + names!.height / 2, `${text!.y} under ${names!.y + names!.height / 2}`);
    // Again: it closes.
    await chip.tap();
    assert.strictEqual(await said.isVisible(), false);
    assert.strictEqual(await chip.getAttribute('aria-expanded'), 'false');
    // A click, and the other name of the line takes its place.
    await chip.click();
    const other = chipOf(page, '-q', 'option');
    await other.click();
    assert.strictEqual(await chip.getAttribute('aria-expanded'), 'false');
    assert.strictEqual(await other.getAttribute('aria-expanded'), 'true');
    assert.strictEqual((await said.textContent())!.startsWith('grep reads it, not bash'), true);
    await other.click();
    // The keyboard: Enter, and the arrows from name to name: one stop for the line.
    await chip.focus();
    await page.keyboard.press('Enter');
    assert.strictEqual(await chip.getAttribute('aria-expanded'), 'true');
    assert.strictEqual(await page.evaluate('document.activeElement.textContent'), 'argument', 'it keeps the focus');
    await page.keyboard.press('ArrowRight');
    assert.strictEqual(await page.evaluate('document.activeElement.textContent'), 'option');
    await page.keyboard.press('ArrowRight');
    assert.strictEqual(await page.evaluate('document.activeElement.textContent'), 'argument', 'round to the first');
    await page.keyboard.press('ArrowLeft');
    assert.strictEqual(await page.evaluate('document.activeElement.textContent'), 'option');
    assert.deepStrictEqual(await row.locator('> .item > .row .role-chip').evaluateAll((cs) => cs.map((c) => (c as unknown as { tabIndex: number }).tabIndex)), [-1, 0]);
    await page.keyboard.press('a');
    assert.strictEqual(await page.evaluate('document.activeElement.textContent'), 'option', 'another key does nothing');
    await page.context().close();
  });

  it('gives a tap on a name\'s text no fold, and a tap on the rest of a row its fold', async () => {
    const page = await open('tar -czf x y', { width: 390, touch: true });
    const chip = chipOf(page, '-czf', 'argument');
    await chip.tap();
    const said = page.locator(`#${await chip.getAttribute('aria-controls')}`);
    await said.tap();
    assert.strictEqual(await page.locator('#tree li.collapsed').count(), 0);
    await rowOf(page, '-czf').locator('> .item > .row > .code .label').tap();
    assert.strictEqual(await page.locator('#tree li.collapsed').count(), 1);
    await page.context().close();
  });

  it('holds the sections of a role line in what its name opens to, and gives the whole line and a here-document their texts', async () => {
    const page = await open('tar -czf "$x" y', { width: 390 });
    const line = rowOf(page, '"$x"').locator('> .item > .row .role-line');
    assert.strictEqual(await line.locator('a').count(), 0, 'no link while it is closed');
    await line.locator('.role-chip').first().click();
    assert.ok(await line.locator('.refs a').count() > 0, 'its sections, when it is open');
    assert.match((await line.locator('.refs a').first().getAttribute('href'))!, /^https:/);
    // The line's own.
    const whole = page.locator('#line-role .role-chip');
    assert.strictEqual(await whole.textContent(), 'bash reads the line');
    await whole.click();
    assert.match((await page.locator('#line-role .role-said').textContent())!, /^bash splits the line into commands/);
    await page.keyboard.press('Enter');
    assert.strictEqual(await page.locator('#line-role .role-said').isVisible(), false);
    await page.keyboard.press('1');
    await depthDrawn(page, 1);
    assert.strictEqual(await page.locator('#line-role .role-chip').count(), 0, 'not at depth 1');
    await page.context().close();
    const here = await open('cat <<E\nhello\nE', { width: 390 });
    await chipOf(here, '<<E', 'here-document').click();
    assert.match((await rowOf(here, '<<E').locator('> .item > .row .role-said').textContent())!, /^The body of the here-document/);
    await here.context().close();
  });

  it('keeps a name open when the line is drawn again, at either depth; another line opens none, and a name gone leaves nothing behind', async () => {
    const page = await open('grep -q x f', { width: 600 });
    const chip = chipOf(page, '-q', 'argument');
    await chip.focus();
    await page.keyboard.press('Enter');
    const update = `window.DEEP[document.documentElement.lang]`;
    // The same rows again (another message of the same line): open, with the focus.
    await page.evaluate(`window.postMessage({ ...${update}, marks: [{ x: 1 }], around: [] }, '*')`).catch(() => undefined);
    await page.evaluate(`window.postMessage({ ...${update}, file: 'p.sh', settingsLabel: 'again' }, '*')`);
    await page.waitForTimeout(100);
    assert.strictEqual(await chipOf(page, '-q', 'argument').getAttribute('aria-expanded'), 'true');
    assert.strictEqual(await page.evaluate('document.activeElement.textContent'), 'argument', 'the focus comes back to the name');
    // Depth 1 and back.
    await page.keyboard.press('1');
    await depthDrawn(page, 1);
    await page.locator('#main').evaluate((e) => { (e as unknown as { tabIndex: number }).tabIndex = -1; (e as unknown as { focus(): void }).focus(); });
    await page.keyboard.press('2');
    await depthDrawn(page, 2);
    await until('the name open', () => chipOf(page, '-q', 'argument').getAttribute('aria-expanded'), (v) => v === 'true');
    // The rows of the same line without that name: it is forgotten, and does not come back with them.
    await page.evaluate(`(() => { const m = JSON.parse(JSON.stringify(${update})); const walk = (r) => { if (r.roleLine) r.roleLine.chips = r.roleLine.chips.filter((c) => c.text !== 'argument'); r.children.forEach(walk); }; m.rows.forEach(walk); m.settingsLabel = 'without'; window.postMessage(m, '*'); })()`);
    await until('the name gone', () => chipOf(page, '-q', 'argument').count(), (n) => n === 0);
    await page.evaluate(`window.postMessage({ ...${update}, settingsLabel: 'with' }, '*')`);
    await until('the name back', () => chipOf(page, '-q', 'argument').count(), (n) => n === 1);
    assert.strictEqual(await chipOf(page, '-q', 'argument').getAttribute('aria-expanded'), 'false');
    // Another line.
    await chipOf(page, '-q', 'argument').click();
    await page.evaluate(`window.postMessage({ ...${update}, file: 'other.sh' }, '*')`);
    await until('the other file', () => page.locator('#where').textContent(), (t) => !!t?.startsWith('other.sh'));
    assert.strictEqual(await chipOf(page, '-q', 'argument').getAttribute('aria-expanded'), 'false');
    await page.context().close();
  });

  it('says in its words that a step does nothing: no strike-through to read, at any depth of a screen reader', async () => {
    for (const [lang, want, text] of [
      ['en', 'parameter expansion → no word splitting or globbing (quoted) → quote removal', 'bash\'s steps:'],
      ['ja', 'パラメータ展開 → 単語分割・グロブはしない（クォート内） → クォート除去', 'bash の手順:'],
    ] as const) {
      const page = await open('echo "$b"', { lang });
      const steps = rowOf(page, '"$b"').locator('> .item > .row .steps');
      assert.strictEqual((await steps.textContent())!.replace(/\s+/g, ' '), `${text} ${want}`);
      assert.strictEqual(await page.locator('#tree s').count(), 0);
      await page.context().close();
    }
  });

  it('tells a screen reader the depth, whichever control chose it', async () => {
    const page = await open('ls -l', { depth: 1 });
    const said = page.locator('#said');
    assert.strictEqual(await said.getAttribute('aria-live'), 'polite');
    assert.strictEqual(await said.textContent(), '', 'nothing on the first drawing');
    await page.locator('#main').evaluate((e) => { (e as unknown as { tabIndex: number }).tabIndex = -1; (e as unknown as { focus(): void }).focus(); });
    await page.keyboard.press('2');
    await until('depth 2 said', () => said.textContent(), (t) => t === 'Depth: Word by word (How bash reads it, word by word)');
    await page.locator('#view-depth1').click();
    await until('depth 1 said', () => said.textContent(), (t) => t === 'Depth: Overview (What it does)');
    await page.context().close();
    const ja = await open('ls -l', { depth: 2, lang: 'ja' });
    await ja.locator('#view-depth1').click();
    await until('depth 1 said', () => ja.locator('#said').textContent(), (t) => t === '深さ: 概要（何をするか）');
    await ja.context().close();
  });

  it('marks the row with the keyboard\'s focus, and its characters in the line, as a pointer on it does', async () => {
    for (const depth of [1, 2] as const) {
      const page = await open('grep -q x f | sort', { depth });
      const active = () => page.evaluate(`[document.querySelectorAll('#tree .row.active').length, document.querySelectorAll('#line .active').length]`) as Promise<number[]>;
      assert.deepStrictEqual(await active(), [0, 0]);
      const first = page.locator('#tree button.twisty, #tree .role-chip, #tree a').first();
      await first.focus();
      const [rows, chars] = await active();
      assert.strictEqual(rows, 1);
      assert.ok(chars > 0, 'its characters in the line');
      const posted = await page.evaluate(`window.POSTED.filter((m) => m.type === 'highlight').pop()`) as { span: unknown };
      assert.ok(posted.span, 'its range in the editor');
      // The pointer goes by and comes off: the focus keeps its mark.
      const other = page.locator('#tree .row').last();
      await other.hover();
      await page.mouse.move(0, 0);
      assert.strictEqual((await active())[0], 1);
      // The focus goes.
      await page.locator('#copy').focus();
      assert.deepStrictEqual(await active(), [0, 0]);
      await page.context().close();
    }
    // A pointer's press marks nothing that stays when it goes.
    const page = await open('grep -q x f | sort');
    await page.locator('#tree button.twisty').first().click();
    await page.mouse.move(0, 0);
    assert.strictEqual(await page.locator('#tree .row.active').count(), 0);
    await page.context().close();
  });

  it('moves the focus to the row that owns it when its row goes with the depth, and the next Tab goes on from there', async () => {
    const page = await open('a | b');
    // (`|` has a row at depth 2 only, and no fold button: its role's name has the focus.)
    await rowOf(page, '|').locator('> .item > .row .role-chip').first().focus();
    await page.keyboard.press('1');
    await depthDrawn(page, 1);
    const owner = () => page.evaluate(`document.activeElement.closest('li[data-key]')?.querySelector(':scope > .item > .row .label').textContent`);
    assert.strictEqual(await owner(), 'a | b');
    assert.strictEqual(await page.evaluate('document.activeElement.matches("button.twisty")'), true, 'its fold button');
    // The next Tab goes on inside the rows, not from the top of the page.
    await page.keyboard.press('Tab');
    assert.strictEqual(await page.evaluate(`document.getElementById('tree').contains(document.activeElement)`), true);
    await page.context().close();
    // With no fold button: the row itself, which marks it.
    const flat = await open('a; b');
    await rowOf(flat, ';').locator('> .item > .row .role-chip').first().focus();
    await flat.keyboard.press('1');
    await depthDrawn(flat, 1);
    assert.strictEqual(await flat.evaluate('document.activeElement.tagName'), 'BUTTON', 'the list\'s fold button');
    await flat.context().close();
    const alone = await open('ls >x');
    await rowOf(alone, '>x').locator('> .item > .row > button.twisty').click();
    await alone.waitForTimeout(600);
    await rowOf(alone, '>').locator('> .item > .row .role-chip').first().focus();
    await alone.keyboard.press('1');
    await depthDrawn(alone, 1);
    assert.notStrictEqual(await alone.evaluate('document.activeElement.tagName'), 'BODY');
    assert.strictEqual(await alone.locator('#tree .row.active').count(), 1, 'its row marked');
    await alone.context().close();
  });

  for (const [width, height] of [[390, 400], [640, 500], [1280, 500]] as const) {
    it(`holds an example where it is when only it is on the screen, and the depth changes, ${width} px`, async () => {
      const page = await open("jq '.items[] | select(.ok) | .name' data.json", { width, height, depth: 1 });
      const example = page.locator('#tree .example').first();
      await example.evaluate((e) => (e as unknown as { scrollIntoView(o: unknown): void }).scrollIntoView({ block: 'start' }));
      const bar = await page.evaluate(`document.getElementById('top').getBoundingClientRect().bottom`) as number;
      // (Below the sticky rows, with no row on the screen.)
      const box = await example.boundingBox();
      await page.evaluate(`window.scrollBy(0, ${box!.y - bar - 10 + 30})`);
      await page.waitForTimeout(50);
      const rows = await page.evaluate(`[...document.querySelectorAll('#tree .row')].filter((r) => { const b = r.getBoundingClientRect(); return b.bottom > ${bar} && b.top < innerHeight; }).length`) as number;
      if (rows === 0) {
        const at = (await example.boundingBox())!.y;
        await page.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: '2', bubbles: true }))`);
        await depthDrawn(page, 2);
        await page.waitForTimeout(350);
        const now = (await page.locator('#tree .example').first().boundingBox())!.y;
        assert.ok(Math.abs(now - at) <= 2, `${at} to ${now}`);
      } else assert.ok(width > 390, `${rows} rows on the screen at ${width}`);
      await page.context().close();
    });
  }

  it('works when the browser refuses storage: the depth is chosen, the names open', async () => {
    const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript(`(() => {
      const refuse = () => { throw new DOMException('refused', 'SecurityError'); };
      Storage.prototype.getItem = refuse;
      Storage.prototype.setItem = refuse;
      Storage.prototype.removeItem = refuse;
    })()`);
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base);
    await until('the panel', () => Promise.resolve(page.frames().find((f) => f.url().endsWith('/panel.html'))), (f) => !!f);
    const panel = page.frames().find((f) => f.url().endsWith('/panel.html'))!;
    await page.locator('.cm-content').focus();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText('echo hi | cat');
    await until('the rows', () => panel.locator('#tree .row').count(), (n) => n > 0);
    await chooseDepth(page, 2);
    await until('the role lines', () => panel.locator('.role-line').count(), (n) => n > 0);
    await panel.locator('.role-chip').first().click();
    assert.strictEqual(await panel.locator('.role-said:visible').count(), 1);
    await chooseDepth(page, 1);
    await until('depth 1', () => panel.evaluate('document.body.dataset.depth'), (d) => d === '1');
    await chooseDepth(page, 2);
    await until('depth 2', () => panel.evaluate('document.body.dataset.depth'), (d) => d === '2');
    assert.deepStrictEqual(errors, []);
    await ctx.close();
  });

  it('keeps the Tab order and the page within what it has reached, on long lines', async () => {
    // (What the rows of a line need, in stops and in px of the panel's page, en: panel-redesign.md, "The length budget". A review measured 105 stops and 4,513 px at 390 before the sections went into the names and a general text was said once; the awk line had 98 stops and 5,718 px at 390 before a token inside a language lost its chip. The pipe's fix, out of "More" as the whole line, added about 30 px: usability-9.md, U1.)
    for (const [line, stops, h1280, h390] of [[PIPE, 46, 1210, 1890], [LONG, 64, 1850, 3470], [AWK, 54, 3330, 5280]] as const) {
      for (const [width, budget] of [[1280, h1280], [390, h390]] as const) {
        const page = await open(line, { width });
        await page.waitForTimeout(100);
        assert.ok(await page.evaluate(STOPS) as number <= stops, `${line.slice(0, 20)}: ${await page.evaluate(STOPS)} stops`);
        const h = await page.evaluate(`document.documentElement.scrollHeight`) as number;
        assert.ok(h <= budget, `${line.slice(0, 20)} at ${width}: ${h} px`);
        assert.strictEqual(await page.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), true);
        await page.context().close();
      }
    }
  });
});
