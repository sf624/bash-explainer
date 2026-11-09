import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { asBash, type BehaviourId, differIn, isBash, type Shell, SHELL_BEHAVIOURS, shellsOf, wordsFollowed } from '../src/shellfeatures';
import { runContained } from './support/contained';
import { locate, SHELLS } from './support/shells';

// The guard of the behaviour table (docs/design/sources.md, row 9, SC6): every row of SHELL_BEHAVIOURS (src/shellfeatures.ts) against each
// installed shell (bash, dash, busybox ash, yash, ksh93, mksh, zsh; on PATH or in $BASH_EXPLAINER_SHELLS; CI installs them all). Each probe
// prints its row's name where the shell does otherwise than bash; the shells that print it must be the row's `differs`. All the probes of a
// shell run in one process, each in a subshell of its own and through `eval`, so that a form one shell refuses fails only its probe.

/** A probe for each row: true (status 0) where the shell does otherwise than bash. It runs in a directory with the files `.a`, `a` and `ab`. */
const PROBES: Record<BehaviourId, string> = {
  echoEscape: `[ "$(echo 'a\\tb')" = "$(printf 'a\\tb')" ]`,
  wordSplit: 'v="a b"; set -- $v; [ $# = 1 ]',
  typesetScope: 'f() { typeset v=in; }; v=out; f; [ "$v" = in ]',
  arrayBase: 'a=(x y); [ "${a[1]}" = x ]',
  dirTilde: 'd=$PWD; cd / && cd "$d" && [ ~+ = "~+" ] && [ ~- = "~-" ] && [ ~0 = "~0" ]',
  globSkipDots: 'set -- .*; [ "$1" = . ]',
  globIgnore: 'GLOBIGNORE=ab; set -- a*; [ $# = 2 ]',
};

const quoted = (code: string): string => `'${code.replace(/'/g, `'\\''`)}'`;
const script = Object.entries(PROBES).map(([id, code]) => `( eval ${quoted(code)} ) >/dev/null 2>&1 && printf '%s ' ${id}`).join('\n') + '\necho';

describe('the behaviour table agrees with the installed shells', () => {
  let dir: string;
  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-behaviours-'));
    for (const f of ['.a', 'a', 'ab']) fs.writeFileSync(path.join(dir, f), '');
  });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('has a probe for every row', () => {
    assert.deepStrictEqual(Object.keys(PROBES).sort(), Object.keys(SHELL_BEHAVIOURS).sort());
  });

  for (const { shell, letter, bins, args } of SHELLS) {
    const bin = locate(bins);
    (bin ? it : it.skip)(shell, async () => {
      const r = await runContained([bin!, ...args, '-c', script], dir);
      const differ = r.stdout.trim().split(' ').filter(Boolean).sort();
      const listed = (Object.keys(SHELL_BEHAVIOURS) as BehaviourId[]).filter((id) => SHELL_BEHAVIOURS[id].differs.includes(letter)).sort();
      assert.deepStrictEqual(differ, listed, `${shell}: ${r.stderr}`);
    });
  }
});

describe('isBash, asBash and the shells a script may run in', () => {
  it('reads `sh` as any of bash, dash and busybox ash', () => {
    assert.deepStrictEqual(shellsOf('sh'), ['bash', 'dash', 'ash']);
    assert.deepStrictEqual(shellsOf(undefined), ['bash']);
    assert.deepStrictEqual(shellsOf('mksh'), ['mksh']);
  });

  it('says whether the shell is bash: yes, no or not known', () => {
    const of = (shells: (Shell | undefined)[]) => shells.map((s) => isBash(s));
    assert.deepStrictEqual(of([undefined, 'bash', 'sh', 'dash', 'ash', 'yash', 'ksh', 'mksh', 'zsh']), ['yes', 'yes', 'unknown', 'no', 'no', 'no', 'no', 'no', 'no']);
  });

  it('says whether a shell does as bash does, and which differ', () => {
    assert.strictEqual(asBash('wordSplit', 'zsh'), 'no');
    assert.strictEqual(asBash('wordSplit', 'sh'), 'yes');
    assert.strictEqual(asBash('dirTilde', 'sh'), 'unknown');
    assert.strictEqual(asBash('dirTilde', 'dash'), 'no');
    assert.strictEqual(asBash('globIgnore', undefined), 'yes');
    assert.deepStrictEqual(differIn('echoEscape', 'sh'), ['dash']);
    assert.deepStrictEqual(differIn('globSkipDots', 'sh'), ['dash', 'ash']);
    assert.deepStrictEqual(differIn('arrayBase', 'zsh'), ['zsh']);
    assert.deepStrictEqual(differIn('arrayBase', 'bash'), []);
  });

  it('follows the words of bash and of the common sh only', () => {
    const shells: (Shell | undefined)[] = [undefined, 'bash', 'sh', 'dash', 'ash', 'yash', 'ksh', 'mksh', 'zsh'];
    assert.deepStrictEqual(shells.filter((s) => wordsFollowed(s)), [undefined, 'bash', 'sh', 'dash', 'ash']);
  });
});
