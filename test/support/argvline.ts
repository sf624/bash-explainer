// What the explanation says each program receives (src/argvline.ts, docs/design/panel-redesign.md P4), against the
// argv bash gave the recorders of the argv capture (test/support/argv.ts): every word the data gives as text must be
// bash's, and each placeholder must cover what bash put there.
import type { ArgvWord } from '../../src/analyzer-types';
import { argvOf } from '../../src/argvline';
import { spanOf } from '../../src/noteanchors';
import { type ArgvEnvName, ARGV_ENVS, type ArgvFinding, type ArgvPlanRun, splitTargets } from './argv';

/** The regex of the words `w` stands for, joined by `\0`: its text as it is, a placeholder any text (one that may give several words, across words). */
function wordPattern(w: ArgvWord): RegExp {
  const several = w.count !== undefined && w.count.max === undefined;
  const parts = w.parts.map((p) => ('text' in p ? p.text.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&') : p.splits || several ? '[^]*' : '[^\\0]*'));
  return new RegExp(`^${parts.join('')}$`);
}

/** Whether the words bash gave (`argv`) may be the words `words` stand for, in order. */
export function argvHolds(words: readonly ArgvWord[], argv: readonly string[]): boolean {
  let at = new Set([0]);
  for (const w of words) {
    const re = wordPattern(w);
    const { min, max } = w.count ?? { min: 1, max: 1 };
    const next = new Set<number>();
    for (const i of at) {
      for (let k = min; i + k <= argv.length && (max === undefined || k <= max); k++) {
        if (k === 0 || re.test(argv.slice(i, i + k).join('\0'))) next.add(i + k);
      }
    }
    at = next;
  }
  return at.has(argv.length);
}

/** The words as a text, for a finding: a placeholder between `‹` and `›`, its count after it. */
export const argvShown = (words: readonly ArgvWord[]): string => words.map((w) => w.parts.map((p) => ('text' in p ? p.text : `‹${p.label}›`)).join('')
  + (w.count ? `{${w.count.min},${w.count.max ?? ''}}` : '')).join(' ');

/** What the comparison went over: the commands that ran, their words given as text, and the placeholders. */
export interface ArgvLineCounts { ran: number; words: number; placeholders: number }

/**
 * The differences between the data of src/argvline.ts and the runs: for each command that ran, its words and the
 * targets of its redirections that were moved into the argv; a command the data says bash fails on must not have run.
 */
export function checkArgvLines(plans: readonly ArgvPlanRun[]): { found: ArgvFinding[]; counts: Record<ArgvEnvName, ArgvLineCounts> } {
  const counts = Object.fromEntries(ARGV_ENVS.map((e) => [e, { ran: 0, words: 0, placeholders: 0 }])) as Record<ArgvEnvName, ArgvLineCounts>;
  const found: ArgvFinding[] = [];
  for (const p of plans) {
    for (const m of p.inst.markers) {
      const runs = p.run.records.get(m.id) ?? [];
      const line = argvOf(m.command, p.input.model, 'en')!;
      const finding = (what: string): void => { found.push({ input: p.input.name, env: p.env, command: m.command.text, what: `argvline: ${what}` }); };
      // (An ambiguous redirection is not one: the capture moves its target into the argv, where bash gives its fields.)
      if (line.fails && line.fails.error !== 'ambiguous-redirect') {
        if (runs.length) finding(`fails (${line.fails.error}), bash: ran ${JSON.stringify(runs[0])}`);
        continue;
      }
      if (!runs.length) continue;
      const c = counts[p.env];
      c.ran++;
      c.words += line.words.filter((w) => w.parts.length === 1 && 'text' in w.parts[0] && !w.count).length;
      c.placeholders += line.words.flatMap((w) => w.parts).filter((x) => 'hole' in x).length;
      for (const run of runs) {
        const { argv, targets } = splitTargets(run);
        if (!argvHolds(line.words, argv)) finding(`${argvShown(line.words)}, bash: ${JSON.stringify(argv)}`);
        m.targets.forEach((t, i) => {
          const key = JSON.stringify(spanOf(t.parent!));
          const word = line.removed.find((r) => JSON.stringify(r.span) === key)!.word!;
          if (!argvHolds(word, targets[i])) finding(`${t.text} is ${argvShown(word)}, bash: ${JSON.stringify(targets[i])}`);
        });
      }
    }
  }
  return { found, counts };
}
