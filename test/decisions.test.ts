// The decisions of the state model against bash (docs/design/semantics.md, 4.14): over generated scripts (seeded,
// distinct), no condition the model decides may have another status in bash, no value it read another value, no
// `case` run other items, and no code it marks dead may run. The scripts and probes are in test/support/decisions.ts;
// for a larger run by hand, call `checkAll(scripts(seed, 3000), dir, jobs)` from a script of your own.
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { checkAll, forModel, type Script, scripts, UNKNOWN_CONSTRUCTS, withUnknown } from './support/decisions';

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

  // The property of docs/design/trust-allow-list.md (section 5): a script that holds a construct whose row is `all`
  // gives no value, decides no condition and marks nothing dead.
  it('decides nothing in generated scripts that hold a construct the model does not follow', async function () {
    this.timeout(120_000);
    const list = withUnknown(1, 120).filter((s) => s.unknown);
    assert.ok(list.length >= 15);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'decisions-'));
    try {
      const results = await checkAll(list, dir, 6);
      assert.deepStrictEqual(results.flatMap((r, i) => r.problems.map((p) => `${p}\n${forModel(list[i].text).src}`)), []);
      assert.deepStrictEqual(results.map((r, i) => (r.blind && r.decided + r.dead === 0 ? '' : list[i].unknown)), list.map(() => ''));
      // (Each of them is there.)
      assert.deepStrictEqual(new Set(withUnknown(5, 400).map((s) => s.unknown).filter(Boolean)), new Set(UNKNOWN_CONSTRUCTS));
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
      // (The review of the allow-list's step 4: an empty command name, and a write through a nameref by its target's row.)
      'u=1; cmd=; $cmd eval u=2', 'u=1; declare -n r=FUNCNEST; r=1; g() { u=2; }; f() { g; }; f\n',
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

  // A word of a builtin whose value the script gives (`x=-e; set $x`) is read as the fields bash gives it, by the
  // trust scan (for each value the script writes, and none) and by the walk: an option there is an option.
  it('makes none that bash contradicts where a builtin gets the fields of a variable', async function () {
    this.timeout(60_000);
    const test = (v: string): string => `⟦s:1⟧if ⟦p:1⟧[ "$${v}" = 1 ]⟦c:1⟧; then : M2; else : M3; fi`;
    const decides = [
      'u=1; v=u; declare "$v=2"', 'u=1; v=u; export $v=3', "u=1; x='u=2 w=3'; declare $x", 'u=1; x=-g; f() { declare $x u=2; }; f',
      'u=1; x=+e; set -e $x; false; u=2', 'u=1; set {-e,+e}; false; u=2', 'u=1; x=; declare $x u=4',
    ];
    // (Where the fields may give an option that sets `u`, or a value not known, nothing about `u` is decided.)
    const undecided = [
      'u=1; x=-v; printf $x u 2', 'u=1; x=-v; [ -t 0 ] && x=; printf $x u 2', "u=1; x='-a u'; read $x <<< 2", 'u=1; x=-i; declare $x u; u=1+1',
      'u=1; x=u; [ -t 0 ] && x=w; declare $x=2',
    ];
    const list: Script[] = [...decides, ...undecided].map((s) => ({ text: `${s}; ${test('u')}; : M4`, constructs: [{ id: 1, type: 'if_statement' }] }));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'decisions-'));
    try {
      const results = await checkAll(list, dir, 4);
      assert.deepStrictEqual(results.flatMap((r, i) => r.problems.map((p) => `${p}\n${forModel(list[i].text).src}`)), []);
      assert.deepStrictEqual(results.map((r) => r.decided > 0), [...decides.map(() => true), ...undecided.map(() => false)]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
