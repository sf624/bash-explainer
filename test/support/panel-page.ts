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
import { PANEL_BODY, panelUpdate } from '../../src/ui/panelView';

const root = path.join(__dirname, '..', '..');
export const SAMPLE = 'find . -name "*.log" -mtime +7 | xargs rm -f 2>/dev/null';
export type PanelTheme = 'dark' | 'light' | 'hc';

/** The update message for `line` (the second line of the script `file`), as the extension sends it. */
function message(lang: Lang, line: string, file: string): unknown {
  const src = `#!/bin/bash\n${line}\n`;
  const ex = new Analyzer(lang).explainLine(createUnbashParser().parse(src), 1, 'bash', { reading: true });
  return panelUpdate({ lang, explanation: ex, file, line: 1, lineText: line, choice: {}, detected: 'bash', placement: 'first', animations: true });
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
        window.postMessage({ type: 'panelState', state: { view: q.get('view') || 'list', level: 2 } }, '*');
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

/** Serves the panel's page on 127.0.0.1, explaining `line` of the script `file`. */
export async function servePanel(line = SAMPLE, file = 'cleanup.sh'): Promise<PanelServer> {
  const msg = `window.MSGS = ${JSON.stringify({ en: message('en', line, file), ja: message('ja', line, file) })};\n`;
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
