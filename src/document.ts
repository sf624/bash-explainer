import { Analyzer, ExplainOptions, LineExplanation, nestedScripts } from './analyzer';
import { dialectIssues, Shell } from './dialect';
import { parseDirectives, suppressed } from './directives';
import { Fix, fixFor } from './fixes';
import { DocIssue, explainHostedLine, Extracted, hostIssues } from './hosts';
import { Lang } from './i18n';
import type { NestedScript } from './semantics/nested';
import { settingSpec } from './settings';
import type { Settings, Surface } from './settings';
import type { Point, SyntaxTree } from './syntax/tree';

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

/**
 * The problems of a document (`open` gives it, `shellsOf` its shells) under the settings: `shown` (none while `diagnostics.enabled` is off, where the
 * surface has it; none in the shell code of another file while `diagnostics.embedded` is off; without the
 * codes in `diagnostics.ignore`) and `all` (what the document has, whatever the settings say, found only when
 * asked for; the codes the file itself turns off are left out in both).
 */
export function diagnosticsFor(open: () => ShellDocument | undefined, shellsOf: (doc: ShellDocument) => Shells, lang: Lang, settings: Settings, surface: Surface): { readonly all: DocumentIssue[]; shown: DocumentIssue[] } {
  let doc: ShellDocument | undefined;
  let found: DocumentIssue[] | undefined;
  // (The document is opened, that is parsed, only when its problems are looked at.)
  const all = () => (found ??= (doc ??= open()) ? documentIssues(doc, lang, shellsOf(doc)) : []);
  const disabled = settingSpec('diagnostics.enabled')!.surfaces.includes(surface) && !settings['diagnostics.enabled'];
  const ignore = new Set(settings['diagnostics.ignore']);
  const shown = () => {
    if (disabled) return [];
    const list = all();
    return doc?.extracted !== undefined && !settings['diagnostics.embedded'] ? [] : list.filter((i) => !ignore.has(i.code));
  };
  return { get all() { return all(); }, shown: shown() };
}

/**
 * A problem's message as the Problems panel and the editors show it: without the ⚠ / ℹ it starts with in the
 * explanations (and, with `backticks: false`, without the backticks that mark code, for plain text).
 */
export function plain(message: string, opts: { backticks?: boolean } = {}): string {
  const text = message.replace(/^[⚠ℹ]\uFE0F?\s*/u, '');
  return opts.backticks === false ? text.replace(/`/g, '') : text;
}

function allIssues(doc: ShellDocument, lang: Lang, shells: Shells): DocumentIssue[] {
  if (doc.extracted) {
    return doc.extracted.regions.length ? hostIssues(doc.tree, doc.extracted, doc.lines, lang, shells.forced) : [];
  }
  const crlf = crlfIssue(doc.tree, lang);
  const shell = shells.forced ?? shells.detected;
  const nested = nestedIssues(doc, lang, shell);
  if (!shell || shell === 'bash') return [...crlf, ...nested];
  return [...crlf, ...nested, ...dialectIssues(doc.tree, shell, lang).map((i): DocumentIssue => {
    const n = i.place;
    const sameLine = n.startPosition.row === n.endPosition.row;
    return {
      code: i.id, severity: i.kind === 'unsupported' ? 'warning' : 'info', message: i.message, fix: fixFor(i),
      startLine: n.startPosition.row, startCol: n.startPosition.column,
      endLine: n.startPosition.row, endCol: sameLine ? n.endPosition.column : doc.lines[n.startPosition.row].length,
    };
  })];
}

/**
 * The dialect issues of the strings run as scripts by a shell other than bash (`sh -c '[[ … ]]'`, an `eval` string in
 * an sh script), at their places in the document (docs/design/semantics.md, 4.13).
 */
function nestedIssues(doc: ShellDocument, lang: Lang, shell: Shell | undefined): DocumentIssue[] {
  const out: DocumentIssue[] = [];
  const starts = lineStarts(doc.tree.text);
  const at = (i: number) => {
    const line = lineOf(starts, i);
    return { line, col: i - starts[line] };
  };
  // (The strings in a string are read only when one may be read by a shell other than bash: another shell it starts,
  // or its own `eval` and traps when it is not bash. Reading them builds the string's model.)
  const descend = (s: NestedScript) => /\b(?:sh|dash|zsh|ksh|watch)\b/.test(s.text) || (!!s.shell && s.shell !== 'bash' && /\b(?:eval|trap)\b/.test(s.text));
  for (const { script, source } of nestedScripts(doc.tree, shell, descend)) {
    if (!script.shell || script.shell === 'bash') continue;
    // (The issues give places as positions in the string's text.)
    const rows = lineStarts(script.tree.text);
    const index = (p: Point) => rows[p.row] + p.column;
    for (const i of dialectIssues(script.tree, script.shell, lang)) {
      const start = at(source(index(i.place.startPosition), false));
      const end = at(source(index(i.place.endPosition), true));
      out.push({
        code: i.id, severity: i.kind === 'unsupported' ? 'warning' : 'info', message: i.message,
        startLine: start.line, startCol: start.col, endLine: start.line, endCol: end.line === start.line ? end.col : doc.lines[start.line].length,
      });
    }
  }
  return out;
}

/** Where each line of `text` starts. */
function lineStarts(text: string): number[] {
  const out = [0];
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) out.push(i + 1);
  return out;
}

/** The line (from 0) that offset `i` is on, given where the lines start. */
function lineOf(starts: readonly number[], i: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= i) lo = mid;
    else hi = mid - 1;
  }
  return lo;
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
