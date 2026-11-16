// Whether a command refuses its line, as the argument interpreter reads it (src/argv/interpret.ts): the one fact
// `ArgvParse.refused`, which every consumer reads (the line's note, src/explain/refused.ts; the examples, which run
// nothing for such a line; the readings of embedded languages). The spec states each refusal (src/argv/spec.ts: `Refused`).
import type { ArgRole, ArgWord, RoleAt, ValueRole } from './interpret';
import type { CommandSpec, OperandSpec, OptionSpec, Refused } from './spec';
import type { UntilRefusal } from './until';

/**
 * The tool refuses its command line and does nothing (docs/design/three-levels.md: a usage error, every time it runs). `at`:
 * the word at fault, among the words the parse read (none where nothing given is: `cut f` gives no list). Where the spec
 * knows it, what the tool prints and its exit status (`Refused`, `%s` replaced by the word); not for find's `-exec` without
 * its end, whose fact gives its own text (`until`), nor for env's string it cannot split (`split`), whose value's token says it.
 */
export type Refusal = { at?: number; unlessInforms?: true } & (
  /**
   * An option that selects another mode than `after`, the first one given (`grep -E -F`), or a second one with `once`
   * (`cut -b1 -c1`; `again`: the same option, `cut -f1 -f2`).
   */
  | ({ kind: 'modes'; option: string; after: string; again?: true } & Refused)
  /** The value of `option`, which the tool refuses (`cut -d ab`, `head -n x`). */
  | ({ kind: 'value'; option: string; value: string } & Refused)
  /** No option selects a mode (`cut f`): `options` are those that would, as written in the spec (`-b`, `-c`, `-f`). */
  | ({ kind: 'needs'; options: string[] } & Refused)
  /** An operand past those the tool takes, or (`as`) one alone where it needs two (`tr a`), or one it refuses for its text. */
  | ({ kind: 'operand'; operand: string; as?: 'alone' | 'operand' } & Refused)
  /** The command of an option with `until` does not end as the tool needs (`find . -exec rm {} ;`). */
  | { kind: 'until'; until: UntilRefusal & { option: string } }
  /** The value env splits into words is wrong (`env -S'"a'`): `ValueRole.refused` says why. */
  | { kind: 'split' }
);

/** What the interpreter knows of a command's line besides its roles, for `refusalOf`. */
export interface RefusalInput {
  spec: CommandSpec;
  roles: readonly RoleAt[];
  words: readonly ArgWord[];
  /** The first refused command of an option with `until`, with the index of the option's word. */
  until?: UntilRefusal & { option: string; at: number };
}

/**
 * The refusal of a line, if the tool refuses it whatever the values not known here (section 4 of three-levels.md: only
 * what holds whatever the input), and the first one the tool reports: GNU's tools check an option as they read it (in the
 * order of the words: a mode, a value), then, once they have read every option, that a mode is given, the values they
 * check late (cut's lists) and the operands.
 *
 * A word that may be anything (its text not known, or it may give no word or several: `"$o"`, `$o`, `"$@"`, `*.txt`)
 * may be an option, `--` or `-e`, unless it comes after `--` (an operand then) or is an option's value: before the word at
 * fault, it keeps the refusal unknown (`grep "$o" -E -F` runs with `o=--`); after it, it changes nothing for a check made as
 * the option is read, which comes first (`grep -E -F "$x"`, `cut -d ab -f1 "$f"`). A value checked once the options are read
 * (cut's lists) is refused after it unless the word is an option that prints and exits (`--help`): the refusal is then
 * `unlessInforms`, and no example runs it, but the line says nothing (`cut -f 0 "$f"`). That a mode is given, and the
 * operands, hold only where no word may be anything. An option the spec does not know, or one that prints and exits,
 * before the word at fault (anywhere, for a late check), keeps the refusal unknown, or gone.
 */
export function refusalOf({ spec, roles, words, until }: RefusalInput): Refusal | undefined {
  if (until) return { kind: 'until', at: until.at, until: { why: until.why, option: until.option, ...(until.word === undefined ? {} : { word: until.word }), ...(until.wordAt === undefined ? {} : { wordAt: until.wordAt }) } };
  let mode: { name: string; flag: string; spec: OptionSpec } | undefined;
  let late: Refusal | undefined;
  let found: Refusal | undefined;
  // (The first word that may be an option, `--` or `-e`; whether an option that prints and exits, or one not known, comes first.)
  let openAt: number | undefined;
  let informs = false;
  let ended = false;
  const visit = (word: number, r: ArgRole): void => {
    if (r.role === 'cluster' || r.role === 'old-style') return r.letters.forEach((l) => visit(word, l));
    if (r.role === 'end-of-options') ended = true;
    const w = words[word];
    if (!ended && (w.count !== undefined || (r.role !== 'value' && w.value === undefined))) openAt ??= word;
    if (openAt !== undefined || found) return;
    if (r.role === 'unknown-option' || (r.role === 'option' && r.spec.informs)) {
      informs = true;
      openAt = word;
      return;
    }
    if (r.role === 'option' && r.spec.selects && spec.conflictingModes) {
      const said = !mode ? undefined : mode.name !== r.spec.selects ? spec.conflictingModes : spec.conflictingModes.once;
      if (said) found = { kind: 'modes', at: word, option: r.flag, after: mode!.flag, ...(mode!.spec === r.spec ? { again: true as const } : {}), ...refused(said, r.flag) };
      mode ??= { name: r.spec.selects, flag: r.flag, spec: r.spec };
    }
    // (An option's own value is in its word: `attached` is where it starts.)
    if (r.role === 'option' && r.value) value(r.value, word, w.value?.slice(r.value.attached!), r.flag);
    if (r.role === 'value') value(r, word, w.value, r.of);
  };
  const value = (v: ValueRole, word: number, text: string | undefined, option: string): void => {
    if (v.refused) { found ??= { kind: 'split', at: word }; return; }
    const why = text !== undefined ? v.spec?.refuses?.(text) : undefined;
    if (!why) return;
    const { late: isLate, ...said } = why;
    const r: Refusal = { kind: 'value', at: word, option, value: text!, ...refused(said, text!) };
    if (!isLate) found ??= r;
    else late ??= r;
  };
  for (const { word, role } of roles) visit(word, role);
  // (The tool reports it as it reads the option, before any word after it: `grep -E -F --help` is refused.)
  if (found) return found;
  if (informs) return undefined;
  // (A later word that may be an option is `--help` at most: nothing runs, but the line says nothing.)
  if (late) return openAt === undefined ? late : { ...late, unlessInforms: true };
  if (openAt !== undefined) return undefined;
  if (spec.needsMode && !roles.some(({ role }) => selects(role))) {
    const options = spec.options!.filter((o) => o.selects).map((o) => o.names[0]);
    return { kind: 'needs', options, ...refused(spec.needsMode) };
  }
  // (The operands: each word known, and one word.)
  if (!roles.every(({ word }) => words[word].value !== undefined && words[word].count === undefined)) return undefined;
  // (Not find's late path, `knownOnly`: its expression's operators, `(` and `!`, are no options here, so the parse cannot tell a path.)
  const extra = roles.find(({ role }) => role.role === 'operand' && role.spec?.extra && !role.spec.extra.knownOnly);
  if (!extra) return undefined;
  const operand = words[extra.word].value!;
  const { as, ...said } = (extra.role as { spec: OperandSpec }).spec.extra!;
  return { kind: 'operand', at: extra.word, operand, ...(as ? { as } : {}), ...refused(said, operand) };
}

/** Whether a role is, or holds, an option that selects a mode. */
function selects(r: ArgRole): boolean {
  if (r.role === 'cluster' || r.role === 'old-style') return r.letters.some(selects);
  return r.role === 'option' && !!r.spec.selects;
}

/** What the spec says the tool prints, with the word at fault in its `%s`. */
function refused({ says, status, bare, also, gnu, why, impl, ref }: Refused, word?: string): Refused {
  return {
    says: word === undefined ? says : says.replace('%s', word), status, ...(bare ? { bare } : {}), ...(also ? { also } : {}), ...(gnu ? { gnu } : {}), ...(why ? { why } : {}),
    ...(impl ? { impl } : {}), ...(ref ? { ref } : {}),
  };
}

/**
 * Whether the command reads the word `w` (one of the `words` the parse read) in no language of its own (src/embedded/): it
 * refuses the line before it reads it, as the word at fault; or the line, by options of different modes, whatever the
 * word (`grep -E -F`: no flavour).
 */
export function readInNoLanguage<W>(r: Refusal | undefined, words: readonly W[], w: W): boolean {
  return !!r && (r.kind === 'modes' || (r.at !== undefined && words[r.at] === w));
}
