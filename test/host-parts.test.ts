import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { base, enclosing, parseSource, sourceFiles, typedProgram } from './support/scan';

// The guards of docs/design/sources.md, rows 32 to 34 (docs/design/python-regex.md, 2.10):
//   parts     The parts of a host file that are not shell code are `Extracted.languages`, read through `hostPartAt` (and the
//             counts beside it, src/hosts/scripts.ts): no other function of src/, cli/ or web/ reads that list, so every
//             reader of `Extracted.regions` keeps reading shell code only.
//   embedded  Where an embedded token is in the document comes from `placeEmbedded` (src/explain/nodes.ts): `fromEmbedded` calls
//             it, and no other function writes a token of the origin `embedded` with a span, but the token of a host's literals
//             (a pattern, a template: `literalToken`), which holds the tokens `placeEmbedded` placed (src/hosts/languages.ts).
//   finished  What a finished line is comes from `finishLine` (src/linefinish.ts): both `Analyzer.explained` and a language
//             line's `explained` call it, and nothing else gives a line's tokens their roles and facts (`markTokens`) or takes
//             the catalog's ids off them (`markSaid`), but the host that adds facts of its own (src/hosts/remap.ts, bats).

const DIRS = ['src', 'cli', 'web'];
const rel = (f: string) => path.relative(base, f).split(path.sep).join('/');

describe('the parts of a host file, the places of embedded tokens and the finished line (sources.md, rows 32 to 34)', function () {
  this.timeout(60000);

  it('reads `Extracted.languages` only in `hostPartAt` and the counts beside it', () => {
    const program = typedProgram(DIRS.flatMap((d) => sourceFiles(d)), new Map());
    const checker = program.getTypeChecker();
    const isExtracted = (e: ts.Expression) => checker.getNonNullableType(checker.getTypeAtLocation(e)).getSymbol()?.getName() === 'Extracted';
    const readers = new Set<string>();
    for (const sf of program.getSourceFiles()) {
      const file = rel(sf.fileName);
      if (!DIRS.some((d) => file.startsWith(`${d}/`))) continue;
      const visit = (n: ts.Node): void => {
        if (ts.isPropertyAccessExpression(n) && n.name.text === 'languages' && isExtracted(n.expression)) readers.add(`${file} ${enclosing(n)}`);
        if (ts.isVariableDeclaration(n) && ts.isObjectBindingPattern(n.name) && n.initializer && isExtracted(n.initializer)
          && n.name.elements.some((e) => (e.propertyName ?? e.name).getText() === 'languages')) readers.add(`${file} ${enclosing(n)}`);
        n.forEachChild(visit);
      };
      visit(sf);
    }
    assert.deepStrictEqual([...readers].sort(), ['src/hosts/scripts.ts hasParts', 'src/hosts/scripts.ts hostPartAt', 'src/hosts/scripts.ts languageLines']);
  });

  /** The calls of `name` in `file`, by the function each is in. */
  const callsIn = (file: string, name: string): string[] => {
    const out: string[] = [];
    const visit = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === name) out.push(enclosing(n));
      n.forEachChild(visit);
    };
    visit(parseSource(file, fs.readFileSync(path.join(base, file), 'utf8')));
    return out;
  };

  it('places every embedded token with `placeEmbedded`', () => {
    assert.ok(callsIn('src/explain/nodes.ts', 'placeEmbedded').includes('fromEmbedded'));
    const writers: string[] = [];
    for (const f of DIRS.flatMap((d) => sourceFiles(d))) {
      const file = rel(f);
      const visit = (n: ts.Node): void => {
        if (ts.isObjectLiteralExpression(n)) {
          const prop = (k: string) => n.properties.find((p) => p.name?.getText() === k);
          const origin = prop('origin');
          const embedded = origin && ((ts.isPropertyAssignment(origin) && ts.isStringLiteral(origin.initializer) && origin.initializer.text === 'embedded') || ts.isShorthandPropertyAssignment(origin));
          if (embedded && prop('span')) writers.push(`${file} ${enclosing(n)}`);
        }
        n.forEachChild(visit);
      };
      visit(parseSource(file, fs.readFileSync(f, 'utf8')));
    }
    assert.deepStrictEqual(writers.sort(), ['src/explain/nodes.ts placeEmbedded', 'src/hosts/languages.ts literalToken']);
  });

  it('finishes a shell line and a language line with `finishLine`, and no line otherwise', () => {
    assert.deepStrictEqual(callsIn('src/analyzer.ts', 'finishLine'), ['explained']);
    assert.deepStrictEqual(callsIn('src/hosts/languages.ts', 'finishLine'), ['explained']);
    const others = (name: string) => DIRS.flatMap((d) => sourceFiles(d)).map(rel).filter((f) => f !== 'src/linefinish.ts' && callsIn(f, name).length);
    assert.deepStrictEqual(others('markSaid'), []);
    assert.deepStrictEqual(others('markTokens'), ['src/hosts/remap.ts']);
  });
});
