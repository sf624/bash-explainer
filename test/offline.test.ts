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

describe('offline by design', () => {
  it('the source imports only vscode and web-tree-sitter', () => {
    const modules = new Set<string>();
    for (const file of sourceFiles('src')) {
      for (const m of read(file).matchAll(/\bfrom\s+'([^']+)'|\b(?:require|import)\s*\(\s*'([^']+)'\s*\)/g)) {
        const name = m[1] ?? m[2];
        if (!name.startsWith('.')) modules.add(name);
      }
    }
    assert.deepStrictEqual([...modules].sort(), ['vscode', 'web-tree-sitter']);
  });

  it('the web page imports only the editor, the parser and the source', () => {
    const modules = new Set<string>();
    for (const file of sourceFiles('web')) {
      for (const m of read(file).matchAll(/\bfrom\s+'([^']+)'|\b(?:require|import)\s*\(\s*'([^']+)'\s*\)/g)) {
        const name = m[1] ?? m[2];
        if (!name.startsWith('.')) modules.add(name.replace(/^(@codemirror\/[^/]+).*/, '$1'));
      }
    }
    for (const name of modules) assert.match(name, /^(@codemirror\/(commands|language|legacy-modes|lint|state|view)|@lezer\/highlight|web-tree-sitter)$/, name);
  });

  it('the source, the panel script, the web page and the command-line tool use no browser network APIs', () => {
    for (const file of [...sourceFiles('src'), ...sourceFiles('media'), ...sourceFiles('web'), ...sourceFiles('cli')]) {
      const hit = read(file).match(NETWORK_APIS);
      assert.ok(!hit, `${file}: ${hit?.[0]}`);
    }
  });

  it('the shipped bundles (desktop and web) require only vscode, fs and path, all by name', function () {
    this.timeout(60000);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bash-explainer-'));
    try {
      const out = path.join(dir, 'extension.js');
      // The same build as `npm run package`.
      execFileSync(process.execPath, ['esbuild.mjs', '--production', `--outfile=${out}`], { cwd: root, stdio: 'pipe' });
      // fs and path: web-tree-sitter's code for Node.js, which reads the wasm files only when given paths.
      for (const file of [out, path.join(dir, 'web', 'extension.js')]) {
        const bundle = fs.readFileSync(file, 'utf8');
        const required = new Set([...bundle.matchAll(/\brequire\s*\(\s*"([^"]+)"\s*\)/g)].map((m) => m[1]));
        assert.deepStrictEqual([...required].sort(), ['fs', 'path', 'vscode'], file);
        // A name built at run time could load anything.
        assert.doesNotMatch(bundle, /\brequire\s*\(\s*[^"\s]/, file);
        assert.doesNotMatch(bundle, /telemetry/i, file);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('the command-line tool imports only fs and path, and its bundle requires nothing else', function () {
    this.timeout(60000);
    const modules = new Set<string>();
    for (const file of sourceFiles('cli')) {
      for (const m of read(file).matchAll(/\bfrom\s+'([^']+)'|\b(?:require|import)\s*\(\s*'([^']+)'\s*\)/g)) {
        const name = m[1] ?? m[2];
        if (!name.startsWith('.')) modules.add(name);
      }
    }
    assert.deepStrictEqual([...modules].sort(), ['fs', 'path']);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bash-explainer-cli-'));
    try {
      execFileSync(process.execPath, ['--import', 'tsx', 'scripts/build-cli.ts', `--outdir=${dir}`], { cwd: root, stdio: 'pipe' });
      const bundle = fs.readFileSync(path.join(dir, 'dist', 'cli.js'), 'utf8');
      const required = new Set([...bundle.matchAll(/\brequire\s*\(\s*"([^"]+)"\s*\)/g)].map((m) => m[1]));
      assert.deepStrictEqual([...required].sort(), ['fs', 'path']);
      assert.doesNotMatch(bundle, /\brequire\s*\(\s*[^"\s]/);
      assert.doesNotMatch(bundle, /telemetry/i);
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
      execFileSync(process.execPath, ['--import', 'tsx', 'scripts/build-web.ts', `--outdir=${dir}`], { cwd: root, stdio: 'pipe' });
      for (const page of ['index.html', 'panel.html']) {
        const html = fs.readFileSync(path.join(dir, page), 'utf8');
        const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]*)"/)?.[1];
        assert.ok(csp, `${page} has no Content Security Policy`);
        const directives = new Map(csp.split(';').map((d) => d.trim()).filter(Boolean).map((d) => [d.split(/\s+/)[0], d.split(/\s+/).slice(1)]));
        // Nothing from other sites, and no requests but to the page's own files.
        for (const [name, sources] of directives) {
          for (const src of sources) assert.match(src, /^('(self|none|wasm-unsafe-eval|unsafe-inline)'|data:)$/, `${page}: ${name} ${src}`);
        }
        assert.ok(['default-src', 'connect-src'].every((d) => !directives.get(d) || directives.get(d)!.every((s) => s === "'self'" || s === "'none'")));
        assert.ok(directives.has('default-src'), `${page}: no default-src`);
        // Scripts, styles and images come from the page's own files (links to other sites may be followed by the reader).
        for (const m of html.matchAll(/<(?:script|link|img|iframe)\b[^>]*\b(?:src|href)="([^"]*)"/g)) assert.doesNotMatch(m[1], /:/, `${page}: ${m[0]}`);
      }
      const app = fs.readFileSync(path.join(dir, 'app.js'), 'utf8');
      // Node.js modules appear only in web-tree-sitter's code for Node.js, never run in a browser.
      const builtins = /\b[\w$]+\(\s*"((?:node:)?(?:fs|path|http|https|http2|net|tls|dgram|dns|child_process|worker_threads|cluster))"\s*\)/g;
      assert.deepStrictEqual([...new Set([...app.matchAll(builtins)].map((m) => m[1]))].sort(), ['fs', 'path']);
      assert.doesNotMatch(app, /telemetry|sendBeacon|WebSocket|EventSource/i);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('depends at run time on tree-sitter only', () => {
    const pkg = JSON.parse(read('package.json'));
    assert.deepStrictEqual(Object.keys(pkg.dependencies).sort(), ['tree-sitter-bash', 'web-tree-sitter']);
  });

  it('parses and explains scripts with the network and processes blocked', function () {
    this.timeout(60000);
    const out = execFileSync(process.execPath, ['--import', 'tsx', path.join(__dirname, 'offline-probe.ts')], { cwd: root, encoding: 'utf8' });
    assert.ok(Number(out) > 100, out);
  });
});
