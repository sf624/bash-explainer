// The argument interpreter (src/argv/interpret.ts): the worked examples of the design, commands of the
// dictionary through the converter (src/argv/fromdoc.ts), and the corners of the option grammar.
import * as assert from 'assert';
import { lookupCommand } from '../src/analyzer';
import { fromCommandDoc } from '../src/argv/fromdoc';
import { ArgWord, interpret, InterpretContext, match } from '../src/argv/interpret';
import type { CommandSpec, OperandSpec, OptionSpec } from '../src/argv/spec';
import { builtins } from '../src/dict/builtins';
import { commands } from '../src/dict/commands';
import { CommandDoc, cmd } from '../src/dict/types';
import { tx } from '../src/i18n';
import { argWords, render } from './support/argwords';
// (Types only: loaded so that its coverage is measured.)
import '../src/argv/spec';

const t = (en: string) => tx(en, en);
const lookup = (name: string): CommandSpec | undefined => {
  const doc = lookupCommand(name);
  return doc && fromCommandDoc(doc, name.slice(name.lastIndexOf('/') + 1));
};
/** The roles of the words of `line`, read with `spec` (by default the dictionary's entry, converted). */
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
    summary: t('Run a command with a time limit'), style: 'posix',
    options: [
      opt('-s|--signal', 'signal to send on timeout', { value: { name: 'SIGNAL', type: 'signal' } }),
      opt('-k|--kill-after', 'send KILL later', { value: { name: 'DURATION', type: 'duration' } }),
      opt('--preserve-status', 'exit with the status of the command'),
    ],
    longPrefixes: true,
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
      '  ls: command exec ls', '    *.log: ARG1',
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
    assert.deepStrictEqual(roles("jq -n --args '$ARGS' a b").slice(2), ["'$ARGS': ARG1", 'a: ARG2', 'b: ARG2']);
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
    assert.deepStrictEqual(roles('kill -sigint 1').slice(0, 1), ['-sigint: pattern Send the signal `INT` (same as `-s INT`; `kill -l` lists them)']);
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
    assert.deepStrictEqual(roles("bash -c 'cmd' a b"), ['-c: -c run the following string as a command', "'cmd': command shell-string", 'a: NAME', 'b: ARG']);
    assert.deepStrictEqual(roles('bash -ex script.sh -x'), ['-ex: cluster -e exit on error | -x trace commands', 'script.sh: SCRIPT', '-x: ARG']);
    assert.deepStrictEqual(roles('bash -s a'), ['-s: -s read commands from stdin', 'a: ARG']);
    // `su -c`: the value of `-c` is a shell string.
    const su = parseOf("su -c 'ls' user").roles[1].role;
    assert.ok(su.role === 'value' && su.spec?.command?.run === 'shell-string');
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
    assert.deepStrictEqual(roles('xargs -r$x'), ['-r$x: command exec (unknown)']);
  });

  it('`--` ends the options, except for echo; a builtin reads options before its first operand', () => {
    assert.deepStrictEqual(roles('rm -- -f x'), ['--: end of options', '-f: ARG1', 'x: ARG1']);
    assert.deepStrictEqual(roles('rm -f -- -x').map((l) => l.split(':')[0]), ['-f', '--', '-x']);
    assert.deepStrictEqual(roles('echo -- -n'), ['--: ARG1', '-n: ARG1']);
    assert.deepStrictEqual(roles('echo -ne x -n'), ['-ne: cluster -n do not print the trailing newline | -e interpret backslash escapes like `\\n`', 'x: ARG1', '-n: ARG1']);
    assert.deepStrictEqual(roles('echo -nx'), ['-nx: ARG1']);
    // A word in quotes is an option all the same: the program sees no quotes.
    assert.deepStrictEqual(roles('ls "-l" "--all"').map((l) => l.split(':')[0] + ':' + l.split(':')[1].split(' ')[1]), ['"-l":-l', '"--all":--all']);
    // A builtin: options before the first operand only.
    assert.deepStrictEqual(roles('printf %s -v'), ['%s: ARG1', '-v: ARG2']);
    assert.deepStrictEqual(roles('let -1+2'), ['-1+2: ARG1']);
  });

  it('set: `+` turns options off, and `-o` takes the next word even inside a cluster', () => {
    assert.deepStrictEqual(roles('set -euo pipefail'), ['-euo: cluster -e exit immediately if a command fails | -u treat unset variables as an error | -o enable an option by name', 'pipefail: value 0 of -o VALUE']);
    assert.deepStrictEqual(roles('set -oe pipefail').slice(1), ['pipefail: value 0 of -o VALUE']);
    assert.deepStrictEqual(roles('set +x +o xtrace'), ['+x: -x (off) print each command after expansion (debugging)', '+o: -o (off) enable an option by name', 'xtrace: value 0 of -o VALUE']);
    assert.deepStrictEqual(roles('set +ex')[0], '+ex: cluster -e (off) exit immediately if a command fails | -x (off) print each command after expansion (debugging)');
    assert.deepStrictEqual(roles('set -- a').map((l) => l.split(':')[0]), ['--', 'a']);
  });

  it('awk: operands that look like `name=value` are assignments', () => {
    const p = parseOf("awk '{print}' n=1 f");
    assert.deepStrictEqual(p.roles.map((r) => (r.role.role === 'operand' ? !!r.role.assignment : undefined)), [false, true, false]);
  });

  it('find: the options before the paths, then the expression for its own parser', () => {
    const p = parseOf('find -L . /tmp -name x -exec rm {} +');
    assert.deepStrictEqual(render(p, argWords('find -L . /tmp -name x').texts), ['-L: -L follow symbolic links', '.: ARG1', '/tmp: ARG1']);
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
    longPrefixes: true,
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
    assert.deepStrictEqual(roles('t -an', spec), ['-an: cluster -a all | -n lines']);
    assert.deepStrictEqual(roles('t -n', spec), ['-n: -n lines']);
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
    assert.deepStrictEqual(roles('t --lines=$n --$x --lines$x', spec), ['--lines=$n: --lines=8 lines', '--$x: FILE', '--lines$x: FILE']);
  });

  it('reads the words up to a terminator as a command', () => {
    assert.deepStrictEqual(roles('t --exec rm {} \\; f', spec), ['--exec: --exec exec', 'rm: command exec rm', '  {}: ARG1', '\\;: terminator', 'f: FILE']);
    assert.deepStrictEqual(roles('t --exec + f', spec), ['--exec: --exec exec', '+: terminator', 'f: FILE']);
    assert.deepStrictEqual(roles('t --exec rm x', spec), ['--exec: --exec exec', 'rm: command exec rm', '  x: ARG1']);
  });

  it('reads single-dash options', () => {
    const sd: CommandSpec = { summary: t('sd'), style: 'single-dash', options: [opt('-var-file', 'variables file', { value: { name: 'FILE' } }), opt('-v', 'v')] };
    assert.deepStrictEqual(roles('sd -var-file=x -var-file y -nope -no=1 -v$x a -vx$y', sd), [
      '-var-file=x: -var-file=10 variables file', '-var-file: -var-file variables file', 'y: value 0 of -var-file FILE', '-nope: -nope?', '-no=1: -no=1?', '-v$x: operand', 'a: operand', '-vx$y: operand',
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
    assert.deepStrictEqual(match(seq, w('5'), 100), [2]);
    assert.deepStrictEqual(match(seq, w('1 5'), 100), [0, 2]);
    assert.deepStrictEqual(match(seq, w('1 2 5'), 100), [0, 1, 2]);
    assert.strictEqual(match(seq, w('1 2 3 4'), 100), undefined);
    const many = [item('A', { repeat: '*' }), item('B', { repeat: '*' }), item('C', { repeat: '*' }), item('D')];
    const words = w('a b c d e f g h i j k l m n o p');
    assert.ok(match([...many, item('E')], words, 100000));
    assert.strictEqual(match([...many, item('E'), item('F', { assignment: true })], words, 50), undefined);
    // The cap reaches the interpreter: the operands are left unmatched.
    const spec: CommandSpec = { summary: t('m'), operands: [{ pattern: [...many, item('E')] }] };
    assert.deepStrictEqual(roles('m a b c d e f', spec, { maxSteps: 5 }), ['a: operand', 'b: operand', 'c: operand', 'd: operand', 'e: operand', 'f: operand']);
    assert.deepStrictEqual(roles('m a b', spec), ['a: D', 'b: E']);
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
  });

  it('reads `--` that starts words of another pattern, and a `--` that is text', () => {
    const literal: CommandSpec = { summary: t('l'), dashDash: 'literal', options: [opt('-n', 'n')] };
    assert.deepStrictEqual(roles('l -- -n', literal), ['--: operand', '-n: -n n']);
    const then: CommandSpec = { summary: t('t'), dashDash: { then: [item('EXTRA', { repeat: '*' })] }, operands: [{ pattern: [item('A', { repeat: '*' })] }] };
    assert.deepStrictEqual(roles('t a -- -b c', then), ['a: A', '--: end of options', '-b: EXTRA', 'c: EXTRA']);
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
    assert.deepStrictEqual(roles('echo -n$x a'), ['-n$x: ARG1', 'a: ARG1']);
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

describe('argv converter: dictionary entries to specs', () => {
  it('converts every entry of the dictionary', () => {
    const all: [string, CommandDoc][] = [...Object.entries(commands), ...Object.entries(builtins)];
    for (const [name, doc] of all) {
      const spec = fromCommandDoc(doc, name);
      // Every option with a value in the dictionary has one in the spec, under the same names.
      for (const [n, o] of Object.entries(doc.options ?? {})) {
        if (name === 'find' || (doc.shellC && n === '-c')) continue;
        const s = spec.options!.find((x) => x.names.includes(n));
        assert.ok(s, `${name} ${n}`);
        assert.strictEqual(!!(s.value || s.until), !!(o.arg || o.attachedOnly || o.nextIf || o.untilTerminator), `${name} ${n}`);
      }
    }
  });

  it('turns the special fields into the spec', () => {
    const doc = cmd('x', 'x', [
      ['-q|--query', 'q', 'query'], ['-i', 'i', 'install'], ['-f', 'f', 'file', 'arg fills'],
    ], {
      positional: [tx('a', 'pattern'), tx('b', 'file')],
      bundle: { options: { k: { text: tx('k', 'k'), arg: true } }, needs: 'k', style: tx('s', 'style') },
      subcommands: { run: cmd('r', 'run', [], { wraps: true, assigns: true }) },
    });
    doc.options!['-i'].inMode = { when: '-q|--query', text: tx('情報', 'info') };
    const spec = fromCommandDoc(doc, 'x');
    assert.deepStrictEqual(spec.modes, [{ name: '-q|--query' }]);
    assert.strictEqual(spec.options!.find((o) => o.names.includes('-q'))!.selects, '-q|--query');
    assert.deepStrictEqual(spec.oldStyle!.needs, 'k');
    assert.deepStrictEqual(Object.keys(spec.oldStyle!.letters!), ['k']);
    assert.deepStrictEqual(spec.operands![0], { when: { option: ['-f'] }, pattern: [{ name: 'ARG2', text: tx('b', 'file'), repeat: '*' }] });
    assert.deepStrictEqual(roles('x -qi a', spec), ['-qi: cluster -q query | -i info', 'a: ARG1']);
    assert.deepStrictEqual(roles('x run A=1 ls', spec), ['run: subcommand run', '  A=1: NAME=VALUE (assignment)', '  ls: command exec ls']);
    // An entry without options.
    assert.deepStrictEqual(fromCommandDoc({ summary: tx('s', 's') }).options, []);
    // A bundle without options of its own uses the `-x` options.
    assert.strictEqual(fromCommandDoc(cmd('y', 'y', [], { bundle: {} }), 'y').oldStyle!.letters, undefined);
  });

  it('builds the operand patterns of `positionalBy`', () => {
    const by = (rules: CommandDoc['positionalBy'], line: string): string[] =>
      parseOf(line, fromCommandDoc(cmd('p', 'p', [['-t', 't', 't']], { positional: [tx('d', 'default')], positionalBy: rules }), 'p'))
        .roles.flatMap((r) => (r.role.role === 'operand' ? [r.role.spec?.text.en ?? '?'] : []));
    const rules: CommandDoc['positionalBy'] = [
      { count: 2, texts: [tx('a', 'a'), tx('b', 'b'), tx('c', 'c')], orMore: true, last: tx('z', 'z') },
      { count: 1, when: '-t', texts: [tx('t', 't')] },
    ];
    assert.deepStrictEqual(by(rules, 'p 1 2'), ['a', 'z']);
    assert.deepStrictEqual(by(rules, 'p 1 2 3 4 5'), ['a', 'b', 'c', 'c', 'z']);
    assert.deepStrictEqual(by(rules, 'p -t 1'), ['t']);
    assert.deepStrictEqual(by(rules, 'p 1'), ['default']);
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
    const tr = fromCommandDoc(lookupCommand('tr')!, 'tr').operands!.at(-1)!.pattern;
    assert.deepStrictEqual(tr.map((x) => [x.repeat, x.lang]), [['?', 'trset'], ['?', 'trset'], ['*', undefined]]);
    // `let`: every operand is arithmetic.
    assert.deepStrictEqual(fromCommandDoc(lookupCommand('let')!, 'let').operands!.at(-1)!.pattern.map((x) => [x.repeat, x.lang, x.type]), [['*', 'arith', 'arith']]);
    assert.strictEqual(fromCommandDoc(lookupCommand('set')!, 'set').builtin, 'special');
    assert.strictEqual(fromCommandDoc(lookupCommand('cd')!, 'cd').builtin, 'regular');
    assert.strictEqual(fromCommandDoc(lookupCommand('shopt')!, 'shopt').operands!.at(-1)!.pattern[0].type, 'shell-option');
    // `echo -e`: the operands are read with escapes.
    assert.strictEqual(parseOf('echo -e x').roles[1].role.role === 'operand' && (parseOf('echo -e x').roles[1].role as { spec: OperandSpec }).spec.lang, 'echo');
  });
});
