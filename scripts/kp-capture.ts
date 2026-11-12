// Prototype (key points): screenshots of the web page's panel today, with variant A and with variant B, and their lengths.
// usage: npx tsx scripts/kp-capture.ts <site-dir> <out-dir>   (site-dir: built by scripts/build-web.ts --outdir=…)
import * as fs from 'fs';
import * as http from 'http';
import type { AddressInfo } from 'net';
import * as path from 'path';
import type { Browser, Frame, Page } from 'playwright-core';

const [siteDir, outDir] = process.argv.slice(2);
const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

/** The lines: number, slug, and the captures beyond the Japanese light desktop ones. */
const LINES: { n: number; slug: string; extra: ('en' | 'dark' | 'phone')[] }[] = [
  { n: 9, slug: 'echo-append', extra: [] },
  { n: 95, slug: 'rm-unquoted', extra: ['dark'] },
  { n: 7, slug: 'make-2to1', extra: ['en'] },
  { n: 66, slug: 'pipeline', extra: ['phone'] },
  { n: 15, slug: 'param-ops', extra: ['dark'] },
  { n: 85, slug: 'find-long', extra: ['en', 'phone'] },
  { n: 21, slug: 'if-header', extra: [] },
  { n: 60, slug: 'uniq-nothing', extra: [] },
];
const VARIANTS = [['today', ''], ['a', '?keypoints=a'], ['b', '?keypoints=b']] as const;

function serve(): Promise<{ server: http.Server; base: string }> {
  const server = http.createServer((req, res) => {
    const name = path.normalize(decodeURIComponent((req.url ?? '/').split('?')[0])).replace(/^(\.\.[/\\])+/, '');
    let file = path.join(siteDir, name);
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!file.startsWith(siteDir) || !fs.existsSync(file)) return void res.writeHead(404).end();
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' }).end(fs.readFileSync(file));
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}/` })));
}

async function until<T>(what: string, get: () => Promise<T>, ok: (v: T) => boolean, ms = 15000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await get().catch(() => undefined as T);
    if (ok(v)) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

const panelOf = (page: Page): Frame | undefined => page.frames().find((f) => f.url().endsWith('/panel.html'));

/** Puts the cursor on line `line` (1-based) from the keyboard, as test/support/site.ts does. */
async function cursorToLine(page: Page, line: number): Promise<void> {
  await page.locator('.cm-content').focus();
  await page.keyboard.press('Control+Home');
  const at = async () => Number(await page.locator('.cm-lineNumbers .cm-activeLineGutter').first().textContent());
  for (let i = 0; i < 4 * line && (await at()) < line; i++) await page.keyboard.press('ArrowDown');
  if ((await at()) !== line) throw new Error(`the cursor is on line ${await at()}, not ${line}`);
}

/** What the reader sees of the panel and how long it is: its document's height, the rows drawn, and those whose top shows without scrolling. */
const MEASURE = `(() => {
  const view = window.innerHeight;
  const rows = [...document.querySelectorAll('#tree li[data-path] > .item > .row')].filter((r) => r.offsetParent !== null);
  const top = document.getElementById('top').getBoundingClientRect().bottom;
  const seen = rows.filter((r) => { const b = r.getBoundingClientRect(); return b.top >= top - 1 && b.bottom <= view + 1; });
  const points = document.querySelectorAll('#keypoints:not([hidden]) .kp-point').length;
  // (The panel's length: the bottom of the last thing drawn in it, not the document, which is at least the frame's height.)
  const shown = [...document.querySelectorAll('#main > *')].filter((e) => e.offsetParent !== null && e.getBoundingClientRect().height > 0);
  const bottom = Math.max(document.getElementById('top').getBoundingClientRect().bottom, ...shown.map((e) => e.getBoundingClientRect().bottom));
  return { height: Math.round(bottom + scrollY), view, rows: rows.length, seen: seen.length, points, line: document.getElementById('where').textContent };
})()`;

interface Shot { file: string; height: number; view: number; rows: number; seen: number; points: number; line: string; sheet?: number }

async function capture(browser: Browser, base: string, n: number, file: string, query: string, o: { lang: 'ja' | 'en'; dark: boolean; phone: boolean }): Promise<Shot> {
  const { devices } = await import('playwright-core');
  const ctx = await browser.newContext({
    ...(o.phone ? { ...devices['iPhone 13'], deviceScaleFactor: 2 } : {}),
    viewport: o.phone ? { width: 390, height: 844 } : { width: 1280, height: 800 },
    locale: o.lang === 'ja' ? 'ja-JP' : 'en-US', colorScheme: o.dark ? 'dark' : 'light', reducedMotion: 'reduce',
  });
  await ctx.addInitScript("try { sessionStorage.setItem('bash-explainer-opening', '1'); localStorage.setItem('bash-explainer-first-hint', '1'); localStorage.setItem('bash-explainer-read-mode', '0'); localStorage.setItem('bash-explainer-read-tip-seen', '1'); localStorage.setItem('bash-explainer-sheet-hint', '1'); } catch {}");
  const page = await ctx.newPage();
  await page.goto(base + query);
  await until('the panel', () => Promise.resolve(panelOf(page)), (f) => !!f);
  await until('the sample', () => page.locator('.cm-content').textContent(), (t) => !!t && t.includes('set -euo pipefail'));
  await cursorToLine(page, n);
  const panel = panelOf(page)!;
  await until(`line ${n} in the panel`, () => panel.locator('#where').textContent(), (t) => !!t && new RegExp(`\\b${n}\\b`).test(t));
  if (o.phone) await until('the sheet at half', () => page.evaluate('document.documentElement.dataset.sheet'), (s) => s === 'half');
  await page.waitForTimeout(700);
  const m = await panel.evaluate(MEASURE) as Omit<Shot, 'file'>;
  const shot: Shot = { file, ...m };
  if (o.phone) {
    // The phone: the page as the reader sees it, the sheet at half height over the editor.
    shot.sheet = await page.evaluate(`(() => { const f = document.getElementById('panel').getBoundingClientRect(); return Math.round(Math.min(f.bottom, innerHeight) - f.top); })()`) as number;
    await page.screenshot({ path: file });
  } else {
    // The desktop: the panel's column, first the screen the reader sees, then the whole panel (the viewport made as tall as it).
    const frame = page.locator('#panel');
    await frame.screenshot({ path: file.replace(/\.png$/, '-screen.png') });
    const box = (await frame.boundingBox())!;
    const tall = Math.min(5000, Math.ceil(box.y + m.height + 40));
    if (tall > 800) {
      await page.setViewportSize({ width: 1280, height: tall });
      await page.waitForTimeout(500);
    }
    await frame.screenshot({ path: file });
  }
  await ctx.close();
  return shot;
}

(async () => {
  const { chromium } = await import('playwright-core');
  const { server, base } = await serve();
  const browser = await chromium.launch();
  const results: Shot[] = [];
  try {
    for (const [i, l] of LINES.entries()) {
      if (process.env.KP_ONLY && !process.env.KP_ONLY.split(",").includes(String(l.n))) continue;
      const nn = String(i + 1).padStart(2, '0');
      const kinds = [{ suffix: '', lang: 'ja' as const, dark: false, phone: false },
        ...l.extra.map((e) => ({ suffix: `-${e}`, lang: e === 'en' ? 'en' as const : 'ja' as const, dark: e === 'dark', phone: e === 'phone' }))];
      for (const k of kinds) for (const [v, q] of VARIANTS) {
        const file = path.join(outDir, `kp-${nn}-${l.slug}-${v}${k.suffix}.png`);
        const r = await capture(browser, base, l.n, file, q, k);
        results.push(r);
        console.log(JSON.stringify(r));
      }
    }
  } finally {
    fs.writeFileSync(path.join(outDir, 'kp-measures.json'), JSON.stringify(results, null, 1));
    await browser.close();
    server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
