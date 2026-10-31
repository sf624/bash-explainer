// The web page's toasts (web/toast.ts, src/ui/toastTimer.ts): docs/design/chrome-redesign.md, C3, decision 8. One
// place: above the Problems list, inside the editor's pane, never over the explanation; the cursor's line stays above
// it; one look with an icon; 4 s, 8 s with a button, held while the pointer or the focus is on it; the longer text
// behind "More"; "Load the sample" over the user's script loads it at once and offers Undo, also from the keyboard; the
// focus never falls to the page's body when the toast goes; F6 reaches the toast; a click does not keep it.
import * as assert from 'assert';
import type { Browser, Page } from 'playwright-core';
import type { Lang } from '../src/i18n';
import { openSite, pickKind, toastText, until } from './support/site';

interface Box { x: number; y: number; width: number; height: number }

describe('the web page: toasts', function () {
  this.timeout(240000);
  let browser: Browser;
  let base = '';
  before(async function () {
    ({ browser, base } = await openSite(this));
  });

  async function open(width: number, lang: Lang = 'en', clock = false): Promise<Page> {
    const phone = width < 520;
    const ctx = await browser.newContext({
      viewport: { width, height: phone ? 844 : 800 }, locale: lang === 'ja' ? 'ja-JP' : 'en-US',
      ...(phone ? { hasTouch: true, isMobile: true } : {}),
    });
    await ctx.addInitScript("try { localStorage.setItem('bash-explainer-read-tip-seen', '1'); } catch {}");
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base.slice(0, -1) });
    const page = await ctx.newPage();
    if (clock) await page.clock.install();
    await page.goto(base);
    if (clock) await page.clock.resume();
    await until('the sample', () => page.locator('.cm-content > .cm-line').count(), (n) => n > 20);
    return page;
  }

  const toast = (page: Page) => page.locator('#status');
  const shown = (page: Page) => toast(page).evaluate((e) => e.classList.contains('shown'));
  const box = async (page: Page, sel: string) => (await page.locator(sel).first().boundingBox()) as Box | null;

  /** The page's "Load the sample": in the editor's ⋯ menu on a wide page, in the menu on a phone. */
  async function clickSample(page: Page): Promise<void> {
    if (await page.locator('#ed-more').isVisible()) {
      await page.locator('#ed-more').click();
      await page.locator('#more-sample').click();
    } else {
      await page.locator('#menu-open').click();
      await page.locator('#menu-sample').click();
    }
  }

  /**
   * Opens a file as the Open button does, with no picker of the browser: the file chooser is awaited before the click
   * (a Promise.all), and the click is the page's own button, not the Ctrl+O shortcut. The shortcut once timed out in CI,
   * waiting 30 s for a chooser that never came (a rerun passed): the key, pressed on a page that had only just been
   * made, is the one step that does not wait for the page to be ready.
   */
  async function openFileThroughChooser(page: Page, name: string, text: string): Promise<void> {
    await page.evaluate('delete window.showOpenFilePicker');
    const open = page.locator('#open-btn');
    await open.waitFor({ state: 'visible' });
    const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 10000 }), open.click()]);
    await chooser.setFiles({ name, mimeType: 'text/x-sh', buffer: Buffer.from(text) });
  }

  const shownName = (page: Page) => page.evaluate("document.getElementById('file-name-stem').textContent + document.getElementById('file-name-ext').textContent") as Promise<string>;

  /** Types a script of the user's own, then loads the sample over it: the toast with Undo. */
  async function loadSampleOverOwn(page: Page): Promise<void> {
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText('echo mine\n');
    await clickSample(page);
    await until('the toast', () => toastText(page), (t) => t.startsWith('Sample loaded') || t.startsWith('サンプル'));
  }

  /** F6 from the editor, twice (the explanation, then the toast): the focus on the toast's first button, as a user gets there. */
  async function toToastByKeys(page: Page): Promise<void> {
    await page.keyboard.press('F6');
    await until('the explanation', () => page.evaluate("document.activeElement?.id"), (id) => id === 'panel');
    // (Its frame has its own listener.)
    await page.waitForTimeout(300);
    await page.keyboard.press('F6');
    await until('the toast', () => (page.evaluate("!!document.activeElement?.closest('#status')") as Promise<boolean>), (b) => b);
  }

  const activeIsEditor = (page: Page) => page.evaluate("document.activeElement?.classList.contains('cm-content') === true") as Promise<boolean>;

  /** Saves with no file picker (the browser downloads the file instead): the toast "Downloaded script.sh." with "Why?". */
  async function download(page: Page): Promise<void> {
    await page.evaluate('delete window.showSaveFilePicker');
    await page.keyboard.press('Control+S');
    await until('the toast', () => toastText(page), (t) => /^(Downloaded|.*ダウンロード)/.test(t));
  }

  /** The toast lies above the Problems list, inside the editor's pane, and off the panel. */
  async function assertPlaced(page: Page, what: string): Promise<void> {
    await until(`${what}: shown`, () => shown(page), (s) => s);
    // (Its slide-in is over.)
    await page.waitForTimeout(300);
    const t = (await box(page, '#status'))!;
    const pane = (await box(page, '#source'))!;
    const problems = await page.locator('#problems').isVisible() ? await box(page, '#problems') : null;
    const panel = (await box(page, '#panel'))!;
    const at = JSON.stringify({ toast: t, pane, problems, panel });
    assert.ok(t.y + t.height <= (problems ? problems.y : pane.y + pane.height) + 0.5, `${what}: above the Problems list ${at}`);
    assert.ok(t.x >= pane.x - 0.5 && t.x + t.width <= pane.x + pane.width + 0.5, `${what}: inside the editor's pane ${at}`);
    const overPanel = t.x < panel.x + panel.width && t.x + t.width > panel.x && t.y < panel.y + panel.height && t.y + t.height > panel.y;
    assert.ok(!overPanel, `${what}: off the panel ${at}`);
  }

  for (const width of [390, 640, 1280]) {
    for (const lang of ['en', 'ja'] as const) {
      it(`shows each toast above the Problems list, inside the editor's pane, never over the panel (${width} px, ${lang})`, async () => {
        const page = await open(width, lang);
        try {
          await loadSampleOverOwn(page);
          await assertPlaced(page, 'Sample loaded');
          // One look: the icon, the text, the button.
          assert.strictEqual(await toast(page).locator('.toast-icon.undo').innerText(), '↶');
          assert.strictEqual(await toast(page).locator('#status-action').count(), 1);
          await download(page);
          await assertPlaced(page, 'Downloaded');
          assert.strictEqual(await toast(page).locator('.toast-icon.done').innerText(), '✓');
          // The longer text behind "More": it opens in the toast, which stays in its place.
          const more = toast(page).locator('#status-more-toggle');
          assert.strictEqual(await more.getAttribute('aria-expanded'), 'false');
          assert.strictEqual(await page.locator('#status-more').isVisible(), false);
          await more.click();
          assert.strictEqual(await more.getAttribute('aria-expanded'), 'true');
          assert.match(await page.locator('#status-more').innerText(), lang === 'en' ? /^This browser cannot write to a file itself/ : /^このブラウザはファイルに直接書き込めない/);
          await assertPlaced(page, 'Downloaded, Why?');
          // On a touch screen the buttons are 44 px high.
          if (width < 520) assert.ok((await more.boundingBox())!.height >= 44);
        } finally {
          await page.context().close();
        }
      });
    }
  }

  it('keeps the cursor\'s line above the toast', async () => {
    const page = await open(1280);
    try {
      // The cursor on the last line that shows in the editor, above the Problems list.
      const last = await page.evaluate(`(() => {
        const sc = document.querySelector('.cm-scroller').getBoundingClientRect();
        const lines = Array.from(document.querySelectorAll('.cm-content > .cm-line')).filter((l) => l.getBoundingClientRect().bottom <= sc.bottom);
        const b = lines[lines.length - 1].getBoundingClientRect();
        return { x: b.left + 20, y: b.top + b.height / 2 };
      })()`) as { x: number; y: number };
      await page.mouse.click(last.x, last.y);
      await page.mouse.move(5, 400);
      await page.locator('#copy-md').click();
      await until('the toast', () => toastText(page), (t) => t.startsWith('Copied'));
      await page.waitForTimeout(400);
      const t = (await box(page, '#status'))!;
      // (The button has the focus: the editor's line of the cursor is the active line.)
      const cursor = (await box(page, '.cm-activeLine'))!;
      assert.ok(cursor.y + cursor.height <= t.y + 0.5, `the cursor ${JSON.stringify(cursor)} above the toast ${JSON.stringify(t)}`);
      const sc = (await box(page, '.cm-scroller'))!;
      assert.ok(cursor.y >= sc.y, 'and still in view');
    } finally {
      await page.context().close();
    }
  });

  it('keeps the cursor on the last line of the script above the toast (the text gets room to scroll)', async () => {
    const page = await open(1280);
    try {
      await page.locator('.cm-content').click();
      await page.keyboard.press('Control+End');
      await page.mouse.move(5, 400);
      await page.locator('#copy-md').click();
      await until('the toast', () => toastText(page), (t) => t.startsWith('Copied'));
      await page.waitForTimeout(500);
      const t = (await box(page, '#status'))!;
      const doc = await page.evaluate(`(() => {
        const lines = document.querySelectorAll('.cm-content > .cm-line');
        const r = lines[lines.length - 1].getBoundingClientRect();
        return { y: r.y, height: r.height, last: document.querySelector('.cm-activeLine') === lines[lines.length - 1] };
      })()`) as { y: number; height: number; last: boolean };
      assert.ok(doc.last, 'the cursor is on the last line');
      assert.ok(doc.y + doc.height <= t.y + 0.5, `the last line ${JSON.stringify(doc)} above the toast ${JSON.stringify(t)}`);
    } finally {
      await page.context().close();
    }
  });

  it('goes after 4 s, or 8 s with a button, and stays while the pointer or the focus is on it', async () => {
    const page = await open(1280, 'en', true);
    try {
      // Nothing to press: 4 s.
      await page.locator('#copy-md').click();
      await until('the toast', () => shown(page), (s) => s);
      await page.clock.fastForward(3500);
      assert.strictEqual(await shown(page), true);
      await page.clock.fastForward(700);
      await until('gone after 4 s', () => shown(page), (s) => !s);
      // With Undo: 8 s.
      await loadSampleOverOwn(page);
      await page.mouse.move(5, 400);
      await page.clock.fastForward(7000);
      assert.strictEqual(await shown(page), true, 'still there at 7 s');
      // The pointer on it: it stays, and 2 s more once the pointer leaves.
      const t = (await box(page, '#status'))!;
      await page.mouse.move(t.x + 10, t.y + t.height / 2);
      await page.clock.fastForward(20000);
      assert.strictEqual(await shown(page), true, 'held by the pointer');
      await page.mouse.move(5, 400);
      await page.clock.fastForward(1500);
      assert.strictEqual(await shown(page), true, '2 s more after the pointer left');
      await page.clock.fastForward(800);
      await until('gone', () => shown(page), (s) => !s);
      // The focus in it holds it too.
      await loadSampleOverOwn(page);
      await toToastByKeys(page);
      await page.clock.fastForward(20000);
      assert.strictEqual(await shown(page), true, 'held by the keyboard\'s focus');
    } finally {
      await page.context().close();
    }
  });

  it('reaches the toast with F6, undoes the sample with the keyboard, and keeps the focus in the editor when the toast goes', async () => {
    const page = await open(1280);
    try {
      await loadSampleOverOwn(page);
      // Editor, explanation, toast; Shift+F6 goes back to the explanation, and F6 on to the editor.
      await toToastByKeys(page);
      assert.strictEqual(await page.evaluate('document.activeElement?.id'), 'status-action');
      await page.keyboard.press('Shift+F6');
      await until('the explanation', () => page.evaluate('document.activeElement?.id'), (id) => id === 'panel');
      await page.waitForTimeout(300);
      await page.keyboard.press('F6');
      await until('the toast', () => (page.evaluate("!!document.activeElement?.closest('#status')") as Promise<boolean>), (b) => b);
      await page.keyboard.press('F6');
      await until('the editor', () => activeIsEditor(page), (b) => b);
      // Enter on Undo: the text is back, and the focus is in the editor, not on the page's body.
      await toToastByKeys(page);
      await page.keyboard.press('Enter');
      await until('the text back', () => page.locator('.cm-content').innerText(), (t) => t.trim() === 'echo mine');
      assert.strictEqual(await shown(page), false);
      assert.ok(await activeIsEditor(page), 'the focus in the editor after Undo');
      // Escape.
      await loadSampleOverOwn(page);
      await toToastByKeys(page);
      await page.keyboard.press('Escape');
      assert.strictEqual(await shown(page), false);
      assert.ok(await activeIsEditor(page), 'the focus in the editor after Escape');
      assert.ok((await page.locator('.cm-content').innerText()).startsWith('#!/usr/bin/env bash'), 'Escape undoes nothing');
      // Another toast in place of one that has the focus: the focus goes to the editor, not to the body.
      await download(page);
      await toToastByKeys(page);
      await page.evaluate("document.getElementById('copy-md').click()");
      await until('the second toast', () => toastText(page), (t) => t.startsWith('Copied'));
      assert.ok(await activeIsEditor(page), 'the focus in the editor after a replaced toast');
    } finally {
      await page.context().close();
    }
  });

  it('is not kept by a click: after More, with the pointer away, it goes within its time', async () => {
    const page = await open(1280, 'en', true);
    try {
      await download(page);
      await page.locator('#status-more-toggle').click();
      assert.strictEqual(await page.evaluate("document.activeElement?.id"), 'status-more-toggle');
      await page.mouse.move(5, 400);
      await page.clock.fastForward(7000);
      assert.strictEqual(await shown(page), true, 'still there at 7 s');
      await page.clock.fastForward(1500);
      await until('gone', () => shown(page), (s) => !s);
    } finally {
      await page.context().close();
    }
  });

  it('loads the sample once: a second click does nothing, and Undo still brings the user\'s script back, with the file it was', async () => {
    const page = await open(1280);
    try {
      const text = () => page.locator('.cm-content').innerText();
      const click = () => clickSample(page);
      await page.locator('.cm-content').click();
      await page.keyboard.press('Control+A');
      await page.keyboard.insertText('echo one\necho two\necho three\n');
      // The cursor on the second line: Undo puts it back there.
      await page.keyboard.press('Control+Home');
      await page.keyboard.press('ArrowDown');
      const cursorLine = () => page.evaluate("document.querySelector('.cm-activeLine')?.textContent");
      assert.strictEqual(await cursorLine(), 'echo two');
      await click();
      await until('the toast', () => toastText(page), (t) => t.startsWith('Sample loaded'));
      await click();
      await page.waitForTimeout(200);
      assert.ok((await text()).startsWith('#!/usr/bin/env bash'));
      await page.locator('#status-action').click();
      await until('the text back', text, (t) => t.trim() === 'echo one\necho two\necho three');
      assert.strictEqual(await cursorLine(), 'echo two', 'the cursor is back');

    } finally {
      await page.context().close();
    }
  });

  it('loads the sample once over a file: the second click does not take the file\'s name away from the text Undo brings back', async () => {
    const page = await open(1280);
    try {
      const text = () => page.locator('.cm-content').innerText();
      const click = () => clickSample(page);
      await openFileThroughChooser(page, 'mine.sh', 'echo mine\n');
      await until('opened', () => shownName(page), (t) => t === 'mine.sh');
      await click();
      await until('the toast', () => toastText(page), (t) => t.startsWith('Sample loaded'));
      assert.notStrictEqual(await shownName(page), 'mine.sh');
      await click();
      await page.locator('#status-action').click();
      await until('the text back', text, (t) => t.trim() === 'echo mine');
      assert.strictEqual(await shownName(page), 'mine.sh');
    } finally {
      await page.context().close();
    }
  });

  it('takes the Undo away when another sample replaces the text (the kind changes while it shows)', async () => {
    const page = await open(1280);
    try {
      await loadSampleOverOwn(page);
      assert.strictEqual(await shown(page), true);
      await pickKind(page, 'makefile');
      await until('the Makefile sample', () => page.locator('.cm-content').innerText(), (t) => /^\.PHONY|^[A-Za-z_]+\s*[:?]?=/m.test(t) && !t.startsWith('#!/usr/bin/env bash'));
      // (A button that does nothing is worse than none.)
      await until('the toast gone, at once (its time is 8 s)', () => shown(page), (v) => !v, 1500);
    } finally {
      await page.context().close();
    }
  });

  it('asks before the sample replaces a file with unsaved changes, as Open does, and keeps the file when asked to cancel', async () => {
    const page = await open(1280);
    try {
      const text = () => page.locator('.cm-content').innerText();
      await openFileThroughChooser(page, 'a.sh', 'echo a\n');
      await until('opened', () => shownName(page), (t) => t === 'a.sh');
      // Clean: no question, and the Undo toast.
      await clickSample(page);
      await until('the toast', () => toastText(page), (t) => t.startsWith('Sample loaded'));
      assert.strictEqual(await page.locator('#discard-dialog').isVisible(), false);
      await page.locator('#status-action').click();
      await until('the text back', text, (t) => t.trim() === 'echo a');
      assert.strictEqual(await shownName(page), 'a.sh');
      // Changed: the question; Cancel leaves the text and the file as they are.
      await page.locator('.cm-content').click();
      await page.keyboard.press('Control+End');
      await page.keyboard.insertText('echo edited\n');
      await clickSample(page);
      await page.locator('#discard-dialog').waitFor({ state: 'visible' });
      assert.strictEqual(await page.locator('#discard-dialog-title').innerText(), 'Discard unsaved changes?');
      assert.strictEqual(await page.locator('#discard-open').innerText(), 'Discard and load');
      await page.locator('#discard-cancel').click();
      await page.locator('#discard-dialog').waitFor({ state: 'hidden' });
      assert.ok((await text()).includes('echo edited'));
      assert.strictEqual(await shownName(page), 'a.sh');
      assert.strictEqual(await shown(page), false);
      // Discard: the sample comes in.
      await clickSample(page);
      await page.locator('#discard-open').click();
      await until('the sample', text, (t) => t.startsWith('#!/usr/bin/env bash'));
    } finally {
      await page.context().close();
    }
  });

  for (const how of ['mouse', 'keys', 'phone', 'phone-more'] as const) {
    it(`gives the focus back after the question about the sample: to the control that opened the menu on Cancel, to the text on Discard (${how})`, async () => {
      const page = await open(how.startsWith('phone') ? 390 : 1280);
      try {
        await openFileThroughChooser(page, 'a.sh', 'echo a\n');
        await until('opened', () => shownName(page), (t) => t === 'a.sh');
        await page.locator('.cm-content').click();
        await page.keyboard.press('Control+End');
        await page.keyboard.insertText('x');
        const active = () => page.evaluate("document.activeElement?.id || document.activeElement?.className || document.activeElement?.tagName") as Promise<string>;
        const asked = async () => {
          if (how === 'phone') {
            await page.locator('#menu-open').tap();
            await page.locator('#menu-sample').tap();
          } else if (how === 'phone-more') {
            // (The header's ⋯ is on a phone too.)
            await page.locator('#ed-more').tap();
            await page.locator('#more-sample').tap();
          } else if (how === 'mouse') {
            await page.locator('#ed-more').click();
            await page.locator('#more-sample').click();
          } else {
            await page.locator('#ed-more').focus();
            await page.keyboard.press('Enter');
            for (let i = 0; i < 6 && (await page.evaluate('document.activeElement?.id')) !== 'more-sample'; i++) await page.keyboard.press('ArrowDown');
            await page.keyboard.press('Enter');
          }
          await page.locator('#discard-dialog').waitFor({ state: 'visible' });
        };
        const opener = how === 'phone' ? 'menu-open' : 'ed-more';
        const touch = how.startsWith('phone');
        // Cancel (Escape from the keyboard): back to the button that opened the menu.
        await asked();
        if (how === 'keys') await page.keyboard.press('Escape');
        else await (touch ? page.locator('#discard-cancel').tap() : page.locator('#discard-cancel').click());
        await page.locator('#discard-dialog').waitFor({ state: 'hidden' });
        // (The focus is given back in the dialog's close event, a moment after the dialog is hidden.)
        await until('the focus after Cancel', active, (id) => id === opener, 1500);
        // Discard: the sample comes in; the focus is in the text (a phone has no keyboard to bring up: the button).
        await asked();
        await (touch ? page.locator('#discard-open').tap() : page.locator('#discard-open').click());
        await until('the sample', () => page.locator('.cm-content').innerText(), (t) => t.startsWith('#!/usr/bin/env bash'));
        await until('the focus after Discard', active, (id) => (touch ? id === opener : id.includes('cm-content')), 1500);
      } finally {
        await page.context().close();
      }
    });
  }

  it('does not undo the sample over a text that is no longer the sample', async () => {
    const page = await open(1280);
    try {
      await loadSampleOverOwn(page);
      // The Undo button, kept in hand while the edit hides the toast (a press that was on its way).
      const undo = await page.locator('#status-action').elementHandle();
      await page.locator('.cm-content').click();
      await page.keyboard.press('Control+End');
      await page.keyboard.insertText('\necho edited');
      await until('the toast gone', () => shown(page), (s) => !s);
      await undo!.evaluate((b: any) => { b.click(); });
      await page.waitForTimeout(200);
      await page.locator('.cm-content').click();
      await page.keyboard.press('Control+End');
      await until('the edit', () => page.locator('.cm-content').innerText(), (t) => t.includes('echo edited'));
      await page.keyboard.press('Control+Home');
      await until('the sample', () => page.locator('.cm-content').innerText(), (t) => t.startsWith('#!/usr/bin/env bash'));
    } finally {
      await page.context().close();
    }
  });
});
