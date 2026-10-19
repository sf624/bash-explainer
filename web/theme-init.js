// @ts-check
// Applies the chosen colour theme (Auto, Light or Dark) to the page, before it is painted, so that
// there is no flash of the wrong one. It runs in the page and in the explanation frame. The choice
// is kept in localStorage, which may be unavailable (private mode, blocked): then it is Auto.
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
  // The frame follows the page at once, also when it cannot read the storage itself.
  if (window.parent !== window) {
    window.addEventListener('message', (event) => {
      if (event.source === window.parent && event.origin === location.origin && event.data && event.data.type === 'theme') apply(event.data.theme);
    });
  }
})();
