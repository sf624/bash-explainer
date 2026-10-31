import type { Lang, Text } from './i18n';
import type { ThemeKind } from './ui/palette';

// The level table (docs/design/note-levels.md; docs/design/sources.md, row 13 and SB1): how much a note matters, and how
// every output shows it. The level of each note comes from the catalog (src/messages.ts); what a level looks like, and
// what severity it is in each protocol, comes from here, and no other file has a list of its own (test/note-levels.test.ts).
// Imported by the catalog, the problems (src/document.ts), the editor, the Language Server, the command-line tool, the
// panel, the hover and the web page; it imports nothing but types.

/**
 * The level of a note (docs/design/three-levels.md, section 2: the first question answered yes gives it):
 * - `error` (ⓧ "Error" / 「エラー」, red): the line fails every time as written (`[ -f x`, `unset` of a read-only
 *   variable, a construct the target shell lacks, a function a new shell does not have). Said whatever the pitfalls
 *   settings say, and it fails `--check`.
 * - `warning` (⚠ "Pitfall" / 「落とし穴」, yellow): damage that cannot be undone under some values or conditions, or a
 *   failure that turns the script's own exit status into success (`rm -rf $DIR/*` with an empty DIR, a stop under
 *   `set -u` of a name the environment may give, `cmd || echo failed` at the end of a script, `source lib.sh` that
 *   searches `$PATH`).
 * - `info` (ⓘ "Caveat" / 「注意」, blue): it goes wrong only with some values or systems and the damage is limited, or
 *   a failure goes unnoticed (`echo $x`, `read line`, `local x=$(false)`). A dialect note on a construct that works
 *   differently in the target shell is `info` too, with the word "Portability" / 「移植性」.
 * - `note` (ℹ, no word, no squiggle): a fact of how the shell runs the line.
 */
export type NoteLevel = 'error' | 'warning' | 'info' | 'note';

/** The severity of a problem; `hint` is only the faded range of code that never runs (`FADED`), never a problem. */
export type Severity = 'error' | 'warning' | 'info' | 'hint';

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
  /**
   * Another name the panel gives the same colour, for what is no note (media/panel.css): `--c-error`, the colour of a
   * part of the line that cannot be read (`ERROR_COLOURS`, src/ui/palette.ts).
   */
  alias?: string;
  /** Where the editor gives none (the panel outside VS Code): the chart colour, then VS Code's dark default. */
  fallback: string;
  /**
   * The editor's own colour in Dark Modern, which the web page's dark theme stands in for (web/theme.css), unless ours
   * replaces it there (`ours.dark`).
   */
  dark: string;
  /**
   * Ours, where the theme's falls below 4.5:1 as text (7:1 in high contrast), keeping the hue (test/contrast.test.ts):
   * Light Modern's warning #bf8803 is 3.12:1 on white, its info #1a85ff 3.59:1 and its error #e51400 4.23:1 on a code
   * block (#f2f2f2); Dark Modern's error #f14c4c is 3.96:1 on a code block (#2b2b2b); High Contrast's info #3794ff is
   * 6.84:1 on black and its error #f48771 6.71:1 on a code block (#1f1f1f); High Contrast Light's warning #895503 is
   * 6.24:1 on white, its info #1a85ff 3.59:1 and its error #b5200d 6.61:1. The error's are those of a part that cannot
   * be read (`ERROR_COLOURS`, src/ui/palette.ts).
   */
  ours: Partial<Record<ThemeKind, string>>;
}

/** A level, as every output shows it. */
export interface Level {
  /** The order of the notes (`notesByLevel`), and which squiggle wins where two problems overlap: the lowest first. */
  rank: number;
  /** The mark a note's text starts with (the plain outputs: Markdown, the CLI, the Problems list). */
  mark: string;
  /**
   * What follows the mark of a note that has no heading of its own ("Pitfall: "); empty when nothing does. A pitfall's
   * always; another kind's (a fact, a dialect issue) only with `wordOnEvery`.
   */
  word: Text;
  /** The word follows the level, whatever the kind of the note ("Error:" on a fact, a pitfall or a dialect issue). */
  wordOnEvery?: true;
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
  /**
   * With forced colours, a note's left border, where it must differ from the others without colour: an error's double,
   * a warning's dashed, the others' solid.
   */
  forcedBorder?: string;
  /**
   * How many notes or problems of the level, in words: what the screen reader's summary of a line says (web/a11y.ts),
   * and the name of the web page's Problems strip (web/problem-list.ts). A plain note, which is never a problem, has none.
   */
  count?: { ja: (n: number) => string; en: (n: number) => string };
}

export const LEVELS: Readonly<Record<NoteLevel, Level>> = {
  error: {
    rank: 0, mark: 'ⓧ', word: { ja: 'エラー: ', en: 'Error: ' }, wordOnEvery: true, name: { ja: 'エラー', en: 'Error' },
    codicon: 'error', ansi: '31', bold: true, className: 'level-error', severity: 'error', forcedBorder: '4px double CanvasText',
    colour: {
      variable: '--vscode-editorError-foreground', name: '--c-error-level', alias: '--c-error', fallback: 'var(--vscode-charts-red, #f14c4c)', dark: '#f14c4c',
      ours: { light: '#d0020f', dark: '#fd6358', highContrast: '#f6937e', highContrastLight: '#9b1c0b' },
    },
    count: { ja: (n) => `エラー ${n} 件`, en: (n) => `${n} error${n === 1 ? '' : 's'}` },
  },
  warning: {
    rank: 1, mark: '⚠', word: { ja: '落とし穴: ', en: 'Pitfall: ' }, name: { ja: '警告', en: 'Warning' }, codicon: 'warning', ansi: '33', bold: true,
    className: 'level-warning', severity: 'warning', forcedBorder: '3px dashed CanvasText',
    colour: {
      variable: '--vscode-editorWarning-foreground', name: '--c-warning', fallback: 'var(--vscode-charts-yellow, #cca700)', dark: '#cca700',
      ours: { light: '#855f00', highContrastLight: '#704500' },
    },
    count: { ja: (n) => `警告 ${n} 件`, en: (n) => `${n} warning${n === 1 ? '' : 's'}` },
  },
  info: {
    rank: 2, mark: 'ⓘ', word: { ja: '注意: ', en: 'Caveat: ' }, name: { ja: '情報', en: 'Information' }, codicon: 'info', ansi: '34', bold: true,
    className: 'level-info', severity: 'info',
    colour: {
      variable: '--vscode-editorInfo-foreground', name: '--c-info', fallback: 'var(--vscode-charts-blue, #3794ff)', dark: '#3794ff',
      ours: { light: '#005fb8', highContrast: '#6badff', highContrastLight: '#0f4a85' },
    },
    count: { ja: (n) => `注意 ${n} 件`, en: (n) => `${n} caveat${n === 1 ? '' : 's'}` },
  },
  note: { rank: 3, mark: 'ℹ', word: { ja: '', en: '' }, name: { ja: '補足', en: 'Note' }, codicon: 'info', ansi: '90', bold: false, className: 'level-note', severity: 'info' },
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
  /** The name of the number of its problems, in what `--counts` writes (`warnings=2`) and the GitHub Action's outputs. */
  count: string;
  /** Whether a problem of this severity fails `--check` and the GitHub Action: always, only with `--strict`, or never. */
  fails: 'always' | 'strict' | 'never';
}

export const SEVERITIES: Readonly<Record<Severity, SeverityMapping>> = {
  error: { level: 'error', vscode: 0, lsp: 1, sarif: 'error', github: 'error', codemirror: 'error', word: 'error', count: 'errors', fails: 'always' },
  warning: { level: 'warning', vscode: 1, lsp: 2, sarif: 'warning', github: 'warning', codemirror: 'warning', word: 'warning', count: 'warnings', fails: 'strict' },
  info: { level: 'info', vscode: 2, lsp: 3, sarif: 'note', github: 'notice', codemirror: 'info', word: 'info', count: 'infos', fails: 'never' },
  hint: { level: 'note', vscode: 3, lsp: 4, faded: true, sarif: 'note', github: 'notice', codemirror: 'hint', word: 'hint', count: 'hints', fails: 'never' },
};

/** The severity of a problem for a note of `level`. */
export function severityOf(level: NoteLevel): ProblemSeverity {
  return LEVELS[level].severity;
}

/** The look of a problem of `severity` in a list: its level's mark, icon, colour and name. */
export function problemLevel(severity: Severity): Level {
  return LEVELS[SEVERITIES[severity].level];
}

/** Whether a problem fails `--check` (and the GitHub Action): an error always, a warning only with `--strict`. */
export function failsCheck(severity: Severity, strict: boolean): boolean {
  const { fails } = SEVERITIES[severity];
  return fails === 'always' || (fails === 'strict' && strict);
}

/**
 * Whether a note of `level` says that the line fails every time (an error): its problem fails `--check` without
 * `--strict`, the note is said whatever `notes.pitfalls` and `diagnostics.pitfalls` say (`said`), and as a problem it
 * is no pitfall (`DocumentIssue.pitfall`).
 */
export function alwaysFails(level: NoteLevel): boolean {
  return SEVERITIES[LEVELS[level].severity].fails === 'always';
}

/**
 * Whether a note's word (its `label`) is its level's own word, which the level says on every note (`wordOnEvery`:
 * "Error:"), not a heading or a kind's word ("Pitfall:"): it names the level, as the icon's name and a problem's severity do.
 */
export function namesLevel(level: NoteLevel, label: string, lang: Lang): boolean {
  const { word, wordOnEvery } = LEVELS[level];
  return wordOnEvery === true && label === word[lang].trimEnd();
}

/**
 * The mark that a text which is no note of the catalog yet puts before a failure it states, inside an explanation's
 * sentence ("…. ⚠ env cannot split this string"). Such texts become catalog facts (docs/design/sources.md, SB3).
 */
export const PROSE_MARK = LEVELS.warning.mark;

/** The levels in their order (`rank`), with their keys. */
export const LEVEL_ORDER: readonly NoteLevel[] = (Object.keys(LEVELS) as NoteLevel[]).sort((a, b) => LEVELS[a].rank - LEVELS[b].rank);

/** The levels that have a colour, in their order. */
export const COLOURED: readonly NoteLevel[] = LEVEL_ORDER.filter((l) => LEVELS[l].colour);

/** A message without the mark of its level it starts with in the explanations (and an emoji selector after it). */
export const LEADING_MARK = new RegExp(`^[${LEVEL_ORDER.map((l) => LEVELS[l].mark).join('')}]\\uFE0F?\\s*`, 'u');

/** How many of `levels` are of each level that has a count, in the levels' order; a level with none is left out. */
export function levelTally(levels: readonly NoteLevel[]): { level: NoteLevel; n: number }[] {
  return LEVEL_ORDER.flatMap((level) => {
    const n = levels.filter((x) => x === level).length;
    return LEVELS[level].count && n ? [{ level, n }] : [];
  });
}

/**
 * How many of `levels` are of each level, in words ("1 error", "2 warnings"): what the screen reader's summary of a
 * line says of its notes, and the Problems strip of its problems.
 */
export function levelCounts(levels: readonly NoteLevel[], lang: Lang): string[] {
  return levelTally(levels).map(({ level, n }) => LEVELS[level].count![lang](n));
}

/** The level of each problem, as a list shows it (`problemLevel`), for `levelTally` and `levelCounts`. */
export function problemLevels(severities: readonly Severity[]): NoteLevel[] {
  return severities.map((s) => SEVERITIES[s].level);
}
