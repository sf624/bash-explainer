// The digits of printf against the real tools: bash's builtin and coreutils read a `long double`, whose bits depend on the
// machine, so what is shown is what is the same on all of them, and it must be what the real tools print here.
import * as assert from 'assert';
import { Analyzer } from '../src/analyzer';
import { fact } from '../src/messages';
import { exactOfDouble, floatText, sameInEveryLibrary } from '../src/examples/floatdigits';
import { bashPrintf } from '../src/examples/shellwords';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { run } from './support/run';

/** A format and its argument, each the same in every C library. */
const SHOWN: [string, string][] = [
  ['%.200f', '1'], ['%.200f', '0.5'], ['%.101f', '1.5'], ['%.150e', '0.25'], ['%.120g', '0.25'], ['%f', '3.14159'], ['%.2f', '3.14159'], ['%e', '3.14159'], ['%g', '3.14159'],
  ['%.1f', '0.25'], ['%.0f', '0.5'], ['%.0f', '1.5'], ['%.0f', '2.5'], ['%f', '1e21'], ['%f', '1e15'], ['%.15g', '0.1'], ['%.14f', '0.1'], ['%f', '010'], ['%e', '010'], ['%f', '0x10'], ['%g', '0x10'],
  ['%f', ''], ['%f', '-1.5'], ['%f', '+1.5'], ['%#g', '1.5'], ['%#.0f', '3'], ['%#.0e', '3'], ['%010.3f', '-1.5'], ['%-10.2f|', '1.5'], ['%+.1e', '1.5'], ['%G', '1e-10'], ['%E', '1.5'], ['%.f', '2.5'],
  ['%f', "'a"], ['%.*f', '-1'], ['%*d', '-4'], ['%d', '010'], ['%x', '255'], ['%.200d', '5'],
];
/** What depends on the bits of a `long double`, or a double cannot hold: no example. */
const NOT_SHOWN: [string, string][] = [['%.20f', '0.1'], ['%.25g', '0.1'], ['%.25e', '0.1'], ['%.1f', '0.15'], ['%.2f', '1.005'], ['%.2f', '2.675'], ['%.2e', '1.005'], ['%f', '1e400'], ['%e', '1e400'], ['%e', '1e-400'], ['%f', '1e30'], ['%e', '5e-324'], ['%f', '0x20000000000000001']];

const parser = createUnbashParser();
const examples = (line: string) => new Analyzer('en').explainLine(parser.parse(line), 0, 'bash').examples;

/** What a real printf prints of each row: in one process, as the rows are many. */
function real(program: string[], rows: [string, string][]): string[] {
  const script = rows.map(([format, arg]) => `${program.join(' ')} ${[format + '\\n', ...(format.includes('*') ? (format === '%.*f' ? [arg, '3.14159'] : [arg, '5']) : [arg])].map((w) => `'${w.replace(/'/g, "'\\''")}'`).join(' ')}`).join('\n');
  return run('bash', ['-c', script]).stdout.toString().split('\n').slice(0, -1);
}

const shown = (format: string, arg: string) => bashPrintf(`${format}\\n`, format.includes('*') ? [arg, format === '%.*f' ? '3.14159' : '5'] : [arg]).slice(0, -1);

describe('the digits of printf', () => {
  it('as bash prints them', () => {
    assert.deepStrictEqual(SHOWN.map(([f, a]) => shown(f, a)), real(['printf'], SHOWN));
  });

  it('as coreutils prints them', () => {
    const rows = SHOWN.filter(([f]) => f !== '%.f');
    assert.deepStrictEqual(rows.map(([f, a]) => shown(f, a)), real(['/usr/bin/env', 'printf'], rows));
  });

  it('nothing is shown of what depends on the machine', () => {
    for (const [format, arg] of NOT_SHOWN) assert.throws(() => bashPrintf(format, [arg]), /digits of a long double/, `${format} ${arg}`);
  });

  it('a field past what an example shows gives none', () => {
    for (const format of ['%10001d', '%.10001f', '%10001s', '%-10001s', '%.10001d']) assert.throws(() => bashPrintf(format, ['1']), /too wide/, format);
    assert.strictEqual(bashPrintf('%10000d', ['1']).length, 10000);
    assert.throws(() => bashPrintf('%*d', ['-10001', '1']), /too wide/);
  });

  it('the bits a value has decide: exact, or the same at both ends', () => {
    assert.ok(sameInEveryLibrary('0.25', 0.25, 'f', 300, false));
    assert.ok(sameInEveryLibrary('  -0.25', -0.25, 'f', 300, false));
    assert.ok(sameInEveryLibrary('0', 0, 'e', 300, false));
    assert.ok(sameInEveryLibrary('255', 255, 'e', 20, false));
    assert.ok(sameInEveryLibrary('0xff', 255, 'e', 20, false));
    assert.ok(!sameInEveryLibrary('0x20000000000000001', 2 ** 65, 'e', 20, false));
    assert.ok(!sameInEveryLibrary('1e400', Infinity, 'e', 20, false));
    assert.ok(!sameInEveryLibrary('1e-400', 0, 'f', 6, false));
    // (Too small for its bits to say anything.)
    assert.ok(!sameInEveryLibrary('4e-324', 5e-324, 'f', 6, false));
    assert.ok(sameInEveryLibrary('3.14159', 3.14159, 'f', 6, false));
    assert.ok(!sameInEveryLibrary('3.14159', 3.14159, 'f', 30, false));
  });

  it('a number no BigInt should be made of is refused at once, as a zero is shown as one', () => {
    for (const text of ['1e-300000000', '1e-999999999', '1e999999999', '5e-9999999999999', `1${'0'.repeat(2000)}e-2000`, `0.${'0'.repeat(5000)}1`, `1e${'9'.repeat(400)}`, `0.1e-${'9'.repeat(400)}`]) {
      const t = Date.now();
      for (const conv of ['f', 'e', 'g']) assert.ok(!sameInEveryLibrary(text, Number(text), conv, 6, false), text);
      assert.ok(Date.now() - t < 1000, `${text} took ${Date.now() - t} ms`);
    }
    // (A double of 0 is a zero that is written so, whatever its power of ten, or an underflow.)
    for (const text of ['0e100000000', '0.000e-999999999', '-0e5', '.0E99999999999', `${'0'.repeat(3000)}e-9999999`]) assert.ok(sameInEveryLibrary(text, 0, 'f', 6, false), text);
    assert.ok(!sameInEveryLibrary('0.0001e-400', 0, 'f', 6, false));
    assert.ok(!sameInEveryLibrary('1e-400', 0, 'f', 6, false));
    // (Which a real printf prints as zeros, as ours does where it shows them.)
    assert.strictEqual(shown('%f', '0e100000000'), '0.000000');
    assert.deepStrictEqual(real(['printf'], [['%f', '0e100000000'], ['%f', '1e-300000000'], ['%e', '1e999999999']]), ['0.000000', '0.000000', 'inf']);
    const t = Date.now();
    for (const line of [`printf '%f\\n' 1e-999999999`, `printf '%f\\n' 1e-300000000`, `printf '%f\\n' 0e100000000`]) examples(line);
    assert.ok(Date.now() - t < 2000, `${Date.now() - t} ms`);
    assert.ok(JSON.stringify(examples(`printf '%f\\n' 0e100000000`)).includes('0.000000'));
    assert.ok(JSON.stringify(examples(`printf '%f\\n' 1e-999999999`)).includes(fact('en', 'digits-not-computed').text));
  });

  it('where the digits depend on the machine, the example says so, in both languages, in place of its output', () => {
    for (const lang of ['en', 'ja'] as const) {
      const note = fact(lang, 'digits-not-computed').text;
      assert.ok(/machine|機械/.test(note));
      for (const line of [`printf '%.20f\\n' 0.1`, `printf '%.2f\\n' 2.675`, `printf '%.1f\\n' 0.15`, `printf '%s %.2f\\n' a 1.5 b 2.675`, `printf -v v '%.2f' 2.675`, `x=$(printf '%.2f' 2.675)`, `printf '%.2f\\n' 2.675 | sort`]) {
        const found = new Analyzer(lang).explainLine(parser.parse(line), 0, 'bash').examples;
        assert.deepStrictEqual(found.map((e) => [e.note, e.sections]), [[note, []]], `${lang} ${line}`);
      }
      // (Digits that are the same on every machine, and the doubles of awk and perl, are shown.)
      for (const line of [`printf '%.2f\\n' 1.5`, `awk 'BEGIN { printf "%.20f %.2f %.1f\\n", 0.1, 2.675, 0.15 }'`, `perl -e 'printf("%.20f %.2f %.1f\\n", 0.1, 2.675, 0.15)'`]) {
        const found = new Analyzer(lang).explainLine(parser.parse(line), 0, 'bash').examples;
        assert.ok(found.length === 1 && found[0].sections.length > 0 && !found[0].note?.includes(note), `${lang} ${line}`);
      }
    }
  });

  it('no example of what is not followed', () => {
    // (gawk prints the sign of a NaN; jq's own text for a repeat without end depends on its release; GNU seq's digits past 100.)
    for (const line of [`awk 'BEGIN { printf "%f", log(-1) }'`, `jq -n '"a" * 1e1000'`, `seq 1.${'0'.repeat(101)} 2`, `perl -e 'printf("%f", 9**9**9)'`, `perl -e 'print sprintf("%5d", 9**9**9 - 9**9**9)'`]) assert.deepStrictEqual(examples(line), [], line);
    assert.strictEqual(examples(`seq 1.${'0'.repeat(100)} 2`).length, 1);
  });

  it('perl prints what is no finite number as perl does', () => {
    for (const code of ['print 9**9**9', 'print -9**9**9', 'print 9**9**9 - 9**9**9', 'print "a" x 9**9**9, "b"', 'print "a" x 2', 'print "a" x -1, "b"']) {
      const said = JSON.stringify(examples(`perl -e '${code}'`));
      const real = run('perl', ['-e', code], { ignoreStderr: true }).stdout.toString();
      assert.ok(said.includes(`"${real}"`) || (real === '' && said.includes('[]')), `${code}: ${said} ${real}`);
    }
  });

  it('every kind of double', () => {
    const text = (n: number, conv: string, prec: number) => floatText(exactOfDouble(n), conv, prec, false);
    assert.strictEqual(text(5e-324, 'e', 2), '4.94e-324');
    assert.strictEqual(text(2 ** 60, 'f', 0), '1152921504606846976');
    assert.strictEqual(text(0.001, 'e', 0), '1e-03');
    assert.strictEqual(text(1e23, 'e', 20), '9.99999999999999916114e+22');
    assert.strictEqual(text(9.5, 'e', 0), '1e+01');
    assert.strictEqual(text(1e100, 'E', 1), '1.0E+100');
  });
});
