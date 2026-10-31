import * as assert from 'assert';
import * as path from 'path';
import { descendants } from '../src/syntax/tree';
import type { BashParser as Parser } from '../src/syntax/tree';
import { Analyzer } from '../src/analyzer';
import { detectShell } from '../src/dialect';
import { documentIssues, explainDocumentLine, noteIssues, ShellDocument } from '../src/document';
import { extractShell } from '../src/hosts';
import { isProblem, MESSAGES } from '../src/messages';
import { STYLE_LEVELS } from '../src/pitfalls';
import { createUnbashParser } from '../src/syntax/adapters/unbash';

const root = path.join(__dirname, '..');
let parser: Parser;
before(async () => {
  parser = createUnbashParser();
});

const script = (text: string): ShellDocument => ({ lines: text.split('\n'), tree: parser.parse(text) });
const hosted = (kind: Parameters<typeof extractShell>[0], text: string): ShellDocument => {
  const extracted = extractShell(kind, text);
  return { lines: text.split('\n'), extracted, tree: parser.parse(extracted.text) };
};
const dockerfile = (text: string): ShellDocument => hosted('dockerfile', text);

// The functions the extension and the web page share.
describe('documents without VS Code', () => {
  const en = new Analyzer('en');

  it('explains a line of a shell script', () => {
    const ex = explainDocumentLine(en, script('#!/bin/bash\ngrep -rn TODO src'), 1, 'en', {}, {});
    assert.deepStrictEqual(ex.items.map((i) => i.label), ['grep']);
    assert.deepStrictEqual(ex.items[0].span, { start: { line: 1, character: 0 }, end: { line: 1, character: 17 } });
  });

  it('explains a line of a host file at its own columns', () => {
    const doc = dockerfile('FROM alpine\nRUN apk add curl');
    const ex = explainDocumentLine(en, doc, 1, 'en', {}, {});
    assert.ok(ex.items.length > 0);
    assert.ok(ex.items[0].span.start.character >= 'RUN '.length);
    assert.deepStrictEqual(explainDocumentLine(en, doc, 0, 'en', {}, {}).items, []);
  });

  it('checks for the forced shell first, then the detected one', () => {
    const text = '#!/bin/sh\n[[ -f x ]] && echo y';
    const detected = detectShell(text, 'x.sh');
    // (It is also the last command of a script run as a program: `script-last-test-returns-status`.)
    assert.deepStrictEqual(documentIssues(script(text), 'en', { detected }).map((i) => i.code), ['dbracket', 'script-last-test-returns-status']);
    assert.deepStrictEqual(documentIssues(script(text), 'en', { forced: 'bash', detected }).map((i) => i.code), ['script-last-test-returns-status']);
    assert.ok(documentIssues(script(text), 'en', { detected })[0].fix);
  });

  it('leaves out ignored codes and codes disabled in the file', () => {
    const text = '#!/bin/sh\n[[ -f x ]] && echo -e y';
    const detected = detectShell(text, 'x.sh');
    assert.deepStrictEqual(documentIssues(script(text), 'en', { detected }, ['echoE', 'script-last-test-returns-status']).map((i) => i.code), ['dbracket']);
    const disabled = '#!/bin/sh\n# bash-explainer disable=dbracket,script-last-test-returns-status\n[[ -f x ]] && echo -e y';
    assert.deepStrictEqual(documentIssues(script(disabled), 'en', { detected }).map((i) => i.code), ['echoE']);
  });

  it('reads a script with CRLF line ends as one with LF, and warns about it once', () => {
    const lf = 'if [ -f a ]; then\n  echo yes\nfi\n';
    const crlf = lf.replace(/\n/g, '\r\n');
    const doc = { lines: crlf.split(/\r?\n/), tree: parser.parse(crlf) };
    for (let line = 0; line < 3; line++) {
      assert.deepStrictEqual(explainDocumentLine(en, doc, line, 'en', {}, {}), explainDocumentLine(en, script(lf), line, 'en', {}, {}), `line ${line}`);
    }
    assert.strictEqual(doc.tree.root.endPosition.row, 3);
    // The blank that stands for a CR is no part of a comment (the shebang), a word or a string.
    const cr = parser.parse('#!/bin/sh\r\n# a\r\necho "PV " x\r\n');
    assert.deepStrictEqual(descendants(cr.root, ['comment']).map((n) => [n.text, n.endPosition.column]), [['#!/bin/sh', 9], ['# a', 3]]);
    // The problem is at the first CR, for every shell, in both languages: an error, as `then\r` and `fi\r` are no keywords.
    for (const lang of ['en', 'ja'] as const) {
      const issues = documentIssues(doc, lang, {});
      assert.deepStrictEqual(issues.map((i) => [i.code, i.severity, i.startLine, i.startCol, i.endCol]), [['crlf', 'error', 0, 13, 17]]);
      assert.match(issues[0].message, lang === 'en' ? /Windows line endings/ : /CRLF/);
    }
    // With a CR on the `#!` line, an error too (run as a program, the interpreter is not found); with a `#!` line that
    // ends in LF and no keyword before a CR, or with no shebang, a warning: every way runs it (test/error-level.test.ts).
    const said = (text: string, lang: 'en' | 'ja' = 'en') => documentIssues(script(text), lang, {}).map((i) => `${i.severity} ${/`fi\\r`|`#!`|`echo hi`|`;`/.exec(i.message)?.[0]}`);
    assert.deepStrictEqual(
      [said('#!/bin/sh\r\necho hi\r\n'), said('#!/bin/sh\necho hi\r\n'), said('echo hi\r\necho fi\r\n'), said('{ echo hi; }\r\n'), said('#!/bin/sh\r\nif true; then :; fi\r\n')],
      [['error `#!`'], ['warning `echo hi`'], ['warning `echo hi`'], ['error `fi\\r`'], ['error `fi\\r`']]);
    assert.deepStrictEqual([said('#!/bin/sh\r\n', 'ja'), said('#!/bin/sh\necho hi\r\n', 'ja')], [['error `#!`'], ['warning `echo hi`']]);
    // A CR where a command starts (a blank line; after `;`, `&&`, `||`, `|` or `&`; in a body or a substitution) is a
    // command, `$'\r'`, which is not found however the file runs: an error. Not in a word, a string, a heredoc's body, a
    // comment or an array, nor after another operator (`2>&`) or a word.
    assert.deepStrictEqual(
      ['echo a;\r\n', 'a &&\r\nb\r\n', 'a ||\r\n', 'a |\r\nb\r\n', 'a &\r\n', 'echo a\r\n\r\necho b\r\n', '  \r\n', '#!/bin/sh\necho a;\r\n', 'x=$(echo a;\r\n)\r\n', 'f() {\n  a;\r\n}\n'].map((t) => said(t)),
      Array(10).fill(['error `;`']));
    assert.deepStrictEqual(said('echo a;\r\n', 'ja'), ['error `;`']);
    // A `}` (or `]]`, `!`, `fi`) is a reserved word only as a token of a compound command: the `}` of `${HOME}` or of
    // `{a,b}` is a word's, and bash runs the line (test/error-level.test.ts). Where a keyword stands before a CR and a CR
    // starts a command, the keyword's text; a `}` of an expansion before `;\r` leaves the command's.
    assert.deepStrictEqual(
      ['echo ${HOME}\r\n', 'x=${y}\r\n', 'echo "${a}"\r\n', 'arr=(${a})\r\n', 'echo {a,b}\r\n', 'echo ${x:-fi}\r\n', 'echo $((1))\r\n'].map((t) => said(t)[0].split(' ')[0]),
      Array(7).fill('warning'));
    assert.deepStrictEqual(['{ :; }\r\n', '[[ a ]]\r\n', '! true; !\r\n', 'if true; then\r\n\r\nfi\r\n', 'echo ${HOME};\r\n'].map((t) => said(t).join()),
      [...Array(4).fill('error `fi\\r`'), 'error `;`']);
    assert.deepStrictEqual(
      ['echo a # b;\r\n', 'echo "a;\r\n\r\nb"\r\n', "echo 'a;\r\nb'\r\n", 'cat <<E\na;\r\n\r\nE\n', 'a=(\r\n\r\n1\r\n)\r\n', 'echo a 2>&\r\n', 'echo \\\r\n'].map((t) => said(t)[0]?.split(' ')[0]),
      Array(7).fill('warning'));
    assert.deepStrictEqual(documentIssues(doc, 'en', { forced: 'dash' }).map((i) => i.code), ['crlf']);
    assert.deepStrictEqual(documentIssues(doc, 'en', {}, ['crlf']), []);
    // A file-level directive silences it, on any line (the warning itself is usually on line 1); and so does a comment after the code.
    const withDirective = crlf + '# bash-explainer disable-file=crlf\r\n';
    assert.deepStrictEqual(documentIssues({ lines: withDirective.split(/\r?\n/), tree: parser.parse(withDirective) }, 'en', {}), []);
    assert.match(documentIssues(doc, 'ja', {})[0].message, /disable-file=crlf/);
    // The range is the last word of the line, also with blanks before the CR; a line of nothing else has an empty range.
    const range = (t: string) => documentIssues({ lines: t.split(/\r?\n/), tree: parser.parse(t) }, 'en', {}).map((i) => [i.startLine, i.startCol, i.endLine, i.endCol]);
    assert.deepStrictEqual(range('echo a   \r\n'), [[0, 5, 0, 6]]);
    assert.deepStrictEqual(range('\r\necho a\r\n'), [[0, 0, 0, 0]]);
    assert.deepStrictEqual(documentIssues(script(lf), 'en', {}), []);
    // Only a CR before a LF is a line end; the one in the middle of a line is a character like the others.
    assert.deepStrictEqual(documentIssues(script('echo a\rb\n'), 'en', {}), []);
    // bash itself fails on such a script: `fi\r` is no `fi`.
    assert.ok(documentIssues(script('echo hi\r\nsleep 1\r\nfoo\r\n'), 'en', {}).length === 1);
  });

  it('finds the problems of a host file', () => {
    const codes = documentIssues(dockerfile('FROM alpine\nRUN curl -s x | sh'), 'en', {}).map((i) => i.code);
    assert.ok(codes.includes('dockerPipefail'), codes.join());
    // (`curl … | sh` is also a download run by a shell, a note on a part of the line; the pipefail caveat of RUN is about
    // no part, and a line with only it is said once, as the host's problem.)
    assert.deepStrictEqual(codes.filter((c) => c === 'download-run-by-shell').length, 1);
    assert.deepStrictEqual(documentIssues(dockerfile('FROM alpine\nRUN wget -qO- x | tar xz'), 'en', {}).map((i) => i.code), ['dockerPipefail']);
  });
});

describe('the pitfalls of a script, as problems', () => {
  // (The problems of the explanations: their warnings and caveats are pitfalls, their errors, of the catalog or of the
  // style checks, are not.)
  const found = (text: string, shells: { forced?: 'bash' | 'sh' | 'zsh' } = {}) => documentIssues(script(text), 'en', shells)
    .filter((i) => i.pitfall || (i.severity === 'error' && (i.code in MESSAGES || i.code in STYLE_LEVELS))).map((i) => [i.code, i.severity, i.startLine, i.startCol, i.endLine, i.endCol]);
  // The script, and its pitfalls: code, severity, and range (line, column, line, column).
  const cases: [string, (string | number)[][]][] = [
    // src/pitfalls.ts
    ['[-f x]', [['bracket-no-space', 'error', 0, 0, 0, 3]]],
    ['x = 1', [['assignment-with-spaces', 'error', 0, 0, 0, 5]]],
    ['{echo a; }', [['brace-no-space', 'error', 0, 0, 0, 5]]],
    ['{ echo a }', [['brace-close-no-separator', 'error', 0, 9, 0, 10]]],
    ['rm -rf $DIR/*', [['rm-empty-variable-root', 'warning', 0, 7, 0, 13], ['unquoted-variable-as-path', 'warning', 0, 7, 0, 13]]],
    ['read line', [['read-without-r', 'info', 0, 0, 0, 9]]],
    ['[ $a < $b ]', [['redirect-in-bracket', 'error', 0, 5, 0, 9], ['unquoted-variable-in-test', 'info', 0, 2, 0, 4]]],
    // (`$x` may be empty, and then `]` closes `[`: a warning; never empty, an error.)
    ['[ -f $x]', [['bracket-close-in-word', 'warning', 0, 5, 0, 8]]],
    ['[ -f "$x/"]', [['bracket-close-in-word', 'error', 0, 5, 0, 11]]],
    // (`&&` ends the command `[ a`, which then has no `]`: a failure note, said too.)
    ['[ a && b ]', [['bracket-missing-close', 'error', 0, 0, 0, 3], ['and-or-in-bracket', 'error', 0, 4, 0, 6]]],
    ['source lib.sh', [['source-searches-path', 'warning', 0, 7, 0, 13]]],
    ['grep "$x" f', [['pattern-from-variable', 'info', 0, 5, 0, 9]]],
    // src/statusfacts.ts
    ['#!/bin/bash\ncp a b || echo failed', [['failure-reported-as-success', 'warning', 1, 0, 1, 21]]],
    // src/wordfacts.ts
    ['FOO=1 echo $FOO', [['prefix-assignment-expanded-first', 'error', 0, 11, 0, 15]]],
    ['cp $a b', [['unquoted-variable-as-path', 'warning', 0, 3, 0, 5]]],
    // (Each unquoted word of the command; before, only the first.)
    ['cp $a $b', [['unquoted-variable-as-path', 'warning', 0, 3, 0, 5], ['unquoted-variable-as-path', 'warning', 0, 6, 0, 8]]],
    ['cp $a $a/x', [['unquoted-variable-as-path', 'warning', 0, 3, 0, 5], ['unquoted-variable-as-path', 'warning', 0, 6, 0, 10]]],
    // (A path given to a command that neither deletes nor overwrites: a caveat.)
    ['cat $a', [['unquoted-variable-as-path', 'info', 0, 4, 0, 6]]],
    // (A path given to a command that neither deletes nor overwrites: a caveat.)
    ['cat $a', [['unquoted-variable-as-path', 'info', 0, 4, 0, 6]]],
    ['for f in $(ls); do :; done', [['for-over-ls-output', 'info', 0, 9, 0, 14]]],
    ['for a in $*; do :; done', [['for-over-unquoted-args', 'info', 0, 9, 0, 11]]],
    ['sudo echo 1 > /etc/x', [['redirect-by-your-shell', 'error', 0, 12, 0, 20]]],
    // The script exits; only the command fails (a redirection of a program); the script never starts.
    ['set -u\necho "$dir"', [['nounset-unbound', 'warning', 1, 6, 1, 10]]],
    ['set -u\ncat < "$f"', [['nounset-unbound', 'info', 1, 7, 1, 9]]],
    ['set -eu\ncat < "$f"', [['nounset-unbound', 'warning', 1, 7, 1, 9]]],
    // (Every statement of the file, each at the first read bash fails on.)
    ['set -u\necho "$a" "$b"\necho "$c"\n[ -e /no ] && echo "$d"; x=$e echo "$f"', [
      ['nounset-unbound', 'warning', 1, 6, 1, 8], ['nounset-unbound', 'warning', 2, 6, 2, 8], ['nounset-unbound', 'warning', 3, 20, 3, 22],
      ['nounset-unbound', 'warning', 3, 36, 3, 38]]],
    ['#!/bin/bash -e -u\n:', [['shebang-refused', 'error', 0, 0, 0, 17]]],
    // A node over several lines: to the end of its first line.
    ['for f in $(ls\n); do :; done', [['for-over-ls-output', 'info', 0, 9, 0, 13]]],
    // Each place, also where the explanation of the line says it once.
    ['cp $a b; cp $a c', [['unquoted-variable-as-path', 'warning', 0, 3, 0, 5], ['unquoted-variable-as-path', 'warning', 0, 12, 0, 14]]],
    ['echo "$x"\nx=1', []],
    // The other warnings and caveats of the explanations: a fact of the catalog, a failure, a status fact, a level that depends on `set -e`.
    ['f() {\n  local x=$(false)\n}', [['declaration-masks-status', 'info', 1, 2, 1, 18]]],
    ['[ -f a', [['bracket-missing-close', 'error', 0, 0, 0, 6]]],
    ['set -e\ni=0\n(( i++ ))', [['postfix-increment-status', 'warning', 2, 0, 2, 9]]],
    ['i=0\n(( i++ ))', [['postfix-increment-status', 'info', 1, 0, 1, 9]]],
    ['set -e\ncat a \\\n  | grep b', [['pipefail-missing', 'info', 1, 0, 1, 7]]],
    // (Said on each line of a statement over several lines: one problem.)
    ['f() {\n  local x=$(false) \\\n    y=1\n}', [['declaration-masks-status', 'info', 1, 2, 1, 20]]],
    // (In `$( )` and in a string a shell runs, at their places in the document.)
    ['echo a\nx=$( [ -f a )', [['bracket-missing-close', 'error', 1, 5, 1, 11]]],
    ["sh -c 'f() {\n  local x=$(false)\n}'", [['declaration-masks-status', 'info', 1, 2, 1, 18]]],
    // A plain fact is never a problem.
    ['exit 300', []],
  ];
  for (const [text, want] of cases) {
    it(`${JSON.stringify(text)}: ${want.map((w) => w[0]).join(', ') || 'none'}`, () => assert.deepStrictEqual(found(text), want));
  }

  // Caveats of the catalog that stay notes (`notProblem` in src/messages.ts): the explanations say them with their level, and no problem is made.
  for (const [text, code] of [['ssh host "ls $dir"', 'ssh-local-expansion'], ['ls **/*.sh', 'globstar-not-found'], ['ls !(a)', 'extglob-not-found']]) {
    it(`${JSON.stringify(text)}: a caveat in the explanation, no problem (${code})`, () => {
      const doc = script(text);
      const notes = explainDocumentLine(new Analyzer('en'), doc, 0, 'en', {}, {}).noteInfo.filter((n) => n.code === code);
      assert.deepStrictEqual(notes.map((n) => n.level), ['info']);
      assert.strictEqual(isProblem(code), false);
      assert.deepStrictEqual(documentIssues(doc, 'en', {}).filter((i) => i.code === code), []);
      assert.deepStrictEqual(noteIssues(doc, 'en', {}, {}).filter((i) => i.code === code), []);
    });
  }

  it('keeps a problem for the facts of the catalog that are not marked as staying notes', () => {
    assert.strictEqual(isProblem('declaration-masks-status'), true);
    assert.strictEqual(isProblem('extglob-maybe-on'), true);
    assert.strictEqual(isProblem('globstar-maybe-on'), true);
    // (A code that is not a fact of the catalog: a style check, a dialect issue, a host's own.)
    assert.strictEqual(isProblem('dockerPipefail'), true);
  });

  it('says what the explanation of the line says, in either language', () => {
    for (const lang of ['en', 'ja'] as const) {
      const doc = script('rm -rf $DIR/*\nread line');
      for (const i of documentIssues(doc, lang, {})) assert.ok(explainDocumentLine(new Analyzer(lang), doc, i.startLine, lang, {}, {}).notes.includes(i.message), i.message);
    }
  });

  it('honours the directives of the file, the codes to leave out, and `pitfalls: false`', () => {
    const text = 'x = 1\n# bash-explainer disable=read-without-r\nread a\nread b';
    assert.deepStrictEqual(documentIssues(script(text), 'en', {}).map((i) => [i.code, i.startLine]), [['assignment-with-spaces', 0], ['read-without-r', 3]]);
    assert.deepStrictEqual(documentIssues(script(text), 'en', {}, ['assignment-with-spaces']).map((i) => i.code), ['read-without-r']);
    // (An error is no pitfall: said with the pitfalls off, as a bug.)
    assert.deepStrictEqual(documentIssues(script(text), 'en', {}, [], { pitfalls: false }).map((i) => i.code), ['assignment-with-spaces']);
  });

  it('follows the shell: none where zsh syntax leaves the line unread; in a host file, at the columns of the file', () => {
    // zsh does not split `$a`, and bash cannot read the line with `${(f)…}`.
    assert.deepStrictEqual(found('cp $a b', { forced: 'zsh' }), []);
    assert.deepStrictEqual(documentIssues(script('cp $a b'), 'en', { forced: 'zsh' }).map((i) => i.code), ['wordSplit']);
    // (Also when that note is turned off: the pitfall is still wrong there.)
    assert.deepStrictEqual(documentIssues(script('cp $a b'), 'en', { forced: 'zsh' }, ['wordSplit']), []);
    assert.deepStrictEqual(found('x = ${(f)y}', { forced: 'zsh' }), []);
    assert.deepStrictEqual(found('x = 1', { forced: 'zsh' }), [['assignment-with-spaces', 'error', 0, 0, 0, 5]]);
    assert.deepStrictEqual(found('x = 1', { forced: 'sh' }), [['assignment-with-spaces', 'error', 0, 0, 0, 5]]);
    // zsh (zshexpn, zshoptions) gives `$@` unsplit, and closes a group at a `}` anywhere; it drops an empty unquoted
    // word all the same, so `[ -n $x ]` keeps its pitfall, for that reason.
    assert.deepStrictEqual(found('for a in $@; do :; done', { forced: 'zsh' }), []);
    assert.deepStrictEqual(found('{ echo a }', { forced: 'zsh' }), []);
    assert.deepStrictEqual(found('[ -n $x ]', { forced: 'zsh' }), [['unquoted-variable-in-test', 'info', 0, 5, 0, 7]]);
    const [test] = documentIssues(script('[ -n $x ]'), 'en', { forced: 'zsh' }).filter((i) => i.pitfall);
    assert.match(test.message, /is not split in zsh, but an empty value drops the word/);
    assert.deepStrictEqual(documentIssues(dockerfile('FROM alpine\nRUN x = 1'), 'en', {}).filter((i) => i.code === 'assignment-with-spaces').map((i) => [i.code, i.startLine, i.startCol, i.endLine, i.endCol]), [['assignment-with-spaces', 1, 4, 1, 9]]);
  });

  it('in a host file: the facts of bats on their statements, a placeholder as the file writes it, a pipe said once', () => {
    const rows = (doc: ShellDocument) => documentIssues(doc, 'en', {}).map((i) => [i.code, i.severity, i.startLine, i.startCol, i.endCol]);
    assert.deepStrictEqual(rows(hosted('bats', '@test "x" {\n  ! grep a f\n  run echo a | grep a\n  true\n}')),
      [['bats-negation-ignored', 'error', 1, 2, 12], ['bats-run-in-pipeline', 'error', 2, 2, 21], ['pipefail-missing', 'info', 2, 2, 21]]);
    // (A test runs with `set -e`, so a failing first stage of the pipe is not seen: the status fact is said too.)
    const [make] = documentIssues(hosted('makefile', 'all:\n\tcp $(SRC) $$dir/\n'), 'en', {});
    assert.deepStrictEqual([make.code, make.startLine, make.startCol, make.endCol], ['unquoted-variable-as-path', 1, 4, 10]);
    assert.match(make.message, /`\$\(SRC\)` is not quoted/);
    // (`set -e` and a pipe in a RUN: the Dockerfile's own problem says it; the note's `pipefail-missing` is not made too.)
    assert.deepStrictEqual(rows(dockerfile('FROM debian\nSHELL ["/bin/bash","-c"]\nRUN set -e; curl -s x | tar -x')).map((r) => r[0]), ['dockerPipefail']);
  });

  // A string a command runs as a script is read with its own model and shell, at its place in the document.
  for (const [text, want] of [
    ["bash -c 'x = 1'", [['assignment-with-spaces', 'error', 0, 9, 0, 14]]],
    ["eval 'rm -rf $Q/*'", [['rm-empty-variable-root', 'warning', 0, 13, 0, 17], ['unquoted-variable-as-path', 'warning', 0, 13, 0, 17]]],
    ["trap 'for f in $(ls); do :; done' EXIT", [['for-over-ls-output', 'info', 0, 15, 0, 20]]],
    ["sh -c 'echo a\nread line'", [['read-without-r', 'info', 1, 0, 1, 9]]],
    ["zsh -c 'for a in $@; do :; done'", []],
  ] as [string, (string | number)[][]][]) {
    it(`${JSON.stringify(text)}: ${want.map((w) => w[0]).join(', ') || 'none'}, in the string`, () => assert.deepStrictEqual(found(text), want));
  }

  it('leaves out a pitfall that another problem at its place already says', () => {
    const doc = script('x = 1');
    const [mine] = noteIssues(doc, 'en', {}, {});
    const other = { code: 'other', severity: 'warning' as const, message: 'something else', startLine: 0, startCol: 0, endLine: 0, endCol: 1 };
    assert.deepStrictEqual(noteIssues(doc, 'en', {}, {}, [other]), [mine]);
    assert.deepStrictEqual(noteIssues(doc, 'en', {}, {}, [{ ...other, message: mine.message }]), []);
    assert.deepStrictEqual(noteIssues(doc, 'en', {}, {}, [{ ...other, code: mine.code }]), []);
    assert.deepStrictEqual(noteIssues(doc, 'en', {}, {}, [{ ...other, code: mine.code, startCol: 5, endCol: 6 }]), [mine]);
    assert.deepStrictEqual(noteIssues(doc, 'en', {}, {}, [{ ...other, code: mine.code, startLine: 1, endLine: 1 }]), [mine]);
  });
});
