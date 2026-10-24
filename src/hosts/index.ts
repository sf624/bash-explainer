import type { Shell } from '../dialect';
import type { CommandSpec } from '../argv/spec';
import type { FactSpec } from '../messages';

/** Kinds of files whose shell snippets are explained. */
export type HostKind = 'dockerfile' | 'makefile' | 'yaml' | 'npm' | 'markdown' | 'python' | 'jenkinsfile' | 'bats';

/** A note on every line of a region: [ja, en], or a catalog fact (its `code` makes it a warning in the Problems panel). */
export type RegionNote = [ja: string, en: string] | { spec: FactSpec; code: string };

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
  /** Commands the host defines for its scripts (bats: `run`, `load`…), read with these specs before the dictionary. */
  commands?: Record<string, CommandSpec>;
  /**
   * The lines a test runner turns into functions (bats: `@test "…" {`), also inside a here-document or a string,
   * where bats rewrites them too.
   */
  tests?: number[];
}

/** Something the host replaces before the shell sees it (`$(CC)` in make, `${{ … }}` in GitHub Actions). */
export interface HostSubstitution {
  line: number;
  text: string;
  meaning: [string, string];
  /** A warning about the substitution (e.g. untrusted input pasted into a script). */
  warning?: FactSpec;
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
  inserted: [number, number, [string, string]?][][];
  regions: ShellRegion[];
  substitutions: HostSubstitution[];
}

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
  const b = new Builder(text, kind);
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
