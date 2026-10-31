import { type AutoShell, SHELL_NAMES, type Shell } from '../dialect';
import type { Lang } from '../i18n';
import { autoShellText } from '../messages-shell';

// The chip of the file type and the shell in the editor's header on the web page, and the lists of its popover
// (docs/design/chrome-redesign.md, decision 12, step C5). The chip's forms are a fit rule: the candidates in order,
// widest first; the page (web/scope-chip.ts) measures them and takes the first that fits. The wording of the automatic
// shell is `autoShellText`'s, from `autoShellAt`'s reading (src/document.ts): the shell the cursor's line is explained as.

/** The file type as the chip says it: its name ("Shell script") and a shorter word for less room ("Script"). */
export interface ScopeKind {
  name: string;
  short: string;
}

/** A form of the editor's header: the chip's text, Open and Save with their words or as icons, the file name there or only in the menu. */
export interface ScopeForm {
  chip: string;
  tools: 'words' | 'icons';
  name: boolean;
}

export interface ScopeChip {
  /** The forms, widest first. */
  forms: ScopeForm[];
  /** The chip's accessible name: it contains the text of every form (WCAG 2.5.3, Label in Name). */
  name: string;
  /** The chip's tooltip: what it shows, with where the automatic shell comes from. */
  tip: string;
}

/**
 * The chip for a file type and a shell: `forced` is the shell chosen (the `shell` setting), else the shell is automatic,
 * as `reading` says. `title` names the control ("File type and shell"). The forms, widest first: the whole chip
 * ("Shell script · bash (auto)"), without "(auto)", with the type's shorter word ("Script · bash"), Open and Save as
 * icons, the shell alone ("bash"), and the file name left to the menu. A form that says what the one before says is
 * left out. Where no one shell applies (`parts`), the shell's place says "auto".
 */
export function scopeChip(lang: Lang, title: string, kind: ScopeKind, forced: Shell | undefined, reading?: AutoShell): ScopeChip {
  const shell = forced ? SHELL_NAMES[forced] : reading === 'parts' ? autoShellText(lang, 'short', reading) : SHELL_NAMES[reading?.shell ?? 'bash'];
  const said = forced ? shell : autoShellText(lang, 'short', reading);
  const chips = [...new Set([`${kind.name} · ${said}`, `${kind.name} · ${shell}`, `${kind.short} · ${shell}`])];
  const forms: ScopeForm[] = [
    ...chips.map((chip) => ({ chip, tools: 'words' as const, name: true })),
    { chip: chips[chips.length - 1], tools: 'icons', name: true },
    { chip: shell, tools: 'icons', name: true },
    { chip: shell, tools: 'icons', name: false },
  ];
  return {
    forms,
    name: `${title}: ${chips[0]}`,
    tip: `${title}: ${kind.name} · ${forced ? shell : autoShellText(lang, 'long', reading)}`,
  };
}

/** The Shell list of the popover: Auto first, saying the shell it reads and where from ("Auto: bash (from #!)"), then each shell. */
export function shellChoices(lang: Lang, reading?: AutoShell): [string, string][] {
  return [['auto', autoShellText(lang, 'long', reading)], ...Object.entries(SHELL_NAMES)];
}
