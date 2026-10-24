// PROTOTYPE harness (proto/panel-header): behaviour checks of the header variants (names, toggles, menu keys) and state screenshots. usage: node proto/panel-header/interact.mjs <outdir>
import { createRequire } from 'module';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as assert from 'assert';
const require = createRequire(new URL('../../package.json', import.meta.url));
const { chromium } = require('playwright-core');
const site = path.join(path.dirname(new URL(import.meta.url).pathname), 'page');
const out = process.argv[2];
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const root = u.startsWith('/media/') ? path.join(site, '../../..') : site;
  const p = path.join(root, u);
  if (!p.startsWith(root) || !fs.existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(p)] ?? 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/harness.html`;
const browser = await chromium.launch();

async function open(v, theme = 'dark', width = 600, lang = 'en') {
  const page = await browser.newPage({ viewport: { width, height: 420 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.stack));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${base}?theme=${theme}&lang=${lang}&hdr=${v}`);
  await page.waitForFunction(() => document.getElementById('where').textContent.length > 0);
  await page.waitForTimeout(100);
  page.errors = errors;
  return page;
}
const posted = (page) => page.evaluate(() => window.HDR_POSTED.map((m) => m.type));
const shot = (page, name, h = 260) => page.screenshot({ path: path.join(out, name), clip: { x: 0, y: 0, width: page.viewportSize().width, height: h } });

for (const v of ['v1', 'v3']) {
  const page = await open(v);
  // Names: every icon button has a tooltip and an accessible name.
  const names = await page.evaluate(() => [...document.querySelectorAll('.hdr-btn')].map((b) => [b.id, b.title, b.textContent.trim()]));
  for (const [id, title, text] of names) assert.ok(title && text === title, `${v} ${id} ${title} ${text}`);
  console.log(v, 'names', names.map((n) => n[1]).join(' | '));
  await page.click('#copy');
  assert.ok((await posted(page)).includes('copy'), 'copy posts');
  // Collapse all: the name and the icon change.
  const before = await page.$eval('#toggle svg', (s) => s.innerHTML);
  await page.click('#toggle');
  const after = await page.evaluate(() => [document.getElementById('toggle').title, document.querySelector('#toggle svg').innerHTML]);
  assert.strictEqual(after[0], 'Expand all');
  assert.notStrictEqual(after[1], before, 'toggle icon swaps');
  // The reference: pressed, icon "back".
  await page.click('#ref');
  assert.strictEqual(await page.$eval('#ref', (b) => [b.getAttribute('aria-pressed'), b.title].join()), 'true,← Back to the explanation');
  await shot(page, `hdr-${v}-state-reference.png`, 200);
  await page.click('#ref');
  // Keyboard focus ring on the copy button.
  await page.focus('#copy');
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'copy');
  await shot(page, `hdr-${v}-state-focus.png`, 120);
  const ring = await page.$eval('#copy', (b) => getComputedStyle(b).outlineStyle + ' ' + getComputedStyle(b).outlineColor);
  console.log(v, 'focus ring', ring);
  if (v === 'v1') {
    await page.click('#view-tree');
    await page.waitForTimeout(100);
    assert.strictEqual(await page.$eval('#view-tree', (b) => b.getAttribute('aria-pressed')), 'true');
    assert.ok((await posted(page)).includes('panelState'));
    await shot(page, 'hdr-v1-state-tree.png', 200);
  }
  assert.deepStrictEqual(page.errors, []);
  await page.close();
}

{
  const page = await open('v2');
  await page.focus('#hdr-more');
  await page.keyboard.press('ArrowDown');
  assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'toggle');
  await page.keyboard.press('ArrowDown');
  assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'copy');
  await shot(page, 'hdr-v2-state-menu.png', 300);
  await page.keyboard.press('Enter');
  assert.ok((await posted(page)).includes('copy'), 'menu copy posts');
  assert.strictEqual(await page.$eval('#hdr-menu', (m) => m.hidden), true, 'menu closes after an item');
  await page.click('#hdr-more');
  assert.strictEqual(await page.$eval('#hdr-more', (b) => b.getAttribute('aria-expanded')), 'true');
  await page.keyboard.press('Escape');
  assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'hdr-more');
  assert.strictEqual(await page.$eval('#hdr-menu', (m) => m.hidden), true);
  await page.click('#view-tree');
  assert.strictEqual(await page.$eval('#view-tree', (b) => b.getAttribute('aria-pressed')), 'true');
  for (const theme of ['light', 'hc']) {
    const p2 = await open('v2', theme);
    await p2.click('#hdr-more');
    await p2.hover('#ref');
    await shot(p2, `hdr-v2-state-menu-${theme === 'hc' ? 'hcdark' : theme}.png`, 300);
    await p2.close();
  }
  assert.deepStrictEqual(page.errors, []);
  await page.close();
}
// Japanese at 300px.
for (const v of ['v1', 'v2', 'v3']) {
  const page = await open(v, 'dark', 300, 'ja');
  const clipped = await page.evaluate(() => {
    const c = document.createElement('canvas').getContext('2d');
    return [...document.querySelectorAll('#top select')].filter((s) => s.clientWidth).some((s) => { const cs = getComputedStyle(s); c.font = cs.font; return c.measureText(s.options[s.selectedIndex].text).width > s.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight); })
      || document.documentElement.scrollWidth > document.documentElement.clientWidth;
  });
  console.log(v, 'ja 300 clipped/overflow', clipped);
  await shot(page, `hdr-${v}-dark-300-ja.png`);
  await page.close();
}
console.log('ok');
await browser.close();
server.close();
