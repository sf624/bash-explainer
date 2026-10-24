import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { ERROR_COLOURS, Role, THEME_COLOURS, ThemeKind } from '../src/ui/palette';

// The contrast of the colours of the roles (the parts of a line) with every background they are drawn on,
// on the web page (web/theme.css) and in VS Code's panel and hover (media/panel.css, src/ui/palette.ts):
// WCAG's 4.5:1 for text, 7:1 in the high contrast themes.

const root = path.join(__dirname, '..');
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), 'utf8');

type RGB = [number, number, number];

/** A CSS colour: #rgb, #rrggbb or rgba(r, g, b, a), over `under` when it is not opaque. */
function parse(css: string, under?: RGB): RGB {
  let m = /^#([0-9a-f]{6})$/i.exec(css);
  if (m) return [0, 2, 4].map((i) => parseInt(m![1].slice(i, i + 2), 16)) as RGB;
  m = /^#([0-9a-f]{3})$/i.exec(css);
  if (m) return [...m[1]].map((c) => parseInt(c + c, 16)) as RGB;
  m = /^rgba\((\d+), (\d+), (\d+), ([\d.]+)\)$/.exec(css);
  assert.ok(m, `not a colour: ${css}`);
  assert.ok(under, `${css} needs a colour under it`);
  const a = Number(m[4]);
  return [1, 2, 3].map((i) => a * Number(m![i]) + (1 - a) * under[i - 1]) as RGB;
}

const linear = (c: number) => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
const luminance = ([r, g, b]: RGB) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
function contrast(a: RGB, b: RGB): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The distance of two colours in OKLab, times 100 (about 2 is the smallest difference one can see). */
function deltaE(a: RGB, b: RGB): number {
  const lab = ([r, g, b]: RGB) => {
    const [R, G, B] = [r, g, b].map(linear);
    const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
    const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
    const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
    return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
  };
  const [x, y] = [lab(a), lab(b)];
  return 100 * Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

/** The custom properties a rule declares, as { name: value }. */
function declared(css: string, selector: string): Record<string, string> {
  const at = css.indexOf(`${selector} {`);
  assert.ok(at >= 0, selector);
  const body = css.slice(at, css.indexOf('}', at));
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((d) => [d[1], d[2].trim()]));
}

const theme = read('web', 'theme.css');
const web = {
  light: declared(theme, ':root'),
  dark: declared(theme, ':root[data-theme="dark"]'),
  system: declared(theme, '  :root:not([data-theme="light"])'),
};

// The editor's active line, drawn over the editor's background (web/editor.ts).
const activeLine = /'\.cm-activeLine': \{ backgroundColor: '([^']+)' \}/.exec(read('web', 'editor.ts'))?.[1];

const CHARTS: Record<Role, string> = {
  command: '--vscode-charts-blue', option: '--vscode-charts-orange', argument: '--vscode-charts-green',
  operator: '--vscode-charts-purple', redirect: '--vscode-charts-yellow', variable: '--vscode-charts-red',
};
const ROLES = Object.keys(CHARTS) as Role[];

/** The backgrounds text is drawn on, in a set of the web page's variables (Light Modern or Dark Modern). */
function backgrounds(vars: Record<string, string>): Record<string, RGB> {
  const editor = parse(vars['--vscode-editor-background']);
  const out: Record<string, RGB> = { 'the active line': parse(activeLine!, editor) };
  for (const v of ['editor-background', 'textCodeBlock-background', 'list-hoverBackground', 'textBlockQuote-background']) {
    out[v] = parse(vars[`--vscode-${v}`], editor);
  }
  out['page-background'] = parse(vars['--page-background']);
  return out;
}

function check(name: string, colours: Record<string, string>, bgs: Record<string, RGB>, min: number): void {
  const failing: string[] = [];
  for (const [role, c] of Object.entries(colours)) {
    for (const [bg, b] of Object.entries(bgs)) {
      const r = contrast(parse(c), b);
      if (r < min) failing.push(`${role} ${c} on ${bg}: ${r.toFixed(2)}`);
    }
  }
  assert.deepEqual(failing, [], `${name}: below ${min}:1`);
}

/** No two roles closer than `min` (OKLab ΔE × 100). */
function distinct(name: string, colours: Record<Role, string>, min: number): void {
  for (const [i, a] of ROLES.entries()) {
    for (const b of ROLES.slice(i + 1)) {
      const d = deltaE(parse(colours[a]), parse(colours[b]));
      assert.ok(d >= min, `${name}: ${a} and ${b} are ${d.toFixed(1)} apart`);
    }
  }
}

describe('the contrast of the colours of the roles', () => {
  it('has the parts the test reads', () => {
    assert.ok(activeLine);
    assert.ok(Object.keys(web.light).length > 20 && Object.keys(web.dark).length > 20);
    // The dark colours, for the system's choice and for the theme switch's, are the same.
    assert.deepEqual(web.system, web.dark);
  });

  for (const kind of ['light', 'dark'] as const) {
    it(`reaches 4.5:1 on the web page, ${kind}`, () => {
      const vars = web[kind];
      const colours: Record<string, string> = Object.fromEntries(ROLES.map((r) => [r, vars[CHARTS[r]]]));
      for (const v of ['errorForeground', 'descriptionForeground', 'foreground', 'editor-foreground']) colours[v] = vars[`--vscode-${v}`];
      check(`web ${kind}`, colours, backgrounds(vars), 4.5);
      // The web page's colours are the panel's own where it has them.
      for (const r of ROLES) if (THEME_COLOURS[kind][r]) assert.equal(vars[CHARTS[r]], THEME_COLOURS[kind][r], `${kind} ${r}`);
      assert.equal(vars['--vscode-errorForeground'], ERROR_COLOURS[kind]);
    });
  }

  // VS Code's own backgrounds: in the light and dark themes, those of Light Modern and Dark Modern (as on the
  // web page) and pure white or black; in the high contrast themes, black or white and a code block.
  const vscode: Record<ThemeKind, { base: Record<string, string>; bgs: Record<string, RGB>; min: number; cls: string }> = {
    light: { base: web.light, bgs: { ...backgrounds(web.light), white: [255, 255, 255] }, min: 4.5, cls: 'vscode-light' },
    dark: { base: web.dark, bgs: { ...backgrounds(web.dark), black: [0, 0, 0] }, min: 4.5, cls: 'vscode-dark' },
    highContrast: { base: web.dark, bgs: { black: [0, 0, 0], 'a code block': parse('#1f1f1f') }, min: 7, cls: 'vscode-high-contrast' },
    highContrastLight: { base: web.light, bgs: { white: [255, 255, 255], 'a code block': parse('#f2f2f2') }, min: 7, cls: 'vscode-high-contrast-light' },
  };
  const panel = read('media', 'panel.css');
  const PANEL_VAR: Record<Role, string> = {
    command: '--c-command', option: '--c-option', argument: '--c-argument', operator: '--c-keyword', redirect: '--c-redirect', variable: '--c-variable',
  };

  for (const [kind, t] of Object.entries(vscode) as [ThemeKind, (typeof vscode)[ThemeKind]][]) {
    it(`reaches ${t.min}:1 in VS Code's panel and hover, ${kind}`, () => {
      // media/panel.css has the colours of src/ui/palette.ts, and only those.
      const own = THEME_COLOURS[kind];
      const block = declared(panel, `body.${t.cls}`);
      const error = ERROR_COLOURS[kind];
      assert.deepEqual(block, {
        ...Object.fromEntries(ROLES.filter((r) => own[r]).map((r) => [PANEL_VAR[r], own[r]])),
        ...(error ? { '--c-error': error } : {}),
      });
      // Where it has none, the theme's chart colour (the light and dark themes: Light Modern's and Dark Modern's).
      const colours = Object.fromEntries(ROLES.map((r) => [r, own[r] ?? t.base[CHARTS[r]]])) as Record<Role, string>;
      check(`VS Code ${kind}`, colours, t.bgs, t.min);
      // The error colour: our own in the light and dark themes (the high contrast themes keep theirs).
      if (error) check(`VS Code ${kind} error`, { error }, t.bgs, t.min);
      else assert.ok(kind === 'highContrast' || kind === 'highContrastLight', kind);
      distinct(`VS Code ${kind}`, colours, 8);
    });
  }

  // The tree view tints the items each reader covers with its layer's colour (media/panel.css): an opaque mix of
  // the layer's colour and the background, the same at every depth. The kind and the reader's name are in the
  // layer's colour, the texts in the foreground or the muted colour; the code is in a pill of the background's colour.
  it('reaches 4.5:1 on the layer tints of the tree view', () => {
    const pct = Number(/#reading-tree li\.band \{\s*background: color-mix\(in srgb, var\(--l\) (\d+)%, var\(--t-bg\)\);/.exec(panel)?.[1]);
    assert.ok(pct > 0 && pct < 20, `the tint: ${pct}%`);
    assert.match(panel, /\.trow \.tcode \{[^}]*background: var\(--t-bg\);/);
    const LAYERS: Record<string, Role> = { bash: 'operator', child: 'command', command: 'argument', language: 'option' };
    for (const [kind, vars] of [['web light', web.light], ['web dark', web.dark]] as const) {
      const bg = parse(vars['--vscode-editor-background']);
      for (const [layer, role] of Object.entries(LAYERS)) {
        const colour = parse(vars[CHARTS[role]]);
        const tint = colour.map((c, i) => (pct / 100) * c + (1 - pct / 100) * bg[i]) as RGB;
        const texts: Record<string, string> = { [`the ${layer} layer`]: vars[CHARTS[role]] };
        for (const v of ['descriptionForeground', 'foreground']) texts[v] = vars[`--vscode-${v}`];
        check(`${kind}, ${layer}'s tint`, texts, { [`${layer}'s tint`]: tint }, 4.5);
      }
    }
  });

  it('keeps the roles of the web page apart', () => {
    for (const kind of ['light', 'dark'] as const) {
      distinct(`web ${kind}`, Object.fromEntries(ROLES.map((r) => [r, web[kind][CHARTS[r]]])) as Record<Role, string>, 8);
    }
  });
});
