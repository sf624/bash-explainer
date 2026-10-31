// The VS Code panel's line box follows the editor's `editor.wordWrap` (src/ui/lineBox.ts `wrapsLikeEditor`, read by
// src/ui/panel.ts): off, one row that scrolls sideways; any other value, the line wraps between shell words, three rows
// at most until a click opens it whole (docs/design/chrome-redesign.md, C1b). In headless Chromium with the theme
// variables of VS Code (test/support/panel-page.ts). Skipped when no browser can start, unless $BASH_EXPLAINER_BROWSER is set.
import * as assert from 'assert';
import type { Browser, Page } from 'playwright-core';
import { openDocument } from '../src/document-setup';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { wrapsLikeEditor } from '../src/ui/lineBox';
import { wrapRuns } from '../src/ui/wrapRuns';
import { PanelServer, servePanel } from './support/panel-page';
import { until } from './support/site';

const LONG = `tar -czf "backup $(date +%F).tar.gz" ${'"some dir" '.repeat(16)}--exclude '*.tmp'`;
/** Where a row may start: the start of a run of the line (the panel page explains it as line 2 of a script). */
const starts = wrapRuns(openDocument(`#!/bin/bash\n${LONG}\n`, 'shell', (t) => createUnbashParser().parse(t)))[1].map(([a]) => a);

interface Box { rows: number[]; row: number; shown: number; sideways: boolean; white: string; clamped: boolean; expanded: string | null }

function box(page: Page): Promise<Box> {
  return page.evaluate(`(() => {
    const pre = document.getElementById('line');
    const walker = document.createTreeWalker(pre, NodeFilter.SHOW_TEXT);
    const rows = [];
    let col = 0, last = -Infinity;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      for (let i = 0; i < n.data.length; i++, col++) {
        if (n.data[i] === ' ') continue;
        const r = document.createRange();
        r.setStart(n, i);
        r.setEnd(n, i + 1);
        const top = r.getBoundingClientRect().top;
        if (top > last + 2) rows.push(col);
        last = top;
      }
    }
    const cs = getComputedStyle(pre);
    return {
      rows, row: parseFloat(getComputedStyle(pre.querySelector('.rows')).lineHeight), shown: pre.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom),
      sideways: pre.scrollWidth > pre.clientWidth + 1, white: cs.whiteSpace, clamped: pre.classList.contains('clamped'), expanded: pre.getAttribute('aria-expanded'),
    };
  })()`) as Promise<Box>;
}

describe('the VS Code panel: its line box follows editor.wordWrap', function () {
  this.timeout(60000);
  let browser: Browser | undefined;
  const servers: Record<'off' | 'on', PanelServer | undefined> = { off: undefined, on: undefined };

  before(async function () {
    if (Number(process.versions.node.split('.')[0]) < 20) return this.skip();
    try {
      const { chromium } = await import('playwright-core');
      browser = await chromium.launch();
    } catch (e) {
      if (process.env.BASH_EXPLAINER_BROWSER) throw e;
      return this.skip();
    }
    for (const w of ['off', 'on'] as const) servers[w] = await servePanel(LONG, 'backup.sh', wrapsLikeEditor(w));
  });

  after(async () => {
    await browser?.close();
    for (const s of Object.values(servers)) await s?.close();
  });

  async function open(wordWrap: 'off' | 'on', lang: 'en' | 'ja'): Promise<Page> {
    const page = await browser!.newPage({ viewport: { width: 420, height: 600 } });
    await page.goto(servers[wordWrap]!.url('dark', lang));
    await until('the line', () => page.locator('#line').textContent(), (t) => t === LONG);
    return page;
  }

  for (const lang of ['en', 'ja'] as const) {
    it(`keeps one row that scrolls sideways with editor.wordWrap off (${lang})`, async () => {
      const page = await open('off', lang);
      try {
        const b = await box(page);
        assert.ok(b.rows.length === 1 && b.sideways && b.white === 'pre' && !b.clamped && b.expanded === null, JSON.stringify(b));
      } finally {
        await page.close();
      }
    });

    it(`wraps between runs with editor.wordWrap on: three rows, a click opens it whole, the parts still reveal (${lang})`, async () => {
      const page = await open('on', lang);
      try {
        const b = await until('fitted', () => box(page), (x) => x.clamped);
        assert.ok(b.rows.length > 3 && !b.sideways && b.expanded === 'false', JSON.stringify(b));
        for (const s of b.rows.slice(1)) assert.ok(starts.includes(s), `a row starts inside a word, at column ${s}: ${LONG.slice(s, s + 20)}`);
        assert.ok(Math.abs(b.shown - 3 * b.row) < 2, JSON.stringify(b));
        await page.locator('#line').click({ position: { x: 4, y: 4 } });
        const opened = await until('opened', () => box(page), (x) => x.expanded === 'true');
        assert.ok(!opened.clamped && Math.abs(opened.shown - opened.rows.length * opened.row) < 2, JSON.stringify(opened));
        // A part of the line shows its range in the editor, and the box stays open.
        await page.evaluate('window.POSTED.length = 0');
        await page.locator('#line .seg').first().click();
        assert.ok((await page.evaluate('window.POSTED.map((m) => m.type)') as string[]).includes('reveal'));
        assert.strictEqual((await box(page)).expanded, 'true');
        await page.locator('#line').click({ position: { x: 4, y: 4 } });
        await until('folded', () => box(page), (x) => x.expanded === 'false' && x.clamped);
      } finally {
        await page.close();
      }
    });
  }
});
