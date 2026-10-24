// The reading tree of a line (src/reading.ts), which the panel's tree view draws: who reads each part, in layers.
// The layers come from the tree and from `Token.origin`, which the analyzer sets where it makes each token.
import * as assert from 'assert';
import { Analyzer, Token } from '../src/analyzer';
import { explainHostedLine, extractShell } from '../src/hosts';
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

/** The first node of a tree with this label (and layer). */
function find(n: ReadingNode, label: string, layer?: string): ReadingNode {
  return readingNodes(n).find((x) => x.label === label && (!layer || x.layer === layer))!;
}

describe('the reading tree of a line', () => {
  it('reads an assignment of `$( )`, then a test: bash, the child bash in `$( )`, grep\'s words, its regex, and `[`\'s', () => {
    assert.deepStrictEqual(tree('x=$(grep -c foo f) && [ "$x" -gt 0 ]'), [
      'bash/line ',
      '  bash/list x=$(grep -c foo f) && [ "$x" -gt 0 ]',
      '    bash/command x=$(grep -c foo f)',
      '      bash/assignment x=$(grep -c foo f)',
      '        bash/name x',
      '        bash/substitution $(grep -c foo f)',
      '          child/script grep -c foo f',
      '            child/command grep -c foo f',
      '              child/word grep',
      '              child/word -c',
      '              child/word foo',
      '              child/word f',
      '              command/reading grep',
      '                command/option -c',
      '                command/argument foo',
      '                  language/language regex',
      '                    language/string foo',
      '                command/argument f',
      '    bash/operator &&',
      '    bash/command [ "$x" -gt 0 ]',
      '      bash/word [',
      '      bash/word "$x"',
      '        bash/expansion $x',
      '      bash/word -gt',
      '      bash/word 0',
      '      bash/word ]',
      '      command/reading [',
      '        command/test "$x" -gt 0',
      '        command/argument ]',
    ]);
    const r = explain('x=$(grep -c foo f) && [ "$x" -gt 0 ]').reading!;
    // The explanations are the tokens' about the same text: bash's own for bash's nodes, the command's for its reading.
    assert.match(find(r, '$(grep -c foo f)').text!, /^Command substitution/);
    assert.deepStrictEqual(find(r, '$(grep -c foo f)').refs, ['3.5.4']);
    assert.match(find(r, 'grep', 'command').text!, /matching a pattern/);
    assert.strictEqual(find(r, 'foo', 'command').text, 'search pattern (regex) — basic regex (BRE)');
    assert.strictEqual(find(r, 'foo', 'child').text, undefined);
    // The child bash parses the text between `$(` and `)`.
    assert.deepStrictEqual(find(r, 'grep -c foo f', 'child').span, { start: { line: 0, character: 4 }, end: { line: 0, character: 17 } });
    assert.deepStrictEqual(r.span, { start: { line: 0, character: 0 }, end: { line: 0, character: 36 } });
  });

  it('reads a pipeline into xargs: find\'s expression and its glob, the command xargs runs and its regex', () => {
    assert.deepStrictEqual(tree("find . -name '*.sh' | xargs grep -n 'set -e'"), [
      'bash/line ',
      "  bash/pipeline find . -name '*.sh' | xargs grep -n 'set -e'",
      "    bash/command find . -name '*.sh'",
      '      bash/word find',
      '      bash/word .',
      '      bash/word -name',
      "      bash/word '*.sh'",
      '      command/reading find',
      '        command/argument .',
      '        command/test -name *.sh',
      '          command/option -name',
      "          command/argument '*.sh'",
      '            language/language glob',
      '              language/pattern *',
      '              language/string .sh',
      '    bash/operator |',
      "    bash/command xargs grep -n 'set -e'",
      '      bash/word xargs',
      '      bash/word grep',
      '      bash/word -n',
      "      bash/word 'set -e'",
      '      command/reading xargs',
      '        command/command grep',
      '          command/option -n',
      "          command/argument 'set -e'",
      '            language/language regex',
      '              language/string set -e',
    ]);
  });

  it('reads a here-document as a redirection with its body, on each line of it', () => {
    const src = 'cat <<EOF > out.txt\nhello $USER\nEOF\n';
    const expected = [
      'bash/line ',
      '  bash/command cat <<EOF > out.txt',
      '    bash/word cat',
      '    bash/redirect <<EOF',
      '      bash/heredoc hello $USER',
      '        bash/expansion $USER',
      '    bash/redirect > out.txt',
      '    command/reading cat',
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
      '          bash/word echo',
      '          bash/word "$1"',
      '            bash/expansion $1',
      '          command/reading echo',
      '            command/argument "$1"',
      '        bash/operator |',
      "        bash/command sed 's/a/b/'",
      '          bash/word sed',
      "          bash/word 's/a/b/'",
      '          command/reading sed',
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
      '      bash/word sort',
      '      bash/redirect < in.txt',
      '      bash/redirect 2>/dev/null',
      '      command/reading sort',
      '    bash/operator |',
      '    bash/command uniq -c > out.txt',
      '      bash/word uniq',
      '      bash/word -c',
      '      bash/redirect > out.txt',
      '      command/reading uniq',
      '        command/option -c',
    ]);
    // The command around its redirections is explained by the token of the redirections.
    assert.match(find(r, 'sort < in.txt 2>/dev/null').text!, /^Redirection applied to `sort`/);
    assert.deepStrictEqual(find(r, '2>/dev/null').refs, ['3.6.2']);
  });

  it('reads a process substitution and backquotes as substitutions a child bash parses', () => {
    assert.deepStrictEqual(tree('diff <(ls a) `ls b`'), [
      'bash/line ',
      '  bash/command diff <(ls a) `ls b`',
      '    bash/word diff',
      '    bash/word <(ls a)',
      '      bash/substitution <(ls a)',
      '        child/script ls a',
      '          child/command ls a',
      '            child/word ls',
      '            child/word a',
      '            command/reading ls',
      '              command/argument a',
      '    bash/word `ls b`',
      '      bash/substitution `ls b`',
      '        child/script ls b',
      '          child/command ls b',
      '            child/word ls',
      '            child/word b',
      '            command/reading ls',
      '              command/argument b',
      '    command/reading diff',
      '      command/argument <(ls a)',
      '      command/argument `ls b`',
    ]);
  });

  it('reads a string a command gives a shell as a script: its commands, and what they read', () => {
    assert.deepStrictEqual(tree("bash -c 'echo a | wc -l'"), [
      'bash/line ',
      "  bash/command bash -c 'echo a | wc -l'",
      '    bash/word bash',
      '    bash/word -c',
      "    bash/word 'echo a | wc -l'",
      '    command/reading bash',
      '      command/option -c',
      "      command/argument 'echo a | wc -l'",
      '        child/operator echo | wc',
      '          child/builtin echo',
      '            command/argument a',
      '          child/operator |',
      '          child/command wc',
      '            command/option -l',
    ]);
  });

  it('keeps the parts of a word bash reads in its layer, and the substitutions in them out of what the command reads', () => {
    assert.deepStrictEqual(tree('echo "${y:-$(date +%F)}" a{1..3}b c$((1 + $n)) $x'), [
      'bash/line ',
      '  bash/command echo "${y:-$(date +%F)}" a{1..3}b c$((1 + $n)) $x',
      '    bash/word echo',
      '    bash/word "${y:-$(date +%F)}"',
      '      bash/expansion ${y:-$(date +%F)}',
      '        bash/substitution $(date +%F)',
      '          child/script date +%F',
      '            child/command date +%F',
      '              child/word date',
      '              child/word +%F',
      '              command/reading date',
      '                command/argument +%F',
      '                  language/language date',
      '                    language/operator +',
      '                    language/variable %F',
      '    bash/word a{1..3}b',
      '      bash/brace {1..3}',
      '    bash/word c$((1 + $n))',
      '      bash/arithmetic $((1 + $n))',
      '        bash/expansion $n',
      '    bash/word $x',
      '    command/reading echo',
      '      command/argument "${y:-$(date +%F)}"',
      '      command/argument a{1..3}b',
      '      command/argument c$((1 + $n))',
      '      command/argument $x',
    ]);
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
      '              child/word d',
      '              command/reading d',
      '    bash/assignment e=plain',
      '      bash/name e',
    ]);
  });

  it('reads `[[ =~ ]]`: a regex bash reads itself is under its word', () => {
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
    assert.deepStrictEqual(r.children.map((c) => `${c.kind} ${c.label}`), ['compound [[ $x =~ ^a+$ ]]', 'pipeline echo ab | grep b']);
    assert.strictEqual(find(r, '[[').refs!.length > 0, true);
  });

  it('reads the line of a block: the block\'s parts on it, and a block on its first line whole', () => {
    const src = 'for f in a; do\n  if [[ $f == b ]]; then printf x; fi\n  case $f in a|b) echo ab ;; esac\ndone\n';
    assert.deepStrictEqual(tree(src, 3), ['bash/line ', '  bash/keyword done']);
    assert.deepStrictEqual(tree(src, 2), [
      'bash/line ',
      '  bash/compound case $f in ‹patterns› esac',
      '    bash/keyword case',
      '    bash/word $f',
      '    bash/keyword in',
      '    bash/compound a|b) ‹commands› ;;',
      '      bash/word a',
      '      bash/operator |',
      '      bash/word b',
      '      bash/operator )',
      '      bash/command echo ab',
      '        bash/word echo',
      '        bash/word ab',
      '        command/reading echo',
      '          command/argument ab',
      '      bash/operator ;;',
      '    bash/keyword esac',
    ]);
    // On its first line, the loop is explained whole: the commands in it have no tokens of their own there.
    const whole = explain(src).reading!;
    const nested = find(whole, 'printf x');
    assert.deepStrictEqual(outline(nested), ['bash/command printf x', '  bash/word printf', '  bash/word x']);
    assert.strictEqual(find(whole, 'if [[ $f == b ]]; then printf x; fi').text, undefined);
    assert.strictEqual(find(whole, 'b').text, undefined);
    assert.deepStrictEqual(find(whole, 'f').kind, 'name');
  });

  it('shortens a long label, and has a comment and a background `&`', () => {
    const long = `echo ${'a'.repeat(70)} & # done`;
    const r = explain(long).reading!;
    assert.deepStrictEqual(outline(r).map((l) => l.slice(0, 40)), [
      'bash/line ',
      `  bash/command echo ${'a'.repeat(20)}`,
      '    bash/word echo',
      `    bash/word ${'a'.repeat(26)}`,
      '    command/reading echo',
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
    assert.strictEqual(readingTree(parser.parse(''), []), undefined);
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
});

describe('the reading tree in the panel and in host files', () => {
  it('is sent to the panel with the sections its nodes cite', () => {
    const ex = explain('x=1');
    const msg = panelUpdate({ lang: 'en', explanation: ex, file: 'a.sh', line: 0, lineText: 'x=1', choice: {}, placement: 'first' });
    assert.strictEqual(msg.explanation.reading, ex.reading);
    assert.ok(msg.manual['3.4']);
    assert.ok(!panelUpdate({ lang: 'en', explanation: analyzer.explainLine(parser.parse('x=1'), 0, 'bash'), file: 'a.sh', line: 0, lineText: 'x=1', choice: {}, placement: 'first' }).manual['3.2.2']);
  });

  it('is placed in the host file, as the tokens are', () => {
    const src = 'FROM alpine\nRUN apk add curl && echo "$HOME"\n';
    const extracted = extractShell('dockerfile', src)!;
    const ex = explainHostedLine(analyzer, parser.parse(extracted.text), extracted, src.split('\n'), 1, 'en', undefined, { reading: true })!;
    const echo = find(ex.reading!, 'echo "$HOME"');
    assert.strictEqual(src.split('\n')[1].slice(echo.span.start.character, echo.span.end.character), 'echo "$HOME"');
    assert.strictEqual(explainHostedLine(analyzer, parser.parse(extracted.text), extracted, src.split('\n'), 1, 'en')!.reading, undefined);
  });
});
