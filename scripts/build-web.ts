// Builds the web page (GitHub Pages) into site/, or the directory given with --outdir=.
// Usage: npx tsx scripts/build-web.ts [--outdir=site]
import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';
import { PANEL_BODY } from '../src/ui/panelView';

const root = path.join(__dirname, '..');
const outdir = path.resolve(root, process.argv.find((a) => a.startsWith('--outdir='))?.slice('--outdir='.length) ?? 'site');
/** Where to write what went into the bundle, for scripts/notices.ts. */
const metafile = process.argv.find((a) => a.startsWith('--metafile='))?.slice('--metafile='.length);
const version: string = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;

/** The panel page shown in the frame: the extension's panel markup and script, as they are. */
const PANEL_HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self'; script-src 'self'; base-uri 'none'; form-action 'none';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="theme.css">
<link rel="stylesheet" href="panel.css">
<link rel="stylesheet" href="panel-page.css">
</head>
<body>
${PANEL_BODY}
<script src="panel-host.js"></script>
<script src="panel.js"></script>
</body>
</html>
`;

async function main(): Promise<void> {
  fs.rmSync(outdir, { recursive: true, force: true });
  fs.mkdirSync(outdir, { recursive: true });
  const result = await esbuild.build({
    entryPoints: [path.join(root, 'web/main.ts')],
    bundle: true,
    outfile: path.join(outdir, 'app.js'),
    platform: 'browser',
    format: 'iife',
    target: 'es2020',
    minify: true,
    // web-tree-sitter loads these only when it runs in Node.js.
    external: ['fs', 'path', 'url', 'module'],
    define: { __VERSION__: JSON.stringify(version) },
    logLevel: 'warning',
    metafile: true,
  });
  if (metafile) fs.writeFileSync(metafile, JSON.stringify(result.metafile));
  const copy = (from: string, to = path.basename(from)) => fs.copyFileSync(path.join(root, from), path.join(outdir, to));
  copy('web/index.html');
  copy('web/page.css');
  copy('web/theme.css');
  copy('web/panel-page.css');
  copy('web/panel-host.js');
  copy('media/panel.css');
  copy('media/panel.js');
  copy('media/icon.png');
  copy('node_modules/web-tree-sitter/web-tree-sitter.wasm');
  copy('node_modules/tree-sitter-bash/tree-sitter-bash.wasm');
  // The licenses of what the page includes, linked from its footer.
  copy('LICENSE', 'LICENSE.txt');
  copy('THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES.txt');
  fs.writeFileSync(path.join(outdir, 'panel.html'), PANEL_HTML);
  // GitHub Pages: serve the files as they are, without Jekyll.
  fs.writeFileSync(path.join(outdir, '.nojekyll'), '');
  console.log(`Built the web page ${version} into ${path.relative(root, outdir) || '.'}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
