// Collects the bash snippets in the tests: the string literals passed to the helpers that parse or
// explain a script (`explain('…')`, `parser.parse('…')`…). The syntax tests and the fuzz
// (test/syntax-fuzz.test.ts) take them as inputs.
//
//   npx tsx scripts/extract-snippets.ts           rewrite test/fixtures/snippets.json
//   npx tsx scripts/extract-snippets.ts --check   fail if the file is out of date
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

const root = path.join(__dirname, '..');
const OUT = path.join(root, 'test/fixtures/snippets.json');
/** The helpers whose first argument is a script. */
const HELPERS = new Set(['explain', 'parsed', 'tokens', 'analyze', 'parse', 'explainHost', 'explainHosted']);
/** `parse` is only a script parser on these objects (`JSON.parse`, `Date.parse`… are not). */
const PARSER_OBJECTS = new Set(['parser', 'p', 'tsParser']);

/** The tests whose tables (`[['script', expected], …]`, `for (const src of ['script', …])`) hold scripts. */
const TABLE_FILES = new Set([
  'analyzer', 'branches', 'dialect', 'dictionary', 'fixes', 'lines', 'pitfalls', 'expansion', 'settings', 'testexpr', 'rerun', 'render', 'document', 'find',
].map((f) => `${f}.test.ts`));
const isText = (n: ts.Node): n is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral => ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n);

export function extractSnippets(dir = path.join(root, 'test')): string[] {
  const found = new Set<string>();
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.test.ts')).sort()) {
    const source = ts.createSourceFile(file, fs.readFileSync(path.join(dir, file), 'utf8'), ts.ScriptTarget.ES2022, true);
    const visit = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && n.arguments.length) {
        const callee = n.expression;
        const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : '';
        const object = ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) ? callee.expression.text : '';
        const first = n.arguments[0];
        if (HELPERS.has(name) && (name !== 'parse' || PARSER_OBJECTS.has(object)) && isText(first)) found.add(first.text);
      }
      if (TABLE_FILES.has(file) && ts.isArrayLiteralExpression(n)) {
        for (const e of n.elements) {
          if (isText(e)) { if (ts.isForOfStatement(n.parent) && n.parent.expression === n) found.add(e.text); }
          else if (ts.isArrayLiteralExpression(e) && e.elements.length && isText(e.elements[0])) found.add(e.elements[0].text);
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(source);
  }
  return [...found].filter((s) => s.trim()).sort();
}

if (require.main === module) {
  const json = JSON.stringify(extractSnippets(), null, 1) + '\n';
  if (process.argv.includes('--check')) {
    if (fs.readFileSync(OUT, 'utf8') !== json) { console.error('test/fixtures/snippets.json is out of date: run npx tsx scripts/extract-snippets.ts'); process.exit(1); }
  } else {
    fs.writeFileSync(OUT, json);
    console.log(`${JSON.parse(json).length} snippets`);
  }
}
