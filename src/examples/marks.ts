// What a stage of a pipeline reads of the lines it is given, so that the section it reads can mark it: the text grep,
// sed or awk matches, the fields awk reads, what cut takes, the key sort compares; and the lines it leaves out. Each
// comes from the runner of the stage (src/examples/pipeline.ts `stageMarks`), so that the marks are what it does.
import type { Lang } from '../i18n';
import { type AwkInvocation, parseAwk, runAwk } from './awk';
import { type JsRegex, posixExec, toJsRegex } from './regex';

/** Per line, the parts `[start, end)` (UTF-16 units of the line) a stage reads; and the lines (indexes) it leaves out. */
export interface LineMarks { ranges: [number, number][][]; dropped: number[] }

/** What the marks are: text a pattern matches, fields awk reads, what cut takes, the key sort compares. */
export type MarkKind = 'match' | 'field' | 'take' | 'key';

export interface StageMarks extends LineMarks { kind: MarkKind }

/** The marks of a section of an example, as the panel draws them: `said` names them for a screen reader and a tooltip. */
export interface SectionMarks {
  said: string;
  ranges: [number, number][][];
  /** The lines the stage leaves out, drawn dimmer. */
  dropped?: number[];
}

/** Told what a run of awk reads of each record (`AwkRunOptions.watch`, src/examples/awk.ts). */
export interface AwkWatch {
  /** A record is read, split with this FS. */
  record(fs: string): void;
  /** A rule of the main part selects it. */
  selected(): void;
  /** Field `i` is read (`fields[0]` is the record as it is now). */
  field(fields: string[], i: number): void;
  /** A regex alone (`/re/`) is matched against the record. */
  regex(fields: string[], re: JsRegex): void;
}

/**
 * Where awk's fields lie in `line`, split with `fs` as awk splits a record: " " is runs of blanks, another single
 * character is itself, anything longer a regex (its non-empty matches).
 */
function fieldSpans(line: string, fs: string): [number, number][] {
  if (fs === ' ') return [...line.matchAll(/[^ \t\n]+/g)].map((m) => [m.index, m.index + m[0].length]);
  if (line === '') return [];
  const re = fs.length === 1 && fs !== '\\' ? { source: fs.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&'), flags: '' } : toJsRegex(fs, 'ere', { sedEscapes: true });
  const out: [number, number][] = [];
  let at = 0;
  // (An FS the runner cannot read stops it before any record: `re` is then a regex.)
  for (const m of line.matchAll(new RegExp(re!.source, re!.flags + 'g'))) {
    if (!m[0]) continue;
    out.push([at, m.index]);
    at = m.index + m[0].length;
  }
  out.push([at, line.length]);
  return out;
}

/**
 * What awk reads of each line: the fields it reads (`$2`, `$NF`; not `$0`, the whole line), and the first match of a
 * regex alone (`/nginx/`, POSIX's leftmost longest, as `match()` finds it), while the record is the line as read; the
 * lines it leaves out are those no rule of the main part selects, when it has one, and those it does not read (after
 * `exit`). `kind`: `match` when it matches a regex and reads no field, else `field`. Only for a program `runAwk` runs on these lines.
 */
export function awkMarks(a: AwkInvocation, input: string[]): StageMarks {
  const ranges: [number, number][][] = input.map(() => []);
  const selected = new Set<number>();
  let k = -1;
  let fs = ' ';
  let fields = false;
  let matched = false;
  const watch: AwkWatch = {
    record: (now) => { k++; fs = now; },
    selected: () => { selected.add(k); },
    field: (now, i) => {
      // (Fields of a record awk changed, or of none yet, in BEGIN, are not the line's.)
      const spans = now[0] === input[k] ? fieldSpans(input[k], fs) : [];
      const same = spans.length === now.length - 1 && spans.every(([s, e], j) => input[k].slice(s, e) === now[j + 1]);
      if (i === 0 || !same || !spans[i - 1] || spans[i - 1][1] === spans[i - 1][0]) return;
      ranges[k].push(spans[i - 1]);
      fields = true;
    },
    regex: (now, re) => {
      const m = now[0] === input[k] ? posixExec(re, input[k], 0) : null;
      if (!m?.[0]) return;
      ranges[k].push([m.index, m.index + m[0].length]);
      matched = true;
    },
  };
  runAwk(a.program!, input, { ...a, watch });
  const main = parseAwk(a.program!)!.rules.some((r) => !r.begin && !r.end);
  return { kind: matched && !fields ? 'match' : 'field', ranges, dropped: input.flatMap((_, i) => (i > k || (main && !selected.has(i)) ? [i] : [])) };
}

/** The ranges of each line in order, those that overlap or touch made one. */
export function joinRanges(ranges: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const [s, e] of [...ranges].sort((x, y) => x[0] - y[0] || x[1] - y[1])) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

/**
 * The marks of the section a stage reads, named for a screen reader (「`grep nginx` が一致する部分」, "matched by `grep
 * nginx`"); `shown`: the section shows only so many lines (then `…`).
 */
export function sectionMarks(m: StageMarks, by: string, lang: Lang, shown = Infinity): SectionMarks {
  const ja = { match: `\`${by}\` が一致する部分`, field: `\`${by}\` が読む部分`, take: `\`${by}\` が取り出す部分`, key: `\`${by}\` が比べる部分` };
  const en = { match: `matched by \`${by}\``, field: `read by \`${by}\``, take: `taken by \`${by}\``, key: `compared by \`${by}\`` };
  const dropped = m.dropped.filter((i) => i < shown);
  return { said: (lang === 'ja' ? ja : en)[m.kind], ranges: m.ranges.slice(0, shown), ...(dropped.length ? { dropped } : {}) };
}
