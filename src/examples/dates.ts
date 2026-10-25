// The dates of a `date` example: the time zone `TZ` names, and the dates `-d`/`--date` and `-f`/`--file` give, read
// as GNU date reads them, for the forms the example follows (an ISO 8601 date and time, `@SECONDS`, the items of a date
// relative to the moment date runs).
import { UTC, type Zone } from '../embedded/format';
import { pick } from '../embedded/types';
import type { Lang } from '../i18n';

/** Zones whose abbreviation (`%Z`) is known: the others are left out of a `%Z` example. */
const ABBREVIATIONS: Record<string, string> = { UTC: 'UTC', 'Etc/UTC': 'UTC', GMT: 'GMT', 'Etc/GMT': 'GMT' };

/** The zones of the tz database named by one word that the tz data of every system has (Ubuntu's tzdata 2026e). */
const SINGLE = new Set(['UTC', 'GMT', 'CET', 'EET', 'MET', 'WET', 'EST', 'MST', 'HST', 'EST5EDT', 'CST6CDT', 'MST7MDT', 'PST8PDT']);

/** The names of zones of the tz database: `Area/Location`, `Area/Sub/Location`, and the fixed `Etc/GMT+5`. */
const AREA = /^(?:Africa|America|Antarctica|Arctic|Asia|Atlantic|Australia|Europe|Indian|Pacific)(?:\/[A-Z][A-Za-z_-]*){1,2}$|^Etc\/(?:UTC|GMT(?:\+(?:[1-9]|1[0-2])|-(?:[1-9]|1[0-4]))?)$/;

/**
 * The backward links of the tz database written as `Area/Location` (the links of Ubuntu's tzdata 2026e, `tzdata.zi`).
 * Some systems leave them out (Debian and Ubuntu put most in tzdata-legacy), and glibc reads a name it has no file
 * for as UTC: what date prints depends on the system.
 */
const LINKS = new Set((
  'Africa/Asmera Africa/Timbuktu America/Argentina/ComodRivadavia America/Atka America/Buenos_Aires ' +
  'America/Catamarca America/Coral_Harbour America/Cordoba America/Ensenada America/Fort_Wayne America/Godthab ' +
  'America/Indianapolis America/Jujuy America/Knox_IN America/Kralendijk America/Louisville America/Lower_Princes ' +
  'America/Marigot America/Mendoza America/Montreal America/Nipigon America/Pangnirtung America/Porto_Acre ' +
  'America/Rainy_River America/Rosario America/Santa_Isabel America/Shiprock America/St_Barthelemy ' +
  'America/Thunder_Bay America/Virgin America/Yellowknife Antarctica/South_Pole Arctic/Longyearbyen Asia/Ashkhabad ' +
  'Asia/Calcutta Asia/Choibalsan Asia/Chongqing Asia/Chungking Asia/Dacca Asia/Harbin Asia/Istanbul Asia/Kashgar ' +
  'Asia/Katmandu Asia/Macao Asia/Rangoon Asia/Saigon Asia/Tel_Aviv Asia/Thimbu Asia/Ujung_Pandang Asia/Ulan_Bator ' +
  'Atlantic/Faeroe Atlantic/Jan_Mayen Australia/ACT Australia/Canberra Australia/Currie Australia/LHI ' +
  'Australia/NSW Australia/North Australia/Queensland Australia/South Australia/Tasmania Australia/Victoria ' +
  'Australia/West Australia/Yancowinna Europe/Belfast Europe/Bratislava Europe/Busingen Europe/Kiev ' +
  'Europe/Mariehamn Europe/Nicosia Europe/Podgorica Europe/San_Marino Europe/Tiraspol Europe/Uzhgorod ' +
  'Europe/Vatican Europe/Zaporozhye Pacific/Enderbury Pacific/Johnston Pacific/Ponape Pacific/Samoa Pacific/Truk ' +
  'Pacific/Yap').split(' '));

/**
 * The zone a value of `TZ` names, as glibc reads it: a POSIX zone of a fixed offset (`JST-9`, `<+09>-9`: the sign is
 * west of UTC), or a zone of the tz database (`Asia/Tokyo`, `:Europe/Paris`, `EST5EDT`), written in its case, from
 * 1970 on (before, the tz data of systems and of `Intl` differ; 1980 for a name of one word). Undefined for a value
 * this does not follow: rules of summer time, a name glibc reads as UTC (`asia/tokyo`, `JST`, `PST`), or a backward
 * link (`Japan`, `Asia/Calcutta`), which only some systems have.
 */
export function zoneOf(tz: string): Zone | undefined {
  const posix = /^(?:([A-Za-z]{3,})|<([A-Za-z0-9+-]{3,})>)([+-]?)(\d{1,2})(?::(\d{2}))?$/.exec(tz);
  if (posix) {
    const [, name, quoted, sign, h, m = '0'] = posix;
    if (+h > 24 || +m > 59) return undefined;
    const minutes = (sign === '-' ? 1 : -1) * (+h * 60 + +m);
    return { offset: () => minutes, abbr: () => name ?? quoted };
  }
  const name = tz.replace(/^:/, '');
  if (ABBREVIATIONS[name] === 'UTC') return UTC;
  if (!SINGLE.has(name) && !(AREA.test(name) && !LINKS.has(name))) return undefined;
  let parts: Intl.DateTimeFormat;
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: name, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
    });
  } catch {
    return undefined;
  }
  return {
    // (Not a whole number of minutes where the zone's offset has seconds.)
    offset: (t) => {
      const p = Object.fromEntries(parts.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
      const wall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
      return (wall - Math.floor(t / 1000) * 1000) / 60000;
    },
    abbr: () => ABBREVIATIONS[name],
    // (`WET` is `Europe/Lisbon` in newer tz data, an hour ahead until 1976: the zones of one word from 1980 on.)
    since: SINGLE.has(name) && !ABBREVIATIONS[name] ? Date.UTC(1980, 0, 1) : 0,
  };
}

/** The moment a wall-clock time (given as if it were UTC) is in `zone`; undefined for a time the zone skips. */
function fromWall(wall: number, zone: Zone): number | undefined {
  const t = wall - zone.offset(wall - zone.offset(wall) * 60000) * 60000;
  return t + zone.offset(t) * 60000 === wall ? t : undefined;
}

/**
 * The moment a date given to `date -d` (or a line of `date -f`) stands for, with the local time zone `zone`: `@SECONDS`,
 * or an ISO 8601 date (`2024-01-02`: midnight) with a time (`T` or a space) and a zone (`Z`, `UTC`, `+09:00`, up to
 * 24 hours) or not (then a local time). Undefined for any other form, and for a date that does not exist (GNU date
 * refuses it).
 */
export function parseDateValue(text: string, zone: Zone): Date | undefined {
  const epoch = /^\s*@(-?\d{1,12})\s*$/.exec(text);
  if (epoch) return new Date(+epoch[1] * 1000);
  const m = /^\s*(\d{4})-(\d{1,2})-(\d{1,2})(?:(?:T|\s+)(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(Z|UTC|GMT|[+-]\d{2}(?::?\d{2})?)?)?\s*$/.exec(text);
  if (!m) return undefined;
  const [y, mo, d, h = '0', mi = '0', se = '0', tz] = m.slice(1);
  const wall = Date.UTC(+y, +mo - 1, +d, +h, +mi, +se);
  const w = new Date(wall);
  // (Date would roll February 30 over to March, and 25 o'clock to the next day.)
  if (w.getUTCMonth() !== +mo - 1 || w.getUTCDate() !== +d || w.getUTCHours() !== +h || +mi > 59 || +se > 59) return undefined;
  if (tz === undefined) {
    const t = fromWall(wall, zone);
    return t === undefined ? undefined : new Date(t);
  }
  const off = /^([+-])(\d{2}):?(\d{2})?$/.exec(tz);
  // (GNU takes `+09:99` as 10:39, but no offset over 24 hours.)
  const minutes = off ? (off[1] === '-' ? -1 : 1) * (+off[2] * 60 + +(off[3] ?? 0)) : 0;
  if (Math.abs(minutes) > 24 * 60) return undefined;
  return new Date(wall - minutes * 60000);
}

/**
 * The items of a date relative to the moment date runs, added up: the years, months and days, and the seconds, it
 * shifts by; a day of the week (`next friday`: `ordinal` 1, `number` 5), a time of day; whether a shift is given.
 */
export interface Relative { years: number; months: number; days: number; seconds: number; day?: { ordinal: number; number: number }; time?: [number, number, number]; shifts: boolean }

/** GNU's units of relative items: the field each adds to, and how much. */
const UNITS: Record<string, ['years' | 'months' | 'days' | 'seconds', number]> = {
  year: ['years', 1], month: ['months', 1], fortnight: ['days', 14], week: ['days', 7], day: ['days', 1],
  hour: ['seconds', 3600], minute: ['seconds', 60], min: ['seconds', 60], second: ['seconds', 1], sec: ['seconds', 1],
};
/** GNU's names of the days of the week (and any of them cut to three letters). */
const WEEKDAYS: Record<string, number> = {
  sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, wednes: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6,
};
const ORDINALS: Record<string, number> = { last: -1, this: 0, next: 1 };
const SHIFTS: Record<string, number> = { now: 0, today: 0, yesterday: -1, tomorrow: 1 };
// (A word is a unit also with a plural `s`: GNU drops it.)
const unit = (w: string) => UNITS[w] ?? (w.endsWith('s') ? UNITS[w.slice(0, -1)] : undefined);

/**
 * The items of a date given to `date -d` that is read from the moment date runs, as GNU date reads them: shifts
 * (`+3 days`, `2 hours ago`, `next week`, `yesterday`), a day of the week (`friday`, `next fri`), a time of day
 * (`10:00`, `10:30 pm`, `10pm`). Undefined for a date of another form (`2024-01-02 +3 days`, `third monday`), for one
 * GNU date refuses (two days of the week, two times, `satday`, `25:00`), and for a signed number right after a time
 * (`10:00 -3 days`: GNU reads `-3` as the time's zone).
 */
export function relativeItems(text: string): Relative | undefined {
  const r: Relative = { years: 0, months: 0, days: 0, seconds: 0, shifts: false };
  // (A time first: `10pm` is not 10 of a unit `pm`.)
  const item = /\s*(?:(\d{1,2})(?::(\d{2})(?::(\d{2}))?(?:\s*([ap])m)?|\s*([ap])m)|([+-]?)(\d{1,6})\s*([a-z]+)(?:\s+(ago))?|(next|last|this)\s+([a-z]+)|([a-z]+)(?:\s+(ago))?)(?=\s|$)/y;
  const s = text.toLowerCase();
  let afterTime = false;
  let any = false;
  item.lastIndex = 0;
  while (item.lastIndex < s.length && !/^\s+$/.test(s.slice(item.lastIndex))) {
    const m = item.exec(s);
    if (!m) return undefined;
    const [, hour, minute, second, meridian, hourMeridian, sign, count, countUnit, countAgo, ordinal, ordinalWord, word, wordAgo] = m;
    if (afterTime && sign) return undefined;
    afterTime = false;
    any = true;
    const shift = (u: ['years' | 'months' | 'days' | 'seconds', number], n: number) => { r[u[0]] += u[1] * n; r.shifts = true; };
    if (count !== undefined) {
      const u = unit(countUnit);
      if (!u) return undefined;
      shift(u, (sign === '-' ? -1 : 1) * +count * (countAgo ? -1 : 1));
    } else if (ordinal !== undefined) {
      const u = unit(ordinalWord);
      if (u) shift(u, ORDINALS[ordinal]);
      else if (WEEKDAYS[ordinalWord] !== undefined && !r.day) r.day = { ordinal: ORDINALS[ordinal], number: WEEKDAYS[ordinalWord] };
      else return undefined;
    } else if (hour !== undefined) {
      const ap = meridian ?? hourMeridian;
      const [h, mi, se] = [+hour, minute === undefined ? 0 : +minute, second === undefined ? 0 : +second];
      if (r.time || mi > 59 || se > 59 || (ap ? h < 1 || h > 12 : h > 23)) return undefined;
      r.time = [ap ? (h % 12) + (ap === 'p' ? 12 : 0) : h, mi, se];
      afterTime = true;
    } else {
      const u = unit(word);
      if (u) shift(u, wordAgo ? -1 : 1);
      else if (wordAgo) return undefined;
      else if (SHIFTS[word] !== undefined) shift(UNITS.day, SHIFTS[word]);
      else if (WEEKDAYS[word] !== undefined && !r.day) r.day = { ordinal: 0, number: WEEKDAYS[word] };
      else return undefined;
    }
  }
  return any ? r : undefined;
}

/** The one moment a wall-clock time (given as if it were UTC) is in `zone`; undefined for one it skips or has twice. */
function onlyMoment(wall: number, zone: Zone): number | undefined {
  const found = new Set([wall - zone.offset(wall - 864e5) * 60000, wall - zone.offset(wall + 864e5) * 60000].filter((t) => t + zone.offset(t) * 60000 === wall));
  return found.size === 1 ? [...found][0] : undefined;
}

/**
 * The moment GNU date gives for the relative date `r` when it runs at `now`, in the local zone `zone`: from the date
 * where it runs, at the time given, or at midnight with a day of the week, or else at the time it runs; then the next
 * such day of the week (that day itself unless `next`), and the years, months and days added to the wall clock;
 * then the hours, minutes and seconds added. Undefined where the wall clock is a time the zone skips or has twice,
 * and for shifts alone that cross a change of the zone's offset (GNU keeps the summer time of the moment it runs,
 * `tm_isdst`, and mktime then moves the clock by the difference: `yesterday` at 06:00 CET is 07:00 CEST).
 */
export function relativeFrom(r: Relative, now: Date, zone: Zone): Date | undefined {
  const off = zone.offset(now.getTime());
  const w = new Date(now.getTime() + off * 60000);
  // (A time or a day of the week makes it a date of its own, whose summer time mktime finds.)
  const own = r.time !== undefined || r.day !== undefined;
  const [h, mi, se] = r.time ?? (r.day ? [0, 0, 0] : [w.getUTCHours(), w.getUTCMinutes(), w.getUTCSeconds()]);
  const wallOf = (y: number, mo: number, d: number) => {
    const x = new Date(0);
    x.setUTCFullYear(y, mo, d);
    x.setUTCHours(h, mi, se, 0);
    return x;
  };
  let wall = wallOf(w.getUTCFullYear(), w.getUTCMonth(), w.getUTCDate());
  if (own && onlyMoment(wall.getTime(), zone) === undefined) return undefined;
  if (r.day) {
    const wday = wall.getUTCDay();
    const { ordinal, number } = r.day;
    const add = (ordinal - (ordinal > 0 && wday !== number ? 1 : 0)) * 7 + ((number - wday + 7) % 7);
    wall = wallOf(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate() + add);
    if (onlyMoment(wall.getTime(), zone) === undefined) return undefined;
  }
  wall = wallOf(wall.getUTCFullYear() + r.years, wall.getUTCMonth() + r.months, wall.getUTCDate() + r.days);
  const kept = wall.getTime() - off * 60000;
  const t = own ? onlyMoment(wall.getTime(), zone) : zone.offset(kept) === off ? kept : undefined;
  return t === undefined ? undefined : new Date(t + r.seconds * 1000);
}

/**
 * The label of a `date` example's output: in the zone `TZ` names (`tz`), in UTC (`utc`: `-u`), or else in the local
 * zone, which the example takes to be UTC.
 */
export function dateOutputLabel(tz: string | undefined, utc: boolean, lang: Lang): string {
  const s = pick(lang);
  if (tz !== undefined) return s(`出力（タイムゾーン \`${tz}\` の時刻）`, `Output (the time in the zone \`${tz}\`)`);
  return utc ? s('出力（UTC の時刻）', 'Output (the time in UTC)') : s('出力（タイムゾーンが UTC のとき）', 'Output (if the local zone is UTC)');
}
