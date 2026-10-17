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
    ['format:%B--'], ['medium', 'format:%a %d %b'], ['format:%ad', 'format:%A %B %e %I:%M %p %j %u %y %C %z'], ['format:%ad', 'default'], ['format:%ad', 'local'],
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
});
