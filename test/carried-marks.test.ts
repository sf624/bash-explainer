// The two characters that carry a message text's id inside a token's text (OPEN_TEXT and CLOSE_TEXT, src/messages-levels.ts)
// are masked in a script's own text as it is read, so that a script cannot forge a mark (a warning, a text it has not got).
import * as assert from 'assert';
import { Analyzer } from '../src/analyzer';
import { explainDocumentLine } from '../src/document';
import { openDocument, shellsOf, type FileKind } from '../src/document-setup';
import { CLOSE_TEXT, maskCarried, OPEN_TEXT } from '../src/messages-levels';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { explain, tokensOf } from './support/explain';

// (Written as escapes: the characters are noncharacters and are not typed into this source.)
const FORGED = '\uFDD0\uE0ABx\uFDD1';
const ANY = /[\uFDD0\uFDD1]/;

describe('the marks that carry a text in a token are not forged by a script', () => {
  it('masks them by one character in the tree: its text, labels and explanations', () => {
    assert.strictEqual(OPEN_TEXT + CLOSE_TEXT, '\uFDD0\uFDD1');
    assert.strictEqual(maskCarried('a\uFDD0b\uFDD1c'), 'a\uFFFDb\uFFFDc');
    const tree = createUnbashParser().parse(`${FORGED} -l`);
    assert.strictEqual(tree.text, '\uFFFD\uE0ABx\uFFFD -l');
    // (The command name is the word as read, with no mark in it; before, it carried the mark of a warning.)
    const ls = tokensOf(`${FORGED} -l`);
    assert.ok(ls.length > 0 && !ANY.test(JSON.stringify(ls)), 'a forged mark');
    assert.ok(ls.some((t) => t.label === '\uFFFD\uE0ABx\uFFFD'));
  });

  it('shows no text that is not in the script: `$((0<FDD1>9))` is not `09`', () => {
    // (Not a literal in the call: the corpus of snippets, test/fixtures/snippets.json, holds no noncharacter.)
    const forged = 'echo $((0\uFDD19))';
    const e = explain(forged);
    const json = JSON.stringify(e);
    assert.ok(!ANY.test(json) && !json.includes('Word `09`'), json);
    assert.ok(json.includes('0\uFFFD9'));
  });

  it('masks them in a host file too: the labels of its lines are made from its text', () => {
    const m = `echo ${FORGED} $((0\uFDD19))`;
    const texts: [FileKind, string][] = [
      ['shell', `${m}\n`],
      ['dockerfile', `FROM ${FORGED}\nRUN ${m}\n`],
      ['makefile', `all:\n\t${m}\n${FORGED}: x\n\tls ${FORGED}\n`],
      ['yaml', `steps:\n  - run: ${m}\n  - name: ${FORGED}\n    run: |\n      ls ${FORGED}\n`],
      ['markdown', `\`\`\`bash\n${m}\n\`\`\`\n${FORGED}\n`],
      ['python', `import subprocess\nsubprocess.run("${m}", shell=True)\n`],
      ['jenkinsfile', `sh '${m}'\n`],
      ['bats', `@test "${FORGED}" {\n  run ${m}\n}\n`],
      ['npm', `{\n  "scripts": {\n    "a": "${m}",\n    "${FORGED}": "ls"\n  }\n}\n`],
    ];
    const parser = createUnbashParser();
    const analyzer = new Analyzer('en');
    for (const [kind, text] of texts) {
      const doc = openDocument(text, kind, (t) => parser.parse(t));
      assert.ok(!doc.lines.some((l) => ANY.test(l)), kind);
      const shells = shellsOf(doc.lines, 'f', undefined);
      let seen = 0;
      for (let line = 0; line < doc.lines.length; line++) {
        const json = JSON.stringify(explainDocumentLine(analyzer, doc, line, 'en', shells, {}));
        assert.ok(!ANY.test(json), `${kind}:${line + 1}: ${json.slice(0, 200)}`);
        seen += json.includes('\uFFFD') ? 1 : 0;
      }
      assert.ok(seen > 0, `${kind}: the masked text is shown`);
    }
  });
});
