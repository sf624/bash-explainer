// The command over several lines at the cursor (src/ui/blockAt.ts), for the editors to mark: exact rows for each kind
// of block, in a script and in the files that hold shell code, and every line of the curated sample against the tree.
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { openDocument } from '../src/document-setup';
import type { FileKind } from '../src/document-setup';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { descendants, type SyntaxNode } from '../src/syntax/tree';
import { BLOCK_TYPES, blockAt, placeOf } from '../src/ui/blockAt';

const parser = createUnbashParser();
const open = (text: string, kind: FileKind = 'shell') => openDocument(text, kind, (t) => parser.parse(t));
/** The block of every line (the cursor at the line's end, or at column `col`), as the rows `first-last` (1-based), or `-`. */
function blocks(text: string, kind: FileKind = 'shell', col?: number): string[] {
  const doc = open(text, kind);
  return doc.lines.map((l, i) => {
    const b = blockAt(doc, i, col ?? l.length);
    return b ? `${b.startLine + 1}-${b.endLine + 1}` : '-';
  });
}

describe('blockAt', () => {
  const table: Array<[string, string, string[]]> = [
    ['a for loop', 'for f in a b; do\n  echo $f\ndone\necho', ['1-3', '1-3', '1-3', '-']],
    ['a for loop of arithmetic, and select', 'for ((i=0;i<3;i++)); do\n  a\ndone\nselect x in a; do\n  b\ndone', ['1-3', '1-3', '1-3', '4-6', '4-6', '4-6']],
    ['an if with elif and else', 'if a; then\n  b\nelif c; then\n  d\nelse\n  e\nfi\nz', ['1-7', '1-7', '1-7', '1-7', '1-7', '1-7', '1-7', '-']],
    ['an until loop', 'until a; do\n  b\ndone\nz', ['1-3', '1-3', '1-3', '-']],
    ['a process substitution and backquotes over lines', 'diff <(\n  a\n) b\nx=`\na\n`\nz', ['1-3', '1-3', '1-3', '4-6', '4-6', '4-6', '-']],
    ['a while loop', 'while read x; do\n  echo $x\ndone\necho', ['1-3', '1-3', '1-3', '-']],
    ['a case', 'case $x in\n  a)\n    b\n    ;;\n  *) c ;;\nesac\nz', ['1-6', '1-6', '1-6', '1-6', '1-6', '1-6', '-']],
    ['a function', 'f() {\n  x=1\n  y=2\n}\nz', ['1-4', '1-4', '1-4', '1-4', '-']],
    ['a function with its brace on the next line', 'f()\n{\n  a\n}\nz', ['1-4', '1-4', '1-4', '1-4', '-']],
    ['a group and a subshell', '{\n  a\n}\n(\n  b\n)\nz', ['1-3', '1-3', '1-3', '4-6', '4-6', '4-6', '-']],
    ['a $( ) over lines: it, and a pipeline inside it', 'x=$(\n  a |\n  b\n)\nz', ['1-4', '2-3', '2-3', '1-4', '-']],
    ['a $( ) with a single line inside', 'x=$(\n  a\n)\nz', ['1-3', '1-3', '1-3', '-']],
    ['a pipeline over lines', 'a |\n  b |\n  c\nd', ['1-3', '1-3', '1-3', '-']],
    ['a here-document', 'cat <<EOF\nhi\nEOF\nx', ['1-3', '1-3', '1-3', '-']],
    ['a here-document in a function: the command only, not the function', 'f() {\n  cat <<EOF\n  hi\nEOF\n  x\n}\n', ['1-6', '2-4', '2-4', '2-4', '1-6', '1-6', '-']],
    ['a loop that reads a file (the redirection is on the last line)', 'while read x; do\n  echo\ndone < f\nz', ['1-3', '1-3', '1-3', '-']],
    ['a list with a line continuation', '[ a ] && \\\n  b\nc', ['1-2', '1-2', '-']],
    ['a chain of && and || over lines is one block', 'a && \\\n b || \\\n c\nd', ['1-3', '1-3', '1-3', '-']],
    ['a command with its arguments over lines', 'tar \\\n  -c \\\n  -f x\necho', ['1-3', '1-3', '1-3', '-']],
    ['a command and its redirection over lines', 'cat \\\n  < a\necho', ['1-2', '1-2', '-']],
    ['a negated and a timed loop', '! for f in a; do\n  b\ndone\ntime for f in a; do\n  b\ndone', ['1-3', '1-3', '1-3', '4-6', '4-6', '4-6']],
    ['an unclosed if: to its last line, and the empty line after it counts as inside', 'if x; then\n  y\n', ['1-2', '1-2', '1-2']],
    ['an unclosed here-document with no second row yet is not a block', 'cat <<EOF\n', ['-', '-']],
    ['an unclosed string with no second row yet is not a block', 'echo "a\n', ['-', '-']],
    ['an unclosed $( ) with no second row yet is not a block', 'echo $(\n', ['-', '-']],
    ['an unclosed function', 'f() {\n  a\n', ['1-2', '1-2', '1-2']],
    ['an unclosed if with blank lines after it: only the first', 'if x; then\n  y\n\n\n', ['1-2', '1-2', '1-2', '-', '-']],
    ['statements of a top-level list over lines are not a block', 'a; \\\n b\nc', ['-', '-', '-']],
    ['single-line statements', 'echo a\nfor f in a; do b; done\nif a; then b; fi\nf() { a; }', ['-', '-', '-', '-']],
    ['a comment line and a blank line inside a block', 'for f in a; do\n  # c\n\n  echo\ndone\n\necho', ['1-5', '1-5', '1-5', '1-5', '1-5', '-', '-']],
    ['blocks nested in blocks: the innermost', 'for f in a; do\n  if x; then\n    y\n  fi\ndone\necho', ['1-5', '2-4', '2-4', '2-4', '1-5', '-']],
    ['an unclosed string in a loop: the loop is still the block', 'for x in y; do\n  echo "a\n', ['1-2', '1-2', '1-2']],
    ['an unclosed here-document in an if', 'if x; then\n  cat <<EOF\n', ['1-2', '1-2', '1-2']],
    ['an unclosed $( ) in a function', 'f() {\n  y=$(\n', ['1-2', '1-2', '1-2']],
    ['a [[ ]] over lines', '[[ a &&\n b ]]\nz', ['1-2', '1-2', '-']],
    ['a (( )) over lines', '((\n a\n))\nz', ['1-3', '1-3', '1-3', '-']],
    ['a string over lines', 'echo "a\nb"\nc', ['1-2', '1-2', '-']],
  ];
  for (const [what, text, expected] of table) {
    it(`gives the rows of ${what}`, () => assert.deepStrictEqual(blocks(text), expected));
  }

  it('gives the same block from any column of a line, also from the redirection of `done < f` and from blanks', () => {
    const text = 'while read x; do\n  echo\n  done < f   \nz';
    const doc = open(text);
    for (const [line, expected] of [[0, '1-3'], [1, '1-3'], [2, '1-3'], [3, '-']] as const) {
      for (let col = 0; col <= doc.lines[line].length + 3; col++) {
        const b = blockAt(doc, line, col);
        assert.strictEqual(b ? `${b.startLine + 1}-${b.endLine + 1}` : '-', expected, `${line}:${col}`);
      }
    }
  });

  it('gives the block from every column of its last row, also on a trailing comment, and not the outer block', () => {
    for (const [text, line, expected] of [
      ['for a in b; do\n  c\ndone # end of loop\nz', 2, '1-3'],
      ['for a in b; do\n  if x; then\n    y\n  fi # end if\ndone\nz', 3, '2-4'],
      ['f() {\n  a\n} # end f\nz', 2, '1-3'],
      ['for a in b; do\n  if x; then\n    y\n  fi   \ndone # end\nz', 4, '1-5'],
    ] as const) {
      const doc = open(text);
      for (let col = 0; col <= doc.lines[line].length + 3; col++) {
        const b = blockAt(doc, line, col);
        assert.strictEqual(b ? `${b.startLine + 1}-${b.endLine + 1}` : '-', expected, `${text.split('\n')[line]} at ${col}`);
      }
    }
    // A command after the block on the same row is not in it.
    const doc = open('if a; then\n  b\nfi # c\n');
    assert.strictEqual(blockAt(doc, 2, 5)?.endLine, 2);
    const two = open('if a; then\n  b\nfi; echo z # c\n');
    assert.strictEqual(blockAt(two, 2, 10), undefined);
  });

  it('puts the cursor on a statement of one line after the block (`fi; c`) outside it', () => {
    const doc = open('if a; then\n  b\nfi; c\nd');
    assert.deepStrictEqual([0, 1, 2, 3].map((c) => blockAt(doc, 2, c)?.endLine), [2, 2, 2, undefined]);
    assert.strictEqual(blockAt(doc, 2, 5), undefined);
    assert.strictEqual(blockAt(doc, 3, 1), undefined);
  });

  it('tells where a row is in its block', () => {
    const b = { startLine: 2, endLine: 5 };
    assert.deepStrictEqual([1, 2, 3, 4, 5, 6].map((n) => placeOf(b, n)), ['mid', 'first', 'mid', 'mid', 'last', 'mid']);
  });

  describe('in the files that hold shell code, in rows of the document', () => {
    it('a Makefile recipe (a `\\` continues it; `$$` is one `$`)', () => {
      assert.deepStrictEqual(blocks('all:\n\tfor f in a; do \\\n\t  echo $$f; \\\n\tdone\n\techo\nclean:\n\trm x\n', 'makefile'), ['-', '2-4', '2-4', '2-4', '-', '-', '-', '-']);
      // From a column in the tab, and from beyond the end.
      assert.deepStrictEqual([0, 1, 40].map((c) => blockAt(open('all:\n\tfor f in a; do \\\n\t  echo $$f; \\\n\tdone\n', 'makefile'), 2, c)), Array(3).fill({ startLine: 1, endLine: 3 }));
    });
    it('a workflow `run:` block, inside the YAML', () => {
      assert.deepStrictEqual(blocks('jobs:\n  b:\n    steps:\n      - run: |\n          for f in a; do\n            echo $f\n          done\n          echo\n', 'yaml'), ['-', '-', '-', '-', '5-7', '5-7', '5-7', '-', '-']);
    });
    it('a Markdown fence', () => {
      assert.deepStrictEqual(blocks('# t\n\n```bash\nif x; then\n  y\nfi\n```\n', 'markdown'), ['-', '-', '-', '4-6', '4-6', '4-6', '-', '-']);
    });
    it('a Dockerfile RUN with `\\`', () => {
      assert.deepStrictEqual(blocks('FROM a\nRUN a && \\\n  b && \\\n  c\nRUN for f in a; do \\\n    echo $f; \\\n  done\nCMD x\n', 'dockerfile'), ['-', '2-4', '2-4', '2-4', '5-7', '5-7', '5-7', '-', '-']);
    });
    it('a block stays in the shell that runs it: an unclosed one does not run on into the next part', () => {
      // A Makefile: each recipe line is a shell of its own, so `for` over lines is no command over lines.
      assert.deepStrictEqual(blocks('all:\n\tfor a in b; do\n\t  c\n\tdone\n', 'makefile'), ['-', '-', '-', '-', '-']);
      // A workflow: the unclosed `if` ends with its `run:` block, not at the next step.
      assert.deepStrictEqual(blocks('jobs:\n  b:\n    steps:\n      - run: |\n          if a; then\n            b\n      - name: other\n        run: |\n          echo x\n', 'yaml'),
        ['-', '-', '-', '-', '5-6', '5-6', '-', '-', '-', '-']);
      // A Dockerfile: the unclosed `if` ends with its RUN, and CMD is not in it.
      assert.deepStrictEqual(blocks('FROM x\nRUN if a; then \\\n  b\nRUN c\nCMD d\n', 'dockerfile'), ['-', '2-3', '2-3', '-', '-', '-']);
      // Markdown: a reader runs each fence by itself; the prose and the next fence are not in the block.
      assert.deepStrictEqual(blocks('# t\n\n```bash\necho "a\nb\n```\n\ntext\n\n```bash\necho b\n```\n', 'markdown'), ['-', '-', '-', '4-5', '4-5', '-', '-', '-', '-', '-', '-', '-', '-']);
    });
    it('a line that is not shell code, in the middle of a recipe block of the file', () => {
      const doc = open('x := 1\nall:\n\tfor f in a; do \\\n\t  b; \\\n\tdone\n', 'makefile');
      assert.strictEqual(blockAt(doc, 0, 3), undefined);
      assert.strictEqual(blockAt(doc, 1, 2), undefined);
    });
  });

  describe('against the tree, on every line of the curated sample', () => {
    const sample = fs.readFileSync(path.join(__dirname, 'fixtures', 'sample.sh'), 'utf8');
    const doc = open(sample);
    const types = [...BLOCK_TYPES];
    /** The rows of every such node over several lines. */
    const nodes = descendants(doc.tree.root, types).filter((n) => n.endPosition.row > n.startPosition.row);
    const rowsOf = (n: SyntaxNode) => `${n.startPosition.row}-${n.endPosition.column === 0 ? n.endPosition.row - 1 : n.endPosition.row}`;
    const real = new Set(nodes.map(rowsOf));

    it('has statements over several lines to look at', () => assert.ok(nodes.length > 10));

    it('gives, from every column of every line, rows of such a node that hold the line (and does not crash)', () => {
      let framed = 0;
      doc.lines.forEach((text, line) => {
        for (let col = 0; col <= text.length; col++) {
          const b = blockAt(doc, line, col);
          if (!b) continue;
          framed++;
          assert.ok(real.has(`${b.startLine}-${b.endLine}`), `${line + 1}:${col} gives rows no node has`);
          // (The empty line after an unclosed block is the only line outside the rows it holds; the sample has none.)
          assert.ok(b.startLine <= line && line <= b.endLine, `${line + 1}:${col} is outside ${b.startLine + 1}-${b.endLine + 1}`);
        }
      });
      assert.ok(framed > 100);
    });

    it('gives from the first word of a line the smallest such node that holds it', () => {
      doc.lines.forEach((text, line) => {
        const col = text.length - text.trimStart().length;
        if (col === text.length) return;
        const holding = nodes.filter((n) => {
          const a = n.startPosition;
          const z = n.endPosition;
          return (line > a.row || (line === a.row && col >= a.column)) && (line < z.row || (line === z.row && col < z.column));
        });
        // The smallest by rows and then by size; a chain of && and || is its outermost list.
        const size = (n: SyntaxNode) => (n.endPosition.row - n.startPosition.row) * 1e6 + (n.endPosition.column - n.startPosition.column);
        let best = holding.sort((x, y) => size(x) - size(y))[0];
        while (best?.type === 'list' && best.parent?.type === 'list') best = best.parent;
        const b = blockAt(doc, line, col);
        assert.strictEqual(b ? `${b.startLine}-${b.endLine}` : undefined, best ? rowsOf(best) : undefined, `line ${line + 1}: ${text}`);
      });
    });
  });
});
