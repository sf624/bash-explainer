import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { Analyzer } from '../src/analyzer';
import type { LineExplanation, Token } from '../src/analyzer-types';
import { autoShellAt, documentIssues, explainDocumentLine, noteIssues, type ShellDocument } from '../src/document';
import { openDocument } from '../src/document-setup';
import { withinLine } from '../src/examples/regexguard';
import { extractShell, hasParts, hostPartAt, languageLines, literalOf, patternOf, regionAt } from '../src/hosts';
import { autoShellText } from '../src/messages-shell';
import { readSaid } from '../src/messages-tokens';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { roleFor } from '../src/ui/panelRoles';
import { toPlainMarkdown } from '../src/ui/render';
import { scopeChip, shellChoices } from '../src/ui/scope';

// The patterns of Python's `re` in a `.py` file, as a part of the host file in another language (docs/design/python-regex.md,
// section 2): `Extracted.languages`, `hostPartAt`, the seam in `explainDocumentLine` (src/hosts/languages.ts), the chip's
// reading, the problems, and the reading tree.

const parser = createUnbashParser();
const open = (src: string): ShellDocument => openDocument(src, 'python', (t) => parser.parse(t));
const explainPy = (src: string, line: number, lang: 'ja' | 'en' = 'en', opts = {}): LineExplanation => explainDocumentLine(new Analyzer(lang), open(src), line, lang, {}, opts);
const texts = (ts: readonly Token[]): string[] => ts.flatMap((t) => [`${t.label}: ${t.explanation}`, ...texts(t.children)]);
/** Each region of a file's patterns: its lines, the function as written and its full name, and the text the reader reads. */
const patterns = (src: string) => extractShell('python', src).languages.map((r) => ({ lines: r.lines, call: r.call.written, name: r.call.name, value: patternOf(r)!.value }));

describe('Python regex: the patterns of `re` in a `.py` file', () => {
  describe('which calls give a pattern', () => {
    it('finds the functions of `re` by the names the file imports, with a pattern of literals', () => {
      assert.deepStrictEqual(patterns("import re\nm = re.search(r'^\\d+$', s)\n"), [{ lines: [1], call: 're.search', name: 're.search', value: '^\\d+$' }]);
      assert.deepStrictEqual(patterns("import re as regex\nregex.sub('a+', 'b', s)\n").map((p) => [p.call, p.name]), [['regex.sub', 're.sub']]);
      assert.deepStrictEqual(patterns("from re import compile, fullmatch as fm\ncompile('x')\nfm(pattern='y', string=s)\n").map((p) => [p.call, p.name, p.value]), [['compile', 're.compile', 'x'], ['fm', 're.fullmatch', 'y']]);
      for (const f of ['compile', 'search', 'match', 'prefixmatch', 'fullmatch', 'findall', 'finditer', 'split', 'sub', 'subn']) assert.strictEqual(patterns(`import re\nre.${f}('a')\n`).length, 1, f);
      // (Not an attribute, nor a module that is not `re`, nor a function of `re` that takes no pattern.)
      assert.deepStrictEqual(patterns("import re\nx.search('a', s)\nre.escape('a')\nimport other\nother.search('a')\n"), []);
      assert.deepStrictEqual(patterns("search('a', s)\n"), []);
    });

    it('reads the value of the literals: escapes undone unless raw, joined, over several lines', () => {
      assert.deepStrictEqual(patterns("import re\nre.match('\\\\d+\\\\.' r'\\w' \"\\t\", s)\n").map((p) => p.value), ['\\d+\\.\\w\t']);
      // (The region is the call's lines, from its name to its `)`.)
      assert.deepStrictEqual(patterns("import re\nP = re.compile(\n    r'a'\n    r'b'\n)\n").map((p) => [p.lines, p.value]), [[[1, 2, 3, 4], 'ab']]);
      assert.deepStrictEqual(patterns("import re\nP = re.compile(r'''a\nb''')\n").map((p) => [p.lines, p.value]), [[[1, 2], 'a\nb']]);
      assert.deepStrictEqual(patterns("import re\nre.search((r'a'), s)\n").map((p) => p.value), ['a']);
      // (An empty pattern is one too: its end is where its text would start.)
      const empty = patternOf(extractShell('python', "import re\nre.compile('')\n").languages[0])!;
      assert.deepStrictEqual([empty.value, empty.at, empty.to], ['', [{ line: 1, character: 12 }], []]);
      assert.deepStrictEqual(explainPy("import re\nre.compile('')\n", 1).items.map((t) => [t.label, t.children.length]), [["''", 0]]);
    });

    it('leaves what it does not read yet: fields, `\\N{…}`, a value built at run time, `*args`', () => {
      for (const call of ["re.search(f'{x}a', s)", "re.search('\\N{EM DASH}', s)", "re.search('a' + x, s)", "re.search(p, s)", "re.search('%s' % x, s)", "re.search(*args)", "re.search('a', **kw)", 're.search(', "re.search('a'", 're.search(string=s)']) {
        assert.deepStrictEqual(patterns(`import re\n${call}\n`), [], call);
      }
      // (An f-string with no field is a str; flags, VERBOSE and bytes patterns are read, test/python-flags.test.ts.)
      assert.strictEqual(patterns("import re\nre.search(f'a{{2}}', s)\nre.search('a', s, re.I)\nre.compile(r'(?x) a b')\nre.search(rb'a', s)\n").length, 4);
      // (A call Python refuses: an argument past the function's parameters, or a keyword it does not have.)
      for (const call of ["re.compile('a', 0, x)", "re.search('a', s, flag=1)"]) assert.deepStrictEqual(patterns(`import re\n${call}\n`), [], call);
    });

    it('reads the call: each argument with the parameter it binds, by its slot or by keyword, its place, and its value when it is literals', () => {
      const args = (src: string) => extractShell('python', src).languages.map((r) => r.args.map((a) => [a.role, a.keyword, `${a.span.start.line}:${a.span.start.character}-${a.span.end.line}:${a.span.end.character}`, a.literal?.value]));
      assert.deepStrictEqual(args("import re\nre.sub(r'(\\d+)', r'<\\1>', text, 2)\n"), [[
        ['pattern', false, '1:7-1:15', '(\\d+)'], ['repl', false, '1:17-1:24', '<\\1>'], ['string', false, '1:26-1:30', undefined], ['count', false, '1:32-1:33', undefined]]]);
      assert.deepStrictEqual(args("import re\nre.split(string='a,b', pattern=',', maxsplit=1)\n"), [[
        ['string', true, '1:16-1:21', 'a,b'], ['pattern', true, '1:31-1:34', ','], ['maxsplit', true, '1:45-1:46', undefined]]]);
      // (The call's place: from its name to its `)`.)
      const region = extractShell('python', "import re\nm = re.match(\n  'a', s)\n").languages[0];
      assert.deepStrictEqual([region.call.span, [region.call.written, region.call.name]], [{ start: { line: 1, character: 4 }, end: { line: 2, character: 9 } }, ['re.match', 're.match']]);
      // (The literal of a role: none for one the call does not give, or gives as no literal.)
      assert.deepStrictEqual([literalOf(region, 'pattern')?.value, literalOf(region, 'string'), literalOf(region, 'repl')], ['a', undefined, undefined]);
    });

    it('gives a line to one part: a shell region keeps a line it shares, and the first pattern a line has', () => {
      const src = "import re, os\nre.match('a', x); os.system('ls')\nre.match('b', x); re.match('c', x)\n";
      const ex = extractShell('python', src);
      assert.deepStrictEqual(ex.regions.map((r) => [r.start, r.end]), [[1, 1]]);
      assert.deepStrictEqual(ex.languages.map((r) => [r.lines, patternOf(r)!.value]), [[[2], 'b']]);
      // (Its lines stay empty in the shell text.)
      assert.strictEqual(ex.text.split('\n')[2], '');
    });

    it('gives a line of a call to the call whose pattern is on it, else to the innermost call that holds it', () => {
      const lines = (src: string) => extractShell('python', src).languages.map((r) => [r.lines, patternOf(r)!.value]);
      // (A call inside another, on the next line: each line shows its own pattern; it was the outer's on both before.)
      const nested = "import re\nx = re.sub(r'a', 'b',\n           re.sub(r'c', 'd', s))\n";
      assert.deepStrictEqual(lines(nested), [[[1], 'a'], [[2], 'c']]);
      assert.deepStrictEqual([1, 2].map((l) => explainPy(nested, l).items[0].label), ["r'a'", "r'c'"]);
      // (The inner call over three lines, and the outer's last argument on a line of its own.)
      assert.deepStrictEqual(lines("import re\nx = re.sub(r'a',\n  'b', re.sub(\n    r'c', 'd',\n    s),\n  s)\n"), [[[1, 5], 'a'], [[2, 3, 4], 'c']]);
      // (A line where two patterns are: the first written's, and the other call has no line.)
      assert.deepStrictEqual(lines("import re\nx = re.sub(r'a', 'b',\n  re.sub(r'c', 'd', s)) or re.match(r'e',\n  t)\n"), [[[1], 'a'], [[2], 'c']]);
      assert.deepStrictEqual(lines("import re\nx = re.sub(r'a', 'b', re.sub(r'c', 'd',\n  s))\n"), [[[1, 2], 'a']]);
      // (A call of one statement keeps every line of it.)
      assert.deepStrictEqual(lines("import re\ny = re.findall(r'\\d+',\n  text)\n"), [[[1, 2], '\\d+']]);
    });

    it('leaves a call the lines a shell region in it has, and keeps the rest', () => {
      const src = "import re, subprocess\nx = re.sub(r'a', 'b',\n  subprocess.run('ls -l', shell=True).stdout,\n  count=1)\n";
      const ex = extractShell('python', src);
      assert.deepStrictEqual(ex.regions.map((r) => [r.start, r.end]), [[2, 2]]);
      assert.deepStrictEqual(ex.languages.map((r) => [r.lines, patternOf(r)!.value]), [[[1, 3], 'a']]);
      assert.deepStrictEqual([1, 2, 3].map((l) => hostPartAt(ex, l)?.kind), ['language', 'shell', 'language']);
      // (A pattern on a line the shell region has is not explained.)
      assert.deepStrictEqual(extractShell('python', "import re, subprocess\nx = re.sub(\n  r'a', subprocess.run('ls', shell=True),\n  s)\n").languages, []);
    });
  });

  describe('hostPartAt', () => {
    const ex = extractShell('python', "import re, os\nos.system('ls')\nre.compile(r'''a\nb''')\nx = 1\n");
    it('gives the shell region or the part in another language of a line, and nothing for the host\'s own text', () => {
      assert.deepStrictEqual([0, 1, 2, 3, 4].map((l) => hostPartAt(ex, l)?.kind), [undefined, 'shell', 'language', 'language', undefined]);
      // (`regionAt` stays shell only.)
      assert.deepStrictEqual([1, 2].map((l) => regionAt(ex, l)?.start), [1, undefined]);
      assert.strictEqual(languageLines(ex), 2);
    });
    it('says a file has something to explain when it has a pattern and no shell code', () => {
      assert.ok(hasParts(extractShell('python', "import re\nre.compile('a')\n")));
      assert.ok(!hasParts(extractShell('python', 'import re\nx = 1\n')));
    });
  });

  describe('the seam: a pattern\'s line is explained by the regex reader, without a shell', () => {
    const src = "import re\nm = re.search(r'^\\d+(?P<frac>\\.\\d+)?$', s)\n";
    it('gives the pattern\'s tokens at their places in the file, under one token of the literal', () => {
      const ex = explainPy(src, 1);
      assert.strictEqual(ex.items.length, 1);
      const top = ex.items[0];
      assert.deepStrictEqual({ kind: top.kind, origin: top.origin, language: top.language, label: top.label, span: top.span },
        { kind: 'string', origin: 'embedded', language: 'regex', label: "r'^\\d+(?P<frac>\\.\\d+)?$'", span: { start: { line: 1, character: 14 }, end: { line: 1, character: 38 } } });
      assert.strictEqual(top.explanation, 'The pattern of `re.search` (Python regex)');
      const d = top.children[1];
      assert.deepStrictEqual([d.label, d.explanation, d.span, d.origin], ['\\d', 'a decimal digit of any script (`０`, `١`… too)', { start: { line: 1, character: 17 }, end: { line: 1, character: 19 } }, 'embedded']);
      assert.ok(texts(top.children).includes('(?P<frac>\\.\\d+): Named group `frac` (group 1)'));
      assert.ok(texts(top.children).includes('$: end of the text (or before a final newline)'));
      assert.deepStrictEqual(ex.context, [{ label: 'Python regex (argument of `re.search`)', line: 1 }]);
      assert.strictEqual(explainPy(src, 1, 'ja').context[0].label, 'Python の正規表現（`re.search` の引数）');
      // (No sentence, no argv: they are about bash's reading.)
      const full = explainPy(src, 1, 'en', { sentence: true, argv: true, notPosix: true });
      assert.deepStrictEqual([full.sentence, full.argv, full.notPosix, full.shell], [undefined, undefined, undefined, undefined]);
    });

    it('labels a token over two literals, or over lines, with its value: no quote or prefix in it', () => {
      const group = (src: string, line: number) => explainPy(src, line).items[0].children[0];
      assert.deepStrictEqual([group("import re\nP = re.compile(r'(a' r'b)')\n", 1)].map((t) => [t.label, t.children.map((c) => c.label)]), [['(ab)', ['ab']]]);
      assert.strictEqual(group("import re\nP = re.compile(\n    r'(a'\n    r'b)'\n)\n", 2).label, '(ab)');
      assert.strictEqual(group("import re\nP = re.compile(r'a' 'b')\n", 1).label, 'ab');
      // (Within one literal, the label is as the file writes it.)
      assert.strictEqual(group("import re\nP = re.compile('(\\\\d)' r'x')\n", 1).label, '(\\\\d)');
    });

    it('places a token of a literal that is not raw over its escape in the file', () => {
      const ex = explainPy("import re\nre.search('\\\\d\\t', s)\n", 1);
      assert.deepStrictEqual(ex.items[0].children.map((t) => [t.label, t.span.start.character, t.span.end.character]), [['\\\\d', 11, 14], ['\\t', 14, 16]]);
    });

    it('says what `match`, `fullmatch` and `prefixmatch` add', () => {
      assert.strictEqual(explainPy("import re\nre.match('a', s)\n", 1).items[0].explanation, 'The pattern of `re.match` (Python regex), matched at the start of the string');
      assert.strictEqual(explainPy("import re\nre.fullmatch('a', s)\n", 1).items[0].explanation, 'The pattern of `re.fullmatch` (Python regex), matched against the whole string');
      assert.strictEqual(explainPy("import re\nre.prefixmatch('a', s)\n", 1, 'ja').items[0].explanation, '`re.prefixmatch` のパターン（Python の正規表現）。文字列の先頭から一致する（Python 3.15 以降）');
    });

    it('explains nothing on the line without the part: another line, or the setting off for Python', () => {
      assert.deepStrictEqual(explainPy(src, 0).items, []);
      assert.deepStrictEqual(explainPy(src.replace('re.search', 'x.search'), 1).items, []);
    });

    it('gives the reading tree one root of the language, read by the function, with no bash layer', () => {
      const reading = explainPy(src, 1, 'en', { reading: true }).reading!;
      assert.deepStrictEqual([reading.layer, reading.kind, reading.label, reading.reader], ['language', 'language', 'regex', 're.search']);
      assert.deepStrictEqual(reading.children.map((n) => [n.layer, n.label, n.reader]).slice(0, 2), [['language', '^', 're.search'], ['language', '\\d', 're.search']]);
      assert.strictEqual(reading.children[3].children.length, 3);
      // (Its name is the language's, and what it is says no shell reads the line: there is no word or command around it.)
      assert.strictEqual(reading.hostLanguage, 'Python regex');
      const role = roleFor(reading, undefined, 'en')!;
      assert.deepStrictEqual([role.chip, role.band, role.said], ['Python regex', 'Python regex',
        'A language of its own in the code of the file: the function it is passed to reads it by its own rules. No shell reads this line. (a language of its own, read by re.search)']);
      assert.strictEqual(roleFor(explainPy(src, 1, 'ja', { reading: true }).reading!, undefined, 'ja')!.chip, 'Python の正規表現');
    });

    it('fences the line as Python in Markdown', () => {
      const md = toPlainMarkdown(explainPy(src, 1), "m = re.search(r'^\\d+$', s)", 'a.py:2', 'en');
      assert.ok(md.startsWith("**a.py:2**\n\n```python\nm = re.search("), md);
      assert.ok(toPlainMarkdown(explainDocumentLine(new Analyzer('en'), open("import os\nos.system('ls')\n"), 1, 'en', {}, {}), "os.system('ls')", 'a.py:2').includes('```bash\n'));
    });

    it('is one explanation for every line of a pattern over several lines, so each problem is said once', () => {
      const multi = "import re\nP = re.compile(r'''\n  \\e\n  [a-z]+\n''')\n";
      const doc = open(multi);
      const lines = [1, 2, 3, 4].map((l) => explainDocumentLine(new Analyzer('en'), doc, l, 'en', {}, {}));
      assert.ok(lines.every((ex) => ex.items[0] === lines[0].items[0] && ex.anchors === lines[0].anchors));
      assert.deepStrictEqual(lines.map((ex) => ex.line), [1, 2, 3, 4]);
      const issues = noteIssues(doc, 'en', {}, {});
      assert.deepStrictEqual(issues.map((i) => [i.code, i.severity, i.startLine, i.startCol, i.endCol]), [['regex-python-error', 'error', 2, 2, 4]]);
    });

    it('is within the line\'s boundary and budget, which counts the lines of the parts', () => {
      const doc = open("import re, os\nos.system('ls')\nre.compile(r'''a\nb''')\n");
      assert.strictEqual(doc.languageLines, 2);
      // (A line's budget is a share of the document's for each line of code: the shell's one and the pattern's two.)
      assert.ok(withinLine({ text: 'x\n' }, () => 1, 2) === 1);
    });
  });

  describe('problems', () => {
    it('makes a pattern Python refuses an Error at its place, with Python\'s message', () => {
      const doc = open("import re\nbad = re.compile(r'\\e')\n");
      const [issue, ...rest] = documentIssues(doc, 'en', {});
      assert.deepStrictEqual(rest, []);
      assert.deepStrictEqual([issue.code, issue.severity, issue.startLine, issue.startCol, issue.endCol], ['regex-python-error', 'error', 1, 19, 21]);
      assert.match(issue.message, /^ⓧ Python's `re` refuses this pattern \("bad escape \\e at position 0"\)\. Compiling it raises `re\.error` \(`re\.PatternError`\) every time$/);
      assert.ok(!('pitfall' in issue));
      const ex = explainPy("import re\nbad = re.compile(r'\\e')\n", 1);
      assert.deepStrictEqual(ex.noteInfo.map((n) => n.level), ['error']);
      assert.deepStrictEqual(ex.items[0].children[0].marks?.map((m) => [m.id, m.level]), [['regex-python-error', 'error']]);
    });

    it('turns it off by a suppression comment, as on any line', () => {
      assert.deepStrictEqual(documentIssues(open("import re\n# bash-explainer disable=regex-python-error\nbad = re.compile(r'\\e')\n"), 'en', {}), []);
    });
  });

  describe('the chip', () => {
    const src = "import re\nre.compile('a')\n";
    it('reads no shell on a pattern\'s line, and none on the other lines of a file with no shell code', () => {
      const doc = open(src);
      assert.deepStrictEqual(autoShellAt(doc, {}, 1), { language: 'regex', flavor: 'python' });
      assert.strictEqual(autoShellAt(doc, {}, 0), 'none');
      // (A file with shell code keeps its rule on a line in no part.)
      assert.deepStrictEqual(autoShellAt(open("import os\nos.system('ls')\nx = 1\n"), {}, 2), { shell: 'sh', source: 'host' });
    });
    it('words it "no shell (Python regex)" in every form', () => {
      const at = autoShellAt(open(src), {}, 1);
      assert.deepStrictEqual((['option', 'short', 'long', 'setting'] as const).map((f) => autoShellText('en', f, at)),
        ['Auto (no shell, Python regex)', 'no shell (Python regex)', 'Auto: no shell (Python regex)', 'Auto (now: no shell, Python regex)']);
      assert.deepStrictEqual((['option', 'short', 'long', 'setting'] as const).map((f) => autoShellText('ja', f, at)),
        ['自動（シェルなし、Python の正規表現）', 'シェルなし（Python の正規表現）', '自動: シェルなし（Python の正規表現）', '自動（今: シェルなし、Python の正規表現）']);
      const chip = scopeChip('en', 'File type and shell', { name: 'Python', short: 'Python' }, undefined, at);
      assert.deepStrictEqual(chip.forms.map((f) => f.chip), ['Python · no shell (Python regex)', 'Python · no shell (Python regex)', 'no shell (Python regex)', 'no shell (Python regex)']);
      assert.strictEqual(shellChoices('en', at)[0][1], 'Auto: no shell (Python regex)');
    });
  });

  it('explains the fixture of patterns line by line, and every pattern of it is a part', () => {
    const file = path.join(__dirname, 'fixtures', 'python', 'regex.py');
    const doc = open(fs.readFileSync(file, 'utf8'));
    const said = doc.lines.map((_, l) => explainDocumentLine(new Analyzer('en'), doc, l, 'en', {}, {}));
    assert.ok(doc.extracted!.languages.length >= 5);
    for (const r of doc.extracted!.languages) for (const l of r.lines) assert.ok(said[l].items.length, `line ${l + 1}`);
    // (No text of a pattern keeps an id of the catalog: `markSaid` took them all.)
    assert.ok(said.every((ex) => texts(ex.items).every((t) => readSaid(t).said.length === 0)));
  });
});
