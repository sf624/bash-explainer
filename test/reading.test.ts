// The reading tree of a line (src/reading.ts), which the panel's tree view draws: who reads each part, in layers.
// The layers come from the tree and from `Token.origin`, which the analyzer sets where it makes each token.
import * as assert from 'assert';
import { spawnSync } from 'child_process';
import { Analyzer, Token } from '../src/analyzer';
import { explainHostedLine, extractShell, type HostKind } from '../src/hosts';
import { readingNodes, readingTree, type ReadingNode } from '../src/reading';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { panelUpdate } from '../src/ui/panelView';

const parser = createUnbashParser();
const analyzer = new Analyzer('en');

/** The explanation of a line of `src`, with its reading tree. */
const explain = (src: string, line = 0) => analyzer.explainLine(parser.parse(src), line, 'bash', { reading: true });

/** The tree as lines: `layer/kind label`, indented by depth. */
function outline(n: ReadingNode, depth = 0): string[] {
  return [`${'  '.repeat(depth)}${n.layer}/${n.kind} ${n.label}`, ...n.children.flatMap((c) => outline(c, depth + 1))];
}
const tree = (src: string, line = 0): string[] => outline(explain(src, line).reading!);

/** The first node of a tree with this label (and layer, and kind). */
function find(n: ReadingNode, label: string, layer?: string, kind?: string): ReadingNode {
  return readingNodes(n).find((x) => x.label === label && (!layer || x.layer === layer) && (!kind || x.kind === kind))!;
}

/** What bash prints for `script` (a fixed script: nothing generated, nothing that recurses). */
const bash = (script: string): string => spawnSync('bash', ['--norc', '--noprofile', '-c', script], { encoding: 'utf8', timeout: 10000 }).stdout;

describe('the reading tree of a line', () => {
  it('reads an assignment of `$( )`, then a test: bash, the subshell in `$( )`, grep\'s arguments, its regex, and `[`\'s', () => {
    assert.deepStrictEqual(tree('x=$(grep -c foo f) && [ "$x" -gt 0 ]'), [
      'bash/line ',
      '  bash/list x=$(grep -c foo f) && [ "$x" -gt 0 ]',
      '    bash/command x=$(grep -c foo f)',
      '      bash/assignment x=$(grep -c foo f)',
      '        bash/name x',
      '        bash/substitution $(grep -c foo f)',
      '          child/script grep -c foo f',
      '            child/command grep -c foo f',
      '              child/commandName grep',
      '              child/argument -c',
      '                command/option -c',
      '              child/argument foo',
      '                command/argument foo',
      '                  language/language regex',
      '                    language/string foo',
      '              child/argument f',
      '                command/argument f',
      '    bash/operator &&',
      '    bash/command [ "$x" -gt 0 ]',
      '      bash/commandName [',
      '      bash/argument "$x"',
      '        bash/quote "$x"',
      '          bash/expansion $x',
      '      bash/argument -gt',
      '      bash/argument 0',
      // (`[` reads three of its arguments as one expression: after them.)
      '      command/test "$x" -gt 0',
      '      bash/argument ]',
      '        command/argument ]',
    ]);
    const r = explain('x=$(grep -c foo f) && [ "$x" -gt 0 ]').reading!;
    // The explanations are the tokens' about the same text: bash's own for bash's nodes, the command's for its reading.
    assert.match(find(r, '$(grep -c foo f)').text!, /^Command substitution/);
    assert.deepStrictEqual(find(r, '$(grep -c foo f)').refs, ['3.5.4']);
    assert.match(find(r, 'grep', 'child').text!, /matching a pattern/);
    assert.strictEqual(find(r, 'foo', 'command').text, 'search pattern (regex) — basic regex (BRE)');
    assert.strictEqual(find(r, 'foo', 'child').text, undefined);
    // Who reads: the command, by name, and the shell of the substitution.
    assert.strictEqual(find(r, 'foo', 'command').reader, 'grep');
    assert.strictEqual(find(r, 'regex').reader, 'grep');
    assert.strictEqual(find(r, '"$x" -gt 0').reader, '[');
    assert.strictEqual(find(r, 'grep -c foo f', 'child', 'script').process, 'child');
    // The subshell parses the text between `$(` and `)`.
    assert.deepStrictEqual(find(r, 'grep -c foo f', 'child', 'script').span, { start: { line: 0, character: 4 }, end: { line: 0, character: 17 } });
    assert.deepStrictEqual(r.span, { start: { line: 0, character: 0 }, end: { line: 0, character: 36 } });
  });

  it('reads a pipeline into xargs: find\'s expression and its glob, the command xargs runs and its regex', () => {
    assert.deepStrictEqual(tree("find . -name '*.sh' | xargs grep -n 'set -e'"), [
      'bash/line ',
      "  bash/pipeline find . -name '*.sh' | xargs grep -n 'set -e'",
      "    bash/command find . -name '*.sh'",
      '      bash/commandName find',
      '      bash/argument .',
      '        command/argument .',
      '      bash/argument -name',
      "      bash/argument '*.sh'",
      "        bash/quote '*.sh'",
      '      command/test -name *.sh',
      '        command/option -name',
      "        command/argument '*.sh'",
      '          language/language glob',
      '            language/pattern *',
      '            language/string .sh',
      '    bash/operator |',
      "    bash/command xargs grep -n 'set -e'",
      '      bash/commandName xargs',
      '      bash/argument grep',
      '      bash/argument -n',
      "      bash/argument 'set -e'",
      "        bash/quote 'set -e'",
      '      command/command grep',
      '        command/option -n',
      "        command/argument 'set -e'",
      '          language/language regex',
      '            language/string set -e',
    ]);
    // xargs reads the command it runs; that command reads its own arguments.
    const r = explain("find . -name '*.sh' | xargs grep -n 'set -e'").reading!;
    assert.strictEqual(find(r, 'grep', 'command').reader, 'xargs');
    assert.strictEqual(find(r, '-n', 'command').reader, 'grep');
  });

  it('reads a here-document as a redirection with its body, on each line of it', () => {
    const src = 'cat <<EOF > out.txt\nhello $USER\nEOF\n';
    const expected = [
      'bash/line ',
      '  bash/command cat <<EOF > out.txt',
      '    bash/commandName cat',
      '    bash/redirect <<EOF',
      '      bash/heredoc hello $USER',
      '        bash/expansion $USER',
      '    bash/redirect > out.txt',
    ];
    assert.deepStrictEqual(tree(src), expected);
    assert.deepStrictEqual(tree(src, 1), expected);
    const r = explain(src).reading!;
    assert.deepStrictEqual(find(r, '<<EOF').span, { start: { line: 0, character: 4 }, end: { line: 0, character: 9 } });
    assert.deepStrictEqual(find(r, '<<EOF').refs, ['3.6.6']);
    // A command after it on the line: the line reads to the end of the here-document.
    const two = explain('cat <<E; echo b\nx\nE\n').reading!;
    assert.deepStrictEqual(two.children.map((c) => c.label), ['cat <<E', 'echo b']);
    assert.deepStrictEqual(two.span.end, { line: 2, character: 1 });
  });

  it('reads a function definition: its name, its body, and a sed script inside', () => {
    assert.deepStrictEqual(tree("f() { echo \"$1\" | sed 's/a/b/'; }"), [
      'bash/line ',
      '  bash/function f() { ‹commands› }',
      '    bash/name f',
      '    bash/compound { ‹commands› }',
      '      bash/keyword {',
      "      bash/pipeline echo \"$1\" | sed 's/a/b/'",
      '        bash/command echo "$1"',
      '          bash/commandName echo',
      '          bash/argument "$1"',
      '            bash/quote "$1"',
      '              bash/expansion $1',
      '            command/argument "$1"',
      '        bash/operator |',
      "        bash/command sed 's/a/b/'",
      '          bash/commandName sed',
      "          bash/argument 's/a/b/'",
      "            bash/quote 's/a/b/'",
      "            command/argument 's/a/b/'",
      '              language/language sed',
      '                language/command s/a/b/',
      '                  language/command s',
      '                  language/operator /',
      '                  language/pattern a',
      '                    language/string a',
      '                  language/operator /',
      '                  language/string b',
      '                  language/operator /',
      '      bash/keyword }',
    ]);
  });

  it('reads a pipeline with redirections: they are parts of each command, not of what it reads', () => {
    const r = explain('sort < in.txt 2>/dev/null | uniq -c > out.txt').reading!;
    assert.deepStrictEqual(outline(r), [
      'bash/line ',
      '  bash/pipeline sort < in.txt 2>/dev/null | uniq -c > out.txt',
      '    bash/command sort < in.txt 2>/dev/null',
      '      bash/commandName sort',
      '      bash/redirect < in.txt',
      '      bash/redirect 2>/dev/null',
      '    bash/operator |',
      '    bash/command uniq -c > out.txt',
      '      bash/commandName uniq',
      '      bash/argument -c',
      '        command/option -c',
      '      bash/redirect > out.txt',
    ]);
    // The command around its redirections is explained by the token of the redirections.
    assert.match(find(r, 'sort < in.txt 2>/dev/null').text!, /^Redirection applied to `sort`/);
    assert.deepStrictEqual(find(r, '2>/dev/null').refs, ['3.6.2']);
  });

  it('reads a process substitution and backquotes as substitutions a subshell parses', () => {
    assert.deepStrictEqual(tree('diff <(ls a) `ls b`'), [
      'bash/line ',
      '  bash/command diff <(ls a) `ls b`',
      '    bash/commandName diff',
      '    bash/argument <(ls a)',
      '      bash/substitution <(ls a)',
      '        child/script ls a',
      '          child/command ls a',
      '            child/commandName ls',
      '            child/argument a',
      '              command/argument a',
      '      command/argument <(ls a)',
      '    bash/argument `ls b`',
      '      bash/substitution `ls b`',
      '        child/script ls b',
      '          child/command ls b',
      '            child/commandName ls',
      '            child/argument b',
      '              command/argument b',
      '      command/argument `ls b`',
    ]);
  });

  it('reads a string a command gives a shell as a script: its commands, and what they read', () => {
    assert.deepStrictEqual(tree("bash -c 'echo a | wc -l'"), [
      'bash/line ',
      "  bash/command bash -c 'echo a | wc -l'",
      '    bash/commandName bash',
      '    bash/argument -c',
      '      command/option -c',
      "    bash/argument 'echo a | wc -l'",
      "      bash/quote 'echo a | wc -l'",
      "      command/argument 'echo a | wc -l'",
      '        child/operator echo | wc',
      '          child/builtin echo',
      '            command/argument a',
      '          child/operator |',
      '          child/command wc',
      '            command/option -l',
    ]);
    const r = explain("bash -c 'echo a | wc -l'").reading!;
    assert.strictEqual(find(r, 'echo', 'child').process, 'child');
    assert.strictEqual(find(r, '-l', 'command').reader, 'wc');
    // (Levels inside levels are the same layer: the `$( )` of a string `bash -c` runs.)
    assert.deepStrictEqual(outline(find(explain("bash -c 'echo $(pwd)'").reading!, 'echo', 'child')), [
      'child/builtin echo',
      '  command/argument $(pwd)',
      '    child/substitution $(pwd)',
      '      child/builtin pwd',
    ]);
  });

  it('says which shell reads a string: this one again for `eval` and a trap, a child for `bash -c`, a remote one for `ssh`', () => {
    const r = explain("eval \"ls; echo hi\"; trap 'rm -f x' EXIT").reading!;
    assert.deepStrictEqual(outline(r), [
      'bash/line ',
      '  bash/command eval "ls; echo hi"',
      '    bash/commandName eval',
      '    bash/argument "ls; echo hi"',
      '      bash/quote "ls; echo hi"',
      // (eval takes the word as it is, and this shell reads it again: no reading of eval's own in between.)
      '      child/command ls',
      '      child/operator ;',
      '      child/builtin echo',
      '        command/argument hi',
      "  bash/command trap 'rm -f x' EXIT",
      '    bash/commandName trap',
      "    bash/argument 'rm -f x'",
      "      bash/quote 'rm -f x'",
      "      command/argument 'rm -f x'",
      '        child/command rm',
      '          command/option -f',
      '          command/argument x',
      '    bash/argument EXIT',
      '      command/argument EXIT',
    ]);
    assert.deepStrictEqual([find(r, 'ls', 'child').process, find(r, 'echo', 'child').process, find(r, 'rm', 'child').process], ['same', 'same', 'same']);
    assert.strictEqual(find(explain("bash -c 'ls'").reading!, 'ls', 'child').process, 'child');
    assert.strictEqual(find(explain('ssh host ls -l').reading!, 'ls', 'child').process, 'remote');
    assert.strictEqual(find(explain('docker exec c sh -c ls').reading!, 'ls', 'child').process, 'container');
    // As bash runs them: `eval` and a trap's action run in this shell ($BASHPID is $$), `bash -c` and `$( )` in another.
    assert.strictEqual(bash('eval \'[ "$BASHPID" = "$$" ] && echo same\''), 'same\n');
    assert.strictEqual(bash('trap \'[ "$BASHPID" = "$$" ] && echo same\' EXIT'), 'same\n');
    // (Not as the last command: bash would run the inner bash in its own process, with exec.)
    assert.strictEqual(bash('p=$$; bash -c "[ \\$BASHPID != $p ] && echo child"; :'), 'child\n');
    assert.strictEqual(bash('x=$(echo "$BASHPID"); [ "$x" != "$$" ] && echo child'), 'child\n');
  });

  it('reads a simple command as bash does: assignments, the command name, the arguments, redirections', () => {
    assert.deepStrictEqual(tree('ls -l a'), [
      'bash/line ',
      '  bash/command ls -l a',
      '    bash/commandName ls',
      '    bash/argument -l',
      '      command/option -l',
      '    bash/argument a',
      '      command/argument a',
    ]);
    assert.deepStrictEqual(tree('x=1 cmd a >f'), [
      'bash/line ',
      '  bash/command x=1 cmd a >f',
      '    bash/assignment x=1',
      '      bash/name x',
      '    bash/commandName cmd',
      '    bash/argument a',
      '      command/argument a',
      '    bash/redirect >f',
    ]);
    // A command with no name: its assignments or redirections only.
    assert.deepStrictEqual(tree('>f'), ['bash/line ', '  bash/command >f', '    bash/redirect >f']);
    // `[` is the command name, and `]` its last argument.
    assert.deepStrictEqual(tree('[ -f x ]'), [
      'bash/line ',
      '  bash/command [ -f x ]',
      '    bash/commandName [',
      '    bash/argument -f',
      '    bash/argument x',
      '    command/test -f x',
      '    bash/argument ]',
      '      command/argument ]',
    ]);
    const r = explain('x=1 cmd a').reading!;
    assert.deepStrictEqual(find(r, 'x=1 cmd a').refs, ['3.7.1']);
    // (An assignment before a command is in its environment, 3.7.4.)
    assert.deepStrictEqual(find(r, 'x=1').refs, ['3.7.4', '3.7.1']);
    assert.deepStrictEqual(find(r, 'cmd').refs, ['3.7.1', '3.7.2']);
    assert.deepStrictEqual(find(r, 'a', 'bash').refs, ['3.7.1']);
    // The name says what bash runs (3.7.2), and what the command is.
    const names = (src: string) => readingNodes(explain(src).reading!).filter((n) => n.kind === 'commandName').map((n) => `${n.label} ${n.resolves}`);
    assert.deepStrictEqual(names('f() { :; }; f; echo; ls; \\ls; ./a.sh'), [': builtin', 'f function', 'echo builtin', 'ls file', '\\ls file', './a.sh file']);
    assert.match(find(explain('ls -l a').reading!, 'ls').text!, /List directory contents/);
    assert.ok(find(explain('[ -f x ]').reading!, '[').refs!.includes('3.7.2'));
  });

  it('does not name a command whose name is known only when it runs', () => {
    assert.deepStrictEqual(tree('$cmd a'), [
      'bash/line ',
      '  bash/command $cmd a',
      '    bash/expandedName $cmd',
      '      bash/expansion $cmd',
      '    bash/word a',
    ]);
    assert.deepStrictEqual(tree('"$@"'), [
      'bash/line ',
      '  bash/command "$@"',
      '    bash/expandedName "$@"',
      '      bash/quote "$@"',
      '        bash/expansion $@',
    ]);
    // `$e` expands to nothing: the name is `echo`, which comes after.
    assert.deepStrictEqual(tree('e=; $e echo hi'), [
      'bash/line ',
      '  bash/command e=',
      '    bash/assignment e=',
      '      bash/name e',
      '  bash/command $e echo hi',
      '    bash/expandedName $e',
      '      bash/expansion $e',
      '    bash/word echo',
      '    bash/word hi',
    ]);
    assert.strictEqual(bash('e=; $e echo hi'), 'hi\n');
  });

  it('reads the arguments of a declaration builtin that are assignments, and the elements of an array', () => {
    assert.deepStrictEqual(tree('local x=$(ls) y; export X=1; declare -a arr=(1 "$y" *.txt); a=(p q)'), [
      'bash/line ',
      '  bash/command local x=$(ls) y',
      '    bash/commandName local',
      '    bash/assignmentArgument x=$(ls)',
      '      bash/name x',
      '      bash/substitution $(ls)',
      '        child/script ls',
      '          child/command ls',
      '            child/commandName ls',
      '      command/assignment x=$(ls)',
      '    bash/argument y',
      '      command/variable y',
      '  bash/command export X=1',
      '    bash/commandName export',
      '    bash/assignmentArgument X=1',
      '      bash/name X',
      '      command/assignment X=1',
      '  bash/command declare -a arr=(1 "$y" *.txt)',
      '    bash/commandName declare',
      '    bash/argument -a',
      '      command/option -a',
      '    bash/assignmentArgument arr=(1 "$y" *.txt)',
      '      bash/name arr',
      '      bash/word 1',
      '      bash/word "$y"',
      '        bash/quote "$y"',
      '          bash/expansion $y',
      '      bash/word *.txt',
      '        bash/pattern *',
      '        bash/string .txt',
      '      command/assignment arr=(1 "$y" *.txt)',
      '  bash/command a=(p q)',
      '    bash/assignment a=(p q)',
      '      bash/name a',
      '      bash/word p',
      '      bash/word q',
    ]);
    // (3.4: such an argument is expanded as an assignment; it is not one made before the command, 3.7.1.)
    assert.deepStrictEqual(find(explain('local x=1').reading!, 'x=1').refs, ['3.4']);
  });

  it('keeps the parts of a word bash reads in its layer, and the substitutions in them out of what the command reads', () => {
    assert.deepStrictEqual(tree('echo "${y:-$(date +%F)}" a{1..3}b c$((1 + $n)) $x'), [
      'bash/line ',
      '  bash/command echo "${y:-$(date +%F)}" a{1..3}b c$((1 + $n)) $x',
      '    bash/commandName echo',
      '    bash/argument "${y:-$(date +%F)}"',
      '      bash/quote "${y:-$(date +%F)}"',
      '        bash/expansion ${y:-$(date +%F)}',
      '          bash/substitution $(date +%F)',
      '            child/script date +%F',
      '              child/command date +%F',
      '                child/commandName date',
      '                child/argument +%F',
      '                  command/argument +%F',
      '                    language/language date',
      '                      language/operator +',
      '                      language/variable %F',
      '      command/argument "${y:-$(date +%F)}"',
      '    bash/argument a{1..3}b',
      '      bash/brace {1..3}',
      '      command/argument a{1..3}b',
      '    bash/argument c$((1 + $n))',
      '      bash/arithmetic $((1 + $n))',
      '        bash/expansion $n',
      '      command/argument c$((1 + $n))',
      '    bash/argument $x',
      '      bash/expansion $x',
      '      command/argument $x',
    ]);
    // An operand that is a substitution: its commands are under its subshell, not under the command that takes it.
    assert.deepStrictEqual(tree('set -- $(getopt ab: "$@")'), [
      'bash/line ',
      '  bash/command set -- $(getopt ab: "$@")',
      '    bash/commandName set',
      '    bash/argument --',
      '      command/option --',
      '    bash/argument $(getopt ab: "$@")',
      '      bash/substitution $(getopt ab: "$@")',
      '        child/script getopt ab: "$@"',
      '          child/command getopt ab: "$@"',
      '            child/commandName getopt',
      '            child/argument ab:',
      '              command/argument ab:',
      '                language/language getoptshort',
      '                  language/option a',
      '                  language/option b:',
      '            child/argument "$@"',
      '              child/quote "$@"',
      '                child/expansion $@',
      '              command/argument "$@"',
    ]);
  });

  it('shows the parts bash reads in a word that have no node: a glob, an escape, a tilde, braces', () => {
    assert.deepStrictEqual(tree("ls *.txt $'\\t' $f ${a[0]:-def} ~ x=~/y {a,b}"), [
      'bash/line ',
      "  bash/command ls *.txt $'\\t' $f ${a[0]:-def} ~ x=~/y {a,b}",
      '    bash/commandName ls',
      '    bash/argument *.txt',
      '      bash/pattern *',
      '      bash/string .txt',
      '      command/argument *.txt',
      "    bash/argument $'\\t'",
      "      bash/quote $'\\t'",
      '        bash/operator \\t',
      "      command/argument $'\\t'",
      '    bash/argument $f',
      '      bash/expansion $f',
      '      command/argument $f',
      '    bash/argument ${a[0]:-def}',
      '      bash/expansion ${a[0]:-def}',
      '      command/argument ${a[0]:-def}',
      '    bash/argument ~',
      '      command/argument ~',
      '    bash/argument x=~/y',
      '      bash/expansion ~',
      '      command/argument x=~/y',
      '    bash/argument {a,b}',
      '      command/argument {a,b}',
    ]);
    // (In a subshell's script too.)
    assert.deepStrictEqual(outline(find(explain('x=$(ls *.txt)').reading!, '*.txt', 'child')), [
      'child/argument *.txt',
      '  child/pattern *',
      '  child/string .txt',
      '  command/argument *.txt',
    ]);
    // A word that is all one expansion has it as its text.
    const r = explain('ls ~ {a,b}').reading!;
    assert.match(find(r, '~', 'bash').text!, /^Tilde expansion/);
    assert.match(find(r, '{a,b}', 'bash').text!, /^Brace expansion/);
  });

  it('reads assignments: a name, and the parts of the value', () => {
    assert.deepStrictEqual(tree('a= b=x$y c="$(d)" e=plain'), [
      'bash/line ',
      '  bash/command a= b=x$y c="$(d)" e=plain',
      '    bash/assignment a=',
      '      bash/name a',
      '    bash/assignment b=x$y',
      '      bash/name b',
      '      bash/expansion $y',
      '    bash/assignment c="$(d)"',
      '      bash/name c',
      '      bash/quote "$(d)"',
      '        bash/substitution $(d)',
      '          child/script d',
      '            child/command d',
      '              child/commandName d',
      '    bash/assignment e=plain',
      '      bash/name e',
    ]);
  });

  it('reads `[[ ]]`: its operators, and a regex bash reads itself under its word', () => {
    const r = explain('[[ $x =~ ^a+$ ]]; echo ab | grep b').reading!;
    const re = find(r, '^a+$');
    assert.deepStrictEqual(outline(re), [
      'bash/word ^a+$',
      '  language/language regex',
      '    language/keyword ^',
      '    language/string a',
      '    language/operator +',
      '    language/keyword $',
    ]);
    // No command reads it: bash does (its regex matching).
    assert.deepStrictEqual(readingNodes(re).slice(1).map((n) => n.reader), ['bash', 'bash', 'bash', 'bash', 'bash']);
    assert.deepStrictEqual(r.children.map((c) => `${c.kind} ${c.label}`), ['compound [[ $x =~ ^a+$ ]]', 'pipeline echo ab | grep b']);
    assert.strictEqual(find(r, '[[').refs!.length > 0, true);
    assert.match(find(r, '=~').text!, /matches the regex/);
    assert.deepStrictEqual(tree('[[ -f $f && $a == b* ]]'), [
      'bash/line ',
      '  bash/compound [[ -f $f && $a == b* ]]',
      '    bash/keyword [[',
      '    bash/part -f $f && $a == b*',
      '      bash/part -f $f',
      '        bash/operator -f',
      '        bash/word $f',
      '          bash/expansion $f',
      '      bash/operator &&',
      '      bash/part $a == b*',
      '        bash/word $a',
      '          bash/expansion $a',
      '        bash/operator ==',
      '        bash/word b*',
      '          bash/string b',
      '          bash/pattern *',
      '    bash/keyword ]]',
    ]);
    const t = explain('[[ -f $f && $a == b* || ! a -eq 1 ]]').reading!;
    assert.strictEqual(find(t, '-f').text, 'is an existing regular file');
    assert.strictEqual(find(t, '-eq').text, 'numbers are equal');
    assert.strictEqual(find(t, '==').text, 'strings are equal (the right side is a glob pattern)');
    assert.strictEqual(find(t, '!').text, undefined);
    // (`&&` in `[[ ]]` is not a list's; nor in `(( ))`, where `==` is arithmetic and says nothing of strings.)
    assert.deepStrictEqual(find(t, '&&').refs, ['3.2.5.2', '6.4']);
    const a = explain('(( a == b && c ))').reading!;
    assert.deepStrictEqual(find(a, '&&').refs, ['3.2.5.2', '6.5']);
    assert.strictEqual(find(a, '==').text, undefined);
  });

  it('names pipelines with a reserved word, clauses and coprocesses as the manual does', () => {
    assert.deepStrictEqual(explain('! a | b; time ls; coproc cat').reading!.children.map((c) => `${c.kind} ${c.label}`), [
      'pipeline ! a | b', 'pipeline time ls', 'coprocess coproc cat',
    ]);
    const r = explain('if a; then b; elif c; then d; else e; fi; case x in y) z ;; esac').reading!;
    assert.deepStrictEqual(readingNodes(r).filter((n) => n.kind === 'clause').map((n) => n.label), [
      'elif ‹condition› then ‹commands›', 'else ‹commands›', 'y) ‹commands› ;;',
    ]);
    assert.deepStrictEqual(r.children.map((c) => c.kind), ['compound', 'compound']);
  });

  it('reads the line of a block: the block\'s parts on it, and a block on its first line whole', () => {
    const src = 'for f in a; do\n  if [[ $f == b ]]; then printf x; fi\n  case $f in a|b) echo ab ;; esac\ndone\n';
    assert.deepStrictEqual(tree(src, 3), ['bash/line ', '  bash/keyword done']);
    assert.deepStrictEqual(tree(src, 2), [
      'bash/line ',
      '  bash/compound case $f in ‹patterns› esac',
      '    bash/keyword case',
      '    bash/word $f',
      '      bash/expansion $f',
      '    bash/keyword in',
      '    bash/clause a|b) ‹commands› ;;',
      '      bash/word a',
      '      bash/operator |',
      '      bash/word b',
      '      bash/operator )',
      '      bash/command echo ab',
      '        bash/commandName echo',
      '        bash/argument ab',
      '          command/argument ab',
      '      bash/operator ;;',
      '    bash/keyword esac',
    ]);
    // On its first line, the loop is explained whole: the commands in it have no tokens of their own there.
    const whole = explain(src).reading!;
    const nested = find(whole, 'printf x');
    assert.deepStrictEqual(outline(nested), ['bash/command printf x', '  bash/commandName printf', '  bash/argument x']);
    assert.strictEqual(find(whole, 'if [[ $f == b ]]; then printf x; fi').text, undefined);
    assert.strictEqual(find(whole, 'printf').text, undefined);
    assert.deepStrictEqual(find(whole, 'f').kind, 'name');
  });

  it('shortens a long label, and has a comment and a background `&`', () => {
    const long = `echo ${'a'.repeat(70)} & # done`;
    const r = explain(long).reading!;
    assert.deepStrictEqual(outline(r).map((l) => l.slice(0, 40)), [
      'bash/line ',
      `  bash/command echo ${'a'.repeat(20)}`,
      '    bash/commandName echo',
      `    bash/argument ${'a'.repeat(22)}`,
      `      command/argument ${'a'.repeat(17)}`,
      '  bash/operator &',
      '  bash/comment # done',
    ]);
    assert.strictEqual(r.children[0].label.length, 60);
    assert.ok(r.children[0].label.endsWith('…'));
  });

  it('is not made unless asked for, nor for a line with nothing to explain', () => {
    assert.strictEqual(analyzer.explainLine(parser.parse('echo a'), 0, 'bash').reading, undefined);
    assert.strictEqual(explain('echo a\n\n', 1).reading, undefined);
    assert.strictEqual(readingTree(parser.parse(''), [], { lang: 'en', resolve: () => 'file' }), undefined);
  });
});

describe('the origins of the tokens', () => {
  const all = (ts: readonly Token[]): Token[] => ts.flatMap((t) => [t, ...all(t.children)]);
  const origins = (src: string) => all(explain(src).items).map((t) => `${t.origin} ${t.kind} ${t.label}${t.language ? ` [${t.language}]` : ''}`);

  it('says who reads each token: bash, the command, a language, or a shell a string is given to', () => {
    assert.deepStrictEqual(origins("grep -E 'a|b' \"$f\" | sh -c 'ls'"), [
      'shell operator grep | sh',
      'shell command grep',
      'argv option -E',
      "argv argument 'a|b'",
      "shell string 'a|b'",
      'embedded string a [regex]',
      'embedded operator | [regex]',
      'embedded string b [regex]',
      'argv argument "$f"',
      'shell string "$f"',
      'shell variable $f',
      'shell operator |',
      'shell command sh',
      'argv option -c',
      "argv argument 'ls'",
      "shell string 'ls'",
      'script command ls',
    ]);
  });

  it('gives the globs and escapes bash reads to bash', () => {
    assert.deepStrictEqual(origins("ls *.txt $'\\t'").filter((t) => !t.startsWith('argv')), [
      'shell command ls',
      'shell pattern *',
      'shell string .txt',
      "shell string $'\\t'",
      'shell operator \\t',
    ]);
  });

  it('gives the tilde and brace expansions of an operand to bash, which does them before the command sees it', () => {
    assert.deepStrictEqual(origins('ls ~ ~/x x=~/y {a,b} {1..3}'), [
      'shell command ls',
      'argv argument ~',
      'shell expansion ~',
      'argv argument ~/x',
      'shell expansion ~/x',
      'argv argument x=~/y',
      'shell expansion ~',
      'argv argument {a,b}',
      'shell expansion {a,b}',
      'argv argument {1..3}',
      'shell expansion {1..3}',
    ]);
  });
});

describe('the reading tree in the panel and in host files', () => {
  it('is sent to the panel with the sections its nodes cite', () => {
    const ex = explain('x=1');
    const msg = panelUpdate({ lang: 'en', explanation: ex, file: 'a.sh', line: 0, lineText: 'x=1', choice: {}, placement: 'first' });
    assert.strictEqual(msg.explanation.reading, ex.reading);
    assert.ok(msg.manual['3.4']);
    assert.ok(!panelUpdate({ lang: 'en', explanation: analyzer.explainLine(parser.parse('x=1'), 0, 'bash'), file: 'a.sh', line: 0, lineText: 'x=1', choice: {}, placement: 'first' }).manual['3.2.2']);
  });

  /** The reading tree of a line of a host file: `layer/kind label [its text in the file] :: text`. */
  const hosted = (kind: HostKind, src: string, line: number): string[] => {
    const extracted = extractShell(kind, src)!;
    const ex = explainHostedLine(analyzer, parser.parse(extracted.text), extracted, src.split('\n'), line, 'en', undefined, { reading: true })!;
    const row = src.split('\n')[line];
    const out = (n: ReadingNode, d: number): string[] => [
      `${'  '.repeat(d)}${n.layer}/${n.kind} ${n.label} [${row.slice(n.span.start.character, n.span.end.character)}]${n.text ? ` :: ${n.text}` : ''}`,
      ...n.children.flatMap((c) => out(c, d + 1)),
    ];
    return out(ex.reading!, 0);
  };

  it('is placed in the host file, as the tokens are', () => {
    const src = 'FROM alpine\nRUN apk add curl && echo "$HOME"\n';
    const extracted = extractShell('dockerfile', src)!;
    const ex = explainHostedLine(analyzer, parser.parse(extracted.text), extracted, src.split('\n'), 1, 'en', undefined, { reading: true })!;
    const echo = find(ex.reading!, 'echo "$HOME"');
    assert.strictEqual(src.split('\n')[1].slice(echo.span.start.character, echo.span.end.character), 'echo "$HOME"');
    assert.strictEqual(explainHostedLine(analyzer, parser.parse(extracted.text), extracted, src.split('\n'), 1, 'en')!.reading, undefined);
  });

  it('shows the host file\'s text, and says what a placeholder stands for (a Makefile)', () => {
    const lines = hosted('makefile', 'all:\n\t$(CC) -o $@ $< && echo $$HOME\n', 1);
    assert.deepStrictEqual(lines.map((l) => l.replace(/ :: .*/, '')), [
      'bash/line  [$(CC) -o $@ $< && echo $$HOME]',
      '  bash/list $(CC) -o $@ $< && echo $$HOME [$(CC) -o $@ $< && echo $$HOME]',
      '    bash/command $(CC) -o $@ $< [$(CC) -o $@ $<]',
      '      bash/expandedName $(CC) [$(CC)]',
      '      bash/word -o [-o]',
      '      bash/word $@ [$@]',
      '      bash/word $< [$<]',
      '    bash/operator && [&&]',
      '    bash/command echo $$HOME [echo $$HOME]',
      '      bash/commandName echo [echo]',
      '      bash/argument $$HOME [$$HOME]',
      '        bash/expansion $$HOME [$$HOME]',
      '        command/argument $$HOME [$$HOME]',
    ]);
    assert.match(lines[3], / :: The make variable `CC`, expanded by make before the shell runs/);
    assert.match(lines[5], / :: Make's automatic variable \(the target name\)/);
    assert.ok(!lines.some((l) => /make_target|\$\{CC\}/.test(l)), lines.join('\n'));
    // A long label is the file's text, shortened.
    const long = hosted('makefile', `all:\n\t$(CC) -o $@ ${'x'.repeat(70)}\n`, 1);
    assert.match(long[1], /^ {2}bash\/command \$\(CC\) -o \$@ x+… \[/);
  });

  it('shows the host file\'s text, and says what a placeholder stands for (GitHub Actions)', () => {
    const src = 'on: push\njobs:\n  a:\n    runs-on: x\n    steps:\n      - run: echo "${{ github.ref }}" | grep main\n';
    const lines = hosted('yaml', src, 5);
    assert.deepStrictEqual(lines.slice(2, 7).map((l) => l.replace(/ :: .*/, '')), [
      '    bash/command echo "${{ github.ref }}" [echo "${{ github.ref }}"]',
      '      bash/commandName echo [echo]',
      '      bash/argument "${{ github.ref }}" ["${{ github.ref }}"]',
      '        bash/quote "${{ github.ref }}" ["${{ github.ref }}"]',
      '          bash/expansion ${{ github.ref }} [${{ github.ref }}]',
    ]);
    assert.match(lines[6], /GitHub Actions/);
    assert.ok(!lines.some((l) => /GITHUB_REF/.test(l)), lines.join('\n'));
  });
});
