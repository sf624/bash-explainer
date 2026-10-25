import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { Analyzer } from '../src/analyzer';
import { detectShell, type Shell } from '../src/dialect';
import { type DocumentIssue, documentIssues, explainDocumentLine, type ShellDocument } from '../src/document';
import { severityOf } from '../src/messages';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import type { BashParser as Parser } from '../src/syntax/tree';

// The warnings and caveats of the explanations as problems (src/document.ts, `noteIssues`) and the explanations say the
// same, over the corpus: each such problem is a note of a line, at the level of its severity, on a node the note was
// found on; each warning or caveat a line says on a node is a problem there; a plain fact never is. For the shell each
// script says, and as sh and zsh.

const root = path.join(__dirname, '..');
const fixture = (name: string) => fs.readFileSync(path.join(root, 'test/fixtures', name), 'utf8');
const corpus: [string, string][] = [
  ...['sample.sh', 'coverage.sh', 'posix.sh', 'ksh.ksh'].map((f): [string, string] => [f, fixture(f)]),
  ...(JSON.parse(fixture('snippets.json')) as string[]).map((s, i): [string, string] => [`snippet ${i}`, s]),
];

let parser: Parser;
before(() => {
  parser = createUnbashParser();
});

describe('the problems of the notes and the explanations agree', () => {
  it('over the corpus, in every shell tried', function () {
    this.timeout(180_000);
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
        const others = all.filter((i) => !i.pitfall);
        // (A line zsh syntax leaves unread has notes, but no problems.)
        const unread = others.filter((i) => i.code === 'zshSyntax');
        const said = new Set<DocumentIssue>();
        for (let line = 0; line < doc.lines.length; line++) {
          const ex = explainDocumentLine(analyzer, doc, line, 'en', { forced: shell }, opts);
          checked++;
          const where = `${name} (${shell ?? 'bash'}) line ${line + 1}: ${doc.lines[line]}`;
          for (const n of ex.noteInfo) {
            const at = (ex.anchors ?? []).filter((a) => a.text === n.text).map((a) => a.span.start);
            const here = issues.filter((i) => i.message === n.text && at.some((p) => p.line === i.startLine && p.character === i.startCol));
            here.forEach((i) => said.add(i));
            if (n.level === 'note') {
              if (here.length) problems.push(`${where}\n  a plain fact is a problem: ${n.text}`);
              continue;
            }
            // (The problem's severity and code are the note's: docs/design/note-levels.md.)
            for (const i of here) if (i.severity !== severityOf(n.level) || i.code !== n.code) problems.push(`${where}\n  problem [${i.code}] is ${i.severity}: ${n.text}`);
            for (const p of at) {
              if (unread.some((i) => i.startLine <= p.line && p.line <= i.endLine)) continue;
              // (Said already by another problem where it is.)
              if (others.some((i) => i.startLine === p.line && (i.code === n.code || i.message === n.text))) continue;
              if (!here.some((i) => i.startLine === p.line && i.startCol === p.character)) problems.push(`${where}\n  note not a problem [${n.code}] at ${p.line + 1}:${p.character + 1}: ${n.text}`);
            }
          }
        }
        for (const i of issues) if (!said.has(i)) problems.push(`${name} (${shell ?? 'bash'}): problem [${i.code}] at ${i.startLine + 1}:${i.startCol + 1} is no note of a line: ${i.message}`);
      }
    }
    assert.deepStrictEqual(problems, []);
    assert.ok(checked > 1000, `${checked} lines checked`);
  });
});
