// Harness: plays VS Code's part for media/panel.js (theme classes, acquireVsCodeApi, the update message).
(function () {
  const q = new URLSearchParams(location.search);
  const theme = q.get('theme') || 'dark';
  const lang = q.get('lang') || 'en';
  const root = document.documentElement;
  root.classList.add(`t-${theme}`);
  root.lang = lang;
  if (q.get('hdr')) root.dataset.hdr = q.get('hdr');
  const kind = { dark: ['vscode-dark'], light: ['vscode-light'], hc: ['vscode-high-contrast'] }[theme];
  document.addEventListener('DOMContentLoaded', () => document.body.classList.add(...kind));
  // (body exists once this runs at the end of body, too)
  if (document.body) document.body.classList.add(...kind);
  window.HDR_POSTED = [];
  window.acquireVsCodeApi = () => ({
    postMessage: (m) => {
      window.HDR_POSTED.push(m);
      if (m.type === 'ready') {
        setTimeout(() => {
          window.postMessage({ type: 'panelState', state: { view: q.get('view') || 'list', level: 2 } }, '*');
          window.postMessage(window.HDR_MSG[lang], '*');
        });
      }
    },
    getState: () => undefined,
    setState: () => {},
  });
})();
