import * as assert from 'assert';
import * as path from 'path';
import type { BashParser as Parser } from '../src/parser';
import { Analyzer, LineExplanation, Token } from '../src/analyzer';
import { rerun } from '../src/examples/rerun';
import { createBashParser } from '../src/parser';

const root = path.join(__dirname, '..');
let parser: Parser;

before(async () => {
  parser = await createBashParser({
    runtimeDir: path.join(root, 'node_modules/web-tree-sitter'),
    bashWasm: path.join(root, 'grammar/tree-sitter-bash.wasm'),
  });
});

function explain(src: string, line = 0, lang: 'ja' | 'en' = 'en'): LineExplanation {
  const tree = parser.parse(src);
  try {
    return new Analyzer(lang).explainLine(tree, line);
  } finally {
    tree.delete();
  }
}

function all(tokens: Token[]): Token[] {
  return tokens.flatMap((t) => [t, ...all(t.children)]);
}

function find(e: LineExplanation, label: string, kind?: Token['kind']): Token {
  const t = all(e.items).find((x) => x.label === label && (!kind || x.kind === kind));
  assert.ok(t, `no token "${label}" in: ${all(e.items).map((x) => x.label).join(', ')}`);
  return t;
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
    assert.match(find(e, 'rm -rf /tmp/x').explanation, /Remove files/);
    assert.match(find(e, '-r').explanation, /directories/);
    const g = explain('git commit -m "msg"');
    assert.match(g.summary, /^git commit: Record staged changes/);
    assert.match(find(g, '-m').explanation, /commit message/);
  });

  it('explains find -exec up to its terminator', () => {
    const e = explain("find . -name '*.log' -exec rm {} \\;");
    assert.match(find(e, 'rm {}').explanation, /Command to run/);
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
    assert.ok(all(e.items).some((t) => t.label === 'sleep' || t.label === '1' || t.kind === 'argument'));
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
  it('leaves other things named time as commands', () => {
    assert.match(explain('/usr/bin/time ls').items[0].explanation, /Run the program or script at `\/usr\/bin\/time`/);
    assert.match(explain('"time" ls').items[0].explanation, /Run the expanded value as a command/);
    assert.match(explain('FOO=1 time ls').items[0].explanation, /Run the external command `time`/);
  });
});

describe('operators, redirections and expansions', () => {
  it('explains pipes, && and || in order', () => {
    const e = explain('a | b && c || d');
    const ops = all(e.items).filter((t) => t.kind === 'operator' && t.children.length === 0).map((t) => t.label);
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
    assert.ok(!all(e.items).some((t) => t.label.startsWith('echo')));
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

  it('explains every line of the sample script without throwing', async () => {
    const fs = await import('fs');
    const src = fs.readFileSync(path.join(root, 'test/fixtures/sample.sh'), 'utf8');
    const tree = parser.parse(src);
    const a = new Analyzer('ja');
    src.split('\n').forEach((_, i) => a.explainLine(tree, i));
    tree.delete();
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
    assert.deepStrictEqual(rerun(ex.interactive!.spec, ['2000-01-01 00:00:00', 'soon'], 'en').sections[0].lines, ['20000101T000000Z', '(not a date; write it like `2024-03-05 07:08:09`)']);
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
  it('explains ** as any depth, with a pitfall until shopt -s globstar is seen', () => {
    const before = explain('ls **/*.ts');
    assert.match(find(before, '**/*.ts').explanation, /any depth/);
    assert.ok(before.notes.some((n) => /Pitfall: `\*\*` reaches into subdirectories only after `shopt -s globstar`/.test(n)));
    const after = explain('shopt -s globstar\nls **/*.ts', 1);
    assert.ok(!after.notes.some((n) => /globstar/.test(n)));
    assert.match(find(explain('shopt -u globstar\nls **/*.ts', 1), '**/*.ts').explanation, /same as `\*`/);
    assert.ok(!explain('ls *.ts').notes.some((n) => /globstar/.test(n)));
  });
});

describe('extglob', () => {
  it('reads an extended glob in an argument as one word, keeping its text', () => {
    const tree = parser.parse('rm -- !(*.txt) x; ls *.@(jpg|png)');
    try {
      assert.deepStrictEqual(tree.rootNode.descendantsOfType('word').map((w) => w?.text), ['rm', '--', '!(*.txt)', 'x', 'ls', '*.@(jpg|png)']);
      assert.ok(!tree.rootNode.hasError);
    } finally {
      tree.delete();
    }
    for (const src of ['if !(false); then :; fi', 'echo $((x*(2+3)))']) {
      const t = parser.parse(src);
      assert.ok(t.rootNode.descendantsOfType(['subshell', 'parenthesized_expression']).length, src);
      t.delete();
    }
  });
  it('explains it, with a pitfall until shopt -s extglob is seen', () => {
    const e = explain('rm !(keep).log');
    assert.match(find(e, '!(keep).log').explanation, /Extended glob: `!\(keep\)` is anything but `keep`/);
    assert.ok(e.notes.some((n) => /Pitfall: extended globs like `!\(keep\).log` are a syntax error unless `shopt -s extglob`/.test(n)));
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
    try {
      assert.ok(!new Analyzer('en').explainLine(tree, 0, 'zsh').notes.some((n) => /pipeline/.test(n)));
    } finally {
      tree.delete();
    }
  });
  it('explains an alias defined in the script, with a pitfall without expand_aliases', () => {
    const e = explain('alias ll="ls -l"\nll /tmp', 1);
    assert.match(find(e, 'll /tmp').explanation, /alias `ll` defined on line 1: replaced by `ls -l`/);
    assert.ok(e.notes.some((n) => /bash does not expand aliases in scripts/.test(n)));
    assert.ok(!explain('shopt -s expand_aliases\nalias ll="ls -l"\nll', 2).notes.some((n) => /aliases/.test(n)));
    assert.ok(!explain('alias grep=ggrep\ngrep x f', 1).notes.some((n) => /aliases/.test(n)));
  });
});

describe('syntax the other tests do not reach', () => {
  const ex = (src: string, line = 0) => all(explain(src, line).items).map((t) => `${t.label}: ${t.explanation}`).join('\n');
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
    ['echo ${a[-1]}', /Index -1: the 1st element from the end/],
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
    try {
      return new Analyzer('en').explainLine(tree, line, shell).notes.join('\n');
    } finally {
      tree.delete();
    }
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
    assert.match(find(e, 'll /tmp').explanation, /^Alias `ll`: list files in long format .*Ubuntu: `ls -alF`/);
    assert.match(find(e, '/tmp').explanation, /file or directory/);
    assert.ok(e.notes.some((n) => /^⚠ System-dependent: `ll` is an alias Ubuntu, Fedora \/ RHEL, openSUSE, Git for Windows define for interactive shells/.test(n)));
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
      assert.match(all(e.items).map((t) => t.explanation).join('\n'), re, src);
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
