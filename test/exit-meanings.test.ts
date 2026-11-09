// The statuses other than 0 that are no error (`CommandSpec.exits`: src/argv/spec.ts), compared with GNU grep and diff on
// PATH, in one bash process: where the real tool gives such a status, the spec allows it for the call, and where the spec
// does not, the tool does not give it. (buildifier's and buildozer's are in their own tests.)
import * as assert from 'assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { lookupCommand } from '../src/analyzer';
import { interpret } from '../src/argv/interpret';
import { exitMeanings } from '../src/argv/query';
import { argWords } from './support/argwords';

/** The statuses of `spec.exits` the call `line` may give. */
function results(line: string): number[] {
  const { name, words } = argWords(line);
  const spec = lookupCommand(name)!;
  return exitMeanings(spec, interpret(spec, words, { name, lookup: lookupCommand }), words.map((w) => w.value)).map((e) => e.status);
}

describe('exit statuses that are no error', () => {
  // [line, status of the real tool]: run in a directory with `a` (lines `x` and `y`), `b` (`x`), `c` (`y`).
  const ROWS: [string, number][] = [
    ['grep x a', 0],
    ['grep z a', 1],
    ['grep -q z a', 1],
    ['grep -c z a', 1],
    ['grep -v x b', 1],
    ['grep -iv X a', 0],
    ['grep z missing', 2],
    ['egrep z a', 1],
    ['diff a a', 0],
    ['diff a b', 1],
    ['diff -q b c', 1],
    ['diff a missing', 2],
  ];

  it('the real grep and diff give them where the spec allows them', function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exits-'));
    try {
      fs.writeFileSync(path.join(dir, 'a'), 'x\ny\n');
      fs.writeFileSync(path.join(dir, 'b'), 'x\n');
      fs.writeFileSync(path.join(dir, 'c'), 'y\n');
      const script = ROWS.map(([line]) => `${line} >/dev/null 2>&1 </dev/null; echo $?`).join('\n');
      const r = spawnSync('bash', ['--norc', '-c', script], { cwd: dir, encoding: 'utf8', timeout: 30000 });
      const statuses = r.stdout.trim().split('\n').map(Number);
      for (const [i, [line, status]] of ROWS.entries()) {
        assert.strictEqual(statuses[i], status, line);
        const allowed = results(line);
        if (status !== 0 && status !== 2) assert.ok(allowed.includes(status), `${status} allowed: ${line}`);
        for (const s of [1, 3, 4]) if (!allowed.includes(s)) assert.notStrictEqual(status, s, line);
      }
    } finally {
      fs.rmSync(dir, { recursive: true });
    }
  });

  it('every entry is a status other than 0, and only buildozer counts one as a success', () => {
    const spec = (name: string) => lookupCommand(name)!;
    for (const name of ['grep', 'diff', 'buildifier', 'buildozer']) {
      for (const e of spec(name).exits!) assert.ok(e.status > 0 && e.status < 126, `${name} ${e.status}`);
    }
    assert.deepStrictEqual(['grep', 'diff', 'buildifier', 'buildozer'].map((n) => spec(n).exits!.some((e) => e.success)), [false, false, false, true]);
    // (grep's 1 says what `-v` selects.)
    assert.deepStrictEqual([results('grep x f'), results('grep -v x f')].map((r) => r.length), [1, 1]);
  });
});
