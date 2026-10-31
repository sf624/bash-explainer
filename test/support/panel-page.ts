// The VS Code panel's page outside VS Code, for the browser tests of its header (test/panel-header.test.ts) and for
// screenshots: PANEL_BODY, media/panel.css, media/icons.js and media/panel.js as src/ui/panel.ts serves them, under a content
// security policy as strict as the webview's (no inline script or style, no font, no image), with the theme
// variables of Dark Modern, Light Modern or Dark High Contrast (test/fixtures/vscode-themes.css). A stub plays
// VS Code's part: acquireVsCodeApi() keeps what the panel posts (window.POSTED), and 'ready' is answered with the
// view state and the update message of a sample line.
import * as fs from 'fs';
import * as http from 'http';
import type { AddressInfo } from 'net';
import * as path from 'path';
import { Analyzer } from '../../src/analyzer';
import { Lang } from '../../src/i18n';
import { createUnbashParser } from '../../src/syntax/adapters/unbash';
import { documentIssues } from '../../src/document';
import { lineMarks, PANEL_BODY, panelState, panelUpdate } from '../../src/ui/panelView';

const root = path.join(__dirname, '..', '..');
export const SAMPLE = 'find . -name "*.log" -mtime +7 | xargs rm -f 2>/dev/null';
export type PanelTheme = 'dark' | 'light' | 'hc';

/**
 * The update message for `text` (from the second line of the script `file`), as the extension sends it. `text` may
 * have several lines: its first is explained (a loop over several lines is explained whole from its first line).
 * `wrap`: the line box wraps, as with `editor.wordWrap` on (src/ui/lineBox.ts `wrapsLikeEditor`).
 */
function message(lang: Lang, text: string, file: string, wrap = false): unknown {
  const src = `#!/bin/bash\n${text}\n`;
  const line = text.split('\n')[0];
  const tree = createUnbashParser().parse(src);
  const ex = new Analyzer(lang).explainLine(tree, 1, 'bash', { reading: true });
  // (The line's problems, as the editor underlines them.)
  const doc = { lines: src.split('\n'), tree };
  const marks = lineMarks(documentIssues(doc, lang, { detected: 'bash' }), 1);
  return panelUpdate({ lang, explanation: ex, file, line: 1, lineText: line, doc, wrap, choice: {}, detected: 'bash', placement: 'first', animations: true, marks });
}

const HOST = `(function () {
  const q = new URLSearchParams(location.search);
  const theme = q.get('theme') || 'dark';
  document.documentElement.classList.add('t-' + theme);
  document.documentElement.lang = q.get('lang') || 'en';
  const kind = { dark: ['vscode-dark'], light: ['vscode-light'], hc: ['vscode-high-contrast'] }[theme];
  document.addEventListener('DOMContentLoaded', () => document.body.classList.add(...kind));
  window.POSTED = [];
  window.acquireVsCodeApi = () => ({
    postMessage: (m) => {
      window.POSTED.push(m);
      if (m.type === 'ready') setTimeout(() => {
        window.postMessage({ type: 'panelState', state: { ...window.STATE, view: q.get('view') || 'list' } }, '*');
        window.postMessage(window.MSGS[document.documentElement.lang], '*');
      });
    },
    getState: () => undefined,
    setState: () => {},
  });
})();
`;

const PAGE = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self'; script-src 'self';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="themes.css">
<link rel="stylesheet" href="media/panel.css">
<script src="host.js"></script>
<script src="msg.js"></script>
</head>
<body>
${PANEL_BODY}
<script src="media/icons.js"></script>
<script src="media/panel.js"></script>
</body>
</html>
`;

export interface PanelServer {
  /** The page's address for a theme, a language and a view. */
  url(theme?: PanelTheme, lang?: Lang, view?: 'list' | 'tree'): string;
  close(): Promise<void>;
}

/** Serves the panel's page on 127.0.0.1, explaining `line` of the script `file` (its line box wrapped with `wrap`). */
export async function servePanel(line = SAMPLE, file = 'cleanup.sh', wrap = false): Promise<PanelServer> {
  // (The state a host sends: kept from a version before the steps, the layers up to the scripts inside.)
  const msg = `window.MSGS = ${JSON.stringify({ en: message('en', line, file, wrap), ja: message('ja', line, file, wrap) })};\nwindow.STATE = ${JSON.stringify(panelState({ level: 2 }))};\n`;
  const server = http.createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://x');
    const send = (type: string, body: string | Buffer) => res.writeHead(200, { 'Content-Type': type }).end(body);
    switch (u.pathname) {
      case '/panel.html': return send('text/html', PAGE);
      case '/host.js': return send('text/javascript', HOST);
      case '/msg.js': return send('text/javascript', msg);
      case '/themes.css': return send('text/css', fs.readFileSync(path.join(root, 'test/fixtures/vscode-themes.css')));
      case '/media/panel.css': return send('text/css', fs.readFileSync(path.join(root, 'media/panel.css')));
      case '/media/icons.js': return send('text/javascript', fs.readFileSync(path.join(root, 'media/icons.js')));
      case '/media/panel.js': return send('text/javascript', fs.readFileSync(path.join(root, 'media/panel.js')));
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url: (theme = 'dark', lang = 'en', view = 'list') => `${base}/panel.html?theme=${theme}&lang=${lang}&view=${view}`,
    close: () => new Promise((r) => server.close(() => r())),
  };
}
