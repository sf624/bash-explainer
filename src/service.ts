import * as vscode from 'vscode';
import { Analyzer, ExplainOptions, LineExplanation } from './analyzer';
import { detectShell, Shell, SHELL_NAMES } from './dialect';
import { DocumentIssue, documentIssues, explainDocumentLine, ShellDocument, Shells } from './document';
import { Extracted, extractShell, HostKind, hostKind } from './hosts';
import { Lang, resolveLang } from './i18n';
import type { TreeCache } from './syntax/cache';
import type { ExamplePlacement, Feature } from './ui/render';

/** Kinds of files with embedded shell code, as named in the `embedded.files` setting. */
export const EMBEDDED_FILES = ['dockerfile', 'makefile', 'yaml', 'packageJson', 'markdown', 'python', 'jenkinsfile'] as const;

/** Shared access to settings and per-document parse trees for all display modes. */
export class ExplainService implements vscode.Disposable {
  private analyzers = new Map<Lang, Analyzer>();
  private overrides = new Map<string, { shell?: Shell; yq?: string }>();
  private changed = new vscode.EventEmitter<vscode.TextDocument>();
  /** Fires when a choice made in the panel changes how a document is explained. */
  readonly onDidChangeOverrides = this.changed.event;
  private extracted = new Map<string, { version: number; value: Extracted }>();

  constructor(private trees: TreeCache) {}

  get config() {
    return vscode.workspace.getConfiguration('bashExplainer');
  }

  /** The setting behind each display feature, and its default. */
  static readonly FEATURES: Record<Feature, [string, boolean]> = {
    hover: ['hover.enabled', true],
    inline: ['inline.enabled', false],
    panel: ['panel.autoOpen', false],
  };

  enabled(feature: Feature): boolean {
    const [key, def] = ExplainService.FEATURES[feature];
    return this.config.get<boolean>(key, def);
  }

  get examplePlacement(): ExamplePlacement {
    const v = this.config.get<string>('examples.placement', 'first');
    return v === 'last' || v === 'bottom' ? v : 'first';
  }

  get lang(): Lang {
    return resolveLang(this.config.get<string>('language'), vscode.env.language);
  }

  get languages(): string[] {
    return this.config.get<string[]>('languages', ['shellscript']);
  }

  /** A shell script, or a file with embedded shell code (Dockerfile, Makefile, CI YAML…). */
  isTarget(doc: vscode.TextDocument | undefined): doc is vscode.TextDocument {
    return !!doc && (this.languages.includes(doc.languageId) || !!this.hostOf(doc));
  }

  /** The kind of host file, when embedded shell code is explained. */
  hostOf(doc: vscode.TextDocument): HostKind | undefined {
    if (this.languages.includes(doc.languageId)) return undefined;
    const kind = hostKind(doc.languageId, doc.fileName);
    // The setting names package.json files `packageJson`.
    const files = this.config.get<string[]>('embedded.files', [...EMBEDDED_FILES]);
    return kind && files.includes(kind === 'npm' ? 'packageJson' : kind) ? kind : undefined;
  }

  /** The shell parts of a host document (cached per version). */
  extractedOf(doc: vscode.TextDocument, kind: HostKind): Extracted {
    const key = doc.uri.toString();
    const hit = this.extracted.get(key);
    if (hit && hit.version === doc.version) return hit.value;
    const value = extractShell(kind, doc.getText());
    this.extracted.set(key, { version: doc.version, value });
    return value;
  }

  /** Whether the document has anything to explain (a host file may have no shell code). */
  hasShell(doc: vscode.TextDocument): boolean {
    const kind = this.hostOf(doc);
    return !kind || this.extractedOf(doc, kind).regions.length > 0;
  }

  /** The shell the document is written for: the `shell` setting, else detected from the file. */
  shellOf(doc: vscode.TextDocument): Shell | undefined {
    return this.forcedShell(doc) ?? this.detectedShell(doc);
  }

  /** The shell the file itself says (shebang, ShellCheck directive, file name). */
  detectedShell(doc: vscode.TextDocument): Shell | undefined {
    return detectShell(doc.getText(new vscode.Range(0, 0, 50, 0)), doc.fileName);
  }

  /** The shell chosen in the panel for this document, else the `shell` setting (undefined: auto). */
  forcedShell(doc: vscode.TextDocument): Shell | undefined {
    const chosen = this.overrides.get(doc.uri.toString())?.shell;
    if (chosen) return chosen;
    const set = this.config.get<string>('shell', 'auto');
    return set !== 'auto' && set in SHELL_NAMES ? (set as Shell) : undefined;
  }

  /** The yq chosen in the panel for this document, else the `yq.flavor` setting. */
  yqFlavorOf(doc: vscode.TextDocument): string {
    return this.overrides.get(doc.uri.toString())?.yq ?? this.config.get<string>('yq.flavor', 'auto');
  }

  /** Choices made in the panel for one document, for this session ('auto' clears them). */
  override(doc: vscode.TextDocument, key: 'shell' | 'yq', value: string): void {
    const key0 = doc.uri.toString();
    const cur = { ...this.overrides.get(key0) };
    if (key === 'shell') cur.shell = value === 'auto' ? undefined : (value as Shell);
    else cur.yq = value === 'auto' ? undefined : value;
    this.overrides.set(key0, cur);
    this.changed.fire(doc);
  }

  overrideOf(doc: vscode.TextDocument): { shell?: Shell; yq?: string } {
    return this.overrides.get(doc.uri.toString()) ?? {};
  }

  explain(doc: vscode.TextDocument, line: number): LineExplanation {
    const lang = this.lang;
    let analyzer = this.analyzers.get(lang);
    if (!analyzer) this.analyzers.set(lang, (analyzer = new Analyzer(lang)));
    return explainDocumentLine(analyzer, this.shellDocument(doc), line, lang, this.shells(doc), this.explainOptions(doc));
  }

  /** The document's lines and parse tree; for a host file, the tree of its shell parts. */
  private shellDocument(doc: vscode.TextDocument): ShellDocument {
    const lines = doc.getText().split(/\r?\n/);
    const kind = this.hostOf(doc);
    if (!kind) return { lines, tree: this.trees.get(doc.uri.toString(), doc.version, () => doc.getText()) };
    const extracted = this.extractedOf(doc, kind);
    return { lines, extracted, tree: this.trees.get(`${doc.uri.toString()}#shell`, doc.version, () => extracted.text) };
  }

  private shells(doc: vscode.TextDocument): Shells {
    return { forced: this.forcedShell(doc), detected: this.detectedShell(doc) };
  }

  private explainOptions(doc: vscode.TextDocument): ExplainOptions {
    const c = this.config;
    return {
      yqFlavor: this.yqFlavorOf(doc),
      examples: { enabled: c.get<boolean>('examples.enabled', true), disabled: c.get<string[]>('examples.disabled', []) },
      idioms: c.get<boolean>('notes.idioms', true),
      pitfalls: c.get<boolean>('notes.pitfalls', true),
      customCommands: c.get<Record<string, unknown>>('customCommands', {}),
    };
  }

  /** Problems in the whole document for the Problems panel, with quick fixes for shell scripts. */
  issues(doc: vscode.TextDocument): DocumentIssue[] {
    if (this.hostOf(doc) && !this.config.get<boolean>('diagnostics.embedded', true)) return [];
    // Codes turned off in the settings, or by `# bash-explainer disable=` comments in the file.
    return documentIssues(this.shellDocument(doc), this.lang, this.shells(doc), this.config.get<string[]>('diagnostics.ignore', []));
  }

  forget(doc: vscode.TextDocument): void {
    this.trees.evict(doc.uri.toString());
    this.trees.evict(`${doc.uri.toString()}#shell`);
    this.extracted.delete(doc.uri.toString());
  }

  dispose(): void {
    this.changed.dispose();
    this.trees.dispose();
  }
}
