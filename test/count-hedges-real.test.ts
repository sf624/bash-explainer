// The hedges of words whose role depends on how many words a variable gives, none or several (src/argv/hedge.ts, the
// `none` reading of an operand; `valueHedges` in src/argv/valuehedges.ts: `none`, `more` and `rest`), compared with bash
// and the real tools. Each variable gives every count from none to four; for each count, the interpreter reads the line
// with the variables' words written out, and the explanation of the line as written must allow the role of every word
// it gives under the conditions it states (`showsRole`, as the renderings check reads hedges). The tool then runs the
// line for real, in a directory of its own, and what it does (the files it reads, the numbers it prints, the archive it
// makes, the directory git changes to) must be what that reading says.
import * as assert from 'assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Analyzer, lookupCommand, type Token } from '../src/analyzer';
import { type ArgRole, interpret, type RoleAt } from '../src/argv/interpret';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { argWords } from './support/argwords';
import { runContained } from './support/contained';
import { allTokens } from './support/explain';
import { showsRole } from './support/renderings';

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
  // (Not run: sudo's `-u` takes the next word as the user, as its manual says; `sudo -u tar -cf x y` runs nothing.)
  { line: 'sudo -u $u tar -cf x y', vars: { $u: ['root', 'p', 'q', 'r'] }, tool: 'sudo', usable: () => true, dry: true, only: ['-u', '$u', 'tar'] },
];

/** The roles of the words of `line`, by word, the name `undefined` (the words of a command run or a subcommand too). */
function rolesOf(tool: string, argv: string[]): (ArgRole | undefined)[] {
  const parse = interpret(lookupCommand(tool)!, argv.map((value) => ({ value })), { name: tool, lookup: lookupCommand });
  const out: (ArgRole | undefined)[] = argv.map(() => undefined);
  const walk = (roles: readonly RoleAt[]): void => {
    for (const { word, role } of roles) {
      out[word] = role;
      if ((role.role === 'subcommand' || role.role === 'command') && role.parse) walk(role.parse.roles);
    }
  };
  walk(parse.roles);
  return out;
}

let dir: string;
before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'count-hedges-real-'));
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('hedges of words that give none or several, compared with bash and the real tools', () => {
  for (const c of CASES) {
    it(c.line, async function () {
      this.timeout(60000);
      if (!c.usable()) this.skip();
      const names = Object.keys(c.vars);
      const { words, texts } = argWords(c.line);
      assert.ok(words.length);
      // (The tokens of each word, by its place in the line.)
      const tokens = allTokens(new Analyzer('en').explainLine(parser.parse(c.line), 0).items);
      let col = c.tool.length + 1;
      const tokensOf = texts.map((t) => {
        const at = c.line.indexOf(t, col);
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
          return `mkdir r${n} && (cd r${n} && ${c.setup ?? ':'} && ${assign} && printf '%s\\n' '${c.stdin ?? ''}' | ${c.line} > ../r${n}.out 2> ../r${n}.err; echo $? > ../r${n}.st${c.tool === 'tar' ? `; for t in x.tar; do [ -f $t ] && echo "$t: $(tar -tf $t | tr '\\n' ' ' | sed 's/ $//')" > ../r${n}.out; done` : ''})`;
        }).join('\n');
        const cwd = fs.mkdtempSync(path.join(dir, 'run-'));
        await runContained(['bash', '--norc', '-c', script], cwd, { PATH: process.env.PATH }, 50000);
        vectors.forEach((_, n) => {
          const read = (ext: string): string => fs.readFileSync(path.join(cwd, `r${n}.${ext}`), 'utf8');
          runs.set(n, { status: Number(read('st')), out: read('out'), err: read('err') });
        });
      }
      vectors.forEach((v, n) => {
        const counts = new Map(names.map((x, j) => [x, v[j]]));
        const parts = texts.map((t) => (counts.has(t) ? c.vars[t].slice(0, counts.get(t)) : [t]));
        const argv = parts.flat();
        const roles = rolesOf(c.tool, argv);
        const where = `${c.line} with ${names.map((x) => `${x}=${counts.get(x)}`).join(', ')}`;
        let k = 0;
        parts.forEach((fields, w) => fields.forEach((field, at) => {
          const role = roles[k++]!;
          if (c.only && !c.only.includes(texts[w])) return;
          const ok = showsRole(role, tokensOf[w] as Token[], { text: field, at, of: fields.length, counts }, operands);
          assert.notStrictEqual(ok, false, `${where}: \`${field}\` of \`${texts[w]}\` is ${JSON.stringify(role.role === 'operand' ? role.spec?.text.en : role.role === 'value' ? `value of ${role.of}` : role.role)}; shown: ${JSON.stringify(tokensOf[w].map((t) => t.explanation))}`);
        }));
        if (c.dry) return;
        const run = runs.get(n)!;
        assert.strictEqual(c.seen!(run), c.expect!(argv, roles), `${where}: ${argv.join(' ')}: ${run.err}`);
      });
    });
  }
});
