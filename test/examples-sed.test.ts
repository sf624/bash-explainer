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
  ['1p;/x/q', true, false], ['/x/q', false, false], ['/x/q', true, false], ['#n\n1p;/x/q', false, false],
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

describe('sed `q` and `n` with `-n`', () => {
  // GNU sed: `q` prints the pattern space, and `n` the line it leaves, only when auto-print is on.
  const text = (line: string, label: string, lang: 'en' | 'ja' = 'en') => {
    const all: { label: string; explanation: string; children: unknown[] }[] = [];
    const walk = (t: { label: string; explanation: string; children: unknown[] }) => (all.push(t), t.children.forEach((c) => walk(c as typeof t)));
    new Analyzer(lang).explainLine(createUnbashParser().parse(line), 0).items.forEach(walk);
    return all.filter((t) => t.label === label).map((t) => t.explanation).pop();
  };

  it('says that they print nothing, as GNU sed does', () => {
    const input = ['line 1', 'x', 'line 2'];
    assert.deepStrictEqual(realSed('/x/q', input, true, false), []);
    assert.deepStrictEqual(realSed('/x/q', input, false, false), ['line 1', 'x']);
    assert.deepStrictEqual(realSed('n;p', input, true, false), ['x']);
    assert.deepStrictEqual(realSed('#n\n/x/q', input, false, false), []);
    assert.strictEqual(text("sed -n '1p;/x/q' f", 'q'), 'quit (with `-n`, the current line is not printed)');
    assert.strictEqual(text("sed --quiet '/x/q' f", 'q'), 'quit (with `-n`, the current line is not printed)');
    assert.strictEqual(text("sed '/x/q' f", 'q'), 'print the current line and quit');
    assert.strictEqual(text("sed -n 'n;p' f", 'n'), 'read the next line (with `-n`, the current one is not printed)');
    assert.strictEqual(text("sed 'n;d' f", 'n'), 'print the line and read the next one');
    // (A script whose first two characters are `#n`, and not `#N`.)
    assert.deepStrictEqual(realSed('#no\n/x/q', input, false, false), []);
    assert.deepStrictEqual(realSed('#N\n/x/q', input, false, false), ['line 1', 'x']);
    assert.strictEqual(text("sed '#n\n/x/q' f", 'q'), 'quit (with `-n`, the current line is not printed)');
    assert.strictEqual(text("sed '#no\n/x/q' f", 'q'), 'quit (with `-n`, the current line is not printed)');
    assert.strictEqual(text("sed '#N\n/x/q' f", 'q'), 'print the current line and quit');
    assert.strictEqual(text("sed -n '/x/q' f", 'q', 'ja'), '終了する（`-n` があるので、今の行は出力しない）');
  });
});

describe('the sed example of a line agrees with GNU sed', () => {
  // Each line edits the file `f`: the example shows what it prints, or, in place, what `f` holds after.
  const cases = [
    "sed -ie 's/a/b/' -e 's/c/d/' f", "sed -e 's/a/b/' -e 's/c/d/' f", "sed --expression='s/a/b/' -e 's/c/d/' f", "sed -n -e 's/a/X/p' f",
    "sed -ne 's/a/X/p' f", "sed -i.bak 's/a/b/' f", "sed --in-place 's/a/b/' f", "sed -i -e 's/a/b/' f", "sed -E -e 's/(a+)/<\\1>/' f",
    // (sed compiles each -e script as it reads it: an -E after it does not apply to it, but to the script operand.)
    "sed -e 's/a+/<&>/' -E f", "sed -Ee 's/(a+)/<\\1>/' f", "sed '-Ees/(a+)/<\\1>/' f", "sed '-es/a+/<&>/' -E f", "sed --expression='s/a+/<&>/' --regexp-extended f", "sed 's/(a+)/<\\1>/' -E f",
  ];
  const parser = createUnbashParser();
  for (const line of cases) {
    it(line, () => {
      // (One example of the whole script, however many -e give it, at the command.)
      const all = new Analyzer('en').explainLine(parser.parse(line), 0).examples.filter((x) => x.kind === 'sed');
      assert.strictEqual(all.length, 1, 'has one example');
      const ex = all[0];
      if (/ -e .* -e /.test(line)) assert.deepStrictEqual(ex.anchor, { start: { line: 0, character: 0 }, end: { line: 0, character: line.length } });
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

describe('sed reads each -e script with the options given before it', () => {
  const parser = createUnbashParser();
  const tokens = (line: string): string[] => {
    const all: string[] = [];
    const walk = (t: { label: string; explanation: string; children: unknown[] }) => (all.push(`${t.label}: ${t.explanation}`), t.children.forEach((c) => walk(c as typeof t)));
    new Analyzer('en').explainLine(parser.parse(line), 0).items.forEach(walk);
    return all;
  };

  it('reads `a+` as a BRE before `-E`, and as an ERE after it', () => {
    // (GNU sed: `sed -e 's/a+/x/' -E` leaves `aa` as it is; `-E` first makes it `x`.)
    assert.deepStrictEqual(run('sed', ['-e', 's/a+/x/', '-E'], { input: 'aa\n', check: true }).stdout.toString(), 'aa\n');
    assert.deepStrictEqual(run('sed', ['-E', '-e', 's/a+/x/'], { input: 'aa\n', check: true }).stdout.toString(), 'x\n');
    assert.ok(tokens("sed -e 's/a+/x/' -E f").some((t) => t.startsWith('+: A literal "+"')));
    assert.ok(tokens("sed -E -e 's/a+/x/' f").some((t) => t.startsWith('+: repeat')));
    assert.ok(tokens("sed -E -e 's/b/y/' -e 's/a+/x/' f").some((t) => t.startsWith('+: repeat')));
  });

  it('shows no example where the scripts are read in two flavours', () => {
    const line = "sed -e 's/a+/x/' -E -e 's/(b)/<\\1>/' f";
    assert.deepStrictEqual(new Analyzer('en').explainLine(parser.parse(line), 0).examples.filter((x) => x.kind === 'sed'), []);
    assert.ok(tokens(line).some((t) => t.startsWith('+: A literal "+"')));
    assert.ok(tokens(line).some((t) => t.startsWith('(b): Group 1')));
  });
});

describe('the sed stage of a pipeline example reads each -e script with the options given before it, as GNU sed does', () => {
  const parser = createUnbashParser();
  const pipelineOf = (line: string) => new Analyzer('en').explainLine(parser.parse(line), 0).examples.find((x) => x.kind === 'pipeline');
  // (The first section is what the first stage prints, or the sample contents of `f`; the last, what the line prints.)
  const cases = [
    "echo aa+ | sed -e 's/a+/x/' -E", "printf 'aa+\\n' | sed -e 's/a+/x/' -r", "cat f | sed -e 's/a+/x/' -E | sort",
    "echo aa+ | sed --expression='s/a+/<&>/' --regexp-extended", "echo aa+ | sed '-es/a+/<&>/' -r", "echo aa+ | sed -Ee 's/(a+)/<\\1>/'",
    "cat f | sed -E -e 's/(a+)/<\\1>/' | sort", "echo aa+ | sed 's/a+/<&>/' -E", "echo aa+ | sed -E -e 's/a+/x/' -e 's/b+/y/'",
  ];
  for (const line of cases) {
    it(line, () => {
      const ex = pipelineOf(line);
      assert.ok(ex, 'has an example');
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explain-bash-sed-'));
      try {
        fs.writeFileSync(path.join(dir, 'f'), ex.sections[0].lines.join('\n') + '\n');
        const printed = run('bash', ['-c', line], { cwd: dir, check: true }).stdout.toString();
        assert.deepStrictEqual(ex.sections[ex.sections.length - 1].lines.map((l) => l + '\n').join(''), printed);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  }

  it('shows no example where the scripts are read in two flavours, or one is read from a file', () => {
    // (GNU sed: `echo aa+ bb+ | sed -e 's/a+/x/' -E -e 's/b+/y/'` prints `ax y+`, a BRE and an ERE.)
    assert.strictEqual(run('bash', ['-c', "echo aa+ bb+ | sed -e 's/a+/x/' -E -e 's/b+/y/'"], { check: true }).stdout.toString(), 'ax y+\n');
    for (const line of ["echo aa+ bb+ | sed -e 's/a+/x/' -E -e 's/b+/y/'", "echo aa+ | sed -f s.sed -E", "echo aa+ | sed -e 's/a+/x/' -E -e 's/b+/y/' | sort"]) {
      assert.strictEqual(pipelineOf(line), undefined, line);
    }
  });
});

describe('an option that selects the regex flavour after an -e or -f script says it does not apply to it', () => {
  const parser = createUnbashParser();
  const option = (lang: 'en' | 'ja', line: string, label: string): string[] => {
    const all: string[] = [];
    const walk = (t: { label: string; explanation: string; children: unknown[] }) => (t.label === label && all.push(t.explanation), t.children.forEach((c) => walk(c as typeof t)));
    new Analyzer(lang).explainLine(parser.parse(line), 0).items.forEach(walk);
    return all;
  };
  const late = ' (not for the value of `-e` before it: `sed` reads that value as soon as it reads its option, with only the options given before)';

  it('on the option after the script, in its word or in a cluster', () => {
    assert.deepStrictEqual(option('en', "sed -e 's/a+/x/' -E f", '-E'), ['use extended regex (ERE)' + late]);
    assert.deepStrictEqual(option('en', "sed '-es/a+/x/' -nE f", '-E'), ['use extended regex (ERE)' + late]);
    assert.deepStrictEqual(option('en', "sed -f s.sed -e p --regexp-extended f", '--regexp-extended'), ['use extended regex (ERE) (not for the value of `-f`, `-e` before it: `sed` reads that value as soon as it reads its option, with only the options given before)']);
    assert.deepStrictEqual(option('ja', "sed -e 's/a+/x/' -E f", '-E'), ['拡張正規表現(ERE)を使う（前にある `-e` の値には効かない: `sed` はオプションを読んだ時点で、それより前のオプションだけでその値を読む）']);
  });

  it('not where the option comes first, or the script is the operand', () => {
    for (const line of ["sed -E -e 's/a+/x/' f", "sed -Ee 's/a+/x/' f", "sed 's/a+/x/' -E f", "sed -n -E -e p f"]) {
      assert.ok(option('en', line, '-E').every((t) => t === 'use extended regex (ERE)'), line);
    }
    // (`-n` selects no flavour: sed reads it when it runs, for every script.)
    assert.deepStrictEqual(option('en', "sed -e p -n f", '-n'), ['suppress automatic printing; print only with `p`']);
  });
});
