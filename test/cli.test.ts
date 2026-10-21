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

  it('labels a command with its name, and its arguments as before', () => {
    const r = run(['-e', "grep -E '^[A-Z]{3}-[0-9]+$' ids.txt", '--no-color', '--no-examples']);
    assert.strictEqual(r.code, 0, r.err);
    const rows = r.out.split('\n');
    const at = rows.findIndex((l) => /^ {2}grep {2}Print lines matching a pattern/.test(l));
    assert.ok(at > 0, r.out);
    assert.match(rows[at + 1], /^ {4}-E {2}use extended regex/);
    assert.ok(rows.slice(at).some((l) => /^ {4}ids\.txt {2}file to search/.test(l)), r.out);
    // The line itself is still shown whole in the header.
    assert.match(r.out, /^\(command\):1 {2}grep -E '\^\[A-Z\]\{3\}-\[0-9\]\+\$' ids\.txt$/m);
    const json = JSON.parse(run(['--format', 'json', '-e', 'grep -E x ids.txt']).out);
    assert.strictEqual(json[0].explanation.items[0].label, 'grep');
    assert.deepStrictEqual(json[0].explanation.items[0].span, { start: { line: 0, character: 0 }, end: { line: 0, character: 17 } });
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
    assert.match(r.out, /crlf\.sh:1:10: warning: This file has Windows line endings.*\[crlf\]$/m);
    // A directive anywhere in the file turns the warning off.
    fs.writeFileSync(file, 'if true; then\r\n  echo hi\r\nfi\r\n# bash-explainer disable-file=crlf\r\n');
    assert.strictEqual(run(['--check', '--no-color', file]).code, 0);
    fs.writeFileSync(file, 'if true; then\r\n  echo hi\r\nfi\r\n');
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

  describe('settings', () => {
    const write = (file: string, text: string) => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text);
      return file;
    };
    const config = (r: { code: number | null; out: string; err: string }) => {
      assert.strictEqual(r.code, 0, r.err);
      return JSON.parse(r.out);
    };

    it('prints the settings in effect as JSON, the keys the tool reads', () => {
      const r = config(run(['--print-config']));
      assert.strictEqual(r['bashExplainer.shell'], 'auto');
      assert.strictEqual(r['bashExplainer.language'], 'auto');
      assert.deepStrictEqual(r['bashExplainer.customCommands'], {});
      // Settings with no meaning here are not listed.
      assert.ok(!('bashExplainer.hover.enabled' in r) && !('bashExplainer.panel.autoOpen' in r));
    });

    it('reads $XDG_CONFIG_HOME/bash-explainer/settings.json, else ~/.config/…, written as VS Code writes it', () => {
      const xdg = path.join(dir, 'xdg');
      write(path.join(xdg, 'bash-explainer', 'settings.json'), `{
        // As in VS Code's settings.json: comments, the prefix or none, nested objects, a trailing comma.
        "bashExplainer.shell": "sh",
        "notes": { "idioms": false },
        "bashExplainer.hover.enabled": false,
        "bashExplainer.nope": 1,
        "examples.disabled": ["sed", "bogus"],
      }`);
      const r = run(['--print-config'], { env: { XDG_CONFIG_HOME: xdg } });
      const c = config(r);
      assert.strictEqual(c['bashExplainer.shell'], 'sh');
      assert.strictEqual(c['bashExplainer.notes.idioms'], false);
      assert.deepStrictEqual(c['bashExplainer.examples.disabled'], []);
      // Unknown keys and wrong values are left out, with a warning; a VS Code-only setting is accepted quietly.
      assert.deepStrictEqual(r.err.trim().split('\n'), [
        `bash-explainer: warning: ${path.join(xdg, 'bash-explainer', 'settings.json')}: unknown setting nope; ignored`,
        `bash-explainer: warning: ${path.join(xdg, 'bash-explainer', 'settings.json')}: bashExplainer.examples.disabled: unknown bogus (expected regex, sed, awk, jq, yq, perl, textFilters, pipeline, expansion, printf, glob, test, xargs, read, getopt, gitLog, date); ignored`,
      ]);
      const home = path.join(dir, 'home');
      write(path.join(home, '.config', 'bash-explainer', 'settings.json'), '{ "shell": "dash" }');
      assert.strictEqual(config(run(['--print-config'], { env: { HOME: home } }))['bashExplainer.shell'], 'dash');
      // XDG_CONFIG_HOME wins over HOME; with neither, or no file there, the defaults.
      assert.strictEqual(config(run(['--print-config'], { env: { HOME: home, XDG_CONFIG_HOME: xdg } }))['bashExplainer.shell'], 'sh');
      const none = run(['--print-config'], { env: { HOME: path.join(dir, 'nobody') } });
      assert.strictEqual(config(none)['bashExplainer.shell'], 'auto');
      assert.strictEqual(none.err, '');
    });

    it('takes --config, else $BASH_EXPLAINER_CONFIG, before the default file, and --no-config reads none', () => {
      const env = { XDG_CONFIG_HOME: path.join(dir, 'xdg') };
      const given = write(path.join(dir, 'given.json'), '{ "shell": "ksh" }');
      const fromEnv = write(path.join(dir, 'env.json'), '{ "shell": "zsh" }');
      const shell = (args: string[], e: NodeJS.ProcessEnv) => config(run(['--print-config', ...args], { env: e }))['bashExplainer.shell'];
      assert.strictEqual(shell([], env), 'sh');
      assert.strictEqual(shell([], { ...env, BASH_EXPLAINER_CONFIG: fromEnv }), 'zsh');
      assert.strictEqual(shell(['--config', given], { ...env, BASH_EXPLAINER_CONFIG: fromEnv }), 'ksh');
      assert.strictEqual(shell([`--config=${given}`], env), 'ksh');
      assert.strictEqual(shell(['--no-config'], { ...env, BASH_EXPLAINER_CONFIG: fromEnv }), 'auto');
      // A file that was named must be there, and be JSON.
      const missing = run(['--print-config', '--config', path.join(dir, 'missing.json')]);
      assert.strictEqual(missing.code, 2);
      assert.match(missing.err, /cannot read the settings file .*missing\.json: ENOENT/);
      assert.strictEqual(run(['--print-config'], { env: { BASH_EXPLAINER_CONFIG: path.join(dir, 'missing.json') } }).code, 2);
      const broken = run(['--print-config', '--config', write(path.join(dir, 'broken.json'), '{ "shell": }')]);
      assert.strictEqual(broken.code, 2);
      assert.match(broken.err, /the settings file .*broken\.json is not JSON/);
      const notObject = run(['--print-config', '--config', write(path.join(dir, 'list.json'), '[]')]);
      assert.match(notObject.err, /list\.json: expected an object of settings/);
    });

    it('lets --set override the file, and --lang, --shell and --no-examples override both', () => {
      const file = write(path.join(dir, 'layers.json'), '{ "shell": "ksh", "language": "ja", "examples.enabled": true }');
      const c = (args: string[]) => config(run(['--print-config', '--config', file, ...args]));
      assert.strictEqual(c([])['bashExplainer.shell'], 'ksh');
      assert.strictEqual(c(['--set', 'shell=dash'])['bashExplainer.shell'], 'dash');
      assert.strictEqual(c(['--set', 'shell=dash', '--shell', 'bash'])['bashExplainer.shell'], 'bash');
      assert.strictEqual(c(['--shell', 'bash', '--set', 'shell=dash'])['bashExplainer.shell'], 'bash');
      assert.strictEqual(c(['--set=language=en'])['bashExplainer.language'], 'en');
      assert.strictEqual(c(['--set', 'language=en', '--lang', 'ja'])['bashExplainer.language'], 'ja');
      assert.strictEqual(c(['--set', 'examples.enabled=false'])['bashExplainer.examples.enabled'], false);
      assert.strictEqual(c(['--set', 'examples.enabled=true', '--no-examples'])['bashExplainer.examples.enabled'], false);
      assert.deepStrictEqual(c(['--set', 'diagnostics.ignore=["crlf","dbracket"]'])['bashExplainer.diagnostics.ignore'], ['crlf', 'dbracket']);
      // A wrong value or key is left out with a warning; a word without = is a usage error.
      const bad = run(['--print-config', '--no-config', '--set', 'shell=fish', '--set', 'bashExplainer.nope=1']);
      assert.strictEqual(config(bad)['bashExplainer.shell'], 'auto');
      assert.match(bad.err, /warning: --set: bashExplainer\.shell: expected one of auto, bash/);
      assert.match(bad.err, /warning: --set: unknown setting nope; ignored/);
      assert.strictEqual(run(['--print-config', '--set', 'shell']).code, 2);
      // The language of the explanations: the file's, unless LANG is overridden by --lang.
      assert.match(run(['--config', file, '--no-examples', '-e', 'ls -l']).out, /ファイル/);
      assert.doesNotMatch(run(['--config', file, '--lang', 'en', '--no-examples', '-e', 'ls -l']).out, /ファイル/);
    });

    it('explains and checks as the settings say', () => {
      const posix = '#!/bin/bash\n[[ -f x ]] && echo hi\n';
      const script = write(path.join(dir, 'settings.sh'), posix);
      assert.strictEqual(run(['--check', '--no-config', script]).code, 0);
      assert.strictEqual(run(['--check', '--set', 'shell=sh', script]).code, 1);
      assert.strictEqual(run(['--check', '--set', 'shell=sh', '--set', 'diagnostics.ignore=["dbracket"]', script]).code, 0);
      // Warnings in a Dockerfile are left out with diagnostics.embedded off.
      const docker = write(path.join(dir, 'Dockerfile'), 'FROM alpine\nRUN curl -s x | sh\n');
      assert.strictEqual(run(['--check', '--no-config', docker]).code, 1);
      assert.strictEqual(run(['--check', '--set', 'diagnostics.embedded=false', docker]).code, 0);
      // Notes, examples and your own commands.
      const loop = ['--no-config', '--no-color', '-e', 'for f in $(ls); do echo "$f"; done'];
      assert.match(run(loop).out, /\$\(ls\)/);
      const pitfall = (args: string[]) => run([...loop, ...args]).out.split('\n').filter((l) => /^ {2}⚠/.test(l));
      assert.ok(pitfall([]).length > 0, run(loop).out);
      assert.deepStrictEqual(pitfall(['--set', 'notes.pitfalls=false']), []);
      const sed = ['--no-config', '--no-color', '-e', "echo a | sed 's/a/b/'"];
      assert.match(run(sed).out, /^ {2}\S.*sed/m);
      const titles = (args: string[]) => run([...sed, ...args]).out.split('\n').filter((l) => /^ {2}[^ ⚠›]/.test(l) && !/^ {2}echo|^ {2}sed/.test(l));
      assert.ok(titles([]).length > titles(['--set', 'examples.disabled=["sed","pipeline"]']).length);
      const deploy = write(path.join(dir, 'custom.json'), JSON.stringify({ 'bashExplainer.customCommands': { deploy: { summary: 'Deploy to production' } } }));
      assert.match(run(['--config', deploy, '--no-color', '-e', 'deploy web']).out, /Deploy to production/);
    });
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
