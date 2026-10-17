// Re-runs a worked example on input the user typed in the panel (regex101's test string).
import type { Lang } from '../i18n';
import { formatDate, parseSampleDate } from '../embedded/format';
import { runAwk } from './awk';
import { Json, runJq, toJson } from './jq';
import { PerlOptions, runPerl } from './perlrun';
import { pipelineExample, Stage } from './pipeline';
import { JsRegex } from './regex';
import { runXargs, showCommand } from './runtime';
import { runSed } from './sed';
import { globMatches, GlobMode, GlobOpts } from './shellwords';
import { FILTERS } from './textfilters';

/** Everything needed to run an example again on new input; plain data, so it can go to the webview and back. */
export type RerunSpec =
  | { kind: 'regex'; regex: JsRegex; mode: 'lines' | 'inverted' | 'values' }
  | { kind: 'glob'; pattern: string; mode: GlobMode; opts?: GlobOpts }
  | { kind: 'sed'; script: string; quiet: boolean; extended: boolean; highlight?: JsRegex }
  | { kind: 'awk'; program: string; fs?: string; vars: Record<string, string> }
  | { kind: 'jq'; filter: string; raw: boolean; vars: Record<string, Json> }
  | { kind: 'perl'; code: string; opts: PerlOptions }
  | { kind: 'filter'; cmd: string; words: (string | undefined)[] }
  | { kind: 'pipeline'; stages: Stage[] }
  | { kind: 'xargs'; words: (string | undefined)[] }
  | { kind: 'date'; format: string };

/** A highlighted range on a line of the input: the whole match (group 0) or a capture group. */
export interface Mark { start: number; end: number; group: number }

export interface RerunSection { label: string; lines: string[]; empty?: string }

export interface RerunResult {
  sections: RerunSection[];
  /** Per input line, the ranges to highlight. */
  marks?: Mark[][];
}

/** The example in a form the panel can edit: the input, and what it currently gives. */
export interface Interactive {
  spec: RerunSpec;
  inputLabel: string;
  input: string[];
  result: RerunResult;
}

/** Every match of the regex on a line, with the range of each capture group (group 0 is the match). */
export function matchMarks(regex: JsRegex, line: string): Mark[] {
  let re: RegExp;
  try {
    re = new RegExp(regex.source, `${regex.flags.replace(/[gd]/g, '')}gd`);
  } catch {
    return [];
  }
  const marks: Mark[] = [];
  for (let m = re.exec(line), n = 0; m && n < 50; m = re.exec(line), n++) {
    const idx = (m as RegExpExecArray & { indices?: ([number, number] | undefined)[] }).indices ?? [];
    idx.forEach((r, g) => { if (r && (g === 0 || r[1] > r[0])) marks.push({ start: r[0], end: r[1], group: g }); });
    if (m[0] === '') re.lastIndex++;
  }
  return marks;
}

/** "line 2: `2026` … group 1 = `2026`" for the first few matches that have capture groups. */
function groupLines(regex: JsRegex, input: string[], lang: Lang): string[] {
  let re: RegExp;
  try {
    re = new RegExp(regex.source, regex.flags.replace(/[gd]/g, ''));
  } catch {
    return [];
  }
  const out: string[] = [];
  input.forEach((line, i) => {
    const m = re.exec(line);
    if (!m || m.length < 2 || out.length >= 4) return;
    const groups = m.slice(1).map((g, k) => `\\${k + 1}=${g === undefined ? (lang === 'ja' ? '（なし）' : '(none)') : JSON.stringify(g)}`);
    out.push(`${lang === 'ja' ? `${i + 1}行目` : `line ${i + 1}`}: ${JSON.stringify(m[0])}  ${groups.join('  ')}`);
  });
  return out;
}

/** Run an example again on the given input lines. */
export function rerun(spec: RerunSpec, input: string[], lang: Lang): RerunResult {
  const s = (ja: string, en: string) => (lang === 'ja' ? ja : en);
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
    case 'awk': return out(runAwk(spec.program, input, { fs: spec.fs, vars: spec.vars }));
    case 'perl': return out(runPerl(spec.code, spec.opts, input));
    case 'filter': {
      const run = FILTERS[spec.cmd];
      return out(run ? run(spec.words, input) : undefined);
    }
    case 'jq': {
      let value: Json;
      try {
        value = JSON.parse(input.join('\n')) as Json;
      } catch (e) {
        return { sections: [{ label: s('エラー', 'Error'), lines: [s('入力が JSON として読めません', 'The input is not valid JSON') + `: ${(e as Error).message}`] }] };
      }
      const res = runJq(spec.filter, value, spec.vars);
      if (!res) return out(undefined);
      if ('error' in res) return { sections: [{ label: s('エラー', 'Error'), lines: [res.error] }] };
      return out(res.outputs.map((v) => (spec.raw && typeof v === 'string' ? v : toJson(v))));
    }
    case 'pipeline': {
      const ex = pipelineExample(spec.stages, true, input);
      if (!ex) return out(undefined);
      return {
        sections: ex.steps.filter((st, i) => st.stage.cmd !== 'cat' || i === ex.steps.length - 1).map((st, i, all) => ({
          label: i === all.length - 1 ? s(`出力（\`${st.stage.text}\` の後）`, `Output (after \`${st.stage.text}\`)`) : s(`\`${st.stage.text}\` の後`, `After \`${st.stage.text}\``),
          lines: st.output, empty: s('（なし）', '(nothing)'),
        })),
      };
    }
    case 'xargs': return out(runXargs(spec.words, input.join('\n') + '\n').map(showCommand), s('実行されるコマンド', 'Commands that run'));
    case 'date': {
      const unreadable = s('（日時として読めません。`2024-03-05 07:08:09` の形で）', '(not a date; write it like `2024-03-05 07:08:09`)');
      return out(input.filter((l) => l.trim()).map((l) => {
        const when = parseSampleDate(l);
        return when ? (formatDate(spec.format, when) ?? '') : unreadable;
      }));
    }
  }
}
