// The web page's settings (docs/design/chrome-redesign.md, C6), as data: its sections and the settings of each, what
// its search finds, and where a description may be cut before its "More". web/settings-dialog.ts measures and draws.
import { PAGE_SECTIONS, PREFIX, type PageSection, type SettingSpec } from '../settings';

/** The sections of the page's settings, in their order: those of the settings, then Data (export, import, stored data). */
export const SETTINGS_SECTIONS = [...PAGE_SECTIONS, 'data'] as const;
export type SettingsSection = PageSection | 'data';

/**
 * The page's sections and the settings of each, in the order of `specs`. Without a pointer that hovers (a touch
 * screen), the settings that need one are left out. Data holds no setting.
 */
export function pageSections(specs: readonly SettingSpec[], hover: boolean): { section: SettingsSection; specs: SettingSpec[] }[] {
  const shown = specs.filter((s) => hover || !s.needsHover);
  return SETTINGS_SECTIONS.map((section) => ({ section, specs: shown.filter((s) => s.section === section) }));
}

/**
 * Whether the search finds a setting: every word of the query is in its title or its key (with or without
 * `bashExplainer.`), whatever the case. An empty query finds everything.
 */
export function settingMatches(query: string, title: string, key = ''): boolean {
  const hay = `${title}\n${key ? PREFIX + key : ''}`.toLowerCase();
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}

/**
 * The places a description may be cut before "… More", in order: [part, offset]. A part is the text of a text node,
 * or null for an element (a code span, a link), which is never cut inside: the cut goes before it. A text is cut
 * before a blank, or after a Japanese or full-width character (where Japanese breaks a line).
 */
export function cutPoints(parts: readonly (string | null)[]): [number, number][] {
  const out: [number, number][] = [];
  parts.forEach((text, i) => {
    if (text === null) {
      out.push([i, 0]);
      return;
    }
    for (let k = 1; k < text.length; k++) {
      if (/\s/.test(text[k]) || /[　-鿿＀-￯]/.test(text[k - 1])) out.push([i, k]);
    }
  });
  return out;
}

/** The last of `n` places where `fits` holds, when it holds up to a place and not after it; -1 when it holds nowhere. */
export function lastFit(n: number, fits: (i: number) => boolean): number {
  let lo = 0;
  let hi = n - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (fits(mid)) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}
