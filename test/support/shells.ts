import type { Shell, ShellReading } from '../../src/dialect';

/** A file that says `shell` (from its shebang), as `readShell` reads it; undefined when it says none. */
export function said(shell: Shell | undefined): ShellReading | undefined {
  return shell ? { shell, source: 'shebang' } : undefined;
}
