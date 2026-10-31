// Pitfalls that contradicted bash (found in a review, October 2026), checked with bash itself: the case the note now
// gets right, and the case it still flags. bash runs each script in a cgroup (test/support/contained.ts).
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Note } from '../src/messages';
import { SUDO_KEEPS, SUDO_SETS } from '../src/dict/types';
import { fileRead, readAs } from '../src/semantics/env';
import { attribute, fromEnvironment } from '../src/semantics/shellstate';
import { shellState } from '../src/semantics/state';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { descendants } from '../src/syntax/tree';
import { Analyzer } from '../src/analyzer';
import { explainHostedLine, extractShell, hostKind } from '../src/hosts';
import { explain } from './support/explain';
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
      assert.match(caveat.body, /this file has no shebang\. Read by an interactive shell, as `\.bashrc` is, `hi` is expanded; but run as a script \(`bash file`\), bash does not expand aliases, so it is "command not found"/);
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
        assert.strictEqual(ex.noteInfo.find((n) => n.code === 'alias-not-expanded-in-script')!.level, 'warning', JSON.stringify(opts));
        assert.strictEqual(ex.items[0].name!.runs, 'program');
        // (Turned off by the script: "command not found" in an interactive shell too.)
        assert.match(ex.noteInfo.find((n) => n.code === 'alias-not-expanded-in-script')!.body, /alias expansion is turned off \(`shopt -u expand_aliases`\), so `a` is "command not found", also in an interactive shell/);
        assert.match(ex.items[0].explanation, /alias expansion is off here \(`shopt -u expand_aliases`\), so this is "command not found", also in an interactive shell/);
      }
    });

    it('still warns in a script with a shebang, or a string another bash runs', async () => {
      const script = `#!/bin/bash\n${lines}`;
      write('run.sh', script);
      const r = await bash(['run.sh']);
      assert.deepStrictEqual([r.stdout, r.stderr], ['', 'run.sh: line 3: hi: command not found\n']);
      assert.strictEqual(noteOf(script, 'alias-not-expanded-in-script', 2)!.level, 'warning');
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

    it('still warns in a script with a shebang', async () => {
      const script = `#!/bin/bash\n${lib}`;
      write('local.sh', script);
      const r = await bash(['local.sh']);
      assert.deepStrictEqual([r.stdout, r.stderr], ['v=\n', 'local.sh: line 2: local: can only be used in a function\n']);
      const note = noteOf(script, 'local-outside-function', 1)!;
      assert.strictEqual(note.level, 'warning');
      assert.doesNotMatch(note.body, /shebang/);
      // (In a string another bash runs, from any file.)
      assert.strictEqual(noteOf("bash -c 'local x=1'", 'local-outside-function', 0)!.level, 'warning');
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
      assert.strictEqual(unbound.level, 'warning');
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
      assert.strictEqual(note.level, 'warning');
      assert.doesNotMatch(note.body, /environment/);
    });

    it('an array, exported or not: bash cannot export it', async () => {
      for (const [name, script] of [
        ['array-x.sh', '#!/bin/bash\nFOO=(a b)\nexport FOO\nbash -c \'echo "[$FOO]"\'\n'],
        ['array.sh', '#!/bin/bash\nFOO=(a b)\nbash -c \'echo "[$FOO]"\'\n'],
      ]) {
        assert.deepStrictEqual(await both(name, script), ['[]\n', '[]\n'], name);
        const note = exported(script)!;
        assert.strictEqual(note.level, 'warning', name);
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

    it('removed first: the plain warning', async () => {
      for (const [name, script] of [
        ['unset.sh', '#!/bin/bash\nunset FOO\nFOO=1\nbash -c \'echo "[$FOO]"\'\n'],
        ['unexported.sh', '#!/bin/bash\nFOO=1\nexport -n FOO\nbash -c \'echo "[$FOO]"\'\n'],
      ]) {
        assert.deepStrictEqual(await both(name, script), ['[]\n', '[]\n'], name);
        const note = exported(script)!;
        assert.strictEqual(note.level, 'warning', name);
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
      assert.strictEqual(maybe.level, 'info');
      assert.match(maybe.body, /\(unless `FOO` comes from the environment\)/);
      const lower = '#!/bin/bash\nset -u\necho "[$foo]"\n';
      assert.deepStrictEqual(await both('u-lower.sh', lower), ['', '[x]\n']);
      const unlikely = noteOf(lower, 'nounset-unbound', 2)!;
      assert.strictEqual(unlikely.level, 'warning');
      assert.match(unlikely.body, /\(unless `foo` comes from the environment\)/);
      const removed = '#!/bin/bash\nunset FOO\nset -u\necho "[$FOO]"\n';
      assert.deepStrictEqual(await both('u-unset.sh', removed), ['', '']);
      const no = noteOf(removed, 'nounset-unbound', 3)!;
      assert.strictEqual(no.level, 'warning');
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
        // (`LC_ALL=C`: a locale not known makes the model blind, and then it says nothing of exports.)
        const set = `${v}=${v === 'LC_ALL' ? 'C' : 'x'}; sudo bash -c "echo \\$${v}"`;
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
      // (A function of that name runs: no "command not found".)
      const fn = "#!/bin/bash\nal() { echo FUNC; }\nalias al='echo ALIASED'\nal\n";
      assert.deepStrictEqual(await run('function.sh', fn), { stdout: 'FUNC\n', stderr: '', status: 0 });
      assert.deepStrictEqual(codes(fn, 3, /^alias-/), []);
      assert.match(explain(fn, 3).items[0].explanation, /function/i);
      // (A file read with `source` may turn expand_aliases on: the explanation says so, and no note.)
      write('aliases.sh', 'shopt -s expand_aliases\n');
      const sourced = "#!/bin/bash\nalias al='echo ALIASED'\n. ./aliases.sh\nal\n";
      assert.strictEqual((await run('sourced.sh', sourced)).stdout, 'ALIASED\n');
      assert.deepStrictEqual(codes(sourced, 3, /^alias-/), []);
      assert.match(explain(sourced, 3).items[0].explanation, /"command not found" \(unless code not read here, such as a file read with `source` or an `eval`, turns it on\)/);
      assert.match(explain(sourced, 3, 'ja').items[0].explanation, /（ここで読まないコード、たとえば `source` で読み込むファイルや `eval` が有効にしていなければ）/);
      // (Still said where bash fails.)
      const plain = "#!/bin/bash\nalias al='echo ALIASED'\nal\n";
      assert.strictEqual((await run('plain.sh', plain)).status, 127);
      assert.deepStrictEqual(codes(plain, 2, /^alias-/), ['alias-not-expanded-in-script']);
    });

    it('local-outside-function: a RETURN, DEBUG or ERR trap set in a function runs its action there', async () => {
      for (const [signal, body] of [['RETURN', ''], ['DEBUG', ' true;'], ['ERR', ' false;']]) {
        const script = `#!/bin/bash\nf() { trap 'local y=2 && echo in; trap - ${signal}' ${signal};${body} }\nf\n`;
        const r = await run(`trap-${signal}.sh`, script);
        assert.match(r.stdout, /^in\n/, signal);
        assert.strictEqual(r.stderr, '', signal);
        assert.deepStrictEqual(codes(script, 1, /^local-/), [], signal);
      }
      // (A signal not known here may be one of them too.)
      assert.deepStrictEqual(codes('#!/bin/bash\nf() { trap \'local y=2\' "$1"; }\n', 1, /^local-/), []);
      // (An EXIT trap runs once the function has returned: `local` fails there.)
      const exit = "#!/bin/bash\nf() { trap 'local y=2' EXIT; }\nf\n";
      assert.match((await run('trap-exit.sh', exit)).stderr, /local: can only be used in a function/);
      assert.deepStrictEqual(codes(exit, 1, /^local-/), ['local-outside-function']);
    });

    it('variable-not-exported: code the model does not read may export the variable', async () => {
      write('exports.sh', 'export foo\n');
      write('sets.sh', 'foo=2\n');
      for (const [name, script, args, out] of [
        ['sourced.sh', "#!/bin/bash\nfoo=1\n. ./exports.sh\nbash -c 'echo \"[$foo]\"'\n", [], '[1]\n'],
        ['eval.sh', "#!/bin/bash\nfoo=1\neval \"$1\"\nbash -c 'echo \"[$foo]\"'\n", ['export foo'], '[1]\n'],
        ['named.sh', "#!/bin/bash\nfoo=1\nexport \"$1\"\nbash -c 'echo \"[$foo]\"'\n", ['foo'], '[1]\n'],
        // (The string reads a file, which may set it.)
        ['string.sh', "#!/bin/bash\nfoo=1\nbash -c '. ./sets.sh; echo \"[$foo]\"'\n", [], '[2]\n'],
      ] as const) {
        assert.strictEqual((await run(name, script, [...args])).stdout, out, name);
        assert.deepStrictEqual(codes(script, 3, /^variable-not/), [], name);
      }
      // (Still said where nothing the model does not read runs.)
      const plain = "#!/bin/bash\nfoo=1\nbash -c 'echo \"[$foo]\"'\n";
      assert.strictEqual((await run('plain.sh', plain)).stdout, '[]\n');
      assert.deepStrictEqual(codes(plain, 2, /^variable-not/), ['variable-not-exported']);
    });
  });
});
