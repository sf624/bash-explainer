import * as assert from 'assert';
import { execFileSync } from 'child_process';
import { explainDate, explainPrintf, formatDate, parseSampleDate, printfNote } from '../src/embedded/format';

function parts(src: string, ts = explainPrintf(src, 'en')): string[] {
  return ts.map((t) => src.slice(t.start, t.end));
}

describe('printf formats', () => {
  it('splits specifiers, escapes and literal text', () => {
    const src = '%-10s|%05.2f|%x\\n';
    assert.deepStrictEqual(parts(src), ['%-10s', '|', '%05.2f', '|', '%x', '\\n']);
    const ts = explainPrintf(src, 'en');
    assert.match(ts[0].explanation, /value 1 as a string \(left-aligned in 10 columns\)/);
    assert.match(ts[2].explanation, /value 2 as a decimal number \(fixed point\) \(right-aligned in 5 columns, padded with zeros, 2 digits after the decimal point\)/);
    assert.match(ts[4].explanation, /value 3 as a hexadecimal number/);
    assert.match(ts[5].explanation, /newline/);
  });

  it('handles %%, precision on strings, %(…)T and bad specifiers', () => {
    assert.match(explainPrintf('100%%', 'en')[1].explanation, /literal "%"/);
    assert.match(explainPrintf('%.3s', 'en')[0].explanation, /at most 3 characters/);
    assert.match(explainPrintf('%(%F)T', 'en')[0].explanation, /formatted with `%F`/);
    assert.strictEqual(explainPrintf('%y', 'en')[0].kind, 'error');
    assert.match(explainPrintf('\\033[1m', 'en')[0].explanation, /octal code 033/);
  });

  it('notes how many values one use of the format takes', () => {
    assert.match(printfNote('%s=%s\\n', 'en')!, /2 values per use; extra arguments reuse the format/);
    assert.strictEqual(printfNote('hello\\n', 'en'), undefined);
  });
});

describe('date formats', () => {
  it('explains each conversion and flag', () => {
    const src = '+%Y-%m-%dT%H:%M:%S';
    const ts = explainDate(src, 'en');
    assert.deepStrictEqual(parts(src, ts), ['+', '%Y', '-', '%m', '-', '%d', 'T', '%H', ':', '%M', ':', '%S']);
    assert.match(explainDate('+%-d', 'en')[1].explanation, /day of month .*\(no padding\)/);
    assert.match(explainDate('+%:z', 'en')[1].explanation, /\+09:00/);
    assert.strictEqual(explainDate('+%Q', 'en')[1].kind, 'error');
  });

  it('renders the same text as GNU date -u', function () {
    try {
      if (!/GNU/.test(execFileSync('date', ['--version']).toString())) return this.skip();
    } catch {
      return this.skip();
    }
    const formats = ['%Y-%m-%dT%H:%M:%S', '%F %T', '%-d %B %Y (%a)', '%D %R', '%j %u %w %e', '%^a %b %y %%', '%c', '%x', '%X', '%r', '%Z %z %:z %::z',
      '%U %W %V %G %g', '%s', '%N', '%C', '%I %l %k %p %P', '%h', '%-d %_m %0e', '%#p %#a %#Z', '%10Y %5d %-5d %_5e %3S', '%A, %B %-d', '%_H %_10Y %05H %08s %-p %_Z %10Z %10a'];
    // Week numbers and ISO years change around the turn of the year.
    for (const when of ['2024-03-05 07:08:09', '2025-12-31 23:59:59', '2021-01-03 12:00:00', '2020-12-31 00:30:00', '2027-01-01 13:05:00']) {
      for (const fmt of formats) {
        const expected = execFileSync('date', ['-u', '-d', when, `+${fmt}`], { env: { ...process.env, LC_ALL: 'C' } }).toString().replace(/\n$/, '');
        assert.strictEqual(formatDate(`+${fmt}`, parseSampleDate(when)!), expected, `${when} ${fmt}`);
      }
    }
    assert.strictEqual(formatDate('+%Q', parseSampleDate('2024-01-01')!), undefined);
    // Flags on composites are left out.
    assert.strictEqual(formatDate('+%-F', parseSampleDate('2024-01-01')!), undefined);
  });

  it('reads the dates typed in the panel', () => {
    assert.strictEqual(parseSampleDate('2024-03-05T07:08:09Z')?.toISOString(), '2024-03-05T07:08:09.000Z');
    assert.strictEqual(parseSampleDate('2024-3-5')?.toISOString(), '2024-03-05T00:00:00.000Z');
    assert.strictEqual(parseSampleDate('2024-02-30'), undefined);
    assert.strictEqual(parseSampleDate('tomorrow'), undefined);
  });
});
