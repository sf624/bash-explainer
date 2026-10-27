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
      assert.deepStrictEqual(find(r, `$${name}`, 'expansion').refs, ['3.5.3', section], name);
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
