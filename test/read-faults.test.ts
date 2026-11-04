// The Errors that say the shell reads the text wrongly (`x = 1`, `{ echo a }`, `if a then b; fi`, `[-f x]`, `[ a > b ]`, `$((09))`) follow
// the rule of the syntax error (src/semantics/syntaxerror.ts, `readAs`): an Error where the shell surely reads the line and the file
// surely is a script, a warning with the same words where only a name says so, and nothing after an `exit`, in a polyglot's other
// language, or in a file nobody says is a script. The Errors that are a fact of one command or of the dialect (`[` without its `]`,
// `print` in sh) are said wherever the shell gets to them: not after an `exit` or an `exec` (`reachedAt`). A false Error fails someone's
// CI: it is the worst outcome. Compared with real shells (bash, dash), and with the command-line tool's exit status.
import * as assert from 'assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { documentIssues } from '../src/document';
import { openDocument, shellsOf } from '../src/document-setup';
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

  it('a name alone (`.sh`, no first line) says a reading as a warning, with the same words; a fact of a command keeps its Error', () => {
    for (const f of FAULTS.filter((x) => !x.text.startsWith('#!'))) {
      assert.deepStrictEqual(problems(f, withoutShebang(f), 'a.sh'), [f.fact ? 'error' : 'warning'], f.code);
      if (f.fact) continue;
      const message = (s: ScriptEvidence) => {
        const doc = openDocument(withoutShebang(f), 'shell', (t) => parser.parse(t));
        return documentIssues(doc, 'en', shellsOf(doc.lines, 'a.sh', undefined, s)).find((i) => i.code.replace(/-if-bash$/, '') === f.code)!.message.replace(/^\S+ (?:Error: |Pitfall: )?/, '');
      };
      assert.strictEqual(message('name'), message('said'), f.code);
    }
  });

  it('says nothing after an `exit` or an `exec`, where the shell does not get to the line', () => {
    for (const f of FAULTS) {
      assert.deepStrictEqual(problems(f, after(f, 'exit 0'), 'a.sh'), [], `${f.code} after exit`);
      assert.deepStrictEqual(problems(f, after(f, 'exec true'), 'a.sh'), [], `${f.code} after exec`);
      // (`exec` with only a redirection goes on: a fact of a command is said, a reading is not, as `exec` may be any of them, `mayEnd`.)
      assert.deepStrictEqual(problems(f, after(f, 'exec 3>&1'), 'a.sh'), f.fact ? ['error'] : [], `${f.code} after exec 3>&1`);
    }
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

  it('a string a command runs is as sure as the command: `bash -c \'x = 1\'` after an `exit` says nothing', () => {
    const f = FAULTS[0];
    assert.deepStrictEqual(problems(f, '#!/bin/bash\nbash -c \'x = 1\'\n', 'a.sh'), ['error']);
    assert.deepStrictEqual(problems(f, '#!/bin/bash\nexit 0\nbash -c \'x = 1\'\neval "x = 1"\n', 'a.sh'), []);
    assert.deepStrictEqual(problems(f, 'bash -c \'x = 1\'\n', 'noname'), []);
    assert.deepStrictEqual(problems(f, 'bash -c \'x = 1\'\n', 'a.sh'), ['warning']);
  });

  it('keeps what a host had: a Dockerfile `RUN` and a Markdown fence are the shell\'s whole input', () => {
    const issues = (text: string, name: string) => {
      const doc = openDocument(text, name.endsWith('.md') ? 'markdown' : 'dockerfile', (t) => parser.parse(t));
      return documentIssues(doc, 'en', shellsOf(doc.lines, name, undefined)).filter((i) => i.code === 'assignment-with-spaces').map((i) => String(i.severity));
    };
    assert.deepStrictEqual(issues('FROM x\nRUN x = 1\n', 'Dockerfile'), ['error']);
    assert.deepStrictEqual(issues('text\n\n```bash\nx = 1\n```\n', 'a.md'), ['error']);
  });

  it('the command-line tool: exit 0 for pip\'s wrapper and for each fault after an `exit`; 1 for a plain script; a name alone only with --strict', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bash-explainer-read-faults-'));
    try {
      let n = 0;
      for (const f of FAULTS) {
        const at = `${n++}`;
        assert.strictEqual(await check(dir, withShebang(f), `${at}/plain`), 1, `${f.code} plain`);
        assert.strictEqual(await check(dir, after(f, 'exit 0'), `${at}/exit`, '--strict'), 0, `${f.code} after exit`);
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
