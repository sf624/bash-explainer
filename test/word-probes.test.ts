// The word model (src/semantics/words.ts) against what bash does: the rows of test/fixtures/probes/words.json,
// recorded by scripts/record-probes.ts. At each marker (`@PROBE:a@ word…`), the fields the model gives for the
// words after it must be the ones bash printed, run with the probes' environment (its variables, its current
// directory and its files); a marker the model says bash fails on (an ambiguous redirection, failglob, `set -u`)
// must not have run. Where the model says it cannot know (a value it does not follow), the row lists the marker in
// its `gaps`, with the reason; a gap the model gets right fails too, so that the list stays true.
// The test reads the table only: it needs no bash.
import * as assert from 'assert';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { descendants, field, fields } from '../src/syntax/tree';
import { shellState } from '../src/semantics/state';
import { wordFields, type WordEnv } from '../src/semantics/words';
import { BOX, FILES, instrument, PROBE_ENV, readProbeTable } from './support/probe';

interface WordRow { manual: string; snippet: string; posix?: boolean; note?: string; gaps?: Record<string, string>; facts: Record<string, unknown> }

const ENV: WordEnv = { variables: PROBE_ENV, pwd: BOX, files: FILES };

describe('the word model against bash (probes/words.json)', () => {
  const parser = createUnbashParser();
  const rows = readProbeTable('words') as WordRow[];
  for (const row of rows) {
    it(`${row.manual}: ${JSON.stringify(row.snippet)}${row.posix ? ' (bash --posix)' : ''}`, () => {
      const tree = parser.parse(instrument(row.snippet).script);
      const state = shellState(tree, 'bash', { posix: row.posix });
      const markers = descendants(tree.root, ['command']).filter((c) => field(c, 'name')?.text === '__probe');
      const found = new Map<string, string>();
      let stopped = false;
      const created = (row.facts.created ?? []) as string[];
      for (const c of markers) {
        const [id, ...args] = fields(c, 'argument');
        const runs = row.facts[id.text] as string[][];
        const words = [...args, ...[c, c.parent!].flatMap((x) => fields(x, 'redirect')).filter((r) => r.type === 'file_redirect').map((r) => field(r, 'destination')!)];
        const results = words.map((w) => wordFields(w, state, ENV));
        const error = results.find((r) => r.error)?.error;
        if (error) {
          if (runs.length) found.set(id.text, `model: ${error}, bash: ran`);
          stopped = true;
          continue;
        }
        const known = results.slice(0, args.length);
        const unknown = words.filter((_, i) => !results[i].fields);
        if (unknown.length) {
          // The words before the first unknown one and after the last one must still be bash's.
          const first = known.findIndex((r) => !r.fields);
          const last = known.length - 1 - [...known].reverse().findIndex((r) => !r.fields);
          const head = known.slice(0, first < 0 ? known.length : first).flatMap((r) => r.fields!);
          const tail = first < 0 ? [] : known.slice(last + 1).flatMap((r) => r.fields!);
          const fits = runs.every((run) => JSON.stringify(run.slice(0, head.length)) === JSON.stringify(head)
            && (!tail.length || JSON.stringify(run.slice(-tail.length)) === JSON.stringify(tail)));
          found.set(id.text, fits ? `model: unknown (${unknown.map((w) => w.text).join(' ')})` : `model: ${JSON.stringify(head)}…${JSON.stringify(tail)}, bash: ${JSON.stringify(runs)}`);
          continue;
        }
        const model = known.flatMap((r) => r.fields!);
        if (!runs.length) {
          if (!stopped) found.set(id.text, `model: ${JSON.stringify(model)}, bash: not run`);
          continue;
        }
        for (const run of runs) if (JSON.stringify(run) !== JSON.stringify(model)) found.set(id.text, `model: ${JSON.stringify(model)}, bash: ${JSON.stringify(run)}`);
        // A redirection that went to a file of the run's directory: that file is there after the run.
        for (const r of results.slice(args.length)) {
          const target = r.fields![0].startsWith(`${BOX}/`) ? r.fields![0].slice(BOX.length + 1) : r.fields![0];
          if (!target.startsWith('/') && !FILES.includes(target) && !created.includes(target)) found.set(`${id.text}.redirect`, `model: ${target}, bash created: ${JSON.stringify(created)}`);
        }
      }
      const gaps = row.gaps ?? {};
      const unexplained = [...found].filter(([k]) => !(k in gaps)).map(([k, v]) => `${k}: ${v}`);
      const stale = Object.keys(gaps).filter((k) => !found.has(k));
      assert.deepStrictEqual({ unexplained, stale }, { unexplained: [], stale: [] });
    });
  }
});
