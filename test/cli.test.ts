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

  it('writes the words of a brace expansion on one line, each in backticks, then what echo prints', () => {
    const text = run(['-e', 'echo {1..10..3}', '--no-color']).out;
    assert.match(text, /^ {4}Resulting words \(4 separate arguments of `echo`\)\n {6}`1` `4` `7` `10`\n {4}Output\n {6}1 4 7 10$/m);
  });

  it('says what each command name is, as the panel\'s badge does: in the text, in Markdown, and in JSON', () => {
    const text = run(['-e', 'sudo echo hi; echo hi', '--no-color']).out;
    // (In the list `sudo echo hi; echo hi`.)
    assert.match(text, /^ {6}echo {2}runs echo: Print arguments to stdout, separated by spaces \(from coreutils\) \(program, run by sudo\)$/m);
    assert.match(text, /^ {4}echo {2}Print arguments to stdout, separated by spaces \(builtin\) \(Bash manual 4\.2\)$/m);
    assert.match(run(['-e', 'cd /', '--no-color', '--lang', 'ja']).out, /^ {2}cd {2}カレントディレクトリを移動する（ビルトイン）/m);
    assert.match(run(['--format', 'markdown', '-e', 'time ls']).out, /^ {2}- `time` — .* \(keyword\)$/m);
    const json = JSON.parse(run(['--format', 'json', '-e', 'echo hi']).out);
    assert.deepStrictEqual([json[0].explanation.items[0].name.runs, json[0].explanation.items[0].name.also[0].kind], ['builtin', 'program']);
  });

  it('keeps what only the panel reads out of the JSON, at every depth', () => {
    const json = JSON.stringify(JSON.parse(run(['--format', 'json', '-e', 'for x in a; do if true; then echo $x; fi; done']).out));
    assert.doesNotMatch(json, /"(frame|plain)":/);
    // (The tokens themselves stay, with those under them.)
    assert.match(json, /"children":\[\{/);
  });

  it('names the sections of the Bash manual: numbers in the text, links in Markdown, ids in JSON', () => {
    const text = run(['-e', 'exit 300', '--no-color']).out;
    assert.match(text, /ℹ An exit status is 0–255, so `exit 300` gives 44 \(the value modulo 256\) \(Bash manual 3\.7\.5\)$/m);
    assert.match(text, /exit  Exit the shell or script \(special builtin\) \(Bash manual 4\.1, 4\.4\)$/m);
    assert.match(run(['-e', 'exit 300', '--no-color', '--lang', 'ja']).out, /（特殊ビルトイン）/);
    assert.match(run(['-e', 'exit 300', '--no-color', '--lang', 'ja']).out, /\(Bash マニュアル 3\.7\.5\)$/m);
    // In colour, the numbers are dim; a row with none ends with its explanation.
    const color = run(['-e', 'exit 300', '--color']).out;
    assert.ok(color.includes('\x1b[90m (Bash manual 4.1, 4.4)\x1b[0m'), color);
    assert.match(run(['-e', 'grep x', '--no-color', '--no-examples']).out, /grep  Print lines matching a pattern \(regex\) \(program\)$/m);
    const md = run(['--format', 'markdown', '-e', 'exit 300']).out;
    assert.ok(md.includes('(Bash manual [3.7.5](https://www.gnu.org/software/bash/manual/html_node/Exit-Status.html "Exit Status"))'), md);
    const json = JSON.parse(run(['--format', 'json', '-e', 'exit 300']).out);
    assert.deepStrictEqual(json[0].explanation.items[0].refs, ['4.1', '4.4']);
    assert.deepStrictEqual(json[0].explanation.facts.map((f: { id: string; refs: string[] }) => [f.id, f.refs]), [['exit-modulo', ['3.7.5']]]);
  });

  it('says under a note that rests on bash\'s behaviour what it rests on, with the try-it: in the text and in JSON, unless `notes.basis` is off', () => {
    const text = run(['-e', 'unset -fv x', '--no-color']).out;
    assert.ok(text.includes([
      '    [Not in the manual · checked with bash 5.2 and 5.3]',
      "    Try it in your terminal: bash -c 'f() { :; }; x=1; unset -fv x f; echo \"status $?, x=$x\"; type -t f'",
      '      bash: line 1: unset: cannot simultaneously unset a function and a variable',
      '      status 1, x=1',
      '      function',
    ].join('\n')), text);
    assert.match(run(['-e', 'exit 300', '--no-color', '--lang', 'ja']).out, /^ {4}\[マニュアルに記述なし・bash 5\.2・5\.3 で確認\]\n {4}端末で試す: bash -c '\(exit 300\); echo \$\?'\n {6}44$/m);
    const json = JSON.parse(run(['--format', 'json', '-e', 'exit 300']).out);
    assert.deepStrictEqual([json[0].explanation.facts[0].basis, json[0].explanation.facts[0].tryIt], [
      { kind: 'checked', bash: ['5.2', '5.3'], probes: ['status#exit-status', 'status#exit-negative'] },
      { code: "bash -c '(exit 300); echo $?'", output: '44', bash: '5.2', probe: 'status#exit-status' },
    ]);
    assert.doesNotMatch(run(['-e', 'exit 300', '--no-color', '--set', 'notes.basis=false']).out, /Not in the manual|Try it/);
    const off = JSON.parse(run(['--format', 'json', '-e', 'exit 300', '--set', 'notes.basis=false']).out);
    assert.ok(!('basis' in off[0].explanation.facts[0]) && !('tryIt' in off[0].explanation.facts[0]));
  });

  it('says under a row that rests on bash\'s behaviour what it rests on, with the try-it: in the text and in JSON (docs/design/basis.md, step 4)', () => {
    const text = run(['-e', 'BASH_XTRACEFD=7', '--no-color']).out;
    assert.match(text, /^ {2}BASH_XTRACEFD=7 {2}Assign .*\n {4}\[Differs from the manual · checked with bash 5\.2 and 5\.3\]\n {4}Try it in your terminal: bash -c 'exec 3>\/dev\/null .*'\n {6}fd 3 is still open$/m);
    const json = JSON.parse(run(['--format', 'json', '-e', 'BASH_XTRACEFD=7']).out);
    assert.deepStrictEqual([json[0].explanation.items[0].basis, json[0].explanation.items[0].tryIt.probe], [{ kind: 'differs', bash: ['5.2', '5.3'], probes: ['state#xtracefd-old-open'] }, 'state#xtracefd-old-open']);
    assert.doesNotMatch(run(['-e', 'BASH_XTRACEFD=7', '--no-color', '--set', 'notes.basis=false']).out, /Differs from the manual|Try it/);
    assert.ok(!('basis' in JSON.parse(run(['--format', 'json', '-e', 'BASH_XTRACEFD=7', '--set', 'notes.basis=false']).out)[0].explanation.items[0]));
  });

  it('names in JSON the spec a program\'s command token rests on, on that token only; the text shows nothing of it (docs/design/basis-spec-convention.md, 5a)', () => {
    const json = JSON.parse(run(['--format', 'json', '-e', 'grep -n x f']).out);
    const grep = json[0].explanation.items[0];
    assert.deepStrictEqual(grep.basis, { kind: 'spec', command: 'grep' });
    assert.ok(grep.children.every((c: { basis?: unknown }) => !('basis' in c)));
    assert.ok(!('basis' in JSON.parse(run(['--format', 'json', '-e', 'read -r x']).out)[0].explanation.items[0]));
    assert.ok(!('basis' in JSON.parse(run(['--format', 'json', '-e', 'grep -n x f', '--set', 'notes.basis=false']).out)[0].explanation.items[0]));
    assert.doesNotMatch(run(['-e', 'grep -n x f', '--no-color']).out, /spec|manual ·/);
    // An alias is read with the spec of the command it runs: its token names it, and nothing else does (decision of 2026-10-28).
    const alias = JSON.parse(run(['--format', 'json', '-e', 'shopt -s expand_aliases\nalias g=grep\ng -n x f']).out);
    const g = alias.flatMap((l: { explanation: { items: { label: string; basis?: unknown }[] } }) => l.explanation.items).filter((i: { label: string }) => i.label === 'g');
    assert.deepStrictEqual(g.map((i: { basis?: unknown }) => i.basis), [{ kind: 'spec', command: 'grep' }]);
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

  it('writes a control character as <LF>, <TAB> or <ESC> in the text and in Markdown, not as a picture that a font may lack', () => {
    for (const args of [['--no-color'], ['--format', 'markdown']]) {
      const r = run(['-e', "s=$'a\\nb'; printf '\\033[1m%s\\t' OK; echo \"$s\"", ...args]);
      assert.strictEqual(r.code, 0, r.err);
      const out = r.out.replace(/`/g, '');
      assert.ok(out.includes('a<LF>b') && out.includes('<ESC>[1mOK<TAB>') && out.includes('<ESC> is ESC (escape)'), r.out);
      assert.ok(!/[\u2400-\u241f\u2421\u21e5]/.test(r.out), r.out);
    }
    // JSON keeps the explanation as the analyzer says it.
    assert.ok(run(['-e', "echo $'a\\nb'", '--format', 'json']).out.includes('\u240a'));
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

  it('checks a Markdown block as POSIX sh only when it says so', () => {
    const file = path.join(dir, 'fences.md');
    const body = '[[ -n $x ]] && echo -e hi\n';
    fs.writeFileSync(file, '```sh\n' + body + '```\n\n```sh\n#!/bin/bash\n' + body + '```\n');
    assert.strictEqual(run(['--check', '--no-color', file]).code, 0);
    fs.writeFileSync(file, '```sh\n#!/bin/sh\n' + body + '```\n');
    const r = run(['--check', '--no-color', file]);
    assert.strictEqual(r.code, 1);
    assert.match(r.out, /not POSIX sh/);
  });

  it('reports CRLF line ends in a script, and explains it as an LF one', () => {
    const file = path.join(dir, 'crlf.sh');
    fs.writeFileSync(file, 'if true; then\r\n  echo hi\r\nfi\r\n');
    const r = run(['--check', '--no-color', file]);
    assert.strictEqual(r.code, 1);
    // (An error: `then\r` is no keyword, however the file runs.)
    assert.match(r.out, /crlf\.sh:1:10: error: This file has Windows line endings.*\[crlf\]$/m);
    // With no shebang and no keyword before a CR, `bash file` runs it (a warning, which fails the check only with --strict).
    fs.writeFileSync(file, 'echo hi\r\n');
    const w = run(['--check', '--no-color', file]);
    assert.strictEqual(w.code, 0);
    assert.match(w.out, /crlf\.sh:1:6: warning: This file has Windows line endings.*\[crlf\]$/m);
    assert.strictEqual(run(['--check', '--strict', file]).code, 1);
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

  it('fails the check on `${(f)x}` only where a run surely gets to it, as real bash does', () => {
    const check = (name: string, text: string) => {
      const file = path.join(dir, name);
      fs.writeFileSync(file, text);
      return run(['--check', '--no-color', file]);
    };
    // (With a first line. With only a name it is a warning: the test of the evidence below.)
    assert.strictEqual(check('stops.sh', '#!/bin/bash\necho ${(f)x}\n').code, 1);
    assert.strictEqual(spawnSync('bash', [path.join(dir, 'stops.sh')]).status, 1);
    assert.strictEqual(check('after.sh', 'exit 0\necho ${(f)x}\n').code, 0);
    assert.strictEqual(spawnSync('bash', [path.join(dir, 'after.sh')]).status, 0);
    assert.strictEqual(check('zsh.sh', 'if [ -n "$ZSH_VERSION" ]; then a=(${(f)x}); fi\n').code, 0);
    assert.strictEqual(spawnSync('bash', [path.join(dir, 'zsh.sh')]).status, 0);
    assert.strictEqual(check('Dockerfile', 'FROM a\nRUN echo ${(f)x}\n').code, 0);
    assert.strictEqual(check('a.md', '```bash\necho ${(f)x}\n```\n').code, 0);
  });

  it('a file only its name says is a script: a warning, which only `--strict` fails on', () => {
    const write = (name: string, text: string) => {
      const file = path.join(dir, name);
      fs.writeFileSync(file, text);
      return file;
    };
    for (const [text, code, message] of [['echo ok )\n', 'syntax-error-if-bash', /cannot stand here: a syntax error/], ['a=(${(f)"$(x)"})\n', 'bad-substitution-if-bash', /bad substitution/]] as const) {
      for (const args of [[write('named.sh', text)], [write('named.bash', text)], ['--kind', 'shell', write('named', text)]]) {
        assert.strictEqual(run(['--check', '--no-color', ...args]).code, 0, args.join(' '));
        assert.strictEqual(run(['--check', '--strict', '--no-color', ...args]).code, 1, args.join(' '));
        const said = run(['--check', '--no-color', ...args]).out;
        assert.ok(said.includes(`warning: `) && said.includes(`[${code}]`) && message.test(said), said);
        const json = JSON.parse(run(['--check', '--no-color', '--format', 'json', ...args]).out) as { code: string; severity: string }[];
        assert.deepStrictEqual(json.map((p) => [p.code, p.severity]), [[code, 'warning']]);
        const sarif = JSON.parse(run(['--check', '--no-color', '--format', 'sarif', ...args]).out) as { runs: { results: { ruleId: string; level: string }[] }[] };
        assert.deepStrictEqual(sarif.runs[0].results.map((r) => [r.ruleId, r.level]), [[code, 'warning']]);
      }
      // (A first line, a shell chosen, a command given: an error.)
      const error = code.replace('-if-bash', code.startsWith('bad') ? '-always' : '');
      for (const args of [[write('first.sh', `#!/bin/bash\n${text}`)], ['--shell', 'bash', write('chosen.sh', text)], ['-e', text]]) {
        assert.strictEqual(run(['--check', '--no-color', ...args]).code, 1, args.join(' '));
        const json = JSON.parse(run(['--check', '--no-color', '--format', 'json', ...args]).out) as { code: string; severity: string }[];
        assert.deepStrictEqual(json.map((p) => [p.code, p.severity]), [[error, 'error']]);
      }
    }
    // (Silenced by its own code, and a name of another shell says nothing, even with `--strict`.)
    assert.strictEqual(run(['--check', '--strict', '--no-color', write('off.sh', '# bash-explainer disable=syntax-error-if-bash\necho ok )\n')]).code, 0);
    for (const name of ['x.fish', 'x.csh', '.cshrc', 'x.tcsh', '.tcshrc', 'x.zsh-theme']) assert.strictEqual(run(['--check', '--strict', '--no-color', write(name, 'if test a\n  echo b\nend\n')]).code, 0, name);
  });

  it('fails the check on a syntax error, in each format, unless it is silenced', () => {
    const args = ['--check', '--no-color', '-e', 'echo a\necho ok )\necho b'];
    for (const format of [[], ['--format', 'github'], ['--format', 'json'], ['--format', 'sarif']]) assert.strictEqual(run([...args, ...format]).code, 1, format.join(' '));
    assert.match(run(args).out, /^\(command\):2:9: error: \) cannot stand here: a syntax error\. If the shell reaches this line, it stops reading here, having run the commands it read in full before; the command this is in, and the others on the line where it starts, do not run \[syntax-error\]$/m);
    assert.match(run([...args, '--format', 'github']).out, /^::error file=.*,line=2,.*title=Bash Explainer%3A syntax-error::/m);
    const json = JSON.parse(run([...args, '--format', 'json']).out) as { code: string; severity: string; line: number; column: number }[];
    assert.deepStrictEqual(json.map((p) => [p.code, p.severity, p.line, p.column]), [['syntax-error', 'error', 2, 9]]);
    const sarif = JSON.parse(run([...args, '--format', 'sarif']).out) as { runs: { results: { ruleId: string; level: string }[] }[] };
    assert.deepStrictEqual(sarif.runs[0].results.map((r) => [r.ruleId, r.level]), [['syntax-error', 'error']]);
    // (A script left open; and as many formats of silence as other problems have.)
    assert.strictEqual(run(['--check', '-e', 'if true; then']).code, 1);
    assert.strictEqual(run(['--check', '-e', "echo 'a"]).code, 1);
    assert.strictEqual(run(['--check', '-e', '# bash-explainer disable=syntax-error\necho ok )']).code, 0);
    assert.strictEqual(run(['--check', '-e', 'echo ok )', '--set', 'diagnostics.ignore=["syntax-error"]']).code, 0);
    // (`diagnostics.pitfalls` off leaves an error. A host's code says none, and a file not surely a script, unless the user says it is.)
    assert.strictEqual(run(['--check', '-e', 'echo ok )', '--set', 'diagnostics.pitfalls=false']).code, 1);
    const file = path.join(dir, 'Dockerfile');
    fs.writeFileSync(file, 'FROM a\nRUN echo ok )\n');
    assert.strictEqual(run(['--check', '--no-color', file]).code, 0);
    const plain = path.join(dir, 'tool');
    fs.writeFileSync(plain, 'echo ok )\n');
    assert.strictEqual(run(['--check', plain]).code, 0);
    assert.strictEqual(run(['--check', '--shell', 'bash', plain]).code, 1);
    fs.writeFileSync(`${plain}.first.sh`, '#!/bin/bash\necho ok )\n');
    assert.strictEqual(run(['--check', `${plain}.first.sh`]).code, 1);
    fs.writeFileSync(`${plain}.after.sh`, '#!/bin/bash\nexit 0\necho ok )\n');
    assert.strictEqual(run(['--check', `${plain}.after.sh`]).code, 0);
    const md = path.join(dir, 'a.md');
    fs.writeFileSync(md, '```bash\ncp <from> <to>\necho ok )\n```\n');
    assert.strictEqual(run(['--check', md]).code, 0);
  });

  it('checks a script for its shell, and exits 1 on an error', () => {
    const r = run(['--check', '--no-color', '-e', '#!/bin/sh\n[[ -f x ]] && echo y']);
    assert.strictEqual(r.code, 1);
    // (The level is said once, by the severity: no "Error:" after it.)
    assert.match(r.out, /^\(command\):2:1: error: \[\[ \]\] is not POSIX sh.*\[dbracket\]$/m);
    // (In colour, the level's word in the level's colour: the level table.)
    assert.match(run(['--check', '--color', '-e', '#!/bin/sh\n[[ -f x ]] && echo y']).out, /^\(command\):2:1: \x1b\[31merror\x1b\[0m: /m);
    assert.strictEqual(run(['--check', '-e', '#!/bin/bash\n[[ -f x ]] && echo y']).code, 0);
    // In sh, what dash and busybox ash run (`local`, `echo -n`) is information, "Portability": it fails no check, even strict.
    const portable = ['--check', '--no-color', '-e', '#!/bin/sh\nf() { local v; echo -n x; }'];
    const p = run(portable);
    assert.strictEqual(p.code, 0);
    assert.match(p.out, /^\(command\):2:7: info: Portability: local is not POSIX sh \(dash and busybox ash accept it.*\[local\]$/m);
    assert.strictEqual(run([...portable, '--strict']).code, 0);
    const json = JSON.parse(run(['--check', '--format', 'json', '--shell', 'dash', '-e', '[[ -f x ]]']).out);
    assert.deepStrictEqual(json.map((i: { code: string }) => i.code), ['dbracket']);
  });

  it('names in JSON the habit a note advises, in the facts and the records of --check, unless `notes.basis` is off (docs/design/basis-spec-convention.md, step 5b)', () => {
    const src = 'f() { local v=$(false); read line; }';
    const facts = JSON.parse(run(['--format', 'json', '-e', src]).out)[0].explanation.facts;
    assert.deepStrictEqual(facts.map((f: { id: string; convention?: string }) => [f.id, f.convention]), [['declaration-masks-status', 'declare-then-assign']]);
    const check = JSON.parse(run(['--check', '--format', 'json', '-e', `${src}\n[-f x]`]).out);
    assert.deepStrictEqual(check.map((i: { code: string; convention?: string }) => [i.code, i.convention ?? null]), [
      ['declaration-masks-status', 'declare-then-assign'], ['read-without-r', 'read-r'], ['bracket-no-space', null],
    ]);
    const off = (args: string[]) => run([...args, '--set', 'notes.basis=false']).out;
    assert.doesNotMatch(off(['--format', 'json', '-e', src]), /convention/);
    assert.doesNotMatch(off(['--check', '--format', 'json', '-e', src]), /convention/);
  });

  it('--sarif writes the SARIF file from the same run that prints the annotations', () => {
    const file = path.join(dir, 'out.sarif');
    const both = run(['--check', '--format', 'github', '--sarif', file, fixture('posix.sh')]);
    const alone = run(['--check', '--format', 'sarif', fixture('posix.sh')]);
    assert.strictEqual(both.code, 1);
    assert.match(both.out, /^::error file=/m);
    assert.strictEqual(fs.readFileSync(file, 'utf8'), alone.out);
    assert.strictEqual(run(['--sarif', file, '-e', 'ls']).code, 2);
    const dash = run(['--check', '--sarif', '-', '-e', 'ls']);
    assert.strictEqual(dash.code, 2);
    assert.match(dash.err, /--sarif needs a file/);
    const bad = run(['--check', '--sarif', path.join(dir, 'no-such-dir', 'x.sarif'), '-e', 'ls']);
    assert.strictEqual(bad.code, 2);
    assert.match(bad.err, /cannot write/);
  });


  it('--check reports the error of a part of a line, in every format, with exit 1 (panel P7b)', () => {
    const line = 'echo $((09))';
    const text = run(['--check', '--lang', 'en', '-e', line]);
    assert.strictEqual(text.code, 1);
    assert.match(text.out, /\(command\):1:9: error: Invalid number 09: .* \[arith-invalid-number\]\n$/);
    // (`--strict` adds nothing to an error.)
    assert.strictEqual(run(['--check', '--strict', '-e', line]).code, 1);
    const gh = run(['--check', '--lang', 'en', '--format', 'github', '-e', line]);
    assert.strictEqual(gh.code, 1);
    assert.match(gh.out, /^::error file=\(command\),line=1,col=9,endLine=1,endColumn=11,title=Bash Explainer%3A arith-invalid-number::Invalid number 09/);
    // (An error is no pitfall: its annotation's title does not say so, and the Action counts it among the errors.)
    assert.doesNotMatch(gh.out, /pitfall/);
    const json = run(['--check', '--format', 'json', '-e', line]);
    assert.strictEqual(json.code, 1);
    assert.deepStrictEqual(JSON.parse(json.out).map((p: { severity: string; code: string; column: number }) => [p.severity, p.code, p.column]), [['error', 'arith-invalid-number', 9]]);
    const sarif = run(['--check', '--format', 'sarif', '-e', line]);
    assert.strictEqual(sarif.code, 1);
    const [one] = JSON.parse(sarif.out).runs;
    assert.deepStrictEqual(one.tool.driver.rules.map((r: { id: string }) => r.id), ['arith-invalid-number']);
    assert.deepStrictEqual(one.results.map((r: { ruleId: string; level: string }) => [r.ruleId, r.level]), [['arith-invalid-number', 'error']]);
    const counts = path.join(dir, 'token-counts');
    assert.strictEqual(run(['--check', '--counts', counts, '-e', line]).code, 1);
    assert.match(fs.readFileSync(counts, 'utf8'), /errors=1\nwarnings=0\ninfos=0\npitfalls=0\nfailing=1/);
    // (A file's shebang; a directive, or `diagnostics.ignore`, keeps a line.)
    const file = path.join(dir, 'env-e.sh');
    fs.writeFileSync(file, '#!/usr/bin/env bash -e\necho a\n');
    const shebang = run(['--check', '--lang', 'en', file]);
    assert.strictEqual(shebang.code, 1);
    assert.match(shebang.out, /:1:1: error: On Linux .* \[shebang-env-one-argument\]/);
    assert.strictEqual(run(['--check', '--strict', '-e', '# bash-explainer disable=arith-invalid-number\necho $((09))']).code, 0);
    assert.strictEqual(run(['--check', '--set', 'diagnostics.ignore=["arith-invalid-number"]', '-e', line]).code, 0);
    // (A warning of a part stays on its row: nothing to report, even with `--strict`.)
    assert.deepStrictEqual([run(['--check', '--strict', '-e', 'echo ${x:-$((09))}']).code, run(['--check', '--strict', '-e', 'echo $((10#09))']).code], [0, 0]);
  });

  it('writes problems as GitHub annotations or SARIF, in line order (for annotations, those that fail the check first)', () => {
    const gh = run(['--check', '--format', 'github', fixture('posix.sh')]);
    assert.strictEqual(gh.code, 1);
    const lines = gh.out.trim().split('\n');
    assert.match(lines[0], /^::error file=.*posix\.sh,line=3,col=1,endLine=3,endColumn=\d+,title=Bash Explainer%3A pipefail::set -o pipefail is not POSIX sh/);
    const fails = (l: string) => l.startsWith('::error ');
    const first = lines.filter(fails);
    assert.deepStrictEqual(lines.slice(0, first.length), first);
    for (const group of [first, lines.filter((l) => !fails(l))]) {
      const order = group.map((l) => Number(/line=(\d+)/.exec(l)![1]));
      assert.deepStrictEqual(order, [...order].sort((a, b) => a - b));
    }
    const sarif = JSON.parse(run(['--check', '--format', 'sarif', '--shell', 'dash', '-e', '[[ -f x ]]']).out);
    assert.strictEqual(sarif.version, '2.1.0');
    const [result] = sarif.runs[0].results;
    assert.deepStrictEqual([result.ruleId, result.level, result.locations[0].physicalLocation.region], ['dbracket', 'error', { startLine: 1, startColumn: 1, endLine: 1, endColumn: 11 }]);
    assert.strictEqual(run(['--format', 'sarif', '-e', 'ls']).code, 2);
  });

  it('shows the notes warnings first, with the mark and the word in the colour of their level', () => {
    const notes = (args: string[]) => run(['--no-config', ...args, '-e', 'exit 300; read line; source lib.sh']).out.split('\n').slice(1, 4);
    assert.deepStrictEqual(notes(['--no-color']).map((l) => l.slice(0, 12)), ['  ⚠ Pitfall:', '  ⓘ Caveat: ', '  ℹ An exit ']);
    const [warning, info, note] = notes(['--color']);
    assert.ok(warning.startsWith('  \x1b[33m\x1b[1m⚠ Pitfall:\x1b[0m\x1b[0m `source lib.sh`'), warning);
    assert.ok(info.startsWith('  \x1b[34m\x1b[1mⓘ Caveat:\x1b[0m\x1b[0m without `-r`'), info);
    // (A plain fact's mark is dim, with no word.)
    assert.ok(note.startsWith('  \x1b[90mℹ\x1b[0m An exit status'), note);
    // An error in red, first.
    const error = run(['--no-config', '--color', '-e', 'read line; [ -f a']).out.split('\n')[1];
    assert.ok(error.startsWith('  \x1b[31m\x1b[1mⓧ Error:\x1b[0m\x1b[0m `[` has no'), error);
  });

  it('reports the pitfalls, and fails on their warnings only with --strict', () => {
    const file = path.join(dir, 'pitfalls.sh');
    fs.writeFileSync(file, '#!/bin/bash\nfor f in $(ls); do echo "$f"; done\nrm -rf $DIR/*\nsource lib.sh\necho $y\nread line\n');
    const r = run(['--check', '--no-color', file]);
    assert.strictEqual(r.code, 0, r.out);
    const rows = r.out.trim().split('\n').map((l) => l.replace(/^.*pitfalls\.sh:/, ''));
    assert.deepStrictEqual(rows.map((l) => /^(\d+:\d+): (\w+): .* \[([\w-]+)\]$/.exec(l)!.slice(1).join(' ')), [
      '2:10 info for-over-ls-output', '3:8 warning rm-empty-variable-root', '3:8 warning unquoted-variable-as-path',
      '4:8 warning source-searches-path', '6:1 info read-without-r',
    ]);
    assert.match(rows[3], /^4:8: warning: Pitfall: source lib\.sh looks for lib\.sh in the directories of \$PATH first/);
    assert.strictEqual(run(['--check', '--strict', file]).code, 1);
    // Information alone does not fail it, even with --strict; nor what is turned off.
    fs.writeFileSync(file, 'read line\n');
    assert.strictEqual(run(['--check', '--strict', file]).code, 0);
    fs.writeFileSync(file, 'source lib.sh\n');
    assert.strictEqual(run(['--check', '--strict', '--set', 'diagnostics.pitfalls=false', file]).out, '');
    assert.strictEqual(run(['--check', '--strict', '--set', 'diagnostics.ignore=["source-searches-path"]', file]).code, 0);
    const usage = run(['--strict', file]);
    assert.strictEqual(usage.code, 2);
    assert.match(usage.err, /--strict goes with --check/);
    // SARIF and annotations: a warning and a note.
    fs.writeFileSync(file, 'source lib.sh\nread line\n');
    const sarif = JSON.parse(run(['--check', '--format', 'sarif', file]).out);
    assert.deepStrictEqual(sarif.runs[0].results.map((x: { ruleId: string; level: string }) => [x.ruleId, x.level]), [['source-searches-path', 'warning'], ['read-without-r', 'note']]);
    assert.deepStrictEqual(sarif.runs[0].tool.driver.rules.map((x: { id: string }) => x.id), ['read-without-r', 'source-searches-path']);
    const gh = run(['--check', '--format', 'github', file]);
    assert.strictEqual(gh.code, 0);
    assert.deepStrictEqual(gh.out.trim().split('\n').map((l) => l.split(' ')[0]), ['::warning', '::notice']);
    assert.match(gh.out, /,title=Bash Explainer \(pitfall\)%3A source-searches-path::/);
    // GitHub shows only the first annotations of a step: what fails the check comes first.
    fs.writeFileSync(file, '#!/bin/sh\n. lib.sh\n[[ -n $a ]]\n');
    const order = (args: string[]) => run([...args, '--format', 'github', file]).out.trim().split('\n').map((l) => /title=([^:]*)::/.exec(l)![1]);
    assert.deepStrictEqual(order(['--check']), ['Bash Explainer%3A dbracket', 'Bash Explainer (pitfall)%3A source-searches-path']);
    assert.deepStrictEqual(order(['--check', '--strict']), ['Bash Explainer (pitfall)%3A source-searches-path', 'Bash Explainer%3A dbracket']);
  });

  it('reports the errors, warnings and caveats of the explanations, with their codes and ranges, and no plain fact', () => {
    const file = path.join(dir, 'notes.sh');
    fs.writeFileSync(file, '#!/bin/bash\nf() {\n  local x=$(false)\n}\n[ -f a\nexit 300\n');
    const r = run(['--check', '--no-color', file]);
    // (An error of the explanations fails the check without --strict.)
    assert.strictEqual(r.code, 1, r.out);
    assert.deepStrictEqual(r.out.trim().split('\n').map((l) => /:(\d+:\d+): (\w+): .* \[([\w-]+)\]$/.exec(l)!.slice(1).join(' ')), ['3:3 info declaration-masks-status', '5:1 error bracket-missing-close']);
    // (The level said once: the severity of an error, with no "Error:" after it; a caveat keeps its word, which is no level's name.)
    assert.deepStrictEqual(r.out.trim().split('\n').map((l) => /: (\w+: \S+ \S+)/.exec(l)![1]), ['info: Caveat: the', 'error: [ has']);
    const json = JSON.parse(run(['--check', '--format', 'json', file]).out);
    assert.deepStrictEqual(json.map((x: { code: string; line: number; column: number; endColumn: number; severity: string }) => [x.code, x.severity, x.line, x.column, x.endColumn]),
      [['declaration-masks-status', 'info', 3, 3, 19], ['bracket-missing-close', 'error', 5, 1, 7]]);
    const sarif = JSON.parse(run(['--check', '--format', 'sarif', file]).out);
    assert.deepStrictEqual(sarif.runs[0].results.map((x: { ruleId: string; level: string }) => [x.ruleId, x.level]), [['declaration-masks-status', 'note'], ['bracket-missing-close', 'error']]);
    assert.deepStrictEqual([json[1].message, sarif.runs[0].results[1].message.text].map((m: string) => m.slice(0, 12)), ['[ has no ] a', '[ has no ] a']);
    // (An error is no pitfall: its annotation has no "(pitfall)" title, and it comes first.)
    const gh = run(['--check', '--format', 'github', file]).out.trim().split('\n');
    assert.deepStrictEqual(gh.map((l) => /^::(\w+) .*line=(\d+),.*title=([^:]*)::(\S+)/.exec(l)!.slice(1).join(' ')), ['error 5 Bash Explainer%3A bracket-missing-close [', 'notice 3 Bash Explainer (pitfall)%3A declaration-masks-status Caveat:']);
    // Said with the pitfalls off, in the explanations and in the problems.
    for (const off of ['notes.pitfalls=false', 'diagnostics.pitfalls=false']) {
      assert.deepStrictEqual(JSON.parse(run(['--check', '--format', 'json', '--set', off, file]).out).map((x: { code: string }) => x.code), ['bracket-missing-close'], off);
    }
    // (A style check at error too, `x = 1`: it fails the check with the pitfalls off.)
    for (const off of ['notes.pitfalls=false', 'diagnostics.pitfalls=false']) {
      const x = run(['--check', '--format', 'json', '--set', off, '-e', 'x = 1']);
      assert.deepStrictEqual([x.code, JSON.parse(x.out).map((i: { code: string }) => i.code)], [1, ['assignment-with-spaces']], off);
    }
    assert.strictEqual(run(['--check', '--set', 'diagnostics.ignore=["declaration-masks-status","bracket-missing-close"]', file]).out, '');
  });

  it('--counts appends the numbers of problems, as $GITHUB_OUTPUT reads them', () => {
    const file = path.join(dir, 'counts.sh');
    const out = path.join(dir, 'counts.txt');
    fs.writeFileSync(file, '#!/bin/bash\n[ -f a\nsource lib.sh\nread line\n');
    fs.writeFileSync(out, 'before=1\n');
    assert.strictEqual(run(['--check', '--counts', out, file]).code, 1);
    assert.strictEqual(run(['--check', '--strict', '--counts', out, '-e', 'source lib.sh']).code, 1);
    assert.strictEqual(fs.readFileSync(out, 'utf8'), 'before=1\nerrors=1\nwarnings=1\ninfos=1\npitfalls=2\nfailing=1\nerrors=0\nwarnings=1\ninfos=0\npitfalls=1\nfailing=1\n');
    assert.match(run(['--counts', out, file]).err, /--counts goes with --check/);
    const bad = run(['--check', '--counts', path.join(dir, 'no-such-dir', 'c.txt'), '-e', 'ls']);
    assert.strictEqual(bad.code, 2);
    assert.match(bad.err, /cannot write/);
  });

  it('takes the files after -- as files', () => {
    assert.strictEqual(run(['--check', '--', fixture('renderings.sh')]).code, 0);
  });

  it('reports usage errors with exit status 2', () => {
    assert.strictEqual(run(['--bogus']).code, 2);
    assert.strictEqual(run([path.join(dir, 'missing.sh')]).code, 2);
    assert.strictEqual(run([]).code, 2);
    const help = run(['--help']).out;
    assert.match(help, /^Usage: bash-explainer/);
    // (The GitHub Action reads what the tool can do from its help: --counts, and the exit status on an error.)
    assert.match(help, /--counts <file>/);
    assert.match(help, /exit 1 if there is an error\n/);
    assert.match(help, /is an error \(with --strict, also a warning\)/);
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
      assert.strictEqual(c([])['bashExplainer.bashVersion'], '5.2');
      assert.strictEqual(c(['--set', 'bashVersion=5.3'])['bashExplainer.bashVersion'], '5.3');
      assert.strictEqual(c(['--set', 'bashVersion=5.3', '--bash-version', '5.2'])['bashExplainer.bashVersion'], '5.2');
      assert.match(run(['--print-config', '--bash-version', '5.1']).err, /unknown bash version: 5\.1 \(5\.2, 5\.3\)/);
      // bash 5.3's `${ cmd; }`: a warning with bash 5.2 (the default), none with bash 5.3.
      assert.match(run(['--check', '--no-config', '-e', 'x=${ echo a; }']).out, /bash 5\.3 syntax: bash 5\.2 reports "bad substitution".*\[funsub\]/);
      assert.strictEqual(run(['--check', '--no-config', '--bash-version', '5.3', '-e', 'x=${ echo a; }']).code, 0);
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
      const docker = write(path.join(dir, 'Dockerfile'), 'FROM alpine\nRUN [[ -f x ]] && echo hi\n');
      assert.strictEqual(run(['--check', '--no-config', docker]).code, 1);
      assert.strictEqual(run(['--check', '--set', 'diagnostics.embedded=false', docker]).code, 0);
      // Notes, examples and your own commands.
      const loop = ['--no-config', '--no-color', '-e', 'for f in $(ls); do echo "$f"; done'];
      assert.match(run(loop).out, /\$\(ls\)/);
      const pitfall = (args: string[]) => run([...loop, ...args]).out.split('\n').filter((l) => /^ {2}[⚠ⓘ]/.test(l));
      assert.ok(pitfall([]).length > 0, run(loop).out);
      assert.deepStrictEqual(pitfall(['--set', 'notes.pitfalls=false']), []);
      const sed = ['--no-config', '--no-color', '-e', "echo a | sed 's/a/b/'"];
      assert.match(run(sed).out, /^ {2}\S.*sed/m);
      const titles = (args: string[]) => run([...sed, ...args]).out.split('\n').filter((l) => /^ {2}[^ ⚠ⓘℹ›]/.test(l) && !/^ {2}echo|^ {2}sed/.test(l));
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
  describe('control characters in what it reads', () => {
    // ESC (a whole sequence), CR, BEL, DEL and C1 characters: in a comment, a string, a word, a value, a line with a problem.
    const withControls = '#!/bin/sh\n# a\x1b[2Jb\x07\n'
      + 'echo "c\x1b]0;title\x07d\re\x9bf\x7fg" \x1b[31mred\x85\n'
      + 'x=$\'h\\x1b[2Ji\'; echo "$x"\n'
      + 'if [[ -n \x1b[31m ]]; then rm -rf "$y\x9b"/*; fi\n';
    // Newline and tab lay the text out; anything else is the script's.
    const raw = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/;
    const file = () => path.join(dir, 'ctl\x1b[2Jname\x9b.sh');
    const noRaw = (r: { out: string; err: string }, what: string) => {
      assert.doesNotMatch(r.out, raw, `${what}: ${JSON.stringify(r.out)}`);
      assert.doesNotMatch(r.err, raw, `${what}: ${JSON.stringify(r.err)}`);
    };

    before(() => fs.writeFileSync(file(), withControls));

    for (const [what, args] of [
      ['text', []],
      ['Markdown', ['--format', 'markdown']],
      ['JSON', ['--format', 'json']],
      ['the check as text', ['--check']],
      ['the check as JSON', ['--check', '--format', 'json']],
      ['the check as SARIF', ['--check', '--format', 'sarif']],
      ['the check as annotations', ['--check', '--format', 'github']],
      ['the check, with a line of the file', ['--check', '--format', 'github', '--strict', '--line', '4']],
    ] as [string, string[]][]) {
      it(`leaves none of them raw in ${what}`, () => {
        const r = run([...args, '--no-color', file()]);
        assert.ok(r.code === 0 || r.code === 1, r.err);
        assert.ok(r.out.length > 0, what);
        noRaw(r, what);
      });
    }

    it('keeps each annotation on a line of its own', () => {
      const lines = run(['--check', '--format', 'github', file()]).out.trimEnd().split('\n');
      assert.ok(lines.length > 1);
      for (const l of lines) assert.match(l, /^::(error|warning|notice) file=[^ ]*ctl<ESC>\[2Jname<U\+009B>\.sh,line=\d+,/, l);
    });

    it('reads the same from a command line and from standard input', () => {
      noRaw(run(['-e', withControls.split('\n')[2], '--no-color']), '-e');
      noRaw(run(['-', '--no-color'], { input: withControls }), 'stdin');
      noRaw(run(['-', '--check', '--no-color'], { input: withControls }), 'stdin, the check');
    });

    it('writes those of a script and of its name in the form of the examples, as `<ESC>`', () => {
      const r = run(['--no-color', '--line', '3', file()]);
      assert.ok(r.out.includes('ctl<ESC>[2Jname<U+009B>.sh:3'), r.out);
      assert.ok(r.out.includes(`echo "c<ESC>]0;title<BEL>d<CR>e<U+009B>f<DEL>g" <ESC>[31mred<U+0085>`), r.out);
    });

    it('keeps the data in JSON and SARIF: the same text once it is read', () => {
      const lines = JSON.parse(run(['--format', 'json', file()]).out) as { file: string; text: string }[];
      assert.strictEqual(lines[0].file, file());
      assert.strictEqual(lines.find((l) => l.text.startsWith('echo'))!.text, withControls.split('\n')[2]);
      assert.ok(JSON.parse(run(['--check', '--format', 'sarif', file()]).out).runs[0].results.some((x: { locations: { physicalLocation: { artifactLocation: { uri: string } } }[] }) => x.locations[0].physicalLocation.artifactLocation.uri === file()));
      const written = path.join(dir, 'ctl.sarif');
      run(['--check', '--sarif', written, '--format', 'github', file()]);
      assert.doesNotMatch(fs.readFileSync(written, 'utf8').replace(/\n/g, ''), raw);
    });

    it('writes only its own colours with --color', () => {
      for (const args of [[], ['--check']]) {
        const r = run([...args, '--color', file()]);
        assert.match(r.out, /\x1b\[\d+m/, 'colours are on');
        assert.strictEqual(r.err, '');
        // Each of its own is a colour; the text's are written out, whatever they are.
        assert.doesNotMatch(r.out.replace(/\x1b\[[\d;]+m/g, ''), raw);
        assert.ok(r.out.includes('<ESC>[2Jname'), r.out);
        for (const code of r.out.matchAll(/\x1b\[([\d;]+)m/g)) assert.match(code[1], /^(0|1|2;3|3[1-5]|9[01])$/);
      }
      assert.ok(run(['--color', '--line', '3', file()]).out.includes('<ESC>[31mred<U+0085>'));
    });

    it('leaves none in what it says of a file it cannot read, or of an argument', () => {
      const r = run(['/nonexistent/a\x1b[2Jb\x9b.sh']);
      assert.strictEqual(r.code, 2);
      assert.match(r.err, /cannot read \/nonexistent\/a<ESC>\[2Jb<U\+009B>\.sh/);
      noRaw(r, 'a file');
      noRaw(run(['--bad\x1b[2J']), 'an option');
      noRaw(run(['--set', 'shell=\x1b[2J', '-e', 'ls']), 'a setting');
      noRaw(run(['--print-config', '--set', 'shell=\x1b[2J']), 'the settings');
    });

    it('leaves none in the messages of the Language Server', () => {
      const message = (m: unknown) => { const json = JSON.stringify(m); return `Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`; };
      const uri = 'file:///a.sh';
      const r = spawnSync(process.execPath, [cli, '--lsp'], {
        encoding: 'utf8',
        env: { PATH: process.env.PATH },
        timeout: 30000,
        input: [
          message({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { capabilities: {} } }),
          message({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: { textDocument: { uri, languageId: 'shellscript', version: 1, text: withControls } } }),
          message({ jsonrpc: '2.0', id: 2, method: 'textDocument/hover', params: { textDocument: { uri }, position: { line: 2, character: 1 } } }),
          message({ jsonrpc: '2.0', id: 3, method: 'shutdown' }),
          message({ jsonrpc: '2.0', method: 'exit' }),
        ].join(''),
      });
      const bodies = r.stdout.split(/Content-Length: \d+\r\n\r\n/).filter(Boolean);
      assert.ok(bodies.length >= 3, r.stdout);
      for (const b of bodies) assert.doesNotMatch(b, raw);
      assert.doesNotMatch(r.stderr, raw);
      assert.ok(bodies.some((b) => (JSON.parse(b) as { id?: number }).id === 2), 'the hover was answered');
    });

    it('gives the columns of the real text', () => {
      // (Each character counts one, as in an editor, however it is written out.)
      const script = path.join(dir, 'ctl-column.sh');
      fs.writeFileSync(script, '#!/bin/sh\necho "\x1b[31m"; [[ -n $x ]]\n');
      const plainScript = path.join(dir, 'ctl-column-plain.sh');
      fs.writeFileSync(plainScript, '#!/bin/sh\necho "12345"; [[ -n $x ]]\n');
      const at = (f: string) => /^[^\n]*?:(\d+):(\d+): error: [^\n]*\[dbracket\]$/m.exec(run(['--check', '--no-color', f]).out)!.slice(1);
      assert.deepStrictEqual(at(script), at(plainScript));
    });

    it('prints ordinary text as it is, Japanese too', () => {
      const r = run(['--no-color', '--lang', 'ja', '-e', 'echo "日本語\té" # コメント']);
      assert.ok(r.out.includes('echo "日本語\té" # コメント'), r.out);
      assert.doesNotMatch(r.out, /<(ESC|TAB|U\+)/);
    });
  });
  describe('a newline in a file name', () => {
    const name = () => path.join(dir, 'x\n::error title=a::b\nx.sh:1:1: error: text [code]\n.sh');
    const shown = 'x<LF>::error title=a::b<LF>x.sh:1:1: error: text [code]<LF>.sh';
    const oneLineEach = (text: string, what: string) => {
      // (Annotations encode `:` and `,` in a name as well.)
      assert.ok(text.replace(/%3A/g, ':').replace(/%2C/g, ',').includes(shown), `${what}: ${JSON.stringify(text)}`);
      assert.doesNotMatch(text, /^(::error title=a|x\.sh:1:1)/m, what);
    };
    before(() => fs.writeFileSync(name(), '#!/bin/sh\nif [[ -n $x ]]; then echo "$x"; fi\n'));

    for (const [what, args] of [
      ['text', ['--no-color']],
      ['colours', ['--color']],
      ['Markdown', ['--format', 'markdown']],
      ['the check as text', ['--check', '--no-color']],
      ['the check in colour', ['--check', '--color']],
      ['the check as annotations', ['--check', '--format', 'github']],
    ] as [string, string[]][]) {
      it(`is shown visibly in ${what}`, () => oneLineEach(run([...args, '--', name()]).out, what));
    }

    it('is kept in JSON and SARIF, where it is data', () => {
      const lines = JSON.parse(run(['--format', 'json', '--', name()]).out) as { file: string }[];
      assert.strictEqual(lines[0].file, name());
      assert.strictEqual((JSON.parse(run(['--check', '--format', 'json', '--', name()]).out) as { file: string }[])[0].file, name());
      assert.strictEqual(JSON.parse(run(['--check', '--format', 'sarif', '--', name()]).out).runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri, name());
    });

    it('is shown visibly in what it says of a file it cannot read, a line it lacks, or a file it cannot write', () => {
      const missing = path.join(dir, 'gone\n::error title=a::b\n');
      const a = run(['--check', '--', missing]);
      assert.strictEqual(a.code, 2);
      assert.doesNotMatch(a.err, /^::error/m);
      assert.ok(a.err.includes('gone<LF>::error title=a::b<LF>'), a.err);
      const b = run([`--line=99`, '--', name()]);
      assert.strictEqual(b.code, 2);
      oneLineEach(b.err, 'a line it lacks');
      for (const option of ['--sarif', '--counts']) {
        const c = run(['--check', option, path.join(missing, 'r'), '--', fixture('renderings.sh')]);
        assert.strictEqual(c.code, 2, c.err);
        assert.doesNotMatch(c.err, /^::error/m, option);
      }
    });

    it('keeps a problem on one line, whatever the script\'s text holds', () => {
      const r = run(['--check', '--no-color', '-'], { input: '#!/bin/bash\nx = "a\nx.sh:1:1: error: text [code]"\n' });
      assert.doesNotMatch(r.out, /^x\.sh:1:1/m);
      assert.ok(r.out.includes('a<LF>x.sh:1:1: error: text [code]'), r.out);
      for (const l of r.out.trimEnd().split('\n')) assert.match(l, /^-:\d+:\d+: /);
    });

    it('leaves the newlines of the tool itself', () => {
      assert.ok(run(['--check', '--no-color', '--', fixture('posix.sh')]).out.trimEnd().split('\n').length > 1);
    });
  });

  describe('the files it writes', () => {
    const problems = '#!/bin/sh\nif [[ -n $x ]]; then echo "$x"; fi\n';
    let script = '';
    let at = '';
    before(() => {
      at = fs.mkdtempSync(path.join(dir, 'written-'));
      script = path.join(at, 'a.sh');
      fs.writeFileSync(script, problems);
    });
    for (const [option, kept] of [['--sarif', '"version"'], ['--counts', 'errors=']]) {
      it(`does not write ${option} through a link at its path`, () => {
        const target = path.join(at, `target${option}`);
        fs.writeFileSync(target, 'original\n');
        const link = path.join(at, `link${option}`);
        fs.symlinkSync(target, link);
        const r = run(['--check', option, link, '--', script]);
        assert.strictEqual(r.code, 2, r.err);
        assert.match(r.err, /is a symbolic link/);
        assert.strictEqual(fs.readFileSync(target, 'utf8'), 'original\n');
        assert.strictEqual(fs.lstatSync(link).isSymbolicLink(), true);
      });

      it(`does not create what a dangling link at the path of ${option} names`, () => {
        const link = path.join(at, `dangling${option}`);
        fs.symlinkSync(path.join(at, `new${option}`), link);
        assert.strictEqual(run(['--check', option, link, '--', script]).code, 2);
        assert.strictEqual(fs.existsSync(path.join(at, `new${option}`)), false);
      });

      it(`writes ${option} to a new file, to a device, and through a directory that is a link`, () => {
        const file = path.join(at, `new-file${option}`);
        assert.strictEqual(run(['--check', option, file, '--', script]).code, 1);
        assert.ok(fs.readFileSync(file, 'utf8').includes(kept));
        assert.strictEqual(run(['--check', option, '/dev/null', '--', script]).code, 1);
        fs.mkdirSync(path.join(at, `real${option}`));
        fs.symlinkSync(path.join(at, `real${option}`), path.join(at, `dir${option}`));
        assert.strictEqual(run(['--check', option, path.join(at, `dir${option}`, 'f'), '--', script]).code, 1);
        assert.ok(fs.readFileSync(path.join(at, `real${option}`, 'f'), 'utf8').includes(kept));
      });
    }

    it('replaces the content of a --sarif file, and adds to a --counts file', () => {
      const sarif = path.join(at, 'old.sarif');
      fs.writeFileSync(sarif, 'x'.repeat(100000));
      run(['--check', '--sarif', sarif, '--', script]);
      assert.ok(JSON.parse(fs.readFileSync(sarif, 'utf8')).runs);
      const counts = path.join(at, 'old.counts');
      fs.writeFileSync(counts, 'before=1\n');
      run(['--check', '--counts', counts, '--', script]);
      assert.match(fs.readFileSync(counts, 'utf8'), /^before=1\nerrors=/);
    });
  });

  describe('names after --', () => {
    const script = '#!/bin/sh\nif [[ -n $x ]]; then echo "$x"; fi\n';
    let at = '';
    const inDir = (args: string[], input?: string) => {
      const r = spawnSync(process.execPath, [cli, ...args], { cwd: at, input, encoding: 'utf8', env: { PATH: process.env.PATH }, timeout: 30000 });
      return { code: r.status, out: r.stdout, err: r.stderr };
    };
    before(() => {
      at = fs.mkdtempSync(path.join(dir, 'names-'));
      for (const f of ['--lsp', '-']) fs.writeFileSync(path.join(at, f), script);
    });

    it('reads a file named --lsp, and does not start the Language Server', () => {
      const r = inDir(['--check', '--format', 'github', '--', '--lsp']);
      assert.strictEqual(r.code, 1, r.err);
      assert.match(r.out, /^::error file=--lsp,line=2,/m);
    });

    it('takes --lsp as the value of an option', () => {
      const r = inDir(['--no-color', '-e', '--lsp']);
      assert.strictEqual(r.code, 0, r.err);
      assert.match(r.out, /^\(command\):1 {2}--lsp$/m);
    });

    it('reads a file named -, and standard input for a - before --', () => {
      const r = inDir(['--check', '--format', 'github', '--', '-'], 'echo hi\n');
      assert.strictEqual(r.code, 1, r.err);
      assert.match(r.out, /^::error file=-,line=2,/m);
      assert.strictEqual(inDir(['--check', '-'], 'echo hi\n').code, 0);
    });

    it('still says an option is unknown without --lsp, and takes --stdio with it', () => {
      assert.strictEqual(inDir(['--stdio', '-e', 'ls']).code, 2);
      for (const args of [['--lsp', '--stdio'], ['--stdio', '--lsp'], ['--lsp', '--some-option=1']]) {
        const json = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { capabilities: {} } });
        const exit = JSON.stringify({ jsonrpc: '2.0', method: 'exit' });
        const r = inDir(args, `Content-Length: ${json.length}\r\n\r\n${json}Content-Length: ${exit.length}\r\n\r\n${exit}`);
        assert.match(r.out, /"capabilities"/, args.join(' '));
      }
    });
  });

  describe('text a CI log reads as a command', () => {
    const script = 'echo "##[error]a ###[b"\n';
    it('is written otherwise in text, Markdown and standard error', () => {
      for (const args of [['--no-color'], ['--format', 'markdown'], ['--color']]) {
        const r = run([...args, '-e', script.trimEnd()]);
        assert.doesNotMatch(r.out, /##\[/, args.join(' '));
        assert.ok(r.out.includes('##\\[error]a ###\\[b'), r.out);
      }
      const missing = run(['--check', '--', '##[error]x.sh']);
      assert.strictEqual(missing.code, 2);
      assert.doesNotMatch(missing.err, /##\[/);
      assert.ok(missing.err.includes('cannot read ##\\[error]x.sh'), missing.err);
      const json = run(['--format', 'json', '--', '##[error]x.sh']);
      assert.doesNotMatch(json.err, /##\[/);
    });

    it('is written otherwise in a problem and a file name of the check as text', () => {
      const f = path.join(dir, '##[error]y.sh');
      fs.writeFileSync(f, '#!/bin/sh\nif [[ -n $x ]]; then echo; fi\n');
      const r = run(['--check', '--no-color', '--', f]);
      assert.strictEqual(r.code, 1, r.err);
      assert.doesNotMatch(r.out, /##\[/);
      assert.ok(r.out.includes('##\\[error]y.sh:2:'), r.out);
    });

    it('stays in JSON and SARIF, which are data, and in annotations', () => {
      const f = path.join(dir, '##[error]z.sh');
      fs.writeFileSync(f, '#!/bin/sh\nif [[ -n $x ]]; then echo; fi\n');
      assert.strictEqual((JSON.parse(run(['--check', '--format', 'json', '--', f]).out) as { file: string }[])[0].file, f);
      assert.strictEqual(JSON.parse(run(['--check', '--format', 'sarif', '--', f]).out).runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri, f);
      assert.match(run(['--check', '--format', 'github', '--', f]).out, /^::error file=[^ ]*##\[error\]z\.sh,/m);
      assert.ok((JSON.parse(run(['--format', 'json', '-e', script.trimEnd()]).out) as { text: string }[])[0].text.includes('##[error]a'));
    });
  });
});
