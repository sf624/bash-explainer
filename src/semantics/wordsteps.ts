// What bash does to a word, in its order (3.5), as depth 2 of the panel says it (src/ui/panelSteps.ts): from the steps of the word model
// (src/semantics/words.ts). test/word-steps.test.ts holds it to the word probes.
import type { ExpansionStep, StepKind, WordMeaning } from './words';

/** A step of what bash does to a word. */
export type WordStep = Pick<ExpansionStep, 'kind' | 'applies' | 'why' | 'manual'>;

/** The steps that make a word into other words; quote removal only tidies what is left. */
const EXPANDING_STEPS: ReadonlySet<StepKind> = new Set(['brace', 'tilde', 'parameter', 'command', 'arithmetic', 'process', 'split', 'glob']);

/** Whether a step does something to its word (or may: `unknown`). A step that is off where the word has work for it (`set -f`, an empty IFS) does nothing. */
export const stepActs = (s: Pick<ExpansionStep, 'applies'>): boolean => s.applies !== false;

/** Whether bash's steps change this word, more than taking its quotes away. */
export const stepsChange = (steps: readonly WordStep[]): boolean => steps.some((s) => EXPANDING_STEPS.has(s.kind) && stepActs(s));

/**
 * What bash does to a word: every step, with why one does not act. Undefined for a word no step has anything to do with (`-h`, `a.txt`):
 * no quotes, nothing that expands, no reason to say. (That a place leaves a step out, `why: 'context'`, is no reason by itself: `x=a` is as
 * plain as `a`. Nor is a place with no brace expansion, on a word with no braces.)
 */
export function wordSteps(m: WordMeaning): readonly WordStep[] | undefined {
  const touched = m.steps.some((s) => stepActs(s) || (s.why !== undefined && s.why !== 'context'));
  if (!touched) return undefined;
  return m.steps.map(({ kind, applies, why, manual, parts }) => ({ kind, applies, ...(why && (kind !== 'brace' || parts.length) ? { why } : {}), manual }));
}
