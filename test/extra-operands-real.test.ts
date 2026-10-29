// Words past the operands a tool takes, compared with the real tools (GNU coreutils and diffutils, procps pgrep,
// util-linux mountpoint and look, xxd, getconf): the interpreter marks as extra operands the words the tool refuses
// ("extra operand", "too many templates"…), and only those, and a hedge says so for the counts of words where the tool
// refuses them. Each tool runs in a directory of its own; a missing tool is skipped. mknod runs only where it makes
// a pipe or refuses (a device node is never made).
import * as assert from 'assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { lookupCommand } from '../src/analyzer';
import { interpret, type OperandRole } from '../src/argv/interpret';
import { Analyzer } from '../src/analyzer';
import type { OperandSpec } from '../src/argv/spec';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import type { Token } from '../src/analyzer-types';
import { argWords } from './support/argwords';
import { runContained } from './support/contained';
import { run } from './support/run';

const ENV = { ...process.env, LC_ALL: 'C', TZ: 'UTC' };
const has = (tool: string): boolean => spawnSync('bash', ['--norc', '-c', `command -v ${tool}`]).status === 0;
/** The builds whose limits the tests follow (`--version` says which); another build is skipped. */
const BUILDS: Record<string, RegExp> = { cmp: /GNU diffutils/, diff: /GNU diffutils/, sdiff: /GNU diffutils/, diff3: /GNU diffutils/, pgrep: /procps/, mountpoint: /util-linux/, look: /util-linux/, xxd: /xxd/ };
const usable = new Map<string, boolean>();
const usableTool = (tool: string): boolean => {
  if (!usable.has(tool)) {
    const version = has(tool) ? spawnSync(tool, tool === 'getconf' ? ['-a'] : ['--version'], { env: ENV, encoding: 'utf8' }) : undefined;
    const text = `${version?.stdout ?? ''}${version?.stderr ?? ''}`;
    usable.set(tool, !!version && (tool === 'getconf' ? /PATH/.test(text) : (BUILDS[tool] ?? /GNU coreutils/).test(text)));
  }
  return usable.get(tool)!;
};

/** The words of `line` and the roles the interpreter gives them. */
function read(line: string): { tool: string; words: string[]; roles: (OperandRole | undefined)[] } {
  const { name, words, texts } = argWords(line);
  const parse = interpret(lookupCommand(name)!, words, { name, lookup: lookupCommand });
  const roles: (OperandRole | undefined)[] = texts.map(() => undefined);
  for (const { word, role } of parse.roles) if (role.role === 'operand') roles[word] = role;
  return { tool: name, words: texts, roles };
}

const extraOf = (spec: OperandSpec | undefined) => spec?.extra;

let dir: string;
before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extra-operands-real-'));
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));

/** Runs `line` (literal words) in a directory of its own with the files `f1` to `f3`. */
function runLine(line: string): { status: number; err: string } {
  const cwd = fs.mkdtempSync(path.join(dir, 'run-'));
  for (const [f, text] of [['f1', 'a\nb\n'], ['f2', 'b\nc\n'], ['f3', 'c\nd\n']]) fs.writeFileSync(path.join(cwd, f), text);
  const r = run('bash', ['--norc', '-c', line], { cwd, env: ENV, timeout: 20000 });
  assert.notStrictEqual(r.status, null, `${line}: no exit status`);
  return { status: r.status!, err: r.stderr.toString() };
}

const REFUSALS = /extra operand|too many templates|bad usage|only one pattern|lacks a leading|^Usage:/m;
/** tr also refuses a lone set ("missing operand after"); the missing operands of the other tools are not modelled. */
const refusals = (tool: string): RegExp => (tool === 'tr' ? /extra operand|missing operand/ : REFUSALS);

describe('extra operands, compared with the real tools', () => {
  // Lines with more operands than the tool takes, and lines with as many as it takes (some with an option that lifts
  // the limit: `basename -a`, `diff --from-file`, `shuf -e`; or lowers it: `tr -d`, `shuf -i`).
  const LINES = [
    'cmp f1 f2 0 0 f3', 'cmp f1 f2 0 0', 'diff f1 f2 f3', 'diff f1 f2', 'diff --from-file=f1 f2 f3', 'sdiff f1 f2 f3', 'diff3 f1 f2 f3 f1', 'diff3 f1 f2 f3',
    'basename f1 f2 f3', 'basename f1 f2', 'basename -a f1 f2 f3', 'seq 1 2 3 4', 'seq 1 2 3', 'uniq f1 o f3', 'uniq f1 o',
    'tr a b c', 'tr a b', 'tr -d a b', 'tr -s a b c', 'tr -ds a b c', 'tr -ds a b',
    // (tr: a lone set is refused unless -d or -s is given, and with both; -d takes one set; every spelling of the options.)
    'tr a', 'tr -d a', 'tr -s a', 'tr -ds a', 'tr -sd a', 'tr -c a', 'tr -C a', 'tr -cd a', 'tr -cs a', 'tr -cds a', 'tr -t a', 'tr -dt a', 'tr -st a', 'tr --delete a', 'tr --squeeze-repeats a',
    'tr --delete --squeeze-repeats a', 'tr --complement a', 'tr --truncate-set1 a', 'tr -d -s a', 'tr -s -d a b', 'tr -d -s a b c', 'tr -c a b', 'tr -ct a b', 'tr -c a b c', 'tr -cd a b', 'tr -cd a b c', 'tr -dt a b', 'tr -d a b c',
    'tr -s a b', 'tr -st a b c', 'tr -cs a b', 'tr -cs a b c', 'tr -cds a b', 'tr -cds a b c', 'tr -- a', 'tr -d -- a b', 'tr -- a b', 'tr --delete a b c', 'date +%s x', 'date +%s', 'mktemp a.XXX b.XXX', 'mktemp a.XXX',
    'comm f1 f2 f3', 'comm f1 f2', 'join f1 f2 f3', 'join f1 f2', 'shuf f1 f2', 'shuf f1', 'shuf -e f1 f2 f3', 'shuf -i 1-3 f1',
    'unlink nx1 nx2', 'unlink nx1', 'link f1 l f3', 'link f1 l', 'tsort f1 f2', 'tsort f1', 'dircolors f1 f2',
    'pgrep a b', 'pgrep -x no-such-process-name', 'mountpoint . f1', 'mountpoint -q .', 'look a f1 f2', 'look a f1', 'xxd f1 o f3', 'xxd f1 o', 'getconf NAME_MAX / x', 'getconf NAME_MAX /',
    'mknod n p 1 2', 'mknod n p 1', 'mknod n p', 'mknod -m 600 n p 1', 'mknod n c 1 2 3', 'mknod n b 1 2 3 4',
    'dircolors -p f1', 'dircolors --print-database f1 f2', 'dircolors --print-ls-colors f1', 'dircolors -b f1', 'dircolors -p', 'dircolors f1 f2', 'dircolors -bp f1', 'dircolors -pb f1', 'dircolors -p -c f1 f2', 'dircolors --print-ls-colors -b f1', 'dircolors -b -c f1',
    'getconf -a / x', 'getconf -a /', 'getconf -a', 'getconf -a PATH', 'getconf -a NAME_MAX /', 'getconf -v POSIX_V7_LP64_OFF64 NAME_MAX /',
    'date -d now x', 'date -d now +%s', 'date -d now x +%s', 'date -s now x', 'date -f /dev/null x', 'date -r . x', 'date --resolution x', 'date -u x y', 'date -I x', 'date x', 'date 0101', 'date -- x',
  ];
  for (const line of LINES) {
    it(line, function () {
      const { tool, words, roles } = read(line);
      if (!usableTool(tool)) this.skip();
      const at = words.flatMap((_, i) => (extraOf(roles[i]?.spec) ? [i] : []));
      const r = runLine(line);
      if (!at.length) {
        assert.doesNotMatch(r.err, refusals(tool), `${line}: the tool refuses a word`);
        return;
      }
      const says = extraOf(roles[at[0]]!.spec)!;
      assert.strictEqual(r.status, says.status, `${line}: ${r.err}`);
      assert.ok(r.err.includes(says.says.replace(/ …$/, '')), `${line}: ${r.err}`);
      // (coreutils and diffutils name the first word they refuse.)
      const named = /extra operand [‘']([^’']*)[’']/.exec(r.err);
      if (named) assert.strictEqual(named[1], words[at[0]], line);
    });
  }

  it('tr -ds: the first set is deleted, the second squeezed, as tr does', function () {
    const { roles } = read('tr -ds a b');
    assert.deepStrictEqual(roles.map((r) => r?.spec?.text.en), [undefined, 'character set to delete', 'character set whose repeats are squeezed']);
    if (!usableTool('tr')) this.skip();
    assert.strictEqual(run('tr', ['-ds', 'a', 'b'], { input: 'aaxbbb\n', env: ENV }).stdout.toString(), 'xb\n');
    // (`-s` alone: the first set becomes the second, whose repeats are then squeezed.)
    assert.deepStrictEqual(read('tr -s a b').roles.map((r) => r?.spec?.text.en), [undefined, 'source character set (e.g. `a-z`)', 'target character set (e.g. `A-Z`)']);
    assert.strictEqual(run('tr', ['-s', 'a', 'b'], { input: 'aaxbbb\n', env: ENV }).stdout.toString(), 'bxb\n');
  });

  // tr, option by option and count by count: the role of each set, and the refusal of the tool (its lines, in full)
  // where a role says it refuses the word. Without -d or -s a lone set is refused (it is not a set to delete or to
  // squeeze); -d alone takes one set; -d and -s together need two. (No operand at all: tr refuses, but there is no word to say it.)
  const TR_KINDS = (line: string): string[] => read(line).roles.flatMap((r) => (r?.spec ? [r.spec.extra ? (r.spec.name === 'LONE' ? 'lone' : 'extra') : 'set'] : []));
  const TR_TABLE: { options: string[]; kinds: string[][] }[] = [
    ...[[], ['-c'], ['-C'], ['-t'], ['-ct'], ['--complement'], ['--truncate-set1']].map((options) => ({ options, kinds: [['lone'], ['set', 'set'], ['set', 'set', 'extra']] })),
    ...[['-d'], ['-cd'], ['-dt'], ['--delete'], ['-d', '-t'], ['--delete', '--complement']].map((options) => ({ options, kinds: [['set'], ['set', 'extra'], ['set', 'extra', 'extra']] })),
    ...[['-s'], ['-cs'], ['-st'], ['--squeeze-repeats']].map((options) => ({ options, kinds: [['set'], ['set', 'set'], ['set', 'set', 'extra']] })),
    ...[['-ds'], ['-sd'], ['-cds'], ['-d', '-s'], ['-s', '--delete'], ['--delete', '--squeeze-repeats', '-c']].map((options) => ({ options, kinds: [['lone'], ['set', 'set'], ['set', 'set', 'extra']] })),
  ];
  for (const { options, kinds } of TR_TABLE) {
    it(`tr ${options.join(' ')}: one, two and three sets`, function () {
      for (const [i, expected] of kinds.entries()) {
        const line = `tr ${options.join(' ')} ${['a', 'b', 'c'].slice(0, i + 1).join(' ')}`;
        assert.deepStrictEqual(TR_KINDS(line), expected, line);
        if (!usableTool('tr')) continue;
        const r = runLine(line);
        const first = read(line).roles.find((o) => o?.spec?.extra)?.spec;
        // (The lines tr prints but the usage hint, and the refusal's lines the role names.)
        const lines = r.err.split('\n').filter((l) => l && !/^Try /.test(l));
        if (!first) {
          assert.strictEqual(r.status, 0, `${line}: ${r.err}`);
          assert.deepStrictEqual(lines, [], line);
          continue;
        }
        assert.strictEqual(r.status, first.extra!.status, `${line}: ${r.err}`);
        const said = [...first.text.en.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
        assert.strictEqual(lines.length, said.length, `${line}: ${r.err}`);
        said.forEach((m, k) => assert.ok(lines[k].includes(m), `${line}: ${lines[k]} does not say ${m}`));
        assert.ok(first.text.en.includes('doing nothing'), line);
      }
    });
  }

  it('tr with no operand: the tool refuses, no word to say it', function () {
    for (const line of ['tr', 'tr -d', 'tr -s', 'tr -ds', 'tr -c']) {
      assert.deepStrictEqual(read(line).roles.filter((r) => r?.spec), [], line);
      if (!usableTool('tr')) continue;
      const r = runLine(line);
      assert.strictEqual(r.status, 1, line);
      assert.match(r.err, /^tr: missing operand\n/, line);
    }
  });

  it('tr: a hedged lone set is a set to delete or squeeze only with -d or -s', function () {
    const texts = (line: string, word: string): string[] => {
      const { words, roles } = read(line);
      const role = roles[words.indexOf(word)]!;
      const all = [role.spec, ...(role.none ?? []).map((x) => x.spec), ...(role.mixed?.roles ?? []), ...(role.several ?? []).flatMap((x) => x.roles), ...(role.byCount?.readings ?? []).map((x) => x.spec), role.otherwise];
      return all.flatMap((o) => (o ? [o.text.en] : []));
    };
    const squeezeOrDelete = 'character set to delete or squeeze (`-d`, `-s`)';
    for (const [line, word] of [['tr $a $b', '$a'], ['tr $a $b', '$b'], ['tr $a $b f', 'f'], ['tr $a $b f', '$b'], ['tr $a x $b', 'x'], ['tr $a x $b', '$a'], ['tr -c $a $b f', 'f'], ['tr -t $a x $b', 'x']]) {
      assert.ok(!texts(line, word).includes(squeezeOrDelete), `${line}: ${word}`);
    }
    // (`$a` and `$b` empty: `tr f`, which tr refuses; `tr -d f` deletes, `tr -s f` squeezes.)
    const lone = (line: string, word: string): boolean => texts(line, word).some((t) => t.startsWith('lone character set'));
    assert.ok(lone('tr $a $b f', 'f'));
    assert.ok(lone('tr $a x $b', 'x'));
    assert.ok(!lone('tr -d $a $b f', 'f'));
    assert.ok(!lone('tr -s $a $b f', 'f'));
    assert.ok(lone('tr -ds $a $b f', 'f'));
  });

  // What each word is, against what the tool does with it: `shuf -e` takes lines, a pipe has no device numbers (the
  // limit of mknod follows the type), `dircolors -p` takes no file, `date x` reads a date to set (`date -d now x`
  // refuses it), `getconf -a` takes a path.
  /** The English text of the role of each operand of `line` (the options have none). */
  const roleTexts = (line: string): string[] => read(line).roles.flatMap((r) => (r?.spec ? [r.spec.text.en] : []));
  const FORMAT = 'output format starting with `+` (e.g. `+%Y-%m-%d`, `+%F`, `+%s`)';

  it('shuf -e: the words are the lines to shuffle, as shuf prints them', function () {
    const line = 'line to shuffle (each argument is one line)';
    assert.deepStrictEqual(roleTexts('shuf -e a b c'), [line, line, line]);
    assert.deepStrictEqual(roleTexts('shuf -n 1 -e a'), [line]);
    assert.deepStrictEqual(roleTexts('shuf f1'), ['target file']);
    if (!usableTool('shuf')) this.skip();
    assert.deepStrictEqual(run('shuf', ['-e', 'f1', 'b', 'c'], { env: ENV }).stdout.toString().split('\n').sort(), ['', 'b', 'c', 'f1']);
  });

  it('mknod: the limit follows the type, and the numbers are for devices only', function () {
    assert.deepStrictEqual(roleTexts('mknod n p').length, 2);
    assert.deepStrictEqual(roleTexts('mknod -m 600 n p 1').map((t) => /^extra operand/.test(t)), [false, false, true]);
    for (const t of ['b', 'c', 'u']) assert.deepStrictEqual(roleTexts(`mknod n ${t} 1 2`).slice(2), ['major number', 'minor number']);
    // (A type not known: the numbers may be wanted.)
    assert.deepStrictEqual(roleTexts('mknod n $t 1 2').slice(2), ['major number', 'minor number']);
    if (!usableTool('mknod')) this.skip();
    assert.match(runLine('mknod n p 1 2').err, /Fifos do not have major and minor device numbers/);
    assert.match(runLine('mknod n c 1 2 3').err, /extra operand .3./);
  });

  it('dircolors: -p takes no file, --print-ls-colors one', function () {
    assert.match(roleTexts('dircolors -p f1')[0], /^extra operand/);
    assert.match(roleTexts('dircolors --print-database f1')[0], /^extra operand/);
    assert.deepStrictEqual(roleTexts('dircolors --print-ls-colors f1'), ['settings file']);
    assert.deepStrictEqual(roleTexts('dircolors f1'), ['settings file']);
  });

  it('getconf -a: a path at most, no variable name', function () {
    assert.deepStrictEqual(roleTexts('getconf -a /').length, 1);
    assert.doesNotMatch(roleTexts('getconf -a /')[0], /^extra operand/);
    assert.match(roleTexts('getconf -a / x')[1], /^extra operand/);
    assert.match(roleTexts('getconf -a /')[0], /^path/);
    assert.match(roleTexts('getconf NAME_MAX /')[0], /^variable/);
    // (glibc reads its options first: after the variable, `-a` is the path, and `getconf PAGESIZE -a` is the usage.)
    assert.deepStrictEqual(read('getconf PAGESIZE -a').roles.map((r) => r?.role), ['operand', 'operand']);
    assert.match(roleTexts('getconf PAGESIZE -a')[1], /^path/);
    if (usableTool('getconf')) assert.match(runLine('getconf PAGESIZE -a').err, /^Usage:/);
  });

  // A word that may expand (a glob, a tilde) is not known to start with `+`: it is not explained as a format, and bash's
  // own tokens stay (date reads the expanded word: "invalid date", or "lacks a leading '+'" with `-d`).
  it('date: a glob or a tilde word gets no format tokens and no example of a format', () => {
    const parser = createUnbashParser();
    const all = (ts: Token[]): Token[] => ts.flatMap((t) => [t, ...all(t.children ?? [])]);
    for (const line of ['date x*', 'date %Y*', 'date [%Y]', 'date ~', 'date ~/%Y', 'date -d now %Y*']) {
      const r = new Analyzer('en').explainLine(parser.parse(line), 0);
      assert.ok(!r.examples.some((e) => e.kind === 'date'), `${line}: an example of a format`);
      assert.ok(!all(r.items).some((t) => /introduces the output format|Literal text/.test(t.explanation)), `${line}: format tokens`);
    }
    const f = new Analyzer('en').explainLine(parser.parse('date +%F'), 0);
    assert.ok(f.examples.some((e) => e.kind === 'date'));
    if (!usableTool('date')) return;
    assert.match(runLine("date x*").err, /invalid date/);
    assert.match(runLine('date -d now %Y*').err, /lacks a leading/);
  });

  it('date: a word without a leading +, read as a date to set, or refused when an option gives the date', function () {
    assert.deepStrictEqual(roleTexts('date +%F'), [FORMAT]);
    assert.deepStrictEqual(roleTexts('date $a'), [FORMAT]);
    for (const line of ['date 0101', 'date -u 0101', 'date -I 0101', 'date -R 0101', 'date -- 0101']) assert.match(roleTexts(line)[0], /^date to set/, line);
    for (const o of ['-d now', '-f f1', '-r f1', '-s now', '--set=now', '--resolution', '--date=now']) assert.match(roleTexts(`date ${o} 0101`).pop()!, /^not allowed here/, o);
    assert.match(roleTexts('date -d now 0101 +%s')[0], /^format or date/);
    assert.match(roleTexts('date -d now 0101 +%s')[1], /^extra operand/);
    assert.deepStrictEqual(roleTexts('date -d now +%s'), [FORMAT]);
  });

  // `cmp $a`, `cmp $a f`: what the hedge says of each count of words `$a` gives, against the tool run with as many.
  const HEDGES: { line: string; word: string; values: string[] }[] = [
    { line: 'cmp $a', word: '$a', values: ['f1', 'f2', '0', '0', 'f3', 'f3'] },
    { line: 'cmp $a f2', word: 'f2', values: ['f1', 'f1', '0', '0', 'f3'] },
    { line: 'diff $a', word: '$a', values: ['f1', 'f2', 'f3', 'f3'] },
    { line: 'seq $a', word: '$a', values: ['1', '1', '2', '3', '4'] },
    { line: 'basename $a', word: '$a', values: ['f1', 'f2', 'f3', 'f3'] },
    { line: 'tr $a', word: '$a', values: ['a', 'b', 'c', 'c'] },
    { line: 'tr -d $a', word: '$a', values: ['a', 'b', 'c'] },
    { line: 'tr -s $a', word: '$a', values: ['a', 'b', 'c'] },
    { line: 'tr -ds $a', word: '$a', values: ['a', 'b', 'c'] },
  ];
  for (const { line, word, values } of HEDGES) {
    it(`hedge: ${line}`, function () {
      const { tool, words, roles } = read(line);
      if (!usableTool(tool)) this.skip();
      const role = roles[words.indexOf(word)]!;
      for (let n = 1; n <= values.length; n++) {
        // The roles of this reading: of the words `$a` gives (`several`), or of the word after it (`byCount`).
        const readings = role.several ?? role.byCount!.readings.map((x) => ({ from: x.from, orMore: x.orMore, roles: [x.spec] }));
        const reading = readings.find((x) => x.from === n || (x.orMore && x.from <= n)) ?? (n === 1 ? { roles: [role.spec!] } : undefined);
        assert.ok(reading, `${line}: no reading for ${n} words`);
        const refused = reading.roles.some((o) => o.extra);
        const r = runLine(`a='${values.slice(0, n).join(' ')}'; ${line}`);
        assert.strictEqual(refusals(tool).test(r.err), refused, `${line} with ${n} words: ${r.err}`);
      }
    });
  }

  // Two words that may give several or none, `$a` and `$b`, each with every count from none to four: the role the
  // interpreter gives each word written in the line, read from the line with those words written out, is one the
  // explanation of the line with `$a` and `$b` allows for those counts (`allowed`), and the real tool agrees with it:
  // it refuses the word as an extra operand (or cmp reads it as bytes to skip) exactly where that role says so; cp, mv
  // and ln make the file a destination, a directory or a link name, as the role says.
  const GENERATED: { line: string; values: string[] }[] = [
    ...['diff $a $b f', 'sdiff $a $b f', 'comm $a $b f', 'join $a $b f', 'uniq $a $b f', 'diff3 $a $b f', 'diff3 $a f $b', 'diff3 f $a $b'].map((line) => ({ line, values: ['f1', 'f2', 'f3', 'f1'] })),
    ...['cmp $a $b f', 'cmp $a f $b', 'cmp $a f $b g', 'cmp $a f g $b', 'cmp $a $b f g h'].map((line) => ({ line, values: ['0', '0', '0', '0'] })),
    ...['seq $a $b 1 2', 'seq $a 1 $b 2', 'seq 1 $a $b 2', 'seq $a $b 5'].map((line) => ({ line, values: ['1', '1', '1', '1'] })),
    ...['tr $a $b x', 'tr -s $a $b x', 'tr -ds $a $b x', 'tr -d $a $b x', 'tr $a x $b', 'tr -s $a x $b', 'tr -ds $a x $b', 'tr -d $a x $b', 'tr -c $a $b f', 'tr -dt $a x $b'].map((line) => ({ line, values: ['a', 'b', 'c', 'd'] })),
    { line: 'basename $a $b f', values: ['p/f1', 'p/f2', 'p/f3', 'p/f4'] },
    { line: 'date $a $b +%F', values: ['+%s', '+%s', '+%s', '+%s'] },
    { line: 'mktemp $a $b t.XXX', values: ['a.XXX', 'b.XXX', 'c.XXX', 'd.XXX'] },
    ...['cp $a $b d', 'mv $a $b d', 'ln -s $a $b d'].map((line) => ({ line, values: ['f1', 'f2', 'f3', 'g'] })),
  ];
  const COUNTS = [0, 1, 2, 3, 4].flatMap((a) => [0, 1, 2, 3, 4].map((b) => [a, b]));
  for (const { line, values } of GENERATED) {
    it(`generated: ${line}, every count of \`$a\` and \`$b\` from none to four`, async function () {
      this.timeout(60000);
      const tool = line.split(' ')[0];
      if (!usableTool(tool)) this.skip();
      const { words, roles } = read(line);
      const fixed = words.flatMap((w, i) => (!w.startsWith('$') && roles[i] ? [i] : []));
      // (One script for every count, run once, in a cgroup: each count in a directory of its own.)
      const script = COUNTS.map(([a, b], n) => {
        const [x, y] = [values.slice(0, a).join(' '), values.slice(0, b).join(' ')];
        return `d=r${n}; mkdir $d; (cd $d && printf 'a\\nb\\n' > f1 && printf 'b\\nc\\n' > f2 && printf 'c\\nd\\n' > f3 && printf 'x\\n' > f && printf 'y\\n' > g && printf 'z\\n' > h && printf 'n\\n' > 0 && a='${x}' && b='${y}' && ${line}) </dev/null >/dev/null 2>$d.err; s=$?; printf 'R\\t%s\\t%s\\t%s\\t%s\\n' ${n} $s "$(tr '\\n' ' ' < $d.err)" "$( [ -L $d/d ] && echo "link $(readlink $d/d)"; [ -f $d/d ] && [ ! -L $d/d ] && echo file)"`;
      }).join('\n');
      const cwd = fs.mkdtempSync(path.join(dir, 'gen-'));
      const r = await runContained(['bash', '--norc', '-c', script], cwd, { PATH: process.env.PATH }, 50000);
      const runs = new Map(r.stdout.split('\n').filter((l) => l.startsWith('R\t')).map((l) => { const [, n, st, err, post] = l.split('\t'); return [Number(n), { st: Number(st), err, post }]; }));
      COUNTS.forEach(([a, b], n) => {
        const run1 = runs.get(n);
        assert.ok(run1, `${line}: no run for ${a} and ${b} words`);
        const counts = new Map([['$a', a], ['$b', b]]);
        // (The line as bash runs it: each variable's words written out; where each written word is then.)
        const parts = words.map((w) => (w === '$a' ? values.slice(0, a) : w === '$b' ? values.slice(0, b) : [w]));
        const lit = read(`${tool} ${parts.flat().join(' ')}`);
        const at = (i: number): number => parts.slice(0, i).flat().length;
        const extras = lit.roles.flatMap((o, i) => (o?.spec?.extra ? [lit.words[i]] : []));
        const skipNamed = /invalid --ignore-initial value '([^']*)'/.exec(run1.err)?.[1];
        for (const i of fixed) {
          const got = lit.roles[at(i)]?.spec;
          const where = `${line} with ${a} and ${b} words: ${words[i]}`;
          assert.ok(got, `${where}: no role`);
          const ok = allowed(roles[i]!, counts, words);
          assert.ok(ok.includes(got.text.en), `${where} is ${got.text.en}, not among ${ok.join(' | ')}`);
          if (got.extra && !skipNamed) assert.match(run1.err, refusals(tool), `${where}: not refused`);
          if (skipNamed === words[i]) assert.match(got.text.en, /^bytes to skip/, `${where}: ${run1.err}`);
          if (/^(cp|mv|ln)$/.test(tool) && words[i] === 'd') {
            const real = /missing destination|missing file operand/.test(run1.err) ? 'source' : run1.post.startsWith('file') ? 'destination' : run1.post.startsWith('link d') ? 'target' : run1.post.startsWith('link') ? 'link name' : /not a directory|No such file or directory/.test(run1.err) ? 'directory' : `? ${run1.err} ${run1.post}`;
            assert.ok(got.text.en.startsWith(real) || (real === 'directory' && /directory( to make the links in)?$/.test(got.text.en)), `${where}: the tool makes it ${real} (${run1.err}), we read ${got.text.en}`);
          }
        }
        // (The tool names the first word it refuses, ours too; a line we read with no extra operand is not refused as
        // one, and one we read with one is.)
        const named: string | undefined = /extra operand [‘']([^’']*)[’']/.exec(run1.err)?.[1];
        if (named !== undefined && !skipNamed) assert.strictEqual(extras[0], named, `${line} with ${a} and ${b} words: ${run1.err}`);
        if (!skipNamed) assert.strictEqual(refusals(tool).test(run1.err), extras.length > 0, `${line} with ${a} and ${b} words: ${run1.err}`);
      });
    });
  }
});

/**
 * The roles the explanation of word `i` allows where the words `$a`, `$b` give `counts` words, from its role: the
 * reading when every word that may give none gives none (`none`), the reading for each count of one other word
 * (`byCount`, `otherwise`), and of several (`mixed`: its own role where each gives one, else its own role or any
 * of the list, "it can also be"); else its one role.
 */
function allowed(role: OperandRole, counts: ReadonlyMap<string, number>, words: string[]): string[] {
  const count = (i: number): number => counts.get(words[i]) ?? 1;
  const own = role.spec!.text.en;
  const nones = (role.none ?? []).filter((r) => r.spec && r.words.every((i) => count(i) === 0));
  if (nones.length) return nones.map((r) => r.spec!.text.en);
  if (role.mixed) {
    if (role.mixed.words.every((i) => count(i) === 1)) return [own];
    return [...(role.mixed.many ? [] : [own]), ...role.mixed.roles.map((o) => o.text.en)];
  }
  if (role.byCount) {
    const n = count(role.byCount.word);
    const r = role.byCount.readings.find((x) => x.from === n || (x.orMore && x.from <= n));
    return r ? [r.spec.text.en] : [];
  }
  if (role.otherwise) return count(role.by!) > 1 ? [role.otherwise.text.en] : [own];
  return [own];
}
