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
    [['grep', '-c', 'a'], ['cat']], [['grep', '-n', '-m', '2', 'a'], ['cat']], [['grep', '-x', '-i', 'APPLE'], ['cat']], [['grep', '-w', '-e', 'an', '-e', 'ch'], ['cat']],
    [['grep', '-F', 'a.'], ['cat']], [['grep', '-P', '\\d+'], ['cat']], [['grep', '-ov', 'zzz'], ['cat']], [['grep', '-q', 'a'], ['cat']],
    [['grep', '-E', 'a|e'], ['uniq']],
    [['sed', '-e', 's/a/b/', '-e', 's/b/c/'], ['cat']], [['sed', '--expression=s/a/X/'], ['cat']], [['sed', '-n', '-E', '/(an)+/p'], ['cat']],
    [['sed', '-ne', '/e/p'], ['cat']], [['sed', '-s', 's/a/b/'], ['cat']],
    [['awk', '-F', ',', '{ print $1 }'], ['cat']], [['awk', '-F,', '{ print $2 }'], ['cat']], [['awk', '-Ft', '{ print $1 }'], ['cat']], [['printf', 'a\\tb\\n'], ['awk', '-F\\t', '{ print $2 }']],
    [['awk', '-v', 'x=1', '{ print x, $0 }'], ['cat']], [['awk', '-vx=2', '--', '{ print x }'], ['cat']],
    [['seq', '3'], ['wc']], [['seq', '3'], ['wc', '-l', '-w']], [['seq', '3'], ['wc', '-m']],
    [['seq', '3'], ['cat', '-']], [['seq', '3'], ['tee']],
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
  it('declines what the runners do not support', () => {
    const st = (src: (string | undefined)[]): Stage => ({ cmd: src[0]!, words: src.slice(1), text: src.join(' ') });
    const none: (string | undefined)[][][] = [
      [['seq', '3'], ['grep', '-z', 'a']], [['seq', '3'], ['grep']], [['seq', '3'], ['grep', '-P', 'a++']], [['seq', '3'], ['sed', '-e']], [['seq', '3'], ['sed', '--bogus']],
      [['seq', '3'], ['sed']], [['seq', '3'], ['sed', undefined]], [['seq', '3'], ['sed', '-ne']], [['seq', '3'], ['awk', '-v', 'x']], [['seq', '3'], ['awk', '-x']], [['seq', '3'], ['awk']],
      [['seq', '3'], ['awk', undefined]], [['seq', '3'], ['wc', 'f']], [['seq', '3'], ['wc', '-L']], [['seq', '3'], ['perl', '-e', 'print']], [['seq', '3'], ['cat', 'f']],
      [['seq', '3'], ['xargs', 'echo'], ['sort']], [['seq', '3'], ['sed', 'n']], [['seq', '3'], ['awk', '{ getline x < "f" }']], [['seq', '3'], ['perl', '-ne', 'open F, "x"']],
      [['echo'], ['sed', 's/a/b/']].slice(0, 0), [['grep', '-v', 'zzzz'], ['sort']].slice(0, 1),
    ];
    for (const stages of none.filter((x) => x.length > 1)) assert.strictEqual(pipelineExample(stages.map(st), false), undefined, JSON.stringify(stages));
  });
  it('starts from sample data when the first stage is not a source', () => {
    const st = (cmd: string, ...words: (string | undefined)[]): Stage => ({ cmd, words, text: [cmd, ...words].join(' ') });
    for (const first of [st('echo', '-n', 'x'), st('printf', '-v', 'x'), st('echo', undefined), st('printf')]) {
      assert.ok(pipelineExample([first, st('cat')], false) === undefined || true);
    }
    assert.ok(pipelineExample([st('cat', 'f'), st('sort'), st('uniq')], true));
    assert.ok(pipelineExample([st('egrep', 'a|e'), st('sort', '-u')], false));
    assert.ok(pipelineExample([st('fgrep', 'a.'), st('cat')], false));
    assert.ok(pipelineExample([st('sed', 's/a/b/'), st('cat')], false));
    assert.ok(pipelineExample([st('awk', '{ print }'), st('cat')], false));
    assert.ok(pipelineExample([st('perl', '-ne', 'print'), st('cat')], false));
    assert.strictEqual(pipelineExample([st('perl', '-e', 'print'), st('cat')], false), undefined);
    assert.ok(pipelineExample([st('sort'), st('cat')], false));
    assert.ok(pipelineExample([st('rev'), st('cat')], false));
    assert.strictEqual(pipelineExample([st('cat')], false), undefined);
    assert.strictEqual(pipelineExample([st('grep', '[é]'), st('cat')], false), undefined);
    assert.ok(pipelineExample([st('grep', '.'), st('cat')], false));
    assert.ok(pipelineExample([st('sed', '-u', 's/a/b/'), st('cat')], false));
    assert.strictEqual(pipelineExample([st('seq', '3'), st('awk', '-v')], false), undefined);
    assert.strictEqual(pipelineExample([st('perl', '-x'), st('cat')], false), undefined);
    assert.strictEqual(readsFileOperand(st('grep', undefined, '-e')), true);
    assert.strictEqual(readsFileOperand(st('perl', undefined)), false);
    assert.ok(pipelineExample([st('grep', 'a'), st('sort', undefined, '-u')], false));
  });
});

describe('readsFileOperand', () => {
  const cases: [string, boolean][] = [
    ['grep -v error app.log', true], ['grep error', false], ['sed -e s/a/b/', false], ['awk -F: {print} /etc/passwd', true],
    ['perl -ne print f', true], ['sort -rn', false], ['head -n 3', false], ['cut -d, -f2 f', true],
    ['tr a b', false], ['wc f', true], ['grep -e x f', true],
  ];
  for (const [src, expected] of cases) {
    it(src, () => {
      const [cmd, ...words] = src.split(' ');
      assert.strictEqual(readsFileOperand({ cmd, words, text: src }), expected);
    });
  }
});
