// The shells of a host file: which regions of its shell code one shell runs, and the tree that shell reads (for the
// explanations, the problems and the colours).
import type { Shell } from '../shellfeatures';
import type { BashParser, SyntaxTree } from '../syntax/tree';
import { createUnbashParser } from '../syntax/adapters/unbash';
import type { Extracted, ShellRegion } from './index';

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
 * The row where the shell that runs `line` of `region` started, for what may stop it (`stopBefore`, src/semantics/scriptstops.ts): in the tree of the region's
 * group (`scriptTree`), which is one shell. But a reader runs each fence of a Markdown file by itself, and bats runs each test in a process of its own.
 */
export function shellStart(region: ShellRegion, line: number): number {
  return region.host.kind === 'markdown' ? region.start : region.tests?.filter((t) => t <= line).pop() ?? 0;
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
 * The shell a region's code is explained and checked as: the one chosen (`forced`, the setting or the panel), else the
 * host's for it; undefined for bash, the analyzer's default (as `shellOf` for a script). Every reading of a region takes
 * it from here: the explanation, the problems, the colours, the pipefail check and the automatic shell.
 */
export function regionShell(region: ShellRegion, forced?: Shell): Shell | undefined {
  return forced ?? region.shell;
}
