// Builds the web page (GitHub Pages) into site/, or the directory given with --outdir=.
// Usage: npx tsx scripts/build-web.ts [--outdir=site] [--channel=release|next]
// The channel is `release` (the page of a released version, the default) or `next` (the development
// version built from main: a banner says so and the page asks search engines not to index it).
// It can also be set with BASH_EXPLAINER_CHANNEL; the flag wins.
import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { PANEL_BODY } from '../src/ui/panelView';

const root = path.join(__dirname, '..');
const outdir = path.resolve(root, process.argv.find((a) => a.startsWith('--outdir='))?.slice('--outdir='.length) ?? 'site');
/** Where to write what went into the bundle, for scripts/notices.ts. */
const metafile = process.argv.find((a) => a.startsWith('--metafile='))?.slice('--metafile='.length);
const channel = process.argv.find((a) => a.startsWith('--channel='))?.slice('--channel='.length) ?? process.env.BASH_EXPLAINER_CHANNEL ?? 'release';
if (channel !== 'release' && channel !== 'next') throw new Error(`Unknown channel "${channel}": use release or next`);
/** The commit the page is built from, for the banner of the development version. */
function commit(): string {
  try {
    return execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return 'unknown';
  }
}
const version: string = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;

/** The panel page shown in the frame: the extension's panel markup and script, as they are. */
const PANEL_HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self'; script-src 'self'; base-uri 'none'; form-action 'none';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<script src="theme-init.js"></script>
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
    define: {
      __VERSION__: JSON.stringify(version),
      __CHANNEL__: JSON.stringify(channel),
      __COMMIT__: JSON.stringify(channel === 'next' ? commit() : ''),
      // The web page's shell sample is test/fixtures/sample.sh, the tour of every feature (web/samples.ts).
      __SAMPLE_SH__: JSON.stringify(fs.readFileSync(path.join(root, 'test/fixtures/sample.sh'), 'utf8')),
    },
    logLevel: 'warning',
    metafile: true,
  });
  if (metafile) fs.writeFileSync(metafile, JSON.stringify(result.metafile));
  const copy = (from: string, to = path.basename(from)) => fs.copyFileSync(path.join(root, from), path.join(outdir, to));
  // The development version asks search engines to leave it out, so that the released page is the one they find.
  const index = fs.readFileSync(path.join(root, 'web/index.html'), 'utf8').replace('<!--robots-->', channel === 'next' ? '<meta name="robots" content="noindex">' : '');
  fs.writeFileSync(path.join(outdir, 'index.html'), index);
  copy('web/page.css');
  copy('web/theme.css');
  copy('web/panel-page.css');
  copy('web/panel-host.js');
  copy('web/theme-init.js');
  copy('media/panel.css');
  copy('media/panel.js');
  copy('media/icon.png');
  // The licenses of what the page includes, linked from its footer.
  copy('LICENSE', 'LICENSE.txt');
  copy('THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES.txt');
  fs.writeFileSync(path.join(outdir, 'panel.html'), PANEL_HTML);
  // GitHub Pages: serve the files as they are, without Jekyll.
  fs.writeFileSync(path.join(outdir, '.nojekyll'), '');
  console.log(`Built the web page ${version} (${channel}) into ${path.relative(root, outdir) || '.'}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
