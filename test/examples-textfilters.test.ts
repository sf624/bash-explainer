import * as assert from 'assert';
import { run } from './support/run';
import { commandExample, expandSet, FILTERS, parseOptions, runCut, runHead, runSeq, runSort, runTail, runTr, runUniq, sampleInput, Unsupported } from '../src/examples/textfilters';

/** The real command's output (GNU coreutils, C locale). */
function real(cmd: string, args: string[], input?: string[]): string[] {
  const r = run(cmd, args, { input: input ? input.join('\n') + '\n' : undefined, env: { ...process.env, LC_ALL: 'C' } });
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
  ['dirname', '/a/b/c.txt'], ['dirname', 'file'], ['dirname', '/'], ['cut', '-b', '2-4'], ['cut', '-d,', '-f9'], ['uniq', '-w', '3'], ['dirname', '/a/b/', 'x/y', '/z'], ['dirname', '//a//b//'],
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
    // GNU seq needs one to three numbers.
    for (const args of [[], ['-w'], ['-s', ','], ['1', '2', '3', '4']]) assert.strictEqual(commandExample('seq', args), undefined, args.join(' '));
    assert.strictEqual(commandExample('basename', []), undefined);
    assert.throws(() => runSort(['--bogus'], []));
  });
});

describe('coreutils filters agree with GNU coreutils on fixed input', () => {
  const input: Record<string, string[]> = {
    sort: ['b 10 x', 'a  2 y', '', 'B 1.5K z', 'a-1 2 y', 'c\t3', 'v1.10', 'v1.2', 'v1.2', ' d 7', 'é 1'],
    // GNU's version sort treats leading blanks and punctuation in ways the examples leave out.
    'sort -V': ['1.10', '1.2', '', '1.2', '1.2a', 'a', '1.2b'],
    'sort -h': ['0K', '1K', '2', '1M', '-1K'],
    'tr -d a-z\\n': ['abc', 'de'],
    uniq: ['a b', 'a b', 'x b', 'A c', 'a c', 'a c'],
    cut: ['a,b,c', 'abcdef', 'x,,y'],
    tr: ['Hello aaa World', 'xyz\\q 123'],
    head: ['one', 'two', 'three', 'four'],
    tail: ['one', 'two', 'three', 'four'],
  };
  const cases: string[][] = [
    ['sort', '-d'], ['sort', '-i'], ['sort', '-g'], ['sort', '-V'], ['sort', '-b', '-k2'], ['sort', '-k2b,2'], ['sort', '-k2.2b,3.1b'], ['sort', '-k5'],
    ['sort', '-k1,9'], ['sort', '-s', '-k1,1'], ['sort', '-f'], ['sort', '-h', '-k2,2'], ['sort', '-t', ' ', '-k2,2n'],
    ['uniq', '-w', '1'], ['uniq', '-s', '2'], ['uniq', '-f', '1', '-c'], ['uniq', '-i', '-u'],
    ['cut', '-c', '2,4', '--output-delimiter=:'], ['cut', '-f', '2', '-d', ','],
    ['tr', '[=a=]', 'b'], ['tr', '\\101\\154', 'xy'], ['tr', '\\q', 'x'], ['tr', '-t', 'abc', 'xy'], ['tr', 'abcl', 'xy'], ['tr', '-s', 'a'], ['tr', '-c', 'a-z\\n', '_'],
    ['head', '-c', '-3'], ['head', '-c', '6'], ['tail', '-c', '3'], ['tail', '-n', '2'], ['head', '--lines=2'], ['sort', '-h'], ['sort', '--reverse'], ['tr', '-d', 'a-z\\n'], ['tail', '+2'], ['tail'],
  ];
  for (const [cmd, ...args] of cases) {
    it([cmd, ...args].join(' '), () => {
      const lines = input[[cmd, ...args].join(' ')] ?? input[cmd];
      assert.deepStrictEqual(FILTERS[cmd](args, lines), real(cmd, args, lines));
    });
  }
  it('gives up on what it does not run', () => {
    const fails: [() => unknown, string][] = [
      [() => runSort(['-t', 'ab'], []), '-t'], [() => runSort(['--key'], []), 'missing'], [() => runSort(['-k'], []), 'missing'], [() => runSort(['--nope'], []), '--nope'],
      [() => runUniq(['-z'], []), '-z'], [() => runCut(['-f', 'x'], []), 'list'], [() => runCut(['-d', 'ab', '-f', '1'], []), '-d'], [() => runCut([], []), 'cut needs'],
      [() => expandSet('[:foo:]'), 'class'], [() => expandSet('z-a'), 'reverse'], [() => runTr(['a', 'b', 'c'], []), 'sets'], [() => runTr(['-c', 'a', 'xy'], []), '-c with'],
      [() => runTr(['a', ''], []), 'empty set2'], [() => runTr(['-ds', 'a'], []), '-ds'], [() => runTr(['a'], []), 'two sets'], [() => runHead(['-n', 'x'], []), '-n'], [() => runTail(['-n', 'x'], []), '-n'],
      [() => runSeq(['1', '0', '3']), 'zero'], [() => runSeq(['1', '100000']), 'too long'], [() => runSeq(['-f', '%g', '3']), '-f'],
    ];
    for (const [f, msg] of fails) assert.throws(f, (e: Error) => e instanceof Unsupported && e.message.includes(msg), msg);
    assert.deepStrictEqual(parseOptions(['--', '-x'], { flags: 'x', values: '' }).operands, ['-x']);
    assert.strictEqual(sampleInput('wc', []), undefined);
    assert.strictEqual(commandExample('nope', []), undefined);
    assert.ok(sampleInput('cut', ['-s', '-f', '2'])!.includes('no delimiter here'));
    assert.deepStrictEqual(expandSet('a[x*]'), ['a']);
    assert.deepStrictEqual(runHead([undefined, '-1'], ['a', 'b']), ['a']);
    assert.ok(sampleInput('cut', ['-d,']));
    assert.ok(sampleInput('tr', [undefined, 'x']));
  });
});

