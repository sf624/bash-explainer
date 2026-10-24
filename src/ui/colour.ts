// Colour arithmetic for the panel's palettes (src/ui/themePalette.ts): CSS colours read as sRGB, WCAG's contrast,
// OKLab and OKLCH (Björn Ottosson's), and two colour differences, ΔE in OKLab and CIEDE2000.
// Pure, with no dependency.

/** An sRGB colour, each channel 0–255 (not rounded). */
export type RGB = [number, number, number];

/** OKLCH: lightness 0–1, chroma (0 to about 0.4), hue in degrees. */
export type LCH = [number, number, number];

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/**
 * A CSS colour as VS Code writes it (`#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()`, `rgba()`); one with an alpha below 1
 * is laid over `under` (or taken as opaque when there is nothing under it). Undefined for anything else (`var(…)`, names).
 */
export function parseColour(css: string, under?: RGB): RGB | undefined {
  const s = css.trim();
  let rgb: number[];
  let alpha = 1;
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(s);
  const fn = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i.exec(s);
  if (hex) {
    const h = hex[1].length <= 4 ? [...hex[1]].map((c) => c + c).join('') : hex[1];
    rgb = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    if (h.length === 8) alpha = parseInt(h.slice(6), 16) / 255;
  } else if (fn) {
    rgb = [fn[1], fn[2], fn[3]].map(Number);
    if (fn[4]) alpha = fn[4].endsWith('%') ? parseFloat(fn[4]) / 100 : Number(fn[4]);
  } else {
    return undefined;
  }
  if (alpha >= 1 || !under) return rgb as RGB;
  return rgb.map((c, i) => alpha * c + (1 - alpha) * under[i]) as RGB;
}

/** `#rrggbb`, each channel rounded and kept in range. */
export function toHex(c: RGB): string {
  return '#' + c.map((x) => Math.round(clamp(x, 0, 255)).toString(16).padStart(2, '0')).join('');
}

/** `a` mixed with `b`, `t` of `b` (as CSS `color-mix(in srgb, b t, a)`). */
export function mix(a: RGB, b: RGB, t: number): RGB {
  return a.map((x, i) => x + (b[i] - x) * t) as RGB;
}

const linear = (c: number) => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
const encode = (x: number) => 255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);

/** WCAG's relative luminance. */
export function luminance([r, g, b]: RGB): number {
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** WCAG's contrast ratio of two colours (1 to 21). */
export function contrast(a: RGB, b: RGB): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** sRGB to OKLab. */
export function toOklab(c: RGB): [number, number, number] {
  const [R, G, B] = c.map(linear);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

/** OKLab to sRGB, channels not clamped (out of 0–255 when the colour is out of gamut). */
function fromOklabRaw([L, a, b]: [number, number, number]): RGB {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  return lin.map((x) => (x < 0 ? -encode(-x) : encode(x))) as RGB;
}

/** sRGB to OKLCH (the hue of a grey is 0). */
export function toOklch(c: RGB): LCH {
  const [L, a, b] = toOklab(c);
  const C = Math.hypot(a, b);
  return [L, C, C < 1e-4 ? 0 : (Math.atan2(b, a) * 180 / Math.PI + 360) % 360];
}

/** Whether a raw sRGB colour lies in the gamut (with a little slack for rounding). */
const inGamut = (c: RGB) => c.every((x) => x >= -0.5 && x <= 255.5);

/** OKLCH to sRGB; out of gamut, the chroma is lowered (lightness and hue kept) until it fits. */
export function fromOklch([L, C, h]: LCH): RGB {
  const at = (c: number) => fromOklabRaw([L, c * Math.cos(h * Math.PI / 180), c * Math.sin(h * Math.PI / 180)]);
  if (inGamut(at(C))) return at(C);
  let lo = 0;
  let hi = C;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(at(mid))) lo = mid;
    else hi = mid;
  }
  return at(lo).map((x) => clamp(x, 0, 255)) as RGB;
}

/** The distance of two colours in OKLab, times 100 (about 2 is the smallest difference one sees). */
export function deltaEOK(a: RGB, b: RGB): number {
  const [x, y] = [toOklab(a), toOklab(b)];
  return 100 * Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

/** sRGB to CIELAB (D65). */
function toLab(c: RGB): [number, number, number] {
  const [R, G, B] = c.map(linear);
  const xyz = [(0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047, 0.2126729 * R + 0.7151522 * G + 0.072175 * B, (0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883];
  const f = xyz.map((t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116));
  return [116 * f[1] - 16, 500 * (f[0] - f[1]), 200 * (f[1] - f[2])];
}

/** CIEDE2000 (kL = kC = kH = 1): about 1 is the smallest difference one sees, 10 a clearly other colour. */
export function deltaE2000(a: RGB, b: RGB): number {
  const [L1, a1, b1] = toLab(a);
  const [L2, a2, b2] = toLab(b);
  const rad = Math.PI / 180;
  const Cbar = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cbar ** 7 / (Cbar ** 7 + 25 ** 7)));
  const [ap1, ap2] = [a1 * (1 + G), a2 * (1 + G)];
  const [C1, C2] = [Math.hypot(ap1, b1), Math.hypot(ap2, b2)];
  const hue = (bb: number, aa: number) => (bb === 0 && aa === 0 ? 0 : (Math.atan2(bb, aa) / rad + 360) % 360);
  const [h1, h2] = [hue(b1, ap1), hue(b2, ap2)];
  const dL = L2 - L1;
  const dC = C2 - C1;
  let dh = 0;
  if (C1 * C2 !== 0) dh = Math.abs(h2 - h1) <= 180 ? h2 - h1 : h2 - h1 > 180 ? h2 - h1 - 360 : h2 - h1 + 360;
  const dH = 2 * Math.sqrt(C1 * C2) * Math.sin((dh / 2) * rad);
  const Lbar = (L1 + L2) / 2;
  const Cb = (C1 + C2) / 2;
  let hbar = h1 + h2;
  if (C1 * C2 !== 0) hbar = Math.abs(h1 - h2) <= 180 ? (h1 + h2) / 2 : h1 + h2 < 360 ? (h1 + h2 + 360) / 2 : (h1 + h2 - 360) / 2;
  const T = 1 - 0.17 * Math.cos((hbar - 30) * rad) + 0.24 * Math.cos(2 * hbar * rad) + 0.32 * Math.cos((3 * hbar + 6) * rad) - 0.2 * Math.cos((4 * hbar - 63) * rad);
  const SL = 1 + (0.015 * (Lbar - 50) ** 2) / Math.sqrt(20 + (Lbar - 50) ** 2);
  const SC = 1 + 0.045 * Cb;
  const SH = 1 + 0.015 * Cb * T;
  const RT = -2 * Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)) * Math.sin(60 * Math.exp(-(((hbar - 275) / 25) ** 2)) * rad);
  return Math.sqrt((dL / SL) ** 2 + (dC / SC) ** 2 + (dH / SH) ** 2 + RT * (dC / SC) * (dH / SH));
}
