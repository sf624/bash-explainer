import { githubFileNotes } from './yaml';
import type { ExplainOptions, LineExplanation, Pos, Token } from '../analyzer-types';
import type { BashVersion } from '../bashversion';
import { dialectIssues, type Shell } from '../dialect';
import type { ReadingNode } from '../reading';
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
    const head = extracted.text.split('\n')[at.line].slice(at.character);
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
    const m = whole[2][lang === 'ja' ? 0 : 1];
    return lang === 'en' ? m[0].toUpperCase() + m.slice(1) : m;
  };
  const token = (t: Token): Token => {
    const sp = span(t.span);
    const label = relabel(t.label, t.span, !t.labelParts);
    // A token that is exactly a placeholder is the host syntax it stands for.
    const host = placeholder(t.span);
    if (host) return { ...t, label, span: sp, explanation: host, children: [] };
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
  return {
    ...ex,
    items: ex.items.map(token),
    examples: ex.examples.map((e) => (e.anchor ? { ...e, anchor: span(e.anchor) } : e)),
    ...(ex.reading ? { reading: reading(ex.reading) } : {}),
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

/** Per extracted text: its lines, its regions by `script` group, and the tree of each region's shell, built when asked. */
interface Scripts {
  lines: string[];
  groups: Map<number, ShellRegion[]>;
  trees: Map<ShellRegion, SyntaxTree>;
}
const scripts = new WeakMap<Extracted, Scripts>();

/**
 * The tree of the shell that runs `region`: each region is a shell of its own (a RUN instruction, a workflow step, a
 * recipe line), unless regions share a `script` (Markdown's blocks, a recipe with `.ONESHELL`, a GitLab job's
 * `before_script` and `script`). When every region runs in one shell, it is the document's tree; otherwise the text of
 * the other regions is left out (their lines are empty, so lines and columns stay, and the text ends at the group's last
 * line), and the state of one shell does not carry into the next. Each group's text is built and parsed once.
 */
function scriptTree(tree: SyntaxTree, extracted: Extracted, region: ShellRegion): SyntaxTree {
  let cache = scripts.get(extracted);
  if (!cache) {
    const groups = new Map<number, ShellRegion[]>();
    for (const r of extracted.regions) if (r.script !== undefined) groups.set(r.script, [...(groups.get(r.script) ?? []), r]);
    scripts.set(extracted, (cache = { lines: extracted.text.split('\n'), groups, trees: new Map() }));
  }
  const group = region.script === undefined ? [region] : cache.groups.get(region.script)!;
  if (group.length === extracted.regions.length) return tree;
  let own = cache.trees.get(region);
  if (!own) {
    let text = '';
    let row = 0;
    for (const r of [...group].sort((a, b) => a.start - b.start)) {
      text += '\n'.repeat(r.start - row) + cache.lines.slice(r.start, r.end + 1).join('\n');
      row = r.end;
    }
    regionParser ??= createUnbashParser();
    own = regionParser.parse(text);
    for (const r of group) cache.trees.set(r, own);
  }
  return own;
}

/**
 * Whether a pipeline with a `|` on `line` of a region runs without pipefail. The region is read as the script
 * its own shell runs (a RUN instruction), so `set -o pipefail` counts from where it runs, and not in a comment.
 */
function pipeWithoutPipefail(tree: SyntaxTree, region: ShellRegion, line: number): boolean {
  const model = shellState(tree, region.shell);
  const statuses = statusModel(model, region.shell);
  return descendants(tree.root, ['pipeline']).some((p) => {
    const rule = statuses.status(p);
    return p.children.some((c) => c.type === '|' && c.startPosition.row === line) && rule.kind === 'pipeline' && rule.pipefail === 'off';
  });
}

/** Explain `line` of a host document whose shell parts were extracted and parsed into `tree`. */
export function explainHostedLine(
  analyzer: { explainLine(tree: SyntaxTree, line: number, shell?: Shell, opts?: ExplainOptions): LineExplanation },
  tree: SyntaxTree, extracted: Extracted, original: string[], line: number, lang: 'ja' | 'en', shell?: Shell, opts: ExplainOptions = {},
): LineExplanation | undefined {
  const region = extracted.regions.find((r) => r.start <= line && line <= r.end);
  if (!region) return undefined;
  tree = scriptTree(tree, extracted, region);
  const ex = analyzer.explainLine(tree, line, shell ?? region.shell, { ...opts, host: region.host, ...(region.commands ? { hostCommands: region.commands } : {}) });
  ex.context.unshift({ label: lang === 'ja' ? region.label[0] : region.label[1], line: region.start });
  const pick = (m: [string, string, string?]) => (lang === 'ja' ? m[0] : m[1]);
  // (The catalog facts of the host go through `said`, like the analyzer's, so `notes.pitfalls` off leaves out their pitfalls.)
  const hostFacts: Fact[] = [];
  const spoken = (spec: FactSpec) => { const f = said([factOf(lang, spec)], opts.pitfalls); hostFacts.push(...f); return f.map((x) => x.text); };
  const notes = [...(region.notes ?? []).flatMap((n) => (Array.isArray(n) ? [pick(n)] : spoken(n.spec))), ...substitutionNotes(extracted, line, lang, opts.pitfalls, hostFacts)];
  if (region.host.ci === 'github') notes.push(...githubFileNotes(original[line], lang));
  if (region.warnPipefail && pipeWithoutPipefail(tree, region, line)) {
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
    for (const issue of dialectIssues(own, shell ?? region.shell ?? 'bash', lang, region.start, region.end, version)) {
      out.push({ code: issue.id, severity: issue.kind === 'unsupported' ? 'warning' : 'info', message: issue.message, ...at(issue.place) });
    }
    if (region.warnPipefail) {
      for (let line = region.start; line <= region.end; line++) {
        if (!pipeWithoutPipefail(own, region, line)) continue;
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

