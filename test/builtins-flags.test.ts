import * as assert from 'assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { BashParser as Parser } from '../src/syntax/tree';
import { Analyzer, Token } from '../src/analyzer';
import { createUnbashParser } from '../src/syntax/adapters/unbash';

let parser: Parser;
before(() => {
  parser = createUnbashParser();
});

/** The tokens inside the first command of a line, flattened to `label: explanation`. */
function parts(src: string, lang: 'en' | 'ja' = 'en'): Record<string, string> {
  const tree = parser.parse(src);
  const out: Record<string, string> = {};
  for (const t of new Analyzer(lang).explainLine(tree, 0).items[0].children) out[t.label] = t.explanation;
  return out;
}
const bash = (script: string) => spawnSync('bash', ['-c', script], { encoding: 'utf8' });

describe('builtin options that take a value', () => {
  // [line, label of the value, role it must NOT get, the role it must get]
  const cases: [string, string, RegExp][] = [
    ['mapfile -n 10 -s 2 -O 5 arr', '5', /Value for `-O`/], ['mapfile -c 1 -C cb arr', 'cb', /Value for `-C`/], ['mapfile -u 3 arr', '3', /Value for `-u`/],
    ['readarray -t -d , parts', ',', /Value for `-d`/], ['readarray -n 3 arr', '3', /Value for `-n`/], ['readarray -t -s 1 arr', '1', /Value for `-s`/],
    ['read -N 3 buf', '3', /Value for `-N`/], ['read -e -i default ans', 'default', /Value for `-i`/],
    ['kill -n 9 123', '9', /Value for `-n`/], ['wait -n -p id', 'id', /Value for `-p`/], ['exec -a name cmd', 'name', /Value for `-a`/],
  ];
  for (const [src, label, re] of cases) it(src, () => assert.match(parts(src)[label], re));

  it('agrees with bash on mapfile -s/-O and read -N/-i', () => {
    assert.strictEqual(bash('printf "x\\ny\\nz\\n" | { mapfile -t -s 1 -O 5 arr; declare -p arr; }').stdout, 'declare -a arr=([5]="y" [6]="z")\n');
    assert.strictEqual(bash('read -N 3 buf <<< abcdef; echo $buf').stdout, 'abc\n');
  });
  it('names the array, not the values', () => {
    assert.match(parts('mapfile -n 10 -s 2 -O 5 arr').arr, /array name/);
  });
});

describe('kill', () => {
  for (const sig of ['-TERM', '-INT', '-HUP', '-SIGTERM', '-15', '-1', '-term']) {
    it(`${sig} is one signal`, () => {
      const p = parts(`kill ${sig} 123`);
      assert.match(p[sig], /^Send (the signal|signal number)/);
      assert.ok(!/Combined/.test(p[sig]));
      assert.match(p['123'], /target PID/);
    });
  }
  it('-l takes signals to translate', () => {
    assert.match(parts('kill -l 15')['15'], /signal to translate/);
    assert.strictEqual(bash('kill -l 15').stdout, 'TERM\n');
  });
  it('-l after -- is a word', () => {
    assert.match(parts('kill -- -l')['-l'], /target PID/);
  });
  it('job specs', () => {
    assert.match(parts('kill -9 %1')['%1'], /Job spec: job number 1/);
    assert.match(parts('fg %%')['%%'], /current job/);
    assert.match(parts('disown -h %vim')['%vim'], /starts with `vim`/);
    assert.match(parts('kill %?foo')['%?foo'], /contains `foo`/);
    assert.match(parts('kill %-')['%-'], /previous job/);
  });
  it('is in Japanese too', () => {
    assert.match(parts('kill -TERM 1', 'ja')['-TERM'], /送るシグナル/);
  });
});

describe('getopts, source, trap, set', () => {
  it('getopts words to parse', () => {
    assert.match(parts('getopts ab opt -a -b')['-a'], /words to parse/);
    assert.strictEqual(bash('getopts ab opt -b; echo $opt').stdout, 'b\n');
  });
  it('. passes arguments', () => assert.match(parts('. ./lib.sh arg1').arg1, /arguments passed/));
  it('trap with one signal resets it', () => {
    assert.match(parts('trap INT').INT, /signal to reset/);
    assert.match(parts('trap 0')['0'], /signal to reset/);
    assert.match(parts('trap -p INT').INT, /signal to show/);
    assert.match(parts("trap 'echo hi' INT")["'echo hi'"], /command to run/);
    assert.strictEqual(bash('trap "echo hi" INT; trap INT; trap -p INT').stdout, '');
  });
  it('set -o and set +o with no name list the settings', () => {
    assert.match(parts('set -o')['-o'], /list the current option settings/);
    assert.match(parts('set +o')['+o'], /recreate the current settings/);
    assert.match(parts('set -o pipefail')['-o'], /enable an option by name/);
    assert.match(bash('set -o').stdout, /^allexport\s+off/m);
  });
  it('set options by name', () => {
    assert.match(parts('set -o errtrace', 'en')['errtrace'], /ERR/);
  });
  it('fc, bind and suspend are builtins', () => {
    for (const c of ['fc -l', 'bind -x "\\C-l:clear"', 'suspend -f']) {
      const t = new Analyzer('en').explainLine(parser.parse(c), 0).items[0];
      assert.strictEqual(t.name?.runs, 'builtin', c);
      assert.strictEqual(spawnSync('bash', ['-c', `type -t ${c.split(' ')[0]}`], { encoding: 'utf8' }).stdout, 'builtin\n');
    }
  });
});

describe('declare, export, unset', () => {
  it('export -n removes the export property', () => {
    assert.match(parts('export -n FOO')['-n'], /remove the export property/);
    assert.strictEqual(bash('export FOO=1; export -n FOO; bash -c \'echo "[$FOO]"\'').stdout, '[]\n');
    assert.match(parts('export -f fn')['-f'], /functions/);
  });
  it('declare -n is still a name reference', () => assert.match(parts('declare -n r=a')['-n'], /name reference/));
  it('declare +x turns the attribute off', () => {
    for (const c of ['declare', 'typeset', 'local']) {
      const p = parts(`${c} +x FOO`);
      assert.match(p['+x'], /stop exporting/);
      assert.match(p.FOO, /Variable `FOO`/);
    }
    assert.strictEqual(bash('declare -x BAR=1; declare +x BAR; declare -p BAR').stdout, 'declare -- BAR="1"\n');
  });
  it('declare -iZ: a letter bash does not have adds nothing to what the known letters give', () => {
    assert.match(parts('declare -iZ x')['-iZ'], /^treat as integer/);
    assert.ok(!/Z/.test(parts('declare -iZ x')['-iZ']));
    assert.strictEqual(bash('declare -iZ x').status, 2);
  });
  it('declare +g: an attribute that has no text for being turned off says nothing of it', () => {
    assert.strictEqual(parts('declare +g x')['+g'], 'Option');
  });
  it('declare -t', () => assert.match(parts('declare -t F')['-t'], /trace/));
  it('unset -n unsets the reference itself', () => {
    const p = parts('unset -n ref');
    assert.match(p['-n'], /name reference itself/);
    assert.match(p.ref, /name reference `ref` itself/);
    assert.strictEqual(bash('a=1; declare -n r=a; unset -n r; declare -p a').stdout, 'declare -- a="1"\n');
  });
});

describe('other options', () => {
  it('are in the dictionary', () => {
    for (const c of ['jobs -l', 'disown -h', 'type -p ls', 'hash -r', 'history -c', 'pwd -L', 'dirs -v', 'enable -n', 'alias -p', 'unalias -a', 'help -s', 'shopt -p']) {
      const label = c.split(' ')[1];
      assert.ok(!/not in the dictionary/.test(parts(c)[label]), c);
    }
  });
});

describe('[ ] and [[ ]] examples', () => {
  it('[ -n $x ] is true for an empty value', () => {
    const tree = parser.parse('[ -n $x ]');
    const e = new Analyzer('en').explainLine(tree, 0);
    const ex = e.examples.find((x) => x.kind === 'test')!;
    assert.deepStrictEqual(ex.sections.map((s) => s.label), ['True when']);
    assert.strictEqual(bash('x=""; [ -n $x ]; echo $?').stdout, '0\n');
  });
  it('[[ != pattern ]] says the right side is a pattern', () => {
    const t = new Analyzer('en').explainLine(parser.parse('[[ $s != a* ]]'), 0);
    assert.match(JSON.stringify(t.items), /glob pattern/);
    assert.strictEqual(bash('[[ abc != a* ]]; echo $?').stdout, '1\n');
  });
});

describe('declaration builtins as plain commands, and related fixes', () => {
  const one = (src: string, shell?: 'sh', lang: 'en' | 'ja' = 'en') => new Analyzer(lang).explainLine(parser.parse(src), 0, shell).items[0];
  const all = (t: Token): Token[] => [t, ...t.children.flatMap(all)];
  it('stay builtins after a prefix assignment', () => {
    for (const c of ['LC_ALL=C export X', 'V=1 declare -x Y', 'V=1 readonly Z', 'V=1 local W', 'V=1 typeset T']) {
      const t = one(c);
      assert.strictEqual(t.kind, 'builtin', c);
      assert.strictEqual(t.name?.runs, 'builtin', c);
    }
    assert.match(one('V=1 declare -x Y').children.find((x) => x.label === '-x')!.explanation, /export/);
  });
  it('-f and -F make the names functions', () => {
    for (const c of ['export -f myfunc', 'declare -F myfunc', 'declare -f myfunc', 'readonly -f myfunc', 'typeset -f myfunc']) {
      assert.match(one(c).children.find((x) => x.label === 'myfunc')!.explanation, /^Function `myfunc`/, c);
    }
    assert.match(one('export myvar').children[0].explanation, /^Variable/);
    // (`local -f g` in a function prints the function `g`, as `declare -f g` does: bash 5.2.)
    assert.match(one('local -f x').children[1].explanation, /^Function `x`/);
    // (`export -n` unexports: the names are variables, not name references.)
    assert.match(one('export -n r=v').children[1].explanation, /^Assign a value to variable `r`/);
  });
  it('an assignment after a name written as a declaration builtin is one, after prefix assignments and redirections too', () => {
    // (bash 5.2 makes the arrays: test/fixtures/probes/state.json.)
    for (const c of ['x=1 declare g=(1 2)', '>o declare g=(1 2)', 'x=1 >o local g=(1 2)']) {
      const g = all(one(c)).find((t) => t.label === 'g=(1 2)')!;
      assert.match(g.explanation, /^Assign a value to variable `g`/, c);
      assert.match(g.children[0].explanation, /^Array/, c);
    }
    assert.strictEqual(bash('x=1 declare g=(1 2); >/dev/null declare h=(3); echo "${g[1]} $h"').stdout, '2 3\n');
    // `\declare` and `command declare`: bash's parser rejects `g=(…)`, and splits `g=$v`.
    assert.notStrictEqual(bash('\\declare g=(1 2)').status, 0);
    assert.match(all(one('\\declare g=$v')).map((t) => t.explanation).join('\n'), /word-split and globbed/);
    assert.strictEqual(bash('v="p q"; \\declare g=$v; echo "$g"').stdout, 'p\n');
    // A word that runs the builtin is still explained as its options and names.
    assert.match(all(one('command declare -x y')).find((t) => t.label === 'y')!.explanation, /^Variable `y`/);
    // `x=1 local y` outside a function fails as `local y` does.
    assert.match(new Analyzer('en').explainLine(parser.parse('x=1 local y'), 0).notes.join('\n'), /can only be used in a function/);
    assert.match(bash('x=1 local y').stderr, /can only be used in a function/);
  });
  it('a name with a subscript is a glob first, unquoted', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'decl-'));
    try {
      fs.writeFileSync(path.join(dir, 'a1'), '');
      // (With a file `a1` there, `declare a[1]` declares `a1`; quoted, it makes `a` an array.)
      assert.strictEqual(bash(`cd ${dir} && declare a[1] && declare -p a1 a 2>&1 | head -1`).stdout, 'declare -- a1\n');
      assert.strictEqual(bash(`cd ${dir} && declare 'a[1]' && declare -p a`).stdout, 'declare -a a\n');
    } finally {
      fs.rmSync(dir, { recursive: true });
    }
    assert.match(one('declare a[1]').children[0].explanation, /^Element `\[1\]` of array `a`\. Unquoted, it is a glob pattern first: if a file matches it, that file's name is declared instead \(write `'a\[1\]'`\)/);
    const word = (src: string, label: string) => new Analyzer('en').explainLine(parser.parse(src), src.split('\n').length - 1).items.flatMap(all).find((t) => t.label === label)!.explanation;
    assert.match(word('shopt -s nullglob; declare a[1]', 'a[1]'), /nullglob makes the word go away and nothing is declared/);
    assert.match(word('shopt -s failglob; declare a[1]', 'a[1]'), /failglob makes it an error \(`no match`\) and nothing is declared/);
    assert.match(word('[ "$x" ] && shopt -s nullglob\ndeclare a[1]', 'a[1]'), /on the paths where nullglob or failglob is on, nothing is declared/);
    assert.match(word('set -f; declare a[@]', 'a[@]'), /^All elements of array `a`$/);
    assert.match(one("declare 'a[1]'").children[0].explanation, /Single-quoted/);
    assert.match(one('declare a[1]', undefined, 'ja').children[0].explanation, /その名前を宣言する/);
  });
  it('a function named like a declaration builtin gets the assignment word whole, and nothing is assigned', () => {
    const f = new Analyzer('en').explainLine(parser.parse('declare() { :; }; declare d=$v'), 0).items.flatMap(all);
    assert.strictEqual(f.find((t) => t.label === 'd=$v')!.explanation, 'Argument $1 to the function. The command name is spelled as a declaration builtin, so this word is expanded as an assignment would be: no word splitting, no globbing. Nothing is assigned');
    assert.strictEqual(bash('declare() { echo "$#:$1"; }; v="p q"; declare d=$v; echo "[$d]"').stdout, '1:d=p q\n[]\n');
    // (With no value, the word is the name and `=`: nothing below it.)
    const empty = new Analyzer('en').explainLine(parser.parse('declare() { :; }; declare e='), 0).items.flatMap(all).find((t) => t.label === 'e=')!;
    assert.deepStrictEqual([empty.children, /Nothing is assigned$/.test(empty.explanation)], [[], true]);
    assert.strictEqual(bash('declare() { echo "$#:$1"; }; declare e=; echo "[${e-unset}]"').stdout, '1:e=\n[unset]\n');
    // A function defined on some paths only, or later than a call that runs first: "if the function runs".
    const maybe = new Analyzer('en').explainLine(parser.parse('[ "$x" ] && declare() { :; }\ndeclare d=$v'), 1).items.flatMap(all);
    assert.match(maybe.find((t) => t.label === 'd=$v')!.explanation, /\. If the function runs, nothing is assigned; otherwise the builtin assigns it$/);
    const later = new Analyzer('en').explainLine(parser.parse('f() { declare G=1; }\nf\ndeclare() { :; }\nf'), 0).items.flatMap(all);
    assert.match(later.find((t) => t.label === 'G=1')!.explanation, /If the function runs, nothing is assigned; otherwise the builtin assigns it$/);
    assert.strictEqual(bash('f() { declare G=1; echo "G=$G"; }; f; declare() { :; }; f').stdout, 'G=1\nG=\n');
  });
  it('`b=(…)` passed to a function named like a declaration builtin, or to `alias`, is assigned as an array', () => {
    // bash 5.2: the array is assigned as the builtin would, and the command gets the name only.
    assert.strictEqual(bash('declare() { echo "$#:$1"; }; declare b=(1 2); builtin declare -p b').stdout, '1:b\ndeclare -a b=([0]="1" [1]="2")\n');
    assert.strictEqual(bash('declare() { :; }; f() { declare c=(3); }; f; builtin declare -p c').status, 1);
    // (`-g` and the other options count: a global `b`, a lowercase `m`.)
    assert.strictEqual(bash('declare() { :; }; f() { declare -g b=(1 2); declare -l m=(X); builtin declare -p m; }; f; builtin declare -p b').stdout, 'declare -al m=([0]="x")\ndeclare -a b=([0]="1" [1]="2")\n');
    // (`export` and `alias`: the variable visible here, the local one in a function that has one.)
    assert.strictEqual(bash('export() { :; }; f() { export c=(3); }; f; declare -p c').stdout, 'declare -a c=([0]="3")\n');
    assert.strictEqual(bash('export() { :; }; f() { local e=0; export e=(1 2); alias e=(3) 2>/dev/null; declare -p e; }; f; declare -p e 2>/dev/null').stdout, 'declare -a e=([0]="3")\n');
    const r = bash('alias c=(1 2); declare -p c');
    assert.match(r.stderr, /alias: c: not found/);
    assert.strictEqual(r.stdout, 'declare -a c=([0]="1" [1]="2")\n');
    const arg = (src: string, line = 0) => new Analyzer('en').explainLine(parser.parse(src), line).items.flatMap(all).find((t) => t.label === 'b=(1 2)')!.explanation;
    assert.strictEqual(arg('declare() { :; }; declare b=(1 2)'), 'Argument $1 to the function. bash assigns the array `b` as `declare` would. In a function, it is a local variable. The function gets only the name `b`');
    assert.strictEqual(arg('declare() { :; }; declare -g b=(1 2)'), 'Argument $2 to the function. bash assigns the array `b` as `declare -g` would: a global variable. The function gets only the name `b`');
    // (The function gets `-g` as $1 and `b` as $2.)
    assert.strictEqual(bash('declare() { echo "$1|$2"; }; declare -g b=(1 2)').stdout, '-g|b\n');
    assert.match(new Analyzer('en').explainLine(parser.parse('f() { :; }; f -x a'), 0).items.flatMap(all).find((t) => t.label === 'a')!.explanation, /^Argument \$2 to the function/);
    assert.match(arg('export() { :; }; export b=(1 2)'), /It is the variable visible here: a local one if there is one, else the global one, with no attribute\./);
    assert.match(arg('[ "$x" ] && declare() { :; }\ndeclare b=(1 2)', 1), /^Argument \$1 to the function\. If the function runs, bash assigns the array `b`.*\. Otherwise the builtin assigns it$/);
    assert.match(arg('alias b=(1 2)'), /^Argument `b=\(1 2\)`\. bash assigns the array `b`\. It is the variable visible here.*\. `alias` gets only the name `b`, and fails: `alias: b: not found`$/);
    assert.match(new Analyzer('ja').explainLine(parser.parse('alias b=(1 2)'), 0).items.flatMap(all).find((t) => t.label === 'b=(1 2)')!.explanation, /not found/);
  });
  it('the status of a declaration hides a substitution in an assignment, however the name is written', () => {
    // (`\local x=$(false)` is 0: the status of `local`.)
    assert.strictEqual(bash('f() { \\local x=$(false); echo $?; }; f').stdout, '0\n');
    for (const src of ['f() {\n\\local x=$(false)\n}', 'f() {\nlocal x=$(false)\n}']) {
      assert.match(new Analyzer('en').explainLine(parser.parse(src), 1).notes.join('\n'), /the status of `local x=\$\(…\)` is that of `local`/, src);
    }
  });
  it('every declaration builtin is tagged, including unset', () => {
    for (const c of ['export a', 'readonly a', 'declare a', 'local a', 'unset a']) assert.strictEqual(one(c).name?.said.short, c.startsWith('declare') || c.startsWith('local') ? ' (builtin)' : ' (special builtin)', c);
  });
  it('>& file redirects stdout and stderr', () => {
    assert.match(one('cmd >& out').explanation, /stdout \(fd 1\) and stderr \(fd 2\)/);
    assert.match(one('cmd >&2').explanation, /^Redirection applied to `cmd`: its stdout \(fd 1\) is redirected/);
    assert.match(one('cmd >& $fd').explanation, /stdout \(fd 1\) is redirected/);
  });
  it('shows $# and $? examples in words', () => {
    const ex = new Analyzer('en').explainLine(parser.parse('[ $# -eq 1 ]'), 0).examples[0];
    assert.deepStrictEqual(ex.sections[0].lines, ['1 argument']);
    const q = new Analyzer('ja').explainLine(parser.parse('[ $? -eq 0 ]'), 0).examples[0];
    assert.match(q.sections[0].lines[0], /終了ステータスが 0/);
  });
  it('an assignment before a special builtin persists in sh and POSIX mode', () => {
    assert.match(one('V=1 :', 'sh').children[0].explanation, /special builtin, so this assignment stays/);
    assert.match(one('V=1 :').children[0].explanation, /only for this command/);
    const posix = new Analyzer('en').explainLine(parser.parse('set -o posix\nV=1 :'), 1).items[0];
    assert.match(posix.children[0].explanation, /stays/);
    assert.match(one('V=1 echo', 'sh').children[0].explanation, /only for this command/);
    assert.strictEqual(bash('f() { V=1 :; }; f; echo "[$V]"').stdout, '[]\n');
    assert.strictEqual(spawnSync('sh', ['-c', 'V=1 :; echo "[$V]"'], { encoding: 'utf8' }).stdout, '[1]\n');
  });
  it('test parses its words like [ ]', () => {
    const t = one('test "$a" = "$b" -a -f x');
    assert.match(t.children[0].explanation, /AND/);
    assert.match(one('test ! -e f').children[0].explanation, /^Negation/);
    assert.match(one('test -f file').children[0].explanation, /regular file/);
    assert.strictEqual(one('test').name?.runs, 'builtin');
  });
  it('test examples', () => {
    const e = new Analyzer('en').explainLine(parser.parse('test -n "$x"'), 0);
    assert.strictEqual(e.examples[0].sections.length, 2);
  });
});

describe('arithmetic takes one element of an array', () => {
  it('`a[@]` and `a[*]` there are an error, as in bash', () => {
    for (const e of ['a[@]', 'a[*]']) {
      assert.match(bash(`a=(1 2); (( ${e} ))`).stderr, /bad array subscript/);
      const t = new Analyzer('en').explainLine(parser.parse(`(( ${e} ))`), 0).items[0].children.find((c) => c.label === e)!;
      assert.strictEqual(t.kind, 'error');
      assert.match(t.explanation, /^Not allowed in arithmetic: `a\[.\]` is an error \(`bad array subscript`\)/);
    }
  });
});
