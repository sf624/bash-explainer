import * as vscode from 'vscode';
import { Analyzer, ExplainOptions, LineExplanation } from './analyzer';
import { detectShell, Shell, SHELL_NAMES } from './dialect';
import { dialectIssues } from './dialect';
import { Fix, fixFor } from './fixes';
import { DocIssue, explainHostedLine, Extracted, extractShell, HostKind, hostKind, hostIssues } from './hosts';
import { Lang, resolveLang } from './i18n';
import { TreeCache } from './parser';
import type { ExamplePlacement, Feature } from './ui/render';

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
    if (this.languages.includes(doc.languageId) || !this.config.get<boolean>('embedded.enabled', true)) return undefined;
    return hostKind(doc.languageId, doc.fileName);
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
    const kind = this.hostOf(doc);
    if (kind) {
      const extracted = this.extractedOf(doc, kind);
      const tree = this.trees.get(`${doc.uri.toString()}#shell`, doc.version, () => extracted.text);
      const ex = explainHostedLine(analyzer, tree, extracted, doc.getText().split(/\r?\n/), line, lang, this.forcedShell(doc), this.explainOptions(doc));
      return ex ?? { line, summary: '', items: [], context: [], notes: [], examples: [] };
    }
    const tree = this.trees.get(doc.uri.toString(), doc.version, () => doc.getText());
    return analyzer.explainLine(tree, line, this.shellOf(doc), this.explainOptions(doc));
  }

  private explainOptions(doc: vscode.TextDocument): ExplainOptions {
    return { yqFlavor: this.yqFlavorOf(doc) };
  }

  /** Problems in the whole document for the Problems panel, with quick fixes for shell scripts. */
  issues(doc: vscode.TextDocument): (DocIssue & { fix?: Fix })[] {
    const lang = this.lang;
    const kind = this.hostOf(doc);
    const override = this.forcedShell(doc);
    if (kind) {
      const extracted = this.extractedOf(doc, kind);
      if (!extracted.regions.length) return [];
      const tree = this.trees.get(`${doc.uri.toString()}#shell`, doc.version, () => extracted.text);
      return hostIssues(tree, extracted, doc.getText().split(/\r?\n/), lang, override);
    }
    const shell = this.shellOf(doc);
    if (!shell || shell === 'bash') return [];
    const tree = this.trees.get(doc.uri.toString(), doc.version, () => doc.getText());
    return dialectIssues(tree.rootNode, shell, lang).map((i) => {
      const n = i.node;
      const sameLine = n.startPosition.row === n.endPosition.row;
      return {
        code: i.id, severity: i.kind === 'unsupported' ? 'warning' : 'info', message: i.message, fix: fixFor(i),
        startLine: n.startPosition.row, startCol: n.startPosition.column,
        endLine: n.startPosition.row, endCol: sameLine ? n.endPosition.column : doc.lineAt(n.startPosition.row).text.length,
      };
    });
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
