// What bash does to a word, as a row of depth 2 of the panel says it (docs/design/panel-redesign.md, P8): the steps of the word model
// (`wordSteps`, src/semantics/wordsteps.ts) in bash's order, in words. A word where a step acts shows them on one line; where none acts, the
// line folds, and opens on every step with why it does nothing.
import type { Lang } from '../i18n';
import { stepActs, stepsChange, type WordStep } from '../semantics/wordsteps';
import { ui } from './texts';

/** One step, or several in a row that do nothing for one reason, as drawn: `off`, struck through. */
export interface StepSaid { text: string; off: boolean; why?: string }

/** What a row says of its word's steps. */
export interface StepsLine {
  /** "bash's steps:" */
  lead: string;
  /** Whether a step changes the word: the line is open. Else it folds under `summary`. */
  acts: boolean;
  /** What the folded line says. */
  summary: string;
  steps: StepSaid[];
}

const WHY_OF_PLACE = (context: string): 'cond' | 'assign' | 'context' => (context.startsWith('cond') ? 'cond' : context === 'assignment-value' ? 'assign' : 'context');

/**
 * The line of a word's steps. A step that acts is named. One that does nothing is said where there is a reason to say (quoted, not in this
 * place, `set -f`), and, on a word where no step acts, every one is: that line is the folded one, and it teaches the order. Steps in a row
 * that do nothing for one reason are one entry. `context`: the word's place (`WordMeaning.context`), which says what "not here" is.
 */
export function stepsLine(steps: readonly WordStep[], context: string, lang: Lang): StepsLine {
  const t = ui[lang].panel.steps;
  const acts = stepsChange(steps);
  const said: StepSaid[] = [];
  for (const s of steps) {
    const on = stepActs(s);
    const name = t.kinds[s.kind];
    if (on) {
      said.push({ text: s.applies === 'unknown' ? t.maybe.replace('{kind}', name) : name, off: false });
      continue;
    }
    if (acts && !s.why) continue;
    const why = s.why === 'context' ? t.why[WHY_OF_PLACE(context)] : s.why ? t.why[s.why] : t.none;
    const last = said[said.length - 1];
    if (last?.off && last.why === why) last.text += t.and + name;
    else said.push({ text: name, off: true, why });
  }
  return { lead: t.lead, acts, summary: t.summary, steps: said };
}
