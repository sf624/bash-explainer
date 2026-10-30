import * as assert from 'assert';
import { run } from './support/run';
import { execFileSync } from 'child_process';
import type { BashVersion } from '../src/bashversion';
import { runContained } from './support/contained';
import { random } from './support/fuzz';
import { readSampleLine, runRead, runXargs, showCommand, testCases, xargsExample } from '../src/examples/runtime';

describe('xargs agrees with GNU xargs', () => {
  const cases: [string[], string[]][] = [
    [['-n', '2'], ['rm']], [['-I{}'], ['mv', '{}', '{}.bak']], [['-0'], ['rm', '-f']], [['-L', '1'], ['echo']], [[], []], [['-d', ','], ['echo']],
    [['-n1', '-P4'], ['gzip']], [['-r'], ['ls']], [['-n', '3'], ['cp', '-t', 'dest']], [['--max-args=2'], ['echo']],
    // With `-I` and a delimiter, each item is a run of its own.
    [['-0', '-n', '1', '-I{}'], ['rm', '-f', '{}']], [['-0', '-I{}'], ['mv', '{}', '{}.bak']], [['-d', ',', '-I{}'], ['echo', '{}']],
    // `-i`/`--replace` and `-l`/`--max-lines` take a value only attached: the next word is the command (`-I {}`, `-L 1`).
    [['--replace'], ['echo', '{}']], [['-i'], ['mv', '{}', '{}.bak']], [['-i@'], ['echo', '@']], [['--max-lines'], ['echo']], [['-l'], ['echo']], [['--max-l=2'], ['echo']],
  ];
  for (const [opts, cmd] of cases) {
    it([...opts, ...cmd].join(' ') || '(no options)', () => {
      const ex = xargsExample([...opts, ...cmd])!;
      assert.ok(ex, 'has an example');
      // Prefix the command with echo so xargs prints the command lines instead of running them.
      const real = run('xargs', [...opts, 'echo', ...(cmd.length ? cmd : ['echo'])], { input: ex.input }).stdout.toString().trim().split('\n').filter(Boolean);
      // (With -d, the newline ending the input stays in the last item; echo prints it, and the line split above drops it.)
      const mine = runXargs([...opts, ...cmd], ex.input).map((c) => c.join(' ').trimEnd());
      // With -P the runs finish in any order, so GNU xargs' output order is not specified: compare the same lines, sorted.
      if (opts.some((o) => /^-P/.test(o) || o === '--max-procs' || o.startsWith('--max-procs='))) assert.deepStrictEqual([...mine].sort(), [...real].sort());
      else assert.deepStrictEqual(mine, real);
    });
  }
  it('keeps the newline that ends the input in the last item of -d', () => {
    const cases: [string, string][] = [[',', 'a,b,c\n'], [',', 'a,b,\n'], [',', 'a,b,'], ['\\n', 'a\n\nb\n'], [' ', 'a b\tc\n'], [';', 'a;;b'], [',', ''], [',', ',']];
    for (const [d, input] of cases) {
      const real = run('xargs', ['-d', d, 'printf', '[%s]'], { input }).stdout.toString();
      const mine = runXargs(['-d', d, 'printf', '[%s]'], input).map((c) => c.slice(2).map((x) => `[${x}]`).join('')).join('');
      assert.strictEqual(mine === '' ? '[]' : mine, real === '' ? '[]' : real, JSON.stringify([d, input]));
    }
    assert.deepStrictEqual(runXargs(['-d', ',', 'echo'], 'a,b\n'), [['echo', 'a', 'b\n']]);
    assert.strictEqual(showCommand(['echo', 'b\n', "it's\t", 'a\\\x01']), "echo $'b\\n' $'it\\'s\\t' $'a\\\\\\x01'");
  });
  it('-I with -0 or -d: an item is whole, blanks and empty items included; with newlines, leading blanks go', () => {
    const cases: [string[], string][] = [
      [['-0', '-I{}'], ' a b\0c\0'], [['-0', '-I{}'], 'a\0\0b\0'], [['-d', ',', '-I{}'], ' a b,c\n'], [['-d', ',', '-I{}'], 'a,,b,'], [['-I{}'], ' a\n\nb \n'],
    ];
    for (const [opts, input] of cases) {
      const real = run('xargs', [...opts, 'printf', '[%s]', '{}'], { input }).stdout.toString();
      const mine = runXargs([...opts, 'printf', '[%s]', '{}'], input).map((c) => c.slice(2).map((x) => `[${x}]`).join('')).join('');
      assert.strictEqual(mine, real, JSON.stringify([opts, input]));
    }
  });
  it('treats quotes in the input as grouping', () => {
    assert.deepStrictEqual(runXargs(['-n', '1'], 'a "b c" d\\ e\n'), [['echo', 'a'], ['echo', 'b c'], ['echo', 'd e']]);
  });
});

describe('test examples agree with bash', () => {
  const cases: [string, Parameters<typeof testCases>][] = [
    ['[ "$a" -eq 3 ]', ['[', '-eq', { var: 'a' }, { lit: '3' }]], ['[ "$n" -gt 10 ]', ['[', '-gt', { var: 'n' }, { lit: '10' }]],
    ['[ "$n" -le 0 ]', ['[', '-le', { var: 'n' }, { lit: '0' }]], ['[[ $f == *.txt ]]', ['[[', '==', { var: 'f' }, { lit: '*.txt' }]],
    ['[[ $f != *.txt ]]', ['[[', '!=', { var: 'f' }, { lit: '*.txt' }]], ['[[ $f == "*.txt" ]]', ['[[', '==', { var: 'f' }, { lit: '*.txt' }, true]],
    ['[ "$x" = yes ]', ['[', '=', { var: 'x' }, { lit: 'yes' }]], ['[ "$x" != "" ]', ['[', '!=', { var: 'x' }, { lit: '' }]],
    ['[ -z "$v" ]', ['[', '-z', undefined, { var: 'v' }]], ['[ -n "$v" ]', ['[', '-n', undefined, { var: 'v' }, true]],
    // Unquoted and empty, `[ -n $v ]` is `[ -n ]`: true.
    ['[ -n $v ]', ['[', '-n', undefined, { var: 'v' }]],
    ['(( c >= 5 ))', ['((', '>=', { var: 'c' }, { lit: '5' }]], ['(( c == 0 ))', ['((', '==', { var: 'c' }, { lit: '0' }]],
    ['[ 0 -ne "$1" ]', ['[', '-ne', { lit: '0' }, { var: '1' }]],
  ];
  for (const [src, args] of cases) {
    it(src, () => {
      const results = testCases(...args)!;
      assert.ok(results?.length === 2);
      for (const c of results) {
        const set = Object.entries(c.vars).map(([k, v]) => (/^\d+$/.test(k) ? `set -- ${JSON.stringify(v)};` : `${k}=${JSON.stringify(v)};`)).join(' ');
        assert.strictEqual(execFileSync('bash', ['-c', `${set} ${src} && echo true || echo false`]).toString().trim(), String(c.result), `${set} ${src}`);
      }
    });
  }
  it('declines tests that depend on the system', () => {
    assert.strictEqual(testCases('[', '-f', undefined, { var: 'f' }), undefined);
    assert.strictEqual(testCases('[', '-eq', { var: 'a' }, { var: 'b' }), undefined);
  });
});

/** The bashes to compare `read` with: bash 5.2 on PATH, and bash 5.3 when `$BASH_EXPLAINER_BASH53` names one. */
const READ_BASHES: [BashVersion, string][] = [['5.2', 'bash'], ...(process.env.BASH_EXPLAINER_BASH53 ? [['5.3', process.env.BASH_EXPLAINER_BASH53] as [BashVersion, string]] : [])];
/** A string as a bash word, in ANSI-C quotes. */
const ansiC = (text: string): string => `$'${[...text].map((c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`).join('')}'`;

describe('read agrees with bash', () => {
  const cases: [string, boolean, string[], string?][] = [
    [' \t\n', true, ['a', 'b', 'c']], [',', true, ['a', 'b', 'c']], ['', true, ['line']], [':', true, ['user', 'rest']], [' \t\n', true, [], 'arr'],
    [' \t\n', false, ['a', 'b']], [', ', true, ['a', 'b']], ['\t', true, ['a', 'b', 'c']],
    // (The vertical tab, the form feed and the carriage return are whitespace too; at the end of the last variable,
    // bash 5.2 keeps them, bash 5.3 does not.)
    ['\v', true, ['a', 'b', 'c']], [':\f', true, ['a', 'b']], ['\r', true, [], 'arr'], ['\v', true, ['a']], ['\v', true, ['a', 'b']],
    // (With no name, REPLY gets the line as it is.)
    [' \t\n', false, []],
  ];
  const lines = (ifs: string, names: string[], array?: string) => [readSampleLine(names.length || 1, ifs, !!array), '  lead  trail  ', 'a\\ b c', 'x,,y,', ' a , b ,c ', '\v\va\v\f:b\r\r:\fc\v', '\v\vx\v\v', 'x\v\vy\v\v', 'p x y\\ '];
  for (const [version, bash] of READ_BASHES) {
    for (const [ifs, raw, names, array] of cases) {
      for (const line of lines(ifs, names, array)) {
        it(`bash ${version}: IFS=${JSON.stringify(ifs)} read ${raw ? '-r ' : ''}${array ? `-a ${array}` : names.join(' ')} <<< ${JSON.stringify(line)}`, () => {
          const r = runRead(line, names, { ifs, raw, array, version })!;
          const target = array ?? names.join(' ');
          const dump = array ? `for x in "\${${array}[@]}"; do printf '[%s]' "$x"; done` : (names.length ? names : ['REPLY']).map((n) => `printf '[%s]' "$${n}"`).join('; ');
          const real = execFileSync(bash, ['-c', `IFS="$2" read ${raw ? '-r ' : ''}${array ? '-a ' : ''}${target} <<< "$1"; ${dump}`, '_', line, ifs]).toString();
          const mine = array ? r.array![1].map((x) => `[${x}]`).join('') : r.vars.map(([, v]) => `[${v}]`).join('');
          assert.strictEqual(mine, real);
        });
      }
    }
  }

  it('gives no fields for an IFS with byte 1 or 127, which bash splits erratically', () => {
    // (bash: `IFS=$'\x01' read a b <<< $'x\\\x01y\x01z'` gives a=x, b=$'y\001z'.)
    assert.strictEqual(runRead('x\\\x01y\x01z', ['a', 'b'], { ifs: '\x01', raw: false }), undefined);
    assert.strictEqual(runRead('x', ['a'], { ifs: ' \x7f', raw: true }), undefined);
  });

  // A seeded random comparison: IFS of whitespace, `:` and `,`; lines with them, backslashes, newlines and bash's marks.
  for (const [version, bash] of READ_BASHES) {
    it(`bash ${version}: random lines and IFS`, async function () {
      this.timeout(30000);
      const next = random(2026);
      const rnd = (n: number): number => Math.floor(next() * n);
      const pick = (xs: string): string => xs[rnd(xs.length)];
      const cases = Array.from({ length: 400 }, () => {
        const ifs = rnd(10) === 0 ? ' \t\n' : Array.from({ length: rnd(4) }, () => pick(' \t\n\v\f\r:,')).join('');
        const line = Array.from({ length: rnd(12) }, () => pick(' \t\v\f\r:,ab\\\n a:\x01\x7f')).join('');
        const array = rnd(5) === 0 ? 'arr' : undefined;
        return { ifs, line, raw: rnd(2) === 0, array, names: array ? [] : ['v1', 'v2', 'v3'].slice(0, rnd(4)) };
      });
      const script = cases.map((c) => {
        const dump = c.array ? `for x in "\${arr[@]}"; do printf '%s\\x1f' "$x"; done` : (c.names.length ? c.names : ['REPLY']).map((n) => `printf '%s\\x1f' "$${n}"`).join('; ');
        return `unset arr REPLY v1 v2 v3; IFS=${ansiC(c.ifs)} read ${c.raw ? '-r ' : ''}${c.array ? '-a arr ' : ''}${c.names.join(' ')} <<< ${ansiC(c.line)}; ${dump}; printf '\\x1e'`;
      }).join('\n');
      const out = (await runContained([bash, '-c', script], process.cwd())).stdout.split('\x1e');
      const bad = cases.filter((c, k) => {
        const r = runRead(c.line, c.names, { ifs: c.ifs, raw: c.raw, array: c.array, version })!;
        return (r.array ? r.array[1] : r.vars.map(([, v]) => v)).map((x) => `${x}\x1f`).join('') !== out[k];
      });
      assert.deepStrictEqual(bad, []);
    });
  }
});
