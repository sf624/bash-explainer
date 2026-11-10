import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { Analyzer } from '../src/analyzer';
import type { LineExplanation, Token } from '../src/analyzer-types';
import { documentIssues, explainDocumentLine, type ShellDocument } from '../src/document';
import { openDocument } from '../src/document-setup';
import { failuresThrow } from '../src/failures';
import { extractShell, patternOf } from '../src/hosts';
import { readSaid } from '../src/messages-tokens';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { needPython, pythonReference } from './support/python';

// The literal of a pattern of Python's `re` (docs/design/python-regex.md, 4.3 and 5.3): the fields of an f-string as holes, with
// `re.escape` in a field, and the pitfalls of a string that is not raw. The values of the literals are held against Python's own
// `tokenize` and `ast` by test/python-lexer.test.ts (its fixtures, test/fixtures/python/pitfalls.py among them).

const parser = createUnbashParser();
const open = (src: string): ShellDocument => openDocument(src, 'python', (t) => parser.parse(t));
const explainPy = (src: string, line: number, lang: 'ja' | 'en' = 'en', opts = {}): LineExplanation => explainDocumentLine(new Analyzer(lang), open(src), line, lang, {}, opts);
const plain = (t: string) => readSaid(t).text;
const texts = (ts: readonly Token[]): string[] => ts.flatMap((t) => [`${t.label}: ${plain(t.explanation)}`, ...texts(t.children)]);
/** The rows of the pattern of the call on the second line. */
const rows = (call: string, lang: 'ja' | 'en' = 'en') => texts(explainPy(`import re\n${call}\n`, 1, lang).items);
const issues = (src: string, opts = {}) => documentIssues(open(src), 'en', {}, [], opts).map((i) => [i.code, i.severity, i.startLine, i.startCol, i.endCol]);
/** A hole character that an output of the line holds (its rows, labels, notes, reading, and the document's problems): none, as each field is shown as written. */
const holeIn = (out: unknown): string | undefined => /.{0,40}[\ufdd2-\ufdef].{0,20}/.exec(JSON.stringify(out))?.[0];
const holeShown = (doc: ShellDocument, line: number, lang: 'ja' | 'en'): string | undefined => holeIn([explainDocumentLine(new Analyzer(lang), doc, line, lang, {}, { reading: true }), documentIssues(doc, lang, {}, [], {})]);

describe('Python regex: the literal of a pattern', () => {
  describe('the fields of an f-string', () => {
    it('reads a field as a hole whose text says what holds whatever its value is, each risk once', () => {
      assert.deepStrictEqual(rows('re.search(rf"^{prefix}\\d+$", s)'), [
        'rf"^{prefix}\\d+$": The pattern of `re.search` (Python regex)',
        '^: start of the text',
        '{prefix}: The value of `{prefix}` is read as a regex: `.`, `*`, `[` and the like in the value have their special meaning. What stands around it is read as if the value were a complete regex with no group, no alternation (`|`) of its own',
        '\\d: a decimal digit of any script (`０`, `١`… too)',
        '+: repeat `\\d` one or more times',
        '$: end of the text (or before a final newline)']);
      // (A later field names the first; no newline makes two patterns, as it does for grep.)
      assert.deepStrictEqual(rows('re.search(f"({x}|{y})", s)').slice(2), [
        '{x}: The value of `{x}` is read as a regex: `.`, `*`, `[` and the like in the value have their special meaning. What stands around it is read as if the value were a complete regex with no group, no alternation (`|`) of its own',
        '|: either the left or the right side (or)', '{y}: The value of `{y}`, read like `{x}`']);
      assert.deepStrictEqual(rows('re.search(f"{x}", s)').slice(1), ['{x}: The value of `{x}` is read as a regex: `.`, `*`, `[` and the like in the value have their special meaning']);
      // (A quantifier after a field repeats the last item of its value.)
      assert.ok(rows('re.search(f"{x}+", s)').some((r) => r.startsWith('+: repeats the last item of the value of `{x}`')));
      assert.ok(rows('re.search(f"{x}", s)', 'ja')[1].startsWith('{x}: `{x}` の値は正規表現として読まれる'));
    });

    it('reads `{{` and `}}` as braces: `{{2}}` is the quantifier `{2}`', () => {
      assert.deepStrictEqual(rows('re.search(f"a{{2}}", s)').slice(1), ['a: Literal "a"', '{{2}}: `{2}`: repeat `a` exactly 2 times']);
      assert.deepStrictEqual(patternOf(extractShell('python', 'import re\nre.search(f"a{{2}}", s)\n').languages[0])!.holes, undefined);
    });

    it('reads `{re.escape(x)}` as a hole of plain text, in the pattern and in a set, by the names the file imports', () => {
      assert.deepStrictEqual(rows('re.search(f"^{re.escape(x)}[{re.escape(y)}]+$", s)').slice(2, 5), [
        '{re.escape(x)}: The value of `{re.escape(x)}`, matched as plain text (`re.escape` puts a `\\` before each character that is special in a regex)',
        '[{re.escape(y)}]: Character class: one of the characters of the value of `{re.escape(y)}`',
        '{re.escape(y)}: The characters of the value of `{re.escape(y)}` join the set (`re.escape` puts a `\\` before `]`, `-`, `^` and `\\`, so each is itself)']);
      const holes = (src: string) => Object.values(patternOf(extractShell('python', src).languages[0])!.holes!);
      assert.deepStrictEqual(holes('from re import escape, search\nsearch(f"{escape(a.b[1])}", s)\n'), [{ written: '{escape(a.b[1])}', escaped: true }]);
      assert.deepStrictEqual(holes('import re as r\nr.search(f"{r.escape(x)}", s)\n'), [{ written: '{r.escape(x)}', escaped: true }]);
      // (A conversion, a format spec, `=`, or more than the call: the value is not the escaped text.)
      for (const field of ['{re.escape(x)!r}', '{re.escape(x):>3}', '{re.escape(x)=}', '{re.escape(x) + y}', '{re.escape(x)[0]}', '{escape(x)}', '{re.escape}', '{re.escape(x)(y)}', '{(re.escape(x))}', '{re.escape[0]}', '{re.escape(x]]}']) {
        assert.deepStrictEqual(holes(`import re\nre.search(f"${field}", s)\n`).map((h) => h.escaped), [false], field);
      }
      // (A quantifier after it repeats the last character of the text.)
      assert.ok(rows('re.search(f"{re.escape(x)}+", s)').includes('+: repeats the last item of the value of `{re.escape(x)}` (a character, a set or a group), not the whole value (with an empty value, it reads as if `{re.escape(x)}` were not there)'));
      assert.ok(rows('re.search(f"[{re.escape(x)}][{re.escape(y)}]", s)').includes('{re.escape(y)}: The value of `{re.escape(y)}`, read like `{re.escape(x)}`'));
      // (Said once on the line: a later one names the first.)
      assert.ok(rows('re.search(f"{re.escape(x)}-{re.escape(y)}", s)').includes('{re.escape(y)}: The value of `{re.escape(y)}`, read like `{re.escape(x)}`'));
    });

    it('stands each hole at its field, and keeps the field in the labels', () => {
      const p = patternOf(extractShell('python', 'import re\nre.search(f"a{x}b", s)\n').languages[0])!;
      assert.deepStrictEqual([p.value.length, Object.values(p.holes!), p.at[1], p.to[1]], [3, [{ written: '{x}', escaped: false }], { line: 1, character: 13 }, { line: 1, character: 16 }]);
      assert.deepStrictEqual(explainPy('import re\nre.search(f"a{x}b", s)\n', 1).items[0].children.map((t) => [t.label, t.span.start.character, t.span.end.character]), [['a', 12, 13], ['{x}', 13, 16], ['b', 16, 17]]);
      // (A token over the join of two literals is labelled with its value, each field in it as written.)
      assert.strictEqual(rows('re.search(f"[{x}" "]", s)')[1], '[{x}]: Character class: one of the characters of the value of `{x}`');
      assert.strictEqual(rows('re.search(f"(a{x}" f"b)", s)')[1], '(a{x}b): Group 1: treats its contents as one unit (`\\1` refers to what it matched)');
      for (const call of ['re.search(f"[{x}" "]", s)', 're.search(f"(a{x}" f"b)", s)', 're.search(f"(a{x}" f"b{y}\\1)", s)', 're.search(f"a{{{n}}}" "b", s)']) {
        for (const lang of ['en', 'ja'] as const) assert.strictEqual(holeShown(open(`import re\n${call}\n`), 1, lang), undefined, call);
      }
    });

    it('says where `re.VERBOSE` is on, or not known, that whitespace and a `#` in a value are read as the pattern\'s, once on the line', () => {
      const verbose = 'With `re.VERBOSE`, whitespace in the value is ignored, and a `#` in it comments out the rest of its line';
      assert.deepStrictEqual(rows('re.search(rf"(?x) a {x} b {y}", s)').filter((r) => r.startsWith('{')), [
        `{x}: The value of \`{x}\` is read as a regex: \`.\`, \`*\`, \`[\` and the like in the value have their special meaning. ${verbose}. What stands around it is read as if the value were a complete regex with no group, no alternation (\`|\`) of its own`,
        '{y}: The value of `{y}`, read like `{x}`']);
      assert.ok(rows('re.compile(f"a{x}", re.X)').some((r) => r.includes(verbose)));
      assert.ok(rows('re.compile(f"(?x:{x})", s)').some((r) => r.includes(verbose)));
      assert.ok(rows('re.search(f"a{x}", s, flags)').some((r) => r.includes('If `re.VERBOSE` is on (the flags are not known), whitespace in the value is ignored')));
      assert.ok(rows('re.search(f"a{x}", s, re.X)', 'ja').some((r) => r.includes('`re.VERBOSE` なので、値の中の空白は無視され、値の中の `#` からその行の終わりまではコメントになる')));
      // (Not without it, nor in a set, where VERBOSE reads whitespace and `#` as themselves, nor for `re.escape`, which escapes both.)
      for (const call of ['re.search(f"a{x}", s)', 're.search(f"(?x)[{x}]", s)', 're.search(f"(?x){re.escape(x)}", s)', 're.search(f"{re.escape(x)}", s, flags)']) {
        assert.ok(!rows(call).some((r) => /VERBOSE`, whitespace in the value|VERBOSE` is on/.test(r)), call);
      }
    });

    it('leaves a pattern unread where a field decides how it reads, as a shell word with such a value', () => {
      for (const [call, field] of [['re.search(f"a{{{n}}}", s)', '`{n}`'], ['re.search(f"[{a}-z]", s)', '`{a}`'], ['re.search(rf"\\x{h}", s)', '`{h}`'], ['re.search(f"({x}", s)', '`{x}`']]) {
        const [top] = explainPy(`import re\n${call}\n`, 1).items;
        assert.deepStrictEqual([plain(top.explanation), top.children], [`The pattern of \`re.search\` (Python regex); not read here, as how it reads depends on the value of ${field}`, []], call);
      }
      assert.match(plain(explainPy('import re\nre.search(f"a{{{n}}}", s)\n', 1, 'ja').items[0].explanation), /`\{n\}` の値によって読み方が変わるので、ここでは読まない$/);
      // (A field the reader passes over, in a VERBOSE comment, is not claimed either.)
      assert.match(plain(explainPy('import re\nre.compile(f"a # {x}", re.X)\n', 1).items.find((t) => t.language)!.explanation), /depends on the value of `\{x\}`$/);
      // (Nor is it an Error: what Python refuses may be the value's to mend.)
      assert.deepStrictEqual(issues('import re\nre.search(f"({x}", s)\n'), []);
    });

    it('reads no field outside the pattern, nor a pattern with a `\\N{…}` escape, more fields than holes, or a hole character of its own', () => {
      const ex = extractShell('python', 'import re\nre.sub(f"{a}", f"{b}", f"{c}")\n').languages[0];
      assert.deepStrictEqual(ex.args.map((a) => [a.role, !!a.literal]), [['pattern', true], ['repl', false], ['string', false]]);
      const fields = Array.from({ length: 31 }, (_, k) => `{x${k}}`).join('');
      for (const call of [`re.search(f"${fields}", s)`, 're.search(f"{x}\\N{BULLET}", s)', 're.search("a\\ufdd2", s)']) {
        assert.deepStrictEqual(extractShell('python', `import re\n${call}\n`).languages, [], call);
      }
      assert.strictEqual(extractShell('python', `import re\nre.search(f"${fields.slice(0, -5)}", s)\n`).languages.length, 1);
    });
  });

  describe('the escapes of a string that is not raw', () => {
    it('warns that `\\b` is a backspace, once, at the first one outside a set', () => {
      const src = 'import re\nre.search("\\bword\\b", s)\n';
      assert.deepStrictEqual(issues(src), [['python-regex-string-backspace', 'warning', 1, 11, 13]]);
      const note = explainPy(src, 1).noteInfo.find((n) => n.code === 'python-regex-string-backspace')!;
      assert.match(note.text, /In a string without `r`, `\\b` is a backspace \(U\+0008\): the pattern matches a backspace character there, not a word boundary/);
      assert.match(explainPy(src, 1, 'ja').noteInfo[0].text, /`\\b` はバックスペース（U\+0008）になる/);
      // (An f-string and bytes too; in a set, `[\b]` is a backspace to the regex as well.)
      assert.deepStrictEqual(issues('import re\nre.search(f"\\b{w}", s)\nre.search(b"\\b", s)\n').map((i) => i[0]), ['python-regex-string-backspace', 'python-regex-string-backspace']);
      assert.deepStrictEqual(issues('import re\nre.search(f"[\\b]{w}[^\\b]", s)\n'), []);
      assert.deepStrictEqual(issues('import re\nre.search("[a\\b]x\\b", s)\n'), [['python-regex-string-backspace', 'warning', 1, 17, 19]]);
      // (Nor in a pattern not read, whose sets are not known.)
      assert.deepStrictEqual(issues('import re\nre.search(f"\\b{{{n}}}", s)\n'), []);
      // (Not raw strings, nor a backspace written otherwise, nor `\\b`.)
      assert.deepStrictEqual(issues('import re\nre.search(r"\\bw\\b", s)\nre.search(rf"\\b{w}", s)\nre.search("\\x08\\\\b", s)\n'), []);
    });

    it('warns that an octal escape of one or two digits is a character, not a reference to a group', () => {
      assert.deepStrictEqual(issues('import re\nre.search("(a)\\1", s)\n'), [['python-regex-string-octal', 'warning', 1, 14, 16]]);
      const note = (call: string) => explainPy(`import re\n${call}\n`, 1).noteInfo.find((n) => n.code === 'python-regex-string-octal')!.text;
      assert.match(note('re.search("(a)\\1", s)'), /`\\1` is the character U\+0001: the pattern matches that character there, not what group 1 matched/);
      assert.match(note('re.search("\\12", s)'), /`\\12` is the character U\+000A: .* not what group 12 matched/);
      // (A regex reads `\0`, `\012` and three digits as octal too, and a set has no references.)
      assert.deepStrictEqual(issues('import re\nre.search("\\0\\012\\101[\\1]", s)\nre.search(r"(a)\\1", s)\n'), []);
    });

    it('says the pitfalls through the setting, as a shell line says its own', () => {
      assert.deepStrictEqual(issues('import re\nre.search("\\bw", s)\n', { pitfalls: false }), []);
    });

    it('says on the pattern that the string keeps a backslash that starts no escape, without a problem (Python warns of it)', () => {
      const src = 'import re\nre.match("\\d+\\.\\d", s)\n';
      assert.deepStrictEqual(issues(src), []);
      assert.strictEqual(plain(explainPy(src, 1).items[0].explanation), 'The pattern of `re.match` (Python regex), matched at the start of the string. The string keeps `\\d`, `\\.` as written (Python\'s strings have no such escape, and Python 3.12 and later warn: SyntaxWarning; a raw string, `r"…"`, keeps each backslash with no warning)');
      assert.match(plain(explainPy(src, 1, 'ja').items[0].explanation), /。文字列は `\\d`・`\\.` をそのまま残す（Python の文字列にこのエスケープはないので、Python 3\.12 以降は SyntaxWarning が出る/);
      // (Not in a raw string, nor where the backslash is an escape; nor an incomplete `\x`, which Python refuses.)
      for (const call of ['re.match(r"\\d", s)', 're.match("\\\\d", s)', 're.match("\\x4", s)', 're.match(b"\\x4", s)']) {
        assert.doesNotMatch(plain(explainPy(`import re\n${call}\n`, 1).items[0].explanation), /keeps/, call);
      }
      // (In bytes, `\u` starts no escape.)
      assert.match(plain(explainPy('import re\nre.match(b"\\u", s)\n', 1).items[0].explanation), /keeps `\\u`/);
      // (Before a field, the string keeps the backslash, and Python warns of `"\{"`: the field is still replaced.)
      assert.match(plain(explainPy('import re\nre.match(f"\\{x}", s)\n', 1).items[0].explanation), /The string keeps `\\\{` as written/);
      assert.match(plain(explainPy('import re\nre.match("\\😀", s)\n', 1).items[0].explanation), /The string keeps `\\😀` as written/);
    });
  });
});

describe('Python regex: the calls of the standard library', function () {
  this.timeout(300000);
  const ref = pythonReference();
  let lib = '';
  let throwing = false;
  before(function () {
    needPython(this, ref);
    if ('skip' in ref) return;
    const r = spawnSync(ref.python, ['-I', '-c', "import sysconfig; print(sysconfig.get_paths()['stdlib'])"], { encoding: 'utf8', timeout: 20000 });
    lib = r.stdout.trim();
    throwing = failuresThrow(true);
  });
  after(() => failuresThrow(throwing));

  it('reads every call of `re` with a literal pattern without reaching a failure boundary', () => {
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) walk(path.join(dir, e.name));
        else if (e.name.endsWith('.py')) files.push(path.join(dir, e.name));
      }
    };
    walk(lib);
    let patterns = 0;
    let fields = 0;
    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8');
      // (The extractor returns early without an import of `re`; the others are read for the subprocess calls, elsewhere.)
      if (!src.includes('re')) continue;
      const doc = open(src);
      for (const region of doc.extracted!.languages) {
        const p = patternOf(region);
        if (p) patterns++;
        if (p?.holes) fields++;
        for (const lang of ['en', 'ja'] as const) {
          const ex = explainDocumentLine(new Analyzer(lang), doc, region.lines[0], lang, {}, { reading: true });
          assert.ok(!ex.noteInfo.some((n) => n.code === 'line-not-explained' || n.code === 'example-failed'), `${file}:${region.lines[0] + 1}`);
          if (p?.holes) assert.strictEqual(holeIn(ex), undefined, `${file}:${region.lines[0] + 1}`);
        }
      }
      if (doc.extracted!.languages.some((r) => patternOf(r)?.holes)) assert.strictEqual(holeIn(documentIssues(doc, 'en', {}, [], {})), undefined, file);
    }
    // (Not pinned: the counts change with the release.)
    assert.ok(patterns > 100 && fields > 0, `${patterns} patterns, ${fields} with fields`);
  });
});
