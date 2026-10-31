import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

// The parts that the source guards share (docs/design/sources.md, stage SA): test/word-source.test.ts, test/command-reading.test.ts and the
// guards after it. Each guard walks the TypeScript sources syntactically (no type checker, so it runs in a fraction of a second), finds
// what it looks for, names the function around it, counts per file, function and kind, and compares the counts with a known list that may
// only shrink (a new match, a larger count and a stale entry all fail).

export const base = path.join(__dirname, '..', '..');

/** A match: the file (from the repo root), the outermost named function around it, the kind of the rule, and what was found. */
export interface Match<K extends string = string> {
  file: string;
  /** The outermost named function, method or top-level `const` around the match ('<module>' for a bare statement). */
  fn: string;
  kind: K;
  /** The node type, helper, regex or identifier that was found. */
  what: string;
  /** The line of the match (1-based), for the printed listing; the known lists do not use it. */
  line?: number;
}

/** Files (or directories, ending in `/`) that a guard leaves out, as paths from the repo root. */
export const isAllowed = (allowed: readonly string[], rel: string): boolean => allowed.some((a) => (a.endsWith('/') ? rel.startsWith(a) : rel === a));

/**
 * Every file with the extension `ext` under `dir` (from the repo root) that the repository tracks or would track (not ignored): never a
 * built bundle (`cli/dist/`) or `node_modules/`, which a maintainer's checkout has and CI's may not. Absolute paths, in path order.
 */
export function sourceFiles(dir: string, ext = '.ts'): string[] {
  const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', dir], { cwd: base, encoding: 'utf8', maxBuffer: 1 << 26 });
  return [...new Set(out.split('\0'))].filter((f) => f.endsWith(ext)).sort().map((f) => path.join(base, f)).filter((f) => fs.existsSync(f));
}

/** The matches of every `.ts` file under the directories `dirs` (from the repo root), outside `allowed`, in path order. */
export function scanDirs<K extends string>(dirs: readonly string[], allowed: readonly string[], scan: (rel: string, text: string) => Match<K>[]): Match<K>[] {
  const out: Match<K>[] = [];
  for (const dir of dirs) {
    for (const f of sourceFiles(dir)) {
      const rel = path.relative(base, f).split(path.sep).join('/');
      if (!isAllowed(allowed, rel)) out.push(...scan(rel, fs.readFileSync(f, 'utf8')));
    }
  }
  return out;
}

/** The 1-based line of a node. */
export const lineOf = (n: ts.Node): number => n.getSourceFile().getLineAndCharacterOfPosition(n.getStart()).line + 1;

export const parseSource = (rel: string, text: string): ts.SourceFile => ts.createSourceFile(rel, text, ts.ScriptTarget.ES2022, true);

/** An expression without its parentheses, `as`, `satisfies` and `!`. */
export const bare = (e: ts.Expression): ts.Expression => {
  while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e) || ts.isNonNullExpression(e)) e = e.expression;
  return e;
};
/** The text of a string literal (or a template without substitutions), or undefined for any other node. */
export const literalText = (e: ts.Node): string | undefined => (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e) ? e.text : undefined);
/** The source of a regex literal (without its flags), or of `new RegExp('…')` of a literal. */
export function regexSource(e: ts.Expression): string | undefined {
  e = bare(e);
  if (ts.isRegularExpressionLiteral(e)) return e.text.slice(1, e.text.lastIndexOf('/'));
  if (ts.isNewExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === 'RegExp' && e.arguments?.length) return literalText(e.arguments[0]);
  return undefined;
}

/** The name of a function-like or declaration node, if it has one. */
const nameOf = (n: ts.Node): string | undefined => {
  if ((ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n) || ts.isClassDeclaration(n)) && n.name) return n.name.getText();
  if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)) return n.name.text;
  if (ts.isPropertyAssignment(n) && ts.isIdentifier(n.name)) return n.name.text;
  return undefined;
};
/** The outermost named function, method or top-level `const` around a node ('<module>' for a bare statement); the file needs its parent links. */
export function enclosing(n: ts.Node): string {
  let name = '<module>';
  for (let p: ts.Node | undefined = n.parent; p && !ts.isSourceFile(p); p = p.parent) {
    // A class holds methods: the method is the name, not the class.
    const own = nameOf(p);
    if (own !== undefined && !ts.isClassDeclaration(p)) name = own;
    else if (own !== undefined && name === '<module>') name = own;
  }
  return name;
}

/** The matches counted per file, function and kind (the known lists' grain). */
export function counted<K extends string>(matches: readonly Match<K>[]): { file: string; fn: string; kind: K; count: number }[] {
  const by = new Map<string, { file: string; fn: string; kind: K; count: number }>();
  for (const m of matches) {
    const key = `${m.file}\0${m.fn}\0${m.kind}`;
    const e = by.get(key) ?? { file: m.file, fn: m.fn, kind: m.kind, count: 0 };
    e.count++;
    by.set(key, e);
  }
  return [...by.values()];
}

/** The key of a known-list entry. */
export const keyOf = (file: string, fn: string, kind: string): string => `${file} ${fn} ${kind}`;

/**
 * The problems of a scan against a known list (both as counts per `keyOf`): a match that is not listed (NEW), more matches than listed
 * (MORE), and a listed count that is higher than the matches found (STALE). `fix` tells what to do about a new match.
 */
export function compareKnown(actual: ReadonlyMap<string, number>, listed: ReadonlyMap<string, number>, fix: string): string[] {
  const problems: string[] = [];
  for (const [k, n] of actual) {
    const have = listed.get(k);
    if (have === undefined) problems.push(`NEW: ${k} (${n}): ${fix}`);
    else if (n > have) problems.push(`MORE: ${k} has ${n} matches, ${have} are listed`);
  }
  for (const [k, have] of listed) {
    const n = actual.get(k) ?? 0;
    if (n < have) problems.push(`STALE: ${k} lists ${have}, ${n} found: lower the count or remove the entry`);
  }
  return problems;
}
