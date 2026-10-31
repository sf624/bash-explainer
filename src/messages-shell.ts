import { type AutoShell, SHELL_NAMES, type ShellSource } from './dialect';
import type { Lang } from './i18n';

// The wording of the automatic shell ("Shell: auto"), in every place the product says it (docs/design/sources.md, SB4;
// docs/design/chrome-redesign.md, decision 12). The shell and where it comes from are `autoShellAt`'s (src/document.ts:
// a script's from `readShell`, a host file's from the part of the cursor's line); the texts are here, so that the
// page, the panel and the editor's header say it alike.

/**
 * The forms of the wording of a `ShellReading`:
 * - `option`: the "auto" entry of the panel's shell list, "Auto (bash)"; bare "Auto" when the file says no shell
 *   (the reading is the default), as the list has always read.
 * - `short`: the editor header's chip, "bash (auto)".
 * - `long`: the chip's popover, which is about this file, "Auto: bash (from #!)".
 * - `setting`: the Shell setting, a preference for every script, "Auto (now: bash, from #!)".
 * A host file's shell comes from its type, part by part ("Auto: POSIX sh (from the file type)"); at a line in no part,
 * when the parts differ (`parts`), no shell is named: "auto", "Auto: set by each part (from the file type)".
 */
export type AutoShellForm = 'option' | 'short' | 'long' | 'setting';

const AUTO = { ja: '自動', en: 'Auto' };

/** Where the shell comes from, as the long forms say it. */
const FROM: Record<ShellSource, { ja: string; en: string }> = {
  directive: { ja: 'ShellCheck の指示コメントから', en: 'from a ShellCheck directive' },
  shebang: { ja: '#! 行から', en: 'from #!' },
  filename: { ja: 'ファイル名から', en: 'from the file name' },
  default: { ja: '既定', en: 'default' },
  host: { ja: 'ファイルの種類から', en: 'from the file type' },
};

/** No one shell: each part of a host file has its own. */
const PARTS = { ja: '部分ごとに決まる', en: 'set by each part' };

/** The automatic shell in words. `reading` is what `autoShellAt` gave (undefined: nothing was read, so bash by default). */
export function autoShellText(lang: Lang, form: AutoShellForm, reading?: AutoShell): string {
  const ja = lang === 'ja';
  const auto = AUTO[lang];
  if (reading === 'parts') {
    const from = FROM.host[lang];
    switch (form) {
      case 'option': return auto;
      case 'short': return ja ? auto : auto.toLowerCase();
      case 'long': return ja ? `${auto}: ${PARTS.ja}（${from}）` : `${auto}: ${PARTS.en} (${from})`;
      case 'setting': return ja ? `${auto}（今: ${PARTS.ja}、${from}）` : `${auto} (now: ${PARTS.en}, ${from})`;
    }
  }
  const { shell, source } = reading ?? { shell: 'bash', source: 'default' } as const;
  const name = SHELL_NAMES[shell];
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
