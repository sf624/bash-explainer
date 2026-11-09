// The examples of `bazel aquery` (src/examples/bazelaquery.ts) against what bazel 9.3.2 printed over the made-up workspace
// (test/fixtures/oracles/bazel.json, `examples`, written by scripts/record-bazel.ts): every aquery row, line by line, in
// bazel's order, or listed with the reason it is not computed, and then it must give no output: never a guess. The actions
// it prints are the record's (src/examples/bazelactions.ts). Then the runner the spec of `bazel aquery` chooses, and the
// pipelines it starts.
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import type { Example } from '../src/analyzer';
import { interpret } from '../src/argv/interpret';
import { bazel } from '../src/dict/bazel';
import { BAZEL_CC_ACTIONS } from '../src/examples/bazelactions';
import { runAquery, type AqueryRun } from '../src/examples/bazelaquery';
import { configuredTargets } from '../src/examples/bazelquery';
import { BAZEL_CC } from '../src/examples/bazelworkspace';
import { guarded } from '../src/examples/regexguard';
import { sourceRun } from '../src/examples/runners';
import { explain } from './support/explain';

interface Row { command: string; options?: string[]; expression: string; status: number; output?: string[] }
const record = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'oracles', 'bazel.json'), 'utf8')) as { examples: { rows: Row[] } };
const rows = record.examples.rows.filter((r) => r.command === 'aquery');
const key = (r: Row) => `${(r.options ?? []).join(' ')} ${r.expression}`.trim();

/** What the runner gives for an expression ('refused' where the guard stops it). */
const run = (expression: string, more: Partial<AqueryRun> = {}) =>
  guarded<string[] | undefined | 'refused'>(() => runAquery(BAZEL_CC, BAZEL_CC_ACTIONS, { expression, output: 'text', artifacts: true, ...more }), () => 'refused');
/** The lines it gives without the inputs and outputs, which must be computed. */
const lines = (expression: string): string[] => {
  const got = run(expression, { artifacts: false });
  assert.ok(Array.isArray(got), expression);
  return got;
};

/** What it gives for a row, its options read: `--output` and `--include_artifacts=false`, which must be all it has. */
function evaluate(row: Row): string[] | undefined | 'refused' {
  const opts = row.options ?? [];
  assert.ok(opts.every((o) => o === '--output=summary' || o === '--include_artifacts=false'), key(row));
  return run(row.expression, { output: opts.includes('--output=summary') ? 'summary' : 'text', artifacts: !opts.includes('--include_artifacts=false') });
}

/** The aquery rows not computed, and why. */
const NOT_COMPUTED: Record<string, string> = {
  // (The record runs its rows in one server, and this one comes after `cquery //...`: a fresh server prints only the action
  // of `k8-fastbuild`, as bazel 9.3.2 did when checked.)
  'mnemonic("CppCompile", //util:strutil)': 'the configurations of `//util:strutil` are those earlier commands analysed: after `cquery //...`, the one of the tool `//tools:fmt` too',
  '--include_artifacts=false --output=summary mnemonic("CppCompile", //...)': 'two configurations of as many actions, which a summary prints in an order of its own',
  '--include_artifacts=false //tools:version': 'every mnemonic of a target: only those of CppCompile, CppLink and Genrule are recorded',
  '--include_artifacts=false inputs(".*text\\\\.cc", //util:text)': 'no mnemonic filter, and the configurations of `//util:text` are those earlier commands analysed',
  '--include_artifacts=false --output=summary //...': 'every mnemonic: only CppCompile, CppLink and Genrule are recorded',
  '--include_artifacts=false --output=summary mnemonic("CppCompile", //util:strutil) + //app:main': 'a filter inside an operator, which keeps every action (the summary counts all of them)',
};

describe('aquery over the made-up workspace, as bazel printed it', () => {
  for (const row of rows) {
    it(key(row), () => {
      const got = evaluate(row);
      const why = NOT_COMPUTED[key(row)];
      if (why) assert.strictEqual(got, undefined, why);
      else {
        assert.ok(Array.isArray(got), `not computed: ${key(row)}`);
        // (Each text block ends with an empty line, the last too, which the record leaves out; a summary ends with its last count.)
        const summary = row.options?.includes('--output=summary');
        if (got.length && !summary) assert.strictEqual(got.at(-1), '');
        assert.deepStrictEqual(summary ? got : got.slice(0, -1), row.output);
      }
    });
  }
  it('lists only rows there are', () => {
    for (const k of Object.keys(NOT_COMPUTED)) assert.ok(rows.some((r) => key(r) === k), k);
  });
  it('holds the actions of each mnemonic over //..., the mnemonics of its summary, and each configuration cquery has', () => {
    const recorded = [...new Set(BAZEL_CC_ACTIONS.actions.map((a) => a.mnemonic))];
    for (const m of recorded) assert.ok(rows.some((r) => !r.options && r.expression === `mnemonic("${m}", //...)`), m);
    const summary = rows.find((r) => r.options?.includes('--output=summary') && r.expression === '//...')!.output!;
    const listed = summary.slice(summary.indexOf('Mnemonics:') + 1, summary.indexOf('Configurations:') - 1).map((l) => l.trim().split(':')[0]);
    assert.deepStrictEqual([...listed].sort(), BAZEL_CC_ACTIONS.mnemonics);
    assert.deepStrictEqual(Object.keys(BAZEL_CC_ACTIONS.configurations).sort(), [BAZEL_CC.configs.exec, BAZEL_CC.configs.target, BAZEL_CC.configs.test].sort());
    // (The configured targets of `//...` are those its actions are of.)
    const targets = configuredTargets(BAZEL_CC, '//...')!.map((t) => `${t.label} ${t.config}`);
    assert.ok(BAZEL_CC_ACTIONS.actions.every((a) => targets.includes(`${a.label} ${a.config}`)));
  });
});

describe('what aquery leaves not computed', () => {
  it('a selection with no mnemonic filter, or whose mnemonics are not all recorded', () => {
    for (const e of ['//app:main', 'inputs(".*", //...)', 'outputs(".*", //app:main)', 'mnemonic("Cpp.*", //...)', 'mnemonic(".*", //app:main)', 'mnemonic("CppCompile|CppArchive", //lib:greet)']) assert.strictEqual(run(e), undefined, e);
    // (No mnemonic matches: nothing is printed.)
    assert.deepStrictEqual(run('mnemonic("cppcompile", //...)'), []);
    assert.deepStrictEqual(run('mnemonic("CppCompile", //app:main.cc)'), []);
  });
  it('a filter under an operator or another function, and the functions of the configured graph', () => {
    for (const e of ['mnemonic("CppCompile", //app:main) + //lib:greet', 'mnemonic("CppCompile", //app:main + //lib:greet)', 'mnemonic("CppCompile", deps(//app:main))', 'mnemonic("CppCompile", kind(cc_binary, //...))', 'let x = //app:main in mnemonic("CppCompile", $x)', 'mnemonic("CppCompile", set(//app:main))']) assert.strictEqual(run(e), undefined, e);
  });
  it('a pattern whose configurations depend on what ran before, or that cquery does not configure', () => {
    for (const e of ['mnemonic("CppCompile", //util:strutil)', 'mnemonic("CppCompile", //util:all)', 'mnemonic("CppCompile", //util/...)', 'mnemonic("CppCompile", @abseil-cpp//absl/strings)', 'mnemonic("CppCompile", //app:main.stripped)', 'mnemonic("CppCompile", //nosuch:all)', 'mnemonic("CppCompile", app:main)']) assert.strictEqual(run(e), undefined, e);
    // (`//tools:fmt` is built for the genrule's tool whenever `//tools:all` is analysed: both configurations, whatever ran before.)
    assert.deepStrictEqual(lines('mnemonic("CppLink", //tools:all)').filter((l) => l.startsWith('  Configuration: ')), ['  Configuration: k8-opt-exec', '  Configuration: k8-fastbuild']);
    assert.deepStrictEqual(lines('mnemonic("CppLink", //lib:all)').filter((l) => l.startsWith('action ')), ["action 'Linking lib/libgreet.so'"]);
  });
  it('a regex JavaScript has none for, or of Java\'s own syntax; a mistake bazel stops at', () => {
    for (const e of ['mnemonic("[[:alpha:]]+", //...)', 'mnemonic("Cpp\\p{L}", //...)', 'inputs("x{,2}", mnemonic("CppCompile", //...))', 'mnemonic("CppCompile")', 'mnemonic(CppCompile, //...']) assert.strictEqual(run(e), undefined, e);
    // (A whole match: `Cpp(Compile|Link)` and `CppCompile|Genrule` let both through, `Compile` none.)
    assert.deepStrictEqual(run('mnemonic("Compile", //...)'), []);
    assert.strictEqual(lines('mnemonic("CppCompile|Genrule", //tools:all)').filter((l) => l.startsWith('  Mnemonic: ')).join(), '  Mnemonic: CppCompile,  Mnemonic: CppCompile,  Mnemonic: CppCompile,  Mnemonic: Genrule');
  });
  it('a summary where two of a section are as many', () => {
    assert.strictEqual(run('mnemonic("CppCompile", //...)', { output: 'summary' }), undefined);
    assert.strictEqual(run('mnemonic("CppCompile|Genrule", //tools:all)', { output: 'summary' }), undefined);
    assert.deepStrictEqual(run('mnemonic("CppCompile", //app:all)', { output: 'summary' }), ['2 total actions.', '', 'Mnemonics:', '  CppCompile: 2', '', 'Configurations:', '  k8-fastbuild: 2', '', 'Execution Platforms:', '  @@platforms//host:host: 2']);
  });
  it('stops at its steps, as the guard of the examples does', () => {
    const deep = `${'inputs(".*", '.repeat(1000)}mnemonic("CppCompile", //...)${')'.repeat(1000)}`;
    assert.strictEqual(run(deep), 'refused');
  });
});

describe('the runner of the spec of `bazel aquery`', () => {
  const ranOf = (line: string, lang: 'en' | 'ja' = 'en') => {
    const w = line.split(' ');
    return sourceRun(bazel.bazel, interpret(bazel.bazel, w.map((text) => ({ text, value: text })), { name: 'bazel' }), w, lang);
  };
  const runOf = (line: string, lang: 'en' | 'ja' = 'en') => {
    const r = ranOf(line, lang);
    return r && 'lines' in r ? r : undefined;
  };
  it('reads `--output`, `--include_artifacts` and the options that print nothing else; no other', () => {
    assert.strictEqual(runOf('aquery --noinclude_artifacts --noshow_progress mnemonic("CppLink",//app:main)')?.lines.length, 81 - 2 + 1);
    assert.strictEqual(runOf('aquery --include_artifacts=false --include_artifacts mnemonic("CppLink",//app:main)')?.lines.length, 81 + 1);
    assert.deepStrictEqual(runOf('aquery --output=summary mnemonic("Genrule",//...)')?.lines[0], '1 total action.');
    assert.deepStrictEqual(runOf('aquery --output text mnemonic("Genrule",//...)')?.lines[0], "action 'Executing genrule //tools:version'");
    for (const line of ['aquery --output=jsonproto mnemonic("Genrule",//...)', 'aquery --noinclude_commandline mnemonic("Genrule",//...)', 'aquery -c opt mnemonic("Genrule",//...)', 'aquery //...', 'aquery']) assert.strictEqual(runOf(line), undefined, line);
    // (The words of one expression, joined with spaces.)
    assert.strictEqual(runOf('aquery mnemonic("Genrule", //...)')?.lines[1], '  Mnemonic: Genrule');
  });
  it('says what of the output is an example', () => {
    assert.match(runOf('aquery mnemonic("Genrule",//...)')!.note, /made-up C\+\+ workspace.*the actions of the workspace.*command lines.*action keys are left out/);
    assert.match(runOf('aquery --output=summary mnemonic("Genrule",//...)')!.note, /configurations' names depend on the machine$/);
    assert.match(runOf('aquery mnemonic("Genrule",//...)', 'ja')!.note, /^架空の C\+\+ のワークスペース.*アクションになる。コマンド行/);
    assert.match(runOf('aquery --output=summary mnemonic("Genrule",//...)', 'ja')!.note, /構成の名前は環境による$/);
  });
  it('a run the guard stops says so', () => {
    const deep = `${'inputs(".*",'.repeat(1000)}mnemonic("CppCompile",//...)${')'.repeat(1000)}`;
    assert.deepStrictEqual(ranOf(`aquery ${deep}`), { refused: 'steps-not-computed' });
  });
});

describe('a pipeline that starts with `bazel aquery`', () => {
  const whole = (line: string, lang: 'en' | 'ja' = 'en'): Example | undefined => explain(line, 0, lang).examples.find((e) => e.kind === 'pipeline');
  const LINE = 'bazel aquery \'mnemonic("CppCompile", //...)\' | grep Target';
  const blocks = rows.find((r) => !r.options && r.expression === 'mnemonic("CppCompile", //...)')!.output!;
  const targets = blocks.filter((l) => l.startsWith('  Target: '));
  it('shows the action blocks of the made-up workspace as the input of grep, with a note that they are an example (en)', () => {
    const ex = whole(LINE)!;
    assert.ok(ex, 'has an example of the whole pipeline');
    assert.deepStrictEqual(ex.sections.map((s) => s.label), ['Output of `bazel aquery \'mnemonic("CppCompile", //…` (sample)', 'Output (after `grep Target`)']);
    assert.deepStrictEqual(ex.sections[0].lines.slice(0, 6), blocks.slice(0, 6));
    assert.deepStrictEqual(ex.sections[1].lines, targets);
    assert.strictEqual(targets.length, 12);
    assert.match(ex.note!, /^An example over a made-up C\+\+ workspace.*the actions of the workspace it runs in. The command lines/);
  });
  it('the same in Japanese', () => {
    const ex = whole(LINE, 'ja')!;
    assert.deepStrictEqual(ex.sections[1].lines, targets);
    assert.match(ex.sections[0].label, /の出力（例）$/);
    assert.match(ex.note!, /^架空の C\+\+ のワークスペース.*コマンド行、ツールチェーンのパス/);
  });
  it('counts and picks the lines with grep -c and awk', () => {
    assert.deepStrictEqual(whole('bazel aquery \'mnemonic("CppCompile", //...)\' | grep -c Mnemonic')!.sections[1].lines, ['12']);
    const awk = whole('bazel aquery --noinclude_artifacts \'mnemonic("Cpp(Compile|Link)", //tools:all)\' | awk \'/Mnemonic/\'')!;
    assert.deepStrictEqual(awk.sections[1].lines, ['  Mnemonic: CppCompile', '  Mnemonic: CppCompile', '  Mnemonic: CppLink', '  Mnemonic: CppCompile', '  Mnemonic: CppLink']);
    // (An empty line ends each block, which a count of lines counts.)
    assert.deepStrictEqual(whole('bazel aquery --noinclude_artifacts \'mnemonic("Genrule", //...)\' | wc -l')!.sections[1].lines, ['13']);
  });
  it('none for an aquery it does not follow', () => {
    for (const line of ['bazel aquery //app:main | grep Target', 'bazel aquery \'mnemonic("CppCompile", //util:strutil)\' | grep Target', 'bazel aquery "$1" | grep Target']) assert.strictEqual(whole(line), undefined, line);
  });
});
