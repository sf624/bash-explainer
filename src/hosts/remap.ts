import { githubFileNotes } from './yaml';
import { hostMeaningText } from '../messages-hosts';
import type { ArgvLine, ArgvWord, ExplainOptions, LineExplanation, Pos, Span, Token } from '../analyzer-types';
import type { BashVersion } from '../bashversion';
import { dialectIssues, type Shell } from '../dialect';
import type { ReadingNode } from '../reading';
import { descendants, type SyntaxTree } from '../syntax/tree';
import { spanOf } from '../noteanchors';
import { regionAt, regionShell, scriptTree, shellLines, shellStart } from './scripts';
import { reachedAt } from '../semantics/scriptstops';
import { fileRead } from '../semantics/env';
import { shellState, type StateModel } from '../semantics/state';
import { statusModel } from '../semantics/status';
import { batsFacts, batsTests } from '../bats';
import type { ConventionId } from '../conventions';
import type { ProblemSeverity } from '../levels';
import { basisGate, conventionOf, type Fact, fact, type FactSpec, factOf, type Note, problemText, said, severityOf } from '../messages';
import type { ShellRegion, Extracted } from './index';
import { batsTestLine } from './bats';
import { batsCommentFacts } from './batstags';
import { problemCodes } from '../linesentence';
import { isKept } from '../tokenkept';
import { markTokens, sayInstead } from '../tokenmarks';
import { pushAll } from '../lists';

const remappedTokens = new WeakMap<Extracted, Record<'ja' | 'en', WeakMap<Token, Token>>>();

/**
 * Move every position in an explanation of the extracted shell text back to the original
 * document, and relabel tokens with the original text (`$(CC)` rather than `${CC}`).
 */
export function remapExplanation(ex: LineExplanation, extracted: Extracted, original: string[], lang: 'ja' | 'en' = 'en'): LineExplanation {
  // Positions in the explanation are in the extracted text, which every map covers.
  const pos = (p: Pos): Pos => ({ line: p.line, character: extracted.maps[p.line][p.character] });
  const span = (sp: Token['span']) => ({ start: pos(sp.start), end: pos(sp.end) });
  // A part of a placeholder (the name inside `${make_target}`) has no counterpart in the original.
  const insidePlaceholder = (t: { span: Token['span'] }) => t.span.start.line === t.span.end.line
    && extracted.inserted[t.span.start.line].some(([a, b]) => t.span.start.character >= a && t.span.end.character <= b && (t.span.start.character > a || t.span.end.character < b));
  /**
   * The label of a part of the extracted text, in the original: its text there (the name a command is labelled
   * with, at the start of its span, from the original too). A skeleton (`labelParts`) or a name that is not the code
   * (`code` false) stays.
   */
  const relabel = (label: string, sp: Token['span'], code = true): string => {
    if (!code) return label;
    const at = sp.start;
    const to = span(sp);
    const head = shellLines(extracted)[at.line].slice(at.character);
    const one = sp.start.line === sp.end.line;
    const spanLength = one ? sp.end.character - at.character : Infinity;
    if (head.startsWith(label) && !label.endsWith('…') && spanLength > label.length) {
      return original[to.start.line].slice(to.start.character, extracted.maps[at.line][at.character + label.length]);
    }
    let out = label;
    const text = one ? original[to.start.line]?.slice(to.start.character, to.end.character) : undefined;
    if (text) out = text.length > 60 ? text.slice(0, 59) + '…' : text;
    return out;
  };
  /** What the placeholder that `sp` is exactly stands for, if it is one. */
  const placeholder = (sp: Token['span']): string | undefined => {
    const whole = sp.start.line === sp.end.line
      ? extracted.inserted[sp.start.line].find(([a, b]) => a === sp.start.character && b === sp.end.character)
      : undefined;
    if (!whole?.[2]) return undefined;
    const m = hostMeaningText(whole[2])[lang];
    return lang === 'en' ? m[0].toUpperCase() + m.slice(1) : m;
  };
  const token = (t: Token): Token => {
    const sp = span(t.span);
    const label = relabel(t.label, t.span, !t.labelParts);
    // A token that is exactly a placeholder is the host syntax it stands for.
    const host = placeholder(t.span);
    if (host) {
      const stands = { ...t, label, span: sp, children: [] };
      sayInstead(stands, host);
      return stands;
    }
    return { ...t, label, span: sp, children: t.children.filter((c) => !insidePlaceholder(c)).map(token) };
  };
  // The reading tree, as the tokens: in the original, labelled with its text there, without the parts of a
  // placeholder. (The labels that are not code stay: a skeleton, a language's name.)
  const reading = (n: ReadingNode): ReadingNode => {
    const code = n.kind !== 'language' && n.kind !== 'line' && !n.label.includes('‹');
    const out: ReadingNode = { ...n, label: relabel(n.label, n.span, code), span: span(n.span) };
    const host = placeholder(n.span);
    if (host) return { ...out, text: host, children: [] };
    return { ...out, children: n.children.filter((c) => !insidePlaceholder(c)).map(reading) };
  };
  // A note names a placeholder as the extracted text has it (`${SRC}`): in the file it is what it stands for (`$(SRC)`),
  // also in the problems made of the notes.
  const lines = shellLines(extracted);
  const rows = [...new Set([ex.line, ...(ex.anchors ?? []).map((a) => a.span.start.line)])];
  const names = rows.flatMap((l) => extracted.inserted[l].map(([a, b]) => [lines[l].slice(a, b), original[l].slice(extracted.maps[l][a], extracted.maps[l][b])]))
    .filter(([inShell, file]) => file && inShell !== file);
  const inFile = (text: string) => names.reduce((t, [inShell, file]) => t.split(inShell).join(file), text);
  const noteInFile = <N extends { text: string; body: string; head?: string }>(n: N): N => ({ ...n, text: inFile(n.text), body: inFile(n.body), ...(n.head ? { head: inFile(n.head) } : {}) });
  // A fact's rewrites edit the extracted text, at its offsets and in its syntax (`${MSG}` for make's `$(MSG)`, `$f`
  // for `$$f`, a line a backslash continues in a Dockerfile): not the file. The facts of a host carry none (src/rewrite.ts),
  // nor do the places of its notes (no quick fix).
  const factInFile = ({ rewrite: _r, ...f }: Fact): Fact => noteInFile(f);
  let byLang = remappedTokens.get(extracted);
  if (!byLang) remappedTokens.set(extracted, (byLang = { en: new WeakMap(), ja: new WeakMap() }));
  const kept = byLang[lang];
  return {
    ...ex,
    items: ex.items.map((t) => {
      if (!isKept(t)) return token(t);
      // (A statement over several lines, the same token on each of them: `Whole`.)
      let mapped = kept.get(t);
      if (!mapped) kept.set(t, (mapped = token(t)));
      return mapped;
    }),
    examples: ex.examples.map((e) => (e.anchor ? { ...e, anchor: span(e.anchor) } : e)),
    notes: ex.notes.map(inFile),
    noteInfo: ex.noteInfo.map(noteInFile),
    ...(ex.facts ? { facts: ex.facts.map(factInFile) } : {}),
    ...(ex.anchors ? { anchors: ex.anchors.map(({ rewrite: _r, ...a }) => ({ ...a, text: inFile(a.text), span: span(a.span) })) } : {}),
    ...(ex.reading ? { reading: reading(ex.reading) } : {}),
    ...(ex.argv ? { argv: ex.argv.map((l) => argvLine(l, span)) } : {}),
  };
}

/** Notes for host syntax on a line (`$(CC)` is a make variable…); a warning about one is the problem `injection`. */
export function substitutionNotes(extracted: Extracted, line: number, lang: 'ja' | 'en', pitfalls?: boolean, facts?: Fact[]): Note[] {
  const seen = new Set<string>();
  return extracted.substitutions
    .filter((s) => s.line === line && !seen.has(s.text) && seen.add(s.text))
    .flatMap((s) => {
      const warnings = s.warning ? said([factOf(lang, s.warning)], pitfalls).map((f): Note => (facts?.push(f), { ...noteData(f), code: 'injection' })) : [];
      const meaning = fact(lang, 'host-substitution', { text: s.text, meaning: s.meaning });
      facts?.push(meaning);
      return [...warnings, noteData(meaning)];
    });
}

/** A fact's note, without what only the fact has (its id, kind, sections, basis and try-it). */
const noteData = (f: Fact): Note => ({ text: f.text, level: f.level, label: f.label, body: f.body, ...(f.head ? { head: f.head } : {}), code: f.code, ...conventionOf(f) });

const PIPEFAIL: FactSpec = { id: 'dockerfile-pipefail-missing', params: {} };

/**
 * Whether a pipeline with a `|` on `line` of a region runs without pipefail. The region is read as the script
 * its own shell runs (a RUN instruction), so `set -o pipefail` counts from where it runs, and not in a comment; in the
 * shell chosen, when one is (`forced`), as the rest of the line.
 */
function pipeWithoutPipefail(tree: SyntaxTree, region: ShellRegion, line: number, forced?: Shell): boolean {
  const shell = regionShell(region, forced);
  const model = shellState(tree, shell, { read: fileRead(tree.root, region.host) });
  // (Asked for each line of a region: read once.)
  let rows = pipeRows.get(model);
  if (!rows) {
    const statuses = statusModel(model, shell);
    rows = new Set(descendants(tree.root, ['pipeline']).filter((p) => {
      const rule = statuses.status(p);
      return rule.kind === 'pipeline' && rule.pipefail === 'off';
    }).flatMap((p) => p.children.filter((c) => c.type === '|').map((c) => c.startPosition.row)));
    pipeRows.set(model, rows);
  }
  return rows.has(line);
}

const pipeRows = new WeakMap<StateModel, Set<number>>();

/**
 * The variables the host gives the shell code of `region` (`ShellRegion.provided`), and the names of the placeholders in
 * the file (`${{ matrix.node }}` read as `${MATRIX_NODE}`, make's `$(OUT)` as `${OUT}`): the host replaces those
 * before the shell runs, so bash never reads them as variables.
 */
export function hostProvided(extracted: Extracted, region: ShellRegion): string[] {
  // (Asked for each line of a region: read once.)
  let names = providedByRegion.get(region);
  if (!names) providedByRegion.set(region, (names = providedIn(extracted, region)));
  return names;
}

const providedByRegion = new WeakMap<ShellRegion, string[]>();

function providedIn(extracted: Extracted, region: ShellRegion): string[] {
  const rows = shellLines(extracted);
  const names = extracted.inserted.flatMap((ranges, i) => ranges.flatMap(([from, to]) => [...rows[i].slice(from, to).matchAll(/\$\{?([A-Za-z_]\w*)/g)].map((m) => m[1])));
  return [...new Set([...(region.provided ?? []), ...names])];
}

/** Explain `line` of a host document whose shell parts were extracted and parsed into `tree`. */
export function explainHostedLine(
  analyzer: { explainLine(tree: SyntaxTree, line: number, shell?: Shell, opts?: ExplainOptions): LineExplanation },
  tree: SyntaxTree, extracted: Extracted, original: string[], line: number, lang: 'ja' | 'en', shell?: Shell, opts: ExplainOptions = {},
): LineExplanation | undefined {
  const region = regionAt(extracted, line);
  if (!region) return undefined;
  tree = scriptTree(tree, extracted, region);
  const provided = hostProvided(extracted, region);
  // (The catalog facts of the host go through `said`, like the analyzer's, so `notes.pitfalls` off leaves out their pitfalls.)
  const hostFacts: Fact[] = [];
  // (A warning the host says is the problem `code` of hostIssues.)
  const spoken = (spec: FactSpec, code?: string) => { const f = said([factOf(lang, spec)], opts.pitfalls); pushAll(hostFacts, f); return f.map((x) => ({ ...noteData(x), code: code ?? x.code })); };
  const notes: Note[] = [...(region.notes ?? []).flatMap((n) => spoken(n.spec, n.code)), ...substitutionNotes(extracted, line, lang, opts.pitfalls, hostFacts)];
  if (region.host.ci === 'github') pushAll(notes, githubFileNotes(original[line]).flatMap((spec) => spoken(spec)));
  if (region.warnPipefail && pipeWithoutPipefail(tree, region, line, shell)) {
    pushAll(notes, spoken(PIPEFAIL, 'dockerPipefail'));
  }
  // (The lines bats rewrites where bash then reads a function: not one inside a here-document or a string.)
  const tests = region.tests && batsTests(tree, { ...region, tests: region.tests });
  // (On their nodes, as the analyzer's: the hover and the problems read them there. The facts of a comment on the
  // line: on the comment, else on the function the line defines.)
  const onRow = (types: string[]) => descendants(tree.root, types, { from: line, to: line }).find((d) => d.startPosition.row === line);
  const found = tests ? [
    ...batsFacts(tree, region, tests, line, lang),
    ...batsCommentFacts(tree, original[line], line, tests.includes(line), lang).map((fact) => ({ fact, node: onRow(['comment']) ?? onRow(['function_definition']) })),
  ].filter((f) => said([f.fact], opts.pitfalls).length) : [];
  pushAll(notes, found.map((f) => noteData(f.fact)));
  pushAll(hostFacts, found.map((f) => f.fact));
  const ex = analyzer.explainLine(tree, line, regionShell(region, shell), {
    ...opts, host: region.host, stopsFrom: shellStart(region, line), ...(region.commands ? { hostCommands: region.commands } : {}), ...(region.run ? { hostRun: region.run } : {}), ...(provided.length ? { hostProvided: provided } : {}),
    ...(region.noShell ? { noShell: region.noShell } : {}),
    // (The sentence of the line says nothing a problem of the host says: src/linesentence.ts.)
    ...(opts.sentence ? { hostProblems: [...problemCodes({ noteInfo: notes, facts: hostFacts })] } : {}),
  });
  ex.context.unshift({ label: lang === 'ja' ? region.label[0] : region.label[1], line: region.start });
  if (tests) ex.anchors = [...(ex.anchors ?? []), ...found.filter((f) => f.node).map((f) => ({ text: f.fact.text, span: spanOf(f.node!), code: f.fact.code }))];
  // (Through the gate of `notes.basis`, as the analyzer's.)
  if (hostFacts.length) ex.facts = [...(ex.facts ?? []), ...hostFacts.map((f) => basisGate(f, opts.basis))];
  // (The facts bats adds on nodes of the line are about its tokens too.)
  if (tests) ex.items = markTokens(ex.items, { facts: ex.facts, anchors: ex.anchors! });
  ex.notes = [...notes.map((n) => n.text), ...ex.notes];
  ex.noteInfo = [...notes.map((n) => basisGate(n, opts.basis)), ...ex.noteInfo];
  const out = remapExplanation(ex, extracted, original, lang);
  if (tests) batsTestLine(out, extracted, original, tests, lang);
  return out;
}

/** A problem to show in the Problems panel, at original document positions. */
export interface DocIssue {
  code: string;
  severity: ProblemSeverity;
  message: string;
  /** One sentence with what happens: `Note.head`, for the panel's pointer to a problem on a line around (`problemsAround`, src/ui/panelProblems.ts). */
  head: string;
  startLine: number; startCol: number; endLine: number; endCol: number;
  /** The habit the advice is, when it is one (`Note.convention`, src/conventions.ts). */
  convention?: ConventionId;
}

/** All problems in the shell parts of a host document (one pass, for diagnostics). */
export function hostIssues(tree: SyntaxTree, extracted: Extracted, original: string[], lang: 'ja' | 'en', shell?: Shell, version?: BashVersion): DocIssue[] {
  const out: DocIssue[] = [];
  const col = (line: number, c: number) => extracted.maps[line][c];
  const at = (n: { startPosition: { row: number; column: number }; endPosition: { row: number; column: number } }) => {
    const sameLine = n.startPosition.row === n.endPosition.row;
    return {
      startLine: n.startPosition.row, startCol: col(n.startPosition.row, n.startPosition.column),
      endLine: n.startPosition.row, endCol: sameLine ? col(n.endPosition.row, n.endPosition.column) : original[n.startPosition.row].length,
    };
  };
  for (const region of extracted.regions) {
    const own = scriptTree(tree, extracted, region);
    for (const issue of dialectIssues(own, regionShell(region, shell) ?? 'bash', lang, region.start, region.end, version, (n) => reachedAt(own, n.startIndex, shellStart(region, n.startPosition.row)))) {
      out.push({ code: issue.id, severity: severityOf(issue.note.level), message: problemText(issue.note, lang), head: issue.note.head!, ...at(issue.place) });
    }
    if (region.warnPipefail) {
      for (let line = region.start; line <= region.end; line++) {
        if (!pipeWithoutPipefail(own, region, line, shell)) continue;
        const pipe = original[line].search(/(?<!\|)\|(?!\|)/);
        const f = factOf(lang, PIPEFAIL);
        out.push({ code: 'dockerPipefail', severity: severityOf(f.level), message: problemText(f, lang), head: f.head!, startLine: line, startCol: Math.max(0, pipe), endLine: line, endCol: Math.max(0, pipe) + 1, ...conventionOf(f) });
      }
    }
    for (const n of region.notes ?? []) {
      // (A note with no code is no problem: what a region is, said on its lines.)
      if (n.code === undefined) continue;
      const first = extracted.maps[region.start];
      const f = factOf(lang, n.spec);
      out.push({ code: n.code, severity: severityOf(f.level), message: problemText(f, lang), head: f.head!, startLine: region.start, startCol: first[0], endLine: region.start, endCol: first[first.length - 1], ...conventionOf(f) });
    }
  }
  for (const sub of extracted.substitutions) {
    if (!sub.warning) continue;
    const c = Math.max(0, original[sub.line].indexOf(sub.text));
    const f = factOf(lang, sub.warning);
    out.push({ code: 'injection', severity: severityOf(f.level), message: problemText(f, lang), head: f.head!, startLine: sub.line, startCol: c, endLine: sub.line, endCol: c + sub.text.length, ...conventionOf(f) });
  }
  return out;
}

/** What a program receives (`LineExplanation.argv`), with its places in the file (`span`); the texts stay as the extracted script has them. */
function argvLine(l: ArgvLine, span: (sp: Span) => Span): ArgvLine {
  const word = (w: ArgvWord): ArgvWord => ({ ...w, from: span(w.from) });
  return {
    ...l, span: span(l.span), words: l.words.map(word),
    removed: l.removed.map((r) => ({ ...r, span: span(r.span), ...(r.word ? { word: r.word.map(word) } : {}) })),
    ...(l.fails ? { fails: { ...l.fails, span: span(l.fails.span) } } : {}),
  };
}
