import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runGitLog, sampleCommits } from '../src/examples/gitlog';
describe('git log formats agree with git', () => {
  const now = Date.now();
  let dir = '';
  let real: ReturnType<typeof sampleCommits> = [];
  const git = (args: string[], env: Record<string, string> = {}) => execFileSync('git', args, { cwd: dir, env: { ...process.env, ...env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } }).toString();
  before(() => {
    const commits = sampleCommits(now).reverse();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gl-'));
    git(['init', '-q', '-b', 'main']);
    const zone = (() => { const o = -new Date().getTimezoneOffset(); return `${o < 0 ? '-' : '+'}${String(Math.floor(Math.abs(o) / 60)).padStart(2, '0')}${String(Math.abs(o) % 60).padStart(2, '0')}`; })();
    for (const c of commits) {
      const env = { GIT_AUTHOR_NAME: c.author.name, GIT_AUTHOR_EMAIL: c.author.email, GIT_COMMITTER_NAME: c.author.name, GIT_COMMITTER_EMAIL: c.author.email, GIT_AUTHOR_DATE: `@${c.time} ${zone}`, GIT_COMMITTER_DATE: `@${c.time} ${zone}` };
      git(['commit', '-q', '--allow-empty', '-m', c.subject + (c.body ? `\n\n${c.body}` : '')], env);
      if (c.refs.includes('tag:')) git(['tag', 'v1.2.0']);
    }
    git(['update-ref', 'refs/remotes/origin/main', 'HEAD']);
    // The sample hashes are made up; use the real ones.
    real = sampleCommits(now);
    const hashes = git(['log', '--format=%H %T %P']).trim().split('\n').map((l) => l.split(' '));
    real.forEach((c, i) => { c.hash = hashes[i][0]; c.tree = hashes[i][1]; c.parents = hashes[i].slice(2); });
  });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const cases: [string | undefined, string?][] = [
    [undefined], ['oneline'], ['short'], ['medium'], ['full'], ['fuller'], ['reference'],
    ['format:%h %an %ar %s'], ['format:%C(yellow)%h%Creset %<(20)%an %s%d'], ['tformat:%H%n%b'], ['%h %ad %s', 'short'],
    ['format:%h %ad', 'format:%Y-%m-%d %H:%M'], ['format:%ad|%cd', 'iso'], ['format:%ad', 'iso-strict'], ['format:%ad', 'rfc'], ['format:%ad', 'raw'], ['format:%ad', 'unix'],
    ['format:%ad', 'relative'], ['format:%ai %aI %as %at %ae %al %p %t %f %D'], ['format:%>(10)%h|%<(8,trunc)%an|%><(12)%s|%<(9,ltrunc)%s|%<(9,mtrunc)%s'],
    ['format:%B--'], ['%B'], ['tformat:%B'], ['format:%B'], ['format:%b|'], ['%b|'], ['format:%s%n%b'], ['tformat:[%B]'], ['medium', 'format:%a %d %b'], ['format:%ad', 'format:%A %B %e %I:%M %p %j %u %y %C %z'], ['format:%ad', 'default'], ['format:%ad', 'local'],
    ['format:%T %P %%|%<(1,trunc)%an|%><(30)%h'], ['format:%ad', 'format:%^a %-d %e'],
  ];
  for (const [pretty, date] of cases) {
    const args = ['log', ...(pretty ? [`--pretty=${pretty}`] : []), ...(date ? [`--date=${date}`] : [])];
    it(args.slice(1).join(' ') || 'log', () => {
      // Older git writes UTC as +00:00 in strict ISO dates; newer git, as on CI, writes Z.
      const expected = git(args).replace(/(T\d\d:\d\d:\d\d)\+00:00/g, '$1Z');
      assert.deepStrictEqual(runGitLog(real, pretty, date ?? 'default', now), expected.replace(/\n$/, '').split('\n'));
    });
  }
  // `--graph` on one line of history: `*` before each commit, `|` before its other lines and between commits.
  for (const pretty of ['oneline', 'short', 'medium', 'reference', 'format:%h %s', 'tformat:%s%n%b', 'format:%B', '%B', 'format:%s%n', '%h %s']) {
    it(`--graph --pretty=${pretty}`, () => {
      const expected = git(['log', '--graph', `--pretty=${pretty}`]);
      assert.deepStrictEqual(runGitLog(real, pretty, 'default', now, true), expected.replace(/\n$/, '').split('\n'));
    });
  }
});

describe('the git log example draws the graph of `--graph`', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Analyzer } = require('../src/analyzer');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createUnbashParser } = require('../src/syntax/adapters/unbash');
  const lines = (line: string): string[] => new Analyzer('en').explainLine(createUnbashParser().parse(line), 0).examples.find((e: { kind: string }) => e.kind === 'gitLog').sections[0].lines;
  it('with `--oneline --graph --format=…`', () => {
    assert.deepStrictEqual(lines("git log --oneline --graph --format='%h %s'").map((l) => l.slice(0, 2)), ['* ', '* ', '* ']);
    assert.ok(lines("git log --format='%h %s'").every((l) => !l.startsWith('* ')));
    assert.match(lines('git log --graph --format=medium')[1], /^\| Author: /);
  });
});

describe('the git log example shows as many commits as git', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Analyzer } = require('../src/analyzer');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createUnbashParser } = require('../src/syntax/adapters/unbash');
  let dir = '';
  const env = { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'a', GIT_AUTHOR_EMAIL: 'a@x', GIT_COMMITTER_NAME: 'a', GIT_COMMITTER_EMAIL: 'a@x' };
  const git = (args: string[]) => execFileSync('git', args, { cwd: dir, env: { ...process.env, ...env } }).toString();
  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gl-n-'));
    git(['init', '-q', '-b', 'main']);
    for (let i = 0; i < sampleCommits(Date.now()).length; i++) git(['commit', '-q', '--allow-empty', '-m', `c${i}`]);
  });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));
  // The count is read as git reads it: `--max-count N` (a separate value), `-nN`, `-N`, the last one winning.
  for (const args of [['--max-count', '2'], ['--max-count=2'], ['-n2'], ['-n', '1'], ['-2'], ['-n', '3', '-1'], ['-1', '-n', '2'], ['--date', 'short', '-n', '2'], []]) {
    const line = ['git log', ...args, '--format=%h'].join(' ');
    it(line, () => {
      const ex = new Analyzer('en').explainLine(createUnbashParser().parse(line), 0).examples.find((e: { kind: string }) => e.kind === 'gitLog');
      assert.ok(ex, 'has an example');
      assert.strictEqual(ex.sections[0].lines.length, git(['log', ...args, '--format=%h']).trim().split('\n').length);
    });
  }
});
