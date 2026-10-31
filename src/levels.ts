import type { Lang, Text } from './i18n';
import type { ThemeKind } from './ui/palette';

// The level table (docs/design/note-levels.md; docs/design/sources.md, row 13 and SB1): how much a note matters, and how
// every output shows it. The level of each note comes from the catalog (src/messages.ts); what a level looks like, and
// what severity it is in each protocol, comes from here, and no other file has a list of its own (test/note-levels.test.ts).
// Imported by the catalog, the problems (src/document.ts), the editor, the Language Server, the command-line tool, the
// panel, the hover and the web page; it imports nothing but types.

/**
 * The level of a note:
 * - `warning` (⚠ "Pitfall" / 「落とし穴」, yellow): the line breaks as written, or if it goes wrong the damage cannot be
 *   undone (`x = 1`, `[-f x]`, `rm -rf $DIR/*` with an empty DIR, a stop under `set -u`).
 * - `info` (ⓘ "Caveat" / 「注意」, blue): it goes wrong only with some values or systems and the damage is limited, or
 *   a failure goes unnoticed (`echo $x`, `read line`, `local x=$(false)`). A dialect note on a construct that works
 *   differently in the target shell is `info` too, with the word "Portability" / 「移植性」.
 * - `note` (ℹ, no word, no squiggle): a fact of how the shell runs the line.
 */
export type NoteLevel = 'warning' | 'info' | 'note';

/** The severity of a problem; `hint` is only the faded range of code that never runs (`FADED`), never a problem. */
export type Severity = 'warning' | 'info' | 'hint';

/** The severity of a range the editors fade: code that never runs (src/document.ts, `DeadRange`). */
export type Faded = 'hint';
export const FADED: Faded = 'hint';

/** The severity of a problem (`DocumentIssue`): any but `FADED`. */
export type ProblemSeverity = Exclude<Severity, Faded>;

/** The colour of a level: the editor's own, and ours where it is not readable as text. */
export interface LevelColour {
  /** The editor's colour of the level: its squiggles' and the Problems panel's icon's. */
  variable: string;
  /** The name the panel and the web page give it (media/panel.css, web/page.css). */
  name: string;
  /** Where the editor gives none (the panel outside VS Code): the chart colour, then VS Code's dark default. */
  fallback: string;
  /** The editor's own colour in Dark Modern, which the web page's dark theme stands in for (web/theme.css). */
  dark: string;
  /**
   * Ours, where the theme's falls below 4.5:1 as text (7:1 in high contrast), keeping the hue (test/contrast.test.ts):
   * Light Modern's warning #bf8803 is 3.12:1 on white and its info #1a85ff 3.59:1; High Contrast's info #3794ff is 6.84:1
   * on black; High Contrast Light's warning #895503 is 6.24:1 on white and its info #1a85ff 3.59:1.
   */
  ours: Partial<Record<ThemeKind, string>>;
}

/** A level, as every output shows it. */
export interface Level {
  /** The order of the notes (`notesByLevel`), and which squiggle wins where two problems overlap: the lowest first. */
  rank: number;
  /** The mark a note's text starts with (the plain outputs: Markdown, the CLI, the Problems list). */
  mark: string;
  /** What follows the mark of a pitfall that has no heading of its own ("Pitfall: "); empty when nothing does. */
  word: Text;
  /** Its name, for a screen reader and the Problems pane: 警告・情報・補足 / Warning, Information, Note. */
  name: Text;
  /** The Codicon that stands for the mark in the panel, the hover and the web page (media/icons.js draws it). */
  codicon: string;
  /** The ANSI colour of the mark and the word in the command-line tool, and of the word of a problem of `--check`. */
  ansi: string;
  /** Whether the command-line tool prints the mark and the word in bold (a plain note's mark is only dim). */
  bold: boolean;
  /** The class of a note, and of a squiggle, in the panel (media/panel.css). */
  className: string;
  /** The severity of the note as a problem: a plain note is never one, so it is taken as information. */
  severity: ProblemSeverity;
  /** Its colour; a plain note has the muted one. */
  colour?: LevelColour;
  /** With forced colours, a note's left border, where it must differ from the others without colour. */
  forcedBorder?: string;
  /** How many notes of the level a line has, where the screen reader's summary of a line says it (web/a11y.ts). */
  count?: { ja: (n: number) => string; en: (n: number) => string };
}

export const LEVELS: Readonly<Record<NoteLevel, Level>> = {
  warning: {
    rank: 0, mark: '⚠', word: { ja: '落とし穴: ', en: 'Pitfall: ' }, name: { ja: '警告', en: 'Warning' }, codicon: 'warning', ansi: '33', bold: true,
    className: 'level-warning', severity: 'warning', forcedBorder: '4px double CanvasText',
    count: { ja: (n) => `警告 ${n} 件`, en: (n) => `${n} warning${n === 1 ? '' : 's'}` },
    colour: {
      variable: '--vscode-editorWarning-foreground', name: '--c-warning', fallback: 'var(--vscode-charts-yellow, #cca700)', dark: '#cca700',
      ours: { light: '#855f00', highContrastLight: '#704500' },
    },
  },
  info: {
    rank: 1, mark: 'ⓘ', word: { ja: '注意: ', en: 'Caveat: ' }, name: { ja: '情報', en: 'Information' }, codicon: 'info', ansi: '34', bold: true,
    className: 'level-info', severity: 'info',
    colour: {
      variable: '--vscode-editorInfo-foreground', name: '--c-info', fallback: 'var(--vscode-charts-blue, #3794ff)', dark: '#3794ff',
      ours: { light: '#005fb8', highContrast: '#6badff', highContrastLight: '#0f4a85' },
    },
  },
  note: { rank: 2, mark: 'ℹ', word: { ja: '', en: '' }, name: { ja: '補足', en: 'Note' }, codicon: 'info', ansi: '90', bold: false, className: 'level-note', severity: 'info' },
};

/** A severity of a problem, in each protocol that shows one. */
export interface SeverityMapping {
  /** The level whose look a problem of this severity takes in a list (its mark, icon, colour and name). */
  level: NoteLevel;
  /** `vscode.DiagnosticSeverity`: Error 0, Warning 1, Information 2, Hint 3. */
  vscode: 0 | 1 | 2 | 3;
  /** The Language Server Protocol's `DiagnosticSeverity`: Error 1, Warning 2, Information 3, Hint 4. */
  lsp: 1 | 2 | 3 | 4;
  /** Faded by the editor, as code that never runs (`DiagnosticTag.Unnecessary`, 1 in the protocol). */
  faded?: true;
  /** SARIF 2.1.0's `level`. */
  sarif: 'error' | 'warning' | 'note';
  /** The GitHub Actions workflow command (`::warning`), shown as an annotation. */
  github: 'error' | 'warning' | 'notice';
  /** CodeMirror's lint severity (the web page's editor). */
  codemirror: 'error' | 'warning' | 'info' | 'hint';
  /** The word of `--check`'s text, as compilers print it (`file:1:1: warning: …`). */
  word: string;
  /** Whether a problem of this severity fails `--check` (a pitfall's only with `--strict`: `failsCheck`). */
  fails: boolean;
}

export const SEVERITIES: Readonly<Record<Severity, SeverityMapping>> = {
  warning: { level: 'warning', vscode: 1, lsp: 2, sarif: 'warning', github: 'warning', codemirror: 'warning', word: 'warning', fails: true },
  info: { level: 'info', vscode: 2, lsp: 3, sarif: 'note', github: 'notice', codemirror: 'info', word: 'info', fails: false },
  hint: { level: 'note', vscode: 3, lsp: 4, faded: true, sarif: 'note', github: 'notice', codemirror: 'hint', word: 'hint', fails: false },
};

/** The severity of a problem for a note of `level`. */
export function severityOf(level: NoteLevel): ProblemSeverity {
  return LEVELS[level].severity;
}

/** The look of a problem of `severity` in a list: its level's mark, icon, colour and name. */
export function problemLevel(severity: Severity): Level {
  return LEVELS[SEVERITIES[severity].level];
}

/** Whether a problem fails `--check` (and the GitHub Action): a pitfall's warning only with `--strict`. */
export function failsCheck(severity: Severity, pitfall: boolean | undefined, strict: boolean): boolean {
  return SEVERITIES[severity].fails && (strict || !pitfall);
}

/** The levels in their order (`rank`), with their keys. */
export const LEVEL_ORDER: readonly NoteLevel[] = (Object.keys(LEVELS) as NoteLevel[]).sort((a, b) => LEVELS[a].rank - LEVELS[b].rank);

/** The levels that have a colour, in their order. */
export const COLOURED: readonly NoteLevel[] = LEVEL_ORDER.filter((l) => LEVELS[l].colour);

/** What the screen reader's summary of a line says of its notes: how many of each level that it counts ("2 warnings"). */
export function levelCounts(levels: readonly NoteLevel[], lang: Lang): string[] {
  return LEVEL_ORDER.flatMap((l) => {
    const n = levels.filter((x) => x === l).length;
    const count = LEVELS[l].count;
    return count && n ? [count[lang](n)] : [];
  });
}

/** A message without the mark it starts with in the explanations (⚠, ⓘ or ℹ, and an emoji selector after it). */
export const LEADING_MARK = new RegExp(`^[${LEVEL_ORDER.map((l) => LEVELS[l].mark).join('')}]\\uFE0F?\\s*`, 'u');

/**
 * The mark that a text which is no note of the catalog yet puts before a failure it states, inside an explanation's
 * sentence ("…. ⚠ env cannot split this string"). Such texts become catalog facts (docs/design/sources.md, SB3).
 */
export const PROSE_MARK = LEVELS.warning.mark;
