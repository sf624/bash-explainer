import { detectShell, Shell } from './dialect';
import type { Shells, ShellDocument } from './document';
import { Extracted, extractShell, HostKind, hostKind } from './hosts';
import type { Settings } from './settings';
import type { SyntaxTree } from './syntax/tree';

// What every product does to open a document: which kind of file it is, its lines, its shell code and its
// parse tree. The VS Code extension, the command-line tool, the Language Server and the web page call
// these and keep only their own wiring (where the text and the file name come from, caching).

/** The kinds of file a document can be read as: a shell script, or a file with shell code in it. */
export type FileKind = 'shell' | HostKind;

/** One kind of file with embedded shell code, in the order of the `embedded.files` setting. */
export interface HostFile {
  /** The name the `embedded.files` setting gives it (`packageJson` for the `npm` kind). */
  setting: string;
  /** VS Code language IDs of its files. */
  languages: readonly string[];
  /** More language IDs that start the extension (their files are told by name, as `json` for package.json). */
  activateOn: readonly string[];
  /** Globs of its files by name, for the document selector. */
  patterns: readonly string[];
}

/** The one list of the kinds of file with embedded shell code (the compiler checks that none is missing). */
export const HOST_FILES: Record<HostKind, HostFile> = {
  dockerfile: { setting: 'dockerfile', languages: ['dockerfile'], activateOn: [], patterns: ['**/{Dockerfile,Containerfile}*'] },
  makefile: { setting: 'makefile', languages: ['makefile'], activateOn: [], patterns: ['**/{Makefile,GNUmakefile,*.mk}'] },
  yaml: { setting: 'yaml', languages: ['yaml', 'github-actions-workflow'], activateOn: [], patterns: [] },
  npm: { setting: 'packageJson', languages: [], activateOn: ['json'], patterns: ['**/package.json'] },
  markdown: { setting: 'markdown', languages: ['markdown'], activateOn: [], patterns: [] },
  python: { setting: 'python', languages: ['python'], activateOn: [], patterns: [] },
  jenkinsfile: { setting: 'jenkinsfile', languages: ['groovy', 'jenkinsfile'], activateOn: [], patterns: [] },
  bats: { setting: 'bats', languages: ['bats'], activateOn: [], patterns: ['**/*.bats'] },
};

export const HOST_KINDS = Object.keys(HOST_FILES) as HostKind[];

/** Every kind of file, the shell script first. */
export const FILE_KINDS: readonly FileKind[] = ['shell', ...HOST_KINDS];

/** Kinds of files with embedded shell code, as named in the `embedded.files` setting. */
export const EMBEDDED_FILES = Object.values(HOST_FILES).map((f) => f.setting);

/** The language IDs of the host files (the document selector). */
export const HOST_LANGUAGES = Object.values(HOST_FILES).flatMap((f) => f.languages);

/**
 * The host kinds whose files have a semantic token provider of their own in common use: Pylance for Python, and the
 * Dockerfile language server of the Docker extension. VS Code uses one provider's tokens for a whole file, so ours would
 * replace theirs, and a `semanticTokenScopes` entry for their language would remap their tokens: we send none for these.
 */
const OWN_SEMANTIC_KINDS: readonly HostKind[] = ['python', 'dockerfile'];

/** The language IDs of the host kinds with a semantic token provider of their own (`OWN_SEMANTIC_KINDS`). */
export const OWN_SEMANTIC_LANGUAGES: readonly string[] = OWN_SEMANTIC_KINDS.flatMap((k) => HOST_FILES[k].languages);

/** The host files our semantic tokens are sent for. */
const SEMANTIC_HOSTS = (Object.keys(HOST_FILES) as HostKind[]).filter((k) => !OWN_SEMANTIC_KINDS.includes(k)).map((k) => HOST_FILES[k]);

/**
 * The language IDs our semantic tokens are sent for (the entries of `semanticTokenScopes` in package.json, which a test
 * compares): `shellscript`, and those of the host files without a provider of their own, with those that only start the
 * extension (`json`, for package.json, which `semanticSelector` matches by name). Languages added through the `languages`
 * setting have no entry.
 */
export const SEMANTIC_LANGUAGES: readonly string[] = ['shellscript', ...SEMANTIC_HOSTS.flatMap((f) => [...f.languages, ...f.activateOn])];

/**
 * The documents our semantic tokens are sent for: the shell languages of the setting and the host files of
 * `SEMANTIC_HOSTS`, by language or by name, never those of `OWN_SEMANTIC_KINDS` (not even when the setting names their
 * language, or by their file names).
 */
export function semanticSelector(languages: readonly string[]): ({ language: string } | { pattern: string })[] {
  const ids = new Set([...languages.filter((l) => !OWN_SEMANTIC_LANGUAGES.includes(l)), ...SEMANTIC_HOSTS.flatMap((f) => f.languages)]);
  return [...[...ids].map((language) => ({ language })), ...SEMANTIC_HOSTS.flatMap((f) => f.patterns).map((pattern) => ({ pattern }))];
}

/** The language IDs that start the extension: `shellscript` and those of the host files. */
export const ACTIVATION_LANGUAGES = ['shellscript', ...Object.values(HOST_FILES).flatMap((f) => [...f.languages, ...f.activateOn])];

/** The globs of the host files named by their file names. */
export const HOST_PATTERNS = Object.values(HOST_FILES).flatMap((f) => f.patterns);

/** What a document is, as the editor or the caller knows it. */
export interface DocumentInfo {
  languageId: string;
  fileName: string;
  /** The text, or at least its first line (for a `#!/usr/bin/env bats` line). */
  text?: string;
}

/**
 * How a document is read: `shell` for a shell script, a host kind for a file with shell code in it
 * (when `embedded.files` lists it), undefined when it has nothing for us. A language in `shellLanguages`
 * (the `languages` setting, and for the Language Server the IDs editors use) is a shell script; a bats
 * file is one also in a shell language.
 */
export function kindOfDocument(doc: DocumentInfo, settings: Pick<Settings, 'languages' | 'embedded.files'>, shellLanguages: readonly string[] = settings.languages): FileKind | undefined {
  // (Some editors call a Makefile `make`.)
  const found = hostKind(doc.languageId === 'make' ? 'makefile' : doc.languageId, doc.fileName, doc.text);
  const host = found && settings['embedded.files'].includes(HOST_FILES[found].setting) ? found : undefined;
  if (host !== 'bats' && shellLanguages.includes(doc.languageId)) return 'shell';
  return host;
}

/**
 * The document as the explainers see it. `parse` reads the shell text (the text itself, or the shell parts
 * of a host file); `extracted` is given when the caller has it cached.
 */
export function openDocument(text: string, kind: FileKind, parse: (shellText: string) => SyntaxTree, extracted?: Extracted): ShellDocument {
  const lines = text.split(/\r?\n/);
  if (kind === 'shell') return { lines, tree: parse(text) };
  const hosted = extracted ?? extractShell(kind, text);
  return { lines, extracted: hosted, tree: parse(hosted.text) };
}

/** The shell chosen by the user (`forced`), and the one the file says (shebang, ShellCheck directive, file name). */
export function shellsOf(lines: readonly string[], fileName: string, forced: Shell | undefined): Shells {
  return { forced, detected: detectShell(lines.slice(0, 50).join('\n'), fileName) };
}
