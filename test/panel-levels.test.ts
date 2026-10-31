// The levels of the notes in the VS Code panel (media/panel.js, media/panel.css; docs/design/note-levels.md), in
// headless Chromium with the theme variables of VS Code's own themes (test/support/panel-page.ts): each note has the
// icon of its level and its word, in the level's colour, warnings first; the copy of the line underlines its
// problems; with forced colours, the shapes and the words still tell the levels apart. Skipped when no browser can
// start, unless $BASH_EXPLAINER_BROWSER is set.
import * as assert from 'assert';
import type { Browser, Page } from 'playwright-core';
import { PanelServer, PanelTheme, servePanel } from './support/panel-page';
import { until } from './support/site';

// A plain fact, a caveat and a pitfall, in the order found.
const LINE = 'exit 300; read line; x = 1';

/** A colour as the browser computes it. */
const rgb = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;

describe('the VS Code panel: the levels of the notes', function () {
  this.timeout(60000);
  let browser: Browser | undefined;
  let panel: PanelServer;

  before(async function () {
    if (Number(process.versions.node.split('.')[0]) < 20) return this.skip();
    try {
      const { chromium } = await import('playwright-core');
      browser = await chromium.launch();
    } catch (e) {
      if (process.env.BASH_EXPLAINER_BROWSER) throw e;
      return this.skip();
    }
    panel = await servePanel(LINE, 'levels.sh');
  });

  after(async () => {
    await browser?.close();
    await panel?.close();
  });

  async function open(theme: PanelTheme = 'dark', lang: 'en' | 'ja' = 'en', forced = false): Promise<Page & { errors: string[] }> {
    const page = await browser!.newPage({ viewport: { width: 700, height: 600 } });
    if (forced) await page.emulateMedia({ forcedColors: 'active' });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.goto(panel.url(theme, lang));
    await until('the notes', () => page.locator('#notes .note').count(), (n) => n === 3);
    return Object.assign(page, { errors });
  }

  /** Each note as drawn: its class, its icon and the icon's name, its word, and the colours of the icon, the word and the border. */
  const notes = (page: Page) => page.evaluate(`[...document.querySelectorAll('#notes .note')].map((p) => {
    const svg = p.querySelector('svg.note-icon');
    const label = p.querySelector('.note-label');
    const cs = (e) => e && getComputedStyle(e);
    return {
      level: p.className, icon: svg.dataset.icon, name: svg.getAttribute('aria-label'), label: label ? label.textContent : '',
      fill: cs(svg).fill, colour: label ? cs(label).color : '', border: cs(p).borderLeftColor, style: cs(p).borderLeftStyle,
      text: p.querySelector('.note-text').textContent.slice(0, 20),
    };
  })`) as Promise<{ level: string; icon: string; name: string; label: string; fill: string; colour: string; border: string; style: string; text: string }[]>;

  it('draws each note with the icon and the word of its level, warnings first', async () => {
    const page = await open();
    const n = await notes(page);
    assert.deepStrictEqual(n.map((x) => [x.level, x.icon, x.name, x.label]), [
      ['note level-warning', 'warning', 'Warning', 'Pitfall:'],
      ['note level-info', 'info', 'Information', 'Caveat:'],
      ['note level-note', 'info', 'Note', ''],
    ]);
    assert.ok(n[0].text.startsWith('Pitfall: x =…'), n[0].text);
    assert.ok(n[2].text.startsWith('An exit status'), n[2].text);
    // The word is bold.
    assert.strictEqual(await page.locator('#notes .note-label').first().evaluate((e) => e.tagName), 'STRONG');
    const ja = await open('dark', 'ja');
    assert.deepStrictEqual((await notes(ja)).map((x) => [x.name, x.label]), [['警告', '落とし穴:'], ['情報', '注意:'], ['補足', '']]);
    assert.deepStrictEqual([...page.errors, ...ja.errors], []);
    await page.close();
    await ja.close();
  });

  // The theme's editorWarning and editorInfo colours, or ours where they are not readable as text (src/levels.ts, `ours`).
  const COLOURS: Record<PanelTheme, { warning: string; info: string; muted: string }> = {
    dark: { warning: '#cca700', info: '#3794ff', muted: rgb('#9d9d9d') },
    light: { warning: '#855f00', info: '#005fb8', muted: rgb('#3b3b3b') },
    hc: { warning: '#ffd370', info: '#6badff', muted: 'rgba(255, 255, 255, 0.7)' },
  };
  for (const theme of ['dark', 'light', 'hc'] as const) {
    it(`colours the icon, the word and the border with the level's colour, ${theme}`, async () => {
      const page = await open(theme);
      const [w, i, note] = await notes(page);
      const c = COLOURS[theme];
      assert.deepStrictEqual([w.fill, w.colour, w.border], [rgb(c.warning), rgb(c.warning), rgb(c.warning)]);
      assert.deepStrictEqual([i.fill, i.colour, i.border], [rgb(c.info), rgb(c.info), rgb(c.info)]);
      // A plain fact: the muted icon, and the quote's own border.
      assert.strictEqual(note.fill, c.muted);
      assert.notStrictEqual(note.border, rgb(c.warning));
      assert.notStrictEqual(note.border, rgb(c.info));
      await page.close();
    });
  }

  it('keeps the levels apart with forced colours: the icons, the words, and a double border for a warning', async () => {
    const page = await open('dark', 'en', true);
    const [w, i, note] = await notes(page);
    assert.deepStrictEqual([w.icon, i.icon, note.icon], ['warning', 'info', 'info']);
    assert.deepStrictEqual([w.label, i.label], ['Pitfall:', 'Caveat:']);
    assert.strictEqual(w.style, 'double');
    assert.strictEqual(i.style, 'solid');
    // (The icons and the words in the system's text colour, as the rest of the text.)
    const text = await page.evaluate(`getComputedStyle(document.querySelector('.note-text')).color`);
    for (const x of [w, i, note]) assert.strictEqual(x.fill, text);
    assert.strictEqual(w.colour, text);
    await page.close();
  });

  it('underlines the problems of the line in its copy, in the level\'s colour', async () => {
    const page = await open();
    const marked = await page.evaluate(`[...document.querySelectorAll('#line .squiggle')].map((s) => [s.textContent, s.classList.contains('level-warning') ? 'warning' : 'info', getComputedStyle(s).textDecorationStyle, getComputedStyle(s).textDecorationColor])`) as [string, string, string, string][];
    // `read line` (read-without-r) and `x = 1` (assignment-with-spaces), and nothing else.
    assert.deepStrictEqual(marked.filter((m) => m[1] === 'info').map((m) => m[0]).join('').replace(/\s/g, ''), 'readline');
    assert.deepStrictEqual(marked.filter((m) => m[1] === 'warning').map((m) => m[0]).join('').replace(/\s/g, ''), 'x=1');
    for (const [, level, style, colour] of marked) {
      assert.strictEqual(style, 'wavy');
      assert.strictEqual(colour, rgb(level === 'warning' ? '#cca700' : '#3794ff'));
    }
    await page.close();
  });
});
