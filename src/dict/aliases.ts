import { type Shell, shellFromName } from '../dialect';
import { tx, type Text } from '../i18n';
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
  const shell = base === 'busybox' ? undefined : shellFromName(base);
  if (shell === 'bash') return commands.bash;
  if (shell) return shellSpec(shell);
  return undefined;
}

/** What each shell other than bash and sh is, for the summary of its spec (the options are those of `sh`). */
const SHELL_SUMMARIES: Partial<Record<Shell, Text>> = {
  dash: tx('dash（小さな POSIX シェル。Debian や Ubuntu の `sh`）を起動する', 'Run dash, a small POSIX shell (`sh` on Debian and Ubuntu)'),
  ash: tx('busybox の ash（小さな POSIX シェル）を起動する', 'Run busybox ash, a small POSIX shell'),
  yash: tx('yash（POSIX に忠実なシェル）を起動する', 'Run yash, a shell that follows POSIX closely'),
  ksh: tx('Korn シェル（ksh93）を起動する', 'Run the Korn shell (ksh93)'),
  mksh: tx('Korn シェルの一つ（mksh・pdksh の仲間）を起動する', 'Run a Korn shell of the pdksh line (mksh, pdksh, oksh)'),
  zsh: tx('Z シェル（zsh）を起動する', 'Run the Z shell (zsh)'),
};
const shellSpecs = new Map<Shell, CommandSpec>();

/** The spec of a shell other than bash: the options of `sh`, with a summary of its own (zsh is no POSIX shell). */
function shellSpec(shell: Shell): CommandSpec {
  const summary = SHELL_SUMMARIES[shell];
  if (!summary) return commands.sh;
  let spec = shellSpecs.get(shell);
  if (!spec) shellSpecs.set(shell, (spec = { ...commands.sh, summary }));
  return spec;
}
