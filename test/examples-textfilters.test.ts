import * as assert from 'assert';
import { spawnSync } from 'child_process';
import { commandExample, expandSet, runSort } from '../src/examples/textfilters';

/** The real command's output (GNU coreutils, C locale). */
function real(cmd: string, args: string[], input?: string[]): string[] {
  const r = spawnSync(cmd, args, { input: input ? input.join('\n') + '\n' : undefined, env: { ...process.env, LC_ALL: 'C' } });
  const out = r.stdout.toString();
  return out === '' ? [] : out.replace(/\n$/, '').split('\n');
}

const cases: string[][] = [
  ['sort'], ['sort', '-n'], ['sort', '-rn'], ['sort', '-u'], ['sort', '-f'], ['sort', '-h'], ['sort', '-V'], ['sort', '-t:', '-k3,3nr'], ['sort', '-k2'],
  ['sort', '-k2,2', '-k1,1r'], ['sort', '-t,', '-k2,2n', '-u'], ['sort', '--key=2,2n'], ['sort', '-r'], ['sort', '-k1.2,1.3'],
  ['uniq'], ['uniq', '-c'], ['uniq', '-d'], ['uniq', '-u'], ['uniq', '-ic'], ['uniq', '-D'], ['uniq', '-f', '1'],
  ['cut', '-d,', '-f2-4,7'], ['cut', '-f2'], ['cut', '-c-10'], ['cut', '-c3-5,8'], ['cut', '-d:', '-f1,3', '--output-delimiter= | '],
  ['cut', '-d,', '-s', '-f1'], ['cut', '-d,', '--complement', '-f2'], ['cut', '-c2-'],
  ['tr', '[:upper:]', '[:lower:]'], ['tr', 'a-z', 'A-Z'], ['tr', '-d', '\\r'], ['tr', '-s', ' '], ['tr', '\\n', ' '], ['tr', '-d', '0-9'],
  ['tr', '-cd', '[:alnum:]\\n'], ['tr', 'abc', 'x'], ['tr', '-s', 'a-z'], ['tr', '-d', '\\n'], ['tr', '-c', '[:alnum:]\\n', '_'], ['tr', 'a-c', '[x*]'],
  ['head', '-n', '5'], ['head', '-5'], ['head', '-n', '-2'], ['head', '-c', '5'], ['head'],
  ['tail', '-n', '3'], ['tail', '-n', '+2'], ['tail', '-3'], ['tail', '-c', '4'], ['tail', '-c', '+15'],
  ['seq', '5'], ['seq', '2', '5'], ['seq', '1', '3', '10'], ['seq', '-w', '8', '11'], ['seq', '-s', ',', '3'], ['seq', '0', '0.5', '2'], ['seq', '10', '-3', '1'], ['seq', '-w', '-2', '2'],
  ['basename', '/a/b/report.txt', '.txt'], ['basename', '-a', '/x/y', 'z/w/'], ['basename', '-s', '.sh', 'a.sh', 'b/c.sh'], ['basename', '/'], ['basename', '.sh', '.sh'],
  ['dirname', '/a/b/c.txt'], ['dirname', 'file'], ['dirname', '/a/b/', 'x/y', '/z'], ['dirname', '//a//b//'],
];

describe('coreutils examples agree with GNU coreutils', () => {
  for (const words of cases) {
    it(words.join(' '), () => {
      const [cmd, ...args] = words;
      const ex = commandExample(cmd, args);
      assert.ok(ex, 'has an example');
      assert.deepStrictEqual(ex.output, real(cmd, args, ex.input), `input ${JSON.stringify(ex.input)}`);
    });
  }
});

describe('coreutils example input', () => {
  it('chooses data that shows the options', () => {
    assert.deepStrictEqual(commandExample('sort', ['-n'])!.output, ['9', '10', '25', '100'], 'numeric vs. text order is visible');
    const u = commandExample('uniq', ['-c'])!;
    assert.ok(u.output.some((l) => l.trim() === '1 apple'), 'a non-adjacent duplicate is counted separately');
    assert.ok(commandExample('tr', ['-d', '\\r'])!.input!.every((l) => l.endsWith('\r')));
  });

  it('expands tr sets', () => {
    assert.deepStrictEqual(expandSet('a-c\\n[x*2]'), ['a', 'b', 'c', '\n', 'x', 'x']);
    assert.deepStrictEqual(expandSet('[:digit:]').length, 10);
  });

  it('gives up on what it cannot run', () => {
    assert.strictEqual(commandExample('sort', ['-M']), undefined);
    assert.strictEqual(commandExample('sort', ['-k', 'x']), undefined);
    assert.strictEqual(commandExample('seq', [undefined as unknown as string]), undefined);
    assert.strictEqual(commandExample('basename', []), undefined);
    assert.throws(() => runSort(['--bogus'], []));
  });
});
