// The commands with old-style letters and modes, compared with the real tools: the options and their
// values that `tar --help` and `ar --help` list, the archive and the members tar and ar act on, the BSD
// letters ps reads in any place, and the `-f=FORMAT` of dpkg-query. Tools that are missing are skipped.
import * as assert from 'assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { lookupCommand } from '../src/analyzer';
import { ArgRole, ArgvParse, interpret } from '../src/argv/interpret';
import type { OptionSpec } from '../src/argv/spec';
import { argWords } from './support/argwords';

const has = (tool: string): boolean => spawnSync('bash', ['--norc', '-c', `command -v ${tool}`]).status === 0;
const ENV = { ...process.env, LC_ALL: 'C', TZ: 'UTC', COLUMNS: '200' };
/** The builds whose options the tests follow (`--version` says which); a BSD or macOS build is skipped. */
const BUILDS: Record<string, RegExp> = { tar: /GNU tar/, ar: /GNU ar/, ps: /procps/ };
const usable = (tool: string): boolean => has(tool) && BUILDS[tool].test(spawnSync(tool, ['--version'], { env: ENV, encoding: 'utf8' }).stdout ?? '');
/** Runs a line of bash in `cwd`. */
const run = (line: string, cwd: string): { out: string; err: string; status: number | null } => {
  const r = spawnSync('bash', ['--norc', '-c', line], { cwd, env: ENV, encoding: 'utf8', timeout: 60000 });
  return { out: r.stdout, err: r.stderr, status: r.status };
};
const parseOf = (line: string): { parse: ArgvParse; words: string[] } => {
  const { name, words, texts } = argWords(line);
  return { parse: interpret(lookupCommand(name)!, words, { name, lookup: lookupCommand }), words: words.map((w, i) => w.value ?? texts[i]) };
};
/** The words the interpreter gives a role that `pick` accepts. */
const wordsWith = (line: string, pick: (r: ArgRole) => boolean): string[] => {
  const { parse, words } = parseOf(line);
  return parse.roles.flatMap(({ word, role }) => (pick(role) ? [words[word]] : []));
};
const valueOf = (names: string[]) => (r: ArgRole): boolean => r.role === 'value' && names.includes(r.of);
const operand = (r: ArgRole): boolean => r.role === 'operand';
/** The letters of the old-style words of a line, as the interpreter reads them. */
const letters = (line: string): string[] =>
  parseOf(line).parse.roles.flatMap(({ role }) => (role.role === 'old-style' ? role.letters.map((l) => (l as { flag: string }).flag) : []));

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oldstyle-real-'));
  fs.mkdirSync(path.join(dir, 'src/sub'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src/a.txt'), 'a\n');
  fs.writeFileSync(path.join(dir, 'src/sub/b.txt'), 'b\n');
  fs.writeFileSync(path.join(dir, 'c.txt'), 'c\n');
  fs.writeFileSync(path.join(dir, 'list'), 'src/a.txt\n');
  return dir;
}

/** The options a `--help` lists (`-f, --file=ARCHIVE`): whether each takes a value, needs one or may have one. */
function helpOptions(text: string): Map<string, 'none' | 'required' | 'optional'> {
  const out = new Map<string, 'none' | 'required' | 'optional'>();
  for (const line of text.split('\n')) {
    // (The names are words of a dash joined by `, `; a long name may fill its column, with one space after it.)
    const head = /^\s+(-[^\s,]+(?:, -[^\s,]+)*)/.exec(line);
    if (!head) continue;
    const names = head[1].split(/,\s*/);
    const last = names[names.length - 1];
    const arity = last.includes('[=') ? 'optional' : last.includes('=') ? 'required' : 'none';
    for (const n of names) out.set(n.replace(/[[=].*$/, ''), arity);
  }
  return out;
}
const arityOf = (o: OptionSpec): string => (!o.value ? 'none' : !Array.isArray(o.value) && o.value.optional ? 'optional' : 'required');

describe('tar agrees with the real tar', () => {
  (usable('tar') ? it : it.skip)('every option is one tar lists, and takes a value when tar\'s does', () => {
    const help = helpOptions(spawnSync('tar', ['--help'], { env: ENV, encoding: 'utf8' }).stdout);
    for (const o of lookupCommand('tar')!.options!) for (const n of o.names) assert.strictEqual(arityOf(o), help.get(n), n);
  });

  // Each line names its archive with `f` (or `-f`, `--file`); the members tar lists or stores are the operands.
  const ROWS = [
    'tar tf a.tar src/a.txt',
    'tar -tf a.tar src/sub',
    'tar tbf 20 a.tar src/a.txt',
    'tar tfb a.tar 20 src/a.txt',
    'tar --list --file=a.tar src/a.txt',
    'tar -t --file a.tar -N 2000-01-01 src/sub/b.txt',
    'tar cf b.tar src/a.txt',
    'tar cfC b.tar src a.txt',
    'tar cCf src b.tar sub',
    'tar -cf b.tar --exclude=b.txt src',
    'tar cf b.tar -T list c.txt',
    'tar cf b.tar --owner root --group=0 src/a.txt',
    'tar cgf snap b.tar src/a.txt',
    'tar --totals=USR1 -cf b.tar src/a.txt',
    'tar cf b.tar --totals c.txt',
    'tar cvhf b.tar --no-recursion src',
    'tar -cf b.tar -I gzip c.txt',
  ];
  (usable('tar') ? it : it.skip)('acts on the archive and the members the interpreter names', () => {
    for (const line of ROWS) {
      const dir = tempDir();
      try {
        assert.strictEqual(run('tar cf a.tar src', dir).status, 0);
        const r = run(line, dir);
        assert.strictEqual(r.status, 0, `${line}: ${r.err}`);
        const [archive] = wordsWith(line, valueOf(['f', '-f', '--file']));
        // (The names in the file of `-T` are members too.)
        const listedIn = wordsWith(line, valueOf(['-T'])).flatMap((f) => fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean));
        const members = [...wordsWith(line, operand), ...listedIn];
        const listed = (/^tar (-?t|--list)/.test(line) ? r.out : run(`tar tf ${archive}`, dir).out).split('\n').filter(Boolean);
        // Every name stored or listed is a member or under one; every member is there.
        const under = (n: string): string | undefined => members.find((m) => n === m || n.startsWith(m.replace(/\/?$/, '/')));
        assert.ok(listed.every(under), `${line}: ${listed.join(' ')} for ${members.join(' ')}`);
        assert.ok(members.every((m) => listed.some((n) => under(n) === m)), line);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });
});

describe('ps reads BSD letters in any place, as procps does', () => {
  // [line, the words read as BSD letters, the line with them first, the line without them]: what ps prints
  // first is the same as with the letters first, and not the same as without them.
  const ROWS: [string, string[], string, string][] = [
    ['ps -p 1 u', ['u'], 'ps u -p 1', 'ps -p 1'],
    ['ps -p 1 j', ['j'], 'ps j -p 1', 'ps -p 1'],
    ['ps --pid 1 l', ['l'], 'ps l --pid 1', 'ps --pid 1'],
    ['ps -o pid,comm -p 1 h', ['h'], 'ps h -o pid,comm -p 1', 'ps -o pid,comm -p 1'],
    ['ps -p 1 v', ['v'], 'ps v -p 1', 'ps -p 1'],
    ['ps -p 1 o pid,comm', ['o'], 'ps o pid,comm -p 1', 'ps -p 1'],
  ];
  const first = (line: string): string => run(line, os.tmpdir()).out.split('\n')[0];
  (usable('ps') ? it : it.skip)('reads them as the interpreter does', () => {
    for (const [line, letters, moved, without] of ROWS) {
      assert.deepStrictEqual(wordsWith(line, (r) => r.role === 'old-style'), letters, line);
      assert.strictEqual(first(line), first(moved), line);
      assert.notStrictEqual(first(line), first(without), line);
    }
  });
});

describe('ps: a number after BSD letters is a list of PIDs', () => {
  /** The PIDs ps lists for `line`, from the PID column its header names (the other columns change from run to run). */
  const pids = (line: string): string[] => {
    const lines = run(line, os.tmpdir()).out.split('\n').filter(Boolean);
    const col = lines[0].trim().split(/\s+/).indexOf('PID');
    return col < 0 ? [] : lines.slice(1).map((l) => l.trim().split(/\s+/)[col]);
  };
  // [line, the same with the PIDs in `-p`, the letters of the first word as the interpreter reads them]
  const ROWS: [string, string, string[]][] = [
    ['ps u1', 'ps u -p 1', ['u', '1']],
    ['ps u1,2', 'ps u -p 1,2', ['u', '1,2']],
    ['ps j1', 'ps j -p 1', ['j', '1']],
    ['ps l1', 'ps l -p 1', ['l', '1']],
    ['ps v1', 'ps v -p 1', ['v', '1']],
    ['ps n1', 'ps n -p 1', ['n', '1']],
    ['ps p1', 'ps -p 1', ['p']],
    ['ps p1,2', 'ps -p 1,2', ['p']],
    ['ps u1 2', 'ps u -p 1,2', ['u', '1']],
  ];
  (usable('ps') ? it : it.skip)('lists the PIDs `-p` gives, as the interpreter reads it', () => {
    for (const [line, dashed, flags] of ROWS) {
      assert.deepStrictEqual(letters(line), flags, line);
      assert.ok(pids(line).length >= 1 && !/error/.test(run(line, os.tmpdir()).err), line);
      assert.deepStrictEqual(pids(line), pids(dashed), line);
    }
    // A letter that takes a list reads the number as its value (`t1` is the terminal 1, not the PID 1).
    assert.deepStrictEqual(parseOf('ps t1').parse.roles.map(({ role }) => (role.role === 'old-style' ? role.letters.map((l) => (l as { value?: { attached?: number } }).value?.attached) : [])), [[1]]);
    assert.deepStrictEqual(pids('ps t1'), pids('ps -t 1'));
    assert.deepStrictEqual(pids('ps t1'), pids('ps t 1'));
  });

  // The number must come last in the word; a letter with a value before it takes the rest of the word (`ps op1`).
  (usable('ps') ? it : it.skip)('is an error where the number is not last, which stays a plain word', () => {
    for (const line of ['ps u1x', 'ps 1u', 'ps u1a', 'ps a1p2']) {
      assert.match(run(line, os.tmpdir()).err, /process ID list syntax error/, line);
      assert.deepStrictEqual(letters(line), [], line);
    }
    assert.deepStrictEqual(letters('ps op1'), []);
  });
});

describe('tar reads the first word as letters, whatever they are', () => {
  const failure = (line: string): string => {
    const r = run(line, os.tmpdir());
    return `${r.status} ${r.err.split('\n')[0]}`;
  };
  (usable('tar') ? it : it.skip)('is `tar -vf a.tar` for `tar vf a.tar`, which has no operation', () => {
    for (const [line, dashed, flags] of [['tar vf a.tar', 'tar -vf a.tar', 'v f'], ['tar f a.tar', 'tar -f a.tar', 'f'], ['tar vzf a.tar', 'tar -vzf a.tar', 'v z f']] as const) {
      assert.strictEqual(failure(line), failure(dashed), line);
      assert.match(failure(line), /^2 tar: You must specify one of/, line);
      assert.deepStrictEqual(letters(line), flags.split(' '), line);
      assert.deepStrictEqual(wordsWith(line, valueOf(['f'])), ['a.tar'], line);
    }
    // After the letters come other options, and the operation may be one of them: `tar f a.tar -t` lists a.tar.
    const dir = tempDir();
    try {
      assert.strictEqual(run('tar cf a.tar src', dir).status, 0);
      assert.strictEqual(run('tar f a.tar -t', dir).out, run('tar -tf a.tar', dir).out);
      assert.strictEqual(run('tar f a.tar -t', dir).status, 0);
      assert.deepStrictEqual(letters('tar f a.tar -t'), ['f']);
      // Only the first word: with an option before it, it is a member name.
      assert.deepStrictEqual(letters('tar -t vf a.tar'), []);
      assert.notStrictEqual(run('tar -t vf a.tar', dir).status, 0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    // A word with a character that is no letter (`a.tar`) is no letters: tar refuses it as an option.
    assert.match(failure('tar a.tar'), /^64 tar: invalid option -- '\.'/);
    assert.deepStrictEqual(letters('tar a.tar'), []);
  });
});

describe('ps: a bare number starts a list of PIDs that ends the line', () => {
  const isError = (line: string): boolean => /process ID list syntax error/.test(run(line, os.tmpdir()).err);
  (usable('ps') ? it : it.skip)('reads the words after it as an error, as procps does', () => {
    for (const line of ['ps -o pid= 1 u', 'ps 1 u', 'ps 1 -e', 'ps -o pid= 1 -p 2', 'ps 1 x 2']) {
      assert.ok(isError(line), line);
      const { name, words } = argWords(line);
      const parse = interpret(lookupCommand(name)!, words, { name, lookup: lookupCommand });
      const bad = parse.roles.filter((r) => r.role.role === 'operand' && r.role.spec?.name === 'WORD');
      assert.ok(bad.length >= 1, line);
    }
    // PIDs alone, or after other words (not before), are fine.
    for (const line of ['ps 1', 'ps 1 2', 'ps u 1', 'ps -e 1', 'ps -o pid= -p 1 u', 'ps -C systemd 1']) {
      assert.ok(!isError(line), line);
      const { name, words } = argWords(line);
      const parse = interpret(lookupCommand(name)!, words, { name, lookup: lookupCommand });
      assert.ok(!parse.roles.some((r) => r.role.role === 'operand' && r.role.spec?.name === 'WORD'), line);
    }
  });
});

describe('ar agrees with the real ar', () => {
  (usable('ar') ? it : it.skip)('every letter ar --help lists has a meaning', function () {
    // (See test/oldstyle.test.ts: the first run of ar may load large plugins.)
    this.timeout(60000);
    const help = spawnSync('ar', ['--help'], { env: ENV, encoding: 'utf8' }).stdout;
    const usage = /\{(\w+)\}\[(\w+)\]/.exec(help)!;
    const theirs = new Set([...usage[1] + usage[2]].filter((l) => l !== 'M'));
    for (const m of help.matchAll(/^ {2}\[(\w)/gm)) theirs.add(m[1]);
    const ours = new Set(Object.keys(lookupCommand('ar')!.oldStyle!.letters!));
    assert.deepStrictEqual([...theirs].filter((l) => !ours.has(l)), []);
  });

  // [line, the members of lib.a after it]: the archive is the operand the interpreter names; values come first.
  const ROWS: [string, string][] = [
    ['ar rc lib.a c.txt', 'a.txt b.txt c.txt'],
    ['ar ra a.txt lib.a c.txt', 'a.txt c.txt b.txt'],
    ['ar rb a.txt lib.a c.txt', 'c.txt a.txt b.txt'],
    ['ar rcl -lm lib.a c.txt', 'a.txt b.txt c.txt __.LIBDEP'],
    ['ar -d lib.a a.txt', 'b.txt'],
    ['ar dv lib.a b.txt', 'a.txt'],
    ['ar tO lib.a', 'a.txt b.txt'],
  ];
  (usable('ar') ? it : it.skip)('acts on the archive the interpreter names', function () {
    this.timeout(60000);
    for (const [line, after] of ROWS) {
      const dir = tempDir();
      try {
        fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n');
        fs.writeFileSync(path.join(dir, 'b.txt'), 'b\n');
        assert.strictEqual(run('ar rc lib.a a.txt b.txt', dir).status, 0);
        assert.strictEqual(run(line, dir).status, 0, line);
        assert.deepStrictEqual(wordsWith(line, (r) => r.role === 'operand' && r.spec?.name === 'ARCHIVE'), ['lib.a'], line);
        assert.strictEqual(run('ar t lib.a', dir).out.split('\n').filter(Boolean).join(' '), after, line);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });
});

describe('dpkg-query reads -f=FORMAT as dpkg does', () => {
  const ROWS = [
    "dpkg-query -W -f='X${Package}\\n' dpkg",
    "dpkg-query -W -f '=X${Package}\\n' dpkg",
    "dpkg-query -W -f'=X${Package}\\n' dpkg",
    "dpkg-query -Wf='X${Package}\\n' dpkg",
    "dpkg-query -W --showformat='=${Package}\\n' dpkg",
  ];
  /** The format the interpreter gives `-f` or `--showformat`: attached to the option, or the next word. */
  const formatOf = (line: string): string | undefined => {
    const { parse, words } = parseOf(line);
    for (const { word, role } of parse.roles) {
      if (role.role === 'value' && role.option?.names.includes('--showformat')) return words[word];
      for (const o of role.role === 'cluster' ? role.letters : [role]) {
        if (o.role === 'option' && o.value && o.spec.names.includes('--showformat')) return words[word].slice(o.value.attached);
      }
    }
    return undefined;
  };
  (has('dpkg-query') ? it : it.skip)('the format is the value the interpreter gives', () => {
    for (const line of ROWS) {
      const expected = spawnSync('dpkg-query', ['-W', `--showformat=${formatOf(line)}`, 'dpkg'], { env: ENV, encoding: 'utf8' }).stdout;
      assert.strictEqual(run(line, os.tmpdir()).out, expected, line);
    }
  });
});
