// sudo's options on Linux (sudo 1.9, sudo(8)): `-a` and `-c` (and `--auth-type`, `--login-class`) are BSD's and are in no
// manual here, but sudo still reads them and then prints its usage and fails; any other option it does not have is
// `invalid option` (`unrecognized option` for a long one). The spec marks `-a` and `-c` as refused (`OptionSpec.refused`)
// and has `unknownOption` for the rest; a reading with either is a refused reading (`Outcome`), so `sudo -u $u tar -cf x y`
// with `$u` empty is not read as sudo with a login class and `x` as the command. The real sudo is run for what it prints
// (only options it refuses before it asks for anything).
import * as assert from 'assert';
import { spawnSync } from 'child_process';
import { lookupCommand } from '../src/analyzer';
import { allTokens, explain } from './support/explain';

const manual = spawnSync('man', ['-P', 'cat', 'sudo'], { encoding: 'utf8', env: { ...process.env, MANWIDTH: '200', LC_ALL: 'C' } });
const options = () => lookupCommand('sudo')!.options ?? [];
const said = (line: string, label: string, lang: 'ja' | 'en' = 'en'): string => allTokens(explain(line, 0, lang).items).find((x) => x.label === label)!.explanation;
const sudo = spawnSync('sudo', ['-V'], { encoding: 'utf8', input: '' });
const real = (...args: string[]): { status: number | null; err: string } => {
  const r = spawnSync('sudo', args, { encoding: 'utf8', input: '', timeout: 10000 });
  return { status: r.status, err: r.stderr };
};

describe('sudo on Linux: -a and -c', () => {
  it('are options sudo reads and then refuses, and no other option of the spec is', () => {
    const refused = options().filter((o) => o.refused).flatMap((o) => o.names);
    assert.deepStrictEqual(refused.sort(), ['--auth-type', '--login-class', '-a', '-c']);
  });
  (manual.status === 0 && /--askpass/.test(manual.stdout) ? it : it.skip)('every other option of the spec is in the sudo(8) of this machine, and these are not', () => {
    // (The names on the lines that head an option: "-A, --askpass".)
    const listed = new Set(manual.stdout.split('\n').filter((l) => /^ {7}-/.test(l)).flatMap((l) => [...l.matchAll(/(?:^ +|, )(--?[A-Za-z][\w-]*)/g)].map((m) => m[1])));
    for (const o of options()) for (const n of o.names) assert.strictEqual(listed.has(n), !o.refused, n);
  });
  it('are said to fail, in English and Japanese, and take their value', () => {
    for (const [lang, text] of [['en', 'sudo on Linux reads the option, then prints its usage and fails'], ['ja', 'Linux の sudo は読んだあと']] as const) {
      assert.ok(said('sudo -c foo ls', '-c', lang).includes(text));
      assert.ok(said('sudo --login-class=x ls', '--login-class=x', lang).includes(text));
    }
    assert.match(said('sudo -c foo ls', 'foo'), /^Value for `-c`/);
  });
  it('make the reading refused: `sudo -u $u tar -cf x y` has no reading that runs `x` as a command', () => {
    const y = said('sudo -u $u tar -cf x y', 'y');
    assert.ok(!/argument of `x`/.test(y) && !/expands to nothing/.test(y), y);
  });
  (sudo.status === 0 && /1\.9/.test(sudo.stdout) ? it : it.skip)('are refused by the real sudo with its usage, and no message of an unknown option', () => {
    for (const args of [['-c', 'x', '-V'], ['--login-class=x', '-V'], ['-a', 'x', '-V'], ['-cx', 'ls'], ['--auth-type=x', 'ls']]) {
      const r = real(...args);
      assert.strictEqual(r.status, 1, args.join(' '));
      assert.match(r.err, /^usage: sudo -h/, args.join(' '));
    }
    assert.match(real('-c').err, /option requires an argument -- 'c'/);
  });
});

describe('sudo on Linux: an option it does not have', () => {
  it('is said as sudo says it, and does not mention the BSD options', () => {
    for (const label of ['-Z', '--frob']) {
      const t = said(`sudo ${label} ls`, label);
      assert.ok(t.includes('`invalid option`') && t.includes('`unrecognized option`') && !t.includes('BSD'), t);
    }
    assert.ok(said('sudo -Z ls', '-Z', 'ja').includes('`invalid option`'));
    // (A long one with a value after `=`.)
    assert.ok(said('sudo --frob=x ls', '--frob=x').includes('`unrecognized option`'));
  });
  it('is the ambiguous option sudo reports for a prefix of several long options', () => {
    assert.match(said('sudo --pre ls', '--pre'), /^Ambiguous option \(it starts several long options: `--preserve-env`, `--preserve-groups`\); sudo refuses it/);
  });
  (sudo.status === 0 && /1\.9/.test(sudo.stdout) ? it : it.skip)('is refused by the real sudo as the text says', () => {
    assert.match(real('-Z', 'ls').err, /^sudo: invalid option -- 'Z'/);
    assert.match(real('--frob').err, /^sudo: unrecognized option '--frob'/);
    assert.match(real('--frob=x', 'ls').err, /^sudo: unrecognized option '--frob=x'/);
    assert.match(real('--pre', 'ls').err, /^sudo: option '--pre' is ambiguous; possibilities: '--preserve-env' '--preserve-groups'/);
  });
  it('does not widen the other readings of the words after it, where the line as written is the refused one', () => {
    // (The written reading is refused, but its role is the one said first; the words of `$u` after the first run a command the dictionary does not describe.)
    assert.strictEqual(said('sudo -u $u -Z ls y', 'y'), 'file or directory (default: current). When `$u` expands to several words, it is argument of the command a word of `$u` names');
    assert.strictEqual(said('sudo -u $u -c x ls y', 'y'), 'file or directory (default: current). When `$u` expands to nothing, it is argument of `x`. When `$u` expands to several words, it is argument of the command a word of `$u` names');
    assert.strictEqual(said('kill -s $sig -Z 1', '1'), 'target PID or job spec (`%1`)');
  });
});
