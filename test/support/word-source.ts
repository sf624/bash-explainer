import * as ts from 'typescript';
import { bare, base, counted as countedAny, enclosing, literalText, parseSource, regexSource, scanDirs, type Match as MatchOf } from './scan';

// The scan behind test/word-source.test.ts (docs/design/word-source.md, section 4): where src/ reads word-part node
// types, calls a helper that decides a fact of a word, tests glob characters, or names the IFS whitespace. It is
// syntactic (no type checker), so the guard runs in a fraction of a second. `npx tsx test/support/word-source.ts` prints
// the matches as the known list's entries (counts per file, function and kind).

export type Kind = 'node-type' | 'helper' | 'glob-class' | 'ifs';
export type Match = MatchOf<Kind>;
export { base };

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
  // Where a helper is defined (src/staticword.ts is matched, so that a new word predicate there is found).
  'src/examples/shellwords.ts',
  // Syntax: the adapter that reads the parser's tree (src/syntax/tree.ts is matched: it holds word predicates too).
  'src/syntax/adapters/',
  'src/highlight.ts',
  'src/semanticTokens.ts',
  // Other languages.
  'src/embedded/',
  ...['jq', 'awk', 'sed', 'perlrun', 'yaml', 'regex'].map((n) => `src/examples/${n}.ts`),
  'src/arith.ts',
];

/** Whether `e` is a `.type` access (`n.type`, `n?.type`, `parts[0].type`). */
const isTypeAccess = (e: ts.Expression): boolean => {
  e = bare(e);
  return ts.isPropertyAccessExpression(e) && e.name.text === 'type';
};
/** The names of the functions that take a list of node types, whatever file defines them (src/syntax/tree.ts, src/explain/nodes.ts). */
const QUERIES: ReadonlySet<string> = new Set(['descendants', 'onLine']);
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
  const sf = parseSource(rel, text);
  const found: Match[] = [];

  const add = (n: ts.Node, kind: Kind, what: string): void => {
    found.push({ file: rel, fn: enclosing(n), kind, what });
  };

  // The variables that hold a node type (`const t = n.type`), by name, and the functions of this file that take a list of node types.
  const typeVars = new Set<string>();
  const queries = new Set<string>(QUERIES);
  const prepass = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && isTypeAccess(n.initializer)) typeVars.add(n.name.text);
    if ((ts.isFunctionDeclaration(n) || ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isMethodDeclaration(n)) && n.parameters.some((q) => ts.isIdentifier(q.name) && q.name.text === 'types')) {
      const own = ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n) ? n.name?.getText(sf) : ts.isVariableDeclaration(n.parent) && ts.isIdentifier(n.parent.name) ? n.parent.name.text : undefined;
      if (own !== undefined) queries.add(own);
    }
    ts.forEachChild(n, prepass);
  };
  prepass(sf);
  /** Whether `e` reads a node type: a `.type`, or a variable that was set from one. */
  const readsType = (e: ts.Expression): boolean => {
    e = bare(e);
    return isTypeAccess(e) || (ts.isIdentifier(e) && typeVars.has(e.text));
  };

  // The containers (array literals, sets, regexes) that this file tests a node type against (`.has(x.type)`, `.includes(x.type)`,
  // `.test(x.type)`) or hands to a function that queries the tree (`descendants(root, ['word'])`).
  const typeTested = new Set<string>();
  const inlineTested: ts.Node[] = [];
  const containerOf = (e: ts.Expression): ts.Node | string | undefined => {
    e = bare(e);
    return ts.isIdentifier(e) ? e.text : e;
  };
  const collect = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && ['has', 'includes', 'test'].includes(n.expression.name.text)) {
      const arg = n.arguments[0];
      const recv = n.expression.expression;
      if (arg && readsType(arg)) {
        const c = containerOf(recv);
        if (typeof c === 'string') typeTested.add(c);
        else if (c) inlineTested.push(c);
      }
      // `list.some((t) => t === x.type)` and the like are comparisons, found below.
    }
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && queries.has(n.expression.text)) {
      for (const a of n.arguments) {
        const c = containerOf(a);
        if (typeof c === 'string') typeTested.add(c);
        else if (c) inlineTested.push(c);
      }
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
    // `n.type.endsWith('_substitution')`: a part of a node type, which names a group of the word-part types.
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && ['endsWith', 'startsWith'].includes(n.expression.name.text) && readsType(n.expression.expression) && n.arguments.length) {
      const l = literalText(n.arguments[0]);
      const ends = n.expression.name.text === 'endsWith';
      if (l !== undefined && l.length >= 3 && [...NODE_TYPES].some((t) => (ends ? t.endsWith(l) : t.startsWith(l)))) add(n, 'node-type', `${n.expression.name.text}:${l}`);
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
  return found;
}

/** The matches of every src/**\/*.ts outside the allow-list. */
export const scanAll = (): Match[] => scanDirs(['src'], ALLOWED, scanSource);

/** The matches counted per file, function and kind (the known list's grain). */
export const counted = (matches: readonly Match[]): { file: string; fn: string; kind: Kind; count: number }[] => countedAny(matches);

if (require.main === module) console.log(JSON.stringify(counted(scanAll()), null, 1));
