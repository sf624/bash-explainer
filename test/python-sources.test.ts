import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { base, compareKnown, counted, enclosing, keyOf, lineOf, type Match, parseSource, regexSource, scanDirs } from './support/scan';

// The guards of docs/design/sources.md, rows 30 and 31: the Python host reads a file through one lexer, one value of a
// string literal and one import table.
//   literal  The value of a Python string literal comes from `pyValue` (src/hosts/pyvalue.ts), over the one escape table
//            that the lexer (src/hosts/pylex.ts) reads too. A file that reads Python (it imports the lexer, the value or the
//            import table) decodes no character itself (`fromCharCode`, `fromCodePoint`, `parseInt`) and has no regex of a
//            literal's quotes or prefixes.
//   import   What a name of a Python file stands for comes from its imports, read from the tokens (`pyImports`,
//            src/hosts/pyimports.ts), and a call is compared with a table of full names as a string. No regex in src/ reads
//            an `import` statement or a call of a module of the table (`subprocess.`, `os.system`).
// test/fixtures/python-sources-known.json lists today's other readings, a list that may only shrink.

type Kind = 'literal' | 'import';

/** The files that make the sources themselves. */
const SOURCES = ['src/hosts/pylex.ts', 'src/hosts/pyvalue.ts', 'src/hosts/pyimports.ts'];
/** A file reads Python when it imports one of the sources, from any directory (`'./pylex'`, `'../hosts/pyvalue'`). */
const readsPython = (text: string) => /from '(?:[^'\n]*\/)?py(?:lex|value|imports)'/.test(text);

/** A regex of Python's literal syntax: a class of quotes, a triple quote, or a class of prefix letters. */
const LITERAL_RE = /\["']|\['"]|'''|"""|\[[rRbBuUfFtT]{4,}/;
/** A regex of Python's imports or of a call of the modules whose calls the host reads. */
const IMPORT_RE = /\bimport\b|\bsubprocess\b|\bos\\?\.(?:system|popen)\b|\basyncio\\?\./;

export function scan(rel: string, text: string): Match<Kind>[] {
  if (SOURCES.includes(rel)) return [];
  const out: Match<Kind>[] = [];
  const python = readsPython(text);
  const push = (n: ts.Node, kind: Kind, what: string) => out.push({ file: rel, fn: enclosing(n), kind, what, line: lineOf(n) });
  const visit = (n: ts.Node): void => {
    const re = ts.isExpression(n) ? regexSource(n) : undefined;
    if (re !== undefined && IMPORT_RE.test(re)) push(n, 'import', re);
    if (python) {
      if (re !== undefined && LITERAL_RE.test(re)) push(n, 'literal', re);
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && ['fromCharCode', 'fromCodePoint'].includes(n.expression.name.text)) push(n, 'literal', n.expression.name.text);
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'parseInt') push(n, 'literal', 'parseInt');
    }
    // (A regex literal is not walked into: its source was read above.)
    if (!ts.isRegularExpressionLiteral(n)) n.forEachChild(visit);
  };
  visit(parseSource(rel, text));
  return out;
}

interface Known { uses: { file: string; fn: string; kind: Kind; count: number; reason: string }[] }
const known: Known = JSON.parse(fs.readFileSync(path.join(base, 'test', 'fixtures', 'python-sources-known.json'), 'utf8'));

describe('Python host source guards (docs/design/sources.md, rows 30 and 31)', () => {
  it('finds a regex of imports anywhere, and readings of literals in a file that reads Python', () => {
    const found = (code: string, rel = 'src/hosts/x.ts') => scan(rel, code).map((m) => `${m.kind} ${m.fn} ${m.what}`);
    const reader = "import { pyLex } from './pylex';\n";
    assert.deepStrictEqual(found('function f(l: string) { return /^import\\s+(\\w+)/.test(l) || /subprocess\\.run\\(/.test(l); }'), ['import f ^import\\s+(\\w+)', 'import f subprocess\\.run\\(']);
    assert.deepStrictEqual(found(`${reader}const q = (s: string) => /^[rRbBuUfF]{0,2}('''|")/.exec(s) && String.fromCharCode(parseInt(s, 16));`), [
      "literal q ^[rRbBuUfF]{0,2}('''|\")", 'literal q fromCharCode', 'literal q parseInt',
    ]);
    // (In a reader outside src/hosts too; not in a file that does not read Python, nor in the sources.)
    assert.deepStrictEqual(found("import { argValue } from '../hosts/pyvalue';\nconst d = (s: string) => parseInt(s, 8);", 'src/embedded/pyre.ts'), ['literal d parseInt']);
    assert.deepStrictEqual(found("const q = (s: string) => /['\"]/.test(s) && String.fromCharCode(1);"), []);
    assert.deepStrictEqual(found('const r = /import/;', 'src/hosts/pyimports.ts'), []);
  });

  it('lists every match outside the sources, no more and no fewer', () => {
    for (const f of SOURCES) assert.ok(fs.existsSync(path.join(base, f)), f);
    const actual = new Map(counted(scanDirs(['src'], [], scan)).map((c) => [keyOf(c.file, c.fn, c.kind), c.count]));
    const listed = new Map(known.uses.map((u) => [keyOf(u.file, u.fn, u.kind), u.count]));
    assert.deepStrictEqual(compareKnown(actual, listed, 'read the literal with `pyValue` and the names with `pyImports`, from the tokens of `pyLex`'), []);
    for (const u of known.uses) assert.ok(u.reason, keyOf(u.file, u.fn, u.kind));
  });
});
