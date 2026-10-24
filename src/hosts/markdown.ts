import { detectShell, type Shell, shellFromName } from '../dialect';
import { Builder } from './builder';

export function markdown(b: Builder): void {
  for (let i = 0; i < b.lines.length; i++) {
    const open = /^(\s*)(`{3,}|~{3,})\s*([\w-]+)?/.exec(b.lines[i]);
    if (!open) continue;
    const fence = open[2];
    const lang = (open[3] ?? '').toLowerCase();
    let j = i + 1;
    const close = (l: string) => l.trim().startsWith(fence[0].repeat(fence.length)) && !l.trim().slice(fence.length).trim();
    // `sh` and `shell` mostly mean "shell code" (GitHub colours them like bash), so they are bash, not POSIX sh;
    // a shebang or `# shellcheck shell=` line in the block wins over every tag.
    const fenceShell: Shell | undefined | null = lang === 'posix' ? 'sh' : ['sh', 'bash', 'shell', 'shellscript', 'console', 'shellsession', 'terminal'].includes(lang) ? 'bash' : lang === 'zsh' || lang === 'ksh' || lang === 'dash' ? shellFromName(lang)! : null;
    const prompts = ['console', 'shellsession', 'terminal'].includes(lang);
    while (j < b.lines.length && !close(b.lines[j])) {
      if (fenceShell !== null) {
        if (prompts) {
          // Only lines after a `$ ` prompt are commands; the rest is output.
          const p = /^(\s*[$#%]\s)/.exec(b.lines[j]);
          if (p) b.plain(j, p[1].length);
        } else b.plain(j);
      }
      j++;
    }
    const shell = fenceShell === null ? null : detectShell(b.lines.slice(i + 1, j).join('\n')) ?? fenceShell;
    if (shell !== null && j > i + 1) b.region(i + 1, j - 1, [`Markdown のコードブロック（${lang}）`, `Markdown code block (${lang})`], shell === 'bash' ? undefined : shell);
    i = j;
  }
  // A reader types the blocks into one terminal, one after another: one shell.
  for (const r of b.regions) r.script = 0;
}

