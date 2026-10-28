// What the examples make up of a command's output (src/examples/layouts.ts), checked against the real tools: the
// layout of each against what procps-ng and GNU coreutils print, and the pipelines that start with one, stage by
// stage: what each stage shows is what the real stage prints from the section before it.
import * as assert from 'assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Example } from '../src/analyzer';
import type { Layout } from '../src/argv/spec';
import { layoutSample } from '../src/examples/layouts';
import { explain } from './support/explain';
import { run } from './support/run';

const C = { ...process.env, LC_ALL: 'C', TZ: 'UTC' };
const words = (line: string) => line.trim().split(/\s+/);
const lines = (out: Buffer) => out.toString().replace(/\n$/, '').split('\n').filter((l, i, a) => !(a.length === 1 && l === ''));
const real = (cmd: string, args: string[], opts: { cwd?: string } = {}) => lines(run(cmd, args, { ...opts, env: C, check: true }).stdout);

/** A made-up output, as the first stage `argv` of a pipeline of one stage prints it. */
const sample = (kind: Layout, argv: string[]) => layoutSample(kind, [argv], 0);

describe('made-up output has the layout of the real tools', () => {
  // A row of `ps aux`, `ps -ef` and `ps`, by the kinds of its fields (START and STIME are a date after a day).
  const ROW: Record<string, RegExp> = {
    aux: /^\S+ +\d+ +\d+(\.\d)? +\d+(\.\d)? +\d+ +\d+ +\S+ +[DIRSTtWXZ][<NLsl+]* +\S+ +\d+:\d\d .+$/,
    '-ef': /^\S+ +\d+ +\d+ +\d+ +\S+ +\S+ +\d\d:\d\d:\d\d .+$/,
    '': /^ *\d+ \S+ +\d\d:\d\d:\d\d .+$/,
  };
  const KIND: Record<string, Layout> = { aux: 'ps-bsd-u', '-ef': 'ps-full', '': 'ps' };
  for (const args of ['aux', '-ef', '']) {
    it(`ps ${args}: the header, and rows of the fields ps prints, the PID under its title`, () => {
      const argv = args ? [args] : [];
      const ours = sample(KIND[args], ['ps', ...argv]);
      const theirs = real('ps', argv);
      assert.deepStrictEqual(words(ours[0]), words(theirs[0]));
      for (const row of theirs.slice(1)) assert.match(row, ROW[args], `the pattern fits real rows: ${row}`);
      for (const row of ours.slice(1)) assert.match(row, ROW[args]);
      // (procps sets the PID column right-aligned under its title; a user name of more than 8 letters pushes it.)
      const end = ours[0].indexOf('PID') + 3;
      for (const row of ours.slice(1)) assert.ok(/\d/.test(row[end - 1]) && row[end] === ' ', row);
      // The command running ps is one of its rows.
      assert.ok(ours.some((r) => / ps( aux| -ef)?$/.test(r)));
    });
  }

  it('ls: a directory made as the sample says lists so (`-l`, `-lh`, `-la`, and the names alone)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explain-bash-prints-'));
    try {
      const listing = sample('ls-long-all', ['ls', '-la']).slice(1);
      for (const row of listing) {
        const [mode, , , , size, , , , name] = words(row);
        if (name === '.' || name === '..') continue;
        const file = path.join(dir, name);
        if (mode.startsWith('d')) fs.mkdirSync(file);
        else fs.writeFileSync(file, 'x'.repeat(Number(size)));
        fs.chmodSync(file, parseInt([1, 4, 7].map((i) => [0, 1, 2].reduce((n, k) => n * 2 + (mode[i + k] === '-' ? 0 : 1), 0)).join(''), 8));
      }
      // (`src` holds a directory: three links.)
      fs.mkdirSync(path.join(dir, 'src', 'lib'));
      for (const row of listing) {
        const [, , , , , mon, day, time, name] = words(row);
        if (name === '..') continue;
        assert.strictEqual(spawnSync('touch', ['-d', `${mon} ${day} 2026 ${time}`, path.join(dir, name)], { env: C }).status, 0);
      }
      const style = '--time-style=+%b %e %H:%M';
      // (Dates of more than six months ago would show the year: the style keeps the layout of recent ones.)
      const fields = (row: string, dirSize: boolean) => {
        const w = words(row);
        // The owner and the group are the user's; a directory's size is the file system's.
        return [w[0], w[1], ...(w[0].startsWith('d') && !dirSize ? [] : [w[4]]), ...w.slice(5)];
      };
      for (const [kind, args] of [['ls-long', ['-l']], ['ls-long-human', ['-lh']]] as [Layout, string[]][]) {
        const ours = sample(kind, ['ls', ...args]);
        const theirs = real('ls', [...args, style], { cwd: dir });
        assert.match(theirs[0], /^total \d+K?$/);
        assert.match(ours[0], /^total \d+K?$/);
        assert.deepStrictEqual(ours.slice(1).map((r) => fields(r, false)), theirs.slice(1).map((r) => fields(r, false)), kind);
      }
      const all = real('ls', ['-la', style], { cwd: dir });
      assert.deepStrictEqual(sample('ls-long-all', ['ls', '-la']).slice(1).map((r) => words(r).pop()), all.slice(1).map((r) => words(r).pop()));
      assert.deepStrictEqual(sample('ls', ['ls']), real('ls', [], { cwd: dir }));
      // In a pipe, ls prints one name a line, as `-1` does.
      assert.deepStrictEqual(sample('ls', ['ls']), real('ls', ['-1'], { cwd: dir }));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('df -h: the header, and the use rounded up as df does', () => {
    const ours = sample('df-human', ['df', '-h']);
    assert.deepStrictEqual(words(ours[0]), words(real('df', ['-h'])[0]));
    const bytes = (s: string) => Number(s.replace(/[KMG]$/, '')) * { K: 1, M: 1024, G: 1024 ** 2 }[s.slice(-1) as 'K' | 'M' | 'G'] || 0;
    for (const row of ours.slice(1)) {
      const [, , used, avail, use] = words(row);
      const want = Math.ceil((100 * bytes(used)) / (bytes(used) + bytes(avail)));
      assert.ok(Math.abs(Number(use.slice(0, -1)) - want) <= 1, row);
    }
  });

  it('who: rows of the layout who prints', () => {
    const ROW_WHO = /^\S+ +\S+ +\d{4}-\d\d-\d\d \d\d:\d\d( \(.+\))?$/;
    for (const row of sample('who', ['who'])) assert.match(row, ROW_WHO);
    // (A machine with nobody logged in, as CI, prints nothing.)
    // (In the C locale, who writes the date as `Oct 22 12:58`; in others, as ISO 8601.)
    for (const row of lines(run('who', [], { env: { ...C, LC_ALL: 'C.UTF-8' }, check: true }).stdout)) assert.match(row, ROW_WHO);
  });

  it('env and printenv: `NAME=value` lines, with `_` set to the path bash ran the command by', () => {
    for (const cmd of ['env', 'printenv']) {
      const ours = sample('env', [cmd]);
      for (const row of ours) assert.match(row, /^[A-Z_]+=\S*$/);
      const where = lines(spawnSync('bash', ['-c', `command -v ${cmd}`]).stdout)[0];
      assert.ok(lines(spawnSync('bash', ['-c', cmd]).stdout).includes(`_=${where}`), cmd);
      assert.strictEqual(ours[ours.length - 1], `_=/usr/bin/${cmd}`);
    }
  });
});

/** The text of the stage a section of a whole-pipeline example is after (`After \`sort\``, `Output (after \`wc -l\`)`). */
const stageOf = (label: string) => /after `(.+)`\)?$/i.exec(label)?.[1];

const pipelineExampleOf = (line: string, lang: 'en' | 'ja' = 'en'): Example | undefined => explain(line, 0, lang).examples.find((e) => e.kind === 'pipeline');

describe('pipelines that start with a made-up output agree with the real tools stage by stage', () => {
  const cases = [
    "ps aux | awk '{print $2}'",
    "ps aux | grep nginx | awk '{print $2}'",
    'ps aux | sort -k3 -rn | head -n 3',
    'ps -ef | grep python',
    'ps | wc -l',
    "ls -l | grep '^d' | wc -l",
    'ls -lh | sort -k5 -h',
    "ls -la | awk '{print $9}'",
    "ls -l | awk '{ s += $5 } END { print s }'",
    'ls | wc -l',
    "df -h | awk '{print $5}'",
    "df -h | grep '^/dev' | sort -k5 -rn",
    'env | grep PATH',
    'env | cut -d= -f1 | sort',
    "who | cut -d' ' -f1 | sort -u",
    'who | wc -l',
  ];
  for (const line of cases) {
    it(line, () => {
      const ex = pipelineExampleOf(line);
      assert.ok(ex, 'has an example of the whole pipeline');
      const [first, ...steps] = ex.sections;
      assert.strictEqual(first.label, `Output of \`${line.split(' | ')[0]}\` (sample)`);
      // (Shown as they are, not in a box to edit, which would wrap the rows of a table.)
      assert.strictEqual(ex.interactive, undefined);
      let before = first.lines;
      for (const step of steps) {
        const stage = stageOf(step.label);
        assert.ok(stage, step.label);
        assert.ok(!before.includes('…') && !step.lines.includes('…'), 'shown whole');
        const theirs = lines(run('bash', ['-c', stage], { input: before.map((l) => l + '\n').join(''), env: C }).stdout);
        assert.deepStrictEqual(step.lines, theirs, stage);
        before = step.lines;
      }
    });
  }
  it('lists the commands of the pipeline among the processes, as ps sees them run with it', () => {
    const ex = pipelineExampleOf("ps aux | grep -v grep | awk '{print $2}'")!;
    assert.deepStrictEqual(ex.sections[0].lines.slice(-3).map((r) => r.replace(/^.* 0:00 /, '')), ['ps aux', 'grep -v grep', 'awk {print $2}']);
    // (A stage whose words are not known, or that is not a program, has no row: a builtin runs in a copy of the shell.)
    assert.deepStrictEqual(layoutSample('ps-bsd-u', [['ps', 'aux'], undefined], 0).length, layoutSample('ps-bsd-u', [['ps', 'aux']], 0).length);
    const sh = explain("ps aux | grep -v grep | awk '{print $2}' | while read -r p; do echo \"$p\"; done").examples.find((e) => e.kind === 'awk');
    assert.ok(sh && !sh.sections[0].lines.some((r) => /while|read/.test(r)), 'no row for the loop');
    // (Nor one whose words are not all known: `tee "$log"`.)
    const tee = explain('ps aux | tee "$log" | wc -l').examples.find((e) => e.kind === 'pipeline')!;
    assert.ok(!tee.sections[0].lines.some((r) => / tee/.test(r)) && tee.sections[0].lines.some((r) => / wc -l$/.test(r)));
  });
  it('makes up no output for other options or operands, and says that the input is not known', () => {
    for (const line of ['ps aux --sort=-%mem | head', 'ls -l /etc | wc -l', 'ls -lt | head -n 3', 'df | wc -l', 'ls -l --nope | wc -l', 'ls -lj | wc -l', 'ls -lZ | wc -l', 'mytool | wc -l']) {
      const ex = explain(line).examples;
      assert.ok(!ex.some((e) => e.kind === 'pipeline' && /^Output of/.test(e.sections[0].label)), line);
    }
    const head = explain('ps aux --sort=-%mem | head').examples.find((e) => e.sections[0].label.startsWith('Input'));
    assert.strictEqual(head?.sections[0].label, 'Input: stdin (output of `ps aux --sort=-%mem`, not known here: made-up lines)');
  });
  it('makes up no environment when env runs a command (it prints what the command prints), or for `env -`', () => {
    // (`env find . -exec echo \;` once threw: env's layout was taken, and its words are not all known for the `_` line.)
    for (const line of ['env find . -exec echo \\; | cat', 'env find "$x" | cat', 'env grep x "$f" | wc -l', 'env sort | cat', 'env find . -name x | cat', 'env - | cat', 'env -- printenv | cat']) {
      for (const lang of ['en', 'ja'] as const) {
        const ex = explain(line, 0, lang).examples;
        assert.ok(!ex.some((e) => e.sections.some((s) => s.lines.some((l) => l.startsWith('_=')))), `${line} (${lang})`);
      }
    }
    // (As with another wrapper: grep's example of its own; `env --` alone prints the environment.)
    assert.deepStrictEqual(explain('env grep x "$f" | wc -l').examples.map((e) => e.kind), explain('nice grep x "$f" | wc -l').examples.map((e) => e.kind));
    assert.strictEqual(pipelineExampleOf('env -- | grep PATH')?.sections[0].label, 'Output of `env --` (sample)');
  });
  it('gives a command after it, whose example is its own, the made-up lines as its input', () => {
    // (`paste` is not followed: the stages' examples are shown, and awk's reads what `ls -l` prints.)
    const awk = explain("ls -l | awk '{print $5}' | paste -sd+").examples.find((e) => e.kind === 'awk')!;
    assert.strictEqual(awk.sections[0].label, 'Input: stdin (sample output of `ls -l`)');
    assert.deepStrictEqual(awk.sections[0].lines, sample('ls-long', ['ls', '-l']));
    const theirs = lines(run('awk', ['{print $5}'], { input: awk.sections[0].lines.map((l) => l + '\n').join(''), env: C }).stdout);
    assert.deepStrictEqual(awk.sections[1].lines, theirs);
    // What `<(ps aux)` gives is not made up.
    assert.ok(!explain("awk '{print $2}' <(ps aux)").examples.some((e) => e.sections.some((s) => s.lines.includes(sample('ps-bsd-u', ['ps', 'aux'])[0]))));
  });
  it('names the command a pipe brings the input from, and the file only when `cat` passes on one file as it is', () => {
    const jq = (line: string) => explain(line).examples.find((e) => e.kind === 'jq')?.sections[0].label;
    const unknown = (by: string) => `Input: stdin (output of \`${by}\`, not known here: made-up lines)`;
    for (const [line, by] of [
      ['ls -l | grep x f | jq .', 'grep x f'], ['ps aux | paste -sd, | jq .', 'paste -sd,'], ['cat *.json | jq .', 'cat *.json'], ['cat <(echo) | jq .', 'cat <(echo)'],
      ['cat < <(echo) | jq .', 'cat'], ['cat - | jq .', 'cat -'], ['sort a.json | jq .', 'sort a.json'], ['cat a.json | grep x | jq .', 'grep x'],
    ]) assert.strictEqual(jq(line), unknown(by), line);
    assert.strictEqual(jq('cat a.json | jq .'), 'Input: stdin (`a.json` through `cat`, sample contents)');
    assert.strictEqual(jq('ps -ef | grep python | jq .'), 'Input: stdin (sample output of `grep python`)');
  });
  it('in Japanese', () => {
    assert.strictEqual(pipelineExampleOf("ps aux | awk '{print $2}'", 'ja')?.sections[0].label, '`ps aux` の出力（例）');
    const label = (line: string, kind: string) => explain(line, 0, 'ja').examples.find((e) => e.kind === kind)?.sections[0].label;
    assert.strictEqual(label("ls -l | awk '{print $5}' | paste -sd+", 'awk'), '入力: 標準入力（`ls -l` の出力の例）');
    assert.strictEqual(label('cat a.json | jq .', 'jq'), '入力: 標準入力（`cat` が渡す `a.json`、中身の例）');
    assert.strictEqual(label('curl -s u | jq .', 'jq'), '入力: 標準入力（`curl -s u` の出力。中身は分からないので仮の行）');
    assert.strictEqual(label("echo '{\"a\":1}' | jq .a", 'jq'), '入力: 標準入力（`echo \'{"a":1}\'` の出力）');
  });
});
