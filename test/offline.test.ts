// Bash Explainer is offline by design: no network access, no AI, no telemetry and no external
// processes. These checks keep it that way; the Privacy section of README.md links here.
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
    return e.isDirectory() ? sourceFiles(file) : /\.[cm]?[jt]s$/.test(e.name) ? [file] : [];
  });
}

describe('offline by design', () => {
  it('the source imports only vscode, path and web-tree-sitter', () => {
    const modules = new Set<string>();
    for (const file of sourceFiles('src')) {
      for (const m of read(file).matchAll(/\bfrom\s+'([^']+)'|\b(?:require|import)\s*\(\s*'([^']+)'\s*\)/g)) {
        const name = m[1] ?? m[2];
        if (!name.startsWith('.')) modules.add(name);
      }
    }
    assert.deepStrictEqual([...modules].sort(), ['path', 'vscode', 'web-tree-sitter']);
  });

  it('the source and the panel script use no browser network APIs', () => {
    for (const file of [...sourceFiles('src'), ...sourceFiles('media')]) {
      const hit = read(file).match(NETWORK_APIS);
      assert.ok(!hit, `${file}: ${hit?.[0]}`);
    }
  });

  it('the shipped bundle requires only vscode, fs and path, all by name', function () {
    this.timeout(60000);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bash-explainer-'));
    try {
      const out = path.join(dir, 'extension.js');
      // The same build as `npm run package`.
      execFileSync(process.execPath, ['esbuild.mjs', '--production', `--outfile=${out}`], { cwd: root, stdio: 'pipe' });
      const bundle = fs.readFileSync(out, 'utf8');
      const required = new Set([...bundle.matchAll(/\brequire\s*\(\s*"([^"]+)"\s*\)/g)].map((m) => m[1]));
      assert.deepStrictEqual([...required].sort(), ['fs', 'path', 'vscode']);
      // A name built at run time could load anything.
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
