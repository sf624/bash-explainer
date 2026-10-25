import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { builtins } from '../src/dict/builtins';
import { commands, core } from '../src/dict/commands';

// Guards for src/explain/ (docs/design/analyzer.md, 3.2 and 3.3): no import cycles, no import of
// src/analyzer.ts, and no comparison with the name of a dictionary command. The directory exists since step 2
// (src/explain/context.ts and nodes.ts); before, the checks passed with nothing to read.
const base = path.join(__dirname, '..');
const dir = path.join(base, 'src', 'explain');

/** Known comparisons with a command name, each with a reason; it may only shrink (empty after step 1). */
const KNOWN_NAMES: { file: string; text: string; reason: string }[] = [];

/** The relative modules a source imports, re-exports, requires or imports dynamically. */
function relativeImports(code: string): string[] {
  const out: string[] = [];
  const re = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)['"`](\.[^'"`]*)['"`]/g;
  for (let m = re.exec(code); m; m = re.exec(code)) out.push(m[1]);
  return out;
}

/** The cycles of a graph (node to nodes), each as a path that ends where it started; empty for a DAG. */
function findCycles(graph: Map<string, string[]>): string[][] {
  const cycles: string[][] = [];
  const state = new Map<string, 1 | 2>();
  const stack: string[] = [];
  const visit = (n: string): void => {
    state.set(n, 1);
    stack.push(n);
    for (const m of graph.get(n) ?? []) {
      if (state.get(m) === 1) cycles.push([...stack.slice(stack.indexOf(m)), m]);
      else if (!state.has(m)) visit(m);
    }
    stack.pop();
    state.set(n, 2);
  };
  for (const n of graph.keys()) if (!state.has(n)) visit(n);
  return cycles;
}

const files = (): string[] => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /\.ts$/.test(f)).map((f) => path.join(dir, f)) : []);

/** Source of files that do not exist on disk (the snippets of the finder's own tests), by absolute path. */
const virtualFiles = new Map<string, string>();

let cachedProgram: ts.Program | undefined;
/** One program over src/explain/*.ts, what they import and the virtual files, built once with the repo's tsconfig. */
function program(): ts.Program {
  if (cachedProgram) return cachedProgram;
  const config = ts.readConfigFile(path.join(base, 'tsconfig.json'), ts.sys.readFile);
  const options = ts.parseJsonConfigFileContent(config.config, ts.sys, base).options;
  const host = ts.createCompilerHost(options, true);
  const { getSourceFile, fileExists, readFile } = host;
  host.fileExists = (f) => virtualFiles.has(path.resolve(f)) || fileExists.call(host, f);
  host.readFile = (f) => virtualFiles.get(path.resolve(f)) ?? readFile.call(host, f);
  host.getSourceFile = (f, ...rest) => {
    const text = virtualFiles.get(path.resolve(f));
    return text === undefined ? getSourceFile.call(host, f, ...rest) : ts.createSourceFile(f, text, options.target ?? ts.ScriptTarget.ES2022, true);
  };
  cachedProgram = ts.createProgram({ rootNames: [...files(), ...virtualFiles.keys()], options, host });
  return cachedProgram;
}

/**
 * The members of a type, looking through unions (`a | b` gives a and b); `null` and `undefined` are left out. (`boolean`
 * is a union of `true` and `false`, so a boolean is looked at as two members, which is harmless here.)
 */
function members(checker: ts.TypeChecker, t: ts.Type): ts.Type[] {
  const nonNull = checker.getNonNullableType(t);
  return nonNull.isUnion() ? nonNull.types : [nonNull];
}

/** Whether `t` is a closed set of values that has the string literal `text` among its members and no open member. */
function closedWith(checker: ts.TypeChecker, t: ts.Type, text: string): boolean {
  const ms = members(checker, t);
  const open = ms.some((m) => m.flags & (ts.TypeFlags.String | ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.TypeParameter | ts.TypeFlags.Never));
  return !open && ms.some((m) => m.isStringLiteral() && m.value === text);
}

/** Whether `e` reads `SyntaxNode.type`, the node type of the syntax tree: an open `string` whose values are spelled like commands. */
function isNodeType(checker: ts.TypeChecker, e: ts.Expression): boolean {
  if (!ts.isPropertyAccessExpression(e) || e.name.text !== 'type') return false;
  const decls = checker.getSymbolAtLocation(e.name)?.declarations ?? [];
  return decls.some((d) => (ts.isInterfaceDeclaration(d.parent) || ts.isClassDeclaration(d.parent)) && d.parent.name?.text === 'SyntaxNode');
}

/** The text of a string literal (or a template without substitutions), or undefined for any other expression. */
function literalText(e: ts.Expression): string | undefined {
  return ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e) ? e.text : undefined;
}

const COMPARISONS = new Set([ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken]);

/**
 * The type-aware names rule (docs/design/analyzer.md, 3.3). A string literal that is the name of a dictionary command, in a
 * comparison (`x === 'sed'`, `'sed' !== x`), a case label (`case 'sed':`) or a membership test (`set.has('sed')`,
 * `list.includes('sed')`), is accepted only when the checker gives the other side a closed union of string literals that
 * contains it (for a membership test, the parameter type of the method it calls, which is the element type of the
 * container): a value of a model (`'alias'` of a name's resolution, `'sed'` of `EmbeddedLang`), not a command name read from
 * a script. `string`, `any` and a union with `string` in it are open, and the comparison is found. The one exception is
 * `SyntaxNode.type`, an open `string` whose values (`command`, `test`) are node types. Returns the text of what is found.
 */
function nameComparisons(checker: ts.TypeChecker, sf: ts.SourceFile, names: ReadonlySet<string>): string[] {
  const found: string[] = [];
  const open = (other: ts.Expression, text: string): boolean => names.has(text) && !isNodeType(checker, other) && !closedWith(checker, checker.getTypeAtLocation(other), text);
  const visit = (n: ts.Node): void => {
    if (ts.isBinaryExpression(n) && COMPARISONS.has(n.operatorToken.kind)) {
      const l = literalText(n.left);
      const r = literalText(n.right);
      if ((l !== undefined && open(n.right, l)) || (r !== undefined && open(n.left, r))) found.push(n.getText(sf));
    } else if (ts.isCaseClause(n)) {
      const text = literalText(n.expression);
      if (text !== undefined && open((n.parent.parent as ts.SwitchStatement).expression, text)) found.push(`case ${n.expression.getText(sf)}`);
    } else if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && ['has', 'includes'].includes(n.expression.name.text) && n.arguments.length > 0) {
      const text = literalText(n.arguments[0]);
      const param = checker.getResolvedSignature(n)?.getParameters()[0];
      if (text !== undefined && names.has(text) && !(param && closedWith(checker, checker.getTypeOfSymbolAtLocation(param, n), text))) found.push(n.getText(sf));
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}

// The snippets of the finder's own tests are files of src/explain/ that exist in memory only, so that they sit in the same
// program as the real files (one `createProgram` for everything) and resolve imports from the real tree.
const snippets = new Map<string, string>();
function snippet(name: string, code: string): string {
  const file = path.join(dir, `snippet-${name}.ts`);
  virtualFiles.set(file, `import type { SyntaxNode } from '../syntax/tree';\n${code}\n`);
  snippets.set(name, file);
  return name;
}

const SNIPPET_NAMES = new Set(['sed', 'awk', 'jq', 'date', 'grep', 'declare', 'builtin', 'alias', 'command', 'unset']);
const found = (name: string): string[] => {
  const sf = program().getSourceFile(snippets.get(name)!)!;
  return nameComparisons(program().getTypeChecker(), sf, SNIPPET_NAMES);
};

const fixtures: { name: string; code: string; found: string[] }[] = [
  // Open strings are found, whatever the field is called.
  { name: 'open-why', code: `declare const r: { why: string };\nexport const a = r.why === 'builtin';`, found: [`r.why === 'builtin'`] },
  { name: 'open-var', code: `export function f(a: string, b: string, c: string) { return a === 'sed' || 'declare' !== b || c != 'grep'; }`, found: [`a === 'sed'`, `'declare' !== b`, `c != 'grep'`] },
  { name: 'open-any', code: `export function f(x: any, y: unknown) { return x === 'sed' || y === 'awk'; }`, found: [`x === 'sed'`, `y === 'awk'`] },
  { name: 'open-union', code: `export function f(x: 'alias' | string | undefined, y: string | null) { return x === 'alias' || y === 'sed'; }`, found: [`x === 'alias'`, `y === 'sed'`] },
  { name: 'open-case', code: `export function f(x: string) { switch (x) { case 'grep': return 1; case 'other': return 2; } return 0; }`, found: [`case 'grep'`] },
  { name: 'open-members', code: "export function f(x: string) { return ['a'].includes('declare') || new Set<string>().has('sed') || x.includes('awk'); }", found: [`['a'].includes('declare')`, `new Set<string>().has('sed')`, `x.includes('awk')`] },
  { name: 'open-type-field', code: `export function f(x: { type: string }) { return x.type === 'command'; }`, found: [`x.type === 'command'`] },
  { name: 'outside-union', code: `export function f(x: 'alias' | 'file') { return x === 'sed'; }`, found: [`x === 'sed'`] },
  { name: 'template', code: 'export function f(x: string) { return x === `sed`; }', found: ['x === `sed`'] },
  // Closed unions that contain the literal pass, with the field called anything or nothing at all.
  { name: 'closed-field', code: `type R = { kind: 'alias' | 'file' | 'builtin' };\nexport function f(r: R, q: R, p: R, s?: R) { return r.kind === 'alias' || q.kind !== 'builtin' || 'file' === p.kind || s?.kind === 'alias'; }`, found: [] },
  { name: 'closed-models', code: `type Slot = { run: 'exec' | 'shell-string' };\ntype Role = { role: 'command' | 'script' };\ntype Missed = { why: 'command' | 'builtin' };\nexport function f(a: Slot, b: Role, c: Missed) { return a.run === 'exec' || b.role === 'command' || c.why === 'builtin'; }`, found: [] },
  { name: 'closed-case', code: `type EmbeddedLang = 'sed' | 'awk' | 'jq' | 'date' | 'regex';\nexport function f(lang: EmbeddedLang) { switch (lang) { case 'sed': case 'awk': return 1; case 'jq': case 'date': return 2; case 'regex': return 3; } return 0; }`, found: [] },
  { name: 'closed-bare', code: `type Lang = 'sed' | 'awk';\nexport function f(lang: Lang, maybe: Lang | undefined) { return lang === 'sed' || maybe !== 'awk'; }`, found: [] },
  { name: 'closed-mixed', code: `export function f(g: { value: string } | 'unset' | 'unknown') { return g !== 'unset'; }`, found: [] },
  { name: 'closed-members', code: `const LIST = ['sed', 'awk'] as const;\nexport function f(s: Set<'sed' | 'awk'>, m: ReadonlySet<'grep'>) { return LIST.includes('sed') || s.has('awk') || m.has('grep'); }`, found: [] },
  // The node type of the syntax tree is the one open string that is allowed.
  { name: 'node-type', code: `export function f(node: SyntaxNode, p: SyntaxNode | null) { return node.type === 'command' || 'command' === node.type || p?.type !== 'declare'; }`, found: [] },
  // Not a command name, whatever the type.
  { name: 'not-a-name', code: `export function f(x: string) { return x === 'zzz' || x.includes('qq'); }`, found: [] },
];
for (const f of fixtures) snippet(f.name, f.code);

describe('src/explain guards', function () {
  // One program over src/explain/ and what it imports (a few seconds), shared by the tests that need the checker.
  this.timeout(120000);

  it('has no import cycle and does not import src/analyzer.ts', () => {
    const graph = new Map<string, string[]>();
    const analyzer = path.join(base, 'src', 'analyzer');
    const importsAnalyzer: string[] = [];
    for (const f of files()) {
      const targets = relativeImports(fs.readFileSync(f, 'utf8')).map((r) => path.resolve(path.dirname(f), r).replace(/\.(js|ts)$/, ''));
      if (targets.includes(analyzer)) importsAnalyzer.push(path.relative(base, f));
      // Only the modules of src/explain/ can close a cycle among themselves.
      graph.set(f.replace(/\.ts$/, ''), targets.filter((t) => path.dirname(t) === dir));
    }
    assert.deepStrictEqual(importsAnalyzer, []);
    assert.deepStrictEqual(findCycles(graph).map((c) => c.map((p) => path.basename(p)).join(' -> ')), []);
  });

  it('compares nothing with the name of a dictionary command, except the known ones', () => {
    const names = new Set([...Object.keys(commands), ...Object.keys(builtins), ...Object.keys(core)]);
    assert.ok(names.has('sed') && names.has('declare'));
    const p = program();
    const checker = p.getTypeChecker();
    const all = files().flatMap((f) => {
      const sf = p.getSourceFile(f);
      assert.ok(sf, f);
      return nameComparisons(checker, sf, names).map((text) => ({ file: path.relative(base, f), text }));
    });
    const unknown = all.filter((x) => !KNOWN_NAMES.some((k) => k.file === x.file && k.text === x.text));
    assert.deepStrictEqual(unknown, []);
    const stale = KNOWN_NAMES.filter((k) => !all.some((x) => x.file === k.file && x.text === k.text));
    assert.deepStrictEqual(stale, []);
  });
});

describe('the finders of the src/explain guards', function () {
  this.timeout(120000);

  it('reads relative imports of every form', () => {
    assert.deepStrictEqual(
      relativeImports(`import { a } from './a';\nexport * from "../b";\nimport './c';\nconst d = require('./d');\ntype T = import('./e').T;\nimport x from 'node:fs';`),
      ['./a', '../b', './c', './d', './e'],
    );
  });

  it('finds cycles and leaves a DAG alone', () => {
    const g = (o: Record<string, string[]>): Map<string, string[]> => new Map(Object.entries(o));
    assert.deepStrictEqual(findCycles(g({ a: ['b', 'c'], b: ['c'], c: [] })), []);
    assert.deepStrictEqual(findCycles(g({ a: ['b'], b: ['c'], c: ['a'] })), [['a', 'b', 'c', 'a']]);
    assert.deepStrictEqual(findCycles(g({ a: ['a'] })), [['a', 'a']]);
  });

  for (const f of fixtures) {
    it(`names: ${f.name}`, () => {
      assert.deepStrictEqual(found(f.name), f.found);
    });
  }

  it('type-checks the snippets that are meant to be valid', () => {
    // A snippet that does not compile would be read with error types, and could pass or fail for the wrong reason.
    const p = program();
    const bad = [...snippets]
      .filter(([name]) => !['outside-union'].includes(name))
      .flatMap(([, file]) => p.getSemanticDiagnostics(p.getSourceFile(file)!).map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' ')));
    assert.deepStrictEqual(bad, []);
  });
});
