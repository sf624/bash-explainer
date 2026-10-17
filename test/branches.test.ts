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
import { dialectIssues } from '../src/dialect';
import { explainRegex } from '../src/embedded/regex';
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

  it('quick fixes: [[ ]] that [ ] cannot say', () => {
    const fix = (src: string) => {
      const tree = parser.parse(src);
      try {
        return dialectIssues(tree.rootNode, 'sh', 'en').map(fixFor).find(Boolean)?.edits[0].text;
      } finally {
        tree.delete();
      }
    };
    for (const src of ['[[ a b ]]', '[[ a == ]]', '[[ ! -f a* ]]', '[[ -f a* ]]', '[[ $a -eq 1* ]]', '[[ $a == "a"b ]]', '[[ $a == x$b ]]', '[[ -f "a"$b ]]', '[[ -n a\\ b ]]']) {
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
});
