import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

// The scan behind test/word-source.test.ts (docs/design/word-source.md, section 4): where src/ reads word-part node
// types, calls a helper that decides a fact of a word, tests glob characters, or names the IFS whitespace. It is
// syntactic (no type checker), so the guard runs in a fraction of a second. `npx tsx test/support/word-source.ts` prints
// the matches as the known list's entries (counts per file, function and kind).

export type Kind = 'node-type' | 'helper' | 'glob-class' | 'ifs';
export interface Match {
  file: string;
  /** The outermost named function, method or top-level `const` around the match ('<module>' for a bare statement). */
  fn: string;
  kind: Kind;
  /** The node type, helper, regex or identifier that was found. */
  what: string;
}

export const base = path.join(__dirname, '..', '..');

/** The node types of the parts of a word. */
export const NODE_TYPES: ReadonlySet<string> = new Set([
  'word', 'number', 'string', 'string_content', 'raw_string', 'ansi_c_string', 'translated_string', 'concatenation', 'simple_expansion',
  'expansion', 'command_substitution', 'arithmetic_expansion', 'process_substitution', 'brace_expression',
]);
/** The text helpers that decide a fact of a word from its tree; the list shrinks as each helper goes (word-source.md, step 8). */
export const HELPERS: ReadonlySet<string> = new Set([
  'staticWordValue', 'literalContent', 'unquoteWord', 'isPlainWord', 'isGlob', 'hasGlob', 'tildeSpots', 'tildeParts', 'countOf', 'splitsIn', 'plainWords',
]);
const IFS_NAMES: ReadonlySet<string> = new Set(['IFS_WHITESPACE', 'IFS_ERRATIC']);

/** Files (or directories, ending in `/`) where word facts are made or only syntax is read; their matches are not counted. */
export const ALLOWED: readonly string[] = [
  // The word layer.
  ...['words', 'chars', 'wordview', 'brace', 'wordcontexts', 'wordsites', 'operands', 'fieldshape'].map((n) => `src/semantics/${n}.ts`),
  // Where the helpers are defined.
  'src/staticword.ts',
  'src/examples/shellwords.ts',
  // Syntax.
  'src/syntax/',
  'src/highlight.ts',
  'src/semanticTokens.ts',
  // Other languages.
  'src/embedded/',
  ...['jq', 'awk', 'sed', 'perlrun', 'yaml', 'regex'].map((n) => `src/examples/${n}.ts`),
  'src/arith.ts',
];

const isAllowed = (rel: string): boolean => ALLOWED.some((a) => (a.endsWith('/') ? rel.startsWith(a) : rel === a));

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) sourceFiles(p, out);
    else if (e.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

const bare = (e: ts.Expression): ts.Expression => {
  while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e) || ts.isNonNullExpression(e)) e = e.expression;
  return e;
};
const literalText = (e: ts.Node): string | undefined => (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e) ? e.text : undefined);
/** Whether `e` reads a `.type` (`n.type`, `n?.type`, `parts[0].type`). */
const readsType = (e: ts.Expression): boolean => {
  e = bare(e);
  return ts.isPropertyAccessExpression(e) && e.name.text === 'type';
};
/** The source of a regex literal (without its flags), or of `new RegExp('…')` of a literal. */
function regexSource(e: ts.Expression): string | undefined {
  e = bare(e);
  if (ts.isRegularExpressionLiteral(e)) return e.text.slice(1, e.text.lastIndexOf('/'));
  if (ts.isNewExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === 'RegExp' && e.arguments?.length) return literalText(e.arguments[0]);
  return undefined;
}
/** Whether a regex source has a character class holding both `*` and `?` (`[*?[]`, `[\s*?[]`). */
export function globClass(source: string): boolean {
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\\') i++;
    else if (source[i] === '[') {
      let j = i + 1;
      let body = '';
      for (; j < source.length && source[j] !== ']'; j++) {
        if (source[j] === '\\') j++;
        else body += source[j];
      }
      if (body.includes('*') && body.includes('?')) return true;
      i = j;
    }
  }
  return false;
}
/** The node types a regex of alternatives names (`/^(word|number)$/`). */
function regexNodeTypes(source: string): string[] {
  return source.replace(/^\^/, '').replace(/\$$/, '').replace(/^\((?:\?:)?(.*)\)$/, '$1').split('|').filter((a) => NODE_TYPES.has(a));
}

/** The matches of one source file, `rel` being its path from the repo root. */
export function scanSource(rel: string, text: string): Match[] {
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.ES2022, true);
  const found: Match[] = [];

  /** The name of a function-like or declaration node, if it has one. */
  const nameOf = (n: ts.Node): string | undefined => {
    if ((ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n) || ts.isClassDeclaration(n)) && n.name) return n.name.getText(sf);
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)) return n.name.text;
    if (ts.isPropertyAssignment(n) && ts.isIdentifier(n.name)) return n.name.text;
    return undefined;
  };
  const enclosing = (n: ts.Node): string => {
    let name = '<module>';
    for (let p: ts.Node | undefined = n.parent; p && !ts.isSourceFile(p); p = p.parent) {
      // A class holds methods: the method is the name, not the class.
      const own = nameOf(p);
      if (own !== undefined && !ts.isClassDeclaration(p)) name = own;
      else if (own !== undefined && name === '<module>') name = own;
    }
    return name;
  };
  const add = (n: ts.Node, kind: Kind, what: string): void => {
    found.push({ file: rel, fn: enclosing(n), kind, what });
  };

  // The containers (array literals, sets, regexes) that a `.has(x.type)` / `.includes(x.type)` / `.test(x.type)` of this file reads.
  const typeTested = new Set<string>();
  let inlineTested: ts.Node[] = [];
  const containerOf = (e: ts.Expression): ts.Node | string | undefined => {
    e = bare(e);
    return ts.isIdentifier(e) ? e.text : e;
  };
  const collect = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && ['has', 'includes', 'test'].includes(n.expression.name.text)) {
      const arg = n.arguments[0];
      const recv = n.expression.expression;
      if (n.expression.name.text === 'test' ? arg && readsType(arg) : arg && readsType(arg)) {
        const c = containerOf(recv);
        if (typeof c === 'string') typeTested.add(c);
        else if (c) inlineTested.push(c);
      }
      // `list.some((t) => t === x.type)` and the like are comparisons, found below.
    }
    ts.forEachChild(n, collect);
  };
  collect(sf);

  /** The node-type literals a container expression is written with: an array literal, a `new Set([…])`, or a regex. */
  const typeLiterals = (e: ts.Expression): ts.Node[] => {
    e = bare(e);
    if (ts.isArrayLiteralExpression(e)) return e.elements.filter((x) => { const t = literalText(x); return t !== undefined && NODE_TYPES.has(t); });
    if (ts.isNewExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === 'Set' && e.arguments?.length) return typeLiterals(e.arguments[0]);
    return [];
  };

  const visit = (n: ts.Node): void => {
    if (ts.isBinaryExpression(n) && [ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(n.operatorToken.kind)) {
      const l = literalText(bare(n.left));
      const r = literalText(bare(n.right));
      if (l !== undefined && NODE_TYPES.has(l) && readsType(n.right)) add(n, 'node-type', l);
      else if (r !== undefined && NODE_TYPES.has(r) && readsType(n.left)) add(n, 'node-type', r);
    } else if (ts.isCaseClause(n)) {
      const t = literalText(n.expression);
      if (t !== undefined && NODE_TYPES.has(t) && readsType((n.parent.parent as ts.SwitchStatement).expression)) add(n, 'node-type', t);
    } else if (ts.isVariableDeclaration(n) && n.initializer && ts.isIdentifier(n.name) && typeTested.has(n.name.text)) {
      for (const lit of typeLiterals(n.initializer)) add(lit, 'node-type', (lit as ts.StringLiteral).text);
      const src = regexSource(n.initializer);
      for (const t of src === undefined ? [] : regexNodeTypes(src)) add(n, 'node-type', t);
    } else if (inlineTested.includes(n)) {
      for (const lit of typeLiterals(n as ts.Expression)) add(lit, 'node-type', (lit as ts.StringLiteral).text);
      const src = regexSource(n as ts.Expression);
      for (const t of src === undefined ? [] : regexNodeTypes(src)) add(n, 'node-type', t);
    }
    // Calls of the decider helpers, by name (`f(x)`, `ns.f(x)`).
    if (ts.isCallExpression(n)) {
      const callee = ts.isIdentifier(n.expression) ? n.expression.text : ts.isPropertyAccessExpression(n.expression) ? n.expression.name.text : undefined;
      if (callee !== undefined && HELPERS.has(callee)) add(n, 'helper', callee);
    }
    // Character classes with `*` and `?`.
    const src = ts.isRegularExpressionLiteral(n) || ts.isNewExpression(n) ? regexSource(n as ts.Expression) : undefined;
    if (src !== undefined && globClass(src)) add(n, 'glob-class', `/${src}/`);
    // The IFS whitespace.
    if (ts.isIdentifier(n) && IFS_NAMES.has(n.text) && !ts.isImportSpecifier(n.parent) && !(ts.isVariableDeclaration(n.parent) && n.parent.name === n)) add(n, 'ifs', n.text);
    if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && n.text === ' \t\n') add(n, 'ifs', "' \\t\\n'");
    ts.forEachChild(n, visit);
  };
  visit(sf);
  inlineTested = [];
  return found;
}

/** The matches of every src/**\/*.ts outside the allow-list. */
export function scanAll(): Match[] {
  const out: Match[] = [];
  for (const f of sourceFiles(path.join(base, 'src')).sort()) {
    const rel = path.relative(base, f).split(path.sep).join('/');
    if (!isAllowed(rel)) out.push(...scanSource(rel, fs.readFileSync(f, 'utf8')));
  }
  return out;
}

/** The matches counted per file, function and kind (the known list's grain). */
export function counted(matches: readonly Match[]): { file: string; fn: string; kind: Kind; count: number }[] {
  const by = new Map<string, { file: string; fn: string; kind: Kind; count: number }>();
  for (const m of matches) {
    const key = `${m.file}\0${m.fn}\0${m.kind}`;
    const e = by.get(key) ?? { file: m.file, fn: m.fn, kind: m.kind, count: 0 };
    e.count++;
    by.set(key, e);
  }
  return [...by.values()];
}

if (require.main === module) console.log(JSON.stringify(counted(scanAll()), null, 1));
