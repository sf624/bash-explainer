import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { Analyzer } from '../src/analyzer';
import { detectShell, type Shell } from '../src/dialect';
import { documentIssues, explainDocumentLine, type ShellDocument } from '../src/document';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import type { BashParser as Parser } from '../src/syntax/tree';

// The pitfalls as problems (src/document.ts, `pitfallIssues`) and the explanations say the same, over the corpus: each
// pitfall problem is a note of the line it starts on, and each pitfall note of a line, of the kinds the problems
// cover, is a problem there. For the shell each script says, and as sh and zsh.

const root = path.join(__dirname, '..');
const fixture = (name: string) => fs.readFileSync(path.join(root, 'test/fixtures', name), 'utf8');
const corpus: [string, string][] = [
  ...['sample.sh', 'coverage.sh', 'posix.sh', 'ksh.ksh'].map((f): [string, string] => [f, fixture(f)]),
  ...(JSON.parse(fixture('snippets.json')) as string[]).map((s, i): [string, string] => [`snippet ${i}`, s]),
];
/** The codes of the catalog's pitfalls that are problems (src/wordfacts.ts); the style checks are not facts. */
const WORD_CODES = new Set(['prefix-assignment-expanded-first', 'unquoted-variable-as-path', 'unquoted-variable-in-test', 'for-over-ls-output',
  'for-over-unquoted-args', 'redirect-by-your-shell', 'nounset-unbound', 'shebang-refused']);
const PITFALL = /^⚠ (?:Pitfall|落とし穴): /;
/** The statements explained line by line, not whole (src/analyzer.ts, `sub`). */
const BLOCKS = new Set(['if_statement', 'for_statement', 'c_style_for_statement', 'while_statement', 'case_statement', 'function_definition', 'compound_statement', 'subshell', 'select_statement']);

let parser: Parser;
before(() => {
  parser = createUnbashParser();
});

describe('pitfall problems and the explanations agree', () => {
  it('over the corpus, in every shell tried', function () {
    this.timeout(120_000);
    const analyzer = new Analyzer('en');
    const opts = { examples: { enabled: false, disabled: [] } };
    const problems: string[] = [];
    let checked = 0;
    for (const [name, text] of corpus) {
      const file = name.endsWith('.sh') || name.endsWith('.ksh') ? name : 'a.sh';
      const doc: ShellDocument = { lines: text.split('\n'), tree: parser.parse(text) };
      for (const shell of new Set<Shell | undefined>([detectShell(text, file), 'sh', 'zsh'])) {
        const all = documentIssues(doc, 'en', { forced: shell });
        const issues = all.filter((i) => i.pitfall);
        // (A line zsh syntax leaves unread has notes, but no problems.)
        const unread = all.filter((i) => i.code === 'zshSyntax');
        for (let line = 0; line < doc.lines.length; line++) {
          const here = issues.filter((i) => i.startLine === line);
          const ex = explainDocumentLine(analyzer, doc, line, 'en', { forced: shell }, opts);
          checked++;
          const where = `${name} (${shell ?? 'bash'}) line ${line + 1}: ${doc.lines[line]}`;
          for (const i of here) if (!ex.notes.includes(i.message)) problems.push(`${where}\n  problem [${i.code}] not in the notes: ${i.message}`);
          if (unread.some((i) => i.startLine <= line && line <= i.endLine)) continue;
          for (const note of ex.notes.filter((n) => PITFALL.test(n))) {
            const f = ex.facts?.find((x) => x.text === note);
            if (f && !WORD_CODES.has(f.id)) continue;
            // (A statement over several lines that is not a block is explained whole: its notes may be of a later line of it.)
            const top = doc.tree.root.namedChildren.find((c) => c.startPosition.row <= line && line <= c.endPosition.row);
            const last = top && top.startPosition.row === line && !BLOCKS.has(top.type) ? top.endPosition.row : line;
            if (!issues.some((i) => i.startLine >= line && i.startLine <= last && i.message === note)) problems.push(`${where}\n  note not a problem${f ? ` [${f.id}]` : ''}: ${note}`);
          }
        }
      }
    }
    assert.deepStrictEqual(problems, []);
    assert.ok(checked > 1000, `${checked} lines checked`);
  });
});
