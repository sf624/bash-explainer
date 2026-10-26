// The reading tree (src/reading.ts) against the Bash Reference Manual, chapter 3 (docs/roadmap.md): each construct
// is named and grouped as the manual does and cites its section, every reserved word and operator bash reads in a
// statement is a node of its own, and the grouping is bash's own where bash-ast shows it.
import * as assert from 'assert';
import { Analyzer } from '../src/analyzer';
import { readingNodes, type ReadingNode } from '../src/reading';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { ui } from '../src/ui/render';
import type { SyntaxNode } from '../src/syntax/tree';
import { runBash } from './support/bash';
import { findBashAst, runBashAst, type AstNode } from './support/bashast';

const parser = createUnbashParser();
const analyzer = new Analyzer('en');
const explain = (src: string, line = 0) => analyzer.explainLine(parser.parse(src), line, 'bash', { reading: true });
const reading = (src: string, line = 0): ReadingNode => explain(src, line).reading!;
/** The first node of bash's reading with this label (and kind). */
const find = (r: ReadingNode, label: string, kind?: string): ReadingNode =>
  readingNodes(r).find((n) => n.layer === 'bash' && n.label === label && (!kind || n.kind === kind))!;
const kids = (n: ReadingNode): string[] => n.children.map((c) => `${c.kind} ${c.label}`);

/** The reserved words of the manual (3.2.1). */
const RESERVED = new Set(['if', 'then', 'elif', 'else', 'fi', 'time', 'for', 'in', 'until', 'while', 'do', 'done', 'case', 'esac', 'coproc', 'select', 'function', '{', '}', '[[', ']]', '!']);
/** Nodes whose tokens are parts of a word or of a redirection, which their own nodes show. */
const INSIDE = new Set([
  'word', 'string', 'raw_string', 'ansi_c_string', 'translated_string', 'simple_expansion', 'expansion', 'command_substitution', 'process_substitution',
  'arithmetic_expansion', 'concatenation', 'brace_expression', 'file_redirect', 'heredoc_redirect', 'herestring_redirect', 'array', 'subscript', 'regex', 'extglob_pattern',
]);

/** The tokens bash reads in the statements of a script (reserved words and operators), outside words and redirections. */
function statementTokens(n: SyntaxNode): SyntaxNode[] {
  if (INSIDE.has(n.type)) return [];
  return n.children.flatMap((c) => (c.named ? statementTokens(c) : c.type === '\n' ? [] : [c]));
}

/** Scripts with every construct of chapter 3 (3.2 to 3.4), one statement a line. */
const SCRIPTS = [
  'a | b |& c', '! a | b', 'time -p a | b', 'time ! a', 'a && b || c; d & e', 'a; b',
  'until a; do b; done', 'while a; do b; done', 'for x in a b; do c; done', 'for x; do c; done', 'for ((i = 0; i < 3; i++)); do c; done',
  'if a; then b; elif c; then d; else e; fi', 'case $x in a|b) c;; d) e;& f) g;;& *) h;; esac', 'case $x in (a) b ;; esac',
  'select x in a b; do c; done', '(( x > 1 && y, z = 2 ))', '[[ -f a && ! ( b == c* || d =~ ^e ) ]]', '[[ a < b ]]',
  '{ a; b; }', '( a; b )', 'coproc a', 'coproc NAME { a; }', 'coproc ( a )',
  'f() { echo a; }', 'function g { echo b; }', 'function h() ( echo c )', 'while read l; do :; done < f', 'f() { :; } > log',
  'echo $(( (1 + 2) ? 3 : 4 ))', 'x=1 y+=2 cmd # c',
];

describe('the reading tree as the Bash manual reads a line (chapter 3)', () => {
  it('has every reserved word and operator of a statement as a node of its own, a reserved word as one (3.2.1)', () => {
    for (const src of SCRIPTS) {
      const tree = parser.parse(src);
      const nodes = readingNodes(reading(src)).filter((n) => n.layer === 'bash');
      for (const t of statementTokens(tree.root)) {
        const at = nodes.find((n) => n.span.start.character === t.startPosition.column && n.span.end.character === t.endPosition.column && n.label === t.type);
        assert.ok(at, `${src}: \`${t.type}\` at ${t.startPosition.column}`);
        // (`!` in `[[ ]]` and `(( ))` is an operator of the expression, not the reserved word.)
        const reserved = RESERVED.has(t.type) && !/expression$/.test(t.parent!.type);
        assert.strictEqual(at.kind, reserved ? 'keyword' : 'operator', `${src}: \`${t.type}\``);
      }
    }
  });

  it('cites the sections of quoting and comments (3.1.2.1, 3.1.3), and of a simple command (3.2.2)', () => {
    const r = reading('echo \\$a b\\ c "d" # e');
    assert.deepStrictEqual(find(r, '\\$a').refs, ['3.7.1', '3.1.2.1']);
    assert.deepStrictEqual(find(r, 'b\\ c').refs, ['3.7.1', '3.1.2.1']);
    assert.deepStrictEqual(find(r, '# e').refs, ['3.1.3']);
    assert.deepStrictEqual(find(r, 'echo \\$a b\\ c "d"', 'command').refs, ['3.2.2', '3.7.1']);
    // (In a word of several parts too; and a line continuation is the escape character's.)
    assert.deepStrictEqual(find(reading('echo a\\ "b" "c"d'), 'a\\ "b"').refs, ['3.7.1', '3.1.2.1']);
    assert.deepStrictEqual(find(reading('echo a\\ "b" "c"d'), '"c"d').refs, ['3.7.1']);
    assert.deepStrictEqual(find(reading('echo a\\\nb'), 'a\\').refs, ['3.7.1', '3.1.2.1']);
    // The words bash reads itself are named as the manual names them (3.2.1, 3.3).
    const labels = new Map(Object.entries({ keyword: 'reserved word', function: 'function definition', arithmetic: 'arithmetic expansion', expression: 'expression' }));
    for (const [kind, label] of labels) assert.strictEqual((ui.en.panel.tree.kinds as Record<string, string>)[kind], label);
  });

  it('reads `time` and `!` as parts of the one pipeline after them (3.2.3), as bash does', () => {
    assert.deepStrictEqual(kids(find(reading('! a | b'), '! a | b', 'pipeline')), ['keyword !', 'command a', 'operator |', 'command b']);
    assert.deepStrictEqual(kids(find(reading('time -p ! a | b'), 'time -p ! a | b', 'pipeline')), [
      'keyword time', 'option -p', 'keyword !', 'command a', 'operator |', 'command b',
    ]);
    assert.deepStrictEqual(kids(find(reading('time ! a'), 'time ! a', 'pipeline')), ['keyword time', 'keyword !', 'command a']);
    for (const src of ['! a | b', 'time -p ! a | b', 'time ! a']) {
      assert.strictEqual(readingNodes(reading(src)).filter((n) => n.kind === 'pipeline').length, 1, src);
    }
  });

  it('cites the `|` between the patterns of a case clause as the clause\'s (3.2.5.2), not a pipe', () => {
    const r = reading('case $x in a|b) c;; d) e;; esac');
    assert.deepStrictEqual(find(r, '|', 'operator').refs, ['3.2.5.2']);
    // (Its explanation says what `|` means only where there is one.)
    assert.match(find(r, 'a|b) ‹commands› ;;', 'clause').text!, /`\|` means "or"/);
    assert.doesNotMatch(find(r, 'd) ‹commands› ;;', 'clause').text!, /means "or"/);
  });

  it('shows the `( )` of a function definition (3.3) and the body of a loop with its loop\'s section (3.2.5.1, 3.2.5.2)', () => {
    const f = find(reading('f() { :; }'), 'f() { ‹commands› }', 'function');
    assert.deepStrictEqual(kids(f), ['name f', 'operator (', 'operator )', 'compound { ‹commands› }']);
    assert.deepStrictEqual(f.children.slice(1, 3).map((c) => c.refs), [['3.3'], ['3.3']]);
    assert.deepStrictEqual(find(reading('for x in a; do b; done'), 'do ‹commands› done').refs, ['3.2.5.1']);
    assert.deepStrictEqual(find(reading('select x in a; do b; done'), 'do ‹commands› done').refs, ['3.2.5.2']);
  });

  it('reads the expressions of `[[ ]]` (6.4) and of arithmetic (6.5) as expressions, with their sections', () => {
    const t = find(reading('[[ ! -f a && b ]]'), '[[ ! -f a && b ]]', 'compound');
    assert.deepStrictEqual(kids(t), ['keyword [[', 'expression ! -f a && b', 'keyword ]]']);
    const e = find(reading('[[ ! -f a && b ]]'), '! -f a', 'expression');
    assert.deepStrictEqual(kids(e), ['operator !', 'expression -f a']);
    for (const n of readingNodes(t).filter((x) => x.kind === 'expression' || x.kind === 'operator')) assert.deepStrictEqual(n.refs, ['3.2.5.2', '6.4'], n.label);
    // In arithmetic, a number is part of the expression, not a word bash expands; an expansion comes first.
    const a = find(reading('echo $((1 + $n))'), '1 + $n', 'expression');
    assert.deepStrictEqual(a.refs, ['3.5.5', '6.5']);
    assert.deepStrictEqual(kids(a), ['expression 1', 'operator +', 'expansion $n']);
    const c = reading('for ((i = 0; i < 3; i++)); do :; done');
    assert.deepStrictEqual(find(c, 'i = 0', 'expression').refs, ['3.2.5.1', '6.5']);
    assert.deepStrictEqual(['((', '=', '<', '++', '))'].map((op) => find(c, op, 'operator').refs), Array(5).fill(['3.2.5.1', '6.5']));
    assert.deepStrictEqual(find(reading('(( x && y ))'), '&&', 'operator').refs, ['3.2.5.2', '6.5']);
    // (Every operator of `$(( ))` is a row, the comma operator too; its delimiters are the expansion's.)
    assert.deepStrictEqual(kids(find(reading('echo $((1, 2))'), '$((1, 2))', 'arithmetic')), ['expression 1', 'operator ,', 'expression 2']);
    assert.deepStrictEqual(find(reading('echo $((1, 2))'), ',', 'operator').refs, ['3.5.5', '6.5']);
  });

  it('keeps the redirections of a compound command on it (3.2.5, 3.6), as bash does', () => {
    const w = find(reading('while a; do :; done < f'), 'while ‹condition› do ‹commands› done < f', 'compound');
    assert.deepStrictEqual(w.refs, ['3.2.5.1']);
    assert.deepStrictEqual(kids(w).slice(-1), ['redirect < f']);
    const f = find(reading('f() { :; } > log'), 'f() { ‹commands› } > log', 'function');
    assert.deepStrictEqual(kids(f), ['name f', 'operator (', 'operator )', 'compound { ‹commands› } > log']);
    assert.deepStrictEqual(kids(f.children[3]).slice(-1), ['redirect > log']);
    assert.ok(readingNodes(f).every((n) => n.kind !== 'part'));
  });

  it('agrees with bash\'s parser on what holds the redirections and how many pipelines there are', function () {
    const bin = findBashAst();
    if (!bin) {
      if (process.env.BASH_EXPLAINER_BASH_AST) assert.fail('BASH_EXPLAINER_BASH_AST is set, but bash-ast cannot be run (see $BASH_AST)');
      this.skip();
    }
    const walk = (n: unknown): AstNode[] => (n && typeof n === 'object' ? [...('type' in n ? [n as AstNode] : []), ...Object.values(n).flatMap(walk)] : []);
    for (const [src, holder, kind] of [['while a; do :; done < f', 'while', 'compound'], ['f() { :; } > log', 'group', 'compound'], ['{ a; } 2>&1', 'group', 'compound']] as const) {
      const r = runBashAst(bin!, src);
      assert.ok(r.ok);
      const held = walk(r.ast).filter((n) => n.redirects?.length);
      assert.deepStrictEqual(held.map((n) => n.type), [holder], src);
      // Ours: the redirection is a part of the command of that kind.
      const ours = readingNodes(reading(src)).filter((n) => n.children.some((c) => c.kind === 'redirect'));
      assert.deepStrictEqual(ours.map((n) => n.kind), [kind], src);
    }
    for (const src of ['! a | b', 'time -p ! a | b', 'time ! a', '! a']) {
      const r = runBashAst(bin!, src);
      assert.ok(r.ok);
      const pipes = walk(r.ast).filter((n) => n.type === 'pipeline' || n.negated);
      assert.strictEqual(pipes.length, 1, src);
      assert.strictEqual(readingNodes(reading(src)).filter((n) => n.kind === 'pipeline').length, 1, src);
    }
  });

  it('shows the operator of an assignment (3.4), and cites a positional or special parameter in braces (3.4.1, 3.4.2)', () => {
    const r = reading('x=1 y+=(2) cmd');
    assert.deepStrictEqual(kids(find(r, 'y+=(2)', 'assignment')), ['name y', 'operator +=', 'word 2']);
    assert.deepStrictEqual(find(r, '=', 'operator').refs, ['3.4']);
    // (In an `if`, too: the operator is the assignment's, not the construct's.)
    assert.deepStrictEqual(find(reading('if a; then x=1; fi'), '=', 'operator').refs, ['3.4']);
    const p = reading('echo ${10} ${#} ${x}');
    assert.deepStrictEqual(['${10}', '${#}', '${x}'].map((x) => find(p, x, 'expansion').refs), [['3.4.1', '3.5.3'], ['3.4.2', '3.5.3'], ['3.5.3']]);
  });

  it('says what `select` sets its name to, as bash does (3.2.5.2)', () => {
    assert.match(find(reading('select v in a b; do :; done'), 'v', 'name').text!, /the chosen word: the one whose number is typed \(an empty string when the line is not one of the numbers\)/);
    assert.strictEqual(find(reading('for v in a b; do :; done'), 'v', 'name').text, 'Loop variable: receives the next value on each iteration');
    const r = runBash('select v in a b; do echo "[$v][$REPLY]"; done 2>/dev/null', { input: '2\nx\n' });
    // (At the end of its input, `select` prints a newline and ends.)
    assert.strictEqual(r.stdout, '[b][2]\n[][x]\n\n');
  });
});
