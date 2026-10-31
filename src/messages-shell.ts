import { SHELL_NAMES, type ShellReading, type ShellSource } from './dialect';
import type { Lang } from './i18n';

// The wording of the automatic shell ("Shell: auto"), in every place the product says it (docs/design/sources.md, SB4;
// docs/design/chrome-redesign.md, decision 12). The shell and where it comes from are `readShell`'s (src/dialect.ts);
// the texts are here, so that the page, the panel and the editor's header say it alike.

/**
 * The forms of the wording of a `ShellReading`:
 * - `option`: the "auto" entry of the panel's shell list, "Auto (bash)"; bare "Auto" when the file says no shell
 *   (the reading is the default), as the list has always read.
 * - `short`: the editor header's chip, "bash (auto)".
 * - `long`: the chip's popover, which is about this file, "Auto: bash (from #!)".
 * - `setting`: the Shell setting, a preference for every script, "Auto (now: bash, from #!)".
 */
export type AutoShellForm = 'option' | 'short' | 'long' | 'setting';

const AUTO = { ja: '自動', en: 'Auto' };

/** Where the shell comes from, as the long forms say it. */
const FROM: Record<ShellSource, { ja: string; en: string }> = {
  directive: { ja: 'ShellCheck の指示コメントから', en: 'from a ShellCheck directive' },
  shebang: { ja: '#! 行から', en: 'from #!' },
  filename: { ja: 'ファイル名から', en: 'from the file name' },
  default: { ja: '既定', en: 'default' },
};

/** The automatic shell in words. `reading` is what `readShell` gave (undefined: nothing was read, so bash by default). */
export function autoShellText(lang: Lang, form: AutoShellForm, reading?: ShellReading): string {
  const ja = lang === 'ja';
  const { shell, source } = reading ?? { shell: 'bash', source: 'default' } as const;
  const name = SHELL_NAMES[shell];
  const auto = AUTO[lang];
  const from = FROM[source][lang];
  switch (form) {
    case 'option': return source === 'default' ? auto : ja ? `${auto}（${name}）` : `${auto} (${name})`;
    case 'short': return ja ? `${name}（${auto}）` : `${name} (${auto.toLowerCase()})`;
    case 'long': return ja ? `${auto}: ${name}（${from}）` : `${auto}: ${name} (${from})`;
    case 'setting':
      if (source === 'default') return ja ? `${auto}（今: ${FROM.default.ja}の ${name}）` : `${auto} (now: ${name}, the default)`;
      return ja ? `${auto}（今: ${name}、${from}）` : `${auto} (now: ${name}, ${from})`;
  }
}
