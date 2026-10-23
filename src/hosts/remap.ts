import { githubFileNotes } from './yaml';
import type { ExplainOptions, LineExplanation, Pos, Token } from '../analyzer';
import { dialectIssues, type Shell } from '../dialect';
import { descendants, type BashParser, type SyntaxTree } from '../syntax/tree';
import { createUnbashParser } from '../syntax/adapters/unbash';
import { shellState } from '../semantics/state';
import { statusModel } from '../semantics/status';
import { batsFacts, batsTests } from '../bats';
import { type Fact, type FactSpec, factOf, said } from '../messages';
import type { ShellRegion, Extracted } from './index';
import { batsTestLine } from './bats';

/**
 * Move every position in an explanation of the extracted shell text back to the original
 * document, and relabel tokens with the original text (`$(CC)` rather than `${CC}`).
 */
export function remapExplanation(ex: LineExplanation, extracted: Extracted, original: string[], lang: 'ja' | 'en' = 'en'): LineExplanation {
  // Positions in the explanation are in the extracted text, which every map covers.
  const pos = (p: Pos): Pos => ({ line: p.line, character: extracted.maps[p.line][p.character] });
  const span = (sp: Token['span']) => ({ start: pos(sp.start), end: pos(sp.end) });
  // A part of a placeholder (the name inside `${make_target}`) has no counterpart in the original.
  const insidePlaceholder = (t: Token) => t.span.start.line === t.span.end.line
    && extracted.inserted[t.span.start.line].some(([a, b]) => t.span.start.character >= a && t.span.end.character <= b && (t.span.start.character > a || t.span.end.character < b));
  const token = (t: Token): Token => {
    const sp = span(t.span);
    let label = t.label;
    const at = t.span.start;
    const head = extracted.text.split('\n')[at.line].slice(at.character);
    const one = t.span.start.line === t.span.end.line;
    const spanLength = one ? t.span.end.character - at.character : Infinity;
    if (t.labelParts) {
      // A skeleton is not the text of the span: keep it.
    } else if (head.startsWith(t.label) && !t.label.endsWith('…') && spanLength > t.label.length) {
      // A command is labelled with its name, the start of its span: take the name from the original too.
      label = original[sp.start.line].slice(sp.start.character, extracted.maps[at.line][at.character + t.label.length]);
    } else if (one) {
      const text = original[sp.start.line]?.slice(sp.start.character, sp.end.character);
      if (text) label = text.length > 60 ? text.slice(0, 59) + '…' : text;
    }
    // A token that is exactly a placeholder is the host syntax it stands for.
    const whole = t.span.start.line === t.span.end.line
      ? extracted.inserted[t.span.start.line].find(([a, b]) => a === t.span.start.character && b === t.span.end.character)
      : undefined;
    if (whole?.[2]) {
      const m = whole[2][lang === 'ja' ? 0 : 1];
      return { ...t, label, span: sp, explanation: lang === 'en' ? m[0].toUpperCase() + m.slice(1) : m, children: [] };
    }
    return { ...t, label, span: sp, children: t.children.filter((c) => !insidePlaceholder(c)).map(token) };
  };
  return {
    ...ex,
    items: ex.items.map(token),
    examples: ex.examples.map((e) => (e.anchor ? { ...e, anchor: span(e.anchor) } : e)),
  };
}

/** Notes for host syntax on a line (`$(CC)` is a make variable…). */
export function substitutionNotes(extracted: Extracted, line: number, lang: 'ja' | 'en', pitfalls?: boolean, facts?: Fact[]): string[] {
  const seen = new Set<string>();
  return extracted.substitutions
    .filter((s) => s.line === line && !seen.has(s.text) && seen.add(s.text))
    .flatMap((s) => [
      ...(s.warning ? said([factOf(lang, s.warning)], pitfalls).map((f) => (facts?.push(f), f.text)) : []),
      lang === 'ja' ? `\`${s.text}\` は${/^[A-Za-z]/.test(s.meaning[0]) ? ' ' : ''}${s.meaning[0]}。` : `\`${s.text}\` is ${s.meaning[1]}.`,
    ]);
}

const PIPEFAIL: FactSpec = { id: 'dockerfile-pipefail-missing', params: {} };

let regionParser: BashParser | undefined;
const regionTrees = new Map<string, SyntaxTree>();

/**
 * Whether a pipeline with a `|` on `line` of a region runs without pipefail. The region is read as the script
 * its own shell runs (a RUN instruction), so `set -o pipefail` counts from where it runs, and not in a comment.
 */
function pipeWithoutPipefail(extracted: Extracted, region: ShellRegion, line: number): boolean {
  const text = extracted.text.split('\n').slice(region.start, region.end + 1).join('\n');
  let tree = regionTrees.get(text);
  if (!tree) {
    regionParser ??= createUnbashParser();
    tree = regionParser.parse(text);
    regionTrees.set(text, tree);
  }
  const model = shellState(tree, region.shell);
  const row = line - region.start;
  const statuses = statusModel(model, region.shell);
  return descendants(tree.root, ['pipeline']).some((p) => {
    const rule = statuses.status(p);
    return p.children.some((c) => c.type === '|' && c.startPosition.row === row) && rule.kind === 'pipeline' && rule.pipefail === 'off';
  });
}

/** Explain `line` of a host document whose shell parts were extracted and parsed into `tree`. */
export function explainHostedLine(
  analyzer: { explainLine(tree: SyntaxTree, line: number, shell?: Shell, opts?: ExplainOptions): LineExplanation },
  tree: SyntaxTree, extracted: Extracted, original: string[], line: number, lang: 'ja' | 'en', shell?: Shell, opts: ExplainOptions = {},
): LineExplanation | undefined {
  const region = extracted.regions.find((r) => r.start <= line && line <= r.end);
  if (!region) return undefined;
  const ex = analyzer.explainLine(tree, line, shell ?? region.shell, { ...opts, host: region.host, ...(region.commands ? { hostCommands: region.commands } : {}) });
  ex.context.unshift({ label: lang === 'ja' ? region.label[0] : region.label[1], line: region.start });
  const pick = (m: [string, string, string?]) => (lang === 'ja' ? m[0] : m[1]);
  // (The catalog facts of the host go through `said`, like the analyzer's, so `notes.pitfalls` off leaves out their pitfalls.)
  const hostFacts: Fact[] = [];
  const spoken = (spec: FactSpec) => { const f = said([factOf(lang, spec)], opts.pitfalls); hostFacts.push(...f); return f.map((x) => x.text); };
  const notes = [...(region.notes ?? []).flatMap((n) => (Array.isArray(n) ? [pick(n)] : spoken(n.spec))), ...substitutionNotes(extracted, line, lang, opts.pitfalls, hostFacts)];
  if (region.host.ci === 'github') notes.push(...githubFileNotes(original[line], lang));
  if (region.warnPipefail && pipeWithoutPipefail(extracted, region, line)) {
    notes.push(...spoken(PIPEFAIL));
  }
  // (The lines bats rewrites where bash then reads a function: not one inside a here-document or a string.)
  const tests = region.tests && batsTests(tree, region.tests);
  if (tests) {
    const facts = said(batsFacts(tree, tests, line, lang), opts.pitfalls);
    notes.push(...facts.map((f) => f.text));
    hostFacts.push(...facts);
  }
  if (hostFacts.length) ex.facts = [...(ex.facts ?? []), ...hostFacts];
  ex.notes.unshift(...notes);
  const out = remapExplanation(ex, extracted, original, lang);
  if (tests) batsTestLine(out, extracted, original, tests, lang);
  return out;
}

/** A problem to show in the Problems panel, at original document positions. */
export interface DocIssue {
  code: string;
  severity: 'warning' | 'info';
  message: string;
  startLine: number; startCol: number; endLine: number; endCol: number;
}

/** All problems in the shell parts of a host document (one pass, for diagnostics). */
export function hostIssues(tree: SyntaxTree, extracted: Extracted, original: string[], lang: 'ja' | 'en', shell?: Shell): DocIssue[] {
  const out: DocIssue[] = [];
  const col = (line: number, c: number) => extracted.maps[line][c];
  const at = (n: { startPosition: { row: number; column: number }; endPosition: { row: number; column: number } }) => {
    const sameLine = n.startPosition.row === n.endPosition.row;
    return {
      startLine: n.startPosition.row, startCol: col(n.startPosition.row, n.startPosition.column),
      endLine: n.startPosition.row, endCol: sameLine ? col(n.endPosition.row, n.endPosition.column) : original[n.startPosition.row].length,
    };
  };
  const pick = (m: [string, string, string?]) => (lang === 'ja' ? m[0] : m[1]);
  for (const region of extracted.regions) {
    for (const issue of dialectIssues(tree, shell ?? region.shell ?? 'bash', lang, region.start, region.end)) {
      out.push({ code: issue.id, severity: issue.kind === 'unsupported' ? 'warning' : 'info', message: issue.message, ...at(issue.place) });
    }
    if (region.warnPipefail) {
      for (let line = region.start; line <= region.end; line++) {
        if (!pipeWithoutPipefail(extracted, region, line)) continue;
        const pipe = original[line].search(/(?<!\|)\|(?!\|)/);
        out.push({ code: 'dockerPipefail', severity: 'warning', message: factOf(lang, PIPEFAIL).text, startLine: line, startCol: Math.max(0, pipe), endLine: line, endCol: Math.max(0, pipe) + 1 });
      }
    }
    for (const n of region.notes ?? []) {
      if (Array.isArray(n)) continue;
      const first = extracted.maps[region.start];
      out.push({ code: n.code, severity: 'warning', message: factOf(lang, n.spec).text, startLine: region.start, startCol: first[0], endLine: region.start, endCol: first[first.length - 1] });
    }
  }
  for (const sub of extracted.substitutions) {
    if (!sub.warning) continue;
    const c = Math.max(0, original[sub.line].indexOf(sub.text));
    out.push({ code: 'injection', severity: 'warning', message: factOf(lang, sub.warning).text, startLine: sub.line, startCol: c, endLine: sub.line, endCol: c + sub.text.length });
  }
  return out;
}

