// The panel's role colours from the editor's colour theme (`bashExplainer.panel.colors`), from the theme's colours of
// the roles (src/ui/themeTokens.ts) and what the panel is drawn on (its backgrounds, its foreground, and its own
// palette, "classic", as the webview computes them). Pure. docs/design/tree-view/README.md ("Colours from the theme").
import { contrast, deltaE2000, deltaEOK, fromOklch, luminance, mix, parseColour, RGB, toHex, toOklch, type LCH } from './colour';
import { ROLES, type Role } from './themeTokens';
import type { PanelColours } from '../settings';

/** What the webview reports of the theme in use: the colours it draws text on and the panel's own colours. */
export interface PanelBase {
  /** A high contrast theme: text needs 7:1, and the Reading view draws no tints. */
  highContrast: boolean;
  /** The backgrounds text is drawn on; the first, the editor's, is the base of the Reading view's tints. */
  backgrounds: string[];
  /** The text colour of the editor (a part the theme does not colour is drawn in it). */
  foreground: string;
  /** The panel's own colour of each role (media/panel.css, in this theme). */
  classic: Record<Role, string>;
}

/**
 * The distinctions the panel keeps, as its own palette has them: roles of one group share a colour there (a builtin
 * and a command, an operator and a keyword). Text the theme leaves in the foreground counts as an argument.
 */
export const GROUP: Record<Role, string> = {
  command: 'command', builtin: 'command', option: 'option', argument: 'text', string: 'text', number: 'text',
  keyword: 'keyword', operator: 'keyword', redirect: 'redirect', pattern: 'redirect', variable: 'variable', assignment: 'variable', comment: 'comment',
  // (The shebang names the program that runs the file: a command's colour, unless the theme gives it one of its own.)
  shebang: 'command',
};

/**
 * The roles from the most frequent to the rarest: the share of the coloured segments of the panel's line over the
 * corpus (test/fixtures/sample.sh, the snippets, the host files; October 2026): command 15.2% (with functions,
 * subcommands and aliases), operator 13.8% (with `[[ ]]` and `{ }`), string 13.6, argument 12.2, variable 12.0 (with
 * expansions and `$( )`), builtin 8.5, keyword 7.4, option 7.2; then pattern 3.4, redirect 1.9, assignment 1.8, number 1.8, comment 0.5, and the
 * shebang (at most one a script), after the comment, so that its theme colour, a comment's in most themes, gives way to the command's.
 */
export const ROLE_ORDER: readonly Role[] = ['command', 'operator', 'string', 'argument', 'variable', 'builtin', 'keyword', 'option', 'pattern', 'redirect', 'assignment', 'number', 'comment', 'shebang'];

/** The roles each layer of the Reading view tints its band with (media/panel.css `--l-*`), and the tint's share. */
const TINT_ROLES: readonly Role[] = ['keyword', 'command', 'argument', 'option'];
const TINT = 0.06;

/** The frequent roles (5% of the segments or more): they keep the theme's colour unless it is all but the same as another's. */
export const FREQUENT: readonly Role[] = ROLE_ORDER.slice(0, 8);

/** Two roles of different groups closer than this (ΔE in OKLab × 100) count as one colour; for a frequent role, `SAME`. */
export const DISTINCT = 8;
export const SAME = 5;

const rgb = (css: string): RGB => parseColour(css) ?? [128, 128, 128];

/** A colour as the panel gets it: rounded to `#rrggbb` (the contrast is measured on that). */
const rounded = (c: RGB): RGB => rgb(toHex(c));

/** The surfaces a palette's text is drawn on: the backgrounds, and in a theme that is not high contrast, the Reading view's tints (with a row or a code block over them). */
function surfaces(base: PanelBase, palette?: Record<Role, string>): RGB[] {
  const first = rgb(base.backgrounds[0]);
  const bgs = [first, ...base.backgrounds.slice(1).map((b) => parseColour(b, first) ?? first)];
  if (base.highContrast || !palette) return bgs;
  // The tints, and a translucent background (a hovered row, a code block) over each.
  const tints = TINT_ROLES.map((r) => mix(first, rgb(palette[r]), TINT));
  return [...bgs, ...tints, ...tints.flatMap((t) => base.backgrounds.slice(1).map((b) => parseColour(b, t) ?? t))];
}

const minContrast = (c: RGB, on: RGB[]) => Math.min(...on.map((b) => contrast(c, b)));

/** The contrast text needs. */
const needed = (base: PanelBase) => (base.highContrast ? 7 : 4.5);

/**
 * The colour with its hue and chroma, lighter (on a dark background) or darker (on a light one) as little as it
 * takes to reach `min` on every surface; undefined when even white or black does not.
 */
export function readable(colour: RGB, on: RGB[], min: number): RGB | undefined {
  const c = rounded(colour);
  if (minContrast(c, on) >= min) return c;
  const [L, C, h] = toOklch(c);
  const step = toOklch(on[0])[0] < 0.6 ? 0.01 : -0.01;
  for (let l = L + step; l >= 0 && l <= 1; l += step) {
    const x = rounded(fromOklch([l, C, h]));
    if (minContrast(x, on) >= min) return x;
  }
  return undefined;
}

/** "theme": each role in the theme's colour where it has one that is readable, else in the panel's own. */
function exact(theme: Record<Role, string | undefined>, base: PanelBase, on: RGB[]): Record<Role, string> {
  const out = {} as Record<Role, string>;
  for (const r of ROLES) {
    const c = theme[r] && parseColour(theme[r], rgb(base.backgrounds[0]));
    out[r] = c && minContrast(c, on) >= needed(base) ? toHex(c) : base.classic[r];
  }
  return out;
}

/** The lightness and chroma range of the theme's own colours (the chromatic ones), where new colours are made. */
function range(colours: RGB[], dark: boolean): { L: [number, number]; C: [number, number] } {
  const lch = colours.map(toOklch).filter(([, C]) => C >= 0.04);
  if (lch.length < 2) return dark ? { L: [0.7, 0.85], C: [0.1, 0.16] } : { L: [0.42, 0.56], C: [0.1, 0.16] };
  const Ls = lch.map(([L]) => L);
  const Cs = lch.map(([, C]) => C);
  return { L: [Math.min(...Ls), Math.max(...Ls)], C: [Math.min(...Cs), Math.max(...Cs)] };
}

/**
 * A new colour that sits among the theme's: lightness and chroma within the range of its own colours, the hue
 * farthest from the colours already used (the largest smallest ΔE), readable on every surface. The range widens in
 * lightness, towards more contrast, until some colour is readable.
 */
export function synthesize(used: RGB[], theme: RGB[], on: RGB[], min: number): RGB {
  const dark = toOklch(on[0])[0] < 0.6;
  const { L, C } = range(theme, dark);
  const steps = (lo: number, hi: number, n: number) => Array.from({ length: n }, (_, i) => lo + ((hi - lo) * i) / (n - 1));
  const mid: LCH = [(L[0] + L[1]) / 2, (C[0] + C[1]) / 2, 0];
  // Contrast depends on luminance only: when no luminance reaches `min` on every surface, no colour can, so the
  // search below would try every hue and lightness in vain.
  const ys = on.map(luminance);
  const reach = Math.max(...Array.from({ length: 201 }, (_, i) => Math.min(...ys.map((s) => (Math.max(i / 200, s) + 0.05) / (Math.min(i / 200, s) + 0.05)))));
  for (let widen = 0; reach >= min && widen <= 20; widen++) {
    const lo = dark ? L[0] : Math.max(0, L[0] - widen * 0.03);
    const hi = dark ? Math.min(1, L[1] + widen * 0.03) : L[1];
    let best: RGB | undefined;
    let bestScore = -Infinity;
    for (let h = 0; h < 360; h += 5) {
      for (const l of steps(lo, hi, 5)) {
        for (const c of steps(C[0], C[1], 3)) {
          const x = rounded(fromOklch([l, c, h]));
          if (minContrast(x, on) < min) continue;
          // Far from every colour in use first; then near the middle of the theme's range.
          const score = Math.min(...used.map((u) => deltaEOK(x, u))) - 10 * Math.hypot(l - mid[0], c - mid[1]);
          if (score > bestScore) {
            bestScore = score;
            best = x;
          }
        }
      }
    }
    if (best) return best;
  }
  // Nothing is readable on every surface (a black and a white one, at 7:1): the extreme towards contrast with the first.
  return dark ? [255, 255, 255] : [0, 0, 0];
}

/**
 * "themeLike": the theme's colours where they keep the panel's distinctions, new ones where they do not. In order of
 * frequency, a role keeps the theme's colour (made readable) unless it is the colour of a role of another group
 * placed before it (the foreground counts as an argument's: closer than `DISTINCT`, or `SAME` for a frequent role); a role that does not keep it takes the colour of a
 * group mate that does, or, in a group with none, a colour made for the group (`synthesize`).
 */
function themeLike(theme: Record<Role, string | undefined>, base: PanelBase, on: RGB[]): Record<Role, string> {
  const min = needed(base);
  const bg = rgb(base.backgrounds[0]);
  const fg = parseColour(base.foreground, bg) ?? rgb(base.classic.argument);
  const placed: { group: string; c: RGB }[] = [{ group: 'text', c: readable(fg, on, min) ?? fg }];
  const kept: Partial<Record<Role, RGB>> = {};
  for (const r of ROLE_ORDER) {
    const own = parseColour(theme[r] ?? base.foreground, bg) ?? fg;
    const c = readable(own, on, min);
    const apart = FREQUENT.includes(r) ? SAME : DISTINCT;
    if (!c || placed.some((p) => p.group !== GROUP[r] && deltaEOK(p.c, c) < apart)) continue;
    kept[r] = c;
    placed.push({ group: GROUP[r], c });
  }
  const themeOwn = Object.values(kept).filter((c) => deltaEOK(c, fg) >= DISTINCT);
  // A group's colour: its most frequent role's that was kept; for text with none, the foreground.
  const groupColour: Record<string, RGB> = {};
  for (const r of ROLE_ORDER) {
    const g = GROUP[r];
    if (kept[r]) groupColour[g] ??= kept[r];
  }
  groupColour.text ??= placed[0].c;
  for (const r of ROLE_ORDER) {
    const g = GROUP[r];
    if (groupColour[g]) continue;
    groupColour[g] = synthesize(placed.map((p) => p.c), themeOwn, on, min);
    placed.push({ group: g, c: groupColour[g] });
  }
  return Object.fromEntries(ROLES.map((r) => [r, toHex(kept[r] ?? groupColour[GROUP[r]])])) as Record<Role, string>;
}

/**
 * The panel's colour of each role for a value of `bashExplainer.panel.colors`, from the theme's colours of the roles
 * (undefined: the theme leaves it in the foreground). Readable on the backgrounds and on the tints the palette makes
 * itself (worked out again on them until they no longer change).
 */
export function panelPalette(mode: PanelColours, theme: Record<Role, string | undefined>, base: PanelBase): Record<Role, string> {
  // (The panel's own colours as the webview computes them: `rgb()`, or `rgba()` for a muted one, laid over the background.)
  const bg = rgb(base.backgrounds[0]);
  base = { ...base, classic: Object.fromEntries(ROLES.map((r) => [r, toHex(parseColour(base.classic[r], bg) ?? bg)])) as Record<Role, string> };
  if (mode === 'classic') return base.classic;
  const make = mode === 'theme' ? exact : themeLike;
  let palette = make(theme, base, surfaces(base, base.classic));
  for (let i = 0; i < 3; i++) {
    const next = make(theme, base, surfaces(base, palette));
    if (ROLES.every((r) => next[r] === palette[r])) break;
    palette = next;
  }
  return palette;
}

/** The CSS variables of a palette (media/panel.css `--c-*`). */
export function paletteVars(palette: Record<Role, string>): Record<string, string> {
  return Object.fromEntries(ROLES.map((r) => [`--c-${r}`, palette[r]]));
}

/** How far apart a palette keeps its groups (with the foreground as text), and how readable it is. */
export interface PaletteStats {
  /** The smallest ΔE (OKLab × 100) between two roles of different groups, and those roles. */
  deltaEOK: number;
  pair: [string, string];
  /** The smallest CIEDE2000 between two roles of different groups. */
  deltaE2000: number;
  /** The smallest contrast of a role on a surface. */
  contrast: number;
}

/** The distinctness and contrast of a palette in the theme `base` describes. */
export function paletteStats(palette: Record<Role, string>, base: PanelBase): PaletteStats {
  const on = surfaces(base, palette);
  const entries: [string, string, RGB][] = [['foreground', 'text', rgb(base.foreground)], ...ROLES.map((r): [string, string, RGB] => [r, GROUP[r], rgb(palette[r])])];
  const stats: PaletteStats = { deltaEOK: Infinity, pair: ['', ''], deltaE2000: Infinity, contrast: Math.min(...ROLES.map((r) => minContrast(rgb(palette[r]), on))) };
  for (const [i, [a, ga, ca]] of entries.entries()) {
    for (const [b, gb, cb] of entries.slice(i + 1)) {
      if (ga === gb) continue;
      const d = deltaEOK(ca, cb);
      if (d < stats.deltaEOK) Object.assign(stats, { deltaEOK: d, pair: [a, b] });
      stats.deltaE2000 = Math.min(stats.deltaE2000, deltaE2000(ca, cb));
    }
  }
  return stats;
}
