// The evaluator of query expressions over a made-up workspace (src/examples/bazelquery.ts), which the pipeline examples
// of `bazel query` and `bazel cquery` run, against what bazel 9.3.2 printed (test/fixtures/oracles/bazel.json, written
// by scripts/record-bazel.ts): every row of `examples`, over test/fixtures/bazel-cc (the evaluator's own workspace,
// `BAZEL_CC`), line by line; and every row of `expressions` with its targets, over test/fixtures/bazel, described below
// from its BUILD files. A row the evaluator does not follow is listed with the reason, and must give no output: never a
// guess. Then the runner chosen by the spec (`CommandSpec.runner`, src/examples/runners.ts) and the pipeline's example.
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import type { Example } from '../src/analyzer';
import { interpret } from '../src/argv/interpret';
import { bazel } from '../src/dict/bazel';
import { runQuery, type QueryOutput, type QueryRun } from '../src/examples/bazelquery';
import { BAZEL_CC, type Workspace } from '../src/examples/bazelworkspace';
import { guarded } from '../src/examples/regexguard';
import { sourceRun } from '../src/examples/runners';
import { explain } from './support/explain';

interface Row { command: 'query' | 'cquery' | 'aquery'; options?: string[]; expression: string; status: number; output?: string[]; targets?: string[] }
const record = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'oracles', 'bazel.json'), 'utf8')) as { examples: { targets: string[]; rows: Row[] }; expressions: Row[] };

/** What the evaluator gives for a row: `--output` and `--noimplicit_deps` read from its options, which must be all it has. */
function evaluate(ws: Workspace, row: Row): string[] | undefined | 'options' {
  const opts = row.options ?? [];
  const output = opts.find((o) => o.startsWith('--output='))?.slice('--output='.length) ?? 'label';
  if (opts.some((o) => !o.startsWith('--output=') && o !== '--noimplicit_deps') || !['label', 'label_kind', 'package'].includes(output)) return 'options';
  const run: QueryRun = { command: row.command as QueryRun['command'], expression: row.expression, output: output as QueryOutput, implicitDeps: !opts.includes('--noimplicit_deps') };
  return guarded(() => runQuery(ws, run), () => assert.fail(`refused: ${row.expression}`));
}

/** An expression of more steps than the evaluator takes: a set of 12000 words. */
const MANY = `set(${Array.from({ length: 12000 }, () => '//app:main').join(' ')})`;

const key = (r: Row) => `${r.command} ${(r.options ?? []).join(' ')} ${r.expression}`.replace(/ +/g, ' ');

/** The rows of `examples` the evaluator does not follow, and why. */
const EXAMPLES_NOT_COMPUTED: Record<string, string> = {
  'query --output=location //...': 'the output `location` (a path of this machine)',
  'query --noimplicit_deps deps(//app:main)': 'the dependencies of @abseil-cpp are not in the workspace',
  'query --noimplicit_deps --output=graph --nograph:factored deps(//app:main, 2)': 'the output `graph` (its nodes are checked below)',
  "query --noimplicit_deps filter('^//lib', deps(//app:main))": 'the dependencies of @abseil-cpp are not in the workspace',
  'query --output=build //lib:greet': 'the output `build`',
  'query --output=location //lib:greet': 'the output `location`',
  'query //nosuch:target': 'an error: no such package',
  'cquery --noimplicit_deps deps(//app:main, 1)': 'cquery prints the dependencies in an order of its own',
  'cquery deps(//tools:version, 1)': 'cquery: the toolchains and platforms',
  'cquery --output=files //lib:greet': 'the output `files`',
};

describe('the query examples over the made-up workspace, as bazel printed them', () => {
  const rows = record.examples.rows.filter((r) => r.command !== 'aquery');
  for (const row of rows) {
    it(key(row), () => {
      const got = evaluate(BAZEL_CC, row);
      const why = EXAMPLES_NOT_COMPUTED[key(row)];
      if (why) assert.ok(got === undefined || got === 'options', `${why}, yet computed: ${JSON.stringify(got)}`);
      else assert.deepStrictEqual(got, row.output);
    });
  }
  it('lists only rows there are', () => {
    for (const k of Object.keys(EXAMPLES_NOT_COMPUTED)) assert.ok(rows.some((r) => key(r) === k), k);
  });
  it('has the kinds of the recorded workspace, every target of it', () => {
    const main = BAZEL_CC.targets.filter((t) => t.label.startsWith('//')).map((t) => `${t.kind} ${t.label}`).sort();
    assert.deepStrictEqual(main, record.examples.targets);
  });
  it('gives the nodes the graph of `deps(//app:main, 2)` shows', () => {
    const graph = rows.find((r) => r.options?.includes('--output=graph'))!.output!;
    const nodes = graph.flatMap((l) => /^ {2}"([^"]+)"$/.exec(l)?.[1] ?? []).sort();
    assert.deepStrictEqual(evaluate(BAZEL_CC, { command: 'query', options: ['--noimplicit_deps'], expression: 'deps(//app:main, 2)', status: 0 }), nodes);
  });
});

/** test/fixtures/bazel, from its BUILD files: `script` and `script_test` rules have no dependencies, implicit ones neither (`deps(//app:main)`). */
const SCRIPTS: Workspace = {
  targets: [
    { label: '//app/legacy:BUILD', kind: 'source file' },
    { label: '//app/legacy:old', kind: 'filegroup rule', attrs: { srcs: ['//app/legacy:BUILD'] }, open: true },
    { label: '//app:BUILD', kind: 'source file' },
    { label: '//app:app', kind: 'filegroup rule', attrs: { srcs: ['//app:data.txt'] }, open: true },
    { label: '//app:data', kind: 'filegroup rule', attrs: { srcs: ['//app:BUILD'] }, open: true },
    { label: '//app:data.txt', kind: 'source file' },
    { label: '//app:debug', kind: 'script rule', attrs: {}, tags: ['manual'] },
    { label: '//app:main', kind: 'script rule', attrs: {} },
    { label: '//app:main_test', kind: 'script_test rule', attrs: {} },
    { label: '//tools:BUILD', kind: 'source file' },
    { label: '//tools:fmt', kind: 'script rule', attrs: {} },
  ],
  configs: { target: 'target', test: 'test', exec: 'exec' },
};

/** The rows of `expressions` (with their targets) the evaluator does not follow, by kind. */
const EXPRESSIONS_NOT_COMPUTED: [RegExp, string][] = [
  [/^c?query (?:executables|buildfiles|loadfiles|siblings|some|same_pkg_direct_rdeps|visible|allrdeps|rbuildfiles|config)\b/, 'a function the evaluator does not follow'],
  [/config\(/, 'cquery\'s `config`'],
  [/^cquery (?:deps|rdeps|somepath|allpaths|labels)\b/, 'cquery: a function that walks the configured graph'],
  [/^query app$/, 'a pattern relative to the current directory'],
  [/^query filter\("(?:\[\\w-\.\]|\\p\{L\})"/, 'a Java regex the examples have no JavaScript one for'],
];

describe('the query expressions over test/fixtures/bazel, as bazel gave their targets', () => {
  const rows = record.expressions.filter((r) => r.targets);
  for (const row of rows) {
    const text = `${row.command} ${row.expression}`;
    it(key(row), () => {
      // (A row of options the evaluator does not read: `--universe_scope`.)
      const got = evaluate(SCRIPTS, row);
      const why = EXPRESSIONS_NOT_COMPUTED.find(([re]) => re.test(text));
      if (why || got === 'options') assert.ok(got === undefined || got === 'options', `${why?.[1]}, yet computed`);
      // (The record's targets are sorted, a cquery's configuration left out.)
      else assert.deepStrictEqual(got!.map((l) => l.replace(/ \([^)]*\)$/, '')).sort(), row.targets);
    });
  }
});

describe('what the evaluator leaves not computed', () => {
  const run = (expression: string, more: Partial<QueryRun> = {}, ws = BAZEL_CC) => guarded<string[] | undefined | 'refused'>(() => runQuery(ws, { command: 'query', expression, output: 'label', implicitDeps: false, ...more }), () => 'refused');
  it('the patterns it cannot resolve', () => {
    for (const e of ['main', ':main', '//app:nosuch', '//nosuch/...', '//nosuch:all', '"-//app:main"', '@@abseil-cpp+//absl/strings:strings', '@abseil-cpp//...', '@abseil-cpp//absl/strings:all', '@rules_cc//:nosuch', '//app/./x:a', '@abseil-cpp']) assert.strictEqual(run(e), undefined, e);
    assert.deepStrictEqual(run('@//app:main'), ['//app:main']);
    assert.deepStrictEqual(run('//app:*'), ['//app:BUILD', '//app:data', '//app:data.txt', '//app:main', '//app:main.cc', '//app:main.dwp', '//app:main.stripped', '//app:main_test', '//app:main_test.cc', '//app:main_test.dwp', '//app:main_test.stripped']);
  });
  it('a dependency it does not know, or one that may be implicit', () => {
    assert.strictEqual(run('deps(//app:main, 3)'), undefined);
    assert.strictEqual(run('deps(//app:main, 1)', { implicitDeps: true }), undefined);
    assert.strictEqual(run('deps(//app:main_test, 1)'), undefined);
    assert.deepStrictEqual(run('deps(//app:main.stripped, 1)'), ['//app:main', '//app:main.stripped']);
    assert.deepStrictEqual(run('deps(//util:text)', { implicitDeps: false }), ['//util:strutil', '//util:strutil.cc', '//util:strutil.h', '//util:text', '//util:text.cc', '//util:text.h']);
    // (What reaches a target of the main repository is known, whatever the implicit dependencies are.)
    assert.deepStrictEqual(run('rdeps(//app:all, //lib:greet, 1)', { implicitDeps: true }), ['//app:main', '//app:main_test', '//lib:greet']);
    assert.strictEqual(run('rdeps(//..., @abseil-cpp//absl/strings:strings)'), undefined);
    assert.strictEqual(run('deps(@rules_cc//:link_extra_lib, 1)', { output: 'label_kind' }), undefined);
  });
  it('a path where bazel may take another, or that it prints in no order known', () => {
    assert.deepStrictEqual(run('somepath(//app:main, //util:text)'), ['//app:main', '//lib:greet', '//util:text']);
    assert.deepStrictEqual(run('somepath(//app:main, //tools:fmt)'), []);
    // (Two ways to `//util:text`; a target of `from` or `to` on the way; somepath inside another function.)
    assert.strictEqual(run('somepath(//app:main + //tools:fmt, //util:text)'), undefined);
    assert.strictEqual(run('somepath(//app:main + //lib:greet, //util:text)'), undefined);
    assert.strictEqual(run('somepath(//app:main, //lib:greet + //util:text)'), undefined);
    assert.strictEqual(run('somepath(//app:main, //util:text) + //app:data'), undefined);
    assert.strictEqual(run('somepath(//app:main, //util:text)', { output: 'package' }), undefined);
    // (A target with two ways on: `//lib:greet` to `greet.cc` and to `//util:text`.)
    assert.strictEqual(run('somepath(//app:main, //lib:greet.cc + //util:strutil)'), undefined);
  });
  it('the attributes it does not know, the regexes JavaScript has none for, the kinds it does not know', () => {
    assert.strictEqual(run('attr(srcs, x, //...)'), undefined);
    assert.strictEqual(run('attr(visibility, private, //...)'), undefined);
    assert.deepStrictEqual(run('attr(visibility, "//visibility:public", //...)'), ['//lib:greet', '//util:text']);
    assert.deepStrictEqual(run('attr(name, main, //...:*)'), ['//app:main', '//app:main_test']);
    assert.strictEqual(run('attr(name, x, @abseil-cpp//absl/strings)'), undefined);
    assert.strictEqual(run('filter("a++", //...)'), undefined);
    assert.strictEqual(run('filter(x, @abseil-cpp//absl/strings)'), undefined);
    assert.strictEqual(run('kind(rule, deps(//app:main, 2))'), undefined);
    assert.strictEqual(run('labels(srcs, //app:main.cc)'), undefined);
    assert.strictEqual(run('labels(hdrs, //app:main)'), undefined);
    assert.strictEqual(run('labels(deps, @rules_cc//:link_extra_lib)'), undefined);
    assert.strictEqual(run('@abseil-cpp//absl/strings', { output: 'package' }), undefined);
    assert.strictEqual(run('tests(deps(@rules_cc//:link_extra_lib, 1))'), undefined);
    assert.strictEqual(run('siblings(//app:main)'), undefined);
  });
  it('cquery: the targets it cannot configure, the functions that walk the graph, the package output', () => {
    const cquery = (expression: string, more: Partial<QueryRun> = {}, ws = BAZEL_CC) => run(expression, { command: 'cquery', ...more }, ws);
    assert.deepStrictEqual(cquery('//tools:fmt + //tools:version', { output: 'label_kind' }), ['cc_binary rule //tools:fmt (04bf134)', 'cc_binary rule //tools:fmt (a7a71fd)', 'genrule rule //tools:version (a7a71fd)']);
    assert.deepStrictEqual(cquery('let t = tests(//app:all) in $t + set(//app:main.cc)'), ['//app:main.cc (null)', '//app:main_test (e722a21)']);
    assert.deepStrictEqual(cquery('attr(name, "^te", //util:all) ^ //util:text'), ['//util:text (a7a71fd)']);
    for (const e of ['//app:main.stripped', '@abseil-cpp//absl/strings', 'deps(//app:main)', 'labels(srcs, //app:main)', 'somepath(//app:main, //lib:greet)']) assert.strictEqual(cquery(e), undefined, e);
    assert.strictEqual(cquery('//app:main', { output: 'package' }), undefined);
    // (A rule of the workspace whose dependencies are not known, or one that depends on a generated file.)
    const odd: Workspace = { configs: BAZEL_CC.configs, targets: [{ label: '//a:x', kind: 'x rule' }, { label: '//a:y', kind: 'y rule', attrs: { srcs: ['//a:g'] } }, { label: '//a:g', kind: 'generated file', rule: '//a:x' }, { label: '//a:s', kind: 'test_suite rule', attrs: {} }, { label: '//a:z', kind: 'z rule', attrs: { deps: ['//a:missing'] } }] };
    assert.strictEqual(cquery('//a:x', {}, odd), undefined);
    assert.strictEqual(cquery('//a:y', {}, odd), undefined);
    assert.strictEqual(run('rdeps(//a:x, //a:x)', {}, odd), undefined);
    assert.strictEqual(run('rdeps(//a:z, //a:z)', {}, odd), undefined);
    assert.strictEqual(run('deps(//a:z)', {}, odd), undefined);
    assert.strictEqual(run('tests(//a:all)', {}, odd), undefined);
  });
  it('stops at its steps, as the guard of the examples does', () => {
    assert.strictEqual(run(MANY), 'refused');
  });
});

describe('the runner of the spec of `bazel query`', () => {
  const words = (line: string) => line.split(' ');
  const runOf = (line: string, lang: 'en' | 'ja' = 'en') => {
    const w = words(line);
    return sourceRun(bazel.bazel, interpret(bazel.bazel, w.map((text) => ({ text, value: text })), { name: 'bazel' }), w, lang);
  };
  it('reads `--output`, `--implicit_deps` and the options that print nothing else; no other', () => {
    assert.deepStrictEqual(runOf('query --output label_kind --noshow_progress -- //app:main')?.lines, ['cc_binary rule //app:main']);
    assert.deepStrictEqual(runOf('query --noimplicit_deps --implicit_deps deps(//app:main, 1)'), undefined);
    assert.deepStrictEqual(runOf('query --implicit_deps=false deps(//app:data.txt+//lib:greet.h, 1) --output=package')?.lines, ['app', 'lib']);
    for (const line of ['query --order_output=no //...', 'query --nosuch //...', 'query //... --output', 'query --output=xml //...', 'query', 'query kind(', 'cquery --output=package //...', 'build //...', 'aquery //...']) assert.strictEqual(runOf(line), undefined, line);
    // (A run the guard refuses: the steps of the evaluation.)
    assert.strictEqual(runOf(`query ${MANY}`), undefined);
    // (The words of one expression, joined with spaces.)
    assert.deepStrictEqual(runOf('query kind(cc_test, //...)')?.lines, ['//app:main_test']);
  });
  it('says the workspace is made up, and the configurations of a cquery', () => {
    assert.match(runOf('query //app:main')!.note, /made-up C\+\+ workspace/);
    assert.doesNotMatch(runOf('query //app:main')!.note, /configurations/);
    assert.match(runOf('cquery //app:main')!.note, /configurations in parentheses/);
    assert.match(runOf('cquery //app:main', 'ja')!.note, /架空の C\+\+ のワークスペース.*構成/);
  });
});

describe('a pipeline that starts with `bazel query`', () => {
  const whole = (line: string, lang: 'en' | 'ja' = 'en'): Example | undefined => explain(line, 0, lang).examples.find((e) => e.kind === 'pipeline');
  const LINE = "bazel query 'kind(cc_library, //...)' --output label_kind | awk '{print $3}'";
  const recorded = record.examples.rows.find((r) => r.expression === 'kind(cc_library, //...)')!.output!;
  it('shows what the query prints over the made-up workspace as the input of awk, with a note that it is an example (en)', () => {
    const ex = whole(LINE)!;
    assert.ok(ex, 'has an example of the whole pipeline');
    assert.deepStrictEqual(ex.sections.map((s) => s.label), ["Output of `bazel query 'kind(cc_library, //...)' -…` (sample)", "Output (after `awk '{print $3}'`)"]);
    assert.deepStrictEqual(ex.sections[0].lines, recorded);
    assert.deepStrictEqual(ex.sections[1].lines, recorded.map((l) => l.split(' ')[2]));
    assert.match(ex.note!, /^An example over a made-up C\+\+ workspace/);
  });
  it('the same in Japanese', () => {
    const ex = whole(LINE, 'ja')!;
    assert.deepStrictEqual(ex.sections[0].lines, recorded);
    assert.match(ex.sections[0].label, /の出力（例）$/);
    assert.match(ex.note!, /^架空の C\+\+ のワークスペース/);
  });
  it('a query of a word it does not follow has none; the stages after it read the lines', () => {
    const ex = whole('bazel query "$USER" | wc -l');
    assert.strictEqual(ex, undefined);
    const sorted = explain('bazel cquery //app:all | sort -r').examples.find((e) => e.kind === 'pipeline')!;
    assert.deepStrictEqual(sorted.sections[1].lines, ['//app:main_test (e722a21)', '//app:main (a7a71fd)', '//app:data (a7a71fd)']);
    // (The lines a later stage reads, in its own example: what the stages before it print.)
    const sed = explain("bazel query //lib:all | sed 's/:/ /' | sort").examples.find((e) => e.kind === 'pipeline')!;
    assert.deepStrictEqual(sed.sections.at(-1)!.lines, ['//lib greet']);
  });
  it('nothing for words it cannot read as written: a brace expansion, a value split into options, a query it does not follow', () => {
    for (const line of ['bazel query //app:{main,data} | wc -l', 'o="--output label_kind"; bazel query $o //... | wc -l', 'bazel query "$1" | wc -l', 'bazel query --output "$1" //... | wc -l', 'bazel query deps(//app:main) | wc -l', 'bazel build //... | wc -l']) {
      assert.strictEqual(explain(line).examples.find((e) => e.kind === 'pipeline'), undefined, line);
    }
  });
});
