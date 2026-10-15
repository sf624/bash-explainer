import * as assert from 'assert';
import { spawnSync } from 'child_process';
import { perlExample, perlOptions, runPerl } from '../src/examples/perlrun';

function realPerl(words: string[], input: string[]): string[] {
  const out = spawnSync('perl', words.map((w) => (/^-[a-zA-Z]*i/.test(w) ? w.replace('i', '') || '-p' : w)), { input: input.length ? input.join('\n') + '\n' : '' }).stdout.toString();
  return out === '' ? [] : out.replace(/\n$/, '').split('\n');
}

const cases: string[][] = [
  ['-pe', 's/foo(\\d+)/bar$1/g'], ['-ne', 'print if /^ERROR/'], ['-lane', 'print $F[1] if $F[2] > 100'], ['-F:', '-lane', 'print $F[0]'],
  ['-nle', '$sum += $_; END { print $sum }'], ['-lne', '$c{$_}++; END { print "$_ $c{$_}" for sort keys %c }'], ['-pe', 'tr/a-z/A-Z/'],
  ['-lne', 'print length'], ['-pe', '$_ = uc'], ['-lne', 'print "$.: $_"'], ['-ne', 'print unless /^\\s*#/'], ['-lane', 'print join ",", @F'],
  ['-le', 'print for 1..3'], ['-pe', 's/\\s+$//'], ['-lne', 'next if /^$/; print scalar reverse $_'], ['-lane', '$t += $F[1]; END { printf "%.2f\\n", $t / $. }'],
  ['-pe', 's/(\\w+)/\\u$1/g'], ['-lne', 'my @w = split /,/; print $w[1]'], ['-pi', '-e', 's/a/b/'], ['-lne', 'print "$1-$2" if /(\\w+) (\\w+)/'],
  ['-lne', 'print uc($_) . "!"'], ['-lane', 'print $F[-1]'], ['-lne', '$n++ if /e/; END { print $n }'], ['-pe', 's/^/> /'],
  ['-lne', 'print if length > 8'], ['-le', 'print join "-", map { $_ * 2 } 1..3'],
];

describe('perl examples agree with perl', () => {
  for (const words of cases) {
    it(words.join(' '), function () {
      const parsed = perlOptions(words);
      const ex = parsed && perlExample(parsed.code, parsed.opts);
      if (words.join(' ').includes('map {')) {
        assert.strictEqual(ex, undefined, 'map is not supported');
        return;
      }
      assert.ok(ex, 'has an example');
      const out = ex.output[ex.output.length - 1] === '…' ? ex.output.slice(0, -1) : ex.output;
      assert.deepStrictEqual(out, realPerl(words, ex.input).slice(0, out.length), `input ${JSON.stringify(ex.input)}`);
    });
  }
  it('declines what it cannot run', () => {
    assert.strictEqual(runPerl('print while <>', { loop: 'n' }, ['a']), undefined);
    assert.strictEqual(runPerl('print if 2..3', { loop: 'n' }, ['a', 'b', 'c']), undefined);
    assert.strictEqual(perlOptions(['script.pl']), undefined);
  });
});
