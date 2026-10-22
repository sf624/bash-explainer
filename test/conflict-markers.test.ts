import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// A rebase once left a conflict marker in CHANGELOG.md, and the PR was merged with it.
const root = path.join(__dirname, '..');

describe('Conflict markers', () => {
  it('are left in no tracked file', () => {
    const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
    const found: string[] = [];
    for (const file of files) {
      const p = path.join(root, file);
      if (!fs.existsSync(p) || !fs.statSync(p).isFile()) continue;
      fs.readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
        if (/^(<{7}|>{7}) /.test(line)) found.push(`${file}:${i + 1}`);
      });
    }
    assert.deepStrictEqual(found, []);
  });
});
