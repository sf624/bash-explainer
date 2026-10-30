import * as assert from 'assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import { forEachChild, parse } from 'unbash';
import { continuations, prepared } from '../src/syntax/adapters/continuations';
import type { Children } from '../src/syntax/adapters/rereads';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { descendants, field, fields, hasError, nameText, token } from '../src/syntax/tree';
import type { SyntaxNode } from '../src/syntax/tree';
import { Analyzer } from '../src/analyzer';
import type { Token } from '../src/analyzer';
import { findBashAst, runBashAst, shapeOfAst } from './support/bashast';
import { corpus, invariants } from './support/corpus';
import { soundness } from './support/fuzz';
import { assertGrowth, fastest } from './support/growth';
import { diffShapes, shapeOfTree } from './support/shape';
import { runBash } from './support/bash';

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
  it('a command name ends before a line continuation after it (`declare\\<newline> x`)', () => {
    for (const text of ['declare\\\n  x', 'local\\\n\\\n x=1', 'echo\\\n']) {
      const d = first(text);
      assert.deepEqual(field(d, 'name')!.text, text.split('\\')[0], text);
      assert.deepEqual(soundness(tree(text)), [], text);
    }
    // (After it, `x=1` is still an assignment of `local`.)
    assert.equal(first('local\\\n\\\n x=1').namedChildren[1].type, 'variable_assignment');
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
    // (An item with no `;;` before another, which bash rejects and unbash reads: the `;` of its list stays in it.)
    const open = 'case x in a) b; c) d; esac';
    assert.deepEqual(toks(first(open).namedChildren.find((n) => n.type === 'case_item')!), seq(open, ')', ';'));
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

describe('unbash adapter: redirections', () => {
  it('sends `&>` and `&>>` to a process substitution, as bash does', function () {
    // (unbash reads the process substitution as a word of its own, after a redirection with no target.)
    assert.strictEqual(outline(ub.parse('exec &> >(tee log)').root),
      '(program (command (command_name @name (word "exec")) (file_redirect @redirect "&>" (process_substitution @destination ">(" (command (command_name @name (word "tee")) (word @argument "log")) ")"))))');
    assert.strictEqual(outline(ub.parse('echo &>> >(cat) b').root),
      '(program (command (command_name @name (word "echo")) (file_redirect @redirect "&>>" (process_substitution @destination ">(" (command (command_name @name (word "cat"))) ")")) (word @argument "b")))');
    assert.deepStrictEqual(ub.parse('exec &> >(tee log)').errors, []);
    // bash: `b` is echo's argument, and both outputs go to the process substitution.
    const r = spawnSync('bash', ['-c', 'echo &> >(sed s/^/got:/) b; wait; sleep 0.1'], { encoding: 'utf8' });
    if (r.error) return this.skip();
    assert.strictEqual(r.stdout, 'got:b\n');
  });
  it('sends `&>` to a process substitution after a compound command or before the command name, as bash does', function () {
    // (unbash reads these as an unexpected token, or the process substitution as the command name.)
    const both = ['{ ls; } &> >(tee log)', 'while :; do :; done &>> >(tee log)', 'f() { :; } &> >(tee log)', '(ls) &> >(tee log)',
      'if :; then :; fi &><(cat)', '&> >(tee log) ls', 'x=1 &>> >(tee log) ls', 'a && &> >(tee log) ls', '&> >(tee log)', 'x=$(ls &> >(tee log))'];
    // Several in one script: unbash tells of one error at a time.
    const several = ['{ a; } &> >(x)\n{ b; } &> >(y)\nls &> >(z) w', 'a; { b; } &> >(y); { c; } &> >(z)', 'f() {\n{ a; } &> >(x)\n{ b; } &>> >(y)\n}\n&> >(cat) echo'];
    for (const text of several) {
      const t = tree(text);
      assert.deepStrictEqual(t.errors, [], text);
      const rs = types(t.root, 'file_redirect');
      assert.strictEqual(rs.length, text.split('&>').length - 1, text);
      for (const r of rs) {
        assert.match(r.children[0].text, /^&>>?$/, text);
        assert.strictEqual(field(r, 'destination')!.type, 'process_substitution', text);
      }
    }
    // `ls &> >(z) w`: `w` is the argument, and the name of `&> >(cat) echo` is `echo`.
    assert.deepStrictEqual(types(tree(several[0]).root, 'command').filter((c) => field(c, 'name')!.text === 'ls').map((c) => fields(c, 'argument').map((a) => a.text)), [['w']]);
    assert.ok(types(tree(several[2]).root, 'command').some((c) => field(c, 'name')!.text === 'echo'));
    for (const text of both) {
      const t = tree(text);
      assert.deepStrictEqual(t.errors, [], text);
      const [r] = types(t.root, 'file_redirect');
      assert.strictEqual(r.text, text.slice(text.indexOf('&>'), text.indexOf(')', text.indexOf('&>')) + 1), text);
      assert.match(r.children[0].text, /^&>>?$/, text);
      assert.strictEqual(field(r, 'destination')!.type, 'process_substitution', text);
    }
    assert.strictEqual(field(types(tree('&> >(tee log) ls').root, 'command')[0], 'name')!.text, 'ls');
    // bash's own parser gives the same shapes.
    const bin = findBashAst();
    if (!bin && process.env.BASH_EXPLAINER_BASH_AST) assert.fail('BASH_EXPLAINER_BASH_AST is set, but bash-ast cannot be run (see $BASH_AST)');
    for (const text of bin ? [...both, ...several] : []) {
      const r = runBashAst(bin!, text);
      assert.ok(r.ok, text);
      assert.deepStrictEqual(diffShapes(shapeOfTree(tree(text).root), shapeOfAst(r.ast)), [], text);
    }
    assert.strictEqual(o('{ ls; } &> >(tee log)'),
      '(program (redirected_statement (compound_statement @body "{" (command (command_name @name (word "ls"))) ";" "}") (file_redirect @redirect "&>" (process_substitution @destination ">(" (command (command_name @name (word "tee")) (word @argument "log")) ")"))))');
    // Text in quotes is left as it is.
    assert.strictEqual(o("echo '&> >(x)'"), '(program (command (command_name @name (word "echo")) (raw_string @argument "\'&> >(x)\'")))');
    for (const text of [both.join('\n'), ...several]) {
      const r = spawnSync('bash', ['-n', '-c', text], { encoding: 'utf8' });
      if (r.error) return this.skip();
      assert.strictEqual(r.status, 0, r.stderr);
    }
    // bash: both outputs go to the process substitution, and the command is `echo`.
    const run = spawnSync('bash', ['-c', '{ echo out; echo err >&2; } &> >(sed s/^/got:/); &>> >(sed s/^/2:/) echo b; wait; sleep 0.1'], { encoding: 'utf8' });
    assert.deepStrictEqual(run.stdout.split('\n').sort(), ['', '2:b', 'got:err', 'got:out']);
  });
});

describe('unbash adapter: process substitutions in a longer word', () => {
  // bash reads `<(` and `>(` in a word as it reads `$(`: the file name is part of the word. unbash ends the word there.
  const words = ['a<(:)', 'b<(:)c', '<(:)<(:)', `"x"<(:)'y'`, '2>(:)', '{fd}<(:)', '<(:)2', 'a\\\n<(:)', '<(echo $(:)<(:))x'];
  it('makes one word of them, as bash does', () => {
    const text = `printf '<%s>\\n' ${words.join(' ')} z`;
    const t = tree(text);
    assert.deepStrictEqual(t.errors, []);
    const [cmd] = types(t.root, 'command');
    const args = fields(cmd, 'argument').slice(1);
    assert.deepStrictEqual(args.map((a) => a.text), [...words, 'z']);
    // Each word holds its process substitutions, with their operators.
    assert.deepStrictEqual(args.map((a) => descendants(a, ['process_substitution']).filter((p) => p.parent === a || p === a).length), [1, 1, 2, 1, 1, 1, 1, 1, 1, 0]);
    assert.ok(descendants(cmd, ['process_substitution']).every((p) => p.children[0].type === p.text.slice(0, 2)));
    // bash prints a line for each word, with a file name where each process substitution is.
    const r = runBash(text);
    assert.strictEqual(r.status, 0, r.stderr);
    const lines = r.stdout.trimEnd().split('\n');
    // (The descriptors have two digits: the `2` of `<(:)2` is text after one.)
    assert.deepStrictEqual(lines.map((l) => l.replace(/\/dev\/fd\/\d\d/g, '@')), ['<a@>', '<b@c>', '<@@>', '<x@y>', '<2@>', '<{fd}@>', '<@2>', '<a@>', '<@x>', '<z>']);
  });
  it('reads them so in assignments, redirections, arrays, `case`, `for` and `[[ ]]`', () => {
    const lines = ['x=a<(:) y=1 echo', 'cat < a<(:) <(:)2>/dev/null', 'arr=(a<(:) b)', 'case x in a<(:)) ;; esac', 'for w in q<(:); do :; done', '[[ a<(:) == a/dev/fd/* ]]', 'declare z=a<(:)'];
    for (const text of lines) {
      const t = tree(text);
      assert.deepStrictEqual(t.errors, [], text);
      assert.ok(types(t.root, 'process_substitution').every((p) => p.parent!.type === 'concatenation'), text);
    }
    assert.strictEqual(o('x=a<(:) y=1 echo'),
      '(program (command (variable_assignment (variable_name @name "x") "=" (concatenation @value (word "a") (process_substitution "<(" (command (command_name @name (word ":"))) ")"))) (variable_assignment (variable_name @name "y") "=" (number @value "1")) (command_name @name (word "echo"))))');
    // bash: the same words.
    const r = runBash('x=a<(:); echo "$x"; { cat < a<(:); } 2>&1 | grep -c "a/dev/fd"; arr=(a<(:) b); echo ${#arr[@]} "${arr[0]%/*}"; case a/dev/fd/63 in a<(:)) echo case;; esac; for w in q<(:); do echo "${w%/*}"; done; [[ a<(:) == a/dev/fd/* ]] && echo test; declare z=a<(:); echo "${z%/*}"');
    assert.strictEqual(r.stdout.replace(/\/dev\/fd\/\d\d/g, '@'), 'a@\n1\n2 a/dev/fd\ncase\nq/dev/fd\ntest\na/dev/fd\n');
    // bash's own parser gives the same shapes.
    const bin = findBashAst();
    if (!bin && process.env.BASH_EXPLAINER_BASH_AST) assert.fail('BASH_EXPLAINER_BASH_AST is set, but bash-ast cannot be run (see $BASH_AST)');
    for (const text of bin ? [`printf x ${words.join(' ')}`, ...lines] : []) {
      const a = runBashAst(bin!, text);
      assert.ok(a.ok, text);
      assert.deepStrictEqual(diffShapes(shapeOfTree(tree(text).root), shapeOfAst(a.ast)), [], text);
    }
  });
  it('leaves apart one whose command is a subshell, which would read as `$((`', () => {
    // (README, Limitations: bash reads `a<((ls))` as one word.)
    assert.deepStrictEqual(fields(types(tree('echo a<((ls))').root, 'command')[0], 'argument').map((a) => a.text), ['a', '<((ls))']);
  });
});

describe('unbash adapter: line continuations in a word', () => {
  // bash removes a backslash-newline before it reads the word (3.1.2.1): it can split a name, or stand before one.
  const words = ['"$y\\\na"', '$y\\\na', '${y\\\na}', '${\\\ny}', '$\\\ny', '${#y\\\na}', '"${y\\\n}"', '$((y\\\na + 1))'];
  it('reads the names as bash does', () => {
    const text = `y=1 ya=22\nprintf '<%s>' ${words.join(' ')}`;
    const t = tree(text);
    assert.deepStrictEqual(t.errors, []);
    const [, cmd] = types(t.root, 'command');
    const args = fields(cmd, 'argument').slice(1);
    assert.deepStrictEqual(args.map((a) => a.text), words);
    // Each name, without its line continuations, is the one bash reads: the values are those bash prints.
    const values: Record<string, string> = { y: '1', ya: '22' };
    const value = (a: SyntaxNode): string => {
      const e = descendants(a, ['simple_expansion', 'expansion', 'arithmetic_expansion'])[0];
      const name = nameText(descendants(e, ['variable_name'])[0]);
      return e.type === 'arithmetic_expansion' ? String(Number(values[name]) + 1) : e.text.startsWith('${#') ? String(values[name].length) : values[name];
    };
    assert.strictEqual(args.map((a) => `<${value(a)}>`).join(''), runBash(text).stdout);
    // The nodes are where they are written, with their text.
    for (const n of types(t.root, 'variable_name')) assert.strictEqual(n.text, text.slice(n.startIndex, n.endIndex));
    assert.deepStrictEqual(types(t.root, 'simple_expansion').map((n) => n.text), ['$y\\\na', '$y\\\na', '$\\\ny']);
  });
  it('joins a word as bash does, also a command name and an assignment', () => {
    const text = 'declare\\\nx=1; ec\\\nho a\\\nb';
    const t = tree(text);
    assert.deepStrictEqual(t.errors, []);
    assert.strictEqual(o(text), '(program (command (variable_assignment (variable_name @name "declare\\\\\\nx") "=" (number @value "1"))) ";" (command (command_name @name (word "ec\\\\\\nho")) (word @argument "a\\\\\\nb")))');
    assert.strictEqual(runBash(`${text}; echo "$declarex"`).stdout, 'ab\n1\n');
    // A continuation in single quotes, in `$'…'`, between words or in a comment of a substitution stays.
    assert.strictEqual(o("echo 'a\\\nb' $'c\\\nd' \\\n e $(: # f\\\n)"), o("echo 'a\\\nb' $'c\\\nd' \\\n e $(: # f\\\n)"));
    assert.deepStrictEqual(fields(types(tree("echo 'a\\\nb' $'c\\\nd' \\\n e $(: # f\\\n)").root, 'command')[0], 'argument').map((a) => a.text), ["'a\\\nb'", "$'c\\\nd'", 'e', '$(: # f\\\n)']);
    // bash's own parser gives the same shapes.
    const bin = findBashAst();
    if (!bin && process.env.BASH_EXPLAINER_BASH_AST) assert.fail('BASH_EXPLAINER_BASH_AST is set, but bash-ast cannot be run (see $BASH_AST)');
    // (bash numbers a command by the line its first word ends on, past the continuation: not compared.)
    for (const s of bin ? [`printf x ${words.join(' ')}`, text] : []) {
      const a = runBashAst(bin!, s);
      assert.ok(a.ok, s);
      assert.deepStrictEqual(diffShapes(shapeOfTree(tree(s).root), shapeOfAst(a.ast)).filter((d) => !d.path.endsWith('.line')), [], s);
    }
  });
  // Scripts whose reading depends on a line continuation outside a word, with what bash 5.2 and 5.3 print (and false
  // where bash-ast's shape is not compared: it prints a substitution without its comments).
  const OUTSIDE: [string, string, false?][] = [
    // (A comment ends at the newline of a continuation in it: in an array, a `case`, a group, a substitution.)
    ['a=(\n  -v   # verbose \\\n  -q\n)\nprintf "<%s>" "${a[@]}"', '<-v><-q>'],
    ['a=(1 # c \\\n2)\nprintf "<%s>" "${a[@]}"', '<1><2>'],
    ['case a in a) echo x # c \\\n;; esac', 'x\n'],
    ['{ echo x # c \\\n}', 'x\n'],
    ['x=$(echo y # c \\\n)\necho "$x"', 'y\n', false],
    ['y=1 ya=2; x=$(cat <<E\n$y\\\na \\\nb\nE\n)\necho "$x"', '2 b\n'],
    // (In an unquoted heredoc body it is removed, before the delimiter is looked for; in a quoted one it stays.)
    ['y=1 ya=2; cat <<E\n$y\\\na\nx\\\nE\nE\necho next', '2\nxE\nnext\n'],
    ["cat <<'E'\na\\\nb\nE", 'a\\\nb\n'],
    ['cat <<E\na\\\\\nb\nE', 'a\\\nb\n'],
    // (It joins an operator or a reserved word, and a name in `(( ))`.)
    ['true &\\\n& echo and', 'and\n'],
    ['true &\\\n\\\n& echo and', 'and\n'],
    ['echo a#b &\\\n& echo c', 'a#b\nc\n'],
    ['echo a #c&\\\necho b', 'a\nb\n'],
    ['echo x >\\\n> /dev/null && echo app', 'app\n'],
    ['if true; then echo a; f\\\ni', 'a\n'],
    ['for i in 1; do echo $i; do\\\nne', '1\n'],
    ['y=1 ya=3; (( y\\\na += 1 )); echo $ya', '4\n'],
    ['for ((i\\\n=0; i<1; i++)); do echo $i; done', '0\n'],
    ['for ((i=0; i<1; i+\\\n+)); do echo $i; done; for ((;;)); do break; done; for ((i=2;;)); do echo $i; break; done; for ((;i<\\\n3;)); do echo $i; break; done', '0\n2\n2\n'],
    ['x=0\nf\\\nn() { x=1; }\nfn; echo $x', '1\n'],
    // (In backquotes with escapes, which are read apart; after a `#` that is no comment.)
    ['y=1 ya=2\necho `echo \\$y\\\na` "`echo \\"$y\\\na\\"`"', '2 2\n'],
    ['set --; case $# in 0) echo z ;\\\n; esac', 'z\n'],
    ['\\\necho a', 'a\n'],
    // (With a process substitution attached to the word, or split from its `(`.)
    ["printf '<%s>' a\\\n<(:) a<(:)\\\nb a <\\\n(:) | sed 's#/dev/fd/[0-9]*#FD#g'", '<aFD><aFDb><a><FD>'],
  ];
  it('reads a line continuation outside a word as bash does: kept in a comment, removed elsewhere', () => {
    const bash53 = process.env.BASH_EXPLAINER_BASH53;
    const bin = findBashAst();
    for (const [text, out, shape] of OUTSIDE) {
      for (const program of ['bash', ...(bash53 ? [bash53] : [])]) assert.strictEqual(runBash(text, { program }).stdout, out, `${program}: ${text}`);
      assert.deepStrictEqual(tree(text).errors, [], text);
      assert.deepStrictEqual(invariants(tree(text)), [], text);
      if (!bin || shape === false) continue;
      const a = runBashAst(bin, text);
      assert.ok(a.ok, text);
      assert.deepStrictEqual(diffShapes(shapeOfTree(tree(text).root), shapeOfAst(a.ast)).filter((d) => !d.path.endsWith('.line')), [], text);
    }
    // The comments are nodes, with the backslash that ends them.
    assert.deepStrictEqual(types(tree(OUTSIDE[0][0]).root, 'comment').map((c) => c.text), ['# verbose \\']);
    assert.deepStrictEqual(types(tree(OUTSIDE[0][0]).root, 'array')[0].namedChildren.map((c) => c.text), ['-v', '# verbose \\', '-q']);
    assert.strictEqual(types(tree(OUTSIDE[6][0]).root, 'heredoc_body')[0].text, '$y\\\na\nx\\\nE\n');
    assert.strictEqual(nameText(types(tree(OUTSIDE[6][0]).root, 'variable_name').pop()!), 'ya');
    assert.strictEqual(types(tree(OUTSIDE[7][0]).root, 'heredoc_body')[0].children.length, 0);
    assert.strictEqual(nameText(types(tree(OUTSIDE.find(([t]) => t.includes('(( y'))![0]).root, 'variable_name')[2]), 'ya');
    const quoted = types(tree(OUTSIDE.find(([t]) => t.includes('`echo'))![0]).root, 'simple_expansion').map(nameText);
    assert.deepStrictEqual(quoted, ['$ya', '$ya']);
    const ps = fields(types(tree(OUTSIDE.find(([t]) => t.includes('<(:)'))![0]).root, 'command')[0], 'argument').slice(1);
    assert.deepStrictEqual(ps.map((a) => [a.type, a.text]), [['concatenation', 'a\\\n<(:)'], ['concatenation', 'a<(:)\\\nb'], ['word', 'a'], ['process_substitution', '<\\\n(:)']]);
    assert.deepStrictEqual(ps.slice(0, 2).map((a) => a.namedChildren.map((c) => c.type)), [['word', 'process_substitution'], ['word', 'process_substitution', 'word']]);
    // (A comment that ends with one, and the error bash gives after it.)
    assert.deepStrictEqual(tree('echo a # c \\\n&& b').errors.map((e) => e.startIndex), [13, 16]);
    assert.notStrictEqual(runBash('echo a # c \\\n&& b').status, 0);
    // (Text that unbash cannot read: a heredoc with no delimiter, a `for (( ))` with no end.)
    for (const text of ['a\\\nb; cat <<', 'a\\\nb; for ((i=0; i<1']) assert.ok(tree(text).errors.length, text);
  });
  it('reads the text once when no continuation changes what unbash reads, and in time that grows with the text', () => {
    const reads = (text: string): number => {
      let n = 0;
      prepared(text, (t) => (n++, parse(t)), forEachChild as unknown as Children);
      return n;
    };
    // (Between words, or at the end of a word before a blank, unbash reads one as a blank.)
    assert.strictEqual(reads('cp -v \\\n  a\\\n  b'), 1);
    assert.strictEqual(reads('echo a # c \\\nb'), 1);
    assert.strictEqual(reads('echo a'), 0);
    assert.deepStrictEqual(continuations(parse('cp -v \\\n  a\\\n  b; x=$(: # \\\n)'), forEachChild as unknown as Children, 'cp -v \\\n  a\\\n  b; x=$(: # \\\n)'), []);
    assert.deepStrictEqual(continuations(parse('a\\\nb; echo "$\\\\\n"'), forEachChild as unknown as Children, 'a\\\nb; echo "$\\\\\n"'), [1]);
    const script = (n: number): string => 'echo "$y\\\na" b\\\nc \\\n  d\n'.repeat(n);
    assertGrowth('500 commands, then 4000', () => ub.parse(script(500)), () => ub.parse(script(4000)), 16);
  });
  it('places an arithmetic text where it is written, or gives none across a removed continuation', () => {
    const t = tree('echo $\\\ny; let "a = 1 + 2"');
    const s = types(t.root, 'string')[0];
    const e = t.arithmetic(s, s.startIndex + 1, s.endIndex - 1)!;
    assert.strictEqual(e.text, 'a = 1 + 2');
    const w = types(t.root, 'simple_expansion')[0];
    assert.strictEqual(t.arithmetic(w, w.startIndex, w.endIndex), undefined);
  });
  it('keeps a backslash that a backslash escapes, and puts the errors where they are written', () => {
    // (`"a\\<newline>b"` is `a\`, a newline and `b`.)
    assert.deepStrictEqual(fields(first('echo "a\\\\\nb" $\\\ny'), 'argument').map((a) => a.type), ['string', 'simple_expansion']);
    assert.strictEqual(runBash('printf "<%s>" "a\\\\\nb"').stdout, '<a\\\nb>');
    const bad = tree('echo $\\\ny; if :; then');
    assert.deepStrictEqual(bad.errors.map((e) => [e.startIndex, e.endIndex]), [[21, 21]]); // (the end of the text as written)
    assert.ok(types(bad.root, 'if_statement')[0].incomplete);
  });
});

describe('unbash adapter: heredocs', () => {
  it('has the start, the body and the end, with the expansions of the body', () => {
    assert.equal(o('cat <<E\n${a} $(b) $((1)) $c\nE'),
      '(program (command (command_name @name (word "cat")) (heredoc_redirect @redirect "<<" (heredoc_start "E") '
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
      '(program (pipeline (command (command_name @name (word "cat")) (heredoc_redirect @redirect "<<" (heredoc_start "E") (heredoc_body "x\\n") (heredoc_end "E"))) '
      + '"|" (command (command_name @name (word "wc")) (word @argument "-l"))))');
    assert.equal(o('a <<E && b\nx\nE'),
      '(program (list (command (command_name @name (word "a")) (heredoc_redirect @redirect "<<" (heredoc_start "E") (heredoc_body "x\\n") (heredoc_end "E"))) '
      + '"&&" (command (command_name @name (word "b")))))');
    assert.equal(o('cat <<A 2>&1 >f\n1\nA'),
      '(program (command (command_name @name (word "cat")) (heredoc_redirect @redirect "<<" (heredoc_start "A") (heredoc_body "1\\n") (heredoc_end "A")) '
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
    assert.deepEqual(t.root.namedChildren.map((c) => c.type), ['command', 'command', 'command']);
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
    // A redirection after the last word is the command's too, as in bash.
    assert.equal(o('cat <<EOF out.txt >f\nhi\nEOF'),
      '(program (command (command_name @name (word "cat")) (heredoc_redirect @redirect "<<" (heredoc_start "EOF") (heredoc_body "hi\\n") (heredoc_end "EOF")) (word @argument "out.txt") '
      + '(file_redirect @redirect ">" (word @destination "f"))))');
  });
  it('lets <<- strip the tabs of the first line and of the closing line', () => {
    assert.equal(o('cat <<-"E"\n\tx $a\n\tE'),
      '(program (command (command_name @name (word "cat")) (heredoc_redirect @redirect "<<-" (heredoc_start "\\"E\\"") (heredoc_body "x $a\\n\\t") (heredoc_end "E"))))');
  });
  it('has the closing line after a <<- line that goes on, with the tabs of the body and of the line', () => {
    const text = 'sftp -b - <<-EOF || return 1\n\tx\n\tEOF';
    const t = tree(text);
    assert.deepEqual(t.errors, []);
    const h = types(t.root, 'heredoc_redirect')[0];
    assert.deepEqual(h.children.map((c) => c.type), ['<<-', 'heredoc_start', 'heredoc_body', 'heredoc_end']);
    assert.deepEqual(first(text).namedChildren.map((c) => c.type), ['command', 'command']);
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
  it('[ ] is a command named `[`, with `]` its last argument, as bash parses it; test is a command too', () => {
    assert.equal(o('[ ! -f "$a" -a x = y* ]'),
      '(program (command (command_name @name (word "[")) (word @argument "!") (word @argument "-f") (string @argument "\\"" (simple_expansion "$" (variable_name "a")) "\\"") (word @argument "-a") (word @argument "x") (word @argument "=") (word @argument "y*") (word @argument "]")))');
    // (Quoted, escaped or with an assignment before it, the same.)
    for (const src of ['\\[ a ]', '"[" a ]', 'x=1 [ a ]', '[ a', '[', '[ ]']) assert.equal(first(src).type, 'command', src);
    assert.equal(first('test -f a').type, 'command');
    // (A missing `]` is no syntax error: `[` fails when it runs, with status 2.)
    assert.equal(tree('[ -f a').root.namedChildren[0].incomplete, false);
    assert.equal(errorsOf('[ -f a'), '');
    assert.equal(first('[ a ] > f').type, 'command');
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
      '(program (time_statement "time" (command @body (command_name @name (word "ls")) (word @argument "-l") (file_redirect @redirect ">" (word @destination "o")))))');
    // `time` is a keyword only at the start of a pipeline.
    assert.equal(o('a | time b'), '(program (pipeline (command (command_name @name (word "a"))) "|" (command (command_name @name (word "time")) (word @argument "b"))))');
    assert.equal(first('a && time b').namedChildren[1].type, 'time_statement');
    assert.equal(o('time'), '(program (time_statement "time"))');
    // (Nothing to time, only redirections: they are the statement's.)
    assert.equal(o('time -p >o'), '(program (redirected_statement (time_statement @body "time" (word @option "-p")) (file_redirect @redirect ">" (word @destination "o"))))');
    assert.equal(o('time ! a | b'), '(program (time_statement "time" (negated_command @body "!" (pipeline (command (command_name @name (word "a"))) "|" (command (command_name @name (word "b")))))))');
    assert.equal(o('! time a'), '(program (negated_command "!" (time_statement "time" (command @body (command_name @name (word "a"))))))');
    assert.equal(first('time a && b').type, 'list');
    assert.equal(first('FOO=1 time ls').type, 'command');
  });
  it('coproc: the name, and a command or a group as the body', () => {
    assert.equal(o('coproc ls -l'), '(program (coproc_statement "coproc" (command @body (command_name @name (word "ls")) (word @argument "-l"))))');
    assert.equal(o('coproc NAME { :; }'), '(program (coproc_statement "coproc" (word @name "NAME") (compound_statement @body "{" (command (command_name @name (word ":"))) ";" "}")))');
    assert.equal(o('coproc ls >f').startsWith('(program (coproc_statement "coproc" (command @body (command_name @name (word "ls")) (file_redirect'), true);
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
    // (A group not closed while it is typed: its `)` is missing.)
    assert.deepEqual(tree('(( (1').errors.map((e) => e.message), ['Missing ")"', 'Missing "))"']);
  });
  it('has the three parts of for ((;;)), its names variables as in (( ))', () => {
    assert.equal(o('for ((i=0;i<3;i++)); do :; done'),
      '(program (c_style_for_statement "for" "((" (variable_assignment @initializer (variable_name @name "i") "=" (number @value "0")) ";" '
      + '(binary_expression @condition (variable_name @left "i") "<" (number @right "3")) ";" (postfix_expression @update (variable_name "i") "++") "))" ";" '
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
    // (Found by the fuzz: the `fi` that closes the `if` is not the function's.)
    assert.deepEqual(invariants(tree('if false; then f() fi')), []);
    assert.match(o('if false; then f() fi'), /\(function_definition INCOMPLETE \(word @name "f"\) "\(" "\)"\) "fi"\)\)$/);
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
    assert.equal(o('a=(1 2'), '(program (command (variable_assignment (variable_name @name "a") "=" (array @value INCOMPLETE "(" (number "1") (number "2")))))');
    // Text after the `)` makes the value a plain word: bash assigns `(x)y` (found by the fuzz).
    assert.equal(o('a+=(x)one < f'), '(program (command (variable_assignment (variable_name @name "a") "+=" (word @value "(x)one")) (file_redirect @redirect "<" (word @destination "f"))))');
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
      + '(brace_expression @argument "{" (number "1") ".." (number "3") "}") (brace_expression @argument "{" (word "a") ".." (word "e") ".." (number "2") "}") (brace_expression @argument "{" (word "a") "," (word "b") "}")))');
    assert.equal(o('echo 5 -3 0x1f 1.5 007'),
      '(program (command (command_name @name (word "echo")) (number @argument "5") (number @argument "-3") (word @argument "0x1f") (word @argument "1.5") (number @argument "007")))');
  });
  it('reads a string line by line, as the grammar does', () => {
    const s = types(tree('echo "a b\n\nc $d\n e"').root, 'string')[0];
    assert.deepEqual(s.children.map((c) => `${c.type}:${c.text}`), ['":"', 'string_content:a b', 'string_content:c ', 'simple_expansion:$d', 'string_content: e', '":"']);
  });
  it('has assignments, in a command, alone, or as several', () => {
    // Alone, they are a command with no name, as in bash (a simple command with no words).
    assert.equal(o('x=1'), '(program (command (variable_assignment (variable_name @name "x") "=" (number @value "1"))))');
    assert.equal(o('x=1 y="$z" w='),
      '(program (command (variable_assignment (variable_name @name "x") "=" (number @value "1")) '
      + '(variable_assignment (variable_name @name "y") "=" (string @value "\\"" (simple_expansion "$" (variable_name "z")) "\\"")) (variable_assignment (variable_name @name "w") "=")))');
    assert.equal(o('x=1 y=2 cmd z'),
      '(program (command (variable_assignment (variable_name @name "x") "=" (number @value "1")) (variable_assignment (variable_name @name "y") "=" (number @value "2")) '
      + '(command_name @name (word "cmd")) (word @argument "z")))');
    assert.equal(o('a[1]=x b+=y'),
      '(program (command (variable_assignment (subscript @name (variable_name @name "a") "[" (number @index "1") "]") "=" (word @value "x")) '
      + '(variable_assignment (variable_name @name "b") "+=" (word @value "y"))))');
    assert.equal(o('a=(1 [2]=x "y") b=()'),
      '(program (command (variable_assignment (variable_name @name "a") "=" (array @value "(" (number "1") (concatenation (word "[") (number "2") (word "]") (word "=x")) (string "\\"" (string_content "y") "\\"") ")")) '
      + '(variable_assignment (variable_name @name "b") "=" (array @value "(" ")"))))');
  });
  it('has declarations, unset, and assignment-like words of other commands', () => {
    // A declaration is a plain command; after a first word written as a declaration builtin, an assignment is one.
    assert.equal(o('declare -a x=(1 2) y; local -r q=1 r; readonly z; export A=b'),
      '(program (command (command_name @name (word "declare")) (word @argument "-a") (variable_assignment @argument (variable_name @name "x") "=" (array @value "(" (number "1") (number "2") ")")) (word @argument "y")) ";" '
      + '(command (command_name @name (word "local")) (word @argument "-r") (variable_assignment @argument (variable_name @name "q") "=" (number @value "1")) (word @argument "r")) ";" '
      + '(command (command_name @name (word "readonly")) (word @argument "z")) ";" (command (command_name @name (word "export")) (variable_assignment @argument (variable_name @name "A") "=" (word @value "b"))))');
    // (After prefix assignments and redirections too; not when the name is quoted or escaped: bash then rejects `a=(…)`.)
    assert.equal(o('x=1 declare g=(1)'), '(program (command (variable_assignment (variable_name @name "x") "=" (number @value "1")) (command_name @name (word "declare")) '
      + '(variable_assignment @argument (variable_name @name "g") "=" (array @value "(" (number "1") ")"))))');
    assert.equal(o('>o typeset g=$v').includes('(variable_assignment @argument'), true);
    assert.equal(o('\\declare g=$v'), '(program (command (command_name @name (word "\\\\declare")) (concatenation @argument (word "g=") (simple_expansion "$" (variable_name "v")))))');
    assert.equal(o('command declare g=$v').includes('variable_assignment'), false);
    // `unset` is a plain command: what its words mean comes from its spec and the model, not from the tree.
    assert.equal(o('unset -f f a[1]'), '(program (command (command_name @name (word "unset")) (word @argument "-f") (word @argument "f") (word @argument "a[1]")))');
    assert.equal(o('alias ll="ls -l"'),
      '(program (command (command_name @name (word "alias")) (concatenation @argument (word "ll=") (string "\\"" (string_content "ls -l") "\\""))))');
    assert.equal(o('make CC=gcc'), '(program (command (command_name @name (word "make")) (word @argument "CC=gcc")))');
    assert.equal(o('alias x= y'), '(program (command (command_name @name (word "alias")) (word @argument "x=") (word @argument "y")))');
    assert.equal(o('export A=b >f').startsWith('(program (command (command_name'), true);
    assert.equal(o('unset x 2>f').startsWith('(program (command (command_name'), true);
    assert.deepEqual(first('declare -p >f 2>&1').namedChildren.map((c) => c.type), ['command_name', 'word', 'file_redirect', 'file_redirect']);
    assert.equal(o('x=1 unset y').startsWith('(program (command (variable_assignment'), true);
    assert.equal(o('FOO=1 declare x').startsWith('(program (command (variable_assignment'), true);
    assert.equal(o('declare x <<<y').includes('(herestring_redirect'), true);
    assert.equal(o('unset x <<<y').includes('(herestring_redirect'), true);
  });
  it('has redirections: descriptors, here strings, a command with none, and after the first word', () => {
    assert.equal(o('echo >f a 2>&1 <g'),
      '(program (command (command_name @name (word "echo")) (file_redirect @redirect ">" (word @destination "f")) (word @argument "a") '
      + '(file_redirect @redirect (file_descriptor @descriptor "2") ">&" (number @destination "1")) (file_redirect @redirect "<" (word @destination "g"))))');
    assert.equal(o('>f'), '(program (command (file_redirect @redirect ">" (word @destination "f"))))');
    assert.equal(o('cat <<<"$x" a'),
      '(program (command (command_name @name (word "cat")) (herestring_redirect @redirect "<<<" (string "\\"" (simple_expansion "$" (variable_name "x")) "\\"")) (word @argument "a")))');
    assert.equal(o('exec 3>&- {fd}>f &>o'),
      '(program (command (command_name @name (word "exec")) (file_redirect @redirect (file_descriptor @descriptor "3") ">&" (word @destination "-")) '
      + '(file_redirect @redirect (file_descriptor @descriptor "{fd}") ">" (word @destination "f")) (file_redirect @redirect "&>" (word @destination "o"))))');
    assert.equal(o('x=1 >f'), '(program (command (variable_assignment (variable_name @name "x") "=" (number @value "1")) (file_redirect @redirect ">" (word @destination "f"))))');
    assert.equal(o('x=1 y=2 >f 2>g').startsWith('(program (command (variable_assignment'), true);
    // Every redirection of a command with no name is its own, wherever it is written.
    assert.equal(o('x=1 >f y=2'), '(program (command (variable_assignment (variable_name @name "x") "=" (number @value "1")) '
      + '(file_redirect @redirect ">" (word @destination "f")) (variable_assignment (variable_name @name "y") "=" (number @value "2"))))');
    assert.equal(o('>f x=1 >g'), '(program (command (file_redirect @redirect ">" (word @destination "f")) '
      + '(variable_assignment (variable_name @name "x") "=" (number @value "1")) (file_redirect @redirect ">" (word @destination "g"))))');
    assert.equal(o('>f >g'), '(program (command (file_redirect @redirect ">" (word @destination "f")) (file_redirect @redirect ">" (word @destination "g"))))');
  });
  it('gives the redirections after the last command of a pipeline or a list to that command, as bash does', () => {
    assert.equal(o('a | b >f'),
      '(program (pipeline (command (command_name @name (word "a"))) "|" (command (command_name @name (word "b")) (file_redirect @redirect ">" (word @destination "f")))))');
    assert.equal(o('a && b >f'),
      '(program (list (command (command_name @name (word "a"))) "&&" (command (command_name @name (word "b")) (file_redirect @redirect ">" (word @destination "f")))))');
    assert.equal(o('a >f | b').startsWith('(program (pipeline (command (command_name @name (word "a")) (file_redirect'), true);
    // A compound command takes its own, also at the end of a list.
    assert.equal(o('a && { b; } >f').includes('"&&" (redirected_statement (compound_statement @body'), true);
    assert.equal(o('{ a; } >f').startsWith('(program (redirected_statement (compound_statement @body'), true);
  });
  it('negates the whole pipeline with !', () => {
    assert.equal(o('! a >f'), '(program (negated_command "!" (command (command_name @name (word "a")) (file_redirect @redirect ">" (word @destination "f")))))');
    assert.equal(o('! a | b >f').startsWith('(program (negated_command "!" (pipeline (command (command_name @name (word "a"))) "|" (command (command_name @name (word "b")) (file_redirect'), true);
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
    assert.equal(first('[ a ]; echo').type, 'command');
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
  it('an escaped backslash at the start of the script stays inside the substitution', () => {
    // bash: `\\` runs the command `\`; the backslash pair is one word, and the parents start with it.
    for (const src of ['echo `\\\\`echo x\\\\``', 'echo `a\\\\`b`', 'x=`\\\\``']) {
      const t = tree(src);
      assert.deepEqual(soundness(t), [], src);
      const sub = types(t.root, 'command_substitution')[0];
      const cmd = sub.children.find((c) => c.type === 'command')!;
      assert.ok(cmd.startIndex >= sub.startIndex + 1 && cmd.endIndex <= sub.endIndex - 1, src);
    }
    const t = tree('echo `\\\\`echo x\\\\``');
    assert.deepEqual(types(t.root, 'command_name').filter((c) => c.startIndex === 6).map((c) => c.text), ['\\\\']);
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
    assert.deepEqual(first('a | cat <<E | wc\nx\nE\n').namedChildren.map((c) => c.type), ['command', 'command', 'command']);
    assert.equal(types(t.root, 'pipeline').length, 1);
  });
  it('a redirection before the command, or among the words of a [ ]', () => {
    assert.equal(o('>f echo a'), '(program (command (file_redirect @redirect ">" (word @destination "f")) (command_name @name (word "echo")) (word @argument "a")))');
    assert.equal(o('x=1 >f cmd').includes('(file_redirect @redirect'), true);
    assert.equal(o('[ a >f b ]'), '(program (command (command_name @name (word "[")) (word @argument "a") (file_redirect @redirect ">" (word @destination "f")) (word @argument "b") (word @argument "]")))');
    assert.equal(o('declare >f x').includes('(file_redirect'), true);
    assert.equal(o('unset >f x').includes('(file_redirect'), true);
  });
  it('a bare declare, unset or [', () => {
    assert.equal(o('declare'), '(program (command (command_name @name (word "declare"))))');
    assert.equal(o('unset'), '(program (command (command_name @name (word "unset"))))');
    assert.equal(first('[').incomplete, false);
    assert.equal(first('[').type, 'command');
    assert.deepEqual(tree('[ -f x').errors, []);
  });
  it('patterns and the right side of =~', () => {
    assert.equal(o('[[ x == a.b ]]').includes('(word @right "a.b")'), true);
    assert.equal(o('[[ x =~ 12 ]]').includes('(number @right "12")'), true);
    assert.equal(o('[[ x =~ re ]]').includes('(word @right "re")'), true);
    assert.equal(o('[ x = ab ]').includes('(word @argument "ab")'), true);
    assert.equal(o('[ x = a* ]').includes('(word @argument "a*")'), true);
    assert.equal(o('[ x = \\? ]').includes('(word @argument "\\\\?")'), true);
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
    // The best of five runs: the first ones are slow while the code warms up.
    const unbash = fastest(() => ub.parse(text));
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
    assert.deepEqual(e.items.map((i) => i.label), ['cat; rm']);
    assert.deepEqual(e.items[0].children.map((i) => i.label), ['cat <<EOF', ';', 'rm']);
    assert.match(flat(e.items).find((t) => t.label === 'rm' && t.kind === 'command')!.explanation, /Remove files/);
    assert.ok(e.notes.some((n) => /\$dir` is not quoted/.test(n)), e.notes.join('|'));
    // Its body lines are the here-document's; the line after is a statement of its own.
    assert.match(new Analyzer('en').explainLine(tree(src), 1).notes[0], /part of the here-document/);
    assert.equal(new Analyzer('en').explainLine(tree(src), 3).items[0].label, 'echo');
  });
  it('explains the later stages of a heredoc line, and the redirections beside it', () => {
    const e = new Analyzer('en').explainLine(tree('cat <<EOF | tr a-z A-Z && echo after\nhi\nEOF'), 0);
    assert.equal(e.items[0].children.length, 3);
    assert.ok(flat(e.items).some((t) => t.label === 'tr'));
    const r = new Analyzer('en').explainLine(tree('cat <<EOF > out.txt\nhi\nEOF'), 0);
    assert.deepEqual(r.items[0].children.map((c) => c.label), ['cat', '<<EOF', '> out.txt']);
  });
  it('explains the redirections of a compound command with a here string', () => {
    const e = new Analyzer('en').explainLine(tree('{ cat; } <<< x > f'), 0);
    assert.match(e.items[0].explanation, /as a whole/);
    assert.deepEqual(e.items[0].children.slice(-2).map((c) => c.label), ['<<< x', '> f']);
  });
  it('explains a redirection after the last command, and ! over a pipeline, as tree-sitter does now', () => {
    const e = new Analyzer('en').explainLine(tree('echo A && echo B > f'), 0);
    assert.deepEqual(e.items[0].children.map((c) => c.label), ['echo', '&&', 'echo > f']);
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
  it('a bracket expression keeps its quotes and expansions, which bash expands: `[$x]`, `["$x"].c`, also beside braces', () => {
    assert.equal(o('echo [$d].c ["$x"] a[b$x] [a{b,c}$x]'), '(program (command (command_name @name (word "echo")) '
      + '(concatenation @argument (word "[") (simple_expansion "$" (variable_name "d")) (word "].c")) '
      + '(concatenation @argument (word "[") (string "\\"" (simple_expansion "$" (variable_name "x")) "\\"") (word "]")) '
      + '(concatenation @argument (word "a[b") (simple_expansion "$" (variable_name "x")) (word "]")) '
      + '(concatenation @argument (word "[a") (brace_expression "{" (word "b") "," (word "c") "}") (simple_expansion "$" (variable_name "x")) (word "]"))))');
    // (In a pattern too; a bracket with no part in it stays one word.)
    assert.equal(o('case $1 in [$x]|[ab]) ;; esac').includes('(concatenation @value (extglob_pattern "[") (simple_expansion "$" (variable_name "x")) (word "]")) "|" (extglob_pattern @value "[ab]")'), true);
  });

  it('[7]=z in an array is the index (a concatenation of four pieces, as the model has it)', () => {
    assert.equal(o('a+=([7]=z)'), '(program (command (variable_assignment (variable_name @name "a") "+=" (array @value "(" (concatenation (word "[") (number "7") (word "]") (word "=z")) ")"))))');
    assert.equal(o('a=([k]+=v)').includes('(word "k")'), true);
    // A `]` not followed by `=` (or by `+=`) does not make an index: the element is a plain word.
    assert.equal(o('a=([]x)'), '(program (command (variable_assignment (variable_name @name "a") "=" (array @value "(" (word "[]x") ")"))))');
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
    assert.deepEqual(first('echo x{,}').namedChildren[1].namedChildren.map((c) => c.type), ['word', 'brace_expression']);
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

describe('unbash adapter: brace expressions as bash finds them (3.5.1)', () => {
  /** The brace expressions of the word `w`, the outermost (its own pieces), by their text. */
  const braces = (w: string): string[] => {
    const arg = first(`echo ${w}`).namedChildren[1];
    return (arg.type === 'concatenation' ? arg.namedChildren : [arg]).filter((c) => c.type === 'brace_expression').map((c) => c.text);
  };
  // [word, its brace expressions]. (Most were found by comparing random words with bash.)
  const CASES: [string, string[]][] = [
    ['{a,b}', ['{a,b}']], ['{a,}', ['{a,}']], ['{,}', ['{,}']], ['{a,{b,c}}', ['{a,{b,c}}']], ['x{a,b}y', ['{a,b}']], ['{{a,b}}', ['{a,b}']],
    ['{a,b}{1..2}', ['{a,b}', '{1..2}']], ['{a,"b c"}', ['{a,"b c"}']], ['{a,$x}', ['{a,$x}']], ['{a,b\\}c}', ['{a,b\\}c}']],
    ['{[a,b],c}', ['{[a,b],c}']], ['\\${a,b}', ['{a,b}']], ['{a,{b,c}', ['{b,c}']], ['{+1..3}', ['{+1..3}']],
    // (A `}` before the first `,` or `..` does not close the braces; a `{` that starts a word and a `}` follows is no brace.)
    ['{a}b,c}', ['{a}b,c}']], ['x{},a}', ['{},a}']], ['{},a}', []], ['{..},}', ['{..},}']], ['{a}..c}', []],
    // (Braces with a `..` that hold no sequence: they stay, with what is in them, unless a comma is deeper inside.)
    ['{x..{a,b}}', ['{x..{a,b}}']], ['{x.."a,b"}', ['{x.."a,b"}']], ['{x..{1..2}}', []], ['{1..b}', []], ['{x\\..{a,b}}', ['{a,b}']],
    ['{a}', []], ['{}', []], ['{a,b', []], ['"{a,b}"', []], ["'{a,b}'", []], ['\\{a,b}', []], ['{a\\,b}', []], ['{"a,b"}', []], ['${x,y}', []], ['{x,{y}', []],
    // (Quotes and expansions in a bracket or an extended glob are opaque; braces there are braces.)
    ['["{a,b}"]', []], ['[{"a,b"}]', []], ['a[{"x,y"}]b', []], ['[${v:-a,b}]', []], ['@(${v:-a,b}|x)', []], ['[{a,b}]', ['{a,b}']], ['@({a,b}|x)', ['{a,b}']],
    // (bash's scan reads characters: the `{` after `$$` starts a parameter expansion, braces and all, to its `}` or the end.)
    ['$${1..2}', []], ['$${a,b}', []], ['a$${1..2}b', []], ['$${a{b,c}}', []], ['$${x{a,b}', []], ['{a,$${b,c}}', ['{a,$${b,c}}']], ['$${a}{b,c}', ['{b,c}']],
    ['$\\{1..2}', []], ['$$\\{1..2}', []], ['\\$${a}x{1,2}', ['{1,2}']], ['"$"{1..2}', ['{1..2}']], ["$'$'{1..2}", ['{1..2}']], ['$$$${a,b}', []], ['$$$x{a,b}', ['{a,b}']],
    ['$$a{b,c}', ['{b,c}']], ['$${a\\}b,c}x', []], ['$${a"}"b}{c,d}', ['{c,d}']],
  ];

  it('makes one of each brace expansion bash makes, and of nothing else', () => {
    for (const [w, want] of CASES) assert.deepStrictEqual(braces(w), want, w);
    // What bash prints for each word, with brace expansion and with `set +B`: they differ where it expands braces.
    const lines = runBash(['shopt -s extglob', ...CASES.map(([w]) => `printf '<%s>' ${w}; printf ' ~~ '; set +B; printf '<%s>' ${w}; set -B; echo`)].join('\n'), { files: [] }).stdout.split('\n');
    CASES.forEach(([w, want], i) => {
      const [on, off] = lines[i].split(' ~~ ');
      assert.strictEqual(on !== off, want.length > 0, `${w}: ${lines[i]}`);
    });
  });

  it('nests at most 64 lists, so that the readers can walk a deep word', () => {
    const src = `echo ${'{a,'.repeat(3000)}b${'}'.repeat(3000)}`;
    let depth = 0;
    for (let n: SyntaxNode | undefined = first(src).namedChildren[1]; n; n = n.namedChildren.find((c) => c.type === 'brace_expression')) depth++;
    assert.strictEqual(depth, 64);
    assert.doesNotThrow(() => new Analyzer('en').explainLine(tree(src), 0));
  });

  it('reads the items of a list: words, quotes, expansions and lists in them', () => {
    assert.equal(o('echo x{a,"b c",$v,{d,e}f,}'), '(program (command (command_name @name (word "echo")) (concatenation @argument (word "x") (brace_expression "{" (word "a") "," '
      + '(string "\\"" (string_content "b c") "\\"") "," (simple_expansion "$" (variable_name "v")) "," (concatenation (brace_expression "{" (word "d") "," (word "e") "}") (word "f")) "," "}"))))');
    // (A `}` that is text, and braces that stay text with the parts in them: `$n` of `{1..$n}`, the string of a bracket
    // expression, but not those of an extended glob.)
    assert.equal(o('echo {a}b,c} {1..$n} ["{a,b}"] @(${v:-a,b})'), '(program (command (command_name @name (word "echo")) (brace_expression @argument "{" (word "a}b") "," (word "c") "}") '
      + '(concatenation @argument (word "{1..") (simple_expansion "$" (variable_name "n")) (word "}")) '
      + '(concatenation @argument (word "[") (string "\\"" (string_content "{a,b}") "\\"") (word "]")) (word @argument "@(${v:-a,b})")))');
    // (No brace expression where bash never expands braces: a pattern, `[[ ]]`, an operand of `${ }`.)
    assert.equal(types(tree('case x in {a,b}) ;; esac; [[ {a,b} == {c,d} ]]; echo ${x:-{a,b}}').root, 'brace_expression').length, 0);
    assert.strictEqual(runBash('case a in {a,b}) echo m;; *) echo n;; esac; [[ {a,b} == {a,b} ]] && echo t; echo ${x:-{a,b}}').stdout, 'n\nt\n{a,b}\n');
  });
});
