// The shell state model (src/semantics/state.ts) against what bash does: the rows of test/fixtures/probes/state.json,
// recorded by scripts/record-probes.ts. For each row, the model's state at each marker and at the end must say what
// bash's facts say, on what the model follows:
// - the options of `set -o` and `shopt` it has as on or off;
// - the variables (set, unset, and their attributes; the value, when the model knows it);
// - the functions (defined, and exported) and the aliases (with their values).
// A fact the model does not follow, or gives as unknown, is listed with its reason in the row's `gaps`
// (`end.variables.PWD`: "cd is not followed"); a gap the model gets right fails too, so that the list stays true.
// The test reads the table only: it needs no bash.
import * as assert from 'assert';
import type { BashVersion } from '../src/bashversion';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { descendants, field, fields } from '../src/syntax/tree';
import { defaultOn, option, shellState, ShellState } from '../src/semantics/state';
import { INTEGERS_AT_START, READONLY_AT_START } from '../src/semantics/vars';
import { instrument, PROBE_ENV, readProbeTable, StateDiff } from './support/probe';

/**
 * The attributes bash gives its own variables (as in the baseline of the probes): the integers and the readonly ones,
 * which the model gives them at start too (src/semantics/vars.ts), and the exported ones, which it does not follow.
 */
const BASELINE_ATTRS: Record<string, string> = {
  ...Object.fromEntries(INTEGERS_AT_START.map((name) => [name, 'i'])), ...Object.fromEntries(READONLY_AT_START), PWD: 'x', OLDPWD: 'x', HOME: 'x', PATH: 'x', LC_ALL: 'x', SHLVL: 'x',
};

/** How bash's `declare -p` writes a scalar value. */
const ESCAPES: Record<string, string> = { '\x07': 'a', '\b': 'b', '\x1b': 'E', '\f': 'f', '\n': 'n', '\r': 'r', '\t': 't', '\v': 'v', "'": "'", '\\': '\\' };
const quoted = (v: string): string => (/[\x00-\x1f\x7f]/.test(v)
  ? `$'${v.replace(/[\x00-\x1f\x7f'\\]/g, (c) => `\\${ESCAPES[c] ?? c.charCodeAt(0).toString(8).padStart(3, '0')}`)}'`
  : `"${v.replace(/(["\\$`])/g, '\\$1')}"`);

/** The differences between the model's state and bash's facts at one marker: path → what each says. */
function compare(id: string, st: ShellState, facts: StateDiff, posix: boolean, environment: Record<string, string> = {}): Map<string, string> {
  const out = new Map<string, string>();
  const say = (path: string, model: string, bash: string): void => void out.set(`${id}.${path}`, `model: ${model}, bash: ${bash}`);
  for (const kind of ['set', 'shopt'] as const) {
    const names = new Set([...st[kind].keys(), ...Object.keys(facts[kind] ?? {})]);
    for (const name of names) {
      const bash = facts[kind]?.[name] ?? defaultOn(kind, name, posix);
      const model = option(st, kind, name);
      const value = model === 'default' ? defaultOn(kind, name, posix) : model === 'on';
      if (model === 'unknown' || value !== bash) say(`${kind}.${name}`, model, bash ? 'on' : 'off');
    }
  }
  const vars = facts.variables ?? {};
  for (const name of new Set([...st.variables.keys(), ...Object.keys(vars), ...(facts.unset ?? [])])) {
    const v = st.variables.get(name);
    const bash = vars[name];
    const unset = facts.unset?.includes(name);
    // What bash has: unset, unchanged, declared (with no value) or set.
    const has = unset ? 'unset' : !bash ? 'unchanged' : bash.value === undefined ? 'declared' : 'set';
    if (!v) {
      say(`variables.${name}`, 'not followed', has);
      continue;
    }
    if (v.declared === 'unknown' || v.set === 'unknown') {
      say(`variables.${name}`, `declared ${v.declared}, set ${v.set}`, has);
      continue;
    }
    if (v.declared === 'off') {
      if (bash) say(`variables.${name}`, 'unset', has);
      continue;
    }
    if (!bash) {
      // Set by the script to what bash had already.
      // (`bash --posix` sets POSIXLY_CORRECT before the script, as in the baseline of those rows.)
      if (!(name in BASELINE_ATTRS) && name !== 'IFS' && !(posix && name === 'POSIXLY_CORRECT')) say(`variables.${name}`, v.set === 'on' ? 'set' : 'declared', has);
      continue;
    }
    if ((v.set === 'on') !== (has === 'set')) say(`variables.${name}.set`, v.set === 'on' ? 'set' : 'declared', has);
    const attrs = new Set([...(BASELINE_ATTRS[name] ?? '')]);
    for (const [l, a] of Object.entries(v.attrs)) {
      // (An export the model does not know, as it may come from the environment, `Attribute.environment`: on when the
      // run's environment has the name. One it takes as off, a name in lower case, is compared as it is: a gap.)
      const state = a.state === 'unknown' && a.environment ? (name in PROBE_ENV || name in environment ? 'on' : 'off') : a.state;
      if (state === 'unknown') say(`variables.${name}.${l}`, 'unknown', bash.attrs.includes(l) ? 'on' : 'off');
      if (state === 'on') attrs.add(l);
      else attrs.delete(l);
    }
    const model = [...attrs].sort().join('') || '-';
    const want = [...bash.attrs].sort().join('');
    if (model !== want) say(`variables.${name}.attrs`, model, want);
    if (v.set === 'on' && v.value !== undefined && !attrs.has('a') && !attrs.has('A') && quoted(v.value) !== bash.value) say(`variables.${name}.value`, quoted(v.value), String(bash.value));
  }
  for (const [name, f] of st.functions) {
    const bash = facts.functions?.[name];
    const unknown = [f.state, f.exported, f.readonly].includes('unknown');
    const model = unknown ? 'unknown' : f.state === 'off' ? 'none' : `f${f.readonly === 'on' ? 'r' : ''}${f.exported === 'on' ? 'x' : ''}`;
    const want = bash ? `f${[...bash.slice(1)].sort().join('')}` : 'none';
    if (model !== want) say(`functions.${name}`, model, want);
  }
  for (const name of Object.keys(facts.functions ?? {})) if (!st.functions.has(name)) say(`functions.${name}`, 'none', facts.functions![name]);
  for (const name of new Set([...st.aliases.keys(), ...Object.keys(facts.aliases ?? {})])) {
    const a = st.aliases.get(name);
    const model = !a || a.state === 'off' ? 'none' : a.state === 'unknown' ? 'unknown' : a.value;
    const bash = facts.aliases?.[name] ?? 'none';
    if (model !== bash) say(`aliases.${name}`, model, bash);
  }
  return out;
}

interface StateRow { manual: string; snippet: string; posix?: boolean; bash?: BashVersion; environment?: Record<string, string>; note?: string; gaps?: Record<string, string>; facts: Record<string, unknown> }

describe('the shell state model against bash (probes/state.json)', () => {
  const parser = createUnbashParser();
  const rows = readProbeTable('state') as StateRow[];
  for (const row of rows) {
    it(`${row.manual}: ${JSON.stringify(row.snippet)}${row.posix ? ' (bash --posix)' : ''}${row.bash ? ` (bash ${row.bash})` : ''}${row.environment ? ` (with ${Object.keys(row.environment).join(' ')} in the environment)` : ''}`, () => {
      const tree = parser.parse(instrument(`${row.snippet}\n@PROBE:end@\n`).script);
      const model = shellState(tree, 'bash', { posix: row.posix, version: row.bash, read: 'script' });
      const markers = new Map(descendants(tree.root, ['command'])
        .filter((c) => field(c, 'name')?.text === '__probe')
        .map((c) => [fields(c, 'argument')[0].text, c]));
      const found = new Map<string, string>();
      for (const [id, facts] of Object.entries(row.facts)) {
        if (id === 'status' || id === 'stderr') continue;
        for (const [k, v] of compare(id, model.at(markers.get(id)!).run, facts as StateDiff, !!row.posix, row.environment)) found.set(k, v);
      }
      const gaps = row.gaps ?? {};
      const unexplained = [...found].filter(([k]) => !(k in gaps)).map(([k, v]) => `${k}: ${v}`);
      const stale = Object.keys(gaps).filter((k) => !found.has(k));
      assert.deepStrictEqual({ unexplained, stale }, { unexplained: [], stale: [] });
    });
  }
});
