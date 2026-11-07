// Which recipe lines GNU make runs with no shell (src/hosts/makerun.ts, src/hosts/makefile.ts), against the real make:
// a probe program records its parent (make, or the shell make started) and the words it got. GNU make is GPL: it runs
// here only as a separate program, and the test is skipped where it (or Linux's /proc, or a /bin/sh that forks) is missing.
import * as assert from 'assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Analyzer } from '../src/analyzer';
import { explainHostedLine, extractShell } from '../src/hosts';
import { recipeRun } from '../src/hosts/makerun';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { allTokens } from './support/explain';

/** The first words make sends to the shell; each gets a probe program of its name, to see whether make or the shell ran it. */
const SHELL_COMMANDS = ['alias', 'bg', 'break', 'case', 'cd', 'command', 'continue', 'eval', 'exec', 'exit', 'export', 'fc', 'fg', 'for', 'getopts', 'hash', 'if', 'jobs', 'login', 'logout', 'read', 'readonly', 'return', 'set', 'shift', 'test', 'times', 'trap', 'type', 'ulimit', 'umask', 'unalias', 'unset', 'wait', 'while'];
/** Names that are builtins or keywords of a shell too, and that make runs as programs. */
const PROGRAMS = ['echo', 'printf', 'true', 'false', 'pwd', 'kill', 'source', 'time', 'local', 'declare', 'typeset', 'let', 'then', 'do', 'done', 'fi', 'else', 'until', 'select', 'function', 'newgrp'];

let dir: string;
let usable = false;

/** One line of the probe's output: who ran it (`make`, or a shell), its name, and the words it got. */
interface Seen { parent: string; name: string; words: string[] }

const probeScript = `#!/bin/sh
args=$(for a in "$@"; do printf '%s\\037' "$a"; done)
printf 'PP=%s N=%s ARGS=%s\\036' "$(cat /proc/$PPID/comm)" "$(basename "$0")" "$args"
`;

/** Run a makefile with the probes in PATH; what each recipe's probe saw, in the order it ran. */
function makeRun(makefile: string): Seen[] {
  const work = fs.mkdtempSync(path.join(dir, 'run-'));
  fs.writeFileSync(path.join(work, 'Makefile'), makefile);
  const r = spawnSync('make', ['-s', '-i'], { cwd: work, env: { ...process.env, PATH: `${path.join(dir, 'bin')}:${process.env.PATH}` }, timeout: 60000, encoding: 'utf8' });
  fs.rmSync(work, { recursive: true });
  return [...(r.stdout + r.stderr).matchAll(/PP=(\S+) N=(\S+) ARGS=([^\x1e]*)\x1e/g)].map((m) => ({ parent: m[1], name: m[2], words: m[3].split('\x1f').slice(0, -1) }));
}

/** The region of the host's reading of `makefile` for each recipe, whether it runs with no shell, in the file's order. */
function hostNoShell(makefile: string): boolean[] {
  return extractShell('makefile', makefile).regions.map((r) => !!r.noShell);
}

describe('Makefile recipe lines make runs with no shell, against GNU make', () => {
  before(function () {
    const version = spawnSync('make', ['--version'], { encoding: 'utf8' });
    if (version.error || !/^GNU Make/.test(version.stdout) || process.platform !== 'linux') this.skip();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explain-bash-make-'));
    fs.mkdirSync(path.join(dir, 'bin'));
    for (const name of ['probe', ...SHELL_COMMANDS, ...PROGRAMS]) fs.writeFileSync(path.join(dir, 'bin', name), probeScript, { mode: 0o755 });
    // (A /bin/sh that runs the last command of `-c` in place, bash does, hides the shell from the probe's parent.)
    const sh = spawnSync('/bin/sh', ['-c', 'probe x; probe y'], { env: { ...process.env, PATH: `${path.join(dir, 'bin')}:${process.env.PATH}` }, encoding: 'utf8' });
    usable = /PP=\S*sh /.test(sh.stdout);
    if (!usable) this.skip();
  });
  after(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  // [line, the program it starts]
  const lines: [string, string?][] = [
    ['probe a b'], ['probe "a" b'], ["probe 'a b' c"], ['probe a\\\\tb'], ['probe a\\tb'], ['probe a;b'], ['probe a#b'], ['probe a=b'], ['A=1 probe a'], ['probe $$X'],
    ['probe a*'], ['probe a~'], ['probe ~'], ['probe a^b'], ['probe a!b'], ['probe {a,b}'], ['probe a`b`'], ['probe (a)'], ['probe a\\\\\\\\b'], ['probe a\\ b'],
    ["probe a\\'b"], ["probe 'a\\\\b'"], ["probe 'a\\b'"], ["probe 'a\"b'"], ["probe a'b"], ['@probe a'], ['-probe a'], ['+probe a'], ['@-probe a'], ['  probe   a  '],
    ['probe a=b c'], ['probe -x=1'], ['probe a\\'], ['probe a\\\\'], ["probe 'a#b'"], ["probe 'a;b'"], ["probe ''"], ["probe a''b"], ['probe "'], ["probe ''''"],
    ['probe a\\;b'], ['probe a\\"b'], ['probe a\\$$b'], ['probe a\\*b'], ['probe a\\#b'], ["probe 'a$$b'"], ["probe 'a\\' b"], ["probe 'a\\'b'"], ['probe a\\\\\\\\\\b'],
    ["probe 'x' 'y z'"], ["probe 'x''y'"], ['probe a\tb'], ['probe\ta'], ['probe'], ['probe a\\ \\ b'], ['probe a\\\\ b'], ["probe 'a"], ['probe =a'], ['probe a= b'],
    ['probe a|b'], ['probe a&b'], ['probe a?b'], ['probe a[b]'], ['probe a]b'], ['probe a{b'], ['probe a}b'], ['probe a%b'], ['probe a@b'], ['probe a:b'], ['probe a,b'],
    ['probe a+b'], ['probe a"b'], ['probe a/b'], ['probe -a -- b'], ['probe $@ x'], ['probe $< $^ $? $*'], ['probe a$@b'], ["probe '$@' x"], ['probe "$@"'],
    ["'probe' a"], ["p'ro'be a"], ['"probe" a'], ["'cd' x"], ['=a probe'], ['probe=1 x'],
    ...[...SHELL_COMMANDS, ...PROGRAMS].map((name): [string, string] => [`${name} probe`, name]),
    ...SHELL_COMMANDS.map((name): [string, string] => [`${name}\tprobe`, name]),
    ['echo -e x', 'echo'], ["echo -e 'x\\ty'", 'echo'], ['printf %s a', 'printf'], ['echo a\\\\tb', 'echo'],
  ];
  // (Lines with a make variable: its value decides, so the test asks only that a line sure to go to the shell does, and one sure not to does not.)
  const variables: [string, string?][] = [
    ['probe $(X)'], ['probe $(Y) a'], ['probe $X a'], ['probe ${X}'], ['probe a$(X)b'], ["probe '$(Y)'"], ['probe $(Z)'], ['probe $(X);b'], ['probe $(X) "a"'],
    ['$(X) probe'], ['probe $(subst x,y,xz)'], ['probe $(info hi)'], ['echo $(shell echo hi)', 'echo'], ['probe $(X) $$HOME'], ["probe '$(X)' $<"], ['probe $'], ['probe \\$(X)'], ['probe \\$@'], ['probe $ x'],
  ];

  it('reads a line as make does: no shell, and the words it passes', () => {
    const all = [...lines, ...variables];
    const header = 'X = xx\nY = a b\nZ = a;b\n';
    // (One make for the whole table; `@@N` marks where a recipe begins: only the probes print. The blank line ends a recipe that stops with a backslash.)
    const text = `${header}all: ${all.map((_, n) => `t${n}`).join(' ')}\n${all.map(([line], n) => `t${n}:\n\t@/bin/echo @@${n}\n\t${line}\n\n`).join('')}`;
    const work = fs.mkdtempSync(path.join(dir, 'table-'));
    fs.writeFileSync(path.join(work, 'Makefile'), text);
    const r = spawnSync('make', ['-s', '-i'], { cwd: work, env: { ...process.env, PATH: `${path.join(dir, 'bin')}:${process.env.PATH}` }, timeout: 60000, encoding: 'utf8' });
    fs.rmSync(work, { recursive: true });
    const out = r.stdout + r.stderr;
    const parts = out.split(/@@(\d+)\n/);
    const seen = new Map<number, Seen[]>();
    for (let k = 1; k < parts.length; k += 2) {
      seen.set(Number(parts[k]), [...parts[k + 1].matchAll(/PP=(\S+) N=(\S+) ARGS=([^\x1e]*)\x1e/g)].map((m) => ({ parent: m[1], name: m[2], words: m[3].split('\x1f').slice(0, -1) })));
    }
    assert.strictEqual(seen.size, all.length, 'every recipe ran');
    let direct = 0;
    let shell = 0;
    let maybe = 0;
    all.forEach(([line, name = 'probe'], n) => {
      // (The prefixes are make's: the line it reads starts after them.)
      const verdict = recipeRun(line.replace(/^[@+\-\s]*/, ''));
      const ran = seen.get(n)!.filter((s) => s.name === name);
      const byMake = ran.length === 1 && ran[0].parent === 'make';
      const msg = `${JSON.stringify(line)}: ${JSON.stringify(verdict)} ${JSON.stringify(seen.get(n))}`;
      if (verdict.run === 'direct') {
        direct++;
        assert.ok(byMake, msg);
        const words = verdict.words.slice(1);
        // (A word with a file name in it is not known to the test: `$@` is `t${n}`.)
        if (name === 'probe' && words.every((w) => w !== undefined)) assert.deepStrictEqual(ran[0].words, words, msg);
      } else if (verdict.run === 'shell') {
        shell++;
        assert.ok(!byMake, msg);
      } else maybe++;
    });
    assert.ok(direct > 60 && shell > 60 && maybe > 8, `${direct} ${shell} ${maybe}`);
  });


  it('is the line the host leaves out of the shell: the region has no shell exactly where make has none', () => {
    for (const [makefile, noShell] of HOST_CASES) {
      const ran = makeRun(makefile);
      if (/\bprobe\b/.test(makefile) && ran.length) assert.strictEqual(ran[0].parent === 'make', noShell, makefile);
    }
  });

  it('reads the file around the line: SHELL, .ONESHELL, IFS and a rule with several lines', () => {
    for (const [makefile, expected] of FILE_CASES) {
      const seen = makeRun(makefile);
      for (const [tag, noShell] of Object.entries(expected)) {
        const ran = seen.find((s) => s.words[0] === tag);
        // (A shell that fails on the flags, dash on `-o pipefail`, never runs the probe: it was not make that ran it.)
        if (noShell) assert.ok(ran, `${tag} ran: ${makefile}`);
        assert.strictEqual(ran?.parent === 'make', noShell, `make: ${tag}: ${makefile}`);
      }
    }
  });

  it('prints with /bin/echo what the explanation says: -e is read', () => {
    const real = spawnSync('make', ['-s', '-f', '-'], { input: "all:\n\t@echo -e 'x\\ty'\n", encoding: 'utf8' });
    assert.strictEqual(real.stdout, 'x\ty\n');
  });
});

/** [a makefile, whether its one recipe line runs with no shell]. */
const HOST_CASES: [string, boolean][] = [
  ['all:\n\t@echo -e x\n', true],
  ['all:\n\techo -e x;\n', false],
  ['all:\n\techo "x"\n', false],
  ['all:\n\tcd src\n', false],
  ['all:\n\t$(CC) -c a.c\n', false],
  ['all:\n\tprobe $@ $<\n', true],
  ['all:\n\tprobe a \\\n\t  b\n', true],
];

/** [a makefile, whether each recipe line (its probe `t0`, `t1`…) runs with no shell]. */
const FILE_CASES: [string, Record<string, boolean>][] = [
  ['all:\n\tprobe t0\n', { t0: true }],
  ['SHELL = /bin/sh\nall:\n\tprobe t0\n', { t0: true }],
  ['SHELL := /bin/sh\nall:\n\tprobe t0\n', { t0: true }],
  ['SHELL = /bin/dash\nall:\n\tprobe t0\n', { t0: false }],
  ['SHELL = sh\nall:\n\tprobe t0\n', { t0: false }],
  ['all:\n\tprobe t0\nSHELL = /bin/dash\n', { t0: false }],
  ['export IFS=x\nall:\n\tprobe t0\n', { t0: false }],
  ['.ONESHELL:\nall:\n\tprobe t0\n', { t0: true }],
  ['.ONESHELL:\nall:\n\t@probe t0\n', { t0: true }],
  ['.ONESHELL:\nall:\n\tprobe t0\n\tprobe t1\n', { t0: false, t1: false }],
  ['.ONESHELL:\nall: b\n\tprobe t0\nb:\n\tprobe t1\n\tprobe t2\n', { t0: true, t1: false, t2: false }],
  ['all:\n\tprobe t0\n\t@probe t1\n\t-probe t2\n', { t0: true, t1: true, t2: true }],
  ['all:\n\tprobe t0 a \\\n\t  b\n', { t0: true }],
  ['all:\n\tprobe t0 a\\\n\tb\n', { t0: true }],
  ['all:\n\tprobe t0 a\\\nb\n', { t0: true }],
  ["all:\n\tprobe t0 'a \\\n\t b'\n", { t0: true }],
  ['all:\n\tprobe t0 a \\\n\t; b\n', { t0: false }],
  ['all:\n\t# c\n\tprobe t0\n', { t0: true }],
  ['all:\n\tprobe t0 # c\n', { t0: false }],
  // (.SHELLFLAGS: only the default `-c` and `-ec` keep the line out of the shell.)
  ['.SHELLFLAGS := -c\nall:\n\tprobe t0\n', { t0: true }],
  ['.SHELLFLAGS = -ec\nall:\n\tprobe t0\n', { t0: true }],
  ['.SHELLFLAGS := -eu -c\nall:\n\tprobe t0\n', { t0: false }],
  ['.SHELLFLAGS := -eu -o pipefail -c\nall:\n\tprobe t0\n', { t0: false }],
  ['.SHELLFLAGS := -xc\nall:\n\tprobe t0\n', { t0: false }],
  ['.SHELLFLAGS := -euc\nall:\n\tprobe t0\n', { t0: false }],
  // (SHELL in its other spellings; a comment sets nothing.)
  ['export SHELL = /bin/dash\nall:\n\tprobe t0\n', { t0: false }],
  ['all: SHELL := /bin/dash\nall:\n\tprobe t0\n', { t0: false }],
  ['SHELL ::= /bin/dash\nall:\n\tprobe t0\n', { t0: false }],
  ['# SHELL = /bin/dash\nall:\n\tprobe t0\n', { t0: true }],
  ['all:\n\tprobe t0\n\tSHELL = /bin/dash\n', { t0: true }],
];

describe('Makefile recipe lines with no shell: the host\'s reading', () => {
  const explain = (src: string, line: number) => {
    const extracted = extractShell('makefile', src);
    return explainHostedLine(new Analyzer('en'), createUnbashParser().parse(extracted.text), extracted, src.split('\n'), line, 'en')!;
  };

  it('does not read what make does not: an unfinished reference, an empty line', () => {
    assert.deepStrictEqual(recipeRun('probe $(X'), { run: 'maybe', first: 'probe' });
    assert.deepStrictEqual(recipeRun(''), { run: 'shell' });
    assert.deepStrictEqual(recipeRun("probe 'a"), { run: 'shell' });
    // (Without make: a lone `$`, a backslash before a reference or at the end, a variable as the first word.)
    assert.deepStrictEqual(recipeRun('probe $'), { run: 'maybe', first: 'probe' });
    assert.deepStrictEqual(recipeRun('probe \\$(X)'), { run: 'maybe', first: 'probe' });
    assert.deepStrictEqual(recipeRun('probe \\$@ a'), { run: 'direct', words: ['probe', undefined, 'a'] });
    assert.deepStrictEqual(recipeRun('probe a\\'), { run: 'direct', words: ['probe', 'a'] });
    assert.deepStrictEqual(recipeRun('$(CC) x'), { run: 'maybe' });
    assert.deepStrictEqual(recipeRun("echo 'a \\\n b' c\\\nd"), { run: 'direct', words: ['echo', 'a \\\n b', 'cd'] });
  });

  it('puts the region of a line make runs itself outside the shell', () => {
    for (const [makefile, noShell] of HOST_CASES) assert.deepStrictEqual(hostNoShell(makefile), [noShell], makefile);
  });

  it('reads the file around the line: SHELL, .ONESHELL, IFS and a rule with several lines', () => {
    for (const [makefile, expected] of FILE_CASES) {
      const regions = extractShell('makefile', makefile).regions;
      const lines = makefile.split('\n');
      for (const [tag, noShell] of Object.entries(expected)) {
        const region = regions.find((r) => new RegExp(`\\b${tag}\\b`).test(lines.slice(r.start, r.end + 1).join('\n')))!;
        assert.strictEqual(!!region.noShell, noShell, `${tag}: ${makefile}`);
      }
    }
  });

  it('explains echo -e as the program make runs, not as dash\'s builtin', () => {
    const ex = explain("all:\n\t@echo -e '\\033[32mOK\\033[0m'\n", 1);
    const text = JSON.stringify(ex);
    assert.ok(!/dash/.test(text), 'no word about dash\'s echo');
    assert.match(ex.notes.join('\n'), /make runs this line directly as a program, with no shell/);
    assert.match(text, /No shell reads these words, so this is the program, not the shell's builtin/);
    // (With a shell, the same line is dash's, and the note says so.)
    const shell = explain("all:\n\t@echo -e '\\033[32mOK\\033[0m';\n", 1);
    assert.match(shell.notes.join('\n'), /dash's `echo` prints `-e` as text/);
    assert.ok(!/no shell/.test(JSON.stringify(shell)));
  });

  it('says that a variable may decide, for a builtin\'s name', () => {
    assert.match(explain('all:\n\techo $(NAME)\n', 1).notes.join('\n'), /make expands the variables first/);
    // (Not for a program of a name no shell has, nor for a variable as the name: nothing differs.)
    assert.ok(!explain('all:\n\tgcc $(NAME)\n', 1).notes.join('\n').includes('make expands the variables first'));
    assert.ok(!explain('all:\n\t$(CC) $(NAME)\n', 1).notes.join('\n').includes('make expands the variables first'));
  });

  it('does not tell to quote what no shell splits', () => {
    // (`$@` is make's text by then. With a shell, the pitfall stands.)
    assert.ok(!explain('all:\n\trm -f $@\n', 1).notes.join('\n').includes('is not quoted'));
    assert.match(explain('all:\n\trm -f $@ ;\n', 1).notes.join('\n'), /is not quoted/);
  });

  it('does not say a shell runs `$@` where none does', () => {
    const direct = explain('all:\n\trm -f $@\n', 1);
    assert.ok(!/shell runs/.test(JSON.stringify(direct)), 'no shell in the note or the token');
    assert.match(direct.notes.join('\n'), /expanded by make before the line runs/);
    assert.match(JSON.stringify(explain('all:\n\trm -f $@ ;\n', 1)), /expanded by make before the shell runs/);
  });

  it('reads the first word of a line without a shell as a program, never as a keyword of bash', () => {
    // (`time make` runs /usr/bin/time; `until false` runs a program `until`, which is not found.)
    const types = (src: string, kind: 'makefile' | 'dockerfile' = 'makefile') => {
      const extracted = extractShell(kind, src);
      const ex = explainHostedLine(new Analyzer('en'), createUnbashParser().parse(extracted.text), extracted, src.split('\n'), 1, 'en')!;
      return { text: JSON.stringify(ex), kinds: allTokens(ex.items).map((t) => t.kind) };
    };
    for (const [src, kind] of [['all:\n\ttime make\n', 'makefile'], ['all:\n\tuntil false\n', 'makefile'], ['FROM x\nCMD ["time", "make"]\n', 'dockerfile']] as const) {
      const { text, kinds } = types(src, kind);
      assert.ok(!kinds.includes('keyword'), src);
      assert.match(text, /No shell reads these words, so this is the program, not the shell's reserved word|reserved word of the shell, not a command/, src);
    }
    // (With a shell, it is the keyword.)
    assert.ok(types('all:\n\ttime make; true\n').kinds.includes('keyword'));
    // (The program's own words keep their columns.)
    assert.match(types('all:\n\ttime make\n').text, /Measure the run time and resource use of a command/);
  });
});
