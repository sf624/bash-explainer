// find's `{}` and xargs's `-I` text inside a string a shell reads as code (`sh -c 'echo {}'`): the tool pastes the path or the item
// into the code before the shell reads it, so a name with special characters can run as code (ShellCheck's SC2156). The note says so once for the
// string, with the shell's arguments as the fix, and the reading of the string says where the text goes. Checked with real
// GNU find and xargs, and bash.
import * as assert from 'assert';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { Analyzer, Token } from '../src/analyzer';
import type { LineExplanation } from '../src/analyzer-types';
import { readingNodes } from '../src/reading';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { chipOf } from '../src/ui/panelRoles';
import { runContained } from './support/contained';

const parser = createUnbashParser();
const analyzers = { en: new Analyzer('en'), ja: new Analyzer('ja') };
const explain = (src: string, lang: 'en' | 'ja' = 'en', line = 0): LineExplanation => analyzers[lang].explainLine(parser.parse(src), line, 'bash', { reading: true });
const walk = (ts: readonly Token[]): Token[] => ts.flatMap((t) => [t, ...walk(t.children)]);
const ID = 'placeholder-in-shell-string';
const said = (src: string, lang: 'en' | 'ja' = 'en', line = 0) => explain(src, lang, line).facts?.filter((f) => f.id === ID) ?? [];

/** The lines that paste the text into a shell's code: the source, the fix the note gives, and what the text is replaced with. */
const PASTED: { src: string; fix: string; with: 'path' | 'item' }[] = [
  { src: "xargs -I{} sh -c 'echo {}'", fix: "`sh -c '… \"$1\" …' _ {}`", with: 'item' },
  { src: "xargs -I{} bash -c 'mv {} {}.bak'", fix: "`bash -c '… \"$1\" …' _ {}`", with: 'item' },
  { src: "find . -exec sh -c 'echo {}' \\;", fix: "`sh -c '… \"$1\" …' _ {}`", with: 'path' },
  { src: "find . -name '*.txt' -exec sh -c 'wc -l {}' \\;", fix: "`sh -c '… \"$1\" …' _ {}`", with: 'path' },
  { src: "xargs -0 -I{} sh -c 'rm {}'", fix: "`sh -c '… \"$1\" …' _ {}`", with: 'item' },
  { src: "xargs -I% sh -c 'echo %; ls'", fix: "`sh -c '… \"$1\" …' _ %`", with: 'item' },
  { src: 'xargs -I{} sh -c "echo {}"', fix: "`sh -c '… \"$1\" …' _ {}`", with: 'item' },
];

/** The lines that do not: the path or item is an argument, no shell reads the word as code, or find refuses the line. */
const SILENT = [
  "find . -exec sh -c 'echo \"$1\"' _ {} \\;",
  "xargs -I{} sh -c 'echo \"$1\"' _ {}",
  'find . -exec echo {} \\;',
  'xargs -I{} echo {}',
  // (GNU find refuses `{}` inside a word before `+`, and runs nothing: `find-action-refused` says so.)
  "find . -exec sh -c 'echo {}' +",
  // (No `\;` ends the command: find refuses the line too.)
  "find . -exec sh -c 'echo {}'",
  // (Without `-I`, xargs replaces nothing; a string the shell alone reads is not replaced either.)
  "xargs sh -c 'echo {}'",
  "sh -c 'echo {}'",
  // (A string run as a whole, `xargs -I{} sh -c {}`, runs each item as a command, as it is meant to.)
  'xargs -I{} sh -c {}',
];

describe('a placeholder pasted into a shell string (`sh -c \'echo {}\'`, SC2156)', () => {
  it('warns, once for the string, with the shell\'s arguments as the fix, in both languages', () => {
    for (const { src, fix } of PASTED) {
      const [en, more] = said(src);
      assert.ok(en, src);
      assert.strictEqual(more, undefined, src);
      assert.strictEqual(en.level, 'warning', src);
      assert.ok(en.text.startsWith('⚠ Shell injection risk: '), `${src}: ${en.text}`);
      assert.match(en.text, /with special characters \(`;`, `\$\(…\)`, quotes\) can run as code, however `[^`]+` is quoted/, src);
      // (No example name: none runs for every quoting, see below.)
      assert.doesNotMatch(en.text, /such as/, src);
      assert.ok(en.text.includes(`Pass it as an argument of the shell, which gets it as data: ${fix}`), `${src}: ${en.text}`);
      const [ja] = said(src, 'ja');
      assert.ok(ja.text.startsWith('⚠ シェルインジェクションの危険: '), `${src}: ${ja.text}`);
      assert.ok(ja.text.includes(`をどうクォートしても、コードとして実行されることがあります。シェルの引数として渡せば、データのまま届きます: ${fix}`), `${src}: ${ja.text}`);
    }
    assert.match(said("find . -exec sh -c 'echo {}' \\;")[0].text, /`-exec` pastes the path it found in place of `\{\}` in the command string before the shell reads it, so a file name/);
    assert.match(said("xargs -I{} sh -c 'echo {}'")[0].text, /`-I` pastes the input item in place of `\{\}` in the command string before the shell reads it, so an item/);
    assert.strictEqual(said("xargs -I{} sh -c 'echo {}'")[0].head, '`-I` pastes each input item into the shell\'s code, so an item can run arbitrary commands.');
    // (One name for the item in Japanese: 入力の1件, as the rows say.)
    assert.match(said("xargs -I{} sh -c 'echo {}'", 'ja')[0].text, /特殊な文字（`;`・`\$\(…\)`・クォート）を含む入力の1件は/);
    assert.match(said("find . -exec sh -c 'echo {}' \\;", 'ja')[0].head!, /ファイル名によっては任意のコマンドが実行される/);
  });

  it('gives no fix where the shell takes no arguments after the string (ssh\'s remote command)', () => {
    const [f] = said("find . -exec ssh host 'cat {}' \\;");
    assert.ok(f);
    assert.doesNotMatch(f.text, /Pass it/);
  });

  it('warns where the string is not read as a script, but its value is known', () => {
    // (This shell expands `$x` first, so the string is not explained as a script; xargs still pastes the item into it.)
    assert.strictEqual(said('x=1\nxargs -I{} sh -c "echo {} $x"', 'en', 1).length, 1);
    assert.strictEqual(said('find . -exec sh -c "echo {} \\$x" \\;').length, 1);
  });

  it('says nothing where the text is an argument of the shell, no shell reads it as code, or nothing runs', () => {
    for (const src of SILENT) assert.deepStrictEqual(said(src), [], src);
    // find's error on it gives the shell's arguments, not `\;`, which would paste each path into the code.
    const refused = explain("find . -exec sh -c 'echo {}' +").facts!.find((f) => f.id === 'find-action-refused')!;
    assert.match(refused.text, /the word before it is `echo \{\}`\. Pass the paths to the shell as arguments: `sh -c '… "\$@" …' _ \{\} \+`\. find refuses/);
    assert.doesNotMatch(refused.text, /end it with/);
    assert.match(explain("find . -exec sh -c 'echo {}' +", 'ja').facts!.find((f) => f.id === 'find-action-refused')!.text, /なので、パスはシェルの引数として渡す: `sh -c '… "\$@" …' _ \{\} \+`。find は/);
    // (Not where the word is no shell's string, or a string of a shell that takes no arguments after it: su has no safe form to give.)
    for (const src of ['find . -exec echo x{} +', "find . -exec su -c 'rm {}' +"]) {
      assert.match(explain(src).facts!.find((f) => f.id === 'find-action-refused')!.text, /or end it with `\\;` to run it once per file/, src);
    }
  });

  it('reads the text in the string as what the tool pastes, not as a word `{}`, at depth 1 and 2', () => {
    const tokens = (src: string, lang: 'en' | 'ja' = 'en') => walk(explain(src, lang).items);
    for (const { src, with: what } of PASTED) {
      const pasted = tokens(src).filter((t) => t.placeholder && /before the shell reads the string/.test(t.explanation));
      assert.ok(pasted.length, src);
      for (const t of pasted) assert.strictEqual(t.placeholder, what, src);
    }
    const echo = tokens("xargs -I{} sh -c 'echo {}'").find((t) => t.label === '{}' && t.placeholder && t.span.start.character === 23)!;
    assert.strictEqual(echo.explanation, 'text to print. `-I` puts the input item here before the shell reads the string (explained here as a name with no blanks or special characters)');
    assert.deepStrictEqual(echo.children, []);
    const wc = tokens("find . -name '*.txt' -exec sh -c 'wc -l {}' \\;", 'ja').find((t) => t.label === '{}' && t.span.start.character === 40)!;
    assert.strictEqual(wc.explanation, '対象のファイル。シェルが文字列を読む前に、`-exec` がここを見つけたファイルのパスに置き換える（ここでは、空白や記号のない名前として解説）');
    // A part that holds the text among other text keeps what it is, and is no placeholder.
    const bak = tokens("xargs -I{} bash -c 'mv {} {}.bak'").find((t) => t.label === '{}.bak')!;
    assert.strictEqual(bak.placeholder, undefined);
    assert.match(bak.explanation, /^destination.*\. `-I` puts the input item in place of `\{\}` in it before the shell reads the string/);
    assert.match(tokens("xargs -I{} bash -c 'mv {} {}.bak'", 'ja').find((t) => t.label === '{}.bak')!.explanation, /`-I` がこの中の `\{\}` を入力の1件に置き換える/);
    // (Two in one part: said once.)
    assert.strictEqual(tokens("xargs -I{} sh -c 'echo {}x{}'").find((t) => t.label === '{}x{}')!.explanation.split('before the shell reads').length, 2);
    // Depth 2: the part is the tool's placeholder.
    const node = readingNodes(explain("find . -exec sh -c 'wc -l {}' \\;").reading!).find((n) => n.layer === 'command' && n.label === '{}' && n.placeholder)!;
    assert.strictEqual(chipOf(node, 'en'), 'placeholder for the path');
    assert.match(node.text!, /^target file\. `-exec` puts the path that was found here/);
    // (Not where the shell gets it as an argument: `{}` is the shell's `$1`, and the string has no `{}`.)
    for (const src of SILENT.slice(0, 2)) assert.strictEqual(tokens(src).filter((t) => /before the shell reads the string/.test(t.explanation)).length, 0, src);
  });

  it('agrees with GNU find and xargs: a name with `;` runs as code in the string, and as data passed as `$1`', async function () {
    this.timeout(30000);
    const dir = mkdtempSync(path.join(process.env.TMPDIR ?? tmpdir(), 'placeholder-injection-'));
    try {
      // Each case in its own directory, with a file whose name is code (`x;echo pwn #`), or that name on stdin; `@@` ends its output.
      const NAME = 'x;echo pwn #';
      const cases: { line: string; input?: string; file?: string; runs: boolean }[] = [
        { line: "xargs -I{} sh -c 'echo {}'", input: `printf '%s\\n' '${NAME}'`, runs: true },
        { line: "xargs -I{} bash -c 'mv {} {}.bak'", input: `printf '%s\\n' '${NAME}'`, runs: true },
        { line: "find . -type f -exec sh -c 'echo {}' \\;", file: NAME, runs: true },
        { line: "find . -name '*.txt' -exec sh -c 'wc -l {}' \\;", file: 'y;echo pwn #.txt', runs: true },
        { line: "xargs -0 -I{} sh -c 'rm {}'", input: `printf '%s\\0' '${NAME}'`, runs: true },
        { line: "find . -type f -exec sh -c 'echo \"$1\"' _ {} \\;", file: NAME, runs: false },
        { line: "xargs -I{} sh -c 'echo \"$1\"' _ {}", input: `printf '%s\\n' '${NAME}'`, runs: false },
        { line: 'find . -type f -exec echo {} \\;', file: NAME, runs: false },
        { line: 'xargs -I{} echo {}', input: `printf '%s\\n' '${NAME}'`, runs: false },
        { line: "find . -type f -exec sh -c 'echo {}' +", file: NAME, runs: false },
        { line: "find . -type f -exec sh -c 'echo {}'", file: NAME, runs: false },
      ];
      const script = cases.map((c, i) => `mkdir c${i} && cd c${i} && ${c.file ? `: > '${c.file}' && ` : ''}{ ${c.input ? `${c.input} | ` : ''}${c.line}; } 2>/dev/null; echo @@; cd ..`).join('\n');
      const { stdout } = await runContained(['bash', '--norc', '--noprofile', '-c', script], dir);
      const outs = stdout.split('@@\n');
      cases.forEach((c, i) => {
        assert.strictEqual(outs[i].split('\n').includes('pwn'), c.runs, `${c.line}: ${JSON.stringify(outs[i])}`);
        // (What we say agrees: a warning exactly where the name runs as code.)
        assert.strictEqual(said(c.line).length, c.runs ? 1 : 0, c.line);
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // The note says a name with special characters "can run as code, however `{}` is quoted", and gives no example: which names run
  // depends on the quotes around `{}` in the string, and xargs without `-0` takes quotes out of its input first (review of #712).
  it('agrees with GNU find and xargs on which names run, for each quoting of `{}` in the string: some name always does', async function () {
    this.timeout(60000);
    const dir = mkdtempSync(path.join(process.env.TMPDIR ?? tmpdir(), 'placeholder-quoting-'));
    try {
      // (Each name makes a file `PWNED` if it runs as code; `x\';…;\'` is for xargs without `-0`, whose input takes `\'` as a quote.)
      const NAMES = ['x;touch PWNED #', 'x$(touch PWNED)', 'x";touch PWNED;"', "x';touch PWNED;'", "x\\';touch PWNED;\\'"];
      const STRINGS = ["'echo {}'", `'echo "{}"'`, `"echo '{}'"`];
      const TOOLS = {
        find: (s: string) => `/usr/bin/find . -type f -exec sh -c ${s} \\;`,
        'xargs -0': (s: string) => `printf '%s\\0' "$name" | /usr/bin/xargs -0 -I{} sh -c ${s}`,
        xargs: (s: string) => `printf '%s\\n' "$name" | /usr/bin/xargs -I{} sh -c ${s}`,
        // (The safe forms: the shell gets the name as an argument.)
        'find +': () => `/usr/bin/find . -type f -exec sh -c 'echo "$@"' _ {} +`,
        'xargs "$1"': () => `printf '%s\\n' "$name" | /usr/bin/xargs -I{} sh -c 'echo "$1"' _ {}`,
      };
      // (What ran: each string, the names by their index, for each tool. Measured with findutils 4.9.0.)
      const RAN: Record<string, Record<keyof typeof TOOLS, number[]>> = {
        "'echo {}'": { find: [0, 1, 4], 'xargs -0': [0, 1, 4], xargs: [0, 1, 2, 3], 'find +': [], 'xargs "$1"': [] },
        [`'echo "{}"'`]: { find: [1, 2], 'xargs -0': [1, 2], xargs: [1], 'find +': [], 'xargs "$1"': [] },
        [`"echo '{}'"`]: { find: [3], 'xargs -0': [3], xargs: [4], 'find +': [], 'xargs "$1"': [] },
      };
      const cells = STRINGS.flatMap((str) => NAMES.flatMap((name, n) => (Object.keys(TOOLS) as (keyof typeof TOOLS)[]).map((tool) => ({ str, name, n, tool }))));
      const quote = (x: string): string => `'${x.replace(/'/g, "'\\''")}'`;
      const script = cells.map((c, i) => `mkdir c${i} && cd c${i} && name=${quote(c.name)} && ${c.tool.startsWith('find') ? ': > "$name" && ' : ''}`
        + `{ ${TOOLS[c.tool](c.str)}; } >/dev/null 2>&1; [ -e PWNED ] && echo ran ${i}; cd ..`).join('\n');
      const { stdout } = await runContained(['bash', '--norc', '--noprofile', '-c', script], dir, {}, 50000);
      const ran = new Set(stdout.split('\n').filter(Boolean).map((l) => Number(l.slice('ran '.length))));
      const got: typeof RAN = {};
      cells.forEach((c, i) => {
        ((got[c.str] ??= {} as Record<keyof typeof TOOLS, number[]>)[c.tool] ??= []);
        if (ran.has(i)) got[c.str][c.tool].push(c.n);
      });
      assert.deepStrictEqual(got, RAN);
      // (However `{}` is quoted, with each tool, some name runs: what the note says.)
      for (const str of STRINGS) for (const tool of ['find', 'xargs -0', 'xargs'] as const) assert.ok(RAN[str][tool].length, `${str} ${tool}`);
      // And each of these lines gets the warning; the safe forms get none.
      for (const str of STRINGS) {
        assert.strictEqual(said(`find . -type f -exec sh -c ${str} \\;`).length, 1, str);
        assert.strictEqual(said(`xargs -0 -I{} sh -c ${str}`).length, 1, str);
      }
      assert.deepStrictEqual(said(`find . -type f -exec sh -c 'echo "$@"' _ {} +`), []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
