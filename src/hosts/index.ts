import type { Pos, Span } from '../analyzer-types';
import type { Shell } from '../dialect';
import type { CommandSpec } from '../argv/spec';
import type { PythonFlag, PythonRegexOptions } from '../embedded/regex-python';
import type { FactSpec } from '../messages';
import type { HostMeaning } from '../messages-hosts';
import type { HostRun } from '../semantics/walk/host';

/** Kinds of files whose shell snippets are explained. */
export type HostKind = 'dockerfile' | 'makefile' | 'yaml' | 'npm' | 'markdown' | 'python' | 'jenkinsfile' | 'bats';

/** A note on every line of a region: a catalog fact; a warning's `code` is its problem in the Problems panel (none: the fact's id). */
export type RegionNote = { spec: FactSpec; code?: string };

/** Which CI system a YAML step belongs to, when the file says. */
export type HostCi = 'github' | 'circleci' | 'azure';

/** What a shell region is part of: the kind of file, and the CI system for a YAML step. The English label is only for people. */
export interface HostId { kind: HostKind; ci?: HostCi }

/** A run of lines holding shell code inside another kind of file. */
export interface ShellRegion {
  start: number;
  end: number;
  /** What the snippet is, e.g. "Dockerfile RUN" (ja, en). */
  label: [string, string];
  /** What the region is part of (readers test this, not the label). */
  host: HostId;
  shell?: Shell;
  /** Notes shown on every line of the region. */
  /**
   * [ja, en], or a `spec`: a catalog fact (a pitfall is said only with `notes.pitfalls` on) whose `code` makes it a
   * warning in the Problems panel.
   */
  notes?: RegionNote[];
  /**
   * Regions with the same `script` run in one shell (the code blocks of a Markdown file, a recipe with `.ONESHELL`):
   * what one sets, the next sees. Every other region is a shell of its own (a RUN instruction, a workflow step, a recipe line).
   */
  script?: number;
  /** A Docker RUN without `pipefail`: a failure inside a pipe does not fail the build. */
  warnPipefail?: boolean;
  /**
   * Words the host runs with no shell (Docker's exec form `CMD ["npm", "start"]`, a Python list of arguments): written
   * as shell words so that the command is explained, but no shell reads them (`autoShellAt` says "no shell"; the model's
   * `StateModel.noShell`: the name is a program in PATH).
   */
  noShell?: NoShell;
  /** Commands the host defines for its scripts (bats: `run`, `load`…), read with these specs before the dictionary. */
  commands?: Record<string, CommandSpec>;
  /**
   * The lines a test runner turns into functions (bats: `@test "…" {`), also inside a here-document or a string,
   * where bats rewrites them too.
   */
  tests?: number[];
  /** What the host runs of the script (bats: each test in a process of its own, with `set -eET`), which the model reads. */
  run?: HostRun;
  /**
   * Variables the host sets for its scripts (a CI's `GITHUB_SHA`, a step's `env:`, a Dockerfile's `ARG` and `ENV`); a
   * name that ends in `*` stands for every name it starts. With the names of the placeholders (`hostProvided`), the
   * model takes them as set by the environment (src/semantics/shellstate.ts, `fromEnvironment`).
   */
  provided?: readonly string[];
}

/** How the host writes the words it runs with no shell (`ShellRegion.noShell`). */
export interface NoShell {
  /** What a word is in the file: a JSON string (Docker), a Python string (ja, en). None where the words are read as written (make reads the quotes of a recipe line itself). */
  word?: [ja: string, en: string];
}

/** Something the host replaces before the shell sees it (`$(CC)` in make, `${{ … }}` in GitHub Actions). */
export interface HostSubstitution {
  line: number;
  text: string;
  meaning: HostMeaning;
  /** A warning about the substitution (e.g. untrusted input pasted into a script). */
  warning?: FactSpec;
}

/**
 * The value of string literals of a host file, as a language's reader reads it, and where each of its characters is in the file:
 * `at[i]`, the place of its first source character, and `to[i]`, the end of its source range. `at` has one more entry, the end of
 * the literals' text. `span`: the literals, prefixes and quotes included; `bytes`: they are bytes literals (`b'…'`). A replacement field of an f-string stands in `value` as a
 * hole character (`isHole`, src/embedded/types.ts) over the field's source, and `holes` has it by that character (a pattern's
 * only: docs/design/python-regex.md, 4.3). `escapes`: the characters, by their index in `value`, that the strings write in a way
 * a regex reads otherwise (`StringEscapeRisk`).
 */
export interface LiteralSource { value: string; at: Pos[]; to: Pos[]; span: Span; holes?: Readonly<Record<string, LiteralHole>>; escapes?: readonly { at: number; risk: StringEscapeRisk }[]; bytes?: true }

/** A field of an f-string: as written (`{prefix}`), and whether its value is text with every character special in a regex escaped (`{re.escape(x)}`). */
export interface LiteralHole { written: string; escaped: boolean }

/**
 * How a string that is not raw writes a character whose source a regex would read otherwise (docs/design/python-regex.md, 5.3): the
 * escape `\b`, a backspace, where a regex's `\b` is a word boundary; an octal escape of one or two digits (`\1`), a character,
 * where a regex's is a group's number; a backslash the string keeps (`"\d"`), as it starts no escape of Python's strings.
 */
export type StringEscapeRisk = 'backspace' | 'octal' | 'kept';

/**
 * A parameter of a function of Python's `re` (docs/design/python-regex.md, 5.1), by its name in Python, which is also its
 * keyword: the role of an argument that binds it (`string` is the subject the pattern is matched against; `pos` and `endpos`, of a
 * method of a compiled pattern, where in it the search starts and ends).
 */
export type ReParam = 'pattern' | 'string' | 'repl' | 'count' | 'maxsplit' | 'flags' | 'pos' | 'endpos';

/**
 * An argument of a call, as written: the parameter it binds (`role`; none for one past the function's parameters or a keyword it
 * does not have), whether it is given by keyword, the place of its value, and that value when it is string literals only.
 */
export interface CallArgument { role?: ReParam; keyword: boolean; span: Span; literal?: LiteralSource; flags?: CallFlags }

/**
 * The flags an argument of `flags`, `count` or `maxsplit` names, when it is terms joined by `|` and some are `0` or names of `re`
 * (docs/design/python-regex.md, 5.2): each name as written, the flag (`PYTHON_FLAGS`) and its place; their value; and the place of
 * each other term (`re.X | extra`: `extra`), which adds flags not known.
 */
export interface CallFlags { names: { written: string; flag: PythonFlag; span: Span }[]; value: number; unknown: Span[] }

/**
 * A part of a host file in another language than the shell's (docs/design/python-regex.md, 2.2): a call of Python's `re` with a
 * pattern to read. It is never in `Extracted.regions`, whose readers all take a region as shell code; its lines stay empty in the
 * shell text. Read through `hostPartAt` (src/hosts/scripts.ts).
 */
export interface LanguageRegion {
  /**
   * The lines it has, in order: those of the call, from the function's name to its `)`, but a line of a shell region, of another
   * call's pattern, or of a call inside it that holds the line (`claimLines`, src/hosts/python.ts; docs/design/python-regex.md, 2.2).
   */
  lines: readonly number[];
  /**
   * How many calls its most crowded line has (`claimLines`): its examples have that share of a line's budget, so that the calls of a
   * line cost no more together than one line may (`explainLanguageLine`; docs/design/line-budget.md). A function of the document only.
   */
  crowd: number;
  /** What it is, "Python regex (argument of `re.search`)" (ja, en). */
  label: [string, string];
  host: HostId;
  language: 'regex';
  flavor: 'python';
  /**
   * The function called: as the file writes it (`re.search`, `sub` after `from re import sub`, `PAT.sub` for a method of a compiled
   * pattern), its full name (`re.search`; for a method, the function of `re` it does the work of), and the call's place, from the name
   * to the `)`.
   */
  call: { written: string; name: string; span: Span };
  /** Its arguments in the order written (docs/design/python-regex.md, 5.1); the pattern's is read where it is string literals (`patternOf`). */
  args: CallArgument[];
  /**
   * The flags the pattern is compiled with: from the argument of `flags` (on where it names them, else not known where it has another
   * term), and the pattern's type. None where the pattern is not string literals: the region has the call's facts only. A method's
   * are those of its `re.compile`.
   */
  options?: PythonRegexOptions;
  /**
   * Of a method of a compiled pattern (`PAT.sub(…)`; docs/design/python-regex.md, 5.1): the name it is called on, the line of the one
   * `NAME = re.compile(<literals>…)` of the file that binds that name (`compiledNames`, src/hosts/pycompiled.ts), and its pattern.
   * Its arguments have no pattern: `patternOf` gives none, and the region's own lines hold no token of the pattern.
   */
  compiled?: { name: string; line: number; pattern: LiteralSource };
}

/**
 * The shell code of a document, line for line: lines outside the snippets are empty, and host
 * syntax is rewritten into plain shell. `maps[line][col]` gives the original column of each
 * character (with one extra entry for the end of the line).
 */
export interface Extracted {
  text: string;
  maps: number[][];
  /** Per line, the ranges of the shell text that replace host syntax (`${CC}` for `$(CC)`). */
  inserted: [number, number, HostMeaning?][][];
  regions: ShellRegion[];
  /** The parts in another language (`LanguageRegion`), which `hostPartAt` reads with the regions. */
  languages: LanguageRegion[];
  substitutions: HostSubstitution[];
}

import { maskCarried } from '../messages-levels';
import { Builder } from './builder';
import { bats } from './bats';
import { dockerfile } from './dockerfile';
import { makefile } from './makefile';
import { jenkinsfile } from './jenkinsfile';
import { yaml } from './yaml';
import { npm } from './npm';
import { markdown } from './markdown';
import { python } from './python';

/** Which kind of host a document is, from its language id, its file name and, when given, its first line (a bats shebang). */
export function hostKind(languageId: string, fileName: string, text?: string): HostKind | undefined {
  const base = fileName.split(/[\\/]/).pop()!;
  if (languageId === 'bats' || /\.bats$/i.test(base) || (text !== undefined && BATS_SHEBANG.test(text))) return 'bats';
  if (languageId === 'dockerfile' || /^(Dockerfile|Containerfile)(\..*)?$|\.(dockerfile|containerfile)$/i.test(base)) return 'dockerfile';
  if (languageId === 'makefile' || /^(GNU)?makefile$|\.mk$/i.test(base)) return 'makefile';
  if (base === 'package.json') return 'npm';
  if (languageId === 'yaml' || languageId === 'github-actions-workflow' || /\.ya?ml$/i.test(base)) return 'yaml';
  if (languageId === 'markdown' || /\.md$/i.test(base)) return 'markdown';
  if (languageId === 'python' || /\.py$/i.test(base)) return 'python';
  if (languageId === 'jenkinsfile' || /^Jenkinsfile(\..*)?$|\.jenkinsfile$/i.test(base)) return 'jenkinsfile';
  return undefined;
}

/** `#!/usr/bin/env bats`, `#!/usr/local/bin/bats`: bats as the program of the first line. */
export const BATS_SHEBANG = /^#![^\n]*[ \t/]bats(?=[ \t\r\n]|$)/;

export function extractShell(kind: HostKind, text: string): Extracted {
  // (A host file's own OPEN_TEXT and CLOSE_TEXT are masked here too: the labels of its lines are made from its text.)
  const b = new Builder(maskCarried(text), kind);
  switch (kind) {
    case 'dockerfile': dockerfile(b); break;
    case 'makefile': makefile(b); break;
    case 'yaml': yaml(b); break;
    case 'npm': npm(b); break;
    case 'markdown': markdown(b); break;
    case 'python': python(b); break;
    case 'jenkinsfile': jenkinsfile(b); break;
    case 'bats': bats(b); break;
  }
  return b.build();
}


export { batsTestName } from './bats';
export { remapExplanation, substitutionNotes, explainHostedLine, hostIssues, type DocIssue } from './remap';
export { flagsAsCount, hasParts, hostPartAt, type HostPart, languageLines, literalOf, patternOf, regionAt, regionShell } from './scripts';
