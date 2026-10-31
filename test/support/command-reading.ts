import * as ts from 'typescript';
import { bare, counted as countedAny, enclosing, lineOf, literalText, parseSource, regexSource, scanDirs, type Match as MatchOf } from './scan';

// The scan behind test/command-reading.test.ts (docs/design/sources.md, row 2, stage SA, step SA2): where src/ reads how a command
// takes its words (which are options, which are values, which are operands) without the argument interpreter (src/argv/interpret.ts),
// by calling it again or by looking at a word's text for a dash. It is syntactic, so the guard runs in a fraction of a second.
// `npx tsx test/support/command-reading.ts` prints the matches as the known list's entries (counts per file, function and kind).

export type Kind = 'interpret-call' | 'option-regex' | 'dash-prefix' | 'option-literal';
export type Match = MatchOf<Kind>;

/** Files (or directories, ending in `/`) where options are read legitimately, or where no command's options are: their matches are not counted. */
export const ALLOWED: readonly string[] = [
  // The source: the interpreter, the specs it reads, and the readers of other languages' options (the embedded programs).
  'src/argv/',
  'src/dict/',
  // The embedded programs' own options and operators (src/embedded/): find's primaries (`-print0`), awk's and arith's `--`, getopt's option
  // strings, regex and glob syntax. `yq.ts` is not here: `judgeYq` hand-parses yq's own options, so it is listed as an offender.
  ...['arith', 'awk', 'find', 'format', 'getopt', 'getopts', 'gitformat', 'glob', 'jq', 'mode', 'perl', 'prompt', 'regex', 'registry', 'sed', 'textutils', 'types', 'yqfuncs'].map((n) => `src/embedded/${n}.ts`),
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

/** Whether a string is an option spelled out: a dash or two, then a letter (`-r`, `--posix`, `-print0`), not a sign, a number or `--`. */
export const isOptionLiteral = (l: string): boolean => /^--?[A-Za-z][\w-]*$/.test(l);

/** The names of the interpreter's results and of the test operators: comparing one of them with `-x` reads no word. */
const RESULT_NAMES = new Set(['flag', 'flags', 'of', 'names', 'op', 'role', 'spec']);
/** Whether an expression is such a result: `flag`, `o.flag`, `role.kind`, `spec.name`, `x.op`. */
function interpreterResult(e: ts.Expression): boolean {
  e = bare(e);
  if (ts.isIdentifier(e)) return RESULT_NAMES.has(e.text);
  if (ts.isPropertyAccessExpression(e)) return RESULT_NAMES.has(e.name.text) || interpreterResult(e.expression);
  if (ts.isElementAccessExpression(e)) return interpreterResult(e.expression);
  return false;
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
      // `w.includes('-x')`, `['-r', '-R'].includes(w)`: an option spelled out and looked for in a word, or a word in a list of options.
      if (callee === 'includes' && ts.isPropertyAccessExpression(n.expression) && n.arguments.length) {
        const recv = bare(n.expression.expression);
        const l = literalText(bare(n.arguments[0]));
        if (l !== undefined && isOptionLiteral(l)) {
          if (!interpreterResult(recv)) add(n, 'option-literal', `includes:${l}`);
        } else if (ts.isArrayLiteralExpression(recv) && !interpreterResult(n.arguments[0])) {
          const t = recv.elements.map((e) => literalText(bare(e))).find((x) => x !== undefined && isOptionLiteral(x));
          if (t !== undefined) add(n, 'option-literal', `includes:[${t}…]`);
        }
      }
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
        if (l !== undefined && isOptionLiteral(l)) {
          // `w.text === '-r'`, `words[i] !== '-S'`, `n === '--posix'`; not the interpreter's results (`flag === '-r'`) or a test operator.
          if (interpreterResult(other)) continue;
          add(n, 'option-literal', `=== ${l}`);
        } else if (l === '--') add(n, 'dash-prefix', "=== '--'");
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
