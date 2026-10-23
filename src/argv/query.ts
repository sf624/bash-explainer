// Questions about an `ArgvParse` (src/argv/interpret.ts): which options are given, their values, the operands.
// Readers of a command's words (the examples, the dialect check) ask these instead of reading the words again,
// so that a value is never taken for an option (`grep -e -v`), nor an option's letter for another (`sed -ie`).
import type { ArgRole, ArgvParse, ValueRole } from './interpret';

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
