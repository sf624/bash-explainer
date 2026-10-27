// Argv capture (docs/design/oracles.md, 2, steps 2 and 3): each input runs in bash with its commands replaced by a
// recorder (test/support/argv.ts), and the fields the word model gives each word of each command (`wordFields`: what
// the explanation says the program receives) are compared with the argv bash gave the recorder.
//
// The inputs: the fixtures (`fixtureInputs`: sample.sh, coverage.sh, each section of sample.sh, the shell code of the
// host fixtures that bash runs), and a sample of the snippets of the tests (`snippetInputs`, a fixed share chosen by a
// hash of the text, so that a new snippet changes the sample by itself only). Each input runs twice (`ARGV_ENVS`): in
// the probes' environment (`ARGV_ENV`: no other variable, no positional parameter, stdin empty), and with values for
// the variables it reads, two positional parameters and lines on stdin (a space, a glob, an empty one). All the
// snippets and 200 fuzz inputs run by hand: scripts/argv-corpus.ts.
//
// No command may reach a PATH search. A difference (`compareMarker`) is listed in test/fixtures/argv-known.json with its
// reason; an entry of an input that ran and no longer differs fails, and so do counts that changed (update them when
// the fixtures or the sampled snippets change).
import * as assert from 'assert';
import * as fs from 'fs';
import { shellState } from '../src/semantics/state';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { ARGV_KNOWN, type ArgvInput, type ArgvKnownFile, checkArgv, fixtureInputs, instrumentArgv, matchKnown, runArgvBatch, SNIPPET_SAMPLE, snippetInputs, toNull } from './support/argv';
import { probeSkipReason } from './support/probe';

describe('argv capture: the word model against bash (oracles.md, steps 2 and 3)', function () {
  this.timeout(120000);

  it('replaces each command by a recorder, keeps state builtins and functions, and sends redirections to /dev/null', () => {
    const script = [
      'f() { x=1 cmd "$1" >out 2>&1; }',
      'f a; set -e; read -r v <in; [ -f a ] && printf -v y %s z',
      'while getopts a o; do :; done; while next; do :; done; until ready; do :; done',
      'cat <(ls) >&$fd {fd}>log; { echo; } >/tmp/o; >o echo $(date >d)',
    ].join('\n');
    const tree = createUnbashParser().parse(script);
    const inst = instrumentArgv(tree, shellState(tree, 'bash'));
    assert.strictEqual(inst.script, [
      'f() { x=1 __probe 1 cmd "$1"  @@R@@ out @@E@@ >&97 2>&1; }',
      'f a; set -e; read -r v  <&97; __probe_r 2 [ -f a ] && __probe_r 3 printf -v y %s z',
      'while getopts a o; do __probe_r 4 :; done; while __probe_w 5 next; do __probe_r 6 :; done; until __probe_u 7 ready; do __probe_r 8 :; done',
      '__probe 9 cat <(__probe 10 ls)  >&97  @@R@@ log @@E@@ {fd}>&97; { __probe 11 echo; }  >&97;  >&97 __probe 12 echo $(__probe 13 date  @@R@@ d @@E@@ >&97)',
    ].join('\n'));
    assert.deepStrictEqual(inst.unmarked, { function: 1, state: 3 });
    assert.deepStrictEqual(inst.markers.map((m) => [m.kind, m.words.map((w) => w.text).join(' '), m.targets.map((t) => t.text).join(' ')]), [
      ['stub', 'cmd "$1"', 'out'], ['run', '[ -f a ]', ''], ['run', 'printf -v y %s z', ''], ['run', ':', ''], ['while', 'next', ''],
      ['run', ':', ''], ['until', 'ready', ''], ['run', ':', ''], ['stub', 'cat <(ls)', 'log'], ['stub', 'ls', ''], ['stub', 'echo', ''],
      ['stub', 'echo $(date >d)', ''], ['stub', 'date', 'd'],
    ]);
    // A function defined in a string `eval` runs is not defined in the run, where `eval` is recorded.
    const evaluated = createUnbashParser().parse("eval 'g() { :; }'; g; h() { :; }; h");
    assert.deepStrictEqual(instrumentArgv(evaluated, shellState(evaluated, 'bash')).script, "__probe 1 eval 'g() { :; }'; __probe 2 g; h() { __probe_r 3 :; }; h");
  });

  it('sends a file redirection to the descriptor opened on /dev/null', () => {
    assert.deepStrictEqual(['>', '2>>', '>|', '&>', '&>>', '<', '<>', '3<>', '{fd}>', '2>&'].map(toNull),
      ['>&97', '2>&97', '>&97', '>&97 2>&97', '>&97 2>&97', '<&97', '<&97', '3<&97', '{fd}>&97', '2>&97']);
  });

  if (probeSkipReason) {
    it.skip(`needs bash 5.2 or later: ${probeSkipReason}`, () => undefined);
    return;
  }

  it('keeps a command it did not replace from running: no PATH, the builtins that reach out turned off, restricted', async () => {
    const [run] = await runArgvBatch([{ script: 'ls -l; eval date; source ./x; trap "id" EXIT; __probe 1 "$PATH" "$HOME" ~ * >&97\n' }]);
    assert.deepStrictEqual(run.escaped, ['ls', 'eval', 'source', 'trap']);
    assert.deepStrictEqual([...run.records], [['1', [['/nonexistent/explain-bash-argv', '/BOX', '/BOX', 'a.txt', 'b.txt', 'c.log', 'empty', 'sub', 'x y.txt']]]]);
    // A command named by a path, in text read as code at run time (a subscript in arithmetic), a change of PATH, a
    // file opened for output: refused by the restricted shell.
    // (Each on a line of its own: the error of an assignment to PATH ends its line.)
    const script = "x='a[$(/bin/echo run >&2)]'; : $(( x ))\nPATH=/bin\necho b >o\n__probe 2 \"$PATH\" ./*\n";
    const [restricted] = await runArgvBatch([{ script }]);
    assert.deepStrictEqual([...restricted.records], [['2', [['/nonexistent/explain-bash-argv', './a.txt', './b.txt', './c.log', './empty', './sub', './x y.txt']]]]);
    assert.match(restricted.stderr, /\/bin\/echo: restricted: cannot specify `\/' in command names/);
    assert.match(restricted.stderr, /PATH: readonly variable/);
    assert.match(restricted.stderr, /o: restricted: cannot redirect output/);
    assert.doesNotMatch(restricted.stderr, /run/);
  });

  const check = async (set: string, inputs: ArgvInput[]): Promise<void> => {
    const known = JSON.parse(fs.readFileSync(ARGV_KNOWN, 'utf8')) as ArgvKnownFile;
    const { found, escaped, counts } = await checkArgv(inputs, { jobs: 4 });
    const { unexplained, stale } = matchKnown(found, known.known, inputs);
    assert.deepStrictEqual({ escaped, unexplained, stale, counts }, { escaped: [], unexplained: [], stale: [], counts: known.counts[set] });
  };

  it('gives every command of the fixtures the fields bash gives it', () => check('fixtures', fixtureInputs()));

  it('gives every command of a sample of the snippets the fields bash gives it', () => check('snippets', snippetInputs(SNIPPET_SAMPLE)));
});
