// Re-runs a worked example on input the user typed in the panel (regex101's test string).
import type { Lang } from '../i18n';
import { formatDate, parseSampleDate, UTC } from '../embedded/format';
import { runAwk } from './awk';
import { dateOutputLabel, parseDateValue, zoneOf } from './dates';
import { Json, JqFormat, jqOutputLines, jqPrint, JqStep, jqSteps, parseJsonValues, runJq } from './jq';
import { PerlOptions, runPerl } from './perlrun';
import { pipelineExample, Stage } from './pipeline';
import { JsRegex } from './regex';
import { runXargs, showCommand } from './runtime';
import { runSed } from './sed';
import { globMatches, GlobMode, GlobOpts } from './shellwords';
import { FILTERS, perFile } from './textfilters';

/**
 * Everything needed to run an example again on new input; plain data, so it can go to the webview and back. `reads`:
 * the box each read of the command takes, in order, when it reads a file twice (`sort a a`; `-1`: the standard input
 * read again, which gives nothing more), from `InputSource.reads`.
 */
export type RerunSpec = RerunKind & { reads?: number[] };

type RerunKind =
  | { kind: 'regex'; regex: JsRegex; mode: 'lines' | 'inverted' | 'values' }
  | { kind: 'glob'; pattern: string; mode: GlobMode; opts?: GlobOpts }
  | { kind: 'sed'; script: string; quiet: boolean; extended: boolean; highlight?: JsRegex }
  /** `files`: the names of the files it reads, one per box (`FILENAME`). */
  | { kind: 'awk'; program: string; fs?: string; vars: Record<string, string>; assigns?: Record<string, string>; files?: string[] }
  /**
   * `format`: how the results are printed (one line each when not given); `nullInput` (`-n`): `.` is null and the inputs
   * are left to `input` and `inputs`; `rawInput` (`-R`): each line is a string.
   */
  | { kind: 'jq'; filter: string; raw: boolean; join?: boolean; slurp?: boolean; vars: Record<string, Json>; format?: JqFormat; nullInput?: boolean; rawInput?: boolean }
  | { kind: 'perl'; code: string; opts: PerlOptions }
  /** `files`: the names of the files it reads, for a tool that prints each one apart (`head`, `tail`: `==> a <==`). */
  | { kind: 'filter'; cmd: string; words: (string | undefined)[]; files?: string[] }
  | { kind: 'pipeline'; stages: Stage[] }
  | { kind: 'xargs'; words: (string | undefined)[] }
  /**
   * `tz`: the zone `TZ` names (src/examples/dates.ts), else UTC; `local`: the lines are dates as `date -f` reads them
   * (in that zone, or `@SECONDS`), else moments in UTC.
   */
  | { kind: 'date'; format: string; tz?: string; local?: boolean };

/** A highlighted range on a line of the input: the whole match (group 0) or a capture group. */
export interface Mark { start: number; end: number; group: number }

export interface RerunSection { label: string; lines: string[]; empty?: string }

export interface RerunResult {
  sections: RerunSection[];
  /** Per input line, the ranges to highlight. */
  marks?: Mark[][];
}

/** One box of input the panel can edit: a file the command reads, or its standard input. */
export interface InputBox { label: string; lines: string[] }

/** The example in a form the panel can edit: the inputs, one box each, and what they currently give. */
export interface Interactive {
  spec: RerunSpec;
  inputs: InputBox[];
  result: RerunResult;
}

/** Every match of the regex on a line, with the range of each capture group (group 0 is the match). */
export function matchMarks(regex: JsRegex, line: string): Mark[] {
  // A JsRegex is checked when it is made, and `g` and `d` fit any flags.
  const re = new RegExp(regex.source, `${regex.flags.replace(/[gd]/g, '')}gd`);
  const marks: Mark[] = [];
  for (let m = re.exec(line), n = 0; m && n < 50; m = re.exec(line), n++) {
    const idx = (m as RegExpExecArray & { indices: ([number, number] | undefined)[] }).indices;
    idx.forEach((r, g) => { if (r && (g === 0 || r[1] > r[0])) marks.push({ start: r[0], end: r[1], group: g }); });
    if (m[0] === '') re.lastIndex++;
  }
  return marks;
}

/** "line 2: `2026` … group 1 = `2026`" for the first few matches that have capture groups. */
function groupLines(regex: JsRegex, input: string[], lang: Lang): string[] {
  const re = new RegExp(regex.source, regex.flags.replace(/[gd]/g, ''));
  const out: string[] = [];
  input.forEach((line, i) => {
    const m = re.exec(line);
    if (!m || m.length < 2 || out.length >= 4) return;
    const groups = m.slice(1).map((g, k) => `\\${k + 1}=${g === undefined ? (lang === 'ja' ? '（なし）' : '(none)') : JSON.stringify(g)}`);
    out.push(`${lang === 'ja' ? `${i + 1}行目` : `line ${i + 1}`}: ${JSON.stringify(m[0])}  ${groups.join('  ')}`);
  });
  return out;
}

/**
 * The sections of a filter with top-level pipes: the values after each stage, worded as for a
 * shell pipeline. `show` prints values; `last` is the output as the example shows it.
 */
export function jqStepSections(steps: JqStep[], last: string[], lang: Lang, show: (values: Json[]) => string[]): RerunSection[] {
  const s = (ja: string, en: string) => (lang === 'ja' ? ja : en);
  return steps.map((st, i) => {
    const text = st.text.length > 40 ? `${st.text.slice(0, 39)}…` : st.text;
    if (i === steps.length - 1) return { label: s(`出力（\`${text}\` の後）`, `Output (after \`${text}\`)`), lines: last, empty: s('（出力なし）', '(no output)') };
    const many = st.values.length > 5;
    return { label: s(`\`${text}\` の後`, `After \`${text}\``), lines: [...show(many ? st.values.slice(0, 4) : st.values), ...(many ? ['…'] : [])], empty: s('（なし）', '(nothing)') };
  });
}

/**
 * A word that is not literal is undefined. A spec sent back by the VS Code panel went through
 * JSON, which turns it into null, so read null as undefined again.
 */
const words = (ws: (string | null | undefined)[]) => ws.map((w) => w ?? undefined);

/**
 * Run an example again on the given input lines, one list per box (`Interactive.inputs`). The files a command reads
 * as one stream are read one after another (in the order of `reads`, when a file is named twice); the marks of a regex
 * are per line of them all, in that order.
 */
export function rerun(spec: RerunSpec, boxes: string[][], lang: Lang): RerunResult {
  const s = (ja: string, en: string) => (lang === 'ja' ? ja : en);
  const inputs = spec.reads ? spec.reads.map((i) => (i < 0 ? [] : boxes[i])) : boxes;
  const input = inputs.flat();
  const none = s('（出力なし）', '(no output)');
  const out = (lines: string[] | undefined, label = s('出力', 'Output')): RerunResult => ({
    sections: [{ label, lines: lines ?? [s('（この入力では実行できません）', '(cannot run on this input)')], empty: none }],
  });
  switch (spec.kind) {
    case 'regex': {
      const marks = input.map((l) => matchMarks(spec.regex, l));
      const hit = input.filter((_, i) => marks[i].some((m) => m.group === 0));
      const miss = input.filter((_, i) => !marks[i].some((m) => m.group === 0));
      const groups = groupLines(spec.regex, input, lang);
      const sections: RerunSection[] = spec.mode === 'inverted'
        ? [{ label: s('表示される行（一致しない行）', 'Printed (lines that do not match)'), lines: miss, empty: s('（なし）', '(none)') }]
        : [{ label: spec.mode === 'values' ? s('一致する値', 'Matches') : s('一致する行', 'Matching lines'), lines: hit, empty: s('（なし）', '(none)') }];
      if (groups.length) sections.push({ label: s('グループに入る文字列', 'What the groups capture'), lines: groups });
      return { sections, marks };
    }
    case 'glob': {
      const hit = input.filter((l) => globMatches(spec.pattern, l, spec.mode, spec.opts));
      return {
        sections: [{ label: s('一致する名前', 'Matching names'), lines: hit, empty: s('（なし）', '(none)') }],
        marks: input.map((l) => (globMatches(spec.pattern, l, spec.mode, spec.opts) ? [{ start: 0, end: l.length, group: 0 }] : [])),
      };
    }
    case 'sed': {
      const r = out(runSed(spec.script, input, { quiet: spec.quiet, extended: spec.extended }));
      if (spec.highlight) r.marks = input.map((l) => matchMarks(spec.highlight!, l));
      return r;
    }
    case 'awk': return out(runAwk(spec.program, input, { ...spec, files: spec.files?.map((name, i) => ({ name, lines: inputs[i] })) }));
    case 'perl': return out(runPerl(spec.code, spec.opts, input));
    case 'filter': {
      const run = FILTERS[spec.cmd];
      if (!run) return out(undefined);
      // (`files` is given to the tools that print a header for each file, head and tail: `EachFile`.)
      if (spec.files) return out(perFile(spec.cmd as 'head' | 'tail', spec.files.map((name, i) => ({ name, lines: inputs[i] })), words(spec.words)));
      return out(run(words(spec.words), input));
    }
    case 'jq': {
      const format = spec.format ?? { indent: 0 };
      const show = (vs: Json[]): string[] => jqOutputLines(vs, { ...spec, format });
      let values: Json[];
      if (spec.rawInput) {
        // `-R`: each line is a string; with `-s`, the whole text is one.
        values = spec.slurp ? [input.map((l) => l + '\n').join('')] : input;
      } else {
        try {
          // Each box holds JSON values (a file may hold several); jq reads them all, one after another.
          values = inputs.flatMap((box) => parseJsonValues(box.join('\n')));
        } catch (e) {
          return { sections: [{ label: s('エラー', 'Error'), lines: [s('入力が JSON として読めません', 'The input is not valid JSON') + `: ${(e as Error).message}`] }] };
        }
        // `-s`: the filter reads them all as one array.
        if (spec.slurp) values = [values];
      }
      // Each value read is `.` for a run of the filter, which may read the next ones (`input`); with `-n`, `.` is null once.
      const queue = [...values];
      const results: Json[] = [];
      let runs = 0;
      while (spec.nullInput ? runs === 0 : queue.length) {
        const value = spec.nullInput ? null : queue.shift()!;
        runs++;
        const res = runJq(spec.filter, value, spec.vars, queue);
        if (!res) return out(undefined);
        if ('error' in res) {
          const before = show(results);
          return { sections: [...(before.length ? [{ label: s('出力', 'Output'), lines: before }] : []), { label: s('エラー', 'Error'), lines: [res.error] }] };
        }
        results.push(...res.outputs);
      }
      const lines = show(results);
      const steps = spec.join || spec.nullInput || runs !== 1 || values.length !== 1 ? undefined : jqSteps(spec.filter, values[0], spec.vars);
      return steps ? { sections: jqStepSections(steps, lines, lang, (vs) => vs.flatMap((v) => jqPrint(v, format))) } : out(lines);
    }
    case 'pipeline': {
      const ex = pipelineExample(spec.stages.map((st) => ({ ...st, words: words(st.words) })), true, input);
      if (!ex) return out(undefined);
      return {
        sections: ex.steps.filter((st, i) => !st.stage.copies || i === ex.steps.length - 1).map((st, i, all) => ({
          label: i === all.length - 1 ? s(`出力（\`${st.stage.text}\` の後）`, `Output (after \`${st.stage.text}\`)`) : s(`\`${st.stage.text}\` の後`, `After \`${st.stage.text}\``),
          lines: st.output, empty: s('（なし）', '(nothing)'),
        })),
      };
    }
    case 'xargs': return out(runXargs(words(spec.words), input.join('\n') + '\n').map(showCommand), s('実行されるコマンド', 'Commands that run'));
    case 'date': {
      const unreadable = s('（日時として読めません。`2024-03-05 07:08:09` の形で）', '(not a date; write it like `2024-03-05 07:08:09`)');
      const zone = spec.tz === undefined ? UTC : zoneOf(spec.tz)!;
      return out(input.filter((l) => l.trim()).map((l) => {
        const when = spec.local ? parseDateValue(l, zone) : parseSampleDate(l);
        return when ? (formatDate(spec.format, when, zone) ?? '') : unreadable;
      }), dateOutputLabel(spec.tz, !!spec.local, lang));
    }
  }
}
