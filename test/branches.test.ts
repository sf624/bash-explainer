import * as assert from 'assert';
import * as path from 'path';
import { Analyzer, ExplainOptions } from '../src/analyzer';
import type { Shell } from '../src/dialect';
import { explainHostedLine, Extracted, extractShell, HostKind, hostIssues, hostKind, remapExplanation, substitutionNotes } from '../src/hosts';
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
import { createTreeSitterParser } from '../src/syntax/adapters/tree-sitter';
import type { BashParser } from '../src/syntax/tree';
import { dialectIssues, dialectNotes, featuresOnLine } from '../src/dialect';
import { explainRegex } from '../src/embedded/regex';
import { jqExample, runJq } from '../src/examples/jq';
import { describeGlob, exampleFor, globParts, parseExpansion } from '../src/expansion';
import { explainJq } from '../src/embedded/jq';
import { explainYq3Path, judgeYq as judge, yqNotes, yqSameAsJq as sameAsJq } from '../src/embedded/yq';
import { explainSed } from '../src/embedded/sed';
import { bashPrintf, braceExpand, extglobs, globExamples, globMatches, ShellWordsUnsupported } from '../src/examples/shellwords';
import { literalRegex, regexExamples, toJsRegex } from '../src/examples/regex';
import { explainAwk } from '../src/embedded/awk';
import { explainDate, explainPrintf } from '../src/embedded/format';
import { explainPerl, perlLoopNote } from '../src/embedded/perl';
import { describeFind, parseFind } from '../src/embedded/find';
import { fixFor } from '../src/fixes';
import { runRead, runXargs, showCommand, testCases } from '../src/examples/runtime';
import { Unsupported } from '../src/examples/textfilters';
import { yamlLines, yqYamlOutput } from '../src/examples/yaml';
import type { Json } from '../src/examples/jq';
import { execFileSync } from 'child_process';
import { formatDate as gitDate, GitFormatUnsupported, relativeDate, runGitLog, sampleCommits, strftime } from '../src/examples/gitlog';
import { panelUpdate } from '../src/ui/panelView';
import { quickReference } from '../src/ui/reference';
import { examplesMarkdown, lineSegments, placeExamples, toPlainMarkdown } from '../src/ui/render';

// Branches that the tests of each feature do not take: the other language, the rarer inputs, and
// the ways a helper gives up. Every branch of src/ is to be taken in some test, removed, or marked
// with the reason it cannot be (see scripts/coverage-check.mjs).

const root = path.join(__dirname, '..');
let parser: BashParser;
before(async () => {
  parser = await createTreeSitterParser({
    runtimeDir: path.join(root, 'node_modules/web-tree-sitter'),
    bashWasm: path.join(root, 'grammar/tree-sitter-bash.wasm'),
  });
});

const explain = (src: string, line = 0, lang: 'ja' | 'en' = 'en') => {
  const tree = parser.parse(src);
  return new Analyzer(lang).explainLine(tree, line);
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

  it('quick fixes: [[ ]] that [ ] cannot say', () => {
    const fix = (src: string) => {
      const tree = parser.parse(src);
      return dialectIssues(tree, 'sh', 'en').map(fixFor).find(Boolean)?.edits[0].text;
    };
    for (const src of ['[[ a b ]]', '[[ a == ]]', '[[ ! -f a* ]]', '[[ -f a* ]]', '[[ $a -eq 1* ]]', '[[ $a == "a"b ]]', '[[ $a == x$b ]]', '[[ -f "a"$b ]]', '[[ -n a\\ b ]]', '[[ $x = a"$y" ]]', '[[ $x = *"$y"*z ]]']) {
      assert.strictEqual(fix(src), undefined, src);
    }
    assert.strictEqual(fix('[[ ! -f a ]]'), '[ ! -f a ]');
  });

  it('YAML: as PyYAML writes it, and as mikefarah/yq quotes', function () {
    const values: Json[] = [null, true, 1.5, ' a', '- a', '#x', 'true', '123', 'yes', "it's: x", [], {}, [1, [2]], { a: [] }, { a: { b: 1 } }];
    let python: string[];
    try {
      python = JSON.parse(execFileSync('python3', ['-c', 'import json,sys,yaml\nprint(json.dumps([yaml.safe_dump(v, default_flow_style=False, allow_unicode=True, sort_keys=False) for v in json.load(sys.stdin)]))'], { input: JSON.stringify(values) }).toString());
    } catch {
      this.skip();
    }
    values.forEach((v, i) => assert.strictEqual(yqYamlOutput([v], 'kislyuk').join('\n') + '\n', python[i], JSON.stringify(v)));
    assert.deepStrictEqual(yqYamlOutput([1, 'a'], 'kislyuk'), ['1', '---', 'a', '...']);
    assert.deepStrictEqual(['true', '123', "it's: x"].map((v) => yamlLines(v, 'mikefarah')[0]), ['"true"', '"123"', '"it\'s: x"']);
    assert.deepStrictEqual(yamlLines('a\n', 'mikefarah'), ['|', '  a']);
    assert.throws(() => yamlLines(1e-5, 'mikefarah'), /number/);
  });

  it('find: -a, times in minutes, owners, -printf, -delete, unknown tests, actions alone', () => {
    const f = (src: string) => flat(explain(src));
    assert.match(f("find . -iname '*.c' -a -ipath '*src*' -mmin 5 -amin +3 -user bob -printf '%p' -delete"), /any case.*path matches.*exactly 5 minutes.*more than 3 minutes.*owned by bob.*format.*delete it/s);
    assert.match(f('find . -xdev -foo bar -print'), /-xdev.*-foo bar/s);
    assert.match(f('find . -print -quit'), /print it, then quit/);
    assert.strictEqual(parseFind(['-name', 'x', ')'], () => 1), undefined);
    assert.match(describeFind(parseFind(['-foo', 'bar'], () => 1)!, 'en'), /-foo bar/);
    assert.strictEqual(describeFind(parseFind(['-xdev', '-type', 'x'], (p) => (p === '-type' ? 1 : 0))!, 'en'), 'Print what matches: -xdev and x (no action is given, so `-print` is implied)');
  });

  it('regex: BRE alternation and anchors, empty intervals, PCRE groups, classes, escapes', () => {
    type T = ReturnType<typeof explainRegex>;
    const all = (ts: T): T => ts.flatMap((t) => [t, ...all(t.children)]);
    const r = (src: string, flavor: 'bre' | 'ere' | 'pcre') => all(explainRegex(src, flavor, 'en')).map((t) => t.explanation).join('\n');
    assert.match(r('a$\\|b', 'bre'), /end of the line/);
    assert.match(r('\\(a$\\)', 'bre'), /end of the line/);
    assert.ok(!/repeated/.test(r('a\\{,\\}', 'bre')));
    assert.match(r('(+a)', 'ere'), /the previous item/);
    assert.match(r('(?:a)(?!b)(?<!c)', 'pcre'), /non-capturing.*not followed.*not preceded/s);
    assert.match(r('[[:foo:]\\q]', 'pcre'), /\[:foo:\]/);
    assert.match(r('a\\', 'ere'), /Trailing/);
    assert.match(r('\\A\\d', 'pcre'), /\\A/);
    assert.match(r('\\,', 'ere'), /Literal ","/);
  });

  it('xargs, tests and read: the cases the simulation leaves out', () => {
    assert.throws(() => runXargs([], "a 'b"), Unsupported);
    assert.throws(() => runXargs(['-'], ''), Unsupported);
    assert.throws(() => runXargs(['echo', undefined], 'a'), Unsupported);
    assert.throws(() => runXargs(['-s', '10'], 'a'), Unsupported);
    assert.deepStrictEqual(runXargs(['-r', 'echo'], ''), []);
    assert.deepStrictEqual(runXargs(['echo'], ''), [['echo']]);
    assert.strictEqual(showCommand(['echo', '']), "echo ''");
    assert.strictEqual(testCases('[', '-f', undefined, { var: 'f' }), undefined);
    assert.strictEqual(testCases('[', '=', { lit: 'a' }, { lit: 'b' }), undefined);
    assert.strictEqual(testCases('[', '-eq', { var: 'n' }, { lit: 'x' }), undefined);
    assert.strictEqual(testCases('((', '%', { var: 'n' }, { lit: '2' }), undefined);
    assert.strictEqual(testCases('[', '-z', { var: 'a' }, undefined), undefined);
    assert.strictEqual(testCases('[[', '==', { var: 'f' }, { lit: '*' }), undefined);
    assert.strictEqual(testCases('[', '<', { var: 'f' }, { lit: 'b' }), undefined);
    const nocase = testCases('[[', '==', { var: 'f' }, { lit: '*.txt' }, false, true)!;
    assert.ok(nocase[0].result && /\.txt$/i.test(nocase[0].vars.f));
    assert.deepStrictEqual(runRead('a b\\', ['x', 'y'], { ifs: ' \t\n', raw: false }).vars, [['x', 'a'], ['y', 'b']]);
  });

  it('git log dates: strftime as date prints it, zones west of UTC and UTC itself, relative dates, unknown styles', function () {
    const tz = process.env.TZ;
    try {
      for (const zone of ['America/New_York', 'UTC', 'Asia/Tokyo']) {
        process.env.TZ = zone;
        for (const t of [1709593200, 1709553600, 1709510400]) {
          const fmt = '%I %l %-d %^a %z';
          let real: string;
          try {
            real = execFileSync('date', ['-d', `@${t}`, `+${fmt}`], { env: { ...process.env, TZ: zone } }).toString().trim();
          } catch {
            this.skip();
          }
          assert.strictEqual(strftime(fmt, new Date(t * 1000)), real, `${zone} ${t}`);
        }
      }
      process.env.TZ = 'UTC';
      assert.strictEqual(gitDate(1709593200, 'iso-strict', 0), '2024-03-04T23:00:00Z');
      process.env.TZ = 'America/New_York';
      assert.strictEqual(gitDate(1709593200, 'iso-strict', 0), '2024-03-04T18:00:00-05:00');
    } finally {
      if (tz === undefined) delete process.env.TZ;
      else process.env.TZ = tz;
    }
    const now = 1_000_000_000_000;
    const at = (secondsAgo: number) => relativeDate(now / 1000 - secondsAgo, now);
    assert.deepStrictEqual([at(-5), at(30), at(600), at(100 * 86400)], ['in the future', '30 seconds ago', '10 minutes ago', '3 months ago']);
    assert.throws(() => strftime('%Q', new Date(0)), GitFormatUnsupported);
    assert.throws(() => gitDate(0, 'nonsense', 0), GitFormatUnsupported);
    assert.throws(() => runGitLog([], 'nonsense'), GitFormatUnsupported);
    assert.throws(() => runGitLog(sampleCommits(now), 'format:%<(0,trunc)%an'), GitFormatUnsupported);
  });

  it('perl: quote-like operators cut short or with brackets, conditions, substitutions, fields from the end', () => {
    type T = ReturnType<typeof explainPerl>;
    const all = (ts: T): T => ts.flatMap((t) => [t, ...all(t.children)]);
    const p = (src: string) => all(explainPerl(src, 'en')).map((t) => t.explanation).join('\n');
    for (const src of ['s/a/b', 's{a}', 's{a} ', 'print "x"; s/a', 'BEGIN { $n = 0 ']) assert.ok(explainPerl(src, 'en').length > 0, src);
    assert.match(p('s{a{1}} {b}g'), /Substitute.*every match of `a\{1\}` with `b`/);
    assert.match(p('s{a}/b/'), /with `b`/);
    assert.match(p('s{a}{\\}}'), /with `\\\}`/);
    assert.match(p('s/a//'), /delete the first match of `a`/);
    assert.match(p('s/a/b/'), /the first match/);
    assert.match(p('BEGIN { $x = "\\}" } print'), /print/);
    assert.match(p('print if m{foo}'), /matches `foo`/);
    assert.match(p('m{foo}'), /matches `foo`/);
    assert.match(p('print if /foo/i'), /case-insensitive/);
    assert.match(p('$x + 1'), /evaluate `\$x \+ 1`/);
    assert.match(p('print $F[-1]'), /the 1th field from the end/);
    assert.match(perlLoopNote(new Set(['0']), 'en')!, /-0777/);
  });

  it('printf and date formats: every flag, bad escapes, a lone %', () => {
    const p = (src: string) => explainPrintf(src, 'en').map((t) => t.explanation).join('\n');
    assert.match(p('%*d %-s %+d % d %#x %\'d %.f %.3g'), /width taken from an argument.*left-aligned.*always show the sign.*a space before.*prefix.*thousands.*0 digits after.*3 significant/s);
    assert.match(p('a\\q b\\'), /Literal text "a\\q b\\"/);
    const d = (src: string) => explainDate(src, 'en').map((t) => t.explanation).join('\n');
    assert.match(d('+%_H %0d %^a %#Z %10Y'), /space-padded.*zero-padded.*uppercase.*opposite case.*width 10/s);
    assert.match(d('+50% %'), /Literal text "50% %"/);
  });

  it('awk: continued lines, comments, odd operators, a pattern of 0, unfinished functions, statements of every kind', () => {
    type T = ReturnType<typeof explainAwk>;
    const all = (ts: T): T => ts.flatMap((t) => [t, ...all(t.children)]);
    const a = (src: string) => all(explainAwk(src, 'en')).map((t) => t.explanation).join('\n');
    assert.deepStrictEqual(explainAwk('# only a comment', 'en'), []);
    assert.match(a('0'), /always false/);
    assert.match(a('{ x = 1 + \\\n 2 } # done'), /x/);
    assert.match(a('$0 ~ /a\\/b/ { print /c/ }'), /a\\\/b/);
    assert.ok(a('{ x = a @ b }').length > 0);
    assert.match(a('{ "date" | getline / 2 }'), /read the next line/);
    assert.match(a('function'), /Incomplete function definition/);
    assert.match(a('function f'), /Incomplete function definition/);
    assert.match(a('{ if (x)\n print; else\n print 2 }'), /print/);
    assert.ok(a('{ if x print }').length > 0);
    assert.match(a('{ nextfile; exit 1 }'), /skip to the next file[^]*with status 1/);
    assert.match(a('{ while (1) break }'), /leave the loop/);
    assert.match(a('{ $1 = "x" }'), /rebuilds `\$0`/);
    assert.match(a('{ foo(1) }'), /call the function `foo`/);
    assert.match(a('{ a b }'), /evaluate `a b`/);
    assert.match(a('{ print $(NF-1), $(i + 1), $(NF }'), /second-to-last[^]*computed number/);
    assert.match(a('{ a[i] = 1; print (a > b) > "f"; exit }'), /exit awk \(END still runs\)/);
  });

  it('regex examples: what JavaScript or the generator cannot do', () => {
    for (const [src, flavor] of [['[[:foo:]]', 'ere'], ['[[.a.]]', 'ere'], ['[abc', 'ere'], ['a\\', 'bre'], ['a\\`', 'ere']] as const) {
      assert.strictEqual(toJsRegex(src, flavor), undefined, src);
    }
    for (const src of ['[é]x', '([é])', '[é]+', '(?:[é])']) assert.strictEqual(regexExamples({ source: src, flags: '' }), undefined, src);
    assert.ok(regexExamples({ source: '(a)?\\1b', flags: '' }));
    assert.strictEqual(literalRegex('a.b', true).flags, 'i');
  });

  it('shell words: what the simulations give up on, and globs with odd parts', () => {
    assert.throws(() => braceExpand('{1..30}{1..30}'), ShellWordsUnsupported);
    assert.throws(() => braceExpand('{1..600}'), ShellWordsUnsupported);
    assert.throws(() => bashPrintf('%q', ['a\tb']), ShellWordsUnsupported);
    assert.throws(() => bashPrintf('%d', ['abc']), ShellWordsUnsupported);
    // Bash rejects these, or writes bytes that are not text.
    for (const f of ['\\x', '\\xg', '\\u', '\\U', '\\777', '\\xe9', '\\U00110000', '\\ud800']) assert.throws(() => bashPrintf(f, []), ShellWordsUnsupported, f);
    assert.throws(() => bashPrintf('%b', ['\\xe9']), ShellWordsUnsupported);
    assert.throws(() => bashPrintf('%s', Array(60).fill('x')), ShellWordsUnsupported);
    assert.strictEqual(globMatches('[z-a]', 'x', 'value'), false);
    assert.strictEqual(globExamples('[z-a]', 'value'), undefined);
    assert.strictEqual(globExamples('[é]', 'file'), undefined);
    assert.deepStrictEqual(extglobs('a\\*!(x)').map((e) => e.text), ['!(x)']);
    // Nothing is left for `!(*)`.
    assert.strictEqual(globExamples('!(*)x', 'file'), undefined);
    assert.ok(globExamples('@(*).log', 'file'));
    // bash may end `!(…)` anywhere when the rest varies in length, which the matcher cannot follow.
    assert.strictEqual(globExamples('!(app)*', 'file'), undefined);
  });

  it('sed scripts: every command, address and replacement escape', () => {
    type T = ReturnType<typeof explainSed>;
    const all = (ts: T): T => ts.flatMap((t) => [t, ...all(t.children)]);
    const e = (src: string) => all(explainSed(src, 'bre', 'en')).map((t) => t.explanation).join('\n');
    assert.match(e('a foo\np'), /append the line "foo"/);
    assert.match(e('s/a\n/b/'), /Unterminated/);
    assert.match(e('\\%x%Ip'), /matching the regex `x` \(case-insensitive\)/);
    assert.match(e('/x/Mp'), /matching the regex `x`/);
    assert.match(e('0,/x/d'), /the start through/);
    assert.match(e('1,3s/a/b/'), /For line 1 through line 3: Substitute/);
    assert.match(e('1,!p'), /line 1/);
    assert.match(e('Q'), /quit without printing/);
    assert.match(e('a\\\nfoo'), /append the line "foo"/);
    assert.match(e('i foo'), /insert the line "foo"/);
    assert.match(e('c foo'), /replace the line with "foo"/);
    assert.match(e('b'), /branch to the end of the script/);
    assert.match(e('t'), /if an `s` succeeded, branch to the end/);
    assert.match(e('T x'), /if no `s` succeeded, branch to "x"/);
    assert.match(e('T'), /if no `s` succeeded, branch to the end/);
    assert.match(e('r a.txt'), /contents of "a.txt"/);
    assert.match(e('R a.txt'), /one line of "a.txt"/);
    assert.match(e('w out'), /write the line to "out"/);
    assert.match(e('W out'), /write the first line/);
    assert.match(e('e date'), /run "date"/);
    assert.match(e('e'), /run the pattern space as a command/);
    assert.match(e('s//x/'), /Empty pattern/);
    assert.match(e('s/a/\\n/'), /a newline/);
    assert.match(e('s/\\(a\\)/\\\\\\0\\L\\1/'), /a literal backslash[^]*the whole match[^]*lowercase what follows/);
  });

  it('yq: options in every spelling, v3 commands, features with versions, v3 paths', () => {
    const v4 = (words: (string | undefined)[]) => judge(words).compat.mikefarah4.min;
    assert.strictEqual(judge([undefined, '.a']).expression, 1);
    assert.strictEqual(judge(['--', '.a', 'f']).expression, 1);
    assert.strictEqual(judge(['--']).expression, undefined);
    assert.strictEqual(v4(['-ojson', '.a']), '4.18.1');
    assert.strictEqual(v4(['-o=xml', '.a']), '4.18.1');
    assert.strictEqual(v4(['-o', 'toml', '.a']), '4.52.5');
    assert.strictEqual(v4(['-o', 'weird', 'eval', '.a']), '4.12.2');
    assert.strictEqual(v4(['-p', 'ini', 'eval', '.a']), '4.46.1');
    assert.strictEqual(v4(['--input-format=weird', 'eval', '.a']), '4.17.2');
    assert.strictEqual(judge(['r', 'f.yml', 'a.b', '-j']).flavor, 'mikefarah3');
    assert.strictEqual(v4(['-P', 'eval', '.a']), '4.5.1');
    assert.strictEqual(judge(['--arg', 'x', '1', '.a']).expression, 3);
    assert.strictEqual(judge(['--arg=x', '.a']).expression, 1);
    assert.strictEqual(judge(['-f', 'x', 'eval', '.a']).expression, 3);
    assert.strictEqual(judge(['-I=2', 'eval', '.a']).expression, 2);
    assert.strictEqual(judge(['n', 'a.b', 'x']).expression, 1);
    assert.strictEqual(v4(['eval', 'explode(.)']), '4.0.0');
    assert.strictEqual(v4(['eval', 'if .a then 1 else 2 end']), '4.54.1');
    assert.strictEqual(v4(['eval', '.[1:2]']), '4.53.6');
    assert.strictEqual(v4(['eval', '.a |= 1']), '4.3.2');
    assert.strictEqual(judge(['.a'], { doc: 'uses mikefarah/yq@v3.4.1' }).flavor, 'mikefarah3');
    const undecided = judge(['eval', '.a']);
    assert.match(yqNotes({ ...undecided, decided: false }, 'ja')[0], /mikefarah\/yq v4 として/);
    const paths = (src: string) => explainYq3Path(src, 'en')?.tokens.map((t) => t.explanation).join('\n');
    assert.match(paths('a[0].b[*].c[+]')!, /element 0[^]*every element[^]*new element/);
    assert.match(paths('a.(b==c).(d!=e).(.==x)')!, /matches `c`[^]*does not match `e`[^]*equal to `x`/);
    assert.match(paths('**."a.b".x*')!, /every descendant[^]*the key `a.b`[^]*keys matching `x\*`/);
    assert.strictEqual(paths('a[x]'), undefined);
    assert.strictEqual(paths(''), undefined);
    assert.deepStrictEqual(['`', '@base64', 'if . then 1 else 2 end', '...', 'select(.a)'].map(sameAsJq), [false, false, false, false, true]);
  });

  it('jq filters: strings, bindings, slices, formats, calls, object keys, and what does not parse', () => {
    type T = ReturnType<typeof explainJq>;
    const all = (ts: T): T => ts.flatMap((t) => [t, ...all(t.children)]);
    const j = (src: string, dialect: 'jq' | 'yq' = 'jq') => all(explainJq(src, 'en', dialect)).map((t) => t.explanation).join('\n');
    for (const src of ['`', '(1', '(1]', 'if . then 1', '...', ')', 'f(1 2)', '{1: 2}', '{a b}', 'then', '1 2', '"open']) assert.match(j(src), /Could not parse/, src);
    assert.ok(!/Could not parse/.test(j('"a\\(("x") + "y")b" + "a\\"b"')));
    assert.match(j('. as $x | . as $y | $x'), /Binding/);
    assert.match(j('. as $x | $x | .'), /Binding/);
    assert.match(j('.a line_comment = "x"', 'yq'), /Set the line_comment/);
    assert.ok(j('.a tag == "!!str"', 'yq'));
    assert.match(j('. - 1'), /subtraction/);
    assert.match(j('.[-1], .[-2], .[0]'), /the last element[^]*the 2th element from the end[^]*element 0/);
    assert.match(j('.[:2], .[1:]'), /from the start up to \(not including\) 2[^]*from 1 up to the end/);
    assert.match(j('.[.[0]], .[{"a": 1}["a"]:2]'), /index by the result/);
    assert.match(j('@foo "x", @base64'), /Format `@foo`/);
    assert.match(j('true, splits("a"; "g")'), /boolean true[^]*Argument 2/);
    assert.match(j('getpath(["a"])', 'yq'), /mikefarah\/yq does not have it/);
    assert.match(j('{"a": 1, (.k): 2, $x}'), /Key `a`[^]*the computed key[^]*Key `x` gets `\$x`/);
  });

  it('dialects: features in case patterns and words, odd expansions, set without -o, zsh in Japanese', () => {
    const features = (src: string) => {
      const tree = parser.parse(src);
      return featuresOnLine(tree.root, 0);
    };
    assert.deepStrictEqual(features('case $x in @(a|b)) :;; esac'), ['extglob']);
    assert.deepStrictEqual(features('echo ${}'), []);
    assert.deepStrictEqual(features('echo x{a..c}y; ls @(a|b)'), ['braceRange', 'extglob']);
    assert.deepStrictEqual(features('echo $BASHPID'), ['bashVar']);
    assert.deepStrictEqual(features('set pipefail; set errtrace; set -o errtrace'), ['errtrace']);
    const tree = parser.parse('setopt extended_glob\nprint ${(j:,:)arr}');
    assert.ok(dialectIssues(tree, 'zsh', 'ja').some((i) => i.kind === 'parse' && /zsh/.test(i.message)));
    assert.ok(dialectNotes(tree, 1, 'zsh', 'ja').length > 0);
  });

  it('expansions: forms not parsed, examples not made, and the Japanese wording', () => {
    for (const text of ['$x', '${%x}', '${#x:-a}', '${x~y}', '${a[1}']) assert.strictEqual(parseExpansion(text), undefined, text);
    assert.deepStrictEqual(parseExpansion('${x#}')!.parts.map((p) => p.role), ['name', 'op']);
    assert.ok(parseExpansion('${a[${i}]/$(echo "x")/y}'));
    const ex = (text: string, lang: 'ja' | 'en' = 'en') => exampleFor(parseExpansion(text)!, lang);
    for (const text of ['${x#$y}', '${x#}', '${x/a/$y}', '${@:0}', '${a[@]:1:-1}', '${x@K}', '${x#"a}']) assert.strictEqual(ex(text), undefined, text);
    assert.match(ex('${v:?}')![0].result, /a default message/);
    assert.match(ex('${v:?}', 'ja')![0].result, /既定のメッセージ/);
    assert.match(ex('${!v*}', 'ja')![0].when, /v_A と v_B/);
    assert.match(ex('${!a[@]}', 'ja')![0].when, /a=\(a b c\)/);
    assert.match(ex('${!x}', 'ja')![0].result, /\$HOME の値/);
    assert.match(ex('${!x}')![0].result, /the value of \$HOME/);
    assert.match(ex('${1:-x}', 'ja')![0].when, /引数が無いか空のとき/);
    assert.match(ex('${v:-$HOME}', 'ja')![0].result, /（展開結果）/);
    assert.match(ex('${1-x}', 'ja')![1].when, /1 番目の引数が空のとき/);
    assert.match(ex('${@:2}', 'ja')![0].when, /引数が `a b c d e` のとき/);
    assert.match(ex('${a[@]:2}', 'ja')![0].when, /a=\(a b c d e\)/);
    const g = (pattern: string, lang: 'ja' | 'en') => describeGlob(globParts(pattern)!, lang);
    assert.strictEqual(g('?[!a-c][[:digit:]]', 'ja'), '任意の1文字 + a〜c以外の1文字 + 数字のどれか1文字');
    assert.strictEqual(g('?[!x][[:digit:]][a-c]', 'en'), 'any one character + one character other than x + one character from digits + one character from a-c');
    assert.strictEqual(ex('${x/#}'), undefined);
    assert.ok(ex('${x%[[:foo:]]}'));
  });
});

describe('host files: branches no other test takes', () => {
  const lines = (e: Extracted) => e.text.split('\n');
  const shells = (e: Extracted) => e.regions.map((r) => `${r.start}:${r.shell ?? '-'}`);
  const explainHost = (kind: HostKind, text: string, line: number, lang: 'ja' | 'en' = 'en') => {
    const extracted = extractShell(kind, text);
    const tree = parser.parse(extracted.text);
    return explainHostedLine(new Analyzer(lang), tree, extracted, text.split('\n'), line, lang);
  };

  it('Dockerfile: odd exec forms, every SHELL, and scripts passed to each shell', () => {
    assert.strictEqual(hostKind('', 'Containerfile'), 'dockerfile');
    const e = extractShell('dockerfile', [
      'FROM alpine', 'RUN   ', 'RUN ["a", 1]', 'RUN ["a\\n\\tb", "x"]', 'RUN ["echo", "open', 'RUN []',
      'SHELL ["/bin/zsh", "-c"]', 'RUN echo z', 'SHELL ["/bin/ash", "-c"]', 'RUN echo a', 'SHELL ["/bin/busybox", "sh", "-c"]', 'RUN echo b',
      'SHELL ["/bin/dash", "-c"]', 'RUN echo d', 'SHELL ["pipefail"]', 'SHELL /bin/bash',
      'RUN ["bash", "-c", "echo 1"]', 'RUN ["zsh", "-c", "echo 2"]', 'RUN ["dash", "-c", "echo 3"]', 'RUN ["busybox", "-c", "echo 4"]',
      'RUN ["mksh", "-c", "echo 5"]', 'RUN ["ksh93", "-c", "echo 6"]', 'RUN ["yash", "-c", "echo 7"]', 'RUN ["sh", "-c", "echo 8"]',
      'RUN ["echo", \\',
    ].join('\n'));
    assert.deepStrictEqual(shells(e), ['1:sh', '3:bash', '5:sh', '6:bash', '7:zsh', '8:bash', '9:ash', '10:bash', '11:ash', '12:bash', '13:sh', '14:bash',
      '16:bash', '17:zsh', '18:dash', '19:ash', '20:mksh', '21:ksh', '22:yash', '23:sh']);
    assert.strictEqual(lines(e)[3], "$'a\\n\\tb' x");
    assert.strictEqual(lines(e).length, 25);
    assert.strictEqual(extractShell('dockerfile', 'RUN ["a\\nb\\\\\'c"]').text, "$'a\\nb\\\\\\'c'");
  });

  it('Makefile: SHELL of each kind, recipe lines outside rules, prefixes only, unclosed $(', () => {
    const e = extractShell('makefile', [
      'SHELL := /bin/zsh', '\techo outside', 'all:', '\t@echo $(CC) ${CFLAGS} $$HOME $@ $X $(oops', '\t@-+', '\techo a \\', 'continued', 'SHELL = /bin/ksh', 'b:', '\techo b',
    ].join('\n'));
    assert.deepStrictEqual(shells(e), ['3:zsh', '4:zsh', '5:zsh', '9:sh']);
    assert.strictEqual(lines(e)[3], 'echo ${CC} ${CFLAGS} $HOME ${make_target} ${X} $(oops');
    assert.strictEqual(lines(e)[6], 'continued');
  });

  it('Jenkinsfile: comments, unclosed strings, shebangs of other languages, Groovy expressions', () => {
    const e = extractShell('jenkinsfile', [
      "// sh 'commented'", "sh 'open", "sh '#!/usr/bin/python3\\nprint(1)'", 'sh "echo ${env.GITHUB_REPOSITORY} ${params.T} ${a.b()} ${ } $env.HOME"',
      "sh '''", 'echo hi', "'''",
    ].join('\n'));
    assert.deepStrictEqual(shells(e), ['2:sh', '3:sh', '5:sh']);
    assert.match(lines(e)[3], /\$\{ENV_GITHUB_REPOSITORY\} \$\{PARAMS_T\} \$\{A_B\} \$\{EXPR\} \$\{ENV_HOME\}/);
    assert.ok(e.substitutions.some((x) => /owner\/repository/.test(x.meaning[1])));
    assert.ok(e.substitutions.some((x) => /build parameter `T`/.test(x.meaning[1])));
  });

  it('YAML: scripts at the top, Azure on Windows, CircleCI commands, sh keys, shells beside run, job defaults and runners', () => {
    const top = extractShell('yaml', ['run: echo top', 'script: echo two', 'steps:', '  - run: echo x'].join('\n'));
    assert.deepStrictEqual(shells(top), ['0:bash', '1:-', '3:bash']);
    const azure = extractShell('yaml', ['pool:', '  vmImage: windows-latest', 'variables:', '  Foo: 1', 'steps:', '- script: echo hi', '- bash: echo $(Foo) $(Build.SourcesDirectory) $(date)'].join('\n'));
    assert.deepStrictEqual(shells(azure), ['6:bash']);
    assert.strictEqual(lines(azure)[6], 'echo ${FOO} ${BUILD_SOURCESDIRECTORY} $(date)');
    assert.deepStrictEqual(shells(extractShell('yaml', 'command: ls\nsh: echo x')), ['1:sh']);
    const gh = extractShell('yaml', [
      'jobs:', '  a:', '    defaults:', '      run:', '        shell: sh', '    runs-on: ubuntu-latest', '    steps:', '      - run: echo a',
      '  b:', '    runs-on: ${{ matrix.os }}', '    steps:', '      - run: echo ${{ }}', '        shell: sh', '      - run: echo c', '        shell: pwsh', '      - run: echo d',
      '  c:', '    steps:', '      - run: echo e',
    ].join('\n'));
    assert.deepStrictEqual(shells(gh), ['7:sh', '11:sh', '15:bash', '18:bash']);
    assert.strictEqual(lines(gh)[11], 'echo ${EXPR}');
    const list = extractShell('yaml', ['script:', '  - echo a', '  - |', '    echo b', '- other: x'].join('\n'));
    assert.deepStrictEqual(shells(list), ['1:-', '3:-']);
    const notes = explainHost('yaml', 'jobs:\n  a:\n    steps:\n      - run: echo x >> $GITHUB_ENV', 3, 'ja')!.notes;
    assert.ok(notes.some((n) => /GitHub Actions が用意するファイル/.test(n)), notes.join('\n'));
  });

  it('npm and Markdown: escapes in scripts, other lines, and code blocks of each shell', () => {
    const npm = extractShell('npm', ['{', '  "scripts": {', '    "a": "echo \\"x\\"\\n\\ty",', '    not a script', '  }', '}'].join('\n'));
    assert.strictEqual(lines(npm)[2], 'echo "x" \ty');
    const md = extractShell('markdown', ['```', 'plain', '```', '```zsh', 'echo z', '```', '```ksh', 'echo k', '```', '```dash', 'echo d', '```'].join('\n'));
    assert.deepStrictEqual(shells(md), ['4:zsh', '7:ksh', '10:dash']);
  });
  it('YAML: a bare run: at the top, command at the top, run below another key, run: outside CI', () => {
    assert.deepStrictEqual(shells(extractShell('yaml', 'run:\n  - echo a\nsteps:\n- x')), ['1:bash']);
    assert.deepStrictEqual(shells(extractShell('yaml', 'command: ls\nsteps:\n- x')), ['0:-']);
    assert.deepStrictEqual(shells(extractShell('yaml', 'jobs:\n  a:\n    steps:\n      - name: a\n        run: echo a\n        shell: sh')), ['4:sh']);
    assert.deepStrictEqual(shells(extractShell('yaml', 'run: echo x')), ['0:-']);
    assert.strictEqual(extractShell('jenkinsfile', 'sh "echo $1 ${open"').text, 'echo $1 ${open');
  });

  it('Python: imports in every form, calls in comments and strings, lists, keywords, f-strings and escapes', () => {
    const py = [
      'import subprocess as sp, os',
      'from subprocess import (',
      '    run,',
      '    check_output as co,',
      ')',
      'from asyncio import create_subprocess_exec',
      '# sp.run("commented")',
      'x = "sp.run(\'in a string\')"',
      'run(shell=True)',
      'run(["ls", "-l"], shell=True)',
      'run([], shell=False)',
      'run(["a", name, "\\x41\\u0041"])',
      'run(["a",',
      '     "b"])',
      'create_subprocess_exec("ls", "-l", *args)',
      'run("ls -l")',
      'run("ls -l", shell=flag)',
      'run("echo " + x, shell=True)',
      'run("echo a", shell=True, executable="/bin/bash")',
      'run("echo z", shell=True, executable="/bin/zsh")',
      'os.system(f"echo {x!r:>3} {{}} { }")',
      'os.system("""echo a',
      'b""")',
      'os.system("a \\',
      'b")',
      'os.system(cmd)',
      'os.system("x %s" % y)',
      'co(  # why',
      '   "date",  # when',
      '   )',
      'os.system(rb"raw\\n" "two")',
      'os.system("open',
      'sp.run(',
    ].join('\n');
    const e = extractShell('python', py);
    const regions = e.regions.map((r) => `${r.start}:${r.label[1].replace(/^Python `[\w.]+` \(|\)$/g, '')}`);
    assert.deepStrictEqual(regions, [
      '9:shell=True: the shell runs the first item of the list', '11:arguments run without a shell', '12:arguments run without a shell', '14:arguments run without a shell',
      '15:a command string run without a shell', '16:a command string run without a shell', '17:a string the shell (/bin/sh) runs', '18:a string the shell (bash) runs',
      '19:a string the shell (zsh) runs', '20:a string the shell (/bin/sh) runs', '21:a string the shell (/bin/sh) runs', '23:a string the shell (/bin/sh) runs',
      '26:a string the shell (/bin/sh) runs', '28:a command string run without a shell', '30:a string the shell (/bin/sh) runs',
    ]);
    assert.strictEqual(lines(e)[11], 'a "${py_name}" AA');
    assert.strictEqual(lines(e)[20], 'echo ${py_x} {} ${py_expr}');
    assert.strictEqual(lines(e)[30], 'raw\\ntwo');
    const notes = e.regions.flatMap((r) => (r.notes ?? []).map((n) => n[1]));
    assert.ok(notes.some((n) => /decided at run time/.test(n)));
    assert.ok(notes.some((n) => /only the string literal is explained/.test(n)));
    assert.deepStrictEqual(extractShell('python', 'run("x")').regions, []);
  });
  it('Python and YAML: lists that cannot be read, escapes in scripts, a blank line before shell:', () => {
    const e = extractShell('python', ['import subprocess', 'subprocess.run([cmd, "x"], shell=True)', 'subprocess.run(["a" +', '  "b"])', 'subprocess.run("\\u0041"  # c', ')', 'subprocess.run("eof'].join('\n'));
    assert.deepStrictEqual(e.regions.map((r) => r.start), [4]);
    assert.strictEqual(lines(e)[4], 'A');
    assert.deepStrictEqual(shells(extractShell('yaml', 'jobs:\n  a:\n    steps:\n      - run: echo a\n\n        shell: sh')), ['3:sh']);
  });

  it('explanations and problems of host files, in both languages', () => {
    const mk = explainHost('makefile', 'all:\n\techo $(CC)', 1, 'ja')!;
    const every = (ts: typeof mk.items): typeof mk.items => ts.flatMap((t) => [t, ...every(t.children)]);
    assert.ok(every(mk.items).some((t) => /make の変数/.test(t.explanation)));
    assert.ok(mk.notes.some((n) => /^`\$\(CC\)` は make の変数/.test(n)), mk.notes.join('\n'));
    assert.strictEqual(mk.context[0].label, 'Makefile のレシピ');
    const gh = explainHost('yaml', 'jobs:\n  a:\n    steps:\n      - run: echo "${{ github.head_ref }}"', 3, 'ja')!;
    assert.ok(gh.notes.some((n) => /スクリプトインジェクション/.test(n)));
    const pipe = explainHost('dockerfile', 'FROM alpine\nRUN seq 3 | sort -r', 1)!;
    assert.ok(pipe.examples.length > 0);
    const issues = (kind: HostKind, text: string, lang: 'ja' | 'en' = 'en') => {
      const extracted = extractShell(kind, text);
      const tree = parser.parse(extracted.text);
      return hostIssues(tree, extracted, text.split('\n'), lang);
    };
    assert.deepStrictEqual(issues('markdown', '```bash\n[[ -f a ]]\n```'), []);
    const sh = issues('dockerfile', 'FROM alpine\nRUN echo -e "a\\tb" && [[ -f a &&\\\n  -f b ]] | cat', 'ja');
    assert.ok(sh.some((i) => i.severity === 'info'));
    assert.ok(sh.some((i) => i.code === 'dbracket' && i.endCol === 'RUN echo -e "a\\tb" && [[ -f a &&\\'.length));
    assert.ok(sh.some((i) => i.code === 'dockerPipefail' && /パイプ/.test(i.message)));
    const py = issues('python', 'import os\nimport subprocess\nsubprocess.run("ls -l")', 'ja');
    assert.ok(py.some((i) => i.code === 'pythonNoShell' && /shell=True/.test(i.message)));
    const exec = explainHost('dockerfile', 'FROM alpine\nCMD ["echo", "hi"]', 1, 'ja')!;
    assert.ok(exec.notes.some((n) => /exec 形式/.test(n)));
    const e = extractShell('dockerfile', 'RUN echo');
    const plain = remapExplanation({ line: 0, summary: '', items: [], context: [], notes: [], examples: [{ title: 'E', sections: [] }] }, e, ['RUN echo']);
    assert.strictEqual(plain.examples[0].anchor, undefined);
    assert.deepStrictEqual(substitutionNotes(extractShell('yaml', 'jobs:\n  a:\n    steps:\n      - run: echo ${{ github.head_ref }}'), 3, 'en').length, 2);
  });
});

describe('jq runner: what it gives up on, and what newer jq releases do', () => {
  it('gives up on syntax and functions it does not run', () => {
    for (const f of ['1 )', '"\\q"', '.a ?// 1', 'f(1 2)', ')', '{"a\\(1)"}', '{(1)}', '{a: .b | .}', '{1: 2}', '{a b}', 'reduce .[] as [$a] (0; .)', '[range(200000)] | map(. + 1) | length', '@foo', '(1) |= 2',
      '(.[[0]]) |= 1', '(.[1:]) |= .', 'del(.[1:])', '.[1:] = [1]', '.[] |= empty', '.[0] = (1, 2)', '.[0] += (1, 2)', 'test("a"; "q")', 'foo', 'def f($a): $a; f(1, 2)', 'ltrimstr("a", "b")',
      'input', '$__loc__ | .x | input', '.a |', '(1', '(map(.)) |= 1', 'getpath([{"start": 1, "end": null}])', '(.[0] | input)?', '.[input:]?', 'try input', 'reduce .[] as $x 0', 'setpath([{"start": 1, "end": null}]; 1)']) {
      assert.strictEqual(runJq(f, [1, 2]), undefined, f);
    }
    assert.deepStrictEqual(runJq('$__loc__', null), { outputs: [{ file: '<top-level>', line: 1 }] });
  });

  it('follows jq 1.7.1 and later where releases differ', () => {
    const out = (f: string, x: Parameters<typeof runJq>[1]) => {
      const r = runJq(f, x);
      return r && 'outputs' in r ? r.outputs : r;
    };
    assert.deepStrictEqual(out('reverse', 'abc'), ['cba']);
    assert.deepStrictEqual(out('from_entries', [{ k: 'a', v: 1 }, { Name: 'b', Value: 2 }, { Key: 'c' }, { name: 1, value: 2 }, { K: 'd' }]), [{ a: 1, b: 2, c: null, 1: 2, d: null }]);
    assert.deepStrictEqual(out('to_array, ([1] | to_array)', 1), [[1], [1]]);
    assert.deepStrictEqual(out('trim', ' a '), ['a']);
    assert.deepStrictEqual(out('from_entries', [{ value: 1 }]), [{ null: 1 }]);
    assert.deepStrictEqual(out('"x" * 0', null), [null]);
    assert.deepStrictEqual(out('walk(empty)', 1), [null]);
    assert.deepStrictEqual(out('try (1, error("x"), 3) catch .', null), [1, 'x']);
    assert.deepStrictEqual(out('map(round)', [-2.5, 2.5]), [[-3, 3]]);
  });

  it('makes up input of the right shape', () => {
    const filters = ['.[-1].name', '.["key"]', 'try .a', '-.n', '.a and .b', '.n > 5 or .m < 2', 'map_values(. * 2)', 'max_by(.n) | .n', 'sort | first', 'first(.[])',
      'any(.ok)', 'all', 'map(select(.name | test("a")))', 'map(select(.x | not))', '.users | map(.name)', '.flags | map(not)', '[.[] | select(.)] | length', '.[0] | keys'];
    for (const f of filters) assert.ok(jqExample(f), f);
    assert.strictEqual(jqExample('range(10)')![0].outputs[4], '…');
  });
});

describe('the analyzer: branches no other test takes', () => {
  const both = (src: string, line = 0, shell?: Shell, opts: ExplainOptions = {}) => {
    const tree = parser.parse(src);
    const en = new Analyzer('en').explainLine(tree, line, shell, opts);
    const ja = new Analyzer('ja').explainLine(tree, line, shell, opts);
    const all = (ts: typeof en.items): typeof en.items => ts.flatMap((t) => [t, ...all(t.children)]);
    return [en, ja].map((e) => [...e.context.map((c) => c.label), ...e.notes, ...all(e.items).map((t) => `${t.label}: ${t.explanation}`), ...e.examples.map((x) => x.title)].join('\n'));
  };
  const cases: [string, number?, Shell?, ExplainOptions?][] = [
    ['echo ${a[10]} ${a[11]} ${a[12]} ${a[13]} ${a[1]} ${a[2]} ${a[3]} ${a[-11]} ${a[-2]} ${s:10:1} ${s:11} ${s:21:1} ${s:22:1} ${s:23}'],
    ['echo "$x" | grep -c a', 0, undefined, { idioms: false, pitfalls: false }],
    ['until false; do\n  echo a\ndone', 1], ['((\n  x = 1\n))', 1], ['a=1 b=2'], ['(( x ? 1 : 2 )); (( x-- )); (( (1 + 2) ))'], ["echo $'a\\tb'"],
    ['echo ${@} $? ${#} $_'], ['for ((i = 0; i < 3; i++)); do :; done'], ['cat <<-EOF\n\tx\n\tEOF'], ['cat <<"EOF" > out\nx\nEOF'],
    ['case $x in\n  @(a|b)) echo;;\n  *.txt|a?) :;;\n  plain) :;;\nesac', 1], ['case $x in\n  *.txt|a?) :;;\nesac', 1], ['case $x in\n  plain) :;;\nesac', 1],
    ['{ echo a; } > out'], ['while read -r l; do :; done < f'], ['cat <<< "$x"'], ['x+=(a)'], ['x='], ['declare -x -Q a b=1'], ['declare -a \\\n  x', 1],
    ['yq \'.a\' \\\n  f.yml', 1], ['git foo bar'], ['alias ll="ls -l"\nll', 1, 'zsh'], ['l -a', 0, undefined, { host: 'Markdown code block (bash)' }], ['l -a'],
    ['set +e -u'], ['shopt -s nullglob foo'], ['echo a \\\n  b', 1], ['chmod 999 f'], ['sort -k x f'], ['cut -f x f'], ["tr '' x"], ["yq r f.yml 'a[x]'"],
    ["getopt -o '!' -- \"$@\""], ["getopts '!' opt"], ['git log --date=nonsense'], ["find . -path '*/src/*'"], ["find . -name '*.c'"], ['date 0101'],
    ["yq -o=xml '.a' f.yml"], ["yq -oj '.a' f.yml"], ["yq --output-format=json '.a' f.yml"], ["yq -y '.a' f.yml"], ["yq -r '.name' f.yml"], ["yq -i '.a = 1' f.yml"],
    ["yq -y '.a | tonumber' f.yml"], ['sed --expression=s/a/b/ f'], ['sed -e'], ['sed -e "$x" f'], ["jq --argjson n x --arg s v --arg \"$k\" v '.a' f"],
    ["awk -F, -v x=1 -vy=2 --field-separator=: -F \"$s\" -v \"$v\" -v novalue '{ print }' f"], ['seq 3 |\n  sort -r', 1], ['for i in 1; do seq 3 | sort; done'],
    ['grep a f 2>/dev/null | sort'], ['grep a f > out | sort'], ['sort < f | uniq'], ['echo | sort < f'], ['(echo) | sort'], ['"$cmd" | sort'], ['seq 3 | xargs -n1 echo'],
    ['cat f | sort | cat'], ["perl -le 'print 1'"], ["perl -pi -e 's/a/b/' f"], ["perl -ne 'print ~1'"], ['basename /a/b.txt .txt'], ['echo {1..20}'], ['echo {1..1000}'],
    ['x=$(case $y in @(a|b)) echo;; *.c) :;; plain) :;; esac; declare -x z; find . -name "*.c" -print; seq 3 | sort -r; { echo a; } > out; echo {a,b} *.txt; f() { local v=$(date); }; yq .a f.yml; tr -d x; sed -n p; awk 1; getopts ab o; read -r a b; [[ $a =~ ^x ]]; (( i++ )); echo ${a:1:2} ${#a} ${!a} ${a[*]} ${a/x/y} ${a,,} ${a@Q}) \\\n  && echo done'],
    ['echo $(case $y in a) :;; *.c) :;; esac) \\\n  x'], ['> out'], ['cat <<< x 2>&1 > f'], ['cat <<EOF'], ['declare -x a \\\n  b', 1], ['unset a \\\n  b', 1],
    ['echo $(yq .a f.yml) \\\n  x'], ['alert', 0, undefined, { host: 'Markdown code block (bash)' }], ['grep -r a \\\n  b', 1], ['for x; do :; done'],
    ['{ cat; } <<< x 2>&1 > f'], ['case $x in\n  a |\n  b) :;;\nesac', 1], ['case $x in\n  (\n  a) :;;\nesac', 1], ['case $x in\n  a)\n    echo;;\nesac', 2],
    ['x=1 \\\n  && case $y in a) :;; esac'], ['cat <<EOF\nEOF'], ['x=1 \\\n  && yq .a f.yml'], ['find . \\\n  -name a -o -name b'], ['find -L . -name a'], ['find . /tmp'],
    ['x=1 \\\n  && grep -e a -A 2 --color=auto f'], ['x=1 \\\n  && git log --oneline -n 3 --format=%h'],
    ['tr "$a" x'], ['tr -d a b'], ['grep -- -a f'], ['sed --expression="$x" f'], ['sed -e "$x" f'], ['yq "$e" f'], ['yq -o json .a f.yml'], ["yq '.a | input' f.yml"],
    ["yq -y '.a // \"d\"' f.yml"], ["yq -r '.a | tonumber' f.yml"], ['{ echo; } > f | sort'], ['grep a | sort'], ['perl -ne "$x"'],
    ['seq 3 | while read -r n; do t=$n; done; echo "$t"'], ['seq 3 | read v; echo "$v"', 0, 'dash'], ['seq 3 | { read v; }; echo "$v"'], ['seq 3 | for i in 1; do s=1; done; echo $s'],
    ['echo a | X=1 cat; echo $X'], ['f() { echo | while read -r l; do local q=1; done; echo $q; }'], ['echo | while read -r -d x l; do :; done; echo $l'],
    ['if :; then\n  echo | while read l; do n=1; done\n  echo $n\nfi', 1], ['echo | while read l; do n=1; done; n=2; echo $n'], ['echo | cat | (cd /)'],
    ['for f in *.log; do\n  [ -e "$f" ] || continue\ndone'], ['for f in "$d"/*.log; do echo; done'], ['shopt -s dotglob nocaseglob\nls *.txt', 1],
    ['sed -e s/a/b/ --expression="$x" f'], ['sed -e s/a/b/ -e'], ['sed -e s/a/b/ -e "$x" f'], ["yq '.a' \"$f\""], ["yq -y '.name | tonumber' f.yml"], ["perl -ne 'print' \"$f\""],
    ['ls **/*.c', 0, 'ksh'], ['shopt -s nocasematch\ncase $x in a*) :;; esac', 1], ["find . -name '[é]'"], ['case $x in "$y") :;; esac'], ['case $x in [é]) :;; esac'],
    ['git log --format=%h "$r"'], ['git log --date=short --pretty=%ad'], ['git log --oneline --date=short'], ['git log --date=short'],
    ['getopt -oab: -- "$@"'], ['getopt --options=ab --longoptions=x,y: -- "$@"'], ['getopt -o'], ['getopt -o a -l'], ['getopt -n prog -o a -- x'], ['getopt --name=prog -o a --'],
    ['getopt -a -o a --'], ['getopt -T'], ['getopt -n prog'], ['getopt ab "$@"'], ['getopt "$o"'],
    ['IFS= read -r a b'], ['IFS="$x" read a'], ['read -r "$v"'], ['read -q'], ['read'], ['read -a arr'], ['IFS=: read -r a b'],
    ['[ -n "$x" ]'], ['[[ $x == "$y" ]]'], ['(( x > 3 ))'], ['[ $x = a -o $y = b ]'], ['shopt -s nocasematch\n[[ $x == a* ]]', 1], ['[ "$1" = a ]'], ['[ -z ]'], ['[ ! -f a ]'], ['[[ a == ]]'],
    ['printf -v v "%s" a'], ['printf -- "%s\\n" a'], ['printf -v v'], ["printf '%q' $'a\\tb'"], ['printf "$f"'], ['printf "%s"'],
    ['[[ $a =~ "x"y ]]'], ['(( -x ))'], ['(( x = $y ))'], ['echo "${a:-\nb}"'], ['echo ${a[@]:1:2} ${@:2} ${s:$i:$n} ${s:$i} ${a[key]} ${x:=d} ${x^^[a-c]} ${x#$y} ${s:1:$n} ${x@Z}'],
    ['echo ${s:$i:2}'], ['echo ${x@Z}'], ["grep a\"b\"c f"], ["grep 'a'b f"], ["printf 'a\\177b\\n'"], ['shopt -p globstar\nls **/*.c', 1], ['set +o globstar\nls **/*.c', 1, 'ksh'],
    ["sed 's/a\\/b/X/' f"], ["sed 's/a\\.b/X/I' f"], ["sed 's/a/b/;p' f"], ["sed 's/a\\' f"], ['python -c "print(1)"'], ['zsh -c "echo"'],
    ["perl -ne 'print' file \"$f\""], ['seq 3 | while read l; do x=1; done && echo $x'], ['getopt --optionsx'], ['xargs -s 10 echo'], ['[ ]'], ['[ ${x} = a ]'],
    ['printf -v x -- a'], ['date +%Q'], ['echo ${s:$i}'], ['echo ${x@w}'], ['grep "a"\'b\' f'],
    ['echo ${s:i} ${s:i:2}'], ["yq -y '.a | error' f.yml"], ["yq -r '.a | error' f.yml"],
    ['export -n x'], ['unset -f f; unset -v x; unset "a[1]"'], ['function f() { :; }'], ['f() (echo)'], ['typeset -i n=1'], ['readonly r'],
  ];
  for (const [src, line = 0, shell, opts] of cases) {
    it(src.replace(/\n/g, '⏎'), () => {
      const [en, ja] = both(src, line, shell, opts);
      assert.ok(en.length > 0 && ja.length > 0);
    });
  }
});
