// What an explanation rests on, as data (docs/design/basis.md). Most of what we say is what the Bash manual says,
// and the sections we cite (`refs`) are its basis. Some of it is bash's behaviour where the manual is silent or says
// otherwise: that is checked by running bash, in the probe rows of test/fixtures/probes/*.json, which CI runs again.
// Such a fact names the probe row that checks it; the row holds a command for the reader's terminal and what it
// printed, recorded by scripts/record-probes.ts and copied into src/basis-probes.json (the explanations cannot read
// the test tables). Nothing here runs bash: a try-it shows what the probe recorded.
import copied from './basis-probes.json';

/** The probe tables (test/fixtures/probes/<table>.json). */
export type ProbeTable = 'state' | 'env' | 'names' | 'words' | 'status' | 'values';

/** A probe row: `<table>#<id>` (`status#exit-status`), its `id` in its table. */
export type ProbeRef = `${ProbeTable}#${string}`;

/** The bash releases the probes run: 5.2 (every row), 5.3 (the rows of its constructs, `"bash": "5.3"`). */
export type BashRelease = '5.2' | '5.3';

/**
 * What an explanation rests on:
 * - `manual`: what the manual's `sections` say (the default: a fact's or a token's `refs`).
 * - `checked`: bash's behaviour where the manual does not say it, checked by running `bash` on the `probes`.
 * - `differs`: bash's behaviour where the manual says otherwise, checked the same way.
 * - `spec`: what another program does (an option of `grep`), from its command spec in src/dict/.
 * - `convention`: a habit of shell scripts, not a rule of bash (capitals for the environment).
 * Only `checked` and `differs` are given by the catalog today; the others are the default or not given yet.
 */
export type Basis =
  | { kind: 'manual'; sections: readonly string[] }
  | { kind: 'checked' | 'differs'; bash: BashRelease; probes: readonly ProbeRef[] }
  | { kind: 'spec'; command: string }
  | { kind: 'convention' };

/** A command for the reader to run in a terminal, and what it printed when the probe ran it (stdout and stderr). */
export interface TryIt {
  code: string;
  output: string;
  /** The bash it was run with. */
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
  probe: ProbeRef;
  also?: readonly ProbeRef[];
}

/** A row of the copy: the section it is about, the bash it ran in, and its try-it. */
export interface ProbeCopy {
  manual: string;
  bash: BashRelease;
  try: { code: string; output: string };
}

/** The probe rows that have a try-it, by `<table>#<id>` (src/basis-probes.json). */
export const PROBE_COPY: Readonly<Record<string, ProbeCopy>> = copied as Record<string, ProbeCopy>;

/**
 * The basis and the try-it of a fact whose entry gives `spec`: the basis only where it is not the manual (the default,
 * read from `refs`), and the try-it of the probe row.
 */
export function basisOf(spec: BasisSpec | undefined): { basis?: Basis; tryIt?: TryIt } {
  if (!spec) return {};
  const row = PROBE_COPY[spec.probe];
  // (test/basis.test.ts checks that every row a catalog entry names is in the copy.)
  /* c8 ignore next */
  if (!row) throw new Error(`no probe row ${spec.probe} with a try-it in src/basis-probes.json: run scripts/record-probes.ts`);
  const tryIt: TryIt = { code: row.try.code, output: row.try.output, bash: row.bash, probe: spec.probe };
  if (spec.kind === 'manual') return { tryIt };
  return { basis: { kind: spec.kind, bash: row.bash, probes: [spec.probe, ...(spec.also ?? [])] }, tryIt };
}

/** The basis of an explanation with `refs` and maybe a `basis` of its own: the manual's sections when it has none. */
export function basisFor(x: { refs?: readonly string[]; basis?: Basis }): Basis {
  return x.basis ?? { kind: 'manual', sections: x.refs ?? [] };
}
