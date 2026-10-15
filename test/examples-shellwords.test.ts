import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { bashPrintf, braceExpand, globExamples } from '../src/examples/shellwords';

const bash = (script: string, ...args: string[]) => execFileSync('bash', ['-c', script, '_', ...args]).toString();

describe('brace expansion agrees with bash', () => {
  const words = ['{1..5}', 'file{,.bak}', 'img_{a,b}{1,2}.png', '{01..10..3}', '{a..e}', 'x{a,{b,c}}y', '{10..1..4}', '{a}', '{}', 'a{b..x..5}',
    '{-2..2}', 'dir_{a,b}/{src,test}', '{a,b', 'pre{1..3}post', '\\{a,b\\}', '{,x}{,y}'];
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
  it('find -name matches names starting with a dot', () => {
    const ex = globExamples('*.tmp', 'value')!;
    const dir = tmp();
    for (const n of [...ex.matching, ...ex.nonMatching, '.hidden.tmp']) fs.writeFileSync(path.join(dir, n), '');
    const found = execFileSync('find', [dir, '-name', '*.tmp', '-printf', '%f\\n']).toString().trim().split('\n').sort();
    fs.rmSync(dir, { recursive: true });
    assert.deepStrictEqual(found, [...ex.matching, '.hidden.tmp'].sort());
  });
});
