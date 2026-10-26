// How the model reads what bats runs of a test file (src/semantics/walk/host.ts): the file with `set -eET`, then
// each test in a process of its own after `setup` and before `teardown`. test/bats-real.test.ts checks the same
// facts with bats itself; this file tests the cases around them: a hook the file removes, a test it defines again,
// a hook it also calls itself.
import * as assert from 'assert';
import { Analyzer } from '../src/analyzer';
import { explainHostedLine, extractShell } from '../src/hosts';
import { processOf } from '../src/semantics/env';
import { shellState, type StateModel } from '../src/semantics/state';
import { statusModel } from '../src/semantics/status';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { descendants, type SyntaxNode } from '../src/syntax/tree';

const parser = createUnbashParser();

/** The model of a bats file, as the explanation reads it, and the command of the file whose text is `text`. */
function model(lines: string[]): { state: StateModel; command: (text: string) => SyntaxNode; all: (text: string) => SyntaxNode[] } {
  const extracted = extractShell('bats', lines.join('\n'));
  const tree = parser.parse(extracted.text);
  const region = extracted.regions[0];
  const state = shellState(tree, undefined, { host: region.commands, run: region.run });
  const command = (text: string): SyntaxNode => {
    const n = descendants(tree.root, ['command']).find((c) => c.text === text);
    assert.ok(n, text);
    return n;
  };
  const all = (text: string): SyntaxNode[] => descendants(tree.root, ['command']).filter((c) => c.text === text);
  return { state, command, all };
}

/** The ids of the facts said on `line` of a bats file. */
function factsOn(lines: string[], line: number): string[] {
  const extracted = extractShell('bats', lines.join('\n'));
  const ex = explainHostedLine(new Analyzer('en'), parser.parse(extracted.text), extracted, lines, line, 'en')!;
  return (ex.facts ?? []).map((f) => f.id);
}

describe('the model of a bats file', () => {
  it('calls no hook the file removes, and no test it defines again', () => {
    const { state } = model(['setup() { :; }', 'unset -f setup', '@test "a" {', '  true', '}', 'test_a() { :; }', '@test "b" {', '  true', '}', 'unset -f test_b']);
    // (Neither `setup`, unset, nor the two tests: bats would say "unknown test name"; `test_a` is the file's own function.)
    assert.deepStrictEqual([...state.hostCalls.keys()].map((d) => d.startPosition.row), []);
  });

  it('does not know in a test the variables and functions setup_file changes, nor take its options', () => {
    const { state, command } = model(['setup_file() {', '  f() { :; }', '  export v=1', '  set -u', '}', '@test "a" {', '  echo in-a', '}']);
    const st = state.at(command('echo in-a')).run;
    // (Exported, they reach the test; not exported, they do not: either may be. The options do not.)
    assert.deepStrictEqual([st.functions.get('f')?.state, st.variables.get('v')?.set, st.set.get('nounset') ?? 'default', st.set.get('errexit')], ['unknown', 'unknown', 'default', 'on']);
  });

  it('takes no definition of a string on the row of a test for the test', () => {
    const { state } = model(['@test "a" { eval \'g() { :; }\'; g; }']);
    assert.deepStrictEqual([...state.hostCalls.values()].map((c) => c.role), ['test']);
  });

  it('runs a test where the script\'s shell runs, and a function it calls too', () => {
    const { state, command } = model(['f() { echo in-f; }', '@test "a" {', '  f', '  ( cd / )', '  local x=1', '}']);
    assert.strictEqual(processOf(state.env(command('echo in-f'))).kind, 'main');
    assert.strictEqual(processOf(state.env(command('cd /'))).kind, 'subshell');
    // (`local` in a test is in a function: bats calls it.)
    assert.ok(!factsOn(['@test "a" {', '  local x=1', '}'], 1).includes('local-outside-function'));
  });

  it('reads a hook the file also calls itself at its calls too', () => {
    const { state, all } = model(['setup() { false; true; }', 'teardown() { false; true; }', 'if setup; then :; fi', 'x=$(teardown)', '@test "a" {', '  true', '}']);
    const status = statusModel(state);
    // (`setup` is called in a condition and by bats, where `set -e` holds: it may stop; `teardown` is called in `$( )`
    // and by bats on the left of `||`: it may not.)
    const [inSetup, inTeardown] = all('false');
    assert.deepStrictEqual([status.errexit(inSetup).ignored?.why, status.errexit(inSetup).ignored?.sure], ['called-in-condition', false]);
    assert.deepStrictEqual([status.errexit(inTeardown).ignored?.why, status.errexit(inTeardown).ignored?.sure], ['called-by-host', false]);
    assert.strictEqual(processOf(state.env(inSetup)).sure, false);
  });

  it('says where set -e is ignored in teardown, for a set -e there', () => {
    const lines = ['teardown() {', '  set +e', '  { set -e; false; true; }', '}', '@test "a" {', '  true', '}'];
    const extracted = extractShell('bats', lines.join('\n'));
    const ex = explainHostedLine(new Analyzer('en'), parser.parse(extracted.text), extracted, lines, 2, 'en')!;
    const note = ex.facts!.find((f) => f.id === 'errexit-set-in-ignored-group')!;
    assert.match(note.text, /in `teardown`, which is called on the left of `\|\|`/);
  });

  it('walks a test that calls a recursive function again, with what the function changes', () => {
    // (The recursive call may run `x=2` after `d=2`: bash prints 2. The walk again keeps the test's call by bats.)
    const { state, command } = model(['g() { if [ "$d" = 1 ]; then d=2; g; return; fi; x=2; }', '@test "a" {', '  x=1; d=1; g', '  echo "$x"', '}']);
    assert.deepStrictEqual([...state.hostCalls.values()].map((c) => c.role), ['test']);
    assert.strictEqual(state.at(command('echo "$x"')).run.variables.get('x')?.set, 'unknown');
  });
});
