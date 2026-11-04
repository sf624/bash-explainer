// What one move of the cursor costs in the panel (docs/design/panel-redesign.md, section 5): the line explained with the options of the
// panel's hosts, the message made with the filter of the file's problems, as src/ui/panel.ts makes it for each update, and the message written
// out, as a host posts it. The document's problems are made once before (they are
// cached per tree: `noteIssues`). Read by test/panel-speed.test.ts, and by scripts/panel-speed.ts on real scripts.
import { Analyzer } from '../../src/analyzer';
import { documentIssues, explainDocumentLine, issueFilter } from '../../src/document';
import { defaultSettings, explainOptions } from '../../src/settings';
import { createUnbashParser } from '../../src/syntax/adapters/unbash';
import { explainNeeds, panelUpdate } from '../../src/ui/panelView';

export interface Moves {
  lines: number;
  /** The time of each move, in ms, by the line moved to (0-based). */
  times: { line: number; ms: number }[];
}

const SHELLS = { detected: { shell: 'bash', source: 'default' } } as const;

/** The lines of `count` moves over the script at a depth (the panel's hosts build the reading tree at depth 2 only): evenly spread, and the first line of each of its longest statements. */
export function panelMoves(text: string, count: number, depth: 1 | 2 = 1): Moves {
  const lines = text.split('\n');
  const tree = createUnbashParser().parse(text);
  const doc = { lines, tree };
  const issues = documentIssues(doc, 'en', SHELLS);
  const analyzer = new Analyzer('en');
  const settings = defaultSettings();
  const options = { ...explainOptions(settings), sentence: true, ...explainNeeds({ depth }) };
  const longest = [...tree.root.namedChildren].sort((a, b) => (b.endPosition.row - b.startPosition.row) - (a.endPosition.row - a.startPosition.row));
  const at = new Set([...Array(count).keys()].map((i) => Math.floor((i * lines.length) / count)));
  for (const n of longest.slice(0, Math.ceil(count / 10))) at.add(n.startPosition.row);
  const times = [...at].map((line) => {
    const start = performance.now();
    const explanation = explainDocumentLine(analyzer, doc, line, 'en', SHELLS, options);
    JSON.stringify(panelUpdate({ lang: 'en', explanation, file: 'f', line, lineText: lines[line], doc, wrap: true, choice: {}, detected: SHELLS.detected, placement: 'first', animations: true, issues, shown: issueFilter(doc, settings, 'vscode'), state: { depth } }));
    return { line, ms: performance.now() - start };
  });
  return { lines: lines.length, times };
}

/** The time at a percentile of the moves, in ms. */
export function percentile(m: Moves, p: number): number {
  const sorted = m.times.map((t) => t.ms).sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}
