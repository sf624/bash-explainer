// The note on where `set -e` stops the script (`errexit-stops-here`; docs/design/errexit-stop.md, U11b) on the web
// page's panel, in headless Chromium: on a line of a `set -e` script, the note is the first in `#notes`, under "In
// short", with each code span drawn as one `code` element and its icon named, in both languages, at a phone's width
// and a desktop's. Screenshots are kept when `ERREXIT_SHOTS` names a directory.
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import type { Browser, Frame, Page } from 'playwright-core';
import { Analyzer } from '../src/analyzer';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { openSite, until } from './support/site';

/** The script of the usability runs (nightly-backup.sh), shortened: `date` before the trap, `tar` after it. */
const SCRIPT = [
  '#!/usr/bin/env bash',
  'set -euo pipefail',
  'stamp=$(date +%Y-%m-%d)',
  'dest="/srv/backups/$stamp"',
  'cleanup() {',
  '  rm -f "$dest"/*.partial',
  '}',
  'trap cleanup EXIT',
  'mkdir -p "$dest"',
  'for src in /etc /home; do',
  '  tar -czf "$dest/$(basename "$src").tar.gz.partial" -C / "${src#/}"',
  'done',
].join('\n');

/** The note's body (no mark) the analyzer gives line `line` of SCRIPT. */
const body = (line: number, lang: 'en' | 'ja'): string => new Analyzer(lang).explainLine(createUnbashParser().parse(SCRIPT), line).facts!.find((f) => f.id === 'errexit-stops-here')!.body;
const SPAN = /(?<!`)(`+)(?!`)([\s\S]*?[^`])\1(?!`)/g;
const spanCode = (code: string): string => (/^ [\s\S]*[^ ][\s\S]* $/.test(code) ? code.slice(1, -1) : code);

describe('the web page: the note on where `set -e` stops the script', function () {
  this.timeout(120000);
  let browser: Browser;
  let base = '';
  before(async function () {
    ({ browser, base } = await openSite(this));
  });

  async function open(page: Page): Promise<Frame> {
    await page.goto(base);
    await until('the editor', () => page.locator('.cm-content').count(), (n) => n > 0);
    await page.locator('.cm-content').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.insertText(SCRIPT);
    return page.frames().find((f) => f.url().endsWith('/panel.html'))!;
  }

  async function goTo(page: Page, panel: Frame, line: number): Promise<void> {
    await page.keyboard.press('Control+Home');
    for (let i = 0; i < line; i++) await page.keyboard.press('ArrowDown');
    const text = SCRIPT.split('\n')[line].trim().slice(0, 12);
    await until('the line explained', async () => (await panel.locator('#line').textContent()) ?? '', (t) => t.includes(text));
  }

  for (const [lang, locale] of [['en', 'en-US'], ['ja', 'ja-JP']] as const) {
    for (const width of [390, 1280]) {
      it(`shows the note first under "In short", its code as code, its icon named (${lang}, ${width} px)`, async () => {
        const ctx = await browser.newContext({ viewport: { width, height: 900 }, locale });
        const page = await ctx.newPage();
        const panel = await open(page);
        for (const [line, name] of [[2, 'before-trap'], [10, 'after-trap']] as const) {
          await goTo(page, panel, line);
          const want = body(line, lang);
          const note = panel.locator('#notes .note').first();
          const text = want.replace(SPAN, (_m, _f, code: string) => spanCode(code));
          await until('the note', async () => (await note.count() ? await note.locator('.note-text').textContent() : '') ?? '', (t) => t.startsWith(text));
          assert.strictEqual(await note.getAttribute('class'), 'note level-note');
          // (Each code span of the text is one `code` element; the sections it cites follow.)
          const codes = [...want.matchAll(SPAN)].map((m) => spanCode(m[2]));
          assert.deepStrictEqual((await note.locator('.note-text code').allTextContents()).slice(0, codes.length), codes);
          // (Under "In short", inside the panel.)
          const box = await panel.evaluate(`(() => {
            const short = document.getElementById('short').getBoundingClientRect();
            const n = document.querySelector('#notes .note');
            const r = n.getBoundingClientRect();
            return { below: r.top >= short.bottom - 1, right: r.right <= document.documentElement.clientWidth, scroll: n.scrollWidth - n.clientWidth };
          })()`) as { below: boolean; right: boolean; scroll: number };
          assert.ok(box.below && box.right && box.scroll <= 0, JSON.stringify(box));
          // (A screen reader hears the icon as a note, then the text.)
          const tree = await panel.locator('#notes').ariaSnapshot();
          assert.match(tree, lang === 'ja' ? /img "[^"]+"/ : /img "Note"/);
          assert.ok(tree.includes(codes[0]), tree);
          const dir = process.env.ERREXIT_SHOTS;
          if (dir) {
            fs.mkdirSync(dir, { recursive: true });
            await page.screenshot({ path: path.join(dir, `errexit-${name}-${lang}-${width}.png`) });
          }
        }
        await ctx.close();
      });
    }
  }
});
