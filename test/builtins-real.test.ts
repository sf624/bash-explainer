// The builtins, compared with bash: which words are text, names, signals, expressions or arguments, as the
// interpreter reads them with the builtin's spec, and what bash does with the same line.
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Analyzer, lookupCommand, Token } from '../src/analyzer';
import { ArgRole, ArgvParse, interpret } from '../src/argv/interpret';
import { builtins, shellOptions } from '../src/dict/builtins';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { argWords } from './support/argwords';
import { runBash } from './support/bash';

const hasBash = runBash('true').status === 0;
/** What bash prints for `script` (stdout), with `input` on stdin (the C locale: the tests match bash's messages in English). */
const bash = (script: string, input = ''): string => runBash(script, { input }).stdout;
const parseOf = (line: string): { parse: ArgvParse; words: string[] } => {
  const { name, words, texts } = argWords(line);
  return { parse: interpret(lookupCommand(name)!, words, { name, lookup: lookupCommand }), words: words.map((w, i) => w.value ?? texts[i]) };
};
/** The words the interpreter reads as operands named `names` (all operands when none are given). */
function operands(line: string, ...names: string[]): string[] {
  const { parse, words } = parseOf(line);
  // (trap's action is a command slot: a string this shell runs later.)
  const name = (role: ArgRole): string | undefined => (role.role === 'operand' ? role.spec?.name ?? '' : role.role === 'command' ? role.item?.name : undefined);
  return parse.roles.flatMap(({ word, role }) => (name(role) !== undefined && (!names.length || names.includes(name(role)!)) ? [words[word]] : []));
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
      const out = runBash(`set -m; sleep 5 & kill ${word} $! 2>&1 || kill -9 $!; wait $!; echo $?`).stdout;
      const valid = runBash(`kill -l ${named}`).status === 0;
      assert.strictEqual(/invalid signal/.test(out), !valid, word);
      // The process ends with 128 + the signal's number.
      if (valid) assert.strictEqual(String(Number(out.trim().split('\n').pop()) - 128), /^\d+$/.test(named) ? named : bash(`kill -l ${named}`).trim(), word);
    }
  });

  it('kill: `-s9` and `-nTERM` are one refused signal spec; with `-l`, a signal option sends nothing', () => {
    for (const word of ['-s9', '-s1', '-nTERM', '-nint', '-s-1']) {
      const { parse } = parseOf(`kill ${word} 1`);
      assert.strictEqual(parse.roles[0].role.role, 'pattern-option', word);
      assert.match(runBash(`kill ${word} 1`).stderr, /invalid signal specification/, word);
    }
    // With `-l` the words `-15` and `-TERM` are options that do nothing, and the list is printed whole.
    for (const word of ['-15', '-TERM', '-9', '-KILL', '-0', '-s HUP', '-sHUP', '-n 9', '-nINT']) {
      const { parse } = parseOf(`kill -l ${word}`);
      assert.match((parse.roles[1].role as { text: { en: string } }).text.en, /^(No signal is sent|Invalid)/, word);
      if (word !== '-nINT') assert.match((parse.roles[1].role as { text: { en: string } }).text.en, /^No signal is sent/, word);
      assert.ok(bash(`kill -l ${word}`).split('\n').length > 5, word);
    }
    // Once a signal is given, `-s9` is a process ID, which bash refuses as such.
    assert.strictEqual(parseOf('kill -9 -s9 1').parse.roles[1].role.role, 'operand');
    assert.match(runBash('kill -9 -s9 1').stderr, /arguments must be process or job IDs/);
    assert.match((parseOf('kill -15 1').parse.roles[0].role as { text: { en: string } }).text.en, /^Send signal number 15/);
    // A pattern option with no text for the mode keeps its own.
    assert.match((parseOf('kill -l -s9').parse.roles[1].role as { text: { en: string } }).text.en, /^Invalid/);
  });

  it('pushd, popd and dirs: `+N` and `-N` are places in the stack, not options', () => {
    const stack = 'mkdir -p /tmp/be-a /tmp/be-b; cd /tmp; pushd /tmp/be-a >/dev/null; pushd /tmp/be-b >/dev/null;';
    for (const line of ['pushd +1', 'pushd -1', 'popd +1', 'popd -2', 'dirs +0', 'dirs -0', 'dirs -p +2']) {
      const { parse } = parseOf(line);
      assert.strictEqual(parse.roles.at(-1)!.role.role, 'pattern-option', line);
      const run = runBash(`${stack} ${line}`);
      assert.strictEqual(run.status, 0, line);
      assert.strictEqual(run.stderr, '', line);
    }
    // Out of the stack's range bash complains about the number, so it was read as one.
    assert.match(runBash(`${stack} pushd +9`).stderr, /directory stack index/);
  });

  it('shopt -o: the names are those of `set -o`, and the ones the dictionary explains are all known to bash', () => {
    const parser = createUnbashParser();
    const children = (script: string): Token[] => new Analyzer('en').explainLine(parser.parse(script), 0).items[0].children;
    for (const name of Object.keys(shellOptions)) {
      assert.strictEqual(runBash(`shopt -qo ${name}`).stderr, '', name);
    }
    const [opt, errexit, other] = children('shopt -o errexit nullglob');
    assert.strictEqual(opt.label, '-o');
    assert.match(errexit.explanation, /^Shell option `errexit`: exit immediately/);
    assert.doesNotMatch(other.explanation, /^Shell option/);
    // Without `-o`, `errexit` is no shopt name.
    assert.match(runBash('shopt errexit').stderr, /invalid shell option name/);
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
    assert.strictEqual(runBash('exit -1').status, 255);
    assert.deepStrictEqual(operands('return -- 4'), ['4']);
    assert.strictEqual(bash('f() { return -- 4; }; f; echo $?'), '4\n');
    for (const line of ['shift -1', 'break -1', 'continue -x']) {
      assert.deepStrictEqual(operands(line), [line.split(' ')[1]], line);
      assert.match(runBash(`for i in 1; do ${line}; done`).stderr, /out of range|numeric argument/, line);
    }
  });

  it('trap: the action and the signals', () => {
    for (const line of ["trap 'echo x' INT TERM", 'trap -- : USR1', "trap '' HUP", 'trap - INT']) {
      const signals = operands(line, 'SIGNAL');
      // `trap - INT` resets: nothing is left to print.
      const listed = bash(`trap ':' INT; ${line}; trap -p`).trim().split('\n').filter(Boolean).map((l) => l.replace(/^trap -- .* /, ''));
      if (operands(line, 'RESET').length) assert.deepStrictEqual(listed, [], line);
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
    assert.strictEqual(runBash('let -x').status, 1);
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

/** The option words a usage line of `help -s` names (`-abc` and `[-a]` give `-a`…; `+o`), without its placeholders. */
function usageOptions(usage: string): Set<string> {
  const out = new Set<string>();
  // (`-sigspec` of kill and `-N` of the directory stack are placeholders.)
  for (const m of usage.replace(/-sigspec|[+-]N(?=\s*[\]|])/g, '').matchAll(/(?<=^|[\s[|])([+-])([A-Za-z@]+)(?![\w-])/g)) {
    for (const l of m[2]) out.add(`${m[1] === '+' && m[2] === 'o' ? '+' : '-'}${l}`);
  }
  return out;
}

/**
 * The options of the specs that bash's usage line does not show, with why: each other option must be in both
 * (docs/design/trust-allow-list.md, section 5).
 */
const NOT_IN_USAGE: Record<string, string[]> = {
  // (Signals given as options: `kill -9`; and `-L`, which is `-l`.)
  kill: ['-9', '-KILL', '-L', '-0'],
  // (`local [option]`: the options of `declare`.)
  local: ['-a', '-A', '-i', '-r', '-x', '-l', '-u', '-n', '-t', '-g', '-f', '-F', '-p', '-I'],
  // (`set --` ends the options.)
  set: ['--'],
};
/** Letters the usage shows that Linux lacks: bash says "invalid option" there. */
const NOT_ON_LINUX: Record<string, string[]> = { ulimit: ['-k', '-P', '-T'], cd: ['-@'] };

(hasBash ? describe : describe.skip)('the options of the builtins against bash', () => {
  const programs = ['bash', ...(process.env.BASH_EXPLAINER_BASH53 ? [process.env.BASH_EXPLAINER_BASH53] : [])];
  for (const program of programs) {
    it(`every option of ${program === 'bash' ? 'bash' : 'bash 5.3'}'s usage of each builtin is in its spec, and no other`, () => {
      const release = runBash('echo "${BASH_VERSINFO[0]}.${BASH_VERSINFO[1]}"', { program }).stdout.trim();
      const names = runBash('compgen -b', { program }).stdout.trim().split('\n');
      assert.strictEqual(names.length, 61, program);
      const wrong: string[] = [];
      for (const name of names) {
        const spec = builtins[name];
        assert.ok(spec, `${name} has a spec`);
        // (`test` and `[` read their operands as an expression: their "options" are its operators.)
        if (spec.operandParser === 'test-expression') continue;
        const usage = runBash(`help -s ${name}`, { program }).stdout;
        const shown = usageOptions(usage.replace(/^[^:]*:/, ''));
        const known = new Set((spec.options ?? []).filter((o) => !o.since || release >= o.since).flatMap((o) => o.names));
        const missing = [...shown].filter((o) => !known.has(o) && !(NOT_ON_LINUX[name] ?? []).includes(o));
        const extra = [...known].filter((o) => !shown.has(o) && !(NOT_IN_USAGE[name] ?? []).includes(o));
        if (missing.length || extra.length) wrong.push(`${name}: missing ${missing.join(' ')}; not in the usage ${extra.join(' ')} (${usage.trim()})`);
      }
      assert.deepStrictEqual(wrong, []);
      // (The letters Linux lacks are refused: they stay out of the specs.)
      for (const [name, flags] of Object.entries(NOT_ON_LINUX)) {
        for (const f of flags) assert.match(runBash(`${name} ${f} /`, { program }).stderr, /invalid option/, `${name} ${f}`);
      }
    });
  }

  it('complete, compgen, compopt, cd, ulimit and declare -I: what the options do', () => {
    // The kinds of candidates, and what is done to them, as `complete -p` prints them back (`-A file` is `-f`).
    assert.strictEqual(bash("complete -a -b -c -d -e -g -j -k -s -u -v -A file -G '*' -X a -P p -S s y; complete -p y"),
      "complete -a -b -c -d -e -f -g -j -k -s -u -v -G '*' -P 'p' -S 's' -X 'a' y\n");
    assert.strictEqual(bash('complete -D -o nospace; complete -E -W x; complete -I -W y; complete -p -D; complete -p -E; complete -p -I'), "complete -o nospace -D\ncomplete -W 'x' -E\ncomplete -W 'y' -I\n");
    // (`-G`, `-X`, `-P` and `-S` take their words as text; `-F` runs its function in this shell.)
    assert.strictEqual(bash("u=1; compgen -G '$((u=2))'; compgen -X '!a*' -P '$((u=3))' -S '>' -W 'a b'; echo $u"), '$((u=3))a>\n1\n');
    assert.strictEqual(bash('f() { u=2; COMPREPLY=(x); }; u=1; compgen -F f 2>/dev/null; echo $u'), 'x\n2\n');
    assert.doesNotMatch(runBash('compopt -D -o nospace; compopt -E +o nospace; compopt -I -o nospace').stderr, /invalid option/);
    assert.strictEqual(bash('cd -P -e / && pwd; ulimit -R'), '/\nunlimited\n');
    // `declare -I` (and `local -I`) in a function: the local variable starts with the value and attributes outside.
    assert.strictEqual(bash('f() { local -I x; declare -I y=1+1; echo "$x $y"; }; x=5; declare -i y; f'), '5 2\n');
    const parser = createUnbashParser();
    for (const [line, flag, re] of [['complete -u -X x c', '-u', /^user names$/], ['compgen -P p -W w', '-P', /^text to put before each candidate$/],
      ['compopt -D -o nospace', '-D', /default completion/], ['cd -P -e /', '-e', /with `-P`/], ['ulimit -R', '-R', /real-time/], ['declare -I x', '-I', /starts with the value/]] as const) {
      const t = new Analyzer('en').explainLine(parser.parse(line), 0).items[0].children.find((c) => c.label === flag)!;
      assert.match(t.explanation, re, line);
    }
  });
});
