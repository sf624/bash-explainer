import * as assert from 'assert';
import { Analyzer } from '../src/analyzer';
import type { LineExplanation, Token } from '../src/analyzer-types';
import { documentIssues, explainDocumentLine, type ShellDocument } from '../src/document';
import { openDocument } from '../src/document-setup';
import { readTemplate, type TemplateGroups, templateTokens } from '../src/embedded/regex-template';
import { extractShell } from '../src/hosts';
import { readSaid } from '../src/messages-tokens';
import { createUnbashParser } from '../src/syntax/adapters/unbash';

// The replacement templates of `re.sub` and `re.subn`, and the methods of a compiled pattern linked to its `re.compile`
// (docs/design/python-regex.md, 5.1 and 6; #752). Python's own results are held by test/python-examples.test.ts (the examples)
// and test/regex-python-real.test.ts (the refusals of a template); here, what the reader and the link give.

const parser = createUnbashParser();
const open = (src: string): ShellDocument => openDocument(src, 'python', (t) => parser.parse(t));
const explainPy = (src: string, line: number, lang: 'ja' | 'en' = 'en'): LineExplanation => explainDocumentLine(new Analyzer(lang), open(src), line, lang, {}, {});
const plain = (t: string) => readSaid(t).text;
const texts = (ts: readonly Token[]): string[] => ts.flatMap((t) => [`${t.label}: ${plain(t.explanation)}`, ...texts(t.children)]);
const groups = (count: number, names: Record<string, number> = {}): TemplateGroups => ({ count, names: new Map(Object.entries(names)) });

/** The calls of a file linked to a compile: each method's name, and the line of its `re.compile` (0-based). */
const linked = (src: string): [string, number][] => extractShell('python', `import re\n${src}`).languages.flatMap((r) => (r.compiled ? [[r.call.written, r.compiled.line] as [string, number]] : []));

describe('Python regex: the replacement template', () => {
  it('reads groups by number and by name, the whole match, escapes, and text, into the parts Python applies', () => {
    const t = readTemplate('\\2 at \\g<user>\\g<0>\\n\\\\\\101\\-x', groups(2, { user: 1 }), false);
    assert.deepStrictEqual(t.parts, [2, ' at ', 1, 0, '\n\\A\\-x']);
    assert.deepStrictEqual(t.items.map((i) => i.kind), ['group', 'text', 'group', 'group', 'char', 'char', 'char', 'kept', 'text']);
    // (Two digits are one group, three octal digits a character, `\0` a character with up to two more.)
    assert.deepStrictEqual(readTemplate('\\10\\101\\08\\012', groups(10), false).parts, [10, 'A\x008\n']);
  });

  it('refuses what Python refuses, at the escape, and applies nothing then', () => {
    const refusal = (src: string, g = groups(1)) => {
      const t = readTemplate(src, g, false);
      const e = t.items.find((i) => i.kind === 'error');
      return [e && 'message' in e ? [e.message, e.raises, src.slice(e.start, e.end)] : undefined, t.parts];
    };
    assert.deepStrictEqual(refusal('a\\2'), [['invalid group reference 2 at position 2', 're.error', '\\2'], undefined]);
    assert.deepStrictEqual(refusal('\\g<x>', groups(1, { n: 1 })), [["unknown group name 'x'", 'IndexError', '\\g<x>'], undefined]);
    assert.deepStrictEqual(refusal('ab\\'), [['bad escape (end of pattern) at position 2', 're.error', '\\'], undefined]);
    assert.deepStrictEqual(refusal('\\q'), [['bad escape \\q at position 0', 're.error', '\\q'], undefined]);
  });

  it('checks no group where the pattern\'s are not known, and applies nothing', () => {
    const t = readTemplate('\\7\\g<n>', undefined, false);
    assert.deepStrictEqual([t.items, t.parts], [[{ start: 0, end: 2, kind: 'group', group: 7 }, { start: 2, end: 7, kind: 'group', name: 'n' }], undefined]);
    assert.deepStrictEqual(texts(explainPy('import re\nre.sub(r\'(?P<é>a)\', r\'\\2\', s)\n', 1).items).filter((t) => t.includes('refuses')), []);
  });

  it('claims a field of an f-string as text of the template, and stops where its value would be read with an escape', () => {
    const hole = '\ufdd2';
    assert.deepStrictEqual(readTemplate(`a${hole}\\1`, groups(1), false).items.map((i) => i.kind), ['text', 'hole', 'group']);
    for (const src of [`\\${hole}`, `\\1${hole}`, `\\g${hole}`, `\\g<${hole}>`, `\\g<a\\${hole}>`, `\\01${hole}`, `\\12${hole}`]) {
      const t = readTemplate(src, groups(12), false);
      assert.deepStrictEqual([t.items.at(-1)!.kind, t.parts], ['stop', undefined], src);
    }
    // (`\19`: no third octal digit can follow, and a field after `\012` is text.)
    assert.deepStrictEqual(readTemplate(`\\19${hole}\\012${hole}`, groups(19), false).items.map((i) => i.kind), ['group', 'hole', 'char', 'hole']);
  });

  it('says each refusal in Python\'s words, at Python\'s position', () => {
    const message = (src: string, g: TemplateGroups | null = groups(1), bytes = false) => {
      const e = readTemplate(src, g ?? undefined, bytes).items.find((i) => i.kind === 'error');
      return e && 'message' in e ? e.message : undefined;
    };
    assert.deepStrictEqual(['\\g<1 >', '\\g<-1>', '\\g<', '\\g<>', '\\g1', '\\', '\\x41', '\\400', '\\10', '\\g<a', '\\g<100000000000000000000>', '\\g<007>', '\\9\\'].map((src) => message(src)), [
      "bad character in group name '1 ' at position 3", "bad character in group name '-1' at position 3", 'missing group name at position 3', 'missing group name at position 3',
      'missing < at position 2', 'bad escape (end of pattern) at position 0', 'bad escape \\x at position 0', 'octal escape value \\400 outside of range 0-0o377 at position 0',
      'invalid group reference 10 at position 1', 'missing >, unterminated name at position 3', 'invalid group reference 100000000000000000000 at position 3',
      'invalid group reference 7 at position 3', 'bad escape (end of pattern) at position 2',
    ]);
    // (A bytes template writes a name past ASCII as `%a` does; where the groups are not known, a number or a name is no error.)
    assert.deepStrictEqual([message('\\g<\xe9>', groups(1), true), message('\\g<\xe9x>', groups(1)), message('\\g<99>\\g<x>', null)], [
      "bad character in group name '\\xe9' at position 3", "unknown group name 'éx'", undefined]);
  });

  it('has no tokens for plain text, which Python puts in as it is', () => {
    assert.deepStrictEqual(templateTokens('a b', readTemplate('a b', groups(0), false), 'en'), []);
  });
});

describe('Python regex: the replacement on the line of `re.sub`', () => {
  it('explains each part of the template under the replacement, and says the error of a group the pattern lacks', () => {
    const src = 'import re\nre.sub(r\'(\\w+)@(?P<h>\\w+)\', r\'\\2 at \\g<h>\\3\', s)\n';
    const ex = explainPy(src, 1);
    const repl = ex.items.find((t) => t.label === "r'\\2 at \\g<h>\\3'")!;
    assert.deepStrictEqual(texts([repl]), [
      "r'\\2 at \\g<h>\\3': The replacement of `re.sub`: it takes the place of each match. Python reads its backslashes as a template (`\\1` and `\\g<name>` put in what a group matched)",
      '\\2: what group 2 matched (nothing where the group did not take part)', ' at: The text `  at  `, put in as it is',
      '\\g<h>: what the group `h` (group 2) matched (nothing where the group did not take part)',
      '\\3: Python\'s `re` refuses this replacement ("invalid group reference 3 at position 12"; it raises `re.error`)',
    ]);
    assert.deepStrictEqual(repl.children.map((c) => c.group), [2, undefined, 2, undefined]);
    assert.deepStrictEqual(documentIssues(open(src), 'en', {}).map((i) => [i.severity, i.startLine, i.startCol, i.head]), [['error', 1, 41, 'This replacement is not valid: the call raises an error every time it runs.']]);
    assert.deepStrictEqual(ex.examples, []);
    assert.match(texts(explainPy(src, 1, 'ja').items).join('\n'), /\\g<h>: グループ `h`（グループ 2）に一致した文字列（グループが一致に加わらなかったときは空文字）/);
  });

  it('gives no token to a plain replacement, and says the pitfall of an octal escape of a string that is not raw', () => {
    assert.deepStrictEqual(texts(explainPy('import re\nre.sub(r\'\\s+\', \' \', s)\n', 1).items).filter((t) => t.startsWith("' '")), []);
    const ex = explainPy('import re\nre.sub(r\'(a)\', \'<\\1>\', s)\n', 1);
    assert.deepStrictEqual(ex.notes.map((n) => n.replace(/^\S+ /, '')), ['Pitfall: In a string without `r`, `\\1` is the character U+0001: the replacement puts in that character, not what group 1 matched. Write it as a raw string, `r"…"` (or `\\\\1`).']);
    assert.deepStrictEqual(ex.facts?.map((f) => f.id), ['python-template-string-octal']);
  });

  it('checks the groups of a template only where no field of the pattern may add one', () => {
    const refused = (src: string) => texts(explainPy(`import re\n${src}\n`, 1).items).filter((t) => t.includes('refuses'));
    assert.deepStrictEqual(refused("re.sub(rf'({x})', r'\\2', s)"), []);
    assert.deepStrictEqual(refused("re.sub(rf'{re.escape(x)}(a)', r'\\2', s)").length, 1);
    // (A group by name, where the groups are not known, is said by its name only; a blank between two groups is named.)
    assert.deepStrictEqual(texts(explainPy("import re\nre.sub(r'(?P<é>a)(?P<n>b)', r'\\g<n> \\1', s)\n", 1).items).slice(-3), [
      '\\g<n>: what the group `n` matched (nothing where the group did not take part)', ': The text ` ` (a space), put in as it is',
      '\\1: what group 1 matched (nothing where the group did not take part)']);
    // (A replacement with a field and no backslash is a template too, as the value may hold one.)
    assert.match(texts(explainPy("import re\nre.sub(r'a', f'{x}', s)\n", 1).items).join('\n'), /^f'\{x\}': The replacement of `re.sub`: it takes the place of each match\n\{x\}: The value of `\{x\}` goes into the replacement/m);
  });

  it('reads a field of an f-string in the template with the catalog\'s text, or leaves the template unread where it decides', () => {
    assert.match(texts(explainPy('import re\nre.sub(r\'(a)\', f\'{x}\\\\1\', s)\n', 1).items).join('\n'), /\{x\}: The value of `\{x\}` goes into the replacement: Python reads a `\\` in it as part of the template/);
    assert.match(texts(explainPy('import re\nre.sub(r\'(a)\', f\'\\\\{x}\', s)\n', 1).items).join('\n'), /The replacement of `re.sub`: .*; not read here, as how it reads depends on the value of `\{x\}`/);
  });
});

describe('Python regex: the methods of a compiled pattern', () => {
  it('links a name bound once to `re.compile` with a literal pattern, at the top of the file or in a function', () => {
    assert.deepStrictEqual(linked("P = re.compile(r'a')\nP.sub('b', s)\nx = P.findall(s)\n"), [['P.sub', 1], ['P.findall', 1]]);
    assert.deepStrictEqual(linked("P = re.compile(r'a')\ndef f(s):\n    return P.search(s)\n"), [['P.search', 1]]);
    assert.deepStrictEqual(linked("def f(s):\n    P = re.compile(r'a')\n    def g():\n        return P.match(s)\n    return P.split(s)\n"), [['P.match', 2], ['P.split', 2]]);
    assert.deepStrictEqual(linked("class C:\n    def m(self, s):\n        P = re.compile(r'a')\n        return P.search(s)\nasync def f(s):\n    Q = re.compile(r'b')\n    return Q.search(s)\n"), [['P.search', 3], ['Q.search', 6]]);
    assert.deepStrictEqual(linked("P = re.compile(r'a');\nif s in t:\n    P.search(s)\nP.groups(s)\n"), [['P.search', 1]]);
    // (After a `;` too, and on the line of the compile, which has both calls: #813.)
    assert.deepStrictEqual(linked("x = 1; P = re.compile(r'a')\nP.search(s)\n"), [['P.search', 1]]);
    assert.deepStrictEqual(linked("P = re.compile(r'a'); P.search(s)\n"), [['P.search', 1]]);
    // (The blocks as their lines nest them: a function of one line, blocks that end together, one that ends with the file.)
    assert.deepStrictEqual(linked("def f(s): P = re.compile(r'a'); return P.search(s)\nP.search(s)\n"), []);
    assert.deepStrictEqual(linked("def f(s):\n    class C:\n        def m(self):\n            P = re.compile(r'a')\n            return P.search(s)\n    return P.search(s)\nP.search(s)\n"), [['P.search', 4]]);
    assert.deepStrictEqual(linked("P.search(s)\nclass C:\n    def m(self):\n        return P.search(s)\n    x = P.search(s)\nP = re.compile(r'a')\nP.split(s)\ndef g():\n    if s:\n        return P.match(s)\n"), [['P.search', 6], ['P.split', 6], ['P.match', 6]]);
  });

  it('links no name assigned twice, shadowed in a function, or bound otherwise', () => {
    for (const src of [
      "P = re.compile(r'a')\nP = re.compile(r'b')\nP.sub('c', s)\n", "P = re.compile(r'a')\ndef f():\n    P = None\nP.sub('c', s)\n",
      "P = re.compile(r'a')\ndef f(P):\n    return P.search(s)\n", "P = re.compile(r'a')\nfor P in x:\n    P.search(s)\n", "P = re.compile(r'a')\nP += 1\nP.search(s)\n",
      "P = re.compile(r'a')\nimport os as P\nP.search(s)\n", "P = re.compile(r'a')\na, P = x\nP.search(s)\n", "P = re.compile(r'a')\nif (P := x):\n    P.search(s)\n",
      "P = re.compile(r'a')\nf = lambda P: P.search(s)\n", "P = re.compile(r'a')\nwith x as P:\n    P.search(s)\n", "P = re.compile(r'a')\n[P for P in y]\nP.search(s)\n",
      "P = re.compile(r'a')\ndel P\nP.search(s)\n", "P = re.compile(r'a')\ndef P():\n    pass\nP.search(s)\n", "P = re.compile(r'a')\nP: int = 1\nP.search(s)\n",
    ]) assert.deepStrictEqual(linked(src), [], src);
  });

  it('links no call where the name is not the compile\'s: in another function, in a class\'s methods, before it at the top, an attribute', () => {
    for (const src of [
      "def f():\n    P = re.compile(r'a')\ndef g(s):\n    return P.search(s)\n", "class C:\n    P = re.compile(r'a')\n    def m(self, s):\n        return P.search(s)\n",
      "P.search(s)\nP = re.compile(r'a')\n", "P = re.compile(r'a')\nself.P.search(s)\n", "P = re.compile(x)\nP.search(s)\n", "P = re.compile(r'a') or y\nP.search(s)\n",
      "P = Q = re.compile(r'a')\nP.search(s)\n", "P = re.compile\nP.search(s)\n", "P = x.compile(r'a')\nP.search(s)\n", "P = (re.compile(r'a'))\nP.search(s)\n",
    ]) assert.deepStrictEqual(linked(src), [], src);
    // (A function defined before the statement runs after it: the name is bound by then.)
    assert.deepStrictEqual(linked("def f(s):\n    return P.search(s)\nP = re.compile(r'a')\n"), [['P.search', 3]]);
  });

  it('says on the method\'s line where its pattern comes from, labels `pos` and `endpos`, and gives the example of the call', () => {
    const src = "import re\nWORD = re.compile(r'\\w+', re.I)\nfound = WORD.match('ab cd', 3, 5)\n";
    const ex = explainPy(src, 2);
    assert.deepStrictEqual(texts(ex.items), [
      "WORD.match: the method `match` of the pattern `r'\\w+'` (Python regex), compiled into `WORD` on line 2; matched at the start of the string (at `pos`)",
      '3: The argument `pos` (`3`): the search starts at this index. Unlike a slice of the string, `^` and `\\A` match at its real start only, and a lookbehind and `\\b` see the characters before it',
      '5: The argument `endpos` (`5`): the string is matched as if it ended at this index (`$` matches there)',
    ]);
    assert.deepStrictEqual(ex.examples.map((e) => [e.anchor, e.sections.map((s) => s.lines)]), [[{ start: { line: 2, character: 8 }, end: { line: 2, character: 18 } }, [["'ab cd'"], ["<re.Match object; span=(3, 5), match='cd'>"]]]]);
    assert.strictEqual(ex.context?.[0].label, 'Python regex (`WORD.match`, the pattern compiled on line 2)');
    assert.match(plain(explainPy(src, 2, 'ja').items[0].explanation), /^行 2 で `WORD` にコンパイルしたパターン `r'\\w\+'`（Python の正規表現）のメソッド `match`。文字列の先頭（`pos` の位置）から一致する$/);
    // (The pattern's own tokens, and its problems, stay on the line of the compile.)
    assert.deepStrictEqual(documentIssues(open("import re\nP = re.compile(r'(')\nP.search(s)\n"), 'en', {}).map((i) => i.startLine), [1]);
  });

  it('says a flag in the slot of `count` of a method, with no deprecation: a method\'s `count` is positional', () => {
    const ex = explainPy("import re\nP = re.compile(r'a')\nP.sub('b', s, re.I)\n", 2);
    assert.deepStrictEqual(ex.facts?.map((f) => f.id), ['python-regex-flag-as-count']);
    assert.doesNotMatch(ex.notes.join('\n'), /DeprecationWarning/);
    // (A method takes no `flags`: `P.sub('b', s, flags=re.I)` raises TypeError, so the flag goes to the `re.compile`.)
    assert.match(ex.notes.join('\n'), /Pass the flag to `re\.compile` on line 2 \(`P = re\.compile\(…, re\.I\)`\): the method has no parameter `flags`, and `flags=` raises TypeError\./);
    assert.doesNotMatch(ex.notes.join('\n'), /Write `flags=/);
    const split = explainPy("import re\nWORD = re.compile(r'\\w+')\nWORD.split(s, re.I)\n", 2, 'ja').notes.join('\n');
    assert.match(split, /フラグは行 2 の `re\.compile` に渡す（`WORD = re\.compile\(…, re\.I\)`）。/);
    assert.doesNotMatch(split, /`flags=re\.I` と書く/);
  });
});
