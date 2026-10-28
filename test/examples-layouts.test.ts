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
import { commands } from '../src/dict/commands';
import { ENVIRONMENT, layoutSample } from '../src/examples/layouts';
import { explain } from './support/explain';
import { run } from './support/run';

const C = { ...process.env, LC_ALL: 'C', TZ: 'UTC' };
const words = (line: string) => line.trim().split(/\s+/);
const lines = (out: Buffer) => out.toString().replace(/\n$/, '').split('\n').filter((l, i, a) => !(a.length === 1 && l === ''));
const real = (cmd: string, args: string[], opts: { cwd?: string } = {}) => lines(run(cmd, args, { ...opts, env: C, check: true }).stdout);

/** A made-up output, as the first stage `argv` of a pipeline of one stage prints it. */
const sample = (kind: Layout, argv: string[]) => layoutSample(kind, [{ argv }], 0);

/**
 * A directory made as the sample of `ls -la` says (its names, modes, sizes and dates), in a temporary directory of its
 * own (`..` would otherwise be the shared one, which changes as other tests make files there); remove it with `removeDirectory`.
 */
function madeUpDirectory(): string {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'explain-bash-prints-')), 'home');
  fs.mkdirSync(dir);
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
  return dir;
}

/** Removes a directory `madeUpDirectory` made, with the one that holds it. */
const removeDirectory = (dir: string) => fs.rmSync(path.dirname(dir), { recursive: true, force: true });

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
    const dir = madeUpDirectory();
    try {
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
      removeDirectory(dir);
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
    assert.deepStrictEqual(layoutSample('ps-bsd-u', [{ argv: ['ps', 'aux'] }, undefined], 0).length, layoutSample('ps-bsd-u', [{ argv: ['ps', 'aux'] }], 0).length);
    const sh = explain("ps aux | grep -v grep | awk '{print $2}' | while read -r p; do echo \"$p\"; done").examples.find((e) => e.kind === 'awk');
    assert.ok(sh && !sh.sections[0].lines.some((r) => /while|read/.test(r)), 'no row for the loop');
    // (Nor one whose words are not all known: `tee "$log"`.)
    const tee = explain('ps aux | tee "$log" | wc -l').examples.find((e) => e.kind === 'pipeline')!;
    assert.ok(!tee.sections[0].lines.some((r) => / tee/.test(r)) && tee.sections[0].lines.some((r) => / wc -l$/.test(r)));
    // (Its words after quote removal, as the program gets them; one with a control character, which ps shows escaped, has no row.)
    const row = (line: string) => explain(line).examples.find((e) => e.kind === 'textFilters')!.sections[0].lines.slice(-2).map((r) => r.replace(/^.* 0:00 /, ''));
    assert.deepStrictEqual(row('ps aux | head -n 20 | cut -d \\: -f1'), ['head -n 20', 'cut -d : -f1']);
    assert.deepStrictEqual(row("ps aux | head -n 20 | cut -d $'\\t' -f1"), ['ps aux', 'head -n 20']);
  });
  /** What the real ps shows of the command line of `cmd`, run by bash in the background (`locale`: of both). */
  const realArgs = (cmd: string, locale = 'C') => lines(run('bash', ['-c', `${cmd} & sleep 0.2; ps -o args= -p $!; wait`], { env: { ...C, LC_ALL: locale }, check: true }).stdout)[0];
  it('shows a stage by its words after quote removal, its name too, as ps shows them', function () {
    this.timeout(30000);
    for (const lang of ['en', 'ja'] as const) {
      const rows = (line: string) => pipelineExampleOf(line, lang)!.sections[0].lines.slice(-2).map((r) => r.replace(/^.* 0:00 /, ''));
      for (const head of ['\\head', "'head'", 'h\\ead', '"head"']) {
        const line = `ps aux | ${head} -n 20 | cut -d : -f1`;
        assert.deepStrictEqual(rows(line), ['head -n 20', 'cut -d : -f1'], `${line} (${lang})`);
        // (head waits on its input.)
        if (lang === 'en') assert.strictEqual(realArgs(`${head} -n 20 < <(sleep 0.5)`), 'head -n 20', head);
      }
      // (`ps` alone shows the name of the program, `comm`.)
      assert.deepStrictEqual(pipelineExampleOf('ps | \\head -n 20', lang)!.sections[0].lines.at(-1)!.replace(/^.* /, ''), 'head');
    }
  });
  it('makes up no row for a word with a character ps shows escaped (C1 controls too)', function () {
    this.timeout(30000);
    // (procps shows each byte of U+0085 as `?`, and one `?` for U+2028.)
    assert.strictEqual(realArgs("bash -c 'sleep 0.5; :' x $'\\u0085' $'\\u2028'", 'C.UTF-8'), 'bash -c sleep 0.5; : x ?? ?');
    for (const lang of ['en', 'ja'] as const) {
      for (const d of ["$'\\u0085'", "$'\\u009b'", "$'\\u2028'", "$'\\x7f'"]) {
        const line = `ps aux | head -n 20 | cut -d ${d} -f1`;
        const lines = explain(line, 0, lang).examples.flatMap((e) => e.sections.flatMap((sec) => sec.lines)).filter((r) => / 0:00 /.test(r));
        assert.ok(lines.length && lines.every((r) => !/cut/.test(r)), `${line} (${lang})`);
      }
    }
  });
  it('cuts the name `ps` shows to 15 bytes, as the kernel does, and shows a character cut in two as procps does', function () {
    this.timeout(30000);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explain-bash-comm-'));
    try {
      for (const name of ['aああああああ', 'ああああああ', 'abcdefghijklmnopq', 'sleepy']) {
        const file = path.join(dir, name);
        fs.symlinkSync(spawnSync('bash', ['-c', 'command -v sleep']).stdout.toString().trim(), file);
        const theirs = lines(run('bash', ['-c', `"$1" 0.5 & sleep 0.2; ps -o comm= -p $!; wait`, 'bash', file], { env: { ...C, LC_ALL: 'C.UTF-8' }, check: true }).stdout)[0];
        const ours = layoutSample('ps', [{ argv: ['ps'] }, { argv: [file, '0.5'], path: file }], 0).at(-1)!;
        assert.strictEqual(ours.replace(/^.* \d\d:\d\d:\d\d /, ''), theirs, name);
      }
    } finally {
      fs.rmSync(dir, { recursive: true });
    }
  });
  it('reads a name `hash -p` gave a path as the program of that path, as bash runs it', function () {
    this.timeout(30000);
    /** The last section of the whole-pipeline example of `line` (its input in the first), and what bash prints of that input. */
    const both = (ex: Example | undefined, line: string) => {
      assert.ok(ex, line);
      const input = ex.sections[0].label.startsWith('Input') ? ex.sections[0].lines.map((l) => l + '\n').join('') : '';
      return [ex.sections.at(-1)!.lines, lines(run('bash', ['-c', line], { input, env: C }).stdout)];
    };
    const whole = (ex: Example[]) => ex.find((e) => e.kind === 'pipeline');
    for (const [ex, line] of [
      [explain("printf 'b\\na\\nc\\n' | \\sort | 'head' -n 2").examples, "printf 'b\\na\\nc\\n' | \\sort | 'head' -n 2"],
      [explain("hash -p /usr/bin/tac sort; printf 'b\\na\\nc\\n' | \\sort").examples, "hash -p /usr/bin/tac sort; printf 'b\\na\\nc\\n' | \\sort"],
      [explain("hash -p /usr/bin/tac sort; printf 'b\\na\\nc\\n' | sort", 0, 'ja').examples, "hash -p /usr/bin/tac sort; printf 'b\\na\\nc\\n' | sort"],
      [explain('hash -p /usr/bin/tac env; env | head -3').examples, 'hash -p /usr/bin/tac env; env | head -3'],
    ] as [Example[], string][]) {
      const [ours, theirs] = both(whole(ex), line);
      assert.deepStrictEqual(ours, theirs, line);
      // (tac prints no environment.)
      assert.ok(!ex.some((e) => e.sections.some((sec) => sec.lines.some((l) => l.startsWith('_=')))), line);
    }
    // ps shows the name as written, and the program run in its CMD column (`comm`).
    const real = lines(run('bash', ['-c', 'hash -p /usr/bin/head zz; zz -n 5 < <(sleep 0.5) & sleep 0.2; ps -o comm=,args= -p $!; wait'], { env: C, check: true }).stdout)[0];
    assert.deepStrictEqual(real.split(/ +/), ['head', 'zz', '-n', '5']);
    assert.strictEqual(whole(explain('hash -p /usr/bin/head zz; ps | zz -n 5').examples)?.sections[0].lines.at(-1)!.replace(/^.* /, ''), 'head');
    assert.strictEqual(whole(explain('hash -p /usr/bin/head zz; ps aux | zz -n 5', 0, 'ja').examples)?.sections[0].lines.at(-1)!.replace(/^.* 0:00 /, ''), 'zz -n 5');
  });
  it('makes up no environment for env with an assignment before it, which it prints (`PATH=` changes its path too)', () => {
    assert.ok(lines(run('bash', ['-c', 'PATH=/bin env | cat'], { env: C, check: true }).stdout).includes('_=/bin/env'));
    assert.ok(lines(run('bash', ['-c', 'FOO=1 printenv | cat'], { env: C, check: true }).stdout).includes('FOO=1'));
    for (const lang of ['en', 'ja'] as const) {
      for (const ex of [explain('PATH=/bin env | cat', 0, lang).examples, explain('FOO=1 printenv | cat', 0, lang).examples]) {
        assert.ok(!ex.some((e) => e.sections.some((sec) => sec.lines.some((l) => l.startsWith('_=')))), lang);
      }
    }
  });
  it('makes up no output for other options or operands, and says that the input is not known', () => {
    for (const line of ['ps aux --sort=-%mem | head', 'ls -l /etc | wc -l', 'ls -lt | head -n 3', 'df | wc -l', 'ls -l --nope | wc -l', 'ls -lj | wc -l', 'ls -lZ | wc -l', 'mytool | wc -l', 'ps -ef -- | head', 'ps aux -- | head']) {
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
    // (A name written otherwise runs the same program, which prints the environment: `_` is the path bash ran it by.)
    for (const line of ['\\env | cat', '"env" -- | cat', 'e\\nv | cat', "'printenv' | cat", '/bin/env | cat', 'hash -p /bin/env env; env | cat', 'hash -p /bin/env env; \\env | cat']) {
      const theirs = lines(run('bash', ['-c', line.replace(/\| cat$/, "| grep '^_='")], { env: C, check: true }).stdout);
      for (const lang of ['en', 'ja'] as const) {
        const ex = explain(line, 0, lang).examples.find((e) => e.kind === 'pipeline');
        assert.deepStrictEqual([ex?.sections[0].lines.at(-1)], theirs, `${line} (${lang})`);
      }
    }
    assert.strictEqual(pipelineExampleOf('"env" -- | grep PATH')?.sections[0].label, 'Output of `"env" --` (sample)');
    assert.deepStrictEqual(pipelineExampleOf('\\ls -l | cat')?.sections[0].lines, sample('ls-long', ['ls', '-l']));
    // A function of that name runs instead, quoted or not (a quoted name skips only aliases): nothing is made up.
    for (const line of ['env() { echo hi; }; env | cat', 'env() { echo hi; }; \\env | cat', 'env() { echo hi; }; "env" -- | cat']) {
      for (const lang of ['en', 'ja'] as const) {
        const ex = explain(line, 0, lang).examples;
        assert.ok(!ex.some((e) => e.sections.some((s) => s.lines.some((l) => l.startsWith('_=')))), `${line} (${lang})`);
      }
    }
    // (`--` written otherwise is `--` to env too, and to the `_` line: these once threw.)
    for (const line of ['env \\-- | cat', 'env -\\- | cat', "env $'--' | cat", 'env "--" | cat', 'printenv \\-- | cat', "printenv $'--' | cat"]) {
      for (const lang of ['en', 'ja'] as const) {
        const ex = explain(line, 0, lang).examples.find((e) => e.kind === 'pipeline');
        assert.strictEqual(ex?.sections[0].lines.at(-1), `_=/usr/bin/${line.split(' ')[0]}`, `${line} (${lang})`);
      }
    }
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

/** The lines of the made-up output that start the whole-pipeline example of `src` (its last line), if any. */
const madeUpOf = (src: string, lang: 'en' | 'ja') => {
  const ex = explain(src, src.split('\n').length - 1, lang).examples.find((e) => e.kind === 'pipeline');
  return ex && /^Output of|の出力（例）$/.test(ex.sections[0].label) ? ex : undefined;
};

describe('the made-up environment, with what the script exports', () => {
  /** What bash prints of `script`, run in the made-up environment. */
  const bash = (script: string) => lines(run('bash', ['-c', script], { env: Object.fromEntries(ENVIRONMENT) }).stdout);
  it('env and printenv print what the script exported, unset or stopped exporting, as bash does', () => {
    for (const script of [
      'export FOO=bar; env | grep FOO', 'declare -x FOO=bar; printenv | grep FOO', 'FOO=bar; env | grep FOO', 'set -a; FOO=1; env | grep FOO',
      'export FOO=a; export -n FOO; env | grep FOO', 'export FOO=a; unset FOO; env | grep FOO', 'unset HOME; env | grep HOME',
      'export -n PATH; env | grep PATH', 'PATH=/usr/bin:/bin; env | grep PATH', 'declare -xu FOO=abc; env | grep FOO',
      'f() { local -x FOO=1; env | grep FOO; }; f', '(export FOO=1); env | grep FOO', "export FOO=$'a\\nb'; env | grep -x b",
      'a=(1 2); export a; env | grep ^a=', 'export LANG=C; env | grep LANG',
    ]) {
      for (const lang of ['en', 'ja'] as const) {
        const ex = madeUpOf(script, lang);
        assert.ok(ex, `${script} (${lang})`);
        assert.deepStrictEqual(ex.sections.at(-1)!.lines, bash(script), `${script} (${lang})`);
      }
    }
    assert.ok(madeUpOf('export FOO=bar; env | grep FOO', 'en')!.sections[0].lines.includes('FOO=bar'));
  });
  it('makes up no environment where the model cannot tell what is exported', () => {
    for (const script of [
      'source ./x; env | grep FOO', 'eval "$x"; env | grep FOO', 'if [ "$1" ]; then export FOO=1; fi; env | grep FOO', 'export FOO=$x; env | grep FOO',
      'export FOO; env | grep FOO', 'f() { :; }; export -f f; env | grep FOO', 'declare -n r=FOO; export r; env | grep FOO', 'cd /tmp; env | grep PWD',
      'f() { env | grep FOO; }; export FOO=$1', 'if [ "$1" ]; then a=(1); fi; export a; env | grep ^a=',
    ]) {
      for (const lang of ['en', 'ja'] as const) {
        const ex = explain(script, 0, lang).examples;
        assert.ok(!ex.some((e) => e.sections.some((sec) => sec.lines.some((l) => l.startsWith('_=')))), `${script} (${lang})`);
      }
    }
  });
});

describe('the variables of the environment that change a layout', function () {
  this.timeout(60000);
  // Locales built for the test (`localedef`, with `LOCPATH`): the made-up system's, and one that changes the layouts.
  const locales = fs.mkdtempSync(path.join(os.tmpdir(), 'explain-bash-locales-'));
  const built = (name: string) => {
    const [i, f] = name.split(/\.|@/);
    spawnSync('localedef', ['-i', i, '-f', f, path.join(locales, name)], { stdio: 'ignore' });
    return fs.existsSync(path.join(locales, name));
  };
  let haveLocales = false;
  let dir = '';
  let utmp = '';
  // A program with a long name (15 bytes, all of it in ps's `comm`), running while ps runs: a narrower line cuts it.
  const LONG = 'abcdefghijklmno';
  /** What `script` prints, run by bash with `env` while the program `LONG` runs. */
  const withLong = (script: string, env: Record<string, string>) => lines(run('bash', ['-c', `"$0" 5 & sleep 0.2; ${script}; kill $!`, path.join(locales, LONG)], { env, cwd: dir }).stdout);
  /** What tells ps's layouts apart: the header, and whether the line of `LONG` is whole. */
  const psLayout = (out: string[]) => `${out[0]}\n${out.some((l) => l.includes(LONG))}`;
  // (The made-up system's locale, `LANG=en_US.UTF-8`; C.UTF-8 prints the same, when it cannot be built.)
  const base = () => ({ PATH: process.env.PATH!, TZ: 'UTC', LOCPATH: locales, LANG: haveLocales ? 'en_US.UTF-8' : 'C.UTF-8' });
  before(() => {
    haveLocales = built('en_US.UTF-8') && built('de_DE.UTF-8');
    // (A system's locales answer to `en_US.utf8` too.)
    if (haveLocales) fs.symlinkSync('en_US.UTF-8', path.join(locales, 'en_US.utf8'));
    fs.symlinkSync(spawnSync('bash', ['-c', 'command -v sleep']).stdout.toString().trim(), path.join(locales, LONG));
    dir = madeUpDirectory();
    // A login record of who, as `/var/run/utmp` holds it (glibc's `struct utmp`: a USER_PROCESS on pts/0 from 192.168.1.20).
    const rec = Buffer.alloc(384);
    rec.writeInt16LE(7, 0);
    rec.writeInt32LE(2140, 4);
    rec.write('pts/0', 8);
    rec.write('ts/0', 40);
    rec.write('alice', 44);
    rec.write('192.168.1.20', 76);
    rec.writeInt32LE(1772530200, 340);
    utmp = path.join(dir, 'utmp');
    fs.writeFileSync(utmp, rec);
  });
  after(() => {
    removeDirectory(dir);
    fs.rmSync(locales, { recursive: true, force: true });
  });

  /** What the command of a layout prints with `env` added to the base environment: ls in the made-up directory, the header of ps, df's sizes as their shape. */
  const output = (layout: Layout, argv: string[], env: Record<string, string>): string => {
    if (layout.startsWith('ps')) return psLayout(withLong(argv.join(' '), { ...base(), ...env }));
    const out = lines(run(argv[0], [...argv.slice(1), ...(layout === 'who' ? [utmp] : [])], { env: { ...base(), ...env }, cwd: dir }).stdout);
    return (layout === 'df-human' ? out.map((l) => l.replace(/\d/g, '9')) : out).join('\n');
  };
  /** A value of each variable that changes the layouts that list it (for who, the C locale). */
  const changing = (layout: Layout, name: string): string | undefined => ({
    TIME_STYLE: 'long-iso', QUOTING_STYLE: 'c', BLOCK_SIZE: 'K', LS_BLOCK_SIZE: 'K', BLOCKSIZE: 'K', POSIXLY_CORRECT: '1', COLUMNS: '20',
    PS_FORMAT: 'pid,comm', PS_PERSONALITY: 'bsd', CMD_ENV: 'bsd', I_WANT_A_BROKEN_PS: '1',
  } as Record<string, string>)[name] ?? (/^(LC_|LANG$)/.test(name) ? (layout === 'who' ? 'C' : haveLocales ? 'de_DE.UTF-8' : undefined) : undefined);
  // Variables that do not change them: ls in a pipe prints a name a line, and -h ignores the block size.
  const UNCHANGED: Partial<Record<Layout, string[]>> = {
    ls: ['COLUMNS', 'TABSIZE', 'LS_COLORS', 'TIME_STYLE', 'BLOCK_SIZE', 'LC_COLLATE'], 'ls-long-human': ['BLOCK_SIZE', 'LS_BLOCK_SIZE', 'BLOCKSIZE', 'POSIXLY_CORRECT'],
    'df-human': ['BLOCK_SIZE', 'DF_BLOCK_SIZE', 'BLOCKSIZE', 'POSIXLY_CORRECT'], 'ps-bsd-u': ['PS_FORMAT', 'I_WANT_A_BROKEN_PS'], ps: ['POSIXLY_CORRECT', 'UNIX95'],
  };
  const ARGV: Record<string, string> = { ps: '', 'ps-bsd-u': 'aux', 'ps-full': '-ef', ls: '', 'ls-long': '-l', 'ls-long-all': '-la', 'ls-long-human': '-lh', 'df-human': '-h', who: '' };
  it('each one listed in the specs changes the real tool, and the values listed with it do not', () => {
    for (const [name, spec] of Object.entries(commands)) {
      for (const alt of spec.layouts ?? []) {
        if (alt.environment === 'prints' || alt.options.includes('-1')) continue;
        const argv = [name, ...ARGV[alt.layout].split(' ').filter(Boolean)];
        const plain = output(alt.layout, argv, {});
        // (A machine whose file systems have no size with a decimal shows no decimal point to change.)
        const decimals = alt.layout !== 'df-human' || /9\.9/.test(plain);
        for (const [v, keeps] of Object.entries(alt.environment)) {
          const value = changing(alt.layout, v);
          if (value !== undefined && decimals) assert.notStrictEqual(output(alt.layout, argv, { [v]: value }), plain, `${argv.join(' ')} with ${v}=${value}`);
          for (const keep of keeps) {
            if (!haveLocales && keep.startsWith('en_US')) continue;
            assert.strictEqual(output(alt.layout, argv, { [v]: keep }), plain, `${argv.join(' ')} with ${v}=${keep}`);
          }
        }
        for (const v of UNCHANGED[alt.layout] ?? []) {
          assert.ok(!(v in alt.environment), `${alt.layout}: ${v}`);
          assert.strictEqual(output(alt.layout, argv, { [v]: changing(alt.layout, v) ?? 'K' }), plain, `${argv.join(' ')} with ${v}`);
        }
      }
    }
  });
  it('drops the sample where an assignment before the command, or an export of the script, changes the layout, as bash runs it', () => {
    // (Whether bash's output differs from that of the command alone: ls whole, in the made-up directory; ps by `psLayout`.)
    for (const [script, alone, layout] of [
      ['TIME_STYLE=long-iso ls -l | cat', 'ls -l', 'ls-long'], ['export TIME_STYLE=long-iso; ls -l | cat', 'ls -l', 'ls-long'],
      ['TIME_STYLE=long-iso; ls -l | cat', 'ls -l', 'ls-long'], ['declare -x QUOTING_STYLE=c; ls | cat', 'ls', 'ls'],
      ['set -a; QUOTING_STYLE=c; ls | cat', 'ls', 'ls'], ['QUOTING_STYLE=literal ls | cat', 'ls', 'ls'], ['BLOCK_SIZE=K ls -l | cat', 'ls -l', 'ls-long'],
      ['BLOCK_SIZE=K ls -lh | cat', 'ls -lh', 'ls-long-human'], ['LC_ALL=C ls -l | cat', 'ls -l', 'ls-long'], ['TZ=UTC ls -l | cat', 'ls -l', 'ls-long'],
      ['LANG=de_DE.UTF-8; ls -l | cat', 'ls -l', 'ls-long'], ['LC_TIME=de_DE.UTF-8; ls -l | cat', 'ls -l', 'ls-long'], ['export -n LANG; ls -l | cat', 'ls -l', 'ls-long'],
      ['f() { ls -l | cat; }; export TIME_STYLE=long-iso; f', 'ls -l', 'ls-long'], ['PS_FORMAT=pid,comm ps | cat', 'ps', 'ps'],
      ['export PS_FORMAT=pid,comm; ps | cat', 'ps', 'ps'], ['PS_FORMAT=pid,comm ps aux | cat', 'ps aux', 'ps'], ['COLUMNS=20 ps aux | cat', 'ps aux', 'ps'],
      ['export PS_PERSONALITY=bsd; ps -ef | cat', 'ps -ef', 'ps'],
    ] as [string, string, string][]) {
      if (!haveLocales && /de_DE/.test(script)) continue;
      const out = (s: string) => (layout === 'ps' ? psLayout(withLong(s, base())) : lines(run('bash', ['-c', s], { env: base(), cwd: dir }).stdout).join('\n'));
      const changes = out(script) !== out(alone);
      for (const lang of ['en', 'ja'] as const) assert.strictEqual(!madeUpOf(script, lang), changes, `${script} (${lang})`);
    }
  });
  it('drops it where the model cannot tell, and keeps it in a function the script does not change it for', () => {
    for (const lang of ['en', 'ja'] as const) {
      for (const script of ['source ./x; ps aux | cat', 'PS_FORMAT=$f ps | cat', 'if [ "$1" ]; then export TIME_STYLE=long-iso; fi; ls -l | cat', 'LANG+=x ls -l | cat',
        'unset LANG; who | cat', 'LC_ALL=C who | cat', 'LC_NUMERIC=de_DE.UTF-8 df -h | cat', 'f() { ls -l | cat; }; TIME_STYLE=$1; export TIME_STYLE']) {
        assert.ok(!madeUpOf(script, lang), `${script} (${lang})`);
      }
      for (const [script, layout, argv] of [['f() { ps | cat; }', 'ps', ['ps']], ['LC_ALL=C.UTF-8 who | cat', 'who', ['who']], ['LC_ALL= who | cat', 'who', ['who']], ['LANG= ls -l | cat', 'ls-long', ['ls', '-l']]] as [string, Layout, string[]][]) {
        assert.deepStrictEqual(madeUpOf(script, lang)?.sections[0].lines, layoutSample(layout, [{ argv }, { argv: ['cat'] }], 0), `${script} (${lang})`);
      }
    }
  });
});
