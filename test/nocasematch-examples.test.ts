import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Analyzer } from '../src/analyzer';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { runContained, scoped } from './support/contained';

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
  }
  for (const g of GLOB) {
    rows.push({ src: `${state}; [[ $ans == ${g} ]]`, test: (s) => `[[ $s == ${g} ]]`, nocase });
    rows.push({ src: `${state}; case $ans in ${g}) echo ok;; esac`, test: (s) => `case $s in ${g}) true;; *) false;; esac`, nocase });
  }
}

describe('examples under nocasematch', () => {
  it('the strings of each example are those bash gives, with nocasematch on and off', async function () {
    this.timeout(60000);
    if (!scoped) return this.skip();
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
    for (const src of ['shopt -s nocasematch; [[ $ans =~ ^(y|yes)$ ]]', 'shopt -s nocasematch; [[ $ans =~ ^"y"es?$ ]]']) {
      const ex = exampleLines(src)!;
      assert.ok(!ex.no.includes('Y') && !ex.no.includes('YES'), src);
    }
  });

  it('where nocasematch may be on, or is not known, there is no example', () => {
    for (const src of [
      'if c; then shopt -s nocasematch; fi; [[ $ans =~ ^(y|yes)$ ]]',
      'if c; then shopt -s nocasematch; fi; [[ $ans == y* ]]',
      'if c; then shopt -s nocasematch; fi; case $ans in y*) :;; esac',
    ]) assert.strictEqual(exampleLines(src), undefined, src);
  });
});
