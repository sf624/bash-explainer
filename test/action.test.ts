// The GitHub Action: the script of action.yml, run as the runner runs it, in a workspace that holds what a repository may
// hold. The registries are local servers: no test here needs the network, only npm and bash on PATH.
import * as assert from 'assert';
import { execFileSync, spawn } from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import type { AddressInfo } from 'net';
import * as os from 'os';
import * as path from 'path';

const root = path.join(__dirname, '..');
const version: string = JSON.parse(fs.readFileSync(path.join(root, 'cli', 'package.json'), 'utf8')).version;

/** A package registry on 127.0.0.1, with the requests it had. */
interface Registry { url: string; requests: { url: string; authorization?: string }[]; close: () => Promise<void> }

async function registry(tarball?: string): Promise<Registry> {
  const requests: Registry['requests'] = [];
  const server = http.createServer((req, res) => {
    requests.push({ url: req.url!, authorization: req.headers.authorization });
    if (!tarball) return void res.writeHead(404).end('{}');
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    if (req.url === '/tool.tgz') return void res.end(fs.readFileSync(tarball));
    if (req.url !== '/bash-explainer') return void res.writeHead(404).end('{}');
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      name: 'bash-explainer',
      'dist-tags': { latest: version },
      versions: { [version]: { name: 'bash-explainer', version, bin: { 'bash-explainer': 'dist/cli.js' }, dist: { tarball: `${url}/tool.tgz` } } },
    }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`,
    requests,
    close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
}

/** What a repository may hold: npm settings, a package with its lockfile, installed programs (they write `marker` when they run). */
function fillWorkspace(workspace: string, marker: string, otherRegistry: string) {
  const program = `#!/usr/bin/env node\nrequire('fs').writeFileSync(${JSON.stringify(marker)}, 'ran');\n`;
  const write = (file: string, text: string, mode?: number) => {
    fs.mkdirSync(path.dirname(path.join(workspace, file)), { recursive: true });
    fs.writeFileSync(path.join(workspace, file), text, { mode });
  };
  write('.npmrc', `registry=${otherRegistry}\n`);
  write('package.json', JSON.stringify({ name: 'project', version: '1.0.0', dependencies: { 'bash-explainer': version } }));
  write('package-lock.json', JSON.stringify({ name: 'project', version: '1.0.0', lockfileVersion: 3, packages: {} }));
  write('node_modules/.bin/bash-explainer', program, 0o755);
  write('node_modules/bash-explainer/package.json', JSON.stringify({ name: 'bash-explainer', version, bin: { 'bash-explainer': 'cli.js' } }));
  write('node_modules/bash-explainer/cli.js', program, 0o755);
  write('.npm/placeholder', '');
}

/** A tree's files and their contents, to see that a run left it as it was. */
function tree(dir: string, at = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of fs.readdirSync(path.join(dir, at), { withFileTypes: true })) {
    const p = path.join(at, e.name);
    if (e.isDirectory()) Object.assign(out, tree(dir, p));
    else out[p] = fs.readFileSync(path.join(dir, p), 'latin1');
  }
  return out;
}

describe('the GitHub Action', function () {
  this.timeout(180000);
  const action = fs.readFileSync(path.join(root, 'action.yml'), 'utf8');
  /** The step's script: the block after `run: |`, without its indentation. */
  const run = /^ {6}run: \|\n((?:(?: {8}.*)?\n)+)/m.exec(action)![1].replace(/^ {8}/gm, '');
  const description = /^description: (.*)$/m.exec(action)![1];
  let build = '';
  let tgz = '';
  let dir = '';
  let workspace = '';
  let marker = '';
  let script = '';
  let good: Registry;
  let other: Registry;

  before(async () => {
    build = fs.mkdtempSync(path.join(os.tmpdir(), 'bash-explainer-action-'));
    execFileSync(process.execPath, ['--import', 'tsx', 'scripts/build-cli.ts', `--outdir=${path.join(build, 'pkg')}`], { cwd: root, stdio: 'pipe' });
    const name = execFileSync('npm', ['pack', path.join(build, 'pkg'), '--pack-destination', build, '--silent', '--ignore-scripts'], { cwd: build, encoding: 'utf8' }).trim();
    tgz = path.join(build, name);
    script = path.join(build, 'step.sh');
    fs.writeFileSync(script, run);
    good = await registry(tgz);
    other = await registry();
  });
  after(async () => {
    await good.close();
    await other.close();
    fs.rmSync(build, { recursive: true, force: true });
  });

  beforeEach(() => {
    good.requests.length = 0;
    other.requests.length = 0;
    dir = fs.mkdtempSync(path.join(build, 'run-'));
    workspace = path.join(dir, 'workspace');
    marker = path.join(dir, 'marker');
    for (const d of ['temp', 'home']) fs.mkdirSync(path.join(dir, d));
    fs.mkdirSync(path.join(workspace, 'scripts'), { recursive: true });
    // (Two bashisms: errors, for sh.)
    fs.writeFileSync(path.join(workspace, 'scripts', 'a.sh'), '#!/bin/sh\nif [[ -n $x ]]; then echo "$x"; fi\n');
    fillWorkspace(workspace, marker, other.url);
  });

  /** The step as the runner runs it: `bash --noprofile --norc -e -o pipefail`, in the workspace, with what the workflow sets. */
  const step = (inputs: Partial<Record<'FILES' | 'CHECK_SHELL' | 'CHECK_BASH_VERSION' | 'FAIL_ON_WARNING' | 'STRICT' | 'SARIF' | 'PACKAGE', string>>, env: NodeJS.ProcessEnv = {}) => new Promise<{ code: number | null; out: string; outputs: Record<string, string> }>((resolve, reject) => {
    const outputs = path.join(dir, 'temp', 'output');
    fs.writeFileSync(outputs, '');
    const child = spawn('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', script], {
      cwd: workspace,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        PATH: process.env.PATH,
        HOME: path.join(dir, 'home'),
        RUNNER_TEMP: path.join(dir, 'temp'),
        GITHUB_OUTPUT: outputs,
        ACTION_PATH: root,
        FILES: '**/*.sh',
        CHECK_SHELL: '',
        CHECK_BASH_VERSION: '',
        FAIL_ON_WARNING: 'true',
        STRICT: 'false',
        SARIF: '',
        PACKAGE: tgz,
        ...inputs,
        ...env,
      },
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const timer = setTimeout(() => process.kill(-child.pid!, 'SIGKILL'), 150000);
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, out, outputs: Object.fromEntries(fs.readFileSync(outputs, 'utf8').split('\n').filter(Boolean).map((l) => l.split('=') as [string, string])) });
    });
  });

  /** The real tool ran on the script of the workspace, and nothing of the workspace ran or was asked. */
  const realToolRan = (r: { code: number | null; out: string; outputs: Record<string, string> }) => {
    assert.strictEqual(r.code, 1, r.out);
    assert.match(r.out, /^::error file=scripts\/a\.sh,line=2,/m);
    assert.ok(+r.outputs.errors > 0, r.out);
    assert.strictEqual(fs.existsSync(marker), false, 'a program of the workspace ran');
    assert.deepStrictEqual(other.requests, [], 'the registry of the workspace was asked');
  };

  it('runs the package it was given, whatever the workspace holds, and leaves the workspace as it was', async () => {
    const before = tree(workspace);
    realToolRan(await step({}));
    assert.deepStrictEqual(tree(workspace), before);
    assert.deepStrictEqual(fs.readdirSync(path.join(dir, 'temp')).filter((f) => f !== 'output'), [], 'the temporary files are gone');
  });

  it('takes the default package from the registry the workflow configured, with its token (setup-node)', async () => {
    const npmrc = path.join(dir, 'temp', '.npmrc');
    const host = good.url.slice('http:'.length);
    fs.writeFileSync(npmrc, `${host}:_authToken=\${NODE_AUTH_TOKEN}\nregistry=${good.url}\nalways-auth=true\n`);
    const r = await step({ PACKAGE: '' }, { NPM_CONFIG_USERCONFIG: npmrc, NODE_AUTH_TOKEN: 'token-of-the-workflow' });
    fs.rmSync(npmrc);
    realToolRan(r);
    assert.ok(good.requests.some((q) => q.url === '/bash-explainer' && q.authorization === 'Bearer token-of-the-workflow'), JSON.stringify(good.requests));
  });

  it('takes the registry from npm_config_registry and from ~/.npmrc', async () => {
    realToolRan(await step({ PACKAGE: '' }, { npm_config_registry: good.url }));
    assert.ok(good.requests.some((q) => q.url === '/bash-explainer'));
    good.requests.length = 0;
    fs.writeFileSync(path.join(dir, 'home', '.npmrc'), `registry=${good.url}\n`);
    realToolRan(await step({ PACKAGE: '' }));
    assert.ok(good.requests.some((q) => q.url === '/bash-explainer'));
  });

  it('does not take a home inside the workspace for the user\'s', async () => {
    // (The machine's configuration names the registry.)
    const global = path.join(dir, 'global-npmrc');
    fs.writeFileSync(global, `registry=${good.url}\n`);
    realToolRan(await step({ PACKAGE: '' }, { HOME: workspace, NPM_CONFIG_GLOBALCONFIG: global }));
    assert.ok(good.requests.some((q) => q.url === '/bash-explainer'));
  });

  it('reads a relative path in `package` from the workspace, as the workflow\'s choice', async () => {
    fs.mkdirSync(path.join(workspace, 'vendor'));
    fs.copyFileSync(tgz, path.join(workspace, 'vendor', 'tool.tgz'));
    for (const PACKAGE of ['./vendor/tool.tgz', 'vendor/tool.tgz', 'file:vendor/tool.tgz', '../workspace/vendor/tool.tgz']) realToolRan(await step({ PACKAGE }));
    fs.cpSync(path.join(build, 'pkg'), path.join(workspace, 'vendor', 'tool', 'dir'), { recursive: true });
    for (const PACKAGE of ['./vendor/tool/dir', 'vendor/tool/dir']) realToolRan(await step({ PACKAGE }));
    fs.copyFileSync(tgz, path.join(workspace, 'tool.tgz'));
    realToolRan(await step({ PACKAGE: 'tool.tgz' }));
    realToolRan(await step({ PACKAGE: `file:${tgz}` }));
  });

  it('runs no script of the package it installs', async () => {
    const pkg = path.join(dir, 'with-script');
    fs.cpSync(path.join(build, 'pkg'), pkg, { recursive: true });
    const manifest = JSON.parse(fs.readFileSync(path.join(pkg, 'package.json'), 'utf8'));
    manifest.scripts = { postinstall: `node -e "require('fs').writeFileSync(process.argv[1], 'ran')" ${JSON.stringify(marker)}` };
    fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify(manifest));
    const name = execFileSync('npm', ['pack', pkg, '--pack-destination', dir, '--silent', '--ignore-scripts'], { cwd: dir, encoding: 'utf8' }).trim();
    realToolRan(await step({ PACKAGE: path.join(dir, name) }));
  });

  it('fails with exit status 2 and says so when the package cannot be installed or has no such program', async () => {
    const r = await step({ PACKAGE: path.join(dir, 'missing.tgz') });
    assert.strictEqual(r.code, 2, r.out);
    assert.match(r.out, /^::error title=Bash Explainer::Could not install /m);
    const pkg = path.join(dir, 'other-program');
    fs.mkdirSync(pkg);
    fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: 'other-program', version: '1.0.0' }));
    const s = await step({ PACKAGE: pkg });
    assert.strictEqual(s.code, 2, s.out);
    assert.match(s.out, /^::error title=Bash Explainer::.* has no bash-explainer program\.$/m);
    assert.strictEqual(fs.existsSync(marker), false);
  });

  it('asks for nothing when no file matches', async () => {
    const r = await step({ FILES: 'none/**/*.sh', PACKAGE: '' }, { npm_config_registry: good.url });
    assert.strictEqual(r.code, 0, r.out);
    assert.deepStrictEqual(r.outputs, { errors: '0', warnings: '0', pitfalls: '0' });
    assert.deepStrictEqual(good.requests, []);
  });

  it('keeps its inputs, outputs and exit statuses', async () => {
    const lenient = await step({ FAIL_ON_WARNING: 'false' });
    assert.strictEqual(lenient.code, 0, lenient.out);
    assert.ok(+lenient.outputs.errors > 0);
    assert.strictEqual(lenient.outputs.warnings, lenient.outputs.errors);

    const sarif = path.join(dir, 'temp', 'out.sarif');
    realToolRan(await step({ SARIF: sarif }));
    assert.ok(JSON.parse(fs.readFileSync(sarif, 'utf8')).runs[0].results.some((x: { ruleId: string }) => x.ruleId === 'dbracket'));
    fs.rmSync(sarif);

    fs.writeFileSync(path.join(workspace, 'scripts', 'b.sh'), '#!/bin/bash\ncurl -s "$u" | sh\n');
    const strict = await step({ FILES: 'scripts/b.sh', STRICT: 'true' });
    assert.strictEqual(strict.code, 1, strict.out);
    assert.strictEqual(strict.outputs.warnings, '1');
    const loose = await step({ FILES: 'scripts/b.sh' });
    assert.strictEqual(loose.code, 0, loose.out);
    assert.match(loose.out, /^Checked 1 file\(s\) with .*\.$/m);

    fs.writeFileSync(path.join(workspace, 'scripts', 'c.sh'), '#!/bin/bash\nx=${ echo a; }\n');
    assert.strictEqual((await step({ FILES: 'scripts/c.sh' })).code, 1);
    assert.strictEqual((await step({ FILES: 'scripts/c.sh', CHECK_BASH_VERSION: '5.3' })).code, 0);
    const shell = await step({ FILES: 'scripts/c.sh', CHECK_SHELL: 'sh' });
    assert.strictEqual(shell.code, 1, shell.out);
  });

  it('does not call itself offline: it gets the tool from npm', () => {
    assert.doesNotMatch(description, /offline/i);
    assert.ok(description.length <= 125, 'the Marketplace cuts a longer description');
  });
});
