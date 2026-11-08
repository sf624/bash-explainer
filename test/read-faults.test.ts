// What says a fault of a script follows one table of what may stop a shell (src/semantics/scriptstops.ts; docs/design/three-levels.md, "Where a shell stops").
// The Errors that say the shell reads the text wrongly (`x = 1`, `{ echo a }`, `if a then b; fi`, `[-f x]`, `[ a > b ]`, `$((09))`): an Error where the file
// is said to be a script, a warning with the same words where only a name says so or a stop may come first, nothing after a sure stop, in
// a polyglot's other language, or in a file nobody says is a script. The Errors that are a fact of one command (`[` without its `]`) stay Errors
// but after a sure stop; one of the dialect (`print` in sh) is a warning after a stop that may come first. A false Error fails someone's CI, and silence loses what the tool finds. Compared with real
// shells (bash, dash), and with the command-line tool's exit status.
import * as assert from 'assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { documentIssues } from '../src/document';
import { type FileKind, openDocument, shellsOf } from '../src/document-setup';
import { hostKind } from '../src/hosts';
import type { ScriptEvidence } from '../src/dialect';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { main } from '../cli/main';

const parser = createUnbashParser();

interface Fault {
  code: string;
  text: string;
  tool: 'bash' | 'dash';
  /** What the shell does with it: `-n` fails, or the run says `fails`, or misses `misses`, or prints no `ok`. */
  rejects?: boolean;
  fails?: RegExp;
  misses?: string;
  /** The Error is a fact of one command or of the dialect, not a reading of the text: said wherever the shell gets to it. */
  fact?: true;
}

const FAULTS: Fault[] = [
  { code: 'assignment-with-spaces', text: 'x = 1\n', tool: 'bash', fails: /x: (command )?not found/ },
  { code: 'brace-no-space', text: '{echo ok;}\n', tool: 'bash', rejects: true },
  { code: 'brace-close-no-separator', text: '{ echo ok }\n', tool: 'bash', rejects: true },
  { code: 'keyword-needs-separator', text: 'if true then echo ok; fi\n', tool: 'bash', rejects: true },
  { code: 'bracket-no-space', text: '[-f /etc/passwd] && echo ok\n', tool: 'bash', fails: /\[-f: (command )?not found/ },
  { code: 'redirect-in-bracket', text: 'if [ a > b ]; then echo true; else echo false-as-meant; fi\n', tool: 'bash', misses: 'false-as-meant' },
  { code: 'and-or-in-bracket', text: 'if [ 1 && 2 ]; then echo ok; fi\n', tool: 'bash', fails: /missing .\]/ },
  { code: 'bracket-close-glued', text: 'if [ -f /etc/passwd]; then echo ok; fi\n', tool: 'bash', fails: /missing .\]/ },
  { code: 'arith-invalid-number', text: 'echo $((09))\n', tool: 'bash', fails: /value too great for base/ },
  { code: 'bracket-missing-close', text: 'if [ -f /etc/passwd; then echo ok; fi\n', tool: 'bash', fails: /missing .\]/, fact: true },
  { code: 'print', text: '#!/bin/sh\nprint ok\n', tool: 'dash', fails: /print: (command )?not found/, fact: true },
];

const HAS_DASH = spawnSync('dash', ['-c', ':']).status === 0;

/** The severities of the problems with the code `f.code` that a text has, as `--check` reports them. */
function problems(f: Fault, text: string, name: string, given?: ScriptEvidence): string[] {
  const doc = openDocument(text, 'shell', (t) => parser.parse(t));
  // (A token's error has a code of its own where only a name says the file is a script: `arith-invalid-number-if-bash`.)
  return documentIssues(doc, 'en', shellsOf(doc.lines, name, undefined, given)).filter((i) => i.code.replace(/-if-bash$/, '') === f.code).map((i) => String(i.severity));
}

const withShebang = (f: Fault): string => (f.text.startsWith('#!') ? f.text : `#!/bin/${f.tool === 'dash' ? 'sh' : 'bash'}\n${f.text}`);
const withoutShebang = (f: Fault): string => f.text.replace(/^#!.*\n/, '');
/** The script with the command `stop` before the fault. */
const after = (f: Fault, stop: string): string => `${withShebang(f).split('\n', 1)[0]}\n${stop}\n${withoutShebang(f)}`;
/** The exit status of `--check` (`--strict` or not) on a file `name` holding `text`, in `dir`. */
async function check(dir: string, text: string, name: string, ...flags: string[]): Promise<number> {
  const file = path.join(dir, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return main(['--check', '--no-config', ...flags, file], { stdout: () => {}, stderr: () => {}, env: { PATH: process.env.PATH }, isTTY: false });
}

const PIP = '#!/bin/sh\n\'\'\'exec\' "/x/python" "$0" "$@"\n\' \'\'\'\n# -*- coding: utf-8 -*-\nimport re\nimport sys\nfrom pip._internal.cli.main import main\nx = [1, 2]\nif x[0] > 1 and x[1] < 2:\n    print(x)\nif __name__ == \'__main__\':\n    sys.argv[0] = re.sub(r\'(-script\\.pyw|\\.exe)?$\', \'\', sys.argv[0])\n    sys.exit(main())\n';

describe('an Error that says the shell reads the text wrongly follows the rule of the syntax error', function () {
  this.timeout(120000);

  it('is a fault in a real shell: bash or dash rejects the script, or the line fails when it runs', function () {
    if (!HAS_DASH) this.skip();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bash-explainer-read-faults-'));
    try {
      for (const f of FAULTS) {
        const file = path.join(dir, f.code);
        fs.writeFileSync(file, withShebang(f));
        if (f.rejects) assert.notStrictEqual(spawnSync(f.tool, ['-n', file], { encoding: 'utf8' }).status, 0, `${f.tool} -n accepts ${f.code}`);
        else {
          const run = spawnSync(f.tool, [file], { encoding: 'utf8', input: '', cwd: dir, env: { PATH: process.env.PATH, FUNCNEST: '50' }, timeout: 10000 });
          if (f.fails) assert.match(run.stderr, f.fails, `${f.tool} ${f.code}: ${run.status} ${run.stderr}`);
          if (f.misses) assert.ok(!run.stdout.includes(f.misses), `${f.code}: ${run.stdout}`);
          else assert.doesNotMatch(run.stdout, /^ok$/m, f.code);
        }
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a plain script with a first line keeps the Error', () => {
    for (const f of FAULTS) assert.deepStrictEqual(problems(f, withShebang(f), 'a.sh'), ['error'], f.code);
  });

  it('a name alone (`.sh`, no first line) says a reading as a warning, with the same words but for the shell it names; a fact of a command keeps its Error', () => {
    for (const f of FAULTS.filter((x) => !x.text.startsWith('#!'))) {
      assert.deepStrictEqual(problems(f, withoutShebang(f), 'a.sh'), [f.fact ? 'error' : 'warning'], f.code);
      if (f.fact) continue;
      const message = (s: ScriptEvidence) => {
        const doc = openDocument(withoutShebang(f), 'shell', (t) => parser.parse(t));
        return documentIssues(doc, 'en', shellsOf(doc.lines, 'a.sh', undefined, s)).find((i) => i.code.replace(/-if-bash$/, '') === f.code)!.message.replace(/^\S+ (?:Error: |Pitfall: )?/, '');
      };
      // (Of `$((09))`, what bash does: zsh reads `09`, and may source the file.)
      if (f.code === 'arith-invalid-number') assert.match(message('name'), /If the shell reaches this line, it reports/);
      else assert.strictEqual(message('name'), message('said'), f.code);
    }
  });

  // (Builtins that dash and busybox ash lack stop nothing in a sh script: they say `logout: not found` and go on, as the stops read it.)
  const lacksInSh = (f: Fault, stop: string): boolean => f.tool === 'dash' && /logout|shopt/.test(stop);

  it('says nothing after a sure stop', () => {
    for (const f of FAULTS) {
      for (const stop of ['exit 0', 'exec true', 'command exec x', '{ exec x "$0"; }', 'exec x || exit 1', 'logout', 'return 0', 'set -n', "eval 'exec x'", 'if a; then exec bash "$self"; else exec "$PYTHON" "$0"; fi']) {
        assert.deepStrictEqual(problems(f, after(f, stop), 'a.sh'), lacksInSh(f, stop) ? ['error'] : [], `${f.code} after ${stop}`);
      }
    }
  });

  it('says nothing on what the model says never runs, in a tree with no error', () => {
    for (const f of FAULTS.filter((x) => x.tool === 'bash' && !parser.parse(x.text).errors.length)) {
      for (const stop of ['if true; then exit; fi', '{ exit 0; }', 'while :; do :; done', 'if a; then exit; else exit; fi']) {
        assert.deepStrictEqual(problems(f, after(f, stop), 'a.sh'), [], `${f.code} after ${stop}`);
      }
      assert.deepStrictEqual(problems(f, `#!/bin/bash\nif false; then\n${f.text}fi\n`, 'a.sh'), [], `${f.code} in a branch not taken`);
    }
  });

  // (A fact of one command keeps its Error; one of the dialect does not: three-levels.md, section 10, item 2.)
  const keepsError = (f: { code: string; fact?: boolean }): boolean => !!f.fact && f.code !== 'print';

  it('after a stop that may come first, says a reading as a warning and keeps the Error of a command', () => {
    const stops = ['source ./lib.sh', '. ./lib.sh', "trap 'rm -f t' EXIT", '[ -f y ] || exit 1', 'f() { exit 1; }', '$cmd a', 'eval "$x"', 'alias a=b', 'shopt -s nullglob', 'kill -0 1', 'if a; then logout; fi', '(exit 0)'];
    for (const f of FAULTS) {
      for (const stop of stops) {
        // (`x` may be a function of the file sourced: `runsCommand`, src/pitfalls.ts.)
        const none = f.code === 'assignment-with-spaces' && /^(?:source|\.)/.test(stop);
        assert.deepStrictEqual(problems(f, after(f, stop), 'a.sh'), none ? [] : [keepsError(f) || lacksInSh(f, stop) ? 'error' : 'warning'], `${f.code} after ${stop}`);
      }
    }
  });

  it('a warning says "if it reaches this line" where the row would claim more', () => {
    const issue = (text: string, code: string) => {
      const doc = openDocument(text, 'shell', (t) => parser.parse(t));
      return documentIssues(doc, 'en', shellsOf(doc.lines, 'a', undefined)).find((i) => i.code === code)!;
    };
    assert.match(issue('#!/bin/bash\ntrap a EXIT\nif a then b; fi\n', 'keyword-needs-separator').message, /if it reaches this line, bash reports/);
    assert.match(issue('#!/bin/bash\ntrap a EXIT\nif a then b; fi\n', 'keyword-needs-separator').head, /if it reaches this line/);
    assert.match(issue('#!/bin/bash\ntrap a EXIT\necho $((09))\n', 'arith-invalid-number-if-bash').message, /If the shell reaches this line, it reports an arithmetic error/);
    assert.match(issue('#!/bin/bash\ntrap a EXIT\necho $((09))\n', 'arith-invalid-number-if-bash').head, /if the shell reaches this line/);
    assert.match(issue('#!/bin/bash\ntrap a EXIT\nfi\n', 'syntax-error-if-bash').message, /If the shell reaches this line/);
    assert.strictEqual(issue('#!/bin/bash\ntrap a EXIT\nfi\n', 'syntax-error-if-bash').severity, 'warning');
  });

  it('what stops nothing leaves the Error', () => {
    for (const f of FAULTS) {
      for (const stop of ['exec 3>&1', 'set -- "$x"', 'command -v "$x"', 'set -e']) assert.deepStrictEqual(problems(f, after(f, stop), 'a.sh'), ['error'], `${f.code} after ${stop}`);
    }
  });

  it('a token that says a problem, and a string of another shell, are said as far as the shell gets', () => {
    const codes = (text: string) => {
      const doc = openDocument(text, 'shell', (t) => parser.parse(t));
      return documentIssues(doc, 'en', shellsOf(doc.lines, 'a', undefined)).filter((i) => i.severity === 'error').map((i) => i.code);
    };
    assert.deepStrictEqual(codes('#!/bin/bash\nenv -S\'"a\' s\n'), ['splice-refused']);
    assert.deepStrictEqual(codes('#!/bin/bash\nexit 0\nenv -S\'"a\' s\n'), []);
    assert.deepStrictEqual(codes('#!/bin/bash\ntrap a EXIT\nenv -S\'"a\' s\n'), ['splice-refused']);
    const nested = codes('#!/bin/bash\nsh -c \'[[ a = a ]]\'\n');
    assert.ok(nested.length > 0);
    assert.deepStrictEqual(codes('#!/bin/bash\nexit 0\nsh -c \'[[ a = a ]]\'\n'), []);
    assert.deepStrictEqual(codes('#!/bin/bash\nsh -c \'exit 0; [[ a = a ]]\'\n'), []);
    // (A dialect Error is one only where the shell surely gets there: three-levels.md, section 10, item 2.)
    assert.deepStrictEqual(codes('#!/bin/bash\ntrap a EXIT\nsh -c \'[[ a = a ]]\'\n'), []);
  });

  it('a syntax error at the end of a file is at its own place', () => {
    const doc = openDocument('#!/bin/bash\necho a\nf()\n\n', 'shell', (t) => parser.parse(t));
    assert.deepStrictEqual(documentIssues(doc, 'en', shellsOf(doc.lines, 'a', undefined)).filter((i) => i.code === 'syntax-error').map((i) => i.startLine), [2]);
  });

  it('says a reading nowhere in a file no one says is a script; a fact of a command it says as it did', () => {
    for (const f of FAULTS.filter((x) => !x.text.startsWith('#!'))) assert.deepStrictEqual(problems(f, withoutShebang(f), 'noname'), f.fact ? ['error'] : [], f.code);
  });

  it('says nothing in the Python of a polyglot after `exec`, as pip\'s wrapper has it', () => {
    for (const f of FAULTS) {
      assert.deepStrictEqual(problems(f, PIP, 'pip3'), [], f.code);
      assert.deepStrictEqual(problems(f, PIP.replace('#!/bin/sh', '#!/bin/bash'), 'pip3'), [], f.code);
    }
    // (What the shells do with it: they run `exec` first, and the Python is never read.)
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bash-explainer-read-faults-'));
    try {
      const file = path.join(dir, 'pip');
      fs.writeFileSync(file, PIP.replace('/x/python', 'true'));
      for (const sh of HAS_DASH ? ['bash', 'dash'] : ['bash']) assert.strictEqual(spawnSync(sh, [file], { encoding: 'utf8' }).status, 0, sh);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a string a command runs is as sure as the command: `bash -c \'x = 1\'` after an `exit` says nothing, and after a `trap` a warning', () => {
    const f = FAULTS[0];
    assert.deepStrictEqual(problems(f, '#!/bin/bash\nbash -c \'x = 1\'\n', 'a.sh'), ['error']);
    assert.deepStrictEqual(problems(f, '#!/bin/bash\nexit 0\nbash -c \'x = 1\'\neval "x = 1"\n', 'a.sh'), []);
    assert.deepStrictEqual(problems(f, 'bash -c \'x = 1\'\n', 'noname'), []);
    assert.deepStrictEqual(problems(f, 'bash -c \'x = 1\'\n', 'a.sh'), ['warning']);
    assert.deepStrictEqual(problems(f, '#!/bin/bash\ntrap a EXIT\nbash -c \'x = 1\'\n', 'a.sh'), ['warning']);
    assert.deepStrictEqual(problems(f, '#!/bin/bash\nbash -c \'trap a EXIT; x = 1\'\n', 'a.sh'), ['warning']);
    assert.deepStrictEqual(problems(f, '#!/bin/bash\nbash -c \'exit 0; x = 1\'\n', 'a.sh'), []);
  });

  describe('in a host, whose code is the shell\'s whole input, by the shell of the line', () => {
    const issues = (text: string, name: string, code = 'assignment-with-spaces') => {
      const doc = openDocument(text, hostKind('', name, text) as FileKind, (t) => parser.parse(t));
      return documentIssues(doc, 'en', shellsOf(doc.lines, name, undefined)).filter((i) => i.code === code).map((i) => [i.startLine, String(i.severity)]);
    };
    const WORKFLOW = 'on: push\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: |\n';

    it('with no stop, an Error', () => {
      assert.deepStrictEqual(issues('FROM x\nRUN x = 1\n', 'Dockerfile'), [[1, 'error']]);
      assert.deepStrictEqual(issues('text\n\n```bash\nx = 1\n```\n', 'a.md'), [[3, 'error']]);
      assert.deepStrictEqual(issues(`${WORKFLOW}          x = 1\n`, '.github/workflows/a.yml'), [[6, 'error']]);
    });

    it('after a sure stop in its shell, nothing; the next shell is another', () => {
      assert.deepStrictEqual(issues('FROM x\nRUN exit 0; x = 1\n', 'Dockerfile'), []);
      assert.deepStrictEqual(issues('FROM x\nRUN exit 0\nRUN x = 1\n', 'Dockerfile'), [[2, 'error']]);
      assert.deepStrictEqual(issues(`${WORKFLOW}          exit 0\n          x = 1\n`, '.github/workflows/a.yml'), []);
      assert.deepStrictEqual(issues(`${WORKFLOW}          exit 0\n      - run: x = 1\n`, '.github/workflows/a.yml'), [[7, 'error']]);
      assert.deepStrictEqual(issues('FROM x\nRUN exit 0; [ -f x\n', 'Dockerfile', 'bracket-missing-close'), []);
    });

    it('a stop that may come first: a warning, as in a script; a command keeps its Error', () => {
      assert.deepStrictEqual(issues('FROM x\nRUN trap a EXIT; [-f x] && y\n', 'Dockerfile', 'bracket-no-space'), [[1, 'warning']]);
      assert.deepStrictEqual(issues('FROM x\nRUN trap a EXIT; [ -f x\n', 'Dockerfile', 'bracket-missing-close'), [[1, 'error']]);
    });

    it('each fence of a Markdown file, and each test of a bats file, is a shell of its own', () => {
      const md = 'text\n\n```bash\nexit 0\n```\n\n```bash\n[ -f x\nx = 1\n```\n';
      assert.deepStrictEqual(issues(md, 'a.md', 'bracket-missing-close'), [[7, 'error']]);
      assert.deepStrictEqual(issues(md, 'a.md'), [[8, 'error']]);
      assert.deepStrictEqual(issues('text\n\n```bash\nexit 0\nx = 1\n```\n', 'a.md'), []);
      assert.deepStrictEqual(issues('#!/usr/bin/env bats\nexit 0\n@test "a" {\n  [ -f x\n}\n', 'a.bats', 'bracket-missing-close'), [[3, 'error']]);
      assert.deepStrictEqual(issues('#!/usr/bin/env bats\n@test "a" {\n  exec b\n}\n@test "b" {\n  [ -f x\n}\n', 'a.bats', 'bracket-missing-close'), [[5, 'error']]);
      assert.deepStrictEqual(issues('#!/usr/bin/env bats\n@test "a" {\n  exec b "$0"\n  [ -f x\n}\n', 'a.bats', 'bracket-missing-close'), []);
      assert.deepStrictEqual(issues('#!/usr/bin/env bats\n@test "a" {\n  exec b\n  [ -f x\n}\n', 'a.bats', 'bracket-missing-close'), [[3, 'error']]);
    });

    it('a recipe of .ONESHELL is one shell', () => {
      assert.deepStrictEqual(issues('.ONESHELL:\na:\n\texit 0\n\tx = 1\n', 'Makefile'), []);
      assert.deepStrictEqual(issues('a:\n\texit 0\n\tx = 1\n', 'Makefile'), [[2, 'error']]);
    });
  });

  it('the command-line tool: exit 0 for pip\'s wrapper and for each fault after an `exit`; 1 for a plain script; a name alone only with --strict', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bash-explainer-read-faults-'));
    try {
      let n = 0;
      for (const f of FAULTS) {
        const at = `${n++}`;
        assert.strictEqual(await check(dir, withShebang(f), `${at}/plain`), 1, `${f.code} plain`);
        assert.strictEqual(await check(dir, after(f, 'exit 0'), `${at}/exit`, '--strict'), 0, `${f.code} after exit`);
        // (After a stop that may come first: a reading fails only `--strict`, a command as before.)
        // (`[ 1 && 2 ]` is also `[` without its `]`, a fact of the command.)
        assert.strictEqual(await check(dir, after(f, "trap 'rm -f t' EXIT"), `${at}/trap`), keepsError(f) || f.code === 'and-or-in-bracket' ? 1 : 0, `${f.code} after trap`);
        assert.strictEqual(await check(dir, after(f, "trap 'rm -f t' EXIT"), `${at}/trap`, '--strict'), 1, `${f.code} after trap, strict`);
        if (f.text.startsWith('#!') || f.fact) continue;
        // (`[ 1 && 2 ]` is also `[` without its `]`, a fact of the command: an Error wherever the shell gets to it.)
        const also = f.code === 'and-or-in-bracket';
        assert.strictEqual(await check(dir, withoutShebang(f), `${at}/named.sh`), also ? 1 : 0, `${f.code} by name`);
        assert.strictEqual(await check(dir, withoutShebang(f), `${at}/named.sh`, '--strict'), 1, `${f.code} by name, strict`);
        assert.strictEqual(await check(dir, withoutShebang(f), `${at}/noname`, '--strict'), also ? 1 : 0, `${f.code} no name`);
      }
      assert.strictEqual(await check(dir, PIP, 'pip3', '--strict'), 0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
