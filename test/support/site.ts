// The web page for the browser tests (test/web-*.test.ts): built into a temporary directory once per test
// file, served on 127.0.0.1, and opened in one headless Chromium for that file. A
// test opens its own context, so nothing is shared between tests but the build.
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import type { AddressInfo } from 'net';
import * as os from 'os';
import * as path from 'path';
import type { Browser, Locator, Page } from 'playwright-core';

export const root = path.join(__dirname, '..', '..');
const TYPES: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};
/** What the page may load: its own files, nothing else. */
export const FILES = ['/', '/app.js', '/favicon.ico', '/favicon.svg', '/icons.js', '/page.css', '/panel-host.js', '/panel-page.css', '/panel.css', '/panel.html', '/panel.js', '/theme.css', '/theme-init.js'];
/** Typed into the editor: it must not appear in any request. */
export const MARKER = 'secret-7f3a9c';

export interface Site {
  /** Its contexts load the page as on a later load of the session, without the opening, and as on a later visit, without the first visit's hint; see `firstLoad` and `firstVisit`. */
  browser: Browser;
  /**
   * A context that sees the opening (src/ui/opening.ts) as on the first load of a session: whole, for about two
   * seconds over the page, and the first visit's hint over the editor. The others see neither.
   */
  firstLoad: Browser['newContext'];
  /** A context of a first visit without the opening: the hint over the editor shows (web/editor-head.ts) until it is closed. */
  firstVisit: Browser['newContext'];
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
  // later load, which has none (web/theme-init.js reads this key), except those that ask for `firstLoad`. And as on a
  // later visit, where the first visit's hint over the editor was closed (web/storage.ts, `firstHint`), except those
  // that ask for `firstLoad` or `firstVisit`.
  const firstLoad = browser.newContext.bind(browser);
  const firstVisit: Browser['newContext'] = async (options) => {
    const ctx = await firstLoad(options);
    await ctx.addInitScript("try { sessionStorage.setItem('bash-explainer-opening', '1'); } catch {}");
    return ctx;
  };
  browser.newContext = async (options) => {
    const ctx = await firstVisit(options);
    await ctx.addInitScript("try { if (localStorage.getItem('bash-explainer-first-hint') === null) localStorage.setItem('bash-explainer-first-hint', '1'); } catch {}");
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
  return { browser, firstLoad, firstVisit, server, dir, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}/` };
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
 * Puts the editor's cursor on line `line` (1-based) from the keyboard, as a user would: Ctrl+Home, then ArrowDown until
 * the gutter's active line number says so. Long lines wrap, and ArrowDown moves by row, so the count of presses is not
 * the line's number.
 */
export async function cursorToLine(page: Page, line: number): Promise<void> {
  await page.locator('.cm-content').focus();
  await page.keyboard.press('Control+Home');
  const at = async () => Number(await page.locator('.cm-lineNumbers .cm-activeLineGutter').first().textContent());
  for (let i = 0; i < 4 * line && (await at()) < line; i++) await page.keyboard.press('ArrowDown');
  if ((await at()) !== line) throw new Error(`the cursor is on line ${await at()}, not ${line}`);
}

/**
 * The toast's words (web/toast.ts): its text, and the longer text behind "More" or "Why?" after a space; '' when no
 * toast shows.
 */
export function toastText(page: Page): Promise<string> {
  return page.locator('#status').evaluate((el) => [el.querySelector('.toast-text'), el.querySelector('.toast-more')].map((e) => e?.textContent ?? '').filter(Boolean).join(' '));
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

/**
 * Chooses the shell as the page offers it: with the top bar's select where the bar has one, else in the menu. Both
 * hold the same value; the tests go through this helper, so that moving the control changes the helper, not the tests
 * (docs/design/chrome-redesign.md, C0 and C5).
 */
export async function setShell(page: Page, shell: string): Promise<void> {
  const top = page.locator('#shell-top');
  if (await top.isVisible()) await top.selectOption(shell);
  else await choose(page, '#shell', shell);
}

/** The shell the page has chosen ('auto' or a shell's name), read from the menu's select, which holds it at every width. */
export function currentShell(page: Page): Promise<string> {
  return page.locator('#shell').inputValue();
}

/** Whether the Problems strip shows problems (with none it says "No problems", and the list is hidden). */
export function problemsShown(page: Page): Promise<boolean> {
  return page.locator('#problems:not(.empty)').isVisible();
}

/**
 * The text of the Problems list as it is now (its rows with their rules, or nothing), folded or open, and with the
 * rule shown or not (a narrow pane leaves it to the tooltip); to poll with `until`.
 */
export async function problemList(page: Page): Promise<string> {
  return (await page.locator('#problem-list').textContent()) ?? '';
}

/** The rows of the Problems list, as a locator. */
export function problemRows(page: Page): Locator {
  return page.locator('#problem-list li');
}

/**
 * Makes sure the Problems list is open and returns its rows: waits for the strip with problems, and unfolds the list
 * when it is folded (its state is the user's, stored: docs/design/chrome-redesign.md, C2).
 */
export async function openProblems(page: Page): Promise<Locator> {
  await page.locator('#problems:not(.empty)').waitFor({ state: 'visible' });
  const toggle = page.locator('#problems-toggle');
  if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
  return problemRows(page);
}

/**
 * Opens the settings sheet (when it is not open) and one of its sections, which are folded after Common
 * (docs/design/chrome-redesign.md, C6): through its "Jump to" link, as a user would. `data` holds the export, the
 * import and the stored data.
 */
export async function openSettingsSection(page: Page, section: string): Promise<void> {
  if (!(await page.locator('#settings-dialog').isVisible())) await page.locator('#settings-open').click();
  if (!(await page.locator(`#settings-items-${section}`).isVisible())) await page.locator(`#settings-jump-${section}`).click();
}

/** The control of a setting (`#setting-hints-names` for `hints.names`), with the settings open at its section. */
export async function settingControl(page: Page, key: string): Promise<Locator> {
  if (!(await page.locator('#settings-dialog').isVisible())) await page.locator('#settings-open').click();
  const section = await page.evaluate(`document.querySelector('.setting[data-key="${key}"]').closest('[data-section]').dataset.section`) as string;
  await openSettingsSection(page, section);
  return page.locator(`#setting-${key.replace(/\./g, '-')}`);
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
