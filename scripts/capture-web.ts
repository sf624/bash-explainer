// Takes the screenshots of a step of docs/design/chrome-redesign.md: builds the web page, serves it on 127.0.0.1,
// and captures it at 390 (a phone), 640 and 1280 px, in English and Japanese, in these states: the page with the
// sample loaded ("page"), the menu open ("menu"), the settings open ("settings") and the popover of the file type and
// the shell ("kind"),
// in the light theme, or in the themes asked for (--themes light,dark). The phone's first-run tip of the read-mode
// switch is closed before the shots, so that they are clean; "tip" is a state of its own that shoots it first.
// Each visual PR goes with a "before" set (taken on main) and an "after" set (taken on the branch), and the author
// looks at them and measures before pushing.
//
// Usage: npx tsx scripts/capture-web.ts --out DIR [--name before] [--widths 390,1280] [--langs en,ja] [--themes light,dark]
//          [--states page,menu] [--script FILE] [--line N] [--channel next] [--phone-scale 1.3]
//   --out     where the PNGs go (required; created when missing). Each is DIR/NAME-WIDTH-LANG-THEME-STATE.png.
//   --themes  light (the default), dark: the browser's colour scheme, which the page follows.
//   --states  page, menu, settings, kind (the popover of the file type and the shell; a sheet on a narrow page), tip (the phone's first-run tip; a phone only).
//   --name    the file name prefix, default "shot" (use "before" and "after").
//   --script  a file to put into the editor instead of the sample (the page's own sample otherwise).
//   --line    the line (from 1) to put the cursor on, from the keyboard, so the panel explains it (line 8 of the sample is long).
//   --phone-scale  also take the phone at this text size (130% = 1.3, as the kit did, in a 300 px CSS viewport): files NAME-300-...
//
// It reads no path of this machine. The browser is Playwright's own (PLAYWRIGHT_BROWSERS_PATH and the rest of its
// variables, `npx playwright-core install chromium`). To draw Japanese with the fonts of CI (IPAGothic, WenQuanYi),
// point FONTCONFIG_FILE at a fontconfig file that lists them (README "Contributing"). A memory cap and the limit on
// parallel heavy runs are the caller's wrapper (`~/.claude/bin/heavy`, `systemd-run --scope -p MemoryMax=…`).
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import type { AddressInfo } from 'net';
import * as os from 'os';
import * as path from 'path';

const root = path.join(__dirname, '..');
const TYPES: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain',
};

function option(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const out = option('out');
if (!out) throw new Error('--out DIR is required');
const name = option('name', 'shot')!;
const widths = option('widths', '390,640,1280')!.split(',').map(Number);
const langs = option('langs', 'en,ja')!.split(',');
const themes = option('themes', 'light')!.split(',');
const states = option('states', 'page,menu,settings,kind')!.split(',');
const script = option('script');
const channel = option('channel', 'release')!;
const phoneScale = option('phone-scale');
const cursorLine = option('line');
for (const s of states) if (!['page', 'menu', 'settings', 'kind', 'tip'].includes(s)) throw new Error(`unknown state: ${s}`);
for (const t of themes) if (t !== 'light' && t !== 'dark') throw new Error(`unknown theme: ${t}`);
for (const l of langs) if (l !== 'en' && l !== 'ja') throw new Error(`unknown language: ${l}`);
if (widths.some((w) => !(w > 0))) throw new Error('--widths: numbers separated by commas');
if (cursorLine !== undefined && !(Number(cursorLine) >= 1)) throw new Error('--line: a line number, from 1');

async function main(): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bash-explainer-shots-'));
  try {
    execFileSync(process.execPath, ['--import', 'tsx', 'scripts/build-web.ts', `--outdir=${dir}`, `--channel=${channel}`], { cwd: root, stdio: 'inherit' });
    const server = http.createServer((req, res) => {
      const file0 = path.normalize(decodeURIComponent((req.url ?? '/').split('?')[0])).replace(/^(\.\.[/\\])+/, '');
      let file = path.join(dir, file0);
      if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
      if (!file.startsWith(dir) || !fs.existsSync(file)) return void res.writeHead(404).end();
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' }).end(fs.readFileSync(file));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
    fs.mkdirSync(out!, { recursive: true });
    const { chromium, devices } = await import('playwright-core');
    const browser = await chromium.launch();
    try {
      const text = script ? fs.readFileSync(script, 'utf8') : undefined;
      // (A phone at 130% text: a 300 px CSS viewport, as the kit did.)
      const sizes: { width: number; scale: number }[] = widths.map((width) => ({ width, scale: 1 }));
      if (phoneScale) sizes.push({ width: 300, scale: Number(phoneScale) });
      for (const { width, scale } of sizes) {
        for (const lang of langs) for (const theme of themes) {
          const phone = width < 520;
          const ctx = await browser.newContext({
            ...(phone ? devices['iPhone 13'] : {}),
            viewport: { width, height: phone ? 844 : 800 },
            locale: lang === 'ja' ? 'ja-JP' : 'en-US',
            deviceScaleFactor: 1,
            colorScheme: theme as 'light' | 'dark',
          });
          // The opening plays on a first load only; the shots are of the page after it.
          await ctx.addInitScript("try { sessionStorage.setItem('bash-explainer-opening', '1'); } catch {}");
          const page = await ctx.newPage();
          if (scale !== 1) await page.addInitScript(`document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = '${scale * 100}%'; })`);
          await page.goto(base);
          await page.locator('.cm-line').first().waitFor();
          const shot = (state: string) => page.screenshot({ path: path.join(out!, `${name}-${width}-${lang}-${theme}-${state}.png`) });
          // The first-run tip of the read-mode switch (a coarse pointer only): shot when asked, then closed.
          if (await page.locator('#readtip').isVisible()) {
            if (states.includes('tip')) await shot('tip');
            await page.locator('#readtip-close').click();
          }
          if (text !== undefined) {
            await page.locator('.cm-content').click();
            await page.keyboard.press('Control+A');
            await page.keyboard.insertText(text);
          } else {
            await page.locator('#menu-open').click();
            await page.locator('#menu-sample').click();
          }
          if (cursorLine !== undefined) {
            // (As test/support/site.ts `cursorToLine`: ArrowDown moves by row, and long lines wrap.)
            await page.locator('.cm-content').focus();
            await page.keyboard.press('Control+Home');
            const at = async () => Number(await page.locator('.cm-lineNumbers .cm-activeLineGutter').first().textContent());
            for (let i = 0; i < 4 * Number(cursorLine) && (await at()) < Number(cursorLine); i++) await page.keyboard.press('ArrowDown');
          }
          await page.waitForTimeout(1500);
          if (states.includes('page')) await shot('page');
          if (states.includes('menu')) {
            await page.locator('#menu-open').click();
            await page.waitForTimeout(400);
            await shot('menu');
            await page.locator('#menu-close').click();
            await page.waitForTimeout(400);
          }
          if (states.includes('settings')) {
            await page.locator('#settings-open').click();
            await page.locator('#settings-dialog').waitFor({ state: 'visible' });
            await page.waitForTimeout(400);
            await shot('settings');
            await page.keyboard.press('Escape');
            await page.locator('#settings-dialog').waitFor({ state: 'hidden' });
          }
          // (The chip of the file type and the shell: its popover, a sheet on a narrow page.)
          if (states.includes('kind') && (await page.locator('#scope-chip').isVisible())) {
            await page.locator('#scope-chip').click();
            await page.locator('#scope-pop').waitFor({ state: 'visible' });
            await shot('kind');
            await page.keyboard.press('Escape');
          }
          await ctx.close();
        }
      }
    } finally {
      await browser.close();
      await new Promise((r) => server.close(r));
    }
    console.log(`Screenshots in ${path.resolve(out!)}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
