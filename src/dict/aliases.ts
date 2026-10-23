import { shellFromName } from '../dialect';
import { builtins } from './builtins';
import { commands } from './commands';
import type { CommandSpec } from '../argv/spec';

/**
 * The one table of command aliases: a program that uses another program's spec, with the words it implies
 * (`egrep` is `grep -E`). Everything that treats `egrep` as grep (the spec lookup, the regex dialect, the
 * example runner) reads it through `aliasOf`, `canonicalName` and `impliedWords`.
 */
export interface CommandAlias { as: string; implies?: string[] }

export const commandAliases: Record<string, CommandAlias> = {
  egrep: { as: 'grep', implies: ['-E'] },
  fgrep: { as: 'grep', implies: ['-F'] },
  gawk: { as: 'awk' },
  mawk: { as: 'awk' },
  nawk: { as: 'awk' },
  python: { as: 'python3' },
};

/** The alias a program name is (`/usr/bin/egrep` too), or undefined. */
export function aliasOf(name: string): CommandAlias | undefined {
  const base = name.slice(name.lastIndexOf('/') + 1);
  return Object.prototype.hasOwnProperty.call(commandAliases, base) ? commandAliases[base] : undefined;
}

/** The command whose spec `name` uses (`egrep` → `grep`); the name itself when it is no alias. */
export function canonicalName(name: string): string {
  return aliasOf(name)?.as ?? name;
}

/** The words an alias adds in front of its arguments (`egrep` → `-E`). */
export function impliedWords(name: string): string[] {
  return aliasOf(name)?.implies ?? [];
}

/**
 * The spec of a command name: a builtin, `/bin/kill` (a path runs the program of a builtin's name), a command,
 * an alias of the table, or a shell other than bash (`dash`, `zsh`, `ksh93`, `mksh`…: the name mapping of
 * dialect.ts) that takes the options of `sh`. `busybox` is no shell by itself: its applet is its first argument.
 */
export function lookupCommand(name: string): CommandSpec | undefined {
  if (Object.prototype.hasOwnProperty.call(builtins, name)) return builtins[name];
  const base = name.includes('/') ? name.slice(name.lastIndexOf('/') + 1) : name;
  if (base !== name && Object.prototype.hasOwnProperty.call(builtins, base) && builtins[base].program) return builtins[base].program;
  if (Object.prototype.hasOwnProperty.call(commands, base)) return commands[base];
  const alias = aliasOf(base);
  if (alias) return commands[alias.as];
  if (base !== 'busybox' && shellFromName(base)) return commands.sh;
  return undefined;
}
