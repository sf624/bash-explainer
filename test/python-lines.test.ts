import * as assert from 'assert';
import { Analyzer } from '../src/analyzer';
import type { ExplainOptions, LineExplanation, Token } from '../src/analyzer-types';
import { documentIssues, explainDocumentLine, noteIssues, type ShellDocument } from '../src/document';
import { openDocument } from '../src/document-setup';
import { extractShell, hostPartAt, languageLines, patternOf } from '../src/hosts';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { partAt } from '../src/ui/hoverParts';
import { toPlainMarkdown } from '../src/ui/render';

// A line of a `.py` file with several calls of `re` (#813; docs/design/python-regex.md, 2.2): every call that has the line is
// explained on it, as a shell line of several commands: a token for each call, with its pattern, template and arguments under it,
// and a call in its arguments too, in the order written; each call's examples, titled with the call, and its problems.

const parser = createUnbashParser();
const open = (src: string): ShellDocument => openDocument(src, 'python', (t) => parser.parse(t));
const explain = (doc: ShellDocument, line: number, lang: 'ja' | 'en' = 'en', opts: ExplainOptions = {}): LineExplanation => explainDocumentLine(new Analyzer(lang), doc, line, lang, {}, opts);
/** The rows of a line, as the CLI prints them: each token's label and text, indented by its depth. */
const rows = (ts: readonly Token[], depth = 0): string[] => ts.flatMap((t) => [`${'  '.repeat(depth)}${t.label}  ${t.explanation}`, ...rows(t.children, depth + 1)]);
/** The calls of a file that have each line: the function as written and the pattern's value. */
const callsOn = (src: string) => {
  const ex = extractShell('python', `import re\n${src}`);
  return src.split('\n').map((_, l) => {
    const part = hostPartAt(ex, l + 1);
    return part?.kind === 'language' ? part.regions.map((r) => `${r.call.written} ${patternOf(r)?.value ?? '-'}`) : [];
  });
};

describe('Python regex: a line of several calls', () => {
  it('explains both calls of a nested `re.sub`, each with its parts under it, the inner call under the outer', () => {
    const doc = open("import re\nx = re.sub(r'a+', '-', re.sub(r'\\d', 'a', s), flags=re.I)\n");
    const ex = explain(doc, 1);
    assert.deepStrictEqual(rows(ex.items), [
      "re.sub  a call of Python's `re.sub`",
      "  r'a+'  The pattern of `re.sub` (Python regex)",
      '    a  Literal "a", in either case',
      '    +  repeat `a` one or more times',
      "  re.sub  a call of Python's `re.sub`",
      "    r'\\d'  The pattern of `re.sub` (Python regex)",
      '      \\d  a decimal digit of any script (`０`, `١`… too)',
      '  re.I  `re.I` (`re.IGNORECASE`): letters match in either case',
    ]);
    assert.deepStrictEqual(ex.items[0].span, { start: { line: 1, character: 4 }, end: { line: 1, character: 57 } });
    assert.deepStrictEqual(ex.context, [{ label: 'Python regex', line: 1 }]);
    // (Each call's example, its title naming the call, as on a shell line of several commands.)
    assert.deepStrictEqual(ex.examples.map((e) => [e.title, e.anchor!.start.character]), [
      ["Example for `re.sub(r'a+', '-', re.sub(r'\\d', 'a', s…`", 11], ["Example for `re.sub(r'\\d', 'a', s)`", 30]]);
    assert.deepStrictEqual(explain(doc, 1, 'ja').items.map((t) => t.explanation), ['Python の `re.sub` の呼び出し']);
    // (The hover at the inner pattern finds it under both calls.)
    assert.deepStrictEqual(partAt(ex.items, { line: 1, character: 32 }).map((t) => t.label), ['re.sub', 're.sub', "r'\\d'", '\\d']);
    // (Markdown shows both patterns.)
    const md = toPlainMarkdown(ex, doc.lines[1], 'a.py:2', 'en');
    assert.ok(md.includes("r'a+'") && md.includes("r'\\d'"), md);
  });

  it('explains two calls joined by `or`, functions or methods of compiled patterns, each with its examples', () => {
    const functions = explain(open("import re\nok = re.match(r'a', s) or re.search(r'b', s)\n"), 1);
    assert.deepStrictEqual(functions.items.map((t) => [t.label, t.children.map((c) => c.label)]), [['re.match', ["r'a'"]], ['re.search', ["r'b'"]]]);
    assert.deepStrictEqual(functions.examples.map((e) => e.title), ["Example for `re.match(r'a', s)` (`re.match` matches at the start of the string)", "Example for `re.search(r'b', s)`"]);
    const methods = explain(open("import re\nP = re.compile(r'x')\nQ = re.compile(r'y')\nif P.match(s) or Q.search(s, 2): pass\n"), 3);
    assert.deepStrictEqual(rows(methods.items), [
      "P.match  the method `match` of the pattern `r'x'` (Python regex), compiled into `P` on line 2; matched at the start of the string (at `pos`)",
      "Q.search  the method `search` of the pattern `r'y'` (Python regex), compiled into `Q` on line 3",
      '  2  The argument `pos` (`2`): the search starts at this index. Unlike a slice of the string, `^` and `\\A` match at its real start only, and a lookbehind and `\\b` see the characters before it',
    ]);
    // (A method's token is on the whole call, so that its arguments are under it.)
    assert.deepStrictEqual(methods.items.map((t) => [t.span.start.character, t.span.end.character]), [[3, 13], [17, 31]]);
    // (`Q.search(s, 2)` with a subject not known has no example: test/python-examples.test.ts.)
    assert.deepStrictEqual(methods.examples.map((e) => e.title), ['Example for `P.match(s)` (`P.match` matches at the start of the string)']);
    const both = explain(open("import re\nP = re.compile(r'x')\nQ = re.compile(r'y')\nP.sub('-', 'axa') or Q.sub('-', 'aya')\n"), 3);
    assert.deepStrictEqual(both.examples.map((e) => [e.title, e.sections[1].lines[0]]), [["Example for `P.sub('-', 'axa')`", "'a-a'"], ["Example for `Q.sub('-', 'aya')`", "'a-a'"]]);
  });

  it('gives each line of a call over two lines its part, and both calls to its last line where another call is', () => {
    const src = "y = re.sub(r'a', 'b',\n  s) or re.match(r'e', t)";
    assert.deepStrictEqual(callsOn(src), [['re.sub a'], ['re.sub a', 're.match e']]);
    const doc = open(`import re\n${src}\n`);
    const [first, last] = [1, 2].map((l) => explain(doc, l));
    // (The first line: the one call, as a line of one call is; the last: both, the first call's tokens the same objects.)
    assert.deepStrictEqual(first.items.map((t) => t.label), ["r'a'"]);
    assert.deepStrictEqual(first.context, [{ label: 'Python regex (argument of `re.sub`)', line: 1 }]);
    assert.deepStrictEqual(last.items.map((t) => [t.label, t.children.map((c) => c.label)]), [['re.sub', ["r'a'"]], ['re.match', ["r'e'"]]]);
    assert.strictEqual(last.items[0].children[0], first.items[0]);
    assert.deepStrictEqual(last.context, [{ label: 'Python regex', line: 1 }]);
    // (A nested call over two lines: each line shows its own pattern, as before.)
    assert.deepStrictEqual(callsOn("x = re.sub(r'a', 'b',\n  re.sub(r'c', 'd', s))"), [['re.sub a'], ['re.sub c']]);
  });

  it('gives both compiles of one line their pattern rows, and links a method to its own compile', () => {
    const src = "import re\nA = re.compile(r'a'); B = re.compile(r'(b)')\nB.sub(r'<\\1>', s)\n";
    const doc = open(src);
    const ex = explain(doc, 1);
    assert.deepStrictEqual(ex.items.map((t) => [t.label, t.children.map((c) => c.label)]), [['re.compile', ["r'a'"]], ['re.compile', ["r'(b)'"]]]);
    const method = explain(doc, 2);
    assert.match(method.items[0].explanation, /the pattern `r'\(b\)'` \(Python regex\), compiled into `B` on line 2/);
    // (Its template's group is the pattern of `B`'s: no Error.)
    assert.deepStrictEqual(documentIssues(doc, 'en', {}), []);
  });

  it('shows the problems of each call: an Error in the second pattern of a line, each once', () => {
    const doc = open("import re\nx = re.sub(r'a', 'b',\n  s) or re.match(r'e(', t) or re.search(r'\\q', u)\n");
    assert.deepStrictEqual(documentIssues(doc, 'en', {}).map((i) => [i.code, i.startLine, i.startCol, i.endCol]), [['regex-python-error', 2, 20, 21], ['regex-python-error', 2, 42, 44]]);
    const ex = explain(doc, 2);
    assert.deepStrictEqual(ex.noteInfo.map((n) => n.level), ['error', 'error']);
    assert.strictEqual(ex.notes.length, new Set(ex.notes).size);
    // (A note two calls give is said once on the line; its anchors are each call's.)
    const same = explain(open("import re\nre.sub(r'a', 'b', s, re.I) or re.split(r'c', s, re.I)\n"), 1);
    assert.deepStrictEqual([same.notes.length, same.anchors!.length], [2, 2]);
    const twice = explain(open("import re\nre.match(r'(', s) or re.match(r'(', t)\n"), 1);
    assert.deepStrictEqual([twice.notes.length, twice.anchors!.map((a) => a.span.start.character)], [1, [11, 32]]);
    assert.strictEqual(noteIssues(open("import re\nre.match(r'(', s) or re.match(r'(', t)\n"), 'en', {}, {}).length, 2);
  });

  it('gives the line one reading root over the calls\' readings, each node read by its own call', () => {
    const { reading } = explain(open("import re\nre.match(r'a', s) or re.search(r'b', s)\n"), 1, 'en', { reading: true });
    assert.deepStrictEqual([reading!.layer, reading!.kind, reading!.reader, reading!.hostLanguage], ['language', 'language', 're.match, re.search', 'Python regex']);
    assert.deepStrictEqual(reading!.children.map((n) => [n.label, n.reader]), [['a', 're.match'], ['b', 're.search']]);
    // (Its range is from the first pattern to the end of the last, on another line too.)
    const over = explain(open("import re\nre.match(r'a',\n  s) or re.search(r'b', s)\n"), 2, 'en', { reading: true }).reading!;
    assert.deepStrictEqual([over.span.start, over.span.end], [{ line: 1, character: 9 }, { line: 2, character: 22 }]);
    // (One call with a reading: its own.)
    const one = explain(open("import re\nP = re.compile(r'x')\nre.match(r'a', s) or P.match(s)\n"), 2, 'en', { reading: true });
    assert.strictEqual(one.reading!.reader, 're.match');
  });

  it('explains each call with a budget of its own: a line shows the same whichever line asked first', () => {
    // (Calls whose examples each cost all a run may, more than a line has for three: the first over two lines, two more and a cheap
    // one beside it on its last line. Asked first, that line would leave the cheap one nothing if the calls shared its budget.)
    const slow = `re.search(r'(a+)+b', '${'a'.repeat(30)}')`;
    const src = `import re\ny = re.search(r'(a+)+b',\n  '${'a'.repeat(30)}') or ${slow} or ${slow} or re.findall(r'\\d', '1a2')\n`;
    const shown = (order: number[]) => {
      const doc = open(src);
      const got = new Map(order.map((l) => [l, explain(doc, l)]));
      return [got.get(1)!.examples, got.get(2)!.examples];
    };
    const [first, last] = shown([2, 1]);
    assert.deepStrictEqual(shown([1, 2]), [first, last]);
    assert.deepStrictEqual(last.map((e) => (e.sections.length ? e.sections[1].lines[0] : e.note)), [first[0].note, first[0].note, first[0].note, "['1', '2']"]);
    // (The budget counts a shared line once for each call that has it.)
    assert.strictEqual(languageLines(extractShell('python', src)), 5);
  });
});
