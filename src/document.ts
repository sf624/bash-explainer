import { Analyzer, ExplainOptions, LineExplanation } from './analyzer';
import { dialectIssues, Shell } from './dialect';
import { parseDirectives, suppressed } from './directives';
import { Fix, fixFor } from './fixes';
import { DocIssue, explainHostedLine, Extracted, hostIssues } from './hosts';
import { Lang } from './i18n';
import type { SyntaxTree } from './syntax/tree';

// What the extension and the web page share: explaining a line and finding the problems of a
// document, given its text and parse tree. Nothing here depends on VS Code.

/** A document as the explainers see it. */
export interface ShellDocument {
  lines: string[];
  /** The shell parts of a host file (Dockerfile, Makefile…); `tree` is then the tree of their text. */
  extracted?: Extracted;
  tree: SyntaxTree;
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
  const crlf = crlfIssue(doc.tree, lang);
  const shell = shells.forced ?? shells.detected;
  if (!shell || shell === 'bash') return crlf;
  return [...crlf, ...dialectIssues(doc.tree, shell, lang).map((i): DocumentIssue => {
    const n = i.place;
    const sameLine = n.startPosition.row === n.endPosition.row;
    return {
      code: i.id, severity: i.kind === 'unsupported' ? 'warning' : 'info', message: i.message, fix: fixFor(i),
      startLine: n.startPosition.row, startCol: n.startPosition.column,
      endLine: n.startPosition.row, endCol: sameLine ? n.endPosition.column : doc.lines[n.startPosition.row].length,
    };
  })];
}

const CRLF: [string, string] = [
  'この行の改行は CRLF（Windows 形式）で、bash は行末の CR を最後の単語の一部として読む。`fi` が `fi\\r` になって「command not found」や構文エラーになるので、LF に変換する。そのままにしてこの警告だけ出さないなら、独立した行に `# bash-explainer disable-file=crlf` と書く。',
  'This file has Windows line endings (CRLF). bash reads the CR at the end of a line as part of its last word, so `fi` becomes `fi\\r` and the script fails with "command not found" or a syntax error. Convert it to LF. To keep the file as it is and silence this warning, write `# bash-explainer disable-file=crlf` on a line of its own.',
];

/** A script with CRLF line ends fails in bash; the issue is shown once, on the last word of the first line that has one (the CR itself lies past the end of the line). */
function crlfIssue(tree: SyntaxTree, lang: Lang): DocumentIssue[] {
  const at = tree.carriageReturns?.[0];
  if (at === undefined) return [];
  const before = tree.text.slice(0, at);
  const line = before.split('\n').length - 1;
  // (In the tree the CR is a blank, so the last word is the one before it; a line of nothing else has no word.)
  const text = before.slice(before.lastIndexOf('\n') + 1).trimEnd();
  const word = /\S+$/.exec(text);
  return [{ code: 'crlf', severity: 'warning', message: CRLF[lang === 'ja' ? 0 : 1], startLine: line, startCol: word?.index ?? 0, endLine: line, endCol: word ? text.length : 0 }];
}
