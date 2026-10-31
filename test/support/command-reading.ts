import * as ts from 'typescript';
import { bare, counted as countedAny, enclosing, lineOf, literalText, parseSource, regexSource, scanDirs, type Match as MatchOf } from './scan';

// The scan behind test/command-reading.test.ts (docs/design/sources.md, row 2, stage SA, step SA2): where src/ reads how a command
// takes its words (which are options, which are values, which are operands) without the argument interpreter (src/argv/interpret.ts),
// by calling it again or by looking at a word's text for a dash. It is syntactic, so the guard runs in a fraction of a second.
// `npx tsx test/support/command-reading.ts` prints the matches as the known list's entries (counts per file, function and kind).

export type Kind = 'interpret-call' | 'option-regex' | 'dash-prefix';
export type Match = MatchOf<Kind>;

/** Files (or directories, ending in `/`) where options are read legitimately, or where no command's options are: their matches are not counted. */
export const ALLOWED: readonly string[] = [
  // The source: the interpreter, the specs it reads, and the readers of other languages' options (the embedded programs).
  'src/argv/',
  'src/dict/',
  'src/embedded/',
  // The parser's adapter reads the syntax of `[[ -f x ]]` and the like (its operators are not a command's options).
  'src/syntax/adapters/',
  // Other languages: the dash there is an operator or part of a pattern, not an option.
  ...['jq', 'awk', 'sed', 'perlrun', 'yaml', 'regex'].map((n) => `src/examples/${n}.ts`),
  'src/arith.ts',
  'src/semantics/walk/arith.ts',
];

/** Whether a regex source starts (after `^`, groups and alternatives) with a literal dash that is not a sign: `^-`, `^--`, `^(?:-|--)`, `^-[a-z]*r`. */
export function optionRegex(source: string): boolean {
  if (!source.startsWith('^')) return false;
  let i = 1;
  while (source.startsWith('(?:', i) || source.startsWith('(', i)) i += source.startsWith('(?:', i) ? 3 : 1;
  if (source[i] !== '-') return false;
  // `^-?0\d`, `^-\d+$` and `^-$` read a number's sign or a lone dash, not an option.
  const next = source.slice(i + 1, i + 3);
  return !(next[0] === '?' || next === '\\d' || (next[0] === '$' && i + 2 === source.length));
}

/** The matches of one source file, `rel` being its path from the repo root. */
export function scanSource(rel: string, text: string): Match[] {
  const sf = parseSource(rel, text);
  const found: Match[] = [];
  const add = (n: ts.Node, kind: Kind, what: string): void => {
    found.push({ file: rel, fn: enclosing(n), kind, what, line: lineOf(n) });
  };
  const visit = (n: ts.Node): void => {
    // `interpret(spec, words, …)` and `ns.interpret(…)`.
    if (ts.isCallExpression(n)) {
      const callee = ts.isIdentifier(n.expression) ? n.expression.text : ts.isPropertyAccessExpression(n.expression) ? n.expression.name.text : undefined;
      if (callee === 'interpret') add(n, 'interpret-call', 'interpret');
      // `w.startsWith('-')`, `w.startsWith('--')`.
      if (callee === 'startsWith' && n.arguments.length) {
        const l = literalText(bare(n.arguments[0]));
        if (l !== undefined && l.startsWith('-')) add(n, 'dash-prefix', `startsWith:${l}`);
      }
    }
    // `/^-[a-z]*r/.test(w.text)`: a regex anchored at a dash, as a literal or `new RegExp('…')`.
    if (ts.isRegularExpressionLiteral(n) || ts.isNewExpression(n)) {
      const src = regexSource(n as ts.Expression);
      if (src !== undefined && optionRegex(src)) add(n, 'option-regex', `/${src}/`);
    }
    // `w === '--'`, `w !== '--'`; `w[0] === '-'`, `w.charAt(0) === '-'`.
    if (ts.isBinaryExpression(n) && [ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(n.operatorToken.kind)) {
      const sides: [ts.Expression, ts.Expression][] = [[n.left, n.right], [n.right, n.left]];
      for (const [lit, other] of sides) {
        const l = literalText(bare(lit));
        const o = bare(other);
        if (l === '--') add(n, 'dash-prefix', "=== '--'");
        else if (l === '-' && ((ts.isElementAccessExpression(o) && ts.isNumericLiteral(o.argumentExpression) && o.argumentExpression.text === '0') || (ts.isCallExpression(o) && ts.isPropertyAccessExpression(o.expression) && o.expression.name.text === 'charAt' && o.arguments.length === 1 && ts.isNumericLiteral(o.arguments[0]) && o.arguments[0].text === '0'))) add(n, 'dash-prefix', "[0] === '-'");
        else continue;
        break;
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}

/** The matches of every src/**\/*.ts outside the allow-list. */
export const scanAll = (): Match[] => scanDirs(['src'], ALLOWED, scanSource);

/** The matches counted per file, function and kind (the known list's grain). */
export const counted = (matches: readonly Match[]): { file: string; fn: string; kind: Kind; count: number }[] => countedAny(matches);

if (require.main === module) {
  if (process.argv.includes('--lines')) for (const m of scanAll()) console.log(`${m.file}:${m.line} ${m.fn} ${m.kind} ${m.what}`);
  else console.log(JSON.stringify(counted(scanAll()), null, 1));
}
