import { type AutoShell, SHELL_NAMES, type ShellSource } from './dialect';
import type { Lang } from './i18n';
import type { NameFacts } from './semantics/names';

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
 * when the parts differ (`parts`), no shell is named: "auto", "Auto: set by each part (from the file type)". Words the
 * host runs with no shell (`none`: Docker's exec form) say so: "no shell", "Auto: no shell (runs directly)".
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

/** No one shell named: each part of a host file has its own (`parts`), or the host runs the words with none (`none`). */
const NAMELESS = {
  parts: { what: { ja: '部分ごとに決まる', en: 'set by each part' }, from: FROM.host },
  none: { what: { ja: 'シェルなし', en: 'no shell' }, from: { ja: '直接実行', en: 'runs directly' } },
};

/** The automatic shell in words. `reading` is what `autoShellAt` gave (undefined: nothing was read, so bash by default). */
export function autoShellText(lang: Lang, form: AutoShellForm, reading?: AutoShell): string {
  const ja = lang === 'ja';
  const auto = AUTO[lang];
  if (typeof reading === 'string') {
    const what = NAMELESS[reading].what[lang];
    const from = NAMELESS[reading].from[lang];
    // (`parts` names nothing in the short forms: the line is in no part.)
    const parts = reading === 'parts';
    switch (form) {
      case 'option': return parts ? auto : ja ? `${auto}（${what}）` : `${auto} (${what})`;
      case 'short': return !parts ? what : ja ? auto : auto.toLowerCase();
      case 'long': return ja ? `${auto}: ${what}（${from}）` : `${auto}: ${what} (${from})`;
      case 'setting': return ja ? `${auto}（今: ${what}、${from}）` : `${auto} (now: ${what}, ${from})`;
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

/**
 * The line on a name no shell reads (`NameFacts.noShell`: Docker's exec form): what a shell would have run of it
 * instead does not run. A reserved word that no program is named says so in `by`.
 */
export function noShellLines(lang: Lang, f: NameFacts): string[] {
  const ja = lang === 'ja';
  const skips = f.noShell!.skips;
  if (f.noProgram) return [ja ? 'この単語を読むシェルはないので、シェルのビルトインは動かない。この名前のプログラムはふつうない' : 'No shell reads these words, so the shell\'s builtin does not run, and there is usually no program of this name'];
  if (f.runs !== 'program' || !skips) return [];
  const what = skips === 'builtin' ? (ja ? 'シェルのビルトイン' : 'the shell\'s builtin') : (ja ? 'シェルの予約語' : 'the shell\'s reserved word');
  return [ja ? `この単語を読むシェルはないので、これはプログラムで、${what}ではない` : `No shell reads these words, so this is the program, not ${what}`];
}
