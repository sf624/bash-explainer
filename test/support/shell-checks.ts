import * as ts from 'typescript';
import { LETTER } from '../../src/shellfeatures';
import { bare, counted as countedAny, enclosing, lineOf, literalText, parseSource, scanDirs, type Match as MatchOf } from './scan';

// The scan behind test/shell-checks.test.ts (docs/design/sources.md, row 9, step SC6): where code decides by a shell's name what the
// script's shell does, instead of asking the table of src/shellfeatures.ts (the features and builtins of `FEATURES`, the behaviours of
// `SHELL_BEHAVIOURS`, and `isBash`, `shellsOf`, `wordsFollowed` over them). It is syntactic (no type checker), so the guard runs in a
// fraction of a second. `npx tsx test/support/shell-checks.ts` prints the matches as the known list's entries (counts per file,
// function and kind), `--lines` the places.

export type Kind = 'compare' | 'case' | 'member' | 'list';
export type Match = MatchOf<Kind>;

/** The directories that are scanned. */
export const DIRS: readonly string[] = ['src', 'cli', 'web'];

/** Files (or directories, ending in `/`) that are the table: their matches are not counted. */
export const ALLOWED: readonly string[] = ['src/shellfeatures.ts'];

/** The names of the shells a script can be written for (`Shell`, src/shellfeatures.ts). */
export const SHELL_NAMES: ReadonlySet<string> = new Set([...Object.keys(LETTER), 'sh']);

/** Whether an expression names a script's shell: `shell`, `sh`, `x.shell` (`cx.shell`, `opts.shell`, `cx.state.shell`), with `!` and parentheses. */
export function namesShell(e: ts.Expression): boolean {
  e = bare(e);
  if (ts.isIdentifier(e)) return e.text === 'shell' || e.text === 'sh';
  return ts.isPropertyAccessExpression(e) && e.name.text === 'shell';
}

const isShellLiteral = (e: ts.Expression): boolean => SHELL_NAMES.has(literalText(bare(e)) ?? '');
const EQUALITY = new Set([ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken]);
const MEMBERSHIP = new Set(['includes', 'has', 'indexOf']);

/** The matches of one source file, `rel` being its path from the repo root. */
export function scanSource(rel: string, text: string): Match[] {
  const sf = parseSource(rel, text);
  const found: Match[] = [];
  const add = (n: ts.Node, kind: Kind, what: string): void => {
    found.push({ file: rel, fn: enclosing(n), kind, what, line: lineOf(n) });
  };
  const visit = (n: ts.Node): void => {
    if (ts.isBinaryExpression(n) && EQUALITY.has(n.operatorToken.kind)) {
      // `shell === 'sh'`, `'zsh' !== cx.shell`.
      const [lit, other] = isShellLiteral(n.right) ? [n.right, n.left] : [n.left, n.right];
      if (isShellLiteral(lit) && namesShell(other)) add(n, 'compare', n.getText().slice(0, 60));
    } else if (ts.isCaseClause(n) && isShellLiteral(n.expression) && namesShell((n.parent.parent as ts.SwitchStatement).expression)) {
      add(n, 'case', literalText(bare(n.expression))!);
    } else if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && MEMBERSHIP.has(n.expression.name.text) && n.arguments.some((a) => namesShell(a))) {
      // `COMMON_SH.includes(shell)`, `new Set(['dash', 'ash']).has(cx.shell)`.
      add(n, 'member', n.getText().slice(0, 60));
    } else if (ts.isArrayLiteralExpression(n) && n.elements.length >= 2 && n.elements.every((e) => isShellLiteral(e as ts.Expression))) {
      // `['dash', 'ash']`: a list of shells written out.
      add(n, 'list', n.getText().slice(0, 60));
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}

/** The matches of every file of the scanned directories outside the allow-list. */
export const scanAll = (): Match[] => scanDirs(DIRS, ALLOWED, scanSource);

/** The matches counted per file, function and kind (the known list's grain). */
export const counted = (matches: readonly Match[]): { file: string; fn: string; kind: Kind; count: number }[] => countedAny(matches);

if (require.main === module) {
  if (process.argv.includes('--lines')) for (const m of scanAll()) console.log(`${m.file}:${m.line} ${m.fn} ${m.kind} ${m.what}`);
  else console.log(JSON.stringify(counted(scanAll()), null, 1));
}
