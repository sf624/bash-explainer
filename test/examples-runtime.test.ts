import * as assert from 'assert';
import { run } from './support/run';
import { execFileSync } from 'child_process';
import { readSampleLine, runRead, runXargs, testCases, xargsExample } from '../src/examples/runtime';

describe('xargs agrees with GNU xargs', () => {
  const cases: [string[], string[]][] = [
    [['-n', '2'], ['rm']], [['-I{}'], ['mv', '{}', '{}.bak']], [['-0'], ['rm', '-f']], [['-L', '1'], ['echo']], [[], []], [['-d', ','], ['echo']],
    [['-n1', '-P4'], ['gzip']], [['-r'], ['ls']], [['-n', '3'], ['cp', '-t', 'dest']], [['--max-args=2'], ['echo']],
  ];
  for (const [opts, cmd] of cases) {
    it([...opts, ...cmd].join(' ') || '(no options)', () => {
      const ex = xargsExample([...opts, ...cmd])!;
      assert.ok(ex, 'has an example');
      // Prefix the command with echo so xargs prints the command lines instead of running them.
      const real = run('xargs', [...opts, 'echo', ...(cmd.length ? cmd : ['echo'])], { input: ex.input }).stdout.toString().trim().split('\n').filter(Boolean);
      assert.deepStrictEqual(runXargs([...opts, ...cmd], ex.input).map((c) => c.join(' ')), real);
    });
  }
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
    ['[ -z "$v" ]', ['[', '-z', undefined, { var: 'v' }]], ['[ -n "$v" ]', ['[', '-n', undefined, { var: 'v' }]],
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

describe('read agrees with bash', () => {
  const cases: [string, boolean, string[], string?][] = [
    [' \t\n', true, ['a', 'b', 'c']], [',', true, ['a', 'b', 'c']], ['', true, ['line']], [':', true, ['user', 'rest']], [' \t\n', true, [], 'arr'],
    [' \t\n', false, ['a', 'b']], [', ', true, ['a', 'b']], ['\t', true, ['a', 'b', 'c']],
  ];
  const lines = (ifs: string, names: string[], array?: string) => [readSampleLine(names.length, ifs, !!array), '  lead  trail  ', 'a\\ b c', 'x,,y,', ' a , b ,c '];
  for (const [ifs, raw, names, array] of cases) {
    for (const line of lines(ifs, names, array)) {
      it(`IFS=${JSON.stringify(ifs)} read ${raw ? '-r ' : ''}${array ? `-a ${array}` : names.join(' ')} <<< ${JSON.stringify(line)}`, () => {
        const r = runRead(line, names, { ifs, raw, array });
        const target = array ?? names.join(' ');
        const dump = array ? `for x in "\${${array}[@]}"; do printf '[%s]' "$x"; done` : names.map((n) => `printf '[%s]' "$${n}"`).join('; ');
        const real = execFileSync('bash', ['-c', `IFS="$2" read ${raw ? '-r ' : ''}${array ? '-a ' : ''}${target} <<< "$1"; ${dump}`, '_', line, ifs]).toString();
        const mine = array ? r.array![1].map((x) => `[${x}]`).join('') : r.vars.map(([, v]) => `[${v}]`).join('');
        assert.strictEqual(mine, real);
      });
    }
  }
});
