// What a builtin does to the shell, read from its spec (src/semantics/effects.ts): the walk of the state and the
// trust scan read the same effects. Each case is compared with bash.
import * as assert from 'assert';
import { execFileSync, spawnSync } from 'child_process';
import { Analyzer } from '../src/analyzer';
import { builtins } from '../src/dict/builtins';
import { variableWrites, builtinParse, wrapped } from '../src/semantics/effects';
import { attribute, shellState } from '../src/semantics/state';
import { statusModel } from '../src/semantics/status';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { descendants, fields } from '../src/syntax/tree';

const parser = createUnbashParser();
const bash = (code: string): string => execFileSync('bash', ['-c', code], { env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' } }).toString();

/** What the model says of `x` after `src`: unset, `a` for an array, `1` for the value 1, `?` for a value not known. */
function modelOf(src: string, name: string): string {
  const st = shellState(parser.parse(src)).end;
  const v = st.variables.get(name);
  if (!v || v.set === 'off') return 'unset';
  if (attribute(st, name, 'a') === 'on') return 'a';
  return v.value ?? '?';
}
/** The same, from bash. */
function bashOf(src: string, name: string): string {
  const out = bash(`{ ${src}; } >/dev/null 2>&1\ndeclare -p ${name} 2>/dev/null || echo unset`).trim();
  return out === 'unset' ? 'unset' : out.startsWith('declare -a') ? 'a' : out === `declare -- ${name}="1"` ? '1' : '?';
}

describe('builtin effects from the spec (src/semantics/effects.ts)', () => {
  it('sets the variables a builtin names as bash does, the value written in the option\'s word too', () => {
    for (const cmd of ['printf -v x 2', 'printf -vx 2', 'read x <<< 2', 'read -a x <<< 2', 'read -ax <<< 2', 'read -rax <<< 2', 'read -ra x <<< 2',
      'mapfile x <<< 2', 'readarray -t x <<< 2', 'getopts a x -a', 'read -a y x <<< 2', 'read <<< 2', 'mapfile <<< 2', 'command read x <<< 2',
      'builtin read x <<< 2', 'command -p read x <<< 2', 'command -- read x <<< 2', 'command -v read x', 'command -V read x >/dev/null', 'builtin printf -vx 2']) {
      const src = `x=1; ${cmd}`;
      // (`?` in the model stands for any value bash gives.)
      const want = bashOf(src, 'x');
      const got = modelOf(src, 'x');
      assert.ok(got === want || (got === '?' && !['unset', 'a', '1'].includes(want)), `${cmd}: bash ${want}, model ${got}`);
    }
    // The defaults: REPLY and MAPFILE, only when no word names a variable.
    assert.strictEqual(bash('read <<< 2; mapfile <<< 3; echo "$REPLY ${MAPFILE[0]}"'), '2 3\n\n');
    assert.strictEqual(modelOf('read <<< 2', 'REPLY'), '?');
    assert.strictEqual(modelOf('read x <<< 2', 'REPLY'), 'unset');
    assert.strictEqual(modelOf('mapfile <<< 3', 'MAPFILE'), 'a');
    assert.strictEqual(modelOf('mapfile -t m <<< 3', 'MAPFILE'), 'unset');
  });
  it('does not decide from a variable a builtin sets in the option\'s own word', () => {
    // (bash prints `changed`: the model once read `x` as still 1.)
    for (const cmd of ['printf -vx 2', 'read -rax <<< 2']) {
      const src = `x=1; ${cmd}; [ "$x" = 1 ] && echo same || echo changed`;
      assert.strictEqual(bash(src), 'changed\n');
      const tree = parser.parse(src);
      assert.strictEqual(shellState(tree).condition(descendants(tree.root, ['list']).find((l) => l.text.startsWith('['))!), undefined, cmd);
    }
  });
  it('reads the words of `command` and `builtin` by the command slot of their specs', () => {
    const args = (src: string) => fields(parser.parse(src).root.namedChildren[0], 'argument');
    assert.deepStrictEqual(wrapped('command', args('command -p read x')), { name: 'read', args: args('command -p read x').slice(2) });
    assert.deepStrictEqual(wrapped('command', args('command -pv read')), { lookup: true });
    assert.deepStrictEqual(wrapped('command', args('command')), { lookup: true });
    // (A word whose value is not known is the command: an option of `command` only if it expands to one.)
    assert.strictEqual((wrapped('command', args('command "$c" read x')) as { name?: string }).name, undefined);
    assert.ok(shellState(parser.parse('x=1; command "$c" read x; [ "$x" = 1 ] && :')).blind);
    // (The parse gives each variable its word.)
    const words = args('read -ra arr x');
    assert.deepStrictEqual(variableWrites(builtins.read, builtinParse('read', words), words).map((v) => [v.name, v.sets]), [['arr', 'array']]);
  });
  it('follows `set -a` as bash reads the words of `set`: the last one wins, and an operand is no option', () => {
    // bash exports `f` only after an allexport left on.
    const exported = (src: string) => bash(`${src}; f() { :; }; env | grep -c '^BASH_FUNC_f' || :`).trim();
    const body = 'x=0; f() { if [ "$x" = 1 ]; then : M; fi; }; f; x=1';
    const decided = (src: string) => {
      const tree = parser.parse(src);
      return shellState(tree).condition(descendants(tree.root, ['if_statement'])[0])?.outcome;
    };
    for (const [set, out] of [['set foo -a', '0'], ['set -a +a', '0'], ['set -o allexport +o allexport', '0'], ['set -a', '1'], ['set +a -o allexport', '1'], ['set -e -a', '1']]) {
      assert.strictEqual(exported(set), out, set);
      assert.strictEqual(decided(`${set}; ${body}`), out === '0' ? 'false' : undefined, set);
    }
    // A word not known before the operands may be `-a`.
    for (const set of ['set "$o"', 'set -o "$o"', 'set -$o', 'set -e "$o" -a']) assert.strictEqual(decided(`${set}; ${body}`), undefined, set);
    assert.strictEqual(decided(`set -- "$o"; ${body}`), 'false');
  });
  it('reads a command name written with quotes as bash does, for its status', () => {
    const r = spawnSync('bash', ['-c', "'exit' 3; echo no"]);
    assert.deepStrictEqual([r.status, r.stdout.toString()], [3, '']);
    const tree = parser.parse("'exit' 3");
    assert.deepStrictEqual(statusModel(shellState(tree)).status(descendants(tree.root, ['command'])[0]), { kind: 'given', by: 'exit', value: 3 });
  });
  it('says that `exec` with a command in a subshell ends only the subshell', () => {
    assert.strictEqual(bash('(exec true; echo no); echo yes'), 'yes\n');
    type Item = { explanation: string; children: Item[] };
    const all = (items: Item[]): Item[] => items.flatMap((t) => [t, ...all(t.children)]);
    const text = (src: string) => all(new Analyzer('en').explainLine(parser.parse(src), 0).items as Item[]).find((t) => t.explanation.startsWith('Replace the shell'))!.explanation;
    assert.match(text('(exec true; echo no); echo yes'), /ends only the subshell, not the script/);
    assert.doesNotMatch(text('exec true'), /subshell/);
    // (Without a command it only redirects the shell's own descriptors.)
    assert.doesNotMatch(text('(exec >/dev/null; echo no)'), /ends/);
  });
});
