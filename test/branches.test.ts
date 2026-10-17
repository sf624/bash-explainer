import * as assert from 'assert';
import * as path from 'path';
import { Analyzer } from '../src/analyzer';
import { customCommandDoc } from '../src/dict/custom';
import { githubContext } from '../src/dict/ciVariables';
import { expansionOps, redirects } from '../src/dict/syntax';
import { documentIssues, ShellDocument } from '../src/document';
import { explainGetoptLong, explainGetoptShort } from '../src/embedded/getopt';
import { explainGitDate, explainGitFormat } from '../src/embedded/gitformat';
import { explainMode } from '../src/embedded/mode';
import { explainSortKey, explainTrSet, trSummary } from '../src/embedded/textutils';
import { GetoptUnsupported, runGetopt, sampleGetoptArgs } from '../src/examples/getopt';
import { rerun } from '../src/examples/rerun';
import { simulateRedirects } from '../src/idioms';
import { BashParser, createBashParser } from '../src/parser';
import { panelUpdate } from '../src/ui/panelView';
import { quickReference } from '../src/ui/reference';
import { examplesMarkdown, lineSegments, placeExamples, toPlainMarkdown } from '../src/ui/render';

// Branches that the tests of each feature do not take: the other language, the rarer inputs, and
// the ways a helper gives up. Every branch of src/ is to be taken in some test, removed, or marked
// with the reason it cannot be (see scripts/coverage-check.mjs).

const root = path.join(__dirname, '..');
let parser: BashParser;
before(async () => {
  parser = await createBashParser({
    runtimeDir: path.join(root, 'node_modules/web-tree-sitter'),
    bashWasm: path.join(root, 'node_modules/tree-sitter-bash/tree-sitter-bash.wasm'),
  });
});

const explain = (src: string, line = 0, lang: 'ja' | 'en' = 'en') => {
  const tree = parser.parse(src);
  try {
    return new Analyzer(lang).explainLine(tree, line);
  } finally {
    tree.delete();
  }
};
const flat = (e: ReturnType<typeof explain>): string => {
  const all = (ts: typeof e.items): typeof e.items => ts.flatMap((t) => [t, ...all(t.children)]);
  return [...e.notes, ...all(e.items).map((t) => `${t.label}: ${t.explanation}`)].join('\n');
};

describe('branches no other test takes', () => {
  it('quick reference and panel: both languages', () => {
    assert.ok(quickReference('ja').some((r) => /[ぁ-ん]/.test(r.meaning)));
    const e = explain('yq .a f.yml');
    const msg = panelUpdate({ lang: 'en', explanation: { ...e, notes: ['yq: mikefarah/yq v4'] }, file: 'a.sh', line: 0, lineText: 'yq .a f.yml', choice: {}, detected: 'zsh', placement: 'last' });
    assert.strictEqual(msg.dialect.shells[0][1], 'Auto (zsh)');
    assert.ok(msg.dialect.yqs!.every(([, name]) => !/[ぁ-ん]/.test(name)));
  });

  it('getopt: option strings it does not read', () => {
    assert.strictEqual(explainGetoptShort('', 'en'), undefined);
    assert.strictEqual(explainGetoptLong('help,,x', 'en'), undefined);
    assert.strictEqual(runGetopt({ short: ':a', long: [] }, ['-a', 'x']), " -a -- 'x'");
    assert.throws(() => runGetopt({ short: 'a', long: [] }, ['-z']), GetoptUnsupported);
    assert.throws(() => runGetopt({ short: '', long: ['verbose', 'version'] }, ['--ver']), GetoptUnsupported);
    assert.ok(sampleGetoptArgs({ short: 'd:', long: ['dir:'] }).includes('build'));
    assert.ok(sampleGetoptArgs({ short: 'u:', long: ['user:'] }).includes('alice'));
  });

  it('documents: a host file without shell, an issue in info, an issue over several lines', () => {
    const doc = (text: string): ShellDocument => ({ lines: text.split('\n'), tree: parser.parse(text) });
    const empty = { lines: ['FROM alpine'], tree: parser.parse(''), extracted: { text: '', regions: [] } } as unknown as ShellDocument;
    assert.deepStrictEqual(documentIssues(empty, 'en', {}), []);
    const issues = documentIssues(doc('echo -e "a\\tb"\nf() {\n  local x\n}\narr=(a\n b)'), 'en', { forced: 'sh' });
    assert.ok(issues.some((i) => i.severity === 'info'), JSON.stringify(issues));
    assert.ok(issues.some((i) => i.endLine === i.startLine && i.endCol === 'arr=(a'.length), JSON.stringify(issues));
  });

  it('parser: extended globs with escapes, quotes, a newline or no closing parenthesis', () => {
    for (const [src, label] of [
      ['ls @(a\\)b|c)', '@(a\\)b|c)'],
      ["ls @(a')'b|c)", "@(a')'b|c)"],
    ]) assert.ok(explain(`shopt -s extglob\n${src}`, 1).items[0].children.some((c) => c.label === label), src);
    for (const src of ["ls @(a'b", 'ls @(a\nb)', 'ls @(ab']) assert.ok(explain(src).items.length > 0, src);
  });

  it('modes: special bits without the execute bit, and a single digit', () => {
    const tokens = (m: string) => explainMode(m, 'en')!.note;
    assert.match(tokens('4644')!, /rwSr--r--/);
    assert.match(tokens('2755')!, /rwxr-sr-x/);
    assert.match(tokens('2745')!, /rwxr-Sr-x/);
    assert.match(tokens('1644')!, /rw-r--r-T/);
    assert.ok(explainMode('7', 'en'));
  });

  it('custom commands: settings without options or arguments, and options without a description', () => {
    assert.deepStrictEqual(customCommandDoc({ summary: 'x' }), { summary: { ja: 'x', en: 'x' }, options: {} });
    const doc = customCommandDoc({ summary: 'x', options: { '-a': 'all', '-b': { takesValue: true }, '-c': 7, '-d': { description: 'd' } }, arguments: 'nope' })!;
    assert.deepStrictEqual(Object.keys(doc.options!), ['-a', '-d']);
    assert.strictEqual(doc.options!['-d'].arg, undefined);
    assert.strictEqual(doc.positional, undefined);
  });

  it('redirections: copies of high descriptors, closing, and here-documents', () => {
    const r = simulateRedirects([{ op: '>&', fd: '3', dest: '7' }, { op: '>&', fd: '1', dest: '-' }, { op: '<<', fd: '', dest: 'EOF' }, { op: '>', fd: '1', dest: 'f' }, { op: '>&', fd: '2', dest: '1' }], 'en')!;
    assert.match(r, /fd 3 → the original fd 7/);
    assert.match(r, /stdin → the here-document/);
    assert.match(simulateRedirects([{ op: '>&', fd: '2', dest: '1' }, { op: '>', fd: '1', dest: 'f' }], 'en')!, /Note: `2>&1` comes before/);
  });

  it('render: an example with no anchor, a token over several lines, empty sections, notes and backticks', () => {
    const placed = placeExamples({ line: 0, summary: '', items: explain('echo a').items, context: [], notes: [], examples: [{ title: 'E', sections: [] }] });
    assert.strictEqual(placed.examples.length, 1);
    const span = (a: number, b: number, c: number, d: number) => ({ start: { line: a, character: b }, end: { line: c, character: d } });
    const outer = { kind: 'keyword' as const, label: 'if', explanation: '', span: span(0, 0, 2, 2), children: [] };
    assert.deepStrictEqual(lineSegments('  echo a', 1, [outer]).map((x) => x.kind), ['keyword']);
    const away = placeExamples({ line: 0, summary: '', items: [outer], context: [], notes: [], examples: [{ title: 'E', sections: [], anchor: span(5, 0, 5, 1) }] });
    assert.strictEqual(away.examples.length, 1);
    const inside = placeExamples({ line: 0, summary: '', items: [outer], context: [], notes: [], examples: [{ title: 'E', sections: [], anchor: span(0, 0, 0, 1) }] });
    assert.strictEqual(inside.items[0].examples!.length, 1);
    assert.deepStrictEqual(examplesMarkdown([{ title: 'T', sections: [{ label: 'L', lines: [] }] }]).slice(-3), ['```text', '', '```']);
    const md = toPlainMarkdown({ ...explain('echo `date`'), notes: ['a note'] }, 'echo `date`', 'a.sh:1');
    assert.match(md, /> a note/);
    assert.match(md, /`` echo `date` ``/);
  });

  it('text utilities: key ranges, repeats, unknown escapes, an empty set, tr without a second set', () => {
    assert.match(explainSortKey('2,3', 'en')!.note!, /fields 2 to 3/);
    assert.match(explainTrSet('[x*3]', 'to', 'en')!.note!, /"x" 3 times/);
    assert.match(explainTrSet('\\q ', 'from', 'en')!.note!, /"q", space/);
    assert.strictEqual(explainTrSet('', 'from', 'en'), undefined);
    assert.strictEqual(trSummary('a-z', undefined, 'en'), undefined);
  });

  it('git formats: colours, alignment, unknown placeholders and date styles', () => {
    const f = (src: string) => explainGitFormat(src, 'en')!.tokens.map((t) => t.explanation).join('\n');
    assert.match(f('%C(auto)%h'), /default colours/);
    assert.match(f('%>(10)%s'), /right-aligned/);
    assert.match(f('%><(10,trunc)%s'), /centred.*truncated/);
    assert.match(f('%<(10)%s'), /left-aligned/);
    assert.ok(!/^`%z`/m.test(f('%z%h')));
    assert.strictEqual(explainGitDate('nonsense', 'en'), undefined);
  });

  it('GitHub expressions: secrets, vars, env, step results, job outputs and results', () => {
    for (const [e, re] of [
      ['secrets.TOKEN', /secret `TOKEN`/], ['vars.REGION', /configuration variable/], ['env.CI', /environment variable `CI`/],
      ['steps.build.outcome', /result of the step/], ['needs.build.outputs.v', /output `v` of the job/], ['needs.build.result', /result of the job/],
    ] as const) assert.match(githubContext(e)!.en, re, e);
  });

  it('reruns: a group that took no part in Japanese, and examples that cannot run', () => {
    const regex = { source: '(a)?b', flags: '' };
    assert.match(rerun({ kind: 'regex', regex, mode: 'lines' }, ['b'], 'ja').sections[1].lines[0], /（なし）/);
    const cannot = (spec: Parameters<typeof rerun>[0]) => rerun(spec, ['x'], 'en').sections[0].lines[0];
    assert.strictEqual(cannot({ kind: 'filter', cmd: 'nope', words: [] }), '(cannot run on this input)');
    assert.strictEqual(rerun({ kind: 'jq', filter: 'input_filename', raw: false, vars: {} }, ['1'], 'en').sections[0].lines[0], '(cannot run on this input)');
    assert.strictEqual(cannot({ kind: 'pipeline', stages: [] }), '(cannot run on this input)');
    assert.deepStrictEqual(rerun({ kind: 'date', format: '%Q' }, ['2024-03-05 07:08:09'], 'en').sections[0].lines, ['']);
  });

  it('pitfalls: rm on a special parameter, a for over a nameless command, and local', () => {
    assert.ok(!/deleting from the root/.test(flat(explain('rm -rf "$$/x"'))));
    assert.match(flat(explain('rm -rf "$DIR/x"')), /\$\{DIR:\?\}/);
    assert.ok(!/is split on spaces/.test(flat(explain('for f in $(2>/dev/null); do :; done'))));
    assert.match(flat(explain('local x=$(date)')), /`local x=\$\(…\)`/);
  });

  it('dictionary: >& to a file, :? and ? without a message, deletions by pattern', () => {
    assert.match(redirects['>&']('', 'out.log').en, /both stdout and stderr/);
    assert.match(expansionOps[':?']('x', '').en, /parameter null or not set/);
    assert.match(expansionOps['?']('x', '').ja, /parameter not set/);
    assert.match(expansionOps['/']('x', 'a').en, /Delete the first match of `a`/);
    assert.match(expansionOps['/#']('x', 'a/').en, /Delete `a` at the start/);
    assert.match(expansionOps['/%']('x', 'a').en, /Delete `a` at the end/);
  });
});
