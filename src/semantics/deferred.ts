// The words of a builtin that the trust scan (src/semantics/trust.ts) reads as fields: where a builtin's words say what
// it sets or turns on (`set`, the declarations, `printf -v`…) and one of them has a value not known where it stands
// (`x=-e; set $x`), the scan reads it, once the whole script is read, as the fields each value the script writes to its
// variables makes of it (`Scan.readDeferred`). The fields come from the word model (`wordIn`), as the walk's do.
import type { ArgRole, ArgvParse } from '../argv/interpret';
import type { CommandSpec, OperandSpec } from '../argv/spec';
import { argWordFor } from '../argv/words';
import type { Shell } from '../dialect';
import { staticWordValue } from '../staticword';
import { descendants, type SyntaxNode, wordBraces } from '../syntax/tree';
import { builtinParse, builtinRead, DECLARATIONS, effectKey, namesByWords } from './effects';
import { EMPTY } from './shellstate';
import { type WalkSource, wordIn } from './words';
import type { WrittenValue } from './written';

/** A word whose value is not known where it stands: the variables it expands, and whether one of them is unquoted (so split). */
export interface DeferredWord { word: SyntaxNode; names: string[]; unquoted: boolean }

/** A builtin whose words the scan reads at the end: the command, its name, words and spec, where it is (`W`), and its words not known. */
export interface Deferred<W> { c: SyntaxNode; name: string; args: SyntaxNode[]; spec: CommandSpec; w: W; words: DeferredWord[] }

/** What a write gives a variable, as the scan reads it: a plain assignment (`x=w`), made with `+=`, of text known in full. */
interface WriteOf { plain: boolean; append?: true; value: WrittenValue }

/**
 * The readings of the words of `d` (`fieldReadings`) from the values the script writes to their variables (`writes`):
 * each text a plain assignment gives in full (`x=-e`), and none (also where it unsets it); undefined when a variable
 * may have another value (one the script does not write, `read x`, `x+=y`, `x=$y`), when one is split and the script
 * sets IFS (`ifs`). `expands`: whether a reading gives the builtin other than what the words as written give it
 * (`effectKey`); where none does (`fmt="%s\n"; [ -t 1 ] && fmt="%s"; printf "$fmt" a`), the walk reads them as
 * written. (A variable the walk does not trust, one bash changes or a nameref's target, is not known where the walk
 * reads the word: it walks again with nothing trusted.)
 */
export function deferredReadings(d: Deferred<unknown>, writes: (name: string) => readonly WriteOf[] | undefined, ifs: boolean, shell: Shell | undefined): { readings: ((n: SyntaxNode) => readonly string[] | undefined)[]; expands: boolean } | undefined {
  if (ifs && d.words.some((u) => u.unquoted)) return undefined;
  const values = new Map<string, (string | null)[]>();
  for (const name of d.words.flatMap((u) => u.names)) {
    const texts = new Set<string | null>([null]);
    for (const x of writes(name) ?? []) {
      if (x.value === 'none') continue;
      if (!x.plain || x.append || typeof x.value !== 'object' || !x.value.fixed) return undefined;
      texts.add(x.value.text);
    }
    if (texts.size === 1) return undefined;
    values.set(name, [...texts]);
  }
  // (A command of the same text with the same values reads the same: a script may repeat a line many times.)
  const key = JSON.stringify([shell ?? '', d.c.text, [...values]]);
  if (!known.has(key)) {
    /* c8 ignore next -- a guard on memory: no test reads so many commands that differ */
    if (known.size > KNOWN) known.clear();
    known.set(key, readingsOf(d, values, shell));
  }
  const found = known.get(key);
  if (!found) return undefined;
  const at = (fields: readonly (readonly string[])[]) => (n: SyntaxNode): readonly string[] | undefined => fields[d.words.findIndex((u) => u.word === n)];
  return { readings: found.lists.map(at), expands: found.expands };
}

/** The readings of commands already read (`deferredReadings`), by their text and the values of their variables. */
const known = new Map<string, { lists: (readonly string[])[][]; expands: boolean } | undefined>();
const KNOWN = 4096;

/**
 * The readings of the words of `d` with these values (`fieldReadings`), each as the fields of its words in turn, one
 * for each thing they give the builtin (`effectKey`), and whether one gives it other than the words as written.
 */
function readingsOf(d: Deferred<unknown>, values: ReadonlyMap<string, readonly (string | null)[]>, shell: Shell | undefined): { lists: (readonly string[])[][]; expands: boolean } | undefined {
  const readings = fieldReadings(d.words, values, shell);
  if (!readings) return undefined;
  // (The scan reads one reading of each key: what it takes of a reading is in the key.)
  const written = effectKey(d.name, d.spec, builtinRead(d.name, d.args, shell, d.spec), shell);
  const byKey = new Map<string, (readonly string[])[]>();
  for (const r of readings) {
    const k = effectKey(d.name, d.spec, builtinRead(d.name, d.args, shell, d.spec, r), shell);
    if (!byKey.has(k)) byKey.set(k, d.words.map((u) => r(u.word)!));
  }
  return { lists: [...byKey.values()], expands: [...byKey.keys()].some((k) => k !== written) };
}

/** The builtins whose words the scan reads as written, with handlers of their own (`Scan.builtinWords`). */
const AS_WRITTEN: ReadonlySet<string> = new Set(['eval', 'trap', 'alias', 'let', 'compgen', 'fc', 'enable', 'unset', 'shopt']);
/** How many readings of one builtin the scan makes from the values of its variables (`fieldReadings`). */
const READINGS = 16;

/** Whether the role `r` reads a word as a name the builtin declares, sets or acts on (`declare x`, `read x`). */
const naming = (r: ArgRole): boolean => r.role === 'operand' && [r.spec, r.otherwise, ...(r.each ?? [])].some((o?: OperandSpec) => !!o?.sets || !!o?.acts);

/**
 * Whether the word `j` of a builtin's line, read as written (`parse`), gives the builtin what it sets whatever its
 * fields are, with the words before it known: the value of an option that names nothing, which is one word in any case
 * (`read -p "$p" x`), or an operand after the first operand or `--` (bash's builtins read no option after them) with
 * every word from it on an operand that names nothing, so that a word it gives more or fewer of only moves those
 * (`printf "%s" "$a"`, `set -- "$a"`).
 */
function inert(parse: ArgvParse, args: readonly SyntaxNode[], j: number, shell: Shell | undefined): boolean {
  const at = parse.roles.find((r) => r.word === j)?.role;
  if (at?.role === 'value') return !at.spec?.sets && at.spec?.type !== 'function' && !argWordFor(shell)(args[j]).count;
  if (at?.role !== 'operand' || !parse.roles.some((r) => r.word < j && (r.role.role === 'operand' || r.role.role === 'end-of-options'))) return false;
  return parse.roles.every((r) => r.word < j || (r.role.role === 'operand' && !naming(r.role)));
}

/** Whether the expansion `e` is in double quotes within the word `word`. */
const quotedIn = (e: SyntaxNode, word: SyntaxNode): boolean => {
  for (let p = e.parent; p && p !== word.parent; p = p.parent) if (p.type === 'string') return true;
  return false;
};

/**
 * The words of `args` whose values are not known here, when the builtin `name` reads its words by its spec for what
 * it sets or turns on (`set`, a declaration, one whose options or operands name variables or functions:
 * `namesByWords`) and each is text and expansions of variables (`$x`, `"${x}"=1`, `{-e,-u}`). Undefined when there is
 * none, or one expands another parameter (`$1`, `${x:-y}`), and for a builtin that reads them as written
 * (`AS_WRITTEN`, `test`).
 */
export function unknownWords(name: string, spec: CommandSpec, args: readonly SyntaxNode[], shell: Shell | undefined): DeferredWord[] | undefined {
  if (AS_WRITTEN.has(name) || spec.operandParser === 'test-expression' || !(name === 'set' || DECLARATIONS.has(name) || namesByWords(spec))) return undefined;
  const out: DeferredWord[] = [];
  let parse: ArgvParse | undefined;
  for (const [j, a] of args.entries()) {
    if (a.type === 'variable_assignment' || staticWordValue(a, false, shell) !== undefined) continue;
    // (A word whose fields cannot change what the builtin sets is read as written: `printf "%s\n" "$m"`, as before.)
    if (!out.length && inert(parse ??= builtinParse(name, args, shell, spec), args, j, shell)) continue;
    const names: string[] = [];
    let unquoted = false;
    for (const e of descendants(a, ['simple_expansion', 'expansion'])) {
      const m = /^\$\{?([A-Za-z_]\w*)\}?$/.exec(e.text);
      if (!m) return undefined;
      names.push(m[1]);
      if (!quotedIn(e, a)) unquoted = true;
    }
    out.push({ word: a, names, unquoted });
  }
  return out.length ? out : undefined;
}

/**
 * The fields the words `words` may get, one reading for each set of values of their variables (`values`: those each
 * may have, `null` for unset), with brace expansion on and off where they have braces; undefined where a field is not
 * known (a glob, a tilde, a command substitution), or past `READINGS`.
 */
export function fieldReadings(words: readonly DeferredWord[], values: ReadonlyMap<string, readonly (string | null)[]>, shell: Shell | undefined): ((n: SyntaxNode) => readonly string[] | undefined)[] | undefined {
  const names = [...values.keys()];
  const braces = words.some((u) => wordBraces(u.word).length) ? [EMPTY, { ...EMPTY, set: EMPTY.set.with('braceexpand', 'off' as const) }] : [EMPTY];
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
