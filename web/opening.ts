// The end of the opening (src/ui/opening.ts; web/theme-init.js starts it, page.css draws it): when the page is ready,
// the parts of the line get their labels, which stay a moment, and the overlay fades into the page.

/** The labels stay this long after they have come in, when the page was ready early. */
const HOLD = 380;
/** The labels come in over this time (page.css: 200 ms, 45 ms apart for seven parts at most). */
const LABELS = 420;

/** A time of page.css, such as `1130ms`, in milliseconds. */
function time(el: Element, name: string): number {
  return parseFloat(getComputedStyle(el).getPropertyValue(name)) || 0;
}

/**
 * Puts each label below or above its part, the first place where it does not overlap the label before it there.
 * If one fits in neither, the labels are shown as the list under the line instead, as on a narrow screen.
 */
function placeLabels(el: HTMLElement): void {
  const ends = [-Infinity, -Infinity];
  for (const chip of el.querySelectorAll<HTMLElement>('.opening-line .chip')) {
    // A narrow screen shows the list already (page.css).
    if (getComputedStyle(chip).display === 'none') return;
    const r = chip.getBoundingClientRect();
    const tier = ends.findIndex((end) => r.left >= end + 8);
    if (tier < 0) {
      el.classList.add('opening-as-list');
      return;
    }
    ends[tier] = r.right;
    chip.classList.toggle('above', tier === 1);
  }
}

/** Called when the page is ready (web/main.ts). */
export function openingReady(): void {
  const root = document.documentElement;
  const el = document.getElementById('opening');
  if (!el || !root.classList.contains('opening-on')) return;
  const whole = root.classList.contains('opening-whole');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let leaving = false;
  const leave = (fast: boolean) => {
    if (leaving) return;
    leaving = true;
    const done = () => {
      el.remove();
      root.classList.remove('opening-on', 'opening-whole', 'opening-still', 'opening-skip');
    };
    // Reduced motion: the page is shown at once.
    if (reduced) return done();
    el.classList.add('out');
    el.classList.toggle('fast', fast);
    el.addEventListener('transitionend', (e) => e.target === el && done());
    setTimeout(done, fast ? 250 : 400);
  };
  // Skipped before the page was ready.
  if (root.classList.contains('opening-skip')) return leave(true);
  for (const type of ['keydown', 'pointerdown', 'wheel']) window.addEventListener(type, () => leave(true), { capture: true, once: true, passive: true });
  // Still: the finished line, which leaves now.
  if (!whole) return leave(false);
  placeLabels(el);
  // The line is read (its last colour has come in) this long after the overlay's first frame.
  const read = time(el, '--opening-read');
  const since = performance.now() - Number(root.getAttribute('data-opening-t0') ?? 0);
  // A slow start has made the reader wait already: the labels come in, and the overlay leaves without a pause.
  const late = since > read + 200;
  setTimeout(() => {
    el.classList.add('ready');
    setTimeout(() => leave(false), late ? LABELS : LABELS + HOLD);
  }, Math.max(0, read - since));
}
