import * as assert from 'assert';
import { execFileSync } from 'child_process';
import { explainDate, explainPrintf, formatDate, parseSampleDate, printfNote, UTC } from '../src/embedded/format';
import { parseDateValue, relativeFrom, relativeItems, zoneOf } from '../src/examples/dates';

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
    // Offsets east and west, of half hours, summer time, POSIX zones of a fixed offset (`-` is east), zones of one
    // word, of three parts, and fixed ones of Etc. (Not backward links: some systems lack them.)
    const zones = ['Asia/Tokyo', ':Europe/Paris', 'America/New_York', 'Asia/Kolkata', 'America/St_Johns', 'UTC', 'Etc/UTC', 'GMT', 'JST-9', 'EST5', '<+0530>-5:30', 'UTC0', 'XYZ+3:30',
      'EST', 'MST', 'HST', 'CET', 'EET', 'MET', 'WET', 'EST5EDT', 'CST6CDT', 'MST7MDT', 'PST8PDT', 'Etc/GMT+5', 'Etc/GMT-14', 'America/Argentina/Buenos_Aires', 'Australia/Lord_Howe',
      'Pacific/Chatham', 'GMT0'];
    const moments = [0, 1709622489, 1767225599, 1720000000, -86401];
    for (const tz of zones) {
      const zone = zoneOf(tz)!;
      assert.ok(zone, tz);
      for (const t of moments) {
        for (const fmt of ['%F %T %s', '%z %:z %::z %:::z', '%a %j %U %V %c', '%Z']) {
          const ours = formatDate(`+${fmt}`, new Date(t * 1000), zone);
          // (A zone of the tz database is followed from 1970 on: before, the data of systems and of Intl differ.)
          if (zone.since !== undefined && t * 1000 < zone.since) {
            assert.strictEqual(ours, undefined, `${tz} @${t}`);
            continue;
          }
          // (The abbreviation of a zone of the tz database is not known here.)
          if (ours === undefined && fmt === '%Z') continue;
          assert.strictEqual(ours, real(tz, ['-d', `@${t}`, `+${fmt}`]), `${tz} @${t} ${fmt}`);
        }
      }
      for (const d of ['2024-01-02', '2024-1-2', '2024-07-01T12:00', '2024-07-01 12:00:30', '2024-01-02T03:04:05Z', '2024-01-02 03:04:05 UTC', '2024-01-02 03:04:05+09:00',
        '2024-01-02 03:04:05 -0130', '2024-01-02 03:04:05 +09', '2024-01-02 3:04', '@0', '@-1', ' @5 ', '2024-10-27 02:30', '2024-11-03 01:30',
        '2024-01-02 03:04:05 +24:00', '2024-01-02 03:04:05 -2400', '2024-01-02 03:04:05 +09:99']) {
        assert.strictEqual(String(parseDateValue(d, zone)!.getTime() / 1000), real(tz, ['-d', d, '+%s']), `${tz} ${d}`);
      }
    }
    // Names glibc has no file for (it reads them as UTC), backward links, rules of summer time, offsets out of range.
    for (const tz of ['asia/tokyo', 'Foo/Bar', 'CET-1CEST,M3.5.0,M10.5.0/3', '', 'XYZ-25', 'XYZ-1:61', 'JST', 'PST', 'BST', 'CST', 'IST', 'Japan', 'US/Pacific', 'NZ', 'ROK', 'Cuba',
      'Asia/Calcutta', 'America/Godthab', 'Europe/Kiev', 'Factory', 'Etc/GMT+13', 'Etc/GMT-15', 'Etc/Zulu', 'Asia/Nowhere']) assert.strictEqual(zoneOf(tz), undefined, tz);
    // (Not a backward link: a system with tzdata-legacy has `Japan`.)
    for (const tz of ['JST', 'PST']) assert.strictEqual(real(tz, ['-d', '@0', '+%T %z']), '00:00:00 +0000', tz);
    for (const d of ['2024-02-30', '2024-01-02 25:00', '2024-01-02 10:60', '2024-01-02 10:00:61', 'Jan 2 2024', 'next friday', '2024-01-02 03:04 +24:01', '2024-01-02 03:04 -24:01']) {
      assert.strictEqual(parseDateValue(d, UTC), undefined, d);
    }
    // A time summer time skips does not exist: GNU date refuses it.
    assert.strictEqual(parseDateValue('2024-03-31 02:30', zoneOf('Europe/Paris')!), undefined);
    // Years not of four digits, which GNU writes in its own ways; an offset with seconds (Liberia until 1972).
    assert.strictEqual(real('UTC0', ['-d', '@253402300800', '+%F']), '+10000-01-01');
    assert.strictEqual(real('UTC0', ['-d', '@-62135596800', '+%F|%c']), '0001-01-01|Mon Jan  1 00:00:00 1');
    for (const t of [253402300800, -62135596800]) assert.strictEqual(formatDate('+%F', new Date(t * 1000)), undefined, String(t));
    assert.strictEqual(real('Africa/Monrovia', ['-d', '@0', '+%::z']), '-00:44:30');
    assert.strictEqual(formatDate('+%T', new Date(0), zoneOf('Africa/Monrovia')!), undefined);
  });

  it('reads a date relative to the moment date runs as GNU date does', () => {
    const items = (d: string) => relativeItems(d);
    for (const d of ['next friday', 'yesterday', '+3 days', '-1 week', '1 day ago', '10:00', 'last month', 'tomorrow 10:00 pm', 'thursday', 'Wednesday', 'thurs', 'next week', 'now', 'this sat',
      'week ago', 'tues', 'wednes', 'thur', 'sun', '3days', '+3days', 'mins', 'hours ago', '10pm', '12 am', 'monday next week', ' 3 days ', 'next  friday', '1:05:07']) {
      assert.ok(items(d), d);
    }
    // Another form, or one GNU refuses or reads otherwise.
    for (const d of ['2024-01-02', '2024-01-02 +3 days', 'Jan 2', '5', 'next', '@0', '', 'satday', 'wedday', 'thurday', 'tueday', '25:00', '10:99', '10:00:60', '0:00 pm', '13:00 pm',
      '00:30 am', 'friday monday', '10:00 11:00', 'ago', '3 days ago ago', 'next friday next friday', '10:00 -3 days', 'third monday', 'friday,', 'today ago', 'next week ago', 'next pm',
      '3 fridays']) {
      assert.strictEqual(items(d), undefined, d);
    }
    assert.deepStrictEqual(items('2 days 3 hours ago'), { years: 0, months: 0, days: 2, seconds: -10800, shifts: true });
    assert.deepStrictEqual(items('Next Fri 12:15 pm'), { years: 0, months: 0, days: 0, seconds: 0, shifts: false, day: { ordinal: 1, number: 5 }, time: [12, 15, 0] });
    assert.strictEqual(items('12 am -1 fortnight'), undefined);
    assert.deepStrictEqual(items('12 am 1 fortnight'), { years: 0, months: 0, days: 14, seconds: 0, shifts: true, time: [0, 0, 0] });
    assert.deepStrictEqual(items('last year this month'), { years: -1, months: 0, days: 0, seconds: 0, shifts: true });
    // Where the wall clock is a time the zone skips or has twice, or shifts alone cross a change of the offset
    // (GNU keeps the summer time of the moment it runs): not followed.
    const at = (d: string, now: string, tz: string) => relativeFrom(relativeItems(d)!, new Date(now), zoneOf(tz)!)?.toISOString();
    // (Chile skips 00:00 to 01:00 on 2024-09-08; New York has 01:00 to 02:00 twice on 2024-11-03.)
    assert.strictEqual(at('00:30', '2024-09-08T16:00:00Z', 'America/Santiago'), undefined);
    assert.strictEqual(at('sunday', '2024-09-07T16:00:00Z', 'America/Santiago'), undefined);
    assert.strictEqual(at('tomorrow 00:30', '2024-09-07T16:00:00Z', 'America/Santiago'), undefined);
    assert.strictEqual(at('01:30', '2024-11-03T16:00:00Z', 'America/New_York'), undefined);
    assert.strictEqual(at('yesterday', '2024-10-27T12:00:00Z', 'Europe/Paris'), undefined);
    assert.strictEqual(at('+1 hour', '2024-11-03T05:30:00Z', 'America/New_York'), '2024-11-03T06:30:00.000Z');
    assert.strictEqual(at('sunday 10:00', '2024-09-07T16:00:00Z', 'America/Santiago'), '2024-09-08T13:00:00.000Z');
    assert.strictEqual(at('2 weeks', '2024-03-05T07:08:09Z', 'Europe/Paris'), '2024-03-19T07:08:09.000Z');
  });

  it('gives what GNU date gives now for a relative date, in zones of every kind', function () {
    try {
      if (!/GNU/.test(execFileSync('date', ['--version']).toString())) return this.skip();
    } catch {
      return this.skip();
    }
    // Each day of the week (from the day it runs, which is one of them), and each kind of item; the moment the test
    // runs, in zones with summer time, half and quarter hours. (A shift that crosses a change of summer time is not
    // followed: it is skipped.)
    const days = ['sun', 'monday', 'tues', 'wednes', 'thur', 'fri', 'saturday'].flatMap((w) => ['', 'this ', 'next ', 'last '].map((o) => o + w));
    const list = [...days, 'yesterday', 'tomorrow', 'today', 'now', '+3 days', '3 days ago', '-2 weeks', 'next week', 'last month', 'this year', 'fortnight', 'week ago',
      '2 days 3 hours ago', '10:00', '10:30 pm', '10pm', '12 am', '12:15 pm', '23:59:59', 'tomorrow 10:00 pm', 'monday next week', 'friday 3 days', 'yesterday friday',
      '10:00 3 days', '+1 year', '-14 months', '90 minutes', '3600 sec', 'next min', 'last sec', '1 hour ago', 'tomorrow tomorrow', 'next fri 9:00', 'Next Friday', '7 days 10:00 am'];
    let compared = 0;
    for (const tz of ['UTC0', 'Asia/Tokyo', 'Europe/Paris', 'America/New_York', 'Asia/Kolkata', 'Australia/Lord_Howe', 'Asia/Kathmandu', 'America/Santiago']) {
      const zone = zoneOf(tz)!;
      for (const d of list) {
        const t0 = Math.floor(Date.now() / 1000);
        const gnu = execFileSync('date', ['-d', d, '+%s'], { env: { ...process.env, TZ: tz, LC_ALL: 'C' } }).toString().trim();
        const t1 = Math.floor(Date.now() / 1000);
        const ours = new Set<string | undefined>();
        for (let t = t0; t <= t1; t++) ours.add(relativeFrom(relativeItems(d)!, new Date(t * 1000), zone)?.getTime().toString().replace(/000$/, ''));
        if (ours.has(undefined)) continue;
        assert.ok(ours.has(gnu), `${tz} ${d}: GNU ${gnu}, ours ${[...ours]}`);
        compared++;
      }
    }
    assert.ok(compared > list.length * 4, `${compared} compared`);
  });

  it('reads the dates typed in the panel', () => {
    assert.strictEqual(parseSampleDate('2024-03-05T07:08:09Z')?.toISOString(), '2024-03-05T07:08:09.000Z');
    assert.strictEqual(parseSampleDate('2024-3-5')?.toISOString(), '2024-03-05T00:00:00.000Z');
    assert.strictEqual(parseSampleDate('2024-02-30'), undefined);
    assert.strictEqual(parseSampleDate('tomorrow'), undefined);
  });
});
