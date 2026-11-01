// The hit areas of the web page's controls (docs/design/chrome-redesign.md, section 5 "Hit areas", and C0): where a
// press lands, not how big the drawn box is. For each visible control the page is asked, with `elementFromPoint`
// from the control's centre outwards, how far the control itself is what a pointer finds. A control drawn small
// but given a larger hit area (a pseudo-element) measures as the larger; a control covered by another measures as
// what is left of it. The kit's inventory (the prototype of round 8) measured the same way.
import type { Frame, Page } from 'playwright-core';

export interface HitArea {
  /** The control's identity: its id, else its tag and first classes (and its role or type), the same on every load. */
  key: string;
  /** What the control is called (aria-label, title or text), for the message that names it. */
  name: string;
  /** The width and height of what a pointer finds, in CSS px (at most `CAP` each way from the centre). */
  width: number;
  height: number;
}

/** How far from the centre the probe goes in each direction: far beyond any bar. */
export const CAP = 60;

/** On a phone every control's hit area is at least this big (44×44, the touch target of Apple's guidelines and WCAG 2.5.5). */
export const PHONE_BAR = 44;
/** Side by side, at least this (24×24, WCAG 2.5.8). */
export const DESKTOP_BAR = 24;

/** A listed control may measure this many px less than the list says in either direction before it counts as shrunk: fonts and rounding differ by a pixel or two between machines. */
export const SLACK = 3;

// Runs in the page. `scope` limits the controls to those inside it (a dialog, say); the editor's own content is one control.
const SCRIPT = `(scope, cap) => {
  const root = scope ? document.querySelector(scope) : document;
  if (!root) return [];
  const selector = 'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=menuitem], [role=switch], [role=checkbox], [role=radio], [role=separator][tabindex], [tabindex]:not([tabindex="-1"])';
  const found = new Map();
  const hits = (el, x, y) => {
    const t = document.elementFromPoint(x, y);
    if (!t) return false;
    if (t === el || el.contains(t)) return true;
    const label = t.closest('label');
    return !!label && label.control === el;
  };
  const visible = (el) => {
    if (!el.getClientRects().length) return false;
    for (let e = el; e; e = e.parentElement) {
      const s = getComputedStyle(e);
      if (s.visibility === 'hidden' || s.display === 'none' || e.inert || e.classList.contains('sr-only')) return false;
      // (What is inside a closed <details>, but its <summary>, is not on the page.)
      const d = e.parentElement;
      if (d && d.tagName === 'DETAILS' && !d.open && e.tagName !== 'SUMMARY') return false;
    }
    return true;
  };
  for (const el of root.querySelectorAll(selector)) {
    // (The phone sheet's grabber lets a press through, pointer-events: none: a slider for the keyboard and a screen reader,
    // under the header's tabs, whose taps the header takes. It has no hit area of its own. Any other control that lets
    // a press through measures as nothing, and fails.)
    if (el.closest('.cm-editor') || !visible(el) || (el.id === 'sheet-grab' && getComputedStyle(el).pointerEvents === 'none')) continue;
    const name = (el.getAttribute('aria-label') || el.title || el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 40);
    const role = el.getAttribute('role') || el.getAttribute('type') || '';
    // (The settings' switches of a family, "…-disabled-sed", "…-disabled-awk", are one key: the smallest counts.)
    const key = el.id ? '#' + el.id.replace(/(-disabled-).+$/, '$1*') : el.tagName.toLowerCase() + (role ? '[' + role + ']' : '') + [...el.classList].slice(0, 2).map((c) => '.' + c).join('');
    // (A control inside its label is measured with the label in view: the label takes the press too, and a scroll that
    // only reaches the control would leave part of the label under a scroll container's edge.)
    (el.closest('label') || el).scrollIntoView({ block: 'nearest', inline: 'nearest' });
    // (The first box: an inline link that wraps has a bounding box whose centre may be between its lines.)
    const r = el.getClientRects()[0];
    const cx = Math.round(r.left + r.width / 2);
    const cy = Math.round(r.top + r.height / 2);
    let width = 0;
    let height = 0;
    if (hits(el, cx, cy)) {
      let a = 0, b = 0, c = 0, d = 0;
      while (a < cap && hits(el, cx - a - 1, cy)) a++;
      while (b < cap && hits(el, cx + b + 1, cy)) b++;
      while (c < cap && hits(el, cx, cy - c - 1)) c++;
      while (d < cap && hits(el, cx, cy + d + 1)) d++;
      width = a + b + 1;
      height = c + d + 1;
    }
    const was = found.get(key);
    // (Controls of one kind in a list, such as the rows of the Problems list: the smallest counts.)
    if (!was || width * height < was.width * was.height) found.set(key, { key, name, width, height });
  }
  return [...found.values()];
}`;

/** The hit areas of the controls in a page or frame, inside `scope` (a selector) when given. */
export async function hitAreas(page: Page | Frame, scope?: string): Promise<HitArea[]> {
  return (await page.evaluate(`(${SCRIPT})(${JSON.stringify(scope ?? null)}, ${CAP})`)) as HitArea[];
}

/** The controls under the bar, as the messages of the test print them. */
export function under(areas: HitArea[], bar: number): string[] {
  return areas.filter((a) => a.width < bar || a.height < bar).map((a) => `${a.key} ${a.width}x${a.height} (${a.name})`);
}

/**
 * The allow-list of today's smaller controls: `{ "width language": { "where key": [width, height] } }`
 * (test/fixtures/hit-areas.json). A size is clamped to the bar: a dimension at or above the bar is written as the bar,
 * since only a dimension under the bar is gated (a wide control that gets narrower, still above the bar, is no step back).
 *
 * The rules the test cannot enforce, which are the reviewer's to hold:
 * - An entry is never added by hand for a new control: a new control meets the bar. The file is written by
 *   `UPDATE_HIT_AREAS=1` from the page as it is, and a PR that adds an entry says why in its description.
 * - A listed size is never lowered by hand: the list may only shrink by entries going away, or by a size
 *   getting closer to the bar.
 * - A key is the control's id; a control with no id is keyed by its tag, role and first two classes (`a.brand`,
 *   `button[button].twisty`), and the controls of one key are one entry, the smallest. So a new control with no id is
 *   caught only if it is smaller than the smallest of its group. Give a new control an id.
 *
 * What the measurement does: it starts from the first box of the control (a link that wraps has more than one) and
 * probes up to CAP px each way, so 121 (2 x CAP + 1) means "at least"; what is in a closed `<details>`, but its
 * summary, is not on the page; a control that is not visible is not measured (a popover is measured
 * open, on its own), nor is the phone sheet's grabber, which lets a press through to the header (pointer-events: none).
 */
export type Allowed = Record<string, Record<string, [number, number]>>;

const clamp = (n: number, bar: number): number => Math.min(n, bar);

/**
 * What the allow-list and the page disagree on, one message each. A control under the bar must be on the list. Only a
 * dimension under the bar is compared, and it must not be smaller than the list's by more than SLACK px (a smaller hit
 * area than the list's is a step back); an entry whose control now meets the bar, or is gone, is stale and must go
 * (the list may only shrink).
 */
export function compare(profile: string, measured: Record<string, HitArea>, allowed: Record<string, [number, number]>, bar: number): string[] {
  const out: string[] = [];
  for (const [where, a] of Object.entries(measured)) {
    const small = a.width < bar || a.height < bar;
    const listed = allowed[where];
    if (small && !listed) out.push(`${profile}: ${where} is ${a.width}x${a.height} (${a.name}), under ${bar}x${bar} and not on the allow-list`);
    else if (small && listed && (clamp(a.width, bar) < clamp(listed[0], bar) - SLACK || clamp(a.height, bar) < clamp(listed[1], bar) - SLACK)) {
      out.push(`${profile}: ${where} shrank from ${listed[0]}x${listed[1]} to ${a.width}x${a.height}`);
    } else if (!small && listed) out.push(`${profile}: ${where} is ${a.width}x${a.height} now: remove it from test/fixtures/hit-areas.json`);
  }
  for (const where of Object.keys(allowed)) if (!(where in measured)) out.push(`${profile}: ${where} is on the allow-list but not on the page: remove it`);
  return out;
}

/** What `UPDATE_HIT_AREAS=1` writes for a control: its size, each dimension at most the bar. */
export function listed(a: HitArea, bar: number): [number, number] {
  return [clamp(a.width, bar), clamp(a.height, bar)];
}
