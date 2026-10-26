import * as assert from 'assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { explain } from './support/explain';

// `((i++))` with `i` 0 has status 1: a warning where `set -e` stops the shell there (the script breaks as written),
// information otherwise. Whether it stops comes from the model (statusModel(state).errexit(n)); bash shows it.

const levelOf = (src: string, line: number): string | undefined => {
  return explain(src, line).noteInfo.find((n) => /exit status is 1 when|gives the value before the (in|de)crement/.test(n.text))?.level;
};
const run = (script: string): boolean => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explain-bash-postfix-'));
  const file = path.join(dir, 's.sh');
  try {
    fs.writeFileSync(file, script);
    const r = spawnSync('systemd-run', ['--user', '--scope', '-q', '-p', 'MemoryMax=2G', '-p', 'MemorySwapMax=0', '-p', 'TasksMax=300', 'timeout', '20', 'bash', file], { encoding: 'utf8' });
    return !r.stdout.includes('after');
  } finally {
    fs.rmSync(file, { force: true });
    fs.rmdirSync(dir);
  }
};
const have = spawnSync('systemd-run', ['--user', '--scope', '-q', 'true']).status === 0;

describe('the level of the status of ((i++)) follows set -e', () => {
  // [script, line of the statement (-1: none to check), level, whether bash stops there]
  const cases: [string, number, string, boolean][] = [
    ['set -e\ni=0\n((i++))\necho after', 2, 'warning', true],
    ['i=0\n((i++))\necho after', 1, 'info', false],
    ['set -e\nset +e\ni=0\n((i++))\necho after', 3, 'info', false],
    ['set -e\ni=0\nif ((i++)); then :; fi\necho after', -1, 'none', false],
    ['set -e\ni=0\n((i++)) && echo yes\necho after', 2, 'none', false],
    ['set -e\ni=0\n((i++)) || true\necho after', 2, 'none', false],
    ['set -e\ni=0\nf() { ((i++)); }\nif f; then :; fi\necho after', 2, 'none', false],
    ['set -e\ni=0\nf() { ((i++)); }\nif f; then :; fi\ni=0\nf\necho after', 2, 'info', true],
    ['set -e\ni=0\nf() { ((i++)); }\nf\necho after', 2, 'warning', true],
    ['set -e\ni=0\nf() { ((i--)); }\nf\necho after', 2, 'warning', true],
    ['set -e\ni=0\nx=$( ((i++)); echo in )\necho after', 2, 'info', false],
  ];
  for (const [src, line, level, stops] of cases) {
    it(JSON.stringify(src), function () {
      if (!have) return this.skip();
      if (line >= 0) assert.strictEqual(levelOf(src, line) ?? 'none', level, 'level');
      assert.strictEqual(run(src), stops, 'bash');
    });
  }
});
