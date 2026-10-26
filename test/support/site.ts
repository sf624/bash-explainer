// The web page for the browser tests (test/web-*.test.ts): built into a temporary directory once per test
// file, served on 127.0.0.1, and opened in one headless Chromium for that file. A
// test opens its own context, so nothing is shared between tests but the build.
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import type { AddressInfo } from 'net';
import * as os from 'os';
import * as path from 'path';
import type { Browser, Page } from 'playwright-core';

export const root = path.join(__dirname, '..', '..');
const TYPES: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};
/** What the page may load: its own files, nothing else. */
export const FILES = ['/', '/app.js', '/favicon.ico', '/favicon.svg', '/icons.js', '/page.css', '/panel-host.js', '/panel-page.css', '/panel.css', '/panel.html', '/panel.js', '/theme.css', '/theme-init.js'];
/** Typed into the editor: it must not appear in any request. */
export const MARKER = 'secret-7f3a9c';

export interface Site {
  /** Its contexts load the page as on a later load of the session, without the opening; see `firstLoad`. */
  browser: Browser;
  /**
   * A context that sees the opening (src/ui/opening.ts) as on the first load of a session: whole, for about two
   * seconds over the page. The others see none.
   */
  firstLoad: Browser['newContext'];
  /** The address of the release page, with a trailing slash (`next/` and `pr/123/` are under it). */
  base: string;
}

interface Running extends Site {
  server: http.Server;
  dir: string;
}

/** The site of the file being run: in a parallel run a worker runs several files one after another, so each file closes its own. */
let running: Promise<Running | undefined> | undefined;

async function start(): Promise<Running | undefined> {
  // Playwright exits the process on Node.js before 20 instead of throwing.
  if (Number(process.versions.node.split('.')[0]) < 20) return undefined;
  let browser: Browser;
  try {
    const { chromium } = await import('playwright-core');
    browser = await chromium.launch();
  } catch (e) {
    if (process.env.BASH_EXPLAINER_BROWSER) throw e;
    return undefined;
  }
  // The opening covers the page for about two seconds on the first load of a session: the tests load the page as on a
  // later load, which has none (web/theme-init.js reads this key), except those that ask for `firstLoad`.
  const firstLoad = browser.newContext.bind(browser);
  browser.newContext = async (options) => {
    const ctx = await firstLoad(options);
    await ctx.addInitScript("try { sessionStorage.setItem('bash-explainer-opening', '1'); } catch {}");
    return ctx;
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bash-explainer-web-'));
  const build = (outdir: string, ...args: string[]) =>
    execFileSync(process.execPath, ['--import', 'tsx', 'scripts/build-web.ts', `--outdir=${outdir}`, ...args], { cwd: root, stdio: 'pipe' });
  build(dir);
  // The development version, under /next/ as on GitHub Pages.
  build(path.join(dir, 'next'), '--channel=next');
  // The preview of a pull request, under /pr/N/.
  build(path.join(dir, 'pr', '123'), '--channel=pr', '--pr=123');
  const server = http.createServer((req, res) => {
    const name = path.normalize(decodeURIComponent((req.url ?? '/').split('?')[0])).replace(/^(\.\.[/\\])+/, '');
    let file = path.join(dir, name);
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!file.startsWith(dir) || !fs.existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' }).end(fs.readFileSync(file));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { browser, firstLoad, server, dir, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}/` };
}

/**
 * The site of this file, built on the first call; undefined (and the test is skipped) when no browser can
 * start, unless $BASH_EXPLAINER_BROWSER is set (as in CI). Call it from a `before` hook of a file: the site
 * (build directory, server on a free port, browser) is closed after that file's suite, so files run in
 * parallel workers do not share one.
 */
export async function openSite(ctx: Mocha.Context): Promise<Site> {
  const mine = (running = start());
  ctx.test?.parent?.afterAll(async () => {
    const site = await mine.catch(() => undefined); // the before hook reports a failed start
    if (running === mine) running = undefined;
    if (!site) return;
    await site.browser.close();
    await new Promise((r) => site.server.close(r));
    fs.rmSync(site.dir, { recursive: true, force: true });
  });
  const site = await mine;
  if (!site) return ctx.skip();
  return site;
}

/** Polls `get` until `ok` accepts its value, and returns it; fails with `what` after `ms`. */
export async function until<T>(what: string, get: () => Promise<T>, ok: (v: T) => boolean, ms = 10000): Promise<T> {
  const end = Date.now() + ms;
  let v = await get();
  while (!ok(v)) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}: ${JSON.stringify(v)}`);
    await new Promise((r) => setTimeout(r, 100));
    v = await get();
  }
  return v;
}

/**
 * Chooses a value in a select of the page's menu (the language, the theme, the version), opening the
 * menu first and closing it after; the compare page has these in its top bar.
 */
export async function choose(page: Page, id: string, value: string): Promise<void> {
  const drawer = page.locator('#drawer');
  if (await drawer.count()) {
    if (!(await drawer.evaluate((d) => (d as unknown as { open: boolean }).open))) await page.locator('#menu-open').click();
  }
  await page.locator(id).selectOption(value);
  // The version is another page: the menu then went with the page.
  await page.evaluate("document.getElementById('drawer')?.close()").catch(() => undefined);
}

/** Chooses the file kind with the top bar's picker, by mouse. */
export async function pickKind(page: Page, kind: string): Promise<void> {
  await page.locator('#kind').click();
  await page.locator(`#kind-list [data-value="${kind}"]`).click();
}

/** Presses an item of the page's menu (the panel's own header is not shown on the page). */
export async function menuItem(page: Page, id: string): Promise<void> {
  await page.locator('#menu-open').click();
  await page.locator(id).click();
}

/** Chooses the panel's view in the page's switch: in the top bar, or on a phone in the menu (closed again after). */
export async function chooseView(page: Page, view: 'list' | 'tree'): Promise<void> {
  if (await page.locator(`#view-${view}-top`).isVisible()) return page.locator(`#view-${view}-top`).click();
  await menuItem(page, `#view-${view}-menu`);
  await page.evaluate("document.getElementById('drawer').close()");
}

/** Waits until the page has drawn `n` more animation frames (styles and layout have settled after a change). */
export async function frames(page: Page | import('playwright-core').Frame, n = 2): Promise<void> {
  await page.evaluate(`new Promise((resolve) => { let n = ${n}; const tick = () => (--n > 0 ? requestAnimationFrame(tick) : resolve()); requestAnimationFrame(tick); })`);
}

/**
 * Polls `get` until it has given the same value `rounds` times in a row, and returns it: for a change that
 * may follow an action (an animation, a debounced update), where the test must see the value after it.
 */
export async function stable<T>(what: string, get: () => Promise<T>, rounds = 4, ms = 10000): Promise<T> {
  const end = Date.now() + ms;
  let last = JSON.stringify(await get());
  let same = 1;
  let v = await get();
  for (;;) {
    const now = JSON.stringify(v);
    same = now === last ? same + 1 : 1;
    last = now;
    if (same >= rounds) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what} to settle: ${now}`);
    await new Promise((r) => setTimeout(r, 50));
    v = await get();
  }
}
