// The worked examples of a command's run (printf, xargs, getopt, perl, read, the text filters, date, git log), built
// from its words. The analyzer chooses one by the command's spec (`CommandSpec.example`), not by its name, and shows
// what it returns.
import type { Example } from '../analyzer-types';
import type { CommandExampleKind } from '../argv/spec';
import { visible } from '../ctlchars';
import { formatDate as formatDateCommand, parseSampleDate, SAMPLE_DATES, UTC } from '../embedded/format';
import { pick } from '../embedded/types';
import type { Lang } from '../i18n';
import { dateOutputLabel, parseDateValue, relativeDate, zoneOf } from './dates';
import { GetoptSpec, GetoptUnsupported, runGetopt, sampleGetoptArgs } from './getopt';
import { formatDate, GitFormatUnsupported, runGitLog, sampleCommits } from './gitlog';
import { perlExample, perlOptions } from './perlrun';
import { InputBox, Interactive, rerun, RerunSpec } from './rerun';
import { InputSource, knownLines, readOrder, shareOut, shownSource, streamLabel } from './source';
import { readSampleLine, runRead, xargsExample as runXargs } from './runtime';
import { bashPrintf, ShellWordsUnsupported } from './shellwords';
import { commandExample, parseOptions, parseWords, shortKeys, Unsupported as TextFiltersUnsupported } from './textfilters';
import type { ArgvParse } from '../argv/interpret';
import { has, values } from '../argv/query';

/** A word of the command line: its text when it is known (`literalContent`), and as written. */
export interface ExampleWord { value: string | undefined; text: string }

/** An example's editable form for the panel: the spec to run it again, its input boxes, and what they give now. */
export function interactive(spec: RerunSpec, inputs: InputBox[], lang: Lang): Interactive {
  return { spec, inputs, result: rerun(spec, inputs.map((b) => b.lines), lang) };
}

/** Where a command reads when nothing on the line says (its standard input, from wherever the script's comes). */
const STDIN: InputSource = { streams: [{ kind: 'stdin', stdin: { from: 'unknown' } }] };

/**
 * An input → output example (sed, awk, sort…) of the made-up lines `sample` and what the command makes of them,
 * `output`; tabs and control characters are made visible. `all`: what the command reads (src/examples/source.ts),
 * one section each, with the sample shared out among the files and the text the line gives (a here-string) used as
 * it is. A command that works on each file apart or rewrites each shows the first one; one that prints each under a
 * header (`EachFile`) shows them.
 */
export function ioExample(sample: string[], output: string[], spec: RerunSpec, lang: Lang, all: InputSource = STDIN): Example {
  const s = pick(lang);
  const tabs = (lines: string[]) => lines.map(visible);
  const kind = spec.kind === 'sed' || spec.kind === 'awk' || spec.kind === 'perl' ? spec.kind : 'textFilters';
  const src = shownSource(all);
  const inPlace = src.each === 'in-place';
  const title = inPlace ? s('例（ファイルの中身がこう書き換わる）', 'Example (the file is rewritten like this)') : s('例', 'Example');
  // (`uniq IN OUT`, `sort -o OUT`: the output goes to the file, and nothing to the standard output.)
  const outLabel = inPlace ? s('書き換え後', 'After') : src.writes ? s(`\`${src.writes}\` に書き込まれる内容`, `Written to \`${src.writes}\``) : s('出力', 'Output');
  // (awk's only program that reads nothing: `BEGIN` rules alone.)
  if (!src.streams.length) {
    return { kind, title, note: s('入力は読まない（`BEGIN` だけ）', 'Reads no input (`BEGIN` only)'), sections: [{ label: outLabel, lines: tabs(output), empty: s('（出力なし）', '(no output)') }] };
  }
  const { streams } = src;
  const contents = shareOut(src, sample);
  const reads = src.reads ? { reads: src.reads } : {};
  // head and tail print each file under a header, and awk names the file it reads in `FILENAME`: they are told the
  // names, in the order the tool reads the files.
  const names = (stdin: string) => readOrder(src, streams.map((st) => [st.kind === 'file' ? st.name : stdin])).map((n) => n[0] ?? stdin);
  const run: RerunSpec = spec.kind === 'filter' && src.each === 'headers' ? { ...spec, files: names('standard input'), ...reads }
    : spec.kind === 'awk' && src.fileName && streams.some((st) => st.kind === 'file') ? { ...spec, files: names('-'), ...reads } : { ...spec, ...reads };
  // The output of what the files hold, unless they hold the sample as it is.
  const asSample = contents.flat().length === sample.length && !src.reads && !streams.some(knownLines) && !('files' in run);
  const shown = asSample ? output : rerun(run, contents, lang).sections[0].lines;
  const boxes = streams.map((st, i) => ({ label: streamLabel(st, lang), lines: contents[i] }));
  return { kind,
    interactive: interactive(run, boxes, lang),
    title,
    sections: [
      ...boxes.map((b) => ({ label: b.label, lines: tabs(b.lines), empty: s('（空）', '(empty)') })),
      { label: outLabel, lines: tabs(shown), empty: s('（出力なし）', '(no output)') },
    ],
  };
}

/** What a command whose spec names `kind` does with these words (`read` has `readExample`). */
export function commandExampleOf(kind: Exclude<CommandExampleKind, 'read'>, words: ExampleWord[], lang: Lang, src: InputSource = STDIN): Example | undefined {
  const s = pick(lang);
  const values = words.map((w) => w.value);
  switch (kind) {
    case 'printf': return printfExample(values, lang);
    case 'xargs': return xargsExample(words, lang, src);
    case 'getopt': return getoptExample(values, lang);
    case 'perl': {
      const parsed = perlOptions(values);
      const ex = parsed && perlExample(parsed.code, parsed.opts);
      if (!ex) return undefined;
      if (ex.input.length) return ioExample(ex.input, ex.output, { kind: 'perl', code: parsed!.code, opts: parsed!.opts }, lang, src);
      return { kind: 'perl', title: s('例', 'Example'), sections: [{ label: s('出力', 'Output'), lines: ex.output.map(visible), empty: s('（出力なし）', '(no output)') }] };
    }
    default: {
      const ex = commandExample(kind, values);
      if (!ex) return undefined;
      // Only the filters take input. Files of a glob or a variable may be any number: the headers of each are not known.
      if (ex.input) {
        if (src.each === 'headers' && src.streams.some((st) => st.kind === 'file' && (st.many || st.pipe))) return undefined;
        return ioExample(ex.input, ex.output, { kind: 'filter', cmd: kind, words: values }, lang, src);
      }
      return { kind: 'textFilters', title: s('例', 'Example'), sections: [{ label: s('出力', 'Output'), lines: ex.output.map(visible) }] };
    }
  }
}

/** What `printf FORMAT ARGS…` prints, when all of them are literal. */
function printfExample(words: (string | undefined)[], lang: Lang): Example | undefined {
  const s = pick(lang);
  if (words.some((w) => w === undefined)) return undefined;
  let list = words as string[];
  let target: string | undefined;
  if (list[0] === '-v') {
    target = list[1];
    list = list.slice(2);
  }
  if (list[0] === '--') list = list.slice(1);
  if (!list.length) return undefined;
  let out: string;
  try {
    out = bashPrintf(list[0], list.slice(1));
  } catch (e) {
    if (e instanceof ShellWordsUnsupported) return undefined;
    // A bug in bashPrintf: let it show.
    /* c8 ignore next */
    throw e;
  }
  const endsWithNewline = out.endsWith('\n');
  const lines = (endsWithNewline ? out.slice(0, -1) : out).split('\n').map(visible);
  const label = target
    ? s(`変数 \`${target}\` に入る値`, `Value stored in \`${target}\``)
    : endsWithNewline ? s('出力', 'Output') : s('出力（末尾に改行なし）', 'Output (no trailing newline)');
  return { kind: 'printf', title: s('例', 'Example'), sections: [{ label, lines, empty: s('（空文字）', '(empty)') }] };
}

/** The commands xargs runs for a sample input. */
function xargsExample(words: ExampleWord[], lang: Lang, src: InputSource): Example | undefined {
  const s = pick(lang);
  const values = words.map((w) => w.value);
  const ex = runXargs(values);
  if (!ex) return undefined;
  const input = ex.input.endsWith('\n') ? ex.input.slice(0, -1).split('\n') : [ex.input];
  // (xargs reads one stream: its standard input, or the file `-a` names.)
  const label = streamLabel(src.streams[0], lang);
  return { kind: 'xargs',
    title: s('例', 'Example'),
    sections: [
      { label, lines: input.map(visible) },
      { label: s('実行されるコマンド', 'Commands that run'), lines: ex.commands, empty: s('（実行されない）', '(none)') },
    ],
    // Input split on NUL or another delimiter is not one item per line, so it is not editable.
    ...(has(parseWords('xargs', values), '-0', '-d') ? {} : { interactive: interactive({ kind: 'xargs', words: values }, [{ label, lines: input }], lang) }),
  };
}

/** How getopt rearranges sample arguments, from the `-o` / `--long` given. */
function getoptExample(words: (string | undefined)[], lang: Lang): Example | undefined {
  const s = pick(lang);
  const spec: GetoptSpec = { short: '', long: [] };
  // getopt's own options, read with its spec; `-Q` and `-T` print nothing to show, and a value not known gives none.
  let p;
  try {
    p = parseOptions('getopt', words, shortKeys('olaqu', { '-n': '_', '-s': '_' }));
  } catch (e) {
    if (e instanceof TextFiltersUnsupported) return undefined;
    /* c8 ignore next */
    throw e;
  }
  for (const [key, v] of p.opts) {
    if (key === 'o') spec.short = v;
    else if (key === 'l') spec.long.push(...v.split(','));
    else if (key === 'a') spec.alternative = true;
  }
  // The old form: `getopt OPTSTRING ARGS…`, when no `-o` is given.
  if (!p.opts.some(([key]) => key === 'o') && p.operands.length) {
    if (p.operands[0] === undefined) return undefined;
    spec.short = p.operands[0];
    spec.legacy = true;
  }
  if (!spec.short && !spec.long.length) return undefined;
  try {
    const sample = sampleGetoptArgs(spec);
    const output = runGetopt(spec, sample);
    const shown = sample.map((a) => (/^[\w.,=\/-]+$/.test(a) ? a : `'${a.replace(/'/g, "'\\''")}'`)).join(' ');
    return { kind: 'getopt',
      title: s('例', 'Example'),
      sections: [
        { label: s('スクリプトに渡された引数の例', 'Sample arguments given to the script'), lines: [shown] },
        {
          label: spec.legacy
            ? s('getopt の出力（`set --` に渡すと引数がこの順に並び直る。旧形式はクォートしないので空白を含む引数が壊れる）', 'What getopt prints (`set --` puts the arguments in this order; the old form does not quote, so arguments with spaces break)')
            : s('getopt の出力（`eval set --` に渡すと引数がこの順に並び直る）', 'What getopt prints (`eval set --` puts the arguments in this order)'),
          lines: [output.trimStart()],
        },
      ],
    };
    /* c8 ignore start */
  } catch (e) {
    // The sample arguments are made to fit the spec, so getopt never rejects them: a guard.
    if (!(e instanceof GetoptUnsupported)) throw e;
    return undefined;
  }
  /* c8 ignore stop */
}

/**
 * How `read` splits a sample line into its variables, with the IFS given before it (`ifs`, undefined when it is not
 * known) and the line of a here-string (`here`); and a note on a separator that is not whitespace.
 */
export function readExample(words: (string | undefined)[], ifs: string | undefined, here: string | undefined, lang: Lang): { example: Example; note?: string } | undefined {
  const s = pick(lang);
  if (ifs === undefined || words.some((w) => w === undefined)) return undefined;
  let p;
  try {
    p = parseOptions('read', words, shortKeys('rseaptu'));
  } catch (e) {
    // An option the example does not model (`-n 3`): no example. Anything else is a bug, which shows.
    if (e instanceof TextFiltersUnsupported) return undefined;
    /* c8 ignore next */
    throw e;
  }
  const array = p.opts.find(([o]) => o === 'a')?.[1];
  const names = (p.operands as string[]).length ? (p.operands as string[]) : array ? [] : ['REPLY'];
  const raw = p.opts.some(([o]) => o === 'r');
  // The line the command reads, when a here-string gives it: `read -a p <<< "a,b,,c,"`.
  const line = here ?? readSampleLine(names.length, ifs, !!array);
  const r = runRead(line, names, { ifs, raw, array });
  let note: string | undefined;
  // A separator that is not whitespace (`IFS=,`) keeps empty fields; a trailing one adds no field.
  if (/[^ \t\n]/.test(ifs)) {
    const seps = [...ifs].filter((c) => !/[ \t\n]/.test(c)).map((c) => `\`${c}\``).join(s('、', ', '));
    note = s(
      `\`IFS=${ifs}\` の \`read\`: 空白以外の区切り文字（${seps}）が続くと、間の空のフィールドもそのまま残る（空白の区切りは続いても1つにまとまる）。末尾の区切り文字の後ろには空のフィールドはできない`,
      `\`read\` with \`IFS=${ifs}\`: a separator that is not whitespace (${seps}) keeps the empty field between two of them (whitespace separators merge into one); a separator at the end of the line adds no empty field after it`);
  }
  const lines = r.array ? [`${r.array[0]}=(${r.array[1].map((x) => JSON.stringify(x)).join(' ')})`] : r.vars.map(([k, v]) => `${k}=${JSON.stringify(v)}`);
  const example: Example = { kind: 'read',
    title: s('例', 'Example'),
    sections: [{ label: s('読み込む行', 'Line read'), lines: [JSON.stringify(line)] }, { label: s('変数に入る値', 'Values stored'), lines }],
  };
  return { example, ...(note ? { note } : {}) };
}

/** What a `date +FORMAT` line gives besides its format (src/explain/examples.ts: `dateRun`). */
export interface DateRun {
  /** The value of `TZ` where it runs (a prefix assignment, an exported variable), unless `-u` is given. */
  tz?: string;
  /** `-d DATE`/`--date=DATE`, the last given: the option as written, the value as written, and its text when known. */
  date?: { option: string; text: string; value?: string };
  /** `-f FILE`/`--file=FILE`: what it reads, a date on each line. */
  file?: InputSource;
  /** `-r FILE`/`--reference=FILE`: the file whose modification time it prints. */
  reference?: string;
}

/**
 * What `date +FORMAT` prints: at fixed, made-up moments when it prints the time it runs (in UTC, so the same line
 * always shows the same, or in the zone `TZ` names), for the date `-d` gives when it is fixed, or for the dates `-f`
 * reads. Undefined when the example cannot follow the format, the zone or the date.
 */
export function dateExample(format: string, run: DateRun, lang: Lang): Example | undefined {
  const s = pick(lang);
  const zone = run.tz === undefined ? UTC : zoneOf(run.tz);
  if (!zone) return undefined;
  const tz = run.tz !== undefined ? { tz: run.tz } : {};
  const outputs = (dates: (Date | undefined)[]) => {
    const out = dates.map((d) => d && formatDateCommand(format, d, zone));
    return out.every((o) => o !== undefined) ? out.map((o) => visible(o!)) : undefined;
  };
  // (`-f`: the lines date reads, which it reads as dates in its time zone.)
  if (run.file) {
    const stream = run.file.streams[0];
    const known = knownLines(stream);
    const lines = outputs((known ?? SAMPLE_DATES).map((l) => parseDateValue(l, zone)));
    // (Of several files, date reads only the last one given.)
    if (!lines || run.file.streams.length !== 1) return undefined;
    const label = streamLabel(stream, lang);
    return { kind: 'date',
      ...(known ? {} : { interactive: interactive({ kind: 'date', format, ...tz, local: true }, [{ label, lines: SAMPLE_DATES }], lang) }),
      title: s('例', 'Example'),
      sections: [{ label, lines: known ?? SAMPLE_DATES }, { label: dateOutputLabel(run.tz, true, lang), lines }],
    };
  }
  const given = run.date;
  // A date that does not depend on when date runs: what it prints is fixed.
  const fixed = given?.value !== undefined ? parseDateValue(given.value, zone) : undefined;
  if (fixed) {
    const lines = outputs([fixed]);
    return lines && { kind: 'date',
      title: s(`例（\`${given!.option}\` で指定した日時）`, `Example (the date given with \`${given!.option}\`)`),
      sections: [{ label: dateOutputLabel(run.tz, true, lang), lines }],
    };
  }
  // A date of another form, read from the moment date runs, or not known here: made-up dates stand for it. (One of
  // another fixed form, `Jan 2 2024`, is not followed.)
  const relative = given?.value !== undefined && relativeDate(given.value);
  if (given?.value !== undefined && !relative) return undefined;
  const lines = outputs(SAMPLE_DATES.map((d) => parseSampleDate(d)));
  if (!lines) return undefined;
  const when = run.reference !== undefined ? s(`\`${run.reference}\` の更新日時（例、UTC）`, `Modification time of \`${run.reference}\` (made up, UTC)`)
    : given ? s(`\`${given.option} ${given.text}\` が表す日時（例、UTC）`, `The date \`${given.option} ${given.text}\` stands for (made up, UTC)`)
      // `date` reads no input: these are the moments at which it runs.
      : s('実行した時刻（例、UTC）', 'When it runs (made up, UTC)');
  return { kind: 'date',
    interactive: interactive({ kind: 'date', format, ...tz }, [{ label: when, lines: SAMPLE_DATES }], lang),
    title: relative ? s(`例（\`${given!.value}\` は実行した時刻から決まる）`, `Example (\`${given!.value}\` depends on when it runs)`) : s('例', 'Example'),
    sections: [
      { label: when, lines: SAMPLE_DATES },
      { label: dateOutputLabel(run.tz, false, lang), lines },
    ],
  };
}

/**
 * `git log` output for sample commits, for a `--pretty`/`--format` or `--date` value. `parse` is the parse of
 * `log`'s words and `words` their text (undefined where not known), indexed as the parse's words are: the other
 * options are read from it, the last one given winning (`--max-count 2`, `-n2`, `-2`).
 */
export function gitLogExample(kind: 'gitformat' | 'gitdate', value: string, parse: ArgvParse, words: (string | undefined)[], lang: Lang): Example | undefined {
  const s = pick(lang);
  const last = (...names: string[]): string | undefined => values(parse, ...names).map(({ word, at }) => words[word]?.slice(at ?? 0)).filter((v) => v !== undefined).pop();
  const pretty = kind === 'gitformat' ? value : last('--pretty') ?? (has(parse, '--oneline') ? 'oneline' : undefined);
  const date = kind === 'gitdate' ? value : last('--date') ?? 'default';
  const now = Date.now();
  let commits = sampleCommits(now);
  // `-n N`, `--max-count=N` and `-N` (a pattern option): the last one given.
  const counts = [
    ...values(parse, '-n').map(({ word, at }) => ({ word, text: words[word]?.slice(at ?? 0) })),
    ...parse.roles.flatMap(({ word, role }) => (role.role === 'pattern-option' ? [{ word, text: role.flag.slice(1) }] : [])),
  ].sort((a, b) => a.word - b.word);
  const count = counts.pop()?.text;
  if (count !== undefined && /^\d+$/.test(count)) commits = commits.slice(0, Math.max(1, Number(count)));
  try {
    if (kind === 'gitdate') {
      return { kind: 'gitLog',
        title: s('例（この形式で表示した日時）', 'Example (dates in this style)'),
        sections: [{
          label: s('例のコミットの日時がこう表示される（`%ad`・`%cd` や Date: 行）', 'How the sample commits\' dates are shown (`%ad`, `%cd`, the Date: line)'),
          lines: commits.map((c) => visible(formatDate(c.time, date, now))),
        }],
      };
    }
    // Multi-line formats get long; two commits show the layout.
    const multi = !pretty || ['short', 'medium', 'full', 'fuller'].includes(pretty);
    const lines = runGitLog(multi ? commits.slice(0, 2) : commits, pretty, date, now);
    return { kind: 'gitLog',
      title: s('例（この書式での `git log` の出力）', 'Example (`git log` output with this format)'),
      sections: [{ label: s('例のコミットでの出力', 'Output for sample commits'), lines: lines.map(visible) }],
    };
    /* c8 ignore start */
  } catch (e) {
    // A guard: runGitLog throws nothing else.
    if (!(e instanceof GitFormatUnsupported)) throw e;
    return undefined;
  }
  /* c8 ignore stop */
}
