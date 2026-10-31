// The rewrites of the two advice checks of src/pitfalls.ts that carry them since the panel redesign's P3
// (docs/design/panel-redesign.md; docs/design/oracles.md, 3.5): `source-searches-path` and `pattern-from-variable`.
// Their exact rewrites on hand-written inputs, the notes rendered from them, and the rewritten scripts run in bash
// (5.2, and 5.3 when `$BASH_EXPLAINER_BASH53` names one), in a cgroup: the meaning is kept, the hazard is gone, the
// rewrite parses, and explaining it raises no finding of the same check. The walls of test/support/rewrite-states.ts
// refuse `source` and `.`, so the states of `source-searches-path` run here, with a file of the name in `$PATH`, one in
// the current directory and one beside the script; grep runs there too (`pattern-from-variable`), and here as `egrep`.
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Shell } from '../src/dialect';
import { pitfallFindings, type StyleCode } from '../src/pitfalls';
import { shellState } from '../src/semantics/state';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { runContained } from './support/contained';
import { applied, programs } from './support/rewrites';

const parser = createUnbashParser();

/** The findings of check `code` in `src`, read as `shell`. */
function findings(src: string, code: StyleCode, shell?: Shell) {
  const tree = parser.parse(src);
  return pitfallFindings(tree.root, 'en', 0, src.split('\n').length, shellState(tree, shell), shell).filter((f) => f.code === code);
}

/** The rewritten scripts of the one finding of `code` in `src`, each with the code its note shows. */
function rewrites(src: string, code: StyleCode, shell?: Shell): [code: string, script: string][] {
  const found = findings(src, code, shell);
  assert.strictEqual(found.length, 1, `one finding of ${code} in ${JSON.stringify(src)}`);
  return (found[0].rewrite ?? []).map((r) => [r.code, applied(src, r)]);
}

/**
 * Runs `driver` in bash `program` in a new directory holding `files` (by their paths; one that starts with `#!` is
 * executable), from its subdirectory `cwd`, with `bin` first on PATH: what it printed, the directory named `DIR`.
 */
async function inBox(program: string, files: Readonly<Record<string, string>>, driver: string, env: Record<string, string> = {}): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explain-bash-advice-'));
  try {
    for (const [f, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
      fs.writeFileSync(path.join(dir, f), text, { mode: text.startsWith('#!') ? 0o755 : 0o644 });
    }
    fs.mkdirSync(path.join(dir, 'cwd'), { recursive: true });
    const r = await runContained([program, '--norc', '--noprofile', '-c', driver], path.join(dir, 'cwd'), { PATH: `${dir}/bin:/usr/bin:/bin`, BASH_BIN: program, ...env });
    return (r.stdout + r.stderr).split(dir).join('DIR');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('the rewrites of `source-searches-path`', () => {
  const ID = 'source-searches-path';
  const BASH_DIR = '"$(dirname "${BASH_SOURCE[0]}")"/';

  it('put the script\'s directory before the name, or `./`', () => {
    assert.deepStrictEqual(rewrites('source lib.sh', ID), [
      [`source ${BASH_DIR}lib.sh`, `source ${BASH_DIR}lib.sh`], ['source ./lib.sh', 'source ./lib.sh'],
    ]);
    // (The word as written: quoted, and in a function, where `BASH_SOURCE` still names the file being read.)
    assert.deepStrictEqual(rewrites('f() {\n  . "lib.sh"\n}', ID).map(([, s]) => s), [`f() {\n  . ${BASH_DIR}"lib.sh"\n}`, 'f() {\n  . ./"lib.sh"\n}']);
    assert.deepStrictEqual(rewrites('#!/bin/bash\nset -o posix\nsource lib.sh x', ID).map(([c]) => c), [`source ${BASH_DIR}lib.sh`, 'source ./lib.sh']);
  });
  it('name the directory by `$0` in sh, only where the file is run; none in a file that may be sourced, or typed into a terminal', () => {
    assert.deepStrictEqual(rewrites('#!/bin/sh\n. lib.sh', ID, 'sh').map(([c]) => c), ['. "$(dirname "$0")"/lib.sh', '. ./lib.sh']);
    assert.deepStrictEqual(rewrites('. lib.sh', ID, 'sh').map(([c]) => c), ['. ./lib.sh']);
    const tree = parser.parse('source lib.sh');
    const model = shellState(tree, 'bash', { read: 'terminal' });
    assert.deepStrictEqual(pitfallFindings(tree.root, 'en', 0, 0, model, 'bash').map((f) => f.rewrite!.map((r) => r.code)), [['source ./lib.sh']]);
  });
  it('are what the note says', () => {
    assert.match(findings('source lib.sh', ID)[0].text, /Write a path from the script's directory, `source "\$\(dirname "\$\{BASH_SOURCE\[0\]\}"\)"\/lib\.sh`, or `source \.\/lib\.sh` to read it from the current directory$/);
    assert.match(findings('. lib.sh', ID, 'sh')[0].text, /Write `\. \.\/lib\.sh` to read it from the current directory$/);
    const tree = parser.parse('. lib.sh');
    const ja = pitfallFindings(tree.root, 'ja', 0, 0, shellState(tree, 'bash'), 'bash')[0].text;
    assert.match(ja, /スクリプトのディレクトリからのパス（`\. "\$\(dirname "\$\{BASH_SOURCE\[0\]\}"\)"\/lib\.sh`）か、カレントディレクトリから読むなら `\. \.\/lib\.sh` と書きます$/);
  });
  it('leave no finding of the check', () => {
    for (const src of ['source lib.sh', 'f() {\n  . "lib.sh"\n}', '#!/bin/bash\nset -o posix\nsource lib.sh x']) {
      for (const [, script] of rewrites(src, ID)) assert.deepStrictEqual(findings(script, ID), [], script);
    }
    for (const [, script] of rewrites('#!/bin/sh\n. lib.sh', ID, 'sh')) assert.deepStrictEqual(findings(script, ID, 'sh'), [], script);
  });

  // (The script lies in `my app/` (a space in the name), and `cwd/` is where it is started from; `bin/` is first on PATH.)
  const LIBS = { 'my app/lib.sh': 'echo "@lib app $*"\n', 'cwd/lib.sh': 'echo "@lib cwd $*"\n', 'bin/lib.sh': 'echo "@lib path $*"\n' };
  /** How the script is read: run by bash, by its path, sourced by a shell started elsewhere, sourced in a function. */
  const MODES = {
    run: '"$BASH_BIN" "../my app/f.sh"; echo "@st=$?"',
    path: '"../my app/f.sh"; echo "@st=$?"',
    source: '. "../my app/f.sh"; echo "@after=$?"',
    function: 'g() { . "../my app/f.sh"; }; g; echo "@after=$?"',
  };
  const lib = (out: string): string[] => [...out.matchAll(/^@lib (\w+)/gm)].map((m) => m[1]);
  for (const { name, program } of programs) {
    for (const src of ['#!/bin/bash\nsource lib.sh\necho "@end"\n', 'f() {\n  . "lib.sh" a\n}\nf\necho "@end"\n', '#!/bin/bash\nset -o posix\nsource lib.sh\necho "@end"\n']) {
      it(`read the file beside the script, or in the current directory, wherever it is started from and however it is read, in ${name}: ${JSON.stringify(src)}`, async () => {
        const [[, fromDir], [, here]] = rewrites(src, ID);
        const modes = Object.entries(MODES).filter(([m]) => m !== 'path' || src.startsWith('#!'));
        for (const [mode, driver] of modes) {
          // (The hazard: the original reads the file of PATH; the rewrites never do, and the script goes on.)
          const [o, r, h] = await Promise.all([src, fromDir, here].map((script) => inBox(program, { ...LIBS, 'my app/f.sh': script }, driver)));
          assert.deepStrictEqual([lib(o), lib(r), lib(h)], [['path'], ['app'], ['cwd']], `${mode}: ${o}${r}${h}`);
          for (const out of [r, h]) assert.match(out, /^@end$/m, `${mode}: ${out}`);
          // (The meaning is kept: with no file of the name in PATH, started from the script's directory, all three read
          // the file there; bash in POSIX mode searches PATH only, and the original then fails.)
          const local = (script: string) => inBox(program, { 'my app/lib.sh': LIBS['my app/lib.sh'], 'my app/f.sh': script }, `cd "../my app" && ${driver.replace(/\.\.\/my app\//g, './')}`);
          const kept = await Promise.all([src, fromDir, here].map(local));
          assert.deepStrictEqual(kept.map(lib), [src.includes('posix') ? [] : ['app'], ['app'], ['app']], `${mode}: ${kept.join('')}`);
        }
      });
    }
    it(`parse, in ${name}`, async () => {
      for (const src of ['source lib.sh', 'f() {\n  . "lib.sh"\n}']) {
        for (const [, script] of rewrites(src, ID)) assert.strictEqual(await inBox(program, { 'cwd/f.sh': script }, '"$BASH_BIN" -n f.sh && echo ok'), 'ok\n', script);
      }
    });
  }
  it('read the file beside the script in dash, run by sh or by its path', async () => {
    const src = '#!/bin/sh\n. lib.sh\necho "@end"\n';
    const [[, fromDir], [, here]] = rewrites(src, ID, 'sh');
    for (const driver of ['dash "../my app/f.sh"', 'PATH="$PATH" "../my app/f.sh"']) {
      const outs = await Promise.all([src, fromDir, here].map((script) => inBox('bash', { ...LIBS, 'my app/f.sh': script.replace('#!/bin/sh', '#!/usr/bin/dash') }, driver)));
      assert.deepStrictEqual(outs.map(lib), [['path'], ['app'], ['cwd']], outs.join(''));
    }
  });
});

describe('the rewrite of `pattern-from-variable`', () => {
  const ID = 'pattern-from-variable';
  it('adds `-F`, or puts it in place of an option or a name that selects another mode', () => {
    const cases: [string, string][] = [
      ['grep "$x" f', 'grep -F "$x" f'],
      ['grep -e "$x" -i f', 'grep -F -e "$x" -i f'],
      ['sudo grep -q "${x}" f', 'sudo grep -F -q "${x}" f'],
      ['grep -E "$x" f', 'grep -F "$x" f'],
      ['grep -iE "$x" f', 'grep -iF "$x" f'],
      ['grep "-iE" "$x" f', "grep '-iF' \"$x\" f"],
      ['grep "-iEm 1" "$x" f', "grep '-iFm 1' \"$x\" f"],
      ['grep --extended-regexp -e "$x" f', 'grep -F -e "$x" f'],
      ['grep "$x" -P f', 'grep "$x" -F f'],
      ['egrep -i "$x" f', 'grep -F -i "$x" f'],
    ];
    assert.deepStrictEqual(cases.map(([src]) => rewrites(src, ID).map(([, s]) => s)), cases.map(([, want]) => [want]));
    // (Shown from the name to the pattern, or to the last word it changes.)
    assert.deepStrictEqual(['grep "$x" -P f', 'egrep -i "$x" f'].map((src) => rewrites(src, ID).map(([c]) => c)), [['grep "$x" -F'], ['grep -F -i "$x"']]);
  });
  it('is none where a word before the pattern may be an option, and the note then says what to do', () => {
    // (The model knows the value, which the argument interpreter reads; the rewrite would keep the word as written.)
    const srcs = ['o=-i\ngrep $o "$x" f', 'o=-i\ngrep -E $o "$x" f', 'o=-i\negrep $o "$x" f'];
    // (After the pattern, an unquoted expansion, which may give `-E`.)
    assert.deepStrictEqual(rewrites('o=-iE\ngrep "$x" $o f', ID), []);
    assert.deepStrictEqual(rewrites('grep "$x" "$f" *.log', ID).map(([, s]) => s), ['grep -F "$x" "$f" *.log']);
    for (const src of srcs) assert.deepStrictEqual(rewrites(src, ID), [], src);
    assert.deepStrictEqual(srcs.map((src) => /To look for the value as it is, (.*), with/.exec(findings(src, ID)[0].text)![1]),
      ['add `-F`', 'write `-F` in place of `-E`', 'use `grep -F` in place of `egrep`']);
  });
  it('is what the note says', () => {
    assert.match(findings('grep -iE "$x" f', ID)[0].text, /To look for the value as it is, write `grep -iF "\$x"`, with `-w` \(whole words\) or `-x` \(whole lines\) as meant$/);
    const tree = parser.parse('grep "$x" f');
    assert.match(pitfallFindings(tree.root, 'ja', 0, 0, shellState(tree, 'bash'), 'bash')[0].text, /値をそのまま探すには `grep -F "\$x"` と書き、意図に合わせて/);
  });
  it('leaves no finding of the check', () => {
    for (const src of ['grep "$x" f', 'grep -iE "$x" f', 'grep "$x" -P f', 'egrep -i "$x" f']) {
      for (const [, script] of rewrites(src, ID)) assert.deepStrictEqual(findings(script, ID), [], script);
    }
  });
  for (const { name, program } of programs) {
    it(`matches the value as it is where egrep matched it as a regular expression, in ${name}`, async () => {
      const [[, script]] = rewrites('egrep -i "$x" f\n', ID);
      const files = { 'cwd/f': 'A.B\naxb\nfoo\n' };
      const run = (text: string, value: string) => inBox(program, { ...files, 'cwd/f.sh': text }, '"$BASH_BIN" f.sh 2>/dev/null', { x: value });
      // (The meaning: what egrep gives with the value escaped; the hazard: egrep matches `axb` too.)
      assert.deepStrictEqual(await Promise.all([run('egrep -i "$x" f\n', 'a\\.b'), run(script, 'a.b'), run('egrep -i "$x" f\n', 'a.b')]), ['A.B\n', 'A.B\n', 'A.B\naxb\n']);
    });
  }
});
