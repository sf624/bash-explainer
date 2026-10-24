// @ts-check
// In the web page, the explanation panel runs in a frame. VS Code gives a webview
// acquireVsCodeApi(); here the same calls go to the page around the frame, which answers
// with the same messages the extension sends.
(function () {
  // @ts-ignore panel.js calls this as it would in VS Code.
  window.acquireVsCodeApi = () => ({
    postMessage: (/** @type {unknown} */ message) => window.parent.postMessage(message, location.origin),
    getState: () => undefined,
    // The panel posts its state itself ('panelState'); the page keeps it (web/storage.ts) and sends it back when the panel starts.
    setState: () => {},
  });
  // The page around has these controls in its top bar and its menu, so the panel's header is not shown.
  // (The copies on the compare page, in panel mode, have no top bar: their panels keep it.)
  try {
    if (window.parent !== window && new URLSearchParams(window.parent.location.search).get('view') !== 'panel') {
      document.documentElement.classList.add('bx-web');
    }
    // PROTOTYPE (proto/list-look-b): ?listStyle=b shows the list in the tree view's rows (media/panel.js).
    const style = window.parent !== window ? new URLSearchParams(window.parent.location.search).get('listStyle') : null;
    if (style === 'b') document.documentElement.dataset.listStyle = style;
  } catch {
    // Not the same origin: leave the header.
  }
})();
