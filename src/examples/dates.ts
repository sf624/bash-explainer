// The dates of a `date` example: the time zone `TZ` names, and the dates `-d`/`--date` and `-f`/`--file` give, read
// as GNU date reads them, for the forms the example follows (an ISO 8601 date and time, `@SECONDS`).
import { UTC, type Zone } from '../embedded/format';
import { pick } from '../embedded/types';
import type { Lang } from '../i18n';

/** Zones whose abbreviation (`%Z`) is known: the others are left out of a `%Z` example. */
const ABBREVIATIONS: Record<string, string> = { UTC: 'UTC', 'Etc/UTC': 'UTC', GMT: 'GMT', 'Etc/GMT': 'GMT' };

/**
 * The zone a value of `TZ` names, as glibc reads it: a POSIX zone of a fixed offset (`JST-9`, `<+09>-9`: the sign is
 * west of UTC), or the name of a zone of the tz database (`Asia/Tokyo`, `:Europe/Paris`), in its case (glibc reads
 * `asia/tokyo` as UTC). Undefined for a value this does not follow (rules of summer time, an unknown name).
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
  // (Intl takes any case, and gives the name it prefers: `Asia/Calcutta` for `Asia/Kolkata`.)
  if (!/^[A-Z][\w+-]*(?:\/[A-Z][\w+-]*)*$/.test(name)) return undefined;
  let parts: Intl.DateTimeFormat;
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: name, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
    });
  } catch {
    return undefined;
  }
  return {
    offset: (t) => {
      const p = Object.fromEntries(parts.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
      const wall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
      return Math.round((wall - Math.floor(t / 1000) * 1000) / 60000);
    },
    abbr: () => ABBREVIATIONS[name],
  };
}

/** The moment a wall-clock time (given as if it were UTC) is in `zone`; undefined for a time the zone skips. */
function fromWall(wall: number, zone: Zone): number | undefined {
  const t = wall - zone.offset(wall - zone.offset(wall) * 60000) * 60000;
  return t + zone.offset(t) * 60000 === wall ? t : undefined;
}

/**
 * The moment a date given to `date -d` (or a line of `date -f`) stands for, with the local time zone `zone`: `@SECONDS`,
 * or an ISO 8601 date (`2024-01-02`: midnight) with a time (`T` or a space) and a zone (`Z`, `UTC`, `+09:00`) or not
 * (then a local time). Undefined for any other form, and for a date that does not exist (GNU date refuses it).
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
  const minutes = off ? (off[1] === '-' ? -1 : 1) * (+off[2] * 60 + +(off[3] ?? 0)) : 0;
  return new Date(wall - minutes * 60000);
}

const UNIT = '(?:year|month|fortnight|week|day|hour|minute|min|second|sec)s?';
const WEEKDAY = '(?:sun|mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?)(?:day)?';
const ITEM = `(?:[+-]?\\d+\\s*${UNIT}(?:\\s+ago)?|(?:next|last|this)\\s+(?:${UNIT}|${WEEKDAY})|${UNIT}(?:\\s+ago)?|${WEEKDAY}|now|today|yesterday|tomorrow|\\d{1,2}:\\d{2}(?::\\d{2})?(?:\\s*[ap]m)?)`;
const RELATIVE = new RegExp(`^\\s*${ITEM}(?:\\s+${ITEM})*\\s*$`, 'i');

/**
 * Whether a date given to `date -d` is read from the moment date runs, and only from it: `yesterday`, `next friday`,
 * `+3 days`, `10:00` (today). (One with a date in it, `2024-01-02 +3 days`, is not.)
 */
export function relativeDate(text: string): boolean {
  return RELATIVE.test(text);
}

/**
 * The label of a `date` example's output: in the zone `TZ` names (`tz`), or in UTC. `inUtc`: say so, when no input
 * section says it (the date given with `-d`, the lines of `-f`).
 */
export function dateOutputLabel(tz: string | undefined, inUtc: boolean, lang: Lang): string {
  const s = pick(lang);
  if (tz !== undefined) return s(`出力（タイムゾーン \`${tz}\` の時刻）`, `Output (the time in the zone \`${tz}\`)`);
  return inUtc ? s('出力（UTC の時刻）', 'Output (the time in UTC)') : s('出力', 'Output');
}
