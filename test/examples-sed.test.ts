import * as assert from 'assert';
import { execFileSync } from 'child_process';
import { runSed, sedExample } from '../src/examples/sed';

function realSed(script: string, input: string[], quiet: boolean, extended: boolean): string[] {
  const args = [...(quiet ? ['-n'] : []), ...(extended ? ['-E'] : []), script];
  return execFileSync('sed', args, { input: input.join('\n') + '\n' }).toString().split('\n').slice(0, -1);
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
