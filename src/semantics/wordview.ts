// The one view of what bash makes of a word (docs/design/word-source.md, 3.2): its value, whether it is plain, the
// words of its brace expansion with their characters, how many fields it gives, the literal start of its first field
// and the end of its last, whether it globs, and what is not known and why. Words.ts stays the evaluator; this module
// reads it (`viewWords`, `wordFields`) and the field domain (`wordShapes`, src/semantics/fieldshape.ts), and decides
// nothing of its own. test/word-probes.test.ts holds it against bash.
import type { Shell } from '../dialect';
import { braceAlternatives } from './brace';
import { globby, holeOf, knownValues, misread, readsAsBash, type Shape, wordShapes, type WordShapes } from './fieldshape';
import type { SyntaxNode } from '../syntax/tree';
import { EMPTY, type ShellState } from './shellstate';
import type { StateModel } from './state';
import { type Applies, type Char, type Fields, type HoleOf, meaningIn, modelValues, type ValueSource, viewWords, type WalkSource, type WordEnv, wordFields, wordMeaning, type WordMeaning } from './words';

/** A word of the brace expansion of a word, as its view reads it (src/semantics/wordview.ts, `viewWords`). */
export interface ViewWord {
  /** As written, with the braces gone (`a{b,c}` gives `ab` and `ac`). */
  written: string;
  /**
   * Its characters before word splitting, a hole for each part whose value is not known (`Char.hole`), and the glob
   * characters of a field that pathname expansion takes as a pattern marked (`Char.pattern`); undefined where bash
   * fails on the word (`${x:?}` with `x` unset) or its text is not known.
   */
  chars?: Char[];
  /** The characters are as written: how bash quotes the characters of IFS in it is not known (`ownChars`; the IFS, POSIX mode or the shell). */
  asWritten?: true;
  /** Its fields after every step, where they are known (a pattern: with the files of the environment, `WordEnv.files`). */
  fields?: string[];
  /** Some field of it is a pattern that pathname expansion expands here (a hole for which `holeGlobs` holds: may be). */
  globs: Applies;
}

/**
 * What is not known of a word here: `value`, a part's value (a hole, `Char.hole`); `ifs`, the IFS where it splits;
 * `option`, an option that a step rests on (`set -f`, braceexpand, POSIX mode, on some paths only); `misread`, a word
 * the word model reads otherwise than bash or than the script's shell (`misread`, `readsAsBash`; `{,$x}a`); `too-many`,
 * more words of its brace expansion than are listed.
 */
export type Unknown = 'value' | 'ifs' | 'option' | 'misread' | 'too-many';

export interface WordView {
  /** Its context, steps, tildes, IFS and glob options (words.ts). */
  meaning: WordMeaning;
  /** Its one field where it is `plain`. */
  value?: string;
  /** Its value is known, and no step but quote removal changes the text: no brace, tilde, expansion, splitting or pattern. */
  plain: boolean;
  /** One per word of its brace expansion (one where braces do not apply); none where they are not known (`unknown`). */
  words: ViewWord[];
  /** How many fields it gives after every step (none where bash fails on it); `max` absent: no bound known. */
  count: { min: number; max?: number };
  /** The text its first field surely starts with, and its last ends with, where it gives one (`count.min` at least 1). */
  start?: string;
  end?: string;
  /** Some field is a pattern that pathname expansion expands here. */
  globs: Applies;
  /** The fields it may give, from the field domain, where they are not known exactly and the domain can say (`wordView` only). */
  shapes?: WordShapes;
  unknown: readonly Unknown[];
}

/** The view of the word that holds `n` where it runs in the finished model, with the environment `env` for what the script does not set (the probes'); undefined outside a word. */
export function wordView(n: SyntaxNode, model: StateModel, env?: WordEnv): WordView | undefined {
  const w = wordMeaning(n, model);
  if (!w) return undefined;
  const known = wordFields(n, model, env);
  const source = modelValues(w, model, env);
  return viewOf(w, source, env, known, known.fields || known.error ? undefined : wordShapes(n, model, knownValues(w, source)));
}

/** The view of the word that holds `n` in the state `st` of the walk, with its values (`source`); its count is known only where its fields are. */
export function wordViewIn(n: SyntaxNode, st: ShellState, source: WalkSource): WordView | undefined {
  const w = meaningIn(n, st, source.shell());
  return w && viewOf(w, source);
}

/**
 * The view of the word that holds `n` before or without a model: in the state of a script that sets nothing (the
 * default IFS, the options as the shell starts), where no value is known, and no command substitution either: it is
 * a hole, never empty (`$(:)echo`).
 */
export function wordViewAsWritten(n: SyntaxNode, shell?: Shell): WordView | undefined {
  return wordViewIn(n, EMPTY, { variable: () => undefined, tilde: () => undefined, builtinRuns: () => false, shell: () => shell });
}

function viewOf(w: WordMeaning, source: ValueSource, env?: WordEnv, known?: Fields, shapes?: WordShapes): WordView {
  const unknown = new Set<Unknown>();
  if (misread(w) || !readsAsBash(w)) unknown.add('misread');
  const hole: HoleOf = (part, quoted) => [{ text: '', quoted, expanded: !quoted, hole: holeOf(part, quoted, w) }];
  const got = viewWords(w, source, hole, globby, env);
  if (!got) unknown.add(w.steps[0].applies === 'unknown' ? 'option' : braceAlternatives(w.nodes, false, w.version) === null ? 'too-many' : 'misread');
  const words = got ?? [];
  if (words.some((x) => x.chars?.some((c) => c.hole))) unknown.add('value');
  const split = w.steps.find((s) => s.kind === 'split')!;
  if (w.ifs.kind === 'unknown' && split.applies !== false) unknown.add('ifs');
  if (w.steps.some((s) => s.applies === 'unknown' && s.why) || words.some((x) => x.asWritten && w.ifs.kind !== 'unknown')) unknown.add('option');
  const globs: Applies = words.some((x) => x.globs === true) ? true : !got || words.some((x) => x.globs === 'unknown') ? 'unknown' : false;
  const plain = words.length === 1 && globs === false && w.steps.every((s) => s.kind === 'quote-removal' || s.applies === false)
    && !!words[0].chars && !words[0].chars.some((c) => c.hole) && words[0].fields?.length === 1;
  // (The walk's view knows no error of the word: a redirection's target is one field there, or not known.)
  const each = got && words.every((x) => x.fields) ? words.flatMap((x) => x.fields!) : undefined;
  const exact = known ? (known.error ? [] : known.fields) : each && (w.rule.fields !== 'one-or-error' || each.length === 1) ? each : undefined;
  const ends = exact ? { count: { min: exact.length, max: exact.length }, ...(exact.length ? { start: exact[0], end: exact[exact.length - 1] } : {}) } : shapes ? fromShapes(shapes) : { count: { min: 0 } };
  return { meaning: w, ...(plain ? { value: words[0].fields![0] } : {}), plain, words, ...ends, globs, ...(shapes ? { shapes } : {}), unknown: [...unknown] };
}

/** The count, the start and the end that hold in every case of the field domain. */
function fromShapes(ws: WordShapes): Pick<WordView, 'count' | 'start' | 'end'> {
  let min = Infinity;
  let max: number | undefined = 0;
  let start: string | undefined;
  let end: string | undefined;
  const size = (s: Shape): { min: number; max?: number } => ('fields' in s ? { min: s.fields.length, max: s.fields.length } : s);
  for (const c of ws.cases) {
    const sizes = c.map(size);
    const least = sizes.reduce((t, s) => t + s.min, 0);
    min = Math.min(min, least);
    max = max === undefined || sizes.some((s) => s.max === undefined) ? undefined : Math.max(max, sizes.reduce((t, s) => t + s.max!, 0));
    if (!least) continue;
    start = common(start, edge(c, 'start'), (a, b) => a.startsWith(b), (s, k) => s.slice(0, k));
    end = common(end, edge([...c].reverse(), 'end'), (a, b) => a.endsWith(b), (s, k) => s.slice(s.length - k));
  }
  // (Every case failed: no field reaches the command.)
  if (min === Infinity) return { count: { min: 0, max: 0 } };
  return { count: { min, ...(max === undefined ? {} : { max }) }, ...(min > 0 ? { start: start!, end: end! } : {}) };
}

/**
 * The known start (or end) of the first (or last) field of the shapes `c` (in that order), which give one: the first
 * shape that may give a field decides, '' where it may also give none.
 */
function edge(c: readonly Shape[], side: 'start' | 'end'): string {
  const s = c.find((x) => !('fields' in x) || x.fields.length > 0)!;
  const f = 'fields' in s ? s.fields[side === 'start' ? 0 : s.fields.length - 1] : s.min > 0 ? s[side === 'start' ? 'first' : 'last'] : undefined;
  return f ? f.text ?? f[side] : '';
}

/** The longest text that both `a` (none yet: `b` itself) and `b` share at their start (or end), `holds` and `cut` saying which. */
function common(a: string | undefined, b: string, holds: (x: string, y: string) => boolean, cut: (s: string, k: number) => string): string {
  if (a === undefined) return b;
  let k = Math.min(a.length, b.length);
  while (k > 0 && !holds(a, cut(b, k))) k--;
  return cut(b, k);
}
