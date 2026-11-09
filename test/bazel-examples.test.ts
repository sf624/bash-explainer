// The record of the examples' workspace (test/fixtures/bazel-cc; `examples` of test/fixtures/oracles/bazel.json, written by
// scripts/record-bazel.ts): what bazel printed for the query, cquery and aquery commands the examples show. The examples'
// evaluator comes later; this test holds the record's shape, which it reads, and that nothing of the machine that recorded
// it is in it: a path is `<workspace>` or `<output_base>`, an action's key `<key>`. The configuration hashes of a cquery and an
// aquery's compiler and flags stay, and are examples (the record says so).
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

interface Row { command: 'query' | 'cquery' | 'aquery'; options?: string[]; expression: string; status: number; error?: string; output?: string[] }
interface Examples { '//': string; targets: string[]; rows: Row[] }
const fixtures = path.join(__dirname, 'fixtures');
const record = JSON.parse(fs.readFileSync(path.join(fixtures, 'oracles', 'bazel.json'), 'utf8')) as { examples: Examples };
const { examples } = record;
const WORKSPACE = path.join(fixtures, 'bazel-cc');

/** The row of a command with these options and this expression. */
const row = (command: Row['command'], expression: string, ...options: string[]): Row => {
  const r = examples.rows.find((x) => x.command === command && x.expression === expression && (x.options ?? []).join(' ') === options.join(' '));
  assert.ok(r, `no row for ${command} ${options.join(' ')} ${expression}`);
  return r;
};
const out = (r: Row): string[] => {
  assert.strictEqual(r.status, 0);
  assert.ok(Array.isArray(r.output), 'a successful row has its output');
  return r.output;
};

describe('the examples workspace record', () => {
  it('is made of about 8 targets in 4 packages, a test, and one external library', () => {
    const rules = examples.targets.filter((t) => /^\S+ rule /.test(t)).map((t) => t.replace(/^\S+ rule /, ''));
    assert.ok(rules.length >= 7 && rules.length <= 9, rules.join(' '));
    assert.strictEqual(new Set(rules.map((l) => l.slice(0, l.indexOf(':')))).size, 4);
    assert.ok(examples.targets.some((t) => t.startsWith('cc_test rule ')));
    const module = fs.readFileSync(path.join(WORKSPACE, 'MODULE.bazel'), 'utf8');
    assert.match(module, /bazel_dep\(name = "abseil-cpp"/);
    assert.ok(out(row('query', '@abseil-cpp//absl/strings', '--output=label_kind'))[0].includes('@abseil-cpp//absl/strings'));
    // (Every BUILD file of the fixture is a package of the record.)
    const packages = fs.readdirSync(WORKSPACE).filter((d) => fs.existsSync(path.join(WORKSPACE, d, 'BUILD'))).sort();
    assert.deepStrictEqual(packages, ['app', 'lib', 'tools', 'util']);
  });

  it('is a stable shape: a row has its status and its output (or its error)', () => {
    assert.ok(examples.rows.length >= 30);
    for (const r of examples.rows) {
      assert.ok(['query', 'cquery', 'aquery'].includes(r.command));
      assert.strictEqual(typeof r.expression, 'string');
      assert.strictEqual(typeof r.status, 'number');
      if (r.status === 0) assert.ok(Array.isArray(r.output) && r.output.every((l) => typeof l === 'string') && !r.error, r.expression);
      else assert.ok(typeof r.error === 'string' && !r.output, r.expression);
    }
    const expressions = examples.rows.map((r) => `${r.command} ${(r.options ?? []).join(' ')} ${r.expression}`);
    assert.strictEqual(new Set(expressions).size, expressions.length, 'a row once');
  });

  it('holds nothing of the machine it was recorded on', () => {
    const text = JSON.stringify([examples.targets, examples.rows]);
    assert.ok(!/\/home\/|\/Users\/|\/tmp\/|\/var\/folders|record-bazel|_bazel_/.test(text));
    // (The only absolute paths: the compiler the toolchain found, and the system's shell.)
    for (const r of examples.rows) {
      for (const l of r.output ?? []) {
        assert.ok(!/ActionKey: [0-9a-f]{16}/.test(l), l);
        if (/ActionKey:/.test(l)) assert.match(l, /ActionKey: <key>$/);
      }
    }
    assert.ok(/example/.test(examples['//']) && /hashes/.test(examples['//']), 'the record says what is an example');
  });

  it('gives the labels of the targets, query and cquery alike', () => {
    const rules = examples.targets.filter((t) => /^\S+ rule /.test(t)).map((t) => t.replace(/^\S+ rule /, '')).sort();
    assert.deepStrictEqual(out(row('query', '//...', '--output=label')).slice().sort(), rules);
    const kinds = out(row('query', '//...', '--output=label_kind'));
    assert.deepStrictEqual(kinds.map((l) => l.replace(/^\S+ rule /, '')).sort(), rules);
    assert.deepStrictEqual(out(row('query', '//...', '--output=package')), ['app', 'lib', 'tools', 'util']);
    for (const l of out(row('query', '//...', '--output=location'))) assert.match(l, /^<workspace>\/\w+\/BUILD:\d+:\d+: \S+ rule \/\/\w+:\w+$/);
  });

  it('gives a cquery label with its configuration, (null) for a source file', () => {
    const lines = out(row('cquery', '//...'));
    for (const l of lines) assert.match(l, /^\/\/\w+:\w+ \([0-9a-f]{7}\)$/, l);
    // (A target in two configurations, as the tool of a genrule is: the target one and the exec one.)
    assert.ok(lines.filter((l) => l.startsWith('//util:strutil ')).length >= 2);
    assert.deepStrictEqual(out(row('cquery', '//lib:greet.cc + //lib:greet.h')), ['//lib:greet.cc (null)', '//lib:greet.h (null)']);
    assert.ok(out(row('cquery', 'deps(//tools:version, 1)')).some((l) => /^\/\/tools:fmt \([0-9a-f]{7}\)$/.test(l)));
    assert.ok(out(row('cquery', 'deps(//tools:version, 1)')).some((l) => / \(null\)$/.test(l)));
  });

  it('gives the other query outputs in their shapes', () => {
    const graph = out(row('query', 'deps(//app:main, 2)', '--noimplicit_deps', '--output=graph', '--nograph:factored'));
    assert.deepStrictEqual([graph[0], graph.at(-1)], ['digraph mygraph {', '}']);
    assert.ok(graph.includes('  "//app:main" -> "//lib:greet"'));
    assert.ok(out(row('query', '//lib:greet', '--output=build'))[0].startsWith('# <workspace>/lib/BUILD:'));
    assert.strictEqual(row('query', '//nosuch:target').status, 7);
    assert.match(row('query', '//nosuch:target').error!, /^no such package 'nosuch'/);
  });

  it('gives an aquery as the text blocks of its actions', () => {
    const lines = out(row('aquery', 'mnemonic("CppCompile", //...)', '--include_artifacts=false'));
    const actions = lines.filter((l) => l.startsWith('action '));
    assert.ok(actions.length >= 6);
    const targets = lines.filter((l) => /^ {2}Target: /.test(l));
    assert.strictEqual(targets.length, actions.length);
    assert.ok(lines.filter((l) => /^ {2}Mnemonic: /.test(l)).every((l) => l === '  Mnemonic: CppCompile'));
    assert.ok(targets.includes('  Target: //app:main'));
    assert.ok(lines.some((l) => /^ {2}Configuration: k8-fastbuild$/.test(l)));
    // (The summary: the actions counted by mnemonic.)
    assert.ok(out(row('aquery', 'mnemonic("CppCompile", //...)', '--include_artifacts=false', '--output=summary')).some((l) => /CppCompile/.test(l)));
    // (With its artifacts, the inputs and outputs of an action are listed.)
    assert.ok(out(row('aquery', 'mnemonic("CppCompile", //util:strutil)')).some((l) => /^ {2}Inputs: \[.*util\/strutil\.cc/.test(l)));
  });
});
