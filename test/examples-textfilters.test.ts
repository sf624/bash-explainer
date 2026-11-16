import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runBash } from './support/bash';
import { run } from './support/run';
import { Analyzer, Token } from '../src/analyzer';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { commandExample, cutMarks, expandSet, filterOf, parseOptions, parseWords, runCut, runHead, runSeq, runSort, runTail, runTr, runUniq, sampleInput, Unsupported } from '../src/examples/textfilters';
import { SYSTEM_FILES } from '../src/examples/systemfiles';
import { Refused } from '../src/examples/regexguard';
import { fact } from '../src/messages';
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
  ['tr', '[:upper:]', '[:lower:]'], ['tr', 'a-z', 'A-Z'], ['tr', '-d', '\\r'], ['tr', 'a', '-d'], ['tr', '-s', ' '], ['tr', '\\n', ' '], ['tr', '-d', '0-9'],
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
    ['tr', '[=a=]', 'b'], ['tr', '\\101\\154', 'xy'], ['tr', '\\q', 'x'], ['tr', '-t', 'abc', 'xy'], ['tr', 'a', '-d'], ['tr', 'l', '-s'], ['tr', 'abcl', 'xy'], ['tr', '-s', 'a'], ['tr', '-c', 'a-z\\n', '_'], ['tr', '-dc', 'a-z'], ['tr', '-cd', 'a-z\\n'], ['tr', '--complement', '--delete', 'a-z'], ['tr', '-cs', 'a-z'], ['tr', '-cs', 'A-Za-z', '[\\n*]'], ['tr', '-ds', 'a-z', 'l'], ['tr', '-cds', 'a-z', 'l'], ['tr', '-s', 'a-z'], ['tr', '-C', 'a-z', 'x'], ['tr', '-cd', '\\000-\\177'], ['tr', '-d', '\\000-\\037'], ['tr', '-cd', '\\11\\12\\15\\40-\\176'], ['tr', '-d', '\\t-\\r'], ['tr', '-d', 'a-\\177'], ['tr', '-ct', 'a-z', 'xy'],
    ['head', '-c', '-3'], ['head', '-c', '6'], ['tail', '-c', '3'], ['tail', '-n', '2'], ['head', '--lines=2'], ['sort', '-h'], ['sort', '--reverse'], ['tr', '-d', 'a-z\\n'], ['tail', '+2'], ['tail'],
  ];
  for (const [cmd, ...args] of cases) {
    it([cmd, ...args].join(' '), () => {
      const lines = input[[cmd, ...args].join(' ')] ?? input[cmd];
      assert.deepStrictEqual(filterOf(cmd)!(args, lines), real(cmd, args, lines));
    });
  }
  // tr -c takes every byte not in the set, in order, from NUL: with -t only the first as many as set2 has are translated
  // (`tr -tc a b` changes NUL only), without it set2 is padded with its last character.
  const TR_C: string[][] = [
    ['-tc', 'a', 'b'], ['-tC', 'a', 'b'], ['-ct', 'a', 'xyz'], ['-tc', 'ab', 'xy'], ['-t', 'abcd', 'xy'], ['-t', 'ab', 'xyz'], ['-c', 'a', 'b'], ['-c', 'a', 'xy'],
    ['-c', 'ab', 'xyz'], ['-cs', 'a', 'xy'], ['-cs', 'a', 'x'], ['-tc', 'a-c', '[x*]'], ['-c', 'a', '[x*]'], ['-tc', '\\000', 'xy'], ['-tc', '\\n', 'xyz'], ['-c', '[:digit:]', 'x'], ['-c', '[:digit:]', 'xx'], ['-c', '0-9', '[:upper:]a'], ['-tc', '0-9', '[:upper:]'], ['-c', 'a', 'x[y*]'],
    ['-tc', 'a-z', '[:upper:]'], ['-t', '[:lower:]', 'ab'], ['-ct', '\\000-\\011', 'abcdefghijkl'],
  ];
  for (const words of TR_C) {
    it(`tr ${words.join(' ')}, on text with control characters`, () => {
      const lines = ['abc\u0000d\u0001e\u0002', 'Hello aaa World', 'xyz 123', '\u0003\u0004'];
      assert.deepStrictEqual(runTr(words, lines), real('tr', words, lines));
    });
  }
  // Repeats and case classes: what tr refuses gets no example (`[c*]` in string 1, `-ds` with `[c*]` in string 2, case
  // classes that are not aligned), the rest is what tr prints: a count with a leading 0 is octal.
  const TR_REPEATS: { words: string[]; refused?: true }[] = [
    { words: ['[x*010]', 'A-Z'] }, { words: ['-tc', 'a', '[x*010]'] }, { words: ['abc', 'x[y*07]z'] }, { words: ['-s', 'abc', '[x*00]'] }, { words: ['[x*3]', 'y'] }, { words: ['ab', '[x*2]'] },
    { words: ['-s', 'a', '[x*]'] }, { words: ['-ds', 'a', '[x*3]'] }, { words: ['ab', '[x*08]'], refused: true }, { words: ['x', '[x*0x]'], refused: true }, { words: ['a', '[x*b]'], refused: true },
    { words: ['[a*]', 'x'], refused: true }, { words: ['-c', '[a*]', 'xy'], refused: true }, { words: ['-C', '[a*]', 'xy'], refused: true }, { words: ['--complement', '[a*]', 'xy'], refused: true },
    { words: ['-cs', '[a*]', 'xy'], refused: true }, { words: ['-C', '-t', '[x*]', '-ds'], refused: true }, { words: ['-d', '[x*]'], refused: true }, { words: ['-s', '[x*]'], refused: true },
    { words: ['[x*0]', 'y'], refused: true }, { words: ['-ds', 'a', '[x*]'], refused: true }, { words: ['-cds', '0-9', '[x*]'], refused: true }, { words: ['-ds', 'a', '[x*0]'], refused: true },
    { words: ['[:upper:]', '[:lower:]'] }, { words: ['[:upper:]', '[:upper:]'] }, { words: ['A[:upper:]', 'x[:lower:]'] }, { words: ['[:upper:][:lower:]', '[:lower:][:upper:]'] }, { words: ['[:lower:]', 'x'] },
    { words: ['[:lower:]a', '[:upper:]b'] }, { words: ['ab[:lower:]', 'xy[:upper:]'] }, { words: ['a[:lower:]', 'x[:upper:]y'] }, { words: ['-c', 'a', '[:upper:]a'] }, { words: ['-tc', 'a-z', '[:upper:]'] },
    { words: ['-ds', 'a', '[:upper:]'] }, { words: ['-s', '[:lower:]', '[:upper:]'] }, { words: ['[:upper:]', '[:lower:]a'] },
    { words: ['a-z', '[:upper:]'], refused: true }, { words: ['-t', 'abc', '[:upper:]'], refused: true }, { words: ['[:upper:]', 'a[:lower:]'], refused: true }, { words: ['[:upper:]', 'xyz[:lower:]'], refused: true },
    { words: ['[:digit:]', '[:lower:]'], refused: true }, { words: ['a', 'x[:upper:]'], refused: true }, { words: ['a', '[:upper:]'], refused: true }, { words: ['ab[:lower:]', 'x[:upper:]'], refused: true },
    { words: ['[:lower:]', '[:upper:][:upper:]'], refused: true }, { words: ['a[:upper:]', '[:lower:]'], refused: true },
  ];
  for (const { words, refused } of TR_REPEATS) {
    it(`tr ${words.join(' ')}: ${refused ? 'tr refuses it, no example' : 'as tr prints'}`, () => {
      const lines = ['abc', 'x', 'Hello aaa World', 'a\u0001b\tc', 'xyz 123 ABC'];
      const r = run('tr', words, { input: lines.join('\n') + '\n', env: { ...process.env, LC_ALL: 'C' } });
      if (refused) {
        assert.notStrictEqual(r.status, 0, 'tr takes it');
        assert.throws(() => runTr(words, lines), Unsupported);
      } else {
        assert.strictEqual(r.status, 0, r.stderr.toString());
        assert.deepStrictEqual(runTr(words, lines), real('tr', words, lines));
      }
    });
  }

  it('gives up on what it does not run', () => {
    const fails: [() => unknown, string][] = [
      [() => runSort(['-t', 'ab'], []), '-t'], [() => runSort(['--key'], []), 'missing'], [() => runSort(['-k'], []), 'missing'], [() => runSort(['--nope'], []), '--nope'],
      [() => runUniq(['-z'], []), '-z'], [() => runCut(['-f', 'x'], []), 'list'], [() => runCut(['-d', 'ab', '-f', '1'], []), 'refused'], [() => runCut(['-d', '', '-f', '1'], []), '-d'], [() => runCut([], []), 'cut needs'],
      [() => expandSet('[:foo:]'), 'class'], [() => expandSet('z-a'), 'reverse'], [() => runTr(['a', 'b', 'c'], []), 'extra operand'], [() => runTr(['-d', undefined as unknown as string], []), 'sets'], [() => runTr(['[=é=]', 'x'], ['x']), 'equivalence class'], [() => expandSet('\\400'), 'octal escape'], [() => runTr(['-tc', '[:digit:]', 'x'], ['x']), 'class'], [() => runTr(['[:lower:]', '[:upper:][x*]'], ['x']), 'misaligned'],
       [() => runTr(['-d', 'a', '-s', 'b'], ['x']), 'extra operand'], [() => runTr(['a', 'b', '-d'], ['x']), 'extra operand'], [() => runTr(['-c', '[:digit:]', 'xy'], ['x']), 'class'],
      [() => runTr(['a', '[=b=]'], ['x']), 'class in set2'], [() => runTr(['a', '[:digit:]'], ['x']), 'class in set2'], [() => runTr(['-c', '0-9', '[:upper:]'], ['x']), 'ends with a class'], [() => runTr(['-C', 'a-z', '[:upper:]'], ['x']), 'ends with a class'],
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

/** Single quotes for bash around a word. */
const shq = (w: string): string => `'${w.replace(/'/g, `'\\''`)}'`;

/**
 * What GNU coreutils prints for each case, in one bash run in the locale `locale`: its stdout as bytes, and its status. Each
 * case's input is a file of its own (`run`'s rule: no pipe), and a byte that no case prints, \x1e, separates them.
 */
function realBytes(cases: readonly { words: string[]; lines: string[] }[], locale: string): { out: Buffer; status: number }[] {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explain-bash-bytes-'));
  try {
    const script = cases.map(({ words, lines }, i) => {
      fs.writeFileSync(path.join(dir, `in${i}`), lines.join('\n') + '\n');
      return `${words.map(shq).join(' ')} < ${shq(path.join(dir, `in${i}`))} 2>/dev/null; printf '\\036%d\\036' $?`;
    }).join('\n');
    const out = run('bash', ['-c', script], { env: { ...process.env, LC_ALL: locale } }).stdout;
    const parts: { out: Buffer; status: number }[] = [];
    let from = 0;
    for (let i = 0; i < cases.length; i++) {
      const sep = out.indexOf(0x1e, from);
      const end = out.indexOf(0x1e, sep + 1);
      parts.push({ out: out.subarray(from, sep), status: Number(out.subarray(sep + 1, end).toString()) });
      from = end + 1;
    }
    return parts;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('tr, cut -c and -b, head -c and tail -c work on bytes beyond ASCII, as GNU coreutils does in every locale', () => {
  // [words, input lines]. A character beyond ASCII is its bytes of UTF-8: each is a member of a tr set, and cut, head and
  // tail count them. Where the bytes printed are not UTF-8, the example says it does not show them; where the tool refuses
  // the line (`[=é=]`, `cut -dé`), there is no example.
  const CASES: { words: string[]; lines: string[] }[] = [
    { words: ['tr', 'ａ-ｚ', 'a-z'], lines: ['ａｂｃ'] }, { words: ['tr', '　', ' '], lines: ['a　b'] }, { words: ['tr', '-d', 'い'], lines: ['あいう'] },
    { words: ['tr', 'é', 'x'], lines: ['abc é xyz é'] }, { words: ['tr', 'a-z', 'A-Z'], lines: ['あ a'] }, { words: ['tr', 'あ', 'い'], lines: ['あいう', 'かきく'] },
    { words: ['tr', '-d', '[:alpha:]'], lines: ['aéb'] }, { words: ['tr', '[:alnum:]', 'x'], lines: ['aé1'] }, { words: ['tr', '-d', '[:punct:]'], lines: ['a,é!'] },
    { words: ['tr', '-cd', '[:alpha:]\\n'], lines: ['aéb'] }, { words: ['tr', '-c', 'a-z\\n', '_'], lines: ['aéb'] }, { words: ['tr', '-cs', 'a-z\\n', '_'], lines: ['aééb'] },
    { words: ['tr', '-C', 'a-z\\n', '_'], lines: ['aéb'] }, { words: ['tr', '-s', 'あ'], lines: ['ああいい'] }, { words: ['tr', '-s', '　'], lines: ['a  　　b'] },
    { words: ['tr', '-d', '\\343'], lines: ['あいう'] }, { words: ['tr', '\\343\\201\\202', 'xyz'], lines: ['あい'] }, { words: ['tr', 'a', '[é*3]'], lines: ['aéb'] },
    { words: ['tr', '[é*2]', 'xy'], lines: ['aéb'] }, { words: ['tr', '[=é=]', 'xy'], lines: ['aéb'] }, { words: ['tr', '-t', 'éa', 'x'], lines: ['aéb'] },
    { words: ['tr', 'é-ê', 'x'], lines: ['é'] }, { words: ['tr', '-ds', 'é', 'a'], lines: ['aaéb'] }, { words: ['tr', 'a', 'é'], lines: ['abc'] },
    { words: ['cut', '-c1-3'], lines: ['あいう', 'abcdef'] }, { words: ['cut', '-b1-2'], lines: ['あいう'] }, { words: ['cut', '-c4-6'], lines: ['あいう'] },
    { words: ['cut', '-c1-3', '--complement'], lines: ['あいう'] }, { words: ['cut', '-c1-3,7-9', '--output-delimiter=、'], lines: ['あいう'] },
    { words: ['cut', '-d,', '-f2'], lines: ['あ,い,う'] }, { words: ['cut', '-dé', '-f1'], lines: ['a,b'] }, { words: ['cut', '-dab', '-f1'], lines: ['a,b'] },
    { words: ['cut', '--delimiter=、', '-f1'], lines: ['a、b'] },
    { words: ['head', '-c', '3'], lines: ['あいう'] }, { words: ['head', '-c', '2'], lines: ['あいう'] }, { words: ['head', '-c', '-4'], lines: ['あいう'] },
    { words: ['tail', '-c', '4'], lines: ['あいう'] }, { words: ['tail', '-c', '+4'], lines: ['あいう'] }, { words: ['tail', '-c', '3'], lines: ['あいう'] },
    { words: ['tr', 'ｚ-ａ', 'x'], lines: ['ａｂｃ'] }, { words: ['tr', 'é-a', 'x'], lines: ['abc'] }, { words: ['tr', 'a-é', 'x'], lines: ['abc é'] },
    // (Sizes with a suffix, as GNU head and tail read them, and `tail -c +0`, which is all of it.)
    { words: ['head', '-c', '1K'], lines: ['abcdef'] }, { words: ['head', '-c', '1kB'], lines: ['abcdef'] }, { words: ['head', '-c', '1KiB'], lines: ['abcdef'] },
    { words: ['head', '-c', '1b'], lines: ['abcdef'] }, { words: ['head', '-c', '-1K'], lines: ['abcdef'] }, { words: ['head', '-c', '1x'], lines: ['abcdef'] },
    { words: ['tail', '-c', '+0'], lines: ['abc', 'de'] }, { words: ['tail', '-c', '1M'], lines: ['abc'] }, { words: ['tail', '-c', '+1'], lines: ['abc'] },
  ];
  const locales = ['C', 'C.UTF-8'].map((l) => realBytes(CASES, l));
  const utf8 = new TextDecoder('utf-8', { fatal: true });
  CASES.forEach(({ words, lines }, i) => {
    it(`${words.join(' ')} on ${JSON.stringify(lines)}`, () => {
      const [cmd, ...args] = words;
      const [c, u] = locales.map((l) => l[i]);
      // (The same in both locales: GNU tr, cut and head have no characters of more bytes.)
      assert.deepStrictEqual(u, c, 'the same in C and C.UTF-8');
      const ours = () => filterOf(cmd)!(args, lines);
      if (c.status !== 0) {
        assert.throws(ours, Unsupported);
        return;
      }
      let text: string | undefined;
      try {
        text = utf8.decode(c.out);
      } catch {
        assert.throws(ours, (e: Error) => e instanceof Refused && e.why === 'bytes-not-computed');
        return;
      }
      assert.deepStrictEqual(ours(), text === '' ? [] : text.replace(/\n$/, '').split('\n'));
    });
  });
});

describe('a line of tr or cut with text beyond ASCII says what GNU tr and cut do with it', () => {
  const parser = createUnbashParser();
  const explain = (line: string, lang: 'en' | 'ja' = 'en') => new Analyzer(lang).explainLine(parser.parse(line), 0);
  const output = (line: string) => explain(line).examples[0]?.sections.at(-1)?.lines;
  it('shows what GNU tr prints, where it is text', () => {
    assert.deepStrictEqual(output("echo 'ａｂｃ' | tr 'ａ-ｚ' 'a-z'"), ['zzczzdzze']);
    assert.deepStrictEqual(output("echo 'a　b' | tr '　' ' '"), ['a   b']);
    assert.deepStrictEqual(output("echo 'abc é xyz é' | tr é x"), ['abc xx xyz xx']);
    assert.deepStrictEqual(output("echo 'あ a' | tr a-z A-Z"), ['あ A']);
    assert.deepStrictEqual(output("echo 'あいう' | cut -c1-3"), ['あ']);
    assert.deepStrictEqual(output("echo 'あいう' | head -c 3"), ['あ']);
    // (A set from `$'…'`: bash gives tr the bytes of `é` and a tab.)
    const ansi = explain("tr $'é\\t' x").examples[0].sections.map((x) => x.lines);
    assert.deepStrictEqual(ansi, [['abc é xyz é'], ['abc xx xyz xx']]);
    assert.strictEqual(runBash("printf '%s\\n' 'abc é xyz é' | tr $'é\\t' x").stdout, 'abc xx xyz xx\n');
    // (Alone, tr's sample holds the characters of its set, whole.)
    assert.deepStrictEqual(explain("tr 'ａ-ｚ' 'a-z'").examples[0].sections.map((x) => x.lines), [['abc ａｚ xyz ａ'], ['abc zzczzz xyz zzc']]);
  });
  it('says it does not show bytes that are not text', () => {
    for (const lang of ['en', 'ja'] as const) {
      const ex = explain("echo 'あいう' | tr -d 'い'", lang).examples[0];
      assert.deepStrictEqual([ex.sections, ex.note], [[], fact(lang, 'bytes-not-computed').text]);
    }
  });
  it('says the pitfall once for a command, by the first set with such characters, in either language', () => {
    const said = (line: string) => (explain(line).facts ?? []).filter((f) => f.id === 'tr-multibyte-set').map((f) => f.body);
    assert.deepStrictEqual(said("tr 'ａ-ｚ' 'a-z'"), [fact('en', 'tr-multibyte-set', { chars: [{ char: 'ａ', bytes: 3 }, { char: 'ｚ', bytes: 3 }] }).body]);
    assert.deepStrictEqual(said("tr 'あ' 'い'"), ["GNU tr works on bytes: in UTF-8 `あ` is 3 bytes, so it is 3 members of the set, and bytes of other characters may change too. For characters beyond ASCII, use `sed` in a UTF-8 locale: `sed 'y/ａｂ/ab/'`"]);
    assert.strictEqual(runBash("printf 'ａｂ\\n' | sed 'y/ａｂ/ab/'", { env: { LC_ALL: 'C.UTF-8' } }).stdout, 'ab\n');
    assert.deepStrictEqual(said("tr a 'é'").length, 1);
    assert.deepStrictEqual(said("tr -ds a 'é'").length, 1);
    assert.deepStrictEqual(said("tr -ds 'é' 'é'").length, 1);
    assert.deepStrictEqual(said("tr -s 'あ'").length, 1);
    assert.deepStrictEqual(said('tr a-z A-Z'), []);
    assert.deepStrictEqual(said("tr -d '\\343'"), []);
    const ja = explain("echo 'a　b' | tr '　' ' '", 'ja').facts!.find((f) => f.id === 'tr-multibyte-set')!;
    assert.strictEqual(ja.body, "GNU の tr はバイト単位で働く: UTF-8 では `　` は3バイトなので集合の3つの要素になり、ほかの文字のバイトも変わることがある。ASCII 以外の文字には、UTF-8 のロケールで `sed` を使う: `sed 'y/ａｂ/ab/'`");
    assert.match(explain("tr 'ａ-ｚ' 'a-z'", 'ja').facts!.find((f) => f.id === 'tr-multibyte-set')!.body, /UTF-8 では `ａ`（3バイト）・`ｚ`（3バイト）はそれぞれ集合の複数の要素になり、/);
    // (The value of a variable read as a set says it too.)
    assert.deepStrictEqual((explain("s='あ'; tr \"$s\" x").facts ?? []).filter((f) => f.id === 'tr-multibyte-set').length, 1);
  });
  it('says cut refuses a delimiter of more than one byte, and shows no output', () => {
    for (const line of ["echo 'a,b' | cut -dé -f1", 'cut -d ab -f1 f', 'cut --delimiter=、 -f1 f']) {
      const r = explain(line);
      assert.deepStrictEqual(r.examples, [], line);
      const value = allTokens(r.items).find((t) => /the delimiter must be a single character/.test(t.explanation));
      assert.ok(value, line);
    }
    assert.match(allTokens(explain('cut -dé -f1', 'ja').items).map((t) => t.explanation).join('\n'), /cut は1バイトより長い区切り文字を受け付けない/);
    assert.notStrictEqual(run('cut', ['-dé', '-f1'], { input: 'a,b\n' }).status, 0);
    // (A delimiter whose text is not known is not refused.)
    for (const words of [['-d', undefined, '-f1'], ['-d', '\t', '-f1']]) assert.ok(!parseWords('cut', words).refusedValue, String(words));
    assert.ok(!parseWords('cut', [undefined, '-f1']).refusedValue);
    assert.deepStrictEqual([parseWords('cut', ['-dé', '-f1']).refusedValue, parseWords('cut', ['-dé', '-f1']).refused], [true, undefined]);
  });
  it('says why cut refuses the delimiter: several characters, one of several bytes, or `\\t` that is no tab', () => {
    const why = (line: string, lang: 'en' | 'ja' = 'en') => allTokens(explain(line, lang).items).find((t) => t.valueFor === '-d')!.explanation;
    const base = 'cut refuses a delimiter of more than one byte: it says `the delimiter must be a single character`, and exits with status 1, doing nothing. ';
    const baseJa = 'cut は1バイトより長い区切り文字を受け付けない: `the delimiter must be a single character` と表示し、何もせずに終了ステータス 1 で終わる。';
    assert.strictEqual(why('cut -d ab -f1 f'), 'Value for `-d`. ' + base + '`ab` is 2 characters');
    assert.strictEqual(why('cut -d ab -f1 f', 'ja'), '`-d` オプションの値。' + baseJa + '`ab` は2文字');
    assert.strictEqual(why('cut -dé -f1 f'), 'Value for `-d`. ' + base + '`é` is one character, but 2 bytes in UTF-8');
    assert.strictEqual(why('cut -dé -f1 f', 'ja'), '`-d` の値。' + baseJa + '`é` は1文字だが、UTF-8 では2バイトになる');
    assert.strictEqual(why("cut -d '\\t' -f2 f"), 'Value for `-d`. ' + base + "cut does not read `\\t` as a tab: it is a backslash and `t`. Tab is the default delimiter: leave out `-d`, or write `-d $'\\t'`");
    assert.strictEqual(why("cut -d '\\t' -f2 f", 'ja'), '`-d` オプションの値。' + baseJa + "cut は `\\t` をタブとして読まない（バックスラッシュと `t` の2文字）。タブは既定の区切り文字なので、`-d` を書かないか、`-d $'\\t'` と書く");
    // (What the hint says, with GNU cut: `-d '\t'` is refused, and both ways out take the field after a tab.)
    assert.deepStrictEqual(["cut -d '\\t' -f2", "cut -d $'\\t' -f2", 'cut -f2'].map((c) => runBash(`printf 'a\\tb\\n' | ${c}`)).map((r) => [r.status, r.stdout]), [[1, ''], [0, 'b\n'], [0, 'b\n']]);
    // (The other words of a refused line read as they do: `-f1` is a field list.)
    assert.ok(allTokens(explain('cut -dé -f1 f').items).some((t) => t.explanation === 'field 1'));
  });
  it('says the bytes a tr set holds beyond ASCII, as GNU tr reads them', () => {
    const rows = (line: string, lang: 'en' | 'ja' = 'en') => allTokens(explain(line, lang).items).filter((t) => t.kind === 'pattern').map((t) => `\`${t.label}\`: ${t.explanation.replace(/^`[^`]*`: /, '')}`);
    assert.deepStrictEqual(rows("tr -d 'い'"), ['`い`: the 3 bytes `\\343 \\201 \\204` of "い", each a member']);
    assert.deepStrictEqual(rows("tr -d 'い'", 'ja'), ['`い`: 「い」の3バイト `\\343 \\201 \\204`（それぞれが要素）']);
    assert.deepStrictEqual(rows("tr 'ａ-ｚ' 'a-z'")[0], '`ａ-ｚ`: not the characters from "ａ" to "ｚ": the bytes `\\357 \\275`, the bytes from `\\201` to `\\357`, the bytes `\\275 \\232`');
    assert.deepStrictEqual(rows("tr 'ａ-ｚ' 'a-z'", 'ja')[0], '`ａ-ｚ`: 「ａ」〜「ｚ」の範囲の文字ではない: バイト `\\357 \\275`、`\\201`〜`\\357` の範囲のバイト、バイト `\\275 \\232`');
    assert.deepStrictEqual(rows("tr 'a-é' x")[0], '`a-é`: not the characters from "a" to "é": the bytes from `\\141` to `\\303`, the bytes `\\251`');
    assert.deepStrictEqual(rows("tr 'é-a' x")[0], '`é-a`: not the characters from "é" to "a": the range of the bytes at its ends, `\\251` to `\\141`, is reversed, and tr refuses it');
    assert.deepStrictEqual(rows("tr 'é-a' x", 'ja')[0], '`é-a`: 「é」〜「a」の範囲の文字ではない: 端のバイトの範囲 `\\251`〜`\\141` が逆順なので、tr は受け付けない');
    assert.deepStrictEqual(rows("tr '\\101-é' x")[0], '`\\101-é`: not the characters from octal 101 to "é": the bytes from `\\101` to `\\303`, the bytes `\\251`');
    assert.deepStrictEqual(rows("tr 'é-\\377' x")[0], '`é-\\377`: not the characters from "é" to octal 377: the bytes `\\303`, the bytes from `\\251` to `\\377`');
    assert.deepStrictEqual(rows("tr '\\n-é' x")[0], '`\\n-é`: not the characters from newline to "é": the bytes from `\\012` to `\\303`, the bytes `\\251`');
    assert.deepStrictEqual(rows("tr '\\q-é' x")[0], '`\\q-é`: not the characters from "q" to "é": the bytes from `\\161` to `\\303`, the bytes `\\251`');
    assert.deepStrictEqual(rows("tr '\\é' x")[0], '`\\é`: the 2 bytes `\\303 \\251` of "é", each a member');
    assert.deepStrictEqual(rows("tr 'Ａ-Ｚａ-ｚ' 'A-Za-z'").length, 4);
    // (`[é*3]` is no repeat: tr reads `[`, the bytes of `é`, `*`, `3` and `]`.)
    assert.deepStrictEqual(rows("tr '[é*3]' x").slice(0, 2), ['`[`: "["', '`é`: the 2 bytes `\\303 \\251` of "é", each a member']);
    assert.deepStrictEqual(rows("tr '\\n-\\r' x").slice(0, 1), ['`\\n-\\r`: the characters from newline to carriage return']);
    assert.notStrictEqual(runBash("echo a | tr 'é-a' x").status, 0);
  });
  it('says cut counts bytes, for -c as for -b, and names the assumption', () => {
    const rows = (line: string, lang: 'en' | 'ja' = 'en') => allTokens(explain(line, lang).items).map((t) => t.explanation);
    for (const line of ['cut -c1-3 f', 'cut -b1-3 f']) {
      assert.ok(rows(line).includes('bytes 1 to 3'), line);
      assert.ok(rows(line, 'ja').includes('1〜3 バイト目'), line);
    }
    assert.ok(rows('cut -c1-3 f').some((t) => t.startsWith('character positions to select; GNU coreutils as released counts bytes, as for `-b` (some distributions count characters in a UTF-8 locale)')));
  });
  it('shows the examples of large inputs it showed before (each byte is not made where the text is ASCII)', () => {
    const ascii = Array.from({ length: 10000 }, (_, i) => `line ${i} of some ascii text`);
    const japanese = Array.from({ length: 1000 }, (_, i) => `日本語のテキストの行 ${i} です。`);
    for (const [cmd, lines] of [['head -c 300', ascii], ['tail -c 300', ascii], ['cut -c1-6', ascii], ['tr a-z A-Z', japanese]] as const) {
      const ex = new Analyzer('en').explainLine(parser.parse(`${cmd} <<'EOF'\n${lines.join('\n')}\nEOF\n`), 0).examples;
      assert.ok(ex.length && !ex[0].note && ex[0].sections.length === 2, `${cmd}: ${ex[0]?.note}`);
    }
  });
  it('marks what cut -c takes by bytes, each character where its first byte is', () => {
    assert.deepStrictEqual(cutMarks(['-c1-3'], ['あいう']).ranges, [[[0, 1]]]);
    assert.deepStrictEqual(cutMarks(['-c2-3'], ['あa']).ranges, [[]]);
    assert.deepStrictEqual(cutMarks(['-c4'], ['あa']).ranges, [[[1, 2]]]);
  });
  it('names the characters of the set, not the value of a hole', () => {
    const said = (explain('tr "é$x" y').facts ?? []).filter((f) => f.id === 'tr-multibyte-set');
    assert.deepStrictEqual(said.map((f) => f.body), [fact('en', 'tr-multibyte-set', { chars: [{ char: 'é', bytes: 2 }] }).body]);
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

describe('the explanation of a tr set under -c says what tr does, as GNU tr does it', () => {
  const parser = createUnbashParser();
  const tokenAt = (line: string, lang: 'en' | 'ja', label: string) => allTokens(new Analyzer(lang).explainLine(parser.parse(line), 0).items).find((t) => t.label === label && t.kind === 'argument')!;
  // [line, input, what tr prints, [the set, what the English note says, what the Japanese note says]…]
  const rows: [string, string, string, [string, RegExp, RegExp][]][] = [
    ['tr -dc a-z', 'a1\n', 'a', [['a-z', /^character set to keep \(every other character is deleted\).*characters to keep \(every other character is deleted\): a-z$/, /残す文字/]]],
    ['tr -cd a-z', 'a1\n', 'a', [['a-z', /characters to keep/, /残す文字/]]],
    ['tr -Cd a-z', 'a1\n', 'a', [['a-z', /characters to keep/, /残す文字/]]],
    ['tr --complement --delete a-z', 'a1\n', 'a', [['a-z', /characters to keep/, /残す文字/]]],
    ['tr -cd \'a-z\\n\'', 'a1\n', 'a\n', [['\'a-z\\n\'', /characters to keep.*: a-z, newline$/, /残す文字/]]],
    ['tr -c a-z x', 'a1\n', 'axx', [['a-z', /character set to leave as is.*characters to leave as they are \(every other character is replaced\): a-z/, /そのままにする文字/], ['x', /replacement characters: "x" \(the characters outside the first set are replaced/, /文字コード順/]]],
    ['tr -C a-z x', 'a1\n', 'axx', [['a-z', /characters to leave as they are/, /そのままにする文字/]]],
    ['tr -cs a-z', 'a11b\n', 'a1b\n', [['a-z', /character set to leave alone.*characters to leave alone \(repeats of every other character are squeezed\)/, /そのままにする文字/]]],
    ['tr -s a-z', 'aab\n', 'ab\n', [['a-z', /^character set whose repeats are squeezed.*characters whose repeats are squeezed: a-z$/, /連続したら1つにまとめる文字/]]],
    ['tr -cs A-Za-z \'[\\n*]\'', 'a, b\n', 'a\nb\n', [['A-Za-z', /characters to leave as they are/, /そのままにする文字/], ['\'[\\n*]\'', /newline repeated as needed \(the characters outside/, /改行を必要なだけ繰り返す/]]],
    ['tr -ds a-z 1', 'a11b\n', '1\n', [['a-z', /characters to delete: a-z$/, /削除する文字/], ['1', /characters whose repeats are squeezed: "1"$/, /連続したら1つにまとめる文字/]]],
    // A range whose ends are octal codes or escapes is a range (it was read as the first end, a "-", and the second).
    ['tr -cd \'\\000-\\177\'', 'caf\u00e9-\n', 'caf-\n', [['\'\\000-\\177\'', /characters to keep \(every other character is deleted\): the characters from octal 000 to octal 177$/, /残す文字.*8進数 000〜8進数 177 の範囲の文字$/]]],
    ['tr -d \'\\000-\\037\'', 'a\x01b\x1fc\n', 'abc', [['\'\\000-\\037\'', /characters to delete: the characters from octal 000 to octal 037$/, /削除する文字/]]],
    ['tr -cd \'\\11\\12\\15\\40-\\176\'', 'a\tb\x01\r\n\x7f', 'a\tb\r\n', [['\'\\11\\12\\15\\40-\\176\'', /octal code 11 \(HT, tab\), the character with octal code 12.*, the characters from octal 40 to octal 176$/, /8進数 40〜8進数 176/]]],
    ['tr -d \'\\t-\\r\'', 'a\tb\nc\x0bd\r\f e', 'abcd e', [['\'\\t-\\r\'', /characters to delete: the characters from tab to carriage return$/, /タブ〜復帰文字\(CR\) の範囲の文字/]]],
    ['tr -d \'a-\\177\'', 'aZb\x7f\n', 'Z\n', [['\'a-\\177\'', /characters to delete: the characters from "a" to octal 177$/, /削除する文字/]]],
    // -t: only as many of the others as the second string has are replaced (here \0 and \1), not every other character.
    ['tr -ct a-z xy', 'aXb\x01\x02\n', 'aXby\x02\n', [['a-z', /^character set to leave as is \(with -t, only some of the other characters are replaced\).*characters to leave as they are: a-z \(with -t, only as many of the others as the second set has characters are replaced, lowest character codes first; the rest stay\)$/, /-t があるので/], ['xy', /replacement characters: "x", "y" \(with -t, only as many characters outside the first set as there are replacement characters are replaced, lowest character codes first; the rest stay\)$/, /-t があるので/]]],
    // -c complements the first string only: b is squeezed, not everything but b.
    ['tr -cds a-b b', 'aabbb', 'aab', [['a-b', /characters to keep/, /残す文字/], ['b', /characters whose repeats are squeezed: "b"$/, /連続したら1つにまとめる文字/]]],
  ];
  for (const [line, input, out, sets] of rows) {
    it(line, () => {
      const words = line.split(' ').slice(1).map((w) => w.replace(/'/g, ''));
      assert.strictEqual(run('tr', words, { input, env: { ...process.env, LC_ALL: 'C' } }).stdout.toString(), out);
      for (const [label, en, ja] of sets) {
        assert.match(tokenAt(line, 'en', label).explanation, en);
        assert.match(tokenAt(line, 'ja', label).explanation, ja);
      }
    });
  }
  it('keeps the case summary for tr without -c only', () => {
    assert.match(tokenAt('tr a-z A-Z', 'en', 'A-Z').explanation, /converts lowercase to uppercase/);
    assert.doesNotMatch(tokenAt('tr -c a-z A-Z', 'en', 'A-Z').explanation, /converts/);
    assert.strictEqual(run('tr', ['-c', 'a-z', 'A-Z'], { input: 'a1\n' }).stdout.toString(), 'aZK');
  });
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
