// Tokens refine commands (docs/design/syntax-tree.md, "How it is checked"): every token of an explanation has
// exactly one innermost enclosing command of our tree, it does not cross the boundary of another command, and that
// command is one of bash's, as bash-ast (https://github.com/cv/bash-ast) parses the same text.
//
// GPL boundary: bash-ast is GPL-3.0 and this project is MIT. As in test/bash-ast.test.ts, it is only run as an
// external program (test/support/bashast.ts), from $BASH_AST or PATH; without it, this test is skipped, and with
// BASH_EXPLAINER_BASH_AST=1 (CI) a missing binary fails it.
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { Analyzer, isBlockLike } from '../src/analyzer';
import type { Token } from '../src/analyzer';
import { detectShell } from '../src/dialect';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import type { SyntaxNode } from '../src/syntax/tree';
import { hasError } from '../src/syntax/tree';
import { corpus } from './support/corpus';
import { findBashAst, runBashAst, shapeOfAst } from './support/bashast';
import type { Shape } from './support/shape';
import { diffShapes, shapeOfTree } from './support/shape';

interface Known { input: string; token: string; problem: string; reason: string }
const knownFile = path.join(__dirname, 'fixtures/command-tokens-known.json');
const bin = findBashAst();

// As in test/bash-ast.test.ts: bash-ast parses with extglob off.
const EXTGLOB = /[?*+@!]\(/;
const SUBSTITUTIONS = new Set(['command_substitution', 'process_substitution']);

/** Every object of a shape (or of anything JSON-like) by its path, as `diffShapes` writes paths. */
function byPath(v: unknown, at = '$', out = new Map<string, unknown>()): Map<string, unknown> {
  if (Array.isArray(v)) v.forEach((x, i) => byPath(x, `${at}[${i}]`, out));
  else if (v && typeof v === 'object') {
    out.set(at, v);
    for (const [k, x] of Object.entries(v)) byPath(x, `${at}.${k}`, out);
  }
  return out;
}

/** The strings of a command of a shape (its words, assignments, redirections…), not those of the commands in it. */
function stringsOf(s: Shape): string[] {
  const out: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object' && !('k' in v)) Object.values(v).forEach(walk);
  };
  for (const [k, v] of Object.entries(s)) if (k !== 'k') walk(v);
  return out;
}
/** bash-ast prints a substitution again as bash would: compare without blanks and semicolons. */
const bare = (s: string): string => s.replace(/[\s;]+/g, '');

/** All tokens of an explanation and their children. */
const allTokens = (ts: readonly Token[]): Token[] => ts.flatMap((t) => [t, ...allTokens(t.children)]);

function descendants(n: SyntaxNode, out: SyntaxNode[] = []): SyntaxNode[] {
  out.push(n);
  for (const c of n.children) descendants(c, out);
  return out;
}

const effEndRow = (n: SyntaxNode): number =>
  n.endPosition.column === 0 && n.endPosition.row > n.startPosition.row ? n.endPosition.row - 1 : n.endPosition.row;

/**
 * The rows that only continue a statement explained whole on its first line (a statement over several lines that
 * is not a block, as `sub` in src/analyzer.ts explains it): those of its later rows on which nothing else starts.
 */
function continuationRows(root: SyntaxNode): Set<number> {
  const whole: SyntaxNode[] = [];
  const walk = (n: SyntaxNode): void => {
    for (const c of n.namedChildren) {
      if (isBlockLike(c)) walk(c);
      else if (effEndRow(c) > c.startPosition.row) whole.push(c);
    }
  };
  walk(root);
  const rows = new Set<number>();
  const leaves = descendants(root).filter((n) => !n.children.length && n.endIndex > n.startIndex);
  for (const s of whole) {
    for (let r = s.startPosition.row + 1; r <= effEndRow(s); r++) {
      const starting = leaves.filter((l) => l.startPosition.row === r);
      if (starting.every((l) => l.startIndex >= s.startIndex && l.endIndex <= s.endIndex)) rows.add(r);
    }
  }
  return rows;
}

describe('command tokens: the helpers (no bash-ast needed)', () => {
  const parse = (text: string) => createUnbashParser().parse(text);

  it('records the nodes each command of the shape comes from, wrappers with their command', () => {
    const tree = parse('! a | b; { c; } >o; time d 2>e; ! { f; }');
    const from = new Map<Shape, SyntaxNode[]>();
    const paths = [...byPath(shapeOfTree(tree.root, from))].flatMap(([p, s]) => (from.get(s as Shape) ?? []).map((n) => `${p} ${n.type} ${n.text}`));
    assert.deepEqual(paths, [
      '$.items[0].cmd pipeline a | b',
      '$.items[0].cmd negated_command ! a | b',
      '$.items[0].cmd.stages[0] command a',
      '$.items[0].cmd.stages[1] command b',
      '$.items[1].cmd compound_statement { c; }',
      '$.items[1].cmd redirected_statement { c; } >o',
      '$.items[1].cmd.body command c',
      '$.items[2].cmd command d',
      '$.items[2].cmd redirected_statement d 2>e',
      '$.items[2].cmd time_statement time d 2>e',
      '$.items[3].cmd compound_statement { f; }',
      '$.items[3].cmd negated_command ! { f; }',
      '$.items[3].cmd.body command f',
    ]);
  });

  it('skips the later lines of a statement explained whole, unless something else starts there', () => {
    assert.deepEqual([...continuationRows(parse('echo a \\\n  b\nif x; then\n  y \\\n  z; w\nfi\ncat <<E\nbody\nE\n').root)], [1, 7, 8]);
  });

  it('keeps the strings of a command, not those of the commands in it', () => {
    const s = shapeOfTree(parse('for x in a "$(b)"; do c; done >o').root)!;
    assert.deepEqual(stringsOf(s), ['x', 'a', '"$(b)"', '>', 'o']);
  });
});

describe('command tokens: each token of an explanation lies in one command of bash\'s', function () {
  before(function () {
    if (!bin && process.env.BASH_EXPLAINER_BASH_AST) assert.fail('BASH_EXPLAINER_BASH_AST is set, but bash-ast cannot be run (see $BASH_AST)');
    if (!bin) this.skip();
  });

  it('finds one innermost command for every token, and bash-ast has it, except the known findings', function () {
    this.timeout(300000);
    const started = Date.now();
    const ub = createUnbashParser();
    const analyzer = new Analyzer('en');
    const { files, snippets } = corpus();
    const known: Known[] = JSON.parse(fs.readFileSync(knownFile, 'utf8'));
    const used = new Set<Known>();
    const counts = { inputs: 0, lines: 0, tokens: 0, inSubstitution: 0, inHeredoc: 0, separators: 0, known: 0, shapeDiffers: 0, skipped: {} as Record<string, number> };
    const skip = (why: string): void => { counts.skipped[why] = (counts.skipped[why] ?? 0) + 1; };
    const fresh: string[] = [];
    const inputs = [...files.map((f) => ({ ...f, key: f.name })), ...snippets.map((s) => ({ ...s, key: s.text }))];
    for (const input of inputs) {
      const shell = detectShell(input.text, input.name);
      if (shell === 'zsh' || shell === 'ksh' || shell === 'mksh') { skip('dialect'); continue; }
      if (EXTGLOB.test(input.text)) { skip('extglob'); continue; }
      const tree = ub.parse(input.text);
      if (hasError(tree.root) || tree.errors.length > 0) { skip('error'); continue; }
      // (A CRLF script is read through its masked text, by both parsers.)
      const text = tree.text;
      const r = runBashAst(bin!, text);
      if (!r.ok) { skip('bash-ast'); continue; }
      const from = new Map<Shape, SyntaxNode[]>();
      const ours = shapeOfTree(tree.root, from);
      if (!ours) { skip('empty'); continue; }
      counts.inputs++;
      const theirs = shapeOfAst(r.ast);
      const bashAt = byPath(theirs);
      // Where the shapes differ in kind or length, the paths below are not comparable: the shape test lists those.
      const unsure = diffShapes(ours, theirs).filter((d) => /\.(kind|length)$/.test(d.path)).map((d) => d.path.replace(/\.(kind|length)$/, ''));
      const pathOf = new Map<SyntaxNode, string>();
      const shapeOf = new Map<SyntaxNode, Shape>();
      for (const [p, s] of byPath(ours)) {
        for (const n of from.get(s as Shape) ?? []) { pathOf.set(n, p); shapeOf.set(n, s as Shape); }
      }
      const all = descendants(tree.root);
      // The commands in `$( )`, `<( )` and backquotes: ours only (bash-ast keeps their text in a word).
      const inner = new Map<Shape, SyntaxNode[]>();
      for (const s of all.filter((n) => SUBSTITUTIONS.has(n.type))) shapeOfTree(s, inner);
      const commands = [...pathOf.keys(), ...[...inner.values()].flat()];
      const bodies = all.filter((n) => n.type === 'heredoc_body');
      const lineStarts = [0];
      for (let i = 0; i < text.length; i++) if (text[i] === '\n') lineStarts.push(i + 1);
      const offset = (p: { line: number; character: number }): number => lineStarts[p.line] + p.character;
      const report = (token: string, problem: string): void => {
        const k = known.find((e) => e.input === input.key && e.token === token && e.problem === problem);
        if (k) { used.add(k); counts.known++; return; }
        fresh.push(`${input.name}\n  ${token}: ${problem}`);
      };
      const holds = (c: SyntaxNode, a: number, b: number): boolean => c.startIndex <= a && b <= c.endIndex;
      const innermost = (cs: SyntaxNode[], a: number, b: number): SyntaxNode | undefined =>
        cs.filter((c) => holds(c, a, b)).sort((x, y) => (x.endIndex - x.startIndex) - (y.endIndex - y.startIndex))[0];
      /** Whether bash-ast has the command at this path; undefined when the shapes differ there (skipped). */
      const inBash = (p: string, s: Shape): boolean | undefined => {
        const b = bashAt.get(p) as Shape | undefined;
        if (b && b.k === s.k) return true;
        if (unsure.some((u) => p === u || p.startsWith(`${u}.`) || p.startsWith(`${u}[`))) return undefined;
        return false;
      };

      const skipRows = continuationRows(tree.root);
      const seen = new Set<string>();
      for (let line = 0; line < lineStarts.length; line++) {
        if (skipRows.has(line)) continue;
        counts.lines++;
        for (const t of allTokens(analyzer.explainLine(tree, line, shell).items)) {
          if (t.kind === 'comment') continue;
          let a = offset(t.span.start);
          let b = offset(t.span.end);
          const name = `${t.label} (${t.span.start.line + 1}:${t.span.start.character + 1})`;
          const id = `${a}:${b}:${t.label}`;
          if (seen.has(id)) continue;
          seen.add(id);
          counts.tokens++;
          // A token in a here-document's body belongs to the command of its redirection.
          const body = bodies.find((h) => holds(h, a, b));
          if (body) { a = body.parent!.startIndex; b = a + 1; counts.inHeredoc++; }
          // (A command inside the token is fine: a token of a list, a pipeline, a block holds its commands.)
          const crossed = commands.find((c) => c.startIndex < b && a < c.endIndex && !holds(c, a, b) && !(a <= c.startIndex && c.endIndex <= b));
          if (crossed) { report(name, `crosses the ${crossed.type} at ${crossed.startIndex}`); continue; }
          const own = innermost(commands, a, b);
          if (!own) {
            // `;` and `&` between the statements of the script belong to its sequence (bash's connection), not to a node of ours.
            if (t.label === ';' || t.label === '&') counts.separators++;
            else report(name, 'in no command');
            continue;
          }
          // A command in `$( )`, `<( )` or backquotes is ours only: its substitution lies in one word of bash's command.
          let sub: SyntaxNode | undefined;
          for (let p = own.parent; p; p = p.parent) if (SUBSTITUTIONS.has(p.type)) sub = p;
          const outer = sub ? innermost(commands.filter((c) => !holds(sub!, c.startIndex, c.endIndex)), sub.startIndex, sub.endIndex) : own;
          if (!outer) { report(name, 'its substitution is in no command'); continue; }
          const p = pathOf.get(outer)!;
          const ok = inBash(p, shapeOf.get(outer)!);
          if (ok === undefined) { counts.shapeDiffers++; continue; }
          if (!ok) { report(name, `bash-ast has no ${shapeOf.get(outer)!.k} command at ${p}`); continue; }
          if (sub) {
            counts.inSubstitution++;
            const words = stringsOf(bashAt.get(p) as Shape).map(bare);
            if (!words.some((w) => w.includes(bare(sub!.text)))) report(name, `its substitution is in no word of bash-ast's command at ${p}`);
          }
        }
      }
    }
    console.log(`      command tokens: ${counts.inputs} inputs, ${counts.lines} lines, ${counts.tokens} tokens (${counts.inSubstitution} in a substitution, ${counts.inHeredoc} in a here-document, ${counts.separators} separators of the script, ${counts.shapeDiffers} where the shapes differ), skipped ${JSON.stringify(counts.skipped)}, ${counts.known} known, ${fresh.length} new, in ${((Date.now() - started) / 1000).toFixed(1)} s`);
    const stale = known.filter((k) => !used.has(k)).map((k) => `stale: ${JSON.stringify(k.input).slice(0, 80)} ${k.token}: ${k.problem}`);
    assert.deepEqual([...fresh, ...stale], []);
  });
});
