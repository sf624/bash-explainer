// What `bazel aquery` prints of an expression over the made-up workspace (src/examples/bazelworkspace.ts), for the examples
// of the commands after it in a pipeline (`bazel aquery 'mnemonic("CppCompile", //...)' | grep Target`). aquery needs a C++
// toolchain, so its actions are not computed but recorded (src/examples/bazelactions.ts); what is computed is which of them
// an expression selects, and only where the record shows it: aquery's filters (`mnemonic`, `inputs`, `outputs`, each a Java
// regex matched by the whole text) over one target pattern, where every action of the mnemonics they let through is
// recorded. The configured targets of the pattern are cquery's (`configuredTargets`, src/examples/bazelquery.ts). Anything
// else is not computed (no example), never guessed. test/bazel-aquery.test.ts compares it with what bazel 9.3.2 printed.
import type { ArgvParse } from '../argv/interpret';
import { switched } from '../argv/query';
import { queryTree, type QueryNode } from '../embedded/bazelquery';
import type { Lang } from '../i18n';
import { BAZEL_CC_ACTIONS, type ActionGraph, type WorkspaceAction } from './bazelactions';
import { configuredTargets, javaMatcher, queryWords, SILENT_OPTIONS, workspaceNote, type ConfiguredTarget } from './bazelquery';
import { BAZEL_CC, type Workspace } from './bazelworkspace';
import { chargeSize, chargeWalk, runnerStep } from './regexguard';
import type { SourceRun } from './runners';

/** The outputs the examples print: the text blocks of the actions, or their counts. */
export type AqueryOutput = 'text' | 'summary';

/** A run of aquery: its expression, its `--output`, and whether it lists the inputs and outputs (`--include_artifacts`, the default). */
export interface AqueryRun { expression: string; output: AqueryOutput; artifacts: boolean }

/** The most steps a run takes. */
const MAX_STEPS = 10000;

/** aquery's filters, and the texts of an action each matches its regex with: its mnemonic, the paths of its inputs, of its outputs. */
const FILTERS: Readonly<Record<string, (a: WorkspaceAction) => readonly string[]>> = {
  mnemonic: (a) => [a.mnemonic],
  inputs: (a) => a.inputs,
  outputs: (a) => a.outputs,
};

/** A filter of the expression: which texts of an action it reads, and whether its regex matches one. */
interface Filter { name: string; texts: (a: WorkspaceAction) => readonly string[]; matches: (text: string) => boolean }

/** The lines `run` prints over `ws` and its actions, or undefined where it is not followed. Within `guarded` (src/examples/regexguard.ts). */
export function runAquery(ws: Workspace, graph: ActionGraph, run: AqueryRun): string[] | undefined {
  const tree = queryTree(run.expression, 'aquery');
  if (!tree) return undefined;
  // (The filters, the outermost first, over one target pattern. A filter inside an operator keeps every action: bazel
  // 9.3.2 prints all those of `mnemonic("CppCompile", //util:strutil) + //app:main`. The functions of the configured graph
  // are not followed in aquery.)
  const filters: Filter[] = [];
  let n: QueryNode = tree;
  while (n.kind === 'call' && Object.hasOwn(FILTERS, n.name)) {
    const matches = javaMatcher((n.args[0] as { text: string }).text, true);
    if (!matches) return undefined;
    filters.push({ name: n.name, texts: FILTERS[n.name], matches });
    n = n.args[1] as QueryNode;
  }
  if (n.kind !== 'word') return undefined;
  const chosen = select(ws, graph, n.text, filters);
  if (!chosen) return undefined;
  return run.output === 'summary' ? summary(graph, chosen) : text(graph, chosen, run.artifacts);
}

/** The actions the filters keep of the configured targets of `pattern`, in the order aquery prints them; undefined where not known. */
function select(ws: Workspace, graph: ActionGraph, pattern: string, filters: readonly Filter[]): WorkspaceAction[] | undefined {
  let steps = 0;
  const step = () => runnerStep(++steps, MAX_STEPS);
  // (The mnemonics the filters let through: known only where every action of each is recorded, and a filter names them.)
  const recorded = new Set(graph.actions.map((a) => a.mnemonic));
  chargeWalk(graph.mnemonics.length * filters.length);
  const mnemonics = new Set(graph.mnemonics.filter((m) => filters.every((f) => f.name !== 'mnemonic' || f.matches(m))));
  if (!filters.some((f) => f.name === 'mnemonic') || [...mnemonics].some((m) => !recorded.has(m))) return undefined;
  // (aquery prints the actions of every configured target of the pattern that the server has analysed, an earlier
  // command's too: after `bazel cquery //...`, `//util:strutil` is also built for the tool `//tools:fmt` needs, in the
  // configuration of the execution platform. Known only where those are the targets the pattern configures itself,
  // whatever ran before: the configured targets of `//...` hold every one of the main repository a command analyses.)
  const own = configuredTargets(ws, pattern);
  const any = configuredTargets(ws, pattern, '//...');
  if (!own || !any || !same(own, any)) return undefined;
  chargeWalk(own.length * graph.actions.length);
  return own.flatMap((t) => graph.actions.filter((a) => a.label === t.label && a.config === t.config && mnemonics.has(a.mnemonic)
    && filters.every((f) => f.name === 'mnemonic' || f.texts(a).some((x) => (step(), f.matches(x))))));
}

const same = (a: readonly ConfiguredTarget[], b: readonly ConfiguredTarget[]): boolean => a.length === b.length && a.every((t, i) => t.label === b[i].label && t.config === b[i].config);

/** The text blocks of `actions`, each followed by an empty line, with or without the inputs and outputs. */
function text(graph: ActionGraph, actions: readonly WorkspaceAction[], artifacts: boolean): string[] {
  // (Each block: its fields and their names, its words with their indents and `\`, the configuration's checksum.)
  chargeSize(actions.reduce((n, a) => n + 400 + a.description.length + size(a.environment) + size(a.command, 8) + (artifacts ? size(a.inputs) + size(a.outputs) : 0), 0));
  return actions.flatMap((a) => {
    const { name, checksum } = graph.configurations[a.config];
    // (The command line: the first word after `(exec`, then a word a line, each line but the last continued with `\`.)
    const command = a.command.map((w, i) => (i ? `    ${w}` : `  Command Line: (exec ${w}`)).map((l, i, all) => (i === all.length - 1 ? `${l})` : `${l} \\`));
    return [
      `action '${a.description}'`, `  Mnemonic: ${a.mnemonic}`, `  Target: ${a.label}`, `  Configuration: ${name}`, `  Execution platform: ${graph.platform}`, '  ActionKey: <key>',
      ...(artifacts ? [`  Inputs: [${a.inputs.join(', ')}]`, `  Outputs: [${a.outputs.join(', ')}]`] : []),
      `  Environment: [${a.environment.join(', ')}]`, ...command, `# Configuration: ${checksum}`, `# Execution platform: ${graph.platform}`, '',
    ];
  });
}

/**
 * `--output=summary`: how many actions, then how many of each mnemonic, configuration and platform, the fewest first. Not
 * computed where two of a section are as many: bazel prints them in an order of its own (`TestRunner: 1` before `Genrule: 1`).
 */
function summary(graph: ActionGraph, actions: readonly WorkspaceAction[]): string[] | undefined {
  if (!actions.length) return ['No actions matched.'];
  const counted = (of: (a: WorkspaceAction) => string): [string, number][] => {
    const counts = new Map<string, number>();
    for (const a of actions) counts.set(of(a), (counts.get(of(a)) ?? 0) + 1);
    return [...counts].sort((x, y) => x[1] - y[1]);
  };
  const sections = [['Mnemonics', counted((a) => a.mnemonic)], ['Configurations', counted((a) => graph.configurations[a.config].name)], ['Execution Platforms', counted(() => graph.platform)]] as const;
  if (sections.some(([, counts]) => counts.some(([, k], i) => i > 0 && k === counts[i - 1][1]))) return undefined;
  chargeSize(sections.reduce((n, [title, counts]) => n + title.length + size(counts.map(([key]) => key), 16), 32));
  return [`${actions.length} total action${actions.length === 1 ? '' : 's'}.`, ...sections.flatMap(([title, counts]) => ['', `${title}:`, ...counts.map(([key, k]) => `  ${key}: ${k}`)])];
}

/** The size of `texts`, each with `more` characters around it. */
const size = (texts: readonly string[], more = 4): number => texts.reduce((n, t) => n + t.length + more, 0);

/** The options of aquery the examples follow: `--output` and `--include_artifacts`, and those that print nothing else. */
const FOLLOWED = new Set(['--output', '--include_artifacts', ...SILENT_OPTIONS]);

/**
 * What `bazel aquery` prints of the words of `parse` over the made-up workspace (`BAZEL_CC`, its actions `BAZEL_CC_ACTIONS`):
 * the expression its operands make, with `--output` (`text` or `summary`) and `--include_artifacts`; undefined for any other
 * option, a word not known, or what is not followed. `words`: the values of the words, when known.
 */
export function bazelAquerySource(parse: ArgvParse, words: readonly (string | undefined)[], lang: Lang): SourceRun | undefined {
  const read = queryWords(parse, words, FOLLOWED);
  const output = read?.output ?? 'text';
  if (!read || (output !== 'text' && output !== 'summary')) return undefined;
  const lines = runAquery(BAZEL_CC, BAZEL_CC_ACTIONS, { expression: read.expression, output, artifacts: switched(parse, '--include_artifacts') ?? true });
  if (!lines) return undefined;
  const more = output === 'text'
    ? ['。コマンド行、ツールチェーンのパス、構成の名前とチェックサムは、ある環境のもので、環境ごとに違う。アクションのキーは省いた（`<key>`）', '. The command lines, the toolchain\'s paths and the configurations\' names and checksums are those of one machine, and differ on another; the action keys are left out (`<key>`)'] as const
    : ['。構成の名前は環境による', '. The configurations\' names depend on the machine'] as const;
  return { lines, note: workspaceNote(lang, ['アクション', 'actions'], more) };
}
