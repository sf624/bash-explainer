// The wrappers and shells, compared with the real tools: which words go to the command a wrapper runs,
// which are the shell's `$0` and `$1`…, and which are names or users. Each command runs `printf %s,`, so
// its output lists the words it got. Tools that are missing are skipped.
import * as assert from 'assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { lookupCommand } from '../src/analyzer';
import { splitEnvString } from '../src/argv/envsplit';
import { ArgRole, ArgvParse, ArgWord, interpret, ValueRole } from '../src/argv/interpret';
import { argWords } from './support/argwords';

const has = (tool: string): boolean => spawnSync('bash', ['--norc', '-c', `command -v ${tool}`]).status === 0;
/** The C locale: the tests match the tools' messages in English. */
const ENV = { ...process.env, LC_ALL: 'C' };
/** The builds whose options the rows follow (`--version` says which); a BSD or macOS build is skipped. */
const BUILDS: Record<string, RegExp> = { timeout: /GNU coreutils/, env: /GNU coreutils/, nice: /GNU coreutils/, flock: /util-linux/, xargs: /GNU findutils/ };
const usable = (tool: string): boolean => has(tool) && (!BUILDS[tool] || BUILDS[tool].test(spawnSync(tool, ['--version'], { env: ENV, encoding: 'utf8' }).stdout ?? ''));
const run = (line: string, input = ''): { out: string; err: string } => {
  const r = spawnSync('bash', ['--norc', '-c', line], { input, env: ENV, encoding: 'utf8', timeout: 10000 });
  return { out: r.stdout, err: r.stderr };
};
const parseOf = (line: string): { parse: ArgvParse; words: string[] } => {
  const { name, words, texts } = argWords(line);
  // (`{}` is a word of its own; its value is not taken as known.)
  return { parse: interpret(lookupCommand(name)!, words, { name, lookup: lookupCommand }), words: words.map((w: ArgWord, i) => w.value ?? texts[i]) };
};
/** The words of the command that the line runs, as the interpreter reads them (the first command slot). */
function ran(line: string): string[] {
  const { parse, words } = parseOf(line);
  const find = (p: ArgvParse): string[] | undefined => {
    for (const { word, role } of p.roles) {
      if (role.role === 'command' && role.parse) return words.slice(word, role.parse.end);
      if (role.role === 'subcommand') return find(role.parse);
    }
    return undefined;
  };
  const out = find(parse);
  assert.ok(out, `no command in ${line}`);
  return out;
}
/** The words of the line whose operands are named `names`, in order. */
function operands(line: string, names: string[]): string[] {
  const { parse, words } = parseOf(line);
  return parse.roles.flatMap(({ word, role }) => (role.role === 'operand' && role.spec && names.includes(role.spec.name) ? [words[word]] : []));
}
/** What `printf %s, …` prints for the words after its format. */
const printed = (words: string[]): string => words.map((w) => `${w},`).join('');

describe('wrappers agree with the real tools', () => {
  const lock = path.join(os.tmpdir(), `bash-explainer-flock-${process.pid}`);
  after(() => fs.rmSync(lock, { force: true }));

  // [line, input]: the command gets the words the interpreter gives it.
  const ROWS: Record<string, string[]> = {
    timeout: [
      'timeout -k 5 10 printf %s, -h x',
      'timeout --signal=KILL 2 printf %s, -s 9',
      'timeout -sKILL 2 printf %s, a',
      'timeout 5 printf %s, --foreground',
      // Options the dictionary lacked, and long options written as a unique prefix (getopt_long).
      'timeout --foreground -v --preserve-status 5 printf %s, -v',
      'timeout --sig KILL 2 printf %s, a',
      'timeout --kill 1 2 printf %s, a',
      'timeout --fore 2 printf %s, a',
    ],
    env: [
      'env -i A=1 printf %s, -i',
      'env -u HOME printf %s, x',
      'env -iu HOME printf %s, a',
      'env A=1 B=2 printf %s, A=3',
      'env -- printf %s, -u',
      // Long options written as a unique prefix (getopt_long), and `env -` (same as `-i`).
      'env --ignore-e --deb printf %s, a',
      'env - printf %s, -i',
      // A string of options and assignments only: the command is after it.
      "env -S-i A=1 printf %s, a", "env -S'A=1' printf %s, -i", "env -S'-u HOME -i' B=2 printf %s, x", "env --split-string='-i A=1' printf %s, y",
    ],
    stdbuf: [
      'stdbuf -oL printf %s, -o',
      'stdbuf --out=L --err 0 printf %s, a',
    ],
    nice: [
      'nice -n 5 printf %s, -n',
      'nice -5 printf %s, a',
      'nice --adjustment=3 printf %s, a',
      'nice --adj 3 printf %s, a',
      'nice printf %s, -n 3',
    ],
    flock: [
      `flock ${lock} printf %s, -n`,
      `flock -n ${lock} printf %s, a`,
      `flock -w 1 ${lock} printf %s, a`,
      `flock --nonb --wai 1 ${lock} printf %s, a`,
    ],
    exec: [
      'exec -a name printf %s, a',
      'exec -c printf %s, -a',
      'exec -l printf %s, -l',
      'exec -- printf %s, x',
    ],
    command: [
      'command printf %s, -v',
      'command -p printf %s, a',
    ],
  };
  for (const [tool, rows] of Object.entries(ROWS)) {
    (usable(tool) ? it : it.skip)(`${tool}: the words of the command it runs`, () => {
      for (const line of rows) {
        const words = ran(line);
        assert.deepStrictEqual(words.slice(0, 2), ['printf', '%s,'], line);
        assert.strictEqual(run(line).out, printed(words.slice(2)), line);
      }
    });
  }

  (usable('xargs') ? it : it.skip)('xargs: the words of the command, and the input after them (or in place of `{}`)', () => {
    for (const line of ['xargs --max-a 1 printf %s, a', 'xargs --no-r printf %s, b', 'xargs printf %s, -0', 'xargs -n 1 printf %s, a', 'xargs -r printf %s, -r', 'xargs -I{} printf %s, {} b', 'xargs -i printf %s, {} b', 'xargs -d , printf %s, a', 'xargs -L 1 printf %s, -L']) {
      const words = ran(line).slice(2);
      const replaces = /-I\{\}|-i /.test(line);
      assert.strictEqual(run(line, 'z').out, printed(replaces ? words.map((w) => (w === '{}' ? 'z' : w)) : [...words, 'z']), line);
    }
  });

  // The long options a tool lists in `--help`: with them all in the entry, a prefix that the tool finds
  // ambiguous is ambiguous here too.
  const longNames = (help: string): string[] => [...new Set(help.split('\n').filter((l) => /^\s+-/.test(l)).flatMap((l) => l.match(/--[a-z][a-z0-9-]*/g) ?? []))];
  for (const tool of ['timeout', 'env', 'nice', 'xargs', 'stdbuf', 'flock', 'sudo']) {
    (usable(tool) ? it : it.skip)(`${tool}: every long option of --help, and the prefixes it finds ambiguous`, () => {
      const spec = lookupCommand(tool)!;
      assert.strictEqual(spec.parser, 'getopt_long', tool);
      const ours = spec.options!.flatMap((o) => o.names);
      const theirs = longNames(spawnSync(tool, ['--help'], { env: ENV, encoding: 'utf8' }).stdout);
      assert.ok(theirs.length > 2, tool);
      assert.deepStrictEqual(theirs.filter((n) => !ours.includes(n)), [], tool);
    });
  }
  const AMBIGUOUS: Record<string, string> = {
    timeout: 'timeout --v 1 true', env: 'env --ig true', flock: 'flock --no /tmp/x true', sudo: 'sudo --pre true', xargs: 'xargs --max true',
  };
  for (const [tool, line] of Object.entries(AMBIGUOUS)) {
    (usable(tool) ? it : it.skip)(`${tool}: an ambiguous prefix is no option: ${line}`, () => {
      assert.match(run(line, '').err, /is ambiguous/, line);
      const { parse } = parseOf(line);
      const role = parse.roles[0].role;
      assert.strictEqual(role.role, 'unknown-option', line);
      // It lists the options the tool lists (one name of each; flock says `--nonblocking` where the entry's first name is `--nonblock`).
      const theirs = [...run(line, '').err.matchAll(/'(--[\w-]+)'/g)].map((m) => m[1]).slice(1);
      const ours = role.role === 'unknown-option' ? role.ambiguous ?? [] : [];
      assert.strictEqual(ours.length, theirs.length, line);
      assert.ok(ours.every((n) => theirs.some((t) => t.startsWith(n))), `${line}: ${ours} / ${theirs}`);
    });
  }

  // `env -v` says how it splits a `-S` string ("into: 'a' & 'b'"), and the words of the command it runs
  // ("arg[0]= 'a'"), before it tries to run it: the commands need not exist.
  /** env's quoting of a word in its messages: `'a\'b'`, with C escapes. */
  const unquoted = (q: string): string => q.slice(1, -1).replace(/\\(.)/g, (_, c: string) => ({ t: '\t', n: '\n', r: '\r', v: '\v', f: '\f' } as Record<string, string>)[c] ?? c);
  const verbose = (line: string): { split: string[]; argv?: string[]; reset: boolean; status: number | null; err: string } => {
    const r = spawnSync('bash', ['--norc', '-c', line.replace(/^env /, 'env -v ')], { env: { ...ENV, HOME: '/h' }, encoding: 'utf8', timeout: 10000 });
    const lines = r.stderr.split('\n');
    const split = lines.flatMap((l) => { const m = /^ (?:into:|    &)    ('.*')$/.exec(l); return m ? [unquoted(m[1])] : []; });
    const exec = lines.findIndex((l) => l.startsWith('executing: '));
    const argv = exec < 0 ? undefined : lines.slice(exec + 1).flatMap((l) => { const m = /^   arg\[\d+\]= ('.*')$/.exec(l); return m ? [unquoted(m[1])] : []; });
    return { split, argv, reset: lines.includes('cleaning environ'), status: r.status, err: r.stderr };
  };
  /** The words of the command the line runs, as the interpreter reads them: after the line, or started in a `-S` string. */
  const runs = (line: string): { argv?: string[]; reset: boolean } => {
    const { parse, words } = parseOf(line);
    const splitOf = (role: ArgRole): ValueRole | undefined => {
      const value = role.role === 'value' ? role : role.role === 'option' ? role.value : role.role === 'cluster' ? role.letters.map((l) => (l.role === 'option' ? l.value : undefined)).find((v) => v?.split) : undefined;
      return value?.split ? value : undefined;
    };
    // `rest`: the words after the string, which a command started in it takes.
    const inSplit = (v: ValueRole, rest: string[]): { argv?: string[]; reset: boolean } | undefined => {
      const ws = v.split!.words.map((w) => w.value ?? '?');
      for (const { word, role } of v.split!.roles) {
        if (role.role === 'command') return { argv: [...ws.slice(word), ...rest], reset: role.slot.env === 'reset' };
        const inner = splitOf(role);
        const r = inner && inSplit(inner, [...ws.slice(word + 1), ...rest]);
        if (r) return r;
      }
      return undefined;
    };
    for (const { word, role } of parse.roles) {
      if (role.role === 'command' && role.parse) return { argv: words.slice(word, role.parse.end), reset: role.slot.env === 'reset' };
      const v = splitOf(role);
      const r = v && inSplit(v, words.slice(word + 1));
      if (r) return r;
    }
    return { reset: false };
  };

  (usable('env') ? it : it.skip)('env -S: the words of the string, as GNU env splits it', () => {
    // (HOME is `/h`; an unset variable gives no word.)
    const STRINGS = [
      'a b', '  a\tb  ', 'a\\_b', '"a\\_b"', "'a\\_b'", "'a\\\\b'", "'a\\'b'", 'a\\cb c', 'a #c d', 'a#c d', '"#x" y', '\\#a',
      'a\\$b', '"a\\$b"', "'a\\$b'", '"a\\tb"', "'a\\tb'", 'a\\nb', "a''b", 'a""b', "'' x", 'x ""', '"a\\"b"', "\"a'b\"", 'a\\_#b', '"a" #b', 'a\\c',
      'x ${HOME}', 'x ${HOME}y', 'x"${HOME}"', "x '${HOME}'", 'x ${NOPE} y', 'x ${NOPE}y', 'x "${NOPE}"', '-i A=1 a\\_b',
    ];
    for (const str of STRINGS) {
      const line = `env -S'${str.replace(/'/g, "'\\''")}'`;
      const real = verbose(line).split;
      const r = splitEnvString(parseOf(line).words[0].slice(2));
      assert.ok('words' in r, line);
      // A word with `${…}` has its known start, and may vanish when the variable is unset.
      const fixed = r.words.filter((w) => !w.count);
      assert.ok(real.length >= fixed.length && real.length <= r.words.length, `${line}: ${JSON.stringify(real)} / ${JSON.stringify(r.words)}`);
      const known = r.words.length === real.length ? r.words : fixed;
      known.forEach((w, k) => assert.ok(w.value !== undefined ? real[k] === w.value : real[k].startsWith(w.prefix!), `${line} #${k}: ${real[k]} / ${JSON.stringify(w)}`));
    }
    // What env refuses: it exits with 125 and runs nothing.
    const REFUSED: [string, string][] = [['"a', 'quote'], ["'a", 'quote'], ['a\\', 'backslash-end'], ['a\\x', 'sequence'], ['a\\ b', 'sequence'], ['"a\\cb"', 'c-in-quotes'], ['a $HOME', 'dollar'], ['${1}', 'dollar'], ['${A-x}', 'dollar'], ['x${HOME', 'dollar']];
    for (const [str, error] of REFUSED) {
      const line = `env -S'${str.replace(/'/g, "'\\''")}' printf %s, x`;
      assert.strictEqual(verbose(line).status, 125, line);
      const r = splitEnvString(parseOf(line).words[0].slice(2));
      assert.strictEqual('error' in r && r.error, error, line);
      assert.strictEqual(runs(line).argv, undefined, line);
    }
    // `#` after a word made of `${…}` starts a comment only when the variables are unset: not known here.
    for (const str of ['${NOPE}#x y', '${HOME}#x y']) {
      const line = `env -S'${str}'`;
      assert.ok('unknown' in splitEnvString(parseOf(line).words[0].slice(2)), line);
    }
    assert.deepStrictEqual(verbose("env -S'${NOPE}#x y'").split, []);
    assert.deepStrictEqual(verbose("env -S'${HOME}#x y'").split, ['/h#x', 'y']);
    // A shebang `#!/usr/bin/env -i bash`: env gets `-i bash` as one word, reads ` ` as an option, and fails.
    const shebang = verbose("env '-i bash' x");
    assert.strictEqual(shebang.status, 125);
    assert.match(shebang.err, /invalid option -- ' '/);
  });

  (usable('env') ? it : it.skip)('env -S: env reads the words of the string in its place, then the rest of the line', () => {
    const LINES = [
      // The string is the command and its first arguments; the words after it are more.
      "env -S 'printf %s,' x y", "env --split-string='printf %s,' b", "env -S 'A=1 printf %s,' x -i", "env -S'-i A=1 printf %s,' x",
      // A string of options and assignments: the command is after it.
      "env -S-i A=1 printf %s, a", "env -S'A=1' printf %s, -i", "env -S'-u HOME -i' B=2 printf %s, x", "env --split-string='-i A=1' printf %s, y",
      // An option that takes a value takes the next word, after the string too.
      "env -S'-u' HOME printf %s, x", "env -S'-iu' HOME printf %s, x", "env -S'-C' / printf %s, x",
      // An assignment ends the options: a later `-i` is the command.
      "env -S'A=1 -i' printf %s, x", "env -S'A=1 B=2' -i printenv",
      // `-i` before the string, two strings, and `-S` in a cluster or inside the string.
      "env -i -S'A=1' printf %s, x", "env -S'-i' -S'A=1 printf' %s, x", "env -vS'printf %s,' x", "env -iS'printf %s,' x",
      "env -S'-u HOME -S\"B=2 printf %s,\"' x", "env -S'printf %s, \\c' x", "env -S'printf #%s,' x", "env -S'printf\\_%s,' x",
      // The shebang form: the kernel gives the whole rest as one word.
      "env '-S printf %s, -e' x", "env '-S -i printf %s,' x",
      // `-` is `-i`, in the string too.
      'env -S- printf %s, x', "env -S'- A=1' printf %s, x",
    ];
    for (const line of LINES) {
      const real = verbose(line);
      const ours = runs(line);
      assert.deepStrictEqual(ours.argv, real.argv, `${line}: ${real.err}`);
      assert.strictEqual(ours.reset, real.reset, line);
    }
  });

  // A path, or a wrapper that starts a program, runs the program named like a builtin, whose options differ.
  (usable('env') && /procps/.test(spawnSync('kill', ['-V'], { env: ENV, encoding: 'utf8' }).stdout ?? '') ? it : it.skip)('the programs named like builtins: coreutils and procps', () => {
    /** The role of the word `word` of the command the line runs (the line itself when it is a path). */
    const roleIn = (line: string, word: string) => {
      const { parse, words } = parseOf(line);
      const cmd = parse.roles.find((r) => r.role.role === 'command')?.role;
      const p = cmd && cmd.role === 'command' ? cmd.parse! : parse;
      return p.roles.find((r) => words[r.word] === word)!.role;
    };
    // procps kill has no `-n`, and takes no job spec.
    assert.match(run('env kill -n 9 999999').err, /invalid argument n/);
    assert.strictEqual(roleIn('env kill -n 9 999999', '-n').role, 'unknown-option');
    assert.strictEqual(roleIn('/bin/kill -s TERM 999999', '-s').role, 'option');
    assert.match(run('env kill %1').err, /failed to parse argument: '%1'/);
    const pid = roleIn('env kill %1', '%1');
    assert.ok(pid.role === 'operand' && pid.spec?.name === 'PID' && pid.spec.type === undefined);
    // coreutils printf has no `-v`: it is the format.
    assert.strictEqual(run('env printf -v x').out, '-v');
    const format = roleIn('env printf -v x', '-v');
    assert.ok(format.role === 'operand' && format.spec?.name === 'FORMAT');
    // coreutils echo reads `-e` as bash's does.
    assert.strictEqual(run("/bin/echo -e 'a\\tb'").out, 'a\tb\n');
    assert.strictEqual(roleIn('/bin/echo -e x', '-e').role, 'option');
    // coreutils pwd has long options.
    assert.strictEqual(run('/bin/pwd --logical').err, '');
    assert.strictEqual(roleIn('/bin/pwd --logical', '--logical').role, 'option');
  });

  (has('bash') ? it : it.skip)('bash and sh: `$0`, the arguments, and the script', () => {
    const script = path.join(os.tmpdir(), `bash-explainer-args-${process.pid}.sh`);
    fs.writeFileSync(script, 'printf %s, "$@"');
    try {
      for (const line of [
        `bash -c 'printf %s, "$0" "$@"' a b`, `bash -ec 'printf %s, "$0"' n`, `bash -o pipefail -c 'printf %s, "$0" "$1"' a b`, `sh -c 'printf %s, "$0" "$@"' a -x`,
      ]) assert.strictEqual(run(line).out, printed(operands(line, ['NAME', 'ARG'])), line);
      for (const line of ['bash -s -- --prefix x', 'bash -s a -b', 'sh -s -e x']) {
        assert.strictEqual(run(line, 'printf %s, "$@"').out, printed(operands(line, ['ARG'])), line);
      }
      for (const line of [`bash ${script} a -x`, `bash +x ${script} -e`, `bash -e -- ${script} -x`]) {
        assert.deepStrictEqual(operands(line, ['SCRIPT']), [script], line);
        assert.strictEqual(run(line).out, printed(operands(line, ['ARG'])), line);
      }
    } finally {
      fs.rmSync(script, { force: true });
    }
  });

  (usable('flock') ? it : it.skip)('flock -c: the string runs in a shell', () => {
    const line = `flock ${lock} -c 'printf %s, x'`;
    const { parse } = parseOf(line);
    assert.deepStrictEqual(parse.roles.map((r) => r.role.role), ['operand', 'option', 'command']);
    assert.strictEqual(run(line).out, 'x,');
  });

  (has('bash') ? it : it.skip)('command -v and -V: the operands are names to look up, and nothing runs', () => {
    for (const line of ['command -v printf ls cd', 'command -V ls', 'command -v -p ls cd']) {
      const names = operands(line, ['NAME']);
      assert.ok(names.length, line);
      assert.ok(!parseOf(line).parse.roles.some((r) => r.role.role === 'command'), line);
      assert.strictEqual(run(line).out.trim().split('\n').length, names.length, line);
    }
  });

  // su asks for no password before it looks the user up, so a user that does not exist shows which word it took.
  (has('su') && run('su nosuchuser_zz').err.includes('nosuchuser_zz') ? it : it.skip)('su: the user, with options before or after it', () => {
    for (const line of ['su -c ls nosuchuser_zz', 'su nosuchuser_zz -c ls', 'su - nosuchuser_zz', 'su -s /bin/sh nosuchuser_zz', 'su --command=ls nosuchuser_zz']) {
      const [user] = operands(line, ['USER']);
      assert.strictEqual(user, 'nosuchuser_zz', line);
      assert.match(run(line).err, /user nosuchuser_zz does not exist/, line);
    }
  });

  it('sh: every letter the dictionary lists is accepted by sh, and one it lacks is not', function () {
    if (!has('sh')) return this.skip();
    const accepts = (letter: string): boolean => spawnSync('sh', [`-${letter}`, '-c', ':'], { input: '', env: ENV, encoding: 'utf8' }).status === 0;
    const letters = lookupCommand('sh')!.options!.flatMap((o) => o.names).filter((n) => /^-[a-nA-Zp-z]$/.test(n)).map((n) => n[1]); // (`-o` takes a name)
    for (const letter of ['s', 'i', 'c', 'e', 'x', 'u', 'n', 'v']) assert.ok(letters.includes(letter), letter);
    for (const letter of letters) assert.ok(accepts(letter), letter);
    assert.strictEqual(accepts('Z'), false);
    // `-s` reads the script from stdin: the words are its arguments.
    const { parse } = parseOf('sh -s a b');
    assert.deepStrictEqual(parse.roles.map((r) => r.role.role), ['option', 'operand', 'operand']);
    assert.strictEqual(run('echo \'printf %s, "$@"\' | sh -s a b').out, 'a,b,');
  });
});
