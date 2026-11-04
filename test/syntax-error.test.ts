// The problem `syntax-error` (src/semantics/syntaxerror.ts) against the real tools: `bash -n`, `dash -n` for sh, a real bash
// 5.3 for that version, on the scripts of test/fixtures/syntax-errors.json and of the snippets; and running them, since
// `bash -n` rejects code a script never reaches. No false error is the point: a check that fails a script that works is
// the worst outcome.
import * as assert from 'assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { gzipSync } from 'zlib';
import { Analyzer } from '../src/analyzer';
import type { Token } from '../src/analyzer-types';
import type { BashVersion } from '../src/bashversion';
import { readShell, type ScriptEvidence } from '../src/dialect';
import { documentIssues, type DocumentIssue, plain, type ShellDocument, type Shells } from '../src/document';
import { openDocument, shellsOf } from '../src/document-setup';
import { hostKind, type HostKind } from '../src/hosts';
import type { Shell } from '../src/shellfeatures';
import { syntaxFault } from '../src/semantics/syntaxerror';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import type { SyntaxErrorWhat } from '../src/syntax/tree';
import { agreesWithBash, agreesWithDash, shellSays } from './support/syntax-shells';

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'syntax-errors.json'), 'utf8')) as { scripts: string[]; onlyBash: Record<string, string> };
const corpus = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'snippets.json'), 'utf8')) as string[];
const parser = createUnbashParser();

const script = (text: string): ShellDocument => openDocument(text, 'shell', (t) => parser.parse(t));
const problems = (doc: ShellDocument, shell?: Shell, bashVersion?: BashVersion, lang: 'ja' | 'en' = 'en'): DocumentIssue[] => documentIssues(doc, lang, { script: 'said', ...(shell ? { forced: shell } : {}) }, [], { bashVersion });
const syntax = (doc: ShellDocument, shell?: Shell, version?: BashVersion) => problems(doc, shell, version).filter((i) => i.code === 'syntax-error');

/** Which scripts `tool -n` rejects, in one process (the table is long): a file each, as a script is read. */
function rejected(tool: string, scripts: readonly string[]): Set<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bash-explainer-syntax-'));
  try {
    scripts.forEach((s, i) => fs.writeFileSync(path.join(dir, String(i)), s));
    const loop = `i=0; while [ "$i" -lt ${scripts.length} ]; do "$1" -n "$2/$i" >/dev/null 2>&1; echo $?; i=$((i+1)); done`;
    const r = spawnSync('bash', ['-c', loop, 'loop', tool, dir], { encoding: 'utf8', maxBuffer: 1 << 26 });
    const codes = r.stdout.trim().split('\n');
    return new Set(scripts.filter((_, i) => codes[i] !== '0'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Which of `scripts`, run in `tool` in one process, report a syntax error. Commands that do not exist fail, and the shell goes on. */
function reportedByRun(tool: string, scripts: readonly string[]): Set<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bash-explainer-syntax-'));
  try {
    scripts.forEach((s, i) => fs.writeFileSync(path.join(dir, String(i)), s));
    const loop = `i=0; while [ "$i" -lt ${scripts.length} ]; do if timeout 5 "$1" "$i" </dev/null 2>&1 >/dev/null | grep -qE 'syntax error|unexpected (EOF|end of file)|Syntax error'; then echo 1; else echo 0; fi; i=$((i+1)); done`;
    const r = spawnSync('bash', ['-c', loop, 'loop', tool], { encoding: 'utf8', maxBuffer: 1 << 26, cwd: dir, env: { ...process.env, FUNCNEST: '100' } });
    const codes = r.stdout.trim().split('\n');
    return new Set(scripts.filter((_, i) => codes[i] === '1'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const has = (tool: string, re: RegExp): boolean => re.test(spawnSync(tool, ['--version'], { encoding: 'utf8' }).stdout ?? '');
const show = (list: readonly string[]) => list.map((s) => JSON.stringify(s)).join('\n');

/** What the tool and the problem say of each script: rejected with no problem, and a problem on what it accepts. */
function compare(scripts: readonly string[], tool: string, shell?: Shell, version?: BashVersion) {
  const bad = rejected(tool, scripts);
  const results = scripts.map((s) => {
    const all = problems(script(s), shell, version);
    return { s, said: all.some((i) => i.code === 'syntax-error'), other: all.some((i) => i.severity === 'error'), bad: bad.has(s) };
  });
  // (`onlyTool`: rejected, and no Error says anything: `{ a }` has its own, as `crlf` and what the shell lacks.)
  return { onlyWe: results.filter((r) => r.said && !r.bad).map((r) => r.s), onlyTool: results.filter((r) => r.bad && !r.other).map((r) => r.s), both: results.filter((r) => r.said && r.bad).length };
}

/** A script run in a real shell, in a directory of its own: its status, and whether the shell reports a syntax error. */
function runFile(text: string | Buffer, tool = 'bash'): { status: number | null; out: string; syntax: boolean } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bash-explainer-syntax-'));
  try {
    fs.writeFileSync(path.join(dir, 's'), text);
    const r = spawnSync(tool, ['s'], { encoding: 'utf8', cwd: dir, timeout: 20000, env: { ...process.env, FUNCNEST: '100' } });
    return { status: r.status, out: r.stdout, syntax: /syntax error|unexpected (?:EOF|end of file)|Syntax error/.test(r.stderr) };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** The same, run as a program, so that its first line counts. */
function runProgram(text: string): { status: number | null; syntax: boolean } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bash-explainer-syntax-'));
  try {
    fs.writeFileSync(path.join(dir, 's'), text, { mode: 0o755 });
    const r = spawnSync('./s', [], { encoding: 'utf8', cwd: dir, timeout: 20000, input: '', env: { ...process.env, FUNCNEST: '100' } });
    return { status: r.status, syntax: /syntax error|unexpected (?:EOF|end of file)|Syntax error/.test(r.stderr) };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('a syntax error is a problem, as bash -n says', function () {
  this.timeout(120000);

  it('says no error bash -n does not reject, on the table', () => {
    if (!has('bash', /version 5\.2/)) return;
    const { onlyWe, onlyTool, both } = compare(fixture.scripts, 'bash');
    assert.strictEqual(show(onlyWe), '');
    assert.ok(both > 200, `only ${both} scripts rejected by both`);
    assert.deepStrictEqual(onlyTool.filter((s) => !Object.hasOwn(fixture.onlyBash, s)), [], 'rejected by bash -n, and not listed');
    assert.deepStrictEqual(Object.keys(fixture.onlyBash).filter((s) => !onlyTool.includes(s)), [], 'stale entries of onlyBash');
  });

  it('says only what a run of the script reports, on the table', () => {
    const said = fixture.scripts.filter((s) => syntax(script(s)).length);
    assert.ok(said.length > 200, `only ${said.length} scripts said`);
    const reported = reportedByRun('bash', said);
    // (A run may stop before the error: `set -e` and `set -u` do, on the path it takes, and only with a failing status, so a
    // script that works never holds it. The text says "if the shell reaches this line". Measured apart: "stops first".)
    const notReported = said.filter((s) => !reported.has(s) && !(/\bset -[A-Za-z]*[eu]/.test(s) && runFile(s).status !== 0));
    assert.strictEqual(show(notReported), '');
  });

  it('says no error bash -n does not reject, on the snippets', () => {
    if (!has('bash', /version 5\.2/)) return;
    assert.strictEqual(show(compare(corpus, 'bash').onlyWe), '');
  });

  it('says no error dash -n does not reject, for sh', () => {
    assert.strictEqual(show(compare(fixture.scripts, 'dash', 'sh').onlyWe), '');
  });

  it('says no error bash 5.3 does not reject, for bash 5.3', function () {
    const bash53 = process.env.BASH_EXPLAINER_BASH53;
    if (!bash53) this.skip();
    assert.strictEqual(show(compare(fixture.scripts, bash53!, undefined, '5.3').onlyWe), '');
  });

  it('says no error on a script with CRLF line ends that bash -n does not reject', () => {
    const crlf = fixture.scripts.map((s) => s.replace(/\n/g, '\r\n'));
    assert.strictEqual(show(compare(crlf, 'bash').onlyWe), '');
  });

  it('points at the text, or at what is left open, in both languages', () => {
    const rows: [string, number, number, number, string, string][] = [
      ['echo ok )\n', 0, 8, 9, '`)` cannot stand here', 'ここに `)` は書けない'],
      ['echo a\n\n  )\n', 2, 2, 3, '`)` cannot stand here', 'ここに `)` は書けない'],
      ['if true; then\n  echo a\n', 0, 0, 2, '`fi` is missing', '`fi` がない'],
      ['echo a\nwhile a; do b done\n', 1, 9, 11, '`done` is missing', '`done` がない'],
      ["echo 'a\n", 0, 5, 7, '`\'` is missing', '`\'` がない'],
      ['[[ a b ]]\n', 0, 5, 6, 'the shell cannot read this command', 'シェルはこのコマンドを読めない'],
      ['a |\n', 0, 2, 3, 'a command is missing here', 'ここにコマンドがない'],
      ['a >\n', 0, 2, 3, 'the redirection has no target', 'リダイレクトの行き先がない'],
      ['f()\n', 0, 0, 3, 'the function has no body', '関数の本体がない'],
      ['x=(1 2\n', 0, 1, 2, '`)` is missing', '`)` がない'],
      ['if a; then fi\n', 0, 11, 13, 'no command follows `then`', '`then` の後にコマンドがない'],
    ];
    for (const [text, line, from, to, en, ja] of rows) {
      const [i] = syntax(script(text));
      assert.deepStrictEqual([i?.startLine, i?.startCol, i?.endLine, i?.endCol], [line, from, line, to], text);
      assert.strictEqual(i.severity, 'error', text);
      assert.ok(plain(i.message).toLowerCase().startsWith(en.toLowerCase()), `${text}: ${i.message}`);
      assert.ok(plain(problems(script(text), undefined, undefined, 'ja').find((p) => p.code === 'syntax-error')!.message).startsWith(ja), text);
    }
  });

  it('says what bash does: it has run the commands read in full before, and not the command this is in or its line', () => {
    const rows: [string, string, string][] = [
      ['a line', 'echo one\necho two\necho ok )\necho four\n', 'one\ntwo\n'],
      ['a line of `{ }`', 'echo one\n{ echo in; echo ok )\n}\necho four\n', 'one\n'],
      ['`{ }` over lines', 'echo one\n{\n  echo in\n  echo ok )\n}\necho four\n', 'one\n'],
      ['a function body', 'echo one\nf() {\n  echo in\n  echo ok )\n}\nf\necho four\n', 'one\n'],
      ['the same line', 'echo one; echo ok )\necho two\n', ''],
      ['the line before, with a `;`', 'echo a;\necho ok )\n', 'a\n'],
      ['in `$( )`', 'echo one\necho $(if)\necho two\n', 'one\n'],
      ['an `if` left open', 'echo one\nif true; then\n  echo in\necho four\n', 'one\n'],
      ['after the `fi`', 'echo one\nif true; then\n  echo in\nfi )\necho four\n', 'one\n'],
    ];
    for (const [name, text, out] of rows) {
      for (const tool of ['bash', 'dash']) {
        const r = runFile(text, tool);
        assert.deepStrictEqual([r.out, r.syntax], [out, true], `${tool}: ${name}`);
        assert.notStrictEqual(r.status, 0, `${tool}: ${name}`);
      }
      assert.match(syntax(script(text))[0].message, /a syntax error\. If the shell reaches this line, it stops reading here, having run the commands it read in full before; the command this is in, and the others on the line where it starts, do not run$/, name);
      assert.match(problems(script(text), undefined, undefined, 'ja').find((p) => p.code === 'syntax-error')!.message, /構文エラーになる。シェルはこの行まで来ると、ここで読むのをやめる。それまでに読み終えたコマンドは実行済みで、これを含むコマンドと、それが始まる行のほかのコマンドは実行されない$/, name);
    }
  });

  it('states no status: it is not always 2, and a file sourced returns to the script', () => {
    for (const text of ['x=(1 2\n', 'a=(\n']) {
      assert.strictEqual(runFile(text).status, 1, text);
      assert.strictEqual(syntax(script(text)).length, 1, text);
    }
    assert.strictEqual(runFile('echo ok )\n').status, 2);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bash-explainer-syntax-'));
    try {
      fs.writeFileSync(path.join(dir, 'bad.inc'), 'echo ok )\n');
      const r = spawnSync('bash', ['-c', '. ./bad.inc; echo "back $?"'], { encoding: 'utf8', cwd: dir });
      assert.deepStrictEqual([r.stdout, r.status], ['back 2\n', 0]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    assert.doesNotMatch(syntax(script('echo ok )\n'))[0].message, /status|never run|what follows/);
  });

  it('reads `time --` as bash does, in both shells', () => {
    for (const text of ['time -- :\n', 'time -p -- :\n', 'time --\n', '#!/bin/sh\ntime -- :\n', 'time -- echo a | cat\n']) {
      assert.deepStrictEqual(syntax(script(text)), [], text);
      assert.strictEqual(rejected('bash', [text]).size, 0, text);
      assert.strictEqual(rejected('dash', [text]).size, 0, text);
      assert.strictEqual(runFile(text.replace('--\n', '-- :\n')).status, 0, text);
    }
    const ex = new Analyzer('en').explainLine(parser.parse('time -p -- ls'), 0, undefined, {});
    const words = (ts: readonly Token[]): [string, string][] => ts.flatMap((t) => [[t.label, t.kind] as [string, string], ...words(t.children)]);
    assert.deepStrictEqual(words(ex.items).filter(([, k]) => k === 'option'), [['-p', 'option'], ['--', 'option']]);
    // ("In short" times the body, not the option.)
    for (const text of ['time ls', 'time -p ls', 'time -- ls', 'time -p -- ls']) assert.match(new Analyzer('en').explainLine(parser.parse(text), 0, undefined, { sentence: true }).sentence!, /`ls`/, text);
    // (In POSIX mode the program `time` reads its words, and runs it just the same.)
    assert.match(new Analyzer('en').explainLine(parser.parse('set -o posix\ntime -p ls'), 1, undefined, { sentence: true }).sentence!, /`ls`/);
  });

  it('is one problem for a script: bash stops at the first', () => {
    assert.deepStrictEqual(syntax(script('echo ok )\necho b )\nif a\n')).map((i) => i.startLine), [0]);
    // (After an error bash goes on from, what the tree says is not sure: nothing.)
    assert.deepStrictEqual(syntax(script('cat <<E\n$(echo a\nE\necho ok )\n')), []);
  });

  it('leaves out what bash does not stop at', () => {
    for (const text of ['cat <<E\nx\n', 'cat <<E\n$(echo ok\nE\n', 'cat <<E\n`echo ok )`\nE\n', 'echo `echo ok )`\n', '!\n', '! !\n', 'time !\n', '(cat <<E)\nx\n']) {
      assert.deepStrictEqual(syntax(script(text)), [], text);
      assert.strictEqual(rejected('bash', [text]).size, 0, text);
    }
    // (But where the here-document takes the end of a construct around it, bash finds it not closed.)
    assert.strictEqual(syntax(script('{ cat <<E\nx\n}\n')).length, 1);
    assert.strictEqual(rejected('bash', ['{ cat <<E\nx\n}\n']).size, 1);
    // (And one left open in the text of backticks stops bash as it reads the line.)
    assert.strictEqual(syntax(script('echo `\n')).length, 1);
  });

  it('gives no second problem where another says it', () => {
    for (const [text, code] of [['{ a }\n', 'brace-close-no-separator'], ['f() { a }\n', 'brace-close-no-separator'], ['{ a\n  b }\n', 'brace-close-no-separator'], ['if [ -f a ] then\n  b\nfi\n', 'keyword-needs-separator'], ['if a then b; fi\n', 'keyword-needs-separator'], ['while a do b; done\n', 'keyword-needs-separator'], ['{echo a;}\n', 'brace-no-space']] as const) {
      const all = problems(script(text));
      assert.deepStrictEqual(all.filter((i) => i.severity === 'error').map((i) => i.code), [code], text);
      assert.strictEqual(rejected('bash', [text]).size, 1, text);
    }
  });

  it('is silenced as other problems are', () => {
    const doc = script('# bash-explainer disable=syntax-error\necho ok )\n');
    assert.deepStrictEqual(syntax(doc), []);
    const file = script('# bash-explainer disable-file=syntax-error\necho a\necho ok )\n');
    assert.deepStrictEqual(syntax(file), []);
    assert.deepStrictEqual(documentIssues(script('echo ok )\n'), 'en', { script: 'said' }, ['syntax-error']).filter((i) => i.code === 'syntax-error'), []);
    // (It is no pitfall: `diagnostics.pitfalls` off leaves it.)
    assert.strictEqual(documentIssues(script('echo ok )\n'), 'en', { script: 'said' }, [], { pitfalls: false }).filter((i) => i.code === 'syntax-error').length, 1);
    assert.strictEqual(syntax(script('echo ok )\n'))[0].pitfall, undefined);
  });

  it('applies to bash and sh only, not to a program of another name', () => {
    for (const shell of ['zsh', 'dash', 'ksh', 'mksh', 'yash', 'ash'] as const) assert.deepStrictEqual(syntax(script('echo ok )\n'), shell), [], shell);
    const said = (first: string, name = 'a', given?: ScriptEvidence, forced?: Shell) => {
      const doc = script(`${first}echo ok )\n`);
      return documentIssues(doc, 'en', shellsOf(doc.lines, name, forced, given)).filter((i) => i.code.startsWith('syntax-error')).length;
    };
    for (const first of ['#!/usr/bin/env node', '#!/usr/bin/fish', '#!/usr/bin/python3', '#!/bin/csh', '#!/usr/bin/awk -f', '#!/bin/zsh', '#!/bin/dash']) {
      assert.strictEqual(said(`${first}\n`), 0, first);
      // (Whatever the name, and what the user says of the kind.)
      assert.strictEqual(said(`${first}\n`, 'a.sh', 'said'), 0, first);
    }
    for (const first of ['#!/bin/bash', '#!/usr/bin/env bash', '#!/bin/sh', '#!/usr/bin/env sh']) assert.strictEqual(said(`${first}\n`), 1, first);
    // (No first line: the name, or what someone says of it. When in doubt, nothing.)
    for (const name of ['a', 'a.txt', 'a.sh.erb', 'a.sh.in', 'a.conf', 'Makefile.inc', '-', '(command)']) assert.strictEqual(said('', name), 0, name);
    for (const name of ['a.sh', 'd/a.sh', 'a.bash', '.bashrc', '.bash_profile']) assert.strictEqual(said('', name), 1, name);
    assert.strictEqual(said('# shellcheck shell=bash\n'), 1);
    assert.strictEqual(said('', 'a', 'name'), 1, 'the kind given');
    assert.strictEqual(said('', 'a', undefined, 'bash'), 1, 'the shell given');
  });

  it('follows the version for `${ …; }`', () => {
    // (bash 5.2 reads it as a parameter expansion, and fails only where it runs: its own issue.)
    for (const text of ['echo ${ echo ok ); }\n', 'echo ${ if a; then b; }\n', 'x=${ echo ok ); }\n']) {
      assert.deepStrictEqual(syntax(script(text), undefined, '5.2'), [], text);
      assert.strictEqual(syntax(script(text), undefined, '5.3').length, 1, text);
      if (has('bash', /version 5\.2/)) assert.strictEqual(rejected('bash', [text]).size, 0, text);
      const bash53 = process.env.BASH_EXPLAINER_BASH53;
      if (bash53) assert.strictEqual(rejected(bash53, [text]).size, 1, text);
    }
  });

  it('says none where bash 5.2 and dash read a `${ ` as text, whatever follows; bash 5.3 does not', () => {
    const bash53 = process.env.BASH_EXPLAINER_BASH53;
    for (const text of ['echo ${ { a; }\n', 'echo ${ f() { a; }\n', 'echo ${| { a; }\n']) {
      for (const shell of ['bash', 'sh'] as const) assert.strictEqual(syntaxFault(parser.parse(text), shell, '5.2'), undefined, `${shell}: ${text}`);
      assert.strictEqual(syntaxFault(parser.parse(text), 'sh', '5.3'), undefined, text);
      assert.ok(syntaxFault(parser.parse(text), 'bash', '5.3'), text);
      if (has('bash', /version 5\.2/)) assert.strictEqual(rejected('bash', [text]).size, 0, text);
      assert.strictEqual(rejected('dash', [text]).size, 0, text);
      if (bash53) assert.strictEqual(rejected(bash53, [text]).size, 1, text);
    }
  });

  it('says none where the text runs on: a process substitution glued to a word on a compound command', () => {
    const texts = ['{ a; } < <(b)x\n', '( a ) < <(b)c\n', '[[ a ]] < <(b)c\n', 'f() { a; } < <(b)c\n', 'while a; do b; done < <(ls).txt\n', 'while a; do b; done < <(ls)done\n', 'cat < <(ls)x\n'];
    for (const tool of ['bash', ...(process.env.BASH_EXPLAINER_BASH53 ? [process.env.BASH_EXPLAINER_BASH53] : [])]) assert.strictEqual(rejected(tool, texts).size, 0, tool);
    for (const text of texts) assert.strictEqual(syntaxFault(parser.parse(text), 'bash'), undefined, text);
    const r = spawnSync('bash', ['-c', 'while read l; do echo in; done < <(echo x)y; echo after'], { encoding: 'utf8' });
    assert.deepStrictEqual([r.status, /after/.test(r.stdout)], [0, true]);
  });

  it('says none where dash reads `$\'` as a `$` and a quote; `$"` it reads as bash does', () => {
    const quote = "echo $'a\\'\n";
    assert.strictEqual(rejected('dash', [quote]).size, 0);
    assert.strictEqual(rejected('bash', [quote]).size, 1);
    assert.strictEqual(syntaxFault(parser.parse(quote), 'sh'), undefined);
    assert.ok(syntaxFault(parser.parse(quote), 'bash'));
    const r = spawnSync('dash', ['-c', "echo $'a\\'"], { encoding: 'utf8' });
    assert.deepStrictEqual([r.status, r.stdout], [0, '$a\\\n']);
    // (The same quote earlier in the file: dash reads all that follows otherwise. `it\'s` closes it there, and opens another.)
    assert.strictEqual(syntaxFault(parser.parse("echo $'it\\'s'\necho ok )\necho 'x'\n"), 'sh'), undefined);
    const double = 'echo $"a\\"\n';
    for (const [tool, shell] of [['bash', 'bash'], ['dash', 'sh']] as const) {
      assert.strictEqual(rejected(tool, [double]).size, 1, tool);
      assert.ok(syntaxFault(parser.parse(double), shell), shell);
    }
  });

  it('asks the text once, however many lines ask: 20,000 lines with a fault at the end', () => {
    const lines = Array.from({ length: 20000 }, (_, i) => `echo ${i}`);
    const tree = parser.parse(`#!/bin/bash\n${lines.join('\n')}\nfi\n`);
    const started = Date.now();
    // (As the explanation of each line does. Reading the text for each line took more than 10 s here.)
    for (const _ of lines) assert.ok(syntaxFault(tree, 'bash'));
    assert.ok(Date.now() - started < 2000, `${Date.now() - started} ms`);
  });

  it('does not read a string as a script of its own', () => {
    for (const text of ["bash -c 'echo ok )'\n", "eval 'echo ok )'\n", "sh -c 'if a'\n", "trap 'echo ok )' EXIT\n", "x='echo ok )'\n"]) {
      assert.deepStrictEqual(documentIssues(script(text), 'en', {}).filter((i) => i.code === 'syntax-error'), [], text);
      assert.strictEqual(rejected('bash', [text]).size, 0, text);
    }
  });
});

describe('what bash does with "bad substitution", and with a builtin behind a wrapper', () => {
  const tokenOf = (text: string, label: string, shell?: Shell) => {
    const walk = (ts: readonly Token[]): Token | undefined => ts.map((t) => walk(t.children) ?? (t.label === label ? t : undefined)).find(Boolean);
    return walk(new Analyzer('en').explainLine(parser.parse(text), 0, shell, { script: 'said' }).items)!;
  };
  /** What a file does in a real bash: its stdout and status. */
  const runs = (text: string, tool = 'bash') => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bash-explainer-syntax-'));
    try {
      fs.writeFileSync(path.join(dir, 's'), text);
      const r = spawnSync(tool, [path.join(dir, 's')], { encoding: 'utf8' });
      return { out: r.stdout, status: r.status, bad: /bad substitution/.test(r.stderr) };
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
  const shells = ['bash', ...(process.env.BASH_EXPLAINER_BASH53 ? [process.env.BASH_EXPLAINER_BASH53] : [])];

  it('`${x@Z}` fails only with `x` set, and then stops the shell: a warning', () => {
    for (const tool of shells) {
      for (const op of ['Z', 'w']) {
        const after = `echo \${x@${op}}; echo same\necho next\n`;
        assert.deepStrictEqual(runs(`unset x\n${after}`, tool), { out: '\nsame\nnext\n', status: 0, bad: false }, tool);
        for (const set of ['x=', 'x=1']) assert.deepStrictEqual(runs(`${set}\n${after}`, tool), { out: '', status: 1, bad: true }, `${tool} ${set}`);
        assert.deepStrictEqual(runs(`x=1\n( echo \${x@${op}}; echo same )\necho next\n`, tool), { out: 'next\n', status: 0, bad: true }, tool);
      }
    }
    const t = tokenOf('echo ${x@Z}', '${x@Z}');
    assert.match(t.explanation, /`@Z` is no transform bash has\. With a value to transform, even an empty one, bash reports "bad substitution" and the shell that runs it stops \(status 1\); with none, it is empty/);
    // (What has no value is more than a name unset: an element, or no positional parameters.)
    for (const tool of shells) {
      for (const empty of ['x=(1); echo ${x[5]@Z}; echo same\n', 'set --; echo ${@@Z}; echo same\n']) assert.deepStrictEqual(runs(empty, tool), { out: '\nsame\n', status: 0, bad: false }, empty);
      assert.deepStrictEqual(runs('set -- a; echo ${@@Z}; echo same\n', tool), { out: '', status: 1, bad: true }, tool);
    }
    assert.deepStrictEqual(t.marks?.map((m) => m.level), ['warning']);
    // (In another shell, only what bash lacks.)
    const sh = tokenOf('echo ${x@Z}', '${x@Z}', 'sh');
    assert.match(sh.explanation, /`@Z` is no transform bash has$/);
    assert.strictEqual(sh.marks, undefined);
  });

  it('`${(f)var}` and `${#x:-a}` fail whatever `x` is: an error', () => {
    for (const tool of shells) {
      for (const word of ['${(f)x}', '${#x:-a}', '${#x-a}']) {
        // (Not "the rest of its line": in a subshell or in `$( )`, that goes on.)
        assert.strictEqual(runs(`( echo ${word} ); echo same\n`, tool).out, 'same\n', word);
        assert.strictEqual(runs(`echo $(echo ${word}); echo same\n`, tool).out, '\nsame\n', word);
        for (const set of ['unset x', 'x=', 'x=1']) {
          const r = (body: string) => runs(`${set}\n${body}\necho next $?\n`, tool);
          assert.deepStrictEqual(r(`echo ${word}; echo same`), { out: 'next 1\n', status: 0, bad: true }, `${tool} ${set} ${word}`);
          assert.deepStrictEqual(r(`{\n  echo ${word}\n  echo same\n}; echo same`), { out: 'next 1\n', status: 0, bad: true }, `${tool} ${set} ${word}`);
          assert.deepStrictEqual(r(`if true; then echo ${word}; fi; echo same`), { out: 'next 1\n', status: 0, bad: true }, `${tool} ${set} ${word}`);
        }
      }
    }
    for (const [word, why] of [['${(f)var}', 'parameter flags are zsh syntax'], ['${#x:-a}', 'length takes no operator']]) {
      const t = tokenOf(`echo ${word}`, word);
      assert.ok(t.explanation.includes(why), t.explanation);
      assert.match(t.explanation, /bash reports "bad substitution" \(.*\)$/);
      assert.deepStrictEqual(t.marks?.map((m) => m.level), ['error']);
      assert.ok(new Analyzer('en').explainLine(parser.parse(`echo ${word}`), 0, undefined, { script: 'said' }).noteInfo.some((n) => n.code === 'bad-substitution-always'), word);
      const sh = tokenOf(`echo ${word}`, word, 'sh');
      assert.ok(sh.explanation.includes(why), sh.explanation);
      assert.strictEqual(sh.marks, undefined);
    }
  });

  // (`--check` fails on the first: `tokenErrorNotes`. The gate is the syntax error's, `surelyRead`, and no path that may leave it out.)
  // (What runs before it on the line has run; a subshell, `$( )`, a stage of a pipeline, `&`, `eval` and a file sourced keep it to themselves: so the text states no status.)
  it('`${(f)var}`: bash drops what it read with it, and goes on to the next line', () => {
    const rows: [string, string][] = [
      ['echo ${(f)y}; echo same\necho $? next\n', '1 next\n'],
      ['echo before; echo ${(f)y}; echo same\necho $? next\n', 'before\n1 next\n'],
      ['eval \'echo ${(f)y}; echo in\'; echo after\n', 'after\n'],
      ['echo ${(f)y} || echo z\necho $? next\n', '1 next\n'],
      ['f() { echo ${(f)y}; echo in-f; }; f; echo $?\n', ''],
      ['f() { echo ${(f)y}; echo in-f; }\nf\necho $? next\n', '1 next\n'],
      ['for i in 1 2; do echo ${(f)y}; echo body; done\necho $? next\n', '1 next\n'],
      ['if [ ${(f)y} ]; then echo t; else echo e; fi\necho $? next\n', '1 next\n'],
      ['( echo ${(f)y}; echo sub ); echo $?\n', '1\n'],
      ['echo ${(f)y} | cat; echo $?\n', '0\n'],
      ['x=$(echo ${(f)y}; echo in); echo "[$x]" $?\n', '[] 1\n'],
      ['echo ${(f)y} & wait $!; echo $?\n', '1\n'],
    ];
    for (const tool of shells) {
      for (const [text, out] of rows) {
        const r = runs(text, tool);
        assert.deepStrictEqual([r.out, r.bad], [out, true], `${tool}: ${text}`);
      }
    }
    for (const lang of ['en', 'ja'] as const) {
      const [problem] = documentIssues(script('echo ${(f)y}\n'), lang, { script: 'said' }).filter((i) => i.code === 'bad-substitution-always');
      assert.ok(problem, lang);
      assert.doesNotMatch(problem.message, /status 1|ステータス 1|fails/, lang);
    }
    const [one] = documentIssues(script('echo ${(f)y}\n'), 'en', { script: 'said' }).filter((i) => i.code === 'bad-substitution-always');
    assert.match(one.message, /bash reports "bad substitution".*It does not run this command or the rest of what it read with it/);
  });

  it('`${(f)var}` is a problem only where a run surely gets to it', () => {
    const notes = (text: string, line: number) => new Analyzer('en').explainLine(parser.parse(text), line, undefined, { script: 'said' }).noteInfo.map((n) => n.code);
    const said: [string, number, number][] = [
      ['echo ${(f)x}\n', 0, 1],
      ['echo ${#x:-a}\n', 0, 1],
      ['echo a\necho ${(f)x}\n', 1, 1],
      ['echo $(echo ${(f)x}); false\n', 0, 1],
      ['( echo ${(f)x} )\n', 0, 1],
      ['{ echo ${(f)x}; }\n', 0, 1],
      ['set -e\necho ${(f)x}\n', 1, 1],
      ['echo ${(f)x} && true\n', 0, 1],
      ['cat <(echo ${(f)x}); false\n', 0, 1],
      ['echo ${(f)x} ${(f)y}\n', 0, 1],
      ['#!/bin/bash\necho ${(f)x}\n', 1, 1],
    ];
    for (const [text, line, status] of said) {
      assert.ok(notes(text, line).includes('bad-substitution-always'), text);
      assert.strictEqual(runs(text).status, status, text);
      assert.strictEqual(runs(text).bad, true, text);
    }
    // (Status 0: a run of the script never fails there, or a command before it may end the script.)
    const silent: [string, number, number | null][] = [
      ['exit 0\necho ${(f)x}\n', 1, 0],
      ['eval "exit 0"\necho ${#x:-a}\n', 1, 0],
      ['if [ -n "$ZSH_VERSION" ]; then echo ${(f)x}; fi\n', 0, 0],
      ['[ -n "$ZSH_VERSION" ] && echo ${(f)x}\ntrue\n', 0, 0],
      ['[ -z "$ZSH_VERSION" ] || echo ${(f)x}\n', 0, 0],
      ['f() { echo ${(f)x}; }\n', 0, 0],
      ['for i in; do echo ${(f)x}; done\n', 0, 0],
      ['while false; do echo ${(f)x}; done\n', 0, 0],
      ['case a in b) echo ${(f)x};; esac\n', 0, 0],
      ['x=1; echo ${x:-${(f)y}}\n', 0, 0],
      ['x=1; echo ${x:-$(echo ${(f)y})}\n', 0, 0],
      ['x=1; echo ${#x:-a} <%= y %>\n', 0, null],
      ['echo ${(f)x} )\n', 0, null],
    ];
    for (const [text, line, status] of silent) {
      assert.ok(!notes(text, line).includes('bad-substitution-always'), text);
      if (status !== null) assert.strictEqual(runs(text).status, status, text);
    }
    // (On its row, a warning that says when.)
    const walk = (ts: readonly Token[]): Token[] => ts.flatMap((t) => [t, ...walk(t.children)]);
    const row = walk(new Analyzer('en').explainLine(parser.parse('if a; then echo ${(f)x}; fi\n'), 0, undefined, { script: 'said' }).items).find((t) => t.label === '${(f)x}' && t.marks)!;
    assert.match(row.explanation, /if this runs, bash reports "bad substitution" \(.*\), and does not run this command or the rest of what it read with it$/);
    assert.deepStrictEqual(row.marks?.map((m) => m.level), ['warning']);
    // (A string read as a script, and a text not surely a script: the same.)
    assert.deepStrictEqual(walk(new Analyzer('en').explainLine(parser.parse('echo ${(f)x}\n'), 0, undefined, {}).items).find((t) => t.label === '${(f)x}' && t.marks)!.marks?.map((m) => m.level), ['warning']);
  });

  it('`${(f)var}` keeps a host and a fragment out of the check', () => {
    const found = (file: string, text: string) => {
      const doc = openDocument(text, hostKind('', file, text) as HostKind, (t) => parser.parse(t));
      return documentIssues(doc, 'en', shellsOf(doc.lines, file, undefined, 'said')).filter((i) => i.severity === 'error').length;
    };
    for (const [file, text] of [['Dockerfile', 'FROM a\nRUN echo ${(f)x}\n'], ['a.md', '```bash\necho ${(f)x}\n```\n'], ['Makefile', 'a:\n\techo $${(f)x}\n']]) assert.strictEqual(found(file, text), 0, file);
  });

  it('a builtin behind a wrapper is not reached: its words are not read', () => {
    const r = spawnSync('nohup', ['let', 'x=09'], { encoding: 'utf8', cwd: os.tmpdir() });
    assert.match(r.stderr, /failed to run command .let./);
    for (const text of ['nohup let x=09', 'sudo let x=09', 'env let x=09']) {
      const ex = new Analyzer('en').explainLine(parser.parse(text), 0, undefined, {});
      assert.doesNotMatch(JSON.stringify(ex.items), /Invalid number|arithmetic error/, text);
      assert.ok(ex.noteInfo.some((n) => n.code === 'builtin-or-function-as-program'), text);
    }
    // (`command` runs the builtin, which reads them.)
    assert.match(JSON.stringify(new Analyzer('en').explainLine(parser.parse('command let x=09'), 0, undefined, {}).items), /Invalid number/);
  });
});

describe('a syntax error on a line of "In short"', () => {
  const sentence = (text: string, line = 0, shell?: Shell) => new Analyzer('en').explainLine(parser.parse(text), line, shell, { sentence: true, script: 'said' }).sentence;

  it('counts a line continued into the command it stops at', () => {
    const text = 'echo a; \\\n echo ok )\n';
    assert.deepStrictEqual([runFile(text).out, runFile(text).syntax], ['', true]);
    assert.match(sentence(text, 0)!, /^The shell stops with a syntax error/);
    assert.match(sentence(text, 1)!, /^The shell stops with a syntax error/);
    // (A backslash that is one itself continues nothing: bash ran the line before.)
    const not = 'echo a\\\\\necho ok )\n';
    assert.deepStrictEqual([runFile(not).out, runFile(not).syntax], ['a\\\n', true]);
    assert.doesNotMatch(sentence(not, 0)!, /syntax error/);
    // (Nor in a comment.)
    const comment = 'echo a # c \\\necho ok )\n';
    assert.deepStrictEqual([runFile(comment).out, runFile(comment).syntax], ['a\n', true]);
    assert.doesNotMatch(sentence(comment, 0)!, /syntax error/);
  });

  it('says the shell stops, not what the line seems to do', () => {
    const rows: [string, string][] = [
      ['if a; then b fi\n', '`fi` is missing'],
      ['if a; then b; else c fi\n', '`fi` is missing'],
      ['while a; do b done\n', '`done` is missing'],
      ['for x in a; do b done\n', '`done` is missing'],
      ['case x in a) ;;\n', '`esac` is missing'],
      ['( a\n', '`)` is missing'],
      ['echo $(\n', '`)` is missing'],
      ['{ a }\n', '`}` is missing'],
      ['f() { a }\n', '`}` is missing'],
      ['echo ok )\n', '`)` cannot stand here'],
      ["echo 'a\n", "`'` is missing"],
    ];
    for (const [text, why] of rows) assert.strictEqual(sentence(text), `The shell stops with a syntax error (${why}).`, text);
  });

  // (bash stops at them; in another shell, whose reading is not checked, the sentence says what it reads.)
  it('says what an unfinished line seems to do in another shell', () => {
    const rows: [string, string][] = [
      ['a &&', 'Runs `a`.'],
      ['for', 'Runs its body with `$` set to each argument, one at a time.'],
      ['select', 'Shows a menu of each argument and runs its body with `$` set to the choice.'],
      ['coproc', 'Does nothing.'],
    ];
    for (const [text, said] of rows) assert.strictEqual(sentence(text, 0, 'ksh'), said, text);
  });

  it('says so on every line of the command bash refuses, and not before it', () => {
    const text = 'echo one\nif a; then\n  echo in\nfi )\n';
    assert.match(sentence(text, 0)!, /^Runs `echo`/);
    for (const line of [1, 2, 3]) assert.strictEqual(sentence(text, line), 'The shell stops with a syntax error (`)` cannot stand here).', String(line));
  });

  it('says so on a `)` alone on its line, not on a blank line or a comment of the command', () => {
    assert.strictEqual(sentence('echo a\n)\n', 1), 'The shell stops with a syntax error (`)` cannot stand here).');
    assert.match(sentence('echo a\n)\n', 0)!, /^Runs `echo`/);
    const open = 'if a; then\n\n  # c\n  b\n';
    assert.strictEqual(sentence(open, 0), 'The shell stops with a syntax error (`fi` is missing).');
    assert.strictEqual(sentence(open, 1), undefined);
    assert.strictEqual(sentence(open, 2), undefined);
    assert.strictEqual(sentence(open, 3), 'The shell stops with a syntax error (`fi` is missing).');
    // (Accepted: a line after the refused command, which never runs, still says what it does.)
    assert.match(sentence('echo ok )\necho b\n', 1)!, /^Runs `echo`/);
  });

  it('keeps its reading on a line bash reads', () => {
    assert.match(sentence('echo `echo ok )`\n')!, /^Runs `echo`/);
    assert.match(sentence('cat <<E\nx\n')!, /^Runs `cat`/);
    assert.strictEqual(sentence('!\n'), 'Does nothing, and negates its status.');
  });
});

describe('says nothing where it is not positively known', function () {
  this.timeout(120000);
  /** `name` (a file of that name), the script, the shell to run it in, and its status there; null: the status is the tool's (`go` may be absent). */
  type Row = [string, string | Buffer, 'bash' | 'dash', number | null];
  const gz = Buffer.concat([Buffer.from('#!/bin/bash\ntail -n +4 "$0" | tar xz\nexit 0\n'), gzipSync(Buffer.from('payload '.repeat(200))), Buffer.from(")'\"`\n")]);
  const reachedNot: Row[] = [
    ['self-extracting, with text', '#!/bin/bash\ntail -n +4 "$0" | tar xz\nexit 0\n__DATA__\n) ( binary \' " `\n', 'bash', 0],
    ['self-extracting, with gzip', gz, 'bash', 0],
    ['exit', 'exit 0\n)\n', 'bash', 0],
    ['exit in sh', '#!/bin/sh\nexit 0\n)\n', 'dash', 0],
    ['exec', 'exec true\n)\n', 'bash', 0],
    ['exit in `{ }`', '{ echo a; exit 0; }\n)\n', 'bash', 0],
    ['exit in a function', 'main() { exit 0; }\nmain\n__DATA__\n)\n', 'bash', 0],
    ['exit in a branch and in the other', 'if true; then exit 0; else exit 0; fi\n)\n', 'bash', 0],
    ['exit in a case', 'case "$1" in *) exit 0;; esac\n)\n', 'bash', 0],
    ['prose after an exit', "exit 0\nThis is prose, and don't read it.\n", 'bash', 0],
    ['exit after `&&`', '[ x ] && exit 0\n)\n', 'bash', 0],
    ['exit quoted', '"ex"it 0\n)\n', 'bash', 0],
    ['exit with a backslash', '\\exit 0\n)\n', 'bash', 0],
    ['exit over a continuation', 'ex\\\nit 0\n)\n', 'bash', 0],
    ['exit by `command`', 'command exit 0\n)\n', 'bash', 0],
    ['exit by `builtin`', 'builtin exit 0\n)\n', 'bash', 0],
    ['exit by a variable', 'e=exit\n$e 0\n)\n', 'bash', 0],
    ['kill', 'kill -9 $$\n)\n', 'bash', null],
    ['source', 'echo "exit 0" > f.inc\n. ./f.inc\n)\n', 'bash', 0],
    ['source, by its name', 'echo "exit 0" > f.inc\nsource ./f.inc\n)\n', 'bash', 0],
    ['eval', 'eval "exit 0"\n)\n', 'bash', 0],
    ["pip's", '#!/bin/sh\n\'\'\'exec\' true "$0" "$@"\n\' \'\'\'\nprint(")")\n', 'dash', 0],
    ['eval perl', "eval 'exec true -x -wS $0 ${1+\"$@\"}'\n  if 0;\n", 'bash', 0],
    ['exec quoted', '"exec" "true" "$0"\nimport os\nprint(")")\n', 'bash', 0],
    ['python in sh', '""":"\nexec true "$0"\n"""\nprint(")")\n', 'bash', 0],
    ['go', '//usr/bin/env go run "$0"; exit\npackage main\nfunc main() { print(")") }\n', 'bash', null],
    ['set -t', 'set -t\necho a\n)\n', 'bash', 0],
    ['set -t in a cluster', 'set -xt\necho a\n)\n', 'bash', 0],
    ['onecmd', 'set -o onecmd\necho a\n)\n', 'bash', 0],
    ['a NUL on the first line: no script to bash', 'echo a\0b\n)\n', 'bash', 126],
    ['an alias that closes', 'shopt -s expand_aliases\nalias fi2=fi\nif true; then echo; fi2\n', 'bash', 0],
    ['an alias that closes, in sh', '#!/bin/sh\nalias fi2=fi\nif true; then echo; fi2\n', 'dash', 0],
  ];
  for (const [name, text, tool, status] of reachedNot) {
    it(name, () => {
      const r = runFile(text, tool);
      assert.strictEqual(r.syntax, false, `${tool} reports a syntax error`);
      if (status !== null) assert.strictEqual(r.status, status);
      assert.deepStrictEqual(syntax(script(text.toString())), []);
    });
  }

  // (Why `set -e` and `set -u` silence nothing: they stop a script only with a failing status. A script that reaches none
  // of `exit`, `source`, `trap`… never exits 0 with such a fault, whichever way it goes. `syntax`: the run reaches the line.)
  describe('stops first only with a failing status', () => {
    const rows: [string, number, boolean][] = [
      ['set -e\necho a\n)\n', 2, true],
      ['set -e\nfalse\n)\n', 1, false],
      ['set -o errexit\nfalse\n)\n', 1, false],
      ['set -u\necho a\n)\n', 2, true],
      ['set -u\necho "$nope"\n)\n', 1, false],
      ['set -o nounset\necho "$nope"\n)\n', 1, false],
      ['set -eu\nfalse\n)\n', 1, false],
      ['set -eu\necho "$nope"\n)\n', 1, false],
      ['set -euo pipefail\nfalse | true\n)\n', 1, false],
      ['set -euo pipefail\ntrue\n)\n', 2, true],
      ['f() { set -e; false; }\nf\n)\n', 1, false],
      ['f() { set -e; false; }\n)\n', 2, true],
      ['f() { set -e; false; echo more; }\nf || echo x\n)\n', 2, true],
      ['set -e\nfalse || true\n)\n', 2, true],
      ['set -e\nfalse || false\n)\n', 1, false],
      ['set -e\nfalse && true\n)\n', 2, true],
      ['set -e\nif false; then :; fi\n)\n', 2, true],
      ['set -e\n! false\n)\n', 2, true],
      ['set -e\n(false)\n)\n', 1, false],
      ['set -e\nx=$(false)\n)\n', 1, false],
      ['set -e\nfalse &\n)\n', 2, true],
      ['set -e\n{ false; }\n)\n', 1, false],
      ['set -e\nno-such-program-here\n)\n', 127, false],
      ['set -u\n(echo "$nope")\n)\n', 2, true],
      ['set -u\necho $((nope+1))\n)\n', 1, false],
    ];
    for (const [text, status, reached] of rows) {
      it(JSON.stringify(text), () => {
        assert.deepStrictEqual(runFile(text), { status, out: runFile(text).out, syntax: reached });
        assert.strictEqual(syntax(script(text)).length, 1);
      });
    }
    // (In dash, the same: it is what runs `#!/bin/sh`.)
    for (const text of ['#!/bin/sh\nset -e\nfalse\n)\n', '#!/bin/sh\nset -u\necho "$nope"\n)\n', '#!/bin/sh\nset -e\ntrue\n)\n']) {
      it(`${JSON.stringify(text)}, in dash`, () => {
        assert.notStrictEqual(runFile(text, 'dash').status, 0);
        assert.strictEqual(syntax(script(text)).length, 1);
      });
    }
    const firstLines: [string, number, boolean][] = [
      ['#!/bin/bash -e\nfalse\n)\n', 1, false],
      ['#!/bin/bash -e\ntrue\n)\n', 2, true],
      ['#!/bin/bash -u\necho "$nope"\n)\n', 1, false],
      ['#!/bin/sh -e\nfalse\n)\n', 1, false],
      ['#!/usr/bin/env -S bash -eu\nfalse\n)\n', 1, false],
      ['#!/usr/bin/env -S bash -eu\necho "$nope"\n)\n', 1, false],
      ['#!/usr/bin/env -S bash -eu\ntrue\n)\n', 2, true],
    ];
    for (const [text, status, reached] of firstLines) {
      it(`${JSON.stringify(text)}, as a program`, () => {
        const r = runProgram(text);
        assert.deepStrictEqual([r.status, r.syntax], [status, reached]);
        assert.strictEqual(syntax(script(text)).length, 1);
      });
    }
  });

  it('a trap ends it with status 0, after the error', () => {
    const text = 'trap "exit 0" EXIT\n)\n';
    assert.deepStrictEqual([runFile(text).status, runFile(text).syntax], [0, true]);
    assert.deepStrictEqual(syntax(script(text)), []);
  });

  it('a shebang that reads no file, or stops first with status 0', () => {
    // (Run as a program: `bash file` takes the line as a comment.)
    for (const [first, status] of [['#!/bin/bash -t', 0], ['#!/bin/bash -xt', 0], ['#!/bin/bash -s', 0], ['#!/bin/sh -s', 0]] as const) {
      const r = runProgram(`${first}\necho a\n)\n`);
      assert.deepStrictEqual([r.status, r.syntax], [status, false], first);
      assert.deepStrictEqual(syntax(script(`${first}\necho a\n)\n`)), [], first);
    }
    // (Not run: `-c` runs its word, which is this file, again and again.)
    assert.deepStrictEqual(syntax(script('#!/bin/bash -c\necho a\n)\n')), []);
    assert.strictEqual(syntax(script('#!/bin/bash -x\nfalse\n)\n')).length, 1);
    assert.strictEqual(syntax(script('#!/bin/bash --posix\nfalse\n)\n')).length, 1);
    // (A long option: only those that leave the reading alone speak. Measured, as a program.)
    for (const first of ['#!/bin/bash --version', '#!/bin/bash --help', '#!/usr/bin/env -S bash --version']) {
      const r = runProgram(`${first}\necho a\n)\n`);
      assert.deepStrictEqual([r.status, r.syntax], [0, false], first);
      assert.deepStrictEqual(syntax(script(`${first}\necho a\n)\n`)), [], first);
    }
    for (const first of ['#!/bin/bash --login', '#!/bin/bash --posix', '#!/bin/bash --noprofile', '#!/bin/bash --norc', '#!/bin/bash --']) {
      const r = runProgram(`${first}\ntrue\n)\n`);
      assert.deepStrictEqual([r.status === 0, r.syntax], [false, true], first);
      assert.strictEqual(syntax(script(`${first}\ntrue\n)\n`)).length, 1, first);
    }
    assert.deepStrictEqual(syntax(script('#!/bin/bash --rcfile\necho a\n)\n')), []);
  });

  it('`logout` in a login shell, and a callback of `mapfile`, may end it with status 0', () => {
    for (const first of ['#!/bin/bash -l', '#!/bin/bash --login']) {
      const text = `${first}\necho a\nlogout\n)\n`;
      const r = runProgram(text);
      assert.deepStrictEqual([r.status, r.syntax], [0, false], first);
      assert.deepStrictEqual(syntax(script(text)), [], first);
    }
    for (const text of ['mapfile -C "exit 0;" -c 1 x </etc/passwd\n)\n', 'readarray -C "exit 0;" -c 1 x </etc/passwd\n)\n', 'mapfile -tC "exit 0;" -c 1 x </etc/passwd\n)\n', 'command mapfile -C "exit 0;" -c 1 x </etc/passwd\n)\n', 'builtin readarray -C "exit 0;" -c 1 x </etc/passwd\n)\n']) {
      const r = runFile(text);
      assert.deepStrictEqual([r.status, r.syntax], [0, false], text);
      assert.deepStrictEqual(syntax(script(text)), [], text);
    }
    // (Without a callback it ends nothing. The word is enough to be silent: `$o` may be `-C`.)
    assert.strictEqual(syntax(script('mapfile -t x </etc/passwd\n)\n')).length, 1);
    assert.deepStrictEqual(syntax(script('mapfile $o x </etc/passwd\n)\n')), []);
  });

  it('keeps `-n`, which runs nothing', () => {
    for (const text of ['set -n\n)\n', 'set -o noexec\n)\n', '#!/bin/bash -n\n)\n']) assert.deepStrictEqual(syntax(script(text)), [], text);
  });

  it('says none with a NUL anywhere', () => {
    for (const text of ['echo a\0b\n)\n', 'echo a\n\0x\n)\n', 'echo a\n)\n\0\n']) assert.deepStrictEqual(syntax(script(text)), [], JSON.stringify(text));
  });

  it('counts what it cannot read: a word of `set` or `command` read only when it runs', () => {
    for (const text of ['o=-e\nset $o\nfalse\n)\n', 'c=exit\ncommand $c 0\n)\n', 'c=exit\nbuiltin $c 0\n)\n', 'command set -e\nfalse\n)\n']) {
      assert.strictEqual(runFile(text).syntax, false, text);
      assert.deepStrictEqual(syntax(script(text)), [], text);
    }
    assert.strictEqual(syntax(script('command echo a\n)\n')).length, 1);
    assert.strictEqual(syntax(script('set -- a\n)\n')).length, 1);
  });

  it('a `return` ends a file sourced, not a function', () => {
    assert.deepStrictEqual(syntax(script('return 0\n)\n')), []);
    assert.strictEqual(syntax(script('f() { return 0; }\n)\n')).length, 1);
  });

  it('speaks with what cannot end a script before it, and with what comes after', () => {
    for (const text of ['echo a\n)\n', 'set -x\n)\n', 'set +e\n)\n', 'exiting\n)\n', 'echo exit\n)\n', '# exit 0\n)\n', "echo 'exit'\n)\n", ')\nexit 0\n', 'x=1\n)\n', 'if a; then\n  exit 1\n']) {
      assert.strictEqual(syntax(script(text)).length, 1, text);
      assert.strictEqual(runFile(text).syntax, true, text);
    }
  });

  it('says none in a file with a template marker, wherever it is', () => {
    for (const text of ['echo <%= x %>\n', '#!/bin/bash\necho a\n<% if x %>\n', 'echo {{ x }}\n)\n', "docker ps --format '{{.Names}}'\n)\n", '#!/bin/bash\necho a\n)\necho {% x %}\n', 'x=@VAR@\n)\n', 'echo << parameters.x >>\n', '<<# parameters.y >> echo z <</ parameters.y >>\n', 'echo $[[ inputs.x ]] )\n']) assert.deepStrictEqual(syntax(script(text)), [], text);
    // (A here-document appending to a file is none.)
    assert.strictEqual(syntax(script('cat <<E >>f\nx\nE\n)\n')).length, 1);
    assert.strictEqual(syntax(script('echo "$@"@"$x"\n)\n')).length, 1);
    const doc = script('echo <%= x %>\n');
    assert.deepStrictEqual(documentIssues(doc, 'en', shellsOf(doc.lines, 'x.sh.erb', undefined)).filter((i) => i.code === 'syntax-error'), []);
  });
});

describe('how a file is known to be a script decides the level', () => {
  const levels = (text: string, name: string, given?: ScriptEvidence, forced?: Shell) => {
    const doc = script(text);
    return documentIssues(doc, 'en', shellsOf(doc.lines, name, forced, given)).filter((i) => /^(?:syntax-error|bad-substitution)/.test(i.code)).map((i) => [i.code, i.severity]);
  };
  const faults: [string, string, string][] = [['echo ok )\n', 'syntax-error', 'syntax-error-if-bash'], ['echo ${(f)x}\n', 'bad-substitution-always', 'bad-substitution-if-bash']];

  it('only a name, or an editor\'s language: a warning', () => {
    for (const [text, , code] of faults) {
      for (const [name, given] of [['a.sh'], ['d/a.sh'], ['a.bash'], ['.bashrc'], ['a.txt', 'name'], ['a.sh', 'name'], ['Untitled-1', 'name']] as [string, ScriptEvidence | undefined][]) {
        assert.deepStrictEqual(levels(text, name, given), [[code, 'warning']], `${text} ${name}`);
      }
    }
  });

  it('a first line, a directive, `--shell`, `-e`, the web page: an error', () => {
    for (const [text, code] of faults) {
      // (What `#!/bin/sh` reads of `${(f)x}`, dash's, is not this fact: `#!/bin/sh` has only the syntax error here.)
      for (const first of code === 'syntax-error' ? ['#!/bin/bash\n', '#!/usr/bin/env bash\n', '#!/bin/sh\n'] : ['#!/bin/bash\n', '#!/usr/bin/env bash\n']) {
        for (const name of ['a', 'a.sh', 'a.txt']) assert.deepStrictEqual(levels(`${first}${text}`, name), [[code, 'error']], `${first} ${name}`);
      }
      assert.deepStrictEqual(levels(`# shellcheck shell=bash\n${text}`, 'a.sh'), [[code, 'error']]);
      assert.deepStrictEqual(levels(text, 'a.sh', undefined, 'bash'), [[code, 'error']], 'a shell chosen');
      assert.deepStrictEqual(levels(text, 'a.sh', 'said'), [[code, 'error']], 'given');
      assert.deepStrictEqual(levels(text, 'a', 'said'), [[code, 'error']], 'given, with no name');
    }
  });

  it('valid zsh in a file another shell may source is no error', () => {
    for (const text of ['a=(${(f)"$(x)"})\n', 'for f (a b) echo $f\n', '() { echo anon }\n']) {
      const named = levels(text, 'aliases.sh');
      assert.ok(named.length && named.every(([, severity]) => severity === 'warning'), text);
      assert.ok(levels(`#!/bin/bash\n${text}`, 'aliases.sh').some(([, severity]) => severity === 'error'), text);
    }
  });

  it('says the same words at both levels', () => {
    for (const lang of ['en', 'ja'] as const) {
      for (const [text, error, warning] of faults) {
        const of = (shells: Shells, code: string) => documentIssues(script(text), lang, shells).find((i) => i.code === code)!.message;
        assert.strictEqual(of({ script: 'name' }, warning).replace(/^\S+ /, ''), of({ script: 'said' }, error).replace(/^\S+ /, ''), text);
      }
    }
  });

  it('is no pitfall at either level: a fault of the text is no advice', () => {
    for (const shells of [{ script: 'said' }, { script: 'name' }] as const) {
      for (const text of ['echo ok )\n', 'echo ${(f)x}\n']) {
        const found = documentIssues(script(text), 'en', shells).filter((i) => /^(?:syntax-error|bad-substitution)/.test(i.code));
        assert.strictEqual(found.length, 1, text);
        assert.strictEqual(found[0].pitfall, undefined, text);
      }
    }
  });

  it('a name of another shell says nothing, whoever says it is a script', () => {
    for (const name of ['x.fish', 'd/config.fish', 'x.csh', '.cshrc', 'x.tcsh', '.tcshrc', 'x.zsh', 'x.zsh-theme', 'x.ksh', '.kshrc', '.mkshrc', '.yashrc', '.yash_profile', '.zshrc']) {
      for (const given of [undefined, 'name', 'said'] as const) {
        assert.deepStrictEqual(levels('if test a\n  echo b\nend\n', name, given), [], `${name} ${given}`);
        assert.deepStrictEqual(levels('echo ok )\n', name, given), [], `${name} ${given}`);
      }
    }
    assert.strictEqual(readShell('', 'x.zsh-theme').shell, 'zsh');
    assert.strictEqual(readShell('', '.kshrc').shell, 'ksh');
    assert.strictEqual(readShell('', '.yashrc').shell, 'yash');
    // (A first line still decides: it is what runs.)
    assert.deepStrictEqual(levels('#!/bin/bash\necho ok )\n', 'x.fish'), [['syntax-error', 'error']]);
  });
});

describe('names the token the shell names', function () {
  this.timeout(120000);
  // (The table is the design: a token is named only for a shape it has, and every token named on it is what the tool names. See `bashNames`.)
  const { contexts, shapes, alone } = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'syntax-tokens.json'), 'utf8')) as { contexts: string[]; shapes: string[]; alone: string[] };
  const rows = [...new Set([...contexts.flatMap((c) => shapes.map((s) => `${c}${s}\n`)), ...alone.map((s) => `${s}\n`), ...fixture.scripts])];

  function check(tool: string, shell: Shell, agrees: (what: SyntaxErrorWhat, message: string) => boolean | undefined) {
    const found = rows.flatMap((s) => {
      const fault = syntaxFault(parser.parse(s), shell);
      return fault && !fault.said ? [{ s, what: fault.what }] : [];
    });
    const said = shellSays(tool, found.map((f) => f.s));
    const judged = found.map((f, i) => ({ ...f, message: said[i].message, agrees: agrees(f.what, said[i].message) }));
    assert.strictEqual(judged.filter((j) => j.agrees === false).map((j) => `${JSON.stringify(j.s)}: ${JSON.stringify(j.what)}; ${j.message}`).join('\n'), '');
    return judged.filter((j) => j.agrees).length;
  }

  it('has at least the shapes of its reviews', () => {
    assert.ok(rows.length > 2000, `only ${rows.length} rows`);
    for (const s of ['echo (hello)', 'print("x")', 'foo(bar, baz)', 'cat a | grep (x)', 'for x in (a b); do c; done', 'case x y in', 'function ()']) assert.ok(rows.includes(`${s}\n`), s);
  });

  it('every token named is what bash -n names', () => {
    if (!has('bash', /version 5\.2/)) return;
    assert.ok(check('bash', 'bash', agreesWithBash) > 1000);
  });

  it('every token named is what dash -n names, for sh', () => {
    assert.ok(check('dash', 'sh', agreesWithDash) > 800);
  });

  it('every token named is what bash 5.3 names', function () {
    const bash53 = process.env.BASH_EXPLAINER_BASH53;
    if (!bash53) this.skip();
    assert.ok(check(bash53!, 'bash', agreesWithBash) > 1000);
  });

  it('names what bash names in the shapes of a beginner, and says nothing of what it cannot', () => {
    const named: [string, SyntaxErrorWhat][] = [
      ['echo (hello)\n', { kind: 'after-paren', token: 'hello' }],
      ['print("x")\n', { kind: 'after-paren', token: '"x"' }],
      ['foo(bar, baz)\n', { kind: 'after-paren', token: 'bar,' }],
      ['cat a | grep (x)\n', { kind: 'after-paren', token: 'x' }],
      ['echo a (b)\n', { kind: 'token', token: '(' }],
      ['a=1 echo (b)\n', { kind: 'token', token: '(' }],
      ['function ()\n', { kind: 'token', token: '(' }],
      ['for x in (a b); do c; done\n', { kind: 'unreadable' }],
      ['case x y in\n', { kind: 'unreadable' }],
      ['f() "a\n', { kind: 'unreadable' }],
      ['foo(a\\\nb)\n', { kind: 'unreadable' }],
      ['[[ a "b\nc" ]]\n', { kind: 'unreadable' }],
      ['if a; then <\n', { kind: 'unreadable' }],
      ['echo ok )\n', { kind: 'token', token: ')' }],
      ['if a; then\n', { kind: 'missing', token: 'fi' }],
      ['x=(1 2\n', { kind: 'missing', token: ')' }],
    ];
    for (const [s, what] of named) assert.deepStrictEqual(syntaxFault(parser.parse(s), 'bash')?.what, what, s);
  });

  it('says a token nowhere with a line end in it', () => {
    for (const s of rows) {
      const what = syntaxFault(parser.parse(s), 'bash')?.what;
      assert.ok(!what || !('token' in what) || !what.token.includes('\n'), JSON.stringify(s));
    }
  });

  it('points at what it names, and hints at quotes only for `word (`, where it is true', () => {
    const fault = syntaxFault(parser.parse('echo (hello)\n'), 'bash')!;
    assert.strictEqual(fault.node.text, 'hello');
    const [one] = problems(script('echo (hello)\n'));
    assert.match(one.message, /`hello` cannot stand here.*parentheses meant as text need quotes$/);
    assert.doesNotMatch(problems(script('echo a (b)\n'))[0].message, /quotes/);
    assert.match(problems(script('echo (hello)\n'), undefined, undefined, 'ja')[0].message, /`hello` は書けない.*クォートする$/);
  });
});

describe('says none in the shell code of another file', () => {
  const found = (file: string, text: string) => {
    const doc = openDocument(text, hostKind('', file, text) as HostKind, (t) => parser.parse(t));
    return documentIssues(doc, 'en', shellsOf(doc.lines, file, undefined, 'said')).filter((i) => i.code === 'syntax-error').length;
  };
  const step = (run: string) => `on: push\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n${run}`;
  // (Each host a broken line, then what the review of #597 found would have failed on working code, had hosts spoken:
  // docs/roadmap.md, "Syntax problems in hosts". These inputs are the table for that work.)
  const rows: [string, string, string][] = [
    ['a broken recipe', 'Makefile', 'a:\n\techo ok )\n'],
    ['a broken RUN', 'Dockerfile', 'FROM a\nRUN echo ok )\n'],
    ['a broken bats test', 't.bats', '#!/usr/bin/env bats\n@test "a" {\n  echo ok )\n}\n'],
    ['a broken GitHub step', '.github/workflows/a.yml', step('      - run: echo ok )\n')],
    ['a broken CircleCI step', '.circleci/config.yml', 'version: 2.1\njobs:\n  a:\n    docker: [{image: x}]\n    steps:\n      - run: echo ok )\n'],
    ['make: export SHELL :=', 'Makefile', 'export SHELL := python3\na:\n\tprint((1)\n'],
    ['make: override SHELL :=', 'Makefile', 'override SHELL := python3\na:\n\tprint((1)\n'],
    ['make: SHELL ::=', 'Makefile', 'SHELL ::= python3\na:\n\tprint((1)\n'],
    ['make: a SHELL of a target', 'Makefile', 'py: SHELL := python3\npy:\n\tprint((1)\n'],
    ['make: a Python define', 'Makefile', 'define PY\nx:\n\tprint((1)\nendef\n'],
    ['make: an include with .ONESHELL', 'Makefile', 'include common.mk\na:\n\tif a; then\n\techo b\n\tfi\n'],
    ['make: ifeq branches', 'Makefile', 'a:\nifeq ($(OS),Windows_NT)\n\tif exist a (echo b)\nelse\n\techo b\nendif\n'],
    ['CircleCI: shell of a step', '.circleci/config.yml', 'version: 2.1\njobs:\n  a:\n    docker: [{image: x}]\n    steps:\n      - run:\n          shell: python3\n          command: print((1)\n'],
    ['CircleCI: shell of a job', '.circleci/config.yml', 'version: 2.1\njobs:\n  a:\n    shell: python3\n    docker: [{image: x}]\n    steps:\n      - run: print((1)\n'],
    ['CircleCI: shell of an executor', '.circleci/config.yml', 'version: 2.1\nexecutors:\n  e:\n    shell: python3\njobs:\n  a:\n    executor: e\n    steps:\n      - run: print((1)\n'],
    ['GitHub: self-hosted', '.github/workflows/a.yml', 'on: push\njobs:\n  a:\n    runs-on: self-hosted\n    steps:\n      - run: if exist a (echo b)\n'],
    ['GitHub: labels', '.github/workflows/a.yml', 'on: push\njobs:\n  a:\n    runs-on: [self-hosted, my-label]\n    steps:\n      - run: if exist a (echo b)\n'],
    ['GitHub: a group', '.github/workflows/a.yml', 'on: push\njobs:\n  a:\n    runs-on: {group: g, labels: win}\n    steps:\n      - run: Get-Item a)\n'],
    ['GitHub: flow-style defaults', '.github/workflows/a.yml', 'on: push\ndefaults: {run: {shell: pwsh}}\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: Get-Item a)\n'],
    ['GitHub: `run:` under `env:`', '.github/workflows/a.yml', step('      - env:\n          run: print((1)\n        run: echo a\n')],
    ['GitHub: `run:` under `with: x:`', '.github/workflows/a.yml', step('      - uses: a/b@v1\n        with:\n          x:\n            run: print((1)\n')],
    ['GitHub: a matrix value holding syntax', '.github/workflows/a.yml', step('      - run: if a; then ${{ matrix.body }}\n')],
    ['Dockerfile: a here-document for python3', 'Dockerfile', 'FROM a\nRUN <<EOT python3\nprint((1)\nEOT\n'],
    ['Dockerfile: a here-document into a file', 'Dockerfile', 'FROM a\nRUN <<EOT cat > /etc/x\nprint((1)\nEOT\n'],
    ['Dockerfile: an empty continuation line', 'Dockerfile', 'FROM a\nRUN if a; then \\\n\n  b; \\\n  fi\n'],
  ];
  for (const [name, file, text] of rows) it(name, () => assert.strictEqual(found(file, text), 0));
});
