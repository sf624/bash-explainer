import * as assert from 'assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Analyzer } from '../src/analyzer';
import type { Token } from '../src/analyzer-types';
import { arithLiteralIn } from '../src/arith';
import { readSaid } from '../src/messages-tokens';
import type { Shell } from '../src/shellfeatures';
import { createUnbashParser } from '../src/syntax/adapters/unbash';

// A constant of arithmetic, as each shell reads it, against the real shell: what the explanation says of `09` (and what it does
// not say) is true in the shell the script is read as. Without a shell, its rows are skipped, as in test/dialect.test.ts.

const parser = createUnbashParser();
const tokens = (ts: readonly Token[]): Token[] => ts.flatMap((t) => [t, ...tokens(t.children)]);
/** The marked text about a number on the first line of `src` with `09` or `((`, in a script for `shell`. */
const saidOf = (src: string, shell: Shell | undefined): { id: string; level: string; text: string } | undefined => {
  const items = new Analyzer('en').explainLine(parser.parse(src), src.split('\n').findIndex((l) => /09|\(\(/.test(l)), shell).items;
  const mark = tokens(items).flatMap((t) => t.marks ?? []).find((m) => m.id.startsWith('arith-invalid-number'));
  return mark && { id: mark.id, level: mark.level, text: readSaid(mark.text).text };
};

function locate(names: string[]): string | undefined {
  const dirs = [process.env.BASH_EXPLAINER_SHELLS, ...(process.env.PATH ?? '').split(':')].filter(Boolean) as string[];
  for (const n of names) for (const d of dirs) if (fs.existsSync(path.join(d, n))) return path.join(d, n);
  return undefined;
}

const SHELLS: [Shell, string[], string[]][] = [
  ['bash', ['bash'], ['--norc']], ['dash', ['dash'], []], ['ash', ['busybox'], ['sh']], ['yash', ['yash'], []], ['ksh', ['ksh93', 'ksh'], []], ['mksh', ['mksh'], []], ['zsh', ['zsh'], ['-f']],
];
const CONSTANTS = ['09', '08', '010', '1a', '0xG', '0x1f', '0x', '2#101', '36#z', '37#1', '64#_', '2#2', '1#1', '65#1', '2#', '0#1', '09#1', '010#1', '08a'];

describe('a constant of arithmetic, in each shell', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arith-shells-'));
  const file = path.join(dir, 's');
  after(() => { fs.rmSync(file, { force: true }); fs.rmdirSync(dir); });

  /** Runs a script file in a shell, with a limit. */
  const run = (bin: string, flags: string[], text: string) => {
    fs.writeFileSync(file, text);
    return spawnSync(bin, [...flags, file], { encoding: 'utf8', timeout: 5000, killSignal: 'SIGKILL', env: { ...process.env, FUNCNEST: '50' } });
  };

  for (const [shell, names, flags] of SHELLS) {
    const bin = locate(names);
    (bin ? describe : describe.skip)(shell, () => {
      it('says of each constant what the shell does: its value, or that it rejects it, or nothing', function () {
        this.timeout(30000);
        // (One process: each constant in a subshell of its own, with the status after it.)
        const script = CONSTANTS.map((c) => `( echo $((${c})) ) 2>/dev/null; echo "status $?"`).join('\n');
        // (A shell that cannot parse one of the lines is run on each by itself.)
        const out = CONSTANTS.map((c, i) => run(bin!, flags, `${script.split('\n')[i]}\n`).stdout.trim().split('\n'));
        CONSTANTS.forEach((c, i) => {
          const lit = arithLiteralIn(c, shell);
          const status = out[i][out[i].length - 1];
          if (lit?.type === 'number') assert.deepStrictEqual(out[i], [lit.value, 'status 0'], `${c} in ${shell}`);
          else if (lit?.type === 'invalid') assert.notStrictEqual(status, 'status 0', `${c} in ${shell}`);
        });
      });
    });
  }

  const rejecting: [Shell, string[], string[]][] = SHELLS.filter(([s]) => ['dash', 'ash'].includes(s));
  for (const [shell, names, flags] of rejecting) {
    const bin = locate(names);
    (bin ? it : it.skip)(`stops ${shell} at an expansion, where it says so, and only its subshell in a subshell`, () => {
      assert.match(saidOf('echo $((09)); echo same', shell)!.text, /reports an arithmetic error and stops$/);
      const stops = run(bin!, flags, 'echo $((09)); echo same\necho next\n');
      assert.deepStrictEqual([stops.status === 0, stops.stdout], [false, '']);
      assert.match(saidOf('(echo $((09)); echo in); echo a', shell)!.text, /nor the rest of its subshell$/);
      assert.strictEqual(run(bin!, flags, '(echo $((09)); echo in); echo a\n').stdout, 'a\n');
    });
  }

  describe('what the explanation says, by the shell the script is read as', () => {
    it('reads each constant as the shell does, also with no such shell here', () => {
      const style = (text: string, shell: Shell | undefined) => { const l = arithLiteralIn(text, shell); return l?.type === 'number' ? l.style : l?.type; };
      for (const shell of ['ash', 'ksh', 'mksh', 'zsh'] as const) assert.strictEqual(style('2#101', shell), 'based', shell);
      for (const shell of ['sh', 'dash', 'yash'] as const) assert.strictEqual(style('2#101', shell), undefined, shell);
      assert.strictEqual(style('37#1', 'ash'), undefined);
      assert.strictEqual(style('2#2', 'zsh'), undefined);
      for (const shell of ['sh', 'dash', 'ash'] as const) assert.deepStrictEqual([style('09', shell), style('010', shell), style('08a', shell)], ['invalid', 'octal', 'invalid'], shell);
      assert.deepStrictEqual([style('09', 'yash'), style('010', 'yash'), style('08a', 'yash')], ['decimal', 'octal', undefined]);
      for (const shell of ['ksh', 'mksh', 'zsh'] as const) assert.deepStrictEqual([style('09', shell), style('010', shell), style('08a', shell)], ['decimal', 'decimal', undefined], shell);
      assert.deepStrictEqual([style('0x', 'dash'), style('0x1f', 'dash'), style('1a', 'zsh'), style('1a', undefined), style('x', 'zsh')], [undefined, 'hex', 'invalid', 'invalid', undefined]);
    });

    it('says it only where the shell rejects the constant, and names that shell', () => {
      assert.match(saidOf('echo $((09))', undefined)!.text, /^Invalid number `09`: .*\. bash reports an arithmetic error/);
      assert.match(saidOf('echo $((09))', 'bash')!.text, /\. bash reports/);
      assert.match(saidOf('echo $((09))', 'sh')!.text, /\. POSIX sh reports an arithmetic error and stops$/);
      assert.match(saidOf('echo $((09))', 'dash')!.text, /\. dash reports/);
      assert.match(saidOf('echo $((09))', 'ash')!.text, /\. busybox ash reports/);
      for (const shell of ['zsh', 'mksh', 'ksh', 'yash'] as const) assert.strictEqual(saidOf('echo $((09))', shell), undefined, shell);
      // (A letter is wrong in each of them, and each stops.)
      assert.match(saidOf('echo $((1a))', 'zsh')!.text, /\. zsh reports an arithmetic error and stops$/);
      // (Of a `base#digits` other shells do not take alike, nothing.)
      assert.match(saidOf('echo $((2#2))', 'bash')!.text, /`2` is not a digit in base 2/);
      assert.strictEqual(saidOf('echo $((2#2))', 'zsh'), undefined);
    });

    it('says nothing of `(( ))` and `let` in another shell, which most do not have', () => {
      for (const src of ['(( 09 ))', '(( a[09] ))', 'let x=09']) {
        assert.ok(saidOf(src, 'bash'), src);
        for (const shell of ['sh', 'dash', 'zsh'] as const) assert.strictEqual(saidOf(src, shell), undefined, `${src} in ${shell}`);
      }
    });

    it('reads a number with its own base in each shell: `010` is 10 in zsh, and no octal is said', () => {
      const octal = (shell: Shell | undefined) => tokens(new Analyzer('en').explainLine(parser.parse('echo $((010))'), 0, shell).items).some((t) => /Octal number/.test(t.explanation));
      assert.ok(octal(undefined));
      assert.ok(octal('dash'));
      assert.ok(octal('yash'));
      for (const shell of ['zsh', 'mksh', 'ksh'] as const) assert.ok(!octal(shell), shell);
      const test = (shell: Shell | undefined) => tokens(new Analyzer('en').explainLine(parser.parse('[[ 1 -eq 09 ]]'), 0, shell).items).some((t) => /no valid number/.test(t.explanation));
      assert.ok(test(undefined));
      assert.ok(!test('zsh'));
    });

    it('says what a line does in `let` in another shell only for a good constant', () => {
      const said = (src: string, shell: Shell) => tokens(new Analyzer('en').explainLine(parser.parse(src), 0, shell).items).map((t) => t.explanation).join(' ');
      assert.doesNotMatch(said('let x=010', 'zsh'), /Octal/);
      assert.match(said('let x=010', 'ash'), /Octal number/);
      assert.doesNotMatch(said('let x=2#2', 'zsh'), /Invalid number/);
      assert.match(said('let x=2#101', 'zsh'), /Binary number/);
    });
  });

  describe('in bash, against bash', () => {
    const bash = locate(['bash']);
    // [the script, what is said after the error's words (none: nothing is said), what it prints, its status]
    const ROWS: [string, RegExp | undefined, string, number][] = [
      // Expansions: the command does not run, nor the rest of the line or block; a script goes on after them.
      ['echo $((09)); echo same\necho next', /this command does not run, nor the rest of its line or block$/, 'next\n', 0],
      ['x=$((09)); echo same', /nor the rest of its line or block$/, '', 1],
      ['echo a > $((09)); echo same', /nor the rest of its line or block$/, '', 1],
      ['x=abc; echo ${x#$((09))}; echo same', /nor the rest of its line or block$/, '', 1],
      ['echo $(( 1 || 09 )); echo same', /nor the rest of its line or block$/, '', 1],
      ['echo $(( 1 ? 2 : 09 )); echo same', /nor the rest of its line or block$/, '', 1],
      ['echo $(( 1 || $((09)) )); echo same', /nor the rest of its line or block$/, '', 1],
      ['(( 1 || 09 )); echo "after $?"', /this command fails with status 1$/, 'after 1\n', 0],
      ['(( $((09)) )); echo same', /nor the rest of its line or block$/, '', 1],
      ['(( a[09] )); echo same', /nor the rest of its line or block$/, '', 1],
      ['if true; then\n echo $((09))\n echo inside\nfi\necho next', /nor the rest of its line or block$/, 'next\n', 0],
      ['case $((09)) in x) ;; esac; echo same', /nor the rest of its line or block$/, '', 1],
      ['case x in $((09))|y) ;; esac; echo same', /nor the rest of its line or block$/, '', 1],
      ['[[ $((09)) == 1 || 1 == 1 ]]; echo same', /nor the rest of its line or block$/, '', 1],
      // In a subshell: its rest.
      ['(echo $((09)); echo in); echo out', /nor the rest of its subshell$/, 'out\n', 0],
      ['echo $((09)) | cat; echo out', /nor the rest of its subshell$/, 'out\n', 0],
      ['echo "$(echo $((09)); echo in)"; echo out', /nor the rest of its subshell$/, '\nout\n', 0],
      // Only the command fails, with status 1.
      ['(( 09 )); echo "after $?"', /this command fails with status 1$/, 'after 1\n', 0],
      ['let x=09; echo "after $?"', /this command fails with status 1$/, 'after 1\n', 0],
      ['for ((i=09;;)); do :; done; echo "after $?"', /this command fails with status 1$/, 'after 1\n', 0],
      ['for ((i=0;i<09;)); do :; done; echo "after $?"', /this command fails with status 1$/, 'after 1\n', 0],
      ['cat <<E; echo "after $?"\n$((09))\nE', /this command fails with status 1$/, 'after 1\n', 0],
      // Where the shell may never read it: this path does not, the line runs.
      ['x=1; echo ${x:-$((09))}; echo same', /^.*If bash reads it, it reports/, '1\nsame\n', 0],
      ['x=1; echo ${x-$((09))}; echo same', /If bash reads it/, '1\nsame\n', 0],
      ['x=1; echo ${x:=$((09))}; echo same', /If bash reads it/, '1\nsame\n', 0],
      ['x=1; echo ${x=$((09))}; echo same', /If bash reads it/, '1\nsame\n', 0],
      ['x=1; echo ${x:?$((09))}; echo same', /If bash reads it/, '1\nsame\n', 0],
      ['x=1; echo ${x?$((09))}; echo same', /If bash reads it/, '1\nsame\n', 0],
      ['echo ${y:+$((09))}; echo same', /If bash reads it/, '\nsame\n', 0],
      ['echo ${y+"a$((09))"}; echo same', /If bash reads it/, '\nsame\n', 0],
      ['[[ 1 == 1 || $((09)) == 1 ]]; echo same', /If bash reads it/, 'same\n', 0],
      ['[[ 1 == 2 && $((09)) == 1 ]]; echo same', /If bash reads it/, 'same\n', 0],
      ['case x in x) ;; $((09))) ;; esac; echo same', /If bash reads it/, 'same\n', 0],
      ['case x in x|$((09))) ;; esac; echo same', /If bash reads it/, 'same\n', 0],
      ['for ((i=0;i<0;i+=09)); do :; done; echo same', /If bash reads it/, 'same\n', 0],
      // Beside an expansion it is no constant: nothing is said, and the line runs.
      ['x=1; echo $(( ${x}09 ))', undefined, '109\n', 0],
      ['x=1; echo $(( 1${x}09 ))', undefined, '1109\n', 0],
      ['x=1; echo $(( $x$((1))09 ))', undefined, '1109\n', 0],
      ['x=1; echo $(( ${x}010 ))', undefined, '1010\n', 0],
      ['declare -A m; m[k]=1; echo "${m[09]}"; echo same', undefined, '\nsame\n', 0],
    ];
    for (const [src, says, out, status] of ROWS) {
      (bash ? it : it.skip)(JSON.stringify(src), () => {
        const said = saidOf(src, undefined);
        if (says) {
          assert.match(said!.text, says);
          assert.strictEqual(said!.level, /If bash reads it/.test(says.source) ? 'warning' : 'error');
        } else assert.strictEqual(said, undefined);
        const r = run(bash!, ['--norc'], `${src}\n`);
        assert.deepStrictEqual([r.stdout, r.status], [out, status]);
      });
    }

    (bash ? it : it.skip)('stops only in POSIX mode', () => {
      const r = run(bash!, ['--norc', '--posix'], 'echo $((09)); echo same\necho next\n');
      assert.deepStrictEqual([r.stdout, r.status], ['', 1]);
    });
  });
});
