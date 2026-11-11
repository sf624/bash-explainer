import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Analyzer } from '../src/analyzer';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { runContained } from './support/contained';

// The examples of `[[ =~ ]]`, `[[ == ]]` and `case` follow `nocasematch`: surely on, their strings are those bash gives with it on; where it may be on,
// there is no example. Bash runs once over every string the examples show (the table below), with the option on and off.

const parser = createUnbashParser();
const analyzer = new Analyzer('en');
const exampleLines = (src: string): { yes: string[]; no: string[] } | undefined => {
  const lines = src.split('\n');
  const ex = analyzer.explainLine(parser.parse(src), lines.length - 1, 'bash').examples.filter((e) => e.sections);
  if (!ex.length) return undefined;
  const [yes, no] = ex[0].sections!;
  // (A test's lines assign the variable: `ans="yes"`.)
  const value = (l: string) => /^ans="(.*)"$/.exec(l)?.[1] ?? l;
  return { yes: (yes?.lines ?? []).map(value), no: (no?.lines ?? []).map(value) };
};

const ERE = ['^(y|yes)$', '^[a-z]+$', '[[:upper:]]', '^[A-Z][0-9]+$'];
const GLOB = ['[a-z]*', 'yes', '[[:upper:]]*', '[[:lower:]]*', '[A-Z][0-9]*'];
const ON = 'shopt -s nocasematch';
const OFF = 'shopt -u nocasematch';

interface Row { src: string; test: (s: string) => string; nocase: boolean }
const rows: Row[] = [];
for (const [state, nocase] of [[ON, true], [OFF, false]] as const) {
  for (const re of ERE) {
    rows.push({ src: `${state}; [[ $ans =~ ${re} ]]`, test: (s) => `[[ $s =~ ${re} ]]`, nocase });
    // (The value of a variable, read as the regex: the same example.)
    for (const ref of ['$re', '${re}']) rows.push({ src: `${state}; re='${re}'; [[ $ans =~ ${ref} ]]`, test: (s) => `re='${re}'; [[ $s =~ ${ref} ]]`, nocase });
  }
  for (const g of GLOB) {
    rows.push({ src: `${state}; [[ $ans == ${g} ]]`, test: (s) => `[[ $s == ${g} ]]`, nocase });
    rows.push({ src: `${state}; case $ans in ${g}) echo ok;; esac`, test: (s) => `case $s in ${g}) true;; *) false;; esac`, nocase });
  }
}

describe('examples under nocasematch', () => {
  it('the strings of each example are those bash gives, with nocasematch on and off', async function () {
    this.timeout(60000);
    const dir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? os.tmpdir(), 'nocase-'));
    try {
      const checks: { row: Row; s: string; want: boolean }[] = [];
      let script = '';
      for (const row of rows) {
        const ex = exampleLines(row.src);
        // (A pattern's `[:upper:]` is not folded by bash, as the regex's would be: no example, with the option on.)
        if (!ex) {
          assert.ok(row.nocase && /\[:(upper|lower):\]/.test(row.src) && !row.src.includes('=~'), row.src);
          continue;
        }
        for (const [list, want] of [[ex.yes, true], [ex.no, false]] as const) {
          for (const s of list) {
            const i = checks.push({ row, s, want }) - 1;
            fs.writeFileSync(path.join(dir, `s${i}`), s);
            script += `${row.nocase ? ON : OFF}; s=$(cat ${path.join(dir, `s${i}`)}); if ${row.test(s)}; then echo ${i}:1; else echo ${i}:0; fi\n`;
          }
        }
      }
      fs.writeFileSync(path.join(dir, 'run.sh'), script);
      const r = await runContained(['bash', path.join(dir, 'run.sh')], dir, {}, 40000);
      const got = new Map(r.stdout.split('\n').filter(Boolean).map((l) => l.split(':') as [string, string]));
      for (let i = 0; i < checks.length; i++) {
        const c = checks[i];
        assert.strictEqual(got.get(String(i)) === '1', c.want, `${c.row.src}: ${JSON.stringify(c.s)}`);
      }
      assert.ok(checks.length > 40);
    } finally {
      fs.rmSync(dir, { recursive: true });
    }
  });

  it('`Y` is not listed as a non-match of `^(y|yes)$` once nocasematch is on', () => {
    for (const src of ['shopt -s nocasematch; [[ $ans =~ ^(y|yes)$ ]]', 'shopt -s nocasematch; [[ $ans =~ ^"y"es?$ ]]', "shopt -s nocasematch; re='^(y|yes)$'; [[ $ans =~ $re ]]"]) {
      const ex = exampleLines(src)!;
      assert.ok(!ex.no.includes('Y') && !ex.no.includes('YES'), src);
    }
  });

  it('where nocasematch may be on, or is not known, there is no example', () => {
    for (const src of [
      'if c; then shopt -s nocasematch; fi; [[ $ans =~ ^(y|yes)$ ]]',
      'if c; then shopt -s nocasematch; fi; re=\'^(y|yes)$\'; [[ $ans =~ $re ]]',
      'if c; then shopt -s nocasematch; fi; re=\'^(y|yes)$\'; [[ $ans =~ ${re} ]]',
      'if c; then shopt -s nocasematch; fi; [[ $ans == y* ]]',
      'if c; then shopt -s nocasematch; fi; case $ans in y*) :;; esac',
    ]) assert.strictEqual(exampleLines(src), undefined, src);
  });

  it('after `source`, nocasematch is taken as set before: the examples and the plain pattern stay', () => {
    for (const src of ['source ./x.sh; [[ $a =~ ^y$ ]]', '. ./x.sh; [[ $a == y* ]]', 'eval "$x"; case $a in y*) :;; esac']) {
      const ex = exampleLines(src);
      assert.ok(ex && ex.yes.length > 0, src);
    }
    // (`y` has no wildcard: read as plain text, as before `source` it is, so the test example is made.)
    const tests = analyzer.explainLine(parser.parse('source ./x.sh; [[ $a == y ]]'), 0, 'bash').examples;
    assert.ok(tests.some((e) => e.kind === 'test'));
  });

  it('under nocaseglob a file pattern with [:upper:] gets no example, as bash folds neither', async () => {
    const ex = analyzer.explainLine(parser.parse('shopt -s nocaseglob; ls [[:upper:]]*'), 0, 'bash').examples;
    assert.ok(!ex.some((e) => e.kind === 'glob'));
    const dir = fs.mkdtempSync(path.join(process.env.TMPDIR ?? os.tmpdir(), 'nocase-'));
    try {
      for (const f of ['abc', 'Abc', 'xyz']) fs.writeFileSync(path.join(dir, f), '');
      const r = await runContained(['bash', '-c', 'shopt -s nocaseglob; echo [[:upper:]]*; echo [a-z]bc'], dir);
      assert.strictEqual(r.stdout, 'Abc\nAbc abc\n');
    } finally {
      fs.rmSync(dir, { recursive: true });
    }
  });

  it('`${x//[[:lower:]]/X}` under nocasematch is as bash gives it', async () => {
    const ex = analyzer.explainLine(parser.parse('shopt -s nocasematch; x=aBc; y=${x//[[:lower:]]/X}; echo "$y"'), 0, 'bash');
    const text = JSON.stringify(ex);
    // (bash does not fold the class: `XBX`; the model does not claim a value it cannot give.)
    assert.ok(!text.includes('XXX"') && !text.includes('`XXX`'), 'a value XXX');
    const r = await runContained(['bash', '-c', 'shopt -s nocasematch; x=aBc; echo "${x//[[:lower:]]/X}"'], os.tmpdir());
    assert.strictEqual(r.stdout, 'XBX\n');
  });
});
