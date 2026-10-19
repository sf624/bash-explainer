// Bash Explainer is offline by design: no network access, no AI, no telemetry and no external
// processes; its web page runs in the browser alone. These checks keep it that way; the Privacy
// section of README.md links here.
import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const root = path.join(__dirname, '..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

/** The ways JavaScript reaches the network outside Node.js modules. */
const NETWORK_APIS = /\bfetch\s*\(|\b(XMLHttpRequest|WebSocket|EventSource|RTCPeerConnection|sendBeacon|importScripts)\b/;

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => {
    const file = path.join(dir, e.name);
    // Build output (cli/dist) is checked as a bundle, below.
    return e.isDirectory() ? (e.name === 'dist' ? [] : sourceFiles(file)) : /\.[cm]?[jt]s$/.test(e.name) ? [file] : [];
  });
}

/** The packages of node_modules that an esbuild metafile lists among a bundle's inputs. */
function packagesOf(meta: { inputs: Record<string, unknown> }): string[] {
  const names = Object.keys(meta.inputs).map((p) => p.replace(/\\/g, '/').match(/node_modules\/((?:@[^/]+\/)?[^/]+)\//)?.[1]);
  return [...new Set(names.filter((n): n is string => !!n))].sort();
}

describe('offline by design', () => {
  it('the source imports only vscode and unbash', () => {
    const modules = new Set<string>();
    for (const file of sourceFiles('src')) {
      for (const m of read(file).matchAll(/\bfrom\s+'([^']+)'|\b(?:require|import)\s*\(\s*'([^']+)'\s*\)/g)) {
        const name = m[1] ?? m[2];
        if (!name.startsWith('.')) modules.add(name);
      }
    }
    // unbash is imported by src/syntax/adapters/unbash.ts only (test/syntax-boundary.test.ts).
    assert.deepStrictEqual([...modules].sort(), ['unbash', 'vscode']);
  });

  it('the web page imports only the editor, the parser and the source', () => {
    const modules = new Set<string>();
    for (const file of sourceFiles('web')) {
      for (const m of read(file).matchAll(/\bfrom\s+'([^']+)'|\b(?:require|import)\s*\(\s*'([^']+)'\s*\)/g)) {
        const name = m[1] ?? m[2];
        if (!name.startsWith('.')) modules.add(name.replace(/^(@codemirror\/[^/]+).*/, '$1'));
      }
    }
    for (const name of modules) assert.match(name, /^(@codemirror\/(commands|language|legacy-modes|lint|state|view)|@lezer\/highlight)$/, name);
  });

  it('the source, the panel script, the web page and the command-line tool use no browser network APIs', () => {
    for (const file of [...sourceFiles('src'), ...sourceFiles('media'), ...sourceFiles('web'), ...sourceFiles('cli')]) {
      const hit = read(file).match(NETWORK_APIS);
      assert.ok(!hit, `${file}: ${hit?.[0]}`);
    }
  });

  it('the shipped bundles (desktop and web) require only vscode, all by name, and include no parser but unbash and no wasm', function () {
    this.timeout(60000);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bash-explainer-'));
    try {
      const out = path.join(dir, 'extension.js');
      // The same build as `npm run package`.
      const metafile = path.join(dir, 'meta.json');
      execFileSync(process.execPath, ['esbuild.mjs', '--production', `--outfile=${out}`, `--metafile=${metafile}`], { cwd: root, stdio: 'pipe' });
      // The only package from node_modules in either bundle is unbash (no web-tree-sitter, no grammar).
      const meta = JSON.parse(fs.readFileSync(metafile, 'utf8'));
      for (const target of ['node', 'web']) assert.deepStrictEqual(packagesOf(meta[target]), ['unbash'], target);
      assert.deepStrictEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.wasm')), []);
      for (const file of [out, path.join(dir, 'web', 'extension.js')]) {
        const bundle = fs.readFileSync(file, 'utf8');
        const required = new Set([...bundle.matchAll(/\brequire\s*\(\s*"([^"]+)"\s*\)/g)].map((m) => m[1]));
        assert.ok(required.has('vscode'), file);
        assert.deepStrictEqual([...required], ['vscode'], file);
        // Nothing is compiled or fetched at run time.
        assert.doesNotMatch(bundle, /WebAssembly|\.wasm/, file);
        // A name built at run time could load anything.
        assert.doesNotMatch(bundle, /\brequire\s*\(\s*[^"\s]/, file);
        assert.doesNotMatch(bundle, /telemetry/i, file);
        // unbash is in the bundle now, so the network APIs are checked in it as well: it has none.
        assert.doesNotMatch(bundle, NETWORK_APIS, file);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('the command-line tool imports only fs, and its bundle requires nothing else', function () {
    this.timeout(60000);
    const modules = new Set<string>();
    for (const file of sourceFiles('cli')) {
      for (const m of read(file).matchAll(/\bfrom\s+'([^']+)'|\b(?:require|import)\s*\(\s*'([^']+)'\s*\)/g)) {
        const name = m[1] ?? m[2];
        if (!name.startsWith('.')) modules.add(name);
      }
    }
    assert.deepStrictEqual([...modules].sort(), ['fs']);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bash-explainer-cli-'));
    try {
      const metafile = path.join(dir, 'meta.json');
      execFileSync(process.execPath, ['--import', 'tsx', 'scripts/build-cli.ts', `--outdir=${dir}`, `--metafile=${metafile}`], { cwd: root, stdio: 'pipe' });
      assert.deepStrictEqual(packagesOf(JSON.parse(fs.readFileSync(metafile, 'utf8'))), ['unbash']);
      assert.deepStrictEqual(fs.readdirSync(path.join(dir, 'dist')), ['cli.js']);
      const bundle = fs.readFileSync(path.join(dir, 'dist', 'cli.js'), 'utf8');
      const required = new Set([...bundle.matchAll(/\brequire\s*\(\s*"([^"]+)"\s*\)/g)].map((m) => m[1]));
      assert.deepStrictEqual([...required].sort(), ['fs']);
      assert.doesNotMatch(bundle, /\brequire\s*\(\s*[^"\s]/);
      assert.doesNotMatch(bundle, /telemetry|WebAssembly/i);
      assert.doesNotMatch(bundle, NETWORK_APIS);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('the panel cannot load or send anything outside the extension', () => {
    const csp = read('src/ui/panel.ts').match(/http-equiv="Content-Security-Policy" content="([^"]*)"/)?.[1];
    assert.ok(csp, 'the panel has no Content Security Policy');
    const directives = csp.split(';').map((d) => d.trim()).filter(Boolean);
    assert.strictEqual(directives[0], "default-src 'none'");
    assert.deepStrictEqual(directives.slice(1).map((d) => d.split(/\s+/)[0]).sort(), ['script-src', 'style-src']);
    assert.doesNotMatch(csp, /https?:|\*/);
  });

  it('the web page loads only its own files and can send nothing to other sites', function () {
    this.timeout(60000);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bash-explainer-site-'));
    try {
      const metafile = path.join(dir, 'meta.json');
      execFileSync(process.execPath, ['--import', 'tsx', 'scripts/build-web.ts', `--outdir=${dir}`, `--metafile=${metafile}`], { cwd: root, stdio: 'pipe' });
      // The page is its files and nothing else: no wasm, no other bundle.
      assert.deepStrictEqual(fs.readdirSync(dir).filter((f) => /\.(wasm|m?js)$/.test(f)).sort(), ['app.js', 'panel-host.js', 'panel.js']);
      for (const page of ['index.html', 'panel.html']) {
        const html = fs.readFileSync(path.join(dir, page), 'utf8');
        const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]*)"/)?.[1];
        assert.ok(csp, `${page} has no Content Security Policy`);
        const directives = new Map(csp.split(';').map((d) => d.trim()).filter(Boolean).map((d) => [d.split(/\s+/)[0], d.split(/\s+/).slice(1)]));
        // Nothing from other sites, and no requests but to the page's own files.
        for (const [name, sources] of directives) {
          for (const src of sources) assert.match(src, /^('(self|none|unsafe-inline)'|data:)$/, `${page}: ${name} ${src}`);
        }
        assert.ok(['default-src', 'connect-src'].every((d) => !directives.get(d) || directives.get(d)!.every((s) => s === "'self'" || s === "'none'")));
        // The page fetches nothing, so it may not even ask its own server.
        if (page === 'index.html') assert.deepStrictEqual(directives.get('connect-src'), ["'none'"]);
        assert.ok(directives.has('default-src'), `${page}: no default-src`);
        // Scripts, styles and images come from the page's own files (links to other sites may be followed by the reader).
        for (const m of html.matchAll(/<(?:script|link|img|iframe)\b[^>]*\b(?:src|href)="([^"]*)"/g)) assert.doesNotMatch(m[1], /:/, `${page}: ${m[0]}`);
      }
      const app = fs.readFileSync(path.join(dir, 'app.js'), 'utf8');
      // The page requires no Node.js module (esbuild would have bundled or failed on it), and has no wasm.
      const builtins = /\b[\w$]+\(\s*"((?:node:)?(?:fs|path|url|module|http|https|http2|net|tls|dgram|dns|child_process|worker_threads|cluster))"\s*\)/g;
      assert.deepStrictEqual([...new Set([...app.matchAll(builtins)].map((m) => m[1]))], [], 'the page requires a Node.js module');
      assert.doesNotMatch(app, /telemetry|sendBeacon|WebSocket|EventSource|WebAssembly/i);
      assert.doesNotMatch(app, NETWORK_APIS);
      assert.doesNotMatch(app, /\bfetch\s*\(|XMLHttpRequest/);
      assert.ok(!packagesOf(JSON.parse(fs.readFileSync(metafile, 'utf8'))).some((n) => n.includes('tree-sitter')), 'the page includes tree-sitter');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('builds the development channel with a banner, noindex and the same CSP', function () {
    this.timeout(60000);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bash-explainer-next-'));
    try {
      const build = (outdir: string, args: string[]) => execFileSync(process.execPath, ['--import', 'tsx', 'scripts/build-web.ts', `--outdir=${outdir}`, ...args], { cwd: root, stdio: 'pipe' });
      build(path.join(dir, 'next'), ['--channel=next']);
      build(path.join(dir, 'release'), []);
      const html = (c: string) => fs.readFileSync(path.join(dir, c, 'index.html'), 'utf8');
      const csp = (c: string) => html(c).match(/http-equiv="Content-Security-Policy" content="([^"]*)"/)?.[1];
      assert.match(html('next'), /<meta name="robots" content="noindex">/);
      assert.doesNotMatch(html('release'), /noindex/);
      assert.ok(csp('next'));
      assert.strictEqual(csp('next'), csp('release'));
      // The banner and its links are relative or to GitHub (links, not requests: connect-src stays 'none').
      assert.match(html('next'), /id="channel-banner"[^>]*hidden/);
      assert.match(html('next'), /id="banner-release" href="\.\.\/"/);
      assert.match(html('next'), /id="dev-link"[^>]*href="next\/"/);
      const next = fs.readFileSync(path.join(dir, 'next', 'app.js'), 'utf8');
      const release = fs.readFileSync(path.join(dir, 'release', 'app.js'), 'utf8');
      assert.match(next, /"next"/);
      assert.match(next, /Development version, unreleased: built from main at/);
      assert.match(next, /[0-9a-f]{7}|unknown/);
      assert.doesNotMatch(release, /[^\w]"next"\s*===/);
      assert.throws(() => build(path.join(dir, 'x'), ['--channel=other']));
      // Both channels run only from their own files.
      for (const c of ['next', 'release']) assert.deepStrictEqual(fs.readdirSync(path.join(dir, c)).filter((f) => /\.(wasm|m?js)$/.test(f)).sort(), ['app.js', 'panel-host.js', 'panel.js']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('depends at run time on unbash only', () => {
    const pkg = JSON.parse(read('package.json'));
    assert.deepStrictEqual(Object.keys(pkg.dependencies).sort(), ['unbash']);
  });

  it('parses and explains scripts with the network and processes blocked', function () {
    this.timeout(60000);
    const out = execFileSync(process.execPath, ['--import', 'tsx', path.join(__dirname, 'offline-probe.ts')], { cwd: root, encoding: 'utf8' });
    assert.ok(Number(out) > 100, out);
  });
});
