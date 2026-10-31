// Where a long line may wrap on the web page: only between the words bash reads (docs/design/chrome-redesign.md, C1a).
// A run is a part of a line that must not break: a word with its quotes, `$( )`, `${ }`, `<( )` and backquotes, and
// every other stretch of text without a blank (an operator, a comment's word, a line of a here-document). The editor
// keeps each run on one row where it fits (web/word-wrap.ts); a run wider than a row breaks at its own blanks, and as a
// last resort anywhere. The words come from the syntax tree, so this is no second reader of shell syntax: the tree is
// checked against bash's own parser (test/bash-ast.test.ts). A line the parser cannot read breaks at its blanks only.
import type { ShellDocument } from '../document';
import type { SyntaxNode } from '../syntax/tree';

/** A part of a line that must not break, as [from, to) columns of the line (UTF-16 code units). */
export type Run = readonly [from: number, to: number];

/** The nodes that are one word to bash, or one part of a word: blanks inside them do not split the word. */
const WORDS = new Set([
  'word', 'concatenation', 'string', 'raw_string', 'ansi_c_string', 'translated_string',
  'expansion', 'simple_expansion', 'command_substitution', 'process_substitution', 'arithmetic_expansion',
]);

/** A substitution over several lines holds whole commands (`x=$(` … `)`): its lines are read as lines of their own. */
const COMMANDS_INSIDE = new Set(['command_substitution', 'process_substitution']);

const blank = (c: string) => c === ' ' || c === '\t';

/** The runs of a text with no tree: the stretches between its blanks. */
export function blankRuns(text: string): Run[] {
  const out: Run[] = [];
  for (const m of text.matchAll(/[^ \t]+/g)) out.push([m.index, m.index + m[0].length]);
  return out;
}

/**
 * The runs of each line of a document, from its syntax tree: index `i` holds the runs of `doc.lines[i]`, in order and
 * apart, together covering every character that is not a blank. In a host file (a Dockerfile, a workflow…), the shell
 * code's words are moved back to the file's columns, and the host's own lines break at their blanks. Text the parser
 * could not read, and a construct that is not closed yet (the user is typing), break at their blanks.
 */
export function wrapRuns(doc: ShellDocument): Run[][] {
  // The blanks inside a word, per line: [from, to) columns, as the tree's text has them.
  const glue: Array<Array<[number, number]>> = doc.lines.map(() => []);
  const rowLength = (row: number) => doc.lines[row].length;
  const add = (n: SyntaxNode) => {
    const { startPosition: s, endPosition: e } = n;
    for (let row = s.row; row <= e.row; row++) glue[row].push([row === s.row ? s.column : 0, row === e.row ? e.column : rowLength(row)]);
  };
  const visit = (n: SyntaxNode) => {
    if (n.type === 'error') return;
    const multi = n.endPosition.row > n.startPosition.row;
    if (WORDS.has(n.type) && !n.incomplete && /[ \t]/.test(n.text) && !(multi && COMMANDS_INSIDE.has(n.type))) return add(n);
    for (const c of n.children) visit(c);
  };
  visit(doc.tree.root);
  // Lines with text the parser could not read: no word is trusted there.
  const unread = new Set<number>();
  for (const e of doc.tree.errors) {
    if (e.kind !== 'unreadable') continue;
    const to = rowOf(doc.tree.text, Math.max(e.startIndex, e.endIndex - 1));
    for (let r = rowOf(doc.tree.text, e.startIndex); r <= to; r++) unread.add(r);
  }
  const maps = doc.extracted?.maps;
  return doc.lines.map((text, row) => {
    if (unread.has(row) || !glue[row].length) return blankRuns(text);
    const map = maps?.[row];
    const col = (c: number) => Math.min(map ? map[Math.min(c, map.length - 1)] : c, text.length);
    // Each character: kept with the one before it when it is not a blank, or a blank inside a word.
    const keep = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) keep[i] = blank(text[i]) ? 0 : 1;
    for (const [a, b] of glue[row]) keep.fill(1, col(a), col(b));
    const out: Run[] = [];
    for (let i = 0; i < text.length;) {
      if (!keep[i] || blank(text[i])) {
        i++;
        continue;
      }
      let j = i;
      while (j < text.length && keep[j]) j++;
      // (A word over several lines keeps the blanks that start or end a line: they are not part of the run.)
      let end = j;
      while (blank(text[end - 1])) end--;
      out.push([i, end]);
      i = j;
    }
    return out;
  });
}

/** The row of an offset of a text. */
function rowOf(text: string, index: number): number {
  let row = 0;
  for (let i = text.indexOf('\n'); i >= 0 && i < index; i = text.indexOf('\n', i + 1)) row++;
  return row;
}
