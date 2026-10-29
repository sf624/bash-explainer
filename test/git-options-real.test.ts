// The options of git's dictionary that take a value, compared with the real git: does it read the word after
// `--opt` as the value (`git log --author a`), or only the value written in the same word (`git log --format=%H`;
// `git log --format %H` fails "ambiguous argument '%H'")? Each row runs git both ways in a scratch repository: when
// the two lines behave alike, the next word is the value. Our reading of the separate form must say the same.
// Every option of the dictionary that takes a value has a row, so one added later must be checked against git too.
// Missing git is skipped.
import * as assert from 'assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { lookupCommand } from '../src/analyzer';
import { type ArgRole, type ArgvParse, interpret } from '../src/argv/interpret';
import type { CommandSpec } from '../src/argv/spec';
import { argWords } from './support/argwords';

const has = (tool: string): boolean => spawnSync('bash', ['--norc', '-c', `command -v ${tool}`]).status === 0;
const DATE = '2020-01-01T00:00:00Z';
const ENV = {
  ...process.env, LC_ALL: 'C', TZ: 'UTC', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x', GIT_AUTHOR_DATE: DATE, GIT_COMMITTER_DATE: DATE,
};
const run = (line: string, cwd: string): { status: number | null; out: string; err: string } => {
  const r = spawnSync('bash', ['--norc', '-c', line], { cwd, env: ENV, encoding: 'utf8', timeout: 60000 });
  return { status: r.status, out: r.stdout, err: r.stderr };
};

/** Each word with its role, the words of subcommands included. */
function roles(line: string): { word: string; role: ArgRole }[] {
  const { name, words, texts } = argWords(line);
  const out: { word: string; role: ArgRole }[] = [];
  const walk = (parse: ArgvParse): void => {
    for (const { word, role } of parse.roles) {
      out.push({ word: words[word].value ?? texts[word], role });
      if (role.role === 'subcommand') walk(role.parse);
    }
  };
  walk(interpret(lookupCommand(name)!, words, { name, lookup: lookupCommand }));
  return out;
}
const roleOf = (line: string, word: string): ArgRole => roles(line).find((r) => r.word === word)!.role;

/**
 * `line` has `@` where the option goes; `opt` and `value` are written apart or joined. `sep`: git takes the next word
 * as the value (the audit of the dictionary, git 2.43). `key`: the dictionary entry, when it is not the words before `@`.
 */
interface Row { line: string; opt: string; value: string; sep: boolean; key?: string }
const ROWS: Row[] = [
  // Global options (`-C` and `-c` take their value apart only: test/subcommands-real.test.ts).
  { line: 'git @ rev-parse --git-dir', opt: '--git-dir', value: '.git', sep: true },
  { line: 'git @ rev-parse --git-dir', opt: '--work-tree', value: '.', sep: true },
  { line: 'git @ rev-parse --git-dir', opt: '--namespace', value: 'ns', sep: true },
  { line: 'git @ rev-parse --git-dir', opt: '--config-env', value: 'user.name=HOME', sep: true },
  { line: 'git @ rev-parse --git-dir', opt: '--attr-source', value: 'HEAD', sep: true },
  // (`git --exec-path /x` prints the path and stops; `git --exec-path=/x rev-parse` sets it and goes on.)
  { line: 'git @ rev-parse --git-dir', opt: '--exec-path', value: '/x', sep: false },
  { line: 'git submodule update @', opt: '--depth', value: 'x', sep: true, key: 'git submodule' },
  { line: 'git archive @ HEAD', opt: '-o', value: 'out.tar', sep: true },
  { line: 'git archive @ HEAD', opt: '--output', value: 'out.tar', sep: true },
  { line: 'git archive @ HEAD', opt: '--format', value: 'tar', sep: true },
  { line: 'git archive @ HEAD', opt: '--prefix', value: 'p/', sep: true },
  { line: 'git clone @ file://$BASE out', opt: '--depth', value: '1', sep: true },
  { line: 'git clone @ file://$BASE out', opt: '-b', value: 'main', sep: true },
  { line: 'git clone @ file://$BASE out', opt: '--branch', value: 'main', sep: true },
  { line: 'git commit @ --allow-empty', opt: '-m', value: 'x', sep: true },
  { line: 'git commit @ --allow-empty', opt: '--message', value: 'x', sep: true },
  { line: 'git fetch @ origin', opt: '--depth', value: '1', sep: true },
  { line: 'git init @ out', opt: '-b', value: 'foo', sep: true },
  { line: 'git init @ out', opt: '--initial-branch', value: 'foo', sep: true },
  // The value of these is written with `=` only.
  { line: 'git describe @ HEAD', opt: '--abbrev', value: '4', sep: false },
  { line: 'git show @ -s', opt: '--pretty', value: 'oneline', sep: false },
  { line: 'git show @ -s', opt: '--format', value: '%H', sep: false },
  { line: 'git log @ -1', opt: '--pretty', value: 'oneline', sep: false },
  { line: 'git log @ -1', opt: '--format', value: '%H', sep: false },
  { line: 'git checkout -q @', opt: '-b', value: 'nb', sep: true, key: 'git checkout' },
  { line: 'git switch @', opt: '-c', value: 'nc', sep: true },
  { line: 'git switch @', opt: '--create', value: 'nc', sep: true },
  { line: 'git log @', opt: '-n', value: '1', sep: true },
  { line: 'git log @', opt: '--max-count', value: '1', sep: true },
  { line: 'git log @', opt: '--date', value: 'short', sep: true },
  { line: 'git log @ -1', opt: '--since', value: '2000-01-01', sep: true },
  { line: 'git log @ -1', opt: '--after', value: '2000-01-01', sep: true },
  { line: 'git log @ -1', opt: '--until', value: '2100-01-01', sep: true },
  { line: 'git log @ -1', opt: '--before', value: '2100-01-01', sep: true },
  { line: 'git log @ -1', opt: '--author', value: 'zz', sep: true },
  { line: 'git log @ -1', opt: '--grep', value: 'zz', sep: true },
  { line: 'git log @ -1', opt: '--diff-filter', value: 'A', sep: true },
  { line: 'git stash @', opt: '-m', value: 'x', sep: true },
  { line: 'git stash @', opt: '--message', value: 'x', sep: true },
  { line: 'git stash push @', opt: '-m', value: 'x', sep: true },
  { line: 'git stash push @', opt: '--message', value: 'x', sep: true },
  { line: 'git tag @ t1', opt: '-m', value: 'x', sep: true },
  { line: 'git tag @', opt: '--sort', value: 'refname', sep: true },
];
const keyOf = (r: Row): string => `${r.key ?? r.line.slice(0, r.line.indexOf(' @'))} ${r.opt}`;

/** `path name` of every name of every option of git and its subcommands that takes a value, except git's own `-C` and `-c`. */
function valueOptions(spec: CommandSpec, at: string): string[] {
  const own = (spec.options ?? []).filter((o) => o.value !== undefined).flatMap((o) => o.names.map((n) => `${at} ${n}`));
  return [...own, ...Object.entries(spec.subcommands ?? {}).flatMap(([n, s]) => valueOptions(s, `${at} ${n}`))];
}

describe('git: the options with a value, compared with the real git', () => {
  let dir = '';
  let base = '';
  let n = 0;
  before(function () {
    if (!has('git')) return this.skip();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-options-'));
    base = path.join(dir, 'base');
    const sh = (cmd: string, cwd = dir) => assert.strictEqual(run(cmd, cwd).status, 0, cmd);
    sh('git init -q -b main base');
    for (const i of [1, 2]) sh(`echo ${i} >> f && git add f && git commit -q -m c${i}`, base);
    sh('git tag v1 && git tag -a -m ann v2', base);
    // A clone, with a change not committed (to stash), is the repository every row runs in.
    sh(`git clone -q file://${base} work && echo 3 >> work/f`);
    // (Git refreshes the index of a copy once; run it here, so that the rows do not differ by it.)
    sh('git status -s', path.join(dir, 'work'));
  });
  after(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

  /** Runs `line` in a fresh copy of the repository; the paths in the output are made alike. */
  const runIn = (line: string): { status: number | null; out: string; err: string } => {
    const copy = path.join(dir, `copy${++n}`);
    fs.cpSync(path.join(dir, 'work'), copy, { recursive: true, preserveTimestamps: true });
    const r = run(line.replace(/\$BASE/g, base), copy);
    const same = (s: string): string => s.split(copy).join('<D>').split(base).join('<B>');
    return { status: r.status, out: same(r.out), err: same(r.err) };
  };

  for (const row of ROWS) {
    const attach = (o: string, v: string): string => (o.startsWith('--') ? `${o}=${v}` : `${o}${v}`);
    const line = (form: string): string => row.line.replace('@', form);
    const separate = line(`${row.opt} ${row.value}`);
    const attached = line(attach(row.opt, row.value));
    it(`${keyOf(row)}: ${row.sep ? 'the next word is the value' : 'only an attached value'} (${separate})`, () => {
      const a = runIn(separate.replace(/\$BASE/g, base));
      const b = runIn(attached.replace(/\$BASE/g, base));
      if (row.sep) assert.deepStrictEqual(a, b, 'git reads the next word as the value');
      else {
        assert.strictEqual(b.status, 0, b.err);
        assert.notDeepStrictEqual(a, b, 'git does not read the next word as the value');
      }
      // Our reading says the same.
      const role = roleOf(separate.replace(/\$BASE/g, base), row.value).role;
      assert.strictEqual(role === 'value', row.sep, `${row.value} is ${role}`);
      const joined = roleOf(attached.replace(/\$BASE/g, base), attach(row.opt, row.value));
      assert.ok(joined.role === 'option' && joined.value && !joined.missing, `${attached}: ${joined.role}`);
    });
  }

  it('has a row for every option of the dictionary that takes a value', () => {
    const asked = valueOptions(lookupCommand('git')!, 'git').filter((k) => !/^git -[Cc]$/.test(k)).sort();
    assert.deepStrictEqual(ROWS.map(keyOf).sort(), asked);
  });

  it('git log --format needs its value, and --pretty alone is --pretty=medium', () => {
    // (Our option text says it; the option alone is read as one with no value, not as one that takes the next word.)
    assert.strictEqual(runIn('git log --format -- f').status, 128);
    assert.match(runIn('git log --format -- f').err, /unrecognized argument: --format/);
    assert.strictEqual(runIn('git log --pretty -1').out, runIn('git log --pretty=medium -1').out);
    assert.strictEqual(runIn('git describe --abbrev').status, 0);
    for (const [line, word] of [['git log --format -- f', '--format'], ['git log --pretty -1', '--pretty'], ['git describe --abbrev', '--abbrev']]) {
      const alone = roleOf(line, word);
      assert.ok(alone.role === 'option' && !alone.value && !alone.missing, line);
    }
    assert.strictEqual(roleOf('git log --format -- f', '--').role, 'end-of-options');
    assert.strictEqual(roleOf('git log --pretty -1', '-1').role, 'pattern-option');
    assert.match(lookupCommand('git')!.subcommands!.log.options!.find((o) => o.names.includes('--format'))!.text.en, /without it git fails/);
  });
});
