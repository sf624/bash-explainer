// The command-line tool, as published: built into a temporary directory and run with Node.js.
import * as assert from 'assert';
import { execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const root = path.join(__dirname, '..');
const fixture = (...p: string[]) => path.join(root, 'test', 'fixtures', ...p);

describe('the command-line tool', function () {
  this.timeout(60000);
  let dir = '';
  let cli = '';
  const run = (args: string[], opts: { input?: string; env?: NodeJS.ProcessEnv; preload?: string } = {}) => {
    const r = spawnSync(process.execPath, [...(opts.preload ? ['--require', opts.preload] : []), cli, ...args], {
      input: opts.input, encoding: 'utf8', env: { PATH: process.env.PATH, ...opts.env },
    });
    return { code: r.status, out: r.stdout, err: r.stderr };
  };

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bash-explainer-cli-'));
    execFileSync(process.execPath, ['--import', 'tsx', 'scripts/build-cli.ts', `--outdir=${dir}`], { cwd: root, stdio: 'pipe' });
    cli = path.join(dir, 'dist', 'cli.js');
  });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('explains a line of a file', () => {
    const line = fs.readFileSync(fixture('sample.sh'), 'utf8').split('\n').findIndex((l) => l.startsWith('grep -rn')) + 1;
    assert.ok(line > 0);
    const r = run([`${fixture('sample.sh')}:${line}`, '--no-color']);
    assert.strictEqual(r.code, 0, r.err);
    assert.match(r.out, new RegExp(`sample\\.sh:${line} {2}grep -rn`));
    assert.match(r.out, /-r {2}search directories recursively/);
  });

  it('explains a command line, in Japanese', () => {
    const r = run(['-e', 'tar -czf backup.tgz -C src .', '--no-examples'], { env: { LANG: 'ja_JP.UTF-8' } });
    assert.strictEqual(r.code, 0, r.err);
    assert.match(r.out, /アーカイブ/);
  });

  it('reads standard input and writes Markdown or JSON', () => {
    const md = run(['--format', 'markdown', '-'], { input: 'echo "${f%.*}"\n' });
    assert.match(md.out, /^\*\*-:1\*\*\n\n```bash\necho "\$\{f%\.\*\}"\n```/);
    const json = JSON.parse(run(['--format', 'json', '-e', 'ls -la']).out);
    assert.strictEqual(json[0].line, 1);
    assert.strictEqual(json[0].explanation.items[0].kind, 'command');
  });

  it('warns about CRLF line ends in a script, and explains it as an LF one', () => {
    const file = path.join(dir, 'crlf.sh');
    fs.writeFileSync(file, 'if true; then\r\n  echo hi\r\nfi\r\n');
    const r = run(['--check', '--no-color', file]);
    assert.strictEqual(r.code, 1);
    assert.match(r.out, /crlf\.sh:1:14: warning: This file has Windows line endings.*\[crlf\]$/m);
    const e = run(['--no-color', '--no-examples', `${file}:3`]);
    assert.match(e.out, /crlf\.sh:3 {2}fi\n/);
    assert.match(e.out, /fi {2}End of the if statement/);
  });

  it('reads the shell code in a Dockerfile', () => {
    const r = run([`${fixture('hosts', 'Dockerfile')}:3`, '--no-examples', '--no-color']);
    assert.match(r.out, /apk add --no-cache/);
  });

  it('checks a script for its shell, and exits 1 on a warning', () => {
    const r = run(['--check', '--no-color', '-e', '#!/bin/sh\n[[ -f x ]] && echo y']);
    assert.strictEqual(r.code, 1);
    assert.match(r.out, /^\(command\):2:1: warning: \[\[ \]\] is not POSIX sh.*\[dbracket\]$/m);
    assert.strictEqual(run(['--check', '-e', '#!/bin/bash\n[[ -f x ]] && echo y']).code, 0);
    const json = JSON.parse(run(['--check', '--format', 'json', '--shell', 'dash', '-e', '[[ -f x ]]']).out);
    assert.deepStrictEqual(json.map((i: { code: string }) => i.code), ['dbracket']);
  });

  it('writes problems as GitHub annotations or SARIF, in line order', () => {
    const gh = run(['--check', '--format', 'github', fixture('posix.sh')]);
    assert.strictEqual(gh.code, 1);
    const lines = gh.out.trim().split('\n');
    assert.match(lines[0], /^::warning file=.*posix\.sh,line=3,col=1,endLine=3,endColumn=\d+,title=Bash Explainer%3A pipefail::set -o pipefail is not POSIX sh/);
    const order = lines.map((l) => Number(/line=(\d+)/.exec(l)![1]));
    assert.deepStrictEqual(order, [...order].sort((a, b) => a - b));
    const sarif = JSON.parse(run(['--check', '--format', 'sarif', '--shell', 'dash', '-e', '[[ -f x ]]']).out);
    assert.strictEqual(sarif.version, '2.1.0');
    const [result] = sarif.runs[0].results;
    assert.deepStrictEqual([result.ruleId, result.level, result.locations[0].physicalLocation.region], ['dbracket', 'warning', { startLine: 1, startColumn: 1, endLine: 1, endColumn: 11 }]);
    assert.strictEqual(run(['--format', 'sarif', '-e', 'ls']).code, 2);
  });

  it('takes the files after -- as files', () => {
    assert.strictEqual(run(['--check', '--', fixture('sample.sh')]).code, 0);
  });

  it('reports usage errors with exit status 2', () => {
    assert.strictEqual(run(['--bogus']).code, 2);
    assert.strictEqual(run([path.join(dir, 'missing.sh')]).code, 2);
    assert.strictEqual(run([]).code, 2);
    assert.match(run(['--help']).out, /^Usage: bash-explainer/);
  });

  it('works with the network and processes blocked', () => {
    // Loaded before the tool: any network or process module, or fetch, makes it fail.
    const blocker = path.join(dir, 'block.js');
    fs.writeFileSync(blocker, `
      const Module = require('module');
      const load = Module._load;
      const blocked = ['http', 'https', 'http2', 'net', 'tls', 'dgram', 'dns', 'child_process', 'worker_threads', 'cluster'];
      Module._load = function (request, ...rest) {
        if (blocked.includes(request.replace(/^node:/, ''))) throw new Error('blocked: require(' + request + ')');
        return load.call(this, request, ...rest);
      };
      for (const name of ['fetch', 'XMLHttpRequest', 'WebSocket']) globalThis[name] = () => { throw new Error('blocked: ' + name); };
    `);
    const r = run([fixture('sample.sh'), '--no-color'], { preload: blocker });
    assert.strictEqual(r.code, 0, r.err);
    assert.ok(r.out.split('\n').length > 300);
    assert.strictEqual(run(['--check', fixture('posix.sh')], { preload: blocker }).err, '');
  });
});
