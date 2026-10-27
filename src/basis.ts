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
 * - `spec`: what another program does (an option of `grep`), from its command spec in src/dict/, by the dictionary's
 *   name of it (`/bin/rm` and `rm` are `rm`, `egrep` is `grep`). Only on a program's command token: the tokens it
 *   reads rest on it by a rule (`tokenBasisFor`; docs/design/basis-spec-convention.md, 1.4).
 * The catalog gives `checked` and `differs`; a program's command token `spec`. A habit of shell scripts is not a
 * basis: a note whose advice is one names it beside its basis (`convention`, src/conventions.ts;
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

/** A token as `tokenBasisFor` reads it: a `Token`, or a token of the CLI's JSON. */
export interface BasisPart { kind: string; origin?: string; refs?: readonly string[]; basis?: Basis }

/** The kinds of token of a command another one runs, whose spec reads the words after its name (`sudo rm -rf x`: `rm`). */
const RUN_KINDS = new Set(['command', 'builtin']);
/** The kinds of bash's tokens of a word, under which the tokens of a language of that word sit (the quotes of `"a+"`, the word `x"a+"`). */
const WORD_KINDS = new Set(['argument', 'string', 'variable', 'expansion', 'number', 'pattern']);

/**
 * The basis of a token, with the tokens `above` it (the outermost first, its parent last): its own; else, for a token
 * of origin `argv` or `embedded`, the `spec` of the command that reads it, the nearest command token above it (only a
 * program's has one: a builtin's, a function's, bash's are the manual's); else the manual's sections (`basisFor`).
 * The argv tokens, the tokens of an embedded language (sed's `/x/d`, awk's `getline x`), and the tokens of a word
 * (`"a+"`, the quotes of `grep -E "a+"`) lie between a token and its command; any other token above it (`[[ ]]`, a
 * redirection) ends the search with no command. A command another runs (`sudo rm`, `env bash`) rests on its own spec,
 * never on its runner's: on its own basis, else the manual's, and its words rest on it as on a command bash runs.
 * Nothing but the command token stores the `spec`: the row model and a reader of the JSON apply this rule
 * (docs/design/basis-spec-convention.md, 1.4).
 */
export function tokenBasisFor(t: BasisPart, above: readonly BasisPart[]): Basis {
  const runs = t.origin === 'argv' && RUN_KINDS.has(t.kind);
  if (!t.basis && !runs && (t.origin === 'argv' || t.origin === 'embedded')) {
    for (let i = above.length - 1; i >= 0; i--) {
      const a = above[i];
      const between = a.origin === 'embedded' || (a.origin === 'argv' ? !RUN_KINDS.has(a.kind) : WORD_KINDS.has(a.kind));
      if (between) continue;
      if (a.basis?.kind === 'spec') return a.basis;
      break;
    }
  }
  return basisFor(t);
}
