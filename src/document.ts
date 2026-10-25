import { Analyzer } from './analyzer';
import type { ExplainOptions, LineExplanation } from './analyzer-types';
import type { BashVersion } from './bashversion';
import { dialectIssues, Shell } from './dialect';
import { parseDirectives, suppressed } from './directives';
import { Fix, fixFor } from './fixes';
import { DocIssue, explainHostedLine, Extracted, hostIssues } from './hosts';
import { Lang } from './i18n';
import { type NoteLevel, severityOf } from './messages';
import { pitfallFindings } from './pitfalls';
import { shellState, type StateModel } from './semantics/state';
import { type NestedScript, nestedScripts } from './semantics/nested';
import { settingSpec } from './settings';
import type { Settings, Surface } from './settings';
import { descendants, type Point, type SyntaxNode, type SyntaxTree } from './syntax/tree';
import { wordFindings } from './wordfacts';

// What the extension and the web page share: explaining a line and finding the problems of a
// document, given its text and parse tree. Nothing here depends on VS Code.

/** A document as the explainers see it. */
export interface ShellDocument {
  lines: string[];
  /** The shell parts of a host file (Dockerfile, Makefile…); `tree` is then the tree of their text. */
  extracted?: Extracted;
  tree: SyntaxTree;
}

/** `pitfall`: one of the pitfalls the explanations point out (`pitfallIssues`), not a construct the shell lacks. */
export type DocumentIssue = DocIssue & { fix?: Fix; pitfall?: true };

export interface Shells {
  /** The shell chosen by the user (setting or panel), which wins over the file. */
  forced?: Shell;
  /** The shell the file says (shebang, ShellCheck directive, file name). */
  detected?: Shell;
}

export function explainDocumentLine(analyzer: Analyzer, doc: ShellDocument, line: number, lang: Lang, shells: Shells, opts: ExplainOptions): LineExplanation {
  if (doc.extracted) {
    return explainHostedLine(analyzer, doc.tree, doc.extracted, doc.lines, line, lang, shells.forced, opts)
      ?? { line, summary: '', items: [], context: [], notes: [], noteInfo: [], examples: [] };
  }
  return analyzer.explainLine(doc.tree, line, shells.forced ?? shells.detected, opts);
}

/** A here-document operator (`<<EOF`): its line, and its place among the here-documents that start on that line. */
export interface HeredocAt { line: number; index: number }

/**
 * The here-document whose body, or closing delimiter, is on `line` (the hover explains its `<<EOF` there): from the
 * syntax tree, since the explanation's token of the operator covers only `<<EOF`.
 */
export function heredocAt(doc: ShellDocument, line: number): HeredocAt | undefined {
  const all = descendants(doc.tree.root, ['heredoc_redirect']);
  // (A here-document always has a body, empty while the delimiter is not written yet. The node ends with the closing line.)
  const h = all.find((n) => n.startPosition.row < line && n.namedChildren.find((c) => c.type === 'heredoc_body')!.startPosition.row <= line && line <= n.endPosition.row);
  return h && { line: h.startPosition.row, index: all.filter((n) => n.startPosition.row === h.startPosition.row).indexOf(h) };
}

/**
 * Problems in the whole document, with quick fixes for shell scripts, and (unless `pitfalls` is false) the pitfalls
 * of a shell script. Codes in `ignore`, and those turned off by `# bash-explainer disable=` comments in the file, are
 * left out.
 */
export function documentIssues(doc: ShellDocument, lang: Lang, shells: Shells, ignore: readonly string[] = [], opts: { pitfalls?: boolean; bashVersion?: BashVersion } = {}): DocumentIssue[] {
  const base = allIssues(doc, lang, shells, opts.bashVersion);
  const found = opts.pitfalls === false ? base : [...base, ...pitfallIssues(doc, lang, shells.forced ?? shells.detected, base)];
  return unsuppressed(doc, found, ignore);
}

/** The issues not turned off by `ignore` or the file's `# bash-explainer disable=` comments. */
function unsuppressed(doc: ShellDocument, issues: DocumentIssue[], ignore: readonly string[]): DocumentIssue[] {
  const skip = new Set(ignore);
  const directives = parseDirectives(doc.lines);
  return issues.filter((i) => !skip.has(i.code) && !suppressed(directives, i.startLine, i.code));
}

/**
 * The pitfalls of a shell script that its explanations point out (src/pitfalls.ts, and the pitfalls of
 * src/wordfacts.ts), as problems: each with its code, on the node it is about, `pitfall: true`. One walk of the
 * tree, with the script's one model, and one of each string it runs as a script (`bash -c '…'`, `eval`, a trap's
 * action), with the string's model and shell, at its place in the document. None in a host file, none on a line
 * `others` (the other problems) says is not parsed, and none where one of them already says the same.
 */
export function pitfallIssues(doc: ShellDocument, lang: Lang, shell: Shell | undefined, others: readonly DocumentIssue[] = []): DocumentIssue[] {
  if (doc.extracted) return [];
  const found: { code: string; start: Place; end: Place; text: string; level: NoteLevel }[] = [];
  const scan = (tree: SyntaxTree, model: StateModel, sh: Shell | undefined, place: (n: SyntaxNode, end: boolean) => Place) => {
    const last = tree.root.endPosition.row;
    const findings: { code: string; node: SyntaxNode; text: string; level: NoteLevel }[] = [
      ...pitfallFindings(tree.root, lang, 0, last, model, sh),
      ...wordFindings(tree.root, lang, model, sh, 0, last).filter((f) => f.fact.kind === 'pitfall').map((f) => ({ code: f.fact.id, node: f.node, text: f.fact.text, level: f.fact.level })),
    ];
    for (const { code, node, text, level } of findings) found.push({ code, start: place(node, false), end: place(node, true), text, level });
  };
  const point = (p: Point): Place => ({ line: p.row, col: p.column });
  scan(doc.tree, shellState(doc.tree, shell), shell, (n, end) => point(end ? n.endPosition : n.startPosition));
  const starts = lineStarts(doc.tree.text);
  for (const { script, source } of nestedScripts(doc.tree, shell)) {
    const rows = lineStarts(script.tree.text);
    const index = (p: Point) => rows[p.row] + p.column;
    scan(script.tree, script.model, script.shell, (n, end) => placeOf(starts, source(index(end ? n.endPosition : n.startPosition), end)));
  }
  // (zsh syntax that bash cannot read: the tree there is not the script's.)
  const unparsed = others.filter((i) => i.code === 'zshSyntax');
  const out: DocumentIssue[] = [];
  for (const { code, start, end, text, level } of found) {
    const { line } = start;
    const issue: DocumentIssue = {
      code, severity: severityOf(level), message: text, pitfall: true,
      startLine: line, startCol: start.col, endLine: line, endCol: end.line === line ? end.col : doc.lines[line].length,
    };
    if (unparsed.some((i) => i.startLine <= line && line <= i.endLine)) continue;
    // (Said already where it overlaps: the same problem.)
    const overlaps = (i: DocumentIssue) => i.startLine === line && i.startCol < issue.endCol && issue.startCol < i.endCol;
    if ([...others, ...out].some((i) => overlaps(i) && (i.code === code || i.message === text))) continue;
    out.push(issue);
  }
  return out;
}

/** A place in the document: its line and column, from 0. */
interface Place { line: number; col: number }

/** The place of offset `i` of the document's text, given where its lines start. */
function placeOf(starts: readonly number[], i: number): Place {
  const line = lineOf(starts, i);
  return { line, col: i - starts[line] };
}

/**
 * The problems of a document (`open` gives it, `shellsOf` its shells) under the settings: `shown` (none while `diagnostics.enabled` is off, where the
 * surface has it; none in the shell code of another file while `diagnostics.embedded` is off; without the
 * codes in `diagnostics.ignore`) and `all` (what the document has, whatever the settings say, found only when
 * asked for; the codes the file itself turns off are left out in both).
 */
export function diagnosticsFor(open: () => ShellDocument | undefined, shellsOf: (doc: ShellDocument) => Shells, lang: Lang, settings: Settings, surface: Surface): { readonly all: DocumentIssue[]; shown: DocumentIssue[] } {
  let doc: ShellDocument | undefined;
  let raw: DocumentIssue[] | undefined;
  let base: DocumentIssue[] | undefined;
  let found: DocumentIssue[] | undefined;
  // (The document is opened, that is parsed, only when its problems are looked at; its pitfalls are looked for only
  // when they are shown, or all the problems are asked for. They are weighed against the other problems before any is
  // turned off, as `documentIssues` does.)
  const rawIssues = () => (raw ??= (doc ??= open()) ? allIssues(doc, lang, shellsOf(doc), settings.bashVersion) : []);
  const without = () => {
    if (!base) {
      const list = rawIssues();
      base = doc ? unsuppressed(doc, list, []) : [];
    }
    return base;
  };
  const pitfallsOf = (d: ShellDocument) => {
    const shells = shellsOf(d);
    return unsuppressed(d, pitfallIssues(d, lang, shells.forced ?? shells.detected, rawIssues()), []);
  };
  const all = () => {
    if (!found) {
      const list = without();
      found = doc ? [...list, ...pitfallsOf(doc)] : list;
    }
    return found;
  };
  const disabled = settingSpec('diagnostics.enabled')!.surfaces.includes(surface) && !settings['diagnostics.enabled'];
  const pitfalls = settings['diagnostics.pitfalls'] && settings['notes.pitfalls'];
  const ignore = new Set(settings['diagnostics.ignore']);
  const shown = () => {
    if (disabled) return [];
    const list = pitfalls ? all() : without();
    return doc?.extracted !== undefined && !settings['diagnostics.embedded'] ? [] : list.filter((i) => !ignore.has(i.code));
  };
  return { get all() { return all(); }, shown: shown() };
}

/**
 * A problem's message as the Problems panel and the editors show it: without the mark (⚠, ⓘ or ℹ) it starts with in the
 * explanations (and, with `backticks: false`, without the backticks that mark code, for plain text).
 */
export function plain(message: string, opts: { backticks?: boolean } = {}): string {
  const text = message.replace(/^[⚠ⓘℹ]\uFE0F?\s*/u, '');
  return opts.backticks === false ? text.replace(/`/g, '') : text;
}

/** The problems of a document; those of bash are the constructs bash `version` lacks (5.2 when absent). */
function allIssues(doc: ShellDocument, lang: Lang, shells: Shells, version?: BashVersion): DocumentIssue[] {
  if (doc.extracted) {
    return doc.extracted.regions.length ? hostIssues(doc.tree, doc.extracted, doc.lines, lang, shells.forced, version) : [];
  }
  const crlf = crlfIssue(doc.tree, lang);
  const shell = shells.forced ?? shells.detected;
  const nested = nestedIssues(doc, lang, shell);
  return [...crlf, ...nested, ...dialectIssues(doc.tree, shell ?? 'bash', lang, undefined, undefined, version).map((i): DocumentIssue => {
    const n = i.place;
    const sameLine = n.startPosition.row === n.endPosition.row;
    return {
      code: i.id, severity: severityOf(i.note.level), message: i.note.text, fix: fixFor(i),
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
  const at = (i: number) => placeOf(starts, i);
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
        code: i.id, severity: severityOf(i.note.level), message: i.note.text,
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
