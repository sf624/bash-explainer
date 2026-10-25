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
  if (/[?&]view=panel(&|$)/.test(location.search)) root.classList.add('view-panel');
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
