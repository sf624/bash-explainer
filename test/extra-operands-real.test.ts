// Words past the operands a tool takes, compared with the real tools (GNU coreutils and diffutils, procps pgrep,
// util-linux mountpoint and look, xxd, getconf): the interpreter marks as extra operands the words the tool refuses
// ("extra operand", "too many templates"…), and only those, and a hedge says so for the counts of words where the tool
// refuses them. Each tool runs in a directory of its own; a missing tool is skipped. mknod is not run: its usage says
// how many operands it takes.
import * as assert from 'assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { lookupCommand } from '../src/analyzer';
import { interpret, type OperandRole } from '../src/argv/interpret';
import type { OperandSpec } from '../src/argv/spec';
import { argWords } from './support/argwords';
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

const REFUSALS = /extra operand|too many templates|bad usage|only one pattern|^Usage:/m;

describe('extra operands, compared with the real tools', () => {
  // Lines with more operands than the tool takes, and lines with as many as it takes (some with an option that lifts
  // the limit: `basename -a`, `diff --from-file`, `shuf -e`; or lowers it: `tr -d`, `shuf -i`).
  const LINES = [
    'cmp f1 f2 0 0 f3', 'cmp f1 f2 0 0', 'diff f1 f2 f3', 'diff f1 f2', 'diff --from-file=f1 f2 f3', 'sdiff f1 f2 f3', 'diff3 f1 f2 f3 f1', 'diff3 f1 f2 f3',
    'basename f1 f2 f3', 'basename f1 f2', 'basename -a f1 f2 f3', 'seq 1 2 3 4', 'seq 1 2 3', 'uniq f1 o f3', 'uniq f1 o',
    'tr a b c', 'tr a b', 'tr -d a b', 'tr -s a b c', 'tr -ds a b c', 'tr -ds a b', 'date +%s x', 'date +%s', 'mktemp a.XXX b.XXX', 'mktemp a.XXX',
    'comm f1 f2 f3', 'comm f1 f2', 'join f1 f2 f3', 'join f1 f2', 'shuf f1 f2', 'shuf f1', 'shuf -e f1 f2 f3', 'shuf -i 1-3 f1',
    'unlink nx1 nx2', 'unlink nx1', 'link f1 l f3', 'link f1 l', 'tsort f1 f2', 'tsort f1', 'dircolors f1 f2',
    'pgrep a b', 'pgrep -x no-such-process-name', 'mountpoint . f1', 'mountpoint -q .', 'look a f1 f2', 'look a f1', 'xxd f1 o f3', 'xxd f1 o', 'getconf NAME_MAX / x', 'getconf NAME_MAX /',
  ];
  for (const line of LINES) {
    it(line, function () {
      const { tool, words, roles } = read(line);
      if (!usableTool(tool)) this.skip();
      const at = words.flatMap((_, i) => (extraOf(roles[i]?.spec) ? [i] : []));
      const r = runLine(line);
      if (!at.length) {
        assert.doesNotMatch(r.err, REFUSALS, `${line}: the tool refuses a word`);
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

  it('mknod: four operands at most, as its usage says (not run)', function () {
    const { words, roles } = read('mknod n c 1 2 3');
    assert.deepStrictEqual(words.filter((_, i) => extraOf(roles[i]?.spec)), ['3']);
    if (!usableTool('mknod')) this.skip();
    assert.match(spawnSync('mknod', ['--help'], { env: ENV, encoding: 'utf8' }).stdout, /^Usage: mknod \[OPTION\]\.\.\. NAME TYPE \[MAJOR MINOR\]$/m);
  });

  // `cmp $a`, `cmp $a f`: what the hedge says of each count of words `$a` gives, against the tool run with as many.
  const HEDGES: { line: string; word: string; values: string[] }[] = [
    { line: 'cmp $a', word: '$a', values: ['f1', 'f2', '0', '0', 'f3', 'f3'] },
    { line: 'cmp $a f2', word: 'f2', values: ['f1', 'f1', '0', '0', 'f3'] },
    { line: 'diff $a', word: '$a', values: ['f1', 'f2', 'f3', 'f3'] },
    { line: 'seq $a', word: '$a', values: ['1', '1', '2', '3', '4'] },
    { line: 'basename $a', word: '$a', values: ['f1', 'f2', 'f3', 'f3'] },
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
        assert.strictEqual(REFUSALS.test(r.err), refused, `${line} with ${n} words: ${r.err}`);
      }
    });
  }

  // `seq $a $b f`, `cmp $a $b f2`: with each count of words of each variable, from none to three, the role the line of
  // those words gives the word is one the hedge says (the reading of single words, or one of the roles when any gives
  // more), and the tool refuses the line exactly where that role is an extra operand.
  const MIXED: { line: string; word: string; values: string[][] }[] = [
    { line: 'seq $a $b 5', word: '5', values: [['1', '2', '3'], ['1', '2', '3']] },
    { line: 'cmp $a $b f2', word: 'f2', values: [['f1', 'f2', '0'], ['0', '0', '0']] },
    { line: 'diff $a $b', word: '$b', values: [['f1', 'f2', 'f3'], ['f2', 'f3', 'f1']] },
  ];
  for (const { line, word, values } of MIXED) {
    it(`hedge of several words: ${line}`, function () {
      const { tool, words, roles } = read(line);
      if (!usableTool(tool)) this.skip();
      const role = roles[words.indexOf(word)]!;
      assert.ok(role.mixed, `${line}: no hedge`);
      const said = new Set(role.mixed.roles.map((o) => o.text.en));
      for (const counts of [0, 1, 2, 3].flatMap((x) => [0, 1, 2, 3].map((y) => [x, y]))) {
        // (Where none gives more, or the word itself gives none, the hedge says nothing of it.)
        if (!counts.some((n) => n > 1) || (word === '$b' && !counts[1])) continue;
        const given = values.map((v, i) => v.slice(0, counts[i]).join(' '));
        // (The line as bash runs it: each variable's words written out.)
        const written = line.replace('$a', given[0]).replace('$b', given[1]).replace(/ +/g, ' ');
        const lit = read(written);
        const at = word.startsWith('$') ? lit.words.flatMap((_, i) => (i >= lit.words.length - counts[1] ? [i] : [])) : [lit.words.length - 1];
        const got = at.map((i) => lit.roles[i]?.spec);
        for (const o of got) assert.ok(o && said.has(o.text.en), `${written}: ${o?.text.en} is not among ${[...said].join(' | ')}`);
        const r = runLine(`a='${given[0]}'; b='${given[1]}'; ${line}`);
        assert.strictEqual(REFUSALS.test(r.err), got.some((o) => o!.extra), `${written}: ${r.err}`);
      }
    });
  }
});
