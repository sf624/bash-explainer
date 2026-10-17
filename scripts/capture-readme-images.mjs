// Records the README images (images/demo.gif, hover.gif, panel.gif, inline.png).
// See images/RECORDING.md. Usage: npm run images [-- demo hover panel inline] [-- --keep]
import { chromium } from 'playwright-core';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { imagesHash } from './images-hash.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IMAGES = path.join(ROOT, 'images');
const ALL = ['demo', 'hover', 'panel', 'inline'];
const args = process.argv.slice(2);
const keep = args.includes('--keep');
const scenarios = args.filter((a) => !a.startsWith('--'));
for (const s of scenarios) if (!ALL.includes(s)) throw new Error(`unknown scenario: ${s} (expected ${ALL.join(', ')})`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The terminal inside VS Code sets ELECTRON_RUN_AS_NODE, which makes Code.exe start as plain Node,
// and VSCODE_* variables, which can hand the window over to the running instance.
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(ELECTRON_|VSCODE_)/i.test(k)));
// In WSL, the Linux `code` command asks whether to use the Windows one instead.
cleanEnv.DONT_PROMPT_WSL_INSTALL = '1';

function findCode() {
  if (process.env.VSCODE_PATH) return process.env.VSCODE_PATH;
  const candidates = {
    win32: [
      path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Microsoft VS Code', 'Code.exe'),
      path.join(process.env.ProgramFiles ?? '', 'Microsoft VS Code', 'Code.exe'),
    ],
    darwin: [
      '/Applications/Visual Studio Code.app/Contents/MacOS/Code',
      '/Applications/Visual Studio Code.app/Contents/MacOS/Electron',
    ],
    linux: ['/usr/share/code/code', '/snap/code/current/usr/share/code/code'],
  }[process.platform] ?? [];
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw new Error('VS Code not found; set VSCODE_PATH to the Code executable');
  return found;
}

function findCli(code) {
  if (process.env.VSCODE_CLI) return process.env.VSCODE_CLI;
  if (process.platform === 'win32') return path.join(path.dirname(code), 'bin', 'code.cmd');
  if (process.platform === 'darwin') return path.resolve(path.dirname(code), '..', 'Resources', 'app', 'bin', 'code');
  return path.join(path.dirname(code), 'bin', 'code');
}

function run(cmd, cmdArgs, opts = {}) {
  const r = spawnSync(cmd, cmdArgs, { stdio: 'inherit', shell: process.platform === 'win32', ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${cmdArgs.join(' ')} exited with ${r.status}`);
}

const quote = (p) => (process.platform === 'win32' ? `"${p}"` : p);
const FFMPEG = process.env.FFMPEG ?? 'ffmpeg';

const baseSettings = {
  'workbench.colorTheme': 'Default Dark Modern',
  'workbench.startupEditor': 'none',
  'workbench.tips.enabled': false,
  'workbench.activityBar.location': 'hidden',
  'workbench.secondarySideBar.defaultVisibility': 'hidden',
  'workbench.layoutControl.enabled': false,
  'workbench.editor.showTabs': 'single',
  'window.commandCenter': false,
  'window.restoreWindows': 'none',
  'chat.disableAIFeatures': true,
  'chat.commandCenter.enabled': false,
  'editor.fontSize': 16,
  // The same font on Windows and on the Linux runner (fonts-cascadia-code) that records them in CI.
  'editor.fontFamily': "'Cascadia Code', Consolas, monospace",
  'editor.minimap.enabled': false,
  'editor.stickyScroll.enabled': false,
  'editor.guides.indentation': false,
  'editor.cursorBlinking': 'solid',
  'editor.occurrencesHighlight': 'off',
  'editor.selectionHighlight': false,
  'breadcrumbs.enabled': false,
  'update.mode': 'none',
  'extensions.autoCheckUpdates': false,
  'extensions.ignoreRecommendations': true,
  'telemetry.telemetryLevel': 'off',
  'security.workspace.trust.enabled': false,
  'bashExplainer.language': 'en',
  'bashExplainer.hover.enabled': true,
  'bashExplainer.inline.enabled': false,
  'bashExplainer.panel.autoOpen': false,
};
const scenarioSettings = {
  demo: {},
  hover: {},
  panel: { 'bashExplainer.hover.enabled': false, 'bashExplainer.panel.autoOpen': true },
  inline: { 'bashExplainer.hover.enabled': false, 'bashExplainer.inline.enabled': true },
};
const viewport = { demo: [1280, 720], hover: [1000, 600], panel: [1280, 720], inline: [1280, 720] };
const startMouse = { demo: [900, 600], hover: [900, 520], panel: [330, 640], inline: [-100, -100] };

async function launch(code, work, extDir, scenario) {
  const ud = path.join(work, `user-data-${scenario}`);
  fs.mkdirSync(path.join(ud, 'User'), { recursive: true });
  fs.writeFileSync(path.join(ud, 'User', 'settings.json'), JSON.stringify({ ...baseSettings, ...scenarioSettings[scenario] }, null, 2));
  const port = 9300 + Math.floor(Math.random() * 500);
  const proc = spawn(code, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${ud}`,
    `--extensions-dir=${extDir}`,
    '--disable-workspace-trust',
    '--skip-welcome',
    '--skip-release-notes',
    '--disable-telemetry',
    '--new-window',
    // CI runners (Ubuntu 24.04) do not allow Chromium's sandbox.
    ...(process.platform === 'linux' && process.env.CI ? ['--no-sandbox', '--disable-gpu'] : []),
    IMAGES,
    path.join(IMAGES, 'demo.sh'),
  ], { stdio: ['ignore', 'ignore', fs.openSync(path.join(work, `${scenario}-vscode.log`), 'w')], env: cleanEnv });

  let browser;
  for (let i = 0; i < 60 && !browser; i++) {
    await sleep(500);
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); } catch {}
  }
  if (!browser) throw new Error(`could not connect to VS Code; see ${path.join(work, `${scenario}-vscode.log`)}`);
  let page;
  for (let i = 0; i < 60 && !page; i++) {
    for (const c of browser.contexts()) for (const p of c.pages()) if (p.url().includes('workbench')) page = p;
    if (!page) await sleep(500);
  }
  if (!page) throw new Error('VS Code window not found');

  // Electron does not let CDP resize the window, so emulate the viewport instead.
  const cdp = await page.context().newCDPSession(page);
  const [width, height] = viewport[scenario];
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1.5, mobile: false });
  await page.waitForSelector('.monaco-editor .view-line', { timeout: 60000 });
  await sleep(3000);

  const close = async () => {
    await browser.close().catch(() => {});
    if (process.platform === 'win32') spawnSync('taskkill', ['/F', '/T', '/PID', String(proc.pid)], { stdio: 'ignore' });
    else proc.kill();
    await sleep(1000);
  };
  return { page, close };
}

async function record(page, scenario, frameDir) {
  if (await page.locator('.part.sidebar:visible').count()) await page.keyboard.press('Control+B');
  await page.keyboard.press('Control+Shift+P');
  await page.keyboard.type('Notifications: Clear All Notifications');
  await sleep(400);
  await page.keyboard.press('Enter');
  await sleep(500);

  // Screenshots do not include the mouse pointer, so draw one.
  await page.evaluate(() => {
    const NS = 'http://www.w3.org/2000/svg';
    const d = document.createElement('div');
    d.id = '__cursor';
    d.style.cssText = 'position:fixed;left:-100px;top:-100px;width:20px;height:28px;z-index:2147483647;pointer-events:none;';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', '20');
    svg.setAttribute('height', '28');
    svg.setAttribute('viewBox', '0 0 20 28');
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', 'M1 1 L1 22 L6 17 L10 26 L13.5 24.5 L9.5 16 L16.5 16 Z');
    p.setAttribute('fill', '#fff');
    p.setAttribute('stroke', '#000');
    p.setAttribute('stroke-width', '1.5');
    p.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(p);
    d.appendChild(svg);
    document.body.appendChild(d);
  });

  let [mx, my] = startMouse[scenario];
  const setCursor = (x, y) => page.evaluate(([x, y]) => {
    const c = document.getElementById('__cursor');
    c.style.left = `${x}px`;
    c.style.top = `${y}px`;
  }, [x, y]);
  const moveTo = async (x, y, ms = 600) => {
    const steps = Math.max(1, Math.round(ms / 30));
    const sx = mx, sy = my;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps, e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      const x2 = sx + (x - sx) * e, y2 = sy + (y - sy) * e;
      await page.mouse.move(x2, y2);
      await setCursor(x2, y2);
      await sleep(15);
    }
    mx = x;
    my = y;
  };
  const click = async () => { await page.mouse.down(); await sleep(60); await page.mouse.up(); };

  // Box of `word` on editor line `n` (1-based).
  const wordBox = (n, word) => page.evaluate(([n, word]) => {
    const ed = document.querySelector('.editor-instance .monaco-editor');
    const lineH = parseFloat(getComputedStyle(ed.querySelector('.view-line')).height);
    const line = [...ed.querySelectorAll('.view-lines .view-line')].find((l) => Math.round(parseFloat(l.style.top) / lineH) === n - 1);
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    let text = '';
    const nodes = [];
    while (walker.nextNode()) { nodes.push([walker.currentNode, text.length]); text += walker.currentNode.textContent; }
    const idx = text.indexOf(word);
    const at = (pos) => { for (let j = nodes.length - 1; j >= 0; j--) if (nodes[j][1] <= pos) return [nodes[j][0], pos - nodes[j][1]]; };
    const r = document.createRange();
    const [a, ao] = at(idx), [b, bo] = at(idx + word.length - 1);
    r.setStart(a, ao);
    r.setEnd(b, bo + 1);
    const rect = r.getBoundingClientRect();
    return { x: rect.x, w: rect.width, cy: rect.y + rect.height / 2 };
  }, [n, word]);
  const hoverWord = async (n, word, ms = 700) => { const b = await wordBox(n, word); await moveTo(b.x + b.w / 2, b.cy, ms); };
  const clickLineEnd = async (n) => {
    const b = await page.evaluate((n) => {
      const ed = document.querySelector('.editor-instance .monaco-editor');
      const lineH = parseFloat(getComputedStyle(ed.querySelector('.view-line')).height);
      const line = [...ed.querySelectorAll('.view-lines .view-line')].find((l) => Math.round(parseFloat(l.style.top) / lineH) === n - 1);
      const r = line.firstElementChild.getBoundingClientRect();
      return { x: r.right + 30, y: r.y + r.height / 2 };
    }, n);
    await page.mouse.click(b.x, b.y);
  };
  const panelFrame = async () => {
    for (let i = 0; i < 50; i++) {
      for (const f of page.frames()) {
        try { if (await f.$('#where')) return f; } catch {}
      }
      await sleep(200);
    }
    throw new Error('panel webview not found');
  };

  const frames = [];
  let recording = false;
  const start = () => {
    recording = true;
    const loop = (async () => {
      const t0 = Date.now();
      while (recording) {
        frames.push({ t: Date.now() - t0, buf: await page.screenshot({ type: 'png' }) });
        await sleep(40);
      }
    })();
    return async () => { recording = false; await loop; };
  };

  await page.mouse.move(mx, my);
  await setCursor(mx, my);

  if (scenario === 'demo') {
    await clickLineEnd(8);
    const stop = start();
    await sleep(300);
    await hoverWord(8, 'grep', 800);
    await sleep(1600);
    // The link sits at the bottom of a long hover; scroll it into view.
    const link = page.locator('.monaco-hover a', { hasText: 'Open in panel' }).first();
    const hb = await page.locator('.monaco-hover:visible').first().boundingBox();
    await moveTo(hb.x + hb.width * 0.55, Math.min(hb.y + hb.height * 0.6, 640), 700);
    let lb = await link.boundingBox();
    for (let i = 0; i < 20 && lb.y + lb.height > Math.min(700, hb.y + hb.height - 8); i++) {
      await page.mouse.wheel(0, 100);
      await sleep(120);
      lb = await link.boundingBox();
    }
    await sleep(400);
    await moveTo(lb.x + lb.width / 2, lb.y + lb.height / 2, 700);
    await sleep(300);
    await click();
    // Keep the old hover from coming back over the new panel.
    await page.keyboard.press('Escape');
    await moveTo(mx, 690, 250);
    await page.keyboard.press('Escape');
    await sleep(700);
    const f = await panelFrame();
    const sb = await f.locator('.seg', { hasText: '2>/dev/null' }).first().boundingBox();
    await moveTo(sb.x + sb.width / 2, 690, 500);
    await moveTo(sb.x + sb.width / 2, sb.y + sb.height / 2, 600);
    await sleep(1800);
    await moveTo(300, 600, 700);
    await clickLineEnd(10);
    await sleep(300);
    await page.keyboard.press('ArrowDown');
    await sleep(1500);
    await page.keyboard.press('ArrowDown');
    await sleep(1800);
    await stop();
  } else if (scenario === 'hover') {
    const stop = start();
    await sleep(500);
    await hoverWord(2, 'pipefail', 900);
    await sleep(2600);
    // A hover covers the lines below it, so step aside to close it before the next one.
    for (const [n, word, wait] of [[4, ':-', 2800], [7, '-s', 3000]]) {
      await moveTo(1000, (await wordBox(n, word)).cy, 700);
      await sleep(700);
      await hoverWord(n, word, 700);
      await sleep(wait);
    }
    await stop();
  } else if (scenario === 'panel') {
    await clickLineEnd(1);
    await sleep(2500);
    await panelFrame();
    const stop = start();
    await sleep(600);
    for (let n = 2; n <= 11; n++) {
      await page.keyboard.press('ArrowDown');
      await sleep([3, 5, 9].includes(n) ? 500 : 1100);
    }
    const f = await panelFrame();
    const row = f.locator('.row').filter({ has: f.locator('.label', { hasText: /^\s*-exec\s*$/ }) }).first();
    const scrolled = await row.evaluate((el) => {
      if (el.getBoundingClientRect().bottom <= innerHeight - 40) return false;
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return true;
    });
    if (scrolled) await sleep(900);
    const rb = await row.boundingBox();
    await moveTo(rb.x + 50, rb.y + rb.height / 2, 900);
    await sleep(2200);
    await moveTo(rb.x - 200, rb.y + 300, 600);
    await page.keyboard.press('ArrowDown');
    await sleep(1800);
    await stop();
  } else if (scenario === 'inline') {
    await clickLineEnd(8);
    await sleep(1500);
    fs.writeFileSync(path.join(frameDir, 'still.png'), await page.screenshot({ type: 'png' }));
    return;
  }

  const name = (i) => `f${String(i).padStart(4, '0')}.png`;
  let list = '';
  frames.forEach((fr, i) => {
    fs.writeFileSync(path.join(frameDir, name(i)), fr.buf);
    const next = frames[i + 1]?.t ?? fr.t + 100;
    list += `file '${name(i)}'\nduration ${((next - fr.t) / 1000).toFixed(3)}\n`;
  });
  list += `file '${name(frames.length - 1)}'\n`;
  fs.writeFileSync(path.join(frameDir, 'list.txt'), list);
  console.log(`${scenario}: ${frames.length} frames, ${(frames.at(-1).t / 1000).toFixed(1)}s`);
}

function encode(scenario, frameDir) {
  if (scenario === 'inline') {
    // Keep the editor lines only; the rest of the window is empty.
    run(FFMPEG, ['-loglevel', 'error', '-y', '-i', quote(path.join(frameDir, 'still.png')),
      '-vf', quote('crop=iw:ih*0.53:0:0,scale=1000:-1:flags=lanczos'), quote(path.join(IMAGES, 'inline.png'))]);
    return;
  }
  const filter = 'fps=10,scale=1000:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=192:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle';
  run(FFMPEG, ['-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', 'list.txt',
    '-vf', quote(filter), '-loop', '0', quote(path.join(IMAGES, `${scenario}.gif`))], { cwd: frameDir });
}

const code = findCode();
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'bash-explainer-images-'));
let failed = true;
try {
  const vsix = path.join(work, 'bash-explainer.vsix');
  const extDir = path.join(work, 'extensions');
  run('node', ['esbuild.mjs', '--production'], { cwd: ROOT });
  run('npx', ['vsce', 'package', '-o', quote(vsix)], { cwd: ROOT });
  run(quote(findCli(code)), [`--extensions-dir=${quote(extDir)}`, `--user-data-dir=${quote(path.join(work, 'cli'))}`, '--install-extension', quote(vsix)], { env: cleanEnv });

  for (const scenario of scenarios.length ? scenarios : ALL) {
    const frameDir = path.join(work, scenario);
    fs.mkdirSync(frameDir, { recursive: true });
    const { page, close } = await launch(code, work, extDir, scenario);
    try {
      await record(page, scenario, frameDir);
    } catch (e) {
      await page.screenshot({ path: path.join(work, `${scenario}-error.png`) }).catch(() => {});
      throw e;
    } finally {
      await close();
    }
    encode(scenario, frameDir);
  }
  // Record which UI the images show, for the Release workflow's check (scripts/images-hash.mjs).
  if (!scenarios.length || ALL.every((s) => scenarios.includes(s))) fs.writeFileSync(path.join(IMAGES, '.source-hash'), `${imagesHash()}\n`);
  for (const f of ['demo.gif', 'hover.gif', 'panel.gif', 'inline.png']) {
    const p = path.join(IMAGES, f);
    if (fs.existsSync(p)) console.log(`${f}: ${(fs.statSync(p).size / 1024).toFixed(0)} KB`);
  }
  failed = false;
} finally {
  if (keep || failed) console.log(`kept ${work}`);
  else fs.rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
