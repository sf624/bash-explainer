// The word model (src/semantics/words.ts) against what bash does: the rows of test/fixtures/probes/words.json,
// recorded by scripts/record-probes.ts. At each marker (`@PROBE:a@ word…`), the fields the model gives for the
// words after it must be the ones bash printed, run with the probes' environment (its variables, its current
// directory and its files); a marker the model says bash fails on (an ambiguous redirection, failglob, `set -u`)
// must not have run. Where the model says it cannot know (a value it does not follow), the row lists the marker in
// its `gaps`, with the reason; a gap the model gets right fails too, so that the list stays true. In a row with
// `stdin`, each marker also printed what it read on its stdin: its here-string's one field (none: an empty text).
// The markers whose words the note on `set -u` fires on (`unboundRead`: an unset variable bash surely fails on) are
// the row's `unbound`: bash must not have run them, and its first error must name the first one's variable.
// The view of each word (src/semantics/wordview.ts) must hold too, on every run (`${id}.view`): its count, the start of
// its first field and the end of its last, its value where it is plain, and its words' fields where it does not glob.
// The test reads the table only: it needs no bash.
import * as assert from 'assert';
import type { BashVersion } from '../src/bashversion';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { descendants, field, fields } from '../src/syntax/tree';
import { shellState } from '../src/semantics/state';
import { unboundRead } from '../src/semantics/unbound';
import { wordFields, type WordEnv } from '../src/semantics/words';
import { wordView } from '../src/semantics/wordview';
import type { StateModel } from '../src/semantics/state';
import type { SyntaxNode } from '../src/syntax/tree';
import { alignRuns, BOX, FILES, instrument, PROBE_ENV, readProbeTable } from './support/probe';

interface WordRow { manual: string; snippet: string; posix?: boolean; stdin?: boolean; bash?: BashVersion; note?: string; gaps?: Record<string, string>; unbound?: string[]; facts: Record<string, unknown> }

const ENV: WordEnv = { variables: PROBE_ENV, pwd: BOX, files: FILES };

describe('the word model against bash (probes/words.json)', () => {
  const parser = createUnbashParser();
  const rows = readProbeTable('words') as WordRow[];
  for (const row of rows) {
    it(`${row.manual}: ${JSON.stringify(row.snippet)}${row.posix ? ' (bash --posix)' : ''}${row.bash ? ` (bash ${row.bash})` : ''}`, () => {
      const tree = parser.parse(instrument(row.snippet).script);
      const state = shellState(tree, 'bash', { posix: row.posix, version: row.bash, read: 'script' });
      const markers = descendants(tree.root, ['command']).filter((c) => field(c, 'name')?.text === '__probe');
      const found = new Map<string, string>();
      let stopped = false;
      const created = (row.facts.created ?? []) as string[];
      const unbound: string[] = [];
      for (const c of markers) {
        const [id, ...args] = fields(c, 'argument');
        const runs = row.facts[id.text] as string[][];
        const redirects = [c, c.parent!].flatMap((x) => fields(x, 'redirect'));
        const words = [...args, ...redirects.filter((r) => r.type === 'file_redirect').map((r) => field(r, 'destination')!)];
        // (The last here-string is the one the command reads.)
        const here = row.stdin ? redirects.filter((r) => r.type === 'herestring_redirect').map((r) => r.namedChildren[r.namedChildren.length - 1]).slice(-1) : [];
        words.push(...here);
        const unset = words.flatMap((w) => descendants(w, ['simple_expansion', 'expansion', 'variable_name'])).map((e) => unboundRead(e, state)?.shown).find((v) => v);
        if (unset) {
          if (runs.length) found.set(`${id.text}.unbound`, `model: ${unset} unbound, bash: ran`);
          if (!unbound.length && !String(row.facts.stderr).endsWith(`: ${unset}: unbound variable`)) found.set(`${id.text}.unbound`, `model: ${unset} unbound, bash: ${String(row.facts.stderr)}`);
          unbound.push(id.text);
        }
        const results = words.map((w) => wordFields(w, state, ENV));
        for (const run of runs) {
          const wrong = viewFindings(args, state, row.stdin ? run.slice(0, -1) : run);
          if (wrong) found.set(`${id.text}.view`, wrong);
        }
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
          const { head, tail, fits } = alignRuns(known, runs);
          found.set(id.text, fits ? `model: unknown (${unknown.map((w) => w.text).join(' ')})` : `model: ${JSON.stringify(head)}…${JSON.stringify(tail)}, bash: ${JSON.stringify(runs)}`);
          continue;
        }
        const model = [...known.flatMap((r) => r.fields!), ...(row.stdin ? [here.length ? results[results.length - 1].fields!.join(' ') : ''] : [])];
        if (!runs.length) {
          if (!stopped) found.set(id.text, `model: ${JSON.stringify(model)}, bash: not run`);
          continue;
        }
        for (const run of runs) if (JSON.stringify(run) !== JSON.stringify(model)) found.set(id.text, `model: ${JSON.stringify(model)}, bash: ${JSON.stringify(run)}`);
        // A redirection that went to a file of the run's directory: that file is there after the run.
        for (const r of results.slice(args.length, results.length - here.length)) {
          const target = r.fields![0].startsWith(`${BOX}/`) ? r.fields![0].slice(BOX.length + 1) : r.fields![0];
          if (!target.startsWith('/') && !FILES.includes(target) && !created.includes(target)) found.set(`${id.text}.redirect`, `model: ${target}, bash created: ${JSON.stringify(created)}`);
        }
      }
      const gaps = row.gaps ?? {};
      const unexplained = [...found].filter(([k]) => !(k in gaps)).map(([k, v]) => `${k}: ${v}`);
      const stale = Object.keys(gaps).filter((k) => !found.has(k));
      assert.deepStrictEqual({ unexplained, stale, unbound }, { unexplained: [], stale: [], unbound: row.unbound ?? [] });
    });
  }
});

/**
 * What the views of the words `args` say that the fields bash gave them (`run`, one after another) contradict: their
 * counts against the number of fields; and each word whose place in the run is known (every word before it has an
 * exact count) against its fields: its start and end, its value where it is plain, and its words' fields where it
 * does not glob. Undefined when everything holds.
 */
function viewFindings(args: readonly SyntaxNode[], model: StateModel, run: readonly string[]): string | undefined {
  const views = args.map((a) => wordView(a, model, ENV)!);
  const min = views.reduce((n, v) => n + v.count.min, 0);
  const max = views.some((v) => v.count.max === undefined) ? undefined : views.reduce((n, v) => n + v.count.max!, 0);
  if (run.length < min || (max !== undefined && run.length > max)) return `view: ${min} to ${max ?? 'any'} fields, bash: ${run.length}`;
  let at = 0;
  for (const [i, v] of views.entries()) {
    const said = `view of ${JSON.stringify(args[i].text)}`;
    if (v.plain && (v.count.min !== 1 || v.count.max !== 1 || v.globs !== false)) return `${said}: plain, but ${JSON.stringify(v.count)} fields, globs ${String(v.globs)}`;
    if (v.count.min > 0 && !(run[at].startsWith(v.start!))) return `${said}: starts with ${JSON.stringify(v.start)}, bash: ${JSON.stringify(run[at])}`;
    if (v.count.min !== v.count.max) return undefined;
    const own = run.slice(at, at + v.count.min);
    if (own.length && !own[own.length - 1].endsWith(v.end!)) return `${said}: ends with ${JSON.stringify(v.end)}, bash: ${JSON.stringify(own)}`;
    if (v.plain && own[0] !== v.value) return `${said}: ${JSON.stringify(v.value)}, bash: ${JSON.stringify(own)}`;
    const each = v.words.every((x) => x.fields) ? v.words.flatMap((x) => x.fields!) : undefined;
    if (v.globs === false && each && JSON.stringify(each) !== JSON.stringify(own)) return `${said}: words ${JSON.stringify(each)}, bash: ${JSON.stringify(own)}`;
    at += v.count.min;
  }
  return undefined;
}
