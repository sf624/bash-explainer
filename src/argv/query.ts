// Questions about an `ArgvParse` (src/argv/interpret.ts): which options are given, their values, the operands.
// Readers of a command's words (the examples, the dialect check) ask these instead of reading the words again,
// so that a value is never taken for an option (`grep -e -v`), nor an option's letter for another (`sed -ie`).
import type { ArgRole, ArgvParse, ValueRole } from './interpret';
import type { Shell } from '../dialect';
import type { CommandSpec, NameSpace, OperandSpec, VariableAct } from './spec';

type OptionRole = Extract<ArgRole, { role: 'option' }>;
type UnknownOptionRole = Extract<ArgRole, { role: 'unknown-option' }>;

/** An option given in the parse, with the index of its word. */
export interface GivenOption { word: number; role: OptionRole | UnknownOptionRole }

/** An operand, with the index of its word. */
export interface GivenOperand { word: number; role: Extract<ArgRole, { role: 'operand' }> }

/** Where a value of an option is: its word, and where it starts in that word when it is in the option's word (`-n5`, `--file=x`). */
export interface GivenValue { word: number; at?: number; role: ValueRole }

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
