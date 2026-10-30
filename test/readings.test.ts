// The table of readings of a command's words for every count of its words that may give other than one
// (src/argv/readings.ts, docs/design/count-hedges.md step 2): its runs, domains and ties, the shapes and their cap, the
// roles given back to the words (the same as `interpret` gives the words written out), and, over the corpus of the
// tests, the bound S, the specs a reading visits, and the words the text past the cap names.
import * as assert from 'assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { type ArgRole, type ArgWord, interpret, type RoleAt } from '../src/argv/interpret';
import { roleKey, wordReadings, type WordReadings } from '../src/argv/profiles';
import { readingsOf, SHAPE_CAP, specsReached, wordsBound, type ReadingsTable } from '../src/argv/readings';
import type { CommandSpec } from '../src/argv/spec';
import { allRoles } from '../src/argv/valuehedges';
import { argWord, argWordFor } from '../src/argv/words';
import { lookupCommand } from '../src/dict/aliases';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { descendants, field, type SyntaxNode } from '../src/syntax/tree';
import { argWords } from './support/argwords';

const parser = createUnbashParser();
const ctxOf = (name: string) => ({ name, lookup: lookupCommand });
/** The table of the first command of `line`, and the source texts of its words. */
function table(line: string, cap?: number): ReadingsTable & { texts: string[] } {
  const { name, words, texts } = argWords(line);
  return { ...readingsOf(lookupCommand(name)!, words, ctxOf(name), cap), texts };
}

/** What a role says, for comparisons: its kind, and what it names (not the name of a command run, which the line may not know). */
function key(r: ArgRole | undefined): string {
  if (!r) return '(none)';
  switch (r.role) {
    case 'option': return `option ${r.flag} ${r.text.en}${r.missing ? ' (missing)' : ''}${r.value ? ' =' : ''}`;
    case 'cluster': case 'old-style': return `${r.role} ${r.letters.map(key).join(' ')}`;
    case 'pattern-option': return `pattern ${r.flag} ${r.text.en}`;
    case 'unknown-option': return `unknown ${r.flag}`;
    case 'open-option': return `open ${r.prefix}`;
    case 'value': return `value ${r.of} ${r.index}`;
    case 'operand': return `operand ${r.spec?.text.en ?? ''}`;
    case 'subcommand': return `subcommand ${r.name}`;
    case 'command': return `command ${r.slot.run} ${r.spec ? 'known' : 'unknown'} ${r.item?.text.en ?? ''}`;
    case 'fields': return `fields ${r.roles.map((x) => key(x.role)).join(', ')}`;
    default: return r.role;
  }
}
/** The keys of a word's fields, with a key repeated in a row once (`cp $a`: sources, then the destination). */
const squeezed = (roles: ArgRole[]): string => roles.map(key).filter((k, i, all) => i === 0 || k !== all[i - 1]).join(' | ');
/**
 * The count vectors with each variable from its fewest to `top + more` (its most, where fewer): all of them, or past
 * `most`, that many spread over them (the same on each run).
 */
function vectors(t: ReadingsTable, more: number, most = Infinity): number[][] {
  const sizes = t.variables.map((v) => Math.min(v.top + more, v.max ?? Infinity) - v.min + 1);
  const all = sizes.reduce((n, s) => n * s, 1);
  const vector = (i: number): number[] => t.variables.map((v, j) => {
    const c = v.min + (i % sizes[j]);
    i = Math.floor(i / sizes[j]);
    return c;
  });
  return all <= most ? Array.from({ length: all }, (_, i) => vector(i)) : Array.from({ length: most }, (_, i) => vector(Math.floor((i * all) / most)));
}

/**
 * The context of word k (no model: a word of the line each) where each variable gives `counts[v]` (section 2.4), as the
 * design document defines it; undefined where a coordinate is past its top.
 */
function contextOf(t: ReadingsTable, k: number, counts: readonly number[]): number[] | undefined {
  // (`k`: the word's place in the line.)
  const own = t.variableOf[k];
  const n = (j: number): number => (t.variableOf[j] === undefined ? t.line[j].count?.min ?? 1 : t.variableOf[j] === own ? 0 : counts[t.variableOf[j]!]);
  const sum = (ws: number[]): number => ws.reduce((x, j) => x + n(j), 0);
  const fewest = (ws: number[]): number => ws.reduce((x, j) => x + (t.variableOf[j] === undefined ? t.line[j].count?.min ?? 1 : t.variableOf[j] === own ? 0 : t.variables[t.variableOf[j]!].min), 0);
  const r = t.runs.findIndex((x) => x.words.includes(k));
  const parts = r < 0 ? [] : [t.runs[r].words.slice(0, t.runs[r].words.indexOf(k)), t.runs[r].words.slice(t.runs[r].words.indexOf(k) + 1)];
  const coordinates = [...parts.map((ws) => [sum(ws), fewest(ws) + t.bound]), ...t.runs.flatMap((x, i) => (i === r ? [] : [[sum(x.words), x.top]]))];
  return coordinates.every(([v, top]) => v <= top) ? coordinates.map(([v]) => v) : undefined;
}

describe('readings: the table of every count (count-hedges.md, step 2)', function () {
  this.timeout(120000);

  it('runs: words in a row of no known text with a flexible word; a known start or a known word ends one', () => {
    const jq = table('jq --arg $n $v .');
    assert.deepStrictEqual(jq.runs.map((r) => r.words), [[1, 2]]);
    assert.deepStrictEqual([jq.runs[0].fixed, jq.runs[0].fewest, jq.runs[0].top, jq.bound], [0, 0, 6, 6]);
    assert.deepStrictEqual(table('cut -d $a -f $b f').runs.map((r) => r.words), [[1], [3]]);
    // (A word of no known text and one word is part of the run: `"$b"` gives one.)
    const quoted = table('cp $a "$b" c');
    assert.deepStrictEqual(quoted.runs.map((r) => [r.words, r.fixed, r.fewest]), [[[0, 1], 1, 1]]);
    // (A known start keeps its first word; the words splitting may add after it are of no known text, a run with the
    // words after; a quoted word alone is no run. A glob with a known start is a run of its own, which keeps it.)
    const head = table('head -n$a $b "$c" f');
    assert.deepStrictEqual([head.line[0], head.runs.map((r) => [r.words, r.prefix])], [{ prefix: '-n' }, [[[1, 2, 3], undefined]]]);
    assert.deepStrictEqual(head.variables.map((v) => [v.words, v.base, v.part]), [[[1], 0, true], [[2], 1, undefined]]);
    assert.deepStrictEqual(table('cp -v* $b d').runs.map((r) => [r.words, r.prefix, r.each]), [[[0], '-v', true], [[1], undefined, undefined]]);
    assert.deepStrictEqual(table('cp "$a" b').runs, []);
    assert.deepStrictEqual(table('cp "$a" b').shapes, [[]]);
    // (A brace word is its known number of words, in a run where it is one.)
    assert.deepStrictEqual(table('cp {x,y} $a').runs.map((r) => [r.words, r.fixed, r.fewest]), [[[0, 1], 2, 2]]);
    assert.deepStrictEqual(table('cp {x,y} $a').reading([3]).words.length, 3);
  });

  it('domains: each count from its fewest to S more, or to its most; the shapes are sums, real inside a run and capped elsewhere', () => {
    const jq = table('jq --arg $n $v .');
    assert.deepStrictEqual(jq.variables.map((v) => [v.words, v.min, v.top]), [[[1], 0, 6], [[2], 0, 6]]);
    // (The run `$n $v` at its real sums: each part up to S.)
    assert.deepStrictEqual(jq.shapes, Array.from({ length: 13 }, (_, s) => [s]));
    assert.deepStrictEqual(jq.base, [1, 1]);
    // (Two runs apart: each at its capped domain, 0 to S = 4.)
    const cut = table('cut -d $a -f $b f');
    assert.strictEqual(cut.bound, 4);
    assert.strictEqual(cut.shapes!.length, 25);
    // (A glob gives one word at least; four words in a run read at the sum of each part, capped: 2 to 23.)
    const globs = table('cp *.c *.h $a $b dir');
    assert.deepStrictEqual(globs.variables.map((v) => [v.min, v.top]), [[1, 8], [1, 8], [0, 7], [0, 7]]);
    assert.deepStrictEqual(globs.shapes!.map((s) => s[0]), Array.from({ length: 22 }, (_, s) => s + 2));
    assert.strictEqual(table('cp $a $b $c $d').shapes!.length, 22);
    // (A word with a known most: `{a,$x}` gives one or more, `${a[@]}` none or more.)
    const most = readingsOf(lookupCommand('cp')!, [{ prefix: '', count: { min: 0, max: 2 } }, { value: 'd' }], {});
    assert.deepStrictEqual([most.variables[0].top, most.shapes], [2, [[0], [1], [2]]]);
  });

  it('S: the largest bound of the specs the known words name, as a command or a subcommand', () => {
    assert.strictEqual(table('nice $a -n 5 ls').bound, Math.max(wordsBound(lookupCommand('nice')!), wordsBound(lookupCommand('ls')!)));
    const git = table('git $a log -n $b x');
    assert.ok(git.specs.has(lookupCommand('git')!.subcommands!.log));
    // (The builtin's program, which a slot that starts a program runs: `env echo`.)
    assert.ok(specsReached(lookupCommand('env')!, [{ value: 'echo' }], { lookup: lookupCommand }).has(lookupCommand('echo')!.program!));
    // (The words of a string a value splices in, `env -S`: `tar` is a command there.)
    const spliced = specsReached(lookupCommand('env')!, [{ value: '-S' }, { value: 'tar -cf ${X}' }, { value: 'a"' }], { lookup: lookupCommand });
    assert.ok(spliced.has(lookupCommand('tar')!));
    // (No lookup: the command's spec alone. A spec without options: two and its longest pattern.)
    assert.deepStrictEqual([...specsReached(lookupCommand('cp')!, [{ value: 'ls' }], {})], [lookupCommand('cp')]);
    const bare: CommandSpec = { summary: { ja: '', en: '' } };
    assert.strictEqual(wordsBound(bare), 2);
    assert.strictEqual(wordsBound({ ...bare, operands: [{ pattern: [{ name: 'A', text: { ja: '', en: 'a' } }, { name: 'B', text: { ja: '', en: 'b' } }] }] }), 4);
  });

  it('ties: two words that are one unquoted expansion of the same parameter share one count, unless the line assigns it between', () => {
    const vars = (line: string): number[][] => table(line).variables.map((v) => v.words);
    assert.deepStrictEqual(vars('cp $a $a d'), [[0, 1]]);
    assert.deepStrictEqual(vars('cp $a ${a} $1 $1 "$@" $@ $@ d'), [[0, 1], [2, 3], [4], [5, 6]]);
    // (No shape where the two differ: a count gives both their words.)
    const cp = table('cp $a $a d');
    assert.deepStrictEqual(cp.shapes, [[0], [2], [4], [6], [7], [8], [10], [12], [14]]);
    assert.deepStrictEqual(cp.at([2]).fields.map((f) => f.length), [2, 2, 1]);
    // (What cuts a tie: `${a:=x}`, `${a=x}`, IFS's, arithmetic anywhere, an indirection (`r=a` and `a` unset: `${!r:=x}`
    // sets `a`; `x='b[a=5]'`: `${!x}` sets it in the subscript), `@P` (`x='${a:=1 2}'`), a `${…}` not understood, and
    // `${ cmd; }`. Not `${b:=x}`, a subshell's, `${b[@]}`, the names `${!x*}` and the keys `${!b[@]}`, nor `@Q`.)
    assert.deepStrictEqual(vars('cp ${a:=x} $a'), [[0], [1]]);
    for (const cut of ['${a:=x}', '"${a=x}"', '${IFS:=x}', '$((b++))', '${b[i]}', '${x:1}', '${x::2}', '${ b=1; }', '"$(( 1 ))"', '${!r:=x}', '${!x}', '"${!x}"', '${x@P}', '${!x@Q}']) {
      assert.deepStrictEqual(vars(`cp $a ${cut} $a d`).filter((w) => w.length > 1), [], cut);
    }
    for (const kept of ['${b:=x}', '"$(a=1)"', '${b[@]}', '${#b[*]}', 'x=y', '"${b:-x}"', '${!x*}', '${!x@}', '${!b[@]}', '${!b[*]}', '${x@Q}', '`a=1`', '<(a=1)']) {
      assert.deepStrictEqual(vars(`cp $a ${kept} $a d`).filter((w) => w.length > 1), [[0, 2]], kept);
    }
    // (`$( )` and backquotes set `$?`, `<( )` and `>( )` set `$!`: with digits in IFS, `$?` may give another count.)
    for (const [param, cut] of [['$?', '"$(true)"'], ['$?', '"`true`"'], ['$!', '<(:)'], ['$!', '>(:)']]) {
      assert.deepStrictEqual(vars(`cp ${param} ${cut} ${param} d`), [[0], [2]], `${param} ${cut}`);
    }
    assert.deepStrictEqual(vars('cp $! "$(true)" $! d'), [[0, 2]]);
    // (Not a parameter bash changes as it runs, nor two words of other counts.)
    assert.deepStrictEqual(vars('cp $RANDOM $RANDOM d'), [[0], [1]]);
    const other = readingsOf(lookupCommand('cp')!, [{ prefix: '', count: { min: 0 }, param: 'a' }, { prefix: '', count: { min: 1 }, param: 'a' }, { value: 'd' }], {});
    assert.deepStrictEqual(other.variables.map((v) => v.words), [[0], [1]]);
  });

  it('cap: past 1,024 shapes nothing is read, in the pass over the counts or in the union', () => {
    assert.strictEqual(SHAPE_CAP, 1024);
    // (A run of three words and two runs more: 22 · 8 · 8 shapes.)
    const big = table('cp $a $b $c x $d y $e');
    assert.strictEqual(big.shapes, undefined);
    assert.deepStrictEqual(big.hedged().map((k) => big.texts[k]), ['$a', '$b', '$c', 'x', '$d', 'y', '$e']);
    // (Every run capped: 5 · 5 > 10; the words before and after `$b` in its run: 8 · 8 > 20; the union: 0 to 14.)
    assert.strictEqual(table('cut -d $a -f $b f', 10).shapes, undefined);
    assert.strictEqual(table('cp $a $b $c', 20).shapes, undefined);
    assert.strictEqual(table('cp $a $b', 10).shapes, undefined);
    assert.strictEqual(table('cp $a $b', 15).shapes!.length, 15);
  });

  it('past the cap, the words that say their role may depend on the counts: from the first flexible one on, and the operands before it', () => {
    const hedged = (line: string): string[] => {
      const t = table(line);
      return t.hedged().map((k) => t.texts[k]);
    };
    // (Operands are placed by patterns over all of them: `5` is the last number when `$a` gives none, the first otherwise;
    // `--version` is an option when it is the one argument.)
    const seq = table('seq 5 $a');
    assert.deepStrictEqual([key(seq.at([0]).fields[0][0]), key(seq.at([1]).fields[0][0])], ['operand last (counting from 1)', 'operand first']);
    assert.deepStrictEqual(hedged('seq 5 $a'), ['5', '$a']);
    assert.deepStrictEqual(hedged('/usr/bin/echo --version $a'), ['--version', '$a']);
    // (Options, their values and a command run's name before it keep their roles; the command fills an operand.)
    assert.deepStrictEqual(hedged('grep -e x -- $a f'), ['$a', 'f']);
    assert.deepStrictEqual(hedged('nice ls -l $a'), ['ls', '$a']);
    assert.deepStrictEqual(hedged('cp a b'), []);
  });

  it('contexts: what a word reads besides its own count, each capped; a reading at a context and an own count', () => {
    const jq = table('jq --arg $n $v .');
    // (`$v`: the words before it in its run, `$n`, and none after; its own counts from one.)
    const v = jq.contexts(2)!;
    assert.deepStrictEqual([v.run, v.contexts, v.own, v.base], [0, Array.from({ length: 7 }, (_, n) => [n, 0]), [1, 2, 3, 4, 5, 6], [1, 0]]);
    // (What each place sums: `$n` before it, nothing after it; capped at S.)
    assert.deepStrictEqual(v.coordinates, [{ words: [1], fixed: 0, mult: new Map([[0, 1]]), top: 6 }, { words: [], fixed: 0, mult: new Map(), top: 6 }]);
    assert.deepStrictEqual(jq.readAt(2, [2, 0], 1), { sums: [3], outcome: 'read', fields: jq.at([2, 1]).fields[2], places: [3], owners: [0, 1, 1, 2, 3] });
    // (`.`: the run, capped; `--arg` too.)
    const dot = jq.contexts(3)!;
    assert.deepStrictEqual([dot.run, dot.contexts, dot.own, dot.base], [undefined, Array.from({ length: 7 }, (_, n) => [n]), [1], [2]]);
    assert.deepStrictEqual(dot.coordinates, [{ words: [1, 2], fixed: 0, mult: new Map([[0, 1], [1, 1]]), top: 6 }]);
    assert.deepStrictEqual(jq.readAt(3, [1], 1).fields.map(key), ['value --arg 1']);
    // (A tie: the second `$a` is the first one's own, so it is no part of its context; its words come after the first's.)
    const cp = table('cp $a $a d');
    assert.deepStrictEqual(cp.contexts(0)!.contexts, [[0, 0]]);
    assert.deepStrictEqual(cp.readAt(1, [0, 0], 2), { sums: [4], outcome: 'read', fields: cp.at([2]).fields[1], places: [2, 3], owners: [0, 0, 1, 1, 2] });
    // (Its own variable's words are no part of a coordinate: the second `$a` is in none of the first's.)
    assert.deepStrictEqual(cp.contexts(0)!.coordinates.map((c) => c.words), [[], []]);
    // (Two runs: the other run is a coordinate; the word of a known count in a run, `"$b"`, has its one word.)
    const cut = table('cp -t $d "$b" $a x $c');
    assert.deepStrictEqual(cut.contexts(2)!.own, [1]);
    assert.deepStrictEqual(cut.readAt(2, [1, 2, 3], 1), { sums: [4, 3], outcome: 'read', fields: cut.at([1, 2, 3]).fields[2], places: [2], owners: [0, 1, 2, 3, 3, 4, 5, 5, 5] });
    // (The words of a known count are part of a coordinate: `"$b"` after `$d`, `$a` gives one.)
    assert.deepStrictEqual(cut.contexts(1)!.coordinates.map((c) => [c.words, c.fixed]), [[[], 0], [[2, 3], 1], [[5], 0]]);
    assert.deepStrictEqual(cut.contexts(1)!.base, [0, 2, 1]);
    assert.deepStrictEqual(table('cp $a $b $c x $d y $e').contexts(0), undefined);
  });

  it('a glob keeps its known start on every word it gives, as bash globs it (GNU cp and grep)', function () {
    const gnu = (tool: string): boolean => /GNU/.test(spawnSync(tool, ['--version'], { encoding: 'utf8' }).stdout ?? '');
    if (!gnu('cp') || !gnu('grep')) this.skip();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explain-bash-readings-'));
    try {
      // (`cp -v* x d` with files `-va` and `-vb`: cp runs as `cp -va -vb x d`, and `d` is the new name of `x`.)
      for (const f of ['-va', '-vb', 'x']) fs.writeFileSync(path.join(dir, f), 'x\n');
      const cp = spawnSync('bash', ['-c', 'cp -v* x d'], { cwd: dir, encoding: 'utf8' });
      assert.deepStrictEqual([cp.status, fs.statSync(path.join(dir, 'd')).isFile()], [0, true]);
      const t = table('cp -v* x d');
      assert.deepStrictEqual(t.reading([2]).words, [{ prefix: '-v' }, { prefix: '-v' }, { value: 'x' }, { value: 'd' }]);
      assert.deepStrictEqual(t.at([2]).fields.map(squeezed), ['open -v', 'operand source', 'operand destination (the new name, or an existing directory)']);
      // (`grep -r --include=*.sh x .` with files `--include=a.sh`, `--include=b.sh`: `x` is the pattern; `a.sh` holds it.)
      for (const f of ['--include=a.sh', '--include=b.sh']) fs.writeFileSync(path.join(dir, f), '');
      fs.writeFileSync(path.join(dir, 'a.sh'), 'x\n');
      const grep = spawnSync('bash', ['-c', 'grep -r --include=*.sh x .'], { cwd: dir, encoding: 'utf8' });
      assert.deepStrictEqual([grep.status, grep.stdout], [0, './a.sh:x\n']);
      const g = table('grep -r --include=*.sh x .');
      assert.deepStrictEqual(g.at([2]).fields.map(squeezed), ['option -r search directories recursively', 'option --include only search files matching the glob =', 'operand search pattern (regex)', 'operand file to search (default: stdin)']);
      // (A word that may split comes in parts: `x$a` gives `xp q` with `a='p q'`, the second word without the `x`.)
      assert.deepStrictEqual(table('cp x$a d').line.slice(0, 2), [{ prefix: 'x' }, { count: { min: 0 } }]);
      // (No parts where the words of the brace expansion are not known: too many to list, or the step not known to apply.)
      assert.strictEqual(argWords('cp -v{1..100000}$x d').words[0].parts, undefined);
      const braced = descendants(parser.parse('cp -v{a,b}$x d').root, ['command'])[0].namedChildren[1];
      assert.deepStrictEqual([argWordFor(undefined, () => 'unknown')(braced).parts, argWordFor()(braced).parts?.length], [undefined, 4]);
      // (Where the glob options let a glob give none, `nullglob` in the model's count, the words of its first field may be none.)
      const globbed = descendants(parser.parse('cp -v*$x d').root, ['command'])[0].namedChildren[1];
      assert.deepStrictEqual(argWordFor(undefined, undefined, () => ({ min: 0 }))(globbed).parts?.[0].count, { min: 0 });
      assert.deepStrictEqual(argWordFor()(globbed).parts?.[0].count, { min: 1 });
      // (A brace word whose words may glob to `--`: `-{v,-}*`; quoted text is no pattern: `-*"?"` cannot, `-*"-"` can.)
      assert.strictEqual(argWords('cp -{v,-}* d').words[0].dashes, true);
      assert.deepStrictEqual([argWords('cp -*"?" d').words[0].dashes, argWords('cp -*"?" d').words[0].prefixEach], [undefined, true]);
      assert.strictEqual(argWords('cp -*"-" d').words[0].dashes, true);
      assert.strictEqual(argWords('cp -"$x"* d').words[0].dashes, true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  /**
   * Lines whose words keep a known start on some of the words they give, run with bash and the real tool (LC_ALL=C) in
   * a directory of their own: the argv bash gives (a function prints it), what the tool did, and the role `interpret`
   * gives `word` in that argv, which some profile of the word must hold (the texts say every profile: the property test
   * of test/profiles.test.ts).
   */
  const STARTS: { line: string; files: string[]; dirs?: string[]; vars?: string; argv: string[]; word: string; role: string; did: (dir: string, out: string) => boolean; counts?: number[]; depends?: true }[] = [
    // (`-v*$x` with `x=a`: `$x` does not split, and every word of the glob keeps `-v`; `d` is the new name.)
    { line: 'cp -v*$x y d', files: ['-vaa', '-vba', 'y'], vars: 'x=a', argv: ['-vaa', '-vba', 'y', 'd'], word: 'd', role: 'operand destination', did: (dir) => fs.statSync(path.join(dir, 'd')).isFile(), counts: [2, 0] },
    // (`--include=$a*` with `a=p`: the start is the text before `$a`.)
    { line: 'grep -r --include=$a* x .', files: ['--include=pa', '--include=pb'], vars: 'a=p', argv: ['-r', '--include=pa', '--include=pb', 'x', '.'], word: 'x', role: 'operand search pattern', did: (_, out) => out === './pa:x\n', counts: [2, 0] },
    // (Each word of the brace expansion keeps the start: `-va -vb`; the words `$x` adds after each are parts of their own.)
    { line: 'cp -v{a,b}$x y d', files: ['y'], vars: 'x=', argv: ['-va', '-vb', 'y', 'd'], word: 'd', role: 'operand destination', did: (dir) => fs.statSync(path.join(dir, 'd')).isFile(), counts: [0, 0] },
    // (A glob whose pattern may match `-` or `--` may give `--`: `cp -- -v x d` copies into the directory `d`, and with the
    // files `-a`, `-v`, `cp -a -v x d` makes the file `d`. Nothing is read: every word says its role may depend on the counts.)
    { line: 'cp -* x d', files: ['--', '-v', 'x'], dirs: ['d'], argv: ['--', '-v', 'x', 'd'], word: 'd', role: 'operand destination directory', did: (dir) => fs.existsSync(path.join(dir, 'd', 'x')), depends: true },
    { line: 'cp --* x d', files: ['--', '--verbose', 'x'], dirs: ['d'], argv: ['--', '--verbose', 'x', 'd'], word: 'd', role: 'operand destination directory', did: (dir) => fs.existsSync(path.join(dir, 'd', 'x')), depends: true },
    // (A pattern that cannot match `-` nor `--` keeps the start on every word: `cp -ax -vx y d` makes the file `d`.)
    { line: 'cp -?x y d', files: ['-ax', '-vx', 'y'], argv: ['-ax', '-vx', 'y', 'd'], word: 'd', role: 'operand destination', did: (dir) => fs.statSync(path.join(dir, 'd')).isFile(), counts: [2] },
    { line: 'cp -[av]* y d', files: ['-ax', '-vx', 'y'], argv: ['-ax', '-vx', 'y', 'd'], word: 'd', role: 'operand destination', did: (dir) => fs.statSync(path.join(dir, 'd')).isFile(), counts: [2] },
    { line: 'cp -*x y d', files: ['-ax', '-vx', 'y'], argv: ['-ax', '-vx', 'y', 'd'], word: 'd', role: 'operand destination', did: (dir) => fs.statSync(path.join(dir, 'd')).isFile(), counts: [2] },
  ];
  for (const { line, files, dirs = [], vars = ':', argv, word, role, did, counts, depends } of STARTS) {
    it(`a known start, as bash and the tool read it: ${line}`, function () {
      const gnu = (tool: string): boolean => /GNU/.test(spawnSync(tool, ['--version'], { encoding: 'utf8' }).stdout ?? '');
      if (!gnu('cp') || !gnu('grep')) this.skip();
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explain-bash-readings-'));
      try {
        for (const f of files) fs.writeFileSync(path.join(dir, f), '');
        for (const d of dirs) fs.mkdirSync(path.join(dir, d));
        if (line.startsWith('grep')) fs.writeFileSync(path.join(dir, 'pa'), 'x\n');
        const env = { ...process.env, LC_ALL: 'C' };
        const { name } = argWords(line);
        const args = spawnSync('bash', ['-c', `${vars}; f() { printf '%s\\0' "$@"; }; f ${line.slice(name.length + 1)}`], { cwd: dir, env, encoding: 'utf8' });
        assert.deepStrictEqual(args.stdout.split('\0').slice(0, -1), argv);
        const ran = spawnSync('bash', ['-c', `${vars}; ${line}`], { cwd: dir, env, encoding: 'utf8' });
        assert.ok(did(dir, ran.stdout), `${line}: ${ran.stderr}`);
        const t = table(line);
        const k = t.texts.indexOf(word);
        const real = allRoles(interpret(lookupCommand(name)!, argv.map((value) => ({ value })), ctxOf(name))).get(argv.indexOf(word))!;
        assert.strictEqual(key(real).startsWith(role), true, key(real));
        const r = wordReadings(t, k)!;
        if (depends) assert.deepStrictEqual([r.kind, t.shapes], ['depends', undefined]);
        else {
          // (The profile at the counts bash gave, each part's: the context they make.)
          const cx = t.contexts(k)!;
          const at = cx.coordinates.map((c) => Math.min(c.fixed + [...c.mult].reduce((n, [v, m]) => n + m * counts![v], 0), c.top)).join();
          const p = (r as WordReadings).profiles[cx.contexts.findIndex((c) => c.join() === at)];
          assert.deepStrictEqual(p.entries.map((e) => e.roles?.map((x) => x.key)), [[`\0${roleKey(real)}`]], line);
        }
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  }

  it('a word inside a run is read at its real sum: `cp $a $b` with five and four words', () => {
    const t = table('cp $a $b');
    assert.ok(t.shapes!.some((s) => s[0] === 9));
    const at = t.at([5, 4]);
    assert.deepStrictEqual(at.fields.map(squeezed), ['operand source', 'operand source | operand destination directory']);
    assert.deepStrictEqual(at.fields.map((f) => f.length), [5, 4]);
  });

  it('outcomes: read, refused as the interpreter knows it, or not known', () => {
    const jq = table('jq --arg $n $v .');
    assert.strictEqual(jq.at([0, 0]).outcome, 'refused');
    assert.strictEqual(jq.at([1, 1]).outcome, 'read');
    // (A letter of a cluster whose value no word gives; operands no form fits; inside a command run.)
    assert.strictEqual(table('tar -xcf $a').at([0]).outcome, 'refused');
    // (`one` takes one operand: every spec of the dictionary but ssh's has a form of any number of them.)
    const one: CommandSpec = { summary: { ja: '', en: '' }, operands: [{ pattern: [{ name: 'A', text: { ja: '', en: 'a' } }] }] };
    const lookup = (name: string): CommandSpec | undefined => (name === 'one' ? one : lookupCommand(name));
    assert.deepStrictEqual([1, 2].map((c) => readingsOf(one, argWords('one $a').words, {}).at([c]).outcome), ['read', 'refused']);
    assert.strictEqual(readingsOf(lookupCommand('sudo')!, argWords('sudo one $a').words, { lookup }).at([2]).outcome, 'refused');
    // (In a string a value splices in, as its own word or in the option's: `tar -cf` with no archive; real env exits 64.)
    for (const line of ["env -S 'tar -cf' $a", "env -S'tar -cf' $a", "env -iS'tar -cf' $a"]) {
      const env = table(line);
      assert.deepStrictEqual([0, 1].map((c) => env.at([c]).outcome), ['refused', 'read'], line);
    }
    const { words } = argWords('cp $a b');
    assert.strictEqual(readingsOf(lookupCommand('cp')!, words, { maxSteps: 1 }).at([3]).outcome, 'unknown');
    assert.strictEqual(readingsOf(lookupCommand('sudo')!, argWords('sudo cp $a b').words, { lookup: lookupCommand, maxSteps: 1 }).at([3]).outcome, 'unknown');
  });

  it('the roles: as `interpret` gives them for the words written out, with the fields the model knows in place', () => {
    // `x='-r a'` (two fields: the option `-r`, a source), `y=b` (one), `z=` (none), and `$w` not known.
    const known = (...fields: string[]): ArgWord => ({ prefix: '', count: { min: 0 }, fields: () => fields });
    const words: ArgWord[] = [known('-r', 'a'), { prefix: '', count: { min: 0 }, fields: () => undefined }, known('b'), known(), { value: 'd' }];
    const t = readingsOf(lookupCommand('cp')!, words, ctxOf('cp'));
    assert.deepStrictEqual(t.line.length, 5);
    assert.deepStrictEqual(t.variables.map((v) => v.words), [[2]]);
    const at = t.at([2]);
    assert.deepStrictEqual(at.fields.map(squeezed), ['option -r copy directories recursively | operand source', 'operand source', 'operand source', '', 'operand destination directory']);
    assert.strictEqual(at.parse.roles.find((r) => r.word === 0)!.role.role, 'fields');
    // (Its fields are read by patterns too: the word whose fields the model knows says it may depend on the counts.)
    assert.deepStrictEqual(t.hedged(), [0, 1, 2, 3, 4]);
    assert.deepStrictEqual(t.variableAt, [undefined, 0, undefined, undefined, undefined]);
    // (The words of known fields read every run, with their own number of words: two, one, none.)
    assert.deepStrictEqual([0, 2, 3].map((k) => { const { contexts, own } = t.contexts(k)!; return { contexts, own }; }), [0, 2, 3].map((k) => ({ contexts: [[0], [1], [2], [3], [4], [5], [6], [7]], own: [[2], [1], [0]][[0, 2, 3].indexOf(k)] })));
    assert.deepStrictEqual(t.readAt(0, [2], 2).fields.map(key), at.fields[0].map(key));
    assert.deepStrictEqual(t.readAt(2, [2], 1).fields.map(key), at.fields[2].map(key));
    assert.deepStrictEqual(t.readAt(3, [2], 0).fields, []);
    assert.deepStrictEqual(t.readAt(4, [2], 1).fields.map(key), at.fields[4].map(key));
    // (No count variable: one shape, of no sum.)
    assert.deepStrictEqual(readingsOf(lookupCommand('cp')!, [known('a'), { value: 'd' }], {}).shapes, [[]]);
  });

  /**
   * The lines of count-hedges.md 1.2 and more, each variable with every count up to S (its top) and two more, written out
   * with texts that read as words of unknown text (`seq`: numbers). The table's roles of each word's fields are those
   * `interpret` gives the argv.
   */
  const CASES: { line: string; text?: (k: number, i: number) => string }[] = [
    { line: 'jq --arg $n $v .' }, { line: 'jq --arg $n v $f' }, { line: 'cut -d $a -f $b f' }, { line: 'cp -t $d $a b' },
    { line: 'grep -e $p -- -v f' }, { line: 'tr $a -d' }, { line: 'getconf $a -a', text: (k, i) => `NAME${k}${i}` }, { line: 'echo $a -n x' },
    { line: '/usr/bin/echo $a --version' }, { line: 'nice $a -n 5 ls' }, { line: 'cp $a $b' }, { line: 'cp $a $a d' },
    { line: 'seq $a $b $c', text: (k, i) => `${k}${i}` }, { line: 'tar -cf $a b' }, { line: 'git -C $d log' }, { line: 'sudo -u $u tar -cf x y' },
    { line: 'head -n$a f', text: (k, i) => `${k}${i}` }, { line: 'cp *.c $a "$b" d' }, { line: 'timeout -s $s 5 echo x' },
  ];
  for (const { line, text = (k: number, i: number) => `w${k}${i}` } of CASES) {
    it(`agrees with interpret on every shape: ${line}`, () => {
      const t = table(line);
      const { name, words } = argWords(line);
      const spec = lookupCommand(name)!;
      for (const counts of vectors(t, 2)) {
        // (The words written out: a run's known start on its first word.)
        // (A word in parts, `ArgWord.parts`, is each part's words: those of a part that keeps the start keep it.)
        const argv: ArgWord[] = [];
        const spans = words.map((w, k) => {
          const lines = t.line.flatMap((_, j) => (t.back(j) === k ? [j] : []));
          const from = argv.length;
          if (lines.length === 1 && t.variableOf[lines[0]] === undefined) argv.push(w);
          else {
            for (const j of lines) {
              const v = t.variableOf[j];
              const n = v === undefined ? 1 : counts[v];
              for (let i = 0; i < n; i++) argv.push({ value: (i === 0 || t.line[j].prefixEach ? t.line[j].prefix ?? '' : '') + text(k, argv.length - from) });
            }
          }
          return [from, argv.length];
        });
        const roles = allRoles(interpret(spec, argv, ctxOf(name)));
        const at = t.at(counts);
        const expected = spans.map(([from, to]) => Array.from({ length: to - from }, (_, j) => key(roles.get(from + j))));
        assert.deepStrictEqual(at.fields.map((f) => f.map(key)), expected, `${line} at ${counts.join(',')}`);
        // (Each word read at its context, where no coordinate of it is past its top: the same roles.)
        for (let k = 0; k < words.length; k++) {
          const lines = t.line.flatMap((_, j) => (t.back(j) === k ? [j] : []));
          if (lines.length !== 1) continue;
          const context = contextOf(t, lines[0], counts);
          if (context) assert.deepStrictEqual(t.readAt(k, context, counts[t.variableAt[k]!] ?? 1).fields.map(key), expected[k], `${line}: word ${k} at ${counts.join(',')}`);
        }
      }
    });
  }

  describe('over the corpus of the tests (test/fixtures/snippets.json)', function () {
    /** Every command with a spec, its words as `argWord` reads them (no model: every unquoted expansion may give none). */
    const commands: { text: string; spec: CommandSpec; name: string; words: ArgWord[] }[] = [];
    before(() => {
      const snippets: string[] = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'snippets.json'), 'utf8'));
      for (const s of snippets) {
        for (const c of descendants(parser.parse(s).root, ['command'])) {
          const nameNode = field(c, 'name');
          const spec = nameNode && lookupCommand(nameNode.text);
          if (!spec) continue;
          const args = c.namedChildren.filter((x: SyntaxNode) => x !== nameNode && !x.type.endsWith('redirect') && x.startIndex > nameNode!.startIndex);
          commands.push({ text: c.text, spec, name: nameNode!.text, words: args.map(argWord) });
        }
      }
    });
    const tables = (): { text: string; t: ReadingsTable }[] =>
      commands.map(({ text, spec, name, words }) => ({ text, t: readingsOf(spec, words, ctxOf(name)) })).filter(({ t }) => t.variables.length);

    it('the table of every command, every shape read: the time', () => {
      const start = performance.now();
      let [n, readings] = [0, 0];
      const sizes: number[] = [];
      for (const { t } of tables()) {
        n++;
        for (const s of t.shapes ?? []) t.reading(s);
        readings += t.shapes?.length ?? 0;
        sizes.push(t.shapes?.length ?? 0);
      }
      const ms = performance.now() - start;
      sizes.sort((a, b) => a - b);
      if (process.env.READINGS_STATS) console.log(JSON.stringify({ commands: commands.length, flexible: n, readings, ms: Math.round(ms), median: sizes[sizes.length >> 1], p90: sizes[Math.floor(sizes.length * 0.9)], p99: sizes[Math.floor(sizes.length * 0.99)], max: sizes.at(-1) }));
      assert.ok(n > 200 && sizes.at(-1)! <= SHAPE_CAP);
      assert.ok(ms < 20000, `${ms} ms`);
    });

    it('every spec a reading visits is in the set S is taken over', () => {
      const visit = (q: { roles: readonly RoleAt[] }, out: Set<CommandSpec>): void => {
        for (const { role } of q.roles) {
          if (role.role === 'subcommand') out.add(role.spec);
          if (role.role === 'command' && role.spec) out.add(role.spec);
          if ((role.role === 'subcommand' || role.role === 'command') && role.parse) visit(role.parse, out);
          // (The commands a string a value splices in starts: `env -S'tar …'`.)
          const value = role.role === 'value' ? role : role.role === 'option' ? role.value : undefined;
          if (value?.split) visit(value.split, out);
        }
      };
      const missed: string[] = [];
      for (const { text, t } of tables()) {
        const seen = new Set<CommandSpec>();
        for (const s of t.shapes ?? []) visit(t.reading(s).parse, seen);
        if ([...seen].some((s) => !t.specs.has(s))) missed.push(text);
      }
      assert.deepStrictEqual(missed, []);
    });

    it('the bound holds: the roles past S are those at S (each variable up to two more than its top)', () => {
      const wrong: string[] = [];
      for (const { text, t } of tables()) {
        // (Many variables: a sample of the vectors.)
        for (const x of vectors(t, 2, 4096)) {
          const capped = x.map((c, v) => Math.min(c, t.variables[v].top));
          if (capped.every((c, v) => c === x[v])) continue;
          const [a, b] = [t.at(x), t.at(capped)];
          if (a.outcome !== b.outcome || a.fields.some((f, k) => squeezed(f) !== squeezed(b.fields[k]))) {
            wrong.push(`${text} at ${x.join(',')}`);
            break;
          }
        }
      }
      assert.deepStrictEqual(wrong, []);
    });

    it('the words the text past the cap names hold every word whose role may change', () => {
      const wrong: string[] = [];
      for (const { text, t } of tables()) {
        // (Past the cap, no shape is read: `cp -v{a,b}$x d`, four parts.)
        if (!t.shapes) continue;
        const hedged = new Set(t.hedged());
        const base = t.at(t.base).fields;
        const flexible = Math.min(...t.variables.map((v) => v.words[0]));
        const inRun = new Set(t.runs.flatMap((r) => r.words));
        for (const s of t.shapes!) {
          const r = t.reading(s);
          if (r.outcome !== 'read') continue;
          // (The words of the line before the first flexible one give their own number of words: where each starts in
          // the reading does not depend on the counts. Their roles go back to the command's words through `back`.)
          const roles = allRoles(r.parse);
          const read = new Map<number, ArgRole[]>();
          let at = 0;
          for (let j = 0; j < flexible; j++) {
            const n = inRun.has(j) ? t.line[j].count?.min ?? 1 : 1;
            for (let i = 0; i < n; i++) read.set(t.back(j), [...read.get(t.back(j)) ?? [], roles.get(at++)!]);
          }
          const moved = [...read].flatMap(([k, f]) => (!hedged.has(k) && squeezed(f) !== squeezed(base[k]) ? [k] : []));
          if (moved.length) wrong.push(`${text}: ${moved.join(' ')} at ${s.join(',')}`);
        }
      }
      assert.deepStrictEqual(wrong, []);
    });

    it('every context of every word reads a shape of the table', () => {
      const wrong: string[] = [];
      for (const { text, t } of tables()) {
        if (!t.shapes) continue;
        const shapes = new Set(t.shapes.map((s) => s.join()));
        for (let k = 0; k < t.back(t.line.length - 1) + 1; k++) {
          // (A word in parts has no own count, and no contexts.)
          if (t.parted[k]) continue;
          const { contexts, own } = t.contexts(k)!;
          for (const context of contexts) {
            for (const c of own) {
              const r = t.readAt(k, context, c);
              if (!shapes.has(r.sums.join()) || r.fields.length !== c || r.fields.some((f) => !f)) wrong.push(`${text}: word ${k} at ${context.join(',')} with ${c}`);
            }
          }
        }
      }
      assert.deepStrictEqual(wrong, []);
    });
  });
});

