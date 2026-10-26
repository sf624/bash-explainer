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
import { commandLists, hasError } from '../src/syntax/tree';
import { corpus } from './support/corpus';
import { findBashAst, runBashAst, shapeOfAst } from './support/bashast';
import type { Shape } from './support/shape';
import { diffShapes, shapeOfTree } from './support/shape';

interface Finding { input: string; token: string; problem: string; reason: string }
/** What the test expects: the counts it pins (update them deliberately) and the findings it accepts, with reasons. */
interface Known {
  counts: { skipped: Record<string, number>; shapesDiffer: number; inSubstitution: number; inHeredoc: number };
  findings: Finding[];
}
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
 * is not a block, as `sub` of src/explain/context.ts explains it): those of its later rows on which nothing else starts.
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
      '$.items[2].cmd command d 2>e',
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

/** The inputs added for this test: they feed snippets.json (scripts/extract-snippets.ts), and so the corpus. */
describe('command tokens: inputs for the corpus', () => {
  it('parses redirections next to `&&` and `||`, here-documents before other commands, and here-documents in `$( )`', () => {
    const parser = createUnbashParser();
    const trees = [
      parser.parse('a > f && b'),
      parser.parse('a 2>e || b >>f'),
      parser.parse('>o a && b <i | c'),
      parser.parse('{ a; } >o && b 2>&1'),
      parser.parse('cat <<E && echo b\nx\nE\necho c'),
      parser.parse('cat <<E | grep x; echo d\nbody $v\nE\nwc -l <<-F\n\tt\n\tF'),
      parser.parse('x=$(cat <<E\nhi $y\nE\n); echo "$x"'),
      parser.parse('echo "$(a > f && b | c)" <(d 2>&1) `e | f`'),
    ];
    assert.deepEqual(trees.filter((t) => hasError(t.root) || t.errors.length), []);
  });
});

/** The node a command's words lie in: the script, or the substitution it runs in (a script of its own to bash). */
function scopeOf(n: SyntaxNode): SyntaxNode {
  let p = n.parent!;
  while (p.parent && !SUBSTITUTIONS.has(p.type)) p = p.parent;
  return p;
}

/** bash removes the backslashes before `\`, `` ` `` and `$` in backquotes before it parses the text. */
const unescapeBackquoted = (t: string): string => t.replace(/\\([\\`$])/g, '$1');

/** Change every string of a shape (in place), and the line of each simple command. */
function rewrite(v: unknown, str: (s: string) => string, line: (l: number) => number): void {
  if (Array.isArray(v)) v.forEach((x, i) => { if (typeof x === 'string') v[i] = str(x); else rewrite(x, str, line); });
  else if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    for (const [k, x] of Object.entries(o)) {
      if (typeof x === 'string' && k !== 'k' && k !== 'c' && k !== 'op') o[k] = str(x);
      else if (k === 'line' && typeof x === 'number') o[k] = line(x);
      else rewrite(x, str, line);
    }
  }
}

/** A script to bash: the whole input, or the text of a substitution, with its shapes and the commands in it. */
interface Scope {
  node: SyntaxNode;
  name: string;
  /** Where the text bash parses starts and ends in the input. */
  from: number;
  to: number;
  /** Our commands directly in it, by their path in its shape. */
  pathOf: Map<SyntaxNode, string>;
  shapeOf: Map<SyntaxNode, Shape>;
  bashAt: Map<string, unknown>;
  /** Whether the shapes differ (its tokens are not compared with bash-ast then). */
  differs: boolean;
}

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
    const known: Known = JSON.parse(fs.readFileSync(knownFile, 'utf8'));
    const used = new Set<Finding>();
    const counts = { inputs: 0, scripts: 0, lines: 0, tokens: 0, separators: 0, lists: 0, known: 0 };
    const pinned: Known['counts'] = { skipped: {}, shapesDiffer: 0, inSubstitution: 0, inHeredoc: 0 };
    const skip = (why: string): void => { pinned.skipped[why] = (pinned.skipped[why] ?? 0) + 1; };
    const fresh: string[] = [];
    const inputs = [...files.map((f) => ({ ...f, key: f.name })), ...snippets.map((s) => ({ ...s, key: s.text }))];
    for (const input of inputs) {
      const shell = detectShell(input.text, input.name);
      if (shell === 'zsh' || shell === 'ksh' || shell === 'mksh') { skip('dialect'); continue; }
      if (EXTGLOB.test(input.text)) { skip('extglob'); continue; }
      const tree = ub.parse(input.text);
      if (hasError(tree.root) || tree.errors.length > 0) { skip('error'); continue; }
      // A CRLF script is read through its masked text (each CR before a LF a space, as the tree has it), by both parsers.
      const text = tree.text.replace(/\r(?=\n)/g, ' ');
      const report = (token: string, problem: string): void => {
        const k = known.findings.find((e) => e.input === input.key && e.token === token && e.problem === problem);
        if (k) { used.add(k); counts.known++; return; }
        fresh.push(`${input.name}\n  ${token}: ${problem}`);
      };
      const lineStarts = [0];
      for (let i = 0; i < text.length; i++) if (text[i] === '\n') lineStarts.push(i + 1);
      const offset = (p: { line: number; character: number }): number => lineStarts[p.line] + p.character;
      const rowOf = (i: number): number => lineStarts.filter((s) => s <= i).length - 1;
      const all = descendants(tree.root);
      // The lists of commands the explanations show (`;` and `&` joining statements: bash's connections).
      const lists = all.flatMap(commandLists);

      // Each script bash parses: the input, and the text of each substitution (bash parses it again, in the child).
      const top = runBashAst(bin!, text);
      if (!top.ok) { skip('bash-ast'); continue; }
      const scopes = new Map<SyntaxNode, Scope>();
      let empty = false;
      for (const node of [tree.root, ...all.filter((n) => SUBSTITUTIONS.has(n.type))]) {
        const isTop = node === tree.root;
        const from = isTop ? 0 : node.children[0].endIndex;
        const to = isTop ? text.length : node.children[node.children.length - 1].startIndex;
        const backquoted = !isTop && node.children[0].type === '`';
        const origins = new Map<Shape, SyntaxNode[]>();
        const ours = shapeOfTree(node, origins);
        if (isTop && !ours) { empty = true; break; }
        const name = isTop ? 'the script' : `the substitution ${node.text.split('\n')[0].slice(0, 40)} (${node.startPosition.row + 1}:${node.startPosition.column + 1})`;
        const r = isTop ? top : runBashAst(bin!, backquoted ? unescapeBackquoted(text.slice(from, to)) : text.slice(from, to));
        // Lines count from the start of the substitution's text, as bash-ast counts them.
        if (ours && !isTop) rewrite(ours, backquoted ? unescapeBackquoted : (x) => x, (l) => l - rowOf(from));
        const theirs = r.ok ? shapeOfAst(r.ast) : null;
        // (The line bash gives a command is left to test/bash-ast.test.ts: it says nothing of where commands begin and end.)
        const differs = r.ok ? diffShapes(ours, theirs).some((d) => !d.path.endsWith('.line')) : ours !== null;
        if (differs) { pinned.shapesDiffer++; report(name, 'the shapes differ'); }
        const scope: Scope = { node, name, from, to, pathOf: new Map(), shapeOf: new Map(), bashAt: byPath(theirs), differs };
        for (const [p, s] of byPath(ours)) {
          for (const n of origins.get(s as Shape) ?? []) { scope.pathOf.set(n, p); scope.shapeOf.set(n, s as Shape); }
        }
        scopes.set(node, scope);
      }
      if (empty) { skip('empty'); continue; }
      counts.inputs++;
      counts.scripts += scopes.size;
      const commands = [...scopes.values()].flatMap((s) => [...s.pathOf.keys()]);
      const scopeOfCommand = new Map(commands.map((c) => [c, scopes.get(scopeOf(c))!]));
      const holds = (c: SyntaxNode, a: number, b: number): boolean => c.startIndex <= a && b <= c.endIndex;
      const innermost = (cs: SyntaxNode[], a: number, b: number): SyntaxNode | undefined =>
        cs.filter((c) => holds(c, a, b)).sort((x, y) => (x.endIndex - x.startIndex) - (y.endIndex - y.startIndex))[0];
      /** The nearest of our commands around a node, by its ancestors. */
      const commandAround = (n: SyntaxNode): SyntaxNode | undefined => {
        for (let p = n.parent; p; p = p.parent) if (scopeOfCommand.has(p)) return p;
        return undefined;
      };

      // Each substitution lies in one word of the command around it, in the script around it.
      for (const sc of scopes.values()) {
        if (sc.node === tree.root) continue;
        const outer = commandAround(sc.node);
        if (!outer) { report(sc.name, 'is in no command'); continue; }
        const osc = scopeOfCommand.get(outer)!;
        if (osc.differs) continue;
        const b = osc.bashAt.get(osc.pathOf.get(outer)!) as Shape | undefined;
        if (!b || !stringsOf(b).map(bare).some((w) => w.includes(bare(sc.node.text)))) report(sc.name, `is in no word of bash-ast's command at ${osc.pathOf.get(outer)}`);
      }

      const skipRows = continuationRows(tree.root);
      const seen = new Set<string>();
      for (let line = 0; line < lineStarts.length; line++) {
        if (skipRows.has(line)) continue;
        counts.lines++;
        for (const t of allTokens(analyzer.explainLine(tree, line, shell).items)) {
          if (t.kind === 'comment' || t.kind === 'shebang') continue;
          const a = offset(t.span.start);
          const b = offset(t.span.end);
          const name = `${t.label} (${t.span.start.line + 1}:${t.span.start.character + 1})`;
          const id = `${a}:${b}:${t.label}`;
          if (seen.has(id)) continue;
          seen.add(id);
          counts.tokens++;
          // (A command inside the token is fine: a token of a list, a pipeline, a block holds its commands.)
          const crossed = commands.find((c) => c.startIndex < b && a < c.endIndex && !holds(c, a, b) && !(a <= c.startIndex && c.endIndex <= b));
          if (crossed) { report(name, `crosses the ${crossed.type} at ${crossed.startIndex}`); continue; }
          // The script the token is in, by position: the innermost one whose text holds it.
          const where = [...scopes.values()].filter((s) => s.from <= a && b <= s.to).sort((x, y) => (x.to - x.from) - (y.to - y.from))[0];
          let own: SyntaxNode | undefined;
          const body = all.find((h) => h.type === 'heredoc_body' && holds(h, a, b));
          if (body) {
            // A token in a here-document's body belongs to the command of its redirection, by the tree.
            pinned.inHeredoc++;
            const redirect = body.parent!;
            own = commandAround(redirect);
            const op = redirect.children.find((c) => !c.named)!.type;
            const target = op === '<<-' ? body.text.replace(/^\t+/gm, '') : body.text;
            const s = own && scopeOfCommand.get(own)!.shapeOf.get(own);
            if (!s || !('redirects' in s) || !s.redirects.some((r) => r.op === '<<' && r.target === target)) {
              report(name, 'its here-document is not a redirection of the command around it');
              continue;
            }
          } else {
            own = innermost(commands.filter((c) => scopeOfCommand.get(c) === where), a, b);
            if (!own) {
              // `;` and `&` after a statement of a script belong to its sequence (bash's connection), not to a node of
              // ours; so does the token of the list they make (`a; b &`), over its statements.
              const after = where.node.namedChildren.some((c) => scopeOfCommand.has(c) && c.endIndex <= a);
              if ((t.label === ';' || t.label === '&') && after) counts.separators++;
              else if (lists.some((l) => l.startIndex === a && l.endIndex === b && l.parent === where.node)) counts.lists++;
              else report(name, `in no command of ${where.name}`);
              continue;
            }
          }
          const sc = scopeOfCommand.get(own!)!;
          if (sc !== where) { report(name, `its command is in ${sc.name}, the token in ${where.name}`); continue; }
          if (sc.node !== tree.root) pinned.inSubstitution++;
          if (sc.differs) continue;
          const theirs = sc.bashAt.get(sc.pathOf.get(own!)!) as Shape | undefined;
          if (theirs?.k !== sc.shapeOf.get(own!)!.k) report(name, `bash-ast has no ${sc.shapeOf.get(own!)!.k} command at ${sc.pathOf.get(own!)} of ${sc.name}`);
        }
      }
    }
    console.log(`      command tokens: ${counts.inputs} inputs (${counts.scripts} scripts with the substitutions), ${counts.lines} lines, ${counts.tokens} tokens (${counts.separators} separators, ${counts.lists} lists), ${JSON.stringify(pinned)}, ${counts.known} known findings, ${fresh.length} new, in ${((Date.now() - started) / 1000).toFixed(1)} s`);
    const stale = known.findings.filter((k) => !used.has(k)).map((k) => `stale: ${JSON.stringify(k.input).slice(0, 80)} ${k.token}: ${k.problem}`);
    assert.deepEqual([...fresh, ...stale], []);
    // Pinned, so that a change moves them on purpose (in test/fixtures/command-tokens-known.json).
    assert.deepEqual(pinned, known.counts);
  });
});
