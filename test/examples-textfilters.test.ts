import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runBash } from './support/bash';
import { run } from './support/run';
import { Analyzer, Token } from '../src/analyzer';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { commandExample, expandSet, FILTERS, parseOptions, runCut, runHead, runSeq, runSort, runTail, runTr, runUniq, sampleInput, Unsupported } from '../src/examples/textfilters';
import { SYSTEM_FILES } from '../src/examples/systemfiles';
import { allTokens } from './support/explain';

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
  // Options read as the explanation reads them (the dictionary spec): long prefixes, other names of an option.
  ['sort', '--rev'], ['sort', '--uniq'], ['cut', '-d,', '--comp', '-f2'], ['cut', '-n', '-f2'], ['tr', '-C', '[:alnum:]\\n', '_'], ['uniq', '--all-repeated'],
  ['uniq', '--all-repeated=none'], ['head', '-q', '-n', '3'], ['tail', '--lin=2'], ['seq', '-.5', '1'], ['basename', '--suf=.sh', 'a.sh'],
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
    // (A word past the operands the tool takes: it refuses the line, `extra operand`.)
    assert.strictEqual(commandExample('basename', ['a', 'b', 'c']), undefined);
    assert.strictEqual(commandExample('uniq', ['in', 'out', 'x']), undefined);
    assert.throws(() => runSort(['--bogus'], []));
    // GNU seq reads options only before the first number (`seq 1 -w 3`: invalid floating point argument: '-w'), and
    // uniq's other grouping methods are not `-D`.
    for (const [cmd, ...args] of [['seq', '1', '-w', '3'], ['uniq', '--all-repeated=prepend']]) {
      assert.strictEqual(commandExample(cmd, args), undefined, args.join(' '));
    }
    assert.notStrictEqual(run('seq', ['1', '-w', '3']).status, 0);
  });
});

describe('coreutils filters agree with GNU coreutils on fixed input', () => {
  const input: Record<string, string[]> = {
    sort: ['b 10 x', 'a  2 y', '', 'B 1.5K z', 'a-1 2 y', 'c\t3', 'v1.10', 'v1.2', 'v1.2', ' d 7', 'é 1'],
    // GNU's version sort treats leading blanks and punctuation in ways the examples leave out.
    'sort -V': ['1.10', '1.2', '', '1.2', '1.2a', 'a', '1.2b'],
    // (A character position past the end of its field runs on into the next: `b ` of `ab cd`. Bytes in GNU's C locale: ASCII.)
    'sort -k1.2,1.3': ['ab cd', 'ab ab', 'a', 'abc d', 'b a', 'b  z'],
    'sort -t   -k1.3,2': ['ab cd', 'ab ab', 'a', 'abc d', 'b a', 'b  z'],
    'sort -h': ['0K', '1K', '2', '1M', '-1K', '220 Mar', '8.3K y', '1.5K x', '1m', '3k', '2R', '1Q', '-2', '-3M', '5.K', '2.5.K'],
    'tr -d a-z\\n': ['abc', 'de'],
    uniq: ['a b', 'a b', 'x b', 'A c', 'a c', 'a c'],
    cut: ['a,b,c', 'abcdef', 'x,,y'],
    tr: ['Hello aaa World', 'xyz\\q 123'],
    head: ['one', 'two', 'three', 'four'],
    tail: ['one', 'two', 'three', 'four'],
  };
  const cases: string[][] = [
    ['sort', '-d'], ['sort', '-i'], ['sort', '-g'], ['sort', '-V'], ['sort', '-b', '-k2'], ['sort', '-k2b,2'], ['sort', '-k2.2b,3.1b'], ['sort', '-k5'],
    ['sort', '-k1,9'], ['sort', '-s', '-k1,1'], ['sort', '-k1.2,1.3'], ['sort', '-t', ' ', '-k1.3,2'], ['sort', '-f'], ['sort', '-h', '-k2,2'], ['sort', '-t', ' ', '-k2,2n'],
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
      [() => expandSet('[:foo:]'), 'class'], [() => expandSet('z-a'), 'reverse'], [() => runTr(['a', 'b', 'c'], []), 'extra operand'], [() => runTr(['-d', undefined as unknown as string], []), 'sets'], [() => runTr(['-c', 'a', 'xy'], []), '-c with'],
      [() => runTr(['a', ''], []), 'empty set2'], [() => runTr(['-ds', 'a'], []), 'extra operand'], [() => runTr(['a'], []), 'extra operand'], [() => runHead(['-n', 'x'], []), '-n'], [() => runTail(['-n', 'x'], []), '-n'],
      [() => runSeq(['1', '0', '3']), 'zero'], [() => runSeq(['1', '100000']), 'too long'], [() => runSeq(['-f', '%g', '3']), '-f'],
    ];
    for (const [f, msg] of fails) assert.throws(f, (e: Error) => e instanceof Unsupported && e.message.includes(msg), msg);
    assert.deepStrictEqual(parseOptions('sort', ['--', '-x'], {}).operands, ['-x']);
    assert.strictEqual(sampleInput('wc', []), undefined);
    assert.strictEqual(commandExample('nope', []), undefined);
    assert.ok(sampleInput('cut', ['-s', '-f', '2'])!.includes('no delimiter here'));
    assert.deepStrictEqual(expandSet('a[x*]'), ['a']);
    assert.deepStrictEqual(runHead([undefined, '-1'], ['a', 'b']), ['a']);
    assert.ok(sampleInput('cut', ['-d,']));
    assert.ok(sampleInput('tr', [undefined, 'x']));
  });
});


describe('the explanation of a tr set follows the options as GNU tr reads them', () => {
  // `--delete` is `-d` however it is written; a set is deleted when tr removes its characters.
  const parser = createUnbashParser();
  for (const line of ['tr --delete a', 'tr -d a', 'tr -s a', 'tr a b', 'tr -ds a b']) {
    it(line, () => {
      const set = allTokens(new Analyzer('en').explainLine(parser.parse(line), 0).items).find((t) => t.label === 'a')!;
      const deleted = real('tr', line.split(' ').slice(1), ['ab']).join('').length < 2;
      assert.strictEqual(/characters to delete/.test(set.explanation), deleted, set.explanation);
    });
  }
});

describe('a well-known system file read shows lines of its own format, and the tools agree on them', () => {
  const parser = createUnbashParser();
  // Each line reads one of the files of src/examples/systemfiles.ts: the example's input is its sample, and the output
  // is what the real tools (GNU coreutils, gawk, GNU sed and grep) print for it, run on a copy of the sample.
  const lines: [string, string][] = [
    ['cut -d: -f1,7 /etc/passwd', '/etc/passwd'],
    ['cut -d: -f1 < /etc/passwd', '/etc/passwd'],
    ['cat /etc/passwd | cut -d: -f1', '/etc/passwd'],
    ['grep bash /etc/passwd | cut -d: -f1,6', '/etc/passwd'],
    ["awk -F: '$3 >= 1000 {print $1}' /etc/passwd", '/etc/passwd'],
    ['sort -t: -k3 -n /etc/passwd', '/etc/passwd'],
    ['sed -n 1p /etc/passwd', '/etc/passwd'],
    ['cut -d: -f1,4 /etc/group', '/etc/group'],
    ["awk -F: '$2 !~ /^[!*]/ {print $1}' /etc/shadow", '/etc/shadow'],
    ["awk '{print $1}' /etc/hosts", '/etc/hosts'],
    ['head -2 /etc/hosts', '/etc/hosts'],
    ["cut -d' ' -f2,3 /etc/fstab", '/etc/fstab'],
  ];
  for (const [line, file] of lines) {
    it(line, () => {
      const ex = new Analyzer('en').explainLine(parser.parse(line), 0).examples.find((x) => x.sections[0]?.label.includes(`\`${file}\``));
      assert.ok(ex, 'has an example that reads the file');
      assert.deepStrictEqual(ex.sections[0].lines, SYSTEM_FILES[file]);
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explain-system-files-'));
      try {
        fs.writeFileSync(path.join(dir, 'sample'), SYSTEM_FILES[file].join('\n') + '\n');
        const out = runBash(line.split(file).join('./sample'), { cwd: dir }).stdout;
        assert.deepStrictEqual(ex.sections[ex.sections.length - 1].lines, out.replace(/\n$/, '').split('\n'));
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  }
  it('says the lines are a sample, and keeps made-up lines for other files', () => {
    const ja = new Analyzer('ja').explainLine(parser.parse('cut -d: -f1,7 /etc/passwd'), 0).examples[0];
    assert.strictEqual(ja.sections[0].label, '入力: `/etc/passwd`（中身の例）');
    assert.deepStrictEqual(ja.sections[1].lines, ['root:/bin/bash', 'daemon:/usr/sbin/nologin', 'nobody:/usr/sbin/nologin', 'alice:/bin/bash', 'bob:/bin/zsh']);
    const other = new Analyzer('en').explainLine(parser.parse('cut -d: -f1,7 users.txt'), 0).examples[0];
    assert.ok(!other.sections[0].lines.some((l) => l.startsWith('root:')));
    // (With another file, each is a stream of its own: the other keeps made-up lines.)
    const both = new Analyzer('en').explainLine(parser.parse('cut -d: -f1 users.txt /etc/passwd'), 0).examples[0];
    assert.ok(!both.sections[0].lines.some((l) => l.startsWith('root:')));
    assert.deepStrictEqual(both.sections[1].lines, SYSTEM_FILES['/etc/passwd']);
  });
});
