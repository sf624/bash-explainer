// @ts-check
// In the web page, the explanation panel runs in a frame. VS Code gives a webview
// acquireVsCodeApi(); here the same calls go to the page around the frame, which answers
// with the same messages the extension sends.
(function () {
  // @ts-ignore panel.js calls this as it would in VS Code.
  window.acquireVsCodeApi = () => ({
    postMessage: (/** @type {unknown} */ message) => window.parent.postMessage(message, location.origin),
    getState: () => undefined,
    // The page keeps the state (web/storage.ts) and sends it back when the panel starts ('panelState').
    setState: (/** @type {unknown} */ state) => window.parent.postMessage({ type: 'panelState', state }, location.origin),
  });
  // The page around has these controls in its top bar and its menu, so the panel's header is not shown.
  // (The copies on the compare page, in panel mode, have no top bar: their panels keep it.)
  try {
    if (window.parent !== window && new URLSearchParams(window.parent.location.search).get('view') !== 'panel') {
      document.documentElement.classList.add('bx-web');
    }
  } catch {
    // Not the same origin: leave the header.
  }
})();
