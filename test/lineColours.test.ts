import * as assert from 'assert';
import { Analyzer } from '../src/analyzer';
import { explainDocumentLine, leanExplanation, leanOptions, noteIssues } from '../src/document';
import { openDocument, shellsOf } from '../src/document-setup';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { lineColours } from '../src/ui/lineColours';
import { lineOwners } from '../src/ui/render';
import { KIND_ROLES } from '../src/roles';

const parser = createUnbashParser();
const open = (text: string) => openDocument(text, 'shell', (s) => parser.parse(s));

describe('the colours of a line from its tokens', () => {
  const runs = (text: string, line = 0) => {
    const doc = open(text);
    const shells = shellsOf(doc.lines, 'a.sh', undefined, 'said');
    return lineColours(doc.lines[line], leanExplanation(doc, line, 'en', shells, leanOptions({})))
      .map((r) => `${doc.lines[line].slice(r.from, r.to)}|${r.role}`);
  };

  it('takes the role of the deepest token, as the panel colours its line box', () => {
    // (The option's value is the option's; the format's own variables are variables, read from git's spec.)
    // (A blank inside a token is that token's: the command's between its words, the string's inside the format.)
    assert.deepEqual(runs("git log --pretty=format:'%h %s' --date=short"), [
      'git log |command', '--pretty=|option', 'format:|keyword', "'|option", '%h|variable', ' |string', '%s|variable', "'|option", ' |command', '--date=short|option',
    ]);
    assert.deepEqual(runs('echo "$x" > out # done'), ['echo |builtin', '"|string', '$x|variable', '"|string', ' > out|redirect', '# done|comment']);
  });

  it('gives each line of a statement over several lines its own part', () => {
    assert.deepEqual(runs('cat <<EOF\nhello $x\nEOF', 1), ['hello |redirect', '$x|variable']);
  });

  it('is the panel’s run for run, in either language and with the lean options', () => {
    const text = 'f() { grep -E "^a+" "$@"; }\nfor i in 1 2; do f "$i" | sed s/a/b/; done';
    const doc = open(text);
    const shells = shellsOf(doc.lines, 'a.sh', undefined, 'said');
    for (let line = 0; line < doc.lines.length; line++) {
      const full = explainDocumentLine(new Analyzer('ja'), doc, line, 'ja', shells, {});
      const panel = lineOwners(doc.lines[line], line, full.items).filter((r) => r.owner).map((r) => `${r.from}-${r.to}:${KIND_ROLES[r.owner!.kind]}`);
      const ours = lineColours(doc.lines[line], leanExplanation(doc, line, 'en', shells, leanOptions({})));
      // (Neighbouring runs of one role are one run here.)
      const chars = (list: string[]) => list.flatMap((r) => { const [a, b, role] = r.split(/[-:]/); return Array.from({ length: +b - +a }, (_, i) => `${+a + i}${role}`); });
      assert.deepEqual(chars(ours.map((r) => `${r.from}-${r.to}:${r.role}`)), chars(panel), doc.lines[line]);
    }
  });

  it('shares the lean explanations with the problems of the document', () => {
    const doc = open('rm -rf $dir/\necho ok');
    const shells = shellsOf(doc.lines, 'a.sh', undefined, 'said');
    const before = leanExplanation(doc, 0, 'en', shells, leanOptions({}));
    assert.ok(noteIssues(doc, 'en', shells, {}).length);
    assert.strictEqual(leanExplanation(doc, 0, 'en', shells, leanOptions({})), before);
  });
});
