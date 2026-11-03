import * as path from 'path';
import * as ts from 'typescript';
import { base, counted as countedAny, enclosing, lineOf, sourceFiles, typedProgram, type Match as MatchOf } from './scan';

// The scan behind test/row-source.test.ts (docs/design/sources.md, row 15, SB3c): what a token's row holds comes from one record
// (`tokenRow`, src/ui/tokenRow.ts). So outside that file no output reads those fields of a `Token`: found by the type of what is read,
// in src/ui/, cli/ and web/. A view may still walk the tokens: their places and their parts (`span`, `children`) are the tree, not a row's
// content; `kind` waits for the one colour table (SC10).
// `npx tsx test/support/row-source.ts` prints the matches as the known list's entries.

export type Kind = 'row-field';
export type Match = MatchOf<Kind>;

/** The fields of a token whose reading makes up a row. */
export const ROW_FIELDS: ReadonlySet<string> = new Set(['explanation', 'label', 'labelParts', 'name', 'value', 'refs', 'basis', 'tryIt', 'group', 'summary', 'role', 'said']);
/** Where a row is made. */
export const ALLOWED = 'src/ui/tokenRow.ts';
const DIRS = ['src/ui', 'cli', 'web'];

/** Files in memory, as test/note-strings.test.ts has them: the guard's own snippets. */
export const virtualFiles = new Map<string, string>();

let cached: { program: ts.Program; key: string } | undefined;
function program(): ts.Program {
  const key = [...virtualFiles.keys()].join('\0');
  if (!cached || cached.key !== key) cached = { program: typedProgram(DIRS.flatMap((d) => sourceFiles(d)), virtualFiles), key };
  return cached.program;
}

/** Whether a type is the `Token` of src/analyzer-types.ts, or that or undefined. */
function isToken(checker: ts.TypeChecker, type: ts.Type): boolean {
  const t = checker.getNonNullableType(type);
  const decl = t.getSymbol()?.declarations?.[0];
  return t.getSymbol()?.name === 'Token' && !!decl?.getSourceFile().fileName.endsWith('analyzer-types.ts');
}

/** The fields of a row read from a token in one file. */
export function scanFile(sf: ts.SourceFile, rel: string, checker: ts.TypeChecker): Match[] {
  const out: Match[] = [];
  const found = (n: ts.Node, what: string) => out.push({ file: rel, fn: enclosing(n), kind: 'row-field', what, line: lineOf(n) });
  const visit = (n: ts.Node): void => {
    if (ts.isPropertyAccessExpression(n) && ROW_FIELDS.has(n.name.text) && isToken(checker, checker.getTypeAtLocation(n.expression))) found(n, n.name.text);
    if (ts.isElementAccessExpression(n) && ts.isStringLiteralLike(n.argumentExpression) && ROW_FIELDS.has(n.argumentExpression.text) && isToken(checker, checker.getTypeAtLocation(n.expression))) found(n, n.argumentExpression.text);
    if (ts.isBindingElement(n) && ts.isObjectBindingPattern(n.parent) && isToken(checker, checker.getTypeAtLocation(n.parent))) {
      const name = (n.propertyName ?? n.name).getText();
      if (ROW_FIELDS.has(name)) found(n, name);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** The matches of the guard, in the real files or (`names`) in those of the guard's own snippets. */
export function scanAll(names?: readonly string[]): Match[] {
  const p = program();
  const checker = p.getTypeChecker();
  const out: Match[] = [];
  for (const f of names ?? DIRS.flatMap((d) => sourceFiles(d))) {
    const rel = path.relative(base, f).split(path.sep).join('/');
    const sf = p.getSourceFile(f);
    if (sf && rel !== ALLOWED && !f.endsWith('.d.ts')) out.push(...scanFile(sf, rel, checker));
  }
  return out;
}

export const counted = (matches: readonly Match[]) => countedAny(matches);

if (require.main === module) {
  console.log(JSON.stringify(counted(scanAll()), null, 2));
  for (const m of scanAll()) console.log(`${m.file}:${m.line} ${m.fn} ${m.what}`);
}
