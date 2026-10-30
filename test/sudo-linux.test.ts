// sudo's options on Linux (sudo 1.9, sudo(8)): `-a` and `-c` are in the BSD builds only. The spec lists the Linux options,
// and `unknownOption` says the tool refuses any other, so a reading with one of them is a refused reading (`Outcome`):
// `sudo -u $u tar -cf x y` with `$u` empty is not read as sudo with a login class and `x` as the command.
import * as assert from 'assert';
import { spawnSync } from 'child_process';
import { lookupCommand } from '../src/analyzer';
import { allTokens, explain } from './support/explain';

const manual = spawnSync('man', ['-P', 'cat', 'sudo'], { encoding: 'utf8', env: { ...process.env, MANWIDTH: '200', LC_ALL: 'C' } });
const flags = (): string[] => (lookupCommand('sudo')!.options ?? []).flatMap((o) => o.names);

describe('sudo on Linux has no -a and no -c', () => {
  it('the spec lists no option that is BSD-only', () => {
    const names = flags();
    assert.ok(names.includes('-u'));
    assert.ok(!names.includes('-a') && !names.includes('-c') && !names.includes('--login-class') && !names.includes('--auth-type'));
  });
  (manual.status === 0 && /--askpass/.test(manual.stdout) ? it : it.skip)('every option the spec lists is in the sudo(8) of this machine, and the BSD ones are not', () => {
    const page = manual.stdout;
    for (const n of flags()) assert.ok(page.includes(n), `${n} is not in sudo(8)`);
    assert.ok(!/^\s+-c, --login-class/m.test(page) && !/^\s+-a, --auth-type/m.test(page));
  });
  it('says that sudo refuses -c', () => {
    for (const [lang, text] of [['en', 'does not have'], ['ja', 'にない']] as const) {
      const t = allTokens(explain('sudo -c foo ls', 0, lang).items).find((x) => x.label === '-c')!;
      assert.ok(t.explanation.includes(text) && t.explanation.includes('BSD'), t.explanation);
    }
  });
  it('does not read -cf of `sudo -u $u tar -cf x y` as a login class when $u gives nothing', () => {
    const y = allTokens(explain('sudo -u $u tar -cf x y').items).find((x) => x.label === 'y')!;
    assert.ok(!/argument of `x`/.test(y.explanation), y.explanation);
    assert.ok(!/expands to nothing/.test(y.explanation), y.explanation);
  });
});
