import type { Lang, Text } from './i18n';

// What an explanation rests on (PROTOTYPE). Every explanation has a basis: the syntax, the
// Bash manual (its sections are the token's `refs` or the fact's), bash's actual behaviour where the manual does not
// say it, a command's spec, or a convention. Only the exceptions are shown: an explanation whose basis is bash's
// behaviour carries a `Basis`, and one that a short command can show carries a `TryIt`. Both name the probe row that
// verifies them (test/fixtures/probes/<table>.json, the row with that `id`); test/basis.test.ts checks that the row
// exists and that bash prints the try-it's output.

/** The kinds of basis. Only `behaviour` is marked; the others are the default reading of an explanation. */
export type BasisKind = 'syntax' | 'manual' | 'behaviour' | 'spec' | 'convention';

/** A probe row: `<table>#<id>` (`status#exit-modulo`). */
export type ProbeRef = `${'state' | 'env' | 'names' | 'words' | 'status'}#${string}`;

/** The basis of a fact or a token text, where it is bash's behaviour, before its language is chosen. */
export interface BasisSpec {
  kind: 'behaviour';
  /** `silent`: the manual does not say it. `differs`: the manual's words say otherwise (`BASH_SUBSHELL`). */
  manual: 'silent' | 'differs';
  /** The probe rows that verify it. */
  probes: readonly ProbeRef[];
}

/** A command that shows the claim, for the reader to run in a terminal (never run by the panel), and what it prints. */
export interface TryIt {
  code: string;
  output: string;
  /** The probe row that verifies the same behaviour. */
  probe: ProbeRef;
}

/** A basis as the outputs show it: the marker's words, and what it means (the tooltip). */
export interface BasisSaid extends BasisSpec {
  /** The marker: "Not in the manual · checked with bash 5.2". */
  label: string;
  /** What the marker means, for its tooltip and for a screen reader. */
  title: string;
}

/** The bash release the probes run (test/probe.test.ts runs them again in CI on ubuntu-24.04's bash 5.2). */
export const CHECKED_WITH = '5.2';

const LABELS: Record<BasisSpec['manual'], { label: Text; title: Text }> = {
  silent: {
    label: { ja: `マニュアルに記述なし・bash ${CHECKED_WITH} で確認`, en: `Not in the manual · checked with bash ${CHECKED_WITH}` },
    title: {
      ja: `Bash マニュアルには書かれていない、bash の実際の動き。bash ${CHECKED_WITH} で実行して確かめた`,
      en: `bash's actual behaviour, which the Bash manual does not state: checked by running bash ${CHECKED_WITH}`,
    },
  },
  differs: {
    label: { ja: `マニュアルの記述と異なる・bash ${CHECKED_WITH} で確認`, en: `Differs from the manual · checked with bash ${CHECKED_WITH}` },
    title: {
      ja: `Bash マニュアルの記述とは違う、bash の実際の動き。bash ${CHECKED_WITH} で実行して確かめた`,
      en: `bash's actual behaviour, which differs from what the Bash manual says: checked by running bash ${CHECKED_WITH}`,
    },
  },
};

/** The basis in `lang`. */
export function basisSaid(lang: Lang, b: BasisSpec): BasisSaid {
  return { ...b, label: LABELS[b.manual].label[lang], title: LABELS[b.manual].title[lang] };
}

/** The words around a try-it, in the outputs with no panel (the hover, Markdown, the CLI). */
export const TRY_IT: Record<Lang, { run: string; prints: string }> = {
  ja: { run: '端末で試す', prints: '出力' },
  en: { run: 'Try it in your terminal', prints: 'prints' },
};

/**
 * What the outputs with no badge add after a note or a row: the marker in brackets, then the try-it as code
 * (`style` 'markdown' quotes the code; 'text' leaves it bare for the CLI).
 */
export function basisLines(lang: Lang, x: { basis?: BasisSaid; tryIt?: TryIt }, style: 'markdown' | 'text'): string[] {
  const code = (s: string) => (style === 'markdown' ? (s.includes('\n') ? s : `\`${s}\``) : s);
  const out: string[] = [];
  if (x.basis) out.push(style === 'markdown' ? `_${x.basis.label}_` : `[${x.basis.label}]`);
  if (x.tryIt) {
    const t = TRY_IT[lang];
    out.push(`${t.run}: ${code(x.tryIt.code)} → ${t.prints} ${code(x.tryIt.output.replace(/\n/g, ' ⏎ '))}`);
  }
  return out;
}
