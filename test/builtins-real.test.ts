// The builtins, compared with bash: which words are text, names, signals, expressions or arguments, as the
// interpreter reads them with the builtin's spec, and what bash does with the same line.
import * as assert from 'assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Analyzer, lookupCommand, Token } from '../src/analyzer';
import { ArgvParse, interpret } from '../src/argv/interpret';
import { shellOptions } from '../src/dict/builtins';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { argWords } from './support/argwords';

const hasBash = spawnSync('bash', ['--norc', '-c', 'true']).status === 0;
/** The C locale: the tests match bash's messages in English. */
const ENV = { ...process.env, LC_ALL: 'C' };
/** What bash prints for `script` (stdout), with `input` on stdin. */
const bash = (script: string, input = ''): string => spawnSync('bash', ['--norc', '-c', script], { input, env: ENV, encoding: 'utf8', timeout: 10000 }).stdout;
const parseOf = (line: string): { parse: ArgvParse; words: string[] } => {
  const { name, words, texts } = argWords(line);
  return { parse: interpret(lookupCommand(name)!, words, { name, lookup: lookupCommand }), words: words.map((w, i) => w.value ?? texts[i]) };
};
/** The words the interpreter reads as operands named `names` (all operands when none are given). */
function operands(line: string, ...names: string[]): string[] {
  const { parse, words } = parseOf(line);
  return parse.roles.flatMap(({ word, role }) => (role.role === 'operand' && (!names.length || names.includes(role.spec?.name ?? '')) ? [words[word]] : []));
}
/** What `printf %s, …` prints for these words. */
const printed = (words: string[]): string => words.map((w) => `${w},`).join('');

(hasBash ? describe : describe.skip)('builtins agree with bash', () => {
  it('echo: the words it prints, and the options it takes', () => {
    for (const line of ['echo a b', 'echo -n a', 'echo -- -n', 'echo -nx a', 'echo -e -E a', 'echo -neE a', 'echo a -n', 'echo - a', 'echo -n -e a -E', 'echo -ee a']) {
      const out = bash(line);
      const text = operands(line, 'TEXT').join(' ');
      assert.strictEqual(out.replace(/\n$/, ''), text, line);
      // `-n` among the options leaves out the newline.
      assert.strictEqual(out.endsWith('\n'), !parseOf(line).parse.roles.some((r) => r.role.role === 'cluster' ? r.role.letters.some((l) => 'flag' in l && l.flag === '-n') : r.role.role === 'option' && r.role.flag === '-n'), line);
    }
  });

  it('set: the positional parameters it sets, and the option names it reads', () => {
    for (const line of ['set a -b', 'set -- a -b', 'set -e a b', 'set -o pipefail x', 'set +o pipefail -- y', 'set -euo pipefail z', 'set -x -- -e', 'set -eu -- -a b', 'set -o noglob -o errexit c']) {
      assert.strictEqual(bash(`${line}; set +ex; printf %s, "$@"`), printed(operands(line)), line);
    }
    // `-o NAME` turns on the options its values name.
    for (const line of ['set -o pipefail', 'set -euo pipefail', 'set -o noglob -o errexit']) {
      const { parse, words } = parseOf(line);
      const names = parse.roles.flatMap(({ word, role }) => (role.role === 'value' ? [words[word]] : []));
      const on = bash(`${line}; set -o`).split('\n').filter((l) => /\bon$/.test(l)).map((l) => l.split(/\s+/)[0]);
      for (const n of names) assert.ok(on.includes(n), `${line}: ${n}`);
    }
  });

  it('read and mapfile: the variables they set', () => {
    for (const line of ['read -r a b', 'read -p P a b', 'read -t 5 -n 9 a b', 'read -d , a b', 'read -rs -- a b', 'read -a arr', 'read -u 0 a', 'mapfile -t -n 2 arr', 'readarray -d , arr', 'mapfile -s 1 -O 3 arr']) {
      const { parse, words } = parseOf(line);
      const names = parse.roles.flatMap(({ word, role }) => (role.role === 'operand' || (role.role === 'value' && /^-a$/.test(role.of)) ? [words[word]] : []));
      assert.ok(names.length, line);
      const set = bash(`${line} <<< 'x,y z'; for v in ${names.join(' ')}; do declare -p "$v" >/dev/null 2>&1 && printf %s, "$v"; done`);
      assert.strictEqual(set, printed(names), line);
    }
  });

  it('declare, local, export and readonly: the names they declare', () => {
    for (const line of ['declare -i a=1 b', 'declare -a arr', 'declare +x a=1', 'declare -- a b', 'typeset -r a', 'export -n a=1', 'export a=1 b', 'readonly -a arr', 'local -i a=1 b']) {
      // (Alone, these are declaration commands; their words are read with the builtin's spec all the same.)
      const [kw, ...rest] = line.split(' ');
      const { words, texts } = argWords(`: ${rest.join(' ')}`);
      const parse = interpret(lookupCommand(kw)!, words, { name: kw, lookup: lookupCommand });
      const names = parse.roles.flatMap(({ word, role }) => (role.role === 'operand' && role.spec?.name === 'NAME' ? [texts[word].replace(/=.*/, '')] : []));
      assert.ok(names.length, line);
      const script = line.startsWith('local') ? `f() { ${line}; declare -p ${names.join(' ')}; }; f` : `${line}; declare -p ${names.join(' ')}`;
      assert.strictEqual(bash(`${script} 2>&1 | grep -c '^declare'`).trim(), String(names.length), line);
    }
  });

  it('declare, local, export and readonly: what the explanation shows', () => {
    const parser = createUnbashParser();
    /** The token of the first command of line `line` (from 0) of `script`. */
    const top = (script: string, line = 0): Token => new Analyzer('en').explainLine(parser.parse(script), line).items[0];
    const shown = (script: string): Token[] => top(script).children;
    const kinds = (line: string) => shown(line).map((t) => `${t.label} ${t.kind}`);
    // `--` ends the options; a word after it, or after a name, is a name (bash: "not a valid identifier").
    assert.deepStrictEqual(kinds('declare -- x=1'), ['-- option', 'x=1 assignment']);
    assert.match(shown('declare -- x=1')[0].explanation, /^End of options/);
    assert.match(bash('declare -- x=1; declare -p x'), /^declare -- x="1"/);
    assert.deepStrictEqual(kinds('export -- A=1'), ['-- option', 'A=1 assignment']);
    assert.match(bash('export -- A=1; declare -p A'), /^declare -x A="1"/);
    for (const line of ['declare -x -- -i', 'declare y -i']) {
      assert.deepStrictEqual(kinds(line).pop(), '-i variable', line);
      assert.match(bash(`${line} 2>&1`), /`-i': not a valid identifier/, line);
    }
    // `declare y -i` gives `y` no integer attribute: `y=1+1` stays text.
    assert.strictEqual(bash('declare y -i 2>/dev/null; y=1+1; echo $y'), '1+1\n');
    assert.doesNotMatch(top('declare y -i\ny=1+1', 1).explanation, /integer/);
    assert.strictEqual(bash('declare -i -- z=1+1; echo $z'), '2\n');
    assert.match(top('declare -i -- z=1+1').children[2].explanation, /integer/);
  });

  it('kill -l and -L: the operands are signals to translate', () => {
    for (const line of ['kill -l 15 9', 'kill -l TERM', 'kill -L 2']) {
      const signals = operands(line, 'SIGNAL');
      assert.strictEqual(signals.length, line.split(' ').length - 2, line);
      assert.strictEqual(bash(line).trim().split('\n').length, signals.length, line);
    }
  });

  it('kill: the signal a word names, as `-NAME`, `-N`, `-s NAME` or `-n N` (`-sigint` is `-s igint`)', () => {
    for (const word of ['-term', '-Term', '-SIGTERM', '-SIGint', '-sigint', '-sigterm', '-sINT', '-sint', '-n9', '-9', '-kill', '-hup', '-usr1', '-sUSR1', '-sHUP']) {
      const { parse } = parseOf(`kill ${word} 1`);
      const r = parse.roles[0].role;
      // The signal the interpreter reads: from the pattern, or the value attached to `-s` or `-n`.
      // (`-9` and `-KILL` are options of their own.)
      const named = r.role === 'pattern-option' ? /^-(?:sig)?(.*)$/i.exec(word)![1] : r.role === 'option' && r.flag === word ? word.slice(1) : word.slice(2);
      // Job control keeps SIGINT for the background job (bash ignores it there otherwise), and only
      // a refused signal is followed by `kill -9`, so no second signal races the first.
      const out = spawnSync('bash', ['--norc', '-c', `set -m; sleep 5 & kill ${word} $! 2>&1 || kill -9 $!; wait $!; echo $?`], { env: ENV, encoding: 'utf8' }).stdout;
      const valid = spawnSync('bash', ['--norc', '-c', `kill -l ${named}`]).status === 0;
      assert.strictEqual(/invalid signal/.test(out), !valid, word);
      // The process ends with 128 + the signal's number.
      if (valid) assert.strictEqual(String(Number(out.trim().split('\n').pop()) - 128), /^\d+$/.test(named) ? named : bash(`kill -l ${named}`).trim(), word);
    }
  });

  it('kill: `-s9` and `-nTERM` are one refused signal spec; with `-l`, a signal option sends nothing', () => {
    for (const word of ['-s9', '-s1', '-nTERM', '-nint', '-s-1']) {
      const { parse } = parseOf(`kill ${word} 1`);
      assert.strictEqual(parse.roles[0].role.role, 'pattern-option', word);
      assert.match(spawnSync('bash', ['--norc', '-c', `kill ${word} 1`], { env: ENV, encoding: 'utf8' }).stderr, /invalid signal specification/, word);
    }
    // With `-l` the words `-15` and `-TERM` are options that do nothing, and the list is printed whole.
    for (const word of ['-15', '-TERM']) {
      const { parse } = parseOf(`kill -l ${word}`);
      assert.match((parse.roles[1].role as { text: { en: string } }).text.en, /^No signal is sent/, word);
      assert.ok(bash(`kill -l ${word}`).split('\n').length > 5, word);
    }
    assert.match((parseOf('kill -15 1').parse.roles[0].role as { text: { en: string } }).text.en, /^Send signal number 15/);
    // A pattern option with no text for the mode keeps its own.
    assert.match((parseOf('kill -l -s9').parse.roles[1].role as { text: { en: string } }).text.en, /^Invalid/);
  });

  it('pushd, popd and dirs: `+N` and `-N` are places in the stack, not options', () => {
    const stack = 'mkdir -p /tmp/be-a /tmp/be-b; cd /tmp; pushd /tmp/be-a >/dev/null; pushd /tmp/be-b >/dev/null;';
    for (const line of ['pushd +1', 'pushd -1', 'popd +1', 'popd -2', 'dirs +0', 'dirs -0', 'dirs -p +2']) {
      const { parse } = parseOf(line);
      assert.strictEqual(parse.roles.at(-1)!.role.role, 'pattern-option', line);
      const run = spawnSync('bash', ['--norc', '-c', `${stack} ${line}`], { env: ENV, encoding: 'utf8' });
      assert.strictEqual(run.status, 0, line);
      assert.strictEqual(run.stderr, '', line);
    }
    // Out of the stack's range bash complains about the number, so it was read as one.
    assert.match(spawnSync('bash', ['--norc', '-c', `${stack} pushd +9`], { env: ENV, encoding: 'utf8' }).stderr, /directory stack index/);
  });

  it('shopt -o: the names are those of `set -o`, and the ones the dictionary explains are all known to bash', () => {
    const parser = createUnbashParser();
    const children = (script: string): Token[] => new Analyzer('en').explainLine(parser.parse(script), 0).items[0].children;
    for (const name of Object.keys(shellOptions)) {
      assert.strictEqual(spawnSync('bash', ['--norc', '-c', `shopt -qo ${name}`]).status! < 2, true, name);
    }
    const [opt, errexit, other] = children('shopt -o errexit nullglob');
    assert.strictEqual(opt.label, '-o');
    assert.match(errexit.explanation, /^Shell option `errexit`: exit immediately/);
    assert.doesNotMatch(other.explanation, /^Shell option/);
    // Without `-o`, `errexit` is no shopt name.
    assert.match(spawnSync('bash', ['--norc', '-c', 'shopt errexit'], { env: ENV, encoding: 'utf8' }).stderr, /invalid shell option name/);
    assert.match(children('shopt -s extglob')[1].explanation, /^Shell option `extglob`/);
  });

  it('jobs -x: the rest is a command run in this shell, with the job specs replaced', () => {
    for (const line of ['jobs -x echo %1', 'jobs -x -l f %1']) {
      const role = parseOf(line).parse.roles.at(-1)!.role;
      assert.strictEqual(role.role, 'command', line);
    }
    assert.match(bash('set -m; f() { echo "fn:$1"; }; sleep 5 & jobs -x f %1 | grep -c "^fn:[0-9]*$"; kill %1'), /^1\n/);
    // Without `-x` the words are job specs.
    assert.strictEqual(parseOf('jobs -l %1').parse.roles.at(-1)!.role.role, 'operand');
  });

  it('exit, return, shift, break and continue: a number, even with a `-`', () => {
    assert.deepStrictEqual(operands('exit -1'), ['-1']);
    assert.strictEqual(spawnSync('bash', ['--norc', '-c', 'exit -1']).status, 255);
    assert.deepStrictEqual(operands('return -- 4'), ['4']);
    assert.strictEqual(bash('f() { return -- 4; }; f; echo $?'), '4\n');
    for (const line of ['shift -1', 'break -1', 'continue -x']) {
      assert.deepStrictEqual(operands(line), [line.split(' ')[1]], line);
      assert.match(spawnSync('bash', ['--norc', '-c', `for i in 1; do ${line}; done`], { env: ENV, encoding: 'utf8' }).stderr, /out of range|numeric argument/, line);
    }
  });

  it('trap: the action and the signals', () => {
    for (const line of ["trap 'echo x' INT TERM", 'trap -- : USR1', "trap '' HUP", 'trap - INT']) {
      const signals = operands(line, 'SIGNAL');
      // `trap - INT` resets: nothing is left to print.
      const listed = bash(`trap ':' INT; ${line}; trap -p`).trim().split('\n').filter(Boolean).map((l) => l.replace(/^trap -- .* /, ''));
      if (operands(line, 'ACTION')[0] === '-') assert.deepStrictEqual(listed, [], line);
      else assert.deepStrictEqual(listed.filter((s) => s !== 'SIGINT' || signals.includes('INT')).sort(), signals.map((s) => `SIG${s}`).sort(), line);
    }
    // `trap INT`: one word is a signal, reset to its default.
    assert.deepStrictEqual(operands('trap INT', 'SIGNAL'), ['INT']);
    assert.strictEqual(bash("trap ':' INT; trap INT; trap -p"), '');
    // `trap 1 2`, `trap 1 INT`: a signal number first makes every word a signal, reset (`65` is no signal: an action).
    for (const line of ['trap 1 2', 'trap 1 INT', 'trap 01 INT HUP', 'trap 65 INT']) {
      const reset = operands(line, 'ACTION').length === 0;
      assert.strictEqual(bash(`trap ':' INT HUP; ${line}; trap -p INT HUP`).includes("trap -- ':'"), !reset, line);
    }
    // `trap -p INT`: the operands are signals to show.
    assert.deepStrictEqual(operands('trap -p INT TERM', 'SIGNAL'), ['INT', 'TERM']);
    assert.strictEqual(bash("trap ':' INT TERM; trap -p INT TERM").trim().split('\n').length, 2);
  });

  it('let: every operand is an expression, `-` words too; `--` ends the options', () => {
    // (bash evaluates `-a` and `-x`: the status says whether the last one is 0.)
    for (const [line, values] of [['let a=1 b=a+2', '1,3'], ['let -- a=3', '3,'], ['let a=4 -a', '4,'], ['let a=2 -a -1+a', '2,']]) {
      const exprs = operands(line, 'EXPR');
      assert.deepStrictEqual(exprs, line.split(' ').slice(1).filter((w) => w !== '--'), line);
      assert.strictEqual(bash(`${line}; echo $a,$b`), `${values}\n`, line);
    }
    assert.strictEqual(spawnSync('bash', ['--norc', '-c', 'let -x']).status, 1);
    assert.deepStrictEqual(operands('let -x'), ['-x']);
  });

  it('getopts, printf -v and source: the name, the format and the arguments', () => {
    assert.deepStrictEqual(operands('getopts ab: o -a', 'NAME'), ['o']);
    assert.strictEqual(bash('getopts ab: o -a; echo $o'), 'a\n');
    assert.deepStrictEqual(operands('printf -v v %s, a b', 'FORMAT'), ['%s,']);
    assert.strictEqual(bash('printf -v v %s, a b; echo "$v"'), 'a,b,\n');
    const file = path.join(os.tmpdir(), `bash-explainer-source-${process.pid}.sh`);
    fs.writeFileSync(file, 'printf %s, "$@"');
    try {
      for (const name of ['source', '.']) {
        const line = `${name} ${file} a -b`;
        assert.deepStrictEqual(operands(line, 'FILE'), [file], line);
        assert.strictEqual(bash(line), printed(operands(line, 'ARG')), line);
      }
    } finally {
      fs.rmSync(file, { force: true });
    }
  });
});
