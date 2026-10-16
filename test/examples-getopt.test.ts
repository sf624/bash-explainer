import * as assert from 'assert';
import { spawnSync } from 'child_process';
import { GetoptSpec, runGetopt, sampleGetoptArgs } from '../src/examples/getopt';

/** Real getopt's output for the spec and arguments. */
function real(spec: GetoptSpec, args: string[]): string {
  const opts = spec.legacy ? [spec.short] : ['-o', spec.short, ...(spec.long.length ? ['--long', spec.long.join(',')] : []), ...(spec.alternative ? ['-a'] : []), '--'];
  const env = { ...process.env };
  delete env.POSIXLY_CORRECT;
  return spawnSync('getopt', [...opts, ...args], { env }).stdout.toString().replace(/\n$/, '');
}

describe('getopt agrees with util-linux getopt', () => {
  const specs: GetoptSpec[] = [
    { short: 'hv:o:', long: ['help', 'verbose:', 'output:'] },
    { short: 'hc::', long: ['help', 'color::'] },
    { short: '+hv:', long: [] },
    { short: '-hv:', long: ['level:'] },
    { short: 'ab', long: ['dry-run', 'jobs:', 'name:'] },
    { short: 'h', long: ['long:'], alternative: true },
    { short: 'hv:', long: [], legacy: true },
  ];
  const extra: string[][] = [
    ['file1', '-hv3', '--output=o.txt', "it's", '--out', 'x', '--', '-z'],
    ['-c', '-cred', '--color', '--col=blue', 'a b'],
    ['-h', 'file', '-v', '1'],
    ['a', '-h', 'b', '-v', '1', 'c', '--lev', '2'],
    ['--dry', '--jobs', '4', '-ba', 'x'],
    ['-long', 'x', '-h', '--long=y'],
    ['-h', '-v', '2', 'file'],
  ];
  specs.forEach((spec, i) => {
    const label = `${spec.legacy ? '' : '-o '}${spec.short}${spec.long.length ? ` --long ${spec.long.join(',')}` : ''}${spec.alternative ? ' -a' : ''}`;
    for (const args of [sampleGetoptArgs(spec), extra[i]]) {
      it(`${label} -- ${args.join(' ')}`, () => {
        assert.strictEqual(runGetopt(spec, args), real(spec, args));
      });
    }
  });
});
