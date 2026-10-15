import * as assert from 'assert';
import { execFileSync } from 'child_process';
import { explainDate, explainPrintf, printfNote, sampleDate } from '../src/embedded/format';

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

  it('renders the same text as date(1)', () => {
    const at = 1760600703; // a fixed moment, rendered in the local time zone by both sides
    for (const fmt of ['+%Y-%m-%dT%H:%M:%S', '+%F %T', '+%-d %B %Y (%a)', '+%D %R', '+%j %u %w %e', '+%^a %b %y %%']) {
      const expected = execFileSync('date', ['-d', `@${at}`, fmt], { env: { ...process.env, LC_ALL: 'C' } }).toString().replace(/\n$/, '');
      assert.strictEqual(sampleDate(fmt, new Date(at * 1000)), expected, fmt);
    }
    assert.strictEqual(sampleDate('+%Z'), undefined, 'zone names depend on the system');
  });
});
