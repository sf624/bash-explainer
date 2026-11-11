// The shells of a host file: which regions of its shell code one shell runs, and the tree that shell reads (for the
// explanations, the problems and the colours).
import type { Pos, Span } from '../analyzer-types';
import type { Shell } from '../shellfeatures';
import type { BashParser, SyntaxTree } from '../syntax/tree';
import { createUnbashParser } from '../syntax/adapters/unbash';
import { shellStartAt } from '../semantics/scriptstops';
import type { CallArgument, Extracted, LanguageRegion, LiteralSource, ReParam, ShellRegion } from './index';

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
export function scriptTree(tree: SyntaxTree, extracted: Extracted, region: ShellRegion): SyntaxTree {
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
 * The rows where the shells that run the tree of `region` start, in order, for what may stop them (`stopBefore`,
 * src/semantics/scriptstops.ts): the tree of the region's group (`scriptTree`) is one shell, from its first row. But a
 * reader runs each fence of a Markdown file by itself, and bats runs each test in a process of its own. A row's shell
 * started on the last of them on or before it (`shellStartAt`).
 */
export function shellStarts(extracted: Extracted, region: ShellRegion): readonly number[] {
  if (region.host.kind !== 'markdown') return region.tests ?? [];
  let starts = fenceStarts.get(region);
  if (!starts) {
    // (Markdown's fences are one script: src/hosts/markdown.ts.)
    const group = extracted.regions.filter((r) => r.script === region.script);
    starts = group.map((r) => r.start).sort((a, b) => a - b);
    for (const r of group) fenceStarts.set(r, starts);
  }
  return starts;
}

const fenceStarts = new WeakMap<ShellRegion, readonly number[]>();

/** The row where the shell that runs `line` of `region` started (`shellStarts`). */
export function shellStart(extracted: Extracted, region: ShellRegion, line: number): number {
  return shellStartAt(shellStarts(extracted, region), line)!;
}

/** The lines of the shell text of a host document: asked for each token of each line, read once. */
export function shellLines(extracted: Extracted): readonly string[] {
  let lines = linesOf.get(extracted);
  if (!lines) linesOf.set(extracted, (lines = extracted.text.split('\n')));
  return lines;
}

const linesOf = new WeakMap<Extracted, readonly string[]>();

/** The region of a host document that `line` is in (none: the line is the host's own text, not shell code). */
export function regionAt(extracted: Extracted, line: number): ShellRegion | undefined {
  // (Asked for each line, and a long file has as many regions: the first that holds each line, read once.)
  let byLine = regionsByLine.get(extracted);
  if (!byLine) {
    byLine = new Map();
    for (const r of [...extracted.regions].reverse()) for (let l = r.start; l <= r.end; l++) byLine.set(l, r);
    regionsByLine.set(extracted, byLine);
  }
  return byLine.get(line);
}

const regionsByLine = new WeakMap<Extracted, Map<number, ShellRegion>>();

/**
 * What a line of a host document is part of: shell code (a `ShellRegion`), or parts in another language: the `LanguageRegion`s that
 * have the line, each call on it, in the order written.
 */
export type HostPart = { kind: 'shell'; region: ShellRegion } | { kind: 'language'; regions: readonly LanguageRegion[] };

/**
 * The part of a host document that `line` is in (none: the host's own text): its shell region, else its parts in another language
 * (`LanguageRegion.lines`). The one reader of both lists (docs/design/python-regex.md, 2.3): a shell region keeps a line it shares.
 */
export function hostPartAt(extracted: Extracted, line: number): HostPart | undefined {
  const region = regionAt(extracted, line);
  if (region) return { kind: 'shell', region };
  let byLine = languagesByLine.get(extracted);
  if (!byLine) {
    byLine = new Map();
    for (const r of extracted.languages) {
      for (const l of r.lines) {
        const on = byLine.get(l);
        if (on) on.push(r);
        else byLine.set(l, [r]);
      }
    }
    languagesByLine.set(extracted, byLine);
  }
  const regions = byLine.get(line);
  return regions && { kind: 'language', regions };
}

const languagesByLine = new WeakMap<Extracted, Map<number, LanguageRegion[]>>();

/** The literal of the argument of a region's call that binds `role`, if it is string literals only. */
export const literalOf = (region: LanguageRegion, role: ReParam): LiteralSource | undefined => region.args.find((a) => a.role === role)?.literal;

/** The pattern a region's reader reads, where it is string literals; none in a region of the call's facts only (`flagsAsCount`). */
export const patternOf = (region: LanguageRegion): LiteralSource | undefined => literalOf(region, 'pattern');

/**
 * Whether an argument is flags in the slot of `count` or `maxsplit`, by position or by keyword (`re.sub(p, r, s, re.I)`, `count=re.I`):
 * every term a name of `re`, and a value that is not 0. A fact of the call (`python-regex-flag-as-count`), whatever its pattern is.
 */
export const flagsAsCount = (a: CallArgument): boolean => (a.role === 'count' || a.role === 'maxsplit') && !!a.flags?.value && !a.flags.unknown.length;

/** Whether `inner` lies within `outer`, their ends included: a call of a part in another language in the arguments of another. */
export function spanWithin(outer: Span, inner: Span): boolean {
  const le = (a: Pos, z: Pos): boolean => a.line < z.line || (a.line === z.line && a.character <= z.character);
  return le(outer.start, inner.start) && le(inner.end, outer.end);
}

/** Whether a host document has anything to explain: shell code, or a part in another language. */
export function hasParts(extracted: Extracted): boolean {
  return extracted.regions.length > 0 || extracted.languages.length > 0;
}

/**
 * How many lines of a host document are parts in another language: lines of code, which the budget of a line counts (`withinLine`).
 * A line several calls share counts once: together they cost no more than one line's budget (`LanguageRegion.crowd`).
 */
export function languageLines(extracted: Extracted): number {
  return new Set(extracted.languages.flatMap((r) => r.lines)).size;
}

/**
 * The shell a region's code is explained and checked as: the one chosen (`forced`, the setting or the panel), else the
 * host's for it; undefined for bash, the analyzer's default (as `shellOf` for a script). Every reading of a region takes
 * it from here: the explanation, the problems, the colours, the pipefail check and the automatic shell.
 */
export function regionShell(region: ShellRegion, forced?: Shell): Shell | undefined {
  return forced ?? region.shell;
}
