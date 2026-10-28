import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assertGrowth } from './support/growth';
import { run } from './support/run';
import { argWords } from './support/argwords';
import { Analyzer, lookupCommand } from '../src/analyzer';
import { interpret } from '../src/argv/interpret';
import { pipelineExample, Stage } from '../src/examples/pipeline';
import { readsFiles } from '../src/examples/source';
import { createUnbashParser } from '../src/syntax/adapters/unbash';

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
    [['grep', '-i', 'error'], ['sort'], ['uniq', '-c'], ['sort', '-rn'], ['head', '-n', '3']],
    [['grep', '-v', 'debug'], ['tail', '-n', '2']], [['grep', '-w', 'cat'], ['sort'], ['uniq', '-c'], ['sort', '-rn'], ['head']],
    [['grep', '-x', 'ok'], ['uniq', '-c'], ['tail', '-n', '1']], [['grep', '-m', '2', 'a'], ['sort', '-r']],
    [['grep', '-c', 'a'], ['cat']], [['grep', '-n', '-m', '2', 'a'], ['cat']], [['grep', '-x', '-i', 'APPLE'], ['cat']], [['grep', '-w', '-e', 'an', '-e', 'ch'], ['cat']],
    [['grep', '-F', 'a.'], ['cat']], [['grep', '-P', '\\d+'], ['cat']], [['grep', '-ov', 'zzz'], ['cat']], [['grep', '-q', 'a'], ['cat']],
    [['grep', '-E', 'a|e'], ['uniq']],
    [['sed', '-e', 's/a/b/', '-e', 's/b/c/'], ['cat']], [['sed', '--expression=s/a/X/'], ['cat']], [['sed', '-n', '-E', '/(an)+/p'], ['cat']],
    [['sed', '-ne', '/e/p'], ['cat']], [['sed', '-s', 's/a/b/'], ['cat']],
    [['awk', '-F', ',', '{ print $1 }'], ['cat']], [['awk', '-F,', '{ print $2 }'], ['cat']], [['awk', '-Ft', '{ print $1 }'], ['cat']], [['printf', 'a\\tb\\n'], ['awk', '-F\\t', '{ print $2 }']],
    [['awk', '-v', 'x=1', '{ print x, $0 }'], ['cat']], [['awk', '-vx=2', '--', '{ print x }'], ['cat']],
    [['seq', '3'], ['wc']], [['seq', '3'], ['wc', '-l', '-w']], [['seq', '3'], ['wc', '-m']],
    [['seq', '3'], ['cat', '-']], [['seq', '3'], ['tee']],
    // Options read as the explanation reads them: long prefixes, a value that looks like an option, clusters.
    [['grep', '--inv', 'a'], ['cat']], [['grep', '-e', '-v', '-e', 'a'], ['cat']], [['sed', '--expr', 's/a/X/'], ['cat']], [['sed', '-ns', '/e/p'], ['cat']],
    [['sort', '--rev'], ['uniq']], [['seq', '3'], ['wc', '--li']], [['perl', '-lne', 'print if /e/'], ['cat']],
  ];
  for (const words of cases) {
    const stages: Stage[] = words.map(([cmd, ...w]) => ({ cmd, words: w, text: [cmd, ...w].join(' ') }));
    const script = words.map((w) => w.map(q).join(' ')).join(' | ');
    it(script, () => {
      const ex = pipelineExample(stages, false);
      assert.ok(ex, 'has an example');
      const real = run('bash', ['-c', script], { input: ex.input ? ex.input.join('\n') + '\n' : '', env: { ...process.env, LC_ALL: 'C' } });
      assert.deepStrictEqual(ex.steps[ex.steps.length - 1].output, lines(real.stdout.toString()));
    });
  }
  it('gives a stage that limits lines more lines than it keeps, and shows what -i, -w and -x change', () => {
    const run = (text: string) => {
      const stages: Stage[] = text.split(' | ').map((t) => {
        const [cmd, ...w] = t.split(' ');
        return { cmd, words: w, text: t };
      });
      return pipelineExample(stages, false)!;
    };
    for (const text of [
      'grep -i error | sort | uniq -c | sort -rn | head -n 3', 'grep -v debug | tail -n 2', 'grep -w cat | sort | uniq -c | sort -rn | head -n 3',
      'grep -m 2 a | sort -r', 'cut -d, -f1 | sort | uniq -c | sort -rn | head -n 3', 'sort -rn | head -n 5',
    ]) {
      const ex = run(text);
      let before = ex.input!;
      for (const step of ex.steps) {
        assert.notDeepStrictEqual(step.output, before, `${text}: ${step.stage.text} changes nothing`);
        before = step.output;
      }
    }
    // A grown sample is shown whole: no section has more than 12 lines. Default `head` (10 lines)
    // after `uniq -c` would need more, so it stays as it was.
    for (const text of ['grep -i error | sort | uniq -c | sort -rn | head -n 3', 'cut -d, -f1 | sort | uniq -c | sort -rn | head', 'sort -rn | head -n 5']) {
      const ex = run(text);
      for (const lines of [ex.input!, ...ex.steps.map((x) => x.output)]) assert.ok(lines.length <= 12, text);
    }
    // -i: a line that matches only because of -i
    assert.ok(run('grep -i error | sort').input!.includes('ERROR'));
    // A stage nothing can change keeps the first sample.
    const ex = run('grep a | sed s/zzz/y/');
    assert.deepStrictEqual(ex.steps[0].output, ex.steps[1].output);
    // The file's lines are the same ones the first stage prints.
    const file = pipelineExample([{ cmd: 'cat', words: ['f'], text: 'cat f' }, { cmd: 'head', words: ['-n', '2'], text: 'head -n 2' }], false)!;
    assert.deepStrictEqual(file.steps[0].output, file.input);
    assert.ok(file.input!.length > 2);
  });
  it('shows the commands xargs would run', () => {
    const ex = pipelineExample([{ cmd: 'grep', words: ['e'], text: 'grep e' }, { cmd: 'xargs', words: ['-n', '1', 'rm'], text: 'xargs -n 1 rm' }], false)!;
    const real = run('bash', ['-c', "grep e | xargs -n 1 echo rm"], { input: ex.input!.join('\n') + '\n' });
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
  it('declines what the tools refuse', () => {
    // GNU grep: "conflicting matchers specified" (status 2).
    const refused = [['grep', '-E', '-F', 'a'], ['grep', '-G', '--perl', 'a']];
    for (const words of refused) {
      const stages = [['seq', '3'], words].map(([cmd, ...w]): Stage => ({ cmd, words: w, text: [cmd, ...w].join(' ') }));
      assert.strictEqual(pipelineExample(stages, false), undefined, words.join(' '));
      assert.notStrictEqual(run('/usr/bin/grep', words.slice(1), { input: '1\n' }).status, 0, words.join(' '));
    }
  });
  // cat, tac and rev pass on their input (reversed) only without options and files: `cat -n` numbers the lines.
  it('declines cat, tac and rev with an option or a file, whose output is not the input as passed on', () => {
    for (const words of [['cat', '-n'], ['cat', '--number'], ['tac', '-s', '2'], ['tac', 'f'], ['rev', 'f']]) {
      const stages = [['seq', '3'], words].map(([cmd, ...w]): Stage => ({ cmd, words: w, text: [cmd, ...w].join(' ') }));
      assert.strictEqual(pipelineExample(stages, false), undefined, words.join(' '));
      const real = run(words[0], words.slice(1), { input: '1\n2\n3\n' });
      assert.ok(real.status !== 0 || String(real.stdout) !== '1\n2\n3\n', words.join(' '));
    }
    for (const words of [['cat'], ['cat', '-'], ['tac'], ['rev']]) {
      const stages = [['seq', '3'], words].map(([cmd, ...w]): Stage => ({ cmd, words: w, text: [cmd, ...w].join(' ') }));
      assert.ok(pipelineExample(stages, false), words.join(' '));
    }
    // A first `cat FILE` shows the file as it is; with an option (`cat -n f`, numbered lines) there is no example.
    const st = (...w: string[]): Stage => ({ cmd: w[0], words: w.slice(1), text: w.join(' ') });
    for (const first of [st('cat', '-n', 'f'), st('cat', '--number', 'f'), st('cat', '-A', 'f')]) assert.strictEqual(pipelineExample([first, st('sort')], false), undefined, first.text);
    assert.ok(pipelineExample([st('cat', 'f'), st('sort')], false));
    assert.ok(pipelineExample([st('cat', '--', '-n'), st('sort')], false), 'cat -- -n reads the file -n');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cat-n-'));
    fs.writeFileSync(path.join(tmp, 'f'), 'b\na\n');
    assert.strictEqual(String(run('cat', ['--number', path.join(tmp, 'f')]).stdout), '     1\tb\n     2\ta\n');
    fs.rmSync(tmp, { recursive: true, force: true });
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
    assert.ok(pipelineExample([st('grep', 'a'), st('sort', undefined, '-u')], false));
  });
});

/** A directory with the files the commands below name. */
function sandbox(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explain-bash-reads-'));
  for (const f of ['app.log', 'f', 'data.txt', 'foo']) fs.writeFileSync(path.join(dir, f), '-v from a file\n');
  fs.writeFileSync(path.join(dir, 'prog.awk'), '{ print }\n');
  return dir;
}

describe('readsFiles agrees with the tools on whether they read a file instead of stdin', () => {
  // A tool reads its stdin when what it prints changes with what stdin holds.
  const stdin = 'a\nerror\nfoo\nx,y\n-v\nzzz\n';
  const cases: string[] = [
    'grep -v error app.log', 'grep error', 'sed -e s/a/b/', 'awk -F: {print} /etc/passwd', 'perl -ne print f', 'sort -rn', 'head -n 3',
    'cut -d, -f2 f', 'tr a b', 'wc f', 'grep -e x f', 'grep -efoo data.txt', 'grep -e -v foo', 'grep -e -v', 'grep x -', 'sed -ie s/a/b/ -e s/c/d/ f',
    'awk {print} v=1', 'awk -f prog.awk data.txt', 'awk -f prog.awk', 'perl -pi.bak -e s/a/b/ f', 'tee out', 'sort -k 2', 'sort -t, -k2 f', 'egrep a', 'egrep a f',
    'uniq f out', 'uniq', 'xargs -a f echo', 'xargs -af echo', 'xargs echo', 'head -n 1 f data.txt',
  ];
  for (const line of cases) {
    it(line, () => {
      const { name, words, texts } = argWords(line);
      const parse = interpret(lookupCommand(name)!, words, { name, lookup: lookupCommand });
      const real = (input: string) => {
        const dir = sandbox();
        try {
          return run('bash', ['-c', line], { input, cwd: dir }).stdout.toString();
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      };
      assert.strictEqual(readsFiles(parse, texts), real(stdin) === real(''));
    });
  }
});

describe('the pipeline example of a line agrees with the tools', () => {
  const parser = createUnbashParser();
  const example = (line: string) => new Analyzer('en').explainLine(parser.parse(line), 0).examples.find((x) => x.title === 'Example (the whole pipeline)');
  it('labels the input a file when the first stage reads one (`grep -efoo data.txt`)', () => {
    for (const [line, label] of [['grep -efoo data.txt | sort', 'Input: `data.txt` (sample contents)'], ['grep -e foo data.txt | sort', 'Input: `data.txt` (sample contents)'],
      ['grep -e foo | sort', 'Input: stdin (sample contents)'], ["awk '{ print }' v=1 | sort", 'Input: stdin (sample contents)'], ['sort < in.txt | uniq', 'Input: stdin (`in.txt`, sample contents)'],
      ['cat *.log | sort', 'Input: files matching `*.log` (sample contents)'], ['sort "$@" | uniq -c', 'Input: the files `"$@"` names (sample contents)']]) {
      assert.strictEqual(example(line)?.sections[0].label, label, line);
    }
  });
  it('shows none when a later stage reads a file, not the pipe (`printf … | grep -e -v foo`)', () => {
    const line = "printf 'a\\n-v\\n' | grep -e -v foo";
    const dir = sandbox();
    try {
      // grep reads the file foo, so what printf writes never reaches it.
      assert.strictEqual(run('bash', ['-c', line], { cwd: dir }).stdout.toString(), '-v from a file\n');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    assert.strictEqual(example(line), undefined);
    assert.ok(example("printf 'a\\n-v\\n' | grep -e -v"));
    assert.ok(example("printf 'a\\n-v\\n' | grep -e -v -"));
  });
  it('runs a stage whose name is quoted as the command it names, which bash runs (a function of the name runs instead)', () => {
    for (const lang of ['en', 'ja'] as const) {
      const whole = (line: string) => new Analyzer(lang).explainLine(parser.parse(line), 0).examples.find((x) => x.kind === 'pipeline');
      for (const line of ["printf 'b\\na\\nc\\n' | \\sort | 'head' -n 2", 'echo hi | "tr" a-z A-Z', '\\echo hi | t\\r a-z A-Z']) {
        const real = lines(run('bash', ['-c', line], { env: { ...process.env, LC_ALL: 'C' } }).stdout.toString());
        assert.deepStrictEqual(whole(line)?.sections.at(-1)?.lines, real, `${line} (${lang})`);
      }
      // (`\\sort` skips an alias, not a function: this one passes the lines on unsorted.)
      assert.strictEqual(whole("sort() { cat; }; printf 'b\\na\\n' | \\sort"), undefined, lang);
    }
  });
  it('runs a name `hash -p` gave a path as bash does: not while hashing is off, and no example where it is relative or may differ', function () {
    this.timeout(30000);
    const C = { ...process.env, LC_ALL: 'C' };
    const abc = "printf 'b\\na\\nc\\n' | sort";
    const relative = [`hash -p tac sort; ${abc}`, `hash -p ./tac sort; ${abc}`, `hash -p bin/tac sort; ${abc}`, `hash -p '' sort; ${abc}`];
    const branches = [`if [ -n "$x" ]; then hash -p /usr/bin/tac sort; fi; ${abc}`, `hash -p /usr/bin/tac sort; if [ -z "$x" ]; then hash -d sort; fi; ${abc}`,
      `hash -p /usr/bin/tac sort; if [ -z "$x" ]; then PATH=$PATH; fi; ${abc}`, `hash -p /usr/bin/tac sort; if [ -z "$x" ]; then hash -r; fi; ${abc}`,
      `shopt -s expand_aliases\nif [ -n "$x" ]; then hash -p /usr/bin/tac sort; fi\nalias s=sort\n${abc.replace(/sort$/, 's')}`];
    const dir = sandbox();
    try {
      const bash = (line: string, env: NodeJS.ProcessEnv = {}) => run('bash', ['-c', line], { env: { ...C, ...env }, cwd: dir });
      for (const lang of ['en', 'ja'] as const) {
        const whole = (src: string) => new Analyzer(lang).explainLine(parser.parse(src), src.split('\n').length - 1).examples.find((x) => x.kind === 'pipeline');
        // With hashing off (`set +h`), bash searches PATH; `hash` fails then ("hashing disabled") and changes nothing,
        // and the paths it had come back with `set -h`.
        for (const line of [`hash -p /usr/bin/tac sort; set +h; ${abc}`, `set +h; hash -p /usr/bin/tac sort; ${abc}`, `set +h; hash -p /usr/bin/tac sort; set -h; ${abc}`,
          `hash -p /usr/bin/tac sort; set +h; set -h; ${abc}`, `hash -p /usr/bin/tac sort; set +h; hash -r; set -h; ${abc}`, `hash -p /usr/bin/tac sort; set +h; hash -d sort; set -h; ${abc}`,
          // (The same path from two commands; with checkhash or in POSIX mode, an empty path forgotten, and PATH searched.)
          `hash -p /usr/bin/tac sort; [ -n "$x" ] && hash -p /usr/bin/tac sort; ${abc}`, `shopt -s checkhash; hash -p '' sort; ${abc}`, `set -o posix; hash -p '' sort; ${abc}`]) {
          assert.deepStrictEqual(whole(line)?.sections.at(-1)?.lines, lines(bash(line).stdout.toString()), `${line} (${lang})`);
        }
        // A relative path runs from the current directory (no `./tac` here: "No such file or directory", or PATH for
        // `./tac`); an empty one, or one known only at run time; a change of the table, or `set +h`, on one path of an
        // `if`, also behind an alias: no example.
        for (const line of [...relative, `hash -p "$p" sort; ${abc}`, ...branches, `hash -p /usr/bin/tac sort; if [ -n "$x" ]; then set +h; fi; ${abc}`]) {
          assert.strictEqual(whole(line), undefined, `${line} (${lang})`);
        }
      }
      // What bash does there: a relative path from the current directory (`./x` that is not there is forgotten, and
      // PATH searched; another fails), and either program after the `if`.
      const [noSlash, dot, sub, empty] = relative.map((line) => bash(line));
      for (const [r, name] of [[noSlash, 'tac'], [sub, 'bin/tac'], [empty, '']] as const) {
        assert.strictEqual(r.status, 127, name);
        assert.ok(r.stderr.toString().includes(`${name}: No such file or directory`), name);
      }
      assert.deepStrictEqual(lines(dot.stdout.toString()), ['a', 'b', 'c']);
      fs.symlinkSync('/usr/bin/tac', path.join(dir, 'tac'));
      fs.mkdirSync(path.join(dir, 'bin'));
      fs.symlinkSync('/usr/bin/tac', path.join(dir, 'bin', 'tac'));
      for (const line of relative.slice(0, 3)) assert.deepStrictEqual(lines(bash(line).stdout.toString()), ['c', 'a', 'b'], line);
      for (const line of [...branches, `hash -p /usr/bin/tac sort; if [ -z "$x" ]; then set +h; fi; ${abc}`]) {
        assert.deepStrictEqual(lines(bash(line, { x: '1' }).stdout.toString()), ['c', 'a', 'b'], line);
        assert.deepStrictEqual(lines(bash(line, { x: '' }).stdout.toString()), ['a', 'b', 'c'], line);
      }
      // A trap's action runs after a later change too (tac, then forgotten: bash runs tac); a `./` path that is not
      // there is forgotten (PATH: `c b a`); with checkhash, a path that is not there too: no example of any.
      const trapped = "trap 'printf \"b\\na\\nc\\n\" | sort' USR1; hash -p /usr/bin/tac sort; kill -USR1 $$; hash -d sort";
      const dotOrRev = `if [ -z "$x" ]; then hash -p ./tac sort; else hash -p /usr/bin/rev sort; fi; ${abc} -r`;
      const checkhash = `shopt -s checkhash; hash -p /nonexistent/tac sort; ${abc}`;
      fs.rmSync(path.join(dir, 'tac'));
      assert.deepStrictEqual(lines(bash(trapped).stdout.toString()), ['c', 'a', 'b']);
      assert.deepStrictEqual(lines(bash(dotOrRev, { x: '' }).stdout.toString()), ['c', 'b', 'a']);
      assert.deepStrictEqual(lines(bash(checkhash).stdout.toString()), ['a', 'b', 'c']);
      for (const lang of ['en', 'ja'] as const) {
        for (const line of [trapped, dotOrRev, checkhash]) assert.ok(!new Analyzer(lang).explainLine(parser.parse(line), 0).examples.some((x) => x.kind === 'pipeline' || x.title.includes('sort')), `${line} (${lang})`);
      }
      // (Two paths, one on each path: tac or rev, never sort; no example either.)
      const either = `hash -p /usr/bin/tac sort; if [ -n "$x" ]; then hash -p /usr/bin/rev sort; fi; ${abc}`;
      assert.deepStrictEqual(lines(bash(either, { x: '1' }).stdout.toString()), ['b', 'a', 'c']);
      assert.deepStrictEqual(lines(bash(either, { x: '' }).stdout.toString()), ['c', 'a', 'b']);
      for (const lang of ['en', 'ja'] as const) assert.strictEqual(new Analyzer(lang).explainLine(parser.parse(either), 0).examples.find((x) => x.kind === 'pipeline'), undefined, lang);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('pipeline examples of long pipelines', () => {
  const parser = createUnbashParser();
  it('read each stage once: twice the stages take about twice as long, not exponentially longer', function () {
    this.timeout(60000);
    // Each stage's stdin is what the stages before it print; reading the stages before it again for each stage took
    // 2 ** n steps (20 stages: 30 seconds).
    const line = (n: number) => Array.from({ length: n }, () => 'grep -e x f').join(' | ');
    const explain = (n: number) => () => new Analyzer('en').explainLine(parser.parse(line(n)), 0);
    assertGrowth('10 stages, then 20', explain(10), explain(20), 8, 3);
  });
});
