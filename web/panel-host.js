// @ts-check
// In the web page, the explanation panel runs in a frame. VS Code gives a webview
// acquireVsCodeApi(); here the same calls go to the page around the frame, which answers
// with the same messages the extension sends.
(function () {
  // @ts-ignore panel.js calls this as it would in VS Code.
  window.acquireVsCodeApi = () => ({
    postMessage: (/** @type {unknown} */ message) => window.parent.postMessage(message, location.origin),
    getState: () => undefined,
    setState: () => undefined,
  });
})();
