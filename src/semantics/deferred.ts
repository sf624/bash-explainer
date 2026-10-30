// The words of a builtin that the trust scan (src/semantics/trust.ts) reads as fields: where a builtin's words say what
// it sets or turns on (`set`, the declarations, `printf -v`…) and one of them has a value not known where it stands
// (`x=-e; set $x`), the scan reads it, once the whole script is read, as the fields each value bash may give its
// variables makes of it (`Scan.readDeferred`). A word read as written is trusted only where every value bash can give it
// there is one the scan read: where the scan cannot list them (`read x`, `$1`), it reads the words as written, and the
// walk checks the builtin where it runs it (`DeferredPlan`, `Trust.deferred`). The fields come from the word model
// (`wordIn`), as the walk's do.
import type { ArgRole, ArgvParse } from '../argv/interpret';
import type { CommandSpec, OperandSpec } from '../argv/spec';
import { argWordFor } from '../argv/words';
import type { Shell } from '../dialect';
import { staticWordValue, tildeParts, tildeSpots } from '../staticword';
import { descendants, type SyntaxNode, wordBraces } from '../syntax/tree';
import { builtinRead, DECLARATIONS, effectKey, namesByWords } from './effects';
import { EMPTY, type ShellState } from './shellstate';
import { type WalkSource, wordIn } from './words';

/**
 * A word whose value is not known where it stands: the variables it expands, whether one of them is unquoted (so
 * split), and whether it expands another parameter (`$1`, `"$@"`, `${x:-y}`), whose values the scan does not list
 * (`other`).
 */
export interface DeferredWord { word: SyntaxNode; names: string[]; unquoted: boolean; other: boolean }

/** A builtin whose words the scan reads at the end: the command, its name, words and spec, where it is (`W`), and its words not known. */
export interface Deferred<W> { c: SyntaxNode; name: string; args: SyntaxNode[]; spec: CommandSpec; w: W; words: DeferredWord[] }

/**
 * What the scan read of the words of a builtin not known where they stand (`deferredReadings`), for the walk
 * (`Trust.deferred`): it reads them as their fields where it knows them, and walks again with nothing trusted where
 * those give the builtin what no reading of the scan gave it.
 */
export interface DeferredPlan {
  /** The words whose fields may change what the builtin sets (one after them whose fields cannot is read as written). */
  readonly words: readonly SyntaxNode[];
  /** What the builtin is given (`effectKey`) by each reading the scan read (by the words as written, where it read none). */
  readonly keys: ReadonlySet<string>;
  /**
   * Whether the scan read every value bash may give the words (`valuesOf`, and none), and each gives the builtin what
   * the words as written give: the walk may then read them as written where their values are those the script wrote.
   */
  readonly written: boolean;
}

/** The fields of the words of a reading (undefined: a word read as written). */
export type FieldsOf = (n: SyntaxNode) => readonly string[] | undefined;

/**
 * The plan of the words of `d` (`DeferredPlan`), and the readings the scan reads, one for each thing they give the
 * builtin (`effectKey`). `valuesOf` gives every value bash may give a variable: the texts the script writes to it, and
 * none (undefined where it cannot list them: `Scan.valuesOf`). A word is read as the fields of each set of values
 * of its variables and of those before it (`fieldReadings`), unless its fields cannot change what the builtin sets in
 * any reading of the words before it (`inert`: `x=-v; printf $x u 2 "$a"` reads `$x` alone). Where a value is not
 * listed (`read x`, `$1`, `x=$y`), a word is split by an IFS the script sets (`ifs`), or past `READINGS`, the scan reads
 * the words as written, and the walk must know their fields where it runs the builtin.
 */
export function deferredReadings(d: Deferred<unknown>, valuesOf: (name: string) => readonly (string | null)[] | undefined, ifs: boolean, shell: Shell | undefined, posix: boolean): { plan: DeferredPlan; readings: FieldsOf[] } {
  const names = [...new Set(d.words.flatMap((u) => u.names))];
  // (A command of the same text with the same values reads the same: a script may repeat a line many times.)
  const key = JSON.stringify([shell ?? '', posix, ifs, d.c.text, names.map((name) => valuesOf(name) ?? 0)]);
  if (!known.has(key)) {
    /* c8 ignore next -- a guard on memory: no test reads so many commands that differ */
    if (known.size > KNOWN) known.clear();
    known.set(key, readingsOf(d, valuesOf, ifs, shell, posix));
  }
  const found = known.get(key)!;
  const at = (fields: readonly (readonly string[])[]): FieldsOf => (n) => fields[found.words.findIndex((k) => d.words[k].word === n)];
  return { plan: { words: found.words.map((k) => d.words[k].word), keys: found.keys, written: found.written }, readings: found.lists.map(at) };
}

/**
 * The readings of commands already read (`deferredReadings`), by their text and the values of their variables; words
 * by their place in `Deferred.words`. The key holds the text, the shell, POSIX mode, whether IFS is set and the values,
 * and nothing else: it takes the spec of a builtin to be the same in every bash version and with every host. (A host's
 * functions are not deferred: `Scan.command`.) A spec that comes to depend on them must go into the key.
 */
const known = new Map<string, { words: number[]; lists: (readonly string[])[][]; keys: ReadonlySet<string>; written: boolean }>();
const KNOWN = 4096;

/** The readings of the words of `d` (`deferredReadings`), each as the fields of its words in turn. */
function readingsOf(d: Deferred<unknown>, valuesOf: (name: string) => readonly (string | null)[] | undefined, ifs: boolean, shell: Shell | undefined, posix: boolean): { words: number[]; lists: (readonly string[])[][]; keys: ReadonlySet<string>; written: boolean } {
  const key = (fieldsOf?: FieldsOf): string => effectKey(d.name, d.spec, builtinRead(d.name, d.args, shell, d.spec, fieldsOf), shell);
  const written = key();
  const words: number[] = [];
  let readings: FieldsOf[] | undefined = [() => undefined];
  for (const [k, u] of d.words.entries()) {
    // (Once a value is not listed, where the words after it stand is not known: each is read as its fields.)
    if (readings && words.length && readings.every((r) => inertAfter(d, r, u.word, shell))) continue;
    words.push(k);
    if (!readings) continue;
    const chosen = words.map((j) => d.words[j]);
    const values = new Map<string, readonly (string | null)[]>();
    for (const name of chosen.flatMap((w) => w.names)) {
      const v = valuesOf(name);
      if (v) values.set(name, v);
    }
    readings = u.other || (ifs && u.unquoted) || u.names.some((name) => !values.has(name)) ? undefined : fieldReadings(chosen, values, shell, posix);
  }
  if (!readings) return { words, lists: [], keys: new Set([written]), written: false };
  // (The scan reads one reading of each key: what it takes of a reading is in the key.)
  const byKey = new Map<string, (readonly string[])[]>();
  for (const r of readings) {
    const k = key(r);
    if (!byKey.has(k)) byKey.set(k, words.map((j) => r(d.words[j].word)!));
  }
  return { words, lists: [...byKey.values()], keys: new Set(byKey.keys()), written: [...byKey.keys()].every((k) => k === written) };
}

/** Whether the word `word` of `d` is `inert` where the words before it have the fields of the reading `r` (the others as written). */
function inertAfter(d: Deferred<unknown>, r: FieldsOf, word: SyntaxNode, shell: Shell | undefined): boolean {
  const read = builtinRead(d.name, d.args, shell, d.spec, r);
  const k = Array.from({ length: read.size }, (_, j) => j).find((j) => read.node(j) === word)!;
  return inert((more) => (more ? builtinRead(d.name, d.args, shell, d.spec, r, more).parse : read.parse), d.spec, k, word, shell);
}

/** The builtins whose words the scan reads as written, with handlers of their own (`Scan.builtinWords`). */
const AS_WRITTEN: ReadonlySet<string> = new Set(['eval', 'trap', 'alias', 'let', 'compgen', 'fc', 'enable', 'unset', 'shopt']);
/** How many readings of one builtin the scan makes from the values of its variables (`fieldReadings`). */
const READINGS = 16;

/** Whether the role `r` reads a word as a name the builtin declares, sets or acts on (`declare x`, `read x`). */
const naming = (r: ArgRole): boolean => r.role === 'operand' && [r.spec, r.otherwise, ...(r.each ?? [])].some((o?: OperandSpec) => !!o?.sets || !!o?.acts);

/**
 * Whether the word `word`, the `j`th of a builtin's line (`parseWith(0)`: as written, or with the fields of words
 * before it), gives the builtin what it sets whatever its fields are, with the words before it known:
 * - the value of an option that names nothing, as one word in any case (`read -p "$p" x`);
 * - an operand after an operand or `--` (bash's builtins read no option after them), with every word from it on an
 *   operand that names nothing. Where it may give more fields than one, the words after it move on, also to places past the
 *   words written (`parseWith(n)`: with `n` words more): none of those may name one either (`getopts -- $o` with `o='v
 *   u'` sets `u`). So a word it gives more or fewer of only moves operands that name nothing (`printf "%s" "$a"`, `set
 *   -- "$a"`).
 */
function inert(parseWith: (more: number) => ArgvParse, spec: CommandSpec, j: number, word: SyntaxNode, shell: Shell | undefined): boolean {
  const parse = parseWith(0);
  const at = parse.roles.find((r) => r.word === j)?.role;
  const one = !argWordFor(shell)(word).count;
  if (at?.role === 'value') return !at.spec?.sets && at.spec?.type !== 'function' && one;
  if (at?.role !== 'operand') return false;
  if (!parse.roles.some((r) => r.word < j && (r.role.role === 'operand' || r.role.role === 'end-of-options'))) return false;
  const slots = 1 + Math.max(0, ...(spec.operands ?? []).map((o) => o.pattern.length));
  return (one ? parse : parseWith(slots)).roles.every((r) => r.word < j || (r.role.role === 'operand' && !naming(r.role)));
}

/** Whether the word `w` expands something: a parameter, a substitution, braces or a tilde. */
const expands = (w: SyntaxNode): boolean => descendants(w, EXPANSIONS).length > 0 || wordBraces(w).length > 0 || tildeSpots(tildeParts([w]), 'start').length > 0;
const EXPANSIONS = ['simple_expansion', 'expansion', 'command_substitution', 'arithmetic_expansion', 'process_substitution'];

/** Whether the expansion `e` is in double quotes within the word `word`. */
const quotedIn = (e: SyntaxNode, word: SyntaxNode): boolean => {
  for (let p = e.parent; p && p !== word.parent; p = p.parent) if (p.type === 'string') return true;
  return false;
};

/**
 * The words of `args` whose values are not known here, when the builtin `name` reads its words by its spec for what
 * it sets or turns on (`set`, a declaration, one whose options or operands name variables or functions:
 * `namesByWords`): the variables each expands (`$x`, `"${x}"=1`; `{-e,-u}` none), and whether it expands another
 * parameter (`$1`, `${x:-y}`). Undefined when there is none, and for a builtin that reads them as written
 * (`AS_WRITTEN`, `test`).
 */
export function unknownWords(name: string, spec: CommandSpec, args: readonly SyntaxNode[], shell: Shell | undefined): DeferredWord[] | undefined {
  if (AS_WRITTEN.has(name) || spec.operandParser === 'test-expression' || !(name === 'set' || DECLARATIONS.has(name) || namesByWords(spec))) return undefined;
  const out: DeferredWord[] = [];
  for (const [j, a] of args.entries()) {
    // (A word that expands nothing is a glob at most, which the model takes as matching no file: `declare a[1]`.)
    if (a.type === 'variable_assignment' || staticWordValue(a, false, shell) !== undefined || !expands(a)) continue;
    // (A word whose fields cannot change what the builtin sets is read as written: `printf "%s\n" "$m"`, as before.)
    if (!out.length && inert((more) => builtinRead(name, args, shell, spec, undefined, more).parse, spec, j, a, shell)) continue;
    const names: string[] = [];
    let unquoted = false;
    let other = false;
    for (const e of descendants(a, ['simple_expansion', 'expansion'])) {
      const m = /^\$\{?([A-Za-z_]\w*)\}?$/.exec(e.text);
      if (m) names.push(m[1]);
      else other = true;
      if (!quotedIn(e, a)) unquoted = true;
    }
    out.push({ word: a, names, unquoted, other });
  }
  return out.length ? out : undefined;
}

/**
 * The fields the words `words` may get, one reading for each set of values of their variables (`values`: those each
 * may have, `null` for unset), with brace expansion on and off where they have braces; undefined where a field is not
 * known (a glob, a tilde, a command substitution), or past `READINGS`. `posix`: the shell starts in POSIX mode.
 */
export function fieldReadings(words: readonly DeferredWord[], values: ReadonlyMap<string, readonly (string | null)[]>, shell: Shell | undefined, posix: boolean): FieldsOf[] | undefined {
  const names = [...values.keys()];
  // (In the POSIX mode bash starts in, `command declare a=$v` splits `$v`.)
  const start: ShellState = posix ? { ...EMPTY, set: EMPTY.set.with('posix', 'on' as const) } : EMPTY;
  const braces = words.some((u) => wordBraces(u.word).length) ? [start, { ...start, set: start.set.with('braceexpand', 'off' as const) }] : [start];
  if (names.reduce((n, name) => n * values.get(name)!.length, braces.length) > READINGS) return undefined;
  const out = new Map<string, Map<SyntaxNode, readonly string[]>>();
  const each = (k: number, chosen: Map<string, string | null>): boolean => {
    if (k < names.length) return values.get(names[k])!.every((v) => each(k + 1, new Map(chosen).set(names[k], v)));
    const source: WalkSource = { variable: (name) => chosen.get(name), tilde: () => undefined, builtinRuns: () => false, shell: () => shell };
    for (const st of braces) {
      const fields = new Map<SyntaxNode, readonly string[]>();
      for (const u of words) {
        const f = wordIn(u.word, st, source, 'fields', true);
        if (!f) return false;
        fields.set(u.word, f);
      }
      out.set(JSON.stringify([...fields.values()]), fields);
    }
    return true;
  };
  if (!each(0, new Map())) return undefined;
  return [...out.values()].map((fields) => (n: SyntaxNode) => fields.get(n));
}
