// The examples of the line (docs/design/analyzer.md, step 6): what a command's run makes of its input (from its spec:
// `CommandSpec.example`, `io`, `eachFile`), a pipeline's data through every stage, how `read` splits a line, the words
// a brace expansion or a glob gives, the strings a regex matches, the values that select a pattern or make a test
// true, and an example's editable form for the panel. The builders are in src/examples/; this module gives them the
// line (its language, the options where a node is, what a command reads) and adds what they make to the line's
// examples. The examples of jq and yq are in src/explain/examples-jq.ts.
import type { Example, ExampleSection } from '../analyzer-types';
import type { ArgvParse } from '../argv/interpret';
import { interpret } from '../argv/interpret';
import type { CommandSpec } from '../argv/spec';
import { argWordFor } from '../argv/words';
import { visible } from '../ctlchars';
import { awkInvocation, type AwkRunOptions } from '../examples/awk';
import * as commandExamples from '../examples/commands';
import * as patterns from '../examples/patterns';
import * as pipelines from '../examples/pipeline';
import { MAX_SHOWN_LINES, pipedOutput, type Stage } from '../examples/pipeline';
import { type JsRegex, regexExamples } from '../examples/regex';
import type { InputBox, Interactive, RerunSpec } from '../examples/rerun';
import { globMatches, type GlobMode, type GlobOpts, hasGlobstar, isGlob } from '../examples/shellwords';
import * as sources from '../examples/source';
import { type InputSource, knownLines, pipeOf, readsFiles, shareOut, type SourceWord, type Stdin, type Stream, streamLabel, substitutionLines } from '../examples/source';
import { type Text, tx } from '../i18n';
import { shorten } from '../label';
import { fact } from '../messages';
import { slotEnvironment } from '../semantics/env';
import { isPlainWord, literalContent, staticWordValue } from '../staticword';
import { assignmentsOnly, field, prefixAssignments, redirectionsOf, type SyntaxNode } from '../syntax/tree';
import type { TestShape } from '../testexpr';
import { type Explainer, memoKey } from './context';
import { intersects, onLine, same } from './nodes';
import { given, globOff, ifsAt, NO_SPEC, optionValues, resolve, shoptAt, type ShoptName, specFor, unquotedWord, wordAt } from './reads';
import { operands, values } from '../argv/query';
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
  const texts = pats.map((p) => unquotedWord(p) ?? (p.type === 'extglob_pattern' ? p.text : undefined));
  pushExample(cx, patterns.patternExample(texts, globOpts(cx, 'pattern', pats[0]), labels, cx.lang, known));
}

/** `[[ x == pat ]]`: the values that match the pattern `pat` and some that do not, with the value of `x` where the model knows it. */
export function matchExample(cx: Explainer, n: SyntaxNode, pat: SyntaxNode): void {
  const left = field(n, 'left');
  const value = left && shoptAt(cx, n).nocasematch !== 'unknown' ? subjectValue(cx, left) : undefined;
  const text = unquotedWord(pat) ?? pat.text;
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

/** A stage of a pipeline example; `runs`: its operands are a command it runs (xargs), so its step shows the commands. */
type PipelineStage = { stage: Stage; file: boolean; readsFile: boolean; source: InputSource; runs: boolean };

/** The stages of pipelines read so far on the line (`pipelineStage`). */
const PIPELINE_STAGES = memoKey<PipelineStage | undefined>('pipeline stages');

/**
 * How an example names a stage of a pipeline: the text of the command without the redirections after its words
 * (`sort > out` is `sort`), but with a here-string, which is what it reads (`grep x <<< y`).
 */
function stageText(n: SyntaxNode): string {
  const kids = n.namedChildren;
  let end = kids.length;
  while (kids[end - 1].type === 'file_redirect' || kids[end - 1].type === 'heredoc_redirect') end--;
  return n.text.slice(0, kids[end - 1].endIndex - n.startIndex);
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
      ? e.title.replace(/^例/, `${target} の例`)
      : e.title.replace(/^Example/, `Example for ${target}`);
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
  // (`date +%F +%T`: date refuses the extra operand.)
  if (operands(parse).length > 1) return undefined;
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
  const { stages, files, readsFile, src, runs } = p;
  // A later stage that reads a file does not read what the stages before it write (`printf … | grep -e -v foo`).
  if (files.slice(1).some(Boolean)) return undefined;
  // Several files read as one stream; a first stage that works on each apart (`EachFile`: head, grep) is not
  // followed, nor one that reads a file twice.
  const streams = src.streams;
  if (streams.length > 1 && src.each) return undefined;
  if (src.reads) return undefined;
  const known = streams.length === 1 ? knownLines(streams[0]) : undefined;
  const ex = pipelines.pipelineExample(stages, readsFile || !!known, known);
  if (!ex) return undefined;
  const cap = (lines: string[]) => (lines.length > MAX_SHOWN_LINES ? [...lines.slice(0, MAX_SHOWN_LINES - 1), '…'] : lines).map(visible);
  const sections: ExampleSection[] = [];
  const inputs: InputBox[] = ex.input ? shareOut(src, ex.input).map((lines, i) => ({ label: streamLabel(streams[i], cx.lang), lines })) : [];
  sections.push(...inputs.map((b) => ({ label: b.label, lines: cap(b.lines), empty: cx.s('（空）', '(empty)') })));
  ex.steps.forEach((step, i) => {
    // `cat file` passes the input on unchanged.
    if (step.stage.copies && i < ex.steps.length - 1) return;
    const last = i === ex.steps.length - 1;
    const label = runs.has(step.stage)
      ? cx.s(`\`${step.stage.text}\` が実行するコマンド`, `Commands run by \`${step.stage.text}\``)
      : last ? cx.s(`出力（\`${step.stage.text}\` の後）`, `Output (after \`${step.stage.text}\`)`)
        : cx.s(`\`${step.stage.text}\` の後`, `After \`${step.stage.text}\``);
    sections.push({ label, lines: cap(step.output), empty: cx.s('（なし）', '(nothing)') });
  });
  // A pipeline in a command or process substitution (`echo $(a | b)`, `[[ $(a | b) == x ]]`, `for i in $(a | b)`) is
  // named in the title, not the command or statement around it.
  let up = n.parent;
  while (up && up.type !== 'command_substitution' && up.type !== 'process_substitution') up = up.parent;
  return {
    title: cx.s('例（パイプライン全体）', 'Example (the whole pipeline)'), sections,
    ...(up ? { target: shorten(n.text.replace(/\s*\\\n\s*/g, ' '), 40) } : {}),
    // Data from a file can be edited; data made by echo or seq cannot.
    ...(inputs.length ? { interactive: interactive(cx, { kind: 'pipeline', stages }, inputs) } : {}),
  };
}

/**
 * The stages of pipeline `n` (the first `count`), as the pipeline examples run them: whether each names a file to
 * read, whether the first reads one (`< f`), and what the first reads. Undefined for a stage they cannot follow.
 */
function pipelineStages(cx: Explainer, n: SyntaxNode, count = n.namedChildren.length): { stages: Stage[]; files: boolean[]; readsFile: boolean; src: InputSource; runs: ReadonlySet<Stage> } | undefined {
  const read: PipelineStage[] = [];
  for (const [i, cmd] of n.namedChildren.slice(0, count).entries()) {
    const st = pipelineStage(cx, n, cmd, i);
    if (!st) return undefined;
    read.push(st);
  }
  return { stages: read.map((st) => st.stage), files: read.map((st) => st.file), readsFile: !!read[0]?.readsFile, src: read[0]?.source, runs: new Set(read.filter((st) => st.runs).map((st) => st.stage)) };
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
    const name = field(cmd, 'name');
    // (An incomplete `echo a |` has a stage with a name of no word.)
    if (!name || (name.namedChildren.length && !isPlainWord(name.namedChildren[0]))) return undefined;
    // A stage that runs a function or an alias of the script is not the program its name suggests (as in commandTail).
    if (['function', 'alias'].includes(resolve(cx, name.text, name).kind)) return undefined;
    const args = cmd.namedChildren.filter((x) => !same(x, name) && !prefixAssignments(cmd).includes(x) && x.field !== 'redirect');
    const spec = specFor(cx, name.text);
    const stage: Stage = { cmd: name.text.split('/').pop()!, words: args.map((a) => literalContent(a)?.text), text: shorten(stageText(cmd), 40), ...(spec?.copies ? { copies: true } : {}) };
    const parse = interpret(spec ?? NO_SPEC, args.map(argWordFor(cx.state.shell)), { name: name.text, lookup: (x) => specFor(cx, x) });
    const source = inputSource(cx, cmd, parse, args, spec);
    // A stage that writes its output to a file (`sort -o f`) hands nothing on.
    const runs = !!spec?.operands?.some((alt) => alt.pattern.some((o) => o.command));
    return source.writes ? undefined : { stage, file: readsFiles(parse, stage.words), readsFile, source, runs };
  })();
  stages.set(cmd, read);
  return read;
}

/** The example of a run of the command, when its spec has one (`CommandSpec.example`: printf, xargs, sort…). */
export function commandExampleFor(cx: Explainer, n: SyntaxNode, spec: CommandSpec | undefined, args: SyntaxNode[], parse: ArgvParse): void {
  if (!spec?.example) return;
  if (spec.example === 'read') {
    readExample(cx, n, args);
    return;
  }
  const kind = spec.example;
  const src = inputSource(cx, n, parse, args, spec);
  // A command that prints what it reads as it is (cat) shows what it does when it joins several streams (`cat a - b`).
  if (spec.copies && src.streams.length < 2 && !src.reads) return;
  pushExample(cx, commandExamples.commandExampleOf(kind, args.map((a) => ({ value: literalContent(a)?.text, text: a.text })), cx.lang, src));
}

/**
 * What a command reads (src/examples/source.ts): the files its words name as its input, or its standard input, from
 * the syntax around it. By default, the command whose words are being read (`cx.command`).
 */
export function inputSource(cx: Explainer, cmd?: SyntaxNode, parse?: ArgvParse, nodes?: SyntaxNode[], spec?: CommandSpec): InputSource {
  const ctx = cx.command!;
  const words = (nodes ?? ctx.nodes).map((a): SourceWord => {
    const value = literalContent(a)?.text;
    const glob = wordAt(cx, a)?.steps.find((st) => st.kind === 'glob');
    return pipeOf(a) ? { text: a.text, pipe: pipeOf(a), lines: substitutionLines(a, (p, i) => pipedLines(cx, p, i)) } : { value, text: a.text, ...(value === undefined ? { many: 'unknown' as const } : glob && glob.applies !== false ? { many: 'glob' as const } : {}) };
  });
  return sources.inputSource(parse ?? ctx.parse, words, stdinOf(cx, cmd ?? ctx.args[0].parent!), parse ? spec : ctx.spec);
}

function stdinOf(cx: Explainer, cmd: SyntaxNode): Stdin {
  // (A here-string's word is not split or globbed: `$'b\na'` is two lines.)
  return sources.stdinOf(cmd, (w) => literalContent(w)?.text ?? staticWordValue(w), (p, i) => pipedLines(cx, p, i));
}

/**
 * What the stages of pipeline `n` before the one at `index` print, when it is known: the first reads the text the
 * line gives it (a here-string or a here-document) or prints it (echo, printf), and none reads a file.
 */
function pipedLines(cx: Explainer, n: SyntaxNode, index: number): string[] | undefined {
  const p = pipelineStages(cx, n, index);
  if (!p || p.readsFile || p.files.some(Boolean)) return undefined;
  return pipedOutput(p.stages, knownLines(p.src.streams[0]));
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

/** How `read` splits a sample line into its variables (with the IFS in effect, or the one given before it). */
function readExample(cx: Explainer, n: SyntaxNode, args: SyntaxNode[]): void {
  let ifs = ifsAt(cx, n);
  for (const c of n.namedChildren) {
    if (c.type !== 'variable_assignment' || field(c, 'name')?.text !== 'IFS') continue;
    const v = field(c, 'value');
    const lit = v ? literalContent(v) : { text: '' };
    ifs = lit?.text.replace(/\\t/g, '\t').replace(/\\n/g, '\n');
    if (ifs === undefined) break;
  }
  // The line the command reads, when a here-string gives it: `read -a p <<< "a,b,,c,"`.
  const here = n.namedChildren.find((c) => c.type === 'herestring_redirect')?.namedChildren[0];
  // (A here-string of expansions the model knows is read as their value: `read a b <<< "$x y"`.)
  const r = commandExamples.readExample(args.map((a) => literalContent(a)?.text), ifs, here && (literalContent(here)?.text ?? wordValue(cx, here)), cx.lang);
  if (!r) return;
  if (r.note) cx.note(r.note, n);
  cx.example(r.example);
}

/** Brace expansion results, or file names a glob matches, for an argument word. */
export function wordExample(cx: Explainer, a: SyntaxNode): void {
  const text = unquotedWord(a);
  if (!text) return;
  const words = bracesHere(cx, a) ? braceExpansion(text) : undefined;
  if (words === null) return;
  if (words) {
    cx.example({ kind: 'glob',
      title: cx.s(`例（ブレース展開 \`${text}\`）`, `Example (brace expansion \`${text}\`)`),
      sections: [{ label: cx.s('展開後の単語', 'Resulting words'), lines: (words.length > 12 ? [...words.slice(0, 11), '…'] : words).map((w) => w || "''") }],
    });
    return;
  }
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
