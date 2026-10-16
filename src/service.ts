import * as vscode from 'vscode';
import { Analyzer, LineExplanation } from './analyzer';
import { detectShell, Shell, SHELL_NAMES } from './dialect';
import { Lang, resolveLang } from './i18n';
import { TreeCache } from './parser';
import type { ExamplePlacement, Feature } from './ui/render';

/** Shared access to settings and per-document parse trees for all display modes. */
export class ExplainService implements vscode.Disposable {
  private analyzers = new Map<Lang, Analyzer>();

  constructor(private trees: TreeCache) {}

  get config() {
    return vscode.workspace.getConfiguration('bashExplain');
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

  isTarget(doc: vscode.TextDocument | undefined): doc is vscode.TextDocument {
    return !!doc && this.languages.includes(doc.languageId);
  }

  /** The shell the document is written for: the `shell` setting, else detected from the file. */
  shellOf(doc: vscode.TextDocument): Shell | undefined {
    const set = this.config.get<string>('shell', 'auto');
    if (set !== 'auto' && set in SHELL_NAMES) return set as Shell;
    return detectShell(doc.getText(new vscode.Range(0, 0, 50, 0)), doc.fileName);
  }

  explain(doc: vscode.TextDocument, line: number): LineExplanation {
    const tree = this.trees.get(doc.uri.toString(), doc.version, () => doc.getText());
    const lang = this.lang;
    let analyzer = this.analyzers.get(lang);
    if (!analyzer) this.analyzers.set(lang, (analyzer = new Analyzer(lang)));
    return analyzer.explainLine(tree, line, this.shellOf(doc));
  }

  forget(doc: vscode.TextDocument): void {
    this.trees.evict(doc.uri.toString());
  }

  dispose(): void {
    this.trees.dispose();
  }
}
