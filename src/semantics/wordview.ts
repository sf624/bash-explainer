// The one view of what bash makes of a word (docs/design/word-source.md, 3.2): its value, whether it is plain, the
// words of its brace expansion with their characters, how many fields it gives, the literal start of its first field
// and the end of its last, whether it globs, and what is not known and why. Words.ts stays the evaluator; this module
// reads it (`viewWords`, `wordFields`) and the field domain (`wordShapes`, src/semantics/fieldshape.ts), and decides
// nothing of its own. test/word-probes.test.ts holds it against bash.
import type { Shell } from '../dialect';
import { changesIfs, globby, holeOf, knownValues, misread, readsAsBash, type Shape, shapesOf, wordShapes, type WordShapes } from './fieldshape';
import { braceAlternatives } from './brace';
import { descendants, type SyntaxNode } from '../syntax/tree';
import { decodedText } from '../staticword';
import { EMPTY, type ShellState } from './shellstate';
import type { StateModel } from './state';
import { assignmentHead, declaredWord } from './wordcontexts';
import { optionsOf, type WordOptions } from './wordoptions';
import { type Applies, type Char, type Fields, type HoleOf, meaningIn, modelValues, PLAIN_TEXT, type ValueSource, viewWords, type WalkSource, type WordEnv, wordFields, wordMeaning, type WordMeaning, wordOf } from './words';

/** A word of the brace expansion of a word, as its view reads it (src/semantics/wordview.ts, `viewWords`). */
export interface ViewWord {
  /** As written, with the braces gone (`a{b,c}` gives `ab` and `ac`). */
  written: string;
  /**
   * Its characters before word splitting, a hole for each part whose value is not known (`Char.hole`), and the special
   * characters of a field that is a pattern marked (`Char.pattern`): one pathname expansion takes as a pattern, or one
   * the context matches as a pattern or a regex (`case`, `[[ == ]]`, `${x#p}`, `[[ =~ ]]`); undefined where bash fails
   * on the word (`${x:?}` with `x` unset) or its text is not known.
   */
  chars?: Char[];
  /** The characters are as written, since how bash quotes the characters of IFS in it is not known (`ownChars`), and why: the IFS, POSIX mode (`option`), or a shell that may not be bash (`misread`). */
  asWritten?: 'ifs' | 'option' | 'misread';
  /** Its fields after every step, where they are known (a pattern: with the files of the environment, `WordEnv.files`). */
  fields?: string[];
  /** Some field of it is a pattern that pathname expansion expands here (a hole for which `holeGlobs` holds: may be). */
  globs: Applies;
  /** Its own text before its first expansion, hole or pattern character (`leadOf`): the start of each of its fields; '' where its characters are not known. */
  lead: string;
}

/**
 * What is not known of a word here: `value`, a part's value (a hole, `Char.hole`); `ifs`, the IFS where it splits;
 * `option`, an option that a step rests on (`set -f`, braceexpand, POSIX mode, on some paths only); `misread`, a word
 * the word model reads otherwise than bash or than the script's shell (`misread`, `readsAsBash`; `{,$x}a`; an array or
 * a subscript given to a declaration builtin, which it reads itself); `too-many`, more words of its brace expansion
 * than are listed.
 */
export type Unknown = 'value' | 'ifs' | 'option' | 'misread' | 'too-many';

export interface WordView {
  /** Its context, steps, tildes, IFS and glob options (words.ts). */
  meaning: WordMeaning;
  /** Its one field where it is `plain`: `WordMeaning.value`, the one source of a word's literal value. */
  value?: string;
  /**
   * The field its one word gives where pathname expansion leaves it as it is (no file matches it, with nullglob and
   * failglob off) or does not apply: `value` where it is plain, else the characters of a pattern after quote removal
   * (`*.txt`, `"a"*` gives `a*`, `[a-z]`). None where another step (a brace, a tilde, an expansion) changes the word,
   * where a part is not known, or where the context matches it itself (`case`, `[[ == ]]`: no field; `value` where
   * plain). What a command reads as a text in its own language (a regex, a glob, a tr set) gets this.
   */
  unmatched?: string;
  /**
   * Its value is known (`WordMeaning.value`), and no step but quote removal changes the text: no brace, tilde,
   * expansion, splitting or pathname expansion, and no character the context matches as a pattern or a regex.
   */
  plain: boolean;
  /** One per word of its brace expansion (one where braces do not apply); none where they are not known (`unknown`). */
  words: ViewWord[];
  /** How many fields it gives after every step (none where bash fails on it); `max` absent: no bound known. */
  count: { min: number; max?: number };
  /** The text its first field surely starts with, and its last ends with, where it gives one (`count.min` at least 1). */
  start?: string;
  end?: string;
  /** Some field is a pattern that pathname expansion expands here (a pattern a context matches is `Char.pattern` with `meaning.rule.match`). */
  globs: Applies;
  /**
   * The text every field it gives starts with, where it gives one, whatever its parts not known give: its own text before
   * the first of them that the words of its brace expansion share (`leadIn`; also where it may give none: `-v$x`; and in
   * a shell that may read the rest otherwise: `-d$'\t'` under `#!/bin/sh`). The interpreter's start of a word that may
   * give several fields (src/argv/words.ts).
   */
  lead?: string;
  /** The fields it may give, from the field domain, where they are not known exactly and the domain can say. */
  shapes?: WordShapes;
  unknown: readonly Unknown[];
}

/**
 * The view of the word that holds `n` where it runs in the finished model, with the environment `env` for what the
 * script does not set (the probes'); undefined outside a word. Its field domain takes a value read as arithmetic to be
 * a number, as the explanations do (`$((n-1))` is one field; `y='IFS=1'; $((y+10))` gives two, F89).
 */
export function wordView(n: SyntaxNode, model: StateModel, env?: WordEnv): WordView | undefined {
  const w = wordMeaning(n, model);
  if (!w) return undefined;
  // (Made once per word of the model, `wordMeaning` being: the view with an environment of the probes is made afresh.)
  const kept = env ? undefined : views.get(w);
  if (kept) return kept;
  const known = wordFields(n, model, env);
  const source = modelValues(w, model, env);
  const view = viewOf(w, source, (v) => wordView(v, model, env)!, env, known, () => wordShapes(n, model, knownValues(w, source), { numbers: true }));
  if (!env) views.set(w, view);
  return view;
}

/** The views of the finished model's words, by their meaning (`wordMeaning` keeps one per word and model). */
const views = new WeakMap<WordMeaning, WordView>();

/**
 * `unmatched` of the view of the word that holds `n` in the finished model, for a reader that needs only that: a word
 * another step changes has none (`throughGlobOnly`), so its fields and their domain are not worked out for it.
 */
export function unmatchedOf(n: SyntaxNode, model: StateModel): string | undefined {
  const w = wordMeaning(n, model);
  if (!w || (w.value === undefined && !declaredWord(w, w.steps[0].applies) && !throughGlobOnly(w))) return undefined;
  return wordView(n, model)!.unmatched;
}

/** No step but quote removal and pathname expansion applies to the word `w`. */
const throughGlobOnly = (w: WordMeaning): boolean => w.steps.every((s) => s.kind === 'quote-removal' || s.kind === 'glob' || s.applies === false);

/**
 * The view of the word that holds `n` in the state `st` of the walk, with its values (`source`): where its fields are
 * not known, its count, start and end come from the field domain with the values `source` knows (`shapesOf`).
 */
export function wordViewIn(n: SyntaxNode, st: ShellState, source: WalkSource): WordView | undefined {
  const w = meaningIn(n, st, source.shell());
  return w && viewOf(w, source, (v) => wordViewIn(v, st, source)!, undefined, undefined, () => shapesOf(w, knownValues(w, source)));
}

/**
 * The view of the word that holds `n` before or without a model: in the state of a script that sets nothing (the
 * default IFS, the options as the shell starts), where no value is known, and no command substitution either: it is
 * a hole, never empty (`$(:)echo`). Made once per node and shell: the walk reads a builtin's words each time it runs it.
 */
export function wordViewAsWritten(n: SyntaxNode, shell?: Shell): WordView | undefined {
  // (Kept by the shell's name, as the cache of each script's shell.)
  const key = String(shell);
  let kept = writtenViews.get(n);
  if (!kept) writtenViews.set(n, (kept = new Map()));
  if (!kept.has(key)) kept.set(key, wordViewIn(n, EMPTY, asWritten(shell)));
  return kept.get(key);
}

const writtenViews = new WeakMap<SyntaxNode, Map<string, WordView | undefined>>();

/** The values of a script that sets nothing (`wordViewAsWritten`); `builtinRuns`, the names that run their builtin in a command substitution (none). */
const asWritten = (shell: Shell | undefined, builtinRuns: (name: string) => boolean = () => false): WalkSource => ({ variable: () => undefined, tilde: () => undefined, builtinRuns, shell: () => shell });

/** `value` of the view of the word that holds `n` in the finished model (`wordView`), for a reader that needs only that: a word with no value in its meaning has none, and costs nothing more. */
export function valueOf(n: SyntaxNode, model: StateModel): string | undefined {
  const w = wordMeaning(n, model);
  return w && mayHaveValue(w) ? wordView(n, model)!.value : undefined;
}

/** Whether the view of the word `w` may have a value: `WordMeaning.value` has one, or it is an assignment given to a declaration builtin, whose value is its value word's. */
const mayHaveValue = (w: WordMeaning): boolean => w.value !== undefined || !!declaredWord(w, w.steps[0].applies);

/**
 * `value` of the view of the word that holds `n` in the state `st` of the walk (`wordViewIn`), for a reader that needs
 * only that. A word with no value in its meaning has none; the value of one that has rests on the options of the state
 * alone (no part of the word has a value there, but a substitution that prints nothing where its name runs the
 * builtin), so it is worked out once per word and options (`optionsOf`).
 */
export function valueIn(n: SyntaxNode, st: ShellState, source: WalkSource): string | undefined {
  // (Most words are text as written, whatever the state: read at once.)
  const text = textAsWritten(n);
  if (text !== undefined) return text;
  const w = meaningIn(n, st, source.shell());
  if (!w) return undefined;
  // (An assignment given to a declaration builtin, `export A=$x`: its head, then the value of its value's word, as the view has it.)
  const declared = declaredWord(w, w.steps[0].applies);
  if (declared === 'unread') return undefined;
  if (declared) {
    const inner = declared.value ? valueIn(declared.value, st, source) : '';
    return inner === undefined ? undefined : declared.head + inner;
  }
  if (w.value === undefined) return undefined;
  // (A substitution that prints nothing, `$(:)`, does so where its name runs the builtin, which the state says: read each time.)
  if (w.steps.some((s) => s.kind === 'command' && s.applies !== false)) return plainValue(w, source);
  let byOptions = values.get(w.nodes[0]);
  if (!byOptions) values.set(w.nodes[0], (byOptions = new WeakMap()));
  const key = optionsOf(st, source.shell());
  let kept = byOptions.get(key);
  if (!kept) byOptions.set(key, (kept = { value: plainValue(w, source) }));
  return kept.value;
}

const values = new WeakMap<SyntaxNode, WeakMap<WordOptions, { value: string | undefined }>>();

/**
 * The value of the word `n` where bash takes it as it is written (`PLAIN_TEXT`, words.ts), read at once: its text; and
 * of a word that is one single-quoted string, `'*'`: the text in it, which no step reads in any context or shell. (No
 * such word is read as a regex, where `.` is special: the right side of `[[ =~ ]]` is a `regex` node.)
 */
export function textAsWritten(n: SyntaxNode): string | undefined {
  const quoted = n.type === 'raw_string';
  if (!quoted && ((n.type !== 'word' && n.type !== 'number') || !PLAIN_TEXT.test(n.text))) return undefined;
  return wordOf(n)?.nodes[0] === n ? (quoted ? decodedText(n).slice(1, -1) : n.text) : undefined;
}

/**
 * `value` of the view of the word that holds `n` before or without a model (`wordViewAsWritten`): what bash gives a
 * word whose value is known as written, never a command substitution's (`$(:)echo` has none), but where `builtinRuns`
 * says that its name runs the builtin (the trust scan, which reads the whole script: `$(true)` prints nothing).
 */
export const valueAsWritten = (n: SyntaxNode, shell?: Shell, builtinRuns?: (name: string) => boolean): string | undefined => valueIn(n, EMPTY, asWritten(shell, builtinRuns));

/**
 * Each value the word that holds `n` may give as written, where braces may expand or not (the trust scan reads the
 * whole script, which may run `set +B`): the field of each word of its brace expansion, then its value with braces as
 * text (`declare a={x,}`: `a=x`, `a=`, then `a={x,}`); its value alone where the brace step does not apply. Undefined
 * for one not known (`valueAsWritten`, with `builtinRuns` as there).
 */
export function valuesAsWritten(n: SyntaxNode, shell?: Shell, builtinRuns?: (name: string) => boolean): (string | undefined)[] {
  const source = asWritten(shell, builtinRuns);
  if (meaningIn(n, EMPTY, shell)!.steps[0].applies === false) return [valueIn(n, EMPTY, source)];
  const words = wordViewIn(n, EMPTY, source)!.words;
  return [...(words.length ? words.map((x) => (x.fields?.length === 1 ? x.fields[0] : undefined)) : [undefined]), valueIn(n, NO_BRACES, source)];
}

/** A script that sets nothing but `set +B` (`valuesAsWritten`). */
const NO_BRACES: ShellState = { ...EMPTY, set: EMPTY.set.with('braceexpand', 'off') };

/**
 * The view of the word `w`, read with `source`; `again`, the view of another word in the same way (the value of an
 * assignment given to a declaration builtin); `known`, its fields (`wordFields`), and `shapes`, the field domain, for
 * the finished model.
 */
function viewOf(w: WordMeaning, source: ValueSource, again: (n: SyntaxNode) => WordView, env?: WordEnv, known?: Fields, shapes?: () => WordShapes | undefined): WordView {
  // (An assignment given to a declaration builtin, `export A=$x`: its head as written, then the view of its value, as `wordFields` reads it.)
  const declared = declaredWord(w, w.steps[0].applies);
  // (An array or a subscript is one word the builtin reads itself: `declare -a b=(1 2)`, `local c[$i]=1`, `declare -a e=({1,2})`.
  // Not where braces are not known to apply, nor `declare d[{1,2}]=x`, which bash expands into two: docs/backlog-archive.md.)
  if (declared === 'unread') return { meaning: w, plain: false, words: [], count: assignmentHead(w) === 'unread' ? { min: 1, max: 1 } : { min: 0 }, globs: 'unknown', unknown: ['misread'] };
  if (declared) return declarationView(w, declared.head, declared.value && again(declared.value), known);
  const unknown = new Set<Unknown>();
  if (misread(w) || !readsAsBash(w)) unknown.add('misread');
  const got = viewWords(w, source, holeIn(w), globby, env);
  if (typeof got === 'string') unknown.add(got);
  const words = got === 'misread' ? rejoinedWords(w) : typeof got === 'string' ? [] : got;
  for (const x of words) {
    if (x.chars?.some((c) => c.hole)) unknown.add('value');
    if (x.asWritten) unknown.add(x.asWritten);
  }
  const split = w.steps.find((s) => s.kind === 'split')!;
  if (w.ifs.kind === 'unknown' && split.applies !== false) unknown.add('ifs');
  if (w.steps.some((s) => s.applies === 'unknown' && s.why)) unknown.add('option');
  const globs: Applies = typeof got === 'string' ? 'unknown' : globsOf(got);
  const plain = isPlain(w, words, globs);
  const unmatched = plain ? w.value : unmatchedText(w, words);
  // (The walk's view knows no error of the word: a redirection's target is one field there, or not known.)
  const each = words.length && words.every((x) => x.fields) ? words.flatMap((x) => x.fields!) : undefined;
  const exact = known ? (known.error ? [] : known.fields) : each && (w.rule.fields !== 'one-or-error' || each.length === 1) ? each : undefined;
  // (Nor its field domain, which knows no error of the word either.)
  // (Words whose every part is quoted give one field each, with no need of the domain; in a shell that may read them
  // otherwise, their characters, read as bash reads them, tell no start or end.)
  // (Their start is their own text before the first part not known, `lead`, which another shell reads as bash does too.)
  const lead = leadIn(w, words, got);
  const quoted = !exact && (w.rule.fields !== 'one-or-error' || words.length === 1) && quotedWords(words) ? (readsAsBash(w) && !misread(w) ? (w.ifs.kind === 'default' ? quotedEnds(words) : undefined) : { count: { min: words.length, max: words.length }, start: lead!, end: '' }) : undefined;
  const domain = exact || quoted || (!known && w.rule.fields === 'one-or-error') ? undefined : shapes?.();
  // (Words of braces not read, `{,$x}a`: one field at least of each that has text of its own, unless nullglob may remove
  // it; with braces on some paths only, one where the word has text of its own, as one word or as words of braces.)
  const fewest = w.glob.nullglob !== 'off' ? 0 : got === 'misread' ? words.filter((x) => x.lead).length : got === 'option' && lead ? 1 : 0;
  const ends = exact ? exactEnds(exact) : quoted ?? (domain ? fromShapes(domain) : { count: { min: fewest }, ...(fewest ? { start: lead!, end: '' } : {}) });
  return { meaning: w, ...(plain ? { value: w.value } : {}), ...(unmatched !== undefined ? { unmatched } : {}), plain, words, ...ends, ...(lead !== undefined ? { lead } : {}), globs, ...(domain ? { shapes: domain } : {}), unknown: [...unknown] };
}

/**
 * The text every field of the word `w` starts with, where it gives one (`WordView.lead`): the own text before the first
 * part not known that its words share (`ViewWord.lead`; of words of braces not read, `{,$x}a`, `rejoinedWords`), or,
 * where braces apply on some paths only, the text as written before the first brace or other part that its words of
 * braces share (`braceAlternatives`). '' where the word may change the IFS itself, which may split its own text (`a1b$((IFS=1))`).
 */
function leadIn(w: WordMeaning, words: readonly ViewWord[], got: ViewWord[] | string): string | undefined {
  if (changesIfs(w)) return '';
  const leads = words.length ? words.map((x) => x.lead) : got === 'option' ? (braceAlternatives(w.nodes) ?? []).map(writtenLead) : [];
  return leads.length ? shared(leads) : undefined;
}

/**
 * The words of braces whose words bash reads otherwise than their parts say (`rejoined`: `{,$x}a` gives `a` and `$xa`):
 * each with its text as written before its first part (`writtenLead`), and no characters, which are not known.
 */
const rejoinedWords = (w: WordMeaning): ViewWord[] => braceAlternatives(w.nodes, false, w.version)!.map((a) => ({ written: a.map((p) => (typeof p === 'string' ? p : p.text)).join(''), globs: 'unknown', lead: writtenLead(a) }));

/** The text a word of braces has before its first part, where that is text with no quote, escape, expansion or pattern in it. */
const writtenLead = (parts: readonly (SyntaxNode | string)[]): string => {
  const first = typeof parts[0] === 'string' ? parts[0] : '';
  let k = 0;
  while (k < first.length && !NOT_LITERAL.has(first[k])) k++;
  return first.slice(0, k);
};
const NOT_LITERAL = new Set(['\\', "'", '"', '$', '`', '*', '?', '[', '~', '@', '!', '+', '(', '{']);

/** The longest text that all of `texts` start with. */
function shared(texts: readonly string[]): string {
  let k = 0;
  while (k < texts[0].length && texts.every((t) => t[k] === texts[0][k])) k++;
  return texts[0].slice(0, k);
}

/** What a part not known gives in the view of the word `w`: a hole of its kind (fieldshape.ts, `holeOf`). */
const holeIn = (w: WordMeaning): HoleOf => (part, quoted) => [{ text: '', quoted, expanded: !quoted, hole: holeOf(part, quoted, w) }];

/** Whether some word of a brace expansion globs (`ViewWord.globs`). */
const globsOf = (words: readonly ViewWord[]): Applies => (words.some((x) => x.globs === true) ? true : words.some((x) => x.globs === 'unknown') ? 'unknown' : false);

/**
 * Whether the view of the word `w`, of the words `words`, is plain (`WordView.plain`). A word with a value has no step
 * but quote removal, or the substitutions that print nothing, `$(:)`, which leave a hole where the name may not run the
 * builtin, and give no field alone, unquoted.
 */
const isPlain = (w: WordMeaning, words: readonly ViewWord[], globs: Applies): boolean =>
  w.value !== undefined && words.length === 1 && globs === false && !!words[0].chars && !words[0].chars.some((c) => c.hole || c.pattern) && words[0].fields?.length !== 0;

/** `value` of the view of the word `w` (`viewOf`), worked out alone: its words and whether they are plain, for a reader that asks only that. */
function plainValue(w: WordMeaning, source: ValueSource): string | undefined {
  const got = viewWords(w, source, holeIn(w), globby);
  return typeof got !== 'string' && isPlain(w, got, globsOf(got)) ? w.value : undefined;
}

/**
 * The field of the one word `words` of `w` where no step but quote removal and pathname expansion applies, pathname
 * expansion leaves a pattern that matches no file as it is, and the context gives fields: its characters, with no hole
 * (`WordView.unmatched`).
 */
function unmatchedText(w: WordMeaning, words: readonly ViewWord[]): string | undefined {
  const glob = w.steps.find((s) => s.kind === 'glob')!;
  if (w.rule.match || words.length !== 1 || !words[0].chars || words[0].asWritten || words[0].chars.some((c) => c.hole)) return undefined;
  if (!throughGlobOnly(w)) return undefined;
  if (glob.applies !== false && (w.glob.nullglob !== 'off' || w.glob.failglob !== 'off')) return undefined;
  return words[0].chars.map((c) => c.c).join('');
}

/**
 * Whether every word of a brace expansion has characters, only quoted parts, none a pattern nor `"$@"`, and characters
 * whose quoting is known (an empty word of `{$e,"$y"}` gives none): each gives one field, in every shell (`"$f"`, `"-v$x"`; `"$a[1].b"` in zsh, which reads `$a[1]` as an
 * element). With the IFS as the shell starts: bash 5.2 splits some of them where IFS holds a control character.
 */
const quotedWords = (words: readonly ViewWord[]): boolean =>
  words.length > 0 && words.every((x) => x.chars?.length && !x.asWritten && x.globs === false && x.chars.every((c) => !c.split && (!c.hole || (c.hole.quoted && c.hole.kind !== 'elements'))));

/** The count, the start and the end of quoted words (`quotedWords`): the text before the first hole of the first, and after the last of the last. */
function quotedEnds(words: readonly ViewWord[]): Pick<WordView, 'count' | 'start' | 'end'> {
  const first = words[0].chars!;
  const last = words[words.length - 1].chars!;
  const text = (cs: readonly Char[]): string => cs.map((c) => c.c).join('');
  const hole = first.findIndex((c) => c.hole);
  let after = last.length - 1;
  while (after >= 0 && !last[after].hole) after--;
  return { count: { min: words.length, max: words.length }, start: text(hole < 0 ? first : first.slice(0, hole)), end: text(last.slice(after + 1)) };
}

/** The count, the start and the end of fields known exactly. */
const exactEnds = (fields: readonly string[]): Pick<WordView, 'count' | 'start' | 'end'> => ({ count: { min: fields.length, max: fields.length }, ...(fields.length ? { start: fields[0], end: fields[fields.length - 1] } : {}) });

/**
 * The view of an assignment given to a declaration builtin (`declaredWord`): `head`, its name and `=` as written, before
 * each field of the view of its value (`inner`; none for `x=`, which gives `head` alone). It is plain where its value
 * is, and its value is the head before the value's (`WordMeaning.value` of the value's word, the one source).
 */
function declarationView(w: WordMeaning, head: string, inner: WordView | undefined, known?: Fields): WordView {
  const headChars = (): Char[] => [...head].map((c) => ({ c, quoted: false, split: false }));
  if (!inner) return { meaning: w, value: head, unmatched: head, plain: true, words: [{ written: head, chars: headChars(), fields: [head], globs: false, lead: head }], ...exactEnds([head]), globs: false, unknown: [] };
  const words = inner.words.map((x) => ({ ...x, written: head + x.written, ...(x.chars ? { chars: [...headChars(), ...x.chars] } : {}), ...(x.fields ? { fields: x.fields.map((f) => head + f) } : {}) }));
  const exact = known ? (known.error ? [] : known.fields) : undefined;
  const ends = exact ? exactEnds(exact) : { count: inner.count, ...(inner.start !== undefined ? { start: head + inner.start, end: inner.end } : {}) };
  return { meaning: w, ...(inner.plain ? { value: head + inner.value } : {}), ...(inner.unmatched !== undefined ? { unmatched: head + inner.unmatched } : {}), plain: inner.plain, words, ...ends, globs: inner.globs, ...(inner.shapes ? { shapes: inner.shapes } : {}), unknown: inner.unknown };
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
