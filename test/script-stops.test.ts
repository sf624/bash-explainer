// What may keep a shell from a line (src/semantics/scriptstops.ts), against real bash: each row runs in bash with two lines after it, and a
// `sure` stop or none is what bash does. A `may` stop has a row each way: what it does depends on the path or on a value.
import * as assert from 'assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { hostReadAs, reachedAt, readAs, type Stop, stopBefore } from '../src/semantics/scriptstops';
import { createUnbashParser } from '../src/syntax/adapters/unbash';

const parser = createUnbashParser();

/** What bash does: gets to the line after it or not; run as a script, sourced or as a login shell. `null`: not run here. */
type Run = 'stops' | 'goes-on' | 'stops-sourced' | 'stops-login' | null;

const ROWS: [text: string, stop: Stop | undefined, run: Run][] = [
  // What ends the shell, as a statement of the script.
  ['exit 0', 'sure', 'stops'],
  ['exit', 'sure', 'stops'],
  ['echo a; exit 0', 'sure', 'stops'],
  ['exit 0 >&2', 'sure', 'stops'],
  ['"ex"it 0', 'sure', 'stops'],
  ['command exit 0', 'sure', 'stops'],
  ['builtin exit 0', 'sure', 'stops'],
  ['command -p exit 0', 'sure', 'stops'],
  ['command -- exit 0', 'sure', 'stops'],
  // (In a script, `return` and `logout` say so and go on. A file sourced, or a login shell's, is what has them.)
  ['return 0', 'sure', 'stops-sourced'],
  ['logout', 'sure', 'stops-login'],
  // `exec` with a command, anywhere.
  ['exec true', 'sure', 'stops'],
  ['exec -- true', 'sure', 'stops'],
  ['exec -c true', 'sure', 'stops'],
  ['exec -a x true', 'sure', 'stops'],
  ['exec -cla x true', 'sure', 'stops'],
  ['x=true; exec "$x"', 'sure', 'stops'],
  ["'''exec' true \"$0\"", 'sure', 'stops'],
  ['"exec" true', 'sure', 'stops'],
  ['{ exec true; }', 'sure', 'stops'],
  ['exec true || exit 1', 'sure', 'stops'],
  ['command exec true', 'sure', 'stops'],
  ['builtin exec true', 'sure', 'stops'],
  ['if true; then exec true; else exec true; fi', 'sure', 'stops'],
  ['for p in true; do exec "$p"; done', 'sure', 'stops'],
  ['f() { exec true; }\nf', 'sure', 'stops'],
  // (Silent on the path that does not take it, and with no word left: a loss, never a false claim. The word is enough.)
  ['if false; then exec true; fi', 'sure', 'goes-on'],
  ['exec $nothing', 'sure', 'goes-on'],
  // `eval` of a text known to end the shell.
  ["eval 'exec true'", 'sure', 'stops'],
  ['eval "exit 0"', 'sure', 'stops'],
  ["eval 'exec true -x -wS $0 ${1+\"$@\"}'\n  if 0;", 'sure', 'stops'],
  // The options of `set` after which nothing more runs.
  ['set -n', 'sure', 'stops'],
  ['set -xn', 'sure', 'stops'],
  ['set -t', 'sure', 'stops'],
  ['set -o noexec', 'sure', 'stops'],
  ['set -eo noexec', 'sure', 'stops'],
  ['set -o onecmd', 'sure', 'stops'],
  ['command set -n', 'sure', 'stops'],

  // What may end it: in a function, a branch, a list.
  ['f() { exit 0; }\nf', 'may', 'stops'],
  ['f() { exit 0; }', 'may', 'goes-on'],
  ['if true; then exit 0; fi', 'may', 'stops'],
  ['if false; then exit 0; fi', 'may', 'goes-on'],
  ['true && exit 0', 'may', 'stops'],
  ['true || exit 1', 'may', 'goes-on'],
  ['{ exit 0; }', 'may', 'stops'],
  ['if true; then return 0; fi', 'may', 'stops-sourced'],
  ['if false; then logout; fi', 'may', 'goes-on'],
  // In a subshell the script goes on, but what follows in the subshell may not run.
  ['(exit 0)', 'may', 'goes-on'],
  ['(exec true)', 'may', 'goes-on'],
  ['exec true | cat', 'may', 'goes-on'],
  ['exec true &', 'may', 'goes-on'],
  ['x=$(exit 0)', 'may', 'goes-on'],
  ['x=$(exec true)', 'may', 'goes-on'],
  ['cat <(exec true) >/dev/null', 'may', 'goes-on'],
  ['(set -n)', 'may', 'goes-on'],
  // What runs code not read here, or changes how the rest is read.
  ['trap "exit 0" DEBUG', 'may', 'stops'],
  ['trap "rm -f t" EXIT', 'may', 'goes-on'],
  ['echo "exit 0" > f.inc\nsource ./f.inc', 'may', 'stops'],
  ['echo "exit 0" > f.inc\n. ./f.inc', 'may', 'stops'],
  [': > f.inc\n. ./f.inc', 'may', 'goes-on'],
  ['x="exit 0"; eval "$x"', 'may', 'stops'],
  ['eval "echo a"', 'may', 'goes-on'],
  ['eval', 'may', 'goes-on'],
  ['alias a=b', 'may', 'goes-on'],
  ['shopt -s expand_aliases', 'may', 'goes-on'],
  ['kill -9 $$', 'may', 'stops'],
  ['mapfile -C "exit 0;" -c 1 x </etc/passwd', 'may', 'stops'],
  ['readarray -tC "exit 0;" -c 1 x </etc/passwd', 'may', 'stops'],
  ['command mapfile -C "exit 0;" -c 1 x </etc/passwd', 'may', 'stops'],
  ['mapfile $o x </etc/passwd', 'may', 'goes-on'],
  // A word read only when it runs may be the option or the name that stops.
  ['e=exit; $e 0', 'may', 'stops'],
  ['e=true; $e 0', 'may', 'goes-on'],
  ['"$@"', 'may', 'goes-on'],
  ['c=exit; command $c 0', 'may', 'stops'],
  ['c=exit; builtin $c 0', 'may', 'stops'],
  ['c=exit; command -p "$c" 0', 'may', 'stops'],
  ['c=true; command "$c"', 'may', 'goes-on'],
  ['o=-n; set $o', 'may', 'stops'],
  ['o=-e; set $o', 'may', 'goes-on'],
  ['o=-n; set -x $o', 'may', 'stops'],
  ['o=noexec; set -o $o', 'may', 'stops'],

  // What stops nothing.
  ['exec 3>&1', undefined, 'goes-on'],
  ['exec 2>/dev/null', undefined, 'goes-on'],
  ['exec -c', undefined, 'goes-on'],
  ['exec -l', undefined, 'goes-on'],
  ['exec -a foo', undefined, 'goes-on'],
  ['exec --', undefined, 'goes-on'],
  ['exec', undefined, 'goes-on'],
  ['exec -x foo', undefined, 'goes-on'],
  ['set -- "$x"', undefined, 'goes-on'],
  ['set -- -n', undefined, 'goes-on'],
  ['set a -n', undefined, 'goes-on'],
  ['set a "$x"', undefined, 'goes-on'],
  ['set - -n', undefined, 'goes-on'],
  ['set -e -- -n', undefined, 'goes-on'],
  ['set +n', undefined, 'goes-on'],
  ['set +o noexec', undefined, 'goes-on'],
  ['set -o', undefined, 'goes-on'],
  ['set -e', undefined, 'goes-on'],
  ['set -u', undefined, 'goes-on'],
  ['set -x', undefined, 'goes-on'],
  ['set -euo pipefail', undefined, 'goes-on'],
  ['set', undefined, 'goes-on'],
  ['command -v exit', undefined, 'goes-on'],
  ['command -V exit', undefined, 'goes-on'],
  ['command -v "$x"', undefined, 'goes-on'],
  ['command -pv "$x"', undefined, 'goes-on'],
  ['command echo a', undefined, 'goes-on'],
  ['command', undefined, 'goes-on'],
  ['command --', undefined, 'goes-on'],
  ['builtin echo a', undefined, 'goes-on'],
  ['f() { return 0; }', undefined, 'goes-on'],
  ['f() { return 0; }\nf', undefined, 'goes-on'],
  ['echo exit', undefined, 'goes-on'],
  ["echo 'exit'", undefined, 'goes-on'],
  ['# exit 0', undefined, 'goes-on'],
  ['x=1', undefined, 'goes-on'],
  ['mapfile -t x </etc/passwd', undefined, 'goes-on'],
  ['hasOwnProperty', undefined, 'goes-on'],
];

/** The output of bash given `text`, then a command that `-t` runs, then the mark, as bash takes it in `how`. */
function runs(text: string, how: Run, dir: string): boolean {
  const file = path.join(dir, 'script');
  fs.writeFileSync(file, `${text}\n:\necho REACHED\n`);
  const args = how === 'stops-login' ? ['--login', '--noprofile', file] : how === 'stops-sourced' ? ['-c', `. "${file}"`] : [file];
  // (A file sourced by `-c`: `exit` would end the shell too, so the mark tells the lines apart.)
  const r = spawnSync('bash', args, { encoding: 'utf8', cwd: dir, input: '', env: { PATH: process.env.PATH, FUNCNEST: '50' }, timeout: 10000 });
  return r.stdout.includes('REACHED');
}

describe('what may keep a shell from a line', () => {
  it('each row of the table, read from the text', () => {
    for (const [text, stop] of ROWS) assert.strictEqual(stopBefore(parser.parse(`${text}\n`), text.length + 1), stop, text);
  });

  it('each row of the table, as bash runs it', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bash-explainer-stops-'));
    try {
      for (const [text, , how] of ROWS) if (how) assert.strictEqual(runs(text, how, dir), how === 'goes-on', `${how}: ${text}`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a stop counts from where it has ended: the words of the command are read first', () => {
    const tree = parser.parse('echo a; exit $((09))\necho b\n');
    assert.strictEqual(stopBefore(tree, tree.text.indexOf('09')), undefined);
    assert.strictEqual(stopBefore(tree, tree.text.indexOf('echo b')), 'sure');
  });

  it('the strongest of those before it', () => {
    const tree = parser.parse('trap a EXIT\nx\nexit 0\ny\n');
    assert.strictEqual(stopBefore(tree, tree.text.indexOf('trap')), undefined);
    assert.strictEqual(stopBefore(tree, tree.text.indexOf('x\n')), 'may');
    assert.strictEqual(stopBefore(tree, tree.text.indexOf('y\n')), 'sure');
  });

  it('only those of the shell that started on the row given', () => {
    const tree = parser.parse('exit 0\ntrap a EXIT\nx\nexit 0\ny\n');
    const at = tree.text.indexOf('x\n');
    assert.strictEqual(stopBefore(tree, at), 'sure');
    assert.strictEqual(stopBefore(tree, at, 1), 'may');
    assert.strictEqual(stopBefore(tree, at, 2), undefined);
    assert.strictEqual(stopBefore(tree, tree.text.length, 2), 'sure');
    assert.strictEqual(stopBefore(tree, tree.text.length, 5), undefined);
  });

  it('gives the level of a fault of the text, and whether a command is reached', () => {
    const none = parser.parse('x\n');
    const may = parser.parse('trap a EXIT\nx\n');
    const sure = parser.parse('exit 0\nx\n');
    const at = (t: typeof none) => t.text.indexOf('x\n');
    assert.deepStrictEqual([readAs(none, at(none), 'said'), readAs(none, at(none), 'name'), readAs(none, at(none), undefined)], ['known', 'unsure', undefined]);
    assert.deepStrictEqual([readAs(may, at(may), 'said'), readAs(may, at(may), 'name'), readAs(may, at(may), undefined)], ['unsure', 'unsure', undefined]);
    assert.deepStrictEqual([readAs(sure, at(sure), 'said'), readAs(sure, at(sure), 'name')], [undefined, undefined]);
    assert.deepStrictEqual([hostReadAs(none, at(none), undefined), hostReadAs(may, at(may), undefined), hostReadAs(sure, at(sure), undefined), hostReadAs(sure, at(sure), 1)], ['known', 'unsure', undefined, 'known']);
    assert.deepStrictEqual([reachedAt(none, at(none)), reachedAt(may, at(may)), reachedAt(sure, at(sure)), reachedAt(sure, at(sure), 1)], [true, true, false, true]);
  });

  it('keeps nothing of a text a shell does not read as it is written', () => {
    for (const text of ['x\n{{ y }}\n', '#!/bin/bash -t\nx\n', 'x\0\n']) assert.strictEqual(readAs(parser.parse(text), 0, 'said'), undefined, JSON.stringify(text));
  });
});
