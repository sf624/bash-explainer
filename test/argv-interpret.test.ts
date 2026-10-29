// The argument interpreter (src/argv/interpret.ts): the worked examples of the design, commands of the
// dictionary, the specs `cmd` builds (src/dict/types.ts), and the corners of the option grammar.
import * as assert from 'assert';
import { lookupCommand } from '../src/analyzer';
import { splitEnvString } from '../src/argv/envsplit';
import { type ArgRole, ArgWord, interpret, InterpretContext, match } from '../src/argv/interpret';
import type { CommandSpec, OperandSpec, OptionSpec } from '../src/argv/spec';
import { byCount, cmd, mergeOptions, runs } from '../src/dict/types';
import { tx } from '../src/i18n';
import { argWords, render } from './support/argwords';
import { runBash } from './support/bash';
// (Types only: loaded so that its coverage is measured.)
import '../src/argv/spec';

const t = (en: string) => tx(en, en);
const lookup = lookupCommand;
/** The roles of the words of `line`, read with `spec` (by default the dictionary's entry). */
const roles = (line: string, spec?: CommandSpec, ctx: InterpretContext = {}): string[] => {
  const { name, words, texts } = argWords(line);
  return render(interpret(spec ?? lookup(name)!, words, { name, lookup, ...ctx }), texts);
};
const parseOf = (line: string, spec?: CommandSpec) => {
  const { name, words } = argWords(line);
  return interpret(spec ?? lookup(name)!, words, { name, lookup });
};
const opt = (names: string, text: string, rest: Partial<OptionSpec> = {}): OptionSpec => ({ names: names.split('|'), text: t(text), ...rest });
const item = (name: string, rest: Partial<OperandSpec> = {}): OperandSpec => ({ name, text: t(name.toLowerCase()), ...rest });

describe('argv interpreter: the worked examples of the design', () => {
  const timeout: CommandSpec = {
    summary: t('Run a command with a time limit'), parser: 'getopt_long', optionsFirst: true,
    options: [
      opt('-s|--signal', 'signal to send on timeout', { value: { name: 'SIGNAL', type: 'signal' } }),
      opt('-k|--kill-after', 'send KILL later', { value: { name: 'DURATION', type: 'duration' } }),
      opt('--preserve-status', 'exit with the status of the command'),
    ],
    operands: [{ pattern: [item('DURATION', { type: 'duration' }), item('COMMAND', { command: { run: 'exec' } })] }],
  };

  it('timeout: options end at the command, whose options are its own', () => {
    assert.deepStrictEqual(roles('timeout -k 5 10 sleep -h', timeout), [
      '-k: -k send KILL later', '5: value 0 of -k DURATION', '10: DURATION', 'sleep: command exec sleep', '  -h: -h?',
    ]);
    // A long option may be a unique prefix of its name (getopt_long), with the switch on.
    assert.deepStrictEqual(roles('timeout --pres 5 ls', timeout).slice(0, 1), ['--pres: --pres exit with the status of the command']);
    assert.deepStrictEqual(roles('timeout --signal=KILL 5 ls', timeout)[0], '--signal=9 signal to send on timeout'.replace(/^/, '--signal=KILL: '));
  });

  const rpm: CommandSpec = {
    summary: t('rpm'),
    modes: [{ name: 'query' }, { name: 'verify' }, { name: 'install', default: true }],
    options: [
      opt('-q|--query', 'query installed packages', { selects: 'query' }),
      opt('-i|--install', 'install', { selects: 'install', inMode: { query: t('show package information') } }),
      opt('-v', 'verbose'), opt('-h', 'hash marks'),
    ],
    operands: [
      { when: { mode: 'install' }, pattern: [item('PACKAGE_FILE', { repeat: '+', type: 'file' })] },
      { pattern: [item('PACKAGE', { repeat: '*' })] },
    ],
  };

  it('rpm: one option, two meanings, chosen by the mode', () => {
    assert.deepStrictEqual(roles('rpm -ivh x.rpm', rpm), ['-ivh: cluster -i install | -v verbose | -h hash marks', 'x.rpm: PACKAGE_FILE']);
    assert.deepStrictEqual(roles('rpm -qi bash', rpm), ['-qi: cluster -q query installed packages | -i show package information', 'bash: PACKAGE']);
    assert.strictEqual(parseOf('rpm -qi bash', rpm).mode, 'query');
    // No option selects a mode: the default one.
    assert.strictEqual(parseOf('rpm x.rpm', rpm).mode, 'install');
  });

  const tar: CommandSpec = {
    summary: t('tar'),
    oldStyle: { needs: 'cxt' },
    modes: [{ name: 'create' }, { name: 'extract' }],
    options: [
      opt('-c|--create', 'create an archive', { selects: 'create' }), opt('-x', 'extract', { selects: 'extract' }), opt('-v', 'verbose'), opt('-z', 'gzip'),
      opt('-f|--file', 'archive file', { value: { name: 'ARCHIVE', type: 'file' } }),
      opt('-C|--directory', 'change to this directory first', { value: { name: 'DIR', type: 'dir' }, inMode: { extract: t('extract into this directory') } }),
    ],
    operands: [{ when: { mode: 'create' }, pattern: [item('FILE', { repeat: '+' })] }, { pattern: [item('MEMBER', { repeat: '*' })] }],
  };

  it('tar: old-style letters, whose values are the next words in order', () => {
    assert.deepStrictEqual(roles('tar cvzfC a.tgz /tmp src', tar), [
      'cvzfC: old c create an archive | v verbose | z gzip | f archive file | C change to this directory first',
      'a.tgz: value 0 of f ARCHIVE', '/tmp: value 0 of C DIR', 'src: FILE',
    ]);
    // The letters take their meaning in the mode too.
    assert.match(roles('tar xC d', tar)[0], /C extract into this directory/);
    // Without one of the letters that `needs` names, the word is an operand; so is a word with other characters.
    assert.deepStrictEqual(roles('tar vz', tar), ['vz: MEMBER']);
    assert.deepStrictEqual(roles('tar cv.z', tar), ['cv.z: MEMBER']);
    assert.deepStrictEqual(roles('tar cq', tar), ['cq: MEMBER']);
    // Only the first word, and a value with no word left is not taken.
    assert.deepStrictEqual(roles('tar -v cf', tar), ['-v: -v verbose', 'cf: MEMBER']);
    assert.deepStrictEqual(roles('tar cf', tar), ['cf: old c create an archive | f archive file']);
    // `$x` is not known: an operand.
    assert.deepStrictEqual(roles('tar $x', tar), ['$x: MEMBER']);
  });

  it('ps aux: old-style letters of their own', () => {
    assert.deepStrictEqual(parseOf('ps aux').roles.map((r) => (r.role.role === 'old-style' ? r.role.letters.map((l) => (l as { flag: string }).flag).join(' ') : '')), ['a u x']);
    assert.deepStrictEqual(roles('ps -ef').length, 1);
  });

  const kube: OptionSpec[] = [
    opt('-n|--namespace', 'namespace', { persistent: true, value: { name: 'NS' } }),
    opt('--context', 'kubeconfig context', { persistent: true, value: { name: 'CONTEXT' } }),
    opt('-f', 'kubectl file', { value: { name: 'FILE' } }),
  ];
  const kubectl: CommandSpec = {
    summary: t('kubectl'), options: kube,
    subcommands: {
      exec: {
        summary: t('Run a command in a container'),
        options: [opt('-i|--stdin', 'pass stdin'), opt('-t|--tty', 'allocate a TTY'), opt('-c|--container', 'container', { value: { name: 'CONTAINER' } })],
        operands: [{ pattern: [item('POD')] }],
        dashDash: { then: [item('COMMAND', { command: { run: 'exec', where: 'container', env: 'none' } })] },
      },
      logs: { summary: t("Print a pod's logs"), options: [opt('-f|--follow', 'stream the logs')], operands: [{ pattern: [item('POD')] }], aliases: ['log'] },
    },
  };

  it('kubectl exec --: persistent options, a nested subcommand, and the command after `--`', () => {
    assert.deepStrictEqual(roles('kubectl -n prod exec -it web -c app -- ls *.log', kubectl), [
      '-n: -n namespace', 'prod: value 0 of -n NS', 'exec: subcommand exec',
      '  -it: cluster -i pass stdin | -t allocate a TTY', '  web: POD', '  -c: -c container', '  app: value 0 of -c CONTAINER', '  --: end of options',
      '  ls: command exec@container ls', '    *.log: ARG1',
    ]);
    // A persistent option is known after the subcommand; the others are not spread into it.
    assert.deepStrictEqual(roles('kubectl logs -n x -f web', kubectl), ['logs: subcommand logs', '  -n: -n namespace', '  x: value 0 of -n NS', '  -f: -f stream the logs', '  web: POD']);
    assert.deepStrictEqual(roles('kubectl log web', kubectl), ['log: subcommand logs', '  web: POD']);
    // `--` with nothing after it.
    assert.deepStrictEqual(roles('kubectl exec web --', kubectl), ['exec: subcommand exec', '  web: POD', '  --: end of options']);
    assert.strictEqual(parseOf('kubectl exec web -- ls', kubectl).roles[0].role.role === 'subcommand' ? 'ok' : '', 'ok');
  });

  const git: CommandSpec = {
    summary: t('git'),
    options: [opt('-C', 'run in this directory', { value: { name: 'DIR', type: 'dir' } })],
    subcommandPrefixes: true,
    subcommands: {
      branch: {
        summary: t('branches'),
        options: [opt('-m|--move', 'rename a branch'), opt('-M', 'rename by force'), opt('-d|--delete', 'delete a branch'), opt('-D', 'delete by force')],
        operands: [
          { when: { option: ['-m', '-M', '--move'] }, pattern: [item('OLD', { repeat: '?' }), item('NEW')] },
          { when: { option: ['-d', '-D', '--delete'] }, pattern: [item('BRANCH', { repeat: '+' })] },
          { pattern: [item('NAME', { repeat: '?' }), item('START', { repeat: '?' })] },
        ],
      },
      bisect: { summary: t('bisect'), subcommands: { start: { summary: t('start') } } },
      blame: { summary: t('blame') },
    },
  };

  it('git branch -m: the operands depend on the option, and backtracking fills the required item', () => {
    assert.deepStrictEqual(roles('git branch -m main', git), ['branch: subcommand branch', '  -m: -m rename a branch', '  main: NEW']);
    assert.deepStrictEqual(roles('git branch -m old new', git).slice(2), ['  old: OLD', '  new: NEW']);
    assert.deepStrictEqual(roles('git -C repo branch -D a b', git), ['-C: -C run in this directory', 'repo: value 0 of -C DIR', 'branch: subcommand branch', '  -D: -D delete by force', '  a: BRANCH', '  b: BRANCH']);
    assert.deepStrictEqual(roles('git branch x y', git).slice(1), ['  x: NAME', '  y: START']);
    // Too many operands for every alternative: unmatched, read as plain words.
    const p = parseOf('git branch -m a b c', git);
    const sub = p.roles[0].role;
    assert.ok(sub.role === 'subcommand');
    assert.deepStrictEqual(sub.parse.unmatched, [2, 3, 4]);
    assert.strictEqual(sub.parse.command, 'git branch');
    // Subcommands nest; a unique prefix selects one (`bis` is `bisect`), an ambiguous one (`b`) does not.
    assert.deepStrictEqual(roles('git bis start', git), ['bis: subcommand bisect', '  start: subcommand start']);
    assert.deepStrictEqual(roles('git b x', git), ['b: operand', 'x: operand']);
  });

  const journalctl: CommandSpec = {
    summary: t('journalctl'),
    options: [
      opt('-b|--boot', 'only this (or the given) boot', { value: { name: 'BOOT', optional: true, next: /^([-+]?\d+|[0-9a-f]{32}|all)$/ } }),
      opt('-u|--unit', 'unit', { value: { name: 'UNIT' } }), opt('-k', 'kernel messages'),
    ],
  };

  it('journalctl -b: an optional value taken from the next word only when it looks like one', () => {
    assert.deepStrictEqual(roles('journalctl -b -1 -u nginx', journalctl), ['-b: -b only this (or the given) boot', '-1: value 0 of -b BOOT', '-u: -u unit', 'nginx: value 0 of -u UNIT']);
    assert.deepStrictEqual(roles('journalctl -b -u nginx', journalctl).slice(0, 2), ['-b: -b only this (or the given) boot', '-u: -u unit']);
    assert.deepStrictEqual(roles('journalctl --boot=-1', journalctl), ['--boot=-1: --boot=7 only this (or the given) boot']);
    // At the end of a cluster, as alone; attached, the rest of the word (getopt's optional_argument).
    assert.deepStrictEqual(roles('journalctl -kb -1', journalctl), ['-kb: cluster -k kernel messages | -b only this (or the given) boot', '-1: value 0 of -b BOOT']);
    assert.deepStrictEqual(roles('journalctl -b2', journalctl), ['-b2: -b=2 only this (or the given) boot']);
    // A word whose value is not known is not taken.
    assert.deepStrictEqual(roles('journalctl -b $x', journalctl), ['-b: -b only this (or the given) boot', '$x: operand']);
    assert.deepStrictEqual(roles('journalctl -b', journalctl), ['-b: -b only this (or the given) boot']);
  });
});

describe('argv interpreter: commands of the dictionary', () => {
  it('date -Iseconds: a value only attached', () => {
    assert.deepStrictEqual(roles('date -Iseconds -u'), [`-Iseconds: -I=2 ${lookup('date')!.options!.find((o) => o.names.includes('-I'))!.text.en}`, '-u: -u use UTC']);
    // Alone, `-I` takes no value from the next word.
    assert.deepStrictEqual(roles('date -I +%s').map((l) => l.split(':')[0]), ['-I', '+%s']);
  });

  it('jq --arg n v f: an option with two values', () => {
    assert.deepStrictEqual(roles("jq --arg n v '.x' f").slice(0, 3), ['--arg: --arg pass a string variable (`--arg name value`)', 'n: value 0 of --arg NAME', 'v: value 1 of --arg VALUE']);
    // `--args`: the operands after the filter are values.
    assert.deepStrictEqual(roles("jq -n --args '$ARGS' a b").slice(2), ["'$ARGS': ARG1", 'a: ARG', 'b: ARG']);
    // Only the operands after `--args` are values: `jq -c '[input_filename,$ARGS.positional]' in.json --args a` prints `["in.json",["a"]]`.
    assert.deepStrictEqual(roles("jq '$ARGS' in.json --args a").filter((l) => !l.startsWith('--')), ["'$ARGS': ARG1", 'in.json: ARG2', 'a: ARG']);
    // With `-f`, too (`jq -n -f prog.jq --args a`: `a` is positional).
    assert.deepStrictEqual(roles('jq -n -f prog.jq --args a').slice(-1), ['a: ARG']);
    // jq reads no `--arg=x`: an unknown option (`jq: Unknown option --arg=x`).
    assert.deepStrictEqual(roles('jq --arg=x y .').slice(0, 1), ['--arg=x: --arg=x?']);
  });

  it('cut -d\',\' -f2: a quoted value glued to its option', () => {
    assert.deepStrictEqual(roles("cut -d',' -f2 f").map((l) => l.replace(/=(\d) .*/, '=$1')), ["-d',': -d=2", '-f2: -f=2', 'f: ARG1']);
    // `-d"$x"`: the value is not known, but the option is.
    assert.deepStrictEqual(roles('cut -d"$x" f').map((l) => l.replace(/=(\d) .*/, '=$1')), ['-d"$x": -d=2', 'f: ARG1']);
  });

  it('kill -TERM %1: a signal by its form, and a job spec', () => {
    const p = parseOf('kill -TERM %1');
    assert.deepStrictEqual(p.roles.map((r) => r.role.role), ['pattern-option', 'operand']);
    const op = p.roles[1].role;
    assert.ok(op.role === 'operand' && op.spec?.type === 'job');
    assert.deepStrictEqual(roles('kill -9 1').slice(0, 1), ['-9: -9 force kill (SIGKILL)']);
    assert.deepStrictEqual(roles('kill -15 1').slice(0, 1), ['-15: pattern Send signal number 15 (same as `-n 15`; `kill -l 15` prints its name)']);
    assert.deepStrictEqual(roles('kill -SIGint 1').slice(0, 1), ['-SIGint: pattern Send the signal `INT` (same as `-s INT`; `kill -l` lists them)']);
    // bash reads `-s` and a letter as `-s NAME`: `-sigint` names the signal `igint`.
    assert.deepStrictEqual(roles('kill -sigint 1').slice(0, 1), ['-sigint: -s=2 signal name to send']);
    // `-l`: the operands are signals.
    const l = parseOf('kill -l 15').roles[1].role;
    assert.ok(l.role === 'operand' && l.spec?.type === undefined && /signal/.test(l.spec!.text.en));
  });

  it('seq -f \'%g\' 1 3 10: operands by their number', () => {
    const texts = (line: string) => parseOf(line).roles.flatMap((r) => (r.role.role === 'operand' ? [r.role.spec!.text.en] : []));
    assert.deepStrictEqual(texts("seq -f '%g' 1 3 10"), ['first', 'increment', 'last']);
    assert.deepStrictEqual(texts('seq 2 5'), ['first', 'last']);
    assert.deepStrictEqual(texts('seq 5'), ['last (counting from 1)']);
    assert.deepStrictEqual(texts('cp a b c d/'), ['source', 'source', 'source', 'destination directory']);
    assert.deepStrictEqual(texts('cp -t d a b'), ['source', 'source']);
    assert.deepStrictEqual(texts('ln -s a b c'), ['target', 'target', 'directory to make the links in']);
  });

  it('chmod --reference=r f: the option changes what the operands are', () => {
    assert.deepStrictEqual(parseOf('chmod --reference=r f').roles.map((r) => (r.role.role === 'operand' ? r.role.spec!.text.en : r.role.role)), ['option', 'target file']);
    assert.deepStrictEqual(parseOf('chmod 644 f').roles.map((r) => (r.role.role === 'operand' ? r.role.spec!.text.en : '')), ['mode (e.g. `755`, `+x`, `u+w`)', 'target file']);
  });

  it('nice -10 make: a count option, then the command', () => {
    assert.deepStrictEqual(roles('nice -10 make -j4').map((l) => l.replace(/ \(.*/, '')), ['-10: pattern niceness adjustment 10', 'make: command exec make', '  -j4: -j=2 parallel jobs']);
    assert.deepStrictEqual(roles('head -5 f')[0], '-5: pattern 5 lines (old way to write `-n 5`)');
    assert.deepStrictEqual(roles('tail -1 f')[0], '-1: pattern 1 line (old way to write `-n 1`)');
    assert.deepStrictEqual(roles('git log -3')[1], '  -3: pattern only 3 (same as `-n 3`)');
  });

  it("bash -c 'cmd' a b: the command string, `$0`, and the arguments", () => {
    const c = '-c read the commands from the first argument after the options (the command string), not from a file or stdin; the arguments after it become `$0`, `$1`…';
    assert.deepStrictEqual(roles("bash -c 'cmd' a b"), [`-c: ${c}`, "'cmd': command shell-string", 'a: NAME', 'b: ARG']);
    // (The string is the first operand, also when options follow `-c`: `bash -c -e 'cmd'`.)
    assert.deepStrictEqual(roles("bash -c -u 'cmd' a"), [`-c: ${c}`, '-u: -u treat unset variables as an error', "'cmd': command shell-string", 'a: NAME']);
    assert.deepStrictEqual(roles('bash -ux script.sh -x'), ['-ux: cluster -u treat unset variables as an error | -x print each command after expansion (debugging)', 'script.sh: SCRIPT', '-x: ARG']);
    assert.deepStrictEqual(roles('bash -s a'), ['-s: -s read the commands from stdin (also the default when no operand is left); the operands become `$1`…', 'a: ARG']);
    // `su -c`: the value of `-c` is a shell string.
    // `su -c 'cmd'` and `bash -c 'cmd'`: the same form, a command role with a shell-string slot.
    assert.deepStrictEqual(roles("su -c 'ls' user"), ['-c: -c run the given command with the shell', "'ls': command shell-string of -c", 'user: USER']);
    // `bash +x s.sh`: `+x` is an option (`bash +x /dev/null` exits 0).
    assert.deepStrictEqual(roles('bash +x s.sh'), ['+x: +x (off) print each command after expansion (debugging)', 's.sh: SCRIPT']);
  });

  it('env A=1 cmd: assignments, then the command; the first word that is not one ends the options', () => {
    assert.deepStrictEqual(roles('env -i A=1 B=$x cmd -i'), ['-i: -i start with an empty environment', 'A=1: NAME=VALUE (assignment)', 'B=$x: NAME=VALUE (assignment)', 'cmd: command exec cmd (unknown)', '  -i: -i?']);
    assert.deepStrictEqual(roles('env A=1'), ['A=1: NAME=VALUE (assignment)']);
    assert.deepStrictEqual(roles('sudo -u root ls -la').slice(2, 3), ['ls: command exec ls']);
    assert.deepStrictEqual(roles('sudo $cmd -x'), ['$cmd: command exec (unknown)', '  -x: -x?']);
  });

  it('xargs -I{} f {}: a value attached to its option, then the command', () => {
    assert.deepStrictEqual(roles('xargs -I{} f {}').map((l) => l.replace(/=2 .*/, '=2')), ['-I{}: -I=2', 'f: command exec f (unknown)', '  {}: operand']);
    // `-r$x`: what follows is not known, and `-r` takes no value: an operand.
    assert.deepStrictEqual(roles('xargs -r$x'), ['-r$x: open -r']);
  });

  it('`--` ends the options, except for echo; a builtin reads options before its first operand', () => {
    assert.deepStrictEqual(roles('rm -- -f x'), ['--: end of options', '-f: ARG1', 'x: ARG1']);
    assert.deepStrictEqual(roles('rm -f -- -x').map((l) => l.split(':')[0]), ['-f', '--', '-x']);
    assert.deepStrictEqual(roles('echo -- -n'), ['--: TEXT', '-n: TEXT']);
    assert.deepStrictEqual(roles('echo -ne x -n'), ['-ne: cluster -n do not print the trailing newline | -e interpret backslash escapes like `\\n`', 'x: TEXT', '-n: TEXT']);
    assert.deepStrictEqual(roles('echo -nx'), ['-nx: TEXT']);
    // A word in quotes is an option all the same: the program sees no quotes.
    assert.deepStrictEqual(roles('ls "-l" "--all"').map((l) => l.split(':')[0] + ':' + l.split(':')[1].split(' ')[1]), ['"-l":-l', '"--all":--all']);
    // A builtin: options before the first operand only.
    assert.deepStrictEqual(roles('printf %s -v'), ['%s: FORMAT', '-v: ARG']);
    assert.deepStrictEqual(roles('let -1+2'), ['-1+2: EXPR']);
  });

  it('set: `+` turns options off, and `-o` takes the next word even inside a cluster', () => {
    assert.deepStrictEqual(roles('set -euo pipefail'), ['-euo: cluster -e exit immediately if a command fails (but not in the condition of `if`, `while` or `until`, in a `&&` or `||` list except its last command, in a pipeline except its last command (unless `pipefail` is on), after `!`, or in a function called from those places) | -u treat unset variables as an error | -o enable an option by name', 'pipefail: value 0 of -o VALUE']);
    assert.deepStrictEqual(roles('set -oe pipefail').slice(1), ['pipefail: value 0 of -o VALUE']);
    // The flags as written; a value names its option's flag (`of`).
    assert.deepStrictEqual(roles('set +x +o xtrace'), ['+x: +x (off) print each command after expansion (debugging)', '+o: +o (off) enable an option by name', 'xtrace: value 0 of +o VALUE']);
    assert.deepStrictEqual(roles('set -o'), ['-o: -o (no value) enable an option by name']);
    assert.deepStrictEqual(roles('set +ex')[0], '+ex: cluster +e (off) exit immediately if a command fails (but not in the condition of `if`, `while` or `until`, in a `&&` or `||` list except its last command, in a pipeline except its last command (unless `pipefail` is on), after `!`, or in a function called from those places) | +x (off) print each command after expansion (debugging)');
    assert.deepStrictEqual(roles('set -- a').map((l) => l.split(':')[0]), ['--', 'a']);
  });

  it('awk: operands that look like `name=value` are assignments', () => {
    const p = parseOf("awk '{print}' n=1 f");
    assert.deepStrictEqual(p.roles.map((r) => (r.role.role === 'operand' ? !!r.role.assignment : undefined)), [false, true, false]);
  });

  it('find: the options before the paths, then the expression for its own parser', () => {
    const p = parseOf('find -L . /tmp -name x -exec rm {} +');
    assert.deepStrictEqual(render(p, argWords('find -L . /tmp -name x -exec rm {} +').texts).slice(0, 5), ['-L: -L follow symbolic links', '.: ARG1', '/tmp: ARG1', '-name: expression', 'x: expression']);
    assert.strictEqual(p.roles.length, 9);
    assert.strictEqual(p.expression, 3);
    assert.strictEqual(parseOf('find . \\( -a \\)').expression, 1);
    assert.strictEqual(parseOf('find .').expression, undefined);
  });
});

describe('argv interpreter: the option grammar', () => {
  const spec: CommandSpec = {
    summary: t('test'),
    options: [
      opt('-a', 'all'), opt('-b', 'b'),
      opt('-n|--lines', 'lines', { value: { name: 'N', type: 'number' } }),
      opt('-i|--in-place', 'in place', { value: { name: 'SUFFIX', how: 'attached-only', optional: true } }),
      opt('-x|--exclude', 'exclude', { value: { name: 'PATTERN', how: 'next-only' } }),
      opt('--pair', 'pair', { value: [{ name: 'NAME' }, { name: 'VALUE' }] }),
      opt('--color', 'color', { value: { name: 'WHEN', how: 'attached-only', optional: true } }),
      opt('--exec', 'exec', { until: { terminators: [';', '+'], slot: { run: 'exec' } } }),
      opt('--verbose', 'verbose'), opt('--version', 'version'),
    ],
    parser: 'getopt_long',
    operands: [{ pattern: [item('FILE', { repeat: '*' })] }],
  };

  it('reads clusters, attached and separate values', () => {
    assert.deepStrictEqual(roles('t -abn5 -n 3 -ab f', spec), [
      '-abn5: cluster -a all | -b b | -n=4 lines', '-n: -n lines', '3: value 0 of -n N', '-ab: cluster -a all | -b b', 'f: FILE',
    ]);
    // An attached-only value: the rest of the word, or nothing (the next word is not taken).
    assert.deepStrictEqual(roles('t -ai.bak -i f', spec), ['-ai.bak: cluster -a all | -i=3 in place', '-i: -i in place', 'f: FILE']);
    assert.deepStrictEqual(roles('t -ai f', spec), ['-ai: cluster -a all | -i in place', 'f: FILE']);
    // A next-only value: the next word, and the letters after it still count.
    assert.deepStrictEqual(roles('t -xa p f', spec), ['-xa: cluster -x exclude | -a all', 'p: value 0 of -x PATTERN', 'f: FILE']);
    // A value at the end of the words is missing.
    assert.deepStrictEqual(roles('t -an', spec), ['-an: cluster -a all | -n (no value) lines']);
    assert.deepStrictEqual(roles('t -n', spec), ['-n: -n (no value) lines']);
    // Unknown letters, and an unknown single letter.
    assert.deepStrictEqual(roles('t -az -q', spec), ['-az: cluster -a all | -z?', '-q: -q?']);
  });

  it('reads long options: `=value`, separate values, prefixes, unknown ones', () => {
    assert.deepStrictEqual(roles('t --lines=5 --lines 6 --pair a b --color --color=auto f', spec), [
      '--lines=5: --lines=8 lines', '--lines: --lines lines', '6: value 0 of --lines N', '--pair: --pair pair', 'a: value 0 of --pair NAME', 'b: value 1 of --pair VALUE',
      '--color: --color color', '--color=auto: --color=8 color', 'f: FILE',
    ]);
    // `--pair=a b`: the first value attached, the second the next word.
    assert.deepStrictEqual(roles('t --pair=a b', spec), ['--pair=a: --pair=7 pair', 'b: value 1 of --pair VALUE']);
    // A unique prefix; an ambiguous one (`--ver`) and an unknown one are unknown options.
    assert.deepStrictEqual(roles('t --lin 5 --ver --nope=1 --nope', spec), ['--lin: --lin lines', '5: value 0 of --lin N', '--ver: --ver?', '--nope=1: --nope?=7', '--nope: --nope?']);
    // `--file=$x`: the value is not known, the option is.
    assert.deepStrictEqual(roles('t --lines=$n --$x --lines$x', spec), ['--lines=$n: --lines=8 lines', '--$x: open --', '--lines$x: open --lines']);
  });

  it('records the other role of an uncertain operand, the operand a command fills, and where nested words end', () => {
    const dir = parseOf('cp *.txt dir').roles[1].role;
    assert.ok(dir.role === 'operand' && dir.uncertain);
    assert.strictEqual(dir.otherwise!.text.en, 'destination directory');
    const brace = parseOf('cp a{,.bak}').roles[0].role;
    assert.ok(brace.role === 'operand' && !brace.uncertain);
    assert.deepStrictEqual(brace.each!.map((o) => o.text.en), ['source', 'destination (the new name, or an existing directory)']);
    // (A command slot that takes one word, then the operands after it: `trap {x,EXIT}` is `trap x EXIT`.)
    const action = parseOf('trap {x,EXIT}').roles[0].role;
    assert.ok(action.role === 'command');
    assert.deepStrictEqual(action.each!.map((o) => o.name), ['ACTION', 'SIGNAL']);
    const all = parseOf('cp "$@"').roles[0].role;
    assert.ok(all.role === 'operand' && all.uncertain);
    // (For each count: with two words the two-operand form, a source and the destination; with three or more, the other.)
    const readings = (r: ArgRole) => (r.role === 'operand' ? r.several?.map((x) => `${x.from}${x.orMore ? '+' : ''}: ${x.roles.map((o) => o.text.en).join(', ')}`) : undefined);
    assert.deepStrictEqual(readings(all), ['1: source', '2: source, destination (the new name, or an existing directory)', '3+: source, destination directory']);
    // (Up to the count a word may give, and only counts a pattern fits: none past the longest of a spec with no `*`.)
    const three: CommandSpec = { summary: t('three'), operands: [{ pattern: [item('A'), item('B'), item('C')] }, { pattern: [item('A'), item('D')] }, { pattern: [item('A')] }] };
    assert.deepStrictEqual(readings(interpret(three, [{ value: 'x', count: { min: 1 } }]).roles[0].role), ['1: a', '2: a, d', '3: a, b, c']);
    assert.deepStrictEqual(readings(interpret(three, [{ value: 'x', count: { min: 1, max: 2 } }]).roles[0].role), ['1: a', '2: a, d']);
    // (After a count no pattern fits, the count after it is no "more"; none when only one word fits.)
    const gap: CommandSpec = { summary: t('gap'), operands: [{ pattern: [item('A')] }, { pattern: [item('A'), item('B')] }, { pattern: [item('A'), item('B'), item('C'), item('D'), item('D', { repeat: '*' })] }] };
    assert.deepStrictEqual(readings(interpret(gap, [{ value: 'x', count: { min: 1 } }]).roles[0].role), ['1: a', '2: a, b', '4+: a, b, c, d']);
    assert.strictEqual(readings(interpret({ summary: t('one'), operands: [{ pattern: [item('A')] }] }, [{ value: 'x', count: { min: 1 } }]).roles[0].role), undefined);
    // (A word that gives two words or more: no reading for one.)
    assert.deepStrictEqual(readings(interpret(three, [{ value: 'x', count: { min: 2 } }]).roles[0].role), ['2: a, d', '3: a, b, c']);
    const p = parseOf('timeout 5 sleep 1');
    const run = p.roles[1].role;
    assert.ok(run.role === 'command');
    assert.deepStrictEqual([run.item!.name, run.parse!.end, p.end], ['COMMAND', 3, 3]);
  });

  it('reads the words up to a terminator as a command', () => {
    assert.deepStrictEqual(roles('t --exec rm {} \\; f', spec), ['--exec: --exec exec', 'rm: command exec of --exec rm', '  {}: ARG1', '\\;: terminator', 'f: FILE']);
    assert.deepStrictEqual(roles('t --exec + f', spec), ['--exec: --exec exec', '+: terminator', 'f: FILE']);
    assert.deepStrictEqual(roles('t --exec rm x', spec), ['--exec: --exec exec', 'rm: command exec of --exec rm', '  x: ARG1']);
  });

  it('reads single-dash options', () => {
    const sd: CommandSpec = { summary: t('sd'), parser: 'single-dash', options: [opt('-var-file', 'variables file', { value: { name: 'FILE' } }), opt('-v', 'v')] };
    assert.deepStrictEqual(roles('sd -var-file=x -var-file y -nope -no=1 -v$x a -vx$y', sd), [
      '-var-file=x: -var-file=10 variables file', '-var-file: -var-file variables file', 'y: value 0 of -var-file FILE', '-nope: -nope?', '-no=1: -no=1?', '-v$x: open -v', 'a: operand', '-vx$y: open -vx',
    ]);
  });

  it('reads options after operands (gnu) until a command starts, and a command slot of the current shell', () => {
    const wrap: CommandSpec = {
      summary: t('wrap'), options: [opt('-c', 'command string', { value: { name: 'CMD' } }), opt('-n', 'n')],
      operands: [{ pattern: [item('LOCK', { repeat: '?' }), item('COMMAND', { repeat: '?', command: { run: 'current-shell', lookup: 'no-functions' } })] }],
    };
    assert.deepStrictEqual(roles('flock -n /tmp/l -c x', wrap), ['-n: -n n', '/tmp/l: LOCK', '-c: -c command string', 'x: value 0 of -c CMD']);
    assert.deepStrictEqual(roles('flock /tmp/l ls -n', wrap), ['/tmp/l: LOCK', 'ls: command current-shell ls', '  -n: -n list numeric user and group IDs']);
    // A spec without operands, and a pattern without a command.
    assert.deepStrictEqual(roles('x a -n', { summary: t('x'), options: [opt('-n', 'n')] }), ['a: operand', '-n: -n n']);
    assert.deepStrictEqual(roles('x a -n', { summary: t('x'), options: [opt('-n', 'n')], operands: [{ pattern: [item('A', { repeat: '*' })] }] }), ['a: A', '-n: -n n']);
  });

  it('matches operand patterns with backtracking, and gives up past the work cap', () => {
    const w = (s: string): ArgWord[] => s.split(' ').map((value) => ({ value }));
    const seq = [item('FIRST', { repeat: '?' }), item('INCREMENT', { repeat: '?' }), item('LAST')];
    assert.deepStrictEqual(match(seq, w('5'), 100), { items: [2] });
    assert.deepStrictEqual(match(seq, w('1 5'), 100), { items: [0, 2] });
    assert.deepStrictEqual(match(seq, w('1 2 5'), 100), { items: [0, 1, 2] });
    assert.deepStrictEqual(match(seq, w('1 2 3 4'), 100), {});
    // Memoized: a pattern that cannot fit, over 41 words, is answered at once (it was exponential).
    const words = w(Array.from({ length: 41 }, (_, k) => `w${k}`).join(' '));
    const hard = [item('A', { repeat: '*' }), item('B', { repeat: '*' }), item('C', { repeat: '*' }), item('Z', { assignment: true }), item('D', { repeat: '*' })];
    assert.deepStrictEqual(match(hard, words, 100000), {});
    // The cap is a guard: past it, the answer is "gave up", not "does not fit".
    assert.deepStrictEqual(match(hard, words, 50), { gaveUp: true });
    const spec: CommandSpec = { summary: t('m'), operands: [{ pattern: hard }] };
    const p = parseOf('m a b c', spec);
    assert.deepStrictEqual([p.unmatched, p.gaveUp], [[0, 1, 2], undefined]);
    const { words: ws, texts } = argWords('m a b c');
    const capped = interpret(spec, ws, { maxSteps: 3 });
    assert.deepStrictEqual([render(capped, texts), capped.gaveUp], [['a: operand', 'b: operand', 'c: operand'], true]);
    const many = [item('A', { repeat: '*' }), item('B', { repeat: '*' }), item('C', { repeat: '*' }), item('D'), item('E')];
    assert.deepStrictEqual(roles('m a b', { summary: t('m'), operands: [{ pattern: many }] }), ['a: D', 'b: E']);
  });

  it('applies the conditions of the alternatives', () => {
    const spec: CommandSpec = {
      summary: t('c'), modes: [{ name: 'list' }],
      options: [opt('-l', 'list', { selects: 'list' }), opt('-t', 't')],
      operands: [
        { when: { mode: 'list' }, pattern: [item('LISTED', { repeat: '*' })] },
        { when: { not: { option: ['-t'] } }, pattern: [item('PLAIN', { repeat: '*' })] },
        { when: { option: ['-z'] }, pattern: [item('ZED', { repeat: '*' })] },
      ],
    };
    assert.deepStrictEqual(roles('c -l a', spec)[1], 'a: LISTED');
    assert.deepStrictEqual(roles('c a', spec)[0], 'a: PLAIN');
    // An unknown option counts too, as it is written.
    assert.deepStrictEqual(roles('c -t -z a', spec)[2], 'a: ZED');
    assert.deepStrictEqual(roles('c -tz a', spec)[1], 'a: ZED');
    assert.deepStrictEqual(roles('c -t a', spec)[1], 'a: operand');
    // A condition on an operand's value: `trap 1 2` resets both signals; a value not known matches nothing.
    assert.deepStrictEqual(roles('trap 1 2'), ['1: SIGNAL', '2: SIGNAL']);
    assert.deepStrictEqual(roles('trap 1 INT'), ['1: SIGNAL', 'INT: SIGNAL']);
    // (The action is a string this shell runs later: a command slot.)
    assert.deepStrictEqual(roles('trap "$x" INT'), ['"$x": command current-shell', 'INT: SIGNAL']);
    assert.deepStrictEqual(roles('trap 65 INT'), ['65: command current-shell', 'INT: SIGNAL']);
    // `'first'` prefixes: the first name a word starts; an empty word starts none (`ip ''`: "Object "" is unknown").
    assert.deepStrictEqual(roles('ip m'), ['m: subcommand maddress']);
    assert.deepStrictEqual(roles("ip ''"), ["'': operand"]);
    // A lone `-` starts every option: the first, `-loops` (`ip - 3 link` is `ip -loops 3 link`; test/subcommands-real.test.ts).
    assert.deepStrictEqual(roles('ip -'), ['-: - (no value) maximum number of attempts when flushing addresses']);
    assert.deepStrictEqual(roles('ip - 3 l'), ['-: - maximum number of attempts when flushing addresses', '3: value 0 of - VALUE', 'l: subcommand link']);
  });

  it('reads `--` that starts words of another pattern, and a `--` that is text', () => {
    const literal: CommandSpec = { summary: t('l'), dashDash: 'literal', options: [opt('-n', 'n')] };
    assert.deepStrictEqual(roles('l -- -n', literal), ['--: operand', '-n: -n n']);
    const then: CommandSpec = { summary: t('t'), dashDash: { then: [item('EXTRA', { repeat: '*' })] }, operands: [{ pattern: [item('A', { repeat: '*' })] }] };
    assert.deepStrictEqual(roles('t a -- -b c', then), ['a: A', '--: end of options', '-b: EXTRA', 'c: EXTRA']);
    // (A `--` the command refuses is an unknown option, with the spec's text; the options after it are still options.)
    const refused: CommandSpec = { summary: t('r'), dashDash: { refused: t('refused') }, options: [opt('-n', 'n')] };
    const p = parseOf('r -- -n --', refused);
    assert.deepStrictEqual(p.roles.map(({ role }) => (role.role === 'unknown-option' ? `${role.flag}: ${role.refused?.en}` : role.role)), ['--: refused', 'option', '--: refused']);
    // (A lone `-` that ends the options, as bash's parser reads it, is still no `--` of another pattern.)
    assert.deepStrictEqual(roles('r - -n', { ...refused, parser: 'bash' }), ['-: end of options', '-n: operand']);
  });

  it('reads a shell-string slot in an operand pattern without reading the string', () => {
    const p = parseOf("sh -c 'echo $1' x y");
    const role = p.roles[1].role;
    assert.ok(role.role === 'command' && role.parse === undefined && role.slot.run === 'shell-string');
  });

  it('reads words of which nothing is known', () => {
    const find: CommandSpec = { summary: t('find'), operandParser: 'find-expression', options: [opt('-L', 'follow')] };
    assert.strictEqual(interpret(find, [{}, { value: '-L' }]).expression, undefined);
    assert.strictEqual(interpret(find, [{ prefix: '' }, { prefix: '-na' }]).expression, 1);
    const awk: CommandSpec = { summary: t('awk'), operands: [{ pattern: [item('FILE', { repeat: '*', assignmentText: t('assignment') })] }] };
    assert.deepStrictEqual(interpret(awk, [{}, { prefix: 'v=' }]).roles.map((r) => r.role.role === 'operand' && !!r.role.assignment), [false, true]);
    // `echo -n$x`: an option only when every letter is known.
    assert.deepStrictEqual(roles('echo -n$x a'), ['-n$x: open -n', 'a: TEXT']);
  });

  it('gives a command the words after it, also those read as options before the command was known', () => {
    const spec: CommandSpec = {
      summary: t('w'), options: [opt('-x', 'x')],
      operands: [{ when: { option: ['-x'] }, pattern: [item('A'), item('COMMAND', { command: { run: 'exec' } })] }, { pattern: [item('A', { repeat: '*' })] }],
    };
    assert.deepStrictEqual(roles('w a zz -x', spec), ['a: A', 'zz: command exec zz (unknown)', '  -x: -x?']);
  });

  it('works without a context', () => {
    const p = interpret({ summary: t('x'), operands: [{ pattern: [item('C', { command: { run: 'exec' } })] }] }, [{ value: 'ls' }, { value: '-l' }]);
    assert.strictEqual(p.command, '');
    const c = p.roles[0].role;
    assert.ok(c.role === 'command' && c.spec === undefined && c.parse!.roles.length === 1);
  });
});


describe('argv interpreter: review fixes', () => {
  it('kill: only the first signal is one; a later `-1` is a PID (bash kill.def, `saw_signal`)', () => {
    // `bash -c 'kill -9 -999999'`: "No such process": `-999999` is a process group, not a signal.
    assert.deepStrictEqual(roles('kill -9 -1'), ['-9: -9 force kill (SIGKILL)', '-1: PID']);
    assert.deepStrictEqual(roles('kill -s TERM -1').slice(2), ['-1: PID']);
    assert.deepStrictEqual(roles('kill -s TERM -9').slice(2), ['-9: PID']);
    assert.deepStrictEqual(roles('kill -TERM -15').map((l) => l.split(':')[1].trim().split(' ')[0]), ['pattern', 'PID']);
    // `-l` sets no signal.
    assert.deepStrictEqual(roles('kill -l -15')[1].split(':')[1].trim().split(' ')[0], 'pattern');
  });

  it('reads `-` and an expansion as an option known at run time', () => {
    assert.deepStrictEqual(roles('kill -$sig $pid'), ['-$sig: pattern (open) Send the signal the expansion names (same as `-s NAME`)', '$pid: PID']);
    assert.deepStrictEqual(roles('head -$n f'), ['-$n: pattern (open) as many lines as the expansion gives (old way to write `-n N`)', 'f: ARG1']);
    // No operand slot: `cp -$opts a b` keeps `b` as the destination.
    assert.deepStrictEqual(roles('cp -$opts a b'), ['-$opts: open -', 'a: ARG1', 'b: ARG2']);
    assert.deepStrictEqual(roles('ls -l$x d'), ['-l$x: open -l', 'd: ARG1']);
    assert.deepStrictEqual(roles('nice --5 make').slice(0, 1), ['--5: pattern niceness adjustment -5 (old way to write `-n -5`; a negative value needs privileges)']);
  });

  it('ssh: options again after the host, up to the command, whose words are joined for the remote shell', () => {
    // `ssh -G localhost ls -l` still shows the local user: `-l` belongs to the remote command.
    assert.deepStrictEqual(roles('ssh host ls -l'), ['host: DESTINATION', 'ls: command shell-string@remote', '-l: joined']);
    assert.deepStrictEqual(roles('ssh -p 22 host -t ls -l').map((l) => l.split(':')[0] + ':' + l.split(': ')[1].split(' ')[0]), ['-p:-p', '22:value', 'host:DESTINATION', '-t:-t', 'ls:command', '-l:joined']);
  });

  it('flock: options end at the file, except `-c` right after it', () => {
    // `flock /tmp/l -n true`: "failed to execute -n".
    assert.deepStrictEqual(roles('flock /tmp/l -n true'), ['/tmp/l: LOCK', '-n: command exec -n (unknown)', '  true: operand']);
    assert.deepStrictEqual(roles("flock -n /tmp/l -c 'x'"), ['-n: -n fail instead of waiting if the lock is taken', '/tmp/l: LOCK', '-c: -c command string to run with the shell', "'x': command shell-string"]);
    assert.deepStrictEqual(roles("flock /tmp/l --command 'x'").slice(1, 2), ['--command: --command command string to run with the shell']);
  });

  it('a language of the operands does not carry over to the alternatives an option chooses', () => {
    const lang = (line: string) => parseOf(line).roles.flatMap((r) => (r.role.role === 'operand' ? [r.role.spec?.lang ?? '-'] : []));
    // `chmod --reference=r u+x`: `u+x` is a file (chmod: cannot access 'u+x').
    assert.deepStrictEqual(lang('chmod --reference=r u+x'), ['-']);
    assert.deepStrictEqual(lang('chmod u+x f'), ['mode', '-']);
    // `echo -e -E`: the last one decides.
    const echo = (line: string) => parseOf(line).roles.flatMap((r) => (r.role.role === 'operand' ? [r.role.spec?.lang ?? '-'] : []));
    assert.deepStrictEqual([echo('echo -e x'), echo('echo -e -E x'), echo('echo -Ee x'), echo('echo x')], [['echo'], ['-'], ['echo'], ['-']]);
  });

  it('a word that may be several words: the role is certain only when it is the same for any count', () => {
    assert.deepStrictEqual(roles('cp {a,b} dir'), ['{a,b}: ARG1', 'dir: ARG3']);
    assert.deepStrictEqual(roles('cp *.txt dir'), ['*.txt: ARG1', 'dir: ARG2 (uncertain)']);
    assert.deepStrictEqual(roles('cp "$@" dir'), ['"$@": ARG1', 'dir: ARG2 (uncertain)']);
    // (A brace expansion gives known words: each has its role, in `each`.)
    assert.deepStrictEqual(roles('cp {a,b}'), ['{a,b}: ARG1']);
    // Only the many-words reading fits.
    const three: CommandSpec = { summary: t('three'), operands: [{ pattern: [item('A'), item('B'), item('C')] }] };
    assert.deepStrictEqual(render(interpret(three, [{ value: 'x', count: { min: 0 } }]), ['$x']), ['$x: A (uncertain)']);
    // When more words fit nothing, the one reading that fits stands.
    const two: CommandSpec = { summary: t('two'), operands: [{ pattern: [item('A'), item('B')] }] };
    assert.deepStrictEqual(render(interpret(two, [{ value: 'x', count: { min: 1, max: 5 } }, { value: 'y' }]), ['$x', 'y']), ['$x: A', 'y: B']);
  });

  it('a word that may give none: the role the words after it take when it gives none, where that is another', () => {
    const none = (line: string, spec?: CommandSpec): string[] => {
      const { texts } = argWords(line);
      return parseOf(line, spec).roles.flatMap(({ word, role }) => (role.role === 'operand' && role.none ? [`${texts[word]}: ${role.none.words.map((w) => texts[w]).join(' ')} → ${role.none.spec.name}`] : []));
    };
    // `cp $a b` with `$a` empty is `cp b`, a source; `grep -c $x f` reads `f` as the pattern; `cp $a b c` copies `b` to `c`.
    assert.deepStrictEqual(none('cp $a b'), ['b: $a → ARG1']);
    assert.deepStrictEqual(none('grep -c $x f'), ['f: $x → ARG1']);
    assert.deepStrictEqual(none('cp $a b c'), ['c: $a → ARG2']);
    // (Each word that may give none is read with the others gone: `$b` is a source when `$a` gives none.)
    assert.deepStrictEqual([none('cp $a $b'), none('cp $a $b c')], [['$b: $a → ARG1'], ['c: $a $b → ARG1']]);
    // (None where the role stays, nor for the words of a brace expansion, nor where no form fits the words left.)
    assert.deepStrictEqual([none('rm $a b'), none('cp $a {b,c}'), none('cp "$a" b')], [[], [], []]);
    const two: CommandSpec = { summary: t('two'), operands: [{ pattern: [item('A'), item('B')] }] };
    assert.deepStrictEqual(none('f $a y', two), []);
    assert.ok(parseOf('cp $a b').roles.every(({ word, role }) => word === 0 || (role.role === 'operand' && role.uncertain)));
  });

  it('counts the words of `"$@"` and the like as bash gives them: none or more, one or more with text beside them', () => {
    const counts = (line: string): string[] => argWords(line).words.map((w) => (w.count ? `${w.count.min}+` : '1'));
    // (Every expansion that gives one word per element, in double quotes: `${@:2}`, a pattern, the keys.)
    const none = ['"$@"', '"${@:2}"', '"${a[@]/x/y}"', '"${!a[@]}"', '"$@$x"', '$x$y', '$x"$@"'];
    // (Text beside them, in the quotes or not, or an empty string, makes one word when there are none.)
    const one = ['"pre$@post"', 'pre"$@"post', '"$@"""', '"$@"\'\'', '$x/a', '"${a[@]}"x'];
    // (Not one per element: a length, a quoted `"$@"`, a variable in quotes.)
    const plain = ['"${#a[@]}"', '\'"$@"\'', '"$x"'];
    const words = [...none, ...one, ...plain];
    assert.deepStrictEqual(counts(`f ${words.join(' ')}`), [...none.map(() => '0+'), ...one.map(() => '1+'), ...plain.map(() => '1')]);
    // In bash, with no positional parameters, an empty array and empty variables: as many words as the least count.
    const fields = (w: string, setup: string): string => runBash(`${setup}; f() { echo $#; }; f ${w}`).stdout.trim();
    assert.deepStrictEqual(words.map((w) => fields(w, 'set --; a=(); x=; y=')), [...none.map(() => '0'), ...one.map(() => '1'), ...plain.map(() => '1')]);
    // With two elements, one word each: `"pre$@post"` joins the text to the first and the last.
    assert.deepStrictEqual(['"$@"', '"pre$@post"', '"${@:2}"'].map((w) => runBash(`set -- a 'b c'; printf '<%s>' ${w}`).stdout), ['<a><b c>', '<prea><b cpost>', '<b c>']);
  });

  it('records the alternative the operands fit; operands the spec does not describe are not unmatched', () => {
    assert.strictEqual(parseOf('cp a b').alternative, 0);
    assert.strictEqual(parseOf('cp a b c').alternative, 1);
    const p = parseOf('true a b');
    assert.deepStrictEqual([p.unmatched, p.alternative, render(p, ['a', 'b'])], [[], undefined, ['a: operand', 'b: operand']]);
  });

  it('reads more values, and `-f=FORMAT` for dpkg', () => {
    const spec: CommandSpec = cmd('n', 'n', [['--three', 't', 'three', 'arg3']]);
    assert.deepStrictEqual(roles('n --three a b c d', spec), ['--three: --three three', 'a: value 0 of --three VALUE1', 'b: value 1 of --three VALUE2', 'c: value 2 of --three VALUE3', 'd: operand']);
    // `dpkg-query -W -f=X bash` prints `X`: the value starts after the `=`.
    assert.deepStrictEqual(roles("dpkg-query -W -f='${Package}' bash")[1].split(':')[0] + roles("dpkg-query -W -f='${Package}' bash")[1].replace(/.*: -f=(\d).*/, ' $1'), "-f='${Package}' 3");
    assert.match(roles('cut -f=2 x')[0], /-f=2 /);
  });
});

describe('argv specs: the dictionary entries `cmd` builds', () => {
  it('turns the tuples and the shorthand into the spec', () => {
    const spec = cmd('x', 'x', [
      ['-q|--query', 'q', 'query'], ['-i', 'i', 'install'], ['-f', 'f', 'file', 'arg fills'],
    ], {
      positional: [tx('a', 'pattern'), tx('b', 'file')],
      subcommands: { run: cmd('r', 'run', [], { optionsFirst: true, operands: [{ pattern: [{ name: 'NAME=VALUE', text: tx('v', 'v'), assignment: true, repeat: '*' }, runs()] }] }) },
    });
    assert.deepStrictEqual(spec.operands![0], { when: { option: ['-f'] }, pattern: [{ name: 'ARG2', text: tx('b', 'file'), repeat: '*' }] });
    assert.deepStrictEqual(roles('x -qi a', spec), ['-qi: cluster -q query | -i install', 'a: ARG1']);
    assert.deepStrictEqual(roles('x run A=1 ls', spec), ['run: subcommand run', '  A=1: NAME=VALUE (assignment)', '  ls: command exec ls']);
    // An entry without options.
    assert.deepStrictEqual(cmd('s', 's').options, []);
    // A name given twice in one list is a mistake; a name of the overrides means what it says there.
    assert.throws(() => cmd('n', 'n', [['-q', 'q', 'quiet'], ['-a|-q', 'a', 'again']]), /-q: an option named twice/);
    assert.throws(() => mergeOptions([], [opt('-q', 'q'), opt('-q', 'again')]), /-q: an option named twice/);
    const merged = mergeOptions([opt('-a|--all', 'all'), opt('-p|--project', 'project'), opt('-q', 'quiet')], [opt('-p|--publish', 'publish'), opt('-a', 'again'), opt('-q', 'quiet again')]);
    assert.deepStrictEqual(merged.map((o) => `${o.names.join('|')} ${o.text.en}`), ['--all all', '--project project', '-p|--publish publish', '-a again', '-q quiet again']);
  });

  it('builds the operand patterns of `byCount`', () => {
    const by = (line: string): string[] =>
      parseOf(line, cmd('p', 'p', [['-t', 't', 't']], {
        positional: [tx('d', 'default')],
        operands: [
          byCount(2, [tx('a', 'a'), tx('b', 'b'), tx('c', 'c')], { orMore: true, last: tx('z', 'z') }),
          byCount(1, [tx('t', 't')], { when: '-t' }),
          byCount(1, [tx('u', 'u')], { unless: '-t' }),
        ],
      })).roles.flatMap((r) => (r.role.role === 'operand' ? [r.role.spec?.text.en ?? '?'] : []));
    assert.deepStrictEqual(by('p 1 2'), ['a', 'z']);
    assert.deepStrictEqual(by('p 1 2 3 4 5'), ['a', 'b', 'c', 'c', 'z']);
    assert.deepStrictEqual(by('p -t 1'), ['t']);
    assert.deepStrictEqual(by('p 1'), ['u']);
    assert.deepStrictEqual(by('p'), []);
  });

  it('gives the wrappers their command slots', () => {
    const slot = (line: string) => {
      const p = parseOf(line);
      const c = p.roles.find((r) => r.role.role === 'command')!.role;
      return c.role === 'command' ? c.slot : undefined;
    };
    assert.deepStrictEqual(slot('command ls'), { run: 'current-shell', lookup: 'no-functions' });
    assert.deepStrictEqual(slot('builtin cd'), { run: 'current-shell', lookup: 'builtins-only' });
    assert.deepStrictEqual(slot('exec ls'), { run: 'exec', replacesShell: true });
    assert.deepStrictEqual(slot('chroot /mnt ls'), { run: 'exec' });
    const k = parseOf('kubectl exec pod -- ls').roles[0].role;
    assert.ok(k.role === 'subcommand' && k.parse.roles[2].role.role === 'command');
    // A positional language applies to its own index only.
    const tr = lookupCommand('tr')!.operands!.at(-1)!.pattern;
    assert.deepStrictEqual(tr.map((x) => [x.repeat, x.lang]), [['?', 'trset'], ['?', 'trset'], ['*', undefined]]);
    // `let`: every operand is arithmetic.
    assert.deepStrictEqual(lookupCommand('let')!.operands!.at(-1)!.pattern.map((x) => [x.repeat, x.lang, x.type]), [['*', 'arith', 'arith']]);
    assert.strictEqual(lookupCommand('set')!.builtin, 'special');
    assert.strictEqual(lookupCommand('cd')!.builtin, 'regular');
    assert.strictEqual(lookupCommand('shopt')!.operands!.at(-1)!.pattern[0].type, 'shell-option');
    // `echo -e`: the operands are read with escapes.
    assert.strictEqual(parseOf('echo -e x').roles[1].role.role === 'operand' && (parseOf('echo -e x').roles[1].role as { spec: OperandSpec }).spec.lang, 'echo');
  });
});

describe('argv interpreter: subcommands found as cobra does', () => {
  const tool: CommandSpec = {
    summary: t('tool'), parser: 'cobra',
    options: [
      opt('-n|--namespace', 'namespace', { persistent: true, value: { name: 'NS' } }),
      opt('--debug', 'debug', { persistent: true }),
      opt('--level', 'level', { persistent: true, value: { name: 'L', optional: true } }),
      opt('--version', 'version'),
      opt('-c|--config', 'config', { value: { name: 'FILE' } }),
    ],
    subcommands: {
      get: { summary: t('get'), options: [opt('-o|--output', 'output', { value: { name: 'FORMAT' } }), opt('-w|--watch', 'watch')], operands: [{ pattern: [item('NAME', { repeat: '*' })] }] },
      pr: {
        summary: t('pr'), options: [opt('-R|--repo', 'repo', { persistent: true, value: { name: 'REPO' } }), opt('-c|--closed', 'closed')],
        subcommands: { list: { summary: t('list'), options: [opt('-L', 'limit', { value: { name: 'N' } })] } },
      },
      ls: { summary: t('ls') },
    },
  };
  const of = (line: string) => roles(line, tool);

  it("reads a subcommand's own options before its name, and the program's after it", () => {
    assert.deepStrictEqual(of('tool -o yaml get x'), ['-o: -o output', 'yaml: value 0 of -o FORMAT', 'get: subcommand get', '  x: NAME']);
    assert.deepStrictEqual(of('tool -n p --debug get -w x -n q'), [
      '-n: -n namespace', 'p: value 0 of -n NS', '--debug: --debug debug', 'get: subcommand get', '  -w: -w watch', '  x: NAME', '  -n: -n namespace', '  q: value 0 of -n NS',
    ]);
    // The subcommands of a subcommand are found the same way.
    assert.deepStrictEqual(of('tool -R o/r pr -L 5 list'), [
      '-R: -R repo', 'o/r: value 0 of -R REPO', 'pr: subcommand pr', '  -L: -L limit', '  5: value 0 of -L N', '  list: subcommand list',
    ]);
  });

  it('takes the word after an option it does not know as its value, as cobra guesses', () => {
    // (`-w` is known to `get` only: cobra takes `get` as its value, and `x` is not a subcommand.)
    assert.deepStrictEqual(of('tool -w get x'), ['-w: -w?', 'get: value 0 of -w', 'x: operand']);
    assert.deepStrictEqual(of('tool --foo get x'), ['--foo: --foo?', 'get: value 0 of --foo', 'x: operand']);
    // Not with `=`, nor several letters, nor an option known here with no value or an optional one.
    assert.deepStrictEqual(of('tool --watch=true get x'), ['--watch=true: --watch=8 watch', 'get: subcommand get', '  x: NAME']);
    assert.deepStrictEqual(of('tool -wx get'), ['-wx: cluster -w watch | -x?', 'get: subcommand get']);
    assert.deepStrictEqual(of('tool --level get x'), ['--level: --level level', 'get: subcommand get', '  x: NAME']);
    // (cobra took `x` as the value of `-w` to find `get`; `get` then reads `-w` as its own flag, and `x` is an argument.)
    assert.deepStrictEqual(of('tool -w x get'), ['-w: -w watch', 'x: operand', 'get: subcommand get']);
    // Nothing to take at the end; a word not known, `--` and a word that names no subcommand end the search.
    assert.deepStrictEqual(of('tool -x'), ['-x: -x?']);
    assert.deepStrictEqual(of('tool -n'), ['-n: -n (no value) namespace']);
    assert.deepStrictEqual(of('tool $v get'), ['$v: operand', 'get: operand']);
    assert.deepStrictEqual(of('tool -- get'), ['--: end of options', 'get: operand']);
    assert.deepStrictEqual(of('tool nope get'), ['nope: operand', 'get: operand']);
    // cobra skips empty words.
    assert.deepStrictEqual(of("tool '' get x"), ["'': operand", 'get: subcommand get', '  x: NAME']);
  });

  it("searches the words before the subcommand again with the subcommand's options, as cobra does", () => {
    // (`pr` does not know `--version`, a flag of the program only: cobra takes `list` as its value, runs `pr`, and refuses `--version`.)
    assert.deepStrictEqual(of('tool --version pr list'), ['--version: --version?', 'pr: subcommand pr', '  list: operand']);
    assert.deepStrictEqual(of('tool --repo o/r pr list'), ['--repo: --repo repo', 'o/r: value 0 of --repo REPO', 'pr: subcommand pr', '  list: subcommand list']);
    // (`pr` reads `-c` with no value, so cobra's next word is `list`, before `pr`: it is not shown as a subcommand.)
    assert.deepStrictEqual(of('tool -c list pr'), ['-c: -c closed', 'list: operand', 'pr: subcommand pr']);
    // (A subcommand with no options of its own: the persistent ones only, and `--version` is refused.)
    assert.deepStrictEqual(of('tool --debug --version ls'), ['--debug: --debug debug', '--version: --version?', 'ls: subcommand ls']);
  });
});

describe('argv interpreter: a value whose words are read in its place (env -S)', () => {
  it("reads the words of the string, then the rest of the line, as env's own", () => {
    assert.deepStrictEqual(roles("env -S'-i A=1' printf x"), [
      "-S'-i A=1': -S=2 split a string into words and read them in its place as env's arguments (options, `NAME=value`, the command to run and its arguments; useful in shebang lines)",
      '  » -i: -i start with an empty environment', '  » A=1: NAME=VALUE (assignment)',
      'printf: command exec printf', '  x: FORMAT',
    ]);
    const short = (line: string) => roles(line).map((l) => l.replace(/ split a string into words.*$/, ''));
    // A command started in the string takes the words after it; they keep their place in the line.
    assert.deepStrictEqual(short("env -S 'cmd -a' x"), ['-S: -S', "'cmd -a': value 0 of -S STRING", '  » cmd: command exec cmd (unknown)', '    » -a: -a?', 'x: operand']);
    assert.deepStrictEqual(short("env -vS'cmd' x"), ["-vS'cmd': cluster -v print each step on stderr | -S=3", '  » cmd: command exec cmd (unknown)', 'x: operand']);
    assert.deepStrictEqual(short("env --split-string='A=1' cmd"), ["--split-string='A=1': --split-string=15", '  » A=1: NAME=VALUE (assignment)', 'cmd: command exec cmd (unknown)']);
    // An assignment ends the options: a later `-i` is the command (GNU env).
    assert.deepStrictEqual(short("env -S'A=1 -i' cmd"), ["-S'A=1 -i': -S=2", '  » A=1: NAME=VALUE (assignment)', '  » -i: command exec -i (unknown)', 'cmd: operand']);
    // A string in the string; a command run by another one; a word whose text is known at run time only.
    assert.deepStrictEqual(short(`env -S'-S"cmd a"' b`), [`-S'-S"cmd a"': -S=2`, '  » -Scmd a: -S=2', '    » » cmd: command exec cmd (unknown)', '      » » a: operand', 'b: operand']);
    assert.deepStrictEqual(short("sudo env -S'cmd' x"), ['env: command exec env', "  -S'cmd': -S=2", '    » cmd: command exec cmd (unknown)', '  x: operand']);
    assert.deepStrictEqual(short("env -S'x${HOME}' y"), ["-S'x${HOME}': -S=2", '  » x…: command exec (unknown)', 'y: operand']);
    // (`-S''` is `-S` alone: it takes the next word.)
    assert.deepStrictEqual(short("env -S'' cmd"), ["-S'': -S", 'cmd: value 0 of -S STRING', '  » cmd: command exec cmd (unknown)']);
  });

  it('leaves a string it cannot split to the condition `unsplit`: not known, refused, missing', () => {
    const short = (line: string) => roles(line).map((l) => l.replace(/ split a string into words.*$/, ''));
    assert.deepStrictEqual(short('env -S"$v" cmd'), ['-S"$v": -S=2', 'cmd: ARG']);
    assert.deepStrictEqual(short(`env -S'"a' cmd`), [`-S'"a': -S=2`, '  refused: quote "a', 'cmd: ARG']);
    assert.deepStrictEqual(short('env -S'), ['-S: -S (no value)']);
  });

  it('splits as GNU env does (compared with env itself in test/wrappers-real.test.ts)', () => {
    const split = (s: string) => {
      const r = splitEnvString(s);
      return 'error' in r ? `${r.error}: ${r.at}` : 'unknown' in r ? 'unknown' : r.words.map((w) => (w.value !== undefined ? w.value : `${w.prefix}…${w.count ? `{${w.count.min},${w.count.max}}` : ''}`));
    };
    assert.deepStrictEqual(split(' a\tb  c '), ['a', 'b', 'c']);
    assert.deepStrictEqual(split(String.raw`a\_b "c\_d" 'e\_f' 'g\\h\'i'`), ['a', 'b', 'c d', String.raw`e\_f`, "g\\h'i"]);
    assert.deepStrictEqual(split(String.raw`a\"\#\$\'\\ \f\n\r\t\v`), ['a"#$\'\\', '\f\n\r\t\v']);
    assert.deepStrictEqual(split(`'' a""b x#y #z`), ['', 'ab', 'x#y']);
    assert.deepStrictEqual(split(String.raw`a\cb c`), ['a']);
    assert.deepStrictEqual(split(`'a"b' "c'd"`), ['a"b', "c'd"]);
    assert.deepStrictEqual(split('${A} x${B}y "${C}" \'${D}\''), ['…{0,1}', 'x…', '…', '${D}']);
    assert.strictEqual(split('"a'), 'quote: "a');
    assert.strictEqual(split('a\\'), 'backslash-end: \\');
    assert.strictEqual(split('a\\x'), 'sequence: \\x');
    assert.strictEqual(split('"\\c"'), 'c-in-quotes: \\c');
    assert.strictEqual(split('a $B'), 'dollar: $B');
    // `#` after a word of `${…}` only starts a comment when the variables are unset.
    assert.strictEqual(split('${A}#x y'), 'unknown');
    assert.strictEqual(split('${A}${B}#'), 'unknown');
    assert.deepStrictEqual(split('a${A}#x ""${B}#y'), ['a…', '…']);
    assert.deepStrictEqual(roles("env -S'${A}#x' cmd").slice(1), ['cmd: ARG']);
  });
});
