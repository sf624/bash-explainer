// The data of the prototypes (viz-data.json): the reading tree of each example line (src/reading.ts, the model the
// panel's tree view draws), in the shape the prototypes were written for.
// Run from the root of the repository: npx tsx docs/design/tree-view/vizdata.ts > docs/design/tree-view/viz-data.json
import { Analyzer } from '../../../src/analyzer';
import type { ReadingNode } from '../../../src/reading';
import { createUnbashParser } from '../../../src/syntax/adapters/unbash';

const LINES = ['x=$(grep -c foo f) && [ "$x" -gt 0 ]', "find . -name '*.sh' | xargs grep -n 'set -e'"];

/** The prototypes' names for the layers and kinds. */
const LAYER = { bash: 'bash', child: 'child', command: 'cmd', language: 'lang' } as const;
const KIND: Record<string, string> = {
  line: 'script', command: 'simple', substitution: 'cmdsub', expansion: 'param', operator: 'op', language: 'lang',
};
/** What a node says when no token is about it (the panel says it from its own labels). */
const NOTE: Record<string, string> = {
  line: 'bash reads the line',
  script: 'A new bash parses this text as a script of its own',
  command: 'A simple command (3.2.2): assignments, words and redirections. bash runs the first word as the command and passes the other words to it.',
  word: 'A word. bash expands it, then passes the result to the command as an argument',
  name: 'The variable name',
  language: 'An embedded language, read by the command, not by bash',
};

interface V { id?: string; layer: string; kind: string; label: string; s: number; e: number; note?: string; children: V[] }

const parser = createUnbashParser();
const analyzer = new Analyzer('en');
const out = LINES.map((line) => {
  const tree = parser.parse(line);
  const ex = analyzer.explainLine(tree, 0, 'bash', { reading: true });
  const conv = (n: ReadingNode): V => {
    const shell = n.layer === 'bash' || n.layer === 'child';
    const kind = (shell || n.kind === 'language' ? KIND[n.kind] : undefined) ?? n.kind;
    const label = n.kind === 'reading' ? `${n.label} reads its arguments`
      : n.kind === 'line' ? 'bash' : n.kind === 'substitution' ? '$( … )' : n.kind === 'list' ? `list ${n.children.find((c) => c.kind === 'operator')!.label}`
      : n.kind === 'pipeline' ? 'pipeline |' : n.kind === 'command' && shell ? 'simple command' : n.label;
    const note = n.text ?? NOTE[n.kind];
    return { layer: LAYER[n.layer], kind, label, s: n.span.start.character, e: n.span.end.character, ...(note ? { note } : {}), children: n.children.map(conv) };
  };
  const root = conv(ex.reading!);
  let i = 0;
  const ids = (v: V): void => {
    v.id = `n${i++}`;
    v.children.forEach(ids);
  };
  ids(root);
  return { line, summary: ex.summary, root };
});
console.log(JSON.stringify(out));
