// The hedges of words whose role depends on how many words a variable gives, none or several (an operand's readings,
// src/argv/profiles.ts; `valueHedges` in src/argv/valuehedges.ts: `none`, `more` and `rest`), compared with bash
// and the real tools. Each variable gives every count from none to four; for each count, the interpreter reads the line
// with the variables' words written out, and the explanation of the line as written must allow the role of every word
// it gives under the conditions it states (`showsRole`, as the renderings check reads hedges). The tool then runs the
// line for real, in a directory of its own, and what it does (the files it reads, the numbers it prints, the archive it
// makes, the directory git changes to) must be what that reading says. The cases of docs/design/count-hedges.md 1.2, where
// today's hedges contradict the tool, are listed in test/fixtures/count-hedges-known.json (below); the test fails on a
// contradiction not listed, and on an entry that covers counts where the explanation is right.
import * as assert from 'assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Analyzer, lookupCommand, type Token } from '../src/analyzer';
import { type ArgRole, interpret, type RoleAt } from '../src/argv/interpret';
import { outcomeOf } from '../src/argv/readings';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { argWords } from './support/argwords';
import { runContained } from './support/contained';
import { allTokens } from './support/explain';
import { saysOperand, showsRole } from './support/renderings';

const parser = createUnbashParser();
const has = (tool: string): boolean => spawnSync('bash', ['--norc', '-c', `command -v ${tool}`]).status === 0;
const gnu = (tool: string): boolean => has(tool) && /GNU/.test(spawnSync(tool, ['--version'], { encoding: 'utf8' }).stdout ?? '');

/** What a run did: its status, its output and its errors. */
interface Run { status: number; out: string; err: string }

/**
 * A line with variables, the words each gives (as many as its count), the files of its directory and its stdin, and
 * what the tool does with the words it reads, as the interpreter's roles of them say (`expect`, from the words and their
 * roles), compared with what it did (`seen`). The roles are by word, `undefined` for the name.
 */
interface Case {
  line: string;
  vars: Record<string, string[]>;
  tool: string;
  usable: () => boolean;
  setup?: string;
  stdin?: string;
  /** Not run: only the explanation is compared with the interpreter's reading (sudo). */
  dry?: true;
  /** The line runs the program of the command's name (`/usr/bin/echo`), not the builtin: the spec is its `program`. */
  program?: true;
  /** A script run in the directory after the line, whose output is then what the run saw (the files `cp` made). */
  after?: string;
  /**
   * The words compared, where not all: the words a command run or a subcommand reads after it are read as a whole by
   * another command when the word before it gives none or several (`sudo -u root p tar -cf x y` runs `p`), which their
   * tokens do not say (the token of the command or the subcommand, and of the value, do).
   */
  only?: string[];
  expect?: (argv: string[], roles: (ArgRole | undefined)[]) => string;
  seen?: (r: Run) => string;
}

/** The text of an operand's role, `''` for another role. */
const op = (r: ArgRole | undefined): string => (r?.role === 'operand' ? r.spec?.text.en ?? 'operand' : '');
/** The files a tool read, as `name` in its output: their contents are `F-name`. */
const filesIn = (out: string): string => [...new Set([...out.matchAll(/F-([\w.]+)/g)].map((m) => m[1]))].sort().join(' ');
const FILES = 'for f in f g1 g2 g3; do echo "F-$f" > $f; done';

/** seq's numbers, from its first, increment and last; a refusal where it refuses the words. */
function seqOf(argv: string[], roles: (ArgRole | undefined)[]): string {
  const ops = roles.map(op);
  if (ops.some((o) => o.startsWith('extra operand'))) return 'refused';
  if (!ops.some(Boolean)) return 'refused';
  const n = (re: RegExp, d: number): number => Number(argv[ops.findIndex((o) => re.test(o))] ?? d);
  const [first, step, last] = [n(/^first/, 1), n(/^increment/, 1), n(/^last/, NaN)];
  const out: number[] = [];
  for (let x = first; x <= last; x += step) out.push(x);
  return out.join(' ');
}

/** tr's output of `abcdwxyz`: each source character becomes the target one; a refusal where it refuses the words. */
function trOf(argv: string[], roles: (ArgRole | undefined)[]): string {
  const ops = roles.map(op);
  const from = argv[ops.findIndex((o) => o.startsWith('source'))];
  const to = argv[ops.findIndex((o) => o.startsWith('target'))];
  if (ops.some((o) => o.startsWith('extra operand')) || from === undefined || to === undefined) return 'refused';
  return [...'abcdwxyz'].map((c) => (c === from ? to : c)).join('');
}

/** The files a tool that reads its file operands reads (stdin where it has none); a refusal where its value is not one. */
const readsFiles = (valueOk: (v: string) => boolean) => (argv: string[], roles: (ArgRole | undefined)[]): string => {
  const value = roles.findIndex((r) => r?.role === 'value');
  if (value < 0 || !valueOk(argv[value])) return 'refused';
  const files = argv.filter((_, i) => op(roles[i]));
  return files.length ? [...new Set(files)].sort().join(' ') : 'stdin';
};

/** Whether the word has the option `flag` as its role. */
const isOption = (r: ArgRole | undefined, flag: string): boolean => r?.role === 'option' && r.flag === flag;
/** The words that are operands (any operand role, whatever the spec calls it). */
const operandsOf = (argv: string[], roles: (ArgRole | undefined)[]): string[] => argv.filter((_, i) => roles[i]?.role === 'operand');
/** The word that is the value of the option `flag`. */
const valueOf = (argv: string[], roles: (ArgRole | undefined)[], flag: string): string | undefined => argv[roles.findIndex((r) => r?.role === 'value' && r.of === flag)];

/**
 * jq's output on the files `"F1"`… (each holds the string `"F"`) and stdin (`"S"`): `--arg` takes two words, the filter
 * is `.` or a string, which it prints once per input; a file that is not one of ours, or a filter that is not, is a
 * refusal. With no filter, jq reads `.`; with no file, stdin.
 */
function jqOf(argv: string[], roles: (ArgRole | undefined)[]): string {
  if (roles.some((r) => r?.role === 'option' && r.missing)) return 'refused';
  const filter = roles.findIndex((r) => op(r).startsWith('jq filter'));
  const files = argv.filter((_, i) => op(roles[i]).startsWith('input JSON file'));
  if ((filter >= 0 && !/^("[^"]*"|\.)$/.test(argv[filter])) || files.some((f) => !f.startsWith('"'))) return 'refused';
  const program = filter < 0 ? '.' : argv[filter];
  return (files.length ? files.map(() => '"F"') : ['"S"']).map((input) => (program === '.' ? input : program)).join(' ');
}

/** cut's output of the files and stdin (`F-name`), a refusal where `-d` is not one character or `-f` not a list. */
function cutOf(argv: string[], roles: (ArgRole | undefined)[]): string {
  const [d, f] = [valueOf(argv, roles, '-d'), valueOf(argv, roles, '-f')];
  if (d === undefined || f === undefined || d.length !== 1 || !/^[\d,-]+$/.test(f)) return 'refused';
  const files = operandsOf(argv, roles);
  return files.length ? [...new Set(files)].sort().join(' ') : 'stdin';
}

/** The files `cp -t DIR sources` copied into the directories D, E, F and G of its directory, as `dir/name`. */
function cpOf(argv: string[], roles: (ArgRole | undefined)[]): string {
  const dir = valueOf(argv, roles, '-t');
  if (dir === undefined || !['D', 'E', 'F', 'G'].includes(dir)) return '';
  // (A directory as a source is omitted: `cp` copies no directory without `-r`.)
  return operandsOf(argv, roles).filter((s) => /^(s\d|b)$/.test(s)).map((s) => `${dir}/${s}`).sort().join(' ');
}

/** The lines of the file `f` (`a`, `--`, `b`) that `grep -e PATTERN` prints, with the name of `f` when it reads several files. */
function grepOf(argv: string[], roles: (ArgRole | undefined)[]): string {
  const pattern = valueOf(argv, roles, '-e');
  const files = operandsOf(argv, roles);
  if (pattern === undefined || !files.includes('f')) return 'refused';
  const invert = roles.some((r) => isOption(r, '-v'));
  return ['a', '--', 'b'].filter((l) => l.includes(pattern) !== invert).map((l) => (files.length > 1 ? `f:${l}` : l)).join(' ');
}

/** tr's output of `abcdwxyz-`: translated by two sets, or with `-d` the characters of one deleted; a refusal for the other counts. */
function trDeleteOf(argv: string[], roles: (ArgRole | undefined)[]): string {
  const sets = operandsOf(argv, roles);
  const [from, to] = sets;
  if (roles.some((r) => isOption(r, '-d'))) return sets.length === 1 ? [...'abcdwxyz-'].filter((c) => !from.includes(c)).join('') : 'refused';
  if (sets.length !== 2) return 'refused';
  return [...'abcdwxyz-'].map((c) => (from.includes(c) ? to[Math.min(from.indexOf(c), to.length - 1)] : c)).join('');
}

/** getconf's answer for `-a` (every variable), or for `NAME_MAX` with the path `-a` (a directory made for it: 255). */
function getconfOf(argv: string[], roles: (ArgRole | undefined)[]): string {
  if (roles.some((r) => isOption(r, '-a'))) return 'all';
  const ops = operandsOf(argv, roles);
  return ops.length === 2 && ops[0] === 'NAME_MAX' && ops[1] === '-a' ? '255' : 'refused';
}

/** What echo prints for the words its roles say are text, with the newline unless an option `-n` of it is read. */
function echoOf(argv: string[], roles: (ArgRole | undefined)[], from = 0): string {
  const rest = argv.map((_, i) => i).filter((i) => i >= from);
  if (rest.some((i) => isOption(roles[i], '--version'))) return 'version';
  return rest.filter((i) => roles[i]?.role === 'operand').map((i) => argv[i]).join(' ') + (rest.some((i) => isOption(roles[i], '-n')) ? '' : '\n');
}

/** The files jq reads in the cases (each holds the string `"F"`). */
const JQ_FILES = `for f in '"V1"' '"V2"' '"V3"' '"V4"' '"B"' '"C"' '"D"' '"F1"' '"F2"' '"F3"'; do echo '"F"' > "$f"; done`;

const CASES: Case[] = [
  // (Item 1 of the review of #490: with `a='11 12'` and `b`, `c` empty, `seq 11 12` reads `11` as the first.)
  { line: 'seq $a $b $c', vars: { $a: ['11', '12', '13', '14'], $b: ['1', '2', '3', '4'], $c: ['20', '21', '22', '23'] }, tool: 'seq', usable: () => gnu('seq'),
    expect: seqOf, seen: (r) => (r.status ? 'refused' : r.out.trim().split('\n').filter(Boolean).join(' ')) },
  { line: 'tr $a $b', vars: { $a: ['a', 'b', 'c', 'd'], $b: ['w', 'x', 'y', 'z'] }, tool: 'tr', usable: () => gnu('tr'), stdin: 'abcdwxyz',
    expect: trOf, seen: (r) => (r.status ? 'refused' : r.out.trim()) },
  // (Item 2: a value that gives several words; `head -n f` refuses the number `f`.)
  { line: 'head -n $a f', vars: { $a: ['1', 'g1', 'g2', 'g3'] }, tool: 'head', usable: () => gnu('head'), setup: FILES,
    expect: readsFiles((v) => /^\d+$/.test(v)), seen: (r) => (r.status && !r.out ? 'refused' : filesIn(r.out)) },
  // (cut needs a list: `-f1`; with `$a` empty the delimiter is `f`, and it reads stdin.)
  { line: 'cut -f1 -d $a f', vars: { $a: [':', 'g1', 'g2', 'g3'] }, tool: 'cut', usable: () => gnu('cut'), setup: FILES, stdin: 'F-stdin',
    expect: readsFiles((v) => v.length === 1), seen: (r) => (r.status && !r.out ? 'refused' : filesIn(r.out)) },
  { line: 'grep -H -e $a f', vars: { $a: ['F', 'g1', 'g2', 'g3'] }, tool: 'grep', usable: () => gnu('grep'), setup: FILES, stdin: 'F-stdin-f',
    expect: readsFiles(() => true), seen: (r) => [...new Set(r.out.split('\n').filter(Boolean).map((l) => l.slice(0, l.indexOf(':'))))].map((n) => (n === '(standard input)' ? 'stdin' : n)).sort().join(' ') || 'none' },
  // (The archive is the value of `-f`, the members the other words; with `$a` empty, tar refuses an empty archive `b`.)
  { line: 'tar -cf $a b', vars: { $a: ['x.tar', 'g1', 'g2', 'g3'] }, tool: 'tar', usable: () => gnu('tar'), setup: `${FILES}; echo F-b > b`,
    expect: (argv, roles) => {
      const value = roles.findIndex((r) => r?.role === 'value');
      const members = argv.filter((_, i) => op(roles[i]));
      return members.length ? `${argv[value]}: ${members.join(' ')}` : 'refused';
    },
    seen: (r) => (r.status ? 'refused' : r.out.trim()) },
  // (Item 3: with `$d` empty, git changes to the directory `log`; with two words or more, git reads the second as the
  // command.)
  { line: 'git -C $d log', vars: { $d: ['repo', 'x', 'y', 'z'] }, tool: 'git', usable: () => has('git'),
    setup: 'git init -q repo && git -C repo -c user.name=u -c user.email=u@e commit -q --allow-empty -m first',
    expect: (argv, roles) => {
      const at = argv.indexOf('log');
      if (roles[at]?.role === 'value') return 'cd log';
      return roles[at]?.role === 'subcommand' ? 'logged' : `not a command: ${argv[argv.indexOf('repo') + 1]}`;
    },
    seen: (r) => (/cannot change to 'log'/.test(r.err) ? 'cd log' : /'([^']*)' is not a git command/.exec(r.err) ? `not a command: ${/'([^']*)' is not a git command/.exec(r.err)![1]}` : /^ {4}first$/m.test(r.out) ? 'logged' : r.out) },
  // (Review of #492: an option that takes two words, and a value before a command. `jq --arg x "B" "C" "V" "P"` takes
  // `"B"` as the value, `"C"` as the filter and the files `"V"`, `"P"`; each file holds a string, and the filter, a string
  // too, gives itself once per input; with no filter, jq prints stdin.)
  ...['--arg', '--argjson'].map((option): Case => ({
    line: `jq -c ${option} $n '"V"' '"P"'`, vars: { $n: ['x', option === '--arg' ? '"B"' : '1', '"C"', '"D"'] }, tool: 'jq', usable: () => has('jq'),
    setup: `for f in '"V"' '"P"' '"C"' '"D"'; do echo '"F"' > "$f"; done`, stdin: '"S"',
    expect: (argv, roles) => {
      const filter = roles.findIndex((r) => op(r).startsWith('jq filter'));
      // (No filter: jq reads stdin with `.`, its output not being a terminal.)
      if (filter < 0) return '"S"';
      const files = argv.filter((_, i) => op(roles[i]).startsWith('input JSON file'));
      return Array.from({ length: files.length || 1 }, () => argv[filter]).join(' ');
    },
    seen: (r) => (r.status ? 'refused' : r.out.trim().split('\n').join(' ')),
  })),
  // (`timeout -s KILL 1 echo 5 echo x` runs `echo` with `5 echo x`; with one word, `5` is the time limit.)
  ...[['-s', ['KILL', '1', 'echo', 'y']], ['-k', ['1', '2', 'echo', 'y']]].map(([option, values]): Case => ({
    line: `timeout ${option as string} $s 5 echo x`, vars: { $s: values as string[] }, tool: 'timeout', usable: () => gnu('timeout'),
    expect: (argv, roles) => {
      const limit = roles.findIndex((r) => op(r).startsWith('time limit'));
      const command = roles.findIndex((r) => r?.role === 'command');
      if (limit < 0 || command < 0 || !/^\d+$/.test(argv[limit]) || argv[command] !== 'echo') return 'refused';
      return argv.slice(command + 1).join(' ');
    },
    seen: (r) => (r.status ? 'refused' : r.out.trim()),
  })),
  // (Not run: sudo's `-u` takes the next word as the user, as its manual says; `sudo -u tar -cf x y` runs nothing.)
  { line: 'sudo -u $u tar -cf x y', vars: { $u: ['root', 'p', 'q', 'r'] }, tool: 'sudo', usable: () => true, dry: true, only: ['-u', '$u', 'tar'] },
  // ---- The cases of docs/design/count-hedges.md, 1.2: the explanation reads one word's count at a time, and the options once.
  // (Two words in a row that may give none, after an option that takes two: `--arg` takes the name and the value, and what
  // is left is the filter and the files. Stdin holds `"S"`, the files `"F"`.)
  { line: 'jq --arg $n $v .', vars: { $n: ['x', '"B"', '"C"', '"D"'], $v: ['"V1"', '"V2"', '"V3"', '"V4"'] }, tool: 'jq', usable: () => has('jq'),
    setup: JQ_FILES, stdin: '"S"', expect: jqOf, seen: (r) => (r.status ? 'refused' : r.out.trim().split('\n').join(' ')) },
  // (The same, with a known word between; with `$n` empty, `v` is the name and the first word of `$f` the value.)
  { line: 'jq --arg $n v $f', vars: { $n: ['x', '"B"', '"C"', '"D"'], $f: ['.', '"F1"', '"F2"', '"F3"'] }, tool: 'jq', usable: () => has('jq'),
    setup: JQ_FILES, stdin: '"S"', expect: jqOf, seen: (r) => (r.status ? 'refused' : r.out.trim().split('\n').join(' ')) },
  // (Two values, a known option between: with `$a` empty `-f` is the delimiter, which cut refuses; `-f` needs a list.)
  { line: 'cut -d $a -f $b f', vars: { $a: [':', 'g1', 'g2', 'g3'], $b: ['1', 'g1', 'g2', 'g3'] }, tool: 'cut', usable: () => gnu('cut'), setup: FILES, stdin: 'F-stdin',
    expect: cutOf, seen: (r) => (r.status && !r.out ? 'refused' : filesIn(r.out)) },
  // (A value and an operand in a row, both may give none: with both empty, `b` is the directory; `cp` then refuses.
  // What was copied into the directories D to G is what a run saw.)
  { line: 'cp -t $d $a b', vars: { $d: ['D', 'E', 'F', 'G'], $a: ['s1', 's2', 's3', 's4'] }, tool: 'cp', usable: () => gnu('cp'),
    setup: 'mkdir D E F G; for f in s1 s2 s3 s4 b; do echo "F-$f" > $f; done',
    after: "find D E F G -type f | sort | tr '\\n' ' ' | sed 's/ $//'", expect: cpOf, seen: (r) => r.out.trim() },
  // (A word that becomes an option: with `$p` empty, `-e` takes `--`, and `-v` is the option. The file holds `a`, `--`, `b`.)
  { line: 'grep -e $p -- -v f', vars: { $p: ['a', 'b', 'c', 'd'] }, tool: 'grep', usable: () => gnu('grep'), setup: "printf 'a\\n--\\nb\\n' > f",
    expect: grepOf, seen: (r) => r.out.trim().split('\n').filter(Boolean).join(' ') || (r.status > 1 ? 'refused' : '') },
  // (`optionsFirst`: the options end at the first operand. With `$a` empty `-d` is the option; with a word, the second set.)
  { line: 'tr $a -d', vars: { $a: ['a', 'b', 'c', 'd'] }, tool: 'tr', usable: () => gnu('tr'), stdin: 'abcdwxyz-',
    expect: trDeleteOf, seen: (r) => (r.status ? 'refused' : r.out.trim()) },
  // (`getconf NAME_MAX -a` asks the path `-a`: a directory of that name answers `255`.)
  { line: 'getconf $a -a', vars: { $a: ['NAME_MAX', 'PAGESIZE', '/', 'x'] }, tool: 'getconf', usable: () => has('getconf') && /glibc/i.test(spawnSync('getconf', ['--version'], { encoding: 'utf8' }).stdout ?? ''), setup: 'mkdir -- -a',
    expect: getconfOf, seen: (r) => (r.status ? 'refused' : r.out.trim().split('\n').length > 50 ? 'all' : r.out.trim()) },
  // (The builtin, through bash: `echo -n x` prints `x` with no newline. What it prints is the run's output, the newline too.)
  { line: 'echo $a -n x', vars: { $a: ['y', 'z', 'w', 'v'] }, tool: 'echo', usable: () => true,
    expect: (argv, roles) => echoOf(argv, roles), seen: (r) => r.out },
  // (coreutils echo, by its path: `--version` only as the one argument.)
  { line: '/usr/bin/echo $a --version', vars: { $a: ['y', 'z', 'w', 'v'] }, tool: 'echo', program: true, usable: () => gnu('/usr/bin/echo'),
    expect: (argv, roles) => echoOf(argv, roles), seen: (r) => (/^echo \(GNU coreutils\)/.test(r.out) ? 'version' : r.out) },
  // (A word that may give none in a command slot: with `$a` empty, nice reads `-n 5` itself and runs `ls`; with `echo`, it
  // is echo's option and text. `ls` lists the one file `f` made.)
  { line: 'nice $a -n 5 ls', vars: { $a: ['echo', 'y', 'z', 'w'] }, tool: 'nice', usable: () => gnu('nice'), setup: 'echo F > f',
    expect: (argv, roles) => {
      const command = roles.findIndex((r) => r?.role === 'command');
      return argv[command] === 'ls' ? 'f\n' : echoOf(argv, roles, command + 1);
    },
    seen: (r) => r.out },
  // (Two commands run: with `$a` empty, `-n 5 ls` is the inner nice's; the dump shows it under `$a`, one level down.)
  { line: 'timeout 5 nice $a -n 5 ls', vars: { $a: ['echo', 'y', 'z', 'w'] }, tool: 'timeout', usable: () => gnu('timeout') && gnu('nice'), setup: 'echo F > f',
    expect: (argv, roles) => {
      const command = roles.findIndex((r, i) => r?.role === 'command' && argv[i] === 'ls');
      return command >= 0 ? 'f\n' : echoOf(argv, roles, roles.findIndex((r, i) => r?.role === 'command' && argv[i] === 'echo') + 1);
    },
    seen: (r) => r.out },
  { line: 'nice nice $a -n 5 ls', vars: { $a: ['echo', 'y', 'z', 'w'] }, tool: 'nice', usable: () => gnu('nice'), setup: 'echo F > f',
    expect: (argv, roles) => {
      const command = roles.findIndex((r, i) => r?.role === 'command' && argv[i] === 'ls');
      return command >= 0 ? 'f\n' : echoOf(argv, roles, roles.findIndex((r, i) => r?.role === 'command' && argv[i] === 'echo') + 1);
    },
    seen: (r) => r.out },
];

/**
 * The roles of the words of `line`, by word, the name `undefined` (the words of a command run or a subcommand too).
 * `refused`: the interpreter knows that the tool refuses the words (an option's value no word gives, operands no form
 * fits), where the readings say nothing (docs/design/count-hedges.md, 2.5).
 */
function rolesOf(tool: string, argv: string[], program = false, owner: number[] = [], refused: { at?: boolean } = {}): (ArgRole | undefined)[] {
  const spec = lookupCommand(tool)!;
  const parse = interpret(program ? spec.program! : spec, argv.map((value) => ({ value })), { name: tool, lookup: lookupCommand });
  refused.at = outcomeOf(parse) === 'refused';
  const out: (ArgRole | undefined)[] = argv.map(() => undefined);
  // (`owner`: the word of the command run that reads the word, -1 for the line's own command; a subcommand reads as its command does.)
  const walk = (roles: readonly RoleAt[], by: number): void => {
    for (const { word, role } of roles) {
      out[word] = role;
      owner[word] = by;
      if ((role.role === 'subcommand' || role.role === 'command') && role.parse) walk(role.parse.roles, role.role === 'command' ? word : by);
    }
  };
  walk(parse.roles, -1);
  return out;
}

let dir: string;
before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'count-hedges-real-'));
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));

/**
 * The words whose explanation contradicts the tool today (test/fixtures/count-hedges-known.json): the line, the word,
 * the counts of the variables the entry holds for (a count not named is any; a list is any of them), and why, with the
 * step of docs/design/count-hedges.md that fixes it. A contradiction no entry covers fails the test, and so does an
 * entry that covers counts where the explanation is right (a stale entry).
 */
interface Known { line: string; word: string; counts: Record<string, number | number[]>; reason: string }
const known: Known[] = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/count-hedges-known.json'), 'utf8'));
/** Whether an entry holds for the counts of one run. */
const meets = (k: Known, counts: Map<string, number>): boolean =>
  Object.entries(k.counts).every(([x, n]) => (Array.isArray(n) ? n.includes(counts.get(x)!) : n === counts.get(x)));
const show = (counts: Map<string, number>): string => [...counts].map(([x, n]) => `${x}=${n}`).join(', ');

describe('hedges of words that give none or several, compared with bash and the real tools', () => {
  for (const c of CASES) {
    it(c.line, async function () {
      this.timeout(60000);
      if (!c.usable()) this.skip();
      const names = Object.keys(c.vars);
      const { words, texts } = argWords(c.line);
      assert.ok(words.length);
      // (The tokens of each word, by its place in the line.)
      const items = new Analyzer('en').explainLine(parser.parse(c.line), 0).items;
      const tokens = allTokens(items);
      // (The command run a token lies under, the nearest one (`nice $a -n 5 ls` shows `-n` under `$a`), the line's own command left out.)
      const runOf = new Map<Token, Token | undefined>();
      const mark = (ts: readonly Token[], run: Token | undefined): void => ts.forEach((t) => { runOf.set(t, run); mark(t.children, t.kind === 'command' ? t : run); });
      items.forEach((t) => { runOf.set(t, undefined); mark(t.children, undefined); });
      let col = c.line.indexOf(' ') + 1;
      // (The column of each word of the line, to tell which word a command run token is.)
      const starts: number[] = [];
      const tokensOf = texts.map((t) => {
        const at = c.line.indexOf(t, col);
        starts.push(at);
        col = at + t.length;
        return tokens.filter((x) => x.span.start.character === at && x.span.end.character === at + t.length && ['argument', 'option', 'subcommand', 'command'].includes(x.kind));
      });
      const operands = [...new Set((lookupCommand(c.tool)!.operands ?? []).flatMap((a) => a.pattern.map((o) => o.text.en)))];
      const vectors = names.reduce<number[][]>((all) => all.flatMap((v) => [0, 1, 2, 3, 4].map((n) => [...v, n])), [[]]);
      const runs = new Map<number, Run>();
      if (!c.dry) {
        // (One script for every count, run once in a cgroup: each count in a directory of its own.)
        const script = vectors.map((v, n) => {
          const assign = names.map((x, j) => `${x.slice(1)}='${c.vars[x].slice(0, v[j]).join(' ')}'`).join('; ');
          const after = c.after ? `; ${c.after} > ../r${n}.out 2>> ../r${n}.err` : '';
          return `mkdir r${n} && (cd r${n} && ${c.setup ?? ':'} && ${assign} && printf '%s\\n' '${c.stdin ?? ''}' | ${c.line} > ../r${n}.out 2> ../r${n}.err; echo $? > ../r${n}.st${after}${c.tool === 'tar' ? `; for t in x.tar; do [ -f $t ] && echo "$t: $(tar -tf $t | tr '\\n' ' ' | sed 's/ $//')" > ../r${n}.out; done` : ''})`;
        }).join('\n');
        const cwd = fs.mkdtempSync(path.join(dir, 'run-'));
        await runContained(['bash', '--norc', '-c', script], cwd, { PATH: process.env.PATH }, 50000);
        vectors.forEach((_, n) => {
          const read = (ext: string): string => fs.readFileSync(path.join(cwd, `r${n}.${ext}`), 'utf8');
          runs.set(n, { status: Number(read('st')), out: read('out'), err: read('err') });
        });
      }
      // (The words whose tokens contradict a role the tool gave them, by word and counts.)
      const contradicted = new Set<string>();
      const fresh: string[] = [];
      const mine = known.filter((k) => k.line === c.line);
      vectors.forEach((v, n) => {
        const counts = new Map(names.map((x, j) => [x, v[j]]));
        // (A word written out is its text after quote removal: `'"V"'` is `"V"`.)
        const parts = texts.map((t, w) => (counts.has(t) ? c.vars[t].slice(0, counts.get(t)) : [words[w].value ?? t]));
        const argv = parts.flat();
        const owner: number[] = [];
        const refused: { at?: boolean } = {};
        const roles = rolesOf(c.tool, argv, c.program, owner, refused);
        // (The word of the line each word of the argv is a field of.)
        const wordOf = parts.flatMap((fields, w) => fields.map(() => w));
        const where = `${c.line} with ${show(counts)}`;
        let k = 0;
        parts.forEach((fields, w) => fields.forEach((field, at) => {
          const role = roles[k++]!;
          if ((c.only && !c.only.includes(texts[w])) || refused.at) return;
          // (The command run a word is shown under, and the one that reads it. If another command reads it, that is wrong; if the
          // same, a token that names no role, "Word `5`", is a role missing, not one that contradicts. A word shown under a command run that does not read it
          // is wrong whatever its token says: `timeout -s $s 5 echo x` with `$s` of three words runs the third, and `x` is not echo's text.)
          const shown = tokensOf[w] as Token[];
          const under = new Set(shown.map((t) => { const r = runOf.get(t); return r ? starts.indexOf(r.span.start.character) : -1; }));
          const shownUnder = under.size === 1 ? [...under][0] : -2;
          const readBy = owner[k - 1] < 0 ? -1 : wordOf[owner[k - 1]];
          const generic = shown.every((t) => /^(Word `|Looks like an option; which command reads it)/.test(t.explanation));
          if (shownUnder !== -1 && shownUnder === readBy && generic) return;
          // (Where the tool refuses the words, which command reads which is moot: section 2.5 of the design gives a refused shape no clause.)
          const foreign = shown.length > 0 && shownUnder !== readBy && shownUnder !== -1 && (c.dry || c.seen!(runs.get(n)!) !== 'refused');
          if (!foreign && showsRole(role, shown, { text: field, at, of: fields.length, counts }, operands) !== false) return;
          contradicted.add(`${texts[w]} ${show(counts)}`);
          if (!mine.some((e) => e.word === texts[w] && meets(e, counts))) fresh.push(`${where}: \`${field}\` of \`${texts[w]}\` is ${JSON.stringify(role.role === 'operand' ? role.spec?.text.en : role.role === 'value' ? `value of ${role.of}` : role.role === 'option' ? `option ${role.flag}` : role.role)}; shown: ${JSON.stringify(tokensOf[w].map((t) => t.explanation))}`);
        }));
        if (c.dry) return;
        const run = runs.get(n)!;
        assert.strictEqual(c.seen!(run), c.expect!(argv, roles), `${where}: ${argv.join(' ')}: ${run.err}`);
      });
      // (An entry that names a variable the line lacks, or counts no run has, or that another entry repeats, is dead.)
      const covers = (e: Known) => vectors.map((v) => new Map(names.map((x, j) => [x, v[j]]))).filter((counts) => meets(e, counts));
      const dead = mine.flatMap((e, i) => [
        ...Object.keys(e.counts).filter((x) => !names.includes(x)).map((x) => `dead: ${JSON.stringify(e.word)} names ${x}, not a variable of ${c.line}`),
        ...(covers(e).length ? [] : [`dead: ${JSON.stringify(e)} matches no run`]),
        ...(texts.includes(e.word) ? [] : [`dead: ${JSON.stringify(e.word)} is no word of ${c.line}`]),
        ...mine.slice(0, i).filter((o) => o.word === e.word && covers(o).some((counts) => meets(e, counts))).map(() => `dead: ${JSON.stringify(e.word)} of ${c.line} is listed twice for the same counts`),
      ]);
      // (An entry that covers counts where the explanation is right is stale.)
      const stale = mine.flatMap((e) => vectors
        .map((v) => new Map(names.map((x, j) => [x, v[j]])))
        .filter((counts) => meets(e, counts) && !contradicted.has(`${e.word} ${show(counts)}`))
        .map((counts) => `stale: \`${e.word}\` of ${c.line} with ${show(counts)} is explained right now`));
      assert.deepStrictEqual([...dead, ...fresh, ...stale], []);
    });
  }

  it('lists no entry of a line that is not a case', () => {
    assert.deepStrictEqual(known.filter((k) => !CASES.some((c) => c.line === k.line)).map((k) => k.line), []);
  });
});

describe('the readings of the cases, in Japanese (docs/japanese-style.md)', () => {
  /** The explanation of the token of `word` (its last occurrence) in `line`, in Japanese. */
  const said = (line: string, word: string): string | undefined => {
    const col = line.lastIndexOf(word);
    return allTokens(new Analyzer('ja').explainLine(parser.parse(line), 0).items).find((t) => t.span.start.character === col && t.label === word)?.explanation;
  };
  it('says a sum, two atoms, two conditions, a profile by place and a folded text as the English does', () => {
    const extra = '余分なオペランド（コマンドは受け付けず、`extra operand` と表示して何もせずに終了ステータス 1 で終わる）';
    assert.deepStrictEqual([
      said('cp -t $d $a b', 'b'), said('cut -d $a -f $b f', 'f'), said('jq --arg $n $v .', '.'), said('grep -e $p -- -v f', '-v'),
      said('echo $a -n x', '-n'), said('jq --arg $n v $f', '$f'), said('grep -m $n -c $x f', 'f'), said('seq $a x $b', 'x'),
    ], [
      'コピー元。`$d`・`$a` が0語なら `-t` オプションの値',
      '対象のファイル。`$a` が1語以上で `$b` が0語なら `-f` オプションの値',
      'jq フィルタ（例: `.items[].name`）。`$n`・`$v` が合わせて1語なら `--arg` の値。`$n`・`$v` が合わせて3語以上なら入力 JSON ファイル',
      '検索対象のファイル（省略時は標準入力）。`$p` が0語ならオプション `-v`（一致しない行を表示する）',
      '表示する文字列。`$a` が0語ならオプション `-n`（末尾の改行を出力しない）',
      'jq フィルタ（例: `.items[].name`）、`$f` が2語以上に展開されるなら、これは最初の語の役割で、残りの各語は入力 JSON ファイル。`$n` が0語なら順に `--arg` の値・jq フィルタ（例: `.items[].name`）・入力 JSON ファイル。`$n` が2語以上なら入力 JSON ファイル',
      '検索対象のファイル（省略時は標準入力）。`$n` が0語で `$x` が0語、または `$n` が1語で `$x` が0語なら検索パターン（正規表現）',
      `増分。\`$a\`・\`$b\` が展開される語数により、終了値（開始値は 1）・開始値・${extra}のどれかにもなる`,
    ]);
    // (A role another command reads names it: with `$a` empty, nice reads `5` as the value of its `-n`.)
    assert.strictEqual(said('nice $a -n 5 ls', '5'), '文字列 `5`。`$a` が0語なら `nice` の `-n` オプションの値');
  });
});

describe('the checker reads the clauses of the readings', () => {
  const place = (counts: [string, number][], at = 0, of = 1) => ({ text: 'x', at, of, counts: new Map(counts) });
  // (A role text may hold a condition itself: "it is B — C when it expands to 2 words" is the clause B, with its comment.)
  it('reads the clause whose conditions hold, whatever its role text says', () => {
    const e = 'A. When `$a` expands to 2 words or more, it is B — C when it expands to 2 words';
    assert.deepStrictEqual([1, 3].map((n) => ['A', 'B', 'C'].filter((x) => saysOperand(e, [x], place([['$a', n]])))), [['A'], ['B', 'C']]);
  });
  it('reads sums, two atoms and two conditions', () => {
    const e = 'T. When `$n` and `$v` expand to one word in all, it is V. When `$b` expands to nothing and `$a` to a word or more, it is W. When `$c` expands to 3 words, or when `$c` expands to nothing, it is Z';
    const at = (n: number, v: number, a: number, b: number, c = 1) => ['T', 'V', 'W', 'Z'].filter((x) => saysOperand(e, [x], place([['$n', n], ['$v', v], ['$a', a], ['$b', b], ['$c', c]]))).join();
    assert.deepStrictEqual([at(1, 0, 1, 1), at(1, 1, 1, 1), at(2, 2, 2, 0), at(2, 2, 0, 0), at(2, 2, 1, 1, 3), at(2, 2, 1, 1, 0)], ['V', 'T', 'W', 'T', 'Z', 'Z']);
    // (A word the condition names with no count: a text the checker cannot read, a finding.)
    assert.strictEqual(saysOperand(e, ['T'], place([['$n', 1]])), false);
  });
  it('reads profiles by place and by own count, the folded text and the text past the cap', () => {
    const byPlace = 'A; when `$a` expands to several words, this is its first word, and the others are B, then C. When `$b` expands to nothing, its words are D, then E';
    const p = (at: number, b: number) => ['A', 'B', 'C', 'D', 'E'].filter((x) => saysOperand(byPlace, [x], place([['$b', b]], at, 4))).join();
    assert.deepStrictEqual([p(0, 1), p(1, 1), p(2, 1), p(0, 0), p(3, 0)], ['A', 'B', 'B,C', 'D', 'D,E']);
    const byCount = 'S when `$a` expands to a single word; when it expands to 2 words, they are S, then D; when it expands to more words, they are S, then R';
    const c = (at: number, of: number) => ['S', 'D', 'R'].filter((x) => saysOperand(byCount, [x], place([], at, of))).join();
    assert.deepStrictEqual([c(0, 1), c(1, 2), c(2, 3), c(1, 3)], ['S', 'D', 'R', 'S,R']);
    const folded = 'A. It can also be B or C, by how many words `$a` and `$b` give';
    assert.deepStrictEqual(['A', 'B', 'C', 'D'].map((x) => saysOperand(folded, [x], place([]))), [true, true, true, false]);
    // (Past the cap, another role is not said: a missing explanation.)
    const depends = 'A. Its role may depend on how many words `$a` and `$b` give';
    assert.deepStrictEqual(['A', 'B'].map((x) => saysOperand(depends, [x], place([]))), [true, undefined]);
  });
});
