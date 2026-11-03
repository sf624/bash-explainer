import * as path from 'path';
import * as ts from 'typescript';
import { base, counted as countedAny, enclosing, lineOf, sourceFiles, typedProgram, type Match as MatchOf } from './scan';

// The scan behind test/row-source.test.ts (docs/design/sources.md, row 15, SB3c): what a token's row holds comes from one record
// (`tokenRow`, src/ui/tokenRow.ts). So outside that file no output reads those fields of a `Token`: found by the declaration of the member
// that is read, in src/ui/, cli/ and web/, whatever the type is called. A view may still walk the tokens: their places and their parts (`span`, `children`) are the tree, not a row's
// content; `kind` waits for the one colour table (SC10).
// `npx tsx test/support/row-source.ts` prints the matches as the known list's entries.

export type Kind = 'row-field';
export type Match = MatchOf<Kind>;

/** The fields of a token whose reading makes up a row. */
export const ROW_FIELDS: ReadonlySet<string> = new Set(['explanation', 'label', 'labelParts', 'name', 'value', 'refs', 'basis', 'tryIt', 'group', 'summary', 'role', 'texts', 'marks', 'facts']);
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

/** Whether a member is one `Token` declares in src/analyzer-types.ts. */
const isTokenField = (d: ts.Declaration): boolean => ts.isInterfaceDeclaration(d.parent) && d.parent.name.text === 'Token' && d.getSourceFile().fileName.endsWith('analyzer-types.ts');

/** The member `field` of a type, if there is one: of its constraint for a type parameter, and without `undefined`. */
const memberOf = (checker: ts.TypeChecker, type: ts.Type, field: string): readonly ts.Declaration[] => checker.getPropertyOfType(checker.getApparentType(checker.getNonNullableType(type)), field)?.declarations ?? [];

/**
 * Whether reading `field` from a value of this type reads a token's: by the declaration of the member, not by the type's name, so that an
 * intersection, an interface that extends `Token`, a type parameter, `Readonly`, `Partial`, `Pick`, a spread and a rest of one all count.
 */
const readsToken = (checker: ts.TypeChecker, type: ts.Type, field: string): boolean => memberOf(checker, type, field).some(isTokenField);

const holdsToken = (checker: ts.TypeChecker, type: ts.Type): boolean => [...ROW_FIELDS].some((f) => readsToken(checker, type, f));

/** The functions that read a row's fields from a token for whoever calls them: only the record calls them. */
const ROW_READERS: ReadonlySet<string> = new Set(['markedText', 'labelParts']);

/** The fields of a row read from a token in one file. */
export function scanFile(sf: ts.SourceFile, rel: string, checker: ts.TypeChecker): Match[] {
  const out: Match[] = [];
  const found = (n: ts.Node, what: string) => out.push({ file: rel, fn: enclosing(n), kind: 'row-field', what, line: lineOf(n) });
  /** A token handed to something that takes the fields of a row under a type of its own (`{ explanation: string }`). */
  const handedOn = (value: ts.Expression): void => {
    if (!holdsToken(checker, checker.getTypeAtLocation(value))) return;
    const wanted = checker.getContextualType(value);
    for (const f of wanted ? ROW_FIELDS : []) {
      const decls = memberOf(checker, wanted!, f);
      if (decls.length && !decls.some(isTokenField)) found(value, f);
    }
  };
  const visit = (n: ts.Node): void => {
    if (ts.isPropertyAccessExpression(n) && ROW_FIELDS.has(n.name.text) && readsToken(checker, checker.getTypeAtLocation(n.expression), n.name.text)) found(n, n.name.text);
    if (ts.isElementAccessExpression(n)) {
      // (A string, or a constant of a literal type.)
      const key = checker.getTypeAtLocation(n.argumentExpression);
      if (key.isStringLiteral() && ROW_FIELDS.has(key.value) && readsToken(checker, checker.getTypeAtLocation(n.expression), key.value)) found(n, key.value);
    }
    if (ts.isBindingElement(n) && ts.isObjectBindingPattern(n.parent) && !n.dotDotDotToken) {
      const name = (n.propertyName ?? n.name).getText();
      if (ROW_FIELDS.has(name) && readsToken(checker, checker.getTypeAtLocation(n.parent), name)) found(n, name);
    }
    // (`as any` takes the type away; nothing is left to find after it.)
    if (ts.isAsExpression(n) && (n.type.kind === ts.SyntaxKind.AnyKeyword || n.type.kind === ts.SyntaxKind.UnknownKeyword) && holdsToken(checker, checker.getTypeAtLocation(n.expression))) found(n, 'as any');
    if (ts.isCallExpression(n)) {
      if (ts.isIdentifier(n.expression) && ROW_READERS.has(n.expression.text)) found(n, n.expression.text);
      n.arguments.forEach(handedOn);
    }
    if (ts.isVariableDeclaration(n) && n.initializer && n.type) handedOn(n.initializer);
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
