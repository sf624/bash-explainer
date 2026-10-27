// What command names run, in the model (src/semantics/names.ts), against what bash says: the rows of
// test/fixtures/probes/names.json, recorded by scripts/record-probes.ts, give `type -t NAME` at each marker,
// under bash and `bash --posix`. The model's answer for a name at a marker:
// - `keyword`, `alias`, `function`, `builtin` when it is sure, `unknown` when only some paths make it so;
// - a file searched in PATH: `file` when the dictionary describes a program of that name and PATH has /usr/bin or
//   /bin (the probes run with PATH=/usr/bin:/bin), `none` otherwise, `unknown` when PATH is not known; a path
//   (`/bin/ls`) is a `file`, and one remembered by `hash -p` too;
// - `not-run` when the marker cannot run: inside a string run by a shell that gets no exported function (the
//   marker is one), as the environment test says.
// A difference is listed with its reason in the row's `gaps` (`ID NAME bash|posix`); a gap the model gets right
// fails too, so that the list stays true. The test reads the table only: it needs no bash.
//
// The assignments before a command (`AssignmentMeaning`) are compared with the rows of state.json whose
// statements are simple commands with prefix assignments: a `persists` one is in the state at the end, a
// `command` one is not.
import * as assert from 'assert';
import { interpret } from '../src/argv/interpret';
import { argWord } from '../src/argv/words';
import { lookupCommand } from '../src/analyzer';
import { type ExecEnv, reachOf, slotEnvs } from '../src/semantics/env';
import { assignmentsOf, type NameResolution, resolveName } from '../src/semantics/names';
import { shellState } from '../src/semantics/state';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { descendants, field, fields } from '../src/syntax/tree';
import { instrument, readProbeTable } from './support/probe';

type Kind = 'alias' | 'keyword' | 'function' | 'builtin' | 'file' | 'none' | 'not-run' | 'unknown';

const program = (name: string): boolean => {
  const spec = lookupCommand(name);
  return !!spec && !spec.builtin;
};

function kindOf(r: NameResolution, path: string | undefined | null): Kind {
  switch (r.kind) {
    case 'keyword': return 'keyword';
    case 'alias': return r.sure ? 'alias' : 'unknown';
    case 'function': return r.sure ? 'function' : 'unknown';
    case 'builtin': return r.disabled ? 'unknown' : 'builtin';
    case 'none': return 'none';
    case 'file':
      if (r.path !== 'search') return 'file';
      if (!r.known) return 'none';
      // (null: PATH is not known.)
      if (path === null) return 'unknown';
      return (path === undefined || path.split(':').some((d) => d === '/usr/bin' || d === '/bin')) ? 'file' : 'none';
  }
}

/** The model's kind of each name at each marker of `script`. */
function modelKinds(script: string, ids: string[], names: string[], posix: boolean): Record<string, Record<string, Kind>> {
  const tree = createUnbashParser().parse(script);
  const model = shellState(tree, undefined, { posix });
  const commands = descendants(tree.root, ['command']);
  const out: Record<string, Record<string, Kind>> = {};
  for (const id of ids) {
    const call = `__probe ${id}`;
    const at = commands.find((c) => c.text.includes(call) && !descendants(c, ['command']).some((d) => d !== c && d.text.includes(call)))!;
    let env: ExecEnv | undefined;
    const name = field(at, 'name')!.text;
    if (name !== '__probe') {
      const spec = lookupCommand(name)!;
      const words = fields(at, 'argument');
      const parse = interpret(spec, words.map(argWord), { name, lookup: lookupCommand });
      env = slotEnvs(model.env(at), parse, spec, words, 'bash', lookupCommand).get(words.find((w) => w.text.includes(call))!);
    }
    const shell = env?.links[env.links.length - 1];
    // (The marker is a function exported to the shell: it runs when that shell gets and reads it.)
    if (env && (reachOf(env).functions === 'none' || (shell?.kind === 'slot' && shell.shell !== 'bash'))) {
      out[id] = Object.fromEntries(names.map((n) => [n, 'not-run']));
      continue;
    }
    const pathVar = model.at(at).run.variables.get('PATH');
    const path = !pathVar ? undefined : pathVar.set === 'on' && pathVar.value !== undefined ? pathVar.value : null;
    out[id] = Object.fromEntries(names.map((n) => [n, kindOf(resolveName(model, n, at, { env, program }), path)]));
  }
  return out;
}

describe('command names against bash (test/fixtures/probes/names.json)', () => {
  const rows = readProbeTable('names') as { snippet: string; names: string[]; facts: Record<string, Record<string, { bash: string; posix: string }>>; gaps?: Record<string, string> }[];
  for (const row of rows) {
    it(row.snippet, () => {
      const { script, markers } = instrument(row.snippet);
      const wrong: Record<string, string> = {};
      for (const mode of ['bash', 'posix'] as const) {
        const model = modelKinds(script, markers, row.names, mode === 'posix');
        for (const id of markers) {
          for (const n of row.names) {
            const bash = row.facts[id][n][mode];
            if (model[id][n] !== bash) wrong[`${id} ${n} ${mode}`] = `model: ${model[id][n]}, bash: ${bash}`;
          }
        }
      }
      assert.deepStrictEqual(Object.keys(wrong).sort(), Object.keys(row.gaps ?? {}).sort(), `differences: ${JSON.stringify(wrong)}`);
    });
  }
});

describe('assignments before a command against bash (test/fixtures/probes/state.json)', () => {
  const rows = (readProbeTable('state') as { snippet: string; posix?: boolean; facts: { end?: { variables?: Record<string, unknown> } } }[])
    .filter((r) => /\b\w+=\w+ [a-z:]/.test(r.snippet) && !r.snippet.includes('@PROBE'));
  it('has rows', () => assert.ok(rows.length >= 3));
  for (const row of rows) {
    it(`${row.posix ? '--posix: ' : ''}${row.snippet}`, () => {
      const tree = createUnbashParser().parse(row.snippet);
      const model = shellState(tree, undefined, { posix: !!row.posix });
      const assigned = row.facts.end?.variables ?? {};
      for (const c of descendants(tree.root, ['command'])) {
        // (Assignments alone have no name: they are the shell's.)
        const name = field(c, 'name');
        if (!name?.text) continue;
        const res = resolveName(model, name.text, c, { command: true, program });
        for (const a of assignmentsOf(model, c, res)) {
          // (A variable set before keeps its value when the assignment does not stay: `x=5; x=1 unset x`.)
          const value = field(a.node, 'value')?.text;
          const before = /^\w+$/.test(value ?? '') && (assigned[a.name] as { value?: string } | undefined)?.value?.startsWith('"') && (assigned[a.name] as { value: string }).value !== `"${value}"`;
          assert.strictEqual(a.scope === 'persists', Object.hasOwn(assigned, a.name) && !before, `${a.name} in \`${c.text}\`: ${a.scope}`);
          assert.ok(a.sure);
        }
      }
    });
  }
});
