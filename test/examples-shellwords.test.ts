import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { shoptStates } from '../src/analyzer';
import { bashPrintf, braceExpand, globExamples, globMatches, GlobOpts } from '../src/examples/shellwords';

const bash = (script: string, ...args: string[]) => execFileSync('bash', ['-c', script, '_', ...args]).toString();

describe('brace expansion agrees with bash', () => {
  const words = ['{1..5}', 'file{,.bak}', 'img_{a,b}{1,2}.png', '{01..10..3}', '{a..e}', 'x{a,{b,c}}y', '{10..1..4}', '{a}', '{}', 'a{b..x..5}',
    '{-2..2}', 'dir_{a,b}/{src,test}', '{a,b', 'pre{1..3}post', '\\{a,b\\}', '{,x}{,y}',
    '{a\\,b,c}', 'x{a,b\\}c}', '{1..5..0}', '{-05..3}', '{a..e..2}', '{e..a}', '{e..a..2}', '{a..e..0}'];
  for (const w of words) {
    it(w, () => {
      assert.strictEqual((braceExpand(w) ?? [w.replace(/\\(.)/g, '$1')]).join(' '), bash(`echo ${w}`).trim());
    });
  }
});

describe('printf agrees with bash', () => {
  const cases: string[][] = [
    ['%-10s|%05.2f|%x\\n', 'name', '3.14159', '255'], ['%s=%s\\n', 'a', '1', 'b', '2', 'c'], ['%d%%\\n', '42'], ['\\033[1;32m%s\\033[0m\\n', 'OK'],
    ['%b\\n', 'a\\tb'], ['%b|', 'stop\\chere'], ['%q\\n', "it's a test"], ['%c|%5s|%-5s|\\n', 'hello', 'ab', 'cd'], ['%d\\n', "'A"], ['%x %o %e\\n', '255', '8', '1234.5'],
    ['hello\\n'], ['%s\\n'], ['%5.1f|%-6d|%+d\\n', '2.25', '42', '7'], ['%.0f %.0f %.1f %.2f\\n', '0.5', '1.5', '0.25', '2.675'], ['%s\\n', 'a', 'b', 'c'], ['%*d|\\n', '5', '42'], ['%.3s\\n', 'abcdef'], ['no newline'],
    ['%d\\n', '0x1F'], ['%g %g\\n', '0.0001234', '1e7'], ['\\x41\\u00e9\\n'],
    ['%q|%.*f|%b|%q|%c|%d|%d\\n', '', '2', '3.14159', 'a\\qb', '', '', "'", '010'], ['%s|%b|%q|%c|%d\\n'],
  ];
  for (const [fmt, ...args] of cases) {
    it(JSON.stringify([fmt, ...args]), () => {
      assert.strictEqual(bashPrintf(fmt, args), bash('printf "$@"', fmt, ...args));
    });
  }
});

describe('glob examples agree with bash and find', () => {
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'glob-'));
  const shellMatches = (pattern: string, name: string) => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, name), '');
    const out = execFileSync('bash', ['-c', 'cd "$1" && shopt -s nullglob && for f in $2; do echo "$f"; done', '_', dir, pattern]).toString();
    fs.rmSync(dir, { recursive: true });
    return out.trim() === name;
  };
  for (const p of ['*.log', 'data_??.csv', '[abc]*.txt', 'backup-*', '*', 'report[0-9].pdf', '[!.]*']) {
    it(`file ${p}`, () => {
      const ex = globExamples(p, 'file')!;
      for (const n of ex.matching) assert.ok(shellMatches(p, n), `${n} should match`);
      for (const n of ex.nonMatching) assert.ok(!shellMatches(p, n), `${n} should not match`);
    });
  }
  for (const p of ['*.tar.gz', '[0-9]*', 'start', '*/*', '-h', '?']) {
    it(`value ${p}`, () => {
      const ex = globExamples(p, 'value')!;
      const caseMatches = (v: string) => bash('case "$1" in $2) echo y;; *) echo n;; esac', v, p).trim() === 'y';
      for (const v of ex.matching) assert.ok(caseMatches(v), `${v} should match`);
      for (const v of ex.nonMatching) assert.ok(!caseMatches(v), `${v} should not match`);
    });
  }
  // Every file and directory of a small tree, as bash expands the glob, with and without globstar.
  const TREE = ['app.ts', 'readme.md', 'README.MD', '.env.ts', 'src/a.ts', 'src/B.TS', 'src/b.sh', 'src/lib/c.ts', 'src/lib/deep/d.ts', 'src/.hidden/e.ts', '.cache/f.ts', 'test/g.ts', 'Src/h.ts', 'Src/I.TS'];
  const OPTS: [string, GlobOpts][] = [['none', {}], ['globstar', { globstar: true }], ['dotglob', { dotglob: true }], ['nocaseglob', { nocase: true }], ['globstar dotglob nocaseglob', { globstar: true, dotglob: true, nocase: true }]];
  for (const [names, opts] of OPTS) {
    for (const p of ['**/*.ts', 'src/**/*.ts', 'src/**', '**', '*', '*/*.ts', 'src/**/lib/*.ts', '**/lib/*', 'a**.ts', '**/.hidden/*.ts', '*.md', '.*', '?eadme.*', 'src/*.ts', 's[a-z]c/*.ts', 'README.*']) {
      it(`${names}: ${p}`, () => {
        const dir = tmp();
        for (const f of TREE) {
          fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
          fs.writeFileSync(path.join(dir, f), '');
        }
        const shopt = `shopt -s nullglob ${names === 'none' ? '' : names}`;
        const out = execFileSync('bash', ['-c', `cd "$1" && ${shopt} && for f in $2; do echo "$f"; done`, '_', dir, p]).toString();
        const all = execFileSync('find', ['.', '-mindepth', '1', '-printf', '%P\\n'], { cwd: dir }).toString().trim().split('\n');
        fs.rmSync(dir, { recursive: true });
        // bash lists `src/` itself for `src/**`, and `.` and `..` for `.*`; this matcher only answers for names in the tree.
        const expected = out.trim().split('\n').filter((n) => n && !n.endsWith('/') && n !== '.' && n !== '..').sort();
        assert.deepStrictEqual(all.filter((n) => globMatches(p, n, 'file', opts)).sort(), expected);
        const ex = globExamples(p, 'file', opts);
        if (ex) {
          for (const n of ex.matching) assert.ok(globMatches(p, n, 'file', opts), n);
          for (const n of ex.nonMatching) assert.ok(!globMatches(p, n, 'file', opts), n);
        }
      });
    }
  }
  const EXT_TREE = ['a.txt', 'b.md', 'app.ts', 'keep.log', 'old.log', 'ab.txt', 'aab.txt', 'c.txt', 'y', 'xy', 'xxy', '.hidden.ts', 'ababc', 'c', 'src/lib/x.ts', 'src/app/y.ts'];
  for (const p of ['!(*.txt)', '*.@(ts|md)', '+(a|b).txt', '?(x)y', 'src/!(lib)', '!(keep).log', '@(app|old)*', '*(ab)c', '!(*.@(txt|md))', 'src/@(lib|app)/*.ts']) {
    it(`extglob file ${p}`, () => {
      const dir = tmp();
      for (const f of EXT_TREE) {
        fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
        fs.writeFileSync(path.join(dir, f), '');
      }
      // extglob must be on when bash reads the line, so the pattern comes from a variable.
      const out = execFileSync('bash', ['-c', 'shopt -s extglob nullglob\ncd "$1" && for f in $2; do echo "$f"; done', '_', dir, p]).toString();
      const all = execFileSync('find', ['.', '-mindepth', '1', '-printf', '%P\\n'], { cwd: dir }).toString().trim().split('\n');
      fs.rmSync(dir, { recursive: true });
      const expected = out.trim().split('\n').filter(Boolean).sort();
      assert.deepStrictEqual(all.filter((n) => globMatches(p, n, 'file')).sort(), expected);
      const ex = globExamples(p, 'file')!;
      assert.ok(ex, 'examples');
      for (const n of ex.matching) assert.ok(globMatches(p, n, 'file'), n);
      for (const n of ex.nonMatching) assert.ok(!globMatches(p, n, 'file'), n);
    });
  }
  for (const p of ['@(start|stop)', '!(*.bak)', '+([0-9])', 'v?(.)+([0-9])', '*.@(jpg|png)', '*.!(x)', 'a!(b)?', '!(x)[ab]']) {
    it(`extglob value ${p}`, () => {
      const ex = globExamples(p, 'value')!;
      assert.ok(ex?.nonMatching.length, 'examples');
      const caseMatches = (v: string) => execFileSync('bash', ['-c', 'shopt -s extglob\neval \'case "$1" in \'"$2"\') echo y;; *) echo n;; esac\'', '_', v, p]).toString().trim() === 'y';
      for (const v of ex.matching) assert.ok(caseMatches(v), `${v} should match`);
      for (const v of ex.nonMatching) assert.ok(!caseMatches(v), `${v} should not match`);
    });
  }
  it('examples show what dotglob and nocase add', () => {
    assert.ok(globExamples('*.ts', 'file', { dotglob: true })!.matching.includes('.app.ts'));
    assert.ok(globExamples('*.ts', 'file', { nocase: true })!.matching.includes('APP.TS'));
    assert.ok(!globExamples('*.ts', 'file', { nocase: true })!.nonMatching.some((n) => n.toLowerCase().endsWith('.ts') && !n.startsWith('.')));
  });
  it('globstar examples reach into subdirectories, without it one level only', () => {
    assert.deepStrictEqual(globExamples('**/*.ts', 'file', { globstar: true })!.matching, ['app.ts', 'src/data.ts', 'src/lib/error.ts']);
    assert.ok(globExamples('**/*.ts', 'file', { globstar: true })!.nonMatching.includes('.cache/app.ts'));
    assert.deepStrictEqual(globExamples('**/*.ts', 'file')!.matching, ['app/app.ts', 'data/data.ts', 'error/error.ts']);
    assert.ok(globExamples('**/*.ts', 'file')!.nonMatching.includes('src/app/app.ts'));
  });
  it('shopt states: set before the line, the last one wins', () => {
    const src = 'ls **\nshopt -s globstar\nls **\nshopt -u globstar\nls **';
    assert.deepStrictEqual([0, 2, 4].map((l) => shoptStates(src, l).globstar), ['unknown', 'on', 'off']);
    assert.strictEqual(shoptStates('ls **', 0, 'zsh').globstar, 'on');
    assert.strictEqual(shoptStates('ls **', 0, 'dash').globstar, 'unsupported');
    assert.strictEqual(shoptStates('# shopt -s globstar\nls **', 1).globstar, 'unknown');
    assert.strictEqual(shoptStates('set -o globstar\nls **', 1, 'ksh').globstar, 'on');
    const many = shoptStates('shopt -s -q dotglob nullglob; shopt -u nocaseglob\nls', 1);
    assert.deepStrictEqual([many.dotglob, many.nullglob, many.nocaseglob, many.extglob], ['on', 'on', 'off', 'unknown']);
  });
  it('find -name matches names starting with a dot', () => {
    const ex = globExamples('*.tmp', 'value')!;
    const dir = tmp();
    for (const n of [...ex.matching, ...ex.nonMatching, '.hidden.tmp']) fs.writeFileSync(path.join(dir, n), '');
    const found = execFileSync('find', [dir, '-name', '*.tmp', '-printf', '%f\\n']).toString().trim().split('\n').sort();
    fs.rmSync(dir, { recursive: true });
    assert.deepStrictEqual(found, [...ex.matching, '.hidden.tmp'].sort());
  });
});
