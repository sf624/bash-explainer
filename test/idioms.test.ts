import * as assert from 'assert';
import { spawnSync } from 'child_process';
import { findIdioms, isStrictMode, simulateRedirects } from '../src/idioms';
import { Analyzer, Token } from '../src/analyzer';
import { createUnbashParser } from '../src/syntax/adapters/unbash';

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

describe('set option bundles, compared with bash', () => {
  const bashOn = (cmd: string): string[] | undefined => {
    const r = spawnSync('bash', ['-c', `${cmd}; set -o`], { encoding: 'utf8' });
    if (r.error) return undefined;
    return r.stdout.split('\n').filter((l) => /\ton$/.test(l)).map((l) => l.split(/\s/)[0])
      .filter((n) => ['errexit', 'nounset', 'pipefail', 'noglob', 'xtrace'].includes(n)).sort();
  };
  const flat = (ts: Token[]): Token[] => ts.flatMap((t) => [t, ...flat(t.children)]);
  // The options the explanation names: the letters, and the word after each `-o`.
  const explained = (cmd: string): string[] => {
    const parser = createUnbashParser();
    const toks = flat(new Analyzer('en').explainLine(parser.parse(cmd), 0).items);
    const names = new Map([['-e', 'errexit'], ['-u', 'nounset'], ['-f', 'noglob'], ['-x', 'xtrace']]);
    const on: string[] = [];
    for (const t of toks) if (t.kind === 'option' && names.has(t.label)) on.push(names.get(t.label)!);
    // Values of -o: the argument tokens that are not letters of a bundle.
    for (const t of toks) if (t.kind === 'argument' && /^(errexit|nounset|pipefail|noglob|xtrace)$/.test(t.label)) on.push(t.label);
    return [...new Set(on)].sort();
  };
  const variants = [
    'set -euo pipefail', 'set -eou pipefail', 'set -oeu pipefail', 'set -o pipefail -eu', 'set -e -u -o pipefail',
    'set -Eeuo pipefail', 'set -o errexit -o nounset -o pipefail', 'set -oo pipefail errexit', 'set -eo pipefail -u',
    'set -xeuo pipefail', 'set -eu', 'set -o pipefail', 'set -fo pipefail',
  ];

  for (const cmd of variants) {
    it(`${cmd}`, function () {
      const on = bashOn(cmd);
      if (!on) return this.skip();
      assert.deepStrictEqual(explained(cmd), on);
      assert.strictEqual(isStrictMode(cmd), ['errexit', 'nounset', 'pipefail'].every((n) => on.includes(n)), cmd);
      assert.strictEqual(findIdioms([cmd], 'en').some((n) => /strict mode/.test(n)), isStrictMode(cmd));
    });
  }

  it('turns options off with +', function () {
    const cmd = 'set -euo pipefail; set +eo pipefail';
    const on = bashOn(cmd);
    if (!on) return this.skip();
    assert.deepStrictEqual(on, ['nounset']);
    assert.strictEqual(isStrictMode('set -euo pipefail +e'), false);
    assert.strictEqual(isStrictMode('set -euo pipefail +o pipefail'), false);
    assert.strictEqual(isStrictMode('set +eo pipefail -eu'), false);
    const toks = flat(new Analyzer('en').explainLine(createUnbashParser().parse('set +eo pipefail'), 0).items);
    assert.ok(toks.some((t) => t.kind === 'argument' && t.label === 'pipefail' && /turn it off|disable|Undo/i.test(t.explanation)), toks.map((t) => t.explanation).join('\n'));
  });

  it('is not strict mode for other commands and positional parameters', () => {
    assert.strictEqual(isStrictMode('echo set -euo pipefail'), false);
    assert.strictEqual(isStrictMode('set -eu; set -o pipefail'), false);
    assert.strictEqual(isStrictMode('set -eu -- -o pipefail'), false);
    assert.strictEqual(isStrictMode('set -eu -o'), false);
    assert.strictEqual(isStrictMode('set -euo pipefail && echo ok'), true);
  });
});
