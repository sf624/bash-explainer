// Pitfalls that contradicted bash (found in a review, October 2026), checked with bash itself: the case the note now
// gets right, and the case it still flags. bash runs each script in a cgroup (test/support/contained.ts).
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Note } from '../src/messages';
import { SUDO_KEEPS } from '../src/dict/types';
import { fileRead, readAs } from '../src/semantics/env';
import { mayBeInherited } from '../src/semantics/shellstate';
import { shellState } from '../src/semantics/state';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { descendants } from '../src/syntax/tree';
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
    it('says that an empty value closes `[`, which then tests without it', async () => {
      // `"$x"]` is `]` when `x` is empty: `[ -n ]` is true, status 0, with no error.
      const r = await bash(['-c', 'x=""; [ -n "$x"]; echo "$?"']);
      assert.deepStrictEqual([r.stdout, r.stderr], ['0\n', '']);
      const note = noteOf('x=""\n[ -n "$x"]', 'bracket-close-in-word')!;
      assert.strictEqual(note.level, 'warning');
      assert.match(note.body, /When `"\$x"` is empty, the word is `\]` alone and closes `\[`, which tests `\[ -n \]`/);
      // (Unquoted, and of a variable the model does not know.)
      assert.match(noteOf('[ -f $y]', 'bracket-close-in-word')!.body, /When `\$y` is empty.*`\[ -f \]`/);
      assert.match(noteOf('[ -n "$1"]', 'bracket-close-in-word')!.body, /When `"\$1"` is empty/);
      assert.match(noteOf('[ "$a" = "$b"]', 'bracket-close-in-word')!.body, /`\[ "\$a" = \]`/);
      assert.match(explain('[ -n "$x"]', 0, 'ja').notes.join('\n'), /`"\$x"` が空のときは単語が `\]` だけになって `\[` を閉じ、`\[ -n \]` として/);
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
      assert.match(noteOf('[ -n "$y"x]', 'bracket-close-in-word')!.body, missing);
      // (A word glued to `]` with no part before it, a glob.)
      assert.match(noteOf('[ -f *]', 'bracket-close-in-word')!.body, missing);
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
      const token = explain(lines, 1).items[0];
      assert.match(token.explanation, /replaced by `echo hi` when an interactive shell reads this file/);
      // Typed into a terminal (a README's code blocks).
      assert.strictEqual(noteOf(lines, 'alias-not-expanded-in-script', 1, { host: { kind: 'markdown' } }), undefined);
      assert.match(explain(lines, 1, 'en', { host: { kind: 'markdown' } }).items[0].explanation, /typed into an interactive shell, aliases are expanded/);
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

  describe('variable-not-exported: a variable from the environment is exported', () => {
    it('is a caveat for a name that may come from the environment', async () => {
      const script = '#!/bin/bash\nFOO=1\nbash -c \'echo "[$FOO]"\'\n';
      write('env.sh', script);
      assert.strictEqual((await bash(['env.sh'])).stdout, '[]\n');
      assert.strictEqual((await bash(['env.sh'], { FOO: 'x' })).stdout, '[1]\n');
      const note = noteOf(script, 'variable-not-exported', 2)!;
      assert.strictEqual(note.level, 'info');
      assert.match(note.body, /its value gets there only when `FOO` was in the environment already/);
      // (Set twice: still the one from the environment.)
      const twice = '#!/bin/bash\nFOO=1\nFOO=2\nbash -c \'echo "[$FOO]"\'\n';
      write('twice.sh', twice);
      assert.strictEqual((await bash(['twice.sh'], { FOO: 'x' })).stdout, '[2]\n');
      assert.strictEqual(noteOf(twice, 'variable-not-exported', 3)!.level, 'info');
      // (`local` keeps the export of the variable from the environment, as `declare` does.)
      const local = '#!/bin/bash\nf() { local FOO=1; bash -c \'echo "[$FOO]"\'; }\nf\n';
      write('local-env.sh', local);
      assert.strictEqual((await bash(['local-env.sh'])).stdout, '[]\n');
      assert.strictEqual((await bash(['local-env.sh'], { FOO: 'x' })).stdout, '[1]\n');
      assert.strictEqual(noteOf(local, 'variable-not-exported', 1)!.level, 'info');
    });

    it('still warns when the script removed it first, or exports it no more', async () => {
      const script = '#!/bin/bash\nunset FOO\nFOO=1\nbash -c \'echo "[$FOO]"\'\n';
      write('unset.sh', script);
      assert.strictEqual((await bash(['unset.sh'], { FOO: 'x' })).stdout, '[]\n');
      assert.strictEqual(noteOf(script, 'variable-not-exported', 3)!.level, 'warning');
      const unexported = '#!/bin/bash\nFOO=1\nexport -n FOO\nbash -c \'echo "[$FOO]"\'\n';
      write('unexported.sh', unexported);
      assert.strictEqual((await bash(['unexported.sh'], { FOO: 'x' })).stdout, '[]\n');
      assert.strictEqual(noteOf(unexported, 'variable-not-exported', 3)!.level, 'warning');
      // (A name in lower case is taken as not from the environment, as with `set -u`.)
      assert.strictEqual(noteOf('foo=1\nbash -c \'echo "$foo"\'', 'variable-not-exported')!.level, 'warning');
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

    it('keeps a variable that may come from the environment through assignments and declarations, not through unset (`mayBeInherited`)', () => {
      const at = (src: string, name: string) => {
        const tree = parser.parse(`${src}\n:`);
        return shellState(tree).at(tree.root.namedChildren.at(-1)!).run.variables.get(name)!;
      };
      assert.ok(mayBeInherited(at('FOO=1', 'FOO')));
      assert.ok(mayBeInherited(at('FOO=1; FOO=2', 'FOO')));
      assert.ok(mayBeInherited(at('FOO=1; declare FOO', 'FOO')));
      assert.ok(mayBeInherited(at('declare FOO=1', 'FOO')));
      assert.ok(!mayBeInherited(at('declare foo=1', 'foo')));
      assert.ok(!mayBeInherited(at('declare +x FOO=1', 'FOO')));
      assert.ok(mayBeInherited(at('if [ "$1" ]; then FOO=1; fi', 'FOO')));
      assert.ok(mayBeInherited(at('if [ "$1" ]; then FOO=1; else FOO=2; fi', 'FOO')));
      assert.ok(!mayBeInherited(at('if [ "$1" ]; then unset FOO; FOO=1; else unset FOO; FOO=2; fi', 'FOO')));
      assert.ok(!mayBeInherited(at('FOO=1; export FOO', 'FOO')));
      assert.ok(!mayBeInherited(at('unset FOO; FOO=1', 'FOO')));
      assert.ok(!mayBeInherited(at('foo=1', 'foo')));
    });
  });

  describe('variable-not-passed-by-wrapper: what sudo keeps of the environment', () => {
    it('keeps the names of sudoers(5) defaults', () => {
      for (const name of ['TERM', 'TZ', 'LANG', 'LC_*', 'COLORTERM', 'DISPLAY']) assert.ok(SUDO_KEEPS.includes(name), name);
      // (env_reset sets these from the target user, and secure_path replaces PATH.)
      for (const name of ['HOME', 'MAIL', 'SHELL', 'LOGNAME', 'USER', 'PATH']) assert.ok(!SUDO_KEEPS.includes(name), name);
    });

    it('says nothing of a kept name that is exported, and a caveat as for any other command when it may not be', () => {
      for (const v of ['TERM', 'TZ', 'LC_ALL']) {
        const exported = `export ${v}=x; sudo bash -c "echo \\$${v}"`;
        assert.strictEqual(explain(exported).noteInfo.filter((n) => /^variable-not/.test(n.code ?? '')).length, 0, exported);
        const set = `${v}=x; sudo bash -c "echo \\$${v}"`;
        assert.strictEqual(noteOf(set, 'variable-not-passed-by-wrapper', 0), undefined, set);
        assert.strictEqual(noteOf(set, 'variable-not-exported', 0)!.level, 'info', set);
      }
      // (With -i too.)
      assert.strictEqual(noteOf('export TZ=UTC; sudo -i bash -c "date; echo \\$TZ"', 'variable-not-passed-by-wrapper', 0), undefined);
    });

    it('still warns of a name sudo does not keep, and of one `env -i` drops on the way', () => {
      const note = noteOf('export X=1; sudo bash -c "echo \\$X"', 'variable-not-passed-by-wrapper', 0)!;
      assert.match(note.body, /`sudo` passes none of this script's variables \(not even exported ones, but for a few such as `TERM` and `LANG`\)/);
      assert.match(explain('export X=1; sudo bash -c "echo \\$X"', 0, 'ja').notes.join('\n'), /`TERM` や `LANG` などいくつかを除いて/);
      assert.match(noteOf('export TZ=UTC; sudo env -i bash -c "echo \\$TZ"', 'variable-not-passed-by-wrapper', 0)!.body, /`env` passes none of this script's variables \(not even exported ones\)/);
      assert.ok(noteOf('export X=1; ssh h "echo \\$X"', 'variable-not-in-remote-shell', 0));
    });
  });
});
