import * as path from 'path';
import * as ts from 'typescript';
import { base, counted as countedAny, enclosing, isAllowed, lineOf, sourceFiles, typedProgram, type Match as MatchOf } from './scan';

// The scan behind test/value-source.test.ts (docs/design/sources.md, section 3; docs/design/known-values.md, section 8): where src/ reads a
// variable's `value` or `source` from the shell state (`VariableState`, src/semantics/shellstate.ts) outside src/semantics/. The value an
// expansion gives comes from `expansionValue`, and the assignment it copies from `valueOrigin` (src/semantics/values.ts), which apply the
// model's rules (the trust, a state the same on every path, not dead, nothing failing around it); the state's fields alone do not. The scan
// asks the type checker which interface a property read belongs to: a `.value` or `.source` of a `VariableState` (also `?.`, `v['value']`
// and a destructuring `const { value } = v`), not one of another type of the same name.
// `npx tsx test/support/value-source.ts` prints the matches as the known list's entries (counts per file, function and kind), `--lines` the places.

export type Kind = 'value' | 'source';
export type Match = MatchOf<Kind>;

/** Where the state is read legitimately: the model itself. */
export const ALLOWED: readonly string[] = ['src/semantics/'];

/** The fields of `VariableState` the guard is about. */
const FIELDS: ReadonlySet<string> = new Set<Kind>(['value', 'source']);

/** Source of files that do not exist on disk (the snippets of the guard's own tests), by absolute path. */
export const virtualFiles = new Map<string, string>();

let cached: { program: ts.Program; key: string } | undefined;
/** One program over src/ and the virtual files, built once with the repo's tsconfig. */
export function program(): ts.Program {
  const key = [...virtualFiles.keys()].join('\0');
  if (cached && cached.key === key) return cached.program;
  const p = typedProgram(sourceFiles(path.join(base, 'src')), virtualFiles);
  cached = { program: p, key };
  return p;
}

/** Whether a declaration is a field of the interface `VariableState` of src/semantics/shellstate.ts. */
function ofVariableState(d: ts.Declaration): boolean {
  const owner = d.parent;
  return ts.isPropertySignature(d) && ts.isInterfaceDeclaration(owner) && owner.name.text === 'VariableState'
    && path.relative(base, owner.getSourceFile().fileName).split(path.sep).join('/') === 'src/semantics/shellstate.ts';
}

/** Whether the property `name` of the type `t` (or of a member of its union) is the field of `VariableState`. */
function stateField(checker: ts.TypeChecker, t: ts.Type, name: string): boolean {
  const parts = t.isUnion() ? t.types : [t];
  return parts.some((p) => !!checker.getPropertyOfType(p, name)?.declarations?.some(ofVariableState));
}

/** The reads of a `VariableState`'s `value` or `source` in one file of the program. */
export function scanTyped(checker: ts.TypeChecker, sf: ts.SourceFile, rel: string): Match[] {
  const found: Match[] = [];
  const add = (n: ts.Node, kind: Kind): void => {
    found.push({ file: rel, fn: enclosing(n), kind, what: n.getText().slice(0, 60), line: lineOf(n) });
  };
  const visit = (n: ts.Node): void => {
    // `v.value`, `v?.source`, `st.variables.get(x)?.value`.
    if (ts.isPropertyAccessExpression(n) && FIELDS.has(n.name.text) && checker.getSymbolAtLocation(n.name)?.declarations?.some(ofVariableState)) add(n, n.name.text as Kind);
    // `v['value']`, `st.variables.get(x)?.['source']`.
    if (ts.isElementAccessExpression(n) && ts.isStringLiteralLike(n.argumentExpression) && FIELDS.has(n.argumentExpression.text)
      && stateField(checker, checker.getTypeAtLocation(n.expression), n.argumentExpression.text)) add(n, n.argumentExpression.text as Kind);
    // `const { value, source: s } = v`.
    if (ts.isBindingElement(n) && ts.isObjectBindingPattern(n.parent)) {
      const prop = n.propertyName ?? n.name;
      const name = ts.isIdentifier(prop) ? prop.text : undefined;
      if (name && FIELDS.has(name) && stateField(checker, checker.getTypeAtLocation(n.parent), name)) add(n, name as Kind);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}

/** The matches of every file of src/ outside the allow-list, and of the virtual files. */
export function scanAll(): Match[] {
  const p = program();
  const checker = p.getTypeChecker();
  const out: Match[] = [];
  for (const f of sourceFiles(path.join(base, 'src'))) {
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
