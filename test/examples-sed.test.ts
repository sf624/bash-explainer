import * as assert from 'assert';
import { run } from './support/run';
import { runSed, sedExample } from '../src/examples/sed';

function realSed(script: string, input: string[], quiet: boolean, extended: boolean): string[] {
  const args = [...(quiet ? ['-n'] : []), ...(extended ? ['-E'] : []), script];
  return run('sed', args, { input: input.join('\n') + '\n', check: true }).stdout.toString().split('\n').slice(0, -1);
}

const cases: [string, boolean, boolean][] = [
  ['s/([0-9]{4})-([0-9]{2})-([0-9]{2})/\\3\\/\\2\\/\\1/g', false, true],
  ['/^BEGIN/,/^END/p', true, false], ['1d;$d', false, false], ['s/^[ \\t]*//', false, false], ['/^#/d', false, false],
  ['s/foo/bar/', false, false], ['s/foo/bar/g', false, false], ['s/foo/bar/2', false, false], ['s/foo/bar/2g', false, false],
  ['s/.*/\\U&/', false, false], ['s/\\(.\\)\\(.*\\)/\\u\\1\\L\\2/', false, false], ['y/abc/xyz/', false, false],
  ['2,+1!s|/usr|/opt|', false, false], ['/x/{s/x/y/;p}', true, false], ['3q', false, false], ['2Q', false, false],
  ['/foo/i\\\ninserted', false, false], ['/foo/a appended', false, false], ['/foo/c changed', false, false],
  ['0~2d', false, false], ['$!d', false, false], ['/a/,+1d', false, false], ['s/x/[&]/p', true, false],
  ['s/^[ \\t]*//\n/^#/d', false, false], ['/^$/d', false, false], ['=', false, false], ['s/A/b/Ig', false, false],
];

describe('sed examples agree with GNU sed', () => {
  for (const [script, quiet, extended] of cases) {
    it(script.replace(/\n/g, '⏎'), () => {
      const ex = sedExample(script, { quiet, extended });
      assert.ok(ex, 'has an example');
      assert.deepStrictEqual(ex.output, realSed(script, ex.input, quiet, extended), `input ${JSON.stringify(ex.input)}`);
    });
  }
});

describe('sed example input', () => {
  it('puts two matches on a line so g makes a visible difference', () => {
    assert.deepStrictEqual(sedExample('s/foo/bar/', { quiet: false, extended: false }), { input: ['foo foo'], output: ['bar foo'] });
    assert.deepStrictEqual(sedExample('s/foo/bar/g', { quiet: false, extended: false })!.output, ['bar bar']);
  });

  it('surrounds address matches with ordinary lines', () => {
    const ex = sedExample('s/^[ \\t]*//\n/^#/d', { quiet: false, extended: false })!;
    assert.ok(ex.input.some((l) => l.startsWith('line ')), JSON.stringify(ex.input));
  });

  it('gives up on commands it cannot run', () => {
    for (const s of ['s/a/b/;n', 'N;P;D', 'h;G', ':a;s/x/y/;ta', 's/a/b/w out', '100d']) {
      assert.strictEqual(sedExample(s, { quiet: false, extended: false }), undefined, s);
    }
    assert.strictEqual(runSed('x', ['a'], { quiet: false, extended: false }), undefined);
  });
});

describe('the sed runner agrees with GNU sed on the less common commands', () => {
  const input = ['abc', 'foo bar', 'Abc def', 'line 4', 'end'];
  const scripts: [string, boolean?][] = [
    ['\\%a%p', true], ['1 !d'], ['2! d'], ['y/a\\nb/x\\ty/'], ['2q0'], ['2q;p'], ['2,3c X'], ['2,4d'], ['2~0p', true],
    ['s/\\(a\\)\\?b/[\\1]/'], ['s/a/\\n\\t/'], ['s/\\(b\\)/\\2|\\1/'.replace('\\2', ''), false], ['s/.*/\\U&\\E!/'], ['s/.*/\\l&/'], ['s/A/\\u\\La/'],
    ['/a/s//X/'], ['s/b/B/;//p'], ['s/A/\\l\\UB/'], ['s/.*/\\L\\u&/'], ['/b/p;/x/!{//p}', true], ['y/a\\/b/x\\/\\q/'], ['2{q};p'], ['2{d};p'],
  ];
  for (const [script, quiet = false] of scripts) {
    it(script, () => {
      assert.deepStrictEqual(runSed(script, input, { quiet, extended: false }), realSed(script, input, quiet, false));
    });
  }
  it('gives up on what it does not run', () => {
    for (const script of ['{p', '}', 's/a\nb/x/', 's/a', 's/[[:foo:]]/x/', '/a/Mp', 's/a/b\nc/', 's/a/b', 'y/ab/c/', 'y/ab/', 's/a/b/w out', 'n', 's/\\(b\\)/\\9/', '//p', 's//x/', '2{/a/p};//p']) {
      assert.strictEqual(runSed(script, input, { quiet: false, extended: false }), undefined, script);
    }
  });
  it('makes up input only while it stays short', () => {
    assert.strictEqual(sedExample('9p', { quiet: false, extended: false }), undefined);
    assert.strictEqual(sedExample('/a/p;/b/p;/c/p;/d/p;/e/p', { quiet: true, extended: false }), undefined);
    const ex = sedExample('/line\\|text\\|data\\|note/d', { quiet: false, extended: false })!;
    assert.ok(ex.input.includes('1'), JSON.stringify(ex.input));
    for (const script of ['s/^a/b/', 's/a$/b/', 's/^a$/b/', '1,3p', '2~0p']) {
      const e = sedExample(script, { quiet: false, extended: false })!;
      assert.deepStrictEqual(e.output, realSed(script, e.input, false, false), script);
    }
  });
});

