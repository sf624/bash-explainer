// The generator of the normal-forms audit (docs/design/oracles.md, 4.2 and step 8): seeded spellings of the words of a
// few scenarios, more than the table (test/fixtures/oracles/normal-forms.json) can hold. Three kinds, those of 4.2:
// quoting variants of a word (`'x'`, `"x"`, `\x`, `x""`, `$'x'`, `$'\x78'`…), path prefixes of a command name
// (`/bin/`, `/usr/bin/`, `./`), and option spellings (bundled, split, attached, `=`, a long name's prefix, any order).
// Each form is keyed by the normalizers of its scenario (`KEYS` of test/support/normal-forms.ts) and run in bash
// (`runJobs` of test/support/rewrite-states.ts, contained, with no walls, as the table's forms are: the spellings are
// built from a fixed alphabet, which never makes a `$(`, a backquote or an operator). Within a scenario:
// - a false merge: forms with one key that bash runs otherwise. A failure, unless a rule of `ACCEPTED` takes the forms
//   that differ, with its reason (as a `known` row of the table);
// - a missed match: forms with keys of their own that bash runs the same. A report, not a failure (a missing
//   explanation, not a wrong one); scripts/normal-forms-sweep.ts prints them.
// A key in parentheses (`(not known)`, `(none)`) is the normalizer saying nothing: such a form is a group of its own.
import { jobOf, keyOf, type Normalizer, type Observed, type Row, subject } from './normal-forms';
import { random } from './fuzz';
import { type Ran, runJobs } from './rewrite-states';
import { lookupCommand } from '../../src/dict/aliases';
import { staticWordValue } from '../../src/staticword';
import type { OptionSpec, ValueSpec } from '../../src/argv/spec';
import { createUnbashParser } from '../../src/syntax/adapters/unbash';
import { fields, hasError } from '../../src/syntax/tree';

const parser = createUnbashParser();
type Rnd = () => number;
const pick = <T>(rnd: Rnd, xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];

// ---------------------------------------------------------------------------------------------------
// Spellings of a word.

/** The quotings a spelling switches between: none, `'…'`, `"…"`, `$'…'` and `$"…"` (a translated string). */
type Quoting = 'plain' | 'single' | 'double' | 'ansi' | 'locale';
const OPEN: Record<Quoting, string> = { plain: '', single: `'`, double: `"`, ansi: `$'`, locale: `$"` };
const CLOSE: Record<Quoting, string> = { plain: '', single: `'`, double: `"`, ansi: `'`, locale: `"` };
/** How often each quoting is chosen: `$"…"` is rare in scripts, and its value is never known. */
const WEIGHT: Record<Quoting, number> = { plain: 4, single: 2, double: 2, ansi: 1, locale: 0.3 };
const weighted = (rnd: Rnd, qs: readonly Quoting[]): Quoting => {
  let r = rnd() * qs.reduce((t, q) => t + WEIGHT[q], 0);
  return qs.find((q) => (r -= WEIGHT[q]) < 0) ?? qs[qs.length - 1];
};

/** Characters that are text in a plain word only escaped (some only at its start, or with others: `~`, `#`, `{a,b}`). */
const PLAIN_SPECIAL = new Set([...' \t\n\\\'"$`*?[]{}~#!|&;<>()']);
const hex = (c: string): string => c.charCodeAt(0).toString(16).padStart(2, '0');
const octal = (c: string): string => c.charCodeAt(0).toString(8).padStart(3, '0');
const ANSI_LETTER: Record<string, string> = { '\n': 'n', '\t': 't', '\x07': 'a', '\x1b': 'e', '\x0b': 'v' };

/** The ways to write `c` as text in `q`, or none (a `'` in single quotes, a newline in a plain word). */
function literal(c: string, q: Quoting): string[] {
  switch (q) {
    case 'plain': return c === '\n' ? [] : PLAIN_SPECIAL.has(c) ? [`\\${c}`] : [c, c, c, c, `\\${c}`];
    case 'single': return c === `'` ? [] : [c];
    case 'double': case 'locale': return '$`"\\'.includes(c) ? [`\\${c}`] : [c];
    case 'ansi': {
      const out = c === '\\' || c === `'` ? [`\\${c}`] : c < ' ' ? [] : [c];
      out.push(`\\x${hex(c)}`, `\\${octal(c)}`);
      if (ANSI_LETTER[c]) out.push(`\\${ANSI_LETTER[c]}`);
      if (c >= '\x01' && c <= '\x1a') out.push(`\\c${String.fromCharCode(c.charCodeAt(0) + 0x60)}`);
      if (c === '"' || c === '?') out.push(`\\${c}`);
      if (/[a-z]/i.test(c)) out.push(`\\u00${hex(c)}`, `\\U000000${hex(c)}`);
      return out;
    }
  }
}

/**
 * Near-misses: ways to write `c` that a reader may take for it, and bash may not (a `*` unescaped, `"\a"`, `$'\q'`, a
 * one-digit `$'\1'`). What they give is for the key and bash to say, not for this file; none breaks the quoting it is in.
 */
function nearMiss(c: string, q: Quoting): string[] {
  switch (q) {
    case 'plain': return '*?[]{}~#!$,'.includes(c) ? [c] : [];
    case 'single': return [];
    case 'double': case 'locale': return '$`"\\\n'.includes(c) ? (c === '$' ? ['$'] : []) : [`\\${c}`];
    case 'ansi': return c === `'` || c === '\\' ? [] : [`\\${c}`, `\\x${c.charCodeAt(0).toString(16)}`, `\\${c.charCodeAt(0).toString(8)}`];
  }
}

export interface SpellOptions {
  /** The chance that a character is written as a near-miss. */
  near?: number;
  /** The quotings to use (all by default). */
  quotings?: readonly Quoting[];
}

/**
 * A spelling of the word whose value is `value`: each character in a quoting of its own or of the one before, written
 * as text (or, with the chance `near`, as a near-miss), with empty quotes and backslash-newlines put in at random.
 */
export function spell(rnd: Rnd, value: string, { near = 0, quotings = ['plain', 'single', 'double', 'ansi', 'locale'] }: SpellOptions = {}): string {
  let out = '';
  let q: Quoting = 'plain';
  const to = (next: Quoting): void => {
    out += CLOSE[q] + OPEN[next];
    q = next;
  };
  for (const c of value) {
    if (rnd() < 0.08) {
      // (An empty string, or a line joined, between two characters.)
      const empties = quotings.filter((x) => x !== 'plain');
      if (empties.length && q === 'plain' && rnd() < 0.6) {
        const e = weighted(rnd, empties);
        out += OPEN[e] + CLOSE[e];
      } else if (q === 'plain' || q === 'double') out += '\\\n';
    }
    let ways = rnd() < near ? nearMiss(c, q) : [];
    if (!ways.length) ways = literal(c, q);
    if (!ways.length || rnd() < 0.2) {
      to(weighted(rnd, quotings.filter((x) => literal(c, x).length)));
      ways = rnd() < near && nearMiss(c, q).length ? nearMiss(c, q) : literal(c, q);
    }
    out += pick(rnd, ways);
  }
  to('plain');
  return out || `''`;
}

// ---------------------------------------------------------------------------------------------------
// The scenarios.

/** A scenario: what each form runs with (as a row of the table), and the normalizers that key its forms. */
export interface Scenario {
  name: string;
  normalizers: Normalizer[];
  observe: Observed[];
  files?: Record<string, string>;
  stdin?: string;
  env?: Record<string, string>;
  prelude?: string;
  epilogue?: string;
  /** Makes `count` forms. */
  forms: (rnd: Rnd, count: number) => string[];
}

/** The characters of the values of `words`: few, so that values repeat and their spellings meet in one key. */
const VALUE_CHARS = ['a', 'b', 'a', 'b', ' ', '\\', '$', '"', `'`, '*', '~', '{', '}', ',', '\n', '\t', '#', '=', '-', ':', '?', '[', ']', '!', '\x01', '0', '1', '%'];

/** A word as written where it is not spelled anew: plain when it can be, else in single quotes. */
const written = (v: string): string => (/^[\w,./=+:@%-]+$/.test(v) ? v : `'${v}'`);

/**
 * A scenario of command words: each base (the values of its words) with the words at `vary` spelled anew (the name
 * maybe after a path of `paths`), the others as written, then `after` (`| sort`).
 */
function wordsScenario(s: Omit<Scenario, 'forms'> & { bases: string[][]; vary: number[]; paths?: string[]; near?: number; after?: string }): Scenario {
  return {
    ...s,
    forms: (rnd, count) => Array.from({ length: count }, () => {
      const words = pick(rnd, s.bases).map((w, i) => {
        if (!s.vary.includes(i)) return written(w);
        const v = (i === 0 && s.paths && rnd() < 0.5 ? pick(rnd, s.paths) : '') + w;
        return rnd() < 0.15 ? written(v) : spell(rnd, v, { near: s.near ?? 0 });
      });
      return [...words, ...(s.after ? [s.after] : [])].join(' ');
    }),
  };
}

/** An option of `command`'s spec and the value given to it (if it takes one). */
interface Given { name: string; value?: string }

/** The spec of the option `name` of `command`. */
function optionOf(command: string, name: string): OptionSpec {
  const o = lookupCommand(command)?.options?.find((x) => x.names.includes(name));
  if (!o) throw new Error(`no option ${name} of ${command}`);
  return o;
}
const valueOf = (o: OptionSpec): ValueSpec | undefined => (Array.isArray(o.value) ? o.value[0] : o.value);

/**
 * The words of one spelling of `given` options of `command` and its `operands`: each option by one of its names (a
 * long one maybe cut to a prefix), its value attached, after `=` or in the next word (an optional value only attached:
 * else a near-miss), short options with no value bundled, in a random order, before the operands or among them.
 */
function optionWords(rnd: Rnd, command: string, given: readonly Given[], operands: readonly string[]): string[] {
  const groups = given.map((g) => {
    const o = optionOf(command, g.name);
    const v = valueOf(o);
    const name = pick(rnd, o.names);
    const short = !name.startsWith('--') && name.length === 2;
    const as = !short && rnd() < 0.5 ? name.slice(0, 3 + Math.floor(rnd() * (name.length - 2))) : name;
    if (g.value === undefined) return { short, flag: true, words: [as] };
    const next = v?.how !== 'attached-only' && (!v?.optional || rnd() < 0.15) && rnd() < 0.6;
    // (A short option's value after `=` is a near-miss: `-k=2` gives `=2`.)
    return { short, flag: false, words: next ? [as, g.value] : [`${as}${!short || rnd() < 0.1 ? '=' : ''}${g.value}`] };
  });
  for (let i = groups.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [groups[i], groups[j]] = [groups[j], groups[i]];
  }
  // (Bundled: `-a -b` as `-ab`, and a short option with its value attached last: `-ab -n5` as `-abn5`.)
  const words: string[] = [];
  let cluster = false;
  for (const g of groups) {
    if (cluster && g.short && g.words.length === 1 && rnd() < 0.6) words[words.length - 1] += g.words[0].slice(1);
    else words.push(...g.words);
    cluster = g.short && g.flag && (cluster || g.words.length === 1);
  }
  // (GNU tools take options after an operand too.)
  if (operands.length && rnd() < 0.3) words.splice(Math.floor(rnd() * (words.length + 1)), 0, operands[0]);
  else words.push(operands[0]);
  return [...words, ...operands.slice(1)].filter((w) => w !== undefined);
}

/** A scenario of option spellings: each meaning (the options given and the operands) written in random ways. */
function optionsScenario(s: Omit<Scenario, 'forms' | 'normalizers'> & { command: string; meanings: { given: Given[]; operands: string[] }[]; near?: number }): Scenario {
  return {
    ...s,
    normalizers: ['lookupOption'],
    forms: (rnd, count) => Array.from({ length: count }, () => {
      const m = pick(rnd, s.meanings);
      const words = optionWords(rnd, s.command, m.given, m.operands);
      return [s.command, ...words.map((w) => (rnd() < 0.2 ? spell(rnd, w, { near: s.near ?? 0 }) : written(w)))].join(' ');
    }),
  };
}

export const SCENARIOS: Scenario[] = [
  {
    name: 'a word printed',
    normalizers: ['staticWordValue'],
    observe: ['stdout', 'stderr', 'status'],
    files: { ab: '', 'a b': '', b: '' },
    forms: (rnd, count) => {
      // (Values repeat, so that several spellings of each meet in one key.)
      const values = Array.from({ length: Math.ceil(count / 4) }, () => Array.from({ length: Math.floor(rnd() * 4) }, () => pick(rnd, VALUE_CHARS)).join(''));
      return Array.from({ length: count }, () => `printf '<%s>\\n' ${spell(rnd, pick(rnd, values), { near: 0.2 })}`);
    },
  },
  wordsScenario({ name: 'read', normalizers: ['commandName', 'lookupCommand'], observe: ['stdout'], stdin: 'a\\b\n', epilogue: 'echo "x=$x"', bases: [['read', 'x']], vary: [0], paths: ['./', './/'], files: { read: '#!/bin/sh\necho script read\n' } }),
  wordsScenario({ name: 'rm', normalizers: ['commandName', 'lookupCommand', 'canonicalName'], observe: ['files', 'status'], files: { x: '' }, bases: [['rm', '-f', 'x']], vary: [0, 1, 2], paths: ['/bin/', '/usr/bin/', '//bin/', '/usr/bin/./'] }),
  wordsScenario({ name: 'echo', normalizers: ['commandName', 'canonicalName'], observe: ['stdout'], bases: [['echo', 'a']], vary: [0, 1], paths: ['/bin/', '/usr/bin/'] }),
  wordsScenario({ name: 'kill -l', normalizers: ['lookupCommand'], observe: ['stdout'], bases: [['kill', '-l']], vary: [0, 1], paths: ['/bin/', '/usr/bin/'] }),
  wordsScenario({ name: 'printf -v', normalizers: ['lookupCommand'], observe: ['stdout', 'stderr', 'status'], epilogue: 'echo "x=$x"', bases: [['printf', '-v', 'x', 'hi']], vary: [0, 1, 2], paths: ['/usr/bin/'] }),
  wordsScenario({ name: 'egrep', normalizers: ['canonicalName'], observe: ['stdout', 'status'], files: { f: 'a\nb\nc\n' }, bases: [['egrep', 'a|b', 'f'], ['grep', '-E', 'a|b', 'f'], ['fgrep', 'a|b', 'f'], ['grep', '-F', 'a|b', 'f']], vary: [0, 1], paths: ['/bin/', '/usr/bin/'] }),
  wordsScenario({ name: 'cd', normalizers: ['nameOf', 'commandName'], observe: ['stdout'], files: { 'sub/x': '' }, epilogue: 'pwd', bases: [['cd', 'sub']], vary: [0, 1] }),
  wordsScenario({ name: 'test', normalizers: ['commandTest'], observe: ['status', 'stderr'], files: { x: '' }, bases: [['[', '-f', 'x', ']'], ['test', '-f', 'x'], ['[', '!', '-f', 'x', ']'], ['[', '-n', 'x', ']'], ['[', '(', '-f', 'x', ')', ']'], ['test', '!', '-n', '']], vary: [0, 1, 2, 3, 4, 5], near: 0.1 }),
  wordsScenario({ name: 'find', normalizers: ['findWords'], observe: ['stdout', 'stderr'], files: { ab: '', 'a.txt': '', 'b.txt': '' }, bases: [['find', '.', '-name', 'ab'], ['find', '.', '(', '-name', 'ab', '-o', '-name', '*.txt', ')'], ['find', '.', '!', '-name', '*.txt']], vary: [2, 3, 4, 5, 6, 7, 8], near: 0.1, after: '| sort' }),
  optionsScenario({ name: 'sort', command: 'sort', observe: ['stdout', 'status'], files: { f: 'a 1\nb 10\nc 2\nB 3\n' }, meanings: [
    { given: [{ name: '-k', value: '2' }, { name: '-r' }, { name: '-n' }], operands: ['f'] },
    { given: [{ name: '-f' }, { name: '-r' }], operands: ['f'] },
    { given: [{ name: '-t', value: ' ' }, { name: '-k', value: '1,1' }, { name: '-u' }], operands: ['f'] },
  ] }),
  optionsScenario({ name: 'cut', command: 'cut', observe: ['stdout', 'status'], files: { f: 'a,b,c\nd\n' }, meanings: [
    { given: [{ name: '-d', value: ',' }, { name: '-f', value: '2' }], operands: ['f'] },
    { given: [{ name: '-d', value: ',' }, { name: '-f', value: '1,3' }, { name: '-s' }], operands: ['f'] },
    { given: [{ name: '-c', value: '1-2' }], operands: ['f'] },
  ] }),
  optionsScenario({ name: 'grep', command: 'grep', observe: ['stdout', 'status'], files: { f: 'A\nb\nab\n=a\n' }, meanings: [
    { given: [{ name: '-i' }, { name: '-v' }, { name: '-n' }, { name: '-e', value: 'a' }], operands: ['f'] },
    { given: [{ name: '-c' }, { name: '-x' }, { name: '-e', value: 'b' }], operands: ['f'] },
    { given: [{ name: '-w' }, { name: '-o' }, { name: '-i' }], operands: ['a', 'f'] },
  ] }),
  optionsScenario({ name: 'tail', command: 'tail', observe: ['stdout', 'status'], files: { f: '1\n2\n3\n' }, meanings: [
    { given: [{ name: '-n', value: '+2' }], operands: ['f'] },
    { given: [{ name: '-n', value: '1' }, { name: '-q' }], operands: ['f', 'f'] },
    { given: [{ name: '-c', value: '2' }, { name: '-v' }], operands: ['f'] },
  ] }),
  optionsScenario({ name: 'ls', command: 'ls', observe: ['stdout', 'status'], files: { '.h': '', a: '', b: '' }, meanings: [
    { given: [{ name: '-1' }, { name: '-A' }, { name: '-r' }], operands: [] },
    { given: [{ name: '-1' }, { name: '-a' }], operands: [] },
    { given: [{ name: '-1' }, { name: '-I', value: 'a' }], operands: [] },
  ] }),
  optionsScenario({ name: 'sed', command: 'sed', observe: ['stdout', 'files', 'status'], files: { f: 'a\nb\n' }, meanings: [
    { given: [{ name: '-n' }, { name: '-e', value: '2p' }], operands: ['f'] },
    { given: [{ name: '-i', value: '.bak' }, { name: '-e', value: 's/a/x/' }], operands: ['f'] },
    { given: [{ name: '-E' }, { name: '-s' }, { name: '-e', value: 's/(a)/[\\1]/' }], operands: ['f'] },
  ] }),
  optionsScenario({ name: 'date', command: 'date', observe: ['stdout', 'status'], meanings: [
    { given: [{ name: '-u' }, { name: '-d', value: '@0' }, { name: '-I', value: 'date' }], operands: [] },
    { given: [{ name: '-u' }, { name: '-d', value: '@0' }, { name: '-I', value: 'seconds' }], operands: [] },
    { given: [{ name: '-u' }, { name: '-d', value: '@0' }, { name: '-R' }], operands: [] },
  ] }),
  optionsScenario({ name: 'uniq', command: 'uniq', observe: ['stdout', 'status'], files: { f: 'a\nA\nb\nb\n' }, meanings: [
    { given: [{ name: '-c' }, { name: '-i' }], operands: ['f'] },
    { given: [{ name: '-d' }], operands: ['f'] },
    { given: [{ name: '-u' }, { name: '-i' }], operands: ['f'] },
  ] }),
];

// ---------------------------------------------------------------------------------------------------
// The forms, their keys and their runs.

/** The seed of the sample CI runs (test/normal-forms-gen.test.ts). */
export const SEED = 20261028;

export interface Form { scenario: Scenario; text: string }

/**
 * The forms of every scenario, `count` each (fewer where two spellings come out alike), from `seed`. A form whose tree
 * has an error, or whose subject the key would not read as the scenario means (a word split in two), is left out.
 */
export function generate(seed: number, count: number): Form[] {
  const rnd = random(seed);
  return SCENARIOS.flatMap((scenario) => {
    const seen = new Set<string>();
    return scenario.forms(rnd, count).filter((text) => {
      // (The alphabets hold no backquote, and no `(` where a `$` may come before it: no form runs a command of its own.
      // A `$[` may come, an arithmetic expansion of the old form, of variables that are unset or the run's own.)
      if (/\$\(|`/.test(text)) throw new Error(`a form that may run code: ${JSON.stringify(text)}`);
      if (seen.has(text)) return false;
      seen.add(text);
      const tree = parser.parse(text);
      if (hasError(tree.root)) return false;
      // (The word printed is one word: a space or a comment would make the key read another.)
      return scenario.name !== 'a word printed' || fields(subject(tree), 'argument').length === 2;
    }).map((text) => ({ scenario, text }));
  });
}

const rowOf = (s: Scenario, normalizer: Normalizer, forms: string[]): Row => ({ normalizer, same: forms, observe: s.observe, files: s.files, stdin: s.stdin, env: s.env, prelude: s.prelude, epilogue: s.epilogue });

/** A rule that takes a false merge: the forms it matches may run otherwise than the others of their key. */
export interface Accepted { normalizer: Normalizer; scenario: string; match: (form: string) => boolean; reason: string }

/**
 * Whether a word of the form's subject is a glob bash expands: a value that is not known, with an unquoted `*`, `?` or
 * `[` (`*.txt`, `*.tx""t`; not `'*'.txt`, whose value is known).
 */
const unquotedGlob = (form: string): boolean => fields(subject(parser.parse(form)), 'argument').some((w) => staticWordValue(w) === undefined
  && (w.type === 'concatenation' ? w.namedChildren : [w]).some((p) => p.type === 'word' && /(^|[^\\])(\\\\)*[*?[]/.test(p.text)));

/** The false merges taken, each with its reason (as the `known` rows of the table). */
export const ACCEPTED: Accepted[] = [
  { normalizer: 'findWords', scenario: 'find', match: unquotedGlob, reason: 'finding, left to its own PR (the `known` row of the table): find\'s expression is read from the text of a word whose value is not known, so `-name *.txt` is explained as find\'s pattern while bash expands the glob first when files match (only an unquoted glob: scripts/normal-forms-sweep.ts, seeds 1 to 3, finds no false merge of another word whose value is not known)' },
];

/** What a run gives for what the scenario observes, as one string. */
const observed = (r: Ran, what: readonly Observed[]): string => JSON.stringify(what.map((w) => (w === 'stdout' ? r.out : w === 'stderr' ? r.err : w === 'status' ? r.status : r.files)));

/** A key that says nothing about the form: such a form is a group of its own. */
const saysNothing = (key: string): boolean => /^\(.*\)$/s.test(key);

export interface Finding { scenario: string; normalizer: Normalizer; key: string; forms: { text: string; observed: string }[] }

export interface Result {
  /** Forms with one key that bash runs otherwise, that no rule of `ACCEPTED` takes. */
  falseMerges: Finding[];
  /** Forms with keys of their own that bash runs the same: one finding per observation, with a form of each key. */
  missedMatches: Finding[];
  /** The rules of `ACCEPTED` that took a false merge, by their index. */
  used: Set<number>;
  /** The forms run, the groups of one key that hold several forms, and those of each scenario and normalizer. */
  counts: { forms: number; groups: number; per: Record<string, number> };
}

/** Keys the forms, runs them in bash `program`, and compares. */
export async function check(program: string, forms: readonly Form[], jobs = 4): Promise<Result> {
  const ran = await runJobs(program, forms.map((f) => jobOf(rowOf(f.scenario, f.scenario.normalizers[0], [f.text]), f.text)), { jobs });
  const result: Result = { falseMerges: [], missedMatches: [], used: new Set(), counts: { forms: forms.length, groups: 0, per: {} } };
  for (const scenario of SCENARIOS) {
    const mine = forms.map((f, i) => ({ f, i })).filter(({ f }) => f.scenario === scenario);
    for (const normalizer of scenario.normalizers) {
      const row = rowOf(scenario, normalizer, mine.map(({ f }) => f.text));
      const byKey = new Map<string, { text: string; observed: string }[]>();
      for (const { f, i } of mine) {
        const key = keyOf(row, f.text);
        const k = saysNothing(key) ? `${key} ${f.text}` : key;
        if (!byKey.has(k)) byKey.set(k, []);
        byKey.get(k)!.push({ text: f.text, observed: observed(ran[i], scenario.observe) });
      }
      const per = `${scenario.name}, ${normalizer}`;
      result.counts.per[per] = 0;
      for (const [key, group] of byKey) {
        if (group.length > 1) result.counts.groups++, result.counts.per[per]++;
        const differs = (xs: typeof group): boolean => xs.some((x) => x.observed !== xs[0].observed);
        if (!differs(group)) continue;
        const rules = ACCEPTED.map((a, n) => ({ a, n })).filter(({ a }) => a.normalizer === normalizer && a.scenario === scenario.name);
        const left = group.filter((x) => !rules.some(({ a }) => a.match(x.text)));
        if (left.length && !differs(left) && group.some((x) => !left.includes(x))) {
          rules.filter(({ a }) => group.some((x) => a.match(x.text))).forEach(({ n }) => result.used.add(n));
          continue;
        }
        result.falseMerges.push({ scenario: scenario.name, normalizer, key, forms: group });
      }
      // (Missed matches: one form of each key, by what bash gave.)
      const byObserved = new Map<string, { key: string; text: string }[]>();
      for (const [key, group] of byKey) {
        for (const o of new Set(group.map((x) => x.observed))) {
          if (!byObserved.has(o)) byObserved.set(o, []);
          byObserved.get(o)!.push({ key, text: group.find((x) => x.observed === o)!.text });
        }
      }
      for (const [o, keys] of byObserved) {
        if (keys.length > 1) result.missedMatches.push({ scenario: scenario.name, normalizer, key: keys.map((k) => k.key).join(' | '), forms: keys.map((k) => ({ text: k.text, observed: o })) });
      }
    }
  }
  return result;
}

