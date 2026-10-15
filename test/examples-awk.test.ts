import * as assert from 'assert';
import { execFileSync } from 'child_process';
import { awkExample, runAwk, sprintf } from '../src/examples/awk';

function realAwk(prog: string, input: string[], fs?: string, vars: Record<string, string> = {}): string[] {
  const args = [...(fs ? ['-F', fs] : []), ...Object.entries(vars).flatMap(([k, v]) => ['-v', `${k}=${v}`]), prog];
  const out = execFileSync('gawk', args, { input: input.join('\n') + '\n' }).toString();
  return out === '' ? [] : out.replace(/\n$/, '').split('\n');
}

const programs: [string, string?][] = [
  ['$3 > 100 { print $1 }', ','], ['!seen[$0]++'], ['NR > 1 { total += $2; count++ }\nEND { printf "avg: %.2f\\n", total / count }'],
  ['{ print $NF }'], ['BEGIN { FS = ":" } $NF ~ /bash$/ { print $1 }'], ['{ if (length($0) > 10) print NR": "$0; else n++ } END { print n+0 }'],
  ['{ gsub(/a/, "A"); $2 = toupper($2); print }'], ['{ sum += $2 } END { print sum, sum/NR }'], ['{ print $1, $2 * 2 }'],
  ['NR % 2 == 0'], ['{ printf "%-8s|%5.1f|%05d|%x|%e|%g\\n", $1, $2, $2, $2, $2, $2 / 3 }'], ['BEGIN { print "start" } END { print NR " lines" }'],
  ['{ $1 = ""; print }'], ['{ n = split($0, a, ","); print n, a[1] }'], ['/start/,/end/'], ['{ print substr($1, 2, 3), index($1, "an") }'],
  ['{ s = s $1 } END { print s }'], ['{ print ($2 > 5 ? "big" : "small") }'], ['function f(x) { return x * 2 } { print f($2) }'],
  ['{ NF = 2; print }'], ['{ $5 = "x"; print; print NF }'], ['BEGIN { OFS = "-" } { $1 = $1; print }'], ['{ print length(), length($1) }'],
  ['{ for (i = NF; i > 0; i--) printf "%s%s", $i, (i > 1 ? OFS : ORS) }'], ['{ i = 0; while (i < 2) { i++; print i, $i } }'],
  ['$2 ~ /^[0-9]+$/ && $2 >= 10'], ['{ print toupper(substr($1, 1, 1)) substr($1, 2) }'], ['match($0, /[0-9]+/) { print RSTART, RLENGTH }'],
  ['{ sub(/^[a-z]+/, "[&]"); print }'], ['BEGIN { x = 2 ^ 10; print x, x % 7, -x, int(3.9), 1e3 }'], ['NR == 2 { exit } { print }'],
];

describe('awk examples agree with gawk', () => {
  for (const [prog, fs] of programs) {
    it(prog.replace(/\n/g, '⏎'), () => {
      const ex = awkExample(prog, { fs });
      assert.ok(ex, 'has an example');
      const out = ex.output[ex.output.length - 1] === '…' ? ex.output.slice(0, -1) : ex.output;
      assert.deepStrictEqual(out, realAwk(prog, ex.input, fs).slice(0, out.length), `input ${JSON.stringify(ex.input)}`);
    });
  }

  it('for-in loops produce the same lines (order is unspecified)', () => {
    const prog = '{ count[$1]++ } END { for (k in count) print k, count[k] }';
    const ex = awkExample(prog)!;
    assert.deepStrictEqual([...ex.output].sort(), realAwk(prog, ex.input).sort());
  });

  it('honours -v variables', () => {
    const prog = '$2 > min { print $1 }';
    const input = ['a 1', 'b 5', 'c 9'];
    assert.deepStrictEqual(runAwk(prog, input, { vars: { min: '4' } }), realAwk(prog, input, undefined, { min: '4' }));
  });
});

describe('awk example input', () => {
  it('straddles numeric thresholds and puts regex matches in the tested column', () => {
    assert.deepStrictEqual(awkExample('$3 > 100 { print $1 }', { fs: ',' })!.output, ['banana', 'cherry']);
    assert.deepStrictEqual(awkExample('BEGIN { FS = ":" } $NF ~ /bash$/ { print $1 }')!.output.length, 2);
  });

  it('repeats a line for counting idioms', () => {
    const ex = awkExample('!seen[$0]++')!;
    assert.strictEqual(ex.input.length, ex.output.length + 1);
  });

  it('gives up on features it does not run', () => {
    for (const p of ['{ print > "out" }', '{ getline x; print x }', '{ print rand() }', '{ system("ls") }', '{ print | "sort" }', 'BEGINFILE { }', '{ x = 1 / 0 }']) {
      assert.strictEqual(awkExample(p), undefined, p);
    }
  });

  it('formats like C printf', () => {
    assert.strictEqual(sprintf('%5.2f|%-4d|%03d|%x|%c|%.3s|%e|%g|%g', [3.14159, 7, 5, 255, 65, 'abcdef', 1234.5, 0.0001234, 1e7]), ' 3.14|7   |005|ff|A|abc|1.234500e+03|0.0001234|1e+07');
  });
});
