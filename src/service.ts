import * as vscode from 'vscode';
import { Analyzer } from './analyzer';
import type { ExplainOptions, LineExplanation } from './analyzer-types';
import { readShell, Shell, type ShellReading } from './dialect';
import { DeadRange, DocumentIssue, diagnosticsFor, explainDocumentLine, ShellDocument, Shells } from './document';
import { HOST_LANGUAGES, HOST_PATTERNS, kindOfDocument, openDocument, semanticSelector } from './document-setup';
import { Extracted, extractShell, HostKind } from './hosts';
import { Lang, resolveLang } from './i18n';
import { explainOptions, forcedShell, Settings, settingsFromEditor } from './settings';
import type { TreeCache } from './syntax/cache';
import type { ExamplePlacement, Feature } from './ui/render';

/** Shared access to settings and per-document parse trees for all display modes. */
export class ExplainService implements vscode.Disposable {
  private cached: Settings | undefined;
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

  /** The setting behind each display feature. */
  static readonly FEATURES: Record<Feature, 'hover.enabled' | 'panel.autoOpen'> = {
    hover: 'hover.enabled',
    panel: 'panel.autoOpen',
  };

  /** The settings in effect, read as the other products read theirs (defaults from src/settings.ts). */
  get settings(): Settings {
    return (this.cached ??= settingsFromEditor((key) => this.config.get(key)));
  }

  /** Reads the settings again (after a change in the configuration). */
  settingsChanged(): void {
    this.cached = undefined;
  }

  enabled(feature: Feature): boolean {
    return this.settings[ExplainService.FEATURES[feature]];
  }

  /** Whether the panel animates its rows (`panel.animations`; the panel also follows reduced motion). */
  get panelAnimations(): boolean {
    return this.settings['panel.animations'];
  }

  /** Where the panel's role colours come from (`panel.colors`). */
  get panelColours(): Settings['panel.colors'] {
    return this.settings['panel.colors'];
  }

  get examplePlacement(): ExamplePlacement {
    return this.settings['examples.placement'];
  }

  get lang(): Lang {
    return resolveLang(this.settings.language, vscode.env.language);
  }

  get languages(): string[] {
    return this.settings.languages;
  }

  /** A shell script, or a file with embedded shell code (Dockerfile, Makefile, CI YAML…). */
  isTarget(doc: vscode.TextDocument | undefined): doc is vscode.TextDocument {
    return !!doc && this.kindOf(doc) !== undefined;
  }

  /** The kind of host file, when embedded shell code is explained. */
  hostOf(doc: vscode.TextDocument): HostKind | undefined {
    const kind = this.kindOf(doc);
    return kind === 'shell' ? undefined : kind;
  }

  private kindOf(doc: vscode.TextDocument) {
    return kindOfDocument({ languageId: doc.languageId, fileName: doc.fileName, text: doc.lineAt(0).text }, this.settings);
  }

  /** The documents that may have shell code: the shell languages, and the kinds of files with embedded code (`isTarget` tells). */
  selector(): vscode.DocumentSelector {
    return [
      ...this.languages.map((language) => ({ language })),
      ...HOST_LANGUAGES.map((language) => ({ language })),
      ...HOST_PATTERNS.map((pattern) => ({ pattern })),
    ];
  }

  /** `selector()` without the host files that have a semantic token provider of their own (Python, Dockerfile). */
  semanticSelector(): vscode.DocumentSelector {
    return semanticSelector(this.languages);
  }

  /**
   * Whether our colours are on for this document: `highlight.enabled`, which a user can set per language
   * (`"[makefile]": { "bashExplainer.highlight.enabled": false }`); VS Code reads the override of the document's language.
   */
  highlightEnabled(doc: vscode.TextDocument): boolean {
    return vscode.workspace.getConfiguration('bashExplainer', doc).get<boolean>('highlight.enabled', true);
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
    const reading = this.shellReading(doc);
    return reading.source === 'default' ? undefined : reading.shell;
  }

  /** The shell the file itself says and where that comes from (`default`: it says none). */
  shellReading(doc: vscode.TextDocument): ShellReading {
    return readShell(doc.getText(new vscode.Range(0, 0, 50, 0)), doc.fileName);
  }

  /** The shell chosen in the panel for this document, else the `shell` setting (undefined: auto). */
  forcedShell(doc: vscode.TextDocument): Shell | undefined {
    const chosen = this.overrides.get(doc.uri.toString())?.shell;
    if (chosen) return chosen;
    return forcedShell(this.settings);
  }

  /** The yq chosen in the panel for this document, else the `yq.flavor` setting. */
  yqFlavorOf(doc: vscode.TextDocument): string {
    return this.overrides.get(doc.uri.toString())?.yq ?? this.settings['yq.flavor'];
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

  /** The explanation of a line; with `reading`, its reading tree too (the panel's tree view). */
  explain(doc: vscode.TextDocument, line: number, reading = false): LineExplanation {
    const lang = this.lang;
    let analyzer = this.analyzers.get(lang);
    if (!analyzer) this.analyzers.set(lang, (analyzer = new Analyzer(lang)));
    return explainDocumentLine(analyzer, this.document(doc), line, lang, this.shells(doc), { ...this.explainOptions(doc), reading });
  }

  /** The document's lines and parse tree; for a host file, the tree of its shell parts. */
  document(doc: vscode.TextDocument): ShellDocument {
    const kind = this.hostOf(doc);
    const key = doc.uri.toString() + (kind ? '#shell' : '');
    return openDocument(doc.getText(), kind ?? 'shell', (text) => this.trees.get(key, doc.version, () => text), kind && this.extractedOf(doc, kind));
  }

  /** The shells a document is explained with: the one chosen (panel, setting) and the one the file says. */
  shells(doc: vscode.TextDocument): Shells {
    return { forced: this.forcedShell(doc), detected: this.detectedShell(doc) };
  }

  private explainOptions(doc: vscode.TextDocument): ExplainOptions {
    return { ...explainOptions(this.settings), yqFlavor: this.yqFlavorOf(doc) };
  }

  /** Problems in the whole document for the Problems panel, with quick fixes for shell scripts. */
  issues(doc: vscode.TextDocument): DocumentIssue[] {
    return diagnosticsFor(() => this.document(doc), () => this.shells(doc), this.lang, this.settings, 'vscode', { yqFlavor: this.yqFlavorOf(doc) }).shown;
  }

  /** The ranges of code that never runs, which the editor fades (none with `hints.deadCode` off). */
  faded(doc: vscode.TextDocument): DeadRange[] {
    return diagnosticsFor(() => this.document(doc), () => this.shells(doc), this.lang, this.settings, 'vscode').faded;
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
