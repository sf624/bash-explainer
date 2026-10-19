import * as assert from 'assert';
import * as fs from 'fs';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { descendants, field, fields, hasError, token } from '../src/syntax/tree';
import type { SyntaxNode } from '../src/syntax/tree';
import { Analyzer } from '../src/analyzer';
import type { Token } from '../src/analyzer';
import { corpus, invariants } from './support/corpus';

// The unbash adapter builds the model of a script. The first part holds the expected trees of the inputs
// that tree-sitter (the parser used before) read wrongly, the invariants of the trees of the fixtures and
// of the snippets of the tests; the rest, the shapes of each construct.

const ub = createUnbashParser();


/** A tree as one line: named nodes in parentheses with their field, tokens quoted, the text of the leaves. */
const outline = (n: SyntaxNode): string => (n.named
  ? `(${n.type}${n.field ? ' @' + n.field : ''}${n.incomplete ? ' INCOMPLETE' : ''}${n.children.length ? ' ' + n.children.map(outline).join(' ') : ' ' + JSON.stringify(n.text)})`
  : JSON.stringify(n.type));
const types = (n: SyntaxNode, t: string): SyntaxNode[] => descendants(n, [t]);

// Inputs that tree-sitter read wrongly (it failed to read the script, or read it in a way that is not bash's): the tree
// the unbash adapter must give (README, Limitations).
interface Wrong { name: string; text: string; why: string; expected: string }
const WRONG: Wrong[] = [
  {
    name: 'a pipeline of three, then a line with && (tree-sitter#347)',
    text: 'a | b | c\n[[ x ]] && d',
    why: 'the line with && and the lines between are taken as arguments of the last command of the pipeline',
    expected: '(program (pipeline (command (command_name @name (word "a"))) "|" (command (command_name @name (word "b"))) "|" (command (command_name @name (word "c")))) '
      + '(list (extended_test "[[" (word "x") "]]") "&&" (command (command_name @name (word "d")))))',
  },
  {
    name: 'for without in',
    text: 'for i do :; done',
    why: 'a syntax error, and "done" a command',
    expected: '(program (for_statement "for" (variable_name @variable "i") (do_group @body "do" (command (command_name @name (word ":"))) ";" "done")))',
  },
  {
    name: 'coproc with a name',
    text: 'coproc name { :; }',
    why: 'a command named coproc, with the braces as arguments',
    expected: '(program (coproc_statement "coproc" (word @name "name") (compound_statement @body "{" (command (command_name @name (word ":"))) ";" "}")))',
  },
  {
    name: 'coproc without a name',
    text: 'coproc ls -l',
    why: 'a command named coproc',
    expected: '(program (coproc_statement "coproc" (command @body (command_name @name (word "ls")) (word @argument "-l"))))',
  },
  {
    name: 'a double negation',
    text: '! ! a',
    why: 'the second ! is a word',
    expected: '(program (negated_command "!" (negated_command "!" (command (command_name @name (word "a"))))))',
  },
  {
    name: 'a here string after a compound command',
    text: '{ cat; } <<< x 2>&1',
    why: 'a syntax error at <<<',
    expected: '(program (redirected_statement (compound_statement @body "{" (command (command_name @name (word "cat"))) ";" "}") '
      + '(herestring_redirect @redirect "<<<" (word "x")) (file_redirect @redirect (file_descriptor @descriptor "2") ">&" (number @destination "1"))))',
  },
  {
    name: 'a brace group never closed',
    text: '{ echo',
    why: 'an error node over the whole input',
    expected: '(program (compound_statement INCOMPLETE "{" (command (command_name @name (word "echo")))))',
  },
  {
    name: 'a case never closed',
    text: 'case x in a)',
    why: 'an error node over the whole input',
    expected: '(program (case_statement INCOMPLETE "case" (word @value "x") "in" (case_item (word @value "a") ")")))',
  },
  {
    name: 'a for loop with nothing after it',
    text: 'for',
    why: 'an error node',
    expected: '(program (for_statement INCOMPLETE "for"))',
  },
  {
    name: 'a string never closed',
    text: 'echo "abc',
    why: 'an error node for the string, and the command without it',
    expected: '(program (command (command_name @name (word "echo")) (string @argument INCOMPLETE "\\"" (string_content "abc"))))',
  },
  {
    name: 'a command substitution never closed',
    text: 'echo $(',
    why: 'an error node for the $(',
    expected: '(program (command (command_name @name (word "echo")) (command_substitution @argument INCOMPLETE "$(")))',
  },
  {
    name: 'an expansion never closed',
    text: 'echo ${a',
    why: 'an error node for the ${ and the name',
    expected: '(program (command (command_name @name (word "echo")) (expansion @argument INCOMPLETE "${" (variable_name "a"))))',
  },
  {
    name: 'a pipe with nothing after it',
    text: 'echo a |',
    why: 'a command with an empty name after the pipe',
    expected: '(program (pipeline INCOMPLETE (command (command_name @name (word "echo")) (word @argument "a")) "|"))',
  },
  {
    name: 'an && with nothing after it',
    text: 'echo a &&',
    why: 'a command with an empty name after the &&',
    expected: '(program (list INCOMPLETE (command (command_name @name (word "echo")) (word @argument "a")) "&&"))',
  },
];


describe('unbash adapter: the fixtures and the snippets', () => {
  const { files, snippets } = corpus();

  describe('the shell code of the fixtures', () => {
    for (const f of files) {
      it(`${f.name}: a sound tree without errors`, () => {
        const b = ub.parse(f.text);
        assert.deepEqual(b.errors, []);
        assert.deepEqual(invariants(b), []);
        assert.equal(b.text, f.text);
      });
    }
  });

  it('the snippets of the tests give sound trees, also where they are not bash', () => {
    const bad: string[] = [];
    for (const { text } of snippets) {
      const b = ub.parse(text);
      const broken = invariants(b);
      if (broken.length) bad.push(`${JSON.stringify(text)}: ${broken[0]}`);
      if (b.root.text !== text.slice(b.root.startIndex)) bad.push(`${JSON.stringify(text)}: the text`);
    }
    assert.deepEqual(bad, []);
    assert.ok(snippets.length > 500, `${snippets.length} snippets`);
  });

  describe('inputs tree-sitter read wrongly', () => {
    for (const w of WRONG) {
      it(`${w.name}`, () => {
        const b = ub.parse(w.text);
        assert.equal(outline(b.root), w.expected);
        assert.deepEqual(invariants(b), []);
      });
    }
    it('are all among the snippets, except the ones made for this test', () => {
      const all = new Set(snippets.map((s) => s.text));
      assert.ok(WRONG.filter((w) => all.has(w.text)).length >= 1);
    });
  });
});

// What the adapter makes of each construct.
const tree = (text: string) => ub.parse(text);
const first = (text: string): SyntaxNode => tree(text).root.namedChildren.find((c) => c.type !== 'comment')!;
/** The tokens (keywords and operators) that are direct children of the node, as `text@start`. */
const toks = (n: SyntaxNode): string[] => n.children.filter((c) => !c.named).map((c) => `${c.type}@${c.startIndex}`);
/** The texts of the named children, as `type:text`. */
const kids = (n: SyntaxNode): string[] => n.namedChildren.map((c) => `${c.type}:${c.text}`);

/** Where the words are in the text, found one after the other: `seq('a; b', 'a', ';', 'b')` is `['a@0', ';@1', 'b@3']`. */
function seq(text: string, ...words: string[]): string[] {
  let at = 0;
  return words.map((w) => {
    const i = text.indexOf(w, at);
    assert.ok(i >= 0, `${w} in ${text}`);
    at = i + w.length;
    return `${w}@${i}`;
  });
}

describe('unbash adapter: tokens and comments', () => {
  it('every keyword is a token with its range', () => {
    const text = 'if a; then b; elif c; then d; else e; fi';
    const t = first(text);
    assert.deepEqual(toks(t), ['if@0', ';@4', 'then@6', ';@12', 'fi@38']);
    assert.deepEqual(kids(t), ['command:a', 'command:b', 'elif_clause:elif c; then d;', 'else_clause:else e;']);
    assert.deepEqual(toks(t.namedChildren[2]), ['elif@14', ';@20', 'then@22', ';@28']);
    assert.deepEqual(toks(t.namedChildren[3]), ['else@30', ';@36']);
  });
  it('a keyword in a comment is not a token', () => {
    const text = 'if true; # then\nthen :; fi';
    const t = first(text);
    assert.deepEqual(toks(t), ['if@0', ';@7', 'then@16', ';@22', 'fi@24']);
    assert.deepEqual(t.children.filter((c) => c.type === 'comment').map((c) => c.text), ['# then']);
  });
  it('loops, case, select, functions and groups have their keywords', () => {
    const loop = 'for i in a b; do :; done';
    assert.deepEqual(toks(first(loop)), seq(loop, 'for', 'in', ';'));
    assert.deepEqual(toks(field(first(loop), 'body')!), seq(loop, 'do', ';', 'done'));
    assert.deepEqual(toks(first('while a; do b; done')).slice(0, 1), ['while@0']);
    assert.deepEqual(toks(first('until a; do b; done')).slice(0, 1), ['until@0']);
    const sel = 'select x in a; do :; done';
    assert.deepEqual(toks(first(sel)).slice(0, 2), seq(sel, 'select', 'in'));
    const cs = 'case $x in a|b) :;; (c) :;& d) :;;& esac';
    assert.deepEqual(toks(first(cs)), seq(cs, 'case', 'in', 'esac'));
    assert.deepEqual(toks(first('function f { :; }')).slice(0, 1), ['function@0']);
    assert.deepEqual(toks(first('f() { :; }')), ['(@1', ')@2']);
    assert.deepEqual(toks(first('{ :; }')), ['{@0', ';@3', '}@5']);
    assert.deepEqual(toks(first('( : )')), ['(@0', ')@4']);
    assert.deepEqual(toks(first('[[ -f a ]]')), ['[[@0', ']]@8']);
    assert.deepEqual(toks(first('(( 1 ))')), ['((@0', '))@5']);
    assert.deepEqual(toks(first('! a')), ['!@0']);
  });
  it('case items have their separators and terminators', () => {
    const text = 'case $x in a|b) :;; (c) :;& d) :;;& e) :\nesac';
    const items = first(text).namedChildren.filter((n) => n.type === 'case_item');
    assert.deepEqual(items.map(toks), [seq(text, '|', ')', ';;'), ['(@20', ')@22', ';&@25'], [')@29', ';;&@32'], [')@37']]);
    assert.deepEqual(items.map((i) => field(i, 'termination')?.text ?? field(i, 'fallthrough')?.text ?? null), [';;', ';&', ';;&', null]);
  });
  it('every operator is a token: ;  &  &&  ||  |  |&', () => {
    const t = tree('a && b || c; d | e |& f &\ng');
    assert.deepEqual(toks(t.root), [';@11', '&@24']);
    const list = t.root.namedChildren[0];
    assert.deepEqual(toks(list), ['||@7']);
    assert.deepEqual(toks(list.namedChildren[0]), ['&&@2']);
    assert.deepEqual(toks(t.root.namedChildren[1]), ['|@15', '|&@19']);
  });
  it('finds operators past comments, line continuations and heredoc bodies', () => {
    const text = 'a && # c\n  b ||\\\n c\ncat <<E && ls\nbody && fi\nE\nd';
    const t = tree(text);
    const lists = descendants(t.root, ['list']);
    assert.deepEqual(lists.map(toks), [['||@' + text.indexOf('||')], ['&&@2'], ['&&@' + text.indexOf('&& ls')]]);
    assert.deepEqual(types(t.root, 'comment').map((c) => c.text), ['# c']);
    const heredoc = types(t.root, 'heredoc_redirect')[0];
    assert.equal(heredoc.text, '<<E && ls\nbody && fi\nE');
    assert.deepEqual(toks(heredoc), ['<<@' + text.indexOf('<<')]);
  });
  it('every comment is a comment node, in the node it lies in', () => {
    const t = tree('# one\necho a # two\nif x; then # three\n  y # four\nfi # five\necho $(z # six\n) "$(w # seven\n)"\n(# eight\n:)\nx=(a # nine\n b)');
    assert.deepEqual(types(t.root, 'comment').map((c) => c.text), ['# one', '# two', '# three', '# four', '# five', '# six', '# seven', '# eight', '# nine']);
    assert.deepEqual(t.root.children.filter((c) => c.type === 'comment').map((c) => c.text), ['# one', '# two', '# five']);
    assert.equal(types(t.root, 'if_statement')[0].children.filter((c) => c.type === 'comment').length, 2);
    assert.equal(types(t.root, 'command_substitution')[0].children.filter((c) => c.type === 'comment').length, 1);
    assert.equal(types(t.root, 'array')[0].children.filter((c) => c.type === 'comment').length, 1);
  });
  it('does not take a # inside a word or a string for a comment', () => {
    const t = tree('echo a#b "# c" \'# d\' ${x#y} $((1#2)) \\#e');
    assert.deepEqual(types(t.root, 'comment'), []);
  });
});

const o = (text: string): string => outline(tree(text).root);
const errorsOf = (text: string): string => tree(text).errors.map((e) => `${e.kind}@${e.startIndex}-${e.endIndex}`).join(' ');

describe('unbash adapter: heredocs', () => {
  it('has the start, the body and the end, with the expansions of the body', () => {
    assert.equal(o('cat <<E\n${a} $(b) $((1)) $c\nE'),
      '(program (redirected_statement (command @body (command_name @name (word "cat"))) (heredoc_redirect @redirect "<<" (heredoc_start "E") '
      + '(heredoc_body (expansion "${" (variable_name "a") "}") (heredoc_content " ") (command_substitution "$(" (command (command_name @name (word "b"))) ")") (heredoc_content " ") '
      + '(arithmetic_expansion "$((" (number "1") "))") (heredoc_content " ") (simple_expansion "$" (variable_name "c")) (heredoc_content "")) (heredoc_end "E"))))');
  });
  it('has no parts in the body when the delimiter is quoted', () => {
    const h = types(tree('cat <<"E"\n$a\nE').root, 'heredoc_body')[0];
    assert.deepEqual(h.children, []);
    assert.equal(h.text, '$a\n');
  });
  it('goes on with the rest of its line as bash does: a pipeline, a list, more redirections', () => {
    assert.equal(o('cat <<E | wc -l\nx\nE'),
      '(program (pipeline (redirected_statement (command @body (command_name @name (word "cat"))) (heredoc_redirect @redirect "<<" (heredoc_start "E") (heredoc_body "x\\n") (heredoc_end "E"))) '
      + '"|" (command (command_name @name (word "wc")) (word @argument "-l"))))');
    assert.equal(o('a <<E && b\nx\nE'),
      '(program (list (redirected_statement (command @body (command_name @name (word "a"))) (heredoc_redirect @redirect "<<" (heredoc_start "E") (heredoc_body "x\\n") (heredoc_end "E"))) '
      + '"&&" (command (command_name @name (word "b")))))');
    assert.equal(o('cat <<A 2>&1 >f\n1\nA'),
      '(program (redirected_statement (command @body (command_name @name (word "cat"))) (heredoc_redirect @redirect "<<" (heredoc_start "A") (heredoc_body "1\\n") (heredoc_end "A")) '
      + '(file_redirect @redirect (file_descriptor @descriptor "2") ">&" (number @destination "1")) (file_redirect @redirect ">" (word @destination "f"))))');
    // `|` binds tighter than `&&`: the list is outside.
    const t = tree('a <<E | b && c\nx\nE\nd');
    assert.equal(first('a <<E | b && c\nx\nE\nd').type, 'list');
    assert.deepEqual(first('a <<E | b && c\nx\nE\nd').namedChildren.map((c) => c.type), ['pipeline', 'command']);
    assert.deepEqual(invariants(t), []);
  });
  it('lets the heredoc node end with its body, with the rest of its line inside its range but not in it', () => {
    const text = 'cat <<E; echo b\nx\nE\necho c';
    const t = tree(text);
    assert.deepEqual(t.root.namedChildren.map((c) => c.type), ['redirected_statement', 'command', 'command']);
    assert.deepEqual(invariants(t), []);
    const h = types(t.root, 'heredoc_redirect')[0];
    assert.equal(h.text, '<<E; echo b\nx\nE');
    assert.equal(outline(h), '(heredoc_redirect @redirect "<<" (heredoc_start "E") (heredoc_body "x\\n") (heredoc_end "E"))');
    assert.equal(t.root.namedChildren[1].text, 'echo b');
    assert.deepEqual(toks(t.root), [';@' + text.indexOf(';')]);
    const u = tree('cat <<E & echo b\nx\nE\n');
    assert.deepEqual(invariants(u), []);
    assert.deepEqual(toks(u.root), ['&@' + 'cat <<E '.length]);
  });
  it('has the arguments after the delimiter in the command', () => {
    const t = tree('cat <<EOF out.txt\nhi\nEOF');
    assert.deepEqual(invariants(t), []);
    assert.equal(o('cat <<EOF out.txt\nhi\nEOF'),
      '(program (command (command_name @name (word "cat")) (heredoc_redirect @redirect "<<" (heredoc_start "EOF") (heredoc_body "hi\\n") (heredoc_end "EOF")) (word @argument "out.txt")))');
    // A redirection after the last word is the statement's.
    assert.equal(o('cat <<EOF out.txt >f\nhi\nEOF'),
      '(program (redirected_statement (command @body (command_name @name (word "cat")) (heredoc_redirect @redirect "<<" (heredoc_start "EOF") (heredoc_body "hi\\n") (heredoc_end "EOF")) (word @argument "out.txt")) '
      + '(file_redirect @redirect ">" (word @destination "f"))))');
  });
  it('lets <<- strip the tabs of the first line and of the closing line', () => {
    assert.equal(o('cat <<-"E"\n\tx $a\n\tE'),
      '(program (redirected_statement (command @body (command_name @name (word "cat"))) (heredoc_redirect @redirect "<<-" (heredoc_start "\\"E\\"") (heredoc_body "x $a\\n\\t") (heredoc_end "E"))))');
  });
  it('has the closing line after a <<- line that goes on, with the tabs of the body and of the line', () => {
    const text = 'sftp -b - <<-EOF || return 1\n\tx\n\tEOF';
    const t = tree(text);
    assert.deepEqual(t.errors, []);
    const h = types(t.root, 'heredoc_redirect')[0];
    assert.deepEqual(h.children.map((c) => c.type), ['<<-', 'heredoc_start', 'heredoc_body', 'heredoc_end']);
    assert.deepEqual(first(text).namedChildren.map((c) => c.type), ['redirected_statement', 'command']);
    assert.equal(types(t.root, 'heredoc_end')[0].text, 'EOF');
    assert.equal(h.endIndex, text.length);
  });
  it('is incomplete without its closing line, which unbash does not report', () => {
    for (const text of ['cat <<EOF\nabc\n', 'cat <<EOF', 'cat <<-EOF\n\tabc\n\tEO', 'cat <<EOF | wc\nabc']) {
      const t = tree(text);
      const h = types(t.root, 'heredoc_redirect')[0];
      assert.equal(h.incomplete, true, text);
      assert.deepEqual(t.errors.map((e) => [e.kind, e.message]), [['missing', 'Missing "heredoc_end"']], text);
      assert.deepEqual(invariants(t), [], text);
      assert.equal(hasError(t.root), true);
    }
    assert.equal(types(tree('cat <<EOF').root, 'heredoc_body').length, 1);
  });
  it('has the right ends: of the node, and of the next statement after the body', () => {
    const t = tree('cat <<EOF\nx\nEOF\necho after');
    const [a, b] = t.root.namedChildren;
    assert.equal(a.text, 'cat <<EOF\nx\nEOF');
    assert.equal(b.text, 'echo after');
    assert.equal(b.startPosition.row, 3);
    const two = tree('cat <<A <<B\n1\nA\n2\nB');
    assert.deepEqual(invariants(two), []);
    assert.equal(types(two.root, 'heredoc_end').length, 2);
  });
});

describe('unbash adapter: [ ] and [[ ]]', () => {
  it('[ ] holds its words flat, between its brackets; test stays a command', () => {
    assert.equal(o('[ ! -f "$a" -a x = y* ]'),
      '(program (test_command "[" (word "!") (word "-f") (string "\\"" (simple_expansion "$" (variable_name "a")) "\\"") (word "-a") (word "x") (word "=") (extglob_pattern "y*") "]"))');
    assert.equal(first('test -f a').type, 'command');
    assert.equal(tree('[ -f a').root.namedChildren[0].incomplete, true);
    assert.equal(errorsOf('[ -f a'), 'missing@6-6');
    assert.equal(first('[ a ] > f').type, 'redirected_statement');
  });
  it('[[ ]] keeps its expressions, with regex and extglob_pattern on the right', () => {
    assert.equal(o('[[ -f a && ( $b =~ ^x+ || c == d* ) && ! e ]]'),
      '(program (extended_test "[[" (binary_expression (binary_expression @left (unary_expression @left (test_operator @operator "-f") (word "a")) "&&" '
      + '(parenthesized_expression @right "(" (binary_expression (binary_expression @left (simple_expansion @left "$" (variable_name "b")) "=~" (regex @right "^x+")) "||" '
      + '(binary_expression @right (word @left "c") "==" (extglob_pattern @right "d*"))) ")")) "&&" (unary_expression @right "!" (word "e"))) "]]"))');
    assert.equal(o('[[ $x ]]'), '(program (extended_test "[[" (simple_expansion "$" (variable_name "x")) "]]"))');
    assert.equal(o('[[ $a == *"$e"* ]]').includes('(extglob_pattern @right "*") (string @right'), true);
    assert.equal(o('[[ $a == d$y ]]').includes('(concatenation @right (word "d")'), true);
    assert.equal(o('[[ $a =~ $re ]]').includes('(simple_expansion @right'), true);
    assert.equal(o('[[ a -eq 1 && b == 2 ]]').includes('(number @right "1")'), true);
  });
  it('[[ is incomplete without ]], also with an operator and nothing after it', () => {
    for (const text of ['[[ -f', '[[ a', '[[ a ==']) {
      assert.equal(first(text).incomplete, true, text);
      assert.equal(first(text).type, 'extended_test', text);
      assert.deepEqual(invariants(tree(text)), [], text);
    }
  });
});

describe('unbash adapter: time, coproc, select and (( ))', () => {
  it('time -p pipeline: the pipeline is the body', () => {
    assert.equal(o('time -p ls | wc'),
      '(program (time_statement "time" (word @option "-p") (pipeline @body (command (command_name @name (word "ls"))) "|" (command (command_name @name (word "wc"))))))');
    assert.equal(o('time ls -l >o'),
      '(program (time_statement "time" (redirected_statement @body (command @body (command_name @name (word "ls")) (word @argument "-l")) (file_redirect @redirect ">" (word @destination "o")))))');
    // `time` is a keyword only at the start of a pipeline.
    assert.equal(o('a | time b'), '(program (pipeline (command (command_name @name (word "a"))) "|" (command (command_name @name (word "time")) (word @argument "b"))))');
    assert.equal(first('a && time b').namedChildren[1].type, 'time_statement');
    assert.equal(o('time'), '(program (time_statement "time"))');
    assert.equal(o('time -p >o'), '(program (redirected_statement (time_statement @body "time" (word @option "-p")) (file_redirect @redirect ">" (word @destination "o"))))');
    assert.equal(o('time ! a | b'), '(program (time_statement "time" (negated_command @body "!" (pipeline (command (command_name @name (word "a"))) "|" (command (command_name @name (word "b")))))))');
    assert.equal(o('! time a'), '(program (negated_command "!" (time_statement "time" (command @body (command_name @name (word "a"))))))');
    assert.equal(first('time a && b').type, 'list');
    assert.equal(first('FOO=1 time ls').type, 'command');
  });
  it('coproc: the name, and a command or a group as the body', () => {
    assert.equal(o('coproc ls -l'), '(program (coproc_statement "coproc" (command @body (command_name @name (word "ls")) (word @argument "-l"))))');
    assert.equal(o('coproc NAME { :; }'), '(program (coproc_statement "coproc" (word @name "NAME") (compound_statement @body "{" (command (command_name @name (word ":"))) ";" "}")))');
    assert.equal(o('coproc ls >f').startsWith('(program (coproc_statement "coproc" (redirected_statement @body'), true);
    const bare = tree('coproc');
    assert.equal(bare.root.namedChildren[0].type, 'coproc_statement');
    assert.deepEqual(bare.root.namedChildren[0].children.map((c) => c.type), ['coproc']);
  });
  it('select is a select_statement; (( )) an arithmetic_command', () => {
    assert.equal(o('select x in a b; do :; done'),
      '(program (select_statement "select" (variable_name @variable "x") "in" (word @value "a") (word @value "b") ";" (do_group @body "do" (command (command_name @name (word ":"))) ";" "done")))');
    assert.equal(o('(( x++ ))'), '(program (arithmetic_command "((" (postfix_expression (variable_name "x") "++") "))"))');
    assert.equal(o('(( ))'), '(program (arithmetic_command "((" "))"))');
    assert.equal(first('((a').incomplete, true);
    assert.equal(first('((a').type, 'arithmetic_command');
  });
});


/** The outline of the first node of this type, without the field it has in its parent. */
const bare = (text: string, type: string): string => outline(types(tree(text).root, type)[0]).replace(/^\((\S+) @\w+/, '($1');

describe('unbash adapter: expansions and arithmetic', () => {
  it('has the operators of ${ } as tokens', () => {
    assert.equal(bare('echo ${a:-b}', 'expansion'), '(expansion "${" (variable_name "a") ":-" (word "b") "}")');
    assert.equal(bare('echo ${#a}', 'expansion'), '(expansion "${" "#" (variable_name "a") "}")');
    assert.equal(bare('echo ${#}', 'expansion'), '(expansion "${" "#" "}")');
    assert.equal(bare('echo ${!a[@]}', 'expansion'), '(expansion "${" "!" (subscript (variable_name @name "a") "[" (word @index "@") "]") "}")');
    assert.equal(bare('echo ${a[-1]}', 'expansion'), '(expansion "${" (subscript (variable_name @name "a") "[" (unary_expression @index "-" (number "1")) "]") "}")');
    assert.equal(bare('echo ${a/b/c} ${a//b} ${a/#b/c}', 'expansion'), '(expansion "${" (variable_name "a") "/" (regex "b") "/" (word "c") "}")');
    assert.equal(bare('echo ${a%%.*}', 'expansion'), '(expansion "${" (variable_name "a") "%%" (regex ".*") "}")');
    assert.equal(bare('echo ${a#$b}', 'expansion'), '(expansion "${" (variable_name "a") "#" (regex "$b") "}")');
    assert.equal(bare('echo ${a#"b"}', 'expansion'), '(expansion "${" (variable_name "a") "#" (string "\\"" (string_content "b") "\\"") "}")');
    assert.equal(bare('echo ${a#}', 'expansion'), '(expansion "${" (variable_name "a") "#" "}")');
    assert.equal(bare('echo ${a:1:2}', 'expansion'), '(expansion "${" (variable_name "a") ":" (number "1") ":" (number "2") "}")');
    assert.equal(bare('echo ${a: -1}', 'expansion'), '(expansion "${" (variable_name "a") ":" (number "-1") "}")');
    assert.equal(bare('echo ${a:i+1}', 'expansion'), '(expansion "${" (variable_name "a") ":" (binary_expression (variable_name "i") "+" (number "1")) "}")');
    assert.equal(bare('echo ${a:1:}', 'expansion'), '(expansion "${" (variable_name "a") ":" (number "1") ":" "}")');
    assert.equal(bare('echo ${a^^}', 'expansion'), '(expansion "${" (variable_name "a") "^^" "}")');
    assert.equal(bare('echo ${a,,[a-c]}', 'expansion'), '(expansion "${" (variable_name "a") ",," (regex "[a-c]") "}")');
    assert.equal(bare('echo ${a@Q}', 'expansion'), '(expansion "${" (variable_name "a") "@" "Q" "}")');
    assert.equal(bare('echo ${!a*}', 'expansion'), '(expansion "${" "!" (variable_name "a") "*" "}")');
    assert.equal(bare('echo ${1} ${@}', 'expansion'), '(expansion "${" (variable_name "1") "}")');
    assert.equal(bare('echo ${@}', 'expansion'), '(expansion "${" (special_variable_name "@") "}")');
    assert.equal(bare('echo ${a:-}', 'expansion'), '(expansion "${" (variable_name "a") ":-" "}")');
    assert.equal(bare('echo ${a:-$(b)}', 'expansion'), '(expansion "${" (variable_name "a") ":-" (command_substitution "$(" (command (command_name @name (word "b"))) ")") "}")');
  });
  it('has $v, $1, $@ and $_', () => {
    assert.equal(bare('echo $v', 'simple_expansion'), '(simple_expansion "$" (variable_name "v"))');
    assert.equal(bare('echo $1', 'simple_expansion'), '(simple_expansion "$" (variable_name "1"))');
    assert.equal(bare('echo $@', 'simple_expansion'), '(simple_expansion "$" (special_variable_name "@"))');
    assert.equal(bare('echo $_', 'simple_expansion'), '(simple_expansion "$" (special_variable_name "_"))');
  });
  it('has command, process and arithmetic substitutions', () => {
    assert.equal(bare('echo $(a)', 'command_substitution'), '(command_substitution "$(" (command (command_name @name (word "a"))) ")")');
    assert.equal(bare('echo `a`', 'command_substitution'), '(command_substitution "`" (command (command_name @name (word "a"))) "`")');
    assert.equal(bare('cat <(a) >(b)', 'process_substitution'), '(process_substitution "<(" (command (command_name @name (word "a"))) ")")');
    assert.equal(bare('echo $((1+2))', 'arithmetic_expansion'), '(arithmetic_expansion "$((" (binary_expression (number @left "1") "+" (number @right "2")) "))")');
    assert.equal(bare('echo $[1+2]', 'arithmetic_expansion'), '(arithmetic_expansion "$[" (binary_expression (number @left "1") "+" (number @right "2")) "]")');
    assert.equal(bare('echo $(( ))', 'arithmetic_expansion'), '(arithmetic_expansion "$((" "))")');
  });
  it('has arithmetic: operators, ternary, unary and postfix, a comma list, names and words', () => {
    assert.equal(o('(( a[1] = 3, -b + ${c} * $d ? 1 : (2) ))'),
      '(program (arithmetic_command "((" (binary_expression (subscript @left (variable_name @name "a") "[" (number @index "1") "]") "=" (number @right "3")) "," '
      + '(ternary_expression (binary_expression @condition (unary_expression @left "-" (variable_name "b")) "+" (binary_expression @right (expansion @left "${" (variable_name "c") "}") "*" '
      + '(simple_expansion @right "$" (variable_name "d")))) "?" (number @consequence "1") ":" (parenthesized_expression @alternative "(" (number "2") ")")) "))"))');
    assert.equal(bare('echo $((a++ + --b))', 'arithmetic_expansion'),
      '(arithmetic_expansion "$((" (binary_expression (postfix_expression @left (variable_name "a") "++") "+" (unary_expression @right "--" (variable_name "b"))) "))")');
    assert.equal(bare('echo $((0x1f + 16#ff + 07))', 'arithmetic_expansion').includes('(number @left "0x1f")'), true);
    assert.equal(bare('echo $(($(a) + `b`))', 'arithmetic_expansion').includes('(command_substitution @left "$(" (command (command_name @name (word "a"))) ")")'), true);
    assert.equal(bare('echo $((a ? b : c, d))', 'arithmetic_expansion').includes('"," (variable_name "d")'), true);
    assert.equal(bare('echo $((x, (y, z)))', 'arithmetic_expansion').includes('(parenthesized_expression "(" (variable_name "y") "," (variable_name "z") ")")'), true);
  });
  it('has the three parts of for ((;;))', () => {
    assert.equal(o('for ((i=0;i<3;i++)); do :; done'),
      '(program (c_style_for_statement "for" "((" (variable_assignment @initializer (variable_name @name "i") "=" (number @value "0")) ";" '
      + '(binary_expression @condition (word @left "i") "<" (number @right "3")) ";" (postfix_expression @update (word "i") "++") "))" ";" '
      + '(do_group @body "do" (command (command_name @name (word ":"))) ";" "done")))');
    assert.equal(o('for ((;;)); do :; done'), '(program (c_style_for_statement "for" "((" ";" ";" "))" ";" (do_group @body "do" (command (command_name @name (word ":"))) ";" "done")))');
    assert.equal(o('for ((i = 0, j = 1; ; i += 2, j++)) { :; }').includes('"," (variable_assignment'), false);
  });
  it('is incomplete when an expansion is not closed', () => {
    assert.equal(o('echo $((1+'), '(program (command (command_name @name (word "echo")) (arithmetic_expansion @argument INCOMPLETE "$((" (binary_expression (number @left "1") "+"))))');
    assert.equal(o('echo ${a'), '(program (command (command_name @name (word "echo")) (expansion @argument INCOMPLETE "${" (variable_name "a"))))');
    assert.equal(o('echo $(a'), '(program (command (command_name @name (word "echo")) (command_substitution @argument INCOMPLETE "$(" (command (command_name @name (word "a"))))))');
    assert.equal(errorsOf('echo "a ${b'), 'missing@11-11 missing@11-11');
    assert.equal(o("echo 'abc"), '(program (command (command_name @name (word "echo")) (raw_string @argument INCOMPLETE "\'abc")))');
    assert.equal(o("echo $'abc"), '(program (command (command_name @name (word "echo")) (ansi_c_string @argument INCOMPLETE "$\'abc")))');
    assert.equal(first("echo 'a'").namedChildren[1].incomplete, false);
  });
});

describe('unbash adapter: unfinished input', () => {
  // unbash gives zero-width nodes for these; the adapter ends them where their content ends.
  const open: [string, string, string][] = [
    // text, type of the open node, the missing token
    ['if x; then', 'if_statement', 'fi'],
    ['if x; then y', 'if_statement', 'fi'],
    ['if x; then y; else z', 'if_statement', 'fi'],
    ['if x; then y; elif z', 'if_statement', 'fi'],
    ['while a; do b', 'do_group', 'done'],
    ['until a; do b', 'do_group', 'done'],
    ['for i in a; do b', 'do_group', 'done'],
    ['for ((;;)); do b', 'do_group', 'done'],
    ['select x in a; do b', 'do_group', 'done'],
    ['case x in a) b', 'case_statement', 'esac'],
    ['case x in', 'case_statement', 'esac'],
    ['{ echo', 'compound_statement', '}'],
    ['f() {', 'compound_statement', '}'],
    ['(a; b', 'subshell', ')'],
    ['[[ -f x', 'extended_test', ']]'],
    ['(( a', 'arithmetic_command', '))'],
    ['[ -f x', 'test_command', ']'],
    ['echo "abc', 'string', '"'],
    ['echo $(a', 'command_substitution', ')'],
    ['echo `a', 'command_substitution', '`'],
    ['cat <(a', 'process_substitution', ')'],
    ['echo ${a', 'expansion', '}'],
    ['echo $((1', 'arithmetic_expansion', '))'],
  ];
  for (const [text, type, missing] of open) {
    it(`${JSON.stringify(text)}: the ${type} is incomplete`, () => {
      const t = tree(text);
      const n = types(t.root, type)[0];
      assert.ok(n, type);
      assert.equal(n.incomplete, true);
      assert.deepEqual(t.errors.filter((e) => e.kind === 'missing').map((e) => e.message), [`Missing "${missing}"`]);
      assert.deepEqual(t.errors.filter((e) => e.kind !== 'missing'), []);
      // The node ends where its content ends (and the error is there), not before it.
      assert.equal(n.endIndex, t.errors[0].endIndex);
      assert.equal(n.endIndex <= text.length, true);
      assert.deepEqual(invariants(t), []);
      assert.equal(hasError(t.root), true);
      assert.equal(t.root.incomplete, false);
      // The closing token is not there.
      assert.ok(n.children.filter((c) => !c.named && c.type === missing).every((c) => c.startIndex === n.startIndex));
    });
  }
  it('extends an open node over a trailing newline of its last statement, and over the comments after it', () => {
    const t = tree('while a; do b\n# c\n\n');
    const g = types(t.root, 'do_group')[0];
    assert.equal(g.text, 'do b\n# c');
    assert.equal(types(t.root, 'while_statement')[0].endIndex, g.endIndex);
    assert.equal(tree('while true; do\n echo hi\n').root.namedChildren[0].endIndex, 24);
    assert.equal(types(tree('if x; then # hi\n  \n').root, 'comment').length, 1);
  });
  it('ends an open node before the closer of the group that holds it', () => {
    const t = tree('(if x; then y\n)');
    assert.equal(types(t.root, 'if_statement')[0].endIndex, 14);
    assert.equal(first('(if x; then y\n)').type, 'subshell');
    assert.equal(first('(if x; then y\n)').incomplete, false);
    const u = tree('{ a; if b; then c; }');
    assert.equal(first('{ a; if b; then c; }').type, 'compound_statement');
    assert.equal(types(u.root, 'if_statement')[0].incomplete, true);
    assert.equal(types(u.root, 'compound_statement')[0].incomplete, false);
  });
  it('an open loop inside a closed if', () => {
    const t = tree('if a; then\n  while b; do c\nfi');
    assert.equal(types(t.root, 'if_statement')[0].incomplete, false);
    assert.equal(types(t.root, 'do_group')[0].incomplete, true);
    assert.deepEqual(invariants(t), []);
  });
  it('a for without its do, and a function without its body', () => {
    assert.equal(o('for i in a b'), '(program (for_statement INCOMPLETE "for" (variable_name @variable "i") "in" (word @value "a") (word @value "b")))');
    assert.equal(errorsOf('for i in a b'), 'missing@12-12');
    assert.equal(o('for'), '(program (for_statement INCOMPLETE "for"))');
    assert.equal(o('f()'), '(program (function_definition INCOMPLETE (word @name "f") "(" ")"))');
    assert.equal(o('function g'), '(program (function_definition INCOMPLETE "function" (word @name "g")))');
    assert.equal(o('while true; do\n').includes('INCOMPLETE'), true);
    assert.equal(o('for ((;;))').includes('INCOMPLETE'), true);
  });
  it('reports echo a | and echo a && and the like itself: the operator, in an open pipeline or list', () => {
    assert.equal(o('echo a |'), '(program (pipeline INCOMPLETE (command (command_name @name (word "echo")) (word @argument "a")) "|"))');
    assert.equal(errorsOf('echo a |'), 'missing@8-8');
    assert.equal(o('echo a |&'), '(program (pipeline INCOMPLETE (command (command_name @name (word "echo")) (word @argument "a")) "|&"))');
    assert.equal(o('echo a &&'), '(program (list INCOMPLETE (command (command_name @name (word "echo")) (word @argument "a")) "&&"))');
    assert.equal(o('echo a ||\n'), '(program (list INCOMPLETE (command (command_name @name (word "echo")) (word @argument "a")) "||"))');
    assert.equal(o('a | b |').startsWith('(program (pipeline INCOMPLETE (command (command_name @name (word "a"))) "|" (command (command_name @name (word "b"))) "|"))'), true);
    assert.equal(o('a && b ||').includes('(list INCOMPLETE (list '), true);
    assert.equal(o('a | b && c |').includes('"&&" (pipeline INCOMPLETE (command (command_name @name (word "c"))) "|")'), true);
    assert.equal(o('echo a | # c\n').startsWith('(program (pipeline INCOMPLETE'), true);
    assert.equal(o('echo a | \\\n').startsWith('(program (pipeline INCOMPLETE'), true);
    assert.equal(o('echo a |\n\n').includes('INCOMPLETE'), true);
    // A pipe followed by something is not dangling
    assert.equal(o('echo a | b').includes('INCOMPLETE'), false);
    assert.equal(o('echo a & ').includes('INCOMPLETE'), false);
    assert.equal(hasError(tree('echo a |').root), true);
  });
  it('! alone, and ! ! alone', () => {
    assert.equal(o('!'), '(program (negated_command INCOMPLETE "!"))');
    assert.equal(errorsOf('!'), 'missing@1-1');
    assert.equal(o('! !').includes('(negated_command INCOMPLETE'), true);
  });
  it('a here-document with no closing line is reported by the adapter', () => {
    assert.equal(errorsOf('cat <<EOF\nabc\n'), 'missing@14-14');
  });
  it('an array with no ) is an incomplete array', () => {
    assert.equal(o('a=(1 2'), '(program (variable_assignment (variable_name @name "a") "=" (array @value INCOMPLETE "(" (number "1") (number "2"))))');
    assert.equal(o('a=(b "c d"').includes('INCOMPLETE'), true);
  });
  it('text unbash cannot read is an error node and an unreadable error', () => {
    for (const text of ['f(1 2)', 'a ) b', 'if then fi', 'ls @(a', 'echo ok ) && x']) {
      const t = tree(text);
      assert.ok(t.errors.some((e) => e.kind === 'unreadable'), text);
      assert.ok(types(t.root, 'error').length >= 1 || t.errors.some((e) => e.kind === 'unreadable'), text);
      assert.deepEqual(invariants(t), [], text);
      assert.equal(hasError(t.root), true);
    }
    const t = tree('echo ok ) && x');
    const e = types(t.root, 'error')[0];
    assert.equal(e.text, ')');
    assert.equal(e.parent!.type, 'program');
    // (The `x` after the `&&` is text unbash dropped too.)
    assert.deepEqual(t.errors.map((x) => [x.kind, x.startIndex, x.endIndex]), [['unreadable', 8, 9], ['unreadable', 13, 14]]);
    assert.deepEqual(types(t.root, 'error').map((x) => x.text), [')', 'x']);
    // Not an error: the input just stops where a command is expected.
    assert.deepEqual(tree('for i in a; do').errors.map((x) => x.kind), ['missing']);
    // An error inside a command substitution goes into its node.
    const s = tree('echo $(a ) b )');
    assert.equal(types(s.root, 'error').length >= 1, true);
  });
});

describe('unbash adapter: words, assignments and redirections', () => {
  it('has strings, quotes, concatenations, numbers and brace expressions', () => {
    assert.equal(o('echo "a$b c" \'d\' $\'e\\n\' ~/x a=b "p"q $"r" {1..3} {a..e..2} {a,b}'),
      '(program (command (command_name @name (word "echo")) (string @argument "\\"" (string_content "a") (simple_expansion "$" (variable_name "b")) (string_content " c") "\\"") '
      + '(raw_string @argument "\'d\'") (ansi_c_string @argument "$\'e\\\\n\'") (word @argument "~/x") (word @argument "a=b") '
      + '(concatenation @argument (string "\\"" (string_content "p") "\\"") (word "q")) (translated_string @argument "$" (string "\\"" (string_content "r") "\\"")) '
      + '(brace_expression @argument "{" (number "1") ".." (number "3") "}") (brace_expression @argument "{" (word "a") ".." (word "e") ".." (number "2") "}") (word @argument "{a,b}")))');
    assert.equal(o('echo 5 -3 0x1f 1.5 007'),
      '(program (command (command_name @name (word "echo")) (number @argument "5") (number @argument "-3") (word @argument "0x1f") (word @argument "1.5") (number @argument "007")))');
  });
  it('reads a string line by line, as the grammar does', () => {
    const s = types(tree('echo "a b\n\nc $d\n e"').root, 'string')[0];
    assert.deepEqual(s.children.map((c) => `${c.type}:${c.text}`), ['":"', 'string_content:a b', 'string_content:c ', 'simple_expansion:$d', 'string_content: e', '":"']);
  });
  it('has assignments, in a command, alone, or as several', () => {
    assert.equal(o('x=1 y="$z" w='),
      '(program (variable_assignments (variable_assignment (variable_name @name "x") "=" (number @value "1")) '
      + '(variable_assignment (variable_name @name "y") "=" (string @value "\\"" (simple_expansion "$" (variable_name "z")) "\\"")) (variable_assignment (variable_name @name "w") "=")))');
    assert.equal(o('x=1 y=2 cmd z'),
      '(program (command (variable_assignment (variable_name @name "x") "=" (number @value "1")) (variable_assignment (variable_name @name "y") "=" (number @value "2")) '
      + '(command_name @name (word "cmd")) (word @argument "z")))');
    assert.equal(o('a[1]=x b+=y'),
      '(program (variable_assignments (variable_assignment (subscript @name (variable_name @name "a") "[" (number @index "1") "]") "=" (word @value "x")) '
      + '(variable_assignment (variable_name @name "b") "+=" (word @value "y"))))');
    assert.equal(o('a=(1 [2]=x "y") b=()'),
      '(program (variable_assignments (variable_assignment (variable_name @name "a") "=" (array @value "(" (number "1") (concatenation (word "[") (number "2") (word "]") (word "=x")) (string "\\"" (string_content "y") "\\"") ")")) '
      + '(variable_assignment (variable_name @name "b") "=" (array @value "(" ")"))))');
  });
  it('has declarations, unset, and assignment-like words of other commands', () => {
    assert.equal(o('declare -a x=(1 2) y; local -r q=1 r; readonly z; export A=b'),
      '(program (declaration_command "declare" (word "-a") (variable_assignment (variable_name @name "x") "=" (array @value "(" (number "1") (number "2") ")")) (variable_name "y")) ";" '
      + '(declaration_command "local" (word "-r") (variable_assignment (variable_name @name "q") "=" (number @value "1")) (variable_name "r")) ";" '
      + '(declaration_command "readonly" (variable_name "z")) ";" (declaration_command "export" (variable_assignment (variable_name @name "A") "=" (word @value "b"))))');
    assert.equal(o('unset -f f x'), '(program (unset_command "unset" (word "-f") (variable_name "f") (variable_name "x")))');
    assert.equal(o('alias ll="ls -l"'),
      '(program (command (command_name @name (word "alias")) (concatenation @argument (word "ll=") (string "\\"" (string_content "ls -l") "\\""))))');
    assert.equal(o('make CC=gcc'), '(program (command (command_name @name (word "make")) (word @argument "CC=gcc")))');
    assert.equal(o('alias x= y'), '(program (command (command_name @name (word "alias")) (word @argument "x=") (word @argument "y")))');
    assert.equal(o('export A=b >f').startsWith('(program (redirected_statement (declaration_command'), true);
    assert.equal(o('unset x 2>f').startsWith('(program (redirected_statement (unset_command'), true);
    assert.equal(first('declare -p >f 2>&1').type, 'redirected_statement');
    assert.equal(o('x=1 unset y').startsWith('(program (command (variable_assignment'), true);
    assert.equal(o('FOO=1 declare x').startsWith('(program (command (variable_assignment'), true);
    assert.equal(o('declare x <<<y').includes('(herestring_redirect'), true);
    assert.equal(o('unset x <<<y').includes('(herestring_redirect'), true);
  });
  it('has redirections: descriptors, here strings, a command with none, and after the first word', () => {
    assert.equal(o('echo >f a 2>&1 <g'),
      '(program (redirected_statement (command @body (command_name @name (word "echo")) (file_redirect @redirect ">" (word @destination "f")) (word @argument "a")) '
      + '(file_redirect @redirect (file_descriptor @descriptor "2") ">&" (number @destination "1")) (file_redirect @redirect "<" (word @destination "g"))))');
    assert.equal(o('>f'), '(program (redirected_statement (file_redirect @redirect ">" (word @destination "f"))))');
    assert.equal(o('cat <<<"$x" a'),
      '(program (command (command_name @name (word "cat")) (herestring_redirect @redirect "<<<" (string "\\"" (simple_expansion "$" (variable_name "x")) "\\"")) (word @argument "a")))');
    assert.equal(o('exec 3>&- {fd}>f &>o'),
      '(program (redirected_statement (command @body (command_name @name (word "exec"))) (file_redirect @redirect (file_descriptor @descriptor "3") ">&" (word @destination "-")) '
      + '(file_redirect @redirect (file_descriptor @descriptor "{fd}") ">" (word @destination "f")) (file_redirect @redirect "&>" (word @destination "o"))))');
    assert.equal(o('x=1 >f').startsWith('(program (redirected_statement (variable_assignment'), true);
    assert.equal(o('x=1 y=2 >f 2>g').startsWith('(program (redirected_statement (variable_assignments'), true);
    assert.equal(o('>f >g'), '(program (redirected_statement (file_redirect @redirect ">" (word @destination "f")) (file_redirect @redirect ">" (word @destination "g"))))');
  });
  it('gives the redirections after the last command of a pipeline or a list to that command, as bash does', () => {
    assert.equal(o('a | b >f'),
      '(program (pipeline (command (command_name @name (word "a"))) "|" (redirected_statement (command @body (command_name @name (word "b"))) (file_redirect @redirect ">" (word @destination "f")))))');
    assert.equal(o('a && b >f'),
      '(program (list (command (command_name @name (word "a"))) "&&" (redirected_statement (command @body (command_name @name (word "b"))) (file_redirect @redirect ">" (word @destination "f")))))');
    assert.equal(o('a >f | b').startsWith('(program (pipeline (redirected_statement'), true);
    // A compound command takes its own, also at the end of a list.
    assert.equal(o('a && { b; } >f').includes('"&&" (redirected_statement (compound_statement @body'), true);
    assert.equal(o('{ a; } >f').startsWith('(program (redirected_statement (compound_statement @body'), true);
  });
  it('negates the whole pipeline with !', () => {
    assert.equal(o('! a >f'), '(program (negated_command "!" (redirected_statement (command @body (command_name @name (word "a"))) (file_redirect @redirect ">" (word @destination "f")))))');
    assert.equal(o('! a | b >f').startsWith('(program (negated_command "!" (pipeline (command (command_name @name (word "a"))) "|" (redirected_statement'), true);
    assert.equal(o('! a | b'), '(program (negated_command "!" (pipeline (command (command_name @name (word "a"))) "|" (command (command_name @name (word "b"))))))');
    assert.equal(first('! a | b && c').type, 'list');
    assert.equal(first('! a | b && c').namedChildren[0].type, 'negated_command');
  });
  it('has functions, with or without function, ( ) and redirections', () => {
    assert.equal(o('f() { :; }\nfunction g { :; }\nfunction h() ( : )\nk() ( : ) >o'),
      '(program (function_definition (word @name "f") "(" ")" (compound_statement @body "{" (command (command_name @name (word ":"))) ";" "}")) '
      + '(function_definition "function" (word @name "g") (compound_statement @body "{" (command (command_name @name (word ":"))) ";" "}")) '
      + '(function_definition "function" (word @name "h") "(" ")" (subshell @body "(" (command (command_name @name (word ":"))) ")")) '
      + '(function_definition (word @name "k") "(" ")" (redirected_statement @body (subshell @body "(" (command (command_name @name (word ":"))) ")") (file_redirect @redirect ">" (word @destination "o")))))');
  });
  it('has case items with their patterns, separators and terminators', () => {
    assert.equal(o('case x in\n  (a|b) :;&\n  *) ;;&\n  c) :\nesac'),
      '(program (case_statement "case" (word @value "x") "in" (case_item "(" (extglob_pattern @value "a") "|" (word @value "b") ")" (command (command_name @name (word ":"))) ";&") '
      + '(case_item (extglob_pattern @value "*") ")" ";;&") (case_item (word @value "c") ")" (command (command_name @name (word ":")))) "esac"))');
    assert.equal(o('case x in a|b*) :;; "q"|$v|?x) :;; esac').includes('(case_item (extglob_pattern @value "a") "|" (extglob_pattern @value "b*") ")"'), true);
    assert.equal(o('case x in *"$a"*z) :;; esac').includes('(concatenation @value (extglob_pattern "*") (string'), true);
    // The pieces of one pattern are one pattern; the `|` tells the patterns apart.
    assert.equal(o(String.raw`case x in [\)]|"("*) :;; esac`).includes('(extglob_pattern @value "[\\\\)]") "|" (concatenation @value (string'), true);
    assert.equal(o('case x in esac').startsWith('(program (case_statement "case" (word @value "x") "in" "esac")'), true);
  });
  it('is about words that look like operators of [ and the like', () => {
    assert.equal(first('[ab]').type, 'command');
    assert.equal(first('[[.a.]]').type, 'command');
    assert.equal(first('[ a ]; echo').type, 'test_command');
  });
});

describe('unbash adapter: backquotes with escapes', () => {
  const text = 'echo `a \\`b\\` c` d';
  it('maps the positions of a script that unbash parsed with its escapes removed', () => {
    const t = tree(text);
    assert.deepEqual(t.errors, []);
    assert.deepEqual(invariants(t), []);
    const subs = types(t.root, 'command_substitution');
    assert.deepEqual(subs.map((s) => s.text), ['`a \\`b\\` c`', '\\`b\\`']);
    assert.deepEqual(subs.map((s) => [s.startIndex, s.endIndex]), [[5, 16], [8, 13]]);
    assert.equal(types(t.root, 'word').map((w) => w.text).join(' '), 'echo a b c d');
  });
  it('maps \\$ and \\\\, and keeps the comments', () => {
    const t = tree('echo `a \\$x \\\\ y # c\n z` w');
    assert.deepEqual(invariants(t), []);
    assert.deepEqual(types(t.root, 'simple_expansion').map((e) => e.text), ['$x']);
    assert.deepEqual(types(t.root, 'comment').map((e) => e.text), ['# c']);
    assert.equal(types(t.root, 'word').map((w) => w.text).join('|'), 'echo|a|\\\\ y|z|w');
  });
  it('in double quotes, also \\"', () => {
    const t = tree('x="`echo \\"q\\"`"');
    assert.deepEqual(invariants(t), []);
    assert.deepEqual(types(t.root, 'string_content').map((c) => c.text), ['q']);
  });
  it('an unclosed one, with escapes', () => {
    const t = tree('echo `a \\`b');
    assert.deepEqual(invariants(t), []);
    assert.equal(types(t.root, 'command_substitution')[0].incomplete, true);
  });
});

describe('unbash adapter: more shapes', () => {
  it('a pipeline with a heredoc in the middle: the commands after it go on in the pipeline', () => {
    const t = tree('a | cat <<E | wc\nx\nE\n');
    assert.deepEqual(invariants(t), []);
    assert.equal(first('a | cat <<E | wc\nx\nE\n').type, 'pipeline');
    assert.deepEqual(first('a | cat <<E | wc\nx\nE\n').namedChildren.map((c) => c.type), ['command', 'redirected_statement', 'command']);
    assert.equal(types(t.root, 'pipeline').length, 1);
  });
  it('a redirection before the command, or among the words of a [ ]', () => {
    assert.equal(o('>f echo a'), '(program (command (file_redirect @redirect ">" (word @destination "f")) (command_name @name (word "echo")) (word @argument "a")))');
    assert.equal(o('x=1 >f cmd').includes('(file_redirect @redirect'), true);
    assert.equal(o('[ a >f b ]'), '(program (test_command "[" (word "a") (file_redirect @redirect ">" (word @destination "f")) (word "b") "]"))');
    assert.equal(o('declare >f x').includes('(file_redirect'), true);
    assert.equal(o('unset >f x').includes('(file_redirect'), true);
  });
  it('a bare declare, unset or [', () => {
    assert.equal(o('declare'), '(program (declaration_command "declare"))');
    assert.equal(o('unset'), '(program (unset_command "unset"))');
    assert.equal(first('[').incomplete, true);
    assert.equal(first('[').type, 'test_command');
  });
  it('patterns and the right side of =~', () => {
    assert.equal(o('[[ x == a.b ]]').includes('(word @right "a.b")'), true);
    assert.equal(o('[[ x =~ 12 ]]').includes('(number @right "12")'), true);
    assert.equal(o('[[ x =~ re ]]').includes('(word @right "re")'), true);
    assert.equal(o('[ x = ab ]').includes('(word "ab")'), true);
    assert.equal(o('[ x = a ]').includes('(extglob_pattern "a")'), true);
    assert.equal(o('[ x = \\? ]').includes('(word "\\\\?")'), true);
  });
  it('elif and else, with and without ;, and an open elif', () => {
    const text = 'if a; then b; elif c; then d\nelse e\nfi';
    const t = first(text);
    assert.deepEqual(t.namedChildren.map((c) => c.type), ['command', 'command', 'elif_clause', 'else_clause']);
    assert.equal(t.namedChildren[2].text, 'elif c; then d\n');
    assert.equal(t.namedChildren[3].text, 'else e\n');
    assert.equal(first('if a; then b; elif c; then d').incomplete, true);
    assert.equal(types(tree('if a; then b; elif c; then d').root, 'elif_clause').length, 1);
    assert.equal(first('if a; then b; elif c; then d; elif e; then f; else g; fi').namedChildren.filter((c) => c.type === 'elif_clause').length, 2);
    assert.deepEqual(invariants(tree('if a; then b; else fi')), []);
    assert.deepEqual(invariants(tree('if a; then b; else\nfi')), []);
  });
  it('while without do, and arithmetic with a backquote or a subscript', () => {
    assert.equal(first('while a').incomplete, true);
    assert.equal(first('while a').type, 'while_statement');
    assert.equal(bare('echo $(( `a` ))', 'arithmetic_expansion'), '(arithmetic_expansion "$((" (command_substitution "`" (command (command_name @name (word "a"))) "`") "))")');
    assert.equal(o('(( a[i] ))'), '(program (arithmetic_command "((" (subscript (variable_name @name "a") "[" (word @index "i") "]") "))"))');
  });
  it('positions are in UTF-16 units, with rows', () => {
    const t = tree('echo "日本😀" x\nls');
    const x = fields(t.root.namedChildren[0], 'argument')[1];
    assert.equal(x.text, 'x');
    assert.equal(x.startIndex, 'echo "日本😀" '.length);
    assert.equal(x.startPosition.column, 'echo "日本😀" '.length);
    assert.deepEqual(t.root.namedChildren[1].startPosition, { row: 1, column: 0 });
    assert.equal(tree('  ls  ').root.startIndex, 2);
    assert.equal(tree('').root.text, '');
    assert.equal(tree('\n\n').root.children.length, 0);
  });
  it('gives plain objects: the same one going down and back up', () => {
    const t = tree('if x; then echo a b; fi\n# c');
    const walk = (n: SyntaxNode): void => {
      for (const c of n.children) {
        assert.strictEqual(c.parent, n);
        walk(c);
      }
    };
    assert.equal(t.root.parent, null);
    walk(t.root);
    assert.ok(Object.getPrototypeOf(t.root) === Object.prototype);
    assert.deepEqual(t.root.namedChildren, t.root.children.filter((c) => c.named));
  });
  it('walks the lazy parts of unbash: substitutions in expansions in strings in substitutions', () => {
    const t = tree('echo "${a:-$(b "$(c)")}" `d $(e)` <(f $((1 + $(g))))');
    assert.equal(types(t.root, 'command').map((c) => c.text).join('|'), 'echo "${a:-$(b "$(c)")}" `d $(e)` <(f $((1 + $(g))))|b "$(c)"|c|d $(e)|e|f $((1 + $(g)))|g');
    assert.deepEqual(invariants(t), []);
  });
  it('does not throw, whatever the input', () => {
    for (const text of ['', ' ', '\n', ';', ';;', '&', '|', '||', '&&', '(', ')', '{', '}', '((', '))', '[[', ']]', '$', '${', '$(', '$((', '`', '"', "'", '\\', '<<', '<<<', '>', '#', '#!', 'a\r\nb\r\n',
      'if', 'fi', 'then', 'case', 'esac', 'function', 'coproc', 'select', 'time', '!', '! !', 'x=', 'x=(', '=', '[', ']', '[ ]', '$[', '${#', '${!', '${a[', '${a:', '${a/', '<(', '>(', 'echo \u0000 x', '\u{1F600}']) {
      const t = tree(text);
      assert.equal(t.text, text);
      assert.deepEqual(invariants(t), [], JSON.stringify(text));
    }
  });

  it('reads a CR before a LF as a blank of the same width, keeps the original text, and says where the CRs were', () => {
    const lf = 'if [ -f a ]; then\n  echo yes # c\nfi\ncat <<< x\n';
    const crlf = lf.replace(/\n/g, '\r\n');
    const a = tree(lf), b = tree(crlf);
    assert.equal(b.text.length, crlf.length);
    assert.equal(b.text, crlf);
    // The nodes' texts are the original ones too, and none ends with the CR.
    assert.equal(first(crlf).text, first(lf).text.replace(/\n/g, '\r\n'));
    assert.equal(types(b.root, 'comment')[0].text, '# c');
    assert.deepEqual(b.carriageReturns, [...crlf.matchAll(/\r/g)].map((m) => m.index));
    assert.equal(a.carriageReturns, undefined);
    assert.deepEqual(b.errors, []);
    // The same nodes, starting at the same rows and columns.
    const shape = (n: SyntaxNode): unknown[] => [n.type, n.startPosition.row, n.startPosition.column, ...n.children.map(shape)];
    assert.deepEqual(shape(b.root), shape(a.root));
    assert.deepEqual(invariants(b), []);
    // As in bash, a heredoc of a CRLF script has no closing line: `EOF\r` is not `EOF`.
    assert.deepEqual(tree('cat <<EOF\r\nx\r\nEOF\r\n').errors.map((e) => e.kind), ['missing']);
    // A CR that is not before a LF stays: it is a character of the word, as in bash.
    const lone = tree('echo a\rb\r');
    assert.equal(lone.text, 'echo a\rb\r');
    assert.equal(lone.carriageReturns, undefined);
  });
});

describe('unbash adapter: speed', () => {
  const file = '/usr/share/bash-completion/bash_completion';
  (fs.existsSync(file) ? it : it.skip)('parses bash_completion', () => {
    const text = fs.readFileSync(file, 'utf8');
    // The best of five runs each: the first ones are slow while the code warms up.
    const best = (run: () => unknown): number => {
      let min = Infinity;
      for (let i = 0; i < 5; i++) {
        const t0 = performance.now();
        run();
        min = Math.min(min, performance.now() - t0);
      }
      return min;
    };
    const unbash = best(() => ub.parse(text));
    console.log(`      bash_completion (${text.split('\n').length} lines): unbash ${unbash.toFixed(1)} ms`);
    const result = ub.parse(text);
    assert.ok(result.root.children.length > 100);
    assert.deepEqual(invariants(result), []);
  });
});

describe('unbash adapter: what the explanations make of its trees', () => {
  const flat = (ts: Token[]): Token[] => ts.flatMap((t) => [t, ...flat(t.children)]);
  it('explains the commands that follow a here-document\'s delimiter on its line', () => {
    // (tree-sitter reads the delimiter of `cat <<EOF; …` as `EOF;`, so this is for the unbash adapter.)
    const src = 'cat <<EOF; rm -rf $dir\nhello\nEOF\necho after';
    const e = new Analyzer('en').explainLine(tree(src), 0);
    assert.deepEqual(e.items.map((i) => i.label), ['cat <<EOF; rm -rf $dir …', ';', 'rm -rf $dir']);
    assert.match(flat(e.items).find((t) => t.label === 'rm -rf $dir')!.explanation, /Remove files/);
    assert.ok(e.notes.some((n) => /\$dir` is not quoted/.test(n)), e.notes.join('|'));
    // Its body lines are the here-document's; the line after is a statement of its own.
    assert.match(new Analyzer('en').explainLine(tree(src), 1).notes[0], /part of the here-document/);
    assert.equal(new Analyzer('en').explainLine(tree(src), 3).items[0].label, 'echo after');
  });
  it('explains the later stages of a heredoc line, and the redirections beside it', () => {
    const e = new Analyzer('en').explainLine(tree('cat <<EOF | tr a-z A-Z && echo after\nhi\nEOF'), 0);
    assert.equal(e.items[0].children.length, 3);
    assert.ok(flat(e.items).some((t) => t.label === 'tr a-z A-Z'));
    const r = new Analyzer('en').explainLine(tree('cat <<EOF > out.txt\nhi\nEOF'), 0);
    assert.deepEqual(r.items[0].children.map((c) => c.label), ['<<EOF', '> out.txt']);
  });
  it('explains the redirections of a compound command with a here string', () => {
    const e = new Analyzer('en').explainLine(tree('{ cat; } <<< x > f'), 0);
    assert.match(e.items[0].explanation, /as a whole/);
    assert.deepEqual(e.items[0].children.slice(-2).map((c) => c.label), ['<<< x', '> f']);
  });
  it('explains a redirection after the last command, and ! over a pipeline, as tree-sitter does now', () => {
    const e = new Analyzer('en').explainLine(tree('echo A && echo B > f'), 0);
    assert.deepEqual(e.items[0].children.map((c) => c.label), ['echo A', '&&', 'echo B > f']);
    const n = new Analyzer('en').explainLine(tree('! true | false'), 0);
    assert.match(n.items[0].explanation, /whole pipeline/);
    assert.equal(new Analyzer('en').explainLine(tree('a | time b'), 0).items[0].children[2].kind, 'command');
  });
});

describe('unbash adapter: tricky lines found by evaluation', () => {
  it('a brace group is the body of a for loop, as bash takes it', () => {
    for (const text of ['for ((;;)); { :; }', 'for ((i=0;i<3;i++)); { printf %s $i; }', 'for x in a; { :; }', 'select x in a; { :; }']) {
      const t = tree(text);
      assert.deepEqual(t.errors, [], text);
      assert.deepEqual(invariants(t), [], text);
      assert.equal(hasError(t.root), false, text);
      assert.equal(field(first(text), 'body')!.type, 'compound_statement', text);
    }
    assert.equal(errorsOf('for x in a; { :'), 'missing@15-15');
    assert.equal(tree('while a; { b; }').root.namedChildren[0].incomplete, true);
  });
  it('[7]=z in an array is the index (a concatenation of four pieces, as the model has it)', () => {
    assert.equal(o('a+=([7]=z)'), '(program (variable_assignment (variable_name @name "a") "+=" (array @value "(" (concatenation (word "[") (number "7") (word "]") (word "=z")) ")")))');
    assert.equal(o('a=([k]+=v)').includes('(word "k")'), true);
    // A `]` not followed by `=` (or by `+=`) does not make an index: the element is a plain word.
    assert.equal(o('a=([]x)'), '(program (variable_assignment (variable_name @name "a") "=" (array @value "(" (word "[]x") ")")))');
  });
  it('a `))` that ends the expression of an unclosed `((` or `$((` is not the closer', () => {
    for (const text of ['(( x--  (( (1 + 2) ))', 'echo $(( x  $(( (1) ))']) {
      const t = tree(text);
      assert.deepEqual(invariants(t), [], text);
      assert.deepEqual(t.errors.map((e) => e.kind), ['missing'], text);
      assert.ok(descendants(t.root, ['arithmetic_command', 'arithmetic_expansion'])[0].incomplete || hasError(t.root), text);
    }
    assert.deepEqual(toks(first('(( (1 + 2) ))')), ['((@0', '))@11']);
  });
  it('a list of braces next to a range is a brace expression too', () => {
    const w = first('echo {1..3}{,} x{,}').namedChildren[1];
    assert.deepEqual(w.namedChildren.map((c) => c.type), ['brace_expression', 'brace_expression']);
    assert.equal(w.namedChildren[1].text, '{,}');
    assert.equal(first('echo x{,}').namedChildren[1].type, 'word');
  });
  it('a backquote escaped inside backquotes starts at its backslash', () => {
    const t = tree('echo `echo \\`echo x\\``');
    const subs = types(t.root, 'command_substitution');
    assert.deepEqual(subs.map((c) => c.text), ['`echo \\`echo x\\``', '\\`echo x\\`']);
    assert.deepEqual(invariants(t), []);
  });
  it('$"…" is one explanation, not two', () => {
    const e = new Analyzer('en').explainLine(tree('echo $"hi"'), 0);
    assert.equal(e.items[0].children[0].children.length, 1);
  });
});

describe('unbash adapter: branches of the shapes', () => {
  it('a subscript that is not closed is not one', () => {
    for (const text of ['echo ${a[1}', 'echo ${a[1', 'echo ${a[']) assert.deepEqual(invariants(tree(text)), [], text);
    assert.equal(types(tree('echo ${a[1]}').root, 'subscript').length, 1);
  });
  it('${| cmd; } is a substitution of its own', () => {
    const n = types(tree('echo ${| a; }').root, 'command_substitution')[0];
    assert.deepEqual(toks(n).map((x) => x.split('@')[0]), ['${|', ';', '}']);
    assert.equal(types(tree('echo ${ a; }').root, 'command_substitution')[0].children[0].type, '${');
  });
  it('items of a list next to a range, with escapes and nested braces', () => {
    const w = first('echo {1..2}{a,b{c,d},\\,e}').namedChildren[1];
    assert.deepEqual(w.namedChildren[1].namedChildren.map((c) => c.text), ['a', 'b{c,d}', '\\,e']);
  });
  it('an elif without then, whether or not it has commands', () => {
    assert.equal(errorsOf('if a; then b\nelif c; then\nelse d\nfi').includes('missing'), false);
    assert.equal(errorsOf('if a; then b\nelif c\nelse d\nfi'), 'missing@19-19');
  });
});
