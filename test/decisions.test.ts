// The decisions of the state model against bash (docs/design/semantics.md, 4.14): over generated scripts (seeded,
// distinct), no condition the model decides may have another status in bash, no value it read another value, no
// `case` run other items, and no code it marks dead may run. The scripts and probes are in test/support/decisions.ts;
// for a larger run by hand, call `checkAll(scripts(seed, 3000), dir, jobs)` from a script of your own.
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { checkAll, forModel, type Script, scripts } from './support/decisions';

describe('decisions of the state model against bash (test/support/decisions.ts)', () => {
  it('makes none that bash contradicts, over generated scripts', async function () {
    this.timeout(300_000);
    const list = scripts(1, 120);
    assert.strictEqual(new Set(list.map((s) => s.text)).size, list.length);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'decisions-'));
    try {
      const results = await checkAll(list, dir, 6);
      const problems = results.flatMap((r, i) => r.problems.map((p) => `${p}\n${forModel(list[i].text).src}`));
      assert.deepStrictEqual(problems, []);
      // (Enough of them decide something, and some trust nothing.)
      assert.ok(results.reduce((n, r) => n + r.decided, 0) > 50);
      assert.ok(results.reduce((n, r) => n + r.dead, 0) > 200);
      assert.ok(results.some((r) => r.blind));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // The holes of docs/design/trust-per-position.md (section 2), which the model decided wrongly: each changes `u` (or
  // `x`) where the walk did not see it, or does not end the script. (Bash's environment here has no `n`: the case of
  // `declare n` is in test/trust.test.ts.)
  it('makes none that bash contradicts where code changes values unseen', async function () {
    this.timeout(60_000);
    const test = (v: string): string => `⟦s:1⟧if ⟦p:1⟧[ "$${v}" = 1 ]⟦c:1⟧; then : M2; else : M3; fi`;
    const list: Script[] = [
      "u=1; set -- 'a[u=2]'; declare -n r=$1; : \"$r\"",
      "u=1; set -- 'a[u=2]'; [ -v \"$1\" ]",
      "u=1; set -- 'a[u=2]'; test -v \"$1\"",
      "u=1; x='a[u=2]'; [[ -v $x ]]",
      "u=1; set -- '$((u=2))'; : \"${1@P}\"",
      "u=1; x='$((u=2))'; : \"${x@P}\"",
      "u=1; x='\\044((u=2))'; : \"${x@P}\"",
      "u=1; compgen -W '$((u=2))' >/dev/null",
      'set -o history\nu=1\nfc -s 1=2 u >/dev/null 2>&1\n',
      'g() { if [ "$d" = 1 ]; then d=2; g; return; fi; u=2; }; u=1; d=1; g',
      'g() { if [ "$d" = 1 ]; then d=2; h; return; fi; u=2; }; h() { g; }; u=1; d=1; g',
      // (Callbacks that run code in this shell: docs/design/trust-allow-list.md, the review of steps 1 to 3.)
      "u=1; mapfile -C 'u=2; :' -c 1 arr <<< q", "u=1; readarray -C 'u=2; :' -c 1 arr <<< q", 'u=1; jobs -x eval u=2',
    ].map((s) => ({ text: `${s}; ${test('u')}; : M4`.replace('\n; ', '\n'), constructs: [{ id: 1, type: 'if_statement' }] }));
    list.push({ text: 'enable -n exit; exit 2>/dev/null; : M1', constructs: [] });
    // (The recursive call runs the code after `return`, and what it calls: `h`'s body runs.)
    list.push({ text: 'g() { if [ "$d" = 1 ]; then d=2; g; return; fi; h; }; h() { : M1; }; d=1; g; : M2', constructs: [] });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'decisions-'));
    try {
      const results = await checkAll(list, dir, 4);
      assert.deepStrictEqual(results.flatMap((r, i) => r.problems.map((p) => `${p}\n${forModel(list[i].text).src}`)), []);
      // (None of them decides the test, and nothing after them is dead.)
      assert.deepStrictEqual(results.map((r) => r.decided + r.dead), list.map(() => 0));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
