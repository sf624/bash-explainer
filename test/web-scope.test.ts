// The web page: the chip of the file type and the shell in the editor's header (docs/design/chrome-redesign.md,
// decision 12, step C5), run for real in headless Chromium with the CJK fonts of CI. Its forms come from
// src/ui/scope.ts (test/scope.test.ts); here the page takes the first that fits, at every width of the editor's pane,
// in both languages and with a long file name, and its popover stays on the screen. Choosing in it is in
// test/web-kind.test.ts.
import * as assert from 'assert';
import type { Browser, Frame, Page } from 'playwright-core';
import { readShell } from '../src/dialect';
import { scopeChip } from '../src/ui/scope';
import { openSite, choose, currentShell, cursorToLine, frames, openSettingsSection, pickKind, setShell, setYq, until } from './support/site';

const KIND = { en: { name: 'Shell script', short: 'Script' }, ja: { name: 'シェルスクリプト', short: 'スクリプト' } };
const LONG = 'deployment-staging-overnight-run.sh';

describe('the web page: the file type and shell chip', function () {
  this.timeout(180000);
  let browser: Browser;
  let base = '';

  before(async function () {
    ({ browser, base } = await openSite(this));
  });

  /** The header as drawn: the chip's text, Open and Save, the name, whether ⋯ ends inside it, and whether the chip is cut. */
  const header = (page: Page) => page.evaluate(`(() => {
    const head = document.getElementById('ed-head');
    const r = head.getBoundingClientRect();
    const end = r.right - parseFloat(getComputedStyle(head).paddingRight);
    return {
      chip: document.getElementById('scope-chip-text').textContent,
      tools: head.dataset.tools,
      name: head.dataset.name === 'shown',
      nameShown: document.querySelector('.file-box').getClientRects().length > 0,
      fits: document.getElementById('ed-more').getBoundingClientRect().right <= end + 0.5,
      squeezed: head.classList.contains('squeezed'),
      width: Math.round(r.width),
    };
  })()`) as Promise<{ chip: string; tools: string; name: boolean; nameShown: boolean; fits: boolean; squeezed: boolean; width: number }>;

  for (const lang of ['en', 'ja'] as const) {
    for (const fileName of ['untitled.sh', LONG]) {
      it(`takes the widest form that fits at every width of the pane, each form in turn (${lang}, ${fileName})`, async () => {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: lang === 'ja' ? 'ja-JP' : 'en-US' });
        const page = await ctx.newPage();
        await page.goto(base);
        await page.locator('.cm-line').nth(5).waitFor();
        await choose(page, '#lang', lang);
        if (fileName !== 'untitled.sh') {
          await page.locator('#file-name').click();
          await page.keyboard.press('Control+A');
          await page.keyboard.insertText(fileName);
          await page.keyboard.press('Enter');
          await until('renamed', () => page.locator('#file-name').getAttribute('aria-label'), (l) => !!l?.includes(fileName));
        }
        const sample = await page.evaluate('document.querySelector(".cm-content").innerText') as string;
        const forms = scopeChip(lang, '', KIND[lang], undefined, readShell(sample, fileName)).forms;
        const seen: number[] = [];
        // The pane from 85% of the window down to 15% (1088 to 192 px).
        for (let pct = 85; pct >= 15; pct--) {
          await page.evaluate(`document.getElementById('split').style.setProperty('--split', '${pct}%')`);
          await frames(page);
          const h = await header(page);
          const at = forms.findIndex((f) => f.chip === h.chip && f.tools === h.tools && f.name === h.name);
          const where = `${pct}% ${JSON.stringify(h)}`;
          assert.ok(at >= 0, where);
          assert.ok(h.fits && !h.squeezed, where);
          assert.strictEqual(h.nameShown, h.name, where);
          // A narrower pane never takes a wider form.
          assert.ok(at >= (seen[seen.length - 1] ?? 0), `${where} after form ${seen[seen.length - 1]}`);
          if (seen[seen.length - 1] !== at) seen.push(at);
        }
        // Every form in turn: none is skipped.
        assert.deepStrictEqual(seen, forms.map((_, i) => i), `${lang} ${fileName}`);
        await ctx.close();
      });
    }
  }

  it('keeps its popover on the screen in a narrow pane, as one column', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-US' });
    const page = await ctx.newPage();
    await page.goto(base);
    await page.locator('.cm-line').nth(5).waitFor();
    for (const pct of [15, 30, 50]) {
      await page.evaluate(`document.getElementById('split').style.setProperty('--split', '${pct}%')`);
      await frames(page);
      await page.locator('#scope-chip').click();
      const pop = (await page.locator('#scope-pop').boundingBox())!;
      assert.ok(pop.x >= 0 && pop.x + pop.width <= 1280 && pop.y + pop.height <= 800, `${pct}% ${JSON.stringify(pop)}`);
      // Two columns side by side where the pane has the room, else one under the other.
      const [kinds, shells] = await Promise.all(['#scope-kinds', '#scope-shells'].map(async (s) => (await page.locator(s).boundingBox())!));
      assert.strictEqual(shells.y > kinds.y + kinds.height - 1, pct < 50, `${pct}%`);
      await page.keyboard.press('Escape');
      assert.strictEqual(await page.evaluate('document.activeElement.id'), 'scope-chip');
    }
    await ctx.close();
  });

  it('explains the line again for the shell chosen, and offers yq on a line that runs it', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-US' });
    const page = await ctx.newPage();
    await page.goto(base);
    await page.locator('.cm-line').nth(5).waitFor();
    const panel = () => page.frames().find((f) => f.url().endsWith('/panel.html')) as Frame;
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText('echo a\nyq ".a" f.yaml\n');
    await page.keyboard.press('Control+Home');
    await until('the first line', () => panel().locator('#where').innerText(), (t) => t.includes('Line 1'));
    // A shell chosen: the line is checked for it, and the chip says it.
    await setShell(page, 'dash');
    await until('checked for dash', () => panel().locator('#where').innerText(), (t) => t.includes('checked for dash'));
    assert.strictEqual(await page.locator('#scope-chip').getAttribute('aria-label'), 'File type and shell: Shell script · dash');
    await setShell(page, 'auto');
    await until('auto again', () => panel().locator('#where').innerText(), (t) => !t.includes('checked for'));
    assert.strictEqual(await currentShell(page), 'auto');
    // No yq on this line; the line of yq has its list, under Shell.
    await page.locator('#scope-chip').click();
    assert.strictEqual(await page.locator('#scope-yq-list').isVisible(), false);
    await page.keyboard.press('Escape');
    await page.locator('.cm-content').focus();
    await page.keyboard.press('ArrowDown');
    await until('the yq line', () => panel().locator('#where').innerText(), (t) => t.includes('Line 2'));
    await page.locator('#scope-chip').click();
    assert.strictEqual(await page.locator('#scope-yq-list').isVisible(), true);
    assert.strictEqual(await page.locator('#scope-yqs').getAttribute('role'), 'radiogroup');
    assert.strictEqual(await page.locator('#scope-yqs [aria-checked="true"]').getAttribute('data-value'), 'auto');
    await page.keyboard.press('Escape');
    await setYq(page, 'kislyuk');
    await until('kislyuk chosen', () => page.locator('#scope-yqs [aria-checked="true"]').getAttribute('data-value'), (v) => v === 'kislyuk');
    await page.locator('#settings-open').click();
    assert.strictEqual(await page.locator('#setting-yq-flavor').inputValue(), 'kislyuk');
    await ctx.close();
  });

  // A host file's shell is its host's, part by part (src/document.ts, `autoShellAt`): the chip, its popover and the
  // Shell setting follow the cursor's part, as the explanation does. Every kind is checked against the explanation in
  // test/auto-shell.test.ts; here the page draws it.
  it('says the shell of the cursor\'s part of a host file, in the chip, its popover and the Shell setting', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-US' });
    const page = await ctx.newPage();
    await page.goto(base);
    await page.locator('.cm-line').nth(5).waitFor();
    const chip = page.locator('#scope-chip');
    const said = async () => {
      await page.locator('#scope-chip').click();
      const auto = await page.locator('#scope-shell-auto').innerText();
      await page.keyboard.press('Escape');
      return [(await chip.getAttribute('aria-label'))!.replace('File type and shell: ', ''), auto];
    };
    await pickKind(page, 'yaml');
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText('on: push\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n      - shell: sh\n        run: echo there\n');
    const name = 'GitHub Actions / GitLab CI';
    await cursorToLine(page, 6);
    await until('the bash step', () => chip.getAttribute('aria-label'), (t) => t === `File type and shell: ${name} · bash (auto)`);
    assert.deepStrictEqual(await said(), [`${name} · bash (auto)`, 'Auto: bash (from the file type)']);
    await cursorToLine(page, 8);
    await until('the sh step', () => chip.getAttribute('aria-label'), (t) => t === `File type and shell: ${name} · POSIX sh (auto)`);
    assert.deepStrictEqual(await said(), [`${name} · POSIX sh (auto)`, 'Auto: POSIX sh (from the file type)']);
    await openSettingsSection(page, 'checks');
    assert.strictEqual(await page.locator('#setting-shell option[value="auto"]').innerText(), 'Auto (now: POSIX sh, from the file type)');
    await page.keyboard.press('Escape');
    // (A line in no step, where the steps differ: no shell is named.)
    await cursorToLine(page, 1);
    await until('no step', () => chip.getAttribute('aria-label'), (t) => t === `File type and shell: ${name} · auto`);
    assert.deepStrictEqual(await said(), [`${name} · auto`, 'Auto: set by each part (from the file type)']);
    await ctx.close();
  });
});
