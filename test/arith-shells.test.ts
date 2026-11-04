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
  const items = new Analyzer('en').explainLine(parser.parse(src), src.split('\n').findIndex((l) => /09|\(\(/.test(l)), shell, { script: 'said' }).items;
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
  after(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  /** Runs a script file in a shell, with a limit. */
  const run = (bin: string, flags: string[], text: string) => {
    fs.writeFileSync(file, text);
    return spawnSync(bin, [...flags, file], { cwd: dir, encoding: 'utf8', timeout: 5000, killSignal: 'SIGKILL', env: { ...process.env, FUNCNEST: '50' } });
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

    it('says it only where the shell rejects the constant, in one text', () => {
      const text = saidOf('echo $((09))', undefined)!.text;
      assert.match(text, /^Invalid number `09`: a number starting with 0 is read as octal, and `9` is not an octal digit$/);
      for (const shell of ['bash', 'sh', 'dash', 'ash'] as const) assert.strictEqual(saidOf('echo $((09))', shell)!.text, text, shell);
      for (const shell of ['zsh', 'mksh', 'ksh', 'yash'] as const) assert.strictEqual(saidOf('echo $((09))', shell), undefined, shell);
      // (A letter is wrong in each of them.)
      assert.strictEqual(saidOf('echo $((1a))', 'zsh')!.id, 'arith-invalid-number');
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

  // What a rejected constant does to the command that holds it. Each row: the script, and what would show that the command did its
  // work (in stdout or stderr). Nothing is said, and nothing tested, of what follows the command: that depends on the shell, on a fork,
  // and on a builtin. `work` is printed if the command runs.
  const FAILS: [string, RegExp][] = [
    ['echo work $((09))', /work/],
    ['x=work\nx=$((09))\necho "x=$x"', /x=(?!work\n)/],
    ['echo work > 9\ncat < $((09))', /work/],
    ['ls /nonexistent 2> $((09))', /nonexistent/],
    ['cat <<E\nwork $((09))\nE', /work/],
    ['read x <<E\nwork $((09))\nE\necho "x=[$x]"', /x=\[work/],
    ['{ cat; } <<E\nwork $((09))\nE', /work/],
    ['{ echo work; } <<E\n$((09))\nE', /work/],
    ['echo work $((09)) | cat', /work/],
  ];
  const FAILS_IN_BASH: [string, RegExp][] = [
    ['(( 09 )) && echo work', /work/],
    ['(( x=09 ))\necho "x=[$x]"', /x=\[\d/],
    ['let x=09\necho "x=[$x]"', /x=\[\d/],
    ['for ((i=09;;)); do echo work; break; done', /work/],
    ['for ((i=0;i<09;)); do echo work; break; done', /work/],
    // (Always read: in arithmetic, also what `||` and `?:` skip; a subscript; the first pattern; the left of `||` in `[[ ]]`.)
    ['echo work $(( 1 || 09 ))', /work/],
    ['echo work $(( 1 ? 2 : 09 ))', /work/],
    ['echo work $(( 1 || $((09)) ))', /work/],
    ['(( 1 || 09 )) && echo work', /work/],
    ['(( $((09)) )) && echo work', /work/],
    ['(( a[09] )) && echo work', /work/],
    ['case $((09)) in *) echo work ;; esac', /work/],
    ['case x in $((09))|x) echo work ;; esac', /work/],
    ['[[ $((09)) == 1 || 1 == 1 ]] && echo work', /work/],
    ['a=(1); echo work ${a[$((09))]}', /work/],
    ['y=; echo ${y:-$(echo work $((09)))}', /work/],
  ];
  for (const [shell, names, flags] of SHELLS.filter(([s]) => ['bash', 'dash', 'ash'].includes(s))) {
    const bin = locate(names);
    for (const [src, work] of shell === 'bash' ? [...FAILS, ...FAILS_IN_BASH] : FAILS) {
      (bin ? it : it.skip)(`${shell}: ${JSON.stringify(src)} does not do its work`, () => {
        const said = saidOf(src, shell);
        assert.deepStrictEqual([said?.id, said?.level], ['arith-invalid-number', 'error']);
        const r = run(bin!, flags, `${src}\n`);
        assert.doesNotMatch(r.stdout + r.stderr, work);
        assert.match(r.stderr, /value too great|arithmetic/);
      });
    }
  }

  describe('in bash, against bash', () => {
    const bash = locate(['bash']);
    it('marks the command, not the path to it: this `echo` fails whenever it runs', () => {
      for (const src of ['true || echo $((09)); echo same', 'false && echo $((09))', 'if false; then echo $((09)); fi']) assert.strictEqual(saidOf(src, undefined)?.level, 'error', src);
    });

    // The same command can run without reading it: what bash then prints. (Read, it reports the error: each of the last group.)
    const NOT_READ: [string, string][] = [
      ['x=1; echo ${x:-$((09))}', '1\n'],
      ['x=1; echo ${x-$((09))}', '1\n'],
      ['x=1; echo ${x:=$((09))}', '1\n'],
      ['x=1; echo ${x=$((09))}', '1\n'],
      ['x=1; echo ${x:?$((09))}', '1\n'],
      ['x=1; echo ${x?$((09))}', '1\n'],
      ['echo ${y:+$((09))}', '\n'],
      ['echo ${y+"a$((09))"}', '\n'],
      // (Every other operator reads its word only if the value is not empty.)
      ['echo "[${y#$((09))}]"', '[]\n'],
      ['echo "[${y%%$((09))}]"', '[]\n'],
      ['echo "[${y/$((09))/z}]"', '[]\n'],
      ['echo "[${y/a/$((09))}]"', '[]\n'],
      ['echo "[${y:$((09))}]"', '[]\n'],
      ['echo "[${y:0:$((09))}]"', '[]\n'],
      ['echo "[${y^$((09))}]"', '[]\n'],
      ['echo "[${y,,$((09))}]"', '[]\n'],
      ['[[ 1 == 1 || $((09)) == 1 ]] && echo work', 'work\n'],
      ['[[ 1 == 2 && $((09)) == 1 ]] || echo work', 'work\n'],
      ['case x in x) echo work ;; $((09))) ;; esac', 'work\n'],
      ['case x in x|$((09))) echo work ;; esac', 'work\n'],
      ['for ((i=0;i<0;i+=09)); do :; done && echo work', 'work\n'],
    ];
    for (const [src, out] of NOT_READ) {
      (bash ? it : it.skip)(`may not read it: ${JSON.stringify(src)}`, () => {
        const said = saidOf(src, undefined);
        assert.deepStrictEqual([said?.id, said?.level], ['arith-invalid-number-if-read', 'warning']);
        assert.match(said!.text, /\. If the shell reads it, it reports an arithmetic error and this command stops there$/);
        const r = run(bash!, ['--norc'], `${src}\n`);
        assert.deepStrictEqual([r.stdout, r.stderr], [out, '']);
      });
    }

    const READ: [string, string][] = [
      ['echo work ${y:-$((09))}', ''],
      ['x=a; echo work "${x#$((09))}"', ''],
      ['[[ 1 == 2 || $((09)) == 1 ]] && echo work', ''],
      ['case x in y) ;; $((09))) echo work ;; esac', ''],
      // (Its body has run by then: the command stops there.)
      ['for ((i=0;i<1;i+=09)); do echo body; done', 'body\n'],
    ];
    for (const [src, out] of READ) {
      (bash ? it : it.skip)(`reads it here: ${JSON.stringify(src)}`, () => {
        assert.strictEqual(saidOf(src, undefined)?.level, 'warning');
        const r = run(bash!, ['--norc'], `${src}\n`);
        assert.strictEqual(r.stdout, out);
        assert.match(r.stderr, /value too great/);
      });
    }

    // Beside an expansion it is no constant: nothing is said, and the line runs.
    const NOTHING: [string, string][] = [
      ['x=1; echo $(( ${x}09 ))', '109\n'],
      ['x=1; echo $(( 1${x}09 ))', '1109\n'],
      ['x=1; echo $(( $x$((1))09 ))', '1109\n'],
      ['x=1; echo $(( ${x}010 ))', '1010\n'],
      ['x=1; echo $(( ${x:-09} ))', '1\n'],
      ['declare -A m; m[k]=1; echo "${m[09]}"', '\n'],
      // (A quoted here-document's text is no arithmetic.)
      ["cat <<'E'\n$((09))\nE", '$((09))\n'],
    ];
    for (const [src, out] of NOTHING) {
      (bash ? it : it.skip)(`says nothing: ${JSON.stringify(src)}`, () => {
        assert.strictEqual(saidOf(src, undefined), undefined);
        assert.strictEqual(run(bash!, ['--norc'], `${src}\n`).stdout, out);
      });
    }
  });
});
