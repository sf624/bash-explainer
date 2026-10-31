import { SHELL_NAMES, type Shell, type ShellSource } from './dialect';
import type { Lang } from './i18n';

// The wording of the automatic shell ("Shell: auto"), in every place the product says it (docs/design/sources.md, SB4;
// docs/design/chrome-redesign.md, decision 12). The shell and where it comes from are `readShell`'s (src/dialect.ts);
// the texts are here, so that the page, the panel and the editor's header say it alike.

/**
 * The forms of the wording, for the bash found `shell` from `source`:
 * - `option`: the "auto" entry of the panel's shell list, "Auto (bash)"; bare "Auto" when the file says no shell
 *   (`shell` is undefined), as the list has always read.
 * - `short`: the editor header's chip, "bash (auto)".
 * - `long`: the chip's popover, which is about this file, "Auto: bash (from #!)".
 * - `setting`: the Shell setting, a preference for every script, "Auto (now: bash, from #!)".
 */
export type AutoShellForm = 'option' | 'short' | 'long' | 'setting';

const AUTO = { ja: '自動', en: 'Auto' };

/** Where the shell comes from, as the long forms say it. */
const FROM: Record<ShellSource, { ja: string; en: string }> = {
  directive: { ja: 'shellcheck の指示行から', en: 'from a shellcheck directive' },
  shebang: { ja: '#! 行から', en: 'from #!' },
  filename: { ja: 'ファイル名から', en: 'from the file name' },
  default: { ja: '既定', en: 'default' },
};

/** The automatic shell in words. `shell` is the one the file says (undefined: it says none, so bash and `default`). */
export function autoShellText(lang: Lang, form: AutoShellForm, shell: Shell | undefined, source: ShellSource = 'default'): string {
  const ja = lang === 'ja';
  const name = SHELL_NAMES[shell ?? 'bash'];
  const auto = AUTO[lang];
  const from = FROM[source][lang];
  switch (form) {
    case 'option': return !shell ? auto : ja ? `${auto}（${name}）` : `${auto} (${name})`;
    case 'short': return ja ? `${name}（${auto}）` : `${name} (${auto.toLowerCase()})`;
    case 'long': return ja ? `${auto}: ${name}（${from}）` : `${auto}: ${name} (${from})`;
    case 'setting': return ja ? `${auto}（今: ${name}、${from}）` : `${auto} (now: ${name}, ${from})`;
  }
}
