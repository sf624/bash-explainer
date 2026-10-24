// PROTOTYPE harness (proto/panel-header): writes page/msg.js (an update message for a sample line) and
// page/harness.html (the panel page as panel.ts writes it). usage: npx tsx proto/panel-header/gen.ts
import * as path from 'path';
import * as fs from 'fs';
import { Analyzer } from '../../src/analyzer';
import { createUnbashParser } from '../../src/syntax/adapters/unbash';
import { panelUpdate } from '../../src/ui/panelView';

const src = '#!/bin/bash\nfind . -name "*.log" -mtime +7 | xargs rm -f 2>/dev/null\n';
const out: Record<string, unknown> = {};
for (const lang of ['en', 'ja'] as const) {
  const tree = createUnbashParser().parse(src);
  const ex = new Analyzer(lang).explainLine(tree, 1, 'bash', { reading: true });
  out[lang] = panelUpdate({ lang, explanation: ex, file: 'cleanup.sh', line: 1, lineText: src.split('\n')[1], choice: {}, detected: 'bash', placement: 'first' });
}
const msgFile = process.argv[2] ?? path.join(__dirname, 'page/msg.js');
fs.writeFileSync(msgFile, 'window.HDR_MSG = ' + JSON.stringify(out) + ';\n');

// The page, as panel.ts writes it (CSP of a webview: no inline styles or scripts, no images, no fonts).
import { PANEL_BODY } from '../../src/ui/panelView';
const media = path.join(__dirname, '../../media');
const extraCss = fs.existsSync(path.join(media, 'panel-header.css')) ? '<link rel="stylesheet" href="media/panel-header.css">\n' : '';
const extraJs = fs.existsSync(path.join(media, 'panel-header.js')) ? '<script src="media/panel-header.js"></script>\n' : '';
fs.writeFileSync(path.join(path.dirname(msgFile), 'harness.html'), `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self'; script-src 'self';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="themes.css">
<link rel="stylesheet" href="media/panel.css">
${extraCss}<script src="host.js"></script>
<script src="msg.js"></script>
</head>
<body>
${PANEL_BODY}
${extraJs}<script src="media/panel.js"></script>
</body>
</html>
`);
