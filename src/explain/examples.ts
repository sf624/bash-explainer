// The examples of the line (docs/design/analyzer.md, step 6): what a command's run makes of its input (from its spec:
// `CommandSpec.example`, `io`, `eachFile`), a pipeline's data through every stage, how `read` splits a line, the words
// a brace expansion or a glob gives, the strings a regex matches, the values that select a pattern or make a test
// true, and an example's editable form for the panel. The builders are in src/examples/; this module gives them the
// line (its language, the options where a node is, what a command reads) and adds what they make to the line's
// examples. The examples of jq and yq are in src/explain/examples-jq.ts.
import type { Example, ExampleSection } from '../analyzer-types';
import type { ArgvParse } from '../argv/interpret';
import { interpret } from '../argv/interpret';
import type { CommandSpec, Layout, LayoutAlt } from '../argv/spec';
import { argWordFor } from '../argv/words';
import { bracesIn } from '../semantics/argwords';
import { DEFAULT_BASH_VERSION } from '../bashversion';
import { visible } from '../ctlchars';
import { awkInvocation, type AwkRunOptions } from '../examples/awk';
import * as commandExamples from '../examples/commands';
import { echoWordsKnown } from '../examples/echo';
import * as patterns from '../examples/patterns';
import * as pipelines from '../examples/pipeline';
import { sectionMarks, type StageMarks } from '../examples/marks';
import { MAX_SHOWN_LINES, pipedOutput, type Stage } from '../examples/pipeline';
import { type JsRegex, regexExamples } from '../examples/regex';
import type { InputBox, Interactive, RerunSpec } from '../examples/rerun';
import { globMatches, type GlobMode, type GlobOpts, hasGlobstar, isGlob } from '../examples/shellwords';
import * as sources from '../examples/source';
import { ENVIRONMENT, exportOrder, layoutOf, layoutSample, madeUpPath, type Run, START_NAMES, type Started, startValue } from '../examples/layouts';
import { type InputSource, knownLines, type Piped, pipeOf, readsFiles, shareOut, type SourceWord, type Stdin, type Stream, streamLabel, substitutionLines, withSystemFiles, writesElsewhere } from '../examples/source';
import { type Text, tx } from '../i18n';
import { codeSpan, shorten } from '../label';
import { EMPTY_WORD, fact, shownWord, SPACE_MARK } from '../messages';
import { braceValues } from '../semantics/brace';
import { quotedName } from '../semantics/effects';
import { slotEnvironment } from '../semantics/env';
import type { NameResolution } from '../semantics/names';
import { exportedValue } from '../semantics/state';
import { changedByBash, changedUnseen } from '../semantics/vars';
import { literalContent, staticWordValue, substitutionNames } from '../staticword';
import { assignmentsOnly, field, nameText, prefixAssignments, redirectionsOf, type SyntaxNode, wordBraces } from '../syntax/tree';
import type { TestShape } from '../testexpr';
import { type Explainer, memoKey } from './context';
import { intersects, onLine, same } from './nodes';
import { echoMayReadEscapes, given, globOff, ifsAt, NO_SPEC, optionValues, resolve, shoptAt, type ShoptName, specFor, unquotedWord, wordAt } from './reads';
import { has, operands, readsFields, regexWords, values } from '../argv/query';
import { impliedOptions } from '../dict/aliases';
import { globbedByBash } from '../semantics/chars';
import { receivedFields, writtenPlain } from '../semantics/fieldshape';
import { wordValue } from './values';
import { braceExpansion, bracesHere } from './words';

/**
 * Strings that do and do not match `js` (as grep lines, inverted by -v, or `=~` values). `subject`: the left side of
 * `=~`, whose value where it runs, when the model knows it, comes first in its section (`subjectValue`).
 */
export function regexExample(cx: Explainer, js: JsRegex, mode: 'lines' | 'inverted' | 'values', subject?: SyntaxNode): void {
  const ex = regexExamples(js);
  if (!ex) return;
  let yes = ex.matching;
  let no = ex.nonMatching;
  // (`nocasematch` makes `=~` ignore case, which `js` does not.)
  const nocase = subject && shoptAt(cx, subject).nocasematch;
  const known = subject && (nocase === 'off' || nocase === 'default') ? subjectValue(cx, subject) : undefined;
  if (known !== undefined) {
    const first = (lines: string[]) => [known, ...lines.filter((l) => l !== known)].slice(0, Math.max(lines.length, 1));
    if (new RegExp(js.source, js.flags).test(known)) yes = first(yes);
    else no = first(no);
  }
  let sections: ExampleSection[];
  if (mode === 'inverted') {
    sections = [
      { label: cx.s('表示される行（一致しない行）', 'Printed (lines that do not match)'), lines: no },
      { label: cx.s('表示されない行（一致する行）', 'Not printed (lines that match)'), lines: yes },
    ];
  } else if (mode === 'values') {
    sections = [{ label: cx.s('一致する値', 'Matches'), lines: yes }, { label: cx.s('一致しない値', 'Does not match'), lines: no }];
  } else {
    sections = [{ label: cx.s('一致する行', 'Matching lines'), lines: yes }, { label: cx.s('一致しない行', 'Non-matching lines'), lines: no }];
  }
  cx.example({ kind: 'regex',
    title: mode === 'inverted' ? cx.s('例（`-v` なので一致しない行が表示される）', 'Example (with `-v`, lines that do not match are printed)') : cx.s('例', 'Example'),
    sections: sections.filter((s) => s.lines.length),
    interactive: interactive(cx, { kind: 'regex', regex: js, mode }, [{ label: cx.s('試す文字列（1行ずつ判定し、一致した部分を色付け）', 'Test strings (one per line; matches are highlighted)'), lines: [...yes, ...no] }]),
  });
}

/** How globs match on this line: file names, or `case` and `[[ == ]]` patterns (`find -name` takes neither). */
export function globOpts(cx: Explainer, use: 'file' | 'pattern' | 'none', n: SyntaxNode): GlobOpts {
  const shopt = shoptAt(cx, n);
  const on = (name: ShoptName) => shopt[name] === 'on';
  if (use !== 'pattern' && use !== 'none') {
    // (`**` reaches any depth with globstar on; where it may be on, the example says so.)
    const o: GlobOpts = { globstar: on('globstar') || shopt.globstar === 'unknown', dotglob: on('dotglob'), nocase: on('nocaseglob') };
    return Object.fromEntries(Object.entries(o).filter(([, v]) => v));
  }
  return use === 'pattern' && on('nocasematch') ? { nocase: true } : {};
}

export function pushExample(cx: Explainer, ex: Example | undefined): void {
  if (ex) cx.example(ex);
}

/** An example's editable form for the panel (src/examples/commands.ts). */
export function interactive(cx: Explainer, spec: RerunSpec, inputs: InputBox[]): Interactive {
  return commandExamples.interactive(spec, inputs, cx.lang);
}

/**
 * Values that match any of the glob patterns (`case` branches, the right side of `[[ == ]]`) and values that do not:
 * found with the matcher of `case`. `known`: where the value of the word matched is known (`subjectValue`), it and
 * whether it is one of the first section.
 */
export function patternExample(cx: Explainer, pats: SyntaxNode[], labels: [string, string], known?: { value: string; matches: boolean }): void {
  const texts = pats.map((p) => unquotedWord(p) ?? (p.type === 'extglob_pattern' ? nameText(p) : undefined));
  pushExample(cx, patterns.patternExample(texts, globOpts(cx, 'pattern', pats[0]), labels, cx.lang, known));
}

/** `[[ x == pat ]]`: the values that match the pattern `pat` and some that do not, with the value of `x` where the model knows it. */
export function matchExample(cx: Explainer, n: SyntaxNode, pat: SyntaxNode): void {
  const left = field(n, 'left');
  const value = left && shoptAt(cx, n).nocasematch !== 'unknown' ? subjectValue(cx, left) : undefined;
  // (Without the line continuations, which bash removes first: `@\<newline>(x|y)` is `@(x|y)`.)
  const text = unquotedWord(pat) ?? nameText(pat);
  const known = value === undefined ? undefined : { value, matches: globMatches(text, value, 'value', globOpts(cx, 'pattern', pat)) };
  patternExample(cx, [pat], [cx.s('一致する値', 'Values that match'), cx.s('一致しない値', 'Values that do not match')], known);
}

/**
 * The value of the word `n` that a test or a pattern matches, where the model knows it (src/explain/values.ts,
 * `wordValue`), when the matchers of the examples read it as bash does: printable ASCII (the classes such as
 * `[[:alpha:]]` take more in other locales), and not empty (a line of an example is a value).
 */
export function subjectValue(cx: Explainer, n: SyntaxNode): string | undefined {
  const v = wordValue(cx, n);
  return v !== undefined && /^[\x20-\x7e]+$/.test(v) ? v : undefined;
}

/** Values that make a simple `[ ]` / `[[ ]]` / `(( ))` test true and false, with the value of its variable where the model knows it. */
export function testExample(cx: Explainer, n: SyntaxNode, bracket: TestShape | undefined, asKind?: '['): void {
  // (`nocasematch` changes `[[ == ]]`, which the cases do not follow.)
  const nocase = n.children[0].type === '[[' ? shoptAt(cx, n).nocasematch : 'off';
  const known = (x: SyntaxNode) => (nocase === 'off' || nocase === 'default' ? wordValue(cx, x) : undefined);
  pushExample(cx, patterns.testExample(n, bracket, asKind, cx.lang, known));
}

/**
 * A stage of a pipeline example; `runs`: its operands are a command it runs (xargs), so its step shows the commands;
 * `prints`: the layout of what it prints, when made-up lines of it can stand for its output (`ps aux`).
 */
type PipelineStage = { stage: Stage; file: boolean; readsFile: boolean; source: InputSource; runs: boolean; layout?: MadeUp; values: MadeUpValue[] };

/** A variable whose value an example made up (`madeUpValue`): its code in the script, and the value. */
type MadeUpValue = { code: string; value: string };

/** A layout the examples make up for what the first stage of a pipeline prints; env's, with the environment it prints. */
type MadeUp = { kind: Layout; environment?: ReadonlyMap<string, string> };

/** The stages of pipelines read so far on the line (`pipelineStage`). */
const PIPELINE_STAGES = memoKey<PipelineStage | undefined>('pipeline stages');

/**
 * How an example names a stage of a pipeline: the text of the command without the redirections after its words
 * (`sort > out` is `sort`), but with a here-string, which is what it reads (`grep x <<< y`).
 */
function stageText(n: SyntaxNode): string {
  const kids = n.namedChildren;
  let end = kids.length;
  while (end && (kids[end - 1].type === 'file_redirect' || kids[end - 1].type === 'heredoc_redirect')) end--;
  // (A stage of redirections alone, `< a.json | jq .`, is named as written.)
  return shorten(end ? n.text.slice(0, kids[end - 1].endIndex - n.startIndex) : n.text, 40);
}

/** Whether the settings keep this example (examples.enabled / examples.disabled). */
export function wantsExample(cx: Explainer, e: Example): boolean {
  const o = cx.opts.examples;
  if (!o) return true;
  return o.enabled && !(e.kind && o.disabled.includes(e.kind));
}

/** When the line runs several commands, names the one each example is for in its title. */
export function titledExamples(cx: Explainer, root: SyntaxNode, line: number, examples: readonly Example[]): readonly Example[] {
  const commands = onLine(root, ['command', 'extended_test', 'arithmetic_command'], line)
    .filter((c) => intersects(c, line) && !assignmentsOnly(c));
  if (commands.length < 2) return examples;
  return examples.map((e) => {
    if (!e.target) return e;
    const target = `\`${e.target}\``;
    const title = cx.lang === 'ja'
      ? e.title.replace(/^例/, () => `${target} の例`)
      : e.title.replace(/^Example/, () => `Example for ${target}`);
    return { ...e, title };
  });
}

/** The scripts given to sed with -e/--expression, in order; undefined when there are none, or one is not plain text. */
export function sedScripts(cx: Explainer): string[] | undefined {
  const scripts = optionValues(cx, '-e').map((v) => v.text);
  return scripts.length && scripts.every((t) => t !== undefined) ? scripts as string[] : undefined;
}

/**
 * What the current `date` command is given besides its format (`DateRun`): the zone, the date `-d` gives, the file `-f`
 * reads or `-r` names. Undefined when it prints no format (`-s` sets the clock; `-I`, `-R` and `--rfc-3339` are
 * other formats: date refuses a second one), when it refuses two of `-d`, `-f` and `-r` or a second operand, or when
 * the zone `TZ` names is not known here.
 */
export function dateRun(cx: Explainer): commandExamples.DateRun | undefined {
  if (given(cx, '-s', '-I', '-R', '--rfc-3339')) return undefined;
  const { parse, nodes } = cx.command!;
  // (`date +%F +%T`: date refuses the extra operand, `OperandSpec.extra`.)
  if (operands(parse).some(({ role }) => role.spec?.extra)) return undefined;
  const [dates, files, refs] = [values(parse, '-d'), values(parse, '-f'), values(parse, '-r')];
  if ([dates, files, refs].filter((v) => v.length).length > 1) return undefined;
  const utc = given(cx, '-u');
  const tz = utc ? undefined : tzOf(cx);
  if (tz === null) return undefined;
  const run: commandExamples.DateRun = { ...(tz !== undefined ? { tz } : {}), ...(utc ? { utc } : {}) };
  const d = dates.pop();
  if (d) {
    const value = literalContent(nodes[d.word])?.text.slice(d.at ?? 0);
    return { ...run, date: { option: d.role.of, text: nodes[d.word].text.slice(d.at ?? 0), ...(value !== undefined ? { value } : {}) } };
  }
  if (files.length) return { ...run, file: inputSource(cx) };
  const r = refs.pop();
  if (r) return { ...run, reference: (literalContent(nodes[r.word])?.text ?? nodes[r.word].text).slice(r.at ?? 0) };
  return run;
}

/**
 * The value of `TZ` where the current command runs: the command's own assignment (`TZ=Asia/Tokyo date`), or the
 * variable exported where it runs, then what the wrappers on the line that run it do (`env TZ=Asia/Tokyo date`,
 * `env -u TZ`, `env -i`, `sudo`: the slots of src/semantics/env.ts). Undefined when there is none, null when one is
 * set to a value not known here, a wrapper may keep it or not, or runs the command elsewhere.
 */
function tzOf(cx: Explainer): string | undefined | null {
  const { args, nodes } = cx.command!;
  const cmd = args[0].parent!;
  let tz: string | undefined | null;
  const own = prefixAssignments(cmd).filter((c) => field(c, 'name')?.text === 'TZ').pop();
  if (own) {
    const v = field(own, 'value');
    tz = v ? literalContent(v)?.text ?? null : '';
  } else {
    const v = cx.state.at(cmd).run.variables.get('TZ');
    const exported = v?.attrs.x?.state ?? 'off';
    tz = !v || v.set === 'off' || exported === 'off' ? undefined : v.set === 'on' && exported === 'on' && v.value !== undefined ? v.value : null;
  }
  // (The words of a command a wrapper runs follow its name: `env TZ=x date -d @0`. Each wrapper's assignments lie
  // between its first word and the command it runs.)
  const name = nodes[nodes.indexOf(args[0]) - 1];
  let from = 0;
  for (const link of (name && cx.slotEnvs.get(name)?.links) || []) {
    const at = link.kind === 'slot' ? nodes.indexOf(link.at) : -1;
    if (link.kind !== 'slot' || at < 0) continue;
    const { kept, here } = slotEnvironment(link);
    // (sudo resets the environment, but may keep TZ; ssh and docker run the command elsewhere. A file of variables,
    // `docker run --env-file f`, may set it.)
    if (tz !== undefined && !kept) tz = null;
    if (link.assigns.includes('*') || (!here && (tz !== undefined || link.assigns.includes('TZ')))) return null;
    if (link.unsets?.includes('TZ')) tz = undefined;
    // (`env "TZ=x"` sets it too; `env "TZ=$z"` sets it to a value not known here.)
    for (const n of nodes.slice(from, at)) {
      const text = literalContent(n)?.text;
      if (text === undefined ? n.text.includes('TZ=') : text.startsWith('TZ=')) tz = text?.slice(3) ?? null;
    }
    from = at;
  }
  return tz;
}

/** -F, -v and `name=value` operands of the current awk command (literal values only); undefined when the example cannot follow them. */
export function awkOptions(cx: Explainer): (AwkRunOptions & { vars: Record<string, string> }) | undefined {
  const words = cx.command!.args.map((a) => literalContent(a)?.text);
  const inv = awkInvocation(words);
  // Options awk has more of (`--posix`, `-W …`) do not change what the example shows.
  if (inv.unsupported && !inv.unsupported.startsWith('awk -')) return undefined;
  return { fs: inv.fs, vars: inv.vars, assigns: inv.assigns };
}

/** Sample data run through every stage of a pipeline, showing what each stage leaves. */
export function pipelineExample(cx: Explainer, n: SyntaxNode): Example | undefined {
  // A pipeline is explained on the line it is on, or whole (see sub).
  const p = pipelineStages(cx, n);
  if (!p) return undefined;
  const { stages, files, readsFile, runs } = p;
  // (A well-known system file holds lines of its own format: `cat /etc/passwd | cut -d: -f1`.)
  const src = withSystemFiles(p.src);
  // A later stage that reads a file does not read what the stages before it write (`printf … | grep -e -v foo`).
  if (files.slice(1).some(Boolean)) return undefined;
  // A first stage that prints a layout the examples make up (`ps aux`): its made-up lines go through the others.
  if (p.layout) return sampledPipeline(cx, n, p.layout, stages, runs, p.values);
  // Several files read as one stream; a first stage that works on each apart (`EachFile`: head, grep) is not
  // followed, nor one that reads a file twice.
  const streams = src.streams;
  if (streams.length > 1 && src.each) return undefined;
  if (src.reads) return undefined;
  const known = streams.length === 1 ? knownLines(streams[0]) : undefined;
  const ex = pipelines.pipelineExample(stages, readsFile || !!known, known);
  if (!ex) return undefined;
  const inputs: InputBox[] = ex.input ? shareOut(src, ex.input).map((lines, i) => ({ label: streamLabel(streams[i], cx.lang), lines })) : [];
  return withValues(cx, wholePipeline(cx, n, ex, inputs, stages, runs), p.values);
}

/**
 * The example with a note on the values it made up for variables (`madeUpValue`): "Here `$USER` is `alice`, an example
 * value: the real one is known only when the line runs". Each variable once.
 */
function withValues(cx: Explainer, ex: Example, values: readonly MadeUpValue[]): Example {
  const said = [...new Map(values.map((v) => [v.code, v])).values()];
  if (!said.length) return ex;
  const list = said.map((v) => cx.s(`${codeSpan(v.code)} を ${codeSpan(v.value)}`, `${codeSpan(v.code)} is ${codeSpan(v.value)}`)).join(cx.s('、', ', '));
  const note = cx.s(`ここでは ${list} とした（例の値。実際の値は実行するまで分からない）`, `Here ${list}: ${said.length > 1 ? 'example values' : 'an example value'} (the real ${said.length > 1 ? 'ones are' : 'one is'} known only when the line runs)`);
  // (No example of a whole pipeline has a note of its own.)
  return { ...ex, note };
}

/** The lines of a section of the whole-pipeline example: at most `MAX_SHOWN_LINES`, control characters made visible. */
const cap = (lines: string[]) => (lines.length > MAX_SHOWN_LINES ? [...lines.slice(0, MAX_SHOWN_LINES - 1), '…'] : lines).map(visible);

/**
 * The whole-pipeline example of a first stage that prints a layout the examples make up (`ps aux`, `ls -l`): its
 * made-up lines, and what each stage after it makes of them. They are shown as they are, not in a box to edit: the
 * columns of a table stay lined up (a box wraps its long lines).
 */
function sampledPipeline(cx: Explainer, n: SyntaxNode, layout: MadeUp, stages: Stage[], runs: ReadonlySet<Stage>, values: readonly MadeUpValue[]): Example | undefined {
  const sample = madeUp(cx, n, layout);
  const rest = stages.slice(1);
  const ex = pipelines.pipelineExample(rest, true, sample);
  if (!ex) return undefined;
  const label = cx.s(`\`${stages[0].text}\` の出力（例）`, `Output of \`${stages[0].text}\` (sample)`);
  return withValues(cx, wholePipeline(cx, n, ex, [{ label, lines: sample }], rest, runs, false), values);
}

/** The example of the whole pipeline `n`: the input boxes, then what each stage leaves. */
function wholePipeline(cx: Explainer, n: SyntaxNode, ex: pipelines.PipelineExample, inputs: InputBox[], stages: Stage[], runs: ReadonlySet<Stage>, editable = true): Example {
  // What the next stage shown reads of a section is marked (src/examples/marks.ts), the lines of each input box apart.
  const reader = (from: number) => ex.steps.slice(from).find((st, j) => !st.stage.copies || from + j === ex.steps.length - 1)!.stage.text;
  const marked = (m: StageMarks | undefined, lines: string[], from: number, first = 0) => {
    const part = m && { ...m, ranges: m.ranges.slice(first, first + lines.length), dropped: m.dropped.filter((k) => k >= first && k < first + lines.length).map((k) => k - first) };
    if (!part || (!part.ranges.some((r) => r.length) && !part.dropped.length)) return {};
    return { marks: sectionMarks(part, reader(from), cx.lang, lines.length > MAX_SHOWN_LINES ? MAX_SHOWN_LINES - 1 : Infinity) };
  };
  let first = 0;
  const sections: ExampleSection[] = inputs.map((b) => {
    const at = first;
    first += b.lines.length;
    return { label: b.label, lines: cap(b.lines), empty: cx.s('（空）', '(empty)'), ...marked(ex.inputMarks, b.lines, 0, at) };
  });
  ex.steps.forEach((step, i) => {
    // `cat file` passes the input on unchanged.
    if (step.stage.copies && i < ex.steps.length - 1) return;
    const last = i === ex.steps.length - 1;
    const label = runs.has(step.stage)
      ? cx.s(`\`${step.stage.text}\` が実行するコマンド`, `Commands run by \`${step.stage.text}\``)
      : last ? cx.s(`出力（\`${step.stage.text}\` の後）`, `Output (after \`${step.stage.text}\`)`)
        : cx.s(`\`${step.stage.text}\` の後`, `After \`${step.stage.text}\``);
    sections.push({ label, lines: cap(step.output), empty: cx.s('（なし）', '(nothing)'), ...marked(step.marks, step.output, i + 1) });
  });
  // A pipeline in a command or process substitution (`echo $(a | b)`, `[[ $(a | b) == x ]]`, `for i in $(a | b)`) is
  // named in the title, not the command or statement around it.
  let up = n.parent;
  while (up && up.type !== 'command_substitution' && up.type !== 'process_substitution') up = up.parent;
  return {
    title: cx.s('例（パイプライン全体）', 'Example (the whole pipeline)'), sections,
    ...(up ? { target: shorten(n.text.replace(/\s*\\\n\s*/g, ' '), 40) } : {}),
    // Data from a file can be edited; data made by echo or seq cannot.
    ...(inputs.length && editable ? { interactive: interactive(cx, { kind: 'pipeline', stages }, inputs) } : {}),
  };
}

/**
 * The stages of pipeline `n` (the first `count`), as the pipeline examples run them: whether each names a file to
 * read, whether the first reads one (`< f`), and what the first reads. Undefined for a stage they cannot follow.
 */
function pipelineStages(cx: Explainer, n: SyntaxNode, count = n.namedChildren.length): { stages: Stage[]; files: boolean[]; readsFile: boolean; src: InputSource; runs: ReadonlySet<Stage>; layout?: MadeUp; values: MadeUpValue[] } | undefined {
  const read: PipelineStage[] = [];
  for (const [i, cmd] of n.namedChildren.slice(0, count).entries()) {
    const st = pipelineStage(cx, n, cmd, i);
    if (!st) return undefined;
    read.push(st);
  }
  return { stages: read.map((st) => st.stage), files: read.map((st) => st.file), readsFile: !!read[0]?.readsFile, src: read[0]?.source, runs: new Set(read.filter((st) => st.runs).map((st) => st.stage)), ...(read[0]?.layout ? { layout: read[0].layout } : {}), values: read.flatMap((st) => st.values) };
}

/**
 * Stage `i` of pipeline `n`, read once per line (`PIPELINE_STAGES`): the stdin of each stage is what the stages before it
 * print, so reading every prefix again would take exponential time in the number of stages.
 */
function pipelineStage(cx: Explainer, n: SyntaxNode, cmd: SyntaxNode, i: number): PipelineStage | undefined {
  const stages = cx.memo(PIPELINE_STAGES);
  if (stages.has(cmd)) return stages.get(cmd);
  const read = ((): PipelineStage | undefined => {
    if (cmd.type !== 'command') return undefined;
    let readsFile = false;
    // `grep x < file` reads a file; output redirections other than 2>/dev/null change where data goes, wherever they
    // are written (`>f grep x`, `grep >f x`). (Those of the last stage change where the result goes; the example
    // still shows what the stages make.)
    for (const r of i === n.namedChildren.length - 1 ? [] : redirectionsOf(cmd)) {
      const op = r.children.find((x) => !x.named)?.type;
      if (r.type === 'file_redirect' && op === '<' && i === 0) readsFile = true;
      // (The text of a here-string or a here-document is the first stage's input: `inputSource` reads it.)
      else if ((r.type === 'herestring_redirect' || r.type === 'heredoc_redirect') && i === 0 && (field(r, 'descriptor')?.text ?? '0') === '0') continue;
      else if (!(r.type === 'file_redirect' && field(r, 'descriptor')?.text === '2')) return undefined;
    }
    // (By its name after quote removal: `\env` and `"env"` run env.)
    const named = stageName(cx, cmd);
    if (!named) return undefined;
    const { node: name, res } = named;
    // A stage that runs a function or an alias of the script is not the program its name suggests (as in commandTail).
    if (['function', 'alias'].includes(res.kind)) return undefined;
    const args = cmd.namedChildren.filter((x) => !same(x, name) && !prefixAssignments(cmd).includes(x) && x.field !== 'redirect');
    // (The program of the path it runs: `hash -p /usr/bin/tac sort` makes `sort` run tac.)
    const program = named.path ?? named.value;
    const spec = specFor(cx, program);
    const parse = interpret(spec ?? NO_SPEC, args.map(argWordFor(cx.state.shell, bracesIn(cx.state))), { name: program, lookup: (x) => specFor(cx, x) });
    // (A word whose value the script leaves to the environment runs with a value made up for it: `$USER` is `alice`.
    // grep reads such a pattern as a regular expression, which matches inside a longer word: a sample line shows it.)
    const values: MadeUpValue[] = [];
    const regex = regexWords(parse, spec ? impliedOptions(program, spec) : []);
    let inside = false;
    const words = args.flatMap((a, k) => {
      const own = exampleWords(cx, [a], !!spec?.prints);
      const made = own.some((w) => w.value === undefined) && !bracesApply(cx, a) ? madeUpWords(cx, cmd, a) : undefined;
      if (!made) return own.map((w) => w.value);
      values.push(...made.values);
      if (made.values.length && regex.includes(k)) inside = true;
      return made.words;
    });
    const stage: Stage = { cmd: program.split('/').pop()!, words, text: stageText(cmd), ...(spec?.copies ? { copies: true } : {}), ...(spec?.prints === 'words' && echoMayReadEscapes(cx, cmd) ? { escapes: true } : {}), ...(inside ? { inside } : {}) };
    const source = inputSource(cx, cmd, parse, args, spec);
    // A stage that writes its output to a file (`sort -o f`) hands nothing on.
    const runs = !!spec?.operands?.some((alt) => alt.pattern.some((o) => o.command));
    // (The layout of a program: what it prints.)
    const alt = i === 0 && res.kind === 'file' ? layoutOf(spec, parse) : undefined;
    const layout = alt && madeUpLayout(cx, cmd, alt);
    return source.writes ? undefined : { stage, file: readsFiles(parse, stage.words), readsFile, source, runs, ...(layout ? { layout } : {}), values };
  })();
  stages.set(cmd, read);
  return read;
}

/** The example of a run of the command, when its spec has one (`CommandSpec.example`: printf, xargs, sort…). */
export function commandExampleFor(cx: Explainer, n: SyntaxNode, spec: CommandSpec | undefined, args: SyntaxNode[], parse: ArgvParse): void {
  // (`x='-n 3'; head $x f`: the example would read `$x` as written.)
  if (!spec?.example || readsFields(parse)) return;
  if (spec.example === 'read') {
    readExample(cx, n, args, parse);
    return;
  }
  // (`/usr/bin/printf --version`: the word read as an option it takes only alone prints the version, not the format.)
  if (parse.roles.some((r) => r.role.role === 'option' && spec.soleOptions?.includes(r.role.spec))) return;
  const kind = spec.example;
  const src = inputSource(cx, n, parse, args, spec);
  // A command that prints what it reads as it is (cat) shows what it does when it joins several streams (`cat a - b`).
  if (spec.copies && src.streams.length < 2 && !src.reads) return;
  // (printf with a brace expansion: its output is in the example of the expansion, with the words.)
  if (kind === 'printf' && args.some((a) => braceWordsOf(cx, a)?.length)) return;
  // (printf: the builtin of the bash release explained for, or the coreutils program.)
  const reader = spec.builtin ? cx.opts.bashVersion ?? DEFAULT_BASH_VERSION : 'coreutils';
  pushExample(cx, commandExamples.commandExampleOf(kind, exampleWords(cx, args, !!spec.prints), cx.lang, src, reader));
}

/**
 * What a command reads (src/examples/source.ts): the files its words name as its input, or its standard input, from
 * the syntax around it. By default, the command whose words are being read (`cx.command`).
 */
export function inputSource(cx: Explainer, cmd?: SyntaxNode, parse?: ArgvParse, nodes?: SyntaxNode[], spec?: CommandSpec): InputSource {
  const ctx = cx.command!;
  const words = (nodes ?? ctx.nodes).map((a): SourceWord => {
    const value = literalContent(a)?.text ?? staticWordValue(a, false, cx.shell);
    const glob = wordAt(cx, a)?.steps.find((st) => st.kind === 'glob');
    return pipeOf(a) ? { text: a.text, pipe: pipeOf(a), lines: substitutionLines(a, (p, i) => pipedLines(cx, p, i)) } : { value, text: a.text, ...(value === undefined ? { many: 'unknown' as const } : glob && glob.applies !== false ? { many: 'glob' as const } : {}) };
  });
  return sources.inputSource(parse ?? ctx.parse, words, stdinOf(cx, cmd ?? ctx.args[0].parent!), parse ? spec : ctx.spec);
}

function stdinOf(cx: Explainer, cmd: SyntaxNode): Stdin {
  // (A here-string's word is not split or globbed: `$'b\na'` is two lines.)
  return sources.stdinOf(cmd, (w) => literalContent(w)?.text ?? staticWordValue(w, false, cx.shell), (p, i) => pipedLines(cx, p, i));
}

/**
 * What the stages of pipeline `n` before the one at `index` give it to read (`Piped`): the stage before, by its text;
 * what they print, when it is known (the first reads the text the line gives it, a here-string or a here-document, or
 * prints it: echo, printf; and none reads a file), or made-up lines of the layout the first prints (`ps aux`); or the
 * one file the stage before copies (`cat a.json`).
 */
function pipedLines(cx: Explainer, n: SyntaxNode, index: number): Piped {
  const before = n.namedChildren[index - 1];
  const by = before.type === 'command' ? stageText(before) : shorten(before.text, 40);
  // (Named whole: what it writes to is the point.)
  if (writesElsewhere(before)) return { by: shorten(before.text, 40), elsewhere: true };
  const p = pipelineStages(cx, n, index);
  if (!p) return { by };
  if (p.layout && !p.files.slice(1).some(Boolean)) {
    const lines = pipedOutput(p.stages.slice(1), madeUp(cx, n, p.layout));
    return lines ? { by, lines, sample: true } : { by };
  }
  if (p.readsFile || p.files.some(Boolean)) {
    // (`cat a.json | jq .`: what jq reads is the file.)
    const [only, ...more] = p.src.streams;
    const file = only.kind === 'file' ? !only.many && !only.pipe && only.name : only.stdin.from === 'file' && !only.stdin.pipe && only.stdin.name;
    return index === 1 && p.stages[0].copies && !more.length && file ? { by: p.stages[0].cmd, file } : { by };
  }
  const lines = pipedOutput(p.stages, knownLines(p.src.streams[0]));
  return lines ? { by, lines } : { by };
}

/**
 * The name of the simple command `cmd` after quote removal (`\env`, `"env"` and `e\nv` are `env`), and what it runs,
 * looked up as bash does (a quoted name is no alias, but may be a function or a builtin); undefined when it is not
 * known (`$cmd`), or empty, or the stage has no name word (an incomplete `echo a |`). `path`: the path bash runs a
 * program by, when it does not search PATH for it (`/bin/env`, or a path `hash -p` gave the name). Undefined too when
 * the program is not known for that reason: a relative hashed path runs from the current directory (`hash -p tac
 * sort` runs `./tac`, `relative`), one not known is known only at run time, and a `hash -p` on some paths only, or
 * where hashing may be off (`set +h`), may make the name run that path or not (`maybeHashed`), and with checkhash or
 * in POSIX mode bash forgets a path it cannot run (`checked`).
 */
function stageName(cx: Explainer, cmd: SyntaxNode): { node: SyntaxNode; value: string; res: NameResolution; path?: string } | undefined {
  const node = cmd.type === 'command' ? field(cmd, 'name') : undefined;
  const word = node?.namedChildren[0];
  const value = word && staticWordValue(word, false, cx.state.shell);
  if (!value) return undefined;
  const res = resolve(cx, value, node!, { quoted: quotedName(word, value) });
  if (res.kind === 'file' && (res.maybeHashed || (res.path === 'hashed' && (res.relative || res.checked || res.hashed!.value === undefined)))) return undefined;
  const path = res.kind !== 'file' ? undefined : res.path === 'given' ? value : res.hashed?.value;
  return { node: node!, value, res, ...(path ? { path } : {}) };
}

/**
 * Characters ps may not show as they are: controls (C0, DEL and C1: procps prints each of their bytes as `?`,
 * `x$'\u0085'y` as `x??y`), unassigned code points and the line and paragraph separators (one `?`), and format and
 * private-use characters, which it shows or not by the C library's tables. A row with one is not made up.
 */
const NOT_SHOWN = /[\p{C}\p{Zl}\p{Zp}]/u;

/**
 * The words a stage of a pipeline runs as a program, as ps shows its command line (`awk {print $2}`), after quote
 * removal as the interpreter reads them (`env \--` runs `env --`, `\head` runs `head`); undefined when they are not all
 * known, or the stage is not a program (a builtin, a function, a compound command). A word with a character ps
 * does not show as it is (`NOT_SHOWN`) is not known either: ps shows it escaped (`$'a\tb'` as `a?b`), and a newline
 * would break the row. With the path bash runs it by, when it does not search PATH for it (`stageName`).
 */
function argvOf(cx: Explainer, cmd: SyntaxNode): Run | undefined {
  const named = stageName(cx, cmd);
  if (named?.res.kind !== 'file') return undefined;
  const { node: name, value, path } = named;
  const words = cmd.namedChildren.filter((x) => !same(x, name) && !prefixAssignments(cmd).includes(x) && x.field !== 'redirect').map((a) => staticWordValue(a, false, cx.state.shell));
  const argv = [value, ...words];
  if (!argv.every((w): w is string => w !== undefined && !NOT_SHOWN.test(w))) return undefined;
  return { argv, ...(path ? { path } : {}) };
}

/** Made-up lines of what the first stage of pipeline `n` prints in `layout`, with the stages run as ps sees them. */
function madeUp(cx: Explainer, n: SyntaxNode, layout: MadeUp): string[] {
  const procs = n.namedChildren.map((c) => argvOf(cx, c));
  // (env's words are all known: options.)
  if (layout.environment) procs[0] = { ...procs[0]!, environment: layout.environment };
  return layoutSample(layout.kind, procs, 0);
}

/**
 * The layout `alt` of what the first stage `cmd` of a pipeline prints, when the environment it runs in leaves it as
 * made up (`LayoutAlt.environment`): no variable that changes it has another value, from an assignment before the
 * command or an export of the script (`TIME_STYLE=long-iso ls -l`, `export PS_FORMAT=pid,comm`), nor one the model
 * cannot tell. env prints its environment: the made-up one, with what the script exported (`export FOO=bar`).
 */
function madeUpLayout(cx: Explainer, cmd: SyntaxNode, alt: LayoutAlt): MadeUp | undefined {
  const own = prefixAssignments(cmd);
  if (alt.environment === 'prints') {
    // (An assignment before env is in what it prints, and `PATH=` changes the path bash runs it by.)
    const environment = own.length ? undefined : exportedEnvironment(cx, cmd);
    return environment && { kind: alt.layout, environment };
  }
  for (const [name, keeps] of Object.entries(alt.environment)) {
    const mine = own.filter((a) => field(a, 'name')?.text === name).pop();
    const value = mine ? assignedText(mine, name) : exportedAt(cx, cmd, name);
    if (value === null) return undefined;
    // (One the made-up environment has and the script unset reads as empty: glibc reads an empty `LANG` as none.)
    const v = value ?? (ENVIRONMENT.has(name) ? '' : undefined);
    if (v !== undefined && v !== ENVIRONMENT.get(name) && !keeps.includes(v)) return undefined;
  }
  return { kind: alt.layout };
}

/**
 * The value the made-up system gives the variable `name` where `cmd` runs, when the script leaves it to the environment
 * (`$USER` is `alice`: `startValue`): no command of the script sets it (`StateModel.assigned`), nothing the walk did not
 * read ran before (`ShellState.opaque`: `source`, `eval`), and the shell that runs `cmd` is the script's, started on
 * the made-up system (`startedAs`, `inheritedAt`). None for a variable bash or a builtin may change unseen
 * (`changedUnseen`: `RANDOM`, `PWD` after `cd`).
 * The value stays in the example: the word model never reads it (`wordFields` has no environment).
 */
function madeUpValue(cx: Explainer, cmd: SyntaxNode, name: string): string | undefined {
  const started = startedAs(cx);
  const st = cx.state.at(cmd).run;
  if (!started || st.opaque || st.variables.has(name) || cx.state.assigned.has(name) || changedUnseen(name)) return undefined;
  return inheritedAt(cx, cmd, started)(name) ?? undefined;
}

/**
 * The words a pipeline example runs with for the word `a` of `cmd`: the fields the program receives (`receivedFields`),
 * with the value the made-up system gives each variable the script leaves to the environment (`madeUpValue`), and those
 * values. Undefined where a field is not known so: another part known only when the line runs, a value that splitting
 * by IFS or pathname expansion may change, a pattern.
 */
function madeUpWords(cx: Explainer, cmd: SyntaxNode, a: SyntaxNode): { words: string[]; values: MadeUpValue[] } | undefined {
  const got = receivedFields(a, cx.state);
  if (got.fields) return { words: got.fields, values: [] };
  if (!got.holed) return undefined;
  const ifs = ifsAt(cx, a);
  const values: MadeUpValue[] = [];
  const words: string[] = [];
  for (const f of got.holed) {
    if (f.pattern !== undefined) return undefined;
    let text = '';
    for (const part of f.parts) {
      if ('text' in part) { text += part.text; continue; }
      const h = part.hole;
      const value = h.kind === 'parameter' && !h.elements && writtenPlain(h) ? madeUpValue(cx, cmd, h.name) : undefined;
      if (value === undefined) return undefined;
      if (part.splits && (value === '' || ifs === undefined || [...value].some((c) => ifs.includes(c)))) return undefined;
      // (No value of the made-up environment has a glob character; a guard should one get one.)
      /* c8 ignore next */
      if (part.globs && globbedByBash(value, 'unknown') !== false) return undefined;
      text += value;
      values.push({ code: h.code, value });
    }
    words.push(text);
  }
  return { words, values };
}

/** The value an assignment before a command gives `name`; null when it is not known (`X=$y`, `X+=y`, an array). */
function assignedText(a: SyntaxNode, name: string): string | null {
  const v = field(a, 'value');
  if (a.text.startsWith(`${name}+=`)) return null;
  return v ? literalContent(v)?.text ?? null : '';
}

/**
 * How the shell that runs the file started on the made-up system (`Started`), when bash runs it so: a file of its own
 * is a script run from a terminal, a console in Markdown is typed into one. Undefined for another shell (dash leaves
 * SHLVL as it is and passes no `_`) or a host that starts the shell otherwise (a Dockerfile's `/bin/sh -c`, a CI's
 * fresh bash, make's `/bin/sh`).
 */
function startedAs(cx: Explainer): Started | undefined {
  if ((cx.shell ?? 'bash') !== 'bash') return undefined;
  const host = cx.opts.host?.kind;
  return host === undefined ? 'script' : host === 'markdown' ? 'terminal' : undefined;
}

/**
 * What the shell that runs `cmd` has of the variable `name` at start (undefined: none; null: not known): the made-up
 * system's (`startValue`). A shell that a command slot starts (`bash -c`, `sudo`, `env -i`) gets what that slot
 * passes, not followed here.
 */
function inheritedAt(cx: Explainer, cmd: SyntaxNode, started: Started): (name: string) => string | undefined | null {
  const own = (name: string): string | undefined => startValue(name, started);
  const slot = cx.state.env(cmd).links.some((l) => l.kind === 'slot' && l.slot.run !== 'current-shell' && l.slot.run !== 'subshell');
  return slot ? (name) => (own(name) === undefined ? undefined : null) : own;
}

/**
 * The value of `name` in the environment of the command `cmd` on the made-up system (`exportedValue`), undefined when
 * it has none; null when the model cannot tell: `cmd`, in a function, may run where the script set it otherwise, or a
 * nameref may export it under another name. Where the model does not follow the whole script (`source`, `read n`
 * then `$(( n * 2 ))`), it still follows what the script itself does to the name. (What bash sets itself, `COLUMNS`,
 * it does not export.)
 */
function exportedAt(cx: Explainer, cmd: SyntaxNode, name: string): string | undefined | null {
  // (Where the model is blind, a function may also run from where it does not see: `"$@"`, `eval "$1"`.)
  const elsewhere = cx.state.blind !== undefined ? cx.state.env(cmd).links.some((l) => l.kind === 'call') || setInFunctions(cx).has(name) : !cx.state.settled(cmd);
  if (elsewhere && cx.state.assigned.has(name)) return null;
  const st = cx.state.at(cmd).run;
  if ([...st.variables.values()].some((v) => (v.attrs.n?.state ?? 'off') !== 'off')) return null;
  return exportedValue(st, name, inheritedAt(cx, cmd, startedAs(cx) ?? 'script'));
}

/** The variables some command in the body of a function of the script sets (`StateModel.writes`). */
const IN_FUNCTIONS = memoKey<ReadonlySet<string>>('variables set in functions');
function setInFunctions(cx: Explainer): ReadonlySet<string> {
  const memo = cx.memo(IN_FUNCTIONS);
  const known = memo.get(cx.root);
  if (known) return known;
  const names = new Set<string>();
  const stack = [...cx.state.definitions.functions.values()].flat();
  for (let n = stack.pop(); n; n = stack.pop()) {
    for (const name of cx.state.writes(n)) names.add(name);
    stack.push(...n.namedChildren);
  }
  memo.set(cx.root, names);
  return names;
}

/**
 * The environment the command `cmd` gets on the made-up system (`START_NAMES`), with what the script exported, unset
 * or stopped exporting before it, in the order bash passes it; undefined when the model cannot tell (a value bash
 * sets itself, `RANDOM`, `_`, among them), the shell is not bash as a script or a terminal runs it (`startedAs`), the
 * script exports a function (env prints it too, as `BASH_FUNC_f%%=() {…`) or a local of a function (bash passes
 * those first), the order is not known (`exportOrder`), or another PATH may find another env, or none.
 */
function exportedEnvironment(cx: Explainer, cmd: SyntaxNode): ReadonlyMap<string, string> | undefined {
  const started = startedAs(cx);
  if (!started || cx.state.blind !== undefined || !cx.state.settled(cmd)) return undefined;
  const st = cx.state.at(cmd).run;
  if ([...st.functions.values()].some((f) => f.exported !== 'off')) return undefined;
  const inherited = inheritedAt(cx, cmd, started);
  const path = st.variables.get('PATH');
  if (!madeUpPath(path ? (path.set === 'on' && !path.kept ? path.value : null) : inherited('PATH'))) return undefined;
  const values = new Map<string, string>();
  for (const name of new Set([...START_NAMES, ...st.variables.keys()])) {
    const value = exportedValue(st, name, inherited);
    if (value === null) return undefined;
    if (value === undefined) continue;
    const v = st.variables.get(name);
    if (changedByBash(name) || (v && cx.state.local(v.at, name))) return undefined;
    values.set(name, value);
  }
  const order = exportOrder(values.keys());
  return order && new Map(order.map((name) => [name, values.get(name)!]));
}

/** A note when the command reads files it names, so not the standard input the line gives it (`jq . a.json < b.json`). */
export function unreadStdin(cx: Explainer, n: SyntaxNode, parse: ArgvParse, args: SyntaxNode[], name: string): void {
  const src = inputSource(cx, n, parse, args);
  const file = src.streams.find((st): st is Extract<Stream, { kind: 'file' }> => st.kind !== 'stdin');
  if (!src.unread || !file) return;
  const u = src.unread;
  const stdin: Text = 'name' in u ? tx(`\`< ${u.name}\``, `\`< ${u.name}\``)
    : u.from === 'pipe' ? tx('パイプで渡される前のコマンドの出力', 'the output of the previous command, through the pipe')
      : (u as Extract<Stdin, { from: 'here' }>).doc ? tx('ヒアドキュメント', 'the here-document') : tx('ヒアストリング', 'the here-string');
  cx.note(fact(cx.lang, 'stdin-not-read', { cmd: name.split('/').pop()!, file: file.name, stdin }), n);
}

/**
 * The text of the word `w` as bash makes it, when nothing in it varies: quote removal and `$'…'` decoded (`'\t'` is a
 * backslash and a `t`, `$'\t'` a tab), `$"…"` as `"…"` (the locale's translation aside). Undefined with a substitution,
 * even `$(:)`: it prints nothing only when `:` is the builtin, which a function of that name changes.
 */
function knownText(cx: Explainer, w: SyntaxNode, assignment: boolean): string | undefined {
  const node = w.type === 'translated_string' && w.namedChildren.length === 1 ? w.namedChildren[0] : w;
  const v = staticWordValue(node, assignment, cx.shell);
  return v !== undefined && substitutionNames(node).length === 0 ? v : undefined;
}

/** The nodes that are no statement of a list: a statement before `read` in its group or loop may read the input first. */
const NOT_STATEMENT = new Set(['command_name', 'variable_assignment', 'word', 'number', 'variable_name', 'string', 'raw_string', 'ansi_c_string', 'translated_string', 'concatenation',
  'comment', 'file_descriptor', 'simple_expansion', 'expansion', 'command_substitution', 'arithmetic_expansion', 'process_substitution', 'brace_expression',
  'file_redirect', 'herestring_redirect', 'heredoc_redirect', 'heredoc_body', 'heredoc_start', 'heredoc_end']);

/** What `read` reads: the text of its input (`first`: the first pass of a loop reads it so, the next ones read on), or none that is known. */
type ReadInput = { text: string; first: boolean } | 'sample' | 'unknown';

/**
 * The input of the `read` at `n`, for the descriptor `fd` (0, or the one of `-u`), from what the script gives it: a
 * here-string or a here-document (also on the group, the loop or the stage around it: `while read …; done <<< x`), or
 * a pipe or a file whose lines are known. `sample`: the script gives it none it writes (a file, a pipe not known, the
 * terminal), so the example reads a made-up line; `unknown`: the script gives it a text that is not known, or other
 * commands before it in the group or loop may read it first (`{ read a; read b; } <<< x`), which no made-up line may
 * stand for (and a string read as a script, `eval read …`, takes the input of the command around it).
 */
function readInput(cx: Explainer, n: SyntaxNode, fd: number): ReadInput {
  if (cx.nested !== undefined) return 'unknown';
  // (The word of a here-string is not split, globbed or brace expanded; a tilde in it is the home directory, not known.)
  const literal = (w: SyntaxNode): string | undefined => knownText(cx, w, true) ?? wordValue(cx, w);
  const path: SyntaxNode[] = [];
  // (The innermost redirection of the descriptor wins; a function's body takes the input of its call.)
  for (let c: SyntaxNode | null = n; c && c.type !== 'function_definition'; c = c.parent) {
    path.push(c);
    const stdin = sources.stdinOf(c, literal, (p, i) => pipedLines(cx, p, i), fd);
    if (stdin.from === 'unknown') continue;
    const lines = stdin.lines;
    // (A file or a pipe whose contents the script does not give: the example's line stands for them, on the terminal's fd 0 only.)
    if (!lines) return stdin.from === 'here' || fd !== 0 ? 'unknown' : 'sample';
    // (Another statement before it in the group or loop, down from the node that has the input, may read first.)
    const before = path.slice(1).some((a, k) => a.namedChildren.slice(0, a.namedChildren.indexOf(path[k])).some((x) => !NOT_STATEMENT.has(x.type)));
    if (before) return 'unknown';
    return { text: lines.join('\n'), first: path.slice(1).some((a) => /^(while|until|for|select|c_style_for)_statement$/.test(a.type)) };
  }
  return fd === 0 ? 'sample' : 'unknown';
}

/** How `read` splits a sample line into its variables (with the IFS in effect, or the one given before it). */
function readExample(cx: Explainer, n: SyntaxNode, args: SyntaxNode[], parse: ArgvParse): void {
  let ifs = ifsAt(cx, n);
  // (`IFS+=:` adds to what IFS is where the command runs; bash empties an IFS that is unset first.)
  const unset = cx.state.at(n).run.variables.get('IFS')?.set === 'off';
  for (const [k, c] of n.namedChildren.filter((x) => x.type === 'variable_assignment' && field(x, 'name')?.text === 'IFS').entries()) {
    const v = field(c, 'value');
    // (Its value as bash makes it: `'\t'` and `"\t"` are a backslash and a `t`, `$'\t'` is a tab.)
    const text = v ? knownText(cx, v, true) : '';
    const base = k === 0 && unset ? '' : ifs;
    ifs = text === undefined ? undefined : c.children.some((x) => !x.named && x.type === '+=') ? base === undefined ? undefined : base + text : text;
    if (ifs === undefined) break;
  }
  const words = args.map((a) => literalContent(a)?.text);
  // (`read -u 3` reads the descriptor 3, the number as the script writes it.)
  const given = values(parse, '-u').map(({ word, at }) => words[word]?.slice(at ?? 0)).pop();
  if (given !== undefined && !/^\d+$/.test(given)) return;
  if (given === undefined && has(parse, '-u')) return;
  const input = readInput(cx, n, given === undefined ? 0 : Number(given));
  if (input === 'unknown') return;
  const r = commandExamples.readExample(words, ifs, input === 'sample' ? undefined : input.text, cx.lang, cx.opts.bashVersion ?? DEFAULT_BASH_VERSION, input !== 'sample' && input.first);
  if (!r) return;
  if (r.note) cx.note(r.note, n);
  cx.example(r.example);
}

/** The words bash makes of argument `a` by brace expansion where it runs; undefined when it makes none, or too many to list. */
export function braceWordsOf(cx: Explainer, a: SyntaxNode): string[] | undefined {
  // (The model says whether braces expand there: not after `set +B`.)
  if (!bracesApply(cx, a)) return undefined;
  // (Their values: `{a,b}"x"` is `ax` and `bx`; none when one is not known, as `$x` in `{a,$x}`.)
  return braceValues([a], false, cx.bashVersion) ?? undefined;
}

/** Whether brace expansion applies to the argument `a` where it runs (the word model: not after `set +B`). */
const bracesApply = (cx: Explainer, a: SyntaxNode): boolean => wordAt(cx, a)?.steps.find((st) => st.kind === 'brace')?.applies === true;

/**
 * What a command gets from its argument words, for the examples that run it: each word of a brace expansion is a value of
 * its own, the others their literal text. `printed`: for a command that prints its words (echo, printf), a word bash globs
 * or expands a tilde in has no value, since the files it matches and the home directory are not known (a command that
 * reads files reads the names as files).
 */
export function exampleWords(cx: Explainer, args: SyntaxNode[], printed = false): commandExamples.ExampleWord[] {
  return args.flatMap((a) => {
    const steps = printed ? wordAt(cx, a)?.steps : undefined;
    const globbed = steps?.find((st) => st.kind === 'glob')?.applies !== false && printed;
    const unknown = (w: string) => (globbed && isGlob(w)) || (printed && steps?.find((st) => st.kind === 'tilde')?.applies === true);
    const braced = braceWordsOf(cx, a);
    if (braced) return braced.map((w) => ({ value: unknown(w) ? undefined : w, text: w }));
    // (A word whose braces expand to words not listed here has no value: `'%s,'{a..c}`.)
    // (Braces the shell does not expand are text, `{a,b}` in dash: the word model's value.)
    // (A backslash, in double quotes or before a character, is no literal: `"%s\n"`, `a\ b`; the word model gives its value.)
    const text = wordBraces(a).length ? staticWordValue(a, false, cx.shell) : literalContent(a)?.text ?? staticWordValue(a, false, cx.shell);
    return [{ value: unknown(a.text) || bracesApply(cx, a) ? undefined : text, text: a.text }];
  });
}

/** How many words of a brace expansion an example shows, and how many characters of the line `echo` prints. */
const WORDS_SHOWN = 12;
const OUTPUT_SHOWN = 120;

/** The words of a brace expansion as a section of chips (`ExampleSection.words`), cut when there are many. */
function wordsSection(cx: Explainer, words: string[], cmd: string): ExampleSection {
  const n = words.length;
  const shown = (n > WORDS_SHOWN ? words.slice(0, WORDS_SHOWN - 1) : words).map(shownWord);
  const spaced = shown.some((w) => w.ends[0] + w.ends[1] > 0);
  const marks = [
    ...(spaced ? [cx.s(`\`${SPACE_MARK}\` は端の空白`, `\`${SPACE_MARK}\` is a space at an end`)] : []),
    ...(words.includes('') ? [cx.s(`\`${EMPTY_WORD}\` は空の単語`, `\`${EMPTY_WORD}\` is an empty word`)] : []),
  ];
  const after = [
    ...(n > WORDS_SHOWN ? [cx.s(`…（全 ${n} 語）`, `… ${n} words in all`)] : []),
    ...(marks.length ? [cx.s(`（${marks.join('、')}）`, `(${marks.join(', ')})`)] : []),
  ].join(' ');
  return {
    label: n ? cx.s(`展開後の単語（\`${cmd}\` が受け取る別々の引数 ${n} 個）`, `Resulting words (${n} separate ${n === 1 ? 'argument' : 'arguments'} of \`${cmd}\`)`) : cx.s('展開後の単語', 'Resulting words'),
    lines: shown.map((w) => w.text),
    ...(n ? {} : { empty: cx.s('（なし: 空の単語は取り除かれる）', '(none: empty words are dropped)') }),
    words: { ends: shown.map((w) => w.ends), ...(spaced ? { spaceLabel: cx.s('空白', 'space') } : {}), ...(after ? { after } : {}) },
  };
}

/**
 * What a command that prints its words (`CommandSpec.prints`: echo, printf) prints with these words, when it is known (the
 * section of the brace example; `wordExample`).
 */
function printedSection(cx: Explainer, at: SyntaxNode, prints: NonNullable<CommandSpec['prints']>, words: commandExamples.ExampleWord[]): ExampleSection | undefined {
  const values = words.map((w) => w.value);
  if (values.some((v) => v === undefined)) return undefined;
  const list = values as string[];
  if (prints === 'format') {
    const sec = commandExamples.commandExampleOf('printf', words, cx.lang)?.sections[0];
    return sec && (sec.lines.length > MAX_SHOWN_LINES ? { ...sec, lines: [...sec.lines.slice(0, MAX_SHOWN_LINES - 1), '…'] } : sec);
  }
  // echo with no option, and words it prints as they are (`echoWordsKnown`), joined with spaces.
  if (list[0].startsWith('-') || !echoWordsKnown(list, echoMayReadEscapes(cx, at))) return undefined;
  const line = [...visible(list.join(' '))];
  return { label: cx.s('出力', 'Output'), lines: [line.length > OUTPUT_SHOWN ? line.slice(0, OUTPUT_SHOWN - 1).join('') + '…' : line.join('')] };
}

/**
 * Brace expansion results, or file names a glob matches, for an argument word of the command `cmd`. The words of a brace
 * expansion are chips, so that they read as separate arguments; under the last word that expands, what the command prints
 * when it is known (`CommandSpec.prints`: echo, printf), unless it goes to a pipe (the pipeline's example shows it). `spec`:
 * the spec of what the name runs (none for a function of the script).
 */
export function wordExample(cx: Explainer, a: SyntaxNode, cmd: { name: string; node: SyntaxNode; args: SyntaxNode[]; spec?: CommandSpec }): void {
  const text = unquotedWord(a);
  if (!text) return;
  const words = braceWordsOf(cx, a);
  if (words) {
    const name = cmd.name.split('/').pop()!;
    const last = [...cmd.args].reverse().find((x) => braceWordsOf(cx, x)?.length);
    const pipe = cmd.node.parent?.type === 'pipeline' ? cmd.node.parent : undefined;
    const prints = cmd.spec?.prints;
    const printed = prints && last && same(last, a) && !(pipe && !same(pipe.namedChildren[pipe.namedChildren.length - 1], cmd.node)) ? printedSection(cx, cmd.node, prints, exampleWords(cx, cmd.args, true)) : undefined;
    cx.example({ kind: 'glob',
      title: cx.s(`例（ブレース展開 \`${text}\`）`, `Example (brace expansion \`${text}\`)`),
      sections: [wordsSection(cx, words, name), ...(printed ? [printed] : [])],
    });
    return;
  }
  if (bracesHere(cx, a) && braceExpansion(a, cx.bashVersion) !== undefined) return;
  // (Where globstar may be on, the example shows `**` at any depth, and says so.)
  const maybe = hasGlobstar(text) && shoptAt(cx, a).globstar === 'unknown';
  if (isGlob(text) && !globOff(cx, a)) globExample(cx, a, text, 'file', cx.s(`例（グロブ \`${text}\`${maybe ? '、globstar が有効なとき' : ''}）`, `Example (glob \`${text}\`${maybe ? ', where globstar is on' : ''})`));
}

export function globExample(cx: Explainer, n: SyntaxNode, pattern: string, mode: GlobMode, title: string, labels?: [string, string]): void {
  // A name that matches a pattern of GLOBIGNORE is left out.
  const ignore = mode !== 'value' ? wordAt(cx, n)?.glob.globignore : undefined;
  pushExample(cx, patterns.globExample(pattern, mode, globOpts(cx, mode !== 'value' ? 'file' : 'none', n), typeof ignore === 'object' ? ignore.value : undefined, title, labels, cx.lang));
}

/**
 * Values that select a case branch (any of its patterns) and values that do not. Where the model decides the `case`
 * (`StateModel.condition`) and knows the value of its word, that value is in the section of what it does here.
 */
export function caseExample(cx: Explainer, item: SyntaxNode, pats: SyntaxNode[]): void {
  const stmt = item.parent!;
  const decided = cx.state.condition(stmt);
  const value = decided && subjectValue(cx, field(stmt, 'value')!);
  const index = stmt.namedChildren.filter((c) => c.type === 'case_item').findIndex((c) => same(c, item));
  const known = value ? { value, matches: decided!.outcome.split(',').includes(String(index)) } : undefined;
  patternExample(cx, pats, [cx.s('この分岐に入る値', 'Values that take this branch'), cx.s('入らない値', 'Values that do not')], known);
}

/** An input → output example (sed, awk, perl, sort…; src/examples/commands.ts). */
export function ioExample(cx: Explainer, input: string[], output: string[], spec: RerunSpec, src: InputSource): void {
  cx.example(commandExamples.ioExample(input, output, spec, cx.lang, src));
}
