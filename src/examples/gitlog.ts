// Formats sample commits the way `git log --pretty=… --date=…` would, for worked examples.
import { Unsupported as RunnerUnsupported } from './unsupported';

export interface SampleCommit {
  hash: string;
  tree: string;
  parents: string[];
  author: { name: string; email: string };
  /** UNIX time in seconds; the time zone is the local one. */
  time: number;
  subject: string;
  body: string;
  /** Decorations as `%D` prints them, e.g. `HEAD -> main, tag: v1.2.0`. */
  refs: string;
}

export class GitFormatUnsupported extends RunnerUnsupported {}

/** Three commits dated relative to `now` (newest first), so relative dates read naturally. */
export function sampleCommits(now = Date.now()): SampleCommit[] {
  const t = Math.floor(now / 1000);
  const hashes = ['3f2a9c1d8e7b6a5f4c3d2e1f0a9b8c7d6e5f4a3b', 'b81e44a2c9d7f3e6a5b4c3d2e1f0a9b8c7d6e5f4', '9d0c7e3b2a1f6e5d4c3b2a1f0e9d8c7b6a5f4e3d'];
  const trees = ['e1d2c3b4a5f6e7d8c9b0a1f2e3d4c5b6a7f8e9d0', 'a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6', '5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d'];
  const alice = { name: 'Alice Smith', email: 'alice@example.com' };
  const bob = { name: 'Bob Lee', email: 'bob@example.com' };
  return [
    { hash: hashes[0], tree: trees[0], parents: [hashes[1]], author: alice, time: t - 2 * 3600, subject: 'Fix login timeout', body: 'Raise the timeout to 30 seconds.\n', refs: 'HEAD -> main, origin/main' },
    { hash: hashes[1], tree: trees[1], parents: [hashes[2]], author: bob, time: t - 3 * 86400 - 5 * 3600, subject: 'Add user search', body: '', refs: 'tag: v1.2.0' },
    { hash: hashes[2], tree: trees[2], parents: [], author: alice, time: t - 23 * 86400, subject: 'Initial commit', body: '', refs: '' },
  ];
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** The local UTC offset at `d` as `+0900` (or `+09:00` with `colon`). */
function zone(d: Date, colon = false): string {
  const off = -d.getTimezoneOffset();
  const sign = off < 0 ? '-' : '+';
  const a = Math.abs(off);
  return `${sign}${pad(Math.floor(a / 60))}${colon ? ':' : ''}${pad(a % 60)}`;
}

/** strftime as git's `--date=format:` uses it (the C library's, in the commit's time zone). */
export function strftime(fmt: string, d: Date): string {
  return fmt.replace(/%([-_0^#]?)([a-zA-Z%+])/g, (_, flag: string, c: string) => {
    const jan1 = new Date(d.getFullYear(), 0, 1);
    const v: Record<string, string> = {
      Y: String(d.getFullYear()), y: pad(d.getFullYear() % 100), C: pad(Math.floor(d.getFullYear() / 100)),
      m: pad(d.getMonth() + 1), d: pad(d.getDate()), e: String(d.getDate()).padStart(2, ' '),
      H: pad(d.getHours()), I: pad(d.getHours() % 12 || 12), M: pad(d.getMinutes()), S: pad(d.getSeconds()),
      k: String(d.getHours()).padStart(2, ' '), l: String(d.getHours() % 12 || 12).padStart(2, ' '),
      p: d.getHours() < 12 ? 'AM' : 'PM', P: d.getHours() < 12 ? 'am' : 'pm',
      a: DAYS[d.getDay()], A: DAY_NAMES[d.getDay()], b: MONTHS[d.getMonth()], h: MONTHS[d.getMonth()], B: MONTH_NAMES[d.getMonth()],
      j: pad(Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - jan1.getTime()) / 864e5) + 1, 3),
      u: String(d.getDay() || 7), w: String(d.getDay()), s: String(Math.floor(d.getTime() / 1000)),
      z: zone(d), n: '\n', t: '\t', '%': '%',
    };
    v.F = `${v.Y}-${v.m}-${v.d}`;
    v.T = `${v.H}:${v.M}:${v.S}`;
    v.R = `${v.H}:${v.M}`;
    v.D = `${v.m}/${v.d}/${v.y}`;
    v.r = `${v.I}:${v.M}:${v.S} ${v.p}`;
    const r = v[c];
    if (r === undefined) throw new GitFormatUnsupported(`%${c}`);
    if (flag === '-') return r.replace(/^[0 ]+(?=.)/, '');
    if (flag === '^') return r.toUpperCase();
    return r;
  });
}

/** git's relative date ("2 hours ago"), following show_date_relative(). */
export function relativeDate(time: number, now: number): string {
  const diff = Math.floor(now / 1000) - time;
  const ago = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'} ago`;
  if (diff < 0) return 'in the future';
  if (diff < 90) return ago(diff, 'second');
  const minutes = Math.floor((diff + 30) / 60);
  if (minutes < 90) return ago(minutes, 'minute');
  const hours = Math.floor((minutes + 30) / 60);
  if (hours < 36) return ago(hours, 'hour');
  const days = Math.floor((hours + 12) / 24);
  if (days < 14) return ago(days, 'day');
  if (days < 70) return ago(Math.floor((days + 3) / 7), 'week');
  if (days < 365) return ago(Math.floor((days + 15) / 30), 'month');
  // Years and months for 5 years or so, then years.
  if (days < 1825) {
    const total = Math.floor((days * 12 * 2 + 365) / (365 * 2));
    const years = Math.floor(total / 12);
    const months = total % 12;
    return months ? `${years} year${years === 1 ? '' : 's'}, ${ago(months, 'month')}` : ago(years, 'year');
  }
  return ago(Math.floor((days + 183) / 365), 'year');
}

/** A date in a `--date` style (`default`, `iso`, `short`, `format:…`…). */
export function formatDate(time: number, style: string, now: number): string {
  const d = new Date(time * 1000);
  const local = style.endsWith('-local') || style === 'local';
  const base = style.replace(/-local$/, '');
  const f = (fmt: string) => strftime(fmt, d);
  if (base.startsWith('format:')) return f(base.slice(7));
  switch (base) {
    case 'default': case 'local': return f('%a %b %-d %H:%M:%S %Y') + (local ? '' : ` ${zone(d)}`);
    case 'iso': case 'iso8601': return f('%Y-%m-%d %H:%M:%S ') + zone(d);
    case 'iso-strict': case 'iso8601-strict': return f('%Y-%m-%dT%H:%M:%S') + (zone(d) === '+0000' ? 'Z' : zone(d, true));
    case 'rfc': case 'rfc2822': return f('%a, %-d %b %Y %H:%M:%S ') + zone(d);
    case 'short': return f('%Y-%m-%d');
    case 'raw': return `${time} ${zone(d)}`;
    case 'unix': return String(time);
    case 'relative': return relativeDate(time, now);
    default: throw new GitFormatUnsupported(style);
  }
}

/** Output lines of `git log` for the commits, with `--pretty`/`--format` and `--date` as given. */
export function runGitLog(commits: SampleCommit[], pretty: string | undefined, dateStyle = 'default', now = Date.now()): string[] {
  const date = (c: SampleCommit) => formatDate(c.time, dateStyle, now);
  const message = (c: SampleCommit) => ['', `    ${c.subject}`, ...(c.body ? ['    ', ...c.body.replace(/\n$/, '').split('\n').map((l) => `    ${l}`)] : [])];
  const named: Record<string, (c: SampleCommit) => string[]> = {
    oneline: (c) => [`${c.hash} ${c.subject}`],
    short: (c) => [`commit ${c.hash}`, `Author: ${c.author.name} <${c.author.email}>`, '', `    ${c.subject}`],
    medium: (c) => [`commit ${c.hash}`, `Author: ${c.author.name} <${c.author.email}>`, `Date:   ${date(c)}`, ...message(c)],
    full: (c) => [`commit ${c.hash}`, `Author: ${c.author.name} <${c.author.email}>`, `Commit: ${c.author.name} <${c.author.email}>`, ...message(c)],
    fuller: (c) => [`commit ${c.hash}`, `Author:     ${c.author.name} <${c.author.email}>`, `AuthorDate: ${date(c)}`,
      `Commit:     ${c.author.name} <${c.author.email}>`, `CommitDate: ${date(c)}`, ...message(c)],
    reference: (c) => [`${c.hash.slice(0, 7)} (${c.subject}, ${formatDate(c.time, 'short', now)})`],
  };
  const style = pretty ?? 'medium';
  if (named[style]) {
    // Multi-line formats put a blank line between commits.
    return commits.flatMap((c, i) => [...(i && style !== 'oneline' && style !== 'reference' ? [''] : []), ...named[style](c)]);
  }
  const m = /^(t?format):([\s\S]*)$/.exec(style);
  if (!m && !style.includes('%')) throw new GitFormatUnsupported(style);
  const template = m ? m[2] : style;
  // `format:` separates commits with a newline; `tformat:` (and a bare template) ends each with one.
  const text = commits.map((c) => expand(template, c, date, now)).join('\n');
  // With `format:` nothing follows the last commit, so a newline that ends it (`%B` ends with one) is the last of the output.
  return (m && m[1] === 'format' ? text.replace(/\n$/, '') : text).split('\n');
}

/** Expand the placeholders of a `format:` template for one commit. */
function expand(template: string, c: SampleCommit, date: (c: SampleCommit) => string, now: number): string {
  const value = (p: string): string => {
    const who = p[0] === 'a' || p[0] === 'c' ? c.author : undefined;
    switch (p) {
      case 'H': return c.hash;
      case 'h': return c.hash.slice(0, 7);
      case 'T': return c.tree;
      case 't': return c.tree.slice(0, 7);
      case 'P': return c.parents.join(' ');
      case 'p': return c.parents.map((x) => x.slice(0, 7)).join(' ');
      case 'an': case 'cn': return who!.name;
      case 'ae': case 'ce': return who!.email;
      case 'al': case 'cl': return who!.email.replace(/@.*/, '');
      case 'ad': case 'cd': return date(c);
      case 'ar': case 'cr': return relativeDate(c.time, now);
      case 'at': case 'ct': return String(c.time);
      case 'ai': case 'ci': return formatDate(c.time, 'iso', now);
      case 'aI': case 'cI': return formatDate(c.time, 'iso-strict', now);
      case 'as': case 'cs': return formatDate(c.time, 'short', now);
      case 's': return c.subject;
      case 'f': return c.subject.replace(/[^A-Za-z0-9.]+/g, '-').replace(/^-|-$/g, '');
      case 'b': return c.body;
      case 'B': return `${c.subject}\n${c.body ? `\n${c.body}` : ''}`;
      case 'd': return c.refs ? ` (${c.refs})` : '';
      case 'D': return c.refs;
      case 'n': return '\n';
      case '%': return '%';
      // %N (notes) and %e (encoding): empty for these commits.
      default: return '';
    }
  };
  let out = '';
  let align: { dir: string; width: number; trunc?: string } | undefined;
  for (let i = 0; i < template.length;) {
    if (template[i] !== '%') { out += template[i++]; continue; }
    const rest = template.slice(i + 1);
    let m: RegExpExecArray | null;
    if ((m = /^C\([^)]*\)|^C(red|green|blue|yellow|reset)/.exec(rest))) {
      // Colours do not change the text.
      i += 1 + m[0].length;
      continue;
    }
    // git takes no width 0 (and prints the text as it is, which is left to it).
    if ((m = /^(<|>|>>|><)\(([1-9]\d*)(?:,(trunc|ltrunc|mtrunc))?\)/.exec(rest))) {
      align = { dir: m[1], width: Number(m[2]), trunc: m[3] };
      i += 1 + m[0].length;
      continue;
    }
    if ((m = /^x([0-9a-fA-F]{2})/.exec(rest))) {
      out += String.fromCharCode(parseInt(m[1], 16));
      i += 1 + m[0].length;
      continue;
    }
    m = /^(an|ae|al|ad|ar|at|ai|aI|as|cn|ce|cl|cd|cr|ct|ci|cI|cs|[HhTtPpsfbBdDnN%e])/.exec(rest);
    if (!m) throw new GitFormatUnsupported(`%${rest.slice(0, 2)}`);
    let v = value(m[1]);
    if (align) {
      v = fit(v, align.dir, align.width, align.trunc);
      align = undefined;
    }
    out += v;
    i += 1 + m[0].length;
  }
  return out;
}

/** Pad (and with `trunc` shorten, marking the cut with `..`) to `width` columns. */
function fit(v: string, dir: string, width: number, trunc?: string): string {
  if (v.length > width && trunc) {
    // Only the `..` fits.
    if (width < 2) return '..';
    if (trunc === 'trunc') return v.slice(0, width - 2) + '..';
    if (trunc === 'ltrunc') return '..' + v.slice(v.length - (width - 2));
    const keep = width - 2;
    const left = Math.floor(keep / 2);
    return v.slice(0, left) + '..' + v.slice(v.length - (keep - left));
  }
  if (v.length >= width) return v;
  const space = width - v.length;
  if (dir === '<') return v + ' '.repeat(space);
  if (dir === '><') return ' '.repeat(Math.floor(space / 2)) + v + ' '.repeat(space - Math.floor(space / 2));
  return ' '.repeat(space) + v;
}
