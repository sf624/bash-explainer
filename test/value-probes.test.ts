// The values Meaning shows (src/semantics/values.ts, `expansionValue`; docs/design/expansion-values.md) against what
// bash does: the rows of test/fixtures/probes/values.json, recorded by scripts/record-probes.ts. Each marker has one
// word, an expansion alone (`@PROBE:a@ "$x"`, `@PROBE:b@ $x`). Where the model gives a value, every run of the marker
// must have given bash's fields: the words splitting makes of it, or the text itself where it is not split; a value
// with a glob is a pattern, so bash's fields are the names it matches among the probes' files (`wordFields`, which
// the word probes check). A value given where bash did not run the marker is wrong too. Where the model gives none,
// the row lists the marker in `none`, with the reason; an entry the model gives a value for fails, so that the list
// stays true. A row with a `shell` is about a script of dash or sh: the model is of that shell, and its runs are
// dash's, or for sh both dash's and `bash --posix`'s (src/semantics/shvalues.ts). The test reads the table only: it
// needs no bash.
import * as assert from 'assert';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { descendants, field, fields, type SyntaxNode } from '../src/syntax/tree';
import { interpret } from '../src/argv/interpret';
import { argWord } from '../src/argv/words';
import { lookupCommand } from '../src/dict/aliases';
import { slotEnvs } from '../src/semantics/env';
import { shellState, type StateModel } from '../src/semantics/state';
import { expansionValue } from '../src/semantics/values';
import { wordFields } from '../src/semantics/words';
import { BOX, FILES, instrument, PROBE_ENV, readProbeTable } from './support/probe';

interface ValueRow { manual: string; snippet: string; shell?: 'dash' | 'sh'; requires?: string; none?: Record<string, string>; glob?: string[]; facts: Record<string, unknown> }

/** The runs of a marker in each shell of the row: bash's, dash's, or for sh dash's and `bash --posix`'s. */
function runsOf(row: ValueRow, id: string): { shell: string; runs: string[][] }[] {
  if (row.shell !== 'sh') return [{ shell: row.shell ?? 'bash', runs: row.facts[id] as string[][] }];
  const { dash, posix } = row.facts as Record<'dash' | 'posix', Record<string, string[][]>>;
  return [{ shell: 'dash', runs: dash[id] }, { shell: 'bash --posix', runs: posix[id] }];
}

/** The expansion a marker's word is: the word itself, or the one part of a double-quoted string. */
function expansionIn(w: SyntaxNode): SyntaxNode {
  const e = w.type === 'string' && w.namedChildren.length === 1 ? w.namedChildren[0] : w;
  assert.ok(e.type === 'simple_expansion' || e.type === 'expansion', `a marker's word is one expansion: ${w.text}`);
  return e;
}

/** The markers of a tree, also those in the strings that `eval` and `bash -c` run (read as the model reads them). */
function markers(root: SyntaxNode, model: StateModel): SyntaxNode[] {
  const out: SyntaxNode[] = [];
  for (const c of descendants(root, ['command'])) {
    const name = field(c, 'name')?.text;
    if (name === '__probe') out.push(c);
    const args = fields(c, 'argument');
    if (name === 'eval') {
      const script = model.script(args, model.env(c));
      if (!('why' in script)) out.push(...markers(script.tree.root, model));
    } else if (name === 'bash') {
      const spec = lookupCommand('bash')!;
      const envs = slotEnvs(model.env(c), interpret(spec, args.map(argWord), { name, lookup: lookupCommand }), spec, args, 'bash', lookupCommand);
      // (The string is the word after `-c`: `bash -O compat31 -c '…'`.)
      const string = args[args.findIndex((a) => a.text === '-c') + 1];
      const script = model.script([string], envs.get(string)!);
      if (!('why' in script)) out.push(...markers(script.tree.root, script.model));
    }
  }
  return out;
}

describe('the values of expansions against bash (probes/values.json)', () => {
  const parser = createUnbashParser();
  const rows = readProbeTable('values') as ValueRow[];
  it('holds rows that show values and rows that show none', () => {
    assert.ok(rows.filter((r) => r.none).length >= 10 && rows.filter((r) => !r.none).length >= 20);
    for (const shell of ['dash', 'sh']) {
      const of = rows.filter((r) => r.shell === shell);
      assert.ok(of.filter((r) => r.none).length >= 5 && of.filter((r) => !r.none).length >= 5, shell);
    }
  });

  it('runs a row of dash or sh only where dash is (requires: dash)', () => {
    assert.deepStrictEqual(rows.filter((r) => r.shell && r.requires !== 'dash').map((r) => r.snippet), []);
  });
  for (const row of rows) {
    it(`${row.manual}: ${JSON.stringify(row.snippet)}`, () => {
      const tree = parser.parse(instrument(row.snippet).script);
      const state = shellState(tree, row.shell ?? 'bash');
      const found = new Map<string, string>();
      const globbed: string[] = [];
      for (const c of markers(tree.root, state)) {
        const [id, ...args] = fields(c, 'argument');
        assert.strictEqual(args.length, 1, `${id.text} has one word`);
        const v = expansionValue(expansionIn(args[0]), state);
        if (!v) {
          found.set(id.text, 'none');
          continue;
        }
        let expected = v.words ?? [v.text];
        if (v.glob) {
          globbed.push(id.text);
          expected = wordFields(args[0], state, { variables: PROBE_ENV, pwd: BOX, files: FILES }).fields!;
        }
        for (const { shell, runs } of runsOf(row, id.text)) {
          if (!runs.length) found.set(id.text, `model: ${JSON.stringify(v.text)}, ${shell}: not run`);
          for (const run of runs) if (JSON.stringify(run) !== JSON.stringify(expected)) found.set(id.text, `model: ${JSON.stringify(expected)}, ${shell}: ${JSON.stringify(run)}`);
        }
      }
      const none = row.none ?? {};
      const wrong = [...found].filter(([k, v]) => v !== 'none' || !(k in none)).map(([k, v]) => `${k}: ${v}`);
      const stale = Object.keys(none).filter((k) => found.get(k) !== 'none');
      assert.deepStrictEqual({ wrong, stale, glob: globbed }, { wrong: [], stale: [], glob: row.glob ?? [] });
    });
  }
});
