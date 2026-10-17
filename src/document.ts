import { Analyzer, ExplainOptions, LineExplanation } from './analyzer';
import { dialectIssues, Shell } from './dialect';
import { parseDirectives, suppressed } from './directives';
import { Fix, fixFor } from './fixes';
import { DocIssue, explainHostedLine, Extracted, hostIssues } from './hosts';
import { Lang } from './i18n';
import type { Tree } from './parser';

// What the extension and the web page share: explaining a line and finding the problems of a
// document, given its text and parse tree. Nothing here depends on VS Code.

/** A document as the explainers see it. */
export interface ShellDocument {
  lines: string[];
  /** The shell parts of a host file (Dockerfile, Makefile…); `tree` is then the tree of their text. */
  extracted?: Extracted;
  tree: Tree;
}

export type DocumentIssue = DocIssue & { fix?: Fix };

export interface Shells {
  /** The shell chosen by the user (setting or panel), which wins over the file. */
  forced?: Shell;
  /** The shell the file says (shebang, ShellCheck directive, file name). */
  detected?: Shell;
}

export function explainDocumentLine(analyzer: Analyzer, doc: ShellDocument, line: number, lang: Lang, shells: Shells, opts: ExplainOptions): LineExplanation {
  if (doc.extracted) {
    return explainHostedLine(analyzer, doc.tree, doc.extracted, doc.lines, line, lang, shells.forced, opts)
      ?? { line, summary: '', items: [], context: [], notes: [], examples: [] };
  }
  return analyzer.explainLine(doc.tree, line, shells.forced ?? shells.detected, opts);
}

/**
 * Problems in the whole document, with quick fixes for shell scripts. Codes in `ignore`, and
 * those turned off by `# bash-explainer disable=` comments in the file, are left out.
 */
export function documentIssues(doc: ShellDocument, lang: Lang, shells: Shells, ignore: readonly string[] = []): DocumentIssue[] {
  const skip = new Set(ignore);
  const directives = parseDirectives(doc.lines);
  return allIssues(doc, lang, shells).filter((i) => !skip.has(i.code) && !suppressed(directives, i.startLine, i.code));
}

function allIssues(doc: ShellDocument, lang: Lang, shells: Shells): DocumentIssue[] {
  if (doc.extracted) {
    return doc.extracted.regions.length ? hostIssues(doc.tree, doc.extracted, doc.lines, lang, shells.forced) : [];
  }
  const shell = shells.forced ?? shells.detected;
  if (!shell || shell === 'bash') return [];
  return dialectIssues(doc.tree.rootNode, shell, lang).map((i) => {
    const n = i.node;
    const sameLine = n.startPosition.row === n.endPosition.row;
    return {
      code: i.id, severity: i.kind === 'unsupported' ? 'warning' : 'info', message: i.message, fix: fixFor(i),
      startLine: n.startPosition.row, startCol: n.startPosition.column,
      endLine: n.startPosition.row, endCol: sameLine ? n.endPosition.column : doc.lines[n.startPosition.row].length,
    };
  });
}
