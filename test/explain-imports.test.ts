import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { builtins } from '../src/dict/builtins';
import { commands, core } from '../src/dict/commands';
import { BATS_ASSERT_COMMANDS, BATS_COMMANDS, BATS_FILE_COMMANDS, BATS_SUPPORT_COMMANDS } from '../src/dict/bats';
import { commandAliases } from '../src/dict/aliases';

// Guards for src/explain/ (docs/design/analyzer.md, 3.2 and 3.3): no import cycles, no import of
// src/analyzer.ts, and no comparison with the name of a dictionary command, nor a lookup of one by name. The directory exists since step 2
// (src/explain/context.ts and nodes.ts); before, the checks passed with nothing to read. The names guard also reads src/examples/, except
// the language interpreters (docs/design/sources.md, SA3).
const base = path.join(__dirname, '..');
const dir = path.join(base, 'src', 'explain');

/**
 * Known comparisons with a command name (and lookups of one) in src/explain/ and src/examples/, in test/fixtures/names-known.json: the text found,
 * how often, its kind and a reason. The list may only shrink: a new text fails, so does a larger count, and so does a stale entry. The kinds:
 *   not-a-name  a name that collides with another meaning (`:` of `${x:1:2}`, `[` of a glob, `local` of git's date style, a letter pair of a
 *               git placeholder, a word in a regular expression of words).
 *   registry    a `case 'sort':` or `cmd === 'seq'` that picks the simulator which runs a command by its name (src/examples/). The rule: such a
 *               dispatch counts, since a table keyed by command name is a copy of the dictionary (sources.md, M6: "the name switches can go,
 *               the runners stay"; a runner per spec replaces the registry in stage SC2). The guard therefore stops it from growing: a new
 *               simulator adds a `case`, which fails here until the entry is added with its reason, in a diff the reviewer reads.
 *               A registry is also a table of functions with command names for keys (`{ cat: runCat, sort: runSort }`) and a lookup in it by a
 *               stage's command (`FILTERS[stage.cmd]`): `nl: runCat` added to it fails here as a new text. Not caught: a `Map` of names to
 *               functions, a registry filled at run time (`REG[name] = fn`) and a lookup by a key of another name (`FILTERS[c]`).
 *   decision    what to show or whether to run, decided from a command's name (`xargs`, the inert `cat` and `tee`, `echo` as a source).
 * Left out of the scan of src/examples/: the language interpreters (jq, awk, sed, perlrun, yaml, regex), which simulate a language, where a
 * name such as `sed` or `date` is a word of that language and not a command's fact.
 */
interface KnownName { file: string; text: string; count: number; kind: 'not-a-name' | 'registry' | 'decision'; reason: string }
const KNOWN_NAMES: KnownName[] = JSON.parse(fs.readFileSync(path.join(base, 'test', 'fixtures', 'names-known.json'), 'utf8'));

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

/**
 * Modules outside src/explain/ that its modules import and that import its modules back (the dispatch calls them, and
 * they read words.ts, reads.ts and the context): a cycle can pass through them, so they are in the graph and the
 * names guard reads them as well (analyzer.md, 2.5).
 */
const OUTSIDE = ['expansion-tokens', 'substitution-tokens'].map((n) => path.join(base, 'src', `${n}.ts`));

const explainFiles = (): string[] => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /\.ts$/.test(f)).map((f) => path.join(dir, f)) : []);
const files = (): string[] => [...explainFiles(), ...OUTSIDE];

/** The language interpreters of src/examples/, which the names guard leaves out (see KNOWN_NAMES). */
const LANGUAGES = ['jq', 'awk', 'sed', 'perlrun', 'yaml', 'regex'].map((n) => `${n}.ts`);
const examplesDir = path.join(base, 'src', 'examples');
/** The `.ts` files under a directory, recursively, in path order. */
const tsFilesUnder = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1)).flatMap((e) => (e.isDirectory() ? tsFilesUnder(path.join(d, e.name)) : /\.ts$/.test(e.name) ? [path.join(d, e.name)] : []));
const examplesFiles = (): string[] => tsFilesUnder(examplesDir).filter((f) => !LANGUAGES.includes(path.relative(examplesDir, f)));

/** The import graph of some sources (file to code): an edge only to a target that `inGraph` accepts (a path without its extension). */
function importGraph(sources: ReadonlyMap<string, string>, inGraph: (target: string) => boolean): Map<string, string[]> {
  const graph = new Map<string, string[]>();
  for (const [f, code] of sources) {
    const targets = relativeImports(code).map((r) => path.resolve(path.dirname(f), r).replace(/\.(js|ts)$/, ''));
    graph.set(f.replace(/\.ts$/, ''), targets.filter(inGraph));
  }
  return graph;
}
/** Whether a target (a path without its extension) is a module of the directory `d` or one of the files `outside`. */
const graphMember = (d: string, outside: readonly string[]) => (t: string): boolean => path.dirname(t) === d || outside.some((o) => o.replace(/\.ts$/, '') === t);
const cycleNames = (graph: Map<string, string[]>): string[] => findCycles(graph).map((c) => c.map((p) => path.basename(p)).join(' -> '));

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
  cachedProgram = ts.createProgram({ rootNames: [...files(), ...examplesFiles(), ...virtualFiles.keys()], options, host });
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

/** `e` without the parentheses, `as` and `satisfies` around it, and `!`. */
function bare(e: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e) || ts.isNonNullExpression(e)) e = e.expression;
  return e;
}

/** The initializer of the `const` that `e` names (through an import too), or undefined. */
function constValue(checker: ts.TypeChecker, e: ts.Expression): ts.Expression | undefined {
  if (!ts.isIdentifier(e)) return undefined;
  let sym = checker.getSymbolAtLocation(e);
  if (sym && sym.flags & ts.SymbolFlags.Alias) sym = checker.getAliasedSymbol(sym);
  const d = sym?.declarations?.find(ts.isVariableDeclaration);
  return d && ts.getCombinedNodeFlags(d) & ts.NodeFlags.Const ? d.initializer : undefined;
}

/**
 * The string literals a container is written with: an array literal (`['local', 'declare']`), a `new Set([…])` of one,
 * or a `const` holding either. Undefined for any other expression (a container filled at run time).
 */
function containerLiterals(checker: ts.TypeChecker, e: ts.Expression, depth = 0): string[] | undefined {
  e = bare(e);
  if (ts.isArrayLiteralExpression(e)) return e.elements.map(literalText).filter((t): t is string => t !== undefined);
  if (ts.isNewExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === 'Set' && e.arguments?.length) return containerLiterals(checker, e.arguments[0], depth + 1);
  const value = depth < 5 ? constValue(checker, e) : undefined;
  return value && containerLiterals(checker, value, depth + 1);
}

/**
 * The words a regular expression is an alternation of (`/^(local|declare)$/`, `/^(?:sed|awk)$/`, `/^grep$/`, a
 * `new RegExp('…')` of a literal, or a `const` holding either): the pattern without its anchors and its outer group,
 * when every alternative is a plain word. Undefined for any other pattern (`/^-[a-z]*g/`).
 */
function regexWords(checker: ts.TypeChecker, e: ts.Expression, depth = 0): string[] | undefined {
  e = bare(e);
  let source: string | undefined;
  if (ts.isRegularExpressionLiteral(e)) source = e.text.slice(1, e.text.lastIndexOf('/'));
  else if (ts.isNewExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === 'RegExp' && e.arguments?.length) source = literalText(e.arguments[0]);
  else {
    const value = depth < 5 ? constValue(checker, e) : undefined;
    return value && regexWords(checker, value, depth + 1);
  }
  if (source === undefined) return undefined;
  const inner = /^(?:\((?:\?:)?([^()]*)\)|([^()]*))$/.exec(source.replace(/^\^/, '').replace(/\$$/, ''));
  const alternatives = (inner?.[1] ?? inner?.[2])?.split('|');
  return alternatives?.every((a) => /^(?:[\w-]|\\\.)+$/.test(a)) ? alternatives.map((a) => a.replace(/\\\./g, '.')) : undefined;
}

const COMPARISONS = new Set([ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken]);

/**
 * The type-aware names rule (docs/design/analyzer.md, 3.3). A string literal that is the name of a dictionary command, in a
 * comparison (`x === 'sed'`, `'sed' !== x`), a case label (`case 'sed':`) or a membership test (`set.has('sed')`,
 * `list.includes('sed')`), is accepted only when the checker gives the other side a closed union of string literals that
 * contains it (for a membership test, the parameter type of the method it calls, which is the element type of the
 * container): a value of a model (`'alias'` of a name's resolution, `'sed'` of `EmbeddedLang`), not a command name read from
 * a script. `string`, `any` and a union with `string` in it are open, and the comparison is found. The one exception is
 * `SyntaxNode.type`, an open `string` whose values (`command`, `test`) are node types. A membership test the other way
 * round is a comparison too: a value tested against a container written with names (`['local', 'declare'].includes(x)`,
 * `new Set(['local']).has(x)`, a `const` holding one) or a regular expression of names (`/^(local|declare)$/.test(x)`),
 * found when one of the names is a command's and the value is open. Returns the text of what is found.
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
      // A value (not a literal) tested against the names a container is written with.
      else if (text === undefined && containerLiterals(checker, n.expression.expression)?.some((t) => open(n.arguments[0], t))) found.push(n.getText(sf));
    } else if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && ['startsWith', 'endsWith'].includes(n.expression.name.text) && n.arguments.length > 0) {
      // A prefix or suffix that is a command's name (`cmd.endsWith('grep')` takes egrep and zgrep too), as a word: not `startsWith('.')`, where `.` is a builtin by chance.
      const text = literalText(n.arguments[0]);
      if (text !== undefined && /^[A-Za-z][\w-]*$/.test(text) && names.has(text)) found.push(n.getText(sf));
    } else if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && ['test', 'exec'].includes(n.expression.name.text) && n.arguments.length > 0) {
      if (literalText(n.arguments[0]) === undefined && regexWords(checker, n.expression.expression)?.some((t) => open(n.arguments[0], t))) found.push(n.getText(sf));
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}

/**
 * The records of the dictionary keyed by command name (src/dict/): those of specs (every one of them, checked below), and
 * those that say something else of a command (`commandAliases`, `declarationCommands`, `distroAliases`).
 */
const RECORDS = new Set([
  'builtins', 'commands', 'core', 'shells', 'basic', 'admin', 'storage', 'netadmin', 'ops', 'macos', 'distro', 'system', 'monitor', 'BATS_COMMANDS', 'BATS_SUPPORT_COMMANDS', 'BATS_ASSERT_COMMANDS', 'BATS_FILE_COMMANDS', 'YQ_SPECS',
  'commandAliases', 'declarationCommands', 'distroAliases',
]);
const dictDir = path.join(base, 'src', 'dict') + path.sep;
const inDict = (d: ts.Declaration): boolean => path.resolve(d.getSourceFile().fileName).startsWith(dictDir);

/** The declarations of what `e` names (an identifier, or the member of a namespace `B.builtins`), through an import. */
function declarationsOf(checker: ts.TypeChecker, e: ts.Expression): readonly ts.Declaration[] {
  const at = ts.isIdentifier(e) ? e : ts.isPropertyAccessExpression(e) ? e.name : undefined;
  let sym = at && checker.getSymbolAtLocation(at);
  if (sym && sym.flags & ts.SymbolFlags.Alias) sym = checker.getAliasedSymbol(sym);
  return sym?.declarations ?? [];
}

/**
 * Whether `e` names one of the dictionary's records (through an import, renamed or not, or a namespace import:
 * `B.builtins`), not another value of that name. (A record given to a variable first, `const b = builtins`, is not
 * followed.)
 */
function isRecord(checker: ts.TypeChecker, e: ts.Expression): boolean {
  return declarationsOf(checker, e).some((d) => ts.isVariableDeclaration(d) && ts.isIdentifier(d.name) && RECORDS.has(d.name.text) && inDict(d));
}

/** Whether `e` names a function of the dictionary (`lookupCommand`, `aliasOf`, `canonicalName`, `yqSpecsOf`…). */
function isDictFunction(checker: ts.TypeChecker, e: ts.Expression): boolean {
  return declarationsOf(checker, e).some((d) => (ts.isFunctionDeclaration(d) || (ts.isVariableDeclaration(d) && !!d.initializer && ts.isArrowFunction(d.initializer))) && inDict(d));
}

/**
 * Lookups of a command by its name in the dictionary: in a record (`builtins.local`, `builtins['return']`, `commands.sed`,
 * `B.builtins.local`, `const { local } = builtins`, `'local' in builtins`, `Object.hasOwn(builtins, 'local')`), or with
 * a function of the dictionary (`lookupCommand('local')`, `aliasOf('egrep')`). A spec picked by name then decides by
 * identity (`head.spec === builtins.local`) what a field of the spec should say. A lookup with a name read from the
 * script (`builtins[name]`, `lookupCommand(name)`) is what the dictionary is for, and is not found.
 */
function recordLookups(checker: ts.TypeChecker, sf: ts.SourceFile, names: ReadonlySet<string>): string[] {
  const found: string[] = [];
  const named = (e: ts.Expression | undefined): boolean => {
    const text = e && literalText(e);
    return text !== undefined && names.has(text);
  };
  const visit = (n: ts.Node): void => {
    const key = ts.isPropertyAccessExpression(n) ? n.name.text : ts.isElementAccessExpression(n) ? literalText(n.argumentExpression) : undefined;
    if (key !== undefined && names.has(key) && isRecord(checker, (n as ts.PropertyAccessExpression | ts.ElementAccessExpression).expression)) found.push(n.getText(sf));
    // `const { local, sed: s } = builtins`.
    else if (ts.isVariableDeclaration(n) && ts.isObjectBindingPattern(n.name) && n.initializer && isRecord(checker, n.initializer)) {
      for (const el of n.name.elements) {
        const prop = el.propertyName ?? el.name;
        if ((ts.isIdentifier(prop) || ts.isStringLiteral(prop)) && names.has(prop.text)) found.push(`${el.getText(sf)} of ${n.initializer.getText(sf)}`);
      }
    } else if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.InKeyword && named(n.left) && isRecord(checker, n.right)) found.push(n.getText(sf));
    // `Object.hasOwn(builtins, 'local')`, `Object.prototype.hasOwnProperty.call(builtins, 'local')`: a record and a name.
    else if (ts.isCallExpression(n) && n.arguments.some((a) => isRecord(checker, a)) && n.arguments.some(named)) found.push(n.getText(sf));
    else if (ts.isCallExpression(n) && named(n.arguments[0]) && isDictFunction(checker, n.expression)) found.push(n.getText(sf));
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}

/** The names a lookup of a registry reads the key from: `stage.cmd`, `spec.command`, `cmd`. */
const COMMAND_KEY = /(?:^|\.)(?:cmd|command|cmdName|commandName)$/;

/**
 * Registries keyed by command name: a table of functions, written as an object literal with command names for keys (`{ cat: runCat,
 * sort: runSort }`: two or more of them, with values that are functions, or any command name when the literal is typed as a record of
 * functions, `Record<string, (…) => …>`), and a lookup in a record of functions by a command's name (`FILTERS[stage.cmd]`). A table
 * keyed by command name is a copy of the dictionary (sources.md, M6). Returns the text of what is found: the literal as
 * `{ cat, sort, … }` (its command names), or the lookup. Not caught: a `Map` of names to functions, a registry built at run time
 * (`REG[name] = fn`), and a lookup by a key of another name (`FILTERS[c]`).
 */
function registries(checker: ts.TypeChecker, sf: ts.SourceFile, names: ReadonlySet<string>): string[] {
  const found: string[] = [];
  const isFn = (t: ts.Type | undefined): boolean => !!t && t.getCallSignatures().length > 0;
  /** The type of the values of a record, `Record<string, V>`, or undefined for a type without an index signature. */
  const indexed = (t: ts.Type | undefined): ts.Type | undefined => t && checker.getIndexInfoOfType(t, ts.IndexKind.String)?.type;
  const visit = (n: ts.Node): void => {
    if (ts.isObjectLiteralExpression(n)) {
      const keys: { name: string; fn: boolean }[] = [];
      for (const p of n.properties) {
        const key = p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) || ts.isNoSubstitutionTemplateLiteral(p.name)) ? p.name.text : undefined;
        if (key === undefined || !names.has(key)) continue;
        const value = ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p) || ts.isMethodDeclaration(p) ? checker.getTypeAtLocation(p) : undefined;
        keys.push({ name: key, fn: isFn(value) });
      }
      const typed = isFn(indexed(checker.getContextualType(n)));
      const fns = keys.filter((k) => k.fn).map((k) => k.name);
      if (typed ? keys.length > 0 : fns.length > 1) found.push(`{ ${(typed ? keys.map((k) => k.name) : fns).join(', ')} }`);
    } else if (ts.isElementAccessExpression(n) && !literalText(n.argumentExpression) && COMMAND_KEY.test(n.argumentExpression.getText(sf)) && isFn(indexed(checker.getTypeAtLocation(n.expression)))) {
      found.push(n.getText(sf));
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

const SNIPPET_NAMES = new Set(['sed', 'awk', 'jq', 'date', 'grep', 'declare', 'builtin', 'alias', 'command', 'unset', 'local', 'return', 'egrep', 'run']);
const found = (name: string): string[] => {
  const sf = program().getSourceFile(snippets.get(name)!)!;
  const checker = program().getTypeChecker();
  return [...nameComparisons(checker, sf, SNIPPET_NAMES), ...recordLookups(checker, sf, SNIPPET_NAMES), ...registries(checker, sf, SNIPPET_NAMES)];
};

const fixtures: { name: string; code: string; found: string[] }[] = [
  // Open strings are found, whatever the field is called.
  { name: 'open-why', code: `declare const r: { why: string };\nexport const a = r.why === 'builtin';`, found: [`r.why === 'builtin'`] },
  { name: 'open-var', code: `export function f(a: string, b: string, c: string) { return a === 'sed' || 'declare' !== b || c != 'grep'; }`, found: [`a === 'sed'`, `'declare' !== b`, `c != 'grep'`] },
  { name: 'open-any', code: `export function f(x: any, y: unknown) { return x === 'sed' || y === 'awk'; }`, found: [`x === 'sed'`, `y === 'awk'`] },
  { name: 'open-union', code: `export function f(x: 'alias' | string | undefined, y: string | null) { return x === 'alias' || y === 'sed'; }`, found: [`x === 'alias'`, `y === 'sed'`] },
  { name: 'open-case', code: `export function f(x: string) { switch (x) { case 'grep': return 1; case 'other': return 2; } return 0; }`, found: [`case 'grep'`] },
  { name: 'open-members', code: "export function f(x: string) { return ['a'].includes('declare') || new Set<string>().has('sed') || x.includes('awk'); }", found: [`['a'].includes('declare')`, `new Set<string>().has('sed')`, `x.includes('awk')`] },
  { name: 'open-affix', code: `export function f(x: string) { return x.endsWith('grep') || x.startsWith(\`sed\`) || x.startsWith('.') || x.endsWith('zzz') || x.startsWith('-'); }`, found: [`x.endsWith('grep')`, 'x.startsWith(`sed`)'] },
  // A dispatch to a simulator by the name of the command (the registry of src/examples/): found, though the switch is on a function's result.
  { name: 'open-registry', code: `declare function canonicalName(n: string): string;\nexport function f(cmd: string) { switch (canonicalName(cmd)) { case 'grep': return 1; case 'sed': return 2; case 'zzz': return 3; } return 0; }`, found: [`case 'grep'`, `case 'sed'`] },
  { name: 'open-type-field', code: `export function f(x: { type: string }) { return x.type === 'command'; }`, found: [`x.type === 'command'`] },
  { name: 'outside-union', code: `export function f(x: 'alias' | 'file') { return x === 'sed'; }`, found: [`x === 'sed'`] },
  { name: 'template', code: 'export function f(x: string) { return x === `sed`; }', found: ['x === `sed`'] },
  // Closed unions that contain the literal pass, with the field called anything or nothing at all.
  { name: 'closed-field', code: `type R = { kind: 'alias' | 'file' | 'builtin' };\nexport function f(r: R, q: R, p: R, s?: R) { return r.kind === 'alias' || q.kind !== 'builtin' || 'file' === p.kind || s?.kind === 'alias'; }`, found: [] },
  { name: 'closed-models', code: `type Slot = { run: 'exec' | 'shell-string' };\ntype Role = { role: 'command' | 'script' };\ntype Missed = { why: 'command' | 'builtin' };\nexport function f(a: Slot, b: Role, c: Missed) { return a.run === 'exec' || b.role === 'command' || c.why === 'builtin'; }`, found: [] },
  { name: 'closed-case', code: `type EmbeddedLang = 'sed' | 'awk' | 'jq' | 'date' | 'regex';\nexport function f(lang: EmbeddedLang) { switch (lang) { case 'sed': case 'awk': return 1; case 'jq': case 'date': return 2; case 'regex': return 3; } return 0; }`, found: [] },
  { name: 'closed-bare', code: `type Lang = 'sed' | 'awk';\nexport function f(lang: Lang, maybe: Lang | undefined) { return lang === 'sed' || maybe !== 'awk'; }`, found: [] },
  { name: 'closed-mixed', code: `export function f(g: { value: string } | 'unset' | 'unknown') { return g !== 'unset'; }`, found: [] },
  // A value tested against literals that are names: an array, a set, a constant of either, a regular expression of names.
  {
    name: 'open-containers',
    code: "const LOCALS = new Set(['local', 'declare']);\nconst LIST = ['zzz', 'sed'] as const;\nconst RE = /^(?:grep|egrep)$/;\n"
      + "export function f(x: string, y: any) { return ['local', 'qq'].includes(x) || new Set<string>(['unset']).has(x) || LOCALS.has(x) || (LIST as readonly string[]).includes(x) || /^(local|declare)$/.test(x) || RE.test(y) || new RegExp('^(sed|awk)$').exec(x) || /^alias$/.test(x); }",
    found: ["['local', 'qq'].includes(x)", "new Set<string>(['unset']).has(x)", 'LOCALS.has(x)', '(LIST as readonly string[]).includes(x)', '/^(local|declare)$/.test(x)', 'RE.test(y)', "new RegExp('^(sed|awk)$').exec(x)", '/^alias$/.test(x)'],
  },
  // Not names, a closed value, or a pattern that is not an alternation of words.
  {
    name: 'closed-containers',
    code: "const NOT = new Set(['zzz', 'qq']);\nlet later = ['sed'];\n"
      + "export function f(x: string, y: 'local' | 'file', s: Set<string>) { return NOT.has(x) || ['a', 'b'].includes(x) || /^(zzz|qq)$/.test(x) || /^(local|file)$/.test(y) || ['local', 'file'].includes(y) || /^-[a-z]*g/.test(x) || /^(sed|a[bc])$/.test(x) || later.includes(x) || s.has(x); }",
    found: [],
  },
  { name: 'closed-members', code: `const LIST = ['sed', 'awk'] as const;\nexport function f(s: Set<'sed' | 'awk'>, m: ReadonlySet<'grep'>) { return LIST.includes('sed') || s.has('awk') || m.has('grep'); }`, found: [] },
  // A table of functions keyed by command name, typed or not, and a lookup in it by a command's name; not a table of other values or keys.
  {
    name: 'registry',
    code: "const run = (w: string[]): string[] => w;\ntype F = (w: string[]) => string[];\n"
      + "export const A: Record<string, F> = { sed: run, grep: run, zzz: run };\nexport const B = { awk: run, jq: run, zzz: run, local: 1 };\n"
      + "export function f(cmd: string, s: { cmd: string; command: string }) { return [A[cmd], A[s.cmd], A[s.command], A['sed']]; }",
    found: ['{ sed, grep }', '{ awk, jq }', 'A[cmd]', 'A[s.cmd]', 'A[s.command]'],
  },
  {
    name: 'not-a-registry',
    code: "const run = (w: string[]): string[] => w;\ntype F = (w: string[]) => string[];\n"
      + "export const A: Record<string, F> = { zzz: run, qq: run };\nexport const B = { sed: run };\nexport const C = { sed: 1, grep: 2, cat: 3 };\nexport const D: Record<string, number> = { sed: 1 };\n"
      + "export function f(cmd: string, k: string, n: Record<string, number>) { return [A[k], n[cmd], A.zzz]; }",
    found: [],
  },
  // The node type of the syntax tree is the one open string that is allowed.
  { name: 'node-type', code: `export function f(node: SyntaxNode, p: SyntaxNode | null) { return node.type === 'command' || 'command' === node.type || p?.type !== 'declare'; }`, found: [] },
  // Not a command name, whatever the type.
  { name: 'not-a-name', code: `export function f(x: string) { return x === 'zzz' || x.includes('qq'); }`, found: [] },
  // A command looked up by its name in a record of the dictionary, imported under its name or another.
  {
    name: 'lookup',
    code: `import { builtins } from '../dict/builtins';\nimport { commands as dict, core } from '../dict/commands';\nexport const a = [builtins.local, builtins['return'], dict.sed, core[\`grep\`], builtins.unset.operands];`,
    found: ['builtins.local', "builtins['return']", 'dict.sed', 'core[`grep`]', 'builtins.unset'],
  },
  // Through a namespace import, by destructuring, in the other records of the dictionary.
  {
    name: 'lookup-namespace',
    code: `import * as B from '../dict/builtins';\nimport * as A from '../dict/aliases';\nexport const a = [B.builtins.local, A.commandAliases.egrep, B.builtins[\`return\`]];`,
    found: ['B.builtins.local', 'A.commandAliases.egrep', 'B.builtins[`return`]'],
  },
  {
    name: 'lookup-destructuring',
    code: `import { builtins } from '../dict/builtins';\nconst { local, return: r, 'unset': u, zzz } = builtins;\nexport const a = [local, r, u, zzz];`,
    found: ['local of builtins', 'return: r of builtins', "'unset': u of builtins"],
  },
  {
    name: 'lookup-records',
    code: `import { basic } from '../dict/basic';\nimport { BATS_COMMANDS } from '../dict/bats';\nimport { declarationCommands } from '../dict/syntax';\nimport { distroAliases } from '../dict/distroAliases';\nexport const a = [basic.sed, BATS_COMMANDS.run, declarationCommands.declare, distroAliases['grep']];`,
    found: ['basic.sed', 'BATS_COMMANDS.run', 'declarationCommands.declare', "distroAliases['grep']"],
  },
  // A function of the dictionary given a name, `in`, and a call given a record and a name.
  {
    name: 'lookup-functions',
    code: `import { aliasOf, canonicalName, lookupCommand } from '../dict/aliases';\nimport { yqSpecsOf } from '../dict/yq';\nexport function f(name: string) { return [lookupCommand('local'), aliasOf('egrep'), canonicalName(\`grep\`), yqSpecsOf('sed'), lookupCommand(name), lookupCommand('zzz')]; }`,
    found: ["lookupCommand('local')", "aliasOf('egrep')", 'canonicalName(`grep`)', "yqSpecsOf('sed')"],
  },
  {
    name: 'lookup-membership',
    code: `import { builtins } from '../dict/builtins';\nimport { commands } from '../dict/commands';\nexport function f(name: string) { return ['local' in builtins, Object.hasOwn(commands, 'sed'), Object.prototype.hasOwnProperty.call(builtins, 'unset'), name in builtins, Object.hasOwn(builtins, name), 'zzz' in builtins]; }`,
    found: ["'local' in builtins", "Object.hasOwn(commands, 'sed')", "Object.prototype.hasOwnProperty.call(builtins, 'unset')"],
  },
  // A lookup by a name read from the script, a field of another object, a record of the same name that is not the dictionary's.
  // (Not covered: a record given to a variable first, `b.local`.)
  {
    name: 'not-a-lookup',
    code: `import { builtins } from '../dict/builtins';\nexport function f(name: string, o: { local: number }) { const commands = { sed: 1 }; const b = builtins; const { sed } = commands; return [builtins[name], o.local, commands.sed, builtins.zzz, b.local, sed, 'sed' in commands]; }`,
    found: [],
  },
];
for (const f of fixtures) snippet(f.name, f.code);

describe('src/explain guards', function () {
  // One program over src/explain/ and what it imports (a few seconds), shared by the tests that need the checker.
  this.timeout(120000);

  it('has no import cycle and does not import src/analyzer.ts', () => {
    const analyzer = path.join(base, 'src', 'analyzer');
    const sources = new Map(files().map((f) => [f, fs.readFileSync(f, 'utf8')]));
    const importsAnalyzer = [...sources]
      .filter(([f, code]) => relativeImports(code).some((r) => path.resolve(path.dirname(f), r).replace(/\.(js|ts)$/, '') === analyzer))
      .map(([f]) => path.relative(base, f));
    assert.deepStrictEqual(importsAnalyzer, []);
    // Only the modules of src/explain/ and the two outside it can close a cycle among themselves.
    assert.deepStrictEqual(cycleNames(importGraph(sources, graphMember(dir, OUTSIDE))), []);
  });

  it('compares nothing with the name of a dictionary command, nor looks one up by name, except the known ones', () => {
    const names = new Set([...Object.keys(commands), ...Object.keys(builtins), ...Object.keys(core), ...Object.keys(BATS_COMMANDS), ...Object.keys(BATS_SUPPORT_COMMANDS), ...Object.keys(BATS_ASSERT_COMMANDS), ...Object.keys(BATS_FILE_COMMANDS), ...Object.keys(commandAliases)]);
    assert.ok(names.has('sed') && names.has('declare') && names.has('run') && names.has('egrep'));
    const p = program();
    const checker = p.getTypeChecker();
    const all = [...files(), ...examplesFiles()].flatMap((f) => {
      const sf = p.getSourceFile(f);
      assert.ok(sf, f);
      return [...nameComparisons(checker, sf, names), ...recordLookups(checker, sf, names), ...registries(checker, sf, names)].map((text) => ({ file: path.relative(base, f), text }));
    });
    // Counted per file and text, like the other guards: a new text, a larger count and a stale entry all fail.
    const actual = new Map<string, number>();
    for (const x of all) actual.set(`${x.file} ${x.text}`, (actual.get(`${x.file} ${x.text}`) ?? 0) + 1);
    // `PRINT_NAMES=1 npx mocha … test/explain-imports.test.ts` prints what is found, as the known list's entries (without kind and reason).
    if (process.env.PRINT_NAMES) console.log(JSON.stringify([...actual].map(([k, count]) => ({ file: k.split(' ', 1)[0], text: k.slice(k.indexOf(' ') + 1), count })), null, 1));
    const listed = new Map(KNOWN_NAMES.map((k) => [`${k.file} ${k.text}`, k.count]));
    const problems: string[] = [];
    if (listed.size !== KNOWN_NAMES.length) problems.push('an entry is listed twice');
    for (const k of KNOWN_NAMES) if (!k.reason.trim() || !['not-a-name', 'registry', 'decision'].includes(k.kind)) problems.push(`${k.file} ${k.text} has no reason or no kind`);
    for (const [k, n] of actual) {
      const have = listed.get(k);
      if (have === undefined) problems.push(`NEW: ${k} (${n}): read the spec (src/dict/) or the model instead of the name; a name that collides with another meaning goes into test/fixtures/names-known.json with its reason`);
      else if (n > have) problems.push(`MORE: ${k} has ${n} matches, ${have} are listed`);
    }
    for (const [k, have] of listed) if ((actual.get(k) ?? 0) < have) problems.push(`STALE: ${k} lists ${have}, ${actual.get(k) ?? 0} found: lower the count or remove the entry`);
    assert.deepStrictEqual(problems, []);
  });

  it('reads the files of src/examples/ except the language interpreters', () => {
    const names = examplesFiles().map((f) => path.basename(f));
    assert.ok(names.includes('pipeline.ts') && names.includes('textfilters.ts') && names.includes('getopt.ts'), names.join(' '));
    // The walk goes into subdirectories (a new src/examples/x/y.ts is read).
    const all = tsFilesUnder(path.join(base, 'src')).map((f) => path.relative(base, f).split(path.sep).join('/'));
    assert.ok(all.includes('src/examples/pipeline.ts') && all.includes('src/syntax/adapters/unbash.ts'));
    for (const l of LANGUAGES) {
      assert.ok(fs.existsSync(path.join(examplesDir, l)), `${l} is gone: remove it from LANGUAGES`);
      assert.ok(!names.includes(l), l);
    }
  });

  it('knows every record of specs of the dictionary', async () => {
    // (A record whose values are all specs, with a summary: a new one must be in RECORDS, or the guard misses it.)
    const seen = new Set<string>();
    for (const f of fs.readdirSync(path.join(base, 'src', 'dict')).filter((x) => x.endsWith('.ts'))) {
      const mod = (await import(path.join(base, 'src', 'dict', f))) as Record<string, unknown>;
      for (const [name, value] of Object.entries(mod)) {
        const entries = value && typeof value === 'object' && !Array.isArray(value) ? Object.values(value) : [];
        if (entries.length && entries.every((v) => !!v && typeof v === 'object' && 'summary' in v)) seen.add(name);
      }
    }
    assert.ok(seen.has('builtins') && seen.has('basic') && seen.has('BATS_COMMANDS'), [...seen].join(' '));
    assert.deepStrictEqual([...seen].filter((name) => !RECORDS.has(name)), []);
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

  it('finds a cycle that passes through a module outside src/explain/', () => {
    // (as a.ts -> ../tokens -> ./explain/b -> ./a: the modules outside the directory are nodes of the graph)
    const sources = new Map([
      ['/x/explain/a.ts', `import { t } from '../tokens';`],
      ['/x/explain/b.ts', `import { a } from './a';`],
      ['/x/tokens.ts', `import { b } from './explain/b';`],
      ['/x/other.ts', `import { a } from './explain/a';`],
    ]);
    assert.deepStrictEqual(cycleNames(importGraph(sources, graphMember('/x/explain', ['/x/tokens.ts']))), ['a -> tokens -> b -> a']);
    // Without the outside module in the graph, the same sources pass: the reason the guard includes it.
    assert.deepStrictEqual(cycleNames(importGraph(sources, graphMember('/x/explain', []))), []);
    // A module outside that is not named is left out, though it imports into the directory.
    assert.deepStrictEqual(cycleNames(importGraph(new Map([...sources, ['/x/explain/c.ts', `import { o } from '../other';`]]), graphMember('/x/explain', ['/x/tokens.ts']))), ['a -> tokens -> b -> a']);
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
