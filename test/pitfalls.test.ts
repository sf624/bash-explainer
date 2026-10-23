import * as assert from 'assert';
import { spawnSync } from 'child_process';
import * as path from 'path';
import type { BashParser as Parser } from '../src/syntax/tree';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { pitfallNotes } from '../src/pitfalls';
import { wordFacts } from '../src/wordfacts';
import * as fs from 'fs';
import { Analyzer } from '../src/analyzer';
import { explainHostedLine, extractShell, hostKind } from '../src/hosts';
import { MESSAGES, fact, said, type FactId } from '../src/messages';

const root = path.join(__dirname, '..');
let parser: Parser;

before(async () => {
  parser = createUnbashParser();
});

function notes(src: string, line = 0, lang: 'en' | 'ja' = 'en'): string[] {
  const tree = parser.parse(src);
  return pitfallNotes(tree.root, line, lang);
}

describe('pitfalls', () => {
  const cases: [string, RegExp][] = [
    ['x = 1', /runs a command named `x`; it is not an assignment/],
    ['rm -rf $DIR/build', /if `DIR` is empty this becomes `rm -r \/build`/],
    ['rm -rf "${DIR}/build"', /if `DIR` is empty/],
    ['[-f x]', /`\[` is an ordinary command, so a space must follow it \(`\[-f` reads as another command name\)/],
    ['[ -f x]', /the `\]` in `x\]` is read as part of the word/],
    ['[ "$a" < "$b" ]', /`<` inside `\[ \]` is read as a redirection, not a comparison/],
    ['[ -f x && -n y ]', /`&&` inside `\[ \]` is not an argument of `\[`/],
    ['while read line; do :; done < f', /without `-r`, backslashes/],
    // `time` times what follows; what follows is a command like any other.
    ['time read x', /without `-r`, backslashes/],
    ['time -p rm -rf $DIR/x | cat', /if `DIR` is empty/],
  ];
  for (const [src, expected] of cases) {
    it(`points out ${src}`, () => assert.ok(notes(src).some((n) => expected.test(n)), notes(src).join('\n') || '(none)'));
  }

  const fine = [
    'x=1', 'rm -rf "${DIR:?}/build"', 'rm -rf "$HOME/.cache"', 'rm -f "$tmp"', 'for f in *.txt; do :; done', '[ "$x" = y ]', '[[ $x = y ]]',
    '[ -f x ] && [ -n y ]', '[ "$a" \\< "$b" ]', '[ -f x ] || [ -n y ]', '[ $? -eq 0 ]', '[ $# -gt 0 ]', '[ ${#a[@]} -eq 0 ]', '[ "$(stat -c %a $f)" -le 600 ]', 'read -r line', 'read', 'read -n 1 key',
    'local out', 'out=$(cmd)', 'echo 1 | sudo tee /proc/x', 'sudo cmd > /dev/null', 'sudo dmesg > dmesg.log', 'for a in "$@"; do :; done', 'cp "$src" "$dst"', 'echo $x',
  ];
  for (const src of fine) {
    it(`says nothing about ${src}`, () => assert.deepStrictEqual(notes(src), []));
  }

  it('speaks Japanese, and only on the line where the construct starts', () => {
    assert.match(notes('x = 1', 0, 'ja')[0], /^⚠ 落とし穴: `x =…` は代入ではなく/);
    assert.deepStrictEqual(notes('for f in $(ls); do\n  echo "$f"\ndone', 1), []);
  });
});

describe('the spacing of [ ], against bash', () => {
  const bash = (cmd: string) => spawnSync('bash', ['-c', cmd], { encoding: 'utf8' });
  const have = spawnSync('bash', ['-c', ':']).status === 0;
  const cases: [string, 'ok' | 'fails'][] = [
    ['[ -d / ]', 'ok'], ['[-d /]', 'fails'], ['[ -d /]', 'fails'], ['[ -d / ]', 'ok'], ['[ -d / ] && [ -d /tmp ]', 'ok'],
    ['[ -d / && -d /tmp ]', 'fails'], ['a=1; b=2; [ $a < $b ]', 'fails'], ['a=1; b=2; [ "$a" \\< "$b" ]', 'ok'], ['a=; [ $a = x ]', 'fails'],
  ];
  for (const [cmd, expected] of cases) {
    it(`${cmd}: ${expected}`, function () {
      if (!have) return this.skip();
      const r = bash(cmd);
      // `ok` runs without a syntax or usage error (a false test is status 1 with no message); `fails` prints an error.
      if (expected === 'ok') assert.ok(r.status !== null && r.stderr === '', r.stderr);
      else assert.ok(r.stderr !== '' || r.status === 127, `${r.status} ${r.stderr}`);
      // The tool finds the same mistake.
      const one = cmd.replace(/^a=.*?; /, '').replace(/^a=1; b=2; /, '');
      const mistakes = notes(one).length > 0 || wordFacts(parser.parse(one).root, 0, 'en').length > 0;
      if (expected === 'fails') assert.ok(mistakes, cmd);
    });
  }
});

// The setting `notes.pitfalls` is applied where a note is said (Analyzer.say), by the pitfall kind of its catalog entry.
describe('the pitfall gate', () => {
  const explainNotes = (src: string, line: number, pitfalls: boolean) =>
    new Analyzer('en').explainLine(parser.parse(src), line, undefined, { pitfalls }).notes;

  it('the [[ =~ ]] backslash note disappears with pitfalls off; bash does read \\b as b', () => {
    const src = '[[ $x =~ \\bfoo ]]';
    assert.ok(explainNotes(src, 0, true).some((n) => /^⚠ In `\[\[ =~ \]\]`, an unquoted `\\b` loses its backslash/.test(n)));
    assert.deepStrictEqual(explainNotes(src, 0, false).filter((n) => /⚠/.test(n)), []);
    const r = spawnSync('bash', ['--norc', '--noprofile', '-c', "x=bfoo; [[ $x =~ \\bfoo ]] && echo match"], { encoding: 'utf8', env: { PATH: process.env.PATH, LC_ALL: 'C' } });
    assert.strictEqual(r.stdout.trim(), 'match');
  });
  it('the distro-alias note of ll disappears with pitfalls off; a README keeps its ℹ note', () => {
    assert.ok(explainNotes('ll /tmp', 0, true).some((n) => /^⚠ System-dependent: `ll`/.test(n)));
    assert.deepStrictEqual(explainNotes('ll /tmp', 0, false).filter((n) => /System-dependent/.test(n)), []);
    const readme = new Analyzer('en').explainLine(parser.parse('ll /tmp'), 0, undefined, { pitfalls: false, host: 'Markdown' }).notes;
    assert.ok(readme.some((n) => /^ℹ System-dependent: `ll`/.test(n)));
  });
  it('a syntax error is not a pitfall: the missing then stays with pitfalls off', () => {
    const notes = explainNotes('if [ -f a ] then echo x; fi', 0, false);
    assert.ok(notes.some((n) => /Syntax error: a `;` or a newline is needed before `then`/.test(n)), notes.join('|'));
  });

  // A host file (src/hosts.ts): every note of a line, with the setting on or off.
  const hostNotes = (file: string, pitfalls: boolean, lang: 'en' | 'ja' = 'en') => {
    const src = fs.readFileSync(path.join(root, 'test/fixtures/hosts', file), 'utf8');
    const kind = hostKind('', file, src)!;
    const extracted = extractShell(kind, src);
    const tree = parser.parse(extracted.text);
    const lines = src.split('\n');
    return lines.flatMap((_, i) => explainHostedLine(new Analyzer(lang), tree, extracted, lines, i, lang, undefined, { pitfalls })?.notes ?? []);
  };
  const has = (notes: string[], re: RegExp) => notes.some((n) => re.test(n));
  for (const [file, name, re] of [
    ['Dockerfile', 'the Dockerfile pipefail note', /^⚠ If a command in the middle of the pipe fails, RUN still succeeds/],
    ['deploy.py', 'the Python string-without-shell note', /^⚠ Without shell=True the whole string/],
    ['deploy.py', 'the Python shell injection note', /^⚠ Shell injection risk: the shell runs a string/],
    ['action.yml', 'the Actions script injection note', /^⚠ Script injection risk: `github\.event\.pull_request\.title`/],
    ['test.bats', 'a bats pitfall', /^⚠ Pitfall: /],
  ] as const) {
    it(`${name} disappears with pitfalls off, and is the same text with them on`, () => {
      assert.ok(has(hostNotes(file, true), re));
      assert.ok(!has(hostNotes(file, false), re));
      assert.ok(has(hostNotes(file, true, 'ja'), /^⚠ /));
    });
  }
  it('said keeps the notes with pitfalls off and the pitfalls with them on', () => {
    const fs2 = [fact('en', 'exit-modulo', { value: '256', status: 0 }), fact('en', 'local-outside-function')];
    assert.deepStrictEqual(said(fs2, false).map((f) => f.id), ['exit-modulo']);
    assert.deepStrictEqual(said(fs2, true).map((f) => f.id), ['exit-modulo', 'local-outside-function']);
    assert.deepStrictEqual(said(fs2, undefined).length, 2);
  });
  it('only a pitfall has a heading in the catalog', () => {
    for (const [id, e] of Object.entries(MESSAGES) as [FactId, { kind: string; heading?: unknown }][]) {
      if (e.heading) assert.strictEqual(e.kind, 'pitfall', id);
    }
  });
});
