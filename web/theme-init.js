// @ts-check
// Applies the chosen colour theme (Auto, Light or Dark) to the page, before it is painted, so that
// there is no flash of the wrong one. It runs in the page and in the explanation frame. The choice
// is kept in localStorage, which may be unavailable (private mode, blocked): then it is Auto.
// It also sets the layout's classes before the first paint (see the end).
(function () {
  const root = document.documentElement;
  const apply = (/** @type {unknown} */ theme) => {
    if (theme === 'light' || theme === 'dark') root.setAttribute('data-theme', theme);
    else root.removeAttribute('data-theme');
  };
  try {
    apply(localStorage.getItem('bash-explainer-theme'));
  } catch {
    apply(null);
  }
  // ?view=panel: the page shows its explanation panel only (page.css), to be filled by the page around it.
  /**
   * Whether the page shows a script from a link: one in its address, or, on a reload or a return through history,
   * the link this tab kept (web/share.ts `readHash`, web/storage.ts; the key is repeated here).
   */
  function sharedScript() {
    if (/[#&]z=/.test(location.hash)) return true;
    const nav = /** @type {PerformanceNavigationTiming | undefined} */ (performance.getEntriesByType('navigation')[0]);
    if (!nav || (nav.type !== 'reload' && nav.type !== 'back_forward')) return false;
    try {
      return /(^|&)z=/.test(sessionStorage.getItem('bash-explainer-shared-link') || '');
    } catch {
      return false;
    }
  }
  if (/[?&]view=panel(&|$)/.test(location.search)) root.classList.add('view-panel');
  // The opening (src/ui/opening.ts): the overlay of index.html covers the page from the first paint until the page is
  // ready, when web/opening.ts ends it. Only on the page whose script tag asks for it (index.html, not compare.html),
  // not in the panel view or in a frame, nor without JavaScript (this file does not run then, and the overlay stays
  // hidden), nor on a link to a script: the script is there from the start. It plays whole on the first load of a
  // browser session; on later loads and with reduced motion it is still: the finished picture, gone as soon as the
  // page is ready.
  else if (window.parent === window && document.currentScript && document.currentScript.hasAttribute('data-opening') && !sharedScript()) {
    let seen = false;
    try {
      seen = sessionStorage.getItem('bash-explainer-opening') === '1';
      sessionStorage.setItem('bash-explainer-opening', '1');
    } catch {
      // No storage: every load plays it whole.
    }
    const still = seen || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    root.classList.add('opening-on', still ? 'opening-still' : 'opening-whole');
    // Its labels in the page's language, as web/main.ts picks it: the link's, the setting's, then the browser's.
    let lang = (/[#&]lang=(ja|en)(&|$)/.exec(location.hash) || [])[1];
    if (!lang) {
      try {
        const saved = JSON.parse(localStorage.getItem('bash-explainer-settings') || '{}').language;
        if (saved === 'ja' || saved === 'en') lang = saved;
      } catch {
        // No storage, or not JSON: the browser's language.
      }
    }
    root.setAttribute('data-opening-lang', lang || (navigator.language.toLowerCase().startsWith('ja') ? 'ja' : 'en'));
    // The time of its first frame, from which its animations run.
    requestAnimationFrame((t) => root.setAttribute('data-opening-t0', String(t)));
    // A key, a click, a tap or the wheel before the page is ready: it leaves as soon as the page is ready. A key is
    // not taken from the page.
    const skip = () => root.classList.add('opening-skip');
    for (const type of ['keydown', 'pointerdown', 'wheel']) window.addEventListener(type, skip, { capture: true, once: true, passive: true });
    // The page failed to start, or is still not ready after 15 seconds: do not keep it covered.
    const gone = () => root.classList.add('opening-gone');
    window.addEventListener('error', gone, { once: true });
    setTimeout(gone, 15000);
  }
  // The frame follows the page at once, also when it cannot read the storage itself.
  if (window.parent !== window) {
    window.addEventListener('message', (event) => {
      if (event.source === window.parent && event.origin === location.origin && event.data && event.data.type === 'theme') apply(event.data.theme);
    });
  }

  // The layout. `narrow` (the phone layout of page.css) is set on a phone at every zoom, and elsewhere in
  // a window up to 767px wide. A zoom changes the width in CSS pixels (a zoom out to 50% makes a 390px
  // phone 780px wide), so a phone is told by its device, not by the width: a touch screen without hover
  // whose screen is less than 600px on its short side (`phone`), decided when the page loads. A browser may
  // report the screen in CSS pixels of the zoom too, so a phone, once seen, is remembered by the shape of
  // its screen, which no zoom changes: a page loaded zoomed out keeps the phone layout. Tablets and desktops
  // follow the width, as before, also when a window is resized. layout.ts reads the class and listens to
  // `narrowchange`.
  // But a phone whose browser asks for the desktop site (Chrome's "Desktop site", Safari's "Request Desktop
  // Website") is not treated as a phone: the user chose the desktop page, so the layout follows the width
  // as on a desktop (about 980px wide then), and the phone's screens are neither recorded nor used. The browser
  // tells: `navigator.userAgentData.mobile` is false in Chrome's desktop mode (and true in its normal mode);
  // without it (Safari, Firefox) the User-Agent names no phone ("Mobi", "iPhone", "iPod", "iPad" or "Android"):
  // Safari's desktop mode sends the Macintosh one. The browsers reload the page when the mode is switched,
  // and a page restored from the back/forward cache is decided again, so the mode is read at every load.
  const PHONE_KEY = 'bash-explainer-phone-screens';
  const touch = window.matchMedia('(pointer: coarse) and (hover: none)');
  const narrowWidth = window.matchMedia('(max-width: 767px)');
  /** The screen's long side over its short side, in hundredths: the same at every zoom and either way round. */
  const shape = () => Math.round((Math.max(screen.width, screen.height) / Math.min(screen.width, screen.height)) * 100);
  let seenShape = 0;
  let phone = false;
  /** The browser presents itself as a desktop browser: the desktop-site mode of a phone, or a desktop. */
  const desktopSite = () => {
    const data = /** @type {{ mobile?: unknown } | undefined} */ (/** @type {any} */ (navigator).userAgentData);
    if (data && typeof data.mobile === 'boolean') return !data.mobile;
    return !/Mobi|iPhone|iPod|iPad|Android/.test(navigator.userAgent);
  };
  const decide = () => {
    seenShape = shape();
    if (desktopSite()) {
      phone = false;
      return;
    }
    /** @type {unknown} */
    let seen = [];
    try {
      seen = JSON.parse(localStorage.getItem(PHONE_KEY) || '[]');
    } catch {
      seen = [];
    }
    const shapes = Array.isArray(seen) ? seen : [];
    phone = touch.matches && (Math.min(screen.width, screen.height) < 600 || shapes.includes(seenShape));
    if (phone && !shapes.includes(seenShape)) {
      try {
        localStorage.setItem(PHONE_KEY, JSON.stringify([...shapes, seenShape].slice(-4)));
      } catch {
        // Not kept: a page loaded zoomed out then follows the width.
      }
    }
  };
  const update = () => {
    // Another screen (a foldable opened, a mouse attached) is decided again; a zoom keeps the screen's shape.
    if (shape() !== seenShape) decide();
    root.classList.toggle('phone', phone);
    const was = root.classList.contains('narrow');
    const now = phone || narrowWidth.matches;
    root.classList.toggle('narrow', now);
    if (was !== now) root.dispatchEvent(new Event('narrowchange'));
  };
  decide();
  update();
  narrowWidth.addEventListener('change', update);
  touch.addEventListener('change', () => {
    decide();
    update();
  });
  window.addEventListener('resize', update);
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
      decide();
      update();
    }
  });
})();
