// Pitfalls that contradicted bash (found in a review, October 2026), checked with bash itself: the case the note now
// gets right, and the case it still flags. bash runs each script in a cgroup (test/support/contained.ts).
import * as assert from 'assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Note } from '../src/messages';
import { interpret } from '../src/argv/interpret';
import { argWord } from '../src/argv/words';
import { lookupCommand } from '../src/dict/aliases';
import { SUDO_KEEPS, SUDO_SETS } from '../src/dict/types';
import { sshSendEnv } from '../src/dict/netadmin';
import { fileRead, readAs, slotEnvs, variableIn } from '../src/semantics/env';
import { attribute, fromEnvironment } from '../src/semantics/shellstate';
import { shellState } from '../src/semantics/state';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { descendants, field, fields } from '../src/syntax/tree';
import { Analyzer } from '../src/analyzer';
import { explainHostedLine, extractShell, hostKind } from '../src/hosts';
import { allTokens, explain } from './support/explain';
import { runContained } from './support/contained';

/** The note of problem `code` on line `line` of `src` (the last line when not given). */
function noteOf(src: string, code: string, line = src.split('\n').length - 1, opts = {}): Note | undefined {
  return explain(src, line, 'en', opts).noteInfo.find((n) => n.code === code);
}

describe('pitfalls that bash contradicted', function () {
  this.timeout(60000);
  let dir: string;
  before(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explain-bash-contra-')); });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const write = (name: string, text: string): string => {
    fs.writeFileSync(path.join(dir, name), text);
    return name;
  };
  const bash = (args: string[], env: NodeJS.ProcessEnv = {}) => runContained(['bash', '--norc', '--noprofile', ...args], dir, env);

  describe('bracket-close-in-word: `]` glued to a word that may be empty', () => {
    it('says that an empty value closes `[`, and what the shorter test then does', async () => {
      // `"$x"]` is `]` when `x` is empty: `[ -n ]` is true, status 0, with no error.
      const r = await bash(['-c', 'x=""; [ -n "$x"]; echo "$?"']);
      assert.deepStrictEqual([r.stdout, r.stderr], ['0\n', '']);
      const note = noteOf('x=""\n[ -n "$x"]', 'bracket-close-in-word')!;
      assert.strictEqual(note.level, 'warning');
      assert.match(note.body, /When `"\$x"` is empty, the word is `\]` alone and closes `\[`, and `\[ -n \]` is true, as one word alone is when it is not empty: not the condition meant\. With a value, `\[` has no closing `\]` and fails/);
      // (An error, a false test, and a test the model cannot read: what bash does with each.)
      const cases: [string, string, RegExp][] = [
        ['a=x; b=""; [ "$a" = "$b"]', '2', /`\[ "\$a" = \]` is usually an error such as "unary operator expected" \(status 2\)/],
        ['x=""; [ "$x"]', '1', /`\[ \]` is false \(status 1\), as a test of no words is/],
        ['x=""; [ -z "$x"]', '0', /`\[ -z \]` is true/],
        ['x=""; y=""; [ -n $y "$x"]', '0', /`\[ -n \$y \]` is a test without that argument: not the condition meant/],
        ['x=""; [ ! -n "$x"]', '1', /`\[ ! -n \]` is a test without that argument: not the condition meant/],
        ['x=""; [ -n "$x"\\]', '0', /When `"\$x"` is empty, the word is `\]` alone/],
      ];
      for (const [src, status, said] of cases) {
        const run = await bash(['-c', `${src}; echo "$?"`]);
        assert.strictEqual(run.stdout, `${status}\n`, src);
        const line = src.split('; ').at(-1)!;
        assert.match(noteOf(line, 'bracket-close-in-word', 0)!.body, said, src);
      }
      // (Unquoted, and of a variable the model does not know.)
      assert.match(noteOf('[ -f $y]', 'bracket-close-in-word')!.body, /When `\$y` is empty.*`\[ -f \]`/);
      assert.match(noteOf('[ -n "$1"]', 'bracket-close-in-word')!.body, /When `"\$1"` is empty/);
      assert.match(explain('[ -n "$x"]', 0, 'ja').notes.join('\n'), /`"\$x"` が空のときは単語が `\]` だけになって `\[` を閉じ、`\[ -n \]` は真になります（単語1つだけの条件は、空でなければ真）/);
      assert.match(explain('[ "$x"]', 0, 'ja').notes.join('\n'), /`\[ \]` は偽（終了ステータス 1）になります/);
      assert.match(explain('[ "$a" = "$b"]', 0, 'ja').notes.join('\n'), /「unary operator expected」などのエラーになります/);
      assert.match(explain('[ -n $y "$x"]', 0, 'ja').notes.join('\n'), /その引数のない条件になり/);
    });

    it('still says "missing `]`" when the word is never empty', async () => {
      const r = await bash(['-c', 'x=a; [ -n "$x"]; echo "$?"']);
      assert.deepStrictEqual([r.stdout, r.stderr], ['2\n', "bash: line 1: [: missing `]'\n"]);
      const missing = /is read as part of the word, so `\[` has no closing `\]`/;
      assert.match(noteOf('x=a\n[ -n "$x"]', 'bracket-close-in-word')!.body, missing);
      // (Text of its own before the `]`; a length; a default of plain text.)
      assert.match(noteOf('[ -f "$d/a"]', 'bracket-close-in-word')!.body, missing);
      assert.match(noteOf('[ -n "${#y}"]', 'bracket-close-in-word')!.body, missing);
      assert.match(noteOf('[ -n "${y:-none}"]', 'bracket-close-in-word')!.body, missing);
      assert.match(noteOf('[ -n "${y:=none}"]', 'bracket-close-in-word')!.body, missing);
      assert.match(noteOf('[ -n "$y"x]', 'bracket-close-in-word')!.body, missing);
      // (A word glued to `]` with no part before it, a glob; a number, `$(( ))`; `${x:?}`, which fails when empty.)
      assert.match(noteOf('[ -f *]', 'bracket-close-in-word')!.body, missing);
      assert.match(noteOf('[ -n $((n))]', 'bracket-close-in-word')!.body, missing);
      assert.match(noteOf('[ -n "${y:?}"]', 'bracket-close-in-word')!.body, missing);
      assert.match((await bash(['-c', 'n=0; [ -n $((n))]; echo "$?"'])).stderr, /missing `\]'/);
      // (A default that is not plain text may be empty; so may a command substitution, and quotes around nothing.)
      assert.match(noteOf('[ -n "${y:-$z}"]', 'bracket-close-in-word')!.body, /When `"\$\{y:-\$z\}"` is empty/);
      assert.match(noteOf('[ -n "${y:-}"]', 'bracket-close-in-word')!.body, /When `"\$\{y:-\}"` is empty/);
      assert.match(noteOf('[ -n $(f)]', 'bracket-close-in-word')!.body, /When `\$\(f\)` is empty/);
      assert.match(noteOf('[ -n \'\'"$x"]', 'bracket-close-in-word')!.body, /When `''"\$x"` is empty/);
    });
  });

  describe('alias-not-expanded-in-script: only in a file run as a script', () => {
    const lines = "alias hi='echo hi'\nhi\n";
    it('says nothing in a file with no shebang, which an interactive shell may read (`.bashrc`)', async () => {
      write('aliases.sh', lines);
      const r = await bash(['-i', '-c', 'source ./aliases.sh']);
      assert.strictEqual(r.stdout, 'hi\n');
      assert.strictEqual(noteOf(lines, 'alias-not-expanded-in-script', 1), undefined);
      // (A caveat: run as a script, `bash aliases.sh`, it is "command not found".)
      const caveat = noteOf(lines, 'alias-maybe-not-expanded', 1)!;
      assert.strictEqual(caveat.level, 'info');
      assert.match(caveat.body, /run as a script \(`bash file`\), `hi` is "command not found"\. But this file has no shebang: read by an interactive shell, as `\.bashrc` is, it is expanded\./);
      assert.match((await bash(['aliases.sh'])).stderr, /hi: command not found/);
      const token = explain(lines, 1).items[0];
      assert.match(token.explanation, /replaced by `echo hi`, but only when an interactive shell reads this file/);
      assert.strictEqual(token.name!.runs, 'alias');
      // Typed into a terminal (a README's code blocks).
      assert.strictEqual(noteOf(lines, 'alias-not-expanded-in-script', 1, { host: { kind: 'markdown' } }), undefined);
      const typed = explain(lines, 1, 'en', { host: { kind: 'markdown' } });
      assert.match(typed.items[0].explanation, /^The alias `hi` defined on line 1: replaced by `echo hi`$/);
      assert.strictEqual(typed.items[0].name!.runs, 'alias');
      assert.strictEqual(typed.noteInfo.length, 0);
      // (An interactive shell started for a string: `bash -i -c`.)
      const string = "bash --norc -i -c 'alias b=\"echo B\"\nb'";
      assert.strictEqual((await bash(['-c', string])).stdout, 'B\n');
      assert.strictEqual(noteOf(string, 'alias-not-expanded-in-script', 0), undefined);
    });

    it('follows `shopt -u expand_aliases` wherever the file is read', async () => {
      const off = "shopt -u expand_aliases\nalias a='echo A'\na\n";
      write('off.sh', off);
      assert.match((await bash(['-i', '-c', 'source ./off.sh'])).stderr, /a: command not found/);
      for (const opts of [{}, { host: { kind: 'markdown' as const } }]) {
        const ex = explain(off, 2, 'en', opts);
        assert.strictEqual(ex.noteInfo.find((n) => n.code === 'alias-not-expanded-in-script')!.level, 'error', JSON.stringify(opts));
        assert.strictEqual(ex.items[0].name!.runs, 'program');
        // (Turned off by the script: "command not found" in an interactive shell too.)
        assert.match(ex.noteInfo.find((n) => n.code === 'alias-not-expanded-in-script')!.body, /alias expansion is turned off \(`shopt -u expand_aliases`\), so `a` is "command not found", also in an interactive shell/);
        assert.match(ex.items[0].explanation, /alias expansion is off here \(`shopt -u expand_aliases`\), so this is "command not found", also in an interactive shell/);
      }
    });

    it('still an error in a script with a shebang, or a string another bash runs', async () => {
      const script = `#!/bin/bash\n${lines}`;
      write('run.sh', script);
      const r = await bash(['run.sh']);
      assert.deepStrictEqual([r.stdout, r.stderr], ['', 'run.sh: line 3: hi: command not found\n']);
      assert.strictEqual(noteOf(script, 'alias-not-expanded-in-script', 2)!.level, 'error');
      // (A string run by `bash -c` is a script, in any file.)
      const string = "bash -c 'alias b=ls\nb'";
      const s = await bash(['-c', string]);
      assert.match(s.stderr, /b: command not found/);
      assert.ok(noteOf(string, 'alias-not-expanded-in-script', 0));
      // (A CI step, a Dockerfile `RUN`: run by a shell as a script.)
      assert.ok(noteOf(lines, 'alias-not-expanded-in-script', 1, { host: { kind: 'yaml', ci: 'github' } }));
    });
  });

  describe('local-outside-function: only fails when the file runs as a script', () => {
    const lib = 'local v=7\necho "v=$v"\n';
    it('says, in a file with no shebang, that it works when a function sources the file', async () => {
      write('lib.sh', lib);
      const r = await bash(['-c', 'f() { source ./lib.sh; }; f; echo "status=$?"']);
      assert.deepStrictEqual([r.stdout, r.stderr], ['v=7\nstatus=0\n', '']);
      const note = noteOf(lib, 'local-outside-function', 0)!;
      assert.strictEqual(note.level, 'info');
      assert.match(note.body, /this file has no shebang: when a function reads it with `source`, `local` works there/);
      assert.match(explain(lib, 0, 'ja').notes.join('\n'), /関数の中から `source` で読み込まれたときは/);
    });

    it('still an error in a script with a shebang', async () => {
      const script = `#!/bin/bash\n${lib}`;
      write('local.sh', script);
      const r = await bash(['local.sh']);
      assert.deepStrictEqual([r.stdout, r.stderr], ['v=\n', 'local.sh: line 2: local: can only be used in a function\n']);
      const note = noteOf(script, 'local-outside-function', 1)!;
      assert.strictEqual(note.level, 'error');
      assert.doesNotMatch(note.body, /shebang/);
      // (In a string another bash runs, from any file.)
      assert.strictEqual(noteOf("bash -c 'local x=1'", 'local-outside-function', 0)!.level, 'error');
    });
  });

  describe('variables from the environment (`fromEnvironment`): variable-not-exported and nounset-unbound', () => {
    /** What `script` prints run with no `FOO`/`foo` in the environment, and with them. */
    const both = async (name: string, script: string): Promise<[string, string]> => {
      write(name, script);
      return [(await bash([name])).stdout, (await bash([name], { FOO: 'x', foo: 'x' })).stdout];
    };
    const exported = (script: string) => noteOf(script, 'variable-not-exported', script.trimEnd().split('\n').length - 1);

    it('a name in capitals: a caveat, as the value gets there when the environment has it', async () => {
      const script = '#!/bin/bash\nFOO=1\nbash -c \'echo "[$FOO]"\'\n';
      assert.deepStrictEqual(await both('caps.sh', script), ['[]\n', '[1]\n']);
      const note = exported(script)!;
      assert.strictEqual(note.level, 'info');
      assert.match(note.body, /its value gets there only when `FOO` was in the environment already/);
      // (Set twice: still the one from the environment.)
      const twice = '#!/bin/bash\nFOO=1\nFOO=2\nbash -c \'echo "[$FOO]"\'\n';
      assert.deepStrictEqual(await both('twice.sh', twice), ['[]\n', '[2]\n']);
      assert.strictEqual(exported(twice)!.level, 'info');
    });

    it('`local` keeps the export of the environment\'s variable, not its value', async () => {
      const local = '#!/bin/bash\nf() { local FOO; FOO=1; bash -c \'echo "[$FOO]"\'; }\nf\n';
      assert.deepStrictEqual(await both('local.sh', local), ['[]\n', '[1]\n']);
      assert.strictEqual(noteOf(local, 'variable-not-exported', 1)!.level, 'info');
      // (Its value is gone: under `set -u`, a read before it is set fails, whatever the environment has.)
      const read = '#!/bin/bash\nset -u\nf() { local FOO; echo "[$FOO]"; }\nf\n';
      write('local-read.sh', read);
      assert.match((await bash(['local-read.sh'], { FOO: 'x' })).stderr, /FOO: unbound variable/);
      const unbound = noteOf(read, 'nounset-unbound', 2)!;
      assert.strictEqual(unbound.level, 'error');
      assert.doesNotMatch(unbound.body, /environment/);
    });

    it('a name in lower case: the warning, with a clause (bash still passes `env foo=x`)', async () => {
      const script = '#!/bin/bash\nfoo=1\nbash -c \'echo "[$foo]"\'\n';
      assert.deepStrictEqual(await both('lower.sh', script), ['[]\n', '[1]\n']);
      const note = exported(script)!;
      assert.strictEqual(note.level, 'warning');
      assert.match(note.body, /so it is empty there \(unless the environment already has `foo`\)/);
      assert.match(explain(script, 2, 'ja').notes.join('\n'), /（環境変数に初めから `foo` があるときを除く）/);
    });

    it('`env -u FOO` removes it, whatever the environment had', async () => {
      const script = '#!/bin/bash\nFOO=1\nenv -u FOO bash -c \'echo "[$FOO]"\'\n';
      assert.deepStrictEqual(await both('env-u.sh', script), ['[]\n', '[]\n']);
      const note = exported(script)!;
      assert.strictEqual(note.level, 'error');
      assert.doesNotMatch(note.body, /environment/);
    });

    it('an array, exported or not: bash cannot export it', async () => {
      for (const [name, script] of [
        ['array-x.sh', '#!/bin/bash\nFOO=(a b)\nexport FOO\nbash -c \'echo "[$FOO]"\'\n'],
        ['array.sh', '#!/bin/bash\nFOO=(a b)\nbash -c \'echo "[$FOO]"\'\n'],
      ]) {
        assert.deepStrictEqual(await both(name, script), ['[]\n', '[]\n'], name);
        const note = exported(script)!;
        assert.strictEqual(note.level, 'error', name);
        assert.match(note.body, /`FOO` is an array, and bash cannot export an array \(not even with `export`\), so it is empty there\. To pass its values, give `"\$\{FOO\[\*\]\}"` as an argument/, name);
      }
      assert.match(explain('FOO=(a b)\nexport FOO\nbash -c \'echo "$FOO"\'', 2, 'ja').notes.join('\n'), /`FOO` は配列で、bash は配列をエクスポートできない/);
    });

    it('after `${FOO:?}`, the variable surely came from the environment, exported', async () => {
      const script = '#!/bin/bash\n: "${FOO:?}"\nbash -c \'echo "[$FOO]"\'\n';
      write('checked.sh', script);
      assert.strictEqual((await bash(['checked.sh'], { FOO: 'x' })).stdout, '[x]\n');
      assert.strictEqual(exported(script), undefined);
    });

    it('removed first: an error', async () => {
      for (const [name, script] of [
        ['unset.sh', '#!/bin/bash\nunset FOO\nFOO=1\nbash -c \'echo "[$FOO]"\'\n'],
        ['unexported.sh', '#!/bin/bash\nFOO=1\nexport -n FOO\nbash -c \'echo "[$FOO]"\'\n'],
      ]) {
        assert.deepStrictEqual(await both(name, script), ['[]\n', '[]\n'], name);
        const note = exported(script)!;
        assert.strictEqual(note.level, 'error', name);
        assert.doesNotMatch(note.body, /environment/, name);
      }
    });

    it('bash\'s own names the environment usually has, and those bash sets in every shell', async () => {
      // (`HOME`, `PATH`, `LANG`, `TMPDIR`: exported from the environment, so a child bash gets what the script assigns.)
      const env = { HOME: '/h', LANG: 'C', TMPDIR: '/t' };
      for (const v of ['HOME', 'PATH', 'LANG', 'TMPDIR']) {
        const value = v === 'PATH' ? '/usr/bin:/bin' : '/v';
        const script = `#!/bin/bash\n${v}=${value}\nbash -c 'echo "[$${v}]"'\n`;
        write(`usual-${v}.sh`, script);
        assert.strictEqual((await bash([`usual-${v}.sh`], env)).stdout, `[${value}]\n`, v);
        assert.deepStrictEqual(explain(script, 2).noteInfo.filter((n) => /^variable-not/.test(n.code ?? '')), [], v);
        // (Unless a link on the way drops it.)
        const dropped = `#!/bin/bash\n${v}=${value}\nenv -i /bin/bash -c 'echo "[$${v}]"'\n`;
        write(`dropped-${v}.sh`, dropped);
        // (bash sets a PATH of its own when the environment has none.)
        assert.strictEqual((await bash([`dropped-${v}.sh`], env)).stdout === `[${value}]\n`, false, v);
        // (Not of `PATH`: bash sets one of its own then, as it sets `TERM`.)
        assert.strictEqual(!!noteOf(dropped, 'variable-not-passed-by-wrapper', 2), v !== 'PATH', v);
      }
      // (`OLDPWD`: bash exports it from the start with no value; a child bash keeps one that names a directory.)
      const oldpwd = '#!/bin/bash\ndeclare -p OLDPWD\nOLDPWD=/tmp\nbash -c \'echo "[$OLDPWD]"\'\n';
      write('oldpwd.sh', oldpwd);
      assert.strictEqual((await bash(['oldpwd.sh'])).stdout, 'declare -x OLDPWD\n[/tmp]\n');
      assert.deepStrictEqual(explain(oldpwd, 3).noteInfo.filter((n) => /^variable-not/.test(n.code ?? '')), []);
      const tree = createUnbashParser().parse(':');
      assert.strictEqual(attribute(shellState(tree).at(tree.root.namedChildren[0]).run, 'OLDPWD', 'x'), 'on');
    });

    it('a name the environment almost always has: no note', async () => {
      const script = '#!/bin/bash\nTERM=dumb\nbash -c \'echo "[$TERM]"\'\n';
      write('term.sh', script);
      assert.strictEqual((await bash(['term.sh'], { TERM: 'xterm' })).stdout, '[dumb]\n');
      assert.strictEqual(exported(script), undefined);
      assert.strictEqual(noteOf('#!/bin/bash\nset -u\necho "$HOME"\n', 'nounset-unbound', 2), undefined);
    });

    it('`set -u`: the same answers for the value', async () => {
      const caps = '#!/bin/bash\nset -u\necho "[$FOO]"\n';
      assert.deepStrictEqual(await both('u-caps.sh', caps), ['', '[x]\n']);
      const maybe = noteOf(caps, 'nounset-unbound', 2)!;
      assert.strictEqual(maybe.level, 'warning');
      assert.match(maybe.body, /\(unless `FOO` comes from the environment\)/);
      const lower = '#!/bin/bash\nset -u\necho "[$foo]"\n';
      assert.deepStrictEqual(await both('u-lower.sh', lower), ['', '[x]\n']);
      const unlikely = noteOf(lower, 'nounset-unbound', 2)!;
      assert.strictEqual(unlikely.level, 'warning');
      assert.match(unlikely.body, /\(unless `foo` comes from the environment\)/);
      const removed = '#!/bin/bash\nunset FOO\nset -u\necho "[$FOO]"\n';
      assert.deepStrictEqual(await both('u-unset.sh', removed), ['', '']);
      const no = noteOf(removed, 'nounset-unbound', 3)!;
      assert.strictEqual(no.level, 'error');
      assert.doesNotMatch(no.body, /environment/);
      // (bash sets its own: no note.)
      assert.strictEqual(noteOf('#!/bin/bash\nset -u\necho "$BASH_VERSION"\n', 'nounset-unbound', 2), undefined);
    });

    it('`TZ=…; date` does not take the zone as the local one when `TZ` may be exported', async () => {
      const script = '#!/bin/bash\nTZ=Asia/Tokyo\ndate -d @0 +%H\n';
      write('tz.sh', script);
      // (With `TZ` in the environment, the assignment changes the exported variable: date sees Asia/Tokyo.)
      assert.strictEqual((await bash(['tz.sh'], { TZ: 'UTC' })).stdout, '09\n');
      const said = JSON.stringify(explain(script, 2).examples);
      assert.doesNotMatch(said, /local zone is UTC/);
    });
  });

  describe('variables a host gives its scripts (`StateModel.provides`)', () => {
    const parser = createUnbashParser();
    /** The codes of the notes on `line` of `src`, read as the file `file`. */
    const codes = (file: string, src: string, line: number): string[] => {
      const extracted = extractShell(hostKind('', file)!, src);
      const ex = explainHostedLine(new Analyzer('en'), parser.parse(extracted.text), extracted, src.split('\n'), line, 'en')!;
      return ex.noteInfo.map((n) => n.code ?? '').filter(Boolean);
    };
    const workflow = (step: string, env = '') => `on: push\njobs:\n  a:\n    runs-on: ubuntu-latest\n${env}    steps:\n      - run: |\n          set -u\n          ${step}\n`;

    it('never reports a placeholder, nor what the CI, an `env:` map or a Dockerfile sets', () => {
      // (The host replaces a placeholder before bash runs: bash reads no variable there.)
      assert.ok(!codes('.github/workflows/ci.yml', workflow('echo "${{ matrix.node }}"'), 7).includes('nounset-unbound'));
      assert.ok(!codes('Makefile', 'all:\n\tset -u; echo $(OUT) $@\n', 1).includes('nounset-unbound'));
      // (Actions sets `GITHUB_*`, `RUNNER_*` and `CI` for every step; a job's `env:` sets its keys.)
      assert.ok(!codes('.github/workflows/ci.yml', workflow('echo "$GITHUB_SHA $RUNNER_OS $CI"'), 7).includes('nounset-unbound'));
      assert.ok(!codes('.github/workflows/ci.yml', workflow('echo "$DEPLOY_ENV"', '    env:\n      DEPLOY_ENV: prod\n'), 9).includes('nounset-unbound'));
      // (`ARG` and `ENV` set the variables the `RUN` after them runs with.)
      assert.ok(!codes('Dockerfile', 'FROM debian\nARG VERSION=1\nENV A=1 B=2\nRUN set -u; echo "$VERSION $A $B"\n', 3).includes('nounset-unbound'));
      // (Another name keeps the caveat.)
      assert.ok(codes('Dockerfile', 'FROM debian\nRUN set -u; echo "$OTHER"\n', 1).includes('nounset-unbound'));
      assert.ok(codes('.github/workflows/ci.yml', workflow('echo "$OTHER"'), 7).includes('nounset-unbound'));
      assert.ok(codes('Makefile', 'all:\n\tset -u; echo $$OTHER\n', 1).includes('nounset-unbound'));
      // (A map's keys at its first indent: not a nested map's, nor a comment.)
      const nested = '    env:\n      # the stage\n      STAGE: prod\n      OPTS:\n        DEEP: 1\n';
      assert.ok(!codes('.github/workflows/ci.yml', workflow('echo "$STAGE"', nested), 12).includes('nounset-unbound'));
      assert.ok(codes('.github/workflows/ci.yml', workflow('echo "$DEEP"', nested), 12).includes('nounset-unbound'));
      // (`ENV A 1`, the older form; a word that names no variable.)
      assert.ok(!codes('Dockerfile', 'FROM debian\nENV A 1\nARG B=2 \\\nRUN set -u; echo "$A $B"\n', 3).includes('nounset-unbound'));
      // (One the CI gives, which the script sets again: still the environment's, exported.)
      assert.ok(!codes('.github/workflows/ci.yml', workflow("CI=1; bash -c 'echo \"$CI\"'"), 7).includes('variable-not-exported'));
    });
  });

  describe('the model facts these notes read', () => {
    const parser = createUnbashParser();
    it('tells a file run as a script from one that may be sourced, and a string another shell runs (`fileRead`, `readAs`)', () => {
      assert.strictEqual(fileRead(parser.parse('').root), 'unknown');
      assert.strictEqual(fileRead(parser.parse('alias a=b\n').root), 'unknown');
      assert.strictEqual(fileRead(parser.parse('#!/bin/sh\nalias a=b\n').root), 'script');
      assert.strictEqual(fileRead(parser.parse('alias a=b\n').root, { kind: 'markdown' }), 'terminal');
      assert.strictEqual(fileRead(parser.parse('alias a=b\n').root, { kind: 'dockerfile' }), 'script');
      const tree = parser.parse('( local a ); bash -c \'local b\'');
      const model = shellState(tree);
      const [sub] = descendants(tree.root, ['subshell']);
      assert.strictEqual(readAs(model.env(sub.namedChildren[0]), 'unknown'), 'unknown');
      assert.strictEqual(readAs(model.env(tree.root), 'terminal'), 'terminal');
    });

    it('answers whether a variable may come from the environment, for its value and its export (`fromEnvironment`)', () => {
      // (At the last `:` of the script: in a function, where it runs.)
      const at = (src: string, name: string, what: 'value' | 'export') => {
        const tree = parser.parse(src.includes(':') ? src : `${src}\n:`);
        return fromEnvironment(name, shellState(tree).at(descendants(tree.root, ['command']).filter((c) => c.text === ':').at(-1)!).run, what);
      };
      const rows: [string, string, 'value' | 'export', string][] = [
        [':', 'HOME', 'value', 'usually'], [':', 'FOO', 'value', 'maybe'], [':', 'foo', 'value', 'unlikely'],
        ['unset FOO', 'FOO', 'value', 'no'], ['declare foo', 'foo', 'value', 'unlikely'], ['FOO=1', 'FOO', 'value', 'no'],
        ['FOO=1', 'FOO', 'export', 'maybe'], ['FOO=1; FOO=2', 'FOO', 'export', 'maybe'], ['FOO=1; declare FOO', 'FOO', 'export', 'maybe'],
        ['declare FOO=1', 'FOO', 'export', 'maybe'], ['declare foo=1', 'foo', 'export', 'unlikely'], ['foo=1', 'foo', 'export', 'unlikely'],
        ['TERM=x', 'TERM', 'export', 'usually'], ['declare +x FOO=1', 'FOO', 'export', 'no'], ['FOO=1; export FOO', 'FOO', 'export', 'no'],
        ['unset FOO; FOO=1', 'FOO', 'export', 'no'], ['FOO=(a b)', 'FOO', 'export', 'no'], ['FOO=1; export -n FOO', 'FOO', 'export', 'no'],
        [': "${FOO:?}"\n:', 'FOO', 'export', 'no'], ['source ./x; : "${FOO:?}"\n:', 'FOO', 'export', 'maybe'],
        ['if [ "$1" ]; then FOO=1; fi', 'FOO', 'export', 'maybe'], ['if [ "$1" ]; then FOO=1; else FOO=2; fi', 'FOO', 'export', 'maybe'],
        ['if [ "$1" ]; then FOO=1; else unset FOO; FOO=2; fi', 'FOO', 'export', 'no'],
        // (`local` keeps the export of what it hides: from the environment, or not.)
        ['f() { local FOO; :; }\nf', 'FOO', 'export', 'maybe'], ['foo=1; f() { local foo; :; }\nf', 'foo', 'export', 'unlikely'],
        ['unset FOO; f() { local FOO; :; }\nf', 'FOO', 'export', 'no'], ['export FOO=1; f() { local FOO; :; }\nf', 'FOO', 'export', 'no'],
      ];
      for (const [src, name, what, want] of rows) assert.strictEqual(at(src, name, what), want, `${src}: ${what}`);
      // (The export attribute itself says it: not known, as `declare -p` shows `-x` only when the environment had it.)
      const tree = parser.parse('FOO=1\n:');
      assert.strictEqual(attribute(shellState(tree).at(tree.root.namedChildren[1]).run, 'FOO', 'x'), 'unknown');
    });
  });

  describe('variable-not-passed-by-wrapper: what sudo keeps of the environment', () => {
    it('keeps the names of sudoers(5) defaults', () => {
      for (const name of ['TERM', 'TZ', 'LANG', 'LC_*', 'COLORTERM', 'DISPLAY', 'DPKG_COLORS']) assert.ok(SUDO_KEEPS.includes(name), name);
      // (env_reset sets these from the target user, and secure_path replaces PATH.)
      for (const name of ['HOME', 'MAIL', 'SHELL', 'LOGNAME', 'USER', 'PATH']) assert.ok(!SUDO_KEEPS.includes(name), name);
    });

    it('says nothing of a kept name that is exported, and a caveat as for any other command when it may not be', () => {
      // (`TERM`: the environment almost always has it, exported.)
      assert.strictEqual(explain('TERM=dumb; sudo bash -c "echo \\$TERM"').noteInfo.filter((n) => /^variable-not/.test(n.code ?? '')).length, 0);
      for (const v of ['TZ', 'LC_ALL']) {
        const exported = `export ${v}=x; sudo bash -c "echo \\$${v}"`;
        assert.strictEqual(explain(exported).noteInfo.filter((n) => /^variable-not/.test(n.code ?? '')).length, 0, exported);
        const set = `${v}=x; sudo bash -c "echo \\$${v}"`;
        assert.strictEqual(noteOf(set, 'variable-not-passed-by-wrapper', 0), undefined, set);
        assert.strictEqual(noteOf(set, 'variable-not-exported', 0)!.level, 'info', set);
      }
      // (With -i too.)
      assert.strictEqual(noteOf('export TZ=UTC; sudo -i bash -c "date; echo \\$TZ"', 'variable-not-passed-by-wrapper', 0), undefined);
    });

    it('still warns of a name sudo does not keep, and of one `env -i` drops on the way', async () => {
      const note = noteOf('export X=1; sudo bash -c "echo \\$X"', 'variable-not-passed-by-wrapper', 0)!;
      assert.match(note.body, /`sudo` passes none of this script's variables \(not even exported ones, but for a few such as `TERM` and `LANG`\)/);
      assert.match(explain('export X=1; sudo bash -c "echo \\$X"', 0, 'ja').notes.join('\n'), /`TERM` や `LANG` などいくつかを除いて/);
      assert.match(noteOf('export TZ=UTC; sudo env -i bash -c "echo \\$TZ"', 'variable-not-passed-by-wrapper', 0)!.body, /`env` passes none of this script's variables \(not even exported ones\)/);
      assert.ok(noteOf('export X=1; ssh h "echo \\$X"', 'variable-not-in-remote-shell', 0));
      // (`su -l` keeps `TERM` only, su(1); `env -i` keeps none, even of the names the environment almost always has.)
      assert.match(noteOf("export X=1; su - -c 'echo $X'", 'variable-not-passed-by-wrapper', 0)!.body, /`su -c` passes none of this script's variables \(not even exported ones, but for `TERM`\)/);
      assert.match(explain("export X=1; su - -c 'echo $X'", 0, 'ja').notes.join('\n'), /（エクスポートしたものも、`TERM` を除いて）/);
      assert.strictEqual(noteOf("export TERM=dumb; su - -c 'echo $TERM'", 'variable-not-passed-by-wrapper', 0), undefined);
      // (bash sets `TERM` to `dumb` when the environment has none: no note of it.)
      assert.strictEqual(noteOf("export TERM=xterm; env -i bash -c 'echo $TERM'", 'variable-not-passed-by-wrapper', 0), undefined);
      assert.strictEqual((await bash(['-c', 'export TERM=xterm; env -i /bin/bash -c \'echo "[$TERM]"\''])).stdout, '[dumb]\n');
    });

    it('says nothing of a name the wrapper sets itself, for the target user', () => {
      // (sudoers(5), "Command environment": env_reset sets HOME, MAIL, SHELL, LOGNAME and USER, and the SUDO_*
      // variables; sudo is not run here, as it may ask for a password.)
      for (const v of ['USER', 'HOME', 'LOGNAME', 'MAIL', 'SUDO_USER']) {
        assert.ok(SUDO_SETS.includes(v), v);
        const src = `${v}=x; sudo bash -c 'echo "[$${v}]"'`;
        assert.deepStrictEqual(explain(src, 0).noteInfo.filter((n) => /^variable-not/.test(n.code ?? '')), [], src);
      }
      for (const src of ["USER=x; doas bash -c 'echo $USER'", "export USER=x; su - -c 'echo $USER'"]) {
        assert.deepStrictEqual(explain(src, 0).noteInfo.filter((n) => /^variable-not/.test(n.code ?? '')), [], src);
      }
      // (A name it does not set is still not there.)
      assert.ok(noteOf("export USERNAME=x; sudo bash -c 'echo $USERNAME'", 'variable-not-passed-by-wrapper', 0));
      // (The shell it starts has them: `set -u` does not stop it there; it does at a name sudo neither sets nor keeps.)
      assert.strictEqual(noteOf("sudo bash -c 'set -u; echo \"$SUDO_USER $HOME\"'", 'nounset-unbound', 0), undefined);
      assert.ok(noteOf("sudo bash -c 'set -u; echo \"$USERNAME\"'", 'nounset-unbound', 0));
      // (`sudo -E` keeps the environment, and sets the `SUDO_*` variables still: sudo(8), ENVIRONMENT.)
      assert.strictEqual(noteOf("sudo -E bash -c 'set -u; echo \"$SUDO_USER\"'", 'nounset-unbound', 0), undefined);
      // (`variableIn`, for every reader: it is there, and no link drops it.)
      const tree = createUnbashParser().parse("export USER=x USERNAME=x; sudo bash -c 'echo $USER'");
      const model = shellState(tree, 'bash');
      const sudo = descendants(tree.root, ['command']).find((c) => field(c, 'name')?.text === 'sudo')!;
      const args = fields(sudo, 'argument');
      const spec = lookupCommand('sudo')!;
      const env = slotEnvs(model.env(sudo), interpret(spec, args.map(argWord), { name: 'sudo', lookup: lookupCommand }), spec, args, 'bash', lookupCommand).get(args[args.length - 1])!;
      assert.deepStrictEqual(variableIn(model, sudo, 'USER', env), { state: 'on', unset: false });
      assert.strictEqual(variableIn(model, sudo, 'USERNAME', env).state, 'off');
    });
  });

  // Found when the checks headed for Error (docs/design/three-levels.md) were run under the ways of running, the
  // environments and the code a model does not read: each case bash runs without the failure the note said.
  describe('the cases left after #424', () => {
    /** Runs the script `text` directly, as its shebang says, with `args`. */
    const run = async (name: string, text: string, args: string[] = []) => {
      write(name, text);
      fs.chmodSync(path.join(dir, name), 0o755);
      return runContained([`./${name}`, ...args], dir);
    };
    const codes = (src: string, line: number, re: RegExp) => explain(src, line).noteInfo.filter((n) => re.test(n.code ?? '')).map((n) => n.code);

    it('alias-not-expanded-in-script: an interactive shebang, a function of that name, code the model does not read', async () => {
      // (`#!/bin/bash -i` is an interactive shell, which expands aliases, as `bash -i -c` does.)
      for (const shebang of ['#!/bin/bash -i', '#!/usr/bin/env -S bash -i']) {
        const script = `${shebang}\nalias al='echo ALIASED'\nal\n`;
        assert.match((await run('interactive.sh', script)).stdout, /ALIASED\n$/, shebang);
        assert.deepStrictEqual(codes(script, 2, /^alias-/), [], shebang);
        assert.match(explain(script, 2).items[0].explanation, /replaced by `echo ALIASED`/, shebang);
      }
      // (A function of that name runs: no "command not found". Defined on some paths only, it runs on those: a caveat.)
      const fn = "#!/bin/bash\nal() { echo FUNC; }\nalias al='echo ALIASED'\nal\n";
      assert.deepStrictEqual(await run('function.sh', fn), { stdout: 'FUNC\n', stderr: '', status: 0 });
      assert.deepStrictEqual(codes(fn, 3, /^alias-/), []);
      assert.match(explain(fn, 3).items[0].explanation, /function/i);
      const some = "#!/bin/bash\nalias al='echo ALIASED'\nif [ \"$1\" ]; then al() { echo FUNC; }; fi\nal\n";
      assert.strictEqual((await run('some.sh', some, ['x'])).stdout, 'FUNC\n');
      assert.match((await run('some.sh', some)).stderr, /al: command not found/);
      const fnMaybe = noteOf(some, 'alias-not-expanded-in-script', 3)!;
      assert.strictEqual(fnMaybe.level, 'info');
      assert.match(fnMaybe.body, /"command not found", unless the function `al`, defined on some paths before here, runs instead\./);
      // (After code the model does not read, a file read with `source` or an `eval` of text not known, alike: it may
      // turn expand_aliases on, a caveat; the token and the name's hint take the same clause from the catalog.)
      write('aliases.sh', 'shopt -s expand_aliases\n');
      for (const [name, sourced, args] of [
        ['sourced.sh', "#!/bin/bash\nalias al='echo ALIASED'\n. ./aliases.sh\nal\n", []],
        ['eval.sh', "#!/bin/bash\nalias al='echo ALIASED'\neval \"$1\"\nal\n", ['shopt -s expand_aliases']],
      ] as const) {
        assert.strictEqual((await run(name, sourced, [...args])).stdout, 'ALIASED\n', name);
        const maybe = noteOf(sourced, 'alias-not-expanded-in-script', 3)!;
        assert.strictEqual(maybe.level, 'info', name);
        assert.match(maybe.body, /"command not found", unless code that runs before it and is not read here, such as a file read with `source` or an `eval`, turns `expand_aliases` on\./, name);
        assert.match(explain(sourced, 3).items[0].explanation, /"command not found", unless code that runs before it and is not read here, such as a file read with `source` or an `eval`, turns `expand_aliases` on\./, name);
        assert.match(explain(sourced, 3, 'ja').items[0].explanation, /（この前に実行される、`source` で読み込むファイルや `eval` のようにここでは読まないコードが `expand_aliases` を有効にしていなければ）/, name);
        assert.strictEqual(explain(sourced, 3).items[0].name?.also.find((o) => o.kind === 'alias')?.unexpanded, 'maybe', name);
      }
      // (Still said where bash fails: before that code, on the line that runs it (bash reads the whole line first), or
      // with no such code, whatever the trust of the script.)
      for (const [name, plain, line] of [
        ['plain.sh', "#!/bin/bash\nalias al='echo ALIASED'\nal\n", 2],
        ['before.sh', "#!/bin/bash\nalias al='echo ALIASED'\nal\n. ./aliases.sh\n", 2],
        ['same-line.sh', "#!/bin/bash\nalias al='echo ALIASED'\n. ./aliases.sh; al\n", 2],
        ['locale.sh', "#!/bin/bash\nLC_ALL=en_US.UTF-8\nalias al='echo ALIASED'\nal\n", 3],
      ] as const) {
        const r = await run(name, plain);
        assert.strictEqual(r.status, name === 'before.sh' ? 0 : 127, name);
        assert.match(r.stderr, /al: command not found/, name);
        assert.strictEqual(noteOf(plain, 'alias-not-expanded-in-script', line)?.level, 'error', name);
        assert.strictEqual(allTokens(explain(plain, line).items).find((t) => t.name && t.label === 'al')!.name!.also.find((o) => o.kind === 'alias')?.unexpanded, true, name);
      }
    });

    it('local-outside-function: a trap\'s action runs where the trap fires, in a function or not', async () => {
      // (A RETURN trap set in a function fires in it; a DEBUG or ERR trap set there stays set once it has returned,
      // and fires outside it too; an EXIT trap fires once the script ends.)
      for (const [signal, body, after, fails] of [['RETURN', '', '', false], ['DEBUG', ' true;', 'echo after\n', true], ['ERR', ' false;', 'false\n', true], ['EXIT', '', '', true]] as const) {
        const script = `#!/bin/bash\nf() { trap 'local y=2 && echo in' ${signal};${body} }\nf\n${after}`;
        const r = await run(`trap-${signal}.sh`, script);
        assert.strictEqual(/local: can only be used in a function/.test(r.stderr), fails, signal);
        assert.strictEqual(noteOf(script, 'local-outside-function', 1)!.level, 'info', signal);
      }
      assert.match(noteOf('#!/bin/bash\nf() { trap \'local y=2\' "$1"; }\n', 'local-outside-function', 1)!.body, /This is a trap's action: it runs where the trap fires, which may be inside a function or outside one/);
      // (Not in a trap: still an error.)
      assert.strictEqual(noteOf('#!/bin/bash\nlocal y=2\n', 'local-outside-function', 1)!.level, 'error');
    });

    it('variable-not-exported and function-not-in-new-shell-export: code the model does not read may export it', async () => {
      write('exports.sh', 'export foo\nexport -f f 2>/dev/null\n');
      write('sets.sh', 'foo=2\n');
      // (A caveat after such code, in this shell (it may export the name) or in the string before the read (it may set
      // it): `unread`.)
      for (const [name, script, args, out] of [
        ['sourced.sh', "#!/bin/bash\nfoo=1\n. ./exports.sh\nbash -c 'echo \"[$foo]\"'\n", [], '[1]\n'],
        ['eval.sh', "#!/bin/bash\nfoo=1\neval \"$1\"\nbash -c 'echo \"[$foo]\"'\n", ['export foo'], '[1]\n'],
        ['string.sh', "#!/bin/bash\nfoo=1\nbash -c '. ./sets.sh; echo \"[$foo]\"'\n", [], '[2]\n'],
      ] as const) {
        assert.strictEqual((await run(name, script, [...args])).stdout, out, name);
        // (The line of `bash -c`, the last one.)
        const note = noteOf(script, 'variable-not-exported', script.trimEnd().split('\n').length - 1)!;
        assert.strictEqual(note.level, 'info', name);
        assert.match(note.body, /(unless|, or) code that runs before it and is not read here, such as a file read with `source` or an `eval`, leaves `foo` set there\)\./, name);
        // (One "unless" for the conditions, not two.)
        assert.ok(!/unless.*unless/.test(note.body), name);
      }
      const fn = "#!/bin/bash\nf() { echo FUNC; }\n. ./exports.sh\nbash -c f\n";
      assert.strictEqual((await run('function.sh', fn)).stdout, 'FUNC\n');
      const fnNote = noteOf(fn, 'function-not-in-new-shell-export', 3)!;
      assert.strictEqual(fnNote.level, 'info');
      assert.match(fnNote.body, /does not have this script's function `f`, unless code that runs before it and is not read here, such as a file read with `source` or an `eval`, defines it there\./);
      // (bash exports no array, whatever that code does: still an error.)
      write('exports-arr.sh', 'export arr\n');
      const arr = "#!/bin/bash\narr=(a b)\n. ./exports-arr.sh\nbash -c 'echo \"[$arr]\"'\n";
      assert.strictEqual((await run('array.sh', arr)).stdout, '[]\n');
      assert.strictEqual(noteOf(arr, 'variable-not-exported', 3)!.level, 'error');
      // (Still said where no code the model does not read runs before: after the command, in this shell or in the
      // string, or with a locale the trust does not know.)
      for (const [name, plain, line] of [
        ['plain.sh', "#!/bin/bash\nfoo=1\nbash -c 'echo \"[$foo]\"'\n", 2],
        ['later.sh', "#!/bin/bash\nfoo=1\nbash -c 'echo \"[$foo]\"; . ./sets.sh'\n. ./exports.sh\n", 2],
        ['locale.sh', "#!/bin/bash\nfoo=1\nbash -c 'echo \"[$foo]\"'\nexport LC_ALL=en_US.UTF-8\n", 2],
      ] as const) {
        assert.strictEqual((await run(name, plain)).stdout, '[]\n', name);
        assert.strictEqual(noteOf(plain, 'variable-not-exported', line)!.level, 'warning', name);
      }
    });
  });

  // Found in the review of #557: a function that has the name of a program. Where the function is not (a program a
  // wrapper starts, a new shell, a remote shell, a container), the program runs: bash says no "command not found".
  describe('a function that shadows a program: the program runs where the function is not', () => {
    const fn = 'ls() { command ls -F "$@"; }\n';
    it('runs the program in bash, and says so in a caveat', async () => {
      const script = `#!/bin/bash\n${fn}timeout 5 ls /\nprintf '/\\n' | xargs ls\nbash -c "ls /"\n`;
      write('shadow.sh', script);
      const r = await bash(['shadow.sh']);
      assert.strictEqual(r.status, 0, r.stderr);
      assert.doesNotMatch(r.stderr, /not found/);
      // (The function's `-F` marks directories with `/`; the program, run three times, does not.)
      assert.doesNotMatch(r.stdout, /^(etc|usr)\/$/m);
      for (const line of [2, 3, 4]) {
        const note = noteOf(script, 'function-shadowed-by-program', line)!;
        assert.strictEqual(note.level, 'info', String(line));
        assert.match(note.body, /the program `ls` runs/, String(line));
      }
      for (const [src, body] of [
        ['sudo ls', /`sudo` starts `ls` as a separate program, so the program `ls` runs, not this script's function of that name\. The function runs that program too, so this may be what is meant/],
        ['ssh host ls', /^the remote shell does not have this script's function `ls`, so the program `ls` runs there/],
        ['docker run img ls', /^`docker run` runs `ls` inside the container, which does not have this script's function, so the image's program `ls` runs/],
        ["bash -c 'ls /'", /^`bash -c` runs the command in a new shell, which does not have this script's function `ls`, so the program `ls` runs there/],
      ] as const) {
        const note = noteOf(fn + src, 'function-shadowed-by-program', 1)!;
        assert.strictEqual(note?.level, 'info', src);
        assert.match(note.body, body, src);
      }
      // (A function that is no program is still an error: "command not found".)
      assert.strictEqual(noteOf('myls() { :; }\nsudo myls', 'builtin-or-function-as-program', 1)!.level, 'error');
      assert.strictEqual(noteOf('myls() { :; }\nssh host myls', 'function-not-on-remote', 1)!.level, 'error');
      // (A builtin that is also a program, `echo`: the program runs; the function wraps it with `builtin echo`.)
      assert.strictEqual(noteOf('echo() { builtin echo "[$*]"; }\nsudo echo hi', 'function-shadowed-by-program', 1)?.level, 'info');
      // (A builtin with no program, `cd`, is not one either.)
      assert.strictEqual(noteOf('cd() { builtin cd "$@"; }\nsudo cd /root', 'builtin-or-function-as-program', 1)!.level, 'error');
    });
  });

  // Found in the second review of #557: a function that only has the name of a program, and does not run it, is no
  // wrapper. Where it is not, another program runs (coreutils' `install`, `sync`): a warning, not a caveat.
  describe('a function that only has the name of a program: another program runs where it is not', () => {
    it('runs the program in bash, not the function, and says so in a warning', async () => {
      // (`rsync` is a function here, so that the function `sync` would print if it ran, and reach no host.)
      const script = '#!/bin/bash\ninstall() { cp app /usr/local/bin/; }\nrsync() { echo "rsync $*"; }\nsync() { rsync -a src/ host:dst/; }\n'
        + 'timeout 5 install\necho "install $?"\ntimeout 300 sync\necho "sync $?"\n';
      write('only-name.sh', script);
      const r = await bash(['only-name.sh']);
      // (coreutils' install, with no operand: "missing file operand", status 1; not `cp`, which says "cannot stat".)
      assert.match(r.stderr, /install: missing file operand/);
      assert.doesNotMatch(r.stderr, /cannot stat/);
      assert.strictEqual(r.stdout, 'install 1\nsync 0\n');
      for (const [line, name] of [[4, 'install'], [6, 'sync']] as const) {
        const note = noteOf(script, 'function-shadowed-by-program', line)!;
        assert.strictEqual(note.level, 'warning', name);
        assert.match(note.body, new RegExp(`so the program \`${name}\` runs, not this script's function of that name\\. The function does not run that program itself, so a different program runs`), name);
      }
      for (const src of ['install() { cp app /usr/local/bin/; }\nsudo install', 'sync() { rsync -a src/ host:dst/; }\ntimeout 300 sync',
        'install() { local d=/usr/local/bin; x=1; "$@"; cp app "$d"; }\nssh host install', 'echo() { :; }\nsudo echo hi', 'sync() { rsync -a src/ host:dst/; }\ndocker run img sync',
        'sync() { rsync -a src/ host:dst/; }\nbash -c sync']) {
        assert.strictEqual(noteOf(src, 'function-shadowed-by-program', 1)?.level, 'warning', src);
      }
      assert.match(explain('install() { cp app /usr/local/bin/; }\nsudo install', 1, 'ja').notes.join('\n'), /関数自体はそのプログラムを実行しないので、関数とは別のプログラムが動き/);
    });
    it('a function that runs the program of its name wraps it: a caveat', async () => {
      // (`\ls` is the function itself: a quoted name skips aliases only, and bash recurses.)
      const recursive = '#!/bin/bash\nls() { \\ls -d /; }\nls\n';
      write('recursive.sh', recursive);
      assert.match((await bash(['recursive.sh'], { FUNCNEST: '20' })).stderr, /maximum function nesting level exceeded/);
      assert.strictEqual(noteOf('ls() { \\ls -F "$@"; }\nsudo ls', 'function-shadowed-by-program', 1)?.level, 'warning');
      for (const src of ['ls() { command ls -F "$@"; }\nsudo ls', 'ls() { /bin/ls -F "$@"; }\nsudo ls', 'curl() { sudo curl --retry 3 "$@"; }\nssh host curl x',
        'ls() { env LC_ALL=C ls "$@"; }\ntimeout 5 ls']) {
        assert.strictEqual(noteOf(src, 'function-shadowed-by-program', 1)?.level, 'info', src);
      }
      assert.match(noteOf('ls() { command ls -F "$@"; }\nsudo ls', 'function-shadowed-by-program', 1)!.body, /\. The function runs that program too, so this may be what is meant\./);
    });
  });

  // Also from the review of #557: what the far side sets itself, or may be sent (ssh(1), ENVIRONMENT; ssh_config(5),
  // `SendEnv`; Docker's `docker run` environment).
  describe('variables a remote shell or a container sets itself, or may be sent', () => {
    it('says nothing of a name sshd or the container runtime sets', () => {
      for (const src of ["HOME=/x\nssh host 'echo \"$HOME\"'", "export USER=me\nssh host 'echo $USER'", "export LOGNAME=me\nssh host 'echo $LOGNAME'", "MAIL=/x\nssh host 'echo $MAIL'",
        "export HOME=/x\ndocker run img sh -c 'echo \"$HOME\"'", "export HOSTNAME=h\ndocker run img sh -c 'echo \"$HOSTNAME\"'"]) {
        assert.deepStrictEqual(explain(src, 1).noteInfo.filter((n) => /^variable-not/.test(n.code ?? '')), [], src);
      }
    });
    it('a caveat for a name ssh may send: `LANG` and `LC_*` on Debian and Ubuntu, a name given to `-o SendEnv=`', () => {
      // (A value not known here may be `SendEnv=FOO`.)
      for (const src of ["export LANG=C.UTF-8\nssh host 'echo \"$LANG\"'", "export LC_TIME=C\nssh host 'echo $LC_TIME'", "export FOO=1\nssh -o SendEnv=FOO host 'echo $FOO'", "export FOO=1\nssh -o 'SendEnv FOO BAR' host 'echo $FOO'",
        "export FOO=1\nssh -o \"$opt\" host 'echo $FOO'"]) {
        const note = noteOf(src, 'variable-not-in-remote-shell', 1)!;
        assert.strictEqual(note?.level, 'info', src);
        assert.match(note.body, /unless ssh sends it with `SendEnv` and the server accepts it with `AcceptEnv`/, src);
      }
      // (`?` stands for one character, a pattern of ssh_config(5); a capital may come from the environment, exported.)
      for (const src of ["export FOO=1\nssh -o 'SendEnv=FO?' host 'echo $FOO'", "export FOO=1\nssh -o 'sendenv = BAR LC_* F*' host 'echo $FOO'", "LANG=C\nssh host 'echo $LANG'",
        "FOO=1\nssh -o SendEnv=FOO host 'echo $FOO'"]) {
        assert.strictEqual(noteOf(src, 'variable-not-in-remote-shell', 1)?.level, 'info', src);
      }
      // (Another name, `-o` of another option, a comma, which is no separator, or a variable not exported: ssh sends
      // only its own environment. An error.)
      for (const src of ["export FOO=1\nssh host 'echo $FOO'", "export FOO=1\nssh -o SendEnv=BAR host 'echo $FOO'", "export FOO=1\nssh -o 'SendEnv -FOO' host 'echo $FOO'",
        "export FOO=1\nssh -o ConnectTimeout=5 host 'echo $FOO'", "export FOO=1\nssh -o SendEnv=BAR,FOO host 'echo $FOO'", "export FOO=1\nssh -o 'SendEnv=FO?O' host 'echo $FOO'", "export FOO=1\nssh -o 'SendEnv=F?' host 'echo $FOO'", "export FOO=1\nssh -o 'SendEnv=F*X' host 'echo $FOO'",
        "x=1\nssh -o SendEnv=x host 'echo $x'", "export -n LANG=C\nssh host 'echo $LANG'", "declare +x LC_ALL=C\nssh host 'echo $LC_ALL'"]) {
        assert.strictEqual(noteOf(src, 'variable-not-in-remote-shell', 1)?.level, 'error', src);
      }
      assert.match(explain("export LANG=C.UTF-8\nssh host 'echo \"$LANG\"'", 1, 'ja').notes.join('\n'), /（ssh が `SendEnv` で送り、サーバーが `AcceptEnv` で受け付けるときを除く。/);
    });
    // (ssh's own reading of `-o`: `ssh -G` prints the settings it would use, with the `sendenv` names of ssh_config.)
    it('reads the names of `-o SendEnv=` as ssh does', function () {
      const ssh = spawnSync('ssh', ['-V']);
      if (ssh.error) this.skip();
      const values = ['SendEnv=FOO', 'SendEnv=BAR,FOO', 'sendenv BAR FOO', 'SendEnv = "A B" C', 'SendEnv=-LANG', 'SendEnv=FO? MY_*', 'SENDENV\tX\tY', 'ConnectTimeout=5', 'SendEnv=""'];
      const script = `ssh -G localhost | grep -i '^sendenv '; for v in "$@"; do echo '--'; ssh -G -o "$v" localhost | grep -i '^sendenv '; done; true`;
      const [base, ...each] = spawnSync('bash', ['-c', script, '_', ...values], { encoding: 'utf8' }).stdout.split('--\n');
      const names = (out: string) => out.split('\n').filter((l) => l).map((l) => l.slice('sendenv '.length));
      const config = new Set(names(base));
      assert.deepStrictEqual(each.map((out) => names(out).filter((n) => !config.has(n))), values.map((v) => [...sshSendEnv(v)]));
      assert.deepStrictEqual(sshSendEnv('SendEnv='), []);
    });
  });
});
