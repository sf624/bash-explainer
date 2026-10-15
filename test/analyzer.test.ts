import * as assert from 'assert';
import * as path from 'path';
import type Parser = require('web-tree-sitter');
import { Analyzer, LineExplanation, Token } from '../src/analyzer';
import { createBashParser } from '../src/parser';

const root = path.join(__dirname, '..');
let parser: Parser;

before(async () => {
  parser = await createBashParser({
    runtimeDir: path.join(root, 'node_modules/web-tree-sitter'),
    bashWasm: path.join(root, 'node_modules/tree-sitter-bash/tree-sitter-bash.wasm'),
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
