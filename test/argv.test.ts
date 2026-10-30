// Argv capture (docs/design/oracles.md, 2, steps 2 and 3): each input runs in bash with its commands replaced by a
// recorder (test/support/argv.ts), and the fields the word model gives each word of each command (`wordFields`: what
// the explanation says the program receives) are compared with the argv bash gave the recorder.
//
// The inputs: the fixtures (`fixtureInputs`: sample.sh, coverage.sh, each section of sample.sh, the shell code of the
// host fixtures that bash runs), and a sample of the snippets of the tests (`snippetInputs`, a fixed share chosen by a
// hash of the text, so that a new snippet changes the sample by itself only). Each input runs twice (`ARGV_ENVS`): in
// the probes' environment (`ARGV_ENV`: no other variable, no positional parameter, stdin empty), and with values for
// the variables it reads, two positional parameters and lines on stdin (a space, a glob, an empty one). All the
// snippets and 200 fuzz inputs run by hand: scripts/argv-corpus.ts.
//
// No command may reach a PATH search. A difference (`compareMarker`) is listed in test/fixtures/argv-known.json with its
// reason; an entry of an input that ran and no longer differs fails, and so do counts that changed (update them when
// the fixtures or the sampled snippets change).
//
// On the same runs, step 9 (oracles.md, 2.5 and 2.8; test/support/renderings.ts): what the explanation says of the
// number of words each word gives, its glob examples, and the roles of the fields of a word that gives other than one
// (the interpreter reading bash's argv), against bash. Differences go in test/fixtures/renderings-known.json.
import * as assert from 'assert';
import * as fs from 'fs';
import { shellState } from '../src/semantics/state';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { ARGV_KNOWN, type ArgvInput, type ArgvKnownFile, type ArgvPlanRun, checkArgv, fixtureInputs, instrumentArgv, matchKnown, runArgv, runArgvBatch, SNIPPET_SAMPLE, snippetInputs, toNull } from './support/argv';
import { probeSkipReason } from './support/probe';
import { checkRenderings, claimsOf, explainInput, globExampleOn, matchRenderKnown, RENDER_KNOWN, type RenderFinding, type RenderKnownFile, saysOperand, staleClasses, wordCauses, wordCounts } from './support/renderings';

describe('argv capture: the word model and the explanation against bash (oracles.md, steps 2, 3 and 9)', function () {
  this.timeout(120000);

  it('replaces each command by a recorder, keeps state builtins and functions, and sends redirections to /dev/null', () => {
    const script = [
      'f() { x=1 cmd "$1" >out 2>&1; }',
      'f a; set -e; read -r v <in; [ -f a ] && printf -v y %s z',
      'while getopts a o; do :; done; while next; do :; done; until ready; do :; done',
      'cat <(ls) >&$fd {fd}>log; { echo; } >/tmp/o; >o echo $(date >d)',
    ].join('\n');
    const tree = createUnbashParser().parse(script);
    const inst = instrumentArgv(tree, shellState(tree, 'bash'));
    assert.strictEqual(inst.script, [
      'f() { x=1 __probe 1 cmd "$1"  @@R@@ out @@E@@ >&97 2>&1; }',
      'f a; set -e; read -r v  <&97; __probe_r 2 [ -f a ] && __probe_r 3 printf -v y %s z',
      'while getopts a o; do __probe_r 4 :; done; while __probe_w 5 next; do __probe_r 6 :; done; until __probe_u 7 ready; do __probe_r 8 :; done',
      '__probe 9 cat <(__probe 10 ls)  >&97  @@R@@ log @@E@@ {fd}>&97; { __probe 11 echo; }  >&97;  >&97 __probe 12 echo $(__probe 13 date  @@R@@ d @@E@@ >&97)',
    ].join('\n'));
    assert.deepStrictEqual(inst.unmarked, { function: 1, state: 3 });
    assert.deepStrictEqual(inst.markers.map((m) => [m.kind, m.words.map((w) => w.text).join(' '), m.targets.map((t) => t.text).join(' ')]), [
      ['stub', 'cmd "$1"', 'out'], ['run', '[ -f a ]', ''], ['run', 'printf -v y %s z', ''], ['run', ':', ''], ['while', 'next', ''],
      ['run', ':', ''], ['until', 'ready', ''], ['run', ':', ''], ['stub', 'cat <(ls)', 'log'], ['stub', 'ls', ''], ['stub', 'echo', ''],
      ['stub', 'echo $(date >d)', ''], ['stub', 'date', 'd'],
    ]);
    // A function defined in a string `eval` runs is not defined in the run, where `eval` is recorded.
    const evaluated = createUnbashParser().parse("eval 'g() { :; }'; g; h() { :; }; h");
    assert.deepStrictEqual(instrumentArgv(evaluated, shellState(evaluated, 'bash')).script, "__probe 1 eval 'g() { :; }'; __probe 2 g; h() { __probe_r 3 :; }; h");
  });

  it('sends a file redirection to the descriptor opened on /dev/null', () => {
    assert.deepStrictEqual(['>', '2>>', '>|', '&>', '&>>', '<', '<>', '3<>', '{fd}>', '2>&'].map(toNull),
      ['>&97', '2>&97', '>&97', '>&97 2>&97', '>&97 2>&97', '<&97', '<&97', '3<&97', '{fd}>&97', '2>&97']);
  });

  it('reads the counts of words the explanation says, from the facts its tokens and examples carry', () => {
    const tree = createUnbashParser().parse('x="a b"; cp $x d; echo {a,b} "a b" "$@" $x/c "$@"/c; ls *.txt; set -f; ls *.txt');
    const input: ArgvInput = { name: 'claims', tree, model: shellState(tree, 'bash'), provided: [] };
    const shown = explainInput(input);
    const words = instrumentArgv(tree, input.model).markers.flatMap((m) => m.words.slice(1));
    assert.deepStrictEqual(words.map((w) => [w.text, claimsOf(w, shown, input).map((c) => `${c.source} ${c.count}`).join(', '), globExampleOn(w, shown)]), [
      // (The value of `$x` and its words; the argument is marked as split, so it says no count.)
      ['$x', 'value 2', false], ['d', 'argument 1', false],
      ['{a,b}', 'brace 2, brace-example 2', false], ['"a b"', 'argument 1, string 1', false],
      // (`"$@"`: the argument is marked as one word per element, and its string says so: no count.)
      ['"$@"', '', false], ['$x/c', 'concatenation 2', false],
      // (A concatenation with `"$@"` says it is not one word, and its argument is marked as `"$@"`'s: no count.)
      ['"$@"/c', '', false],
      // (A glob: an example of the files it matches, and no count; after `set -f`, one argument and no example.)
      ['*.txt', '', true], ['*.txt', 'argument 1', false],
    ]);
    // Bash's number of fields of each word: known from the model, or what lies between the known words around the only
    // one it does not know.
    assert.deepStrictEqual(wordCounts([{ fields: ['cp'] }, {}, { fields: ['d'] }], ['cp', 'a', 'b', 'd']), [1, 2, 1]);
    assert.deepStrictEqual(wordCounts([{ fields: ['cp'] }, {}, {}], ['cp', 'a', 'b']), [1, undefined, undefined]);
  });

  it('reads the role of a field at its place in the readings or in the words of a brace expansion', () => {
    const dest = ['destination (the new name, or an existing directory)', 'destination: the new name, or an existing directory'];
    const place = (text: string, at: number, of: number, counts: [string, number][] = []) => ({ text, at, of, counts: new Map(counts) });
    // (The words of `cp a{,'.bak'}` and `cp a{,"b c"}` as written, with their quotes; bash's fields have none: by place.)
    const quoted = "expands to `a` (source) and `a'.bak'` (destination: the new name, or an existing directory)";
    const spaced = 'expands to `a` (source) and `a"b c"` (destination: the new name, or an existing directory)';
    assert.deepStrictEqual([saysOperand(quoted, dest, place('a.bak', 1, 2)), saysOperand(quoted, dest, place('a', 0, 2)), saysOperand(spaced, dest, place('ab c', 1, 2))], [true, false, true]);
    // (By own count: the group for the number of fields the word gave, the first field the first role and the last the
    // last; "more words" after the group before; none for a count no group covers. The first may name the word.)
    const counted = `source when \`$a\` expands to a single word; when it expands to 2 words, they are source, then ${dest[0]}; when it expands to more words, they are source, then destination directory`;
    assert.deepStrictEqual([saysOperand(counted, dest, place('b', 1, 2)), saysOperand(counted, ['destination directory'], place('b', 1, 2)), saysOperand(counted, ['destination directory'], place('c', 2, 3)), saysOperand(counted, dest, place('c', 2, 3)), saysOperand(counted, ['source'], place('a', 0, 1))], [true, false, true, false, true]);
    const ranges = 'when `$a` expands to 3 words, they are A, then B; when it expands to 4 to 5 words, they are A, then C; when it expands to 6 words or more, they are A, then D';
    assert.deepStrictEqual([2, 3, 4, 5, 6, 9].map((n) => ['B', 'C', 'D'].findIndex((x) => saysOperand(ranges, [x], place('x', n - 1, n)))), [-1, 0, 1, 1, 2, 2]);
    // ("More words" first, after no group: another form, a finding.)
    assert.strictEqual(saysOperand('when `$a` expands to more words, they are A, then B', ['B'], place('x', 1, 2)), false);
    // (A clause holds for the counts of the words it names: `cp $a b`.)
    const clauses = `${dest[0]}. When \`$a\` expands to nothing, it is source. When \`$a\` expands to several words, it is destination directory`;
    assert.deepStrictEqual([1, 0, 2].map((n) => ['source', 'destination directory', dest[0]].filter((x) => saysOperand(clauses, [x], place('b', 0, 1, [['$a', n]]))).join()), [dest[0], 'source', 'destination directory']);
    // (The fields the model knows, then a clause on the others: `p='a b'; cp $p $u`.)
    const fields = 'expands to `a` (source) and `b` (source). When `$u` expands to nothing, its words are source, then destination (the new name, or an existing directory)';
    assert.deepStrictEqual([saysOperand(fields, dest, place('b', 1, 2, [['$u', 0]])), saysOperand(fields, dest, place('b', 1, 2, [['$u', 1]])), saysOperand(fields, ['source'], place('b', 1, 2, [['$u', 1]]))], [true, false, true]);
    // (The hedge of a value: the part for the words it names when they gave none and this word one; else the part before.)
    const none = 'Value for `-e`; file to search when `$a`, `$b` expand to nothing';
    const both = (n: number): [string, number][] => [['$a', n], ['$b', n]];
    assert.deepStrictEqual([saysOperand(none, ['file to search'], place('c', 0, 1, both(0))), saysOperand(none, ['file to search'], place('c', 0, 1, both(1))), saysOperand(none, ['file to search'], place('c', 0, 1, [['$a', 0], ['$b', 1]]))], [true, false, false]);
    // (A clause in another form is a finding, so that a new wording is seen.)
    assert.strictEqual(saysOperand('source. When `$a` expands to nothing or more, it is target', ['source'], place('a', 0, 1, [['$a', 1]])), false);
  });

  it('accepts a class of differences only under its condition, and refuses a class with none', () => {
    const tree = createUnbashParser().parse('x="a b"; echo $x/a "$@"/a "$@"/* "${a[@]}"x {a,b}"x" a"b"');
    const input: ArgvInput = { name: 'classes', tree, model: shellState(tree, 'bash'), provided: [] };
    const words = instrumentArgv(tree, input.model).markers.flatMap((m) => m.words.slice(1));
    // (A concatenation that said "joined into one word" of each word, as `concatenationNote` did before it asked the
    // model: the class takes only those that a step may make other than one word, with no `"$@"`-like part.)
    const found: RenderFinding[] = words.map((w) => ({
      input: input.name, env: 'probe', command: 'echo', word: w.text, check: 'count', source: 'concatenation', causes: wordCauses(w, input.model), what: '',
    }));
    const known: RenderKnownFile['known'] = [{ check: 'count', source: 'concatenation', when: 'fields-step', reason: 'a class' }];
    const { unexplained } = matchRenderKnown(found, known, []);
    assert.deepStrictEqual(unexplained.map((u) => u.replace(/^[^[]*\[(.*), count\][^]*$/, '$1')), ['"$@"/a', '"$@"/*', '"${a[@]}"x', 'a"b"']);
    assert.throws(() => matchRenderKnown(found, [{ check: 'count', source: 'concatenation', reason: 'every one' }], []), /needs a source and a condition/);
    assert.throws(() => matchRenderKnown(found, [{ check: 'count', when: 'fields-step', reason: 'every source' }], []), /needs a source and a condition/);
  });

  if (probeSkipReason) {
    it.skip(`needs bash 5.2 or later: ${probeSkipReason}`, () => undefined);
    return;
  }

  it('keeps a command it did not replace from running: no PATH, the builtins that reach out turned off, restricted', async () => {
    const [run] = await runArgvBatch([{ script: 'ls -l; eval date; source ./x; trap "id" EXIT; __probe 1 "$PATH" "$HOME" ~ * >&97\n' }]);
    assert.deepStrictEqual(run.escaped, ['ls', 'eval', 'source', 'trap']);
    assert.deepStrictEqual([...run.records], [['1', [['/nonexistent/explain-bash-argv', '/BOX', '/BOX', 'a.txt', 'b.txt', 'c.log', 'empty', 'sub', 'x y.txt']]]]);
    // A command named by a path, in text read as code at run time (a subscript in arithmetic), a change of PATH, a
    // file opened for output: refused by the restricted shell.
    // (Each on a line of its own: the error of an assignment to PATH ends its line.)
    const script = "x='a[$(/bin/echo run >&2)]'; : $(( x ))\nPATH=/bin\necho b >o\n__probe 2 \"$PATH\" ./*\n";
    const [restricted] = await runArgvBatch([{ script }]);
    assert.deepStrictEqual([...restricted.records], [['2', [['/nonexistent/explain-bash-argv', './a.txt', './b.txt', './c.log', './empty', './sub', './x y.txt']]]]);
    assert.match(restricted.stderr, /\/bin\/echo: restricted: cannot specify `\/' in command names/);
    assert.match(restricted.stderr, /PATH: readonly variable/);
    assert.match(restricted.stderr, /o: restricted: cannot redirect output/);
    assert.doesNotMatch(restricted.stderr, /run/);
  });

  it('waits for what a job left running, a process substitution, and kills what outlives the wait', async () => {
    // (bash does not wait for a process substitution: its record came after the batch had been read, now and then,
    // in CI.)
    const late = '__probe 1 <( for (( i = 0; i < 100000; i++ )); do :; done; __probe 2 late )\n';
    const [run] = await runArgvBatch([{ script: late }]);
    assert.deepStrictEqual([...run.records.keys()], ['1', '2']);
    const start = Date.now();
    const [left, next] = await runArgvBatch([{ script: '{ while :; do :; done; } &\n__probe 1\n' }, { script: '__probe 2\n' }]);
    assert.deepStrictEqual([[...left.records.keys()], left.status, [...next.records.keys()]], [['1'], 0, ['2']]);
    assert.ok(Date.now() - start < 8000);
  });

  // (Each set runs once, for both checks.)
  const sets: Record<string, () => ArgvInput[]> = { fixtures: fixtureInputs, snippets: () => snippetInputs(SNIPPET_SAMPLE) };
  const runs = new Map<string, Promise<{ inputs: ArgvInput[]; plans: ArgvPlanRun[] }>>();
  const runOf = (set: string) => {
    if (!runs.has(set)) runs.set(set, (async () => { const inputs = sets[set](); return { inputs, plans: await runArgv(inputs, { jobs: 4 }) }; })());
    return runs.get(set)!;
  };

  const check = async (set: string): Promise<void> => {
    const known = JSON.parse(fs.readFileSync(ARGV_KNOWN, 'utf8')) as ArgvKnownFile;
    const { inputs, plans } = await runOf(set);
    const { found, escaped, counts } = checkArgv(plans);
    const { unexplained, stale } = matchKnown(found, known.known, inputs);
    assert.deepStrictEqual({ escaped, unexplained, stale, counts }, { escaped: [], unexplained: [], stale: [], counts: known.counts[set] });
  };

  const rendered = new Map<string, Promise<ReturnType<typeof checkRenderings> & ReturnType<typeof matchRenderKnown>>>();
  const renderOf = (set: string, known: RenderKnownFile) => {
    if (!rendered.has(set)) {
      rendered.set(set, runOf(set).then(({ inputs, plans }) => { const r = checkRenderings(plans); return { ...r, ...matchRenderKnown(r.found, known.known, inputs) }; }));
    }
    return rendered.get(set)!;
  };
  const renderKnown = (): RenderKnownFile => JSON.parse(fs.readFileSync(RENDER_KNOWN, 'utf8')) as RenderKnownFile;

  const renderings = async (set: string): Promise<void> => {
    const known = renderKnown();
    const { unexplained, stale, counts } = await renderOf(set, known);
    assert.deepStrictEqual({ unexplained, stale, counts }, { unexplained: [], stale: [], counts: known.counts[set] });
  };

  it('gives every command of the fixtures the fields bash gives it', () => check('fixtures'));

  it('gives every command of a sample of the snippets the fields bash gives it', () => check('snippets'));

  it('says the counts and the roles bash gives the words of the fixtures, and a glob example only where the model glob step may apply (step 9)', () => renderings('fixtures'));

  it('says the counts and the roles bash gives the words of a sample of the snippets, and the glob examples the model glob step allows (step 9)', () => renderings('snippets'));

  it('uses every entry of renderings-known.json that accepts a class of differences', async () => {
    const known = renderKnown();
    const used = await Promise.all(Object.keys(sets).map((set) => renderOf(set, known)));
    assert.deepStrictEqual(staleClasses(known.known, used.flatMap((u) => u.classes)), []);
  });
});
