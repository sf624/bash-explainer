// Questions about an `ArgvParse` (src/argv/interpret.ts): which options are given, their values, the operands.
// Readers of a command's words (the examples, the dialect check) ask these instead of reading the words again,
// so that a value is never taken for an option (`grep -e -v`), nor an option's letter for another (`sed -ie`).
import type { ArgRole, ArgvParse, ValueRole } from './interpret';
import type { Shell } from '../dialect';
import type { CommandSpec, NameSpace, OperandSpec, OptionSpec, VariableAct } from './spec';

type OptionRole = Extract<ArgRole, { role: 'option' }>;
type UnknownOptionRole = Extract<ArgRole, { role: 'unknown-option' }>;

/** An option given in the parse, with the index of its word. */
export interface GivenOption { word: number; role: OptionRole | UnknownOptionRole }

/** An operand, with the index of its word. */
export interface GivenOperand { word: number; role: Extract<ArgRole, { role: 'operand' }> }

/** Where a value of an option is: its word, and where it starts in that word when it is in the option's word (`-n5`, `--file=x`). */
export interface GivenValue { word: number; at?: number; role: ValueRole }

/**
 * Whether a word of the parse, or of a command it runs, is read as its fields with a role other than an operand's (an
 * option, a value, the end of options, a command: `FieldsRole`, `x='-n 3'; head $x f`). The readers that take the words
 * as written (the examples) do not see those roles, so they give nothing then.
 */
export function readsFields(parse: ArgvParse): boolean {
  return parse.roles.some(({ role }) => (role.role === 'fields' ? role.roles.some((r) => r.role.role !== 'operand')
    : (role.role === 'subcommand' || role.role === 'command') && !!role.parse && readsFields(role.parse)));
}

/**
 * The options given at this level of the parse (not those of a subcommand or a command it runs), in order: one per
 * option, the letters of a cluster (`-rn`) and of old-style letters (`tar cvf`) each on its own.
 */
export function givenOptions(parse: ArgvParse): GivenOption[] {
  const out: GivenOption[] = [];
  for (const { word, role } of parse.roles) {
    for (const r of role.role === 'cluster' || role.role === 'old-style' ? role.letters : [role]) {
      if (r.role === 'option' || r.role === 'unknown-option') out.push({ word, role: r });
    }
  }
  return out;
}

/**
 * The words read as regular expressions that match inside longer text too (`grep "$USER"` finds `bobby` for `bob`):
 * operands and values in `lang: 'regex'`, where the command reads them so. None where the parse is refused, or an
 * option given or implied (`implied`: by the command's name, `fgrep`) reads them as fixed strings (the mode `fixed`,
 * `OptionSpec.selects`) or matches only whole words or lines (`OptionSpec.whole`: `-w`, `-x`).
 */
export function regexWords(parse: ArgvParse, implied: readonly OptionSpec[]): number[] {
  const specs = [...givenOptions(parse).map(({ role }) => (role.role === 'option' ? role.spec : undefined)), ...implied];
  if (parse.refused || parse.mode === 'fixed' || specs.some((o) => o?.selects === 'fixed' || o?.whole)) return [];
  return parse.roles.flatMap(({ word, role }) => ((role.role === 'operand' || role.role === 'value') && role.spec?.lang === 'regex' ? [word] : []));
}

/**
 * The options given before the value in word `word`, when its option reads it at once (`ValueSpec.inOrder`: sed
 * compiles each `-e` script as it reads it, with the options given so far); undefined when every option given
 * applies to it (another value, an operand).
 */
export function optionsBefore(parse: ArgvParse, word: number): GivenOption[] | undefined {
  const at = parse.roles.find((r) => r.word === word)?.role;
  if (at?.role === 'value') return at.spec?.inOrder ? givenOptions(parse).filter((g) => g.word < word) : undefined;
  // (In the option's word, the letters before it count too: `-Ee 's/a+/x/'`, `-Ees/a+/x/`.)
  const letters: (ArgRole | undefined)[] = at?.role === 'cluster' ? at.letters : [at];
  const owner = letters.findIndex((r) => r?.role === 'option' && r.value?.attached !== undefined && r.value.spec?.inOrder);
  if (owner < 0) return undefined;
  return givenOptions(parse).filter((g) => g.word < word || (g.word === word && letters.indexOf(g.role) < owner));
}

/**
 * The modes that the options given select (`OptionSpec.selects`: grep's `-E`, sed's `-E`); for the text in word `word`,
 * only those of the options that apply to it (`optionsBefore`: `sed -e 's/a+/x/' -E` reads its script in no mode).
 */
export function selectedModes(parse: ArgvParse, word?: number): Set<string> {
  const options = (word === undefined ? undefined : optionsBefore(parse, word)) ?? givenOptions(parse);
  return new Set(options.flatMap(({ role }) => (role.role === 'option' && role.spec.selects ? [role.spec.selects] : [])));
}

/**
 * The values given before word `word` that the program reads as soon as it reads their option (`ValueSpec.inOrder`):
 * an option in `word` does not apply to them (`sed -e 's/a+/x/' -E`: not to the script).
 */
export function readBefore(parse: ArgvParse, word: number): GivenValue[] {
  const out: GivenValue[] = [];
  for (const { word: w, role } of parse.roles) {
    if (w >= word) continue;
    if (role.role === 'value') {
      if (role.spec?.inOrder) out.push({ word: w, role });
      continue;
    }
    for (const r of role.role === 'cluster' ? role.letters : [role]) {
      if (r.role === 'option' && r.value?.attached !== undefined && r.value.spec?.inOrder) out.push({ word: w, at: r.value.attached, role: r.value });
    }
  }
  return out;
}

/** The option's flag with a dash, as its spec names it (`-x` for `+x`; old-style letters keep theirs). */
const flagOf = (role: OptionRole | UnknownOptionRole): string => (role.flag.startsWith('+') ? '-' + role.flag.slice(1) : role.flag);

/** Whether a given option is one of `names`: the spec's names of the option, or its flag when the spec does not know it. */
const named = (role: OptionRole | UnknownOptionRole, names: readonly string[]): boolean =>
  role.role === 'option' ? role.spec.names.some((n) => names.includes(n)) : names.includes(flagOf(role));

/**
 * Whether the option that `names` name is given and turned on, however it is written: any of its names, a
 * prefix of a long name where the spec allows one, or a letter of a cluster (`-vx`). `set +x` turns `-x` off.
 */
export function has(parse: ArgvParse, ...names: string[]): boolean {
  return givenOptions(parse).some(({ role }) => named(role, names) && !(role.role === 'option' && role.disables));
}

/** The values given to the option that `names` name, in order: in the option's word (`-efoo`) or in the words after it. */
export function values(parse: ArgvParse, ...names: string[]): GivenValue[] {
  const out: GivenValue[] = [];
  for (const { word, role } of parse.roles) {
    if (role.role === 'value') {
      if (role.option ? role.option.names.some((n) => names.includes(n)) : names.includes(role.of)) out.push({ word, role });
      continue;
    }
    for (const r of role.role === 'cluster' ? role.letters : [role]) {
      if ((r.role === 'option' || r.role === 'unknown-option') && r.value && named(r, names)) out.push({ word, at: r.value.attached, role: r.value });
    }
  }
  return out;
}

/**
 * Whether a restricted shell refuses this call of a builtin (`CommandSpec.restricted`), and the word bash names in its
 * message (`.: ./f: restricted`, `command: -p: restricted`; none in `cd: restricted`). Undefined when it does not, or
 * may not: a file whose name is known only at run time (`words`: the values of the words, undefined when not known).
 */
export function restrictedRefusal(spec: CommandSpec, parse: ArgvParse, words: readonly (string | undefined)[]): { word?: string } | undefined {
  const r = spec.restricted;
  if (!r) return undefined;
  const option = r.options && givenOptions(parse).find(({ role }) => named(role, r.options!));
  // (An option missing its value is a usage error first: `enable -f`.)
  if ((r.options && (!option || (option.role as { missing?: boolean }).missing)) || (r.unless && has(parse, ...r.unless))) return undefined;
  if (r.command && !parse.roles.some(({ role }) => role.role === 'command' || role.role === 'operand')) return undefined;
  // (`popd +1` removes an entry below the top, and does not change directory.)
  if (r.unlessWord && parse.roles.some(({ role }) => role.role === 'pattern-option' && r.unlessWord!.test(role.flag))) return undefined;
  if (r.slash) {
    const value = r.slash === 'operand' ? undefined : values(parse, r.slash)[0];
    const at = r.slash === 'operand' ? operands(parse)[0]?.word : value?.word;
    const file = at === undefined ? undefined : words[at]?.slice(value?.at ?? 0);
    return file?.includes('/') ? { word: file } : undefined;
  }
  return r.namesOption ? { word: flagOf(option!.role) } : {};
}

/** The operands, in order, with their roles; with `name`, only those the spec gives that name (`ARG2`). */
export function operands(parse: ArgvParse, name?: string): GivenOperand[] {
  const out: GivenOperand[] = [];
  for (const { word, role } of parse.roles) {
    if (role.role === 'operand' && (name === undefined || role.spec?.name === name)) out.push({ word, role });
  }
  return out;
}

/**
 * What the names of an operand of `type: 'variable'` with `acts` stand for in the parse, by the options its `names`
 * lists (src/argv/spec.ts `NameOptions`): a variable, a function, the name reference itself; `either`, the variable if
 * there is one, else the function (`unset NAME`); `none`, the options conflict and the builtin acts on no name
 * (`unset -fv`).
 */
export function namespaceOf(parse: ArgvParse, item: OperandSpec): NameSpace | 'either' | 'none' {
  // (Every operand that `acts` lists its names.)
  const names = item.names!;
  if (names.exclusive?.every((f) => has(parse, f))) return 'none';
  for (const [flag, space] of names.options) if (has(parse, flag)) return space;
  return names.orFunction ? 'either' : 'variable';
}

/** An operand that names what a builtin declares or unsets (`OperandSpec.acts`), with its word and what its names stand for. */
export interface ActedName { word: number; acts: VariableAct; space: NameSpace | 'either' | 'none' }

/** The operands of the parse that name what the builtin declares or unsets (`declare x`, `unset -f f`), in order. */
export function actedNames(parse: ArgvParse): ActedName[] {
  return parse.roles.flatMap(({ word, role }) => (role.role === 'operand' && role.spec?.acts ? [{ word, acts: role.spec.acts, space: namespaceOf(parse, role.spec) }] : []));
}

/** Whether a builtin works only in a function in `shell` (undefined: bash), and fails outside one (`CommandSpec.scope`). */
export function onlyInFunction(spec: CommandSpec, shell: Shell | undefined): boolean {
  return !!spec.scope && !spec.scope.except.includes(shell ?? 'bash');
}

/** Whether a command's operands name what it acts on (`OperandSpec.acts`; `act`: only that act): `declare x`, `unset x`. */
export function actsOnNames(spec: CommandSpec, act?: VariableAct): boolean {
  return !!spec.operands?.some((o) => o.pattern.some((p) => (act ? p.acts === act : !!p.acts)));
}

/** Whether a command's operands declare names (`OperandSpec.acts`): the declaration builtins (`declare`, `local`, `export`…). */
export const declaresNames = (spec: CommandSpec): boolean => actsOnNames(spec, 'declares');

/**
 * Whether the command reads the script it runs from its standard input, under the alternative its operands fit
 * (`OperandAlt.stdin`): `bash`, `sh -s -- a`, `bash -` (`-` names the standard input); not `bash file`, `bash -c '…'`,
 * nor a script named by a word whose value is not known (`bash "$f"`). `words`: the values of the words, when known.
 */
export function readsScriptFromStdin(spec: CommandSpec, parse: ArgvParse, words: readonly (string | undefined)[]): boolean {
  if (parse.alternative === undefined || spec.operands![parse.alternative].stdin !== 'script') return false;
  return !operands(parse).some(({ word, role }) => role.spec?.io === 'run' && words[word] !== '-');
}

/**
 * Where the command writes what it downloads (`CommandSpec.downloads`): its standard output, or a file; undefined when
 * it downloads nothing. The last value of an option with `io: 'write'` decides (`curl -o f`, `wget -qO-`); a value not
 * known (`-o "$out"`) is taken for a file. `words`: the values of the words, when known.
 */
export function downloadsTo(spec: CommandSpec, parse: ArgvParse, words: readonly (string | undefined)[]): 'stdout' | 'file' | undefined {
  const d = spec.downloads;
  if (!d) return undefined;
  if (has(parse, ...d.elsewhere)) return 'file';
  let to = d.to;
  for (const { word, at, role } of givenValues(parse)) {
    if (role.spec?.io === 'write') to = words[word]?.slice(at ?? 0) === '-' ? 'stdout' : 'file';
  }
  return to;
}

/** Every value given to an option in the parse, in order: in the option's word (`-ofile`) or in the words after it. */
function givenValues(parse: ArgvParse): GivenValue[] {
  const out: GivenValue[] = [];
  for (const { word, role } of parse.roles) {
    if (role.role === 'value') out.push({ word, role });
    for (const r of role.role === 'cluster' ? role.letters : [role]) {
      if ((r.role === 'option' || r.role === 'unknown-option') && r.value) out.push({ word, at: r.value.attached, role: r.value });
    }
  }
  return out;
}
