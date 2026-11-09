// The runners a command's spec chooses (`CommandSpec.runner`; docs/design/sources.md, M6: a runner per spec, not a switch
// on the command's name): each works out what the command prints from its words, for the examples of the commands after
// it in a pipeline. The first are sources, which read no input: `bazel query`, `cquery` and `aquery` over a made-up workspace.
import type { ArgvParse } from '../argv/interpret';
import { innermost } from '../argv/query';
import type { CommandSpec, RunnerKind } from '../argv/spec';
import type { Lang } from '../i18n';
import { bazelAquerySource } from './bazelaquery';
import { bazelQuerySource } from './bazelquery';
import { guarded, type NotComputedId } from './regexguard';

/** What a source runner prints, and the note that says what of it is made up (`ターゲットは架空の…`). */
export interface SourceRun { lines: string[]; note: string }

/** A runner of a command that prints without reading input: what the words of `parse` make it print (`words`: their values, when known). */
type SourceRunner = (parse: ArgvParse, words: readonly (string | undefined)[], lang: Lang) => SourceRun | undefined;

const SOURCES: Readonly<Record<RunnerKind, SourceRunner>> = {
  'bazel-query': (parse, words, lang) => bazelQuerySource('query', parse, words, lang),
  'bazel-cquery': (parse, words, lang) => bazelQuerySource('cquery', parse, words, lang),
  'bazel-aquery': bazelAquerySource,
};

/**
 * What the command of `spec` prints of its words, by the runner its spec, or that of the subcommand its words run, chooses
 * (`bazel query …`); undefined where it has none, or the runner does not follow the words. A run the guard refuses
 * (src/examples/regexguard.ts: a regex of the words, the steps of the evaluation) gives the note that says why (`refused`).
 */
export function sourceRun(spec: CommandSpec, parse: ArgvParse, words: readonly (string | undefined)[], lang: Lang): SourceRun | { refused: NotComputedId } | undefined {
  const leaf = innermost(spec, parse);
  const kind = leaf.spec.runner;
  if (!kind) return undefined;
  return guarded<SourceRun | { refused: NotComputedId } | undefined>(() => SOURCES[kind](leaf.parse, words, lang), (refused) => ({ refused }));
}
