import * as assert from 'assert';
import { spawnSync } from 'child_process';
import { pipelineExample, readsFileOperand, Stage } from '../src/examples/pipeline';

const q = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
const lines = (s: string) => s.replace(/\n$/, '').split('\n').filter((l, i, a) => !(a.length === 1 && l === ''));

describe('pipeline examples agree with bash', () => {
  const cases: string[][][] = [
    [['grep', 'error'], ['sort'], ['uniq', '-c'], ['sort', '-rn']],
    [['cat'], ['sort'], ['uniq', '-c'], ['sort', '-rn'], ['head', '-n', '3']],
    [['echo', 'hello world'], ['tr', 'a-z', 'A-Z']],
    [['seq', '10'], ['awk', '$1 % 2 == 0'], ['sort', '-rn']],
    [['seq', '5'], ['sort', '-rn'], ['head', '-n', '2']],
    [['printf', '%s\\n', 'b', 'a', 'c'], ['sort'], ['tac']],
    [['grep', '-v', '^#'], ['cut', '-d,', '-f2'], ['sort', '-u']],
    [['cut', '-d:', '-f1,3'], ['sort', '-t:', '-k2,2n'], ['tail', '-n', '2']],
    [['awk', '{ print $1 }'], ['sort'], ['uniq', '-c'], ['sort', '-rn']],
    [['sed', 's/[0-9]//g'], ['wc', '-l']],
    [['grep', '-o', '[0-9]\\+'], ['sort', '-n'], ['uniq']],
    [['seq', '3'], ['rev'], ['wc', '-c']],
    [['perl', '-ne', 'print if /e/'], ['sort', '-r']],
  ];
  for (const words of cases) {
    const stages: Stage[] = words.map(([cmd, ...w]) => ({ cmd, words: w, text: [cmd, ...w].join(' ') }));
    const script = words.map((w) => w.map(q).join(' ')).join(' | ');
    it(script, () => {
      const ex = pipelineExample(stages, false);
      assert.ok(ex, 'has an example');
      const real = spawnSync('bash', ['-c', script], { input: ex.input ? ex.input.join('\n') + '\n' : '', env: { ...process.env, LC_ALL: 'C' } });
      assert.deepStrictEqual(ex.steps[ex.steps.length - 1].output, lines(real.stdout.toString()));
    });
  }
  it('shows the commands xargs would run', () => {
    const ex = pipelineExample([{ cmd: 'grep', words: ['e'], text: 'grep e' }, { cmd: 'xargs', words: ['-n', '1', 'rm'], text: 'xargs -n 1 rm' }], false)!;
    const real = spawnSync('bash', ['-c', "grep e | xargs -n 1 echo rm"], { input: ex.input!.join('\n') + '\n' });
    assert.deepStrictEqual(ex.steps[1].output, lines(real.stdout.toString()));
  });
  it('declines pipelines with unknown commands', () => {
    assert.strictEqual(pipelineExample([{ cmd: 'ls', words: [], text: 'ls' }, { cmd: 'grep', words: ['x'], text: 'grep x' }], false), undefined);
  });
});

describe('readsFileOperand', () => {
  const cases: [string, boolean][] = [
    ['grep -v error app.log', true], ['grep error', false], ['sed -e s/a/b/', false], ['awk -F: {print} /etc/passwd', true],
    ['perl -ne print f', true], ['sort -rn', false], ['head -n 3', false], ['cut -d, -f2 f', true],
  ];
  for (const [src, expected] of cases) {
    it(src, () => {
      const [cmd, ...words] = src.split(' ');
      assert.strictEqual(readsFileOperand({ cmd, words, text: src }), expected);
    });
  }
});
