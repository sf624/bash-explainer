// What an explanation rests on, as data (docs/design/basis.md). Most of what we say is what the Bash manual says,
// and the sections we cite (`refs`) are its basis. Some of it is bash's behaviour where the manual is silent or says
// otherwise: that is checked by running bash, in the probe rows of test/fixtures/probes/*.json, which CI runs again.
// Such a fact names the probe row that checks it; the row holds a command for the reader's terminal and what it
// printed, recorded by scripts/record-probes.ts and copied into src/basis-probes.json (the explanations cannot read
// the test tables). Nothing here runs bash: a try-it shows what the probe recorded.
import copied from './basis-probes.json';

/** The probe tables (test/fixtures/probes/<table>.json), the one list of them (test/support/probe.ts reads it). */
export const PROBE_TABLES = ['state', 'env', 'names', 'words', 'status', 'values'] as const;
export type ProbeTable = (typeof PROBE_TABLES)[number];

/** A probe row: `<table>#<id>` (`status#exit-status`), its `id` in its table. */
export type ProbeRef = `${ProbeTable}#${string}`;

/**
 * The bash releases the probes run: 5.2 (every row), 5.3 (the rows of its constructs, `"bash": "5.3"`, and every
 * try-it, in CI's `bash53` job).
 */
export type BashRelease = '5.2' | '5.3';

/**
 * What an explanation rests on:
 * - `manual`: what the manual's `sections` say (the default: a fact's or a token's `refs`).
 * - `checked`: bash's behaviour where the manual does not say it, checked by running the releases `bash` on the
 *   `probes` (in CI: every row in 5.2, the rows of 5.3's constructs in 5.3, and the try-it in each release listed).
 * - `differs`: bash's behaviour where the manual says otherwise, checked the same way.
 * - `spec`: what another program does (an option of `grep`), from its command spec in src/dict/.
 * Only `checked` and `differs` are given by the catalog today; the others are the default or not given yet. A habit of
 * shell scripts is not a basis: a note whose advice is one names it beside its basis (`convention`, src/conventions.ts;
 * docs/design/basis-spec-convention.md, decision 1).
 */
export type Basis =
  | { kind: 'manual'; sections: readonly string[] }
  | { kind: 'checked' | 'differs'; bash: readonly BashRelease[]; probes: readonly ProbeRef[] }
  | { kind: 'spec'; command: string };

/**
 * A command for the reader to run in a terminal, and what it printed when the probe ran it (stdout and stderr). It may
 * show another value than its row's snippet (`exit 300` for a row of `exit 256`): both are run in CI.
 */
export interface TryIt {
  code: string;
  output: string;
  /** The bash it was run with (one run, one output). */
  bash: BashRelease;
  /** The probe row it comes from. */
  probe: ProbeRef;
}

/**
 * How a catalog entry says its basis: `kind`, and the probe row with a try-it that checks it (`probe`); `also`, other
 * rows that check the same behaviour. `manual` with a probe: the manual says it, and the probe gives a try-it.
 */
export interface BasisSpec {
  kind: 'manual' | 'checked' | 'differs';
  probe: CopiedRef;
  also?: readonly ProbeRef[];
}

/**
 * A row of the copy: the section it is about (test/basis.test.ts checks that the facts that show it cite it), the
 * releases its try-it printed `output` in (the row's own first: 5.2, or 5.3 for a row of its constructs; then 5.3 when
 * the `bash53` job prints the same there), and its try-it.
 */
export interface ProbeCopy {
  manual: string;
  bash: readonly BashRelease[];
  try: { code: string; output: string };
}

/** A probe row with a try-it, as the copy names it: an entry that names another fails to compile. */
export type CopiedRef = keyof typeof copied & ProbeRef;

/** The probe rows that have a try-it, by `<table>#<id>` (src/basis-probes.json). */
export const PROBE_COPY = copied as Readonly<Record<CopiedRef, ProbeCopy>>;

/**
 * The basis and the try-it of a fact whose entry gives `spec`: the basis only where it is not the manual (the default,
 * read from `refs`), and the try-it of the probe row.
 */
export function basisOf(spec: BasisSpec | undefined): { basis?: Basis; tryIt?: TryIt } {
  if (!spec) return {};
  const row = PROBE_COPY[spec.probe];
  const tryIt: TryIt = { code: row.try.code, output: row.try.output, bash: row.bash[0], probe: spec.probe };
  if (spec.kind === 'manual') return { tryIt };
  return { basis: { kind: spec.kind, bash: row.bash, probes: [spec.probe, ...(spec.also ?? [])] }, tryIt };
}

/** The basis of an explanation with `refs` and maybe a `basis` of its own: the manual's sections when it has none. */
export function basisFor(x: { refs?: readonly string[]; basis?: Basis }): Basis {
  return x.basis ?? { kind: 'manual', sections: x.refs ?? [] };
}
