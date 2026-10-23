import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { BUILTINS, documentHighlight, highlight, HighlightKind, hostedHighlight, lineSpans } from '../src/highlight';
import { extractShell } from '../src/hosts';
import { createUnbashParser } from '../src/syntax/adapters/unbash';

const parser = createUnbashParser();

/** `kind:text` for each span. */
function spans(text: string, range?: { from: number; to: number }): string[] {
  return highlight(parser.parse(text), { range }).map((s) => `${s.kind}:${text.slice(s.from, s.to)}`);
}

/** The kinds of the spans whose text is exactly `part`. */
function kindsOf(text: string, part: string): HighlightKind[] {
  return highlight(parser.parse(text)).filter((s) => text.slice(s.from, s.to) === part).map((s) => s.kind);
}

describe('highlight', () => {
  // Next spans of the same kind come out as one (`2>&1`, `()`).
  it('colours a simple command: names, options, strings, variables, operators, redirections', () => {
    assert.deepEqual(spans('ls -la --color=auto "$HOME" \'x\' $\'a\\n\' $"msg" | grep -v x >out 2>&1 && echo ${#a} $? || cd -; wait &'), [
      'command:ls', 'option:-la', 'option:--color', 'string:"', 'variable:$HOME', 'string:"', "string:'x'", "string:$'a\\n'", 'string:$"msg"',
      'operator:|', 'command:grep', 'option:-v', 'redirect:>', 'redirect:2>&1', 'operator:&&', 'builtin:echo', 'variable:${#a}',
      'variable:$?', 'operator:||', 'builtin:cd', 'operator:;', 'builtin:wait', 'operator:&',
    ]);
  });

  it('colours keywords of every compound command', () => {
    const text = 'if a; then b; elif c; then d; else e; fi\nwhile x; do :; done; until x; do :; done\nfor i in 1 2; do :; done\n'
      + 'case $1 in a|b) x;; (c) y;& *) z;;& esac\nselect s in a b; do break; done\ntime ls; ! true; coproc cat\n{ a; }; (b)';
    const got = spans(text).filter((s) => s.startsWith('keyword:') || s.startsWith('operator:'));
    assert.deepEqual(got, [
      'keyword:if', 'operator:;', 'keyword:then', 'operator:;', 'keyword:elif', 'operator:;', 'keyword:then', 'operator:;', 'keyword:else', 'operator:;', 'keyword:fi',
      'keyword:while', 'operator:;', 'keyword:do', 'operator:;', 'keyword:done', 'operator:;', 'keyword:until', 'operator:;', 'keyword:do', 'operator:;', 'keyword:done',
      'keyword:for', 'keyword:in', 'operator:;', 'keyword:do', 'operator:;', 'keyword:done',
      'keyword:case', 'keyword:in', 'operator:|', 'operator:)', 'operator:;;', 'operator:(', 'operator:)', 'operator:;&', 'operator:)', 'operator:;;&', 'keyword:esac',
      'keyword:select', 'keyword:in', 'operator:;', 'keyword:do', 'operator:;', 'keyword:done',
      'keyword:time', 'operator:;', 'keyword:!', 'operator:;', 'keyword:coproc',
      'keyword:{', 'operator:;', 'keyword:}', 'operator:;', 'operator:(', 'operator:)',
    ]);
    assert.deepEqual(kindsOf(text, 's'), ['assignment']);
    assert.deepEqual(kindsOf(text, 'i'), ['assignment']);
  });

  it('tells builtins, commands and the functions the script defines apart', () => {
    assert.deepEqual(spans('f() { local a=1 b; }\nfunction g { :; }\nf; g; cd; ls; $cmd x; "ls" y'), [
      'functionName:f', 'operator:()', 'keyword:{', 'builtin:local', 'assignment:a', 'assignment:b', 'operator:;', 'keyword:}',
      'keyword:function', 'functionName:g', 'keyword:{', 'builtin::', 'operator:;', 'keyword:}',
      'function:f', 'operator:;', 'function:g', 'operator:;', 'builtin:cd', 'operator:;', 'command:ls', 'operator:;', 'variable:$cmd', 'operator:;', 'string:"ls"',
    ]);
    // A function named like a builtin is called instead of it.
    assert.deepEqual(kindsOf('cd() { :; }; cd /', 'cd'), ['functionName', 'function']);
  });

  it('colours declarations, assignments and unset', () => {
    assert.deepEqual(spans('declare -A m; export X=1; unset y; a[1]=2; b+=x; c=(1 2)'), [
      'builtin:declare', 'option:-A', 'assignment:m', 'operator:;', 'builtin:export', 'assignment:X', 'operator:;', 'builtin:unset', 'assignment:y', 'operator:;',
      'assignment:a', 'number:1', 'operator:;', 'assignment:b', 'operator:;', 'assignment:c', 'operator:(', 'operator:)',
    ]);
  });

  it('colours the options of unset as its spec reads them: up to the first name (checked with bash)', () => {
    // bash reads `-v` after a name as a name: `unset x -v y` unsets `x`, `-v` (no such variable) and `y`.
    assert.strictEqual(execFileSync('bash', ['-c', 'x=1 y=2; unset x -v y; echo "$?${x-u}${y-u}"']).toString(), '0uu\n');
    assert.deepEqual(spans('unset -v x -v y'), ['builtin:unset', 'option:-v', 'assignment:x', 'assignment:y']);
  });

  it('colours tests', () => {
    assert.deepEqual(spans('[[ -n $x && $y =~ ^a+$ ]]; [ -f x ] && test -d y'), [
      'keyword:[[', 'option:-n', 'variable:$x', 'operator:&&', 'variable:$y', 'operator:=~', 'keyword:]]', 'operator:;',
      'builtin:[', 'option:-f', 'builtin:]', 'operator:&&', 'builtin:test', 'option:-d',
    ]);
  });

  it('colours arithmetic: names are variables, numbers are numbers, the brackets are keywords or delimiters', () => {
    assert.deepEqual(spans('(( a += 0x1f )); echo $(( b > 1 ? c : 2 )) ${a[i+1]}; for ((i=0; i<3; i++)); do n=5; done'), [
      'keyword:((', 'variable:a', 'operator:+=', 'number:0x1f', 'keyword:))', 'operator:;', 'builtin:echo',
      'substitution:$((', 'variable:b', 'operator:>', 'number:1', 'operator:?', 'variable:c', 'operator::', 'number:2', 'substitution:))', 'variable:${a[i+1]}', 'operator:;',
      'keyword:for', 'keyword:((', 'variable:i', 'number:0', 'operator:;', 'variable:i', 'operator:<', 'number:3', 'operator:;', 'variable:i', 'operator:++', 'keyword:))',
      'operator:;', 'keyword:do', 'assignment:n', 'operator:;', 'keyword:done',
    ]);
    // Code in a substitution inside arithmetic is code again; a number outside arithmetic is a word.
    assert.deepEqual(spans('echo $(( $(wc -l) + "1" )) 5'), [
      'builtin:echo', 'substitution:$((', 'substitution:$(', 'command:wc', 'option:-l', 'substitution:)', 'operator:+', 'string:"1"', 'substitution:))',
    ]);
  });

  it('colours nested substitutions as code inside strings', () => {
    assert.deepEqual(spans('echo "a $(ls "$(pwd)") b" <(x) >(y) `date`'), [
      'builtin:echo', 'string:"a ', 'substitution:$(', 'command:ls', 'string:"', 'substitution:$(', 'builtin:pwd', 'substitution:)', 'string:"',
      'substitution:)', 'string: b"', 'substitution:<(', 'command:x', 'substitution:)', 'substitution:>(', 'command:y', 'substitution:)',
      'substitution:`', 'command:date', 'substitution:`',
    ]);
  });

  it('colours a parameter expansion whole, with what nests in it', () => {
    assert.deepEqual(spans('echo ${x//a/b} ${y:-"d $z"} ${#a[@]}'), [
      'builtin:echo', 'variable:${x//a/b}', 'variable:${y:-', 'string:"d ', 'variable:$z', 'string:"', 'variable:}', 'variable:${#a[@]}',
    ]);
  });

  it('colours globs where the shell expands them, and options until --', () => {
    assert.deepEqual(spans('ls *.txt [ab]?.c x\\*y @(a|b) !(c) a[ -- -x; x=*.c; [[ $a == a* || $b = *.sh ]]; case $1 in +(x)) ;; esac'), [
      'command:ls', 'glob:*', 'glob:[ab]?', 'glob:@(', 'glob:|', 'glob:)', 'glob:!(', 'glob:)', 'option:--', 'operator:;', 'assignment:x', 'operator:;',
      'keyword:[[', 'variable:$a', 'operator:==', 'glob:*', 'operator:||', 'variable:$b', 'operator:=', 'glob:*', 'keyword:]]', 'operator:;',
      'keyword:case', 'variable:$1', 'keyword:in', 'glob:+(', 'glob:)', 'operator:)', 'operator:;;', 'keyword:esac',
    ]);
    // A pattern in [[ ]] only on the right of = == !=, and inside ! ( … ).
    assert.deepEqual(kindsOf('[[ ! ( $x != a?b ) ]]', '?'), ['glob']);
    assert.deepEqual(kindsOf('[[ a* < b* ]]', '*'), []);
    assert.deepEqual(spans('ls >*.log; for f in *; do :; done; [ * ]'), [
      'command:ls', 'redirect:>', 'glob:*', 'operator:;', 'keyword:for', 'assignment:f', 'keyword:in', 'glob:*', 'operator:;', 'keyword:do', 'builtin::', 'operator:;', 'keyword:done',
      'operator:;', 'builtin:[', 'glob:*', 'builtin:]',
    ]);
  });

  it('tells comments from # inside words', () => {
    assert.deepEqual(spans('#!/bin/bash\necho a#b ${x#y} # c'), ['comment:#!/bin/bash', 'builtin:echo', 'variable:${x#y}', 'comment:# c']);
  });

  it('colours heredocs: a quoted delimiter keeps the body plain, an unquoted one expands in it', () => {
    const text = "cat <<-'EOF' <<X\n\tbody $x\n\tEOF\nhi $y $(ls)\nX\nshopt -s extglob\ncat <<< \"$z\"";
    assert.deepEqual(spans(text), [
      'command:cat', 'redirect:<<-', "heredocDelimiter:'EOF'", 'redirect:<<', 'heredocDelimiter:X', 'heredoc:body $x\n\t', 'heredocDelimiter:EOF',
      'heredoc:hi ', 'variable:$y', 'heredoc: ', 'substitution:$(', 'command:ls', 'substitution:)', 'heredoc:\n', 'heredocDelimiter:X',
      'builtin:shopt', 'option:-s', 'command:cat', 'redirect:<<<', 'string:"', 'variable:$z', 'string:"',
    ]);
  });

  it('colours the end of the sample as code again after its heredoc', () => {
    const text = fs.readFileSync(path.join(__dirname, 'fixtures/sample.sh'), 'utf8');
    const lines = text.split('\n');
    const at = lines.findIndex((l) => l.startsWith('shopt -s extglob'));
    const from = lines.slice(0, at).join('\n').length + 1;
    const after = highlight(parser.parse(text)).filter((s) => s.from >= from);
    assert.ok(after.length > 10);
    assert.deepEqual(after.filter((s) => s.kind === 'heredoc' || s.kind === 'string').map((s) => text.slice(s.from, s.to)), ['"', '"', '"', '"']);
    assert.deepEqual(after.slice(0, 2).map((s) => `${s.kind}:${text.slice(s.from, s.to)}`), ['builtin:shopt', 'option:-s']);
  });

  it('marks what the parser could not read, and never throws on a broken script', () => {
    assert.deepEqual(spans('echo )\nfi\nls'), ['builtin:echo', 'error:)', 'error:fi', 'command:ls']);
    // An unclosed string runs to the end, as bash would read it.
    assert.deepEqual(spans('x=\'abc\necho "y'), ['assignment:x', 'string:\'abc\necho "y']);
    for (const text of ['if x; then', 'echo $(ls', 'echo ${x', 'case x in\n a) echo;;', 'cat <<EOF\nabc', '((', '[[ a ==', 'f() {', '"', "$'", '${x:-$(', '<<<']) {
      assert.doesNotThrow(() => highlight(parser.parse(text)), text);
    }
  });

  it('gives sorted spans that do not overlap, and only those in a range when asked', () => {
    const text = fs.readFileSync(path.join(__dirname, 'fixtures/sample.sh'), 'utf8');
    const all = highlight(parser.parse(text));
    for (let i = 1; i < all.length; i++) assert.ok(all[i - 1].to <= all[i].from && all[i].from < all[i].to);
    const range = { from: 1000, to: 1400 };
    const some = highlight(parser.parse(text), { range });
    assert.deepEqual(some, all.filter((s) => s.to > range.from && s.from < range.to).map((s) => ({ ...s, from: Math.max(s.from, range.from), to: Math.min(s.to, range.to) })));
    assert.deepEqual(spans('echo a; ls -l', { from: 8, to: 100 }), ['command:ls', 'option:-l']);
  });

  it('keeps the positions of multi-byte text, and leaves out the CR of Windows line ends', () => {
    assert.deepEqual(spans('echo "日本語 $x" 🎉 $y # ✓'), ['builtin:echo', 'string:"日本語 ', 'variable:$x', 'string:"', 'variable:$y', 'comment:# ✓']);
    const text = 'echo "a\r\nb" # c\r\nls\r\n';
    const tree = parser.parse(text);
    assert.deepEqual(highlight(tree).map((s) => `${s.kind}:${JSON.stringify(text.slice(s.from, s.to))}`), [
      'builtin:"echo"', 'string:"\\"a"', 'string:"\\nb\\""', 'comment:"# c"', 'command:"ls"',
    ]);
  });

  it('knows every builtin bash lists', function () {
    let names: string[];
    try {
      names = execFileSync('bash', ['-c', 'compgen -b'], { encoding: 'utf8' }).split('\n').filter(Boolean);
    } catch {
      return this.skip();
    }
    assert.deepEqual(names.filter((n) => !BUILTINS.has(n)), []);
  });
});

describe('hostedHighlight', () => {
  const hosted = (kind: Parameters<typeof extractShell>[0], text: string) => {
    const ex = extractShell(kind, text);
    const lines = text.split('\n');
    return hostedHighlight(highlight(parser.parse(ex.text)), ex).map((s) => `${s.line}:${s.kind}:${lines[s.line].slice(s.from, s.to)}`);
  };

  it('moves the spans of a Dockerfile back to its lines and columns', () => {
    assert.deepEqual(hosted('dockerfile', 'FROM x\nRUN echo $X \\\n && ls -l\nENTRYPOINT ["sh", "-c", "exec app ${P:-1}"]'), [
      '1:builtin:echo', '1:variable:$X', '2:operator:&&', '2:command:ls', '2:option:-l', '3:builtin:exec', '3:variable:${P:-1}',
    ]);
  });

  it('splits a span over several lines, and keeps host syntax whole', () => {
    assert.deepEqual(hosted('makefile', 'build: $(SRC)\n\t$(CC) -o out $^\n\techo "a\n\tb"'), [
      '1:variable:$(CC)', '1:option:-o', '1:variable:$^', '2:builtin:echo', '2:string:"a', '3:string:b"',
    ]);
  });

  it('gives the spans of a whole document in its own lines', () => {
    const text = 'echo "a\r\nb" # c\r\nls';
    const lines = text.split(/\r?\n/);
    const show = (spans: ReturnType<typeof lineSpans>, src: string[]) => spans.map((s) => `${s.line}:${s.kind}:${src[s.line].slice(s.from, s.to)}`);
    assert.deepEqual(show(documentHighlight({ lines, tree: parser.parse(text) }), lines), ['0:builtin:echo', '0:string:"a', '1:string:b"', '1:comment:# c', '2:command:ls']);
    const make = 'all:\n\techo $(X)';
    const extracted = extractShell('makefile', make);
    assert.deepEqual(show(documentHighlight({ lines: make.split('\n'), extracted, tree: parser.parse(extracted.text) }), make.split('\n')), ['1:builtin:echo', '1:variable:$(X)']);
  });
});

