// The reading tree (src/reading.ts) against the Bash Reference Manual, chapter 3 (docs/roadmap.md): each construct
// is named and grouped as the manual does and cites its section, every reserved word and operator bash reads in a
// statement, a parameter or brace expansion and a redirection is a node of its own, and the grouping is bash's own
// where bash-ast shows it.
import * as assert from 'assert';
import * as fs from 'fs';
import { Analyzer, type Token } from '../src/analyzer';
import { variableAssignments, variableEmptied, wellKnownVariables } from '../src/dict/syntax';
import { VARIABLE_SECTIONS } from '../src/manual';
import { readingNodes, type ReadingNode } from '../src/reading';
import { shellState } from '../src/semantics/state';
import { BASH_VARIABLES, readonlyAtStart } from '../src/semantics/vars';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { ui } from '../src/ui/render';
import type { SyntaxNode } from '../src/syntax/tree';
import { type BashOptions, runBash } from './support/bash';
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

/** The nodes whose operators are parts of a word or of a redirection (3.5.1, 3.5.3, 3.6). */
const OWNERS = new Set(['expansion', 'brace_expression', 'file_redirect', 'heredoc_redirect', 'herestring_redirect']);
/** Scripts with every parameter expansion, brace expansion and redirection of 3.5 and 3.6. */
const WORD_SCRIPTS = [
  'echo ${x:-$y} ${x#*/} ${x%%.*} ${!x} ${x^^} ${x,} ${x@Q} ${#x} ${x:i+1:2} ${!p*} ${!a[@]} ${a[@]:1} ${x:?m} ${x=d} ${x//a/b} ${x/#a} ${@:2} ${x:(-1)}',
  'echo a{1..9..2}b {a,b}{1..2} {a,b} x{c,{d,e}}y {f,"g h",$v} {,}',
  'cat 2> e {fd}>k 1>&3- >"$f" <<< "$x" 5<&- &>i &>>j >&2 <&0 3<>h >|l <&f >>g 0<&4-',
  'cat 3<<-E\n\tx\nE',
];

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
    assert.deepStrictEqual(kids(find(r, 'y+=(2)', 'assignment')), ['name y', 'operator +=', 'part (2)']);
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
  it('has every operator of a parameter expansion, a brace expansion and a redirection as a node (3.5.1, 3.5.3, 3.6)', () => {
    /** The tokens of these nodes and of the expressions in them, but for the `${` and `}` of a parameter expansion. */
    const own = (n: SyntaxNode): SyntaxNode[] => [
      ...(OWNERS.has(n.type) || /expression$/.test(n.type) ? n.children.filter((c) => !c.named && c.type !== '${' && !(n.type === 'expansion' && c.type === '}')) : []),
      ...n.namedChildren.flatMap(own),
    ];
    for (const src of WORD_SCRIPTS) {
      const nodes = readingNodes(reading(src)).filter((n) => n.layer === 'bash');
      for (const t of own(parser.parse(src).root)) {
        const at = nodes.find((n) => n.span.start.character === t.startPosition.column && n.span.end.character === t.endPosition.column && n.label === t.type);
        assert.ok(at, `${src}: \`${t.type}\` at ${t.startPosition.column}`);
        assert.strictEqual(at.kind, 'operator', `${src}: \`${t.type}\``);
        assert.ok(at.refs?.length, `${src}: \`${t.type}\` cites no section`);
      }
    }
  });

  it('cites on a word what bash does to it that no part shows: braces, a tilde, splitting, globbing, a pattern (3.5)', () => {
    const r = reading('echo *.txt $x "$x" ~/a {a,b} x=~/b');
    assert.deepStrictEqual(['*.txt', '$x', '"$x"', '~/a', '{a,b}', 'x=~/b'].map((w) => find(r, w, 'argument').refs), [
      ['3.7.1', '3.5.8'], ['3.7.1', '3.5.3', '3.5.7', '3.5.8'], ['3.7.1', '3.1.2.3'], ['3.7.1', '3.5.2'], ['3.7.1', '3.5.1'], ['3.7.1', '3.5.2'],
    ]);
    // (As the model reads the shell's state: no globbing after `set -f`, no splitting with an empty IFS.)
    assert.deepStrictEqual(find(reading('set -f\necho *.txt $x', 1), '*.txt', 'argument').refs, ['3.7.1']);
    assert.deepStrictEqual(find(reading('IFS=\necho $x', 1), '$x', 'argument').refs, ['3.7.1', '3.5.3', '3.5.8']);
    // A pattern is matched as 3.5.8.1 says, in `case`, `[[ == ]]` and `${x#pat}`; a tilde in an assignment's value.
    assert.ok(find(reading('case $x in a*) ;; esac'), 'a*', 'word').refs!.includes('3.5.8.1'));
    assert.deepStrictEqual(find(reading('echo ${x#*/}'), '*/', 'word').refs, ['3.5.3', '3.5.8.1']);
    assert.deepStrictEqual(find(reading('x=~/a:~/b'), 'x=~/a:~/b', 'assignment').refs, ['3.4', '3.7.1', '3.5.2']);
    // (What bash does: `*.txt` globs, `$x` splits and globs, `"$x"` does neither.)
    const b = runBash('x="b.txt *.txt"; printf "[%s]" *.txt $x "$x"', { files: ['a.txt'] });
    assert.strictEqual(b.stdout, '[a.txt][b.txt][a.txt][b.txt *.txt]');
  });

  it('reads a brace expansion (3.5.1): its braces, `..` and `,`, as bash expands it', () => {
    const r = reading('echo a{1..9..4}b {x,y}{1..2}');
    assert.deepStrictEqual(kids(find(r, '{1..9..4}', 'brace')), ['operator {', 'number 1', 'operator ..', 'number 9', 'operator ..', 'number 4', 'operator }']);
    assert.deepStrictEqual(find(r, '{1..9..4}', 'brace').refs, ['3.5.1']);
    assert.deepStrictEqual(kids(find(r, '{x,y}', 'brace')), ['operator {', 'word x', 'operator ,', 'word y', 'operator }']);
    assert.strictEqual(runBash('echo a{1..9..4}b {x,y}{1..2}').stdout, 'a1b a5b a9b x1 x2 y1 y2\n');
    // A list alone too, nested, with a quote and a variable in it.
    const l = reading('echo {a,b} x{c,{d,e}}y {f,"g h",$v}');
    assert.deepStrictEqual(kids(find(l, '{a,b}', 'brace')), ['operator {', 'word a', 'operator ,', 'word b', 'operator }']);
    assert.deepStrictEqual(find(l, '{a,b}', 'brace').refs, ['3.5.1']);
    assert.deepStrictEqual(kids(find(l, '{c,{d,e}}', 'brace')), ['operator {', 'word c', 'operator ,', 'word {d,e}', 'operator }']);
    assert.deepStrictEqual(kids(find(l, '{d,e}', 'brace')), ['operator {', 'word d', 'operator ,', 'word e', 'operator }']);
    assert.deepStrictEqual(kids(find(l, '{f,"g h",$v}', 'brace')), ['operator {', 'word f', 'operator ,', 'word "g h"', 'operator ,', 'word $v', 'operator }']);
    assert.strictEqual(runBash('v=V; printf "<%s>" {a,b} x{c,{d,e}}y {f,"g h",$v}').stdout, '<a><b><xcy><xdy><xey><f><g h><V>');
    // Where bash does not expand braces, they are text: the value of an assignment, a here-string, a script for dash.
    const none = (src: string, shell = 'bash'): boolean => !readingNodes(analyzer.explainLine(parser.parse(src), 0, shell as 'bash', { reading: true }).reading!).some((n) => n.kind === 'brace');
    assert.ok(none('x={a,b} y={1..2}') && none('cat <<< {a,b}') && none('echo {a,b} {1..2}', 'dash'));
    // (But an assignment given to `declare` is a word bash expands: `declare x={1..3}` is `x=1 x=2 x=3`.)
    assert.ok(!none('declare x={1..3}') && !none('alias z={a,b}'));
    assert.strictEqual(runBash('x={a,b}; cat <<< {c,d}; echo "$x"').stdout, '{c,d}\n{a,b}\n');
  });

  it('reads the parts of a parameter expansion (3.5.3): the parameter, its operators, and a word, a pattern or arithmetic', () => {
    const r = reading('echo ${x:-$y} ${x//a/b} ${!x} ${x@Q} ${a[@]:i+1:2}');
    assert.deepStrictEqual(kids(find(r, '${x:-$y}', 'expansion')), ['name x', 'operator :-', 'word $y']);
    assert.deepStrictEqual(kids(find(r, '${x//a/b}', 'expansion')), ['name x', 'operator //', 'word a', 'operator /', 'word b']);
    // (`!` there is the expansion's operator, not the reserved word; `@` and its letter are two, as the manual writes them.)
    assert.deepStrictEqual(kids(find(r, '${!x}', 'expansion')), ['operator !', 'name x']);
    assert.deepStrictEqual(kids(find(r, '${x@Q}', 'expansion')), ['name x', 'operator @', 'operator Q']);
    // The offset and length of a substring are arithmetic (6.5), as bash evaluates them.
    const s = find(r, '${a[@]:i+1:2}', 'expansion');
    assert.deepStrictEqual(kids(s), ['name a[@]', 'operator :', 'expression i+1', 'operator :', 'expression 2']);
    assert.deepStrictEqual(find(r, 'i+1', 'expression').refs, ['3.5.3', '6.5']);
    assert.strictEqual(runBash('a=(p q r s t); i=1; echo ${a[@]:i+1:2}').stdout, 'r s\n');
  });

  it('says what `$(< file)` is (3.5.4): the contents of the file, which bash reads itself', () => {
    const r = reading('echo "$(< f)" $(3< f)');
    assert.match(find(r, '$(< f)', 'substitution').text!, /^Command substitution `\$\(< file\)`: replaced by the contents of the file `f`/);
    assert.match(readingNodes(r).find((n) => n.layer === 'child' && n.kind === 'command')!.text!, /^The redirection of `\$\(< file\)`/);
    // (Any other command with no name prints nothing: `$(3< f)`.)
    assert.match(find(r, '$(3< f)', 'substitution').text!, /runs the command/);
    const b = runBash('printf "hi\\n" > f; printf "[%s]" "$(< f)" "$(3< f)" "$(< f;)" "$(< f; < f)" "`< f`" "$(< f &)" "$(0< f)" "$(x=1 < f)"', { files: [] });
    assert.strictEqual(b.stdout, '[hi][][hi][][hi][][hi][]');
    for (const [src, special] of [['echo $(< f;)', true], ['echo $(0< f)', true], ['echo $(< f; < f)', false], ['echo `< f`', true], ['echo $(< f &)', false], ['echo $(> f)', false], ['echo $(x=1 < f)', false]] as const) {
      assert.strictEqual(/contents of the file/.test(readingNodes(reading(src)).find((n) => n.kind === 'substitution')!.text!), special, src);
    }
  });

  it('says that a subshell runs the script of `$( )` and `<( )` (3.7.3), and this shell that of `${ }` (bash 5.3)', () => {
    const r = reading('echo $(a) <(b)');
    assert.deepStrictEqual(readingNodes(r).filter((n) => n.kind === 'script').map((n) => [n.process, n.refs]), [['subshell', ['3.7.3']], ['subshell', ['3.7.3']]]);
    const f = analyzer.explainLine(parser.parse('echo ${ echo $(a); }'), 0, 'bash', { reading: true, bashVersion: '5.3' }).reading!;
    const scripts = readingNodes(f).filter((n) => n.kind === 'script');
    assert.deepStrictEqual(scripts.map((n) => n.process), ['same', 'subshell']);
    const inner = new Set(readingNodes(scripts[1]));
    assert.ok(readingNodes(scripts[0]).filter((n) => n.layer === 'child' && !inner.has(n)).every((n) => n.process === 'same'));
  });

  it('reads a redirection as bash does (3.6): its descriptor, its operator and its word, each a node', () => {
    const r = reading('cat 2> e {fd}>k <<< "$x" >&2');
    assert.deepStrictEqual(kids(find(r, '2> e', 'redirect')), ['descriptor 2', 'operator >', 'word e']);
    assert.deepStrictEqual(kids(find(r, '{fd}>k', 'redirect')), ['descriptor {fd}', 'operator >', 'word k']);
    assert.deepStrictEqual(kids(find(r, '<<< "$x"', 'redirect')), ['operator <<<', 'word "$x"']);
    assert.deepStrictEqual(find(r, '{fd}', 'descriptor').refs, ['3.6']);
    assert.deepStrictEqual(find(r, '>', 'operator').refs, ['3.6.2']);
    // (`<&word` only duplicates or closes: 3.6.8.)
    assert.deepStrictEqual(find(reading('cat <&f'), '<&f', 'redirect').refs, ['3.6.8']);
    // A here-document: its delimiter, which bash does not expand, and its body (3.6.6).
    const h = find(reading("cat 3<<-'E'\n\tx $y\nE"), "3<<-'E'", 'redirect');
    assert.deepStrictEqual(kids(h), ['descriptor 3', 'operator <<-', "delimiter 'E'", 'heredoc x $y']);
    assert.deepStrictEqual(h.children.slice(2).map((c) => c.refs), [['3.6.6'], ['3.6.6']]);
    assert.strictEqual(runBash("y=1; cat <<'E'\n$y\nE\ncat <<E\n$y\nE").stdout, '$y\n1\n');
    for (const kind of ['descriptor', 'delimiter']) assert.ok((ui.en.panel.tree.kinds as Record<string, string>)[kind], kind);
  });

  it('agrees with bash\'s parser on the parts of each redirection', function () {
    const bin = findBashAst();
    if (!bin) {
      if (process.env.BASH_EXPLAINER_BASH_AST) assert.fail('BASH_EXPLAINER_BASH_AST is set, but bash-ast cannot be run (see $BASH_AST)');
      this.skip();
    }
    /** The section of each kind of redirection bash-ast names (a duplication to a word that is no number is 3.6.4). */
    const section = (d: { direction: string; target: string | number }): string => ({
      input: '3.6.1', output: '3.6.2', clobber: '3.6.2', append: '3.6.3', err_and_out: '3.6.4', append_err_and_out: '3.6.5', here_doc: '3.6.6',
      here_string: '3.6.7', dup_input: '3.6.8', close: '3.6.8', move_input: '3.6.9', move_output: '3.6.9', input_output: '3.6.10',
      dup_output: typeof d.target === 'number' ? '3.6.8' : '3.6.4',
    } as Record<string, string>)[d.direction];
    for (const src of ['cat < a 2> e {fd}>k 1>&3- >"$f" <<< "$x" 5<&- &>i &>>j >&2 <&0 3<>h >|l <&f >>g 0<&4- >&o {v}>&-', "cat 3<<-'E' <<F\n\tx\nE\ny\nF"]) {
      const ast = runBashAst(bin!, src);
      assert.ok(ast.ok, src);
      const theirs = ast.ast.redirects!;
      const ours = readingNodes(reading(src)).filter((n) => n.kind === 'redirect');
      assert.strictEqual(ours.length, theirs.length, src);
      ours.forEach((r, i) => {
        const d = theirs[i];
        const part = (kind: string) => r.children.find((c) => c.kind === kind);
        assert.deepStrictEqual(r.refs, [section(d)], `${src}: ${r.label}`);
        // The descriptor written before the operator (bash-ast names `{v}` by none).
        const fd = part('descriptor');
        if (fd && !fd.label.startsWith('{')) assert.strictEqual(fd.label, String(d.source_fd), r.label);
        if (d.direction === 'here_doc') assert.strictEqual(part('delimiter')!.label.replace(/['"\\]/g, ''), d.here_doc_eof, r.label);
        else if (typeof d.target === 'string') assert.strictEqual(part('word')!.label, d.target, r.label);
        else assert.strictEqual(part('word')!.label.replace(/-$/, ''), d.target < 0 ? '' : String(d.target), r.label);
      });
    }
  });

  it('says what the redirections of a command with no name do in bash (3.7.1): they apply to nothing', () => {
    assert.match(find(reading('> f'), '> f', 'command').text!, /^Redirections of a command with no name: bash opens the files/);
    // (With no shell named, the script is bash's. In sh it is said as before: dash applies them to the assignments.)
    const of = (shell: 'sh' | undefined) => analyzer.explainLine(parser.parse('x=$(a) > f'), 0, shell, { reading: true }).reading!.children[0].text!;
    assert.match(of(undefined), /^Redirections of a command with no name/);
    assert.match(of('sh'), /^Redirection applied to `x=\$\(a\)` as a whole/);
    assert.match(find(reading('x=$(ls /none) 2>/dev/null'), 'x=$(ls /none) 2>/dev/null', 'command').text!, /nor do they apply to the assignments `x=\$\(ls \/none\)`/);
    // (In bash 5.2 and 5.3: the substitution's errors are still shown, and it reads the shell's stdin.)
    const programs: BashOptions[] = [{}, ...(process.env.BASH_EXPLAINER_BASH53 ? [{ program: process.env.BASH_EXPLAINER_BASH53 }] : [])];
    for (const p of programs) {
      const b = runBash('x=$(echo err >&2; cat) 2>/dev/null < f; echo "[$x]"; > g; [ -e g ] && echo made', { ...p, files: ['f'], input: 'in\n' });
      assert.deepStrictEqual([b.stdout, b.stderr], ['[in]\nmade\n', 'err\n'], p.program ?? 'bash');
    }
  });
});

/** The builtins of chapter 4, in the section the manual (bash 5.2) lists each in. */
const CHAPTER4: Record<string, readonly string[]> = {
  '4.1': [':', '.', 'break', 'cd', 'continue', 'eval', 'exec', 'exit', 'export', 'getopts', 'hash', 'pwd', 'readonly', 'return', 'shift', 'test', '[', 'times', 'trap', 'umask', 'unset'],
  '4.2': ['alias', 'bind', 'builtin', 'caller', 'command', 'declare', 'echo', 'enable', 'help', 'let', 'local', 'logout', 'mapfile', 'printf', 'read', 'readarray', 'source', 'type', 'typeset', 'ulimit', 'unalias'],
  '4.3.1': ['set'],
  '4.3.2': ['shopt'],
};
/**
 * The POSIX special builtins (4.4). bash 5.2 also treats `source` and `times` as special, which its manual leaves out
 * of the list and bash 5.3's lists.
 */
const SPECIAL = new Set(['break', ':', '.', 'source', 'continue', 'eval', 'exec', 'exit', 'export', 'readonly', 'return', 'set', 'shift', 'times', 'trap', 'unset']);

describe('the reading tree as the Bash manual reads the builtins (chapter 4)', () => {
  it('cites the section of each builtin, and 4.4 for a special builtin, whose badge says so', () => {
    for (const [section, names] of Object.entries(CHAPTER4)) {
      for (const name of names) {
        const n = find(reading(name === '[' ? '[ x ]' : `${name} x`), name, 'commandName');
        assert.deepStrictEqual(n.refs, ['3.7.1', '3.7.2', section, ...(SPECIAL.has(name) ? ['4.4'] : [])], name);
        assert.strictEqual(n.name!.runs, 'builtin', name);
        assert.strictEqual(n.name!.said.kind, SPECIAL.has(name) ? 'special builtin' : 'builtin', name);
        assert.strictEqual(/^a POSIX special builtin/.test(n.name!.said.title), SPECIAL.has(name), name);
      }
    }
    // The class is the one bash lists with `enable -s` (bash 5.2; the same list as `SPECIAL`).
    const listed = runBash('enable -s').stdout.split('\n').filter(Boolean).map((l) => l.replace(/^enable /, '')).sort();
    assert.deepStrictEqual(listed, [...SPECIAL].sort());
    // (In bash's POSIX mode, a function cannot have the name of a special builtin.)
    for (const name of Object.values(CHAPTER4).flat().filter((x) => /^[a-z]/.test(x))) {
      assert.strictEqual(/is a special builtin/.test(runBash(`set -o posix; ${name}() { :; }`).stderr), SPECIAL.has(name), name);
    }
  });

  it('cites 4.1 and 6.4 on the expression of `test` and `[`, and the builtin\'s section on a name `builtin` or a string runs', () => {
    for (const src of ['test ! -f a -a b', '[ ! -f a -a b ]']) {
      const tests = readingNodes(reading(src)).filter((n) => n.layer === 'command' && n.kind === 'test');
      assert.strictEqual(tests.length, 3, src);
      for (const t of tests) assert.deepStrictEqual(t.refs, ['4.1', '6.4'], `${src}: ${t.label}`);
    }
    // (Not those of the program: `env [` runs coreutils' `[`.)
    assert.ok(readingNodes(reading('env [ -f a ]')).filter((n) => n.kind === 'test').every((n) => !n.refs));
    assert.deepStrictEqual(find(reading('builtin cd /'), 'cd', 'commandName').refs, ['4.1']);
    const child = readingNodes(reading('eval "echo hi"')).find((n) => n.layer === 'child' && n.kind === 'commandName')!;
    assert.deepStrictEqual(child.refs, ['3.7.1', '3.7.2', '4.2']);
    // (The other nodes of such a string keep their tokens' sections, and a value cites none: `eval 'x=1'`.)
    const parts = readingNodes(reading("eval 'x=1'")).filter((n) => n.layer === 'child').map((n) => [n.kind, n.label, n.refs]);
    assert.deepStrictEqual(parts, [['assignment', 'x=1', ['3.4']], ['number', '1', undefined]]);
  });

  it('reads the operands of `set` as the positional parameters, `-` and `--` as 4.3.1 says', () => {
    const texts = (src: string) => readingNodes(reading(src)).filter((n) => n.layer === 'command').map((n) => `${n.label}: ${n.text}`);
    assert.deepStrictEqual(texts('set -- a b'), [
      '--: ends the options; the words after it become the positional parameters `$1`, `$2`…, even those that start with `-` (with none, the positional parameters are unset)',
      'a: becomes the positional parameter `$1`', 'b: becomes the positional parameter `$2`',
    ]);
    assert.match(texts('set - a')[0], /^-: ends the options, and turns `-x` and `-v` off/);
    assert.deepStrictEqual(texts('set a'), ['a: becomes the positional parameter `$1`']);
    // (After a word that may expand to more or fewer words, the numbers shift: `b` is `$4` when `$x` is `1 2`.)
    assert.deepStrictEqual(texts('set -- a $x b').slice(2), [
      '$x: becomes the positional parameter `$2` (if this word or one before it expands to more or fewer words, the number shifts)',
      'b: becomes the positional parameter `$3` (if this word or one before it expands to more or fewer words, the number shifts)',
    ]);
    assert.strictEqual(runBash('x="1 2"; set -- a $x b; echo "$4"').stdout, 'b\n');
  });

  it('says that the redirections of `exec` with no command apply to this shell (4.1), as bash does', () => {
    const t = (src: string) => find(reading(src), src, 'command').text!;
    assert.strictEqual(t('exec >log 2>&1'), 'Redirections of `exec` with no command: they apply to this shell itself, so its stdout (fd 1) and stderr (fd 2) stay redirected for every command after it');
    assert.match(t('exec 3>&1'), /its file descriptor 3 stays redirected/);
    assert.match(t('exec {fd}>f'), /this shell itself, so they stay for every command after it$/);
    // (With a command, they are that command's, as for any other.)
    assert.match(t('exec cat >log'), /^Redirection applied to `exec cat`/);
    const b = runBash('exec 3>&2 >log 2>&1; echo a; ls /none; cat log >&3', { files: [] });
    assert.match(b.stderr, /^a\nls: cannot access/);
  });
});

/** What an assignment to each variable of `variableAssignments` changes, in bash: a script and what it prints. */
const ASSIGNMENT_PROBES: Record<string, { script: string; stdout?: string | RegExp; stderr?: string | RegExp; files?: string[]; input?: string }> = {
  CDPATH: { script: 'mkdir -p d/sub; CDPATH=d; cd sub; basename "$PWD"', stdout: /\/d\/sub\nsub\n$/ },
  HOME: { script: 'HOME=/tmp; cd; pwd; echo ~', stdout: '/tmp\n/tmp\n' },
  OPTIND: { script: 'set -- -a; getopts a o; getopts a o; echo $?; OPTIND=1; getopts a o; echo "$? $o"', stdout: '1\n0 a\n' },
  // (Silent only at 0: 2 prints too.)
  OPTERR: { script: 'set -- -z; OPTERR=0; getopts a o; OPTIND=1; OPTERR=2; getopts a o', stderr: /^[^\n]*illegal option -- z\n$/ },
  // (An empty entry is the current directory.)
  PATH: { script: 'hash -p /bin/ls ls; hash -t ls; PATH=$PATH; hash -t ls; printf "#!/bin/sh\\necho mine\\n" > c; chmod +x c; PATH=:/usr/bin:/bin; c', stdout: '/bin/ls\nmine\n', stderr: /hash: ls: not found\n$/ },
  OLDPWD: { script: 'OLDPWD=/; cd - >/dev/null; pwd', stdout: '/\n' },
  PWD: { script: 'cd /; PWD=/x; pwd; echo $PWD', stdout: '/\n/x\n' },
  BASH_ALIASES: { script: 'BASH_ALIASES[ll]="echo hi"; alias ll; unset "BASH_ALIASES[ll]"; alias ll', stdout: "alias ll='echo hi'\nalias ll='echo hi'\n" },
  BASH_ARGV0: { script: 'BASH_ARGV0=foo; echo $0', stdout: 'foo\n' },
  BASH_CMDS: { script: 'BASH_CMDS[zz]=/bin/echo; hash -t zz; unset "BASH_CMDS[zz]"; hash -t zz', stdout: '/bin/echo\n/bin/echo\n' },
  BASH_COMPAT: { script: 'BASH_COMPAT=44; shopt -p compat44', stdout: 'shopt -s compat44\n' },
  BASH_ENV: { script: 'echo "echo from-env" > e; BASH_ENV=$PWD/e; bash -c "echo run"; export BASH_ENV; bash -c "echo run"', stdout: 'run\nfrom-env\nrun\n' },
  // (The descriptor written to before stays open.)
  BASH_XTRACEFD: { script: 'exec 3>t 4>/dev/null; BASH_XTRACEFD=4; BASH_XTRACEFD=3; [ -e /dev/fd/4 ] && echo open; set -x; : hi; set +x; cat t', stdout: 'open\n+ : hi\n+ set +x\n', stderr: '' },
  EXECIGNORE: { script: 'EXECIGNORE="*/ls"; ls / >/dev/null; echo $?', stdout: '127\n' },
  // (In a script: `bash -c` ends there in bash 5.3.)
  FUNCNEST: { script: 'printf \'FUNCNEST=3\\nf() { f; }\\ng() { f; echo in; }\\ng || echo or\\necho "status $?"\\n\' > s; "$BASH" s', stdout: 'status 1\n', stderr: /maximum function nesting level exceeded \(3\)/ },
  GLOBIGNORE: { script: 'GLOBIGNORE="*.o"; echo *; shopt -p dotglob', files: ['.h', 'a.o', 'b'], stdout: '.h b\nshopt -s dotglob\n' },
  POSIXLY_CORRECT: { script: 'POSIXLY_CORRECT=1; shopt -po posix; unset POSIXLY_CORRECT; shopt -po posix', stdout: 'set -o posix\nset +o posix\n' },
  PS3: { script: 'PS3="pick: "; select x in a; do echo $x; break; done', input: '1\n', stdout: 'a\n', stderr: '1) a\npick: ' },
  PS4: { script: "PS4='+$LINENO: '; set -x; :\n:", stderr: '+1: :\n+2: :\n' },
  RANDOM: { script: 'RANDOM=42; a=$RANDOM; RANDOM=42; b=$RANDOM; [ $a = $b ] && echo same', stdout: 'same\n' },
  SECONDS: { script: 'SECONDS=100; echo $SECONDS', stdout: '100\n' },
  TIMEFORMAT: { script: 'TIMEFORMAT=XX%0R; time :; TIMEFORMAT=; time :', stderr: 'XX0\n' },
  // (A FIFO open for reading and writing: `read` waits, with no writer to end it.)
  TMOUT: { script: 'mkfifo p; exec 3<>p; TMOUT=1; read x <&3; echo "status $?"', stdout: 'status 142\n' },
  // (`é` is one character in a UTF-8 locale, two bytes in C.)
  LANG: { script: 'unset LC_ALL; x=é; LANG=C.UTF-8; echo ${#x}; LANG=C; echo ${#x}', stdout: '1\n2\n' },
  LC_ALL: { script: 'x=é; LC_ALL=C.UTF-8; echo ${#x}; LC_ALL=C; echo ${#x}', stdout: '1\n2\n' },
  LC_CTYPE: { script: 'unset LC_ALL; x=é; LC_CTYPE=C.UTF-8; echo ${#x}; LC_CTYPE=C; echo ${#x}; LC_ALL=C.UTF-8; LC_CTYPE=C; echo ${#x}', stdout: '1\n2\n1\n' },
};

describe('the reading tree as the Bash manual reads the shell variables (chapter 5)', () => {
  const programs: BashOptions[] = [{}, ...(process.env.BASH_EXPLAINER_BASH53 ? [{ program: process.env.BASH_EXPLAINER_BASH53 }] : [])];
  const names = Object.keys(VARIABLE_SECTIONS).filter((n) => n !== '_');

  it('cites the section that describes each variable, as the manual lists them (5.1, 5.2)', () => {
    const doc = '/usr/share/doc/bash/bashref.html';
    if (fs.existsSync(doc)) {
      const html = fs.readFileSync(doc, 'utf8');
      const listed: Record<string, string> = {};
      for (const [id, section] of [['Bourne-Shell-Variables', '5.1'], ['Bash-Variables', '5.2']]) {
        const start = html.indexOf(`id="${id}"`);
        for (const m of html.slice(start, html.indexOf('<hr>', start + 10)).matchAll(/<dt[^>]*>.*?<code[^>]*>([A-Za-z_0-9]+)<\/code>/g)) listed[m[1]] = section;
      }
      assert.deepStrictEqual({ ...VARIABLE_SECTIONS }, listed);
    }
    for (const name of names) {
      const section = VARIABLE_SECTIONS[name];
      const r = reading(`echo $${name} \${${name}}`);
      // (`$PS1` also cites how a startup file tests it, 6.3.2: chapter 6.)
      assert.deepStrictEqual(find(r, `$${name}`, 'expansion').refs, ['3.5.3', section, ...(name === 'PS1' ? ['6.3.2'] : [])], name);
      assert.deepStrictEqual(find(r, name, 'name').refs, [section], name);
      assert.deepStrictEqual(find(reading(`${name}=1`), name, 'name').refs, [section], name);
    }
    // (In arithmetic, and the element of an array of bash's, which is an array's too: 6.7.)
    assert.deepStrictEqual(find(reading('echo $((RANDOM % 6))'), 'RANDOM', 'name').refs, ['5.2']);
    assert.deepStrictEqual(find(reading('echo "${BASH_SOURCE[0]}"'), 'BASH_SOURCE[0]', 'name').refs, ['6.7', '5.2']);
    // (Not a variable of the script's own, nor a special parameter: `$_` is in 5.2, and says what it expands to.)
    assert.deepStrictEqual(find(reading('echo $x ${y}'), '$x', 'expansion').refs, ['3.5.3']);
    assert.strictEqual(find(reading('echo $x ${y}'), 'y', 'name').refs, undefined);
    assert.deepStrictEqual(find(reading('echo $_'), '$_', 'expansion').refs, ['5.2']);
  });

  it('says what each variable is, and that bash keeps some read-only', () => {
    for (const name of names) {
      const text = find(reading(`echo $${name}`), `$${name}`, 'expansion').text!;
      assert.ok(text.startsWith(wellKnownVariables[name].en + (readonlyAtStart(name) ? ' (read-only)' : '')), `${name}: ${text}`);
    }
    // An array of bash's says itself that it is one: its name in `${BASH_SOURCE[0]}` is its description alone.
    const arrays = names.filter((n) => /[aA]/.test(BASH_VARIABLES[n].start ?? '')).concat(['BASH_REMATCH', 'PIPESTATUS', 'FUNCNAME', 'COPROC', 'MAPFILE', 'COMP_WORDS', 'COMPREPLY']);
    for (const name of arrays) assert.ok(/\barray\b/i.test(wellKnownVariables[name].en) && wellKnownVariables[name].ja.includes('配列'), name);
    const tokens = (ts: Token[]): Token[] => ts.flatMap((t) => [t, ...tokens(t.children)]);
    assert.strictEqual(tokens(explain('echo "${BASH_SOURCE[0]}"').items).find((t) => t.label === 'BASH_SOURCE')!.explanation, wellKnownVariables.BASH_SOURCE.en);
    // (Another variable with a description keeps the word: bash 5.3's `GLOBSORT`, a plain one to bash 5.2.)
    assert.match(tokens(explain('echo "${GLOBSORT[0]}"').items).find((t) => t.label === 'GLOBSORT')!.explanation, /^Array `GLOBSORT`: A plain variable in bash 5\.2/);
    // The read-only ones: an assignment fails, and the variable keeps its value; bash goes on (a command after a
    // prefix assignment runs too).
    const readonly = names.filter(readonlyAtStart);
    assert.deepStrictEqual(readonly, ['BASHOPTS', 'BASH_VERSINFO', 'EUID', 'PPID', 'SHELLOPTS', 'UID']);
    // An assignment of its own abandons the rest of the command of the script it is in: the line, or the loop or
    // function call around it; the next line runs, with status 1. In a subshell, the subshell ends. Before a command
    // name, the command still runs.
    const abandons = 'bash abandons the rest of the command of the script it is in (the line, or the loop or function call around it), status 1';
    for (const name of readonly) assert.strictEqual(find(reading(`${name}=1`), `${name}=1`, 'assignment').text, `\`${name}\` is read-only, so this assignment fails and its value stays: ${abandons}`);
    assert.match(explain('UID=0').notes.join('\n'), /The variable `UID` is read-only, so this assignment fails \(`readonly variable`\) and `UID` keeps its value; bash also abandons the rest of the command of the script it is in \(the line, or the loop or function call around it\) and goes on with the next one, status 1$/);
    assert.match(find(reading('readonly x=1\nx=2', 1), 'x=2', 'assignment').text!, /^`x` is read-only, so this assignment fails and its value stays: bash abandons/);
    assert.match(find(reading('for i in 1 2; do UID=0; done'), 'UID=0', 'assignment').text!, /: bash abandons/);
    assert.match(find(reading('(UID=0; echo in)'), 'UID=0', 'assignment').text!, /its value stays: the subshell ends there, status 1$/);
    assert.match(explain('x=$(UID=0)').notes.join('\n'), /keeps its value; the subshell ends there, status 1$/);
    assert.match(find(reading('UID=0 echo hi'), 'UID=0', 'assignment').text!, /its value stays: the command still runs, without it$/);
    assert.match(explain('UID=0 echo hi').notes.join('\n'), /keeps its value; the command still runs, without it$/);
    // (A function called in a subshell and outside it: what the main shell does.)
    assert.match(find(reading('f() { UID=0; }; f; (f)'), 'UID=0', 'assignment').text!, /: bash abandons/);
    // (In POSIX mode, and in dash, the shell ends there instead: not said.)
    assert.strictEqual(find(reading('set -o posix; UID=0'), 'UID=0', 'assignment').text, '`UID` is read-only, so this assignment fails and its value stays');
    const dash = analyzer.explainLine(parser.parse('readonly x=1; x=2'), 0, 'dash', { reading: true }).reading!;
    assert.strictEqual(find(dash, 'x=2', 'assignment').text, '`x` is read-only, so this assignment fails and its value stays');
    // (Read-only on some paths only: said so, with no warning.)
    const some = explain('[ "$1" ] && readonly x=1\nx=2', 1);
    assert.match(find(some.reading!, 'x=2', 'assignment').text!, /\. But some paths before here make it read-only, and there this assignment fails$/);
    assert.doesNotMatch(some.notes.join('\n'), /read-only/);
    // (Not the declaration that makes it read-only.)
    assert.doesNotMatch(readingNodes(reading('readonly x=1')).map((n) => n.text ?? '').join('\n'), /read-only, so/);
    for (const p of programs) {
      for (const name of readonly) assert.match(runBash(`${name}=1`, p).stderr, new RegExp(`${name}: readonly variable`), name);
      const b = runBash('u=$UID\nUID=0\necho "$? $((UID == u))"\nUID=0 /bin/echo ran', p);
      assert.deepStrictEqual(b.stdout, '1 1\nran\n', p.program ?? 'bash');
      const run = (script: string) => runBash(script, p).stdout;
      assert.strictEqual(run('UID=0; echo after\necho "next $?"'), 'next 1\n', p.program ?? 'bash');
      assert.strictEqual(run('for i in 1 2; do echo "iter $i"; UID=0; echo after; done; echo "after loop"\necho next'), 'iter 1\nnext\n', p.program ?? 'bash');
      assert.strictEqual(run('f() { echo in-f; UID=0; echo after; }; f; echo same\necho next'), 'in-f\nnext\n', p.program ?? 'bash');
      assert.strictEqual(run('(UID=0; echo in); echo "out $?"; x=$(UID=0; echo in); echo "[$x] $?"'), 'out 1\n[] 1\n', p.program ?? 'bash');
      assert.strictEqual(run('UID=0 echo hi; echo "status $?"'), 'hi\nstatus 0\n', p.program ?? 'bash');
      assert.strictEqual(run('set -o posix; UID=0\necho next'), '', p.program ?? 'bash');
    }
  });

  it('says what an assignment to a variable of bash\'s changes, from there on, as bash does', function () {
    this.timeout(20000);
    assert.deepStrictEqual(Object.keys(ASSIGNMENT_PROBES).sort(), Object.keys(variableAssignments).sort());
    for (const [name, effect] of Object.entries(variableAssignments)) {
      const src = name === 'BASH_ALIASES' || name === 'BASH_CMDS' ? `${name}[k]=v` : `${name}=v`;
      assert.ok(find(reading(src), src, 'assignment').text!.endsWith(`. ${effect.en}`), name);
      // (Not for one command: `PATH=/x cmd`.)
      assert.ok(!find(reading(`${src} cmd`), src, 'assignment').text!.includes(effect.en), name);
      for (const p of programs) {
        const { script, stdout, stderr, files, input } = ASSIGNMENT_PROBES[name];
        const b = runBash(script, { ...p, files: files ?? [], input });
        const check = (got: string, want: string | RegExp | undefined, what: string) => {
          if (typeof want === 'string') assert.strictEqual(got, want, `${name} ${what} ${p.program ?? 'bash'}`);
          else if (want) assert.match(got, want, `${name} ${what} ${p.program ?? 'bash'}`);
        };
        check(b.stdout, stdout, 'stdout');
        check(b.stderr, stderr, 'stderr');
      }
    }
    // `IFS` has its own text; an assignment bash ignores says so (test/bash-variables.test.ts checks which).
    assert.match(find(reading('IFS=:'), 'IFS=:', 'assignment').text!, /from here, unquoted expansions are split on `:`/);
    assert.match(find(reading('BASHPID=1'), 'BASHPID=1', 'assignment').text!, /\. Bash ignores this assignment \(it sets `BASHPID` itself\)$/);
    // (Also an assignment a declaration builtin reads.)
    const local = readingNodes(reading('f() { local OPTIND=1; }')).find((n) => n.layer === 'command' && n.kind === 'assignment')!;
    assert.match(local.text!, /`OPTIND=1` makes it start again at `\$1`$/);
    // An empty value may do something else: `BASH_XTRACEFD=` sends the trace back to stderr, and closes the
    // descriptor (even 2).
    assert.deepStrictEqual(Object.keys(variableEmptied).filter((n) => !Object.hasOwn(variableAssignments, n)), []);
    for (const src of ['BASH_XTRACEFD=', "BASH_XTRACEFD=''"]) assert.ok(find(reading(src), src, 'assignment').text!.endsWith(`. ${variableEmptied.BASH_XTRACEFD.en}`), src);
    assert.ok(find(reading('PATH='), 'PATH=', 'assignment').text!.endsWith(`. ${variableAssignments.PATH.en}`));
    for (const p of programs) {
      const b = runBash('exec 3>/dev/null; BASH_XTRACEFD=3; BASH_XTRACEFD=; [ -e /dev/fd/3 ] || echo closed; set -x; : hi; set +x; exec 5>&2; BASH_XTRACEFD=2; BASH_XTRACEFD=; echo gone >&2', p);
      assert.deepStrictEqual([b.stdout, b.stderr], ['closed\n', '+ : hi\n+ set +x\n'], p.program ?? 'bash');
    }
  });

  it('says that a local of a variable bash computes is a plain one, as bash does', () => {
    // `local RANDOM`, `declare SECONDS` in a function, and an assignment to it after: no seed, no count. (Bash's
    // other ones still do what they do: `local OPTIND=1`, above.)
    const plain = (name: string) => `. Here \`${name}\` is a local of the function, a plain variable: bash does nothing special with it (the \`${name}\` outside keeps its role)`;
    const text = (src: string, label: string) => readingNodes(reading(src)).find((n) => n.kind === 'assignment' && n.label === label)!.text!;
    assert.ok(text('f() { local RANDOM=3; }', 'RANDOM=3').endsWith(plain('RANDOM')));
    assert.ok(text('f() { declare SECONDS=100; }', 'SECONDS=100').endsWith(plain('SECONDS')));
    assert.ok(text('f() { local RANDOM; RANDOM=3; }; f', 'RANDOM=3').endsWith(plain('RANDOM')));
    assert.ok(text('f() { RANDOM=3; }; f', 'RANDOM=3').endsWith(`. ${variableAssignments.RANDOM.en}`));
    // (Nor does bash ignore one it would ignore outside: `local LINENO=5` is 5.)
    assert.strictEqual(text('f() { local LINENO=5; }', 'LINENO=5'), 'Assign a value to variable `LINENO` (no spaces around `=`)');
    // Unset there, the one outside keeps its role: no note.
    const r = explain('f() { local RANDOM; unset RANDOM; }; f');
    assert.doesNotMatch(r.notes.join('\n'), /loses/);
    for (const p of programs) {
      const b = (script: string) => runBash(script, p).stdout;
      assert.strictEqual(b('f() { local RANDOM=3; echo $RANDOM $RANDOM; declare SECONDS=100; sleep 1.1; echo $SECONDS; local LINENO=5; echo $LINENO; }; f'), '3 3\n100\n5\n', p.program ?? 'bash');
      assert.strictEqual(b('f() { local RANDOM; unset RANDOM; }; f; RANDOM=7; a=$RANDOM; RANDOM=7; [ $a = $RANDOM ] && [ $a != 7 ] && echo seeded'), 'seeded\n', p.program ?? 'bash');
    }
  });

  it('says that `unset` ends what bash does with a variable of the manual\'s list', () => {
    const r = explain('unset RANDOM PATH');
    assert.match(r.notes.join('\n'), /Once unset, `RANDOM` loses what bash does with it: set again later, it is a plain variable/);
    assert.doesNotMatch(r.notes.join('\n'), /`PATH` loses/);
    const texts = readingNodes(r.reading!).filter((n) => n.layer === 'command').map((n) => n.text);
    assert.deepStrictEqual(texts, [
      'Unset the variable `RANDOM` (it becomes undefined). `RANDOM` also loses what bash does with it (set again, it is a plain variable)',
      'Unset the variable `PATH` (it becomes undefined)',
    ]);
    assert.strictEqual(runBash('unset RANDOM; RANDOM=5; echo $RANDOM $RANDOM').stdout, '5 5\n');
    // In a subshell, there only.
    const sub = explain('( unset RANDOM ); echo $RANDOM');
    assert.match(sub.notes.join('\n'), /Once unset, `RANDOM` loses what bash does with it in this subshell \(`\( \)`\): set again there, it is a plain variable \(the shell outside keeps its `RANDOM`\)/);
    assert.match(readingNodes(sub.reading!).find((n) => n.layer === 'command' && n.label === 'RANDOM')!.text!, /\. In this subshell, `RANDOM` also loses what bash does with it \(set again there, it is a plain variable\)$/);
    for (const p of programs) {
      assert.strictEqual(runBash('( unset RANDOM; RANDOM=5; echo $RANDOM $RANDOM ); RANDOM=7; a=$RANDOM; RANDOM=7; [ $a = $RANDOM ] && [ $a != 7 ] && echo seeded', p).stdout, '5 5\nseeded\n', p.program ?? 'bash');
    }
    // (A function called in a subshell and outside it: what the main shell does.)
    assert.match(explain('f() { unset RANDOM; }; f; (f)').notes.join('\n'), /Once unset, `RANDOM` loses what bash does with it: set again later/);
  });

  it('describes what bash does with a variable as bash does', () => {
    for (const p of programs) {
      const b = (script: string, o: BashOptions = {}) => runBash(script, { ...p, ...o }).stdout;
      // `REPLY`: the line `read` reads with no name, whole, and the line typed to `select`.
      assert.strictEqual(b('read; echo "[$REPLY]"; select x in a b; do echo "[$x][$REPLY]"; break; done 2>/dev/null', { input: '  a b  \n2\n' }), '[  a b  ]\n[b][2]\n');
      // `FUNCNAME`: empty outside a function, `main` last in a script; `BASH_SOURCE[0]`: the file that defines the
      // function running; `BASH_ARGC`: not kept up to date without extdebug (it has only the script's frame).
      const lib = 'f() { echo "${FUNCNAME[*]} ${BASH_SOURCE[0]##*/} ${#BASH_ARGC[@]}"; }';
      assert.strictEqual(b(`echo '${lib}' > lib; printf 'echo "[\${FUNCNAME[*]}]"; . ./lib; f x; echo "\${BASH_SOURCE[0]##*/}"' > main; ${p.program ?? 'bash'} main`, { files: [] }), '[]\nf main lib 1\nmain\n');
      // `BASH_REMATCH`: empty after a match that fails. `BASHPID`: a subshell's own. `PS1`, `HISTFILE`: not set in a script.
      assert.strictEqual(b('[[ ab =~ (b) ]]; [[ ab =~ z ]]; echo "${#BASH_REMATCH[@]}"; [ $BASHPID = $(echo $BASHPID) ] || echo own; echo "[${PS1-unset}][${HISTFILE-unset}]"'), '0\nown\n[unset][unset]\n');
    }
  });
});

describe('the reading tree as the Bash manual reads aliases and arrays (chapter 6, 6.6 and 6.7)', () => {
  const programs: BashOptions[] = [{}, ...(process.env.BASH_EXPLAINER_BASH53 ? [{ program: process.env.BASH_EXPLAINER_BASH53 }] : [])];
  const all = (src: string, line = 0) => readingNodes(reading(src, line)).filter((n) => n.layer === 'bash');
  const node = (src: string, label: string, kind?: string, line = 0) => all(src, line).find((n) => n.label === label && (!kind || n.kind === kind))!;
  const said = (src: string, label: string, line = 0) => readingNodes(reading(src, line)).filter((n) => n.layer === 'command' && n.label === label).map((n) => n.text).join('\n');
  const notes = (src: string, line = 0) => explain(src, line).notes.join('\n');

  it('reads an element of an array as its name, `[`, the index and `]` (6.7); an indexed array\'s index as arithmetic (6.5)', () => {
    const src = 'a=(x y); echo ${a[i+1]} ${a[-1]} ${a[1]} ${a[$i]} ${a[i]} "${a[@]}" ${#a[*]} ${a[b[1]+2]} ${a[x y]}';
    assert.deepStrictEqual(kids(node(src, 'a[i+1]', 'name')), ['name a', 'operator [', 'expression i+1', 'operator ]']);
    assert.deepStrictEqual(node(src, '[', 'operator').refs, ['6.7']);
    const ix = node(src, 'i+1', 'expression');
    assert.deepStrictEqual([ix.refs, ix.text, kids(ix)], [['6.7', '6.5'], 'Index `i+1` (an arithmetic expression)', ['name i', 'operator +', 'expression 1']]);
    assert.deepStrictEqual(node(src, '+', 'operator').refs, ['6.7', '6.5']);
    assert.deepStrictEqual(kids(node(src, '-1', 'expression')), ['operator -', 'expression 1']);
    assert.strictEqual(node(src, '-1', 'expression').text, 'Index -1: the last element');
    assert.deepStrictEqual(kids(node(src, 'a[1]', 'name')), ['name a', 'operator [', 'expression 1', 'operator ]']);
    assert.deepStrictEqual(kids(node(src, 'a[$i]', 'name')), ['name a', 'operator [', 'expansion $i', 'operator ]']);
    assert.deepStrictEqual(kids(node(src, 'a[i]', 'name')), ['name a', 'operator [', 'name i', 'operator ]']);
    // `@` and `*`: all the elements, a node of their own.
    assert.deepStrictEqual(kids(node(src, 'a[@]', 'name')), ['name a', 'operator [', 'operator @', 'operator ]']);
    assert.deepStrictEqual([node(src, '@', 'operator').refs, node(src, '*', 'operator').text], [['6.7'], 'applies to every element of the array']);
    // (An element in the index, and an index that is no expression: a word, as bash would fail on it.)
    assert.deepStrictEqual(kids(node(src, 'b[1]+2', 'expression')), ['name b[1]', 'operator +', 'expression 2']);
    assert.deepStrictEqual(kids(node(src, 'b[1]', 'name')), ['name b', 'operator [', 'expression 1', 'operator ]']);
    assert.deepStrictEqual(node(src, 'x y', 'word').refs, ['6.7']);
    // An assignment's name, and arithmetic: the same parts.
    assert.deepStrictEqual(kids(node('a[i+1]=x', 'a[i+1]', 'name')), ['name a', 'operator [', 'expression i+1', 'operator ]']);
    assert.deepStrictEqual(kids(node('(( a[i]++ ))', 'a[i]', 'name')), ['name a', 'operator [', 'name i', 'operator ]']);
    assert.deepStrictEqual(kids(node('echo $((a[1] * 2))', 'a[1]', 'name')), ['name a', 'operator [', 'expression 1', 'operator ]']);
    // (A hexadecimal index says its value.)
    assert.match(node('(( a[0x10] ))', '0x10', 'expression').text!, /= 16 in decimal/);
    for (const p of programs) {
      assert.strictEqual(runBash('a=(x y z); i=0; echo ${a[i+1]} ${a[-1]} ${a[1+1]}; (( a[i]++ )); declare -p a', p).stdout, 'y z z\ndeclare -a a=([0]="1" [1]="y" [2]="z")\n');
      assert.strictEqual(runBash('declare -A m; k="a b"; m[$k]=1; m[i+1]=2; echo "${m[a b]} ${m[i+1]}"', p).stdout, '1 2\n');
    }
  });

  it('reads the index of an associative array as a key, a word bash expands, and says so where the kind is not known', () => {
    const src = 'declare -A m; m[$k]=1; echo "${m[$k]}" ${m[a b]}';
    assert.deepStrictEqual(kids(node(src, 'm[$k]', 'name')), ['name m', 'operator [', 'word $k', 'operator ]']);
    const key = all(src).filter((n) => n.label === '$k' && n.kind === 'word');
    assert.deepStrictEqual(key.map((n) => [n.refs, n.text, kids(n)]), [
      [['6.7', '3.5.3'], undefined, ['expansion $k']],
      [['6.7', '3.5.3'], 'Key `$k` (the keys of an associative array are strings, not evaluated)', ['expansion $k']],
    ]);
    assert.strictEqual(node(src, 'a b', 'word').text, 'Key `a b` (the keys of an associative array are strings, not evaluated)');
    // (After `source`, the array may be associative: a word.)
    const maybe = node('source f; echo ${a[i+1]}', 'i+1');
    assert.deepStrictEqual([maybe.kind, maybe.text], ['word', 'Index (or key, for associative arrays) `i+1`']);
  });

  it('shows the list of a compound assignment (6.7): its parentheses, its values, and `[k]=v` as its parts', () => {
    const src = 'a=(one $x [5]=five [i+1]+=six [1]= "[2]=z" *.txt)';
    const list = node(src, '(one $x [5]=five [i+1]+=six [1]= "[2]=z" *.txt)', 'part');
    assert.deepStrictEqual([list.refs, list.text], [['6.7'], 'Array: built from the elements inside `( )`']);
    assert.deepStrictEqual(kids(list), ['operator (', 'word one', 'word $x', 'word [5]=five', 'word [i+1]+=six', 'word [1]=', 'word "[2]=z"', 'word *.txt', 'operator )']);
    assert.deepStrictEqual(node(src, ')', 'operator').refs, ['6.7']);
    // Each value undergoes the expansions (3.5): `$x` is split and globbed, as bash does; `one` cites nothing.
    assert.deepStrictEqual([node(src, 'one', 'word').refs, node(src, '$x', 'word').refs], [undefined, ['3.5.3', '3.5.7', '3.5.8']]);
    const five = node(src, '[5]=five', 'word');
    assert.deepStrictEqual([five.text, kids(five)], ['Element with index `5`: set it to `five`', ['operator [', 'expression 5', 'operator ]', 'operator =', 'word five']]);
    assert.deepStrictEqual(kids(node(src, '[i+1]+=six', 'word')), ['operator [', 'expression i+1', 'operator ]', 'operator +=', 'word six']);
    assert.deepStrictEqual(kids(node(src, 'i+1', 'expression')), ['name i', 'operator +', 'expression 1']);
    assert.deepStrictEqual(kids(node(src, '[1]=', 'word')), ['operator [', 'expression 1', 'operator ]', 'operator =']);
    // (In an associative array's list, the key is a word; with an expansion, its part. A key that is no expression is a word too.)
    const assoc = 'declare -A m=([$k]=v [x y]=z)';
    assert.deepStrictEqual(kids(node(assoc, '[$k]=v', 'word')), ['operator [', 'word $k', 'operator ]', 'operator =', 'word v']);
    assert.deepStrictEqual(kids(node(assoc, '$k', 'word')), ['expansion $k']);
    assert.deepStrictEqual(node(assoc, 'x y', 'word').refs, ['6.7']);
    assert.deepStrictEqual(kids(node('a=([x y]=1)', '[x y]=1', 'word')), ['operator [', 'word x y', 'operator ]', 'operator =', 'word 1']);
    // (A value over two lines.)
    assert.deepStrictEqual(node('a=([3]="p\nq")', '"p', 'word').span, { start: { line: 0, character: 7 }, end: { line: 1, character: 2 } });
    for (const p of programs) {
      assert.strictEqual(runBash('a=(one [5]=five six); a+=(seven [1]=x eight); i=1; b=([i+1]=y z); declare -p a b', p).stdout,
        'declare -a a=([0]="one" [1]="x" [2]="eight" [5]="five" [6]="six" [7]="seven")\ndeclare -a b=([2]="y" [3]="z")\n');
    }
  });

  it('says what array a compound assignment makes (6.7), as bash does', () => {
    const text = (src: string, label: string) => all(src).find((n) => n.kind === 'assignment' && n.label === label)!.text;
    assert.strictEqual(text('a=(x [3]=y)', 'a=(x [3]=y)'), 'Assign to `a` an indexed array of the values in `( )` (from index 0; its old elements are removed); `[n]=value` sets index n, and the values after it go on from n+1');
    assert.strictEqual(text('a=(x); a+=(y)', 'a+=(y)'), 'Append the values in `( )` to the array `a`, after its last index');
    assert.strictEqual(text('a=()', 'a=()'), 'Make `a` an empty array');
    assert.strictEqual(text('a+=()', 'a+=()'), 'Add nothing to the array `a`');
    assert.match(text('source f; b=(x)', 'b=(x)')!, /\. If `b` is associative here, the values are its keys and values instead$/);
    assert.strictEqual(said('declare -A m=([k]=v)', 'm=([k]=v)'), 'Assign to the associative array `m` (its old elements are removed): each `[key]=value` sets a key');
    assert.strictEqual(said('declare -A m=(k1 v1)', 'm=(k1 v1)'), 'Assign to the associative array `m` (its old elements are removed): the values are keys and values in turn (`k1` is a key, `v1` its value; the first value has no `[key]=`, so a `[key]=value` is a key or a value too)');
    assert.match(said('declare -A m=(k)', 'm=(k)'), /\(`k` is a key, with an empty value;/);
    assert.strictEqual(said('declare -A m=()', 'm=()'), 'Empty the associative array `m` (it stays associative)');
    assert.strictEqual(text('declare -A m; m+=([j]=w)', 'm+=([j]=w)'), 'Add keys to the associative array `m` (a key it has gets the new value): each `[key]=value` sets a key');
    assert.strictEqual(text('declare -A m; m+=()', 'm+=()'), 'Add nothing to the associative array `m`');
    // In the list of keys and values, `[k]=v` is a key; after a first `[k]=v`, a value with none is refused.
    const pairs = 'declare -A m=(k1 v1 [k2]=v2 7)';
    assert.deepStrictEqual(['k1', 'v1', '[k2]=v2', '7'].map((w) => [node(pairs, w).text, kids(node(pairs, w))]), [
      ['Key `k1`', []], ['Value `v1` of the key `k1`', []], ['Key `[k2]=v2`', []], ['Value `7` of the key `[k2]=v2`', []],
    ]);
    assert.match(node('declare -A h=([a]=1 b)', 'b').text!, /^Bash refuses this value: the first value starts with `\[key\]=`, so each one needs its `\[key\]=`/);
    for (const p of programs) {
      const b = (s: string) => runBash(s, p);
      // (The keys, sorted: bash lists them in an order of its own.)
      const keys = 'for k in "${!m[@]}"; do echo "$k=${m[$k]}"; done | sort';
      assert.strictEqual(b(`declare -A m=([a]=1); m=([b]=2); ${keys}; m+=([b]=3 [c]=4); ${keys}; m=(); declare -p m`).stdout, 'b=2\nb=3\nc=4\ndeclare -A m=()\n');
      assert.strictEqual(b(`declare -A m=(k1 v1 [k2]=v2 7); ${keys}; declare -A o=(k); declare -p o`).stdout, '[k2]=v2=7\nk1=v1\ndeclare -A o=([k]="" )\n');
      assert.match(b('declare -A h=([a]=1 b)').stderr, /b': must use subscript when assigning associative array/);
      assert.strictEqual(b('a=(1 2); a=(); a+=(); declare -p a').stdout, 'declare -a a=()\n');
    }
  });

  it('reads a value `[k]=v` as an assignment does: no splitting or globbing; nor in an associative array\'s list', () => {
    const src = 'a=([0]=$x [1]=host* y$x)';
    assert.deepStrictEqual([node(src, '$x', 'word').refs, node(src, 'host*', 'word').refs, node(src, '[1]=host*', 'word').text], [undefined, undefined, 'Element with index `1`: set it to `host*`']);
    assert.deepStrictEqual(node(src, 'y$x', 'word').refs, ['3.5.7', '3.5.8']);
    assert.deepStrictEqual(node('declare -A m=(k $x *)', '$x', 'word').refs, ['3.5.3']);
    assert.deepStrictEqual(node('declare -A m=(k $x *)', '*', 'word').refs, undefined);
    for (const p of programs) {
      assert.strictEqual(runBash('x="p q"; a=([0]=$x [1]=* y$x); declare -A m=(k $x [*]=*); declare -p a; echo "${m[k]}|${m[[*]=*]-unset}|${#m[@]}"', { ...p, files: ['f1', 'f2'] }).stdout,
        'declare -a a=([0]="p q" [1]="*" [2]="yp" [3]="q")\np q||2\n');
    }
  });

  it('says what bash does with `a[@]=x`, `unset \'a[@]\'`, `declare x[3]` and `$a[1]` (6.7)', () => {
    assert.match(node('a=(1); a[@]=x', 'a[@]=x', 'assignment').text!, /^Bash refuses this assignment: `@` is no index of an indexed array \("bad array subscript", status 1\)$/);
    assert.match(node('source f; a[*]=x', 'a[*]=x', 'assignment').text!, /status 1; if `a` is associative, it sets the element with the key `\*`\)$/);
    assert.match(node('declare -A m; m[@]=x', 'm[@]=x', 'assignment').text!, /with the key `@`/);
    assert.deepStrictEqual(kids(node('a=(1); a[@]=x', 'a[@]', 'name')), ['name a', 'operator [', 'operator @', 'operator ]']);
    assert.strictEqual(said("declare -A m; unset 'm[@]'", "'m[@]'"), 'Unset the element of the associative array `m` with the key `@` (not all the elements)');
    assert.strictEqual(said("a=(1); unset 'a[@]'", "'a[@]'"), 'Remove all the elements of the array `a` (it stays, empty)');
    assert.strictEqual(said("source f; unset 'a[*]'", "'a[*]'"), 'Remove all the elements of the array `a` (it stays, empty; if it is associative, only the element with the key `*`)');
    assert.strictEqual(said("a=(1); unset 'a[-1]'", "'a[-1]'"), 'Unset the element `a[-1]` of the array `a` (the other elements keep their indices; a negative index counts back from the end)');
    assert.match(said('declare -a x[3]', 'x[3]'), /^Declare the array `x` \(bash ignores the subscript `\[3\]`\)/);
    assert.match(said('export e[1]', 'e[1]'), /^Bash refuses this word: it is not a valid variable name \("not a valid identifier", status 1\)/);
    assert.match(said('declare -p a[1]', 'a[1]'), /^No variable is named `a\[1\]`: nothing is printed \("not found", status 1\)/);
    // `$a[1]` is `$a`, then the text `[1]`, where `a` is an array: also in double quotes, and in an associative array.
    assert.match(notes('a=(x y); echo $a[1] "$a[i]"'), /`\$a\[1\]` is not an element of the array: it is `\$a` \(that is `\$\{a\[0\]\}`\) followed by the text `\[1\]`[^\n]*`\$\{a\[1\]\}`[^\n]*\n.*`\$a\[i\]`/);
    assert.match(notes('declare -A h; echo $h[k]'), /`\$h\[k\]` is not an element/);
    assert.doesNotMatch(notes('x=1; echo $x[1] $1[2] ${x}[1]'), /is not an element/);
    for (const p of programs) {
      const b = (s: string) => runBash(s, p);
      assert.match(b('a=(1); a[@]=x').stderr, /a\[@\]: bad array subscript/);
      assert.strictEqual(b("a=(1 2 3); unset 'a[-1]'; declare -p a; unset 'a[@]'; declare -p a; declare -A m=([@]=x [y]=z); unset 'm[@]'; declare -p m").stdout,
        'declare -a a=([0]="1" [1]="2")\ndeclare -a a=()\ndeclare -A m=([y]="z" )\n');
      assert.strictEqual(b("declare -a x[3]; declare -p x; declare -p 'a[1]'; echo $?").stdout, 'declare -a x\n1\n');
      assert.match(b("export 'e[1]'; echo $?").stderr, /`e\[1\]': not a valid identifier/);
      assert.strictEqual(b('a=(x y); echo $a[1] "$a[i]"').stdout, 'x[1] x[i]\n');
    }
  });

  it('reads the word after an alias whose text ends with a blank as an alias too (6.6), as bash does', () => {
    const src = "shopt -s expand_aliases\nalias s='sudo ' ll='ls -l' n='s ' t='echo T'\ns ll x\ns n ll\ns x ll\nt ll\ns >/dev/null ll\nalias a/b=x\nalias s='sudo '";
    assert.deepStrictEqual(kids(node(src, 's ll x', 'command', 2)), ['aliasWord s', 'aliasWord ll', 'argument x']);
    const ll = node(src, 'll', 'aliasWord', 2);
    assert.deepStrictEqual([ll.refs, ll.replacement, kids(ll), ll.text], [['6.6'], 'ls -l', ['argument ls', 'argument -l'],
      'The alias `ll` defined on line 2: replaced by `ls -l`. The text of the alias before it ends with a blank, so bash checks this word for an alias too']);
    assert.deepStrictEqual(kids(node(src, 's n ll', 'command', 3)), ['aliasWord s', 'aliasWord n', 'aliasWord ll']);
    // Not after a word that is no alias, an alias whose text ends otherwise, or a redirection.
    assert.deepStrictEqual(kids(node(src, 's x ll', 'command', 4)), ['aliasWord s', 'argument x', 'argument ll']);
    assert.deepStrictEqual(kids(node(src, 't ll', 'command', 5)), ['aliasWord t', 'argument ll']);
    assert.deepStrictEqual(kids(node(src, 's >/dev/null ll', 'command', 6)), ['aliasWord s', 'redirect >/dev/null', 'argument ll']);
    // The definitions say so, and that bash refuses a name with `/`.
    assert.match(said(src, 'a/b=x', 7), /^a definition bash refuses: an alias name may not have `\/`, `\$`, a backquote, a quote, a backslash, a blank or a metacharacter \("invalid alias name", status 1\)$/);
    assert.match(said(src, "s='sudo '", 8), /The text ends with a blank, so bash checks the word after this alias for an alias too/);
    // The state follows it: `c d` runs `command declare x=1`; not in a file that may not expand aliases.
    const tree = parser.parse("#!/bin/bash\nshopt -s expand_aliases\nalias c='command ' d='declare x=1'\nc d\necho \"[$x]\"");
    assert.strictEqual(shellState(tree).at(tree.root.namedChildren[4]).run.variables.get('x')?.value, '1');
    const maybe = parser.parse("alias c='command ' d='declare x=1'\nc d\necho \"[$x]\"");
    assert.notStrictEqual(shellState(maybe).at(maybe.root.namedChildren[2]).run.variables.get('x')?.set, 'on');
    for (const p of programs) {
      const b = (s: string) => runBash(`shopt -s expand_aliases\nalias s='echo S ' ll='echo LL' n='s ' t='echo T' c='command ' d='declare x=1'\n${s}`, p);
      assert.strictEqual(b('s ll x\ns n ll\ns x ll\nt ll\ns >&1 ll\nc d\necho "[$x]"').stdout, 'S echo LL x\nS echo S echo LL\nS x ll\nT ll\nS ll\n[1]\n');
      assert.match(b("alias 'a/b=x'; echo $?").stderr, /`a\/b': invalid alias name/);
    }
  });

  it('cites no empty list of sections', () => {
    for (const src of ['a=(one two)', 'echo "${x:-\'a\'}"', 'declare -A m=(k v)', 'cat < f']) {
      assert.deepStrictEqual(readingNodes(reading(src)).filter((n) => n.refs && !n.refs.length).map((n) => n.label), [], src);
    }
  });

  // (The review of this round: each case checked with bash 5.2 and 5.3.)
  const minor = (p: BashOptions) => runBash('echo ${BASH_VERSINFO[1]}', p).stdout.trim();

  it('says a definition is refused only when its name is known, and what `alias =x` does', () => {
    for (const [src, w] of [['alias cdp="cd $HOME/projects"', 'cdp="cd $HOME/projects"'], ['alias "$n=$v"', '"$n=$v"'], ['alias l=$(echo ls)', 'l=$(echo ls)'], ['alias ls="ls $X "', 'ls="ls $X "']]) {
      assert.doesNotMatch(said(src, w), /refuses|ends with a blank/, src);
    }
    assert.match(said('alias =x', '=x'), /^no name before `=`: bash looks for an alias named by the whole word to print it, finds none, and fails \("not found", status 1\)$/);
    assert.match(said('alias a\\\\b=x', 'a\\\\b=x'), /^a definition bash refuses: an alias name may not have `\/`, `\$`, a backquote, a quote, a backslash,/);
    for (const p of programs) {
      const r = runBash('n=a v=b; alias cdp="cd $HOME/projects"; echo $?; alias "$n=$v"; echo $?; alias l=$(echo ls); echo $?; alias =x; echo $?', p);
      assert.strictEqual(r.stdout, '0\n0\n0\n1\n');
      assert.match(r.stderr, /alias: =x: not found/);
    }
  });

  it('stays fast on a line of many words that may be aliases', () => {
    const src = `shopt -s expand_aliases\nif [ "$1" ]; then alias e="echo "; else alias e="printf %s "; fi\n${Array(60).fill('e').join(' ')}`;
    const start = Date.now();
    assert.strictEqual(node(src, 'e', 'aliasWord', 2).kind, 'aliasWord');
    assert.ok(Date.now() - start < 3000, `${Date.now() - start} ms`);
  });

  it('reads the values of an associative array\'s list with no braces, and says what each is', () => {
    const src = 'declare -A m=(t ~ k {a,b} $x *)';
    assert.deepStrictEqual([node(src, '{a,b}', 'word').refs, node(src, '{a,b}', 'word').text, kids(node(src, '{a,b}', 'word'))], [undefined, 'Value `{a,b}` of the key `k`', []]);
    assert.strictEqual(node(src, '$x', 'expansion').text, 'Key `$x`: Expands to the value of `x`');
    assert.strictEqual(node(src, '~', 'word').text, 'Value `~` of the key `t`. bash 5.2 keeps the `~` as written; bash 5.3 expands it to the home directory');
    assert.match(node('declare -A g=([t]=~)', '[t]=~', 'word').text!, /set it to `~`\. bash 5\.2 keeps the `~` as written; bash 5\.3 expands it/);
    // (A value of several parts keeps them; a comment in the list is one.)
    assert.deepStrictEqual([node('declare -A m=(k x$y)', 'x$y', 'word').text, kids(node('declare -A m=(k x$y)', 'x$y', 'word'))], ['Value `x$y` of the key `k`', ['expansion $y']]);
    assert.deepStrictEqual(kids(node('declare -A m=(k # c\n v)', '(k # c', 'part')), ['operator (', 'word k', 'comment # c', 'word v', 'operator )']);
    for (const p of programs) {
      const r = runBash('x="p q"; declare -A m=(t ~ k {a,b} $x *); echo "${m[t]}|${m[k]}|${m[p q]}"', { ...p, env: { HOME: '/h' } }).stdout;
      assert.strictEqual(r, `${minor(p) === '2' ? '~' : '/h'}|{a,b}|*\n`);
    }
  });

  it('says what bash 5.2 and 5.3 do with `[4]={a,b}` and with a value missing its `[k]=`', () => {
    const src = 'a=([4]={a,b} [2]=x)';
    const braced = node(src, '[4]={a,b}', 'word');
    assert.deepStrictEqual([kids(braced), braced.text], [['brace {a,b}'], 'bash 5.2 brace-expands this word first, into the values `[4]=a`, `[4]=b`, with no index of their own (each is the next element); bash 5.3 does not, and sets `{a,b}` as the element with the index `4`']);
    assert.match(node('declare -A h=([a]=1 b)', 'b').text!, /bash 5\.2 says so and goes on; bash 5\.3 also abandons the rest of the line \(status 1\)$/);
    for (const p of programs) {
      const five2 = minor(p) === '2';
      assert.strictEqual(runBash('a=([4]={a,b}); declare -p a', p).stdout, five2 ? 'declare -a a=([0]="[4]=a" [1]="[4]=b")\n' : 'declare -a a=([4]="{a,b}")\n');
      assert.strictEqual(runBash('declare -A h=([a]=1 b); echo same; declare -p h\necho next', p).stdout, five2 ? 'same\ndeclare -A h=([a]="1" )\nnext\n' : 'next\n');
    }
  });

  it('reads the word after a quoted one as an alias, and says what an alias in an alias is', () => {
    const src = "shopt -s expand_aliases\nalias e='echo ' b='B' a2='b2 ' b2='c2 ' c2='echo C' t=s s='echo '\ne \"b\" b\ne \"$v\" \\b b\ne $v b\na2 a2\nt e b\nx=$(e b)";
    assert.deepStrictEqual(kids(node(src, 'e "b" b', 'command', 2)), ['aliasWord e', 'argument "b"', 'aliasWord b']);
    assert.deepStrictEqual(kids(node(src, 'e "$v" \\b b', 'command', 3)), ['aliasWord e', 'argument "$v"', 'argument \\b', 'aliasWord b']);
    assert.deepStrictEqual(kids(node(src, 'e $v b', 'command', 4)), ['aliasWord e', 'argument $v', 'argument b']);
    assert.deepStrictEqual(kids(node(`${src}\ne b"" b`, 'e b"" b', 'command', 8)), ['aliasWord e', 'argument b""', 'aliasWord b']);
    assert.match(node(src, 'a2', 'aliasWord', 5) && all(src, 5).filter((n) => n.kind === 'aliasWord')[1].text!, /^The alias `a2` defined on line 2: replaced by `b2 ` \(`b2` is an alias too, for `c2 `\)\. The text of the alias before it/);
    assert.match(node(src, 't', 'aliasWord', 6).text!, /\(`s` is an alias too, for `echo `; its text ends with a blank, but only bash 5\.3 then checks the next word for an alias, not bash 5\.2\)/);
    const sub = readingNodes(reading(src, 7)).find((n) => n.kind === 'aliasWord' && n.label === 'b')!;
    assert.deepStrictEqual([sub.layer, sub.process], ['child', 'subshell']);
    for (const p of programs) {
      const r = runBash(`shopt -s expand_aliases\nalias e='echo ' b='B' a2='b2 ' b2='c2 ' c2='echo C' t=s s='echo '\ne "b" b\ne "$v" \\b b\ne $v b\na2 a2\nt e b`, p).stdout;
      assert.strictEqual(r, `b B\n b B\nb\nC echo C\n${minor(p) === '2' ? 'e b' : 'echo B'}\n`);
    }
  });

  it('says that `$a[1]` is a glob only where bash globs it', () => {
    assert.match(notes('a=(x); echo $a[1]'), /followed by the text `\[1\]` \(a glob too, here\)\./);
    for (const src of ['a=(x); [[ $a[1] == x ]]', 'a=(x); [[ x =~ $a[1] ]]', 'a=(x); case $a[1] in x) ;; esac', 'a=(x); echo "$a[1]"']) {
      assert.match(notes(src), /followed by the text `\[1\]`\. For the element/, src);
    }
  });

  it('reads an index that is no one arithmetic expression as a word', () => {
    // (Text that `(( ))` reads as more than one statement, a list, or a statement and a comment.)
    for (const ix of ['1))|((2', '1)) && ((1', '1)) #', 'x y']) assert.strictEqual(node(`a=(1); echo \${a[${ix}]}`, ix).kind, 'word', ix);
  });
});
