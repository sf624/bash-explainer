import { Analyzer } from './analyzer';
import type { ExplainOptions, LineExplanation } from './analyzer-types';
import type { BashVersion } from './bashversion';
import { dialectIssues, Shell } from './dialect';
import { parseDirectives, suppressed } from './directives';
import { Fix, fixFor } from './fixes';
import { DocIssue, explainHostedLine, Extracted, hostIssues } from './hosts';
import { Lang } from './i18n';
import { conventionOf, fact, isProblem, severityOf } from './messages';
import { type NestedScript, nestedScripts } from './semantics/nested';
import { shellState } from './semantics/state';
import { explainOptions, settingSpec } from './settings';
import type { Settings, Surface } from './settings';
import { descendants, type Point, type SyntaxNode, type SyntaxTree } from './syntax/tree';

// What the extension and the web page share: explaining a line and finding the problems of a
// document, given its text and parse tree. Nothing here depends on VS Code.

/** A document as the explainers see it. */
export interface ShellDocument {
  lines: string[];
  /** The shell parts of a host file (Dockerfile, Makefile…); `tree` is then the tree of their text. */
  extracted?: Extracted;
  tree: SyntaxTree;
}

/** `pitfall`: a warning or caveat the explanations say (`noteIssues`), not a construct the shell lacks. */
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
 * Problems in the whole document, with quick fixes for shell scripts, and (unless `pitfalls` is false) the warnings and
 * caveats its explanations say (`noteIssues`). Codes in `ignore`, and those turned off by `# bash-explainer disable=`
 * comments in the file, are left out.
 */
export function documentIssues(doc: ShellDocument, lang: Lang, shells: Shells, ignore: readonly string[] = [], opts: { pitfalls?: boolean; bashVersion?: BashVersion } = {}): DocumentIssue[] {
  const base = allIssues(doc, lang, shells, opts.bashVersion);
  const found = opts.pitfalls === false ? base : [...base, ...noteIssues(doc, lang, shells, { bashVersion: opts.bashVersion }, base)];
  return unsuppressed(doc, found, ignore);
}

/** The issues not turned off by `ignore` or the file's `# bash-explainer disable=` comments. */
function unsuppressed(doc: ShellDocument, issues: DocumentIssue[], ignore: readonly string[]): DocumentIssue[] {
  const skip = new Set(ignore);
  const directives = parseDirectives(doc.lines);
  return issues.filter((i) => !skip.has(i.code) && !suppressed(directives, i.startLine, i.code));
}

/** A note's code, and the code of another problem that says the same where both are (a Dockerfile `RUN` with `set -e` and a pipe). */
const SAME_PROBLEM: Readonly<Record<string, string>> = { 'pipefail-missing': 'dockerPipefail' };

/** The note problems of a document, by its tree, for the language, shells and options they were found with. */
const noteIssueCache = new WeakMap<SyntaxTree, Map<string, DocumentIssue[]>>();

/**
 * The warnings and caveats the explanations of a document say, as problems (docs/design/note-levels.md, "Notes as
 * problems"): every note of a line at the level `warning` or `info` (`LineExplanation.noteInfo`), with its code, on
 * the range of each node it was found on (`LineExplanation.anchors`, cut to the line it starts on), `pitfall: true`.
 * A plain fact is never one, nor is a note the catalog keeps a note (`isProblem`). The same note on the same node is
 * one problem, whichever lines say it (a statement over several lines says its notes on each); one on two nodes is a
 * problem on each. A note about no node is about its line: only a host file has such warnings (a CI step, a Dockerfile
 * `RUN`), which `hostIssues` already gives. The notes of a
 * string run as a script (`bash -c '…'`, `$( )`) are on its words, in the document. None on a line `others` (the
 * other problems) says is not parsed, and none where one of them already says the same.
 */
export function noteIssues(doc: ShellDocument, lang: Lang, shells: Shells, opts: ExplainOptions, others: readonly DocumentIssue[] = []): DocumentIssue[] {
  // (Examples and idioms add no warning: the line is explained without them, and without its reading tree.)
  const lean: ExplainOptions = { ...opts, examples: { enabled: false, disabled: [] }, idioms: false, reading: false };
  const key = JSON.stringify([lang, shells.forced, shells.detected, lean, others.map((i) => [i.code, i.startLine, i.startCol, i.endCol, i.message])]);
  let byKey = noteIssueCache.get(doc.tree);
  if (!byKey) noteIssueCache.set(doc.tree, (byKey = new Map()));
  const known = byKey.get(key);
  if (known) return known;
  const analyzer = new Analyzer(lang);
  // (zsh syntax that bash cannot read: the tree there is not the script's.)
  const unparsed = others.filter((i) => i.code === 'zshSyntax');
  const out: DocumentIssue[] = [];
  const seen = new Set<string>();
  for (let line = 0; line < doc.lines.length; line++) {
    const ex = explainDocumentLine(analyzer, doc, line, lang, shells, lean);
    for (const n of ex.noteInfo) {
      // (A plain fact is no problem; nor is a caveat the catalog keeps a note, `ssh-local-expansion`, the `…-not-found` of an option.)
      if (n.level === 'note' || !isProblem(n.code!)) continue;
      for (const { span } of ex.anchors?.filter((a) => a.text === n.text) ?? []) {
        const at = span.start.line;
        const issue: DocumentIssue = {
          code: n.code!, severity: severityOf(n.level), message: n.text, pitfall: true, ...conventionOf(n),
          startLine: at, startCol: span.start.character, endLine: at, endCol: span.end.line === at ? span.end.character : doc.lines[at].length,
        };
        const id = `${issue.code} ${at}:${issue.startCol}-${issue.endCol}`;
        if (seen.has(id) || unparsed.some((i) => i.startLine <= at && at <= i.endLine)) continue;
        seen.add(id);
        // (Said already where it overlaps: the same problem.)
        const overlaps = (i: DocumentIssue) => i.startLine === at && i.startCol < issue.endCol && issue.startCol < i.endCol;
        if (others.some((i) => overlaps(i) && (i.code === issue.code || i.message === issue.message || SAME_PROBLEM[issue.code] === i.code))) continue;
        out.push(issue);
      }
    }
  }
  byKey.set(key, out);
  return out;
}

/**
 * A range the editor fades: code that never runs (`DiagnosticTag.Unnecessary`). Not a problem: it is not in the
 * problem lists, the command-line tool's output or the panel's marks, only in the editor itself.
 */
export interface DeadRange { code: 'dead-code'; severity: 'hint'; message: string; startLine: number; startCol: number; endLine: number; endCol: number }

/**
 * The statements that never run (`shellState(...).dead(n)`, docs/design/highlighting.md), as ranges: the whole
 * statement, over its lines; none inside another one (the first dead node on each path from the root is the one), and
 * the dead statements that follow each other in a body are one range. Only a shell script has them: the shell parts
 * of another file are explained one by one, with their own models. None where `# bash-explainer disable=dead-code`
 * says so.
 */
export function deadCodeHints(doc: ShellDocument, lang: Lang, shells: Shells, ignore: readonly string[] = [], version?: BashVersion): DeadRange[] {
  if (doc.extracted || ignore.includes('dead-code')) return [];
  const model = shellState(doc.tree, shells.forced ?? shells.detected, { version });
  const message = plain(fact(lang, 'dead-code').text);
  const out: DeadRange[] = [];
  const visit = (parent: SyntaxNode): void => {
    let run: SyntaxNode[] = [];
    const flush = (): void => {
      if (!run.length) return;
      const [a, b] = [run[0], run[run.length - 1]];
      out.push({ code: 'dead-code', severity: 'hint', message, startLine: a.startPosition.row, startCol: a.startPosition.column, endLine: b.endPosition.row, endCol: b.endPosition.column });
      run = [];
    };
    for (const c of parent.namedChildren) {
      // (A comment between two dead statements does not end the run.)
      if (c.type === 'comment') continue;
      if (model.dead(c)) run.push(c);
      else {
        flush();
        visit(c);
      }
    }
    flush();
  };
  visit(doc.tree.root);
  const directives = parseDirectives(doc.lines);
  return out.filter((r) => !suppressed(directives, r.startLine, r.code));
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
 * asked for; the codes the file itself turns off are left out in both). The warnings and caveats of the explanations
 * (`noteIssues`) are explained with the settings' options, and `explain` (the yq flavour a panel chose).
 */
export function diagnosticsFor(open: () => ShellDocument | undefined, shellsOf: (doc: ShellDocument) => Shells, lang: Lang, settings: Settings, surface: Surface, explain: ExplainOptions = {}): { readonly all: DocumentIssue[]; shown: DocumentIssue[]; readonly faded: DeadRange[] } {
  let doc: ShellDocument | undefined;
  let raw: DocumentIssue[] | undefined;
  let base: DocumentIssue[] | undefined;
  let found: DocumentIssue[] | undefined;
  // (The document is opened, that is parsed, only when its problems are looked at; its notes are looked at only when
  // they are shown, or all the problems are asked for. They are weighed against the other problems before any is
  // turned off, as `documentIssues` does.)
  const rawIssues = () => (raw ??= (doc ??= open()) ? allIssues(doc, lang, shellsOf(doc), settings.bashVersion) : []);
  const without = () => {
    if (!base) {
      const list = rawIssues();
      base = doc ? unsuppressed(doc, list, []) : [];
    }
    return base;
  };
  // (`all` has the pitfalls whatever `notes.pitfalls` says; what is shown, only those the explanations say.)
  const notesOf = (d: ShellDocument, pitfalls: boolean) => unsuppressed(d, noteIssues(d, lang, shellsOf(d), { ...explainOptions(settings), ...explain, pitfalls }, rawIssues()), []);
  const withNotes = (pitfalls: boolean) => {
    const list = without();
    return doc ? [...list, ...notesOf(doc, pitfalls)] : list;
  };
  const all = () => (found ??= withNotes(true));
  const disabled = settingSpec('diagnostics.enabled')!.surfaces.includes(surface) && !settings['diagnostics.enabled'];
  const ignore = new Set(settings['diagnostics.ignore']);
  const shown = () => {
    if (disabled) return [];
    // (With `notes.pitfalls` off the explanations leave out their pitfalls, so the problems do too, but not their failures.)
    const list = !settings['diagnostics.pitfalls'] ? without() : settings['notes.pitfalls'] ? all() : withNotes(false);
    return doc?.extracted !== undefined && !settings['diagnostics.embedded'] ? [] : list.filter((i) => !ignore.has(i.code));
  };
  // (The faded ranges are no problems: they come apart from `shown`, where the surface draws them, if `hints.deadCode` is on.)
  const faded = () => (settingSpec('hints.deadCode')!.surfaces.includes(surface) && settings['hints.deadCode'] && (doc ??= open()) ? deadCodeHints(doc, lang, shellsOf(doc), settings['diagnostics.ignore'], settings.bashVersion) : []);
  return { get all() { return all(); }, shown: shown(), get faded() { return faded(); } };
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
