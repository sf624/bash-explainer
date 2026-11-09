import * as fs from 'fs';
import * as path from 'path';
import type { Shell, ShellReading } from '../../src/dialect';
import type { RealShell } from '../../src/shellfeatures';

/** A file that says `shell` (from its shebang), as `readShell` reads it; undefined when it says none. */
export function said(shell: Shell | undefined): ShellReading | undefined {
  return shell ? { shell, source: 'shebang' } : undefined;
}

/** Where a program is: in $BASH_EXPLAINER_SHELLS (a directory) or on PATH, by the first of `names` found. */
export function locate(names: readonly string[]): string | undefined {
  const dirs = [process.env.BASH_EXPLAINER_SHELLS, ...(process.env.PATH ?? '').split(':')].filter(Boolean) as string[];
  for (const n of names) for (const d of dirs) if (fs.existsSync(path.join(d, n))) return path.join(d, n);
  return undefined;
}

/**
 * The shells of the dialect table (src/shellfeatures.ts, `LETTER`): the programs that run each, and the arguments before a `-c` or a
 * script's file that start it with no startup file of the user's (busybox runs its ash as `busybox sh`).
 */
export const SHELLS: readonly { shell: RealShell; letter: string; bins: readonly string[]; args: readonly string[] }[] = [
  { shell: 'bash', letter: 'b', bins: ['bash'], args: ['--norc'] },
  { shell: 'dash', letter: 'd', bins: ['dash'], args: [] },
  { shell: 'ash', letter: 'a', bins: ['busybox'], args: ['sh'] },
  { shell: 'yash', letter: 'y', bins: ['yash'], args: [] },
  { shell: 'ksh', letter: 'k', bins: ['ksh93', 'ksh'], args: [] },
  { shell: 'mksh', letter: 'm', bins: ['mksh'], args: [] },
  { shell: 'zsh', letter: 'z', bins: ['zsh'], args: ['-f'] },
];
