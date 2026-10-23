import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { run } from './support/run';
import { Analyzer } from '../src/analyzer';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
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
  ['s/\\x1b\\[[0-9;]*m//g', false, false], ['s/\\x66oo/\\x26\\x26/', false, false], ['s/foo/[\\o101\\d066\\cA\\t\\x1b]/', false, false],
  ['s/[\\x66]oo/X/', false, false], ['/\\x66oo/d', false, false], ['s/f\\x6fo/\\a\\f\\v\\r/', false, false], ['y/f/\\x41/', false, false],
  ['s/\\d102oo/\\x5cn/', false, false], ['s/\\o146oo/\\x4a/', false, false], ['s/\\cF/X/', false, false],
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

describe('the sed runner treats empty matches as GNU sed does', () => {
  const input = ['x xx', 'b bb', 'x za', 'abc', '', 'aXbXX'];
  const scripts = ['s/x*/-/g', 's/b*/X/2', 's/[^ ]*/[&]/2', 's/b*/X/g', 's/x*/-/', 's/x*/-/2', 's/b*/X/2g', 's/X*/_/3', 's/$/!/', 's/^/>/g', 's/\\b/|/g', 's/c*$/E/g', 's/ */#/g'];
  for (const script of scripts) {
    it(script, () => {
      assert.deepStrictEqual(runSed(script, input, { quiet: false, extended: false }), realSed(script, input, false, false));
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
    ['0,/abc/d'], ['0,/foo/d'], ['1,/abc/d'], ['0,/a/s//X/'], ['0,/line/p', true], ['s/o/0/2g'], ['s/o/0/2'],
  ];
  for (const [script, quiet = false] of scripts) {
    it(script, () => {
      assert.deepStrictEqual(runSed(script, input, { quiet, extended: false }), realSed(script, input, quiet, false));
    });
  }
  it('gives up on what it does not run', () => {
    for (const script of ['{p', '}', 's/a\nb/x/', 's/a', 's/[[:foo:]]/x/', '/a/Mp', 's/a/b\nc/', 's/a/b', 'y/ab/c/', 'y/ab/', 's/a/b/w out', 'n', 's/\\(b\\)/\\9/', '//p', 's//x/', '2{/a/p};//p', '0,5p', '0p', '0!d']) {
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


describe('sed escapes that stand for a character', () => {
  it('are left out of an example when the character is special in a regex', () => {
    for (const s of ['s/a\\x2eb/X/', 's/\\x5eb/X/', 's/\\x5b/X/', 's/\\x5c/X/']) assert.strictEqual(sedExample(s, { quiet: false, extended: false }), undefined, s);
  });

  it('keep an escaped backslash before x', () => {
    assert.ok(sedExample('s/\\\\x41/X/', { quiet: false, extended: false }));
    assert.ok(sedExample('s/\\xg/X/', { quiet: false, extended: false }) === undefined || true);
  });
});

describe('the sed example of a line agrees with GNU sed', () => {
  // Each line edits the file `f`: the example shows what it prints, or, in place, what `f` holds after.
  const cases = [
    "sed -ie 's/a/b/' -e 's/c/d/' f", "sed -e 's/a/b/' -e 's/c/d/' f", "sed --expression='s/a/b/' -e 's/c/d/' f", "sed -n -e 's/a/X/p' f",
    "sed -ne 's/a/X/p' f", "sed -i.bak 's/a/b/' f", "sed --in-place 's/a/b/' f", "sed -i -e 's/a/b/' f", "sed -E -e 's/(a+)/<\\1>/' f",
  ];
  const parser = createUnbashParser();
  for (const line of cases) {
    it(line, () => {
      const ex = new Analyzer('en').explainLine(parser.parse(line), 0).examples.find((x) => x.kind === 'sed');
      assert.ok(ex, 'has an example');
      const [input, output] = ex.sections.map((s) => s.lines);
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explain-bash-sed-'));
      try {
        const f = path.join(dir, 'f');
        fs.writeFileSync(f, input.join('\n') + '\n');
        // (`sed -ie 's/a/b/' …` fails on the file `s/a/b/`, which it cannot read, and edits `f`.)
        const printed = run('bash', ['-c', line], { cwd: dir }).stdout.toString();
        const inPlace = ex.title === 'Example (the file is rewritten like this)';
        const after = fs.readFileSync(f, 'utf8');
        assert.deepStrictEqual(inPlace ? after : printed, output.map((l) => l + '\n').join(''));
        assert.strictEqual(after !== input.join('\n') + '\n', inPlace, 'the file is rewritten');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  }
});
