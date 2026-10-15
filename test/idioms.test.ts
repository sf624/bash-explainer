import * as assert from 'assert';
import { findIdioms, simulateRedirects } from '../src/idioms';

describe('redirect order', () => {
  it('follows redirections left to right', () => {
    assert.match(simulateRedirects([{ op: '>', fd: '', dest: '/dev/null' }, { op: '>&', fd: '2', dest: '1' }], 'en')!,
      /In the end: stdout → \/dev\/null, stderr → \/dev\/null \(all output, including errors, is discarded\)/);
  });

  it('warns about 2>&1 before the file redirection', () => {
    const r = simulateRedirects([{ op: '>&', fd: '2', dest: '1' }, { op: '>', fd: '', dest: 'out.log' }], 'en')!;
    assert.match(r, /stdout → out\.log, stderr → the original stdout/);
    assert.match(r, /Note: `2>&1` comes before the file redirection/);
  });

  it('recognises a swap through a third descriptor', () => {
    const r = simulateRedirects([{ op: '>&', fd: '3', dest: '1' }, { op: '>&', fd: '1', dest: '2' }, { op: '>&', fd: '2', dest: '3' }], 'en')!;
    assert.match(r, /stdout and stderr are swapped/);
  });

  it('stays quiet when the order cannot matter', () => {
    assert.strictEqual(simulateRedirects([{ op: '>', fd: '', dest: 'a' }], 'en'), undefined);
    assert.strictEqual(simulateRedirects([{ op: '>', fd: '', dest: 'a' }, { op: '>', fd: '2', dest: 'b' }], 'en'), undefined);
  });
});

describe('idioms', () => {
  const has = (stmt: string, re: RegExp) => assert.ok(findIdioms([stmt], 'en').some((n) => re.test(n)), stmt);

  it('finds common patterns', () => {
    has('while IFS= read -r line', /reads a line exactly as is/);
    has('IFS= read -r -d "" item', /reads a line exactly as is/);
    has('cd "$(dirname "$0")"', /moves to the directory the script lives in/);
    has('command -v jq >/dev/null 2>&1', /checks quietly whether a command is installed/);
    has('set -euo pipefail', /strict mode/);
    has('set -Eeuo pipefail', /strict mode/);
    has(': "${API_KEY:?API_KEY is required}"', /checks that a required variable is set/);
    has('rm -f x || true', /turns a failure into success/);
    has("trap 'rm -rf \"$tmp\"' EXIT", /runs clean-up/);
    has('[[ "${BASH_SOURCE[0]}" == "$0" ]]', /run directly rather than sourced/);
  });

  it('reports the larger idiom only', () => {
    const notes = findIdioms(['SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)', 'cd "$(dirname "${BASH_SOURCE[0]}")"'], 'en');
    assert.strictEqual(notes.length, 1);
    assert.match(notes[0], /absolute path/);
  });

  it('ignores ordinary commands', () => {
    assert.deepStrictEqual(findIdioms(['echo hello', 'cd /tmp', 'read line'], 'en'), []);
  });
});
