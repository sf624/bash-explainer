import * as assert from 'assert';
import { spawnSync } from 'child_process';
import * as path from 'path';
import { run } from './support/run';
import { descendants, hasError } from '../src/syntax/tree';
import type { BashParser as Parser } from '../src/syntax/tree';
import { Analyzer, LineExplanation, Token } from '../src/analyzer';
import { rerun } from '../src/examples/rerun';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { detectShell, type Shell } from '../src/dialect';
import { allTokens, explain } from './support/explain';

const root = path.join(__dirname, '..');
let parser: Parser;

before(async () => {
  parser = createUnbashParser();
});

function find(e: LineExplanation, label: string, kind?: Token['kind']): Token {
  const t = allTokens(e.items).find((x) => x.label === label && (!kind || x.kind === kind));
  assert.ok(t, `no token "${label}" in: ${allTokens(e.items).map((x) => x.label).join(', ')}`);
  return t;
}

/** The source text a token's span covers (its range, which stays the whole command when its label is the name). */
function spanText(src: string, t: Token): string {
  const lines = src.split('\n');
  const { start, end } = t.span;
  if (start.line === end.line) return lines[start.line].slice(start.character, end.character);
  return [lines[start.line].slice(start.character), ...lines.slice(start.line + 1, end.line), lines[end.line].slice(0, end.character)].join('\n');
}

describe('commands and options', () => {
  it('splits combined short options and consumes option values', () => {
    const e = explain('set -euo pipefail');
    assert.match(find(e, '-euo').explanation, /Combined short options/);
    assert.match(find(e, '-e').explanation, /exit immediately/);
    assert.match(find(e, 'pipefail').explanation, /pipeline fails/);
    assert.deepStrictEqual(find(e, '-u').span.start, { line: 0, character: 6 });
  });

  it('describes positional arguments from the dictionary', () => {
    const e = explain('grep -i "foo" ./src');
    assert.match(find(e, '"foo"').explanation, /search pattern/);
    assert.match(find(e, './src').explanation, /file to search/);
  });

  it('handles --name=value and unknown commands', () => {
    assert.match(find(explain('grep --include=*.sh x'), '--include=*.sh').explanation, /value: `\*\.sh`/);
    assert.match(explain('frobnicate -x').items[0].explanation, /not in the dictionary/);
  });

  it('explains wrapped commands and subcommands', () => {
    const e = explain('sudo -u bob rm -rf /tmp/x');
    assert.match(find(e, 'rm').explanation, /Remove files/);
    assert.strictEqual(spanText('sudo -u bob rm -rf /tmp/x', find(e, 'rm')), 'rm -rf /tmp/x');
    assert.match(find(e, '-r').explanation, /directories/);
    const g = explain('git commit -m "msg"');
    assert.match(g.summary, /^git commit: Record staged changes/);
    assert.match(find(g, '-m').explanation, /commit message/);
  });

  it('explains find -exec up to its terminator', () => {
    const e = explain("find . -name '*.log' -exec rm {} \\;");
    assert.match(find(e, 'rm').explanation, /Command to run/);
    assert.strictEqual(spanText("find . -name '*.log' -exec rm {} \\;", find(e, 'rm')), 'rm {}');
    assert.match(find(e, '\\;').explanation, /once per match/);
  });

  it('recognises calls to functions defined in the script', () => {
    const e = explain('greet() { echo hi; }\ngreet world', 1);
    assert.match(e.items[0].explanation, /function `greet` defined on line 1/);
    assert.match(find(e, 'world').explanation, /Argument \$1/);
  });
});

describe('time keyword', () => {
  it('explains time as a keyword and the rest as the timed command', () => {
    const e = explain('time sleep 1');
    assert.strictEqual(find(e, 'time', 'keyword').kind, 'keyword');
    assert.match(e.items[0].explanation, /^Time `sleep 1`: run it and report how long/);
    assert.match(e.summary, /^time sleep:/);
    assert.ok(allTokens(e.items).some((t) => t.label === 'sleep' || t.label === '1' || t.kind === 'argument'));
  });
  it('explains -p and the options of the timed command', () => {
    const e = explain('time -p ls -l');
    assert.match(find(e, '-p', 'option').explanation, /POSIX format/);
    assert.ok(find(e, '-l', 'option'));
    const g = explain('time grep -r x .');
    assert.match(find(g, '-r', 'option').explanation, /recursive/i);
    const ja = explain('time grep -r x .', 0, 'ja');
    assert.match(ja.items[0].explanation, /の実行時間を計測する/);
    assert.match(find(explain('time -p ls', 0, 'ja'), '-p', 'option').explanation, /POSIX 形式/);
  });
  it('explains a bare time and a timed command with redirections', () => {
    assert.strictEqual(explain('time').items[0].kind, 'keyword');
    const p = explain('time -p 2>/dev/null');
    assert.strictEqual(p.items[0].kind, 'keyword');
    assert.ok(find(p, '-p', 'option'));
    assert.ok(find(explain('time ls 2>&1'), '2>&1'));
  });
  it('explains `time` as timing the whole pipeline after it', () => {
    const e = explain('time -p cat f | sort -u | uniq -c');
    assert.strictEqual(e.items.length, 1);
    const [t] = e.items;
    assert.strictEqual(t.label, 'time -p cat | sort | uniq');
    assert.match(t.explanation, /^Time `cat f \| sort -u \| uniq -c`: run it and report how long/);
    assert.deepStrictEqual(t.children.map((c) => c.label), ['time', '-p', 'cat | sort | uniq']);
    const pipe = t.children[2];
    assert.deepStrictEqual(pipe.children.map((c) => c.label), ['cat', '|', 'sort', '|', 'uniq']);
    assert.match(e.summary, /^time /);
    // The commands after `time` are commands like the others.
    assert.match(find(explain('time cat f | sort -u'), 'sort').explanation, /Sort/);
    assert.ok(find(explain('time a >f | b'), '>f'));
  });
  it('explains each line of a timed pipeline that spans lines', () => {
    const src = 'time ls | while read x; do\n  echo $x\ndone\necho after';
    const first = explain(src, 0);
    assert.strictEqual(first.items[0].children[0].label, 'time');
    assert.deepStrictEqual(explain(src, 1).context.map((c) => c.label), ['while loop']);
    assert.strictEqual(explain(src, 2).items[0].label, 'done');
    const wrapped = explain('time ls |\n  grep x', 1);
    assert.match(wrapped.notes[0], /starts on line 1/);
  });
  it('explains the timed command as it would be on its own', () => {
    const t = explain('time ls -a').items[0];
    assert.deepStrictEqual(t.children.map((c) => [c.kind, c.label]), [['keyword', 'time'], ['command', 'ls']]);
    assert.strictEqual(spanText('time ls -a', t.children[1]), 'ls -a');
    assert.match(t.children[1].explanation, /List directory contents/);
    assert.deepStrictEqual(t.children[1].children.map((c) => c.label), ['-a']);
  });
  it('makes an example of the whole timed pipeline', () => {
    const titles = (src: string) => explain(src).examples.map((x) => x.title);
    assert.deepStrictEqual(titles('time sort -u f'), ['Example']);
    assert.deepStrictEqual(titles('time sort -u f | uniq'), ['Example for `time sort -u f | uniq` (the whole pipeline)']);
    assert.deepStrictEqual(titles('time; sort -u f'), ['Example']);
    assert.deepStrictEqual(titles('time ls && time sort -u f'), ['Example for `sort -u f`']);
  });
  it('names a pipeline in a word of a command in its example, not that command', () => {
    assert.deepStrictEqual(explain('echo $(echo a | tr a b) | cat').examples.map((x) => x.title), ['Example for `echo a | tr a b` (the whole pipeline)']);
    assert.deepStrictEqual(explain('x=$(echo a | tr a b)', 0, 'ja').examples.map((x) => x.title), ['`echo a | tr a b` の例（パイプライン全体）']);
  });
  it('shows up to 12 lines of a whole-pipeline example, and cuts longer ones to 11 and a mark', () => {
    const sections = (src: string) => explain(src).examples[0].sections.map((x) => x.lines.length);
    assert.deepStrictEqual(sections('seq 12 | sort -n'), [12, 12]);
    assert.deepStrictEqual(sections('seq 13 | sort -n'), [12, 12]);
    assert.deepStrictEqual(explain('seq 13 | sort -n').examples[0].sections[1].lines.slice(10), ['11', '…']);
  });
  it('explains the keyword alone when nothing follows it in a pipeline', () => {
    const p = explain('time -p').items[0];
    assert.deepStrictEqual(p.children.map((c) => c.label), ['time', '-p']);
    // bash: `time | wc` is a syntax error (near `|`); the keyword is explained, the rest is an error.
    for (const src of ['time | wc', 'time -p | wc']) {
      const items = explain(src).items;
      assert.strictEqual(items[0].kind, 'keyword', src);
      assert.deepStrictEqual(items.slice(1).map((t) => [t.kind, t.label]), [['error', '|'], ['error', 'wc']], src);
    }
  });
  it('leaves other things named time as commands', () => {
    assert.match(explain('/usr/bin/time ls').items[0].explanation, /Measure the run time and resource use/);
    assert.match(explain('"time" ls').items[0].explanation, /becomes `time`/);
    assert.match(explain('FOO=1 time ls').items[0].explanation, /Measure the run time and resource use/);
  });
  it('runs the program time after a pipe, where bash has no keyword', () => {
    for (const src of ['a | time b', 'a |& time b']) {
      const e = explain(src);
      assert.deepStrictEqual(allTokens(e.items).filter((t) => t.kind === 'keyword'), [], src);
      assert.match(find(e, 'time').explanation, /Measure the run time and resource use/, src);
      assert.strictEqual(spanText(src, find(e, 'time')), 'time b', src);
    }
    // At the start of a pipeline, and after `&&`, it is the keyword.
    assert.strictEqual(find(explain('a && time b'), 'time', 'keyword').kind, 'keyword');
    assert.strictEqual(explain('time a | b').items[0].kind, 'keyword');
  });
});

describe('statements as bash reads them', () => {
  const labels = (t: Token): string[] => t.children.map((c) => c.label);
  it('a redirection after the last command of a list or pipeline belongs to that command', () => {
    const e = explain('echo A && echo B > f');
    assert.strictEqual(e.items.length, 1);
    assert.match(e.items[0].explanation, /^AND list/);
    assert.deepStrictEqual(labels(e.items[0]), ['echo', '&&', 'echo > f']);
    assert.strictEqual(spanText('echo A && echo B > f', e.items[0].children[0]), 'echo A');
    // The command and the redirection are siblings under the redirect token.
    assert.deepStrictEqual(labels(e.items[0].children[2]), ['echo', '> f']);
    assert.deepStrictEqual(labels(e.items[0].children[2].children[0]), ['B']);
    assert.deepStrictEqual(labels(e.items[0].children[0]), ['A']);
    assert.ok(!allTokens(e.items).some((t) => /as a whole/.test(t.explanation)));
    const p = explain('echo a | cat 2>/dev/null');
    assert.match(p.items[0].explanation, /^Pipeline/);
    assert.deepStrictEqual(labels(p.items[0]), ['echo', '|', 'cat 2>/dev/null']);
    assert.deepStrictEqual(labels(p.items[0].children[2]), ['cat', '2>/dev/null']);
    // A compound command takes its own, also last in a list.
    const g = explain('echo a && { echo b; } > f');
    assert.deepStrictEqual(labels(g.items[0]), ['echo', '&&', '{ ‹commands› } > f']);
    assert.match(g.items[0].children[2].explanation, /^Redirection applied to `\{ echo b; \}` as a whole/);
    assert.match(explain('{ echo a; } > f').items[0].explanation, /as a whole/);
    // The pitfall of sudo looks at the command that is redirected.
    assert.match(explain('echo x && sudo echo hi > /etc/motd').notes.join('\n'), /opened by your own shell with your rights, before sudo starts/);
  });
  it('! negates the whole pipeline', () => {
    const e = explain('! true | false');
    assert.strictEqual(e.items.length, 1);
    assert.match(e.items[0].explanation, /^Negate the exit status of the whole pipeline/);
    assert.deepStrictEqual(labels(e.items[0]), ['true | false']);
    assert.match(e.items[0].children[0].explanation, /^Pipeline/);
    assert.match(explain('! true | false', 0, 'ja').items[0].explanation, /パイプライン全体の終了ステータス/);
    // Alone, or in a list, it negates one command.
    assert.match(explain('! grep -q x f').items[0].explanation, /following command/);
    assert.deepStrictEqual(labels(explain('! a && b').items[0]), ['! a', '&&', 'b']);
    assert.deepStrictEqual(labels(explain('! a && b').items[0].children[0]), ['a']);
    // With a redirection: the command's.
    const r = explain('! grep -q x f > /dev/null');
    assert.deepStrictEqual(labels(r.items[0]), ['grep > /dev/null']);
  });
  it('the rest of a heredoc line is explained: later stages and commands', () => {
    const e = explain('cat <<EOF | tr a-z A-Z && echo after\nhello\nEOF');
    const list = e.items[0];
    assert.match(list.explanation, /^AND list/);
    assert.deepStrictEqual(labels(list).filter((l) => l !== '&&'), ['cat | tr', 'echo']);
    assert.ok(find(e, 'tr'));
    assert.match(find(e, 'tr').explanation, /Translate or delete/);
    assert.ok(e.examples.length > 0);
    assert.match(find(e, '<<EOF', 'redirect').explanation, /^Here-document/);
    // The lines of the body are still the here-document's.
    assert.match(explain('cat <<EOF | tr a-z A-Z && echo after\nhello\nEOF', 1).notes[0], /part of the here-document/);
    // Redirections after the delimiter sit beside it.
    const r = explain('cat <<EOF > out.txt\nhello\nEOF');
    assert.deepStrictEqual(labels(r.items[0]), ['cat', '<<EOF', '> out.txt']);
    assert.strictEqual(find(r, '<<EOF').children.length, 0);
    // The arguments after it are the command's.
    assert.deepStrictEqual(labels(explain('cat <<EOF out.txt\nhello\nEOF').items[0]), ['<<EOF', 'out.txt']);
  });
  it('a variable set on the right of a pipe is still pointed out when the last stage is redirected', () => {
    const notes = explain('cat f | while read -r l; do n=$l; done > out\necho "$n"').notes.join('\n');
    assert.match(notes, /run in subshells/);
  });
  it('says a transform letter bash does not have is a bad substitution', () => {
    const e = explain('echo ${x@Z}');
    assert.match(find(e, '${x@Z}', 'expansion').explanation, /bad substitution/);
    assert.match(find(e, 'Z').explanation, /not a transform bash has/);
    assert.strictEqual(find(e, 'Z').kind, 'error');
    assert.match(find(explain('echo ${x@Z}', 0, 'ja'), 'Z').explanation, /bad substitution/);
    // The letters bash has are explained as before.
    assert.match(find(explain('echo ${x@Q}'), '${x@Q}', 'expansion').explanation, /quote it/);
  });
  it('says zsh parameter flags are a bad substitution in bash (checked with bash), and leaves zsh alone', () => {
    assert.strictEqual(spawnSync('bash', ['-c', 'echo ${(f)var}'], { encoding: 'utf8' }).status, 1);
    const e = explain('echo ${(f)var}');
    assert.match(find(e, '${(f)var}', 'error').explanation, /bad substitution/);
    assert.match(find(explain('echo ${(f)var}', 0, 'ja'), '${(f)var}', 'error').explanation, /bad substitution/);
    const zsh = new Analyzer('en').explainLine(parser.parse('echo ${(f)var}'), 0, 'zsh');
    assert.ok(!allTokens(zsh.items).some((t) => /bad substitution/.test(t.explanation)));
  });
  it('explains the later lines of a case pattern list that goes on after a backslash as patterns', () => {
    const src = 'case $x in\n  a|b|\\\n  c)\n    echo hi ;;\n  d|\\\n  e) echo d ;;\nesac';
    assert.strictEqual(run('bash', ['-n'], { input: src }).status, 0);
    const c = explain(src, 2);
    assert.deepStrictEqual(allTokens(c.items).map((t) => [t.kind, t.label]), [['pattern', 'c']]);
    assert.match(c.context.map((x) => x.label).join(), /case branch/);
    // The body after `)` on the same line is still explained, and the first line has the whole branch.
    assert.deepStrictEqual(explain(src, 5).items.map((t) => t.label), ['e', 'echo', ';;']);
    assert.match(explain(src, 1).items[0].explanation, /matches `a \| b \| c`/);
  });
  it('explains array elements with an index of their own', () => {
    const e = explain('a+=([7]=z [k]=v x$y)');
    assert.strictEqual(find(e, '[7]=z').explanation, 'Element with index `7`: set it to `z`');
    assert.match(find(e, '[k]=v').explanation, /^Element with index `k`/);
    assert.match(find(explain('a=([2]+=x)'), '[2]+=x').explanation, /append `x`/);
    assert.match(find(explain('a=([2]+=x)', 0, 'ja'), '[2]+=x').explanation, /添字 `2` の要素に `x` を追記/);
    assert.match(find(explain('a=([2]=x)', 0, 'ja'), '[2]=x').explanation, /を代入する/);
    // Other concatenations in an array are not elements with an index.
    assert.match(find(e, 'x$y').explanation, /^Concatenation/);
  });
  it('ends the delimiter of a here-document at the `;`, and goes on with the next command', () => {
    // bash: the delimiter is `EOF`, and `echo after` runs once the body has been read.
    const e = explain('cat <<EOF; echo after\nbody\nEOF');
    // (One list of two commands, `;` between them.)
    assert.deepStrictEqual(e.items.map((t) => t.label), ['cat; echo']);
    assert.deepStrictEqual(labels(e.items[0]), ['cat <<EOF', ';', 'echo']);
    assert.match(find(e, '<<EOF').explanation, /up to a line containing only `EOF`/);
  });
  it('adds " …" to a label only when the text goes on in a later line, not for blanks at its end', () => {
    assert.deepStrictEqual(explain("tr -d ' '").items.map((t) => t.label), ['tr']);
    assert.strictEqual(spanText("tr -d ' '", explain("tr -d ' '").items[0]), "tr -d ' '");
    assert.ok(find(explain("tr -d ' '"), "' '"));
    assert.ok(find(explain('echo "PV " x'), '"PV "'));
    assert.deepStrictEqual(explain('echo a  \\\nb').items.map((t) => t.label), ['echo']);
  });
  it('reads the format of printf in $"…" like one in double quotes, with its example', () => {
    for (const q of ['"', '$"']) {
      const e = explain(`printf ${q}Copyright %s Inc.${'"'} 2024`);
      assert.ok(find(e, '%s', 'variable'), q);
      assert.deepStrictEqual(e.examples.map((x) => x.kind), ['printf'], q);
    }
    // A translated string with an expansion in it is not literal: no example.
    assert.deepStrictEqual(explain('printf $"Copyright %s $y" 2024').examples, []);
  });
  it('gives a pattern token to any glob or extglob on the right of ==, = and != in [[ ]]', () => {
    for (const [src, label, note] of [
      ['[[ $x == --?(a)b ]]', '--?(a)b', /Extended glob: `\?\(a\)`/],
      ['[[ $x == -@(!(-*)e*|-edit) ]]', '-@(!(-*)e*|-edit)', /Extended glob/],
      ['[[ $x == *.txt ]]', '*.txt', /^Glob pattern \(shell wildcards\): matched against a string$/],
      ['[[ $x != *.txt ]]', '*.txt', /^Glob pattern/],
      ['[[ $x = [ab]*.c ]]', '[ab]*.c', /^Glob pattern/],
    ] as const) assert.match(find(explain(src), label, 'pattern').explanation, note, src);
    // Plain words, and `[ ]` (which compares text), have none; an arithmetic `==` has none either.
    assert.ok(!allTokens(explain('[[ $x == abc ]]').items).some((t) => t.kind === 'pattern'));
    assert.ok(!allTokens(explain('[ "$x" = *.txt ]').items).some((t) => t.kind === 'pattern'));
    assert.ok(!allTokens(explain('echo $((x == y*2))').items).some((t) => t.kind === 'pattern'));
  });
  it('explains the redirections of a compound command and of a here-document', () => {
    assert.ok(find(explain('{ cat; } <<EOF\nx\nEOF'), '<<EOF'));
  });
  it('time at the start of a pipeline, with a redirection, is the keyword that times the pipeline', () => {
    // bash accepts it: the redirection is the first stage of the pipeline.
    const t = explain('time 2>/dev/null | wc').items[0];
    assert.strictEqual(t.children[0].kind, 'keyword');
    assert.deepStrictEqual(t.children[1].children.map((c) => c.kind), ['redirect', 'operator', 'command']);
  });
  it('a pipeline that ends in a redirection with no command is not a pitfall', () => {
    assert.deepStrictEqual(explain('echo a | >f').notes, []);
  });
  it('a pipeline still gets its example when its last stage is redirected', () => {
    assert.deepStrictEqual(explain('sort -u f | uniq -c > out').examples.map((x) => x.title), explain('sort -u f | uniq -c').examples.map((x) => x.title));
    assert.ok(explain('sort -u f | uniq -c > out').examples.length > 0);
    assert.strictEqual(explain('sort -u f | uniq -c > out').examples[0].kind, 'pipeline');
  });
});

describe('input that is not finished', () => {
  it('explains a pipeline with nothing after the pipe', () => {
    const e = explain('echo a |');
    assert.deepStrictEqual(e.items[0].children.map((c) => c.label), ['echo', '|']);
  });
  it('reads a `[ ]` without its `]` word by word', () => {
    const e = explain('[ a = *"$a"*z');
    assert.deepStrictEqual(e.items[0].children.map((c) => c.label), ['[', 'a = *"$a"*z']);
    assert.match(e.items[0].children[1].explanation, /^Condition: `a` vs `\*"\$a"\*z`/);
  });
  it('leaves out a redirection the parser could not read at all', () => {
    const e = explain('[range(200000)] | map(. + 1)');
    assert.deepStrictEqual(allTokens(e.items).filter((t) => t.kind === 'redirect'), []);
    // bash: a syntax error near `200000`; `[range` is read as a command name.
    assert.strictEqual(e.items[0].kind, 'command');
    assert.strictEqual(e.items[0].label, '[range');
  });
  it('explains a construct without its closing keyword, with the parts it has', () => {
    const shape = (src: string, line = 0) => explain(src, line).items.map((t) => [t.kind, t.label, t.children.map((c) => c.label)]);
    assert.deepStrictEqual(shape('if true; then'), [['keyword', 'if ‹condition› then', ['if', 'true', ';', 'then']]]);
    assert.deepStrictEqual(shape('select x in a; do'), [['keyword', 'select x in ‹words› do', ['select', 'x', 'in', 'a', ';', 'do']]]);
    assert.deepStrictEqual(shape('x=(1'), [['assignment', 'x=(1', ['(1']]]);
    assert.deepStrictEqual(shape('echo $(foo'), [['builtin', 'echo', ['$(foo']]]);
    // The other constructs are explained with the parts they have, too.
    assert.deepStrictEqual(shape('{ echo'), [['block', '{ ‹commands›', ['{', 'echo']]]);
    assert.deepStrictEqual(shape('case $x in'), [['keyword', 'case $x in', ['case', '$x', 'in']]]);
    assert.deepStrictEqual(shape('echo "abc'), [['builtin', 'echo', ['"abc']]]);
    const loop = 'for f in *.sh; do\n  echo $f';
    assert.deepStrictEqual(shape(loop), [['keyword', 'for f in ‹words› do ‹commands›', ['for', 'f', 'in', '*.sh', ';', 'do ‹commands›']]]);
    assert.deepStrictEqual(shape(loop, 1), [['builtin', 'echo', ['$f']]]);
    assert.match(explain('if true; then').summary, /^if statement: runs the `then` branch/);
    assert.match(explain('{ echo').summary, /^Command group/);
  });
});

describe('operators, redirections and expansions', () => {
  it('explains pipes, && and || in order', () => {
    const e = explain('a | b && c || d');
    const ops = allTokens(e.items).filter((t) => t.kind === 'operator' && t.children.length === 0).map((t) => t.label);
    assert.deepStrictEqual(ops, ['|', '&&', '||']);
  });

  it('explains common redirections', () => {
    assert.match(find(explain('cmd 2>&1'), '2>&1').explanation, /stderr \(fd 2\) to wherever stdout/);
    assert.match(find(explain('cmd >/dev/null'), '>/dev/null').explanation, /discards/);
    assert.match(find(explain('echo x >&2'), '>&2').explanation, /stdout to stderr/);
    assert.match(find(explain('cat < in.txt >> out.txt'), '>> out.txt').explanation, /Append/);
  });

  it('explains parameter expansions', () => {
    assert.match(find(explain('echo "${X:-def}"'), '${X:-def}').explanation, /Use `def` if `X` is unset or empty/);
    assert.match(find(explain('echo ${f%.sh}'), '${f%.sh}', 'expansion').explanation, /shortest suffix/);
    assert.match(find(explain('echo ${#arr[@]}'), '${#arr[@]}', 'expansion').explanation, /Number of elements/);
    assert.match(find(explain('echo ${1:-}'), '${1:-}', 'expansion').explanation, /set -u/);
  });

  it('explains special variables and substitutions', () => {
    assert.match(find(explain('echo $?'), '$?', 'variable').explanation, /Exit status/);
    assert.match(find(explain('x=$(date)'), '$(date)').explanation, /Command substitution/);
    assert.match(find(explain('diff <(ls a) <(ls b)'), '<(ls a)', 'substitution').explanation, /Process substitution/);
    assert.match(find(explain('echo $((1 + 2))'), '$((1 + 2))', 'substitution').explanation, /Arithmetic expansion/);
  });

  it('explains tests', () => {
    const e = explain('[[ -f $f && -n $g ]]');
    assert.match(find(e, '-f $f').explanation, /`\$f` is an existing regular file/);
    assert.match(find(e, '-f $f && -n $g').explanation, /both conditions/);
    assert.match(find(explain('[[ $x =~ ^[0-9]+$ ]]'), '$x =~ ^[0-9]+$').explanation, /regex/);
    assert.match(find(explain('[ "$a" -eq 3 ]'), '"$a" -eq 3').explanation, /numbers are equal/);
  });
});

describe('multi-line constructs', () => {
  const script = [
    'for f in *.sh; do', // 0
    '  echo "$f"', //      1
    'done < list.txt', //  2
    'cat <<EOF', //        3
    'hello $USER', //      4
    'EOF', //              5
    'curl -s \\', //       6
    '  -o out http://x', //7
    'if true; then', //    8
    '  :', //              9
    'else', //             10
    '  exit 1', //         11
    'fi', //               12
  ].join('\n');

  it('explains a loop header without its body', () => {
    const e = explain(script, 0);
    assert.strictEqual(e.items.length, 1);
    assert.match(e.items[0].explanation, /for loop.*lines 1–3/);
    assert.ok(!allTokens(e.items).some((t) => t.label.startsWith('echo')));
  });

  it('gives loop body lines their enclosing context', () => {
    const e = explain(script, 1);
    assert.deepStrictEqual(e.context.map((c) => c.label), ['for loop']);
    assert.match(e.items[0].explanation, /Print arguments/);
  });

  it('explains closing keywords with trailing redirections', () => {
    const e = explain(script, 2);
    assert.deepStrictEqual(e.items.map((t) => t.label), ['done', '< list.txt']);
  });

  it('marks here-document bodies', () => {
    const e = explain(script, 4);
    assert.match(e.notes[0], /here-document started by `<<EOF` on line 4/);
    assert.match(find(e, '$USER').explanation, /user name/);
  });

  it('says the line of a here-document after blank lines at the top', () => {
    assert.match(explain('\n\n\ncat <<EOF\nx\nEOF', 4).notes[0], /started by `<<EOF` on line 4\./);
  });

  it('explains continued commands on every line', () => {
    const e = explain(script, 7);
    assert.match(e.notes[0], /starts on line 7/);
    assert.match(find(e, '-o').explanation, /write output to a file/);
  });

  it('handles else branches', () => {
    assert.match(explain(script, 10).items[0].explanation, /no condition was true/);
    assert.deepStrictEqual(explain(script, 11).context.map((c) => c.label), ['if statement', 'else']);
  });
});

describe('robustness', () => {
  it('explains comments and shebangs', () => {
    assert.match(explain('#!/bin/bash').items[0].explanation, /Shebang/);
    assert.match(explain('echo # hi').items[1].explanation, /Comment/);
  });

  it('says that the shebang works only when the file is run as a program, and is a comment to bash', () => {
    const parser = createUnbashParser();
    const shebang = (line: string, lang: 'ja' | 'en' = 'en', shell?: Shell) => new Analyzer(lang).explainLine(parser.parse(line), 0, shell ?? detectShell(line)).items[0];
    const env = shebang('#!/usr/bin/env bash');
    assert.strictEqual(env.kind, 'shebang');
    assert.deepStrictEqual(env.refs, ['3.8', '3.1.3', 'execve(2)']);
    assert.strictEqual(env.explanation, 'Shebang: when the file is run as a program (`./script.sh`, or a command found on PATH), the kernel (or bash, on a system whose kernel does not) '
      + 'runs `/usr/bin/env bash ./script.sh args…`, and `env` finds `bash` on PATH and runs it. To bash this line is a comment: `bash script.sh`, `sh script.sh`, '
      + '`source script.sh` and `. script.sh` ignore it. Bash Explainer explains the script as bash, from this line');
    assert.strictEqual(shebang('#!/usr/bin/env bash', 'ja').explanation, 'シバン（shebang）: ファイルをプログラムとして実行すると（`./script.sh`、または PATH から見つかるコマンドとして）、'
      + 'カーネル（それをしないシステムでは bash）が `/usr/bin/env bash ./script.sh 引数…` を実行する。`env` は PATH から `bash` を探して実行する。'
      + 'bash にとってこの行はコメントで、`bash script.sh`・`sh script.sh`・`source script.sh`・`. script.sh` では無視される。Bash Explainer はこの行から、スクリプトを bash のものとして解説する');
    assert.match(shebang('#!/bin/sh').explanation, /runs `\/bin\/sh \.\/script\.sh args…`\. To bash this line is a comment: .* ignore it\. Bash Explainer explains the script as POSIX sh, from this line$/);
    assert.match(shebang('#!/bin/sh', 'ja').explanation, /が `\/bin\/sh \.\/script\.sh 引数…` を実行する。bash にとってこの行はコメントで、.*。Bash Explainer はこの行から、スクリプトを POSIX sh のものとして解説する$/);
    // Linux passes the rest of the line as one argument, which `env -S` splits.
    assert.match(shebang('#!/usr/bin/env -S bash -e').explanation, /runs `\/usr\/bin\/env '-S bash -e' \.\/script\.sh args…` \(on Linux the whole rest of the line, `-S bash -e`, is one argument\)\. `env -S` splits the rest into words and runs `bash` with `-e` and the script's path as arguments\. To bash/);
    assert.match(shebang('#!/usr/bin/env -S bash -e', 'ja').explanation, /`\/usr\/bin\/env '-S bash -e' \.\/script\.sh 引数…` を実行する（Linux では行の残りの `-S bash -e` 全体が1つの引数になる）。`env -S` が残りを単語に分け/);
    assert.match(shebang('#!/bin/bash -eu').explanation, /runs `\/bin\/bash -eu \.\/script\.sh args…`\. To bash/);
    // Another shell chosen (a directive, a setting); an interpreter that is no shell; no interpreter.
    assert.match(shebang('#!/bin/sh', 'en', 'bash').explanation, /Bash Explainer explains the script as bash here, not as POSIX sh \(a ShellCheck directive or a setting chooses it\)$/);
    assert.match(shebang('#!/bin/sh', 'ja', 'bash').explanation, /ここではスクリプトを POSIX sh ではなく bash のものとして解説する（ShellCheck の指示コメントか設定で選ばれている）$/);
    assert.match(shebang('#!/usr/bin/python3').explanation, /runs `\/usr\/bin\/python3 \.\/script\.sh args…`\. To bash this line is a comment: .* ignore it$/);
    assert.match(shebang('#!').explanation, /^Shebang with no interpreter: run as a program, the kernel cannot start the file/);
    assert.match(shebang('#!', 'ja').explanation, /^シバン（shebang）だがインタープリタがない/);
    // Only as the file's first two bytes: not after a blank, nor on a later line.
    assert.strictEqual(explain(' #!/bin/bash').items[0].kind, 'comment');
    assert.strictEqual(explain('echo\n#!/bin/bash', 1).items[0].kind, 'comment');
  });

  it('says that a byte order mark before the shebang makes it a command', () => {
    const e = explain('\uFEFF#!/bin/bash\necho hi');
    assert.deepStrictEqual(e.facts?.find((f) => f.id === 'shebang-bom')?.refs, ['3.8', 'execve(2)']);
    assert.match(e.notes[0], /^ⓧ Error: the first line starts with an invisible byte order mark \(BOM, U\+FEFF\), so it is no shebang: .* a command named `#!\/bin\/bash` with the BOM before it, which fails \("No such file or directory"\)\. Save the file without the BOM$/);
    assert.match(explain('\uFEFF#!bash', 0, 'ja').notes[0], /BOM の付いた `#!bash` という名前のコマンドとして実行して失敗する（command not found）。BOM を付けずに保存する$/);
    assert.deepStrictEqual(explain('echo\n\uFEFF#!/bin/bash', 1).notes, []);
  });

  it('explains the shebangs that run env: Linux gives it the rest as one word, which only `-S` splits', () => {
    const shebang = (line: string, lang: 'ja' | 'en' = 'en') => explain(line, 0, lang).items[0].explanation;
    assert.match(shebang('#!/usr/bin/env -S bash -e'), /`env -S` splits the rest into words and runs `bash` with `-e` and the script's path as arguments\. To bash/);
    assert.match(shebang('#!/usr/bin/env -S bash -e', 'ja'), /`env -S` が残りを単語に分け、`bash` を `-e` とスクリプトのパスを引数にして実行する。bash にとって/);
    assert.match(shebang('#!/usr/bin/env -vS bash'), /runs `bash` with the script's path as arguments\. To bash/);
    assert.match(shebang('#!/usr/bin/env -S ${SHELL}'), /runs `…` with the script's path/);
    assert.match(shebang('#!/usr/bin/env bash -e'), /⚠ On Linux the whole `bash -e` after the interpreter is one argument to env/);
    assert.match(shebang('#!/usr/bin/env -S -i'), /names no command, so env runs the script's path as the command\. To bash/);
    assert.match(shebang('#!/usr/bin/env -S"a'), /⚠ env cannot split this string and exits with status 125/);
    // (Compared with env in test/wrappers-real.test.ts.)
    assert.match(shebang('#!/usr/bin/env -i bash'), /⚠ On Linux the whole `-i bash` after the interpreter is one argument to env, which reads it as one run of options, so it does not run `bash`/);
    assert.match(shebang('#!/usr/bin/env -i bash', 'ja'), /`bash` をコマンドとして実行しない/);
    for (const line of ['#!/usr/bin/env bash', '#!/bin/bash -e']) assert.doesNotMatch(shebang(line), /⚠|env -S/, line);
    // env with no command runs the script's path, which starts env again (checked with Linux and GNU env: it never ends).
    assert.match(shebang('#!/usr/bin/env'), /runs `\/usr\/bin\/env \.\/script\.sh args…`\. ⚠ env runs the script's path as the command, so the script starts itself again, without end\. To bash/);
    assert.match(shebang('#!/usr/bin/env FOO=1 bash'), /⚠ env runs the script's path as the command \(it takes `FOO=1 bash` as a variable to set\), so the script starts itself again/);
    assert.match(shebang('#!/usr/bin/env FOO=1', 'ja'), /⚠ env はスクリプトのパスをコマンドとして実行する（`FOO=1` は設定する変数として読む）ので、スクリプトが自分自身を終わりなく起動し直す/);
    // The kernel opens the interpreter as a path: `bash` alone is looked for in the current directory ("required file not found").
    assert.match(shebang('#!bash'), /runs `bash \.\/script\.sh args…`\. ⚠ The kernel does not search PATH for the interpreter: it looks for `bash` from the current directory/);
    assert.doesNotMatch(shebang('#!env bash'), /finds `bash` on PATH/);
    assert.match(shebang('#!env bash', 'ja'), /カレントディレクトリからの相対パスとして `env` を探す/);
    // A quote in the rest of the line, quoted again as one word.
    assert.match(shebang("#!/usr/bin/env -S bash -c 'echo hi'"), /runs `\/usr\/bin\/env '-S bash -c '\\''echo hi'\\''' \.\/script\.sh args…`/);
  });

  it('says when bash refuses the options of its shebang (test/state.test.ts runs them)', () => {
    const notes = (line: string, lang: 'ja' | 'en' = 'en') => explain(`${line}\necho ran`, 0, lang).notes.filter((n) => /refuses it|受け付けない/.test(n));
    assert.match(notes('#!/bin/bash -e -u')[0], /^ⓧ Error: on Linux the whole `-e -u` after the interpreter is one argument to bash, which refuses it \(a blank is not an option\)\. Run directly, the script stops with an error before running anything\. Write the options with `set` on the next line \(`bash script` ignores the options of the shebang\)$/);
    assert.match(notes('#!/bin/bash -o nounset')[0], /\(`o` takes the next argument, the script's path, as an option name\)/);
    assert.match(notes('#!/bin/bash --posix -e')[0], /\(no long option has that name\)/);
    assert.match(notes('#!/bin/bash -euo pipefail', 'ja')[0], /^ⓧ エラー: Linux ではシバンのインタープリタの後ろの `-euo pipefail` 全体が bash への1つの引数になり、bash はそれを受け付けない（`o` が次の引数のスクリプトのパスをオプション名として読む）。直接実行すると/);
    for (const line of ['#!/bin/bash -eu', '#!/bin/bash', '#!/bin/bash --posix', '#!/usr/bin/env -S bash -e -u', '#!/bin/sh -e -u']) assert.deepStrictEqual(notes(line), [], line);
  });

  it('explains the words env -S splits a string into, or why env refuses it', () => {
    const value = (line: string, label: string, lang: 'ja' | 'en' = 'en') => {
      const out: string[] = [];
      const walk = (t: { label: string; explanation: string; children: unknown[] }) => { if (t.label === label) out.push(t.explanation); t.children.forEach((c) => walk(c as typeof t)); };
      explain(line, 0, lang).items.forEach(walk);
      return out[0];
    };
    assert.match(value("env -S'-i A=1 bash -e' s", '-i A=1 bash -e'), /env splits it into words and reads them here as its own arguments: `-i` \(start with an empty environment\), `A=1` \(variable for the command\), `bash` \(the command to run: .*\), `-e` \(exit immediately if a command fails .*\)$/);
    assert.match(value("env -S'-i A=1 bash -e' s", '-i A=1 bash -e', 'ja'), /env はこれを単語に分けて、この位置で自分の引数として読む: `-i`（空の環境から始める）、`A=1`（コマンドの環境に入れる変数）/);
    assert.match(value("env -S 'bash -e' s", "'bash -e'"), /`bash` \(the command to run/);
    assert.match(value("env --split-string='-u HOME -- cmd' s", "--split-string='-u HOME -- cmd'"), /`-u` \(remove a variable\), `HOME` \(value for `-u`\), `--` \(end of options\), `cmd` \(the command to run\)$/);
    assert.match(value("env -S- s", '-'), /`-` \(start with an empty environment \(same as `-i`\)\)$/);
    assert.match(value("env -S'-vx' s", '-vx'), /`-vx` \(print each step on stderr, an option not in the dictionary\)$/);
    assert.match(value("env -S'x${A}' s", 'x${A}'), /`x…` \(the value of `\$\{…\}` is known at run time\) \(the command to run\)$/);
    assert.match(value('env --split-string= s', '--split-string='), /env splits it into no words$/);
    assert.match(value("env -S'\"a' s", '"a'), /⚠ env refuses this string and exits with status 125, running nothing \(a quote is not closed\)$/);
    assert.match(value("env -S'a\\' s", 'a\\'), /\(it ends in a backslash\)$/);
    assert.match(value("env -S'a\\x' s", 'a\\x'), /\(`\\x` is not an escape it knows\)$/);
    assert.match(value(`env -S'"\\c"' s`, '"\\c"'), /\(`\\c` is inside double quotes\)$/);
    assert.match(value("env -S'$A' s", '$A', 'ja'), /（`\$` は `\$\{名前\}` の形でしか使えない）$/);
    assert.match(value("env -S'printf %s,' x", 'printf %s,'), /`%s,` \(format string\)$/);
    assert.match(value("env -S'foo a' s", 'foo a'), /`foo` \(the command to run\), `a` \(argument\)$/);
    // A subcommand in the string.
    assert.match(value("env -S'git log' x", 'git log'), /`log` \(subcommand: /);
    // The later words keep their place: the command's arguments.
    assert.match(value("env -S'bash -e' s", 's'), /script/i);
  });

  it('returns nothing for blank lines', () => {
    const e = explain('echo a\n\necho b', 1);
    assert.deepStrictEqual(e.items, []);
    assert.strictEqual(e.summary, '');
  });

  it('does not throw on broken input', () => {
    for (const src of ['echo "unterminated', 'if then fi', 'for in do', '${', 'x=(', 'case', '$(( ']) {
      assert.doesNotThrow(() => explain(src), src);
    }
  });

  it('switches language', () => {
    assert.match(explain('ls -l', 0, 'ja').items[0].explanation, /ディレクトリの中身/);
    assert.match(explain('ls -l', 0, 'en').items[0].explanation, /List directory/);
  });

  it('explains a pipeline of kislyuk yq step by step, and a name the parser leaves outside any word', () => {
    // (kislyuk/yq prints JSON: each step of `.a | keys` is shown as JSON.)
    const yq = new Analyzer('en').explainLine(parser.parse("yq '.a | keys' x.yaml"), 0, undefined, { yqFlavor: 'kislyuk' });
    assert.ok(yq.examples.some((e) => e.sections.length > 2));
    // (`$tmp` in a function name that does not parse: no word context, no note on splitting.)
    const t = parser.parse('function c$tmp"; }\nread -rp "Continue? " ans');
    assert.doesNotThrow(() => new Analyzer('en').explainLine(t, 0));
  });

  it('explains every line of the sample script without throwing', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(path.join(root, 'test/fixtures/sample.sh'), 'utf8');
    const tree = parser.parse(src);
    const a = new Analyzer('ja');
    src.split('\n').forEach((_, i) => a.explainLine(tree, i));
  });

  it('explains every line of the coverage script, in both languages, without throwing', async () => {
    // Many one-line cases of every command and example kind, kept apart from the curated sample.sh.
    const fs = await import('fs');
    const src = fs.readFileSync(path.join(root, 'test/fixtures/coverage.sh'), 'utf8');
    const tree = parser.parse(src);
    for (const lang of ['en', 'ja'] as const) {
      const a = new Analyzer(lang);
      src.split('\n').forEach((_, i) => a.explainLine(tree, i));
    }
  });
});

describe('standalone arithmetic commands', () => {
  it('explains (( )) as a test and shows true/false values', () => {
    const e = explain('(( retries >= 3 )) && exit 1');
    assert.strictEqual(find(e, '(( retries >= 3 ))', 'test').kind, 'test');
    assert.deepStrictEqual(e.examples[0].sections.map((s) => s.lines), [['retries="3"'], ['retries="2"']]);
  });
  it('shows matching values for bracket patterns in case', () => {
    const e = explain('case "$f" in\n  [Rr]eadme*) less "$f" ;;\nesac', 1);
    assert.ok(e.examples[0].sections[0].lines.every((v) => /^[Rr]eadme/.test(v)));
  });
});

describe('example titles', () => {
  it('names the command when the line runs several', () => {
    const src = 'grep -rn x ./src | sort -u > errors.txt && echo "done: $(date +%F)"';
    assert.deepStrictEqual(explain(src, 0, 'ja').examples.map((e) => e.title), ['`grep -rn x ./src` の例', '`sort -u` の例', '`date +%F` の例']);
    assert.deepStrictEqual(explain(src, 0, 'en').examples.map((e) => e.title), ['Example for `grep -rn x ./src`', 'Example for `sort -u`', 'Example for `date +%F`']);
  });
  it('shows date +FORMAT at fixed moments, the same every time', () => {
    const [ex] = explain('date -u +%Y%m%dT%H%M%SZ').examples;
    assert.deepStrictEqual(ex.sections.map((x) => x.lines), [['2024-03-05 07:08:09', '2025-12-31 23:59:59'], ['20240305T070809Z', '20251231T235959Z']]);
    assert.strictEqual(ex.kind, 'date');
    assert.deepStrictEqual(rerun(ex.interactive!.spec, [['2000-01-01 00:00:00', 'soon']], 'en').sections[0].lines, ['20000101T000000Z', '(not a date; write it like `2024-03-05 07:08:09`)']);
  });
  it('keeps the plain title for a single command', () => {
    assert.deepStrictEqual(explain('sort -u names.txt', 0, 'ja').examples.map((e) => e.title), ['例']);
  });
});

describe('git log examples', () => {
  it('shows the output of --pretty and the dates of --date, each under its option', () => {
    const e = explain("git log --pretty=format:'%h %ad' --date=format:%Y -n 2");
    assert.deepStrictEqual(e.examples.map((x) => x.title), ['Example (`git log` output with this format)', 'Example (dates in this style)']);
    const year = String(new Date().getFullYear());
    assert.deepStrictEqual(e.examples[0].sections[0].lines, [`3f2a9c1 ${year}`, `b81e44a ${year}`]);
    assert.strictEqual(e.examples[1].sections[0].lines.length, 2);
    assert.match(JSON.stringify(e.examples[0].anchor), /"character":8/);
  });
});

describe('getopt', () => {
  it('reads -o and --long, and shows how sample arguments are rearranged', () => {
    const e = explain('OPTS=$(getopt -o hv: --long help,level:: -n "$0" -- "$@")');
    const t = find(e, 'help,level::');
    assert.deepStrictEqual(t.children.map((c) => c.label), ['help', ',', 'level::']);
    assert.match(find(e, 'v:').explanation, /option -v takes a value/);
    assert.deepStrictEqual(e.examples[0].sections.map((s) => s.lines[0]), ['file1.txt -h -v value --level=3 file2.txt', "-h -v 'value' --level '3' -- 'file1.txt' 'file2.txt'"]);
  });
  it('understands the old form', () => {
    const e = explain('set -- $(getopt ab: "$@")');
    assert.strictEqual(e.examples[0].sections[1].lines[0], '-a -b value -- file1.txt file2.txt');
  });
});

describe('globstar', () => {
  it('explains ** as one level, with a pitfall until shopt -s globstar is seen, and as any depth after', () => {
    const before = explain('ls **/*.ts');
    assert.match(find(before, '**/*.ts').explanation, /With globstar not turned on, `\*\*` is the same as `\*` and matches one level only$/);
    assert.match(find(explain('shopt -s globstar\nls **/*.ts', 1), '**/*.ts').explanation, /any depth/);
    assert.ok(before.notes.some((n) => /Caveat: `\*\*` reaches into subdirectories only after `shopt -s globstar`/.test(n)));
    const after = explain('shopt -s globstar\nls **/*.ts', 1);
    assert.ok(!after.notes.some((n) => /globstar/.test(n)));
    assert.match(find(explain('shopt -u globstar\nls **/*.ts', 1), '**/*.ts').explanation, /same as `\*`/);
    assert.ok(!explain('ls *.ts').notes.some((n) => /globstar/.test(n)));
  });
});

describe('extglob', () => {
  it('reads an extended glob in an argument as one word, keeping its text', () => {
    const tree = parser.parse('rm -- !(*.txt) x; ls *.@(jpg|png)');
    assert.deepStrictEqual(descendants(tree.root, ['word']).map((w) => w.text), ['rm', '--', '!(*.txt)', 'x', 'ls', '*.@(jpg|png)']);
    assert.ok(!hasError(tree.root));
    for (const src of ['if !(false); then :; fi', 'echo $((x*(2+3)))']) {
      const t = parser.parse(src);
      assert.ok(descendants(t.root, ['subshell', 'parenthesized_expression']).length, src);
    }
  });
  it('explains it, with a pitfall until shopt -s extglob is seen', () => {
    const e = explain('rm !(keep).log');
    assert.match(find(e, '!(keep).log').explanation, /Extended glob: `!\(keep\)` is anything but `keep`/);
    assert.ok(e.notes.some((n) => /Caveat: extended globs like `!\(keep\).log` are a syntax error unless `shopt -s extglob`/.test(n)));
    assert.ok(!explain('shopt -s extglob\nrm !(keep).log', 1).notes.some((n) => /extglob/.test(n)));
    assert.ok(!explain('[[ $x == +([0-9]) ]]').notes.some((n) => /extglob/.test(n)));
  });
  it('points out shopt -s extglob inside the same function', () => {
    const e = explain('f() {\n  shopt -s extglob\n  rm !(keep).log\n}', 2);
    assert.ok(e.notes.some((n) => /a `shopt -s extglob` inside the same block is not yet on/.test(n)));
  });
});

describe('globs that match nothing', () => {
  const pitfall = (e: LineExplanation) => e.notes.some((n) => /when no file matches/.test(n));
  it('points out a for loop over a glob', () => {
    assert.ok(pitfall(explain('for f in *.log; do gzip "$f"; done')));
    assert.ok(pitfall(explain('for f in "$dir"/*.log; do gzip "$f"; done')));
  });
  it('says nothing when the body checks the file, with nullglob, or for plain words', () => {
    assert.ok(!pitfall(explain('for f in *.log; do [ -e "$f" ] || continue; gzip "$f"; done')));
    assert.ok(!pitfall(explain('for f in *.log; do\n  [[ -f $f ]] || continue\ndone')));
    assert.ok(!pitfall(explain('shopt -s nullglob\nfor f in *.log; do gzip "$f"; done', 1)));
    assert.ok(!pitfall(explain('for f in a b; do :; done')));
  });
});

describe('pipelines and aliases', () => {
  const lost = (e: LineExplanation) => e.notes.some((n) => /the commands of a pipeline/.test(n));
  it('points out a variable set on the right of a pipe and read after it', () => {
    assert.ok(lost(explain('cat f | while read -r l; do n=$l; done\necho "$n"')));
    assert.ok(lost(explain('echo x | read y; echo "$y"')));
  });
  it('says nothing with lastpipe, in zsh, when unused, or set again before use', () => {
    assert.ok(!lost(explain('shopt -s lastpipe\ncat f | while read -r l; do n=$l; done\necho "$n"', 1)));
    assert.ok(!lost(explain('cat f | while read -r l; do echo "$l"; done')));
    assert.ok(!lost(explain('cat f | while read -r l; do n=$l; done\nn=0; echo "$n"')));
    const tree = parser.parse('cat f | while read -r l; do n=$l; done\necho "$n"');
    assert.ok(!new Analyzer('en').explainLine(tree, 0, 'zsh').notes.some((n) => /pipeline/.test(n)));
  });
  it('explains an alias defined in the script, with a pitfall without expand_aliases', () => {
    const e = explain('#!/bin/bash\nalias ll="ls -l"\nll /tmp', 2);
    assert.match(find(e, 'll').explanation, /alias `ll` defined on line 2 \(`ls -l`\)\. But bash does not expand aliases in a script.*"command not found"/);
    assert.match(find(explain('shopt -s expand_aliases\nalias ll="ls -l"\nll', 2), 'll').explanation, /alias `ll` defined on line 2: replaced by `ls -l`/);
    assert.ok(e.notes.some((n) => /bash does not expand aliases in scripts/.test(n)));
    assert.ok(!explain('shopt -s expand_aliases\nalias ll="ls -l"\nll', 2).notes.some((n) => /aliases/.test(n)));
    assert.ok(!explain('#!/bin/bash\nalias grep=ggrep\ngrep x f', 2).notes.some((n) => /aliases/.test(n)));
  });
});

describe('the state along the script (src/semantics/state.ts)', () => {
  const notes = (src: string, line: number, opts = {}) => new Analyzer('en').explainLine(parser.parse(src), line, undefined, opts).notes;
  it('says "may" when only some paths turn an option on', () => {
    assert.ok(notes('if a; then shopt -s globstar; fi\nls **/*.ts', 1).some((n) => /only after `shopt -s globstar`, and only some paths before here \(a branch or a loop\) turn it on/.test(n)));
    assert.ok(!notes('if a; then shopt -s globstar; fi\nls **/*.ts', 1, { pitfalls: false }).some((n) => /globstar/.test(n)));
    assert.ok(notes('if a; then shopt -s extglob; fi\nrm !(keep).log', 1).some((n) => /unless `shopt -s extglob` comes first .*, and only some paths before here/.test(n)));
    assert.match(find(explain('#!/bin/bash\nif a; then shopt -s expand_aliases; fi\nalias ll="ls -l"\nll', 3), 'll').explanation, /replaced by `ls -l`, but only when `shopt -s expand_aliases` is on/);
    assert.match(find(explain('if a; then IFS=,; fi\necho $x', 1), '$x', 'variable').explanation, /set on line 1 to a value not known here/);
  });
  it('says "may" for a pipeline stage and an array that depend on the path', () => {
    assert.match(find(explain('a && shopt -s lastpipe\necho | { x=1; }', 1), '{ ‹commands› }').explanation, /on the paths where `shopt -s lastpipe` is on/);
    assert.ok(notes('a && shopt -s lastpipe\necho x | read y; echo "$y"', 1).some((n) => /only some paths before here turn `shopt -s lastpipe` on/.test(n)));
    assert.match(find(explain('while read -r l; do a+=("$l"); done < f\necho $a', 1), '$a', 'variable').explanation, /is an array on some paths/);
    // A command substitution reads its aliases when it runs.
    assert.match(find(explain('shopt -s expand_aliases; alias hi="echo A"; echo "$(hi)"'), 'hi').explanation, /alias `hi`/);
    // `unset -fv`: both options.
    assert.deepStrictEqual(find(explain('unset -fv g'), '-fv').children.map((c) => c.explanation), ['unset functions', 'unset variables']);
  });
  it('a subshell keeps its changes', () => {
    assert.doesNotMatch(find(explain('( shopt -s dotglob )\nls *', 1), '*').explanation, /dotglob/);
    assert.ok(!/array/.test(find(explain('( a=(1 2) ); echo $a'), '$a', 'variable').explanation));
    assert.match(find(explain('( later() { :; } ); later'), 'later', 'command').explanation, /external command/);
    assert.match(find(explain("( p='3*4' ); p='1+2'; ( p='5*6' ); echo $(( $p * 2 ))"), '$p', 'variable').explanation, /here `1\+2`/);
    // `shopt -u lastpipe` in a subshell leaves it on outside.
    assert.ok(!notes('shopt -s lastpipe\n( shopt -u lastpipe )\necho 1 | read v; echo "$v"', 2).some((n) => /pipeline/.test(n)));
  });
  it('a function changes the state where it is called, not where it is defined', () => {
    assert.match(find(explain('setup() { set -f; }\necho *.md', 1), '*.md').explanation, /Glob pattern/);
    assert.match(find(explain('setup() { set -f; }\nsetup\necho *.md', 2), '*.md').explanation, /has turned globbing off/);
    assert.ok(notes('setup() { shopt -s extglob; }\nls !(x).txt', 1).some((n) => /extended globs like/.test(n)));
    assert.match(find(explain('k() { IFS=-; }\nk\necho $x', 2), '$x', 'variable').explanation, /set to `-` on line 1/);
    assert.match(find(explain('f() { local IFS=,; echo $v; }'), '$v', 'variable').explanation, /set to `,` on line 1/);
    assert.match(find(explain('mk() { alias mm=make; }\nmm', 1), 'mm').explanation, /external command/);
    assert.doesNotMatch(find(explain('cnt() { declare -A m; }\nm[a+b]=1', 1), 'm[a+b]=1').explanation, /associative/);
    assert.doesNotMatch(find(explain('f() { local -i z; }\nz=5', 1), 'z=5').explanation, /integer/);
    assert.doesNotMatch(find(explain('f() { local -n r=$1; }\ng() { r=5; }', 1), 'r=5').explanation, /nameref/);
  });
  it('an option counts from where it runs', () => {
    assert.match(find(explain('x=1 :\nset -o posix\ny=2 :'), 'x=1').explanation, /only for this command/);
    assert.match(find(explain('x=1 :\nset -o posix\ny=2 :', 2), 'y=2').explanation, /POSIX special builtin/);
    assert.match(find(explain('#!/bin/bash --posix\nx=1 :', 1), 'x=1').explanation, /POSIX special builtin/);
    // (The kernel passes `--posix -e` to bash as one word, which bash rejects; env looks for a program `bash --posix`.)
    assert.match(find(explain('#!/bin/bash --posix -e\nx=1 :', 1), 'x=1').explanation, /only for this command/);
    assert.match(find(explain('#!/usr/bin/env bash --posix\nx=1 :', 1), 'x=1').explanation, /only for this command/);
    assert.match(find(explain('#!/usr/bin/env -S bash --posix\nx=1 :', 1), 'x=1').explanation, /POSIX special builtin/);
    assert.match(find(explain('awk --posix 1\nx=1 :', 1), 'x=1').explanation, /only for this command/);
    // Aliases expand only when expand_aliases was on when the line was read.
    assert.ok(notes('#!/bin/bash\nalias ll="ls -l"\nll\nshopt -s expand_aliases', 2).some((n) => /bash does not expand aliases in scripts/.test(n)));
    // A function exported only after the command that needs it.
    assert.ok(notes('f() { :; }\nbash -c f\nexport -f f', 1).some((n) => /does not have this script's function `f`/.test(n)));
    assert.ok(!notes('f() { :; }\nexport -f f\nbash -c f', 2).some((n) => /function `f`/.test(n)));
    assert.ok(notes('bash -c f\nf() { :; }', 0).some((n) => /does not have this script's function `f`/.test(n)));
    // The definition in effect, when a function is defined twice.
    assert.match(find(explain('f() { :; }\nf() { :; }\nf', 2), 'f').explanation, /defined on line 2/);
  });
});

describe('syntax the other tests do not reach', () => {
  const ex = (src: string, line = 0) => allTokens(explain(src, line).items).map((t) => `${t.label}: ${t.explanation}`).join('\n');
  const cases: [string, RegExp, number?][] = [
    ['until ping -c1 host; do sleep 1; done', /until loop: repeat the body until the condition succeeds/],
    ['for a; do echo "$a"; done', /for loop over the positional parameters \("\$@"\) as `a`/],
    ['echo $"hello $USER"', /\$"hello \$USER": `\$"…"` string: translated according to the locale/],
    ["cat <<'EOF'\n$HOME\nEOF", /The delimiter is quoted, so nothing in the body is expanded/],
    ['x+=1', /Append to variable `x`/],
    ['declare -ix n=1', /-ix: treat as integer .*export to the environment/],
    ['unset -v a b', /-v: unset variables\na: Unset the variable `a`/],
    ['unset -f cleanup', /cleanup: Remove the function `cleanup`/],
    ['(( i++ ))', /i\+\+: Arithmetic: `i\+\+` \(increment\)/],
    ['[[ ! -f x ]]', /! -f x: Negation: true if `-f x` is false/],
    ['(( n += 2 ))', /Arithmetic assignment: `n` \+= `2`/],
    ['echo ${a[-1]}', /Index -1: the last element/],
    ['echo ${s:1:-2}', /up to 2 characters before the end/],
    ['tee >(gzip > f.gz)', /Process substitution `>\(…\)`: a file name whose writes go to the command's stdin/],
    ['# shellcheck disable=SC2086', /ShellCheck directive/],
    ['# bash-explainer disable-file=shopt', /Bash Explainer directive: no `shopt` warnings in this file/],
    ['echo x # bash-explainer disable=procSub,shopt', /no `procSub`, `shopt` warnings on this line/],
  ];
  for (const [src, re, line] of cases) it(src.split('\n')[0], () => assert.match(ex(src, line), re));
});

describe('pitfalls for other shells and settings', () => {
  const notes = (src: string, line: number, shell?: Parameters<Analyzer['explainLine']>[2]) => {
    const tree = parser.parse(src);
    return new Analyzer('en').explainLine(tree, line, shell).notes.join('\n');
  };
  it('in dash, suggests what dash has', () => {
    assert.match(notes('cat f | while read -r l; do n=$l; done\necho "$n"', 0, 'dash'), /Feed the loop with a redirection, `done < file`, or use a temporary file/);
    assert.match(notes('echo x | read y; echo "$y"', 0, 'dash'), /Take the output with command substitution: `y=\$\(command\)`/);
    assert.match(notes('ls **/*.ts', 0, 'dash'), /dash has no globstar/);
    assert.match(notes('for f in *.log; do gzip "$f"; done', 0, 'dash'), /Start the body with `\[ -e "\$f" \] \|\| continue`$/m);
  });
  it('after shopt -u extglob', () => {
    assert.match(notes('shopt -u extglob\nrm !(keep).log', 1), /and `shopt -u extglob` turned it off/);
  });
});

describe('aliases of distributions', () => {
  it('explains ll as an alias, its arguments as ls ones, and warns that it depends on the system', () => {
    const e = explain('ll /tmp');
    assert.match(find(e, 'll').explanation, /^Alias `ll`: list files in long format .*Ubuntu: `ls -alF`/);
    assert.match(find(e, '/tmp').explanation, /file or directory/);
    // (A file with no shebang may be read by an interactive shell, `.bashrc`, which has it: a caveat.)
    assert.ok(e.notes.some((n) => /^ⓘ System-dependent: `ll` is an alias Ubuntu, Fedora \/ RHEL, openSUSE, Git for Windows define for interactive shells.*But this file has no shebang/.test(n)));
    assert.ok(explain('#!/bin/bash\nll /tmp', 1).notes.some((n) => /^ⓧ System-dependent: `ll` is an alias Ubuntu, Fedora \/ RHEL, openSUSE, Git for Windows define for interactive shells, not a command\. Other systems lack it, and scripts do not have it even there \("command not found"\)\. Write/.test(n)));
  });
  it('covers more than ls: names that are not commands at all', () => {
    const cases: [string, RegExp][] = [
      ['sleep 9; alert', /Alias `alert`: show a desktop notification .*\(Ubuntu: /],
      ['..', /Alias `\.\.`: go up one directory \(openSUSE: `cd \.\.`\)/],
      ['+', /pushd \./], ['-', /popd/], ['cd..', /go up one directory/], ['o README', /page through files/],
      ['md a/b', /Alias `md`: make directories/], ['rd old', /remove empty directories/], ['unmount /mnt', /the command to unmount is `umount`/],
      ['remount ro /', /Function `remount`: remount a mounted file system/], ['xd /usr/bin/vi', /go to the directory the given file is in/],
    ];
    for (const [src, re] of cases) {
      const e = explain(src, 0);
      assert.match(allTokens(e.items).map((t) => t.explanation).join('\n'), re, src);
      assert.ok(e.notes.some((n) => /System-dependent/.test(n)), src);
    }
    assert.match(explain('md a/b').notes.join('\n'), /is an alias openSUSE defines for interactive shells.*Write `mkdir -p`/);
    assert.match(explain('l').notes.join('\n'), /write the command you mean/i);
    // Commands of their own are not taken for the aliases of the same name.
    assert.ok(!explain('dir /tmp').notes.some((n) => /System-dependent/.test(n)));
  });
  it('lets a function or alias of the script win', () => {
    assert.ok(!explain('ll() { ls -l "$@"; }\nll', 1).notes.some((n) => /System-dependent/.test(n)));
    assert.ok(!explain("alias ll='ls -lh'\nll", 1).notes.some((n) => /System-dependent/.test(n)));
  });
});

describe('a command with redirections', () => {
  const labels = (t: Token): string[] => t.children.map((c) => c.label);
  const spanText = (src: string, t: Token): string => {
    const line = src.split('\n')[t.span.start.line];
    return line.slice(t.span.start.character, t.span.end.character);
  };
  it('is the command and its redirections, side by side, under a redirect token', () => {
    const src = "tr -d '\\r' < windows.txt > unix.txt";
    const e = explain(src);
    const [outer] = e.items;
    assert.strictEqual(e.items.length, 1);
    assert.strictEqual(outer.kind, 'redirect');
    assert.match(outer.explanation, /^Redirection applied to `tr -d '\\r'`: its stdin \(fd 0\) and stdout \(fd 1\) are redirected\. The shell sets this up before the command starts/);
    assert.deepStrictEqual(labels(outer), ['tr', '< windows.txt', '> unix.txt']);
    // The label names the program; the range is still the whole command, without the redirections.
    assert.strictEqual(spanText(src, outer.children[0]), "tr -d '\\r'");
    assert.strictEqual(outer.label, 'tr < windows.txt > unix.txt');
    const [cmd] = outer.children;
    assert.strictEqual(cmd.kind, 'command');
    assert.strictEqual(cmd.explanation, 'Translate or delete characters (stdin only)');
    assert.deepStrictEqual(labels(cmd), ['-d', "'\\r'"]);
    // The words only: no space after them, and the redirections are outside.
    assert.strictEqual(spanText(src, cmd), "tr -d '\\r'");
    assert.strictEqual(spanText(src, outer), src);
    // The summary line stays the command's.
    assert.strictEqual(e.summary, 'tr: Translate or delete characters (stdin only)');
    // The example belongs to the command.
    assert.strictEqual(e.examples.length, 1);
    assert.deepStrictEqual(e.examples[0].anchor, cmd.span);
    assert.strictEqual(e.examples[0].target, "tr -d '\\r'");
  });
  it('explains it in Japanese', () => {
    const e = explain('sort < in.txt > out.txt 2>&1', 0, 'ja');
    assert.strictEqual(e.items[0].explanation, '入出力のリダイレクト: `sort` の標準入力(fd 0)・標準出力(fd 1)・標準エラー出力(fd 2)を切り替える。シェルがコマンドの起動前に設定するので、コマンド自身にはリダイレクトは見えない');
    assert.strictEqual(e.items[0].children[0].kind, 'command');
    assert.match(e.items[0].children[0].explanation, /行を並べ替え/);
    assert.match(explain('ls &> o', 0, 'ja').items[0].explanation, /`ls` の標準出力\(fd 1\)・標準エラー出力\(fd 2\)を切り替える/);
    assert.match(explain('ls &> o').items[0].explanation, /its stdout \(fd 1\) and stderr \(fd 2\) are redirected/);
    assert.match(explain('ls 3>o 2>e >f').items[0].explanation, /its stdout \(fd 1\), stderr \(fd 2\) and file descriptor 3 are redirected/);
  });
  it('is a command with the redirections before its words', () => {
    const src = ">f echo x";
    const e = explain(src);
    assert.strictEqual(e.items[0].kind, 'redirect');
    assert.deepStrictEqual(labels(e.items[0]), ['>f', 'echo']);
    assert.strictEqual(spanText(src, e.items[0].children[1]), 'echo x');
    const cmd = e.items[0].children[1];
    assert.strictEqual(cmd.kind, 'builtin');
    assert.strictEqual(spanText(src, cmd), 'echo x');
    const r = explain("<<<'1 2' read -r a b");
    assert.deepStrictEqual(labels(r.items[0]), ["<<<'1 2'", 'read']);
    assert.strictEqual(r.items[0].children[1].kind, 'builtin');
    assert.match(r.items[0].explanation, /^Redirection applied to `read -r a b`: its stdin \(fd 0\) is redirected/);
    // The example of `read` is the command's.
    assert.deepStrictEqual(r.examples[0].anchor, r.items[0].children[1].span);
  });
  it('keeps the assignments before the command in the command, and takes redirections on both sides', () => {
    const src = 'FOO=1 BAR=2 cat -n <in >out 2>&1';
    const e = explain(src);
    assert.deepStrictEqual(labels(e.items[0]), ['cat', '<in', '>out', '2>&1']);
    assert.strictEqual(spanText(src, e.items[0].children[0]), 'FOO=1 BAR=2 cat -n');
    // The assignments stay children of the command token.
    assert.deepStrictEqual(labels(e.items[0].children[0]).slice(0, 2), ['FOO=1', 'BAR=2']);
    const cmd = e.items[0].children[0];
    assert.deepStrictEqual(labels(cmd), ['FOO=1', 'BAR=2', '-n']);
    assert.strictEqual(spanText(src, cmd), 'FOO=1 BAR=2 cat -n');
    const both = explain('<in cat -n >out');
    assert.deepStrictEqual(labels(both.items[0]), ['<in', 'cat', '>out']);
    assert.strictEqual(both.items[0].children[1].kind, 'command');
    // The order matters for `2>&1`: the note is still given.
    assert.ok(e.notes.some((n) => /left to right/.test(n)));
    assert.ok(explain('2>&1 >f echo x').notes.some((n) => /left to right/.test(n)));
  });
  it('stays one token when a redirection is among the words', () => {
    const e = explain('echo a > f b');
    assert.strictEqual(e.items[0].kind, 'builtin');
    assert.deepStrictEqual(labels(e.items[0]), ['a', '> f', 'b']);
    assert.strictEqual(e.items[0].label, 'echo');
    assert.strictEqual(spanText('echo a > f b', e.items[0]), 'echo a > f b');
    // …also when there is another after the words.
    const f = explain('echo a > f b > g');
    assert.strictEqual(f.items[0].kind, 'builtin');
    assert.deepStrictEqual(labels(f.items[0]), ['a', '> f', 'b', '> g']);
    const d = explain('declare -i >f x=1 >g');
    assert.strictEqual(d.items[0].kind, 'builtin');
    assert.strictEqual(explain('export A=1 > f >g').items[0].children[0].kind, 'builtin');
    assert.strictEqual(explain('export A >f B').items[0].kind, 'builtin');
    // A here-string stays inside the declaration for the parser; it is still beside it.
    assert.deepStrictEqual(labels(explain('export A <<< x').items[0]), ['export', '<<< x']);
  });
  it('keeps the stage of a pipeline, and its pipeline example', () => {
    const e = explain('grep x f 2>/dev/null | sort');
    assert.strictEqual(e.items[0].kind, 'operator');
    assert.deepStrictEqual(labels(e.items[0]), ['grep 2>/dev/null', '|', 'sort']);
    const [stage] = e.items[0].children;
    assert.strictEqual(stage.kind, 'redirect');
    assert.deepStrictEqual(labels(stage), ['grep', '2>/dev/null']);
    assert.match(stage.explanation, /its stderr \(fd 2\) is redirected/);
    assert.strictEqual(e.examples.length, 1);
    assert.strictEqual(e.examples[0].kind, 'pipeline');
    assert.deepStrictEqual(e.examples[0].anchor, e.items[0].span);
    assert.strictEqual(e.summary, 'grep: Print lines matching a pattern (regex) | sort: Sort lines');
    const l = explain('cat < in | sort > out');
    assert.deepStrictEqual(labels(l.items[0]), ['cat < in', '|', 'sort > out']);
    assert.strictEqual(l.examples[0].kind, 'pipeline');
  });
  it('is the command with the here-string or here-document beside it', () => {
    const h = explain("cat <<< 'hi' > out");
    assert.deepStrictEqual(labels(h.items[0]), ['cat', "<<< 'hi'", '> out']);
    const src = 'cat <<EOF > out\nhello $USER\nEOF';
    for (const line of [0, 1, 2]) {
      const e = explain(src, line);
      assert.strictEqual(e.items[0].kind, 'redirect', String(line));
      assert.deepStrictEqual(labels(e.items[0]), ['cat', '<<EOF', '> out'], String(line));
      assert.strictEqual(e.items[0].children[0].kind, 'command');
      assert.deepStrictEqual(e.items[0].children[0].span, { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } });
      assert.strictEqual(e.summary, 'cat: Concatenate files and print to stdout');
    }
    assert.ok(allTokens(explain(src).items).some((t) => t.label === '$USER'));
  });
  it('is the command with 2>&1 alone', () => {
    const e = explain('make 2>&1');
    assert.deepStrictEqual(labels(e.items[0]), ['make', '2>&1']);
    assert.match(e.items[0].explanation, /^Redirection applied to `make`: its stderr \(fd 2\) is redirected/);
    assert.match(e.items[0].children[1].explanation, /classic way/);
  });
  it('says only what is redirected when a descriptor is opened on a variable', () => {
    const e = explain('echo hi {fd}>f');
    assert.strictEqual(e.items[0].explanation, 'Redirection applied to `echo hi`. The shell sets this up before the command starts, so the command does not see the redirections');
    assert.match(explain('echo hi {fd}>f', 0, 'ja').items[0].explanation, /^入出力のリダイレクト: `echo hi` の入出力を切り替える。/);
  });
  it('puts the examples of the command and of its words on the command', () => {
    const e = explain("sed -n 's/a/b/p' < in.txt > out.txt");
    assert.ok(e.examples.length > 0);
    const cmd = e.items[0].children[0];
    for (const x of e.examples) assert.ok(x.anchor && x.anchor.start.character >= cmd.span.start.character && x.anchor.end.character <= cmd.span.end.character);
  });
});

describe('a subcommand', () => {
  it('is a subcommand token in the colour of a command, with a note on the syntax (en)', () => {
    for (const [src, label, parent] of [['git log --oneline -5', 'log', 'git'], ['docker run -it alpine', 'run', 'docker'], ['kubectl get pods', 'get', 'kubectl'], ['npm run build', 'run', 'npm']]) {
      const t = find(explain(src), label, 'subcommand');
      assert.match(t.explanation, new RegExp(`^Subcommand \`${parent} ${label}\`: .* \\(to the shell it is an argument to \`${parent}\`, which interprets it itself\\)$`), src);
      assert.strictEqual(allTokens(explain(src).items).filter((x) => x.kind === 'subcommand').length, 1, src);
    }
  });
  it('has the note in Japanese, once', () => {
    const t = find(explain('git log --oneline -5', 0, 'ja'), 'log', 'subcommand');
    assert.strictEqual(t.explanation, 'サブコマンド `git log`: コミット履歴を表示する（シェルから見れば `git` への引数で、`git` 自身が解釈する）');
    assert.strictEqual((t.explanation.match(/シェルから見れば/g) ?? []).length, 1);
  });
  it('is not made for an argument that is not in the dictionary', () => {
    assert.deepStrictEqual(allTokens(explain('git remote frobnicate origin URL').items).filter((x) => x.kind === 'subcommand').map((x) => x.label), ['remote']);
  });
});

describe('[ ] shows its syntax', () => {
  const cases: [string, string[]][] = [
    ['[ -f "$f" ]', ['[', '-f "$f"', ']']],
    ['[ -n "$x" -a -f y ]', ['[', '-n "$x" -a -f y', ']']],
    ['[ a = b ]', ['[', 'a = b', ']']],
  ];
  for (const [src, labels] of cases) {
    it(`gives [ and ] a token of their own: ${src}`, () => {
      const t = explain(src).items[0];
      assert.deepStrictEqual(t.children.map((c) => c.label), labels);
      assert.deepStrictEqual([t.children[0].kind, t.children.at(-1)!.kind], ['builtin', 'argument']);
      assert.strictEqual(spanText(src, t.children[0]), '[');
      assert.strictEqual(spanText(src, t.children.at(-1)!), ']');
      assert.strictEqual(t.children[0].span.start.character, 0);
      assert.strictEqual(t.children.at(-1)!.span.end.character, src.length);
    });
  }
  it('explains it as the command `[`, in en and ja', () => {
    const en = explain('[ -f x ]').items[0];
    assert.match(en.explanation, /^Command `\[` \(an alias of `test`\): .*ordinary command, not shell syntax.*word splitting and globbing \(`\[\[ \]\]` does not\)$/);
    assert.strictEqual(en.children[0].explanation, 'Command `[` (an alias of `test`)');
    assert.match(en.children[2].explanation, /^The last argument passed to `\[`\./);
    const ja = explain('[ -f x ]', 0, 'ja').items[0];
    assert.match(ja.explanation, /^コマンド `\[`（`test` の別名）: .*単語分割とグロブ展開がかかる（`\[\[ \]\]` ならかからない）$/);
    assert.strictEqual(ja.children[2].explanation, '`[` に渡す最後の引数。`[` はこれで式の終わりを確かめる（ないとエラー）');
  });
  it('spans a continuation over lines', () => {
    const src = '[ \\\n  -f y ]';
    const t = explain(src).items[0];
    assert.deepStrictEqual(t.children.map((c) => c.label), ['[', '-f y', ']']);
    assert.deepStrictEqual([t.children[0].span.start, t.children[0].span.end], [{ line: 0, character: 0 }, { line: 0, character: 1 }]);
    assert.deepStrictEqual([t.children[2].span.start, t.children[2].span.end], [{ line: 1, character: 7 }, { line: 1, character: 8 }]);
  });
  it('has no ] token, and no condition, when the test is not closed', () => {
    assert.deepStrictEqual(explain('[ -f x').items[0].children.map((c) => c.label), ['[', '-f', 'x']);
  });
  it('keeps `test -f x` as a builtin command', () => {
    const t = explain('test -f x').items[0];
    assert.strictEqual(t.kind, 'builtin');
    // Its words are read as an expression, like the inside of `[ ]` (without the `[` and `]` tokens).
    assert.deepStrictEqual(t.children.map((c) => c.label), ['-f x']);
  });
  it('contrasts [[ ]] with it', () => {
    assert.match(explain('[[ -f $f ]]').items[0].explanation, /shell syntax, not a command, so there is no word splitting or globbing inside/);
    assert.match(explain('[[ -f $f ]]', 0, 'ja').items[0].explanation, /コマンドではなくシェルの構文なので、中で単語分割・グロブ展開が起きず/);
  });
});

describe('a short option with a quoted value glued on', () => {
  const cases: [string, string, string][] = [
    [`awk -F'|' '{print $2}' f`, `-F'|'`, 'field separator'],
    [`cut -d',' -f2 f`, `-d','`, 'field delimiter'],
    [`sed -e's/a/b/' f`, `-e's/a/b/'`, 'add a script'],
    [`grep -e'x' f`, `-e'x'`, 'specify a pattern'],
    [`tar -C'/tmp' -cf a.tar b`, `-C'/tmp'`, 'change to'],
    [`awk -F' ' '{print $1}' f`, `-F' '`, 'field separator'],
    [`awk -F"\\t" '{print $1}' f`, `-F"\\t"`, 'field separator'],
  ];
  for (const [src, label, text] of cases) {
    it(src, () => {
      const e = explain(src);
      const opt = allTokens(e.items).find((t) => t.kind === 'option' && t.label === label);
      assert.ok(opt && opt.explanation.includes(text), `${label}: ${opt?.explanation}`);
      assert.ok(opt.children.some((c) => c.kind === 'argument' && c.explanation.startsWith('Value for')));
      // The command's own operands keep their roles.
      assert.ok(!allTokens(e.items).some((t) => t.explanation === 'target file' && t.label === label));
    });
  }
  it('says what the value is after quote removal', () => {
    assert.ok(allTokens(explain(`cut -d',' -f2 f`).items).some((t) => t.explanation.includes('`,` after quote removal')));
  });
  it('says that a long option prefix is ambiguous, with the options it could be', () => {
    const word = (src: string, lang: 'en' | 'ja') => allTokens(new Analyzer(lang).explainLine(createUnbashParser().parse(src), 0).items).find((t) => t.kind === 'option')!.explanation;
    assert.strictEqual(word('timeout --v 1 true', 'en'), 'Ambiguous option (it starts several long options: `--verbose`, `--version`); timeout refuses it');
    assert.match(word('env --ig=x true', 'en'), /^Ambiguous option .*`--ignore-environment`, `--ignore-signal`\); env refuses it/);
    assert.match(word('timeout --v 1 true', 'ja'), /^あいまいなオプション（.*`--verbose`、`--version`）。timeout は受け付けない$/);
    // A prefix of no option stays unknown.
    assert.match(word('timeout --zz 1 true', 'en'), /^Option \(not in the dictionary/);
  });
  it('shows the value of a partly quoted word without its quote characters, and its span ends there', () => {
    const line = "dpkg-query -Wf='X${Package}' bash";
    const value = allTokens(explain(line).items).find((t) => t.kind === 'argument' && t.explanation.startsWith('Value for `-f`'))!;
    assert.strictEqual(value.label, 'X${Package}');
    assert.strictEqual(line.slice(value.span.start.character, value.span.end.character), 'X${Package}');
    const dir = allTokens(explain("tar -C'/tmp' -xf a.tar").items).find((t) => t.explanation.startsWith('Value for `-C`'))!;
    assert.strictEqual(dir.label, '/tmp');
  });
});

describe('jq options with values', () => {
  const roles = (src: string) => allTokens(explain(src).items[0].children).filter((t) => t.span.start.line === 0).map((t) => `${t.label}: ${t.explanation}`);
  it('--arg and its relatives take a name and a value, then the filter and the file', () => {
    for (const o of ['--arg', '--argjson', '--slurpfile', '--rawfile']) {
      const r = roles(`jq ${o} n 3 '.a = $n' in.json`);
      assert.ok(r.some((x) => x.startsWith('n: Name for')), r.join('\n'));
      assert.ok(r.some((x) => x.startsWith('3: Value for')), r.join('\n'));
      assert.ok(r.some((x) => x.includes("'.a = $n': jq filter")), r.join('\n'));
      assert.ok(r.some((x) => x.startsWith('in.json: input JSON file')), r.join('\n'));
    }
  });
  it('yq (kislyuk) takes two values as well', () => {
    const r = roles(`yq --arg n foo '.a = $n' in.yml`);
    assert.ok(r.some((x) => x.startsWith('n: Name for')) && r.some((x) => x.includes('jq filter')), r.join('\n'));
  });
  it('--arg value is used in the example', () => {
    assert.ok(explain(`jq --arg n foo '.name = $n' in.json`).examples[0].sections[1].lines.join('\n').includes('"foo"'));
  });
  it('--indent takes a number; -f makes the first operand an input file; --args operands are strings', () => {
    const a = roles(`jq --indent 4 . in.json`);
    assert.ok(a.some((x) => x.startsWith('4: Value for `--indent`')) && a.some((x) => x.includes('.: jq filter')), a.join('\n'));
    const f = roles(`jq -f prog.jq in.json`);
    assert.ok(f.some((x) => x.startsWith('in.json: input JSON file')) && !f.some((x) => x.includes('jq filter')), f.join('\n'));
    const g = roles(`jq '.[]' --args a b`);
    assert.ok(g.some((x) => x.startsWith('a: positional string')) && g.some((x) => x.startsWith('b: positional string')), g.join('\n'));
    assert.ok(roles(`jq '.[]' --jsonargs 1 2`).some((x) => x.startsWith('1: positional JSON value')));
  });
});

describe('jq examples follow -s and -j', () => {
  it('-s reads the values of the file as one array', () => {
    const ex = explain(`jq -s length in.json`).examples[0];
    assert.deepStrictEqual(ex.sections[1].lines, ['3']);
    assert.ok(ex.sections[0].lines.length === 3);
    assert.ok(ex.interactive);
  });
  it('-j prints the outputs with no newline', () => {
    const ex = explain(`jq -j '.[]' in.json`).examples[0];
    assert.strictEqual(ex.sections[1].label, 'Output (no newlines)');
    assert.strictEqual(ex.sections[1].lines.length, 1);
  });
});

describe('jq destructuring and label/break', () => {
  const texts = (src: string) => allTokens(explain(src).items).map((t) => t.explanation);
  it('explains patterns after as, reduce and foreach', () => {
    const cases: [string, string][] = [
      [`jq '.[] as [$a,$b] | $a + $b' f`, 'Destructuring pattern `[$a,$b]`: takes the value apart into `$a`, `$b`'],
      [`jq '.[] as {k:$v, $w} | $v' f`, 'Destructuring pattern `{k:$v, $w}`'],
      [`jq '. as {("a"):$x} | $x' f`, 'into `$x`'],
      [`jq '. as [$a] ?// $a | $a' f`, 'tried in turn'],
      [`jq 'reduce .[] as [$a,$b] (0; . + $a)' f`, 'for each value'],
      [`jq '[foreach .[] as {n: $n} (0; . + $n)]' f`, 'Destructuring pattern `{n: $n}` for each value'],
      [`jq '. as $x | $x' f`, 'Variable `$x`'],
      [`jq '. as [{a: $x}] | $x' f`, 'Destructuring pattern `[{a: $x}]`'],
    ];
    for (const [src, text] of cases) {
      const t = texts(src);
      assert.ok(t.some((x) => x.includes(text)), `${src}: ${t.join('\n')}`);
      assert.ok(!t.some((x) => x.includes('Could not parse')), src);
    }
  });
  it('explains label and break', () => {
    const t = texts(`jq 'label $out | .[] | if . > 1 then ., break $out else . end' f`);
    assert.ok(t.some((x) => x.includes('leaves the `label $out` scope')), t.join('\n'));
    assert.ok(!t.some((x) => x.includes('Could not parse')));
  });
  it('shows an example with a sample input that fits the pattern', () => {
    const ex = explain(`jq '.[] as [$a,$b] | $a + $b' f`).examples[0];
    assert.ok(ex && !ex.sections.some((s) => s.label === 'Error'), JSON.stringify(ex));
    assert.ok(explain(`jq '. as {name: $n} | $n' f`).examples[0].sections[0].lines.join('').includes('name'));
  });
  it('rejects a bad pattern or label', () => {
    for (const f of [`jq '. as 1 | 2' f`, `jq 'label out | 1' f`]) assert.ok(texts(f).some((x) => x.includes('Could not parse')), f);
  });
});

describe('the unquoted regex of [[ =~ ]] after quote removal', () => {
  const sources = [String.raw`\bfoo`, String.raw`^\w+\s\d$`, String.raw`\<foo\>`, String.raw`a\.b\+`, String.raw`a\ b`];
  for (const re of sources) {
    it(re, () => {
      const e = explain(`[[ $x =~ ${re} ]]`);
      const matches = e.examples.flatMap((x) => x.sections[0].lines);
      const rest = e.examples.flatMap((x) => x.sections[1].lines);
      assert.ok(matches.length && rest.length);
      // Every sample agrees with what bash itself does.
      const test = (s: string) => spawnSync('bash', ['-c', `[[ $1 =~ ${re} ]]`, 'bash', s]).status === 0;
      for (const m of matches) assert.ok(test(m), `bash should match ${JSON.stringify(m)}`);
      for (const m of rest) assert.ok(!test(m), `bash should not match ${JSON.stringify(m)}`);
    });
  }
  it('warns that \\b \\w \\s \\< are plain characters there', () => {
    const note = explain(String.raw`[[ $x =~ \bfoo\s ]]`).notes.join('\n');
    assert.ok(note.includes('`\\b`') && note.includes('`\\s`') && note.includes('quote removal'), note);
    assert.deepStrictEqual(explain(String.raw`[[ $x =~ a\.b ]]`).notes, []);
    const ja = explain(String.raw`[[ $x =~ \bfoo ]]`, 0, 'ja').notes.join('\n');
    assert.ok(ja.includes('クォート除去'), ja);
  });
});

describe('sed explanations (audit fixes)', () => {
  it('gives no example for sed -z, whose records are NUL separated', () => {
    assert.strictEqual(explain("sed -z 's/\\n/,/g' f").examples.length, 0);
    assert.strictEqual(explain("sed --null-data 's/\\n/,/g' f").examples.length, 0);
    assert.ok(explain("sed 's/a/b/g' f").examples.length > 0);
  });
  it('explains 0,/re/ and the 2g flags', () => {
    const text = JSON.stringify(explain("sed '0,/foo/s//bar/' f"));
    assert.ok(text.includes('before the first line'), text);
    assert.ok(text.includes('the last regex'), text);
    assert.ok(JSON.stringify(explain("sed 's/o/0/2g' f")).includes('every match from the 2nd on'));
    assert.ok(JSON.stringify(explain("sed 's/o/0/2g' f", 0, 'ja')).includes('2番目以降のすべての一致'));
  });
});

describe('awk explanations (audit fixes)', () => {
  it('does not take the comma of a function call for a range', () => {
    const t = JSON.stringify(explain("awk 'match($0,/[0-9]+/){print RSTART}' f"));
    assert.ok(!t.includes('Range pattern'), t);
    assert.ok(JSON.stringify(explain("awk '/a/,/b/' f")).includes('Range pattern'));
    assert.ok(JSON.stringify(explain("awk 'substr($1, 1, 2) == \"ab\", $2 > 3' f")).includes('Range pattern'));
  });
  it('explains $0 assignments, delete and RS=""', () => {
    const t = JSON.stringify([
      explain("awk '{ $0 = \"a b c\"; delete a; delete b[1] }' f"),
      explain("awk 'BEGIN { RS = \"\" } { print $1 }' f"),
    ]);
    for (const part of ['splitting the new `$0` with FS again', 'delete every element of the array `a`', 'delete the array element `b[1]`', 'paragraph mode']) assert.ok(t.includes(part), part);
    assert.ok(JSON.stringify(explain("awk '{ $0 = 1; delete a }' f", 0, 'ja')).includes('すべて削除'));
  });
  it('labels name=value operands and applies them in the example', () => {
    const e = explain("awk '{print $1,$2}' OFS=, f");
    const t = JSON.stringify(e);
    assert.ok(t.includes('Variable assignment'), t);
    assert.ok(e.examples[0].sections.some((s) => s.lines.some((l) => l.includes('apple,red'))), t);
    assert.ok(JSON.stringify(explain("awk '{print $1,$2}' OFS=, f", 0, 'ja')).includes('変数の代入'));
  });
});

describe('regex explanations (audit fixes)', () => {
  it('says that an incomplete BRE interval is an error', () => {
    assert.match(JSON.stringify(explain("grep 'a\\{1' f")), /Unmatched/);
    assert.match(JSON.stringify(explain("grep 'a\\{1' f", 0, 'ja')), /Unmatched/);
    assert.ok(!JSON.stringify(explain("grep 'a\\{1,2\\}' f")).includes('Unmatched'));
  });
  it('gives no example for a pattern grep rejects', () => {
    assert.strictEqual(explain("grep 'a\\{1' f").examples.length, 0);
    const lines = explain("grep -E 'a{2}|b+?' f").examples[0].sections.find((s) => s.label === 'Matching lines')!.lines;
    assert.ok(lines.length > 0);
  });
});

describe('a redirection after a compound command, on its first line', () => {
  const header = (src: string, lang: 'ja' | 'en' = 'en') => explain(src, 0, lang).items[0];
  const redirect = (src: string, lang: 'ja' | 'en' = 'en') => allTokens([header(src, lang)]).find((t) => t.kind === 'redirect')!;

  it('is a child of the header that applies to the whole loop (while)', () => {
    const src = 'while read -r line; do\n  echo "$line"\ndone < input.txt';
    const r = redirect(src);
    assert.strictEqual(r.label, '< input.txt');
    assert.strictEqual(spanText(src, r), '< input.txt');
    assert.deepStrictEqual(r.span, { start: { line: 2, character: 5 }, end: { line: 2, character: 16 } });
    assert.match(r.explanation, /^Read file `input.txt` as stdin \(fd 0\)\. It applies to the whole loop: every command in it that reads stdin, such as `read`, reads from here/);
    assert.match(redirect(src, 'ja').explanation, /^ファイル `input.txt` の内容を標準入力\(fd 0\)として読み込む。ループ全体に付いている: .*`read`/);
    // The line of the redirection itself is explained as before, and a middle line has none.
    assert.strictEqual(explain(src, 2).items.filter((t) => t.kind === 'redirect').length, 1);
    assert.strictEqual(allTokens(explain(src, 1).items).filter((t) => t.kind === 'redirect').length, 0);
  });

  it('says what an output redirection does to the commands', () => {
    const r = redirect('for x in 1 2; do\n  echo $x\ndone > out.txt');
    assert.match(r.explanation, /It applies to the whole loop: every command in it has its stdout sent here$/);
    assert.match(redirect('for x in 1 2; do\n  echo $x\ndone 2> err.log').explanation, /has its stderr sent here$/);
    assert.match(redirect('for x in 1 2; do\n  echo $x\ndone > out.txt', 'ja').explanation, /ループ全体に付いている: 中のコマンドすべてに働く（中のコマンドが標準出力に出すものはここに出る）$/);
    assert.match(redirect('for x in 1 2; do\n  echo $x\ndone 3> fd3.txt').explanation, /every command in it is affected$/);
  });

  it('works for if, case, { }, ( ) and a function with a redirection', () => {
    assert.match(redirect('if true; then\n  cat\nfi < in.txt').explanation, /whole `if` statement/);
    assert.match(redirect('case $x in\n  a) cat ;;\nesac < in.txt').explanation, /whole `case` statement/);
    assert.match(redirect('{ echo a\n  echo b\n} 2> err.log').explanation, /whole command group: every command in it has its stderr/);
    assert.match(redirect('(\n  cat\n) < in.txt').explanation, /whole subshell/);
    const f = redirect('f() {\n  echo a\n} > out.txt');
    assert.match(f.explanation, /whole command group/);
    assert.match(redirect('f() {\n  echo a\n} > out.txt', 'ja').explanation, /コマンドグループ全体に付いている/);
    assert.match(redirect('if true; then\n  cat\nfi < in.txt', 'ja').explanation, /`if` 文全体に付いている/);
  });

  it('keeps every redirection, in source order', () => {
    const toks = allTokens([header('while read -r l; do\n  :\ndone < in.txt 2> err.log')]).filter((t) => t.kind === 'redirect');
    assert.deepStrictEqual(toks.map((t) => t.label), ['< in.txt', '2> err.log']);
  });
});

describe('a redirection after another multi-line command', () => {
  it('is said to apply to the whole command', () => {
    const r = allTokens(explain('((\n  x = 1\n)) > out.txt').items).find((t) => t.kind === 'redirect');
    if (r) assert.match(r.explanation, /whole command: /);
    else assert.fail('no redirect token');
  });
});
