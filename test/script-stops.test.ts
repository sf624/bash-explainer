// What may keep a shell from a line (src/semantics/scriptstops.ts), against real bash: each row runs in bash with two lines after it, and a
// `sure` stop or none is what bash does. A `may` stop has a row each way: what it does depends on the path or on a value.
import * as assert from 'assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { hostReadAs, reachedAt, readAs, type Stop, stopBefore } from '../src/semantics/scriptstops';
import { shellState } from '../src/semantics/state';
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
  ['exit 0 || echo a', 'sure', 'stops'],
  // `exec` with a command, at the top of the script.
  ['exec true', 'sure', 'stops'],
  ['exec -- true', 'sure', 'stops'],
  ['exec -c true', 'sure', 'stops'],
  ['exec -a x true', 'sure', 'stops'],
  ['exec -cla x true', 'sure', 'stops'],
  ['x=true; exec "$x"', 'sure', 'stops'],
  ["'''exec' true \"$0\"", 'sure', 'stops'],
  ['"exec" true', 'sure', 'stops'],
  ['exec true || exit 1', 'sure', 'stops'],
  ['command exec true', 'sure', 'stops'],
  ['builtin exec true', 'sure', 'stops'],
  // (With no word left it goes on: a loss, never a false claim. The word is enough.)
  ['exec $nothing', 'sure', 'goes-on'],
  // Not at the top, where it hands the script over: it names the file, or the word it runs is a shell or an interpreter. (A loss on the path that does not take it.)
  ['true && exec true "$0"', 'sure', 'stops'],
  ['if true; then exec true "${0}"; fi', 'sure', 'stops'],
  ['if true; then exec true "${BASH_SOURCE[0]}"; fi', 'sure', 'stops'],
  ['if false; then exec true "$0"; fi', 'sure', 'goes-on'],
  ['if true; then exec true "$0"; else exec true "$0"; fi', 'sure', 'stops'],
  ['for p in true; do exec "$p" "$0"; done', 'sure', 'stops'],
  ['f() { exec true "$0"; }\nf', 'sure', 'stops'],
  ['if false; then exec bash "$self"; fi', 'sure', 'goes-on'],
  ['if false; then exec /bin/sh "$self"; fi', 'sure', 'goes-on'],
  ['if false; then exec python3 "$self"; fi', 'sure', 'goes-on'],
  ['if false; then exec /x/perl -x "$self"; fi', 'sure', 'goes-on'],
  ['if false; then exec "$PYTHON" "$self"; fi', 'sure', 'goes-on'],
  ['if false; then exec "${PYTHON_BIN}" "$self"; fi', 'sure', 'goes-on'],
  ['if false; then exec "$CONFIG_SHELL" "$self"; fi', 'sure', 'goes-on'],
  ['if false; then exec env python3 "$self"; fi', 'sure', 'goes-on'],
  ['if false; then exec -a x python3 "$self"; fi', 'sure', 'goes-on'],
  ['if false; then builtin command exec python3 "$self"; fi', 'sure', 'goes-on'],
  ['if false; then command exec -- python3 "$self"; fi', 'sure', 'goes-on'],
  ["if false; then eval 'exec perl -S $0'; fi", 'sure', 'goes-on'],
  ["if false; then eval 'exec perl -S x'; fi", 'sure', 'goes-on'],
  // Or where what follows is what the parser cannot read, another language's.
  ['if true; then exec true; fi\nfi', 'sure', 'stops'],
  ['if true; then set -n; fi\nfi', 'sure', 'stops'],
  // `eval` of a text known to end the shell, by this table.
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
  // `exec`, `eval` and `set` that may be one path's end, where nothing says they hand the script over.
  ['{ exec true; }', 'may', 'stops'],
  ['if true; then exec echo; fi', 'may', 'stops'],
  ['if false; then exec echo "$usage"; fi', 'may', 'goes-on'],
  ['if true; then exec true; else exec true; fi', 'may', 'stops'],
  ['for p in true; do exec "$p"; done', 'may', 'stops'],
  ['f() { exec true; }\nf', 'may', 'stops'],
  ['f() { exec true; }', 'may', 'goes-on'],
  ['true && exec ./start.sh', 'may', 'stops'],
  ['true && exec true', 'may', 'stops'],
  ['if true; then command exec true; fi', 'may', 'stops'],
  ['if true; then eval "exec true"; fi', 'may', 'stops'],
  ['{ set -n; }', 'may', 'stops'],
  ['if true; then set -o noexec; fi', 'may', 'stops'],
  ['if false; then set -n; fi', 'may', 'goes-on'],
  // In a subshell the script goes on, but what follows in the subshell may not run.
  ['(exit 0)', 'may', 'goes-on'],
  ['(exec true)', 'may', 'goes-on'],
  ['exec true | cat', 'may', 'goes-on'],
  ['echo a | exec cat', 'may', 'goes-on'],
  ['echo a | exec cat "$0" > /dev/null', 'may', 'goes-on'],
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
  ["eval 'exec 3>&1'", 'may', 'goes-on'],
  ["eval 'echo exit'", 'may', 'goes-on'],
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
  // What ends the shell when a variable has no value.
  [': "${x:?}"', 'may', 'stops'],
  [': "${x?}"', 'may', 'stops'],
  ['y=${1:?usage}', 'may', 'stops'],
  [': "${x:?a}" "${y:-b}"', 'may', 'stops'],
  ['x=; : "${x:?}"', 'may', 'stops'],
  ['x=1; : "${x:?}"', undefined, 'goes-on'],
  ['x=; : "${x?}"', undefined, 'goes-on'],
  ['(: "${x:?}")', undefined, 'goes-on'],
  ['y=$(: "${x:?}")', undefined, 'goes-on'],
  [': "${x:-a}"', undefined, 'goes-on'],
  [': "${x%?}"', undefined, 'goes-on'],
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

  it('counts what the model says never runs as after a sure stop, where it knows, and where the tree has no error', () => {
    const at = (text: string, mark = 'x = 1') => {
      const tree = parser.parse(text);
      const model = shellState(tree, 'bash');
      const i = tree.text.indexOf(mark);
      return [readAs(tree, i, 'said', model), reachedAt(tree, i, undefined, model)];
    };
    for (const text of ['while :; do :; done\nx = 1\n', 'if true; then exit; fi\nx = 1\n', '{ exit 0; }\nx = 1\n', 'if false; then x = 1; fi\n', 'if a; then exit; else exit; fi\nx = 1\n', 'f() { exit; x = 1; }\nf\n']) {
      assert.deepStrictEqual(at(text), [undefined, false], text);
      // (bash does not get there; the loop runs until the timeout.)
      assert.doesNotMatch(spawnSync('bash', ['-c', text.replace('x = 1', 'echo REACHED')], { encoding: 'utf8', env: { PATH: process.env.PATH, FUNCNEST: '50' }, timeout: 300 }).stdout, /REACHED/, text);
    }
    for (const text of ['x = 1\n', 'if a; then exit; fi\nx = 1\n', 'f() { x = 1; }\n', 'f() { exit; x = 1; }\n', 'a && { b; exit; }\nx = 1\n', 'if true; then exit; fi\nx = 1\nfi\n', 'case x in a) x = 1 ;;\n']) {
      assert.strictEqual(at(text)[1], true, text);
      assert.ok(at(text)[0], text);
    }
    // (Before what stops it, and after a statement that never runs but in it.)
    assert.deepStrictEqual(at('echo a\nif false; then y; fi\nx = 1\n'), ['known', true]);
    assert.deepStrictEqual(at('if false; then y; fi\nx = 1\nif false; then z; fi\n'), ['known', true]);
  });

  it('keeps nothing of a text a shell does not read as it is written', () => {
    for (const text of ['x\n{{ y }}\n', '#!/bin/bash -t\nx\n', 'x\0\n']) assert.strictEqual(readAs(parser.parse(text), 0, 'said'), undefined, JSON.stringify(text));
  });
});
