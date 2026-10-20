import * as assert from 'assert';
import { spawnSync } from 'child_process';
import { run } from './support/run';
import { awkExample, awkInvocation, runAwk, sprintf } from '../src/examples/awk';

function realAwk(prog: string, input: string[], fs?: string, vars: Record<string, string> = {}): string[] {
  const args = [...(fs ? ['-F', fs] : []), ...Object.entries(vars).flatMap(([k, v]) => ['-v', `${k}=${v}`]), prog];
  const out = run('gawk', args, { input: input.join('\n') + '\n', check: true }).stdout.toString();
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
  // Statements, operators and functions the ones above do not reach.
  ['{ if ($2 > 5) { print "big" } else if ($2 > 2) { print "mid" } else { print "small" } }'], ['{ n = 0; do { n++ } while (n < 3); print n }'],
  ['BEGIN { while (i++ < 4) { if (i == 2) continue; if (i == 4) break; print i } }'], ['BEGIN { split("a b c", arr); print (2 in arr), ("z" in arr) }'],
  ['{ print tolower($1), exp(0), log(1), sqrt(16), int(-3.5) }'], ['$2 > 5 || $1 == "x"'], ['!($2 > 5)'], ['{ x = $2; x++; ++x; x--; print x, x ^ 2 }'],
  ['function g(a, b,   loc) { loc = a b; return loc } { print g($1, "!") }'], ['{ a[NR] = $1 } END { for (i = NR; i >= 1; i--) print a[i] }'],
  ['{ a[$1]++ } END { for (k in a) delete a[k]; print length(a) }'], ['{ s = $1; s = s "x"; t = (s < "b"); print s, t }'],
  ['function f(x,   arr) { arr[x] = 1; arr["y"] = 2; n = 0; for (k in arr) n++; return n } { print f($1) }'], ['{ n = split($0, a, /[ ,]/); print n, a[2] }'],
  ['$0 ~ "[0-9]+"'], ['{ print cos(0), atan2(0, 1) }'], ['{ for (i = 1; i <= 3; i++) { if (i == 2) continue; if (i == 3) break; print i } }'],
  ['{ i = 0; while (1) { i++; if (i == 1) continue; if (i > 2) break } print i }'], ['{ i = 0; do { i++; if (i == 1) continue; if (i > 2) break } while (1); print i }'],
  ['{ a[1] = 1; delete a; print length(a) }'], ['NR == 2 { exit } END { print "end", NR }'], ['BEGIN { print "b"; exit } END { print "e" }'], ['END { print "a"; exit; print "b" }'],
  ['BEGIN { FS = ", *" } { print $2 }', undefined],
  ['function f(x) { return 10 - x } { print f($2) }'], ['function f(x) { return int(x * 2) } { print f($2) }'], ['function f(x) { if (x > 1) return 1; return 0 } { print f($2) }'],
  ['10 < $2'], ['{ i = 1 } $i ~ /an/'], ['$2 > 0'], ['$2 > 2.5'], ['/z$/ { print $2 }'], ['$9 ~ /a/ { print $1 }'], ['$1 ~ /x|y/ { print $2 }'],
  ['function f(x) { print x + 1 } { f($2) }'], ['{ print $2 }', '\\t'], ['{ print $2 }', '[,;]'], ['{ print $2 }', 'ab'], ['{ a[1]; a[2]; a[3]; for (k in a) { n++; if (n == 2) continue; if (n == 3) break } print n }'],
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

describe('awk command lines (options and name=value operands) agree with gawk', () => {
  const input = ['a|b c|d', 'x|y z|w', 'tab\there'];
  const lines: string[][] = [
    ['{print $1,$2}', 'OFS=,'], ['{print $1,$2}', 'OFS=\\t'], ['-v', 'OFS=\\t', '{print $1,$2}'], ['-vOFS=-', '{$1=$1;print}'],
    ['-F', '\\|', '{print $2}'], ['-F', '\\\\|', '{print $2}'], ['-F\\|', '{print $2}'], ['-F', '[|]', '{print $2}'], ['-F', '|', '{print $2}'], ['-F', '\\t', '{print $2}'],
    ['-F', '\t', '{print $2}'], ['{print $2}', 'FS=|'], ['BEGIN{print x}', 'x=1'], ['{print x, $1}', 'x=a\\tb'], ['-v', 'x=a\\\\b', 'BEGIN{print x}'],
    ['END{print x, NR}', 'x=5'], ['-v', 'n=\\101', 'BEGIN{print n}'], ['{print $1}', 'ORS=;'], ['-v', 'x=1', '{print x,y}', 'y=2', '-'],
    ['-f', 'prog.awk'].slice(0, 0).concat(['{print NF}']),
  ];
  for (const words of lines) {
    it(words.join(' '), () => {
      const inv = awkInvocation(words);
      assert.strictEqual(inv.unsupported, undefined);
      const out = runAwk(inv.program!, input, inv);
      const real = run('gawk', words, { input: input.join('\n') + '\n', check: true }).stdout.toString();
      assert.deepStrictEqual(out, real === '' ? [] : real.replace(/\n$/, '').split('\n'));
    });
  }
  it('refuses what it cannot follow', () => {
    for (const words of [['{print}', 'f', 'x=1'], ['-v', 'x=\\q', '{print}'], ['{print}', 'x=\\q'], ['-F', '\\d', '{print}'], ['--posix', '{print}'], ['-v', 'x', '{print}'], ['-F'], [undefined, 'x']]) {
      assert.ok(awkInvocation(words).unsupported !== undefined, JSON.stringify(words));
    }
    const f = awkInvocation(['-f', 'p.awk', 'x=1']);
    assert.deepStrictEqual([f.program, f.assigns], [undefined, { x: '1' }]);
    assert.strictEqual(awkInvocation(['--', '{print}']).program, '{print}');
  });
  it('makes up input that uses the separator', () => {
    const ex = awkExample('{ print $2 }', { fs: '\\|' })!;
    assert.ok(ex.input.every((l) => l.includes('|')), JSON.stringify(ex.input));
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

describe('the awk runner agrees with gawk on the less common parts', () => {
  const input = ['apple 3 x,y', 'banana 10 z', '', 'cherry -2.5 0x1F', 'Date 0 a b c'];
  const programs = [
    'BEGIN { while (0); print "w" }', 'BEGIN { for (;;) break; print "f" }', 'BEGIN { for (i = 0; i < 2; i++); print i }', 'BEGIN { print (1)(2) }',
    '{ if (NR == 2) next; print }', 'function f() { return } BEGIN { print "[" f() "]" }', 'END { print "e"; exit }', 'BEGIN { printf("%s-%s\\n", "a", "b") }',
    'BEGIN { print !0, -"3", +"4", !"", 2^-1, 2^!0; x = 0; print $!x }', '{ print; exit 0 }', '{ print length }',
    '{ if ($2) print "t:" $1; if ("") print "never" }', '$2 <= 3', 'BEGIN { printf "%.f|%+f|% f|%.0g|%#.3g|%G|%E|%.62f\\n", 2.5, 1, 1, 0, 1, 1e-10, 12345, 0.1 }',
    '{ NF = 7; print; print NF }', 'BEGIN { n = split("", a, ","); print n }', 'BEGIN { print match("abc", "z"), RSTART, RLENGTH }',
    'function g(b) { return b[1] } function f(a) { a[1] = 2; return g(a) } BEGIN { print f(x) }',
    '{ if ($1 == "apple" &&\n $2 > 1) print; x = 0 ||\n 1; print x }', 'BEGIN { if (u) print "y"; else print "n" }', 'BEGIN { n = split("", a, /,/); print n }',
    'BEGIN { print match("abc", /b/), RSTART, RLENGTH }', 'BEGIN { n = split("a b", w); print n, w[2] }', 'BEGIN { s = "abc"; sub(/b/, "[\\\\&]", s); print s }',
    'BEGIN { s = "abc"; sub(/b/, "<' + '\\'.repeat(4) + '>", s); print s }',
    'BEGIN { s = "abc"; sub(/b/, "<' + '\\'.repeat(4) + '&>", s); print s }', 'BEGIN { s = "abc"; sub(/b/, "\\\\", s); print s }', 'function f() { return 3 } BEGIN { print f() }', 'BEGIN { a[1, 2] = 3; if ((1, 2) in a) print "y" }',
    'BEGIN { print "\\101\\t|" }', '$2 == 3', '{ if ($3) print "t:" $1; else print "f:" $1 }', '{ print ($1 < $2), ($2 < 5) }',
    'BEGIN { printf "%%|%*.*f|%-5d|% d|%+d|%05d|%.3d|%X|%c|%c|%5s|\\n", 8, 2, 3.14159, 4, 5, 6, -7, 8, 255, 65, "hello", "ab" }',
    'BEGIN { print substr("hello", 0, 2), substr("hello", -1, 3), substr("hello", -1), substr("hello", 2, -1), substr("hello", 1.5, 2.3), substr("hello", 2.5, 2) }', '{ print toupper($1), tolower($1) }',
    '{ $7 = "q"; print; print NF }', 'BEGIN { FS = "," } { print NF, $1 }', '$2 != 3', 'function f(arr) { return arr[1] } BEGIN { a[1] = 5; print f(a) }',
    'BEGIN { s = "abc"; sub(/b/, "[\\\\&|&]", s); print s }', 'BEGIN { print match("abc", /z/), RSTART, RLENGTH }', 'BEGIN { print sprintf("%03d", 7), sin(0) }',
    'function f() { next } { if (NR == 1) f(); print }', '{ print $2 - 1, $2 / 4, $2 % 3 }', 'BEGIN { x = "3x"; print x + 1, (x == 3) }',
    'function f(n) { while (1) { if (n-- < 0) return n } } BEGIN { print f(2) }', 'function f(n) { for (;;) { return n } } BEGIN { print f(4) }',
    'function f(n) { do { return n } while (1) } BEGIN { print f(5) }', 'function f(a,  k) { for (k in a) return k } BEGIN { b["q"]; print f(b) }',
    '{ n = split($0, w); print n, w[n] }', '{ n = split("", w); print n }', '$0 ~ $1', '$0 ~ "an"',
  ];
  for (const prog of programs) {
    it(prog, () => {
      assert.deepStrictEqual(runAwk(prog, input, {}), realAwk(prog, input));
    });
  }
  it('makes no example for what it does not run', () => {
    assert.strictEqual(awkExample('{ x = (1, 2) }'), undefined);
    assert.ok(awkExample('$1 ~ /[é]/ { print }'));
  });
  it('gives up on what it does not run', () => {
    for (const prog of ['BEGIN { print 1 print 2 }', 'BEGIN { 1++ }', 'BEGIN { while (1) i++ }', 'BEGIN { a[1] = 1; print a }', '{ print $(-1) }', '{ $(-1) = 1 }',
      '$0 ~ "[[:foo:]]"', '{ split($0, $1) }', '{ sub(/a/, "b", "x") }', 'BEGIN { printf }', 'BEGIN { print 1 / 0 }', 'BEGIN { print systime() }', 'BEGIN', 'BEGIN {', 'BEGIN { print (1 }',
      'BEGIN { print $++i }', '{ print }}', 'BEGIN { getline; print $0 }',
      '{ x = 1 +', '{ nextfile }', 'BEGIN { x = (\n1); print x }', 'BEGIN { ++1 }', '/[[:foo:]]/', 'BEGIN { x = if }', '{ print $-1 }', 'BEGIN { print foo(1) }', 'BEGIN { print 1 % 0 }',
      'END { next }', 'BEGIN { break }', 'BEGIN { x = (1, 2) }', 'BEGIN { continue }', 'BEGIN { return 1 }', 'BEGIN { print toupper() }', 'function f(a) { a[1] = 1; return a } BEGIN { print f(x) }']) {
      assert.strictEqual(runAwk(prog, input, {}), undefined, prog);
    }
  });
});

describe('the run helper', () => {
  it('does not fail with EPIPE when the tool never reads a large input', function () {
    if (spawnSync('gawk', ['--version']).status !== 0) this.skip();
    const input = 'x'.repeat(99) + '\n';
    const r = run('gawk', ['BEGIN { print "done" }'], { input: input.repeat(10000), check: true });
    assert.strictEqual(r.stdout.toString(), 'done\n');
  });
});
