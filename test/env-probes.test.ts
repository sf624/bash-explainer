// The execution environments of the model (src/semantics/env.ts) against what bash does: the rows of
// test/fixtures/probes/env.json, recorded by scripts/record-probes.ts. Each marker is a call of `__probe`, an
// exported function, which says whether it ran in the main shell, a subshell, or another shell. The model's
// answer for a marker:
// - a marker inside a string that a command slot runs (`bash -c '…'`, `eval '…'`) runs where that slot runs;
// - `not-run` when a function cannot run there: a program started by a slot (`env f`), a slot that skips
//   functions (`command f`), or a shell that gets no exported function (`env -i bash -c f`);
// - otherwise the process: `main`, `sub` (a subshell; `unknown` when only on some paths, which agrees with
//   bash's `mixed`: it ran in both), or `other-shell`.
// A marker the model gets wrong is listed with its reason in the row's `gaps`; a gap the model gets right fails
// too, so that the list stays true. The test reads the table only: it needs no bash.
import * as assert from 'assert';
import { interpret } from '../src/argv/interpret';
import { argWord } from '../src/argv/words';
import { lookupCommand } from '../src/analyzer';
import type { BashVersion } from '../src/bashversion';
import { processOf, reachOf, slotEnvs, type ExecEnv } from '../src/semantics/env';
import { shellState } from '../src/semantics/state';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { descendants, field, fields, type SyntaxNode } from '../src/syntax/tree';
import { instrument, readProbeTable } from './support/probe';

type Fact = 'main' | 'sub' | 'other-shell' | 'not-run' | 'unknown';

/** What the model says of a function call that runs in `env` (as the first word of the innermost slot, when `slotted`). */
function factOf(env: ExecEnv, slotted: boolean): Fact {
  const last = env.links[env.links.length - 1];
  if (slotted && last?.kind === 'slot' && (last.slot.run === 'exec' || last.slot.lookup)) return 'not-run';
  if (reachOf(env).functions === 'none') return 'not-run';
  const p = processOf(env);
  return p.kind === 'main' ? 'main' : p.kind === 'subshell' ? (p.sure ? 'sub' : 'unknown') : 'other-shell';
}

/** The model's fact for each marker of `script` (the snippet with its markers made calls of `__probe`). */
export function modelFacts(script: string, ids: string[], version?: BashVersion): Record<string, Fact> {
  const tree = createUnbashParser().parse(script);
  const model = shellState(tree, undefined, { version });
  const commands = descendants(tree.root, ['command']);
  const out: Record<string, Fact> = {};
  for (const id of ids) {
    const call = `__probe ${id}`;
    // The innermost command that holds the marker: the call itself, or a command that runs it through a slot
    // (`command __probe a`, `bash -c '__probe a'`).
    const at = commands.find((c) => c.text.includes(call) && !descendants(c, ['command']).some((d) => d !== c && d.text.includes(call)))!;
    const words = fields(at, 'argument');
    const name = field(at, 'name')!.text;
    const spec = lookupCommand(name);
    let env = model.env(at);
    let slotted = false;
    if (name !== '__probe' && spec) {
      const parse = interpret(spec, words.map(argWord), { name, lookup: lookupCommand });
      const envs = slotEnvs(env, parse, spec, words, 'bash', lookupCommand);
      // The innermost slot whose first word, or string, holds the marker.
      const word = words.find((w) => w.text.includes(call) || w.text === '__probe');
      const inner = word && envs.get(word);
      if (inner) {
        env = inner;
        slotted = word.text === '__probe';
      }
    }
    out[id] = factOf(env, slotted);
  }
  return out;
}

describe('execution environments against bash (test/fixtures/probes/env.json)', () => {
  const rows = readProbeTable('env') as { snippet: string; bash?: BashVersion; facts: Record<string, string>; gaps?: Record<string, string> }[];
  for (const row of rows) {
    it(row.snippet, () => {
      const { script, markers } = instrument(row.snippet);
      const model = modelFacts(script, markers, row.bash);
      const wrong: Record<string, string> = {};
      for (const id of markers) {
        const bash = row.facts[id];
        const m = model[id];
        if (m !== bash && !(m === 'unknown' && bash === 'mixed')) wrong[id] = `model: ${m}, bash: ${bash}`;
      }
      assert.deepStrictEqual(Object.keys(wrong).sort(), Object.keys(row.gaps ?? {}).sort(), `differences: ${JSON.stringify(wrong)}`);
    });
  }
});
