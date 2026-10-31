// Builds the web page (GitHub Pages) into site/, or the directory given with --outdir=.
// Usage: npx tsx scripts/build-web.ts [--outdir=site] [--channel=release|next|pr] [--pr=N]
// The channel is `release` (the page of a released version, the default), `next` (the development
// version built from main) or `pr` (the preview of open pull request N, built from its head). A banner
// says so on the last two, and they ask search engines not to index them.
// The channel can also be set with BASH_EXPLAINER_CHANNEL and the number with BASH_EXPLAINER_PR; the flags win.
import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { settingTexts } from '../src/settings';
import { PANEL_BODY } from '../src/ui/panelView';
import { Analyzer } from '../src/analyzer';
import { OPENING_LINE, openingHtml, openingParts } from '../src/ui/opening';
import { createUnbashParser } from '../src/syntax/adapters/unbash';

const root = path.join(__dirname, '..');
const outdir = path.resolve(root, process.argv.find((a) => a.startsWith('--outdir='))?.slice('--outdir='.length) ?? 'site');
/** Where to write what went into the bundle, for scripts/notices.ts. */
const metafile = process.argv.find((a) => a.startsWith('--metafile='))?.slice('--metafile='.length);
const channel = process.argv.find((a) => a.startsWith('--channel='))?.slice('--channel='.length) ?? process.env.BASH_EXPLAINER_CHANNEL ?? 'release';
if (channel !== 'release' && channel !== 'next' && channel !== 'pr') throw new Error(`Unknown channel "${channel}": use release, next or pr`);
/** The pull request number of a preview. */
const pr = process.argv.find((a) => a.startsWith('--pr='))?.slice('--pr='.length) ?? process.env.BASH_EXPLAINER_PR ?? '';
if (channel === 'pr' ? !/^[1-9][0-9]{0,8}$/.test(pr) : pr !== '') throw new Error(`The pull request number (--pr=N) goes with the pr channel only, and is a number: "${pr}"`);
/** The commit the page is built from, for the banner of the development version and the previews. */
function commit(): string {
  try {
    return execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return 'unknown';
  }
}
const json = (file: string) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const pkg = json('package.json');
const version: string = pkg.version;
/** The descriptions of the settings, for the settings dialog: those VS Code shows. */
const settingText = {
  en: settingTexts(pkg.contributes.configuration, json('package.nls.json')),
  ja: settingTexts(pkg.contributes.configuration, json('package.nls.ja.json')),
};

/** The panel page shown in the frame: the extension's panel markup and script, as they are. */
const PANEL_HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self'; script-src 'self'; img-src data:; base-uri 'none'; form-action 'none';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<script src="theme-init.js"></script>
<link rel="stylesheet" href="theme.css">
<link rel="stylesheet" href="panel.css">
<link rel="stylesheet" href="panel-page.css">
</head>
<body>
${PANEL_BODY}
<script src="panel-host.js"></script>
<script src="icons.js"></script>
<script src="view-control.js"></script>
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
      __PR__: JSON.stringify(pr),
      __COMMIT__: JSON.stringify(channel === 'release' ? '' : commit()),
      __SETTING_TEXT__: JSON.stringify(settingText),
      // The web page's shell sample is test/fixtures/sample.sh, the tour of every feature (web/samples.ts).
      __SAMPLE_SH__: JSON.stringify(fs.readFileSync(path.join(root, 'test/fixtures/sample.sh'), 'utf8')),
    },
    logLevel: 'warning',
    metafile: true,
  });
  if (metafile) fs.writeFileSync(metafile, JSON.stringify(result.metafile));
  const copy = (from: string, to = path.basename(from)) => fs.copyFileSync(path.join(root, from), path.join(outdir, to));
  // The development version and the previews ask search engines to leave them out, so that the released page is the one they find.
  const page = fs.readFileSync(path.join(root, 'web/index.html'), 'utf8');
  // The opening (src/ui/opening.ts): its line explained now, in both languages, and the logo of the page's header.
  // Its prompt's cursor is a path of its own, which blinks.
  const header = /<svg class="logo"[\s\S]*?<\/svg>/.exec(page)![0];
  const logo = header.replace('class="logo"', 'class="opening-logo"').replace(/(<path class="logo-ink" d="[^"]*?)(M17\.4 16\.65H22\.6)("[^>]*\/>)/, '$1$3<path class="logo-ink opening-cursor" d="$2$3');
  if (!logo.includes('opening-cursor')) throw new Error('The opening could not find the cursor of the logo in web/index.html');
  const opening = openingHtml(openingParts(OPENING_LINE, createUnbashParser().parse(OPENING_LINE), { en: new Analyzer('en'), ja: new Analyzer('ja') }), logo);
  const index = page.replace('<!--robots-->', channel !== 'release' ? '<meta name="robots" content="noindex">' : '')
    .replace('<!--opening-->', opening)
    // Only the development version and the previews have the version switch in the menu; the release page leaves it out of the markup.
    .replace(/<!--switch-->(.*?)<!--\/switch-->/s, channel === 'release' ? '' : '$1');
  fs.writeFileSync(path.join(outdir, 'index.html'), index);
  // The compare page: the editor and two copies of the page in panel mode (`?view=panel`).
  fs.writeFileSync(path.join(outdir, 'compare.html'), fs.readFileSync(path.join(root, 'web/compare.html'), 'utf8').replace('<!--robots-->', '<meta name="robots" content="noindex">'));
  copy('web/page.css');
  copy('web/theme.css');
  copy('web/panel-page.css');
  copy('web/panel-host.js');
  copy('web/theme-init.js');
  copy('media/panel.css');
  copy('media/icons.js');
  copy('media/view-control.js');
  copy('media/panel.js');
  // The tab icon: the mark drawn on the 16 px grid below 24 px, in the colours of the system's theme;
  // favicon.ico (16 and 32 px, mid-grey ink for light and dark tabs) for the browsers that take no SVG icon.
  copy('web/favicon.svg');
  copy('web/favicon.ico');
  // The licenses of what the page includes, linked from its footer.
  copy('LICENSE', 'LICENSE.txt');
  copy('THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES.txt');
  fs.writeFileSync(path.join(outdir, 'panel.html'), PANEL_HTML);
  // GitHub Pages: serve the files as they are, without Jekyll.
  fs.writeFileSync(path.join(outdir, '.nojekyll'), '');
  console.log(`Built the web page ${version} (${channel === 'pr' ? `pr #${pr}` : channel}) into ${path.relative(root, outdir) || '.'}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
