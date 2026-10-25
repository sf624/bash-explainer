import * as assert from 'assert';
import { execFileSync } from 'child_process';
import { explainDate, explainPrintf, formatDate, parseSampleDate, printfNote, UTC } from '../src/embedded/format';
import { parseDateValue, relativeDate, zoneOf } from '../src/examples/dates';

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
    assert.match(explainPrintf('\\033[1m', 'en')[0].children[0].explanation, /octal code 033/);
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
    assert.match(explainDate('+%3N', 'en')[1].explanation, /first 3 digits of the fractional second \(milliseconds\); it is not a field width/);
    assert.match(explainDate('+%6N', 'ja')[1].explanation, /最初の 6 桁（マイクロ秒）/);
    assert.match(explainDate('+%9N', 'en')[1].explanation, /\(nanoseconds\)/);
    assert.match(explainDate('+%5N', 'en')[1].explanation, /first 5 digits of the fractional second;/);
    assert.match(explainDate('+%N', 'en')[1].explanation, /nanoseconds/);
    assert.strictEqual(explainDate('+%Q', 'en')[1].kind, 'error');
  });

  it('renders the same text as GNU date -u', function () {
    try {
      if (!/GNU/.test(execFileSync('date', ['--version']).toString())) return this.skip();
    } catch {
      return this.skip();
    }
    const formats = ['%Y-%m-%dT%H:%M:%S', '%F %T', '%-d %B %Y (%a)', '%D %R', '%j %u %w %e', '%^a %b %y %%', '%c', '%x', '%X', '%r', '%Z %z %:z %::z',
      '%U %W %V %G %g', '%s', '%N', '%C', '%I %l %k %p %P', '%h', '%-d %_m %0e', '%#p %#a %#Z', '%10Y %5d %-5d %_5e %3S', '%A, %B %-d', '%_H %_10Y %05H %08s %-p %_Z %10Z %10a', '%:::z %::z', '%3N|%6N|%9N|%12N|%1N|%10N', '%s%3N', '%s.%6N'];
    // Week numbers and ISO years change around the turn of the year.
    for (const when of ['2024-03-05 07:08:09', '2025-12-31 23:59:59', '2021-01-03 12:00:00', '2020-12-31 00:30:00', '2027-01-01 13:05:00']) {
      for (const fmt of formats) {
        const expected = execFileSync('date', ['-u', '-d', when, `+${fmt}`], { env: { ...process.env, LC_ALL: 'C' } }).toString().replace(/\n$/, '');
        assert.strictEqual(formatDate(`+${fmt}`, parseSampleDate(when)!), expected, `${when} ${fmt}`);
      }
    }
    assert.strictEqual(formatDate('+%Q', parseSampleDate('2024-01-01')!), undefined);
    assert.strictEqual(formatDate('+%-3N', parseSampleDate('2024-01-01')!), undefined);
    // Flags on composites are left out.
    assert.strictEqual(formatDate('+%-F', parseSampleDate('2024-01-01')!), undefined);
  });

  it('renders the same text as GNU date in the zone TZ names, and reads -d dates as it does', function () {
    try {
      if (!/GNU/.test(execFileSync('date', ['--version']).toString())) return this.skip();
    } catch {
      return this.skip();
    }
    const real = (tz: string, args: string[]) => execFileSync('date', args, { env: { ...process.env, TZ: tz, LC_ALL: 'C' } }).toString().replace(/\n$/, '');
    // Offsets east and west, of half hours, summer time, POSIX zones of a fixed offset (`-` is east).
    const zones = ['Asia/Tokyo', ':Europe/Paris', 'America/New_York', 'Asia/Kolkata', 'America/St_Johns', 'UTC', 'Etc/UTC', 'GMT', 'JST-9', 'EST5', '<+0530>-5:30', 'UTC0', 'XYZ+3:30'];
    const moments = [0, 1709622489, 1767225599, 1720000000, -86401];
    for (const tz of zones) {
      const zone = zoneOf(tz)!;
      assert.ok(zone, tz);
      for (const t of moments) {
        for (const fmt of ['%F %T %s', '%z %:z %::z %:::z', '%a %j %U %V %c', '%Z']) {
          const ours = formatDate(`+${fmt}`, new Date(t * 1000), zone);
          // (The abbreviation of a zone of the tz database is not known here.)
          if (ours === undefined && fmt === '%Z') continue;
          assert.strictEqual(ours, real(tz, ['-d', `@${t}`, `+${fmt}`]), `${tz} @${t} ${fmt}`);
        }
      }
      for (const d of ['2024-01-02', '2024-1-2', '2024-07-01T12:00', '2024-07-01 12:00:30', '2024-01-02T03:04:05Z', '2024-01-02 03:04:05 UTC', '2024-01-02 03:04:05+09:00',
        '2024-01-02 03:04:05 -0130', '2024-01-02 03:04:05 +09', '2024-01-02 3:04', '@0', '@-1', ' @5 ', '2024-10-27 02:30', '2024-11-03 01:30']) {
        assert.strictEqual(String(parseDateValue(d, zone)!.getTime() / 1000), real(tz, ['-d', d, '+%s']), `${tz} ${d}`);
      }
    }
    for (const tz of ['asia/tokyo', 'Foo/Bar', 'CET-1CEST,M3.5.0,M10.5.0/3', '', 'XYZ-25', 'XYZ-1:61']) assert.strictEqual(zoneOf(tz), undefined, tz);
    for (const d of ['2024-02-30', '2024-01-02 25:00', '2024-01-02 10:60', '2024-01-02 10:00:61', 'Jan 2 2024', 'next friday']) assert.strictEqual(parseDateValue(d, UTC), undefined, d);
    // A time summer time skips does not exist: GNU date refuses it.
    assert.strictEqual(parseDateValue('2024-03-31 02:30', zoneOf('Europe/Paris')!), undefined);
  });

  it('tells a date read from the moment date runs', () => {
    for (const d of ['next friday', 'yesterday', '+3 days', '-1 week', '1 day ago', '10:00', 'last month', 'tomorrow 10:00 pm', 'thursday', 'Wednesday', 'thurs', 'next week', 'now', 'this sat', 'week ago']) {
      assert.ok(relativeDate(d), d);
    }
    for (const d of ['2024-01-02', '2024-01-02 +3 days', 'Jan 2', '5', 'next', '@0']) assert.ok(!relativeDate(d), d);
  });

  it('reads the dates typed in the panel', () => {
    assert.strictEqual(parseSampleDate('2024-03-05T07:08:09Z')?.toISOString(), '2024-03-05T07:08:09.000Z');
    assert.strictEqual(parseSampleDate('2024-3-5')?.toISOString(), '2024-03-05T00:00:00.000Z');
    assert.strictEqual(parseSampleDate('2024-02-30'), undefined);
    assert.strictEqual(parseSampleDate('tomorrow'), undefined);
  });
});
