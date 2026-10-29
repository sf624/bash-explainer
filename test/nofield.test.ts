// Whether a word may give no field (src/semantics/nofield.ts), against bash: where the model says it may, a script that
// sets the values it does not know gives none; where it says it may not, the word gives one or more fields with the
// values it does not know empty or unset, and with an IFS of digits.
import * as assert from 'assert';
import { mayGiveNoField } from '../src/semantics/nofield';
import { shellState } from '../src/semantics/state';
import type { Shell } from '../src/shellfeatures';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { descendants } from '../src/syntax/tree';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runBash } from './support/bash';

/** A word of the last line of `src` (`echo WORD` or `cat > WORD`), what the model says, and a script that shows bash's case. */
interface Row { src: string; word: string; none: boolean; shell?: Shell; witness?: string; script?: string }

const ROWS: Row[] = [
  { src: 'echo $!$b', word: '$!$b', none: true },
  // (`$-` is empty after `set +hB` in a script file: `bash -c` keeps its `c`.)
  { src: 'echo $-$b', word: '$-$b', none: true, script: "printf '%s\\n' 'set +hB' 'set -- $-$b; echo $#' > s.sh; bash s.sh" },
  { src: 'echo ${x:-}$b', word: '${x:-}$b', none: true },
  { src: 'echo ${x:-y}$b', word: '${x:-y}$b', none: true, witness: "x=' '" },
  { src: 'echo $((0))$b', word: '$((0))$b', none: false },
  { src: 'echo $#$b', word: '$#$b', none: false },
  { src: 'echo {,}$b', word: '{,}$b', none: true },
  { src: 'echo {a,}$b', word: '{a,}$b', none: false },
  // (Braces first: `$ba` and `$bb`.)
  { src: 'b=\necho $b{a,b}', word: '$b{a,b}', none: true },
  { src: 'x=\necho ${x:-""}$1', word: '${x:-""}$1', none: false },
  { src: 'echo "$a"$b', word: '"$a"$b', none: false },
  // (A tilde prefix of a user not known here is a word: the home directory, or the text as it is.)
  { src: 'echo ~nosuchuser$b', word: '~nosuchuser$b', none: false },
  // (A word bash fails on is an error, not no word.)
  { src: 'unset x\necho ${x:?}$b', word: '${x:?}$b', none: false },
  { src: "IFS=:\nx=:\necho $x$x", word: '$x$x', none: false },
  { src: "IFS=$v\nx=' '\necho $x$x", word: '$x$x', none: true, witness: "v=' '" },
  // (A redirection: bash fails on no word, also in POSIX mode; dash opens the empty name.)
  { src: 'cat > $a$b', word: '$a$b', none: true },
  { src: 'set -o posix\ncat > $a$b', word: '$a$b', none: true },
  { src: 'cat > $a$b', word: '$a$b', none: false, shell: 'dash' },
  { src: 'cat > $1$2', word: '$1$2', none: false, shell: 'sh' },
  // (`"$@"` alone in its quotes is no word when there are no elements; with text in the quotes, it is one.)
  { src: 'echo "${a[@]}"$b', word: '"${a[@]}"$b', none: true, witness: 'a=()' },
  { src: 'echo "${a[@]:0}"$b', word: '"${a[@]:0}"$b', none: true, witness: 'a=()' },
  { src: 'echo "${a[@]#x}"$b', word: '"${a[@]#x}"$b', none: true, witness: 'a=()' },
  { src: 'echo "${!a[@]}"$b', word: '"${!a[@]}"$b', none: true, witness: 'a=()' },
  { src: 'echo "${@:+x}"$b', word: '"${@:+x}"$b', none: true },
  // (With `-`, `:-` the word instead, in its quotes; with `?`, `:?` an error; the elements in a `${x:+…}` are in quotes.)
  { src: 'echo "${a[@]:-}"$b', word: '"${a[@]:-}"$b', none: false },
  { src: 'echo "${a[@]-}"$b', word: '"${a[@]-}"$b', none: false },
  { src: 'echo "${@:-}"$b', word: '"${@:-}"$b', none: false },
  { src: 'echo "${@-}"$b', word: '"${@-}"$b', none: false },
  { src: 'echo "${@-}"$b', word: '"${@-}"$b', none: false, shell: 'sh' },
  { src: 'echo "${@?}"$b', word: '"${@?}"$b', none: false },
  { src: 'unset x\necho "${x:-"$@"}"$b', word: '"${x:-"$@"}"$b', none: false },
  { src: 'x=1\necho "${x:+"$@"}"$b', word: '"${x:+"$@"}"$b', none: false },
  { src: 'echo "$@"x', word: '"$@"x', none: false },
  { src: 'echo "x$@"$b', word: '"x$@"$b', none: false },
];

/** The output of `script` (stdout and stderr) in bash, or in dash, in a directory of its own. */
function run(script: string, shell: 'bash' | 'dash'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explain-bash-nofield-'));
  try {
    if (shell === 'bash') return runBash(`{ ${script}\n} 2>&1; true`, { cwd: dir }).stdout.trim();
    const r = spawnSync('dash', ['-c', `{ ${script}\n} 2>&1; true`], { cwd: dir, encoding: 'utf8', timeout: 10000, env: { PATH: '/usr/bin:/bin' } });
    return r.stdout.trim();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const hasDash = spawnSync('dash', ['-c', 'true']).status === 0;

describe('whether a word may give no field (src/semantics/nofield.ts), against bash', () => {
  for (const row of ROWS) {
    it(`${row.src.replace(/\n/g, '; ')}${row.shell ? ` (${row.shell})` : ''}: ${row.none ? 'may give none' : 'gives a field'}`, () => {
      const tree = createUnbashParser().parse(row.src);
      const model = shellState(tree, row.shell ?? 'bash');
      const n = descendants(tree.root, ['concatenation']).find((c) => c.text === row.word)!;
      assert.strictEqual(mayGiveNoField(n, model), row.none);
      // bash: the word as the arguments of `set --`, or as the target of a redirection.
      const redirect = row.src.includes('cat > ');
      const body = row.src.replace(/^(echo|cat >) .*$/m, redirect ? `: > ${row.word} && echo opened` : `set -- ${row.word}; echo $#`);
      const dash = row.shell === 'dash' || row.shell === 'sh';
      if (dash && !hasDash) return;
      const runs = row.script ? [row.script] : row.none ? [`${row.witness ?? ':'}\n${body}`] : ['', 'IFS=0\n'].map((p) => `${p}${body}`);
      for (const script of runs) {
        const out = run(script, dash ? 'dash' : 'bash');
        if (redirect) assert.match(out, row.none ? /ambiguous redirect/ : /cannot create|No such file/, script);
        else assert.strictEqual(out === '0', row.none, `${script}: ${out}`);
      }
    });
  }
});
