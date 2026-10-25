// The examples of jq and yq filters (docs/design/analyzer.md, step 6): the runs of a filter on sample input, shown as
// read from where the command reads (src/examples/source.ts), with the options that change what jq or each yq reads
// and prints. The runs are src/examples/jq.ts's, the YAML src/examples/yaml.ts's; this module reads the options of the
// command whose words are explained (`Explainer.command`) and adds the examples to the line.
import { givenOptions, values } from '../argv/query';
import { yqSameAsJq } from '../embedded/yq';
import { jqExample, type JqFormat, jqPrint, jqSample, type Json, parseJsonValues, runJq, slurpLines, toJson, varyJson } from '../examples/jq';
import { type InputBox, jqStepSections, type RerunSpec } from '../examples/rerun';
import { type InputSource, knownLines, NO_INPUT, readOrder, shareOut, shownSource, streamLabel } from '../examples/source';
import { type YamlStyle, YamlUnsupported, yamlLines, yqYamlOutput } from '../examples/yaml';
import { literalContent } from '../staticword';
import { wordTable } from '../wordtable';
import type { Explainer } from './context';
import { inputSource, interactive } from './examples';
import { given, optionValues } from './reads';

/**
 * Whether mikefarah/yq's `-r` (`--unwrapScalar`) is on: it prints a string as it is, also in JSON. The last one given
 * wins; `-r=false` turns it off, as pflag reads a bool (`0`, `f`, `false` in any case).
 */
function unwrapScalar(cx: Explainer): boolean {
  const { parse, nodes } = cx.command!;
  const found = givenOptions(parse).filter(({ role }) => role.role === 'option' && role.spec.names.includes('-r'));
  if (!found.length) return false;
  return !/=(0|f|false)$/i.test(nodes[found[found.length - 1].word].text);
}

/** --arg / --argjson values of the current jq command. */
export function jqVars(cx: Explainer): Record<string, Json> {
  // (No prototype: `--arg __proto__ v` is a variable like any other.)
  const vars = wordTable<Json>({});
  const args = optionValues(cx, '--arg', '--argjson');
  args.forEach(({ text: name, of, index }, i) => {
    // The name, then its value.
    const value = args[i + 1]?.index === 1 ? args[i + 1].text : undefined;
    if (index !== 0 || name === undefined || value === undefined) return;
    try {
      vars[name] = of === '--arg' ? value : JSON.parse(value);
    } catch {
      // Not valid JSON: leave it out, and the example will not be made.
    }
  });
  return vars;
}

/**
 * The formats mikefarah/yq v4 reads and prints by a file's extension, other than YAML (any other extension, or none):
 * JSON, or one not followed here (`?`).
 */
const YQ_FORMAT_OF_EXTENSION = wordTable<'json' | '?'>({
  json: 'json', xml: '?', csv: '?', tsv: '?', toml: '?', properties: '?', props: '?', ini: '?', lua: '?', hcl: '?', env: '?', kyaml: '?',
});

/** Input and output of a yq expression, in the YAML each yq reads and prints. */
export function yqExample(cx: Explainer, filter: string, style: YamlStyle): void {
  // mikefarah/yq: only expressions made of operations that behave as in jq (checked against yq).
  if (style === 'mikefarah' && !yqSameAsJq(filter)) return;
  // `-n`: no input is read. With `-i`, mikefarah/yq writes its result into the first file, and kislyuk/yq rewrites
  // each file apart (`EachFile`).
  const src = shownSource(given(cx, '-n') ? NO_INPUT : inputSource(cx));
  const inPlace = src.each === 'in-place' || src.each === 'into-first';
  // (The last `-o`, `-p` or `-I` wins, as pflag reads it.)
  const last = (...names: string[]) => {
    const found = optionValues(cx, ...names);
    return found.length ? found[found.length - 1].text ?? '?' : undefined;
  };
  const formatOf = (name: string) => ({ json: 'json', j: 'json', yaml: 'yaml', y: 'yaml' } as Record<string, string>)[name];
  let jsonIn = false;
  let json: boolean;
  let format: JqFormat | undefined;
  if (style === 'mikefarah') {
    // mikefarah/yq reads the format `-p` names, or the one of the first file's extension (YAML when it has none it
    // knows), and prints the format `-o` names, or the one of the extension. Formats other than JSON and YAML are not followed.
    const first = src.streams[0];
    const ext = first && first.kind !== 'stdin' ? /\.([^./]+)$/.exec(first.name)?.[1].toLowerCase() : undefined;
    const byExt = (ext && YQ_FORMAT_OF_EXTENSION[ext]) || 'yaml';
    const p = last('-p', '--input-format');
    const input = p === undefined ? byExt : formatOf(p);
    const o = last('-o', '--output-format');
    // (With `-p` and no `-o`, it prints YAML: v4.54 warns that it keeps this for backward compatibility.)
    const output = o === undefined ? (p === undefined ? input : 'yaml') : formatOf(o);
    if ((input !== 'json' && input !== 'yaml') || (output !== 'json' && output !== 'yaml')) return;
    jsonIn = input === 'json';
    json = output === 'json';
    // `-I`: the indent of JSON (0: one line); the YAML of another indent is not followed.
    const i = last('-I', '--indent');
    const indent = i === undefined ? 2 : Number(i);
    if (!Number.isInteger(indent) || indent < 0 || (!json && indent !== 2)) return;
    format = { indent };
  } else {
    json = !given(cx, '-y', '-Y');
    // kislyuk/yq passes `-c` and `-S` on to jq. (It has no `--indent`, the one way to an indent jq refuses.)
    format = jqFormat(cx)!;
  }
  const raw = style === 'mikefarah' ? !json || unwrapScalar(cx) : given(cx, '-r');
  let runs = jqExample(filter, { raw, nullInput: given(cx, '-n'), vars: style === 'kislyuk' ? jqVars(cx) : {}, format });
  // Where jq stops with an error, mikefarah/yq is often lenient (it adds a string and a number), so show nothing.
  if (style === 'mikefarah') runs = runs?.filter((r) => !r.error);
  if (!runs?.length) return;
  const first = src.streams[0];
  const outLabel = !inPlace ? cx.s(`出力（${json ? 'JSON' : 'YAML'}）`, `Output (${json ? 'JSON' : 'YAML'})`)
    : src.streams.length > 1 && first.kind !== 'stdin' ? cx.s(`書き換え後の \`${first.name}\``, `\`${first.name}\` after`) : cx.s('書き換え後', 'After');
  const title = inPlace ? cx.s('例（ファイルの中身がこう書き換わる）', 'Example (the file is rewritten like this)') : cx.s('例', 'Example');
  const printJson = (vs: Json[]) => vs.flatMap((v) => jqPrint(v, format!, raw));
  const show = (vs: Json[]) => (json ? printJson(vs) : yqYamlOutput(vs, style));
  // A JSON file is shown as jq's input is: short values on one line.
  const inputLines = (v: Json) => (jsonIn ? (toJson(v).length <= 60 ? [toJson(v)] : JSON.stringify(v, null, 2).split('\n')) : yamlLines(v, style));
  if (src.streams.length > 1 || src.streams.some(knownLines) || src.reads) {
    yqStreams(cx, filter, style, src, runs[0].input, show, { title, outLabel }, json, inputLines);
    return;
  }
  try {
    runs.forEach((r, i) => {
      const input = inputLines(r.input);
      const output = r.error ? [r.error] : show(r.values);
      cx.example({ kind: 'yq',
        title: inPlace || i === 0 ? title : cx.s('例（値が無いとき）', 'Example (when the value is missing)'),
        ...(src.streams.length ? {} : { note: cx.s('入力は読まない（`.` は `null`）', 'Reads no input (`.` is `null`)') }),
        sections: [
          ...(src.streams.length ? [{ label: streamLabel(src.streams[0], cx.lang), lines: input }] : []),
          ...(r.steps && i === 0 ? jqStepSections(r.steps, output, cx.lang, (vs) => (json ? vs.flatMap((v) => jqPrint(v, format!)) : yqYamlOutput(vs, style)))
            : [r.error ? { label: cx.s('エラー', 'Error'), lines: output } : { label: outLabel, lines: output, empty: cx.s('（出力なし）', '(no output)') }]),
        ],
      });
    });
    /* c8 ignore start */
  } catch (e) {
    // The sample inputs, and what filters make of them, fit in YAML so far: a guard.
    if (!(e instanceof YamlUnsupported)) throw e;
  }
  /* c8 ignore stop */
}

/**
 * The examples of a jq filter: the runs on sample input (`jqExample`), shown as read from `src`. Several files, or
 * the text of a here-string, make one example, run again on what each holds (src/examples/rerun.ts).
 */
export function jqExamples(cx: Explainer, spec: Extract<RerunSpec, { kind: 'jq' }>, src: InputSource, readBy: 'input' | 'inputs' | undefined): void {
  // The input as written in a file: short JSON on one line, longer JSON indented.
  const fileLines = (v: Json): string[] => (toJson(v).length <= 60 ? [toJson(v)] : JSON.stringify(v, null, 2).split('\n'));
  const { filter, nullInput, rawInput } = spec;
  // Several files, the text of a here-string, lines read as strings, or inputs read by the filter: one example, run on what each file holds.
  if (src.streams.length > 1 || src.streams.some(knownLines) || src.reads || rawInput || readBy) {
    let contents: string[][];
    const sample = jqSample(filter, { nullInput, rawInput });
    if (!sample) return;
    if (spec.slurp && !rawInput) {
      // A slurped sample is shared out among the files, when it has a value for each; otherwise each holds values like it.
      const [r] = jqExample(filter, { ...spec, vars: spec.vars }) ?? [];
      if (!r) return;
      let k = 0;
      contents = slurpLines(r.input).length >= src.streams.length ? shareOut(src, slurpLines(r.input))
        : src.streams.map((st) => knownLines(st) ?? slurpLines(varyJson(r.input, k++)));
    } else {
      // Each file holds a value like the sample (lines, with `-R`); a lone file read by `input` holds two.
      let k = 0;
      const each = rawInput || (readBy && !nullInput && src.streams.length === 1) ? 2 : 1;
      contents = src.streams.map((st) => knownLines(st) ?? Array.from({ length: each }, () => sample(k++)).flatMap((v) => (rawInput ? [v as string] : fileLines(v))));
    }
    const inputs: InputBox[] = src.streams.map((st, i) => ({ label: streamLabel(st, cx.lang, nullInput ? readBy : undefined), lines: contents[i] }));
    // (A file named twice is read twice.)
    const it = interactive(cx, { ...spec, ...(src.reads ? { reads: src.reads } : {}) }, inputs);
    // (An input the filter cannot run on here, such as one too few for `input`: no example.)
    if (it.result.sections.some((sec) => sec.lines.includes(cx.s('（この入力では実行できません）', '(cannot run on this input)')))) return;
    cx.example({ kind: 'jq',
      title: cx.s('例', 'Example'),
      sections: [...inputs.map((b) => ({ ...b, empty: cx.s('（空）', '(empty)') })), ...it.result.sections],
      interactive: it,
    });
    return;
  }
  const runs = jqExample(filter, { ...spec, nullInput });
  runs?.forEach((r, i) => {
    const input = r.slurp ? slurpLines(r.input) : fileLines(r.input);
    const label = src.streams.length ? streamLabel(src.streams[0], cx.lang) : '';
    cx.example({ kind: 'jq',
      title: i === 0 ? cx.s('例', 'Example') : cx.s('例（値が無いとき）', 'Example (when the value is missing)'),
      ...(src.streams.length ? {} : { note: cx.s('入力は読まない（`.` は `null`）', 'Reads no input (`.` is `null`)') }),
      sections: [
        ...(src.streams.length ? [{ label, lines: input }] : []),
        ...(r.steps && i === 0 ? jqStepSections(r.steps, r.outputs, cx.lang, (vs) => vs.flatMap((v) => jqPrint(v, spec.format!)))
          : [r.error
            ? { label: cx.s('エラー', 'Error'), lines: [r.error] }
            : { label: spec.join ? cx.s('出力（改行なし）', 'Output (no newlines)') : cx.s('出力', 'Output'), lines: r.outputs, empty: cx.s('（出力なし）', '(no output)') }]),
      ],
      // Only the first example can be edited; the second shows the missing-value case.
      ...(i === 0 && src.streams.length ? { interactive: interactive(cx, spec, [{ label, lines: input }]) } : {}),
    });
  });
}

/**
 * The yq example of several files, or of the text of a here-string (when it is JSON, which is YAML too): what yq
 * prints for each. `sample` is the value of the sample input; the other files hold values like it.
 */
function yqStreams(cx: Explainer, filter: string, style: YamlStyle, src: InputSource, sample: Json, show: (vs: Json[]) => string[], { title, outLabel }: { title: string; outLabel: string }, json: boolean, inputLines: (v: Json) => string[]): void {
  const vars = style === 'kislyuk' ? jqVars(cx) : {};
  let k = 0;
  const docs: Json[][] = [];
  // mikefarah/yq keeps the style of the YAML it reads: JSON text read as YAML prints in flow style (`[1]`), which
  // the example does not follow.
  if (style === 'mikefarah' && !json && src.streams.some(knownLines)) return;
  for (const st of src.streams) {
    const known = knownLines(st);
    try {
      docs.push(known ? parseJsonValues(known.join('\n')) : [varyJson(sample, k++)]);
    } catch {
      // (YAML that is not JSON: the example cannot read it.)
      return;
    }
  }
  const results: Json[][] = [];
  // (A file named twice is read twice.)
  for (const vs of readOrder(src, docs)) {
    const outs: Json[] = [];
    for (const v of vs) {
      // (Values the line gives may make the filter fail, or take too long to run here.)
      const res = runJq(filter, v, vars);
      if (!res || 'error' in res) return;
      outs.push(...res.outputs);
    }
    results.push(outs);
  }
  // mikefarah/yq prints the documents of each file apart, with `---` between files, in YAML.
  const output = style === 'mikefarah' && !json
    ? results.flatMap((vs, i) => [...(i ? ['---'] : []), ...show(vs)])
    : show(results.flat());
  cx.example({ kind: 'yq',
    title,
    sections: [
      ...src.streams.map((st, i) => ({ label: streamLabel(st, cx.lang), lines: knownLines(st) ?? inputLines(docs[i][0]) })),
      { label: outLabel, lines: output, empty: cx.s('（出力なし）', '(no output)') },
    ],
  });
}

/**
 * How jq prints its results, from its options: two spaces a level, or one line (`-c`, `--indent 0`), a tab (`--tab`),
 * `--indent n` (the last of them wins), the keys in order (`-S`). Undefined for an indent jq refuses or not known.
 */
export function jqFormat(cx: Explainer): JqFormat | undefined {
  const { parse, nodes } = cx.command!;
  const set = givenOptions(parse).flatMap(({ word, role }): [number, number | '\t' | undefined][] => {
    const names = role.role === 'option' ? role.spec.names : [];
    return names.includes('-c') ? [[word, 0]] : names.includes('--tab') ? [[word, '\t']] : [];
  });
  for (const { word } of values(parse, '--indent')) {
    const n = Number(literalContent(nodes[word])?.text ?? NaN);
    set.push([word, Number.isInteger(n) && n >= 0 && n <= 7 ? n : undefined]);
  }
  const indent = set.length ? set.sort((a, b) => a[0] - b[0])[set.length - 1][1] : 2;
  return indent === undefined ? undefined : { indent, ...(given(cx, '-S') ? { sortKeys: true } : {}) };
}
