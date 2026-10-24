// PROTOTYPE harness (proto/panel-header): screenshots and measurements of the panel header, before and per variant.
// usage: npx tsx proto/panel-header/gen.ts; node proto/panel-header/shoot.mjs <outdir> [variants=before,v1,v2,v3] [themes=dark,light,hc] [widths=600,300] [lang=en]
import { createRequire } from 'module';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
const require = createRequire(new URL('../../package.json', import.meta.url));
const { chromium } = require('playwright-core');

const site = path.join(path.dirname(new URL(import.meta.url).pathname), 'page');
const [out, vs = 'before,v1,v2,v3', ts = 'dark,light,hc', ws = '600,300', lang = 'en'] = process.argv.slice(2);
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const root = u.startsWith('/media/') ? path.join(site, '../../..') : site;
  const p = path.join(root, u);
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(p)] ?? 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/harness.html`;
const browser = await chromium.launch();
const themeName = { dark: 'dark', light: 'light', hc: 'hcdark' };

const measure = `(() => {
  const parse = (c) => { const m = c.match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const v = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: v[0], g: v[1], b: v[2], a: v[3] ?? 1 }; };
  const over = (f, b) => ({ r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a), a: 1 });
  const bgOf = (el) => { const stack = []; for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0) stack.push(c); } let b = { r: 255, g: 255, b: 255, a: 1 }; const root = parse(getComputedStyle(document.documentElement).backgroundColor); if (root && root.a) b = root; for (const c of stack.reverse()) b = over(c, b); return b; };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
  const ctrls = [...document.querySelectorAll('#top button, #top select, #top a, #views button, .hdr-bar button, .hdr-bar select')].filter(vis);
  const rows = ctrls.map((el) => { const r = el.getBoundingClientRect(); const bg = bgOf(el); const fg = over(parse(getComputedStyle(el).color), bg); return { id: el.id || el.className, w: Math.round(r.width), h: Math.round(r.height), contrast: +ratio(fg, bg).toFixed(2), clipped: el.tagName === "SELECT" ? (() => { const c = document.createElement("canvas").getContext("2d"); const cs = getComputedStyle(el); c.font = cs.font; return c.measureText(el.options[el.selectedIndex].text).width > el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight); })() : el.scrollWidth > el.clientWidth + 1 }; });
  const where = document.getElementById('where');
  const wb = bgOf(where);
  const top = document.getElementById('top').getBoundingClientRect();
  return {
    docOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    topHeight: Math.round(top.height),
    whereContrast: +ratio(over(parse(getComputedStyle(where).color), wb), wb).toFixed(2),
    ctrls: rows,
  };
})()`;

const report = {};
for (const v of vs.split(',')) for (const t of ts.split(',')) for (const w of ws.split(',').map(Number)) {
  const page = await browser.newPage({ viewport: { width: w, height: 420 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' || /Content Security/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.stack));
  await page.goto(`${base}?theme=${t}&lang=${lang}${v === 'before' ? '' : `&hdr=${v}`}`);
  try { await page.waitForFunction(() => document.getElementById("where").textContent.length > 0, null, { timeout: 8000 }); } catch (e) { console.log(v, t, w, errors); throw e; }
  await page.waitForTimeout(150);
  const name = `hdr-${v}-${themeName[t]}-${w}${lang === 'en' ? '' : '-' + lang}.png`;
  await page.screenshot({ path: path.join(out, name), clip: { x: 0, y: 0, width: w, height: 260 } });
  const m = await page.evaluate(measure);
  report[name] = { ...m, errors };
  await page.close();
}
fs.writeFileSync(path.join(out, `hdr-report${lang === 'en' ? '' : '-' + lang}.json`), JSON.stringify(report, null, 1));
for (const [k, m] of Object.entries(report)) {
  const minW = Math.min(...m.ctrls.map((c) => c.w)), minH = Math.min(...m.ctrls.map((c) => c.h)), minC = Math.min(...m.ctrls.map((c) => c.contrast));
  const clipped = m.ctrls.filter((c) => c.clipped).map((c) => c.id);
  console.log(`${k}: top ${m.topHeight}px, overflow ${m.docOverflow}, min target ${minW}x${minH}, min contrast ${minC} (where ${m.whereContrast}), clipped [${clipped}] ${m.errors.length ? 'ERR ' + m.errors.join(' | ') : ''}`);
}
await browser.close();
server.close();
