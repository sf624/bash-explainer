import * as path from 'path';
import * as ts from 'typescript';
import { base, counted as countedAny, enclosing, isAllowed, lineOf, parseSource, scanDirs, sourceFiles, type Match as MatchOf } from './scan';

// The scan behind test/note-strings.test.ts (docs/design/sources.md, row 14, stage SA, step SA5): where a note gets its text without the
// message catalog (`fact()` in src/messages.ts, which gives it an id, its sections and its level). Three kinds:
//   note-string  `cx.note(text, at)` where the overload taken is the one for a string (type-aware: it is the type of the argument that
//                tells a fact from a text, not how the call is written, so this part builds one TypeScript program over src/explain/
//                and src/examples/ and what they import);
//   plain-note   a call of `plainNote(…)` or `marked(…)`, imported from src/messages.ts, anywhere in src/: a note made from inline text
//                (syntactic);
//   notes-push   `notes.push(text)` on a list of strings that a function of src/explain/ or src/examples/ declares as `notes` and returns
//                as `string[]`: the text of the line's notes, without a fact (syntactic).
// `npx tsx test/support/note-strings.ts` prints the matches as the known list's entries (counts per file, function and kind), `--lines` the places.

export type Kind = 'note-string' | 'plain-note' | 'notes-push';
export type Match = MatchOf<Kind>;

/** The directories whose notes are said through the line's context. */
export const NOTE_DIRS: readonly string[] = ['src/explain/', 'src/examples/'];
/** Files where plain notes are made on purpose: the catalog itself. */
export const ALLOWED: readonly string[] = ['src/messages.ts'];

const inNoteDir = (rel: string): boolean => NOTE_DIRS.some((d) => rel.startsWith(d));

/** The names that a file imports from a module called `messages` (`import { plainNote as p } from '../messages'`), by the local name. */
function messagesImports(sf: ts.SourceFile): Map<string, string> {
  const out = new Map<string, string>();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier) || !/(^|\/)messages$/.test(st.moduleSpecifier.text)) continue;
    const named = st.importClause?.namedBindings;
    if (named && ts.isNamedImports(named)) for (const e of named.elements) out.set(e.name.text, (e.propertyName ?? e.name).text);
  }
  return out;
}

/** Whether a type annotation says `string[]`, `Array<string>` or `readonly string[]`. */
function isStringListType(t: ts.TypeNode | undefined): boolean {
  if (t && ts.isTypeOperatorNode(t)) t = t.type;
  if (!t) return false;
  if (ts.isArrayTypeNode(t)) return t.elementType.kind === ts.SyntaxKind.StringKeyword;
  return ts.isTypeReferenceNode(t) && t.typeName.getText() === 'Array' && t.typeArguments?.length === 1 && t.typeArguments[0].kind === ts.SyntaxKind.StringKeyword;
}
/** The nearest function around a node. */
function functionAround(n: ts.Node): ts.SignatureDeclaration | undefined {
  for (let p: ts.Node | undefined = n.parent; p; p = p.parent) if (ts.isFunctionDeclaration(p) || ts.isMethodDeclaration(p) || ts.isArrowFunction(p) || ts.isFunctionExpression(p)) return p;
  return undefined;
}

/** The syntactic matches of one source file of src/, `rel` being its path from the repo root. */
export function scanSyntax(rel: string, text: string): Match[] {
  // (Most files name neither: they are not parsed.)
  if (!/\bplainNote\b|\bmarked\b|(?:const|let)\s+\w*notes\b/i.test(text)) return [];
  const sf = parseSource(rel, text);
  const found: Match[] = [];
  const add = (n: ts.Node, kind: Kind, what: string): void => {
    found.push({ file: rel, fn: enclosing(n), kind, what, line: lineOf(n) });
  };
  const imported = messagesImports(sf);
  // The lists of strings called `notes` (or ending in it) that a function declares and returns: the text of the line's notes.
  const lists = new Map<string, ts.SignatureDeclaration>();
  const declared = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && /notes$/i.test(n.name.text) && isStringListType(n.type)) {
      const fn = functionAround(n);
      if (fn && isStringListType(fn.type)) lists.set(n.name.text, fn);
    }
    ts.forEachChild(n, declared);
  };
  if (inNoteDir(rel)) declared(sf);
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) {
      const callee = n.expression;
      // `plainNote(text)` and `marked(lang, level, text)`: a note made from inline text.
      if (ts.isIdentifier(callee) && ['plainNote', 'marked'].includes(imported.get(callee.text) ?? '')) add(n, 'plain-note', imported.get(callee.text)!);
      // `notes.push(text)` on a declared list of strings.
      if (ts.isPropertyAccessExpression(callee) && callee.name.text === 'push' && ts.isIdentifier(callee.expression) && lists.get(callee.expression.text) === functionAround(n)) add(n, 'notes-push', `${callee.expression.text}.push`);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}

/** Source of files that do not exist on disk (the snippets of the guard's own tests), by absolute path. */
export const virtualFiles = new Map<string, string>();

/** The directories that are the program's roots (what they import comes with them). */
const ROOTS: readonly string[] = ['src/explain', 'src/examples'];

let cached: { program: ts.Program; key: string } | undefined;
/** One program over the roots and the virtual files, built once with the repo's tsconfig. */
export function program(): ts.Program {
  const key = [...virtualFiles.keys()].join('\0');
  if (cached && cached.key === key) return cached.program;
  const config = ts.readConfigFile(path.join(base, 'tsconfig.json'), ts.sys.readFile);
  // (No ambient @types: the sources need none, and loading them costs half a second.)
  const options = { ...ts.parseJsonConfigFileContent(config.config, ts.sys, base).options, types: [] };
  const host = ts.createCompilerHost(options, true);
  const { getSourceFile, fileExists, readFile } = host;
  host.fileExists = (f) => virtualFiles.has(path.resolve(f)) || fileExists.call(host, f);
  host.readFile = (f) => virtualFiles.get(path.resolve(f)) ?? readFile.call(host, f);
  host.getSourceFile = (f, ...rest) => {
    const text = virtualFiles.get(path.resolve(f));
    return text === undefined ? getSourceFile.call(host, f, ...rest) : ts.createSourceFile(f, text, options.target ?? ts.ScriptTarget.ES2022, true);
  };
  const program = ts.createProgram({ rootNames: [...ROOTS.flatMap((d) => sourceFiles(path.join(base, d))), ...virtualFiles.keys()], options, host });
  cached = { program, key };
  return program;
}

/** The `cx.note(text, at)` calls of one file of the program that take a string: no fact, no id. */
export function scanTyped(checker: ts.TypeChecker, sf: ts.SourceFile, rel: string): Match[] {
  const found: Match[] = [];
  const visit = (n: ts.Node): void => {
    const callee = ts.isCallExpression(n) ? n.expression : undefined;
    if (ts.isCallExpression(n) && callee && ts.isPropertyAccessExpression(callee) && ['note', 'say'].includes(callee.name.text) && n.arguments.length > 0) {
      // (A call of `fact(…)` or `factOf(…)` is a fact: the type is not asked.)
      const first = n.arguments[0];
      if (ts.isCallExpression(first) && ts.isIdentifier(first.expression) && ['fact', 'factOf'].includes(first.expression.text)) { ts.forEachChild(n, visit); return; }
      // The type of the first argument: a `Fact` for a fact, a string for a text (what the overload for a string takes).
      const type = checker.getTypeAtLocation(n.arguments[0]);
      const parts = type.isUnion() ? type.types : [type];
      if (parts.some((t) => t.flags & ts.TypeFlags.StringLike) && !parts.some((t) => t.flags & ts.TypeFlags.Object)) found.push({ file: rel, fn: enclosing(n), kind: 'note-string', what: `${callee.name.text}(${n.arguments[0].getText().slice(0, 40)})`, line: lineOf(n) });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}

/** The matches of every file of src/ outside the allow-list. */
export function scanAll(): Match[] {
  const out = scanDirs(['src'], ALLOWED, scanSyntax);
  const p = program();
  const checker = p.getTypeChecker();
  for (const f of ROOTS.flatMap((d) => sourceFiles(path.join(base, d))).sort()) {
    const rel = path.relative(base, f).split(path.sep).join('/');
    const sf = p.getSourceFile(f);
    if (sf && !isAllowed(ALLOWED, rel)) out.push(...scanTyped(checker, sf, rel));
  }
  return out;
}

/** The matches counted per file, function and kind (the known list's grain). */
export const counted = (matches: readonly Match[]): { file: string; fn: string; kind: Kind; count: number }[] => countedAny(matches);

if (require.main === module) {
  if (process.argv.includes('--lines')) for (const m of scanAll()) console.log(`${m.file}:${m.line} ${m.fn} ${m.kind} ${m.what}`);
  else console.log(JSON.stringify(counted(scanAll()), null, 1));
}
